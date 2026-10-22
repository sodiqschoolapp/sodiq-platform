import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
/** Monday 19 October 2026, a school day after today. */
const MONDAY = '2026-10-19';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(
  work: Promise<unknown>,
): Promise<{ code?: string; constraint?: string; message?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string; message?: string };
  }
  throw new Error('The database did not refuse it.');
}

// The forced delete of a lesson that holds data in the database (db/migrations
// 0105; task 5.8b, pull request #195): "Forced delete is for Super Admin only,
// with a typed reason" (06, Protection). Moved here from
// `lesson-protection.database.test.ts` by task 6.1b-1 (decision 8): the forced
// delete does not yet take a lesson's cells out first, so these tests keep the
// stand-in function of 5.8b for `lesson_holds_data` until task 6.1b-2 moves
// them to real cells (the From line of 5.8b on 6.1b-2). All names are invented.
describe('the forced delete of a lesson that holds data in the database (stand-in until 6.1b-2)', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LessonsKit;
  let north: string;
  let account: string;
  const years = new Map<string, { year: string; quarters: string[] }>();
  let subject: string;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** An audit entry of the transaction in the branch, as `Audit.record` writes it. */
  const audited = (transaction: Transaction, branch: string) =>
    transaction
      .insertInto('audit_log')
      .values({ occurred_at: new Date(NOW), branch_id: branch, action: 'test.lesson_change' })
      .execute();

  /** A lesson of its own block on a date, as the application writes one. */
  async function lesson(
    branch: string,
    input: { date?: string; teacherId?: string | null; classId?: string } = {},
  ): Promise<{ block: string; lesson: string }> {
    const date = input.date ?? MONDAY;
    const classId =
      input.classId ??
      (await kit.load.classes.schoolClass(branch, years.get(branch)?.year ?? '', { grade: 7 }));
    const source = await kit.source(branch, years.get(branch)?.year ?? '', [
      { classId, groupId: null, subjectId: subject },
    ]);
    return inBranch(branch, async (transaction) => {
      const block = await transaction
        .insertInto('lesson_blocks')
        .values({
          branch_id: branch,
          academic_year_id: years.get(branch)?.year ?? '',
          quarter_id: years.get(branch)?.quarters[0] ?? '',
          lesson_date: date,
          starts_at: at(date, '09:00'),
          ends_at: at(date, '09:45'),
          version_id: source.versionId,
          pattern_block_id: source.patternBlockId,
        })
        .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
        .executeTakeFirstOrThrow();
      const row = await transaction
        .insertInto('lessons')
        .values({
          branch_id: branch,
          block_id: block.id,
          lesson_date: block.lesson_date,
          starts_at: block.starts_at,
          ends_at: block.ends_at,
          class_id: classId,
          subject_id: subject,
          load_row_id: source.lessons[0]?.loadRowId ?? '',
          pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
          teacher_id: input.teacherId ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { block: block.id, lesson: row.id };
    });
  }

  /** A store row naming the lesson (and its block when given), in the transaction. */
  const storeRow = (
    transaction: Transaction,
    branch: string,
    lessonId: string,
    blockId: string | null = null,
  ) =>
    transaction
      .insertInto('forced_deletes')
      .values({
        branch_id: branch,
        record_type: 'lesson',
        record_id: lessonId,
        rows: JSON.stringify(blockId === null ? { block: null } : { block: { id: blockId } }),
        reason: 'Entered for the wrong class',
        deleted_by: account,
        deleted_at: new Date('2020-01-01T00:00:00Z'),
        restore_until: new Date('2099-01-01T00:00:00Z'),
      })
      .returning(['id', 'deleted_at', 'restore_until'])
      .executeTakeFirstOrThrow();

  const historyOf = (lessonId: string) =>
    database.migrator
      .selectFrom('lesson_history')
      .selectAll()
      .where('lesson_id', '=', lessonId)
      .orderBy('changed_at')
      .orderBy('id')
      .execute();

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    years.set(north, await kit.year(north));
    subject = await kit.load.classes.subject({ grades: [5, 6, 7, 8, 9, 10, 11] });
    account = await kit.load.classes.account();
    // A stand-in for the cells: the lessons this table names hold data.
    await sql`create table test_lessons_with_data (lesson_id uuid primary key)`.execute(
      database.migrator,
    );
    await sql`grant select on test_lessons_with_data to sodiq_app`.execute(database.migrator);
    await sql`
      create or replace function lesson_holds_data(lesson_ref uuid) returns boolean
      language sql stable set search_path = pg_catalog, public
      as $$ select exists (select 1 from test_lessons_with_data t where t.lesson_id = lesson_ref) $$
    `.execute(database.migrator);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('lets a forced delete of the same transaction remove it, and nothing else', async () => {
    const held = await lesson(north);
    const other = await lesson(north);
    await database.migrator
      .insertInto('test_lessons_with_data' as never)
      .values([{ lesson_id: held.lesson }, { lesson_id: other.lesson }] as never)
      .execute();
    // A store row of another transaction opens nothing.
    await inBranch(north, (transaction) => storeRow(transaction, north, other.lesson));
    const earlier = await refusal(
      inBranch(north, async (transaction) => {
        await audited(transaction, north);
        await transaction.deleteFrom('lessons').where('id', '=', other.lesson).execute();
      }),
    );
    expect(earlier.constraint).toBe('lesson_holds_data');
    // One of this transaction naming another lesson opens nothing either.
    const elsewhere = await refusal(
      inBranch(north, async (transaction) => {
        await storeRow(transaction, north, other.lesson);
        await audited(transaction, north);
        await transaction.deleteFrom('lessons').where('id', '=', held.lesson).execute();
      }),
    );
    expect(elsewhere.constraint).toBe('lesson_holds_data');
    await inBranch(north, async (transaction) => {
      await storeRow(transaction, north, held.lesson);
      await audited(transaction, north);
      await transaction.deleteFrom('lessons').where('id', '=', held.lesson).execute();
    });
    expect(await historyOf(held.lesson)).toMatchObject([{ kind: 'forced_delete' }]);
  });
});
