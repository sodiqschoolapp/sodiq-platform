import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  classNameKey,
  classDisplayName,
  relativeNameKey,
  studentImportRowsSchema,
  studentNameKey,
  type RelativeLinkInput,
  type StudentCreate,
  type StudentImportConfirmResult,
  type StudentImportDecisions,
  type StudentImportPreview,
  type StudentImportPreviewRow,
  type StudentImportColumn,
  type StudentImportProblem,
  type StudentImportRow,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { UploadedFile } from '../../http/file-routes.js';
import { XlsxFile } from '../../http/xlsx.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { CLASS_GROUP_REFUSALS } from '../classes/class-groups.js';
import { MEMBERSHIP_REFUSALS } from '../classes/class-membership-rows.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { refusingRelativeRaces, RelativeWrites } from './relative-writes.js';
import {
  columnOfPath,
  fileChecks,
  parseImportRow,
  readImportWorkbook,
  type ParsedRow,
} from './student-import-read.js';
import {
  TEMPLATE_ASCII_NAME,
  templateFileName,
  writeImportTemplate,
} from './student-import-template.js';
import { Students } from './students.service.js';

const DEADLOCK = '40P01';
const SERIALIZATION_FAILURE = '40001';

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('The student import works for the branch of the request.');
  }
  return access.branchId;
}

/** The column of a refusal of the create that names no field: the class for a full class or group. */
const CODE_COLUMNS: Partial<Record<string, StudentImportColumn>> = {
  class_full: 'className',
  group_full: 'className',
  student_needs_class: 'className',
  student_needs_group: 'className',
};

/** The result of a run that is rolled back: thrown out of the transaction, caught outside. */
class RolledBack extends Error {
  constructor(readonly preview: StudentImportPreview) {
    super('The run is rolled back.');
  }
}

interface ImportRecord {
  id: string;
  rows: StudentImportRow[];
  fileSha256: string;
  confirmedAt: string | null;
}

/** What a run found: the preview, and the ids of the students written. */
interface RunResult {
  preview: StudentImportPreview;
  studentIds: string[];
}

/**
 * The student import (task 9.4g; `04`, Student record: Excel import;
 * `edge/students-classes-groups`, the import rows). The preview and the
 * confirm run the hand-made create (`Students.createIn`) for each row, each
 * in a savepoint, so every check of the hand path is made on every row (plan
 * decision 3); the preview is always rolled back, the confirm commits only
 * when every row is clean ("saves all rows or none").
 */
