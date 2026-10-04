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
}
