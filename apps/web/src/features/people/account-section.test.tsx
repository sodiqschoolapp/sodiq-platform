import type {
  AccountDetail,
  AccountRole,
  Division,
  Role,
  StaffAccount,
  StaffDetail,
  Subject,
  StaffListItem,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { uz } from '@/i18n/locales/uz';
import { accountAccessKey } from './people-api';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf, SOUTH } from '@/testing/render-app';

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
  rights: {
    all: false,
    contact: false,
    teaching: false,
    accounts: true,
    accountAccess: false,
    email: false,
  },
  today: '2026-10-10',
  sameAsRelative: null,
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
  subjects: [],
};

const ACCOUNT: AccountDetail = {
  login: 'l.tursunova',
  createdAt: '2026-10-10T18:00:00.000Z',
  neverUsed: true,
  locked: false,
  roles: [TEACHER],
};

const subjectOf = (n: number, en: string, uz: string, ru: string, archived = false): Subject => ({
  id: uid(n),
  names: { uz, ru, en },
  departmentId: uid(11),
  grades: [7, 8],
  colour: 'blue',
  journalType: 'graded',
  ratingExam: false,
  groupSubject: false,
  languageRule: true,
  demanding: false,
  archivedAt: archived ? '2026-10-01T00:00:00.000Z' : null,
  daily: null,
  quarterWeightsMissing: null,
  quarterCount: null,
});

const MATHEMATICS = subjectOf(61, 'Mathematics', 'Matematika', 'Математика');
const PHYSICS = subjectOf(62, 'Physics', 'Fizika', 'Физика');
const LATIN = subjectOf(63, 'Latin', 'Lotin tili', 'Латынь', true);

const HEAD_TEACHER: AccountRole = {
  ...TEACHER,
  id: uid(52),
  role: 'head_teacher',
  subjects: [
    { id: MATHEMATICS.id, names: MATHEMATICS.names, archived: false },
    { id: LATIN.id, names: LATIN.names, archived: true },
  ],
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
  language: 'en' | 'ru' | 'uz' = 'en',
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
    'GET /api/setup/subjects': () =>
      json({ subjects: [MATHEMATICS, PHYSICS, LATIN], mayMoveDepartment: false }),
    [`GET /api/people/staff/${LOLA.id}`]: () => json(detail),
    [`GET /api/people/staff/${LOLA.id}/availability`]: () =>
      json({ entries: [], elsewhere: [], today: '2026-10-10' }),
    ...handlers,
  });
}

let shell: ReturnType<typeof renderApp>;

