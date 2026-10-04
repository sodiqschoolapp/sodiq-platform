import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { Assignments } from '../access/assignments.service.js';
import { Audit } from '../audit/audit.service.js';
import { Accounts, FIRST_PASSWORD_LENGTH } from './accounts.service.js';
import { FirstAccount, SuperAdminExistsError } from './first-account.service.js';
import { LoginNameError } from './login.js';
import { verifyPassword } from './password-hash.js';

interface AuditRow {
  actor_id: string | null;
  record_type: string | null;
  record_id: string | null;
  new_value: unknown;
  details: unknown;
  occurred_at: Date;
}

// All names are invented.
describe('accounts', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  const clock = new FixedClock('2026-10-05T09:00:00+05:00');
  const accounts = new Accounts(clock, new Audit(clock));

  const create = (firstName: string, lastName: string, createdBy: string | null = null) =>
    transactions.run([], (transaction) =>
      accounts.create(transaction, { firstName, lastName, createdBy }),
    );

  async function auditOf(action: string, recordId: string): Promise<AuditRow[]> {
    const found = await sql<AuditRow>`
      select actor_id, record_type, record_id, new_value, details, occurred_at
      from audit_log_school where action = ${action} and record_id = ${recordId}
    `.execute(database.migrator);
    return found.rows;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app);
  });

  afterAll(async () => {
    await database.destroy();
  });

  // Edge cases, "Accounts and sign-in": logins are generated and never reused.
  describe('get a generated login', () => {
    it('gives the first holder of a name the plain login and later holders a number', async () => {
      const first = await create('Aziz', 'Karimov');
      const second = await create('Anvar', 'Karimov');
      const third = await create('Alisher', 'Karimov');

      expect([first.login, second.login, third.login]).toEqual([
        'a.karimov',
        'a.karimov2',
        'a.karimov3',
      ]);
    });

    it('does not mix up a name that only begins like another', async () => {
      const longer = await create('Aziz', 'Karimovich');
      const dotted = await create('Aziz', 'Xkarimov');

      expect(longer.login).toBe('a.karimovich');
      expect(dotted.login).toBe('a.xkarimov');
    });

    it('gives two accounts created at the same moment different logins', async () => {
      const created = await Promise.all(
        Array.from({ length: 4 }, () => create('Bobur', 'Tursunov')),
      );

      expect(created.map((account) => account.login).sort()).toEqual([
        'b.tursunov',
        'b.tursunov2',
        'b.tursunov3',
        'b.tursunov4',
      ]);
    });

    it('refuses a name that gives no login, and creates nothing', async () => {
      const count = async (): Promise<number> =>
        (
          await sql<{ rows: number }>`select count(*)::int as rows from accounts`.execute(
            database.migrator,
          )
        ).rows[0]?.rows ?? -1;
      const before = await count();

      await expect(create('Азиз', 'Каримов')).rejects.toBeInstanceOf(LoginNameError);

      expect(await count()).toBe(before);
    });
  });

  // Edge cases, "Accounts and sign-in": first passwords are random, valid for
  // 7 days, and not stored.
  describe('get a first password', () => {
    it('that is random, hashed with Argon2id, to be changed, and valid for 7 days', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const first = await create('Dilnoza', 'Yusupova');
      const second = await create('Davron', 'Yusupov');

      expect(first.firstPassword).toHaveLength(FIRST_PASSWORD_LENGTH);
      expect(first.firstPassword).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9]+$/);
      expect(second.firstPassword).not.toBe(first.firstPassword);

      const stored = await sql<{
        password_hash: string;
        must_change_password: boolean;
        password_expires_at: Date;
        password_changed_at: Date | null;
        created_at: Date;
        created_by: string | null;
      }>`select * from accounts where id = ${first.id}`.execute(database.migrator);
      const row = stored.rows[0];
      expect(row).toMatchObject({
        must_change_password: true,
        password_changed_at: null,
        created_by: null,
        created_at: new Date('2026-10-05T09:00:00+05:00'),
        password_expires_at: new Date('2026-10-12T09:00:00+05:00'),
      });
      expect(await verifyPassword(row?.password_hash ?? '', first.firstPassword)).toBe(true);
    });

    it('that appears in no column and no audit entry', async () => {
      const created = await create('Eldor', 'Rashidov');

      const account = await sql<{ text: string }>`
        select to_jsonb(a)::text as text from accounts a where id = ${created.id}
      `.execute(database.migrator);
      const audit = await sql<{ text: string }>`
        select to_jsonb(l)::text as text from audit_log_school l where record_id = ${created.id}
      `.execute(database.migrator);

      expect(audit.rows).toHaveLength(1);
      for (const row of [...account.rows, ...audit.rows]) {
        expect(row.text).not.toContain(created.firstPassword);
      }
    });
  });

  // docs/spec/02-roles-and-access.md, Rules: every change is written to the audit log.
  describe('are audited', () => {
    it('with the creator, the new account and its login, at the moment of the clock', async () => {
      clock.set('2026-10-06T10:30:00+05:00');
      const creator = await create('Farida', 'Nazarova');
      const created = await create('Gulnora', 'Saidova', creator.id);

      expect(await auditOf('account.create', created.id)).toEqual([
        {
          actor_id: creator.id,
          record_type: 'account',
          record_id: created.id,
          new_value: { login: 'g.saidova' },
          details: null,
          occurred_at: new Date('2026-10-06T10:30:00+05:00'),
        },
      ]);
    });

    it('leave no entry and no account when the transaction rolls back', async () => {
      let id = '';
      await expect(
        transactions.run([], async (transaction) => {
          const created = await accounts.create(transaction, {
            firstName: 'Husan',
            lastName: 'Qodirov',
            createdBy: null,
          });
          id = created.id;
          throw new Error('rolled back by the test');
        }),
      ).rejects.toThrow('rolled back by the test');

      expect(await auditOf('account.create', id)).toEqual([]);
      const found = await sql`select 1 from accounts where login = 'h.qodirov'`.execute(
        database.migrator,
      );
      expect(found.rows).toEqual([]);
    });
  });
});

