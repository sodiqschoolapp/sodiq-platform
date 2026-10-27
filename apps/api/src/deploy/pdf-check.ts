import {
  letterheadLogo,
  PDF_FONT_FAMILY,
  pdfFontFaces,
  type PdfRenderer,
  UZBEK_MARK_FAMILY,
} from '../http/pdf.js';

/**
 * The PDF check of the production image (task 10.4; owner's answer 15: Print
 * and PDF work in production). Run inside the image by the job `image` of
 * `.github/workflows/deploy-production.yml`, never by the services: the real
 * renderer, the image's Chromium, the fonts of Uzbek Latin and Cyrillic and
 * the letterhead logo read from the image's files make one page.
 */

export class PdfCheckError extends Error {}

/** Invented words in Uzbek Latin (with U+02BB) and Cyrillic, and in Russian. */
export const PDF_CHECK_TEXT = 'Oʻquvchilar jurnali · Ўқувчилар журнали · Журнал учеников';

export function pdfCheckDocument(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
${pdfFontFaces()}
@page { size: A4; margin: 15mm; }
body { font-family: '${UZBEK_MARK_FAMILY}', '${PDF_FONT_FAMILY}'; }
</style></head>
<body>${letterheadLogo()}<p>${PDF_CHECK_TEXT}</p></body></html>`;
}

/** Renders the page and returns its size in bytes; throws when it is not a PDF. */
export async function pdfCheck(renderer: PdfRenderer): Promise<number> {
  const file = await renderer.render(pdfCheckDocument());
  if (file.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new PdfCheckError('The renderer did not answer a PDF.');
  }
  return file.length;
}
