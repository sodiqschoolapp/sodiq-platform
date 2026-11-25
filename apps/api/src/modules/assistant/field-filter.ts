import {
  ASSISTANT_DATA_GROUPS,
  relativeIdentitySchema,
  relativeRecordSchema,
  STUDENT_EXPORT_GROUPS,
  staffIdentitySchema,
  studentContactSchema,
  studentFinancialSchema,
  studentIdentitySchema,
  type AssistantDataGroup,
} from '@sodiq/shared';

/**
 * What reaches the model (task 11.20; `02`, Assistant, "Never, whatever the switches": "The model
 * never sees a secret: a password, a first or one-time password, recovery codes, the secret of an
 * integration key, a session"; "Personal data and the model": "What the person may read, the
 * assistant may read and send to the model, personal data included … The Super Admin can keep
 * any of these groups from the model, each with its own switch … A group switched off reaches
 * the model as '[removed]'. All are on at the start.").
 *
 * Two parts: the floor (`isSecretKey`), removed from every answer whatever the switches, and the
 * six groups, removed only while the Super Admin has switched them off. Applied to every answer
 * that reaches the model (a read, a preview, a step's answer, an answer of `find_actions`) and to
 * the person's own words (plan review 10).
 */

/** The value written in place of a removed one. */
export const REMOVED = '[removed]';

/** The value written in place of a secret: the person sees it once, the model never. */
export const SECRET_SHOWN = '[secret: shown to the person only]';

/**
 * The floor (plan, "The floor"; review 4): the keys of an answer that hold a secret. The answers
 * of `@Requires` routes that give one out: a first-password slip (`password`), a printed parent
 * slip (`password`), a created integration key (`secret`); the own-account routes (the TOTP
 * `secret`, `recoveryCodes`, a reset `token`, a password change) are on no list and are covered
 * anyway. `secret-fields.test.ts` walks every listed route's answer schema and fails on a key
 * with one of the parts of `SECRET_KEY_HINTS` that this does not remove and that is not named
 * there as no secret.
 */
const SECRET_KEYS: ReadonlySet<string> = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'secret',
  'recoverycodes',
  'token',
  'sessiontoken',
  'sessionid',
  'cookie',
]);

/** Parts that mark a secret wherever they are in a key. */
const SECRET_PARTS = ['password', 'secret', 'token', 'totp', 'recoverycode', 'cookie'];

/** Whether a key holds a secret: removed from every answer, whatever the switches. */
export function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_KEYS.has(lower) || SECRET_PARTS.some((part) => lower.includes(part));
}

/** The parts the walk of `secret-fields.test.ts` looks for (review 4: a session named). */
export const SECRET_KEY_HINTS = ['password', 'secret', 'token', 'totp', 'recovery', 'session'];

const lower = (keys: readonly string[]): ReadonlySet<string> =>
  new Set(keys.map((key) => key.toLowerCase()));

const exportColumns = (group: string): string[] =>
  Object.entries(STUDENT_EXPORT_GROUPS)
    .filter(([, of]) => of === group)
    .map(([column]) => column);

/** A person's address and its region: Contact in `02`. */
const ADDRESS_KEYS: readonly string[] = ['address', 'region'];

/** The relatives' keys of a student's record and export (plan decision 9). */
const RELATIVE_KEYS = [
  'relatives',
  'relative',
  'otherRelatives',
  'mainContact',
  'mainContactName',
  'mainContactRelationship',
  'mainContactPhone',
  'mainContactExtraPhones',
  'parents',
  'parent',
];

/**
 * The keys of each group, at any depth, derived from the shared schemas of the groups (11.12
 * plan review, must fix 3), so that a field added to a group is removed without a change here.
 */
export const GROUP_KEYS: Readonly<Record<AssistantDataGroup, ReadonlySet<string>>> = {
  // `02`: "contact (phones, emails, addresses)": the address and its region are Contact here,
  // though the student record files them under Identity (code review must fix 1).
  contact: lower([
    ...Object.keys(studentContactSchema.shape),
    ...ADDRESS_KEYS,
    ...exportColumns('contact').filter((key) => !RELATIVE_KEYS.includes(key)),
    'contact',
    'phones',
    'extraPhones',
    'emails',
  ]),
  identity: lower(
    [
      ...Object.keys(studentIdentitySchema.shape),
      ...Object.keys(staffIdentitySchema.shape),
      ...exportColumns('identity'),
      'identity',
    ].filter((key) => !ADDRESS_KEYS.includes(key)),
  ),
  financial: lower([
    ...Object.keys(studentFinancialSchema.shape),
    ...exportColumns('financial'),
    'financial',
    'contractType',
    'contractDate',
    'contractNumber',
    'contracts',
    'contract',
    'scholarship',
    'stipend',
    'stipends',
  ]),
  diagnostic: lower([...exportColumns('diagnostic'), 'diagnosticScore']),
  medical: lower(['medical']),
  // A relative's own fields that no student or staff record has; a relative's phone and email
  // are inside the lists removed by key, and a read of a relatives' area is removed whole.
  relatives: lower([
    ...RELATIVE_KEYS,
    ...Object.keys(relativeIdentitySchema.shape).filter((key) => key !== 'email'),
    ...Object.keys(relativeRecordSchema.shape).filter(
      (key) => !['fullName', 'phone', 'email', 'extraPhones'].includes(key),
    ),
  ]),
};

