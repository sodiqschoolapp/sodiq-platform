import {
  PERMISSIONS,
  permits,
  STUDENT_FIELD_GROUPS,
  type Role,
  type StudentFieldGroup,
} from '@sodiq/shared';
import { permitting } from '../access/permission-check.js';
import type { Access } from '../access/permission.guard.js';

/** The area whose `view` reads each group of fields (2.4a decision 2). */
const READING_AREA: Readonly<Record<StudentFieldGroup, string>> = {
  basic: 'students',
  contact: 'student_contact',
  identity: 'student_identity',
  financial: 'student_financial',
};

/**
 * The roles whose files may hold Contact and Identity fields
 * (`edge/people-roles-accounts`: "Whole-branch exports with contact or
 * identity fields are for the Super Admin and Academic Vice Principal"), on
 * ticked rows too (task 2.4b-2, decision 3 of pull request #70, Look first).
 */
const CONTACT_EXPORTERS: readonly Role[] = ['super_admin', 'academic_vice_principal'];

/**
 * The groups of the student record this account may export in the branch of
 * the request, each with the assignment that allows it (task 2.4b-2,
 * decisions 1 to 3): an assignment that permits `students` `export` in the
 * branch and whose role reads the group; Contact and Identity only through a
 * Super Admin or Academic Vice Principal assignment. Decided from every
 * current assignment that counts in the branch of the request
 * (`.claude/rules/api.md`; correction 3 of the review), never from the role
 * shown.
 */
export function exportGroupsOf(access: Access): Map<StudentFieldGroup, string> {
  const exporters = permitting(
    { area: 'students', action: 'export', branch: 'request' },
    access.assignments,
    access.branchId,
    PERMISSIONS,
  );
  const groups = new Map<StudentFieldGroup, string>();
  for (const group of STUDENT_FIELD_GROUPS) {
    const allowing = exporters.find(
      (assignment) =>
        permits(PERMISSIONS, assignment.role, READING_AREA[group], 'view') &&
        (group === 'basic' || group === 'financial' || CONTACT_EXPORTERS.includes(assignment.role)),
    );
    if (allowing !== undefined) {
      groups.set(group, allowing.id);
    }
  }
  return groups;
}

/**
 * The assignment the audit entry of a file names (`.claude/rules/api.md`:
 * "the audit entry names the assignment that allowed that part"): that of the
 * narrowest group written, Identity, then Contact, then Financial; a file of
 * Basic columns only names the route's own assignment.
 */
export function assignmentForGroups(
  allowed: ReadonlyMap<StudentFieldGroup, string>,
  written: ReadonlySet<StudentFieldGroup>,
): string | undefined {
  for (const group of ['identity', 'contact', 'financial'] as const) {
    if (written.has(group)) {
      return allowed.get(group);
    }
  }
  return undefined;
}
