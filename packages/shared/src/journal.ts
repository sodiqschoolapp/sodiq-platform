import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { absenceCategorySchema } from './attendance.js';
import { journalCommentSchema, ratingExamSchema } from './journal-rating.js';
import { subjectColourSchema } from './subjects.js';

/**
 * The journal grid, read only (task 6.2, pull request #210; `07`, Opening a
 * journal, Layout, Who can do what). One journal per class or group and
 * subject in a year (0081); its columns are the dated lessons of a quarter.
 * Every figure is calculated on the server with `packages/calc` and sent as it
 * is shown (decision 7): whole numbers, grades and markers, never a fraction.
 */

const subjectNames = z.object({ uz: z.string(), ru: z.string(), en: z.string() });

const journalUnitSchema = z.object({
  kind: z.enum(['class', 'group']),
  id: z.uuid(),
  /** The class shown with its grade ("7 Oxford"), or the group's name. */
  name: z.string(),
});

const journalSubjectSchema = z.object({
  id: z.uuid(),
  names: subjectNames,
  /** The subject colour, drawn as in the timetable (review correction 3). */
  colour: subjectColourSchema,
});

/** Without a year: the year of today in the branch, or the latest one. */
export const journalListQuerySchema = z.strictObject({ yearId: z.uuid().optional() });

export type JournalListQuery = z.infer<typeof journalListQuerySchema>;

const journalYearSchema = z.object({
  id: z.uuid(),
  startDate: schoolDateSchema,
  endDate: schoolDateSchema,
  /** A closed year opens read only with a label (`12`, Context). */
  closed: z.boolean(),
});

export const journalListSchema = z.object({
  years: z.array(journalYearSchema),
  /** The year listed. */
  yearId: z.uuid().nullable(),
  journals: z.array(
    z.object({ id: z.uuid(), unit: journalUnitSchema, subject: journalSubjectSchema }),
  ),
});

export type JournalList = z.infer<typeof journalListSchema>;

export const journalParamsSchema = z.object({ journalId: z.uuid() });

export type JournalParams = z.infer<typeof journalParamsSchema>;

/** Without a quarter: the quarter of today, or the nearest one of the year. */
export const journalGridQuerySchema = z.strictObject({ quarterId: z.uuid().optional() });

export type JournalGridQuery = z.infer<typeof journalGridQuerySchema>;

/** A weighted part of a result (`packages/calc`, `QuarterPart`). */
export const JOURNAL_PARTS = ['attendance', 'classwork', 'homework', 'ratingExam'] as const;

export type JournalPart = (typeof JOURNAL_PARTS)[number];

/**
 * A result as shown (`edge/00-definitions`, Result states): a number with its
 * grade and markers, or "No result" (nothing was entered: blank, not 0).
 */
const shownResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('number'),
    shown: z.int().min(0).max(100),
    grade: z.int().min(2).max(5),
    /** `07`, rule 8: a weighted part has no data while the quarter is open. */
    provisional: z.boolean(),
    /** `edge/calculation`: the "part left out" marker, with the parts. */
    leftOut: z.array(z.enum(JOURNAL_PARTS)),
  }),
  z.object({ kind: z.literal('no_result') }),
]);

export type ShownResult = z.infer<typeof shownResultSchema>;

/**
 * A student's figures for the quarter or a month. A part with no data is
 * `null`. `result` is `null` for an attendance-only subject, and for a reader
 * who sees attendance only.
 */
const figuresSchema = z.object({
  attendance: z.int().min(0).max(100).nullable(),
  classwork: z.int().min(0).max(100).nullable(),
  homework: z.int().min(0).max(100).nullable(),
  ratingExam: z.int().min(0).max(100).nullable(),
  result: shownResultSchema.nullable(),
});

export type JournalFigures = z.infer<typeof figuresSchema>;

/** The bottom row: the class or group averages of each figure (`07`, Layout). */
const bottomSchema = z.object({
  attendance: z.int().min(0).max(100).nullable(),
  classwork: z.int().min(0).max(100).nullable(),
  homework: z.int().min(0).max(100).nullable(),
  ratingExam: z.int().min(0).max(100).nullable(),
  result: z.int().min(0).max(100).nullable(),
});

export type JournalBottom = z.infer<typeof bottomSchema>;

