import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
const DATE = '2026-10-21';

/** What a promise came to: `written`, or the constraint or code that refused it. */
const outcome = (work: Promise<unknown>): Promise<string | undefined> =>
  work.then(
    () => 'written',
    (error: unknown) => {
      const found = error as { constraint?: string; code?: string };
      return found.constraint ?? found.code ?? String(error);
    },
  );

// The record of a bulk cancel (db/migrations/0086; task 5.6a-3, pull request
// #162, decisions 1, 2 and 7): the bulk cancel, its classes, the time each
// class is away and the choice for each shared block, insert only, kept to
// its branch, a block's row kept with no block once a publish removed it.
// Written as `sodiq_app` through the branch filter, as the route writes them.
// All names are invented.
describe('the record of a bulk cancel in the database', () => {
  let database: TestDatabase;
  let kit: LessonsKit;
  let subject: string;
  let account: string;
  let branchCount = 0;

  const app = () => new Transactions(database.app, new FixedClock(NOW));

  /** A branch with a dated year, a class of grade 7 and one lesson on `DATE` at 09:00 in a block of its own. */
  async function fresh() {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Branch ${String(branchCount)}`);
    const { year, quarters } = await kit.year(branch);
    const classId = await kit.load.classes.schoolClass(branch, year, { grade: 7 });
    const source = await kit.source(
      branch,
      year,
      [{ classId, groupId: null, subjectId: subject }],
      '2026-10-19',
    );
    const startsAt = at(DATE, '09:00');
    const block = await database.migrator
      .insertInto('lesson_blocks')
      .values({
        branch_id: branch,
        academic_year_id: year,
        quarter_id: quarters[0] ?? '',
        lesson_date: DATE,
        starts_at: startsAt,
        ends_at: new Date(startsAt.getTime() + 45 * 60_000),
        version_id: source.versionId,
        pattern_block_id: source.patternBlockId,
      })
      .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
      .executeTakeFirstOrThrow();
    const from = source.lessons[0];
    const lesson = await database.migrator
      .insertInto('lessons')
      .values({
        branch_id: branch,
        block_id: block.id,
        lesson_date: block.lesson_date,
        starts_at: block.starts_at,
        ends_at: block.ends_at,
        class_id: classId,
        subject_id: subject,
        load_row_id: from?.loadRowId ?? '',
        pattern_entry_id: from?.patternEntryId ?? '',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { branch, classId, block, lesson };
  }

  type Fresh = Awaited<ReturnType<typeof fresh>>;

  /** A bulk cancel of the scene's class with its span and a `keep` of its block, as the route writes it. */
  const record = (place: Fresh, numbers: number[] = [2]) =>
    app().run([place.branch], async (transaction) => {
      const cancel = await transaction
        .insertInto('bulk_cancels')
        .values({
          branch_id: place.branch,
          cancel_date: DATE,
          lesson_numbers: numbers,
          reason: 'Excursion to the museum',
          changed_at: new Date(NOW),
          changed_by: account,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('bulk_cancel_classes')
        .values({ branch_id: place.branch, bulk_cancel_id: cancel.id, class_id: place.classId })
        .execute();
      await transaction
        .insertInto('bulk_cancel_spans')
        .values({
          branch_id: place.branch,
          bulk_cancel_id: cancel.id,
          class_id: place.classId,
          lesson_number: 2,
          starts_at: place.block.starts_at,
          ends_at: place.block.ends_at,
        })
        .execute();
      await transaction
        .insertInto('bulk_cancel_blocks')
        .values({
          branch_id: place.branch,
          bulk_cancel_id: cancel.id,
          block_id: place.block.id,
          choice: 'keep',
          lesson_date: DATE,
          starts_at: place.block.starts_at,
          ends_at: place.block.ends_at,
        })
        .execute();
      return cancel.id;
    });

  const TABLES = [
    'bulk_cancels',
    'bulk_cancel_classes',
    'bulk_cancel_spans',
    'bulk_cancel_blocks',
  ] as const;

  beforeAll(async () => {
    database = await createTestDatabase();
    kit = await LessonsKit.create(database.migrator);
    subject = await kit.load.classes.subject({ grades: [7] });
    account = await kit.load.classes.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('keeps every row to its branch: another branch sees none', async () => {
    const place = await fresh();
    const other = await fresh();
    await record(place);
    for (const table of TABLES) {
      const seen = await app().run([other.branch], (transaction) =>
        transaction.selectFrom(table).select('branch_id').execute(),
      );
      expect(seen.filter((one) => one.branch_id === place.branch)).toEqual([]);
      const own = await app().run([place.branch], (transaction) =>
        transaction.selectFrom(table).select('branch_id').execute(),
      );
      expect(own.length).toBeGreaterThan(0);
    }
  });

  it('refuses the application an update and a delete of every row', async () => {
    const place = await fresh();
    await record(place);
    for (const table of TABLES) {
      expect(
        await outcome(
          app().run([place.branch], (transaction) =>
            transaction.updateTable(table).set({ branch_id: place.branch }).execute(),
          ),
        ),
      ).toBe('42501');
      expect(
        await outcome(
          app().run([place.branch], (transaction) => transaction.deleteFrom(table).execute()),
        ),
      ).toBe('42501');
    }
  });

  it('refuses lesson numbers empty, unsorted, repeated or out of 1 to 20, and a reason of spaces', async () => {
    const place = await fresh();
    for (const numbers of [[], [2, 1], [1, 1], [0], [21]]) {
      expect(await outcome(record(place, numbers))).toBe('bulk_cancels_lesson_numbers_check');
    }
    expect(await outcome(record(place, [1, 3, 20]))).toBe('written');
    expect(
      await outcome(
        app().run([place.branch], (transaction) =>
          transaction
            .insertInto('bulk_cancels')
            .values({
              branch_id: place.branch,
              cancel_date: DATE,
              lesson_numbers: [1],
              reason: '   ',
              changed_at: new Date(NOW),
              changed_by: account,
            })
            .execute(),
        ),
      ),
    ).toBe('bulk_cancels_reason_check');
  });

  it('keeps the row of a block with no block once a publish removes it', async () => {
    const place = await fresh();
    const id = await record(place);
    await app().run([place.branch], async (transaction) => {
      await transaction.deleteFrom('lessons').where('id', '=', place.lesson.id).execute();
      await transaction.deleteFrom('lesson_blocks').where('id', '=', place.block.id).execute();
    });
    const kept = await database.migrator
      .selectFrom('bulk_cancel_blocks')
      .select(['block_id', 'choice', 'starts_at'])
      .where('bulk_cancel_id', '=', id)
      .executeTakeFirstOrThrow();
    expect(kept).toEqual({ block_id: null, choice: 'keep', starts_at: place.block.starts_at });
  });
});
