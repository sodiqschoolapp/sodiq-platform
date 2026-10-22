import type { Transaction } from '../../database/transactions.js';

export interface CellHistoryLine {
  version: number;
  /** The mark or the number before and after; `null` when empty. */
  before: number | null;
  after: number | null;
  changedBy: string;
  changedHow: string;
  changedAt: Date;
}

/**
 * The history of one cell (task 6.1a; 07, Editing rules and locks: "Every
 * cell keeps its history: old value, new value, who and when"), written by
 * the database (0108). Ordered by version: every line of one transaction has
 * the same moment.
 */
export async function cellHistory(
  transaction: Transaction,
  cellId: string,
): Promise<CellHistoryLine[]> {
  const lines = await transaction
    .selectFrom('journal_cell_history')
    .selectAll()
    .where('cell_id', '=', cellId)
    .orderBy('version')
    .execute();
  return lines.map((line) => ({
    version: line.version,
    before: line.work_id === null ? line.mark_before : line.score_before,
    after: line.work_id === null ? line.mark_after : line.score_after,
    changedBy: line.changed_by,
    changedHow: line.changed_how,
    changedAt: new Date(line.changed_at),
  }));
}
