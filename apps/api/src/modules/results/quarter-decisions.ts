import type { FlagDecision } from '@sodiq/calc';
import type { Transaction } from '../../database/transactions.js';

/**
 * The Academic Vice Principal's decisions on flagged results (task 9.2a, pull
 * request #229, decision 1, Look first; `quarter_result_decisions`, 0132):
 * one per student, subject and quarter, passed as the `decision` of
 * `studentQuarterOutcome` by every reader of a quarter result (the grid and
 * its files, the student results, the grade preview, the checklist), so that
 * one figure is shown everywhere. A cleared decision is stored as `null`.
 */

export interface StoredDecision {
  readonly id: string;
  readonly decision: FlagDecision | null;
  readonly version: number;
}

const asDecision = (value: string | null): FlagDecision | null =>
  value === 'keep' || value === 'exempt' || value === 'not_assessed' ? value : null;

/** The stored decisions of a quarter and subject, by student. */
export async function decisionsOf(
  transaction: Transaction,
  quarterId: string,
  subjectId: string,
  studentIds: readonly string[],
): Promise<Map<string, StoredDecision>> {
  if (studentIds.length === 0) return new Map();
  const rows = await transaction
    .selectFrom('quarter_result_decisions')
    .select(['id', 'student_id', 'decision', 'version'])
    .where('quarter_id', '=', quarterId)
    .where('subject_id', '=', subjectId)
    .where('student_id', 'in', studentIds)
    .execute();
  return new Map(
    rows.map((row) => [
      row.student_id,
      { id: row.id, decision: asDecision(row.decision), version: row.version },
    ]),
  );
}

/** The stored decision of one student, or `null`. */
export async function decisionOf(
  transaction: Transaction,
  quarterId: string,
  subjectId: string,
  studentId: string,
): Promise<FlagDecision | null> {
  return (
    (await decisionsOf(transaction, quarterId, subjectId, [studentId])).get(studentId)?.decision ??
    null
  );
}
