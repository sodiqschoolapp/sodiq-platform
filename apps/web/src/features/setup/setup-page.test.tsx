import type { Role, SetupChecklist } from '@sodiq/shared';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const sessionAs = (role: Role) =>
  sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
    branches: [NORTH],
  });

const menu = () => within(screen.getByRole('navigation', { name: en.layout.menu }));

// docs/spec/03-school-setup.md: setup is owned by the Super Admin; `02`: the
// Principal views everything in the branch; the Academic Vice Principal's
// view was approved by the owner (pull request #37, answer 5). The menu shows
// the item only to the roles the permission table lets view it.
describe('the School setup entry', () => {
  it.each(['super_admin', 'principal', 'academic_vice_principal'] as const)(
    'is in the menu of the %s',
    async (role) => {
      fakeApi({ 'GET /api/auth/session': () => json(sessionAs(role)) });
      renderApp('/');
      await screen.findByRole('heading', { name: en.home.title });

      expect(menu().getByRole('link', { name: en.menu.setup }).getAttribute('href')).toBe('/setup');
    },
  );

  it.each(['teacher', 'head_teacher', 'tutor', 'head_tutor', 'senior_head_teacher'] as const)(
    'is not in the menu of the %s',
    async (role) => {
      fakeApi({ 'GET /api/auth/session': () => json(sessionAs(role)) });
      renderApp('/');
      await screen.findByRole('heading', { name: en.home.title });

      expect(menu().queryByRole('link', { name: en.menu.setup })).toBeNull();
    },
  );

  it('lists the branch, the buildings, the rooms, the divisions and the years for the Super Admin, each a link', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionAs('super_admin')) });
    renderApp('/setup');
    await screen.findByRole('heading', { name: en.setup.title });

    expect(screen.getByRole('link', { name: en.setup.branchLink }).getAttribute('href')).toBe(
      '/setup/branch',
    );
    expect(screen.getByRole('link', { name: en.setup.buildingsLink }).getAttribute('href')).toBe(
      '/setup/buildings',
    );
    expect(screen.getByRole('link', { name: en.setup.roomsLink }).getAttribute('href')).toBe(
      '/setup/rooms',
    );
    expect(screen.getByRole('link', { name: en.setup.divisionsLink }).getAttribute('href')).toBe(
      '/setup/divisions',
    );
    expect(screen.getByRole('link', { name: en.setup.yearsLink }).getAttribute('href')).toBe(
      '/setup/years',
    );
    const crumbs = screen.getByRole('navigation', { name: en.layout.breadcrumbs });
    expect(within(crumbs).getByRole('link', { name: en.home.title })).toBeDefined();
  });

  // .claude/rules/web.md, Text on screens: "A menu page is a title and its
  // links" (issue #39, item 4; pull request #80, decision 2): no intro under
  // the title and no line under a link.
  it('is a title and its links, with no intro and no line under a link', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionAs('principal')) });
    renderApp('/setup');
    const title = await screen.findByRole('heading', { name: en.setup.title, level: 1 });
    expect(title.closest('header')?.nextElementSibling?.tagName).not.toBe('P');
    const items = within(screen.getByRole('list', { name: en.setup.title })).getAllByRole(
      'listitem',
    );
    expect(items.length).toBeGreaterThan(5);
    for (const item of items) {
      expect(item.textContent).toBe(within(item).getByRole('link').textContent);
    }
  });

  // Owner's answer 3 (task 1.3): the Principal and the Academic Vice Principal view the years.
  it.each(['principal', 'academic_vice_principal'] as const)(
    'lists the academic years for the %s',
    async (role) => {
      fakeApi({ 'GET /api/auth/session': () => json(sessionAs(role)) });
      renderApp('/setup');
      await screen.findByRole('heading', { name: en.setup.title });

      expect(screen.getByRole('link', { name: en.setup.yearsLink }).getAttribute('href')).toBe(
        '/setup/years',
      );
    },
  );

  // Owner's answer 14 (task 1.5): the Super Admin, the Principal and the
  // Academic Vice Principal view the slot types and day templates.
  it.each(['super_admin', 'principal', 'academic_vice_principal'] as const)(
    'lists the slot types, the day templates and where they apply for the %s',
    async (role) => {
      fakeApi({ 'GET /api/auth/session': () => json(sessionAs(role)) });
      renderApp('/setup');
      await screen.findByRole('heading', { name: en.setup.title });

      expect(screen.getByRole('link', { name: en.setup.slotTypesLink }).getAttribute('href')).toBe(
        '/setup/slot-types',
      );
      expect(
        screen.getByRole('link', { name: en.setup.dayTemplatesLink }).getAttribute('href'),
      ).toBe('/setup/day-templates');
      expect(
        screen.getByRole('link', { name: en.setup.templateSettingsLink }).getAttribute('href'),
      ).toBe('/setup/day-template-settings');
    },
  );

  // Owner's answer 18 (task 1.4): the Super Admin, the Principal and the
  // Academic Vice Principal view the calendar.
  it.each(['super_admin', 'principal', 'academic_vice_principal'] as const)(
    'lists the calendar for the %s',
    async (role) => {
      fakeApi({ 'GET /api/auth/session': () => json(sessionAs(role)) });
      renderApp('/setup');
      await screen.findByRole('heading', { name: en.setup.title });

      expect(screen.getByRole('link', { name: en.setup.calendarLink }).getAttribute('href')).toBe(
        '/setup/calendar',
      );
    },
  );

  // Answer 24 (task 1.6): the settings and the travel time for the three roles.
  it.each(['super_admin', 'principal', 'academic_vice_principal'] as const)(
    'lists the settings and the travel time for the %s',
    async (role) => {
      fakeApi({ 'GET /api/auth/session': () => json(sessionAs(role)) });
      renderApp('/setup');
      await screen.findByRole('heading', { name: en.setup.title });

      expect(screen.getByRole('link', { name: en.setup.settingsLink }).getAttribute('href')).toBe(
        '/setup/settings',
      );
      expect(
        screen.getByRole('link', { name: en.setup.travelTimesLink }).getAttribute('href'),
      ).toBe('/setup/travel-times');
    },
  );

  // Task 2.1, the owner's answer 4: the subjects for the three roles, nobody else.
  it.each(['super_admin', 'principal', 'academic_vice_principal'] as const)(
    'lists the subjects for the %s',
    async (role) => {
      fakeApi({ 'GET /api/auth/session': () => json(sessionAs(role)) });
      renderApp('/setup');
      await screen.findByRole('heading', { name: en.setup.title });

      expect(screen.getByRole('link', { name: en.setup.subjectsLink }).getAttribute('href')).toBe(
        '/setup/subjects',
      );
    },
  );

  it('says that a role without setup rights has no setup pages', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionAs('teacher')) });
    renderApp('/setup');
    await screen.findByRole('heading', { name: en.setup.title });

    expect(screen.getByText(en.setup.none)).toBeDefined();
    expect(screen.queryByRole('link', { name: en.setup.roomsLink })).toBeNull();
    expect(screen.queryByRole('link', { name: en.setup.dayTemplatesLink })).toBeNull();
    expect(screen.queryByRole('link', { name: en.setup.subjectsLink })).toBeNull();
  });
});

