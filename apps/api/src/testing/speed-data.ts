import { performance } from 'node:perf_hooks';
import { sql } from 'kysely';
import { Audit } from '../modules/audit/audit.service.js';
import { Transactions } from '../database/transactions.js';
import type { AppKit } from './day-templates-kit.js';
import type { BranchOfRun } from './real-size.js';

/**
 * The journals of the speed run (task 10.1; `14`, Speed tests: "three times
 * the estimated yearly data"): every held lesson of a branch from the run's
 * start to the day before the measuring day, filled as a year of school fills
 * it, so every reader of `12` meets the data it would meet in May.
 *
 * Per lesson: an attendance mark for every expected student (about 92 %
 * present, 5 % absent, 3 % late, seeded), `classworks` classworks with a total
 * and a score for each student not absent, a homework on every second lesson,
 * and a correction of about `corrections` of the score cells (a second
 * history line). Set-based SQL in one transaction per branch and school day,
 * run by `Transactions.run` (the row filter of the branch) with the clock at
 * that day's last lesson end, so `journal_cell_moment` (0122) passes and every
 * history line carries its day; every trigger on and one audit entry per
 * transaction (`lesson_history_unaudited`). Invented data only.
 */

/** The measuring day: Thursday 20 May 2027, 10:00 in Tashkent, in quarter 4. */
export const SPEED_CLOCK = '2027-05-20T10:00:00+05:00';
/** The last day the filler writes: the day before the measuring day. */
export const FILLED_UNTIL = '2027-05-19';

export interface Density {
  /** Classworks per lesson of a graded subject. */
  readonly classworks: number;
  /** The share of score cells corrected once, out of 100. */
  readonly corrections: number;
}

/**
 * What fits the Speed workflow's five hours at `triple`. Three times the
 * estimate of `edge/system-behaviour` (Data volume: 24 million cells and 45
 * million history entries at the lower end) would need two classworks a lesson
 * and nine scores in ten corrected: with every trigger on the filler writes
 * about 2,100 cells a second on four processors (the full-size run of 28
 * October 2026), so that alone would take about six hours, past GitHub's limit
 * of a job. `speed.database.test.ts` reports the counts against the bar; the
 * gap is in `docs/progress.md` (task 10.1, decision 1, Look first).
 */
export const DENSITY: Density = { classworks: 1, corrections: 25 };

export interface Filled {
  readonly days: number;
  readonly lessons: number;
  readonly cells: number;
  readonly seconds: number;
}

/**
 * Fills the journals of the branches day by day from `from` to `until`. Each
 * branch's `writer` is the account named as the one who typed its cells and
 * in its audit entries. The branches of one day are written at once, the
 * clock at the latest lesson end of that day over all of them (one clock for
 * the app: `journal_cell_moment` asks only that a lesson has begun).
 */
export async function fillJournals(
  t: AppKit,
  branches: readonly { readonly branch: BranchOfRun; readonly writer: string }[],
  options: { from: string; until?: string; density?: Density },
): Promise<Map<string, Filled>> {
  const started = performance.now();
  const density = options.density ?? DENSITY;
  const days = await t.database.migrator
    .selectFrom('lessons')
    .select([
      sql<string>`lesson_date::text`.as('date'),
      (select) => select.fn.max('ends_at').as('last_end'),
    ])
    .where(
      'branch_id',
      'in',
      branches.map((one) => one.branch.id),
    )
    .where('cancel_cause', 'is', null)
    .where('lesson_date', '>=', options.from)
    .where('lesson_date', '<=', options.until ?? FILLED_UNTIL)
    .groupBy('lesson_date')
    .orderBy('lesson_date')
    .execute();
  const filled = new Map<string, { days: number; lessons: number; cells: number }>();
  for (const day of days) {
    t.clock.set(new Date(day.last_end).toISOString());
    const written = await Promise.all(
      branches.map(({ branch, writer }) => fillDay(t, branch, writer, day.date, density)),
    );
    for (const [index, { branch }] of branches.entries()) {
      const known = filled.get(branch.id) ?? { days: 0, lessons: 0, cells: 0 };
      const one = written[index] ?? { lessons: 0, cells: 0 };
      filled.set(branch.id, {
        days: known.days + (one.lessons > 0 ? 1 : 0),
        lessons: known.lessons + one.lessons,
        cells: known.cells + one.cells,
      });
    }
  }
  const seconds = (performance.now() - started) / 1000;
  return new Map([...filled].map(([id, one]) => [id, { ...one, seconds }]));
}

