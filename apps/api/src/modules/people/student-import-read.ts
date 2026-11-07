import {
  DOCUMENT_TYPES,
  EXPORT_TEXTS,
  IMPORT_RELATIVES,
  LANGUAGES,
  REGIONS,
  RELATIONSHIPS,
  SCHOLARSHIP_COVERAGES,
  SCHOLARSHIP_TYPES,
  SEXES,
  STUDENT_IMPORT_COLUMNS,
  STUDENT_IMPORT_MAX_ROWS,
  STUDENT_IMPORT_SHEET,
  relativeNameKey,
  studentCreateSchema,
  studentNameKey,
  studentUidKey,
  type ExportTexts,
  type RelativeLinkInput,
  type StudentCreate,
  type StudentImportColumn,
  type StudentImportProblem,
  type StudentImportRow,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { ApiException } from '../../http/api-exception.js';

/**
 * Reading the system's template of the student import (task 9.4g;
 * `edge/students-classes-groups`: "Only the system's template is accepted.
 * Dates must be real dates or dd.mm.yyyy. Phones are converted to one format
 * or the row fails. Look-alike Cyrillic and Latin letters in class and group
 * names are treated as the same. Duplicates inside the file are errors.").
 * Pure: no database; the service resolves the classes and runs the save.
 */

/** The first row of data: row 1 holds the keys, row 2 the headings. */
export const FIRST_DATA_ROW = 3;

/** A school date as the files of the school write it, `19.10.2026`. */
const dotted = (date: Date): string =>
  `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${String(date.getUTCFullYear())}`;

/**
 * The text of a cell: a date cell as `dd.mm.yyyy` (ExcelJS reads a date by
 * its UTC parts), a whole number as its digits (a phone shown as 9.989E+11 is
 * the number 998901234567), rich text, a link and a formula's result as their
 * text; an empty one as `undefined`.
 */
export function cellText(value: ExcelJS.CellValue): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    return dotted(value);
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toFixed(0) : String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'string') {
    const text = value.trim();
    return text === '' ? undefined : text;
  }
  if ('richText' in value) {
    return cellText(value.richText.map((part) => part.text).join(''));
  }
  if ('formula' in value || 'sharedFormula' in value) {
    return cellText((value as { result?: ExcelJS.CellValue }).result ?? null);
  }
  if ('hyperlink' in value) {
    return cellText(value.text);
  }
  if ('error' in value) {
    return value.error;
  }
  return undefined;
}

const notTemplate = () => new ApiException('import_not_template', 422);

/**
 * The rows of an upload: the sheet of the template whose first row holds
 * exactly the keys of the columns, in their order; empty rows skipped.
 */
