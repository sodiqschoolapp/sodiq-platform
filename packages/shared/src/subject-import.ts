import { z } from 'zod';
import { LANGUAGES, type Language } from './language.js';
import { namesSchema } from './setup.js';
import type { JournalType, SubjectColour } from './subjects.js';

/**
 * The subject import from the system's Excel template (the owner's change of
 * 7 November 2026, pull request #316; `05`, "Excel import of subjects"). One
 * row is one subject: its school-wide fields, and for a graded subject the
 * daily and quarterly distributions of the branch of the import. The
 * quarterly distribution applies to every quarter not closed of the current
 * and later years of that branch. Preview first; all rows or none; the same
 * file not twice; a name already used is a problem. The Super Admin and the
 * Academic Vice Principal import subjects.
 */

/** The weight columns of the daily distribution. */
const DAILY_COLUMNS = ['dailyAttendance', 'dailyClasswork', 'dailyHomework'] as const;

/** The weight columns of the quarterly distribution; the rating exam's last. */
const QUARTERLY_COLUMNS = [
  'quarterAttendance',
  'quarterClasswork',
  'quarterHomework',
  'quarterRatingExam',
] as const;

/** The switches of a subject, as yes or no. */
const SWITCH_COLUMNS = ['ratingExam', 'groupSubject', 'languageRule', 'demanding'] as const;

export type SubjectImportSwitchColumn = (typeof SWITCH_COLUMNS)[number];

export const SUBJECT_IMPORT_SWITCH_COLUMNS: readonly SubjectImportSwitchColumn[] = SWITCH_COLUMNS;

export const SUBJECT_IMPORT_DAILY_COLUMNS: readonly SubjectImportColumn[] = DAILY_COLUMNS;

export const SUBJECT_IMPORT_QUARTERLY_COLUMNS: readonly SubjectImportColumn[] = QUARTERLY_COLUMNS;

/**
 * The columns of the template, in their order. Row 1 of the sheet holds
 * these keys (hidden): the mark of the system's template (as the staff import).
 */
export const SUBJECT_IMPORT_COLUMNS = [
  'nameUz',
  'nameRu',
  'nameEn',
  'department',
  'grades',
  'colour',
  'journalType',
  ...SWITCH_COLUMNS,
  ...DAILY_COLUMNS,
  ...QUARTERLY_COLUMNS,
] as const;

export type SubjectImportColumn = (typeof SUBJECT_IMPORT_COLUMNS)[number];

export const subjectImportColumnSchema = z.enum(SUBJECT_IMPORT_COLUMNS);

/** The name of the template's sheet; with the row of keys it marks the system's template. */
export const SUBJECT_IMPORT_SHEET = 'Subjects';

/** The name of the sheet of allowed values. */
export const SUBJECT_IMPORT_LISTS_SHEET = 'Lists';

/** At most this many rows in one file, as the staff import. */
export const SUBJECT_IMPORT_MAX_ROWS = 1000;

/** The words of a switch cell. */
export const SUBJECT_IMPORT_ANSWERS = ['yes', 'no'] as const;

export type SubjectImportAnswer = (typeof SUBJECT_IMPORT_ANSWERS)[number];

/** The words of the template in one language: headings and the values of its lists. */
export interface SubjectImportWords {
  headings: Record<SubjectImportColumn, string>;
  colours: Record<SubjectColour, string>;
  journalTypes: Record<JournalType, string>;
  answers: Record<SubjectImportAnswer, string>;
}

