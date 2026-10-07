import { roleSchema, SCHOOL_WIDE_ROLES, type Role } from '@sodiq/shared';
import type { ExpressionBuilder } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import type { DB } from '../../database/types.generated.js';

/**
 * The condition "has not ended at `now`": in force, or beginning later. An
 * assignment that was taken back before it began has its start as its end and
 * has ended, also while that moment is still ahead.
 */
export const notEnded = (now: Date) => (builder: ExpressionBuilder<DB, 'assignments'>) =>
  builder.or([
    builder('valid_until', 'is', null),
    builder.and([
      builder('valid_until', '>', now),
      builder('valid_until', '>', builder.ref('valid_from')),
    ]),
  ]);

/** An assignment that is in force at the moment it was read. */
export interface CurrentAssignment {
  id: string;
  role: Role;
  /** `null` for the Super Admin and the Senior Head Teacher, who work across branches. */
  branchId: string | null;
}

/**
 * The assignments of an account that are in force at `now`: begun, and not
 * ended. Edge cases, "Accounts and sign-in": rights are read again on every
 * request, so nothing keeps this answer for a later one.
 */
export async function currentAssignments(
  transaction: Transaction,
  accountId: string,
  now: Date,
): Promise<CurrentAssignment[]> {
  const found = await transaction
    .selectFrom('assignments')
    .select(['id', 'role', 'branch_id'])
    .where('account_id', '=', accountId)
    .where('valid_from', '<=', now)
    .where((builder) =>
      builder.or([builder('valid_until', 'is', null), builder('valid_until', '>', now)]),
    )
    .orderBy('id')
    .execute();
  return found.map((row) => ({
    id: row.id,
    role: roleSchema.parse(row.role),
    branchId: row.branch_id,
  }));
}

export const rolesOf = (assignments: readonly CurrentAssignment[]): Role[] =>
  assignments.map((assignment) => assignment.role);

/** A branch the account may choose in the branch switcher. */
export interface BranchChoice {
  id: string;
  name: string;
}

/**
 * The branches an account may choose: every branch for a Super Admin or a
 * Senior Head Teacher ("All branches", "own subjects in all branches"), the
 * branches of its assignments for the others. Display only: every request is
 * checked against its one branch on the server. `branches` has no row filter
 * (it is not a branch-owned table), so the list is made here.
 */
export async function branchChoices(
  transaction: Transaction,
  assignments: readonly CurrentAssignment[],
): Promise<BranchChoice[]> {
  const schoolWide = assignments.some((assignment) => SCHOOL_WIDE_ROLES.includes(assignment.role));
  const own = assignments.flatMap((assignment) =>
    assignment.branchId === null ? [] : [assignment.branchId],
  );
  if (!schoolWide && own.length === 0) {
    return [];
  }
  let query = transaction.selectFrom('branches').select(['id', 'name']);
  if (!schoolWide) {
    query = query.where('id', 'in', own);
  }
  return query.orderBy('name').orderBy('id').execute();
}
