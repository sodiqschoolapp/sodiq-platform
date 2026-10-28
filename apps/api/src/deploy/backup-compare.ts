/**
 * The restore proof's comparison (task 10.2a): the row counts of production, taken right after
 * the dump, against those of the restored copy (`db/backup/row-counts.sql`, lines
 * `schema.table|count`). The dump has its own snapshot, so a table written at 02:30 (sessions,
 * the job queue, the audit log) may differ by a few rows; that is shown, not failed. The proof
 * fails when a table is missing from the copy, when a table that holds rows came back empty,
 * or when the copy has another set of migrations.
 */

export interface Comparison {
  /** One line per table of production: its name and `match` or `differs`. Never a number. */
  lines: string[];
  /** Why the copy is not a sound backup; empty when it is. */
  failures: string[];
}

function countsOf(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const bar = trimmed.lastIndexOf('|');
    const count = Number(trimmed.slice(bar + 1));
    if (bar <= 0 || !Number.isSafeInteger(count) || count < 0) {
      throw new Error('A line of the counts is not `schema.table|count`.');
    }
    counts.set(trimmed.slice(0, bar), count);
  }
  return counts;
}

export function compareCounts(source: string, restored: string): Comparison {
  const before = countsOf(source);
  const after = countsOf(restored);
  const lines: string[] = [];
  const failures: string[] = [];
  if (before.size === 0) failures.push('production listed no table');
  for (const [table, count] of before) {
    const copy = after.get(table);
    if (copy === undefined) {
      lines.push(`${table} missing`);
      failures.push(`${table} is missing from the copy`);
      continue;
    }
    lines.push(`${table} ${copy === count ? 'match' : 'differs'}`);
    if (table === 'public.schema_migrations' && copy !== count) {
      failures.push('the copy has another set of migrations');
    } else if (count > 0 && copy === 0) {
      failures.push(`${table} came back empty`);
    }
  }
  return { lines, failures };
}
