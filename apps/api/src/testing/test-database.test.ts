import { sql, type Generated } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../database/database.js';
import { DATABASE } from '../database/database.module.js';
import { createTestApp } from './create-test-app.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

// No product table exists yet, so the sample table lives only in the test
// databases. It is not a migration: a merged migration could never be removed.
// A type, not an interface: Kysely's `withTables` needs an index signature.
type ScratchTables = {
  scratch_notes: {
    id: Generated<number>;
    body: string;
    school_date: string;
    written_at: Date;
  };
};

async function createScratchNotes(database: TestDatabase): Promise<void> {
  await sql`
    create table scratch_notes (
      id integer generated always as identity primary key,
      body text not null,
      school_date date not null,
      written_at timestamptz not null
    )
  `.execute(database.migrator);
  await sql`grant select, insert on scratch_notes to sodiq_app`.execute(database.migrator);
}

// docs/build-plan.md, task 0.2: a test helper that gives each test file a clean
// database; a sample test writes and reads a row.
describe('test database', () => {
  let first: TestDatabase;
  let second: TestDatabase;

  beforeAll(async () => {
    first = await createTestDatabase();
    second = await createTestDatabase();
    await createScratchNotes(first);
    await createScratchNotes(second);
  });

  afterAll(async () => {
    await first.destroy();
    await second.destroy();
  });

  it('writes a row and reads it back as the application user', async () => {
    const notes = first.app.withTables<ScratchTables>();
    const writtenAt = new Date('2026-10-05T04:00:00.000Z');

    const inserted = await notes
      .insertInto('scratch_notes')
      .values({ body: 'first note', school_date: '2026-10-05', written_at: writtenAt })
      .returning('id')
      .executeTakeFirstOrThrow();
    const read = await notes
      .selectFrom('scratch_notes')
      .selectAll()
      .where('id', '=', inserted.id)
      .executeTakeFirstOrThrow();

    expect(read.body).toBe('first note');
    // A school date comes back as the text that was stored, on any machine.
    expect(read.school_date).toBe('2026-10-05');
    // A moment comes back as the same instant.
    expect(read.written_at).toEqual(writtenAt);
  });

  it('keeps a school date at the edge of a year unchanged', async () => {
    const notes = first.app.withTables<ScratchTables>();

    const inserted = await notes
      .insertInto('scratch_notes')
      .values({ body: 'new year', school_date: '2027-01-01', written_at: new Date(0) })
      .returning('school_date')
      .executeTakeFirstOrThrow();

    expect(inserted.school_date).toBe('2027-01-01');
  });

  it('keeps the dates of an array as text, with empty and missing ones', async () => {
    const read = await sql<{ days: (string | null)[]; none: string[] }>`
      select array['2026-10-05', null, '2027-01-01']::date[] as days, '{}'::date[] as none
    `.execute(first.app);

    expect(read.rows[0]).toEqual({ days: ['2026-10-05', null, '2027-01-01'], none: [] });
  });

  it('starts with every migration applied and no other rows', async () => {
    const migrations = await second.app.selectFrom('schema_migrations').select('name').execute();
    const notes = await second.app
      .withTables<ScratchTables>()
      .selectFrom('scratch_notes')
      .selectAll()
      .execute();

    expect(migrations.map((row) => row.name)).toContain('0001_foundations');
    expect(notes).toEqual([]);
  });

  it('does not share rows with another test database', async () => {
    await first.app
      .withTables<ScratchTables>()
      .insertInto('scratch_notes')
      .values({ body: 'only in the first', school_date: '2026-10-06', written_at: new Date(0) })
      .execute();

    const inSecond = await second.app
      .withTables<ScratchTables>()
      .selectFrom('scratch_notes')
      .select('body')
      .execute();

    expect(first.name).not.toBe(second.name);
    expect(inSecond).toEqual([]);
  });
});

// Route tests must never reach the developer database `sodiq_dev`.
describe('test application and the database', () => {
  let database: TestDatabase;

  // Made and dropped in hooks, which have the time for it (60 s), not inside the test (30 s).
  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('uses the test database it is given', async () => {
    const app = await createTestApp({ database: database.app });
    try {
      const rows = await app
        .get<Database>(DATABASE)
        .selectFrom('schema_migrations')
        .select('name')
        .execute();

      expect(app.get<Database>(DATABASE)).toBe(database.app);
      expect(rows.map((row) => row.name)).toContain('0001_foundations');
    } finally {
      // Closing the application closes the connection it was given.
      await app.close();
    }
  });

  it('has no usable database when none is given', async () => {
    const app = await createTestApp();
    try {
      await expect(
        app.get<Database>(DATABASE).selectFrom('schema_migrations').selectAll().execute(),
      ).rejects.toThrow(/sodiq_test_database_not_passed/);
    } finally {
      await app.close();
    }
  });
});
