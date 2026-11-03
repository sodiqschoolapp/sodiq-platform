import { z } from 'zod';
import { EXPORT_TEXTS } from './exports.js';
import { LANGUAGES, type Language } from './language.js';
import { relativeHolderSchema } from './relatives.js';

/**
 * The student import from the system's Excel template (task 9.4g; `04`,
 * Student record: Excel import; the owner's spec change of 3 November 2026).
 * One row is one student: every typed field of the record, the UID, the
 * start date, the class (grade and name), the contract, the scholarship and up
 * to three close relatives, the first the main contact.
 */

/** Up to three relatives on a row (the spec change: "up to three close relatives"). */
export const IMPORT_RELATIVES = 3;

const RELATIVE_PARTS = ['FullName', 'Relationship', 'Phone', 'Workplace', 'Email'] as const;

export type ImportRelativePart = (typeof RELATIVE_PARTS)[number];

/** The relative columns of one position, `relative1FullName` and so on. */
export const relativeColumnsOf = <P extends 1 | 2 | 3>(position: P) =>
  RELATIVE_PARTS.map(
    (part) => `relative${String(position)}${part}` as `relative${P}${ImportRelativePart}`,
  );

/**
 * The columns of the template, in their order. Row 1 of the sheet holds
 * these keys (hidden): the mark of the system's template (plan decision 8).
 */
export const STUDENT_IMPORT_COLUMNS = [
  'uid',
  'lastName',
  'firstName',
  'paternalName',
  'sex',
  'birthDate',
  'grade',
  'className',
  'startsOn',
  'documentType',
  'documentNumber',
  'jshshir',
  'phone',
  'email',
  'address',
  'region',
  'previousSchool',
  'diagnosticScore',
  'contractNumber',
  'contractSignedOn',
  'scholarshipType',
  'scholarshipCoverage',
  'scholarshipAmount',
  'consentSignedOn',
  ...relativeColumnsOf(1),
  ...relativeColumnsOf(2),
  ...relativeColumnsOf(3),
] as const;

export type StudentImportColumn = (typeof STUDENT_IMPORT_COLUMNS)[number];

export const studentImportColumnSchema = z.enum(STUDENT_IMPORT_COLUMNS);

/** The name of the template's sheet; with the row of keys it marks the system's template. */
export const STUDENT_IMPORT_SHEET = 'Students';

/** The name of the sheet of allowed values. */
export const STUDENT_IMPORT_LISTS_SHEET = 'Lists';

/** At most this many rows in one file (plan decision 10). */
export const STUDENT_IMPORT_MAX_ROWS = 1000;

/** The largest file taken, in bytes (plan decision 10). */
export const STUDENT_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/** The media type of the upload: an Excel workbook. */
export const STUDENT_IMPORT_TYPES: readonly string[] = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

interface ImportWords {
  lastName: string;
  firstName: string;
  className: string;
  relative: string;
  parts: Record<ImportRelativePart, string>;
}

const WORDS: Readonly<Record<Language, ImportWords>> = {
  uz: {
    lastName: 'Familiya',
    firstName: 'Ism',
    className: 'Sinf nomi',
    relative: '{{n}}-yaqin qarindosh',
    parts: {
      FullName: 'F.I.Sh.',
      Relationship: 'Qarindoshlik',
      Phone: 'Asosiy telefon',
      Workplace: 'Ish joyi',
      Email: 'Elektron pochta',
    },
  },
  ru: {
    lastName: 'Фамилия',
    firstName: 'Имя',
    className: 'Название класса',
    relative: 'Близкий родственник {{n}}',
    parts: {
      FullName: 'ФИО',
      Relationship: 'Родство',
      Phone: 'Основной телефон',
      Workplace: 'Место работы',
      Email: 'Электронная почта',
    },
  },
  en: {
    lastName: 'Surname',
    firstName: 'Name',
    className: 'Class name',
    relative: 'Relative {{n}}',
    parts: {
      FullName: 'Full name',
      Relationship: 'Relationship',
      Phone: 'Main phone',
      Workplace: 'Workplace',
      Email: 'Email',
    },
  },
};

const RELATIVE_COLUMN = /^relative(\d)(FullName|Relationship|Phone|Workplace|Email)$/;

/** The heading of a column in one language: the student list's own words where it has them. */
export function importHeading(column: StudentImportColumn, language: Language): string {
  const words = WORDS[language];
  const relative = RELATIVE_COLUMN.exec(column);
  if (relative !== null) {
    const [, position = '', part = ''] = relative;
    return `${words.relative.replace('{{n}}', position)}: ${words.parts[part as ImportRelativePart]}`;
  }
  if (column === 'lastName' || column === 'firstName' || column === 'className') {
    return words[column];
  }
  const own: string | undefined = (
    EXPORT_TEXTS[language].students.columns as Record<string, string>
  )[column];
  if (own === undefined) {
    throw new Error(`No heading for ${column}.`);
  }
  return own;
}

/** The heading row of the template: each column in Uzbek, Russian and English. */
export const importHeadingRow = (): string[] =>
  STUDENT_IMPORT_COLUMNS.map((column) =>
    LANGUAGES.map((language) => importHeading(column, language)).join(' / '),
  );

/**
 * One row of an upload as read from the sheet, before it is checked: every
 * cell as text (a date cell as `dd.mm.yyyy`, a number cell as its digits),
 * `null` for an empty cell. Kept in `student_imports.rows` (plan decision 2).
 */
