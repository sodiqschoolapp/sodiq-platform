import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { AUDIT_MAX_RANGE_DAYS } from './audit.js';
import { COMMENT_VISIBILITIES, ratingEntryValueSchema } from './journal-rating.js';

/**
 * The reports over the journal cells (task 6.1c, pull request #209): the
 * report of entries made within 48 hours of a password reset
 * (edge-cases/people-roles-accounts, Accounts and sign-in: "A report lists
 * entries made within 48 hours of a reset") and the cells of the student's
 * personal data report.
 */

/** How a cell's value came (0108, 0111): the cell's `changed_how` and the history's. */
export const CELL_CHANGES = [
  'entry',
  'late_entry',
  'correction',
  'exemption',
  'transfer',
  'cancellation',
  'not_held',
  'offline_entry',
  'undo',
  'restored',
  'forced_delete',
  // Task 8.6 (0127): a value voided by a leaving; named in the support view (task 8.9).
  'leaving',
] as const;

export const cellChangeSchema = z.enum(CELL_CHANGES);

export type CellChange = z.infer<typeof cellChangeSchema>;

/** The kinds of work a cell can belong to (0108); an attendance cell has none. */
export const cellWorkKindSchema = z.enum(['classwork', 'homework']);

const threeNamesSchema = z.strictObject({ uz: z.string(), ru: z.string(), en: z.string() });

/** A person named by an account: the login always, the name through `audit_names` (decision 11). */
export const accountNamedSchema = z.strictObject({
  accountId: z.uuid(),
  login: z.string().nullable(),
  name: z.string().nullable(),
});

export type AccountNamed = z.infer<typeof accountNamedSchema>;

/**
 * The lesson of a cell or a line, `null` once the lesson is gone (a forced
 * delete that was not restored): its date, start, subject and class or group.
 */
export const cellLessonSchema = z
  .strictObject({
    date: schoolDateSchema,
    startsAt: z.iso.datetime(),
    subject: threeNamesSchema,
    /** "7 Oxford" or the group's name. */
    taughtTo: z.string(),
    cancelled: z.boolean(),
  })
  .nullable();

/** One line of a cell's history (0108): the value before and after, who, how and when. */
export const cellLineSchema = z.strictObject({
  id: z.uuid(),
  changedAt: z.iso.datetime(),
  lesson: cellLessonSchema,
  /** Whether it is the attendance cell (a mark) rather than a work's (a number). */
  attendance: z.boolean(),
  /** The work's kind; `null` for the attendance cell and for a work a forced delete removed. */
  workKind: cellWorkKindSchema.nullable(),
  before: z.int().nullable(),
  after: z.int().nullable(),
  changedHow: cellChangeSchema,
});

export type CellLine = z.infer<typeof cellLineSchema>;

/** How a work came to its state (0119). */
export const WORK_CHANGES = [
  'entry',
  'not_held',
  'carry',
  'move',
  'takeover',
  'separation',
  'restored',
  'deleted',
  'forced_delete',
] as const;

export const workChangeSchema = z.enum(WORK_CHANGES);

export type WorkChange = z.infer<typeof workChangeSchema>;

/**
 * One line of a work's history (0119): the total and the "not held" mark
 * before and after (`07`: "The number and the total stay visible in the
 * journal and in the cell history").
 */
export const workLineSchema = z.strictObject({
  id: z.uuid(),
  workId: z.uuid(),
  workKind: cellWorkKindSchema,
  changedAt: z.iso.datetime(),
  lesson: cellLessonSchema,
  totalBefore: z.int().nullable(),
  totalAfter: z.int().nullable(),
  notHeldBefore: z.boolean().nullable(),
  notHeldAfter: z.boolean().nullable(),
  changedHow: workChangeSchema,
  /** `null` for a line no person wrote (a migration). */
  changedBy: accountNamedSchema.nullable(),
});

export type WorkLine = z.infer<typeof workLineSchema>;

/**
 * One line of a rating entry's history (0120; task 8.2, From 6.1c and
 * decision 12): the entry before and after, the reason, who and when, with
 * the journal and quarter it belongs to.
 */
