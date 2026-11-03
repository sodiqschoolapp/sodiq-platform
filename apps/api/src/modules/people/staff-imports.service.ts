import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  listName,
  staffImportRowsSchema,
  type FirstPasswordSlip,
  type Language,
  type StaffImportColumn,
  type StaffImportConfirmResult,
  type StaffImportDecisions,
  type StaffImportPreview,
  type StaffImportPreviewRow,
  type StaffImportProblem,
  type StaffImportRole,
  type StaffImportRow,
  type StaffRecord,
  type StaffTeaching,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { UploadedFile } from '../../http/file-routes.js';
import { XlsxFile } from '../../http/xlsx.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import {
  prepareFirstPassword,
  PREVIEW_PASSWORD_HASH,
  type PreparedFirstPassword,
} from '../auth/accounts.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { findPerson, leftForGood } from './staff-account-records.js';
import { StaffAccounts } from './staff-accounts.service.js';
import {
  parseStaffImportRow,
  readStaffImportWorkbook,
  staffColumnOfPath,
  staffFileChecks,
  type ParsedStaffRow,
  type SchoolLists,
} from './staff-import-read.js';
import {
  STAFF_TEMPLATE_ASCII_NAME,
  staffTemplateFileName,
  writeStaffImportTemplate,
} from './staff-import-template.js';
import { Staff, superAdminOf } from './staff.service.js';

/** First passwords hashed at the same time before a confirm: fewer than the thread pool's four. */
const HASH_BATCH = 2;

const DEADLOCK = '40P01';
const SERIALIZATION_FAILURE = '40001';

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('The staff import works for the branch of the request.');
  }
  return access.branchId;
}

/**
 * "Only the Super Admin imports staff" (`edge/people-roles-accounts`; the
 * spec change of 3 November 2026: under `staff` create and `accounts`
 * create). The route asks `staff` create; the Super Admin assignment, decided
 * from every assignment, also allows the accounts and roles the import gives
 * and is named in their entries, as by hand (`StaffAccounts`).
 */
function actingAs(access: Access): string {
  const superAdmin = superAdminOf(access);
  if (superAdmin === undefined) {
    throw new ApiException('permission_denied', 403);
  }
  return superAdmin;
}

/** The column of a refusal of the hand steps that names no field. */
const CODE_COLUMNS: Partial<Record<string, StaffImportColumn>> = {
  staff_phone_taken: 'phone',
  staff_department_required: 'department',
  subject_outside_department: 'department',
  languages_required: 'languages',
  login_taken: 'lastName',
  import_no_login: 'lastName',
};

/** The result of a run that is rolled back: thrown out of the transaction, caught outside. */
class RolledBack extends Error {
  constructor(readonly preview: StaffImportPreview) {
    super('The run is rolled back.');
  }
}

/** A row the run gave no account: refused as a problem of the row. */
class RowProblem extends Error {
  constructor(readonly problem: StaffImportProblem) {
    super(problem.code);
  }
}

interface ImportRecord {
  id: string;
  branchId: string;
  rows: StaffImportRow[];
  fileSha256: string;
  confirmedAt: string | null;
}

interface SavedRow {
  id: string;
  staffId: string;
  login: string | null;
  slip: FirstPasswordSlip | null;
}

interface RunResult {
  preview: StaffImportPreview;
  saved: (SavedRow & { lastName: string; firstName: string })[];
}

/**
 * The first passwords of a run: those of the confirm, made before its
 * transaction, by row number; for the preview one placeholder that no
 * password matches (plan decision 5, Look first).
 */
type Passwords = ReadonlyMap<number, PreparedFirstPassword> | 'preview';

const PREVIEW_PASSWORD: PreparedFirstPassword = { password: '', hash: PREVIEW_PASSWORD_HASH };

/**
 * The staff import (task 9.4h; `04`, Teacher and staff record: the import;
 * `edge/people-roles-accounts`, the staff import row). The preview and the
 * confirm run the hand steps (`Staff.createIn`, `Staff.teachingIn`,
 * `StaffAccounts.createIn` and `giveIn`) for each row, each in a savepoint,
 * so every check of the hand path is made on every row; the preview is
 * always rolled back, the confirm commits only when every row is clean.
 */
