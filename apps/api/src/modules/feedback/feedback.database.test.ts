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

  // The Super Admin reads the table on the Feedback reports page (pull request #361) and marks a
  // report handled: the application may set the mark and nothing else of a report (0173).
  describe('are never changed or removed by the application, but for the handled mark', () => {
    it('refuse the application user an update of the text', async () => {
      await expect(asApp(`update feedback_reports set text = 'Changed.'`)).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
    });

    it('refuse the application user a delete', async () => {
      await expect(asApp('delete from feedback_reports')).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
    });

    // Read from the catalog for every column the table has, so a column added later, or a
    // grant widened to the table, fails here.
    it('give the application user an update of the two columns of the mark and of no other', async () => {
      const { rows } = await sql<{ column: string; updatable: boolean }>`
        select attname as column,
          has_column_privilege('sodiq_app', 'public.feedback_reports', attname, 'UPDATE') as updatable
        from pg_attribute
        where attrelid = 'public.feedback_reports'::regclass and attnum > 0 and not attisdropped
        order by attname
      `.execute(database.migrator);

      expect(rows.length).toBeGreaterThan(8);
      expect(rows.filter((row) => row.updatable).map((row) => row.column)).toEqual([
        'handled_at',
        'handled_by',
      ]);
      const table = await sql<{ updatable: boolean; deletable: boolean }>`
        select has_table_privilege('sodiq_app', 'public.feedback_reports', 'UPDATE') as updatable,
          has_table_privilege('sodiq_app', 'public.feedback_reports', 'DELETE') as deletable
      `.execute(database.migrator);
      expect(table.rows[0]).toEqual({ updatable: false, deletable: false });
    });

    it('let the application user set and clear the mark together', async () => {
      await insert('{teacher}', '/', 'To be handled.');
      await expect(
        asApp(
          `update feedback_reports set handled_at = '${MOMENT}', handled_by = '${accountId}' where text = 'To be handled.'`,
        ),
      ).resolves.toBeDefined();
      await expect(
        asApp(
          `update feedback_reports set handled_at = null, handled_by = null where text = 'To be handled.'`,
        ),
      ).resolves.toBeDefined();
    });

    it.each(['handled_at', 'handled_by'] as const)(
      'refuse one half of the mark alone: %s',
      async (column) => {
        await insert('{teacher}', '/', 'Half a mark.');
        const value = column === 'handled_at' ? MOMENT : accountId;
        await expect(
          asApp(`update feedback_reports set ${column} = '${value}' where text = 'Half a mark.'`),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      },
    );

    it('refuse a mark by an account that does not exist', async () => {
      await insert('{teacher}', '/', 'Nobody marks.');
      await expect(
        asApp(
          `update feedback_reports set handled_at = '${MOMENT}', handled_by = '${NOBODY}' where text = 'Nobody marks.'`,
        ),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    });
  });
});
