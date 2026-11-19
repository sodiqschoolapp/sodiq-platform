import type { INestApplication } from '@nestjs/common';
import {
  DAILY_LATE_MS,
  statusProvidersSchema,
  systemStatusSchema,
  WORKER_SILENT_MS,
  type SystemStatus,
} from '@sodiq/shared';
import { sql, type Transaction as KyselyTransaction } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../database/database.js';
import type { DB } from '../database/types.generated.js';
import { JobQueue } from '../jobs/job-queue.js';
import { insertBranch } from '../testing/branch-filter-sql.js';
import { createTestApp } from '../testing/create-test-app.js';
import { FixedClock } from '../testing/fixed-clock.js';
import { signInKit, type SignInKit } from '../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { countsJob, MonitoringCounts } from './counts.job.js';
import { Monitoring } from './monitoring.service.js';
import { nightlyCheckStatus } from './system-status.service.js';

// Pull request #361 (owner, 19 November 2026): the own checks of the System status page. The
// limits are those of the alert rules (`alert-rules.ts`): a check needs attention only past its
// limit, and with nothing to read yet it is unknown, as Grafana then has no value and fires
// nothing (plan decision 8). The clock stays at NOW: the fixtures are placed around it, and the
// Super Admin's 15 minutes without use never pass. All names are invented.

const NOW = '2026-11-19T10:00:00+05:00';
const NOW_MS = new Date(NOW).getTime();

const ok = (response: Response): unknown => {
  expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(200);
  return response.body;
};

/** Writes as the application would, at a moment. */
function asOf<T>(
  migrator: Database,
  moment: Date,
  work: (transaction: KyselyTransaction<DB>) => Promise<T>,
): Promise<T> {
  return migrator.transaction().execute(async (transaction) => {
    await sql`select set_config('app.now', ${moment.toISOString()}, true)`.execute(transaction);
    return work(transaction);
  });
}

