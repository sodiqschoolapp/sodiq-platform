import type { Appointment, Role } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199d000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const MATHEMATICS = { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' };
const PHYSICS = { uz: 'Fizika', ru: 'Физика', en: 'Physics' };

// All names are invented.
const HEAD: Appointment = {
  id: uid(1),
  role: 'head_teacher',
  person: { login: 'n.rahimova', name: { firstName: 'Nodira', lastName: 'Rahimova' } },
  subjects: [
    { id: uid(11), names: MATHEMATICS, archived: false },
    { id: uid(12), names: PHYSICS, archived: true },
  ],
  from: '2026-09-01',
  until: null,
  state: 'current',
};

// A Senior Head Teacher whose record is in another branch: the login only
// (decision 14 of #63).
const SENIOR: Appointment = {
  id: uid(2),
  role: 'senior_head_teacher',
  person: { login: 'b.toshev', name: null },
  subjects: [{ id: uid(11), names: MATHEMATICS, archived: false }],
  from: '2026-10-19',
  until: null,
  state: 'planned',
};

const ROUTE = 'GET /api/access/head-teachers';

function open(
  role: Role,
  appointments: Appointment[],
  language: 'en' | 'ru' = 'en',
  path = '/people/head-teachers',
) {
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(
        sessionOf({
          language,
          assignments: [
            {
              role,
              branchId: role === 'super_admin' || role === 'senior_head_teacher' ? null : NORTH.id,
            },
          ],
        }),
      ),
    [ROUTE]: () => json({ appointments }),
  });
  renderApp(path, language);
  return calls;
}

const rows = () => [...document.querySelectorAll('tbody tr')];
const cellsOf = (row: Element) => [...row.querySelectorAll('td')].map((cell) => cell.textContent);
const tabs = () => screen.queryByRole('navigation', { name: en.people.sections });

// `02`, Head Teachers and Senior Head Teachers; task 2.3b-2: the Head Teachers
// section of People.
describe('the Head Teachers of the branch', () => {
  it('lists each appointment with its subjects, dates and state in plain words', async () => {
    open('principal', [HEAD, SENIOR]);
    await screen.findByRole('heading', { name: en.people.headTeachers.title });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    const [head, senior] = rows().map(cellsOf);
    expect(head).toEqual(
      expect.arrayContaining([
        'Nodira Rahimova',
        en.roles.head_teacher,
        'Mathematics, Physics (archived)',
        en.people.headTeachers.states.current,
      ]),
    );
    expect(senior).toEqual(
      expect.arrayContaining([
        'b.toshev',
        en.roles.senior_head_teacher,
        'Mathematics',
        en.people.headTeachers.states.planned,
      ]),
    );
  });

  it('filters by role', async () => {
    open(
      'super_admin',
      [HEAD, SENIOR],
      'en',
      `/people/head-teachers?f=${encodeURIComponent(JSON.stringify({ role: 'senior_head_teacher' }))}`,
    );
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(cellsOf(rows()[0] ?? document.body)).toContain('b.toshev');
  });

  it('shows a failed list with a retry that reads it again', async () => {
    let fail = true;
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'principal', branchId: NORTH.id }] })),
      [ROUTE]: () => (fail ? refusal('internal_error', 500) : json({ appointments: [HEAD] })),
    });
    renderApp('/people/head-teachers');
    expect(await screen.findByText(en.errors.internal_error)).toBeDefined();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: en.problems.retry }));
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(calls.filter((call) => call.route === ROUTE).length).toBeGreaterThan(1);
  });

  it('shows the empty page with the first action to the Super Admin', async () => {
    open('super_admin', []);
    expect(await screen.findByText(en.people.headTeachers.emptyTitle)).toBeDefined();
    expect(screen.getByText(en.people.headTeachers.empty)).toBeDefined();
    expect(
      screen.getByRole('link', { name: en.people.headTeachers.toStaff }).getAttribute('href'),
    ).toBe('/people/staff');
  });

  it('shows the empty page without an action to the Principal', async () => {
    open('principal', []);
    expect(await screen.findByText(en.people.headTeachers.emptyTitle)).toBeDefined();
    expect(screen.getByText(en.people.headTeachers.emptyView)).toBeDefined();
    expect(screen.queryByRole('link', { name: en.people.headTeachers.toStaff })).toBeNull();
  });

  it('shows the sections as tabs to the Super Admin, and none to a Head Teacher', async () => {
    open('super_admin', [HEAD]);
    await screen.findByRole('heading', { name: en.people.headTeachers.title });
    const nav = within(tabs() ?? document.body);
    expect(nav.getAllByRole('link').map((link) => link.textContent)).toEqual([
      en.people.staff.title,
      en.people.vacancies.title,
      en.people.headTeachers.title,
      // Task 2.3c-1: the accounts never used, a fourth section.
      en.people.neverUsed.title,
    ]);
    expect(
      nav.getByRole('link', { name: en.people.headTeachers.title }).getAttribute('aria-current'),
    ).toBe('page');
  });

  it('shows a Head Teacher the list alone, without tabs', async () => {
    const calls = open('head_teacher', [HEAD]);
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(tabs()).toBeNull();
    expect(calls.some((call) => call.route === ROUTE)).toBe(true);
  });

  it('is in Russian', async () => {
    open('principal', [HEAD], 'ru');
    await screen.findByRole('heading', { name: ru.people.headTeachers.title });
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(cellsOf(rows()[0] ?? document.body)).toEqual(
      expect.arrayContaining([
        ru.roles.head_teacher,
        `Математика, ${ru.people.account.archivedSubject.replace('{{name}}', 'Физика')}`,
        ru.people.headTeachers.states.current,
      ]),
    );
  });
});

// The entry page of People and the menu: Head Teachers for every role that
// views the area (decision 7 of #64).
describe('People for a Head Teacher', () => {
  it.each(['head_teacher', 'senior_head_teacher'] as const)(
    'shows the item and the one link to a %s',
    async (role) => {
      fakeApi({
        'GET /api/auth/session': () =>
          json(
            sessionOf({
              assignments: [{ role, branchId: role === 'head_teacher' ? NORTH.id : null }],
            }),
          ),
      });
      renderApp('/people');
      await screen.findByRole('heading', { name: en.people.title });
      const list = within(screen.getByRole('list', { name: en.people.title }));
      expect(list.getAllByRole('link').map((link) => link.textContent)).toEqual([
        en.people.headTeachersLink,
      ]);
      expect(
        within(screen.getByRole('navigation', { name: en.layout.menu })).getByRole('link', {
          name: en.menu.people,
        }),
      ).toBeDefined();
    },
  );

  it('does not show the link to a Tutor', async () => {
    fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'tutor', branchId: NORTH.id }] })),
    });
    renderApp('/people');
    await screen.findByRole('heading', { name: en.people.title });
    expect(screen.queryByRole('link', { name: en.people.headTeachersLink })).toBeNull();
  });
});
