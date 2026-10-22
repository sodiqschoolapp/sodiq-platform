import ExcelJS from 'exceljs';
import type { Response } from 'supertest';
import { expect } from 'vitest';
import { ApiException } from '../http/api-exception.js';
import type { PdfRenderer } from '../http/pdf.js';
import { errorCode } from './sign-in-kit.js';

/**
 * The fake renderer and readers of the timetable files (tasks 5.9c-1 and
 * 5.9c-2): the API tests keep the HTML of each PDF; Chromium runs in the
 * browser test.
 */

/** Keeps the HTML of each PDF it is asked for; a fake for the API tests (Chromium runs in the browser test). */
export class RecordingPdf implements PdfRenderer {
  readonly htmls: string[] = [];
  failing = false;

  render(html: string): Promise<Buffer> {
    if (this.failing) return Promise.reject(new ApiException('pdf_unavailable', 503));
    this.htmls.push(html);
    return Promise.resolve(Buffer.from('%PDF-1.7 recorded'));
  }

  get last(): string {
    const html = this.htmls[this.htmls.length - 1];
    if (html === undefined) throw new Error('No PDF was made.');
    return html;
  }
}

/** A refusal is JSON; the file routes read every body as bytes. */
export const refusedFile = (response: Response, status: number, code: string) => {
  const body: unknown = Buffer.isBuffer(response.body)
    ? JSON.parse(response.body.toString('utf8'))
    : response.body;
  expect(response.status, JSON.stringify(body)).toBe(status);
  expect(errorCode({ ...response, body } as Response)).toBe(code);
};

/** The lines of the one sheet, each cell as ExcelJS reads it back. */
export async function linesOf(content: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(content as unknown as ArrayBuffer);
  const [sheet] = workbook.worksheets;
  if (sheet === undefined) throw new Error('The file has no sheet.');
  const lines: { values: unknown[]; bold: boolean }[] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    lines.push({
      values: (row.values as unknown[]).slice(1),
      bold: row.getCell(1).font?.bold === true,
    });
  });
  return { sheet, lines };
}
