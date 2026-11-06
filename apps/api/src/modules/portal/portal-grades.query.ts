import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/** The clock minutes of a lesson in branch time, half-open (as `dated-check.ts` reads them). */
export interface LessonTime {
  readonly id: string;
  readonly start_minutes: number;
  readonly end_minutes: number;
}

/** The start and end of the lessons given, in minutes of the day in the branch's time zone (task 11.3). */
export async function lessonTimes(
  transaction: Transaction,
  ids: readonly string[],
  timeZone: string,
): Promise<LessonTime[]> {
  if (ids.length === 0) return [];
  const found = await sql<LessonTime>`
    select l.id,
      (extract(epoch from (l.starts_at at time zone ${timeZone})
        - (l.starts_at at time zone ${timeZone})::date::timestamp) / 60)::int as start_minutes,
      (extract(epoch from (l.ends_at at time zone ${timeZone})
        - (l.starts_at at time zone ${timeZone})::date::timestamp) / 60)::int as end_minutes
    from lessons l
    where l.id = any(${[...ids]}::uuid[])
  `.execute(transaction);
  return found.rows;
}
