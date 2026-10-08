import { z } from 'zod';
import type { Transaction } from '../../database/transactions.js';
import { defineJob } from '../../jobs/job-definition.js';
import { chunks, notifyLive } from './live/live-payload.js';

/**
 * The delivery of notifications (docs/spec/10-portal-notifications-release-2.md,
 * Notifications: "Sending goes through a queue with retries"). Enqueued by
 * `Notifications.send` in the transaction that wrote the rows, with
 * `branchIds: []`: the handler touches the school-wide `notifications` table
 * and the channel only, so it works for no branch.
 *
 * In Release 1 the one channel is the app: the handler tells the API
 * processes to push the rows to the connected tabs. Release 2 adds SMS here.
 */
export const deliverNotificationsJob = defineJob({
  name: 'notifications.deliver',
  data: z.strictObject({ notificationIds: z.array(z.uuid()).min(1) }),
});

export type DeliverNotifications = z.infer<typeof deliverNotificationsJob.data>;

/**
 * The handler: one NOTIFY per `LIVE_CHUNK` ids, in its own transaction, so the
 * push goes out at the commit. It changes no row; the request key of the
 * runner is its only write, so a second delivery of the same job runs
 * nothing (edge cases, "Every job can be repeated safely").
 */
export async function deliverNotifications(
  transaction: Transaction,
  data: DeliverNotifications,
): Promise<void> {
  for (const ids of chunks(data.notificationIds)) {
    await notifyLive(transaction, { kind: 'new', ids });
  }
}
