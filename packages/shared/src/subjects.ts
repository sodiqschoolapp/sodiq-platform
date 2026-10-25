import { z } from 'zod';
import { academicYearStatusSchema, schoolDateSchema } from './academic-year.js';
import { FIRST_GRADE, LAST_GRADE } from './day-templates.js';
import { namesSchema } from './setup.js';

/**
 * Subjects and their grading weights (docs/spec/05-classes-groups-subjects.md,
 * Subject and "Grading weights on a subject"; task 2.1). One list for the
 * whole school; the weights per branch (owner's answer 3, docs/decisions.md,
 * "Decided ahead for tasks 2.1 to 2.6"). The database keeps the same bounds
 * (db/migrations/0020), and a test compares them.
 */

/** The bound of a name in each language, as for divisions (decision 11). */
export const SUBJECT_NAME_MAX_LENGTH = 100;

/** Answer 7: one of 12 fixed colours that pass the contrast test in both themes. */
export const SUBJECT_COLOURS = [
  'red',
  'orange',
  'amber',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'pink',
  'brown',
] as const;

export const subjectColourSchema = z.enum(SUBJECT_COLOURS);

export type SubjectColour = z.infer<typeof subjectColourSchema>;

/** `05`: "journal type (graded or attendance only)"; chosen when the subject is created (answer 5). */
export const JOURNAL_TYPES = ['graded', 'attendance_only'] as const;

export const journalTypeSchema = z.enum(JOURNAL_TYPES);

export type JournalType = z.infer<typeof journalTypeSchema>;

/** Answer 8: "any of 1 to 11, ticked". */
export const SUBJECT_GRADES = Array.from(
  { length: LAST_GRADE - FIRST_GRADE + 1 },
  (_, index) => FIRST_GRADE + index,
);

/**
 * The weight of one part of a distribution: a whole number from 1 to 100
 * (decision 8: a part of 0 could leave the scaling of `07` rules 3 and 8 with
 * nothing to scale; a subject without a rating exam turns the switch off).
 */
export const WEIGHT_MIN = 1;
export const WEIGHT_MAX = 100;

/** `05`: "Each distribution must total 100." */
export const WEIGHTS_TOTAL = 100;

/**
 * The reason of a change of weights or of the late and skipped values (task 9.1;
 * `edge/calculation`, week 7: "asks for a reason").
 */
export const CHANGE_REASON_MAX_LENGTH = 500;

export const changeReasonSchema = z.string().trim().min(1).max(CHANGE_REASON_MAX_LENGTH);

const weightSchema = z.int().min(WEIGHT_MIN).max(WEIGHT_MAX);

const TOTAL_MESSAGE = 'The parts total 100.';

/** The daily distribution (`05`): attendance, classwork, homework, totalling 100. */
export const dailyWeightsSchema = z
  .object({ attendance: weightSchema, classwork: weightSchema, homework: weightSchema })
  .refine(
    (weights) => weights.attendance + weights.classwork + weights.homework === WEIGHTS_TOTAL,
    {
      path: ['total'],
      message: TOTAL_MESSAGE,
    },
  );

export type DailyWeights = z.infer<typeof dailyWeightsSchema>;

/**
 * The quarterly distribution of one quarter (`05`): attendance, classwork,
 * homework and, for a subject with a rating exam, the rating exam
 * (`ratingExam` is `null` for one without: "no rating part"), totalling 100.
 */
export const quarterWeightsSchema = z
  .object({
    attendance: weightSchema,
    classwork: weightSchema,
    homework: weightSchema,
    ratingExam: weightSchema.nullable(),
    /** Task 9.1: required for a change of a stored distribution in an open quarter (decision 5). */
    reason: changeReasonSchema.optional(),
  })
  .refine(
    (weights) =>
      weights.attendance + weights.classwork + weights.homework + (weights.ratingExam ?? 0) ===
      WEIGHTS_TOTAL,
    { path: ['total'], message: TOTAL_MESSAGE },
  );

