import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

export interface CellHistoryLine {
  version: number;
  /** The mark or the number before and after; `null` when empty. */
  before: number | null;
  after: number | null;
  /** `null` for a line the platform wrote: the homework move of 25 November 2026 (0186). */
  changedBy: string | null;
  changedHow: string;
  changedAt: Date;
}

/**
 * The history of one cell (task 6.1a; 07, Editing rules and locks: "Every
 * cell keeps its history: old value, new value, who and when"), written by
 * the database (0108). Ordered by version: every line of one transaction has
 * the same moment. A line of the homework move (0186, task 11.24) keeps the
 * cell's version and comes after the line that wrote it.
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
    .orderBy(sql`changed_how = 'homework_move'`)
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
