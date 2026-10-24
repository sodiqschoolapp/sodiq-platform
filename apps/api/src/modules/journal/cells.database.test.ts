import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { lessonsHoldingData } from '../timetable/lesson-data.js';
import { expectedStudents } from './expected-students.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const INSUFFICIENT_PRIVILEGE = '42501';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
/** Wednesday 14 October 2026, a school day before today. */
const DAY = '2026-10-14';

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

// Journal cells, their versions and their history in the database
// (db/migrations/0108; task 6.1a, pull request #205). edge/developer-rules,
// Cells: "Unique on (lesson, student, work). Each cell has a version number
// used to refuse stale saves." History and audit: "Append-only ...
// Partitioned by month." 07: "A student's cells start on the date they joined
// the class or group and end on the date they left. Other cells are closed."
// Every write is made as `sodiq_app` through the branch filter. All names are
// invented.
describe('journal cells in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LessonsKit;
  let north: string;
  let south: string;
  let account: string;
  let other: string;
  const years = new Map<string, { year: string; quarters: string[] }>();
  let subject: string;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** An audit entry of the transaction in the branch, as `saveCells` writes one. */
  const audited = (transaction: Transaction, branch: string) =>
    transaction
      .insertInto('audit_log')
      .values({ occurred_at: new Date(NOW), branch_id: branch, action: 'test.cells' })
      .execute();

  /** A class of grade 7 in the branch's year. */
  const schoolClass = (branch = north) =>
    kit.load.classes.schoolClass(branch, years.get(branch)?.year ?? '', { grade: 7 });

  /** The start of the next test lesson: each one at its own time, so a class never meets itself. */
  let slot = 0;
  const nextStart = () => {
    slot += 1;
    const minutes = 7 * 60 + (slot % 12) * 50;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  };
  const endOf = (start: string) => {
    const [hours, minutes] = start.split(':').map(Number);
    const end = (hours ?? 0) * 60 + (minutes ?? 0) + 45;
    return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
  };

  /** A lesson of its own block on a date, of a class or a group, as the application writes one. */
  async function lesson(
    branch: string,
    unit: { classId: string } | { groupId: string; classIds: string[] },
    date = DAY,
  ): Promise<string> {
    const year = years.get(branch)?.year ?? '';
    const source = await kit.source(branch, year, [
      'classId' in unit
        ? { classId: unit.classId, groupId: null, subjectId: subject }
        : { classId: null, groupId: unit.groupId, subjectId: subject },
    ]);
    const start = nextStart();
    return database.migrator.transaction().execute(async (transaction) => {
      const block = await transaction
        .insertInto('lesson_blocks')
        .values({
          branch_id: branch,
          academic_year_id: year,
          quarter_id: years.get(branch)?.quarters[0] ?? '',
          lesson_date: date,
          starts_at: at(date, start),
          ends_at: at(date, endOf(start)),
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
          class_id: 'classId' in unit ? unit.classId : null,
          group_id: 'groupId' in unit ? unit.groupId : null,
          subject_id: subject,
          load_row_id: source.lessons[0]?.loadRowId ?? '',
          pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
  }

  /** A class with one student from 1 September and a lesson of it on DAY. */
  async function scene(branch = north) {
    const classId = await schoolClass(branch);
    const [student] = await kit.pupils(branch, classId, 1);
    return { classId, student: student ?? '', lesson: await lesson(branch, { classId }) };
  }

  /** A work of a lesson, written by the migrator (8.1 writes them). */
  const work = (branch: string, lessonId: string, total: number | null = null, notHeld = false) =>
    database.migrator
      .insertInto('journal_works')
      .values({
        branch_id: branch,
        lesson_id: lessonId,
        kind: 'classwork',
        total,
        not_held: notHeld,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  /** A cell written as the application, with its audit entry. */
  const cell = (
    branch: string,
    input: { lesson: string; student: string; work?: string; mark?: number; score?: number },
    by = account,
  ) =>
    inBranch(branch, async (transaction) => {
      await audited(transaction, branch);
      return transaction
        .insertInto('journal_cells')
        .values({
          branch_id: branch,
          lesson_id: input.lesson,
          student_id: input.student,
          work_id: input.work ?? null,
          mark: input.mark ?? null,
          score: input.score ?? null,
          version: 1,
          changed_by: by,
          changed_how: 'entry',
          changed_at: new Date(0),
        })
        .returning(['id', 'version', 'changed_at'])
        .executeTakeFirstOrThrow();
    });

  /** A change of a cell as the application, with its audit entry. */
  const change = (
    branch: string,
    id: string,
    values: { mark?: number | null; score?: number | null; version?: number },
    by = account,
  ) =>
    inBranch(branch, async (transaction) => {
      await audited(transaction, branch);
      return transaction
        .updateTable('journal_cells')
        .set({ ...values, changed_by: by, changed_how: 'entry' } as never)
        .where('id', '=', id)
        .returning(['version', 'mark', 'score'])
        .executeTakeFirstOrThrow();
    });

  const historyOf = (cellId: string) =>
    database.migrator
      .selectFrom('journal_cell_history')
      .selectAll()
      .where('cell_id', '=', cellId)
      .orderBy('version')
      .execute();

  /** How many connections to the test database wait for a lock right now. */
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

  /** Runs `work` in a transaction of the application that stays open until released. */
  async function holdOpen(branch: string, work: (transaction: Transaction) => Promise<void>) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const done = inBranch(branch, async (transaction) => {
      await work(transaction);
      ready();
      await released;
    }).catch((error: unknown) => error);
    await Promise.race([isReady, done]);
    return { release, done };
  }

  /** A save of a mark as `saveCells` makes it: the lesson FOR SHARE first, then the cell. */
  const saveMark = (transaction: Transaction, branch: string, lessonId: string, student: string) =>
    transaction
      .selectFrom('lessons')
      .select('id')
      .where('id', '=', lessonId)
      .forShare()
      .execute()
      .then(() => audited(transaction, branch))
      .then(() =>
        transaction
          .insertInto('journal_cells')
          .values({
            branch_id: branch,
            lesson_id: lessonId,
            student_id: student,
            mark: 1,
            version: 1,
            changed_by: account,
            changed_how: 'entry',
            changed_at: new Date(0),
          })
          .execute()
          .then(() => undefined),
      );

  /** A cancel of the lesson, as a one-day change writes it. */
  const cancel = (transaction: Transaction, branch: string, lessonId: string) =>
    audited(transaction, branch).then(() =>
      transaction
        .updateTable('lessons')
        .set({ cancel_cause: 'reason', cancel_reason: 'The class is on a trip' })
        .where('id', '=', lessonId)
        .execute()
        .then(() => undefined),
    );

  /** A leaving of the student from a date, as the leaving writes its rows. */
  const cut = async (transaction: Transaction, student: string, from: string) => {
    await audited(transaction, north);
    const leavingId = await kit.members.leaving(transaction, north, student, from);
    await transaction
      .updateTable('class_memberships')
      .set({ valid_until: from, ended_by: 'leaving', leaving_id: leavingId })
      .where('student_id', '=', student)
      .execute();
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    years.set(north, await kit.year(north));
    years.set(south, await kit.year(south));
    subject = await kit.load.classes.subject({ grades: [5, 6, 7, 8, 9, 10, 11] });
    account = await kit.load.classes.account();
    other = await kit.load.classes.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('cells: unique on (lesson, student, work)', () => {
    it('refuses a second attendance cell of a student in a lesson', async () => {
      const { lesson: id, student } = await scene();
      await cell(north, { lesson: id, student, mark: 1 });
      const failed = await refusal(cell(north, { lesson: id, student, mark: 0 }));
      expect(failed.code).toBe(UNIQUE_VIOLATION);
      expect(failed.constraint).toBe('journal_cells_key');
    });

    it('refuses a second cell of one work, and keeps a cell per work', async () => {
      const { lesson: id, student } = await scene();
      const first = await work(north, id, 10);
      const second = await work(north, id, 10);
      await cell(north, { lesson: id, student, work: first, score: 3 });
      await cell(north, { lesson: id, student, work: second, score: 4 });
      const failed = await refusal(cell(north, { lesson: id, student, work: first, score: 5 }));
      expect(failed.code).toBe(UNIQUE_VIOLATION);
      expect(failed.constraint).toBe('journal_cells_key');
    });

    it('refuses a cell of a work of another lesson', async () => {
      const { lesson: id, student, classId } = await scene();
      const elsewhere = await work(north, await lesson(north, { classId }), 10);
      const failed = await refusal(cell(north, { lesson: id, student, work: elsewhere, score: 3 }));
      expect(failed.code).toBe(FOREIGN_KEY_VIOLATION);
      expect(failed.constraint).toBe('journal_cells_work_fkey');
    });

    it('refuses a number on the attendance cell and a mark on a work, and marks 4 and 5', async () => {
      const { lesson: id, student } = await scene();
      const workId = await work(north, id, 10);
      expect((await refusal(cell(north, { lesson: id, student, score: 3 }))).constraint).toBe(
        'journal_cells_attendance_check',
      );
      expect(
        (await refusal(cell(north, { lesson: id, student, work: workId, mark: 1 }))).constraint,
      ).toBe('journal_cells_work_check');
      for (const mark of [4, 5, -1]) {
        expect((await refusal(cell(north, { lesson: id, student, mark }))).constraint).toBe(
          'journal_cells_mark_check',
        );
      }
    });
  });

  describe('the version', () => {
    it('is 1 on insert and one more on every update, whatever is sent', async () => {
      const { lesson: id, student } = await scene();
      const written = await cell(north, { lesson: id, student, mark: 1 });
      expect(written.version).toBe(1);
      expect((await change(north, written.id, { mark: 0 })).version).toBe(2);
      // The version has no update grant: sending one is refused outright.
      const failed = await refusal(change(north, written.id, { mark: 2, version: 1 }));
      expect(failed.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect((await change(north, written.id, { mark: 2 })).version).toBe(3);
    });

    it('is overwritten on insert', async () => {
      const { lesson: id, student } = await scene();
      const written = await inBranch(north, async (transaction) => {
        await audited(transaction, north);
        return transaction
          .insertInto('journal_cells')
          .values({
            branch_id: north,
            lesson_id: id,
            student_id: student,
            mark: 1,
            version: 7,
            changed_by: account,
            changed_how: 'entry',
            changed_at: new Date(0),
          })
          .returning(['version', 'changed_at'])
          .executeTakeFirstOrThrow();
      });
      expect(written.version).toBe(1);
      expect(new Date(written.changed_at).toISOString()).toBe(new Date(NOW).toISOString());
    });

    it('needs the transaction moment', async () => {
      const { lesson: id, student } = await scene();
      const failed = await refusal(
        database.app.transaction().execute((transaction) =>
          sql`select set_config('app.branch_ids', ${`{${north}}`}, true)`
            .execute(transaction)
            .then(() =>
              transaction
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
                .execute(),
            ),
        ),
      );
      expect(failed.constraint).toBe('journal_cell_moment');
    });
  });

  describe('the history', () => {
    it('writes one line per change with before, after, who, how and the moment', async () => {
      const { lesson: id, student } = await scene();
      const written = await cell(north, { lesson: id, student, mark: 1 });
      await change(north, written.id, { mark: 0 }, other);
      await change(north, written.id, { mark: null });
      const lines = await historyOf(written.id);
      expect(
        lines.map((line) => [line.version, line.mark_before, line.mark_after, line.changed_by]),
      ).toEqual([
        [1, null, 1, account],
        [2, 1, 0, other],
        [3, 0, null, account],
      ]);
      for (const line of lines) {
        expect(line).toMatchObject({ lesson_id: id, student_id: student, changed_how: 'entry' });
        expect(new Date(line.changed_at).toISOString()).toBe(new Date(NOW).toISOString());
      }
    });

    it('keeps the numbers of a work', async () => {
      const { lesson: id, student } = await scene();
      const workId = await work(north, id, 30);
      const written = await cell(north, { lesson: id, student, work: workId, score: 12 });
      await change(north, written.id, { score: 13 });
      expect(
        (await historyOf(written.id)).map((line) => [line.score_before, line.score_after]),
      ).toEqual([
        [null, 12],
        [12, 13],
      ]);
    });

    it('lands in the partition of its month', async () => {
      const { lesson: id, student } = await scene();
      const written = await cell(north, { lesson: id, student, mark: 1 });
      const found = await sql<{ partition: string }>`
        select tableoid::regclass::text as partition from journal_cell_history
        where cell_id = ${written.id}::uuid
      `.execute(database.migrator);
      expect(found.rows.map((row) => row.partition)).toEqual(['journal_cell_history_2026_10']);
    });

    it('is append-only for the application and written only by the trigger', async () => {
      const { lesson: id, student } = await scene();
      const written = await cell(north, { lesson: id, student, mark: 1 });
      const updated = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('journal_cell_history')
            .set({ mark_after: 0 })
            .where('cell_id', '=', written.id)
            .execute(),
        ),
      );
      expect(updated.code).toBe(INSUFFICIENT_PRIVILEGE);
      const deleted = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .deleteFrom('journal_cell_history')
            .where('cell_id', '=', written.id)
            .execute(),
        ),
      );
      expect(deleted.code).toBe(INSUFFICIENT_PRIVILEGE);
      const inserted = await refusal(
        inBranch(north, async (transaction) => {
          await audited(transaction, north);
          await transaction
            .insertInto('journal_cell_history')
            .values({
              branch_id: north,
              cell_id: written.id,
              lesson_id: id,
              student_id: student,
              version: 9,
              changed_by: account,
              changed_how: 'entry',
              changed_at: new Date(NOW),
            })
            .execute();
        }),
      );
      expect(inserted.constraint).toBe('journal_cell_history_direct');
    });

    it('is not seen from another branch', async () => {
      const { lesson: id, student } = await scene();
      const written = await cell(north, { lesson: id, student, mark: 1 });
      const seen = await inBranch(south, (transaction) =>
        transaction
          .selectFrom('journal_cell_history')
          .select('id')
          .where('cell_id', '=', written.id)
          .execute(),
      );
      expect(seen).toEqual([]);
      const cells = await inBranch(south, (transaction) =>
        transaction.selectFrom('journal_cells').select('id').where('id', '=', written.id).execute(),
      );
      expect(cells).toEqual([]);
    });
  });

  describe('every line has an audit entry of its transaction in its branch', () => {
    const write = (transaction: Transaction, id: string, student: string) =>
      transaction
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

    it('refuses a change with no entry before the commit, and writes nothing', async () => {
      const { lesson: id, student } = await scene();
      const failed = await refusal(
        inBranch(north, (transaction) => write(transaction, id, student)),
      );
      expect(failed.message).toContain('lesson_change_unaudited');
      const rows = await database.migrator
        .selectFrom('journal_cells')
        .select('id')
        .where('lesson_id', '=', id)
        .execute();
      expect(rows).toEqual([]);
    });

    it('refuses a change whose only entry is in another branch', async () => {
      const { lesson: id, student } = await scene();
      const failed = await refusal(
        transactions.run([north, south], async (transaction) => {
          await audited(transaction, south);
          await write(transaction, id, student);
        }),
      );
      expect(failed.message).toContain('lesson_change_unaudited');
    });
  });

  describe('grants', () => {
    // Task 8.6 (decision 8, Look first): a merge carries a cell to the kept record, so the
    // student of a cell may change, and only through `journal_merge_carry` (0128), which
    // refuses any change outside a merge of the transaction; the requirement changed.
    it('refuses an update of the lesson or the work of a cell, and of its student outside a merge', async () => {
      const { lesson: id, student, classId } = await scene();
      const written = await cell(north, { lesson: id, student, mark: 1 });
      const otherLesson = await lesson(north, { classId });
      const carried = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('journal_cells')
            .set({ student_id: student })
            .where('id', '=', written.id)
            .execute(),
        ),
      );
      expect(carried).toMatchObject({ code: '23514', constraint: 'journal_merge_carry' });
      for (const values of [{ lesson_id: otherLesson }, { work_id: await work(north, id, 5) }]) {
        const failed = await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('journal_cells')
              .set(values)
              .where('id', '=', written.id)
              .execute(),
          ),
        );
        expect(failed.code).toBe(INSUFFICIENT_PRIVILEGE);
      }
    });

    // Task 8.1 grants the update of the total and "not held" (From 6.1a); the
    // kind of a work still never changes.
    it('refuses an update of the kind of a work', async () => {
      const { lesson: id } = await scene();
      const workId = await work(north, id);
      const failed = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('journal_works')
            .set({ kind: 'homework' })
            .where('id', '=', workId)
            .execute(),
        ),
      );
      expect(failed.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it('refuses a direct delete of a cell or a work, with or without a value', async () => {
      const { lesson: id, student } = await scene();
      const full = await cell(north, { lesson: id, student, mark: 1 });
      const empty = await cell(north, { lesson: id, student, work: await work(north, id, 5) });
      for (const cellId of [full.id, empty.id]) {
        const failed = await refusal(
          inBranch(north, (transaction) =>
            transaction.deleteFrom('journal_cells').where('id', '=', cellId).execute(),
          ),
        );
        expect(failed.constraint).toBe('journal_cell_delete');
      }
      // Task 8.1 (decision 1, Look first): an empty work added by hand is
      // deleted by the application; one with a total is still refused.
      const totalled = await work(north, id, 5);
      const failed = await refusal(
        inBranch(north, (transaction) =>
          transaction.deleteFrom('journal_works').where('id', '=', totalled).execute(),
        ),
      );
      expect(failed.constraint).toBe('journal_cell_delete');
    });
  });

  describe('closed cells', () => {
    it('refuses a student before joining, after leaving and in another class', async () => {
      const classId = await schoolClass();
      const id = await lesson(north, { classId });
      const later = await kit.members.student(north, { startsOn: '2026-09-01' });
      await kit.members.member({ branch: north, classId, studentId: later, from: '2026-10-15' });
      const left = await kit.members.student(north, { startsOn: '2026-09-01' });
      await kit.members.member({
        branch: north,
        classId,
        studentId: left,
        from: '2026-09-01',
        until: DAY,
        ownUntil: DAY,
      });
      const [elsewhere] = await kit.pupils(north, await schoolClass(), 1);
      for (const student of [later, left, elsewhere ?? '']) {
        const failed = await refusal(cell(north, { lesson: id, student, mark: 1 }));
        expect(failed.code).toBe(CHECK_VIOLATION);
        expect(failed.constraint).toBe('journal_cell_not_member');
      }
      // On the day of joining and while a member, the cell is open.
      const [member] = await kit.pupils(north, classId, 1);
      await cell(north, { lesson: id, student: member ?? '', mark: 1 });
      await cell(north, {
        lesson: await lesson(north, { classId }, '2026-10-15'),
        student: later,
        mark: 1,
      });
    });

    it('opens a group lesson to the group and closes it to the rest of the class', async () => {
      const classId = await schoolClass();
      const [inGroup, notInGroup] = await kit.pupils(north, classId, 2);
      const groupId = await kit.load.classes.group(north, years.get(north)?.year ?? '', subject, [
        classId,
      ]);
      await kit.inGroup(north, groupId, subject, inGroup ?? '');
      const id = await lesson(north, { groupId, classIds: [classId] });
      await cell(north, { lesson: id, student: inGroup ?? '', mark: 1 });
      const failed = await refusal(cell(north, { lesson: id, student: notInGroup ?? '', mark: 1 }));
      expect(failed.constraint).toBe('journal_cell_not_member');
    });

    it('refuses a value after the leaving and lets the cell be cleared', async () => {
      const { lesson: id, student } = await scene();
      const written = await cell(north, { lesson: id, student, mark: 1 });
      await inBranch(north, (transaction) => cut(transaction, student, DAY));
      const failed = await refusal(change(north, written.id, { mark: 0 }));
      expect(failed.constraint).toBe('journal_cell_not_member');
      expect((await change(north, written.id, { mark: null })).version).toBe(2);
    });
  });

  describe('a cancelled lesson', () => {
    it('takes no value until it is restored, and keeps its cells', async () => {
      const { lesson: id, student } = await scene();
      const written = await cell(north, { lesson: id, student, mark: 1 });
      await inBranch(north, (transaction) => cancel(transaction, north, id));
      expect((await refusal(change(north, written.id, { mark: 0 }))).constraint).toBe(
        'journal_cell_cancelled',
      );
      // Nor is it cleared (0109): the entries are kept until the lesson is restored.
      expect((await refusal(change(north, written.id, { mark: null }))).constraint).toBe(
        'journal_cell_cancelled',
      );
      const kept = await database.migrator
        .selectFrom('journal_cells')
        .select('mark')
        .where('id', '=', written.id)
        .executeTakeFirstOrThrow();
      expect(kept.mark).toBe(1);
      await inBranch(north, async (transaction) => {
        await audited(transaction, north);
        await transaction
          .updateTable('lessons')
          .set({ cancel_cause: null, cancel_reason: null })
          .where('id', '=', id)
          .execute();
      });
      expect((await change(north, written.id, { mark: 0 })).mark).toBe(0);
    });
  });

  describe('at the same moment', () => {
    it('a save waits for a held cut of the membership and is refused', async () => {
      const { lesson: id, student } = await scene();
      const held = await holdOpen(north, (transaction) => cut(transaction, student, DAY));
      const saving = refusal(
        inBranch(north, (transaction) => saveMark(transaction, north, id, student)),
      );
      await untilWaiting();
      held.release();
      expect(await held.done).toBeUndefined();
      expect((await saving).constraint).toBe('journal_cell_not_member');
    });

    it('a cut waits for a held save and goes through, the cell kept', async () => {
      const { lesson: id, student } = await scene();
      const held = await holdOpen(north, (transaction) =>
        saveMark(transaction, north, id, student),
      );
      const cutting = inBranch(north, (transaction) => cut(transaction, student, DAY));
      await untilWaiting();
      held.release();
      expect(await held.done).toBeUndefined();
      await cutting;
      const rows = await database.migrator
        .selectFrom('journal_cells')
        .select('mark')
        .where('lesson_id', '=', id)
        .execute();
      expect(rows).toEqual([{ mark: 1 }]);
    });

    it('a save waits for a held cancel and is refused', async () => {
      const { lesson: id, student } = await scene();
      const held = await holdOpen(north, (transaction) => cancel(transaction, north, id));
      const saving = refusal(
        inBranch(north, (transaction) => saveMark(transaction, north, id, student)),
      );
      await untilWaiting();
      held.release();
      expect(await held.done).toBeUndefined();
      expect((await saving).constraint).toBe('journal_cell_cancelled');
    });

    it('a cancel waits for a held save and goes through, the cell kept', async () => {
      const { lesson: id, student } = await scene();
      const held = await holdOpen(north, (transaction) =>
        saveMark(transaction, north, id, student),
      );
      const cancelling = inBranch(north, (transaction) => cancel(transaction, north, id));
      await untilWaiting();
      held.release();
      expect(await held.done).toBeUndefined();
      await cancelling;
      const rows = await database.migrator
        .selectFrom('journal_cells')
        .select('mark')
        .where('lesson_id', '=', id)
        .execute();
      expect(rows).toEqual([{ mark: 1 }]);
    });

    it('a save waits for a held delete of a lesson with no data and finds no lesson', async () => {
      const { classId, student } = await scene();
      // A lesson dated after today: a past one is never deleted (0079).
      const id = await lesson(north, { classId }, '2026-10-19');
      const held = await holdOpen(north, (transaction) =>
        audited(transaction, north).then(() =>
          transaction
            .deleteFrom('lessons')
            .where('id', '=', id)
            .execute()
            .then(() => undefined),
        ),
      );
      const saving = refusal(
        inBranch(north, (transaction) => saveMark(transaction, north, id, student)),
      );
      await untilWaiting();
      held.release();
      expect(await held.done).toBeUndefined();
      // The lesson is gone, so nobody is expected in it: the cell is closed.
      expect((await saving).constraint).toBe('journal_cell_not_member');
    });

    it('a delete waits for a held save with a value and is refused as holding data', async () => {
      const { classId, student } = await scene();
      const id = await lesson(north, { classId }, '2026-10-19');
      const held = await holdOpen(north, (transaction) =>
        saveMark(transaction, north, id, student),
      );
      const deleting = refusal(
        inBranch(north, async (transaction) => {
          await audited(transaction, north);
          await transaction.deleteFrom('lessons').where('id', '=', id).execute();
        }),
      );
      await untilWaiting();
      held.release();
      expect(await held.done).toBeUndefined();
      expect((await deleting).constraint).toBe('lesson_holds_data');
    });
  });

  describe('data on a lesson', () => {
    it('is a mark, a number, a total or "not held", not an empty cell or work', async () => {
      const marked = await scene();
      await cell(north, { lesson: marked.lesson, student: marked.student, mark: 0 });
      const scored = await scene();
      await cell(north, {
        lesson: scored.lesson,
        student: scored.student,
        // Task 8.1 (0119): a number needs its work's total.
        work: await work(north, scored.lesson, 5),
        score: 0,
      });
      const totalled = await scene();
      await work(north, totalled.lesson, 20);
      const notHeld = await scene();
      await work(north, notHeld.lesson, null, true);
      const empty = await scene();
      const cleared = await cell(north, { lesson: empty.lesson, student: empty.student, mark: 1 });
      await change(north, cleared.id, { mark: null });
      await work(north, empty.lesson);
      const found = await inBranch(north, (transaction) =>
        lessonsHoldingData(transaction, [
          marked.lesson,
          scored.lesson,
          totalled.lesson,
          notHeld.lesson,
          empty.lesson,
        ]),
      );
      expect(found).toEqual(
        new Set([marked.lesson, scored.lesson, totalled.lesson, notHeld.lesson]),
      );
    });

    it('lets a lesson with only empty rows go, the history kept, and refuses one with a mark', async () => {
      const empty = await scene();
      const workId = await work(north, empty.lesson);
      const cleared = await cell(north, {
        lesson: empty.lesson,
        student: empty.student,
        work: workId,
      });
      const attendance = await cell(north, {
        lesson: empty.lesson,
        student: empty.student,
        mark: 1,
      });
      await change(north, attendance.id, { mark: null });
      // A lesson dated after today: a past one is closed (0079).
      const future = await lesson(north, { classId: empty.classId }, '2026-10-19');
      const futureWork = await work(north, future);
      await cell(north, { lesson: future, student: empty.student, work: futureWork });
      await inBranch(north, async (transaction) => {
        await audited(transaction, north);
        await transaction.deleteFrom('lessons').where('id', '=', future).execute();
      });
      const left = await database.migrator
        .selectFrom('journal_cells')
        .select('id')
        .where('lesson_id', '=', future)
        .execute();
      expect(left).toEqual([]);
      expect(
        await database.migrator
          .selectFrom('journal_works')
          .select('id')
          .where('lesson_id', '=', future)
          .execute(),
      ).toEqual([]);
      expect(cleared.version).toBe(1);

      const held = await lesson(north, { classId: empty.classId }, '2026-10-19');
      await cell(north, { lesson: held, student: empty.student, mark: 2 });
      const failed = await refusal(
        inBranch(north, async (transaction) => {
          await audited(transaction, north);
          await transaction.deleteFrom('lessons').where('id', '=', held).execute();
        }),
      );
      expect(failed.constraint).toBe('lesson_holds_data');
    });

    it('keeps the history lines of a removed empty cell', async () => {
      const { classId, student } = await scene();
      const future = await lesson(north, { classId }, '2026-10-19');
      const written = await cell(north, { lesson: future, student, mark: 1 });
      await change(north, written.id, { mark: null });
      await inBranch(north, async (transaction) => {
        await audited(transaction, north);
        await transaction.deleteFrom('lessons').where('id', '=', future).execute();
      });
      expect((await historyOf(written.id)).map((line) => line.version)).toEqual([1, 2]);
    });

    it('refuses the delete of a student with a cell by the key', async () => {
      const { lesson: id, student } = await scene();
      await cell(north, { lesson: id, student, mark: 1 });
      const failed = await refusal(
        database.migrator.transaction().execute(async (transaction) => {
          await sql`select set_config('app.now', ${NOW}, true)`.execute(transaction);
          await transaction.deleteFrom('students').where('id', '=', student).execute();
        }),
      );
      expect(failed.code).toBe(FOREIGN_KEY_VIOLATION);
      expect(failed.constraint).toBe('journal_cells_student_fkey');
    });
  });

  describe('who is expected', () => {
    it('lists the members on the lesson date, of a class and of a group', async () => {
      const classId = await schoolClass();
      const [one, two] = await kit.pupils(north, classId, 2);
      const tomorrow = await kit.members.student(north, { startsOn: '2026-09-01' });
      await kit.members.member({ branch: north, classId, studentId: tomorrow, from: '2026-10-15' });
      const classLesson = await lesson(north, { classId });
      const groupId = await kit.load.classes.group(north, years.get(north)?.year ?? '', subject, [
        classId,
      ]);
      await kit.inGroup(north, groupId, subject, two ?? '');
      const groupLesson = await lesson(north, { groupId, classIds: [classId] });
      const expected = await inBranch(north, (transaction) =>
        expectedStudents(transaction, [classLesson, groupLesson]),
      );
      expect(expected.get(classLesson)).toEqual([one, two].sort());
      expect(expected.get(groupLesson)).toEqual([two]);
      expect(await inBranch(north, (transaction) => expectedStudents(transaction, []))).toEqual(
        new Map(),
      );
    });
  });
});
