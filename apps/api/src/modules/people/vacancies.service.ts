import { Inject, Injectable } from '@nestjs/common';
import {
  schoolDateOf,
  type Clock,
  type ErrorCode,
  type InstructionLanguage,
  type SchoolDate,
  type VacancyDetail,
  type VacancyExport,
  type VacancyExportColumn,
  type VacancyList,
  type VacancyListItem,
  type VacancyRecord,
  type VacancyStatus,
  type VacancyStatusRow,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { XlsxFile } from '../../http/xlsx.js';
import type { JsonValue } from '../../database/types.generated.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import {
  exportList,
  gradesOf,
  joined,
  nameIn,
  oneCell,
  readSchoolNames,
  type ExportColumn,
  type SchoolNames,
} from '../audit/export-list.js';
import { changesOf, notFound, refusingConstraints } from '../setup/setup-refusals.js';

/** The refusals of the database for a vacancy (db/migrations/0024, 0025), by the name of the constraint. */
const VACANCY_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  staff_subject_department: 'subject_outside_department',
  staff_subject_grades: 'grade_not_in_subject',
  staff_languages_required: 'languages_required',
  // The service keeps these first; a fault answers the general refusal.
  staff_department_required: 'request_refused',
  staff_vacancy_division: 'request_refused',
  staff_vacancy_check: 'request_refused',
  staff_vacancy_one_branch: 'request_refused',
  staff_main_division: 'request_refused',
  staff_main_branch: 'request_refused',
  staff_statuses_no_overlap: 'request_refused',
  staff_statuses_kind: 'request_refused',
  vacancy_not_deletable: 'request_refused',
  // Task 3.4a (04, Vacancy): a load row names the vacancy (db/migrations/0055).
  vacancy_has_load: 'vacancy_has_load',
};

const refused = (code: ErrorCode): ApiException => new ApiException(code, 409);

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('A vacancy route works for the branch of the request.');
  }
  return access.branchId;
}

interface StoredStatus {
  id: string;
  status: VacancyStatus;
  validFrom: string;
  validUntil: string | null;
}

const isLive = (row: StoredStatus) => row.validUntil !== row.validFrom;

const inForceOn = (row: StoredStatus, date: SchoolDate) =>
  isLive(row) && row.validFrom <= date && (row.validUntil === null || date < row.validUntil);

/** The fields of a vacancy as the audit entries and the edit compare them. */
interface VacancyFields {
  name: string;
  departmentId: string;
  subjects: { subjectId: string; grades: number[] }[];
  languages: InstructionLanguage[];
  weeklyLessons: number | null;
  dailyLessons: number | null;
}

