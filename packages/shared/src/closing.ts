import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { JOURNAL_PARTS, journalSubjectSchema, journalUnitSchema } from './journal.js';
import { RESULT_FLAGS } from './results.js';

/**
 * The closing checklist of a quarter (task 9.2a, pull request #229; `07`,
 * Closing a quarter: "The Academic Vice Principal closes a quarter from one
 * checklist screen. It lists everything unfinished, grouped by teacher and
 * class, with a link to each item and a 'remind' button that sends the list
 * to the teachers concerned"; `edge/journal`, Closing and reopening;
 * `edge/calculation`). Worked out on read from stored rows; the results come
 * from `studentQuarterOutcome` of `packages/calc`.
 *
 * - `GET /api/results/closing?quarterId=`: the checklist (the current quarter when left out).
 * - `PUT /api/results/closing/:quarterId/decisions`: one decision on a flagged result.
 * - `POST /api/results/closing/:quarterId/journals/:journalId/decisions`: a whole journal.
 * - `POST /api/results/closing/:quarterId/plan-periods/end`: "end them all".
 * - `POST /api/results/closing/:quarterId/remind`: the list to each teacher concerned.
 * - `POST /api/results/closing/:quarterId/close`: the close of the quarter for the whole branch
 *   (task 9.2b, pull request #230), also again after a reopening (task 9.2c).
 * - `POST /api/results/closing/:quarterId/reopen`: the reopening of the whole branch or of one
 *   journal (task 9.2c, pull request #231).
 * - `POST /api/results/closing/:quarterId/journals/:journalId/close`: a reopened journal closed again.
 * - `GET /api/results/closing/:quarterId/recalculation`: "recalculate and compare".
 * - `POST /api/results/closing/:quarterId/recalculation/apply`: "apply with a reason".
 */

/** "The checklist opens two weeks earlier" (`07`, decision 4 of the plan). */
export const CLOSING_OPENS_DAYS_BEFORE = 14;

export const CLOSING_DECISIONS = ['keep', 'exempt', 'not_assessed'] as const;

export type ClosingDecision = (typeof CLOSING_DECISIONS)[number];

export const closingQuerySchema = z.strictObject({ quarterId: z.uuid().optional() });

export type ClosingQuery = z.infer<typeof closingQuerySchema>;

export const closingQuarterParamsSchema = z.strictObject({ quarterId: z.uuid() });

export const closingJournalParamsSchema = z.strictObject({
  quarterId: z.uuid(),
  journalId: z.uuid(),
});

/** One decision; `null` clears it. `version` is the stored row's, `null` when none is stored. */
export const closingDecisionInputSchema = z.strictObject({
  subjectId: z.uuid(),
  studentId: z.uuid(),
  decision: z.enum(CLOSING_DECISIONS).nullable(),
  version: z.int().min(1).nullable(),
});

export type ClosingDecisionInput = z.infer<typeof closingDecisionInputSchema>;

export const closingDecisionSchema = z.object({
  decision: z.enum(CLOSING_DECISIONS).nullable(),
  version: z.int().min(1),
});

export type ClosingDecisionAnswer = z.infer<typeof closingDecisionSchema>;

/**
 * A whole journal (`edge/calculation`: "Decisions can be made for a whole
 * journal at once"): the students the person saw listed under it, each once,
 * matched one to one with the students listed now.
 */
export const closingJournalDecisionInputSchema = z.strictObject({
  decision: z.enum(CLOSING_DECISIONS).nullable(),
  students: z
    .array(z.uuid())
    .min(1)
    .max(200)
    .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
      message: 'Each student is named once.',
    }),
});

export type ClosingJournalDecisionInput = z.infer<typeof closingJournalDecisionInputSchema>;

export const closingJournalDecisionSchema = z.object({
  decided: z.array(z.uuid()),
  /** The students the decision does not fit, or no longer listed, with the reason. */
  refused: z.array(
    z.object({
      studentId: z.uuid(),
      code: z.enum([
        'closing_not_flagged',
        'closing_decision_not_allowed',
        'closing_decision_changed',
        'closing_list_changed',
      ]),
    }),
  ),
});

