import type { JobDefinition } from './job-definition.js';

/**
 * Every kind of job of the application. The API and the worker create a queue
 * for each at start; a job can only be enqueued for a definition listed here,
 * and the worker refuses to start while one has no handler.
 *
 * None yet: the first is the delivery of notifications (task 0.9).
 */
export const JOB_DEFINITIONS: readonly JobDefinition<unknown>[] = [];
