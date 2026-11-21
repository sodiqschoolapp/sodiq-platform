import { sql } from 'kysely';
import type { NextFunction, Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemClock } from '../../clock/system-clock.js';
import { Transactions } from '../../database/transactions.js';
import { currentRequestContext, requestContextMiddleware } from '../../http/request-context.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { Audit } from '../audit/audit.service.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA';
const MOMENT = new Date('2026-11-21T09:00:00+05:00');

// Task 10.10 (db/migrations/0176; pull request #369): the minute counter of a key, which the
// application writes with the last use, and the key named on the audit entries of a request
// made through it, which stay append-only.
describe('requests through integration keys in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let audit: Audit;
  let accountId: string;
  let branch: string;
  let keyId: string;

  const codeOf = async (work: Promise<unknown>): Promise<string | undefined> => {
    try {
      await work;
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    }
  };

  /** Runs `work` inside a request context, as the middleware opens it for every request. */
  const inRequest = <T>(work: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const next: NextFunction = () => {
        work().then(resolve, reject);
      };
      requestContextMiddleware({} as Request, {} as Response, next);
    });

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new SystemClock());
    audit = new Audit(new SystemClock());
    branch = await insertBranch(database.migrator, 'North');
    const account = await database.migrator
      .insertInto('accounts')
      .values({
        login: 'k.requestova',
        password_hash: HASH,
        must_change_password: false,
        created_at: MOMENT,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    accountId = account.id;
    const key = await database.migrator
      .insertInto('integration_keys')
      .values({
        name: 'Physics platform',
        secret_hash: '0'.repeat(63) + '1',
        ends_on: '2026-12-31',
        ends_at: new Date('2026-12-31T19:00:00Z'),
        created_at: MOMENT,
        created_by: accountId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    keyId = key.id;
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('lets the application count a request and write the last use, never a negative count', async () => {
    await transactions.run([], (transaction) =>
      transaction
        .updateTable('integration_keys')
        .set({ minute_started_at: MOMENT, minute_requests: 1, last_used_at: MOMENT })
        .where('id', '=', keyId)
        .execute(),
    );
    const row = await database.migrator
      .selectFrom('integration_keys')
      .select(['minute_started_at', 'minute_requests', 'last_used_at'])
      .where('id', '=', keyId)
      .executeTakeFirstOrThrow();
    expect(row.minute_requests).toBe(1);
    expect(row.minute_started_at?.toISOString()).toBe(MOMENT.toISOString());
    expect(
      await codeOf(
        transactions.run([], (transaction) =>
          transaction
            .updateTable('integration_keys')
            .set({ minute_requests: -1 })
            .where('id', '=', keyId)
            .execute(),
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('names the key on every entry written in a request made through it, and on none outside it', async () => {
    const write = (action: `test.${string}`) =>
      transactions.run([branch], (transaction) =>
        audit.record(transaction, { branchId: branch, actorId: accountId, action }),
      );
    await inRequest(async () => {
      const store = currentRequestContext();
      if (store === undefined) throw new Error('The middleware opens a context.');
      store.integrationKey = { id: keyId, name: 'Physics platform' };
      await write('test.through_key');
      await transactions.run([], (transaction) =>
        audit.record(transaction, {
          branchId: null,
          actorId: accountId,
          action: 'test.school_through_key',
        }),
      );
    });
    await inRequest(() => write('test.in_a_session'));
    await write('test.in_a_job');
    const entries = await database.migrator
      .selectFrom('audit_log')
      .select(['action', 'integration_key_id'])
      .where('action', 'like', 'test.%')
      .orderBy('action')
      .execute();
    expect(entries).toEqual([
      { action: 'test.in_a_job', integration_key_id: null },
      { action: 'test.in_a_session', integration_key_id: null },
      { action: 'test.through_key', integration_key_id: keyId },
    ]);
    const school = await database.migrator
      .selectFrom('audit_log_school')
      .select('integration_key_id')
      .where('action', '=', 'test.school_through_key')
      .executeTakeFirstOrThrow();
    expect(school.integration_key_id).toBe(keyId);
  });

  it('keeps the key of an entry: the application cannot change or remove it', async () => {
    for (const statement of [
      sql`update audit_log set integration_key_id = null`,
      sql`delete from audit_log where integration_key_id is not null`,
      sql`update audit_log_school set integration_key_id = null`,
    ]) {
      expect(
        await codeOf(transactions.run([branch], (transaction) => statement.execute(transaction))),
      ).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });
});
