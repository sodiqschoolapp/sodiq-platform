/**
 * Phones as a person reads them (task 2.7b-1, finding 24 of the hand test of
 * 13 October 2026): an Uzbek number, "+998" and nine digits, is grouped as
 * "+998 90 111 22 33". Any other value (a foreign number, whose grouping
 * differs by country, `04` Close relatives: "other country codes are
 * accepted") is shown exactly as stored (decision 4).
 */

/** Spaces, brackets and hyphens a person types between digits. */
const SEPARATORS = /[\s()-]/g;

const UZBEK_NUMBER = /^\+998([0-9]{2})([0-9]{3})([0-9]{2})([0-9]{2})$/;

/** A stored phone as shown on a screen and in an export. */
export function phoneText(stored: string): string {
  const parts = UZBEK_NUMBER.exec(stored.replace(SEPARATORS, ''));
  if (parts === null) {
    return stored;
  }
  return `+998 ${parts.slice(1).join(' ')}`;
}

/** The digits of a phone as typed, for a search that ignores the spacing. */
export const phoneDigits = (typed: string): string => typed.replace(SEPARATORS, '');
