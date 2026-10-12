import type {
  AccountDetail,
  AccountRole,
  Division,
  Role,
  StaffAccount,
  StaffDetail,
  StaffListItem,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
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

// All names are invented. Task 2.3a, pull request #62.
const LOLA: StaffListItem = {
  id: uid(31),
  staffId: 'S-260007',
  firstName: 'Lola',
  lastName: 'Tursunova',
  fatherName: null,
  categories: [],
  branches: [
    { branchId: NORTH.id, name: 'North', main: true },
    { branchId: SOUTH.id, name: 'South', main: false },
  ],
  divisions: [{ divisionId: ACADEMIC.id, departmentId: null, main: true }],
  subjects: [],
  languages: [],
  phone: '+998901112233',
  status: 'active',
  planned: null,
  photoId: null,
};

const detail: StaffDetail = {
  ...LOLA,
  sex: 'female',
  birthDate: '1992-03-04',
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
  rights: { all: false, contact: false, teaching: false, accounts: true },
  today: '2026-10-10',
};

const PASSWORD = 'Kp7wQ2mZr9TbXy3H';

const SLIP = {
  firstName: 'Lola',
  lastName: 'Tursunova',
  login: 'l.tursunova',
  password: PASSWORD,
  validUntil: '2026-10-17T18:55:00.000Z',
};

const TEACHER: AccountRole = {
  id: uid(51),
  role: 'teacher',
  branchId: NORTH.id,
  branchName: 'North',
  from: '2026-10-10',
  until: null,
  state: 'current',
  givenBy: { login: 'a.karimova', name: { firstName: 'Aziza', lastName: 'Karimova' } },
  endedBy: null,
};

const ACCOUNT: AccountDetail = {
  login: 'l.tursunova',
  createdAt: '2026-10-10T18:00:00.000Z',
  neverUsed: true,
  locked: false,
  roles: [TEACHER],
};

const withAccount = (fields: Partial<StaffAccount> = {}): StaffAccount => ({
  account: ACCOUNT,
  canEdit: true,
  left: false,
  today: '2026-10-10',
  ...fields,
});

const noAccount: StaffAccount = { account: null, canEdit: true, left: false, today: '2026-10-10' };

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
    'GET /api/people/staff': () => json({ staff: [LOLA], today: '2026-10-10' }),
    'GET /api/setup/divisions': () => json({ divisions: [ACADEMIC], staffCounts: [] }),
    'GET /api/setup/subjects': () => json({ subjects: [], mayMoveDepartment: false }),
    [`GET /api/people/staff/${LOLA.id}`]: () => json(detail),
    [`GET /api/people/staff/${LOLA.id}/availability`]: () =>
      json({ entries: [], elsewhere: [], today: '2026-10-10' }),
    ...handlers,
  });
}

async function section(language: 'en' | 'ru' = 'en') {
  renderApp(PATH, language);
  const texts = language === 'en' ? en : ru;
  fireEvent.click(await screen.findByText('Lola Tursunova', { selector: 'button' }));
  const panel = await screen.findByRole('complementary', { name: 'Lola Tursunova' });
  return within(panel).findByRole('region', { name: texts.people.account.title });
}

