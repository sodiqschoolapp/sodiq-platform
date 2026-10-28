import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { attendanceFigureSchema } from './home.js';
import { DISCIPLINE_DAYS_MAX } from './journal-status.js';
import { journalSubjectSchema, journalUnitSchema } from './journal-units.js';
import { preparedStampSchema } from './prepared.js';
import { RATING_STATES } from './rating.js';
import { instructionLanguageSchema } from './settings.js';

/**
 * The reports of `08`, Analytics in Release 1 (task 9.3b-2, pull request #260): Attendance,
 * Results table, Subject mastery and Timetable load; Journal discipline is in
 * `journal-status.ts` with its items here. Every figure comes from `packages/calc`; a percent is
 * rounded once, for the screen. A query that narrows what a reader sees is a `strictObject`
 * (`.claude/rules/api.md`).
 */

/** A rounded percent, `null` when there is nothing to divide by. */
const percentSchema = z.int().min(0).max(100).nullable();

const gradeSchema = z.int().min(1).max(11);

const queryGradeSchema = z.coerce.number().int().min(1).max(11);

const subjectNamesSchema = z.object({ uz: z.string(), ru: z.string(), en: z.string() });

const namedSchema = z.object({ id: z.uuid(), name: z.string() });

const reportClassSchema = z.object({
  id: z.uuid(),
  /** The class shown with its grade ("7 Oxford"). */
  name: z.string(),
  grade: gradeSchema,
});

export type ReportClass = z.infer<typeof reportClassSchema>;

const reportSubjectSchema = z.object({ id: z.uuid(), names: subjectNamesSchema });

/** Attendance and discipline read at most this many days, inside one academic year (decision 5). */
export const REPORT_DAYS_MAX = DISCIPLINE_DAYS_MAX;

/* ---------------------------------------------------------------- Attendance */

export const ATTENDANCE_GROUPINGS = ['class', 'tutor'] as const;

export type AttendanceGrouping = (typeof ATTENDANCE_GROUPINGS)[number];

export const attendanceReportQuerySchema = z
  .strictObject({
    from: schoolDateSchema,
    to: schoolDateSchema,
    grade: queryGradeSchema.optional(),
    classId: z.uuid().optional(),
    subjectId: z.uuid().optional(),
    teacherId: z.uuid().optional(),
    /** "Period of the day": the lesson's start, minutes of the day in branch time (build decision). */
    start: z.coerce.number().int().min(0).max(1439).optional(),
    /** `02`, Head Tutor: "attendance by class and by tutor". */
    groupBy: z.enum(ATTENDANCE_GROUPINGS).default('class'),
  })
  .refine((value) => value.from <= value.to, {
    path: ['to'],
    message: 'The range ends after it starts.',
  });

export type AttendanceReportQuery = z.infer<typeof attendanceReportQuerySchema>;

/**
 * The cells of a row by category (decision 2): each category's percent is of the expected cells
 * (every cell but the exempt ones); exempt is its own count, its percent of all cells.
 */
export const attendanceCountsSchema = z.object({
  present: z.int().min(0),
  late: z.int().min(0),
  absent: z.int().min(0),
  skipped: z.int().min(0),
  unmarked: z.int().min(0),
  exempt: z.int().min(0),
  /** The expected cells: every cell of a held lesson less the exempt ones. */
  expected: z.int().min(0),
  percents: z.object({
    present: percentSchema,
    late: percentSchema,
    absent: percentSchema,
    skipped: percentSchema,
    unmarked: percentSchema,
    /** Of all cells. */
    exempt: percentSchema,
  }),
});

export type AttendanceCountsShown = z.infer<typeof attendanceCountsSchema>;

const attendanceRowSchema = z.object({
  /** A class, or a tutor (`null`: the classes with no Tutor on the lessons' dates). */
  key: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('class'), class: reportClassSchema }),
    z.object({ kind: z.literal('tutor'), tutor: namedSchema.nullable() }),
  ]),
  counts: attendanceCountsSchema,
  /** `edge/journal`, "Daily attendance percent of a class", over the range: one ratio. */
  daily: attendanceFigureSchema,
});

export type AttendanceReportRow = z.infer<typeof attendanceRowSchema>;

export const attendanceReportSchema = z.object({
  from: schoolDateSchema,
  to: schoolDateSchema,
  groupBy: z.enum(ATTENDANCE_GROUPINGS),
  prepared: preparedStampSchema,
  total: z.object({ counts: attendanceCountsSchema, daily: attendanceFigureSchema }),
  rows: z.array(attendanceRowSchema),
  /** With a class chosen: its daily attendance on each school day of the range with a held lesson. */
  days: z.array(z.object({ date: schoolDateSchema, daily: attendanceFigureSchema })),
  /** The values of the filters the reader may choose. */
  choices: z.object({
    grades: z.array(gradeSchema),
    classes: z.array(reportClassSchema),
    subjects: z.array(reportSubjectSchema),
    teachers: z.array(namedSchema),
    starts: z.array(z.int().min(0).max(1439)),
  }),
});

