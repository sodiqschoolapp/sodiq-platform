import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch, setEditDays } from '../../testing/branch-filter-sql.js';
import { CellsKit } from '../../testing/cells-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
/** Monday 23 November 2026: with one edit day, every lesson of the test is locked. */
const MOMENT = '2026-11-23T10:00:00+05:00';
const KEPT = '2026-11-10T10:00:00+05:00';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// Task 11.24 (0186, `journal_restore_names`; the plan's decision 13): a forced-delete store kept
// before 0186 may hold a homework at the lesson that checked it, given at another lesson; its
// restore puts the homework back at the lesson where it was given. The journal's guards let
// through, in the restore's own transaction, only the store's rows: at the store's lesson, or a
// kept work and its cells at the lesson where that work was given. Any other write at those
// lessons is judged as always (here: after the lock), and a kept row cannot be put back at a
// lesson that is neither. Each test restores a store of its own in its own transaction, as the
// restore route does (the store row first, `forced-deletes.service.ts`). Names are invented.
describe('a restore of a kept homework opens only its own rows', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let branch: string;
  let teacher: string;
  let student: string;
  let given: string;
  let checked: string;
  let other: string;
  /** A work stored at `given` before the store, with a total: a column a write may meet. */
  let standing: string;
  /** The place of each store's homework among the works added by hand at its lesson. */
  let place = 0;

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(MOMENT));
    const cells = await CellsKit.create(database.migrator);
    branch = await insertBranch(database.migrator, 'North');
    const { year } = await cells.lessons.year(branch);
    const classId = await cells.lessons.load.classes.schoolClass(branch, year, { grade: 7 });
    [student = ''] = await cells.lessons.pupils(branch, classId, 1);
    teacher = await cells.lessons.load.classes.account();
    given = await cells.lesson(branch, year, classId, '2026-11-16');
    checked = await cells.lesson(branch, year, classId, '2026-11-18');
    other = await cells.lesson(branch, year, classId, '2026-11-20');
    standing = (
      await database.migrator
        .insertInto('journal_works')
        .values({
          branch_id: branch,
          lesson_id: given,
          source_lesson_id: given,
          kind: 'classwork',
          position: 9,
          title: 'Quiz',
          total: 10,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await setEditDays(database.migrator, branch, 1);
  }, 120_000);

  afterAll(async () => {
    await database.destroy();
  });

  /**
   * A store of the lesson `checked`, kept before 0186: a homework given at `given`, stored at
   * `checked`, with a number of the student and a kept attendance mark. Written as the migrator
   * at the moment it was kept; answers its ids.
   */
  async function store() {
    place += 1;
    const ids = {
      store: '',
      work: randomUUID(),
      cell: randomUUID(),
      mark: randomUUID(),
      position: place,
    };
    const row = await database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${new Date(KEPT).toISOString()}, true)`.execute(
        transaction,
      );
      return transaction
        .insertInto('forced_deletes')
        .values({
          branch_id: branch,
          record_type: 'lesson',
          record_id: checked,
          reason: 'Entered on the wrong day',
          deleted_by: teacher,
          deleted_at: new Date(0),
          restore_until: new Date(0),
          rows: JSON.stringify({
            works: [
              {
                id: ids.work,
                kind: 'homework',
                total: 10,
                not_held: false,
                source_lesson_id: given,
                plan_work_id: null,
                position: ids.position,
                carried_from_lesson_id: null,
                version: 2,
                changed_by: teacher,
                changed_how: 'entry',
                changed_at: KEPT,
              },
            ],
            cells: [
              {
                id: ids.cell,
                student_id: student,
                work_id: ids.work,
                mark: null,
                score: 7,
                version: 1,
                changed_by: teacher,
                changed_how: 'entry',
                changed_at: KEPT,
              },
              {
                id: ids.mark,
                student_id: student,
                work_id: null,
                mark: 1,
                score: null,
                version: 1,
                changed_by: teacher,
                changed_how: 'entry',
                changed_at: KEPT,
              },
            ],
          }),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    });
    ids.store = row.id;
    return ids;
  }

  /** A transaction of the application that restores the store first, then runs `work`. */
  const restoring = <T>(storeId: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], async (transaction) => {
      await transaction
        .insertInto('audit_log')
        .values({ occurred_at: new Date(MOMENT), branch_id: branch, action: 'test.restore' })
        .execute();
      await transaction
        .updateTable('forced_deletes')
        .set({ restored_by: teacher, restored_at: new Date(0) })
        .where('id', '=', storeId)
        .execute();
      return work(transaction);
    });

  const keptWork = (
    transaction: Transaction,
    kept: { work: string; position: number },
    lesson: string,
  ) =>
    transaction
      .insertInto('journal_works')
      .values({
        id: kept.work,
        branch_id: branch,
        lesson_id: lesson,
        source_lesson_id: lesson,
        kind: 'homework',
        position: kept.position,
        total: 10,
        not_held: false,
        version: 2,
        changed_by: teacher,
        changed_how: 'restored',
        changed_at: new Date(KEPT),
      })
      .execute();

  const cell = (
    transaction: Transaction,
    values: { id?: string; lesson: string; work: string | null; mark?: number; score?: number },
  ) =>
    transaction
      .insertInto('journal_cells')
      .values({
        ...(values.id === undefined ? {} : { id: values.id }),
        branch_id: branch,
        lesson_id: values.lesson,
        student_id: student,
        work_id: values.work,
        mark: values.mark ?? null,
        score: values.score ?? null,
        version: 1,
        changed_by: teacher,
        changed_how: 'entry',
        changed_at: new Date(KEPT),
      })
      .execute();

  it('puts the kept homework and its number back at the lesson where it was given, though locked', async () => {
    const kept = await store();
    await restoring(kept.store, async (transaction) => {
      await keptWork(transaction, kept, given);
      await cell(transaction, { id: kept.cell, lesson: given, work: kept.work, score: 7 });
    });
    const row = await database.migrator
      .selectFrom('journal_cells')
      .select(['lesson_id', 'score', 'changed_how'])
      .where('id', '=', kept.cell)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ lesson_id: given, score: 7, changed_how: 'restored' });
  });

  it('judges an attendance mark at the lesson where the kept homework was given as any write', async () => {
    const kept = await store();
    const error = await refusal(
      restoring(kept.store, async (transaction) => {
        await keptWork(transaction, kept, given);
        await cell(transaction, { lesson: given, work: null, mark: 1 });
      }),
    );
    expect(error).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_locked' });
  });

  it('judges a number of another work at that lesson as any write', async () => {
    const kept = await store();
    const error = await refusal(
      restoring(kept.store, async (transaction) => {
        await keptWork(transaction, kept, given);
        await cell(transaction, { lesson: given, work: standing, score: 5 });
      }),
    );
    expect(error).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_locked' });
  });

  it('refuses to put a kept row back at a lesson that is neither the store’s nor where its work was given', async () => {
    const kept = await store();
    // The kept homework at a third lesson: no store work was given there.
    const work = await refusal(
      restoring(kept.store, (transaction) => keptWork(transaction, kept, other)),
    );
    expect(work).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_work_insert_data' });
    // The kept attendance mark at the lesson where the homework was given: not the store's
    // lesson, and a mark has no work, so it is an ordinary write there, after the lock.
    const mark = await refusal(
      restoring(kept.store, (transaction) =>
        cell(transaction, { id: kept.mark, lesson: given, work: null, mark: 1 }),
      ),
    );
    expect(mark).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_locked' });
    const none = await database.migrator
      .selectFrom('journal_cells')
      .select('id')
      .where('id', 'in', [kept.cell, kept.mark])
      .execute();
    expect(none).toEqual([]);
  });
});
