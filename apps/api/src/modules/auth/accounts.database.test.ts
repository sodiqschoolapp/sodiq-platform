import { LANGUAGES, LOGIN_FORMAT, LOGIN_MAX_LENGTH } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { SystemClock } from '../../clock/system-clock.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
const FOREIGN_KEY_VIOLATION = '23503';

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
    transactions = new Transactions(database.app, new SystemClock());
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
          last_used_at: new Date('2026-10-05T09:00:00+05:00'),
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
      ['the name of its browser', `update sessions set user_agent = 'another browser'`],
    ])('refuse the application user a change of %s', async (_name, statement) => {
      await expect(asApp(statement)).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('refuse a second session with the same token', async () => {
      await expect(
        asApp(`insert into sessions (account_id, token_hash, created_at, last_used_at)
               values ('${accountId}', '${TOKEN_HASH}', '2026-10-05T09:00:00+05:00',
                 '2026-10-05T09:00:00+05:00')`),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });

    it('refuse a token that is not stored as a SHA-256 hash', async () => {
      await expect(
        asApp(`insert into sessions (account_id, token_hash, created_at, last_used_at)
               values ('${accountId}', 'the-token-itself', '2026-10-05T09:00:00+05:00',
                 '2026-10-05T09:00:00+05:00')`),
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

    // Task 0.6b (db/migrations/0006): the further ways a session ends.
    it.each(['idle', 'sign_out_everywhere', 'password_reset', 'password_change'])(
      'accept the end reason %s',
      async (reason) => {
        await asApp(
          `update sessions set ended_at = '2026-10-05T10:00:00+05:00', end_reason = '${reason}'`,
        );
      },
    );

    it('let the application user move the moment of the last use', async () => {
      await asApp(`update sessions set last_used_at = '2026-10-05T09:10:00+05:00'`);
    });

    it('refuse a session without a moment of the last use', async () => {
      await expect(
        asApp(`insert into sessions (account_id, token_hash, created_at)
               values ('${accountId}', '${'c'.repeat(64)}', '2026-10-05T09:00:00+05:00')`),
      ).rejects.toMatchObject({ code: NOT_NULL_VIOLATION });
    });

    // Asked for by the owner: the name of the browser is cut to 200 characters.
    it('refuse a browser name of 201 characters and accept one of 200', async () => {
      const insert = (token: string, length: number) =>
        asApp(`insert into sessions (account_id, token_hash, created_at, last_used_at, user_agent)
               values ('${accountId}', '${token.repeat(64)}', '2026-10-05T09:00:00+05:00',
                 '2026-10-05T09:00:00+05:00', '${'x'.repeat(length)}')`);

      await expect(insert('d', 201)).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await insert('e', 200);
    });
  });

  // Edge cases, "Accounts and sign-in": a reset is logged as "reset by X for Y".
  describe('keep a reset together with who made it', () => {
    it('refuse a reset moment without the account that reset, and the other way round', async () => {
      await expect(
        asApp(`update accounts set password_reset_at = '2026-10-05T10:00:00+05:00'`),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(
        asApp(`update accounts set password_reset_by = '${accountId}'`),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('accept both together, and refuse an account that does not exist', async () => {
      await asApp(
        `update accounts set password_reset_by = '${accountId}',
           password_reset_at = '2026-10-05T10:00:00+05:00' where login = 'c.karimov'`,
      );
      await expect(
        asApp(`update accounts set password_reset_at = '2026-10-05T10:00:00+05:00',
                 password_reset_by = '${'0'.repeat(8)}-0000-7000-8000-${'0'.repeat(12)}'`),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    });
  });

  // Edge cases, "Accounts and sign-in": attempts are limited per account and device.
  describe('keep the devices and the count of failed sign-ins', () => {
    it('let the application user add a known device, once', async () => {
      const insert = () =>
        asApp(`insert into known_devices (token_hash, account_id, first_signed_in_at)
               values ('${'f'.repeat(64)}', '${accountId}', '2026-10-05T09:00:00+05:00')`);

      await insert();
      await expect(insert()).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });

    it('refuse the application user a change or a delete of a known device', async () => {
      await expect(asApp('delete from known_devices')).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
      await expect(
        asApp(`update known_devices set first_signed_in_at = '2026-10-06T09:00:00+05:00'`),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('refuse a device token that is not stored as a SHA-256 hash', async () => {
      await expect(
        asApp(`insert into known_devices (token_hash, account_id, first_signed_in_at)
               values ('the-token-itself', '${accountId}', '2026-10-05T09:00:00+05:00')`),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it.each([
      ['a login that is not stored as a SHA-256 hash', 'a.karimov', 'unknown', 1],
      ['a device that is neither a token hash nor "unknown"', 'a'.repeat(64), 'my-phone', 1],
      ['a count below zero', 'a'.repeat(64), 'unknown', -1],
    ])('refuse a count with %s', async (_name, login, device, failures) => {
      await expect(
        asApp(`insert into sign_in_throttle (login_hash, device_key, failures, last_failure_at)
               values ('${login}', '${device}', ${String(failures)}, '2026-10-05T09:00:00+05:00')`),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('keep one count per login and device, which the application user may remove', async () => {
      const insert = () =>
        asApp(`insert into sign_in_throttle (login_hash, device_key, failures, last_failure_at)
               values ('${'a'.repeat(64)}', 'unknown', 1, '2026-10-05T09:00:00+05:00')`);

      await insert();
      await expect(insert()).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
      await asApp('delete from sign_in_throttle');
    });
  });

  // docs/spec/12-ux-standards.md, Language: the choice is remembered, on the
  // account (db/migrations/0012, task 0.8d). A new account is in Uzbek.
  describe('keep the language of an account', () => {
    it('as Uzbek when none is given', async () => {
      const found = await sql<{ language: string }>`
        select language from accounts where id = ${accountId}
      `.execute(database.migrator);

      expect(found.rows).toEqual([{ language: 'uz' }]);
    });

    it('with the same three languages as the code', async () => {
      const found = await sql<{ definition: string }>`
        select pg_get_constraintdef(oid) as definition from pg_constraint
        where conrelid = 'public.accounts'::regclass and conname = 'accounts_language_check'
      `.execute(database.migrator);
      const names = [...(found.rows[0]?.definition ?? '').matchAll(/'([a-z]+)'/g)].map(
        (match) => match[1],
      );

      expect(names.sort()).toEqual([...LANGUAGES].sort());
    });

    it.each(['de', 'UZ', 'uz-Latn', ''])('refuse the language "%s"', async (language) => {
      await expect(asApp(`update accounts set language = '${language}'`)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
    });

    it('refuse a missing language', async () => {
      await expect(asApp('update accounts set language = null')).rejects.toMatchObject({
        code: NOT_NULL_VIOLATION,
      });
    });

    it('let the application user change it', async () => {
      await asApp(`update accounts set language = 'ru' where id = '${accountId}'`);
      await asApp(`update accounts set language = 'uz' where id = '${accountId}'`);
    });

    // The migration adds `language` to the columns the application user may
    // change and nothing else; the login still cannot be changed.
    it('is the one column the migration lets the application user change', async () => {
      const found = await sql<{ column_name: string }>`
        select column_name from information_schema.column_privileges
        where grantee = 'sodiq_app' and table_schema = 'public' and table_name = 'accounts'
          and privilege_type = 'UPDATE'
        order by column_name
      `.execute(database.migrator);

      expect(found.rows.map((row) => row.column_name)).toEqual([
        'language',
        'lock_reason',
        'locked_at',
        'locked_by',
        'must_change_password',
        'password_changed_at',
        'password_expires_at',
        'password_hash',
        'password_reset_at',
        'password_reset_by',
      ]);
    });
  });

  // The owner's answer 14 and decision 2 of pull request #62 (db/migrations/
  // 0027): the forms the database accepts are those of `LOGIN_FORMAT`.
  describe('keep the login forms of the code', () => {
    const insert = (login: string) =>
      asApp(
        `insert into accounts (login, password_hash, must_change_password, created_at)
         values ('${login}', '${HASH}', false, '2026-10-05T09:00:00+05:00')`,
      );

    it.each([
      'b.forms',
      'bekzod.forms',
      'bekzod.t.forms',
      'bekzod.forms2',
      `b.${'f'.repeat(LOGIN_MAX_LENGTH - 2)}`,
    ])('accept %s', async (login) => {
      expect(LOGIN_FORMAT.test(login)).toBe(true);
      await insert(login);
    });

    it.each([
      'forms',
      'b.forms.',
      'b..forms',
      'b.t.u.forms',
      'B.forms',
      'b.2forms',
      `b.${'f'.repeat(LOGIN_MAX_LENGTH - 1)}`,
    ])('refuse %s', async (login) => {
      expect(LOGIN_FORMAT.test(login) && login.length <= LOGIN_MAX_LENGTH).toBe(false);
      await expect(insert(login)).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });
});
