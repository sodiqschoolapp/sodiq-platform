import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { staffIdOf } from './staff-numbers.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const EXCLUSION_VIOLATION = '23P01';

interface Range {
  weekday: number;
  start: number;
  end: number;
}

// The rules of availability and vacancies that the database itself keeps
// (db/migrations/0025, task 2.2b): hours of one person in two branches never
// overlap on any date (06, Teachers who work in several branches; the "done
// when" of 2.2b), one entry in force per branch and date, ranges cut with
// their entry, nothing deleted; a vacancy holds nothing personal and no staff
// ID (04, Vacancy; the "done when"), has one branch, and is deleted only
// through vacancy_delete; the main-branch check of 0024 unchanged for every
// record that exists (review of pull request #57, decision 9).
describe('availability and vacancies in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let north: string;
  let south: string;
  let east: string;
  let academic: string;
  let steam: string;
  let count = 0;

  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  async function newId(transaction: Transaction): Promise<string> {
    const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
    return found.rows[0]?.id ?? '';
  }

  /** A person with a main branch, written as the service does, and further branches by the migrator. */
  async function createPerson(branch: string, further: string[] = []): Promise<string> {
    count += 1;
    const id = await inBranch(branch, async (transaction) => {
      const record = await newId(transaction);
      await transaction
        .insertInto('staff')
        .values({
          id: record,
          kind: 'person',
          staff_id: staffIdOf(2026, 7000 + count),
          first_name: 'Akmal',
          last_name: 'Karimov',
          sex: 'male',
          birth_date: '1990-01-01',
          phone: `+9989100${String(count).padStart(5, '0')}`,
          admission_date: '2026-09-01',
        })
        .execute();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: record, branch_id: branch, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({ staff_id: record, division_id: academic, department_id: steam, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: record, status: 'active', valid_from: '2026-09-01' })
        .execute();
      return record;
    });
    for (const other of further) {
      await database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: id, branch_id: other, is_main: false })
        .execute();
    }
    return id;
  }

  /** The writes of a vacancy's create, in the order of the service. */
  async function writeVacancy(transaction: Transaction, branch: string): Promise<string> {
    count += 1;
    const id = await newId(transaction);
    await transaction
      .insertInto('staff')
      .values({ id, kind: 'vacancy', vacancy_name: `English vacancy ${String(count)}` })
      .execute();
    await transaction
      .insertInto('staff_branches')
      .values({ staff_id: id, branch_id: branch, is_main: true })
      .execute();
    await transaction
      .insertInto('staff_divisions')
      .values({ staff_id: id, division_id: academic, department_id: steam, is_main: true })
      .execute();
    await transaction
      .insertInto('staff_languages')
      .values({ staff_id: id, language: 'uz' })
      .execute();
    await transaction
      .insertInto('staff_statuses')
      .values({ staff_id: id, status: 'open', valid_from: '2026-10-12' })
      .execute();
    return id;
  }

  const createVacancy = (branch: string) =>
    inBranch(branch, (transaction) => writeVacancy(transaction, branch));

  /** An entry of a branch from a date, with its ranges, as the service writes it. */
  async function writeEntry(
    transaction: Transaction,
    input: { branch: string; staff: string; from: string; until?: string; ranges: Range[] },
  ): Promise<string> {
    const entry = await transaction
      .insertInto('staff_availability')
      .values({
        branch_id: input.branch,
        staff_id: input.staff,
        valid_from: input.from,
        ...(input.until === undefined ? {} : { valid_until: input.until }),
      })
      .returning(['id', 'valid_until'])
      .executeTakeFirstOrThrow();
    for (const range of input.ranges) {
      await transaction
        .insertInto('staff_availability_ranges')
        .values({
          entry_id: entry.id,
          branch_id: input.branch,
          staff_id: input.staff,
          weekday: range.weekday,
          start_minutes: range.start,
          end_minutes: range.end,
          valid_from: input.from,
          valid_until: entry.valid_until,
        })
        .execute();
    }
    return entry.id;
  }

  const addEntry = (input: {
    branch: string;
    staff: string;
    from: string;
    until?: string;
    ranges: Range[];
  }) => inBranch(input.branch, (transaction) => writeEntry(transaction, input));

  const MONDAY_MORNING: Range = { weekday: 1, start: 8 * 60, end: 13 * 60 };

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    east = await insertBranch(database.migrator, 'East');
    academic = (
      await database.migrator
        .selectFrom('divisions')
        .select('id')
        .where('name_en', '=', 'Academic')
        .executeTakeFirstOrThrow()
    ).id;
    steam = (
      await database.migrator
        .selectFrom('departments')
        .select('id')
        .where('name_en', '=', 'STEAM')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('availability', () => {
    // The "done when" of 2.2b: availability in two branches cannot overlap on any date.
    it('refuses hours in a second branch that overlap the first on a date', async () => {
      const person = await createPerson(north, [south]);
      await addEntry({
        branch: north,
        staff: person,
        from: '2026-10-13',
        ranges: [MONDAY_MORNING],
      });
      await expect(
        addEntry({
          branch: south,
          staff: person,
          from: '2026-11-02',
          ranges: [{ weekday: 1, start: 12 * 60, end: 15 * 60 }],
        }),
      ).rejects.toMatchObject({
        code: EXCLUSION_VIOLATION,
        constraint: 'staff_availability_ranges_no_overlap',
      });
    });

    it('refuses the overlap when the two branches write at the same moment: the second waits', async () => {
      const person = await createPerson(north, [south]);
      let releaseFirst: () => void = () => undefined;
      const firstHolds = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstWrote: () => void = () => undefined;
      const written = new Promise<void>((resolve) => {
        firstWrote = resolve;
      });
      const first = inBranch(north, async (transaction) => {
        await writeEntry(transaction, {
          branch: north,
          staff: person,
          from: '2026-10-13',
          ranges: [MONDAY_MORNING],
        });
        firstWrote();
        await firstHolds;
      });
      await written;
      const second = addEntry({
        branch: south,
        staff: person,
        from: '2026-10-13',
        ranges: [{ weekday: 1, start: 9 * 60, end: 10 * 60 }],
      });
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      releaseFirst();
      await first;
      await expect(second).rejects.toMatchObject({
        code: EXCLUSION_VIOLATION,
        constraint: 'staff_availability_ranges_no_overlap',
      });
    });

    it('accepts ranges that touch, other weekdays and dates outside the other entry', async () => {
      const person = await createPerson(north, [south]);
      await addEntry({
        branch: north,
        staff: person,
        from: '2026-10-13',
        until: '2026-11-02',
        ranges: [MONDAY_MORNING],
      });
      await addEntry({
        branch: south,
        staff: person,
        from: '2026-10-13',
        ranges: [
          { weekday: 1, start: 13 * 60, end: 17 * 60 },
          { weekday: 2, start: 8 * 60, end: 13 * 60 },
        ],
      });
      await expect(
        addEntry({
          branch: south,
          staff: person,
          from: '2026-10-13',
          ranges: [],
        }),
      ).rejects.toMatchObject({
        code: EXCLUSION_VIOLATION,
        constraint: 'staff_availability_no_overlap',
      });
      const movedLater = await createPerson(north, [east]);
      await addEntry({
        branch: north,
        staff: movedLater,
        from: '2026-10-13',
        until: '2026-11-02',
        ranges: [MONDAY_MORNING],
      });
      await addEntry({
        branch: east,
        staff: movedLater,
        from: '2026-11-02',
        ranges: [MONDAY_MORNING],
      });
    });

    it('never compares a withdrawn entry', async () => {
      const person = await createPerson(north, [south]);
      await addEntry({
        branch: north,
        staff: person,
        from: '2026-11-02',
        until: '2026-11-02',
        ranges: [MONDAY_MORNING],
      });
      await addEntry({
        branch: south,
        staff: person,
        from: '2026-10-13',
        ranges: [MONDAY_MORNING],
      });
    });

    it('refuses two overlapping ranges of one entry', async () => {
      const person = await createPerson(north);
      await expect(
        addEntry({
          branch: north,
          staff: person,
          from: '2026-10-13',
          ranges: [MONDAY_MORNING, { weekday: 1, start: 12 * 60, end: 14 * 60 }],
        }),
      ).rejects.toMatchObject({ code: EXCLUSION_VIOLATION });
    });

    it('checks the weekday and the order of the minutes', async () => {
      const person = await createPerson(north);
      await expect(
        addEntry({
          branch: north,
          staff: person,
          from: '2026-10-13',
          ranges: [{ weekday: 8, start: 60, end: 120 }],
        }),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'staff_availability_ranges_weekday_check',
      });
      await expect(
        addEntry({
          branch: north,
          staff: person,
          from: '2026-10-13',
          ranges: [{ weekday: 1, start: 600, end: 600 }],
        }),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'staff_availability_ranges_order_check',
      });
    });

    it('cuts the ranges with their entry and never lets their dates differ from it', async () => {
      const person = await createPerson(north);
      const entry = await addEntry({
        branch: north,
        staff: person,
        from: '2026-10-13',
        ranges: [MONDAY_MORNING],
      });
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('staff_availability')
          .set({ valid_until: '2026-12-01' })
          .where('id', '=', entry)
          .execute(),
      );
      const range = await database.migrator
        .selectFrom('staff_availability_ranges')
        .select(sql<string>`valid_until::text`.as('until'))
        .where('entry_id', '=', entry)
        .executeTakeFirstOrThrow();
      expect(range.until).toBe('2026-12-01');
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .insertInto('staff_availability_ranges')
            .values({
              entry_id: entry,
              branch_id: north,
              staff_id: person,
              weekday: 2,
              start_minutes: 60,
              end_minutes: 120,
              valid_from: '2026-10-13',
              valid_until: '2026-12-31',
            })
            .execute(),
        ),
      ).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
        constraint: 'staff_availability_ranges_entry_fkey',
      });
    });

    it('only shrinks an entry, and the application deletes nothing and changes no range', async () => {
      const person = await createPerson(north);
      const entry = await addEntry({
        branch: north,
        staff: person,
        from: '2026-10-13',
        until: '2026-12-01',
        ranges: [MONDAY_MORNING],
      });
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('staff_availability')
            .set({ valid_until: '2026-12-31' })
            .where('id', '=', entry)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'dated_rows_only_shrink' });
      await expect(
        inBranch(north, (transaction) =>
          sql`delete from staff_availability where id = ${entry}`.execute(transaction),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await expect(
        inBranch(north, (transaction) =>
          sql`delete from staff_availability_ranges where entry_id = ${entry}`.execute(transaction),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await expect(
        inBranch(north, (transaction) =>
          sql`update staff_availability_ranges set end_minutes = 900 where entry_id = ${entry}`.execute(
            transaction,
          ),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('keeps each branch to its own rows', async () => {
      const person = await createPerson(north, [south]);
      await addEntry({
        branch: north,
        staff: person,
        from: '2026-10-13',
        ranges: [MONDAY_MORNING],
      });
      const seen = (branch: string) =>
        inBranch(branch, async (transaction) => ({
          entries: (
            await transaction
              .selectFrom('staff_availability')
              .select('id')
              .where('staff_id', '=', person)
              .execute()
          ).length,
          ranges: (
            await transaction
              .selectFrom('staff_availability_ranges')
              .select('entry_id')
              .where('staff_id', '=', person)
              .execute()
          ).length,
        }));
      expect(await seen(north)).toEqual({ entries: 1, ranges: 1 });
      expect(await seen(south)).toEqual({ entries: 0, ranges: 0 });
      await expect(
        inBranch(south, (transaction) =>
          writeEntry(transaction, {
            branch: north,
            staff: person,
            from: '2027-01-04',
            ranges: [],
          }),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('answers the other branches only, and only for a record linked to the branch', async () => {
      const person = await createPerson(north, [south]);
      await addEntry({
        branch: north,
        staff: person,
        from: '2026-10-13',
        ranges: [MONDAY_MORNING],
      });
      await addEntry({ branch: south, staff: person, from: '2026-10-13', ranges: [] });
      const elsewhere = (branch: string) =>
        inBranch(
          branch,
          async (transaction) =>
            (
              await sql<{
                branch_id: string;
                weekday: number | null;
              }>`select branch_id, weekday from staff_availability_elsewhere(${person}) order by branch_id`.execute(
                transaction,
              )
            ).rows,
        );
      expect(await elsewhere(south)).toEqual([{ branch_id: north, weekday: 1 }]);
      expect(await elsewhere(north)).toEqual([{ branch_id: south, weekday: null }]);
      expect(await elsewhere(east)).toEqual([]);
    });
  });

  describe('vacancies', () => {
    const vacancyValues = (fields: Record<string, unknown>) => ({
      kind: 'vacancy',
      vacancy_name: 'English vacancy 2',
      ...fields,
    });

    // The "done when" of 2.2b: a vacancy cannot hold personal data or a staff ID.
    it.each([
      ['staff_id', 'S-260999'],
      ['account_id', '0190f0c4-0000-7000-8000-000000000001'],
      ['first_name', 'Akmal'],
      ['last_name', 'Karimov'],
      ['father_name', 'Botirovich'],
      ['sex', 'male'],
      ['birth_date', '1990-01-01'],
      ['education_level', 'master'],
      ['phone', '+998901234567'],
      ['email', 'vacancy@school.uz'],
      ['jshshir', '31234567890123'],
      ['admission_date', '2026-09-01'],
      ['contract_type', 'full_time'],
      ['contract_date', '2026-09-01'],
    ])('refuses a vacancy with %s', async (column, value) => {
      await expect(
        database.migrator
          .insertInto('staff')
          .values(vacancyValues({ [column]: value }))
          .execute(),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_vacancy_check' });
    });

    it('takes a vacancy written by the application, with its name and load', async () => {
      const id = await createVacancy(north);
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('staff')
          .set({ vacancy_name: 'English vacancy B', weekly_lessons: 18, daily_lessons: 6 })
          .where('id', '=', id)
          .execute(),
      );
      const row = await database.migrator
        .selectFrom('staff')
        .select(['kind', 'staff_id', 'vacancy_name'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ kind: 'vacancy', staff_id: null, vacancy_name: 'English vacancy B' });
    });

    it('refuses a second branch, also from a transaction of that branch', async () => {
      const id = await createVacancy(north);
      await expect(
        inBranch(south, (transaction) =>
          transaction
            .insertInto('staff_branches')
            .values({ staff_id: id, branch_id: south, is_main: false })
            .execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_vacancy_one_branch' });
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('staff_branches')
            .set({ is_main: false })
            .where('staff_id', '=', id)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('takes open and closed for a vacancy, and only those', async () => {
      const id = await createVacancy(north);
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .insertInto('staff_statuses')
            .values({ staff_id: id, status: 'active', valid_from: '2027-01-04' })
            .execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_statuses_kind' });
      const person = await createPerson(north);
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .insertInto('staff_statuses')
            .values({ staff_id: person, status: 'open', valid_from: '2027-01-04' })
            .execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_statuses_kind' });
    });

    it('is deleted with every row of it through vacancy_delete only', async () => {
      const id = await createVacancy(north);
      await addEntry({ branch: north, staff: id, from: '2026-10-13', ranges: [MONDAY_MORNING] });
      await expect(
        inBranch(north, (transaction) =>
          sql`delete from staff where id = ${id}`.execute(transaction),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await expect(
        inBranch(south, (transaction) => sql`select vacancy_delete(${id})`.execute(transaction)),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'vacancy_not_deletable' });
      await inBranch(north, (transaction) =>
        sql`select vacancy_delete(${id})`.execute(transaction),
      );
      for (const table of [
        'staff_availability_ranges',
        'staff_availability',
        'staff_statuses',
        'staff_languages',
        'staff_divisions',
        'staff_branches',
      ] as const) {
        const left = await database.migrator
          .selectFrom(table)
          .select('staff_id')
          .where('staff_id', '=', id)
          .execute();
        expect(left, table).toEqual([]);
      }
      expect(
        await database.migrator.selectFrom('staff').select('id').where('id', '=', id).execute(),
      ).toEqual([]);
    });

    it('never deletes a person', async () => {
      const person = await createPerson(north);
      await expect(
        inBranch(north, (transaction) =>
          sql`select vacancy_delete(${person})`.execute(transaction),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'vacancy_not_deletable' });
    });
  });

  describe('the main-branch check', () => {
    // Review of pull request #57, finding 2 of the spec review: the record is
    // invisible to the transaction once its link there is gone, and still checked.
    it('refuses a branch transaction that removes the main link of a person linked elsewhere', async () => {
      const person = await createPerson(north, [south]);
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .deleteFrom('staff_branches')
            .where('staff_id', '=', person)
            .where('branch_id', '=', north)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_main_branch' });
    });

    it('refuses a record without a main branch', async () => {
      const person = await createPerson(north, [south]);
      await expect(
        database.migrator
          .updateTable('staff_branches')
          .set({ is_main: false })
          .where('staff_id', '=', person)
          .where('branch_id', '=', north)
          .execute(),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_main_branch' });
    });
  });
});
