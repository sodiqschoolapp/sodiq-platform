import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { clockTimeSchema } from './digest.js';

/**
 * Announcements and events (task 11.7, pull request #306; `11`, Announcements and events: "News
 * and events for chosen audiences, with a calendar"). The bounds are those of the checks of
 * migration 0163 (a test compares them).
 */

export const ANNOUNCEMENT_TITLE_MAX_LENGTH = 120;
/** Plan decision 12: well under the 4096 characters of a Telegram message. */
export const ANNOUNCEMENT_BODY_MAX_LENGTH = 2000;
export const ANNOUNCEMENT_PLACE_MAX_LENGTH = 120;
/** Grade 0 since task 9.4d. */
export const ANNOUNCEMENT_GRADES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
/** The most classes one announcement names. */
export const ANNOUNCEMENT_CLASSES_MAX = 60;

export const ANNOUNCEMENT_KINDS = ['news', 'event'] as const;
export const announcementKindSchema = z.enum(ANNOUNCEMENT_KINDS);
export type AnnouncementKind = z.infer<typeof announcementKindSchema>;

/** Where: the whole school (Super Admin only), the branch, grades of it, classes of it. */
export const ANNOUNCEMENT_AUDIENCES = ['school', 'branch', 'grades', 'classes'] as const;
export const announcementAudienceKindSchema = z.enum(ANNOUNCEMENT_AUDIENCES);
export type AnnouncementAudienceKind = z.infer<typeof announcementAudienceKindSchema>;

const titleSchema = z.string().trim().min(1).max(ANNOUNCEMENT_TITLE_MAX_LENGTH);
const bodySchema = z.string().trim().min(1).max(ANNOUNCEMENT_BODY_MAX_LENGTH);
const placeSchema = z.string().trim().min(1).max(ANNOUNCEMENT_PLACE_MAX_LENGTH);
const gradeSchema = z.number().int().min(0).max(11);

/** The audience of a new announcement: fixed once saved (plan decision 5). */
export const announcementAudienceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('school') }),
  z.strictObject({ kind: z.literal('branch') }),
  z.strictObject({
    kind: z.literal('grades'),
    grades: z
      .array(gradeSchema)
      .min(1)
      .max(ANNOUNCEMENT_GRADES.length)
      .refine((grades) => new Set(grades).size === grades.length, 'Each grade once.'),
  }),
  z.strictObject({
    kind: z.literal('classes'),
    classIds: z
      .array(z.uuid())
      .min(1)
      .max(ANNOUNCEMENT_CLASSES_MAX)
      .refine(
        (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
        'Each class once.',
      ),
  }),
]);
export type AnnouncementAudience = z.infer<typeof announcementAudienceSchema>;

/** An event's dates, optional clock times of the branch's time zone, and an optional place. */
export const announcementEventSchema = z
  .strictObject({
    firstDate: schoolDateSchema,
    lastDate: schoolDateSchema,
    startsAt: clockTimeSchema.nullable(),
    endsAt: clockTimeSchema.nullable(),
    place: placeSchema.nullable(),
  })
  .refine((event) => event.lastDate >= event.firstDate, {
    message: 'The last date is not before the first.',
    path: ['lastDate'],
  })
  .refine((event) => event.endsAt === null || event.startsAt !== null, {
    message: 'An end time needs a start time.',
    path: ['startsAt'],
  })
  .refine(
    (event) => event.endsAt === null || event.startsAt === null || event.endsAt > event.startsAt,
    { message: 'The end time is after the start time.', path: ['endsAt'] },
  );
export type AnnouncementEvent = z.infer<typeof announcementEventSchema>;

/** The text and the event part, what an edit may change. */
const contentShape = {
  title: titleSchema,
  body: bodySchema,
  event: announcementEventSchema.nullable(),
};

/** A new announcement: news has no event part, an event has one. */
export const announcementRecordSchema = z
  .strictObject({
    kind: announcementKindSchema,
    ...contentShape,
    audience: announcementAudienceSchema,
    forStaff: z.boolean(),
    forParents: z.boolean(),
  })
  .refine((record) => record.forStaff || record.forParents, {
    message: 'Staff, parents or both.',
    path: ['forParents'],
  })
  .refine((record) => (record.kind === 'event') === (record.event !== null), {
    message: 'An event has dates; news has none.',
    path: ['event'],
  });