// Edge cases, "Accounts and sign-in": the first Super Admin is created by a
// one-time command on the server, which is logged.
describe('the first-account command', () => {
  let database: TestDatabase;
  let firstAccount: FirstAccount;
  const clock = new FixedClock('2026-10-05T09:00:00+05:00');

  const accountRows = async (): Promise<number> =>
    (
      await sql<{ rows: number }>`select count(*)::int as rows from accounts`.execute(
        database.migrator,
      )
    ).rows[0]?.rows ?? -1;

  beforeAll(async () => {
    database = await createTestDatabase();
    const transactions = new Transactions(database.app);
    const audit = new Audit(clock);
    firstAccount = new FirstAccount(
      transactions,
      new Accounts(clock, audit),
      new Assignments(clock, audit),
      clock,
    );
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('refuses a name that gives no login, and creates nothing', async () => {
    await expect(firstAccount.create('Илхом', 'Кодиров')).rejects.toBeInstanceOf(LoginNameError);
    await expect(firstAccount.create('', 'Qodirov')).rejects.toBeInstanceOf(LoginNameError);

    expect(await accountRows()).toBe(0);
  });

  it('creates exactly one account when it is run twice at the same moment', async () => {
    const runs = await Promise.allSettled([
      firstAccount.create('Ilhom', 'Qodirov'),
      firstAccount.create('Ilhom', 'Qodirov'),
    ]);

    expect(runs.map((run) => run.status).sort()).toEqual(['fulfilled', 'rejected']);
    const refused = runs.find((run) => run.status === 'rejected');
    expect(refused?.reason).toBeInstanceOf(SuperAdminExistsError);
    expect(await accountRows()).toBe(1);
  });

  it('is logged without an actor, naming the command', async () => {
    const found = await sql<{ actor_id: string | null; new_value: unknown; details: unknown }>`
      select actor_id, new_value, details from audit_log_school where action = 'account.create'
    `.execute(database.migrator);

    expect(found.rows).toEqual([
      { actor_id: null, new_value: { login: 'i.qodirov' }, details: { command: 'first-account' } },
    ]);
  });

  it('makes the account the Super Admin, logged without an actor, naming the command', async () => {
    const assignments = await sql<{
      login: string;
      role: string;
      branch_id: string | null;
      valid_from: Date;
      valid_until: Date | null;
      given_by: string | null;
    }>`
      select a.login, s.role, s.branch_id, s.valid_from, s.valid_until, s.given_by
      from assignments s join accounts a on a.id = s.account_id
    `.execute(database.migrator);
    const entries = await sql<{ actor_id: string | null; new_value: unknown; details: unknown }>`
      select actor_id, new_value, details from audit_log_school where action = 'assignment.given'
    `.execute(database.migrator);

    expect(assignments.rows).toEqual([
      {
        login: 'i.qodirov',
        role: 'super_admin',
        branch_id: null,
        valid_from: new Date('2026-10-05T09:00:00+05:00'),
        valid_until: null,
        given_by: null,
      },
    ]);
    expect(entries.rows).toMatchObject([
      {
        actor_id: null,
        new_value: { role: 'super_admin', branchId: null, validFrom: '2026-10-05T04:00:00.000Z' },
        details: { command: 'first-account' },
      },
    ]);
  });

  it('is refused while a Super Admin exists', async () => {
    await expect(firstAccount.create('Jamila', 'Ergasheva')).rejects.toBeInstanceOf(
      SuperAdminExistsError,
    );
    expect(await accountRows()).toBe(1);
  });

  // Decided by the owner: a Super Admin assignment that has ended does not
  // stand in its way, and accounts without the role do not either.
  it('works again once no Super Admin assignment is left that has not ended', async () => {
    await sql`
      update assignments set valid_until = ${new Date('2026-10-05T09:00:00+05:00')}
    `.execute(database.migrator);

    const second = await firstAccount.create('Jamila', 'Ergasheva');

    expect(second.login).toBe('j.ergasheva');
    expect(await accountRows()).toBe(2);
  });

  it('is refused while the only Super Admin assignment begins later', async () => {
    await sql`
      update assignments set valid_from = ${new Date('2026-11-01T09:00:00+05:00')}
      where valid_until is null
    `.execute(database.migrator);

    await expect(firstAccount.create('Kamol', 'Ergashev')).rejects.toBeInstanceOf(
      SuperAdminExistsError,
    );
    expect(await accountRows()).toBe(2);
  });

  // Found by the review: such an assignment has its start as its end and is never in force.
  it('works again when that one was taken back before it began', async () => {
    await sql`
      update assignments set valid_until = valid_from where valid_until is null
    `.execute(database.migrator);

    const third = await firstAccount.create('Kamol', 'Ergashev');

    expect(third.login).toBe('k.ergashev');
    expect(await accountRows()).toBe(3);
  });
});
