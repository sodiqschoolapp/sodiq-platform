import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
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
 * of the web app fails for a kind without its texts. The fields of the data
 * are the `{{names}}` of the text and nothing else; a plural form is not
 * chosen by them (the web passes the data as `replace`, not as options).
 * The one exception: the kinds of `WEEK_KINDS` also carry the lists
 * `before` and `after`, which no text interpolates; the web shows them as two
 * lists under the text (`week-change.tsx`; task 5.5c-3a, review correction 2,
 * build decision 11).
 *
 * `sample.message` exists for the tests and the browser tests of task 0.9; no
 * route of the application sends one.
 */
const relativeName = z.string().min(1).max(120);

const versionNumber = z.string().regex(/^[1-9][0-9]{0,3}$/);

/** At most this many lessons on each side of a week (task 5.5c-3a, decision 9). */
export const WEEK_LESSONS_MAX = 100;

const clockTime = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);

/**
 * One lesson of a teacher's week in a notice of a timetable change, as the
 * event saw it (task 5.5c-3a, decision 9): its date and times in branch time,
 * its class or group and subject as shown, its room, and whether a one-day
 * cancel is on it (review correction 3), and whether it changed. No teacher: a vacancy never appears
 * in a notice (edge/timetable, the vacancy rows).
 */
export const weekLessonSchema = z.strictObject({
  date: schoolDateSchema,
  start: clockTime,
  end: clockTime,
  unit: z.string().min(1).max(120),
  subject: z.strictObject({
    uz: z.string().min(1).max(200),
    ru: z.string().min(1).max(200),
    en: z.string().min(1).max(200),
  }),
  room: z.string().min(1).max(200).nullable(),
  cancelled: z.boolean(),
  /** Nothing on the other side equals it, as the server paired the two (code review should-fix 7). */
  changed: z.boolean(),
});

export type WeekLesson = z.infer<typeof weekLessonSchema>;

/**
 * "One notice per person per event, with the week before and after"
 * (edge/timetable, After publishing): the number of the version, the Monday
 * of the week shown, and the teacher's lessons of the branch that week before
 * and after the event, sorted by date, start, class or group and subject.
 */
const teacherWeek = {
  weekStart: schoolDateSchema,
  before: z.array(weekLessonSchema).max(WEEK_LESSONS_MAX),
  after: z.array(weekLessonSchema).max(WEEK_LESSONS_MAX),
};

const weekChange = z.strictObject({ number: versionNumber, ...teacherWeek });

export const NOTIFICATION_KINDS = {
  'sample.message': z.strictObject({ text: z.string().min(1).max(500) }),
  /**
   * A relative linked to a student of the branch was renamed in another
   * branch (`edge/close-relatives`: "A change of name or phone is logged and
   * the other branch's Academic Vice Principal is told"; task 2.5b-1,
   * decision 5). The branch of the notification is the branch of the change.
   */
  'relative.renamed': z.strictObject({ previousName: relativeName, fullName: relativeName }),
  /** The main phone of such a relative was changed in another branch, or the number has a new owner; no phone in the data. */
  'relative.phone_changed': z.strictObject({ fullName: relativeName }),
  /**
   * Such a relative was merged with another record in another branch: the
   * names the two records had, and the name that stays.
   */
  'relative.merged': z.strictObject({
    keptName: relativeName,
    mergedName: relativeName,
    fullName: relativeName,
  }),
  /**
   * Another person took over the edit lock of a draft this account held, after
   * 5 minutes without activity (`edge/timetable`, Generator and editing: "the
   * earlier holder is told"; task 5.4c-1, decision 6): the draft's number and
   * the new holder's name.
   */
  'timetable.draft_taken_over': z.strictObject({
    number: versionNumber,
    name: relativeName,
  }),
  /**
   * A publish, with its replace and carries, changed this teacher's lessons in
   * the branch (`06`, How surprises are prevented, Everyone is told; task
   * 5.5c-3a, decisions 5 to 7): the new version's number and the week.
   */
  'timetable.published': weekChange,
  /** A withdraw changed them (task 5.5c-2a, decision 8): the withdrawn version's number and the week. */
  'timetable.withdrawn': weekChange,
  /**
   * A change of a class's Tutor moved this teacher's Tutor lessons in the
   * branch (task 5.5c-3b, decisions 1 to 5): the week only, no version is
   * published (3.6c-2 decision 6) and no class is named (one role end can
   * change several).
   */
  'timetable.tutor_changed': z.strictObject(teacherWeek),
  /**
   * A one-day change (a cancel, a restore, a room change or a move) changed this teacher's lessons in
   * the branch (task 5.6a-1, decision 10): the week only, no version.
   */
  'timetable.day_changed': z.strictObject({
    ...teacherWeek,
    /**
     * A move into another week changes two weeks of the teacher: the second
     * one, in the same notice (task 5.6a-2, decision 11; edge/timetable: "One
     * notice per person per event").
     */
    also: z.strictObject(teacherWeek).optional(),
  }),
  /**
   * A calendar entry saved over published dates changed this teacher's
   * lessons in the branch (task 5.6b-1, decision 8): the entry's name and
   * dates, and the week, with a second, later week as a one-day change shows
   * one.
   */
  'timetable.calendar_changed': z.strictObject({
    name: z.string().min(1).max(200),
    firstDate: schoolDateSchema,
    lastDate: schoolDateSchema,
    ...teacherWeek,
    also: z.strictObject(teacherWeek).optional(),
  }),
} as const satisfies Record<string, z.ZodType>;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

/** The kinds that carry a week before and after (task 5.5c-3a). */
export const WEEK_CHANGE_KINDS = ['timetable.published', 'timetable.withdrawn'] as const;

export type WeekChangeKind = (typeof WEEK_CHANGE_KINDS)[number];

/**
 * Every kind that carries a teacher's week before and after, which the web
 * shows under the text (task 5.5c-3b, spec review should-fix 5): the version
 * kinds, the Tutor change, a one-day change (task 5.6a-1) and a calendar
 * change (task 5.6b-1).
 */
export const WEEK_KINDS = [
  ...WEEK_CHANGE_KINDS,
  'timetable.tutor_changed',
  'timetable.day_changed',
  'timetable.calendar_changed',
] as const;

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
