import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import type { Language } from './language.js';

/**
 * The exports of a journal (task 8.9, pull request #227; `07`, last
 * paragraph: "Export to Excel and PDF, and print, for a month or a quarter";
 * `edge/system-behaviour`: "A large export is a background job, one per user,
 * taken from one consistent moment and stamped with date and 'provisional' or
 * 'final'. The link works for 24 hours and access is checked again at
 * download").
 */

export const JOURNAL_EXPORT_FORMATS = ['xlsx', 'pdf'] as const;

export const journalExportFormatSchema = z.enum(JOURNAL_EXPORT_FORMATS);

export type JournalExportFormat = z.infer<typeof journalExportFormatSchema>;

/** A month of the quarter, `YYYY-MM`; left out for the whole quarter. */
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** The body of the export of one journal, and of the branch export. */
export const journalExportSchema = z.strictObject({
  format: journalExportFormatSchema,
  quarterId: z.uuid(),
  month: monthSchema.optional(),
});

export type JournalExport = z.infer<typeof journalExportSchema>;

/** The link of a branch export works this long after the file is ready (decision 4). */
export const JOURNAL_EXPORT_VALID_MS = 24 * 60 * 60 * 1000;

/** A queued branch export older than this counts as failed `journal_export_stale` (decision 6). */
export const JOURNAL_EXPORT_STALE_MS = 20 * 60 * 1000;

/** The export list answers the newest exports of the person in the branch, at most this many (decision 12). */
export const JOURNAL_EXPORTS_LISTED = 20;

export const JOURNAL_EXPORT_STATUSES = ['queued', 'ready', 'failed', 'expired'] as const;

/** One branch export of the person, as the list shows it. */
export const journalExportItemSchema = z.object({
  id: z.uuid(),
  quarter: z.object({ id: z.uuid(), number: z.int().min(1).max(4) }),
  month: monthSchema.nullable(),
  format: journalExportFormatSchema,
  /** `expired` and a stale `failed` are read from the stored moments and the clock. */
  status: z.enum(JOURNAL_EXPORT_STATUSES),
  /** Why it failed: `journal_export_stale`, `journal_export_scope` or `journal_export_failed`. */
  failure: z.string().nullable(),
  requestedAt: z.iso.datetime(),
  /** The moment of the one snapshot the file was read from. */
  asOf: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  journals: z.int().min(0).nullable(),
  rows: z.int().min(0).nullable(),
});

export type JournalExportItem = z.infer<typeof journalExportItemSchema>;

export const journalExportListSchema = z.object({
  /** The reader may ask for a branch export (decision 3). */
  canExportBranch: z.boolean(),
  /** The dated quarters of the year in force today (else the newest), for the request form. */
  quarters: z.array(
    z.object({
      id: z.uuid(),
      number: z.int().min(1).max(4),
      startDate: schoolDateSchema,
      endDate: schoolDateSchema,
    }),
  ),
  exports: z.array(journalExportItemSchema),
});

export type JournalExportList = z.infer<typeof journalExportListSchema>;

export const journalExportParamsSchema = z.strictObject({ exportId: z.uuid() });

export type JournalExportParams = z.infer<typeof journalExportParamsSchema>;

/** What `@RequestKey` repeats of the request of a branch export answer. */
export const journalExportRequestedSchema = z.object({ export: journalExportItemSchema });

export type JournalExportRequested = z.infer<typeof journalExportRequestedSchema>;

/** The texts of a journal's PDF and Excel, in the language of the account. */
export interface JournalExportTexts {
  readonly title: string;
  readonly quarter: string;
  readonly month: string;
  readonly teacher: string;
  readonly noTeacher: string;
  readonly provisional: string;
  readonly page: string;
  readonly columns: {
    readonly number: string;
    readonly name: string;
    readonly uid: string;
    readonly attendance: string;
    readonly classwork: string;
    readonly homework: string;
    readonly ratingExam: string;
    readonly result: string;
    readonly grade: string;
    readonly mark: string;
    readonly classworkShort: string;
    readonly homeworkShort: string;
    readonly percent: string;
    readonly total: string;
    readonly lessonScore: string;
    readonly note: string;
    readonly date: string;
  };
  readonly cancelled: string;
  readonly exempt: string;
  readonly noResult: string;
  readonly provisionalResult: string;
  readonly basedOn: string;
  readonly folded: string;
  readonly exemptSection: string;
  readonly bottom: string;
  readonly legend: {
    readonly marks: string;
    readonly markNames: Readonly<Record<'0' | '1' | '2' | '3' | '4' | '5', string>>;
    readonly bands: string;
    readonly weights: string;
    readonly daily: string;
    readonly quarterly: string;
  };
  readonly weekdays: readonly string[];
  readonly fileName: string;
  readonly branchFileName: string;
}

const en: JournalExportTexts = {
  title: 'Class journal',
  quarter: 'Quarter {{number}}',
  month: 'Month {{month}}',
  teacher: 'Teacher: {{name}}',
  noTeacher: 'No teacher',
  provisional: 'Provisional · {{moment}}',
  page: 'Page {{page}}',
  columns: {
    number: 'No.',
    name: 'Student',
    uid: 'UID',
    attendance: 'Attendance',
    classwork: 'Classwork',
    homework: 'Homework',
    ratingExam: 'Rating exam',
    result: 'Result',
    grade: 'Grade',
    mark: 'A',
    classworkShort: 'CW',
    homeworkShort: 'HW',
    percent: '%',
    total: 'Soni {{total}}',
    lessonScore: 'AVG',
    note: 'Note',
    date: 'Date',
  },
  cancelled: 'Cancelled',
  exempt: 'Exempt',
  noResult: 'No result',
  provisionalResult: 'provisional',
  basedOn: 'based on {{held}} of {{expected}} lessons',
  folded: 'Left or moved',
  exemptSection: 'Exempt',
  bottom: 'Average',
  legend: {
    marks: 'Marks',
    markNames: {
      '0': 'absent from school',
      '1': 'present',
      '2': 'late',
      '3': 'at school, not at the lesson',
      '4': 'temporarily exempt',
      '5': 'fully exempt',
    },
    bands: 'Grades: 0–49 is 2, 50–66 is 3, 67–83 is 4, 84–100 is 5',
    weights: 'Weights',
    daily: 'Lesson: attendance {{attendance}} · classwork {{classwork}} · homework {{homework}}',
    quarterly:
      'Quarter: attendance {{attendance}} · classwork {{classwork}} · homework {{homework}} · rating exam {{ratingExam}}',
  },
  weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  fileName: 'journal',
  branchFileName: 'journals',
};

