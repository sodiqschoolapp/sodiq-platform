import { sql } from 'kysely';
import type { HeldData } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';

/**
 * The lessons named that hold data (task 5.8b, decision 2;
 * edge/00-definitions, Data on a lesson: "An attendance mark, a number, a
 * total, a 'not held' mark or a comment entered by a person. Exemption marks,
 * plan items and one-day changes are not data."): the one place that answers
 * it in code, read from `lesson_holds_data` (0105), which the database's
 * delete guard reads too; it reads the cells and works since 0108 (task
 * 6.1a), and the writers of dated lessons keep what it names (task 6.1b-1).
 */
export async function lessonsHoldingData(
  transaction: Transaction,
  lessonIds: readonly string[],
): Promise<Set<string>> {
  if (lessonIds.length === 0) return new Set();
  const found = await sql<{ id: string }>`
    select l.id from unnest(${[...lessonIds]}::uuid[]) as l(id) where lesson_holds_data(l.id)
  `.execute(transaction);
  return new Set(found.rows.map((one) => one.id));
}

/**
 * What each lesson named that holds data holds (task 6.1b-2, decision 2,
 * spec review should-fix 2): the lessons are picked by `lessonsHoldingData`,
 * the one answer, and the counts are only the detail of their list
 * (edge/timetable, After publishing: "with a reason and a list of what is
 * affected"). Read after the change's locks on the lessons.
 */
export async function dataHeldBy(
  transaction: Transaction,
  lessonIds: readonly string[],
): Promise<Map<string, HeldData>> {
  const holding = [...(await lessonsHoldingData(transaction, lessonIds))].sort();
  const held = new Map<string, HeldData>();
  if (holding.length === 0) return held;
  const [cells, works] = await Promise.all([
    transaction
      .selectFrom('journal_cells')
      .select([
        'lesson_id',
        sql<number>`count(*) filter (where mark is not null)::int`.as('attendance'),
        sql<number>`count(*) filter (where score is not null)::int`.as('scores'),
      ])
      .where('lesson_id', 'in', holding)
      .groupBy('lesson_id')
      .execute(),
    transaction
      .selectFrom('journal_works')
      .select([
        'lesson_id',
        sql<number>`count(*) filter (where total is not null)::int`.as('totals'),
        sql<number>`count(*) filter (where not_held)::int`.as('not_held'),
      ])
      .where('lesson_id', 'in', holding)
      .groupBy('lesson_id')
      .execute(),
  ]);
  for (const id of holding) {
    const cell = cells.find((one) => one.lesson_id === id);
    const work = works.find((one) => one.lesson_id === id);
    held.set(id, {
      attendance: cell?.attendance ?? 0,
      scores: cell?.scores ?? 0,
      totals: work?.totals ?? 0,
      notHeld: work?.not_held ?? 0,
    });
  }
  return held;
}
