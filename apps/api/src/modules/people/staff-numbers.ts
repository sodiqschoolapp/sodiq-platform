import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/**
 * Takes the next number of a year of first hire from the school-wide counter
 * (docs/spec/edge-cases/developer-rules.md, Identifiers: "one school-wide
 * counter per year of first hire, taken in the same transaction as the
 * record"). The upsert locks the row of the year until the transaction ends,
 * so two saves of one moment get two numbers in order. The 10,000th number of
 * a year breaks `staff_id_counters_last_number_check` (`staff_id_exhausted`).
 */
export async function takeStaffNumber(transaction: Transaction, year: number): Promise<number> {
  const taken = await sql<{ last_number: number }>`
    insert into staff_id_counters (year, last_number) values (${year}, 1)
    on conflict (year) do update set last_number = staff_id_counters.last_number + 1
    returning last_number
  `.execute(transaction);
  const row = taken.rows[0];
  if (row === undefined) {
    throw new Error('The counter of staff IDs gave no number.');
  }
  return row.last_number;
}

/** S-YYNNNN: the last two digits of the year and the number in four digits (S-260001). */
export function staffIdOf(year: number, number: number): string {
  return `S-${String(year % 100).padStart(2, '0')}${String(number).padStart(4, '0')}`;
}
