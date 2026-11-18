import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import type { Language } from './language.js';

/**
 * Task 11.5 (pull request #299): the parents' digest (docs/spec/10-portal-notifications-release-2.md,
 * The parents' digest). The school's time of day and quiet hours, set by the Super Admin
 * (`school_settings` edit); the parent's frequency, chosen on the portal's Account page; the
 * send log, read by the Super Admin (`digest_log` view).
 */

/** `10`, Frequency: daily; twice a week, Wednesday and Saturday; once a week, Saturday. */
export const DIGEST_FREQUENCIES = ['daily', 'twice_weekly', 'weekly'] as const;
export const digestFrequencySchema = z.enum(DIGEST_FREQUENCIES);
export type DigestFrequency = z.infer<typeof digestFrequencySchema>;

/** "Until a parent chooses, twice a week." */
export const DEFAULT_DIGEST_FREQUENCY: DigestFrequency = 'twice_weekly';

/** The days of the week of each frequency, 0 Sunday to 6 Saturday. */
export const DIGEST_DAYS: Readonly<Record<DigestFrequency, readonly number[]>> = {
  daily: [0, 1, 2, 3, 4, 5, 6],
  twice_weekly: [3, 6],
  weekly: [6],
};

/** The school's time zone: `10`, "in the school's time zone (Tashkent)". */
export const DIGEST_TIME_ZONE = 'Asia/Tashkent';

/** A clock time `HH:MM`, 00:00 to 23:59. */
export const clockTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

/** Whether a clock time lies in the quiet hours `[from, until)`, which may cross midnight. */
export function inQuietHours(time: string, from: string, until: string): boolean {
  return from < until ? time >= from && time < until : time >= from || time < until;
}

/** `PUT /api/setup/school-settings/digest`. */
export const digestSettingsChangeSchema = z
  .strictObject({
    sendAt: clockTimeSchema,
    quietFrom: clockTimeSchema,
    quietUntil: clockTimeSchema,
  })
  .refine((value) => value.quietFrom !== value.quietUntil, {
    message: 'The quiet hours must start and end at different times.',
    path: ['quietUntil'],
  })
  .refine((value) => !inQuietHours(value.sendAt, value.quietFrom, value.quietUntil), {
    message: 'The digest time must lie outside the quiet hours.',
    path: ['sendAt'],
  });
export type DigestSettingsChange = z.infer<typeof digestSettingsChangeSchema>;

/** `GET` and the answer of `PUT /api/setup/school-settings/digest`. */
export const digestSettingsSchema = z.object({
  sendAt: clockTimeSchema,
  quietFrom: clockTimeSchema,
  quietUntil: clockTimeSchema,
});
export type DigestSettings = z.infer<typeof digestSettingsSchema>;

/** `PUT /api/auth/digest-frequency`. */
export const digestFrequencyChangeSchema = z.strictObject({ frequency: digestFrequencySchema });
export type DigestFrequencyChange = z.infer<typeof digestFrequencyChangeSchema>;

/** `GET` and the answer of `PUT /api/auth/digest-frequency`. */
export const digestFrequencyAnswerSchema = z.object({
  frequency: digestFrequencySchema,
  /** `false` while the parent has not chosen: twice a week. */
  chosen: z.boolean(),
});
export type DigestFrequencyAnswer = z.infer<typeof digestFrequencyAnswerSchema>;

/** What became of a digest (`digests.status`). */
export const DIGEST_STATUSES = [
  'due',
  'nothing',
  'delivered',
  'blocked',
  'failed',
  'no_chat',
] as const;
export const digestStatusSchema = z.enum(DIGEST_STATUSES);
export type DigestStatus = z.infer<typeof digestStatusSchema>;