const journalWorkSchema = z.object({
  /** The stored work; `null` for a column of the plan with no row yet (task 8.1: written at its first write). */
  id: z.uuid().nullable(),
  /** The plan's work, `null` for a work added by hand ("unplanned"). */
  planWorkId: z.uuid().nullable(),
  /** The lesson whose plan item holds it: the classwork's lesson, the lesson where the homework was given. */
  sourceLessonId: z.uuid().nullable(),
  kind: z.enum(['classwork', 'homework']),
  /** Its place among the works of its kind in the lesson, from 1 ("CW 1", decision 11). */
  position: z.int().min(1),
  /** The plan's title; `null` for an unplanned work, which the screen numbers. */
  title: z.string().nullable(),
  /** Added by hand at a lesson with no plan item (`edge/journal`: listed as "unplanned"). */
  unplanned: z.boolean(),
  /** `null` while the teacher has not set it: "Soni" with no number (review correction 2). */
  total: z.int().min(1).max(1000).nullable(),
  notHeld: z.boolean(),
  /** The check lesson a homework was carried from ("check at the next lesson"). */
  carriedFrom: z.uuid().nullable(),
  /** The work's version, `null` before its first write. */
  version: z.int().min(1).nullable(),
});

export type JournalWork = z.infer<typeof journalWorkSchema>;

export const journalLessonSchema = z.object({
  id: z.uuid(),
  date: schoolDateSchema,
  /** Clock minutes of the day in branch time. */
  start: z.int().min(0),
  end: z.int().min(1),
  /** The lesson slot of its day template whose start it has (Row 1: "date, weekday, slot"); `null` when none has. */
  slot: z.int().min(1).nullable(),
  /** `edge/00-definitions`, Held lesson: started, not cancelled, with a teacher recorded. */
  held: z.boolean(),
  cancelled: z.object({ cause: z.string(), reason: z.string().nullable() }).nullable(),
  /** The month whose figures count it, `YYYY-MM`. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  works: z.array(journalWorkSchema),
  /** The reader may enter its attendance now: held, theirs to teach or own (task 6.3, decisions 3 and 15). */
  canEnter: z.boolean(),
  /** The reader may add works and type numbers now: `canEnter`, a graded subject and a journal teacher that day (task 8.1). */
  canEnterWorks: z.boolean(),
  /** The lesson's row has a plan item; `false` shows "No plan" (`edge/journal`, "A lesson is held with no plan item"; task 8.1). */
  planItem: z.boolean(),
  /** The works of the lesson marked "not held": out of the columns, listed for the undo (`09`: "its column is removed from that lesson"). */
  notHeldWorks: z.array(journalWorkSchema),
  /** The homeworks given at this lesson, with the lesson that checks them, or why none does (task 8.1). */
  given: z.array(
    z.object({
      title: z.string().nullable(),
      checkAt: z.uuid().nullable(),
      /** `year_end`: "will not be graded"; `group_closed`: "not checked, group closed" (`edge/lesson-plans`). */
      ungraded: z.enum(['year_end', 'group_closed']).nullable(),
    }),
  ),
});

export type JournalLesson = z.infer<typeof journalLessonSchema>;

/** One cell of a student in a lesson, in the order of `lessons`. */
const journalCellSchema = z.object({
  /** Outside the student's membership, or before the lesson starts (`07`, Editing rules). */
  closed: z.boolean(),
  mark: z.int().min(0).max(3).nullable(),
  /** The attendance cell's version, `null` while never saved (task 6.3: the version a typed mark is sent with). */
  version: z.int().min(1).nullable(),
  /** Who typed the attendance cell last (task 6.3, decision 16: "Every entry shows who typed it"). */
  typedBy: z.string().nullable(),
  /** In the order of the lesson's `works`: the number typed and its percent shown. */
  works: z.array(
    z.object({
      score: z.int().min(0).nullable(),
      percent: z.int().min(0).max(100).nullable(),
      /** The cell's version, `null` while never saved (task 8.1: the version a number is sent with). */
      version: z.int().min(1).nullable(),
      /** A number on a student marked 0 or 3 (`edge/journal`: "marked 'score on an absent student'"). */
      onAbsent: z.boolean(),
    }),
  ),
  /** The lesson score (AVG), `null` when blank or for an attendance-only subject. */
  score: z.int().min(0).max(100).nullable(),
});

export type JournalCell = z.infer<typeof journalCellSchema>;

