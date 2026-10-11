import type { Division, Role, StaffDetail, StaffListItem, Subject } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf, SOUTH } from '@/testing/render-app';

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
  rights: { all: true, contact: true, teaching: true },
  today: '2026-10-10',
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
        'Akmal Karimov',
        'S-260001',
        en.roles.teacher,
        'North, South',
        'STEAM',
        'Mathematics',
        `${en.setup.subjects.grade.replace('{{grade}}', '5')}, ${en.setup.subjects.grade.replace('{{grade}}', '6')}`,
        `${en.people.staff.languages.uz}, ${en.people.staff.languages.ru}`,
        '+998901234567',
        en.people.staff.statuses.active,
      ],
      [
        'Nodira Aliyeva',
        'S-260002',
        '',
        'North',
        '',
        '',
        '',
        '',
        '+998907654321',
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

  it('filters by status and finds a person by staff ID', async () => {
    openList('super_admin');
    renderApp(`${PATH}?f=${encodeURIComponent(JSON.stringify({ status: 'active' }))}`);
    await screen.findByRole('heading', { name: en.people.staff.title });
    await waitFor(() => {
      expect(rowsDrawn().map((row) => row[0])).toEqual(['Akmal Karimov']);
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
        return json(after);
      },
      [`GET /api/people/staff/${AKMAL.id}`]: () => json(saved ? after : detailOf(AKMAL)),
    });
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.people.staff.title });
    fireEvent.click(await screen.findByText('Akmal Karimov', { selector: 'button' }));

    const panel = await screen.findByRole('complementary', { name: 'Akmal Karimov' });
    const status = await within(panel).findByRole('form', {
      name: en.people.staff.statusOf.replace('{{name}}', 'Akmal Karimov'),
    });
    fireEvent.change(within(status).getByLabelText(en.people.staff.newStatus), {
      target: { value: 'left' },
    });
    fireEvent.change(within(status).getByLabelText(en.people.staff.from), {
      target: { value: '2026-10-30' },
    });
    fireEvent.click(within(status).getByRole('button', { name: en.form.save }));

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
  });

  it('lets the Academic Vice Principal change only name, phone and email of the record', async () => {
    openList('academic_vice_principal', {}, 'en', {
      rights: { all: false, contact: true, teaching: true },
    });
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.people.staff.title });
    fireEvent.click(await screen.findByText('Akmal Karimov', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Akmal Karimov' });
    const record = await within(panel).findByRole('form', { name: 'Akmal Karimov' });

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
    // No status form, no branches form.
    expect(within(panel).queryByLabelText(en.people.staff.newStatus)).toBeNull();
    expect(within(panel).queryByLabelText(en.people.staff.mainBranchField)).toBeNull();
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
        rights: { all: false, contact: false, teaching: false },
        identityHidden: true,
        birthDate: null,
        jshshir: null,
      },
    );
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.people.staff.title });
    expect(screen.queryByRole('button', { name: en.people.staff.add })).toBeNull();
    fireEvent.click(await screen.findByText('Akmal Karimov', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Akmal Karimov' });

    await within(panel).findByRole('button', { name: en.people.staff.showIdentity });
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(within(panel).getAllByText(en.people.staff.hidden)).toHaveLength(2);
    fireEvent.click(within(panel).getByRole('button', { name: en.people.staff.showIdentity }));

    expect(await within(panel).findByText('31234567890123')).toBeDefined();
    expect(calls.filter((call) => call.route.endsWith('/identity'))).toHaveLength(1);
  });

  it('warns about a person of the same name in another branch before adding, and saves when told to', async () => {
    const calls = openList('super_admin', {
      'POST /api/people/staff/check': () =>
        json({ sameNameAndBirth: [], samePhone: [], elsewhere: true }),
      'POST /api/people/staff': () => json(detailOf({ ...AKMAL, id: uid(33) }), 201),
    });
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.people.staff.title });
    fireEvent.click(await screen.findByRole('button', { name: en.people.staff.add }));
    const form = await screen.findByRole('form', { name: en.people.staff.newTitle });
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
  });

  it.each([
    ['principal', true],
    ['tutor', false],
  ] as const)('is in the menu of the %s under People: %s', async (role, shown) => {
    openList(role);
    renderApp('/people');
    await screen.findByRole('heading', { name: en.people.title });
    const menu = within(screen.getByRole('navigation', { name: en.layout.menu }));
    expect(menu.queryByRole('link', { name: new RegExp(`^${en.menu.people}`) }) !== null).toBe(
      shown,
    );
    expect(screen.queryByRole('link', { name: en.people.staffLink }) !== null).toBe(shown);
  });
});