export type ClosingJournalDecision = z.infer<typeof closingJournalDecisionSchema>;

export const closingPeriodsEndedSchema = z.object({ ended: z.int().min(0) });

export const closingRemindedSchema = z.object({ sent: z.int().min(0) });

const closingStudentSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  paternalName: z.string().nullable(),
  uid: z.string(),
});

/** A flagged result on the checklist, with what may be decided now. */
const closingFlaggedSchema = z.object({
  student: closingStudentSchema,
  flags: z.array(z.enum(RESULT_FLAGS)),
  basedOn: z.object({ expected: z.int().min(0), held: z.int().min(0) }),
  leftSubjectOn: schoolDateSchema.nullable(),
  /** The stored decision (`null` when none or cleared) and its row's version. */
  decision: z.enum(CLOSING_DECISIONS).nullable(),
  version: z.int().min(1).nullable(),
  /** The decisions `studentQuarterOutcome` would apply now. */
  allowed: z.array(z.enum(CLOSING_DECISIONS)),
});

export type ClosingFlagged = z.infer<typeof closingFlaggedSchema>;

const closingLessonSchema = z.object({ id: z.uuid(), date: schoolDateSchema });

const itemBase = {
  teacher: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  journal: z
    .object({ id: z.uuid(), unit: journalUnitSchema, subject: journalSubjectSchema })
    .nullable(),
};

export const closingItemSchema = z.discriminatedUnion('kind', [
  // Blocking.
  z.object({
    kind: z.literal('rating_missing'),
    ...itemBase,
    /** `pending`: exempt on the exam day with no entry (`edge/calculation`). */
    students: z.array(z.object({ student: closingStudentSchema, pending: z.boolean() })),
  }),
  z.object({ kind: z.literal('undecided'), ...itemBase, students: z.array(closingFlaggedSchema) }),
  z.object({
    kind: z.literal('decision_outdated'),
    ...itemBase,
    students: z.array(closingFlaggedSchema),
  }),
  z.object({ kind: z.literal('weights_missing'), ...itemBase }),
  z.object({
    kind: z.literal('unlocked'),
    ...itemBase,
    lessons: z.array(closingLessonSchema),
    /** The rating exam of the journal is unlocked. */
    rating: z.boolean(),
  }),
  z.object({
    kind: z.literal('extension_open'),
    ...itemBase,
    fromDate: schoolDateSchema,
    toDate: schoolDateSchema,
    openUntil: z.iso.datetime({ offset: true }),
  }),
  z.object({
    kind: z.literal('edit_period'),
    ...itemBase,
    lessons: z.int().min(1),
    incomplete: z.int().min(0),
  }),
  z.object({ kind: z.literal('plan_periods'), ...itemBase, requests: z.int().min(1) }),
  /**
   * `edge/system-behaviour`, "The nightly check": "A difference ... blocks closing that journal"
   * (task 9.2c): the differences of the journal in the branch's latest finished check.
   */
  z.object({
    kind: z.literal('check_difference'),
    ...itemBase,
    differences: z.int().min(1),
    checkedAt: z.iso.datetime({ offset: true }),
  }),
  // Warnings.
  z.object({
    kind: z.literal('no_attendance'),
    ...itemBase,
    lessons: z.array(closingLessonSchema),
  }),
  z.object({
    kind: z.literal('numbers_missing'),
    ...itemBase,
    lessons: z.array(closingLessonSchema),
  }),
  z.object({
    kind: z.literal('plan_incomplete'),
    ...itemBase,
    state: z.enum(['complete', 'incomplete', 'not_started']),
    empty: z.int().min(0),
    notCovered: z.int().min(0),
    belowMinimum: z.boolean(),
  }),
  /**
   * Task 9.2d (`edge/lesson-plans`: "In quarter 4 only merge or drop exist"; build plan 9.2d:
   * "in quarter 4 refuses to close while one is left"): items not covered with no outcome where
   * no carry is possible: the last quarter of the year, or a next quarter already closed.
   */
  z.object({
    kind: z.literal('plan_not_covered'),
    ...itemBase,
    notCovered: z.int().min(1),
  }),
  z.object({
    kind: z.literal('no_result'),
    ...itemBase,
    students: z.array(closingStudentSchema),
  }),
  z.object({
    kind: z.literal('part_without_data'),
    ...itemBase,
    parts: z.array(z.enum(JOURNAL_PARTS)).min(1),
  }),
  z.object({
    kind: z.literal('no_teacher'),
    ...itemBase,
    days: z.array(z.object({ from: schoolDateSchema, until: schoolDateSchema })),
  }),
]);

