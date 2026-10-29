import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { CHECK_VIOLATION, INSUFFICIENT_PRIVILEGE } from '../../testing/claims-harness.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { monitoringBranchId } from './monitoring-branch.js';

const UNIQUE_VIOLATION = '23505';
const AT = '2026-10-12T09:00:00+05:00';

// Task 10.2b (answer 10): "The sign-in-and-save check every 5 minutes runs in a hidden
// 'Monitoring' branch ... left out of every school report"; 0142. The mark is set only by the
// owner's command, through `monitoring_branch_mark` (plan review of #261, correction 1).
describe('the hidden Monitoring branch in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let academic: string;
  let steam: string;
  let count = 0;

  const asApp = <T>(work: Parameters<Transactions['run']>[1]) =>
    transactions.run([], work) as Promise<T>;

  const mark = (branch: string) =>
    asApp(async (transaction) => {
      await sql`select monitoring_branch_mark(${branch}::uuid)`.execute(transaction);
    });

  /** A staff member of the Academic division, main in `main`, also linked to `others`. */
  async function staffIn(main: string, others: string[] = []): Promise<string> {
    count += 1;
    return database.migrator.transaction().execute(async (transaction) => {
      const staff = await transaction
        .insertInto('staff')
        .values({
          kind: 'person',
          staff_id: `S-26${String(8000 + count).padStart(4, '0')}`,
          first_name: 'Test',
          last_name: `Kuzatuvchi${'a'.repeat(count % 7)}`,
          sex: 'female',
          birth_date: `1990-03-${String((count % 28) + 1).padStart(2, '0')}`,
          phone: `+9980000${String(count).padStart(5, '0')}`,
          admission_date: '2026-09-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_branches')
        .values([
          { staff_id: staff.id, branch_id: main, is_main: true },
          ...others.map((branch) => ({ staff_id: staff.id, branch_id: branch, is_main: false })),
        ])
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({
          staff_id: staff.id,
          division_id: academic,
          department_id: steam,
          is_main: true,
        })
        .execute();
      await transaction
        .insertInto('staff_languages')
        .values({ staff_id: staff.id, language: 'uz' })
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: staff.id, status: 'active', valid_from: '2026-09-01' })
        .execute();
      return staff.id;
    });
  }

  const academicCount = async (): Promise<number> => {
    const rows = await asApp<{ division_id: string; people: number }[]>(
      async (transaction) =>
        (
          await sql<{ division_id: string; people: number }>`
          select * from staff_count_by_division(${new Date(AT)}::timestamptz)
        `.execute(transaction)
        ).rows,
    );
    return rows.find((row) => row.division_id === academic)?.people ?? 0;
  };

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

  it('refuses the application user writing the mark, on a new branch or an existing one', async () => {
    await expect(
      asApp(async (transaction) => {
        await transaction
          .insertInto('branches')
          .values({ name: 'Typed mark', purpose: 'monitoring' })
          .execute();
      }),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    const branch = await insertBranch(database.migrator, 'Plain');
    await expect(
      asApp(async (transaction) => {
        await transaction
          .updateTable('branches')
          .set({ purpose: 'monitoring' })
          .where('id', '=', branch)
          .execute();
      }),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    // The branch create's own columns still go in.
    await expect(
      asApp(async (transaction) => {
        await transaction
          .insertInto('branches')
          .values({
            name: 'Created',
            address: null,
            phone: null,
            email: null,
            working_weekdays: [1, 2, 3, 4, 5],
          })
          .execute();
      }),
    ).resolves.toBeUndefined();
  });

  it('takes no other value than "monitoring"', async () => {
    await expect(
      database.migrator.insertInto('branches').values({ name: 'Other', purpose: 'test' }).execute(),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'branches_purpose_check' });
  });

  it('refuses to mark a branch that holds a staff member or a building', async () => {
    const staffed = await insertBranch(database.migrator, 'Staffed');
    await staffIn(staffed);
    await expect(mark(staffed)).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'monitoring_branch_mark_empty',
    });
    const built = await insertBranch(database.migrator, 'Built');
    await database.migrator
      .insertInto('buildings')
      .values({ branch_id: built, name: 'Main' })
      .execute();
    await expect(mark(built)).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'monitoring_branch_mark_empty',
    });
    const marked = await database.migrator
      .selectFrom('branches')
      .select('id')
      .where('purpose', 'is not', null)
      .execute();
    expect(marked).toEqual([]);
  });

  // Each arm of the empty-branch check of `monitoring_branch_mark`, reached alone (plan review of
  // the code: a year, a class with its year, a role; a building and a staff member above).
  it('refuses to mark a branch that holds a year, a class or a role, and an unknown branch', async () => {
    const yearOnly = await insertBranch(database.migrator, 'With a year');
    const years = new ClassesKit(database.migrator);
    await years.year(yearOnly);
    const withClass = await insertBranch(database.migrator, 'With a class');
    const year = await years.year(withClass);
    await database.migrator
      .insertInto('classes')
      .values({
        branch_id: withClass,
        academic_year_id: year,
        grade: 7,
        name: 'Oxford',
        language: 'uz',
        max_size: 26,
      })
      .execute();
    const withRole = await insertBranch(database.migrator, 'With a role');
    const account = await database.migrator
      .insertInto('accounts')
      .values({
        login: 'a.vice',
        password_hash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA',
        must_change_password: false,
        created_at: new Date(AT),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await database.migrator
      .insertInto('assignments')
      .values({
        account_id: account.id,
        role: 'academic_vice_principal',
        branch_id: withRole,
        valid_from: new Date(AT),
        created_at: new Date(AT),
      })
      .execute();
    for (const branch of [yearOnly, withClass, withRole]) {
      await expect(mark(branch)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'monitoring_branch_mark_empty',
      });
    }
    await expect(mark('01a18770-0000-7000-8000-000000000000')).rejects.toMatchObject({
      code: '23503',
    });
  });

  // Runs after the refusals above: from here on, the Monitoring branch exists.
  it('marks one new, empty branch, once', async () => {
    const monitoring = await insertBranch(database.migrator, 'Monitoring');
    await mark(monitoring);
    expect(await asApp(async (transaction) => monitoringBranchId(transaction))).toBe(monitoring);

    const second = await insertBranch(database.migrator, 'Second monitoring');
    await expect(mark(second)).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    // The unique index stands on its own too.
    await expect(
      database.migrator
        .updateTable('branches')
        .set({ purpose: 'monitoring' })
        .where('id', '=', second)
        .execute(),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'branches_purpose_idx' });
  });

  it("leaves it out of the Super Admin's branches without an Academic Vice Principal", async () => {
    const monitoring = await asApp<string | null>(async (transaction) =>
      monitoringBranchId(transaction),
    );
    const vacant = await insertBranch(database.migrator, 'Vacant');
    const listed = await asApp<string[]>(async (transaction) =>
      (
        await sql<{ id: string }>`
          select id from branches_without_vice_principal(${new Date(AT)}::timestamptz)
        `.execute(transaction)
      ).rows.map((row) => row.id),
    );
    expect(listed).toContain(vacant);
    expect(listed).not.toContain(monitoring);
  });

  it('leaves its own staff out of the division counts, and counts one linked to a real branch too', async () => {
    const monitoring = await asApp<string | null>(async (transaction) =>
      monitoringBranchId(transaction),
    );
    if (monitoring === null) throw new Error('The Monitoring branch of the test above is missing.');
    const real = await insertBranch(database.migrator, 'Real');
    const before = await academicCount();
    await staffIn(monitoring);
    expect(await academicCount()).toBe(before);
    await staffIn(monitoring, [real]);
    expect(await academicCount()).toBe(before + 1);
    await staffIn(real);
    expect(await academicCount()).toBe(before + 2);
  });
});
