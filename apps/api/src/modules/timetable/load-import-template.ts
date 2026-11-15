import {
  LOAD_IMPORT_ANSWERS,
  LOAD_IMPORT_COLUMNS,
  LOAD_IMPORT_LISTS_SHEET,
  LOAD_IMPORT_MAX_ROWS,
  LOAD_IMPORT_META_COLUMN,
  LOAD_IMPORT_ROOM_TYPES,
  LOAD_IMPORT_SHEET,
  LOAD_IMPORT_WORDS,
  loadImportHeadingRow,
  type Language,
  type LoadImportColumn,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { FIRST_DATA_ROW } from '../people/student-import-read.js';

/** The file names of the template, per language, and in ASCII letters. */
const FILE_NAMES: Readonly<Record<Language, string>> = {
  uz: 'Yuklama importi.xlsx',
  ru: 'Импорт нагрузки.xlsx',
  en: 'Load import.xlsx',
};

export const LOAD_TEMPLATE_ASCII_NAME = 'load-import.xlsx';

export const loadTemplateFileName = (language: Language): string => FILE_NAMES[language];

/** The branch's records of the draft, as the template lists them, in the language of the file. */
export interface LoadTemplateLists {
  /** Classes ("7 Oxford") then groups, by name. */
  readonly units: readonly string[];
  /** Each group with the classes it draws from ("7 Oxford, 7 Princeton"). */
  readonly groupClasses: readonly (readonly [string, string])[];
  readonly subjects: readonly string[];
  /** Teachers ("Surname Name (S-000123)") then vacancies ("Name (vacancy)"). */
  readonly teachers: readonly string[];
  readonly rooms: readonly string[];
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
 * The system's template of the load import (task 5.13; `06`, Importing the load and the
 * timetable): row 1 the keys of the columns, hidden (the mark of the template), row 2 the
 * headings in the three languages, data from row 3; a sheet of the branch's records of the draft
 * in the language chosen, each column that names a record a drop-down of its list. The hidden
 * column `LOAD_IMPORT_META_COLUMN` of the sheet of lists holds the draft's id and the language
 * (decision 3). Every cell is text, so that Excel never turns a name into a number or a date.
 */
export async function writeLoadImportTemplate(
  language: Language,
  versionId: string,
  lists: LoadTemplateLists,
): Promise<Buffer> {
  const words = LOAD_IMPORT_WORDS[language];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(LOAD_IMPORT_SHEET, {
    views: [{ state: 'frozen', ySplit: FIRST_DATA_ROW - 1 }],
  });
  const keys = sheet.addRow([...LOAD_IMPORT_COLUMNS]);
  keys.hidden = true;
  const headings = loadImportHeadingRow();
  sheet.addRow(headings).font = { bold: true };
  const listSheet = workbook.addWorksheet(LOAD_IMPORT_LISTS_SHEET);
  let listColumn = 0;
  const lastRow = FIRST_DATA_ROW + LOAD_IMPORT_MAX_ROWS - 1;
  const addList = (heading: string, values: readonly string[]): string => {
    listColumn += 1;
    const letter = columnLetter(listColumn);
    listSheet.getCell(`${letter}1`).value = heading;
    listSheet.getCell(`${letter}1`).font = { bold: true };
    values.forEach((value, at) => {
      listSheet.getCell(`${letter}${String(at + 2)}`).value = value;
    });
    listSheet.getColumn(listColumn).width = 36;
    return `'${LOAD_IMPORT_LISTS_SHEET}'!$${letter}$2:$${letter}$${String(Math.max(values.length, 1) + 1)}`;
  };
  const dropDown = (column: LoadImportColumn, range: string) => {
    const letter = columnLetter(LOAD_IMPORT_COLUMNS.indexOf(column) + 1);
    validationsOf(sheet).add(`${letter}${String(FIRST_DATA_ROW)}:${letter}${String(lastRow)}`, {
      type: 'list',
      allowBlank: true,
      formulae: [range],
    });
  };
  LOAD_IMPORT_COLUMNS.forEach((_column, index) => {
    const sheetColumn = sheet.getColumn(index + 1);
    sheetColumn.width = Math.min(Math.max((headings[index] ?? '').length / 2, 16), 48);
    sheetColumn.numFmt = '@';
  });
  dropDown('unit', addList(words.lists.units, lists.units));
  dropDown('subject', addList(words.lists.subjects, lists.subjects));
  dropDown('teacher', addList(words.lists.teachers, lists.teachers));
  dropDown('room', addList(words.lists.rooms, lists.rooms));
  dropDown(
    'roomType',
    addList(
      words.lists.roomTypes,
      LOAD_IMPORT_ROOM_TYPES.map((type) => words.roomTypes[type]),
    ),
  );
  const answers = addList(
    words.lists.answers,
    LOAD_IMPORT_ANSWERS.map((answer) => words.answers[answer]),
  );
  dropDown('doubleLessons', answers);
  dropDown('mixedBlock', answers);
  // The groups with their classes: read only, no drop-down names them.
  listColumn += 1;
  const groupLetter = columnLetter(listColumn);
  const classLetter = columnLetter(listColumn + 1);
  listSheet.getCell(`${groupLetter}1`).value = words.lists.groupClasses;
  listSheet.getCell(`${groupLetter}1`).font = { bold: true };
  lists.groupClasses.forEach(([group, classes], at) => {
    listSheet.getCell(`${groupLetter}${String(at + 2)}`).value = group;
    listSheet.getCell(`${classLetter}${String(at + 2)}`).value = classes;
  });
  listSheet.getColumn(listColumn).width = 24;
  listSheet.getColumn(listColumn + 1).width = 36;
  listSheet.getCell(`${LOAD_IMPORT_META_COLUMN}1`).value = versionId;
  listSheet.getCell(`${LOAD_IMPORT_META_COLUMN}2`).value = language;
  listSheet.getColumn(LOAD_IMPORT_META_COLUMN).hidden = true;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
