import {
  LOAD_IMPORT_LISTS_SHEET,
  LOAD_IMPORT_META_COLUMN,
  PATTERN_IMPORT_COLUMNS,
  PATTERN_IMPORT_SHEET,
  type PatternImportColumn,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { FIRST_DATA_ROW } from '../modules/people/student-import-read.js';

/** A row of a filled timetable template: the cells by column, as a person types them. */
export type PatternTemplateRow = Partial<Record<PatternImportColumn, string>>;

/**
 * The template the route answered, filled with `rows` from its third row (task 5.14). `meta`
 * replaces the draft id in the hidden column, to make a file of another draft. Names are invented.
 */
export async function filledPatternTemplate(
  template: Buffer,
  rows: readonly PatternTemplateRow[],
  meta: { versionId?: string } = {},
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet(PATTERN_IMPORT_SHEET);
  if (sheet === undefined) {
    throw new Error('The template has no timetable sheet.');
  }
  rows.forEach((row, at) => {
    PATTERN_IMPORT_COLUMNS.forEach((column, index) => {
      const value = row[column];
      if (value !== undefined) {
        sheet.getCell(FIRST_DATA_ROW + at, index + 1).value = value;
      }
    });
  });
  if (meta.versionId !== undefined) {
    const lists = workbook.getWorksheet(LOAD_IMPORT_LISTS_SHEET);
    if (lists === undefined) {
      throw new Error('The template has no lists.');
    }
    lists.getCell(`${LOAD_IMPORT_META_COLUMN}1`).value = meta.versionId;
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
