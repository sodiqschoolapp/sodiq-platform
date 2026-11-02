import { z } from 'zod';

/**
 * docs/spec/02-roles-and-access.md: the 16 user types, in the order of its
 * table (the Class teacher since the spec change of 1 November 2026, task 9.4e). The database keeps the same list in a check on `assignments`
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
  /** Sinf rahbari: the Tutor of a class of grades 0–4 (task 9.4e). */
  'class_teacher',
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

/**
 * The roles that hold own classes through the Tutor rows of a class
 * (`class_tutors`): the Tutor of a class of grades 5–11 and the Class teacher
 * (Sinf rahbari) of a class of grades 0–4. `edge/00-definitions`, Tutor of a
 * class: "Every rule that names the Tutor of a class … applies in the same
 * way to the Class teacher of a class of grades 0–4." Code that decides own
 * class reads this list, never `'tutor'` alone (task 9.4e; a source test
 * pins it).
 */
export const OWN_CLASS_ROLES = ['tutor', 'class_teacher'] as const satisfies readonly Role[];

export type OwnClassRole = (typeof OWN_CLASS_ROLES)[number];

/** Whether a role holds own classes (the Tutor or the Class teacher). */
export function isOwnClassRole(role: Role): role is OwnClassRole {
  return (OWN_CLASS_ROLES as readonly Role[]).includes(role);
}

/** The last grade that takes a Class teacher in place of a Tutor (`02`, Class teacher: "one class of grades 0–4"). */
export const LAST_CLASS_TEACHER_GRADE = 4;

/**
 * The role a class of the grade takes as its Tutor: the Class teacher for
 * grades 0–4, the Tutor for 5–11 (`edge/people-roles-accounts`: "a class of
 * grades 0–4 takes a Class teacher and a class of grades 5–11 a Tutor").
 * The database answers the same (`own_class_role`, 0152).
 */
export function ownClassRoleFor(grade: number): OwnClassRole {
  return grade <= LAST_CLASS_TEACHER_GRADE ? 'class_teacher' : 'tutor';
}
