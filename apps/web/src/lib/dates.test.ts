import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatMoment,
  formatMomentIn,
  momentDateText,
  momentText,
  monthsText,
  schoolDateText,
  weekdayName,
} from './dates';

// Issue #39, hand test of 13 October 2026, finding 3: where the browser's
// language data is trimmed, `Intl` claims Uzbek and has no Uzbek names
// ("2026 M09 2"). The stub answers that way for `uz` and records which
// languages were asked; every other language goes to the real `Intl`.
const RealDateTimeFormat = Intl.DateTimeFormat;
let asked: string[] = [];

function trimmed(locale: string | string[] | undefined, options?: Intl.DateTimeFormatOptions) {
  const language = Array.isArray(locale) ? (locale[0] ?? '') : (locale ?? '');
  asked.push(language);
  const real = new RealDateTimeFormat(language, options);
  if (!language.startsWith('uz')) {
    return real;
  }
  return Object.assign(Object.create(real) as Intl.DateTimeFormat, {
    format: () => '2026 M09 2',
    formatToParts: () => [{ type: 'literal', value: '2026 M09 2' }],
  });
}

beforeEach(() => {
  asked = [];
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(trimmed as typeof Intl.DateTimeFormat);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Uzbek dates come from the app, not from the browser', () => {
  it('writes a school date with the Uzbek month name', () => {
    expect(schoolDateText('2026-09-02', 'uz')).toBe('2-sentabr, 2026');
    expect(schoolDateText('2026-12-08', 'uz')).toBe('8-dekabr, 2026');
    expect(schoolDateText('2026-12-08', 'uz', false)).toBe('8-dekabr');
  });

  it('names months and weekdays with a capital', () => {
    expect(monthsText('2026-09-01', '2026-10-31', 'uz')).toBe('Sentabr – Oktabr');
    expect(monthsText('2026-11-02', '2026-11-30', 'uz')).toBe('Noyabr');
    expect(weekdayName('uz', 1)).toBe('Dushanba');
    expect(weekdayName('uz', 7)).toBe('Yakshanba');
  });

  it('writes a moment with the 24-hour clock in the time zone given', () => {
    expect(formatMomentIn('uz', '2026-09-02T10:03:00.000Z', 'Asia/Tashkent')).toBe(
      '2-sentabr, 2026, 15:03',
    );
    expect(momentDateText('uz', '2026-10-01T20:00:00.000Z', { timeZone: 'Asia/Tashkent' })).toBe(
      '2-oktabr, 2026',
    );
  });

  it('never shows a month as "M" in any day of the year', () => {
    for (let day = 0; day < 365; day += 1) {
      const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
      const text = schoolDateText(date, 'uz');
      expect(text).toMatch(/^\d{1,2}-[a-z]+, 2026$/);
      expect(text).not.toContain('M');
    }
  });
});

describe('Russian and English go through the browser', () => {
  it('asks Intl for Russian, and English day-first', () => {
    expect(schoolDateText('2026-12-08', 'ru')).toBe('8 декабря 2026 г.');
    expect(schoolDateText('2026-12-08', 'en')).toBe('8 December 2026');
    expect(asked).toEqual(['ru', 'en-GB']);
  });

  it('writes English moments day-first on the 24-hour clock (answer 38)', () => {
    expect(formatMomentIn('en', '2026-10-13T10:03:00.000Z', 'Asia/Tashkent')).toBe(
      '13 Oct 2026, 15:03',
    );
    expect(
      momentText('en', '2026-10-13T10:03:00.000Z', { timeZone: 'Asia/Tashkent', month: 'long' }),
    ).toBe('13 October 2026, 15:03');
    expect(momentDateText('en', '2026-10-01T07:00:00.000Z', { timeZone: 'Asia/Tashkent' })).toBe(
      '1 Oct 2026',
    );
  });

  it('writes the English short month of September as "Sep" in every browser', () => {
    expect(formatMomentIn('en', '2026-09-02T10:03:00.000Z', 'Asia/Tashkent')).toBe(
      '2 Sep 2026, 15:03',
    );
    expect(momentDateText('en', '2026-06-05T10:00:00.000Z', { timeZone: 'Asia/Tashkent' })).toBe(
      '5 Jun 2026',
    );
  });

  it('writes Russian moments on the 24-hour clock', () => {
    expect(formatMomentIn('ru', '2026-10-13T10:03:00.000Z', 'Asia/Tashkent')).toBe(
      '13 окт. 2026 г., 15:03',
    );
  });

  it('names English weekdays and months', () => {
    expect(weekdayName('en', 1)).toBe('Monday');
    expect(monthsText('2026-09-01', '2026-10-31', 'en')).toBe('September – October');
  });
});

describe('the time zone', () => {
  it('never moves a school date', () => {
    expect(schoolDateText('2026-01-01', 'en')).toBe('1 January 2026');
  });

  it('reads a moment in the device time zone when none is given', () => {
    const iso = '2026-10-13T10:03:00.000Z';
    expect(formatMoment('en', iso)).toBe(momentText('en', iso));
  });
});
