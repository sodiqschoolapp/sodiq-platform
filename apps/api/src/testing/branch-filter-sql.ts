import { sql } from 'kysely';
import type { Database } from '../database/database.js';

/**
 * Gives a scratch table of a test the branch filter, with exactly the
 * statements that db/migrations/0002 prescribes for every branch table.
 * Run it as the migrator.
 */
export async function addBranchFilter(migrator: Database, table: string): Promise<void> {
  await sql`alter table ${sql.table(table)} enable row level security`.execute(migrator);
  await sql`
    create policy branch_filter on ${sql.table(table)} for all to sodiq_app
      using (branch_id = any ((select app_branch_ids())::uuid[]))
      with check (branch_id = any ((select app_branch_ids())::uuid[]))
  `.execute(migrator);
}

/**
 * A branch with an invented name, written by the migrator, with its settings
 * row, as the branch create writes it (task 1.6, decision 8). Returns its id.
 *
 * Task 8.4: its lessons stay open for entry (`LONG_EDIT_DAYS`), so that a test
 * of something else may enter on a lesson weeks before its clock; a test of
 * the edit period sets the days it needs with `setEditDays`.
 */
export async function insertBranch(migrator: Database, name: string): Promise<string> {
  const row = await migrator
    .insertInto('branches')
    .values({ name })
    .returning('id')
    .executeTakeFirstOrThrow();
  await migrator.insertInto('branch_settings').values({ branch_id: row.id }).execute();
  // A test of an earlier migration builds the schema before 0122.
  const logged = await sql<{ found: boolean }>`
    select to_regclass('public.branch_edit_days') is not null as found
  `.execute(migrator);
  if (logged.rows[0]?.found === true) await setEditDays(migrator, row.id, LONG_EDIT_DAYS);
  return row.id;
}

/** The edit days a test branch starts with: every lesson of a test stays open. */
export const LONG_EDIT_DAYS = 3650;

/**
 * Sets the edit days a branch started with (the first row of
 * `branch_edit_days`, 0122), as the migrator: the lock of every lesson of the
 * branch follows it, unless a later change of the setting is logged.
 */
export async function setEditDays(
  migrator: Database,
  branchId: string,
  days: number,
): Promise<void> {
  await migrator
    .updateTable('branch_edit_days')
    .set({ edit_days: days })
    .where('branch_id', '=', branchId)
    .where('changed_on', '=', sql<string>`'-infinity'::date`)
    .execute();
}
