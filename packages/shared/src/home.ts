import { z } from 'zod';
import { preparedStampSchema } from './prepared.js';
import { schoolDateSchema } from './academic-year.js';
import { statusLessonSchema } from './journal-status.js';

/**
 * The parts of the home pages that no earlier route answers (task 9.4b; `08`, Home pages by
 * role; `edge/journal`, Attendance figures). Every figure comes from `packages/calc`; percents
 * are rounded once, for the screen.
 */

/** A rounded percent, `null` with nothing marked. */
const percentSchema = z.int().min(0).max(100).nullable();

/** The cells of a class, a week or the branch (`dailyAttendance`). */
export const attendanceFigureSchema = z.object({
  attended: z.int().min(0),
  marked: z.int().min(0),
  /** Left out of the percent and shown as a separate count (`edge/journal`). */
  unmarked: z.int().min(0),
  exempt: z.int().min(0),
  percent: percentSchema,
});

export type AttendanceFigure = z.infer<typeof attendanceFigureSchema>;

/** Today in branch time only (`08`: "today"; permission review should-fix 2). */
export const attendanceTodayQuerySchema = z.strictObject({});

export type AttendanceTodayQuery = z.infer<typeof attendanceTodayQuerySchema>;

const studentNameSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  paternalName: z.string().nullable(),
});

export const attendanceTodayClassSchema = z.object({
  class: z.object({ id: z.uuid(), name: z.string(), grade: z.int().min(1).max(11) }),
  day: attendanceFigureSchema,
  /** Monday of the date's week to the date. */
  week: attendanceFigureSchema,
  /** The day's rounded percent is below the branch's `attendance_percent`. */
  below: z.boolean(),
  /**
   * "Who is absent now" (`absentNow`): only for the reader's own classes as Tutor and for the
   * Super Admin (review correction 3); `null` for the other readers, who see the figures only.
   */
  absentNow: z
    .array(
      z.object({
        student: studentNameSchema,
        /** The start of the latest marked lesson, marked 0. */
        since: z.iso.datetime(),
      }),
    )
    .nullable(),
});

export type AttendanceTodayClass = z.infer<typeof attendanceTodayClassSchema>;

export const attendanceTodaySchema = z.object({
  date: schoolDateSchema,
  weekFrom: schoolDateSchema,
  /** `branch_settings.attendance_percent` (plan decision 4). */
  threshold: z.int().min(0).max(100),
  /** Every class read, one ratio over all their cells. */
  total: attendanceFigureSchema,
  classes: z.array(attendanceTodayClassSchema),
  /** Task 9.3b-1: the prepared lesson facts the figures were read from. */
  prepared: preparedStampSchema,
});

export type AttendanceToday = z.infer<typeof attendanceTodaySchema>;

export const lessonsTodayQuerySchema = z.strictObject({});

export type LessonsTodayQuery = z.infer<typeof lessonsTodayQuerySchema>;

export const lessonsTodaySchema = z.object({
  date: schoolDateSchema,
  /** Lessons of today not cancelled whose start has not come. */
  ahead: z.int().min(0),
  /** The held lessons by status ("3 of 5 complete"). */
  held: z.int().min(0),
  notStarted: z.int().min(0),
  inProgress: z.int().min(0),
  complete: z.int().min(0),
  /** The held lessons not complete, in start order, with the teacher each counts for. */
  incomplete: z.array(
    z.object({
      lesson: statusLessonSchema,
      teacher: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    }),
  ),
  /** Task 9.3b-1: the prepared lesson facts the counts were read from. */
  prepared: preparedStampSchema,
});

export type LessonsToday = z.infer<typeof lessonsTodaySchema>;

export const branchSummaryQuerySchema = z.strictObject({
  /** Left out: the quarter containing today, else the last started quarter. */
  quarterId: z.uuid().optional(),
});

export type BranchSummaryQuery = z.infer<typeof branchSummaryQuerySchema>;

export const branchSummarySchema = z.object({
  date: schoolDateSchema,
  /** Active students whose start date has come. */
  students: z.int().min(0),
  /** Staff records of the branch not out for good; vacancies left out. */
  staff: z.int().min(0),
  attendanceToday: attendanceFigureSchema,
  quarter: z
    .object({
      id: z.uuid(),
      number: z.int().min(1).max(4),
      closed: z.boolean(),
    })
    .nullable(),
  /** Grades 1 to 11 with students in a class on the reference date. */
  grades: z.array(
    z.object({
      grade: z.int().min(1).max(11),
      /** The mean quarter result of its students with a number, in tenths (`oneDecimal`). */
      value: z.int().min(0).max(1000).nullable(),
      /** Students with a number. */
      rated: z.int().min(0),
      students: z.int().min(0),
    }),
  ),
  /** Task 9.3b-1: the prepared totals the figures were read from. */
  prepared: preparedStampSchema,
});

export type BranchSummary = z.infer<typeof branchSummarySchema>;

export const conflictsSummaryQuerySchema = z.strictObject({});

export type ConflictsSummaryQuery = z.infer<typeof conflictsSummaryQuerySchema>;

const versionCountsSchema = z.object({
  id: z.uuid(),
  number: z.int().min(1),
  startsOn: schoolDateSchema,
  /** The counts of the conflict panel (`checkTimetable`, as the grid shows them). */
  blocked: z.int().min(0),
  warnings: z.int().min(0),
});

export const conflictsSummarySchema = z.object({
  drafts: z.array(versionCountsSchema.extend({ outOfDate: z.boolean() })),
  /** The published version in force today; a published timetable holds no blocked rule. */
  published: versionCountsSchema.nullable(),
});

export type ConflictsSummary = z.infer<typeof conflictsSummarySchema>;
