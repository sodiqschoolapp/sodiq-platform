import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA';
const NOBODY = '00000000-0000-7000-8000-000000000000';
const MOMENT = new Date('2026-10-08T09:00:00+05:00');
const LATER = new Date('2026-10-08T09:05:00+05:00');
const EARLIER = new Date('2026-10-08T08:55:00+05:00');

// The rules of notifications that the database itself keeps
// (db/migrations/0013), also when the application has a fault: a kind is
// written like one, a read mark is never before the notification, the person
// and the branch exist, and the application changes nothing but the read mark.
describe('notifications in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let accountId: string;
  let north: string;

  function asApp(statement: string): Promise<unknown> {
    return transactions.run([], (transaction) => sql.raw(statement).execute(transaction));
  }

  function insert(fields: {
    kind?: string;
    account?: string;
    branch?: string | null;
    readAt?: Date | null;
  }): Promise<{ id: string }> {
    return transactions.run([], (transaction) =>
      transaction
        .insertInto('notifications')
        .values({
          account_id: fields.account ?? accountId,
          branch_id: fields.branch ?? null,
          kind: fields.kind ?? 'sample.message',
          data: sql`'{"text": "A message."}'::jsonb`,
          created_at: MOMENT,
          read_at: fields.readAt ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app);
    north = await insertBranch(database.migrator, 'North');
    const inserted = await transactions.run([], (transaction) =>
      transaction
        .insertInto('accounts')
        .values({
          login: 'd.rahimova',
          password_hash: HASH,
          must_change_password: false,
          created_at: MOMENT,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    accountId = inserted.id;
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('take a kind', () => {
    it.each(['sample.message', 'timetable.changed', 'plan.window_opened', 'a.b.c_d'])(
      'written like %s',
      async (kind) => {
        await expect(insert({ kind })).resolves.toHaveProperty('id');
      },
    );

    it.each([
      '',
      'sample',
      'Sample.message',
      'sample.',
      '.message',
      'sample message',
      'sample.m-x',
    ])('and refuse "%s"', async (kind) => {
      await expect(insert({ kind })).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('and refuse one longer than 100 characters', async () => {
      const kind = `a.${'b'.repeat(99)}`;
      expect(kind.length).toBe(101);
      await expect(insert({ kind })).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(insert({ kind: kind.slice(0, 100) })).resolves.toHaveProperty('id');
    });
  });

  describe('take a read mark', () => {
    it('at or after the moment of the notification', async () => {
      await expect(insert({ readAt: MOMENT })).resolves.toHaveProperty('id');
      await expect(insert({ readAt: LATER })).resolves.toHaveProperty('id');
    });

    it('and refuse one before it', async () => {
      await expect(insert({ readAt: EARLIER })).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });

  it('name an account that exists, and a branch that exists or none', async () => {
    await expect(insert({ branch: north })).resolves.toHaveProperty('id');
    await expect(insert({ account: NOBODY })).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
    await expect(insert({ branch: NOBODY })).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
  });

  // Archive, do not delete: the application marks a notification read and nothing else.
  describe('are never changed or removed by the application, apart from the read mark', () => {
    it('let the application user mark one read', async () => {
      const { id } = await insert({});
      await expect(
        asApp(`update notifications set read_at = '${LATER.toISOString()}' where id = '${id}'`),
      ).resolves.toBeDefined();
    });

    it.each([
      ['the kind', `kind = 'other.kind'`],
      ['the data', `data = '{}'::jsonb`],
      ['the account', `account_id = '${NOBODY}'`],
      ['the branch', `branch_id = null`],
      ['the moment', `created_at = now()`],
    ])('refuse the application user to change %s', async (_name, assignment) => {
      await expect(asApp(`update notifications set ${assignment}`)).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
    });

    it('refuse the application user a delete', async () => {
      await expect(asApp('delete from notifications')).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
    });
  });
});
