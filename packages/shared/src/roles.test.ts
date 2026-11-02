import { describe, expect, it } from 'vitest';
import {
  isOwnClassRole,
  OWN_CLASS_ROLES,
  ownClassRoleFor,
  ROLES,
  roleSchema,
  SCHOOL_WIDE_ROLES,
  STRICT_SIGN_IN_ROLES,
} from './roles.js';

// docs/spec/02-roles-and-access.md: "There are 16 user types." (the spec change of 1 November 2026)
describe('the roles', () => {
  it('are 16, each named once', () => {
    expect(ROLES).toHaveLength(16);
    expect(new Set(ROLES).size).toBe(16);
  });

  // 02, Class teacher (Sinf rahbari); edge/00-definitions, Tutor of a class (task 9.4e).
  it('hold own classes as the Tutor and the Class teacher only', () => {
    expect([...OWN_CLASS_ROLES]).toEqual(['tutor', 'class_teacher']);
    expect(ROLES.filter((role) => isOwnClassRole(role))).toEqual(['tutor', 'class_teacher']);
  });

  // edge/people-roles-accounts: a class of grades 0–4 takes a Class teacher, of 5–11 a Tutor.
  it.each([
    [0, 'class_teacher'],
    [1, 'class_teacher'],
    [4, 'class_teacher'],
    [5, 'tutor'],
    [11, 'tutor'],
  ] as const)('give a class of grade %i the role %s', (grade, role) => {
    expect(ownClassRoleFor(grade)).toBe(role);
  });

  it('are written in small letters and underscores, as the database stores them', () => {
    for (const role of ROLES) {
      expect(role).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it.each([
    ['a role that does not exist', 'accountant'],
    ['a role in capital letters', 'Teacher'],
    ['an empty text', ''],
    ['null', null],
  ])('do not include %s', (_name, value) => {
    expect(roleSchema.safeParse(value).success).toBe(false);
  });

  // Rules: only the Super Admin and the Senior Head Teacher work across branches.
  it('without a branch are the Super Admin and the Senior Head Teacher', () => {
    expect([...SCHOOL_WIDE_ROLES].sort()).toEqual(['senior_head_teacher', 'super_admin']);
  });

  // Rules: two-step verification is required for the Super Admin and Academic Vice Principal.
  it('with the stricter sign-in are the Super Admin and the Academic Vice Principal', () => {
    expect([...STRICT_SIGN_IN_ROLES].sort()).toEqual(['academic_vice_principal', 'super_admin']);
  });
});
