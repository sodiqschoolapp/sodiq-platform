import type { BranchMoveState, ErrorCode, SchoolDate, StudentBranchMove } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';

/**
 * The refusals of the database for a move to another branch (db/migrations/
 * 0053, task 3.3c, pull request #97). The service checks each rule first;
 * these answer two requests that race past those checks, and the faults of
 * the service.
 */
export const BRANCH_MOVE_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  student_branch_moves_open_idx: 'branch_move_open',
  student_branch_moves_not_yet: 'branch_move_not_yet',
  student_statuses_before_branch_move: 'before_branch_move',
  // Faults of the service.
  student_branch_moves_state: 'request_refused',
  student_branch_moves_side: 'request_refused',
  student_branch_moves_student_branch: 'request_refused',
  students_branch_move: 'request_refused',
  memberships_branch_move: 'request_refused',
};

/** A release as it is stored. */
export interface StoredBranchMove {
  id: string;
  branchId: string;
  studentId: string;
  fromBranchId: string;
  toBranchId: string;
  effectiveOn: SchoolDate;
  releasedAt: Date;
  cancelledAt: Date | null;
  declinedAt: Date | null;
  acceptedAt: Date | null;
  cancelledByLeavingId: string | null;
}

function branchMovesIn(transaction: Transaction) {
  return transaction
    .selectFrom('student_branch_moves')
    .select([
      'id',
      'branch_id',
      'student_id',
      'from_branch_id',
      'to_branch_id',
      'effective_on',
      'released_at',
      'cancelled_at',
      'declined_at',
      'accepted_at',
      'cancelled_by_leaving_id',
    ]);
}

type BranchMoveRow = Awaited<
  ReturnType<ReturnType<typeof branchMovesIn>['executeTakeFirstOrThrow']>
>;

const storedOf = (row: BranchMoveRow): StoredBranchMove => ({
  id: row.id,
  branchId: row.branch_id,
  studentId: row.student_id,
  fromBranchId: row.from_branch_id,
  toBranchId: row.to_branch_id,
  effectiveOn: row.effective_on,
  releasedAt: row.released_at,
  cancelledAt: row.cancelled_at,
  declinedAt: row.declined_at,
  acceptedAt: row.accepted_at,
  cancelledByLeavingId: row.cancelled_by_leaving_id,
});

/**
 * The releases of one student held by a branch (the student's, where the
 * cascade carried them), by date, then the moment of release, then the id.
 */
export async function branchMovesOf(
  transaction: Transaction,
  studentId: string,
  branchId: string,
): Promise<StoredBranchMove[]> {
  const rows = await branchMovesIn(transaction)
    .where('student_id', '=', studentId)
    .where('branch_id', '=', branchId)
    .orderBy('effective_on')
    .orderBy('released_at')
    .orderBy('id')
    .execute();
  return rows.map(storedOf);
}

/** One release, locked FOR UPDATE; called after the student is locked (must-fix 3 of the plan review). */
export async function lockBranchMove(
  transaction: Transaction,
  id: string,
): Promise<StoredBranchMove | undefined> {
  const row = await branchMovesIn(transaction).where('id', '=', id).forUpdate().executeTakeFirst();
  return row === undefined ? undefined : storedOf(row);
}

export function branchMoveState(move: StoredBranchMove): BranchMoveState {
  if (move.acceptedAt !== null) {
    return 'accepted';
  }
  if (move.declinedAt !== null) {
    return 'declined';
  }
  if (move.cancelledAt !== null) {
    return 'cancelled';
  }
  return 'open';
}

/**
 * The first day of the latest move of the student into `branchId` that was
 * accepted, or `undefined`: nothing of the student in this branch is dated
 * before it (decision 12).
 */
export function arrivedOn(
  moves: readonly StoredBranchMove[],
  branchId: string,
): SchoolDate | undefined {
  return moves
    .filter(
      (move) =>
        move.acceptedAt !== null && move.toBranchId.toLowerCase() === branchId.toLowerCase(),
    )
    .map((move) => move.effectiveOn)
    .sort()
    .at(-1);
}

/** The names of branches by id (the branches are school-wide). */
export async function branchNames(
  transaction: Transaction,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = await transaction
    .selectFrom('branches')
    .select(['id', 'name'])
    .where('id', 'in', unique)
    .execute();
  return new Map(rows.map((row) => [row.id.toLowerCase(), row.name]));
}

/** A release as the record and the History tab show it. */
export function summaryOf(
  move: StoredBranchMove,
  names: ReadonlyMap<string, string>,
): StudentBranchMove {
  return {
    id: move.id,
    fromBranch: {
      id: move.fromBranchId,
      name: names.get(move.fromBranchId.toLowerCase()) ?? '',
    },
    toBranch: { id: move.toBranchId, name: names.get(move.toBranchId.toLowerCase()) ?? '' },
    from: move.effectiveOn,
    state: branchMoveState(move),
    cancelledByLeaving: move.cancelledByLeavingId !== null,
  };
}
