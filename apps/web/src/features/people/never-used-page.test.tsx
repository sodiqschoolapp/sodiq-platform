import type { NeverUsedAccount, Role } from '@sodiq/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// All names are invented. Task 2.3c-1, pull request #65.
const FRESH: NeverUsedAccount = {
  staffId: uid(1),
  staffNumber: 'S-260021',
  firstName: 'Kamola',
  lastName: 'Ismoilova',
  login: 'k.ismoilova',
  createdAt: '2026-10-09T05:00:00.000Z',
  passwordValidUntil: '2026-10-16T05:00:00.000Z',
  expired: false,
  locked: false,
};

const OLD: NeverUsedAccount = {
  ...FRESH,
  staffId: uid(2),
  staffNumber: 'S-260022',
  firstName: 'Ravshan',
  lastName: 'Qodirov',
  login: 'r.qodirov',
  passwordValidUntil: '2026-10-01T05:00:00.000Z',
  expired: true,
  locked: true,
};

const ROUTE = 'GET /api/people/accounts/never-used';

function open(role: Role, accounts: NeverUsedAccount[] | 'fail', language: 'en' | 'ru' = 'en') {
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(
        sessionOf({
          language,
          assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
        }),
      ),
    [ROUTE]: () => (accounts === 'fail' ? refusal('internal_error', 500) : json({ accounts })),
  });
  renderApp('/people/never-used', language);
  return calls;
}

const rows = () => [...document.querySelectorAll('tbody tr')];

// Accounts and sign-in: "A report lists accounts never used" (decision 10).
describe('the accounts never used', () => {
  it('lists each account, the run-out password in words and with an icon', async () => {
    open('academic_vice_principal', [FRESH, OLD]);
    await screen.findByRole('heading', { name: en.people.neverUsed.title });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    const old = rows().find((row) => row.textContent.includes('Qodirov Ravshan'));
    const fresh = rows().find((row) => row.textContent.includes('Ismoilova Kamola'));
    expect(old?.querySelector('[data-expired] svg')).not.toBeNull();
    expect(old?.querySelector('[data-expired]')?.textContent).toContain('Ran out on');
    expect(old?.textContent).toContain(en.people.neverUsed.locked);
    expect(fresh?.querySelector('[data-expired]')).toBeNull();
    expect(fresh?.textContent).toContain('Valid until');
    // A name opens the record in the staff list.
    const link = within((old ?? document.body) as HTMLElement).getByRole('link', {
      name: 'Qodirov Ravshan',
    });
    expect(link.getAttribute('href')).toContain(`/people/staff?open=${OLD.staffId}`);
  });

  it('says in one line that every account was used', async () => {
    open('principal', []);
    expect(await screen.findByText(en.people.neverUsed.empty)).toBeDefined();
  });

  it('shows a failed list with a retry', async () => {
    open('super_admin', 'fail');
    expect(await screen.findByRole('button', { name: en.problems.retry })).toBeDefined();
  });

  it('is in Russian', async () => {
    open('principal', [FRESH], 'ru');
    expect(await screen.findByRole('heading', { name: ru.people.neverUsed.title })).toBeDefined();
  });
});
