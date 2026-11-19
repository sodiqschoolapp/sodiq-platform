import { Inject, Injectable } from '@nestjs/common';
import {
  DAILY_LATE_MS,
  schoolDateOf,
  systemStatusSchema,
  WORKER_SILENT_MS,
  type CheckStatus,
  type Clock,
  type StatusProviders,
  type SystemStatus,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../clock/clock.module.js';
import { CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.js';
import { Transactions, transactionMoment, type Transaction } from '../database/transactions.js';
import type { Access } from '../modules/access/permission.guard.js';
import { countsJob } from './counts.job.js';
import { branchCounts, failedJobsByName } from './counts.query.js';
import { StatusProviderReader, type StatusFetch } from './status-providers.js';

/** For the tests: what the calls to the outside services go through instead of the network. */
export const STATUS_FETCH = Symbol('STATUS_FETCH');

/** `ok` up to the limit and at it, `attention` past it, `unknown` with nothing to read yet. */
export function ageStatus(moment: Date | null, now: Date, limitMs: number): CheckStatus {
  if (moment === null) return 'unknown';
  return now.getTime() - moment.getTime() > limitMs ? 'attention' : 'ok';
}

/** The nightly check: late as the daily work, and a difference it found needs attention too. */
export function nightlyCheckStatus(
  finished: Date | null,
  differences: number,
  now: Date,
): CheckStatus {
  const late = ageStatus(finished, now, DAILY_LATE_MS);
  return late === 'ok' && differences > 0 ? 'attention' : late;
}

/** The newest completed run of the every-minute job: the worker picks jobs and runs them. */
async function lastCountsRun(transaction: Transaction): Promise<Date | null> {
  const { rows } = await sql<{ newest: Date | null }>`
    select max(completed_on) as newest
    from pgboss.job
    where name = ${countsJob.name} and state = 'completed'
  `.execute(transaction);
  return rows[0]?.newest ?? null;
}

/**
 * The System status page of the Super Admin (pull request #361; owner, 19 November 2026). The
 * own checks are read from the database and answered at once; the outside services come from
 * `providers`, a second route, so a slow service never holds the page (`12`, speed targets).
 * The limits are those of the alert rules (`alert-rules.ts`), the hidden Monitoring branch left
 * out as in the counts pushed to Grafana (`counts.job.ts`).
 */
@Injectable()
export class SystemStatusReader {
  private readonly outside: StatusProviderReader;

  constructor(
    private readonly transactions: Transactions,
    @Inject(CLOCK) clock: Clock,
    @Inject(CONFIG) config: AppConfig,
    @Inject(STATUS_FETCH) fetcher: StatusFetch | undefined,
  ) {
    this.outside = new StatusProviderReader(config.statusProviders, clock, fetcher);
  }

  async own(access: Access): Promise<SystemStatus> {
    // `branches`, pg-boss's table and the reports are school-wide: read with no branch.
    const school = await this.transactions.run(access.branchIds, async (transaction) => {
      const now = await transactionMoment(transaction);
      const newFeedback = await transaction
        .selectFrom('feedback_reports')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('handled_at', 'is', null)
        .executeTakeFirst();
      const branches = await transaction
        .selectFrom('branches')
        .select(['id', 'name', 'time_zone', 'purpose'])
        .orderBy('name')
        .orderBy('id')
        .execute();
      return {
        now,
        branches,
        lastRun: await lastCountsRun(transaction),
        newFeedback: Number(newFeedback?.count ?? 0),
        jobs: await failedJobsByName(
          transaction,
          now,
          branches.filter((branch) => branch.purpose !== null).map((branch) => branch.id),
        ),
      };
    });
    const { now } = school;
    // The hidden Monitoring branch raises no alert of the school; its own check is in Grafana.
    const hidden = new Set(
      school.branches.filter((branch) => branch.purpose !== null).map((branch) => branch.id),
    );
    const jobs = school.jobs;

    const branches: SystemStatus['branches'] = [];
    for (const branch of school.branches) {
      if (hidden.has(branch.id)) continue;
      // Each branch in a transaction of that branch alone, as the counts job reads it.
      const counts = await this.transactions.run([branch.id], (transaction) =>
        branchCounts(
          transaction,
          branch.id,
          branch.time_zone,
          now,
          schoolDateOf(now, branch.time_zone),
          { firstSlot: false },
        ),
      );
      const finished = counts.checkFinished === null ? null : new Date(counts.checkFinished * 1000);
      const enqueued = counts.dailyEnqueued === null ? null : new Date(counts.dailyEnqueued * 1000);
      branches.push({
        id: branch.id,
        name: branch.name,
        nightlyCheck: {
          status: nightlyCheckStatus(finished, counts.checkDifferences, now),
          finishedAt: finished?.toISOString() ?? null,
          differences: counts.checkDifferences,
        },
        dailyWork: {
          status: ageStatus(enqueued, now, DAILY_LATE_MS),
          enqueuedAt: enqueued?.toISOString() ?? null,
        },
        failedExports: {
          status: counts.failedExports > 0 ? 'attention' : 'ok',
          count: counts.failedExports,
        },
        refusedSaves: counts.refusedSaves,
      });
    }

    const worker = {
      status: ageStatus(school.lastRun, now, WORKER_SILENT_MS),
      lastRunAt: school.lastRun?.toISOString() ?? null,
    };
    const failed = { status: jobs.length > 0 ? ('attention' as const) : ('ok' as const), jobs };
    const statuses: CheckStatus[] = [
      worker.status,
      failed.status,
      ...branches.flatMap((branch) => [
        branch.nightlyCheck.status,
        branch.dailyWork.status,
        branch.failedExports.status,
      ]),
    ];
    return systemStatusSchema.parse({
      checkedAt: now.toISOString(),
      attention: statuses.filter((status) => status === 'attention').length,
      worker,
      failedJobs: failed,
      newFeedback: school.newFeedback,
      branches,
    });
  }

  providers(): Promise<StatusProviders> {
    return this.outside.read();
  }
}
