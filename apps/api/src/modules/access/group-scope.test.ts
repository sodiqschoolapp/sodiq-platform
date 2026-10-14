import { describe, expect, it } from 'vitest';
import type { CurrentAssignment } from './current-assignments.js';
import { inGroupScope } from './group-scope.js';

const MATHS = '0199a000-0000-7000-8000-00000000000a';
const ENGLISH = '0199a000-0000-7000-8000-00000000000b';
const OXFORD = '0199a000-0000-7000-8000-0000000000c1';
const YALE = '0199a000-0000-7000-8000-0000000000c2';

const held = (
  role: CurrentAssignment['role'],
  fields: Partial<CurrentAssignment> = {},
): CurrentAssignment =>
  ({
    id: `assignment-${role}`,
    role,
    branchId: 'north',
    subjectIds: [],
    classIds: [],
    ...fields,
  });

const group = { subjectId: MATHS.toUpperCase(), classIds: [OXFORD.toUpperCase()] };

// Task 3.2a, decisions 2 and 11 of pull request #91; the permission review
// of the build, S3: the scope of each role, ids in either case.
describe('inGroupScope', () => {
  it('fits every group for the branch-wide roles', () => {
    for (const role of [
      'super_admin',
      'principal',
      'academic_vice_principal',
      'spiritual_vice_principal',
      'head_tutor',
    ] as const) {
      expect(inGroupScope([held(role)], group)?.role, role).toBe(role);
    }
  });

  it('fits the Head Teachers by their own subjects only', () => {
    for (const role of ['head_teacher', 'senior_head_teacher'] as const) {
      expect(inGroupScope([held(role, { subjectIds: [MATHS] })], group)?.role).toBe(role);
      expect(inGroupScope([held(role, { subjectIds: [ENGLISH] })], group)).toBeUndefined();
      // A class gives a Head Teacher nothing: only the subject counts.
      expect(
        inGroupScope([held(role, { subjectIds: [ENGLISH], classIds: [OXFORD] })], group),
      ).toBeUndefined();
    }
  });

  it('fits a Tutor by a class the group draws from', () => {
    expect(inGroupScope([held('tutor', { classIds: [OXFORD] })], group)?.role).toBe('tutor');
    expect(inGroupScope([held('tutor', { classIds: [YALE] })], group)).toBeUndefined();
    expect(inGroupScope([held('tutor', { subjectIds: [MATHS] })], group)).toBeUndefined();
  });

  it('never fits a Teacher', () => {
    expect(
      inGroupScope([held('teacher', { subjectIds: [MATHS], classIds: [OXFORD] })], group),
    ).toBeUndefined();
  });

  it('names the first assignment that fits', () => {
    const first = held('tutor', { classIds: [YALE] });
    const second = held('head_teacher', { subjectIds: [MATHS] });
    expect(inGroupScope([first, second], group)).toBe(second);
  });
});
