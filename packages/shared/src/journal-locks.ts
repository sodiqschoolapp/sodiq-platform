import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { journalSubjectSchema, journalUnitSchema } from './journal.js';

/**
 * Unlock requests and the branch-wide extension of the edit period (task 8.4,
 * pull request #222; `07`, Editing rules and locks; `edge/journal`, Locks,
 * unlocks and corrections: "The teacher sends an unlock request ... approves
 * and sets 1 to 7 days. The unlock covers that lesson and that person only";
 * `edge/system-behaviour`: "extends the edit period for a date range for the
 * whole branch in one logged action").
 */

/** `edge/journal`: "approves and sets 1 to 7 days" (`journal_unlocks_days_check`, 0122). */
export const UNLOCK_DAYS_MIN = 1;
export const UNLOCK_DAYS_MAX = 7;

export const UNLOCK_REASON_MAX_LENGTH = 500;

const reasonSchema = z.string().trim().min(1).max(UNLOCK_REASON_MAX_LENGTH);

const daysSchema = z.int().min(UNLOCK_DAYS_MIN).max(UNLOCK_DAYS_MAX);

/** `cancelled` is read, never stored: the person is no longer active in the branch (decision 7). */
export const UNLOCK_STATUSES = ['sent', 'approved', 'refused', 'withdrawn', 'cancelled'] as const;

export type UnlockStatus = (typeof UNLOCK_STATUSES)[number];

export const journalUnlockSchema = z.object({
  id: z.uuid(),
  target: z.enum(['lesson', 'rating']),
  /** The lesson of a lesson's request; `null` for a rating exam. */
  lessonId: z.uuid().nullable(),
  journalId: z.uuid().nullable(),
  /** The quarter of a rating exam's request. */
  quarterId: z.uuid().nullable(),
  /** The lesson's date, or the rating exam's date in force (`null` without one). */
  date: schoolDateSchema.nullable(),
  unit: journalUnitSchema,
  subject: journalSubjectSchema,
  /** The person the unlock covers. */
  person: z.string(),
  reason: z.string(),
  requestedAt: z.iso.datetime({ offset: true }),
  status: z.enum(UNLOCK_STATUSES),
  days: z.int().min(UNLOCK_DAYS_MIN).max(UNLOCK_DAYS_MAX).nullable(),
  /** The end of an approved unlock: 00:00 of the branch day after its last day. */
  openUntil: z.iso.datetime({ offset: true }).nullable(),
  /** An approved unlock still open now. */
  open: z.boolean(),
  decidedBy: z.string().nullable(),
  decidedAt: z.iso.datetime({ offset: true }).nullable(),
  refuseReason: z.string().nullable(),
  version: z.int().min(1),
  /** The reader may decide it now (`02`, Who approves; never their own). */
  canDecide: z.boolean(),
  /** The reader sent it and it waits. */
  canWithdraw: z.boolean(),
});

export type JournalUnlock = z.infer<typeof journalUnlockSchema>;

/** `deciding`: the requests the reader may decide now; `own`: the reader's; `branch`: all of the branch. */
export const UNLOCK_VIEWS = ['deciding', 'own', 'branch'] as const;

export const journalUnlocksQuerySchema = z.strictObject({ view: z.enum(UNLOCK_VIEWS) });

export type JournalUnlocksQuery = z.infer<typeof journalUnlocksQuerySchema>;

export const journalUnlocksSchema = z.object({ requests: z.array(journalUnlockSchema) });

export type JournalUnlocks = z.infer<typeof journalUnlocksSchema>;

export const unlockParamsSchema = z.object({ unlockId: z.uuid() });

export type UnlockParams = z.infer<typeof unlockParamsSchema>;

export const lessonUnlockParamsSchema = z.object({ lessonId: z.uuid() });

export type LessonUnlockParams = z.infer<typeof lessonUnlockParamsSchema>;

export const unlockCreateSchema = z.strictObject({ reason: reasonSchema });

export type UnlockCreate = z.infer<typeof unlockCreateSchema>;

export const unlockDecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('approve'), days: daysSchema, version: z.int().min(1) }),
  z.strictObject({
    decision: z.literal('refuse'),
    reason: reasonSchema.nullable(),
    version: z.int().min(1),
  }),
]);

export type UnlockDecision = z.infer<typeof unlockDecisionSchema>;

export const unlockWithdrawSchema = z.strictObject({ version: z.int().min(1) });

export type UnlockWithdraw = z.infer<typeof unlockWithdrawSchema>;

export const editExtensionCreateSchema = z
  .strictObject({
    fromDate: schoolDateSchema,
    toDate: schoolDateSchema,
    days: daysSchema,
    reason: reasonSchema,
  })
  .refine((value) => value.fromDate <= value.toDate, {
    message: 'The first day comes before the last.',
    path: ['toDate'],
  });

export type EditExtensionCreate = z.infer<typeof editExtensionCreateSchema>;

export const editExtensionSchema = z.object({
  id: z.uuid(),
  fromDate: schoolDateSchema,
  toDate: schoolDateSchema,
  days: daysSchema,
  openUntil: z.iso.datetime({ offset: true }),
  reason: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});

export type EditExtension = z.infer<typeof editExtensionSchema>;

export const editExtensionsSchema = z.object({ extensions: z.array(editExtensionSchema) });

export type EditExtensions = z.infer<typeof editExtensionsSchema>;
