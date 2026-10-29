import type { Transaction } from '../../database/transactions.js';

/**
 * The hidden Monitoring branch of the sign-in-and-save check (task 10.2b; answer 10: "one class,
 * one test teacher and invented students, left out of every school report; the Super Admin
 * sees it in the branch switcher as 'Monitoring'"). It is the branch marked
 * `purpose = 'monitoring'` (0142), at most one, set only by the owner's command
 * (`monitoring-branch`). `branches` has no row filter, so any transaction reads the mark.
 */
export async function monitoringBranchId(transaction: Transaction): Promise<string | null> {
  const row = await transaction
    .selectFrom('branches')
    .select('id')
    .where('purpose', '=', 'monitoring')
    .executeTakeFirst();
  return row?.id ?? null;
}
