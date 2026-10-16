import { Injectable } from '@nestjs/common';
import {
  PERMISSIONS,
  schoolDateOf,
  studentNameKey,
  uidOutsideSet,
  uidSetFor,
  uidYearOf,
  type DocumentType,
  type ErrorDetail,
  type Region,
  type SchoolDate,
  type ScholarshipCoverage,
  type ScholarshipType,
  type Sex,
  type StudentCheck,
  type StudentCheckResult,
  type StudentClass,
  type StudentCreate,
  type StudentDetail,
  type StudentIdentity,
  type StudentList,
  type StudentListItem,
  type StudentListQuery,
  type StudentNoClass,
  type StudentRecord,
  type StatusCause,
  type StudentStatus,
  type StudentUidCorrection,
} from '@sodiq/shared';
import { sql, type RawBuilder } from 'kysely';
import { transactionMoment, Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import {
  listsBranchStudents,
  NO_PLACES,
  readsAsTeacherOnly,
  studentPlaces,
  studentReaderOf,
  type StudentPlaces,
} from '../access/class-scope.js';
import { decide } from '../access/permission-check.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import {
  CLASS_GROUP_REFUSALS,
  coverClassRows,
  lockPlacementGroups,
} from '../classes/class-groups.js';
import {
  classesInService,
  studentVersion,
  versionCounts,
  membershipsOf,
  MEMBERSHIP_REFUSALS,
  studentClassesOn,
  tutorsInForce,
} from '../classes/class-membership-rows.js';
import { studentGroupsOn } from '../classes/group-membership-rows.js';
import { cancelledOf, moveSummaries, movesOf, pastMoverOf } from '../classes/student-moves.js';
import { inGroupScope } from '../access/group-scope.js';
import { permitting } from '../access/permission-check.js';
import {
  lockPlacementStudents,
  planPlacement,
  readPlacementClass,
  writePlacement,
} from '../classes/class-placement.js';
import { changesOf, notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { refusingRelativeRaces, RelativeWrites } from './relative-writes.js';
import { exportGroupsOf } from './student-export.js';
import { classLeft } from './return-class.js';
import { branchMoveState, branchMovesOf, branchNames, summaryOf } from './branch-moves.js';
import {
  historyLines,
  holdsData,
  plannedAfter,
  type StoredStudentStatus,
} from './student-status.js';

const UNIQUE_VIOLATION = '23505';

/**
 * The unique indexes across the school (db/migrations/0032; decision 17 of
 * pull request #67) and the field each refuses. A UID once held is in
 * `student_uids` for good (decision 7), so its key refuses a UID too.
 */
const TAKEN_FIELDS: Readonly<
  Record<string, 'uid' | 'jshshir' | 'documentNumber' | 'contract.number'>
> = {
  students_uid_idx: 'uid',
  student_uids_pkey: 'uid',
  students_jshshir_idx: 'jshshir',
  students_document_idx: 'documentNumber',
  student_contracts_number_idx: 'contract.number',
};

/** A value refused as taken, with what the holder is looked up by. */
interface Taken {
  path: (typeof TAKEN_FIELDS)[string];
  value: string;
}

export class TakenValue extends Error {
  constructor(readonly taken: Taken) {
    super('A value of the student is taken.');
  }
}

export interface StudentRow {
  id: string;
  uid: string;
  first_name: string;
  last_name: string;
  paternal_name: string | null;
  sex: string;
  birth_date: string;
  grade: number;
  starts_on: string;
  document_type: string | null;
  document_number: string | null;
  jshshir: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  region: string | null;
  previous_school: string | null;
  diagnostic_score: number | null;
  scholarship_type: string;
  scholarship_coverage: string | null;
  scholarship_amount: number | null;
  consent_signed_on: string | null;
  photo_id: string | null;
  photo_type: string | null;
}

const STUDENT_COLUMNS = [
  'id',
  'uid',
  'first_name',
  'last_name',
  'paternal_name',
  'sex',
  'birth_date',
  'grade',
  'starts_on',
  'document_type',
  'document_number',
  'jshshir',
  'phone',
  'email',
  'address',
  'region',
  'previous_school',
  'diagnostic_score',
  'scholarship_type',
  'scholarship_coverage',
  'scholarship_amount',
  'consent_signed_on',
  'photo_id',
  'photo_type',
] as const;

/** The columns an edit writes, from what was typed. */
const columnsOf = (record: StudentRecord) => ({
  first_name: record.firstName,
  last_name: record.lastName,
  paternal_name: record.paternalName,
  name_key: studentNameKey(record.lastName, record.firstName),
  sex: record.sex,
  birth_date: record.birthDate,
  grade: record.grade,
  document_type: record.documentType,
  document_number: record.documentNumber,
  jshshir: record.jshshir,
  phone: record.phone,
  email: record.email,
  address: record.address,
  region: record.region,
  previous_school: record.previousSchool,
  diagnostic_score: record.diagnosticScore,
  scholarship_type: record.scholarship.type,
  scholarship_coverage: record.scholarship.coverage,
  scholarship_amount: record.scholarship.amount,
  consent_signed_on: record.consentSignedOn,
});

/** The fields of a stored record as the edit and the audit entries compare them. */
function fieldsOf(row: StudentRow, contract: { number: string; signed_on: string }): StudentRecord {
  return {
    firstName: row.first_name,
    lastName: row.last_name,
    paternalName: row.paternal_name,
    sex: row.sex as Sex,
    birthDate: row.birth_date,
    grade: row.grade,
    documentType: row.document_type as DocumentType | null,
    documentNumber: row.document_number,
    jshshir: row.jshshir,
    phone: row.phone,
    email: row.email,
    address: row.address,
    region: row.region as Region | null,
    previousSchool: row.previous_school,
    diagnosticScore: row.diagnostic_score,
    scholarship: {
      type: row.scholarship_type as ScholarshipType,
      coverage: row.scholarship_coverage as ScholarshipCoverage | null,
      amount: row.scholarship_amount,
    },
    consentSignedOn: row.consent_signed_on,
    contract: { number: contract.number, signedOn: contract.signed_on },
  };
}

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('A student route works for the branch of the request.');
  }
  return access.branchId;
}

