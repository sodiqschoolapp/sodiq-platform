import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../database/migrate.js';
import {
  BRANCH_SETTING,
  MOMENT_SETTING,
  Transactions,
  type Transaction,
} from '../../database/transactions.js';
import { SystemClock } from '../../clock/system-clock.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { linkRelative } from '../../testing/relatives-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../db/migrations',
);
const SAME_PERSON = '0063_same_person_by_phone.sql';
const UNIQUE_VIOLATION = '23505';

/** A copy of the migrations before 0063, or of those up to 0063 (the runner skips the applied ones). */
async function migrationsUntil(directory: string, last: boolean): Promise<void> {
  for (const name of (await readdir(MIGRATIONS)).filter((one) => one.endsWith('.sql'))) {
    if (last ? name <= SAME_PERSON : name < SAME_PERSON) {
      await copyFile(path.join(MIGRATIONS, name), path.join(directory, name));
    }
  }
}

/** The relative linked to a student by the kit, with a phone of its own. */
async function relativeOf(
  database: TestDatabase,
  student: string,
  phone: string | null,
): Promise<string> {
  const link = await database.migrator
    .selectFrom('student_relatives')
    .select('relative_id')
    .where('student_id', '=', student)
    .executeTakeFirstOrThrow();
  await database.migrator
    .updateTable('relatives')
    .set({ phone })
    .where('id', '=', link.relative_id)
    .execute();
  return link.relative_id;
}

const MOMENT = new Date('2026-10-01T09:00:00+05:00');

/**
 * The relative's only link ends, as an unlink writes it: another relative
 * becomes the student's main contact, and `relatives_follow_links` archives
 * the relative (or, with `mergedInto`, the merge empties it as 2.5b-1 does).
 */
async function unlinkLast(
  database: TestDatabase,
  branch: string,
  student: string,
  relative: string,
  mergedInto?: string,
): Promise<void> {
  await database.migrator.transaction().execute(async (transaction) => {
    await sql`
      select set_config(${BRANCH_SETTING}, ${`{${branch}}`}, true),
        set_config(${MOMENT_SETTING}, ${MOMENT.toISOString()}, true)
    `.execute(transaction);
    await transaction
      .updateTable('student_relatives')
      .set({ main_contact: false, unlinked_at: MOMENT })
      .where('relative_id', '=', relative)
      .execute();
    await linkRelative(transaction, student, branch, MOMENT, { fullName: 'Gulnora Azimova' });
    if (mergedInto !== undefined) {
      await sql`
        update relatives set phone = null, merged_into = ${mergedInto}::uuid where id = ${relative}::uuid
      `.execute(transaction);
    }
  });
}

async function phoneOf(database: TestDatabase, staff: string): Promise<string> {
  const row = await database.migrator
    .selectFrom('staff')
    .select('phone')
    .where('id', '=', staff)
    .executeTakeFirstOrThrow();
  return row.phone ?? '';
}

