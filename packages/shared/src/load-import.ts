import { z } from 'zod';
import { LANGUAGES, type Language } from './language.js';
import { ROOM_TYPES, type RoomType } from './setup.js';

/**
 * The teaching load import from the system's Excel template (task 5.13, the owner's spec change
 * of 15 November 2026; `06`, Importing the load and the timetable). One row is one row of the
 * teaching load of a draft: class or group, subject, teacher or vacancy, lessons per week, a room
 * or a room type, double lessons, the mixed block mark (decision 5) and "deliberately short" with
 * its reason. The template is made for one branch and one draft; every column that names a record
 * is a dropdown of its sheet of lists. Preview first; all rows or none; the same file not twice.
 */

/** The columns of the template, in their order. Row 1 of the sheet holds these keys (hidden). */
export const LOAD_IMPORT_COLUMNS = [
  'unit',
  'subject',
  'teacher',
  'lessonsPerWeek',
  'room',
  'roomType',
  'doubleLessons',
  'mixedBlock',
  'shortReason',
] as const;

export type LoadImportColumn = (typeof LOAD_IMPORT_COLUMNS)[number];

export const loadImportColumnSchema = z.enum(LOAD_IMPORT_COLUMNS);

/** The name of the template's sheet; with the row of keys it marks the system's template. */
export const LOAD_IMPORT_SHEET = 'Load';

/** The name of the sheet of the branch's records (the dropdowns). */
export const LOAD_IMPORT_LISTS_SHEET = 'Lists';

/**
 * The hidden column of the sheet of lists that holds the draft's id (row 1) and the language of
 * the template (row 2), decision 3 and review finding 14.
 */
export const LOAD_IMPORT_META_COLUMN = 'Z';

/** At most this many rows in one file, as the other imports. */
export const LOAD_IMPORT_MAX_ROWS = 1000;

/** The words of a yes or no cell. */
export const LOAD_IMPORT_ANSWERS = ['yes', 'no'] as const;

export type LoadImportAnswer = (typeof LOAD_IMPORT_ANSWERS)[number];

/** The words of the template in one language: headings and the values of its lists. */
export interface LoadImportWords {
  headings: Record<LoadImportColumn, string>;
  roomTypes: Record<RoomType, string>;
  answers: Record<LoadImportAnswer, string>;
  /** The word after a vacancy's name in its list (decision 7). */
  vacancy: string;
  /** The headings of the sheet of lists. */
  lists: {
    units: string;
    groupClasses: string;
    subjects: string;
    teachers: string;
    rooms: string;
    roomTypes: string;
    answers: string;
  };
}

/** The words of the load screens of the web app, so that the file and the screens say the same. */
export const LOAD_IMPORT_WORDS: Readonly<Record<Language, LoadImportWords>> = {
  uz: {
    headings: {
      unit: 'Sinf yoki guruh',
      subject: 'Fan',
      teacher: 'Oʻqituvchi yoki vakansiya',
      lessonsPerWeek: 'Haftalik darslar',
      room: 'Xona',
      roomType: 'Xona turi',
      doubleLessons: 'Juft darslar',
      mixedBlock: 'Aralash blok',
      shortReason: 'Ataylab kam: sababi',
    },
    roomTypes: {
      classroom: 'Sinf xonasi',
      laboratory: 'Laboratoriya',
      sports_hall: 'Sport zali',
      hall: 'Zal',
      other: 'Boshqa',
    },
    answers: { yes: 'Ha', no: 'Yoʻq' },
    vacancy: 'vakansiya',
    lists: {
      units: 'Sinflar va guruhlar',
      groupClasses: 'Guruh sinflari',
      subjects: 'Fanlar',
      teachers: 'Oʻqituvchilar va vakansiyalar',
      rooms: 'Xonalar',
      roomTypes: 'Xona turlari',
      answers: 'Ha yoki yoʻq',
    },
  },
  ru: {
    headings: {
      unit: 'Класс или группа',
      subject: 'Предмет',
      teacher: 'Учитель или вакансия',
      lessonsPerWeek: 'Уроков в неделю',
      room: 'Кабинет',
      roomType: 'Тип кабинета',
      doubleLessons: 'Сдвоенные уроки',
      mixedBlock: 'Смешанный блок',
      shortReason: 'Намеренно меньше: причина',
    },
    roomTypes: {
      classroom: 'Классная комната',
      laboratory: 'Лаборатория',
      sports_hall: 'Спортивный зал',
      hall: 'Зал',
      other: 'Другое',
    },
    answers: { yes: 'Да', no: 'Нет' },
    vacancy: 'вакансия',
    lists: {
      units: 'Классы и группы',
      groupClasses: 'Классы группы',
      subjects: 'Предметы',
      teachers: 'Учителя и вакансии',
      rooms: 'Кабинеты',
      roomTypes: 'Типы кабинетов',
      answers: 'Да или нет',
    },
  },
  en: {
    headings: {
      unit: 'Class or group',
      subject: 'Subject',
      teacher: 'Teacher or vacancy',
      lessonsPerWeek: 'Lessons per week',
      room: 'Room',
      roomType: 'Room type',
      doubleLessons: 'Double lessons',
      mixedBlock: 'Mixed block',
      shortReason: 'Deliberately short: reason',
    },
    roomTypes: {
      classroom: 'Classroom',
      laboratory: 'Laboratory',
      sports_hall: 'Sports hall',
      hall: 'Hall',
      other: 'Other',
    },
    answers: { yes: 'Yes', no: 'No' },
    vacancy: 'vacancy',
    lists: {
      units: 'Classes and groups',
      groupClasses: 'Classes of the group',
      subjects: 'Subjects',
      teachers: 'Teachers and vacancies',
      rooms: 'Rooms',
      roomTypes: 'Room types',
      answers: 'Yes or no',
    },
  },
};

