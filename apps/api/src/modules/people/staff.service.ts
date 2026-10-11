import { Inject, Injectable } from '@nestjs/common';
import {
  schoolDateOf,
  STAFF_CATEGORY_ROLES,
  STAFF_CONTACT_FIELDS,
  type Clock,
  type ContractType,
  type EducationLevel,
  type ErrorCode,
  type InstructionLanguage,
  type Role,
  type SchoolDate,
  type Sex,
  type StaffBranches,
  type StaffCheck,
  type StaffCheckResult,
  type StaffDetail,
  type StaffDivisions,
  type StaffIdentity,
  type StaffList,
  type StaffListItem,
  type StaffRecord,
  type StaffRights,
  type StaffStatus,
  type StaffStatusChange,
  type StaffTeaching,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { currentAssignments } from '../access/current-assignments.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import {
  changesOf,
  notFound,
  refusingConstraints,
  refusingDuplicates,
} from '../setup/setup-refusals.js';
import { staffIdOf, takeStaffNumber } from './staff-numbers.js';
import { planStatusChange, roleEndFor, startOfDate, type StoredStatusRow } from './staff-status.js';

/** The refusals of the database for staff records (db/migrations/0024), by the name of the constraint. */
const STAFF_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  staff_id_counters_last_number_check: 'staff_id_exhausted',
  staff_department_required: 'staff_department_required',
  staff_subject_department: 'subject_outside_department',
  staff_subject_grades: 'grade_not_in_subject',
  staff_languages_required: 'languages_required',
  // The shared schemas and the service keep these first; a fault answers the general refusal.
  staff_main_division: 'request_refused',
  staff_main_branch: 'request_refused',
  staff_statuses_no_overlap: 'request_refused',
};

/** JSHSHIR is unique when filled (`edge/people-roles-accounts`, Staff over time). */
const STAFF_UNIQUE_FIELDS: Readonly<Record<string, string>> = { staff_jshshir_idx: 'jshshir' };

interface StaffRow {
  id: string;
  staff_id: string | null;
  account_id: string | null;
  first_name: string | null;
  last_name: string | null;
  father_name: string | null;
  sex: string | null;
  birth_date: string | null;
  education_level: string | null;
  phone: string | null;
  email: string | null;
  jshshir: string | null;
  admission_date: string | null;
  contract_type: string | null;
  contract_date: string | null;
  weekly_lessons: number | null;
  daily_lessons: number | null;
}

/** The fields of a record as the audit entries and the edit compare them. */
type StaffFields = Omit<StaffRecord, 'divisions'> & { divisions: StaffDivisions };

const text = (value: string | null): string => value ?? '';

function fieldsOf(row: StaffRow, divisions: StaffDivisions): StaffFields {
  return {
    firstName: text(row.first_name),
    lastName: text(row.last_name),
    fatherName: row.father_name,
    sex: row.sex as Sex,
    birthDate: text(row.birth_date),
    educationLevel: row.education_level as EducationLevel | null,
    phone: text(row.phone),
    email: row.email,
    jshshir: row.jshshir,
    admissionDate: text(row.admission_date),
    contractType: row.contract_type as ContractType | null,
    contractDate: row.contract_date,
    weeklyLessons: row.weekly_lessons,
    dailyLessons: row.daily_lessons,
    divisions,
  };
}

const columnsOf = (record: StaffRecord) => ({
  first_name: record.firstName,
  last_name: record.lastName,
  father_name: record.fatherName,
  sex: record.sex,
  birth_date: record.birthDate,
  education_level: record.educationLevel,
  phone: record.phone,
  email: record.email,
  jshshir: record.jshshir,
  admission_date: record.admissionDate,
  contract_type: record.contractType,
  contract_date: record.contractDate,
  weekly_lessons: record.weeklyLessons,
  daily_lessons: record.dailyLessons,
});

/** Divisions in one order, the main one first, so two equal lists compare equal. */
const sortDivisions = (divisions: StaffDivisions): StaffDivisions =>
  [...divisions].sort((a, b) =>
    a.main === b.main ? a.divisionId.localeCompare(b.divisionId) : a.main ? -1 : 1,
  );

/**
 * The current Super Admin assignment of the account, decided from every
 * current assignment (`.claude/rules/api.md`; edge cases, "Who can act").
 */
const superAdminOf = (access: Access): string | undefined =>
  access.assignments.find((assignment) => assignment.role === 'super_admin')?.id;

