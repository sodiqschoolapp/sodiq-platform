import { PERMISSIONS, searchWords, spellingKey } from '@sodiq/shared';
import { decide } from '../access/permission-check.js';
import type { Access } from '../access/permission.guard.js';
import { superAdminOf, viceOf } from './staff.service.js';

/**
 * How Ctrl+K compares a typed text with a person's fields (task 3.2d, pull
 * request #94). Names: every typed word folded by `spellingKey` is found in
 * the folded names (answer 18; `edge/journal`: "Search ignores which
 * apostrophe was typed and matches Cyrillic with Latin"), as the lists search.
 */
export function namesMatch(typed: string, names: readonly (string | null)[]): boolean {
  const words = searchWords(typed);
  if (words === null) {
    return false;
  }
  const haystack = spellingKey(names.filter((name) => name !== null).join(' '));
  return words.every((word) => haystack.includes(word));
}

/**
 * The account searches by phone and document number (`edge/people-roles-
 * accounts`, the Ctrl+K row: "Search by phone or document number is for the
 * Super Admin and Academic Vice Principal"; decision 2, Look first): decided
 * by those roles, as the staff record decides its phone, never by an action of
 * the permission table. Answers the assignment, or `undefined`.
 */
export const identitySearcherOf = (access: Access): string | undefined =>
  superAdminOf(access) ?? viceOf(access);

/** Spaces, brackets and hyphens a person types between the digits of a phone. */
const PHONE_TYPED = /^\+?[0-9\s()-]+$/;

/**
 * A phone found by the digits typed, from 4 of them, contained anywhere in
 * the stored number (decision 11).
 */
export function phoneMatches(typed: string, stored: string | null): boolean {
  if (stored === null || !PHONE_TYPED.test(typed)) {
    return false;
  }
  const digits = typed.replace(/[^0-9]/g, '');
  return digits.length >= 4 && stored.replace(/[^0-9]/g, '').includes(digits);
}

/** A JSHSHIR found only as a whole: its 14 digits, spaces ignored (decisions 2 and 11). */
export function jshshirMatches(typed: string, stored: string | null): boolean {
  return stored !== null && typed.replace(/\s+/g, '') === stored;
}

/**
 * A document number found only as a whole (decision 11): spaces and hyphens
 * dropped on both sides, case folded, so "AB-1234567" finds "AB1234567".
 */
export function documentMatches(typed: string, stored: string | null): boolean {
  if (stored === null) {
    return false;
  }
  const key = (text: string): string => text.replace(/[\s-]+/g, '').toUpperCase();
  return key(typed).length >= 4 && key(typed) === key(stored);
}

/** Two ids in one total order, as the fold keys tie-break. */
export const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The account searches relatives and finds a student by a relative's main
 * phone (task 3.5b, H33 of issue #105; `edge/people-roles-accounts`, the
 * Ctrl+K row: "Relatives' phones are searched too, for the Super Admin, the
 * Principal and the Academic Vice Principal"): the readers of the area
 * `relatives` in the branch of the request. Answers the assignment, or
 * `undefined`.
 */
export const relativeSearcherOf = (access: Access): string | undefined =>
  decide(
    { area: 'relatives', action: 'view', branch: 'request' },
    access.assignments,
    access.branchId,
    PERMISSIONS,
  )?.id;
