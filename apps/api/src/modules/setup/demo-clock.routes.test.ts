import type { INestApplication } from '@nestjs/common';
import {
  BRANCH_HEADER,
  currentPeriodSchema,
  demoClockSchema,
  type DemoClockState,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { DailyWork } from '../results/daily/daily.service.js';
import { errorCode, signInKit, type SignInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

// Task 10.5 (pull request #280; the owner, 4 November 2026): the demo time of the test
// environment. Done when: a jump cannot go back, every route has allow and refuse tests, the
// daily work of the new date runs after a jump. docs/spec/edge-cases/developer-rules.md,
// Time-based state and Repeat-safe actions; `13`, Hosting. All names are invented.

const READ = '/api/setup/demo-clock';
const JUMP = '/api/setup/demo-clock/jumps';
/** Wednesday 4 November 2026, 10:00 in Tashkent. */
const REAL_START = '2026-11-04T10:00:00+05:00';
const DAY = 86_400_000;

const ok = (response: Response): unknown => {
  expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(200);
  return response.body;
};

async function superAdmin(kit: SignInKit, names: [string, string]): Promise<string> {
  const browser = await kit.completeSession(...names);
  await kit.giveRole(browser.account.id, { role: 'super_admin' });
  return browser.cookie;
}

describe('the demo clock on the test environment', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let branch: string;
  let admin: string;
  let teacher: string;
  const real = new FixedClock(REAL_START);

  const jumps = () =>
    database.migrator
      .selectFrom('audit_log_school')
      .select(['old_value', 'new_value', 'details', 'actor_id'])
      .where('action', '=', 'demo_clock.jump')
      .orderBy('occurred_at')
      .execute();

  const ticks = async () =>
    (
      await sql<{ start_after: Date }>`
        select start_after from pgboss.job where name = 'schedule.tick' order by created_on
      `.execute(database.migrator)
    ).rows;

  const jump = (to: string, cookie = admin) => kit.post(JUMP, cookie).send({ to });

  beforeAll(async () => {
    database = await createTestDatabase();
    branch = await insertBranch(database.migrator, 'North');
    app = await createTestApp({
      database: database.app,
      jobsDatabaseUrl: database.appUrl,
      demoClock: { real },
    });
    kit = signInKit(app);
    admin = await superAdmin(kit, ['Dilnoza', 'Karimova']);
    const browser = await kit.fullSession('Rustam', 'Aliyev');
    await kit.giveRole(browser.account.id, { role: 'teacher', branchId: branch });
    teacher = browser.cookie;
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('shows real time before the first jump; a missing row is offset 0', async () => {
    const state = demoClockSchema.parse(ok(await kit.get(READ, admin)));

    expect(state).toEqual({
      enabled: true,
      realNow: '2026-11-04T05:00:00.000Z',
      demoNow: '2026-11-04T05:00:00.000Z',
      offsetMs: 0,
      effectiveAt: null,
      changedAt: null,
    });
    const period = currentPeriodSchema.parse(
      ok(await kit.get('/api/setup/current-period', teacher).set(BRANCH_HEADER, branch)),
    );
    expect(period.demoNow).toBe('2026-11-04T05:00:00.000Z');
    expect(period.today).toBe('2026-11-04');
  });

  it('moves to tomorrow 07:05 for everyone, with its audit entry and the tick of the new date', async () => {
    const state: DemoClockState = demoClockSchema.parse(
      ok(await jump('2026-11-05T07:05:00+05:00')),
    );

    // The answer comes once the jump took effect, 5 seconds after it was written.
    expect(state.realNow).toBe('2026-11-04T05:00:05.000Z');
    expect(state.effectiveAt).toBe('2026-11-04T05:00:05.000Z');
    expect(state.changedAt).toBe('2026-11-04T05:00:00.000Z');
    expect(state.demoNow).toBe('2026-11-05T02:05:00.000Z');
    expect(state.offsetMs).toBe(Date.parse('2026-11-05T02:05:00Z') - Date.parse(state.realNow));
    const row = await database.migrator
      .selectFrom('demo_clock')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(Number(row.previous_offset_ms)).toBe(0);

    const [entry, ...more] = await jumps();
    expect(more).toEqual([]);
    expect(entry?.old_value).toEqual({ demoAt: '2026-11-04T05:00:05.000Z', offsetMs: 0 });
    expect(entry?.new_value).toEqual({
      demoAt: '2026-11-05T02:05:00.000Z',
      offsetMs: state.offsetMs,
    });
    expect(entry?.details).toEqual({ effectiveAt: '2026-11-04T05:00:05.000Z' });
    // The tick waits 2 seconds past the moment the jump takes effect (decision 4).
    expect((await ticks()).map((tick) => tick.start_after.toISOString())).toEqual([
      '2026-11-04T05:00:07.000Z',
    ]);

    const period = currentPeriodSchema.parse(
      ok(await kit.get('/api/setup/current-period', teacher).set(BRANCH_HEADER, branch)),
    );
    expect(period.today).toBe('2026-11-05');
    expect(period.demoNow).toBe('2026-11-05T02:05:00.000Z');
  });

  // Decisions 4 and 6: the tick of the new date sends that date's work once; days jumped over
  // are not replayed; "did not run" waits an hour of demo time after the check.
  it('runs the daily work of the new date after the jump, once', async () => {
    const runs = () =>
      database.migrator
        .selectFrom('scheduled_runs')
        .select(['kind', 'day'])
        .where('branch_id', '=', branch)
        .orderBy('kind')
        .execute();

    await app.get(DailyWork).tick();
    await app.get(DailyWork).tick();

    expect(await runs()).toEqual(
      [
        'journal.about_to_lock',
        'journal.exports_cleanup',
        'plans.reminders',
        'results.check',
        'results.closing_overdue',
        'timetable.forced_delete_purge',
      ].map((kind) => ({ kind, day: '2026-11-05' })),
    );

    ok(await jump('2026-11-05T08:06:00+05:00'));
    await app.get(DailyWork).tick();
    expect((await runs()).filter((run) => run.kind === 'results.check_missed')).toEqual([
      { kind: 'results.check_missed', day: '2026-11-05' },
    ]);
  });

  it('refuses a jump that does not go forward, and writes nothing', async () => {
    const before = await database.migrator
      .selectFrom('demo_clock')
      .selectAll()
      .executeTakeFirstOrThrow();

    for (const to of ['2026-11-05T07:05:00+05:00', '2026-11-04T12:00:00+05:00']) {
      const response = await jump(to);
      expect(response.status, to).toBe(409);
      expect(errorCode(response)).toBe('demo_clock_backwards');
    }

    expect(
      await database.migrator.selectFrom('demo_clock').selectAll().executeTakeFirstOrThrow(),
    ).toEqual(before);
    expect(await jumps()).toHaveLength(2);
    expect(await ticks()).toHaveLength(2);
  });

  it('refuses a jump of more than 400 days', async () => {
    const state = demoClockSchema.parse(ok(await kit.get(READ, admin)));
    // The demo moment when a jump written now would take effect, 5 seconds on.
    const then = Date.parse(state.demoNow) + 5_000;

    const far = await jump(new Date(then + 400 * DAY + 1).toISOString());
    expect(far.status).toBe(409);
    expect(errorCode(far)).toBe('demo_clock_too_far');
    expect(await jumps()).toHaveLength(2);
  });

  it('refuses a moment without its offset', async () => {
    const response = await jump('2026-11-06T07:05:00');

    expect(response.status).toBe(400);
  });

  it('lets one of two jumps at once through, and refuses the other as backwards', async () => {
    const to = '2026-11-09T09:05:00+05:00';
    const answers = await Promise.all([jump(to), jump(to)]);

    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(
      answers.filter((answer) => answer.status === 409).map((answer) => errorCode(answer)),
    ).toEqual(['demo_clock_backwards']);
    expect(await jumps()).toHaveLength(3);
    expect(await ticks()).toHaveLength(3);
  });

  it('keeps the offset in force before a jump takes effect as its previous offset', async () => {
    const row = await database.migrator
      .selectFrom('demo_clock')
      .selectAll()
      .executeTakeFirstOrThrow();
    // The second jump took effect at 05:00:10 real, to 03:06 demo (08:06 in Tashkent).
    const first = Date.parse('2026-11-05T03:06:00Z') - Date.parse('2026-11-04T05:00:10Z');

    expect(Number(row.previous_offset_ms)).toBe(first);
    expect(Number(row.offset_ms)).toBeGreaterThan(first);
  });

  it('refuses every other role and a caller without a session', async () => {
    for (const [path, call] of [
      [READ, (cookie?: string) => kit.get(READ, cookie)],
      [JUMP, (cookie?: string) => kit.post(JUMP, cookie).send({ to: '2027-01-01T00:00:00Z' })],
    ] as const) {
      expect((await call(teacher).set(BRANCH_HEADER, branch)).status, path).toBe(403);
      expect((await call()).status, path).toBe(401);
    }
  });
});

describe('the demo clock where DEMO_CLOCK is off (production)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let branch: string;
  let admin: string;
  let teacher: string;
  const clock = new FixedClock(REAL_START);

  beforeAll(async () => {
    database = await createTestDatabase();
    branch = await insertBranch(database.migrator, 'North');
    app = await createTestApp({ database: database.app, jobsDatabaseUrl: database.appUrl, clock });
    kit = signInKit(app);
    admin = await superAdmin(kit, ['Javohir', 'Saidov']);
    const browser = await kit.fullSession('Gulnora', 'Tursunova');
    await kit.giveRole(browser.account.id, { role: 'teacher', branchId: branch });
    teacher = browser.cookie;
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('says it is off and refuses a jump, writing nothing', async () => {
    expect(demoClockSchema.parse(ok(await kit.get(READ, admin)))).toMatchObject({
      enabled: false,
      demoNow: '2026-11-04T05:00:00.000Z',
      offsetMs: 0,
    });
    const response = await kit.post(JUMP, admin).send({ to: '2026-11-05T07:05:00+05:00' });

    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe('demo_clock_off');
    expect(await database.migrator.selectFrom('demo_clock').selectAll().execute()).toEqual([]);
  });

  it('answers no demo time in the top bar', async () => {
    const period = currentPeriodSchema.parse(
      ok(await kit.get('/api/setup/current-period', teacher).set(BRANCH_HEADER, branch)),
    );

    expect(period.demoNow).toBeNull();
  });
});