export const journalStudentSchema = z.object({
  id: z.uuid(),
  /** Its number in the list, from 1. */
  number: z.int().min(1),
  firstName: z.string(),
  lastName: z.string(),
  paternalName: z.string().nullable(),
  uid: z.string(),
  /** Left or moved before the reference date: the folded section (`07`, Layout). */
  folded: z.boolean(),
  cells: z.array(journalCellSchema),
  /** `null` for a reader who sees no figures (a substitute, a former owner). */
  quarter: figuresSchema.nullable(),
  /** By month (`YYYY-MM`) of `months`. */
  months: z.record(z.string(), figuresSchema).nullable(),
  /**
   * The comments on the student's cells and notes of the lessons shown and on
   * the quarter's rating entry, those the reader may read (task 8.2, decision
   * 10: attendance marks only for a reader who sees attendance).
   */
  comments: z.array(journalCommentSchema),
});

export type JournalStudent = z.infer<typeof journalStudentSchema>;

/**
 * What the reader sees (decisions 2 and 3 with review correction 1):
 * `whole`; `attendance` (the Vice Principal for Spiritual and Moral Education
 * and the Head Tutor: attendance columns and average); `lessons` (a
 * substitute or a former owner: the columns of their lessons, no figures).
 */
export const JOURNAL_SHAPES = ['whole', 'attendance', 'lessons'] as const;

export type JournalShape = (typeof JOURNAL_SHAPES)[number];

const journalWeightsSchema = z.object({
  attendance: z.int(),
  classwork: z.int(),
  homework: z.int(),
});

export const journalGridSchema = z.object({
  journal: z.object({
    id: z.uuid(),
    unit: journalUnitSchema,
    subject: journalSubjectSchema,
    year: journalYearSchema,
    /** `edge/calculation`: attendance-only subjects have no weights, score, result or grade. */
    attendanceOnly: z.boolean(),
    /** The subject has the rating exam in the quarter shown (task 8.2: the quarter's switches). */
    ratingExam: z.boolean(),
  }),
  /**
   * The rating exam of the quarter shown (task 8.2): `null` when the subject has
   * none in the quarter, or for a reader who sees attendance or lessons only.
   */
  rating: ratingExamSchema.nullable(),
  /** The years of the branch, for the year selector (`07`, Opening a journal, Selectors). */
  years: z.array(journalYearSchema),
  /** The other journals of the reader in the year, for the class or group and subject selectors. */
  others: z.array(
    z.object({ id: z.uuid(), unit: journalUnitSchema, subject: journalSubjectSchema }),
  ),
  quarters: z.array(
    z.object({
      id: z.uuid(),
      number: z.int().min(1).max(4),
      startDate: schoolDateSchema.nullable(),
      endDate: schoolDateSchema.nullable(),
    }),
  ),
  quarter: z.object({
    id: z.uuid(),
    number: z.int().min(1).max(4),
    startDate: schoolDateSchema,
    endDate: schoolDateSchema,
  }),
  /** Today in branch time, from the injected clock. */
  today: schoolDateSchema,
  /** `edge/00-definitions`, Reference date: the quarter's last day, or today while it is open. */
  referenceDate: schoolDateSchema,
  /** The owner on the reference date (decision 14); `null`: "no teacher". */
  teacher: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  shape: z.enum(JOURNAL_SHAPES),
  /** The months that hold a lesson of the quarter, `YYYY-MM`, in order. */
  months: z.array(z.string().regex(/^\d{4}-\d{2}$/)),
  lessons: z.array(journalLessonSchema),
  students: z.array(journalStudentSchema),
  /** The last total the reader set in this journal, offered for the next work (`07`, The total; task 8.1, decision 9). */
  lastTotal: z.int().min(1).max(1000).nullable(),
  /** `null` when the reader may not see the averages (a Tutor of a mixed group, a lesson reader). */
  bottom: z
    .object({ quarter: bottomSchema, months: z.record(z.string(), bottomSchema) })
    .nullable(),
  /**
   * The reasons of absence of the students shown, in the quarter: the category
   * only (task 6.3, decision 7: "Teachers see the category only").
   */
  absences: z.array(
    z.object({
      studentId: z.uuid(),
      date: schoolDateSchema,
      category: absenceCategorySchema,
    }),
  ),
  legend: z.object({
    lateValue: z.int(),
    skippedValue: z.int(),
    daily: journalWeightsSchema.nullable(),
    quarterly: journalWeightsSchema.extend({ ratingExam: z.int().nullable() }).nullable(),
    /** `edge/calculation`: "The journal legend shows 'changed on [date]'" (decision 22). */
    weightsChangedOn: schoolDateSchema.nullable(),
  }),
});

export type JournalGrid = z.infer<typeof journalGridSchema>;
