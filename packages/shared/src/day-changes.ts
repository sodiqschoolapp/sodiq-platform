import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { lessonStateSchema, ruleResultSchema } from './timetable.js';

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

const reason = z.string().trim().min(1).max(DAY_CHANGE_REASON_MAX);

/**
 * A restore takes nothing, or a room and a reason: the restore into one of
 * the free rooms a refused restore listed, stored as a room change (task
 * 5.6a-2, decision 10; 5.6a-1 decision 7). Both or neither.
 */
export const lessonRestoreBodySchema = z
  .strictObject({ roomId: z.uuid().optional(), reason: reason.optional() })
  .refine((body) => (body.roomId === undefined) === (body.reason === undefined), {
    path: ['reason'],
    message: 'A room and a reason go together.',
  });

export type LessonRestoreBody = z.infer<typeof lessonRestoreBodySchema>;

/** A one-day room change of a lesson (both halves of a double), with its reason (task 5.6a-2). */
export const lessonRoomBodySchema = z.strictObject({ roomId: z.uuid(), reason });

export type LessonRoomBody = z.infer<typeof lessonRoomBodySchema>;

/**
 * A one-day move of a lesson's block (and both halves of a double) to a
 * lesson slot of a date, named by its number among the day's lesson slots,
 * never by a time (task 5.6a-2, decision 6); a room only for a lesson of one
 * part (decision 9).
 */
export const lessonMoveBodySchema = z.strictObject({
  date: schoolDateSchema,
  lessonNumber: z.int().min(1).max(30),
  roomId: z.uuid().optional(),
  reason,
});

export type LessonMoveBody = z.infer<typeof lessonMoveBodySchema>;

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
  /** Held, unresolved, cancelled and so on, at the moment of the request (`lessonStateOf`, task 5.6a-4). */
  state: lessonStateSchema,
  /**
   * Started, or the earlier half of its double started, in a year not closed:
   * the lesson is corrected, not changed for the day (task 5.6a-4, decision 5
   * with review correction 2).
   */
  canCorrect: z.boolean(),
});

export type DayLesson = z.infer<typeof dayLessonSchema>;

/** A lesson slot of the class's day, for the move dialog (task 5.6a-2, decision 12). */
export const daySlotSchema = z.object({
  lessonNumber: z.int().min(1),
  /** Clock minutes of the day in branch time, half-open. */
  start: z.int().min(0),
  end: z.int().min(1),
});

export type DaySlot = z.infer<typeof daySlotSchema>;

/**
 * A standing exam the class sits on the date (task 5.6c-2; `06`, Exam: "It is
 * shown on every timetable view ..., marked 'exam'"): named in a room, or
 * through a group fed by the class; the room that holds the class or its
 * group and that room's invigilators.
 */
export const dayExamSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  subject: z.object({ id: z.uuid(), names }).nullable(),
  /** Clock minutes of the day in branch time, half-open. */
  start: z.int().min(0),
  end: z.int().min(1),
  room: z.object({ id: z.uuid(), name: z.string() }),
  invigilators: z.array(z.string()),
});

export type DayExam = z.infer<typeof dayExamSchema>;

export const dayAnswerSchema = z.object({
  date: schoolDateSchema,
  classId: z.uuid(),
  /** The lesson slots of the class's day on the date; none on a day without lessons. */
  slots: z.array(daySlotSchema),
  /**
   * The highest lesson number of the days of the branch's active classes on
   * the date, the lesson numbers the bulk cancel offers (task 5.6a-3); 0 on a
   * day without lessons.
   */
  longestDay: z.int().min(0),
  /** Today in the branch at the moment of the request, so the page never reads the device's clock. */
  today: schoolDateSchema,
  lessons: z.array(dayLessonSchema),
  /** The standing exams the class sits on the date, by start (task 5.6c-2). */
  exams: z.array(dayExamSchema),
});

export type DayAnswer = z.infer<typeof dayAnswerSchema>;

/** The lesson after a one-day change, with the warnings its check found (decision 8). */
export const dayChangeAnswerSchema = z.object({
  lesson: dayLessonSchema,
  warnings: z.array(ruleResultSchema),
});

export type DayChangeAnswer = z.infer<typeof dayChangeAnswerSchema>;

/**
 * The correction of a past lesson, one lesson at a time, with a reason (task
 * 5.6a-4, pull request #163; `06`, How surprises are prevented: "A past
 * lesson can only be corrected one at a time by the Academic Vice Principal,
 * with a reason"; edge/timetable, After publishing, "The lesson time passes
 * and nobody was assigned": "until it is cancelled with a reason or the
 * person who taught it is recorded"). `confirm` is the tick of the warnings
 * a correction answered with `correction_needs_confirm` (decisions 2 and 13).
 */
export const lessonCorrectionBodySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('cancel'), reason }),
  z.strictObject({
    kind: z.literal('restore'),
    roomId: z.uuid().optional(),
    reason,
    confirm: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal('teacher'),
    teacherId: z.uuid(),
    reason,
    confirm: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal('room'),
    roomId: z.uuid(),
    reason,
    confirm: z.boolean().optional(),
  }),
]);

export type LessonCorrectionBody = z.infer<typeof lessonCorrectionBodySchema>;

/**
 * The people who may be recorded as having taught a past lesson: the
 * branch's staff active on the lesson's date, people who left since
 * included, never a vacancy (task 5.6a-4, decision 4).
 */
export const correctionTeachersAnswerSchema = z.object({
  teachers: z.array(z.object({ id: z.uuid(), name: z.string() })),
});

export type CorrectionTeachersAnswer = z.infer<typeof correctionTeachersAnswerSchema>;
