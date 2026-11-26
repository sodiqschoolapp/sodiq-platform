import { PAST_MARK_COLUMNS, PAST_MARK_SHEET, type PastMarkColumn } from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { FIRST_DATA_ROW } from '../modules/people/student-import-read.js';
import { writePastMarkTemplate } from '../modules/setup/past-mark-import-template.js';

/** One row to type into the template of past marks: a text, a number or a date cell per column. */
export type PastMarkTemplateRow = Partial<Record<PastMarkColumn, string | number | Date>>;

/**
 * The system's template of past marks filled with `rows` from the first data row, as the school
 * would fill it in Excel (task 11.26). `edit` may change the workbook before it is written.
 */
export async function filledPastMarkTemplate(
  rows: readonly PastMarkTemplateRow[],
  edit?: (sheet: ExcelJS.Worksheet) => void,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await writePastMarkTemplate('en')) as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet(PAST_MARK_SHEET);
  if (sheet === undefined) {
    throw new Error('The template has its sheet.');
  }
  rows.forEach((row, index) => {
    const line = sheet.getRow(FIRST_DATA_ROW + index);
    PAST_MARK_COLUMNS.forEach((column, at) => {
      const value = row[column];
      if (value !== undefined && value !== '') {
        line.getCell(at + 1).value = value;
      }
    });
    line.commit();
  });
  edit?.(sheet);
  // The same rows give the same bytes (ExcelJS writes the moment of writing otherwise): one file.
  workbook.created = new Date('2026-09-01T00:00:00Z');
  workbook.modified = new Date('2026-09-01T00:00:00Z');
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
