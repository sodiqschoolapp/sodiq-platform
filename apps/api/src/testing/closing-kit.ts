import type { Database } from '../database/database.js';
import { Transactions } from '../database/transactions.js';
import { FixedClock } from './fixed-clock.js';

/**
 * Task 9.2b: a quarter closed as the close writes its closing row (the close itself is tested
 * in `closing.test.ts`), for the tests of the writes a closed quarter refuses. The moment is
 * the transaction's; the account is the closer. Answers the closing's id.
 */
export async function closeQuarter(
  database: { readonly app: Database; readonly migrator: Database },
  input: {
    readonly branchId: string;
    readonly quarterId: string;
    readonly accountId: string;
    readonly at?: string;
  },
): Promise<string> {
  const transactions = new Transactions(
    database.app,
    new FixedClock(input.at ?? '2026-10-31T18:00:00+05:00'),
  );
  return transactions.run([input.branchId], async (transaction) => {
    const row = await transaction
      .insertInto('quarter_closings')
      .values({
        branch_id: input.branchId,
        quarter_id: input.quarterId,
        version: 1,
        closed_at: new Date(0),
        closed_by: input.accountId,
        lock_now: false,
        start_quarter: null,
        warnings: JSON.stringify([]),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  });
}
