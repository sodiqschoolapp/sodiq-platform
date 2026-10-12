import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf, SOUTH } from '@/testing/render-app';

const heading = (name: string) => screen.findByRole('heading', { name });
const ROUTE = 'GET /api/access/branches-without-vice-principal';

// Edge cases, Who can act: "a branch with no active Academic Vice Principal
// shows an alert to the Super Admin" (task 2.3b-2, decisions 8 and 9 of #64).
describe('the alert of a branch without an Academic Vice Principal', () => {
  const superAdmin = () =>
    sessionOf({ assignments: [{ role: 'super_admin', branchId: null }], branches: [NORTH, SOUTH] });
  const banner = () => document.querySelector<HTMLElement>('[data-banner="vice-principals"]');

  it('names each branch to a Super Admin, and a name opens the staff list of that branch', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(superAdmin()),
      [ROUTE]: () =>
        json({
          branches: [
            { id: NORTH.id, name: 'North' },
            { id: SOUTH.id, name: 'South' },
          ],
        }),
      'GET /api/people/staff': () => json({ staff: [], today: '2026-10-10' }),
      'GET /api/people/vacancies': () => json({ vacancies: [] }),
    });
    const shell = renderApp('/');
    await waitFor(() => {
      expect(banner()).not.toBeNull();
    });
    const alert = within(banner() ?? document.body);
    expect(banner()?.textContent).toBe(`${en.layout.viceBanner} North, South`);
    fireEvent.click(alert.getByRole('button', { name: 'South' }));
    await waitFor(() => {
      expect(shell.router.state.location.pathname).toBe('/people/staff');
    });
    expect(shell.view.snapshot().branchId).toBe(SOUTH.id);
  });

  it('is not there when every branch has one', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(superAdmin()),
      [ROUTE]: () => json({ branches: [] }),
    });
    renderApp('/');
    await heading(en.home.title);
    await waitFor(() => {
      expect(calls.some((call) => call.route === ROUTE)).toBe(true);
    });
    expect(banner()).toBeNull();
  });

  it('is never asked for by another role', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'principal', branchId: NORTH.id }] })),
    });
    renderApp('/');
    await heading(en.home.title);
    expect(calls.some((call) => call.route === ROUTE)).toBe(false);
    expect(banner()).toBeNull();
  });
});