/** `GET /api/digest-log`: a span of dates, a status, a page. */
export const digestLogQuerySchema = z.strictObject({
  from: schoolDateSchema.optional(),
  to: schoolDateSchema.optional(),
  status: digestStatusSchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type DigestLogQuery = z.infer<typeof digestLogQuerySchema>;

export const DIGEST_LOG_PAGE = 500;

export const digestLogRowSchema = z.object({
  id: z.uuid(),
  digestDate: schoolDateSchema,
  /** The parent: the relative's full name and the login. */
  parentName: z.string(),
  login: z.string(),
  /** The children of the message when delivered; otherwise those the digest was for. */
  children: z.array(z.object({ firstName: z.string(), className: z.string().nullable() })),
  status: digestStatusSchema,
  attempts: z.int().min(0),
  dueAt: z.iso.datetime({ offset: true }),
  sentAt: z.iso.datetime({ offset: true }).nullable(),
});
export type DigestLogRow = z.infer<typeof digestLogRowSchema>;

export const digestLogSchema = z.object({
  rows: z.array(digestLogRowSchema),
  total: z.int().min(0),
  page: z.int().min(1),
  pageSize: z.int().min(1),
});
export type DigestLog = z.infer<typeof digestLogSchema>;

/**
 * The texts of the digest message (`10`, Language: "Messages come from templates in the three
 * languages"), in the parent's language. A child is named by first name and class only.
 *
 * The message is sent as Telegram HTML: the builder (`digest-message.ts` of the API) adds the bold
 * headings and escapes every value, so no text here holds markup.
 */
export interface DigestTexts {
  /** The first line: the school. */
  title: string;
  /** The second line: the date of the digest and what it covers. */
  subtitle: (date: string, first: boolean) => string;
  attendedAllOnTime: (lessons: number) => string;
  attendedAllLate: (lessons: number, late: number) => string;
  attendedSome: (attended: number, lessons: number) => string;
  notYetEntered: (lessons: number) => string;
  noLessons: string;
  attendanceHeading: string;
  gradesHeading: string;
  commentsHeading: string;
  absent: string;
  skipped: string;
  late: string;
  present: string;
  classwork: (position: number) => string;
  homework: (position: number) => string;
  ratingExam: string;
  corrected: string;
  removed: string;
  commentRemoved: string;
  /** A lesson date in a list: `day` 1 to 31, `month` 0 to 11. */
  shortDate: (day: number, month: number) => string;
  /** The date of the digest in the subtitle. */
  longDate: (day: number, month: number) => string;
  openPortal: string;
}

/** Russian plural forms: one (1, 21), few (2 to 4, 22), many (5 to 20, 25). */
function ruPlural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;
  return many;
}

const uzShort = [
  'yan',
  'fev',
  'mar',
  'apr',
  'may',
  'iyn',
  'iyl',
  'avg',
  'sen',
  'okt',
  'noy',
  'dek',
];
const uzLong = [
  'yanvar',
  'fevral',
  'mart',
  'aprel',
  'may',
  'iyun',
  'iyul',
  'avgust',
  'sentabr',
  'oktabr',
  'noyabr',
  'dekabr',
];

const uz: DigestTexts = {
  title: 'Sodiq maktabi',
  subtitle: (date, first) =>
    `Xabarnoma, ${date} · ${first ? 'Telegram ulanganidan beri' : 'oldingi xabarnomadan beri'}`,
  attendedAllOnTime: (lessons) =>
    lessons === 1
      ? 'Darsga oʻz vaqtida keldi.'
      : `Barcha ${String(lessons)} ta darsga oʻz vaqtida keldi.`,
  attendedAllLate: (lessons, late) =>
    lessons === 1
      ? 'Darsga keldi, lekin kechikdi.'
      : `Barcha ${String(lessons)} ta darsga keldi, ${String(late)} tasiga kechikdi.`,
  attendedSome: (attended, lessons) =>
    attended === 0
      ? lessons === 1
        ? 'Darsga kelmadi.'
        : `${String(lessons)} ta darsning hech biriga kelmadi.`
      : `${String(lessons)} ta darsdan ${String(attended)} tasiga keldi.`,
  notYetEntered: (lessons) => `${String(lessons)} ta dars boʻldi, davomat hali kiritilmagan.`,
  noLessons: 'Bu davrda dars boʻlmadi.',
  attendanceHeading: 'Davomat',
  gradesHeading: 'Baholar',
  commentsHeading: 'Oʻqituvchi izohlari',
  absent: 'kelmagan',
  skipped: 'maktabda boʻlgan, lekin darsga kirmagan',
  late: 'kechikkan',
  present: 'kelgan',
  classwork: (position) => `Sinf ishi ${String(position)}`,
  homework: (position) => `Uy vazifasi ${String(position)}`,
  ratingExam: 'Reyting imtihoni',
  corrected: 'tuzatildi',
  removed: 'oʻchirildi',
  commentRemoved: 'izoh oʻchirildi',
  shortDate: (day, month) => `${String(day)}-${uzShort[month] ?? ''}`,
  longDate: (day, month) => `${String(day)}-${uzLong[month] ?? ''}`,
  openPortal: 'Portalni ochish',
};

const ruShort = [
  'янв.',
  'фев.',
  'мар.',
  'апр.',
  'мая',
  'июн.',
  'июл.',
  'авг.',
  'сен.',
  'окт.',
  'нояб.',
  'дек.',
];
const ruLong = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];
const ruLessons = (count: number): string => ruPlural(count, 'урок', 'урока', 'уроков');

