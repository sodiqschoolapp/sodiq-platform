import { sql, type Transaction as KyselyTransaction } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config/config.js';
import type { Database } from '../database/database.js';
import type { DB } from '../database/types.generated.js';
import { Transactions } from '../database/transactions.js';
import { ActingKit } from '../testing/acting-kit.js';
import { CellsKit } from '../testing/cells-kit.js';
import { dayTemplatesKit, type DayTemplatesKit } from '../testing/day-templates-kit.js';
import { at } from '../testing/lessons-kit.js';
import { LoadKit } from '../testing/load-kit.js';
import { JobQueue } from '../jobs/job-queue.js';
import { MonitoringCounts } from './counts.job.js';
import { branchCounts, failedJobs } from './counts.query.js';
import type { Fetch } from './grafana.js';

/** Wednesday 28 October 2026, 09:05 in Tashkent. */
const NOW = '2026-10-28T09:05:00+05:00';
const TODAY = '2026-10-28';

const pushed: string[] = [];
const recording: Fetch = (_url, init) => {
  if (typeof init.body === 'string') pushed.push(...init.body.split('\n'));
  return Promise.resolve({ ok: true, status: 204 });
};

/** Writes as the application would, at a moment, with the branch filter of the row's branch. */
async function asOf<T>(
  migrator: Database,
  moment: string,
  work: (transaction: KyselyTransaction<DB>) => Promise<T>,
): Promise<T> {
  return migrator.transaction().execute(async (transaction) => {
    await sql`select set_config('app.now', ${new Date(moment).toISOString()}, true)`.execute(
      transaction,
    );
    return work(transaction);
  });
}

