import {
  availabilityRangeSchema,
  availabilitySetSchema,
  CONTRACT_TYPES,
  EDUCATION_LEVELS,
  FIRST_GRADE,
  LANGUAGES,
  LAST_GRADE,
  ROLES,
  SEXES,
  STAFF_IMPORT_COLUMNS,
  STAFF_IMPORT_HOURS_COLUMNS,
  STAFF_IMPORT_LANGUAGE_CHOICES,
  STAFF_IMPORT_MAX_ROWS,
  STAFF_IMPORT_ROLES,
  STAFF_IMPORT_SHEET,
  STAFF_IMPORT_SUBJECT_COLUMNS,
  STAFF_IMPORT_WORDS,
  languagesOfChoice,
  staffImportNameKey,
  staffRecordSchema,
  staffTeachingSchema,
  type AvailabilityRange,
  type Role,
  type StaffImportColumn,
  type StaffImportProblem,
  type StaffImportRole,
  type StaffImportRow,
  type StaffImportWords,
  type StaffRecord,
  type StaffTeaching,
  type Weekday,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { ApiException } from '../../http/api-exception.js';
import { cellText, dottedDateOf, FIRST_DATA_ROW } from './student-import-read.js';

/**
 * Reading the system's template of the staff import (task 9.4h; `04`, Teacher
 * and staff record: the import, "in the same way as students";
 * `edge/students-classes-groups`, the import row, which the spec change of 3
 * November 2026 applies to both imports: only the system's template, dates as
 * real dates or `dd.mm.yyyy`, phones to one format or the row fails,
 * look-alike letters the same, duplicates inside the file errors). Pure: the
 * service hands in the school's divisions, departments and subjects.
 */

const notTemplate = () => new ApiException('import_not_template', 422);

/** The rows of an upload: the sheet whose first row holds exactly the keys, in order; empty rows skipped. */
export async function readStaffImportWorkbook(bytes: Buffer): Promise<StaffImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS types its own Buffer; a Node Buffer is one.
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  } catch {
    throw notTemplate();
  }
  const sheet = workbook.getWorksheet(STAFF_IMPORT_SHEET);
  if (sheet === undefined) {
    throw notTemplate();
  }
  const keys = sheet.getRow(1);
  const marked = STAFF_IMPORT_COLUMNS.every(
    (column, index) => cellText(keys.getCell(index + 1).value) === column,
  );
  if (!marked || cellText(keys.getCell(STAFF_IMPORT_COLUMNS.length + 1).value) !== undefined) {
    throw notTemplate();
  }
  const rows: StaffImportRow[] = [];
  for (let number = FIRST_DATA_ROW; number <= sheet.rowCount; number += 1) {
    const row = sheet.getRow(number);
    const cells: Partial<Record<StaffImportColumn, string>> = {};
    STAFF_IMPORT_COLUMNS.forEach((column, index) => {
      const text = cellText(row.getCell(index + 1).value);
      if (text !== undefined) {
        cells[column] = text;
      }
    });
    if (Object.keys(cells).length > 0) {
      rows.push({ rowNumber: number, cells });
      if (rows.length > STAFF_IMPORT_MAX_ROWS) {
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
  words: (texts: StaffImportWords) => Record<T, string>,
): ReadonlyMap<string, T> {
  const found = new Map<string, T>();
  for (const code of codes) {
    found.set(listKey(code), code);
    for (const language of LANGUAGES) {
      found.set(listKey(words(STAFF_IMPORT_WORDS[language])[code]), code);
    }
  }
  return found;
}

const SEX_VALUES = listOf(SEXES, (words) => words.sexes);
const EDUCATION_VALUES = listOf(EDUCATION_LEVELS, (words) => words.educationLevels);
const CONTRACT_VALUES = listOf(CONTRACT_TYPES, (words) => words.contractTypes);
const LANGUAGE_VALUES = listOf(STAFF_IMPORT_LANGUAGE_CHOICES, (words) => words.languages);
const ROLE_VALUES = listOf(ROLES, (words) => words.roles);

/** A division, a department or a subject of the school, by its three names. */
export interface NamedRecord {
  id: string;
  names: readonly string[];
}

/** The school's lists the names of a row are found in (archived ones left out by the service). */
export interface SchoolLists {
  divisions: readonly (NamedRecord & { builtIn: boolean })[];
  departments: readonly (NamedRecord & { divisionId: string })[];
  subjects: readonly NamedRecord[];
}

/** The one record a name stands for, or why there is none. */
function findNamed<T extends NamedRecord>(
  records: readonly T[],
  text: string,
): T | 'name_unknown' | 'name_ambiguous' {
  const key = staffImportNameKey(text);
  const found = records.filter((record) =>
    record.names.some((name) => staffImportNameKey(name) === key),
  );
  if (found.length === 0) {
    return 'name_unknown';
  }
  const [only] = found;
  return found.length === 1 && only !== undefined ? only : 'name_ambiguous';
}

/**
 * The grades of a subject cell: "5, 6, 7", "5-7", "0–4" or a mix, each from 0
 * to 11; answered in ascending order, each once; `undefined` when unreadable.
 */
export function gradesOf(text: string): number[] | undefined {
  const grades = new Set<number>();
  for (const part of text.split(/[,;]/)) {
    const piece = part.trim();
    if (piece === '') {
      continue;
    }
    const range = /^(\d{1,2})\s*[-–—]\s*(\d{1,2})$/.exec(piece);
    const single = /^(\d{1,2})$/.exec(piece);
    let from: number;
    let to: number;
    if (range !== null) {
      from = Number(range[1]);
      to = Number(range[2]);
    } else if (single !== null) {
      from = Number(single[1]);
      to = from;
    } else {
      return undefined;
    }
    if (from > to || from < FIRST_GRADE || to > LAST_GRADE) {
      return undefined;
    }
    for (let grade = from; grade <= to; grade += 1) {
      grades.add(grade);
    }
  }
  return grades.size === 0 ? undefined : [...grades].sort((a, b) => a - b);
}

/** `8:00`, `08.00` or `08:00`: the hour and the minute as typed. */
const TIME = /^(\d{1,2})[:.](\d{2})$/;

/**
 * The ranges of one hours cell (`04`, Availability; the owner's spec change of
 * 7 November 2026): `08:00-16:05`, or several separated by commas or
 * semicolons. Each range is then checked by `availabilityRangeSchema`, the
 * schema of the hand route, so a range refused by hand is refused here; the
 * overlap of two ranges is checked with the whole row (`availabilitySetSchema`).
 */
export function hoursOf(
  weekday: Weekday,
  text: string,
): AvailabilityRange[] | 'hours_invalid' | 'hours_outside_day' | 'hours_end_before_start' {
  const ranges: AvailabilityRange[] = [];
  for (const part of text.split(/[,;]/)) {
    const piece = part.trim();
    if (piece === '') {
      continue;
    }
    const ends = piece.split(/\s*[-–—]\s*/);
    const [startText, endText] = ends;
    if (ends.length !== 2 || startText === undefined || endText === undefined) {
      return 'hours_invalid';
    }
    const start = TIME.exec(startText);
    const end = TIME.exec(endText);
    if (start === null || end === null) {
      return 'hours_invalid';
    }
    const time = (found: RegExpExecArray) =>
      `${(found[1] ?? '').padStart(2, '0')}:${found[2] ?? ''}`;
    const parsed = availabilityRangeSchema.safeParse({
      weekday,
      start: time(start),
      end: time(end),
    });
    if (!parsed.success) {
      // The times are read first: a time that is not of the day is told as such,
      // a range of two times of the day refused only by its order as that.
      const outside = parsed.error.issues.some((issue) => issue.code === 'invalid_format');
      return outside ? 'hours_outside_day' : 'hours_end_before_start';
    }
    ranges.push(parsed.data);
  }
  return ranges.length === 0 ? 'hours_invalid' : ranges;
}

/** A row read and checked on its own: the create and the teaching the hand screens would send, or its problems. */
export interface ParsedStaffRow {
  rowNumber: number;
  /** The record as the hand form sends it; `null` when the row has problems. */
  record: StaffRecord | null;
  /** The subjects and languages as the hand teaching form sends them; `null` with the record. */
  teaching: StaffTeaching | null;
  /** Teacher, Tutor or none. */
  role: StaffImportRole | null;
  /**
   * The hours of the row, Monday to Saturday, as the hand availability route
   * takes them (`null` with the record, and when every hours cell is empty:
   * the row adds no availability).
   */
  hours: AvailabilityRange[] | null;
  /** The subject columns of the subjects, in the order of `teaching.subjects`. */
  subjectColumns: Map<string, StaffImportColumn>;
  problems: StaffImportProblem[];
  /** For the preview: what was read, even when the row has problems. */
  shown: { lastName: string | null; firstName: string | null };
}

/** The column a path of `staffRecordSchema` is typed in. */
export function staffColumnOfPath(path: readonly PropertyKey[]): StaffImportColumn | null {
  const [first] = path.map(String);
  switch (first) {
    case undefined:
      return null;
    case 'divisions':
      return 'division';
    default:
      return (STAFF_IMPORT_COLUMNS as readonly string[]).includes(first)
        ? (first as StaffImportColumn)
        : null;
  }
}

/**
 * Reads one row into the record and the teaching the hand screens would
 * send: the lists in any of the three languages or as codes, the names of
 * the school's lists by any of their three names, dates as real dates or
 * `dd.mm.yyyy`, then every field through `staffRecordSchema` and
 * `staffTeachingSchema` themselves, so a value refused by hand is refused here.
 */
export function parseStaffImportRow(row: StaffImportRow, lists: SchoolLists): ParsedStaffRow {
  const problems: StaffImportProblem[] = [];
  const cell = (column: StaffImportColumn): string | undefined => row.cells[column];
  const problem = (column: StaffImportColumn, code: string) => {
    problems.push({ column, code });
  };
  const date = (column: StaffImportColumn, required: boolean): string | null => {
    const text = cell(column);
    if (text === undefined) {
      if (required) {
        problem(column, 'required');
      }
      return null;
    }
    const value = dottedDateOf(text);
    if (value === undefined) {
      problem(column, 'date_invalid');
      return null;
    }
    return value;
  };
  const listed = <T extends string>(
    column: StaffImportColumn,
    values: ReadonlyMap<string, T>,
    required: boolean,
  ): T | null => {
    const text = cell(column);
    if (text === undefined) {
      if (required) {
        problem(column, 'required');
      }
      return null;
    }
    const value = values.get(listKey(text));
    if (value === undefined) {
      problem(column, 'value_unknown');
      return null;
    }
    return value;
  };

  // Date of birth, phone and admission date may be left empty (owner, 7 November 2026).
  for (const column of ['lastName', 'firstName'] as const) {
    if (cell(column) === undefined) {
      problem(column, 'required');
    }
  }
  const sex = listed('sex', SEX_VALUES, true);
  const birthDate = date('birthDate', false);
  const educationLevel = listed('educationLevel', EDUCATION_VALUES, false);
  const admissionDate = date('admissionDate', false);
  const contractType = listed('contractType', CONTRACT_VALUES, false);
  const contractDate = date('contractDate', false);

  // The role: only Teacher or Tutor (`edge/people-roles-accounts`: "an import can create only
  // Teachers and Tutors"); every other role is told as such, an unknown word as unknown.
  let role: StaffImportRole | null = null;
  const roleText = cell('role');
  if (roleText !== undefined) {
    const found: Role | undefined = ROLE_VALUES.get(listKey(roleText));
    if (found === undefined) {
      problem('role', 'value_unknown');
    } else if ((STAFF_IMPORT_ROLES as readonly Role[]).includes(found)) {
      role = found as StaffImportRole;
    } else {
      problem('role', 'import_role_not_allowed');
    }
  }

  // The main division and its department (`04`, Academic: "Department: required in Academic").
  let divisionId: string | null = null;
  let departmentId: string | null = null;
  const divisionText = cell('division');
  if (divisionText === undefined) {
    problem('division', 'required');
  } else {
    const division = findNamed(lists.divisions, divisionText);
    if (typeof division === 'string') {
      problem('division', division);
    } else {
      divisionId = division.id;
      const departmentText = cell('department');
      if (departmentText !== undefined) {
        const department = findNamed(lists.departments, departmentText);
        if (typeof department === 'string') {
          // A name of no department of the school, or of several: told as the hand list would.
          const ofDivision = findNamed(
            lists.departments.filter((one) => one.divisionId === division.id),
            departmentText,
          );
          if (typeof ofDivision === 'string') {
            problem('department', department);
          } else {
            departmentId = ofDivision.id;
          }
        } else if (department.divisionId !== division.id) {
          problem('department', 'department_not_of_division');
        } else {
          departmentId = department.id;
        }
      }
    }
  }

  // The subjects, each "name: grades".
  const subjects: { subjectId: string; grades: number[] }[] = [];
  const subjectColumns = new Map<string, StaffImportColumn>();
  for (const column of STAFF_IMPORT_SUBJECT_COLUMNS) {
    const text = cell(column);
    if (text === undefined) {
      continue;
    }
    const split = text.lastIndexOf(':');
    if (split < 0) {
      problem(column, 'grades_invalid');
      continue;
    }
    const subject = findNamed(lists.subjects, text.slice(0, split));
    const grades = gradesOf(text.slice(split + 1));
    if (typeof subject === 'string') {
      problem(column, subject);
      continue;
    }
    if (grades === undefined) {
      problem(column, 'grades_invalid');
      continue;
    }
    if (subjectColumns.has(subject.id)) {
      problem(column, 'subject_twice');
      continue;
    }
    subjectColumns.set(subject.id, column);
    subjects.push({ subjectId: subject.id, grades });
  }
  const languageChoice = listed('languages', LANGUAGE_VALUES, false);

  // The hours of each weekday: an empty cell is no hours that day.
  const hours: AvailabilityRange[] = [];
  const hoursColumns: StaffImportColumn[] = [];
  for (const { column, weekday } of STAFF_IMPORT_HOURS_COLUMNS) {
    const text = cell(column);
    if (text === undefined) {
      continue;
    }
    const ranges = hoursOf(weekday, text);
    if (typeof ranges === 'string') {
      problem(column, ranges);
      continue;
    }
    for (const range of ranges) {
      hours.push(range);
      hoursColumns.push(column);
    }
  }
  // The hand route's own check of the whole entry: no two ranges of a day overlap,
  // and no more ranges than an entry holds. The date is the route's; any date checks the ranges.
  const entry = availabilitySetSchema.safeParse({ from: '2000-01-01', ranges: hours });
  if (!entry.success) {
    for (const issue of entry.error.issues) {
      const [, index] = issue.path;
      const column = typeof index === 'number' ? (hoursColumns[index] ?? null) : null;
      if (!problems.some((found) => found.column === column)) {
        problems.push({
          column,
          code: issue.code === 'custom' ? 'hours_overlap' : 'hours_invalid',
        });
      }
    }
  }

  const candidate = {
    firstName: cell('firstName') ?? '',
    lastName: cell('lastName') ?? '',
    fatherName: cell('fatherName') ?? '',
    sex: sex ?? 'male',
    birthDate,
    educationLevel,
    phone: cell('phone') ?? null,
    email: cell('email') ?? '',
    jshshir: cell('jshshir') ?? '',
    admissionDate,
    contractType,
    contractDate,
    weeklyLessons: null,
    dailyLessons: null,
    divisions: [{ divisionId: divisionId ?? NO_ID, departmentId, main: true }],
  };
  const parsed = staffRecordSchema.safeParse(candidate);
  const taken = new Set(problems.map((found) => found.column));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const column = staffColumnOfPath(issue.path);
      if (column !== null && taken.has(column)) {
        continue;
      }
      taken.add(column);
      problems.push({ column, code: column === 'phone' ? 'phone_invalid' : 'invalid' });
    }
  }
  const teaching = staffTeachingSchema.safeParse({
    subjects,
    languages: languageChoice === null ? [] : languagesOfChoice(languageChoice),
  });
  if (!teaching.success && !taken.has('languages')) {
    // A subject needs a language of instruction, as the hand form says.
    problems.push({ column: 'languages', code: 'required' });
  }
  const ok = parsed.success && teaching.success && problems.length === 0;
  return {
    rowNumber: row.rowNumber,
    record: ok ? parsed.data : null,
    teaching: ok ? teaching.data : null,
    hours: ok && hours.length > 0 ? hours : null,
    role,
    subjectColumns,
    problems,
    shown: { lastName: cell('lastName') ?? null, firstName: cell('firstName') ?? null },
  };
}

