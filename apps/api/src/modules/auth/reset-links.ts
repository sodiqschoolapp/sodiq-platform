import { createHash, randomBytes } from 'node:crypto';
import type { Transaction } from '../../database/transactions.js';

/**
 * Closes every open link of the password reset by email of an account (task
 * 2.3c-2, decision 11 of pull request #66): a newer link, every password
 * write (an administrator's reset, a re-hire password, the own change, the
 * reset by email itself) and an email change call it in their transaction, so
 * a link made before any of them never works afterwards.
 */
export async function closeOpenResetLinks(
  transaction: Transaction,
  accountId: string,
  now: Date,
): Promise<void> {
  await transaction
    .updateTable('password_reset_links')
    .set({ closed_at: now })
    .where('account_id', '=', accountId)
    .where('used_at', 'is', null)
    .where('closed_at', 'is', null)
    .execute();
}

/** 32 random bytes as base64url (`RESET_TOKEN_FORMAT`): the token of a link, held only in the mail. */
export function newResetToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What the database keeps of a token: its SHA-256 as hex, as for sessions. */
export function resetTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
