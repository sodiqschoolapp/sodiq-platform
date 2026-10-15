/**
 * Phones as a person reads them (task 2.7b-1, finding 24 of the hand test of
 * 13 October 2026): an Uzbek number, "+998" and nine digits, is grouped as
 * "+998 90 111 22 33". Any other value (a foreign number, whose grouping
 * differs by country, `04` Close relatives: "other country codes are
 * accepted") is shown exactly as stored (decision 4).
 */

/** Spaces, brackets and hyphens a person types between digits. */
const SEPARATORS = /[\s()-]/g;

/** The separators `storedPhone` drops: those above and dots (task 3.5b, decision 7). */
const TYPED_SEPARATORS = /[\s().-]/g;

/** The default country code a phone field shows before anything is typed. */
const UZBEK_CODE = '+998';

/**
 * A phone as stored (task 3.5b, H25 of issue #105): an Uzbek number is "+998"
 * and exactly nine digits; a number of another country is "+", its code (not
 * 998) and 7 to 15 digits in all (`04`, Close relatives: "other country codes
 * are accepted"). The check of the database is wider: a plus and 7 to 15
 * digits.
 */
export const PHONE_FORMAT = /^(?:\+998[0-9]{9}|\+(?!998)[0-9]{7,15})$/;

/**
 * A phone as typed, in the one stored form: spaces, dashes, brackets and dots
 * dropped; the prefilled "+998" dropped when a whole number in another written
 * form follows it ("+998 +998…", "+998 998…", "+998 00…", "+998 +7…"); "00"
 * read as "+"; "998" and nine digits given its "+"; nine digits alone read as
 * an Uzbek number. The result may still fail `PHONE_FORMAT`; the schemas
 * refuse it then.
 */
export function storedPhone(typed: string): string {
  let text = typed.replace(TYPED_SEPARATORS, '');
  if (text.startsWith(UZBEK_CODE)) {
    const rest = text.slice(UZBEK_CODE.length);
    if (rest.startsWith('+') || rest.startsWith('00') || /^998[0-9]{9}$/.test(rest)) {
      text = rest;
    }
  }
  if (text.startsWith('00')) {
    return `+${text.slice(2)}`;
  }
  if (/^998[0-9]{9}$/.test(text)) {
    return `+${text}`;
  }
  if (/^[0-9]{9}$/.test(text)) {
    return `${UZBEK_CODE}${text}`;
  }
  return text;
}

/** A field that holds nothing but the prefilled "+998" (or nothing) counts as empty. */
export const phoneLeftEmpty = (typed: string): boolean => {
  const text = typed.replace(TYPED_SEPARATORS, '');
  return text === '' || text === UZBEK_CODE;
};

/** A phone as typed, grouped as a person reads it when it is a whole number; otherwise as typed. */
export function typedPhoneText(typed: string): string {
  const stored = storedPhone(typed);
  return PHONE_FORMAT.test(stored) ? phoneText(stored) : typed;
}

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
