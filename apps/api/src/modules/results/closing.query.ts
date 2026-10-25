import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import type { QuarterRef } from './grade-changes.js';

/**
 * The named queries of the closing checklist (task 9.2a): `07`, Closing a quarter,
 * "Students with no result in a subject and no exemption".
 */

/** The students with an exemption in force in the quarter, as `student|subject` or `student|*`. */
export async function exemptedIn(
  transaction: Transaction,
  quarter: QuarterRef,
  studentIds: readonly string[],
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const found = await sql<{ student_id: string; subject_key: string }>`
    select distinct s.student_id, s.subject_key
    from exemption_spans s
    where s.live
      and s.student_id = any(${[...studentIds]}::uuid[])
      and s.span && tsrange(${quarter.startDate}::date::timestamp, (${quarter.endDate}::date + 1)::timestamp, '[)')
  `.execute(transaction);
  return new Set(
    found.rows.map((row) =>
      row.subject_key === '00000000-0000-0000-0000-000000000000'
        ? `${row.student_id}|*`
        : `${row.student_id}|${row.subject_key}`,
    ),
  );
}