@Injectable()
export class StudentImports {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly students: Students,
    private readonly relatives: RelativeWrites,
  ) {}

  /** The system's template; it holds no data, so it is not logged (plan decision 9). */
  async template(language: 'uz' | 'ru' | 'en'): Promise<XlsxFile> {
    return new XlsxFile(
      templateFileName(language),
      TEMPLATE_ASCII_NAME,
      [],
      await writeImportTemplate(language),
    );
  }

  /** Reads an upload, keeps its rows, and answers the preview. */
  async upload(
    access: Access,
    file: UploadedFile | null,
    requestId: string,
  ): Promise<StudentImportPreview> {
    if (file === null) {
      throw new ApiException('import_not_template', 422);
    }
    const branchId = branchOf(access);
    const rows = await readImportWorkbook(file.bytes);
    const fileSha256 = createHash('sha256').update(file.bytes).digest('hex');
    const id = await this.transactions.run(access.branchIds, async (transaction) => {
      const moment = await transactionMoment(transaction);
      const inserted = await transaction
        .insertInto('student_imports')
        .values({
          branch_id: branchId,
          file_sha256: fileSha256,
          rows: JSON.stringify(rows),
          row_count: rows.length,
          uploaded_by: access.accountId,
          uploaded_at: moment,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'student_import.upload',
        record: { type: 'student_import', id: inserted.id },
        // No row data in the entry: the file's hash and its size only.
        details: { fileSha256, rowCount: rows.length },
        requestId,
      });
      return inserted.id;
    });
    return this.preview(access, id, { confirmedWarnings: [], relativeLinks: [] }, requestId);
  }

  /** The preview of a kept upload with the decisions so far; changes nothing. */
  async preview(
    access: Access,
    id: string,
    decisions: StudentImportDecisions,
    requestId: string,
  ): Promise<StudentImportPreview> {
    try {
      await this.transactions.run(access.branchIds, async (transaction) => {
        const record = await this.readImport(transaction, id, false);
        const result = await this.run(transaction, access, record, decisions, requestId);
        throw new RolledBack(result.preview);
      });
    } catch (error) {
      if (error instanceof RolledBack) {
        return error.preview;
      }
      throw error;
    }
    throw new Error('A preview is always rolled back.');
  }

  /**
   * Saves every row in one transaction, or nothing: the import row is locked
   * first, a confirmed import and a file already confirmed in the branch are
   * refused, every row is checked again, and any problem rolls back the
   * whole confirm and answers the preview.
   */
  async confirm(
    access: Access,
    id: string,
    decisions: StudentImportDecisions,
    requestId: string,
  ): Promise<StudentImportConfirmResult> {
    const branchId = branchOf(access);
    try {
      return await this.transactions.run(access.branchIds, async (transaction) => {
        const record = await this.readImport(transaction, id, true);
        if (record.confirmedAt !== null) {
          throw new ApiException('import_already_confirmed', 409);
        }
        // Two imports of one file confirmed at the same moment: the second waits here for the
        // first to end and then finds it (the unique index of 0154 stays the last guard).
        await sql`select pg_advisory_xact_lock(hashtextextended(${`student_import:${branchId}:${record.fileSha256}`}, 0))`.execute(
          transaction,
        );
        if ((await this.importedOn(transaction, record)) !== null) {
          throw new ApiException('import_already_done', 409);
        }
        const result = await this.run(transaction, access, record, decisions, requestId);
        if (!result.preview.clean) {
          throw new RolledBack(result.preview);
        }
        const moment = await transactionMoment(transaction);
        await transaction
          .updateTable('student_imports')
          .set({ confirmed_by: access.accountId, confirmed_at: moment })
          .where('id', '=', id)
          .execute();
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'student_import.confirm',
          record: { type: 'student_import', id },
          details: {
            fileSha256: record.fileSha256,
            created: result.studentIds.length,
            studentIds: result.studentIds,
          },
          requestId,
        });
        return {
          outcome: 'saved' as const,
          created: result.studentIds.length,
          studentIds: result.studentIds,
        };
      });
    } catch (error) {
      if (error instanceof RolledBack) {
        return { outcome: 'not_clean', preview: error.preview };
      }
      const failure = error as { code?: unknown; constraint?: unknown };
      if (failure.code === DEADLOCK || failure.code === SERIALIZATION_FAILURE) {
        throw new ApiException('import_changed', 409);
      }
      throw error;
    }
  }

  /** The import of the branch of the request; another branch's or an unknown one is not found. */
  private async readImport(
    transaction: Transaction,
    id: string,
    lock: boolean,
  ): Promise<ImportRecord> {
    let query = transaction
      .selectFrom('student_imports')
      .select(['id', 'rows', 'file_sha256', 'confirmed_at'])
      .where('id', '=', id);
    if (lock) {
      query = query.forUpdate();
    }
    const row = await query.executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return {
      id: row.id,
      rows: studentImportRowsSchema.parse(row.rows),
      fileSha256: row.file_sha256,
      confirmedAt: row.confirmed_at === null ? null : String(row.confirmed_at),
    };
  }

  /** The day the same file was confirmed in the branch, if it was. */
  private async importedOn(transaction: Transaction, record: ImportRecord): Promise<string | null> {
    const found = await transaction
      .selectFrom('student_imports')
      .select(sql<string>`to_char(confirmed_at, 'YYYY-MM-DD')`.as('day'))
      .where('file_sha256', '=', record.fileSha256)
      .where('confirmed_at', 'is not', null)
      .executeTakeFirst();
    return found?.day ?? null;
  }

  /**
   * Checks and writes every row on the transaction given; the caller commits
   * or rolls back.
   */
  private async run(
    transaction: Transaction,
    access: Access,
    record: ImportRecord,
    decisions: StudentImportDecisions,
    requestId: string,
  ): Promise<RunResult> {
    const branchId = branchOf(access);
    const parsed = record.rows.map(parseImportRow);
    const byNumber = new Map(parsed.map((row) => [row.rowNumber, row]));
    // A decision names a row and a relative position of the file that has a phone.
    for (const link of decisions.relativeLinks) {
      const relative = byNumber
        .get(link.rowNumber)
        ?.relatives.find((one) => one.position === link.position);
      if (relative?.phone === null || relative === undefined) {
        throw new ApiException('import_decision_unknown', 422);
      }
    }
    if (decisions.confirmedWarnings.some((number) => !byNumber.has(number))) {
      throw new ApiException('import_decision_unknown', 422);
    }
    const inFile = fileChecks(parsed);
    const classes = await this.classesOf(transaction, branchId);
    const today = await this.students.todayIn(transaction, branchId);
    const deferred = await deferredConstraints(transaction);
    const previewRows: StudentImportPreviewRow[] = [];
    const studentIds: string[] = [];
    let clean = true;
    for (const row of parsed) {
      const problems: StudentImportProblem[] = [
        ...row.problems,
        ...(inFile.problems.get(row.rowNumber) ?? []),
      ];
      const shownClass =
        row.grade !== null && row.className !== null
          ? classDisplayName(row.grade, row.className)
          : null;
      let classId: string | null = null;
      if (row.input !== null && row.className !== null) {
        const input = row.input;
        const found = classes.find(
          (one) =>
            one.grade === input.grade &&
            one.nameKey === classNameKey(row.className ?? '') &&
            one.startDate <= input.startsOn &&
            input.startsOn <= one.endDate,
        );
        if (found === undefined) {
          problems.push({ column: 'className', code: 'class_unknown' });
        } else {
          classId = found.id;
        }
      } else if (row.input !== null && row.input.startsOn <= today) {
        problems.push({ column: 'className', code: 'needs_class' });
      }
      const warning =
        row.input === null
          ? null
          : await this.warningOf(
              transaction,
              row.input,
              inFile.sameNameAndBirth.get(row.rowNumber) ?? [],
              decisions.confirmedWarnings.includes(row.rowNumber),
              branchId,
              studentIds,
            );
      const { links, held, linked } = await this.linksOf(transaction, row, decisions);
      // A phone held under another name waits for a decision: link, or a corrected file.
      for (const one of held.filter((entry) => !entry.linked)) {
        problems.push({
          column: `relative${String(one.position)}Phone` as StudentImportColumn,
          code: 'phone_held',
        });
      }
      if (problems.length === 0 && row.input !== null) {
        const input: StudentCreate = { ...row.input, classId, relatives: links };
        const saved = await this.saveRow(
          transaction,
          access,
          input,
          requestId,
          record.id,
          deferred,
        );
        if (typeof saved === 'string') {
          studentIds.push(saved);
        } else {
          problems.push(saved);
        }
      }
      const rowClean =
        problems.length === 0 && (warning === null || warning.confirmed);
      clean &&= rowClean;
      previewRows.push({
        rowNumber: row.rowNumber,
        uid: row.shown.uid,
        lastName: row.shown.lastName,
        firstName: row.shown.firstName,
        className: shownClass,
        problems,
        warning,
        held,
        linked,
      });
    }
    // Rows with problems first, then the clean ones, each in the order of the file.
    const ordered = [
      ...previewRows.filter((row) => row.problems.length > 0),
      ...previewRows.filter((row) => row.problems.length === 0),
    ];
    return {
      preview: {
        importId: record.id,
        alreadyImportedOn: await this.importedOn(transaction, record),
        rows: ordered,
        clean,
      },
      studentIds,
    };
  }

  /** The classes of the branch with their year's dates, archived ones left out. */
  private async classesOf(transaction: Transaction, branchId: string) {
    const rows = await transaction
      .selectFrom('classes')
      .innerJoin('academic_years', 'academic_years.id', 'classes.academic_year_id')
      .select([
        'classes.id',
        'classes.grade',
        'classes.name',
        'academic_years.start_date',
        'academic_years.end_date',
      ])
      .where('classes.branch_id', '=', branchId)
      .where('classes.archived_at', 'is', null)
      .execute();
    return rows.map((row) => ({
      id: row.id,
      grade: row.grade,
      nameKey: classNameKey(row.name),
      startDate: String(row.start_date),
      endDate: String(row.end_date),
    }));
  }

  /**
   * The duplicate warning of a row (edge, the duplicate check: "A matching
   * name and date of birth, compared after removing spelling differences,
   * gives a warning that must be confirmed"): the hand form's check, run for
   * the row, with the earlier rows of the file of the same name and date.
   */
  private async warningOf(
    transaction: Transaction,
    input: StudentCreate,
    rows: number[],
    confirmed: boolean,
    branchId: string,
    /** The students this run wrote above: the rows of the file are named by row number instead. */
    written: readonly string[],
  ): Promise<StudentImportPreviewRow['warning']> {
    const nameKey = studentNameKey(input.lastName, input.firstName);
    let query = transaction
      .selectFrom('students')
      .select(['id', 'uid'])
      .where('branch_id', '=', branchId)
      .where('name_key', '=', nameKey)
      .where('birth_date', '=', input.birthDate)
      .orderBy('uid');
    if (written.length > 0) {
      query = query.where('id', 'not in', written);
    }
    const students = await query.execute();
    const elsewhere = await sql<{ found: boolean }>`
      select student_duplicate_elsewhere(${nameKey}, ${input.birthDate}::date) as found
    `.execute(transaction);
    const found = elsewhere.rows[0]?.found === true;
    if (students.length === 0 && !found && rows.length === 0) {
      return null;
    }
    return { students, elsewhere: found, rows, confirmed };
  }

  /**
   * The links of a row's relatives (`04`, Adding a relative; `edge`, the
   * relative phone row): a phone nobody holds makes a new relative; one held
   * under the same name links to that person; one held under another name is
   * a choice, linked when the decisions name it. The `existing` link always
   * carries the phone of the row as kept, never one the client sent; the
   * hand path refuses it when that person no longer holds the phone.
   */
  private async linksOf(
    transaction: Transaction,
    row: ParsedRow,
    decisions: StudentImportDecisions,
  ): Promise<{
    links: RelativeLinkInput[];
    held: StudentImportPreviewRow['held'];
    linked: number[];
  }> {
    const links: RelativeLinkInput[] = [];
    const held: StudentImportPreviewRow['held'] = [];
    const linked: number[] = [];
    for (const relative of row.relatives) {
      const { link } = relative;
      const decided = decisions.relativeLinks.find(
        (one) => one.rowNumber === row.rowNumber && one.position === relative.position,
      );
      if (relative.phone === null) {
        links.push(link);
        continue;
      }
      const holder = await this.relatives.holderOf(transaction, relative.phone);
      const sameName =
        holder !== null && relativeNameKey(holder.fullName) === relativeNameKey(relative.fullName);
      if (holder !== null && !sameName) {
        held.push({ position: relative.position, holder, linked: decided !== undefined });
      }
      if (holder !== null && sameName && holder.id !== null) {
        linked.push(relative.position);
      }
      const relativeId = decided?.relativeId ?? (sameName ? holder?.id : null);
      links.push(
        relativeId === null || relativeId === undefined
          ? link
          : {
              kind: 'existing',
              relativeId,
              phone: relative.phone,
              relationship: link.relationship,
              mainContact: link.mainContact,
              portalAccess: link.portalAccess,
              receivesNotices: link.receivesNotices,
            },
      );
    }
    return { links, held, linked };
  }

  /**
   * One row through the hand create in a savepoint, with the hand route's
   * refusals: the new student's id, or the problem the create answered (its
   * code, the column of its path, the student it names when of the branch).
   * The deferred checks run at the end of the row (`set constraints all
   * immediate`), so a row that a commit would refuse is refused here, and the
   * deferred ones are deferred again for the next row.
   */
  private async saveRow(
    transaction: Transaction,
    access: Access,
    input: StudentCreate,
    requestId: string,
    importId: string,
    deferred: readonly string[],
  ): Promise<string | StudentImportProblem> {
    try {
      return await this.students.refusingTaken(access, () =>
        this.relatives.refusingHeldPhone(access, () =>
          refusingRelativeRaces(() =>
            refusingConstraints(
              async () => {
                await sql`savepoint student_import_row`.execute(transaction);
                try {
                  const id = await this.students.createIn(
                    transaction,
                    access,
                    input,
                    requestId,
                    importId,
                  );
                  await sql`set constraints all immediate`.execute(transaction);
                  if (deferred.length > 0) {
                    await sql`set constraints ${sql.join(deferred.map((name) => sql.id(name)))} deferred`.execute(
                      transaction,
                    );
                  }
                  await sql`release savepoint student_import_row`.execute(transaction);
                  return id;
                } catch (error) {
                  await sql`rollback to savepoint student_import_row`.execute(transaction);
                  throw error;
                }
              },
              { ...MEMBERSHIP_REFUSALS, ...CLASS_GROUP_REFUSALS },
            ),
          ),
        ),
      );
    } catch (error) {
      if (!(error instanceof ApiException)) {
        throw error;
      }
      const detail = error.details?.[0];
      const column =
        (detail === undefined ? null : columnOfPath(detail.path.split('.'))) ??
        CODE_COLUMNS[error.code] ??
        null;
      return {
        column,
        code: error.code,
        ...(detail?.recordId === undefined ? {} : { recordId: detail.recordId }),
        ...(detail?.code === 'held_elsewhere' ? { elsewhere: true } : {}),
      };
    }
  }
}

/** The constraints of the application's schema that are deferred until the commit unless set otherwise. */
async function deferredConstraints(transaction: Transaction): Promise<string[]> {
  const found = await sql<{ name: string }>`
    select distinct c.conname as name from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.condeferrable and c.condeferred
    order by 1
  `.execute(transaction);
  return found.rows.map((row) => row.name);
}
