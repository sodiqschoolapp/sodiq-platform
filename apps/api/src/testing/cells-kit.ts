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
    const source = await this.lessons.source(branch, year, [
      { classId, groupId: null, subjectId: this.subject },
    ]);
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
          class_id: classId,
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
  const row = await migrator
    .insertInto('journal_works')
    .values({
      branch_id: input.branchId,
      lesson_id: input.lessonId,
      kind: 'classwork',
      total: input.total ?? 30,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}
