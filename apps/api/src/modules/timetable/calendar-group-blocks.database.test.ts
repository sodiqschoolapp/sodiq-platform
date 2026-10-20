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
const MONDAY = '2026-11-16';
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

// What the database keeps of a day-off entry's choice for a block of
// two-grade groups (db/migrations/0090; task 5.6b-3, pull request #175): one
// row per block and date, its groups in a child table, a group once per
// entry, date and start; written and removed only for a date after today;
// never updated; never shown to another branch. All names are invented.
describe("a day-off entry's choices for two-grade groups in the database", () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LoadKit;
  let branchCount = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** A branch of its own with a group of grades 9 and 10 and a day off for grade 9. */
  async function scene() {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Branch ${String(branchCount)}`);
    const year = await kit.classes.year(branch);
    const nine = await kit.classes.schoolClass(branch, year, { grade: 9 });
    const ten = await kit.classes.schoolClass(branch, year, { grade: 10 });
    const sport = await kit.classes.subject({ grades: [9, 10], journalType: 'attendance_only' });
    const group = await kit.classes.group(branch, year, sport, [nine, ten]);
    const other = await kit.classes.group(branch, year, sport, [nine, ten]);
    const entry = await database.migrator
      .insertInto('calendar_entries')
      .values({
        branch_id: branch,
        kind: 'day_off',
        name: 'Grade 9 trip',
        first_date: YESTERDAY,
        last_date: MONDAY,
        grade_from: 9,
        grade_to: 9,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { branch, entry: entry.id, group, other };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  const choose = (
    s: Scene,
    input: { date?: string; start?: number; choice?: string; groups?: readonly string[] } = {},
  ) =>
    inBranch(s.branch, async (transaction) => {
      const date = input.date ?? MONDAY;
      const start = input.start ?? 590;
      const row = await transaction
        .insertInto('calendar_group_blocks')
        .values({
          branch_id: s.branch,
          calendar_entry_id: s.entry,
          lesson_date: date,
          weekday: 1,
          start_minutes: start,
          end_minutes: start + 45,
          choice: input.choice ?? 'keep',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('calendar_group_block_groups')
        .values(
          (input.groups ?? [s.group]).map((groupId) => ({
            branch_id: s.branch,
            block_id: row.id,
            group_id: groupId,
            calendar_entry_id: s.entry,
            lesson_date: date,
            start_minutes: start,
          })),
        )
        .execute();
      return row.id;
    });

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = new LoadKit(database.migrator);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('keeps a block of two groups, and refuses a group twice on one date and start', async () => {
    const s = await scene();
    await choose(s, { groups: [s.group, s.other] });
    await choose(s, { start: 480 });
    expect(await refusal(choose(s, { choice: 'cancel' }))).toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'calendar_group_block_groups_once',
    });
  });

  it('refuses a third choice and an end before the start', async () => {
    const s = await scene();
    expect((await refusal(choose(s, { choice: 'move' }))).constraint).toBe(
      'calendar_group_blocks_choice_check',
    );
    expect(
      (
        await refusal(
          inBranch(s.branch, (transaction) =>
            transaction
              .insertInto('calendar_group_blocks')
              .values({
                branch_id: s.branch,
                calendar_entry_id: s.entry,
                lesson_date: MONDAY,
                weekday: 1,
                start_minutes: 590,
                end_minutes: 590,
                choice: 'keep',
              })
              .execute(),
          ),
        )
      ).constraint,
    ).toBe('calendar_group_blocks_order_check');
  });

  it("refuses another branch's group and another branch's entry", async () => {
    const own = await scene();
    const other = await scene();
    // Both branches in the transaction, so only the keys can refuse.
    const both = <T>(work: (transaction: Transaction) => Promise<T>) =>
      transactions.run([own.branch, other.branch], work);
    expect(
      (
        await refusal(
          both(async (transaction) => {
            const row = await transaction
              .insertInto('calendar_group_blocks')
              .values({
                branch_id: own.branch,
                calendar_entry_id: own.entry,
                lesson_date: MONDAY,
                weekday: 1,
                start_minutes: 590,
                end_minutes: 635,
                choice: 'keep',
              })
              .returning('id')
              .executeTakeFirstOrThrow();
            await transaction
              .insertInto('calendar_group_block_groups')
              .values({
                branch_id: own.branch,
                block_id: row.id,
                group_id: other.group,
                calendar_entry_id: own.entry,
                lesson_date: MONDAY,
                start_minutes: 590,
              })
              .execute();
          }),
        )
      ).constraint,
    ).toBe('calendar_group_block_groups_group_fkey');
    expect(
      (
        await refusal(
          both((transaction) =>
            transaction
              .insertInto('calendar_group_blocks')
              .values({
                branch_id: own.branch,
                calendar_entry_id: other.entry,
                lesson_date: MONDAY,
                weekday: 1,
                start_minutes: 590,
                end_minutes: 635,
                choice: 'keep',
              })
              .execute(),
          ),
        )
      ).constraint,
    ).toBe('calendar_group_blocks_entry_fkey');
  });

  it("refuses a group row whose date or start is not its block's", async () => {
    const s = await scene();
    const block = await choose(s);
    const refused = await refusal(
      inBranch(s.branch, (transaction) =>
        transaction
          .insertInto('calendar_group_block_groups')
          .values({
            branch_id: s.branch,
            block_id: block,
            group_id: s.other,
            calendar_entry_id: s.entry,
            lesson_date: MONDAY,
            start_minutes: 480,
          })
          .execute(),
      ),
    );
    expect(refused.constraint).toBe('calendar_group_block_groups_block_fkey');
  });

  it('writes and removes a choice after today only, its groups going with it', async () => {
    const s = await scene();
    const block = await choose(s);
    await inBranch(s.branch, (transaction) =>
      transaction.deleteFrom('calendar_group_blocks').where('id', '=', block).execute(),
    );
    expect(
      await database.migrator
        .selectFrom('calendar_group_block_groups')
        .select('block_id')
        .where('branch_id', '=', s.branch)
        .execute(),
    ).toEqual([]);
    for (const date of [TODAY, YESTERDAY]) {
      expect((await refusal(choose(s, { date }))).constraint, date).toBe(
        'calendar_group_blocks_future',
      );
    }
  });

  it('never removes a choice of today or earlier, nor one of its groups', async () => {
    const s = await scene();
    // Written on 10 October, when 14 October was after today.
    const block = await database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', '2026-10-10T10:00:00+05:00', true)`.execute(
        transaction,
      );
      const row = await transaction
        .insertInto('calendar_group_blocks')
        .values({
          branch_id: s.branch,
          calendar_entry_id: s.entry,
          lesson_date: YESTERDAY,
          weekday: 3,
          start_minutes: 590,
          end_minutes: 635,
          choice: 'keep',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('calendar_group_block_groups')
        .values({
          branch_id: s.branch,
          block_id: row.id,
          group_id: s.group,
          calendar_entry_id: s.entry,
          lesson_date: YESTERDAY,
          start_minutes: 590,
        })
        .execute();
      return row.id;
    });
    expect(
      (
        await refusal(
          inBranch(s.branch, (transaction) =>
            transaction.deleteFrom('calendar_group_blocks').where('id', '=', block).execute(),
          ),
        )
      ).constraint,
    ).toBe('calendar_group_blocks_future');
    expect(
      (
        await refusal(
          inBranch(s.branch, (transaction) =>
            transaction
              .deleteFrom('calendar_group_block_groups')
              .where('block_id', '=', block)
              .execute(),
          ),
        )
      ).constraint,
    ).toBe('calendar_group_blocks_future');
  });

  it('never updates a choice', async () => {
    const s = await scene();
    const block = await choose(s);
    const refused = await refusal(
      inBranch(s.branch, (transaction) =>
        transaction
          .updateTable('calendar_group_blocks')
          .set({ choice: 'cancel' })
          .where('id', '=', block)
          .execute(),
      ),
    );
    expect(refused.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("never shows another branch's choices", async () => {
    const own = await scene();
    const other = await scene();
    await choose(other);
    const seen = await inBranch(own.branch, async (transaction) => [
      ...(await transaction.selectFrom('calendar_group_blocks').select('id').execute()),
      ...(await transaction.selectFrom('calendar_group_block_groups').select('block_id').execute()),
    ]);
    expect(seen).toEqual([]);
  });
});
