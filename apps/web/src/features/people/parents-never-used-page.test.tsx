import type { ParentsNeverUsed, Role } from '@sodiq/shared';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// Task 11.1, pull request #292. All names are invented.
const ANSWER: ParentsNeverUsed = {
  accounts: [
    {
      relativeId: uid(1),
      fullName: 'Dilfuza Karimova',
      login: 'd.karimova',
      children: [{ studentId: uid(11), firstName: 'Malika', lastName: 'Karimova' }],
      slip: {
        kind: 'first',
        printedAt: '2026-09-05T05:00:00.000Z',
        validUntil: '2026-10-05T05:00:00.000Z',
        valid: false,
        otherBranch: false,
        className: '7 Oxford',
      },
      expired: true,
    },
  ],
};

function open(role: Role, answer: ParentsNeverUsed = ANSWER) {
  return fakeApi({
    'GET /api/auth/session': () =>
      json(
        sessionOf({
          assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
        }),
      ),
    'GET /api/people/parent-accounts/never-used': () => json(answer),
  });
}

const rows = () => [...document.querySelectorAll('tbody tr')];

describe('the Parent accounts never used', () => {
  it('lists each account with its children and a run-out password marked', async () => {
    open('academic_vice_principal');
    renderApp('/people/parent-accounts');
    await screen.findByRole('heading', { name: en.people.parentsNeverUsed.title });
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    const [row] = rows();
    expect(row?.textContent).toContain('d.karimova');
    expect(row?.textContent).toContain('Karimova Malika');
    expect(row?.querySelector('[data-expired] svg')).not.toBeNull();
    expect(screen.getByRole('button', { name: en.list.export })).toBeDefined();
  });

  it('says in one line that no account waits', async () => {
    open('super_admin', { accounts: [] });
    renderApp('/people/parent-accounts');
    expect(await screen.findByText(en.people.parentsNeverUsed.empty)).toBeDefined();
  });

  it('is not open to the Principal', async () => {
    const calls = open('principal');
    renderApp('/people/parent-accounts');
    await screen.findByText(en.problems.noAccessTitle);
    expect(calls.some((call) => call.route.includes('never-used'))).toBe(false);
  });
});
