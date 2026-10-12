import {
  Injectable,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { EXPORT_COLUMNS_HEADER } from '@sodiq/shared';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';

/** The media type of an Excel workbook. */
export const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * One cell of an export (edge cases, system behaviour: "Excel exports contain
 * real numbers and dates"): a text, a number, a school date (`YYYY-MM-DD`)
 * written as a date cell, or nothing.
 */
export type Cell = string | number | { date: string } | null;

export interface Sheet {
  /** The name of the sheet, in the language of the file. */
  name: string;
  headings: readonly string[];
  rows: readonly (readonly Cell[])[];
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

/** One sheet with a bold, frozen heading row and columns as wide as their longest text. */
export async function writeWorkbook(sheet: Sheet): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheet.name, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  worksheet.addRow([...sheet.headings]).font = { bold: true };
  for (const row of sheet.rows) {
    worksheet.addRow(
      row.map((cell) => (cell !== null && typeof cell === 'object' ? dateOf(cell.date) : cell)),
    );
  }
  sheet.headings.forEach((heading, index) => {
    const column = worksheet.getColumn(index + 1);
    const widest = Math.max(
      heading.length,
      ...sheet.rows.map((row) => {
        const cell = row[index];
        return cell === null || cell === undefined
          ? 0
          : typeof cell === 'object'
            ? cell.date.length
            : String(cell).length;
      }),
    );
    column.width = Math.min(Math.max(widest + 2, 8), 60);
    if (sheet.rows.some((row) => typeof row[index] === 'object' && row[index] !== null)) {
      column.numFmt = 'yyyy-mm-dd';
    }
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
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
  ) {}
}

/** RFC 6266 and RFC 5987: an ASCII `filename` and the real name in `filename*`. */
export function contentDisposition(file: XlsxFile): string {
  const ascii = file.asciiName.replace(/[^\w.-]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`;
}

/**
 * Sends the `XlsxFile` a route returns as the file, with its type, its name
 * and the header naming the columns written, so the page says which columns
 * the server left out. `Cache-Control: no-store` is already set for every
 * answer (`no-store.ts`).
 */
@Injectable()
export class XlsxFileInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((answer: unknown) => {
        if (!(answer instanceof XlsxFile)) {
          throw new Error(
            `${context.getClass().name}.${context.getHandler().name} answers a file, and returned something else.`,
          );
        }
        const response = context.switchToHttp().getResponse<Response>();
        response.setHeader(EXPORT_COLUMNS_HEADER, answer.columns.join(','));
        return new StreamableFile(answer.content, {
          type: XLSX_MEDIA_TYPE,
          disposition: contentDisposition(answer),
          length: answer.content.length,
        });
      }),
    );
  }
}
