import { passwordResetMailJob } from '../modules/auth/password-reset-mail.job.js';
import { branchExportJob } from '../modules/journal/journal-exports.service.js';
import { deliverNotificationsJob } from '../modules/notifications/deliver.job.js';
import { DAILY_JOBS } from '../modules/results/daily/daily-jobs.js';
import type { JobDefinition } from './job-definition.js';

/**
 * Every kind of job of the application. The API and the worker create a queue
 * for each at start; a job can only be enqueued for a definition listed here,
 * and the worker refuses to start while one has no handler.
 */
export const JOB_DEFINITIONS: readonly JobDefinition<unknown>[] = [
  deliverNotificationsJob,
  passwordResetMailJob,
  branchExportJob,
  // Task 9.2c: the schedule's tick and the daily work of each branch.
  ...DAILY_JOBS,
];
