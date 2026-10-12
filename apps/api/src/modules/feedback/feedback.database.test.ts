import { ROLES } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { SystemClock } from '../../clock/system-clock.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA';
const NOBODY = '00000000-0000-7000-8000-000000000000';
const MOMENT = '2026-10-05T09:00:00+05:00';

// The rules of feedback reports that the database itself keeps
// (db/migrations/0011), also when the application has a fault: the roles are
// roles, the page is a path without a query, the text is not empty and not
// endless, and a report is never changed or removed by the application.
describe('feedback reports in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let accountId: string;

  /** Runs one statement as the application user, in a school-wide transaction. */
  function asApp(statement: string): Promise<unknown> {
    return transactions.run([], (transaction) => sql.raw(statement).execute(transaction));
  }

  /** An insert as the application user; the text is plain letters. */
  function insert(
    roles: string,
    page: string,
    text: string,
    account = accountId,
  ): Promise<unknown> {
    return transactions.run([], (transaction) =>
      transaction
        .insertInto('feedback_reports')
        .values({
          account_id: account,
          roles: sql<string[]>`${roles}::text[]`,
          page,
          text,
          created_at: new Date(MOMENT),
        })
        .execute(),
    );
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new SystemClock());
    const inserted = await transactions.run([], (transaction) =>
      transaction
        .insertInto('accounts')
        .values({
          login: 'd.rahimova',
          password_hash: HASH,
          must_change_password: false,
          created_at: new Date(MOMENT),
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    accountId = inserted.id;
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('take the roles of the session', () => {
    it('with the same names as the code', async () => {
      const found = await sql<{ definition: string }>`
        select pg_get_constraintdef(oid) as definition from pg_constraint
        where conrelid = 'public.feedback_reports'::regclass
          and conname = 'feedback_reports_roles_check'
      `.execute(database.migrator);
      const names = [...(found.rows[0]?.definition ?? '').matchAll(/'([a-z_]+)'/g)].map(
        (match) => match[1],
      );

      expect(names.sort()).toEqual([...ROLES].sort());
    });

    it('accept no role at all, one role and every role', async () => {
      await expect(insert('{}', '/', 'No role.')).resolves.toBeDefined();
      await expect(insert('{teacher}', '/', 'One role.')).resolves.toBeDefined();
      await expect(insert(`{${ROLES.join(',')}}`, '/', 'Every role.')).resolves.toBeDefined();
    });

    it.each(['{accountant}', '{teacher,Teacher}', '{"super admin"}'])(
      'and refuse the roles %s',
      async (roles) => {
        await expect(insert(roles, '/', 'Text')).rejects.toMatchObject({ code: CHECK_VIOLATION });
      },
    );
  });

  // Decided by the owner: the page is the path without the query.
  describe('take the path of a page', () => {
    it('accept the root and a path of 500 characters', async () => {
      await expect(insert('{}', '/', 'Root.')).resolves.toBeDefined();
      await expect(insert('{}', `/${'a'.repeat(499)}`, 'Long.')).resolves.toBeDefined();
    });

    it.each(['/dev/patterns?q=x', '/dev/patterns#top', 'dev/patterns', '', `/${'a'.repeat(500)}`])(
      'and refuse the page "%s"',
      async (page) => {
        await expect(insert('{}', page, 'Text')).rejects.toMatchObject({ code: CHECK_VIOLATION });
      },
    );
  });

  describe('take a text of 1 to 2000 characters', () => {
    it('accept one letter and 2000', async () => {
      await expect(insert('{}', '/', 'x')).resolves.toBeDefined();
      await expect(insert('{}', '/', 'y'.repeat(2000))).resolves.toBeDefined();
    });

    it.each(['', '   ', 'z'.repeat(2001)])('and refuse the text "%s"', async (text) => {
      await expect(insert('{}', '/', text)).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });

  it('refuse an account that does not exist', async () => {
    await expect(insert('{}', '/', 'Text', NOBODY)).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
  });

  // The owner reads the table; the application only adds to it.
  describe('are never changed or removed by the application', () => {
    it('refuse the application user an update', async () => {
      await expect(asApp(`update feedback_reports set text = 'Changed.'`)).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
    });

    it('refuse the application user a delete', async () => {
      await expect(asApp('delete from feedback_reports')).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
    });
  });
});
