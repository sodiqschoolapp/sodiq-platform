import {
  CONTRACT_TYPES,
  EDUCATION_LEVELS,
  SEXES,
  STAFF_IMPORT_COLUMNS,
  STAFF_IMPORT_HOURS_COLUMNS,
  STAFF_IMPORT_LANGUAGE_CHOICES,
  STAFF_IMPORT_LISTS_SHEET,
  STAFF_IMPORT_MAX_ROWS,
  STAFF_IMPORT_ROLES,
  STAFF_IMPORT_SHEET,
  STAFF_IMPORT_WORDS,
  staffImportHeadingRow,
  type Language,
  type StaffImportColumn,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { FIRST_DATA_ROW } from './student-import-read.js';

/** The file names of the template, per language, and in ASCII letters. */
const FILE_NAMES: Readonly<Record<Language, string>> = {
  uz: 'Xodimlar importi.xlsx',
  ru: 'Импорт сотрудников.xlsx',
  en: 'Staff import.xlsx',
};

export const STAFF_TEMPLATE_ASCII_NAME = 'staff-import.xlsx';

export const staffTemplateFileName = (language: Language): string => FILE_NAMES[language];

/** The names of the school's lists, in the language of the file, for the list sheet. */
export interface TemplateNames {
  divisions: readonly string[];
  departments: readonly string[];
  subjects: readonly string[];
}

/** The columns that take a value of a fixed list, with the values in the language of the file. */
function listsOf(language: Language): Partial<Record<StaffImportColumn, string[]>> {
  const words = STAFF_IMPORT_WORDS[language];
  return {
    sex: SEXES.map((code) => words.sexes[code]),
    educationLevel: EDUCATION_LEVELS.map((code) => words.educationLevels[code]),
    languages: STAFF_IMPORT_LANGUAGE_CHOICES.map((code) => words.languages[code]),
    contractType: CONTRACT_TYPES.map((code) => words.contractTypes[code]),
    role: STAFF_IMPORT_ROLES.map((code) => words.roles[code]),
  };
}

/** Typed as text: the hours too, so that Excel never turns `08:00-16:05` into a time. */
const TEXT_COLUMNS: ReadonlySet<StaffImportColumn> = new Set([
  'phone',
  'jshshir',
  ...STAFF_IMPORT_HOURS_COLUMNS.map((hours) => hours.column),
]);

const DATE_COLUMNS: ReadonlySet<StaffImportColumn> = new Set([
  'birthDate',
  'admissionDate',
  'contractDate',
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

/** The drop-downs of a range (ExcelJS has `dataValidations.add` at run time; its types leave it out). */
const validationsOf = (sheet: ExcelJS.Worksheet) =>
  (
    sheet as unknown as {
      dataValidations: { add(range: string, validation: ExcelJS.DataValidation): void };
    }
  ).dataValidations;

/**
 * The system's template of the staff import: row 1 the keys of the columns,
 * hidden (the mark of the template), row 2 the headings in the three
 * languages, data from row 3; a sheet of the allowed values in the language
 * chosen (the fixed lists with drop-downs on their columns, and the school's
 * divisions, departments and subjects by name). It holds no personal data.
 */
export async function writeStaffImportTemplate(
  language: Language,
  names: TemplateNames,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(STAFF_IMPORT_SHEET, {
    views: [{ state: 'frozen', ySplit: FIRST_DATA_ROW - 1 }],
  });
  const keys = sheet.addRow([...STAFF_IMPORT_COLUMNS]);
  keys.hidden = true;
  const headings = staffImportHeadingRow();
  sheet.addRow(headings).font = { bold: true };
  const lists = listsOf(language);
  const listSheet = workbook.addWorksheet(STAFF_IMPORT_LISTS_SHEET);
  let listColumn = 0;
  const lastRow = FIRST_DATA_ROW + STAFF_IMPORT_MAX_ROWS - 1;
  const addList = (heading: string, values: readonly string[]): string => {
    listColumn += 1;
    const letter = columnLetter(listColumn);
    listSheet.getCell(`${letter}1`).value = heading;
    listSheet.getCell(`${letter}1`).font = { bold: true };
    values.forEach((value, at) => {
      listSheet.getCell(`${letter}${String(at + 2)}`).value = value;
    });
    listSheet.getColumn(listColumn).width = 32;
    return `'${STAFF_IMPORT_LISTS_SHEET}'!$${letter}$2:$${letter}$${String(Math.max(values.length, 1) + 1)}`;
  };
  STAFF_IMPORT_COLUMNS.forEach((column, index) => {
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
    const range = addList(headings[index] ?? column, values);
    const letter = columnLetter(index + 1);
    validationsOf(sheet).add(`${letter}${String(FIRST_DATA_ROW)}:${letter}${String(lastRow)}`, {
      type: 'list',
      allowBlank: true,
      formulae: [range],
    });
  });
  // The school's own lists, to copy from; their columns take a name, or "name: grades".
  const division = STAFF_IMPORT_COLUMNS.indexOf('division');
  const department = STAFF_IMPORT_COLUMNS.indexOf('department');
  const divisionRange = addList(headings[division] ?? 'division', names.divisions);
  validationsOf(sheet).add(
    `${columnLetter(division + 1)}${String(FIRST_DATA_ROW)}:${columnLetter(division + 1)}${String(lastRow)}`,
    { type: 'list', allowBlank: true, formulae: [divisionRange] },
  );
  addList(headings[department] ?? 'department', names.departments);
  addList(STAFF_IMPORT_WORDS[language].subject.replace('{{n}}', '').replace(/^[-\s]+/, ''), [
    ...names.subjects,
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
