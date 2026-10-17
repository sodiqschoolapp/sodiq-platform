import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LoadKit } from '../../testing/load-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
const STARTS_ON = '2026-10-19';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// What the database keeps of the pinned lessons of step 5 (db/migrations/0070;
// task 5.3b-2, pull request #129, decisions 2, 6 and 11): a load row of the
// version, a weekday and a slot position, once per row and slot; changed only
// while the version is a draft of a year that is not closed; never updated;
// removed with its row. All names are invented.
describe('the pinned lessons of a version in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LoadKit;
  let branchCount = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** A draft in a branch of its own with a current year and one class row. */
  async function draft() {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Branch ${String(branchCount)}`);
    const year = await kit.classes.year(branch);
    const version = await kit.version(branch, year, { startsOn: STARTS_ON });
    const subject = await kit.classes.subject({ grades: [7] });
    const classId = await kit.classes.schoolClass(branch, year, { grade: 7 });
    const teacher = (await kit.teacher(branch, { subjects: [{ subject, grades: [7] }] })).staffId;
    const row = await kit.row({
      branch_id: branch,
      version_id: version,
      class_id: classId,
      subject_id: subject,
      teacher_id: teacher,
      lessons_per_week: 3,
    });
    return { branch, year, version, row };
  }

  const pin = (branch: string, version: string, row: string, weekday = 1, slotPosition = 1) =>
    inBranch(branch, (transaction) =>
      transaction
        .insertInto('timetable_pins')
        .values({
          branch_id: branch,
          version_id: version,
          load_row_id: row,
          weekday,
          slot_position: slotPosition,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );

  const unpin = (branch: string, id: string) =>
    inBranch(branch, (transaction) =>
      transaction.deleteFrom('timetable_pins').where('id', '=', id).execute(),
    );

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = new LoadKit(database.migrator);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('pins a row once to a slot, and other slots alongside', async () => {
    const { branch, version, row } = await draft();
    await pin(branch, version, row, 1, 1);
    await pin(branch, version, row, 2, 1);
    const refused = await refusal(pin(branch, version, row, 1, 1));
    expect(refused).toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'timetable_pins_slot_key',
    });
  });

  it('refuses a weekday and a slot position out of range', async () => {
    const { branch, version, row } = await draft();
    expect((await refusal(pin(branch, version, row, 8, 1))).constraint).toBe(
      'timetable_pins_weekday_check',
    );
    expect((await refusal(pin(branch, version, row, 1, 21))).constraint).toBe(
      'timetable_pins_slot_check',
    );
  });

  it('refuses a row of another version', async () => {
    const { branch, year, row } = await draft();
    const other = await kit.version(branch, year, { startsOn: STARTS_ON });
    expect((await refusal(pin(branch, other, row))).constraint).toBe(
      'timetable_pins_load_row_fkey',
    );
  });

  it('refuses a pin added or removed on a version that is not a draft', async () => {
    const { branch, version, row } = await draft();
    const kept = await pin(branch, version, row);
    await kit.setVersion(version, 'published');
    expect((await refusal(pin(branch, version, row, 2, 1))).constraint).toBe(
      'pattern_version_draft',
    );
    expect((await refusal(unpin(branch, kept.id))).constraint).toBe('pattern_version_draft');
  });

  it('refuses a pin added or removed in a closed year', async () => {
    const { branch, year, version, row } = await draft();
    const kept = await pin(branch, version, row);
    await kit.classes.setYear(year, 'closed');
    expect((await refusal(pin(branch, version, row, 2, 1))).constraint).toBe('pattern_year_closed');
    expect((await refusal(unpin(branch, kept.id))).constraint).toBe('pattern_year_closed');
  });

  it('removes the pins with their row', async () => {
    const { branch, version, row } = await draft();
    await pin(branch, version, row);
    await inBranch(branch, (transaction) =>
      transaction.deleteFrom('teaching_load_rows').where('id', '=', row).execute(),
    );
    const left = await database.migrator
      .selectFrom('timetable_pins')
      .select('id')
      .where('version_id', '=', version)
      .execute();
    expect(left).toEqual([]);
  });

  it('never updates a pin', async () => {
    const { branch, version, row } = await draft();
    const kept = await pin(branch, version, row);
    const refused = await refusal(
      inBranch(branch, (transaction) =>
        transaction
          .updateTable('timetable_pins')
          .set({ weekday: 2 })
          .where('id', '=', kept.id)
          .execute(),
      ),
    );
    expect(refused.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("never shows another branch's pins", async () => {
    const own = await draft();
    const other = await draft();
    await pin(other.branch, other.version, other.row);
    const seen = await inBranch(own.branch, (transaction) =>
      transaction.selectFrom('timetable_pins').select('id').execute(),
    );
    expect(seen).toEqual([]);
  });
});