/** Parts of a key that mark a group wherever they are in the key. */
const GROUP_PARTS: Readonly<Partial<Record<AssistantDataGroup, readonly string[]>>> = {
  contact: ['phone'],
  medical: ['medical', 'health'],
};

/**
 * The areas of the permission table whose whole answer is relatives' details: a read of one of
 * them reaches the model as "[removed]" while the group is off (plan decision 9).
 */
export const RELATIVE_AREAS: readonly string[] = ['relatives', 'parent_accounts'];

/**
 * The keys whose values are free text written by people (comments, notes, reasons, titles,
 * descriptions …): only these are searched for the shapes below in a read (11.12 review
 * correction 1): a date, a year name, a room, a UID or an id elsewhere is never touched.
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
  const lowerKey = key.toLowerCase();
  return FREE_TEXT_KEY_ENDINGS.some((ending) => lowerKey === ending || lowerKey.endsWith(ending));
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
 * needed, so a date, a year name or a room never matches.
 */
const DOCUMENT_NUMBER = /\b[A-Za-z]{1,3}(?:-[A-Za-z]{1,3})?\s?\d{6,9}\b/g;

/** What one question may send to the model, from the Super Admin's six switches. */
export class ModelFilter {
  private readonly off: ReadonlySet<AssistantDataGroup>;

  constructor(groupsOn: readonly AssistantDataGroup[]) {
    this.off = new Set(ASSISTANT_DATA_GROUPS.filter((group) => !groupsOn.includes(group)));
  }

  /** Whether a group is switched off. */
  removes(group: AssistantDataGroup): boolean {
    return this.off.has(group);
  }

  /** Whether a key is removed with its value: a secret, or a key of a group switched off. */
  removesKey(key: string): boolean {
    if (isSecretKey(key)) return true;
    const lowerKey = key.toLowerCase();
    for (const group of this.off) {
      if (GROUP_KEYS[group].has(lowerKey)) return true;
      if ((GROUP_PARTS[group] ?? []).some((part) => lowerKey.includes(part))) return true;
    }
    return false;
  }

  /** The person's words with the shapes of the groups switched off removed. */
  words(text: string): string {
    let out = text;
    if (this.off.has('contact')) out = out.replace(UZBEK_PHONE, REMOVED);
    if (this.off.has('identity')) {
      out = out.replace(JSHSHIR, REMOVED).replace(DOCUMENT_NUMBER, REMOVED);
    }
    return out;
  }

  /** A free text of an answer: the person's shapes, and a run of 9 to 12 digits for contact. */
  freeText(text: string): string {
    const out = this.words(text);
    return this.off.has('contact') ? out.replace(DIGIT_RUN, REMOVED) : out;
  }

  /**
   * An answer as the model may be given it: secrets marked, the keys of the groups off left
   * out, free texts filtered. A read of a relatives' area while that group is off is removed
   * whole.
   */
  read(value: unknown, area?: string): unknown {
    if (area !== undefined && RELATIVE_AREAS.includes(area) && this.off.has('relatives')) {
      return REMOVED;
    }
    return this.walk(value, false);
  }

  private walk(value: unknown, freeText: boolean): unknown {
    if (typeof value === 'string') {
      return freeText ? this.freeText(value) : value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.walk(item, freeText));
    }
    if (value !== null && typeof value === 'object') {
      const kept: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value)) {
        if (isSecretKey(key)) {
          kept[key] = SECRET_SHOWN;
        } else if (!this.removesKey(key)) {
          kept[key] = this.walk(inner, freeText || isFreeTextKey(key));
        }
      }
      return kept;
    }
    return value;
  }
}

/** Every group off: the strictest filter, for texts kept outside a question (the audit log). */
export const STRICT_FILTER = new ModelFilter([]);

/** Every group on: the filter of a school that switched nothing off (the start). */
export const OPEN_FILTER = new ModelFilter(ASSISTANT_DATA_GROUPS);

/** The person's words with every shape removed (the audit log, a title, a place's free text). */
export function filterWords(text: string): string {
  return STRICT_FILTER.words(text);
}

/**
 * The keys of a secret an answer gives out (a slip's password, a key's secret, recovery codes):
 * exact keys, so that a moment such as `passwordValidUntil` is no slip (code review should fix 9).
 */
const GIVEN_SECRET_KEYS: readonly string[] = ['password', 'secret', 'recoveryCodes', 'token'];

/**
 * The secrets of a step's answer (plan, "The floor"): each object that holds a secret, with its
 * own plain values (the slip: name, login, password, valid until), for the person only. The
 * answer itself is never stored; `ModelFilter.read` marks them for the model.
 */
export function secretsOf(value: unknown): Record<string, string | number | boolean | null>[] {
  const found: Record<string, string | number | boolean | null>[] = [];
  const walk = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(walk);
      return;
    }
    if (item === null || typeof item !== 'object') return;
    const entries = Object.entries(item);
    if (entries.some(([key, inner]) => GIVEN_SECRET_KEYS.includes(key) && inner !== null)) {
      found.push(
        Object.fromEntries(
          entries.filter(
            ([, inner]) =>
              inner === null ||
              typeof inner === 'string' ||
              typeof inner === 'number' ||
              typeof inner === 'boolean',
          ),
        ),
      );
    }
    for (const [, inner] of entries) walk(inner);
  };
  walk(value);
  return found;
}
