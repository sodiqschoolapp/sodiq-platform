import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  subjectImportRowsSchema,
  type Language,
  type PermissionTable,
  type QuarterWeights,
  type SubjectImportColumn,
  type SubjectImportConfirmResult,
  type SubjectImportPreview,
  type SubjectImportPreviewRow,
  type SubjectImportProblem,
  type SubjectImportRow,
  type SubjectRecord,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { UploadedFile } from '../../http/file-routes.js';
import { XlsxFile } from '../../http/xlsx.js';
import { permitting } from '../access/permission-check.js';
import { PERMISSION_TABLE } from '../access/permission-table.token.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { todayOf } from '../people/department-moves.js';
import { quarterClosedNow } from './closed-quarters.js';
import { notFound, refusingConstraints } from './setup-refusals.js';
import {
  parseSubjectImportRow,
  readSubjectImportWorkbook,
  subjectColumnOfPath,
  subjectFileChecks,
  type ImportDepartment,
} from './subject-import-read.js';
import {
  SUBJECT_TEMPLATE_ASCII_NAME,
  subjectTemplateFileName,
  writeSubjectImportTemplate,
} from './subject-import-template.js';
import { Subjects } from './subjects.service.js';

const DEADLOCK = '40P01';
const SERIALIZATION_FAILURE = '40001';

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('The subject import works for the branch of the request.');
  }
  return access.branchId;
}

/** The column of a refusal of the hand steps that names no field. */
const CODE_COLUMNS: Partial<Record<string, SubjectImportColumn>> = {
  department_not_academic: 'department',
  department_archived: 'department',
  daily_weights_required: 'dailyAttendance',
  weights_shape_mismatch: 'quarterRatingExam',
};

/** The result of a run that is rolled back: thrown out of the transaction, caught outside. */
class RolledBack extends Error {
  constructor(readonly preview: SubjectImportPreview) {
    super('The run is rolled back.');
  }
}

interface ImportRecord {
  id: string;
  branchId: string;
  rows: SubjectImportRow[];
  fileSha256: string;
  confirmedAt: string | null;
}

interface RunResult {
  preview: SubjectImportPreview;
  saved: { id: string; names: SubjectRecord['names'] }[];
}

/**
 * The subject import (the owner's change of 7 November 2026, pull request
 * #316; `05`, "Excel import of subjects"). The preview and the confirm run the
 * hand steps for each row in a savepoint: `Subjects.createIn` (the subject,
 * its school-wide entry and the branch's daily distribution) and
 * `Subjects.writeQuarterWeightsIn` for each quarter not closed of the
 * branch's years not closed that end today or later, so every check of the
 * hand path is made on every row. The preview is always rolled back; the
 * confirm commits only when every row is clean.
 *
 * The routes ask `subjects` create; the quarterly weights are an edit by hand
 * (`PUT subjects/:id/quarter-weights/:quarterId`), so the service also asks
 * `subjects` edit, decided from every current assignment, and names that
 * assignment in the entries of the quarterly weights (plan decision 6).
 */
