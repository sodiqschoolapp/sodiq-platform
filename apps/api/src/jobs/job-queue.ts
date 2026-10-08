import { Inject, Injectable, Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { reportFault } from '../reporting/reporting.js';
import type { JobDefinition } from './job-definition.js';
import { JOB_DEFINITIONS_LIST, JOB_QUEUE_OPTIONS } from './jobs.tokens.js';

/** The schema of db/migrations/0004. */
export const JOB_SCHEMA = 'pgboss';

export interface JobQueueOptions {
  /** The application user's address of the database. */
  connectionString: string;
  /** True in the worker: it fetches jobs and runs pg-boss's upkeep. The API only sends. */
  worker: boolean;
  /** How often the worker looks for jobs. Tests shorten it. */
  pollingIntervalSeconds?: number;
  /** Called for a fault inside pg-boss. Without it the fault is logged. */
  onError?: (error: Error) => void;
}

/** One log line for a fault that pg-boss reports: where, what kind, and its message. */
export function faultLine(fault: { name?: unknown; message?: unknown; queue?: unknown }): string {
  const queue = typeof fault.queue === 'string' ? `${fault.queue}: ` : '';
  const name = typeof fault.name === 'string' && fault.name !== '' ? fault.name : 'Error';
  const message = typeof fault.message === 'string' ? fault.message : 'no message';
  return `${queue}${name}: ${message}`;
}

/**
 * The one pg-boss instance of the process. It is not exported by the module:
 * business code sends through `Jobs.enqueue`, which needs the transaction of
 * the change, and handles through `JobRunner`.
 */
@Injectable()
export class JobQueue implements BeforeApplicationShutdown {
  private readonly logger = new Logger('Jobs');
  private starting: Promise<PgBoss> | undefined;

  constructor(
    @Inject(JOB_QUEUE_OPTIONS) readonly options: JobQueueOptions,
    @Inject(JOB_DEFINITIONS_LIST) private readonly definitions: readonly JobDefinition<unknown>[],
  ) {}

  /**
   * The started instance. It connects on the first call: `main.ts` and the
   * worker call it at start, so a missing or older schema stops them there.
   */
  ready(): Promise<PgBoss> {
    this.starting ??= this.start().catch((error: unknown) => {
      // The next call tries again instead of repeating this failure for ever.
      this.starting = undefined;
      throw error;
    });
    return this.starting;
  }

  private async start(): Promise<PgBoss> {
    const { worker } = this.options;
    const boss = new PgBoss({
      connectionString: this.options.connectionString,
      application_name: worker ? 'sodiq-worker-jobs' : 'sodiq-api-jobs',
      // Jobs are sent on the connection of the caller's transaction; this pool
      // serves the list of queues and, in the worker, fetching and finishing.
      max: worker ? 5 : 2,
      schema: JOB_SCHEMA,
      // The schema comes from a migration and belongs to the migration user;
      // the application user cannot create or change it (db/migrations/0004).
      migrate: false,
      createSchema: false,
      // Rebuilding an index needs the owner of the table.
      reindex: false,
      registerInstance: false,
      supervise: worker,
      // Scheduled jobs arrive with the nightly check (task 9.2c).
      schedule: false,
    });
    // pg-boss also emits plain objects: a fault while fetching has no name and
    // carries the queue it happened in.
    boss.on('error', (error: Error & { queue?: unknown }) => {
      if (this.options.onError === undefined) {
        // Name and message only, as for a fault of a request (docs/decisions.md).
        this.logger.error(faultLine(error));
        reportFault(error, { part: 'jobs' });
      } else {
        this.options.onError(error);
      }
    });
    try {
      await boss.start();
      for (const definition of this.definitions) {
        // An insert into the list of queues; a queue that exists is left alone.
        await boss.createQueue(definition.name, definition.options);
        if (definition.options !== undefined) {
          // The definition in the code is the source of the options.
          await boss.updateQueue(definition.name, definition.options);
        }
      }
    } catch (error) {
      // Also closes the connections of a start that failed half-way.
      await boss.stop({ graceful: false }).catch(() => undefined);
      throw error;
    }
    return boss;
  }

  /**
   * Before the database connection closes: no new job is fetched, and a job
   * that is running gets time to finish.
   */
  async beforeApplicationShutdown(): Promise<void> {
    if (this.starting === undefined) {
      return;
    }
    const boss = await this.starting.catch(() => undefined);
    this.starting = undefined;
    await boss?.stop({ graceful: true, timeout: 30_000 });
  }
}
