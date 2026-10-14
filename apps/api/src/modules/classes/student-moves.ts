import type { ErrorCode, MoveState, SchoolDate, StudentMove } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';
import type { CurrentAssignment } from '../access/current-assignments.js';
import type { Access } from '../access/permission.guard.js';
import { ApiException } from '../../http/api-exception.js';
import { notFound } from '../setup/setup-refusals.js';
import { membershipsOf } from './class-membership-rows.js';
import { groupMembershipsOf, type StoredGroupMembership } from './group-membership-rows.js';
import type { StoredMembership } from './membership-plan.js';

/**
 * Class and group transfers (task 3.3a, pull request #95; db/migrations/0050):
 * the moves of a student as the routes, the record and the History tab read
 * them.
 */

/**
 * The refusals of the database for moves (0050), by the name of the
 * constraint or trigger check. The services check the same first; these
 * answer two requests that race past those checks.
 */
export const MOVE_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  student_moves_not_scheduled: 'move_not_scheduled',
  student_moves_not_begun: 'move_not_undoable',
  // Faults of the service.
  student_moves_state: 'request_refused',
  student_moves_student_branch: 'request_refused',
  group_memberships_move: 'request_refused',
  memberships_move_end: 'request_refused',
};

/** A move as it is stored. */
export interface StoredMove {
  id: string;
  branchId: string;
  studentId: string;
  kind: 'class' | 'group';
  subjectId: string | null;
  fromClassId: string | null;
  toClassId: string | null;
  fromGroupId: string | null;
  toGroupId: string | null;
  effectiveOn: SchoolDate;
  madeAt: Date;
  cancelledAt: Date | null;
  undoneAt: Date | null;
  cancelledByLeavingId: string | null;
}

function movesIn(transaction: Transaction) {
  return transaction
    .selectFrom('student_moves')
    .select([
      'id',
      'branch_id',
      'student_id',
      'kind',
      'subject_id',
      'from_class_id',
      'to_class_id',
      'from_group_id',
      'to_group_id',
      'effective_on',
      'made_at',
      'cancelled_at',
      'undone_at',
      'cancelled_by_leaving_id',
    ]);
}

type MoveRow = Awaited<ReturnType<ReturnType<typeof movesIn>['executeTakeFirstOrThrow']>>;

const storedOf = (row: MoveRow): StoredMove => ({
  id: row.id,
  branchId: row.branch_id,
  studentId: row.student_id,
  // `student_moves_kind_check` keeps the list.
  kind: row.kind as StoredMove['kind'],
  subjectId: row.subject_id,
  fromClassId: row.from_class_id,
  toClassId: row.to_class_id,
  fromGroupId: row.from_group_id,
  toGroupId: row.to_group_id,
  effectiveOn: row.effective_on,
  madeAt: row.made_at,
  cancelledAt: row.cancelled_at,
  undoneAt: row.undone_at,
  cancelledByLeavingId: row.cancelled_by_leaving_id,
});

/**
 * The moves of one student the transaction sees, by date, then the moment
 * made, then the id (the review's should-fix 8: never the order of a read).
 */
export async function movesOf(transaction: Transaction, studentId: string): Promise<StoredMove[]> {
  const rows = await movesIn(transaction)
    .where('student_id', '=', studentId)
    .orderBy('effective_on')
    .orderBy('made_at')
    .orderBy('id')
    .execute();
  return rows.map(storedOf);
}

/**
 * One move of the branch of the transaction, locked FOR UPDATE, of the kind
 * of the route; an unknown id, another branch's or another kind is 404.
 * Called after the student is locked (the lock order of every class path).
 */
export async function lockMove(
  transaction: Transaction,
  branchId: string,
  id: string,
  kind: StoredMove['kind'],
): Promise<StoredMove> {
  const row = await movesIn(transaction)
    .where('id', '=', id)
    .where('branch_id', '=', branchId)
    .where('kind', '=', kind)
    .forUpdate()
    .executeTakeFirst();
  if (row === undefined) {
    throw notFound();
  }
  return storedOf(row);
}

/** The student of a move of the branch, read before the student is locked; 404 otherwise. */
export async function studentOfMove(
  transaction: Transaction,
  branchId: string,
  id: string,
  kind: StoredMove['kind'],
): Promise<string> {
  const row = await transaction
    .selectFrom('student_moves')
    .select('student_id')
    .where('id', '=', id)
    .where('branch_id', '=', branchId)
    .where('kind', '=', kind)
    .executeTakeFirst();
  if (row === undefined) {
    throw notFound();
  }
  return row.student_id;
}

