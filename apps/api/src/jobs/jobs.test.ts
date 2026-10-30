import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestKeys } from '../database/request-keys.js';
import { Transactions, type Transaction } from '../database/transactions.js';
import { Audit } from '../modules/audit/audit.service.js';
import { insertBranch } from '../testing/branch-filter-sql.js';
import { FixedClock } from '../testing/fixed-clock.js';
import {
  createScratchNotes,
  handledCounts,
  sampleJob,
  storedJobs,
  waitForJob,
} from '../testing/sample-job.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { defineJob } from './job-definition.js';
import { faultLine, JobQueue } from './job-queue.js';
import { JobRunner, type JobHandler } from './job-runner.js';
import { Jobs } from './jobs.service.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const clock = new FixedClock('2026-10-05T23:59:00+05:00');

async function insertNote(transaction: Transaction, id: string, branchId: string): Promise<void> {
  await sql`insert into scratch_notes (id, branch_id) values (${id}, ${branchId})`.execute(
    transaction,
  );
}

// docs/spec/13-technology.md, Background jobs: a job is saved in the same
// transaction as the data change that caused it, so it cannot be lost.
// docs/spec/edge-cases/developer-rules.md, "Repeat-safe actions": jobs are
// written to an outbox table in the same transaction as the data.
describe('a job is enqueued in the transaction of its change', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let queue: JobQueue;
  let jobs: Jobs;
  let north: string;
  let south: string;
  const audit = new Audit(clock);
  const requestKeys = new RequestKeys(clock);
  const faults: Error[] = [];

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, clock);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    await createScratchNotes(database.migrator);
    // As the API: it sends and does not fetch.
    queue = new JobQueue(
      { connectionString: database.appUrl, worker: false, onError: (error) => faults.push(error) },
      [sampleJob],
    );
    jobs = new Jobs(queue, [sampleJob]);
  });

  afterAll(async () => {
    await queue.beforeApplicationShutdown();
    await database.destroy();
    expect(faults).toEqual([]);
  });

  async function auditCount(action: string): Promise<number> {
    const found = await sql<{ rows: number }>`
      select count(*)::int as rows from audit_log where action = ${action}
    `.execute(database.migrator);
    return found.rows[0]?.rows ?? -1;
  }

  it('leaves no job when the transaction rolls back', async () => {
    const noteId = randomUUID();

    await expect(
      transactions.run([north], async (transaction) => {
        await insertNote(transaction, noteId, north);
        await audit.record(transaction, {
          branchId: north,
          actorId: null,
          action: 'test.rolled-back',
        });
        await jobs.enqueue(transaction, sampleJob, { branchIds: [north], data: { noteId } });
        // The job was really written: the transaction itself sees it.
        const inside = await sql<{ rows: number }>`
          select count(*)::int as rows from pgboss.job
        `.execute(transaction);
        expect(inside.rows[0]?.rows).toBe(1);
        throw new Error('The change failed.');
      }),
    ).rejects.toThrow('The change failed.');

    expect(await storedJobs(database.migrator)).toEqual([]);
    expect(await handledCounts(database.migrator)).toEqual({});
    expect(await auditCount('test.rolled-back')).toBe(0);
  });

  it('commits the change, its audit entry and its job together, and not before', async () => {
    const noteId = randomUUID();

    const id = await transactions.run([north], async (transaction) => {
      await insertNote(transaction, noteId, north);
      await audit.record(transaction, { branchId: north, actorId: null, action: 'test.committed' });
      const jobId = await jobs.enqueue(transaction, sampleJob, {
        branchIds: [north],
        data: { noteId },
      });
      // Another connection, as the worker's would be, does not see it yet.
      expect(await storedJobs(database.migrator)).toEqual([]);
      return jobId;
    });

    expect(await storedJobs(database.migrator)).toMatchObject([
      { id, name: 'sample.note', state: 'created', data: { branchIds: [north], data: { noteId } } },
    ]);
    expect(await handledCounts(database.migrator)).toEqual({ [noteId]: 0 });
    expect(await auditCount('test.committed')).toBe(1);
  });

  it('leaves no job when the keyed work fails and the caller commits the rest', async () => {
    const before = await storedJobs(database.migrator);
    const kept = randomUUID();
    const undone = randomUUID();

    await transactions.run([north], async (transaction) => {
      await insertNote(transaction, kept, north);
      await requestKeys
        .runJobOnce(
          transaction,
          { key: randomUUID(), jobName: 'test.entry', input: {} },
          async () => {
            await insertNote(transaction, undone, north);
            await jobs.enqueue(transaction, sampleJob, {
              branchIds: [north],
              data: { noteId: undone },
            });
            throw new Error('The entry was refused.');
          },
        )
        .catch(() => undefined);
    });

    expect(await storedJobs(database.migrator)).toEqual(before);
    expect(Object.keys(await handledCounts(database.migrator))).toContain(kept);
    expect(Object.keys(await handledCounts(database.migrator))).not.toContain(undone);
  });

  describe('refuses', () => {
    let before: unknown[];

    beforeEach(async () => {
      before = await storedJobs(database.migrator);
    });

    async function expectRefused(
      enqueue: (transaction: Transaction) => Promise<unknown>,
      message: string,
    ): Promise<void> {
      await expect(transactions.run([north], enqueue)).rejects.toThrow(message);
      expect(await storedJobs(database.migrator)).toEqual(before);
    }

    it('a job whose definition is not in the list', async () => {
      const unlisted = defineJob({ name: 'sample.unlisted', data: z.strictObject({}) });

      await expectRefused(
        (transaction) => jobs.enqueue(transaction, unlisted, { branchIds: [north], data: {} }),
        'not in the list of job definitions',
      );
    });

    it.each([
      ['is not an id', { noteId: 'Invented Name' }],
      ['has a field the definition does not know', { noteId: randomUUID(), name: 'Invented' }],
    ])('data that %s, without repeating it', async (_name, data) => {
      await expectRefused(
        (transaction) =>
          jobs.enqueue(transaction, sampleJob, {
            branchIds: [north],
            data: data,
          }),
        'does not fit its definition',
      );
      await expect(
        transactions.run([north], (transaction) =>
          jobs.enqueue(transaction, sampleJob, {
            branchIds: [north],
            data: data,
          }),
        ),
      ).rejects.not.toThrow('Invented');
    });

    it('a branch that the transaction does not work for', async () => {
      await expectRefused(
        (transaction) =>
          jobs.enqueue(transaction, sampleJob, {
            branchIds: [north, south],
            data: { noteId: randomUUID() },
          }),
        'a branch that its transaction does not work for',
      );
    });

    it('a branch for a transaction that works for no branch', async () => {
      await expect(
        transactions.run([], (transaction) =>
          jobs.enqueue(transaction, sampleJob, {
            branchIds: [north],
            data: { noteId: randomUUID() },
          }),
        ),
      ).rejects.toThrow('a branch that its transaction does not work for');
      expect(await storedJobs(database.migrator)).toEqual(before);
    });

    it('a branch that is not a branch id', async () => {
      await expectRefused(
        (transaction) =>
          jobs.enqueue(transaction, sampleJob, {
            branchIds: ['every branch'],
            data: { noteId: randomUUID() },
          }),
        'not a branch id',
      );
    });
  });

  it('accepts a job for some of the branches of its transaction, and for none', async () => {
    const before = (await storedJobs(database.migrator)).length;

    await transactions.run([north, south], async (transaction) => {
      await jobs.enqueue(transaction, sampleJob, {
        branchIds: [south],
        data: { noteId: randomUUID() },
      });
      await jobs.enqueue(transaction, sampleJob, { branchIds: [], data: { noteId: randomUUID() } });
    });

    expect(await storedJobs(database.migrator)).toHaveLength(before + 2);
  });

  it('logs a fault of pg-boss with its queue, also when it has no name', () => {
    expect(faultLine({ message: 'The fetch failed.', queue: 'sample.note' })).toBe(
      'sample.note: Error: The fetch failed.',
    );
    expect(faultLine(new TypeError('The value is wrong.'))).toBe('TypeError: The value is wrong.');
  });

  it('refuses a job name that is not lower-case words joined by dots', () => {
    expect(() => defineJob({ name: 'Sample Note', data: z.strictObject({}) })).toThrow(
      'lower-case words',
    );
  });
});

