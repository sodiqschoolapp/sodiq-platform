import {
  ANNOUNCEMENT_BODY_MAX_LENGTH,
  ANNOUNCEMENT_PLACE_MAX_LENGTH,
  ANNOUNCEMENT_TITLE_MAX_LENGTH,
} from '@sodiq/shared';
import { readFileSync } from 'node:fs';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemClock } from '../../clock/system-clock.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';

const MOMENT = new Date('2026-10-13T10:00:00+05:00');

/** The error code of a refused statement, or `ok`. */
async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return 'ok';
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : 'unknown';
  }
}

// All names are invented. Task 11.7, pull request #306: what migration 0164 keeps itself, also
// when the application has a fault: a branch announcement is seen through its branch only and a
// whole-school one in every branch (plan decision 1); the classes of an audience are of its own
// branch; the shape of news and events; the bounds of the shared schemas; nothing deleted; the
// audience and the readers never change (plan decision 5).
describe('announcements in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let north: string;
  let south: string;
  let author: string;
  let northClass: string;
  let southClass: string;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  const base = (branch: string | null) => ({
    branch_id: branch,
    kind: 'news',
    title: 'Sports day',
    body: 'In the yard.',
    audience: branch === null ? 'school' : 'branch',
    grades: null as number[] | null,
    for_staff: true,
    for_parents: true,
    published_at: MOMENT,
    published_by: author,
  });

  const insert = (branch: string, values: Record<string, unknown>) =>
    inBranch(branch, (transaction) =>
      transaction
        .insertInto('announcements')
        .values({ ...base(branch), ...values })
        .returning('id')
        .executeTakeFirstOrThrow(),
    ).then((row) => row.id);

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new SystemClock());
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    const kit = new ClassesKit(database.migrator);
    author = await kit.account();
    const northYear = await kit.year(north);
    const southYear = await kit.year(south);
    northClass = await kit.schoolClass(north, northYear, { grade: 7, room: await kit.room(north) });
    southClass = await kit.schoolClass(south, southYear, { grade: 7, room: await kit.room(south) });
  }, 120_000);

  afterAll(async () => {
    await database.destroy();
  });

  it('shows a branch announcement in its branch only and a whole-school one in every branch', async () => {
    const own = await insert(north, {});
    const school = await insert(north, { branch_id: null, audience: 'school' });
    const seen = (branch: string) =>
      inBranch(branch, (transaction) =>
        transaction.selectFrom('announcements').select('id').orderBy('id').execute(),
      ).then((rows) => rows.map((row) => row.id));
    expect(await seen(north)).toEqual(expect.arrayContaining([own, school]));
    expect(await seen(south)).toContain(school);
    expect(await seen(south)).not.toContain(own);
    // Written for another branch through the filter: refused.
    expect(await refusal(() => insert(north, { branch_id: south }))).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('keeps the bounds of the shared schemas', () => {
    const migration = readFileSync(
      new URL('../../../../../db/migrations/0164_announcements.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toContain(
      `length(btrim(title)) between 1 and ${String(ANNOUNCEMENT_TITLE_MAX_LENGTH)}`,
    );
    expect(migration).toContain(
      `length(btrim(body)) between 1 and ${String(ANNOUNCEMENT_BODY_MAX_LENGTH)}`,
    );
    expect(migration).toContain(
      `length(btrim(place)) between 1 and ${String(ANNOUNCEMENT_PLACE_MAX_LENGTH)}`,
    );
  });

  it('refuses a shape that is neither news nor an event, and a school audience with a branch', async () => {
    for (const values of [
      { title: 'x'.repeat(ANNOUNCEMENT_TITLE_MAX_LENGTH + 1) },
      { body: '   ' },
      { for_staff: false, for_parents: false },
      { audience: 'school' },
      { audience: 'grades' },
      { audience: 'grades', grades: [12] },
      { audience: 'grades', grades: [7, 7] },
      { audience: 'grades', grades: [] },
      { grades: [7] },
      { first_date: '2026-10-20', last_date: '2026-10-20' },
      { kind: 'event' },
      { kind: 'event', first_date: '2026-10-21', last_date: '2026-10-20' },
      { kind: 'event', first_date: '2026-10-20', last_date: '2026-10-20', ends_at: '10:00' },
      {
        kind: 'event',
        first_date: '2026-10-20',
        last_date: '2026-10-20',
        starts_at: '10:00',
        ends_at: '09:00',
      },
      { kind: 'event', first_date: '2026-10-20', last_date: '2026-10-20', starts_at: '10:00:30' },
    ]) {
      expect(await refusal(() => insert(north, values)), JSON.stringify(values)).toBe(
        CHECK_VIOLATION,
      );
    }
    expect(
      await refusal(() =>
        insert(north, {
          kind: 'event',
          first_date: '2026-10-20',
          last_date: '2026-10-21',
          starts_at: '09:00',
          ends_at: '12:00',
          place: 'Hall',
          audience: 'grades',
          grades: [0, 11],
        }),
      ),
    ).toBe('ok');
  });

  it('keeps the classes of an audience in its branch, for a class audience only', async () => {
    const forClasses = await insert(north, { audience: 'classes' });
    const forBranch = await insert(north, {});
    const add = (announcementId: string, classId: string) =>
      inBranch(north, (transaction) =>
        transaction
          .insertInto('announcement_classes')
          .values({ announcement_id: announcementId, class_id: classId, branch_id: north })
          .execute(),
      );
    expect(await refusal(() => add(forClasses, northClass))).toBe('ok');
    expect(await refusal(() => add(forClasses, southClass))).toBe(FOREIGN_KEY_VIOLATION);
    expect(await refusal(() => add(forBranch, northClass))).toBe(CHECK_VIOLATION);
  });

  it('deletes nothing and never changes the audience, the readers or the author', async () => {
    const id = await insert(north, {});
    for (const statement of [
      sql`delete from announcements where id = ${id}::uuid`,
      sql`update announcements set audience = 'grades', grades = '{7}' where id = ${id}::uuid`,
      sql`update announcements set for_parents = false where id = ${id}::uuid`,
      sql`update announcements set branch_id = null where id = ${id}::uuid`,
      sql`update announcements set published_at = now() where id = ${id}::uuid`,
      sql`delete from announcement_classes`,
      sql`delete from announcement_deliveries`,
      sql`update announcement_deliveries set account_id = announcement_id`,
    ]) {
      expect(
        await refusal(() => inBranch(north, (transaction) => statement.execute(transaction))),
      ).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });
});