/** The heading row of the template: each column in Uzbek, Russian and English. */
export const loadImportHeadingRow = (): string[] =>
  LOAD_IMPORT_COLUMNS.map((column) =>
    LANGUAGES.map((language) => LOAD_IMPORT_WORDS[language].headings[column]).join(' / '),
  );

/** All room types, for the reader. */
export const LOAD_IMPORT_ROOM_TYPES: readonly RoomType[] = ROOM_TYPES;

/** One row of an upload as read from the sheet, every cell as text. Kept in `load_imports.rows`. */
export const loadImportRowSchema = z.object({
  rowNumber: z.int().min(1),
  cells: z.partialRecord(loadImportColumnSchema, z.string()),
});

export type LoadImportRow = z.infer<typeof loadImportRowSchema>;

/** What `load_imports.rows` holds: the rows, the draft the file was made for, its language. */
export const loadImportFileSchema = z.object({
  versionId: z.string().nullable(),
  language: z.enum(LANGUAGES).nullable(),
  rows: z.array(loadImportRowSchema),
});

export type LoadImportFile = z.infer<typeof loadImportFileSchema>;

/**
 * The kinds of problem of a row found while it is read and matched; a rule of a load row typed by
 * hand carries its own code (`load_teacher_language` and the others of `LOAD_PROBLEM_ORDER`,
 * `load_row_exists`, `load_teacher_needed`).
 */
export const LOAD_IMPORT_PROBLEMS = [
  'required',
  'invalid',
  /** A value no record of the branch and the draft's year is named by. */
  'load_import_unknown',
  /** A name two records in service share: never guessed. */
  'name_ambiguous',
  /** A room and a room type both given (the hand form takes one). */
  'load_import_room_and_type',
  /** Another row of the file for the same class and subject, or the same group. */
  'load_import_row_twice',
  /** A part of the row's block has no row in the draft or the file (decision 2). */
  'load_import_block_part',
] as const;

export type LoadImportProblemCode = (typeof LOAD_IMPORT_PROBLEMS)[number];

export const loadImportProblemSchema = z.object({
  column: loadImportColumnSchema.nullable(),
  code: z.string(),
  /** The other rows of the file a repeat is on. */
  rows: z.array(z.int()).optional(),
  /** The names of the groups of the block that have no row (`load_import_block_part`). */
  groups: z.array(z.string()).optional(),
});

export type LoadImportProblem = z.infer<typeof loadImportProblemSchema>;

/** A warning of a row: listed, never a stop (`load_group_gaps`, as by hand). */
export const loadImportWarningSchema = z.object({
  code: z.literal('load_group_gaps'),
  count: z.int().min(1),
});

export type LoadImportWarning = z.infer<typeof loadImportWarningSchema>;

export const loadImportPreviewRowSchema = z.object({
  rowNumber: z.int(),
  /** The cells as read, so the person finds the row. */
  cells: z.partialRecord(loadImportColumnSchema, z.string()),
  problems: z.array(loadImportProblemSchema),
  warnings: z.array(loadImportWarningSchema),
});

export type LoadImportPreviewRow = z.infer<typeof loadImportPreviewRowSchema>;

export const loadImportPreviewSchema = z.object({
  importId: z.uuid(),
  versionId: z.uuid(),
  /** The day this file was already imported into the draft; `null` when it was not. */
  alreadyImportedOn: z.string().nullable(),
  rows: z.array(loadImportPreviewRowSchema),
  /** The rows the draft's load holds now (they stay). */
  rowsInDraft: z.int().min(0),
  /** No row has a problem. */
  clean: z.boolean(),
});

export type LoadImportPreview = z.infer<typeof loadImportPreviewSchema>;

/** The body of the preview and the confirm: nothing to decide. */
export const loadImportRunSchema = z.strictObject({});

export type LoadImportRun = z.infer<typeof loadImportRunSchema>;

export const loadImportParamsSchema = z.object({ id: z.uuid(), importId: z.uuid() });

export type LoadImportParams = z.infer<typeof loadImportParamsSchema>;

export const loadImportTemplateQuerySchema = z.strictObject({
  language: z.enum(LANGUAGES),
});

export type LoadImportTemplateQuery = z.infer<typeof loadImportTemplateQuerySchema>;

/** The answer of the confirm: saved, with the rows; or the preview again (nothing saved). */
export const loadImportConfirmResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('saved'),
    created: z.int().min(1),
    rowIds: z.array(z.uuid()),
  }),
  z.object({ outcome: z.literal('not_clean'), preview: loadImportPreviewSchema }),
]);

export type LoadImportConfirmResult = z.infer<typeof loadImportConfirmResultSchema>;