/** The words of the subject screens of the web app, so that the file and the screens say the same. */
export const SUBJECT_IMPORT_WORDS: Readonly<Record<Language, SubjectImportWords>> = {
  uz: {
    headings: {
      nameUz: 'Nomi (oʻzbekcha)',
      nameRu: 'Nomi (ruscha)',
      nameEn: 'Nomi (inglizcha)',
      department: 'Kafedra',
      grades: 'Sinflar',
      colour: 'Rang',
      journalType: 'Jurnal turi',
      ratingExam: 'Reyting imtihoni',
      groupSubject: 'Guruhli fan',
      languageRule: 'Til qoidasi',
      demanding: 'Murakkab fan',
      dailyAttendance: 'Kunlik: davomat',
      dailyClasswork: 'Kunlik: sinf ishi',
      dailyHomework: 'Kunlik: uy vazifasi',
      quarterAttendance: 'Choraklik: davomat',
      quarterClasswork: 'Choraklik: sinf ishi',
      quarterHomework: 'Choraklik: uy vazifasi',
      quarterRatingExam: 'Choraklik: reyting imtihoni',
    },
    colours: {
      red: 'Qizil',
      orange: 'Toʻq sariq',
      amber: 'Qahrabo',
      lime: 'Och yashil',
      green: 'Yashil',
      teal: 'Moviy-yashil',
      cyan: 'Havorang',
      blue: 'Koʻk',
      indigo: 'Indigo',
      violet: 'Binafsha',
      pink: 'Pushti',
      brown: 'Jigarrang',
    },
    journalTypes: { graded: 'Baholanadi', attendance_only: 'Faqat davomat' },
    answers: { yes: 'Ha', no: 'Yoʻq' },
  },
  ru: {
    headings: {
      nameUz: 'Название (узбекский)',
      nameRu: 'Название (русский)',
      nameEn: 'Название (английский)',
      department: 'Кафедра',
      grades: 'Классы',
      colour: 'Цвет',
      journalType: 'Тип журнала',
      ratingExam: 'Рейтинговый экзамен',
      groupSubject: 'Предмет по группам',
      languageRule: 'Правило языка',
      demanding: 'Трудный предмет',
      dailyAttendance: 'Ежедневно: посещаемость',
      dailyClasswork: 'Ежедневно: классная работа',
      dailyHomework: 'Ежедневно: домашнее задание',
      quarterAttendance: 'За четверть: посещаемость',
      quarterClasswork: 'За четверть: классная работа',
      quarterHomework: 'За четверть: домашнее задание',
      quarterRatingExam: 'За четверть: рейтинговый экзамен',
    },
    colours: {
      red: 'Красный',
      orange: 'Оранжевый',
      amber: 'Янтарный',
      lime: 'Лаймовый',
      green: 'Зелёный',
      teal: 'Сине-зелёный',
      cyan: 'Голубой',
      blue: 'Синий',
      indigo: 'Индиго',
      violet: 'Фиолетовый',
      pink: 'Розовый',
      brown: 'Коричневый',
    },
    journalTypes: { graded: 'С оценками', attendance_only: 'Только посещаемость' },
    answers: { yes: 'Да', no: 'Нет' },
  },
  en: {
    headings: {
      nameUz: 'Name in Uzbek',
      nameRu: 'Name in Russian',
      nameEn: 'Name in English',
      department: 'Department',
      grades: 'Grades',
      colour: 'Colour',
      journalType: 'Journal type',
      ratingExam: 'Rating exam',
      groupSubject: 'Group subject',
      languageRule: 'Language rule',
      demanding: 'Demanding',
      dailyAttendance: 'Daily: attendance',
      dailyClasswork: 'Daily: classwork',
      dailyHomework: 'Daily: homework',
      quarterAttendance: 'Quarterly: attendance',
      quarterClasswork: 'Quarterly: classwork',
      quarterHomework: 'Quarterly: homework',
      quarterRatingExam: 'Quarterly: rating exam',
    },
    colours: {
      red: 'Red',
      orange: 'Orange',
      amber: 'Amber',
      lime: 'Lime',
      green: 'Green',
      teal: 'Teal',
      cyan: 'Cyan',
      blue: 'Blue',
      indigo: 'Indigo',
      violet: 'Violet',
      pink: 'Pink',
      brown: 'Brown',
    },
    journalTypes: { graded: 'Graded', attendance_only: 'Attendance only' },
    answers: { yes: 'Yes', no: 'No' },
  },
};

/** The heading of a column in one language. */
export const subjectImportHeading = (column: SubjectImportColumn, language: Language): string =>
  SUBJECT_IMPORT_WORDS[language].headings[column];

/** The heading row of the template: each column in Uzbek, Russian and English. */
export const subjectImportHeadingRow = (): string[] =>
  SUBJECT_IMPORT_COLUMNS.map((column) =>
    LANGUAGES.map((language) => subjectImportHeading(column, language)).join(' / '),
  );

