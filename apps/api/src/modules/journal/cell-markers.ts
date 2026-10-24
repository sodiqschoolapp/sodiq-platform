import type { CellMarker } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';
import { namedAccounts } from './cell-lines.query.js';

/**
 * The marker of a stored value (task 8.4; `edge/journal`: "Entries made under
 * it are marked 'entered after the edit period' with the approver's name";
 * a correction "leaves a marker in the cell"): from its `changed_how`, the
 * approver read through the unlock of its newest history line, the corrector
 * as its author.
 */
export interface MarkedRow {
  readonly id: string;
  readonly version: number;
  readonly changedHow: string;
  readonly changedBy: string;
}

export async function markersOf(
  transaction: Transaction,
  table: 'journal_cell_history' | 'journal_rating_history',
  rows: readonly MarkedRow[],
): Promise<Map<string, CellMarker>> {
  const marked = rows.filter(
    (row) => row.changedHow === 'late_entry' || row.changedHow === 'correction',
  );
  if (marked.length === 0) return new Map();
  const late = marked.filter((row) => row.changedHow === 'late_entry');
  const unlockOf = new Map<string, string>();
  if (late.length > 0) {
    const lines =
      table === 'journal_cell_history'
        ? await transaction
            .selectFrom('journal_cell_history')
            .select(['cell_id as id', 'version', 'unlock_id'])
            .where(
              'cell_id',
              'in',
              late.map((row) => row.id),
            )
            .where('unlock_id', 'is not', null)
            .execute()
        : await transaction
            .selectFrom('journal_rating_history')
            .select(['entry_id as id', 'version', 'unlock_id'])
            .where(
              'entry_id',
              'in',
              late.map((row) => row.id),
            )
            .where('unlock_id', 'is not', null)
            .execute();
    const versionOf = new Map(late.map((row) => [row.id, row.version]));
    for (const line of lines) {
      if (line.id !== null && line.unlock_id !== null && versionOf.get(line.id) === line.version) {
        unlockOf.set(line.id, line.unlock_id);
      }
    }
  }
  const unlocks =
    unlockOf.size === 0
      ? []
      : await transaction
          .selectFrom('journal_unlocks')
          .select(['id', 'decided_by'])
          .where('id', 'in', [...new Set(unlockOf.values())])
          .execute();
  const approverOf = new Map(unlocks.map((one) => [one.id, one.decided_by]));
  const names = await namedAccounts(transaction, [
    ...marked.filter((row) => row.changedHow === 'correction').map((row) => row.changedBy),
    ...unlocks.flatMap((one) => (one.decided_by === null ? [] : [one.decided_by])),
  ]);
  const nameOf = (account: string | null | undefined): string | null => {
    if (account === null || account === undefined) return null;
    const found = names.get(account);
    return found?.name ?? found?.login ?? null;
  };
  return new Map(
    marked.map((row) => [
      row.id,
      row.changedHow === 'correction'
        ? { kind: 'correction' as const, by: nameOf(row.changedBy) }
        : { kind: 'late' as const, by: nameOf(approverOf.get(unlockOf.get(row.id) ?? '')) },
    ]),
  );
}