describe('the account section', () => {
  it('creates the account with the suggested login and shows the slip once', async () => {
    let created = false;
    const calls = open('super_admin', {
      [`GET /api/people/staff/${LOLA.id}/account`]: () =>
        json(created ? withAccount({ account: { ...ACCOUNT, roles: [] } }) : noAccount),
      [`GET /api/people/staff/${LOLA.id}/account/suggestion`]: () => json({ login: 'l.tursunova' }),
      [`POST /api/people/staff/${LOLA.id}/account`]: () => {
        created = true;
        return json(SLIP, 201);
      },
    });
    const found = await section();
    const form = await within(found).findByRole('form', {
      name: en.people.account.createOf.replace('{{name}}', 'Lola Tursunova'),
    });
    const login = within(form).getByLabelText(en.people.account.login);
    expect((login as HTMLInputElement).value).toBe('l.tursunova');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    const dialog = await screen.findByRole('dialog', { name: en.people.account.slipTitle });
    expect(within(dialog).getByText(PASSWORD)).toBeDefined();
    expect(within(dialog).getByText(en.people.account.slipOnce)).toBeDefined();
    expect(
      calls.find((call) => call.route.endsWith('/account') && call.route.startsWith('POST'))?.body,
    ).toEqual({
      login: 'l.tursunova',
    });
    // The sheet that prints stands beside the page, hidden on screen.
    expect(document.querySelector('[data-slip-sheet]')?.textContent).toContain(PASSWORD);

    fireEvent.click(within(dialog).getByRole('button', { name: en.people.account.closeSlip }));
    await waitFor(() => {
      expect(document.body.textContent).not.toContain(PASSWORD);
    });
    expect(document.querySelector('[data-slip-sheet]')).toBeNull();
    await within(found).findByText(en.people.account.noRoles);
  });

  it('marks the login field when the login is taken', async () => {
    open('super_admin', {
      [`GET /api/people/staff/${LOLA.id}/account`]: () => json(noAccount),
      [`GET /api/people/staff/${LOLA.id}/account/suggestion`]: () => json({ login: null }),
      [`POST /api/people/staff/${LOLA.id}/account`]: () =>
        Response.json(
          {
            error: {
              code: 'login_taken',
              message: 'ENGLISH TEXT FOR THE DEVELOPER',
              requestId: 'test-request',
              details: [{ path: 'login', code: 'taken', message: 'taken' }],
            },
          },
          { status: 409 },
        ),
    });
    const found = await section();
    const form = await within(found).findByRole('form', {
      name: en.people.account.createOf.replace('{{name}}', 'Lola Tursunova'),
    });
    const login = within(form).getByLabelText(en.people.account.login);
    expect((login as HTMLInputElement).value).toBe('');
    fireEvent.change(login, { target: { value: 'l.tursunova' } });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(login.getAttribute('aria-invalid')).toBe('true');
    });
  });

  it('gives a role in a branch of the person from a date, and a Super Admin with no branch', async () => {
    const calls = open('super_admin', {
      [`GET /api/people/staff/${LOLA.id}/account`]: () => json(withAccount()),
      [`POST /api/people/staff/${LOLA.id}/roles`]: () => json(withAccount(), 201),
    });
    const found = await section();
    expect(within(found).getByText('l.tursunova')).toBeDefined();
    const row = found.querySelector('tr[data-role="teacher"]');
    expect(row?.textContent).toContain(en.roles.teacher);
    expect(row?.textContent).toContain('Aziza Karimova');
    const form = within(found).getByRole('form', {
      name: en.people.account.giveOf.replace('{{name}}', 'Lola Tursunova'),
    });
    fireEvent.change(within(form).getByLabelText(en.people.account.newRole), {
      target: { value: 'tutor' },
    });
    fireEvent.change(within(form).getByLabelText(en.people.account.branch), {
      target: { value: SOUTH.id },
    });
    fireEvent.change(within(form).getByLabelText(en.people.account.from), {
      target: { value: '2026-10-11' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.filter((call) => call.route.endsWith('/roles')).map((call) => call.body),
      ).toEqual([{ role: 'tutor', branchId: SOUTH.id, from: '2026-10-11' }]);
    });

    fireEvent.change(within(form).getByLabelText(en.people.account.newRole), {
      target: { value: 'super_admin' },
    });
    expect(within(form).queryByLabelText(en.people.account.branch)).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.filter((call) => call.route.endsWith('/roles')).at(-1)?.body).toEqual({
        role: 'super_admin',
        branchId: null,
        from: '2026-10-11',
      });
    });
  });

  it('ends a role from a date after asking, naming the person and the role', async () => {
    const calls = open('super_admin', {
      [`GET /api/people/staff/${LOLA.id}/account`]: () => json(withAccount()),
      [`POST /api/people/staff/${LOLA.id}/roles/${uid(51)}/end`]: () => json(withAccount()),
    });
    const found = await section();
    fireEvent.click(
      within(found).getByRole('button', {
        name: en.people.account.endOf.replace('{{role}}', en.roles.teacher),
      }),
    );
    const form = within(found).getByRole('form', {
      name: en.people.account.endOf.replace('{{role}}', en.roles.teacher),
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(`Lola Tursunova: ${en.roles.teacher}, North`)).toBeDefined();
    expect(calls.some((call) => call.route.endsWith('/end'))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.account.end }));
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/end'))?.body).toEqual({
        from: '2026-10-10',
      });
    });
  });

  it('shows the Principal the account and roles, with no form', async () => {
    open('principal', {
      [`GET /api/people/staff/${LOLA.id}/account`]: () =>
        json(
          withAccount({
            canEdit: false,
            account: {
              ...ACCOUNT,
              roles: [{ ...TEACHER, givenBy: { login: 's.olimov', name: null } }],
            },
          }),
        ),
    });
    const found = await section();
    expect(found.querySelector('tr[data-role="teacher"]')?.textContent).toContain('s.olimov');
    expect(within(found).queryByRole('form')).toBeNull();
    expect(within(found).queryByRole('button')).toBeNull();
  });

  it('speaks Russian', async () => {
    open(
      'super_admin',
      { [`GET /api/people/staff/${LOLA.id}/account`]: () => json(withAccount()) },
      'ru',
    );
    const found = await section('ru');
    expect(found.querySelector('tr[data-role="teacher"]')?.textContent).toContain(ru.roles.teacher);
    expect(
      within(found).getByRole('form', {
        name: ru.people.account.giveOf.replace('{{name}}', 'Lola Tursunova'),
      }),
    ).toBeDefined();
  });

  // Decision 7: a re-hire answers a slip, shown once like the first one.
  it('shows the slip of a re-hire after the status change', async () => {
    const left: StaffDetail = {
      ...detail,
      status: 'left',
      statuses: [
        { id: uid(41), status: 'active', from: '2026-09-01', until: '2026-10-01' },
        { id: uid(42), status: 'left', from: '2026-10-01', until: null },
      ],
      rights: { ...detail.rights, all: true },
    };
    open('super_admin', {
      [`GET /api/people/staff/${LOLA.id}`]: () => json(left),
      [`GET /api/people/staff/${LOLA.id}/account`]: () => json(withAccount()),
      [`POST /api/people/staff/${LOLA.id}/status`]: () =>
        json({
          ...left,
          status: 'active',
          slip: { ...SLIP, validUntil: '2026-10-26T19:00:00.000Z' },
        }),
    });
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Lola Tursunova', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Lola Tursunova' });
    const status = await within(panel).findByRole('form', {
      name: en.people.staff.statusOf.replace('{{name}}', 'Lola Tursunova'),
    });
    fireEvent.change(within(status).getByLabelText(en.people.staff.newStatus), {
      target: { value: 'active' },
    });
    fireEvent.change(within(status).getByLabelText(en.people.staff.from), {
      target: { value: '2026-10-20' },
    });
    fireEvent.click(within(status).getByRole('button', { name: en.form.save }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: en.people.staff.statusConfirmAction,
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: en.people.account.slipTitle });
    expect(within(dialog).getByText(PASSWORD)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.account.closeSlip }));
    await waitFor(() => {
      expect(document.body.textContent).not.toContain(PASSWORD);
    });
  });
});
