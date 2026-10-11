import { Inject, Injectable } from '@nestjs/common';
import { branchIdSchema } from '@sodiq/shared';
import { sql, type Transaction as KyselyTransaction } from 'kysely';
import type { Database } from './database.js';
import { DATABASE } from './database.tokens.js';
import type { DB } from './types.generated.js';

export type Transaction = KyselyTransaction<DB>;

/** The transaction setting that the row policies read (db/migrations/0002). */
export const BRANCH_SETTING = 'app.branch_ids';

/**
 * The value of `app.branch_ids` for a list of branch ids: a PostgreSQL array
 * of uuids. Each id is checked first, so nothing else can reach the setting.
 */
export function branchFilterValue(branchIds: readonly string[]): string {
  for (const id of branchIds) {
    if (!branchIdSchema.safeParse(id).success) {
      // The value is not repeated: it may be text that a caller sent.
      throw new Error('The branch filter was given something that is not a branch id.');
    }
  }
  return `{${branchIds.join(',')}}`;
}

/**
 * Where business code gets its transaction. The branch filter is set for this
 * transaction only (docs/spec/edge-cases/developer-rules.md, "Branch filter"),
 * so it never stays on a pooled connection.
 */
@Injectable()
export class Transactions {
  /** True once the user of this connection was seen to be subject to the branch filter. */
  private filtered = false;

  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /**
   * The row policies do nothing for a superuser, a user with BYPASSRLS, or the
   * owner of the tables (or a member of the owner). Such a user would see every
   * branch, so it is given no transaction.
   */
  private async assertFiltered(transaction: Transaction): Promise<void> {
    const found = await sql<{ unfiltered: boolean }>`
      select r.rolsuper or r.rolbypassrls or pg_has_role(current_user, c.relowner, 'MEMBER')
        as unfiltered
      from pg_roles r, pg_class c
      where r.rolname = current_user and c.oid = 'public.branches'::regclass
    `.execute(transaction);
    if (found.rows[0]?.unfiltered !== false) {
      throw new Error(
        'The database user of the application is not subject to the branch filter (superuser, BYPASSRLS or owner of the tables).',
      );
    }
    this.filtered = true;
  }

  /**
   * Runs `work` in one transaction that sees and writes only rows of
   * `branchIds`: normally one branch, several for a person who works across
   * branches, none (`[]`) for work on school-wide tables only. Commits when
   * `work` returns and rolls back when it throws.
   */
  async run<T>(
    branchIds: readonly string[],
    work: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    const filter = branchFilterValue(branchIds);
    return this.database.transaction().execute(async (transaction) => {
      if (!this.filtered) {
        await this.assertFiltered(transaction);
      }
      await sql`select set_config(${BRANCH_SETTING}, ${filter}, true)`.execute(transaction);
      return work(transaction);
    });
  }

  /**
   * The branch create only (task 1.6, correction 2 of pull request #49): its
   * transaction begins with no branch (the branch does not exist yet), and the
   * rows that every branch has (its settings) belong to the new branch. This
   * sets the filter of the rest of that one transaction to the new branch.
   * It refuses a branch that was not inserted by this transaction, and a
   * transaction that already works for a branch, so it can never widen what a
   * request sees.
   */
  async enterCreatedBranch(transaction: Transaction, branchId: string): Promise<void> {
    const filter = branchFilterValue([branchId]);
    const found = await sql<{ created_here: boolean; filter: string | null }>`
      select
        exists (
          select 1 from branches
          where id = ${branchId}::uuid and xmin::text = (pg_current_xact_id()::xid)::text
        ) as created_here,
        current_setting(${BRANCH_SETTING}, true) as filter
    `.execute(transaction);
    const row = found.rows[0];
    if (row?.created_here !== true || row.filter !== '{}') {
      throw new Error(
        'Only a branch inserted by this transaction, which works for no branch, is entered.',
      );
    }
    await sql`select set_config(${BRANCH_SETTING}, ${filter}, true)`.execute(transaction);
  }
}
