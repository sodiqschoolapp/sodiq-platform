import { STAFF_IMPORT_COLUMNS, STAFF_IMPORT_SHEET, type StaffImportColumn } from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { FIRST_DATA_ROW } from '../modules/people/student-import-read.js';
import { writeStaffImportTemplate } from '../modules/people/staff-import-template.js';

/** One row to type into the staff template: a text, a number or a date cell per column. */
export type StaffTemplateRow = Partial<Record<StaffImportColumn, string | number | Date>>;

/**
 * The system's staff template filled with `rows` from the first data row, as
 * the school would fill it in Excel (task 9.4h). `edit` may change the
 * workbook before it is written.
 */
export async function filledStaffTemplate(
  rows: readonly StaffTemplateRow[],
  edit?: (sheet: ExcelJS.Worksheet) => void,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    (await writeStaffImportTemplate('en', {
      divisions: [],
      departments: [],
      subjects: [],
    })) as unknown as ExcelJS.Buffer,
  );
  const sheet = workbook.getWorksheet(STAFF_IMPORT_SHEET);
  if (sheet === undefined) {
    throw new Error('The template has its sheet.');
  }
  rows.forEach((row, index) => {
    const line = sheet.getRow(FIRST_DATA_ROW + index);
    STAFF_IMPORT_COLUMNS.forEach((column, at) => {
      const value = row[column];
      if (value !== undefined) {
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
 * A complete row of an invented teacher of the Academic division, STEAM,
 * admitted on 1 September 2026, with a phone and a JSHSHIR of their own;
 * `overrides` change columns (an empty text clears one).
 */
export function staffRow(overrides: StaffTemplateRow = {}): StaffTemplateRow {
  count += 1;
  return {
    lastName: `Rahimov${lettersOf(count)}`,
    firstName: 'Jasur',
    fatherName: 'Olimovich',
    sex: 'Male',
    birthDate: new Date(Date.UTC(1988, 4, (count % 27) + 1)),
    educationLevel: 'Master',
    phone: 998970000000 + count,
    jshshir: String(30105880000000 + count),
    division: 'Academic',
    department: 'STEAM',
    subject1: 'Mathematics: 5-7',
    languages: 'Uzbek',
    admissionDate: '01.09.2026',
    contractType: 'Full time',
    contractDate: '01.09.2026',
    role: 'Teacher',
    ...overrides,
  };
}
