import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import type { Language } from './language.js';
import { VIEW_SPANS } from './timetable-views.js';

/**
 * Print, PDF and Excel of the timetable views (task 5.9c-1, pull request
 * #199; `06`, Views and outputs: "Print, PDF and Excel for one class, one
 * teacher, one room or the whole school"). The file is the view of 5.9a as the
 * role sees it, stamped with each day's version and "valid from" and an "as
 * of" time (`edge/timetable`, "The wall timetable is out of date").
 */

export const VIEW_EXPORT_FORMATS = ['pdf', 'xlsx'] as const;

export type ViewExportFormat = (typeof VIEW_EXPORT_FORMATS)[number];

const common = {
  date: schoolDateSchema,
  span: z.enum(VIEW_SPANS),
  format: z.enum(VIEW_EXPORT_FORMATS),
};

/**
 * One file of one view (review correction 6): each kind takes the id of its
 * 5.9a query and nothing else, so an id the kind has no use for is refused.
 */
export const viewExportRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('branch'), ...common }),
  z.strictObject({ kind: z.literal('class'), classId: z.uuid(), ...common }),
  z.strictObject({ kind: z.literal('teacher'), staffId: z.uuid(), ...common }),
  z.strictObject({ kind: z.literal('room'), roomId: z.uuid(), ...common }),
]);

export type ViewExportRequest = z.infer<typeof viewExportRequestSchema>;

/** The texts of a timetable file, in the language of the account (review correction 1). */
export interface ViewExportTexts {
  titles: Readonly<Record<'branch' | 'class' | 'teacher' | 'room', string>>;
  spans: Readonly<Record<'day' | 'week', string>>;
  /** "As of {{moment}}", on every page and in the preamble. */
  asOf: string;
  /** "Page {{page}}". */
  page: string;
  version: string;
  validFrom: string;
  noVersion: string;
  outsideYear: string;
  dayOff: string;
  fromPattern: string;
  noLessons: string;
  exam: string;
  changed: string;
  cancelledReason: string;
  causes: Readonly<
    Record<'not_in_template' | 'exam' | 'exam_week' | 'day_off' | 'kept_data', string>
  >;
  replacedBy: string;
  substituteFor: string;
  needsTeacher: string;
  needsRoom: string;
  busyIn: string;
  weekdays: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6 | 7, string>>;
  kinds: Readonly<Record<'lesson' | 'exam' | 'busy' | 'day', string>>;
  columns: Readonly<
    Record<
      | 'date'
      | 'weekday'
      | 'lessonNumber'
      | 'start'
      | 'end'
      | 'unit'
      | 'subject'
      | 'teacher'
      | 'room'
      | 'kind'
      | 'mark'
      | 'version'
      | 'validFrom',
      string
    >
  >;
  sheet: string;
  /** The first word of the file name, by kind. */
  fileNames: Readonly<Record<'branch' | 'class' | 'teacher' | 'room', string>>;
}

const uz: ViewExportTexts = {
  titles: {
    branch: 'Maktab dars jadvali',
    class: 'Sinf dars jadvali',
    teacher: 'Oʻqituvchi dars jadvali',
    room: 'Xona dars jadvali',
  },
  spans: { day: 'Kun', week: 'Hafta' },
  asOf: '{{moment}} holatiga',
  page: '{{page}}-sahifa',
  version: '{{number}}-versiya',
  validFrom: '{{date}} dan amal qiladi',
  noVersion: 'Eʼlon qilingan dars jadvali yoʻq',
  outsideYear: 'Oʻquv yilidan tashqari',
  dayOff: 'Dam olish kuni: {{name}}',
  fromPattern: 'Haftalik shablondan; bir kunlik oʻzgarishlar kiritilmagan',
  noLessons: 'Darslar yoʻq',
  exam: 'Imtihon',
  changed: 'oʻzgargan',
  cancelledReason: 'Bekor qilingan: {{reason}}',
  causes: {
    not_in_template: 'Bekor qilingan: kun shablonida yoʻq',
    kept_data: 'Endi jadvalda yoʻq: maʼlumotlari uchun saqlangan',
    exam: 'Imtihon tufayli bekor qilingan',
    exam_week: 'Bekor qilingan: imtihonlar haftasi',
    day_off: 'Bekor qilingan: dam olish kuni',
  },
  replacedBy: 'Oʻrniga {{name}} dars oʻtadi',
  substituteFor: '{{name}} oʻrniga',
  needsTeacher: 'oʻqituvchi kerak',
  needsRoom: 'xona kerak',
  busyIn: '{{branch}} filialida band',
  weekdays: {
    1: 'Dushanba',
    2: 'Seshanba',
    3: 'Chorshanba',
    4: 'Payshanba',
    5: 'Juma',
    6: 'Shanba',
    7: 'Yakshanba',
  },
  kinds: { lesson: 'Dars', exam: 'Imtihon', busy: 'Boshqa filialda', day: 'Kun' },
  columns: {
    date: 'Sana',
    weekday: 'Hafta kuni',
    lessonNumber: 'Dars',
    start: 'Boshlanishi',
    end: 'Tugashi',
    unit: 'Sinf yoki guruh',
    subject: 'Fan',
    teacher: 'Oʻqituvchi',
    room: 'Xona',
    kind: 'Turi',
    mark: 'Belgi',
    version: 'Versiya',
    validFrom: 'Amal qilish sanasi',
  },
  sheet: 'Dars jadvali',
  fileNames: { branch: 'maktab', class: 'sinf', teacher: 'oqituvchi', room: 'xona' },
};

