import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { cellMarkerSchema, correctionSchema, editLockSchema } from './journal-correction.js';

/**
 * The rating exam and comments of the journal (task 8.2, pull request #218).
 * `edge/calculation`, "The rating exam": "One column per rating journal and
 * quarter, with an exam date set by the teacher or the Academic Vice
 * Principal. Whole numbers from 0 to 100. ... Each student has a score, 'did
 * not sit' (counts 0, set by the teacher) or 'exempt' (set only by the
 * Academic Vice Principal). A late sitting or a retake replaces the score
 * with a required reason; history is kept." `07`, Entering data, Comments.
 */

/** `edge/calculation`: "Whole numbers from 0 to 100" (`journal_rating_entries_score_check`, 0120). */
export const RATING_SCORE_MAX = 100;

/** The bound of a reason (`journal_rating_entries_reason_check`, 0120). */
export const RATING_REASON_MAX_LENGTH = 500;

/** The bound of a comment (`journal_comments_body_check`, 0120). */
export const COMMENT_MAX_LENGTH = 1000;

export const journalRatingParamsSchema = z.object({ journalId: z.uuid(), quarterId: z.uuid() });

export type JournalRatingParams = z.infer<typeof journalRatingParamsSchema>;

export const journalRatingStudentParamsSchema = journalRatingParamsSchema.extend({
  studentId: z.uuid(),
});

export type JournalRatingStudentParams = z.infer<typeof journalRatingStudentParamsSchema>;

/** The version a change was made on; `null` before the first write. */
const versionSchema = z.int().min(1).nullable();

const reasonSchema = z.string().trim().min(1).max(RATING_REASON_MAX_LENGTH);

/** The hand-set date; `null` clears it. Refused while a linked exam gives the date (decision 5). */
export const ratingDateSchema = z.strictObject({
  date: schoolDateSchema.nullable(),
  version: versionSchema,
});

export type RatingDate = z.infer<typeof ratingDateSchema>;

/** "Not held" for the journal and quarter, by the Academic Vice Principal (decision 7). */
export const ratingNotHeldSchema = z.strictObject({
  notHeld: z.boolean(),
  version: versionSchema,
  /** Sent after a `rating_exam_entries`: entries exist. */
  confirm: z.boolean().default(false),
});

export type RatingNotHeld = z.input<typeof ratingNotHeldSchema>;

export const RATING_ENTRY_KINDS = ['score', 'did_not_sit', 'exempt'] as const;

export type RatingEntryKind = (typeof RATING_ENTRY_KINDS)[number];

export const ratingEntryValueSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('score'), score: z.int().min(0).max(RATING_SCORE_MAX) }),
  z.strictObject({ kind: z.literal('did_not_sit') }),
  z.strictObject({ kind: z.literal('exempt') }),
]);

export type RatingEntryValue = z.infer<typeof ratingEntryValueSchema>;

/** One student's entry; `entry: null` clears it. A write over an entry needs `reason` (decision 9). */
export const ratingEntrySaveSchema = z.strictObject({
  studentId: z.uuid(),
  entry: ratingEntryValueSchema.nullable(),
  reason: reasonSchema.nullable(),
  version: versionSchema,
  /** Task 8.4: a correction of the Academic Vice Principal or the Super Admin; its reason is `reason` (review correction 2). */
  correction: z.boolean().default(false),
});

export type RatingEntrySave = z.input<typeof ratingEntrySaveSchema>;

export const ratingEntrySchema = z.object({
  studentId: z.uuid(),
  /** `null` once cleared. */
  entry: ratingEntryValueSchema.nullable(),
  version: z.int().min(1),
  changedBy: z.string().nullable(),
  changedAt: z.iso.datetime(),
  /** Task 8.4: "entered after the edit period" with the approver, or "corrected". */
  marker: cellMarkerSchema,
});

export type RatingEntry = z.infer<typeof ratingEntrySchema>;

/**
 * The rating exam of a journal in a quarter as the grid and the routes answer
 * it. `date` is the date in force: a standing linked exam's (`fromExam`),
 * else the hand-set one.
 */
