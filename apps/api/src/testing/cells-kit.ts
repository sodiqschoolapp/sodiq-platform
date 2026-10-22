import { sql } from 'kysely';
import type { Database } from '../database/database.js';
import { at, LessonsKit, QUARTER_DATES } from './lessons-kit.js';

/**
 * Dated lessons and journal cells for tests outside the timetable (task 6.1a),
 * written by the migrator: a lesson of a class on a date, each at its own time
 * so a class never meets itself, and a cell written as the writer writes one.
 * Names are invented.
 */
export class CellsKit {
  private slot = 0;

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

  /** The quarter of a year holding the date; quarters with no dates get those of `QUARTER_DATES`. */
  private async quarterOf(year: string, date: string): Promise<string> {
    for (const [index, [start, end]] of QUARTER_DATES.entries()) {
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
    this.slot += 1;
    const minutes = 7 * 60 + (this.slot % 12) * 50;
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
}
