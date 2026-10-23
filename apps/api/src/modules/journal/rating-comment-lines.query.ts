import type { CommentLine, RatingLine } from '@sodiq/shared';
import { classDisplayName } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';
import { cellLesson, lessonsOfCells, namedAccounts } from './cell-lines.query.js';
import { entryOf } from './rating.js';

/**
 * The lines of the rating entries' and the comments' histories (0120; task
 * 8.2, From 6.1c and decision 12) for the report of entries after a reset
 * and the student's personal data report, through the row filter of the
 * transaction, oldest first.
 */

export interface LineFilter {
  /** Only the lines of this branch (the reset report; the transaction may hold more). */
  readonly branchId?: string;
  /** The lines of this student. */
  readonly studentId?: string;
  /** The lines this account wrote between `from` (included) and `to` (excluded). */
  readonly writer?: { readonly accountId: string; readonly from: Date; readonly to: Date };
}

const branchNames = async (transaction: Transaction): Promise<Map<string, string>> =>
  new Map(
    (await transaction.selectFrom('branches').select(['id', 'name']).execute()).map((row) => [
      row.id,
      row.name,
    ]),
  );

/** The rating entry lines (not the lines of an exam's date or "not held"). */
export async function ratingLines(
  transaction: Transaction,
  filter: LineFilter,
): Promise<(RatingLine & { readonly branch: string })[]> {
  let query = transaction
    .selectFrom('journal_rating_history')
    .innerJoin('journals', 'journals.id', 'journal_rating_history.journal_id')
    .innerJoin('subjects', 'subjects.id', 'journals.subject_id')
    .innerJoin('quarters', 'quarters.id', 'journal_rating_history.quarter_id')
    .leftJoin('classes', 'classes.id', 'journals.class_id')
    .leftJoin('groups', 'groups.id', 'journals.group_id')
    .select([
      'journal_rating_history.id',
      'journal_rating_history.branch_id',
      'journal_rating_history.student_id',
      'journal_rating_history.kind_before',
      'journal_rating_history.kind_after',
      'journal_rating_history.score_before',
      'journal_rating_history.score_after',
      'journal_rating_history.reason',
      'journal_rating_history.changed_by',
      'journal_rating_history.changed_at',
      'subjects.name_uz',
      'subjects.name_ru',
      'subjects.name_en',
      'classes.grade',
      'classes.name as class_name',
      'groups.name as group_name',
      'quarters.number',
    ])
    .where('journal_rating_history.student_id', 'is not', null);
  if (filter.studentId !== undefined) {
    query = query.where('journal_rating_history.student_id', '=', filter.studentId);
  }
  if (filter.branchId !== undefined) {
    query = query.where('journal_rating_history.branch_id', '=', filter.branchId);
  }
  if (filter.writer !== undefined) {
    query = query
      .where('journal_rating_history.changed_by', '=', filter.writer.accountId)
      .where('journal_rating_history.changed_at', '>=', filter.writer.from)
      .where('journal_rating_history.changed_at', '<', filter.writer.to);
  }
  const rows = await query
    .orderBy('journal_rating_history.changed_at')
    .orderBy('journal_rating_history.id')
    .execute();
  const accounts = await namedAccounts(
    transaction,
    rows.map((row) => row.changed_by),
  );
  const branches = await branchNames(transaction);
  return rows.flatMap((row) =>
    row.student_id === null
      ? []
      : [
          {
            id: row.id,
            branch: branches.get(row.branch_id) ?? '',
            changedAt: row.changed_at.toISOString(),
            journal: {
              subject: { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
              taughtTo:
                row.class_name === null
                  ? (row.group_name ?? '')
                  : classDisplayName(row.grade ?? 0, row.class_name),
              quarter: row.number,
            },
            studentId: row.student_id,
            before: entryOf({ kind: row.kind_before, score: row.score_before }),
            after: entryOf({ kind: row.kind_after, score: row.score_after }),
            reason: row.reason,
            changedBy: accounts.get(row.changed_by) ?? {
              accountId: row.changed_by,
              login: null,
              name: null,
            },
          },
        ],
  );
}

/** The comment lines. */
export async function commentLines(
  transaction: Transaction,
  filter: LineFilter,
): Promise<(CommentLine & { readonly branch: string })[]> {
  let query = transaction
    .selectFrom('journal_comment_history')
    .select([
      'id',
      'branch_id',
      'student_id',
      'target',
      'lesson_id',
      'body_before',
      'body_after',
      'visibility_after',
      'changed_by',
      'changed_how',
      'changed_at',
    ]);
  if (filter.studentId !== undefined) query = query.where('student_id', '=', filter.studentId);
  if (filter.branchId !== undefined) query = query.where('branch_id', '=', filter.branchId);
  if (filter.writer !== undefined) {
    query = query
      .where('changed_by', '=', filter.writer.accountId)
      .where('changed_at', '>=', filter.writer.from)
      .where('changed_at', '<', filter.writer.to);
  }
  const rows = await query.orderBy('changed_at').orderBy('id').execute();
  const lessons = await lessonsOfCells(
    transaction,
    rows.flatMap((row) => (row.lesson_id === null ? [] : [row.lesson_id])),
  );
  const accounts = await namedAccounts(
    transaction,
    rows.map((row) => row.changed_by),
  );
  const branches = await branchNames(transaction);
  return rows.map((row) => ({
    id: row.id,
    branch: branches.get(row.branch_id) ?? '',
    changedAt: row.changed_at.toISOString(),
    target:
      row.target === 'work' || row.target === 'note' || row.target === 'rating'
        ? row.target
        : 'mark',
    lesson: row.lesson_id === null ? null : cellLesson(lessons.get(row.lesson_id)),
    studentId: row.student_id,
    bodyBefore: row.body_before,
    bodyAfter: row.body_after,
    visibility:
      row.visibility_after === null
        ? null
        : row.visibility_after === 'parents'
          ? 'parents'
          : 'staff',
    changedHow:
      row.changed_how === 'restored' || row.changed_how === 'forced_delete'
        ? row.changed_how
        : 'entry',
    changedBy: accounts.get(row.changed_by) ?? {
      accountId: row.changed_by,
      login: null,
      name: null,
    },
  }));
}

/** A line as the reset report holds it, without the branch. */
export function withoutBranchOf<T extends { readonly branch: string }>(line: T): Omit<T, 'branch'> {
  return Object.fromEntries(Object.entries(line).filter(([key]) => key !== 'branch')) as Omit<
    T,
    'branch'
  >;
}
