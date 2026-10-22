import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit } from '../../testing/lessons-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
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

/** A cell as the store keeps it (`LessonRows.cells`). */
interface Cell {
  id: string;
  student_id: string;
  work_id: string | null;
  mark: number | null;
  score: number | null;
  version: number;
  changed_by: string;
  changed_how: string;
  changed_at: string;
}

/** A work as the store keeps it (`LessonRows.works`). */
interface Work {
  id: string;
  kind: string;
  total: number | null;
  not_held: boolean;
}

// The forced delete of a lesson that holds data, with its cells and works, and
// their restore, in the database (db/migrations 0105 and 0111; task 5.8b, pull
// request #195; task 6.1b-2, pull request #208, decisions 1, 7 and 9): "A dated
// lesson that already has attendance or marks cannot be deleted", "Forced
// delete is for Super Admin only, with a typed reason. The attendance and marks
// are kept for 30 days and can be restored." (06, Protection). Task 6.1b-2
// (decision 8, Look first) moved these tests from the stand-in function of
// 5.8b to real cells. All names are invented.
describe('the forced delete of a lesson that holds data in the database', () => {
  let database: TestDatabase;
  let clock: FixedClock;
  let transactions: Transactions;
  let kit: LessonsKit;
  let members: MembersKit;
  let north: string;
  let account: string;
  /** The teacher who typed the cells: another account than the one that deletes and restores. */
  let writer: string;
  let year: { year: string; quarters: string[] };
  let subject: string;

  const inNorth = <T>(work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([north], work);

  /** An audit entry of the transaction, as `Audit.record` writes it. */
  const audited = (transaction: Transaction) =>
    transaction
      .insertInto('audit_log')
      .values({ occurred_at: new Date(NOW), branch_id: north, action: 'test.lesson_change' })
      .execute();

  /**
   * A lesson of its own class on Monday with one member, an attendance mark,
   * a work with a total and a number, and an empty cell of a second member.
   */
  async function markedLesson(
    input: { notHeld?: boolean; time?: string; noCells?: boolean } = {},
  ): Promise<{ lesson: string; block: string; classId: string; students: string[] }> {
    const classId = await kit.load.classes.schoolClass(north, year.year, { grade: 7 });
    const source = await kit.source(north, year.year, [
      { classId, groupId: null, subjectId: subject },
    ]);
    const time = input.time ?? '09:00';
    const [hours, minutes] = time.split(':').map(Number);
    const end = `${String((hours ?? 0) + 1).padStart(2, '0')}:${String(minutes ?? 0).padStart(2, '0')}`;
    const students: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const studentId = await members.student(north, { startsOn: '2026-09-01' });
      await members.member({ branch: north, classId, studentId, from: '2026-09-01' });
      students.push(studentId);
    }
    return database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${NOW}, true)`.execute(transaction);
      const block = await transaction
        .insertInto('lesson_blocks')
        .values({
          branch_id: north,
          academic_year_id: year.year,
          quarter_id: year.quarters[0] ?? '',
          lesson_date: MONDAY,
          starts_at: at(MONDAY, time),
          ends_at: at(MONDAY, end),
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
      const work = await transaction
        .insertInto('journal_works')
        .values({
          branch_id: north,
          lesson_id: row.id,
          kind: 'classwork',
          total: 30,
          not_held: input.notHeld ?? false,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const cell = (studentId: string, values: { mark?: number; score?: number; work?: string }) =>
        transaction
          .insertInto('journal_cells')
          .values({
            branch_id: north,
            lesson_id: row.id,
            student_id: studentId,
            work_id: values.work ?? null,
            mark: values.mark ?? null,
            score: values.score ?? null,
            version: 1,
            changed_by: writer,
            changed_how: 'entry',
            changed_at: new Date(NOW),
          })
          .execute();
      if (input.noCells === true) {
        return { lesson: row.id, block: block.id, classId, students };
      }
      await cell(students[0] ?? '', { mark: 1 });
      await cell(students[0] ?? '', { score: 24, work: work.id });
      await cell(students[1] ?? '', {});
      return { lesson: row.id, block: block.id, classId, students };
    });
  }

  /** The cells and works of a lesson as the store keeps them. */
  async function storedOf(lessonId: string): Promise<{ cells: Cell[]; works: Work[] }> {
    const cells = await database.migrator
      .selectFrom('journal_cells')
      .select([
        'id',
        'student_id',
        'work_id',
        'mark',
        'score',
        'version',
        'changed_by',
        'changed_how',
        sql<string>`changed_at::text`.as('changed_at'),
      ])
      .where('lesson_id', '=', lessonId)
      .orderBy('id')
      .execute();
    const works = await database.migrator
      .selectFrom('journal_works')
      .select(['id', 'kind', 'total', 'not_held'])
      .where('lesson_id', '=', lessonId)
      .orderBy('id')
      .execute();
    return { cells, works };
  }

  /** A store row naming the lesson with the rows given, in the transaction. */
  const storeRow = (
    transaction: Transaction,
    lessonId: string,
    rows: { cells?: Cell[]; works?: Work[] } = {},
  ) =>
    transaction
      .insertInto('forced_deletes')
      .values({
        branch_id: north,
        record_type: 'lesson',
        record_id: lessonId,
        rows: JSON.stringify({ block: null, ...rows }),
        reason: 'Entered for the wrong class',
        deleted_by: account,
        deleted_at: new Date('2020-01-01T00:00:00Z'),
        restore_until: new Date('2099-01-01T00:00:00Z'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

  /** The lesson's row, to put it back on a restore. */
  const lessonRow = (lessonId: string) =>
    database.migrator
      .selectFrom('lessons')
      .select([
        'id',
        'branch_id',
        'block_id',
        'lesson_date',
        'starts_at',
        'ends_at',
        'class_id',
        'group_id',
        'subject_id',
        'load_row_id',
        'pattern_entry_id',
        'teacher_id',
        'room_id',
        'cancel_cause',
        'cancel_reason',
      ])
      .where('id', '=', lessonId)
      .executeTakeFirstOrThrow();

  /** The forced delete as the service runs it: the store row, the cells, the works, the lesson. */
  async function forceDelete(lessonId: string): Promise<string> {
    const kept = await storedOf(lessonId);
    return inNorth(async (transaction) => {
      const row = await storeRow(transaction, lessonId, kept);
      await transaction.deleteFrom('journal_cells').where('lesson_id', '=', lessonId).execute();
      await transaction.deleteFrom('journal_works').where('lesson_id', '=', lessonId).execute();
      await transaction.deleteFrom('lessons').where('id', '=', lessonId).execute();
      await audited(transaction);
      return row.id;
    });
  }

  /** Opens the restore of a store row in the transaction and puts its lesson back. */
  async function openRestore(
    transaction: Transaction,
    storeId: string,
    lesson: Awaited<ReturnType<typeof lessonRow>>,
  ): Promise<void> {
    await transaction
      .updateTable('forced_deletes')
      .set({ restored_by: account, restored_at: new Date(0) })
      .where('id', '=', storeId)
      .execute();
    await transaction.insertInto('lessons').values(lesson).execute();
    await audited(transaction);
  }

  const historyOf = (lessonId: string) =>
    database.migrator
      .selectFrom('lesson_history')
      .selectAll()
      .where('lesson_id', '=', lessonId)
      .orderBy('changed_at')
      .orderBy('id')
      .execute();

  const cellHistoryOf = (cellId: string) =>
    database.migrator
      .selectFrom('journal_cell_history')
      .selectAll()
      .where('cell_id', '=', cellId)
      .orderBy('version')
      .execute();

  beforeAll(async () => {
    database = await createTestDatabase();
    clock = new FixedClock(NOW);
    transactions = new Transactions(database.app, clock);
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    year = await kit.year(north);
    subject = await kit.load.classes.subject({ grades: [5, 6, 7, 8, 9, 10, 11] });
    account = await kit.load.classes.account();
    writer = await kit.load.classes.account();
    members = new MembersKit(database.migrator, account);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('lets a forced delete of the same transaction remove the lesson with its cells and works, and nothing else', async () => {
    const held = await markedLesson();
    const other = await markedLesson({ time: '11:00' });
    const kept = await storedOf(held.lesson);
    const plain = await refusal(
      inNorth(async (transaction) => {
        await audited(transaction);
        await transaction.deleteFrom('lessons').where('id', '=', held.lesson).execute();
      }),
    );
    expect(plain.constraint).toBe('lesson_holds_data');
    // A store row of another transaction opens nothing.
    await inNorth((transaction) => storeRow(transaction, held.lesson, kept));
    const earlier = await refusal(
      inNorth(async (transaction) => {
        await audited(transaction);
        await transaction.deleteFrom('lessons').where('id', '=', held.lesson).execute();
      }),
    );
    expect(earlier.constraint).toBe('lesson_holds_data');
    // One of this transaction naming another lesson opens nothing either.
    const elsewhere = await refusal(
      inNorth(async (transaction) => {
        await storeRow(transaction, other.lesson, await storedOf(other.lesson));
        await audited(transaction);
        await transaction.deleteFrom('lessons').where('id', '=', held.lesson).execute();
      }),
    );
    expect(elsewhere.constraint).toBe('lesson_holds_data');
    await forceDelete(held.lesson);
    expect(await storedOf(held.lesson)).toEqual({ cells: [], works: [] });
    expect(await historyOf(held.lesson)).toMatchObject([{ kind: 'forced_delete' }]);
    // One cell history line per cell with a value, after its stored version,
    // the store row's author; none for the empty cell (decision 9).
    for (const cell of kept.cells) {
      const lines = await cellHistoryOf(cell.id);
      if (cell.mark === null && cell.score === null) {
        expect(lines.map((one) => one.changed_how)).toEqual(['entry']);
        continue;
      }
      expect(lines.at(-1)).toMatchObject({
        changed_how: 'forced_delete',
        version: cell.version + 1,
        mark_before: cell.mark,
        score_before: cell.score,
        mark_after: null,
        score_after: null,
        changed_by: account,
      });
      // The line of who typed it stays theirs.
      expect(lines[0]?.changed_by).toBe(writer);
    }
  });

  describe('the delete guards of a cell and a work', () => {
    /** Each row of the lesson that holds data, deleted alone, as the app. */
    const each = (lessonId: string) => [
      {
        name: 'a cell with a mark',
        remove: (transaction: Transaction) =>
          transaction
            .deleteFrom('journal_cells')
            .where('lesson_id', '=', lessonId)
            .where('mark', 'is not', null)
            .execute(),
      },
      {
        name: 'a cell with a number',
        remove: (transaction: Transaction) =>
          transaction
            .deleteFrom('journal_cells')
            .where('lesson_id', '=', lessonId)
            .where('score', 'is not', null)
            .execute(),
      },
    ];

    it('refuses a cell with a mark, a cell with a number, a work with a total and a work "not held" outside a forced delete', async () => {
      const marked = await markedLesson({ time: '12:00' });
      // Works with no cells, so only the work's own guard can refuse.
      const total = await markedLesson({ time: '12:30', noCells: true });
      const notHeld = await markedLesson({ time: '13:00', notHeld: true, noCells: true });
      for (const one of each(marked.lesson)) {
        const refused = await refusal(
          inNorth(async (transaction) => {
            await one.remove(transaction);
          }),
        );
        expect(refused.constraint, one.name).toBe('journal_cell_delete');
      }
      await database.migrator
        .updateTable('journal_works')
        .set({ total: null })
        .where('lesson_id', '=', notHeld.lesson)
        .execute();
      for (const lesson of [total.lesson, notHeld.lesson]) {
        const refused = await refusal(
          inNorth((transaction) =>
            transaction.deleteFrom('journal_works').where('lesson_id', '=', lesson).execute(),
          ),
        );
        expect(refused.constraint).toBe('journal_cell_delete');
      }
      // A store row that does not hold the rows with data lets the lesson's
      // delete through its own guard, but its clearing takes only empty rows
      // and the keys of the rows with data refuse it.
      const deep = await refusal(
        inNorth(async (transaction) => {
          await storeRow(transaction, marked.lesson, {});
          await audited(transaction);
          await transaction.deleteFrom('lessons').where('id', '=', marked.lesson).execute();
        }),
      );
      expect(deep.constraint).toMatch(/^journal_(cells|works)_lesson_fkey$/);
    });

    it('refuses them with a store row of another transaction, of another lesson, or not holding that row', async () => {
      const marked = await markedLesson({ time: '14:00' });
      const other = await markedLesson({ time: '15:00' });
      const kept = await storedOf(marked.lesson);
      await inNorth((transaction) => storeRow(transaction, marked.lesson, kept));
      const changed = {
        cells: kept.cells.map((one) => ({
          ...one,
          mark: one.mark === null ? null : 2,
          score: one.score === null ? null : 5,
        })),
        works: kept.works.map((one) => ({ ...one, total: 40 })),
      };
      const cases: [string, (transaction: Transaction) => Promise<unknown>][] = [
        ['another transaction', () => Promise.resolve()],
        ['another lesson', (transaction) => storeRow(transaction, other.lesson, kept)],
        ['another value', (transaction) => storeRow(transaction, marked.lesson, changed)],
      ];
      for (const [name, open] of cases) {
        for (const [table, column] of [
          ['journal_cells', 'mark'],
          ['journal_cells', 'score'],
        ] as const) {
          const refused = await refusal(
            inNorth(async (transaction) => {
              await open(transaction);
              await transaction
                .deleteFrom(table)
                .where('lesson_id', '=', marked.lesson)
                .where(column, 'is not', null)
                .execute();
            }),
          );
          expect(refused.constraint, `${name}, ${column}`).toBe('journal_cell_delete');
        }
      }
      // A work with a total and no cells, under the same three store rows.
      const bare = await markedLesson({ time: '15:30', noCells: true });
      const bareKept = await storedOf(bare.lesson);
      await inNorth((transaction) => storeRow(transaction, bare.lesson, bareKept));
      const works: [string, (transaction: Transaction) => Promise<unknown>][] = [
        ['another transaction', () => Promise.resolve()],
        ['another lesson', (transaction) => storeRow(transaction, other.lesson, bareKept)],
        [
          'another value',
          (transaction) =>
            storeRow(transaction, bare.lesson, {
              works: bareKept.works.map((one) => ({ ...one, total: 40 })),
            }),
        ],
      ];
      for (const [name, open] of works) {
        const refused = await refusal(
          inNorth(async (transaction) => {
            await open(transaction);
            await transaction
              .deleteFrom('journal_works')
              .where('lesson_id', '=', bare.lesson)
              .execute();
          }),
        );
        expect(refused.constraint, `${name}, work`).toBe('journal_cell_delete');
      }
    });
  });

  describe('the restore of a cell and a work', () => {
    it('lets in only the stored cells, with the next versions, the restorer and their history lines, on a cancelled lesson and for a student no longer a member', async () => {
      const marked = await markedLesson({ time: '16:00' });
      const kept = await storedOf(marked.lesson);
      const lesson = await lessonRow(marked.lesson);
      const storeId = await forceDelete(marked.lesson);
      // The students are no members of the class on the lesson's date any
      // more (the fixture removes their rows), and the lesson comes back
      // cancelled.
      await database.migrator
        .deleteFrom('class_memberships')
        .where('student_id', 'in', marked.students)
        .execute();
      const work = kept.works[0];
      if (work === undefined) throw new Error('No work stored.');
      const [mark, number, empty] = [
        kept.cells.find((one) => one.mark !== null),
        kept.cells.find((one) => one.score !== null),
        kept.cells.find((one) => one.mark === null && one.score === null),
      ];
      if (mark === undefined || number === undefined || empty === undefined) {
        throw new Error('A stored cell is missing.');
      }
      const insertCell = (transaction: Transaction, cell: Cell) =>
        transaction
          .insertInto('journal_cells')
          .values({ ...cell, branch_id: north, lesson_id: marked.lesson })
          .execute();
      // Another value, another student, a cell of another lesson.
      const other = await markedLesson({ time: '17:00' });
      const wrong: [string, (transaction: Transaction) => Promise<unknown>][] = [
        ['another mark', (transaction) => insertCell(transaction, { ...mark, mark: 0 })],
        [
          'another student',
          (transaction) =>
            insertCell(transaction, { ...mark, student_id: other.students[0] ?? '' }),
        ],
        [
          'another lesson',
          (transaction) =>
            transaction
              .insertInto('journal_cells')
              .values({ ...mark, id: undefined, branch_id: north, lesson_id: other.lesson })
              .execute(),
        ],
      ];
      for (const [name, write] of wrong) {
        const refused = await refusal(
          inNorth(async (transaction) => {
            await openRestore(transaction, storeId, {
              ...lesson,
              cancel_cause: 'reason',
              cancel_reason: 'Did not take place',
            });
            await transaction
              .insertInto('journal_works')
              .values({ ...work, branch_id: north, lesson_id: marked.lesson })
              .execute();
            await write(transaction);
          }),
        );
        // A cell of another lesson takes no waiver: it meets the checks of any
        // write (the student is no member there).
        expect(refused.constraint, name).toBe(
          name === 'another lesson' ? 'journal_cell_not_member' : 'journal_cell_restore',
        );
      }
      await inNorth(async (transaction) => {
        await openRestore(transaction, storeId, {
          ...lesson,
          cancel_cause: 'reason',
          cancel_reason: 'Did not take place',
        });
        await transaction
          .insertInto('journal_works')
          .values({ ...work, branch_id: north, lesson_id: marked.lesson })
          .execute();
        // A version sent is not taken: the stored one wins.
        for (const cell of kept.cells) await insertCell(transaction, { ...cell, version: 99 });
      });
      const back = await storedOf(marked.lesson);
      expect(back.works).toEqual(kept.works);
      const byId = new Map(back.cells.map((one) => [one.id, one]));
      expect(byId.get(mark.id)).toMatchObject({
        mark: mark.mark,
        version: mark.version + 2,
        changed_how: 'restored',
        changed_by: account,
      });
      expect(byId.get(number.id)).toMatchObject({
        score: number.score,
        version: number.version + 2,
      });
      expect(byId.get(empty.id)).toMatchObject({
        mark: null,
        score: null,
        version: empty.version + 1,
      });
      for (const cell of [mark, number, empty]) {
        const lines = await cellHistoryOf(cell.id);
        expect(lines.map((one) => one.version)).toEqual(cell === empty ? [1, 2] : [1, 2, 3]);
        expect(lines.at(-1)).toMatchObject({
          changed_how: 'restored',
          mark_after: cell.mark,
          score_after: cell.score,
          changed_by: account,
        });
        expect(lines[0]?.changed_by).toBe(writer);
      }
      const holds = await sql<{
        holds: boolean;
      }>`select lesson_holds_data(${marked.lesson}::uuid) as holds`.execute(database.migrator);
      expect(holds.rows[0]?.holds).toBe(true);
    });

    it('refuses a work with a total or "not held" outside a restore, and one that differs from the stored work in it', async () => {
      const marked = await markedLesson({ time: '18:00' });
      const plain = (values: { total?: number | null; notHeld?: boolean }) =>
        refusal(
          inNorth((transaction) =>
            transaction
              .insertInto('journal_works')
              .values({
                branch_id: north,
                lesson_id: marked.lesson,
                kind: 'classwork',
                total: values.total ?? null,
                not_held: values.notHeld ?? false,
              })
              .execute(),
          ),
        );
      expect((await plain({ total: 20 })).constraint).toBe('journal_work_insert_data');
      expect((await plain({ notHeld: true })).constraint).toBe('journal_work_insert_data');
      // An empty work is the application's as before.
      await inNorth((transaction) =>
        transaction
          .insertInto('journal_works')
          .values({ branch_id: north, lesson_id: marked.lesson, kind: 'homework' })
          .execute(),
      );
      const kept = await storedOf(marked.lesson);
      const lesson = await lessonRow(marked.lesson);
      const storeId = await forceDelete(marked.lesson);
      const work = kept.works.find((one) => one.total !== null);
      if (work === undefined) throw new Error('No work stored.');
      const refused = await refusal(
        inNorth(async (transaction) => {
          await openRestore(transaction, storeId, lesson);
          await transaction
            .insertInto('journal_works')
            .values({ ...work, total: 25, branch_id: north, lesson_id: marked.lesson })
            .execute();
        }),
      );
      expect(refused.constraint).toBe('journal_work_insert_data');
      await inNorth(async (transaction) => {
        await openRestore(transaction, storeId, lesson);
        await transaction
          .insertInto('journal_works')
          .values(kept.works.map((one) => ({ ...one, branch_id: north, lesson_id: marked.lesson })))
          .execute();
      });
      expect((await storedOf(marked.lesson)).works).toEqual(kept.works);
    });
  });

  describe('the student of a kept mark', () => {
    it('is not deleted while the store row can be restored, and no longer counts once it is restored or its 30 days are over', async () => {
      const marked = await markedLesson({ time: '19:00' });
      const [student] = marked.students;
      const kept = await storedOf(marked.lesson);
      const lesson = await lessonRow(marked.lesson);
      const storeId = await forceDelete(marked.lesson);
      const refused = await refusal(
        inNorth(async (transaction) => {
          await audited(transaction);
          await transaction
            .deleteFrom('students')
            .where('id', '=', student ?? '')
            .execute();
        }),
      );
      expect(refused).toMatchObject({ code: '23503', constraint: 'student_forced_cells' });
      const inStore = (moment: string) =>
        database.migrator.transaction().execute(async (transaction) => {
          await sql`select set_config('app.now', ${moment}, true)`.execute(transaction);
          const found = await sql<{
            held: boolean;
          }>`select student_in_forced_store(${student}::uuid) as held`.execute(transaction);
          return found.rows[0]?.held;
        });
      expect(await inStore(NOW)).toBe(true);
      // The empty cell's student is not held.
      const second = await sql<{
        held: boolean;
      }>`select student_in_forced_store(${marked.students[1]}::uuid) as held`.execute(
        database.migrator,
      );
      expect(second.rows[0]?.held).toBe(false);
      // After the 30 days of the store row (its `restore_until`).
      const until = await database.migrator
        .selectFrom('forced_deletes')
        .select('restore_until')
        .where('id', '=', storeId)
        .executeTakeFirstOrThrow();
      expect(await inStore(until.restore_until.toISOString())).toBe(false);
      // Restored: the cells are back, and their own key decides.
      await inNorth(async (transaction) => {
        await openRestore(transaction, storeId, lesson);
        await transaction
          .insertInto('journal_works')
          .values(kept.works.map((one) => ({ ...one, branch_id: north, lesson_id: marked.lesson })))
          .execute();
        await transaction
          .insertInto('journal_cells')
          .values(kept.cells.map((one) => ({ ...one, branch_id: north, lesson_id: marked.lesson })))
          .execute();
      });
      expect(await inStore(NOW)).toBe(false);
    });
  });
});