/** A current Academic Vice Principal assignment of the account in the branch of the request. */
const viceOf = (access: Access): string | undefined =>
  access.assignments.find(
    (assignment) =>
      assignment.role === 'academic_vice_principal' && assignment.branchId === access.branchId,
  )?.id;

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('A staff route works for the branch of the request.');
  }
  return access.branchId;
}

const refused = (code: ErrorCode): ApiException => new ApiException(code, 409);

/**
 * Staff records (docs/spec/04-people.md, Teacher and staff record; task 2.2a,
 * pull request #53). A record is one per person and visible only in the
 * branches the person is linked to (owner's answer 2): every route works in
 * the branch of the request, and a record not linked to it is 404. A Super
 * Admin reads with every branch, because that role "Sees all branches" (`02`)
 * and its branches and status routes change links and decide dates of other
 * branches (decisions 18 and 21). Every change writes its audit entry in its
 * transaction. Lock order: the record, then divisions, departments and
 * subjects FOR SHARE, then the counter of staff IDs.
 */
@Injectable()
export class Staff {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The branches a read of this account works with: every branch for a Super Admin, else the branch of the request. */
  private async readingBranches(access: Access): Promise<readonly string[]> {
    if (superAdminOf(access) === undefined) {
      return access.branchIds;
    }
    return this.transactions.run([], async (transaction) =>
      (await transaction.selectFrom('branches').select('id').orderBy('id').execute()).map(
        (row) => row.id,
      ),
    );
  }

  /** Today in the time zone of a branch. */
  private async todayIn(transaction: Transaction, branchId: string): Promise<SchoolDate> {
    const branch = await transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    return schoolDateOf(this.clock.now(), branch.time_zone);
  }

  /** The people of the branch of the request, with the columns of the list. */
  async list(access: Access): Promise<StaffList> {
    const branchId = branchOf(access);
    const branches = await this.readingBranches(access);
    return this.transactions.run(branches, async (transaction) => {
      const ids = (
        await transaction
          .selectFrom('staff')
          .innerJoin('staff_branches', 'staff_branches.staff_id', 'staff.id')
          .select('staff.id')
          .where('staff.kind', '=', 'person')
          .where('staff_branches.branch_id', '=', branchId)
          .execute()
      ).map((row) => row.id);
      const items = await this.items(transaction, ids);
      return {
        staff: items.sort(
          (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName),
        ),
        today: await this.todayIn(transaction, branchId),
      };
    });
  }

  /** One person of the branch of the request, with the status history and the rights of the account. */
  async detail(access: Access, id: string): Promise<StaffDetail> {
    const branches = await this.readingBranches(access);
    return this.transactions.run(branches, (transaction) =>
      this.readDetail(transaction, access, id),
    );
  }

