import type { Transaction } from '../../database/transactions.js';

/** A published version as the readers of the version in force need it. */
export interface VersionInForce {
  readonly id: string;
  readonly number: number;
  /** Its "valid from" (`06`, How surprises are prevented, One source). */
  readonly startsOn: string;
}

/**
 * The version in force on a date of the year, or `null`: the published
 * version with the latest start on or before it (task 5.6c-1; the version
 * history of task 5.8a names it for each quarter's first day; the timetable
 * views of task 5.9a name its number and "valid from" on each day).
 */
export async function versionOnDate(
  transaction: Transaction,
  branchId: string,
  yearId: string,
  date: string,
): Promise<VersionInForce | null> {
  const found = await transaction
    .selectFrom('timetable_versions')
    .select(['id', 'number', 'starts_on'])
    .where('branch_id', '=', branchId)
    .where('academic_year_id', '=', yearId)
    .where('status', '=', 'published')
    .where('starts_on', '<=', date)
    .orderBy('starts_on', 'desc')
    .orderBy('number', 'desc')
    .executeTakeFirst();
  return found === undefined
    ? null
    : { id: found.id, number: found.number, startsOn: found.starts_on };
}
