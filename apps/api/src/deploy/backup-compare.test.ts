import { readFileSync } from 'node:fs';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../testing/test-database.js';
import { compareCounts } from './backup-compare.js';

// Task 10.2a, pull request #256: the restore proof of the daily export.
describe('the comparison of the restored copy', () => {
  const source = [
    '~read-only|1',
    'pgboss.job|12',
    'public.lessons|300',
    'public.schema_migrations|139',
    'public.sessions|5',
  ].join('\n');

  it('prints names and match or differs only, and accepts a few rows written during the dump', () => {
    const restored = [
      'pgboss.job|11',
      'public.lessons|300',
      'public.schema_migrations|139',
      'public.sessions|5',
    ].join('\n');
    expect(compareCounts(source, restored)).toEqual({
      lines: [
        'read-only: yes',
        'pgboss.job differs',
        'public.lessons match',
        'public.schema_migrations match',
        'public.sessions match',
      ],
      failures: [],
    });
  });

  it('fails on a missing table, a table that came back empty and other migrations', () => {
    const restored = ['pgboss.job|12', 'public.lessons|0', 'public.schema_migrations|138'].join(
      '\n',
    );
    const result = compareCounts(source, restored);
    expect(result.failures).toEqual([
      'public.lessons came back empty',
      'the copy has another set of migrations',
      'public.sessions is missing from the copy',
    ]);
    expect(result.lines.join('\n')).not.toMatch(/\d{2,}/);
  });

  it('fails on nothing to compare, and refuses a line it cannot read', () => {
    expect(compareCounts('~read-only|1', '').failures).toEqual(['production listed no table']);
    expect(() => compareCounts('public.lessons|many', '')).toThrow('schema.table|count');
  });

  // Task 10.2b (plan review of #261, corrections 1 and 2): the export reads production only
  // through Neon's read-only compute; `pg_is_in_recovery()` answers it, never a session setting.
  it('fails a dump read where it could write, and never stores it', () => {
    const restored = source.replace('~read-only|1', '~read-only|0');
    const writable = compareCounts(source.replace('~read-only|1', '~read-only|0'), restored);
    expect(writable.lines[0]).toBe('read-only: no');
    expect(writable.failures).toEqual([
      'production was read through a connection that can write (not the read-only compute)',
    ]);
    // A file without the line (the counts of 10.2a) is no proof either.
    expect(compareCounts(source.replace('~read-only|1\n', ''), restored).failures).toHaveLength(1);
    // The copy's own 0 is not compared with production's 1.
    expect(compareCounts(source, restored)).toMatchObject({ failures: [] });
  });

  it('reads a writable primary as not read-only, through the line of row-counts.sql', async () => {
    const file = readFileSync(
      new URL('../../../../db/backup/row-counts.sql', import.meta.url),
      'utf8',
    );
    const statement = file.slice(file.lastIndexOf('select ')).trim().replace(/;$/, '');
    expect(statement).toContain('pg_is_in_recovery()');
    const database = await createTestDatabase();
    try {
      const found = await sql<{ line: string }>`${sql.raw(statement)} as line`.execute(
        database.migrator,
      );
      const line = found.rows[0]?.line ?? '';
      expect(line).toBe('~read-only|0');
      expect(compareCounts(source.replace('~read-only|1', line), source).failures).toEqual([
        'production was read through a connection that can write (not the read-only compute)',
      ]);
    } finally {
      await database.destroy();
    }
  });
});
