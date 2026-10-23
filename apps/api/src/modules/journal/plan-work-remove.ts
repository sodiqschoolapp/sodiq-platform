import type { Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';

/**
 * Removes a work of a plan item (task 8.1, decision 11): a work a journal
 * work names (a total, "not held" or numbers) is kept by the no-action key
 * `journal_works_plan_work_fkey` (0119), and the removal is refused 409
 * `plan_work_has_data`; the wider rules of a plan edit over held lessons are
 * 8.8's.
 */
export function removePlanWork(transaction: Transaction, workId: string): Promise<void> {
  return refusingKept(transaction.deleteFrom('lesson_plan_works').where('id', '=', workId).execute());
}

/** Removes every work of an item (the take of a master's content, task 7.3), as `removePlanWork`. */
export function removePlanWorks(transaction: Transaction, itemId: string): Promise<void> {
  return refusingKept(
    transaction.deleteFrom('lesson_plan_works').where('item_id', '=', itemId).execute(),
  );
}

async function refusingKept(write: Promise<unknown>): Promise<void> {
  try {
    await write;
  } catch (error) {
    const failure = error as { code?: unknown; constraint?: unknown };
    if (failure.code === '23503' && failure.constraint === 'journal_works_plan_work_fkey') {
      throw new ApiException('plan_work_has_data', 409);
    }
    throw error;
  }
}
