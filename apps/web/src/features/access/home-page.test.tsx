import type { Role } from '@sodiq/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';

const sessionAs = (role: Role) =>
  sessionOf({ assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }] });

const emptyPage = () => screen.queryByRole('heading', { name: en.home.emptyTitle });

/** Waits until both counters of the Academic Vice Principal's home were asked for. */
async function bothAsked(calls: { route: string }[]): Promise<void> {
  await waitFor(() => {
    expect(calls.some((call) => call.route === 'GET /api/people/students/no-class')).toBe(true);
    expect(calls.some((call) => call.route === 'GET /api/people/relatives/no-valid-phone')).toBe(
      true,
    );
  });
}

// Task 2.7c-1: Home is the empty page of the design system until its tasks fill
// it (pull request #80, decision 3), and the Academic Vice Principal's home is
// never blank (correction 1; .claude/rules/web.md: "Every screen has loading,
// empty and error states").
describe('the home page', () => {
  it('is the empty page with one short line of its kind, no intro and no action', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionAs('teacher')) });
    renderApp('/');
    const title = await screen.findByRole('heading', { name: en.home.emptyTitle });
    const panel = title.closest('div.bg-card');
    expect(panel).not.toBeNull();
    expect(within(panel as HTMLElement).getByText(en.home.teaching).tagName).toBe('P');
    expect(within(panel as HTMLElement).queryByRole('button')).toBeNull();
    expect(within(panel as HTMLElement).queryByRole('link')).toBeNull();
    // Each kind keeps a line of its own, so a test of which home a role gets can fail.
    const lines = Object.values(en.home).filter((value) => typeof value === 'string');
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('shows the Academic Vice Principal the empty page once both counters answered 0', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students/no-class': () => json({ count: 0 }),
      'GET /api/people/relatives/no-valid-phone': () => json({ count: 0 }),
    });
    renderApp('/');
    await bothAsked(calls);
    expect(await screen.findByRole('heading', { name: en.home.emptyTitle })).toBeDefined();
    expect(screen.getByText(en.home.academic_vice_principal)).toBeDefined();
    expect(screen.queryByRole('region', { name: en.home.noClass.title })).toBeNull();
    expect(screen.queryByRole('region', { name: en.home.noValidPhone.title })).toBeNull();
  });

  it('shows the tiles only when one of them counts something', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students/no-class': () => json({ count: 0 }),
      'GET /api/people/relatives/no-valid-phone': () => json({ count: 4 }),
    });
    renderApp('/');
    await bothAsked(calls);
    const tile = await screen.findByRole('region', { name: en.home.noValidPhone.title });
    // 24 between the tiles and before the empty page (docs/design-system.md, Spacing).
    expect(tile.parentElement?.className).toContain('gap-6');
    expect(emptyPage()).toBeNull();
    expect(screen.queryByText(en.home.academic_vice_principal)).toBeNull();
  });

  it('shows a failed counter with its retry, not the empty page', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students/no-class': () => json({ count: 0 }),
      'GET /api/people/relatives/no-valid-phone': () => refusal('internal_error', 500),
    });
    renderApp('/');
    await bothAsked(calls);
    // The failed tile says so, with a retry; the page is not called empty.
    expect(await screen.findByRole('button', { name: en.problems.retry })).toBeDefined();
    expect(emptyPage()).toBeNull();
  });

  it('says so when the account holds no role', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf({ assignments: [] })) });
    renderApp('/');
    expect(await screen.findByText(en.home.noRole)).toBeDefined();
    expect(emptyPage()).not.toBeNull();
  });
});
