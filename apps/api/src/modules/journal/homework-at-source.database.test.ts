import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch, setEditDays } from '../../testing/branch-filter-sql.js';
import { CellsKit } from '../../testing/cells-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
const INSUFFICIENT_PRIVILEGE = '42501';
const MOMENT = '2026-11-20T10:00:00+05:00';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// Task 11.24 (0186; the plan's database steps 5 and 7, review correction 2): a homework is
// stored at the lesson where it was given (`07`, Homework column: "No other lesson has a
// column for it"). A work's lesson and its carry are fixed; a cell's lesson changes only by
// the cascade of the move; the move's kind `homework_move` is the migration's alone. Each
// guard is reached where it can be: the application for what it may write, the migrator for
// what the application has no grant to write. Names are invented.
describe('a work stays at the lesson where it was given', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let clock: FixedClock;
  let cells: CellsKit;
  let branch: string;
  let teacher: string;
  let student: string;
  let monday: string;
  let wednesday: string;
  let friday: string;

  const asApp = <T>(
    work: (transaction: Transaction) => Promise<T>,
    moment = MOMENT,
  ): Promise<T> => {
    clock.set(moment);
    return transactions.run([branch], async (transaction) => {
      await transaction
        .insertInto('audit_log')
        .values({ occurred_at: new Date(moment), branch_id: branch, action: 'test.homework' })
        .execute();
      return work(transaction);
    });
  };

  const asMigrator = <T>(work: (transaction: Transaction) => Promise<T>): Promise<T> =>
    database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${new Date(MOMENT).toISOString()}, true)`.execute(
        transaction,
      );
      return work(transaction);
    });

  /** A homework added by hand at a lesson, with a total, as the application writes it. */
  const homework = (lesson: string, position: number) =>
    asApp(async (transaction) => {
      const row = await transaction
        .insertInto('journal_works')
        .values({
          branch_id: branch,
          lesson_id: lesson,
          source_lesson_id: lesson,
          kind: 'homework',
          position,
          title: `Exercise ${String(position)}`,
          changed_by: teacher,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('journal_works')
        .set({ total: 10, changed_by: teacher, changed_how: 'entry' })
        .where('id', '=', row.id)
        .execute();
      return row.id;
    });

  beforeAll(async () => {
    database = await createTestDatabase();
    clock = new FixedClock(MOMENT);
    transactions = new Transactions(database.app, clock);
    cells = await CellsKit.create(database.migrator);
    branch = await insertBranch(database.migrator, 'North');
    const { year } = await cells.lessons.year(branch);
    const classId = await cells.lessons.load.classes.schoolClass(branch, year, { grade: 7 });
    [student = ''] = await cells.lessons.pupils(branch, classId, 1);
    teacher = await cells.lessons.load.classes.account();
    monday = await cells.lesson(branch, year, classId, '2026-11-16');
    wednesday = await cells.lesson(branch, year, classId, '2026-11-18');
    friday = await cells.lesson(branch, year, classId, '2026-11-20');
  }, 120_000);

  afterAll(async () => {
    await database.destroy();
  });

  it('refuses a work written at another lesson than the one where it was given', async () => {
    const error = await refusal(
      asApp((transaction) =>
        transaction
          .insertInto('journal_works')
          .values({
            branch_id: branch,
            lesson_id: wednesday,
            source_lesson_id: monday,
            kind: 'homework',
            position: 1,
            title: 'Exercise 1',
            changed_by: teacher,
          })
          .execute(),
      ),
    );
    expect(error).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_works_at_source' });
  });

  it('gives the application no right to write the lesson or the carry of a work', async () => {
    const work = await homework(monday, 1);
    const moved = await refusal(
      asApp((transaction) =>
        transaction
          .updateTable('journal_works')
          .set({ lesson_id: wednesday })
          .where('id', '=', work)
          .execute(),
      ),
    );
    expect(moved.code).toBe(INSUFFICIENT_PRIVILEGE);
    const carried = await refusal(
      asApp((transaction) =>
        transaction
          .updateTable('journal_works')
          .set({ carried_from_lesson_id: wednesday })
          .where('id', '=', work)
          .execute(),
      ),
    );
    expect(carried.code).toBe(INSUFFICIENT_PRIVILEGE);
    const inserted = await refusal(
      asApp((transaction) =>
        transaction
          .insertInto('journal_works')
          .values({
            branch_id: branch,
            lesson_id: friday,
            source_lesson_id: friday,
            kind: 'homework',
            position: 1,
            title: 'Exercise 1',
            carried_from_lesson_id: wednesday,
            changed_by: teacher,
          })
          .execute(),
      ),
    );
    expect(inserted.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('keeps a work at its lesson and refuses a carry outside the move, even for the migrator', async () => {
    const work = await homework(monday, 2);
    const moved = await refusal(
      asMigrator((transaction) =>
        transaction
          .updateTable('journal_works')
          .set({ lesson_id: wednesday })
          .where('id', '=', work)
          .execute(),
      ),
    );
    expect(moved).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_work_fixed' });
    const carried = await refusal(
      asMigrator((transaction) =>
        transaction
          .updateTable('journal_works')
          .set({ carried_from_lesson_id: wednesday })
          .where('id', '=', work)
          .execute(),
      ),
    );
    expect(carried).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_work_fixed' });
    const inserted = await refusal(
      asMigrator((transaction) =>
        transaction
          .insertInto('journal_works')
          .values({
            branch_id: branch,
            lesson_id: friday,
            source_lesson_id: friday,
            kind: 'homework',
            position: 2,
            title: 'Exercise 2',
            carried_from_lesson_id: wednesday,
          })
          .execute(),
      ),
    );
    expect(inserted).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_work_fixed' });
    // Even in the move mode a work goes only to the lesson where it was given.
    const elsewhere = await refusal(
      asMigrator(async (transaction) => {
        await sql`select set_config('app.homework_move', 'on', true)`.execute(transaction);
        await transaction
          .updateTable('journal_works')
          .set({ lesson_id: wednesday })
          .where('id', '=', work)
          .execute();
      }),
    );
    expect(elsewhere).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_work_fixed' });
  });

  it('moves a cell to another lesson only by the cascade of the move', async () => {
    const cell = await cells.cell(branch, {
      lessonId: monday,
      studentId: student,
      mark: 1,
      by: teacher,
      at: MOMENT,
    });
    const direct = await refusal(
      asMigrator((transaction) =>
        transaction
          .updateTable('journal_cells')
          .set({ lesson_id: wednesday })
          .where('id', '=', cell)
          .execute(),
      ),
    );
    expect(direct).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'journal_cell_lesson_fixed',
    });
    // In the move mode the cascade moves nothing but the lesson.
    const changed = await refusal(
      asMigrator(async (transaction) => {
        await sql`select set_config('app.homework_move', 'on', true)`.execute(transaction);
        await transaction
          .updateTable('journal_cells')
          .set({ lesson_id: wednesday, mark: 0 })
          .where('id', '=', cell)
          .execute();
      }),
    );
    expect(changed).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'journal_cell_lesson_fixed',
    });
    const row = await database.migrator
      .selectFrom('journal_cells')
      .select(['lesson_id', 'mark'])
      .where('id', '=', cell)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ lesson_id: monday, mark: 1 });
  });

  it('never lets the application write the move kind on a row', async () => {
    const work = await homework(friday, 3);
    const onWork = await refusal(
      asApp((transaction) =>
        transaction
          .updateTable('journal_works')
          .set({ total: 12, changed_by: teacher, changed_how: 'homework_move' })
          .where('id', '=', work)
          .execute(),
      ),
    );
    expect(onWork).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'journal_works_changed_how_check',
    });
    const onCell = await refusal(
      asApp((transaction) =>
        transaction
          .insertInto('journal_cells')
          .values({
            branch_id: branch,
            lesson_id: friday,
            student_id: student,
            work_id: work,
            score: 5,
            version: 1,
            changed_by: teacher,
            changed_how: 'homework_move',
            changed_at: new Date(MOMENT),
          })
          .execute(),
      ),
    );
    expect(onCell).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'journal_cells_changed_how_check',
    });
    const onComment = await refusal(
      asApp((transaction) =>
        transaction
          .insertInto('journal_comments')
          .values({
            branch_id: branch,
            student_id: student,
            target: 'note',
            lesson_id: friday,
            body: 'Tired today',
            visibility: 'staff',
            version: 1,
            changed_by: teacher,
            changed_how: 'homework_move',
            changed_at: new Date(MOMENT),
          })
          .execute(),
      ),
    );
    expect(onComment).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'journal_comments_changed_how_check',
    });
  });

  it('keeps every guard of the application in force when it sets the move mode itself', async () => {
    const work = await homework(monday, 4);
    await setEditDays(database.migrator, branch, 1);
    try {
      // Monday 16 November locks at 00:00 of 18 November; the save comes on 20 November.
      const error = await refusal(
        asApp(async (transaction) => {
          await sql`select set_config('app.homework_move', 'on', true)`.execute(transaction);
          await transaction
            .insertInto('journal_cells')
            .values({
              branch_id: branch,
              lesson_id: monday,
              student_id: student,
              work_id: work,
              score: 5,
              version: 1,
              changed_by: teacher,
              changed_how: 'entry',
              changed_at: new Date(MOMENT),
            })
            .execute();
        }),
      );
      expect(error).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_locked' });
    } finally {
      await setEditDays(database.migrator, branch, 3650);
    }
  });
});
