import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import {
  figuresSchema,
  journalCellSchema,
  journalGridSchema,
  journalLessonSchema,
} from './journal.js';
import { ratingEntryValueSchema } from './journal-rating.js';
import { journalSubjectSchema, journalUnitSchema } from './journal-units.js';
import {
  accountNamedSchema,
  cellChangeSchema,
  cellWorkKindSchema,
  workChangeSchema,
} from './reset-entries.js';

/**
 * The support view of one student, journal and date (task 8.9, pull request
 * #227; `edge/journal`, "My grade disappeared": "History records who changed
 * a value and how (teacher, late entry, correction, exemption, transfer,
 * cancellation, 'not held', offline entry), and also what hid it. A support
 * view for one student, journal and date shows every save, every refusal and
 * every such event in order, with how the result was calculated").
 */

/** A work of a lesson as the line names it; `null` for the attendance cell. */
const lineWorkSchema = z
  .object({ id: z.uuid(), kind: cellWorkKindSchema, title: z.string().nullable() })
  .nullable();

/** The exemption a line or a lesson names: the kind and the dates only (`07`, In the journal). */
const supportExemptionSchema = z.object({
  kind: z.enum(['temporary', 'full']),
  startDate: schoolDateSchema,
  endDate: schoolDateSchema,
});

export const SUPPORT_VOID_SOURCES = ['move', 'leaving', 'branch_move', 'return', 'merge'] as const;

export const supportLineSchema = z.discriminatedUnion('kind', [
  /** A line of a cell's history (0108): every save and every change made to the cell. */
  z.object({
    kind: z.literal('cell'),
    at: z.iso.datetime(),
    lessonId: z.uuid(),
    work: lineWorkSchema,
    version: z.int().min(1),
    before: z.int().nullable(),
    after: z.int().nullable(),
    notGradedBefore: z.boolean(),
    notGradedAfter: z.boolean(),
    how: cellChangeSchema,
    by: accountNamedSchema,
    /** The reason of a correction, a void or a forced delete. */
    reason: z.string().nullable(),
    /** A late entry under an unlock: who approved it (`edge/journal`: "with the approver's name"). */
    approvedBy: accountNamedSchema.nullable(),
    /** A late entry by the teacher named for an orphan lesson (task 8.7). */
    orphanAssignment: z.boolean(),
  }),
  /** A line of a work's history (0119): its total and "not held". */
  z.object({
    kind: z.literal('work'),
    at: z.iso.datetime(),
    lessonId: z.uuid(),
    work: z.object({ id: z.uuid(), kind: cellWorkKindSchema, title: z.string().nullable() }),
    totalBefore: z.int().nullable(),
    totalAfter: z.int().nullable(),
    notHeldBefore: z.boolean().nullable(),
    notHeldAfter: z.boolean().nullable(),
    how: workChangeSchema,
    by: accountNamedSchema.nullable(),
  }),
  /** "Topic not delivered" or "homework not given" set or undone (0130). */
  z.object({
    kind: z.literal('delivery'),
    at: z.iso.datetime(),
    lessonId: z.uuid(),
    mark: z.enum(['topic', 'homework']),
    before: z.boolean(),
    after: z.boolean(),
    how: z.string(),
    by: accountNamedSchema.nullable(),
  }),
  /** A save the server refused (0131): what was sent and why. */
  z.object({
    kind: z.literal('refusal'),
    at: z.iso.datetime(),
    /** `null` for a rating entry. */
    lessonId: z.uuid().nullable(),
    field: z.enum(['attendance', 'score', 'rating']),
    work: lineWorkSchema,
    valueSent: z.int().nullable(),
    versionSent: z.int().nullable(),
    code: z.string(),
    by: accountNamedSchema,
  }),
  /** A value an exemption cleared (0123), and when it was given back. */
  z.object({
    kind: z.literal('exemption_clear'),
    at: z.iso.datetime(),
    lessonId: z.uuid(),
    work: lineWorkSchema,
    value: z.int(),
    exemption: supportExemptionSchema,
  }),
  z.object({
    kind: z.literal('exemption_give_back'),
    at: z.iso.datetime(),
    lessonId: z.uuid(),
    work: lineWorkSchema,
    value: z.int(),
    exemption: supportExemptionSchema,
  }),
  /** A value voided by a move, a leaving or a merge (0127), and its give-back. */
  z.object({
    kind: z.literal('void'),
    at: z.iso.datetime(),
    /** `null` for a rating entry. */
    lessonId: z.uuid().nullable(),
    work: lineWorkSchema,
    target: z.enum(['cell', 'comment', 'rating']),
    value: z.int().nullable(),
    source: z.enum(SUPPORT_VOID_SOURCES),
    reason: z.string().nullable(),
    by: accountNamedSchema,
  }),
  z.object({
    kind: z.literal('void_give_back'),
    at: z.iso.datetime(),
    lessonId: z.uuid().nullable(),
    work: lineWorkSchema,
    target: z.enum(['cell', 'comment', 'rating']),
    value: z.int().nullable(),
    source: z.enum(SUPPORT_VOID_SOURCES),
    by: accountNamedSchema,
  }),
  /** A line of the rating entry's history (0120), on the exam's date. */
  z.object({
    kind: z.literal('rating'),
    at: z.iso.datetime(),
    before: ratingEntryValueSchema.nullable(),
    after: ratingEntryValueSchema.nullable(),
    reason: z.string().nullable(),
    how: z.string(),
    by: accountNamedSchema,
  }),
]);

export type SupportLine = z.infer<typeof supportLineSchema>;

export const journalSupportSchema = z.object({
  student: z.object({
    id: z.uuid(),
    firstName: z.string(),
    lastName: z.string(),
    paternalName: z.string().nullable(),
    uid: z.string(),
    /** Left or moved before the reference date: the journal's folded section. */
    folded: z.boolean(),
  }),
  journal: z.object({ id: z.uuid(), unit: journalUnitSchema, subject: journalSubjectSchema }),
  quarter: z.object({ id: z.uuid(), number: z.int().min(1).max(4) }),
  date: schoolDateSchema,
  /** The journal's lessons dated that date, each with the student's cell as the grid shows it. */
  lessons: z.array(
    z.object({
      lesson: journalLessonSchema,
      /** The cell as the grid shows it, with its percents and the lesson score from `packages/calc`. */
      cell: journalCellSchema,
      /** The values stored in the cells, also those an exemption hides. */
      stored: z.object({
        mark: z.int().nullable(),
        works: z.array(z.object({ workId: z.uuid(), score: z.int().nullable() })),
      }),
      /** The exemption that hides the stored values ("what hid it"); `null` when none does. */
      hiddenBy: supportExemptionSchema.nullable(),
    }),
  ),
  /** The student's quarter figures as the grid calculates them (`packages/calc`). */
  figures: figuresSchema.nullable(),
  /** The rating exam's date in force, when the subject has one in the quarter. */
  ratingDate: schoolDateSchema.nullable(),
  legend: journalGridSchema.shape.legend,
  /** Every line, in time order. */
  lines: z.array(supportLineSchema),
});

export type JournalSupport = z.infer<typeof journalSupportSchema>;
