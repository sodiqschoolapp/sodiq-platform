import type { Transaction } from '../../database/transactions.js';
import { recordsInForce, reopenedJournals } from '../setup/closed-quarters.js';

/**
 * The final records in force of a closed quarter as the readers of results take them (task 9.2b;
 * task 9.3a, review correction 3: the student's Results tab and the rating read one record one
 * way), by `<subject>|<student>`: the record of the highest version in force that holds one
 * (task 9.2c), or `undefined` with `reopened` when the journal it is listed under has an
 * unfinished reopening, which is read live. A pair without a stored record is not in the map.
 */
export async function storedRecordsOf(
  transaction: Transaction,
  quarterId: string,
  filter: { subjectId?: string; studentId?: string } = {},
): Promise<Map<string, { record: unknown; reopened: boolean }>> {
  const found = await recordsInForce(transaction, quarterId, filter);
  const reopened = await reopenedJournals(transaction, [quarterId]);
  return new Map<string, { record: unknown; reopened: boolean }>(
    [...found].map(([key, one]) =>
      reopened.has(`${quarterId}|${one.journalId}`)
        ? [key, { record: undefined, reopened: true }]
        : [key, { record: one.record, reopened: false }],
    ),
  );
}