const refused = (code: 'no_academic_year'): ApiException => new ApiException(code, 409);

/**
 * The assignment that lets the account read a group of fields in the branch
 * of the request, for a student of `places` (task 3.1c: a Tutor reads the
 * groups of own classes only; task 3.6a: a Teacher the students taught,
 * `class-scope.ts`). With no place given (the list, a show), only a
 * class-wide reader counts.
 */
const readerOf = (
  access: Access,
  area: string,
  places: StudentPlaces = NO_PLACES,
): string | undefined => studentReaderOf(access, area, places)?.id;

/**
 * The status of a student on a date: the row in force, or before the start
 * date the first row, which is `active` (edge/students-classes-groups, "A
 * student is enrolled in August before classes are formed": an active student
 * before their start date; spec review of the build). A withdrawn row (empty
 * range) never counts.
 */
/**
 * The status of a student on a school date: its first status row not ended
 * by then. One fragment for the student list and the relatives with no valid
 * phone (task 2.5b-1), so the two never drift apart.
 */
export const statusOfStudentOn = (student: RawBuilder<unknown>, date: SchoolDate) =>
  sql<string | null>`(
    select ss.status from student_statuses ss
    where ss.student_id = ${student}
      and coalesce(ss.valid_until, 'infinity'::date) > ${date}::date
      and ss.valid_from < coalesce(ss.valid_until, 'infinity'::date)
    order by ss.valid_from
    limit 1
  )`;

const statusOn = (date: SchoolDate) => statusOfStudentOn(sql.ref('students.id'), date).as('status');

/** The assignment that lets the account leave, return and delete students in the branch of the request. */
export const archiverOf = (access: Access): string | undefined =>
  decide(
    { area: 'students', action: 'archive', branch: 'request' },
    access.assignments,
    access.branchId,
    PERMISSIONS,
  )?.id;

/** A current Principal assignment of the account in the branch of the request. */
const principalOf = (access: Access): string | undefined =>
  access.assignments.find(
    (assignment) => assignment.role === 'principal' && assignment.branchId === access.branchId,
  )?.id;

/**
 * Student records (docs/spec/04-people.md, Student record, UID sets; task
 * 2.4a, pull request #67). A student belongs to the branch of the request:
 * every route works in it, and another branch's student is 404. Reading a
 * student returns only the groups of fields its reader may see
 * (edge/people-roles-accounts, Personal data and the audit log; decisions 2
 * and 4), decided from every current assignment. Every change writes its audit
 * entry in its transaction. Lock order: the student, then its newest
 * contract.
 */