export const ratingExamSchema = z.object({
  journalId: z.uuid(),
  quarterId: z.uuid(),
  date: schoolDateSchema.nullable(),
  fromExam: z.boolean(),
  notHeld: z.boolean(),
  /** `null` before the first write. */
  version: versionSchema,
  /** The reader may set the hand date: the journal's teacher today or the Academic Vice Principal, and no linked exam. */
  canSetDate: z.boolean(),
  /** The reader may mark it "not held": the Academic Vice Principal. */
  canSetNotHeld: z.boolean(),
  /** The reader may type scores and "did not sit": the journal's teacher today, from the date. */
  canEnter: z.boolean(),
  /** The reader may set "exempt": the Academic Vice Principal, from the date. */
  canExempt: z.boolean(),
  /** Task 8.4: the edit period of the exam, from its date in force. */
  lock: editLockSchema,
  entries: z.array(ratingEntrySchema),
});

export type RatingExam = z.infer<typeof ratingExamSchema>;

/** One line of the history of a student's rating entry, or of the exam's date and "not held". */
export const ratingHistorySchema = z.object({
  lines: z.array(
    z.object({
      version: z.int().min(1),
      /** `entry` for a student's line; `exam` for a date or "not held". */
      kind: z.enum(['entry', 'exam']),
      before: ratingEntryValueSchema.nullable(),
      after: ratingEntryValueSchema.nullable(),
      dateBefore: schoolDateSchema.nullable(),
      dateAfter: schoolDateSchema.nullable(),
      notHeldBefore: z.boolean().nullable(),
      notHeldAfter: z.boolean().nullable(),
      reason: z.string().nullable(),
      changedBy: z.string().nullable(),
      changedAt: z.iso.datetime(),
    }),
  ),
});

export type RatingHistory = z.infer<typeof ratingHistorySchema>;

export const COMMENT_VISIBILITIES = ['staff', 'parents'] as const;

export type CommentVisibility = (typeof COMMENT_VISIBILITIES)[number];

/** What a comment is on (`07`: "any attendance mark or score, and a general note to a student for a lesson"). */
export const commentTargetSchema = z.discriminatedUnion('target', [
  z.strictObject({ target: z.literal('mark'), lessonId: z.uuid(), studentId: z.uuid() }),
  z.strictObject({ target: z.literal('note'), lessonId: z.uuid(), studentId: z.uuid() }),
  z.strictObject({
    target: z.literal('work'),
    lessonId: z.uuid(),
    workId: z.uuid(),
    studentId: z.uuid(),
  }),
  z.strictObject({
    target: z.literal('rating'),
    journalId: z.uuid(),
    quarterId: z.uuid(),
    studentId: z.uuid(),
  }),
]);

export type CommentTarget = z.infer<typeof commentTargetSchema>;

/** A comment written or cleared (`body: null`): never deleted (decision 10). */
export const commentSaveSchema = z.strictObject({
  on: commentTargetSchema,
  body: z.string().trim().min(1).max(COMMENT_MAX_LENGTH).nullable(),
  visibility: z.enum(COMMENT_VISIBILITIES),
  version: versionSchema,
  /** Task 8.4: a correction with its reason. */
  correction: correctionSchema.optional(),
});

export type CommentSave = z.infer<typeof commentSaveSchema>;

export const journalCommentSchema = z.object({
  id: z.uuid(),
  target: z.enum(['mark', 'work', 'note', 'rating']),
  studentId: z.uuid(),
  lessonId: z.uuid().nullable(),
  workId: z.uuid().nullable(),
  /** `null` once cleared. */
  body: z.string().nullable(),
  visibility: z.enum(COMMENT_VISIBILITIES),
  version: z.int().min(1),
  changedBy: z.string().nullable(),
  changedAt: z.iso.datetime(),
});

export type JournalComment = z.infer<typeof journalCommentSchema>;

/** `GET /api/journal/comments/history`: the target as query fields. */
export const commentHistoryQuerySchema = z.strictObject({
  target: z.enum(['mark', 'work', 'note', 'rating']),
  studentId: z.uuid(),
  lessonId: z.uuid().optional(),
  workId: z.uuid().optional(),
  journalId: z.uuid().optional(),
  quarterId: z.uuid().optional(),
});

export type CommentHistoryQuery = z.infer<typeof commentHistoryQuerySchema>;

export const commentHistorySchema = z.object({
  lines: z.array(
    z.object({
      version: z.int().min(1),
      bodyBefore: z.string().nullable(),
      bodyAfter: z.string().nullable(),
      visibilityBefore: z.enum(COMMENT_VISIBILITIES).nullable(),
      visibilityAfter: z.enum(COMMENT_VISIBILITIES).nullable(),
      changedBy: z.string().nullable(),
      changedHow: z.enum(['entry', 'restored', 'forced_delete']),
      changedAt: z.iso.datetime(),
    }),
  ),
});

export type CommentHistory = z.infer<typeof commentHistorySchema>;
