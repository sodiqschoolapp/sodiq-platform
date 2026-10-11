import {
  ATTENDANCE_VALUE_MAX,
  ATTENDANCE_VALUE_MIN,
  EARLY_WARNING_BOUNDS,
  EDIT_DAYS_DEFAULT,
  EDIT_DAYS_MAX,
  EDIT_DAYS_MIN,
  LATE_VALUE_DEFAULT,
  SKIPPED_VALUE_DEFAULT,
  TRAVEL_MINUTES_MAX,
} from '@sodiq/shared';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';

/** The SQLSTATE and the constraint of a refusal; what a promise that was not refused gives. */
async function refusal(work: Promise<unknown>): Promise<{ code: unknown; constraint: unknown }> {
  try {
    await work;
  } catch (error) {
    const failure = error as { code?: unknown; constraint?: unknown };
    return { code: failure.code, constraint: failure.constraint };
  }
  return { code: 'none', constraint: 'none' };
}

const ACCEPTED = { code: 'none', constraint: 'none' };
const check = (constraint: string) => ({ code: CHECK_VIOLATION, constraint });

// What the database itself keeps of the settings (db/migrations/0019), also
// when the application has a fault: the bounds and defaults of packages/shared;
// the branch filter on the settings row; one row per unordered pair of
// branches; the application writes only the columns it may and deletes nothing.
describe('the settings in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let north: string;
  let south: string;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('the settings row of a branch', () => {
    // The backfill of 0019 gives every branch that existed before it a row.
    it('is written for every existing branch by the migration', async () => {
      const migration = await readFile(
        path.resolve(import.meta.dirname, '../../../../../db/migrations/0019_settings.sql'),
        'utf8',
      );
      const backfill = 'insert into branch_settings (branch_id) select id from branches;';
      expect(migration).toContain(backfill);
      const kept = await database.migrator.selectFrom('branch_settings').selectAll().execute();
      await database.migrator.deleteFrom('branch_settings').execute();
      await sql.raw(backfill).execute(database.migrator);
      const branches = await database.migrator.selectFrom('branches').select('id').execute();
      const rows = await database.migrator.selectFrom('branch_settings').selectAll().execute();
      expect(rows.map((row) => row.branch_id).sort()).toEqual(branches.map((row) => row.id).sort());
      expect(rows.every((row) => row.edit_days === EDIT_DAYS_DEFAULT)).toBe(true);
      await database.migrator.deleteFrom('branch_settings').execute();
      await database.migrator.insertInto('branch_settings').values(kept).execute();
    });

    it('starts with the defaults of packages/shared', async () => {
      const row = await database.migrator
        .selectFrom('branch_settings')
        .selectAll()
        .where('branch_id', '=', north)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({
        edit_days: EDIT_DAYS_DEFAULT,
        low_result: EARLY_WARNING_BOUNDS.lowResult.default,
        result_drop: EARLY_WARNING_BOUNDS.resultDrop.default,
        attendance_percent: EARLY_WARNING_BOUNDS.attendancePercent.default,
        absences_in_row: EARLY_WARNING_BOUNDS.absencesInRow.default,
      });
    });

    it('keeps each value inside the bounds of packages/shared', async () => {
      const set = (values: Record<string, number>) =>
        refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('branch_settings')
              .set(values)
              .where('branch_id', '=', north)
              .execute(),
          ),
        );
      const columns = {
        edit_days: { min: EDIT_DAYS_MIN, max: EDIT_DAYS_MAX },
        low_result: EARLY_WARNING_BOUNDS.lowResult,
        result_drop: EARLY_WARNING_BOUNDS.resultDrop,
        attendance_percent: EARLY_WARNING_BOUNDS.attendancePercent,
        absences_in_row: EARLY_WARNING_BOUNDS.absencesInRow,
      };
      for (const [column, bounds] of Object.entries(columns)) {
        expect(await set({ [column]: bounds.min }), column).toEqual(ACCEPTED);
        expect(await set({ [column]: bounds.max }), column).toEqual(ACCEPTED);
        expect(await set({ [column]: bounds.min - 1 }), column).toEqual(
          check(`branch_settings_${column}_check`),
        );
        expect(await set({ [column]: bounds.max + 1 }), column).toEqual(
          check(`branch_settings_${column}_check`),
        );
      }
    });

    it('is invisible and untouchable from another branch', async () => {
      const seen = await inBranch(south, (transaction) =>
        transaction.selectFrom('branch_settings').select('branch_id').execute(),
      );
      expect(seen.map((row) => row.branch_id)).toEqual([south]);
      const changed = await inBranch(south, (transaction) =>
        transaction
          .updateTable('branch_settings')
          .set({ edit_days: 12 })
          .where('branch_id', '=', north)
          .executeTakeFirst(),
      );
      expect(changed.numUpdatedRows).toBe(0n);
      const inserted = await refusal(
        inBranch(south, (transaction) =>
          transaction.insertInto('branch_settings').values({ branch_id: north }).execute(),
        ),
      );
      expect(inserted.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it('is never deleted, and its branch never changes', async () => {
      expect(
        (
          await refusal(
            inBranch(north, (transaction) => transaction.deleteFrom('branch_settings').execute()),
          )
        ).code,
      ).toBe(INSUFFICIENT_PRIVILEGE);
      expect(
        (
          await refusal(
            inBranch(north, (transaction) =>
              transaction.updateTable('branch_settings').set({ branch_id: south }).execute(),
            ),
          )
        ).code,
      ).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  describe('late and skipped on a quarter', () => {
    async function addYear(branch: string, start: string, end: string): Promise<string> {
      return database.migrator.transaction().execute(async (transaction) => {
        const year = await transaction
          .insertInto('academic_years')
          .values({ branch_id: branch, start_date: start, end_date: end })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const number of [1, 2, 3, 4]) {
          await transaction
            .insertInto('quarters')
            .values({ branch_id: branch, academic_year_id: year.id, number })
            .execute();
        }
        return year.id;
      });
    }

    it('start at the defaults of packages/shared and stay inside 0 to 100', async () => {
      const year = await addYear(north, '2026-09-01', '2027-06-30');
      const quarters = await database.migrator
        .selectFrom('quarters')
        .select(['late_value', 'skipped_value'])
        .where('academic_year_id', '=', year)
        .execute();
      expect(quarters).toEqual(
        Array(4).fill({ late_value: LATE_VALUE_DEFAULT, skipped_value: SKIPPED_VALUE_DEFAULT }),
      );
      const set = (values: Record<string, number>) =>
        refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('quarters')
              .set(values)
              .where('academic_year_id', '=', year)
              .where('number', '=', 1)
              .execute(),
          ),
        );
      for (const column of ['late_value', 'skipped_value']) {
        expect(await set({ [column]: ATTENDANCE_VALUE_MIN })).toEqual(ACCEPTED);
        expect(await set({ [column]: ATTENDANCE_VALUE_MAX })).toEqual(ACCEPTED);
        expect(await set({ [column]: ATTENDANCE_VALUE_MIN - 1 })).toEqual(
          check(`quarters_${column}_check`),
        );
        expect(await set({ [column]: ATTENDANCE_VALUE_MAX + 1 })).toEqual(
          check(`quarters_${column}_check`),
        );
      }
    });

    // Answer 20: "while the quarter is not closed" (decision 3: a closed year today).
    it('are refused for a quarter of a closed year, for the migrator too', async () => {
      const year = await addYear(south, '2025-09-01', '2026-06-30');
      await database.migrator
        .updateTable('academic_years')
        .set({ status: 'current' })
        .where('id', '=', year)
        .execute();
      await database.migrator
        .updateTable('academic_years')
        .set({ status: 'closed' })
        .where('id', '=', year)
        .execute();
      const refused = await refusal(
        database.migrator
          .updateTable('quarters')
          .set({ late_value: 70 })
          .where('academic_year_id', '=', year)
          .execute(),
      );
      expect(refused).toEqual(check('academic_years_closed'));
    });
  });

  describe('travel time', () => {
    it('holds one row per pair, the lower id first, 0 to 180 minutes', async () => {
      const [first, second] = [north, south].sort() as [string, string];
      const add = (branchLow: string, branchHigh: string, minutes: number) =>
        refusal(
          transactions.run([], (transaction) =>
            transaction
              .insertInto('travel_times')
              .values({ branch_low: branchLow, branch_high: branchHigh, minutes })
              .execute(),
          ),
        );
      expect(await add(second, first, 10)).toEqual(check('travel_times_order_check'));
      expect(await add(first, first, 10)).toEqual(check('travel_times_order_check'));
      expect(await add(first, second, TRAVEL_MINUTES_MAX + 1)).toEqual(
        check('travel_times_minutes_check'),
      );
      expect(await add(first, second, -1)).toEqual(check('travel_times_minutes_check'));
      expect(await add(first, second, TRAVEL_MINUTES_MAX)).toEqual(ACCEPTED);
      expect((await add(first, second, 20)).code).toBe('23505');
    });

    it('is never deleted, and a pair never changes its branches', async () => {
      expect(
        (
          await refusal(
            transactions.run([], (transaction) => transaction.deleteFrom('travel_times').execute()),
          )
        ).code,
      ).toBe(INSUFFICIENT_PRIVILEGE);
      expect(
        (
          await refusal(
            transactions.run([], (transaction) =>
              transaction.updateTable('travel_times').set({ branch_low: north }).execute(),
            ),
          )
        ).code,
      ).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });
});
