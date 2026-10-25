import { type ErrorCode, type SchoolDate, type StudentGroup } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/**
 * The refusals of the database for group membership (db/migrations/0048), by
 * the name of the constraint or trigger check. The service checks the same
 * rules first where it can name the student; these answer when two requests
 * race past those checks, or at the commit of the deferred containment.
 * `group_memberships_subject`, `group_memberships_student_branch` (the
 * service locks the students of the branch first), `group_memberships_insert_ended`,
 * `group_memberships_review`, `group_memberships_leaving` and
 * `group_memberships_only_shrink` guard against a fault of the service and
 * stay unmapped (500).
 */
export const GROUP_MEMBERSHIP_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  group_memberships_no_overlap: 'student_has_group',
  group_memberships_full: 'group_full',
  group_memberships_group_archived: 'group_archived',
  group_memberships_outside_year: 'group_membership_outside_year',
  group_memberships_in_class: 'student_not_in_group_class',
  // Task 5.12a, decision 7: a group row that puts a student into two lessons
  // of one published block (0060, `group_memberships_block_students`).
  lesson_block_student_twice: 'membership_lesson_clash',
  group_memberships_withdraw_planned: 'group_membership_in_force',
  class_year_closed: 'group_year_closed',
  group_class_has_members: 'group_class_has_members',
  group_has_members: 'group_has_members',
  group_size_below_members: 'group_size_below_members',
  // Task 3.5c, decision 11: two adjoining rows of one group (a move back on
  // the day of the move).
  group_memberships_one_stay: 'stay_continues',
  group_memberships_join: 'request_refused',
  // Task 9.2b (From 3.3a; plan decision 12): a group row that changes membership on a day of a
  // closed quarter (0133, `memberships_closed_quarter`).
  quarters_closed: 'group_quarter_closed',
};

/**
 * The containment met from a class path (a leaving, a withdraw): every such
 * path ends the group rows of the dates its class rows lose, so the deferred
 * check answers only a fault (decision 8).
 */
export const CLASS_PATH_GROUP_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  group_memberships_in_class: 'group_membership_in_class',
};

/** A group row of a student as the paths that end it read it. */
export interface StoredGroupMembership {
  id: string;
  groupId: string;
  subjectId: string;
  validFrom: SchoolDate;
  validUntil: SchoolDate;
  ownUntil: SchoolDate;
  endedBy: string | null;
  leavingId: string | null;
  /** What wrote the row (0048, 0049, 0050). */
  cause: string;
  /** The move whose action inserted the row (task 3.3a, 0050), if any. */
  writtenByMoveId: string | null;
  /** The move that cut or emptied the row (task 3.3a, 0050), if any. */
  endedByMoveId: string | null;
}

/** The group rows of one student the transaction sees, by start; of one branch when `branchId` is given (task 3.3c). */
export async function groupMembershipsOf(
  transaction: Transaction,
  studentId: string,
  branchId?: string,
): Promise<StoredGroupMembership[]> {
  const rows = await transaction
    .selectFrom('group_memberships')
    .select([
      'id',
      'group_id',
      'subject_id',
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
    .$if(branchId !== undefined, (query) => query.where('branch_id', '=', branchId ?? ''))
    .orderBy('valid_from')
    .orderBy('id')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    groupId: row.group_id,
    subjectId: row.subject_id,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    ownUntil: row.own_until,
    endedBy: row.ended_by,
    leavingId: row.leaving_id,
    cause: row.cause,
    writtenByMoveId: row.written_by_move_id,
    endedByMoveId: row.ended_by_move_id,
  }));
}

/**
 * Locks groups FOR UPDATE in the order of their id (spec review of the plan,
 * must-fix 1): every path that touches the rows of more than one group takes
 * them all, after the students and before its first write, so that two such
 * paths never wait for each other in opposite orders.
 */
export async function lockGroups(
  transaction: Transaction,
  groupIds: readonly string[],
): Promise<void> {
  const sorted = [...new Set(groupIds.map((id) => id.toLowerCase()))].sort();
  if (sorted.length === 0) {
    return;
  }
  await transaction
    .selectFrom('groups')
    .select('id')
    .where('id', 'in', sorted)
    .orderBy('id')
    .forUpdate()
    .execute();
}