async function section(language: 'en' | 'ru' | 'uz' = 'en') {
  shell = renderApp(PATH, language);
  const texts = { en, ru, uz }[language];
  fireEvent.click(await screen.findByText('Tursunova Lola', { selector: 'button' }));
  const panel = await screen.findByRole('complementary', { name: 'Tursunova Lola' });
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
      name: en.people.account.createOf.replace('{{name}}', 'Tursunova Lola'),
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
    // Correction 4: nothing keeps the password, neither a query nor a mutation.
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
    expect(
      JSON.stringify(
        shell.queryClient
          .getQueryCache()
          .getAll()
          .map((one) => one.state.data),
      ),
    ).not.toContain(PASSWORD);
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
      name: en.people.account.createOf.replace('{{name}}', 'Tursunova Lola'),
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
      name: en.people.account.giveOf.replace('{{name}}', 'Tursunova Lola'),
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

  // Task 2.3b-1: the Head Teacher and the Senior Head Teacher with their subjects.
  it('gives a Head Teacher with subjects, offering the active ones, and a Senior Head Teacher with all', async () => {
    const calls = open('super_admin', {
      [`GET /api/people/staff/${LOLA.id}/account`]: () => json(withAccount()),
      [`POST /api/people/staff/${LOLA.id}/roles`]: () => json(withAccount(), 201),
    });
    const found = await section();
    const form = within(found).getByRole('form', {
      name: en.people.account.giveOf.replace('{{name}}', 'Tursunova Lola'),
    });
    expect(within(form).queryByRole('group', { name: en.people.account.subjects })).toBeNull();
    fireEvent.change(within(form).getByLabelText(en.people.account.newRole), {
      target: { value: 'head_teacher' },
    });
    const subjects = await within(form).findByRole('group', { name: en.people.account.subjects });
    expect(within(subjects).queryByLabelText('Latin')).toBeNull();
    fireEvent.click(within(subjects).getByLabelText('Physics'));
    fireEvent.click(within(subjects).getByLabelText('Mathematics'));
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.filter((call) => call.route.endsWith('/roles')).map((call) => call.body),
      ).toEqual([
        {
          role: 'head_teacher',
          branchId: NORTH.id,
          from: '2026-10-10',
          subjectIds: [MATHEMATICS.id, PHYSICS.id],
        },
      ]);
    });

    fireEvent.change(within(form).getByLabelText(en.people.account.newRole), {
      target: { value: 'senior_head_teacher' },
    });
    expect(within(form).queryByLabelText(en.people.account.branch)).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: en.people.account.chooseAll }));
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.filter((call) => call.route.endsWith('/roles')).at(-1)?.body).toEqual({
        role: 'senior_head_teacher',
        branchId: null,
        from: '2026-10-10',
        subjectIds: [MATHEMATICS.id, PHYSICS.id],
      });
    });
  });

  it('shows the subjects of an appointment and changes them from a date', async () => {
    const calls = open('super_admin', {
      [`GET /api/people/staff/${LOLA.id}/account`]: () =>
        json(withAccount({ account: { ...ACCOUNT, roles: [TEACHER, HEAD_TEACHER] } })),
      [`POST /api/people/staff/${LOLA.id}/roles/${uid(52)}/subjects`]: () => json(withAccount()),
    });
    const found = await section();
    const row = found.querySelector('tr[data-role="head_teacher"]');
    expect(row?.querySelector('[data-subjects]')?.textContent).toBe(
      `Mathematics, ${en.people.account.archivedSubject.replace('{{name}}', 'Latin')}`,
    );
    expect(
      within(found).queryByRole('button', {
        name: en.people.account.changeSubjectsOf.replace('{{role}}', en.roles.teacher),
      }),
    ).toBeNull();
    fireEvent.click(
      within(found).getByRole('button', {
        name: en.people.account.changeSubjectsOf.replace('{{role}}', en.roles.head_teacher),
      }),
    );
    const form = within(found).getByRole('form', {
      name: en.people.account.changeSubjectsOf.replace('{{role}}', en.roles.head_teacher),
    });
    const subjects = await within(form).findByRole('group', { name: en.people.account.subjects });
    expect(within(subjects).getByLabelText<HTMLInputElement>('Mathematics').checked).toBe(true);
    fireEvent.click(within(subjects).getByLabelText('Physics'));
    fireEvent.change(within(form).getByLabelText(en.people.account.subjectsFrom), {
      target: { value: '2026-10-12' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.route.startsWith('POST') && call.route.endsWith('/subjects'))
          .map((call) => call.body),
      ).toEqual([{ subjectIds: [MATHEMATICS.id, PHYSICS.id], from: '2026-10-12' }]);
    });
  });

  it('says when a chosen subject has another Head Teacher', async () => {
    open('super_admin', {
      [`GET /api/people/staff/${LOLA.id}/account`]: () => json(withAccount()),
      [`POST /api/people/staff/${LOLA.id}/roles`]: () =>
        json(
          {
            error: {
              code: 'head_teacher_taken',
              message: 'A subject of the appointment has another holder at that time.',
              requestId: 'request-1',
              details: [{ path: 'subjectIds.0', code: 'taken', message: 'taken' }],
            },
          },
          409,
        ),
    });
    const found = await section();
    const form = within(found).getByRole('form', {
      name: en.people.account.giveOf.replace('{{name}}', 'Tursunova Lola'),
    });
    fireEvent.change(within(form).getByLabelText(en.people.account.newRole), {
      target: { value: 'head_teacher' },
    });
    fireEvent.click(
      within(
        await within(form).findByRole('group', { name: en.people.account.subjects }),
      ).getByLabelText('Mathematics'),
    );
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(await within(form).findByText(en.errors.head_teacher_taken)).toBeDefined();
  });

  it('ends a role from a date after asking, naming the person and the role', async () => {
    const calls = open('super_admin', {
      [`GET /api/people/staff/${LOLA.id}/account`]: () => json(withAccount()),
      [`POST /api/people/staff/${LOLA.id}/roles/${uid(51)}/end`]: () => json(withAccount()),
    });
    const found = await section();
    const invalidated = vi.spyOn(shell.queryClient, 'invalidateQueries');
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
    expect(within(dialog).getByText(`Tursunova Lola: ${en.roles.teacher}, North`)).toBeDefined();
    expect(calls.some((call) => call.route.endsWith('/end'))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.account.end }));
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/end'))?.body).toEqual({
        from: '2026-10-10',
      });
    });
    // Task 2.3c-1: what the sign-in access allows follows the roles.
    await waitFor(() => {
      expect(invalidated.mock.calls.map(([filters]) => filters?.queryKey)).toContainEqual(
        accountAccessKey(LOLA.id),
      );
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
        name: ru.people.account.giveOf.replace('{{name}}', 'Tursunova Lola'),
      }),
    ).toBeDefined();
  });

  // Issue #39, hand test of 13 October 2026, finding 23: "Issued" and "Valid
  // until" in one style, the long month, "Valid until" in the branch's time zone.
  it.each([
    ['en', en, '10 October 2026', '17 October 2026, 23:55'],
    ['ru', ru, '10 октября 2026 г.', '17 октября 2026 г., 23:55'],
    ['uz', uz, '10-oktabr, 2026', '17-oktabr, 2026, 23:55'],
  ] as const)(
    'writes both dates of the slip in one style in %s',
    async (language, texts, issued, valid) => {
      open(
        'super_admin',
        {
          'GET /api/setup/branch': () =>
            json({
              id: NORTH.id,
              name: 'North',
              address: null,
              phone: null,
              email: null,
              workingWeekdays: [1, 2, 3, 4, 5],
              timeZone: 'Asia/Tashkent',
              goLiveDate: null,
            }),
          [`GET /api/people/staff/${LOLA.id}/account`]: () => json(noAccount),
          [`GET /api/people/staff/${LOLA.id}/account/suggestion`]: () =>
            json({ login: 'l.tursunova' }),
          [`POST /api/people/staff/${LOLA.id}/account`]: () => json(SLIP, 201),
        },
        language,
      );
      const found = await section(language);
      const form = await within(found).findByRole('form', {
        name: texts.people.account.createOf.replace('{{name}}', 'Tursunova Lola'),
      });
      fireEvent.click(within(form).getByRole('button', { name: texts.form.save }));
      const dialog = await screen.findByRole('dialog', { name: texts.people.account.slipTitle });
      const value = (label: string) =>
        [...dialog.querySelectorAll('dt')].find((term) => term.textContent === label)
          ?.nextElementSibling?.textContent;
      expect(value(texts.people.account.issued)).toBe(issued);
      await waitFor(() => {
        expect(value(texts.people.account.validUntil)).toBe(valid);
      });
    },
  );

  it('says the branch was not read instead of using the device time zone on the slip', async () => {
    let up = false;
    open('super_admin', {
      'GET /api/setup/branch': () =>
        up
          ? json({
              id: NORTH.id,
              name: 'North',
              address: null,
              phone: null,
              email: null,
              workingWeekdays: [1, 2, 3, 4, 5],
              timeZone: 'Asia/Tashkent',
              goLiveDate: null,
            })
          : refusal('internal_error', 500),
      [`GET /api/people/staff/${LOLA.id}/account`]: () => json(noAccount),
      [`GET /api/people/staff/${LOLA.id}/account/suggestion`]: () => json({ login: 'l.tursunova' }),
      [`POST /api/people/staff/${LOLA.id}/account`]: () => json(SLIP, 201),
    });
    const found = await section();
    const form = await within(found).findByRole('form', {
      name: en.people.account.createOf.replace('{{name}}', 'Tursunova Lola'),
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('dialog', { name: en.people.account.slipTitle });
    expect((await within(dialog).findByRole('alert')).textContent).toBe(en.errors.internal_error);
    expect(dialog.textContent).not.toContain('2026, ');

    up = true;
    fireEvent.click(within(dialog).getByRole('button', { name: en.problems.retry }));
    expect(await within(dialog).findByText('17 October 2026, 23:55')).toBeDefined();
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
    shell = renderApp(PATH);
    fireEvent.click(await screen.findByText('Tursunova Lola', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Tursunova Lola' });
    const status = await within(panel).findByRole('form', {
      name: en.people.staff.statusOf.replace('{{name}}', 'Tursunova Lola'),
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
    // Correction 4: nothing keeps the password, neither a query nor a mutation.
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
    expect(
      JSON.stringify(
        shell.queryClient
          .getQueryCache()
          .getAll()
          .map((one) => one.state.data),
      ),
    ).not.toContain(PASSWORD);
  });
});
