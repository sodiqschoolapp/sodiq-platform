import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemClock } from '../../clock/system-clock.js';
import { Transactions } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

// The kept uploads of the student import (db/migrations/0154, task 9.4g): one
// confirmed import of one file per branch ("Uploading the same file again
// creates nothing", edge/students-classes-groups), the confirm pair both or
// neither, and the branch filter.
describe('student imports in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let north: string;
  let south: string;
  let account: string;
  let count = 0;

  const hash = () => {
    count += 1;
    return count.toString(16).padStart(64, '0');
  };

  const insert = (branch: string, fileSha256: string, confirmed: boolean) =>
    transactions.run([branch], async (transaction) =>
      transaction
        .insertInto('student_imports')
        .values({
          branch_id: branch,
          file_sha256: fileSha256,
          rows: '[]',
          row_count: 1,
          uploaded_by: account,
          uploaded_at: new Date('2026-11-03T10:00:00+05:00'),
          ...(confirmed
            ? { confirmed_by: account, confirmed_at: new Date('2026-11-03T10:05:00+05:00') }
            : {}),
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );

  const codeOf = async (work: Promise<unknown>) => {
    try {
      await work;
    } catch (error) {
      return {
        code: (error as { code?: unknown }).code,
        constraint: (error as { constraint?: unknown }).constraint,
      };
    }
    return { code: 'none', constraint: undefined };
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new SystemClock());
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    account = await new ClassesKit(database.migrator).account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('allows one confirmed import of one file per branch, any number of unconfirmed ones, and the same file in another branch', async () => {
    const file = hash();
    await insert(north, file, false);
    await insert(north, file, false);
    await insert(north, file, true);
    await insert(south, file, true);
    expect(await codeOf(insert(north, file, true))).toEqual({
      code: UNIQUE_VIOLATION,
      constraint: 'student_imports_file_once_idx',
    });
  });

  it('refuses a confirm moment without its account and an account without its moment', async () => {
    for (const values of [
      { confirmed_by: account },
      { confirmed_at: new Date('2026-11-03T10:05:00+05:00') },
    ]) {
      const { id } = await insert(north, hash(), false);
      expect(
        await codeOf(
          transactions.run([north], (transaction) =>
            transaction.updateTable('student_imports').set(values).where('id', '=', id).execute(),
          ),
        ),
      ).toEqual({ code: CHECK_VIOLATION, constraint: 'student_imports_confirm_pair_check' });
    }
  });

  it('shows a branch only its own uploads', async () => {
    const { id } = await insert(north, hash(), false);
    const seen = await transactions.run([south], (transaction) =>
      transaction.selectFrom('student_imports').select('id').where('id', '=', id).execute(),
    );
    expect(seen).toEqual([]);
  });
});
