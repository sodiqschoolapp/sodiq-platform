import { inflateRawSync } from 'node:zlib';

/**
 * The texts an Excel file holds (task 5.9c-1, spec review must-fix 2), read
 * without a spreadsheet library: the `xl/sharedStrings.xml` entry of the zip,
 * where ExcelJS writes every text cell, in the order of first use.
 */
export function xlsxTexts(file: Buffer): string[] {
  let at = 0;
  while ((at = file.indexOf('PK\u0003\u0004', at, 'latin1')) >= 0) {
    const method = file.readUInt16LE(at + 8);
    const size = file.readUInt32LE(at + 18);
    const nameLength = file.readUInt16LE(at + 26);
    const extraLength = file.readUInt16LE(at + 28);
    const name = file.toString('utf8', at + 30, at + 30 + nameLength);
    const start = at + 30 + nameLength + extraLength;
    if (name === 'xl/sharedStrings.xml') {
      const data = file.subarray(start, start + size);
      const xml = (method === 8 ? inflateRawSync(data) : data).toString('utf8');
      return [...xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((one) =>
        (one[1] ?? '')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, '&'),
      );
    }
    at = start + size;
  }
  throw new Error('The file holds no texts.');
}
