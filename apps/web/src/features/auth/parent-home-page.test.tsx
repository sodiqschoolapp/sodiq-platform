import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

// Task 11.1 (decision 13 of pull request #292): a parent session has its own frame, with no
// staff menu, and reaches no staff page. All names are invented.
const PARENT = sessionOf({
  login: 'd.karimova',
  kind: 'parent',
  fullName: 'Dilfuza Karimova',
  assignments: [],
  branches: [],
});

describe('the frame of a parent', () => {
  it('opens as the account page, with language, password, sign-out and the way back to the portal', async () => {
    const calls = fakeApi({ 'GET /api/auth/session': () => json(PARENT) });
    renderApp('/parent');
    await screen.findByRole('heading', { name: en.parent.title });
    expect(screen.getByText('Dilfuza Karimova')).toBeDefined();
    expect(screen.getByRole('link', { name: en.parent.password })).toBeDefined();
    expect(screen.getByRole('button', { name: en.parent.signOut })).toBeDefined();
    expect(screen.getByRole('link', { name: en.parent.portal })).toBeDefined();
    // No staff menu, and no call of a staff route.
    expect(screen.queryByRole('navigation', { name: en.layout.menu })).toBeNull();
    expect(
      calls.filter((call) => call.route !== 'GET /api/auth/session').map((call) => call.route),
    ).toEqual([]);
  });

  it('sends a parent away from a staff page, to the portal (task 11.2)', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(PARENT),
      'GET /api/portal/children': () => json({ children: [] }),
    });
    renderApp('/people/staff');
    await screen.findByText(en.portal.noChild);
  });

  it('is not open to staff', async () => {
    fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
    });
    renderApp('/parent');
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: en.parent.title })).toBeNull();
    });
  });
});
