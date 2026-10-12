import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { SystemClock } from '../../clock/system-clock.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA';
const NOBODY = '00000000-0000-7000-8000-000000000000';
const START = '2026-10-05T09:00:00+05:00';
const LATER = '2026-10-05T10:00:00+05:00';

// The rules of trusted devices and the account lock that the database itself
// keeps (db/migrations/0008), also when the application has a fault.
describe('trusted devices and the account lock in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let accountId: string;
  let administratorId: string;
  let tokens = 0;

  /** Runs one statement as the application user, in a school-wide transaction. */
  function asApp(statement: string): Promise<unknown> {
    return transactions.run([], (transaction) => sql.raw(statement).execute(transaction));
  }

  /** A new session of the account; `columns` and `values` add to the ones every session has. */
  function insertSession(columns = '', values = ''): Promise<unknown> {
    tokens += 1;
    const token = tokens.toString(16).padStart(64, '0');
    return asApp(
      `insert into sessions (account_id, token_hash, created_at, last_used_at${columns})
       values ('${accountId}', '${token}', '${START}', '${START}'${values})`,
    );
  }

  async function newAccount(login: string): Promise<string> {
    const inserted = await transactions.run([], (transaction) =>
      transaction
        .insertInto('accounts')
        .values({
          login,
          password_hash: HASH,
          must_change_password: false,
          created_at: new Date(START),
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    return inserted.id;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new SystemClock());
    accountId = await newAccount('a.karimov');
    administratorId = await newAccount('b.tursunov');
  });

  afterAll(async () => {
    await database.destroy();
  });

  // Edge cases, "Accounts and sign-in": the switch is off by default.
  describe('keep the trust of a session', () => {
    it('make a session without trust unless the sign-in asked for it', async () => {
      await insertSession();

      const found = await sql<{ trust_requested: boolean; trusted_from: Date | null }>`
        select trust_requested, trusted_from from sessions
      `.execute(database.migrator);
      expect(found.rows).toEqual([{ trust_requested: false, trusted_from: null }]);
    });

    it('refuse trust on a session whose sign-in did not ask for it', async () => {
      await expect(insertSession(', trusted_from', `, '${START}'`)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await expect(asApp(`update sessions set trusted_from = '${LATER}'`)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
    });

    it('refuse an end of trust on a session whose sign-in did not ask for it', async () => {
      await expect(insertSession(', trust_ended_at', `, '${LATER}'`)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await expect(asApp(`update sessions set trust_ended_at = '${LATER}'`)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
    });

    // A session that changed the password before its trust began never gets it.
    it('accept an end of trust before it began, on a session that asked for it', async () => {
      await insertSession(', trust_requested, trust_ended_at', `, true, '${LATER}'`);
    });

    it('refuse the application user a change of what the sign-in asked for', async () => {
      await expect(asApp('update sessions set trust_requested = true')).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
    });

    it('let the application user begin and end the trust of a session that asked for it', async () => {
      await insertSession(', trust_requested', ', true');

      await asApp(
        `update sessions set trusted_from = '${START}'
         where trust_requested and trust_ended_at is null`,
      );
      await asApp(
        `update sessions set trust_ended_at = '${LATER}'
         where trust_requested and trust_ended_at is null`,
      );
    });
  });

  // The further ways a session ends: the longest life of 7 days, the account
  // lock, and the removal of a trusted device.
  describe('keep the reasons a session ends', () => {
    it.each(['expired', 'account_locked', 'trusted_device_removed'])(
      'accept the end reason %s',
      async (reason) => {
        await asApp(`update sessions set ended_at = '${LATER}', end_reason = '${reason}'`);
      },
    );

    it.each(['sign_out', 'password_change', 'idle', 'sign_out_everywhere', 'password_reset'])(
      'still accept the end reason %s',
      async (reason) => {
        await asApp(`update sessions set ended_at = '${LATER}', end_reason = '${reason}'`);
      },
    );

    it('still refuse a reason that is not known', async () => {
      await expect(
        asApp(`update sessions set ended_at = '${LATER}', end_reason = 'locked'`),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });

  // Edge cases, "Staff over time": "Lock now" is logged with a reason.
  describe('keep a lock together with who made it and why', () => {
    const unlock = `update accounts set locked_at = null, locked_by = null, lock_reason = null`;

    beforeEach(async () => {
      await asApp(unlock);
    });

    it.each([
      ['a moment alone', `locked_at = '${LATER}'`],
      ['a moment and who, without a reason', `locked_at = '${LATER}', locked_by = '%admin%'`],
      ['a moment and a reason, without who', `locked_at = '${LATER}', lock_reason = 'Dismissed.'`],
      ['who and a reason, without a moment', `locked_by = '%admin%', lock_reason = 'Dismissed.'`],
    ])('refuse %s', async (_name, columns) => {
      await expect(
        asApp(
          `update accounts set ${columns.replace('%admin%', administratorId)}
           where id = '${accountId}'`,
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it.each([
      ['an empty reason', ''],
      ['a reason of spaces', '   '],
      ['a reason of 501 characters', 'x'.repeat(501)],
    ])('refuse %s', async (_name, reason) => {
      await expect(
        asApp(
          `update accounts set locked_at = '${LATER}', locked_by = '${administratorId}',
             lock_reason = '${reason}' where id = '${accountId}'`,
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('refuse a lock by an account that does not exist', async () => {
      await expect(
        asApp(
          `update accounts set locked_at = '${LATER}', locked_by = '${NOBODY}',
             lock_reason = 'Dismissed.' where id = '${accountId}'`,
        ),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    });

    // Nobody locks their own account: the last way in would lock itself out.
    it('refuse a lock of an account by itself', async () => {
      await expect(
        asApp(
          `update accounts set locked_at = '${LATER}', locked_by = '${accountId}',
             lock_reason = 'Dismissed.' where id = '${accountId}'`,
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('accept a lock with its moment, who and a reason of 500 characters, and its removal', async () => {
      await asApp(
        `update accounts set locked_at = '${LATER}', locked_by = '${administratorId}',
           lock_reason = '${'x'.repeat(500)}' where id = '${accountId}'`,
      );
      await asApp(unlock);

      const found = await sql<{ locked: number }>`
        select count(*)::int as locked from accounts where locked_at is not null
      `.execute(database.migrator);
      expect(found.rows).toEqual([{ locked: 0 }]);
    });
  });
});