const ru: JournalExportTexts = {
  title: 'Классный журнал',
  quarter: '{{number}} четверть',
  month: 'Месяц {{month}}',
  teacher: 'Учитель: {{name}}',
  noTeacher: 'Нет учителя',
  provisional: 'Предварительно · {{moment}}',
  page: 'Страница {{page}}',
  columns: {
    number: '№',
    name: 'Ученик',
    uid: 'UID',
    attendance: 'Посещаемость',
    classwork: 'Классная работа',
    homework: 'Домашняя работа',
    ratingExam: 'Рейтинговый экзамен',
    result: 'Итог',
    grade: 'Оценка',
    mark: 'П',
    classworkShort: 'КР',
    homeworkShort: 'ДР',
    percent: '%',
    total: 'Soni {{total}}',
    lessonScore: 'СР',
    note: 'Примечание',
    date: 'Дата',
  },
  cancelled: 'Отменён',
  exempt: 'Освобождён',
  noResult: 'Нет итога',
  provisionalResult: 'предварительно',
  basedOn: 'по {{held}} из {{expected}} уроков',
  folded: 'Выбывшие и переведённые',
  exemptSection: 'Освобождённые',
  bottom: 'Среднее',
  legend: {
    marks: 'Отметки',
    markNames: {
      '0': 'нет в школе',
      '1': 'присутствует',
      '2': 'опоздал',
      '3': 'в школе, но не на уроке',
      '4': 'временно освобождён',
      '5': 'полностью освобождён',
    },
    bands: 'Оценки: 0–49 — 2, 50–66 — 3, 67–83 — 4, 84–100 — 5',
    weights: 'Веса',
    daily:
      'Урок: посещаемость {{attendance}} · классная работа {{classwork}} · домашняя работа {{homework}}',
    quarterly:
      'Четверть: посещаемость {{attendance}} · классная работа {{classwork}} · домашняя работа {{homework}} · рейтинговый экзамен {{ratingExam}}',
  },
  weekdays: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
  fileName: 'журнал',
  branchFileName: 'журналы',
};

const uz: JournalExportTexts = {
  title: 'Sinf jurnali',
  quarter: '{{number}}-chorak',
  month: 'Oy {{month}}',
  teacher: 'Oʻqituvchi: {{name}}',
  noTeacher: 'Oʻqituvchi yoʻq',
  provisional: 'Dastlabki · {{moment}}',
  page: '{{page}}-sahifa',
  columns: {
    number: '№',
    name: 'Oʻquvchi',
    uid: 'UID',
    attendance: 'Davomat',
    classwork: 'Sinf ishi',
    homework: 'Uy ishi',
    ratingExam: 'Reyting imtihoni',
    result: 'Natija',
    grade: 'Baho',
    mark: 'D',
    classworkShort: 'SI',
    homeworkShort: 'UI',
    percent: '%',
    total: 'Soni {{total}}',
    lessonScore: 'OʻRT',
    note: 'Izoh',
    date: 'Sana',
  },
  cancelled: 'Bekor qilingan',
  exempt: 'Ozod',
  noResult: 'Natija yoʻq',
  provisionalResult: 'dastlabki',
  basedOn: '{{expected}} ta darsdan {{held}} tasi asosida',
  folded: 'Ketgan yoki koʻchirilgan',
  exemptSection: 'Ozod qilinganlar',
  bottom: 'Oʻrtacha',
  legend: {
    marks: 'Belgilar',
    markNames: {
      '0': 'maktabda yoʻq',
      '1': 'bor',
      '2': 'kechikkan',
      '3': 'maktabda, lekin darsda emas',
      '4': 'vaqtincha ozod',
      '5': 'toʻliq ozod',
    },
    bands: 'Baholar: 0–49 — 2, 50–66 — 3, 67–83 — 4, 84–100 — 5',
    weights: 'Ulushlar',
    daily: 'Dars: davomat {{attendance}} · sinf ishi {{classwork}} · uy ishi {{homework}}',
    quarterly:
      'Chorak: davomat {{attendance}} · sinf ishi {{classwork}} · uy ishi {{homework}} · reyting imtihoni {{ratingExam}}',
  },
  weekdays: ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'],
  fileName: 'jurnal',
  branchFileName: 'jurnallar',
};

export const JOURNAL_EXPORT_TEXTS: Readonly<Record<Language, JournalExportTexts>> = { uz, ru, en };

/** The file names in ASCII letters, for a browser that ignores `filename*`. */
export const JOURNAL_EXPORT_ASCII_NAMES = { journal: 'journal', branch: 'journals' } as const;

// ---------------------------------------------------------------------------
// The support view (`edge/journal`, "My grade disappeared").

export const journalSupportQuerySchema = z.strictObject({
  studentId: z.uuid(),
  journalId: z.uuid(),
  date: schoolDateSchema,
});

export type JournalSupportQuery = z.infer<typeof journalSupportQuerySchema>;
