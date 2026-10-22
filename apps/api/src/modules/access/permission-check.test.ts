import { checkTable } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { SAMPLE_PERMISSIONS } from '../../testing/permission-sample.controller.js';
import type { CurrentAssignment } from './current-assignments.js';
import { decide, type Requirement } from './permission-check.js';

const NORTH = '0199b1c0-0000-7000-8000-00000000000a';
const SOUTH = '0199b1c0-0000-7000-8000-00000000000b';

const VIEW: Requirement = { area: 'sample', action: 'view', branch: 'request' };
const EDIT: Requirement = { area: 'sample', action: 'edit', branch: 'request' };
const SCHOOL_VIEW: Requirement = { area: 'school', action: 'view', branch: 'none' };

let next = 0;
function held(role: CurrentAssignment['role'], branchId: string | null): CurrentAssignment {
  next += 1;
  return {
    id: `0199b1c0-0000-7000-8000-1000000000${String(next).padStart(2, '0')}`,
    role,
    branchId,
    subjectIds: [],
    classIds: [],
  };
}

const decideIn = (
  requirement: Requirement,
  assignments: CurrentAssignment[],
  branchId: string | null,
) => decide(requirement, assignments, branchId, SAMPLE_PERMISSIONS);

describe('the sample table of the tests', () => {
  it('keeps the rules no permission table may break', () => {
    expect(checkTable(SAMPLE_PERMISSIONS)).toEqual([]);
  });
});

describe('the permission check', () => {
  // docs/spec/02-roles-and-access.md, Rules: "Permissions are a table".
  it('allows the action the table gives the role, and names the assignment', () => {
    const teacher = held('teacher', NORTH);

    expect(decideIn(VIEW, [teacher], NORTH)).toBe(teacher);
    expect(decideIn(EDIT, [teacher], NORTH)).toBeUndefined();
  });

  it('refuses an account without a current assignment', () => {
    expect(decideIn(VIEW, [], NORTH)).toBeUndefined();
  });

  // Rules: "Every role is limited to a branch".
  it('does not count a role of one branch in another branch', () => {
    const headTeacher = held('head_teacher', NORTH);

    expect(decideIn(EDIT, [headTeacher], NORTH)).toBe(headTeacher);
    expect(decideIn(EDIT, [headTeacher], SOUTH)).toBeUndefined();
  });

  // Rules: "Only the Super Admin and the Senior Head Teacher work across branches."
  it.each(['super_admin', 'senior_head_teacher'] as const)(
    'counts the %s, who has no branch, in every branch',
    (role) => {
      const schoolWide = held(role, null);

      expect(decideIn(EDIT, [schoolWide], NORTH)).toBe(schoolWide);
      expect(decideIn(EDIT, [schoolWide], SOUTH)).toBe(schoolWide);
    },
  );

  // The database gives only these two roles no branch; the check does not rely on it.
  it('does not count another role in every branch because its assignment has no branch', () => {
    const stray = held('head_teacher', null);

    expect(decideIn(EDIT, [stray], NORTH)).toBeUndefined();
  });

  // Edge cases, "Who can act": "The server allows an action if any current
  // assignment permits it".
  it('allows what any one of several assignments permits', () => {
    const teacher = held('teacher', NORTH);
    const tutor = held('tutor', NORTH);
    const headTeacher = held('head_teacher', NORTH);

    expect(decideIn(EDIT, [teacher, tutor, headTeacher], NORTH)).toBe(headTeacher);
    expect(decideIn(EDIT, [teacher, tutor], NORTH)).toBeUndefined();
  });

  it('does not add up a role of one branch and a branch of another role', () => {
    const headTeacherNorth = held('head_teacher', NORTH);
    const teacherSouth = held('teacher', SOUTH);

    expect(decideIn(EDIT, [headTeacherNorth, teacherSouth], SOUTH)).toBeUndefined();
    expect(decideIn(VIEW, [headTeacherNorth, teacherSouth], SOUTH)).toBe(teacherSouth);
  });

  // "The audit log records which assignment allowed the action": one rule for which.
  it('names the first of several assignments that permit, in the order they were read', () => {
    const teacher = held('teacher', NORTH);
    const headTeacher = held('head_teacher', NORTH);
    const superAdmin = held('super_admin', null);

    expect(decideIn(VIEW, [teacher, headTeacher, superAdmin], NORTH)).toBe(teacher);
    expect(decideIn(EDIT, [teacher, headTeacher, superAdmin], NORTH)).toBe(headTeacher);
    expect(decideIn(EDIT, [teacher, headTeacher, superAdmin], SOUTH)).toBe(superAdmin);
  });

  it('compares branch ids whatever the case of their letters', () => {
    const teacher = held('teacher', NORTH);

    expect(decideIn(VIEW, [teacher], NORTH.toUpperCase())).toBe(teacher);
    expect(decideIn(VIEW, [held('teacher', NORTH.toUpperCase())], NORTH)).toBeDefined();
  });

  it('refuses a branch route when no branch is named', () => {
    expect(
      decideIn(VIEW, [held('super_admin', null), held('teacher', NORTH)], null),
    ).toBeUndefined();
  });

  it('allows school-wide work to any assignment whose role the table permits, whatever its branch', () => {
    const headTeacher = held('head_teacher', SOUTH);

    expect(decideIn(SCHOOL_VIEW, [held('teacher', NORTH), headTeacher], null)).toBe(headTeacher);
    expect(decideIn(SCHOOL_VIEW, [held('teacher', NORTH)], null)).toBeUndefined();
  });

  // Task 7.1a: `plans` is in the table now; `requests` (7.2) is not yet.
  it('gives nothing in an area the table does not have', () => {
    const superAdmin = held('super_admin', null);

    expect(
      decideIn({ area: 'requests', action: 'view', branch: 'request' }, [superAdmin], NORTH),
    ).toBeUndefined();
  });
});
