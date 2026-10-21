import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LoadKit } from '../../testing/load-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

/** A block a copy left, as the copy writes it (task 5.8a). */
const LEFT = [
  {
    sourceBlockId: '0199a000-0000-7000-8000-000000000001',
    weekday: 1,
    slotPosition: 7,
    reason: 'copy_slot_missing',
    lessons: [],
  },
];

// What the database keeps of the blocks a copy left (db/migrations/0104;
// task 5.8a, pull request #194, decision 7 and review correction 1): written
// once by the copy's insert, then only emptied, and only while the version
// is a draft, as the rows a copy left (0055, 0078). All names are invented.
describe('the blocks a copy left in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LoadKit;
  let branchCount = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = new LoadKit(database.migrator);
  });

  afterAll(async () => {
    await database.destroy();
  });

  /** A draft of a branch of its own, inserted as the copy inserts it, with one block left. */
  async function draftWithLeft(): Promise<{ branch: string; version: string }> {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Left branch ${String(branchCount)}`);
    const year = await kit.classes.year(branch);
    const version = await inBranch(branch, (transaction) =>
      transaction
        .insertInto('timetable_versions')
        .values({
          branch_id: branch,
          academic_year_id: year,
          number: 1,
          starts_on: '2026-11-09',
          left_blocks: JSON.stringify(LEFT),
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    return { branch, version: version.id };
  }

  const setLeft = (branch: string, version: string, value: unknown) =>
    inBranch(branch, (transaction) =>
      transaction
        .updateTable('timetable_versions')
        .set({ left_blocks: JSON.stringify(value) })
        .where('id', '=', version)
        .execute(),
    );

  const leftOf = async (version: string) =>
    (
      await database.migrator
        .selectFrom('timetable_versions')
        .select('left_blocks')
        .where('id', '=', version)
        .executeTakeFirstOrThrow()
    ).left_blocks;

  it('dismisses the left blocks of a draft', async () => {
    const f = await draftWithLeft();
    expect(await leftOf(f.version)).toEqual(LEFT);
    await setLeft(f.branch, f.version, []);
    expect(await leftOf(f.version)).toEqual([]);
  });

  it('refuses writing them again with anything but an empty list', async () => {
    const f = await draftWithLeft();
    expect(await refusal(setLeft(f.branch, f.version, [...LEFT, ...LEFT]))).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'timetable_versions_fixed',
    });
    await setLeft(f.branch, f.version, []);
    expect(await refusal(setLeft(f.branch, f.version, LEFT))).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'timetable_versions_fixed',
    });
    expect(await leftOf(f.version)).toEqual([]);
  });

  it('refuses a dismissal on a version that is no longer a draft', async () => {
    const f = await draftWithLeft();
    await kit.setVersion(f.version, 'published');
    expect(await refusal(setLeft(f.branch, f.version, []))).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'timetable_versions_draft',
    });
    expect(await leftOf(f.version)).toEqual(LEFT);
  });

  it('refuses left blocks that are not a list', async () => {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Left branch ${String(branchCount)}`);
    const year = await kit.classes.year(branch);
    expect(
      await refusal(
        inBranch(branch, (transaction) =>
          transaction
            .insertInto('timetable_versions')
            .values({
              branch_id: branch,
              academic_year_id: year,
              number: 1,
              starts_on: '2026-11-09',
              left_blocks: JSON.stringify({ reason: 'copy_clash' }),
            })
            .execute(),
        ),
      ),
    ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'timetable_versions_left_blocks_check' });
  });
});