/** One branch's school day, in one transaction of the branch. */
async function fillDay(
  t: AppKit,
  branch: BranchOfRun,
  writer: string,
  date: string,
  density: Density,
): Promise<{ lessons: number; cells: number }> {
  const audit = t.app.get(Audit);
  return t.app.get(Transactions).run([branch.id], async (transaction) => {
    const held = await sql<{ n: number }>`
        select count(*)::int as n from lessons
        where branch_id = ${branch.id}::uuid and lesson_date = ${date}::date
          and cancel_cause is null
      `.execute(transaction);
    // The works: classworks on every lesson, a homework on every second;
    // written without a total and then given one, as the routes do
    // (`journal_work_insert_data`, 0119).
    await sql`
        insert into journal_works (branch_id, lesson_id, kind)
        select l.branch_id, l.id, w.kind
        from (
          select l.*, row_number() over (order by l.id) as n
          from lessons l
          where l.branch_id = ${branch.id}::uuid and l.lesson_date = ${date}::date
            and l.cancel_cause is null
        ) l
        cross join lateral (
          select 'classwork' as kind from generate_series(1, ${density.classworks})
          union all
          select 'homework' where l.n % 2 = 0
        ) w
      `.execute(transaction);
    await sql`
        update journal_works w
        set total = case w.kind when 'classwork' then 30 else 10 end
        from lessons l
        where l.id = w.lesson_id and w.branch_id = ${branch.id}::uuid
          and l.lesson_date = ${date}::date
      `.execute(transaction);
    // Attendance, seeded by the student and the lesson.
    const marks = await sql<{ n: number }>`
        with expected as (
          select l.id as lesson_id, l.starts_at, s.student_id,
            abs(hashtext(l.id::text || s.student_id::text)) % 100 as roll
          from lessons l
          cross join lateral lesson_expected_students(l.id) as s(student_id)
          where l.branch_id = ${branch.id}::uuid and l.lesson_date = ${date}::date
            and l.cancel_cause is null
        ), attendance as (
          insert into journal_cells
            (branch_id, lesson_id, student_id, work_id, mark, score, version, changed_by,
             changed_how, changed_at)
          select ${branch.id}::uuid, e.lesson_id, e.student_id, null,
            case when e.roll < 5 then 0 when e.roll < 8 then 2 else 1 end,
            null, 1, ${writer}::uuid, 'entry', e.starts_at
          from expected e
          returning 1
        ), scores as (
          insert into journal_cells
            (branch_id, lesson_id, student_id, work_id, mark, score, version, changed_by,
             changed_how, changed_at)
          select ${branch.id}::uuid, e.lesson_id, e.student_id, w.id, null,
            abs(hashtext(w.id::text || e.student_id::text)) % (w.total + 1),
            1, ${writer}::uuid, 'entry', e.starts_at
          from expected e
          join journal_works w on w.lesson_id = e.lesson_id and w.branch_id = ${branch.id}::uuid
          where e.roll >= 5
          returning 1
        )
        select (select count(*) from attendance)::int + (select count(*) from scores)::int as n
      `.execute(transaction);
    // Corrections: a share of the scores typed again (a second history line).
    await sql`
        update journal_cells c
        set score = (c.score + 1) % (w.total + 1), changed_by = ${writer}::uuid,
          changed_how = 'entry'
        from journal_works w, lessons l
        where w.id = c.work_id and l.id = c.lesson_id
          and c.branch_id = ${branch.id}::uuid and l.lesson_date = ${date}::date
          and abs(hashtext(c.id::text)) % 100 < ${density.corrections}
      `.execute(transaction);
    await audit.record(transaction, {
      actorId: writer,
      branchId: branch.id,
      action: 'test.speed_fill',
      details: { date },
    });
    return { lessons: held.rows[0]?.n ?? 0, cells: marks.rows[0]?.n ?? 0 };
  });
}

/** The rows of the journal tables over every branch, as the run reports them. */
export async function journalCounts(t: AppKit): Promise<{
  lessons: number;
  cells: number;
  history: number;
}> {
  const found = await sql<{ lessons: number; cells: number; history: number }>`
    select (select count(*) from lessons)::int as lessons,
      (select count(*) from journal_cells)::int as cells,
      (select count(*) from journal_cell_history)::int as history
  `.execute(t.database.migrator);
  return found.rows[0] ?? { lessons: 0, cells: 0, history: 0 };
}
