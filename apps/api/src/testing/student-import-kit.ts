import {
  STUDENT_IMPORT_COLUMNS,
  STUDENT_IMPORT_SHEET,
  type StudentImportColumn,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { FIRST_DATA_ROW } from '../modules/people/student-import-read.js';
import { writeImportTemplate } from '../modules/people/student-import-template.js';

/** One row to type into the template: a text, a number or a date cell per column. */
export type TemplateRow = Partial<Record<StudentImportColumn, string | number | Date>>;

/**
 * The system's template filled with `rows` from the first data row, as a
 * school would fill it in Excel (task 9.4g). `edit` may change the workbook
 * before it is written (a moved key, another sheet name).
 */
export async function filledTemplate(
  rows: readonly TemplateRow[],
  edit?: (sheet: ExcelJS.Worksheet) => void,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await writeImportTemplate('en')) as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet(STUDENT_IMPORT_SHEET);
  if (sheet === undefined) {
    throw new Error('The template has its sheet.');
  }
  rows.forEach((row, index) => {
    const line = sheet.getRow(FIRST_DATA_ROW + index);
    STUDENT_IMPORT_COLUMNS.forEach((column, at) => {
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

/** Letters for a number, so that invented names stay names: 1 is b, 26 is ba. */
const lettersOf = (value: number): string =>
  value < 26
    ? String.fromCharCode(97 + value)
    : lettersOf(Math.floor(value / 26)) + String.fromCharCode(97 + (value % 26));

/**
 * A complete row of an invented student of grade 7 in `className`, from 2
 * September 2026, with one relative of its own; `overrides` change columns.
 */
export function studentRow(className: string | null, overrides: TemplateRow = {}): TemplateRow {
  count += 1;
  const n = String(count).padStart(3, '0');
  return {
    uid: `IMP-${n}`,
    lastName: `Toshmatov${lettersOf(count)}`,
    firstName: 'Sardor',
    paternalName: 'Akmalovich',
    sex: 'Male',
    birthDate: new Date(Date.UTC(2013, 2, (count % 27) + 1)),
    grade: 7,
    ...(className === null ? {} : { className }),
    startsOn: '02.09.2026',
    documentType: 'Birth certificate',
    documentNumber: `I-IM${String(1000000 + count)}`,
    jshshir: String(51403140000000 + count),
    contractNumber: `IM-2026/${n}`,
    contractSignedOn: '20.08.2026',
    scholarshipType: 'None',
    relative1FullName: `Nodira Toshmatova${lettersOf(count)}`,
    relative1Relationship: 'Mother',
    relative1Phone: 998930000000 + count,
    ...overrides,
  };
}
