import type { Transaction } from '../../database/transactions.js';
import type { SavedCell } from './cells.js';

/**
 * What a keyed cell save stores as its answer (task 8.3a; `request-keys.ts`:
 * "ids and status only, never personal data"): the cells it wrote, by id and
 * version, never a mark or a number.
 */
// A type, not an interface: it is stored as JSON (`JsonValue`).
export type StoredCell = { id: string; version: number };

export const storedCells = (cells: readonly SavedCell[]): StoredCell[] =>
  cells.map((cell) => ({ id: cell.id, version: cell.version }));

/**
 * The cells of a stored answer as they were saved: the value of each comes
 * from the history line of its version (0108), so a repeat of the request
 * answers what the first one did, also after a later change of the cell.
 */
export async function cellsAsSaved(
  transaction: Transaction,
  cells: readonly StoredCell[],
): Promise<Omit<SavedCell, 'changedAt'>[]> {
  if (cells.length === 0) return [];
  const lines = await transaction
    .selectFrom('journal_cell_history')
    .select([
      'cell_id',
      'version',
      'lesson_id',
      'student_id',
      'work_id',
      'mark_after',
      'score_after',
    ])
    .where(
      'cell_id',
      'in',
      cells.map((cell) => cell.id),
    )
    .orderBy('changed_at')
    .execute();
  const lineOf = new Map(lines.map((line) => [`${line.cell_id}/${String(line.version)}`, line]));
  return cells.flatMap((cell) => {
    const line = lineOf.get(`${cell.id}/${String(cell.version)}`);
    return line === undefined
      ? []
      : [
          {
            id: cell.id,
            lessonId: line.lesson_id,
            studentId: line.student_id,
            workId: line.work_id,
            value: line.work_id === null ? line.mark_after : line.score_after,
            version: cell.version,
          },
        ];
  });
}
