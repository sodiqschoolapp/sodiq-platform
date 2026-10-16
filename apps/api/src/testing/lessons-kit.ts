import { sql } from 'kysely';
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

/** One lesson of a block, as its load row needs it. */
export interface LessonUnit {
  readonly classId: string | null;
  readonly groupId: string | null;
  readonly subjectId: string;
}

/** What a dated block and its lessons stand on: a version, a pattern block, a row and an entry each. */
export interface LessonSource {
  readonly versionId: string;
  readonly patternBlockId: string;
  readonly lessons: readonly { readonly loadRowId: string; readonly patternEntryId: string }[];
}

/**
 * The records the timetable's lessons stand on (task 5.1a), written by the
 * migrator: a year with dated quarters, shared rooms, students in classes and
 * groups. Names are invented.
 */
export class LessonsKit {
  readonly load: LoadKit;
  /** The fixture teachers of the load rows, per branch, in the order of a block's lessons. */
  private readonly rowTeachers = new Map<string, string[]>();

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

  /**
   * The version, pattern block, load rows and pattern entries that a test
   * block and its lessons stand on, since every dated lesson comes from a
   * version's pattern (migration 0066; task 3.6c-1, decision 7). Each block
   * gets a version of its own, so test lessons never meet each other in the
   * pattern's own constraints: draft while its rows, pattern block and entries
   * are written (`pattern_rows_draft`), then published, as a dated block on a
   * draft is refused (`lesson_block_version`). Each load row has a fixture
   * teacher of its own, a different one per lesson of the block (0056: the
   * group rows of one block have different teachers), with every grade of the subject and both languages (0055); the lesson's own teacher and room are what
   * the test writes. The subject gains the unit's grades when it lacks one.
   */
  async source(branch: string, year: string, units: readonly LessonUnit[]): Promise<LessonSource> {
    const versionId = await this.load.version(branch, year);
    const block = await this.migrator
      .insertInto('pattern_blocks')
      .values({
        branch_id: branch,
        version_id: versionId,
        weekday: 1,
        slot_position: 1,
        start_minutes: 540,
        end_minutes: 585,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const lessons: { loadRowId: string; patternEntryId: string }[] = [];
    for (const [index, unit] of units.entries()) {
      await this.withUnitGrades(unit);
      const teacherId = await this.rowTeacher(branch, index, unit.subjectId);
      const loadRowId = await this.load.row({
        branch_id: branch,
        version_id: versionId,
        class_id: unit.classId,
        group_id: unit.groupId,
        subject_id: unit.subjectId,
        teacher_id: teacherId,
      });
      const entry = await this.migrator
        .insertInto('pattern_entries')
        .values({
          branch_id: branch,
          version_id: versionId,
          block_id: block.id,
          weekday: 1,
          start_minutes: 540,
          end_minutes: 585,
          load_row_id: loadRowId,
          teacher_id: teacherId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      lessons.push({ loadRowId, patternEntryId: entry.id });
    }
    await this.load.setVersion(versionId, 'published');
    return { versionId, patternBlockId: block.id, lessons };
  }

  /** Adds the grades of the class or group to its subject when the subject lacks one. */
  private async withUnitGrades(unit: LessonUnit): Promise<void> {
    const grades =
      unit.classId !== null
        ? sql<number>`(select array[c.grade] from classes c where c.id = ${unit.classId}::uuid)`
        : sql<number>`(select g.grades from load_group_classes(${unit.groupId}::uuid) g)`;
    await sql`
      update subjects s
      set grades = (select array_agg(distinct grade order by grade) from unnest(s.grades || ${grades}) grade)
      where s.id = ${unit.subjectId}::uuid and not s.grades @> ${grades}
    `.execute(this.migrator);
  }

  /** The fixture teacher of the `index`th lesson of a block in the branch, holding the subject. */
  private async rowTeacher(branch: string, index: number, subjectId: string): Promise<string> {
    const teachers = this.rowTeachers.get(branch) ?? [];
    this.rowTeachers.set(branch, teachers);
    let teacherId = teachers[index];
    if (teacherId === undefined) {
      teacherId = (await this.load.teacher(branch, { languages: ['uz', 'ru'] })).staffId;
      teachers[index] = teacherId;
    }
    // Every grade of the subject, which already holds the unit's (staff_subject_grades).
    await sql`
      insert into staff_subjects (staff_id, subject_id, grades)
      select ${teacherId}::uuid, s.id, s.grades from subjects s where s.id = ${subjectId}::uuid
      on conflict (staff_id, subject_id) do update set grades = excluded.grades
    `.execute(this.migrator);
    return teacherId;
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
