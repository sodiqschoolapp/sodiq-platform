import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { journalSubjectSchema, journalUnitSchema } from './journal-units.js';

/**
 * The early-warning list (task 9.4a, pull request #235; `08`, Early-warning list;
 * `edge/calculation`, "The early-warning list compares a mid-quarter figure without the exam
 * against last quarter's final with the exam"; `edge/journal`, "Three absences in a row").
 * Worked out on read through `packages/calc` (`earlyWarningReasons`), for one quarter of the
 * branch of the request:
 *
 * - `GET /api/results/early-warning?quarterId=`: the entries the reader may see, one per student
 *   and subject, each with its reasons, figures and trend;
 * - `POST /api/results/early-warning/handled`: a Tutor's or teacher's staff-only note and the
 *   mark "handled" on one reason of an entry. It returns only if the figure gets worse.
 *
 * Figures are whole numbers, rounded once as the list compares them (`edge/calculation`:
 * "Thresholds such as 'below 50' use the same rounded number").
 */

export const EARLY_WARNING_REASONS = [
  'low_result',
  'result_drop',
  'low_attendance',
  'absences_in_row',
] as const;

export type EarlyWarningReasonKind = (typeof EARLY_WARNING_REASONS)[number];

/** The note of a handled entry; the bound of `early_warning_handled_note_check` (0137). */
export const EARLY_WARNING_NOTE_MAX_LENGTH = 500;

export const earlyWarningQuerySchema = z
  .strictObject({
    /** Left out: the quarter containing today, else the last started quarter (plan decision 10). */
    quarterId: z.uuid().optional(),
    /**
     * Task 9.4b, plan decision 2: the entries of the journals the reader teaches only (the home
     * page's "early-warning list for own journals"); it narrows, never widens.
     */
    for: z.literal('own_journals').optional(),
    /**
     * Task 9.4b: the entries of the students of one own class of the reader as Tutor (the Tutor's
     * home, "early-warning list for the class"); another class is refused.
     */
    classId: z.uuid().optional(),
  })
  .refine((query) => query.for === undefined || query.classId === undefined, {
    message: 'for and classId are not given together',
    path: ['classId'],
  });

export type EarlyWarningQuery = z.infer<typeof earlyWarningQuerySchema>;

export const earlyWarningHandleSchema = z.strictObject({
  quarterId: z.uuid(),
  studentId: z.uuid(),
  subjectId: z.uuid(),
  reason: z.enum(EARLY_WARNING_REASONS),
  note: z.string().trim().max(EARLY_WARNING_NOTE_MAX_LENGTH).default(''),
});

export type EarlyWarningHandle = z.infer<typeof earlyWarningHandleSchema>;
export type EarlyWarningHandleInput = z.input<typeof earlyWarningHandleSchema>;

export const earlyWarningHandledSchema = z.object({
  handledAt: z.iso.datetime(),
});

export type EarlyWarningHandled = z.infer<typeof earlyWarningHandledSchema>;

const quarterSchema = z.object({
  id: z.uuid(),
  number: z.int().min(1).max(4),
  startDate: schoolDateSchema,
  endDate: schoolDateSchema,
  /** A closed quarter is read only: nothing is marked handled (review of the plan, correction 1). */
  closed: z.boolean(),
});

/** A rounded figure, `null` when there is none. */
const figureSchema = z.int().min(0).max(100).nullable();

const reasonSchema = z.object({
  kind: z.enum(EARLY_WARNING_REASONS),
  /** The rounded result or attendance, the drop in points, or the length of the run. */
  figure: z.int().min(0).max(1000),
  /** A drop: the figures it was measured against. */
  against: z.array(z.enum(['days_ago', 'previous_quarter'])),
  /** The latest time the reason was marked handled; it returned because its figure got worse. */
  handledBefore: z
    .object({
      note: z.string(),
      handledAt: z.iso.datetime(),
      figure: z.int().min(0).max(1000),
      /** The person, "last first", as the audit log names its actors. */
      by: z.string(),
    })
    .nullable(),
});

export const earlyWarningEntrySchema = z.object({
  student: z.object({
    id: z.uuid(),
    firstName: z.string(),
    lastName: z.string(),
    paternalName: z.string().nullable(),
  }),
  subject: journalSubjectSchema,
  /** The journal of the student's last membership of the subject in the quarter. */
  journal: z.object({ id: z.uuid(), unit: journalUnitSchema }),
  /** Only the attendance reasons are shown (the Head Tutor, the Spiritual Vice Principal). */
  attendanceOnly: z.boolean(),
  figures: z.object({
    /** The provisional quarter result, with the rating exam where entered. */
    result: figureSchema,
    /** The current-work figure (no exam): now, 28 days ago, and of the previous quarter. */
    currentWork: z.object({
      now: figureSchema,
      daysAgo: figureSchema,
      previousQuarter: figureSchema,
    }),
    attendance: figureSchema,
    absenceRun: z.int().min(0),
    /** `null` for a reader of the attendance reasons only (permission review, should-fix 4). */
    gradedWorks: z.int().min(0).nullable(),
  }),
  reasons: z.array(reasonSchema).min(1),
  /** The reader may add a note and mark a reason handled. */
  canHandle: z.boolean(),
});

export type EarlyWarningEntry = z.infer<typeof earlyWarningEntrySchema>;

export const earlyWarningListSchema = z.object({
  /** `null` when no quarter of the branch has started. */
  quarter: quarterSchema.nullable(),
  /** The started quarters of the quarter's academic year. */
  quarters: z.array(quarterSchema),
  thresholds: z.object({
    lowResult: z.int(),
    resultDrop: z.int(),
    attendancePercent: z.int(),
    absencesInRow: z.int(),
    gradedWorks: z.int(),
  }),
  /** The day "28 days ago" (branch time); `null` with no quarter. */
  daysAgoDate: schoolDateSchema.nullable(),
  entries: z.array(earlyWarningEntrySchema),
});

export type EarlyWarningList = z.infer<typeof earlyWarningListSchema>;
