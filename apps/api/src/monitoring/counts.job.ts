import { Injectable, type OnModuleInit } from '@nestjs/common';
import { schoolDateOf } from '@sodiq/shared';
import { z } from 'zod';
import { Transactions, transactionMoment } from '../database/transactions.js';
import { defineJob } from '../jobs/job-definition.js';
import { JobRunner } from '../jobs/job-runner.js';
import { branchCounts, failedJobs } from './counts.query.js';
import type { Point } from './influx.js';
import { Monitoring } from './monitoring.service.js';
import { MEASUREMENTS } from './series.js';

/**
 * Every minute (task 10.2a; owner, 28 October 2026: "The alerts the database knows … reach
 * Grafana as counts per branch, and an alert also fires when those counts stop arriving").
 * Sent by pg-boss's cron to the worker with no branch; reads each branch in a transaction of
 * that branch alone, as the daily tick does. Without Grafana it does nothing.
 */
export const countsJob = defineJob({
  name: 'monitoring.counts',
  data: z.strictObject({}),
  transaction: 'none',
  cron: '* * * * *',
  // A minute that is missed is not made up: the next one counts again.
  options: { retryLimit: 0, expireInSeconds: 120 },
});

@Injectable()
export class MonitoringCounts implements OnModuleInit {
  constructor(
    private readonly transactions: Transactions,
    private readonly monitoring: Monitoring,
    private readonly runner: JobRunner,
  ) {}

  onModuleInit(): void {
    this.runner.handleWithoutTransaction(countsJob, () => this.run());
  }

  async run(): Promise<void> {
    if (!this.monitoring.pushing) return;
    await this.monitoring.push(await this.points());
  }

  /** The points of this minute: per branch, the failed jobs, and that the counts arrived. */
  async points(): Promise<Point[]> {
    // `branches` and pg-boss's table are school-wide (no row filter): read in a transaction of no branch.
    const { branches, jobs, now } = await this.transactions.run([], async (transaction) => {
      const moment = await transactionMoment(transaction);
      return {
        now: moment,
        branches: await transaction
          .selectFrom('branches')
          .select(['id', 'time_zone'])
          .orderBy('id')
          .execute(),
        jobs: await failedJobs(transaction, moment),
      };
    });
    const at = now.getTime();
    const points: Point[] = [];
    for (const branch of branches) {
      const counts = await this.transactions.run([branch.id], (transaction) =>
        branchCounts(
          transaction,
          branch.id,
          branch.time_zone,
          now,
          schoolDateOf(now, branch.time_zone),
        ),
      );
      const fields: Record<string, number> = {
        refused_saves: counts.refusedSaves,
        failed_exports: counts.failedExports,
        check_differences: counts.checkDifferences,
        first_slot_lessons: counts.firstSlot.lessons,
        first_slot_marked: counts.firstSlot.marked,
        first_slot_baseline_lessons: counts.firstSlot.baselineLessons,
        first_slot_baseline_marked: counts.firstSlot.baselineMarked,
      };
      // A moment that does not exist yet is left out, never sent as 1970.
      if (counts.checkFinished !== null) fields.check_finished = counts.checkFinished;
      if (counts.dailyEnqueued !== null) fields.daily_enqueued = counts.dailyEnqueued;
      points.push({
        measurement: MEASUREMENTS.branch.name,
        tags: { branch: branch.id },
        fields,
        at,
      });
    }
    for (const job of jobs) {
      points.push({
        measurement: MEASUREMENTS.jobs.name,
        tags: { name: job.name, branch: job.branch },
        fields: { failed: job.failed },
        at,
      });
    }
    points.push({ measurement: MEASUREMENTS.counts.name, tags: {}, fields: { pushed: 1 }, at });
    return points;
  }
}
