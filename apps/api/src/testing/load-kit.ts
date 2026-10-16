import { sql } from 'kysely';
import type { Database } from '../database/database.js';
import { ClassesKit } from './classes-kit.js';

let count = 0;

/** A subject of the profile: the subject and the grades the record teaches it in. */
export interface ProfileSubject {
  subject: string;
  grades: readonly number[];
}

/** What a load row is inserted with; the defaults are filled by the caller. */
export interface LoadRowValues {
  branch_id: string;
  version_id: string;
  class_id?: string | null;
  group_id?: string | null;
  subject_id: string;
  teacher_id: string;
  lessons_per_week?: number;
  room_id?: string | null;
  room_type?: string | null;
  double_lessons?: boolean;
  mixed_block?: boolean;
}

/**
 * The records the teaching load stands on (task 3.4a), written by the
 * migrator: teachers and vacancies with a profile, Tutor subjects, versions
 * and rows. Names are invented.
 */
export class LoadKit {
  readonly classes: ClassesKit;

  constructor(private readonly migrator: Database) {
    this.classes = new ClassesKit(migrator);
  }

  /** A person of the branch who teaches the subjects named in the languages named. */
  async teacher(
    branch: string,
    input: {
      languages?: readonly ('uz' | 'ru')[];
      subjects?: readonly ProfileSubject[];
      further?: readonly string[];
      accountId?: string;
    } = {},
  ): Promise<{ staffId: string; accountId: string }> {
    const person = await this.classes.person(branch, input.languages ?? ['uz'], {
      ...(input.further === undefined ? {} : { further: input.further }),
      ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
    });
    await this.profile(person.staffId, input.subjects ?? []);
    return person;
  }

