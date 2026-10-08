import { Inject, Injectable, Logger } from '@nestjs/common';
import { RequestKeys } from '../database/request-keys.js';
import { Transactions, type Transaction } from '../database/transactions.js';
import { reportFault } from '../reporting/reporting.js';
import type { JsonValue } from '../database/types.generated.js';
import { envelopeSchema, type JobDefinition } from './job-definition.js';
import { JobQueue } from './job-queue.js';
import { JOB_DEFINITIONS_LIST } from './jobs.tokens.js';

/**
 * The work of one kind of job. It runs in a transaction that sees only the
 * branches of the job, and it decides from stored moments and the injected
 * clock, never from the fact that it was triggered: a job can run late.
 *
 * What it changes in the database happens once, however often the job is
 * delivered. Anything it sends outside the database is not covered by that.
 */
export type JobHandler<Data> = (
  transaction: Transaction,
  data: Data,
  job: { id: string },
) => Promise<void>;

/** One delivery of a job, as the queue hands it over. */
export interface Delivery {
  id: string;
  data: unknown;
}

/**
 * What the queue stores about a failed run: name, message and stack only. Other
 * fields of an error, for example the detail of a database error, can hold
 * values of a row.
 */
export class JobFailure extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'The job failed.');
    this.name = cause instanceof Error ? cause.name : 'JobFailure';
    if (cause instanceof Error && cause.stack !== undefined) {
      this.stack = cause.stack;
    }
  }
}

interface Registered {
  deliver: (delivery: Delivery) => Promise<void>;
}

/**
 * Runs the handlers (docs/spec/edge-cases/system-behaviour.md: "Every job can
 * be repeated safely"). Modules register their handlers in the API and in the
 * worker alike; only the worker calls `start`.
 */
@Injectable()
export class JobRunner {
  private readonly logger = new Logger('Jobs');
  private readonly handlers = new Map<string, Registered>();

  constructor(
    private readonly queue: JobQueue,
    private readonly transactions: Transactions,
    private readonly requestKeys: RequestKeys,
    @Inject(JOB_DEFINITIONS_LIST) private readonly definitions: readonly JobDefinition<unknown>[],
  ) {}

  /** Names the handler of a job definition. One handler per definition. */
  handle<Data>(definition: JobDefinition<Data>, handler: JobHandler<Data>): void {
    if (!this.definitions.includes(definition)) {
      throw new Error(`The job "${definition.name}" is not in the list of job definitions.`);
    }
    if (this.handlers.has(definition.name)) {
      throw new Error(`The job "${definition.name}" already has a handler.`);
    }
    this.handlers.set(definition.name, {
      deliver: (delivery) => this.run(definition, handler, delivery),
    });
  }

  /**
   * What the worker does with one delivery of a job. The job id is the request
   * key of the work (developer rules, "Repeat-safe actions"): the key is written
   * in the handler's transaction, so a job that is delivered again after its
   * work was committed changes nothing, and a job whose work failed left no key
   * and runs again.
   */
  async deliver(name: string, delivery: Delivery): Promise<void> {
    const registered = this.handlers.get(name);
    if (registered === undefined) {
      throw new Error(`The job "${name}" has no handler.`);
    }
    await registered.deliver(delivery);
  }

  private async run<Data>(
    definition: JobDefinition<Data>,
    handler: JobHandler<Data>,
    delivery: Delivery,
  ): Promise<void> {
    // Checked again: the row may have been written by an older version.
    const envelope = envelopeSchema(definition).safeParse(delivery.data);
    if (!envelope.success) {
      throw new Error(`The data of a "${definition.name}" job does not fit its definition.`);
    }
    const { branchIds } = envelope.data;
    const data = envelope.data.data;
    await this.transactions.run(branchIds, async (transaction) => {
      await this.requestKeys.runJobOnce<JsonValue>(
        transaction,
        // The stored envelope is JSON, so it is a JsonValue.
        { key: delivery.id, jobName: definition.name, input: delivery.data as JsonValue },
        async () => {
          await handler(transaction, data, { id: delivery.id });
          return null;
        },
      );
    });
  }

  /** Worker only: begins to fetch and run jobs. Every definition needs a handler first. */
  async start(): Promise<void> {
    const missing = this.definitions.filter((definition) => !this.handlers.has(definition.name));
    if (missing.length > 0) {
      const names = missing.map((definition) => definition.name).join(', ');
      throw new Error(`These jobs have no handler: ${names}.`);
    }
    const boss = await this.queue.ready();
    const { pollingIntervalSeconds } = this.queue.options;
    for (const definition of this.definitions) {
      const { name } = definition;
      await boss.work(
        name,
        pollingIntervalSeconds === undefined ? {} : { pollingIntervalSeconds },
        async (jobs) => {
          for (const job of jobs) {
            try {
              await this.deliver(name, { id: job.id, data: job.data });
            } catch (error) {
              const failure = new JobFailure(error);
              this.logger.error(`${name} ${job.id}: ${failure.name}: ${failure.message}`);
              reportFault(failure, { job: name });
              // pg-boss tries the job again, up to the limit of its definition.
              throw failure;
            }
          }
        },
      );
    }
  }
}
