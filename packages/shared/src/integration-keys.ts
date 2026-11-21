import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import type { Role } from './roles.js';

/**
 * Integration keys (docs/spec/02-roles-and-access.md, Integration keys; task
 * 10.9, pull request #368): "The Super Admin creates a key with a name (for
 * example "English platform"), a list of people and an end date at most one
 * year ahead. Each person on the list holds the Teacher, Head Teacher or
 * Senior Head Teacher role." Requests made with a key are task 10.10.
 */

/** The longest name of a key; the check of `integration_keys.name` (0175) uses the same bound. */
export const INTEGRATION_KEY_NAME_MAX_LENGTH = 100;

/** The most people on one key (decision 7 of pull request #368). */
export const INTEGRATION_KEY_PEOPLE_MAX = 200;

/**
 * The roles whose assignments count through a key (`02`: "Exactly what their
 * Teacher, Head Teacher and Senior Head Teacher assignments allow"); a person
 * is put on a key only while holding one of them.
 */
export const INTEGRATION_KEY_ROLES = [
  'teacher',
  'head_teacher',
  'senior_head_teacher',
] as const satisfies readonly Role[];

/** The fixed start of every secret (decision 12): not secret, it marks a leaked one. */
export const INTEGRATION_KEY_SECRET_PREFIX = 'sodiq_ik_';

/** The secret as the create answers it: the prefix and 32 random bytes in base64url. */
export const INTEGRATION_KEY_SECRET_FORMAT = /^sodiq_ik_[A-Za-z0-9_-]{43}$/;

const staffRecordIds = z
  .array(z.uuid())
  .min(1)
  .max(INTEGRATION_KEY_PEOPLE_MAX)
  .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
    message: 'Each person once.',
  });

/** What the Super Admin types to create a key. */
export const integrationKeyRecordSchema = z.strictObject({
  name: z.string().trim().min(1).max(INTEGRATION_KEY_NAME_MAX_LENGTH),
  /** The staff records of the people on the key. */
  staffRecordIds,
  /** The last school date the key works, in Asia/Tashkent. */
  endsOn: schoolDateSchema,
});

export type IntegrationKeyRecord = z.infer<typeof integrationKeyRecordSchema>;

/** The whole new list of people of a key. */
export const integrationKeyPeopleSchema = z.strictObject({ staffRecordIds });

export type IntegrationKeyPeople = z.infer<typeof integrationKeyPeopleSchema>;

/** A new end date of a key. */
export const integrationKeyEndDateSchema = z.strictObject({ endsOn: schoolDateSchema });

export type IntegrationKeyEndDate = z.infer<typeof integrationKeyEndDateSchema>;

export const integrationKeyParamsSchema = z.strictObject({ id: z.uuid() });

export type IntegrationKeyParams = z.infer<typeof integrationKeyParamsSchema>;

/** A person on a key, or one who may be put on a key. */
export const integrationKeyPersonSchema = z.object({
  /** The staff record. */
  staffRecordId: z.uuid(),
  /** The staff ID, S-YYNNNN. */
  staffId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  /**
   * Whether the person holds a current Teacher, Head Teacher or Senior Head
   * Teacher assignment, is active and the account is not locked. A person who
   * lost one of these after being put on the key stays on it, with this false
   * (decision 6); requests for them are refused (task 10.10).
   */
  holdsKeyRole: z.boolean(),
});

export type IntegrationKeyPerson = z.infer<typeof integrationKeyPersonSchema>;

/**
 * The state of a key, read from the clock on each request: `ended` once its
 * end date has passed in Asia/Tashkent, `revoked` for good once revoked.
 */
export const INTEGRATION_KEY_STATES = ['active', 'ended', 'revoked'] as const;

export const integrationKeyStateSchema = z.enum(INTEGRATION_KEY_STATES);

export type IntegrationKeyState = z.infer<typeof integrationKeyStateSchema>;

/** A key as the list shows it. Never its secret or the hash of it. */
export const integrationKeySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  people: z.array(integrationKeyPersonSchema),
  endsOn: schoolDateSchema,
  state: integrationKeyStateSchema,
  createdAt: z.iso.datetime({ offset: true }),
  revokedAt: z.iso.datetime({ offset: true }).nullable(),
  /** Empty until a request is made with the key (task 10.10). */
  lastUsedAt: z.iso.datetime({ offset: true }).nullable(),
});

export type IntegrationKey = z.infer<typeof integrationKeySchema>;

export const integrationKeyListSchema = z.object({
  keys: z.array(integrationKeySchema),
  /** Today in Asia/Tashkent and the latest end date a key may take today (decision 5). */
  today: schoolDateSchema,
  latestEndsOn: schoolDateSchema,
});

export type IntegrationKeyList = z.infer<typeof integrationKeyListSchema>;

/** The answer of the create: the key, and its secret this one time. */
export const integrationKeyCreatedSchema = z.object({
  key: integrationKeySchema,
  secret: z.string().regex(INTEGRATION_KEY_SECRET_FORMAT),
});

export type IntegrationKeyCreated = z.infer<typeof integrationKeyCreatedSchema>;

/** The people who may be put on a key now, in every branch. */
export const integrationKeyChoicesSchema = z.object({
  people: z.array(integrationKeyPersonSchema),
});

export type IntegrationKeyChoices = z.infer<typeof integrationKeyChoicesSchema>;

/**
 * The latest end date a key may take on `today` (both ISO dates): the same
 * day and month a year later, and 28 February when today is 29 February
 * (decision 5 of pull request #368: no day of the next year matches it, and
 * the earlier day keeps the end "at most one year ahead").
 */
export function latestIntegrationKeyEnd(today: string): string {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const next = year + 1;
  const leap = (next % 4 === 0 && next % 100 !== 0) || next % 400 === 0;
  const lastDay = month === 2 && day === 29 && !leap ? 28 : day;
  return `${String(next).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}
