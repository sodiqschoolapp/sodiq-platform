import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import type { Database } from '../database/database.js';
import { Transactions } from '../database/transactions.js';
import { Audit } from '../modules/audit/audit.service.js';
import { saveCells } from '../modules/journal/cells.js';
import { at, LessonsKit, QUARTER_DATES } from './lessons-kit.js';
import { MembersKit } from './members-kit.js';

/**
 * Dated lessons and journal cells for tests outside the timetable (task 6.1a),
 * written by the migrator: a lesson of a class on a date, each at its own time
 * so a class never meets itself, and a cell written as the writer writes one.
 * Names are invented.
 */
/** The time of the next lesson, counted over every kit of the test file. */
let slot = 0;

export class CellsKit {
  private constructor(
    private readonly migrator: Database,
    readonly lessons: LessonsKit,
    readonly subject: string,
  ) {}

  static async create(migrator: Database): Promise<CellsKit> {
    const lessons = await LessonsKit.create(migrator);
    const subject = await lessons.load.classes.subject({
      grades: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    });
    return new CellsKit(migrator, lessons, subject);
  }

  /**
   * The quarter of a year holding the date. A quarter with no dates gets its
   * dates of `QUARTER_DATES` only when it is the one that holds the date: the
   * year is shared with the test's other records, and a dated last quarter
   * moves the end of their rows (found by the spec review of the code of 6.1a).
   */
  private async quarterOf(year: string, date: string): Promise<string> {
    const index = QUARTER_DATES.findIndex(([start, end]) => start <= date && date <= end);
    const [start, end] = QUARTER_DATES[index] ?? [];
    if (start !== undefined && end !== undefined) {
      await this.migrator
        .updateTable('quarters')
        .set({ start_date: start, end_date: end })
        .where('academic_year_id', '=', year)
        .where('number', '=', index + 1)
        .where('start_date', 'is', null)
        .execute();
    }
    const row = await this.migrator
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', year)
      .where('start_date', '<=', date)
      .where('end_date', '>=', date)
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /** A lesson of the class on the date, of its own block. */
  async lesson(branch: string, year: string, classId: string, date: string): Promise<string> {
    return this.unitLesson(branch, year, { classId, groupId: null }, date);
  }

  /** Task 6.2: a lesson of a group of the kit's subject on the date, of its own block. */
  async groupLesson(branch: string, year: string, groupId: string, date: string): Promise<string> {
    return this.unitLesson(branch, year, { classId: null, groupId }, date);
  }

  private async unitLesson(
    branch: string,
    year: string,
    unit: { readonly classId: string | null; readonly groupId: string | null },
    date: string,
  ): Promise<string> {
    const source = await this.lessons.source(branch, year, [{ ...unit, subjectId: this.subject }]);
    const quarter = await this.quarterOf(year, date);
    slot += 1;
    const minutes = 7 * 60 + (slot % 12) * 50;
    const time = (total: number) =>
      `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    return this.migrator.transaction().execute(async (transaction) => {
      const block = await transaction
        .insertInto('lesson_blocks')
        .values({
          branch_id: branch,
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
          branch_id: branch,
          block_id: block.id,
          lesson_date: block.lesson_date,
          starts_at: block.starts_at,
          ends_at: block.ends_at,
          class_id: unit.classId,
          group_id: unit.groupId,
          subject_id: this.subject,
          load_row_id: source.lessons[0]?.loadRowId ?? '',
          pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
  }

  /** An attendance cell with a mark, written at the moment given. */
  async cell(
    branch: string,
    input: { lessonId: string; studentId: string; mark: number; by: string; at: string },
  ): Promise<string> {
    return this.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${input.at}, true)`.execute(transaction);
      const row = await transaction
        .insertInto('journal_cells')
        .values({
          branch_id: branch,
          lesson_id: input.lessonId,
          student_id: input.studentId,
          mark: input.mark,
          version: 1,
          changed_by: input.by,
          changed_how: 'entry',
          changed_at: new Date(input.at),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
  }

  /** Clears a cell, as a save of no value writes it, at the moment given. */
  async clear(cellId: string, by: string, at: string): Promise<void> {
    await this.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${at}, true)`.execute(transaction);
      await transaction
        .updateTable('journal_cells')
        .set({ mark: null, score: null, changed_by: by, changed_how: 'entry' })
        .where('id', '=', cellId)
        .execute();
    });
  }
}

/**
 * Task 6.1b-1: a student of the class from 1 September with a mark on the
 * lesson, saved through `saveCells` as the routes of 6.3 will save it (the
 * Done-when of 6.1b-1: "cells written by `saveCells`"), in a transaction of
 * the application for the lesson's branch. Names are invented.
 */
export async function markedLesson(
  app: INestApplication,
  migrator: Database,
  input: {
    readonly branchId: string;
    readonly classId: string;
    readonly lessonId: string;
    /** The account the cell names as its writer. */
    readonly accountId: string;
    readonly mark?: number;
  },
): Promise<{ studentId: string }> {
  const members = new MembersKit(migrator, input.accountId);
  const studentId = await members.student(input.branchId, { startsOn: '2026-09-01' });
  await members.member({
    branch: input.branchId,
    classId: input.classId,
    studentId,
    from: '2026-09-01',
  });
  await app.get(Transactions).run([input.branchId], (transaction) =>
    saveCells(transaction, app.get(Audit), { accountId: input.accountId }, [
      {
        lessonId: input.lessonId,
        studentId,
        workId: null,
        value: input.mark ?? 1,
        version: null,
      },
    ]),
  );
  return { studentId };
}

/**
 * Task 6.1b-1: a classwork with a total on the lesson, written as the
 * migrator: no writer of a total exists before 8.1 (0108 grants none).
 */
export async function workWithTotal(
  migrator: Database,
  input: { readonly branchId: string; readonly lessonId: string; readonly total?: number },
): Promise<string> {
  // Task 8.1 (0119): the next free place of the lesson's works added by hand.
  const taken = await migrator
    .selectFrom('journal_works')
    .select('id')
    .where('source_lesson_id', '=', input.lessonId)
    .execute();
  const row = await migrator
    .insertInto('journal_works')
    .values({
      branch_id: input.branchId,
      lesson_id: input.lessonId,
      // A classwork's source is its own lesson.
      source_lesson_id: input.lessonId,
      position: taken.length + 1,
      kind: 'classwork',
      total: input.total ?? 30,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * Task 6.1b-2: a store row of a forced delete, written as the migrator, that
 * keeps a mark of the student (`forced_deletes.rows.cells`), as the forced
 * delete of a lesson keeps it; restorable for 30 days from `at`. Answers its id.
 */
export async function markInStore(
  migrator: Database,
  input: {
    readonly branchId: string;
    readonly studentId: string;
    readonly by: string;
    readonly at: string;
  },
): Promise<string> {
  return migrator.transaction().execute(async (transaction) => {
    await sql`select set_config('app.now', ${input.at}, true)`.execute(transaction);
    const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
    const cellId = found.rows[0]?.id ?? '';
    const row = await transaction
      .insertInto('forced_deletes')
      .values({
        branch_id: input.branchId,
        record_type: 'lesson',
        record_id: cellId,
        rows: JSON.stringify({
          block: null,
          cells: [
            {
              id: cellId,
              student_id: input.studentId,
              work_id: null,
              mark: 1,
              score: null,
              version: 1,
              changed_by: input.by,
              changed_how: 'entry',
              changed_at: input.at,
            },
          ],
          works: [],
        }),
        reason: 'Entered for the wrong class',
        deleted_by: input.by,
        deleted_at: new Date(input.at),
        restore_until: new Date(input.at),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  });
}

/**
 * Task 6.1b-2 (spec review of the code, must-fix 2): two real changes of one
 * lesson in a fixed order, both waiting on its row. A third transaction holds
 * the lesson `for update`, which both conflict with: `first` starts and waits
 * on it (a cancel or a forced delete locks the lesson `for update`), then
 * `second` starts and queues behind it (a save of cells takes the lesson `for
 * share`), so the row goes to `first` when the hold is released. Each answers
 * its value or the error it threw.
 *
 * Task 8.7 (code round 1 of #225): two changes that both take the lesson `for
 * share` (a "not graded" fill and a save of numbers) both get it on the
 * release, so `row` holds a row of the lesson both lock `for update` (a
 * cell, or a work) instead.
 */
export async function inOrderOnLesson<A, B>(input: {
  readonly app: INestApplication;
  readonly migrator: Database;
  readonly branchId: string;
  readonly lessonId: string;
  readonly row?: { readonly table: 'journal_cells' | 'journal_works'; readonly id: string };
  readonly first: () => Promise<A>;
  readonly second: () => Promise<B>;
}): Promise<[unknown, unknown]> {
  const waiting = async () => {
    const found = await sql<{ n: number }>`
      select count(distinct l.pid)::int as n
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(input.migrator);
    return found.rows[0]?.n ?? 0;
  };
  const until = async (count: number) => {
    for (let tries = 0; tries < 800; tries += 1) {
      if ((await waiting()) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Fewer than ${String(count)} waited on the lesson.`);
  };
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready: () => void = () => undefined;
  const isReady = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const held = input.app
    .get(Transactions)
    .run([input.branchId], async (transaction) => {
      if (input.row === undefined) {
        await transaction
          .selectFrom('lessons')
          .select('id')
          .where('id', '=', input.lessonId)
          .forUpdate()
          .execute();
      } else {
        await transaction
          .selectFrom(input.row.table)
          .select('id')
          .where('id', '=', input.row.id)
          .where('lesson_id', '=', input.lessonId)
          .forUpdate()
          .execute();
      }
      ready();
      await released;
    })
    .catch((error: unknown) => error);
  await isReady;
  const one = input.first().catch((error: unknown) => error);
  await until(1);
  const two = input.second().catch((error: unknown) => error);
  await until(2);
  release();
  const heldError = await held;
  if (heldError !== undefined) {
    throw heldError instanceof Error ? heldError : new Error('The hold on the lesson failed.');
  }
  return Promise.all([one, two]);
}
