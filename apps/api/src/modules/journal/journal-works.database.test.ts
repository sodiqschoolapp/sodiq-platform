import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
const INSUFFICIENT_PRIVILEGE = '42501';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
/** Wednesday 14 October 2026, a school day before today. */
const DAY = '2026-10-14';

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

// The works of the journal in the database (db/migrations/0119; task 8.1, pull request
// #217). 07, The total: "Numbers cannot be typed for a work until its total is set";
// "A number above the total is refused"; "If a number already typed is above the new
// total, the change is refused". edge/journal: "at most 10 classworks and at most 10
// homeworks given"; "The homework columns move to the next held lesson, each as long as
// it has no numbers yet"; "'check at the next lesson' (once)". Every write is made as
// `sodiq_app` through the branch filter. All names are invented.
describe('journal works in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LessonsKit;
  let north: string;
  let account: string;
  let year = '';
  let quarter = '';
  let subject: string;

  const inBranch = <T>(work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([north], work);

  const audited = (transaction: Transaction) =>
    transaction
      .insertInto('audit_log')
      .values({ occurred_at: new Date(NOW), branch_id: north, action: 'test.works' })
      .execute();

  let slot = 0;
  /** A lesson of its own block on a date, as the application writes one. */
  async function lesson(classId: string, date = DAY): Promise<string> {
    const source = await kit.source(north, year, [{ classId, groupId: null, subjectId: subject }]);
    slot += 1;
    const minutes = 7 * 60 + (slot % 12) * 50;
    const time = (value: number) =>
      `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    return database.migrator.transaction().execute(async (transaction) => {
      const block = await transaction
        .insertInto('lesson_blocks')
        .values({
          branch_id: north,
          academic_year_id: year,
          quarter_id: quarter,
          lesson_date: date,
          starts_at: at(date, time(minutes)),
          ends_at: at(date, time(minutes + 45)),
          version_id: source.versionId,
          pattern_block_id: source.patternBlockId,
        })
        .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
        .executeTakeFirstOrThrow();
      const row = await transaction
        .insertInto('lessons')
        .values({
          branch_id: north,
          block_id: block.id,
          lesson_date: block.lesson_date,
          starts_at: block.starts_at,
          ends_at: block.ends_at,
          class_id: classId,
          subject_id: subject,
          load_row_id: source.lessons[0]?.loadRowId ?? '',
          pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
  }

  async function scene() {
    const classId = await kit.load.classes.schoolClass(north, year, { grade: 7 });
    const [student] = await kit.pupils(north, classId, 1);
    return { classId, student: student ?? '', lesson: await lesson(classId) };
  }

  /** A work added by hand, as the application inserts it (empty), then its total. */
  const work = (
    lessonId: string,
    input: { kind?: 'classwork' | 'homework'; position?: number; total?: number } = {},
  ) =>
    inBranch(async (transaction) => {
      await audited(transaction);
      const row = await transaction
        .insertInto('journal_works')
        .values({
          branch_id: north,
          lesson_id: lessonId,
          source_lesson_id: lessonId,
          kind: input.kind ?? 'classwork',
          position: input.position ?? 1,
          changed_by: account,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (input.total !== undefined) {
        await transaction
          .updateTable('journal_works')
          .set({ total: input.total, changed_by: account })
          .where('id', '=', row.id)
          .execute();
      }
      return row.id;
    });

  const setWork = (
    id: string,
    values: Partial<{
      total: number | null;
      not_held: boolean;
      lesson_id: string;
      carried_from_lesson_id: string | null;
      plan_work_id: string | null;
    }>,
  ) =>
    inBranch(async (transaction) => {
      await audited(transaction);
      await transaction
        .updateTable('journal_works')
        .set({ ...values, changed_by: account })
        .where('id', '=', id)
        .execute();
    });

  const number = (lessonId: string, student: string, workId: string, score: number | null) =>
    inBranch(async (transaction) => {
      await audited(transaction);
      return transaction
        .insertInto('journal_cells')
        .values({
          branch_id: north,
          lesson_id: lessonId,
          student_id: student,
          work_id: workId,
          score,
          version: 1,
          changed_by: account,
          changed_how: 'entry',
          changed_at: new Date(0),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    });

  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  async function untilWaiting(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await waitingForALock()) >= 1) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Nothing waited for a lock.');
  }

  async function holdOpen(work: (transaction: Transaction) => Promise<void>) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const done = inBranch(async (transaction) => {
      await work(transaction);
      ready();
      await released;
    }).catch((error: unknown) => error);
    await Promise.race([isReady, done]);
    return { release, done };
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    const made = await kit.year(north);
    year = made.year;
    quarter = made.quarters[0] ?? '';
    subject = await kit.load.classes.subject({ grades: [5, 6, 7, 8, 9, 10, 11] });
    account = await kit.load.classes.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('the rules of a number', () => {
    it('refuses a number before the total, above the total and on a work "not held", and takes one up to the total', async () => {
      const { lesson: id, student } = await scene();
      const empty = await work(id);
      expect((await refusal(number(id, student, empty, 3))).constraint).toBe(
        'journal_cell_no_total',
      );
      const totalled = await work(id, { position: 2, total: 10 });
      expect((await refusal(number(id, student, totalled, 11))).constraint).toBe(
        'journal_cell_above_total',
      );
      await number(id, student, totalled, 10);
      const dropped = await work(id, { position: 3, total: 10 });
      await setWork(dropped, { not_held: true });
      expect((await refusal(number(id, student, dropped, 4))).constraint).toBe(
        'journal_cell_not_held',
      );
    });

    it('refuses a total of 0 or 1001, a total cleared, and a total below a number typed', async () => {
      const { lesson: id, student } = await scene();
      const workId = await work(id, { total: 30 });
      await number(id, student, workId, 25);
      for (const total of [0, 1001]) {
        expect((await refusal(setWork(workId, { total }))).code).toBe(CHECK_VIOLATION);
      }
      expect((await refusal(setWork(workId, { total: null }))).constraint).toBe(
        'journal_work_total_cleared',
      );
      expect((await refusal(setWork(workId, { total: 20 }))).constraint).toBe(
        'journal_work_total_below',
      );
      await setWork(workId, { total: 25 });
    });
  });

  describe('at the same moment', () => {
    it('makes a change of the total wait for a number being saved, and refuses it after (the save first)', async () => {
      const { lesson: id, student } = await scene();
      const workId = await work(id, { total: 10 });
      const held = await holdOpen(async (transaction) => {
        await audited(transaction);
        await transaction
          .insertInto('journal_cells')
          .values({
            branch_id: north,
            lesson_id: id,
            student_id: student,
            work_id: workId,
            score: 8,
            version: 1,
            changed_by: account,
            changed_how: 'entry',
            changed_at: new Date(0),
          })
          .execute();
      });
      const change = refusal(setWork(workId, { total: 5 }));
      await untilWaiting();
      held.release();
      expect(await held.done).toBeUndefined();
      expect((await change).constraint).toBe('journal_work_total_below');
    });

    it('makes a number wait for a change of the total, and refuses it above the new total (the total first)', async () => {
      const { lesson: id, student } = await scene();
      const workId = await work(id, { total: 10 });
      const held = await holdOpen(async (transaction) => {
        await audited(transaction);
        await transaction
          .updateTable('journal_works')
          .set({ total: 5, changed_by: account })
          .where('id', '=', workId)
          .execute();
      });
      const typed = refusal(number(id, student, workId, 8));
      await untilWaiting();
      held.release();
      expect(await held.done).toBeUndefined();
      expect((await typed).constraint).toBe('journal_cell_above_total');
    });
  });

  describe('a work by hand', () => {
    it('takes at most 10 of a kind per lesson', async () => {
      const { lesson: id } = await scene();
      for (let position = 1; position <= 10; position += 1) await work(id, { position });
      await work(id, { kind: 'homework' });
      expect((await refusal(work(id, { position: 11 }))).code).toBe(CHECK_VIOLATION);
    });

    it('is deleted by the application only while it is empty and has no plan link', async () => {
      const { lesson: id, student } = await scene();
      const empty = await work(id);
      await inBranch(async (transaction) => {
        await audited(transaction);
        await transaction.deleteFrom('journal_works').where('id', '=', empty).execute();
      });
      const scored = await work(id, { position: 2, total: 5 });
      await number(id, student, scored, 3);
      const failed = await refusal(
        inBranch(async (transaction) => {
          await audited(transaction);
          await transaction.deleteFrom('journal_works').where('id', '=', scored).execute();
        }),
      );
      expect(failed.constraint).toBe('journal_cell_delete');
      const lines = await database.migrator
        .selectFrom('journal_work_history')
        .select(['changed_how', 'total_before'])
        .where('work_id', '=', empty)
        .execute();
      expect(lines).toEqual([{ changed_how: 'deleted', total_before: null }]);
    });
  });

  describe('the move and the carry', () => {
    it('moves a homework with no number to another lesson, its empty cells going with it, and refuses one with a number', async () => {
      const { classId, lesson: id, student } = await scene();
      const next = await lesson(classId, '2026-10-15');
      const homework = await work(id, { kind: 'homework', total: 5 });
      const cleared = await number(id, student, homework, 4);
      await inBranch(async (transaction) => {
        await audited(transaction);
        await transaction
          .updateTable('journal_cells')
          .set({ score: null, changed_by: account })
          .where('id', '=', cleared.id)
          .execute();
      });
      await setWork(homework, { lesson_id: next });
      const moved = await database.migrator
        .selectFrom('journal_works')
        .select(['lesson_id', 'total'])
        .where('id', '=', homework)
        .executeTakeFirstOrThrow();
      expect(moved).toEqual({ lesson_id: next, total: 5 });
      // The cell's lines stay in the history.
      const cellLines = await database.migrator
        .selectFrom('journal_cell_history')
        .select('score_after')
        .where('cell_id', '=', cleared.id)
        .orderBy('version')
        .execute();
      expect(cellLines.map((one) => one.score_after)).toEqual([4, null]);
      await number(next, student, homework, 2);
      expect((await refusal(setWork(homework, { lesson_id: id }))).constraint).toBe(
        'journal_work_move_numbers',
      );
    });

    // Task 8.2, code review round 1, defect 2: the comment of a cleared number
    // follows the move by the cascade, with no version, no moment and no line,
    // and no check of the student at the target lesson.
    it('moves a homework with the comment of a cleared number of a student who left before the target lesson', async () => {
      const { classId, lesson: id, student } = await scene();
      const next = await lesson(classId, '2026-10-15');
      const homework = await work(id, { kind: 'homework', total: 5 });
      const cell = await number(id, student, homework, 4);
      const comment = await inBranch(async (transaction) => {
        await audited(transaction);
        await transaction
          .updateTable('journal_cells')
          .set({ score: null, changed_by: account })
          .where('id', '=', cell.id)
          .execute();
        return (
          await transaction
            .insertInto('journal_comments')
            .values({
              branch_id: north,
              student_id: student,
              target: 'work',
              lesson_id: id,
              work_id: homework,
              body: 'Text',
              visibility: 'staff',
              version: 1,
              changed_by: account,
              changed_how: 'entry',
              changed_at: new Date(0),
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      });
      await inBranch(async (transaction) => {
        await audited(transaction);
        const leavingId = await kit.members.leaving(transaction, north, student, '2026-10-15');
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-10-15', ended_by: 'leaving', leaving_id: leavingId })
          .where('student_id', '=', student)
          .execute();
      });
      const expected = await sql<{ expected: boolean }>`
        select lesson_student_expected(${next}::uuid, ${student}::uuid) as expected
      `.execute(database.migrator);
      expect(expected.rows[0]?.expected).toBe(false);
      const before = await database.migrator
        .selectFrom('journal_comments')
        .select(['version', 'changed_at', 'changed_by', 'changed_how'])
        .where('id', '=', comment)
        .executeTakeFirstOrThrow();
      await setWork(homework, { lesson_id: next });
      expect(
        await database.migrator
          .selectFrom('journal_comments')
          .select(['lesson_id', 'version', 'changed_at', 'changed_by', 'changed_how'])
          .where('id', '=', comment)
          .executeTakeFirstOrThrow(),
      ).toEqual({ ...before, lesson_id: next });
      const lines = await database.migrator
        .selectFrom('journal_comment_history')
        .select('version')
        .where('comment_id', '=', comment)
        .execute();
      expect(lines.map((one) => one.version)).toEqual([1]);
    });

    it('sets the carry once, on a homework only', async () => {
      const { lesson: id } = await scene();
      const homework = await work(id, { kind: 'homework' });
      await setWork(homework, { carried_from_lesson_id: id });
      expect((await refusal(setWork(homework, { carried_from_lesson_id: null }))).constraint).toBe(
        'journal_work_carry_once',
      );
      const classwork = await work(id, { position: 2 });
      expect((await refusal(setWork(classwork, { carried_from_lesson_id: id }))).code).toBe(
        CHECK_VIOLATION,
      );
    });
  });

  describe('the plan link', () => {
    async function planWork(position: number, itemId?: string) {
      const plan = await database.migrator
        .insertInto('lesson_plans')
        .values({ branch_id: north, quarter_id: quarter, subject_id: subject })
        .returning('id')
        .executeTakeFirstOrThrow();
      const item =
        itemId ??
        (
          await database.migrator
            .insertInto('lesson_plan_items')
            .values({ branch_id: north, plan_id: plan.id, topic: 'Fractions' })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      const row = await database.migrator
        .insertInto('lesson_plan_works')
        .values({ branch_id: north, item_id: item, kind: 'classwork', position, title: 'Test' })
        .returning(['id', 'item_id'])
        .executeTakeFirstOrThrow();
      return { id: row.id, itemId: row.item_id, planId: plan.id };
    }

    it('is set from none, moves only to the copy of its work, never back to none, and keeps the plan work from removal', async () => {
      const { lesson: id } = await scene();
      const original = await planWork(1);
      const handWork = await work(id);
      await setWork(handWork, { plan_work_id: original.id });
      const copyItem = await database.migrator
        .insertInto('lesson_plan_items')
        .values({
          branch_id: north,
          plan_id: original.planId,
          topic: 'Fractions',
          copied_from: original.itemId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const copy = await planWork(1, copyItem.id);
      const stranger = await planWork(1);
      expect((await refusal(setWork(handWork, { plan_work_id: stranger.id }))).constraint).toBe(
        'journal_work_plan_link',
      );
      await setWork(handWork, { plan_work_id: copy.id });
      expect((await refusal(setWork(handWork, { plan_work_id: null }))).constraint).toBe(
        'journal_work_plan_link',
      );
      const removed = await refusal(
        inBranch((transaction) =>
          transaction.deleteFrom('lesson_plan_works').where('id', '=', copy.id).execute(),
        ),
      );
      expect(removed.constraint).toBe('journal_works_plan_work_fkey');
    });
  });

  describe('the history', () => {
    it('writes a line for a total and "not held", lets the application neither change nor delete it nor insert one, and refuses a commit without an audit entry', async () => {
      const { lesson: id } = await scene();
      const workId = await work(id, { total: 10 });
      await setWork(workId, { not_held: true });
      const lines = await database.migrator
        .selectFrom('journal_work_history')
        .select(['total_before', 'total_after', 'not_held_before', 'not_held_after', 'changed_how'])
        .where('work_id', '=', workId)
        .orderBy('version')
        .execute();
      expect(lines).toEqual([
        {
          total_before: null,
          total_after: 10,
          not_held_before: false,
          not_held_after: false,
          changed_how: 'entry',
        },
        {
          total_before: 10,
          total_after: 10,
          not_held_before: false,
          not_held_after: true,
          changed_how: 'entry',
        },
      ]);
      const changed = await refusal(
        inBranch((transaction) =>
          transaction
            .updateTable('journal_work_history')
            .set({ total_after: 1 })
            .where('work_id', '=', workId)
            .execute(),
        ),
      );
      expect(changed.code).toBe(INSUFFICIENT_PRIVILEGE);
      const deleted = await refusal(
        inBranch((transaction) =>
          transaction.deleteFrom('journal_work_history').where('work_id', '=', workId).execute(),
        ),
      );
      expect(deleted.code).toBe(INSUFFICIENT_PRIVILEGE);
      const inserted = await refusal(
        inBranch((transaction) =>
          transaction
            .insertInto('journal_work_history')
            .values({
              branch_id: north,
              work_id: workId,
              lesson_id: id,
              kind: 'classwork',
              version: 9,
              changed_how: 'entry',
              changed_at: new Date(NOW),
            })
            .execute(),
        ),
      );
      expect(inserted.constraint).toBe('journal_work_history_direct');
      const unaudited = await refusal(
        inBranch((transaction) =>
          transaction
            .updateTable('journal_works')
            .set({ total: 20, changed_by: account })
            .where('id', '=', workId)
            .execute(),
        ),
      );
      expect(unaudited).toBeDefined();
      const kept = await database.migrator
        .selectFrom('journal_works')
        .select('total')
        .where('id', '=', workId)
        .executeTakeFirstOrThrow();
      expect(kept.total).toBe(10);
    });
  });

  describe('the days a shorter year cuts off (From 3.6b-2)', () => {
    it('holds a day with a mark or a number of a student as kind entry', async () => {
      const { lesson: id, student } = await scene();
      await inBranch(async (transaction) => {
        await audited(transaction);
        await transaction
          .insertInto('journal_cells')
          .values({
            branch_id: north,
            lesson_id: id,
            student_id: student,
            mark: 1,
            version: 1,
            changed_by: account,
            changed_how: 'entry',
            changed_at: new Date(0),
          })
          .execute();
      });
      const holds = await inBranch(async (transaction) => {
        const found = await sql<{ kind: string; student_id: string; valid_from: string }>`
          select kind, student_id, valid_from::text as valid_from
          from year_cut_holds(${year}::uuid, date '2026-09-01', date '2026-10-13')
          where kind = 'entry' and student_id = ${student}::uuid
        `.execute(transaction);
        return found.rows;
      });
      expect(holds).toEqual([{ kind: 'entry', student_id: student, valid_from: DAY }]);
    });
  });
});
