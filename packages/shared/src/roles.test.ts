import { describe, expect, it } from 'vitest';
import { ROLES, roleSchema, SCHOOL_WIDE_ROLES, STRICT_SIGN_IN_ROLES } from './roles.js';

// docs/spec/02-roles-and-access.md: "There are 15 user types."
describe('the roles', () => {
  it('are 15, each named once', () => {
    expect(ROLES).toHaveLength(15);
    expect(new Set(ROLES).size).toBe(15);
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
