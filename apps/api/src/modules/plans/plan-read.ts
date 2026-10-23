import {
  lessonStateOf,
  planFileTypeSchema,
  planRequestCauseSchema,
  schoolDateOf,
  type PlanRequestCause,
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
  /** The lesson's start has passed (the fixed part of the queue, task 7.1b decision 3). */
  readonly started: boolean;
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
    started: lesson.startsAt.getTime() <= now.getTime(),
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

/** The journals of a plan (task 7.1c: several when it is shared), in the order of the id. */
export async function planJournalIds(transaction: Transaction, planId: string): Promise<string[]> {
  const rows = await transaction
    .selectFrom('lesson_plan_journals')
    .select('journal_id')
    .where('plan_id', '=', planId)
    .orderBy('journal_id')
    .execute();
  return rows.map((row) => row.journal_id);
}

/**
 * Locks journals `for no key update` in the order of the id, in one
 * statement, as the follow does (task 7.1c, "Locks"): every write of a plan
 * locks every journal of it.
 */
export async function lockJournals(
  transaction: Transaction,
  journalIds: readonly string[],
): Promise<void> {
  if (journalIds.length === 0) return;
  await transaction
    .selectFrom('journals')
    .select('id')
    .where('id', 'in', [...journalIds])
    .orderBy('id')
    .forNoKeyUpdate()
    .execute();
}

/** The offset of the first of the two writes of a move (the unique row of `lesson_plan_places`). */
export const PLACE_OFFSET = 1_000_000;

/** Moves items of one journal of a plan to new places, in two writes so that no row is held twice. */
export async function movePlaces(
  transaction: Transaction,
  planId: string,
  journalId: string,
  moves: ReadonlyMap<string, number>,
): Promise<void> {
  for (const step of [PLACE_OFFSET, 0]) {
    for (const [itemId, position] of moves) {
      await transaction
        .updateTable('lesson_plan_places')
        .set({ position: position + step })
        .where('plan_id', '=', planId)
        .where('journal_id', '=', journalId)
        .where('item_id', '=', itemId)
        .execute();
    }
  }
}

/**
 * The items of a plan that are not cleared, as one journal lays them, by
 * position, with their works and files (task 7.1c, decision 2: the place of
 * an item is per journal, `lesson_plan_places`).
 */
export async function planItems(
  transaction: Transaction,
  planId: string,
  journalId: string,
): Promise<PlanItem[]> {
  const items = await transaction
    .selectFrom('lesson_plan_items')
    .innerJoin('lesson_plan_places', 'lesson_plan_places.item_id', 'lesson_plan_items.id')
    .select([
      'lesson_plan_items.id',
      'lesson_plan_places.position',
      'lesson_plan_items.topic',
      'lesson_plan_items.objectives',
      'lesson_plan_items.links',
      'lesson_plan_items.copied_from',
      sql<string | null>`lesson_plan_places.moved_from::text`.as('moved_from'),
    ])
    .where('lesson_plan_items.plan_id', '=', planId)
    .where('lesson_plan_places.plan_id', '=', planId)
    .where('lesson_plan_places.journal_id', '=', journalId)
    .where('lesson_plan_items.cleared_at', 'is', null)
    .orderBy('lesson_plan_places.position')
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
  // Decision 16: the plan each copied item came from, by its first journal.
  const copied = items.flatMap((item) => (item.copied_from === null ? [] : [item.copied_from]));
  const sources = new Map<string, { journalId: string; quarterId: string }>();
  if (copied.length > 0) {
    const rows = await transaction
      .selectFrom('lesson_plan_items')
      .innerJoin(
        'lesson_plan_journals',
        'lesson_plan_journals.plan_id',
        'lesson_plan_items.plan_id',
      )
      .select([
        'lesson_plan_items.id',
        'lesson_plan_journals.journal_id',
        'lesson_plan_journals.quarter_id',
      ])
      .where('lesson_plan_items.id', 'in', copied)
      .orderBy('lesson_plan_journals.journal_id', 'desc')
      .execute();
    for (const row of rows) {
      sources.set(row.id, { journalId: row.journal_id, quarterId: row.quarter_id });
    }
  }
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
    movedFrom: item.moved_from,
    copiedFrom: item.copied_from === null ? null : (sources.get(item.copied_from) ?? null),
  }));
}

/**
 * The prepared edit request of a plan (task 7.1b, decision 2), with its
 * causes in the order they came; `null` when none is prepared.
 */
export async function preparedRequestOf(
  transaction: Transaction,
  planId: string,
  journalId: string,
): Promise<{
  fromDate: string;
  causes: { kind: PlanRequestCause; onDate: string; items: number }[];
} | null> {
  const request = await transaction
    .selectFrom('lesson_plan_requests')
    .select(['id', sql<string>`from_date::text`.as('from_date')])
    .where('plan_id', '=', planId)
    .where('journal_id', '=', journalId)
    .where('status', '=', 'prepared')
    .executeTakeFirst();
  if (request === undefined) return null;
  const causes = await transaction
    .selectFrom('lesson_plan_request_causes')
    .select(['kind', sql<string>`on_date::text`.as('on_date'), 'items'])
    .where('request_id', '=', request.id)
    .orderBy('at')
    .orderBy('id')
    .execute();
  return {
    fromDate: request.from_date,
    causes: causes.map((cause) => ({
      kind: planRequestCauseSchema.parse(cause.kind),
      onDate: cause.on_date,
      items: cause.items,
    })),
  };
}
