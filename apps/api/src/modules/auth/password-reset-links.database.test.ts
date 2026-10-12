import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemClock } from '../../clock/system-clock.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { staffIdOf } from '../people/staff-numbers.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const AT = new Date('2026-10-12T10:00:00+05:00');
const HOUR = 60 * 60 * 1000;
const HASH = (n: number) => n.toString(16).padStart(64, '0');

// The links of the password reset by email and the four functions of
// db/migrations/0031 (task 2.3c-2, pull request #66): one-time use held by
// the database (decision 11), and the reads without a branch (decision 3 and
// corrections 1 and 2 of the review), each about one account.
describe('password reset links in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let north: string;
  let south: string;
  let academic: string;
  let steam: string;
  let count = 0;

  const asApp = <T>(work: (transaction: Transaction) => Promise<T>) => transactions.run([], work);

  async function newAccount(): Promise<string> {
    count += 1;
    const row = await database.migrator
      .insertInto('accounts')
      .values({
        login: `n.tester${'abcdefghijklmnopqrstuvwxyz'.charAt(count % 26)}${'abcdefghijklmnopqrstuvwxyz'.charAt(Math.floor(count / 26))}`,
        password_hash: '$argon2id$v=19$m=19456,t=2,p=1$invented$invented',
        must_change_password: false,
        created_at: AT,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /** A person of a branch (main), linked to the account, with an email unless `null`. */
  async function personOf(
    accountId: string | null,
    options: { email?: string | null; branch?: string; status?: string } = {},
  ): Promise<string> {
    count += 1;
    const branch = options.branch ?? north;
    return database.migrator.transaction().execute(async (transaction) => {
      const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
      const id = found.rows[0]?.id ?? '';
      await transaction
        .insertInto('staff')
        .values({
          id,
          kind: 'person',
          staff_id: staffIdOf(2026, 7000 + count),
          first_name: 'Nilufar',
          last_name: 'Karimova',
          sex: 'female',
          birth_date: '1990-01-02',
          phone: `+9989300${String(count).padStart(5, '0')}`,
          email: options.email === undefined ? `n${String(count)}@example.test` : options.email,
          admission_date: '2026-09-01',
          account_id: accountId,
        })
        .execute();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: id, branch_id: branch, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({ staff_id: id, division_id: academic, department_id: steam, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: id, status: options.status ?? 'active', valid_from: '2026-09-01' })
        .execute();
      return id;
    });
  }

  const newLink = (accountId: string) =>
    asApp((transaction) =>
      transaction
        .insertInto('password_reset_links')
        .values({ account_id: accountId, requested_at: AT })
        .returning('id')
        .executeTakeFirstOrThrow(),
    ).then((row) => row.id);

  const update = (id: string, values: Record<string, unknown>, as: 'app' | 'migrator' = 'app') => {
    const work = (transaction: Transaction) =>
      transaction.updateTable('password_reset_links').set(values).where('id', '=', id).execute();
    return as === 'app' ? asApp(work) : database.migrator.transaction().execute(work);
  };

  const sent = (n: number) => ({
    token_hash: HASH(n),
    sent_at: AT,
    valid_until: new Date(AT.getTime() + HOUR),
  });

  const allowed = (accountId: string, at = AT) =>
    asApp(async (transaction) => {
      const found = await sql<{ allowed: boolean }>`
        select password_reset_allowed(${accountId}::uuid, ${at}::timestamptz) as allowed
      `.execute(transaction);
      return found.rows[0]?.allowed;
    });

  const address = (accountId: string) =>
    asApp(async (transaction) => {
      const found = await sql<{ email: string | null }>`
        select password_reset_address(${accountId}::uuid, ${AT}::timestamptz) as email
      `.execute(transaction);
      return found.rows[0]?.email ?? null;
    });

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new SystemClock());
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    const id = async (table: 'divisions' | 'departments', en: string) =>
      (
        await database.migrator
          .selectFrom(table)
          .select('id')
          .where('name_en', '=', en)
          .executeTakeFirstOrThrow()
      ).id;
    academic = await id('divisions', 'Academic');
    steam = await id('departments', 'STEAM');
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('the table', () => {
    it('takes a link, its sending and its use, each once', async () => {
      const link = await newLink(await newAccount());
      await update(link, sent(1));
      await update(link, { used_at: new Date(AT.getTime() + 1000) });
      const row = await database.migrator
        .selectFrom('password_reset_links')
        .selectAll()
        .where('id', '=', link)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({ token_hash: HASH(1), used_at: new Date(AT.getTime() + 1000) });
    });

    it('refuses a hash without its moments, an end before the sending, and a use outside the hour', async () => {
      const account = await newAccount();
      const partial = await newLink(account);
      await expect(update(partial, { token_hash: HASH(2) })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'password_reset_links_sent_check',
      });
      await expect(update(partial, { ...sent(3), valid_until: AT })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'password_reset_links_valid_check',
      });
      await update(partial, sent(4));
      await expect(
        update(partial, { used_at: new Date(AT.getTime() + HOUR) }),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'password_reset_links_used_check',
      });
      await expect(update(await newLink(account), { used_at: AT })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'password_reset_links_used_check',
      });
    });

    it('refuses a link that is both used and closed', async () => {
      const link = await newLink(await newAccount());
      await update(link, sent(5));
      await update(link, { used_at: AT });
      await expect(update(link, { closed_at: AT })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'password_reset_links_end_check',
      });
    });

    it('keeps each hash unique', async () => {
      const account = await newAccount();
      await update(await newLink(account), sent(6));
      await expect(update(await newLink(account), sent(6))).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'password_reset_links_token_hash_key',
      });
    });

    it.each(['app', 'migrator'] as const)(
      'never changes a value once it is set, as the %s',
      async (as) => {
        const link = await newLink(await newAccount());
        await update(link, sent(10 + (as === 'app' ? 0 : 1)));
        for (const values of [
          { token_hash: HASH(20) },
          { sent_at: new Date(AT.getTime() - 1000) },
          { valid_until: new Date(AT.getTime() + 2 * HOUR) },
        ]) {
          await expect(update(link, values, as)).rejects.toMatchObject({
            code: CHECK_VIOLATION,
            message: 'password_reset_links_set_once',
          });
        }
        await update(link, { used_at: AT }, as);
        await expect(update(link, { used_at: null }, as)).rejects.toMatchObject({
          message: 'password_reset_links_set_once',
        });
        const closed = await newLink(await newAccount());
        await update(closed, { closed_at: AT }, as);
        await expect(update(closed, { closed_at: null }, as)).rejects.toMatchObject({
          message: 'password_reset_links_set_once',
        });
        if (as === 'migrator') {
          await expect(
            update(closed, { requested_at: new Date(AT.getTime() + 1) }, as),
          ).rejects.toMatchObject({ message: 'password_reset_links_set_once' });
        }
      },
    );

    it('lets the application neither delete a link nor change its account or moment of request', async () => {
      const link = await newLink(await newAccount());
      await expect(
        asApp((transaction) =>
          transaction.deleteFrom('password_reset_links').where('id', '=', link).execute(),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await expect(update(link, { account_id: await newAccount() })).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
      await expect(update(link, { requested_at: AT })).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
    });
  });

  describe('the functions, read with no branch', () => {
    it('answer for a person with an email, while the row filter hides the record itself', async () => {
      const account = await newAccount();
      const id = await personOf(account, { email: 'nilufar.k@example.test', branch: south });
      expect(await allowed(account)).toBe(true);
      expect(await address(account)).toBe('nilufar.k@example.test');
      const own = await asApp(async (transaction) => {
        const found = await sql<{ staff_id: string; branch_id: string }>`
          select staff_id, branch_id from own_staff_record(${account}::uuid)
        `.execute(transaction);
        return found.rows;
      });
      expect(own).toEqual([{ staff_id: id, branch_id: south }]);
      const seen = await asApp((transaction) =>
        transaction.selectFrom('staff').select('email').where('id', '=', id).execute(),
      );
      expect(seen).toEqual([]);
    });

    it('answer no for a locked account, an inactive or left person, no email and no record', async () => {
      const locked = await newAccount();
      await personOf(locked);
      await database.migrator
        .updateTable('accounts')
        .set({ locked_at: AT, locked_by: await newAccount(), lock_reason: 'Laptop lost' })
        .where('id', '=', locked)
        .execute();
      const inactive = await newAccount();
      await personOf(inactive, { status: 'inactive' });
      const left = await newAccount();
      await personOf(left, { status: 'left' });
      const noEmail = await newAccount();
      await personOf(noEmail, { email: null });
      const noRecord = await newAccount();

      for (const account of [locked, inactive, left, noEmail, noRecord]) {
        expect(await allowed(account), account).toBe(false);
        expect(await address(account), account).toBeNull();
      }
      const none = await asApp(async (transaction) => {
        const found = await sql`select * from own_staff_record(${noRecord}::uuid)`.execute(
          transaction,
        );
        return found.rows;
      });
      expect(none).toEqual([]);
    });

    it('name the last email change of the record from the branch log, actor and moment only', async () => {
      const account = await newAccount();
      const actor = await newAccount();
      const id = await personOf(account);
      const entry = (occurredAt: Date, newValue: object) =>
        database.migrator
          .insertInto('audit_log')
          .values({
            occurred_at: occurredAt,
            branch_id: north,
            actor_id: actor,
            person_id: id,
            action: 'staff.edit',
            record_type: 'staff',
            record_id: id,
            new_value: JSON.stringify(newValue),
          })
          .execute();
      await entry(new Date(AT.getTime() - 2 * HOUR), { email: 'first@example.test' });
      await entry(new Date(AT.getTime() - HOUR), { email: 'second@example.test' });
      await entry(AT, { phone: '+998930000000' });

      const found = await asApp(async (transaction) => {
        const rows = await sql<{ actor_id: string; occurred_at: Date }>`
          select * from last_email_change(${account}::uuid)
        `.execute(transaction);
        return rows.rows;
      });
      expect(found).toEqual([{ actor_id: actor, occurred_at: new Date(AT.getTime() - HOUR) }]);
    });

    // The permission review of the build, must-fix 1.
    it('answer no for an account with a stronger role unless a Super Admin wrote the email last', async () => {
      const account = await newAccount();
      const id = await personOf(account);
      const admin = await newAccount();
      const vice = await newAccount();
      const role = (holder: string, name: string, branch: string | null) =>
        database.migrator
          .insertInto('assignments')
          .values({
            account_id: holder,
            role: name,
            branch_id: branch,
            valid_from: new Date(AT.getTime() - 24 * HOUR),
            created_at: new Date(AT.getTime() - 24 * HOUR),
          })
          .execute();
      await role(admin, 'super_admin', null);
      await role(vice, 'academic_vice_principal', north);
      const entry = (action: string, actor: string, at: Date) =>
        database.migrator
          .insertInto('audit_log')
          .values({
            occurred_at: at,
            branch_id: north,
            actor_id: actor,
            person_id: id,
            action,
            record_type: 'staff',
            record_id: id,
            new_value: JSON.stringify({ email: 'x@example.test' }),
          })
          .execute();

      // A teacher: the email's writer does not matter.
      await role(account, 'teacher', north);
      expect(await allowed(account)).toBe(true);
      // A stronger role and no known writer: no link.
      await role(account, 'principal', north);
      expect(await allowed(account)).toBe(false);
      // Written by a Super Admin at its creation: a link.
      await entry('staff.create', admin, new Date(AT.getTime() - 3 * HOUR));
      expect(await allowed(account)).toBe(true);
      expect(await address(account)).not.toBeNull();
      // Written last by an Academic Vice Principal: no link.
      await entry('staff.edit', vice, new Date(AT.getTime() - 2 * HOUR));
      expect(await allowed(account)).toBe(false);
      expect(await address(account)).toBeNull();
    });
  });
});