export type ClosingItem = z.infer<typeof closingItemSchema>;

export type ClosingItemKind = ClosingItem['kind'];

export const CLOSING_BLOCKING: readonly ClosingItemKind[] = [
  'rating_missing',
  'undecided',
  'decision_outdated',
  'weights_missing',
  'unlocked',
  'extension_open',
  'edit_period',
  'plan_periods',
  'check_difference',
  'plan_not_covered',
];

/**
 * The blocking items "lock now and close" ends (`edge/journal`, Closing and reopening, first
 * row; From 8.4 and 9.2a): the close locks them from its stored moment (task 9.2b, decision 3).
 */
export const CLOSING_LOCK_NOW: readonly ClosingItemKind[] = [
  'unlocked',
  'extension_open',
  'edit_period',
];

/** The warnings of the checklist: acknowledged at the close and stored with it (`07`). */
export const CLOSING_WARNINGS = [
  'no_attendance',
  'numbers_missing',
  'plan_incomplete',
  'no_result',
  'part_without_data',
  'no_teacher',
] as const satisfies readonly ClosingItemKind[];

/** `edge/academic-year`, "Closing the start quarter": keep the platform's results, or "not official". */
export const CLOSING_START_QUARTER = ['keep', 'not_official'] as const;

export type ClosingStartQuarter = (typeof CLOSING_START_QUARTER)[number];

/** A warning as the person saw it listed: its kind and its journal. */
export const closingWarningSeenSchema = z.strictObject({
  kind: z.enum(CLOSING_WARNINGS),
  journalId: z.uuid().nullable(),
});

/**
 * The close (task 9.2b): the warnings seen, each kind and journal once, matched one to one with
 * the warnings listed now; "lock now and close"; the start quarter's choice, `null` for any
 * other quarter.
 */
export const closingCloseInputSchema = z.strictObject({
  warnings: z
    .array(closingWarningSeenSchema)
    .max(5000)
    .refine(
      (seen) =>
        new Set(seen.map((one) => `${one.kind}|${one.journalId?.toLowerCase() ?? ''}`)).size ===
        seen.length,
      { message: 'Each warning is named once.' },
    ),
  lockNow: z.boolean(),
  startQuarter: z.enum(CLOSING_START_QUARTER).nullable(),
});

export type ClosingCloseInput = z.infer<typeof closingCloseInputSchema>;

export const closingClosedSchema = z.object({
  closedAt: z.iso.datetime({ offset: true }),
  version: z.int().min(1),
  /** The final results stored, those at leaving included. */
  stored: z.int().min(0),
  /** The waiting plan requests made void. */
  voided: z.int().min(0),
  /** Task 9.2d: the not-covered items carried into the next quarter's tray by the close. */
  carried: z.int().min(0),
});

export type ClosingClosed = z.infer<typeof closingClosedSchema>;

/** A result as it is shown, to list the results that changed (task 9.2c, plan decision 8). */
export const closingOutcomeSchema = z.object({
  kind: z.enum(['number', 'exempt', 'not_assessed', 'no_result']),
  /** The result rounded as it is shown, for a number. */
  shown: z.int().nullable(),
  grade: z.int().min(2).max(5).nullable(),
  decision: z.enum(CLOSING_DECISIONS).nullable(),
});

export type ClosingOutcome = z.infer<typeof closingOutcomeSchema>;

/**
 * `edge/journal`: "Closing again lists every result that changed": a student and subject whose
 * result differs from the record in force before the reopening; `before` null for a new one.
 */
