import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { LESSON_CANCEL_CAUSES } from './day-changes.js';

/**
 * The Super Admin's forced delete of a dated lesson, its store and its restore,
 * and the history of a lesson (task 5.8b, pull request #195;
 * docs/spec/06-timetable.md, Protection: "Forced delete is for Super Admin
 * only, with a typed reason. The attendance and marks are kept for 30 days and
 * can be restored." "Every change records who, when, the value before and the
 * value after.").
 */

/** The longest reason of a forced delete, as `forced_deletes_reason_check` (0105) allows. */
export const FORCED_DELETE_REASON_MAX = 500;

/** The days a forced delete can be restored, as `forced_deletes_write` (0105) writes them. */
export const FORCED_DELETE_RESTORE_DAYS = 30;

/** The kinds of record the store keeps (5.8c adds buildings, floors and rooms). */
export const FORCED_DELETE_RECORD_TYPES = ['lesson'] as const;

/** A forced delete of a lesson with its reason, trimmed. */
export const forcedDeleteBodySchema = z.strictObject({
  reason: z.string().trim().min(1).max(FORCED_DELETE_REASON_MAX),
});

export type ForcedDeleteBody = z.infer<typeof forcedDeleteBodySchema>;

export const forcedDeleteParamsSchema = z.object({ id: z.uuid() });

export type ForcedDeleteParams = z.infer<typeof forcedDeleteParamsSchema>;

const names = z.object({ uz: z.string(), ru: z.string(), en: z.string() });

const person = z.object({ id: z.uuid(), name: z.string() });

/** What a lesson of the store was when it was deleted. */
export const forcedLessonSchema = z.object({
  id: z.uuid(),
  date: schoolDateSchema,
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  /** Clock minutes of the day in branch time, half-open. */
  start: z.int().min(0),
  end: z.int().min(1),
  unit: z.object({ kind: z.enum(['class', 'group']), id: z.uuid(), name: z.string() }),
  subject: z.object({ id: z.uuid(), names }),
  teacher: person.nullable(),
  room: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  cancelCause: z.enum(LESSON_CANCEL_CAUSES).nullable(),
});

export type ForcedLesson = z.infer<typeof forcedLessonSchema>;

/** One record of the store (`GET /api/forced-deletes`). */
export const forcedDeleteSchema = z.object({
  id: z.uuid(),
  recordType: z.enum(FORCED_DELETE_RECORD_TYPES),
  lesson: forcedLessonSchema,
  reason: z.string(),
  deletedBy: person,
  deletedAt: z.iso.datetime({ offset: true }),
  restoreUntil: z.iso.datetime({ offset: true }),
  restoredAt: z.iso.datetime({ offset: true }).nullable(),
  restoredBy: person.nullable(),
  /** Not restored and before `restoreUntil` at the moment of the request. */
  restorable: z.boolean(),
});

export type ForcedDelete = z.infer<typeof forcedDeleteSchema>;

export const forcedDeleteListSchema = z.object({ entries: z.array(forcedDeleteSchema) });

export type ForcedDeleteList = z.infer<typeof forcedDeleteListSchema>;

/** The answer of a forced delete and of a restore: the record of the store. */
export const forcedDeleteAnswerSchema = forcedDeleteSchema;

export type ForcedDeleteAnswer = ForcedDelete;

/** The kinds of line of a lesson's history (0105). */
export const LESSON_HISTORY_KINDS = ['changed', 'removed', 'forced_delete', 'restored'] as const;

const side = <T extends z.ZodType>(value: T) =>
  z.object({ before: value.nullable(), after: value.nullable() });

/** One line of a lesson's history (`GET /api/timetable/lessons/:id/history`). */
export const lessonHistoryLineSchema = z.object({
  id: z.uuid(),
  kind: z.enum(LESSON_HISTORY_KINDS),
  changedAt: z.iso.datetime({ offset: true }),
  /** The actor of the audit entry of the change; `null` for the system (a job). */
  who: person.nullable(),
  teacher: side(person),
  room: side(z.object({ id: z.uuid(), name: z.string() })),
  date: side(schoolDateSchema),
  startsAt: side(z.iso.datetime({ offset: true })),
  endsAt: side(z.iso.datetime({ offset: true })),
  cancelCause: side(z.enum(LESSON_CANCEL_CAUSES)),
  cancelReason: side(z.string()),
});

export type LessonHistoryLine = z.infer<typeof lessonHistoryLineSchema>;

export const lessonHistorySchema = z.object({ lines: z.array(lessonHistoryLineSchema) });

export type LessonHistory = z.infer<typeof lessonHistorySchema>;