export const studentImportRowSchema = z.object({
  /** The row number of the sheet, as Excel shows it. */
  rowNumber: z.int().min(1),
  cells: z.partialRecord(studentImportColumnSchema, z.string()),
});

export type StudentImportRow = z.infer<typeof studentImportRowSchema>;

export const studentImportRowsSchema = z.array(studentImportRowSchema);

/**
 * The kinds of problem of a row found before the save; a refusal of the save
 * itself carries the API's own error code (`ERROR_CODES`).
 */
export const STUDENT_IMPORT_PROBLEMS = [
  /** A required cell is empty. */
  'required',
  /** A value the field does not take (as the hand form refuses it). */
  'invalid',
  /** Not a real date, nor `dd.mm.yyyy`. */
  'date_invalid',
  /** A phone that cannot be brought to one format. */
  'phone_invalid',
  /** A value of a list (sex, region, relationship …) not known in any of the three languages. */
  'value_unknown',
  /** No class of that grade and name in the branch for the year of the start date. */
  'class_unknown',
  /** A start date today or earlier needs a class (task 3.1b, decision 2). */
  'needs_class',
  /** A row without a relative (`04`, Close relatives: Always connected). */
  'needs_relative',
  /** The same UID, JSHSHIR, document number or contract number on another row. */
  'duplicate_in_file',
  /** The same relative phone under another name on another row. */
  'phone_two_names_in_file',
  /** The relative phone is held in the system under another name: link or correct. */
  'phone_held',
] as const;

/** One problem of a row: the column it is in (or none), its code and what it names. */
export const studentImportProblemSchema = z.object({
  column: studentImportColumnSchema.nullable(),
  code: z.string(),
  /** The other rows of the file a duplicate is on. */
  rows: z.array(z.int()).optional(),
  /** The student of the branch that holds a value (as the hand create names it). */
  recordId: z.uuid().optional(),
  /** The holder is a student of another branch: nothing more is told. */
  elsewhere: z.boolean().optional(),
});

export type StudentImportProblem = z.infer<typeof studentImportProblemSchema>;

/** A relative phone held in the system under another name, with the holder as the phone match shows it. */
export const studentImportHolderSchema = z.object({
  position: z.int().min(1).max(IMPORT_RELATIVES),
  holder: relativeHolderSchema,
  /** The row is decided: linked to this holder. */
  linked: z.boolean(),
});

export const studentImportPreviewRowSchema = z.object({
  rowNumber: z.int(),
  uid: z.string().nullable(),
  lastName: z.string().nullable(),
  firstName: z.string().nullable(),
  /** The class as read, "7 Oxford"; `null` without one. */
  className: z.string().nullable(),
  problems: z.array(studentImportProblemSchema),
  /**
   * The duplicate warning (edge, the duplicate check: "a matching name and
   * date of birth ... gives a warning that must be confirmed"): the students
   * of the branch named, of other branches only whether one exists, and the
   * earlier rows of the file with the same name and date.
   */
  warning: z
    .object({
      students: z.array(z.object({ id: z.uuid(), uid: z.string() })),
      elsewhere: z.boolean(),
      rows: z.array(z.int()),
      confirmed: z.boolean(),
    })
    .nullable(),
  /** The relative phones held under another name, each to be linked or corrected. */
  held: z.array(studentImportHolderSchema),
  /** The relatives that will be linked to a person the system holds under the same name. */
  linked: z.array(z.int().min(1).max(IMPORT_RELATIVES)),
});

export type StudentImportPreviewRow = z.infer<typeof studentImportPreviewRowSchema>;

export const studentImportPreviewSchema = z.object({
  importId: z.uuid(),
  /** The day this file was already imported into the branch; `null` when it was not. */
  alreadyImportedOn: z.string().nullable(),
  rows: z.array(studentImportPreviewRowSchema),
  /** No row has a problem and every warning and holder is decided. */
  clean: z.boolean(),
});

export type StudentImportPreview = z.infer<typeof studentImportPreviewSchema>;

/** The decisions sent with the preview and the confirm. */
export const studentImportDecisionsSchema = z.strictObject({
  /** The rows whose name and date of birth warning is confirmed (twins pass). */
  confirmedWarnings: z.array(z.int().min(1)).max(STUDENT_IMPORT_MAX_ROWS).default([]),
  /** "Link to the existing person, whose stored name is kept" (edge, the relative phone row). */
  relativeLinks: z
    .array(
      z.strictObject({
        rowNumber: z.int().min(1),
        position: z.int().min(1).max(IMPORT_RELATIVES),
        relativeId: z.uuid(),
      }),
    )
    .max(STUDENT_IMPORT_MAX_ROWS * IMPORT_RELATIVES)
    .default([]),
});

export type StudentImportDecisions = z.infer<typeof studentImportDecisionsSchema>;

export const studentImportParamsSchema = z.object({ id: z.uuid() });

export type StudentImportParams = z.infer<typeof studentImportParamsSchema>;

/** The template's language: the lists of values are written in it. */
export const studentImportTemplateQuerySchema = z.strictObject({
  language: z.enum(LANGUAGES),
});

export type StudentImportTemplateQuery = z.infer<typeof studentImportTemplateQuerySchema>;

/** The answer of the confirm: saved, or the preview again with what is not clean (nothing saved). */
export const studentImportConfirmResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('saved'),
    created: z.int().min(1),
    studentIds: z.array(z.uuid()),
  }),
  z.object({ outcome: z.literal('not_clean'), preview: studentImportPreviewSchema }),
]);

export type StudentImportConfirmResult = z.infer<typeof studentImportConfirmResultSchema>;
