import type { Role } from '@sodiq/shared';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import type { Access } from '../access/permission.guard.js';

/**
 * The roles of an account the Academic Vice Principal may lock and reset
 * (edge cases, Who can act: "He may reset passwords and lock accounts only for
 * Teachers, Tutors, Head Teachers and the Head Tutor of his branch").
 */
export const VICE_REACHES: readonly Role[] = ['teacher', 'tutor', 'head_teacher', 'head_tutor'];

/**
 * The assignment that allows the caller to lock, unlock or reset the
 * password of an account (decisions 3 and 4 of #65), or `null`: a Super
 * Admin assignment for every account; otherwise an Academic Vice Principal
 * assignment of the branch of the request when every role of the account
 * that has not ended (current or planned) is Teacher, Tutor, Head Teacher or
 * Head Tutor and at least one of them is in that branch. Since task 2.3c-2
 * the same check decides who changes the email of a record (decision 5 of
 * pull request #66): the email opens the account through the reset by email.
 *
 * An exception to `.claude/rules/database.md` (a read of `assignments` keeps
 * to `access.branchIds`), recorded in `docs/decisions.md` (task 2.3c-1,
 * decision 3, correction 4 of the review of #65; task 2.3c-2, decision 5):
 * the check reads the target's roles in every branch, because one account
 * serves every branch and a lock or a reset acts on all of them; a role
 * outside the four, in any branch, stays with the Super Admin. Only the yes
 * or no leaves the server (403, or `can` false), never another branch's
 * role, branch or assignment.
 */
export async function reachingAssignment(
  transaction: Transaction,
  access: Access,
  accountId: string,
  branchId: string,
): Promise<string | null> {
  const superAdmin = access.assignments.find((assignment) => assignment.role === 'super_admin')?.id;
  if (superAdmin !== undefined) {
    return superAdmin;
  }
  const vice = access.assignments.find(
    (assignment) =>
      assignment.role === 'academic_vice_principal' && assignment.branchId === branchId,
  )?.id;
  if (vice === undefined) {
    return null;
  }
  const now = await transactionMoment(transaction);
  const roles = await transaction
    .selectFrom('assignments')
    .select(['role', 'branch_id'])
    .where('account_id', '=', accountId)
    // Not ended, and not taken back before it began.
    .where((builder) =>
      builder.or([
        builder('valid_until', 'is', null),
        builder.and([
          builder('valid_until', '>', now),
          builder('valid_until', '>', builder.ref('valid_from')),
        ]),
      ]),
    )
    .execute();
  const reached =
    roles.length > 0 &&
    roles.every((held) => VICE_REACHES.includes(held.role as Role)) &&
    roles.some((held) => held.branch_id === branchId);
  return reached ? vice : null;
}
