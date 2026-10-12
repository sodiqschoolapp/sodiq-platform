import { describe, expect, it } from 'vitest';
import {
  GIVABLE_ROLES,
  LOGIN_MAX_LENGTH,
  accountCreateSchema,
  roleGiveSchema,
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

  // Decision 6: Head Teachers and Senior Head Teachers come with their subjects (2.3b).
  it('give the roles of 2.3a and refuse the others', () => {
    expect(GIVABLE_ROLES).toEqual([
      'super_admin',
      'principal',
      'academic_vice_principal',
      'spiritual_vice_principal',
      'head_tutor',
      'tutor',
      'teacher',
    ]);
    for (const role of ['head_teacher', 'senior_head_teacher', 'student', 'parent', 'hr']) {
      expect(
        roleGiveSchema.safeParse({ role, branchId: null, from: '2026-10-12' }).success,
        role,
      ).toBe(false);
    }
  });
});
