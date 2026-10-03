import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const EXCLUSION_VIOLATION = '23P01';

// What db/migrations/0001_foundations.sql must guarantee, checked on a database
// built from the real migrations.
describe('database foundations', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
    await sql`
      create table scratch_lessons (
        teacher_id integer not null,
        during tstzrange not null,
        exclude using gist (teacher_id with =, during with &&)
      )
    `.execute(database.migrator);
    await sql`create table scratch_granted (id integer primary key)`.execute(database.migrator);
    await sql`grant select, insert on scratch_granted to sodiq_app`.execute(database.migrator);
    await sql`create table scratch_not_granted (id integer primary key)`.execute(database.migrator);
  });

  afterAll(async () => {
    await database.destroy();
  });

  // docs/spec/edge-cases/developer-rules.md, "Teacher in one place" and "Lesson times":
  // the exclusion constraints need btree_gist, and ranges are half-open.
  describe('extension btree_gist', () => {
    function lesson(teacher: number, start: string, end: string) {
      return sql`
        insert into scratch_lessons (teacher_id, during)
        values (${teacher}, tstzrange(${start}::timestamptz, ${end}::timestamptz, '[)'))
      `.execute(database.migrator);
    }

    it('accepts a lesson that starts when the previous one ends', async () => {
      await lesson(1, '2026-10-05 09:00+05', '2026-10-05 09:45+05');

      await expect(lesson(1, '2026-10-05 09:45+05', '2026-10-05 10:30+05')).resolves.toBeDefined();
    });

    it('refuses an overlapping lesson of the same teacher', async () => {
      await expect(lesson(1, '2026-10-05 09:30+05', '2026-10-05 10:00+05')).rejects.toMatchObject({
        code: EXCLUSION_VIOLATION,
      });
    });

    it('accepts the same time for another teacher', async () => {
      await expect(lesson(2, '2026-10-05 09:30+05', '2026-10-05 10:00+05')).resolves.toBeDefined();
    });
  });

  // docs/spec/edge-cases/developer-rules.md, "History and audit": append-only tables
  // rest on an application user that owns nothing and has only the rights it was given.
  describe('application user', () => {
    it('is not the migration user', async () => {
      const app = await sql<{ name: string }>`select current_user as name`.execute(database.app);
      const migrator = await sql<{ name: string }>`select current_user as name`.execute(
        database.migrator,
      );

      expect(app.rows[0]?.name).toBe('sodiq_app');
      expect(migrator.rows[0]?.name).toBe('sodiq_migrator');
    });

    it('cannot create a table', async () => {
      await expect(
        sql`create table scratch_by_app (id integer)`.execute(database.app),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('cannot alter or drop a table, even one it may write to', async () => {
      await expect(
        sql`alter table scratch_granted add column note text`.execute(database.app),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await expect(sql`drop table scratch_granted`.execute(database.app)).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
    });

    it('can read the list of applied migrations but not change it', async () => {
      const rows = await database.app.selectFrom('schema_migrations').select('name').execute();
      expect(rows.map((row) => row.name)).toContain('0001_foundations');

      await expect(database.app.deleteFrom('schema_migrations').execute()).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
      await expect(
        database.app
          .insertInto('schema_migrations')
          .values({ number: 9999, name: '9999_by_app', checksum: 'none' })
          .execute(),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await expect(
        database.app.updateTable('schema_migrations').set({ checksum: 'none' }).execute(),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('has no rights on a table until a migration grants them', async () => {
      await expect(
        sql`select * from scratch_not_granted`.execute(database.app),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await expect(
        sql`insert into scratch_not_granted (id) values (1)`.execute(database.app),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('has exactly the rights that were granted', async () => {
      await sql`insert into scratch_granted (id) values (1)`.execute(database.app);
      const read = await sql<{ id: number }>`select id from scratch_granted`.execute(database.app);
      expect(read.rows).toEqual([{ id: 1 }]);

      // Only select and insert were granted.
      await expect(
        sql`update scratch_granted set id = 2`.execute(database.app),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await expect(sql`delete from scratch_granted`.execute(database.app)).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
    });
  });
});
