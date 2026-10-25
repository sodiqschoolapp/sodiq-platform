import {
  Injectable,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { EXPORT_COLUMNS_HEADER, EXPORT_ROWS_LEFT_OUT_HEADER } from '@sodiq/shared';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';
import { PDF_MEDIA_TYPE, PdfFile } from './pdf.js';

/** The media type of an Excel workbook. */
export const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * One cell of an export (edge cases, system behaviour: "Excel exports contain
 * real numbers and dates"): a text, a number, a school date (`YYYY-MM-DD`)
 * written as a date cell, a clock time in minutes of the day written as a
 * time cell (task 5.9c-1), or nothing.
 */
export type Cell = string | number | { date: string } | { time: number } | null;

export interface Sheet {
  /** The name of the sheet, in the language of the file. */
  name: string;
  headings: readonly string[];
  rows: readonly (readonly Cell[])[];
  /**
   * Lines above the heading row (task 5.9c-1: the title, "as of" and the
   * versions of a timetable); the heading row then is the frozen, bold one.
   */
  preamble?: readonly string[];
}

/**
 * A school date as a date cell. ExcelJS writes a `Date` by its UTC parts, so
 * the date is built in UTC: the cell shows the same day whatever the time
 * zone of the server.
 */
function dateOf(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`${date} is not a school date.`);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

/** A clock time as a time cell: the part of a day Excel counts in. */
const MINUTES_PER_DAY = 1440;

const valueOf = (cell: Cell): string | number | Date | null =>
  cell === null || typeof cell !== 'object'
    ? cell
    : 'date' in cell
      ? dateOf(cell.date)
      : cell.time / MINUTES_PER_DAY;

const textLength = (cell: Cell | undefined): number =>
  cell === null || cell === undefined
    ? 0
    : typeof cell !== 'object'
      ? String(cell).length
      : 'date' in cell
        ? cell.date.length
        : 5;

/**
 * One sheet with a bold, frozen heading row (below the preamble lines, if
 * any) and columns as wide as their longest text.
 */
export async function writeWorkbook(sheet: Sheet): Promise<Buffer> {
  return writeSheets([sheet]);
}

/**
 * A workbook of several sheets, each written as `writeWorkbook` writes one
 * (task 8.9: the branch export, one sheet per journal). The names are unique.
 */
export async function writeSheets(sheets: readonly Sheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    addSheet(workbook, sheet);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function addSheet(workbook: ExcelJS.Workbook, sheet: Sheet): void {
  const preamble = sheet.preamble ?? [];
  const worksheet = workbook.addWorksheet(sheet.name, {
    views: [{ state: 'frozen', ySplit: preamble.length + 1 }],
  });
  for (const line of preamble) {
    worksheet.addRow([line]);
  }
  worksheet.addRow([...sheet.headings]).font = { bold: true };
  for (const row of sheet.rows) {
    const added = worksheet.addRow(row.map(valueOf));
    // Task 8.9: a date or a time in a column of numbers (the date row of a journal) keeps its
    // own format; the column's format below is for a column of dates or times only.
    row.forEach((cell, index) => {
      if (cell !== null && typeof cell === 'object') {
        added.getCell(index + 1).numFmt = 'date' in cell ? 'yyyy-mm-dd' : 'hh:mm';
      }
    });
  }
  sheet.headings.forEach((heading, index) => {
    const column = worksheet.getColumn(index + 1);
    const widest = Math.max(heading.length, ...sheet.rows.map((row) => textLength(row[index])));
    column.width = Math.min(Math.max(widest + 2, 8), 60);
    const kinds = sheet.rows.map((row) => row[index]).filter((cell) => cell !== null);
    const only = (kind: 'date' | 'time') =>
      kinds.length > 0 &&
      kinds.every((cell) => cell !== undefined && typeof cell === 'object' && kind in cell);
    if (only('date')) {
      column.numFmt = 'yyyy-mm-dd';
    } else if (only('time')) {
      column.numFmt = 'hh:mm';
    }
  });
}

/**
 * The answer of an export route: the file, its names and the column keys
 * written. `@ReturnsFile()` sends it with its headers.
 */
export class XlsxFile {
  constructor(
    /** The file name in the language of the file, for `filename*`. */
    readonly fileName: string,
    /** The same name in ASCII letters, for a browser that ignores `filename*`. */
    readonly asciiName: string,
    /** The keys of the columns written, in their order. */
    readonly columns: readonly string[],
    readonly content: Buffer,
    /**
     * The rows sent that a scope left out (task 3.1c); `undefined` for a list
     * without a scope, whose file holds every row sent.
     */
    readonly rowsLeftOut?: number,
  ) {}
}

/** RFC 6266 and RFC 5987: an ASCII `filename` and the real name in `filename*`. */
export function contentDisposition(file: { fileName: string; asciiName: string }): string {
  const ascii = file.asciiName.replace(/[^\w.-]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`;
}

/**
 * Sends the `XlsxFile` a route returns as the file, with its type, its name
 * and the header naming the columns written, so the page says which columns
 * the server left out; or the `PdfFile` of a route that also makes PDFs
 * (task 5.9c-1, review correction 5), with its type and name. `Cache-Control: no-store` is already set for every
 * answer (`no-store.ts`).
 */
@Injectable()
export class XlsxFileInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((answer: unknown) => {
        if (answer instanceof PdfFile) {
          return new StreamableFile(answer.content, {
            type: PDF_MEDIA_TYPE,
            disposition: contentDisposition(answer),
            length: answer.content.length,
          });
        }
        if (!(answer instanceof XlsxFile)) {
          throw new Error(
            `${context.getClass().name}.${context.getHandler().name} answers a file, and returned something else.`,
          );
        }
        const response = context.switchToHttp().getResponse<Response>();
        response.setHeader(EXPORT_COLUMNS_HEADER, answer.columns.join(','));
        if (answer.rowsLeftOut !== undefined) {
          response.setHeader(EXPORT_ROWS_LEFT_OUT_HEADER, String(answer.rowsLeftOut));
        }
        return new StreamableFile(answer.content, {
          type: XLSX_MEDIA_TYPE,
          disposition: contentDisposition(answer),
          length: answer.content.length,
        });
      }),
    );
  }
}
