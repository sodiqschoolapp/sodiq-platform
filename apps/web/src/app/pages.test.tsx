import { QueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { MENU_STORAGE_KEY } from '@/features/access/menu-state';
import { createI18n } from '@/i18n/i18n';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, refusal, renderApp, sessionOf } from '@/testing/render-app';
import { AuthPendingPage, PendingPage } from './pages';
import { createAppRouter } from './router';

const inEnglish = (page: ReactNode) =>
  render(<I18nextProvider i18n={createI18n('en')}>{page}</I18nextProvider>);

// docs/design-system.md, Brand moments: "Full-page error (not found, no
// access, failed to load the app): like the empty page."
describe('a full-page error', () => {
  it('for an address that does not exist is the brand moment with the way home', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
    renderApp('/no-such-page');

    const title = await screen.findByRole('heading', { level: 1, name: en.problems.notFoundTitle });
    expect(title.className).toContain('font-brand');
    expect(screen.getByText(en.problems.notFoundText)).toBeDefined();
    expect(screen.getByRole('link', { name: en.problems.toHome })).toBeDefined();
    expect(document.querySelector('main svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('for a refusal of the role is "No access"', async () => {
    fakeApi({ 'GET /api/auth/session': () => refusal('permission_denied', 403) });
    renderApp('/');

    expect(
      await screen.findByRole('heading', { level: 1, name: en.problems.noAccessTitle }),
    ).toBeDefined();
    expect(screen.getByText(en.problems.noAccessText)).toBeDefined();
    expect(screen.getByRole('link', { name: en.problems.toHome })).toBeDefined();
  });

  it('for a page that failed says what happened, with "Try again" and the way home', async () => {
    fakeApi({ 'GET /api/auth/session': () => new Response('', { status: 502 }) });
    renderApp('/');

    const title = await screen.findByRole('heading', { level: 1, name: en.problems.title });
    expect(title.className).toContain('font-brand');
    expect(screen.getByRole('alert').textContent).toBe(en.problems.noAnswer);
    expect(screen.getByRole('button', { name: en.problems.retry })).toBeDefined();
    expect(screen.getByRole('link', { name: en.problems.toHome })).toBeDefined();
  });
});

// docs/spec/12-ux-standards.md, Look and feel: "Loading shows the page outline
// at once, then the data. The page never jumps as it loads."
describe('the outline of a page on its way', () => {
  it('inside the app is the shell: the menu column, the top bar and the tab bar', () => {
    const { container } = inEnglish(<PendingPage />);
    const outline = container.querySelector('[data-outline="shell"]');
    expect(outline?.getAttribute('aria-busy')).toBe('true');
    expect(outline?.querySelector('.bg-sidebar.w-60')).not.toBeNull();
    expect(outline?.querySelector('.h-16.bg-top-bar')).not.toBeNull();
    expect(outline?.querySelector('.fixed.bg-sidebar.sm\\:hidden')).not.toBeNull();
  });

  it('inside the app follows a collapsed menu', () => {
    window.localStorage.setItem(MENU_STORAGE_KEY, 'rail');
    const { container } = inEnglish(<PendingPage />);
    expect(container.querySelector('.bg-sidebar.w-\\[72px\\]')).not.toBeNull();
  });

  it('before the app is the frame of the sign-in page', () => {
    const { container } = inEnglish(<AuthPendingPage />);
    const outline = container.querySelector('[data-outline="sign-in"]');
    expect(outline?.getAttribute('aria-busy')).toBe('true');
    expect(outline?.querySelector('.bg-sidebar.sm\\:block')).not.toBeNull();
    expect(outline?.querySelector('.bg-sidebar.w-60')).toBeNull();
  });

  it('is the sign-in frame for the pages before the app and the shell for the others', () => {
    const router = createAppRouter(new QueryClient());
    for (const path of ['/sign-in', '/sign-in/code', '/password', '/second-step/set-up'] as const) {
      expect(router.routesByPath[path].options.pendingComponent, path).toBe(AuthPendingPage);
    }
    expect(router.options.defaultPendingComponent).toBe(PendingPage);
    expect(router.routesByPath['/account'].options.pendingComponent).toBeUndefined();
  });
});
