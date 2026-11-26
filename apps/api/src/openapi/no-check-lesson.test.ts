import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Task 11.24, Done when: "no route, field, text or page names a check lesson, a carry or a due
// date". The OpenAPI document (the routes and fields of the API, written by `pnpm api:client`)
// and the three locale files of the web app (every text of a page) hold none of the names the
// check lesson had.
const GONE = ['checkAt', 'carriedFrom', 'checkedToday', 'checkedSameDay', 'dueOn', 'ungraded'];
const GONE_PATHS = ['/works/carry'];

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n');

describe('the check lesson is gone (task 11.24)', () => {
  it('the OpenAPI document names no check lesson, carry or due date', () => {
    const document = read('../../openapi.generated.json');
    for (const name of [...GONE, ...GONE_PATHS]) expect(document, name).not.toContain(name);
  });

  it.each(['en', 'ru', 'uz'])('the %s locale file names none of them', (language) => {
    const locale = read(`../../../web/src/i18n/locales/${language}.ts`);
    for (const name of GONE) expect(locale, name).not.toMatch(new RegExp(`\\b${name}\\b`));
  });
});