export type AttendanceReport = z.infer<typeof attendanceReportSchema>;

/* ----------------------------------------------------- Results table and mastery */

/** The years, quarters, classes and subjects the reader may open in the results reports. */
export const resultsReportChoicesQuerySchema = z.strictObject({
  /** The academic year; when left out, the current one, else the newest that has started. */
  yearId: z.uuid().optional(),
});

export type ResultsReportChoicesQuery = z.infer<typeof resultsReportChoicesQuerySchema>;

const reportYearSchema = z.object({
  id: z.uuid(),
  startDate: schoolDateSchema,
  endDate: schoolDateSchema,
  status: z.enum(['planned', 'current', 'closed']),
});

const reportQuarterSchema = z.object({
  id: z.uuid(),
  number: z.int().min(1).max(4),
  startDate: schoolDateSchema,
  endDate: schoolDateSchema,
  closed: z.boolean(),
  notOfficial: z.boolean(),
});

export const resultsReportChoicesSchema = z.object({
  year: reportYearSchema.nullable(),
  years: z.array(reportYearSchema),
  quarters: z.array(reportQuarterSchema),
  /** The classes whose results table the reader may open. */
  classes: z.array(reportClassSchema.extend({ language: instructionLanguageSchema })),
  /** The graded subjects whose mastery the reader may open; empty for the Head Tutor. */
  subjects: z.array(reportSubjectSchema),
});

export type ResultsReportChoices = z.infer<typeof resultsReportChoicesSchema>;

const quarterStateSchema = z.object({
  quarter: reportQuarterSchema,
  prepared: preparedStampSchema,
  provisional: z.boolean(),
  final: z.object({ closedAt: z.iso.datetime(), version: z.int().min(1) }).nullable(),
});

export const resultsTableQuerySchema = z.strictObject({
  quarterId: z.uuid(),
  classId: z.uuid(),
});

export type ResultsTableQuery = z.infer<typeof resultsTableQuerySchema>;

export const resultsTableSchema = quarterStateSchema.extend({
  class: reportClassSchema,
  /** The graded subjects of the class's journals the reader may read, as columns. */
  subjects: z.array(journalSubjectSchema),
  rows: z.array(
    z.object({
      student: z.object({
        id: z.uuid(),
        firstName: z.string(),
        lastName: z.string(),
        paternalName: z.string().nullable(),
      }),
      /** One per subject column, in the order of `subjects`. */
      results: z.array(
        z.object({
          subjectId: z.uuid(),
          state: z.enum(RATING_STATES),
          /** The whole number shown, for a number only. */
          value: z.int().min(0).max(100).nullable(),
          grade: z.int().min(2).max(5).nullable(),
        }),
      ),
    }),
  ),
});

export type ResultsTable = z.infer<typeof resultsTableSchema>;

export const subjectMasteryQuerySchema = z.strictObject({
  quarterId: z.uuid(),
  subjectId: z.uuid(),
  grade: queryGradeSchema.optional(),
  classId: z.uuid().optional(),
  teacherId: z.uuid().optional(),
});

export type SubjectMasteryQuery = z.infer<typeof subjectMasteryQuerySchema>;

export const subjectMasterySchema = quarterStateSchema.extend({
  subject: journalSubjectSchema,
  /** The students with a number, in each band of `packages/calc` (`GRADE_BANDS`). */
  bands: z.array(
    z.object({
      grade: z.int().min(2).max(5),
      from: z.int().min(0).max(100),
      to: z.int().min(0).max(100),
      students: z.int().min(0),
      percent: percentSchema,
    }),
  ),
  /** The students with a number: what the shares are of. */
  counted: z.int().min(0),
  /** Never in a band (decision 3). */
  exempt: z.int().min(0),
  notAssessed: z.int().min(0),
  noResult: z.int().min(0),
  choices: z.object({
    grades: z.array(gradeSchema),
    classes: z.array(reportClassSchema),
    teachers: z.array(namedSchema),
    journals: z.array(z.object({ id: z.uuid(), unit: journalUnitSchema })),
  }),
});

export type SubjectMastery = z.infer<typeof subjectMasterySchema>;

export const resultsReportExportSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('table'), quarterId: z.uuid(), classId: z.uuid() }),
  z.strictObject({
    kind: z.literal('mastery'),
    quarterId: z.uuid(),
    subjectId: z.uuid(),
    grade: z.int().min(1).max(11).optional(),
    classId: z.uuid().optional(),
    teacherId: z.uuid().optional(),
  }),
]);

export type ResultsReportExport = z.infer<typeof resultsReportExportSchema>;

/* -------------------------------------------------------------- Discipline items */

