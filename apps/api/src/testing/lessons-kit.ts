import type { Database } from '../database/database.js';
import { LoadKit } from './load-kit.js';
import { MembersKit } from './members-kit.js';

/** The quarters of the test year: Q1 to Q4, with vacations between them. */
export const QUARTER_DATES = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-27'],
  ['2027-01-11', '2027-03-21'],
  ['2027-03-30', '2027-05-31'],
] as const;

/** A moment of a school date at a clock time in Tashkent (+05:00). */
export const at = (date: string, time: string): Date => new Date(`${date}T${time}:00+05:00`);

/**
 * The records the timetable's lessons stand on (task 5.1a), written by the
 * migrator: a year with dated quarters, shared rooms, students in classes and
 * groups. Names are invented.
 */
export class LessonsKit {
  readonly load: LoadKit;

  private constructor(
    private readonly migrator: Database,
    readonly members: MembersKit,
  ) {
    this.load = new LoadKit(migrator);
  }

  static async create(migrator: Database): Promise<LessonsKit> {
    const load = new LoadKit(migrator);
    return new LessonsKit(migrator, new MembersKit(migrator, await load.classes.account()));
  }

  /** A current year of the branch with its four quarters dated (`QUARTER_DATES`). */
  async year(branch: string): Promise<{ year: string; quarters: string[] }> {
    const year = await this.load.classes.year(branch);
    const quarters: string[] = [];
    for (const [index, [start, end]] of QUARTER_DATES.entries()) {
      const row = await this.migrator
        .updateTable('quarters')
        .set({ start_date: start, end_date: end })
        .where('academic_year_id', '=', year)
        .where('number', '=', index + 1)
        .returning('id')
        .executeTakeFirstOrThrow();
      quarters.push(row.id);
    }
    return { year, quarters };
  }

  /** A room of the branch, shared for `most` lessons at once when given. */
  async room(branch: string, input: { most?: number; capacity?: number } = {}): Promise<string> {
    const id = await this.load.classes.room(branch);
    await this.migrator
      .updateTable('rooms')
      .set({
        shared: input.most !== undefined,
        max_simultaneous_lessons: input.most ?? null,
        capacity: input.capacity ?? 30,
      })
      .where('id', '=', id)
      .execute();
    return id;
  }

  /** Students of the class from the first day of the year, before any group draws from it. */
  async pupils(branch: string, classId: string, count: number): Promise<string[]> {
    const students: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const student = await this.members.student(branch, { startsOn: '2026-09-01' });
      await this.members.member({ branch, classId, studentId: student, from: '2026-09-01' });
      students.push(student);
    }
    return students;
  }

  /** A group row of the student from `from`. */
  async inGroup(
    branch: string,
    groupId: string,
    subjectId: string,
    studentId: string,
    from = '2026-09-01',
  ): Promise<void> {
    await this.members.groupMember({ branch, groupId, subjectId, studentId, from });
  }
}
