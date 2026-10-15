import { nextDay, type ErrorCode, type ErrorDetail, type SchoolDate } from '@sodiq/shared';
import { ApiException } from '../../http/api-exception.js';
import type { Transaction } from '../../database/transactions.js';
import type { Access } from '../access/permission.guard.js';
import type { Audit } from '../audit/audit.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { membersPeak, membershipsOf } from './class-membership-rows.js';
import {
  holdsDays,
  placementEnd,
  type PlacementStatus,
  type StoredMembership,
} from './membership-plan.js';

/** A student as a placement reads them, locked FOR UPDATE. */
export interface PlacementStudent {
  id: string;
  grade: number;
  startsOn: SchoolDate;
  statuses: PlacementStatus[];
  memberships: StoredMembership[];
  /** Status rows and class rows (decision 17). */
  version: number;
}

/** A class as a placement reads it. */
export interface PlacementClass {
  id: string;
  branchId: string;
  grade: number;
  maxSize: number;
  archived: boolean;
  yearStatus: string;
  yearStart: SchoolDate;
  /** The own end of every row of the class: the day after the year's end (decision 7). */
  ownUntil: SchoolDate;
}

/** A row a placement writes. */
export interface PlacedRow {
  studentId: string;
  from: SchoolDate;
  until: SchoolDate;
  leavingId: string | null;
}

/** The class of a placement, or `undefined` for another branch's class or an unknown id. */
export async function readPlacementClass(
  transaction: Transaction,
  classId: string,
): Promise<PlacementClass | undefined> {
  const row = await transaction
    .selectFrom('classes')
    .innerJoin('academic_years', 'academic_years.id', 'classes.academic_year_id')
    .select([
      'classes.id',
      'classes.branch_id',
      'classes.grade',
      'classes.max_size',
      'classes.archived_at',
      'academic_years.status',
      'academic_years.start_date',
      'academic_years.end_date',
    ])
    .where('classes.id', '=', classId)
    .executeTakeFirst();
  return row === undefined
    ? undefined
    : {
        id: row.id,
        branchId: row.branch_id,
        grade: row.grade,
        maxSize: row.max_size,
        archived: row.archived_at !== null,
        yearStatus: row.status,
        yearStart: row.start_date,
        ownUntil: nextDay(row.end_date),
      };
}

/**
 * The students of a placement locked FOR UPDATE in the order of their id
 * (decision 17: the lock order of every placement and status change), then
 * their status rows and class rows read. Another branch's student or an
 * unknown id is not found.
 */
export async function lockPlacementStudents(
  transaction: Transaction,
  ids: readonly string[],
): Promise<Map<string, PlacementStudent>> {
  const sorted = [...ids].sort();
  const locked = await transaction
    .selectFrom('students')
    .select(['id', 'grade', 'starts_on'])
    .where('id', 'in', sorted)
    .orderBy('id')
    .forUpdate()
    .execute();
  if (locked.length !== sorted.length) {
    throw notFound();
  }
  const found = new Map<string, PlacementStudent>();
  for (const row of locked) {
    const statuses = await transaction
      .selectFrom('student_statuses')
      .select(['id', 'status', 'valid_from', 'valid_until', 'cause'])
      .where('student_id', '=', row.id)
      .orderBy('valid_from')
      .orderBy('id')
      .execute();
    const memberships = await membershipsOf(transaction, row.id);
    found.set(row.id, {
      id: row.id,
      grade: row.grade,
      startsOn: row.starts_on,
      statuses: statuses.map((status) => ({
        id: status.id,
        status: status.status,
        validFrom: status.valid_from,
        validUntil: status.valid_until,
        cause: status.cause,
      })),
      memberships,
      version: statuses.length + memberships.length,
    });
  }
  return found;
}

/** The refusal of one student, named in the details of the answer. */
const studentDetail = (index: number, studentId: string, code: ErrorCode): ErrorDetail => ({
  path: `students.${String(index)}`,
  code,
  message: `The student is refused: ${code}.`,
  recordId: studentId,
});

