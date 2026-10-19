import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { ruleResultSchema } from './timetable.js';

/**
 * One-day changes of a published timetable (task 5.6a-1, pull request #160;
 * docs/spec/06-timetable.md, Changes after publishing: "One-day change. …
 * Every one-day change needs a reason, applies to that date only and passes
 * the same rules."; edge-cases/timetable.md, After publishing: "A cancelled
 * lesson is restored after its room went to another lesson. Every rule is
 * checked again. The restore can be refused, with another room offered.").
 */

/** The longest reason of a one-day cancel, as `lessons_cancel_reason_check` (0058) allows. */
export const DAY_CHANGE_REASON_MAX = 500;

/** The day of a class: its stored lessons on a school date (`GET /api/timetable/day`). */
export const dayQuerySchema = z.object({
  date: schoolDateSchema,
  classId: z.uuid(),
});

export type DayQuery = z.infer<typeof dayQuerySchema>;

export const lessonParamsSchema = z.object({ id: z.uuid() });

export type LessonParams = z.infer<typeof lessonParamsSchema>;

/**
 * A cancel with its reason, trimmed: a reason of spaces only is an input
 * error, never a refusal of the database (review correction 2).
 */
export const lessonCancelBodySchema = z.strictObject({
  reason: z.string().trim().min(1).max(DAY_CHANGE_REASON_MAX),
});

export type LessonCancelBody = z.infer<typeof lessonCancelBodySchema>;

/** A restore takes nothing: a restore into another room is a room change (5.6a-2, decision 7). */
export const lessonRestoreBodySchema = z.strictObject({});

export type LessonRestoreBody = z.infer<typeof lessonRestoreBodySchema>;

/** The causes a stored lesson can be cancelled with (0058). */
export const LESSON_CANCEL_CAUSES = [
  'not_in_template',
  'exam',
  'exam_week',
  'day_off',
  'reason',
] as const;

const names = z.object({ uz: z.string(), ru: z.string(), en: z.string() });

/** A stored lesson of the day, as the page shows it. */
export const dayLessonSchema = z.object({
  id: z.uuid(),
  date: schoolDateSchema,
  /** Clock minutes of the day in branch time, half-open. */
  start: z.int().min(0),
  end: z.int().min(1),
  unit: z.object({
    kind: z.enum(['class', 'group']),
    id: z.uuid(),
    /** The class shown with its grade ("7 Oxford"), or the group's name. */
    name: z.string(),
  }),
  subject: z.object({ id: z.uuid(), names }),
  /** The teacher or vacancy; `null` for "needs a teacher". */
  teacher: z
    .object({ id: z.uuid(), kind: z.enum(['person', 'vacancy']), name: z.string() })
    .nullable(),
  /** `null` for "needs a room". */
  room: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  cancelCause: z.enum(LESSON_CANCEL_CAUSES).nullable(),
  cancelReason: z.string().nullable(),
  /** The "changed" mark of the last week (`isMarkedChanged`, task 5.5c-3a). */
  changed: z.boolean(),
  /** Not cancelled and starting after the moment of the request (decision 3). */
  canCancel: z.boolean(),
  /** A one-day cancel (`reason`) starting after the moment of the request (decisions 3 and 5). */
  canRestore: z.boolean(),
});

export type DayLesson = z.infer<typeof dayLessonSchema>;

export const dayAnswerSchema = z.object({
  date: schoolDateSchema,
  classId: z.uuid(),
  /** Today in the branch at the moment of the request, so the page never reads the device's clock. */
  today: schoolDateSchema,
  lessons: z.array(dayLessonSchema),
});

export type DayAnswer = z.infer<typeof dayAnswerSchema>;

/** The lesson after a cancel or a restore, with the warnings a restore found (decision 8). */
export const dayChangeAnswerSchema = z.object({
  lesson: dayLessonSchema,
  warnings: z.array(ruleResultSchema),
});

export type DayChangeAnswer = z.infer<typeof dayChangeAnswerSchema>;
