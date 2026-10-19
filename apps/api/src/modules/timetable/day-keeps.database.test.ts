import { sql } from 'kysely';
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
const SHORT_DATE = '2026-11-16';
const TODAY = '2026-10-15';
const YESTERDAY = '2026-10-14';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// What the database keeps of the lessons kept on a shortened day
// (db/migrations/0074; task 5.5a-2b-2, pull request #143, decision 2): a
// version, a class, a date and a slot position, once each; changed only while
// the version is a draft of a year that is not closed (or, task 5.6b-2b, a
// published version's choice for a date after today); never updated; removed
// with its version. All names are invented.
describe('the lessons kept on a shortened day in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LoadKit;
  let branchCount = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** A draft in a branch of its own with a current year and a class. */
  async function draft() {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Branch ${String(branchCount)}`);
    const year = await kit.classes.year(branch);
    const version = await kit.version(branch, year, { startsOn: STARTS_ON });
    const classId = await kit.classes.schoolClass(branch, year, { grade: 7 });
    return { branch, year, version, classId };
  }

  const keep = (
    branch: string,
    version: string,
    classId: string,
    slotPosition = 1,
    keptOn = SHORT_DATE,
  ) =>
    inBranch(branch, (transaction) =>
      transaction
        .insertInto('timetable_day_keeps')
        .values({
          branch_id: branch,
          version_id: version,
          class_id: classId,
          kept_on: keptOn,
          slot_position: slotPosition,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );

  const unkeep = (branch: string, id: string) =>
    inBranch(branch, (transaction) =>
      transaction.deleteFrom('timetable_day_keeps').where('id', '=', id).execute(),
    );

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = new LoadKit(database.migrator);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('keeps a slot once per version, class and date, and other slots and dates alongside', async () => {
    const { branch, version, classId } = await draft();
    await keep(branch, version, classId, 1);
    await keep(branch, version, classId, 3);
    await keep(branch, version, classId, 1, '2026-11-23');
    expect(await refusal(keep(branch, version, classId, 1))).toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'timetable_day_keeps_slot_key',
    });
  });

  it('refuses a slot position out of range', async () => {
    const { branch, version, classId } = await draft();
    expect((await refusal(keep(branch, version, classId, 0))).constraint).toBe(
      'timetable_day_keeps_slot_check',
    );
    expect((await refusal(keep(branch, version, classId, 21))).constraint).toBe(
      'timetable_day_keeps_slot_check',
    );
  });

  it("refuses another branch's class and another branch's version", async () => {
    const own = await draft();
    const other = await draft();
    // Both branches in the transaction, so only the keys can refuse.
    const both = (values: { version: string; classId: string }) =>
      transactions.run([own.branch, other.branch], (transaction) =>
        transaction
          .insertInto('timetable_day_keeps')
          .values({
            branch_id: own.branch,
            version_id: values.version,
            class_id: values.classId,
            kept_on: SHORT_DATE,
            slot_position: 1,
          })
          .execute(),
      );
    expect((await refusal(both({ version: own.version, classId: other.classId }))).constraint).toBe(
      'timetable_day_keeps_class_fkey',
    );
    expect((await refusal(both({ version: other.version, classId: own.classId }))).constraint).toBe(
      'timetable_day_keeps_version_fkey',
    );
  });

  // Task 5.6b-2b (pull request #171, decision 1, review correction 3): a
  // calendar save writes a published version's choice for a date after today
  // (0089); today, the past, an archived version and an unset moment stay
  // refused. This test was "refuses a choice added or removed on a version
  // that is not a draft" and keeps its refusal on the cases 0089 still refuses.
  it("lets a published version's choice be added and removed after today only", async () => {
    const { branch, version, classId } = await draft();
    const kept = await keep(branch, version, classId);
    await kit.setVersion(version, 'published');
    const added = await keep(branch, version, classId, 3);
    await unkeep(branch, added.id);
    await unkeep(branch, kept.id);
    const left = await database.migrator
      .selectFrom('timetable_day_keeps')
      .select('id')
      .where('version_id', '=', version)
      .execute();
    expect(left).toEqual([]);
  });

  it("refuses a published version's choice added or removed for today or earlier", async () => {
    for (const keptOn of [TODAY, YESTERDAY]) {
      const { branch, version, classId } = await draft();
      // Written while the version was a draft: a draft may hold any date.
      const kept = await keep(branch, version, classId, 1, keptOn);
      await kit.setVersion(version, 'published');
      expect((await refusal(keep(branch, version, classId, 3, keptOn))).constraint, keptOn).toBe(
        'pattern_version_draft',
      );
      expect((await refusal(unkeep(branch, kept.id))).constraint, keptOn).toBe(
        'pattern_version_draft',
      );
    }
  });

  it('refuses a choice added or removed on an archived version', async () => {
    const { branch, version, classId } = await draft();
    const kept = await keep(branch, version, classId);
    await kit.setVersion(version, 'archived');
    expect((await refusal(keep(branch, version, classId, 3))).constraint).toBe(
      'pattern_version_draft',
    );
    expect((await refusal(unkeep(branch, kept.id))).constraint).toBe('pattern_version_draft');
  });

  it("refuses a published version's choice while the moment is not set", async () => {
    const { branch, version, classId } = await draft();
    const kept = await keep(branch, version, classId);
    await kit.setVersion(version, 'published');
    const unset = <T>(work: (transaction: Transaction) => Promise<T>) =>
      inBranch(branch, async (transaction) => {
        await sql`select set_config('app.now', '', true)`.execute(transaction);
        return work(transaction);
      });
    expect(
      (
        await refusal(
          unset((transaction) =>
            transaction
              .insertInto('timetable_day_keeps')
              .values({
                branch_id: branch,
                version_id: version,
                class_id: classId,
                kept_on: SHORT_DATE,
                slot_position: 3,
              })
              .execute(),
          ),
        )
      ).constraint,
    ).toBe('pattern_version_draft');
    expect(
      (
        await refusal(
          unset((transaction) =>
            transaction.deleteFrom('timetable_day_keeps').where('id', '=', kept.id).execute(),
          ),
        )
      ).constraint,
    ).toBe('pattern_version_draft');
  });

  // Spec review of the code, must-fix 2: the published branch of 0089 still
  // meets the closed-year check.
  it("refuses a published version's choice after today added or removed in a closed year", async () => {
    const { branch, year, version, classId } = await draft();
    const kept = await keep(branch, version, classId);
    await kit.setVersion(version, 'published');
    await kit.classes.setYear(year, 'closed');
    expect((await refusal(keep(branch, version, classId, 3))).constraint).toBe(
      'pattern_year_closed',
    );
    expect((await refusal(unkeep(branch, kept.id))).constraint).toBe('pattern_year_closed');
  });

  it('refuses a choice added or removed in a closed year', async () => {
    const { branch, year, version, classId } = await draft();
    const kept = await keep(branch, version, classId);
    await kit.classes.setYear(year, 'closed');
    expect((await refusal(keep(branch, version, classId, 3))).constraint).toBe(
      'pattern_year_closed',
    );
    expect((await refusal(unkeep(branch, kept.id))).constraint).toBe('pattern_year_closed');
  });

  it('removes the choices with their version', async () => {
    const { branch, version, classId } = await draft();
    await keep(branch, version, classId);
    await database.migrator.deleteFrom('timetable_versions').where('id', '=', version).execute();
    const left = await database.migrator
      .selectFrom('timetable_day_keeps')
      .select('id')
      .where('version_id', '=', version)
      .execute();
    expect(left).toEqual([]);
  });

  it('never updates a choice', async () => {
    const { branch, version, classId } = await draft();
    const kept = await keep(branch, version, classId);
    const refused = await refusal(
      inBranch(branch, (transaction) =>
        transaction
          .updateTable('timetable_day_keeps')
          .set({ slot_position: 3 })
          .where('id', '=', kept.id)
          .execute(),
      ),
    );
    expect(refused.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("never shows another branch's choices", async () => {
    const own = await draft();
    const other = await draft();
    await keep(other.branch, other.version, other.classId);
    const seen = await inBranch(own.branch, (transaction) =>
      transaction.selectFrom('timetable_day_keeps').select('id').execute(),
    );
    expect(seen).toEqual([]);
  });
});
