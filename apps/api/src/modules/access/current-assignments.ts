import { roleSchema, type Role } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';

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
