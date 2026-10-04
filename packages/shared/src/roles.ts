import { z } from 'zod';

/**
 * docs/spec/02-roles-and-access.md: the 15 user types, in the order of its
 * table. The database keeps the same list in a check on `assignments`
 * (db/migrations/0009); a test compares the two.
 */
export const ROLES = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  /** Vice Principal for Spiritual and Moral Education. */
  'spiritual_vice_principal',
  'head_tutor',
  'tutor',
  'senior_head_teacher',
  'head_teacher',
  'teacher',
  'student',
  'parent',
  'hr',
  'nurse',
  'psychologist',
  'librarian',
] as const;

export const roleSchema = z.enum(ROLES);

export type Role = z.infer<typeof roleSchema>;

/**
 * Rules: "Every role is limited to a branch ... Only the Super Admin and the
 * Senior Head Teacher work across branches." An assignment of one of these two
 * has no branch; an assignment of any other role has one.
 */
export const SCHOOL_WIDE_ROLES: readonly Role[] = ['super_admin', 'senior_head_teacher'];

/**
 * The roles with the stricter sign-in: two-step verification is required
 * (Rules) and an idle session ends after 15 minutes instead of 30 (question 41
 * of the open questions).
 */
export const STRICT_SIGN_IN_ROLES: readonly Role[] = ['super_admin', 'academic_vice_principal'];

/** The Super Admin row of the roles table: "At most 3 accounts." */
export const MAX_SUPER_ADMINS = 3;
