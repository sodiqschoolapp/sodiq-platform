import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LoadKit } from '../../testing/load-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';

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

const WEIGHTS = {
  class_no_gaps: 5,
  teacher_few_gaps: 5,
  subject_spread: 5,
  demanding_early: 5,
  class_even_days: 5,
  main_room: 5,
  part_time_few_days: 5,
  teacher_preferred_times: 5,
};

// What the database keeps of step 5 of the builder (db/migrations/0069; task
// 5.3b-1, pull request #128, decisions 2, 3, 5 and 8): each weight a whole
// number from 0 to 10 starting at 5; the weights and their confirmation
// changed only while the version is a draft of a year that is not closed; a
// new version inserts weights but never a confirmation. All names are
// invented.
describe('the weights of a version in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LoadKit;
  let branchCount = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** A draft in a branch of its own with a current year. */
  async function draft(): Promise<{ branch: string; year: string; version: string }> {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Branch ${String(branchCount)}`);
    const year = await kit.classes.year(branch);
    const version = await kit.version(branch, year, { startsOn: STARTS_ON });
    return { branch, year, version };
  }

  const setWeight = (branch: string, version: string, weight: number) =>
    inBranch(branch, (transaction) =>
      transaction
        .updateTable('timetable_versions')
        .set({ weight_main_room: weight })
        .where('id', '=', version)
        .execute(),
    );

  const setConfirmed = (branch: string, version: string) =>
    inBranch(branch, (transaction) =>
      transaction
        .updateTable('timetable_versions')
        .set({ rules_confirmed: JSON.stringify(WEIGHTS) })
        .where('id', '=', version)
        .execute(),
    );

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = new LoadKit(database.migrator);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('starts every weight at 5, unconfirmed', async () => {
    const { version } = await draft();
    const row = await database.migrator
      .selectFrom('timetable_versions')
      .selectAll()
      .where('id', '=', version)
      .executeTakeFirstOrThrow();
    expect([
      row.weight_class_no_gaps,
      row.weight_teacher_few_gaps,
      row.weight_subject_spread,
      row.weight_demanding_early,
      row.weight_class_even_days,
      row.weight_main_room,
      row.weight_part_time_few_days,
      row.weight_teacher_preferred_times,
    ]).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(row.rules_confirmed).toBeNull();
  });

  it('takes a weight from 0 to 10 and refuses one outside', async () => {
    const { branch, version } = await draft();
    await setWeight(branch, version, 0);
    await setWeight(branch, version, 10);
    for (const weight of [-1, 11]) {
      const refused = await refusal(setWeight(branch, version, weight));
      expect(refused.code).toBe(CHECK_VIOLATION);
      expect(refused.constraint).toBe('timetable_versions_weight_main_room_check');
    }
  });

  it('refuses a change of a weight or of the confirmation on a version that is not a draft', async () => {
    const { branch, version } = await draft();
    await kit.setVersion(version, 'published');
    expect((await refusal(setWeight(branch, version, 3))).constraint).toBe(
      'timetable_versions_draft',
    );
    expect((await refusal(setConfirmed(branch, version))).constraint).toBe(
      'timetable_versions_draft',
    );
  });

  it('refuses a change of a weight or of the confirmation in a closed year', async () => {
    const { branch, year, version } = await draft();
    await kit.classes.setYear(year, 'closed');
    expect((await refusal(setWeight(branch, version, 3))).constraint).toBe('version_year_closed');
    expect((await refusal(setConfirmed(branch, version))).constraint).toBe('version_year_closed');
  });

  it('lets a new version insert its weights, never a confirmation', async () => {
    const { branch, year } = await draft();
    const created = await inBranch(branch, (transaction) =>
      transaction
        .insertInto('timetable_versions')
        .values({
          branch_id: branch,
          academic_year_id: year,
          number: 7,
          starts_on: STARTS_ON,
          weight_subject_spread: 9,
        })
        .returning('weight_subject_spread')
        .executeTakeFirstOrThrow(),
    );
    expect(created.weight_subject_spread).toBe(9);
    const refused = await refusal(
      inBranch(branch, (transaction) =>
        transaction
          .insertInto('timetable_versions')
          .values({
            branch_id: branch,
            academic_year_id: year,
            number: 8,
            starts_on: STARTS_ON,
            rules_confirmed: JSON.stringify(WEIGHTS),
          })
          .execute(),
      ),
    );
    expect(refused.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});
