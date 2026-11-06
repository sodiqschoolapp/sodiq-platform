import {
  studentQuarterOutcome,
  type StudentQuarterInput,
  type StudentQuarterOutcome,
} from '@sodiq/calc';
import { schoolDateOf } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';
import {
  gridWeights,
  journalRows,
  switchesIn,
  type GridWeights,
  type JournalRow,
} from '../journal/journal-grid.query.js';
import { countsFromOf, goLiveOf } from '../journal/start-quarter.js';
import {
  subjectQuarterLessons,
  type StudentSubjectQuarter,
} from '../journal/subject-quarter-lessons.js';
import type { QuarterRef } from './grade-changes.js';
import { decisionsOf, type StoredDecision } from './quarter-decisions.js';

/**
 * The outcome of every member of the graded journals of a quarter (task 9.1,
 * `grade-changes.ts`; task 9.2a, the closing checklist): `studentQuarterOutcome`
 * of `packages/calc` with the inputs the grid gives it (the student's lessons
 * across journals, `subjectQuarterLessons`; the weights of the quarter's
 * switches and round, `gridWeights`) and the stored decision of the closing
 * checklist (decision 1, Look first). Nothing is calculated here.
 */

export interface MemberOutcome {
  /** `null`: no held lesson in the student's journals, or no valid weights. */
  readonly outcome: StudentQuarterOutcome | null;
  /** The input given to the module, to try another decision (`allowedDecisions`). */
  readonly input: StudentQuarterInput | null;
  readonly found: StudentSubjectQuarter | undefined;
  readonly stored: StoredDecision | undefined;
}

export interface JournalOutcomes {
  readonly journal: JournalRow;
  readonly weights: GridWeights;
  readonly ratingShown: boolean;
  /** By student: the members of the journal in the quarter. */
  readonly members: ReadonlyMap<string, MemberOutcome>;
}

/** The members of a journal in the quarter: its class rows, or its group rows of the subject. */
async function membersOf(
  transaction: Transaction,
  journal: JournalRow,
  quarter: QuarterRef,
): Promise<string[]> {
  const rows =
    journal.classId !== null
      ? await transaction
          .selectFrom('class_memberships')
          .select('student_id')
          .distinct()
          .where('class_id', '=', journal.classId)
          .whereRef('valid_from', '<', 'valid_until')
          .where('valid_from', '<=', quarter.endDate)
          .where('valid_until', '>', quarter.startDate)
          .execute()
      : await transaction
          .selectFrom('group_memberships')
          .select('student_id')
          .distinct()
          .where('group_id', '=', journal.groupId ?? '')
          .where('subject_id', '=', journal.subjectId)
          .whereRef('valid_from', '<', 'valid_until')
          .where('valid_from', '<=', quarter.endDate)
          .where('valid_until', '>', quarter.startDate)
          .execute();
  return rows.map((row) => row.student_id).sort();
}

/**
 * The outcomes of the quarter's graded journals of the subjects named (every
 * subject when `subjectIds` is `null`), in the branch of the transaction.
 */
/**
 * Task 10.1c (code review round 1, finding 2): the transactions whose `quarterOutcomes` are kept
 * and shared. A preparation of the report totals reads a subject's outcomes for three kinds of
 * unit (`outcomes`, `figures`, `closing`) in one transaction that writes nothing they read
 * before it has read them, so it works them out once. Only such a transaction is registered
 * (`shareOutcomesIn`): any other reads them again each time, as before.
 */
const shared = new WeakMap<
  object,
  Map<string, Promise<{ journals: ReadonlyMap<string, JournalOutcomes> }>>
>();

/** Keeps the `quarterOutcomes` of `transaction` for its later reads with the same input. */
export function shareOutcomesIn(transaction: Transaction): void {
  if (!shared.has(transaction)) shared.set(transaction, new Map());
}

export function quarterOutcomes(
  transaction: Transaction,
  input: Parameters<typeof outcomesOfQuarter>[1],
): Promise<{ journals: ReadonlyMap<string, JournalOutcomes> }> {
  const kept = shared.get(transaction);
  if (kept === undefined) return outcomesOfQuarter(transaction, input);
  const key = JSON.stringify([
    input.branchId,
    input.timeZone,
    input.now.toISOString(),
    input.quarter.id,
    input.quarter.startDate,
    input.quarter.endDate,
    input.subjectIds === null ? null : [...input.subjectIds].sort(),
    input.journalIds === undefined ? null : [...input.journalIds].sort(),
    input.quarterClosed === true,
  ]);
  const found = kept.get(key);
  if (found !== undefined) return found;
  const reading = outcomesOfQuarter(transaction, input);
  kept.set(key, reading);
  return reading;
}

