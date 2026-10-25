import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { JOURNAL_PARTS, journalSubjectSchema, journalUnitSchema } from './journal.js';

/**
 * A student's results and attendance on the profile (task 9.1; `08`, Student
 * results: "A student's page shows, for each subject and quarter: attendance
 * average, classwork average, homework average, rating exam, quarter result
 * and grade. Clicking a figure opens the lessons behind it. The year result
 * is shown when the fourth quarter is closed"; `04`, Profile tabs: Results,
 * Attendance). Worked out on read from the journal through `packages/calc`
 * (`studentQuarterOutcome`, `outcomeForYear`, `yearResult`,
 * `quarterAttendanceAverage`); the API calculates nothing of its own.
 *
 * - `GET /api/results/students/:id/tabs`: which of the two tabs the reader has.
 * - `GET /api/results/students/:id?yearId=`: the Results tab.
 * - `GET /api/results/students/:id/attendance?yearId=`: the Attendance tab.
 * - `GET /api/results/students/:id/lessons?subjectId=&quarterId=`: the lessons behind a figure.
 *
 * Every subject is answered only to a reader of the student's row of its
 * journal (decision 4, Look first): whole for Results and the works of the
 * lessons, attendance also for the Attendance tab and the marks.
 */

export const studentResultsQuerySchema = z.object({
  /** The academic year; when left out, the current one, else the newest that has started. */
  yearId: z.uuid().optional(),
});

export type StudentResultsQuery = z.infer<typeof studentResultsQuerySchema>;

export const studentResultLessonsQuerySchema = z.object({
  subjectId: z.uuid(),
  quarterId: z.uuid(),
});

export type StudentResultLessonsQuery = z.infer<typeof studentResultLessonsQuerySchema>;

/** Which tabs the reader has (the tabs follow the server, never the role). */
export const studentResultTabsSchema = z.object({
  /** The reader reads the student's row of some journal of any year of the branch whole. */
  results: z.boolean(),
  /** The reader reads the student's row of some journal of that year at all. */
  attendance: z.boolean(),
});

export type StudentResultTabs = z.infer<typeof studentResultTabsSchema>;

/** A year of the branch, newest first, for the selector. */
const resultYearSchema = z.object({
  id: z.uuid(),
  startDate: schoolDateSchema,
  endDate: schoolDateSchema,
  status: z.enum(['planned', 'current', 'closed']),
});

/**
 * A quarter of the year. `notInSystem`: it ended before the branch's start
 * date (`edge/academic-year`, Earlier quarters: "marked 'not in the system'
 * and left out of the year result").
 */
const resultQuarterSchema = z.object({
  id: z.uuid(),
  number: z.int().min(1).max(4),
  startDate: schoolDateSchema,
  endDate: schoolDateSchema,
  notInSystem: z.boolean(),
});

export const RESULT_FLAGS = ['few_lessons', 'attendance_only', 'left_subject'] as const;

/** The outcome of a quarter as shown (`edge/00-definitions`, Result states). */
export const quarterOutcomeShownSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('number'),
    shown: z.int().min(0).max(100),
    grade: z.int().min(2).max(5),
    /** `07`, rule 8: a weighted part has no data while the quarter is open. */
    provisional: z.boolean(),
    /** `edge/calculation`: the "part left out" marker. */
    leftOut: z.array(z.enum(JOURNAL_PARTS)),
    /** The flags decided at closing (9.2a), shown until then. */
    flags: z.array(z.enum(RESULT_FLAGS)),
  }),
  z.object({ kind: z.literal('exempt') }),
  z.object({ kind: z.literal('not_assessed') }),
  z.object({ kind: z.literal('no_result') }),
]);

export type QuarterOutcomeShown = z.infer<typeof quarterOutcomeShownSchema>;

const resultSubjectQuarterSchema = z.object({
  quarterId: z.uuid(),
  /** The journal of the student's last membership of the subject in the quarter. */
  unit: journalUnitSchema,
  attendance: z.int().min(0).max(100).nullable(),
  classwork: z.int().min(0).max(100).nullable(),
  homework: z.int().min(0).max(100).nullable(),
  /** `null` with no score; `ratingShown` says whether the quarter has the part at all. */
  ratingExam: z.int().min(0).max(100).nullable(),
  ratingShown: z.boolean(),
  outcome: quarterOutcomeShownSchema,
  /** "based on n of N lessons". */
  basedOn: z.object({ expected: z.int().min(0), held: z.int().min(0) }),
  /** The labels of `studentQuarterOutcome`. */
  countsFrom: schoolDateSchema.nullable(),
  leftSubjectOn: schoolDateSchema.nullable(),
  atLeaving: schoolDateSchema.nullable(),
});

export type ResultSubjectQuarter = z.infer<typeof resultSubjectQuarterSchema>;