  /** An open vacancy of the branch (04, Vacancy) with its profile. */
  async vacancy(
    branch: string,
    input: { languages?: readonly ('uz' | 'ru')[]; subjects?: readonly ProfileSubject[] } = {},
  ): Promise<string> {
    count += 1;
    const id = await this.migrator.transaction().execute(async (transaction) => {
      const academic = await transaction
        .selectFrom('divisions')
        .select('id')
        .where('name_en', '=', 'Academic')
        .executeTakeFirstOrThrow();
      const steam = await transaction
        .selectFrom('departments')
        .select('id')
        .where('name_en', '=', 'STEAM')
        .executeTakeFirstOrThrow();
      const staff = await transaction
        .insertInto('staff')
        .values({ kind: 'vacancy', vacancy_name: `Teacher wanted ${String(count)}` })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: staff.id, branch_id: branch, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({
          staff_id: staff.id,
          division_id: academic.id,
          department_id: steam.id,
          is_main: true,
        })
        .execute();
      for (const language of input.languages ?? ['uz']) {
        await transaction
          .insertInto('staff_languages')
          .values({ staff_id: staff.id, language })
          .execute();
      }
      for (const one of input.subjects ?? []) {
        await transaction
          .insertInto('staff_subjects')
          .values({ staff_id: staff.id, subject_id: one.subject, grades: [...one.grades] })
          .execute();
      }
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: staff.id, status: 'open', valid_from: '2026-09-01' })
        .execute();
      return staff.id;
    });
    return id;
  }

  /** Adds subjects to a record's profile. */
  async profile(staffId: string, subjects: readonly ProfileSubject[]): Promise<void> {
    for (const one of subjects) {
      await this.migrator
        .insertInto('staff_subjects')
        .values({ staff_id: staffId, subject_id: one.subject, grades: [...one.grades] })
        .execute();
    }
  }

  /** From `from` on, the record has `status`: the row in force is cut there. */
  async status(
    staffId: string,
    status: 'active' | 'inactive' | 'left' | 'open' | 'closed',
    from: string,
  ): Promise<void> {
    await this.migrator.transaction().execute(async (transaction) => {
      await transaction
        .updateTable('staff_statuses')
        .set({ valid_until: from })
        .where('staff_id', '=', staffId)
        .where('valid_from', '<', from)
        .where((eb) => eb.or([eb('valid_until', 'is', null), eb('valid_until', '>', from)]))
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: staffId, status, valid_from: from })
        .execute();
    });
  }

  /** A subject of the Tutors department (decision 2), taught in `grades`. */
  async tutorSubject(
    input: { grades?: readonly number[]; languageRule?: boolean } = {},
  ): Promise<string> {
    count += 1;
    const tutors = await this.migrator
      .selectFrom('departments')
      .select('id')
      .where('tutors', '=', true)
      .executeTakeFirstOrThrow();
    const row = await this.migrator
      .insertInto('subjects')
      .values({
        name_uz: `Maʼnaviyat ${String(count)} uz`,
        name_ru: `Maʼnaviyat ${String(count)} ru`,
        name_en: `Spiritual hour ${String(count)}`,
        department_id: tutors.id,
        grades: [...(input.grades ?? [5, 6, 7, 8, 9, 10, 11])],
        colour: 'green',
        journal_type: 'graded',
        language_rule: input.languageRule ?? true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /**
   * A person of the Tutors department with a Tutor subject in the profile, as
   * 3.4a let take any Tutor row (task 3.6c-2: no longer).
   */
  async tutorSubjectHolder(
    branch: string,
    subject: string,
    grades: readonly number[],
  ): Promise<{ staffId: string; accountId: string }> {
    const person = await this.teacher(branch);
    const tutors = await this.migrator
      .selectFrom('departments')
      .select('id')
      .where('tutors', '=', true)
      .executeTakeFirstOrThrow();
    await this.migrator
      .updateTable('staff_divisions')
      .set({ department_id: tutors.id })
      .where('staff_id', '=', person.staffId)
      .execute();
    await this.profile(person.staffId, [{ subject, grades }]);
    return person;
  }

  /** A Tutor of the class (a Tutor assignment of the account and its class row). */
  async tutorOf(
    branch: string,
    classId: string,
    accountId: string,
    input: { kind?: 'tutor' | 'acting'; from?: Date; until?: Date | null } = {},
  ): Promise<string> {
    const assignment = await this.classes.role(accountId, branch, 'tutor');
    return this.classes.tutorRow(branch, classId, assignment, input);
  }

  /** A version of the branch's year, with the number after the last, a draft unless said. */
  async version(
    branch: string,
    year: string,
    input: {
      startsOn?: string;
      status?: 'draft' | 'published' | 'archived';
      from?: string | null;
    } = {},
  ): Promise<string> {
    const last = await this.migrator
      .selectFrom('timetable_versions')
      .select((eb) => eb.fn.max('number').as('number'))
      .where('branch_id', '=', branch)
      .where('academic_year_id', '=', year)
      .executeTakeFirst();
    const row = await this.migrator
      .insertInto('timetable_versions')
      .values({
        branch_id: branch,
        academic_year_id: year,
        number: (last?.number ?? 0) + 1,
        starts_on: input.startsOn ?? '2026-10-19',
        from_version_id: input.from ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (input.status !== undefined && input.status !== 'draft') {
      await this.setVersion(row.id, input.status);
    }
    return row.id;
  }

  async setVersion(id: string, status: 'draft' | 'published' | 'archived'): Promise<void> {
    await this.migrator
      .updateTable('timetable_versions')
      .set({ status })
      .where('id', '=', id)
      .execute();
  }

  /**
   * A load row written past the row trigger, as 3.4a let a Tutor row be
   * written (another teacher with the profile row, a vacancy) before task
   * 3.6c-2: such rows can still be stored.
   */
  async rowAsBefore(values: LoadRowValues): Promise<string> {
    return this.migrator.transaction().execute(async (transaction) => {
      await sql`alter table teaching_load_rows disable trigger teaching_load_rows_check`.execute(
        transaction,
      );
      const row = await transaction
        .insertInto('teaching_load_rows')
        .values({ lessons_per_week: 2, ...values })
        .returning('id')
        .executeTakeFirstOrThrow();
      await sql`set constraints all immediate`.execute(transaction);
      await sql`alter table teaching_load_rows enable trigger teaching_load_rows_check`.execute(
        transaction,
      );
      return row.id;
    });
  }

  /** A load row written by the migrator, through every check of 0055. */
  async row(values: LoadRowValues): Promise<string> {
    const row = await this.migrator
      .insertInto('teaching_load_rows')
      .values({ lessons_per_week: 2, ...values })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }
}
