import { PERSONAL_DATA_ENTRY_LIMIT, type StudentReport } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';
import {
  cellChange,
  cellLesson,
  lessonsOfCells,
  lineValues,
  namedAccounts,
  workKinds,
} from './cell-lines.query.js';

/**
 * The student's marks and attendance for the personal data report (task 6.1c,
 * pull request #209, decision 10; edge-cases/people-roles-accounts, Personal
 * data and the audit log: "a copy of everything held about their child"):
 * every cell of the student with a value, by lesson start then cell id, and
 * the history lines of the student's cells, newest first (`changed_at desc,
 * id desc`), at most `PERSONAL_DATA_ENTRY_LIMIT` with the count and the
 * oldest moment of the rest. The transaction holds every branch, so the cells
 * of a branch the student left are in it. The marks of a forced-delete store
 * row are not cells; the forced delete wrote a history line for each, so
 * their values are in `history` already.
 */
export async function studentJournal(
  transaction: Transaction,
  studentId: string,
): Promise<StudentReport['journal']> {
  const cells = await transaction
    .selectFrom('journal_cells')
    .innerJoin('lessons', 'lessons.id', 'journal_cells.lesson_id')
    .select([
      'journal_cells.id',
      'journal_cells.lesson_id',
      'journal_cells.work_id',
      'journal_cells.mark',
      'journal_cells.score',
      'journal_cells.version',
      'journal_cells.changed_at',
      'journal_cells.changed_how',
      'journal_cells.changed_by',
    ])
    .where('journal_cells.student_id', '=', studentId)
    .where((eb) =>
      eb.or([eb('journal_cells.mark', 'is not', null), eb('journal_cells.score', 'is not', null)]),
    )
    .orderBy('lessons.starts_at')
    .orderBy('journal_cells.id')
    .execute();
  const lines = await transaction
    .selectFrom('journal_cell_history')
    .select([
      'id',
      'branch_id',
      'lesson_id',
      'work_id',
      'mark_before',
      'mark_after',
      'score_before',
      'score_after',
      'changed_by',
      'changed_how',
      'changed_at',
    ])
    .where('student_id', '=', studentId)
    .orderBy('changed_at', 'desc')
    .orderBy('id', 'desc')
    .limit(PERSONAL_DATA_ENTRY_LIMIT)
    .execute();
  const rest = await transaction
    .selectFrom('journal_cell_history')
    .select((eb) => [eb.fn.countAll<string>().as('total'), eb.fn.min('changed_at').as('oldest')])
    .where('student_id', '=', studentId)
    .executeTakeFirstOrThrow();
  const lessons = await lessonsOfCells(transaction, [
    ...cells.map((cell) => cell.lesson_id),
    ...lines.map((line) => line.lesson_id),
  ]);
  const works = await workKinds(transaction, [
    ...cells.map((cell) => cell.work_id),
    ...lines.map((line) => line.work_id),
  ]);
  const accounts = await namedAccounts(transaction, [
    ...cells.map((cell) => cell.changed_by),
    ...lines.map((line) => line.changed_by),
  ]);
  const named = (id: string) => accounts.get(id) ?? { accountId: id, login: null, name: null };
  const branchNames = new Map(
    (await transaction.selectFrom('branches').select(['id', 'name']).execute()).map((row) => [
      row.id,
      row.name,
    ]),
  );
  const leftOut = Number(rest.total) - lines.length;
  return {
    cells: cells.map((cell) => {
      const lesson = lessons.get(cell.lesson_id);
      const work = cell.work_id === null ? undefined : works.get(cell.work_id);
      return {
        id: cell.id,
        branch: lesson?.branch ?? '',
        lesson: cellLesson(lesson),
        attendance: cell.work_id === null,
        workKind: work?.kind ?? null,
        total: work?.total ?? null,
        // A cell with no value is left out by the query above.
        value: (cell.work_id === null ? cell.mark : cell.score) ?? 0,
        version: cell.version,
        changedAt: cell.changed_at.toISOString(),
        changedHow: cellChange(cell.changed_how),
        changedBy: named(cell.changed_by),
      };
    }),
    history: lines.map((line) => ({
      id: line.id,
      branch: branchNames.get(line.branch_id) ?? '',
      changedAt: line.changed_at.toISOString(),
      lesson: cellLesson(lessons.get(line.lesson_id)),
      attendance: line.work_id === null,
      workKind: line.work_id === null ? null : (works.get(line.work_id)?.kind ?? null),
      ...lineValues(line),
      changedHow: cellChange(line.changed_how),
      changedBy: named(line.changed_by),
    })),
    historyLeftOut:
      leftOut > 0 && rest.oldest !== null
        ? { count: leftOut, oldestAt: new Date(rest.oldest).toISOString() }
        : null,
  };
}
