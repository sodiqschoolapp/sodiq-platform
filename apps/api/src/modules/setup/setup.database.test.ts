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
});
