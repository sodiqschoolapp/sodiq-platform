import { sql, type Kysely } from 'kysely';
import type { DB } from '../database/types.generated.js';

/**
 * Task 7.2: the plan window of every dated quarter of a year, open from long
 * before the year to the quarter's last day, written by the migrator. A test
 * that writes plans and is not about the window opens them first (`09`:
 * "Inside the window teachers create and edit their plans freely"); a test of
 * the window opens it through the route.
 */
export async function openPlanWindows(
  migrator: Kysely<DB>,
  branchId: string,
  yearId: string,
): Promise<void> {
  await sql`
    insert into lesson_plan_windows
      (branch_id, quarter_id, start_date, end_date, starts_at, ends_at, opened_at, opened_by)
    select q.branch_id, q.id, date '2020-01-01', q.end_date,
      (date '2020-01-01')::timestamp at time zone b.time_zone,
      ((q.end_date + 1)::timestamp at time zone b.time_zone) - interval '1 millisecond',
      now(), (select a.id from accounts a order by a.id limit 1)
    from quarters q
    join branches b on b.id = q.branch_id
    where q.academic_year_id = ${yearId} and q.branch_id = ${branchId}
      and q.start_date is not null and q.end_date is not null
    on conflict (branch_id, quarter_id) do nothing
  `.execute(migrator);
}
