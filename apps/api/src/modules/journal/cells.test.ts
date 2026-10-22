import { apiErrorSchema } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { CellsKit } from '../../testing/cells-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { Audit } from '../audit/audit.service.js';
import { cellHistory } from './cell-history.js';
import { saveCells, type CellSave } from './cells.js';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
const DAY = '2026-10-14';

/** The code and details of a refusal of the writer, or a failure when it saved. */
async function refusal(work: Promise<unknown>): Promise<ApiException> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ApiException) return error;
    throw error;
  }
  throw new Error('The writer did not refuse it.');
}

// The writer of journal cells (task 6.1a, pull request #205; edge/journal,
// Saving and working together: "Each cell has a version. A save based on an
// old version is refused, the stored value is kept, and both values are shown
// for the user to choose. Nothing is overwritten silently"; 07: "Every cell
// keeps its history: old value, new value, who and when"). All names are
// invented.
describe('saveCells', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let audit: Audit;
  let cells: CellsKit;
  let north: string;
  let year: string;
  let teacher: string;
  let colleague: string;

  const inNorth = <T>(work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([north], work);

  const save = (saves: readonly CellSave[], accountId = teacher) =>
    inNorth((transaction) =>
      saveCells(transaction, audit, { accountId, requestId: 'request-1' }, saves),
    );

  /** A class with students from 1 September and a lesson of it on DAY. */
  async function scene(count = 1) {
    const classId = await cells.lessons.load.classes.schoolClass(north, year, { grade: 7 });
    const students = await cells.lessons.pupils(north, classId, count);
    return { classId, students, lesson: await cells.lesson(north, year, classId, DAY) };
  }

  const attendance = (
    lessonId: string,
    studentId: string,
    value: number | null,
    version: number | null,
  ): CellSave => ({ lessonId, studentId, workId: null, value, version });

  const stored = (lessonId: string) =>
    database.migrator
      .selectFrom('journal_cells')
      .select(['id', 'student_id', 'mark', 'version', 'changed_by'])
      .where('lesson_id', '=', lessonId)
      .orderBy('student_id')
      .execute();

  /** Runs `work` in a transaction of the application that stays open until released. */
  async function holdOpen(work: (transaction: Transaction) => Promise<unknown>) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const done = inNorth(async (transaction) => {
      await work(transaction);
      ready();
      await released;
    }).catch((error: unknown) => error);
    await Promise.race([isReady, done]);
    return { release, done };
  }

  async function untilWaiting(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const found = await sql<{ waiting: number }>`
        select count(distinct l.pid)::int as waiting
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and not l.granted
      `.execute(database.migrator);
      if ((found.rows[0]?.waiting ?? 0) >= 1) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Nothing waited for a lock.');
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    const clock = new FixedClock(NOW);
    transactions = new Transactions(database.app, clock);
    audit = new Audit(clock);
    cells = await CellsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    year = (await cells.lessons.year(north)).year;
    teacher = await cells.lessons.load.classes.account();
    colleague = await cells.lessons.load.classes.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('stale saves (done when: a stale save is refused)', () => {
    it('refuses a save from an old version with the stored value, and keeps it', async () => {
      const { lesson, students } = await scene();
      const student = students[0] ?? '';
      const [first] = await save([attendance(lesson, student, 1, null)]);
      expect(first).toMatchObject({ value: 1, version: 1 });
      expect((await save([attendance(lesson, student, 2, 1)]))[0]?.version).toBe(2);
      const failed = await refusal(save([attendance(lesson, student, 0, 1)], colleague));
      expect(failed.code).toBe('cell_stale');
      expect(failed.getStatus()).toBe(409);
      expect(failed.details).toEqual([
        {
          path: 'saves.0',
          code: 'cell_stale',
          message: 'The cell was changed since it was read.',
          recordId: first?.id,
          storedCell: {
            value: 2,
            version: 2,
            changedBy: teacher,
            changedAt: new Date(NOW).toISOString(),
          },
        },
      ]);
      // The details fit the one error shape of the API.
      expect(
        apiErrorSchema.safeParse({
          error: { code: 'cell_stale', message: 'x', requestId: 'r', details: failed.details },
        }).success,
      ).toBe(true);
      expect(await stored(lesson)).toMatchObject([{ mark: 2, version: 2, changed_by: teacher }]);
    });

    it('saves the first of two sessions from one version and refuses the second with its value', async () => {
      const { lesson, students } = await scene();
      const student = students[0] ?? '';
      await save([attendance(lesson, student, 1, null)]);
      await save([attendance(lesson, student, 0, 1)], teacher);
      const failed = await refusal(save([attendance(lesson, student, 2, 1)], colleague));
      expect(failed.details?.[0]?.storedCell).toMatchObject({ value: 0, version: 2 });
      expect(await stored(lesson)).toMatchObject([{ mark: 0, version: 2 }]);
    });

    it('refuses the second of two first saves at one moment, never with a 500', async () => {
      const { lesson, students } = await scene();
      const student = students[0] ?? '';
      const held = await holdOpen((transaction) =>
        saveCells(transaction, audit, { accountId: teacher }, [
          attendance(lesson, student, 1, null),
        ]),
      );
      const second = refusal(save([attendance(lesson, student, 0, null)], colleague));
      await untilWaiting();
      held.release();
      expect(await held.done).toBeUndefined();
      const failed = await second;
      expect(failed.code).toBe('cell_stale');
      expect(failed.details?.[0]?.storedCell).toMatchObject({
        value: 1,
        version: 1,
        changedBy: teacher,
      });
      expect(await stored(lesson)).toMatchObject([{ mark: 1, version: 1 }]);
    });

    it('saves nothing of a call with one stale cell', async () => {
      const { lesson, students } = await scene(2);
      const [one, two] = students;
      await save([attendance(lesson, one ?? '', 1, null)]);
      await save([attendance(lesson, one ?? '', 2, 1)]);
      const failed = await refusal(
        save([attendance(lesson, two ?? '', 1, null), attendance(lesson, one ?? '', 0, 1)]),
      );
      expect(failed.details?.map((detail) => detail.path)).toEqual(['saves.1']);
      expect(await stored(lesson)).toMatchObject([{ student_id: one, mark: 2 }]);
    });

    it('takes two calls of the same cells in opposite orders one after the other', async () => {
      const { lesson, students } = await scene(2);
      const [one, two] = [students[0] ?? '', students[1] ?? ''];
      const held = await holdOpen((transaction) =>
        saveCells(transaction, audit, { accountId: teacher }, [
          attendance(lesson, two, 1, null),
          attendance(lesson, one, 1, null),
        ]),
      );
      const second = refusal(
        save([attendance(lesson, one, 0, null), attendance(lesson, two, 0, null)], colleague),
      );
      await untilWaiting();
      held.release();
      expect(await held.done).toBeUndefined();
      expect((await second).code).toBe('cell_stale');
      expect((await stored(lesson)).map((row) => row.mark)).toEqual([1, 1]);
    });
  });

  describe('history (done when: history records who changed what)', () => {
    it('lists each change with its version, old and new value, who and how', async () => {
      const { lesson, students } = await scene();
      const student = students[0] ?? '';
      const [cell] = await save([attendance(lesson, student, 1, null)]);
      await save([attendance(lesson, student, 0, 1)], colleague);
      await save([attendance(lesson, student, null, 2)]);
      const lines = await inNorth((transaction) => cellHistory(transaction, cell?.id ?? ''));
      expect(lines.map((line) => [line.version, line.before, line.after, line.changedBy])).toEqual([
        [1, null, 1, teacher],
        [2, 1, 0, colleague],
        [3, 0, null, teacher],
      ]);
      expect(lines.every((line) => line.changedHow === 'entry')).toBe(true);
      // Every update names its sender: the stored cell is the last one's.
      expect(await stored(lesson)).toMatchObject([{ mark: null, version: 3, changed_by: teacher }]);
    });

    it('writes one audit entry per call, with the actor, the assignment and the request', async () => {
      const { lesson, students } = await scene(2);
      const before = await database.migrator.selectFrom('audit_log').select('id').execute();
      const written = await inNorth((transaction) =>
        saveCells(
          transaction,
          audit,
          { accountId: teacher, requestId: 'request-9' },
          students.map((student) => attendance(lesson, student, 1, null)),
        ),
      );
      const entries = await database.migrator
        .selectFrom('audit_log')
        .selectAll()
        .where('id', 'not in', before.length === 0 ? [''] : before.map((row) => row.id))
        .execute();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        action: 'journal.cells_save',
        actor_id: teacher,
        branch_id: north,
        request_id: 'request-9',
        details: { count: 2 },
        new_value: {
          cells: written
            .map((cell) => ({ id: cell.id, version: 1 }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        },
      });
    });
  });

  describe('values', () => {
    it('keeps a cleared cell with one more version, and writes nothing for an empty first save', async () => {
      const { lesson, students } = await scene(2);
      const [one, two] = [students[0] ?? '', students[1] ?? ''];
      await save([attendance(lesson, one, 3, null)]);
      const [cleared] = await save([attendance(lesson, one, null, 1)]);
      expect(cleared).toMatchObject({ value: null, version: 2 });
      expect(await save([attendance(lesson, two, null, null)])).toEqual([]);
      expect((await stored(lesson)).map((row) => row.student_id)).toEqual([one]);
    });

    it('saves the number of a work', async () => {
      const { lesson, students } = await scene();
      const work = await database.migrator
        .insertInto('journal_works')
        .values({ branch_id: north, lesson_id: lesson, kind: 'homework', total: 30 })
        .returning('id')
        .executeTakeFirstOrThrow();
      const [cell] = await save([
        {
          lessonId: lesson,
          studentId: students[0] ?? '',
          workId: work.id,
          value: 12,
          version: null,
        },
      ]);
      expect(cell).toMatchObject({ workId: work.id, value: 12, version: 1 });
    });
  });

  describe('closed cells and cancelled lessons', () => {
    it('answers cell_closed for a student not expected and for an unknown lesson', async () => {
      const { lesson } = await scene();
      const other = await scene();
      const failed = await refusal(save([attendance(lesson, other.students[0] ?? '', 1, null)]));
      expect(failed.code).toBe('cell_closed');
      const unknown = await refusal(
        save([
          attendance('0190a000-0000-7000-8000-000000000000', other.students[0] ?? '', 1, null),
        ]),
      );
      expect(unknown.code).toBe('cell_closed');
      expect(await stored(lesson)).toEqual([]);
    });

    it('answers lesson_cancelled_cell for a cancelled lesson', async () => {
      const { lesson, students } = await scene();
      await inNorth(async (transaction) => {
        await audit.record(transaction, {
          branchId: north,
          actorId: teacher,
          action: 'test.cancel',
        });
        await transaction
          .updateTable('lessons')
          .set({ cancel_cause: 'reason', cancel_reason: 'The class is on a trip' })
          .where('id', '=', lesson)
          .execute();
      });
      const failed = await refusal(save([attendance(lesson, students[0] ?? '', 1, null)]));
      expect(failed.code).toBe('lesson_cancelled_cell');
      expect(await stored(lesson)).toEqual([]);
    });
  });
});