const ru: DigestTexts = {
  title: 'Школа Sodiq',
  subtitle: (date, first) =>
    `Сводка на ${date} · ${first ? 'с момента подключения Telegram' : 'с прошлой сводки'}`,
  attendedAllOnTime: (lessons) =>
    lessons === 1
      ? 'Урок посещён, без опоздания.'
      : `Посещены все ${String(lessons)} ${ruLessons(lessons)}, без опозданий.`,
  attendedAllLate: (lessons, late) =>
    lessons === 1
      ? 'Урок посещён, с опозданием.'
      : `Посещены все ${String(lessons)} ${ruLessons(lessons)}, опозданий: ${String(late)}.`,
  attendedSome: (attended, lessons) =>
    attended === 0
      ? lessons === 1
        ? 'Урок пропущен.'
        : `Пропущены все ${String(lessons)} ${ruLessons(lessons)}.`
      : `Посещено ${String(attended)} из ${String(lessons)} ${ruPlural(lessons, 'урока', 'уроков', 'уроков')}.`,
  notYetEntered: (lessons) => `Проведено уроков: ${String(lessons)}, посещаемость ещё не внесена.`,
  noLessons: 'В этот период уроков не было.',
  attendanceHeading: 'Посещаемость',
  gradesHeading: 'Оценки',
  commentsHeading: 'Комментарии учителей',
  absent: 'отсутствие',
  skipped: 'был(а) в школе, но не на уроке',
  late: 'опоздание',
  present: 'присутствие',
  classwork: (position) => `Классная работа ${String(position)}`,
  homework: (position) => `Домашняя работа ${String(position)}`,
  ratingExam: 'Рейтинговый экзамен',
  corrected: 'исправлено',
  removed: 'удалено',
  commentRemoved: 'комментарий удалён',
  shortDate: (day, month) => `${String(day)} ${ruShort[month] ?? ''}`,
  longDate: (day, month) => `${String(day)} ${ruLong[month] ?? ''}`,
  openPortal: 'Открыть портал',
};

const enShort = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const enLong = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const enLessons = (count: number): string => (count === 1 ? 'lesson' : 'lessons');

const en: DigestTexts = {
  title: 'Sodiq School',
  subtitle: (date, first) =>
    `Digest of ${date} · ${first ? 'since Telegram was connected' : 'since the previous digest'}`,
  attendedAllOnTime: (lessons) =>
    lessons === 1
      ? 'Attended the lesson on time.'
      : `Attended all ${String(lessons)} lessons on time.`,
  attendedAllLate: (lessons, late) =>
    lessons === 1
      ? 'Attended the lesson, but was late.'
      : `Attended all ${String(lessons)} lessons; late for ${String(late)}.`,
  attendedSome: (attended, lessons) =>
    attended === 0
      ? lessons === 1
        ? 'Missed the lesson.'
        : `Missed all ${String(lessons)} lessons.`
      : `Attended ${String(attended)} of ${String(lessons)} ${enLessons(lessons)}.`,
  notYetEntered: (lessons) =>
    `${String(lessons)} ${enLessons(lessons)} held; attendance not entered yet.`,
  noLessons: 'No lessons in this period.',
  attendanceHeading: 'Attendance',
  gradesHeading: 'Grades',
  commentsHeading: 'Teachers’ comments',
  absent: 'absent',
  skipped: 'at school but missed the lesson',
  late: 'late',
  present: 'present',
  classwork: (position) => `Classwork ${String(position)}`,
  homework: (position) => `Homework ${String(position)}`,
  ratingExam: 'Rating exam',
  corrected: 'corrected',
  removed: 'removed',
  commentRemoved: 'comment removed',
  shortDate: (day, month) => `${String(day)} ${enShort[month] ?? ''}`,
  longDate: (day, month) => `${String(day)} ${enLong[month] ?? ''}`,
  openPortal: 'Open the portal',
};

export const DIGEST_TEXTS: Readonly<Record<Language, DigestTexts>> = { uz, ru, en };
