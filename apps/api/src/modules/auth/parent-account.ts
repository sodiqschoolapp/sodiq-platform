import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/**
 * Whether an account is a relative's Parent account (task 11.1; db/migrations/0158,
 * `is_parent_account`). Read with the session on every request, never kept.
 */
export async function isParentAccount(
  transaction: Transaction,
  accountId: string,
): Promise<boolean> {
  const found = await sql<{ parent: boolean }>`
    select is_parent_account(${accountId}::uuid) as parent
  `.execute(transaction);
  return found.rows[0]?.parent === true;
}

/**
 * Whether a Parent account can no longer sign in at a moment (plan of #292, decision 6): its
 * relative archived or merged, or no live link with portal access on to an active student.
 * False for a staff account.
 */
export async function parentAccountBlocked(
  transaction: Transaction,
  accountId: string,
  at: Date,
): Promise<boolean> {
  const found = await sql<{ blocked: boolean }>`
    select parent_account_blocked(${accountId}::uuid, ${at}) as blocked
  `.execute(transaction);
  return found.rows[0]?.blocked === true;
}

/** The full name of the relative of a Parent account, for its own session answer. */
export async function ownRelativeName(
  transaction: Transaction,
  accountId: string,
): Promise<string | null> {
  const found = await sql<{ name: string | null }>`
    select own_relative_name(${accountId}::uuid) as name
  `.execute(transaction);
  return found.rows[0]?.name ?? null;
}
