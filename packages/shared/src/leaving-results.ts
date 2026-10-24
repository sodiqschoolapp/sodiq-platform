import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { JOURNAL_PARTS, journalSubjectSchema, journalUnitSchema } from './journal.js';

/**
 * The results at leaving of a student (task 8.6, pull request #224;
 * `edge/calculation`, "A student left the school before the quarter ended":
 * "A 'result at leaving' is stored on the profile: partial, labelled, with
 * the number of lessons"). Worked out on read from the journal with
 * `finalQuarterRecord(…, 'at_leaving')` of `packages/calc` (decision 5, Look
 * first): the lessons up to the last day stay editable until their lock, so
 * a copy stored on the leaving day would differ from the journal. The record
 * is stored as final at the quarter's close (9.2a).
 *
 * `GET /api/people/students/:id/leaving-results`: the readers of the
 * student's record; each subject only for a reader who reads that subject's
 * journal whole on the last day (6.2 decision 20; decision 14).
 */

/** A result at leaving as shown: a number with "based on n of N lessons", "Exempt" or "No result". */
export const leavingOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('number'),
    shown: z.int().min(0).max(100),
    grade: z.int().min(2).max(5),
    /** A weighted part with no data (`07`, rule 8). */
    provisional: z.boolean(),
    leftOut: z.array(z.enum(JOURNAL_PARTS)),
    /** "based on n of N lessons": always shown on a result at leaving. */
    basedOn: z.object({ expected: z.int().min(0), held: z.int().min(0) }),
  }),
  z.object({ kind: z.literal('exempt') }),
  z.object({ kind: z.literal('no_result') }),
]);

export type LeavingOutcome = z.infer<typeof leavingOutcomeSchema>;

export const leavingResultSchema = z.object({
  subject: journalSubjectSchema,
  /** The journal of the student's last membership of the subject. */
  unit: journalUnitSchema,
  quarter: z.object({ id: z.uuid(), number: z.int().min(1) }),
  /** The last day the result counts to: the leaving's last day. */
  lastDay: schoolDateSchema,
  outcome: leavingOutcomeSchema,
});

export type LeavingResult = z.infer<typeof leavingResultSchema>;

export const studentLeavingResultsSchema = z.object({
  /** The last day of the leaving in force; `null` for a student who has not left. */
  lastDay: schoolDateSchema.nullable(),
  /** In subject order (English name); empty with no leaving, or none the reader may read. */
  results: z.array(leavingResultSchema),
});

export type StudentLeavingResults = z.infer<typeof studentLeavingResultsSchema>;