export type AnnouncementRecord = z.infer<typeof announcementRecordSchema>;

/** An edit: the text and the event part, with the version read (plan decision 5). */
export const announcementEditSchema = z.strictObject({
  ...contentShape,
  version: z.number().int().min(1),
});
export type AnnouncementEdit = z.infer<typeof announcementEditSchema>;

/** Archive and restore send the version read. */
export const announcementVersionSchema = z.strictObject({ version: z.number().int().min(1) });
export type AnnouncementVersion = z.infer<typeof announcementVersionSchema>;

export const announcementParamsSchema = z.strictObject({ id: z.uuid() });
export type AnnouncementParams = z.infer<typeof announcementParamsSchema>;

/** A month, `YYYY-MM`. */
export const monthSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);

export const announcementsQuerySchema = z.strictObject({
  archived: z.enum(['true', 'false']).optional(),
});
export type AnnouncementsQuery = z.infer<typeof announcementsQuerySchema>;

/** The addressed list and the portal: the month shown (this month when none). */
export const announcementsMonthQuerySchema = z.strictObject({ month: monthSchema.optional() });
export type AnnouncementsMonthQuery = z.infer<typeof announcementsMonthQuerySchema>;

/** The audience as read: classes with their names. */
export const announcementAudienceReadSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('school') }),
  z.strictObject({ kind: z.literal('branch') }),
  z.strictObject({ kind: z.literal('grades'), grades: z.array(gradeSchema) }),
  z.strictObject({
    kind: z.literal('classes'),
    classes: z.array(z.strictObject({ id: z.uuid(), name: z.string() })),
  }),
]);

