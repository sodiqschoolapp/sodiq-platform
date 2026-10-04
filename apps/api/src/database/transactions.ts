import { Inject, Injectable } from '@nestjs/common';
import { branchIdSchema } from '@sodiq/shared';
import { sql, type Transaction as KyselyTransaction } from 'kysely';
import type { Database } from './database.js';
import { DATABASE } from './database.tokens.js';
import type { DB } from './types.generated.js';

export type Transaction = KyselyTransaction<DB>;

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
  constructor(@Inject(DATABASE) private readonly database: Database) {}

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
      await sql`select set_config('app.branch_ids', ${filter}, true)`.execute(transaction);
      return work(transaction);
    });
  }
}