describe('the own checks of the System status page', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let admin: string;
  let north: string;
  let hidden: string;
  const clock = new FixedClock(NOW);

  const read = async (): Promise<SystemStatus> =>
    systemStatusSchema.parse(ok(await kit.get('/api/system-status', admin)));

  const branchOf = (status: SystemStatus, id: string) => {
    const found = status.branches.find((branch) => branch.id === id);
    if (found === undefined) throw new Error(`No branch ${id} in the answer.`);
    return found;
  };

  /** A job row of pg-boss, completed or failed `msAgo` before NOW. */
  const job = (
    name: string,
    msAgo: number,
    state: 'completed' | 'failed',
    branchIds: string[] = [],
  ) =>
    sql`
      insert into pgboss.job (name, data, state, completed_on)
      values (${name}, ${JSON.stringify({ branchIds, data: {} })}::jsonb,
        ${state}::pgboss.job_state, ${new Date(NOW_MS - msAgo)})
    `.execute(database.migrator);

  const clearJobs = () => sql`delete from pgboss.job`.execute(database.migrator);

  /** A branch with a nightly check finished and daily work enqueued `msAgo` before NOW. */
  async function branchRunAgo(name: string, msAgo: number): Promise<string> {
    const branch = await insertBranch(database.migrator, name);
    const moment = new Date(NOW_MS - msAgo);
    const check = await asOf(database.migrator, moment, (transaction) =>
      transaction
        .insertInto('result_checks')
        .values({ branch_id: branch, day: '2026-11-18', started_at: moment })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    await asOf(database.migrator, moment, (transaction) =>
      transaction
        .updateTable('result_checks')
        .set({ summary: JSON.stringify({}) })
        .where('id', '=', check.id)
        .execute(),
    );
    await asOf(database.migrator, moment, (transaction) =>
      transaction
        .insertInto('scheduled_runs')
        .values({
          branch_id: branch,
          kind: 'plans.reminders',
          day: '2026-11-18',
          enqueued_at: moment,
        })
        .execute(),
    );
    return branch;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
    hidden = await insertBranch(database.migrator, 'Monitoring');
    await database.migrator
      .updateTable('branches')
      .set({ purpose: 'monitoring' })
      .where('id', '=', hidden)
      .execute();
    app = await createTestApp({ database: database.app, jobsDatabaseUrl: database.appUrl, clock });
    // The queues exist once the queue of the process has started.
    await app.get(JobQueue).ready();
    kit = signInKit(app);
    const browser = await kit.completeSession('Dilnoza', 'Karimova');
    await kit.giveRole(browser.account.id, { role: 'super_admin' });
    admin = browser.cookie;
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('says "unknown" where nothing ran yet, and needs no attention for it', async () => {
    await clearJobs();
    const status = await read();

    expect(status.checkedAt).toBe(new Date(NOW).toISOString());
    expect(status.worker).toEqual({ status: 'unknown', lastRunAt: null });
    expect(status.failedJobs).toEqual({ status: 'ok', jobs: [] });
    expect(branchOf(status, north)).toEqual({
      id: north,
      name: 'North',
      nightlyCheck: { status: 'unknown', finishedAt: null, differences: 0 },
      dailyWork: { status: 'unknown', enqueuedAt: null },
      failedExports: { status: 'ok', count: 0 },
      refusedSaves: 0,
    });
    expect(status.attention).toBe(0);
  });

  it('leaves the hidden Monitoring branch out', async () => {
    const status = await read();
    expect(status.branches.map((branch) => branch.id)).not.toContain(hidden);
    expect(status.branches.map((branch) => branch.id)).toContain(north);
  });

  it('reads the worker from its every-minute job: fine at exactly 10 minutes, attention 1 ms after', async () => {
    await clearJobs();
    await job(countsJob.name, WORKER_SILENT_MS, 'completed');
    expect((await read()).worker).toEqual({
      status: 'ok',
      lastRunAt: new Date(NOW_MS - WORKER_SILENT_MS).toISOString(),
    });

    await clearJobs();
    await job(countsJob.name, WORKER_SILENT_MS + 1, 'completed');
    const late = await read();
    expect(late.worker.status).toBe('attention');
    expect(late.attention).toBe(1);

    // A failed run of the job is not a run of the worker that completed.
    await clearJobs();
    await job(countsJob.name, 1000, 'failed');
    expect((await read()).worker.status).toBe('unknown');
  });

  // Review of the plan, correction 3: the job completes every minute whatever the push to Grafana
  // does, so the check reads the worker also where Grafana is not set up.
  it('reads a run of the job also without Grafana: its handler completes without pushing', async () => {
    expect(app.get(Monitoring).pushing).toBe(false);
    await expect(app.get(MonitoringCounts).run()).resolves.toBeUndefined();
    await clearJobs();
    await job(countsJob.name, 60_000, 'completed');
    expect((await read()).worker.status).toBe('ok');
  });

  it('lists the jobs failed in the last hour by name, leaving out the hidden branch', async () => {
    await clearJobs();
    await job(countsJob.name, 30_000, 'completed');
    await job('journal.branch_export', 10 * 60_000, 'failed', [north]);
    await job('journal.branch_export', 20 * 60_000, 'failed', [north]);
    await job('results.prepare_totals', 5 * 60_000, 'failed', [hidden]);
    // Outside the hour.
    await job('notifications.deliver', 61 * 60_000, 'failed', [north]);

    const status = await read();

    expect(status.failedJobs).toEqual({
      status: 'attention',
      jobs: [{ name: 'journal.branch_export', failed: 2 }],
    });
    expect(status.attention).toBe(1);
  });

  it('reads the nightly check and the daily work: fine at exactly 26 hours, attention 1 ms after', async () => {
    await clearJobs();
    await job(countsJob.name, 30_000, 'completed');
    const onTime = await branchRunAgo('On time', DAILY_LATE_MS);
    const late = await branchRunAgo('Late', DAILY_LATE_MS + 1);

    const status = await read();

    expect(branchOf(status, onTime)).toMatchObject({
      nightlyCheck: {
        status: 'ok',
        finishedAt: new Date(NOW_MS - DAILY_LATE_MS).toISOString(),
        differences: 0,
      },
      dailyWork: { status: 'ok', enqueuedAt: new Date(NOW_MS - DAILY_LATE_MS).toISOString() },
    });
    expect(branchOf(status, late)).toMatchObject({
      nightlyCheck: { status: 'attention' },
      dailyWork: { status: 'attention' },
    });
    // The two of the late branch; North has nothing yet (unknown).
    expect(status.attention).toBe(2);
  });

  it('counts the reports not handled yet', async () => {
    const account = await database.migrator
      .selectFrom('accounts')
      .select('id')
      .executeTakeFirstOrThrow();
    const report = (text: string, handled: boolean) =>
      database.migrator
        .insertInto('feedback_reports')
        .values({
          account_id: account.id,
          roles: [],
          page: '/',
          text,
          created_at: new Date(NOW),
          ...(handled ? { handled_at: new Date(NOW), handled_by: account.id } : {}),
        })
        .execute();
    await report('One.', false);
    await report('Two.', false);
    await report('Done.', true);

    expect((await read()).newFeedback).toBe(2);
  });

  it('answers the outside services as "not connected" without their keys', async () => {
    const providers = statusProvidersSchema.parse(
      ok(await kit.get('/api/system-status/providers', admin)),
    );
    expect(providers.uptimeRobot.state).toBe('not_connected');
    expect(providers.grafana.state).toBe('not_connected');
    expect(providers.sentry.state).toBe('not_connected');
  });
});

describe('the status of the nightly check', () => {
  const now = new Date(NOW);
  const ago = (ms: number) => new Date(NOW_MS - ms);

  it('needs attention for a difference found by a check on time', () => {
    expect(nightlyCheckStatus(ago(3_600_000), 0, now)).toBe('ok');
    expect(nightlyCheckStatus(ago(3_600_000), 2, now)).toBe('attention');
  });

  it('needs attention when late, with or without differences', () => {
    expect(nightlyCheckStatus(ago(DAILY_LATE_MS + 1), 0, now)).toBe('attention');
    expect(nightlyCheckStatus(ago(DAILY_LATE_MS + 1), 3, now)).toBe('attention');
  });

  it('is unknown before the first check', () => {
    expect(nightlyCheckStatus(null, 0, now)).toBe('unknown');
  });
});
