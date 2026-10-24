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

/**
 * The optional cells open now (task 8.6, decision 10; `edge/students-classes-groups`,
 * a week late: "cells of lessons already held open as optional ... can be filled for
 * 7 days"): a live row of `journal_optional_cells` (0127), not withdrawn, opened and
 * before its `open_until`, compared with the transaction's moment as the cells guard
 * does (`journal_optional_open`). By `lessonId|studentId`, the moment it closes.
 */
export async function optionalCellsOf(
  transaction: Transaction,
  lessonIds: readonly string[],
  now: Date,
): Promise<Map<string, Date>> {
  const found = new Map<string, Date>();
  if (lessonIds.length === 0) return found;
  const rows = await transaction
    .selectFrom('journal_optional_cells')
    .select(['lesson_id', 'student_id', 'open_until'])
    .where('lesson_id', 'in', [...lessonIds])
    .where('withdrawn_at', 'is', null)
    .where('opened_at', '<=', now)
    .where('open_until', '>', now)
    .execute();
  for (const row of rows) {
    const key = `${row.lesson_id}|${row.student_id}`;
    const before = found.get(key);
    if (before === undefined || before.getTime() < row.open_until.getTime()) {
      found.set(key, row.open_until);
    }
  }
  return found;
}

/**
 * The cells reopened after an exemption that are open now (task 8.7; `edge/journal`: "Those
 * cells open for 3 days, for those cells only"; `exemption_reopened_open`, 0123), by
 * `lessonId|studentId`.
 */
export async function reopenedCellsOf(
  transaction: Transaction,
  lessonIds: readonly string[],
  now: Date,
): Promise<Set<string>> {
  if (lessonIds.length === 0) return new Set();
  const rows = await transaction
    .selectFrom('exemption_reopened_cells')
    .select(['lesson_id', 'student_id'])
    .where('lesson_id', 'in', [...lessonIds])
    .where('reopened_at', '<=', now)
    .where('open_until', '>', now)
    .execute();
  return new Set(rows.map((row) => `${row.lesson_id}|${row.student_id}`));
}

/**
 * The marker a cell shows: a correction stays shown; else an optional cell open now
 * shows "Optional until <date>" (a value typed there is a late entry with no unlock);
 * else the stored value's marker.
 */
export function shownMarker(
  stored: CellMarker | undefined,
  optionalUntil: Date | undefined,
): CellMarker {
  if (stored?.kind === 'correction') return stored;
  if (optionalUntil !== undefined) return { kind: 'optional', until: optionalUntil.toISOString() };
  return stored ?? null;
}
