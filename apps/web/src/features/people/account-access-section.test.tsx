import type {
  AccountAccess,
  AccountAccessDetail,
  Division,
  Role,
  StaffDetail,
  StaffListItem,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SUPER_ADMINS_KEY } from '@/features/access/super-admin-banner';
import { BRANCHES_WITHOUT_VICE_KEY } from '@/features/access/vice-principal-banner';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { accountAccessKey, headTeachersKey, neverUsedKey, staffAccountKey } from './people-api';
import { fakeApi, json, NORTH, renderApp, sessionOf, SOUTH } from '@/testing/render-app';

const PATH = '/people/staff';

const uid = (n: number): string => `0199c000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const ACADEMIC: Division = {
  id: uid(1),
  names: { uz: 'Oʻquv boʻlimi', ru: 'Учебный отдел', en: 'Academic' },
  builtIn: true,
  archivedAt: null,
  departments: [],
};

// All names are invented. Task 2.3c-1, pull request #65.
const ODIL: StaffListItem = {
  id: uid(31),
  staffId: 'S-260011',
  firstName: 'Odil',
  lastName: 'Nazarov',
  fatherName: null,
  categories: ['teacher'],
  branches: [{ branchId: NORTH.id, name: 'North', main: true }],
  divisions: [{ divisionId: ACADEMIC.id, departmentId: null, main: true }],
  subjects: [],
  languages: [],
  phone: '+998901112244',
  status: 'active',
  planned: null,
  photoId: null,
};

const detail: StaffDetail = {
  ...ODIL,
  sex: 'male',
  birthDate: '1990-05-06',
  jshshir: null,
  identityHidden: false,
  educationLevel: 'bachelor',
  email: null,
  admissionDate: '2026-09-01',
  contractType: 'full_time',
  contractDate: null,
  weeklyLessons: 18,
  dailyLessons: 5,
  statuses: [{ id: uid(41), status: 'active', from: '2026-09-01', until: null }],
  rights: {
    all: false,
    contact: true,
    teaching: true,
    accounts: false,
    accountAccess: true,
    email: true,
  },
  today: '2026-10-10',
  sameAsRelative: null,
};

const PASSWORD = 'Rt5vNw8QpL2kXz7M';

const SLIP = {
  firstName: 'Odil',
  lastName: 'Nazarov',
  login: 'o.nazarov',
  password: PASSWORD,
  validUntil: '2026-10-11T18:55:00.000Z',
};

const ACCOUNT: AccountAccessDetail = {
  login: 'o.nazarov',
  locked: null,
  passwordReset: null,
  neverUsed: false,
  secondStepOn: false,
};

const ALL = { lock: true, unlock: false, resetPassword: true, resetSecondStep: false };
const NOTHING = { lock: false, unlock: false, resetPassword: false, resetSecondStep: false };

const stateOf = (fields: Partial<AccountAccess> = {}): AccountAccess => ({
  account: ACCOUNT,
  can: ALL,
  ...fields,
});

function open(
  role: Role,
  handlers: Record<string, (body: unknown) => Response>,
  language: 'en' | 'ru' = 'en',
) {
  return fakeApi({
    'GET /api/auth/session': () =>
      json({
        ...sessionOf({
          assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
          branches: [NORTH, SOUTH],
        }),
        language,
      }),
    'GET /api/people/staff': () => json({ staff: [ODIL], today: '2026-10-10' }),
    'GET /api/setup/divisions': () => json({ divisions: [ACADEMIC], staffCounts: [] }),
    'GET /api/setup/subjects': () => json({ subjects: [], mayMoveDepartment: false }),
    [`GET /api/people/staff/${ODIL.id}`]: () => json(detail),
    [`GET /api/people/staff/${ODIL.id}/availability`]: () =>
      json({ entries: [], elsewhere: [], today: '2026-10-10' }),
    ...handlers,
  });
}

let shell: ReturnType<typeof renderApp>;

async function section(language: 'en' | 'ru' = 'en') {
  shell = renderApp(PATH, language);
  const texts = language === 'en' ? en : ru;
  fireEvent.click(await screen.findByText('Nazarov Odil', { selector: 'button' }));
  const panel = await screen.findByRole('complementary', { name: 'Nazarov Odil' });
  return within(panel).findByRole('region', { name: texts.people.access.title });
}

/** Clicks the button of the confirmation dialog that goes on. */
async function confirmWith(action: string) {
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: action }));
}

const cachesHold = (text: string): boolean =>
  JSON.stringify([
    shell.queryClient
      .getMutationCache()
      .getAll()
      .map((one) => one.state.data),
    shell.queryClient
      .getQueryCache()
      .getAll()
      .map((one) => one.state.data),
  ]).includes(text);

describe('the sign-in access section', () => {
  it('shows a button only where the server allows it', async () => {
    open('academic_vice_principal', {
      [`GET /api/people/staff/${ODIL.id}/account/access`]: () => json(stateOf()),
    });
    const found = await section();
    expect(within(found).getByText('o.nazarov')).toBeDefined();
    expect(within(found).getByRole('button', { name: en.people.access.lock })).toBeDefined();
    expect(
      within(found).getByRole('button', { name: en.people.access.resetPassword }),
    ).toBeDefined();
    expect(within(found).queryByRole('button', { name: en.people.access.unlock })).toBeNull();
    expect(
      within(found).queryByRole('button', { name: en.people.access.resetSecondStep }),
    ).toBeNull();
  });

  it('shows the Principal the state and no button', async () => {
    open('principal', {
      [`GET /api/people/staff/${ODIL.id}/account/access`]: () =>
        json(
          stateOf({
            account: {
              ...ACCOUNT,
              locked: {
                at: '2026-10-10T10:00:00.000Z',
                by: { login: 'a.karimova', name: { firstName: 'Aziza', lastName: 'Karimova' } },
                reason: 'Laptop lost',
              },
              neverUsed: true,
            },
            can: NOTHING,
          }),
        ),
    });
    const found = await section();
    const locked = found.querySelector('[data-state="locked"]');
    expect(locked?.textContent).toContain('Aziza Karimova');
    expect(locked?.textContent).toContain('Laptop lost');
    expect(found.querySelector('[data-state="never-used"]')?.textContent).toBe(
      en.people.access.neverUsed,
    );
    expect(within(found).queryAllByRole('button')).toEqual([]);
  });

  it('locks with a reason, which is required, and refreshes the section', async () => {
    let locked = false;
    const calls = open('academic_vice_principal', {
      [`GET /api/people/staff/${ODIL.id}/account/access`]: () =>
        json(
          locked
            ? stateOf({
                account: {
                  ...ACCOUNT,
                  locked: {
                    at: '2026-10-10T10:00:00.000Z',
                    by: { login: 'd.saidova', name: null },
                    reason: 'Laptop lost',
                  },
                },
                can: { ...NOTHING, unlock: true, resetPassword: true },
              })
            : stateOf(),
        ),
      [`POST /api/people/staff/${ODIL.id}/account/lock`]: () => {
        locked = true;
        return json(stateOf());
      },
    });
    const found = await section();
    fireEvent.click(within(found).getByRole('button', { name: en.people.access.lock }));
    const dialog = await screen.findByRole('dialog', {
      name: en.people.access.lockTitle.replace('{{name}}', 'Nazarov Odil'),
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.access.lock }));
    expect(await within(dialog).findByText(en.people.access.reasonNeeded)).toBeDefined();
    expect(calls.some((call) => call.route.startsWith('POST'))).toBe(false);

    fireEvent.change(within(dialog).getByLabelText(en.people.access.reason), {
      target: { value: 'Laptop lost' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.access.lock }));
    await within(found).findByRole('button', { name: en.people.access.unlock });
    expect(calls.find((call) => call.route.endsWith('/lock'))?.body).toEqual({
      reason: 'Laptop lost',
    });
    expect(found.querySelector('[data-state="locked"]')?.textContent).toContain('d.saidova');
  });

  it('shows the text of a refusal: the last active Super Admin', async () => {
    open('super_admin', {
      [`GET /api/people/staff/${ODIL.id}/account/access`]: () => json(stateOf()),
      [`POST /api/people/staff/${ODIL.id}/account/lock`]: () =>
        json(
          {
            error: {
              code: 'last_super_admin',
              message: 'x',
              requestId: '0b7e7a52-5a43-4d4e-9d43-6c1f0a8f1b11',
            },
          },
          409,
        ),
    });
    const found = await section();
    fireEvent.click(within(found).getByRole('button', { name: en.people.access.lock }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(en.people.access.reason), {
      target: { value: 'Leaves the school' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.access.lock }));
    expect(await within(dialog).findByText(en.errors.last_super_admin)).toBeDefined();
  });

  it('resets the password after a confirmation and shows the slip once', async () => {
    const calls = open('academic_vice_principal', {
      [`GET /api/people/staff/${ODIL.id}/account/access`]: () => json(stateOf()),
      [`POST /api/people/staff/${ODIL.id}/account/password-reset`]: () => json(SLIP),
    });
    const found = await section();
    fireEvent.click(within(found).getByRole('button', { name: en.people.access.resetPassword }));
    await confirmWith(en.people.access.resetPassword);

    const dialog = await screen.findByRole('dialog', { name: en.people.access.slipTitle });
    expect(within(dialog).getByText(PASSWORD)).toBeDefined();
    expect(calls.filter((call) => call.route.endsWith('/password-reset'))).toHaveLength(1);
    // The secret stays only in the state of the part (`.claude/rules/web.md`).
    await waitFor(() => {
      expect(
        JSON.stringify(
          shell.queryClient
            .getMutationCache()
            .getAll()
            .map((one) => one.state.data),
        ),
      ).not.toContain(PASSWORD);
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.account.closeSlip }));
    await waitFor(() => {
      expect(document.body.textContent).not.toContain(PASSWORD);
    });
    expect(cachesHold(PASSWORD)).toBe(false);
  });

  it('resets the second step with the password, naming both, for a Super Admin', async () => {
    open('super_admin', {
      [`GET /api/people/staff/${ODIL.id}/account/access`]: () =>
        json(
          stateOf({
            account: { ...ACCOUNT, secondStepOn: true },
            can: { ...ALL, resetSecondStep: true },
          }),
        ),
      [`POST /api/people/staff/${ODIL.id}/account/second-step-reset`]: () => json(SLIP),
    });
    const found = await section();
    expect(found.querySelector('[data-state="second-step"]')).not.toBeNull();
    fireEvent.click(within(found).getByRole('button', { name: en.people.access.resetSecondStep }));
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText(en.people.access.secondStepText)).toBeDefined();
    fireEvent.click(
      within(question).getByRole('button', { name: en.people.access.resetSecondStep }),
    );
    const dialog = await screen.findByRole('dialog', { name: en.people.access.slipTitle });
    expect(within(dialog).getByText(PASSWORD)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.account.closeSlip }));
    await waitFor(() => {
      expect(cachesHold(PASSWORD)).toBe(false);
    });
  });

  it('speaks Russian', async () => {
    open(
      'academic_vice_principal',
      { [`GET /api/people/staff/${ODIL.id}/account/access`]: () => json(stateOf()) },
      'ru',
    );
    const found = await section('ru');
    expect(within(found).getByRole('button', { name: ru.people.access.lock })).toBeDefined();
  });

  it('refreshes the queries a lock, an unlock and a reset change', async () => {
    let locked = false;
    open('super_admin', {
      [`GET /api/people/staff/${ODIL.id}/account/access`]: () =>
        json(
          stateOf({
            can: { lock: !locked, unlock: locked, resetPassword: true, resetSecondStep: false },
          }),
        ),
      [`POST /api/people/staff/${ODIL.id}/account/lock`]: () => {
        locked = true;
        return json(stateOf());
      },
      [`POST /api/people/staff/${ODIL.id}/account/unlock`]: () => {
        locked = false;
        return json(stateOf());
      },
      [`POST /api/people/staff/${ODIL.id}/account/password-reset`]: () => json(SLIP),
    });
    const found = await section();
    const invalidated = vi.spyOn(shell.queryClient, 'invalidateQueries');
    const refreshed = async () => {
      await waitFor(() => {
        const keys = invalidated.mock.calls.map(([filters]) => filters?.queryKey);
        for (const key of [
          accountAccessKey(ODIL.id),
          staffAccountKey(ODIL.id),
          neverUsedKey(),
          SUPER_ADMINS_KEY,
          BRANCHES_WITHOUT_VICE_KEY,
          headTeachersKey(),
        ]) {
          expect(keys).toContainEqual(key);
        }
      });
      invalidated.mockClear();
    };

    fireEvent.click(within(found).getByRole('button', { name: en.people.access.lock }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(en.people.access.reason), {
      target: { value: 'Laptop lost' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.access.lock }));
    await refreshed();

    fireEvent.click(await within(found).findByRole('button', { name: en.people.access.unlock }));
    await confirmWith(en.people.access.unlock);
    await refreshed();

    fireEvent.click(within(found).getByRole('button', { name: en.people.access.resetPassword }));
    await confirmWith(en.people.access.resetPassword);
    await refreshed();
  });
});
