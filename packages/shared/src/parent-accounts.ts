import { z } from 'zod';
import { languageSchema } from './language.js';

/**
 * Parent accounts (task 11.1; `10`, Signing in; `edge/close-relatives`): the first-password
 * slips of a class, the reset of a parent's password, the account part of the Parent page
 * and the report of Parent accounts never used.
 */

/** `edge/close-relatives`: a first password of a parent is "valid for 30 days". */
export const PARENT_FIRST_PASSWORD_VALID_DAYS = 30;

/** `edge/close-relatives`: a reset gives "a new one-time password on a slip, valid for 7 days". */
export const PARENT_RESET_PASSWORD_VALID_DAYS = 7;

/** Four slips to an A4 page (`10`, Signing in: "four slips to an A4 page"). */
export const PARENT_SLIPS_PER_PAGE = 4;

/** The most relatives one print names for "print again": more than any class has. */
export const PARENT_PRINT_AGAIN_MAX = 200;

/**
 * Where a relative of a class stands (decision 4 of pull request #292): `to_print` (no
 * account, or a first or reset password that ran out without being changed), `valid_slip` (a
 * slip whose password still works and was not changed: printed again only on "print
 * again"), `signed_in` (the parent chose a password; never printed).
 */
export const PARENT_SLIP_STATES = ['to_print', 'valid_slip', 'signed_in'] as const;

export const parentSlipStateSchema = z.enum(PARENT_SLIP_STATES);

export type ParentSlipState = z.infer<typeof parentSlipStateSchema>;

/**
 * The newest slip of an account, in any branch (must-fix 1 of the spec review of #292). A slip
 * of another branch names no class (decision 15): `otherBranch` true and `className` null.
 */
export const parentSlipSchema = z.object({
  kind: z.enum(['first', 'reset']),
  printedAt: z.iso.datetime(),
  validUntil: z.iso.datetime(),
  valid: z.boolean(),
  otherBranch: z.boolean(),
  className: z.string().nullable(),
});

export type ParentSlip = z.infer<typeof parentSlipSchema>;

/** A child of the class named on the list and on the slip: first and last name only. */
export const parentChildSchema = z.object({
  studentId: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
});

export type ParentChild = z.infer<typeof parentChildSchema>;

/** The slips page of a class: every relative linked with portal access on to a member today. */
export const parentSlipListSchema = z.object({
  classId: z.uuid(),
  className: z.string(),
  relatives: z.array(
    z.object({
      relativeId: z.uuid(),
      fullName: z.string(),
      children: z.array(parentChildSchema),
      state: parentSlipStateSchema,
      login: z.string().nullable(),
      slip: parentSlipSchema.nullable(),
    }),
  ),
});

export type ParentSlipList = z.infer<typeof parentSlipListSchema>;

/**
 * Print the slips of a class in a language: every relative `to_print`, and those named in
 * `printAgain` (relatives of the class with a valid slip, whose earlier password then fails).
 */
export const parentSlipPrintSchema = z.strictObject({
  language: languageSchema,
  printAgain: z
    .array(z.uuid())
    .max(PARENT_PRINT_AGAIN_MAX)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Each id once.' }),
});

export type ParentSlipPrint = z.infer<typeof parentSlipPrintSchema>;

/** One printed slip: shown once, the password stored nowhere. */
export const printedParentSlipSchema = z.object({
  relativeId: z.uuid(),
  fullName: z.string(),
  children: z.array(parentChildSchema),
  login: z.string(),
  password: z.string(),
  kind: z.enum(['first', 'reset']),
  printedAt: z.iso.datetime(),
  validUntil: z.iso.datetime(),
});

export type PrintedParentSlip = z.infer<typeof printedParentSlipSchema>;

/**
 * The answer of a print or a reset: the slips in the language chosen, the class (none for a
 * reset), and the name of the school's Telegram bot, when it is set (decision 10).
 */
export const printedParentSlipsSchema = z.object({
  language: languageSchema,
  className: z.string().nullable(),
  botUsername: z.string().nullable(),
  slips: z.array(printedParentSlipSchema),
});

export type PrintedParentSlips = z.infer<typeof printedParentSlipsSchema>;

/** The reset of a parent's password: the language of the slip. */
export const parentResetSchema = z.strictObject({ language: languageSchema });

export type ParentReset = z.infer<typeof parentResetSchema>;

export const parentRelativeParamsSchema = z.strictObject({ relativeId: z.uuid() });

export type ParentRelativeParams = z.infer<typeof parentRelativeParamsSchema>;

export const parentClassParamsSchema = z.strictObject({ classId: z.uuid() });

export type ParentClassParams = z.infer<typeof parentClassParamsSchema>;

/** The account part of the Parent page. `account` is null before the first print. */
export const parentAccountSchema = z.object({
  account: z
    .object({
      login: z.string(),
      signedIn: z.boolean(),
      lastSignInAt: z.iso.datetime().nullable(),
      slip: parentSlipSchema.nullable(),
    })
    .nullable(),
});

export type ParentAccount = z.infer<typeof parentAccountSchema>;

/** The report of Parent accounts never used: no password ever chosen (decision 8). */
export const parentsNeverUsedSchema = z.object({
  accounts: z.array(
    z.object({
      relativeId: z.uuid(),
      fullName: z.string(),
      login: z.string(),
      children: z.array(parentChildSchema),
      slip: parentSlipSchema.nullable(),
      expired: z.boolean(),
    }),
  ),
});

export type ParentsNeverUsed = z.infer<typeof parentsNeverUsedSchema>;
