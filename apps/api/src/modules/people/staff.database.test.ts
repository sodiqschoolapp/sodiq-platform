import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { staffIdOf, takeStaffNumber } from './staff-numbers.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const EXCLUSION_VIOLATION = '23P01';

const HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
const MOMENT = new Date('2026-10-12T09:00:00+05:00');

interface PersonInput {
  branch: string;
  further?: string[];
  first?: string;
  last?: string;
  birth?: string;
  phone?: string;
  jshshir?: string | null;
  division?: 'academic' | 'management';
  department?: string | null;
  subjects?: { subject: string; grades: number[] }[];
  languages?: string[];
  status?: { status: string; from: string }[];
}

// The rules of staff records that the database itself keeps (db/migrations/
// 0024), also when the application has a fault: the staff ID's shape, its
// uniqueness across the school and the counter per year (edge/developer-rules,
// Identifiers); JSHSHIR unique when filled; a vacancy without personal data
// and a person with it (04); one main branch and one main division, the
// department of Academic, subjects in that department with their grades, a
// language with a subject (04; 03, Divisions); status rows that never overlap,
// only shrink and are never deleted; the membership filter (owner's answer 2
// on pull request #53) and the functions that answer for other branches
// without row data (correction 2).
describe('staff records in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let north: string;
  let south: string;
  let academic: string;
  let management: string;
  let steam: string;
  let languages: string;
  let mathematics: string;
  let english: string;
  let count = 0;

  /** How many connections to the test database wait for a lock right now. */
  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  const inBranch = <T>(branch: string | string[], work: (transaction: Transaction) => Promise<T>) =>
    transactions.run(Array.isArray(branch) ? branch : [branch], work);

  async function newId(transaction: Transaction): Promise<string> {
    const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
    return found.rows[0]?.id ?? '';
  }

  /** The writes of a person's create, in the order of the service. */
  async function writePerson(transaction: Transaction, input: PersonInput): Promise<string> {
    count += 1;
    const id = await newId(transaction);
    await transaction
      .insertInto('staff')
      .values({
        id,
        kind: 'person',
        staff_id: staffIdOf(2026, 5000 + count),
        first_name: input.first ?? 'Akmal',
        last_name: input.last ?? `Karimov${'a'.repeat(count % 5)}`,
        sex: 'male',
        birth_date: input.birth ?? `1990-01-${String((count % 28) + 1).padStart(2, '0')}`,
        phone: input.phone ?? `+9989000${String(count).padStart(5, '0')}`,
        jshshir: input.jshshir ?? null,
        admission_date: '2026-09-01',
      })
      .execute();
    await transaction
      .insertInto('staff_branches')
      .values({ staff_id: id, branch_id: input.branch, is_main: true })
      .execute();
    const division = input.division ?? 'academic';
    await transaction
      .insertInto('staff_divisions')
      .values({
        staff_id: id,
        division_id: division === 'academic' ? academic : management,
        department_id:
          input.department === undefined
            ? division === 'academic'
              ? steam
              : null
            : input.department,
        is_main: true,
      })
      .execute();
    for (const language of input.languages ?? ['uz']) {
      await transaction.insertInto('staff_languages').values({ staff_id: id, language }).execute();
    }
    for (const row of input.subjects ?? []) {
      await transaction
        .insertInto('staff_subjects')
        .values({ staff_id: id, subject_id: row.subject, grades: row.grades })
        .execute();
    }
    for (const row of input.status ?? [{ status: 'active', from: '2026-09-01' }]) {
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: id, status: row.status, valid_from: row.from })
        .execute();
    }
    return id;
  }

  /** A person created in one transaction of the main branch, with further branches written by the migrator. */
  async function createPerson(input: PersonInput): Promise<string> {
    const id = await inBranch(input.branch, (transaction) => writePerson(transaction, input));
    for (const branch of input.further ?? []) {
      await database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: id, branch_id: branch, is_main: false })
        .execute();
    }
    return id;
  }

  const visible = (branch: string[], table: 'staff' | 'staff_statuses', id: string) =>
    transactions.run(branch, async (transaction) =>
      table === 'staff'
        ? (await transaction.selectFrom('staff').select('id').where('id', '=', id).execute()).length
        : (
            await transaction
              .selectFrom('staff_statuses')
              .select('id')
              .where('staff_id', '=', id)
              .execute()
          ).length,
    );

  async function insertSubject(department: string, grades: number[]): Promise<string> {
    count += 1;
    const row = await database.migrator
      .insertInto('subjects')
      .values({
        name_uz: `Fan ${String(count)}`,
        name_ru: `Предмет ${String(count)}`,
        name_en: `Subject ${String(count)}`,
        department_id: department,
        grades,
        colour: 'blue',
        journal_type: 'graded',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    const division = async (en: string) =>
      (
        await database.migrator
          .selectFrom('divisions')
          .select('id')
          .where('name_en', '=', en)
          .executeTakeFirstOrThrow()
      ).id;
    const department = async (en: string) =>
      (
        await database.migrator
          .selectFrom('departments')
          .select('id')
          .where('name_en', '=', en)
          .executeTakeFirstOrThrow()
      ).id;
    academic = await division('Academic');
    management = await division('Management');
    steam = await department('STEAM');
    languages = await department('Foreign languages');
    mathematics = await insertSubject(steam, [5, 6, 7]);
    english = await insertSubject(languages, [5, 6, 7]);
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('the staff ID', () => {
    it('is S-YYNNNN, and the counter gives numbers of a year in order', async () => {
      expect(staffIdOf(2026, 1)).toBe('S-260001');
      expect(staffIdOf(2008, 1234)).toBe('S-081234');
      const first = await inBranch(north, (transaction) => takeStaffNumber(transaction, 2015));
      const second = await inBranch(north, (transaction) => takeStaffNumber(transaction, 2015));
      const other = await inBranch(north, (transaction) => takeStaffNumber(transaction, 2016));
      expect([first, second, other]).toEqual([1, 2, 1]);
    });

    // The done-when of 2.2a: two staff records saved at the same moment get
    // different IDs. The first transaction holds the row of the year; the
    // second waits for it and then takes the next number.
    it('gives two saves of one moment two numbers: the second waits for the first', async () => {
      let releaseFirst: () => void = () => undefined;
      const firstHolds = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstTook: (number: number) => void = () => undefined;
      const firstNumber = new Promise<number>((resolve) => {
        firstTook = resolve;
      });
      const first = inBranch(north, async (transaction) => {
        firstTook(await takeStaffNumber(transaction, 2017));
        await firstHolds;
      });
      expect(await firstNumber).toBe(1);
      const second = inBranch(south, (transaction) => takeStaffNumber(transaction, 2017));
      // The second save waits on the row lock of the year.
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      releaseFirst();
      await first;
      expect(await second).toBe(2);
    });

    it('refuses the 10,000th hire of a year', async () => {
      await database.migrator
        .insertInto('staff_id_counters')
        .values({ year: 2018, last_number: 9999 })
        .execute();
      await expect(
        inBranch(north, (transaction) => takeStaffNumber(transaction, 2018)),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'staff_id_counters_last_number_check',
      });
    });

    it('is unique across the school and never changed by the application', async () => {
      const id = await createPerson({ branch: north });
      const other = await createPerson({ branch: south });
      const taken = (
        await database.migrator
          .selectFrom('staff')
          .select('staff_id')
          .where('id', '=', id)
          .executeTakeFirstOrThrow()
      ).staff_id;
      await expect(
        inBranch(south, (transaction) =>
          sql`update staff set staff_id = ${taken} where id = ${other}`.execute(transaction),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await expect(
        database.migrator.updateTable('staff').set({ staff_id: taken }).where('id', '=', other).execute(),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'staff_staff_id_key' });
    });

    it('stays unique for a person who left', async () => {
      const id = await createPerson({
        branch: north,
        status: [{ status: 'active', from: '2026-09-01' }],
      });
      await database.migrator
        .updateTable('staff_statuses')
        .set({ valid_until: '2026-10-01' })
        .where('staff_id', '=', id)
        .execute();
      await database.migrator
        .insertInto('staff_statuses')
        .values({ staff_id: id, status: 'left', valid_from: '2026-10-01' })
        .execute();
      const left = (
        await database.migrator
          .selectFrom('staff')
          .select('staff_id')
          .where('id', '=', id)
          .executeTakeFirstOrThrow()
      ).staff_id;
      await expect(
        inBranch(north, async (transaction) => {
          count += 1;
          const other = await newId(transaction);
          await transaction
            .insertInto('staff')
            .values({
              id: other,
              kind: 'person',
              staff_id: left,
              first_name: 'Dilshod',
              last_name: 'Nazarov',
              sex: 'male',
              birth_date: '1991-02-02',
              phone: '+998901112233',
              admission_date: '2026-09-01',
            })
            .execute();
        }),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'staff_staff_id_key' });
    });

    it.each(['S-26001', 'S260001', 's-260001', 'S-2600011'])(
      'refuses the shape %s',
      async (staffId) => {
        await expect(
          database.migrator
            .insertInto('staff')
            .values({
              kind: 'person',
              staff_id: staffId,
              first_name: 'Akmal',
              last_name: 'Karimov',
              sex: 'male',
              birth_date: '1990-01-01',
              phone: '+998901234567',
              admission_date: '2026-09-01',
            })
            .execute(),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_staff_id_check' });
      },
    );
  });

  describe('check what is typed', () => {
    const personValues = (fields: Record<string, unknown>) => ({
      kind: 'person',
      staff_id: staffIdOf(2026, 8000 + (count += 1)),
      first_name: 'Akmal',
      last_name: 'Karimov',
      sex: 'male',
      birth_date: '1990-01-01',
      phone: '+998901234567',
      admission_date: '2026-09-01',
      ...fields,
    });
    const insertAsMigrator = (fields: Record<string, unknown>) =>
      sql`select 1`.execute(database.migrator).then(() =>
        database.migrator.transaction().execute(async (transaction) => {
          await transaction
            .insertInto('staff')
            .values(personValues(fields))
            .execute();
          // Not committed: the deferred checks of a person without links would refuse it.
          throw new RolledBack();
        }),
      );
    class RolledBack extends Error {}

    it.each([
      ['Oʻtkir', true],
      ['Gʻayrat', true],
      ['Maʼruf', true],
      ['Abdul-Aziz', true],
      ['Ali Vali', true],
      ["O'tkir", false],
      ['O’tkir', false],
      ['Ўткир', false],
      [' Akmal', false],
      ['Akmal  Vali', false],
      ['A'.repeat(61), false],
      ['', false],
    ])('check the stored name %s', async (name, accepted) => {
      const result = insertAsMigrator({ first_name: name });
      if (accepted) {
        await expect(result).rejects.toBeInstanceOf(RolledBack);
      } else {
        await expect(result).rejects.toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'staff_first_name_check',
        });
      }
    });

    it.each([
      ['phone', '998901234567', 'staff_phone_check'],
      ['phone', '+99890', 'staff_phone_check'],
      ['jshshir', '1234567890123', 'staff_jshshir_check'],
      ['email', 'Teacher@School.uz', 'staff_email_check'],
      ['email', 'no-at-sign', 'staff_email_check'],
      ['education_level', 'college', 'staff_education_level_check'],
      ['contract_type', 'hourly', 'staff_contract_type_check'],
      ['weekly_lessons', 0, 'staff_weekly_lessons_check'],
      ['weekly_lessons', 61, 'staff_weekly_lessons_check'],
      ['daily_lessons', 13, 'staff_daily_lessons_check'],
      ['sex', 'other', 'staff_sex_check'],
    ])('refuse %s %s', async (column, value, constraint) => {
      await expect(insertAsMigrator({ [column]: value })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint,
      });
    });

    // Review of pull request #53, correction 10: the checks by kind are
    // constraints of 0024 and are tested now, with rows written by the migrator.
    it.each([
      ['a person without a staff ID', { staff_id: null }, 'staff_person_check'],
      ['a person without an admission date', { admission_date: null }, 'staff_person_check'],
      ['a person with a vacancy name', { vacancy_name: 'English vacancy 2' }, 'staff_person_check'],
      [
        'a vacancy with a staff ID',
        {
          kind: 'vacancy',
          first_name: null,
          last_name: null,
          sex: null,
          birth_date: null,
          phone: null,
          admission_date: null,
          vacancy_name: 'English vacancy 2',
        },
        'staff_vacancy_check',
      ],
      [
        'a vacancy with a name of a person',
        {
          kind: 'vacancy',
          staff_id: null,
          last_name: null,
          sex: null,
          birth_date: null,
          phone: null,
          admission_date: null,
          vacancy_name: 'English vacancy 2',
        },
        'staff_vacancy_check',
      ],
      [
        'a vacancy with a phone',
        {
          kind: 'vacancy',
          staff_id: null,
          first_name: null,
          last_name: null,
          sex: null,
          birth_date: null,
          admission_date: null,
          vacancy_name: 'English vacancy 2',
        },
        'staff_vacancy_check',
      ],
      [
        'a vacancy without a name',
        {
          kind: 'vacancy',
          staff_id: null,
          first_name: null,
          last_name: null,
          sex: null,
          birth_date: null,
          phone: null,
          admission_date: null,
        },
        'staff_vacancy_check',
      ],
    ])('refuse %s', async (_name, fields, constraint) => {
      await expect(insertAsMigrator(fields)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint,
      });
    });

    it('accept a vacancy with nothing personal', async () => {
      await expect(
        insertAsMigrator({
          kind: 'vacancy',
          staff_id: null,
          first_name: null,
          last_name: null,
          sex: null,
          birth_date: null,
          phone: null,
          admission_date: null,
          vacancy_name: 'English vacancy 2',
        }),
      ).rejects.toBeInstanceOf(RolledBack);
    });

    it('keep JSHSHIR unique when filled, across branches the writer cannot see', async () => {
      await createPerson({ branch: north, jshshir: '31234567890123' });
      await createPerson({ branch: south, jshshir: null });
      await createPerson({ branch: south, jshshir: null });
      await expect(
        createPerson({ branch: south, jshshir: '31234567890123' }),
      ).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'staff_jshshir_idx',
      });
    });
  });

  describe('the membership filter', () => {
    it('shows a record and its rows only to the branches it is linked to', async () => {
      const id = await createPerson({ branch: north });
      expect(await visible([north], 'staff', id)).toBe(1);
      expect(await visible([north], 'staff_statuses', id)).toBe(1);
      expect(await visible([south], 'staff', id)).toBe(0);
      expect(await visible([south], 'staff_statuses', id)).toBe(0);
      expect(await visible([], 'staff', id)).toBe(0);
      await database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: id, branch_id: south, is_main: false })
        .execute();
      expect(await visible([south], 'staff', id)).toBe(1);
    });

    it('lets another branch neither change a record nor add to it', async () => {
      const id = await createPerson({ branch: north });
      const changed = await inBranch(south, (transaction) =>
        transaction
          .updateTable('staff')
          .set({ first_name: 'Bobur' })
          .where('id', '=', id)
          .executeTakeFirst(),
      );
      expect(changed.numUpdatedRows).toBe(0n);
      await expect(
        inBranch(south, (transaction) =>
          transaction
            .insertInto('staff_languages')
            .values({ staff_id: id, language: 'ru' })
            .execute(),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await expect(
        inBranch(south, (transaction) =>
          transaction
            .insertInto('staff_branches')
            .values({ staff_id: id, branch_id: north, is_main: false })
            .execute(),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('lets the application delete neither a record nor a status row', async () => {
      const id = await createPerson({ branch: north });
      for (const table of ['staff', 'staff_statuses'] as const) {
        await expect(
          inBranch(north, (transaction) =>
            sql`delete from ${sql.table(table)} where ${sql.ref(table === 'staff' ? 'id' : 'staff_id')} = ${id}`.execute(
              transaction,
            ),
          ),
        ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      }
    });
  });

  describe('the shape of a record', () => {
    it('refuse a record without a main branch at the commit', async () => {
      await expect(
        inBranch(north, async (transaction) => {
          const id = await newId(transaction);
          await transaction
            .insertInto('staff')
            .values({
              id,
              kind: 'person',
              staff_id: staffIdOf(2026, 9001),
              first_name: 'Akmal',
              last_name: 'Karimov',
              sex: 'male',
              birth_date: '1990-01-01',
              phone: '+998901234567',
              admission_date: '2026-09-01',
            })
            .execute();
        }),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_main_branch' });
    });

    it('refuse a second main branch and the removal of the main one', async () => {
      const id = await createPerson({ branch: north, further: [south] });
      await expect(
        database.migrator
          .updateTable('staff_branches')
          .set({ is_main: true })
          .where('staff_id', '=', id)
          .where('branch_id', '=', south)
          .execute(),
      ).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'staff_branches_one_main_idx',
      });
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .deleteFrom('staff_branches')
            .where('staff_id', '=', id)
            .where('branch_id', '=', north)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_main_branch' });
      // Moving the main branch in one transaction of both branches passes.
      await inBranch([north, south], async (transaction) => {
        await transaction
          .updateTable('staff_branches')
          .set({ is_main: false })
          .where('staff_id', '=', id)
          .where('branch_id', '=', north)
          .execute();
        await transaction
          .updateTable('staff_branches')
          .set({ is_main: true })
          .where('staff_id', '=', id)
          .where('branch_id', '=', south)
          .execute();
      });
    });

    it('refuse a record without a main division, or with two', async () => {
      await expect(
        inBranch(north, async (transaction) => {
          const id = await writePerson(transaction, { branch: north });
          await transaction
            .updateTable('staff_divisions')
            .set({ is_main: false })
            .where('staff_id', '=', id)
            .execute();
        }),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_main_division' });
      await expect(
        inBranch(north, async (transaction) => {
          const id = await writePerson(transaction, { branch: north });
          await transaction
            .insertInto('staff_divisions')
            .values({ staff_id: id, division_id: management, department_id: null, is_main: true })
            .execute();
        }),
      ).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'staff_divisions_one_main_idx',
      });
    });

    it('require a department in Academic and none elsewhere', async () => {
      await expect(createPerson({ branch: north, department: null })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'staff_department_required',
      });
      await expect(
        createPerson({ branch: north, division: 'management', department: null }),
      ).resolves.toEqual(expect.any(String));
      // A department of another division is refused by the composite key.
      await expect(
        createPerson({ branch: north, division: 'management', department: steam }),
      ).rejects.toMatchObject({
        code: '23503',
      });
    });

    it('keep the subjects in the Academic department with grades of the subject', async () => {
      await expect(
        createPerson({ branch: north, subjects: [{ subject: mathematics, grades: [5, 6] }] }),
      ).resolves.toEqual(expect.any(String));
      await expect(
        createPerson({ branch: north, subjects: [{ subject: english, grades: [5] }] }),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_subject_department' });
      await expect(
        createPerson({ branch: north, subjects: [{ subject: mathematics, grades: [5, 8] }] }),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_subject_grades' });
      await expect(
        createPerson({
          branch: north,
          division: 'management',
          department: null,
          subjects: [{ subject: mathematics, grades: [5] }],
        }),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_subject_department' });
    });

    it('require a language once a record has a subject', async () => {
      await expect(
        createPerson({
          branch: north,
          languages: [],
          subjects: [{ subject: mathematics, grades: [5] }],
        }),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_languages_required' });
      const id = await createPerson({
        branch: north,
        languages: ['uz'],
        subjects: [{ subject: mathematics, grades: [5] }],
      });
      await expect(
        inBranch(north, (transaction) =>
          transaction.deleteFrom('staff_languages').where('staff_id', '=', id).execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_languages_required' });
      await expect(createPerson({ branch: north, languages: [] })).resolves.toEqual(
        expect.any(String),
      );
    });

    it('keep a vacancy in Academic', async () => {
      const insertVacancy = (division: string, department: string | null) =>
        database.migrator.transaction().execute(async (transaction) => {
          const row = await transaction
            .insertInto('staff')
            .values({ kind: 'vacancy', vacancy_name: 'English vacancy 2' })
            .returning('id')
            .executeTakeFirstOrThrow();
          await transaction
            .insertInto('staff_branches')
            .values({ staff_id: row.id, branch_id: north, is_main: true })
            .execute();
          await transaction
            .insertInto('staff_divisions')
            .values({
              staff_id: row.id,
              division_id: division,
              department_id: department,
              is_main: true,
            })
            .execute();
          await transaction
            .insertInto('staff_statuses')
            .values({ staff_id: row.id, status: 'open', valid_from: '2026-09-01' })
            .execute();
        });
      await expect(insertVacancy(academic, languages)).resolves.toBeUndefined();
      await expect(insertVacancy(management, null)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'staff_vacancy_division',
      });
    });
  });

  describe('the status rows', () => {
    it('refuse two rows on one date, and a status of the other kind', async () => {
      await expect(
        createPerson({
          branch: north,
          status: [
            { status: 'active', from: '2026-09-01' },
            { status: 'inactive', from: '2026-10-01' },
          ],
        }),
      ).rejects.toMatchObject({
        code: EXCLUSION_VIOLATION,
        constraint: 'staff_statuses_no_overlap',
      });
      await expect(
        createPerson({ branch: north, status: [{ status: 'open', from: '2026-09-01' }] }),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_statuses_kind' });
    });

    it('only shrink: an end comes earlier or a planned row is taken back, nothing grows', async () => {
      const id = await createPerson({ branch: north });
      const update = (values: Record<string, unknown>) =>
        inBranch(north, (transaction) =>
          transaction
            .updateTable('staff_statuses')
            .set(values as never)
            .where('staff_id', '=', id)
            .execute(),
        );
      await update({ valid_until: '2026-12-01' });
      await update({ valid_until: '2026-11-01' });
      await expect(update({ valid_until: '2026-12-01' })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'dated_rows_only_shrink',
      });
      await expect(update({ valid_until: null })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'dated_rows_only_shrink',
      });
      await expect(update({ status: 'left' })).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
      await update({ valid_until: '2026-09-01' });
      // A withdrawn row (an empty range) leaves its date free.
      await inBranch(north, (transaction) =>
        transaction
          .insertInto('staff_statuses')
          .values({ staff_id: id, status: 'inactive', valid_from: '2026-09-01' })
          .execute(),
      );
    });
  });

  // Review of pull request #53, correction 2: each function answers for the
  // other branches of the transaction, which it reads itself, and returns a
  // boolean or a count.
  describe('the functions that answer for other branches', () => {
    const call = async <T>(branch: string[], query: (transaction: Transaction) => Promise<T>) =>
      transactions.run(branch, query);

    it('answer the duplicate warning for another branch only, with a boolean', async () => {
      await createPerson({
        branch: north,
        first: 'Zafar',
        last: 'Toshmatov',
        birth: '1985-05-05',
        phone: '+998909998877',
      });
      const ask = (branch: string[], first: string, last: string, birth: string, phone: string) =>
        call(branch, async (transaction) => {
          const found = await sql<{ answer: unknown }>`
            select staff_duplicate_elsewhere(${first}, ${last}, ${birth}::date, ${phone}) as answer
          `.execute(transaction);
          return found.rows[0]?.answer;
        });
      expect(await ask([south], 'zafar', 'TOSHMATOV', '1985-05-05', '+998900000000')).toBe(true);
      expect(await ask([south], 'Anvar', 'Rahimov', '1980-01-01', '+998909998877')).toBe(true);
      expect(await ask([south], 'Zafar', 'Toshmatov', '1985-05-06', '+998900000000')).toBe(false);
      // Linked to the branch of the request: read normally, not "elsewhere".
      expect(await ask([north], 'Zafar', 'Toshmatov', '1985-05-05', '+998909998877')).toBe(false);
      // No list chooses the branches: an empty one asks about every person.
      expect(await ask([], 'Zafar', 'Toshmatov', '1985-05-05', '+998900000000')).toBe(true);
    });

    it('answer whether an account is inactive or left, on the date of a moment', async () => {
      const account = await database.migrator
        .insertInto('accounts')
        .values({
          login: 'z.inactive',
          password_hash: HASH,
          must_change_password: false,
          created_at: MOMENT,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const id = await createPerson({
        branch: north,
        status: [{ status: 'active', from: '2026-09-01' }],
      });
      await database.migrator
        .updateTable('staff')
        .set({ account_id: account.id })
        .where('id', '=', id)
        .execute();
      await database.migrator
        .updateTable('staff_statuses')
        .set({ valid_until: '2026-11-01' })
        .where('staff_id', '=', id)
        .execute();
      await database.migrator
        .insertInto('staff_statuses')
        .values({ staff_id: id, status: 'inactive', valid_from: '2026-11-01' })
        .execute();
      const blocked = (at: string) =>
        call([], async (transaction) => {
          const found = await sql<{ answer: unknown }>`
            select staff_account_blocked(${account.id}::uuid, ${at}::timestamptz) as answer
          `.execute(transaction);
          return found.rows[0]?.answer;
        });
      // 23:30 in Tashkent on 31 October is 18:30 UTC: still active.
      expect(await blocked('2026-10-31T18:29:00Z')).toBe(false);
      // 00:00 in Tashkent on 1 November.
      expect(await blocked('2026-10-31T19:00:00Z')).toBe(true);
    });

    it('answer whether anybody not out of the school is in a division or a department, and count by main division', async () => {
      const tutors = (
        await database.migrator
          .selectFrom('departments')
          .select('id')
          .where('name_en', '=', 'Tutors')
          .executeTakeFirstOrThrow()
      ).id;
      const leaver = await createPerson({
        branch: north,
        department: tutors,
        status: [{ status: 'left', from: '2026-09-01' }],
      });
      const inDepartment = (department: string) =>
        call([south], async (transaction) => {
          const found = await sql<{ answer: unknown }>`
            select staff_in_division(null, ${department}::uuid, ${MOMENT.toISOString()}::timestamptz) as answer
          `.execute(transaction);
          return found.rows[0]?.answer;
        });
      expect(await inDepartment(tutors)).toBe(false);
      await createPerson({ branch: north, department: tutors });
      expect(await inDepartment(tutors)).toBe(true);
      expect(leaver).toEqual(expect.any(String));
      const counts = await call([], async (transaction) => {
        const found = await sql<Record<string, unknown>>`
          select * from staff_count_by_division(${MOMENT.toISOString()}::timestamptz)
        `.execute(transaction);
        return found.rows;
      });
      expect(Object.keys(counts[0] ?? {}).sort()).toEqual(['division_id', 'people']);
      expect(counts.find((row) => row.division_id === academic)?.people).toEqual(
        expect.any(Number),
      );
    });

    it('count the people of other branches a subject change would leave outside, and only those', async () => {
      const subject = await insertSubject(steam, [8, 9]);
      await createPerson({ branch: north, subjects: [{ subject, grades: [9] }] });
      await createPerson({ branch: south, subjects: [{ subject, grades: [8] }] });
      const inUse = (branch: string[], grades: number[], department: string) =>
        call(branch, async (transaction) => {
          const found = await sql<{ answer: unknown }>`
            select staff_subject_in_use(
              ${subject}::uuid, ${grades}::smallint[], ${department}::uuid,
              ${MOMENT.toISOString()}::timestamptz
            ) as answer
          `.execute(transaction);
          return found.rows[0]?.answer;
        });
      expect(await inUse([north], [8], steam)).toBe(0);
      expect(await inUse([north], [9], steam)).toBe(1);
      expect(await inUse([south], [9], steam)).toBe(0);
      expect(await inUse([north], [8, 9], languages)).toBe(1);
      expect(await inUse([], [8, 9], languages)).toBe(2);
    });
  });
});
