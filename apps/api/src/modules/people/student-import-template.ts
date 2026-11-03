import {
  DOCUMENT_TYPES,
  EXPORT_TEXTS,
  REGIONS,
  RELATIONSHIPS,
  SCHOLARSHIP_COVERAGES,
  SCHOLARSHIP_TYPES,
  SEXES,
  STUDENT_IMPORT_COLUMNS,
  STUDENT_IMPORT_LISTS_SHEET,
  STUDENT_IMPORT_MAX_ROWS,
  STUDENT_IMPORT_SHEET,
  importHeadingRow,
  type Language,
  type StudentImportColumn,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { FIRST_DATA_ROW } from './student-import-read.js';

/** The file names of the template, per language, and in ASCII letters. */
const FILE_NAMES: Readonly<Record<Language, string>> = {
  uz: 'Oʻquvchilar importi.xlsx',
  ru: 'Импорт учеников.xlsx',
  en: 'Student import.xlsx',
};

export const TEMPLATE_ASCII_NAME = 'student-import.xlsx';

export const templateFileName = (language: Language): string => FILE_NAMES[language];

/** The columns that take a value of a list, with the values in the language of the file. */
function listsOf(language: Language): Partial<Record<StudentImportColumn, string[]>> {
  const texts = EXPORT_TEXTS[language].student;
  const relationships = RELATIONSHIPS.map((code) => texts.relationships[code]);
  return {
    sex: SEXES.map((code) => texts.sexes[code]),
    documentType: DOCUMENT_TYPES.map((code) => texts.documentTypes[code]),
    region: REGIONS.map((code) => texts.regions[code]),
    scholarshipType: SCHOLARSHIP_TYPES.map((code) => texts.scholarshipTypes[code]),
    scholarshipCoverage: SCHOLARSHIP_COVERAGES.map((code) => texts.scholarshipCoverages[code]),
    relative1Relationship: relationships,
    relative2Relationship: relationships,
    relative3Relationship: relationships,
  };
}

/** Columns kept as text, so Excel does not turn a UID, a number or a phone into a number. */
const TEXT_COLUMNS: ReadonlySet<StudentImportColumn> = new Set([
  'uid',
  'documentNumber',
  'jshshir',
  'phone',
  'contractNumber',
  'relative1Phone',
  'relative2Phone',
  'relative3Phone',
]);

const DATE_COLUMNS: ReadonlySet<StudentImportColumn> = new Set([
  'birthDate',
  'startsOn',
  'contractSignedOn',
  'consentSignedOn',
]);

const columnLetter = (index: number): string => {
  let letters = '';
  let rest = index;
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    letters = String.fromCharCode(65 + digit) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
};

/**
 * The drop-downs of a range of a sheet. ExcelJS has `dataValidations.add` at
 * run time since 4.0, but its types leave it out; the cast names only that
 * one method (a test reads the drop-downs back from a written file).
 */
const validationsOf = (sheet: ExcelJS.Worksheet) =>
  (
    sheet as unknown as {
      dataValidations: { add(range: string, validation: ExcelJS.DataValidation): void };
    }
  ).dataValidations;

/**
 * The system's template of the student import (`04`, Student record: "the
 * system's Excel template ... with its column headings in Uzbek, Russian and
 * English"): row 1 the keys of the columns, hidden (the mark of the template,
 * plan decision 8), row 2 the headings in the three languages, data from row
 * 3; a sheet of the values of the lists in the language chosen, with
 * drop-downs on their columns. It holds no data.
 */
export async function writeImportTemplate(language: Language): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(STUDENT_IMPORT_SHEET, {
    views: [{ state: 'frozen', ySplit: FIRST_DATA_ROW - 1 }],
  });
  const keys = sheet.addRow([...STUDENT_IMPORT_COLUMNS]);
  keys.hidden = true;
  const headings = importHeadingRow();
  sheet.addRow(headings).font = { bold: true };
  const lists = listsOf(language);
  const listSheet = workbook.addWorksheet(STUDENT_IMPORT_LISTS_SHEET);
  let listColumn = 0;
  const lastRow = FIRST_DATA_ROW + STUDENT_IMPORT_MAX_ROWS - 1;
  const ranges = new Map<string, string>();
  STUDENT_IMPORT_COLUMNS.forEach((column, index) => {
    const sheetColumn = sheet.getColumn(index + 1);
    sheetColumn.width = Math.min(Math.max((headings[index] ?? '').length / 2, 14), 48);
    if (TEXT_COLUMNS.has(column)) {
      sheetColumn.numFmt = '@';
    } else if (DATE_COLUMNS.has(column)) {
      sheetColumn.numFmt = 'dd.mm.yyyy';
    }
    const values = lists[column];
    if (values === undefined) {
      return;
    }
    // One column of the list sheet per list; the three relationship columns share one.
    const listKey = values.join('\u0000');
    let range = ranges.get(listKey);
    if (range === undefined) {
      listColumn += 1;
      const letter = columnLetter(listColumn);
      listSheet.getCell(`${letter}1`).value = headings[index] ?? column;
      listSheet.getCell(`${letter}1`).font = { bold: true };
      values.forEach((value, at) => {
        listSheet.getCell(`${letter}${String(at + 2)}`).value = value;
      });
      listSheet.getColumn(listColumn).width = 32;
      range = `'${STUDENT_IMPORT_LISTS_SHEET}'!$${letter}$2:$${letter}$${String(values.length + 1)}`;
      ranges.set(listKey, range);
    }
    const letter = columnLetter(index + 1);
    validationsOf(sheet).add(`${letter}${String(FIRST_DATA_ROW)}:${letter}${String(lastRow)}`, {
      type: 'list',
      allowBlank: true,
      formulae: [range],
    });
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