/** One row of an upload as read from the sheet, every cell as text. Kept in `subject_imports.rows`. */
export const subjectImportRowSchema = z.object({
  rowNumber: z.int().min(1),
  cells: z.partialRecord(subjectImportColumnSchema, z.string()),
});

export type SubjectImportRow = z.infer<typeof subjectImportRowSchema>;

export const subjectImportRowsSchema = z.array(subjectImportRowSchema);

/**
 * The kinds of problem of a row found before the save; a refusal of the save
 * itself (a name an active subject has, `already_exists`) carries the API's
 * own error code (`ERROR_CODES`).
 */
export const SUBJECT_IMPORT_PROBLEMS = [
  'required',
  'invalid',
  'value_unknown',
  /** A department no active department of the school is named by. */
  'name_unknown',
  /** A name two departments share in some language: never guessed. */
  'name_ambiguous',
  /** The grades cannot be read (`5, 6, 7` or `5-7`). */
  'grades_invalid',
  /** A weight that is not a whole number from 1 to 100. */
  'weight_invalid',
  /** The parts of a distribution do not total 100. */
  'weights_total',
  /** A weight on an attendance-only row (`edge/calculation`: "no weights"). */
  'weights_attendance_only',
  /** The rating exam switch on an attendance-only row. */
  'rating_exam_attendance_only',
  /** A quarterly rating exam weight on a row whose rating exam switch is off. */
  'rating_exam_weight_unwanted',
  /** The same name in the same language on another row of the file. */
  'duplicate_in_file',
] as const;

export type SubjectImportProblemCode = (typeof SUBJECT_IMPORT_PROBLEMS)[number];

export const subjectImportProblemSchema = z.object({
  column: subjectImportColumnSchema.nullable(),
  code: z.string(),
  /** The other rows of the file a duplicate is on. */
  rows: z.array(z.int()).optional(),
});

export type SubjectImportProblem = z.infer<typeof subjectImportProblemSchema>;

export const subjectImportPreviewRowSchema = z.object({
  rowNumber: z.int(),
  /** The names as read, each `null` when its cell is empty. */
  names: z.object({
    uz: z.string().nullable(),
    ru: z.string().nullable(),
    en: z.string().nullable(),
  }),
  problems: z.array(subjectImportProblemSchema),
});

export type SubjectImportPreviewRow = z.infer<typeof subjectImportPreviewRowSchema>;

export const subjectImportPreviewSchema = z.object({
  importId: z.uuid(),
  /** The day this file was already imported into the branch; `null` when it was not. */
  alreadyImportedOn: z.string().nullable(),
  rows: z.array(subjectImportPreviewRowSchema),
  /**
   * The quarters of the branch that a graded row's quarterly distribution is
   * written to: those not closed of the years not closed that end today or later.
   */
  quarterCount: z.int().min(0),
  /** No row has a problem. */
  clean: z.boolean(),
});

export type SubjectImportPreview = z.infer<typeof subjectImportPreviewSchema>;

/** The body of the preview and the confirm: nothing to decide. */
export const subjectImportRunSchema = z.strictObject({});

export type SubjectImportRun = z.infer<typeof subjectImportRunSchema>;

export const subjectImportParamsSchema = z.object({ id: z.uuid() });

export type SubjectImportParams = z.infer<typeof subjectImportParamsSchema>;

export const subjectImportTemplateQuerySchema = z.strictObject({
  language: z.enum(LANGUAGES),
});

export type SubjectImportTemplateQuery = z.infer<typeof subjectImportTemplateQuerySchema>;

/** The answer of the confirm: saved, with the subjects; or the preview again (nothing saved). */
export const subjectImportConfirmResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('saved'),
    created: z.int().min(1),
    subjects: z.array(z.object({ id: z.uuid(), names: namesSchema })),
  }),
  z.object({ outcome: z.literal('not_clean'), preview: subjectImportPreviewSchema }),
]);

export type SubjectImportConfirmResult = z.infer<typeof subjectImportConfirmResultSchema>;
