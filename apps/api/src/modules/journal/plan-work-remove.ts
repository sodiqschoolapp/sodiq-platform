import { transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';

/**
 * Removes a work of a plan item (task 8.1, decision 11): a work a journal
 * work names (a total, "not held" or numbers) is kept by the no-action key
 * `journal_works_plan_work_fkey` (0119), and the removal is refused 409
 * `plan_work_has_data`; the wider rules of a plan edit over held lessons are
 * 8.8's. Task 10.8 (plan decision 14): the work's files are removed first
 * (`removed_at`; their rows and bytes stay), since `lesson_plan_work_files_left`
 * (0162) refuses to delete a work that still holds one. Gives the files removed,
 * for the caller's audit entry.
 */
export async function removePlanWork(transaction: Transaction, workId: string): Promise<string[]> {
  const files = await removeFilesOf(transaction, [workId]);
  await refusingKept(
    transaction.deleteFrom('lesson_plan_works').where('id', '=', workId).execute(),
  );
  return files;
}

/** Removes every work of an item (the take of a master's content, task 7.3), as `removePlanWork`. */
export async function removePlanWorks(transaction: Transaction, itemId: string): Promise<string[]> {
  const works = await transaction
    .selectFrom('lesson_plan_works')
    .select('id')
    .where('item_id', '=', itemId)
    .execute();
  const files = await removeFilesOf(
    transaction,
    works.map((work) => work.id),
  );
  await refusingKept(
    transaction.deleteFrom('lesson_plan_works').where('item_id', '=', itemId).execute(),
  );
  return files;
}

/** Task 10.8: marks the files not removed of the works removed, from the transaction's moment. */
async function removeFilesOf(
  transaction: Transaction,
  workIds: readonly string[],
): Promise<string[]> {
  if (workIds.length === 0) return [];
  const removed = await transaction
    .updateTable('lesson_plan_files')
    .set({ removed_at: await transactionMoment(transaction) })
    .where('work_id', 'in', [...workIds])
    .where('removed_at', 'is', null)
    .returning('id')
    .execute();
  return removed.map((file) => file.id).sort();
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
