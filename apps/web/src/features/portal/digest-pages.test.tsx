import type { DigestLog, Role } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// Task 11.5, pull request #299: the send log, the parent's frequency and the Super Admin's
// settings of the parents' digest. All names are invented.
const LOG: DigestLog = {
  rows: [
    {
      id: uid(1),
      digestDate: '2026-11-04',
      parentName: 'Dilfuza Karimova',
      login: 'd.karimova',
      children: [{ firstName: 'Kamron', className: '7-A' }],
      status: 'delivered',
      attempts: 1,
      dueAt: '2026-11-04T14:00:00.000Z',
      sentAt: '2026-11-04T14:00:20.000Z',
    },
    {
      id: uid(2),
      digestDate: '2026-11-04',
      parentName: 'Rustam Aliyev',
      login: 'r.aliyev',
      children: [],
      status: 'blocked',
      attempts: 1,
      dueAt: '2026-11-04T14:00:00.000Z',
      sentAt: null,
    },
  ],
  total: 2,
  page: 1,
  pageSize: 500,
};

const staff = (role: Role) =>
  sessionOf({ assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }] });

const rows = () => [...document.querySelectorAll('tbody tr')];

describe('the digest send log', () => {
  it('lists each digest with the parent, the children and the status', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(staff('super_admin')),
      'GET /api/digest-log': () => json(LOG),
    });
    renderApp('/people/digest-log');
    await screen.findByRole('heading', { name: en.digest.log.title });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    const kamron = rows().find((row) => row.textContent.includes('d.karimova'));
    expect(kamron?.textContent).toContain('Kamron, 7-A');
    expect(kamron?.textContent).toContain(en.digest.log.statuses.delivered);
    const blocked = rows().find((row) => row.textContent.includes('r.aliyev'));
    expect(blocked?.textContent).toContain(en.digest.log.statuses.blocked);
  });

  it('says in one line that no digest was sent', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(staff('super_admin')),
      'GET /api/digest-log': () => json({ ...LOG, rows: [], total: 0 }),
    });
    renderApp('/people/digest-log');
    expect(await screen.findByText(en.digest.log.empty)).toBeDefined();
  });

  it('is not open to the Academic Vice Principal', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(staff('academic_vice_principal')),
    });
    renderApp('/people/digest-log');
    await screen.findByText(en.problems.noAccessTitle);
    expect(calls.some((call) => call.route === 'GET /api/digest-log')).toBe(false);
  });
});

describe('the frequency of a parent', () => {
  it('shows twice a week until chosen and saves a choice', async () => {
    const parent = sessionOf({
      login: 'd.karimova',
      kind: 'parent',
      fullName: 'Dilfuza Karimova',
      assignments: [],
      branches: [],
    });
    const calls = fakeApi({
      'GET /api/auth/session': () => json(parent),
      'GET /api/auth/digest-frequency': () => json({ frequency: 'twice_weekly', chosen: false }),
      'PUT /api/auth/digest-frequency': () => json({ frequency: 'daily', chosen: true }),
    });
    renderApp('/parent');
    const section = await screen.findByRole('region', { name: en.digest.parent.title });
    const select = await within(section).findByRole('combobox', {
      name: en.digest.parent.frequency,
    });
    expect((select as HTMLSelectElement).value).toBe('twice_weekly');
    fireEvent.change(select, { target: { value: 'daily' } });
    await waitFor(() => {
      expect(calls.find((call) => call.route === 'PUT /api/auth/digest-frequency')?.body).toEqual({
        frequency: 'daily',
      });
    });
    await waitFor(() => {
      expect((select as HTMLSelectElement).value).toBe('daily');
    });
  });
});
