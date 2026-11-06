import type { ParentSlipList, PrintedParentSlips, Role } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import {
  fakeApi,
  json,
  NORTH,
  refusal,
  renderApp,
  sessionOf,
  type ApiCall,
} from '@/testing/render-app';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const CLASS = uid(90);

// Task 11.1, pull request #292. All names are invented.
const LIST: ParentSlipList = {
  classId: CLASS,
  className: '7 Oxford',
  relatives: [
    {
      relativeId: uid(1),
      fullName: 'Dilfuza Karimova',
      children: [{ studentId: uid(11), firstName: 'Malika', lastName: 'Karimova' }],
      state: 'to_print',
      login: null,
      slip: null,
    },
    {
      relativeId: uid(2),
      fullName: 'Botir Usmonov',
      children: [{ studentId: uid(12), firstName: 'Aziz', lastName: 'Usmonov' }],
      state: 'valid_slip',
      login: 'b.usmonov',
      slip: {
        kind: 'first',
        printedAt: '2026-10-05T05:00:00.000Z',
        validUntil: '2026-11-04T05:00:00.000Z',
        valid: true,
        otherBranch: true,
        className: null,
      },
    },
    {
      relativeId: uid(3),
      fullName: 'Shahlo Nazarova',
      children: [{ studentId: uid(13), firstName: 'Lola', lastName: 'Nazarova' }],
      state: 'signed_in',
      login: 's.nazarova',
      slip: null,
    },
  ],
};

const PRINTED: PrintedParentSlips = {
  language: 'ru',
  className: '7 Oxford',
  botUsername: 'sodiq_school_test_bot',
  slips: [
    {
      relativeId: uid(1),
      fullName: 'Dilfuza Karimova',
      children: [{ studentId: uid(11), firstName: 'Malika', lastName: 'Karimova' }],
      login: 'd.karimova',
      password: 'Secret-Slip-Pass-1',
      kind: 'first',
      printedAt: '2026-10-10T05:00:00.000Z',
      validUntil: '2026-11-09T05:00:00.000Z',
    },
  ],
};

const LIST_ROUTE = `GET /api/people/classes/${CLASS}/parent-slips`;
const PRINT_ROUTE = `POST /api/people/classes/${CLASS}/parent-slips`;

function open(
  role: Role,
  list: ParentSlipList | 'fail' = LIST,
): { calls: ApiCall[]; shell: ReturnType<typeof renderApp> } {
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(
        sessionOf({
          assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
        }),
      ),
    'GET /api/setup/branch': () =>
      json({ id: NORTH.id, name: NORTH.name, timeZone: 'Asia/Tashkent' }),
    [LIST_ROUTE]: () => (list === 'fail' ? refusal('internal_error', 500) : json(list)),
    [PRINT_ROUTE]: () => json(PRINTED),
  });
  const shell = renderApp(`/people/classes/${CLASS}/parent-slips`);
  return { calls, shell };
}

const rows = () => [...document.querySelectorAll('tbody tr')];

describe('the slips of the parents of a class', () => {
  it('lists each parent with the state of the account', async () => {
    open('academic_vice_principal');
    await screen.findByRole('heading', { name: 'Parent slips: 7 Oxford' });
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    const row = (name: string) => rows().find((one) => one.textContent.includes(name));
    expect(row('Dilfuza Karimova')?.textContent).toContain(en.people.parentSlips.to_print);
    // A slip of another branch is named without its class (decision 15).
    expect(row('Botir Usmonov')?.textContent).toContain('Another branch, 5 October 2026');
    expect(row('Shahlo Nazarova')?.textContent).toContain(en.people.parentSlips.signed_in);
  });

  it('prints the slips in the language chosen, and keeps the passwords out of every cache', async () => {
    const { calls, shell } = open('academic_vice_principal');
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    fireEvent.change(screen.getByRole('combobox', { name: en.people.parentSlips.language }), {
      target: { value: 'ru' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.people.parentSlips.printSlips }));
    const sheet = await screen.findByRole('region', { name: '1 slip' });
    expect(calls.find((call) => call.route === PRINT_ROUTE)?.body).toEqual({
      language: 'ru',
      printAgain: [],
    });
    // The slip is in Russian, the page in English.
    const card = within(sheet).getAllByText(
      (_, element) => element?.textContent === `${ru.people.parentSlip.title}: Dilfuza Karimova`,
    );
    expect(card.length).toBeGreaterThan(0);
    expect(within(sheet).getAllByText('Secret-Slip-Pass-1').length).toBeGreaterThan(0);
    expect(sheet.textContent).toContain('@sodiq_school_test_bot');
    // Four slips to an A4 page (`10`): the print sheet holds every slip, in its four-up mode.
    const printSheet = document.querySelector('[data-slip-sheet][data-four]');
    expect(printSheet?.querySelectorAll('[data-slip]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: en.people.parentSlips.print })).toBeDefined();
    // The password is in the page's state only: no query or mutation keeps it.
    await waitFor(() => {
      expect(
        JSON.stringify([
          shell.queryClient
            .getQueryCache()
            .getAll()
            .map((query) => query.state.data),
          shell.queryClient
            .getMutationCache()
            .getAll()
            .map((mutation) => mutation.state.data),
        ]),
      ).not.toContain('Secret-Slip-Pass-1');
    });
  });

  it('says in one line that the class has no parent to print for', async () => {
    open('super_admin', { ...LIST, relatives: [] });
    expect(await screen.findByText(en.people.parentSlips.empty)).toBeDefined();
  });

  it('shows a failed read with a retry', async () => {
    open('academic_vice_principal', 'fail');
    expect(await screen.findByRole('button', { name: en.problems.retry })).toBeDefined();
  });

  it('is not open to the Principal', async () => {
    const { calls } = open('principal');
    await screen.findByText(en.problems.noAccessTitle);
    expect(calls.some((call) => call.route === LIST_ROUTE)).toBe(false);
  });
});
