import type { Role } from '@sodiq/shared';
import type { CurrentAssignment } from './current-assignments.js';
import type { Access } from './permission.guard.js';

/**
 * The roles whose limit is the branch, not a list of subjects (`02`, Rules):
 * they fit every subject of the branch, and the permission table still
 * decides each area (decision 7 of pull request #63). A route with subject
 * scope that gives one of them an action gives it every subject of the
 * branch; `subject-scope.test.ts` pins the list.
 */
export const BRANCH_WIDE_ROLES: readonly Role[] = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  'spiritual_vice_principal',
  'head_tutor',
];

/** The roles limited to their own subjects (`02`, Head Teachers and Senior Head Teachers). */
const SUBJECT_ROLES: readonly Role[] = ['head_teacher', 'senior_head_teacher'];

/**
 * Whether an assignment's scope fits a subject. Nothing fits by default: a
 * Teacher and a Tutor have own lessons and an own class (3.1 and the
 * journal), the roles of Releases 2 and 3 nothing yet.
 */
function fits(assignment: CurrentAssignment, subjectId: string): boolean {
  if (BRANCH_WIDE_ROLES.includes(assignment.role)) {
    return true;
  }
  return (
    SUBJECT_ROLES.includes(assignment.role) &&
    assignment.subjectIds.includes(subjectId.toLowerCase())
  );
}

/**
 * The assignment that allows the route for this subject, or none: the first
 * of those that permit the route in the branch of the request whose scope
 * fits it. `02`, Scope: "A teacher of Mathematics and Physics is seen by the
 * Mathematics Head Teacher only in Mathematics." The route refuses with 403
 * when none fits, and its audit entry names the one found (edge cases, Who
 * can act: "The audit log records which assignment allowed the action").
 * Checked before `RequestKeys.runOnce`, on every request.
 */
export function inSubjectScope(access: Access, subjectId: string): CurrentAssignment | undefined {
  return access.permitting.find((assignment) => fits(assignment, subjectId));
}

/**
 * The subjects a list may show: `all` when an assignment that permits the
 * route has a branch-wide role, else the subjects of the permitting Head
 * Teacher and Senior Head Teacher assignments (empty for none).
 */
export function subjectsInScope(access: Access): 'all' | ReadonlySet<string> {
  if (access.permitting.some((assignment) => BRANCH_WIDE_ROLES.includes(assignment.role))) {
    return 'all';
  }
  return new Set(
    access.permitting
      .filter((assignment) => SUBJECT_ROLES.includes(assignment.role))
      .flatMap((assignment) => assignment.subjectIds),
  );
}
