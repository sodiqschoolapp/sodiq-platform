import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, nothing, renderApp, sessionOf } from '@/testing/render-app';

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

  // Task 11.4: "the `parent` role links and unlinks its own chat".
  it('names the own Telegram link and unlinks it after asking', async () => {
    let session = { ...PARENT, telegramLinkedAt: '2026-11-02T05:00:00.000Z' };
    const calls = fakeApi({
      'GET /api/auth/session': () => json(session),
      'DELETE /api/auth/telegram-link': () => {
        session = { ...PARENT, telegramLinkedAt: null };
        return nothing();
      },
    });
    renderApp('/parent');
    const section = await screen.findByRole('region', { name: en.parent.telegram });
    expect(section.textContent).toContain(
      en.parent.telegramLinked.replace('{{date}}', '2 November 2026'),
    );
    fireEvent.click(within(section).getByRole('button', { name: en.parent.unlink }));
    const dialog = await screen.findByRole('alertdialog');
    expect(calls.some((call) => call.route === 'DELETE /api/auth/telegram-link')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: en.parent.unlink }));
    await waitFor(() => {
      expect(section.textContent).toContain(en.parent.telegramNone);
    });
    expect(calls.filter((call) => call.route === 'DELETE /api/auth/telegram-link')).toHaveLength(1);
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
