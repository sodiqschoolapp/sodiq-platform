import { CLASS_WIDE_ROLES } from './class-scope.js';
import type { CurrentAssignment } from './current-assignments.js';
import { BRANCH_WIDE_ROLES } from './subject-scope.js';

/** What a group is, for its scope: its subject and the classes it draws from. */
export interface GroupScopeKey {
  readonly subjectId: string;
  readonly classIds: readonly string[];
}

/**
 * Whether an assignment's scope fits a group (task 3.2a, decisions 2 and 11
 * of pull request #91): a branch-wide role fits every group; a Head Teacher
 * and a Senior Head Teacher the groups of own subjects (`02`, Scope: "For own
 * subjects in own branch: … groups"); a Tutor the groups that draw from a
 * class of its rows in force (`classIds`, filled by the permission guard for
 * the areas of `CLASS_SCOPED_AREAS`); a Teacher none.
 */
function fits(assignment: CurrentAssignment, group: GroupScopeKey): boolean {
  if (BRANCH_WIDE_ROLES.includes(assignment.role)) {
    return true;
  }
  if (CLASS_WIDE_ROLES.includes(assignment.role)) {
    // The Head Teacher and the Senior Head Teacher: own subjects only.
    return assignment.subjectIds.includes(group.subjectId.toLowerCase());
  }
  return (
    assignment.role === 'tutor' &&
    group.classIds.some((classId) => assignment.classIds.includes(classId.toLowerCase()))
  );
}

/**
 * The assignment that allows the route for this group, or none: the first of
 * `assignments` (the permitting ones of the route) whose scope fits it. The
 * route refuses with 403 when none fits, after a 404 for an unknown id or
 * another branch's, on every request.
 */
export function inGroupScope(
  assignments: readonly CurrentAssignment[],
  group: GroupScopeKey,
): CurrentAssignment | undefined {
  return assignments.find((assignment) => fits(assignment, group));
}
