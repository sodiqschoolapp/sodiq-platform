import {
  JOURNAL_TYPES,
  SUBJECT_COLOURS,
  SUBJECT_IMPORT_ANSWERS,
  SUBJECT_IMPORT_COLUMNS,
  SUBJECT_IMPORT_LISTS_SHEET,
  SUBJECT_IMPORT_MAX_ROWS,
  SUBJECT_IMPORT_SHEET,
  SUBJECT_IMPORT_SWITCH_COLUMNS,
  SUBJECT_IMPORT_WORDS,
  subjectImportHeadingRow,
  type Language,
  type SubjectImportColumn,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { FIRST_DATA_ROW } from '../people/student-import-read.js';

/** The file names of the template, per language, and in ASCII letters. */
const FILE_NAMES: Readonly<Record<Language, string>> = {
  uz: 'Fanlar importi.xlsx',
  ru: 'Импорт предметов.xlsx',
  en: 'Subject import.xlsx',
};

export const SUBJECT_TEMPLATE_ASCII_NAME = 'subject-import.xlsx';

export const subjectTemplateFileName = (language: Language): string => FILE_NAMES[language];

/** The columns that take a value of a fixed list, with the values in the language of the file. */
function listsOf(language: Language): Partial<Record<SubjectImportColumn, string[]>> {
  const words = SUBJECT_IMPORT_WORDS[language];
  const answers = SUBJECT_IMPORT_ANSWERS.map((code) => words.answers[code]);
  return {
    colour: SUBJECT_COLOURS.map((code) => words.colours[code]),
    journalType: JOURNAL_TYPES.map((code) => words.journalTypes[code]),
    ...Object.fromEntries(SUBJECT_IMPORT_SWITCH_COLUMNS.map((column) => [column, answers])),
  };
}

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

/** The drop-downs of a range (ExcelJS has `dataValidations.add` at run time; its types leave it out). */
const validationsOf = (sheet: ExcelJS.Worksheet) =>
  (
    sheet as unknown as {
      dataValidations: { add(range: string, validation: ExcelJS.DataValidation): void };
    }
  ).dataValidations;

/**
 * The system's template of the subject import: row 1 the keys of the columns,
 * hidden (the mark of the template), row 2 the headings in the three
 * languages, data from row 3; a sheet of the allowed values in the language
 * chosen (the fixed lists with drop-downs on their columns, and the active
 * departments of the Academic division by name). The grades are typed as
 * text, so that Excel never turns `5-7` into a date.
 */
export async function writeSubjectImportTemplate(
  language: Language,
  departments: readonly string[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SUBJECT_IMPORT_SHEET, {
    views: [{ state: 'frozen', ySplit: FIRST_DATA_ROW - 1 }],
  });
  const keys = sheet.addRow([...SUBJECT_IMPORT_COLUMNS]);
  keys.hidden = true;
  const headings = subjectImportHeadingRow();
  sheet.addRow(headings).font = { bold: true };
  const lists = listsOf(language);
  const listSheet = workbook.addWorksheet(SUBJECT_IMPORT_LISTS_SHEET);
  let listColumn = 0;
  const lastRow = FIRST_DATA_ROW + SUBJECT_IMPORT_MAX_ROWS - 1;
  const addList = (heading: string, values: readonly string[]): string => {
    listColumn += 1;
    const letter = columnLetter(listColumn);
    listSheet.getCell(`${letter}1`).value = heading;
    listSheet.getCell(`${letter}1`).font = { bold: true };
    values.forEach((value, at) => {
      listSheet.getCell(`${letter}${String(at + 2)}`).value = value;
    });
    listSheet.getColumn(listColumn).width = 32;
    return `'${SUBJECT_IMPORT_LISTS_SHEET}'!$${letter}$2:$${letter}$${String(Math.max(values.length, 1) + 1)}`;
  };
  const dropDown = (index: number, range: string) => {
    const letter = columnLetter(index + 1);
    validationsOf(sheet).add(`${letter}${String(FIRST_DATA_ROW)}:${letter}${String(lastRow)}`, {
      type: 'list',
      allowBlank: true,
      formulae: [range],
    });
  };
  const ranges = new Map<string, string>();
  SUBJECT_IMPORT_COLUMNS.forEach((column, index) => {
    const sheetColumn = sheet.getColumn(index + 1);
    sheetColumn.width = Math.min(Math.max((headings[index] ?? '').length / 2, 14), 48);
    if (column === 'grades' || column.startsWith('name') || column === 'department') {
      sheetColumn.numFmt = '@';
    }
    const values = lists[column];
    if (values === undefined) {
      return;
    }
    // The four switches share one list of yes and no.
    const key = values.join('\n');
    let range = ranges.get(key);
    if (range === undefined) {
      range = addList(headings[index] ?? column, values);
      ranges.set(key, range);
    }
    dropDown(index, range);
  });
  const department = SUBJECT_IMPORT_COLUMNS.indexOf('department');
  dropDown(department, addList(headings[department] ?? 'department', departments));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