@Injectable()
export class StaffImports {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly staff: Staff,
    private readonly accounts: StaffAccounts,
  ) {}

  /** The system's template, with the school's lists by name; it holds no personal data and is not logged. */
  async template(access: Access, language: Language): Promise<XlsxFile> {
    actingAs(access);
    const lists = await this.transactions.run(access.branchIds, (transaction) =>
      this.listsOf(transaction),
    );
    const at = language === 'uz' ? 0 : language === 'ru' ? 1 : 2;
    const name = (record: { names: readonly string[] }) => record.names[at] ?? '';
    return new XlsxFile(
      staffTemplateFileName(language),
      STAFF_TEMPLATE_ASCII_NAME,
      [],
      await writeStaffImportTemplate(language, {
        divisions: lists.divisions.map(name),
        departments: lists.departments.map(name),
        subjects: lists.subjects.map(name),
      }),
    );
  }

  /** Reads an upload, keeps its rows, and answers the preview. */
  async upload(
    access: Access,
    file: UploadedFile | null,
    requestId: string,
  ): Promise<StaffImportPreview> {
    actingAs(access);
    if (file === null) {
      throw new ApiException('import_not_template', 422);
    }
    const branchId = branchOf(access);
    const rows = await readStaffImportWorkbook(file.bytes);
    const fileSha256 = createHash('sha256').update(file.bytes).digest('hex');
    const id = await this.transactions.run(access.branchIds, async (transaction) => {
      const moment = await transactionMoment(transaction);
      const inserted = await transaction
        .insertInto('staff_imports')
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
        action: 'staff_import.upload',
        record: { type: 'staff_import', id: inserted.id },
        // No row data in the entry: the file's hash and its size only.
        details: { fileSha256, rowCount: rows.length },
        requestId,
      });
      return inserted.id;
    });
    return this.preview(access, id, { confirmedWarnings: [] }, requestId);
  }

  /** The preview of a kept upload with the decisions so far; changes nothing. */
  async preview(
    access: Access,
    id: string,
    decisions: StaffImportDecisions,
    requestId: string,
  ): Promise<StaffImportPreview> {
    const superAdmin = actingAs(access);
    try {
      await this.transactions.run(access.branchIds, async (transaction) => {
        const record = await this.readImport(transaction, branchOf(access), id, false);
        const result = await this.run(
          transaction,
          access,
          superAdmin,
          record,
          decisions,
          requestId,
          'preview',
        );
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

  /**
   * Saves every row in one transaction, or nothing. The first passwords of
   * the rows with a role are made before the transaction (plan decision 5),
   * so no hash runs while it holds the year's staff-number counter and the
   * phone locks. Answers the slips once; they are stored nowhere.
   */
  async confirm(
    access: Access,
    id: string,
    decisions: StaffImportDecisions,
    requestId: string,
  ): Promise<StaffImportConfirmResult> {
    const superAdmin = actingAs(access);
    const branchId = branchOf(access);
    // The rows as kept, read first (404 before anything else), with the refusals a repeated
    // confirm gets, so that it makes no hash; the transaction below checks both again.
    const kept = await this.transactions.run(access.branchIds, async (transaction) => {
      const record = await this.readImport(transaction, branchId, id, false);
      if (record.confirmedAt !== null) {
        throw new ApiException('import_already_confirmed', 409);
      }
      if ((await this.importedOn(transaction, record)) !== null) {
        throw new ApiException('import_already_done', 409);
      }
      return record;
    });
    const withRole = kept.rows
      .map((row) => parseStaffImportRow(row, NO_LISTS))
      .filter((row) => row.role !== null)
      .map((row) => row.rowNumber);
    const passwords = new Map<number, PreparedFirstPassword>();
    // A few at a time: Argon2id runs on the thread pool every request shares (sign-ins too).
    for (let start = 0; start < withRole.length; start += HASH_BATCH) {
      const batch = withRole.slice(start, start + HASH_BATCH);
      const prepared = await Promise.all(batch.map(() => prepareFirstPassword()));
      batch.forEach((number, index) => {
        const one = prepared[index];
        if (one !== undefined) {
          passwords.set(number, one);
        }
      });
    }
    try {
      return await this.transactions.run(access.branchIds, async (transaction) => {
        const record = await this.readImport(transaction, branchId, id, true);
        if (record.confirmedAt !== null) {
          throw new ApiException('import_already_confirmed', 409);
        }
        // Two imports of one file confirmed at the same moment: the second waits here for the
        // first to end and then finds it (the unique index of 0155 stays the last guard).
        await sql`select pg_advisory_xact_lock(hashtextextended(${`staff_import:${branchId}:${record.fileSha256}`}, 0))`.execute(
          transaction,
        );
        if ((await this.importedOn(transaction, record)) !== null) {
          throw new ApiException('import_already_done', 409);
        }
        const result = await this.run(
          transaction,
          access,
          superAdmin,
          record,
          decisions,
          requestId,
          passwords,
        );
        if (!result.preview.clean) {
          throw new RolledBack(result.preview);
        }
        const moment = await transactionMoment(transaction);
        await transaction
          .updateTable('staff_imports')
          .set({ confirmed_by: access.accountId, confirmed_at: moment })
          .where('id', '=', id)
          .execute();
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'staff_import.confirm',
          record: { type: 'staff_import', id },
          // The hash, the counts and the ids: no row data and no password.
          details: {
            fileSha256: record.fileSha256,
            created: result.saved.length,
            accounts: result.saved.filter((row) => row.slip !== null).length,
            staffIds: result.saved.map((row) => row.id),
          },
          requestId,
        });
        return {
          outcome: 'saved' as const,
          created: result.saved.length,
          staff: result.saved.map((row) => ({
            id: row.id,
            staffId: row.staffId,
            lastName: row.lastName,
            firstName: row.firstName,
            login: row.login,
          })),
          slips: result.saved.flatMap((row) => (row.slip === null ? [] : [row.slip])),
          issuedOn: await this.staff.todayIn(transaction, branchId),
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

  /** The import of the branch of the request; another branch's or an unknown one is not found. */
  private async readImport(
    transaction: Transaction,
    branchId: string,
    id: string,
    lock: boolean,
  ): Promise<ImportRecord> {
    let query = transaction
      .selectFrom('staff_imports')
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
      rows: staffImportRowsSchema.parse(row.rows),
      branchId: row.branch_id,
      fileSha256: row.file_sha256,
      confirmedAt: row.confirmed_at === null ? null : String(row.confirmed_at),
    };
  }

  /** The day the same file was confirmed in the branch, in the branch's time zone, if it was. */
  private async importedOn(transaction: Transaction, record: ImportRecord): Promise<string | null> {
    const found = await transaction
      .selectFrom('staff_imports')
      .innerJoin('branches', 'branches.id', 'staff_imports.branch_id')
      .select(
        sql<string>`to_char(staff_imports.confirmed_at at time zone branches.time_zone, 'YYYY-MM-DD')`.as(
          'day',
        ),
      )
      .where('staff_imports.branch_id', '=', record.branchId)
      .where('staff_imports.file_sha256', '=', record.fileSha256)
      .where('staff_imports.confirmed_at', 'is not', null)
      .executeTakeFirst();
    return found?.day ?? null;
  }

  /** The divisions, departments and subjects of the school, archived ones left out, by their three names. */
  private async listsOf(transaction: Transaction): Promise<SchoolLists> {
    const names = ['name_uz', 'name_ru', 'name_en'] as const;
    const divisions = await transaction
      .selectFrom('divisions')
      .select(['id', 'built_in', ...names])
      .where('archived_at', 'is', null)
      .orderBy('position')
      .execute();
    const departments = await transaction
      .selectFrom('departments')
      .select(['id', 'division_id', ...names])
      .where('archived_at', 'is', null)
      .orderBy('division_id')
      .orderBy('position')
      .execute();
    const subjects = await transaction
      .selectFrom('subjects')
      .select(['id', ...names])
      .where('archived_at', 'is', null)
      .orderBy('name_en')
      .execute();
    const named = (row: { name_uz: string; name_ru: string; name_en: string }) => [
      row.name_uz,
      row.name_ru,
      row.name_en,
    ];
    return {
      divisions: divisions.map((row) => ({ id: row.id, builtIn: row.built_in, names: named(row) })),
      departments: departments.map((row) => ({
        id: row.id,
        divisionId: row.division_id,
        names: named(row),
      })),
      subjects: subjects.map((row) => ({ id: row.id, names: named(row) })),
    };
  }

  /** Checks and writes every row on the transaction given; the caller commits or rolls back. */
  private async run(
    transaction: Transaction,
    access: Access,
    superAdmin: string,
    record: ImportRecord,
    decisions: StaffImportDecisions,
    requestId: string,
    passwords: Passwords,
  ): Promise<RunResult> {
    const branchId = branchOf(access);
    const lists = await this.listsOf(transaction);
    const parsed = record.rows.map((row) => parseStaffImportRow(row, lists));
    if (
      decisions.confirmedWarnings.some((number) => !parsed.some((row) => row.rowNumber === number))
    ) {
      throw new ApiException('import_decision_unknown', 422);
    }
    const inFile = staffFileChecks(parsed);
    const today = await this.staff.todayIn(transaction, branchId);
    const deferred = await deferredConstraints(transaction);
    const previewRows: StaffImportPreviewRow[] = [];
    const saved: RunResult['saved'] = [];
    let clean = true;
    for (const row of parsed) {
      const problems: StaffImportProblem[] = [
        ...row.problems,
        ...(inFile.problems.get(row.rowNumber) ?? []),
      ];
      const warning =
        row.record === null
          ? null
          : await this.warningOf(
              transaction,
              row.record,
              inFile.sameNameAndBirth.get(row.rowNumber) ?? [],
              decisions.confirmedWarnings.includes(row.rowNumber),
              saved.map((one) => one.id),
            );
      const relative =
        row.record === null
          ? undefined
          : await this.staff.relativeOfPhone(transaction, access, row.record.phone);
      let login: string | null = null;
      if (problems.length === 0 && row.record !== null && row.teaching !== null) {
        const password = passwords === 'preview' ? PREVIEW_PASSWORD : passwords.get(row.rowNumber);
        const result = await this.saveRow(transaction, access, superAdmin, {
          record: row.record,
          teaching: row.teaching,
          role: row.role,
          // The role from the first day of work, and never before today (the hand give refuses a
          // past date; plan decision 6).
          from: row.record.admissionDate > today ? row.record.admissionDate : today,
          password,
          requestId,
          importId: record.id,
          deferred,
        });
        if ('problem' in result) {
          problems.push(await this.holderOf(transaction, result.problem, row));
        } else {
          login = result.login;
          saved.push({ ...result, lastName: row.record.lastName, firstName: row.record.firstName });
        }
      }
      const rowClean = problems.length === 0 && (warning === null || warning.confirmed);
      clean &&= rowClean;
      previewRows.push({
        rowNumber: row.rowNumber,
        lastName: row.shown.lastName,
        firstName: row.shown.firstName,
        role: row.role,
        problems,
        warning,
        samePerson:
          relative === undefined || (relative.here === undefined && !relative.exists)
            ? null
            : { fullName: relative.here?.fullName ?? null },
        login,
      });
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
        clean,
      },
      saved,
    };
  }

  /**
   * The duplicate warning of a row (`edge/people-roles-accounts`, re-hire
   * row: "The system also warns on the same name and date of birth"): the
   * hand check (`Staff.check`), run for the row, with the earlier rows of the
   * file of the same name and date.
   */
  private async warningOf(
    transaction: Transaction,
    record: StaffRecord,
    rows: number[],
    confirmed: boolean,
    /** The records this run wrote above: the rows of the file are named by row number instead. */
    written: readonly string[],
  ): Promise<StaffImportPreviewRow['warning']> {
    let query = transaction
      .selectFrom('staff')
      .select(['id', 'staff_id', 'first_name', 'last_name'])
      .where('kind', '=', 'person')
      .where(sql<boolean>`lower(first_name) = lower(${record.firstName})`)
      .where(sql<boolean>`lower(last_name) = lower(${record.lastName})`)
      .where('birth_date', '=', record.birthDate)
      .orderBy('staff_id');
    if (written.length > 0) {
      query = query.where('id', 'not in', written);
    }
    const found = await query.execute();
    const elsewhere = await sql<{ found: boolean }>`
      select staff_duplicate_elsewhere(
        ${record.firstName}, ${record.lastName}, ${record.birthDate}::date, ${record.phone}
      ) as found
    `.execute(transaction);
    const other = elsewhere.rows[0]?.found === true;
    if (found.length === 0 && !other && rows.length === 0) {
      return null;
    }
    return {
      records: found.map((one) => ({
        id: one.id,
        staffId: one.staff_id,
        name: listName({ firstName: one.first_name ?? '', lastName: one.last_name ?? '' }).trim(),
      })),
      elsewhere: other,
      rows,
      confirmed,
    };
  }

  /**
   * A phone or JSHSHIR another staff record holds (review correction 1): the
   * holder of the branch named, with whether they have left (then they are
   * re-hired by hand on their record, which keeps the staff ID and the
   * login); another branch's only told.
   */
  private async holderOf(
    transaction: Transaction,
    problem: StaffImportProblem,
    row: ParsedStaffRow,
  ): Promise<StaffImportProblem> {
    const jshshir = problem.code === 'already_exists' && problem.column === 'jshshir';
    if (problem.code !== 'staff_phone_taken' && !jshshir) {
      return problem;
    }
    let holderId = problem.recordId;
    let staffName = problem.staffName;
    if (jshshir && row.record?.jshshir !== null && row.record?.jshshir !== undefined) {
      const holder = await transaction
        .selectFrom('staff')
        .select(['id', 'first_name', 'last_name'])
        .where('jshshir', '=', row.record.jshshir)
        .executeTakeFirst();
      holderId = holder?.id;
      staffName =
        holder === undefined
          ? undefined
          : listName({
              firstName: holder.first_name ?? '',
              lastName: holder.last_name ?? '',
            }).trim();
    }
    if (holderId === undefined) {
      return { column: problem.column, code: problem.code, elsewhere: true };
    }
    return {
      column: problem.column,
      code: problem.code,
      recordId: holderId,
      ...(staffName === undefined ? {} : { staffName }),
      ...((await leftForGood(transaction, holderId)) ? { left: true } : {}),
    };
  }

  /**
   * One row through the hand steps in a savepoint: the record, its teaching,
   * and for a row with a role its account and the role in the branch of the
   * request. The deferred checks run at the end of the row (`set constraints
   * all immediate`; the one-department rule is the trigger `staff_profile_
   * check`), so a row that a commit would refuse is refused here, and the
   * deferred ones are deferred again for the next row.
   */
  private async saveRow(
    transaction: Transaction,
    access: Access,
    superAdmin: string,
    row: {
      record: StaffRecord;
      teaching: StaffTeaching;
      role: StaffImportRole | null;
      from: string;
      password: PreparedFirstPassword | undefined;
      requestId: string;
      importId: string;
      deferred: readonly string[];
    },
  ): Promise<SavedRow | { problem: StaffImportProblem }> {
    const branchId = branchOf(access);
    try {
      return await this.staff.refusing(async () => {
        await sql`savepoint staff_import_row`.execute(transaction);
        try {
          const id = await this.staff.createIn(
            transaction,
            access,
            row.record,
            row.requestId,
            row.importId,
          );
          await this.staff.teachingIn(transaction, access, id, row.teaching, row.requestId);
          let slip: FirstPasswordSlip | null = null;
          let login: string | null = null;
          if (row.role !== null) {
            const person = await findPerson(transaction, id, branchId, true);
            login = await this.accounts.suggestIn(transaction, person);
            if (login === null) {
              throw new RowProblem({ column: 'lastName', code: 'import_no_login' });
            }
            if (row.password === undefined) {
              throw new Error('A first password is made for every row with a role.');
            }
            slip = await this.accounts.createIn(
              transaction,
              access,
              superAdmin,
              person,
              login,
              row.requestId,
              row.password,
            );
            const linked = await findPerson(transaction, id, branchId, true);
            if (linked.accountId === null) {
              throw new Error('The account was just linked.');
            }
            await this.accounts.giveIn(
              transaction,
              access,
              superAdmin,
              linked,
              linked.accountId,
              { role: row.role, branchId, from: row.from },
              row.requestId,
            );
          }
          await sql`set constraints all immediate`.execute(transaction);
          if (row.deferred.length > 0) {
            await sql`set constraints ${sql.join(row.deferred.map((name) => sql.id(name)))} deferred`.execute(
              transaction,
            );
          }
          await sql`release savepoint staff_import_row`.execute(transaction);
          const stored = await transaction
            .selectFrom('staff')
            .select('staff_id')
            .where('id', '=', id)
            .executeTakeFirstOrThrow();
          if (stored.staff_id === null) {
            throw new Error('A person always has a staff ID.');
          }
          // The preview's placeholder is no password: no slip leaves a preview.
          return {
            id,
            staffId: stored.staff_id,
            login,
            slip: slip !== null && slip.password !== '' ? slip : null,
          };
        } catch (error) {
          await sql`rollback to savepoint staff_import_row`.execute(transaction);
          throw error;
        }
      });
    } catch (error) {
      if (error instanceof RowProblem) {
        return { problem: error.problem };
      }
      if (!(error instanceof ApiException)) {
        throw error;
      }
      const detail = error.details?.[0];
      const column =
        (detail === undefined ? null : staffColumnOfPath(detail.path.split('.'))) ??
        CODE_COLUMNS[error.code] ??
        null;
      return {
        problem: {
          column,
          code: error.code,
          ...(detail?.recordId === undefined ? {} : { recordId: detail.recordId }),
          ...(detail?.staffName === undefined ? {} : { staffName: detail.staffName }),
        },
      };
    }
  }
}

/** No list: the confirm reads only the role of each row before its transaction. */
const NO_LISTS: SchoolLists = { divisions: [], departments: [], subjects: [] };

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
