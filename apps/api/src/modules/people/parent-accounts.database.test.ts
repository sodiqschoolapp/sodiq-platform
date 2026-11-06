import { studentNameKey } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemClock } from '../../clock/system-clock.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { linkRelative } from '../../testing/relatives-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';

const HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
const MOMENT = new Date('2026-11-06T09:00:00+05:00');

// The rules of Parent accounts that the database itself keeps (db/migrations/0158; task 11.1,
// pull request #292): the switched-off check of 0036 is gone (decision 1, Look first) and an
// account is switched on only with the account it is linked to, once; parent and staff
// accounts never mix ("A parent session never carries staff rights", `10`); the slips are
// append-only, filtered by branch, and read for the whole person by `parent_slip_state`
// (must-fix 1 of the spec review; decision 15); `parent_account_blocked` (decision 6). All
// names are invented.
describe('Parent accounts in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let north: string;
  let south: string;
  let admin: string;
  let assignment: string;
  let count = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  async function newAccount(): Promise<string> {
    count += 1;
    return (
      await database.migrator
        .insertInto('accounts')
        .values({
          login: `p.ota${String(count)}`,
          password_hash: HASH,
          must_change_password: true,
          password_expires_at: new Date(MOMENT.getTime() + 30 * 86_400_000),
          created_at: MOMENT,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  async function writeStudent(transaction: Transaction, branch: string): Promise<string> {
    count += 1;
    const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
    const id = found.rows[0]?.id ?? '';
    const uid = String(2607500 + count);
    await transaction
      .insertInto('students')
      .values({
        id,
        branch_id: branch,
        uid,
        first_name: 'Nodira',
        last_name: 'Qodirova',
        name_key: studentNameKey('Qodirova', 'Nodira'),
        sex: 'female',
        birth_date: '2014-03-02',
        grade: 7,
        starts_on: '2026-09-02',
        created_by: admin,
      })
      .execute();
    await transaction
      .insertInto('student_uids')
      .values({ uid, student_id: id, branch_id: branch, held_from: MOMENT })
      .execute();
    await transaction
      .insertInto('student_contracts')
      .values({ student_id: id, branch_id: branch, number: `PA-${uid}`, signed_on: '2026-08-20' })
      .execute();
    await transaction
      .insertInto('student_statuses')
      .values({
        student_id: id,
        branch_id: branch,
        status: 'active',
        valid_from: '2026-09-02',
        cause: 'start',
      })
      .execute();
    await transaction
      .insertInto('student_accounts')
      .values({ student_id: id, branch_id: branch, created_at: MOMENT })
      .execute();
    return id;
  }

  async function studentWithRelative(
    branch: string,
  ): Promise<{ student: string; relative: string }> {
    return inBranch(branch, async (transaction) => {
      const student = await writeStudent(transaction, branch);
      const relative = await linkRelative(transaction, student, branch, MOMENT, {
        fullName: 'Gulnora Qodirova',
      });
      return { student, relative };
    });
  }

  const switchOn = (branch: string, relative: string, account: string) =>
    inBranch(branch, (transaction) =>
      transaction
        .updateTable('relative_accounts')
        .set({ account_id: account, switched_on_at: MOMENT })
        .where('relative_id', '=', relative)
        .execute(),
    );

  const blocked = async (account: string, at: Date = MOMENT) =>
    (
      await sql<{
        blocked: boolean;
      }>`select parent_account_blocked(${account}, ${at}) as blocked`.execute(database.app)
    ).rows[0]?.blocked;

  /** A staff record with its main branch, in one transaction (the deferred check of 0024). */
  async function insertStaff(staffId: string, phone: string, account: string | null) {
    return database.migrator.transaction().execute(async (transaction) => {
      const staff = await transaction
        .insertInto('staff')
        .values({
          kind: 'person',
          staff_id: staffId,
          account_id: account,
          first_name: 'Sardor',
          last_name: 'Ergashev',
          sex: 'male',
          birth_date: '1988-05-06',
          phone,
          admission_date: '2026-09-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: staff.id, branch_id: north, is_main: true })
        .execute();
      const academic = await transaction
        .selectFrom('divisions')
        .select('id')
        .where('name_en', '=', 'Academic')
        .executeTakeFirstOrThrow();
      const steam = await transaction
        .selectFrom('departments')
        .select('id')
        .where('name_en', '=', 'STEAM')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_divisions')
        .values({
          staff_id: staff.id,
          division_id: academic.id,
          department_id: steam.id,
          is_main: true,
        })
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: staff.id, status: 'active', valid_from: '2026-09-01' })
        .execute();
      return staff.id;
    });
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new SystemClock());
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    admin = await newAccount();
    assignment = (
      await database.migrator
        .insertInto('assignments')
        .values({
          account_id: admin,
          role: 'super_admin',
          branch_id: null,
          valid_from: MOMENT,
          created_at: MOMENT,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('the account of a relative (decision 1, Look first)', () => {
    it('is switched on with its account, which the check of 0036 refused', async () => {
      const { relative } = await studentWithRelative(north);
      const account = await newAccount();
      await switchOn(north, relative, account);
      const row = await database.migrator
        .selectFrom('relative_accounts')
        .select(['account_id', 'switched_on_at'])
        .where('relative_id', '=', relative)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ account_id: account, switched_on_at: MOMENT });
    });

    it('is linked once: never changed, never emptied, never switched on without it', async () => {
      const { relative } = await studentWithRelative(north);
      const account = await newAccount();
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('relative_accounts')
            .set({ switched_on_at: MOMENT })
            .where('relative_id', '=', relative)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'relative_account_switch_on' });
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('relative_accounts')
            .set({ account_id: account })
            .where('relative_id', '=', relative)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'relative_account_switch_on' });
      await switchOn(north, relative, account);
      const other = await newAccount();
      await expect(switchOn(north, relative, other)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'relative_account_linked',
      });
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('relative_accounts')
            .set({ account_id: null, switched_on_at: null })
            .where('relative_id', '=', relative)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'relative_account_linked' });
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('relative_accounts')
            .set({ switched_on_at: new Date(MOMENT.getTime() + 1000) })
            .where('relative_id', '=', relative)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'relative_account_switch_on' });
    });

    it('is one account for one relative (unique)', async () => {
      const first = await studentWithRelative(north);
      const second = await studentWithRelative(south);
      const account = await newAccount();
      await switchOn(north, first.relative, account);
      await expect(switchOn(south, second.relative, account)).rejects.toMatchObject({
        code: '23505',
        constraint: 'relative_accounts_account_id_key',
      });
    });
  });

  describe('parent and staff accounts never mix', () => {
    it('refuses a relative an account that has a staff record', async () => {
      const { relative } = await studentWithRelative(north);
      const account = await newAccount();
      await insertStaff('S-269901', '+998911199001', account);
      await expect(switchOn(north, relative, account)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'parent_account_staff',
      });
    });

    it('refuses a relative an account that holds an assignment, with no staff record', async () => {
      const { relative } = await studentWithRelative(north);
      const account = await newAccount();
      await database.migrator
        .insertInto('assignments')
        .values({
          account_id: account,
          role: 'teacher',
          branch_id: north,
          valid_from: MOMENT,
          created_at: MOMENT,
        })
        .execute();
      await expect(switchOn(north, relative, account)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'parent_account_assigned',
      });
    });

    it('refuses an assignment for a Parent account, in any branch', async () => {
      const { relative } = await studentWithRelative(north);
      const account = await newAccount();
      await switchOn(north, relative, account);
      for (const branch of [north, south]) {
        await expect(
          database.migrator
            .insertInto('assignments')
            .values({
              account_id: account,
              role: 'teacher',
              branch_id: branch,
              valid_from: MOMENT,
              created_at: MOMENT,
            })
            .execute(),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'assignment_parent_account' });
      }
    });

    it('refuses a staff record linked to a Parent account', async () => {
      const { relative } = await studentWithRelative(north);
      const account = await newAccount();
      await switchOn(north, relative, account);
      await expect(insertStaff('S-269902', '+998911199002', account)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'staff_parent_account',
      });
      const staff = await insertStaff('S-269903', '+998911199003', null);
      await expect(
        database.migrator
          .updateTable('staff')
          .set({ account_id: account })
          .where('id', '=', staff)
          .execute(),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_parent_account' });
    });
  });

  describe('a Parent account that can no longer sign in (decision 6)', () => {
    it('signs in while a live link with portal access on reaches an active student', async () => {
      const { relative } = await studentWithRelative(north);
      const account = await newAccount();
      await switchOn(north, relative, account);
      expect(await blocked(account)).toBe(false);
      // A staff account is never a blocked parent.
      expect(await blocked(admin)).toBe(false);
    });

    it('is blocked when portal access is off on every link', async () => {
      const { relative } = await studentWithRelative(north);
      const account = await newAccount();
      await switchOn(north, relative, account);
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('student_relatives')
          .set({ portal_access: false })
          .where('relative_id', '=', relative)
          .execute(),
      );
      expect(await blocked(account)).toBe(true);
    });

    it('is blocked when its only student left, from the date of the leaving', async () => {
      const { student, relative } = await studentWithRelative(north);
      const account = await newAccount();
      await switchOn(north, relative, account);
      await database.migrator
        .updateTable('student_statuses')
        .set({ valid_until: '2026-11-07' })
        .where('student_id', '=', student)
        .execute();
      await database.migrator
        .insertInto('student_statuses')
        .values({
          student_id: student,
          branch_id: north,
          status: 'inactive',
          valid_from: '2026-11-07',
          cause: 'leaving',
          reason: 'Moved abroad',
        })
        .execute();
      expect(await blocked(account)).toBe(false);
      // 00:30 on 7 November in Tashkent is still 6 November by UTC.
      expect(await blocked(account, new Date('2026-11-07T00:30:00+05:00'))).toBe(true);
    });

    it('is blocked when the relative is archived', async () => {
      const { relative } = await studentWithRelative(north);
      const account = await newAccount();
      await switchOn(north, relative, account);
      await database.migrator
        .updateTable('relatives')
        .set({ archived_at: MOMENT })
        .where('id', '=', relative)
        .execute();
      expect(await blocked(account)).toBe(true);
    });
  });

  describe('the slips (decisions 9 and 15)', () => {
    async function slip(branch: string, relative: string, account: string, printedAt: Date) {
      return inBranch(branch, (transaction) =>
        transaction
          .insertInto('parent_slips')
          .values({
            branch_id: branch,
            account_id: account,
            relative_id: relative,
            class_id: null,
            kind: 'reset',
            language: 'uz',
            printed_at: printedAt,
            valid_until: new Date(printedAt.getTime() + 7 * 86_400_000),
            printed_by: admin,
            assignment_id: assignment,
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      );
    }

    it('are append-only and filtered by branch', async () => {
      const { relative } = await studentWithRelative(north);
      const account = await newAccount();
      await switchOn(north, relative, account);
      const { id } = await slip(north, relative, account, MOMENT);
      expect(
        await inBranch(south, (transaction) =>
          transaction.selectFrom('parent_slips').select('id').where('id', '=', id).execute(),
        ),
      ).toEqual([]);
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('parent_slips')
            .set({ language: 'en' })
            .where('id', '=', id)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await expect(
        inBranch(north, (transaction) =>
          transaction.deleteFrom('parent_slips').where('id', '=', id).execute(),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('are read for the whole person, a slip of another branch without its class', async () => {
      const { relative } = await studentWithRelative(north);
      const account = await newAccount();
      await switchOn(north, relative, account);
      await slip(north, relative, account, MOMENT);
      const state = async (branch: string, at: Date) =>
        (
          await sql<{
            kind: string;
            valid: boolean;
            other_branch: boolean;
            class_id: string | null;
            class_name: string | null;
          }>`select kind, valid, other_branch, class_id, class_name
             from parent_slip_state(${account}, ${branch}, ${at})`.execute(database.app)
        ).rows;
      expect(await state(south, MOMENT)).toEqual([
        { kind: 'reset', valid: true, other_branch: true, class_id: null, class_name: null },
      ]);
      expect(await state(north, MOMENT)).toMatchObject([{ valid: true, other_branch: false }]);
      // After its end, and once the password was chosen, it is no longer valid.
      expect(await state(north, new Date(MOMENT.getTime() + 8 * 86_400_000))).toMatchObject([
        { valid: false },
      ]);
      await database.migrator
        .updateTable('accounts')
        .set({ must_change_password: false, password_expires_at: null })
        .where('id', '=', account)
        .execute();
      expect(await state(north, MOMENT)).toMatchObject([{ valid: false }]);
    });
  });

  it('gives no email reset to a Parent account, which never has a staff record (staff_not_parent)', async () => {
    const { relative } = await studentWithRelative(north);
    const account = await newAccount();
    await switchOn(north, relative, account);
    const found = await sql<{ allowed: boolean }>`
      select password_reset_allowed(${account}, ${MOMENT}) as allowed
    `.execute(database.app);
    expect(found.rows[0]?.allowed).toBe(false);
  });
});
