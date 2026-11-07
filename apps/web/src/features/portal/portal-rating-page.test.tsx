import { screen, within } from '@testing-library/react';
import type { PortalChildren, PortalRating } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, renderApp, sessionOf } from '@/testing/render-app';

// Task 11.6: the Rating page of the parent portal (`08`, Rating, "Own position"). All names are
// invented.
const PARENT = (language: 'en' | 'ru' = 'en') =>
  sessionOf({
    login: 'd.karimova',
    kind: 'parent',
    fullName: 'Dilfuza Karimova',
    assignments: [],
    branches: [],
    language,
  });

const ANVAR = '0190a000-0000-7000-8000-00000000000a';
const Q1 = '0190a000-0000-7000-8000-0000000000d1';
const Q2 = '0190a000-0000-7000-8000-0000000000d2';

const CHILDREN: PortalChildren = {
  children: [{ id: ANVAR, firstName: 'Anvar', lastName: 'Karimov', className: '7 Oxford' }],
};

const RATING = (over: Partial<PortalRating> = {}): PortalRating => ({
  quarters: [
    { id: Q1, number: 1, startDate: '2026-09-02', endDate: '2026-10-31', closed: false },
    { id: Q2, number: 2, startDate: '2026-11-09', endDate: '2026-12-28', closed: false },
  ],
  quarterId: Q1,
  provisional: true,
  notOfficial: false,
  class: {
    name: '7 Oxford',
    place: 3,
    value: 843,
    subjects: 9,
    fewerSubjects: false,
    average: 781,
  },
  ...over,
});

function portal(rating: PortalRating, language: 'en' | 'ru' = 'en') {
  return fakeApi({
    'GET /api/auth/session': () => json(PARENT(language)),
    'GET /api/portal/children': () => json(CHILDREN),
    [`GET /api/portal/children/${ANVAR}/rating`]: () => json(rating),
  });
}

describe('the portal rating', () => {
  it('shows the child’s place in the class, the child’s figure, the class average and "provisional"', async () => {
    portal(RATING());
    renderApp(`/portal/${ANVAR}/rating`);
    const card = await screen.findByRole('region', { name: 'Place 3 in 7 Oxford' });
    expect(card.querySelector('[data-figure="own"]')?.textContent).toBe('84.3');
    expect(card.querySelector('[data-figure="average"]')?.textContent).toBe('78.1');
    expect(within(card).getByText(/9 subjects with a result/)).toBeDefined();
    expect(within(card).queryByText(new RegExp(en.portal.rating.fewerSubjects))).toBeNull();
    expect(screen.getByText(en.portal.rating.provisional)).toBeDefined();
    // The tab of the frame.
    expect(
      screen.getByRole('link', { name: en.portal.rating.title }).getAttribute('aria-current'),
    ).toBe('page');
  });

  it('says "final" for a closed quarter, and marks fewer subjects', async () => {
    portal(
      RATING({
        provisional: false,
        class: {
          name: '7 Oxford',
          place: 1,
          value: 1000,
          subjects: 8,
          fewerSubjects: true,
          average: 812,
        },
      }),
    );
    renderApp(`/portal/${ANVAR}/rating`);
    const card = await screen.findByRole('region', { name: 'Place 1 in 7 Oxford' });
    expect(screen.getByText(en.portal.rating.final)).toBeDefined();
    expect(screen.queryByText(en.portal.rating.provisional)).toBeNull();
    expect(within(card).getByText(new RegExp(en.portal.rating.fewerSubjects))).toBeDefined();
  });

  it('says there is no place yet for a child without a number, with the average still shown', async () => {
    portal(
      RATING({
        class: {
          name: '7 Oxford',
          place: null,
          value: null,
          subjects: 0,
          fewerSubjects: false,
          average: 781,
        },
      }),
    );
    renderApp(`/portal/${ANVAR}/rating`);
    const card = await screen.findByRole('region', {
      name: en.portal.rating.noPlace.replace('{{className}}', '7 Oxford'),
    });
    expect(card.querySelector('[data-figure="own"]')?.textContent).toBe(en.results.none);
    expect(card.querySelector('[data-figure="average"]')?.textContent).toBe('78.1');
  });

  it('says so when the child is in no class on the reference date', async () => {
    portal(RATING({ class: null }));
    renderApp(`/portal/${ANVAR}/rating`);
    await screen.findByText(en.portal.rating.noClass);
  });

  it('says so when the branch has no quarter to show', async () => {
    portal(RATING({ quarters: [], quarterId: null, class: null }));
    renderApp(`/portal/${ANVAR}/rating`);
    await screen.findByText(en.portal.rating.noYear);
  });

  it('speaks the parent’s language', async () => {
    portal(RATING(), 'ru');
    renderApp(`/portal/${ANVAR}/rating`, 'ru');
    await screen.findByRole('region', { name: '3-е место в классе 7 Oxford' });
    expect(screen.getByText(ru.portal.rating.provisional)).toBeDefined();
  });
});