export type QuarterWeights = z.infer<typeof quarterWeightsSchema>;

/**
 * The grades of a subject: at least one, each once, from 1 to 11, in
 * ascending order. The form sends them in that order; a body in another order
 * is refused, so two bodies that mean the same cannot differ (as the working
 * weekdays of a branch).
 */
export const subjectGradesSchema = z
  .array(z.int().min(FIRST_GRADE).max(LAST_GRADE))
  .min(1)
  .refine(
    (grades) => grades.every((grade, index) => index === 0 || grade > (grades[index - 1] ?? 0)),
    {
      message: 'Each grade once, in ascending order.',
    },
  );

const subjectNamesSchema = namesSchema.extend({
  uz: z.string().trim().min(1).max(SUBJECT_NAME_MAX_LENGTH),
  ru: z.string().trim().min(1).max(SUBJECT_NAME_MAX_LENGTH),
  en: z.string().trim().min(1).max(SUBJECT_NAME_MAX_LENGTH),
});

/** The fields of a subject that are the same in every branch. */
const subjectFieldsSchema = z.object({
  names: subjectNamesSchema,
  /** An active department of the Academic division (decision 6). */
  departmentId: z.uuid(),
  grades: subjectGradesSchema,
  colour: subjectColourSchema,
  journalType: journalTypeSchema,
  ratingExam: z.boolean(),
  groupSubject: z.boolean(),
  /** `05`: "language rule switch (on by default)". */
  languageRule: z.boolean(),
  /** `edge/timetable`: "a subject's 'demanding' switch". */
  demanding: z.boolean(),
});

/**
 * What is typed for a subject: its school-wide fields and the daily
 * distribution of the branch in use. A graded subject cannot be saved without
 * a daily distribution (answer 6); an attendance-only subject has none and no
 * rating exam (`edge/calculation`: "no weights, no lesson score, no result").
 * On an edit, `daily` is sent only when the branch has none yet (decision 15).
 */
export const subjectRecordSchema = subjectFieldsSchema
  .extend({
    daily: dailyWeightsSchema.nullable(),
    /**
     * The start date of a department move of the subject (`edge/people-roles-accounts`,
     * row 15; task 3.4c, decision 2): sent with a move only, today or later in
     * the branch's time zone and no later than the end of its latest year.
     */
    departmentStartsOn: schoolDateSchema.nullable().optional(),
    /**
     * The quarter a change of the journal type or the rating exam switch takes
     * effect from, in the year of today in each branch and in every later year
     * (task 8.2, decision 16; `edge/calculation`: "These switches are stored per
     * quarter"). Sent with a change of the switches only.
     */
    switchesFrom: z.int().min(1).max(4).nullable().optional(),
  })
  .superRefine((subject, context) => {
    if (subject.journalType === 'attendance_only') {
      if (subject.ratingExam) {
        context.addIssue({
          code: 'custom',
          path: ['ratingExam'],
          message: 'An attendance-only subject has no rating exam.',
        });
      }
      if (subject.daily !== null) {
        context.addIssue({
          code: 'custom',
          path: ['daily'],
          message: 'An attendance-only subject has no weights.',
        });
      }
    }
  });

export type SubjectRecord = z.infer<typeof subjectRecordSchema>;

/**
 * The create additionally needs the daily distribution of a graded subject
 * (answer 6: "A graded subject cannot be saved without a daily distribution
 * that totals 100").
 */
export const newSubjectRecordSchema = subjectRecordSchema.superRefine((subject, context) => {
  if (subject.journalType === 'graded' && subject.daily === null) {
    context.addIssue({
      code: 'custom',
      path: ['daily'],
      message: 'A graded subject has a daily distribution.',
    });
  }
});