/** A group row a class path ended, as its audit entry names it. */
export type GroupRowEnded = {
  id: string;
  groupId: string;
  from: SchoolDate;
  until: SchoolDate;
  /** The end in force before the change. */
  was: SchoolDate;
  endedBy: 'leaving' | 'class_withdrawn';
};

/**
 * The group rows a leaving ends (`04`, Movements: "taken out of classes and
 * groups from that date"; decision 8 of pull request #92), as
 * `planMemberships` ends the class rows: every row with days after the first
 * inactive day is cut there (a planned one withdrawn to an empty range),
 * whatever ended it before, and names the leaving; a planned row the leaving
 * taken back had withdrawn is named by the new one (the replace of a
 * scheduled leaving by an earlier date), so that task 3.2c gives it back from
 * the new one. Nothing is given back here (decision 9). The groups are locked
 * first, in the order of their id.
 */
export async function cutGroupRows(
  transaction: Transaction,
  studentId: string,
  firstInactiveDay: SchoolDate,
  leavingId: string,
  takenBack: string | null,
  /** Moves this leaving cancels (task 3.3a): the rows they cut on its first inactive day are named by it. */
  cancelledNow: ReadonlySet<string> = new Set(),
): Promise<GroupRowEnded[]> {
  const rows = await groupMembershipsOf(transaction, studentId);
  const plan: { row: StoredGroupMembership; until: SchoolDate }[] = [];
  for (const row of rows) {
    const holds = row.validFrom < row.validUntil;
    if (holds && row.validUntil > firstInactiveDay) {
      plan.push({
        row,
        until: row.validFrom > firstInactiveDay ? row.validFrom : firstInactiveDay,
      });
    } else if (
      holds &&
      row.endedBy === 'transfer' &&
      row.endedByMoveId !== null &&
      cancelledNow.has(row.endedByMoveId) &&
      row.validUntil >= firstInactiveDay
    ) {
      plan.push({ row, until: row.validUntil });
    } else if (
      !holds &&
      takenBack !== null &&
      row.endedBy === 'leaving' &&
      row.leavingId === takenBack &&
      row.validFrom >= firstInactiveDay
    ) {
      plan.push({ row, until: row.validUntil });
    }
  }
  await lockGroups(
    transaction,
    plan.map(({ row }) => row.groupId),
  );
  for (const { row, until } of plan) {
    await transaction
      .updateTable('group_memberships')
      .set({
        valid_until: until,
        ended_by: 'leaving',
        leaving_id: leavingId,
        ended_by_move_id: null,
      })
      .where('id', '=', row.id)
      .where('student_id', '=', studentId)
      .execute();
  }
  return plan.map(({ row, until }) => ({
    id: row.id,
    groupId: row.groupId,
    from: row.validFrom,
    until,
    was: row.validUntil,
    endedBy: 'leaving' as const,
  }));
}

/**
 * The group rows the withdraw of a planned class row ends (decision 8): the
 * rows with days inside it, each withdrawn to an empty range
 * (`class_withdrawn`). The groups are locked first, in the order of their id.
 */
export async function withdrawGroupRows(
  transaction: Transaction,
  studentId: string,
  classId: string,
  from: SchoolDate,
  until: SchoolDate,
): Promise<GroupRowEnded[]> {
  const rows = (await groupMembershipsOf(transaction, studentId)).filter(
    (row) => row.validFrom < row.validUntil && row.validFrom >= from && row.validFrom < until,
  );
  const inClass = new Set(
    (
      await transaction
        .selectFrom('group_classes')
        .select('group_id')
        .where('class_id', '=', classId)
        .execute()
    ).map((row) => row.group_id),
  );
  const withdrawn = rows.filter((row) => inClass.has(row.groupId));
  await lockGroups(
    transaction,
    withdrawn.map((row) => row.groupId),
  );
  for (const row of withdrawn) {
    await transaction
      .updateTable('group_memberships')
      .set({
        valid_until: row.validFrom,
        ended_by: 'class_withdrawn',
        leaving_id: null,
        ended_by_move_id: null,
      })
      .where('id', '=', row.id)
      .execute();
  }
  return withdrawn.map((row) => ({
    id: row.id,
    groupId: row.groupId,
    from: row.validFrom,
    until: row.validFrom,
    was: row.validUntil,
    endedBy: 'class_withdrawn' as const,
  }));
}