export const DISCIPLINE_COLUMNS = [
  'held',
  'notStarted',
  'inProgress',
  'complete',
  'lockedIncomplete',
  'noAttendance',
  'noTopic',
  'worksMissing',
  'unplanned',
  'lateEntries',
] as const;

export type DisciplineColumn = (typeof DISCIPLINE_COLUMNS)[number];

export const disciplineItemsQuerySchema = z
  .strictObject({
    from: schoolDateSchema,
    to: schoolDateSchema,
    departmentId: z.uuid().optional(),
    teacherId: z.uuid(),
    column: z.enum(DISCIPLINE_COLUMNS),
  })
  .refine((value) => value.from <= value.to, {
    path: ['to'],
    message: 'The range ends after it starts.',
  });

export type DisciplineItemsQuery = z.infer<typeof disciplineItemsQuerySchema>;

/**
 * What a count of the report stands for (review finding 7): a lesson, or the works or history
 * lines of one lesson or one rating exam, with how many of the count it holds; the items of a
 * column add up to its count.
 */
export const disciplineItemSchema = z.object({
  kind: z.enum(['lesson', 'works', 'entries', 'exam_entries']),
  /** The lesson, or for `exam_entries` the rating exam's date in `date` and no `start`. */
  lessonId: z.uuid().nullable(),
  journalId: z.uuid().nullable(),
  date: schoolDateSchema,
  start: z.int().min(0).nullable(),
  unit: journalUnitSchema.nullable(),
  subject: journalSubjectSchema,
  count: z.int().min(1),
});

export type DisciplineItem = z.infer<typeof disciplineItemSchema>;

export const disciplineItemsSchema = z.object({
  teacher: namedSchema,
  column: z.enum(DISCIPLINE_COLUMNS),
  items: z.array(disciplineItemSchema),
});

export type DisciplineItems = z.infer<typeof disciplineItemsSchema>;

export const disciplineExportSchema = z
  .strictObject({
    from: schoolDateSchema,
    to: schoolDateSchema,
    departmentId: z.uuid().optional(),
  })
  .refine((value) => value.from <= value.to, {
    path: ['to'],
    message: 'The range ends after it starts.',
  });

export type DisciplineExport = z.infer<typeof disciplineExportSchema>;

/* -------------------------------------------------------------- Timetable load */

export const loadReportQuerySchema = z.strictObject({
  /** The Monday of the week. */
  week: schoolDateSchema,
  departmentId: z.uuid().optional(),
});

export type LoadReportQuery = z.infer<typeof loadReportQuerySchema>;

export const loadReportSchema = z.object({
  week: schoolDateSchema,
  departments: z.array(z.object({ id: z.uuid(), names: subjectNamesSchema })),
  /** `06`: "lessons per week for each teacher against contract" (decision 7). */
  teachers: z.array(
    z.object({
      teacher: namedSchema,
      vacancy: z.boolean(),
      /** Dated lessons of the week in this branch, not cancelled, counted for the substitute. */
      lessons: z.int().min(0),
      /** The load rows of this branch's published version in force: lessons per week. */
      planned: z.int().min(0),
      /** The load rows of the other branches (`teacher_load_elsewhere`, published versions). */
      elsewhere: z.int().min(0),
      /** `staff.weekly_lessons`; `null` when not recorded. */
      contract: z.int().min(0).nullable(),
      /** `06`, Weekly load: this branch's planned load and the other branches'. */
      total: z.int().min(0),
      /** The total against the contract; `null` with no contract recorded. */
      againstContract: z.enum(['under', 'equal', 'over']).nullable(),
      /** Invigilations of the week, apart from lessons and counting for nothing. */
      invigilations: z.int().min(0),
    }),
  ),
  /** `06`: "lessons per subject for each class against the load". */
  classes: z.array(
    z.object({
      unit: journalUnitSchema,
      subject: reportSubjectSchema,
      lessons: z.int().min(0),
      load: z.int().min(0),
    }),
  ),
  /** `06`: "room use in percent": of the lesson slots of the week's day templates. */
  rooms: z.array(
    z.object({
      room: namedSchema,
      lessons: z.int().min(0),
      periods: z.int().min(0),
      percent: percentSchema,
    }),
  ),
  /** `06`, Rules: "a free period in the middle of a class's day" (the engine's `class_free_period`). */
  freePeriods: z.array(
    z.object({
      class: reportClassSchema,
      weekday: z.int().min(1).max(7),
      start: z.int().min(0),
      end: z.int().min(0),
    }),
  ),
});

export type LoadReport = z.infer<typeof loadReportSchema>;

export const loadReportExportSchema = loadReportQuerySchema;

export type LoadReportExport = z.infer<typeof loadReportExportSchema>;

export const attendanceReportExportSchema = attendanceReportQuerySchema;

export type AttendanceReportExport = z.infer<typeof attendanceReportExportSchema>;
