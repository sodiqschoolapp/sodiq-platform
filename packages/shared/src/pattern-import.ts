import { z } from 'zod';
import { LANGUAGES, type Language } from './language.js';
import { LOAD_IMPORT_WORDS } from './load-import.js';

/**
 * The timetable import from the system's Excel template (task 5.14, the owner's spec change of
 * 15 November 2026; `06`, Importing the load and the timetable). One row is one lesson of the
 * weekly pattern of a draft: weekday, lesson number of the day, class or group, subject, teacher
 * or vacancy, room (optional). The template is made for one branch and one draft with the sheet of
 * lists of the load import (5.13) and the weekdays; preview first; the draft's placements are
 * replaced after a confirmation, all or none; the same file not twice.
 */

/** The columns of the template, in their order. Row 1 of the sheet holds these keys (hidden). */
export const PATTERN_IMPORT_COLUMNS = [
  'weekday',
  'lessonNumber',
  'unit',
  'subject',
  'teacher',
  'room',
] as const;

export type PatternImportColumn = (typeof PATTERN_IMPORT_COLUMNS)[number];

export const patternImportColumnSchema = z.enum(PATTERN_IMPORT_COLUMNS);

/** The name of the template's sheet; with the row of keys it marks the system's template. */
export const PATTERN_IMPORT_SHEET = 'Timetable';

/** At most this many rows in one file: a branch's week of lessons with room to spare. */
export const PATTERN_IMPORT_MAX_ROWS = 3000;

/** The weekdays of a row, Monday 1 (as `pattern_blocks.weekday`). */
export const PATTERN_IMPORT_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export type PatternImportWeekday = (typeof PATTERN_IMPORT_WEEKDAYS)[number];

export interface PatternImportWords {
  headings: Record<PatternImportColumn, string>;
  weekdays: Record<PatternImportWeekday, string>;
  /** The heading of the weekdays in the sheet of lists. */
  weekdaysList: string;
}

/** The words of the template in one language; the lists of records are those of the load import. */
export const PATTERN_IMPORT_WORDS: Readonly<Record<Language, PatternImportWords>> = {
  uz: {
    headings: {
      weekday: 'Hafta kuni',
      lessonNumber: 'Dars raqami',
      unit: LOAD_IMPORT_WORDS.uz.headings.unit,
      subject: LOAD_IMPORT_WORDS.uz.headings.subject,
      teacher: LOAD_IMPORT_WORDS.uz.headings.teacher,
      room: LOAD_IMPORT_WORDS.uz.headings.room,
    },
    weekdays: {
      1: 'Dushanba',
      2: 'Seshanba',
      3: 'Chorshanba',
      4: 'Payshanba',
      5: 'Juma',
      6: 'Shanba',
      7: 'Yakshanba',
    },
    weekdaysList: 'Hafta kunlari',
  },
  ru: {
    headings: {
      weekday: 'День недели',
      lessonNumber: 'Номер урока',
      unit: LOAD_IMPORT_WORDS.ru.headings.unit,
      subject: LOAD_IMPORT_WORDS.ru.headings.subject,
      teacher: LOAD_IMPORT_WORDS.ru.headings.teacher,
      room: LOAD_IMPORT_WORDS.ru.headings.room,
    },
    weekdays: {
      1: 'Понедельник',
      2: 'Вторник',
      3: 'Среда',
      4: 'Четверг',
      5: 'Пятница',
      6: 'Суббота',
      7: 'Воскресенье',
    },
    weekdaysList: 'Дни недели',
  },
  en: {
    headings: {
      weekday: 'Weekday',
      lessonNumber: 'Lesson number',
      unit: LOAD_IMPORT_WORDS.en.headings.unit,
      subject: LOAD_IMPORT_WORDS.en.headings.subject,
      teacher: LOAD_IMPORT_WORDS.en.headings.teacher,
      room: LOAD_IMPORT_WORDS.en.headings.room,
    },
    weekdays: {
      1: 'Monday',
      2: 'Tuesday',
      3: 'Wednesday',
      4: 'Thursday',
      5: 'Friday',
      6: 'Saturday',
      7: 'Sunday',
    },
    weekdaysList: 'Weekdays',
  },
};

/** The heading row of the template: each column in Uzbek, Russian and English. */
export const patternImportHeadingRow = (): string[] =>
  PATTERN_IMPORT_COLUMNS.map((column) =>
    LANGUAGES.map((language) => PATTERN_IMPORT_WORDS[language].headings[column]).join(' / '),
  );

/** One row of an upload as read from the sheet, every cell as text. Kept in `pattern_imports.rows`. */
export const patternImportRowSchema = z.object({
  rowNumber: z.int().min(1),
  cells: z.partialRecord(patternImportColumnSchema, z.string()),
});