/**
 * The groups of each student the transaction sees (or of one) as the list and
 * the record show them: per subject, the row in force on `today`, else the
 * first planned after it; rows with days only; by name.
 */
export async function studentGroupsOn(
  transaction: Transaction,
  today: SchoolDate,
  studentId: string | null,
): Promise<Map<string, StudentGroup[]>> {
  let query = transaction
    .selectFrom('group_memberships')
    .innerJoin('groups', 'groups.id', 'group_memberships.group_id')
    .select([
      'group_memberships.id as membership_id',
      'group_memberships.student_id',
      'group_memberships.group_id',
      'group_memberships.subject_id',
      'group_memberships.valid_from',
      'group_memberships.review',
      'groups.name',
      'groups.name_key',
    ])
    .whereRef('group_memberships.valid_from', '<', 'group_memberships.valid_until')
    .where('group_memberships.valid_until', '>', today);
  if (studentId !== null) {
    query = query.where('group_memberships.student_id', '=', studentId);
  }
  const rows = await query
    .orderBy('group_memberships.student_id')
    .orderBy('group_memberships.valid_from')
    .orderBy('group_memberships.id')
    .execute();
  const found = new Map<string, Map<string, StudentGroup & { key: string }>>();
  for (const row of rows) {
    const own = found.get(row.student_id) ?? new Map<string, StudentGroup & { key: string }>();
    // The rows of one subject never overlap: the first by start is the one in
    // force today, or the first planned.
    if (!own.has(row.subject_id)) {
      own.set(row.subject_id, {
        id: row.group_id,
        membershipId: row.membership_id,
        name: row.name,
        subjectId: row.subject_id,
        from: row.valid_from,
        state: row.valid_from <= today ? 'current' : 'planned',
        review: row.review,
        // A generated column (0046), never empty for a stored name.
        key: row.name_key ?? row.name,
      });
    }
    found.set(row.student_id, own);
  }
  return new Map(
    [...found].map(([student, groups]) => [
      student,
      [...groups.values()]
        .sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id))
        .map((group) => ({
          id: group.id,
          membershipId: group.membershipId,
          name: group.name,
          subjectId: group.subjectId,
          from: group.from,
          state: group.state,
          review: group.review,
        })),
    ]),
  );
}

/**
 * The largest number of members a group holds on any date of `[from, until)`
 * (`until` null: to the end), scheduled joins and leaves counted: the count
 * of `group_members_peak` (db/migrations/0048), which the guard compares.
 */
export async function groupMembersPeak(
  transaction: Transaction,
  groupId: string,
  from: SchoolDate,
  until: SchoolDate | null,
): Promise<number> {
  const found = await sql<{ peak: number }>`
    select group_members_peak(${groupId}::uuid, ${from}::date, ${until}::date) as peak
  `.execute(transaction);
  return found.rows[0]?.peak ?? 0;
}

/** A range of days a row holds, half-open `[from, until)`. */
export interface HeldRange {
  from: SchoolDate;
  until: SchoolDate;
}

/** The rows with days of a group that end after `from`: what a seat count from `from` on reads. */
export async function groupRangesFrom(
  transaction: Transaction,
  groupId: string,
  from: SchoolDate,
): Promise<HeldRange[]> {
  const rows = await transaction
    .selectFrom('group_memberships')
    .select(['valid_from', 'valid_until'])
    .where('group_id', '=', groupId)
    .whereRef('valid_from', '<', 'valid_until')
    .where('valid_until', '>', from)
    .execute();
  return rows.map((row) => ({ from: row.valid_from, until: row.valid_until }));
}

/**
 * The largest number of rows that hold one day, over the days the new rows
 * hold (spec review of the build, should-fix 1): the count of the guard of
 * 0048 (`group_members_peak` + 1 for each row), date by date, so that a row
 * that ends at a scheduled leaving takes no seat after it and a scheduled
 * join counts from its date. The count only rises at the start of a range.
 */
export function peakWith(existing: readonly HeldRange[], added: readonly HeldRange[]): number {
  const all = [...existing, ...added];
  const days = new Set(added.flatMap((range) => [range.from, ...all.map((one) => one.from)]));
  let peak = 0;
  for (const day of days) {
    if (!added.some((range) => range.from <= day && day < range.until)) {
      continue;
    }
    const count = all.filter((range) => range.from <= day && day < range.until).length;
    peak = Math.max(peak, count);
  }
  return peak;
}