/**
 * The checks of "Put into a class" (decisions 4 to 7 and 17), all or none:
 * the class is active in an open year and the date inside the year; each
 * student was not changed since it was read (`version` given), has no class
 * on or after the date (a move is a transfer, 3.3), is of the class's grade
 * and is active from the date (up to a scheduled leaving); then the free
 * seats on every date from the date on, scheduled joins and leaves counted.
 * The database checks the same under its locks (0045). Refused students are
 * named in `details`; the answer's code is the first one's.
 */
export async function planPlacement(
  transaction: Transaction,
  placement: PlacementClass,
  students: readonly { student: PlacementStudent; version: number | null }[],
  from: SchoolDate,
): Promise<PlacedRow[]> {
  if (placement.archived) {
    throw new ApiException('class_archived', 409);
  }
  if (placement.yearStatus === 'closed') {
    throw new ApiException('class_year_closed', 409);
  }
  if (from < placement.yearStart || from >= placement.ownUntil) {
    throw new ApiException('membership_outside_year', 409, undefined, [
      { path: 'from', code: 'membership_outside_year', message: 'The date is outside the year.' },
    ]);
  }
  const rows: PlacedRow[] = [];
  const details: ErrorDetail[] = [];
  students.forEach(({ student, version }, index) => {
    const refuse = (code: ErrorCode) => details.push(studentDetail(index, student.id, code));
    if (version !== null && version !== student.version) {
      refuse('student_changed');
      return;
    }
    if (student.memberships.some((row) => holdsDays(row) && row.validUntil > from)) {
      refuse('student_has_class');
      return;
    }
    if (student.grade !== placement.grade) {
      refuse('class_grade_differs');
      return;
    }
    const end = placementEnd(student.statuses, student.startsOn, from, placement.ownUntil);
    if ('refusal' in end) {
      refuse(end.refusal);
      return;
    }
    rows.push({ studentId: student.id, from, until: end.until, leavingId: end.leavingId });
  });
  const first = details[0];
  if (first !== undefined) {
    throw new ApiException(first.code as ErrorCode, 409, undefined, details);
  }
  // Counted over the days the rows hold: a row that ends at a scheduled
  // leaving needs no seat after it (the guard counts `[from, until)` too).
  const until = rows.reduce((latest, row) => (row.until > latest ? row.until : latest), from);
  const free = placement.maxSize - (await membersPeak(transaction, placement.id, from, until));
  if (rows.length > free) {
    throw new ApiException('class_full', 409, undefined, [
      {
        path: 'students',
        code: 'class_full',
        message: 'The class has fewer free seats than students.',
        freeSeats: Math.max(free, 0),
      },
    ]);
  }
  return rows;
}

/**
 * Writes the rows of a placement and one audit entry per student on the
 * student record (decision 14), in the transaction of the change. The guard
 * of the database checks every rule again under its locks. Answers the id of
 * each row written, in the order of `rows`.
 */
export async function writePlacement(
  transaction: Transaction,
  audit: Audit,
  access: Access,
  placement: PlacementClass,
  rows: readonly PlacedRow[],
  cause: 'placement' | 'create' | 'return' | 'restore' | 'branch_move',
  requestId: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (const row of rows) {
    const written = await transaction
      .insertInto('class_memberships')
      .values({
        branch_id: placement.branchId,
        student_id: row.studentId,
        class_id: placement.id,
        valid_from: row.from,
        valid_until: row.until,
        own_until: placement.ownUntil,
        cause,
        ended_by: row.leavingId === null ? null : 'leaving',
        leaving_id: row.leavingId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await audit.record(transaction, {
      branchId: placement.branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'student.class_joined',
      record: { type: 'student', id: row.studentId },
      newValue: {
        classId: placement.id,
        membershipId: written.id,
        from: row.from,
        until: row.until,
        cause,
      },
      requestId,
    });
    ids.push(written.id);
  }
  return ids;
}
