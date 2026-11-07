import { z } from 'zod';
import { defineJob } from '../../jobs/job-definition.js';

/**
 * Task 11.7 (pull request #306): the bot's messages of an announcement for parents.
 *
 * `announcements.fan_out`, enqueued in the transaction of the create: one `due` delivery per
 * Parent account the announcement reaches (`announcement_recipients`, 0163); a second run adds
 * nothing (unique per announcement and account).
 */
export const announcementFanOutJob = defineJob({
  name: 'announcements.fan_out',
  data: z.strictObject({ announcementId: z.uuid() }),
  transaction: 'none',
});

/**
 * `announcements.tick`, every minute by pg-boss's cron, as `digest.tick`: outside the quiet hours
 * and while the bot is set up, each delivery `due` whose next try has come is enqueued (plan
 * decision 9). The tick is the retry.
 */
export const announcementTickJob = defineJob({
  name: 'announcements.tick',
  data: z.strictObject({}),
  transaction: 'none',
  cron: '* * * * *',
});

/** `announcements.deliver`: one message, everything checked again just before it is sent. */
export const announcementDeliverJob = defineJob({
  name: 'announcements.deliver',
  data: z.strictObject({ deliveryId: z.uuid() }),
  transaction: 'none',
  options: { retryLimit: 0 },
});

export const ANNOUNCEMENT_JOBS = [
  announcementFanOutJob,
  announcementTickJob,
  announcementDeliverJob,
];
