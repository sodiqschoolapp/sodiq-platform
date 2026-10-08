import { z } from 'zod';
import { branchIdSchema } from './branches.js';

/**
 * Notifications to staff in the app (docs/spec/10-portal-notifications-release-2.md,
 * Notifications, last paragraph: timetable changes, substitutions, locks and
 * plan windows are Release 1; SMS and the portal are Release 2).
 *
 * A notification is a kind and its data; the text is made in the browser from
 * the two, in the language of the tab, which is the language of the account
 * (decided by the owner at the plan of task 0.9). The server stores no text.
 */

/** How a kind is written, the same rule as the check constraint of `notifications` (0013). */
export const NOTIFICATION_KIND_FORMAT = /^[a-z]+(\.[a-z_]+)+$/;

export const NOTIFICATION_KIND_MAX_LENGTH = 100;

/**
 * The kinds of notification and the data each one carries. A later task adds
 * its kind here with the schema of its data, and the text of the kind in the
 * three locale files of the web app under `notifications.kinds.<kind>`; a test
 * of the web app fails for a kind without its texts.
 *
 * `sample.message` exists for the tests and the browser tests of task 0.9; no
 * route of the application sends one.
 */
export const NOTIFICATION_KINDS = {
  'sample.message': z.strictObject({ text: z.string().min(1).max(500) }),
} as const satisfies Record<string, z.ZodType>;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

export const NOTIFICATION_KIND_NAMES = Object.keys(NOTIFICATION_KINDS) as [
  NotificationKind,
  ...NotificationKind[],
];

export const notificationKindSchema = z.enum(NOTIFICATION_KIND_NAMES);

/** The data of a kind, as the schema of the kind allows it. */
export type NotificationData<Kind extends NotificationKind> = z.infer<
  (typeof NOTIFICATION_KINDS)[Kind]
>;

/** How many notifications the list answers and the top bar shows: the latest ones. */
export const NOTIFICATION_LIST_LIMIT = 50;

/** One notification as the API answers it. */
export const notificationSchema = z.object({
  id: z.uuid(),
  /** A name of `NOTIFICATION_KINDS`. As text: a tab may be older than the server and not know a kind. */
  kind: z.string().regex(NOTIFICATION_KIND_FORMAT).max(NOTIFICATION_KIND_MAX_LENGTH),
  /** What the text of the kind needs, as its schema allows it. */
  data: z.record(z.string(), z.unknown()),
  /** The branch of the event, or `null` for an event of the whole school. */
  branchId: branchIdSchema.nullable(),
  /** The name of that branch; `null` without a branch. */
  branchName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** When the person marked it read; `null` while unread. */
  readAt: z.iso.datetime().nullable(),
});

export type Notification = z.infer<typeof notificationSchema>;

/** The answer of `GET /api/notifications`: the latest ones, newest first, and how many are unread. */
export const notificationListSchema = z.object({
  unreadCount: z.int().min(0),
  items: z.array(notificationSchema).max(NOTIFICATION_LIST_LIMIT),
});

export type NotificationList = z.infer<typeof notificationListSchema>;

export const notificationParamsSchema = z.object({ id: z.uuid() });

export type NotificationParams = z.infer<typeof notificationParamsSchema>;

/**
 * Live arrival over Socket.IO (docs/spec/13-technology.md). The server is
 * reached under the API prefix, on the same origin as the API, and only tells;
 * a client sends nothing that the server acts on.
 */
export const NOTIFICATION_SOCKET_PATH = '/api/socket';

/** What the server tells a connected tab. */
export const NOTIFICATION_MESSAGES = {
  /** At every connection: the unread count and the latest items, as the list route answers them. */
  state: 'notification.state',
  /** New notifications of the person. */
  new: 'notification.new',
  /** Notifications the person marked read in another tab. */
  read: 'notification.read',
  /** The person marked everything read in another tab. */
  readAll: 'notification.read_all',
  /**
   * The session of the tab is over or owes a step again; the server closes
   * the connection right after. The tab asks the API what its session is now.
   */
  ended: 'session.ended',
} as const;

/** The reason of `session.ended` and of a refused handshake: a code of the API's error shape. */
export const notificationEndedMessageSchema = z.object({
  code: z.enum([
    'not_signed_in',
    'second_step_required',
    'password_change_required',
    'second_step_set_up_required',
  ]),
});

export const notificationStateMessageSchema = notificationListSchema;

export const notificationNewMessageSchema = z.object({ items: z.array(notificationSchema) });

export const notificationReadMessageSchema = z.object({
  ids: z.array(z.uuid()),
  readAt: z.iso.datetime(),
});

export const notificationReadAllMessageSchema = z.object({ readAt: z.iso.datetime() });
