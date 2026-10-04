import { branchIdSchema } from '@sodiq/shared';
import { z } from 'zod';

/** How pg-boss treats the jobs of one queue. Left out: its defaults (2 retries, 15 minutes per run). */
export interface JobOptions {
  /** How often a failed job is tried again before it stays failed. */
  retryLimit?: number;
  /** Seconds between two tries. */
  retryDelay?: number;
  /** Doubles the delay with every try. */
  retryBackoff?: boolean;
  /** How long one run may take before it counts as failed. */
  expireInSeconds?: number;
}

/**
 * One kind of background job: its queue, what a job carries, and how failures
 * are treated. Every definition is listed in `job-list.ts`.
 */
export interface JobDefinition<Data> {
  /** The name of the queue, for example `notifications.deliver`. */
  name: string;
  /**
   * What a job carries besides its branches: ids only, never names, phones or
   * marks. The handler reads the rows again inside its own transaction.
   */
  data: z.ZodType<Data>;
  options?: JobOptions;
}

const JOB_NAME = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export function defineJob<Data>(definition: JobDefinition<Data>): JobDefinition<Data> {
  if (!JOB_NAME.test(definition.name)) {
    throw new Error(
      'A job name is lower-case words joined by dots, for example notifications.deliver.',
    );
  }
  return definition;
}

/** What is stored in the queue for one job. */
export interface JobEnvelope<Data> {
  /**
   * The branches the handler works for
   * (docs/spec/edge-cases/developer-rules.md, "Background jobs carry the branch").
   */
  branchIds: string[];
  data: Data;
}

export function envelopeSchema<Data>(definition: JobDefinition<Data>) {
  return z.strictObject({ branchIds: z.array(branchIdSchema), data: definition.data });
}