@Injectable()
export class Students {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly relatives: RelativeWrites,
  ) {}

  /** Today in the time zone of the branch, at the moment of the transaction. */
  async todayIn(transaction: Transaction, branchId: string): Promise<SchoolDate> {
    const branch = await transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    return schoolDateOf(await transactionMoment(transaction), branch.time_zone);
  }

  /**
   * The students of the branch of the request: the Basic group and the status
   * today, the photo, and for a Financial reader whether consent is missing.
   * `consent: 'missing'` keeps the active students without consent (answer
   * 23); a reader without the Financial group is refused it (correction 1 of
   * the review of pull request #70: the filter is checked here, not only
   * hidden on the screen).
   */
  list(access: Access, query: StudentListQuery = {}): Promise<StudentList> {
    const branchId = branchOf(access);
    const readsFinancial = readerOf(access, 'student_financial') !== undefined;
    if (query.consent !== undefined && !readsFinancial) {
      throw new ApiException('permission_denied', 403);
    }
    return this.transactions.run(access.branchIds, async (transaction) => {
      const today = await this.todayIn(transaction, branchId);
      const all = await this.listItems(transaction, access, branchId, today);
      const students =
        query.consent === 'missing'
          ? all.filter((student) => student.status === 'active' && student.consentMissing === true)
          : all;
      return {
        students,
        canArchive: archiverOf(access) !== undefined,
        exportGroups: [...exportGroupsOf(access).keys()],
        readsFinancial,
        today,
      };
    });
  }

  /** The list's rows of the branch as the list answers them, by surname, first name and UID. */
  async listItems(
    transaction: Transaction,
    access: Access,
    branchId: string,
    today: SchoolDate,
  ): Promise<StudentListItem[]> {
    const readsFinancial = readerOf(access, 'student_financial') !== undefined;
    const rows = await transaction
      .selectFrom('students')
      .select([
        'students.id',
        'students.uid',
        'students.first_name',
        'students.last_name',
        'students.paternal_name',
        'students.sex',
        'students.grade',
        'students.starts_on',
        'students.photo_id',
        'students.consent_signed_on',
        statusOn(today),
      ])
      .where('students.branch_id', '=', branchId)
      .orderBy('students.last_name')
      .orderBy('students.first_name')
      .orderBy('students.uid')
      .execute();
    const statuses = await this.statusRowsOf(transaction, null);
    const counts = await versionCounts(transaction, null);
    const classes = await studentClassesOn(transaction, today, null);
    const tutors = await tutorsInForce(transaction);
    const groups = await studentGroupsOn(transaction, today, null);
    // One rule with the record (decision 8 of pull request #90): a row opens
    // when the record would be answered to this reader.
    const scope = await studentPlaces(transaction, today, null);
    const merged = await this.mergedUidsByStudent(transaction);
    // A Teacher alone lists the students taught and no other (task 3.6a, L48,
    // decision 12 of pull request #118).
    const listsBranch = listsBranchStudents(access);
    return rows.flatMap((row) => {
      const places = scope.get(row.id) ?? NO_PLACES;
      const opens = readerOf(access, 'students', places) !== undefined;
      if (!listsBranch && !opens) {
        return [];
      }
      // A Teacher-only reader of the row: the Basic group, the groups, the
      // status today and the start date (decision 14, correction 3).
      const basicOnly = readsAsTeacherOnly(access, places);
      const own = statuses.get(row.id) ?? [];
      const held = classes.get(row.id);
      const current = held?.current ?? null;
      const tutor = current === null || basicOnly ? undefined : tutors.get(current.id);
      return {
        id: row.id,
        uid: row.uid,
        mergedUids: basicOnly ? [] : (merged.get(row.id) ?? []),
        firstName: row.first_name,
        lastName: row.last_name,
        paternalName: row.paternal_name,
        sex: row.sex as Sex,
        grade: row.grade,
        startsOn: row.starts_on,
        photoId: row.photo_id,
        consentMissing: readsFinancial ? row.consent_signed_on === null : null,
        status: row.status as StudentStatus | null,
        planned: basicOnly ? null : plannedAfter(own, today),
        class: current,
        plannedClass: basicOnly ? null : (held?.planned ?? null),
        tutor: tutor?.tutor ?? null,
        actingTutor: tutor?.acting ?? null,
        // Groups on every row for every reader (task 3.6a, owner's answer
        // L147; was the opened rows only, decision 4 of pull request #92).
        groups: groups.get(row.id) ?? [],
        version: studentVersion(own.length, counts, row.id),
        opens,
      };
    });
  }

  /**
   * The counter of the Academic Vice Principal's home page (edge: "An active
   * student with no class ... in a counter"; decision 9): the students of the
   * branch active today, before the start date included, with no class in
   * force today and none planned (task 3.1b; should-fix 8 of the plan review).
   */
  noClass(access: Access): Promise<StudentNoClass> {
    const branchId = branchOf(access);
    // The counter is of the whole branch: refused to a Teacher alone (task
    // 3.6a, decision 12 of pull request #118).
    if (!listsBranchStudents(access)) {
      throw new ApiException('permission_denied', 403);
    }
    return this.transactions.run(access.branchIds, async (transaction) => {
      const today = await this.todayIn(transaction, branchId);
      const rows = await transaction
        .selectFrom('students')
        .select(['students.id', statusOn(today)])
        .where('students.branch_id', '=', branchId)
        .execute();
      const classes = await studentClassesOn(transaction, today, null);
      return {
        count: rows.filter((row) => row.status === 'active' && !classes.has(row.id)).length,
      };
    });
  }

  /**
   * The duplicate warning (edge: "A matching name and date of birth, compared
   * after removing spelling differences, gives a warning that must be
   * confirmed, so twins pass"): the matches of the branch of the request by
   * name, of other branches only whether one exists (decision 3).
   */
  check(access: Access, input: StudentCheck): Promise<StudentCheckResult> {
    const branchId = branchOf(access);
    const nameKey = studentNameKey(input.lastName, input.firstName);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const today = await this.todayIn(transaction, branchId);
      let query = transaction
        .selectFrom('students')
        .select([
          'students.id',
          'students.uid',
          'students.first_name',
          'students.last_name',
          statusOn(today),
        ])
        .where('students.name_key', '=', nameKey)
        .where('students.birth_date', '=', input.birthDate);
      if (input.studentId !== null) {
        // The record being edited is one of this branch (`.claude/rules/api.md`, ids in the body).
        await this.readStudent(transaction, input.studentId);
        query = query.where('students.id', '<>', input.studentId);
      }
      const rows = await query.orderBy('students.uid').execute();
      const elsewhere = await sql<{ found: boolean }>`
        select student_duplicate_elsewhere(${nameKey}, ${input.birthDate}::date) as found
      `.execute(transaction);
      return {
        sameNameAndBirth: rows.map((row) => ({
          id: row.id,
          uid: row.uid,
          firstName: row.first_name,
          lastName: row.last_name,
          status: row.status as StudentStatus | null,
        })),
        elsewhere: elsewhere.rows[0]?.found === true,
      };
    });
  }

  /**
   * A new student of the branch of the request (answer 17: the grade they
   * join and a start date). The UID is reserved in `student_uids` in the same
   * transaction (decision 7); the first contract, the first status row
   * (`active` from the start date) and the switched-off student account
   * (decision 9) are written with it, and its relatives, new or found by
   * phone (`04`, Close relatives: "A student cannot be saved without at
   * least one relative"; task 2.5a).
   */
  create(access: Access, input: StudentCreate, requestId: string): Promise<StudentDetail> {
    const branchId = branchOf(access);
    if (input.relatives.length === 0) {
      throw new ApiException('student_needs_relative', 422);
    }
    return this.refusingTaken(access, () =>
      this.relatives.refusingHeldPhone(access, () =>
        refusingRelativeRaces(() =>
          refusingConstraints(
            () =>
              this.transactions.run(access.branchIds, async (transaction) => {
                // Task 3.1b, decision 2: a student who starts today or earlier
                // joins a class on the start date; a class of another branch or
                // an unknown one is not found.
                const today = await this.todayIn(transaction, branchId);
                if (input.classId === null && input.startsOn <= today) {
                  throw new ApiException('student_needs_class', 422, undefined, [
                    {
                      path: 'classId',
                      code: 'student_needs_class',
                      message: 'A class is required.',
                    },
                  ]);
                }
                const placement =
                  input.classId === null
                    ? null
                    : await readPlacementClass(transaction, input.classId);
                if (placement === undefined) {
                  throw notFound();
                }
                await this.checkSet(
                  transaction,
                  branchId,
                  input.uid,
                  input.grade,
                  input.startsOn,
                  input,
                );
                const moment = await transactionMoment(transaction);
                const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
                const id = found.rows[0]?.id;
                if (id === undefined) {
                  throw new Error('No id for the new student.');
                }
                await this.inserting(
                  { uid: input.uid, jshshir: input.jshshir, documentNumber: input.documentNumber },
                  () =>
                    transaction
                      .insertInto('students')
                      .values({
                        id,
                        branch_id: branchId,
                        uid: input.uid,
                        starts_on: input.startsOn,
                        created_by: access.accountId,
                        ...columnsOf(input),
                      })
                      .execute(),
                );
                await this.inserting({ uid: input.uid }, () =>
                  transaction
                    .insertInto('student_uids')
                    .values({
                      uid: input.uid,
                      student_id: id,
                      branch_id: branchId,
                      held_from: moment,
                    })
                    .execute(),
                );
                await this.inserting({ 'contract.number': input.contract.number }, () =>
                  transaction
                    .insertInto('student_contracts')
                    .values({
                      student_id: id,
                      branch_id: branchId,
                      number: input.contract.number,
                      signed_on: input.contract.signedOn,
                    })
                    .execute(),
                );
                await transaction
                  .insertInto('student_statuses')
                  .values({
                    student_id: id,
                    branch_id: branchId,
                    status: 'active',
                    valid_from: input.startsOn,
                    cause: 'start',
                  })
                  .execute();
                await transaction
                  .insertInto('student_accounts')
                  .values({ student_id: id, branch_id: branchId, created_at: moment })
                  .execute();
                await this.audit.record(transaction, {
                  branchId,
                  actorId: access.accountId,
                  assignmentId: access.assignmentId,
                  action: 'student.create',
                  record: { type: 'student', id },
                  // Each relative and link has an entry of its own.
                  newValue: { ...input, confirmUidSet: undefined, relatives: undefined },
                  requestId,
                });
                if (placement !== null) {
                  const [student] = (await lockPlacementStudents(transaction, [id])).values();
                  if (student === undefined) {
                    throw new Error('The new student is not found.');
                  }
                  // Task 3.2c, decision 9: the class FOR UPDATE before its
                  // groups are read.
                  await classesInService(transaction, [placement.id]);
                  const rows = await planPlacement(
                    transaction,
                    placement,
                    [{ student, version: null }],
                    input.startsOn,
                  );
                  // Decision 9: every group the placement may touch, before its first write.
                  const groups = await lockPlacementGroups(transaction, [placement.id], [id]);
                  await writePlacement(
                    transaction,
                    this.audit,
                    access,
                    placement,
                    rows,
                    'create',
                    requestId,
                  );
                  // Task 3.2c: a group of every split or group subject of the
                  // class from the start date; the refusal names the class field.
                  await coverClassRows(
                    transaction,
                    this.audit,
                    access,
                    {
                      classRows: rows.map((row) => ({
                        index: 0,
                        row: {
                          studentId: row.studentId,
                          classId: placement.id,
                          from: row.from,
                          until: row.until,
                          ownUntil: placement.ownUntil,
                          leavingId: row.leavingId,
                        },
                      })),
                      giveBack: null,
                      groups,
                      pathOf: () => 'classId',
                    },
                    requestId,
                  );
                }
                // The relatives found by phone, and the earlier holders of a number
                // with a new owner, in the order of their id, then the new ones: the
                // lock order of the links (`relatives_follow_links`; task 2.5b-1).
                const lockedId = (link: (typeof input.relatives)[number]): string | null =>
                  link.kind === 'existing'
                    ? link.relativeId
                    : link.kind === 'new_owner'
                      ? link.previousId
                      : null;
                const links = input.relatives
                  .map((link, index) => ({ link, index, key: lockedId(link) }))
                  .sort((a, b) =>
                    a.key !== null && b.key !== null
                      ? a.key.localeCompare(b.key)
                      : a.key === null && b.key === null
                        ? a.index - b.index
                        : a.key !== null
                          ? -1
                          : 1,
                  );
                for (const { link, index } of links) {
                  await this.relatives.link(
                    transaction,
                    access,
                    id,
                    link,
                    `relatives.${String(index)}`,
                    requestId,
                  );
                }
                return this.readDetail(transaction, access, id);
              }),
            { ...MEMBERSHIP_REFUSALS, ...CLASS_GROUP_REFUSALS },
          ),
        ),
      ),
    );
  }

  /** One student of the branch of the request, with the groups its reader may see. */
  detail(access: Access, id: string): Promise<StudentDetail> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      // An unknown id or another branch's is 404 before the scope is looked
      // at (decision 9 of pull request #90).
      await this.readStudent(transaction, id);
      const today = await this.todayIn(transaction, branchId);
      const places = (await studentPlaces(transaction, today, id)).get(id) ?? NO_PLACES;
      if (readerOf(access, 'students', places) === undefined) {
        // `02`, Tutor: "the profiles of own class" (task 3.1c); Teacher: "the
        // students they teach" (task 3.6a).
        throw new ApiException('permission_denied', 403);
      }
      return this.readDetail(transaction, access, id);
    });
  }

  /**
   * Changes every field but the UID and the start date; the newest contract
   * is corrected in place (2.4b adds a contract on a return).
   */
  edit(
    access: Access,
    id: string,
    record: StudentRecord,
    requestId: string,
  ): Promise<StudentDetail> {
    const branchId = branchOf(access);
    // Task 3.1b, decision 4: the grade of a student in a class, now or
    // planned, is refused by the database (`students_grade_class`).
    return this.refusingTaken(access, () =>
      refusingConstraints(
        () =>
          this.transactions.run(access.branchIds, async (transaction) => {
            const row = await this.lockStudent(transaction, id);
            // A student of 2.4a with no relative is edited once one is linked
            // (task 2.5a, decision 11; `student_relatives_guard` of 0036).
            if ((await this.relatives.linksOf(transaction, id)).length === 0) {
              throw new ApiException('student_needs_relative', 422);
            }
            const contract = await this.lockNewestContract(transaction, id);
            const before = fieldsOf(row, contract);
            const changes = changesOf({ ...before }, { ...record });
            if (changes === null) {
              return this.readDetail(transaction, access, id);
            }
            await this.inserting(
              { jshshir: record.jshshir, documentNumber: record.documentNumber },
              () =>
                transaction
                  .updateTable('students')
                  .set(columnsOf(record))
                  .where('id', '=', id)
                  .execute(),
            );
            if (
              contract.number !== record.contract.number ||
              contract.signed_on !== record.contract.signedOn
            ) {
              await this.inserting({ 'contract.number': record.contract.number }, () =>
                transaction
                  .updateTable('student_contracts')
                  .set({ number: record.contract.number, signed_on: record.contract.signedOn })
                  .where('id', '=', contract.id)
                  .execute(),
              );
            }
            await this.audit.record(transaction, {
              branchId,
              actorId: access.accountId,
              assignmentId: access.assignmentId,
              action: 'student.edit',
              record: { type: 'student', id },
              oldValue: changes.oldValue,
              newValue: changes.newValue,
              requestId,
            });
            return this.readDetail(transaction, access, id);
          }),
        MEMBERSHIP_REFUSALS,
      ),
    );
  }

  /**
   * The correction of a mistyped UID with a reason (edge: "A mistyped UID can
   * be corrected by the Academic Vice Principal with a reason; the old value
   * stays in history"). The old UID stays reserved to the student in
   * `student_uids` (decision 7); a UID the student held before is taken back.
   */
  correctUid(
    access: Access,
    id: string,
    input: StudentUidCorrection,
    requestId: string,
  ): Promise<StudentDetail> {
    const branchId = branchOf(access);
    return this.refusingTaken(access, () =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const row = await this.lockStudent(transaction, id);
        if (row.uid === input.uid) {
          return this.readDetail(transaction, access, id);
        }
        await this.checkSet(transaction, branchId, input.uid, row.grade, row.starts_on, input);
        // The current UID first, then its reservation: the order of the create,
        // so that a correction and a create of one UID meet first on
        // `students_uid_idx` and the second waits and is refused, never a
        // deadlock (spec review of the build). The key of the current UID to
        // its reservation is checked at the commit.
        await this.inserting({ uid: input.uid }, () =>
          transaction
            .updateTable('students')
            .set({ uid: input.uid })
            .where('id', '=', id)
            .execute(),
        );
        const held = await transaction
          .selectFrom('student_uids')
          .select('uid')
          .where('uid', '=', input.uid)
          .where('student_id', '=', id)
          .executeTakeFirst();
        if (held === undefined) {
          const moment = await transactionMoment(transaction);
          await this.inserting({ uid: input.uid }, () =>
            transaction
              .insertInto('student_uids')
              .values({ uid: input.uid, student_id: id, branch_id: branchId, held_from: moment })
              .execute(),
          );
        }
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'student.uid_corrected',
          record: { type: 'student', id },
          oldValue: { uid: row.uid },
          newValue: { uid: input.uid },
          reason: input.reason,
          requestId,
        });
        return this.readDetail(transaction, access, id);
      }),
    );
  }

  /**
   * The identity fields for a reader who sees them hidden, the Principal
   * (edge: "the Principal sees them hidden, with a logged show"). Every show
   * is an audit entry; a reader who sees them, or may not, is refused.
   */
  identity(access: Access, id: string, requestId: string): Promise<StudentIdentity> {
    const branchId = branchOf(access);
    const principal = principalOf(access);
    if (readerOf(access, 'student_identity') !== undefined || principal === undefined) {
      throw new ApiException('permission_denied', 403);
    }
    return this.transactions.run(access.branchIds, async (transaction) => {
      const row = await this.readStudent(transaction, id);
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: principal,
        action: 'student.identity_shown',
        record: { type: 'student', id },
        requestId,
      });
      return identityOf(row);
    });
  }

  // ---------------------------------------------------------------------------

  /**
   * The UID set warning (`04`, UID sets, Release 1; decision 5 as changed by
   * correction 2 of #67): the set of the grade in the academic year of the
   * branch that holds the start date, or the first that begins after it.
   */
  private async checkSet(
    transaction: Transaction,
    branchId: string,
    uid: string,
    grade: number,
    startsOn: SchoolDate,
    input: { confirmUidSet: boolean },
  ): Promise<void> {
    const years = await transaction
      .selectFrom('academic_years')
      .select(['start_date as startDate', 'end_date as endDate'])
      .where('branch_id', '=', branchId)
      .execute();
    const year = uidYearOf(startsOn, years);
    if (year === undefined) {
      throw refused('no_academic_year');
    }
    if (!input.confirmUidSet && uidOutsideSet(uid, grade, Number(year.startDate.slice(0, 4)))) {
      // The warning names the set of the grade (finding 25; task 2.7b-1,
      // decision 7); a UID is outside a set only when the grade has one.
      throw new ApiException('uid_set_mismatch', 409, undefined, [
        {
          path: 'uid',
          code: 'uid_set',
          message: 'The UID is outside the set of the grade.',
          expected: uidSetFor(grade, year) ?? undefined,
        },
      ]);
    }
  }

  /**
   * Runs a write; a unique violation becomes `TakenValue` with the value that
   * was refused, so the holder can be looked up after the transaction ended.
   * The index that refused names the field; `values` gives the value written
   * for each field the write covers.
   */
  async inserting<T>(
    values: Partial<Record<Taken['path'], string | null>>,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const failure = error as { code?: unknown; constraint?: unknown };
      const path =
        failure.code === UNIQUE_VIOLATION && typeof failure.constraint === 'string'
          ? TAKEN_FIELDS[failure.constraint]
          : undefined;
      if (path === undefined) {
        throw error;
      }
      throw new TakenValue({ path, value: values[path] ?? '' });
    }
  }

  /**
   * Turns a taken value into 409 `student_value_taken` naming the field. The holder
   * is looked up in a new transaction through the branch filter (correction
   * 6 of #67): a student of this branch is named by id (the screen opens it);
   * one of another branch is only said to exist (`held_elsewhere`, decision 3).
   */
  async refusingTaken<T>(access: Access, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof TakenValue)) {
        throw error;
      }
      const { path, value } = error.taken;
      if (value === '') {
        // An index refused a value the write did not name: no claim about its holder.
        throw new ApiException('request_refused', 409);
      }
      const branchId = branchOf(access);
      const merged =
        path === 'uid'
          ? await this.transactions.run(access.branchIds, (transaction) =>
              this.mergedHolderOf(transaction, value, branchId),
            )
          : undefined;
      if (merged !== undefined) {
        // A UID of a record merged into another (task 3.3d, correction 2): the
        // kept record when it is of the branch, "another branch" otherwise.
        throw new ApiException('student_value_taken', 409, undefined, [
          merged === null
            ? { path, code: 'held_elsewhere', message: 'A student of another branch holds it.' }
            : {
                path,
                code: 'uid_merged',
                message: 'A record merged into a student held it.',
                recordId: merged,
              },
        ]);
      }
      const holder = await this.transactions.run(access.branchIds, (transaction) =>
        this.holderOf(transaction, path, value),
      );
      const detail: ErrorDetail =
        holder === undefined
          ? { path, code: 'held_elsewhere', message: 'A student of another branch holds it.' }
          : holder === null
            ? // A UID of a student deleted as created twice: reserved for good (0033, decision 3).
              { path, code: 'uid_released', message: 'A deleted student held it.' }
            : { path, code: 'already_exists', message: 'A student holds it.', recordId: holder };
      throw new ApiException('student_value_taken', 409, undefined, [detail]);
    }
  }

  /**
   * The kept record a merged UID leads to (`student_merged_uid_holder`, 0054,
   * decision 6): its id when it is of the branch of the request, `null` when
   * it is of another branch, `undefined` when the UID was never merged.
   */
  private async mergedHolderOf(
    transaction: Transaction,
    uid: string,
    branchId: string,
  ): Promise<string | null | undefined> {
    const found = await sql<{ student_id: string | null }>`
      select student_id from student_merged_uid_holder(${uid}, ${branchId}::uuid)
    `.execute(transaction);
    const row = found.rows[0];
    return row === undefined ? undefined : row.student_id;
  }

  /**
   * The id of the student of the branch of the transaction that holds a value,
   * if any; `null` for a UID of this branch whose student was deleted (0033).
   */
  private async holderOf(
    transaction: Transaction,
    path: Taken['path'],
    value: string,
  ): Promise<string | null | undefined> {
    switch (path) {
      case 'uid':
        return (
          await transaction
            .selectFrom('student_uids')
            .select('student_id')
            .where('uid', '=', value)
            .executeTakeFirst()
        )?.student_id;
      case 'jshshir':
        return (
          await transaction
            .selectFrom('students')
            .select('id')
            .where('jshshir', '=', value)
            .executeTakeFirst()
        )?.id;
      case 'documentNumber':
        return (
          await transaction
            .selectFrom('students')
            .select('id')
            .where('document_number', '=', value)
            .executeTakeFirst()
        )?.id;
      case 'contract.number':
        return (
          await transaction
            .selectFrom('student_contracts')
            .select('student_id')
            .where(sql<boolean>`upper(number) = upper(${value})`)
            .executeTakeFirst()
        )?.student_id;
    }
  }

  private async readStudent(transaction: Transaction, id: string): Promise<StudentRow> {
    const row = await transaction
      .selectFrom('students')
      .select(STUDENT_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return row;
  }

  async lockStudent(transaction: Transaction, id: string): Promise<StudentRow> {
    const row = await transaction
      .selectFrom('students')
      .select(STUDENT_COLUMNS)
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return row;
  }

  private async lockNewestContract(
    transaction: Transaction,
    id: string,
  ): Promise<{ id: string; number: string; signed_on: string }> {
    return (
      transaction
        .selectFrom('student_contracts')
        .select(['id', 'number', 'signed_on'])
        .where('student_id', '=', id)
        // The newest contract is the one with the latest id (uuidv7): `created_at` is
        // bookkeeping only (spec review of the plan of #68, finding 14).
        .orderBy('id', 'desc')
        .limit(1)
        .forUpdate()
        .executeTakeFirstOrThrow()
    );
  }

  async readDetail(transaction: Transaction, access: Access, id: string): Promise<StudentDetail> {
    const branchId = branchOf(access);
    const row = await this.readStudent(transaction, id);
    const today = await this.todayIn(transaction, branchId);
    const rows = (await this.statusRowsOf(transaction, id)).get(id) ?? [];
    const reasons = new Map(
      (
        await transaction
          .selectFrom('student_statuses')
          .select(['id', 'reason'])
          .where('student_id', '=', id)
          .execute()
      ).map((status) => [status.id, status.reason]),
    );
    const statuses = rows.filter((status) => status.validFrom !== status.validUntil);
    const counts = await versionCounts(transaction, id);
    const held = (await studentClassesOn(transaction, today, id)).get(id);
    const current = held?.current ?? null;
    const scope = (await studentPlaces(transaction, today, id)).get(id) ?? NO_PLACES;
    // A Teacher-only reader: the Basic group, the groups, the status today
    // and the start date, nothing else of the record (task 3.6a, L48,
    // decision 14 of pull request #118 with correction 3).
    const basicOnly = readsAsTeacherOnly(access, scope);
    const tutor =
      current === null || basicOnly
        ? undefined
        : (await tutorsInForce(transaction)).get(current.id);
    // As `statusOn`: the row in force today, else the first one after today.
    const now = statuses.find((status) => status.validUntil === null || status.validUntil > today);
    const contractCount = await transaction
      .selectFrom('student_contracts')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('student_id', '=', id)
      .executeTakeFirstOrThrow();
    const canArchive = archiverOf(access) !== undefined;
    const contact = readerOf(access, 'student_contact', scope) !== undefined;
    const identity = readerOf(access, 'student_identity', scope) !== undefined;
    const financial = readerOf(access, 'student_financial', scope) !== undefined;
    // Task 3.6a (L50): the readers of the diagnostic score.
    const diagnostic = readerOf(access, 'student_diagnostic', scope) !== undefined;
    const contracts = financial
      ? await transaction
          .selectFrom('student_contracts')
          .select(['id', 'number', 'signed_on'])
          .where('student_id', '=', id)
          .orderBy('id', 'desc')
          .execute()
      : [];
    return {
      id: row.id,
      uid: row.uid,
      mergedUids: basicOnly ? [] : await this.mergedUidsOf(transaction, id),
      firstName: row.first_name,
      lastName: row.last_name,
      paternalName: row.paternal_name,
      sex: row.sex as Sex,
      grade: row.grade,
      startsOn: row.starts_on,
      photoId: row.photo_id,
      consentMissing: financial ? row.consent_signed_on === null : null,
      status: now?.status ?? null,
      contact: contact ? { phone: row.phone, email: row.email } : null,
      identity: identity ? identityOf(row) : null,
      identityHidden: !identity && principalOf(access) !== undefined,
      financial: financial
        ? {
            contracts: contracts.map((contract) => ({
              id: contract.id,
              number: contract.number,
              signedOn: contract.signed_on,
            })),
            scholarship: {
              type: row.scholarship_type as ScholarshipType,
              coverage: row.scholarship_coverage as ScholarshipCoverage | null,
              amount: row.scholarship_amount,
            },
            previousSchool: row.previous_school,
            consentSignedOn: row.consent_signed_on,
          }
        : null,
      diagnosticScore: diagnostic ? row.diagnostic_score : null,
      readsDiagnostic: diagnostic,
      // A leaving taken back leaves no break in the history (finding 7 of the
      // hand test of 13 October 2026); the rows and the audit keep it.
      statuses: (basicOnly ? [] : historyLines(statuses)).map((status) => ({
        status: status.status,
        from: status.validFrom,
        until: status.validUntil,
        cause: status.cause,
        // The reason is read by the Financial readers (decision 9).
        reason: financial ? (reasons.get(status.id) ?? null) : null,
      })),
      planned: basicOnly ? null : plannedAfter(rows, today),
      class: current,
      plannedClass: basicOnly ? null : (held?.planned ?? null),
      tutor: tutor?.tutor ?? null,
      actingTutor: tutor?.acting ?? null,
      mainRoom: basicOnly ? null : (held?.mainRoom ?? null),
      // The Academic block's groups (task 3.2b): the record is answered only to a reader who opens it.
      groups: (await studentGroupsOn(transaction, today, id)).get(id) ?? [],
      version: studentVersion(rows.length, counts, id),
      opens: readerOf(access, 'students', scope) !== undefined,
      canEdit:
        decide(
          { area: 'students', action: 'edit', branch: 'request' },
          access.assignments,
          access.branchId,
          PERMISSIONS,
        ) !== undefined,
      canArchive,
      canRestoreGraduated:
        decide(
          { area: 'student_graduates', action: 'edit', branch: 'request' },
          access.assignments,
          access.branchId,
          PERMISSIONS,
        ) !== undefined,
      deletable: canArchive && !holdsData(rows, row.scholarship_type, Number(contractCount.count)),
      ...(await this.movesOfDetail(transaction, access, id, today, scope, basicOnly)),
      ...(await this.branchMovesOfDetail(transaction, access, id, basicOnly)),
      ...(await this.classLeftOfDetail(transaction, canArchive, id, rows, today, branchId)),
      canMerge:
        decide(
          { area: 'student_merges', action: 'edit', branch: 'request' },
          access.assignments,
          access.branchId,
          PERMISSIONS,
        ) !== undefined,
      today,
    };
  }

  /**
   * The UIDs of the records merged into this one (task 3.3d, the System
   * block's "Also UID ..."), by the moment of each merge; the merges of a
   * chain name the latest kept record (0054).
   */
  async mergedUidsOf(transaction: Transaction, id: string): Promise<string[]> {
    return (await this.mergedUidsByStudent(transaction, id)).get(id) ?? [];
  }

  /** The same for every kept record the transaction sees, or for one. */
  async mergedUidsByStudent(transaction: Transaction, id?: string): Promise<Map<string, string[]>> {
    const rows = await transaction
      .selectFrom('student_merges')
      .select(['kept_id', 'merged_uids'])
      .$if(id !== undefined, (query) => query.where('kept_id', '=', id ?? ''))
      .orderBy('merged_at')
      .orderBy('id')
      .execute();
    const found = new Map<string, string[]>();
    for (const row of rows) {
      found.set(row.kept_id, [...(found.get(row.kept_id) ?? []), ...row.merged_uids]);
    }
    return found;
  }

  /**
   * The class the student left, which the return form offers first (task
   * 3.3b): read for a reader who may return the student, while the student
   * is inactive with no change planned; `null` when no class was left.
   */
  private async classLeftOfDetail(
    transaction: Transaction,
    canArchive: boolean,
    id: string,
    rows: readonly StoredStudentStatus[],
    today: SchoolDate,
    branchId: string,
  ): Promise<{ classLeft?: StudentClass | null }> {
    const last = rows.filter((row) => row.validFrom !== row.validUntil).at(-1);
    if (
      !canArchive ||
      last === undefined ||
      last.status !== 'inactive' ||
      last.validUntil !== null ||
      last.validFrom > today
    ) {
      return {};
    }
    // The rows of this branch: the Super Admin's transaction also sees those
    // of a branch the student left by a move (task 3.3c, permission review).
    const left = classLeft(
      await membershipsOf(transaction, id, branchId),
      last.validFrom,
      cancelledOf(await movesOf(transaction, id, branchId)),
    );
    if (left === undefined) {
      return { classLeft: null };
    }
    const named = await transaction
      .selectFrom('classes')
      .select(['grade', 'name', 'language'])
      .where('id', '=', left.classId)
      .executeTakeFirstOrThrow();
    return {
      classLeft: {
        id: left.classId,
        grade: named.grade,
        name: named.name,
        language: named.language as StudentClass['language'],
        from: left.validFrom,
        until: left.validUntil,
      },
    };
  }

  /**
   * The moves part of the record (task 3.3a): the scheduled moves (edge: "the
   * student shows the current class with a badge"), the latest class move
   * begun for the Academic block's "transfer history" (`04`, Student record),
   * and what this reader may do with them, decided from every current
   * assignment.
   */
  private async movesOfDetail(
    transaction: Transaction,
    access: Access,
    id: string,
    today: SchoolDate,
    scope: StudentPlaces,
    basicOnly: boolean,
  ): Promise<
    Pick<
      StudentDetail,
      | 'scheduledMoves'
      | 'lastClassMove'
      | 'canMoveClass'
      | 'groupMoveSubjects'
      | 'canMoveInPast'
      | 'readsHistory'
    >
  > {
    // The moves of this branch: the Super Admin's transaction sees every
    // branch, and a move of an earlier branch is on the History tab (task 3.3c).
    const moves = basicOnly ? [] : await moveSummaries(transaction, id, today, branchOf(access));
    const movers = permitting(
      { area: 'group_transfers', action: 'edit', branch: 'request' },
      access.assignments,
      access.branchId,
      PERMISSIONS,
    );
    const subjects = [
      ...new Set(
        (
          await transaction
            .selectFrom('group_memberships')
            .select('subject_id')
            .where('student_id', '=', id)
            .whereRef('valid_from', '<', 'valid_until')
            .where('valid_until', '>', today)
            .execute()
        ).map((one) => one.subject_id),
      ),
    ].sort();
    return {
      scheduledMoves: moves.filter((move) => move.state === 'scheduled'),
      lastClassMove:
        moves.filter((move) => move.kind === 'class' && move.state === 'done').at(-1) ?? null,
      canMoveClass:
        decide(
          { area: 'classes', action: 'edit', branch: 'request' },
          access.assignments,
          access.branchId,
          PERMISSIONS,
        ) !== undefined,
      // Decision 2: the subjects of the student's groups the reader moves in
      // its scope (a Head Teacher: own subjects).
      groupMoveSubjects: subjects.filter(
        (subjectId) => inGroupScope(movers, { subjectId, classIds: [] }) !== undefined,
      ),
      canMoveInPast: pastMoverOf(access) !== undefined,
      readsHistory: readerOf(access, 'student_history', scope) !== undefined,
    };
  }

  /**
   * The move to another branch on the record (task 3.3c): the open release,
   * read by a reader of `branch_moves` (the badge of the sending branch);
   * the latest move into this branch that was accepted (the Academic block,
   * decision 3); whether this reader releases and cancels.
   */
  private async branchMovesOfDetail(
    transaction: Transaction,
    access: Access,
    id: string,
    basicOnly: boolean,
  ): Promise<Pick<StudentDetail, 'branchMove' | 'lastBranchMove' | 'canMoveBranch'>> {
    const branchId = branchOf(access);
    const moves = await branchMovesOf(transaction, id, branchId);
    const names = await branchNames(
      transaction,
      moves.flatMap((move) => [move.fromBranchId, move.toBranchId]),
    );
    const can = (action: 'view' | 'edit') =>
      decide(
        { area: 'branch_moves', action, branch: 'request' },
        access.assignments,
        access.branchId,
        PERMISSIONS,
      ) !== undefined;
    const open = moves.find((move) => branchMoveState(move) === 'open');
    const arrived = moves
      .filter(
        (move) =>
          move.acceptedAt !== null && move.toBranchId.toLowerCase() === branchId.toLowerCase(),
      )
      .at(-1);
    return {
      branchMove: open !== undefined && can('view') ? summaryOf(open, names) : null,
      lastBranchMove: arrived === undefined || basicOnly ? null : summaryOf(arrived, names),
      canMoveBranch: can('edit'),
    };
  }

  /**
   * The status rows of one student, or of every student the transaction sees
   * (`id` null), each list in the order of `valid_from`, rows taken back
   * included: their number is the `version` of the student.
   */
  async statusRowsOf(
    transaction: Transaction,
    id: string | null,
  ): Promise<Map<string, StoredStudentStatus[]>> {
    let query = transaction
      .selectFrom('student_statuses')
      .select(['id', 'student_id', 'status', 'valid_from', 'valid_until', 'cause']);
    if (id !== null) {
      query = query.where('student_id', '=', id);
    }
    const found = await query.orderBy('valid_from').orderBy('id').execute();
    const rows = new Map<string, StoredStudentStatus[]>();
    for (const row of found) {
      const own = rows.get(row.student_id) ?? [];
      own.push({
        id: row.id,
        status: row.status as StudentStatus,
        validFrom: row.valid_from,
        validUntil: row.valid_until,
        cause: row.cause as StatusCause,
      });
      rows.set(row.student_id, own);
    }
    return rows;
  }
}

function identityOf(row: StudentRow): StudentIdentity {
  return {
    birthDate: row.birth_date,
    documentType: row.document_type as DocumentType | null,
    documentNumber: row.document_number,
    jshshir: row.jshshir,
    address: row.address,
    region: row.region as Region | null,
  };
}
