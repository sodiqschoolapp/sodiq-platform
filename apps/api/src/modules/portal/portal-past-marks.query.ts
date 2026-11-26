import { shownPercent } from '@sodiq/calc';
import type { Names } from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';

/**
 * The portal's one reader of past marks from before go-live (task 11.26; `10`, Past marks from
 * before go-live, What parents see; `edge/developer-rules`, Past marks: "The portal's Grades,
 * Attendance and Homework reads and the personal data report are their only readers"). Only the
 * rows of uploads that stand; a withdrawn upload's rows are never read here.
 */

/** A subject as the portal names it. */
export interface PastSubject {
  readonly id: string;
  readonly names: Names;
  readonly colour: string;
}

export interface PastAttendanceRow {
  readonly date: string;
  readonly lessonNumber: number;
  readonly subject: PastSubject;
  readonly mark: number;
}

export interface PastWorkRow {
  readonly date: string;
  readonly lessonNumber: number;
  readonly subject: PastSubject;
  readonly kind: 'classwork' | 'homework';
  readonly position: number;
  readonly title: string;
  readonly score: number;
  readonly total: number;
  /** The percent of the score as the portal shows any score: `packages/calc` (`shownPercent`), as the staff reader. */
  readonly percent: number;
}

/**
 * The branches holding the standing past marks of a child in the account's scope at the moment
 * of the transaction (`portal_past_mark_branches`, 0190, the child scope inside; plan decision 1,
 * Look first). Run in a transaction without a branch, after the child scope check.
 */
export async function pastMarkBranches(
  transaction: Transaction,
  accountId: string,
  studentId: string,
): Promise<string[]> {
  const at = await transactionMoment(transaction);
  const found = await sql<{ branch_id: string }>`
    select b as branch_id from portal_past_mark_branches(${accountId}::uuid, ${studentId}::uuid, ${at}) b
  `.execute(transaction);
  return found.rows.map((row) => row.branch_id);
}

const dayOf = (value: string | Date): string =>
  typeof value === 'string' ? value : value.toISOString().slice(0, 10);

/** The standing attendance marks of the child from `from` to `to`, both included. */
export async function pastAttendanceOf(
  transaction: Transaction,
  studentId: string,
  from: string,
  to: string,
): Promise<PastAttendanceRow[]> {
  const rows = await transaction
    .selectFrom('past_attendance')
    .innerJoin('subjects', 'subjects.id', 'past_attendance.subject_id')
    .select([
      'past_attendance.school_date',
      'past_attendance.lesson_number',
      'past_attendance.mark',
      'subjects.id as subject_id',
      'subjects.name_uz',
      'subjects.name_ru',
      'subjects.name_en',
      'subjects.colour',
    ])
    .where('past_attendance.student_id', '=', studentId)
    .where('past_attendance.withdrawn_at', 'is', null)
    .where('past_attendance.school_date', '>=', from)
    .where('past_attendance.school_date', '<=', to)
    .execute();
  return rows.map((row) => ({
    date: dayOf(row.school_date),
    lessonNumber: row.lesson_number,
    subject: {
      id: row.subject_id,
      names: { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
      colour: row.colour,
    },
    mark: row.mark,
  }));
}

/** The standing works of the child from `from` to `to`, both included, of the kinds given. */
export async function pastWorksOf(
  transaction: Transaction,
  studentId: string,
  from: string,
  to: string,
  kinds: readonly ('classwork' | 'homework')[],
): Promise<PastWorkRow[]> {
  const rows = await transaction
    .selectFrom('past_works')
    .innerJoin('subjects', 'subjects.id', 'past_works.subject_id')
    .select([
      'past_works.school_date',
      'past_works.lesson_number',
      'past_works.kind',
      'past_works.position',
      'past_works.title',
      'past_works.score',
      'past_works.total',
      'subjects.id as subject_id',
      'subjects.name_uz',
      'subjects.name_ru',
      'subjects.name_en',
      'subjects.colour',
    ])
    .where('past_works.student_id', '=', studentId)
    .where('past_works.withdrawn_at', 'is', null)
    .where('past_works.school_date', '>=', from)
    .where('past_works.school_date', '<=', to)
    .where('past_works.kind', 'in', [...kinds])
    .execute();
  return rows.map((row) => {
    const score = Number(row.score);
    const total = Number(row.total);
    return {
      date: dayOf(row.school_date),
      lessonNumber: row.lesson_number,
      subject: {
        id: row.subject_id,
        names: { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
        colour: row.colour,
      },
      kind: row.kind === 'homework' ? 'homework' : 'classwork',
      position: row.position,
      title: row.title,
      score,
      total,
      percent: Number(shownPercent(score, total)),
    };
  });
}