/** What a reader sees of an announcement (staff feed and portal alike). */
export const announcementViewSchema = z.strictObject({
  id: z.uuid(),
  kind: announcementKindSchema,
  title: z.string(),
  body: z.string(),
  event: z
    .strictObject({
      firstDate: schoolDateSchema,
      lastDate: schoolDateSchema,
      startsAt: clockTimeSchema.nullable(),
      endsAt: clockTimeSchema.nullable(),
      place: z.string().nullable(),
    })
    .nullable(),
  schoolWide: z.boolean(),
  publishedAt: z.iso.datetime({ offset: true }),
  editedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type AnnouncementView = z.infer<typeof announcementViewSchema>;

/** The states of one bot message of an announcement (`announcement_deliveries`, 0163). */
export const ANNOUNCEMENT_DELIVERY_STATUSES = [
  'due',
  'delivered',
  'blocked',
  'no_chat',
  'out_of_scope',
  'withdrawn',
  'failed',
] as const;
export const announcementDeliveryStatusSchema = z.enum(ANNOUNCEMENT_DELIVERY_STATUSES);

/** The counts of the bot's messages of an announcement. */
export const announcementDeliveryCountsSchema = z.strictObject({
  due: z.number().int().min(0),
  delivered: z.number().int().min(0),
  notDelivered: z.number().int().min(0),
});

/** A row of the authors' list. */
export const announcementSchema = announcementViewSchema.extend({
  audience: announcementAudienceReadSchema,
  forStaff: z.boolean(),
  forParents: z.boolean(),
  version: z.number().int().min(1),
  archived: z.boolean(),
  /** Whether this author may edit, archive or restore it (a school-wide one: the Super Admin). */
  canChange: z.boolean(),
  deliveries: announcementDeliveryCountsSchema,
});
export type Announcement = z.infer<typeof announcementSchema>;

export const announcementListSchema = z.strictObject({
  announcements: z.array(announcementSchema),
  /** Whether a whole-school audience is offered (the Super Admin). */
  mayWriteSchool: z.boolean(),
});
export type AnnouncementList = z.infer<typeof announcementListSchema>;

/** The month of the addressed list and the portal: news of the month and events touching it. */
export const announcementMonthSchema = z.strictObject({
  month: monthSchema,
  /** Today in the branch (staff) or the child's branch (portal), for the calendar. */
  today: schoolDateSchema,
  announcements: z.array(announcementViewSchema),
});
export type AnnouncementMonth = z.infer<typeof announcementMonthSchema>;

/** The first and the last date of a month `YYYY-MM`. */
export function monthDates(month: string): { first: string; last: string } {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(last).padStart(2, '0')}` };
}

/**
 * The frame of the bot's message of an announcement (`10`, Language: "Messages come from
 * templates in the three languages"; plan decision 8): the author's title and body are sent as
 * typed, in plain text (no parse mode).
 */
export interface AnnouncementTexts {
  /** The first line of a news item. */
  news: string;
  /** The first line of an event. */
  event: string;
  /** "When: …" */
  when: string;
  /** "Where: …" */
  where: string;
}

export const ANNOUNCEMENT_TEXTS = {
  uz: {
    news: 'Sodiq maktabi: eʼlon',
    event: 'Sodiq maktabi: tadbir',
    when: 'Qachon',
    where: 'Qayerda',
  },
  ru: {
    news: 'Школа Sodiq: объявление',
    event: 'Школа Sodiq: мероприятие',
    when: 'Когда',
    where: 'Где',
  },
  en: {
    news: 'Sodiq School: announcement',
    event: 'Sodiq School: event',
    when: 'When',
    where: 'Where',
  },
} as const satisfies Readonly<Record<'uz' | 'ru' | 'en', AnnouncementTexts>>;

/** The page of the portal the bot's button opens after the mini app's sign-in (`?to=`). */
export const MINI_APP_TARGETS = ['announcements'] as const;

/**
 * The form of an announcement, flat so that each refusal names its own field (the web's record
 * form reads the first part of an issue's path). `announcementRecordOf` and `announcementEditOf`
 * give the bodies the routes take; the server checks them again with the schemas above.
 */
export const announcementFormSchema = z
  .strictObject({
    kind: announcementKindSchema,
    title: titleSchema,
    body: bodySchema,
    audience: announcementAudienceKindSchema,
    grades: z.array(gradeSchema).max(ANNOUNCEMENT_GRADES.length),
    classIds: z.array(z.uuid()).max(ANNOUNCEMENT_CLASSES_MAX),
    forStaff: z.boolean(),
    forParents: z.boolean(),
    firstDate: schoolDateSchema.nullable(),
    lastDate: schoolDateSchema.nullable(),
    startsAt: clockTimeSchema.nullable(),
    endsAt: clockTimeSchema.nullable(),
    place: placeSchema.nullable(),
  })
  .superRefine((form, context) => {
    const issue = (path: string, message: string) => {
      context.addIssue({ code: 'custom', path: [path], message });
    };
    if (form.audience === 'grades' && form.grades.length === 0) issue('grades', 'Choose a grade.');
    if (form.audience === 'classes' && form.classIds.length === 0) {
      issue('classIds', 'Choose a class.');
    }
    if (!form.forStaff && !form.forParents) issue('forParents', 'Staff, parents or both.');
    if (form.kind === 'event') {
      if (form.firstDate === null) issue('firstDate', 'An event has dates.');
      if (form.lastDate === null) issue('lastDate', 'An event has dates.');
      if (form.firstDate !== null && form.lastDate !== null && form.lastDate < form.firstDate) {
        issue('lastDate', 'The last date is not before the first.');
      }
      if (form.endsAt !== null && form.startsAt === null) {
        issue('startsAt', 'An end time needs a start time.');
      }
      if (form.endsAt !== null && form.startsAt !== null && form.endsAt <= form.startsAt) {
        issue('endsAt', 'The end time is after the start time.');
      }
    }
  });
export type AnnouncementForm = z.infer<typeof announcementFormSchema>;

const eventOf = (form: AnnouncementForm): AnnouncementEvent | null =>
  form.kind === 'event' && form.firstDate !== null && form.lastDate !== null
    ? {
        firstDate: form.firstDate,
        lastDate: form.lastDate,
        startsAt: form.startsAt,
        endsAt: form.startsAt === null ? null : form.endsAt,
        place: form.place,
      }
    : null;

export function announcementRecordOf(form: AnnouncementForm): AnnouncementRecord {
  const audience: AnnouncementAudience =
    form.audience === 'grades'
      ? { kind: 'grades', grades: form.grades }
      : form.audience === 'classes'
        ? { kind: 'classes', classIds: form.classIds }
        : { kind: form.audience };
  return {
    kind: form.kind,
    title: form.title,
    body: form.body,
    event: eventOf(form),
    audience,
    forStaff: form.forStaff,
    forParents: form.forParents,
  };
}

export function announcementEditOf(form: AnnouncementForm, version: number): AnnouncementEdit {
  return { title: form.title, body: form.body, event: eventOf(form), version };
}
