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
  /** The children named, first name and class as sent; empty unless delivered. */
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
 */
export interface DigestTexts {
  title: (date: string) => string;
  attendedAllOnTime: (lessons: number) => string;
  attendedAllLate: (lessons: number, late: number) => string;
  attendedSome: (attended: number, lessons: number) => string;
  notYetEntered: (lessons: number) => string;
  noLessons: string;
  absencesHeading: string;
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
  months: readonly string[];
  openPortal: string;
}

const uz: DigestTexts = {
  title: (date) => `Sodiq maktabi: ${date} holatiga koʻra xabarnoma`,
  attendedAllOnTime: (lessons) =>
    `Davomat: barcha ${String(lessons)} ta darsga oʻz vaqtida kelgan.`,
  attendedAllLate: (lessons, late) =>
    `Davomat: barcha ${String(lessons)} ta darsga kelgan, ${String(late)} tasiga kechikkan.`,
  attendedSome: (attended, lessons) =>
    `Davomat: ${String(lessons)} ta darsdan ${String(attended)} tasiga kelgan.`,
  notYetEntered: (lessons) =>
    `Davomat: ${String(lessons)} ta dars boʻldi, davomat hali kiritilmagan.`,
  noLessons: 'Davomat: bu davrda dars boʻlmadi.',
  absencesHeading: 'Qoldirilgan va kechikilgan darslar:',
  gradesHeading: 'Baholar:',
  commentsHeading: 'Izohlar:',
  absent: 'kelmagan',
  skipped: 'maktabda, lekin darsga kirmagan',
  late: 'kechikkan',
  present: 'kelgan',
  classwork: (position) => `Sinf ishi ${String(position)}`,
  homework: (position) => `Uy vazifasi ${String(position)}`,
  ratingExam: 'Reyting imtihoni',
  corrected: 'tuzatildi',
  removed: 'oʻchirildi',
  months: ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'],
  openPortal: 'Portalni ochish',
};

const ru: DigestTexts = {
  title: (date) => `Школа Sodiq: сводка на ${date}`,
  attendedAllOnTime: (lessons) => `Посещаемость: все ${String(lessons)} уроков вовремя.`,
  attendedAllLate: (lessons, late) =>
    `Посещаемость: все ${String(lessons)} уроков, опозданий: ${String(late)}.`,
  attendedSome: (attended, lessons) =>
    `Посещаемость: ${String(attended)} из ${String(lessons)} уроков.`,
  notYetEntered: (lessons) =>
    `Посещаемость: прошло уроков: ${String(lessons)}, отметки ещё не внесены.`,
  noLessons: 'Посещаемость: в этот период уроков не было.',
  absencesHeading: 'Пропуски и опоздания:',
  gradesHeading: 'Оценки:',
  commentsHeading: 'Комментарии:',
  absent: 'отсутствовал(а)',
  skipped: 'был(а) в школе, но не пришёл(ла) на урок',
  late: 'опоздал(а)',
  present: 'присутствовал(а)',
  classwork: (position) => `Классная работа ${String(position)}`,
  homework: (position) => `Домашняя работа ${String(position)}`,
  ratingExam: 'Рейтинговый экзамен',
  corrected: 'исправлено',
  removed: 'удалено',
  months: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  openPortal: 'Открыть портал',
};

const en: DigestTexts = {
  title: (date) => `Sodiq School: digest of ${date}`,
  attendedAllOnTime: (lessons) => `Attendance: attended all ${String(lessons)} lessons on time.`,
  attendedAllLate: (lessons, late) =>
    `Attendance: attended all ${String(lessons)} lessons, ${String(late)} late.`,
  attendedSome: (attended, lessons) =>
    `Attendance: attended ${String(attended)} of ${String(lessons)} lessons.`,
  notYetEntered: (lessons) =>
    `Attendance: ${String(lessons)} lessons held, attendance not yet entered.`,
  noLessons: 'Attendance: no lessons in this period.',
  absencesHeading: 'Absences and late arrivals:',
  gradesHeading: 'Grades:',
  commentsHeading: 'Comments:',
  absent: 'absent',
  skipped: 'at school but did not come to the lesson',
  late: 'late',
  present: 'present',
  classwork: (position) => `Classwork ${String(position)}`,
  homework: (position) => `Homework ${String(position)}`,
  ratingExam: 'Rating exam',
  corrected: 'corrected',
  removed: 'removed',
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  openPortal: 'Open the portal',
};

export const DIGEST_TEXTS: Readonly<Record<Language, DigestTexts>> = { uz, ru, en };
