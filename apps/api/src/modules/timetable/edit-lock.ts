import { DRAFT_EDIT_LOCK_MINUTES } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/**
 * Whether a draft's edit lock seen at `seenAt` still holds at `moment`
 * (`edge/timetable`, Generator and editing: "The edit lock is released after 5
 * minutes without activity"; task 5.4c-1). A stored moment compared with the
 * moment of the transaction on each request, never flipped by a job.
 */
export function editLockFresh(seenAt: Date | null, moment: Date): boolean {
  return seenAt !== null && moment.getTime() - seenAt.getTime() < DRAFT_EDIT_LOCK_MINUTES * 60_000;
}

/**
 * The names of accounts that hold or took a draft's edit lock, "last first",
 * read as the audit log of the branch names its actors (`audit_names`, 0039):
 * a person who writes a draft of the branch is named in its audit log anyway.
 * An account with no staff record (a Super Admin made by the first-account
 * command) is named by its login, which is made from the same name.
 */
export async function accountNames(
  transaction: Transaction,
  accountIds: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (accountIds.length === 0) return names;
  const found = await sql<{ id: string; first_name: string | null; last_name: string | null }>`
    select id, first_name, last_name from audit_names(${[...accountIds]}::uuid[])
  `.execute(transaction);
  for (const row of found.rows) {
    const name = [row.last_name, row.first_name].filter(Boolean).join(' ');
    if (name !== '') names.set(row.id, name);
  }
  const unnamed = accountIds.filter((id) => !names.has(id));
  if (unnamed.length > 0) {
    for (const row of await transaction
      .selectFrom('accounts')
      .select(['id', 'login'])
      .where('id', 'in', unnamed)
      .execute()) {
      names.set(row.id, row.login);
    }
  }
  return names;
}
