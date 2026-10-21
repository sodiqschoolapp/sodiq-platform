import type { Transaction } from '../../database/transactions.js';

/**
 * The version in force on a date of the year, or `null`: the published
 * version with the latest start on or before it (task 5.6c-1; the version
 * history of task 5.8a names it for each quarter's first day).
 */
export async function versionOnDate(
  transaction: Transaction,
  branchId: string,
  yearId: string,
  date: string,
): Promise<string | null> {
  const found = await transaction
    .selectFrom('timetable_versions')
    .select('id')
    .where('branch_id', '=', branchId)
    .where('academic_year_id', '=', yearId)
    .where('status', '=', 'published')
    .where('starts_on', '<=', date)
    .orderBy('starts_on', 'desc')
    .orderBy('number', 'desc')
    .executeTakeFirst();
  return found?.id ?? null;
}
