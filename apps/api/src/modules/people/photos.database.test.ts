import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { repositoryRoot } from '../../database/config.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { staffIdOf } from './staff-numbers.js';
import { SystemClock } from '../../clock/system-clock.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const PHOTO = '0190f0c4-0000-7000-8000-0000000000aa';

// The photo columns of a staff record (db/migrations/0026, task 2.2c-2): a
// vacancy holds no photo (04 Vacancy, "nothing personal"; 2.2b correction 2),
// the id and the type go together, the type is JPEG or PNG, and the
// application may write the two columns and nothing more than before.
describe('staff photos in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let north: string;
  let academic: string;
  let steam: string;
  let count = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  async function newId(transaction: Transaction): Promise<string> {
    const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
    return found.rows[0]?.id ?? '';
  }

  async function createPerson(): Promise<string> {
    count += 1;
    return inBranch(north, async (transaction) => {
      const id = await newId(transaction);
      await transaction
        .insertInto('staff')
        .values({
          id,
          kind: 'person',
          staff_id: staffIdOf(2026, 8000 + count),
          first_name: 'Dilnoza',
          last_name: 'Rahimova',
          sex: 'female',
          birth_date: '1991-02-03',
          phone: `+9989200${String(count).padStart(5, '0')}`,
          admission_date: '2026-09-01',
        })
        .execute();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: id, branch_id: north, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({ staff_id: id, division_id: academic, department_id: steam, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: id, status: 'active', valid_from: '2026-09-01' })
        .execute();
      return id;
    });
  }

  async function createVacancy(): Promise<string> {
    count += 1;
    return inBranch(north, async (transaction) => {
      const id = await newId(transaction);
      await transaction
        .insertInto('staff')
        .values({ id, kind: 'vacancy', vacancy_name: `Physics vacancy ${String(count)}` })
        .execute();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: id, branch_id: north, is_main: true })
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
    });
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new SystemClock());
    north = await insertBranch(database.migrator, 'North');
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

  it('lets the application set and remove the photo of a person', async () => {
    const id = await createPerson();
    await inBranch(north, (transaction) =>
      transaction
        .updateTable('staff')
        .set({ photo_id: PHOTO, photo_type: 'image/jpeg' })
        .where('id', '=', id)
        .execute(),
    );
    const read = () =>
      database.migrator
        .selectFrom('staff')
        .select(['photo_id', 'photo_type'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
    expect(await read()).toEqual({ photo_id: PHOTO, photo_type: 'image/jpeg' });
    await inBranch(north, (transaction) =>
      transaction
        .updateTable('staff')
        .set({ photo_id: null, photo_type: null })
        .where('id', '=', id)
        .execute(),
    );
    expect(await read()).toEqual({ photo_id: null, photo_type: null });
  });

  it('refuses a photo on a vacancy, also from the migrator', async () => {
    const id = await createVacancy();
    await expect(
      inBranch(north, (transaction) =>
        transaction
          .updateTable('staff')
          .set({ photo_id: PHOTO, photo_type: 'image/png' })
          .where('id', '=', id)
          .execute(),
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_vacancy_check' });
    await expect(
      database.migrator
        .insertInto('staff')
        .values({
          kind: 'vacancy',
          vacancy_name: 'Physics vacancy X',
          photo_id: PHOTO,
          photo_type: 'image/jpeg',
        })
        .execute(),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_vacancy_check' });
  });

  it.each([
    [{ photo_id: PHOTO, photo_type: null }],
    [{ photo_id: null, photo_type: 'image/jpeg' }],
  ])('refuses an id without a type and a type without an id: %o', async (values) => {
    const id = await createPerson();
    await expect(
      database.migrator.updateTable('staff').set(values).where('id', '=', id).execute(),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_photo_check' });
  });

  it.each(['image/gif', 'image/webp', 'text/html', ''])('refuses the type %j', async (type) => {
    const id = await createPerson();
    await expect(
      database.migrator
        .updateTable('staff')
        .set({ photo_id: PHOTO, photo_type: type })
        .where('id', '=', id)
        .execute(),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'staff_photo_type_check' });
  });

  it('gives the application no insert of a photo and still no update of the staff ID', async () => {
    const id = await createPerson();
    await expect(
      inBranch(north, (transaction) =>
        transaction
          .insertInto('staff')
          .values({ kind: 'vacancy', vacancy_name: 'Physics vacancy Y', photo_id: null })
          .execute(),
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    await expect(
      inBranch(north, (transaction) =>
        transaction
          .updateTable('staff')
          .set({ staff_id: 'S-269999' })
          .where('id', '=', id)
          .execute(),
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });

  // Decision 13: dropped and created again with one condition added; the rest
  // is 0024's, word for word.
  it('keeps the vacancy check of 0024 with only `photo_id is null` added', async () => {
    const text = await readFile(path.join(repositoryRoot, 'db/migrations/0024_staff.sql'), 'utf8');
    const before = /constraint staff_vacancy_check check \(([\s\S]*?)\n {2}\)\n\);/.exec(text)?.[1];
    expect(before).toBeDefined();
    const definition = (
      await sql<{ definition: string }>`
        select pg_get_constraintdef(oid) as definition from pg_constraint
        where conname = 'staff_vacancy_check'
      `.execute(database.migrator)
    ).rows[0]?.definition;
    const words = (value: string) =>
      value
        .replace(/::text|[()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    expect(words(definition ?? '')).toBe(words(`check ${before ?? ''} and photo_id is null`));
  });
});
