/** Question 41 of the open questions: idle sessions end after 30 minutes. */
export const IDLE_LIMIT_MS = 30 * 60 * 1000;

/** 15 minutes for the Super Admin and the Academic Vice Principal. */
export const SHORT_IDLE_LIMIT_MS = 15 * 60 * 1000;

/**
 * The roles with the short limit. Task 0.7 brings the 15 roles and replaces
 * these two names with its own.
 */
export const SHORT_IDLE_ROLES: readonly string[] = ['super_admin', 'academic_vice_principal'];

/**
 * How long a session of a person with these roles may stay without use. One
 * role with the short limit is enough: the person can act in that role at any
 * moment, whatever the role switcher shows.
 */
export function idleLimitMs(roles: readonly string[]): number {
  return roles.some((role) => SHORT_IDLE_ROLES.includes(role))
    ? SHORT_IDLE_LIMIT_MS
    : IDLE_LIMIT_MS;
}