/** The state of a move on `today` (branch time). */
export function moveState(move: StoredMove, today: SchoolDate): MoveState {
  if (move.cancelledAt !== null) {
    return 'cancelled';
  }
  if (move.undoneAt !== null) {
    return 'undone';
  }
  return move.effectiveOn > today ? 'scheduled' : 'done';
}

/** The ids of the moves of a list that are cancelled. */
export const cancelledOf = (moves: readonly StoredMove[]): Set<string> =>
  new Set(moves.filter((move) => move.cancelledAt !== null).map((move) => move.id));

/** Whether a row was written into its target by the move (not given back by its cancel or undo). */
export const writtenBy = (
  row: { cause: string; writtenByMoveId: string | null },
  moveId: string,
): boolean =>
  row.writtenByMoveId === moveId && (row.cause === 'transfer' || row.cause === 'automatic');

const holds = (row: { validFrom: SchoolDate; validUntil: SchoolDate }): boolean =>
  row.validFrom < row.validUntil;

/** What the undo rule reads of a student (decision 10 with correction 2). */
export interface UndoFacts {
  classRows: readonly StoredMembership[];
  groupRows: readonly StoredGroupMembership[];
  /** The classes of each group the student has a row in, lower case. */
  classesOfGroup: ReadonlyMap<string, ReadonlySet<string>>;
  /** Classes and groups in service: not archived, in a year that is not closed. */
  classInService: (classId: string) => boolean;
  groupInService: (groupId: string) => boolean;
}

/**
 * Whether a move that has begun can be undone (`edge/students-classes-groups`,
 * "A transfer was a mistake. It can be undone only while the new journals
 * hold no entries. Otherwise a transfer back is made."; decision 10 with
 * correction 2 of the review): every row the move wrote into its target still
 * ends at its own end (nothing cut it since: a later move of either kind, a
 * leaving), the class or group it left is in service, and for a class move no
 * group row of the student over the days it gives back lies in a group that
 * does not draw from the class it gives back (a placement made after the
 * move). The journal part comes with task 8.6.
 */
export function undoable(move: StoredMove, today: SchoolDate, facts: UndoFacts): boolean {
  if (moveState(move, today) !== 'done') {
    return false;
  }
  const classWritten = facts.classRows.filter((row) => writtenBy(row, move.id));
  const groupWritten = facts.groupRows.filter((row) => writtenBy(row, move.id));
  if (![...classWritten, ...groupWritten].every((row) => row.endedBy === null)) {
    return false;
  }
  if (move.kind === 'group') {
    return (
      groupWritten.length === 1 &&
      move.fromGroupId !== null &&
      facts.groupInService(move.fromGroupId)
    );
  }
  const target = classWritten[0];
  if (classWritten.length !== 1 || target === undefined || move.fromClassId === null) {
    return false;
  }
  if (!facts.classInService(move.fromClassId)) {
    return false;
  }
  const back = move.fromClassId.toLowerCase();
  return facts.groupRows.every(
    (row) =>
      !holds(row) ||
      writtenBy(row, move.id) ||
      row.validUntil <= target.validFrom ||
      row.validFrom >= target.validUntil ||
      (facts.classesOfGroup.get(row.groupId.toLowerCase())?.has(back) ?? false),
  );
}

/** Reads the facts of the undo rule for one student, without a lock. */
export async function undoFacts(transaction: Transaction, studentId: string): Promise<UndoFacts> {
  const classRows = await membershipsOf(transaction, studentId);
  const groupRows = await groupMembershipsOf(transaction, studentId);
  const groupIds = [...new Set(groupRows.map((row) => row.groupId))];
  const links =
    groupIds.length === 0
      ? []
      : await transaction
          .selectFrom('group_classes')
          .select(['group_id', 'class_id'])
          .where('group_id', 'in', groupIds)
          .execute();
  const classesOfGroup = new Map<string, Set<string>>();
  for (const link of links) {
    const key = link.group_id.toLowerCase();
    const own = classesOfGroup.get(key) ?? new Set<string>();
    own.add(link.class_id.toLowerCase());
    classesOfGroup.set(key, own);
  }
  const moves = await movesOf(transaction, studentId);
  const classIds = [
    ...new Set(moves.flatMap((move) => (move.fromClassId === null ? [] : [move.fromClassId]))),
  ];
  const groupsLeft = [
    ...new Set(moves.flatMap((move) => (move.fromGroupId === null ? [] : [move.fromGroupId]))),
  ];
  const classesInService =
    classIds.length === 0
      ? []
      : await transaction
          .selectFrom('classes')
          .innerJoin('academic_years', 'academic_years.id', 'classes.academic_year_id')
          .select('classes.id')
          .where('classes.id', 'in', classIds)
          .where('classes.archived_at', 'is', null)
          .where('academic_years.status', '<>', 'closed')
          .execute();
  const groupsInService =
    groupsLeft.length === 0
      ? []
      : await transaction
          .selectFrom('groups')
          .innerJoin('academic_years', 'academic_years.id', 'groups.academic_year_id')
          .select('groups.id')
          .where('groups.id', 'in', groupsLeft)
          .where('groups.archived_at', 'is', null)
          .where('academic_years.status', '<>', 'closed')
          .execute();
  const classSet = new Set(classesInService.map((row) => row.id.toLowerCase()));
  const groupSet = new Set(groupsInService.map((row) => row.id.toLowerCase()));
  return {
    classRows,
    groupRows,
    classesOfGroup,
    classInService: (id) => classSet.has(id.toLowerCase()),
    groupInService: (id) => groupSet.has(id.toLowerCase()),
  };
}

