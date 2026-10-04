import { randomUUID } from 'node:crypto';
import { Controller, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { Audit } from './audit.service.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const TABLES = ['audit_log', 'audit_log_school'] as const;

interface StoredEntry {
  partition: string;
  occurred_at: Date;
  branch_id: string | null;
  actor_id: string | null;
  person_id: string | null;
  assignment_id: string | null;
  record_type: string | null;
  record_id: string | null;
  old_value: unknown;
  new_value: unknown;
  reason: string | null;
  details: unknown;
  request_id: string | null;
}

// docs/spec/13-technology.md, Security: every change is written to an audit log
// that cannot be edited: who, when, old value, new value.
// docs/spec/edge-cases/developer-rules.md, "History and audit": append-only, the
// application's database user cannot update or delete them; partitioned by month.
describe('the audit log', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let north: string;
  let south: string;
  const clock = new FixedClock('2026-10-05T23:59:00+05:00');
  const audit = new Audit(clock);

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
  });

  afterAll(async () => {
    await database.destroy();
  });

  /** The entries of an action in both tables, read by the owner, who is not filtered. */
  async function stored(action: string): Promise<StoredEntry[]> {
    const found = await sql<StoredEntry>`
      select tableoid::regclass::text as partition, occurred_at, branch_id, actor_id, person_id,
        assignment_id, record_type, record_id, old_value, new_value, reason, details, request_id
      from audit_log where action = ${action}
      union all
      select tableoid::regclass::text, occurred_at, null, actor_id, person_id,
        assignment_id, record_type, record_id, old_value, new_value, reason, details, request_id
      from audit_log_school where action = ${action}
    `.execute(database.migrator);
    return found.rows;
  }

  async function only(action: string): Promise<StoredEntry> {
    const entries = await stored(action);
    expect(entries).toHaveLength(1);
    // Safe: the length was just checked.
    return entries[0] as StoredEntry;
  }

  describe('is append-only for the application user', () => {
    beforeAll(async () => {
      await transactions.run([north], async (transaction) => {
        await audit.record(transaction, { branchId: north, actorId: null, action: 'test.keep' });
        await audit.record(transaction, { branchId: null, actorId: null, action: 'test.keep' });
      });
    });

    it.each(TABLES)('refuses an update of %s', async (table) => {
      await expect(
        transactions.run([north], (transaction) =>
          sql`update ${sql.table(table)} set action = 'test.changed'`.execute(transaction),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it.each(TABLES)('refuses a delete from %s', async (table) => {
      await expect(
        transactions.run([north], (transaction) =>
          sql`delete from ${sql.table(table)}`.execute(transaction),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it.each(TABLES)('refuses to truncate %s', async (table) => {
      await expect(
        transactions.run([north], (transaction) =>
          sql`truncate ${sql.table(table)}`.execute(transaction),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    // A partition that is read directly is not covered by the policy of its
    // parent, so the application user has no right on any partition.
    it.each([
      ['select', 'select * from audit_log_2026_10'],
      [
        'insert',
        `insert into audit_log_2026_10 (occurred_at, branch_id, action)
                  select '2026-10-05T12:00:00Z', id, 'test.direct' from branches limit 1`,
      ],
      ['update', `update audit_log_2026_10 set action = 'test.changed'`],
      ['delete', 'delete from audit_log_2026_10'],
      ['select', 'select * from audit_log_default'],
      ['select', 'select * from audit_log_school_2026_10'],
      [
        'insert',
        `insert into audit_log_school_2026_10 (occurred_at, action)
                  values ('2026-10-05T12:00:00Z', 'test.direct')`,
      ],
      ['update', `update audit_log_school_2026_10 set action = 'test.changed'`],
      ['delete', 'delete from audit_log_school_2026_10'],
      ['select', 'select * from audit_log_school_default'],
    ])('refuses a direct %s on a partition (%s)', async (_kind, statement) => {
      await expect(
        transactions.run([north, south], (transaction) => sql.raw(statement).execute(transaction)),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('leaves the entries as they were written', async () => {
      expect(await stored('test.keep')).toHaveLength(2);
      expect(await stored('test.changed')).toHaveLength(0);
      expect(await stored('test.direct')).toHaveLength(0);
    });
  });

  describe('is written in the transaction of the change', () => {
    // CLAUDE.md, "Every change is audited": in the same transaction.
    it('keeps no entry when the transaction rolls back', async () => {
      await expect(
        transactions.run([north], async (transaction) => {
          await audit.record(transaction, {
            branchId: north,
            actorId: null,
            action: 'test.undone',
          });
          await audit.record(transaction, { branchId: null, actorId: null, action: 'test.undone' });
          throw new Error('The change failed.');
        }),
      ).rejects.toThrow('The change failed.');

      expect(await stored('test.undone')).toHaveLength(0);
    });

    // CLAUDE.md, "Time is injected".
    it('takes the moment from the injected clock', async () => {
      await transactions.run([north], (transaction) =>
        audit.record(transaction, { branchId: north, actorId: null, action: 'test.moment' }),
      );

      const entry = await only('test.moment');
      expect(entry.occurred_at.toISOString()).toBe('2026-10-05T18:59:00.000Z');
    });

    it('stores every field of an entry', async () => {
      const ids = {
        actor: randomUUID(),
        person: randomUUID(),
        assignment: randomUUID(),
        record: randomUUID(),
      };
      for (const branchId of [north, null]) {
        const action = branchId === null ? 'test.full.school' : 'test.full.branch';
        await transactions.run([north], (transaction) =>
          audit.record(transaction, {
            branchId,
            actorId: ids.actor,
            personId: ids.person,
            assignmentId: ids.assignment,
            action,
            record: { type: 'room', id: ids.record },
            oldValue: { name: 'Room 1', capacity: 20 },
            newValue: ['Room 1a', { capacity: 24 }],
            reason: 'Renamed after the move.',
            details: { rows: 3 },
            requestId: 'request-1',
          }),
        );

        expect(await only(action)).toMatchObject({
          branch_id: branchId,
          actor_id: ids.actor,
          person_id: ids.person,
          assignment_id: ids.assignment,
          record_type: 'room',
          record_id: ids.record,
          old_value: { name: 'Room 1', capacity: 20 },
          new_value: ['Room 1a', { capacity: 24 }],
          reason: 'Renamed after the move.',
          details: { rows: 3 },
          request_id: 'request-1',
        });
      }
    });

    it('leaves empty what an entry does not have', async () => {
      await transactions.run([], (transaction) =>
        audit.record(transaction, {
          branchId: null,
          actorId: null,
          action: 'test.bare',
          oldValue: null,
        }),
      );

      expect(await only('test.bare')).toMatchObject({
        actor_id: null,
        person_id: null,
        assignment_id: null,
        record_type: null,
        record_id: null,
        old_value: null,
        new_value: null,
        reason: null,
        details: null,
        request_id: null,
      });
      // Asked in SQL: the driver reads an empty column and a JSON null alike.
      const empty = await sql<{ old_empty: boolean; new_empty: boolean }>`
        select old_value is null as old_empty, new_value is null as new_empty
        from audit_log_school where action = 'test.bare'
      `.execute(database.migrator);
      expect(empty.rows).toEqual([{ old_empty: true, new_empty: true }]);
    });

    // The service cannot write half a record; the database refuses it as well.
    it.each(TABLES)('refuses a record type without a record id in %s', async (table) => {
      const branch = table === 'audit_log' ? sql`branch_id,` : sql``;
      const branchValue = table === 'audit_log' ? sql`${north},` : sql``;
      await expect(
        sql`
          insert into ${sql.table(table)} (occurred_at, ${branch} action, record_type)
          values ('2026-10-05T12:00:00Z', ${branchValue} 'test.half', 'room')
        `.execute(database.migrator),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses an entry without an action', async () => {
      await expect(
        transactions.run([north], (transaction) =>
          audit.record(transaction, { branchId: north, actorId: null, action: '' }),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  // CLAUDE.md, "Branch on every row"; people-roles-accounts, "Who may read the
  // audit log": the Principal and Academic Vice Principal read their branch.
  describe('belongs to a branch', () => {
    beforeAll(async () => {
      await transactions.run([north, south], async (transaction) => {
        await audit.record(transaction, { branchId: north, actorId: null, action: 'test.north' });
        await audit.record(transaction, { branchId: south, actorId: null, action: 'test.south' });
        await audit.record(transaction, { branchId: null, actorId: null, action: 'test.school' });
      });
    });

    const visible = (branchIds: string[]) =>
      transactions.run(branchIds, async (transaction) => {
        const rows = await transaction
          .selectFrom('audit_log')
          .select('action')
          .where('action', 'in', ['test.north', 'test.south'])
          .orderBy('action')
          .execute();
        return rows.map((row) => row.action);
      });

    it('shows a branch only its own entries', async () => {
      expect(await visible([north])).toEqual(['test.north']);
      expect(await visible([south])).toEqual(['test.south']);
      expect(await visible([north, south])).toEqual(['test.north', 'test.south']);
      expect(await visible([])).toEqual([]);
    });

    it('refuses an entry for a branch the transaction does not work for', async () => {
      await expect(
        transactions.run([north], (transaction) =>
          audit.record(transaction, { branchId: south, actorId: null, action: 'test.foreign' }),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      expect(await stored('test.foreign')).toHaveLength(0);
    });

    it('keeps events of the whole school in a table without a branch', async () => {
      const entry = await only('test.school');
      expect(entry.partition).toBe('audit_log_school_2026_10');

      const seen = await transactions.run([], (transaction) =>
        transaction
          .selectFrom('audit_log_school')
          .select('action')
          .where('action', '=', 'test.school')
          .execute(),
      );
      expect(seen).toHaveLength(1);
    });
  });

  describe('is partitioned by month', () => {
    it.each([
      ['the last second of October', '2026-10-31T23:59:59Z', '2026_10'],
      ['the first second of November', '2026-11-01T00:00:00Z', '2026_11'],
      // Month borders are UTC: this is already November in Tashkent.
      ['the evening of 31 October in UTC', '2026-11-01T02:00:00+05:00', '2026_10'],
      ['the last month that has a partition', '2029-12-31T23:59:59Z', '2029_12'],
      // A write never fails for a missing month.
      ['a moment after the last month', '2030-01-01T00:00:00Z', 'default'],
      ['a moment before the first month', '2026-09-30T23:59:59Z', 'default'],
    ])('puts %s into its partition', async (_name, moment, suffix) => {
      const action = `test.month.${moment}`;
      const at = new Audit(new FixedClock(moment));
      await transactions.run([north], async (transaction) => {
        await at.record(transaction, { branchId: north, actorId: null, action });
        await at.record(transaction, { branchId: null, actorId: null, action });
      });

      const partitions = (await stored(action)).map((entry) => entry.partition).sort();
      expect(partitions).toEqual([`audit_log_${suffix}`, `audit_log_school_${suffix}`]);
    });

    // Decided by the owner on 4 October 2026: the partitions come from a
    // migration, years ahead. This test reads the real date and fails while
    // there is still time to write the next migration.
    it.each(TABLES)('has a partition of %s for each of the next 6 months', async (table) => {
      const found = await sql<{ name: string }>`
        select inhrelid::regclass::text as name from pg_inherits
        where inhparent = ${table}::regclass
      `.execute(database.migrator);
      const names = new Set(found.rows.map((row) => row.name));

      const today = new Date();
      for (let ahead = 0; ahead <= 6; ahead += 1) {
        const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + ahead, 1));
        const name = `${table}_${String(month.getUTCFullYear())}_${String(month.getUTCMonth() + 1).padStart(2, '0')}`;
        expect(names, `${name} is missing: add the next months in a new migration`).toContain(name);
      }
    });
  });

  // Search by person, record and date is task 2.6; "person" is the actor or the
  // person an entry is about (owner, 4 October 2026).
  it.each(TABLES)('has the indexes for searching %s', async (table) => {
    const found = await sql<{ definition: string }>`
      select indexdef as definition from pg_indexes
      where schemaname = 'public' and tablename = ${table}
    `.execute(database.migrator);
    const definitions = found.rows.map((row) => row.definition).join('\n');

    expect(definitions).toContain('(person_id, occurred_at)');
    expect(definitions).toContain('(actor_id, occurred_at)');
    expect(definitions).toContain('(record_type, record_id)');
  });

  // The rights themselves, for every partition: a later migration that adds
  // months must not grant anything on them, nor more on the parents.
  describe('gives the application user', () => {
    const GRANTEES = sql`(0, (select oid from pg_roles where rolname = 'sodiq_app'))`;

    it.each(TABLES)('exactly select and insert on %s', async (table) => {
      const found = await sql<{ privilege: string }>`
        select distinct a.privilege_type as privilege
        from pg_class c, aclexplode(c.relacl) a
        where c.oid = ${table}::regclass and a.grantee in ${GRANTEES}
        order by 1
      `.execute(database.migrator);

      expect(found.rows.map((row) => row.privilege)).toEqual(['INSERT', 'SELECT']);
    });

    it.each(TABLES)('no right on any partition of %s', async (table) => {
      const found = await sql<{ partitions: number; granted: string[] }>`
        select count(*)::int as partitions,
          coalesce(
            array_agg(c.relname::text) filter (where exists (
              select from aclexplode(c.relacl) a where a.grantee in ${GRANTEES}
            )),
            '{}'
          ) as granted
        from pg_inherits i join pg_class c on c.oid = i.inhrelid
        where i.inhparent = ${table}::regclass
      `.execute(database.migrator);

      expect(found.rows[0]?.partitions).toBeGreaterThanOrEqual(40);
      expect(found.rows[0]?.granted).toEqual([]);
    });

    it.each(TABLES)('no right on a single column of %s or its partitions', async (table) => {
      const found = await sql<{ name: string }>`
        select c.relname || '.' || a.attname as name
        from pg_attribute a join pg_class c on c.oid = a.attrelid
        where a.attacl is not null
          and (c.oid = ${table}::regclass
            or c.oid in (select inhrelid from pg_inherits where inhparent = ${table}::regclass))
      `.execute(database.migrator);

      expect(found.rows).toEqual([]);
    });
  });

  // A module that does not import AuditModule can inject the service: the
  // controller below belongs to the root module of the test application.
  it('is offered to every module of the application', async () => {
    @Controller()
    class AuditProbe {
      constructor(@Inject(Audit) readonly audit: Audit) {}
    }

    const app = await createTestApp({ controllers: [AuditProbe] });
    expect(app.get(AuditProbe).audit).toBeInstanceOf(Audit);
    await app.close();
  });
});
