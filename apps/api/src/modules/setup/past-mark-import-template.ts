import {
  PAST_MARK_COLUMNS,
  PAST_MARK_HEADINGS,
  PAST_MARK_SHEET,
  pastMarkHeadingRow,
  type Language,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { FIRST_DATA_ROW } from '../people/student-import-read.js';

/** The file names of the template, per language, and in ASCII letters. */
const FILE_NAMES: Readonly<Record<Language, string>> = {
  uz: 'Oʻtgan baholar importi.xlsx',
  ru: 'Импорт прошлых оценок.xlsx',
  en: 'Past marks import.xlsx',
};

export const PAST_MARK_TEMPLATE_ASCII_NAME = 'past-marks-import.xlsx';

export const pastMarkTemplateFileName = (language: Language): string => FILE_NAMES[language];

/** The columns typed as text, so that Excel never turns a UID or a name into a number or a date. */
const TEXT_COLUMNS = new Set<string>([
  'uid',
  'lastName',
  'firstName',
  'subject',
  'classworkTitle',
  'homeworkTitle',
]);

/**
 * The system's template of the import of past marks (task 11.26; `10`, The file: "with its column
 * headings in Uzbek, Russian and English"): row 1 the keys of the columns, hidden (the mark of the
 * template), row 2 the headings in the three languages, data from row 3. The language chosen names
 * the file and sizes the columns; the headings stand in the three languages, as in the other
 * imports.
 */
export async function writePastMarkTemplate(language: Language): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(PAST_MARK_SHEET, {
    views: [{ state: 'frozen', ySplit: FIRST_DATA_ROW - 1 }],
  });
  const keys = sheet.addRow([...PAST_MARK_COLUMNS]);
  keys.hidden = true;
  const headings = pastMarkHeadingRow();
  sheet.addRow(headings).font = { bold: true };
  PAST_MARK_COLUMNS.forEach((column, index) => {
    const sheetColumn = sheet.getColumn(index + 1);
    sheetColumn.width = Math.min(Math.max(PAST_MARK_HEADINGS[language][column].length + 4, 12), 36);
    if (TEXT_COLUMNS.has(column)) {
      sheetColumn.numFmt = '@';
    }
    if (column === 'date') {
      sheetColumn.numFmt = 'yyyy-mm-dd';
    }
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