/**
 * The moves of a student as the record and the History tab answer them, with
 * the names of their classes and groups, in the order of `movesOf`.
 */
export async function moveSummaries(
  transaction: Transaction,
  studentId: string,
  today: SchoolDate,
): Promise<StudentMove[]> {
  const moves = await movesOf(transaction, studentId);
  if (moves.length === 0) {
    return [];
  }
  const facts = await undoFacts(transaction, studentId);
  const classIds = [
    ...new Set(
      moves.flatMap((move) =>
        [move.fromClassId, move.toClassId].filter((id): id is string => id !== null),
      ),
    ),
  ];
  const groupIds = [
    ...new Set(
      moves.flatMap((move) =>
        [move.fromGroupId, move.toGroupId].filter((id): id is string => id !== null),
      ),
    ),
  ];
  const classes = new Map(
    (classIds.length === 0
      ? []
      : await transaction
          .selectFrom('classes')
          .select(['id', 'grade', 'name'])
          .where('id', 'in', classIds)
          .execute()
    ).map((row) => [row.id, { id: row.id, grade: row.grade, name: row.name }]),
  );
  const groups = new Map(
    (groupIds.length === 0
      ? []
      : await transaction
          .selectFrom('groups')
          .select(['id', 'name'])
          .where('id', 'in', groupIds)
          .execute()
    ).map((row) => [row.id, { id: row.id, name: row.name }]),
  );
  // The classes and groups of a move are of its branch, which the
  // transaction sees; a name is never missing for a stored move.
  const named = <T>(map: ReadonlyMap<string, T>, id: string | null): T | null =>
    id === null ? null : (map.get(id) ?? null);
  return moves.map((move) => ({
    id: move.id,
    kind: move.kind,
    from: move.effectiveOn,
    subjectId: move.subjectId,
    fromClass: named(classes, move.fromClassId),
    toClass: named(classes, move.toClassId),
    fromGroup: named(groups, move.fromGroupId),
    toGroup: named(groups, move.toGroupId),
    state: moveState(move, today),
    cancelledByLeaving: move.cancelledByLeavingId !== null,
    undoable: undoable(move, today, facts),
  }));
}

/**
 * The assignment that may date a move before today (`edge/students-classes-
 * groups`: "Backdating is for the Academic Vice Principal"; decision 4): the
 * Super Admin, or the Academic Vice Principal of the branch of the request,
 * decided from every current assignment (`.claude/rules/api.md`).
 */
export function pastMoverOf(access: Access): CurrentAssignment | undefined {
  const branch = access.branchId?.toLowerCase() ?? null;
  return access.assignments.find(
    (assignment) =>
      assignment.role === 'super_admin' ||
      (assignment.role === 'academic_vice_principal' &&
        assignment.branchId !== null &&
        assignment.branchId.toLowerCase() === branch),
  );
}

/**
 * A planned class or group row that a scheduled move wrote or cuts is not
 * withdrawn on its own (task 3.3a): the move is changed or cancelled, which
 * takes its rows with it. `move_scheduled`.
 */
export async function refuseScheduledMoveRow(
  transaction: Transaction,
  row: { cause: string; written_by_move_id: string | null; ended_by_move_id: string | null },
): Promise<void> {
  const ids = [
    row.cause === 'transfer' ? row.written_by_move_id : null,
    row.ended_by_move_id,
  ].filter((id): id is string => id !== null);
  if (ids.length === 0) {
    return;
  }
  const live = await transaction
    .selectFrom('student_moves')
    .select('id')
    .where('id', 'in', ids)
    .where('cancelled_at', 'is', null)
    .where('undone_at', 'is', null)
    .executeTakeFirst();
  if (live !== undefined) {
    throw new ApiException('move_scheduled', 409);
  }
}