// Task 3.6b-1 (pull request #119), db/migrations/0063. The mark "same person"
// is read from the phones (decision 3, Look first); staff phones are unique,
// archived and left records included (decision 4, Look first); the migration
// stops on a staff phone held twice and writes an entry for each stored mark
// the phones do not give (Database item 3). All names and phones are invented.
describe('migration 0063 reads the mark "same person" from the phones', () => {
  let database: TestDatabase;
  let directory: string;
  let fixture: {
    agrees: string;
    differs: { relative: string; staff: string };
    missing: { relative: string; staff: string };
    noPhone: string;
    merged: string;
  };

  beforeAll(async () => {
    database = await createTestDatabase({ empty: true });
    directory = await mkdtemp(path.join(tmpdir(), 'sodiq-same-person-'));
    await migrationsUntil(directory, false);
    await migrate({ connectionString: database.migrationUrl, directory });
    const classes = new ClassesKit(database.migrator);
    const members = new MembersKit(database.migrator, await classes.account());
    const north = await insertBranch(database.migrator, 'North');
    const marked = async (relative: string, staff: string) =>
      sql`update relatives set staff_id = ${staff}::uuid where id = ${relative}::uuid`.execute(
        database.migrator,
      );
    // As 2.5b-2 wrote them: a hand mark on equal phones, one on differing
    // phones, equal phones with no mark, a relative with no phone of its own,
    // and a merged record (no phone, its mark emptied).
    const first = (await classes.person(north, ['uz'])).staffId;
    const agrees = await relativeOf(
      database,
      await members.student(north),
      await phoneOf(database, first),
    );
    await marked(agrees, first);
    const second = (await classes.person(north, ['uz'])).staffId;
    const differs = await relativeOf(database, await members.student(north), '+998977770001');
    await marked(differs, second);
    const third = (await classes.person(north, ['uz'])).staffId;
    const missing = await relativeOf(
      database,
      await members.student(north),
      await phoneOf(database, third),
    );
    const noPhone = await relativeOf(database, await members.student(north), null);
    const mergedStudent = await members.student(north);
    const merged = await relativeOf(database, mergedStudent, '+998977770002');
    await unlinkLast(database, north, mergedStudent, merged, agrees);
    fixture = {
      agrees,
      differs: { relative: differs, staff: second },
      missing: { relative: missing, staff: third },
      noPhone,
      merged,
    };
    const after = await mkdtemp(path.join(tmpdir(), 'sodiq-same-person-0063-'));
    await migrationsUntil(after, true);
    await migrate({ connectionString: database.migrationUrl, directory: after });
    await rm(after, { recursive: true, force: true });
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
    await database.destroy();
  });

  const entriesOf = (relative: string) =>
    database.migrator
      .selectFrom('audit_log_school')
      .select(['action', 'actor_id', 'record_type', 'old_value', 'new_value', 'details'])
      .where('record_id', '=', relative)
      .where('action', 'like', 'relative.same_person%')
      .execute();

  it('writes one entry for a hand mark on differing phones, as its removal', async () => {
    expect(await entriesOf(fixture.differs.relative)).toEqual([
      {
        action: 'relative.same_person_removed',
        actor_id: null,
        record_type: 'relative',
        old_value: { staffId: fixture.differs.staff },
        new_value: { staffId: null },
        details: { staffId: fixture.differs.staff, cause: 'migration' },
      },
    ]);
  });

  it('writes one entry for a mark the phones give and the record did not hold', async () => {
    expect(await entriesOf(fixture.missing.relative)).toEqual([
      {
        action: 'relative.same_person',
        actor_id: null,
        record_type: 'relative',
        old_value: { staffId: null },
        new_value: { staffId: fixture.missing.staff },
        details: { staffId: fixture.missing.staff, cause: 'migration' },
      },
    ]);
  });

  it('writes nothing for a mark that agrees, a relative with no phone, and a merged record', async () => {
    for (const relative of [fixture.agrees, fixture.noPhone, fixture.merged]) {
      expect(await entriesOf(relative)).toEqual([]);
    }
  });

  it('drops the stored mark, its index and its trigger', async () => {
    const column = await sql<{ name: string }>`
      select column_name as name from information_schema.columns
      where table_name = 'relatives' and column_name = 'staff_id'
    `.execute(database.migrator);
    expect(column.rows).toEqual([]);
    const objects = await sql<{ name: string }>`
      select indexname as name from pg_indexes where indexname = 'relatives_staff_idx'
      union all
      select tgname from pg_trigger where tgname = 'relatives_same_person_check'
    `.execute(database.migrator);
    expect(objects.rows).toEqual([]);
  });

  it('answers the marks the phones give', async () => {
    const found = await sql<{ relative_id: string; staff_id: string }>`
      select relative_id, staff_id from same_person_staff(${[
        fixture.agrees,
        fixture.differs.relative,
        fixture.missing.relative,
        fixture.noPhone,
        fixture.merged,
      ]}::uuid[])
    `.execute(database.migrator);
    expect(found.rows).toHaveLength(2);
    expect(found.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relative_id: fixture.agrees }),
        { relative_id: fixture.missing.relative, staff_id: fixture.missing.staff },
      ]),
    );
  });
});