export const closingChangeSchema = z.object({
  student: closingStudentSchema,
  subject: journalSubjectSchema,
  journalId: z.uuid(),
  before: closingOutcomeSchema.nullable(),
  after: closingOutcomeSchema,
});

export type ClosingChange = z.infer<typeof closingChangeSchema>;

/** The reopening of a quarter (task 9.2c): for the whole branch, or for one journal. */
export const closingReopenInputSchema = z.strictObject({
  journalId: z.uuid().nullable(),
  reason: z.string().trim().min(1).max(500),
  /** "For a set number of days" (`edge/journal`; plan decision 21). */
  days: z.int().min(1).max(14),
});

export type ClosingReopenInput = z.infer<typeof closingReopenInputSchema>;

export const closingReopeningSchema = z.object({
  id: z.uuid(),
  /** `null`: the whole branch. */
  journal: z
    .object({ id: z.uuid(), unit: journalUnitSchema, subject: journalSubjectSchema })
    .nullable(),
  reason: z.string(),
  days: z.int().min(1).max(14),
  reopenedAt: z.iso.datetime({ offset: true }),
  reopenedBy: z.string(),
  /** Entries are taken until this moment (plan decision 3). */
  openUntil: z.iso.datetime({ offset: true }),
  /** The end has passed: only the decisions and the close again are left. */
  ended: z.boolean(),
  /** Closed again; `null` while unfinished. */
  closedAgainVersion: z.int().min(1).nullable(),
});

export type ClosingReopening = z.infer<typeof closingReopeningSchema>;

/** A reopened journal on the checklist of a closed quarter: its own items and changes. */
export const closingReopenedJournalSchema = z.object({
  reopening: closingReopeningSchema,
  closable: z.boolean(),
  lockNowNeeded: z.boolean(),
  blocking: z.int().min(0),
  warnings: z.int().min(0),
  items: z.array(closingItemSchema),
  changes: z.array(closingChangeSchema),
});

export type ClosingReopenedJournal = z.infer<typeof closingReopenedJournalSchema>;

/** A journal of the close in force, with the names stored with it, for the reopening's choice. */
export const closingClosedJournalSchema = z.object({
  id: z.uuid(),
  unitName: z.string(),
  subjectNames: z.object({ uz: z.string(), ru: z.string(), en: z.string() }),
});

/** The latest finished nightly check of the branch (task 9.2c). */
export const closingCheckSchema = z.object({
  checkedAt: z.iso.datetime({ offset: true }),
  /** The differences of this quarter, by journal. */
  journals: z.array(z.object({ journalId: z.uuid(), differences: z.int().min(1) })),
});

/** The close of one reopened journal again (task 9.2c): its warnings seen, "lock now". */
export const closingJournalCloseInputSchema = z.strictObject({
  warnings: closingCloseInputSchema.shape.warnings,
  lockNow: z.boolean(),
});

export type ClosingJournalCloseInput = z.infer<typeof closingJournalCloseInputSchema>;

export const closingReopenedSchema = z.object({
  id: z.uuid(),
  openUntil: z.iso.datetime({ offset: true }),
});

export type ClosingReopened = z.infer<typeof closingReopenedSchema>;

/**
 * "Recalculate and compare" (`edge/calculation`, "A bug is found after results were closed and
 * exported"): each record in force the current module calculates otherwise. Changes nothing.
 */
export const closingRecalculationSchema = z.object({
  quarterId: z.uuid(),
  currentVersion: z.int().min(1),
  rows: z.array(
    z.object({
      student: closingStudentSchema,
      subject: journalSubjectSchema,
      journalId: z.uuid(),
      storedVersion: z.int().min(1),
      /** The paths of the outcome that differ. */
      differences: z.array(z.string()),
      /** The code the current module refuses the stored inputs with, else `null`. */
      refused: z.string().nullable(),
      before: closingOutcomeSchema,
      /** `null` when the module refuses the stored inputs. */
      after: closingOutcomeSchema.nullable(),
    }),
  ),
});

export type ClosingRecalculation = z.infer<typeof closingRecalculationSchema>;

