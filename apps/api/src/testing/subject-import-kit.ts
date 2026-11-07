import {
  SUBJECT_IMPORT_COLUMNS,
  SUBJECT_IMPORT_SHEET,
  type SubjectImportColumn,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { FIRST_DATA_ROW } from '../modules/people/student-import-read.js';
import { writeSubjectImportTemplate } from '../modules/setup/subject-import-template.js';

/** One row to type into the subject template: a text or a number cell per column. */
export type SubjectTemplateRow = Partial<Record<SubjectImportColumn, string | number>>;

/**
 * The system's subject template filled with `rows` from the first data row,
 * as the school would fill it in Excel (pull request #316). `edit` may change
 * the workbook before it is written.
 */
export async function filledSubjectTemplate(
  rows: readonly SubjectTemplateRow[],
  edit?: (sheet: ExcelJS.Worksheet) => void,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    (await writeSubjectImportTemplate('en', [])) as unknown as ExcelJS.Buffer,
  );
  const sheet = workbook.getWorksheet(SUBJECT_IMPORT_SHEET);
  if (sheet === undefined) {
    throw new Error('The template has its sheet.');
  }
  rows.forEach((row, index) => {
    const line = sheet.getRow(FIRST_DATA_ROW + index);
    SUBJECT_IMPORT_COLUMNS.forEach((column, at) => {
      const value = row[column];
      if (value !== undefined && value !== '') {
        line.getCell(at + 1).value = value;
      }
    });
    line.commit();
  });
  edit?.(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

let count = 0;

/** Letters for a number, so that invented names stay names: 0 is a, 26 is ba. */
const lettersOf = (value: number): string =>
  value < 26
    ? String.fromCharCode(97 + value)
    : lettersOf(Math.floor(value / 26)) + String.fromCharCode(97 + (value % 26));

/**
 * A complete row of an invented graded subject of STEAM for grades 5 to 7,
 * with the rating exam and both distributions, names of its own in each
 * language; `overrides` change columns (an empty text clears one).
 */
export function subjectRow(overrides: SubjectTemplateRow = {}): SubjectTemplateRow {
  count += 1;
  const letters = lettersOf(count);
  return {
    nameUz: `Fan ${letters}`,
    nameRu: `Предмет ${letters}`,
    nameEn: `Subject ${letters}`,
    department: 'STEAM',
    grades: '5-7',
    colour: 'Blue',
    journalType: 'Graded',
    ratingExam: 'Yes',
    groupSubject: 'No',
    languageRule: 'Yes',
    demanding: 'No',
    dailyAttendance: 10,
    dailyClasswork: 50,
    dailyHomework: 40,
    quarterAttendance: 10,
    quarterClasswork: 30,
    quarterHomework: 20,
    quarterRatingExam: 40,
    ...overrides,
  };
}