const CHECKLIST: SetupChecklist = {
  items: [
    { key: 'branch', done: true, count: null, years: [] },
    { key: 'rooms', done: false, count: null, years: [] },
    { key: 'departments', done: true, count: null, years: [] },
    { key: 'year', done: true, count: null, years: [] },
    { key: 'quarters', done: false, count: null, years: ['2026–2027'] },
    { key: 'slotTypes', done: true, count: null, years: [] },
    { key: 'defaultTemplate', done: false, count: null, years: [] },
    { key: 'calendar', done: null, count: 3, years: [] },
    { key: 'subjects', done: false, count: 2, years: [] },
  ],
};

const checklist = () => within(screen.getByRole('region', { name: en.setup.checklist.title }));

// edge/academic-year: "Each branch has a setup checklist in a fixed order";
// answer 23: the Super Admin, the Academic Vice Principal and the Principal.
describe('the setup checklist', () => {
  it('lists the items in order, each done or missing, the calendar as a count', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/setup/checklist': () => json(CHECKLIST),
    });
    renderApp('/setup');
    await screen.findByRole('region', { name: en.setup.checklist.title });
    const items = await checklist().findAllByRole('listitem');

    expect(items.map((item) => item.getAttribute('data-item'))).toEqual(
      CHECKLIST.items.map((item) => item.key),
    );
    // Finding 17: the word beside the icon, as visible text, not a label alone.
    const mark = (item: HTMLElement | undefined) =>
      item?.querySelector('li > span:first-child')?.textContent;
    expect(mark(items[0])).toBe(en.setup.checklist.done);
    expect(mark(items[1])).toBe(en.setup.checklist.missing);
    expect(items[4]?.textContent).toContain('2026–2027');
    expect(items[2]?.textContent).toContain(en.setup.checklist.wholeSchool);
    expect(items[7]?.textContent).toContain('3 entries');
    // Task 2.1, decision 7: the graded subjects without their daily distribution here.
    expect(items[8]?.textContent).toContain(
      en.setup.checklist.subjectsMissing_other.replace('{{count}}', '2'),
    );
    expect(
      within(items[8] as HTMLElement)
        .getByRole('link', { name: en.setup.checklist.items.subjects })
        .getAttribute('href'),
    ).toBe('/setup/subjects');
    expect(
      within(items[6] as HTMLElement)
        .getByRole('link', { name: en.setup.checklist.items.defaultTemplate })
        .getAttribute('href'),
    ).toBe('/setup/day-template-settings');
  });

  it.each(['super_admin', 'principal'] as const)('is shown to the %s', async (role) => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs(role)),
      'GET /api/setup/checklist': () => json(CHECKLIST),
    });
    renderApp('/setup');
    expect(await screen.findByRole('region', { name: en.setup.checklist.title })).toBeDefined();
  });

  it('is not shown to a role without the settings', async () => {
    const calls = fakeApi({ 'GET /api/auth/session': () => json(sessionAs('teacher')) });
    renderApp('/setup');
    await screen.findByRole('heading', { name: en.setup.title });

    expect(screen.queryByRole('region', { name: en.setup.checklist.title })).toBeNull();
    expect(calls.some((call) => call.route === 'GET /api/setup/checklist')).toBe(false);
  });

  it('shows a failure with a retry', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionAs('principal')) });
    renderApp('/setup');
    expect(await checklistRetry()).toBeDefined();
  });
});

const checklistRetry = async () =>
  within(await screen.findByRole('region', { name: en.setup.checklist.title })).findByRole(
    'button',
    { name: en.problems.retry },
  );