const ru: ViewExportTexts = {
  titles: {
    branch: 'Расписание школы',
    class: 'Расписание класса',
    teacher: 'Расписание учителя',
    room: 'Расписание кабинета',
  },
  spans: { day: 'День', week: 'Неделя' },
  asOf: 'По состоянию на {{moment}}',
  page: 'Страница {{page}}',
  version: 'Версия {{number}}',
  validFrom: 'действует с {{date}}',
  noVersion: 'Нет опубликованного расписания',
  outsideYear: 'Вне учебного года',
  dayOff: 'Выходной: {{name}}',
  fromPattern: 'По недельному шаблону; изменения на один день не учтены',
  noLessons: 'Уроков нет',
  exam: 'Экзамен',
  changed: 'изменён',
  cancelledReason: 'Отменён: {{reason}}',
  causes: {
    not_in_template: 'Отменён: нет в шаблоне дня',
    kept_data: 'Больше нет в расписании: сохранён из-за данных',
    exam: 'Отменён из-за экзамена',
    exam_week: 'Отменён: неделя экзаменов',
    day_off: 'Отменён: выходной',
  },
  replacedBy: 'Замена: {{name}}',
  substituteFor: 'замена за {{name}}',
  needsTeacher: 'нужен учитель',
  needsRoom: 'нужен кабинет',
  busyIn: 'Занят в филиале {{branch}}',
  weekdays: {
    1: 'Понедельник',
    2: 'Вторник',
    3: 'Среда',
    4: 'Четверг',
    5: 'Пятница',
    6: 'Суббота',
    7: 'Воскресенье',
  },
  kinds: { lesson: 'Урок', exam: 'Экзамен', busy: 'В другом филиале', day: 'День' },
  columns: {
    date: 'Дата',
    weekday: 'День недели',
    lessonNumber: 'Урок',
    start: 'Начало',
    end: 'Конец',
    unit: 'Класс или группа',
    subject: 'Предмет',
    teacher: 'Учитель',
    room: 'Кабинет',
    kind: 'Вид',
    mark: 'Отметка',
    version: 'Версия',
    validFrom: 'Действует с',
  },
  sheet: 'Расписание',
  fileNames: { branch: 'школа', class: 'класс', teacher: 'учитель', room: 'кабинет' },
};

const en: ViewExportTexts = {
  titles: {
    branch: 'School timetable',
    class: 'Class timetable',
    teacher: 'Teacher timetable',
    room: 'Room timetable',
  },
  spans: { day: 'Day', week: 'Week' },
  asOf: 'As of {{moment}}',
  page: 'Page {{page}}',
  version: 'Version {{number}}',
  validFrom: 'valid from {{date}}',
  noVersion: 'No published timetable',
  outsideYear: 'Outside the academic year',
  dayOff: 'Day off: {{name}}',
  fromPattern: 'From the weekly pattern; one-day changes not included',
  noLessons: 'No lessons',
  exam: 'Exam',
  changed: 'changed',
  cancelledReason: 'Cancelled: {{reason}}',
  causes: {
    not_in_template: 'Cancelled: not in the day’s template',
    kept_data: 'Not in the timetable any more: kept for its data',
    exam: 'Cancelled for an exam',
    exam_week: 'Cancelled: exam week',
    day_off: 'Cancelled: day off',
  },
  replacedBy: 'Replaced by {{name}}',
  substituteFor: 'substitute for {{name}}',
  needsTeacher: 'needs a teacher',
  needsRoom: 'needs a room',
  busyIn: 'Busy in {{branch}}',
  weekdays: {
    1: 'Monday',
    2: 'Tuesday',
    3: 'Wednesday',
    4: 'Thursday',
    5: 'Friday',
    6: 'Saturday',
    7: 'Sunday',
  },
  kinds: { lesson: 'Lesson', exam: 'Exam', busy: 'Other branch', day: 'Day' },
  columns: {
    date: 'Date',
    weekday: 'Weekday',
    lessonNumber: 'Lesson',
    start: 'Start',
    end: 'End',
    unit: 'Class or group',
    subject: 'Subject',
    teacher: 'Teacher',
    room: 'Room',
    kind: 'Kind',
    mark: 'Mark',
    version: 'Version',
    validFrom: 'Valid from',
  },
  sheet: 'Timetable',
  fileNames: { branch: 'school', class: 'class', teacher: 'teacher', room: 'room' },
};