/** The year result (`07`, rule 11), "based on n of 4 quarters". */
const yearShownSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('number'),
    shown: z.int().min(0).max(100),
    grade: z.int().min(2).max(5),
    basedOn: z.int().min(1).max(4),
  }),
  z.object({ kind: z.literal('no_result') }),
]);

export const studentResultsSchema = z.object({
  /** `null` when the branch has no year to show. */
  year: resultYearSchema.nullable(),
  years: z.array(resultYearSchema),
  quarters: z.array(resultQuarterSchema),
  /** In subject order (English name); only the subjects the reader reads whole. */
  subjects: z.array(
    z.object({
      subject: journalSubjectSchema,
      /** The quarters with a held lesson where the subject is graded. */
      quarters: z.array(resultSubjectQuarterSchema),
      /** Answered only once it is shown (decision 1, Look first); `null` before. */
      year: yearShownSchema.nullable(),
    }),
  ),
});

export type StudentResults = z.infer<typeof studentResultsSchema>;

/** The counts of the marks over the counted lessons (no percent is derived from them). */
const markCountsSchema = z.object({
  present: z.int().min(0),
  absent: z.int().min(0),
  late: z.int().min(0),
  skipped: z.int().min(0),
  exempt: z.int().min(0),
  unmarked: z.int().min(0),
});

export const studentAttendanceSchema = z.object({
  year: resultYearSchema.nullable(),
  years: z.array(resultYearSchema),
  quarters: z.array(resultQuarterSchema),
  subjects: z.array(
    z.object({
      subject: journalSubjectSchema,
      quarters: z.array(
        z.object({
          quarterId: z.uuid(),
          unit: journalUnitSchema,
          attendanceOnly: z.boolean(),
          average: z.int().min(0).max(100).nullable(),
          counts: markCountsSchema,
        }),
      ),
    }),
  ),
});

export type StudentAttendance = z.infer<typeof studentAttendanceSchema>;

const traceWorkSchema = z.object({
  workId: z.uuid(),
  title: z.string().nullable(),
  position: z.int().min(1),
  score: z.int().min(0).nullable(),
  total: z.int().min(1),
  percent: z.int().min(0).max(100).nullable(),
});

export const studentResultLessonsSchema = z.object({
  subject: journalSubjectSchema,
  quarter: z.object({ id: z.uuid(), number: z.int().min(1).max(4) }),
  /** `attendance`: the marks only. */
  reading: z.enum(['whole', 'attendance']),
  lessons: z.array(
    z.object({
      lessonId: z.uuid(),
      date: schoolDateSchema,
      unit: z.object({ journalId: z.uuid(), name: z.string() }),
      mark: z.int().min(0).max(5).nullable(),
      /** The attendance value counted (`07`, rule 1); `null` unmarked or exempt. */
      attendanceValue: z.int().min(0).max(100).nullable(),
      classworks: z.array(traceWorkSchema),
      homeworks: z.array(traceWorkSchema),
    }),
  ),
  /** The rating exam entry counted; `null` with none, or for a reader of attendance. */
  ratingExam: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('score'), score: z.int().min(0).max(100) }),
      z.object({ kind: z.literal('did_not_sit') }),
      z.object({ kind: z.literal('exempt') }),
      z.object({ kind: z.literal('not_held') }),
    ])
    .nullable(),
});

export type StudentResultLessons = z.infer<typeof studentResultLessonsSchema>;

/**
 * The preview of a change of a quarter's late and skipped values or of a
 * quarterly distribution (task 9.1, From 1.6 decision 3 and From 2.1
 * decision 4; `edge/calculation`, "Before saving, the system shows how many
 * grades will change in each journal, asks for a reason"):
 *
 * - `POST /api/setup/quarters/:id/attendance-values/preview`
 * - `POST /api/setup/subjects/:id/quarter-weights/:quarterId/preview`
 * - `POST /api/setup/subjects/:id/quarter-weights/copy/preview`
 *
 * Each runs its write and rolls it back; it refuses what the write refuses.
 * `grades` counts each member of the journal in the quarter once whose shown
 * grade or result state changes (decision 2, Look first); `results` counts
 * the shown results that change. Only journals with a change are listed.
 */
export const gradeChangesSchema = z.object({
  /** The write changes a stored value: it needs a reason (decision 5). */
  reasonRequired: z.boolean(),
  quarters: z.array(
    z.object({
      quarterId: z.uuid(),
      number: z.int().min(1).max(4),
      journals: z.array(
        z.object({
          journalId: z.uuid(),
          unit: journalUnitSchema,
          subject: journalSubjectSchema,
          grades: z.int().min(0),
          results: z.int().min(0),
        }),
      ),
    }),
  ),
});

export type GradeChanges = z.infer<typeof gradeChangesSchema>;
