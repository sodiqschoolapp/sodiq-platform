import type { Transaction } from '../../database/transactions.js';
import { notFound } from '../setup/setup-refusals.js';

/** Students of the branch among `ids`, read through the branch filter; any other is 404. */
export async function refuseOtherStudents(
  transaction: Transaction,
  ids: readonly string[],
): Promise<void> {
  const wanted = [...new Set(ids.map((id) => id.toLowerCase()))];
  const found = await transaction
    .selectFrom('students')
    .select('id')
    .where('id', 'in', wanted)
    .execute();
  if (found.length !== wanted.length) throw notFound();
}
