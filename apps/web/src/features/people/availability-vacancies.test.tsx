import type {
  Availability,
  Division,
  Role,
  StaffDetail,
  StaffListItem,
  Subject,
  VacancyDetail,
  VacancyListItem,
} from '@sodiq/shared';
import { EXPORT_TEXTS, VACANCY_EXPORT_COLUMNS } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  actionsAreLast,
  edit,
  panelActionNames,
  panelActions,
  savedInPanel,
} from '@/testing/panel';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import {
  fakeApi,
  json,
  NORTH,
  nothing,
  refusal,
  renderApp,
  sessionOf,
  SOUTH,
} from '@/testing/render-app';
import { savedRecordPanel } from '@/testing/new-record';

const uid = (n: number): string => `0199c000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const ACADEMIC: Division = {
  id: uid(1),
  names: { uz: 'Oʻquv boʻlimi', ru: 'Учебный отдел', en: 'Academic' },
  builtIn: true,
  archivedAt: null,
  departments: [
    { id: uid(11), names: { uz: 'STEAM', ru: 'STEAM', en: 'STEAM' }, archivedAt: null },
  ],
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
  languages: ['uz'],
  phone: '+998901234567',
  status: 'active',
  planned: null,
  photoId: null,
};

const AKMAL_DETAIL: StaffDetail = {
  ...AKMAL,
  sex: 'male',
  birthDate: '1990-05-06',
  jshshir: null,
  identityHidden: false,
  educationLevel: null,
  email: null,
  admissionDate: '2026-09-01',
  contractType: null,
  contractDate: null,
  weeklyLessons: null,
  dailyLessons: null,
  statuses: [{ id: uid(41), status: 'active', from: '2026-09-01', until: null }],
  rights: {
    all: false,
    contact: true,
    teaching: true,
    accounts: false,
    accountAccess: false,
    email: true,
  },
  today: '2026-10-10',
  sameAsRelative: null,
};

const HOURS: Availability = {
  entries: [
    {
      id: uid(51),
      from: '2026-09-01',
      until: null,
      ranges: [{ weekday: 1, start: '08:00', end: '13:00' }],
    },
  ],
  elsewhere: [
    {
      branchId: SOUTH.id,
      name: 'South',
      entries: [
        {
          id: uid(52),
          from: '2026-09-01',
          until: null,
          ranges: [{ weekday: 2, start: '14:00', end: '17:00' }],
        },
      ],
    },
  ],
  today: '2026-10-10',
  earliestFrom: '2026-10-11',
};

const BRANCH = {
  id: NORTH.id,
  name: 'North',
  address: null,
  phone: null,
  email: null,
  workingWeekdays: [1, 2, 3, 4, 5],
  timeZone: 'Asia/Tashkent',
  goLiveDate: null,
};

const OPEN: VacancyListItem = {
  id: uid(61),
  name: 'English vacancy 2',
  departmentId: uid(11),
  subjects: [{ subjectId: MATHEMATICS.id, grades: [7] }],
  languages: ['uz'],
  weeklyLessons: 18,
  dailyLessons: 6,
  status: 'open',
};

const CLOSED: VacancyListItem = {
  ...OPEN,
  id: uid(62),
  name: 'Physics vacancy 1',
  status: 'closed',
};

const vacancyDetail = (row: VacancyListItem): VacancyDetail => ({
  ...row,
  statuses: [{ id: uid(71), status: row.status, from: '2026-10-01', until: null }],
  today: '2026-10-10',
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

function api(
  role: Role,
  extra: Record<string, (body: unknown) => Response> = {},
  language: 'en' | 'ru' = 'en',
) {
  return fakeApi({
    'GET /api/auth/session': () => json(sessionAs(role, language)),
    'GET /api/people/staff': () => json({ staff: [AKMAL], today: '2026-10-10' }),
    'GET /api/people/vacancies': () => json({ vacancies: [OPEN, CLOSED], today: '2026-10-10' }),
    'GET /api/setup/divisions': () => json({ divisions: [ACADEMIC], staffCounts: [] }),
    'GET /api/setup/subjects': () => json({ subjects: [MATHEMATICS], mayMoveDepartment: false }),
    'GET /api/setup/branch': () => json(BRANCH),
    [`GET /api/people/staff/${AKMAL.id}`]: () => json(AKMAL_DETAIL),
    [`GET /api/people/staff/${AKMAL.id}/availability`]: () => json(HOURS),
    [`GET /api/people/vacancies/${OPEN.id}`]: () => json(vacancyDetail(OPEN)),
    ...extra,
  });
}

async function openAkmal() {
  renderApp('/people/staff');
  await screen.findByRole('heading', { name: en.people.staff.title });
  fireEvent.click(await screen.findByText('Karimov Akmal', { selector: 'button' }));
  const panel = await screen.findByRole('complementary', { name: 'Akmal Karimov' });
  await within(panel).findByRole('heading', { name: en.people.availability.title });
  return panel;
}

// docs/spec/04-people.md (Availability, Vacancy); 06, Teachers who work in
// several branches; task 2.2b.
describe('availability', () => {
  it('shows the hours of the branch and the other branches read only', async () => {
    api('academic_vice_principal');
    const panel = await openAkmal();
    expect(await within(panel).findByText('08:00–13:00')).toBeDefined();
    expect(
      within(panel).getByRole('heading', {
        name: en.people.availability.elsewhere.replace('{{name}}', 'South'),
      }),
    ).toBeDefined();
    expect(within(panel).getByText('14:00–17:00')).toBeDefined();
    expect(
      within(panel).getByRole('button', { name: en.people.availability.change }),
    ).toBeDefined();
  });

  it('sends a new week from a date', async () => {
    const calls = api('academic_vice_principal', {
      [`PUT /api/people/staff/${AKMAL.id}/availability`]: () => json(HOURS),
    });
    const panel = await openAkmal();
    fireEvent.click(
      await within(panel).findByRole('button', { name: en.people.availability.change }),
    );
    const form = await within(panel).findByRole('form', {
      name: en.people.availability.changeOf.replace('{{name}}', 'Akmal Karimov'),
    });
    expect(within(form).getByLabelText<HTMLInputElement>('Monday').value).toBe('08:00–13:00');
    fireEvent.change(within(form).getByLabelText('Tuesday'), {
      target: { value: '09:00-12:00, 13:00–15:00' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.some((call) => call.route.startsWith('PUT'))).toBe(true);
    });
    expect(calls.find((call) => call.route.startsWith('PUT'))?.body).toEqual({
      from: '2026-10-11',
      ranges: [
        { weekday: 1, start: '08:00', end: '13:00' },
        { weekday: 2, start: '09:00', end: '12:00' },
        { weekday: 2, start: '13:00', end: '15:00' },
      ],
    });
    // Issue #39, hand test of 13 October 2026, finding 18: the form closes, and
    // "Saved." stands until the next change starts; task 2.7c-2b-2a: at the
    // bottom of the panel, and the focus is back on the button.
    await savedInPanel(panel);
    const change = within(panel).getByRole('button', { name: en.people.availability.change });
    await waitFor(() => {
      expect(document.activeElement).toBe(change);
    });
    fireEvent.click(change);
    await within(panel).findByRole('form', {
      name: en.people.availability.changeOf.replace('{{name}}', 'Akmal Karimov'),
    });
    expect(panelActions(panel)).toBeNull();
    expect(
      within(panel)
        .queryAllByRole('status')
        .some((status) => status.textContent === en.form.saved && !status.closest('form')),
    ).toBe(false);
  });

  it('says what to fix before sending, and names the weekdays of an overlap', async () => {
    const calls = api('academic_vice_principal', {
      [`PUT /api/people/staff/${AKMAL.id}/availability`]: () =>
        Response.json(
          {
            error: {
              code: 'availability_overlap',
              message: 'ENGLISH TEXT FOR THE DEVELOPER',
              requestId: 'test-request',
              details: [{ path: 'weekday.2', code: 'overlap', message: 'x' }],
            },
          },
          { status: 409 },
        ),
    });
    const panel = await openAkmal();
    fireEvent.click(
      await within(panel).findByRole('button', { name: en.people.availability.change }),
    );
    const form = await within(panel).findByRole('form', {
      name: en.people.availability.changeOf.replace('{{name}}', 'Akmal Karimov'),
    });
    fireEvent.change(within(form).getByLabelText('Tuesday'), { target: { value: '15:00-14:00' } });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(within(form).getByLabelText('Tuesday').getAttribute('aria-invalid')).toBe('true');
    });
    expect(calls.some((call) => call.route.startsWith('PUT'))).toBe(false);
    fireEvent.change(within(form).getByLabelText('Tuesday'), { target: { value: '14:00-16:00' } });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(await within(panel).findByText(en.errors.availability_overlap)).toBeDefined();
    expect(
      within(panel).getByText(en.people.availability.overlapDays.replace('{{days}}', 'Tuesday')),
    ).toBeDefined();
  });

  // Task 2.7c-2b-2a: Cancel of RecordForm asks about typed text, closes the
  // form without a call and takes the refusal of the last change away.
  it('closes the change on Cancel after asking, with no call and no refusal left', async () => {
    const calls = api('academic_vice_principal', {
      [`PUT /api/people/staff/${AKMAL.id}/availability`]: () =>
        Response.json(
          {
            error: {
              code: 'availability_overlap',
              message: 'ENGLISH TEXT FOR THE DEVELOPER',
              requestId: 'test-request',
              details: [{ path: 'weekday.2', code: 'overlap', message: 'x' }],
            },
          },
          { status: 409 },
        ),
    });
    const panel = await openAkmal();
    fireEvent.click(
      await within(panel).findByRole('button', { name: en.people.availability.change }),
    );
    const form = await within(panel).findByRole('form', {
      name: en.people.availability.changeOf.replace('{{name}}', 'Akmal Karimov'),
    });
    fireEvent.change(within(form).getByLabelText('Tuesday'), { target: { value: '14:00-16:00' } });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(await within(panel).findByText(en.errors.availability_overlap)).toBeDefined();

    fireEvent.click(within(form).getByRole('button', { name: en.form.cancel }));
    const dialog = await screen.findByRole('alertdialog', { name: en.unsent.leaveTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: en.unsent.leave }));
    await waitFor(() => {
      expect(form.isConnected).toBe(false);
    });
    expect(within(panel).queryByText(en.errors.availability_overlap)).toBeNull();
    expect(
      within(panel).queryByText(en.people.availability.overlapDays.replace('{{days}}', 'Tuesday')),
    ).toBeNull();
    expect(panelActions(panel)?.textContent ?? '').not.toContain(en.form.saved);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(panel).getByRole('button', { name: en.people.availability.change }),
      );
    });
    expect(calls.filter((call) => call.route.startsWith('PUT'))).toHaveLength(1);
  });

  it('gives the Principal no change', async () => {
    api('principal');
    const panel = await openAkmal();
    expect(await within(panel).findByText('08:00–13:00')).toBeDefined();
    expect(within(panel).queryByRole('button', { name: en.people.availability.change })).toBeNull();
  });
});

describe('the vacancies', () => {
  it('are a section of the teacher list, open ones first', async () => {
    api('academic_vice_principal');
    renderApp('/people/staff');
    await screen.findByRole('heading', { name: en.people.staff.title });
    const tabs = screen.getByRole('navigation', { name: en.people.sections });
    fireEvent.click(within(tabs).getByRole('link', { name: en.people.vacancies.title }));
    await screen.findByRole('heading', { name: en.people.vacancies.title });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    expect(rowsDrawn()[0]).toEqual([
      'English vacancy 2',
      'STEAM',
      'Mathematics',
      // Grades as ranges (finding 19).
      '7',
      en.people.staff.languages.uz,
      '18',
      en.people.vacancies.statuses.open,
    ]);
    expect(rowsDrawn()[1]?.at(-1)).toBe(en.people.vacancies.statuses.closed);
  });

  it('names the statuses in Russian when Russian is chosen', async () => {
    api('academic_vice_principal', {}, 'ru');
    renderApp('/people/vacancies', 'ru');
    await screen.findByRole('heading', { name: ru.people.vacancies.title });
    await waitFor(() => {
      expect(rowsDrawn().map((row) => row.at(-1))).toEqual([
        ru.people.vacancies.statuses.open,
        ru.people.vacancies.statuses.closed,
      ]);
    });
  });

  it('are added by the Academic Vice Principal with nothing personal', async () => {
    const calls = api('academic_vice_principal', {
      'POST /api/people/vacancies': () => json(vacancyDetail(OPEN), 201),
    });
    renderApp('/people/vacancies');
    const add = await screen.findByRole('button', { name: en.people.vacancies.add });
    await waitFor(() => {
      expect((add as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(add);
    // In the side panel beside the list (task 2.7c-2a), not above it.
    const form = within(
      await screen.findByRole('complementary', { name: en.people.vacancies.newTitle }),
    ).getByRole('form', { name: en.people.vacancies.newTitle });
    fireEvent.change(within(form).getByLabelText(en.people.vacancies.name), {
      target: { value: 'Mathematics vacancy 1' },
    });
    fireEvent.change(within(form).getByLabelText(en.people.vacancies.department), {
      target: { value: uid(11) },
    });
    fireEvent.click(await within(form).findByLabelText('Mathematics'));
    fireEvent.click(
      await within(form).findByLabelText(en.setup.subjects.grade.replace('{{grade}}', '7')),
    );
    fireEvent.click(within(form).getByLabelText(en.people.staff.languages.ru));
    fireEvent.change(within(form).getByLabelText(en.people.staff.weeklyLessons), {
      target: { value: '12' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.some((call) => call.route === 'POST /api/people/vacancies')).toBe(true);
    });
    expect(calls.find((call) => call.route === 'POST /api/people/vacancies')?.body).toEqual({
      name: 'Mathematics vacancy 1',
      departmentId: uid(11),
      subjects: [{ subjectId: MATHEMATICS.id, grades: [7] }],
      languages: ['ru'],
      weeklyLessons: 12,
      dailyLessons: null,
    });
    // The panel shows the saved record (task 2.7c-2a).
    await savedRecordPanel(en.people.vacancies.newTitle);
  });

  // Issue #39, hand test of 13 October 2026, finding 21 (task 2.7b-2).
  it('say nothing as a subject is ticked, and on Save ask for a grade under that subject', async () => {
    const calls = api('academic_vice_principal');
    renderApp('/people/vacancies');
    const add = await screen.findByRole('button', { name: en.people.vacancies.add });
    await waitFor(() => {
      expect((add as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(add);
    // In the side panel beside the list (task 2.7c-2a), not above it.
    const form = within(
      await screen.findByRole('complementary', { name: en.people.vacancies.newTitle }),
    ).getByRole('form', { name: en.people.vacancies.newTitle });
    fireEvent.change(within(form).getByLabelText(en.people.vacancies.name), {
      target: { value: 'Mathematics vacancy 1' },
    });
    fireEvent.change(within(form).getByLabelText(en.people.vacancies.department), {
      target: { value: uid(11) },
    });
    fireEvent.click(await within(form).findByLabelText('Mathematics'));
    const grades = within(form).getByRole('group', {
      name: en.people.staff.gradesOf.replace('{{subject}}', 'Mathematics'),
    });
    expect(within(form).queryByText(en.form.chooseGrade)).toBeNull();
    expect(within(form).queryByText(en.form.required)).toBeNull();

    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    expect(within(grades).getByText(en.form.chooseGrade)).toBeDefined();
    const subjects = within(form).getByRole('group', { name: en.people.vacancies.subjects });
    expect(within(subjects).queryByText(en.form.chooseGrade)).toBeNull();
    expect(calls.some((call) => call.route === 'POST /api/people/vacancies')).toBe(false);
  });

  it('give the Principal no add, form, close or delete', async () => {
    api('principal');
    renderApp(`/people/vacancies?open=${OPEN.id}`);
    const panel = await screen.findByRole('complementary', { name: OPEN.name });
    await within(panel).findByRole('heading', { name: en.people.vacancies.statusTitle });
    expect(screen.queryByRole('button', { name: en.people.vacancies.add })).toBeNull();
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.people.vacancies.close })).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.people.vacancies.delete })).toBeNull();
    // Task 2.7c-2b-2a: the record is read, with no row of actions at the bottom.
    expect(panelActions(panel)).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.form.edit })).toBeNull();
  });

  // Task 2.7c-2b-2a: the record reads first; Edit opens its form, Cancel closes it.
  it('are changed behind Edit, with "Saved." at the bottom, and closed without a call on Cancel', async () => {
    const calls = api('academic_vice_principal', {
      [`PUT /api/people/vacancies/${OPEN.id}`]: () => json(vacancyDetail(OPEN)),
    });
    renderApp(`/people/vacancies?open=${OPEN.id}`);
    const panel = await screen.findByRole('complementary', { name: OPEN.name });
    await within(panel).findByRole('heading', { name: en.people.vacancies.statusTitle });
    expect(within(panel).queryByRole('form')).toBeNull();
    let form = await edit(panel, OPEN.name);
    fireEvent.click(within(form).getByRole('button', { name: en.form.cancel }));
    await waitFor(() => {
      expect(within(panel).queryByRole('form')).toBeNull();
    });
    expect(calls.some((call) => call.route.startsWith('PUT'))).toBe(false);

    form = await edit(panel, OPEN.name);
    fireEvent.change(within(form).getByLabelText(en.people.staff.weeklyLessons), {
      target: { value: '14' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        (calls.find((call) => call.route.startsWith('PUT'))?.body as { weeklyLessons: number })
          .weeklyLessons,
      ).toBe(14);
    });
    await savedInPanel(panel);
    expect(actionsAreLast(panel)).toBe(true);
  });

  it('show a refused close inside the row of actions, without the "Saved." of an earlier save', async () => {
    api('academic_vice_principal', {
      [`PUT /api/people/vacancies/${OPEN.id}`]: () => json(vacancyDetail(OPEN)),
      [`POST /api/people/vacancies/${OPEN.id}/close`]: () => refusal('status_unchanged', 409),
    });
    renderApp(`/people/vacancies?open=${OPEN.id}`);
    const panel = await screen.findByRole('complementary', { name: OPEN.name });
    await within(panel).findByRole('heading', { name: en.people.vacancies.statusTitle });
    const form = await edit(panel, OPEN.name);
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await savedInPanel(panel);

    fireEvent.click(within(panel).getByRole('button', { name: en.people.vacancies.close }));
    await waitFor(() => {
      expect(panelActions(panel)?.textContent).toContain(en.errors.status_unchanged);
    });
    expect(panelActions(panel)?.textContent).not.toContain(en.form.saved);
    expect(actionsAreLast(panel)).toBe(true);
  });

  it('are closed, and deleted after a confirmation that names them', async () => {
    let closed = false;
    const calls = api('academic_vice_principal', {
      [`GET /api/people/vacancies/${OPEN.id}`]: () =>
        json(vacancyDetail(closed ? { ...OPEN, status: 'closed' } : OPEN)),
      [`GET /api/people/staff/${OPEN.id}/availability`]: () =>
        json({ ...HOURS, entries: [], elsewhere: [] }),
      [`POST /api/people/vacancies/${OPEN.id}/close`]: () => {
        closed = true;
        return json(vacancyDetail({ ...OPEN, status: 'closed' }));
      },
      [`POST /api/people/vacancies/${OPEN.id}/reopen`]: () => {
        closed = false;
        return json(vacancyDetail(OPEN));
      },
      [`POST /api/people/vacancies/${OPEN.id}/delete`]: () => nothing(),
    });
    renderApp(`/people/vacancies?open=${OPEN.id}`);
    const panel = await screen.findByRole('complementary', { name: OPEN.name });
    fireEvent.click(await within(panel).findByRole('button', { name: en.people.vacancies.close }));
    const reopen = await within(panel).findByRole('button', { name: en.people.vacancies.reopen });
    // Task 2.7c-2b-2a: Edit, then Close or Reopen, then Delete, last in the panel.
    expect(panelActionNames(panel)).toEqual([
      en.form.edit,
      en.people.vacancies.reopen,
      en.people.vacancies.delete,
    ]);
    expect(actionsAreLast(panel)).toBe(true);
    // Finding 18: the close is said to be saved, in the bottom row.
    await savedInPanel(panel);
    // Reopened: the sign goes while it is on its way and comes with the answer.
    fireEvent.click(reopen);
    await within(panel).findByRole('button', { name: en.people.vacancies.close });
    await savedInPanel(panel);
    expect(calls.some((call) => call.route.endsWith('/reopen'))).toBe(true);
    fireEvent.click(within(panel).getByRole('button', { name: en.people.vacancies.delete }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(OPEN.name)).toBeDefined();
    expect(calls.some((call) => call.route.endsWith('/delete'))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.vacancies.delete }));
    await waitFor(() => {
      expect(
        calls.some((call) => call.route === `POST /api/people/vacancies/${OPEN.id}/delete`),
      ).toBe(true);
    });
  });
});

/** The headers of the table, without the column of checkboxes. */
const headingsDrawn = (): string[] =>
  [...document.querySelectorAll('thead th')]
    .filter((cell) => cell.querySelector('input') === null)
    .map((cell) => cell.textContent ?? '');

// Task 2.2c-1: the Export button of the list, for the Principal too (`02`:
// "Exports are allowed"), and the columns of the file are those of the screen,
// with the same headings (`EXPORT_TEXTS` of `packages/shared`).
describe('the export of the vacancies list', () => {
  it('is offered, and the columns of the screen are those of the file, with its headings', async () => {
    api('principal');
    renderApp('/people/vacancies');
    await screen.findByRole('heading', { name: en.people.vacancies.title });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    expect(screen.getByRole('button', { name: en.list.export })).toBeTruthy();
    expect(headingsDrawn()).toEqual(
      VACANCY_EXPORT_COLUMNS.map((key) => EXPORT_TEXTS.en.vacancies.columns[key]),
    );
  });
});