@Injectable()
export class SubjectImports {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly subjects: Subjects,
    @Inject(PERMISSION_TABLE) private readonly table: PermissionTable,
  ) {}

  /** The system's template, with the active departments of Academic by name; it is not logged. */
  async template(access: Access, language: Language): Promise<XlsxFile> {
    this.editAccess(access);
    const departments = await this.transactions.run(access.branchIds, (transaction) =>
      this.departmentsOf(transaction),
    );
    const at = language === 'uz' ? 0 : language === 'ru' ? 1 : 2;
    return new XlsxFile(
      subjectTemplateFileName(language),
      SUBJECT_TEMPLATE_ASCII_NAME,
      [],
      await writeSubjectImportTemplate(
        language,
        departments.filter((one) => one.academic).map((one) => one.names[at] ?? ''),
      ),
    );
  }

  /** Reads an upload, keeps its rows, and answers the preview. */
  async upload(
    access: Access,
    file: UploadedFile | null,
    requestId: string,
  ): Promise<SubjectImportPreview> {
    this.editAccess(access);
    if (file === null) {
      throw new ApiException('import_not_template', 422);
    }
    const branchId = branchOf(access);
    const rows = await readSubjectImportWorkbook(file.bytes);
    const fileSha256 = createHash('sha256').update(file.bytes).digest('hex');
    const id = await this.transactions.run(access.branchIds, async (transaction) => {
      const moment = await transactionMoment(transaction);
      const inserted = await transaction
        .insertInto('subject_imports')
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
        action: 'subject_import.upload',
        record: { type: 'subject_import', id: inserted.id },
        details: { fileSha256, rowCount: rows.length },
        requestId,
      });
      return inserted.id;
    });
    return this.preview(access, id, requestId);
  }

  /** The preview of a kept upload; changes nothing. */
  async preview(access: Access, id: string, requestId: string): Promise<SubjectImportPreview> {
    const edit = this.editAccess(access);
    try {
      await this.transactions.run(access.branchIds, async (transaction) => {
        const record = await this.readImport(transaction, branchOf(access), id, false);
        const result = await this.run(transaction, access, edit, record, requestId);
        throw new RolledBack(result.preview);
      });
    } catch (error) {
      if (error instanceof RolledBack) {
        return error.preview;
      }
      if (conflicted(error)) {
        throw new ApiException('import_changed', 409);
      }
      throw error;
    }
    throw new Error('A preview is always rolled back.');
  }

  /** Saves every row in one transaction, or nothing. */
  async confirm(
    access: Access,
    id: string,
    requestId: string,
  ): Promise<SubjectImportConfirmResult> {
    const edit = this.editAccess(access);
    const branchId = branchOf(access);
    try {
      return await this.transactions.run(access.branchIds, async (transaction) => {
        const record = await this.readImport(transaction, branchId, id, true);
        if (record.confirmedAt !== null) {
          throw new ApiException('import_already_confirmed', 409);
        }
        // Two imports of one file confirmed at the same moment: the second waits here for the
        // first to end and then finds it (the unique index of 0167 stays the last guard).
        await sql`select pg_advisory_xact_lock(hashtextextended(${`subject_import:${branchId}:${record.fileSha256}`}, 0))`.execute(
          transaction,
        );
        if ((await this.importedOn(transaction, record)) !== null) {
          throw new ApiException('import_already_done', 409);
        }
        const result = await this.run(transaction, access, edit, record, requestId);
        if (!result.preview.clean) {
          throw new RolledBack(result.preview);
        }
        const moment = await transactionMoment(transaction);
        await transaction
          .updateTable('subject_imports')
          .set({ confirmed_by: access.accountId, confirmed_at: moment })
          .where('id', '=', id)
          .execute();
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'subject_import.confirm',
          record: { type: 'subject_import', id },
          details: {
            fileSha256: record.fileSha256,
            created: result.saved.length,
            subjectIds: result.saved.map((row) => row.id),
          },
          requestId,
        });
        return {
          outcome: 'saved' as const,
          created: result.saved.length,
          subjects: result.saved,
        };
      });
    } catch (error) {
      if (error instanceof RolledBack) {
        return { outcome: 'not_clean', preview: error.preview };
      }
      if (conflicted(error)) {
        throw new ApiException('import_changed', 409);
      }
      throw error;
    }
  }

  /**
   * The access the quarterly weights are written with: the first current assignment that
   * permits `subjects` edit in the branch of the request, decided from every assignment, never
   * from the one the guard named (`.claude/rules/api.md`). Refused without one.
   */
  private editAccess(access: Access): Access {
    const [edit] = permitting(
      { area: 'subjects', action: 'edit', branch: 'request' },
      access.assignments,
      access.branchId,
      this.table,
    );
    if (edit === undefined) {
      throw new ApiException('permission_denied', 403);
    }
    return { ...access, assignmentId: edit.id };
  }

  /** The import of the branch of the request; another branch's or an unknown one is not found. */
  private async readImport(
    transaction: Transaction,
    branchId: string,
    id: string,
    lock: boolean,
  ): Promise<ImportRecord> {
    let query = transaction
      .selectFrom('subject_imports')
      .select(['id', 'branch_id', 'rows', 'file_sha256', 'confirmed_at'])
      .where('id', '=', id)
      .where('branch_id', '=', branchId);
    if (lock) {
      query = query.forUpdate();
    }
    const row = await query.executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return {
      id: row.id,
      rows: subjectImportRowsSchema.parse(row.rows),
      branchId: row.branch_id,
      fileSha256: row.file_sha256,
      confirmedAt: row.confirmed_at === null ? null : String(row.confirmed_at),
    };
  }

  /** The day the same file was confirmed in the branch, in the branch's time zone, if it was. */
  private async importedOn(transaction: Transaction, record: ImportRecord): Promise<string | null> {
    const found = await transaction
      .selectFrom('subject_imports')
      .innerJoin('branches', 'branches.id', 'subject_imports.branch_id')
      .select(
        sql<string>`to_char(subject_imports.confirmed_at at time zone branches.time_zone, 'YYYY-MM-DD')`.as(
          'day',
        ),
      )
      .where('subject_imports.branch_id', '=', record.branchId)
      .where('subject_imports.file_sha256', '=', record.fileSha256)
      .where('subject_imports.confirmed_at', 'is not', null)
      .executeTakeFirst();
    return found?.day ?? null;
  }

  /** The active departments of the school by their three names, those of Academic marked. */
  private async departmentsOf(transaction: Transaction): Promise<ImportDepartment[]> {
    const rows = await transaction
      .selectFrom('departments')
      .innerJoin('divisions', 'divisions.id', 'departments.division_id')
      .select([
        'departments.id',
        'departments.name_uz',
        'departments.name_ru',
        'departments.name_en',
        'divisions.built_in',
      ])
      .where('departments.archived_at', 'is', null)
      .orderBy('departments.division_id')
      .orderBy('departments.position')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      names: [row.name_uz, row.name_ru, row.name_en],
      academic: row.built_in,
    }));
  }

  /**
   * The quarters a graded row's quarterly distribution is written to (`05`: "every quarter of
   * the current and later years of that branch"; plan decision 7): of the branch's years not
   * closed that end today or later, each quarter locked `for key share` in a statement of its
   * own, then its closed state read in another (`.claude/rules/database.md`); a closed quarter
   * is left out (a new subject has no lessons there).
   */
  private async openQuarters(transaction: Transaction, branchId: string): Promise<string[]> {
    const today = await todayOf(transaction, branchId);
    const quarters = await transaction
      .selectFrom('quarters')
      .innerJoin('academic_years', 'academic_years.id', 'quarters.academic_year_id')
      .select('quarters.id')
      .where('academic_years.branch_id', '=', branchId)
      .where('academic_years.status', '<>', 'closed')
      .where('academic_years.end_date', '>=', today)
      .orderBy('academic_years.start_date')
      .orderBy('quarters.number')
      .execute();
    const open: string[] = [];
    for (const quarter of quarters) {
      await sql`select 1 from quarters where id = ${quarter.id}::uuid for key share`.execute(
        transaction,
      );
      if (!(await quarterClosedNow(transaction, quarter.id))) {
        open.push(quarter.id);
      }
    }
    return open;
  }

  /** Checks and writes every row on the transaction given; the caller commits or rolls back. */
  private async run(
    transaction: Transaction,
    access: Access,
    edit: Access,
    record: ImportRecord,
    requestId: string,
  ): Promise<RunResult> {
    const branchId = branchOf(access);
    const departments = await this.departmentsOf(transaction);
    const parsed = record.rows.map((row) => parseSubjectImportRow(row, departments));
    const inFile = subjectFileChecks(record.rows);
    const quarters = await this.openQuarters(transaction, branchId);
    const deferred = await deferredConstraints(transaction);
    const previewRows: SubjectImportPreviewRow[] = [];
    const saved: RunResult['saved'] = [];
    let clean = true;
    for (const row of parsed) {
      const problems: SubjectImportProblem[] = [
        ...row.problems,
        ...(inFile.get(row.rowNumber) ?? []).filter(
          (found) => !row.problems.some((own) => own.column === found.column),
        ),
      ];
      if (problems.length === 0 && row.record !== null) {
        const result = await this.saveRow(transaction, access, edit, {
          record: row.record,
          quarterly: row.quarterly,
          quarters,
          requestId,
          importId: record.id,
          deferred,
        });
        if ('problem' in result) {
          problems.push(result.problem);
        } else {
          saved.push({ id: result.id, names: row.record.names });
        }
      }
      clean &&= problems.length === 0;
      previewRows.push({ rowNumber: row.rowNumber, names: row.shown, problems });
    }
    const ordered = [
      ...previewRows.filter((row) => row.problems.length > 0),
      ...previewRows.filter((row) => row.problems.length === 0),
    ];
    return {
      preview: {
        importId: record.id,
        alreadyImportedOn: await this.importedOn(transaction, record),
        rows: ordered,
        quarterCount: quarters.length,
        clean,
      },
      saved,
    };
  }

  /**
   * One row through the hand steps in a savepoint: the subject with the branch's daily
   * distribution, then the quarterly distribution of each open quarter. The deferred checks
   * run at the end of the row (`set constraints all immediate`), so a row that a commit would
   * refuse is refused here, and the deferred ones are deferred again for the next row.
   */
  private async saveRow(
    transaction: Transaction,
    access: Access,
    edit: Access,
    row: {
      record: SubjectRecord;
      quarterly: QuarterWeights | null;
      quarters: readonly string[];
      requestId: string;
      importId: string;
      deferred: readonly string[];
    },
  ): Promise<{ id: string } | { problem: SubjectImportProblem }> {
    try {
      const id = await this.subjects.refusingSubjects(() =>
        refusingConstraints(
          async () => {
            await sql`savepoint subject_import_row`.execute(transaction);
            try {
              const created = await this.subjects.createIn(
                transaction,
                access,
                row.record,
                row.requestId,
                row.importId,
              );
              const quarterly = row.quarterly;
              if (quarterly !== null) {
                for (const quarterId of row.quarters) {
                  await this.subjects.writeQuarterWeightsIn(
                    transaction,
                    edit,
                    created,
                    quarterId,
                    quarterly,
                    row.requestId,
                    false,
                    row.importId,
                  );
                }
              }
              await sql`set constraints all immediate`.execute(transaction);
              if (row.deferred.length > 0) {
                await sql`set constraints ${sql.join(row.deferred.map((name) => sql.id(name)))} deferred`.execute(
                  transaction,
                );
              }
              await sql`release savepoint subject_import_row`.execute(transaction);
              return created;
            } catch (error) {
              await sql`rollback to savepoint subject_import_row`.execute(transaction);
              throw error;
            }
          },
          { quarters_closed: 'quarter_closed' },
        ),
      );
      return { id };
    } catch (error) {
      if (!(error instanceof ApiException)) {
        throw error;
      }
      const detail = error.details?.[0];
      const column =
        (detail === undefined ? null : subjectColumnOfPath(detail.path.split('.'))) ??
        CODE_COLUMNS[error.code] ??
        null;
      return { problem: { column, code: error.code } };
    }
  }
}

/** A deadlock or a serialization failure: `import_changed`, nothing was saved, try again. */
function conflicted(error: unknown): boolean {
  const failure = error as { code?: unknown };
  return failure.code === DEADLOCK || failure.code === SERIALIZATION_FAILURE;
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
