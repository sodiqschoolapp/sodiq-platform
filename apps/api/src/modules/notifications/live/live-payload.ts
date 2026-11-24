import { sql } from 'kysely';
import { assistantProgressSchema } from '@sodiq/shared';
import { z } from 'zod';
import type { Transaction } from '../../../database/transactions.js';

/**
 * The PostgreSQL channel on which the worker and the routes tell every API
 * process what to push to the connected tabs (`LiveListener`). NOTIFY is
 * transactional: a payload sent inside a transaction reaches the listeners
 * at its commit, and never if it rolls back.
 */
export const LIVE_CHANNEL = 'sodiq_notifications';

/**
 * At most this many ids in one payload. PostgreSQL refuses a payload of 8000
 * bytes or more; a publish can notify a few hundred teachers at once.
 */
export const LIVE_CHUNK = 100;

/**
 * What a payload holds: ids and moments only, never the data of a notification. The one exception
 * is the assistant's progress (task 11.16, plan decision 5, Look first): a piece of the answer's
 * text as it is written, for the asking account's own tabs (`02`, While it works); a read's data
 * never goes.
 */
export const livePayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('new'), ids: z.array(z.uuid()).min(1).max(LIVE_CHUNK) }),
  z.object({
    kind: z.literal('read'),
    accountId: z.uuid(),
    ids: z.array(z.uuid()).min(1).max(LIVE_CHUNK),
    readAt: z.iso.datetime(),
  }),
  z.object({ kind: z.literal('read_all'), accountId: z.uuid(), readAt: z.iso.datetime() }),
  // Task 10.11: the tabs of the account read their state again (after a key marked some read).
  z.object({ kind: z.literal('state'), accountId: z.uuid() }),
  // Task 11.16: the progress of a question, told to the asking account's tabs only.
  assistantProgressSchema.extend({ kind: z.literal('assistant'), accountId: z.uuid() }),
]);

export type LivePayload = z.infer<typeof livePayloadSchema>;

/** Sends one payload in the caller's transaction, so it goes out with the commit. */
export async function notifyLive(transaction: Transaction, payload: LivePayload): Promise<void> {
  await sql`select pg_notify(${LIVE_CHANNEL}, ${JSON.stringify(payload)})`.execute(transaction);
}

/** Lists of at most `LIVE_CHUNK` ids, in order. */
export function chunks<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += LIVE_CHUNK) {
    result.push(items.slice(start, start + LIVE_CHUNK));
  }
  return result;
}
