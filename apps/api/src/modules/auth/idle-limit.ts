import { STRICT_SIGN_IN_ROLES, type Role } from '@sodiq/shared';

/** Question 41 of the open questions: idle sessions end after 30 minutes. */
export const IDLE_LIMIT_MS = 30 * 60 * 1000;

/** 15 minutes for the Super Admin and the Academic Vice Principal. */
export const SHORT_IDLE_LIMIT_MS = 15 * 60 * 1000;

/**
 * How long a session of a person with these roles may stay without use. One
 * role with the short limit is enough: the person can act in that role at any
 * moment, whatever the role switcher shows.
 */
export function idleLimitMs(roles: readonly Role[]): number {
  return roles.some((role) => STRICT_SIGN_IN_ROLES.includes(role))
    ? SHORT_IDLE_LIMIT_MS
    : IDLE_LIMIT_MS;
}
