import { cellChangeSchema, type AccountNamed, type CellChange, type CellLine } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/**
 * What the reports over the cells (task 6.1c, pull request #209) read about
 * the lessons and the writers of cells and history lines. Every read goes
 * through the row filter of the transaction: a lesson of a branch the
 * transaction does not hold, or one a forced delete removed, is `null`.
 */

export type CellLesson = NonNullable<CellLine['lesson']>;

export interface LessonOfCell extends CellLesson {
  branch: string;
}

/** The lessons by id: date, start, subject, class or group, cancel and branch. */
export async function lessonsOfCells(
  transaction: Transaction,
  lessonIds: readonly string[],
): Promise<Map<string, LessonOfCell>> {
  const ids = [...new Set(lessonIds)];
  if (ids.length === 0) return new Map();
  const rows = await transaction
    .selectFrom('lessons')
    .innerJoin('subjects', 'subjects.id', 'lessons.subject_id')
    .innerJoin('branches', 'branches.id', 'lessons.branch_id')
    .leftJoin('classes', 'classes.id', 'lessons.class_id')
    .leftJoin('groups', 'groups.id', 'lessons.group_id')
    .select([
      'lessons.id',
      'lessons.lesson_date',
      'lessons.starts_at',
      'lessons.cancel_cause',
      'subjects.name_uz',
      'subjects.name_ru',
      'subjects.name_en',
      'branches.name as branch',
      'classes.grade',
      'classes.name as class_name',
      'groups.name as group_name',
    ])
    .where('lessons.id', 'in', ids)
    .execute();
  return new Map(
    rows.map((row) => [
      row.id,
      {
        date: row.lesson_date,
        startsAt: row.starts_at.toISOString(),
        subject: { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
        taughtTo:
          row.class_name === null ? (row.group_name ?? '') : `${row.grade ?? ''} ${row.class_name}`,
        cancelled: row.cancel_cause !== null,
        branch: row.branch,
      },
    ]),
  );
}

/** The lesson of a cell or line as the answer holds it, without the branch. */
export function cellLesson(lesson: LessonOfCell | undefined): CellLesson | null {
  if (lesson === undefined) return null;
  return {
    date: lesson.date,
    startsAt: lesson.startsAt,
    subject: lesson.subject,
    taughtTo: lesson.taughtTo,
    cancelled: lesson.cancelled,
  };
}

/** The kinds of the works by id. */
export async function workKinds(
  transaction: Transaction,
  workIds: readonly (string | null)[],
): Promise<Map<string, { kind: 'classwork' | 'homework'; total: number | null }>> {
  const ids = [...new Set(workIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const rows = await transaction
    .selectFrom('journal_works')
    .select(['id', 'kind', 'total'])
    .where('id', 'in', ids)
    .execute();
  return new Map(
    rows.map((row) => [
      row.id,
      { kind: row.kind === 'homework' ? 'homework' : 'classwork', total: row.total },
    ]),
  );
}

/**
 * Accounts named by their login and their person's name (decision 11; the
 * names through `audit_names`, as the audit screen names actors, 2.6a
 * decision 12, correction 1 of #209).
 */
export async function namedAccounts(
  transaction: Transaction,
  accountIds: readonly (string | null)[],
): Promise<Map<string, AccountNamed>> {
  const ids = [...new Set(accountIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const logins = await transaction
    .selectFrom('accounts')
    .select(['id', 'login'])
    .where('id', 'in', ids)
    .execute();
  const names = await sql<{ id: string; first_name: string | null; last_name: string | null }>`
    select id, first_name, last_name from audit_names(${ids}::uuid[])
  `.execute(transaction);
  const loginOf = new Map(logins.map((row) => [row.id, row.login]));
  const nameOf = new Map(
    names.rows.map((row) => [row.id, [row.last_name, row.first_name].filter(Boolean).join(' ')]),
  );
  return new Map(
    ids.map((id) => [
      id,
      { accountId: id, login: loginOf.get(id) ?? null, name: nameOf.get(id) ?? null },
    ]),
  );
}

/** A stored `changed_how`, as the shared list names it. */
export const cellChange = (value: string): CellChange => cellChangeSchema.parse(value);

/** The value of a line before or after: the mark of an attendance cell, the number of a work's. */
export function lineValues(row: {
  work_id: string | null;
  mark_before: number | null;
  mark_after: number | null;
  score_before: number | null;
  score_after: number | null;
}): { before: number | null; after: number | null } {
  return row.work_id === null
    ? { before: row.mark_before, after: row.mark_after }
    : { before: row.score_before, after: row.score_after };
}
