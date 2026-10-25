import { storedQuarterOutcome, type StudentQuarterOutcome } from '@sodiq/calc';
import type { ClosingOutcome } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';
import type { RecordInForce, Reopening } from '../setup/closed-quarters.js';

/**
 * The versions of a quarter's final results (task 9.2c, pull request #231; `edge/journal`,
 * Closing and reopening: "The earlier final results are kept as a version. Closing again lists
 * every result that changed"). Nothing is calculated here: the outcomes come from `packages/calc`,
 * read back from the stored records with `storedQuarterOutcome`.
 */

/** A result as it is shown: its kind, its rounded number and grade, the decision (decision 8). */
export function outcomeShown(outcome: StudentQuarterOutcome): ClosingOutcome {
  switch (outcome.kind) {
    case 'number':
      return {
        kind: 'number',
        // A shown result is a whole number from 0 to 100: no arithmetic is done on it here.
        shown: Number(outcome.result.shown),
        grade: outcome.result.grade,
        decision: outcome.decision,
      };
    case 'exempt':
      return {
        kind: 'exempt',
        shown: null,
        grade: null,
        decision: outcome.cause === 'decided' ? 'exempt' : null,
      };
    case 'not_assessed':
      return { kind: 'not_assessed', shown: null, grade: null, decision: 'not_assessed' };
    case 'no_result':
      return { kind: 'no_result', shown: null, grade: null, decision: null };
  }
}

/** The shown outcome of a stored record. */
export function storedShown(record: unknown): ClosingOutcome {
  return outcomeShown(storedQuarterOutcome(record));
}

export function sameShown(a: ClosingOutcome, b: ClosingOutcome): boolean {
  return (
    a.kind === b.kind && a.shown === b.shown && a.grade === b.grade && a.decision === b.decision
  );
}

/**
 * The records in force before a reopening, by `<subject>|<student>` (decision 8): for a
 * whole-branch reopening, those of the versions it took out of force (their `reopened_at` is its
 * moment), the highest version holding one; for a journal's reopening, the records in force now
 * (its versions stay in force until the re-close).
 */
export async function recordsBefore(
  transaction: Transaction,
  quarterId: string,
  reopening: Reopening,
): Promise<Map<string, RecordInForce>> {
  const rows = await transaction
    .selectFrom('quarter_final_results as r')
    .innerJoin('quarter_closings as c', 'c.id', 'r.closing_id')
    .select([
      'r.closing_id',
      'c.version',
      'c.closed_at',
      'r.subject_id',
      'r.student_id',
      'r.journal_id',
      'r.kind',
      'r.record',
    ])
    .where('r.quarter_id', '=', quarterId)
    .where((where) =>
      reopening.journal_id === null
        ? where('c.reopened_at', '=', reopening.reopened_at)
        : where('c.reopened_at', 'is', null),
    )
    .orderBy('c.version')
    .execute();
  const found = new Map<string, RecordInForce>();
  for (const row of rows) {
    found.set(`${row.subject_id}|${row.student_id}`, {
      closingId: row.closing_id,
      version: row.version,
      closedAt: row.closed_at,
      subjectId: row.subject_id,
      studentId: row.student_id,
      journalId: row.journal_id,
      kind: row.kind,
      record: row.record as unknown,
    });
  }
  return found;
}

/** A result now, to compare with the record before. */
export interface ResultNow {
  readonly subjectId: string;
  readonly studentId: string;
  readonly journalId: string;
  readonly shown: ClosingOutcome;
}

/** A result that changed: `before` null for a result with no record before. */
export interface RawChange {
  readonly subjectId: string;
  readonly studentId: string;
  readonly journalId: string;
  readonly before: ClosingOutcome | null;
  readonly after: ClosingOutcome;
}

/** The results now whose shown outcome differs from the record before, in the order given. */
export function changesAgainst(
  before: ReadonlyMap<string, RecordInForce>,
  now: readonly ResultNow[],
): RawChange[] {
  const changes: RawChange[] = [];
  for (const one of now) {
    const earlier = before.get(`${one.subjectId}|${one.studentId}`);
    const shown = earlier === undefined ? null : storedShown(earlier.record);
    if (shown !== null && sameShown(shown, one.shown)) continue;
    changes.push({
      subjectId: one.subjectId,
      studentId: one.studentId,
      journalId: one.journalId,
      before: shown,
      after: one.shown,
    });
  }
  return changes;
}
