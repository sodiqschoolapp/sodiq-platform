import { describe, expect, it } from 'vitest';
import {
  GIVABLE_ROLES,
  LOGIN_MAX_LENGTH,
  accountCreateSchema,
  roleGiveSchema,
  subjectsChangeSchema,
} from './accounts.js';

// Task 2.3a, pull request #62.
describe('accounts', () => {
  // Answer 14 and decision 2: the four forms, lower-case letters only.
  it.each(['a.karimov', 'akmal.karimov', 'akmal.b.karimov', 'akmal.karimov2', 'a.karimov12'])(
    'accept the login %s',
    (login) => {
      expect(accountCreateSchema.safeParse({ login }).success).toBe(true);
    },
  );

  it.each([
    'karimov',
    'A.karimov',
    'a.karimov.',
    '.karimov',
    'a..karimov',
    'a.b.c.karimov',
    'a.kärimov',
    'a.karimov 2',
    'a.2karimov',
    'а.каримов',
  ])('refuse the login %s', (login) => {
    expect(accountCreateSchema.safeParse({ login }).success).toBe(false);
  });

  it(`refuse a login over ${String(LOGIN_MAX_LENGTH)} characters`, () => {
    const longest = `a.${'k'.repeat(LOGIN_MAX_LENGTH - 2)}`;
    expect(accountCreateSchema.safeParse({ login: longest }).success).toBe(true);
    expect(accountCreateSchema.safeParse({ login: `${longest}k` }).success).toBe(false);
  });

  // Decision 6 of #62; the Head Teacher and the Senior Head Teacher with their subjects (2.3b-1).
  it('give the roles of 2.3a and 2.3b-1 and refuse the others', () => {
    expect(GIVABLE_ROLES).toEqual([
      'super_admin',
      'principal',
      'academic_vice_principal',
      'spiritual_vice_principal',
      'head_tutor',
      'tutor',
      'senior_head_teacher',
      'head_teacher',
      'teacher',
    ]);
    for (const role of ['student', 'parent', 'hr']) {
      expect(
        roleGiveSchema.safeParse({ role, branchId: null, from: '2026-10-12' }).success,
        role,
      ).toBe(false);
    }
  });

  describe('subjects of an appointment', () => {
    const subject = '019a0000-0000-7000-8000-000000000001';
    const other = '019a0000-0000-7000-8000-000000000002';
    const give = (role: string, subjectIds?: string[]) =>
      roleGiveSchema.safeParse({
        role,
        branchId: null,
        from: '2026-10-12',
        ...(subjectIds === undefined ? {} : { subjectIds }),
      }).success;

    it('are required for a Head Teacher and a Senior Head Teacher', () => {
      expect(give('head_teacher', [subject, other])).toBe(true);
      expect(give('senior_head_teacher', [subject])).toBe(true);
      expect(give('head_teacher')).toBe(false);
      expect(give('senior_head_teacher', [])).toBe(false);
    });

    it('are refused for every other role', () => {
      expect(give('teacher', [subject])).toBe(false);
      expect(give('teacher')).toBe(true);
    });

    it('name each subject once', () => {
      expect(give('head_teacher', [subject, subject.toUpperCase()])).toBe(false);
      expect(subjectsChangeSchema.safeParse({ subjectIds: [subject], from: '2026-10-12' }).success).toBe(
        true,
      );
      expect(subjectsChangeSchema.safeParse({ subjectIds: [], from: '2026-10-12' }).success).toBe(false);
    });
  });
});
