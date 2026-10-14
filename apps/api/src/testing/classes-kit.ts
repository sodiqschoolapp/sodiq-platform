import type { Database } from '../database/database.js';

const HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';

let count = 0;

/** A number written in letters (1 a, 26 z, 27 ba), so that every default name is new and is a valid class name. */
function lettersOf(value: number): string {
  let text = '';
  let rest = value;
  do {
    text = String.fromCharCode(97 + (rest % 26)) + text;
    rest = Math.floor(rest / 26);
  } while (rest > 0);
  return text;
}

/**
 * The records classes and their Tutors stand on (task 3.1a), written by the
 * migrator: years, rooms, accounts with a staff record and their roles. Names
 * are invented.
 */
export class ClassesKit {
  constructor(private readonly migrator: Database) {}

  /** A year of the branch with its four undated quarters, planned, current or closed. */
  async year(
    branch: string,
    status: 'planned' | 'current' | 'closed' = 'current',
    start = '2026-09-01',
    end = '2027-05-31',
  ): Promise<string> {
    const id = await this.migrator.transaction().execute(async (transaction) => {
      const year = await transaction
        .insertInto('academic_years')
        .values({ branch_id: branch, start_date: start, end_date: end })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const number of [1, 2, 3, 4]) {
        await transaction
          .insertInto('quarters')
          .values({ branch_id: branch, academic_year_id: year.id, number })
          .execute();
      }
      return year.id;
    });
    if (status !== 'planned') {
      await this.setYear(id, 'current');
    }
    if (status === 'closed') {
      await this.setYear(id, 'closed');
    }
    return id;
  }

  async setYear(id: string, status: 'current' | 'closed'): Promise<void> {
    await this.migrator
      .updateTable('academic_years')
      .set({ status })
      .where('id', '=', id)
      .execute();
  }

  /** A room of the branch on a building and floor of its own. */
  async room(branch: string, status: 'in_use' | 'closed' = 'in_use'): Promise<string> {
    count += 1;
    return this.migrator.transaction().execute(async (transaction) => {
      const building = await transaction
        .insertInto('buildings')
        .values({ branch_id: branch, name: `Building ${String(count)}` })
        .returning('id')
        .executeTakeFirstOrThrow();
      const floor = await transaction
        .insertInto('floors')
        .values({ branch_id: branch, building_id: building.id, name: 'First' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const room = await transaction
        .insertInto('rooms')
        .values({
          branch_id: branch,
          floor_id: floor.id,
          name: `Room ${String(count)}`,
          type: 'classroom',
          capacity: 30,
          status,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return room.id;
    });
  }

  /** A class written by the migrator, with no Tutor. */
  async schoolClass(
    branch: string,
    year: string,
    input: {
      grade?: number;
      name?: string;
      language?: 'uz' | 'ru';
      room?: string | null;
      maxSize?: number;
    } = {},
  ): Promise<string> {
    count += 1;
    const row = await this.migrator
      .insertInto('classes')
      .values({
        branch_id: branch,
        academic_year_id: year,
        grade: input.grade ?? 7,
        name: input.name ?? `Oxford ${lettersOf(count)}`,
        language: input.language ?? 'uz',
        main_room_id: input.room ?? null,
        max_size: input.maxSize ?? 25,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /**
   * A school-wide subject of the Academic division (task 3.2a), taught in
   * `grades`, under the language rule unless said otherwise.
   */
  async subject(
    input: {
      grades?: readonly number[];
      languageRule?: boolean;
      name?: string;
      journalType?: 'graded' | 'attendance_only';
    } = {},
  ): Promise<string> {
    count += 1;
    const name = input.name ?? `Subject ${String.fromCharCode(97 + (count % 26))}${String(count)}`;
    const steam = await this.migrator
      .selectFrom('departments')
      .select('id')
      .where('name_en', '=', 'STEAM')
      .executeTakeFirstOrThrow();
    const row = await this.migrator
      .insertInto('subjects')
      .values({
        name_uz: `${name} uz`,
        name_ru: `${name} ru`,
        name_en: name,
        department_id: steam.id,
        grades: [...(input.grades ?? [7, 8, 9, 10])],
        colour: 'blue',
        journal_type: input.journalType ?? 'graded',
        language_rule: input.languageRule ?? true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /** A group of the classes written by the migrator, through every check of 0046 (task 3.2a). */
  async group(
    branch: string,
    year: string,
    subject: string,
    classIds: readonly string[],
    input: { name?: string; language?: 'uz' | 'ru'; size?: number } = {},
  ): Promise<string> {
    count += 1;
    return this.migrator.transaction().execute(async (transaction) => {
      const row = await transaction
        .insertInto('groups')
        .values({
          branch_id: branch,
          academic_year_id: year,
          subject_id: subject,
          name: input.name ?? `G-${String(count)}`,
          language: input.language ?? 'uz',
          max_size: input.size ?? 20,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const classId of classIds) {
        await transaction
          .insertInto('group_classes')
          .values({ group_id: row.id, class_id: classId, branch_id: branch })
          .execute();
      }
      return row.id;
    });
  }

  /** An account with no staff record. */
  async account(): Promise<string> {
    count += 1;
    const row = await this.migrator
      .insertInto('accounts')
      .values({
        login: `tutor.person${String.fromCharCode(97 + (count % 26))}${String(count)}`,
        password_hash: HASH,
        must_change_password: false,
        created_at: new Date('2026-09-01T09:00:00+05:00'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /**
   * A person of the branch (the main link) with the languages they teach in,
   * linked to a new account, or to `accountId` (a signed-in account of a
   * test); `further` adds links to other branches.
   */
  async person(
    branch: string,
    languages: readonly ('uz' | 'ru')[],
    input: { further?: readonly string[]; first?: string; last?: string; accountId?: string } = {},
  ): Promise<{ staffId: string; accountId: string }> {
    const accountId = input.accountId ?? (await this.account());
    count += 1;
    const staffId = await this.migrator.transaction().execute(async (transaction) => {
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
        .values({
          kind: 'person',
          staff_id: `S-26${String(7000 + count).padStart(4, '0')}`,
          account_id: accountId,
          first_name: input.first ?? 'Dilnoza',
          last_name: input.last ?? `Tursunova${'a'.repeat(count % 3)}`,
          sex: 'female',
          birth_date: '1990-03-04',
          phone: `+9989100${String(count).padStart(5, '0')}`,
          admission_date: '2026-09-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: staff.id, branch_id: branch, is_main: true })
        .execute();
      for (const further of input.further ?? []) {
        await transaction
          .insertInto('staff_branches')
          .values({ staff_id: staff.id, branch_id: further, is_main: false })
          .execute();
      }
      await transaction
        .insertInto('staff_divisions')
        .values({
          staff_id: staff.id,
          division_id: academic.id,
          department_id: steam.id,
          is_main: true,
        })
        .execute();
      for (const language of languages) {
        await transaction
          .insertInto('staff_languages')
          .values({ staff_id: staff.id, language })
          .execute();
      }
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: staff.id, status: 'active', valid_from: '2026-09-01' })
        .execute();
      return staff.id;
    });
    return { staffId, accountId };
  }

  /** A role of an account in a branch, from a moment, with an end or none. */
  async role(
    accountId: string,
    branch: string,
    role: 'tutor' | 'teacher' | 'academic_vice_principal' = 'tutor',
    from = new Date('2026-09-01T00:00:00+05:00'),
    until: Date | null = null,
  ): Promise<string> {
    const row = await this.migrator
      .insertInto('assignments')
      .values({
        account_id: accountId,
        role,
        branch_id: branch,
        valid_from: from,
        valid_until: until,
        created_at: from,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /** A Tutor row written by the migrator, which the start guard does not check. */
  async tutorRow(
    branch: string,
    classId: string,
    assignmentId: string,
    input: {
      kind?: 'tutor' | 'acting';
      from?: Date;
      until?: Date | null;
      givenBy?: string;
    } = {},
  ): Promise<string> {
    const givenBy = input.givenBy ?? (await this.account());
    const row = await this.migrator
      .insertInto('class_tutors')
      .values({
        branch_id: branch,
        class_id: classId,
        assignment_id: assignmentId,
        kind: input.kind ?? 'tutor',
        valid_from: input.from ?? new Date('2026-09-01T00:00:00+05:00'),
        own_until: input.until ?? null,
        given_by: givenBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /** The stored dates of a Tutor row. */
  async tutorRowOf(id: string): Promise<{
    valid_from: Date;
    valid_until: Date | null;
    own_until: Date | null;
    end_cause: string | null;
  }> {
    return this.migrator
      .selectFrom('class_tutors')
      .select(['valid_from', 'valid_until', 'own_until', 'end_cause'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  }
}