const fieldsOf = (record: VacancyRecord): VacancyFields => ({
  name: record.name,
  departmentId: record.departmentId,
  subjects: [...record.subjects]
    .map((subject) => ({
      subjectId: subject.subjectId,
      grades: [...subject.grades].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.subjectId.localeCompare(b.subjectId)),
  languages: [...record.languages].sort(),
  weeklyLessons: record.weeklyLessons,
  dailyLessons: record.dailyLessons,
});

/**
 * Vacancies (`04`, Vacancy; task 2.2b, pull request #57): staff records of
 * kind `vacancy` with one branch, the branch of the request. Every route
 * works with `access.branchIds`, also for the Super Admin (decision 13); a
 * vacancy of another branch, an unknown id and a person's id are 404. Lock
 * order: the branch row (`for no key update`, the name among the open
 * vacancies; decision 5), the record, its statuses, then the department and
 * subjects FOR SHARE. Close and reopen act from today (decision 7); a reopen
 * checks again what a closed vacancy escaped (`.claude/rules/database.md`).
 */
@Injectable()
export class Vacancies {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  list(access: Access): Promise<VacancyList> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const today = await this.todayIn(transaction, branchId);
      return { vacancies: await this.readList(transaction, branchId, today), today };
    });
  }

  /**
   * The Excel file of the Vacancies list (task 2.2c-1): its Export button is
   * the asking of `04`, Vacancy ("exports leave them out unless asked";
   * decision 6). The rows read as the list reads them, in one transaction.
   */
  export(access: Access, request: VacancyExport, requestId: string): Promise<XlsxFile> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const today = await this.todayIn(transaction, branchId);
      const items = await this.readList(transaction, branchId, today);
      const names = await readSchoolNames(transaction);
      return exportList(transaction, this.audit, this.clock, access, requestId, {
        list: 'vacancies',
        action: 'vacancy.export',
        request,
        rows: new Map(items.map((item) => [item.id, item])),
        allowed: () => true,
        columns: vacancyExportColumns(names),
      });
    });
  }

  /** The vacancies of the branch as the list shows them: open first, then by name. */
  private async readList(
    transaction: Transaction,
    branchId: string,
    today: SchoolDate,
  ): Promise<VacancyListItem[]> {
    const ids = (
      await transaction
        .selectFrom('staff')
        .innerJoin('staff_branches', 'staff_branches.staff_id', 'staff.id')
        .select('staff.id')
        .where('staff.kind', '=', 'vacancy')
        .where('staff_branches.branch_id', '=', branchId)
        .execute()
    ).map((row) => row.id);
    const items = await this.items(transaction, ids, today);
    return items.sort(
      (a, b) =>
        (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
  }

  detail(access: Access, id: string): Promise<VacancyDetail> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      await this.vacancyOf(transaction, id, branchId, false);
      return this.readDetail(transaction, id, branchId);
    });
  }

  create(access: Access, record: VacancyRecord, requestId: string): Promise<VacancyDetail> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          await this.lockBranch(transaction, branchId);
          const today = await this.todayIn(transaction, branchId);
          await this.refuseTakenName(transaction, branchId, record.name, null, today);
          const academic = await this.checkDepartment(transaction, record.departmentId);
          await this.checkSubjects(transaction, record.subjects, []);
          const fields = fieldsOf(record);
          // The id first: the new row is visible only once its branch link
          // exists, so the insert cannot read it back (the membership policy).
          const id = (await sql<{ id: string }>`select uuidv7() as id`.execute(transaction)).rows[0]
            ?.id;
          if (id === undefined) {
            throw new Error('uuidv7() answered nothing.');
          }
          await transaction
            .insertInto('staff')
            .values({
              id,
              kind: 'vacancy',
              vacancy_name: fields.name,
              weekly_lessons: fields.weeklyLessons,
              daily_lessons: fields.dailyLessons,
            })
            .execute();
          await transaction
            .insertInto('staff_branches')
            .values({ staff_id: id, branch_id: branchId, is_main: true })
            .execute();
          await transaction
            .insertInto('staff_divisions')
            .values({
              staff_id: id,
              division_id: academic,
              department_id: fields.departmentId,
              is_main: true,
            })
            .execute();
          await this.writeTeaching(transaction, id, { subjects: [], languages: [] }, fields);
          await transaction
            .insertInto('staff_statuses')
            .values({ staff_id: id, status: 'open', valid_from: today })
            .execute();
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'vacancy.create',
            record: { type: 'staff', id },
            newValue: { ...fields, status: 'open', from: today },
            requestId,
          });
          return this.readDetail(transaction, id, branchId);
        }),
      VACANCY_REFUSALS,
    );
  }

  edit(
    access: Access,
    id: string,
    record: VacancyRecord,
    requestId: string,
  ): Promise<VacancyDetail> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          await this.lockBranch(transaction, branchId);
          await this.vacancyOf(transaction, id, branchId, true);
          const today = await this.todayIn(transaction, branchId);
          const before = await this.fieldsOfStored(transaction, id);
          const after = fieldsOf(record);
          const changes = changesOf({ ...before }, { ...after });
          if (changes === null) {
            return this.readDetail(transaction, id, branchId);
          }
          const statuses = await this.statusesOf(transaction, id, false);
          if (statuses.some((row) => inForceOn(row, today) && row.status === 'open')) {
            await this.refuseTakenName(transaction, branchId, after.name, id, today);
          }
          if (after.departmentId !== before.departmentId) {
            await this.checkDepartment(transaction, after.departmentId);
            await transaction
              .updateTable('staff_divisions')
              .set({ department_id: after.departmentId })
              .where('staff_id', '=', id)
              .execute();
          }
          await this.checkSubjects(transaction, after.subjects, before.subjects);
          await transaction
            .updateTable('staff')
            .set({
              vacancy_name: after.name,
              weekly_lessons: after.weeklyLessons,
              daily_lessons: after.dailyLessons,
            })
            .where('id', '=', id)
            .execute();
          await this.writeTeaching(transaction, id, before, after);
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'vacancy.edit',
            record: { type: 'staff', id },
            oldValue: changes.oldValue,
            newValue: changes.newValue,
            requestId,
          });
          return this.readDetail(transaction, id, branchId);
        }),
      VACANCY_REFUSALS,
    );
  }

  /** `04`: "Status: open or closed". From today (decision 7). */
  setStatus(
    access: Access,
    id: string,
    status: VacancyStatus,
    requestId: string,
  ): Promise<VacancyDetail> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          if (status === 'open') {
            await this.lockBranch(transaction, branchId);
          }
          await this.vacancyOf(transaction, id, branchId, true);
          if (status === 'closed') {
            await this.refuseLoad(transaction, id);
          }
          const today = await this.todayIn(transaction, branchId);
          const statuses = await this.statusesOf(transaction, id, true);
          const current = statuses.find((row) => inForceOn(row, today));
          if (current?.status === status) {
            throw refused('status_unchanged');
          }
          if (status === 'open') {
            // A closed vacancy is out of service, and the subject edit and
            // the department archive skip it: its return checks again what
            // they skipped, under the same locks (the re-hire rule of
            // .claude/rules/database.md; review of pull request #57,
            // finding 4), and its name among the open ones (decision 5).
            const fields = await this.fieldsOfStored(transaction, id);
            await this.refuseTakenName(transaction, branchId, fields.name, id, today);
            await this.checkDepartment(transaction, fields.departmentId);
            await this.checkSubjectsFit(transaction, fields);
          }
          // Rows are written from today, so none is planned later; the row in
          // force today is cut at today (an empty range when it began today).
          if (current !== undefined) {
            await transaction
              .updateTable('staff_statuses')
              .set({ valid_until: today })
              .where('id', '=', current.id)
              .execute();
          }
          await transaction
            .insertInto('staff_statuses')
            .values({ staff_id: id, status, valid_from: today })
            .execute();
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: status === 'open' ? 'vacancy.reopen' : 'vacancy.close',
            record: { type: 'staff', id },
            oldValue: { status: current?.status ?? null },
            newValue: { status, from: today },
            requestId,
          });
          return this.readDetail(transaction, id, branchId);
        }),
      VACANCY_REFUSALS,
    );
  }

  /**
   * `04`: "One that never held a load can be deleted": refused while a load
   * row names it (task 3.4a, decision 6). The audit entry holds the whole vacancy with its history, the
   * only copy left (review of pull request #57, correction 1).
   */
  delete(access: Access, id: string, requestId: string): Promise<void> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          await this.vacancyOf(transaction, id, branchId, true);
          await this.refuseLoad(transaction, id);
          const fields = await this.fieldsOfStored(transaction, id);
          const statuses = await this.statusesOf(transaction, id, true);
          const entries = await transaction
            .selectFrom('staff_availability')
            .select(['id', 'valid_from', 'valid_until'])
            .where('staff_id', '=', id)
            .orderBy('valid_from')
            .orderBy('id')
            .execute();
          const ranges =
            entries.length === 0
              ? []
              : await transaction
                  .selectFrom('staff_availability_ranges')
                  .select(['entry_id', 'weekday', 'start_minutes', 'end_minutes'])
                  .where('staff_id', '=', id)
                  .orderBy('weekday')
                  .orderBy('start_minutes')
                  .execute();
          const oldValue: JsonValue = {
            ...fields,
            statuses: statuses.map((row) => ({
              status: row.status,
              from: row.validFrom,
              until: row.validUntil,
            })),
            availability: entries.map((entry) => ({
              from: entry.valid_from,
              until: entry.valid_until === 'infinity' ? null : entry.valid_until,
              ranges: ranges
                .filter((range) => range.entry_id === entry.id)
                .map((range) => ({
                  weekday: range.weekday,
                  startMinutes: range.start_minutes,
                  endMinutes: range.end_minutes,
                })),
            })),
          };
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'vacancy.delete',
            record: { type: 'staff', id },
            oldValue,
            requestId,
          });
          await sql`select vacancy_delete(${id}::uuid)`.execute(transaction);
        }),
      VACANCY_REFUSALS,
    );
  }

  // ---------------------------------------------------------------------------

  private async todayIn(transaction: Transaction, branchId: string): Promise<SchoolDate> {
    const branch = await transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    return schoolDateOf(this.clock.now(), branch.time_zone);
  }

  /** The branch row, so that two names are checked one after the other (decision 5). */
  private async lockBranch(transaction: Transaction, branchId: string): Promise<void> {
    await transaction
      .selectFrom('branches')
      .select('id')
      .where('id', '=', branchId)
      .forNoKeyUpdate()
      .executeTakeFirstOrThrow();
  }

  /**
   * `04`, Vacancy: "A vacancy cannot be closed while a load row names it"
   * (task 3.4a). Read after the record's FOR UPDATE, in a statement of its
   * own: a load write holds the record FOR KEY SHARE, so a row being written
   * is committed before this reads. `details` names the versions.
   */
  private async refuseLoad(transaction: Transaction, id: string): Promise<void> {
    const rows = await transaction
      .selectFrom('teaching_load_rows')
      .innerJoin('timetable_versions', 'timetable_versions.id', 'teaching_load_rows.version_id')
      .select([
        'teaching_load_rows.id',
        'timetable_versions.id as version_id',
        'timetable_versions.number',
      ])
      .where('teaching_load_rows.teacher_id', '=', id)
      .orderBy('timetable_versions.number')
      .orderBy('teaching_load_rows.id')
      .execute();
    if (rows.length > 0) {
      throw new ApiException(
        'vacancy_has_load',
        409,
        undefined,
        rows.map((row) => ({
          path: 'load',
          code: 'vacancy_has_load',
          message: `Version ${String(row.number)} has a load row that names the vacancy.`,
          recordId: row.version_id,
        })),
      );
    }
  }

  /** A vacancy linked to the branch of the request, locked when asked; 404 otherwise. */
  private async vacancyOf(
    transaction: Transaction,
    id: string,
    branchId: string,
    lock: boolean,
  ): Promise<void> {
    let query = transaction
      .selectFrom('staff')
      .select('id')
      .where('id', '=', id)
      .where('kind', '=', 'vacancy')
      .where((builder) =>
        builder.exists(
          builder
            .selectFrom('staff_branches')
            .select('staff_branches.staff_id')
            .whereRef('staff_branches.staff_id', '=', 'staff.id')
            .where('staff_branches.branch_id', '=', branchId),
        ),
      );
    if (lock) {
      query = query.forUpdate();
    }
    if ((await query.executeTakeFirst()) === undefined) {
      throw notFound();
    }
  }

  /** `edge/timetable`: "a second placeholder with its own name": unique among the open vacancies of the branch. */
  private async refuseTakenName(
    transaction: Transaction,
    branchId: string,
    name: string,
    exceptId: string | null,
    today: SchoolDate,
  ): Promise<void> {
    let query = transaction
      .selectFrom('staff')
      .innerJoin('staff_branches', 'staff_branches.staff_id', 'staff.id')
      .innerJoin('staff_statuses', 'staff_statuses.staff_id', 'staff.id')
      .select('staff.id')
      .where('staff.kind', '=', 'vacancy')
      .where('staff_branches.branch_id', '=', branchId)
      .where(sql<boolean>`lower(btrim(staff.vacancy_name)) = lower(btrim(${name}))`)
      .where('staff_statuses.status', '=', 'open')
      .where('staff_statuses.valid_from', '<=', today)
      .where((builder) =>
        builder.or([
          builder('staff_statuses.valid_until', 'is', null),
          builder('staff_statuses.valid_until', '>', today),
        ]),
      );
    if (exceptId !== null) {
      query = query.where('staff.id', '<>', exceptId);
    }
    if ((await query.executeTakeFirst()) !== undefined) {
      throw new ApiException('already_exists', 409, undefined, [
        { path: 'name', code: 'taken', message: 'An open vacancy of this branch has this name.' },
      ]);
    }
  }

  /**
   * A department of the Academic division that is not archived (`04`: a
   * vacancy has "the Academic division and one department"), read FOR SHARE
   * against an archive at the same moment. Returns the Academic division.
   */
  private async checkDepartment(transaction: Transaction, departmentId: string): Promise<string> {
    const department = await transaction
      .selectFrom('departments')
      .innerJoin('divisions', 'divisions.id', 'departments.division_id')
      .select(['departments.archived_at', 'departments.division_id', 'divisions.built_in'])
      .where('departments.id', '=', departmentId)
      .forShare('departments')
      .executeTakeFirst();
    if (department === undefined) {
      throw notFound();
    }
    if (!department.built_in) {
      throw refused('department_not_academic');
    }
    if (department.archived_at !== null) {
      throw refused('department_archived');
    }
    return department.division_id;
  }

  /**
   * Each subject read FOR SHARE (a subject edit locks it FOR UPDATE and then
   * counts who has it); an unknown one is 404, an archived one refused when
   * added. The department and the grades are checked by the database.
   */
  private async checkSubjects(
    transaction: Transaction,
    subjects: readonly { subjectId: string }[],
    before: readonly { subjectId: string }[],
  ): Promise<void> {
    for (const subject of [...subjects].sort((a, b) => a.subjectId.localeCompare(b.subjectId))) {
      const found = await transaction
        .selectFrom('subjects')
        .select('archived_at')
        .where('id', '=', subject.subjectId)
        .forShare()
        .executeTakeFirst();
      if (found === undefined) {
        throw notFound();
      }
      if (
        found.archived_at !== null &&
        !before.some((old) => old.subjectId === subject.subjectId)
      ) {
        throw refused('subject_archived');
      }
    }
  }

  /** The subjects of a vacancy as they are now: in its department, with grades the subject has. */
  private async checkSubjectsFit(transaction: Transaction, fields: VacancyFields): Promise<void> {
    for (const own of fields.subjects) {
      const subject = await transaction
        .selectFrom('subjects')
        .select(['department_id', 'grades'])
        .where('id', '=', own.subjectId)
        .forShare()
        .executeTakeFirstOrThrow();
      if (subject.department_id !== fields.departmentId) {
        throw refused('subject_outside_department');
      }
      if (own.grades.some((grade) => !subject.grades.includes(grade))) {
        throw refused('grade_not_in_subject');
      }
    }
  }

  private async writeTeaching(
    transaction: Transaction,
    id: string,
    before: Pick<VacancyFields, 'subjects' | 'languages'>,
    after: Pick<VacancyFields, 'subjects' | 'languages'>,
  ): Promise<void> {
    for (const old of before.subjects) {
      const kept = after.subjects.find((subject) => subject.subjectId === old.subjectId);
      if (kept === undefined) {
        await transaction
          .deleteFrom('staff_subjects')
          .where('staff_id', '=', id)
          .where('subject_id', '=', old.subjectId)
          .execute();
      } else if (JSON.stringify(kept.grades) !== JSON.stringify(old.grades)) {
        await transaction
          .updateTable('staff_subjects')
          .set({ grades: kept.grades })
          .where('staff_id', '=', id)
          .where('subject_id', '=', old.subjectId)
          .execute();
      }
    }
    for (const subject of after.subjects.filter(
      (one) => !before.subjects.some((old) => old.subjectId === one.subjectId),
    )) {
      await transaction
        .insertInto('staff_subjects')
        .values({ staff_id: id, subject_id: subject.subjectId, grades: subject.grades })
        .execute();
    }
    for (const language of after.languages.filter((one) => !before.languages.includes(one))) {
      await transaction.insertInto('staff_languages').values({ staff_id: id, language }).execute();
    }
    for (const language of before.languages.filter((one) => !after.languages.includes(one))) {
      await transaction
        .deleteFrom('staff_languages')
        .where('staff_id', '=', id)
        .where('language', '=', language)
        .execute();
    }
  }

  private async fieldsOfStored(transaction: Transaction, id: string): Promise<VacancyFields> {
    const [item] = await this.items(transaction, [id], null);
    if (item === undefined) {
      throw notFound();
    }
    return {
      name: item.name,
      departmentId: item.departmentId,
      subjects: item.subjects,
      languages: item.languages,
      weeklyLessons: item.weeklyLessons,
      dailyLessons: item.dailyLessons,
    };
  }

  private async statusesOf(
    transaction: Transaction,
    id: string,
    lock: boolean,
  ): Promise<StoredStatus[]> {
    let query = transaction
      .selectFrom('staff_statuses')
      .select(['id', 'status', 'valid_from', 'valid_until'])
      .where('staff_id', '=', id)
      .orderBy('valid_from')
      .orderBy('id');
    if (lock) {
      query = query.forUpdate();
    }
    return (await query.execute()).map((row) => ({
      id: row.id,
      status: row.status as VacancyStatus,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
    }));
  }

  /** The list rows of the given vacancies, in one read per table; the status of `today` when given. */
  private async items(
    transaction: Transaction,
    ids: readonly string[],
    today: SchoolDate | null,
  ): Promise<VacancyListItem[]> {
    if (ids.length === 0) {
      return [];
    }
    const list = [...ids];
    const rows = await transaction
      .selectFrom('staff')
      .select(['id', 'vacancy_name', 'weekly_lessons', 'daily_lessons'])
      .where('id', 'in', list)
      .where('kind', '=', 'vacancy')
      .execute();
    const divisions = await transaction
      .selectFrom('staff_divisions')
      .select(['staff_id', 'department_id'])
      .where('staff_id', 'in', list)
      .execute();
    const subjects = await transaction
      .selectFrom('staff_subjects')
      .select(['staff_id', 'subject_id', 'grades'])
      .where('staff_id', 'in', list)
      .orderBy('subject_id')
      .execute();
    const languages = await transaction
      .selectFrom('staff_languages')
      .select(['staff_id', 'language'])
      .where('staff_id', 'in', list)
      .orderBy('language')
      .execute();
    const statuses = await transaction
      .selectFrom('staff_statuses')
      .select(['id', 'staff_id', 'status', 'valid_from', 'valid_until'])
      .where('staff_id', 'in', list)
      .orderBy('valid_from')
      .orderBy('id')
      .execute();
    return rows.map((row) => {
      const own = statuses
        .filter((status) => status.staff_id === row.id)
        .map((status) => ({
          id: status.id,
          status: status.status as VacancyStatus,
          validFrom: status.valid_from,
          validUntil: status.valid_until,
        }));
      const current =
        today === null
          ? own.filter(isLive).at(-1)
          : (own.find((status) => inForceOn(status, today)) ?? own.filter(isLive).at(-1));
      return {
        id: row.id,
        name: row.vacancy_name ?? '',
        departmentId:
          divisions.find((division) => division.staff_id === row.id)?.department_id ?? '',
        subjects: subjects
          .filter((subject) => subject.staff_id === row.id)
          .map((subject) => ({ subjectId: subject.subject_id, grades: subject.grades })),
        languages: languages
          .filter((language) => language.staff_id === row.id)
          .map((language) => language.language as InstructionLanguage),
        weeklyLessons: row.weekly_lessons,
        dailyLessons: row.daily_lessons,
        status: current?.status ?? 'open',
      };
    });
  }

  private async readDetail(
    transaction: Transaction,
    id: string,
    branchId: string,
  ): Promise<VacancyDetail> {
    const today = await this.todayIn(transaction, branchId);
    const [item] = await this.items(transaction, [id], today);
    if (item === undefined) {
      throw notFound();
    }
    const statuses: VacancyStatusRow[] = (await this.statusesOf(transaction, id, false)).map(
      (row) => ({ id: row.id, status: row.status, from: row.validFrom, until: row.validUntil }),
    );
    return { ...item, statuses, today };
  }
}

