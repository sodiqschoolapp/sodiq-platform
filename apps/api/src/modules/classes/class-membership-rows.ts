import type { ErrorCode, PersonName, SchoolDate, StudentClass } from '@sodiq/shared';
import { instructionLanguageSchema } from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import { tutorRowsIn } from './class-tutor-rows.js';
import type { MembershipPlan, StoredMembership } from './membership-plan.js';

/**
 * The refusals of the database for class membership (db/migrations/0045), by
 * the name of the constraint or trigger check. The services check the same
 * rules first where they can name the student; these answer when two
 * requests race past those checks, or at the commit of the deferred check of
 * the active time.
 */
export const MEMBERSHIP_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  class_memberships_no_overlap: 'student_has_class',
  class_memberships_full: 'class_full',
  class_memberships_active: 'student_not_active_on',
  class_memberships_grade: 'class_grade_differs',
  class_memberships_outside_year: 'membership_outside_year',
  class_memberships_class_archived: 'class_archived',
  class_year_closed: 'class_year_closed',
  classes_has_members: 'class_has_members',
  classes_grade_members: 'class_grade_members',
  classes_size_below_members: 'class_size_below_members',
  students_grade_class: 'student_grade_class',
  academic_years_has_members: 'academic_year_has_members',
  // The service checks these first; a fault answers the general refusal.
  class_memberships_student_branch: 'request_refused',
  class_memberships_only_shrink: 'request_refused',
  class_memberships_leaving: 'request_refused',
  class_memberships_insert_ended: 'request_refused',
  class_memberships_withdraw_planned: 'membership_in_force',
  class_memberships_move: 'request_refused',
};

/** The class rows of one student the transaction sees, by start. */
export async function membershipsOf(
  transaction: Transaction,
  studentId: string,
): Promise<StoredMembership[]> {
  const rows = await transaction
    .selectFrom('class_memberships')
    .select([
      'id',
      'class_id',
      'valid_from',
      'valid_until',
      'own_until',
      'ended_by',
      'leaving_id',
      'cause',
      'written_by_move_id',
      'ended_by_move_id',
    ])
    .where('student_id', '=', studentId)
    .orderBy('valid_from')
    .orderBy('id')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    classId: row.class_id,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    ownUntil: row.own_until,
    // The checks of the table keep the list equal to the type.
    endedBy: row.ended_by as StoredMembership['endedBy'],
    leavingId: row.leaving_id,
    cause: row.cause as StoredMembership['cause'],
    writtenByMoveId: row.written_by_move_id,
    endedByMoveId: row.ended_by_move_id,
  }));
}

/**
 * The number of class rows of one student, or of every student the
 * transaction sees (`id` null): with the status rows it is the `version` of
 * the student (decision 17).
 */
export async function membershipCounts(
  transaction: Transaction,
  id: string | null,
): Promise<Map<string, number>> {
  let query = transaction
    .selectFrom('class_memberships')
    .select(['student_id', (eb) => eb.fn.countAll<string>().as('count')])
    .groupBy('student_id');
  if (id !== null) {
    query = query.where('student_id', '=', id);
  }
  const rows = await query.execute();
  return new Map(rows.map((row) => [row.student_id, Number(row.count)]));
}

/**
 * The classes of a list that are in service: not archived, in a year that is
 * not closed. Each is locked FOR UPDATE, in the order of its id, first and
 * read afterwards, so that an archive at the same moment waits or is waited
 * for, and the guard's own FOR UPDATE of a row written back is no upgrade of
 * a share lock that two changes could hold at once (a deadlock; spec review
 * of the build, must-fix 1).
 */
export async function classesInService(
  transaction: Transaction,
  classIds: readonly string[],
): Promise<Set<string>> {
  if (classIds.length === 0) {
    return new Set();
  }
  const ids = [...new Set(classIds)].sort();
  await transaction
    .selectFrom('classes')
    .select('id')
    .where('id', 'in', ids)
    .orderBy('id')
    .forUpdate()
    .execute();
  const rows = await transaction
    .selectFrom('classes')
    .innerJoin('academic_years', 'academic_years.id', 'classes.academic_year_id')
    .select('classes.id')
    .where('classes.id', 'in', ids)
    .where('classes.archived_at', 'is', null)
    .where('academic_years.status', '<>', 'closed')
    .execute();
  return new Set(rows.map((row) => row.id));
}

/** A row cut or written, as the audit entry of the change names it. */
export interface MembershipWritten {
  id: string;
  classId: string;
  from: SchoolDate;
  until: SchoolDate;
}

/**
 * Writes a plan of `planMemberships`: the cuts first, then the new rows, so
 * that a new row never overlaps a row not yet cut. A new row passes every
 * check of `class_memberships_guard` again (a row back in service is checked
 * again). `leavingId` is the inactive row of the new leaving, if any.
 */
