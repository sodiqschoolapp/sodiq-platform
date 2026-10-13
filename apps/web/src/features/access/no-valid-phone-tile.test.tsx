import type { Role } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

const tile = () => document.querySelector('[data-tile="no-valid-phone"]');

// Task 2.5b-1, decision 3; edge/close-relatives, row 2: a relative with no
// valid phone is "listed for the Academic Vice Principal while a linked
// student is active".
describe('the "no valid phone" counter of the home page', () => {
  it('shows the Academic Vice Principal the count, linking to the list it counts', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students/no-class': () => json({ count: 0 }),
      'GET /api/people/relatives/no-valid-phone': () => json({ count: 3 }),
      'GET /api/people/relatives': () =>
        json({ relatives: [], searchesPhone: true, canEdit: true }),
    });
    const shell = renderApp('/');
    const section = await screen.findByRole('region', { name: en.home.noValidPhone.title });
    expect(within(section).getByText('3')).toBeTruthy();
    fireEvent.click(within(section).getByRole('link', { name: en.home.noValidPhone.link }));
    await screen.findByRole('heading', { name: en.people.relatives.title });
    await waitFor(() => {
      expect(shell.router.state.location.search).toMatchObject({
        f: { phone: 'no_valid_phone' },
      });
    });
    // The list it opens is the server's, with the same filter.
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.route === 'GET /api/people/relatives' && call.query === '?filter=no_valid_phone',
        ),
      ).toBe(true);
    });
  });

  it('is hidden at 0', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students/no-class': () => json({ count: 0 }),
      'GET /api/people/relatives/no-valid-phone': () => json({ count: 0 }),
    });
    renderApp('/');
    await screen.findByText(en.home.academic_vice_principal);
    await waitFor(() => {
      expect(calls.some((call) => call.route === 'GET /api/people/relatives/no-valid-phone')).toBe(
        true,
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(tile()).toBeNull();
  });

  it('tells a failure from loading, with a retry, in Russian', async () => {
    let answers = 0;
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal', 'ru')),
      'GET /api/people/students/no-class': () => json({ count: 0 }),
      'GET /api/people/relatives/no-valid-phone': () => {
        answers += 1;
        return answers === 1 ? refusal('internal_error', 500) : json({ count: 2 });
      },
    });
    renderApp('/', 'ru');
    fireEvent.click(await screen.findByRole('button', { name: ru.problems.retry }));
    const section = await screen.findByRole('region', { name: ru.home.noValidPhone.title });
    expect(within(section).getByText('2')).toBeTruthy();
  });
});
