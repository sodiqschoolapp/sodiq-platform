import type { Role } from '@sodiq/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf, SOUTH } from '@/testing/render-app';

const sessionAs = (role: Role, language: 'en' | 'ru' = 'en') => ({
  ...sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
    branches: [NORTH, SOUTH],
  }),
  language,
});

const tile = () => document.querySelector('[data-tile="no-class"]');

// Task 2.4b-2, decision 9; edge/students-classes-groups: "An active student
// with no class ... appear ... in a counter on the Academic Vice Principal's
// home page".
describe('the "No class" counter of the home page', () => {
  it('shows the Academic Vice Principal the count, linking to the list it counts', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students/no-class': () => json({ count: 1234 }),
      'GET /api/people/students': () =>
        json({
          students: [],
          canArchive: true,
          exportGroups: [],
          readsFinancial: true,
          today: '2026-10-10',
        }),
    });
    const shell = renderApp('/');
    const section = await screen.findByRole('region', { name: en.home.noClass.title });
    expect(within(section).getByText('1,234')).toBeTruthy();
    // The page's own line stays under the counter.
    expect(screen.getByText(en.home.academic_vice_principal)).toBeTruthy();
    fireEvent.click(within(section).getByRole('link', { name: en.home.noClass.link }));
    await screen.findByRole('heading', { name: en.people.students.title });
    await waitFor(() => {
      expect(shell.router.state.location.search).toMatchObject({
        f: { class: 'none', status: 'active' },
      });
    });
    expect(calls.some((call) => call.route === 'GET /api/people/students/no-class')).toBe(true);
  });

  it('is hidden at 0', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students/no-class': () => json({ count: 0 }),
    });
    renderApp('/');
    await screen.findByText(en.home.academic_vice_principal);
    await waitFor(() => {
      expect(calls.some((call) => call.route === 'GET /api/people/students/no-class')).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(tile()).toBeNull();
    expect(screen.queryByRole('region', { name: en.home.noClass.title })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('tells a failure from loading, with a retry', async () => {
    let answers = 0;
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students/no-class': () => {
        answers += 1;
        return answers === 1 ? refusal('internal_error', 500) : json({ count: 7 });
      },
    });
    renderApp('/');
    const retry = await screen.findByRole('button', { name: en.problems.retry });
    fireEvent.click(retry);
    const section = await screen.findByRole('region', { name: en.home.noClass.title });
    expect(within(section).getByText('7')).toBeTruthy();
  });

  it('is in Russian', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal', 'ru')),
      'GET /api/people/students/no-class': () => json({ count: 3 }),
    });
    renderApp('/', 'ru');
    const section = await screen.findByRole('region', { name: ru.home.noClass.title });
    expect(within(section).getByRole('link', { name: ru.home.noClass.link })).toBeTruthy();
  });

  it('is not on the home page of the Principal or the Super Admin', async () => {
    for (const role of ['principal', 'super_admin'] as const) {
      const calls = fakeApi({
        'GET /api/auth/session': () => json(sessionAs(role)),
      });
      renderApp('/');
      await screen.findByText(en.home.branch_summary);
      await waitFor(() => {
        expect(tile()).toBeNull();
      });
      expect(calls.some((call) => call.route === 'GET /api/people/students/no-class')).toBe(false);
      cleanup();
    }
  });
});