export type PatternImportRow = z.infer<typeof patternImportRowSchema>;

/** What `pattern_imports.rows` holds: the rows, the draft the file was made for, its language. */
export const patternImportFileSchema = z.object({
  versionId: z.string().nullable(),
  language: z.enum(LANGUAGES).nullable(),
  rows: z.array(patternImportRowSchema),
});

export type PatternImportFile = z.infer<typeof patternImportFileSchema>;

/**
 * The codes of a row's problems found by the import itself; a blocked rule of the engine carries
 * its own code (`teacher_double`, `class_double`, `split_apart` and the others of `RULE_ORDER`).
 */
export const PATTERN_IMPORT_PROBLEMS = [
  'required',
  'invalid',
  /** A value no record of the branch and the draft's year is named by (the load import's code). */
  'load_import_unknown',
  'name_ambiguous',
  /** Another row of the file for the same class or group and subject at the same time. */
  'pattern_import_row_twice',
  /** No row of the draft's load for this class or group and subject. */
  'pattern_import_no_load_row',
  /** The load row of this class or group and subject has another teacher or vacancy. */
  'pattern_import_teacher_differs',
  /** No teacher given on a row whose load row is not a Tutor row. */
  'pattern_import_teacher_needed',
  /** The class or group is archived. */
  'pattern_import_out_of_service',
  /** The day of the row's class or group has no lesson with this number on this weekday. */
  'pattern_import_no_slot',
  /** A part of the row's block has no lesson of the file at this time. */
  'pattern_import_block_part',
] as const;

export const patternImportProblemSchema = z.object({
  column: patternImportColumnSchema.nullable(),
  code: z.string(),
  /** The other rows of the file a repeat or a blocked rule is on. */
  rows: z.array(z.int()).optional(),
  /** The classes and groups of the block with no lesson at this time (`pattern_import_block_part`). */
  units: z.array(z.string()).optional(),
  /** The teacher or vacancy of the load row (`pattern_import_teacher_differs`). */
  teacher: z.string().optional(),
  /** The numbers of a blocked rule of the engine (a travel time, a gap). */
  detail: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
});

export type PatternImportProblem = z.infer<typeof patternImportProblemSchema>;

export const patternImportPreviewRowSchema = z.object({
  rowNumber: z.int(),
  cells: z.partialRecord(patternImportColumnSchema, z.string()),
  problems: z.array(patternImportProblemSchema),
});

export type PatternImportPreviewRow = z.infer<typeof patternImportPreviewRowSchema>;

/** A warning of the engine over the file's lessons: listed, never a stop (`06`). */
export const patternImportWarningSchema = z.object({
  rule: z.string(),
  weekday: z.int().min(1).max(7).nullable(),
  /** The rows of the file whose lessons the warning names. */
  rows: z.array(z.int()),
  detail: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
});

export type PatternImportWarning = z.infer<typeof patternImportWarningSchema>;

export const patternImportPreviewSchema = z.object({
  importId: z.uuid(),
  versionId: z.uuid(),
  /** The day this file was already imported into the draft; `null` when it was not. */
  alreadyImportedOn: z.string().nullable(),
  rows: z.array(patternImportPreviewRowSchema),
  warnings: z.array(patternImportWarningSchema),
  /** The lessons the draft holds now, removed by the confirm (plan decision 3). */
  removes: z.array(z.uuid()),
  /** The lessons the file places. */
  lessons: z.int().min(0),
  clean: z.boolean(),
});

export type PatternImportPreview = z.infer<typeof patternImportPreviewSchema>;

/** The body of the preview: nothing to decide. */
export const patternImportPreviewRunSchema = z.strictObject({});

export type PatternImportPreviewRun = z.infer<typeof patternImportPreviewRunSchema>;

/** The body of the confirm: the lessons of the draft the person confirmed removing. */
export const patternImportConfirmSchema = z.strictObject({
  removes: z.array(z.uuid()).max(20000),
});

export type PatternImportConfirm = z.infer<typeof patternImportConfirmSchema>;

export const patternImportParamsSchema = z.object({ id: z.uuid(), importId: z.uuid() });

export type PatternImportParams = z.infer<typeof patternImportParamsSchema>;

export const patternImportTemplateQuerySchema = z.strictObject({
  language: z.enum(LANGUAGES),
});

export type PatternImportTemplateQuery = z.infer<typeof patternImportTemplateQuerySchema>;

/** The answer of the confirm: saved, with the counts; or the preview again (nothing saved). */
export const patternImportConfirmResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('saved'),
    removed: z.int().min(0),
    placed: z.int().min(1),
  }),
  z.object({ outcome: z.literal('not_clean'), preview: patternImportPreviewSchema }),
]);

export type PatternImportConfirmResult = z.infer<typeof patternImportConfirmResultSchema>;
