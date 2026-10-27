import { describe, expect, it } from 'vitest';
import type { PdfRenderer } from '../http/pdf.js';
import { PDF_CHECK_TEXT, pdfCheck, PdfCheckError } from './pdf-check.js';

// Task 10.4: the image check renders through the real renderer; here the
// renderer is a fake, and the job `image` of deploy-production.yml runs the
// same function with the image's Chromium.
const fake = (answer: Buffer) => {
  const documents: string[] = [];
  const renderer: PdfRenderer = {
    render: (html) => {
      documents.push(html);
      return Promise.resolve(answer);
    },
  };
  return { renderer, documents };
};

describe('the PDF check of the production image', () => {
  it('renders Uzbek Latin and Cyrillic with the embedded fonts and the logo', async () => {
    const { renderer, documents } = fake(Buffer.from('%PDF-1.7 invented'));

    await expect(pdfCheck(renderer)).resolves.toBe(17);
    expect(documents).toHaveLength(1);
    expect(documents[0]).toContain(PDF_CHECK_TEXT);
    expect(PDF_CHECK_TEXT).toContain('ʻ');
    expect(PDF_CHECK_TEXT).toMatch(/[Ўқ]/);
    expect(documents[0]).toContain('@font-face');
    expect(documents[0]).toContain('<svg');
  });

  it('fails when the answer is not a PDF', async () => {
    const { renderer } = fake(Buffer.from('<html>'));

    await expect(pdfCheck(renderer)).rejects.toBeInstanceOf(PdfCheckError);
  });
});