// Task 10.2a, pull request #256 (`edge/system-behaviour`, "Cell saves fail in one branch at
// 08:05": alerts per branch for a jump in refused saves, failed jobs, a nightly-check
// difference, and "far fewer first-slot lessons with attendance by 09:00 than usual"; From 9.2c:
// the daily work that did not run; From 8.9: failed exports). All names are invented.
describe('the counts per branch for the alerts', () => {
  let t: DayTemplatesKit;
  let cells: CellsKit;
  let load: LoadKit;
  let acting: ActingKit;
  let north: string;
  let south: string;
  let northYear: string;
  let southYear: string;
  let account: string;
  let scratch = 0;

  beforeAll(async () => {
    t = await dayTemplatesKit({
      jobs: true,
      config: {
        ...loadConfig(process.env),
        monitoring: {
          grafana: {
            metricsUrl: 'https://metrics.example.test/push',
            metricsUser: '1',
            logsUrl: 'https://logs.example.test/push',
            logsUser: '2',
            token: 'token',
          },
          instance: 'local',
        },
      },
      monitoringFetch: recording,
    });
    cells = await CellsKit.create(t.database.migrator);
    load = new LoadKit(t.database.migrator);
    acting = new ActingKit(t.database.migrator);
    north = await t.newBranch();
    south = await t.newBranch();
    northYear = (await cells.lessons.year(north)).year;
    southYear = (await cells.lessons.year(south)).year;
    account = await load.classes.account();
  });

  afterAll(async () => {
    await t.close();
  });

  /** The class's lesson on the date at the time, with a teacher of its own; cancelled when asked. */
  async function lessonAt(
    branch: string,
    year: string,
    classId: string,
    date: string,
    time: string,
    teacher: string,
  ): Promise<string> {
    // Written first on a September date of its own and moved, so that the kit's own time of
    // day never meets a lesson of the class already moved to the date.
    scratch += 1;
    const lesson = await cells.lesson(
      branch,
      year,
      classId,
      `2026-09-${String(1 + (scratch % 20)).padStart(2, '0')}`,
    );
    const block = await t.database.migrator
      .selectFrom('lessons')
      .select('block_id')
      .where('id', '=', lesson)
      .executeTakeFirstOrThrow();
    const starts = at(date, time);
    await t.database.migrator
      .updateTable('lesson_blocks')
      .set({
        lesson_date: date,
        starts_at: starts,
        ends_at: new Date(starts.getTime() + 45 * 60_000),
      })
      .where('id', '=', block.block_id)
      .execute();
    await t.database.migrator
      .updateTable('lessons')
      .set({ teacher_id: teacher })
      .where('id', '=', lesson)
      .execute();
    return lesson;
  }

  /** A class with one student and a teacher of its own. */
  async function classWith(branch: string, year: string) {
    const classId = await load.classes.schoolClass(branch, year, { grade: 7 });
    const [student] = await cells.lessons.pupils(branch, classId, 1);
    const teacher = await load.teacher(branch, {
      subjects: [{ subject: cells.subject, grades: [7] }],
    });
    return { classId, student: student ?? '', teacher: teacher.staffId };
  }

  const counts = (branch: string, today = TODAY, now = NOW) =>
    t.app
      .get(Transactions)
      .run([branch], (transaction) =>
        branchCounts(transaction, branch, 'Asia/Tashkent', new Date(now), today),
      );

  it('counts the first-slot lessons with a mark saved by 09:00, today and on the same weekday of the four weeks before', async () => {
    const first = await classWith(north, northYear);
    const second = await classWith(north, northYear);
    const third = await classWith(north, northYear);
    const fourth = await classWith(north, northYear);
    const fifth = await classWith(north, northYear);
    const sixth = await classWith(north, northYear);
    const mark = (lesson: string, student: string, moment: string) =>
      cells.cell(north, { lessonId: lesson, studentId: student, mark: 1, by: account, at: moment });

    // Today. The first class: its first lesson marked at 08:10; its second lesson does not count.
    const firstToday = await lessonAt(
      north,
      northYear,
      first.classId,
      TODAY,
      '08:00',
      first.teacher,
    );
    await mark(firstToday, first.student, '2026-10-28T08:10:00+05:00');
    const secondLesson = await lessonAt(
      north,
      northYear,
      first.classId,
      TODAY,
      '08:50',
      first.teacher,
    );
    await mark(secondLesson, first.student, '2026-10-28T08:55:00+05:00');
    // The second class: marked at 09:01, after the hour.
    const late = await lessonAt(north, northYear, second.classId, TODAY, '08:00', second.teacher);
    await mark(late, second.student, '2026-10-28T09:01:00+05:00');
    // The fifth class at 09:00:00 exactly: not "by 09:00". The sixth at 08:59:59: in time.
    const onTheHour = await lessonAt(
      north,
      northYear,
      fifth.classId,
      TODAY,
      '08:00',
      fifth.teacher,
    );
    await mark(onTheHour, fifth.student, '2026-10-28T09:00:00+05:00');
    const justBefore = await lessonAt(
      north,
      northYear,
      sixth.classId,
      TODAY,
      '08:00',
      sixth.teacher,
    );
    await mark(justBefore, sixth.student, '2026-10-28T08:59:59+05:00');
    // The third class starts at 09:30: no first-slot lesson by 09:00.
    await lessonAt(north, northYear, third.classId, TODAY, '09:30', third.teacher);
    // The fourth class: its 08:00 lesson is cancelled, so its first lesson is the one at 08:50.
    const cancelled = await lessonAt(
      north,
      northYear,
      fourth.classId,
      TODAY,
      '08:00',
      fourth.teacher,
    );
    await t.database.migrator
      .updateTable('lessons')
      .set({ cancel_cause: 'reason', cancel_reason: 'Trip' })
      .where('id', '=', cancelled)
      .execute();
    await lessonAt(north, northYear, fourth.classId, TODAY, '08:50', fourth.teacher);

    // The baseline: 7 days back marked, 14 days back not, 35 days back outside the four weeks.
    const weekBack = await lessonAt(
      north,
      northYear,
      first.classId,
      '2026-10-21',
      '08:00',
      first.teacher,
    );
    await mark(weekBack, first.student, '2026-10-21T08:05:00+05:00');
    await lessonAt(north, northYear, first.classId, '2026-10-14', '08:00', first.teacher);
    const outside = await lessonAt(
      north,
      northYear,
      first.classId,
      '2026-09-23',
      '08:00',
      first.teacher,
    );
    await mark(outside, first.student, '2026-09-23T08:05:00+05:00');

    // Another branch's marked lesson today: not this branch's count.
    const other = await classWith(south, southYear);
    const southLesson = await lessonAt(
      south,
      southYear,
      other.classId,
      TODAY,
      '08:00',
      other.teacher,
    );
    await cells.cell(south, {
      lessonId: southLesson,
      studentId: other.student,
      mark: 1,
      by: account,
      at: '2026-10-28T08:05:00+05:00',
    });

    expect((await counts(north)).firstSlot).toEqual({
      lessons: 5,
      marked: 2,
      baselineLessons: 2,
      baselineMarked: 1,
    });
    expect((await counts(south)).firstSlot).toEqual({
      lessons: 1,
      marked: 1,
      baselineLessons: 0,
      baselineMarked: 0,
    });
    // A day off (no lessons that day): nothing for the rule to compare.
    expect((await counts(north, '2026-10-29', '2026-10-29T09:05:00+05:00')).firstSlot).toEqual({
      lessons: 0,
      marked: 0,
      baselineLessons: 0,
      baselineMarked: 0,
    });
  });

  it('counts refused saves of the last 10 minutes, failed exports of the last hour, the newest finished check and the newest daily work, per branch', async () => {
    const empty = await counts(north);
    expect(empty).toMatchObject({
      refusedSaves: 0,
      failedExports: 0,
      checkFinished: null,
      checkDifferences: 0,
      dailyEnqueued: null,
    });

    const scene = await classWith(north, northYear);
    const journal = await acting.journal(north, northYear, scene.classId, cells.subject);
    const lesson = await lessonAt(north, northYear, scene.classId, TODAY, '08:00', scene.teacher);
    const refuse = (branch: string, moment: string) =>
      asOf(t.database.migrator, moment, (transaction) =>
        transaction
          .insertInto('journal_save_refusals')
          .values({
            branch_id: branch,
            journal_id: journal,
            lesson_id: lesson,
            student_id: scene.student,
            kind: 'attendance',
            code: 'journal_locked',
            account_id: account,
            refused_at: new Date(moment),
          })
          .execute(),
      );
    await refuse(north, '2026-10-28T08:54:00+05:00');
    await refuse(north, '2026-10-28T08:56:00+05:00');
    await refuse(north, '2026-10-28T09:04:00+05:00');

    // Exports: one failed 50 minutes ago, one failed 70 minutes ago (outside the hour).
    const assignment = await load.classes.role(account, north, 'academic_vice_principal');
    const firstQuarter = await t.database.migrator
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', northYear)
      .where('number', '=', 1)
      .executeTakeFirstOrThrow();
    for (const failedAt of ['2026-10-28T08:15:00+05:00', '2026-10-28T07:55:00+05:00']) {
      const row = await asOf(t.database.migrator, failedAt, (transaction) =>
        transaction
          .insertInto('journal_exports')
          .values({
            branch_id: north,
            account_id: account,
            assignment_id: assignment,
            quarter_id: firstQuarter.id,
            format: 'xlsx',
            language: 'en',
            requested_at: new Date(failedAt),
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      );
      await asOf(t.database.migrator, failedAt, (transaction) =>
        transaction
          .updateTable('journal_exports')
          .set({ status: 'failed', failure: 'journal_export_failed' })
          .where('id', '=', row.id)
          .execute(),
      );
    }

    const quarter = await t.database.migrator
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', northYear)
      .where('number', '=', 1)
      .executeTakeFirstOrThrow();
    const runCheck = async (
      day: string,
      started: string,
      finished: string | null,
      found: number,
    ) => {
      const check = await asOf(t.database.migrator, started, (transaction) =>
        transaction
          .insertInto('result_checks')
          .values({ branch_id: north, day, started_at: new Date(started) })
          .returning('id')
          .executeTakeFirstOrThrow(),
      );
      for (let index = 0; index < found; index += 1) {
        await asOf(t.database.migrator, started, (transaction) =>
          transaction
            .insertInto('result_check_differences')
            .values({
              branch_id: north,
              check_id: check.id,
              quarter_id: quarter.id,
              journal_id: journal,
              kind: 'stored_module',
              detail: JSON.stringify({ index }),
            })
            .execute(),
        );
      }
      if (finished !== null) {
        await asOf(t.database.migrator, finished, (transaction) =>
          transaction
            .updateTable('result_checks')
            .set({ summary: JSON.stringify({}) })
            .where('id', '=', check.id)
            .execute(),
        );
      }
    };
    await runCheck('2026-10-27', '2026-10-27T02:00:00+05:00', '2026-10-27T02:10:00+05:00', 2);
    // Today's run has not finished: the newest finished one is yesterday's.
    await runCheck('2026-10-28', '2026-10-28T02:00:00+05:00', null, 5);
    await asOf(t.database.migrator, '2026-10-28T07:00:00+05:00', (transaction) =>
      transaction
        .insertInto('scheduled_runs')
        .values({
          branch_id: north,
          kind: 'plans.reminders',
          day: TODAY,
          enqueued_at: new Date('2026-10-28T07:00:00+05:00'),
        })
        .execute(),
    );

    const found = await counts(north);
    expect(found).toMatchObject({
      refusedSaves: 2,
      failedExports: 1,
      checkFinished: Math.floor(Date.parse('2026-10-27T02:10:00+05:00') / 1000),
      checkDifferences: 2,
      dailyEnqueued: Math.floor(Date.parse('2026-10-28T07:00:00+05:00') / 1000),
    });
    expect(await counts(south)).toMatchObject({
      refusedSaves: 0,
      checkFinished: null,
      checkDifferences: 0,
      dailyEnqueued: null,
    });
  });

  it('counts failed jobs of the last hour per name and per branch of their envelope', async () => {
    // The queues exist once the queue of the process has started.
    await t.app.get(JobQueue).ready();
    const job = (name: string, data: object, completed: string, state = 'failed') =>
      sql`
        insert into pgboss.job (name, data, state, completed_on)
        values (${name}, ${JSON.stringify(data)}::jsonb, ${state}::pgboss.job_state, ${new Date(completed)})
      `.execute(t.database.migrator);
    await job(
      'journal.branch_export',
      { branchIds: [north], data: {} },
      '2026-10-28T08:30:00+05:00',
    );
    await job(
      'journal.branch_export',
      { branchIds: [north], data: {} },
      '2026-10-28T09:00:00+05:00',
    );
    await job(
      'journal.branch_export',
      { branchIds: [south], data: {} },
      '2026-10-28T09:00:00+05:00',
    );
    // Older than an hour, or not failed: not counted.
    await job(
      'journal.branch_export',
      { branchIds: [north], data: {} },
      '2026-10-28T08:00:00+05:00',
    );
    await job(
      'journal.branch_export',
      { branchIds: [north], data: {} },
      '2026-10-28T09:00:00+05:00',
      'completed',
    );
    await job('schedule.tick', { branchIds: [], data: {} }, '2026-10-28T09:01:00+05:00');

    const failed = await t.app
      .get(Transactions)
      .run([], (transaction) => failedJobs(transaction, new Date(NOW)));
    expect(failed).toEqual(
      expect.arrayContaining([
        { name: 'journal.branch_export', branch: north, failed: 2 },
        { name: 'journal.branch_export', branch: south, failed: 1 },
        { name: 'schedule.tick', branch: 'none', failed: 1 },
      ]),
    );
    expect(failed.filter((one) => one.name === 'journal.branch_export')).toHaveLength(2);
  });

  it('pushes a point per branch, the failed jobs and that the counts arrived, leaving out a moment not known yet', async () => {
    t.clock.set(NOW);
    pushed.length = 0;
    await t.app.get(MonitoringCounts).run();
    const branchLines = pushed.filter((line) => line.startsWith('sodiq_branch,'));
    const southLine = branchLines.find((line) => line.includes(`branch=${south}`));
    expect(southLine).toBeDefined();
    expect(southLine).not.toContain('check_finished=');
    expect(southLine).toContain('first_slot_lessons=1i');
    expect(branchLines.find((line) => line.includes(`branch=${north}`))).toContain(
      'refused_saves=2i',
    );
    expect(pushed).toContainEqual(
      expect.stringContaining(
        `sodiq_jobs,branch=${north},instance=local,name=journal.branch_export,service=api failed=2i`,
      ),
    );
    expect(pushed).toContainEqual(
      expect.stringMatching(/^sodiq_counts,instance=local,service=api pushed=1i /),
    );
  });
});