export async function readImportWorkbook(bytes: Buffer): Promise<StudentImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS types its own Buffer; a Node Buffer is one.
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  } catch {
    throw notTemplate();
  }
  const sheet = workbook.getWorksheet(STUDENT_IMPORT_SHEET);
  if (sheet === undefined) {
    throw notTemplate();
  }
  const keys = sheet.getRow(1);
  const marked = STUDENT_IMPORT_COLUMNS.every(
    (column, index) => cellText(keys.getCell(index + 1).value) === column,
  );
  if (!marked || cellText(keys.getCell(STUDENT_IMPORT_COLUMNS.length + 1).value) !== undefined) {
    throw notTemplate();
  }
  const rows: StudentImportRow[] = [];
  for (let number = FIRST_DATA_ROW; number <= sheet.rowCount; number += 1) {
    const row = sheet.getRow(number);
    const cells: Partial<Record<StudentImportColumn, string>> = {};
    STUDENT_IMPORT_COLUMNS.forEach((column, index) => {
      const text = cellText(row.getCell(index + 1).value);
      if (text !== undefined) {
        cells[column] = text;
      }
    });
    if (Object.keys(cells).length > 0) {
      rows.push({ rowNumber: number, cells });
      if (rows.length > STUDENT_IMPORT_MAX_ROWS) {
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
    .replace(/\s+/g, ' ')
    .trim();

/** The values of a list as they may be typed: the code, or its words in any of the three languages. */
function listOf<T extends string>(
  codes: readonly T[],
  words: (texts: ExportTexts) => Record<T, string>,
): ReadonlyMap<string, T> {
  const found = new Map<string, T>();
  for (const code of codes) {
    found.set(listKey(code), code);
    for (const language of LANGUAGES) {
      found.set(listKey(words(EXPORT_TEXTS[language])[code]), code);
    }
  }
  return found;
}

const SEX_VALUES = listOf(SEXES, (texts) => texts.student.sexes);
const DOCUMENT_VALUES = listOf(DOCUMENT_TYPES, (texts) => texts.student.documentTypes);
const REGION_VALUES = listOf(REGIONS, (texts) => texts.student.regions);
const SCHOLARSHIP_VALUES = listOf(SCHOLARSHIP_TYPES, (texts) => texts.student.scholarshipTypes);
const COVERAGE_VALUES = listOf(
  SCHOLARSHIP_COVERAGES,
  (texts) => texts.student.scholarshipCoverages,
);
const RELATIONSHIP_VALUES = listOf(RELATIONSHIPS, (texts) => texts.student.relationships);

/** `dd.mm.yyyy` as a school date when it is a real day; `undefined` otherwise. */
export function dottedDateOf(text: string): string | undefined {
  const parts = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  if (parts === null) {
    return undefined;
  }
  const [, day = '', month = '', year = ''] = parts;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return undefined;
  }
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/** One relative of a row, as the hand form would send it as a new person. */
export interface ImportRelative {
  position: number;
  fullName: string;
  /** `null`: "no phone of their own", as by hand. */
  phone: string | null;
  link: Extract<RelativeLinkInput, { kind: 'new' }>;
}

/** A row read and checked on its own: the create without its class, or its problems. */
export interface ParsedRow {
  rowNumber: number;
  /** The create as the hand form sends it, with `classId` null and new relatives; `null` when the row has problems. */
  input: StudentCreate | null;
  grade: number | null;
  /** The class name as typed; `null` without one. */
  className: string | null;
  relatives: ImportRelative[];
  problems: StudentImportProblem[];
  /** For the preview: what was read, even when the row has problems. */
  shown: { uid: string | null; lastName: string | null; firstName: string | null };
}

/** The column a path of `studentCreateSchema` is typed in. */
export function columnOfPath(path: readonly PropertyKey[]): StudentImportColumn | null {
  const [first, second, third, fourth] = path.map(String);
  switch (first) {
    case 'contract':
      return second === 'signedOn' ? 'contractSignedOn' : 'contractNumber';
    case 'scholarship':
      return second === 'coverage'
        ? 'scholarshipCoverage'
        : second === 'amount'
          ? 'scholarshipAmount'
          : 'scholarshipType';
    case 'classId':
      return 'className';
    case 'relatives': {
      const position = Number(second) + 1;
      if (!Number.isInteger(position) || position < 1 || position > IMPORT_RELATIVES) {
        return 'relative1FullName';
      }
      const field = third === 'relative' ? fourth : third;
      const part =
        field === 'phone'
          ? 'Phone'
          : field === 'workplace'
            ? 'Workplace'
            : field === 'email'
              ? 'Email'
              : field === 'relationship'
                ? 'Relationship'
                : 'FullName';
      return `relative${String(position)}${part}` as StudentImportColumn;
    }
    case undefined:
      return null;
    default:
      return (STUDENT_IMPORT_COLUMNS as readonly string[]).includes(first)
        ? (first as StudentImportColumn)
        : null;
  }
}

/**
 * Reads one row into the create the hand form would send (`classId` left
 * null for the service to resolve): the lists in any of the three languages
 * or as codes, dates as real dates or `dd.mm.yyyy`, then every field through
 * `studentCreateSchema` itself, so a value refused by hand is refused here.
 */
export function parseImportRow(row: StudentImportRow): ParsedRow {
  const problems: StudentImportProblem[] = [];
  const cell = (column: StudentImportColumn): string | undefined => row.cells[column];
  const problem = (column: StudentImportColumn, code: string) => {
    problems.push({ column, code });
  };
  const date = (column: StudentImportColumn, required: boolean): string | null => {
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
    column: StudentImportColumn,
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
  const whole = (column: StudentImportColumn): number | null => {
    const text = cell(column);
    if (text === undefined) {
      return null;
    }
    const number = /^-?\d+$/.test(text) ? Number(text) : Number.NaN;
    if (!Number.isSafeInteger(number)) {
      problem(column, 'invalid');
      return null;
    }
    return number;
  };
  const required = <T>(column: StudentImportColumn, value: T | null): T | null => {
    if (value === null && cell(column) === undefined) {
      problem(column, 'required');
    }
    return value;
  };

  const sex = required('sex', listed('sex', SEX_VALUES));
  // Optional (owner, 7 November 2026; `04`, Excel import).
  const birthDate = date('birthDate', false);
  const startsOn = date('startsOn', true);
  const contractSignedOn = date('contractSignedOn', true);
  const consentSignedOn = date('consentSignedOn', false);
  const grade = required('grade', whole('grade'));
  const documentType = listed('documentType', DOCUMENT_VALUES);
  const region = listed('region', REGION_VALUES);
  const scholarshipType = listed('scholarshipType', SCHOLARSHIP_VALUES) ?? 'none';
  const coverage = listed('scholarshipCoverage', COVERAGE_VALUES);
  const amount = whole('scholarshipAmount');
  const diagnosticScore = whole('diagnosticScore');

  const relatives: ImportRelative[] = [];
  const relativeProblems: StudentImportProblem[] = [];
  for (let position = 1; position <= IMPORT_RELATIVES; position += 1) {
    const at = (part: string) => `relative${String(position)}${part}` as StudentImportColumn;
    const given = ['FullName', 'Relationship', 'Phone', 'Workplace', 'Email'].some(
      (part) => cell(at(part)) !== undefined,
    );
    if (!given) {
      continue;
    }
    const relationship = required(
      at('Relationship'),
      listed(at('Relationship'), RELATIONSHIP_VALUES),
    );
    if (cell(at('FullName')) === undefined) {
      relativeProblems.push({ column: at('FullName'), code: 'required' });
    }
    relatives.push({
      position,
      fullName: cell(at('FullName')) ?? '',
      phone: cell(at('Phone')) ?? null,
      link: {
        kind: 'new',
        relative: {
          fullName: cell(at('FullName')) ?? '',
          phone: cell(at('Phone')) ?? null,
          workplace: cell(at('Workplace')) ?? null,
          email: cell(at('Email')) ?? null,
          extraPhones: [],
        },
        relationship: relationship ?? 'other',
        // The first relative given is the main contact (the spec change); the
        // switches as the hand form sets them (`edge/close-relatives`: portal
        // access "on by default for every link").
        mainContact: relatives.length === 0,
        portalAccess: true,
        receivesNotices: true,
      },
    });
  }
  // A row may have no relative (`04`, Relatives are optional).
  problems.push(...relativeProblems);
  for (const column of [
    'uid',
    'lastName',
    'firstName',
    'contractNumber',
  ] as const satisfies readonly StudentImportColumn[]) {
    if (cell(column) === undefined) {
      problem(column, 'required');
    }
  }

  const candidate = {
    firstName: cell('firstName') ?? '',
    lastName: cell('lastName') ?? '',
    paternalName: cell('paternalName') ?? '',
    sex: sex ?? 'male',
    birthDate,
    grade: grade ?? 0,
    documentType,
    documentNumber: cell('documentNumber') ?? '',
    jshshir: cell('jshshir') ?? '',
    phone: cell('phone') ?? '',
    email: cell('email') ?? '',
    address: cell('address') ?? '',
    region,
    previousSchool: cell('previousSchool') ?? '',
    diagnosticScore,
    scholarship: {
      type: scholarshipType,
      coverage: scholarshipType === 'none' ? coverage : (coverage ?? null),
      amount,
    },
    consentSignedOn,
    contract: { number: cell('contractNumber') ?? '', signedOn: contractSignedOn ?? '2000-01-01' },
    startsOn: startsOn ?? '2000-01-01',
    uid: cell('uid') ?? '',
    relatives: relatives.map((relative) => ({
      ...relative.link,
      relative: {
        ...relative.link.relative,
        phone: relative.link.relative.phone ?? '',
      },
    })),
    classId: null,
  };
  // A relative phone left empty is "no phone of their own": the schema takes `null` there.
  const parsed = studentCreateSchema.safeParse({
    ...candidate,
    relatives: candidate.relatives.map((link) => ({
      ...link,
      relative: {
        ...link.relative,
        phone: link.relative.phone === '' ? null : link.relative.phone,
      },
    })),
  });
  const taken = new Set(problems.map((found) => found.column));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const column = columnOfPath(issue.path);
      if (column !== null && taken.has(column)) {
        continue;
      }
      if (column === null && relatives.length === 0) {
        continue;
      }
      taken.add(column);
      problems.push({
        column,
        code: column !== null && /Phone$|^phone$/.test(column) ? 'phone_invalid' : 'invalid',
      });
    }
  }
  const shown = {
    uid: cell('uid') ?? null,
    lastName: cell('lastName') ?? null,
    firstName: cell('firstName') ?? null,
  };
  const ok = parsed.success && problems.length === 0;
  return {
    rowNumber: row.rowNumber,
    input: ok ? parsed.data : null,
    grade,
    className: cell('className') ?? null,
    relatives: ok
      ? relatives.map((relative, index) => {
          const link = parsed.data.relatives[index];
          return link?.kind === 'new'
            ? {
                ...relative,
                fullName: link.relative.fullName,
                phone: link.relative.phone,
                link,
              }
            : relative;
        })
      : relatives,
    problems,
    shown,
  };
}

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const found = map.get(key);
  if (found === undefined) {
    map.set(key, [value]);
  } else {
    found.push(value);
  }
};

/**
 * The checks across the rows of the file: the same UID, JSHSHIR, document
 * number or contract number on two rows (both rows, plan decision 5), the
 * same relative phone under two names (both rows; `edge`, the relative phone
 * row). Answers the problems per row number, and the earlier rows with the
 * same name and date of birth (the warning to confirm, twins pass).
 */
export function fileChecks(rows: readonly ParsedRow[]): {
  problems: Map<number, StudentImportProblem[]>;
  sameNameAndBirth: Map<number, number[]>;
} {
  const problems = new Map<number, StudentImportProblem[]>();
  const keyed: {
    column: StudentImportColumn;
    key: (input: StudentCreate) => string | null;
  }[] = [
    { column: 'uid', key: (input) => studentUidKey(input.uid) },
    { column: 'jshshir', key: (input) => input.jshshir },
    { column: 'documentNumber', key: (input) => input.documentNumber },
    { column: 'contractNumber', key: (input) => input.contract.number.toUpperCase() },
  ];
  for (const { column, key } of keyed) {
    const byKey = new Map<string, number[]>();
    for (const row of rows) {
      const value = row.input === null ? null : key(row.input);
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
  const byPhone = new Map<string, { row: number; position: number; name: string }[]>();
  for (const row of rows) {
    for (const relative of row.relatives) {
      if (relative.phone !== null && relative.fullName !== '') {
        push(byPhone, relative.phone, {
          row: row.rowNumber,
          position: relative.position,
          name: relativeNameKey(relative.fullName),
        });
      }
    }
  }
  for (const holders of byPhone.values()) {
    if (new Set(holders.map((holder) => holder.name)).size > 1) {
      for (const holder of holders) {
        push(problems, holder.row, {
          column: `relative${String(holder.position)}Phone` as StudentImportColumn,
          code: 'phone_two_names_in_file',
          rows: [
            ...new Set(
              holders.filter((other) => other.name !== holder.name).map((other) => other.row),
            ),
          ],
        });
      }
    }
  }
  const sameNameAndBirth = new Map<number, number[]>();
  // The same name and date of birth, or the same name when either row has no date of
  // birth (edge, the duplicate check; owner, 7 November 2026).
  const byName = new Map<string, { row: number; birthDate: string | null }[]>();
  for (const row of rows) {
    if (row.input === null) {
      continue;
    }
    const key = studentNameKey(row.input.lastName, row.input.firstName);
    const birthDate = row.input.birthDate;
    const earlier = (byName.get(key) ?? [])
      .filter((one) => one.birthDate === null || birthDate === null || one.birthDate === birthDate)
      .map((one) => one.row);
    if (earlier.length > 0) {
      sameNameAndBirth.set(row.rowNumber, earlier);
    }
    byName.set(key, [...(byName.get(key) ?? []), { row: row.rowNumber, birthDate }]);
  }
  return { problems, sameNameAndBirth };
}
