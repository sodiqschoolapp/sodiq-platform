import { Module, type OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { JobRunner } from '../../jobs/job-runner.js';
import { AccessModule } from '../access/access.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { ClosingController } from './closing.controller.js';
import { ClosingService } from './closing.service.js';
import {
  aboutToLockJob,
  checkMissedJob,
  closingOverdueJob,
  forcedDeletePurgeJob,
  planRemindersJob,
  resultCheckJob,
  scheduleTickJob,
} from './daily/daily-jobs.js';
import { dailyBranchOf, DailyWork } from './daily/daily.service.js';
import { EarlyWarningController } from './early-warning.controller.js';
import { BranchSummaryController } from './branch-summary.controller.js';
import { BranchSummaryService } from './branch-summary.service.js';
import { EarlyWarningService } from './early-warning.service.js';
import { RatingController } from './rating.controller.js';
import { RatingService } from './rating.service.js';
import { StudentResultsController } from './student-results.controller.js';
import { StudentResultsService } from './student-results.service.js';

/**
 * Results of students (task 9.1 on) and the rating (task 9.3a): read from the journal through `packages/calc`. Task 9.2c:
 * the schedule's tick and the daily work of each branch (`daily/`).
 */
@Module({
  imports: [AccessModule, NotificationsModule, PlansModule],
  controllers: [
    StudentResultsController,
    ClosingController,
    RatingController,
    EarlyWarningController,
    // Task 9.4b: the branch summary of the home page.
    BranchSummaryController,
  ],
  providers: [
    StudentResultsService,
    ClosingService,
    DailyWork,
    RatingService,
    EarlyWarningService,
    BranchSummaryService,
  ],
})
export class ResultsModule implements OnModuleInit {
  constructor(
    private readonly runner: JobRunner,
    private readonly daily: DailyWork,
  ) {}

  onModuleInit(): void {
    this.runner.handleWithoutTransaction(scheduleTickJob, () => this.daily.tick());
    this.runner.handleWithoutTransaction(resultCheckJob, (data, job) =>
      this.daily.check(data, job.branchIds),
    );
    // A daily job runs in a transaction of its one branch; the branch is the one of the job.
    const branchOf = async (transaction: Parameters<Parameters<JobRunner['handle']>[1]>[0]) => {
      const { rows } = await sql<{ ids: string[] }>`select app_branch_ids()::text[] as ids`.execute(
        transaction,
      );
      return dailyBranchOf(rows[0]?.ids ?? []);
    };
    this.runner.handle(checkMissedJob, async (transaction, data) =>
      this.daily.checkMissed(transaction, data, await branchOf(transaction)),
    );
    this.runner.handle(closingOverdueJob, async (transaction) =>
      this.daily.closingOverdue(transaction, await branchOf(transaction)),
    );
    this.runner.handle(planRemindersJob, async (transaction) =>
      this.daily.planReminders(transaction, await branchOf(transaction)),
    );
    this.runner.handle(aboutToLockJob, async (transaction) =>
      this.daily.aboutToLock(transaction, await branchOf(transaction)),
    );
    this.runner.handle(forcedDeletePurgeJob, async (transaction) =>
      this.daily.forcedDeletePurge(transaction, await branchOf(transaction)),
    );
  }
}