async function outcomesOfQuarter(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly timeZone: string;
    readonly now: Date;
    readonly quarter: QuarterRef;
    readonly subjectIds: readonly string[] | null;
    /**
     * Task 10.1: only these journals, when given. Each journal's members are still read over
     * every journal of the subject (`subjectQuarterLessons`), so their outcomes are the same.
     */
    readonly journalIds?: readonly string[];
    /**
     * The quarter is closed, or being closed by this transaction (task 9.2b): the module drops
     * the "provisional" marker (`07` rule 8). Read by the caller from the stored state.
     */
    readonly quarterClosed?: boolean;
  },
): Promise<{ journals: ReadonlyMap<string, JournalOutcomes> }> {
  const { quarter } = input;
  // Before its first day no lesson of the quarter is held: no result.
  if (quarter.startDate > schoolDateOf(input.now, input.timeZone)) {
    return { journals: new Map() };
  }
  const journals = (
    await journalRows(transaction, input.branchId, { yearId: quarter.academicYearId })
  ).filter(
    (journal) =>
      (input.subjectIds === null || input.subjectIds.includes(journal.subjectId)) &&
      (input.journalIds === undefined || input.journalIds.includes(journal.id)) &&
      switchesIn(journal, quarter.id)?.attendanceOnly === false,
  );
  const countsFrom = countsFromOf(await goLiveOf(transaction, input.branchId), quarter);
  const answer = new Map<string, JournalOutcomes>();
  const bySubject = new Map<string, JournalRow[]>();
  for (const journal of journals) {
    bySubject.set(journal.subjectId, [...(bySubject.get(journal.subjectId) ?? []), journal]);
  }
  for (const [subjectId, own] of bySubject) {
    const members = new Map<string, string[]>();
    for (const journal of own)
      members.set(journal.id, await membersOf(transaction, journal, quarter));
    const studentIds = [...new Set([...members.values()].flat())];
    // Task 9.4f: a journal of grades 0–4 without the rating exam uses the distribution without it
    // (`withoutRating`); the subject's other journals use the usual one.
    const weightsOf = new Map<boolean, GridWeights>();
    for (const journal of own) {
      const withoutRating = switchesIn(journal, quarter.id)?.withoutRating ?? false;
      if (!weightsOf.has(withoutRating)) {
        weightsOf.set(
          withoutRating,
          await gridWeights(transaction, input.branchId, subjectId, quarter.id, withoutRating),
        );
      }
    }
    const found: ReadonlyMap<string, StudentSubjectQuarter> = [...weightsOf.values()].every(
      (one) => one.quarterly === null,
    )
      ? new Map()
      : await subjectQuarterLessons(transaction, {
          branchId: input.branchId,
          timeZone: input.timeZone,
          now: input.now,
          academicYearId: quarter.academicYearId,
          subjectId,
          quarter,
          studentIds,
        });
    const decisions = await decisionsOf(transaction, quarter.id, subjectId, studentIds);
    for (const journal of own) {
      const withoutRating = switchesIn(journal, quarter.id)?.withoutRating ?? false;
      const weights = weightsOf.get(withoutRating);
      if (weights === undefined) continue;
      const ratingShown =
        switchesIn(journal, quarter.id)?.ratingExam === true &&
        weights.quarterly !== null &&
        weights.quarterly.ratingExam !== null;
      const outcomes = new Map<string, MemberOutcome>();
      for (const studentId of members.get(journal.id) ?? []) {
        const one = found.get(studentId);
        const stored = decisions.get(studentId);
        const given: StudentQuarterInput | null =
          weights.quarterly === null || one === undefined || one.heldInJournals === 0
            ? null
            : {
                weights: weights.quarterly,
                attendanceValues: {
                  lateValue: weights.lateValue,
                  skippedValue: weights.skippedValue,
                },
                lessons: one.lessons.map((lesson) => lesson.lesson),
                ratingExam: ratingShown ? one.ratingExam : null,
                quarterClosed: input.quarterClosed ?? false,
                heldInJournals: one.heldInJournals,
                countsFrom,
                leftSubjectOn: one.leftSubjectOn,
                atLeaving: one.atLeaving,
                decision: stored?.decision ?? null,
              };
        outcomes.set(studentId, {
          outcome: given === null ? null : studentQuarterOutcome(given),
          input: given,
          found: one,
          stored,
        });
      }
      answer.set(journal.id, { journal, weights, ratingShown, members: outcomes });
    }
  }
  return { journals: answer };
}

/** The decisions the module would apply to this result now (task 9.2a, decision 11). */
export function allowedDecisions(
  input: StudentQuarterInput,
): ('keep' | 'exempt' | 'not_assessed')[] {
  return (['keep', 'exempt', 'not_assessed'] as const).filter((decision) => {
    const tried = studentQuarterOutcome({ ...input, decision });
    return tried.flags.length > 0 && !tried.staleDecision;
  });
}
