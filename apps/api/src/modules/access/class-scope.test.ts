import { PERMISSIONS, ROLES, type Role } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { CLASS_WIDE_ROLES, classesInScope, inClassScope } from './class-scope.js';
import type { CurrentAssignment } from './current-assignments.js';
import { permitting } from './permission-check.js';

const NORTH = '0199b1c0-0000-7000-8000-00000000000a';
const OXFORD = '0199b1c0-0000-7000-8000-0000000000c1';
const YALE = '0199b1c0-0000-7000-8000-0000000000c2';
const HARVARD = '0199b1c0-0000-7000-8000-0000000000c3';

let next = 0;
function held(role: Role, classIds: readonly string[] = []): CurrentAssignment {
  next += 1;
  return {
    id: `0199b1c0-0000-7000-8000-3000000000${String(next).padStart(2, '0')}`,
    role,
    branchId: role === 'super_admin' || role === 'senior_head_teacher' ? null : NORTH,
    subjectIds: [],
    classIds,
  };
}

// docs/spec/02-roles-and-access.md, the Tutor row: "Own class or classes ...
// the profiles of own class"; task 3.1c, decisions 1, 7 and 11 of pull
// request #90.
describe('class scope', () => {
  it('pins the roles whose limit is not a class', () => {
    expect([...CLASS_WIDE_ROLES].sort()).toEqual(
      [
        'academic_vice_principal',
        'head_teacher',
        'head_tutor',
        'principal',
        'senior_head_teacher',
        'spiritual_vice_principal',
        'super_admin',
      ].sort(),
    );
  });

  it('fits a class for the class-wide roles and the Tutor of the class only', () => {
    for (const role of ROLES) {
      const fits = inClassScope([held(role, [OXFORD])], [OXFORD]) !== undefined;
      expect(fits, role).toBe(CLASS_WIDE_ROLES.includes(role) || role === 'tutor');
      // Another class: the class-wide roles only.
      expect(inClassScope([held(role, [OXFORD])], [YALE]) !== undefined, role).toBe(
        CLASS_WIDE_ROLES.includes(role),
      );
      // A student of no class: the class-wide roles only.
      expect(inClassScope([held(role, [OXFORD])], []) !== undefined, role).toBe(
        CLASS_WIDE_ROLES.includes(role),
      );
    }
  });

  it('gives a Tutor of two classes both, and compares ids in small letters', () => {
    const tutor = held('tutor', [OXFORD, YALE]);
    expect(inClassScope([tutor], [YALE.toUpperCase()])).toBe(tutor);
    expect(inClassScope([tutor], [HARVARD])).toBeUndefined();
    expect(classesInScope([tutor])).toEqual(new Set([OXFORD, YALE]));
  });

  it('decides from every assignment given: a Tutor who is also Head Teacher fits every class', () => {
    const tutor = held('tutor', [OXFORD]);
    const headTeacher = held('head_teacher');
    expect(inClassScope([tutor, headTeacher], [YALE])).toBe(headTeacher);
    expect(inClassScope([tutor, headTeacher], [OXFORD])).toBe(tutor);
    expect(classesInScope([tutor, headTeacher])).toBe('all');
    // Contact is read through the Tutor only: the Head Teacher does not read it.
    const readers = permitting(
      { area: 'student_contact', action: 'view', branch: 'request' },
      [tutor, headTeacher],
      NORTH,
      PERMISSIONS,
    );
    expect(inClassScope(readers, [YALE])).toBeUndefined();
    expect(inClassScope(readers, [OXFORD])).toBe(tutor);
  });

  it('gives a Tutor of no class nothing', () => {
    expect(classesInScope([held('tutor')])).toEqual(new Set());
    expect(inClassScope([held('tutor')], [OXFORD])).toBeUndefined();
  });
});
