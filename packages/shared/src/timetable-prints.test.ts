import { describe, expect, it } from 'vitest';
import { LANGUAGES } from './language.js';
import { fillText, VIEW_EXPORT_TEXTS, viewExportRequestSchema } from './timetable-prints.js';

const id = '0190f0c4-0000-7000-8000-000000000001';
const common = { date: '2026-11-09', span: 'week', format: 'pdf' } as const;

// Task 5.9c-1, review correction 6: each kind takes the id of its 5.9a query
// and no other; an id the kind has no use for is refused by the schema.
describe('the request of a timetable file', () => {
  it('takes each kind with its own id', () => {
    expect(viewExportRequestSchema.safeParse({ kind: 'branch', ...common }).success).toBe(true);
    expect(
      viewExportRequestSchema.safeParse({ kind: 'class', classId: id, ...common }).success,
    ).toBe(true);
    expect(
      viewExportRequestSchema.safeParse({ kind: 'teacher', staffId: id, ...common }).success,
    ).toBe(true);
    expect(
      viewExportRequestSchema.safeParse({
        kind: 'room',
        roomId: id,
        format: 'xlsx',
        date: '2026-11-09',
        span: 'day',
      }).success,
    ).toBe(true);
  });

  it('refuses an id on the school, a missing id, another kind’s id and extra keys', () => {
    expect(
      viewExportRequestSchema.safeParse({ kind: 'branch', classId: id, ...common }).success,
    ).toBe(false);
    expect(viewExportRequestSchema.safeParse({ kind: 'class', ...common }).success).toBe(false);
    expect(
      viewExportRequestSchema.safeParse({ kind: 'class', roomId: id, ...common }).success,
    ).toBe(false);
    expect(
      viewExportRequestSchema.safeParse({ kind: 'room', roomId: id, extra: 1, ...common }).success,
    ).toBe(false);
  });

  it('refuses an unknown kind, format or span and a bad date', () => {
    expect(viewExportRequestSchema.safeParse({ kind: 'school', ...common }).success).toBe(false);
    expect(
      viewExportRequestSchema.safeParse({ kind: 'branch', ...common, format: 'csv' }).success,
    ).toBe(false);
    expect(
      viewExportRequestSchema.safeParse({ kind: 'branch', ...common, span: 'month' }).success,
    ).toBe(false);
    expect(
      viewExportRequestSchema.safeParse({ kind: 'branch', ...common, date: '9.11.2026' }).success,
    ).toBe(false);
  });
});

const values = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : value !== null && typeof value === 'object'
      ? Object.values(value).flatMap(values)
      : [];

// `12`, Languages: "every label, message ... and export" in the three languages.
describe('the texts of a timetable file', () => {
  it('exist in the three languages, none empty, with the same parts to fill', () => {
    const parts = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((one) => one[1]);
    const paths = (value: unknown, path = ''): [string, string][] =>
      typeof value === 'string'
        ? [[path, value]]
        : value !== null && typeof value === 'object'
          ? Object.entries(value).flatMap(([key, one]) => paths(one, `${path}.${key}`))
          : [];
    const english = new Map(paths(VIEW_EXPORT_TEXTS.en));
    for (const language of LANGUAGES) {
      const texts = paths(VIEW_EXPORT_TEXTS[language]);
      expect(texts.map(([path]) => path).sort(), language).toEqual([...english.keys()].sort());
      for (const [path, text] of texts) {
        expect(text.trim(), `${language} ${path}`).not.toBe('');
        expect(parts(text).sort(), `${language} ${path}`).toEqual(
          parts(english.get(path) ?? '').sort(),
        );
      }
    }
  });

  it('write Uzbek oʻ and gʻ with U+02BB, never the keyboard apostrophe', () => {
    for (const text of values(VIEW_EXPORT_TEXTS.uz)) {
      expect(text, text).not.toMatch(/['`’‘]/);
    }
  });

  it('give a sheet name that Excel takes', () => {
    for (const language of LANGUAGES) {
      const name = VIEW_EXPORT_TEXTS[language].sheet;
      expect(name.length, language).toBeLessThanOrEqual(31);
      expect(name, language).not.toMatch(/[:\\/?*[\]]/);
    }
  });

  it('fill their parts and leave an unknown one as written', () => {
    expect(fillText('As of {{moment}}', { moment: '09.11.2026 08:00' })).toBe(
      'As of 09.11.2026 08:00',
    );
    expect(fillText('{{a}} {{b}}', { a: 'x' })).toBe('x {{b}}');
  });
});
