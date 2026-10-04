import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATABASE } from './database/database.module.js';
import { Transactions } from './database/transactions.js';
import type { JobQueueOptions } from './jobs/job-queue.js';
import { JobRunner } from './jobs/job-runner.js';
import { Jobs } from './jobs/jobs.service.js';
import { JOB_DEFINITIONS_LIST, JOB_QUEUE_OPTIONS } from './jobs/jobs.tokens.js';
import { insertBranch } from './testing/branch-filter-sql.js';
import { createScratchNotes, handledCounts, sampleJob, waitForJob } from './testing/sample-job.js';
import { createTestDatabase, type TestDatabase } from './testing/test-database.js';
import { WorkerModule } from './worker.module.js';

// The worker as src/worker.ts starts it: the application context without HTTP,
// connected as the application user, with a schema it may not migrate.
describe('the worker entry point', () => {
  let database: TestDatabase;
  let worker: INestApplicationContext;
  let north: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
    await createScratchNotes(database.migrator);
    const options: JobQueueOptions = {
      connectionString: database.appUrl,
      worker: true,
      pollingIntervalSeconds: 0.5,
    };
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(DATABASE)
      .useValue(database.app)
      .overrideProvider(JOB_QUEUE_OPTIONS)
      .useValue(options)
      .overrideProvider(JOB_DEFINITIONS_LIST)
      .useValue([sampleJob])
      .compile();
    worker = await moduleRef.init();
    worker.get(JobRunner).handle(sampleJob, async (transaction, data) => {
      await sql`update scratch_notes set handled = handled + 1 where id = ${data.noteId}`.execute(
        transaction,
      );
    });
    await worker.get(JobRunner).start();
  });

  afterAll(async () => {
    // Closing the worker stops the queue first and then the database connection.
    await worker.close();
    await database.destroy();
  });

  it('handles a job that a committed transaction enqueued', async () => {
    const noteId = randomUUID();
    const id = await worker.get(Transactions).run([north], async (transaction) => {
      await sql`insert into scratch_notes (id, branch_id) values (${noteId}, ${north})`.execute(
        transaction,
      );
      return worker.get(Jobs).enqueue(transaction, sampleJob, {
        branchIds: [north],
        data: { noteId },
      });
    });

    await waitForJob(database.migrator, id, 'completed');

    expect(await handledCounts(database.migrator)).toEqual({ [noteId]: 1 });
  });
});
