import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';

/**
 * Until 5.6c-3 (task 5.6c-1, decision 5; `.claude/rules/timetable.md`, a task
 * that first writes rows): a publish or a withdraw that would create, remove
 * or change a lesson on the date of a standing exam is refused
 * `publish_over_exam`, one detail per exam. Without it, the write would
 * create lessons under the exam (refused by its class claims) or remove a
 * block an out row names (a foreign key, a 500). 5.6c-3 replaces it with the
 * sorting of the kept exam (`edge/timetable`, Exams: "An exam is stored on its
 * own like a one-day change and kept after a later publish").
 */

interface ExamDay {
  readonly exams: readonly { readonly id: string; readonly title: string }[];
  readonly lessons: string;
}

/** The standing exams of a range with the lessons of their dates, before a write. */
export async function examDaysBefore(
  transaction: Transaction,
  branchId: string,
  firstDate: string,
  lastDate: string,
): Promise<Map<string, ExamDay>> {
  const exams = await transaction
    .selectFrom('exams')
    .select(['id', 'title', sql<string>`exam_date::text`.as('date')])
    .where('branch_id', '=', branchId)
    .where('exam_date', '>=', firstDate)
    .where('exam_date', '<=', lastDate)
    .where('cancel_cause', 'is', null)
    .orderBy('exam_date')
    .orderBy('id')
    .execute();
  const days = new Map<string, ExamDay>();
  for (const date of [...new Set(exams.map((one) => one.date))]) {
    days.set(date, {
      exams: exams
        .filter((one) => one.date === date)
        .map((one) => ({ id: one.id, title: one.title })),
      lessons: await lessonsOn(transaction, branchId, date),
    });
  }
  return days;
}

/** Refuses the write when a lesson of an exam's date differs from before it. */
export async function refuseOverExams(
  transaction: Transaction,
  branchId: string,
  before: ReadonlyMap<string, ExamDay>,
): Promise<void> {
  const refused: { id: string; title: string; date: string }[] = [];
  for (const [date, day] of before) {
    if ((await lessonsOn(transaction, branchId, date)) === day.lessons) continue;
    refused.push(...day.exams.map((one) => ({ ...one, date })));
  }
  if (refused.length === 0) return;
  throw new ApiException(
    'publish_over_exam',
    409,
    undefined,
    refused.map((one) => ({
      path: 'exams',
      code: 'publish_over_exam',
      message: one.title,
      recordId: one.id,
      day: one.date,
    })),
  );
}

/** The lessons of a date as one text: what the guard compares. */
async function lessonsOn(
  transaction: Transaction,
  branchId: string,
  date: string,
): Promise<string> {
  const rows = await transaction
    .selectFrom('lessons')
    .select(['id', 'starts_at', 'ends_at', 'teacher_id', 'room_id', 'cancel_cause'])
    .where('branch_id', '=', branchId)
    .where('lesson_date', '=', date)
    .orderBy('id')
    .execute();
  return rows
    .map((one) =>
      [
        one.id,
        one.starts_at.toISOString(),
        one.ends_at.toISOString(),
        one.teacher_id ?? '',
        one.room_id ?? '',
        one.cancel_cause ?? '',
      ].join('|'),
    )
    .join(',');
}
