import { sql } from 'kysely';
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
