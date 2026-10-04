import { permits, type Action, type PermissionTable } from '@sodiq/shared';
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
 * that branch only; an assignment without one (Super Admin, Senior Head
 * Teacher) counts for every branch. When several permit, the first in the
 * order they were read (by id) is the one the audit log names.
 *
 * Subject, class and own-lesson scope are not decided here: the tasks that
 * bring them (2.3, 3.1) add them.
 */
export function decide(
  requirement: Requirement,
  assignments: readonly CurrentAssignment[],
  branchId: string | null,
  table: PermissionTable,
): CurrentAssignment | undefined {
  const branch = branchId?.toLowerCase() ?? null;
  if (requirement.branch === 'request' && branch === null) {
    return undefined;
  }
  return assignments.find(
    (assignment) =>
      permits(table, assignment.role, requirement.area, requirement.action) &&
      (requirement.branch === 'none' ||
        assignment.branchId === null ||
        assignment.branchId.toLowerCase() === branch),
  );
}
