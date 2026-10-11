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
 */
export async function insertBranch(migrator: Database, name: string): Promise<string> {
  const row = await migrator
    .insertInto('branches')
    .values({ name })
    .returning('id')
    .executeTakeFirstOrThrow();
  await migrator.insertInto('branch_settings').values({ branch_id: row.id }).execute();
  return row.id;
}
