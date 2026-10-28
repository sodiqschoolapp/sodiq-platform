import { describe, expect, it } from 'vitest';
import { compareCounts } from './backup-compare.js';

// Task 10.2a, pull request #256: the restore proof of the daily export.
describe('the comparison of the restored copy', () => {
  const source = [
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
    expect(compareCounts('', '').failures).toEqual(['production listed no table']);
    expect(() => compareCounts('public.lessons|many', '')).toThrow('schema.table|count');
  });
});
