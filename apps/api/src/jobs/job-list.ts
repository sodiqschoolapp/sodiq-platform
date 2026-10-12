import { passwordResetMailJob } from '../modules/auth/password-reset-mail.job.js';
import { deliverNotificationsJob } from '../modules/notifications/deliver.job.js';
import type { JobDefinition } from './job-definition.js';

/**
 * Every kind of job of the application. The API and the worker create a queue
 * for each at start; a job can only be enqueued for a definition listed here,
 * and the worker refuses to start while one has no handler.
 */
export const JOB_DEFINITIONS: readonly JobDefinition<unknown>[] = [
  deliverNotificationsJob,
  passwordResetMailJob,
];
