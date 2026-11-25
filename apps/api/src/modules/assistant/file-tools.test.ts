import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  confirmRouteOf,
  fileToolOf,
  IMPORT_UPLOADS,
  isExportRoute,
  SHEET_MAX_ROWS,
  workbookText,
} from './file-tools.js';
import { ROUTE_LINES, kindOfLine } from '../access/assistant-routes.js';

// Task 11.22 (plan, The engine): an Excel workbook is given to the model as text, since Gemini
// does not read `.xlsx`; the tools of files run only the routes the plan names. Names are invented.

async function workbook(sheets: Record<string, (string | number | Date)[][]>): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = book.addWorksheet(name);
    for (const row of rows) sheet.addRow(row);
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe('the tools of files', () => {
  it('read a workbook as text, sheet by sheet, cells as shown', async () => {
    const text = await workbook({
      Absent: [
        ['Name', 'Class', 'Days', 'From'],
        ['Aziza Karimova', '7B', 2, new Date(Date.UTC(2026, 10, 20))],
      ],
      Notes: [['Bring the forms.']],
    });
    expect(await workbookText(text)).toBe(
      'Sheet: Absent\nName | Class | Days | From\nAziza Karimova | 7B | 2 | ' +
        new Date(Date.UTC(2026, 10, 20)).toString() +
        '\nSheet: Notes\nBring the forms.',
    );
  });

  it('cut a workbook after 2 000 rows and say so', async () => {
    const rows = Array.from({ length: SHEET_MAX_ROWS + 5 }, (_, index) => [`Row ${String(index)}`]);
    const text = (await workbookText(await workbook({ Long: rows }))) ?? '';
    expect(text).toContain(`Row ${String(SHEET_MAX_ROWS - 1)}`);
    expect(text).not.toContain(`Row ${String(SHEET_MAX_ROWS)}\n`);
    expect(text).toContain('The workbook was cut after 2000 rows');
  });

  it('answer nothing for bytes that are not a workbook', async () => {
    expect(await workbookText(Buffer.from('not a workbook'))).toBeUndefined();
  });

  it('run the five import uploads and their confirms, and every export but the journal’s background one', () => {
    for (const [kind, route] of Object.entries(IMPORT_UPLOADS)) {
      const line = ROUTE_LINES[route];
      expect(line === undefined ? undefined : kindOfLine(line), route).toBe('file');
      const confirm = confirmRouteOf(kind as keyof typeof IMPORT_UPLOADS);
      expect(ROUTE_LINES[confirm]?.kind, confirm).toBe('change');
    }
    const tools = Object.entries(ROUTE_LINES)
      .map(([route, line]) => [route, fileToolOf(route, kindOfLine(line))])
      .filter(([, tool]) => tool !== undefined);
    // A stored file of a record (a photo, a plan file, a document) has no tool (decision 7).
    expect(tools.some(([route]) => route === 'GET /api/plans/files/:fileId')).toBe(false);
    expect(tools.some(([route]) => route === 'PUT /api/people/students/:id/photo')).toBe(false);
    expect(isExportRoute('POST /api/journal/exports', 'export')).toBe(false);
    expect(isExportRoute('POST /api/people/students/export', 'download')).toBe(true);
    expect(isExportRoute('GET /api/people/students/import-template', 'download')).toBe(true);
    expect(isExportRoute('POST /api/people/students/:id/report', 'export')).toBe(true);
  });
});
