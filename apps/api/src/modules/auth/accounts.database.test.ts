import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA';
const TOKEN_HASH = 'a'.repeat(64);

// The rules of accounts and sessions that the database itself keeps
// (db/migrations/0005), also when the application has a fault.
describe('accounts and sessions in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let accountId: string;

  /** Runs one statement as the application user, in a school-wide transaction. */
  function asApp(statement: string): Promise<unknown> {
    return transactions.run([], (transaction) => sql.raw(statement).execute(transaction));
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app);
    const inserted = await transactions.run([], (transaction) =>
      transaction
        .insertInto('accounts')
        .values({
          login: 'a.karimov',
          password_hash: HASH,
          must_change_password: true,
          password_expires_at: new Date('2026-10-12T09:00:00+05:00'),
          created_at: new Date('2026-10-05T09:00:00+05:00'),
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    accountId = inserted.id;
    await transactions.run([], (transaction) =>
      transaction
        .insertInto('sessions')
        .values({
          account_id: accountId,
          token_hash: TOKEN_HASH,
          created_at: new Date('2026-10-05T09:00:00+05:00'),
        })
        .execute(),
    );
  });

  afterAll(async () => {
    await database.destroy();
  });

  // Edge cases, "Accounts and sign-in": logins are generated and never reused.
  describe('keep a login for ever', () => {
    it('refuse a second account with the same login', async () => {
      await expect(
        asApp(`insert into accounts (login, password_hash, must_change_password, created_at)
               values ('a.karimov', '${HASH}', false, '2026-10-05T09:00:00+05:00')`),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });

    it('refuse the application user a delete of an account', async () => {
      await expect(asApp('delete from accounts')).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
    });

    it('refuse the application user a change of a login', async () => {
      await expect(asApp(`update accounts set login = 'b.karimov'`)).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
    });

    it.each(['A.Karimov', 'karimov', 'a.karimov-2', 'а.каримов', 'a.'])(
      'refuse the login %s, which is not of the generated form',
      async (login) => {
        await expect(
          asApp(`insert into accounts (login, password_hash, must_change_password, created_at)
                 values ('${login}', '${HASH}', false, '2026-10-05T09:00:00+05:00')`),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      },
    );
  });

  // docs/spec/13-technology.md, Security: passwords stored with Argon2id.
  it('refuse a stored password that is not an Argon2id hash', async () => {
    await expect(asApp(`update accounts set password_hash = 'plain text'`)).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    });
  });

  // Edge cases, "Accounts and sign-in": first passwords are valid for 7 days.
  // A password that must be changed and has no end would stay valid for ever.
  describe('keep a forced change together with its end', () => {
    it('refuse a new account that must change its password and has no expiry', async () => {
      await expect(
        asApp(`insert into accounts (login, password_hash, must_change_password, created_at)
               values ('b.karimov', '${HASH}', true, '2026-10-05T09:00:00+05:00')`),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('refuse the application user to remove the expiry while the change is still due', async () => {
      await expect(
        asApp(`update accounts set password_expires_at = null where login = 'a.karimov'`),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('refuse the application user to set a forced change without an expiry', async () => {
      await asApp(
        `insert into accounts (login, password_hash, must_change_password, created_at)
         values ('c.karimov', '${HASH}', false, '2026-10-05T09:00:00+05:00')`,
      );

      await expect(
        asApp(`update accounts set must_change_password = true where login = 'c.karimov'`),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('accept a forced change that has an expiry', async () => {
      await asApp(
        `update accounts set must_change_password = true,
           password_expires_at = '2026-10-06T09:00:00+05:00' where login = 'c.karimov'`,
      );
    });
  });

  it('let the application user store a new password hash', async () => {
    await asApp(
      `update accounts set password_hash = '${HASH}', must_change_password = false,
         password_expires_at = null, password_changed_at = '2026-10-05T10:00:00+05:00'`,
    );
  });

  // docs/spec/13-technology.md, Security: sessions kept in the database.
  describe('keep a session as it was made', () => {
    it('refuse the application user a delete of a session', async () => {
      await expect(asApp('delete from sessions')).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
    });

    it.each([
      ['its token', `update sessions set token_hash = '${'b'.repeat(64)}'`],
      [
        'its account',
        `update sessions set account_id = '${'0'.repeat(8)}-0000-7000-8000-${'0'.repeat(12)}'`,
      ],
      ['its start', `update sessions set created_at = '2026-10-06T09:00:00+05:00'`],
    ])('refuse the application user a change of %s', async (_name, statement) => {
      await expect(asApp(statement)).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('refuse a second session with the same token', async () => {
      await expect(
        asApp(`insert into sessions (account_id, token_hash, created_at)
               values ('${accountId}', '${TOKEN_HASH}', '2026-10-05T09:00:00+05:00')`),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });

    it('refuse a token that is not stored as a SHA-256 hash', async () => {
      await expect(
        asApp(`insert into sessions (account_id, token_hash, created_at)
               values ('${accountId}', 'the-token-itself', '2026-10-05T09:00:00+05:00')`),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('refuse an end without a reason, and a reason that is not known', async () => {
      await expect(
        asApp(`update sessions set ended_at = '2026-10-05T10:00:00+05:00'`),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(
        asApp(`update sessions set ended_at = '2026-10-05T10:00:00+05:00', end_reason = 'other'`),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('let the application user end a session', async () => {
      await asApp(
        `update sessions set ended_at = '2026-10-05T10:00:00+05:00', end_reason = 'sign_out'`,
      );
    });
  });
});
