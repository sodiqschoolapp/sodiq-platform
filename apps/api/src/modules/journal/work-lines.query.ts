import { workChangeSchema, type WorkLine } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';
import {
  cellLesson,
  lessonsOfCells,
  namedAccounts,
  type LessonOfCell,
} from './cell-lines.query.js';

/**
 * The lines of the works' history (0119; task 8.1: "the total kept beside
 * the number in the cell history", From 6.1a, 6.1c and 6.3 decision 16),
 * through the row filter of the transaction, newest last.
 */

export interface WorkLineWithBranch extends WorkLine {
  readonly branch: string;
}

export interface WorkLineFilter {
  /** Only the lines of this branch (the reset report; the transaction may hold more). */
  readonly branchId?: string;
  /** The lines of these works. */
  readonly workIds?: readonly string[];
  /** The lines this account wrote between `from` (included) and `to` (excluded). */
  readonly writer?: { readonly accountId: string; readonly from: Date; readonly to: Date };
  readonly limit?: number;
}

export async function workLines(
  transaction: Transaction,
  filter: WorkLineFilter,
): Promise<WorkLineWithBranch[]> {
  if (filter.workIds !== undefined && filter.workIds.length === 0) return [];
  let query = transaction
    .selectFrom('journal_work_history')
    .select([
      'id',
      'branch_id',
      'work_id',
      'lesson_id',
      'kind',
      'total_before',
      'total_after',
      'not_held_before',
      'not_held_after',
      'changed_by',
      'changed_how',
      'changed_at',
    ]);
  if (filter.workIds !== undefined) query = query.where('work_id', 'in', [...filter.workIds]);
  if (filter.branchId !== undefined) query = query.where('branch_id', '=', filter.branchId);
  if (filter.writer !== undefined) {
    query = query
      .where('changed_by', '=', filter.writer.accountId)
      .where('changed_at', '>=', filter.writer.from)
      .where('changed_at', '<', filter.writer.to);
  }
  query = query.orderBy('changed_at').orderBy('id');
  if (filter.limit !== undefined) query = query.limit(filter.limit);
  const rows = await query.execute();
  const lessons: Map<string, LessonOfCell> = await lessonsOfCells(
    transaction,
    rows.map((row) => row.lesson_id),
  );
  const accounts = await namedAccounts(
    transaction,
    rows.map((row) => row.changed_by),
  );
  const branches = new Map(
    (await transaction.selectFrom('branches').select(['id', 'name']).execute()).map((row) => [
      row.id,
      row.name,
    ]),
  );
  return rows.map((row) => ({
    id: row.id,
    branch: branches.get(row.branch_id) ?? '',
    workId: row.work_id,
    workKind: row.kind === 'homework' ? 'homework' : 'classwork',
    changedAt: new Date(row.changed_at).toISOString(),
    lesson: cellLesson(lessons.get(row.lesson_id)),
    totalBefore: row.total_before,
    totalAfter: row.total_after,
    notHeldBefore: row.not_held_before,
    notHeldAfter: row.not_held_after,
    changedHow: workChangeSchema.parse(row.changed_how),
    changedBy:
      row.changed_by === null
        ? null
        : (accounts.get(row.changed_by) ?? { accountId: row.changed_by, login: null, name: null }),
  }));
}

/** A line as the answers hold it, without the branch. */
export function withoutBranch(line: WorkLineWithBranch): WorkLine {
  return {
    id: line.id,
    workId: line.workId,
    workKind: line.workKind,
    changedAt: line.changedAt,
    lesson: line.lesson,
    totalBefore: line.totalBefore,
    totalAfter: line.totalAfter,
    notHeldBefore: line.notHeldBefore,
    notHeldAfter: line.notHeldAfter,
    changedHow: line.changedHow,
    changedBy: line.changedBy,
  };
}