// docs/spec/edge-cases/system-behaviour.md: "A background job fails half-way, or
// runs twice. Every job can be repeated safely."
// docs/spec/edge-cases/developer-rules.md, "Branch filter": background jobs
// carry the branch.
describe('the worker', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let queue: JobQueue;
  let jobs: Jobs;
  let runner: JobRunner;
  let north: string;
  let south: string;
  const faults: Error[] = [];

  /** Counts every note the handler's transaction can see. */
  const countVisible: JobHandler<{ noteId: string }> = async (transaction) => {
    await sql`update scratch_notes set handled = handled + 1`.execute(transaction);
  };
  let work: JobHandler<{ noteId: string }> = countVisible;

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, clock);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    await createScratchNotes(database.migrator);
    queue = new JobQueue(
      {
        connectionString: database.appUrl,
        worker: true,
        pollingIntervalSeconds: 0.5,
        onError: (error) => faults.push(error),
      },
      [sampleJob],
    );
    jobs = new Jobs(queue, [sampleJob]);
    runner = new JobRunner(queue, transactions, new RequestKeys(clock), [sampleJob]);
    runner.handle(sampleJob, (transaction, data, job) => work(transaction, data, job));
    await runner.start();
  });

  beforeEach(async () => {
    work = countVisible;
    await sql`delete from scratch_notes`.execute(database.migrator);
  });

  afterAll(async () => {
    await queue.beforeApplicationShutdown();
    await database.destroy();
    expect(faults).toEqual([]);
  });

  async function addNotes(): Promise<{ northNote: string; southNote: string }> {
    const northNote = randomUUID();
    const southNote = randomUUID();
    await transactions.run([north, south], async (transaction) => {
      await insertNote(transaction, northNote, north);
      await insertNote(transaction, southNote, south);
    });
    return { northNote, southNote };
  }

  function enqueue(branchIds: string[], noteId: string): Promise<string> {
    return transactions.run(branchIds, (transaction) =>
      jobs.enqueue(transaction, sampleJob, { branchIds, data: { noteId } }),
    );
  }

  it('runs the handler in a transaction that sees only the branches of the job', async () => {
    const { northNote, southNote } = await addNotes();

    const id = await enqueue([north], northNote);
    await waitForJob(database.migrator, id, 'completed');

    expect(await handledCounts(database.migrator)).toEqual({ [northNote]: 1, [southNote]: 0 });
  });

  it('undoes a run that fails half-way and runs the job again', async () => {
    const { northNote } = await addNotes();
    let runs = 0;
    work = async (transaction, data, job) => {
      runs += 1;
      await countVisible(transaction, data, job);
      if (runs === 1) {
        throw Object.assign(new Error('The first run failed.'), { detail: 'Invented Name' });
      }
    };

    const id = await enqueue([north], northNote);
    const finished = await waitForJob(database.migrator, id, 'completed');

    expect(runs).toBe(2);
    expect(finished.retry_count).toBe(1);
    // Written once: what the failed run wrote was rolled back.
    expect((await handledCounts(database.migrator))[northNote]).toBe(1);
  });

  it('stores only the name, message and stack of a failure', async () => {
    const { northNote } = await addNotes();
    work = () =>
      Promise.reject(Object.assign(new Error('The run failed.'), { detail: 'Invented Name' }));

    const id = await enqueue([north], northNote);
    const failed = await waitForJob(database.migrator, id, 'failed');

    expect(JSON.stringify(failed.output)).toContain('The run failed.');
    expect(JSON.stringify(failed.output)).not.toContain('Invented Name');
    expect((await handledCounts(database.migrator))[northNote]).toBe(0);
  });

  it('changes the data once when a job is delivered twice', async () => {
    const { northNote } = await addNotes();
    const delivery = {
      id: randomUUID(),
      data: { branchIds: [north], data: { noteId: northNote } },
    };

    await runner.deliver('sample.note', delivery);
    await runner.deliver('sample.note', delivery);

    expect((await handledCounts(database.migrator))[northNote]).toBe(1);
    const keys = await sql<{ scope: string }>`
      select scope from request_keys where key = ${delivery.id}
    `.execute(database.migrator);
    expect(keys.rows).toEqual([{ scope: 'job:sample.note' }]);
  });

  // The worker died after the handler's commit and before pg-boss marked the
  // job as completed: the queue hands the same job out again.
  it('changes nothing when the queue delivers a finished job again', async () => {
    const { northNote } = await addNotes();
    const id = await enqueue([north], northNote);
    await waitForJob(database.migrator, id, 'completed');

    await sql`
      update pgboss.job set state = 'created', started_on = null, completed_on = null
      where id = ${id}
    `.execute(database.migrator);
    await waitForJob(database.migrator, id, 'completed');

    expect((await handledCounts(database.migrator))[northNote]).toBe(1);
  });

  it('refuses a delivery whose data does not fit the definition', async () => {
    await expect(
      runner.deliver('sample.note', {
        id: randomUUID(),
        data: { branchIds: ['every branch'], data: { noteId: randomUUID() } },
      }),
    ).rejects.toThrow('does not fit its definition');
  });

  it('refuses a second handler for one definition', () => {
    expect(() => {
      runner.handle(sampleJob, countVisible);
    }).toThrow('already has a handler');
  });

  // Task 8.9 (decision 11): a job whose handler calls a store with no transaction open.
  describe('without a transaction of its own', () => {
    const outsideJob = defineJob({
      name: 'sample.outside',
      data: z.strictObject({ noteId: z.uuid() }),
      transaction: 'none',
    });

    it('claims the delivery first, runs the handler with no transaction open, and once', async () => {
      const { northNote } = await addNotes();
      const outside = new JobRunner(queue, transactions, new RequestKeys(clock), [
        sampleJob,
        outsideJob,
      ]);
      const seen: { branchIds: readonly string[]; open: number }[] = [];
      outside.handleWithoutTransaction(outsideJob, async (data, job) => {
        // No transaction of the application's is open while the handler runs: its own is.
        const open = await sql<{ open: number }>`
          select count(*)::int as open from pg_stat_activity
          where datname = current_database() and state like 'idle in transaction%'
        `.execute(database.migrator);
        seen.push({ branchIds: job.branchIds, open: open.rows[0]?.open ?? -1 });
        await transactions.run(job.branchIds, (transaction) =>
          sql`update scratch_notes set handled = handled + 1 where id = ${data.noteId}`.execute(
            transaction,
          ),
        );
      });
      const delivery = {
        id: randomUUID(),
        data: { branchIds: [north], data: { noteId: northNote } },
      };
      await outside.deliver('sample.outside', delivery);
      await outside.deliver('sample.outside', delivery);
      expect(seen).toEqual([{ branchIds: [north], open: 0 }]);
      expect((await handledCounts(database.migrator))[northNote]).toBe(1);
      const keys = await sql<{ scope: string }>`
        select scope from request_keys where key = ${delivery.id}
      `.execute(database.migrator);
      expect(keys.rows).toEqual([{ scope: 'job:sample.outside' }]);
    });

    it('takes each kind of handler only for its kind of definition', () => {
      const outside = new JobRunner(queue, transactions, new RequestKeys(clock), [
        sampleJob,
        outsideJob,
      ]);
      expect(() => {
        outside.handle(outsideJob, countVisible);
      }).toThrow('runs without a transaction');
      expect(() => {
        outside.handleWithoutTransaction(sampleJob, () => Promise.resolve());
      }).toThrow('runs in a transaction: use handle');
    });
  });

  it('does not start while a definition has no handler', async () => {
    const idle = new JobRunner(queue, transactions, new RequestKeys(clock), [sampleJob]);

    await expect(idle.start()).rejects.toThrow('These jobs have no handler: sample.note.');
  });

  // The upkeep of pg-boss (expired runs, old jobs, counts) runs as the
  // application user, with the rights of db/migrations/0004 and nothing more.
  it("runs the queue's upkeep with the rights of the application user", async () => {
    const boss = await queue.ready();

    await boss.supervise();

    expect(faults).toEqual([]);
  });
});

