/** Injection token of the list of job definitions (`job-list.ts`). Tests replace it. */
export const JOB_DEFINITIONS_LIST = Symbol('JOB_DEFINITIONS_LIST');

/** Injection token of `JobQueueOptions`. Tests point it at their own database. */
export const JOB_QUEUE_OPTIONS = Symbol('JOB_QUEUE_OPTIONS');
