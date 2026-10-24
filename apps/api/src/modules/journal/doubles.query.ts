import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/**
 * The first lessons of the doubles whose second lessons are among `ids`
 * (task 8.3a; `edge/timetable`, Double lessons: "They give two journal
 * columns and two plan items, with a 'copy attendance' button"): the lesson of
 * the same class or group and subject on the same date whose block shares the
 * block's `double_pair_id` (0058) and starts earlier. Keyed by the second.
 */
export async function firstsOfDoubles(
  transaction: Transaction,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const found = await sql<{ second: string; first: string }>`
    select l2.id as second, l1.id as first
    from lessons l2
    join lesson_blocks b2 on b2.id = l2.block_id
    join lesson_blocks b1 on b1.double_pair_id = b2.double_pair_id and b1.id <> b2.id
    join lessons l1 on l1.block_id = b1.id
      and l1.subject_id = l2.subject_id
      and l1.class_id is not distinct from l2.class_id
      and l1.group_id is not distinct from l2.group_id
      and l1.lesson_date = l2.lesson_date
      and l1.starts_at < l2.starts_at
    where l2.id = any(${[...ids]}::uuid[])
  `.execute(transaction);
  return new Map(found.rows.map((row) => [row.second, row.first]));
}
