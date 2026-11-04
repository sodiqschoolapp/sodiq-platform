import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'kysely';
import type { Clock } from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CLOCK } from './clock/clock.module.js';
import { SYSTEM_CLOCK } from './clock/demo-clock.js';
import { createDatabase } from './database/database.js';
import { DATABASE } from './database/database.module.js';
import { Transactions } from './database/transactions.js';
import { JOB_DEFINITIONS } from './jobs/job-list.js';
import type { JobQueueOptions } from './jobs/job-queue.js';
import { JobRunner } from './jobs/job-runner.js';
import { Jobs } from './jobs/jobs.service.js';
import { JOB_DEFINITIONS_LIST, JOB_QUEUE_OPTIONS } from './jobs/jobs.tokens.js';
import { insertBranch } from './testing/branch-filter-sql.js';
import { createScratchNotes, handledCounts, sampleJob, waitForJob } from './testing/sample-job.js';
import { FixedClock } from './testing/fixed-clock.js';
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
      // The sample job beside the real ones: the modules name their handlers at start.
      .overrideProvider(JOB_DEFINITIONS_LIST)
      .useValue([...JOB_DEFINITIONS, sampleJob])
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

  // Task 10.5: the worker refuses the demo clock outside the test environment, as the API does
  // (config.ts), and on the test environment reads its row before it takes a job (correction 2).
  describe('with the demo clock', () => {
    const start = (real?: Clock) => {
      // A connection of its own: closing the context closes it, not the outer worker's.
      const builder = Test.createTestingModule({ imports: [WorkerModule] })
        .overrideProvider(DATABASE)
        .useValue(createDatabase(database.appUrl));
      if (real !== undefined) builder.overrideProvider(SYSTEM_CLOCK).useValue(real);
      return builder.compile().then((moduleRef) => moduleRef.init());
    };

    it('refuses to start outside the test environment', async () => {
      vi.stubEnv('DEMO_CLOCK', '1');
      vi.stubEnv('SENTRY_ENVIRONMENT', 'production');
      try {
        await expect(start()).rejects.toThrow('DEMO_CLOCK must be 0 or 1');
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('shows demo time from its first moment on the test environment', async () => {
      const account = (
        await database.migrator
          .insertInto('accounts')
          .values({
            login: 'worker.demo',
            password_hash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA',
            must_change_password: false,
            created_at: new Date('2026-11-04T05:00:00Z'),
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      await database.migrator
        .insertInto('demo_clock')
        .values({
          id: true,
          offset_ms: String(86_400_000),
          previous_offset_ms: '0',
          effective_at: new Date('2026-11-04T05:00:00Z'),
          changed_at: new Date('2026-11-04T04:59:55Z'),
          changed_by: account,
        })
        .execute();
      vi.stubEnv('DEMO_CLOCK', '1');
      vi.stubEnv('SENTRY_ENVIRONMENT', 'test');
      const context = await start(new FixedClock('2026-11-04T10:00:00+05:00')).finally(() => {
        vi.unstubAllEnvs();
      });
      try {
        expect(context.get<Clock>(CLOCK).now().toISOString()).toBe('2026-11-05T05:00:00.000Z');
      } finally {
        await context.close();
        await database.migrator.deleteFrom('demo_clock').execute();
      }
    });
  });
});