// The application user works with the queue and cannot change its schema.
describe('the job schema', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it.each([
    'create table pgboss.scratch_extra (id integer)',
    'drop table pgboss.job',
    'truncate pgboss.job_common',
    'alter table pgboss.job_common add column extra text',
    'delete from pgboss.version',
    'delete from pgboss.queue',
    'create schema scratch_schema',
  ])('refuses the application user: %s', async (statement) => {
    await expect(sql.raw(statement).execute(database.app)).rejects.toMatchObject({
      code: INSUFFICIENT_PRIVILEGE,
    });
  });

  // Each of the two needs a database of its own. They are made and dropped in
  // hooks, which have the time for it (60 s), not inside the test (30 s).
  describe('on another database', () => {
    let other: TestDatabase;
    let empty: TestDatabase;

    beforeAll(async () => {
      other = await createTestDatabase();
      empty = await createTestDatabase({ empty: true });
    });

    afterAll(async () => {
      await other.destroy();
      await empty.destroy();
    });

    // docs/decisions.md: package and schema must match.
    it('does not start on a schema of another pg-boss version', async () => {
      await sql`update pgboss.version set version = version - 1`.execute(other.migrator);
      const queue = new JobQueue({ connectionString: other.appUrl, worker: false }, []);
      try {
        await expect(queue.ready()).rejects.toThrow('pg-boss database requires migrations');
      } finally {
        await queue.beforeApplicationShutdown();
      }
    });

    it('does not start on a database without the schema', async () => {
      const queue = new JobQueue({ connectionString: empty.appUrl, worker: false }, []);
      try {
        await expect(queue.ready()).rejects.toThrow('pg-boss is not installed');
      } finally {
        await queue.beforeApplicationShutdown();
      }
    });
  });
});

describe('the crons of the worker', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('schedules every job with a cron except those left unscheduled (the browser tests)', async () => {
    const kept = defineJob({
      name: 'sample.kept_cron',
      data: z.strictObject({}),
      cron: '* * * * *',
    });
    const left = defineJob({
      name: 'sample.left_cron',
      data: z.strictObject({}),
      cron: '* * * * *',
    });
    const queue = new JobQueue(
      { connectionString: database.appUrl, worker: true, unscheduled: [left.name] },
      [kept, left],
    );
    await queue.ready();
    await queue.beforeApplicationShutdown();
    const scheduled = await sql<{
      name: string;
    }>`select name from pgboss.schedule order by name`.execute(database.migrator);
    expect(scheduled.rows.map((row) => row.name)).toEqual([kept.name]);
  });
});