export const ratingLineSchema = z.strictObject({
  id: z.uuid(),
  changedAt: z.iso.datetime(),
  journal: z.strictObject({
    subject: threeNamesSchema,
    /** "7 Oxford" or the group's name. */
    taughtTo: z.string(),
    quarter: z.int().min(1).max(4),
  }),
  studentId: z.uuid(),
  before: ratingEntryValueSchema.nullable(),
  after: ratingEntryValueSchema.nullable(),
  reason: z.string().nullable(),
  changedBy: accountNamedSchema,
});

export type RatingLine = z.infer<typeof ratingLineSchema>;

/** One line of a comment's history (0120; task 8.2, From 6.1c). */
export const commentLineSchema = z.strictObject({
  id: z.uuid(),
  changedAt: z.iso.datetime(),
  target: z.enum(['mark', 'work', 'note', 'rating']),
  /** The lesson of a mark, a number or a note; `null` for a rating entry or a lesson gone. */
  lesson: cellLessonSchema,
  studentId: z.uuid(),
  bodyBefore: z.string().nullable(),
  bodyAfter: z.string().nullable(),
  visibility: z.enum(COMMENT_VISIBILITIES).nullable(),
  changedHow: z.enum(['entry', 'restored', 'forced_delete']),
  /** `null` for a line no person wrote. */
  changedBy: accountNamedSchema.nullable(),
});

export type CommentLine = z.infer<typeof commentLineSchema>;

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

/**
 * The range of the reset's moment, school dates inclusive in the branch's time
 * zone; left out, the last 30 days; at most `AUDIT_MAX_RANGE_DAYS` (decision 7,
 * the audit screen's rule).
 */
export const resetEntriesQuerySchema = z
  .strictObject({
    from: schoolDateSchema.optional(),
    to: schoolDateSchema.optional(),
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    path: ['to'],
    message: 'The range ends before it begins.',
  })
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      daysBetween(query.from, query.to) < AUDIT_MAX_RANGE_DAYS,
    { path: ['to'], message: 'The range is longer than allowed.' },
  );

export type ResetEntriesQuery = z.infer<typeof resetEntriesQuerySchema>;

/** The kinds of reset the report lists (decision 3). */
export const RESET_KINDS = ['administrator', 'email', 'rehire'] as const;

export const resetKindSchema = z.enum(RESET_KINDS);

export type ResetKind = z.infer<typeof resetKindSchema>;

/** The hours after a reset in which an entry is listed. */
export const RESET_ENTRY_HOURS = 48;

/** One entry under a reset: a cell line of the branch, with its student. */
export const resetEntrySchema = cellLineSchema.extend({
  student: z
    .strictObject({ id: z.uuid(), uid: z.string(), firstName: z.string(), lastName: z.string() })
    .nullable(),
});

export type ResetEntry = z.infer<typeof resetEntrySchema>;

export const resetSchema = z.strictObject({
  /** The audit entry of the reset. */
  id: z.uuid(),
  kind: resetKindSchema,
  at: z.iso.datetime(),
  /** The account reset. */
  person: accountNamedSchema,
  /** Who reset it; `null` for an email reset (the person) or a server command. */
  by: accountNamedSchema.nullable(),
  /**
   * For an email reset that follows an edit of the email by somebody else
   * (decision 4): who edited it and when, as the reset's entry names them.
   */
  emailChangedBy: accountNamedSchema.extend({ at: z.iso.datetime() }).nullable(),
  /** The cell lines the account wrote in the branch within 48 hours, oldest first. */
  entries: z.array(resetEntrySchema),
  /** Task 8.1 (From 6.1c): the total and "not held" lines the account wrote there, oldest first. */
  workEntries: z.array(workLineSchema),
  /** Task 8.2 (From 6.1c; decision 12): the rating entry lines the account wrote there, oldest first. */
  ratingEntries: z.array(ratingLineSchema),
  /** Task 8.2 (From 6.1c): the comment lines the account wrote there, oldest first. */
  commentEntries: z.array(commentLineSchema),
});

export type Reset = z.infer<typeof resetSchema>;

export const resetEntriesSchema = z.strictObject({
  /** The dates searched, as the server read them. */
  from: schoolDateSchema,
  to: schoolDateSchema,
  /** Newest first. */
  resets: z.array(resetSchema),
});

export type ResetEntries = z.infer<typeof resetEntriesSchema>;
