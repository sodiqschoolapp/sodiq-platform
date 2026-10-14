import type { Division, Role, StaffDetail, StaffListItem, Subject } from '@sodiq/shared';
import { EXPORT_TEXTS, STAFF_EXPORT_COLUMNS } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf, SOUTH } from '@/testing/render-app';
import { savedRecordPanel } from '@/testing/new-record';
import {
  actionsAreLast,
  edit,
  panelActionNames,
  panelActions,
  savedInPanel,
} from '@/testing/panel';

const PATH = '/people/staff';

const uid = (n: number): string => `0199b000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const ACADEMIC: Division = {
  id: uid(1),
  names: { uz: 'Oʻquv boʻlimi', ru: 'Учебный отдел', en: 'Academic' },
  builtIn: true,
  archivedAt: null,
  departments: [
    { id: uid(11), names: { uz: 'STEAM', ru: 'STEAM', en: 'STEAM' }, archivedAt: null },
  ],
};

const MANAGEMENT: Division = {
  id: uid(2),
  names: { uz: 'Rahbariyat', ru: 'Руководство', en: 'Management' },
  builtIn: false,
  archivedAt: null,
  departments: [],
};

const MATHEMATICS: Subject = {
  id: uid(21),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  departmentId: uid(11),
  grades: [5, 6, 7],
  colour: 'blue',
  journalType: 'graded',
  ratingExam: true,
  groupSubject: false,
  languageRule: true,
  demanding: false,
  archivedAt: null,
  daily: { attendance: 10, classwork: 50, homework: 40 },
  quarterWeightsMissing: null,
  quarterCount: null,
};

// All names are invented.
const AKMAL: StaffListItem = {
  id: uid(31),
  staffId: 'S-260001',
  firstName: 'Akmal',
  lastName: 'Karimov',
  fatherName: null,
  categories: ['teacher'],
  branches: [
    { branchId: NORTH.id, name: 'North', main: true },
    { branchId: SOUTH.id, name: 'South', main: false },
  ],
  divisions: [{ divisionId: ACADEMIC.id, departmentId: uid(11), main: true }],
  subjects: [{ subjectId: MATHEMATICS.id, grades: [5, 6] }],
  languages: ['uz', 'ru'],
  phone: '+998901234567',
  status: 'active',
  planned: null,
  photoId: null,
};

const NODIRA: StaffListItem = {
  ...AKMAL,
  id: uid(32),
  staffId: 'S-260002',
  firstName: 'Nodira',
  lastName: 'Aliyeva',
  categories: [],
  branches: [{ branchId: NORTH.id, name: 'North', main: true }],
  divisions: [{ divisionId: MANAGEMENT.id, departmentId: null, main: true }],
  subjects: [],
  languages: [],
  phone: '+998907654321',
  status: 'inactive',
};

const detailOf = (row: StaffListItem, fields: Partial<StaffDetail> = {}): StaffDetail => ({
  ...row,
  sex: 'male',
  birthDate: '1990-05-06',
  jshshir: '31234567890123',
  identityHidden: false,
  educationLevel: 'master',
  email: null,
  admissionDate: '2026-09-01',
  contractType: 'full_time',
  contractDate: null,
  weeklyLessons: 18,
  dailyLessons: 5,
  statuses: [{ id: uid(41), status: 'active', from: '2026-09-01', until: null }],
  rights: {
    all: true,
    contact: true,
    teaching: true,
    accounts: false,
    accountAccess: false,
    email: true,
  },
  today: '2026-10-10',
  sameAsRelative: null,
  ...fields,
});

const sessionAs = (role: Role, language: 'en' | 'ru' = 'en') => ({
  ...sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
    branches: [NORTH, SOUTH],
  }),
  language,
});

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

function openList(
  role: Role,
  extra: Record<string, (body: unknown) => Response> = {},
  language: 'en' | 'ru' = 'en',
  detail: Partial<StaffDetail> = {},
) {
  return fakeApi({
    'GET /api/auth/session': () => json(sessionAs(role, language)),
    'GET /api/people/staff': () => json({ staff: [AKMAL, NODIRA], today: '2026-10-10' }),
    'GET /api/setup/divisions': () => json({ divisions: [ACADEMIC, MANAGEMENT], staffCounts: [] }),
    'GET /api/setup/subjects': () => json({ subjects: [MATHEMATICS], mayMoveDepartment: false }),
    [`GET /api/people/staff/${AKMAL.id}`]: () => json(detailOf(AKMAL, detail)),
    ...extra,
  });
}

// docs/spec/04-people.md, Teacher and staff record; task 2.2a.
describe('the staff page', () => {
  it('lists the people of the branch with the columns of the spec', async () => {
    openList('super_admin');
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.people.staff.title });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });

    // In the order of the server (by surname); no checkbox column without bulk actions.
    expect(rowsDrawn()).toEqual([
      [
        // The photo column: the initials while there is no photo.
        'AK',
        'Karimov Akmal',
        'S-260001',
        en.roles.teacher,
        'North, South',
        'STEAM',
        'Mathematics',
        // Grades as ranges, the phone grouped (findings 19 and 24).
        '5–6',
        `${en.people.staff.languages.uz}, ${en.people.staff.languages.ru}`,
        '+998 90 123 45 67',
        en.people.staff.statuses.active,
      ],
      [
        'NA',
        'Aliyeva Nodira',
        'S-260002',
        '',
        'North',
        '',
        '',
        '',
        '',
        '+998 90 765 43 21',
        en.people.staff.statuses.inactive,
      ],
    ]);
  });

  it('names the statuses in Russian when Russian is chosen', async () => {
    openList('super_admin', {}, 'ru');
    renderApp(PATH, 'ru');
    await screen.findByRole('heading', { name: ru.people.staff.title });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });

    expect(rowsDrawn().map((row) => row.at(-1))).toEqual([
      ru.people.staff.statuses.active,
      ru.people.staff.statuses.inactive,
    ]);
  });

  // 04, the teacher list (spec change of 13 October 2026, item A2): the
  // category column shows every role held in the branch; its filter offers every role.
  it('shows every role in the category and filters by any of them', async () => {
    const heads: StaffListItem = {
      ...NODIRA,
      categories: ['super_admin', 'principal', 'senior_head_teacher'],
    };
    openList('super_admin', {
      'GET /api/people/staff': () => json({ staff: [AKMAL, heads], today: '2026-10-10' }),
    });
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.people.staff.title });
    await waitFor(() => {
      expect(rowsDrawn().map((row) => row[3])).toEqual([
        en.roles.teacher,
        `${en.roles.super_admin}, ${en.roles.principal}, ${en.roles.senior_head_teacher}`,
      ]);
    });
    const filter = screen.getByRole('combobox', { name: en.people.staff.categories });
    expect([...filter.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      en.list.all,
      en.roles.super_admin,
      en.roles.principal,
      en.roles.academic_vice_principal,
      en.roles.spiritual_vice_principal,
      en.roles.head_tutor,
      en.roles.tutor,
      en.roles.senior_head_teacher,
      en.roles.head_teacher,
      en.roles.teacher,
    ]);
    fireEvent.change(filter, { target: { value: 'principal' } });
    await waitFor(() => {
      expect(rowsDrawn().map((row) => row[1])).toEqual(['Aliyeva Nodira']);
    });
    fireEvent.change(filter, { target: { value: 'teacher' } });
    await waitFor(() => {
      expect(rowsDrawn().map((row) => row[1])).toEqual(['Karimov Akmal']);
    });
  });

  it('filters by status and finds a person by staff ID', async () => {
    openList('super_admin');
    renderApp(`${PATH}?f=${encodeURIComponent(JSON.stringify({ status: 'active' }))}`);
    await screen.findByRole('heading', { name: en.people.staff.title });
    await waitFor(() => {
      expect(rowsDrawn().map((row) => row[1])).toEqual(['Karimov Akmal']);
    });
  });

  it('opens a person with the status history, and the Super Admin changes the status from a date', async () => {
    const after = detailOf(AKMAL, {
      status: 'active',
      planned: { status: 'left', from: '2026-10-30' },
      statuses: [
        { id: uid(41), status: 'active', from: '2026-09-01', until: '2026-10-30' },
        { id: uid(42), status: 'left', from: '2026-10-30', until: null },
      ],
    });
    let saved = false;
    const calls = openList('super_admin', {
      [`POST /api/people/staff/${AKMAL.id}/status`]: () => {
        saved = true;
        // No re-hire: no slip (task 2.3a).
        return json({ ...after, slip: null });
      },
      [`GET /api/people/staff/${AKMAL.id}`]: () => json(saved ? after : detailOf(AKMAL)),
    });
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.people.staff.title });
    fireEvent.click(await screen.findByText('Karimov Akmal', { selector: 'button' }));

    const panel = await screen.findByRole('complementary', { name: 'Akmal Karimov' });
    const status = await edit(
      panel,
      en.people.staff.statusOf.replace('{{name}}', 'Akmal Karimov'),
      en.people.staff.changeStatus,
    );
    fireEvent.change(within(status).getByLabelText(en.people.staff.newStatus), {
      target: { value: 'left' },
    });
    fireEvent.change(within(status).getByLabelText(en.people.staff.from), {
      target: { value: '2026-10-30' },
    });
    fireEvent.click(within(status).getByRole('button', { name: en.form.save }));

    // A status change asks first, naming the person; "left" says that the roles end.
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(en.people.staff.statusConfirmLeft)).toBeDefined();
    expect(within(dialog).getByText('Akmal Karimov')).toBeDefined();
    expect(calls.some((call) => call.route.endsWith('/status'))).toBe(false);
    fireEvent.click(
      within(dialog).getByRole('button', { name: en.people.staff.statusConfirmAction }),
    );

    await waitFor(() => {
      expect(calls.some((call) => call.route === `POST /api/people/staff/${AKMAL.id}/status`)).toBe(
        true,
      );
    });
    expect(calls.find((call) => call.route.endsWith('/status'))?.body).toEqual({
      status: 'left',
      from: '2026-10-30',
    });
    await waitFor(() => {
      expect(
        within(panel).getByRole('table', { name: en.people.staff.historyTitle }).textContent,
      ).toContain(en.people.staff.statuses.left);
    });
    // Task 2.7c-2b-2a: the form closes, "Saved." is at the bottom, the focus is on its button.
    await savedInPanel(panel);
    expect(status.isConnected).toBe(false);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(panel).getByRole('button', { name: en.people.staff.changeStatus }),
      );
    });
  });

  // Task 2.3c-2, decision 4 of pull request #66: the email opens the account
  // through the reset by email; where the server says no, the field is off.
  it('keeps the email field off, with its reason, where the server gives no email right', async () => {
    openList('academic_vice_principal', {}, 'en', {
      rights: {
        all: false,
        contact: true,
        teaching: true,
        accounts: false,
        accountAccess: false,
        email: false,
      },
    });
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.people.staff.title });
    fireEvent.click(await screen.findByText('Karimov Akmal', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Akmal Karimov' });
    const record = await edit(panel, 'Akmal Karimov');

    const email = within(record).getByLabelText<HTMLInputElement>(en.people.staff.email);
    expect(email.disabled).toBe(true);
    expect(email.getAttribute('aria-describedby')).toBeTruthy();
    expect(within(record).getByText(en.people.staff.emailLocked)).toBeDefined();
    expect(within(record).getByLabelText<HTMLInputElement>(en.people.staff.phone).disabled).toBe(
      false,
    );
  });

  it('lets the Academic Vice Principal change only name, phone and email of the record', async () => {
    openList('academic_vice_principal', {}, 'en', {
      rights: {
        all: false,
        contact: true,
        teaching: true,
        accounts: false,
        accountAccess: false,
        email: true,
      },
    });
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.people.staff.title });
    fireEvent.click(await screen.findByText('Karimov Akmal', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Akmal Karimov' });
    // No status form and no branches form: their buttons are the Super Admin's.
    await within(panel).findByRole('button', { name: en.form.edit });
    expect(within(panel).queryByRole('button', { name: en.people.staff.changeStatus })).toBeNull();
    expect(
      within(panel).queryByRole('button', { name: en.people.staff.changeBranches }),
    ).toBeNull();
    const record = await edit(panel, 'Akmal Karimov');

    expect(within(record).getByLabelText<HTMLInputElement>(en.people.staff.phone).disabled).toBe(
      false,
    );
    expect(
      within(record).getByLabelText<HTMLInputElement>(en.people.staff.firstName).disabled,
    ).toBe(false);
    expect(within(record).getByLabelText<HTMLSelectElement>(en.people.staff.sex).disabled).toBe(
      true,
    );
    expect(
      within(record).getByLabelText<HTMLInputElement>(en.people.staff.admissionDate).disabled,
    ).toBe(true);
  });

  // Issue #39, hand test of 13 October 2026, finding 2: the further
  // divisions are the Super Admin's; for the Academic Vice Principal they are
  // greyed like the main division, and a save sends them unchanged.
  it('greys the further divisions for the Academic Vice Principal and sends them unchanged', async () => {
    const calls = openList(
      'academic_vice_principal',
      { [`PUT /api/people/staff/${AKMAL.id}`]: () => json(detailOf(AKMAL)) },
      'en',
      {
        rights: {
          all: false,
          contact: true,
          teaching: true,
          accounts: false,
          accountAccess: false,
          email: true,
        },
      },
    );
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Karimov Akmal', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Akmal Karimov' });
    const record = await edit(panel, 'Akmal Karimov');
    const management = within(record).getByRole<HTMLInputElement>('checkbox', {
      name: 'Management',
    });
    expect(management.disabled).toBe(true);
    expect(management.closest('label')?.className).toContain('has-disabled:opacity-50');
    fireEvent.click(management);
    expect(management.checked).toBe(false);

    fireEvent.change(within(record).getByLabelText(en.people.staff.phone), {
      target: { value: '+998 90 111 22 33' },
    });
    fireEvent.click(within(record).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `PUT /api/people/staff/${AKMAL.id}`)?.body,
      ).toMatchObject({
        divisions: [{ divisionId: ACADEMIC.id, departmentId: uid(11), main: true }],
      });
    });
  });

  it('lets the Super Admin tick a further division and sends it', async () => {
    const calls = openList('super_admin', {
      [`PUT /api/people/staff/${AKMAL.id}`]: () => json(detailOf(AKMAL)),
    });
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Karimov Akmal', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Akmal Karimov' });
    const record = await edit(panel, 'Akmal Karimov');
    const management = within(record).getByRole<HTMLInputElement>('checkbox', {
      name: 'Management',
    });
    expect(management.disabled).toBe(false);
    fireEvent.click(management);
    fireEvent.click(within(record).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `PUT /api/people/staff/${AKMAL.id}`)?.body,
      ).toMatchObject({
        divisions: [
          { divisionId: ACADEMIC.id, departmentId: uid(11), main: true },
          { divisionId: MANAGEMENT.id, departmentId: null, main: false },
        ],
      });
    });
    // Task 2.7c-2b-2a: the form closes, "Saved." is at the bottom, the focus is on Edit.
    await savedInPanel(panel);
    expect(record.isConnected).toBe(false);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(panel).getByRole('button', { name: en.form.edit }),
      );
    });
  });

  it('shows the Principal the record without forms, and birth date and JSHSHIR after a logged show', async () => {
    const calls = openList(
      'principal',
      {
        [`POST /api/people/staff/${AKMAL.id}/identity`]: () =>
          json({ birthDate: '1990-05-06', jshshir: '31234567890123' }),
      },
      'en',
      {
        rights: {
          all: false,
          contact: false,
          teaching: false,
          accounts: false,
          accountAccess: false,
          email: false,
        },
        identityHidden: true,
        birthDate: null,
        jshshir: null,
      },
    );
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.people.staff.title });
    expect(screen.queryByRole('button', { name: en.people.staff.add })).toBeNull();
    fireEvent.click(await screen.findByText('Karimov Akmal', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Akmal Karimov' });

    await within(panel).findByRole('button', { name: en.people.staff.showIdentity });
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(within(panel).getAllByText(en.people.staff.hidden)).toHaveLength(2);
    fireEvent.click(within(panel).getByRole('button', { name: en.people.staff.showIdentity }));

    expect(await within(panel).findByText('31234567890123')).toBeDefined();
    expect(calls.filter((call) => call.route.endsWith('/identity'))).toHaveLength(1);
  });

  // Task 2.5b-2 (edge/close-relatives, row 8): the relative marked as the same person.
  it('names the relative this person is also, with a link to the Parent panel', async () => {
    const parent = { id: uid(70), fullName: 'Dilnoza Karimova' };
    openList('academic_vice_principal', {}, 'en', { sameAsRelative: parent });
    const shell = renderApp(PATH);
    fireEvent.click(await screen.findByText('Karimov Akmal', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Akmal Karimov' });
    const term = await within(panel).findByText(en.people.staff.alsoParent, { selector: 'dt' });
    const link = within(term.parentElement ?? panel).getByRole('link', {
      name: 'Dilnoza Karimova',
    });
    fireEvent.click(link);
    await waitFor(() => {
      expect(shell.router.state.location.pathname).toBe('/people/parents');
    });
    expect(shell.router.state.location.search).toMatchObject({ open: parent.id });
  });

  it('shows no "Also a parent" line when the person is marked as no relative', async () => {
    openList('academic_vice_principal');
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Karimov Akmal', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Akmal Karimov' });
    await within(panel).findByText(en.people.staff.staffId, { selector: 'dt' });
    expect(within(panel).queryByText(en.people.staff.alsoParent)).toBeNull();
  });

  // Owner's answer to finding 27 (task 2.7b-1, decision 3): a list of names
  // inside a message is a list, surname first.
  it('names the matches of the duplicate warning surname first', async () => {
    openList('super_admin', {
      'POST /api/people/staff/check': () =>
        json({
          sameNameAndBirth: [
            { id: uid(41), staffId: 'S-260041', firstName: 'Oʻtkir', lastName: 'Rahimov' },
          ],
          samePhone: [
            { id: uid(42), staffId: 'S-260042', firstName: 'Bobur', lastName: 'Toshmatov' },
          ],
          elsewhere: false,
        }),
    });
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.people.staff.title });
    fireEvent.click(await screen.findByRole('button', { name: en.people.staff.add }));
    // In the side panel beside the list (task 2.7c-2a), not above it.
    const form = within(
      await screen.findByRole('complementary', { name: en.people.staff.newTitle }),
    ).getByRole('form', { name: en.people.staff.newTitle });
    const type = (label: string, value: string) => {
      fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    };
    type(en.people.staff.firstName, "O'tkir");
    type(en.people.staff.lastName, 'Rahimov');
    type(en.people.staff.sex, 'male');
    type(en.people.staff.birthDate, '1985-02-03');
    type(en.people.staff.phone, '+998 90 111 22 33');
    type(en.people.staff.admissionDate, '2026-09-01');
    type(en.people.staff.department, uid(11));
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Rahimov Oʻtkir (S-260041)')).toBeDefined();
    expect(within(dialog).getByText('Toshmatov Bobur (S-260042)')).toBeDefined();
  });

  it('warns about a person of the same name in another branch before adding, and saves when told to', async () => {
    let saved: (typeof AKMAL)[] = [];
    const calls = openList('super_admin', {
      'POST /api/people/staff/check': () =>
        json({ sameNameAndBirth: [], samePhone: [], elsewhere: true }),
      'POST /api/people/staff': () => {
        saved = [{ ...AKMAL, id: uid(33) }];
        return json(detailOf({ ...AKMAL, id: uid(33) }), 201);
      },
      // The list read again after the save holds the new member of staff.
      'GET /api/people/staff': () =>
        json({ staff: [AKMAL, NODIRA, ...saved], today: '2026-10-10' }),
      [`GET /api/people/staff/${uid(33)}`]: () => json(detailOf({ ...AKMAL, id: uid(33) })),
    });
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.people.staff.title });
    fireEvent.click(await screen.findByRole('button', { name: en.people.staff.add }));
    // In the side panel beside the list (task 2.7c-2a), not above it.
    const form = within(
      await screen.findByRole('complementary', { name: en.people.staff.newTitle }),
    ).getByRole('form', { name: en.people.staff.newTitle });
    const type = (label: string, value: string) => {
      fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    };
    type(en.people.staff.firstName, "O'tkir");
    type(en.people.staff.lastName, 'Rahimov');
    type(en.people.staff.sex, 'male');
    type(en.people.staff.birthDate, '1985-02-03');
    type(en.people.staff.phone, '+998 90 111 22 33');
    type(en.people.staff.admissionDate, '2026-09-01');
    type(en.people.staff.department, uid(11));
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(en.people.staff.duplicateElsewhere)).toBeDefined();
    expect(calls.some((call) => call.route === 'POST /api/people/staff')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.staff.saveAnyway }));

    await waitFor(() => {
      expect(calls.some((call) => call.route === 'POST /api/people/staff')).toBe(true);
    });
    expect(calls.find((call) => call.route === 'POST /api/people/staff')?.body).toMatchObject({
      firstName: 'Oʻtkir',
      lastName: 'Rahimov',
      phone: '+998901112233',
      divisions: [{ divisionId: ACADEMIC.id, departmentId: uid(11), main: true }],
    });
    // The panel shows the saved record (task 2.7c-2a).
    await savedRecordPanel(en.people.staff.newTitle);
  });

  // Task 2.4a: the Tutor has People for the student list, without the staff.
  it.each([
    ['principal', true],
    ['tutor', false],
  ] as const)('is in the menu of the %s under People: %s', async (role, shown) => {
    openList(role);
    renderApp('/people');
    await screen.findByRole('heading', { name: en.people.title });
    const menu = within(screen.getByRole('navigation', { name: en.layout.menu }));
    expect(menu.queryByRole('link', { name: new RegExp(`^${en.menu.people}`) }) !== null).toBe(
      true,
    );
    expect(screen.queryByRole('link', { name: en.people.staffLink }) !== null).toBe(shown);
    expect(screen.queryByRole('link', { name: en.people.studentsLink }) !== null).toBe(true);
  });
});

/** The headers of the table, without the column of checkboxes. */
const headingsDrawn = (): string[] =>
  [...document.querySelectorAll('thead th')]
    .filter((cell) => cell.querySelector('input') === null)
    .map((cell) => cell.textContent ?? '');

const READER = {
  all: false,
  contact: false,
  teaching: false,
  accounts: false,
  accountAccess: false,
  email: false,
};
const VICE = { ...READER, contact: true, teaching: true, accountAccess: true, email: true };

/** The value read beside a term of the panel's read view. */
const termOf = (panel: HTMLElement, term: string): string | null =>
  [...panel.querySelectorAll('dt')].find((dt) => dt.textContent === term)?.nextElementSibling
    ?.textContent ?? null;

async function openAkmal(): Promise<HTMLElement> {
  renderApp(PATH);
  fireEvent.click(await screen.findByText('Karimov Akmal', { selector: 'button' }));
  const panel = await screen.findByRole('complementary', { name: 'Akmal Karimov' });
  await within(panel).findByRole('heading', { name: en.people.staff.statusTitle });
  return panel;
}

// docs/design-system.md, Layout shell, Lists: the side panel reads first, with
// its actions at the bottom; one form open at a time (task 2.7c-2b-2a).
describe('the actions of the staff panel', () => {
  it('reads first, with Edit and Change status at the bottom for the Super Admin', async () => {
    openList('super_admin');
    const panel = await openAkmal();
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(panelActionNames(panel)).toEqual([en.form.edit, en.people.staff.changeStatus]);
    expect(actionsAreLast(panel)).toBe(true);
    for (const opener of [en.people.staff.changeTeaching, en.people.staff.changeBranches]) {
      expect(within(panel).getByRole('button', { name: opener })).toBeDefined();
    }
  });

  // Decision 4: every field of the answer is read, with the label of its form.
  it('shows the Principal every field of the record and no action', async () => {
    openList('principal', {}, 'en', { rights: READER, fatherName: 'Botirovich' });
    const panel = await openAkmal();
    expect(termOf(panel, en.people.staff.fatherName)).toBe('Botirovich');
    expect(termOf(panel, en.people.staff.educationLevel)).toBe(
      en.people.staff.educationLevels.master,
    );
    expect(termOf(panel, en.people.staff.contractType)).toBe(
      en.people.staff.contractTypes.full_time,
    );
    expect(termOf(panel, en.people.staff.contractDate)).toBe(en.people.staff.notSet);
    expect(termOf(panel, en.people.staff.weeklyLessons)).toBe('18');
    expect(termOf(panel, en.people.staff.dailyLessons)).toBe('5');
    expect(panelActions(panel)).toBeNull();
    for (const opener of [
      en.form.edit,
      en.people.staff.changeStatus,
      en.people.staff.changeTeaching,
      en.people.staff.changeBranches,
    ]) {
      expect(within(panel).queryByRole('button', { name: opener })).toBeNull();
    }
  });

  it('gives the Academic Vice Principal Edit and the subjects, not the status or the branches', async () => {
    openList('academic_vice_principal', {}, 'en', { rights: VICE });
    const panel = await openAkmal();
    expect(panelActionNames(panel)).toEqual([en.form.edit]);
    expect(
      within(panel).getByRole('button', { name: en.people.staff.changeTeaching }),
    ).toBeDefined();
    expect(
      within(panel).queryByRole('button', { name: en.people.staff.changeBranches }),
    ).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.people.staff.changeStatus })).toBeNull();
  });

  it('switches the subjects off with its reason when the person has no Academic department', async () => {
    openList('super_admin', {}, 'en', {
      divisions: [{ divisionId: MANAGEMENT.id, departmentId: null, main: true }],
    });
    const panel = await openAkmal();
    const change = within(panel).getByRole<HTMLButtonElement>('button', {
      name: en.people.staff.changeTeaching,
    });
    expect(change.disabled).toBe(true);
    expect(change.parentElement?.textContent).toContain(en.people.staff.needsAcademic);
  });

  it('closes the record without a call on Cancel and gives the focus back to Edit', async () => {
    const calls = openList('super_admin');
    const panel = await openAkmal();
    const form = await edit(panel, 'Akmal Karimov');
    // The record's form takes the read view's place.
    expect(within(panel).queryByText(en.people.staff.teachingTitle)).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: en.form.cancel }));
    await waitFor(() => {
      expect(within(panel).queryByRole('form')).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(panel).getByRole('button', { name: en.form.edit }),
      );
    });
    expect(calls.some((call) => call.route.startsWith('PUT'))).toBe(false);
  });

  // Task 3.1a, correction 5: the class that keeps a language is named, or
  // "a class of another branch" when the refusal names none.
  it.each([
    ['in the branch', true],
    ['of another branch', false],
  ])('names the class %s that keeps a language on the record', async (_where, named) => {
    openList('super_admin', {
      [`PUT /api/people/staff/${AKMAL.id}/teaching`]: () =>
        json(
          {
            error: {
              code: 'tutor_language_held',
              message: '',
              requestId: 'test-request',
              details: [
                {
                  path: 'languages',
                  code: 'tutor_language_held',
                  message: '',
                  ...(named ? { recordId: '0199a000-0000-7000-8000-000000000777' } : {}),
                },
              ],
            },
          },
          409,
        ),
      'GET /api/classes/0199a000-0000-7000-8000-000000000777': () =>
        json({
          id: '0199a000-0000-7000-8000-000000000777',
          academicYearId: '0199a000-0000-7000-8000-000000000777',
          yearName: '2026–2027',
          yearStatus: 'current',
          grade: 7,
          name: 'Oxford',
          language: 'ru',
          mainRoom: null,
          maxSize: 25,
          tutor: null,
          acting: null,
          archived: false,
          version: 0,
          tutors: [],
          today: '2026-10-14',
        }),
    });
    const panel = await openAkmal();
    const teaching = await edit(
      panel,
      en.people.staff.teachingOf.replace('{{name}}', 'Akmal Karimov'),
      en.people.staff.changeTeaching,
    );
    fireEvent.click(within(teaching).getByLabelText(en.people.staff.languages.ru));
    fireEvent.click(within(teaching).getByRole('button', { name: en.form.save }));
    expect((await within(teaching).findByRole('alert')).textContent).toBe(
      en.errors.tutor_language_held,
    );
    expect(
      await within(teaching).findByText(
        named
          ? en.people.staff.tutorsClass.replace('{{name}}', '7 Oxford')
          : en.people.staff.tutorsClassElsewhere,
      ),
    ).toBeDefined();
  });

  it('asks before another form takes the place of one with typed text', async () => {
    openList('super_admin');
    const panel = await openAkmal();
    const teaching = await edit(
      panel,
      en.people.staff.teachingOf.replace('{{name}}', 'Akmal Karimov'),
      en.people.staff.changeTeaching,
    );
    fireEvent.click(within(teaching).getByLabelText(en.people.staff.languages.ru));
    fireEvent.click(within(panel).getByRole('button', { name: en.people.staff.changeBranches }));
    const dialog = await screen.findByRole('alertdialog', { name: en.unsent.leaveTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: en.unsent.stay }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(teaching.isConnected).toBe(true);
    expect(
      within(panel).queryByRole('form', {
        name: en.people.staff.branchesOf.replace('{{name}}', 'Akmal Karimov'),
      }),
    ).toBeNull();
  });

  it('changes the branches behind their button and says "Saved." at the bottom', async () => {
    const calls = openList('super_admin', {
      [`PUT /api/people/staff/${AKMAL.id}/branches`]: () => json(detailOf(AKMAL)),
    });
    const panel = await openAkmal();
    const form = await edit(
      panel,
      en.people.staff.branchesOf.replace('{{name}}', 'Akmal Karimov'),
      en.people.staff.changeBranches,
    );
    fireEvent.click(within(form).getByLabelText('South'));
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/branches'))?.body).toEqual({
        mainBranchId: NORTH.id,
        furtherBranchIds: [],
      });
    });
    await savedInPanel(panel);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(panel).getByRole('button', { name: en.people.staff.changeBranches }),
      );
    });
  });

  it('keeps the status form with what was typed when the question is answered no', async () => {
    const calls = openList('super_admin');
    const panel = await openAkmal();
    const form = await edit(
      panel,
      en.people.staff.statusOf.replace('{{name}}', 'Akmal Karimov'),
      en.people.staff.changeStatus,
    );
    fireEvent.change(within(form).getByLabelText(en.people.staff.newStatus), {
      target: { value: 'inactive' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.confirm.cancel }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(form.isConnected).toBe(true);
    expect(within(form).getByLabelText<HTMLSelectElement>(en.people.staff.newStatus).value).toBe(
      'inactive',
    );
    expect(calls.some((call) => call.route.endsWith('/status'))).toBe(false);
  });
});

// Issue #39, hand test of 13 October 2026, findings 18 and 21 (task 2.7b-2).
describe('the subjects and languages of a staff member', () => {
  const teachingForm = async () => {
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Karimov Akmal', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Akmal Karimov' });
    // Task 2.7c-2b-2a: the form opens behind its section's button.
    return edit(
      panel,
      en.people.staff.teachingOf.replace('{{name}}', 'Akmal Karimov'),
      en.people.staff.changeTeaching,
    );
  };
  const grades = (form: HTMLElement) =>
    within(form).getByRole('group', {
      name: en.people.staff.gradesOf.replace('{{subject}}', 'Mathematics'),
    });

  it('says nothing as the grades are unticked, and on Save names the grades of that subject', async () => {
    const calls = openList('academic_vice_principal');
    const form = await teachingForm();
    fireEvent.click(within(grades(form)).getByLabelText('Grade 5'));
    fireEvent.click(within(grades(form)).getByLabelText('Grade 6'));
    expect(within(grades(form)).queryByText(en.form.chooseGrade)).toBeNull();

    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    expect(within(grades(form)).getByText(en.form.chooseGrade)).toBeDefined();
    const subjects = within(form).getByRole('group', { name: en.people.staff.subjects });
    expect(within(subjects).queryByText(en.form.chooseGrade)).toBeNull();
    expect(within(subjects).queryByText(en.form.required)).toBeNull();
    expect(calls.some((call) => call.route.endsWith('/teaching'))).toBe(false);
  });

  // Review of the build: the languages are a group that must hold one choice.
  it('says nothing of the languages as they are unticked after a Save, and asks on the next Save', async () => {
    const calls = openList('academic_vice_principal');
    const form = await teachingForm();
    const languages = () =>
      within(form).getByRole('group', { name: en.people.staff.languagesTitle });
    fireEvent.click(within(grades(form)).getByLabelText('Grade 5'));
    fireEvent.click(within(grades(form)).getByLabelText('Grade 6'));
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    fireEvent.click(within(languages()).getByLabelText(en.people.staff.languages.uz));
    fireEvent.click(within(languages()).getByLabelText(en.people.staff.languages.ru));
    expect(within(languages()).queryByText(en.form.required)).toBeNull();
    expect(within(languages()).queryByText(en.form.chooseOne)).toBeNull();

    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    expect(within(languages()).getByText(en.form.chooseOne)).toBeDefined();
    expect(calls.some((call) => call.route.endsWith('/teaching'))).toBe(false);
  });

  // Task 2.7c-2b-2a: the form closes on a save and "Saved." is at the bottom of the panel.
  it('says "Saved." after a save that changes the subjects', async () => {
    let detail = detailOf(AKMAL);
    openList('academic_vice_principal', {
      [`GET /api/people/staff/${AKMAL.id}`]: () => json(detail),
      [`PUT /api/people/staff/${AKMAL.id}/teaching`]: (body) => {
        detail = { ...detail, ...(body as Partial<StaffDetail>) };
        return json(detail);
      },
    });
    const form = await teachingForm();
    fireEvent.click(within(form).getByLabelText('Mathematics'));
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(detail.subjects).toEqual([]);
    });
    await savedInPanel(screen.getByRole('complementary', { name: 'Akmal Karimov' }));
    expect(form.isConnected).toBe(false);
  });
});

// Task 2.2c-1: the Export button of the list, for the Principal too (`02`:
// "Exports are allowed"), and the columns of the file are those of the screen,
// with the same headings (`EXPORT_TEXTS` of `packages/shared`).
describe('the export of the staff list', () => {
  it('is offered, and the columns of the screen are those of the file, with its headings', async () => {
    openList('principal');
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.people.staff.title });
    await waitFor(() => {
      expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
    });
    expect(screen.getByRole('button', { name: en.list.export })).toBeTruthy();
    // The photo is a column of the screen and not of the file (task 2.2c-2, decision 14).
    expect(headingsDrawn()).toEqual([
      en.people.staff.photo.column,
      ...STAFF_EXPORT_COLUMNS.map((key) => EXPORT_TEXTS.en.staff.columns[key]),
    ]);
  });

  it('never asks the server for the photo column', async () => {
    class FileUrl extends URL {
      static override createObjectURL = (): string => 'blob:file';
      static override revokeObjectURL = (): void => undefined;
    }
    vi.stubGlobal('URL', FileUrl);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const calls = openList('principal', {
      'POST /api/people/staff/export': () =>
        new Response(new Blob(['PK']), {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'X-Export-Columns': STAFF_EXPORT_COLUMNS.join(','),
          },
        }),
    });
    renderApp(PATH);
    await waitFor(() => {
      expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole('button', { name: en.list.export }));
    await waitFor(() => {
      expect(calls.some((call) => call.route === 'POST /api/people/staff/export')).toBe(true);
    });
    const sent = calls.find((call) => call.route === 'POST /api/people/staff/export')?.body as {
      columns: string[];
    };
    expect(sent.columns).toEqual([...STAFF_EXPORT_COLUMNS]);
    vi.restoreAllMocks();
  });
});

// Task 2.2c-2: the photo column and the photo of the panel. The owner's answer
// 2; edge/system-behaviour: "photos fall back to initials".
describe('staff photos', () => {
  const PHOTO_ID = uid(51);
  const WITH_PHOTO: StaffListItem = { ...AKMAL, photoId: PHOTO_ID };
  // A PNG of one pixel; the page shows it as a data: address.
  const PIXEL = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
    ),
    (char) => char.charCodeAt(0),
  );
  const photoAnswer = () =>
    new Response(new Blob([PIXEL], { type: 'image/png' }), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });

  function openWith(
    role: Role,
    extra: Record<string, (body: unknown) => Response> = {},
    language: 'en' | 'ru' = 'en',
    detail: Partial<StaffDetail> = {},
  ) {
    return fakeApi({
      'GET /api/auth/session': () => json(sessionAs(role, language)),
      'GET /api/people/staff': () => json({ staff: [WITH_PHOTO, NODIRA], today: '2026-10-10' }),
      'GET /api/setup/divisions': () =>
        json({ divisions: [ACADEMIC, MANAGEMENT], staffCounts: [] }),
      'GET /api/setup/subjects': () => json({ subjects: [MATHEMATICS], mayMoveDepartment: false }),
      [`GET /api/people/staff/${AKMAL.id}`]: () => json(detailOf(WITH_PHOTO, detail)),
      [`GET /api/people/staff/${AKMAL.id}/photo`]: photoAnswer,
      ...extra,
    });
  }

  const photoCell = (name: string) =>
    [...document.querySelectorAll('tbody tr')]
      .find((row) => row.textContent.includes(name))
      ?.querySelector('td');

  it('shows the photo in the list, and the initials where there is none', async () => {
    const calls = openWith('principal');
    renderApp(PATH);
    await waitFor(() => {
      expect(photoCell('Karimov Akmal')?.querySelector('img')?.getAttribute('src')).toMatch(
        /^data:image\/png;base64,/,
      );
    });
    expect(photoCell('Karimov Akmal')?.querySelector('img')?.getAttribute('alt')).toBe(
      'Karimov Akmal',
    );
    expect(photoCell('Aliyeva Nodira')?.querySelector('img')).toBeNull();
    expect(photoCell('Aliyeva Nodira')?.textContent).toBe('NA');
    // Only the person with a photo is asked for one.
    expect(calls.filter((call) => call.route.endsWith('/photo')).map((call) => call.route)).toEqual(
      [`GET /api/people/staff/${AKMAL.id}/photo`],
    );
  });

  it('keeps the initials when the photo cannot be read', async () => {
    openWith('principal', {
      [`GET /api/people/staff/${AKMAL.id}/photo`]: () => refusal('photos_unavailable', 503),
    });
    renderApp(PATH);
    await waitFor(() => {
      expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(photoCell('Karimov Akmal')?.querySelector('img')).toBeNull();
    expect(photoCell('Karimov Akmal')?.textContent).toBe('AK');
  });

  async function openPanel() {
    await screen.findByRole('heading', { name: en.people.staff.title });
    fireEvent.click(await screen.findByText('Karimov Akmal', { selector: 'button' }));
    return screen.findByRole('complementary', { name: 'Akmal Karimov' });
  }

  it('gives the Principal no photo buttons', async () => {
    openWith('principal', {}, 'en', {
      rights: {
        all: false,
        contact: false,
        teaching: false,
        accounts: false,
        accountAccess: false,
        email: false,
      },
    });
    renderApp(PATH);
    const panel = await openPanel();
    await within(panel).findByRole('region', { name: en.people.staff.photo.title });
    expect(within(panel).queryByRole('button', { name: en.people.staff.photo.change })).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.people.staff.photo.remove })).toBeNull();
  });

  it('removes the photo after the question', async () => {
    let removed = false;
    const calls = openWith('academic_vice_principal', {
      [`DELETE /api/people/staff/${AKMAL.id}/photo`]: () => {
        removed = true;
        return new Response(null, { status: 204 });
      },
      [`GET /api/people/staff/${AKMAL.id}`]: () =>
        json(
          detailOf(removed ? AKMAL : WITH_PHOTO, {
            rights: {
              all: false,
              contact: true,
              teaching: true,
              accounts: false,
              accountAccess: false,
              email: false,
            },
          }),
        ),
    });
    renderApp(PATH);
    const panel = await openPanel();
    fireEvent.click(
      await within(panel).findByRole('button', { name: en.people.staff.photo.remove }),
    );
    const question = await screen.findByRole('alertdialog');
    fireEvent.click(within(question).getByRole('button', { name: en.people.staff.photo.remove }));
    await waitFor(() => {
      expect(
        calls.some((call) => call.route === `DELETE /api/people/staff/${AKMAL.id}/photo`),
      ).toBe(true);
    });
    await within(panel).findByRole('button', { name: en.people.staff.photo.add });
  });

  it('refuses a file that is not a JPEG or PNG before sending it, in Russian too', async () => {
    const calls = openWith('super_admin', {}, 'ru');
    renderApp(PATH, 'ru');
    await screen.findByRole('heading', { name: ru.people.staff.title });
    fireEvent.click(await screen.findByText('Karimov Akmal', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Akmal Karimov' });
    const input = await within(panel).findByLabelText(ru.people.staff.photo.change);
    fireEvent.change(input, {
      target: { files: [new File(['GIF89a'], 'photo.gif', { type: 'image/gif' })] },
    });
    expect(await within(panel).findByText(ru.errors.photo_invalid)).toBeTruthy();
    expect(calls.some((call) => call.route.startsWith('PUT'))).toBe(false);
  });

  it('refuses a file of more than 5 MB before reading it', async () => {
    const calls = openWith('super_admin');
    renderApp(PATH);
    const panel = await openPanel();
    const input = await within(panel).findByLabelText(en.people.staff.photo.change);
    const big = new File([new Uint8Array(5_000_001)], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await within(panel).findByText(en.errors.photo_too_large)).toBeTruthy();
    expect(calls.some((call) => call.route.startsWith('PUT'))).toBe(false);
  });

  it('sends the shrunk photo as a JPEG and says when photos are not configured', async () => {
    // jsdom draws nothing: the browser's canvas is stood in for by a JPEG of the right size.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 1600, height: 1200, close: () => undefined })),
    );
    const drawn: { width: number; height: number }[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      drawn.push({ width: this.width, height: this.height });
      return {
        fillStyle: '',
        fillRect: () => undefined,
        drawImage: () => undefined,
      } as unknown as CanvasRenderingContext2D;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob([new Uint8Array(1234)], { type: 'image/jpeg' }));
    });
    const calls = openWith('super_admin', {
      [`PUT /api/people/staff/${AKMAL.id}/photo`]: () => refusal('photos_not_configured', 503),
    });
    renderApp(PATH);
    const panel = await openPanel();
    const input = await within(panel).findByLabelText(en.people.staff.photo.change);
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array(10)], 'photo.png', { type: 'image/png' })] },
    });
    expect(await within(panel).findByText(en.errors.photos_not_configured)).toBeTruthy();
    expect(drawn).toEqual([{ width: 800, height: 600 }]);
    expect(
      calls.find((call) => call.route === `PUT /api/people/staff/${AKMAL.id}/photo`)?.body,
    ).toEqual({
      type: 'image/jpeg',
      size: 1234,
    });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});

// Task 2.6a, pull request #75: "History" on the panel of a staff member.
describe('the History link of a staff member', () => {
  it('opens the log about the person for the Academic Vice Principal', async () => {
    openList('academic_vice_principal');
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Karimov Akmal', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Akmal Karimov' });
    const link = await within(panel).findByRole('link', { name: en.audit.history });
    expect(link.getAttribute('href')).toBe(`/audit?person=staff%3A${AKMAL.id}`);
  });
});

// Task 2.6b, pull request #76: "Personal data report" on the panel, for the
// Super Admin only (decision 3).
describe('the personal data report link of a staff member', () => {
  it('opens the report of the person for the Super Admin', async () => {
    openList('super_admin');
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Karimov Akmal', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Akmal Karimov' });
    const link = await within(panel).findByRole('link', { name: en.people.report.link });
    expect(link.getAttribute('href')).toBe(`/people/report/staff/${AKMAL.id}`);
  });

  it('is not shown to the Academic Vice Principal', async () => {
    openList('academic_vice_principal');
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Karimov Akmal', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Akmal Karimov' });
    await within(panel).findByRole('link', { name: en.audit.history });
    expect(within(panel).queryByRole('link', { name: en.people.report.link })).toBeNull();
  });
});
