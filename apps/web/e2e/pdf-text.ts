import { inflateSync } from 'node:zlib';

/**
 * What a PDF made by the server holds, read without a PDF library (task
 * 5.9c-1, spec review should-fix 5): the names of the embedded fonts, and the
 * text of each page through each font's ToUnicode map. It reads the files
 * Chromium writes (objects not in object streams, Flate streams, text drawn
 * with `<hex>` glyph codes of two bytes), nothing more.
 */
export interface PdfContent {
  /** The `/FontName` of every embedded font, without the subset prefix: `GolosText-Regular`. */
  fonts: string[];
  /** The text of each page in drawing order, spaces left out. */
  pages: string[];
}

interface PdfObject {
  dict: string;
  data: Buffer | null;
}

function objectsOf(pdf: Buffer): Map<number, PdfObject> {
  const text = pdf.toString('latin1');
  const objects = new Map<number, PdfObject>();
  for (const match of text.matchAll(/(\d+) 0 obj\b/g)) {
    const start = match.index + match[0].length;
    const end = text.indexOf('endobj', start);
    const body = text.slice(start, end);
    const at = body.indexOf('stream');
    if (at >= 0 && /\/Length/.test(body.slice(0, at))) {
      const dict = body.slice(0, at);
      let from = start + at + 'stream'.length;
      if (text[from] === '\r') from += 1;
      if (text[from] === '\n') from += 1;
      const bytes = pdf.subarray(from, text.indexOf('endstream', from));
      objects.set(Number(match[1]), {
        dict,
        data: /\/FlateDecode/.test(dict) ? inflateSync(bytes) : bytes,
      });
    } else {
      objects.set(Number(match[1]), { dict: body, data: null });
    }
  }
  return objects;
}

const hexText = (hex: string): string => {
  let text = '';
  for (let index = 0; index < hex.length; index += 4) {
    text += String.fromCodePoint(parseInt(hex.slice(index, index + 4), 16));
  }
  return text;
};

/** A font's ToUnicode map: glyph code (hex, upper case) to text. */
function unicodeOf(cmap: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const one of (block[1] ?? '').matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set((one[1] ?? '').toUpperCase(), hexText(one[2] ?? ''));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const one of (block[1] ?? '').matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
    )) {
      const first = parseInt(one[1] ?? '0', 16);
      const last = parseInt(one[2] ?? '0', 16);
      const code = parseInt(one[3] ?? '0', 16);
      for (let glyph = first; glyph <= last; glyph += 1) {
        map.set(
          glyph
            .toString(16)
            .toUpperCase()
            .padStart((one[1] ?? '').length, '0'),
          String.fromCodePoint(code + glyph - first),
        );
      }
    }
  }
  return map;
}

export function readPdf(pdf: Buffer): PdfContent {
  const objects = objectsOf(pdf);
  const dictOf = (id: string | undefined) => objects.get(Number(id))?.dict ?? '';
  const fonts = [
    ...pdf.toString('latin1').matchAll(/\/FontName\s*\/(?:[A-Z]{6}\+)?([^\s/>]+)/g),
  ].map((one) => one[1] ?? '');
  const pages: string[] = [];
  for (const page of [...objects.values()].filter((one) => /\/Type\s*\/Page\b/.test(one.dict))) {
    const resourcesRef = /\/Resources\s*(\d+) 0 R/.exec(page.dict)?.[1];
    const resources = resourcesRef === undefined ? page.dict : dictOf(resourcesRef);
    const fontRef = /\/Font\s*(\d+) 0 R/.exec(resources)?.[1];
    const fontPart =
      fontRef === undefined
        ? (/\/Font\s*<<([\s\S]*?)>>/.exec(resources)?.[1] ?? '')
        : dictOf(fontRef);
    const maps = new Map<string, Map<string, string>>();
    for (const one of fontPart.matchAll(/\/(\w+)\s+(\d+) 0 R/g)) {
      const toUnicode = /\/ToUnicode\s+(\d+) 0 R/.exec(dictOf(one[2]))?.[1];
      maps.set(
        one[1] ?? '',
        unicodeOf(objects.get(Number(toUnicode))?.data?.toString('latin1') ?? ''),
      );
    }
    const contentRefs =
      /\/Contents\s*\[([^\]]*)\]/.exec(page.dict)?.[1] ??
      /\/Contents\s*(\d+ 0 R)/.exec(page.dict)?.[1] ??
      '';
    const content = [...contentRefs.matchAll(/(\d+) 0 R/g)]
      .map((one) => objects.get(Number(one[1]))?.data?.toString('latin1') ?? '')
      .join('\n');
    let map = new Map<string, string>();
    let text = '';
    for (const one of content.matchAll(/\/(\w+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]*)>/g)) {
      if (one[1] !== undefined) {
        map = maps.get(one[1]) ?? new Map<string, string>();
      } else {
        const hex = one[2] ?? '';
        for (let index = 0; index < hex.length; index += 4) {
          text += map.get(hex.slice(index, index + 4).toUpperCase()) ?? '�';
        }
      }
    }
    pages.push(text.replace(/\s+/g, ''));
  }
  return { fonts, pages };
}

/** A text as `readPdf` gives it: spaces left out. */
export const pdfText = (text: string): string => text.replace(/\s+/g, '');
