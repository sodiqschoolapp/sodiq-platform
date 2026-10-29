import {
  permits,
  SCHOOL_WIDE_ROLES,
  type Action,
  type PermissionTable,
  type Role,
} from '@sodiq/shared';
import type { CurrentAssignment } from './current-assignments.js';

/** What a route asks of its caller: an action in an area of the permission table. */
export interface Requirement {
  area: string;
  action: Action;
  /**
   * `request`: the route works for the one branch the request names. `none`:
   * school-wide work (a new branch, an account), which no branch limits.
   */
  branch: 'request' | 'none';
}

/**
 * The assignment that permits the requirement, or none. Edge cases, "Who can
 * act": "The server allows an action if any current assignment permits it",
 * whatever the role switcher shows. An assignment with a branch counts for
 * that branch only; an assignment of the Super Admin or the Senior Head
 * Teacher, which has none, counts for every branch. The two roles are named
 * here too: a later role without a branch (Parent, Release 2) must not get
 * every branch by having none. When several permit, the first in the
 * order they were read (by id) is the one the audit log names.
 *
 * Subject, class and own-lesson scope are not decided here: a route with
 * subject scope picks, among every assignment that permits it
 * (`permitting`), the one whose subjects fit (`subject-scope.ts`, task
 * 2.3b-1); class and own-lesson scope come with 3.1.
 */
export function decide(
  requirement: Requirement,
  assignments: readonly CurrentAssignment[],
  branchId: string | null,
  table: PermissionTable,
): CurrentAssignment | undefined {
  return permitting(requirement, assignments, branchId, table)[0];
}

/**
 * Every assignment that permits the requirement, in the order they were read
 * (by id). A route with subject scope chooses the one whose scope fits among
 * them, and the audit entry names that one (task 2.3b-1).
 */
export function permitting(
  requirement: Requirement,
  assignments: readonly CurrentAssignment[],
  branchId: string | null,
  table: PermissionTable,
): CurrentAssignment[] {
  const branch = branchId?.toLowerCase() ?? null;
  if (requirement.branch === 'request' && branch === null) {
    return [];
  }
  return assignments.filter(
    (assignment) =>
      permits(table, assignment.role, requirement.area, requirement.action) &&
      (requirement.branch === 'none' ||
        (assignment.branchId === null && SCHOOL_WIDE_ROLES.includes(assignment.role)) ||
        assignment.branchId?.toLowerCase() === branch),
  );
}

/**
 * The roles whose assignment without a branch reaches the hidden Monitoring branch of the
 * sign-in-and-save check (task 10.2b; answer 10: "the Super Admin sees it in the branch
 * switcher as 'Monitoring'"; the owner on pull request #261, 29 October 2026: "refuse the
 * Monitoring branch to the Senior Head Teacher; only the Super Admin sees it").
 */
export const MONITORING_BRANCH_ROLES: readonly Role[] = ['super_admin'];

/**
 * The assignments that reach a branch: in the Monitoring branch, those of the branch itself
 * (its test teacher) and the Super Admin's; elsewhere, all of them.
 */
export function reachingBranch<T extends Pick<CurrentAssignment, 'role' | 'branchId'>>(
  assignments: readonly T[],
  monitoring: boolean,
): T[] {
  return monitoring
    ? assignments.filter(
        (assignment) =>
          assignment.branchId !== null || MONITORING_BRANCH_ROLES.includes(assignment.role),
      )
    : [...assignments];
}
