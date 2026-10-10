import { ROOM_STATUSES, ROOM_TYPES, WEEKDAYS } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

const MOMENT = new Date('2026-10-10T09:00:00+05:00');

// The rules of school setup that the database itself keeps
// (db/migrations/0014), also when the application has a fault: a building, a
// floor and a room belong to one branch and are seen only through its filter;
// a floor stays in a building of its branch and a room on a floor of its
// branch; names are unique where they would be indistinguishable; the lists
// of types, statuses and weekdays are the spec's; the application changes
// only what the Super Admin may type and removes nothing.
describe('school setup in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let north: string;
  let south: string;
  let northBuilding: string;
  let northFloor: string;
  let southBuilding: string;
  let southFloor: string;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  const insertBuilding = (branch: string, name: string, archivedAt: Date | null = null) =>
    inBranch(branch, (transaction) =>
      transaction
        .insertInto('buildings')
        .values({ branch_id: branch, name, archived_at: archivedAt })
        .returning('id')
        .executeTakeFirstOrThrow(),
    ).then((row) => row.id);

  const insertFloor = (
    branch: string,
    building: string,
    name: string,
    archivedAt: Date | null = null,
  ) =>
    inBranch(branch, (transaction) =>
      transaction
        .insertInto('floors')
        .values({ branch_id: branch, building_id: building, name, archived_at: archivedAt })
        .returning('id')
        .executeTakeFirstOrThrow(),
    ).then((row) => row.id);

  const insertRoom = (
    branch: string,
    floor: string,
    fields: {
      name?: string;
      type?: string;
      capacity?: number;
      status?: string;
      shared?: boolean;
      max?: number | null;
    } = {},
  ) =>
    inBranch(branch, (transaction) =>
      transaction
        .insertInto('rooms')
        .values({
          branch_id: branch,
          floor_id: floor,
          name: fields.name ?? `R-${String(Math.random()).slice(2, 10)}`,
          type: fields.type ?? 'classroom',
          capacity: fields.capacity ?? 28,
          status: fields.status ?? 'in_use',
          shared: fields.shared ?? false,
          max_simultaneous_lessons: fields.max ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    ).then((row) => row.id);

  /** The values a check constraint names, in order, as the database writes the constraint back. */
  async function valuesOfCheck(name: string): Promise<string[]> {
    const found = await sql<{ definition: string }>`
      select pg_get_constraintdef(oid) as definition from pg_constraint where conname = ${name}
    `.execute(database.migrator);
    const definition = found.rows[0]?.definition ?? '';
    return [...definition.matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? '');
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    northBuilding = await insertBuilding(north, 'Main');
    northFloor = await insertFloor(north, northBuilding, '1');
    southBuilding = await insertBuilding(south, 'Main');
    southFloor = await insertFloor(south, southBuilding, '1');
  });

  afterAll(async () => {
    await database.destroy();
  });

  // docs/spec/edge-cases/developer-rules.md, Branch filter.
  describe('keep buildings, floors and rooms behind the branch filter', () => {
    it('so that a transaction of another branch sees none of them', async () => {
      await insertRoom(north, northFloor, { name: 'N-101' });

      const seen = await inBranch(south, async (transaction) => ({
        buildings: await transaction.selectFrom('buildings').select('id').execute(),
        floors: await transaction.selectFrom('floors').select('id').execute(),
        rooms: await transaction.selectFrom('rooms').select('id').execute(),
      }));

      expect(seen.buildings.map((row) => row.id)).toEqual([southBuilding]);
      expect(seen.floors.map((row) => row.id)).toEqual([southFloor]);
      expect(seen.rooms).toEqual([]);
    });

    it('so that a transaction of one branch cannot write a row of another', async () => {
      await expect(
        inBranch(south, (transaction) =>
          transaction.insertInto('buildings').values({ branch_id: north, name: 'Annex' }).execute(),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await expect(
        inBranch(south, (transaction) =>
          transaction
            .insertInto('floors')
            .values({ branch_id: north, building_id: northBuilding, name: '2' })
            .execute(),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });
  });

  // .claude/rules/database.md: an id that arrives in a request is checked
  // against the branch. The composite foreign keys keep it so in the database.
  describe('keep a floor in a building of its branch, and a room on a floor of its branch', () => {
    it('refuse a floor whose building is in another branch', async () => {
      await expect(insertFloor(north, southBuilding, '2')).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
      });
    });

    it('refuse a room whose floor is in another branch', async () => {
      await expect(insertRoom(north, southFloor)).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
      });
    });
  });

  describe('check what is typed', () => {
    it.each(['', ' ', 'B'.repeat(101)])('refuse the building name %j', async (name) => {
      await expect(insertBuilding(north, name)).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it.each(['', 'F'.repeat(51)])('refuse the floor name %j', async (name) => {
      await expect(insertFloor(north, northBuilding, name)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
    });

    it.each(['', 'R'.repeat(51)])('refuse the room name %j', async (name) => {
      await expect(insertRoom(north, northFloor, { name })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
    });

    it('take the five room types and refuse another', async () => {
      for (const type of ROOM_TYPES) {
        await expect(insertRoom(north, northFloor, { type })).resolves.toEqual(expect.any(String));
      }
      await expect(insertRoom(north, northFloor, { type: 'gym' })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
    });

    it('take the three statuses and refuse another', async () => {
      for (const status of ROOM_STATUSES) {
        await expect(insertRoom(north, northFloor, { status })).resolves.toEqual(
          expect.any(String),
        );
      }
      await expect(insertRoom(north, northFloor, { status: 'open' })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
    });

    it('keep the lists of types and statuses equal to those of packages/shared', async () => {
      expect(await valuesOfCheck('rooms_type_check')).toEqual([...ROOM_TYPES]);
      expect(await valuesOfCheck('rooms_status_check')).toEqual([...ROOM_STATUSES]);
    });

    it('take a capacity of 1 to 1000 and refuse 0 and 1001', async () => {
      await expect(insertRoom(north, northFloor, { capacity: 1 })).resolves.toEqual(
        expect.any(String),
      );
      await expect(insertRoom(north, northFloor, { capacity: 1000 })).resolves.toEqual(
        expect.any(String),
      );
      await expect(insertRoom(north, northFloor, { capacity: 0 })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await expect(insertRoom(north, northFloor, { capacity: 1001 })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
    });

    // docs/spec/edge-cases/timetable.md, Structure: the "shared" switch and
    // a maximum number of lessons at the same time.
    it('take the number of lessons at once for a shared room only, 2 to 10', async () => {
      await expect(insertRoom(north, northFloor, { shared: true, max: 2 })).resolves.toEqual(
        expect.any(String),
      );
      await expect(insertRoom(north, northFloor, { shared: true, max: 10 })).resolves.toEqual(
        expect.any(String),
      );
      for (const wrong of [
        { shared: true, max: null },
        { shared: true, max: 1 },
        { shared: true, max: 11 },
        { shared: false, max: 2 },
      ]) {
        await expect(insertRoom(north, northFloor, wrong)).rejects.toMatchObject({
          code: CHECK_VIOLATION,
        });
      }
    });

    it('take working weekdays of 1 to 7, at least one, and refuse 0, 8 and none', async () => {
      const set = (days: number[]) =>
        inBranch(north, (transaction) =>
          transaction
            .updateTable('branches')
            .set({ working_weekdays: days })
            .where('id', '=', north)
            .execute(),
        );
      await expect(set([...WEEKDAYS])).resolves.toBeDefined();
      await expect(set([6, 7])).resolves.toBeDefined();
      await expect(set([])).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(set([0, 1])).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(set([1, 8])).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(set([1, 2, 3, 4, 5])).resolves.toBeDefined();
    });

    it('refuse an empty or too long branch field', async () => {
      const set = (fields: Record<string, string | null>) =>
        inBranch(north, (transaction) =>
          transaction.updateTable('branches').set(fields).where('id', '=', north).execute(),
        );
      await expect(set({ name: ' ' })).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(set({ address: '' })).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(set({ phone: '1'.repeat(41) })).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(set({ email: 'e'.repeat(201) })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await expect(set({ address: null, phone: null, email: null })).resolves.toBeDefined();
    });
  });

  describe('keep names unique where they would be indistinguishable', () => {
    it('two branches of one name, also with other case and spaces', async () => {
      await expect(insertBranch(database.migrator, ' north ')).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
      });
    });

    it('two active buildings of one name in a branch; the name is free in another branch and after an archive', async () => {
      await expect(insertBuilding(north, ' MAIN ')).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
      });
      // South has its own "Main" already (beforeAll): another branch is free.
      await insertBuilding(north, 'Old wing', MOMENT);
      await expect(insertBuilding(north, 'Old wing')).resolves.toEqual(expect.any(String));
    });

    it('two active floors of one name in a building; the name is free in another building and after an archive', async () => {
      await expect(insertFloor(north, northBuilding, ' 1 ')).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
      });
      const annex = await insertBuilding(north, 'Annex');
      await expect(insertFloor(north, annex, '1')).resolves.toEqual(expect.any(String));
      await insertFloor(north, annex, 'Attic', MOMENT);
      await expect(insertFloor(north, annex, 'Attic')).resolves.toEqual(expect.any(String));
    });

    it('two rooms of one name in a branch, whatever their buildings; the name is free in another branch', async () => {
      const annex = await insertBuilding(north, 'Annex B');
      const annexFloor = await insertFloor(north, annex, '1');
      await insertRoom(north, northFloor, { name: '205' });
      await expect(insertRoom(north, annexFloor, { name: ' 205 ' })).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
      });
      await expect(insertRoom(south, southFloor, { name: '205' })).resolves.toEqual(
        expect.any(String),
      );
    });
  });

  // CLAUDE.md: archive, do not delete. The application user removes nothing
  // and changes only what the Super Admin may type.
  describe('let the application', () => {
    it('remove nothing', async () => {
      for (const table of ['branches', 'buildings', 'floors', 'rooms'] as const) {
        await expect(
          inBranch(north, (transaction) => transaction.deleteFrom(table).execute()),
        ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      }
    });

    it('not move a building, a floor or a room to another branch, nor change when it was created', async () => {
      const refused = (statement: string) =>
        expect(
          inBranch(north, (transaction) => sql.raw(statement).execute(transaction)),
        ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await refused(`update buildings set branch_id = '${south}'`);
      await refused(`update floors set branch_id = '${south}'`);
      await refused(`update floors set building_id = '${northBuilding}'`);
      await refused(`update rooms set branch_id = '${south}'`);
      await refused(`update buildings set created_at = now()`);
      await refused(`update rooms set created_at = now()`);
    });

    it('not change the time zone of a branch', async () => {
      await expect(
        inBranch(north, (transaction) =>
          sql.raw(`update branches set time_zone = 'Europe/Berlin'`).execute(transaction),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      const row = await database.migrator
        .selectFrom('branches')
        .select(['time_zone', 'working_weekdays'])
        .where('id', '=', north)
        .executeTakeFirstOrThrow();
      expect(row.time_zone).toBe('Asia/Tashkent');
    });
  });

  // docs/spec/03-school-setup.md, Divisions (task 1.2; db/migrations/0015):
  // "The school has eight (decided)"; "One list for the whole school";
  // "Academic is built in. It cannot be renamed or archived"; "Each division
  // and department has a name in three languages."
  describe('keep the divisions and departments of the spec', () => {
    const RESTRICT_VIOLATION = '23001';

    const schoolWide = <T>(work: (transaction: Transaction) => Promise<T>) =>
      transactions.run([], work);

    /** As the application: it may write the names and the position only. */
    const insertDivision = (names: { uz: string; ru: string; en: string }, position: number) =>
      schoolWide((transaction) =>
        transaction
          .insertInto('divisions')
          .values({ name_uz: names.uz, name_ru: names.ru, name_en: names.en, position })
          .returning('id')
          .executeTakeFirstOrThrow(),
      ).then((row) => row.id);

    /** An archived division, written by the migrator: the application archives through an update. */
    const insertArchivedDivision = (
      names: { uz: string; ru: string; en: string },
      position: number,
    ) =>
      database.migrator
        .insertInto('divisions')
        .values({
          name_uz: names.uz,
          name_ru: names.ru,
          name_en: names.en,
          position,
          archived_at: MOMENT,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id);

    const insertDepartment = (
      division: string,
      names: { uz: string; ru: string; en: string },
      position: number,
    ) =>
      schoolWide((transaction) =>
        transaction
          .insertInto('departments')
          .values({
            division_id: division,
            name_uz: names.uz,
            name_ru: names.ru,
            name_en: names.en,
            position,
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      ).then((row) => row.id);

    const academicId = () =>
      database.migrator
        .selectFrom('divisions')
        .select('id')
        .where('built_in', '=', true)
        .executeTakeFirstOrThrow()
        .then((row) => row.id);

    it('seeded: the eight divisions in the order of the table of 03, Academic built in, and their fourteen departments in order', async () => {
      const divisions = await database.migrator
        .selectFrom('divisions')
        .select(['id', 'name_en', 'name_uz', 'built_in', 'position', 'archived_at'])
        .orderBy('position')
        .execute();
      const departments = await database.migrator
        .selectFrom('departments')
        .select(['division_id', 'name_en', 'position'])
        .orderBy('position')
        .execute();

      expect(divisions.map((row) => row.name_en)).toEqual([
        'Academic',
        'Management',
        'Student Services',
        'Admissions and Marketing',
        'Finance',
        'HR',
        'IT',
        'Operations',
      ]);
      expect(divisions.map((row) => row.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(divisions.map((row) => row.built_in)).toEqual([
        true,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
      ]);
      expect(divisions.every((row) => row.archived_at === null)).toBe(true);
      // The Uzbek names of `03`, with U+02BB as the locale files write oʻ.
      expect(divisions[0]?.name_uz).toBe('Oʻquv boʻlimi');
      expect(divisions[7]?.name_uz).toBe('Xoʻjalik boʻlimi');
      const byDivision = (en: string) =>
        departments
          .filter((row) => row.division_id === divisions.find((one) => one.name_en === en)?.id)
          .map((row) => row.name_en);
      expect(departments).toHaveLength(14);
      expect(byDivision('Academic')).toEqual([
        'STEAM',
        'Foreign languages',
        'National',
        'Natural sciences',
        'General',
        'Tutors',
      ]);
      expect(byDivision('Student Services')).toEqual([
        'Medical',
        'Psychology',
        'Library',
        'Clubs and events',
      ]);
      expect(byDivision('Operations')).toEqual(['Facilities', 'Catering', 'Security', 'Transport']);
      expect(byDivision('Management')).toEqual([]);
    });

    it('refuse a rename and an archive of Academic, by the application and by the migrator alike', async () => {
      const id = await academicId();
      const byApp = (fields: Record<string, string | Date>) =>
        schoolWide((transaction) =>
          transaction.updateTable('divisions').set(fields).where('id', '=', id).execute(),
        );
      const byMigrator = (fields: Record<string, string | Date>) =>
        database.migrator.updateTable('divisions').set(fields).where('id', '=', id).execute();

      const changes: Record<string, string | Date>[] = [
        { name_en: 'Study' },
        { name_uz: 'Oʻqitish' },
        { name_ru: 'Учёба' },
        { archived_at: MOMENT },
      ];
      for (const change of changes) {
        await expect(byApp(change)).rejects.toMatchObject({ code: RESTRICT_VIOLATION });
        await expect(byMigrator(change)).rejects.toMatchObject({ code: RESTRICT_VIOLATION });
      }
      const row = await database.migrator
        .selectFrom('divisions')
        .select(['name_en', 'archived_at'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ name_en: 'Academic', archived_at: null });
    });

    it('let the application neither write built_in nor delete, move or reorder a record', async () => {
      const refused = (statement: string) =>
        expect(
          schoolWide((transaction) => sql.raw(statement).execute(transaction)),
        ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await refused(
        `insert into divisions (name_uz, name_ru, name_en, built_in, position) values ('A', 'A', 'A', true, 50)`,
      );
      await refused(`update divisions set built_in = true where position = 2`);
      await refused(`update divisions set position = 9 where position = 2`);
      await refused(`update departments set position = 9`);
      await refused(
        `update departments set division_id = (select id from divisions where position = 2)`,
      );
      await refused(`delete from departments`);
      await refused(`delete from divisions`);
    });

    it('refuse two active divisions of one name in any language, also one that differs in Cyrillic case only; an archived name is free', async () => {
      await expect(
        insertDivision({ uz: 'Boshqa', ru: 'Другое', en: ' finance ' }, 20),
      ).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'divisions_active_name_en_idx',
      });
      await expect(
        insertDivision({ uz: 'Boshqa', ru: 'ФИНАНСОВЫЙ ОТДЕЛ', en: 'Other' }, 20),
      ).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'divisions_active_name_ru_idx',
      });
      await expect(
        insertDivision({ uz: 'MOLIYA BOʻLIMI', ru: 'Другое', en: 'Other' }, 20),
      ).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'divisions_active_name_uz_idx',
      });
      await insertArchivedDivision({ uz: 'Eski', ru: 'Старый', en: 'Old' }, 21);
      await expect(insertDivision({ uz: 'Eski', ru: 'Старый', en: 'Old' }, 22)).resolves.toEqual(
        expect.any(String),
      );
    });

    it('refuse two active departments of one name in a division, while another division may have it; refuse one in an unknown division', async () => {
      const academic = await academicId();
      const operations = await database.migrator
        .selectFrom('divisions')
        .select('id')
        .where('name_en', '=', 'Operations')
        .executeTakeFirstOrThrow();

      await expect(
        insertDepartment(academic, { uz: 'A', ru: 'Б', en: ' steam ' }, 20),
      ).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'departments_active_name_en_idx',
      });
      await expect(
        insertDepartment(operations.id, { uz: 'A', ru: 'Б', en: 'STEAM' }, 20),
      ).resolves.toEqual(expect.any(String));
      await expect(
        insertDepartment('0199a000-0000-7000-8000-000000000099', { uz: 'A', ru: 'Б', en: 'C' }, 1),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    });

    it('refuse an empty or too long name, a position below one, and two active records on one position', async () => {
      await expect(insertDivision({ uz: '', ru: 'Б', en: 'C' }, 30)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await expect(
        insertDivision({ uz: 'A', ru: 'Б', en: 'C'.repeat(101) }, 30),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(insertDivision({ uz: 'A', ru: 'Б', en: 'C' }, 0)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await expect(
        insertDivision({ uz: 'Birinchi', ru: 'Первый', en: 'First' }, 1),
      ).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'divisions_active_position_idx',
      });
    });
  });
});
