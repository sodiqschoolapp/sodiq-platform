import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/**
 * Any fixed number: every change that gives or may remove a Super Admin takes
 * it first, before any row lock (task 2.3a, finding 4 of the plan review), so
 * that of two such changes at the same moment the second sees the first and
 * the two paths cannot wait for each other.
 */
export const SUPER_ADMIN_COUNT_LOCK = 60_701;

/** The change would leave no active Super Admin (`edge/people-roles-accounts`, Accounts and sign-in). */
export class LastSuperAdminError extends Error {
  constructor() {
    super('The change would leave no active Super Admin.');
  }
}

/** Waits for, then holds until the end of the transaction, the lock of the Super Admin count. */
export async function lockSuperAdmins(transaction: Transaction): Promise<void> {
  await sql`select pg_advisory_xact_lock(${SUPER_ADMIN_COUNT_LOCK})`.execute(transaction);
}

/**
 * The number of active Super Admins at a moment, as this transaction sees
 * them, its own changes included (task 2.3a, decision 5): a Super Admin
 * assignment that has begun and has no end, an account that is not locked,
 * and a staff record with no inactive or left status today or planned. Read
 * through `super_admin_active_count` (db/migrations/0027): a Super Admin's
 * record may be in any branch.
 */
export async function activeSuperAdmins(transaction: Transaction, at: Date): Promise<number> {
  const found = await sql<{ active: number }>`
    select super_admin_active_count(${at}) as active
  `.execute(transaction);
  return found.rows[0]?.active ?? 0;
}

/**
 * "The system refuses to ... remove the last active Super Admin": runs a
 * change that may remove one, in the caller's transaction and after
 * `lockSuperAdmins`, and refuses it with `LastSuperAdminError` when it took
 * the count from one or more to none. A count that was none before is not
 * this change's doing. The caller's transaction rolls the change back.
 */
export async function keepingASuperAdmin<T>(
  transaction: Transaction,
  at: Date,
  change: () => Promise<T>,
): Promise<T> {
  const before = await activeSuperAdmins(transaction, at);
  const result = await change();
  if (before > 0 && (await activeSuperAdmins(transaction, at)) === 0) {
    throw new LastSuperAdminError();
  }
  return result;
}
