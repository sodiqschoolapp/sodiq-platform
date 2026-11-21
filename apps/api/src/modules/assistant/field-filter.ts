import {
  relativeIdentitySchema,
  relativeRecordSchema,
  STUDENT_EXPORT_GROUPS,
  staffIdentitySchema,
  studentContactSchema,
  studentFinancialSchema,
  studentIdentitySchema,
} from '@sodiq/shared';

/**
 * What never goes to the model (`02`, Assistant: "Passport and birth certificate numbers,
 * medical data, the financial group, phone numbers and addresses, passwords and secrets"),
 * widened by decision 2 of the plan of pull request #374 (Look first) to the whole Contact,
 * Identity and Financial groups and the diagnostic score. Applied to every read before the
 * model is given it, and to the person's own words each time they are sent.
 */

/** The value written in place of a removed one. */
export const REMOVED = '[removed]';

/**
 * The keys removed at any depth, derived from the shared schemas of the groups (plan review,
 * must fix 3), so that a field added to a group is removed without a change here.
 */
export const REMOVED_KEYS: ReadonlySet<string> = new Set(
  [
    ...Object.keys(studentContactSchema.shape),
    ...Object.keys(studentIdentitySchema.shape),
    ...Object.keys(studentFinancialSchema.shape),
    ...Object.keys(staffIdentitySchema.shape),
    ...Object.keys(relativeIdentitySchema.shape),
    ...Object.entries(STUDENT_EXPORT_GROUPS)
      .filter(([, group]) => group !== 'basic')
      .map(([column]) => column),
    // A relative's and a staff record's Contact fields.
    ...Object.keys(relativeRecordSchema.shape).filter((key) => key !== 'fullName'),
    'contractType',
    'contractDate',
    'contractNumber',
    // The group objects of a student's profile.
    'contact',
    'identity',
    'financial',
    'diagnosticScore',
  ].map((key) => key.toLowerCase()),
);

/** Parts of a key that mark a secret or medical data, wherever they are in the key. */
const SECRET_KEY_PARTS = [
  'password',
  'secret',
  'token',
  'totp',
  'recovery',
  'medical',
  'health',
  'phone',
];

/** Whether a key is removed with its value. */
export function isRemovedKey(key: string): boolean {
  const lower = key.toLowerCase();
  return REMOVED_KEYS.has(lower) || SECRET_KEY_PARTS.some((part) => lower.includes(part));
}

/**
 * The keys whose values are free text written by people (comments, notes, reasons, titles,
 * descriptions …): only these are searched for the shapes below in a read (review correction 1
 * of the plan): a date, a year name, a room, a UID or an id elsewhere is never touched.
 */
const FREE_TEXT_KEY_ENDINGS = [
  'text',
  'comment',
  'comments',
  'note',
  'notes',
  'reason',
  'title',
  'description',
  'body',
  'topic',
  'homework',
  'message',
  'summary',
];

export function isFreeTextKey(key: string): boolean {
  const lower = key.toLowerCase();
  return FREE_TEXT_KEY_ENDINGS.some((ending) => lower === ending || lower.endsWith(ending));
}

/** An Uzbek phone in any spacing: +998 and nine digits, or nine digits as 90 123 45 67. */
const UZBEK_PHONE =
  /(?:\+\s?998[\s\-().]*)(?:\d[\s\-().]*){8}\d|\b\d{2}[\s-]\d{3}[\s-]\d{2}[\s-]\d{2}\b/g;
/** Any other run of 9 to 12 digits, a phone written together; free text of a read only. */
const DIGIT_RUN = /(?<![\d.:-])\d{9,12}(?![\d.:-])/g;
/** A JSHSHIR: 14 digits (`jshshirSchema`). */
const JSHSHIR = /(?<!\d)\d{14}(?!\d)/g;
/**
 * A passport or birth certificate number: one to three letters, an optional series after a
 * hyphen, then six to nine digits (AA1234567, AB 1234567, I-TN 1234567). A letter is always
 * needed, so a date, a year name or a room never matches (review correction 1).
 */
const DOCUMENT_NUMBER = /\b[A-Za-z]{1,3}(?:-[A-Za-z]{1,3})?\s?\d{6,9}\b/g;

/** The person's words with the shapes removed; dates, moments, uuids and UIDs stay. */
export function filterWords(text: string): string {
  return text
    .replace(UZBEK_PHONE, REMOVED)
    .replace(JSHSHIR, REMOVED)
    .replace(DOCUMENT_NUMBER, REMOVED);
}

/** A free text of a read: the person's shapes and any run of 9 to 12 digits. */
export function filterFreeText(text: string): string {
  return filterWords(text).replace(DIGIT_RUN, REMOVED);
}

/** A read as the model may be given it: the removed keys left out, free texts filtered. */
export function filterRead(value: unknown): unknown {
  return walk(value, false);
}

function walk(value: unknown, freeText: boolean): unknown {
  if (typeof value === 'string') {
    return freeText ? filterFreeText(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, freeText));
  }
  if (value !== null && typeof value === 'object') {
    const kept: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (!isRemovedKey(key)) {
        kept[key] = walk(inner, freeText || isFreeTextKey(key));
      }
    }
    return kept;
  }
  return value;
}
