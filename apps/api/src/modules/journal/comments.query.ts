import type { CommentVisibility, JournalComment, JournalShape } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';
import { namedAccounts } from './cell-lines.query.js';

/**
 * The reads of the journal's comments (task 8.2, pull request #218) that the
 * grid and the comment routes share.
 */

export const COMMENT_COLUMNS = [
  'id',
  'target',
  'student_id',
  'lesson_id',
  'work_id',
  'body',
  'visibility',
  'version',
  'changed_by',
  'changed_at',
] as const;

export interface CommentRow {
  readonly id: string;
  readonly target: string;
  readonly student_id: string;
  readonly lesson_id: string | null;
  readonly work_id: string | null;
  readonly body: string | null;
  readonly visibility: string;
  readonly version: number;
  readonly changed_by: string;
  readonly changed_at: Date;
}

const targetOf = (value: string): JournalComment['target'] =>
  value === 'work' || value === 'note' || value === 'rating' ? value : 'mark';

export const visibilityOf = (value: string | null): CommentVisibility | null =>
  value === null ? null : value === 'parents' ? 'parents' : 'staff';

/** The comments as the grid and the routes answer them, with the names of their authors. */
export async function commentsAnswer(
  transaction: Transaction,
  rows: readonly CommentRow[],
): Promise<JournalComment[]> {
  const names = await namedAccounts(
    transaction,
    rows.map((row) => row.changed_by),
  );
  return rows.map((row) => {
    const named = names.get(row.changed_by);
    return {
      id: row.id,
      target: targetOf(row.target),
      studentId: row.student_id,
      lessonId: row.lesson_id,
      workId: row.work_id,
      body: row.body,
      visibility: visibilityOf(row.visibility) ?? 'staff',
      version: row.version,
      changedBy: named?.name ?? named?.login ?? null,
      changedAt: row.changed_at.toISOString(),
    };
  });
}

/**
 * The comments with a body of the students and lessons shown, and of the
 * quarter's rating exam row, that a reader of `shape` may read (decision 10):
 * the comments of attendance marks only for a reader who sees attendance.
 */
export async function gridComments(
  transaction: Transaction,
  input: {
    readonly studentIds: readonly string[];
    readonly lessonIds: readonly string[];
    readonly ratingExamId: string | null;
    readonly shape: JournalShape;
  },
): Promise<JournalComment[]> {
  if (input.studentIds.length === 0) return [];
  const rows = await transaction
    .selectFrom('journal_comments')
    .select(COMMENT_COLUMNS)
    .where('student_id', 'in', input.studentIds)
    .where('body', 'is not', null)
    .where((where) => {
      const lessons =
        input.lessonIds.length === 0 ? where.val(false) : where('lesson_id', 'in', input.lessonIds);
      const rating =
        input.ratingExamId === null || input.shape !== 'whole'
          ? where.val(false)
          : where('rating_exam_id', '=', input.ratingExamId);
      return where.or([lessons, rating]);
    })
    .orderBy('student_id')
    .orderBy('id')
    .execute();
  return commentsAnswer(
    transaction,
    rows.filter((row) => input.shape !== 'attendance' || row.target === 'mark'),
  );
}