/** The columns of the vacancy file, as the Vacancies list shows them; the contract load as a number. */
function vacancyExportColumns(
  names: SchoolNames,
): Record<VacancyExportColumn, ExportColumn<VacancyListItem>> {
  return {
    name: oneCell(
      (texts) => texts.vacancies.columns.name,
      (row) => row.name,
    ),
    department: oneCell(
      (texts) => texts.vacancies.columns.department,
      (row, _texts, language) => nameIn(names.departments, row.departmentId, language),
    ),
    subjects: oneCell(
      (texts) => texts.vacancies.columns.subjects,
      (row, _texts, language) =>
        joined(row.subjects.map((subject) => nameIn(names.subjects, subject.subjectId, language))),
    ),
    grades: oneCell(
      (texts) => texts.vacancies.columns.grades,
      (row) => gradesOf(row.subjects),
    ),
    languages: oneCell(
      (texts) => texts.vacancies.columns.languages,
      (row, texts) => joined(row.languages.map((one) => texts.instructionLanguages[one])),
    ),
    weeklyLessons: oneCell(
      (texts) => texts.vacancies.columns.weeklyLessons,
      (row) => row.weeklyLessons,
    ),
    status: oneCell(
      (texts) => texts.vacancies.columns.status,
      (row, texts) => texts.vacancyStatuses[row.status],
    ),
  };
}
