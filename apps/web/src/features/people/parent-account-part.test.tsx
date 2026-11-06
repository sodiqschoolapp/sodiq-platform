import type { PrintedParentSlips, RelativeDetail, RelativeListItem } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { uz } from '@/i18n/locales/uz';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199f100-0000-7000-8000-${String(n).padStart(12, '0')}`;

// Task 11.1, pull request #292: the Parent account on the Parent panel, and its reset
// (`edge/close-relatives`, forgotten password). All names are invented.
const MOTHER: RelativeListItem = {
  id: uid(1),
  fullName: 'Dilfuza Rahimova',
  phone: null,
  students: [
    {
      id: uid(11),
      firstName: 'Oʻtkir',
      lastName: 'Rahimov',
      uid: '2607001',
      relationship: 'mother',
      mainContact: true,
    },
  ],
  elsewhere: 0,
  phoneInvalidSince: null,
};

const DETAIL: RelativeDetail = {
  ...MOTHER,
  extraPhones: [],
  samePerson: null,
  samePersonElsewhere: false,
  identity: { workplace: null, email: null },
  identityHidden: false,
  canEdit: true,
};

const RESET: PrintedParentSlips = {
  language: 'uz',
  className: null,
  botUsername: null,
  slips: [
    {
      relativeId: MOTHER.id,
      fullName: 'Dilfuza Rahimova',
      children: [{ studentId: uid(11), firstName: 'Oʻtkir', lastName: 'Rahimov' }],
      login: 'd.rahimova',
      password: 'One-Time-Reset-77',
      kind: 'reset',
      printedAt: '2026-10-10T05:00:00.000Z',
      validUntil: '2026-10-17T05:00:00.000Z',
    },
  ],
};

const RESET_ROUTE = `POST /api/people/parents/${MOTHER.id}/password-reset`;

function open() {
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(sessionOf({ assignments: [{ role: 'academic_vice_principal', branchId: NORTH.id }] })),
    'GET /api/setup/branch': () =>
      json({ id: NORTH.id, name: NORTH.name, timeZone: 'Asia/Tashkent' }),
    'GET /api/people/relatives': () =>
      json({ relatives: [MOTHER], searchesPhone: true, canEdit: true }),
    [`GET /api/people/relatives/${MOTHER.id}`]: () => json(DETAIL),
    [`GET /api/people/parents/${MOTHER.id}/account`]: () =>
      json({
        account: {
          login: 'd.rahimova',
          signedIn: true,
          lastSignInAt: '2026-10-08T05:00:00.000Z',
          slip: {
            kind: 'first',
            printedAt: '2026-09-20T05:00:00.000Z',
            validUntil: '2026-10-20T05:00:00.000Z',
            valid: false,
            otherBranch: false,
            className: '7 Oxford',
          },
        },
      }),
    [RESET_ROUTE]: () => json(RESET),
  });
  const shell = renderApp(`/people/parents?open=${MOTHER.id}`);
  return { calls, shell };
}

describe('the Parent account on the Parent panel', () => {
  it('names the login and the last slip, and resets the password on a slip after asking', async () => {
    const { calls, shell } = open();
    const part = await screen.findByRole('region', { name: en.people.parentAccount.title });
    await waitFor(() => {
      expect(part.textContent).toContain('d.rahimova');
    });
    expect(part.textContent).toContain(en.people.parentAccount.signedIn);
    expect(part.textContent).toContain('7 Oxford, 20 September 2026');

    fireEvent.change(
      within(part).getByRole('combobox', { name: en.people.parentAccount.resetLanguage }),
      { target: { value: 'uz' } },
    );
    fireEvent.click(within(part).getByRole('button', { name: en.people.parentAccount.reset }));
    // It asks first, naming the parent; nothing is sent before the answer.
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Dilfuza Rahimova');
    expect(calls.some((call) => call.route === RESET_ROUTE)).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.parentAccount.reset }));

    const sheet = await screen.findByRole('region', { name: '1 slip' });
    expect(calls.find((call) => call.route === RESET_ROUTE)?.body).toEqual({ language: 'uz' });
    expect(within(sheet).getAllByText('One-Time-Reset-77').length).toBeGreaterThan(0);
    expect(sheet.textContent).toContain(uz.people.parentSlip.title);

    // Back: the password leaves the screen, and no cache ever held it.
    fireEvent.click(within(sheet).getByRole('button', { name: en.people.parentSlips.back }));
    await waitFor(() => {
      expect(screen.queryAllByText('One-Time-Reset-77')).toHaveLength(0);
    });
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
    ).not.toContain('One-Time-Reset-77');
  });
});
