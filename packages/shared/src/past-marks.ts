import { z } from 'zod';
import { LANGUAGES, type Language } from './language.js';
import { accountNamedSchema } from './reset-entries.js';

/**
 * Past marks from before go-live (task 11.26; `10`, Past marks from before go-live;
 * `edge/academic-year`, Past marks from before go-live). A branch that went live in the middle of
 * the year imports the attendance, classwork and homework of its lessons before its go-live date
 * from the system's Excel template, for parents only. One row is one student, one date, one
 * subject; a second work of one kind in the same lesson is a further row. Preview first; all rows
 * or none; at most 50,000 rows a file; the same file not twice while its upload stands. The Super
 * Admin, and the Academic Vice Principal for their own branch.
 */

/** The columns of the template, in their order; row 1 of the sheet holds these keys (hidden). */
export const PAST_MARK_COLUMNS = [
  'uid',
  'lastName',
  'firstName',
  'date',
  'subject',
  'lesson',
  'attendance',
  'classworkTitle',
  'classworkTotal',
  'classworkScore',
  'homeworkTitle',
  'homeworkTotal',
  'homeworkScore',
] as const;

export type PastMarkColumn = (typeof PAST_MARK_COLUMNS)[number];

export const pastMarkColumnSchema = z.enum(PAST_MARK_COLUMNS);

/** The name of the template's sheet; with the row of keys it marks the system's template. */
export const PAST_MARK_SHEET = 'Past marks';

/** `10`, The file: "A file holds at most 50,000 rows". */
export const PAST_MARK_MAX_ROWS = 50_000;

/**
 * The largest file taken (plan decision 2): 50,000 rows of 13 columns can pass the 5 MB of the
 * other imports.
 */
export const PAST_MARK_IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/** The highest lesson number of one subject on one day (plan decision 7). */
export const PAST_MARK_MAX_LESSON = 12;

/** `10`, The rules of a row: "The title is at most 60 characters". */
export const PAST_MARK_TITLE_MAX = 60;

/** The rows of one page of the preview (plan decision 14). */
export const PAST_MARK_PREVIEW_PAGE = 500;

/** The kinds of work a row carries. */
export const PAST_WORK_KINDS = ['classwork', 'homework'] as const;

export type PastWorkKind = (typeof PAST_WORK_KINDS)[number];

/** The headings of the template in one language. */
export const PAST_MARK_HEADINGS: Readonly<Record<Language, Record<PastMarkColumn, string>>> = {
  uz: {
    uid: 'UID',
    lastName: 'Familiya',
    firstName: 'Ism',
    date: 'Sana',
    subject: 'Fan',
    lesson: 'Dars',
    attendance: 'Davomat',
    classworkTitle: 'Sinf ishi: nomi',
    classworkTotal: 'Sinf ishi: jami',
    classworkScore: 'Sinf ishi: ball',
    homeworkTitle: 'Uy vazifasi: nomi',
    homeworkTotal: 'Uy vazifasi: jami',
    homeworkScore: 'Uy vazifasi: ball',
  },
  ru: {
    uid: 'UID',
    lastName: 'Фамилия',
    firstName: 'Имя',
    date: 'Дата',
    subject: 'Предмет',
    lesson: 'Урок',
    attendance: 'Посещаемость',
    classworkTitle: 'Классная работа: название',
    classworkTotal: 'Классная работа: максимум',
    classworkScore: 'Классная работа: балл',
    homeworkTitle: 'Домашнее задание: название',
    homeworkTotal: 'Домашнее задание: максимум',
    homeworkScore: 'Домашнее задание: балл',
  },
  en: {
    uid: 'UID',
    lastName: 'Surname',
    firstName: 'First name',
    date: 'Date',
    subject: 'Subject',
    lesson: 'Lesson',
    attendance: 'Attendance',
    classworkTitle: 'Classwork: title',
    classworkTotal: 'Classwork: total',
    classworkScore: 'Classwork: score',
    homeworkTitle: 'Homework: title',
    homeworkTotal: 'Homework: total',
    homeworkScore: 'Homework: score',
  },
};

/** The heading row of the template: each column in Uzbek, Russian and English. */
export const pastMarkHeadingRow = (): string[] =>
  PAST_MARK_COLUMNS.map((column) =>
    LANGUAGES.map((language) => PAST_MARK_HEADINGS[language][column]).join(' / '),
  );

/**
 * The key a work's title is compared by for a repeat: case, apostrophes and spacing left out (the
 * spelling rules of `edge/academic-year` applied to titles). The same as the generated
 * `past_works.title_key` of 0190 (`past_mark_title_key`); a database test runs the same titles
 * through both.
 */
export const pastMarkTitleKey = (title: string): string =>
  title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ʻʼ'`‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** One row of an upload as read from the sheet, every cell as text. Kept in `past_mark_uploads.rows`. */
export const pastMarkImportRowSchema = z.object({
  rowNumber: z.int().min(1),
  cells: z.partialRecord(pastMarkColumnSchema, z.string()),
});

export type PastMarkImportRow = z.infer<typeof pastMarkImportRowSchema>;

export const pastMarkImportRowsSchema = z.array(pastMarkImportRowSchema);

