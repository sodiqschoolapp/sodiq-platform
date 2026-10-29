/**
 * The restore proof's comparison (task 10.2a): the row counts of production, taken right after
 * the dump, against those of the restored copy (`db/backup/row-counts.sql`, lines
 * `schema.table|count`). The dump has its own snapshot, so a table written at 02:30 (sessions,
 * the job queue, the audit log) may differ by a few rows; that is shown, not failed. The proof
 * fails when a table is missing from the copy, when a table that holds rows came back empty,
 * or when the copy has another set of migrations. It also fails when production was read through a
 * connection that can write: the line `~read-only|1` (`pg_is_in_recovery()`, task 10.2b) says
 * the export read Neon's read-only compute, so the dump is never stored otherwise.
 */

/** The line of `row-counts.sql` that is no table: whether the connection was read-only. */
export const READ_ONLY_LINE = '~read-only';

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
  const readOnly = before.get(READ_ONLY_LINE) === 1;
  before.delete(READ_ONLY_LINE);
  // The copy is a primary of the job's own: never in recovery, and not compared.
  after.delete(READ_ONLY_LINE);
  const lines: string[] = [`read-only: ${readOnly ? 'yes' : 'no'}`];
  const failures: string[] = readOnly
    ? []
    : ['production was read through a connection that can write (not the read-only compute)'];
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