describe('migration 0063 stops on a staff phone held twice', () => {
  let database: TestDatabase;
  let directory: string;

  beforeAll(async () => {
    database = await createTestDatabase({ empty: true });
    directory = await mkdtemp(path.join(tmpdir(), 'sodiq-same-person-twice-'));
    await migrationsUntil(directory, false);
    await migrate({ connectionString: database.migrationUrl, directory });
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
    await database.destroy();
  });

  it('raises with both ids and changes nothing (decision 4)', async () => {
    const classes = new ClassesKit(database.migrator);
    const north = await insertBranch(database.migrator, 'North');
    const first = (await classes.person(north, ['uz'])).staffId;
    const second = (await classes.person(north, ['uz'])).staffId;
    await database.migrator
      .updateTable('staff')
      .set({ phone: await phoneOf(database, first) })
      .where('id', '=', second)
      .execute();
    const after = await mkdtemp(path.join(tmpdir(), 'sodiq-same-person-twice-0063-'));
    await migrationsUntil(after, true);
    const failure = migrate({ connectionString: database.migrationUrl, directory: after });
    await expect(failure).rejects.toThrow(/Two staff records share a phone/);
    const [low, high] = [first, second].sort();
    await expect(failure).rejects.toThrow(new RegExp(`${low ?? ''}, ${high ?? ''}`));
    await rm(after, { recursive: true, force: true });
    // Nothing of 0063 stayed: the stored mark is still there.
    const column = await sql<{ name: string }>`
      select column_name as name from information_schema.columns
      where table_name = 'relatives' and column_name = 'staff_id'
    `.execute(database.migrator);
    expect(column.rows).toHaveLength(1);
  });
});

describe('the mark "same person" and staff phones in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let classes: ClassesKit;
  let members: MembersKit;
  let north: string;
  let south: string;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new SystemClock());
    classes = new ClassesKit(database.migrator);
    members = new MembersKit(database.migrator, await classes.account());
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('staff_phone_idx (decision 4, Look first)', () => {
    it('refuses a second staff record with a phone, a person who left included', async () => {
      const held = (await classes.person(north, ['uz'])).staffId;
      const taken = await phoneOf(database, held);
      const other = (await classes.person(south, ['uz'])).staffId;
      await expect(
        database.migrator
          .updateTable('staff')
          .set({ phone: taken })
          .where('id', '=', other)
          .execute(),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'staff_phone_idx' });
      // The holder leaves: its phone stays its own.
      await database.migrator
        .updateTable('staff_statuses')
        .set({ valid_until: '2026-09-10' })
        .where('staff_id', '=', held)
        .execute();
      await database.migrator
        .insertInto('staff_statuses')
        .values({ staff_id: held, status: 'left', valid_from: '2026-09-10' })
        .execute();
      await expect(
        inBranch(south, (transaction) =>
          transaction.updateTable('staff').set({ phone: taken }).where('id', '=', other).execute(),
        ),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'staff_phone_idx' });
      expect(await phoneOf(database, other)).not.toBe(taken);
    });
  });

  describe('same_person_staff and same_person_relative (decision 3, Look first)', () => {
    const staffOf = (branch: string, relatives: string[]) =>
      inBranch(
        branch,
        async (transaction) =>
          (
            await sql<{ relative_id: string; staff_id: string }>`
            select relative_id, staff_id from same_person_staff(${relatives}::uuid[])
          `.execute(transaction)
          ).rows,
      );
    const relativesOf = (branch: string, staff: string[]) =>
      inBranch(
        branch,
        async (transaction) =>
          (
            await sql<{ staff_id: string; relative_id: string }>`
            select staff_id, relative_id from same_person_relative(${staff}::uuid[])
          `.execute(transaction)
          ).rows,
      );

    it('answer a relative linked only in another branch and an archived one, to a transaction of one branch', async () => {
      const teacher = (await classes.person(north, ['uz'])).staffId;
      const student = await members.student(south);
      const parent = await relativeOf(database, student, await phoneOf(database, teacher));
      expect(await staffOf(north, [parent])).toEqual([{ relative_id: parent, staff_id: teacher }]);
      expect(await relativesOf(north, [teacher])).toEqual([
        { staff_id: teacher, relative_id: parent },
      ]);
      // Archived: no live link anywhere.
      await unlinkLast(database, south, student, parent);
      const archived = await database.migrator
        .selectFrom('relatives')
        .select('archived_at')
        .where('id', '=', parent)
        .executeTakeFirstOrThrow();
      expect(archived.archived_at).not.toBeNull();
      expect(await staffOf(north, [parent])).toEqual([{ relative_id: parent, staff_id: teacher }]);
      expect(await relativesOf(south, [teacher])).toEqual([
        { staff_id: teacher, relative_id: parent },
      ]);
    });

    it('answer nothing for a relative with no phone, another phone, or a staff record not named', async () => {
      const teacher = (await classes.person(north, ['uz'])).staffId;
      const noPhone = await relativeOf(database, await members.student(north), null);
      const other = await relativeOf(database, await members.student(north), '+998977771234');
      expect(await staffOf(north, [noPhone, other])).toEqual([]);
      expect(await relativesOf(north, [teacher])).toEqual([]);
      expect(await relativesOf(north, [])).toEqual([]);
    });
  });
});
