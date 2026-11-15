import {
  LOAD_IMPORT_COLUMNS,
  LOAD_IMPORT_LISTS_SHEET,
  LOAD_IMPORT_META_COLUMN,
  LOAD_IMPORT_SHEET,
  type LoadImportColumn,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { FIRST_DATA_ROW } from '../modules/people/student-import-read.js';

/** A row of a filled load template: the cells by column, as a person types them. */
export type LoadTemplateRow = Partial<Record<LoadImportColumn, string>>;

/**
 * The template the route answered, filled with `rows` from its third row (task 5.13). `meta`
 * replaces the draft id and language in the hidden column, to make a file of another draft.
 * Names are invented.
 */
export async function filledLoadTemplate(
  template: Buffer,
  rows: readonly LoadTemplateRow[],
  meta: { versionId?: string } = {},
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet(LOAD_IMPORT_SHEET);
  if (sheet === undefined) {
    throw new Error('The template has no load sheet.');
  }
  rows.forEach((row, at) => {
    LOAD_IMPORT_COLUMNS.forEach((column, index) => {
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

/** The values of one list of the template's sheet of lists, by its heading. */
export async function templateList(template: Buffer, heading: string): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template as unknown as ExcelJS.Buffer);
  const lists = workbook.getWorksheet(LOAD_IMPORT_LISTS_SHEET);
  if (lists === undefined) {
    return [];
  }
  const values: string[] = [];
  lists.getRow(1).eachCell((cell, column) => {
    if (cell.value === heading) {
      for (let row = 2; row <= lists.rowCount; row += 1) {
        const value = lists.getCell(row, column).value;
        if (typeof value === 'string' && value !== '') values.push(value);
      }
    }
  });
  return values;
}
