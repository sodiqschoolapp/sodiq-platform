import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf, SOUTH } from '@/testing/render-app';
import { setWindowWidth } from '@/testing/window-width';

const superAdmin = () =>
  sessionOf({ assignments: [{ role: 'super_admin', branchId: null }], branches: [NORTH, SOUTH] });
const line = () => document.querySelector<HTMLElement>('[data-banner="attention"]');
const attention = (n: number) =>
  (n === 1 ? en.layout.attentionLine_one : en.layout.attentionLine_other).replace(
    '{{n}}',
    String(n),
  );

// Issue #39, hand test of 13 October 2026, finding 30 (task 2.7b-2, decision
// 6): on a phone the Super Admin's alerts are one short line.
describe('the alerts of the Super Admin on a phone', () => {
  it('are one line with the count and a Show button, and open in place', async () => {
    setWindowWidth(390);
    fakeApi({
      'GET /api/auth/session': () => json(superAdmin()),
      'GET /api/access/super-admins': () => json({ active: 1 }),
      'GET /api/access/branches-without-vice-principal': () =>
        json({ branches: [{ id: NORTH.id, name: 'North' }] }),
    });
    renderApp('/');
    await waitFor(() => {
      expect(line()?.textContent).toContain(attention(2));
    });
    expect(screen.queryByText(en.layout.superAdminBanner)).toBeNull();
    const show = within(line() ?? document.body).getByRole('button', {
      name: en.layout.attentionShow,
    });
    expect(show.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(show);

    expect(show.getAttribute('aria-expanded')).toBe('true');
    expect(show.textContent).toBe(en.layout.attentionHide);
    expect(screen.getByText(en.layout.superAdminBanner)).toBeDefined();
    expect(document.querySelector('[data-banner="vice-principals"]')?.textContent).toBe(
      `${en.layout.viceBanner} North`,
    );
  });

  it('count an alert whose query failed', async () => {
    setWindowWidth(390);
    fakeApi({
      'GET /api/auth/session': () => json(superAdmin()),
      'GET /api/access/super-admins': () => refusal('no_answer', 500),
      'GET /api/access/branches-without-vice-principal': () => json({ branches: [] }),
    });
    renderApp('/');
    await waitFor(() => {
      expect(line()?.textContent).toContain(attention(1));
    });
  });

  it('are shown as they are from 640 px', async () => {
    setWindowWidth(640);
    fakeApi({
      'GET /api/auth/session': () => json(superAdmin()),
      'GET /api/access/super-admins': () => json({ active: 1 }),
      'GET /api/access/branches-without-vice-principal': () => json({ branches: [] }),
    });
    renderApp('/');
    expect(await screen.findByText(en.layout.superAdminBanner)).toBeDefined();
    expect(line()).toBeNull();
  });
});

// Issue #39, finding 31: "Send feedback" shows its word in "More".
describe('the feedback button in "More"', () => {
  it('shows its word, not only to a screen reader', async () => {
    setWindowWidth(390);
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
    renderApp('/');
    await screen.findByRole('heading', { name: en.home.title });
    fireEvent.click(
      within(screen.getByRole('navigation', { name: en.menu.tabs })).getByRole('button', {
        name: en.menu.more,
      }),
    );
    const more = await screen.findByRole('dialog', { name: en.menu.more });
    const word = within(more).getByText(en.feedback.button);
    expect(word.className).not.toContain('sr-only');
  });
});

// Issue #39, finding 14, and the owner's confirmation of 13 October 2026:
// "one-row top bar with icon-only search and feedback at laptop width".
describe('the top bar below 1280 px', () => {
  it('has the search and feedback as icon buttons named by their words', async () => {
    setWindowWidth(1047);
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
    renderApp('/');
    await screen.findByRole('heading', { name: en.home.title });
    const bar = within(screen.getByRole('banner', { name: en.layout.topBar }));
    for (const name of [en.search.label, en.feedback.button]) {
      const button = bar.getByRole('button', { name });
      const word = within(button).getByText(name);
      // Read out, and drawn only from 1280 px.
      expect(word.className).toMatch(/(^| )(max-xl:sr-only|sr-only xl:not-sr-only)( |$)/);
    }
  });
});