/** A division id that names nothing, for a row whose division is not found (the row has a problem). */
const NO_ID = '00000000-0000-4000-8000-000000000000';

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const found = map.get(key);
  if (found === undefined) {
    map.set(key, [value]);
  } else {
    found.push(value);
  }
};

/**
 * The checks across the rows of the file: the same phone or JSHSHIR on two
 * rows (both rows, plan decision 4, Look first). Answers the problems per row
 * number, and the earlier rows with the same name and date of birth (the
 * warning to confirm).
 */
export function staffFileChecks(rows: readonly ParsedStaffRow[]): {
  problems: Map<number, StaffImportProblem[]>;
  sameNameAndBirth: Map<number, number[]>;
} {
  const problems = new Map<number, StaffImportProblem[]>();
  const keyed: { column: StaffImportColumn; key: (record: StaffRecord) => string | null }[] = [
    { column: 'phone', key: (record) => record.phone },
    { column: 'jshshir', key: (record) => record.jshshir },
  ];
  for (const { column, key } of keyed) {
    const byKey = new Map<string, number[]>();
    for (const row of rows) {
      const value = row.record === null ? null : key(row.record);
      if (value !== null) {
        push(byKey, value, row.rowNumber);
      }
    }
    for (const numbers of byKey.values()) {
      if (numbers.length > 1) {
        for (const number of numbers) {
          push(problems, number, {
            column,
            code: 'duplicate_in_file',
            rows: numbers.filter((other) => other !== number),
          });
        }
      }
    }
  }
  const sameNameAndBirth = new Map<number, number[]>();
  // The same name and date of birth, or the same name when either row has no date
  // of birth (`edge/people-roles-accounts`, re-hire row; owner, 7 November 2026).
  const byName = new Map<string, { row: number; birthDate: string | null }[]>();
  for (const row of rows) {
    if (row.record === null) {
      continue;
    }
    // As the hand check compares them: the names without case (`Staff.check`).
    const key = `${row.record.lastName.toLowerCase()}|${row.record.firstName.toLowerCase()}`;
    const birthDate = row.record.birthDate;
    const earlier = (byName.get(key) ?? [])
      .filter((one) => one.birthDate === null || birthDate === null || one.birthDate === birthDate)
      .map((one) => one.row);
    if (earlier.length > 0) {
      sameNameAndBirth.set(row.rowNumber, earlier);
    }
    push(byName, key, { row: row.rowNumber, birthDate });
  }
  return { problems, sameNameAndBirth };
}