/** "Applying them is a separate action with a reason": the rows the person saw, each once. */
export const closingRecalculationApplyInputSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
  students: z
    .array(z.strictObject({ subjectId: z.uuid(), studentId: z.uuid() }))
    .min(1)
    .max(5000)
    .refine(
      (rows) =>
        new Set(rows.map((row) => `${row.subjectId.toLowerCase()}|${row.studentId.toLowerCase()}`))
          .size === rows.length,
      { message: 'Each result is named once.' },
    ),
});

export type ClosingRecalculationApplyInput = z.infer<typeof closingRecalculationApplyInputSchema>;

export const closingRecalculationAppliedSchema = z.object({
  version: z.int().min(1),
  stored: z.int().min(0),
});

export type ClosingRecalculationApplied = z.infer<typeof closingRecalculationAppliedSchema>;

/** The close in force of a closed quarter, as stored. */
export const closingRecordSchema = z.object({
  closedAt: z.iso.datetime({ offset: true }),
  closedBy: z.string(),
  version: z.int().min(1),
  lockNow: z.boolean(),
  startQuarter: z.enum(CLOSING_START_QUARTER).nullable(),
  /** The warnings acknowledged, as they were listed. */
  warnings: z.array(closingItemSchema),
});

export type ClosingRecord = z.infer<typeof closingRecordSchema>;

export const closingChecklistSchema = z.object({
  quarters: z.array(
    z.object({
      id: z.uuid(),
      number: z.int().min(1).max(4),
      startDate: schoolDateSchema,
      endDate: schoolDateSchema,
    }),
  ),
  /** `null` when the branch has no dated quarter. */
  quarterId: z.uuid().nullable(),
  /** `not_open` before the checklist opens, `closed` once closed: no items. */
  state: z.enum(['not_open', 'open', 'closed']),
  opensOn: schoolDateSchema.nullable(),
  lastDay: schoolDateSchema.nullable(),
  /**
   * No blocking item other than those "lock now" ends, today the last day or later (`07`), and
   * every earlier quarter of the year closed (task 9.2b, review correction 1).
   */
  closable: z.boolean(),
  /** An item that "lock now and close" ends is listed: the close needs `lockNow`. */
  lockNowNeeded: z.boolean(),
  /** The start quarter of the branch: the close needs "keep" or "not official". */
  startQuarter: z.boolean(),
  /** An earlier quarter of the year is still open (`edge/journal`: "Quarters are closed in order"). */
  earlierOpen: z.boolean(),
  /** The close in force; `null` while the quarter is open. */
  closing: closingRecordSchema.nullable(),
  /** Every reopening of the quarter, oldest first (task 9.2c). */
  reopenings: z.array(closingReopeningSchema),
  /** The unfinished whole-branch reopening of an open state, else `null`. */
  reopening: closingReopeningSchema.nullable(),
  /** While the whole branch is reopened: the results that changed since the version before. */
  changes: z.array(closingChangeSchema),
  /** A closed quarter: its journals, to reopen one. */
  closedJournals: z.array(closingClosedJournalSchema),
  /** A closed quarter: the journals reopened and not closed again. */
  reopenedJournals: z.array(closingReopenedJournalSchema),
  /** The latest finished nightly check of the branch, or `null`. */
  check: closingCheckSchema.nullable(),
  /** The reader may apply a recalculation (`results_recalculation` `edit`). */
  canApply: z.boolean(),
  /** The reader may decide, end the plan periods and remind. */
  canEdit: z.boolean(),
  /**
   * Task 9.3b-2 (From 9.4b, decision 7): the school days of the quarter (`isSchoolDay` over the
   * branch calendar) and those passed up to today in branch time; `null` with no quarter.
   */
  schoolDays: z.object({ passed: z.int().min(0), total: z.int().min(0) }).nullable(),
  blocking: z.int().min(0),
  warnings: z.int().min(0),
  /** Ordered by teacher, then class or group, then subject. */
  items: z.array(closingItemSchema),
});

export type ClosingChecklist = z.infer<typeof closingChecklistSchema>;
