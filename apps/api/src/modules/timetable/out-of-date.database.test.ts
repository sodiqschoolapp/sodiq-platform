import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../database/migrate.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LoadKit } from '../../testing/load-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
const INSUFFICIENT_PRIVILEGE = '42501';
const FOREIGN_KEY_VIOLATION = '23503';

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../db/migrations',
);
const CAUSES = '0077_out_of_date_causes.sql';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
const STARTS_ON = '2026-10-19';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// What the database keeps of the mark "out of date" (db/migrations/0077; task
// 5.5a-3b-1, pull request #146, decisions 6 and 7): a draft is out of date
// while it has a cause; a cause names the audit action of its change and,
// except for an earlier publish, the record changed; causes are inserted and
// deleted, never changed. All names are invented.
describe('out-of-date causes in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LoadKit;
  let branchCount = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  async function draft(): Promise<{ branch: string; version: string }> {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Causes branch ${String(branchCount)}`);
    const year = await kit.classes.year(branch);
    return { branch, version: await kit.version(branch, year, { startsOn: STARTS_ON }) };
  }

  const insertCause = (
    branch: string,
    version: string,
    values: { action?: string; record_id?: string | null } = {},
  ) =>
    inBranch(branch, (transaction) =>
      transaction
        .insertInto('timetable_version_out_of_date_causes')
        .values({
          branch_id: branch,
          version_id: version,
          action: values.action ?? 'room.edit',
          record_id: values.record_id === undefined ? version : values.record_id,
          caused_at: new Date(NOW),
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = new LoadKit(database.migrator);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('inserts and deletes a cause, and never changes one', async () => {
    const { branch, version } = await draft();
    const { id } = await insertCause(branch, version);
    const refused = await refusal(
      inBranch(branch, (transaction) =>
        transaction
          .updateTable('timetable_version_out_of_date_causes')
          .set({ caused_at: new Date(NOW) })
          .where('id', '=', id)
          .execute(),
      ),
    );
    expect(refused).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    await inBranch(branch, (transaction) =>
      transaction.deleteFrom('timetable_version_out_of_date_causes').where('id', '=', id).execute(),
    );
    const left = await database.migrator
      .selectFrom('timetable_version_out_of_date_causes')
      .select('id')
      .where('version_id', '=', version)
      .execute();
    expect(left).toEqual([]);
  });

  it('takes only the actions that mark, and a record except for a publish', async () => {
    const { branch, version } = await draft();
    expect(await refusal(insertCause(branch, version, { action: 'room.create' }))).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'timetable_version_out_of_date_causes_action_check',
    });
    expect(await refusal(insertCause(branch, version, { record_id: null }))).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'timetable_version_out_of_date_causes_record_check',
    });
    await insertCause(branch, version, { action: 'timetable_version.publish', record_id: null });
  });

  it('writes a cause only for a version of the branch', async () => {
    const { version } = await draft();
    const other = await draft();
    const refused = await refusal(insertCause(other.branch, version));
    expect(refused).toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
      constraint: 'timetable_version_out_of_date_causes_version_fkey',
    });
  });
});

// Decision 6: a draft that a publish marked before 0077 keeps its mark as a
// publish cause with no record, at the moment of the mark; then the column is
// gone and the edit lock is still guarded. The versions are written the way
// 0073 wrote them.
describe('migration 0077 keeps the marks already made', () => {
  let database: TestDatabase;
  let directory: string;
  let kit: LoadKit;
  let marked: { branch: string; version: string };
  let unmarked: string;
  const markedAt = new Date('2026-10-12T09:30:00+05:00');

  beforeAll(async () => {
    database = await createTestDatabase({ empty: true });
    directory = await mkdtemp(path.join(tmpdir(), 'sodiq-out-of-date-'));
    for (const name of (await readdir(MIGRATIONS)).filter((one) => one.endsWith('.sql'))) {
      if (name < CAUSES) {
        await copyFile(path.join(MIGRATIONS, name), path.join(directory, name));
      }
    }
    await migrate({ connectionString: database.migrationUrl, directory });
    kit = new LoadKit(database.migrator);
    const branch = await insertBranch(database.migrator, 'North');
    const year = await kit.classes.year(branch);
    const version = await kit.version(branch, year, { startsOn: STARTS_ON });
    unmarked = await kit.version(branch, year, { startsOn: STARTS_ON });
    await sql`update timetable_versions set out_of_date_at = ${markedAt} where id = ${version}`.execute(
      database.migrator,
    );
    marked = { branch, version };
    await copyFile(path.join(MIGRATIONS, CAUSES), path.join(directory, CAUSES));
    await migrate({ connectionString: database.migrationUrl, directory });
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
    await database.destroy();
  });

  it('gives a marked draft one publish cause with no record, and an unmarked one none', async () => {
    const causes = await database.migrator
      .selectFrom('timetable_version_out_of_date_causes')
      .select(['branch_id', 'version_id', 'action', 'record_id', 'caused_at'])
      .orderBy('id')
      .execute();
    expect(causes).toEqual([
      {
        branch_id: marked.branch,
        version_id: marked.version,
        action: 'timetable_version.publish',
        record_id: null,
        caused_at: markedAt,
      },
    ]);
    expect(causes.some((one) => one.version_id === unmarked)).toBe(false);
  });

  it('drops the column and keeps the edit lock guarded', async () => {
    const columns = await sql<{ column_name: string }>`
      select column_name from information_schema.columns
      where table_name = 'timetable_versions' and column_name = 'out_of_date_at'
    `.execute(database.migrator);
    expect(columns.rows).toEqual([]);
    const triggers = await sql<{ definition: string }>`
      select pg_get_triggerdef(t.oid) as definition from pg_trigger t
      where t.tgname = 'timetable_versions_mark_draft'
    `.execute(database.migrator);
    expect(triggers.rows.map((row) => row.definition)).toEqual([
      expect.stringContaining(
        'BEFORE UPDATE OF edit_holder_id, edit_seen_at ON public.timetable_versions',
      ),
    ]);
  });
});
