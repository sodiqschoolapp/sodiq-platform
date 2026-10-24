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

/**
 * Task 5.6c-3a (decision 7): the exams a publish or a withdraw cancelled by a
 * "needs a decision" choice that this person invigilated or whose lessons
 * they gave back, in the event's own notice (one notice per person per
 * event). A person whose week did not change gets the notice with these
 * alone, and no week.
 */
const examsCancelled = z
  .array(z.strictObject({ title: z.string().min(1).max(200), date: schoolDateSchema }))
  .min(1)
  .max(50);

const weekChange = z.union([
  z.strictObject({
    number: versionNumber,
    ...teacherWeek,
    examsCancelled: examsCancelled.optional(),
  }),
  z.strictObject({ number: versionNumber, examsCancelled }),
]);

/**
 * Task 5.6c-3b (decision 3): the exams a calendar or template change moved
 * with their slots or cancelled for a day off that this person invigilates,
 * in the event's own notice (one notice per person per event): the title,
 * the date and, for a moved one, the person's invigilation after the save.
 * A person whose week did not change gets the notice with these alone.
 */
const examsChanged = z
  .array(
    z.strictObject({
      title: z.string().min(1).max(200),
      date: schoolDateSchema,
      action: z.enum(['moved', 'cancelled']),
      invigilation: z
        .strictObject({ start: clockTime, end: clockTime, room: z.string().min(1).max(200) })
        .nullable(),
    }),
  )
  .min(1)
  .max(50);

