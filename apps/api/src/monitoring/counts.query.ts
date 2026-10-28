import { sql } from 'kysely';
import type { Transaction } from '../database/transactions.js';

/** What the database knows of one branch for the alerts (task 10.2a; `edge/system-behaviour`). */
export interface BranchCounts {
  refusedSaves: number;
  failedExports: number;
  /** Seconds since 1970 of the newest finished nightly check, or none yet. */
  checkFinished: number | null;
  /** The differences that check found. */
  checkDifferences: number;
  /** Seconds since 1970 of the newest daily work enqueued, or none yet. */
  dailyEnqueued: number | null;
  firstSlot: { lessons: number; marked: number; baselineLessons: number; baselineMarked: number };
}

const count = (value: unknown): number => Number(value ?? 0);
const seconds = (value: Date | null | undefined): number | null =>
  value === null || value === undefined ? null : Math.floor(value.getTime() / 1000);

/**
 * The counts of the branch of the transaction (its row filter holds that branch alone) at the
 * moment `now`, on its date `today` in branch time.
 *
 * First slot (plan decision 10): a first-slot lesson is a class's earliest lesson of the date
 * that is not cancelled and has a teacher, when it starts before 09:00 branch time; it is
 * "marked" when an attendance mark of it was first saved before 09:00 branch time (read from
 * the cell history, so a mark made later does not count). The baseline is the same counts on
 * the same weekday 7, 14, 21 and 28 days back, from the database: Grafana's free plan keeps 14
 * days.
 */
export async function branchCounts(
  transaction: Transaction,
  branchId: string,
  timeZone: string,
  now: Date,
  today: string,
): Promise<BranchCounts> {
  const refused = await transaction
    .selectFrom('journal_save_refusals')
    .select((eb) => eb.fn.countAll().as('count'))
    .where('branch_id', '=', branchId)
    .where('refused_at', '>', new Date(now.getTime() - 10 * 60_000))
    .where('refused_at', '<=', now)
    .executeTakeFirst();
  const failed = await transaction
    .selectFrom('journal_exports')
    .select((eb) => eb.fn.countAll().as('count'))
    .where('branch_id', '=', branchId)
    .where('status', '=', 'failed')
    .where('failed_at', '>', new Date(now.getTime() - 60 * 60_000))
    .where('failed_at', '<=', now)
    .executeTakeFirst();
  const check = await transaction
    .selectFrom('result_checks')
    .select(['id', 'finished_at'])
    .where('branch_id', '=', branchId)
    .where('finished_at', 'is not', null)
    .orderBy('finished_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  const differences =
    check === undefined
      ? undefined
      : await transaction
          .selectFrom('result_check_differences')
          .select((eb) => eb.fn.countAll().as('count'))
          .where('check_id', '=', check.id)
          .executeTakeFirst();
  const daily = await transaction
    .selectFrom('scheduled_runs')
    .select((eb) => eb.fn.max('enqueued_at').as('newest'))
    .where('branch_id', '=', branchId)
    .executeTakeFirst();
  const { rows } = await sql<{ today: boolean; lessons: string; marked: string }>`
    with days as (
      select (${today}::date - step * 7) as day
      from generate_series(0, 4) as step
    ),
    firsts as (
      select distinct on (lesson.class_id, lesson.lesson_date)
        lesson.id, lesson.lesson_date, lesson.starts_at
      from lessons lesson
      join days on days.day = lesson.lesson_date
      where lesson.branch_id = ${branchId}
        and lesson.class_id is not null
        and lesson.cancel_cause is null
        and lesson.teacher_id is not null
      order by lesson.class_id, lesson.lesson_date, lesson.starts_at, lesson.id
    ),
    counted as (
      select
        first.lesson_date = ${today}::date as today,
        exists (
          select 1 from journal_cell_history history
          where history.lesson_id = first.id
            and history.work_id is null
            and history.mark_after is not null
            -- Nothing is entered before a lesson starts; the bound lets the partitions be pruned.
            and history.changed_at >= first.starts_at - interval '1 hour'
            and history.changed_at < (first.lesson_date + time '09:00') at time zone ${timeZone}
        ) as marked
      from firsts first
      where first.starts_at < (first.lesson_date + time '09:00') at time zone ${timeZone}
    )
    select today, count(*) as lessons, count(*) filter (where marked) as marked
    from counted
    group by today
  `.execute(transaction);
  const ofDays = (wanted: boolean) => rows.find((row) => row.today === wanted);
  return {
    refusedSaves: count(refused?.count),
    failedExports: count(failed?.count),
    checkFinished: seconds(check?.finished_at),
    checkDifferences: count(differences?.count),
    dailyEnqueued: seconds(daily?.newest === null ? null : new Date(String(daily?.newest))),
    firstSlot: {
      lessons: count(ofDays(true)?.lessons),
      marked: count(ofDays(true)?.marked),
      baselineLessons: count(ofDays(false)?.lessons),
      baselineMarked: count(ofDays(false)?.marked),
    },
  };
}

/** Failed jobs of the hour before `now`, per job name and branch (`none`: a job of no branch). */
export async function failedJobs(
  transaction: Transaction,
  now: Date,
): Promise<{ name: string; branch: string; failed: number }[]> {
  const { rows } = await sql<{ name: string; branch: string; failed: string }>`
    select job.name, coalesce(branch.id, 'none') as branch, count(*) as failed
    from pgboss.job job
    left join lateral jsonb_array_elements_text(
      case when jsonb_typeof(job.data -> 'branchIds') = 'array' then job.data -> 'branchIds' end
    ) as branch(id) on true
    where job.state = 'failed'
      and job.completed_on > ${new Date(now.getTime() - 60 * 60_000)}
      and job.completed_on <= ${now}
    group by job.name, coalesce(branch.id, 'none')
    order by job.name, 2
  `.execute(transaction);
  return rows.map((row) => ({ name: row.name, branch: row.branch, failed: Number(row.failed) }));
}
