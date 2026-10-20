import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';

/**
 * Until 5.6c-3 (task 5.6c-1, decision 5; `.claude/rules/timetable.md`, a task
 * that first writes rows): a publish or a withdraw that would create, remove
 * or change a lesson of the exam's classes at its time (a sitting class, a
 * sitting group, a group of a sitting class), or a block it keeps a class out
 * of, is refused `publish_over_exam`, one detail per exam. Without it, the
 * write would create lessons under the exam (refused by its class claims) or
 * remove a block an out row names (a foreign key, a 500). Other lessons are
 * written as before; one that meets an invigilator or an exam room is
 * refused by the claims as any publish clash (`timetable_busy`). 5.6c-3 replaces it
 * with the sorting of the kept exam (`edge/timetable`, Exams: "An exam is
 * stored on its own like a one-day change and kept after a later publish").
 */

interface ExamTime {
  readonly id: string;
  readonly title: string;
  readonly date: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly examId: string;
  /** The lessons of its classes that overlap it, and of its out rows' blocks, before the write. */
  readonly lessons: string;
}

/** The standing exams of a range with the lessons at their times, before a write. */
export async function examDaysBefore(
  transaction: Transaction,
  branchId: string,
  firstDate: string,
  lastDate: string,
): Promise<ExamTime[]> {
  const exams = await transaction
    .selectFrom('exams')
    .select(['id', 'title', sql<string>`exam_date::text`.as('date'), 'starts_at', 'ends_at'])
    .where('branch_id', '=', branchId)
    .where('exam_date', '>=', firstDate)
    .where('exam_date', '<=', lastDate)
    .where('cancel_cause', 'is', null)
    .orderBy('exam_date')
    .orderBy('id')
    .execute();
  const times: ExamTime[] = [];
  for (const exam of exams) {
    const time = { date: exam.date, startsAt: exam.starts_at, endsAt: exam.ends_at };
    const at = { ...time, examId: exam.id };
    times.push({
      id: exam.id,
      title: exam.title,
      ...at,
      lessons: await lessonsAt(transaction, branchId, at),
    });
  }
  return times;
}

/** Refuses the write when a lesson at an exam's time differs from before it. */
export async function refuseOverExams(
  transaction: Transaction,
  branchId: string,
  before: readonly ExamTime[],
): Promise<void> {
  const refused: ExamTime[] = [];
  for (const exam of before) {
    if ((await lessonsAt(transaction, branchId, exam)) !== exam.lessons) refused.push(exam);
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

/** The lessons of a date overlapping a time, as one text: what the guard compares. */
async function lessonsAt(
  transaction: Transaction,
  branchId: string,
  time: {
    readonly date: string;
    readonly startsAt: Date;
    readonly endsAt: Date;
    readonly examId: string;
  },
): Promise<string> {
  const { rows } = await sql<{
    id: string;
    starts_at: Date;
    ends_at: Date;
    teacher_id: string | null;
    room_id: string | null;
    cancel_cause: string | null;
  }>`
    select l.id, l.starts_at, l.ends_at, l.teacher_id, l.room_id, l.cancel_cause
    from lessons l
    where l.branch_id = ${branchId}::uuid
      and l.lesson_date = ${time.date}::date
      and (
        (
          l.starts_at < ${time.endsAt}::timestamptz and l.ends_at > ${time.startsAt}::timestamptz
          and exists (
            select 1 from exam_room_classes rc
            where rc.exam_id = ${time.examId}::uuid
              and (
                rc.class_id = l.class_id
                or rc.group_id = l.group_id
                or rc.class_id in (select gc.class_id from group_classes gc where gc.group_id = l.group_id)
              )
          )
        )
        or l.block_id in (
          select o.block_id from lesson_block_class_outs o where o.exam_id = ${time.examId}::uuid
        )
      )
    order by l.id
  `.execute(transaction);
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

/**
 * Before blocks are deleted: a block a standing exam keeps a class out of
 * is refused here, as `lesson_block_class_outs_block_fkey` cannot be deferred
 * and would end the write in a 500 before `refuseOverExams` runs (spec review
 * of the code, must-fix 2).
 */
export async function refuseOutBlocks(
  transaction: Transaction,
  blockIds: readonly string[],
): Promise<void> {
  if (blockIds.length === 0) return;
  const held = await transaction
    .selectFrom('lesson_block_class_outs')
    .innerJoin('exams', 'exams.id', 'lesson_block_class_outs.exam_id')
    .select(['exams.id', 'exams.title', sql<string>`exams.exam_date::text`.as('date')])
    .where('lesson_block_class_outs.block_id', 'in', [...blockIds])
    .where('exams.cancel_cause', 'is', null)
    .orderBy('exams.id')
    .execute();
  if (held.length === 0) return;
  const exams = [...new Map(held.map((one) => [one.id, one])).values()];
  throw new ApiException(
    'publish_over_exam',
    409,
    undefined,
    exams.map((one) => ({
      path: 'exams',
      code: 'publish_over_exam',
      message: one.title,
      recordId: one.id,
      day: one.date,
    })),
  );
}