const calendarEntry = {
  name: z.string().min(1).max(200),
  firstDate: schoolDateSchema,
  lastDate: schoolDateSchema,
};

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
   * A vacancy fill carried into a published version that starts on its date
   * changed this teacher's lessons (task 5.7a-3a, decision 4): that
   * version's number and the week. A fill that publishes a version sends
   * `timetable.published`.
   */
  'timetable.vacancy_filled': weekChange,
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
   * This teacher was made the substitute of a lesson (task 5.7b-1, decision
   * 7; `10`: "Substitution assigned | The substitute teacher | In the app"):
   * the lesson's date and the week, in place of `timetable.day_changed`
   * (one notice per person per event).
   */
  'timetable.substitution_assigned': z.strictObject({
    date: schoolDateSchema,
    ...teacherWeek,
    also: z.strictObject(teacherWeek).optional(),
  }),
  /**
   * This teacher was made the substitute of a journal's lessons for a period
   * (task 5.7b-2, decision 8): the first and last date, with the first
   * week changed, in place of
   * `timetable.day_changed` (one notice per person per event).
   */
  'timetable.substitutions_assigned': z.strictObject({
    firstDate: schoolDateSchema,
    lastDate: schoolDateSchema,
    ...teacherWeek,
    also: z.strictObject(teacherWeek).optional(),
  }),
  /**
   * A calendar entry saved over published dates changed this teacher's
   * lessons in the branch (task 5.6b-1, decision 8): the entry's name and
   * dates, and the week, with a second, later week as a one-day change shows
   * one.
   */
  'timetable.calendar_changed': z.union([
    z.strictObject({
      ...calendarEntry,
      ...teacherWeek,
      also: z.strictObject(teacherWeek).optional(),
      exams: examsChanged.optional(),
    }),
    z.strictObject({ ...calendarEntry, exams: examsChanged }),
  ]),
  /**
   * A change of the day templates from a date (a slot length, a template's
   * version, a template set or a setting ended) changed this teacher's
   * lessons in the branch (task 5.6b-4a, decision 6): the change's date and
   * the week, with a second, later week as a calendar change shows one.
   */
  'timetable.template_changed': z.union([
    z.strictObject({
      from: schoolDateSchema,
      ...teacherWeek,
      also: z.strictObject(teacherWeek).optional(),
      exams: examsChanged.optional(),
    }),
    z.strictObject({ from: schoolDateSchema, exams: examsChanged }),
  ]),
  /**
   * A save of a year's quarters added or removed this teacher's lessons in
   * the branch (task 5.6b-5a, decision 9): the first and last lesson date it
   * wrote again, and the week, with a second, later week as a calendar
   * change shows one.
   */
  'timetable.quarters_changed': z.strictObject({
    firstDate: schoolDateSchema,
    lastDate: schoolDateSchema,
    ...teacherWeek,
    also: z.strictObject(teacherWeek).optional(),
  }),
  /**
   * An absence of a person was entered, changed or withdrawn (task 5.7a-1,
   * decision 8; `06`, Teachers who work in several branches: "Each branch's
   * Academic Vice Principal gets the list of own affected lessons and arranges
   * substitutes; the other is told"): the person's name and the absence's
   * days after the change (the days before it for a withdraw). One kind per
   * text, an open end apart (the text is not chosen by the data). Sent to the
   * current Academic Vice Principals of every branch of the person, the
   * author left out, labelled with the branch of the request.
   */
  'timetable.absence_entered': z.strictObject({
    name: z.string().min(1).max(200),
    startsOn: schoolDateSchema,
    endsOn: schoolDateSchema,
  }),
  'timetable.absence_entered_open': z.strictObject({
    name: z.string().min(1).max(200),
    startsOn: schoolDateSchema,
  }),
  'timetable.absence_changed': z.strictObject({
    name: z.string().min(1).max(200),
    startsOn: schoolDateSchema,
    endsOn: schoolDateSchema,
  }),
  'timetable.absence_changed_open': z.strictObject({
    name: z.string().min(1).max(200),
    startsOn: schoolDateSchema,
  }),
  'timetable.absence_withdrawn': z.strictObject({
    name: z.string().min(1).max(200),
    startsOn: schoolDateSchema,
  }),
  /**
   * A calendar entry made the date of an exam a day off, and the exam is
   * cancelled (`edge/timetable`, Exams: "a day off removes the exam and tells
   * the Academic Vice Principal"; task 5.6b-2c-1, decision 4): the entry's
   * name, the exam's title and its date. Sent to every Academic Vice
   * Principal of the branch.
   */
  'timetable.exam_day_off': z.strictObject({
    name: z.string().min(1).max(200),
    title: z.string().min(1).max(200),
    date: schoolDateSchema,
  }),
  /**
   * An exam was created, changed or cancelled (task 5.6c-1, decision 2;
   * `06`, Exam: "the affected staff are notified as for a one-day change";
   * edge/timetable: "One notice per person per event"): its title and date,
   * the person's own invigilation after the save (`null`: none), and, when
   * the person's lessons changed, the week before and after with a second,
   * later week as a one-day change shows one.
   */
  'timetable.exam_changed': z.strictObject({
    action: z.enum(['created', 'changed', 'cancelled']),
    title: z.string().min(1).max(200),
    date: schoolDateSchema,
    invigilation: z
      .strictObject({ start: clockTime, end: clockTime, room: z.string().min(1).max(200) })
      .nullable(),
    weekStart: teacherWeek.weekStart.optional(),
    before: teacherWeek.before.optional(),
    after: teacherWeek.after.optional(),
    also: z.strictObject(teacherWeek).optional(),
  }),
  /**
   * The Super Admin deleted a lesson for good, or restored one (task 5.8b;
   * edge/people-roles-accounts: "A Super Admin force-deletes a lesson with
   * marks. ... It notifies the branch's Academic Vice Principal, the
   * Principal and the teacher."): the class or group, the date and the start
   * of the lesson in branch time.
   */
  'timetable.lesson_force_deleted': z.strictObject({
    unit: z.string().min(1).max(120),
    date: schoolDateSchema,
    start: clockTime,
  }),
  'timetable.lesson_restored': z.strictObject({
    unit: z.string().min(1).max(120),
    date: schoolDateSchema,
    start: clockTime,
  }),
  /**
   * Task 7.1b (decision 8 as changed on pull request #213): a change of the
   * timetable moved items of the owner's plans or prepared an edit request
   * for them (`edge/lesson-plans`: "One notice per teacher per event, listing
   * their plans"): the classes or groups of the plans, how many moved and how
   * many got a request.
   */
  'plans.followed': z.strictObject({
    /** The classes and groups whose plan got an edit request, joined with commas; a dash for none. */
    requested: z.string().min(1).max(4000),
    /** Those whose items only moved; a dash for none. */
    moved: z.string().min(1).max(4000),
  }),
  /** The same event for a Head Teacher of the subject: "one per Head Teacher with counts". */
  'plans.followed_counts': z.strictObject({
    plans: z.int().min(1),
    requests: z.int().min(0),
  }),
  /**
   * Task 7.2: `09`, The plan window: "Teachers are reminded when the window
   * opens"; sent once at the opening to each owner of a plan of the quarter,
   * and when its dates move.
   */
  'plans.window_opened': z.strictObject({
    quarter: z.int().min(1).max(4),
    startDate: schoolDateSchema,
    endDate: schoolDateSchema,
  }),
  'plans.window_changed': z.strictObject({
    quarter: z.int().min(1).max(4),
    startDate: schoolDateSchema,
    endDate: schoolDateSchema,
  }),
  /** `09`: "extend the window for one teacher". */
  'plans.window_extended': z.strictObject({
    quarter: z.int().min(1).max(4),
    endDate: schoolDateSchema,
  }),
  /** A request sent, to the first tier of its deciders (review correction 5). */
  'plans.request_sent': z.strictObject({
    name: z.string().min(1).max(200),
    unit: z.string().min(1).max(120),
    quarter: z.int().min(1).max(4),
  }),
  /** The decision, to the plan's owner. */
  'plans.request_approved': z.strictObject({
    /** The classes and groups, joined with commas (one notice per teacher per event). */
    unit: z.string().min(1).max(4000),
    quarter: z.int().min(1).max(4),
    until: schoolDateSchema,
  }),
  'plans.request_refused': z.strictObject({
    unit: z.string().min(1).max(120),
    quarter: z.int().min(1).max(4),
    reason: z.string().min(1).max(1000),
  }),
  /**
   * Task 8.4 (`10`, "Lesson unlock requested or granted"; review correction 3):
   * a request sent, to the first tier of its deciders; `date` is the lesson's,
   * or the rating exam's.
   */
  'journal.unlock_requested': z.strictObject({
    name: z.string().min(1).max(200),
    unit: z.string().min(1).max(120),
    date: schoolDateSchema,
  }),
  /** The approval, to the requester: open through `until`, branch time. */
  'journal.unlock_approved': z.strictObject({
    unit: z.string().min(1).max(120),
    date: schoolDateSchema,
    until: schoolDateSchema,
  }),
  /** The refusal, to the requester; `reason` is empty when the decider gave none. */
  'journal.unlock_refused': z.strictObject({
    unit: z.string().min(1).max(120),
    date: schoolDateSchema,
    reason: z.string().max(500),
  }),
  /**
   * A correction (`edge/journal`: "notifies the teacher with the old and new
   * value"): one notice per value corrected, to the lesson's teacher and the
   * journal's teacher on the date; an empty value is `—`.
   */
  'journal.correction': z.strictObject({
    unit: z.string().min(1).max(120),
    date: schoolDateSchema,
    student: z.string().min(1).max(200),
    before: z.string().min(1).max(20),
    after: z.string().min(1).max(20),
    reason: z.string().min(1).max(500),
  }),
  /** A corrected total of a work, with its old and new value. */
  'journal.correction_total': z.strictObject({
    unit: z.string().min(1).max(120),
    date: schoolDateSchema,
    before: z.string().min(1).max(20),
    after: z.string().min(1).max(20),
    reason: z.string().min(1).max(500),
  }),
  /** A work added, removed, carried or marked "not held", or a comment, corrected. */
  'journal.correction_lesson': z.strictObject({
    unit: z.string().min(1).max(120),
    date: schoolDateSchema,
    reason: z.string().min(1).max(500),
  }),
  /**
   * Task 8.5 (`edge/exemptions`: "The Tutor and the teachers of the affected
   * lessons are told the kind, dates and slots, without the reason"): an
   * exemption granted, to the student's Tutor and the teachers of its lessons.
   */
  'journal.exemption_granted': z.strictObject({
    student: z.string().min(1).max(200),
    kind: z.enum(['temporary', 'full']),
    from: schoolDateSchema,
    until: schoolDateSchema,
    /** `HH:MM–HH:MM` of a slot exemption, empty for whole days. */
    times: z.string().max(11),
  }),
  /** An exemption edited, ended from a date or voided, to the same people. */
  'journal.exemption_changed': z.strictObject({
    student: z.string().min(1).max(200),
    change: z.enum(['edited', 'ended', 'voided']),
    kind: z.enum(['temporary', 'full']),
    from: schoolDateSchema,
    until: schoolDateSchema,
    /** `HH:MM–HH:MM` of a slot exemption, empty for whole days. */
    times: z.string().max(11),
  }),
  /**
   * `edge/journal`, Locks: "The teacher gets one notice, 'reopened after
   * exemption'": one per teacher and change, with the lessons' count.
   */
  'journal.exemption_reopened': z.strictObject({
    // The students of the teacher's reopened lessons, by name: one notice per teacher and change.
    students: z.string().min(1).max(4000),
    lessons: z.int().min(1),
  }),
  /**
   * A kept block exempts the students of the classes left out (From 5.6a-3):
   * to the Tutors of those classes and the teachers of the kept lessons.
   */
  'journal.exemption_kept_block': z.strictObject({
    unit: z.string().min(1).max(4000),
    date: schoolDateSchema,
    start: clockTime,
    classes: z.string().min(1).max(4000),
  }),
  /** A branch move offers an exemption, to the receiving branch's Academic Vice Principal (decision 3). */
  'journal.exemption_offer': z.strictObject({
    student: z.string().min(1).max(200),
    from: schoolDateSchema,
    until: schoolDateSchema,
  }),
} as const satisfies Record<string, z.ZodType>;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

/** The kinds that carry a week before and after (task 5.5c-3a). */
export const WEEK_CHANGE_KINDS = [
  'timetable.published',
  'timetable.withdrawn',
  'timetable.vacancy_filled',
] as const;

export type WeekChangeKind = (typeof WEEK_CHANGE_KINDS)[number];

/**
 * Every kind that carries a teacher's week before and after, which the web
 * shows under the text (task 5.5c-3b, spec review should-fix 5): the version
 * kinds, the Tutor change, a one-day change (task 5.6a-1), a calendar
 * change (task 5.6b-1), a template change (task 5.6b-4a), a quarter change
 * (task 5.6b-5a) and an exam (task 5.6c-1, whose week is there only when the
 * person's lessons changed).
 */
export const WEEK_KINDS = [
  ...WEEK_CHANGE_KINDS,
  'timetable.tutor_changed',
  'timetable.day_changed',
  'timetable.substitution_assigned',
  'timetable.calendar_changed',
  'timetable.template_changed',
  'timetable.quarters_changed',
  'timetable.exam_changed',
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
