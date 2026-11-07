import {
  JOURNAL_TYPES,
  LANGUAGES,
  SUBJECT_COLOURS,
  SUBJECT_IMPORT_ANSWERS,
  SUBJECT_IMPORT_COLUMNS,
  SUBJECT_IMPORT_DAILY_COLUMNS,
  SUBJECT_IMPORT_MAX_ROWS,
  SUBJECT_IMPORT_QUARTERLY_COLUMNS,
  SUBJECT_IMPORT_SHEET,
  SUBJECT_IMPORT_WORDS,
  dailyWeightsSchema,
  newSubjectRecordSchema,
  quarterWeightsSchema,
  staffImportNameKey,
  type Language,
  type QuarterWeights,
  type SubjectImportAnswer,
  type SubjectImportColumn,
  type SubjectImportProblem,
  type SubjectImportRow,
  type SubjectImportSwitchColumn,
  type SubjectImportWords,
  type SubjectRecord,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { ApiException } from '../../http/api-exception.js';
import { gradesOf } from '../people/staff-import-read.js';
import { cellText, FIRST_DATA_ROW } from '../people/student-import-read.js';

/**
 * Reading the system's template of the subject import (the owner's change of
 * 7 November 2026, pull request #316; `05`, "Excel import of subjects"), in
 * the way of the staff import: only the system's template, the lists in any
 * of the three languages or as codes, the department by any of its three
 * names, and every value through the schemas of the hand form
 * (`newSubjectRecordSchema`, `quarterWeightsSchema`), so that a value
 * refused by hand is refused here. Pure: the service hands in the departments.
 */

const notTemplate = () => new ApiException('import_not_template', 422);

/** The rows of an upload: the sheet whose first row holds exactly the keys, in order; empty rows skipped. */
export async function readSubjectImportWorkbook(bytes: Buffer): Promise<SubjectImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS types its own Buffer; a Node Buffer is one.
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  } catch {
    throw notTemplate();
  }
  const sheet = workbook.getWorksheet(SUBJECT_IMPORT_SHEET);
  if (sheet === undefined) {
    throw notTemplate();
  }
  const keys = sheet.getRow(1);
  const marked = SUBJECT_IMPORT_COLUMNS.every(
    (column, index) => cellText(keys.getCell(index + 1).value) === column,
  );
  if (!marked || cellText(keys.getCell(SUBJECT_IMPORT_COLUMNS.length + 1).value) !== undefined) {
    throw notTemplate();
  }
  const rows: SubjectImportRow[] = [];
  for (let number = FIRST_DATA_ROW; number <= sheet.rowCount; number += 1) {
    const row = sheet.getRow(number);
    const cells: Partial<Record<SubjectImportColumn, string>> = {};
    SUBJECT_IMPORT_COLUMNS.forEach((column, index) => {
      const text = cellText(row.getCell(index + 1).value)?.trim();
      if (text !== undefined && text !== '') {
        cells[column] = text;
      }
    });
    if (Object.keys(cells).length > 0) {
      rows.push({ rowNumber: number, cells });
      if (rows.length > SUBJECT_IMPORT_MAX_ROWS) {
        throw new ApiException('import_too_many_rows', 422);
      }
    }
  }
  if (rows.length === 0) {
    throw new ApiException('import_empty', 422);
  }
  return rows;
}

