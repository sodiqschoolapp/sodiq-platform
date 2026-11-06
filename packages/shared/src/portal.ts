import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { JOURNAL_PARTS } from './journal.js';
import { planFileSchema } from './plans.js';
import { RESULT_FLAGS } from './results.js';
import { subjectColourSchema } from './subjects.js';

/**
 * The parent portal (task 11.2, pull request #294; `10`, What parents see): the pages of the
 * own children of a Parent account, phone first and read only. Every answer here is a narrow
 * shape written for families, never the staff view: no id of a staff member, a room, a
 * journal or a version, no lesson status, no typed reason and no other student.
 */

const names = z.object({ uz: z.string(), ru: z.string(), en: z.string() });

/** A subject with its colour, used the same way as on every timetable (`12`, Look and feel). */
const subject = z.strictObject({ id: z.uuid(), names, colour: subjectColourSchema });

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
  subject,
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
  subject: subject.nullable(),
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
  subject,
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

/**
 * The Grades page (task 11.3, pull request #296; `10`, What parents see: "Each score with the
 * work's name and the lesson date; the averages and quarter results of each subject as the
 * staff pages show them, the current quarter marked 'provisional' until it is closed; the
 * comments marked 'visible to parents'"). Every figure is the staff results page's, from
 * `packages/calc`; nothing is calculated in the portal.
 */
export const portalGradesQuerySchema = z.strictObject({ quarter: z.uuid().optional() });

export type PortalGradesQuery = z.infer<typeof portalGradesQuerySchema>;

/** A quarter of the child's year; `closed`: its figures are the stored final results. */
export const portalQuarterSchema = z.strictObject({
  id: z.uuid(),
  number: z.int().min(1).max(4),
  startDate: schoolDateSchema,
  endDate: schoolDateSchema,
  closed: z.boolean(),
  /** Ended before the branch's start date: "not in the system". */
  notInSystem: z.boolean(),
  /** The start quarter closed "not official": left out of the year result. */
  notOfficial: z.boolean(),
});

export type PortalQuarter = z.infer<typeof portalQuarterSchema>;

/** The outcome of a quarter as the staff page shows it (review decision 4: every flag). */
export const portalOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('number'),
    shown: z.int().min(0).max(100),
    grade: z.int().min(2).max(5),
    /** `07`, rule 8: a weighted part has no data while the quarter is open. */
    provisional: z.boolean(),
    leftOut: z.array(z.enum(JOURNAL_PARTS)),
    flags: z.array(z.enum(RESULT_FLAGS)),
  }),
  z.strictObject({ kind: z.literal('exempt') }),
  z.strictObject({ kind: z.literal('not_assessed') }),
  z.strictObject({ kind: z.literal('no_result') }),
]);

/** The figures of one subject in the quarter shown, as the staff Results tab answers them. */
export const portalFiguresSchema = z.strictObject({
  attendance: z.int().min(0).max(100).nullable(),
  classwork: z.int().min(0).max(100).nullable(),
  homework: z.int().min(0).max(100).nullable(),
  ratingExam: z.int().min(0).max(100).nullable(),
  /** The quarter has the rating exam part at all. */
  ratingShown: z.boolean(),
  outcome: portalOutcomeSchema,
  /** "based on n of N lessons". */
  basedOn: z.strictObject({ expected: z.int().min(0), held: z.int().min(0) }),
  countsFrom: schoolDateSchema.nullable(),
  leftSubjectOn: schoolDateSchema.nullable(),
  atLeaving: schoolDateSchema.nullable(),
});

export type PortalFigures = z.infer<typeof portalFiguresSchema>;

/** The year result, answered only when the staff page shows it (decision 6). */
export const portalYearSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('number'),
    shown: z.int().min(0).max(100),
    grade: z.int().min(2).max(5),
    basedOn: z.int().min(1).max(4),
  }),
  z.strictObject({ kind: z.literal('no_result') }),
]);

export const PORTAL_WORK_KINDS = ['classwork', 'homework'] as const;

/** A score of the child: the number typed, the total and the percent (`07`, The total). */
export const portalScoreSchema = z.strictObject({
  /** The date of the lesson it was entered at (a homework: the lesson it was checked at). */
  date: schoolDateSchema,
  kind: z.enum(PORTAL_WORK_KINDS),
  /** The work's title; `null` for a work without one, shown "Classwork n" or "Homework n". */
  title: z.string().nullable(),
  position: z.int().min(1),
  score: z.int().min(0),
  total: z.int().min(1),
  percent: z.int().min(0).max(100),
  /** The comment "visible to parents" on this score, or `null` (decision 8). */
  comment: z.string().nullable(),
});

export type PortalScore = z.infer<typeof portalScoreSchema>;

/** The rating exam entry counted in the quarter. */
export const portalRatingEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('score'), score: z.int().min(0).max(100) }),
  z.strictObject({ kind: z.literal('did_not_sit') }),
  z.strictObject({ kind: z.literal('exempt') }),
  z.strictObject({ kind: z.literal('not_held') }),
]);

export const portalSubjectGradesSchema = z.strictObject({
  subject,
  /** An attendance-only subject: its attendance average, no result (review correction 1). */
  attendanceOnly: z.boolean(),
  /** `null` for an attendance-only subject. */
  figures: portalFiguresSchema.nullable(),
  /** The attendance average of an attendance-only subject; `null` otherwise. */
  attendance: z.int().min(0).max(100).nullable(),
  year: portalYearSchema.nullable(),
  scores: z.array(portalScoreSchema),
  rating: portalRatingEntrySchema.nullable(),
  /** The comments "visible to parents" on the child's rating exam entry. */
  ratingComments: z.array(z.string()),
});

export type PortalSubjectGrades = z.infer<typeof portalSubjectGradesSchema>;

export const portalGradesSchema = z.strictObject({
  quarters: z.array(portalQuarterSchema),
  /** The quarter shown; `null` when the child's branch has no year to show. */
  quarterId: z.uuid().nullable(),
  subjects: z.array(portalSubjectGradesSchema),
});

export type PortalGrades = z.infer<typeof portalGradesSchema>;

/**
 * The Attendance page (task 11.3; `10`: "The child's marks by day and lesson. An exempt lesson
 * shows as exempt, never as an absence"). Marks 4 and 5 are both `exempt`, without kind,
 * reason or dates (decision 7).
 */
export const PORTAL_MARKS = ['present', 'late', 'absent', 'skipped', 'exempt', 'unmarked'] as const;

export type PortalMark = (typeof PORTAL_MARKS)[number];

export const portalAttendanceLessonSchema = z.strictObject({
  date: schoolDateSchema,
  /** Clock minutes of the day in branch time, half-open. */
  start: z.int().min(0),
  end: z.int().min(1),
  subject,
  mark: z.enum(PORTAL_MARKS),
  /** The comment "visible to parents" on the mark, or `null`. */
  comment: z.string().nullable(),
  /** The general note "visible to parents" to the child for the lesson, or `null`. */
  note: z.string().nullable(),
});

export type PortalAttendanceLesson = z.infer<typeof portalAttendanceLessonSchema>;

export const portalAttendanceWeekSchema = z.strictObject({
  today: schoolDateSchema,
  monday: schoolDateSchema,
  lessons: z.array(portalAttendanceLessonSchema),
});

export type PortalAttendanceWeek = z.infer<typeof portalAttendanceWeekSchema>;
