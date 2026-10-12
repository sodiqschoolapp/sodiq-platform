import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA';

/** Monday 12 October 2026, 09:00 in Tashkent. */
const AT = '2026-10-12T09:00:00+05:00';
const SEPTEMBER = '2026-09-01T00:00:00+05:00';
const LATER = '2026-10-20T00:00:00+05:00';

// Edge cases, Who can act: "a branch with no active Academic Vice Principal
// shows an alert to the Super Admin" ("is ill for three weeks ... or the post
// is vacant"). The function `branches_without_vice_principal` of 0029 answers
// the branches (id and name only) where no Academic Vice Principal is active
// at a moment: the assignment has begun and not ended, the account is not
// locked, and the linked staff record is not inactive or left on that day
// (`staff_account_blocked`, the check of sign-in; decisions 1 to 3 of #64).
describe('the branches without an active Academic Vice Principal', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let academic: string;
  let steam: string;
  let count = 0;

  /** The ids of the listed branches among `ours`, at a moment, as the application user. */
  async function listed(ours: string[], at: string = AT): Promise<string[]> {
    const rows = await transactions.run([], async (transaction) => {
      const found = await sql<{ id: string; name: string }>`
        select * from branches_without_vice_principal(${new Date(at)}::timestamptz)
      `.execute(transaction);
      return found.rows;
    });
    return rows.map((row) => row.id).filter((id) => ours.includes(id));
  }

  async function newAccount(): Promise<string> {
    count += 1;
    const inserted = await database.migrator
      .insertInto('accounts')
      .values({
        login: `v.vice${String(count)}`,
        password_hash: HASH,
        must_change_password: false,
        created_at: new Date(SEPTEMBER),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return inserted.id;
  }

  async function giveVice(
    account: string,
    branch: string,
    from: string = SEPTEMBER,
    until: string | null = null,
  ): Promise<string> {
    const inserted = await database.migrator
      .insertInto('assignments')
      .values({
        account_id: account,
        role: 'academic_vice_principal',
        branch_id: branch,
        valid_from: new Date(from),
        valid_until: until === null ? null : new Date(until),
        created_at: new Date(SEPTEMBER),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return inserted.id;
  }

  /** A staff record with its main branch, linked to the account, with its statuses. */
  async function linkedRecord(
    account: string,
    mainBranch: string,
    statuses: { status: string; from: string; until?: string }[] = [
      { status: 'active', from: '2026-09-01' },
    ],
  ): Promise<void> {
    count += 1;
    await database.migrator.transaction().execute(async (transaction) => {
      const staff = await transaction
        .insertInto('staff')
        .values({
          kind: 'person',
          staff_id: `S-26${String(7000 + count).padStart(4, '0')}`,
          first_name: 'Nodira',
          last_name: `Rahimova${'a'.repeat(count % 7)}`,
          sex: 'female',
          birth_date: `1985-02-${String((count % 28) + 1).padStart(2, '0')}`,
          phone: `+9989100${String(count).padStart(5, '0')}`,
          admission_date: '2026-09-01',
          account_id: account,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: staff.id, branch_id: mainBranch, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({ staff_id: staff.id, division_id: academic, department_id: steam, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_languages')
        .values({ staff_id: staff.id, language: 'uz' })
        .execute();
      for (const row of statuses) {
        await transaction
          .insertInto('staff_statuses')
          .values({
            staff_id: staff.id,
            status: row.status,
            valid_from: row.from,
            valid_until: row.until ?? null,
          })
          .execute();
      }
    });
  }

  /** A branch with one Academic Vice Principal, set up by `prepare`. */
  async function branchWith(
    name: string,
    prepare: (account: string, branch: string) => Promise<void>,
  ): Promise<string> {
    const branch = await insertBranch(database.migrator, name);
    await prepare(await newAccount(), branch);
    return branch;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(AT));
    academic = (
      await database.migrator
        .selectFrom('divisions')
        .select('id')
        .where('name_en', '=', 'Academic')
        .executeTakeFirstOrThrow()
    ).id;
    steam = (
      await database.migrator
        .selectFrom('departments')
        .select('id')
        .where('name_en', '=', 'STEAM')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('lists a branch with none, and not one with an active one', async () => {
    const vacant = await insertBranch(database.migrator, 'Vacant');
    const staffed = await branchWith('Staffed', async (account, branch) => {
      await giveVice(account, branch);
      await linkedRecord(account, branch);
    });
    expect(await listed([vacant, staffed])).toEqual([vacant]);
  });

  it('answers the id and the name only, ordered by name', async () => {
    const zeta = await insertBranch(database.migrator, 'Zeta vacant');
    const alpha = await insertBranch(database.migrator, 'Alpha vacant');
    const rows = await transactions.run([], async (transaction) => {
      const found = await sql<Record<string, unknown>>`
        select * from branches_without_vice_principal(${new Date(AT)}::timestamptz)
      `.execute(transaction);
      return found.rows;
    });
    const ours = rows.filter((row) => row.id === zeta || row.id === alpha);
    expect(ours).toEqual([
      { id: alpha, name: 'Alpha vacant' },
      { id: zeta, name: 'Zeta vacant' },
    ]);
  });

  it('lists a branch whose Academic Vice Principal is inactive or has left today', async () => {
    const inactive = await branchWith('Inactive', async (account, branch) => {
      await giveVice(account, branch);
      await linkedRecord(account, branch, [
        { status: 'active', from: '2026-09-01', until: '2026-10-05' },
        { status: 'inactive', from: '2026-10-05' },
      ]);
    });
    const left = await branchWith('Left', async (account, branch) => {
      await giveVice(account, branch);
      await linkedRecord(account, branch, [
        { status: 'active', from: '2026-09-01', until: '2026-10-12' },
        { status: 'left', from: '2026-10-12' },
      ]);
    });
    expect(await listed([inactive, left])).toEqual([inactive, left]);
  });

  it('does not list a branch whose Academic Vice Principal is inactive only later, or was inactive once', async () => {
    const planned = await branchWith('Planned inactive', async (account, branch) => {
      await giveVice(account, branch);
      await linkedRecord(account, branch, [
        { status: 'active', from: '2026-09-01', until: '2026-10-19' },
        { status: 'inactive', from: '2026-10-19' },
      ]);
    });
    const back = await branchWith('Back from leave', async (account, branch) => {
      await giveVice(account, branch);
      await linkedRecord(account, branch, [
        { status: 'active', from: '2026-09-01', until: '2026-09-14' },
        { status: 'inactive', from: '2026-09-14', until: '2026-10-01' },
        { status: 'active', from: '2026-10-01' },
      ]);
    });
    // Taken back: a row whose end is its start is not in force on any day.
    const takenBack = await branchWith('Taken back', async (account, branch) => {
      await giveVice(account, branch);
      await linkedRecord(account, branch, [
        { status: 'active', from: '2026-09-01' },
        { status: 'inactive', from: '2026-10-12', until: '2026-10-12' },
      ]);
    });
    expect(await listed([planned, back, takenBack])).toEqual([]);
  });

  it('lists a branch whose Academic Vice Principal is locked', async () => {
    let locked = '';
    const branch = await branchWith('Locked', async (account, id) => {
      await giveVice(account, id);
      await linkedRecord(account, id);
      locked = account;
    });
    expect(await listed([branch])).toEqual([]);
    const admin = await newAccount();
    await database.migrator
      .updateTable('accounts')
      .set({ locked_at: new Date(SEPTEMBER), locked_by: admin, lock_reason: 'test' })
      .where('id', '=', locked)
      .execute();
    expect(await listed([branch])).toEqual([branch]);
  });

  it('lists a branch whose Academic Vice Principal has ended or is planned, and pins both ends of the period', async () => {
    const ended = await branchWith('Ended', async (account, branch) => {
      await giveVice(account, branch, SEPTEMBER, '2026-10-05T00:00:00+05:00');
      await linkedRecord(account, branch);
    });
    const endsNow = await branchWith('Ends at the moment', async (account, branch) => {
      await giveVice(account, branch, SEPTEMBER, AT);
      await linkedRecord(account, branch);
    });
    const plannedRole = await branchWith('Planned role', async (account, branch) => {
      await giveVice(account, branch, LATER);
      await linkedRecord(account, branch);
    });
    const beginsNow = await branchWith('Begins at the moment', async (account, branch) => {
      await giveVice(account, branch, AT);
      await linkedRecord(account, branch);
    });
    const endsLater = await branchWith('Ends later', async (account, branch) => {
      await giveVice(account, branch, SEPTEMBER, LATER);
      await linkedRecord(account, branch);
    });
    // A role taken back on the day it began: its end is its start.
    const takenBack = await branchWith('Role taken back', async (account, branch) => {
      await giveVice(account, branch, '2026-10-12T00:00:00+05:00', '2026-10-12T00:00:00+05:00');
      await linkedRecord(account, branch);
    });
    expect(await listed([ended, endsNow, plannedRole, beginsNow, endsLater, takenBack])).toEqual([
      ended,
      endsNow,
      plannedRole,
      takenBack,
    ]);
  });

  it('counts an account with no linked staff record as active', async () => {
    const branch = await branchWith('No record', async (account, id) => {
      await giveVice(account, id);
    });
    expect(await listed([branch])).toEqual([]);
  });

  it('does not count an Academic Vice Principal of another branch, nor another role', async () => {
    const elsewhere = await branchWith('Elsewhere', async (account, branch) => {
      await giveVice(account, branch);
    });
    const other = await insertBranch(database.migrator, 'Other with a principal');
    const principal = await newAccount();
    await database.migrator
      .insertInto('assignments')
      .values({
        account_id: principal,
        role: 'principal',
        branch_id: other,
        valid_from: new Date(SEPTEMBER),
        created_at: new Date(SEPTEMBER),
      })
      .execute();
    expect(await listed([elsewhere, other])).toEqual([other]);
  });

  it("reads the status date in the time zone of the record's main branch, as sign-in does", async () => {
    // The listed branch is in Tashkent; the record's main branch is far west,
    // where the day changes ten hours later.
    const west = await insertBranch(database.migrator, 'West');
    await database.migrator
      .updateTable('branches')
      .set({ time_zone: 'America/New_York' })
      .where('id', '=', west)
      .execute();
    const branch = await branchWith('Listed in Tashkent', async (account, id) => {
      await giveVice(account, id);
      await linkedRecord(account, west, [
        { status: 'active', from: '2026-09-01', until: '2026-10-12' },
        { status: 'inactive', from: '2026-10-12' },
      ]);
    });
    // 08:00 on 12 October in Tashkent is 23:00 on 11 October in New York: the
    // record is still active there.
    expect(await listed([branch], '2026-10-12T08:00:00+05:00')).toEqual([]);
    // 10:00 on 12 October in Tashkent is 01:00 on 12 October in New York.
    expect(await listed([branch], '2026-10-12T10:00:00+05:00')).toEqual([branch]);
  });

  it('may be called by the application user, not by public', async () => {
    const grants = await sql<{ app: boolean; public: boolean }>`
      select
        has_function_privilege('sodiq_app', 'branches_without_vice_principal(timestamptz)', 'execute') as app,
        exists (
          select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.oid = 'branches_without_vice_principal(timestamptz)'::regprocedure
            and a.grantee = 0 and a.privilege_type = 'EXECUTE'
        ) as public
    `.execute(database.migrator);
    expect(grants.rows[0]).toEqual({ app: true, public: false });
  });

  it('has no archived branch to leave out yet', async () => {
    // Edge cases, Who can act, as planned on #63: archived branches never show.
    // Branches cannot be archived yet (decision 4 of #64). When `archived_at`
    // comes to `branches`, make `branches_without_vice_principal` skip archived
    // branches in that migration, test it here, and remove this pin.
    const found = await sql<{ name: string }>`
      select column_name as name from information_schema.columns
      where table_schema = 'public' and table_name = 'branches' and column_name = 'archived_at'
    `.execute(database.migrator);
    expect(
      found.rows,
      'branches can be archived now: make branches_without_vice_principal skip archived branches',
    ).toEqual([]);
  });
});