/** The ASCII first word of a file name, the same in every language. */
export const VIEW_EXPORT_ASCII_NAMES = {
  branch: 'school',
  class: 'class',
  teacher: 'teacher',
  room: 'room',
} as const;

/**
 * The texts of the timetable files in the three languages. A missing text
 * fails the type-check (`12`: "A missing translation fails the build").
 */
export const VIEW_EXPORT_TEXTS: Readonly<Record<Language, ViewExportTexts>> = { uz, ru, en };

/** Fills `{{name}}` parts of a file text. */
export function fillText(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => values[key] ?? whole);
}

/**
 * Print, PDF and Excel of a version's weekly pattern (task 5.9c-2, pull
 * request #200; `edge/timetable`, "The wall timetable is out of date": "A
 * printed pattern carries the version, 'valid from', the print time and
 * 'one-day changes not included'. ... A draft print is marked DRAFT"). The
 * four kinds of the views (decision 5), weekly only: a pattern has no dates.
 */
export const versionExportRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('branch'), format: z.enum(VIEW_EXPORT_FORMATS) }),
  z.strictObject({
    kind: z.literal('class'),
    classId: z.uuid(),
    format: z.enum(VIEW_EXPORT_FORMATS),
  }),
  z.strictObject({
    kind: z.literal('teacher'),
    staffId: z.uuid(),
    format: z.enum(VIEW_EXPORT_FORMATS),
  }),
  z.strictObject({
    kind: z.literal('room'),
    roomId: z.uuid(),
    format: z.enum(VIEW_EXPORT_FORMATS),
  }),
]);

export type VersionExportRequest = z.infer<typeof versionExportRequestSchema>;

/**
 * The texts of a pattern file that the view files do not have; the titles,
 * weekdays, columns and the version line are those of `VIEW_EXPORT_TEXTS`.
 */
export interface PatternExportTexts {
  /** The word on every page of a draft's file (decision 4): grey, in the account's language. */
  draft: string;
  /** The word on every page of an archived version's file (decision 2). */
  archived: string;
  /** "Weekly pattern", after the title. */
  weekly: string;
  /** A draft's start date (decision 3, approval correction 1): it is not in force. */
  plannedFrom: string;
  /** "Printed {{moment}}", the print time in branch time (decision 7). */
  printed: string;
  /** "One-day changes not included". */
  noDayChanges: string;
  /** The first word of the file name. */
  fileName: string;
}

/** The texts of a pattern file in the three languages; a missing one fails the type-check. */
export const PATTERN_EXPORT_TEXTS: Readonly<Record<Language, PatternExportTexts>> = {
  uz: {
    draft: 'QORALAMA',
    archived: 'Arxivlangan',
    weekly: 'Haftalik shablon',
    plannedFrom: '{{date}} dan boshlash rejalashtirilgan',
    printed: 'Chop etilgan: {{moment}}',
    noDayChanges: 'Bir kunlik oʻzgarishlar kiritilmagan',
    fileName: 'versiya',
  },
  ru: {
    draft: 'ЧЕРНОВИК',
    archived: 'В архиве',
    weekly: 'Недельный шаблон',
    plannedFrom: 'планируется с {{date}}',
    printed: 'Напечатано {{moment}}',
    noDayChanges: 'Изменения на один день не учтены',
    fileName: 'версия',
  },
  en: {
    draft: 'DRAFT',
    archived: 'Archived',
    weekly: 'Weekly pattern',
    plannedFrom: 'planned from {{date}}',
    printed: 'Printed {{moment}}',
    noDayChanges: 'One-day changes not included',
    fileName: 'version',
  },
};
