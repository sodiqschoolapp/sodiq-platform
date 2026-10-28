import { PERMISSIONS, ROLES, type Role } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import {
  CLASS_SCOPED_AREAS,
  CLASS_WIDE_ROLES,
  classesInScope,
  inClassScope,
  listsBranchStudents,
  NO_PLACES,
  readsAsTeacherOnly,
  studentReaderOf,
} from './class-scope.js';
import type { CurrentAssignment } from './current-assignments.js';
import { permitting } from './permission-check.js';
import type { Access } from './permission.guard.js';

const NORTH = '0199b1c0-0000-7000-8000-00000000000a';
const OXFORD = '0199b1c0-0000-7000-8000-0000000000c1';
const YALE = '0199b1c0-0000-7000-8000-0000000000c2';
const HARVARD = '0199b1c0-0000-7000-8000-0000000000c3';
const ENGLISH_A = '0199b1c0-0000-7000-8000-0000000000d1';
const ENGLISH_B = '0199b1c0-0000-7000-8000-0000000000d2';

let next = 0;
function held(
  role: Role,
  classIds: readonly string[] = [],
  groupIds?: readonly string[],
): CurrentAssignment {
  next += 1;
  return {
    id: `0199b1c0-0000-7000-8000-3000000000${String(next).padStart(2, '0')}`,
    role,
    branchId: role === 'super_admin' || role === 'senior_head_teacher' ? null : NORTH,
    subjectIds: [],
    classIds,
    ...(groupIds === undefined ? {} : { groupIds }),
  };
}

/** The access of a request in North with these assignments. */
function accessOf(...assignments: CurrentAssignment[]): Access {
  const [first] = assignments;
  if (first === undefined) {
    throw new Error('An access has an assignment.');
  }
  return {
    accountId: '0199b1c0-0000-7000-8000-4000000000a1',
    assignmentId: first.id,
    role: first.role,
    branchId: NORTH,
    branchIds: [NORTH],
    assignments,
    permitting: assignments,
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

  it('pins the areas whose routes read the class scope', () => {
    // Task 3.3a widened the list: the History tab reads the class scope.
    expect(CLASS_SCOPED_AREAS).toEqual([
      'classes',
      'students',
      'student_contact',
      'groups',
      'student_history',
      'journal',
      'absence_reasons',
      'rating',
      'early_warning',
      'attendance_today',
      'attendance_report',
      'results_reports',
    ]);
  });

  it('fits a class for the class-wide roles and the Tutor of the class only', () => {
    for (const role of ROLES) {
      const fits = inClassScope([held(role, [OXFORD])], [OXFORD]) !== undefined;
      // Task 3.6a (L48): a Teacher fits the classes the load in force gives.
      expect(fits, role).toBe(
        CLASS_WIDE_ROLES.includes(role) || role === 'tutor' || role === 'teacher',
      );
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

  // Task 3.6a, owner's answer L48 and decision 14 of pull request #118: a
  // Teacher reads the students of the classes and groups taught, Basic only.
  describe('a Teacher (L48)', () => {
    const teacher = held('teacher', [OXFORD], [ENGLISH_A]);

    it('fits a student of a taught class or a taught group, not a classmate in the other group', () => {
      expect(inClassScope([teacher], [OXFORD], [])).toBe(teacher);
      // A student of Yale reached only through the taught group.
      expect(inClassScope([teacher], [YALE], [ENGLISH_A.toUpperCase()])).toBe(teacher);
      // A classmate of Yale in the other group of the split.
      expect(inClassScope([teacher], [YALE], [ENGLISH_B])).toBeUndefined();
      expect(inClassScope([teacher], [], [])).toBeUndefined();
      // A Teacher with nothing taught fits nobody.
      expect(inClassScope([held('teacher')], [OXFORD], [ENGLISH_A])).toBeUndefined();
    });

    it('opens the record of a taught student only, as a Teacher alone', () => {
      const access = accessOf(teacher);
      const taught = { classIds: [YALE], groupIds: [ENGLISH_A] };
      expect(studentReaderOf(access, 'students', taught)).toBe(teacher);
      expect(
        studentReaderOf(access, 'students', { classIds: [YALE], groupIds: [ENGLISH_B] }),
      ).toBeUndefined();
      expect(studentReaderOf(access, 'student_contact', taught)).toBeUndefined();
      expect(studentReaderOf(access, 'student_diagnostic', taught)).toBeUndefined();
      expect(readsAsTeacherOnly(access, taught)).toBe(true);
      expect(listsBranchStudents(access)).toBe(false);
    });

    it('reads a taught student of another class as a Teacher only when also a Tutor', () => {
      const tutor = held('tutor', [HARVARD]);
      const access = accessOf(tutor, teacher);
      const taught = { classIds: [OXFORD], groupIds: [] };
      expect(readsAsTeacherOnly(access, taught)).toBe(true);
      expect(studentReaderOf(access, 'student_contact', taught)).toBeUndefined();
      expect(studentReaderOf(access, 'student_diagnostic', taught)).toBeUndefined();
      // The Tutor's own class is read as the Tutor.
      expect(readsAsTeacherOnly(access, { classIds: [HARVARD], groupIds: [] })).toBe(false);
      expect(listsBranchStudents(access)).toBe(true);
    });

    it('lists the branch for every other reader of students', () => {
      for (const role of ROLES) {
        const access = accessOf(held(role));
        const reads = PERMISSIONS.students[role].includes('view');
        expect(listsBranchStudents(access), role).toBe(reads && role !== 'teacher');
        expect(readsAsTeacherOnly(access, NO_PLACES), role).toBe(false);
      }
    });
  });

  it('gives a Tutor of no class nothing', () => {
    expect(classesInScope([held('tutor')])).toEqual(new Set());
    expect(inClassScope([held('tutor')], [OXFORD])).toBeUndefined();
  });
});