/** A subject as the routes answer it, with the weights of the branch of the request. */
export const subjectSchema = subjectFieldsSchema.extend({
  id: z.uuid(),
  /**
   * The department in force today in the branch time of the request (task
   * 3.6b-3, decision 6): until a planned move's start date, the one before it.
   */
  departmentId: z.uuid(),
  /** The date the department in force has held since (task 3.4c, decision 8); `null` if never moved. */
  departmentSince: schoolDateSchema.nullable(),
  /**
   * A move planned after today (task 3.6b-3): the department the rules
   * already read, and the date the record shows it from; `null` without one.
   */
  departmentMove: z.object({ departmentId: z.uuid(), startsOn: schoolDateSchema }).nullable(),
  archivedAt: z.iso.datetime().nullable(),
  /** This branch's daily distribution; `null` while not set (decision 2). */
  daily: dailyWeightsSchema.nullable(),
  /**
   * How many quarters of the branch's planned and current years have no
   * quarterly distribution that fits the rating switch (decision 3); 0 for
   * an attendance-only subject. `null` when there is nothing to count: an
   * attendance-only subject, or a branch without a planned or current year.
   */
  quarterWeightsMissing: z.int().min(0).nullable(),
  /**
   * The quarters `quarterWeightsMissing` counts against, for "4 of 4 not set"
   * (finding 20; task 2.7b-1, decision 8); `null` exactly when it is.
   */
  quarterCount: z.int().min(0).nullable(),
});

export type Subject = z.infer<typeof subjectSchema>;

export const subjectListSchema = z.object({
  subjects: z.array(subjectSchema),
  /**
   * Whether the account may move a subject to another department: it holds a
   * current Super Admin assignment (decision 17). The server decides it from
   * every current assignment, so the screen follows this, not the role shown.
   */
  mayMoveDepartment: z.boolean(),
});

export type SubjectList = z.infer<typeof subjectListSchema>;

/** `GET /api/setup/subjects/:id/quarter-weights?yearId=`. */
export const subjectQuarterWeightsQuerySchema = z.object({ yearId: z.uuid() });

export type SubjectQuarterWeightsQuery = z.infer<typeof subjectQuarterWeightsQuerySchema>;

/** `PUT /api/setup/subjects/:id/quarter-weights/:quarterId`. */
export const subjectQuarterParamsSchema = z.object({ id: z.uuid(), quarterId: z.uuid() });

export type SubjectQuarterParams = z.infer<typeof subjectQuarterParamsSchema>;

/** `POST /api/setup/subjects/:id/quarter-weights/copy`: the year whose quarter 1 is copied. */
export const copyQuarterWeightsRecordSchema = z.object({
  yearId: z.uuid(),
  /** Task 9.1: required when the copy changes a stored distribution (decision 5). */
  reason: changeReasonSchema.optional(),
});

export type CopyQuarterWeightsRecord = z.infer<typeof copyQuarterWeightsRecordSchema>;

/** One quarter of a year with the subject's distribution there. */
export const subjectQuarterSchema = z.object({
  quarterId: z.uuid(),
  number: z.int().min(1).max(4),
  startDate: schoolDateSchema.nullable(),
  endDate: schoolDateSchema.nullable(),
  /** The stored distribution, or `null` when none is stored. */
  weights: z
    .object({
      attendance: z.int(),
      classwork: z.int(),
      homework: z.int(),
      ratingExam: z.int().nullable(),
    })
    .nullable(),
  /** Whether the stored distribution fits the subject's rating switch in the quarter (decision 3; task 8.2). */
  fits: z.boolean(),
  /** The subject is graded in this quarter (task 8.2: the switches are stored per quarter). */
  graded: z.boolean(),
  /** The subject has the rating exam in this quarter: the shape of its distribution (task 8.2). */
  ratingExam: z.boolean(),
});

export type SubjectQuarter = z.infer<typeof subjectQuarterSchema>;

/** The four quarters of one year of the branch for one subject. */
export const subjectQuarterWeightsSchema = z.object({
  yearId: z.uuid(),
  yearStatus: academicYearStatusSchema,
  quarters: z.array(subjectQuarterSchema),
});

export type SubjectQuarterWeights = z.infer<typeof subjectQuarterWeightsSchema>;