/** The kinds of problem of a row (`10`, The rules of a row; `edge/academic-year`). */
export const PAST_MARK_PROBLEMS = [
  /** A cell that must be filled is empty. */
  'required',
  /** A value that cannot be read (a lesson that is not a whole number from 1 to 12, a mark not 0 to 5). */
  'invalid',
  /** No student of the school has this UID. */
  'uid_unknown',
  /** The student is not a student of the branch of the import. */
  'student_other_branch',
  /** The surname or first name is not the record's (after the spelling rules). */
  'name_mismatch',
  /** Not a date (`yyyy-mm-dd`, `dd.mm.yyyy` or an Excel date). */
  'date_invalid',
  /** The branch has no go-live date: there is no "before go-live". */
  'no_go_live',
  /** On or after the branch's go-live date. */
  'date_not_before_go_live',
  /** Outside the branch's current academic year. */
  'date_outside_year',
  /** In the year but in no quarter of it (plan decision 20). */
  'date_outside_quarter',
  /** Not a school day of the calendar for the student's grade (plan decision 19). */
  'date_not_school_day',
  /** No subject is named so in any of the three languages. */
  'subject_unknown',
  /** Two subjects share this name. */
  'subject_ambiguous',
  /** A classwork or homework on an attendance-only subject. */
  'subject_attendance_only',
  /** A work's three cells are not all filled or all empty. */
  'work_incomplete',
  /** A title of more than 60 characters. */
  'title_too_long',
  /** A comma as the decimal separator. */
  'amount_comma',
  /** More than two digits after the point. */
  'amount_decimals',
  /** Not a number. */
  'amount_invalid',
  /** A total outside 1 to 1000. */
  'total_range',
  /** A score below 0 or above the total. */
  'score_range',
  /** Neither an attendance mark nor a work. */
  'row_empty',
  /** A second attendance mark of the same lesson in the file. */
  'attendance_repeated_in_file',
  /** The same work (lesson, kind, title) twice in the file. */
  'work_repeated_in_file',
  /** The lesson already has an attendance mark in an upload that stands. */
  'attendance_already_imported',
  /** The same work stands in an upload already. */
  'work_already_imported',
] as const;

export type PastMarkProblemCode = (typeof PAST_MARK_PROBLEMS)[number];

export const pastMarkProblemSchema = z.object({
  column: pastMarkColumnSchema.nullable(),
  code: z.enum(PAST_MARK_PROBLEMS),
  /** The other rows of the file a repeat is on. */
  rows: z.array(z.int()).optional(),
});

export type PastMarkProblem = z.infer<typeof pastMarkProblemSchema>;

export const pastMarkPreviewRowSchema = z.object({
  rowNumber: z.int(),
  /** The cells as read, for the person to find the row. */
  uid: z.string().nullable(),
  name: z.string().nullable(),
  date: z.string().nullable(),
  subject: z.string().nullable(),
  problems: z.array(pastMarkProblemSchema),
});

export type PastMarkPreviewRow = z.infer<typeof pastMarkPreviewRowSchema>;

export const pastMarkPreviewSchema = z.object({
  importId: z.uuid(),
  fileName: z.string(),
  /** The day an upload of the same file that still stands was confirmed; `null` when none stands. */
  alreadyImportedOn: z.string().nullable(),
  /** Rows of the file, rows with a problem, clean rows. */
  counts: z.object({
    rows: z.int().min(0),
    withProblems: z.int().min(0),
    clean: z.int().min(0),
  }),
  /** The page shown, from 1, of `pageCount`; rows with problems first. */
  page: z.int().min(1),
  pageCount: z.int().min(1),
  rows: z.array(pastMarkPreviewRowSchema),
  /** No row has a problem. */
  clean: z.boolean(),
});

export type PastMarkPreview = z.infer<typeof pastMarkPreviewSchema>;

/** The body of the preview: the page asked for. */
export const pastMarkPreviewBodySchema = z.strictObject({ page: z.int().min(1).default(1) });

export type PastMarkPreviewBody = z.infer<typeof pastMarkPreviewBodySchema>;

/** The body of the confirm: nothing to decide. */
export const pastMarkConfirmBodySchema = z.strictObject({});

export type PastMarkConfirmBody = z.infer<typeof pastMarkConfirmBodySchema>;

export const pastMarkUploadParamsSchema = z.object({ id: z.uuid() });

export type PastMarkUploadParams = z.infer<typeof pastMarkUploadParamsSchema>;

export const pastMarkTemplateQuerySchema = z.strictObject({ language: z.enum(LANGUAGES) });

export type PastMarkTemplateQuery = z.infer<typeof pastMarkTemplateQuerySchema>;

/** The query of the upload: the file's name, shown in the list of uploads. */
export const pastMarkUploadQuerySchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
});

export type PastMarkUploadQuery = z.infer<typeof pastMarkUploadQuerySchema>;

/** The answer of the confirm: saved, with what was written; or the preview again (nothing saved). */
export const pastMarkConfirmResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('saved'),
    rows: z.int().min(1),
    attendance: z.int().min(0),
    works: z.int().min(0),
  }),
  z.object({ outcome: z.literal('not_clean'), preview: pastMarkPreviewSchema }),
]);

export type PastMarkConfirmResult = z.infer<typeof pastMarkConfirmResultSchema>;

/** The withdrawal of a whole upload, with a reason (`10`, Withdrawal). */
export const pastMarkWithdrawBodySchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
});

export type PastMarkWithdrawBody = z.infer<typeof pastMarkWithdrawBodySchema>;

/** An upload of the list (`10`, The upload: "file name, who, when, the number of rows, and whether it stands or was withdrawn"). */
export const pastMarkUploadSchema = z.object({
  id: z.uuid(),
  fileName: z.string(),
  rowCount: z.int().min(1),
  confirmedBy: accountNamedSchema,
  confirmedAt: z.iso.datetime({ offset: true }),
  withdrawn: z
    .object({
      by: accountNamedSchema,
      at: z.iso.datetime({ offset: true }),
      reason: z.string(),
    })
    .nullable(),
});

export type PastMarkUpload = z.infer<typeof pastMarkUploadSchema>;

export const pastMarkUploadListSchema = z.object({ uploads: z.array(pastMarkUploadSchema) });

export type PastMarkUploadList = z.infer<typeof pastMarkUploadListSchema>;
