import {
  PERMISSIONS,
  STUDENT_FIELD_GROUPS,
  type Role,
  type StudentFieldGroup,
} from '@sodiq/shared';
import { inClassScope, type StudentPlaces } from '../access/class-scope.js';
import type { CurrentAssignment } from '../access/current-assignments.js';
import { permitting } from '../access/permission-check.js';
import type { Access } from '../access/permission.guard.js';

/**
 * The groups of fields each exporting role writes in a student file, written
 * per role rather than derived from what the role reads (task 3.6a, decisions
 * 9, 10 and 11 of pull request #118, Look first):
 *
 * - the Super Admin, the Academic Vice Principal and the Head Tutor every
 *   group of every student of the branch (`edge/people-roles-accounts`:
 *   "Exports with contact or identity fields of the whole branch, or of ticked
 *   rows beyond own class, are for the Super Admin, the Academic Vice Principal
 *   and the Head Tutor, who exports every field group"; owner's answer L59);
 * - the Principal Basic, Financial and the diagnostic score, without Contact
 *   and Identity (edge, "Who can act": "Exports are allowed, without contact
 *   and identity fields"; task 2.4b-2);
 * - the Head Teacher and the Senior Head Teacher Basic only, never the score
 *   they read ("Head Teachers export the Basic fields"; L59);
 * - the Tutor Basic, Contact (the relatives' columns included) and the score,
 *   the students of own classes only ("A Tutor exports the students of own
 *   class with every field the Tutor reads about them"; L136).
 *
 * `student-exports.test.ts` pins the table.
 */
export const EXPORT_GROUPS_OF_ROLE: Readonly<Partial<Record<Role, readonly StudentFieldGroup[]>>> =
  {
    super_admin: ['basic', 'contact', 'identity', 'financial', 'diagnostic'],
    academic_vice_principal: ['basic', 'contact', 'identity', 'financial', 'diagnostic'],
    head_tutor: ['basic', 'contact', 'identity', 'financial', 'diagnostic'],
    principal: ['basic', 'financial', 'diagnostic'],
    senior_head_teacher: ['basic'],
    head_teacher: ['basic'],
    tutor: ['basic', 'contact', 'diagnostic'],
  };

const writes = (assignment: CurrentAssignment, group: StudentFieldGroup): boolean =>
  EXPORT_GROUPS_OF_ROLE[assignment.role]?.includes(group) ?? false;

/** The assignments that export the student list in the branch of the request. */
export const studentExportersOf = (access: Access): CurrentAssignment[] =>
  permitting(
    { area: 'students', action: 'export', branch: 'request' },
    access.assignments,
    access.branchId,
    PERMISSIONS,
  );

/**
 * The groups of the student record this account may export in the branch of
 * the request, each with the assignment that allows it (task 2.4b-2,
 * decisions 1 to 3; task 3.6a): an assignment that permits `students`
 * `export` in the branch and whose role writes the group, a class-wide one
 * first, so that a file of the whole branch names it. Decided from every
 * current assignment that counts in the branch of the request
 * (`.claude/rules/api.md`), never from the role shown. A group of a Tutor
 * assignment is written in the rows of own classes only (`rowWrites`).
 */
export function exportGroupsOf(access: Access): Map<StudentFieldGroup, string> {
  const exporters = studentExportersOf(access);
  const ordered = [
    ...exporters.filter((assignment) => inClassScope([assignment], []) !== undefined),
    ...exporters.filter((assignment) => inClassScope([assignment], []) === undefined),
  ];
  const groups = new Map<StudentFieldGroup, string>();
  for (const group of STUDENT_FIELD_GROUPS) {
    const allowing = ordered.find((assignment) => writes(assignment, group));
    if (allowing !== undefined) {
      groups.set(group, allowing.id);
    }
  }
  return groups;
}

/**
 * Whether a row of a student with these places may carry the group: an
 * exporting assignment writes the group and fits the student (a class-wide
 * role every row, a Tutor own classes; task 3.6a, decision 15 of pull request
 * #118: a Tutor who is also a Head Teacher writes Contact and the score in
 * own-class rows only, Basic in the others).
 */
export function rowWrites(
  exporters: readonly CurrentAssignment[],
  group: StudentFieldGroup,
  places: StudentPlaces,
): boolean {
  return (
    inClassScope(
      exporters.filter((assignment) => writes(assignment, group)),
      places.classIds,
      places.groupIds,
    ) !== undefined
  );
}

/**
 * The assignment the audit entry of a file names (`.claude/rules/api.md`:
 * "the audit entry names the assignment that allowed that part"): that of the
 * narrowest group written, Identity, then Contact, then Financial, then the
 * diagnostic score; a file of Basic columns only names the route's own
 * assignment.
 */
export function assignmentForGroups(
  allowed: ReadonlyMap<StudentFieldGroup, string>,
  written: ReadonlySet<StudentFieldGroup>,
): string | undefined {
  for (const group of ['identity', 'contact', 'financial', 'diagnostic'] as const) {
    if (written.has(group)) {
      return allowed.get(group);
    }
  }
  return undefined;
}
