import type { Role } from '@sodiq/shared';
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

  it('says that a role without setup rights has no setup pages', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionAs('teacher')) });
    renderApp('/setup');
    await screen.findByRole('heading', { name: en.setup.title });

    expect(screen.getByText(en.setup.none)).toBeDefined();
    expect(screen.queryByRole('link', { name: en.setup.roomsLink })).toBeNull();
    expect(screen.queryByRole('link', { name: en.setup.dayTemplatesLink })).toBeNull();
  });
});