  /**
   * The duplicate warning (edge, Staff over time: "The system also warns on
   * the same name and date of birth, and on the same phone"): the matches of
   * the branch of the request by name, of other branches only whether one
   * exists (owner's answer 2).
   */
  check(access: Access, input: StaffCheck): Promise<StaffCheckResult> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const matches = (filter: 'name' | 'phone') => {
        let query = transaction
          .selectFrom('staff')
          .select(['id', 'staff_id', 'first_name', 'last_name'])
          .where('kind', '=', 'person');
        query =
          filter === 'name'
            ? query
                .where(sql<boolean>`lower(first_name) = lower(${input.firstName})`)
                .where(sql<boolean>`lower(last_name) = lower(${input.lastName})`)
                .where('birth_date', '=', input.birthDate)
            : query.where('phone', '=', input.phone);
        if (input.staffRecordId !== null) {
          query = query.where('id', '<>', input.staffRecordId);
        }
        return query.orderBy('staff_id').execute();
      };
      const toMatch = (row: {
        id: string;
        staff_id: string | null;
        first_name: string | null;
        last_name: string | null;
      }) => ({
        id: row.id,
        staffId: text(row.staff_id),
        firstName: text(row.first_name),
        lastName: text(row.last_name),
      });
      const elsewhere = await sql<{ found: boolean }>`
        select staff_duplicate_elsewhere(
          ${input.firstName}, ${input.lastName}, ${input.birthDate}::date, ${input.phone}
        ) as found
      `.execute(transaction);
      return {
        sameNameAndBirth: (await matches('name')).map(toMatch),
        samePhone: (await matches('phone')).map(toMatch),
        elsewhere: elsewhere.rows[0]?.found === true,
      };
    });
  }

  /**
   * A new person in the branch of the request, which is the main branch
   * (decision 19). The staff ID is taken from the counter of the year of the
   * admission date in the same transaction; the first status row is `active`
   * from the admission date (decision 4). The record is inserted before its
   * link and read back after it (owner's answer 2).
   */
  create(access: Access, record: StaffRecord, requestId: string): Promise<StaffDetail> {
    const branchId = branchOf(access);
    return this.refusing(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        await this.checkDivisions(transaction, record.divisions);
        const year = Number(record.admissionDate.slice(0, 4));
        const staffId = staffIdOf(year, await takeStaffNumber(transaction, year));
        const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
        const id = found.rows[0]?.id;
        if (id === undefined) {
          throw new Error('No id for the new staff record.');
        }
        await transaction
          .insertInto('staff')
          .values({ id, kind: 'person', staff_id: staffId, ...columnsOf(record) })
          .execute();
        await transaction
          .insertInto('staff_branches')
          .values({ staff_id: id, branch_id: branchId, is_main: true })
          .execute();
        await this.writeDivisions(transaction, id, [], record.divisions);
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: id, status: 'active', valid_from: record.admissionDate })
          .execute();
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          personId: id,
          action: 'staff.create',
          record: { type: 'staff', id },
          newValue: { staffId, ...fieldsOf(this.rowOf(record), sortDivisions(record.divisions)) },
          requestId,
        });
        return this.readDetail(transaction, access, id);
      }),
    );
  }

  /**
   * Changes the record. The Academic Vice Principal changes name, phone and
   * email only; every other field is the Super Admin's, decided from every
   * current assignment, and the audit entry names the assignment that allowed
   * it (decision 2). A correction of the admission date keeps the staff ID
   * and the status rows (decision 7).
   */
  edit(access: Access, id: string, record: StaffRecord, requestId: string): Promise<StaffDetail> {
    const branchId = branchOf(access);
    return this.refusing(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const row = await this.lockPerson(transaction, id);
        const divisions = await this.divisionsOf(transaction, id);
        const before = fieldsOf(row, sortDivisions(divisions));
        const after: StaffFields = { ...record, divisions: sortDivisions(record.divisions) };
        const changes = changesOf({ ...before }, { ...after });
        if (changes === null) {
          return this.readDetail(transaction, access, id);
        }
        const contactOnly = Object.keys(changes.newValue).every((key) =>
          (STAFF_CONTACT_FIELDS as readonly string[]).includes(key),
        );
        const assignmentId = contactOnly ? access.assignmentId : superAdminOf(access);
        if (assignmentId === undefined) {
          throw new ApiException('permission_denied', 403);
        }
        const added = record.divisions.filter(
          (division) =>
            !divisions.some(
              (old) =>
                old.divisionId === division.divisionId &&
                old.departmentId === division.departmentId,
            ),
        );
        await this.checkDivisions(transaction, added);
        await transaction
          .updateTable('staff')
          .set(columnsOf(record))
          .where('id', '=', id)
          .execute();
        await this.writeDivisions(transaction, id, divisions, record.divisions);
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId,
          personId: id,
          action: 'staff.edit',
          record: { type: 'staff', id },
          oldValue: changes.oldValue,
          newValue: changes.newValue,
          requestId,
        });
        return this.readDetail(transaction, access, id);
      }),
    );
  }

  /** Subjects with the grades taught and the languages of instruction (`04`; edge, Who can act). */
  teaching(
    access: Access,
    id: string,
    teaching: StaffTeaching,
    requestId: string,
  ): Promise<StaffDetail> {
    const branchId = branchOf(access);
    return this.refusing(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        await this.lockPerson(transaction, id);
        const before = await this.teachingOf(transaction, id);
        const after = {
          subjects: [...teaching.subjects].sort((a, b) => a.subjectId.localeCompare(b.subjectId)),
          languages: [...teaching.languages].sort(),
        };
        const changes = changesOf({ ...before }, { ...after });
        if (changes === null) {
          return this.readDetail(transaction, access, id);
        }
        const added = after.subjects.filter(
          (subject) => !before.subjects.some((old) => old.subjectId === subject.subjectId),
        );
        // FOR SHARE: a subject edit at the same moment locks the subject FOR
        // UPDATE and then asks who teaches it (`refuseTeachersOutside`).
        for (const subject of after.subjects) {
          const found = await transaction
            .selectFrom('subjects')
            .select(['archived_at'])
            .where('id', '=', subject.subjectId)
            .forShare()
            .executeTakeFirst();
          if (found === undefined) {
            throw notFound();
          }
          if (found.archived_at !== null && added.includes(subject)) {
            throw refused('subject_archived');
          }
        }
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
        for (const subject of added) {
          await transaction
            .insertInto('staff_subjects')
            .values({ staff_id: id, subject_id: subject.subjectId, grades: subject.grades })
            .execute();
        }
        for (const language of after.languages.filter((l) => !before.languages.includes(l))) {
          await transaction
            .insertInto('staff_languages')
            .values({ staff_id: id, language })
            .execute();
        }
        for (const language of before.languages.filter((l) => !after.languages.includes(l))) {
          await transaction
            .deleteFrom('staff_languages')
            .where('staff_id', '=', id)
            .where('language', '=', language)
            .execute();
        }
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          personId: id,
          action: 'staff.teaching',
          record: { type: 'staff', id },
          oldValue: changes.oldValue,
          newValue: changes.newValue,
          requestId,
        });
        return this.readDetail(transaction, access, id);
      }),
    );
  }

  /**
   * The main and further branches of a person: the Super Admin only, decided
   * from every current assignment. The links of other branches are rows of
   * those branches, so this route runs with every branch (decision 18, as the
   * Super Admin "Sees all branches", `02`); the record must be linked to the
   * branch of the request, and every branch named must exist.
   */
  setBranches(
    access: Access,
    id: string,
    branches: StaffBranches,
    requestId: string,
  ): Promise<StaffDetail> {
    const branchId = branchOf(access);
    const superAdmin = superAdminOf(access);
    if (superAdmin === undefined) {
      throw new ApiException('permission_denied', 403);
    }
    return this.refusing(async () => {
      const every = await this.readingBranches(access);
      const named = [branches.mainBranchId, ...branches.furtherBranchIds];
      if (named.some((branch) => !every.includes(branch))) {
        throw notFound();
      }
      return this.transactions.run(every, async (transaction) => {
        await this.lockLinked(transaction, id, branchId);
        const links = await transaction
          .selectFrom('staff_branches')
          .select(['branch_id', 'is_main'])
          .where('staff_id', '=', id)
          .orderBy('branch_id')
          .forUpdate()
          .execute();
        const before = {
          mainBranchId: links.find((link) => link.is_main)?.branch_id ?? null,
          furtherBranchIds: links.filter((link) => !link.is_main).map((link) => link.branch_id),
        };
        const after = {
          mainBranchId: branches.mainBranchId,
          furtherBranchIds: [...branches.furtherBranchIds].sort(),
        };
        const changes = changesOf({ ...before }, { ...after });
        if (changes !== null) {
          // The old main one first, so that the index of one main branch holds after each statement.
          await transaction
            .updateTable('staff_branches')
            .set({ is_main: false })
            .where('staff_id', '=', id)
            .where('is_main', '=', true)
            .where('branch_id', '<>', after.mainBranchId)
            .execute();
          await transaction
            .deleteFrom('staff_branches')
            .where('staff_id', '=', id)
            .where('branch_id', 'not in', named)
            .execute();
          for (const branch of named) {
            const main = branch === after.mainBranchId;
            const link = links.find((old) => old.branch_id === branch);
            if (link === undefined) {
              await transaction
                .insertInto('staff_branches')
                .values({ staff_id: id, branch_id: branch, is_main: main })
                .execute();
            } else if (main && !link.is_main) {
              await transaction
                .updateTable('staff_branches')
                .set({ is_main: true })
                .where('staff_id', '=', id)
                .where('branch_id', '=', branch)
                .execute();
            }
          }
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: superAdmin,
            personId: id,
            action: 'staff.branches',
            record: { type: 'staff', id },
            oldValue: changes.oldValue,
            newValue: changes.newValue,
            requestId,
          });
        }
        return this.readDetail(transaction, access, id);
      });
    });
  }

  /**
   * A status from a date, today or later in the main branch's time zone
   * (decision 4): the Super Admin only. A change planned after today is taken
   * back (its range made empty) and replaced; no row grows (correction 6).
   * `left` ends the roles of the linked account at 00:00 of its date, each at
   * its own start when that is later, and keeps the ends it replaced; taking
   * a planned `left` back puts them back (decision 15). Nobody sets their own
   * record to inactive or left (correction 5).
   */
  setStatus(
    access: Access,
    id: string,
    change: StaffStatusChange,
    requestId: string,
  ): Promise<StaffDetail> {
    const branchId = branchOf(access);
    const superAdmin = superAdminOf(access);
    if (superAdmin === undefined) {
      throw new ApiException('permission_denied', 403);
    }
    return this.refusing(async () => {
      const every = await this.readingBranches(access);
      return this.transactions.run(every, async (transaction) => {
        const row = await this.lockLinked(transaction, id, branchId);
        if (row.account_id === access.accountId && change.status !== 'active') {
          throw refused('own_status');
        }
        const main = await transaction
          .selectFrom('staff_branches')
          .innerJoin('branches', 'branches.id', 'staff_branches.branch_id')
          .select('branches.time_zone')
          .where('staff_branches.staff_id', '=', id)
          .where('staff_branches.is_main', '=', true)
          .executeTakeFirstOrThrow();
        const today = schoolDateOf(this.clock.now(), main.time_zone);
        const rows: StoredStatusRow[] = (
          await transaction
            .selectFrom('staff_statuses')
            .select(['id', 'status', 'valid_from', 'valid_until'])
            .where('staff_id', '=', id)
            .orderBy('valid_from')
            .orderBy('id')
            .forUpdate()
            .execute()
        ).map((stored) => ({
          id: stored.id,
          status: stored.status as StaffStatus,
          validFrom: stored.valid_from,
          validUntil: stored.valid_until,
        }));
        const plan = planStatusChange(rows, change, today);
        if ('refusal' in plan) {
          throw refused(plan.refusal);
        }
        for (const cut of plan.cuts) {
          await transaction
            .updateTable('staff_statuses')
            .set({ valid_until: cut.validUntil })
            .where('id', '=', cut.id)
            .execute();
        }
        const inserted: { id: string; status: StaffStatus; validFrom: string }[] = [];
        for (const write of plan.writes) {
          const written = await transaction
            .insertInto('staff_statuses')
            .values({
              staff_id: id,
              status: write.status,
              valid_from: write.validFrom,
              valid_until: write.validUntil,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          inserted.push({ id: written.id, status: write.status, validFrom: write.validFrom });
        }
        // Taken-back `left` rows give their roles back.
        for (const withdrawn of plan.withdrawn.filter((taken) => taken.status === 'left')) {
          await this.restoreRoleEnds(transaction, access, superAdmin, {
            staffId: id,
            statusId: withdrawn.id,
            dateStart: await startOfDate(transaction, withdrawn.validFrom, main.time_zone),
            requestId,
          });
        }
        const left = inserted.find((written) => written.status === 'left');
        if (left !== undefined && row.account_id !== null) {
          await this.endRoles(transaction, access, superAdmin, {
            staffId: id,
            accountId: row.account_id,
            statusId: left.id,
            dateStart: await startOfDate(transaction, left.validFrom, main.time_zone),
            requestId,
          });
        }
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: superAdmin,
          personId: id,
          action: 'staff.status',
          record: { type: 'staff', id },
          oldValue: { statuses: rows.map(statusValue) },
          newValue: { status: change.status, from: change.from },
          details: {
            cut: plan.cuts.map((cut) => cut.id),
            withdrawn: plan.withdrawn.map((taken) => taken.id),
            written: inserted.map((written) => written.id),
          },
          requestId,
        });
        return this.readDetail(transaction, access, id);
      });
    });
  }

  /**
   * The identity fields for a reader who sees them hidden, the Principal
   * (decision 9; edge, Personal data: "the Principal sees them hidden, with a
   * logged show"). Every show is an audit entry.
   */
  identity(access: Access, id: string, requestId: string): Promise<StaffIdentity> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const row = await this.readPerson(transaction, id);
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        personId: id,
        action: 'staff.identity_shown',
        record: { type: 'staff', id },
        requestId,
      });
      return { birthDate: text(row.birth_date), jshshir: row.jshshir };
    });
  }

  // ---------------------------------------------------------------------------

  private refusing<T>(work: () => Promise<T>): Promise<T> {
    return refusingDuplicates(() => refusingConstraints(work, STAFF_REFUSALS), STAFF_UNIQUE_FIELDS);
  }

  /** A record as `fieldsOf` reads it, for the audit entry of a create. */
  private rowOf(record: StaffRecord): StaffRow {
    return {
      id: '',
      staff_id: null,
      account_id: null,
      ...columnsOf(record),
    };
  }

  private async readPerson(transaction: Transaction, id: string): Promise<StaffRow> {
    const row = await transaction
      .selectFrom('staff')
      .select(STAFF_COLUMNS)
      .where('id', '=', id)
      .where('kind', '=', 'person')
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return row;
  }

  /** The record, locked; 404 when it is not visible in the branch of the request. */
  private async lockPerson(transaction: Transaction, id: string): Promise<StaffRow> {
    const row = await transaction
      .selectFrom('staff')
      .select(STAFF_COLUMNS)
      .where('id', '=', id)
      .where('kind', '=', 'person')
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return row;
  }

  /**
   * The record, locked, for a route that reads with every branch: 404 unless
   * it is linked to the branch of the request, as for every other reader.
   */
  private async lockLinked(
    transaction: Transaction,
    id: string,
    branchId: string,
  ): Promise<StaffRow> {
    const linked = await transaction
      .selectFrom('staff_branches')
      .select('staff_id')
      .where('staff_id', '=', id)
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (linked === undefined) {
      throw notFound();
    }
    return this.lockPerson(transaction, id);
  }

  /**
   * Each named division and department, read FOR SHARE: an archive at the same
   * moment locks it FOR UPDATE and then asks who is in it, so one of the two
   * waits for the other (finding 4 of the spec review). An unknown id is 404,
   * an archived one refused.
   */
  private async checkDivisions(transaction: Transaction, divisions: StaffDivisions): Promise<void> {
    for (const division of divisions) {
      const found = await transaction
        .selectFrom('divisions')
        .select(['archived_at'])
        .where('id', '=', division.divisionId)
        .forShare()
        .executeTakeFirst();
      if (found === undefined) {
        throw notFound();
      }
      if (found.archived_at !== null) {
        throw refused('division_archived');
      }
      if (division.departmentId !== null) {
        const department = await transaction
          .selectFrom('departments')
          .select(['archived_at', 'division_id'])
          .where('id', '=', division.departmentId)
          .forShare()
          .executeTakeFirst();
        if (department === undefined || department.division_id !== division.divisionId) {
          throw notFound();
        }
        if (department.archived_at !== null) {
          throw refused('department_archived');
        }
      }
    }
  }

  private async divisionsOf(transaction: Transaction, id: string): Promise<StaffDivisions> {
    return (
      await transaction
        .selectFrom('staff_divisions')
        .select(['division_id', 'department_id', 'is_main'])
        .where('staff_id', '=', id)
        .execute()
    ).map((row) => ({
      divisionId: row.division_id,
      departmentId: row.department_id,
      main: row.is_main,
    }));
  }

  /** Writes the divisions of a record from what it had to what is asked; the main one moves last. */
  private async writeDivisions(
    transaction: Transaction,
    id: string,
    before: StaffDivisions,
    after: StaffDivisions,
  ): Promise<void> {
    for (const old of before) {
      const kept = after.find((division) => division.divisionId === old.divisionId);
      if (kept === undefined) {
        await transaction
          .deleteFrom('staff_divisions')
          .where('staff_id', '=', id)
          .where('division_id', '=', old.divisionId)
          .execute();
      } else if (old.main && !kept.main) {
        await transaction
          .updateTable('staff_divisions')
          .set({ is_main: false, department_id: kept.departmentId })
          .where('staff_id', '=', id)
          .where('division_id', '=', old.divisionId)
          .execute();
      }
    }
    for (const division of after) {
      const old = before.find((row) => row.divisionId === division.divisionId);
      if (old === undefined) {
        await transaction
          .insertInto('staff_divisions')
          .values({
            staff_id: id,
            division_id: division.divisionId,
            department_id: division.departmentId,
            is_main: division.main,
          })
          .execute();
      } else if (
        old.main === division.main ? old.departmentId !== division.departmentId : division.main
      ) {
        await transaction
          .updateTable('staff_divisions')
          .set({ is_main: division.main, department_id: division.departmentId })
          .where('staff_id', '=', id)
          .where('division_id', '=', division.divisionId)
          .execute();
      }
    }
  }

  private async teachingOf(
    transaction: Transaction,
    id: string,
  ): Promise<{
    subjects: { subjectId: string; grades: number[] }[];
    languages: InstructionLanguage[];
  }> {
    const subjects = await transaction
      .selectFrom('staff_subjects')
      .select(['subject_id', 'grades'])
      .where('staff_id', '=', id)
      .orderBy('subject_id')
      .execute();
    const languages = await transaction
      .selectFrom('staff_languages')
      .select('language')
      .where('staff_id', '=', id)
      .orderBy('language')
      .execute();
    return {
      subjects: subjects.map((row) => ({ subjectId: row.subject_id, grades: row.grades })),
      languages: languages.map((row) => row.language as InstructionLanguage),
    };
  }

  /**
   * Ends the roles of the account at `end`, each at its own start when that is
   * later; an assignment that already ends earlier keeps its end
   * (correction 4). The end each had is kept to put it back.
   */
  private async endRoles(
    transaction: Transaction,
    access: Access,
    superAdmin: string,
    left: {
      staffId: string;
      accountId: string;
      statusId: string;
      dateStart: Date;
      requestId: string;
    },
  ): Promise<void> {
    const assignments = await transaction
      .selectFrom('assignments')
      .select(['id', 'valid_from', 'valid_until', 'ended_by', 'branch_id'])
      .where('account_id', '=', left.accountId)
      .where((builder) =>
        builder.or([
          builder('valid_until', 'is', null),
          builder('valid_until', '>', left.dateStart),
        ]),
      )
      .orderBy('id')
      .forUpdate()
      .execute();
    for (const assignment of assignments) {
      const end = roleEndFor(assignment.valid_from, left.dateStart);
      if (assignment.valid_until !== null && assignment.valid_until <= end) {
        // It already ends at its own start or earlier: it keeps its end.
        continue;
      }
      await transaction
        .insertInto('staff_status_role_ends')
        .values({
          status_id: left.statusId,
          staff_id: left.staffId,
          assignment_id: assignment.id,
          previous_valid_until: assignment.valid_until,
          previous_ended_by: assignment.ended_by,
        })
        .execute();
      await transaction
        .updateTable('assignments')
        .set({ valid_until: end, ended_by: access.accountId })
        .where('id', '=', assignment.id)
        .execute();
      await this.audit.record(transaction, {
        branchId: assignment.branch_id,
        actorId: access.accountId,
        assignmentId: superAdmin,
        personId: left.staffId,
        action: 'assignment.end',
        record: { type: 'assignment', id: assignment.id },
        oldValue: { validUntil: assignment.valid_until?.toISOString() ?? null },
        newValue: { validUntil: end.toISOString() },
        reason: 'staff_left',
        requestId: left.requestId,
      });
    }
  }

  /**
   * Puts back the ends a taken-back `left` row wrote (decision 15), where the
   * assignment still has the end that row gave it.
   */
  private async restoreRoleEnds(
    transaction: Transaction,
    access: Access,
    superAdmin: string,
    taken: { staffId: string; statusId: string; dateStart: Date; requestId: string },
  ): Promise<void> {
    const { staffId, statusId, requestId } = taken;
    const ends = await transaction
      .selectFrom('staff_status_role_ends')
      .innerJoin('assignments', 'assignments.id', 'staff_status_role_ends.assignment_id')
      .select([
        'assignments.id',
        'assignments.branch_id',
        'assignments.valid_until',
        'assignments.ended_by',
        'assignments.valid_from',
        'staff_status_role_ends.previous_valid_until',
        'staff_status_role_ends.previous_ended_by',
      ])
      .where('staff_status_role_ends.status_id', '=', statusId)
      .orderBy('assignments.id')
      .forUpdate('assignments')
      .execute();
    for (const end of ends) {
      // Only an end this row wrote and nobody changed since.
      const written = roleEndFor(end.valid_from, taken.dateStart);
      if (end.valid_until?.getTime() !== written.getTime()) {
        continue;
      }
      await transaction
        .updateTable('assignments')
        .set({ valid_until: end.previous_valid_until, ended_by: end.previous_ended_by })
        .where('id', '=', end.id)
        .execute();
      await this.audit.record(transaction, {
        branchId: end.branch_id,
        actorId: access.accountId,
        assignmentId: superAdmin,
        personId: staffId,
        action: 'assignment.end_withdrawn',
        record: { type: 'assignment', id: end.id },
        oldValue: { validUntil: end.valid_until?.toISOString() ?? null },
        newValue: { validUntil: end.previous_valid_until?.toISOString() ?? null },
        reason: 'staff_left_withdrawn',
        requestId,
      });
    }
  }

  /** The list rows of the given records, in one read per table. */
  private async items(transaction: Transaction, ids: readonly string[]): Promise<StaffListItem[]> {
    if (ids.length === 0) {
      return [];
    }
    const list = [...ids];
    const rows = await transaction
      .selectFrom('staff')
      .select(STAFF_COLUMNS)
      .where('id', 'in', list)
      .execute();
    const links = await transaction
      .selectFrom('staff_branches')
      .innerJoin('branches', 'branches.id', 'staff_branches.branch_id')
      .select([
        'staff_branches.staff_id',
        'staff_branches.branch_id',
        'staff_branches.is_main',
        'branches.name',
        'branches.time_zone',
      ])
      .where('staff_branches.staff_id', 'in', list)
      .orderBy('staff_branches.is_main', 'desc')
      .orderBy('branches.name')
      .execute();
    const divisions = await transaction
      .selectFrom('staff_divisions')
      .select(['staff_id', 'division_id', 'department_id', 'is_main'])
      .where('staff_id', 'in', list)
      .orderBy('is_main', 'desc')
      .orderBy('division_id')
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
      .select(['staff_id', 'status', 'valid_from', 'valid_until'])
      .where('staff_id', 'in', list)
      .whereRef('valid_until', 'is distinct from', 'valid_from')
      .orderBy('valid_from')
      .execute();
    const now = this.clock.now();
    const categories = new Map<string, Role[]>();
    for (const row of rows) {
      if (row.account_id !== null) {
        const roles = (await currentAssignments(transaction, row.account_id, now))
          .map((assignment) => assignment.role)
          .filter((role) => (STAFF_CATEGORY_ROLES as readonly Role[]).includes(role));
        categories.set(row.id, [...new Set(roles)]);
      }
    }
    return rows.map((row) => {
      const own = links.filter((link) => link.staff_id === row.id);
      // Today in the main branch's time zone; a reader who does not see the
      // main branch reads it in the zone of the branch it sees.
      const zone = (own.find((link) => link.is_main) ?? own[0])?.time_zone ?? 'Asia/Tashkent';
      const today = schoolDateOf(now, zone);
      const history = statuses.filter((status) => status.staff_id === row.id);
      const current = history.find(
        (status) =>
          status.valid_from <= today && (status.valid_until === null || status.valid_until > today),
      );
      const planned = history.find((status) => status.valid_from > today);
      return {
        id: row.id,
        staffId: text(row.staff_id),
        firstName: text(row.first_name),
        lastName: text(row.last_name),
        fatherName: row.father_name,
        categories: categories.get(row.id) ?? [],
        branches: own.map((link) => ({
          branchId: link.branch_id,
          name: link.name,
          main: link.is_main,
        })),
        divisions: divisions
          .filter((division) => division.staff_id === row.id)
          .map((division) => ({
            divisionId: division.division_id,
            departmentId: division.department_id,
            main: division.is_main,
          })),
        subjects: subjects
          .filter((subject) => subject.staff_id === row.id)
          .map((subject) => ({ subjectId: subject.subject_id, grades: subject.grades })),
        languages: languages
          .filter((language) => language.staff_id === row.id)
          .map((language) => language.language as InstructionLanguage),
        phone: text(row.phone),
        status: (current?.status as StaffStatus | undefined) ?? null,
        planned:
          planned === undefined
            ? null
            : { status: planned.status as StaffStatus, from: planned.valid_from },
      };
    });
  }

  private async readDetail(
    transaction: Transaction,
    access: Access,
    id: string,
  ): Promise<StaffDetail> {
    const branchId = branchOf(access);
    const linked = await transaction
      .selectFrom('staff_branches')
      .select('staff_id')
      .where('staff_id', '=', id)
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (linked === undefined) {
      throw notFound();
    }
    const row = await this.readPerson(transaction, id);
    const [item] = await this.items(transaction, [id]);
    if (item === undefined) {
      throw notFound();
    }
    const statuses = await transaction
      .selectFrom('staff_statuses')
      .select(['id', 'status', 'valid_from', 'valid_until'])
      .where('staff_id', '=', id)
      .whereRef('valid_until', 'is distinct from', 'valid_from')
      .orderBy('valid_from')
      .execute();
    const rights: StaffRights = {
      all: superAdminOf(access) !== undefined,
      contact: superAdminOf(access) !== undefined || viceOf(access) !== undefined,
      teaching: superAdminOf(access) !== undefined || viceOf(access) !== undefined,
    };
    // Identity fields: the Super Admin and the Academic Vice Principal; hidden
    // for the Principal, who has a logged show (decision 9).
    const identityHidden = !rights.contact;
    return {
      ...item,
      sex: row.sex as Sex,
      birthDate: identityHidden ? null : row.birth_date,
      jshshir: identityHidden ? null : row.jshshir,
      identityHidden,
      educationLevel: row.education_level as EducationLevel | null,
      email: row.email,
      admissionDate: text(row.admission_date),
      contractType: row.contract_type as ContractType | null,
      contractDate: row.contract_date,
      weeklyLessons: row.weekly_lessons,
      dailyLessons: row.daily_lessons,
      statuses: statuses.map((status) => ({
        id: status.id,
        status: status.status as StaffStatus,
        from: status.valid_from,
        until: status.valid_until,
      })),
      rights,
      today: await this.todayIn(transaction, branchId),
    };
  }
}

const STAFF_COLUMNS = [
  'id',
  'staff_id',
  'account_id',
  'first_name',
  'last_name',
  'father_name',
  'sex',
  'birth_date',
  'education_level',
  'phone',
  'email',
  'jshshir',
  'admission_date',
  'contract_type',
  'contract_date',
  'weekly_lessons',
  'daily_lessons',
] as const;

const statusValue = (row: StoredStatusRow) => ({
  status: row.status,
  from: row.validFrom,
  until: row.validUntil,
});