/** A value of a list compared as typed: case, outer and repeated spaces and apostrophes ignored. */
const listKey = (text: string): string =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[ʻʼ'`‘’]/g, '')
    .replace(/[\s_]+/g, ' ')
    .trim();

/** The values of a list as they may be typed: the code, or its words in any of the three languages. */
function listOf<T extends string>(
  codes: readonly T[],
  words: (texts: SubjectImportWords) => Record<T, string>,
): ReadonlyMap<string, T> {
  const found = new Map<string, T>();
  for (const code of codes) {
    found.set(listKey(code), code);
    for (const language of LANGUAGES) {
      found.set(listKey(words(SUBJECT_IMPORT_WORDS[language])[code]), code);
    }
  }
  return found;
}

const COLOUR_VALUES = listOf(SUBJECT_COLOURS, (words) => words.colours);
const JOURNAL_VALUES = listOf(JOURNAL_TYPES, (words) => words.journalTypes);
const ANSWER_VALUES = listOf(SUBJECT_IMPORT_ANSWERS, (words) => words.answers);

/** A department of the school by its three names; `academic` when of the built-in Academic division. */
export interface ImportDepartment {
  id: string;
  names: readonly string[];
  academic: boolean;
}

/** The value of a switch left empty: the default of the hand form (`05`: "language rule switch (on by default)"). */
const SWITCH_DEFAULTS: Readonly<Record<SubjectImportSwitchColumn, boolean>> = {
  ratingExam: false,
  groupSubject: false,
  languageRule: true,
  demanding: false,
};

/** A row read and checked on its own: the create the hand form would send and the quarterly distribution, or its problems. */
export interface ParsedSubjectRow {
  rowNumber: number;
  /** The record as the hand form sends it; `null` when the row has problems. */
  record: SubjectRecord | null;
  /** The quarterly distribution of a graded row; `null` for an attendance-only row or with the record. */
  quarterly: QuarterWeights | null;
  problems: SubjectImportProblem[];
  /** For the preview: the names as read, even when the row has problems. */
  shown: { uz: string | null; ru: string | null; en: string | null };
}

/** The column a path of `newSubjectRecordSchema` is typed in. */
export function subjectColumnOfPath(path: readonly PropertyKey[]): SubjectImportColumn | null {
  const [first, second] = path.map(String);
  switch (first) {
    case 'names':
      return second === 'uz'
        ? 'nameUz'
        : second === 'ru'
          ? 'nameRu'
          : second === 'en'
            ? 'nameEn'
            : null;
    case 'departmentId':
      return 'department';
    case 'grades':
    case 'colour':
    case 'journalType':
    case 'ratingExam':
    case 'groupSubject':
    case 'languageRule':
    case 'demanding':
      return first;
    case 'daily':
      return second === 'classwork'
        ? 'dailyClasswork'
        : second === 'homework'
          ? 'dailyHomework'
          : 'dailyAttendance';
    default:
      return null;
  }
}

/** The one department a name stands for among the active ones, or why there is none. */
function departmentOf(
  departments: readonly ImportDepartment[],
  text: string,
): ImportDepartment | 'name_unknown' | 'name_ambiguous' | 'department_not_academic' {
  const key = staffImportNameKey(text);
  const found = departments.filter((one) =>
    one.names.some((name) => staffImportNameKey(name) === key),
  );
  if (found.length === 0) {
    return 'name_unknown';
  }
  // A department of Academic first: a subject belongs to one of those (the hand form's list).
  const academic = found.filter((one) => one.academic);
  const [only] = academic;
  if (academic.length === 1 && only !== undefined) {
    return only;
  }
  if (academic.length > 1) {
    return 'name_ambiguous';
  }
  return 'department_not_academic';
}

/** A weight cell as a whole number, or `undefined` when it is not one. */
const weightOf = (text: string): number | undefined =>
  /^\d{1,3}$/.test(text) ? Number(text) : undefined;

/**
 * Reads one row into the record the hand form would send and the quarterly
 * distribution of a graded row. A graded row needs its daily and quarterly
 * cells, the quarterly rating exam cell exactly when the rating exam switch
 * is on (the shape `weights_shape_mismatch` requires by hand), and each
 * distribution totalling 100; an attendance-only row has no weights and no
 * rating exam.
 */
export function parseSubjectImportRow(
  row: SubjectImportRow,
  departments: readonly ImportDepartment[],
): ParsedSubjectRow {
  const problems: SubjectImportProblem[] = [];
  const cell = (column: SubjectImportColumn): string | undefined => row.cells[column];
  const problem = (column: SubjectImportColumn | null, code: string) => {
    if (!problems.some((one) => one.column === column && column !== null)) {
      problems.push({ column, code });
    }
  };
  const listed = <T extends string>(
    column: SubjectImportColumn,
    values: ReadonlyMap<string, T>,
  ): T | null => {
    const text = cell(column);
    if (text === undefined) {
      return null;
    }
    const value = values.get(listKey(text));
    if (value === undefined) {
      problem(column, 'value_unknown');
      return null;
    }
    return value;
  };

  for (const column of ['nameUz', 'nameRu', 'nameEn'] as const) {
    if (cell(column) === undefined) {
      problem(column, 'required');
    }
  }

  let departmentId: string | null = null;
  const departmentText = cell('department');
  if (departmentText === undefined) {
    problem('department', 'required');
  } else {
    const department = departmentOf(departments, departmentText);
    if (typeof department === 'string') {
      problem('department', department);
    } else {
      departmentId = department.id;
    }
  }

  let grades: number[] = [];
  const gradesText = cell('grades');
  if (gradesText === undefined) {
    problem('grades', 'required');
  } else {
    const read = gradesOf(gradesText);
    if (read === undefined) {
      problem('grades', 'grades_invalid');
    } else {
      grades = read;
    }
  }

  const colour = listed('colour', COLOUR_VALUES);
  if (colour === null && cell('colour') === undefined) {
    problem('colour', 'required');
  }
  // An empty journal type is graded, the hand form's default.
  const journalType = listed('journalType', JOURNAL_VALUES) ?? 'graded';
  const switches = {} as Record<SubjectImportSwitchColumn, boolean>;
  for (const column of ['ratingExam', 'groupSubject', 'languageRule', 'demanding'] as const) {
    const answer: SubjectImportAnswer | null = listed(column, ANSWER_VALUES);
    switches[column] = answer === null ? SWITCH_DEFAULTS[column] : answer === 'yes';
  }
  const graded = journalType === 'graded' && !problems.some((one) => one.column === 'journalType');

  // The weights: whole numbers, through the hand schemas.
  const weights = new Map<SubjectImportColumn, number>();
  for (const column of [...SUBJECT_IMPORT_DAILY_COLUMNS, ...SUBJECT_IMPORT_QUARTERLY_COLUMNS]) {
    const text = cell(column);
    if (text === undefined) {
      continue;
    }
    if (!graded) {
      if (journalType === 'attendance_only') {
        problem(column, 'weights_attendance_only');
      }
      continue;
    }
    const value = weightOf(text);
    if (value === undefined) {
      problem(column, 'weight_invalid');
      continue;
    }
    weights.set(column, value);
  }
  if (journalType === 'attendance_only' && switches.ratingExam) {
    problem('ratingExam', 'rating_exam_attendance_only');
  }

  let daily: SubjectRecord['daily'] = null;
  let quarterly: QuarterWeights | null = null;
  // A rating exam switch that cannot be read decides no shape of the quarterly distribution.
  const ratingKnown = !problems.some((one) => one.column === 'ratingExam');
  if (graded) {
    const required = [
      ...SUBJECT_IMPORT_DAILY_COLUMNS,
      ...(ratingKnown
        ? ([
            'quarterAttendance',
            'quarterClasswork',
            'quarterHomework',
            ...(switches.ratingExam ? (['quarterRatingExam'] as const) : []),
          ] as const)
        : []),
    ] as const;
    for (const column of required) {
      if (cell(column) === undefined) {
        problem(column, 'required');
      }
    }
    if (ratingKnown && !switches.ratingExam && cell('quarterRatingExam') !== undefined) {
      problem('quarterRatingExam', 'rating_exam_weight_unwanted');
    }
    const value = (column: SubjectImportColumn) => weights.get(column) ?? 0;
    const dailyRead = {
      attendance: value('dailyAttendance'),
      classwork: value('dailyClasswork'),
      homework: value('dailyHomework'),
    };
    const quarterRead = {
      attendance: value('quarterAttendance'),
      classwork: value('quarterClasswork'),
      homework: value('quarterHomework'),
      ratingExam: switches.ratingExam ? value('quarterRatingExam') : null,
    };
    const dailyColumns = SUBJECT_IMPORT_DAILY_COLUMNS;
    const quarterColumns = SUBJECT_IMPORT_QUARTERLY_COLUMNS;
    const taken = (columns: readonly SubjectImportColumn[]) =>
      problems.some((one) => one.column !== null && columns.includes(one.column));
    if (!taken(dailyColumns)) {
      // The bounds of a part are the hand schema's; a part out of them, or a total
      // other than 100, is told on the distribution's first column.
      const parsed = dailyWeightsSchema.safeParse(dailyRead);
      if (parsed.success) {
        daily = parsed.data;
      } else {
        const part = partOf(parsed.error.issues, 'daily');
        problem(part ?? 'dailyAttendance', part === null ? 'weights_total' : 'weight_invalid');
      }
    }
    if (ratingKnown && !taken(quarterColumns)) {
      const parsed = quarterWeightsSchema.safeParse(quarterRead);
      if (parsed.success) {
        quarterly = parsed.data;
      } else {
        const part = partOf(parsed.error.issues, 'quarter');
        problem(part ?? 'quarterAttendance', part === null ? 'weights_total' : 'weight_invalid');
      }
    }
  }

  const candidate = {
    names: { uz: cell('nameUz') ?? '', ru: cell('nameRu') ?? '', en: cell('nameEn') ?? '' },
    departmentId: departmentId ?? NO_ID,
    grades,
    colour: colour ?? 'blue',
    journalType,
    ...switches,
    daily,
  };
  const parsed = newSubjectRecordSchema.safeParse(candidate);
  if (!parsed.success) {
    const taken = new Set(problems.map((found) => found.column));
    // The daily distribution of a row whose daily cells or journal type are told already.
    const dailyTold = problems.some(
      (found) =>
        found.column !== null &&
        (found.column === 'journalType' || SUBJECT_IMPORT_DAILY_COLUMNS.includes(found.column)),
    );
    for (const issue of parsed.error.issues) {
      const column = subjectColumnOfPath(issue.path);
      // A column already told, or the daily distribution of a row whose daily cells are told.
      if (
        (column !== null && taken.has(column)) ||
        (column?.startsWith('daily') === true && dailyTold)
      ) {
        continue;
      }
      taken.add(column);
      problems.push({ column, code: 'invalid' });
    }
  }
  const ok = parsed.success && problems.length === 0;
  return {
    rowNumber: row.rowNumber,
    record: ok ? parsed.data : null,
    quarterly: ok ? quarterly : null,
    problems,
    shown: {
      uz: cell('nameUz') ?? null,
      ru: cell('nameRu') ?? null,
      en: cell('nameEn') ?? null,
    },
  };
}

/**
 * The column of the first part of a distribution out of the bounds of the hand schema, or
 * `null` when the distribution is refused only for its total (told on its first column).
 */
function partOf(
  issues: readonly { path: readonly PropertyKey[] }[],
  distribution: 'daily' | 'quarter',
): SubjectImportColumn | null {
  const part = issues.map((issue) => String(issue.path[0])).find((key) => key !== 'total');
  if (part === undefined) {
    return null;
  }
  const column = `${distribution}${part.charAt(0).toUpperCase()}${part.slice(1)}`;
  return (SUBJECT_IMPORT_COLUMNS as readonly string[]).includes(column)
    ? (column as SubjectImportColumn)
    : `${distribution}Attendance`;
}

/** A department id that names nothing, for a row whose department is not found (the row has a problem). */
const NO_ID = '00000000-0000-4000-8000-000000000000';

/** The name columns, each with the language its unique index compares. */
const NAME_COLUMNS: readonly { column: SubjectImportColumn; language: Language }[] = [
  { column: 'nameUz', language: 'uz' },
  { column: 'nameRu', language: 'ru' },
  { column: 'nameEn', language: 'en' },
];

/**
 * The names two rows of the file share in the same language, compared as the
 * unique indexes of active subjects compare them (`lower(btrim(name_xx))`,
 * db/migrations/0020): both rows are told. The same word in two languages is
 * no duplicate.
 */
export function subjectFileChecks(
  rows: readonly SubjectImportRow[],
): Map<number, SubjectImportProblem[]> {
  const problems = new Map<number, SubjectImportProblem[]>();
  for (const { column } of NAME_COLUMNS) {
    const byKey = new Map<string, number[]>();
    for (const row of rows) {
      const name = row.cells[column];
      if (name === undefined) {
        continue;
      }
      const key = name.trim().toLowerCase();
      byKey.set(key, [...(byKey.get(key) ?? []), row.rowNumber]);
    }
    for (const numbers of byKey.values()) {
      if (numbers.length < 2) {
        continue;
      }
      for (const number of numbers) {
        problems.set(number, [
          ...(problems.get(number) ?? []),
          {
            column,
            code: 'duplicate_in_file',
            rows: numbers.filter((other) => other !== number),
          },
        ]);
      }
    }
  }
  return problems;
}
