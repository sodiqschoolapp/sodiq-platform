import ExcelJS from 'exceljs';
import type { Response } from 'supertest';

/** Reads an answer's body as bytes: supertest parses only texts and JSON by itself. */
export function binary(response: Response, done: (error: Error | null, body: Buffer) => void) {
  // While it is being read, the answer is the stream of node's own answer.
  const stream = response as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => {
    done(null, Buffer.concat(chunks));
  });
}

/** A school date read back from a date cell, as the file holds it (ExcelJS reads dates as UTC). */
export const dateOfCell = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString().slice(0, 10) : null;

export interface ReadSheet {
  name: string;
  headings: string[];
  /** Each row as wide as the headings; an empty cell is `null`. */
  rows: unknown[][];
}

/** The one sheet of an export file, read back with ExcelJS. */
export async function readSheet(content: Buffer): Promise<ReadSheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(content as unknown as ArrayBuffer);
  const [sheet, ...others] = workbook.worksheets;
  if (sheet === undefined || others.length > 0) {
    throw new Error('An export file has exactly one sheet.');
  }
  const lines: unknown[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    // `values` starts at index 1, as Excel counts columns.
    lines.push((row.values as unknown[]).slice(1));
  });
  const [headings = [], ...rows] = lines;
  const width = headings.length;
  return {
    name: sheet.name,
    headings: headings.map(String),
    rows: rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? null)),
  };
}

/** The file of an export answer, with what its headers say. */
export async function fileOf(response: Response) {
  const body = response.body as unknown;
  if (!Buffer.isBuffer(body)) {
    throw new Error(`The answer is not a file: ${JSON.stringify(body)}`);
  }
  return {
    type: response.headers['content-type'],
    disposition: response.headers['content-disposition'],
    columns: response.headers['x-export-columns'],
    cacheControl: response.headers['cache-control'],
    sheet: await readSheet(body),
  };
}
