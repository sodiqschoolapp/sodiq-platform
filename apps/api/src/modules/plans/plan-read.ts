import {
  lessonStateOf,
  planFileTypeSchema,
  schoolDateOf,
  type PlanItem,
  type PlanWork,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import { journalLessons, slotNumbers, type JournalRow } from '../journal/journal-grid.query.js';
import { awayLessons } from '../timetable/away-read.js';

/**
 * The reads of the plans (task 7.1a, pull request #212). The rows of a plan
 * are the journal's own lessons as the grid reads them (`journalLessons`,
 * review must-fix 4), so the plan and the journal show the same thing (`09`).
 */

export interface PlanQuarter {
  readonly id: string;
  readonly number: number;
  readonly startDate: string;
  readonly endDate: string;
}

/** The branch's time zone, today and the transaction's moment (the injected clock). */
export async function clockOf(
  transaction: Transaction,
  branchId: string,
): Promise<{ timeZone: string; today: string; now: Date }> {
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const now = await transactionMoment(transaction);
  return { timeZone: branch.time_zone, today: schoolDateOf(now, branch.time_zone), now };
}

/** The quarters of a year that have dates, in order. */
export async function datedQuarters(
  transaction: Transaction,
  yearId: string,
): Promise<PlanQuarter[]> {
  const rows = await transaction
    .selectFrom('quarters')
    .select([
      'id',
      'number',
      sql<string | null>`start_date::text`.as('start_date'),
      sql<string | null>`end_date::text`.as('end_date'),
    ])
    .where('academic_year_id', '=', yearId)
    .orderBy('number')
    .execute();
  return rows.flatMap((one) =>
    one.start_date === null || one.end_date === null
      ? []
      : [{ id: one.id, number: one.number, startDate: one.start_date, endDate: one.end_date }],
  );
}

/** The quarter of today, else the next one, else the last one (as the journal grid opens). */
export function quarterOfToday(
  quarters: readonly PlanQuarter[],
  today: string,
): PlanQuarter | undefined {
  return (
    quarters.find((one) => one.startDate <= today && today <= one.endDate) ??
    quarters.find((one) => today < one.startDate) ??
    quarters.at(-1)
  );
}

/**
 * Decision 6: the owner is read on the quarter's reference date
 * (`edge/00-definitions`: the quarter's last day, or today while it is open),
 * its first day before it starts, as the grid reads it.
 */
export function referenceDateOf(quarter: PlanQuarter, today: string): string {
  if (today > quarter.endDate) return quarter.endDate;
  if (today < quarter.startDate) return quarter.startDate;
  return today;
}

/** A row of a plan: a lesson of the quarter not cancelled. */
export interface PlanRowLesson {
  readonly number: number;
  readonly lessonId: string;
  readonly date: string;
  readonly start: number;
  readonly end: number;
  readonly slot: number | null;
  readonly held: boolean;
}

/**
 * The rows of a journal's plan in a quarter (decision 5; `edge/lesson-plans`:
 * "Cancelled lessons are skipped"; "The number is the position among lessons
 * that are not cancelled. It is worked out for display"). Item p fills row p;
 * nothing is stored (review must-fix 1), so a cancellation shows at once.
 * "Held" is `lessonStateOf` with the away lessons, as the grid reads it.
 */
export async function planRows(
  transaction: Transaction,
  branchId: string,
  journal: JournalRow,
  quarter: PlanQuarter,
  timeZone: string,
  now: Date,
): Promise<PlanRowLesson[]> {
  const lessons = (
    await journalLessons(transaction, journal, timeZone, quarter.startDate, quarter.endDate)
  ).filter((lesson) => lesson.cancelCause === null);
  const [away, slots] = await Promise.all([
    awayLessons(
      transaction,
      lessons.map((one) => ({ id: one.id, teacherId: one.teacherId, startsAt: one.startsAt })),
    ),
    slotNumbers(
      transaction,
      branchId,
      journal.grades.length === 0 ? undefined : Math.min(...journal.grades),
      lessons,
    ),
  ]);
  return lessons.map((lesson, index) => ({
    number: index + 1,
    lessonId: lesson.id,
    date: lesson.date,
    start: lesson.start,
    end: lesson.end,
    slot: slots.get(lesson.id) ?? null,
    held:
      lessonStateOf(
        {
          startsAt: lesson.startsAt,
          cancelled: false,
          teacher: lesson.teacherKind,
          away: away.has(lesson.id),
        },
        now,
      ) === 'held',
  }));
}

/** The plan of a journal in a quarter, or `null` before its first write. */
export async function planIdOf(
  transaction: Transaction,
  journalId: string,
  quarterId: string,
): Promise<string | null> {
  const found = await transaction
    .selectFrom('lesson_plan_journals')
    .select('plan_id')
    .where('journal_id', '=', journalId)
    .where('quarter_id', '=', quarterId)
    .executeTakeFirst();
  return found?.plan_id ?? null;
}

/** The works of items, by item and kind, in order. */
export async function worksOf(
  transaction: Transaction,
  itemIds: readonly string[],
): Promise<Map<string, { classworks: PlanWork[]; homeworks: PlanWork[] }>> {
  const found = new Map(
    itemIds.map((id) => [id, { classworks: [] as PlanWork[], homeworks: [] as PlanWork[] }]),
  );
  if (itemIds.length === 0) return found;
  const rows = await transaction
    .selectFrom('lesson_plan_works')
    .select(['id', 'item_id', 'kind', 'title', 'description'])
    .where('item_id', 'in', [...itemIds])
    .orderBy('position')
    .orderBy('id')
    .execute();
  for (const row of rows) {
    const lists = found.get(row.item_id);
    if (lists === undefined) continue;
    const work = { id: row.id, title: row.title, description: row.description };
    if (row.kind === 'classwork') lists.classworks.push(work);
    else lists.homeworks.push(work);
  }
  return found;
}

/** The items of a plan that are not cleared, by position, with their works and files. */
export async function planItems(transaction: Transaction, planId: string): Promise<PlanItem[]> {
  const items = await transaction
    .selectFrom('lesson_plan_items')
    .select(['id', 'position', 'topic', 'objectives', 'links'])
    .where('plan_id', '=', planId)
    .where('cleared_at', 'is', null)
    .orderBy('position')
    .execute();
  const ids = items.map((item) => item.id);
  const works = await worksOf(transaction, ids);
  const files =
    ids.length === 0
      ? []
      : await transaction
          .selectFrom('lesson_plan_files')
          .select(['id', 'item_id', 'name', 'type', 'bytes'])
          .where('item_id', 'in', ids)
          .where('removed_at', 'is', null)
          .orderBy('id')
          .execute();
  return items.map((item) => ({
    id: item.id,
    position: item.position,
    topic: item.topic,
    objectives: item.objectives,
    links: item.links,
    classworks: works.get(item.id)?.classworks ?? [],
    homeworks: works.get(item.id)?.homeworks ?? [],
    files: files
      .filter((file) => file.item_id === item.id)
      .map((file) => ({
        id: file.id,
        name: file.name,
        type: planFileTypeSchema.parse(file.type),
        bytes: file.bytes,
      })),
  }));
}