export async function applyMembershipPlan(
  transaction: Transaction,
  studentId: string,
  rows: readonly StoredMembership[],
  plan: MembershipPlan,
  leavingId: string | null,
  cause: 'cancel' | 'undo',
): Promise<{ cut: MembershipWritten[]; written: MembershipWritten[] }> {
  const cut: MembershipWritten[] = [];
  const written: MembershipWritten[] = [];
  for (const one of plan.cuts) {
    const before = rows.find((row) => row.id === one.id);
    if (before === undefined || leavingId === null) {
      throw new Error('A cut names a row of the student and a new leaving.');
    }
    await transaction
      .updateTable('class_memberships')
      // A row a move cut is cut again by the leaving, which names itself
      // instead (task 3.3a, 0050).
      .set({
        valid_until: one.validUntil,
        ended_by: 'leaving',
        leaving_id: leavingId,
        ended_by_move_id: null,
      })
      .where('id', '=', one.id)
      .where('student_id', '=', studentId)
      .execute();
    cut.push({
      id: one.id,
      classId: before.classId,
      from: before.validFrom,
      until: one.validUntil,
    });
  }
  for (const one of plan.inserts) {
    const branch = await transaction
      .selectFrom('classes')
      .select('branch_id')
      .where('id', '=', one.classId)
      .executeTakeFirstOrThrow();
    const row = await transaction
      .insertInto('class_memberships')
      .values({
        branch_id: branch.branch_id,
        student_id: studentId,
        class_id: one.classId,
        valid_from: one.validFrom,
        valid_until: one.validUntil,
        own_until: one.ownUntil,
        cause,
        ended_by: one.cut ? 'leaving' : null,
        leaving_id: one.cut ? leavingId : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    written.push({ id: row.id, classId: one.classId, from: one.validFrom, until: one.validUntil });
  }
  return { cut, written };
}

/** The class of a student on a day and the next one planned, as the list and the record show them. */
export interface StudentClasses {
  current: StudentClass | null;
  planned: StudentClass | null;
  mainRoom: string | null;
}

/**
 * The class in force on `today` and the first planned after it of each
 * student the transaction sees (or of one), with its main classroom. A row
 * that holds no days never counts.
 */
export async function studentClassesOn(
  transaction: Transaction,
  today: SchoolDate,
  studentId: string | null,
): Promise<Map<string, StudentClasses>> {
  let query = transaction
    .selectFrom('class_memberships')
    .innerJoin('classes', 'classes.id', 'class_memberships.class_id')
    .leftJoin('rooms', 'rooms.id', 'classes.main_room_id')
    .select([
      'class_memberships.student_id',
      'class_memberships.valid_from',
      'class_memberships.valid_until',
      'classes.id',
      'classes.grade',
      'classes.name',
      'classes.language',
      'rooms.name as room_name',
    ])
    .whereRef('class_memberships.valid_from', '<', 'class_memberships.valid_until')
    .where('class_memberships.valid_until', '>', today);
  if (studentId !== null) {
    query = query.where('class_memberships.student_id', '=', studentId);
  }
  const rows = await query.orderBy('class_memberships.valid_from').execute();
  const found = new Map<string, StudentClasses>();
  for (const row of rows) {
    const own = found.get(row.student_id) ?? { current: null, planned: null, mainRoom: null };
    const named: StudentClass = {
      id: row.id,
      grade: row.grade,
      name: row.name,
      language: instructionLanguageSchema.parse(row.language),
      from: row.valid_from,
      until: row.valid_until,
    };
    if (row.valid_from <= today) {
      own.current = named;
      own.mainRoom = row.room_name;
    } else if (own.planned === null) {
      own.planned = named;
      if (own.current === null) {
        own.mainRoom = row.room_name;
      }
    }
    found.set(row.student_id, own);
  }
  return found;
}

/** The Tutor and the acting Tutor in force now of each class the transaction sees. */
export async function tutorsInForce(
  transaction: Transaction,
): Promise<Map<string, { tutor: PersonName | null; acting: PersonName | null }>> {
  const now = await transactionMoment(transaction);
  const rows = await tutorRowsIn(transaction)
    .where('class_tutors.valid_from', '<=', now)
    .where((builder) =>
      builder.or([
        builder('class_tutors.valid_until', 'is', null),
        builder('class_tutors.valid_until', '>', now),
      ]),
    )
    .execute();
  const found = new Map<string, { tutor: PersonName | null; acting: PersonName | null }>();
  for (const row of rows) {
    const own = found.get(row.class_id) ?? { tutor: null, acting: null };
    const name =
      row.first_name === null || row.last_name === null
        ? null
        : { firstName: row.first_name, lastName: row.last_name };
    if (row.kind === 'tutor') {
      own.tutor = name;
    } else {
      own.acting = name;
    }
    found.set(row.class_id, own);
  }
  return found;
}

/** The members of each class the transaction sees on `today`, rows with days only. */
export async function memberCountsOn(
  transaction: Transaction,
  today: SchoolDate,
): Promise<Map<string, number>> {
  const rows = await transaction
    .selectFrom('class_memberships')
    .select(['class_id', (eb) => eb.fn.countAll<string>().as('count')])
    .where('valid_from', '<=', today)
    .where('valid_until', '>', today)
    .groupBy('class_id')
    .execute();
  return new Map(rows.map((row) => [row.class_id, Number(row.count)]));
}

/**
 * The largest number of members a class holds on any date of `[from, until)`
 * (`until` null: to the end), scheduled joins and leaves counted: the count
 * of `class_members_peak` (db/migrations/0045), which the guard compares.
 */
export async function membersPeak(
  transaction: Transaction,
  classId: string,
  from: SchoolDate,
  until: SchoolDate | null,
): Promise<number> {
  const found = await sql<{ peak: number }>`
    select class_members_peak(${classId}::uuid, ${from}::date, ${until}::date) as peak
  `.execute(transaction);
  return found.rows[0]?.peak ?? 0;
}
