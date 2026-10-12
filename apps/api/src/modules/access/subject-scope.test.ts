import { PERMISSIONS, type Role } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import type { CurrentAssignment } from './current-assignments.js';
import { permitting, type Requirement } from './permission-check.js';
import type { Access } from './permission.guard.js';
import { BRANCH_WIDE_ROLES, inSubjectScope, subjectsInScope } from './subject-scope.js';

const NORTH = '0199b1c0-0000-7000-8000-00000000000a';
const SOUTH = '0199b1c0-0000-7000-8000-00000000000b';
const MATHEMATICS = '0199b1c0-0000-7000-8000-0000000000a1';
const PHYSICS = '0199b1c0-0000-7000-8000-0000000000a2';

const VIEW: Requirement = { area: 'head_teachers', action: 'view', branch: 'request' };

let next = 0;
function held(
  role: Role,
  branchId: string | null,
  subjectIds: readonly string[] = [],
): CurrentAssignment {
  next += 1;
  return {
    id: `0199b1c0-0000-7000-8000-2000000000${String(next).padStart(2, '0')}`,
    role,
    branchId,
    subjectIds,
  };
}

/** What the guard would allow: every assignment that permits the route in the branch. */
function accessIn(branchId: string, assignments: CurrentAssignment[]): Access {
  const allowing = permitting(VIEW, assignments, branchId, PERMISSIONS);
  const [first] = allowing;
  return {
    accountId: '0199b1c0-0000-7000-8000-000000000001',
    assignmentId: first?.id ?? '',
    role: first?.role ?? 'teacher',
    branchId,
    branchIds: [branchId],
    assignments,
    permitting: allowing,
  };
}

// `02`, Head Teachers and Senior Head Teachers, Scope: "A teacher of
// Mathematics and Physics is seen by the Mathematics Head Teacher only in
// Mathematics" (build plan 2.3b, Done when).
describe('subject scope', () => {
  it('shows the Mathematics Head Teacher a teacher of Mathematics and Physics in Mathematics only', () => {
    // Two people: the teacher, who teaches both, and the Head Teacher of
    // Mathematics of that branch (correction 3 of the review of #63).
    const teacherSubjects = [MATHEMATICS, PHYSICS];
    const headTeacher = held('head_teacher', NORTH, [MATHEMATICS]);
    const access = accessIn(NORTH, [headTeacher]);

    expect(teacherSubjects.filter((subject) => inSubjectScope(access, subject))).toEqual([
      MATHEMATICS,
    ]);
    const scope = subjectsInScope(access);
    expect(
      scope === 'all' ? 'all' : teacherSubjects.filter((subject) => scope.has(subject)),
    ).toEqual([MATHEMATICS]);
  });

  it('lets a Head Teacher who teaches two subjects act in the one they oversee only', () => {
    const headTeacher = held('head_teacher', NORTH, [MATHEMATICS]);
    const teacher = held('teacher', NORTH);
    const access = accessIn(NORTH, [headTeacher, teacher]);

    expect(inSubjectScope(access, MATHEMATICS)).toBe(headTeacher);
    expect(inSubjectScope(access, PHYSICS)).toBeUndefined();
  });

  it('names the assignment whose subjects fit, not the first that permits the route', () => {
    const headTeacher = held('head_teacher', NORTH, [MATHEMATICS]);
    const senior = held('senior_head_teacher', null, [PHYSICS]);
    const access = accessIn(NORTH, [headTeacher, senior]);

    expect(access.assignmentId).toBe(headTeacher.id);
    expect(inSubjectScope(access, PHYSICS)).toBe(senior);
    expect(inSubjectScope(access, MATHEMATICS)).toBe(headTeacher);
  });

  it('lets a Senior Head Teacher act in every branch for their subjects', () => {
    const headTeacher = held('head_teacher', NORTH, [MATHEMATICS]);
    const senior = held('senior_head_teacher', null, [PHYSICS]);
    const access = accessIn(SOUTH, [headTeacher, senior]);

    expect(inSubjectScope(access, PHYSICS)).toBe(senior);
    // A Head Teacher of Mathematics in North asking in South fits nothing.
    expect(inSubjectScope(access, MATHEMATICS)).toBeUndefined();
    expect(subjectsInScope(access)).toEqual(new Set([PHYSICS]));
  });

  it('fits nothing for a Head Teacher asking in another branch', () => {
    const access = accessIn(SOUTH, [held('head_teacher', NORTH, [MATHEMATICS])]);

    expect(inSubjectScope(access, MATHEMATICS)).toBeUndefined();
    expect(subjectsInScope(access)).toEqual(new Set());
  });

  it.each(['super_admin', 'principal', 'academic_vice_principal'] as const)(
    'fits every subject for the %s, whose limit is the branch',
    (role) => {
      const assignment = held(role, role === 'super_admin' ? null : NORTH);
      const access = accessIn(NORTH, [assignment]);

      expect(inSubjectScope(access, MATHEMATICS)).toBe(assignment);
      expect(subjectsInScope(access)).toBe('all');
    },
  );

  it.each(['spiritual_vice_principal', 'head_tutor'] as const)(
    'fits every subject for the %s on a route that gives it the action',
    (role) => {
      const assignment = held(role, NORTH);
      const access: Access = { ...accessIn(NORTH, []), permitting: [assignment] };

      expect(inSubjectScope(access, MATHEMATICS)).toBe(assignment);
      expect(subjectsInScope(access)).toBe('all');
    },
  );

  // Decision 7 of #63: nothing fits by default.
  it.each(['teacher', 'tutor', 'librarian'] as const)('fits no subject for the %s', (role) => {
    const assignment = held(role, NORTH);
    const access: Access = { ...accessIn(NORTH, []), permitting: [assignment] };

    expect(inSubjectScope(access, MATHEMATICS)).toBeUndefined();
    expect(subjectsInScope(access)).toEqual(new Set());
  });

  // Permission review of #63: a role added here sees every subject of a scoped route.
  it('names exactly the roles whose limit is the branch', () => {
    expect(BRANCH_WIDE_ROLES).toEqual([
      'super_admin',
      'principal',
      'academic_vice_principal',
      'spiritual_vice_principal',
      'head_tutor',
    ]);
  });

  it('compares subject ids without regard to case', () => {
    const access = accessIn(NORTH, [held('head_teacher', NORTH, [MATHEMATICS])]);

    expect(inSubjectScope(access, MATHEMATICS.toUpperCase())).toBeDefined();
  });
});

describe('the assignments that permit a route', () => {
  it('are every one that permits it in the branch, in the order they were read', () => {
    const headTeacher = held('head_teacher', NORTH, [MATHEMATICS]);
    const teacher = held('teacher', NORTH);
    const senior = held('senior_head_teacher', null, [PHYSICS]);
    const elsewhere = held('head_teacher', SOUTH, [PHYSICS]);

    expect(permitting(VIEW, [headTeacher, teacher, senior, elsewhere], NORTH, PERMISSIONS)).toEqual(
      [headTeacher, senior],
    );
  });
});
