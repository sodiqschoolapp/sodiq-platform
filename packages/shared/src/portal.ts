import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { planFileSchema } from './plans.js';

/**
 * The parent portal (task 11.2, pull request #294; `10`, What parents see): the pages of the
 * own children of a Parent account, phone first and read only. Every answer here is a narrow
 * shape written for families, never the staff view: no id of a staff member, a room, a
 * journal or a version, no lesson status, no typed reason and no other student.
 */

const names = z.object({ uz: z.string(), ru: z.string(), en: z.string() });

/** A child in the switcher: an open link, portal access on, the student active (`portal_children`). */
export const portalChildSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  /** The class on today's date ("7 Oxford"); `null` when the child has none today. */
  className: z.string().nullable(),
});

export type PortalChild = z.infer<typeof portalChildSchema>;

export const portalChildrenSchema = z.object({ children: z.array(portalChildSchema) });

export type PortalChildren = z.infer<typeof portalChildrenSchema>;

export const portalChildParamsSchema = z.strictObject({ studentId: z.uuid() });

export type PortalChildParams = z.infer<typeof portalChildParamsSchema>;

export const portalFileParamsSchema = z.strictObject({ studentId: z.uuid(), fileId: z.uuid() });

export type PortalFileParams = z.infer<typeof portalFileParamsSchema>;

/** The week of a date, Monday to Sunday (`12`: the week starts on Monday); today when left out. */
export const portalWeekQuerySchema = z.strictObject({ date: schoolDateSchema.optional() });

export type PortalWeekQuery = z.infer<typeof portalWeekQuerySchema>;

/**
 * How a lesson stands for a family (decision 7): `cancelled` names no typed reason, only
 * whether an exam replaced it.
 */
export const PORTAL_LESSON_STATES = ['planned', 'held', 'cancelled'] as const;

export const portalLessonSchema = z.strictObject({
  date: schoolDateSchema,
  /** Clock minutes of the day in branch time, half-open. */
  start: z.int().min(0),
  end: z.int().min(1),
  lessonNumber: z.int().min(1).nullable(),
  subject: z.strictObject({ id: z.uuid(), names }),
  /** The teacher of the lesson on its date (a substitute when one is recorded); `null` for "to be named". */
  teacher: z.string().nullable(),
  /** `null` for "room to be named". */
  room: z.string().nullable(),
  state: z.enum(PORTAL_LESSON_STATES),
  /** Cancelled because an exam replaced it. */
  exam: z.boolean(),
  /** The "changed" mark of the last week (`06`, How surprises are prevented). */
  changed: z.boolean(),
});

export type PortalLesson = z.infer<typeof portalLessonSchema>;

/** An exam the child sits, with the child's room only and no invigilator. */
export const portalExamSchema = z.strictObject({
  date: schoolDateSchema,
  start: z.int().min(0),
  end: z.int().min(1),
  title: z.string(),
  subject: z.strictObject({ id: z.uuid(), names }).nullable(),
  room: z.string().nullable(),
});

export type PortalExam = z.infer<typeof portalExamSchema>;

export const portalDaySchema = z.strictObject({
  date: schoolDateSchema,
  /** Outside every academic year (a summer week). */
  outsideYear: z.boolean(),
  /** The name of the day off, or `null`. */
  dayOff: z.string().nullable(),
});

export type PortalDay = z.infer<typeof portalDaySchema>;

export const portalWeekSchema = z.strictObject({
  /** Today in the child's branch. */
  today: schoolDateSchema,
  /** Monday of the week shown. */
  monday: schoolDateSchema,
  days: z.array(portalDaySchema),
  lessons: z.array(portalLessonSchema),
  exams: z.array(portalExamSchema),
});

export type PortalWeek = z.infer<typeof portalWeekSchema>;

/** A homework given at a held lesson of the week (decision 8). */
export const portalHomeworkSchema = z.strictObject({
  /** The date of the lesson it was given at. */
  givenOn: schoolDateSchema,
  subject: z.strictObject({ id: z.uuid(), names }),
  /** The topic of the lesson it was given at (`09`: parents see the topic and the homework). */
  topic: z.string().nullable(),
  /** `null` for a work added by hand before task 10.6: shown "HW n" with `number`. */
  title: z.string().nullable(),
  /** Its place among the homeworks given at that lesson, from 1. */
  number: z.int().min(1),
  /** The text of the task, from the plan; `null` for none. */
  description: z.string().nullable(),
  /** The date of the lesson it is checked at; `null` when none is known yet. */
  dueOn: schoolDateSchema.nullable(),
  /** The files of the plan item of the lesson (decision 2, Look first). */
  files: z.array(planFileSchema),
});

export type PortalHomework = z.infer<typeof portalHomeworkSchema>;

export const portalHomeworkWeekSchema = z.strictObject({
  today: schoolDateSchema,
  monday: schoolDateSchema,
  homework: z.array(portalHomeworkSchema),
});

export type PortalHomeworkWeek = z.infer<typeof portalHomeworkWeekSchema>;
