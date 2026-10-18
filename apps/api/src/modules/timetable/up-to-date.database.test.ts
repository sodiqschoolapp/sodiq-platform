import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LoadKit } from '../../testing/load-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

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

// What the database keeps of a draft brought up to date (db/migrations/0078;
// task 5.5a-3b-2, pull request #148, decision 1 with review correction 1): a
// draft's source may change to a version of its branch and year; the source
// of a published or archived version, and the number of any, stay fixed.
// That the new source is published is decided by the route (decision 10).
describe('a draft brought up to date, in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LoadKit;
  let branchCount = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** A branch with a current year, a published version, a draft and an archived version. */
  async function versions() {
    branchCount += 1;
    const branch = await insertBranch(
      database.migrator,
      `Up to date branch ${String(branchCount)}`,
    );
    const year = await kit.classes.year(branch);
    const published = await kit.version(branch, year, { startsOn: STARTS_ON });
    await kit.setVersion(published, 'published');
    const draft = await kit.version(branch, year, { startsOn: STARTS_ON });
    const archived = await kit.version(branch, year, { startsOn: STARTS_ON });
    await kit.setVersion(archived, 'archived');
    return { branch, year, published, draft, archived };
  }

  const setSource = (branch: string, version: string, source: string) =>
    inBranch(branch, (transaction) =>
      transaction
        .updateTable('timetable_versions')
        .set({ from_version_id: source })
        .where('id', '=', version)
        .execute(),
    );

  const sourceOf = async (version: string) =>
    (
      await database.migrator
        .selectFrom('timetable_versions')
        .select('from_version_id')
        .where('id', '=', version)
        .executeTakeFirstOrThrow()
    ).from_version_id;

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = new LoadKit(database.migrator);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it("changes a draft's source to a version of its branch and year", async () => {
    const v = await versions();
    await setSource(v.branch, v.draft, v.published);
    expect(await sourceOf(v.draft)).toBe(v.published);
  });

  it('keeps the source of a published and of an archived version', async () => {
    const v = await versions();
    for (const version of [v.published, v.archived]) {
      expect((await refusal(setSource(v.branch, version, v.draft))).constraint).toBe(
        'timetable_versions_fixed',
      );
      expect(await sourceOf(version)).toBeNull();
    }
  });

  // Code round 2, finding 2: the draft side of the guard, reached by a draft
  // published and given a new source in one statement.
  it('refuses a new source written with the publish of a draft', async () => {
    const v = await versions();
    expect(
      (
        await refusal(
          inBranch(v.branch, (transaction) =>
            transaction
              .updateTable('timetable_versions')
              .set({ status: 'published', from_version_id: v.published })
              .where('id', '=', v.draft)
              .execute(),
          ),
        )
      ).constraint,
    ).toBe('timetable_versions_fixed');
    expect(await sourceOf(v.draft)).toBeNull();
  });

  it('refuses a source of another year or another branch (the foreign key)', async () => {
    const v = await versions();
    const nextYear = await kit.classes.year(v.branch, 'planned', '2027-09-01', '2028-05-31');
    const elsewhere = await kit.version(v.branch, nextYear, { startsOn: '2027-09-06' });
    expect((await refusal(setSource(v.branch, v.draft, elsewhere))).constraint).toBe(
      'timetable_versions_from_fkey',
    );
    const w = await versions();
    expect(
      (
        await refusal(
          database.migrator
            .updateTable('timetable_versions')
            .set({ from_version_id: w.published })
            .where('id', '=', v.draft)
            .execute(),
        )
      ).constraint,
    ).toBe('timetable_versions_from_fkey');
  });

  it('keeps the number of a draft while its source changes', async () => {
    const v = await versions();
    expect(
      (
        await refusal(
          database.migrator
            .updateTable('timetable_versions')
            .set({ from_version_id: v.published, number: 77 })
            .where('id', '=', v.draft)
            .execute(),
        )
      ).constraint,
    ).toBe('timetable_versions_fixed');
    expect(await sourceOf(v.draft)).toBeNull();
  });
});
