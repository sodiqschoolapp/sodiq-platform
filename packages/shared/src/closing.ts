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
 *   (task 9.2b, pull request #230).
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
});

export type ClosingClosed = z.infer<typeof closingClosedSchema>;

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
  /** The reader may decide, end the plan periods and remind. */
  canEdit: z.boolean(),
  blocking: z.int().min(0),
  warnings: z.int().min(0),
  /** Ordered by teacher, then class or group, then subject. */
  items: z.array(closingItemSchema),
});

export type ClosingChecklist = z.infer<typeof closingChecklistSchema>;
