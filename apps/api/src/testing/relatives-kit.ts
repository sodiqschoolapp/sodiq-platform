import { relativeNameKey } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Database } from '../database/database.js';
import type { Transaction } from '../database/transactions.js';

/**
 * Task 2.5a: a student is created with at least one relative (`04`, Close
 * relatives). The relative of a test that is not about relatives: a new one
 * with no phone of their own, so that no two tests meet on a phone. All names
 * are invented.
 */
export function relativesInput(): Record<string, unknown>[] {
  return [
    {
      kind: 'new',
      relative: { fullName: 'Dilfuza Karimova', phone: null, workplace: '', email: '' },
      relationship: 'mother',
      mainContact: true,
      portalAccess: true,
      receivesNotices: true,
    },
  ];
}

/**
 * The writes of a relative linked to a student written by hand, in the
 * transaction of the student (`student_relatives_guard` checks at the commit):
 * a relative with no phone of their own, its account and the main link.
 * Returns the id of the relative.
 */
export async function linkRelative(
  transaction: Transaction | Database,
  studentId: string,
  branchId: string,
  moment: Date,
  values: { fullName?: string; phone?: string | null; mainContact?: boolean } = {},
): Promise<string> {
  const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
  const id = found.rows[0]?.id ?? '';
  const fullName = values.fullName ?? 'Dilfuza Karimova';
  await transaction
    .insertInto('relatives')
    .values({
      id,
      full_name: fullName,
      name_key: relativeNameKey(fullName),
      phone: values.phone ?? null,
    })
    .execute();
  await transaction
    .insertInto('relative_accounts')
    .values({ relative_id: id, created_at: moment })
    .execute();
  await transaction
    .insertInto('student_relatives')
    .values({
      student_id: studentId,
      branch_id: branchId,
      relative_id: id,
      relationship: 'mother',
      main_contact: values.mainContact ?? true,
      linked_at: moment,
    })
    .execute();
  return id;
}
