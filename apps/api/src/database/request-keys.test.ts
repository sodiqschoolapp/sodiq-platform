import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertBranch } from '../testing/branch-filter-sql.js';
import { FixedClock } from '../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { canonicalJson, RequestKeys } from './request-keys.js';
import { Transactions, type Transaction } from './transactions.js';

/** The refusal of a key that was used for something else: 409 with its own code. */
const KEY_REUSED = { code: 'request_key_reused', status: 409 };

const INSUFFICIENT_PRIVILEGE = '42501';

// docs/spec/edge-cases/developer-rules.md, "Repeat-safe actions": publish, close
// and every offline entry carry a key that makes a repeat harmless.
// docs/spec/14-quality-plan.md, Saving: a retry after a lost connection never
// doubles or loses an entry.
describe('request keys', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  const clock = new FixedClock('2026-10-05T23:59:00+05:00');
  const requestKeys = new RequestKeys(clock);

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app);
    await sql`create table scratch_entries (label text not null)`.execute(database.migrator);
    await sql`grant select, insert on scratch_entries to sodiq_app`.execute(database.migrator);
    // Listed nowhere: this table exists only in this test database.
  });

  afterAll(async () => {
    await database.destroy();
  });

  /** The change that must happen once: one row, and a count of how often it ran. */
  function entry(transaction: Transaction, label: string, runs: { count: number }) {
    return async () => {
      runs.count += 1;
      await sql`insert into scratch_entries (label) values (${label})`.execute(transaction);
      return { label, status: 'saved' };
    };
  }

  async function entries(label: string): Promise<number> {
    const found = await sql<{ rows: number }>`
      select count(*)::int as rows from scratch_entries where label = ${label}
    `.execute(database.migrator);
    return found.rows[0]?.rows ?? -1;
  }

  function send(key: string, label: string, runs: { count: number }, scope = 'journal.entry') {
    return transactions.run([], (transaction) =>
      requestKeys.runOnce(
        transaction,
        { key, scope, input: { label } },
        entry(transaction, label, runs),
      ),
    );
  }

  it('the first request does the work and stores the key with the moment of the clock', async () => {
    const key = randomUUID();
    const runs = { count: 0 };

    const first = await send(key, 'first', runs);

    expect(first).toEqual({ repeated: false, result: { label: 'first', status: 'saved' } });
    expect(runs.count).toBe(1);
    const stored = await database.app
      .selectFrom('request_keys')
      .selectAll()
      .where('key', '=', key)
      .executeTakeFirstOrThrow();
    expect(stored.scope).toBe('journal.entry');
    expect(stored.result).toEqual({ label: 'first', status: 'saved' });
    expect(stored.created_at.toISOString()).toBe('2026-10-05T18:59:00.000Z');
  });

  it('a repeated request with the same key changes nothing and gets the same answer', async () => {
    const key = randomUUID();
    const runs = { count: 0 };

    const first = await send(key, 'repeated', runs);
    const second = await send(key, 'repeated', runs);
    const third = await send(key, 'repeated', runs);

    expect(second).toEqual({ repeated: true, result: first.result });
    expect(third).toEqual({ repeated: true, result: first.result });
    expect(runs.count).toBe(1);
    expect(await entries('repeated')).toBe(1);
  });

  it('another key does the work again', async () => {
    const runs = { count: 0 };

    await send(randomUUID(), 'two keys', runs);
    await send(randomUUID(), 'two keys', runs);

    expect(await entries('two keys')).toBe(2);
  });

  it('a request that failed leaves no key, so the repeat does the work', async () => {
    const key = randomUUID();
    const runs = { count: 0 };

    await expect(
      transactions.run([], async (transaction) => {
        await requestKeys.runOnce(
          transaction,
          { key, scope: 'journal.entry', input: { label: 'retried' } },
          entry(transaction, 'retried', runs),
        );
        throw new Error('the connection was lost');
      }),
    ).rejects.toThrow('the connection was lost');
    expect(await entries('retried')).toBe(0);

    const second = await send(key, 'retried', runs);

    expect(second.repeated).toBe(false);
    expect(runs.count).toBe(2);
    expect(await entries('retried')).toBe(1);
  });

  it('a request whose work fails leaves no key either', async () => {
    const key = randomUUID();

    await expect(
      transactions.run([], (transaction) =>
        requestKeys.runOnce(transaction, { key, scope: 'journal.entry', input: {} }, () =>
          Promise.reject(new Error('refused by a rule')),
        ),
      ),
    ).rejects.toThrow('refused by a rule');

    const stored = await database.app
      .selectFrom('request_keys')
      .select('key')
      .where('key', '=', key)
      .execute();
    expect(stored).toEqual([]);
  });

  // An offline queue may send several entries in one request: one refused entry
  // must not stop the others, and must stay possible to send again.
  it('work that fails leaves no key and no change when the caller goes on and commits', async () => {
    const refusedKey = randomUUID();
    const runs = { count: 0 };

    await transactions.run([], async (transaction) => {
      await requestKeys.runOnce(
        transaction,
        { key: randomUUID(), scope: 'journal.entry', input: { label: 'batch kept' } },
        entry(transaction, 'batch kept', runs),
      );
      await expect(
        requestKeys.runOnce(
          transaction,
          { key: refusedKey, scope: 'journal.entry', input: { label: 'batch refused' } },
          async () => {
            await entry(transaction, 'batch refused', runs)();
            throw new Error('the lesson is locked');
          },
        ),
      ).rejects.toThrow('the lesson is locked');
    });

    expect(await entries('batch kept')).toBe(1);
    expect(await entries('batch refused')).toBe(0);
    const stored = await database.app
      .selectFrom('request_keys')
      .select('key')
      .where('key', '=', refusedKey)
      .execute();
    expect(stored).toEqual([]);

    // Later, with the same key, the entry is saved; it is not answered as "already done".
    const again = await send(refusedKey, 'batch refused', runs);
    expect(again.repeated).toBe(false);
    expect(await entries('batch refused')).toBe(1);
  });

  it('work that fails on a database error leaves the rest of the transaction usable', async () => {
    const key = randomUUID();

    await transactions.run([], async (transaction) => {
      await expect(
        requestKeys.runOnce(transaction, { key, scope: 'journal.entry', input: {} }, async () => {
          await sql`insert into scratch_entries (label) values (null)`.execute(transaction);
          return 'not reached';
        }),
      ).rejects.toMatchObject({ code: '23502' });
      await sql`insert into scratch_entries (label) values ('after the error')`.execute(
        transaction,
      );
    });

    expect(await entries('after the error')).toBe(1);
  });

  it('a key used again from inside its own work is a fault, not an empty answer', async () => {
    const request = { key: randomUUID(), scope: 'journal.entry', input: {} };

    await expect(
      transactions.run([], (transaction) =>
        requestKeys.runOnce(transaction, request, async () => {
          await requestKeys.runOnce(transaction, request, () => Promise.resolve('inner'));
          return 'outer';
        }),
      ),
    ).rejects.toThrow('before its work finished');
  });

  // docs/spec/edge-cases/system-behaviour.md: simultaneous actions.
  it('two requests with one key at the same moment do the work once', async () => {
    const key = randomUUID();
    const runs = { count: 0 };
    const slow = (transaction: Transaction) => async () => {
      const result = await entry(transaction, 'at once', runs)();
      await sql`select pg_sleep(0.3)`.execute(transaction);
      return result;
    };
    const request = () =>
      transactions.run([], (transaction) =>
        requestKeys.runOnce(
          transaction,
          { key, scope: 'journal.entry', input: { label: 'at once' } },
          slow(transaction),
        ),
      );

    const answers = await Promise.all([request(), request(), request()]);

    expect(runs.count).toBe(1);
    expect(await entries('at once')).toBe(1);
    expect(answers.filter((answer) => answer.repeated)).toHaveLength(2);
    expect(new Set(answers.map((answer) => JSON.stringify(answer.result))).size).toBe(1);
  });

  describe('a key that was used for something else', () => {
    it('is refused for another action', async () => {
      const key = randomUUID();
      const runs = { count: 0 };
      await send(key, 'other action', runs);

      await expect(send(key, 'other action', runs, 'timetable.publish')).rejects.toMatchObject(
        KEY_REUSED,
      );
      expect(runs.count).toBe(1);
    });

    it('is refused with other input', async () => {
      const key = randomUUID();
      const runs = { count: 0 };
      await send(key, 'input one', runs);

      await expect(send(key, 'input two', runs)).rejects.toMatchObject(KEY_REUSED);
      expect(runs.count).toBe(1);
      expect(await entries('input two')).toBe(0);
    });

    it('is refused for another branch, also when the input does not name the branch', async () => {
      const north = await insertBranch(database.migrator, 'North');
      const south = await insertBranch(database.migrator, 'South');
      const key = randomUUID();
      const runs = { count: 0 };
      const once = (branches: string[]) =>
        transactions.run(branches, (transaction) =>
          requestKeys.runOnce(
            transaction,
            { key, scope: 'journal.entry', input: { label: 'by branch' } },
            entry(transaction, 'by branch', runs),
          ),
        );
      await once([north]);

      await expect(once([south])).rejects.toMatchObject(KEY_REUSED);
      await expect(once([north, south])).rejects.toMatchObject(KEY_REUSED);
      await expect(once([])).rejects.toMatchObject(KEY_REUSED);
      expect(await once([north])).toMatchObject({ repeated: true });
      expect(runs.count).toBe(1);
    });

    it('is accepted when the same input arrives with its fields in another order', async () => {
      const key = randomUUID();
      const once = (input: Record<string, number>) =>
        transactions.run([], (transaction) =>
          requestKeys.runOnce(transaction, { key, scope: 'journal.entry', input }, () =>
            Promise.resolve('done'),
          ),
        );

      await once({ score: 7, total: 10 });

      expect(await once({ total: 10, score: 7 })).toEqual({ repeated: true, result: 'done' });
    });
  });

  it.each([
    ['a list', ['a', 'b']],
    ['a text', 'saved'],
    ['a number', 12],
    ['nothing', null],
    ['nested', { ids: ['a'], counts: { saved: 1 } }],
  ])('gives %s back as it was stored', async (_name, result) => {
    const key = randomUUID();
    const once = () =>
      transactions.run([], (transaction) =>
        requestKeys.runOnce(transaction, { key, scope: 'sample', input: null }, () =>
          Promise.resolve(result),
        ),
      );

    await once();

    expect(await once()).toEqual({ repeated: true, result });
  });

  describe('the application user', () => {
    it('cannot delete a key', async () => {
      await expect(database.app.deleteFrom('request_keys').execute()).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
    });

    it('cannot change a key, its action, its hash or its moment', async () => {
      for (const change of [
        { key: randomUUID() },
        { scope: 'other' },
        { request_hash: 'other' },
        { created_at: clock.now() },
      ]) {
        await expect(
          database.app.updateTable('request_keys').set(change).execute(),
        ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      }
    });

    it('cannot use a key twice past the helper: the database refuses', async () => {
      const key = randomUUID();
      const row = { key, scope: 'sample', request_hash: 'x', created_at: clock.now() };
      await database.app.insertInto('request_keys').values(row).execute();

      await expect(
        database.app.insertInto('request_keys').values(row).execute(),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
});

describe('canonicalJson', () => {
  it('does not depend on the order of the fields', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [1, 2] }, b: 1 }),
    );
  });

  it('keeps the order of a list', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('tells a text from a number and from nothing', () => {
    expect(new Set([canonicalJson('1'), canonicalJson(1), canonicalJson(null)]).size).toBe(3);
  });

  it('leaves out a field without a value, as JSON does', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});
