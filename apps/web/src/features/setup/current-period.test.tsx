import type { CurrentPeriod } from '@sodiq/shared';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, renderApp, sessionOf } from '@/testing/render-app';

const YEAR = { id: '0199a000-0000-7000-8000-000000000401', name: '2026–2027', status: 'current' };

const q = (number: number, startDate: string, endDate: string) => ({ number, startDate, endDate });

async function topBarWith(period: CurrentPeriod, language: 'en' | 'ru' = 'en'): Promise<string> {
  const texts = language === 'ru' ? ru : en;
  fakeApi({
    'GET /api/auth/session': () => json({ ...sessionOf(), language }),
    'GET /api/setup/current-period': () => json(period),
  });
  renderApp('/', language);
  const label = await screen.findByLabelText(texts.period.label);
  return label.textContent ?? '';
}

// docs/spec/03-school-setup.md: "The current academic year and quarter are
// always shown in the top bar." `12`, Context. edge/time-dates-calendar, "A
// page is opened on a date that is in no quarter": "The top bar shows
// 'Vacation, quarter 2 starts on 10 November' ... Before quarter 1, pages show
// a plain 'quarter 1 starts on...' message." edge/academic-year: "The top bar
// labels a planned year." Owner's answer 8; decision 9 of pull request #44.
describe('the top bar', () => {
  it('shows the current year and quarter', async () => {
    expect(
      await topBarWith({
        today: '2026-11-20',
        year: YEAR,
        state: 'in_quarter',
        quarter: q(2, '2026-11-10', '2026-12-27'),
        next: null,
      }),
    ).toBe('2026–2027 · Quarter 2');
  });

  it('shows a vacation with the start of the next quarter', async () => {
    expect(
      await topBarWith({
        today: '2026-11-05',
        year: YEAR,
        state: 'vacation',
        quarter: q(1, '2026-09-02', '2026-10-31'),
        next: q(2, '2026-11-10', '2026-12-27'),
      }),
    ).toBe('2026–2027 · Vacation, quarter 2 starts on November 10');
  });

  it('shows a vacation alone after the last quarter', async () => {
    expect(
      await topBarWith({
        today: '2027-06-10',
        year: YEAR,
        state: 'vacation',
        quarter: q(4, '2027-03-30', '2027-05-25'),
        next: null,
      }),
    ).toBe('2026–2027 · Vacation');
  });

  it('labels a planned year and says when quarter 1 starts', async () => {
    expect(
      await topBarWith({
        today: '2027-08-20',
        year: { ...YEAR, name: '2027–2028', status: 'planned' },
        state: 'before_first',
        quarter: null,
        next: q(1, '2027-09-02', '2027-10-31'),
      }),
    ).toBe('2027–2028 (planned) · Quarter 1 starts on September 2');
  });

  it('says when the quarters are not dated', async () => {
    expect(
      await topBarWith({
        today: '2026-08-20',
        year: YEAR,
        state: 'not_dated',
        quarter: null,
        next: null,
      }),
    ).toBe('2026–2027 · Quarters not dated');
  });

  it('says there is no year', async () => {
    expect(
      await topBarWith({
        today: '2026-08-20',
        year: null,
        state: 'no_year',
        quarter: null,
        next: null,
      }),
    ).toBe(en.period.noYear);
  });

  it('speaks the chosen language, dates included', async () => {
    expect(
      await topBarWith(
        {
          today: '2026-11-05',
          year: YEAR,
          state: 'vacation',
          quarter: q(1, '2026-09-02', '2026-10-31'),
          next: q(2, '2026-11-10', '2026-12-27'),
        },
        'ru',
      ),
    ).toBe('2026–2027 · Каникулы, 2-я четверть начинается 10 ноября');
  });
});
