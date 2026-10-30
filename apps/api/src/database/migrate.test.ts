import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { checksumOf, migrate, MigrationError } from './migrate.js';

// docs/build-plan.md, task 0.2: a migration runner for numbered SQL files.
// CLAUDE.md, Conventions: a migration is a new numbered file, never edited after merge.
describe('migration runner', () => {
  let database: TestDatabase;
  let directory: string;

  beforeEach(async () => {
    database = await createTestDatabase({ empty: true });
    directory = await mkdtemp(path.join(tmpdir(), 'sodiq-migrations-'));
  });

  afterEach(async () => {
    await database.destroy();
    await rm(directory, { recursive: true });
  });

  function file(name: string, content: string): Promise<void> {
    return writeFile(path.join(directory, name), content);
  }

  function run(): Promise<string[]> {
    return migrate({ connectionString: database.migrationUrl, directory });
  }

  async function appliedNames(): Promise<string[]> {
    const rows = await database.migrator
      .selectFrom('schema_migrations')
      .select('name')
      .orderBy('number')
      .execute();
    return rows.map((row) => row.name);
  }

  async function tableExists(name: string): Promise<boolean> {
    const found = await sql<{ exists: boolean }>`
      select to_regclass(${name}) is not null as exists
    `.execute(database.migrator);
    return found.rows[0]?.exists === true;
  }

  it('applies the files in number order and records each one', async () => {
    // The second file only works if the first ran before it.
    await file('0002_add_column.sql', 'alter table scratch_one add column note text;');
    await file('0001_create_table.sql', 'create table scratch_one (id integer primary key);');

    const applied = await run();

    expect(applied).toEqual(['0001_create_table', '0002_add_column']);
    expect(await appliedNames()).toEqual(['0001_create_table', '0002_add_column']);
  });

  it('applies nothing on a second run, and only the new file after one is added', async () => {
    await file('0001_create_table.sql', 'create table scratch_one (id integer primary key);');
    await run();

    expect(await run()).toEqual([]);

    await file('0002_second_table.sql', 'create table scratch_two (id integer primary key);');
    expect(await run()).toEqual(['0002_second_table']);
    expect(await appliedNames()).toEqual(['0001_create_table', '0002_second_table']);
  });

  it('refuses to run when an applied file was edited', async () => {
    await file('0001_create_table.sql', 'create table scratch_one (id integer primary key);');
    await run();
    await file('0001_create_table.sql', 'create table scratch_one (id bigint primary key);');
    await file('0002_second_table.sql', 'create table scratch_two (id integer primary key);');

    await expect(run()).rejects.toThrow(MigrationError);
    await expect(run()).rejects.toThrow(/0001_create_table was changed after it was applied/);
    expect(await tableExists('scratch_two')).toBe(false);
  });

  it('does not treat a change of line endings as an edit', async () => {
    const lf = 'create table scratch_one (\n  id integer primary key\n);\n';
    const crlf = lf.replaceAll('\n', '\r\n');
    expect(checksumOf(crlf)).toBe(checksumOf(lf));

    await file('0001_create_table.sql', lf);
    await run();
    await file('0001_create_table.sql', crlf);

    expect(await run()).toEqual([]);
  });

  it('still sees a real edit in a file with Windows line endings', () => {
    expect(checksumOf('select 1;\r\nselect 2;\r\n')).not.toBe(checksumOf('select 1;\nselect 3;\n'));
  });

  it('refuses to run when an applied file was renamed', async () => {
    await file('0001_create_table.sql', 'create table scratch_one (id integer primary key);');
    await run();
    await unlink(path.join(directory, '0001_create_table.sql'));
    await file('0001_other_name.sql', 'create table scratch_one (id integer primary key);');

    await expect(run()).rejects.toThrow(/0001_create_table was changed after it was applied/);
  });

  it('refuses to run when the file of an applied migration is gone', async () => {
    await file('0001_create_table.sql', 'create table scratch_one (id integer primary key);');
    await run();
    await unlink(path.join(directory, '0001_create_table.sql'));

    await expect(run()).rejects.toThrow(/0001_create_table is applied.*file is missing/);
  });

  it('refuses two files with the same number', async () => {
    await file('0001_create_table.sql', 'create table scratch_one (id integer primary key);');
    await file('0001_second_table.sql', 'create table scratch_two (id integer primary key);');

    await expect(run()).rejects.toThrow(/Two migrations have the number 1/);
    expect(await tableExists('scratch_one')).toBe(false);
  });

  it.each(['1_short.sql', '0001-dashes.sql', '0001_Capital.sql', 'notes.txt', '0001_.sql'])(
    'refuses the badly named file %s',
    async (name) => {
      await file(name, 'select 1;');

      await expect(run()).rejects.toThrow(/is not named like 0001_short_name\.sql/);
    },
  );

  it.each([
    'begin;\ncreate table scratch_one (id integer primary key);\ncommit;',
    'create table scratch_one (id integer primary key);\n  COMMIT ;\nselect * from no_such_table;',
    'create table scratch_one (id integer primary key);\nrollback;',
    'start transaction;\ncreate table scratch_one (id integer primary key);',
  ])('refuses a file with its own transaction control (%#)', async (content) => {
    // Its own commit would end the runner's transaction and could leave the file half-applied.
    await file('0001_own_transaction.sql', content);

    await expect(run()).rejects.toThrow(/contains begin, commit or rollback/);
    expect(await tableExists('scratch_one')).toBe(false);
  });

  it('accepts a function body, whose begin and end are not transaction control', async () => {
    await file(
      '0001_function.sql',
      [
        'create function scratch_one() returns integer language plpgsql as $$',
        'begin',
        '  return 1;',
        'end;',
        '$$;',
        '-- commit; in a comment is not a statement',
      ].join('\n'),
    );

    expect(await run()).toEqual(['0001_function']);
  });

  it('refuses a new file numbered below the last applied one', async () => {
    await file('0002_create_table.sql', 'create table scratch_one (id integer primary key);');
    await run();
    await file('0001_too_late.sql', 'create table scratch_two (id integer primary key);');

    await expect(run()).rejects.toThrow(/0001_too_late has a lower number/);
    expect(await tableExists('scratch_two')).toBe(false);
  });

  it('rolls back a file that fails half-way and keeps the files before it', async () => {
    await file('0001_create_table.sql', 'create table scratch_one (id integer primary key);');
    await file(
      '0002_fails.sql',
      'create table scratch_two (id integer primary key); select * from no_such_table;',
    );
    await file('0003_never_reached.sql', 'create table scratch_three (id integer primary key);');

    await expect(run()).rejects.toThrow(/0002_fails failed and was rolled back.*no_such_table/);

    expect(await appliedNames()).toEqual(['0001_create_table']);
    expect(await tableExists('scratch_one')).toBe(true);
    expect(await tableExists('scratch_two')).toBe(false);
    expect(await tableExists('scratch_three')).toBe(false);
  });

  it('applies each file exactly once when two runners start together', async () => {
    // Applied twice, either file would fail with "already exists".
    await file('0001_create_table.sql', 'create table scratch_one (id integer primary key);');
    await file('0002_second_table.sql', 'create table scratch_two (id integer primary key);');

    const results = await Promise.all([run(), run()]);

    expect(results.flat().sort()).toEqual(['0001_create_table', '0002_second_table']);
    expect(await appliedNames()).toEqual(['0001_create_table', '0002_second_table']);
  });

  // Task 10.1b, decision 4 and correction 4 of the plan review: indexes on large tables are built
  // without a long lock (`edge/system-behaviour`: "tables are never locked for long").
  describe('an index-only file, run outside a transaction', () => {
    const PARTITIONED = `
      create table scratch_history (id integer not null, lesson integer not null, at date not null)
        partition by range (at);
      create table scratch_history_a partition of scratch_history
        for values from ('2026-01-01') to ('2026-07-01');
      create table scratch_history_b partition of scratch_history default;
      insert into scratch_history values (1, 10, '2026-02-01'), (2, 20, '2026-09-01');
      create table scratch_plain (id integer primary key, lesson integer not null);
    `;

    async function indexes(): Promise<{ name: string; valid: boolean; parent: string | null }[]> {
      const found = await sql<{ name: string; valid: boolean; parent: string | null }>`
        select c.relname as name, x.indisvalid as valid, p.relname as parent
        from pg_index x
        join pg_class c on c.oid = x.indexrelid
        left join pg_inherits i on i.inhrelid = x.indexrelid
        left join pg_class p on p.oid = i.inhparent
        where c.relname like '%lesson_idx'
        order by c.relname
      `.execute(database.migrator);
      return found.rows;
    }

    it('builds the index of a plain table, and of each partition attached to the parent', async () => {
      await file('0001_tables.sql', PARTITIONED);
      await file(
        '0002_indexes.sql',
        [
          '-- migrate: no transaction',
          '-- The lessons of the history.',
          'create index concurrently if not exists scratch_history_lesson_idx on scratch_history (lesson);',
          'create index concurrently if not exists scratch_plain_lesson_idx on scratch_plain (lesson);',
        ].join('\n'),
      );

      expect(await run()).toEqual(['0001_tables', '0002_indexes']);

      expect(await appliedNames()).toEqual(['0001_tables', '0002_indexes']);
      expect(await indexes()).toEqual([
        { name: 'scratch_history_a_lesson_idx', valid: true, parent: 'scratch_history_lesson_idx' },
        { name: 'scratch_history_b_lesson_idx', valid: true, parent: 'scratch_history_lesson_idx' },
        { name: 'scratch_history_lesson_idx', valid: true, parent: null },
        { name: 'scratch_plain_lesson_idx', valid: true, parent: null },
      ]);
      expect(await run()).toEqual([]);
    });

    it('refuses any other statement in such a file before anything runs', async () => {
      await file('0001_tables.sql', PARTITIONED);
      await file(
        '0002_indexes.sql',
        [
          '-- migrate: no transaction',
          'create index concurrently if not exists scratch_plain_lesson_idx on scratch_plain (lesson);',
          'drop table scratch_plain;',
        ].join('\n'),
      );

      await expect(run()).rejects.toThrow(
        /"0002_indexes.sql" runs outside a transaction and may hold only.*drop table scratch_plain/,
      );
      expect(await tableExists('scratch_plain')).toBe(false);
      expect(await tableExists('schema_migrations')).toBe(false);
    });

    it('drops an index a failed build left invalid and builds it again', async () => {
      await file('0001_tables.sql', PARTITIONED);
      await run();
      // A failed concurrent build leaves its index behind, invalid (duplicates under a unique one).
      await sql`insert into scratch_plain values (1, 5), (2, 5)`.execute(database.migrator);
      await expect(
        sql`create unique index concurrently scratch_plain_lesson_idx on scratch_plain (lesson)`.execute(
          database.migrator,
        ),
      ).rejects.toThrow(/could not create unique index/);
      expect(await indexes()).toEqual([
        { name: 'scratch_plain_lesson_idx', valid: false, parent: null },
      ]);
      await file(
        '0002_indexes.sql',
        [
          '-- migrate: no transaction',
          'create index concurrently if not exists scratch_plain_lesson_idx on scratch_plain (lesson);',
        ].join('\n'),
      );

      expect(await run()).toEqual(['0002_indexes']);

      expect(await indexes()).toEqual([
        { name: 'scratch_plain_lesson_idx', valid: true, parent: null },
      ]);
    });

    it('keeps what a stopped run built and finishes the file on the next run', async () => {
      await file('0001_tables.sql', PARTITIONED);
      await file(
        '0002_indexes.sql',
        [
          '-- migrate: no transaction',
          'create index concurrently if not exists scratch_plain_lesson_idx on scratch_plain (lesson);',
          'create index concurrently if not exists scratch_late_lesson_idx on scratch_late (lesson);',
        ].join('\n'),
      );

      await expect(run()).rejects.toThrow(
        /Migration 0002_indexes stopped: .*scratch_late.* the next run finishes the file/,
      );
      expect(await appliedNames()).toEqual(['0001_tables']);
      expect((await indexes()).map((one) => one.name)).toEqual(['scratch_plain_lesson_idx']);

      await sql`create table scratch_late (lesson integer)`.execute(database.migrator);
      expect(await run()).toEqual(['0002_indexes']);
      expect(await appliedNames()).toEqual(['0001_tables', '0002_indexes']);
      expect((await indexes()).map((one) => one.name)).toEqual([
        'scratch_late_lesson_idx',
        'scratch_plain_lesson_idx',
      ]);
    });
  });
});
