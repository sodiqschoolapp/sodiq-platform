import { schoolDateOf } from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../database/transactions.js';
import { PreparedTotals } from '../modules/results/prepared/prepare.job.js';
import { SCHOOL_INPUTS } from '../modules/results/prepared/prepared.query.js';
import { startedQuarters, unitsOf, unitValue } from '../modules/results/prepared/units.js';
import type { AppKit } from './day-templates-kit.js';

/**
 * Task 9.3b-1: the checks of the prepared report totals over a filled school (the speed run's
 * scene). The tables the preparation reads are found from PostgreSQL's own counts of the
 * transaction (`pg_stat_xact_user_tables`), so a read in raw SQL or inside a function counts too;
 * every one is a branch table with a change trigger or a school-wide input of `SCHOOL_INPUTS`
 * (review of the plan, finding 3: the list derived, not written by hand).
 */

const timeZoneOf = async (t: AppKit, branchId: string): Promise<string> =>
  (
    await t.database.migrator
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow()
  ).time_zone;

const scans = async (transaction: Transaction) =>
  new Map(
    (
      await sql<{ name: string; scans: string }>`
        select relname as name, (coalesce(seq_scan, 0) + coalesce(idx_scan, 0))::text as scans
        from pg_stat_xact_user_tables where schemaname = 'public'
      `.execute(transaction)
    ).rows.map((row) => [row.name, BigInt(row.scans)]),
  );

/** The tables every unit of the branch reads while it is prepared from source. */
export async function tablesReadByPreparation(t: AppKit, branchId: string): Promise<string[]> {
  const timeZone = await timeZoneOf(t, branchId);
  return t.app.get(Transactions).run([branchId], async (transaction) => {
    const now = await transactionMoment(transaction);
    const moment = { transaction, branchId, timeZone, now, today: schoolDateOf(now, timeZone) };
    const before = await scans(transaction);
    const quarters = new Map((await startedQuarters(moment)).map((one) => [one.id, one]));
    for (const unit of await unitsOf(moment)) {
      const quarter = quarters.get(unit.quarterId);
      if (quarter !== undefined) await unitValue(moment, quarter, unit);
    }
    const after = await scans(transaction);
    return [...after]
      .filter(([name, count]) => count > (before.get(name) ?? 0n))
      .map(([name]) => name)
      .filter((name) => !name.startsWith('report_'))
      .sort();
  });
}

/** The tables with the change triggers of 0140, and whether each belongs to a branch. */
export async function watchedTables(t: AppKit): Promise<{
  watched: string[];
  branchTables: string[];
}> {
  const watched = await sql<{ name: string }>`
    select distinct c.relname as name
    from pg_trigger g join pg_class c on c.oid = g.tgrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where g.tgname like '%\\_report\\_insert'
    order by 1
  `.execute(t.database.migrator);
  const branchTables = await sql<{ name: string }>`
    select c.relname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind in ('r', 'p') and c.relrowsecurity
      and exists (select from pg_policy p where p.polrelid = c.oid and p.polname = 'branch_filter')
    order by 1
  `.execute(t.database.migrator);
  return {
    watched: watched.rows.map((row) => row.name),
    branchTables: branchTables.rows.map((row) => row.name),
  };
}

/** What the inputs check finds wrong: tables read but neither watched nor school-wide inputs. */
export async function inputsNotWatched(
  t: AppKit,
  read: readonly string[],
): Promise<{
  unwatched: string[];
  schoolInputsWithBranch: string[];
  watchedWithoutBranch: string[];
}> {
  const { watched, branchTables } = await watchedTables(t);
  const school = new Set<string>(SCHOOL_INPUTS);
  return {
    unwatched: read.filter((name) => !watched.includes(name) && !school.has(name)),
    schoolInputsWithBranch: [...school].filter((name) => branchTables.includes(name)),
    watchedWithoutBranch: watched.filter((name) => !branchTables.includes(name)),
  };
}

/** The preparation of one branch, as the worker's job runs it; answers the units prepared. */
export async function prepareBranch(t: AppKit, branchId: string): Promise<number> {
  const timeZone = await timeZoneOf(t, branchId);
  return t.app.get(PreparedTotals, { strict: false }).prepareBranch(branchId, timeZone);
}

/** An answer without its stamp, to compare a read from source with a read of the prepared. */
export function withoutStamp(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return body;
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).filter(([key]) => key !== 'prepared'),
  );
}
