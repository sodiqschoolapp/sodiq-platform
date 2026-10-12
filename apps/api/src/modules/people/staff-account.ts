import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/**
 * Whether the staff record linked to the account is inactive or has left on
 * the date of `at` in its main branch's time zone (`edge/people-roles-accounts`,
 * Staff over time: "Inactive: ... cannot be scheduled or sign in"; task 2.2a).
 * Read from the stored status rows on every sign-in and request; no job flips
 * it. Sign-in runs before a branch is known, so the answer comes from
 * `staff_account_blocked`, a boolean only (db/migrations/0024).
 */
export async function staffAccountBlocked(
  transaction: Transaction,
  accountId: string,
  at: Date,
): Promise<boolean> {
  const found = await sql<{ blocked: boolean }>`
    select staff_account_blocked(${accountId}::uuid, ${at}) as blocked
  `.execute(transaction);
  return found.rows[0]?.blocked === true;
}
