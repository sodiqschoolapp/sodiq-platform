import type {
  AcademicYear,
  Role,
  StaffListItem,
  Subject,
  TimetableVersion,
  VacancyDetail,
  VacancyFillCheck,
  VacancyListItem,
} from '@sodiq/shared';
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
  SOUTH,
  type ApiCall,
} from '@/testing/render-app';

// docs/spec/06-timetable.md, Changes after publishing, "Filling a vacancy";
// How surprises are prevented, Start date and Impact preview; 04, Vacancy;
// task 5.7a-3b. All names are invented.

const uid = (n: number): string => `0199c000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const TODAY = '2026-10-10';
const texts = en.people.vacancies.fill;

const MATHEMATICS: Subject = {
  departmentSince: null,
  departmentMove: null,
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

const person = (n: number, firstName: string, lastName: string, extra: Partial<StaffListItem>) =>
  ({
    id: uid(n),
    staffId: `S-26${String(n).padStart(4, '0')}`,
    firstName,
    lastName,
    fatherName: null,
    categories: ['teacher'],
    branches: [{ branchId: NORTH.id, name: 'North', main: true }],
    divisions: [],
    subjects: [],
    languages: ['uz'],
    phone: '+998901234567',
    status: 'active',
    planned: null,
    photoId: null,
    ...extra,
  }) satisfies StaffListItem;

const AKMAL = person(31, 'Akmal', 'Karimov', {
  subjects: [{ subjectId: MATHEMATICS.id, grades: [7] }],
});
// Admitted from a later day: no status today (review of the plan, correction 1).
const BOBUR = person(32, 'Bobur', 'Rahimov', { status: null });
const GONE = person(33, 'Dilshod', 'Aliyev', { status: 'left' });

const YEAR: AcademicYear = {
  id: uid(1),
  name: '2026–2027',
  startDate: '2026-09-01',
  endDate: '2027-05-31',
  status: 'current',
  quarters: [
    { number: 1, startDate: '2026-09-01', endDate: '2026-10-24' },
    { number: 2, startDate: '2026-11-02', endDate: '2026-12-26' },
    { number: 3, startDate: '2027-01-11', endDate: '2027-03-20' },
    { number: 4, startDate: '2027-03-30', endDate: '2027-05-31' },
  ],
};

const version = (n: number, number: number, startsOn: string): TimetableVersion => ({
  id: uid(n),
  academicYearId: YEAR.id,
  yearName: YEAR.name,
  yearStatus: 'current',
  number,
  status: 'published',
  startsOn,
  fromVersion: null,
  rows: 2,
  leftRows: 0,
  leftBlocks: 0,
  outOfDate: false,
  editLock: null,
});

const CLASS_A = uid(101);
const CLASS_B = uid(102);
const UNITS = [
  { id: CLASS_A, kind: 'class' as const, name: 'Oxford', grades: [7] },
  { id: CLASS_B, kind: 'class' as const, name: 'Princeton', grades: [7] },
];

const OPEN: VacancyListItem = {
  id: uid(61),
  name: 'Mathematics vacancy 1',
  departmentId: uid(11),
  subjects: [{ subjectId: MATHEMATICS.id, grades: [7] }],
  languages: ['uz'],
  weeklyLessons: 18,
  dailyLessons: 6,
  status: 'open',
  closesOn: null,
};

const PLANNED: VacancyListItem = {
  ...OPEN,
  id: uid(62),
  name: 'Mathematics vacancy 2',
  closesOn: '2026-10-19',
};

const CLOSED: VacancyListItem = {
  ...OPEN,
  id: uid(63),
  name: 'Mathematics vacancy 3',
  status: 'closed',
};

const detailOf = (row: VacancyListItem, extra: Partial<VacancyDetail> = {}): VacancyDetail => ({
  ...row,
  statuses: [{ id: uid(71), status: row.status, from: '2026-09-01', until: null }],
  fills: [],
  fillUnits: [],
  journals: [],
  today: TODAY,
  ...extra,
});

const IMPACT = {
  beforeVersion: { id: uid(500), number: 1 },
  dayChanges: {
    key: 'd'.repeat(64),
    kept: [],
    decide: [],
    dropped: [],
    absences: [],
    closures: [],
    substitutions: [],
    bulk: [],
    exams: [],
  },
  counts: { created: 0, moved: 0, removed: 0, changed: 12, unchanged: 40 },
  changes: [],
  teachers: [],
  classIds: [CLASS_A],
  roomIds: [],
  vacancies: [],
  transition: {
    weekStart: '2026-10-12',
    weekEnd: '2026-10-18',
    rows: [],
    key: 'b'.repeat(64),
  },
  names: { units: UNITS, subjects: [], teachers: [], rooms: [] },
  carried: [],
};

const PUBLISH = {
  startsOn: '2026-10-12',
  earliest: '2026-10-11',
  defaultStart: '2026-10-12',
  quarterStarts: ['2026-11-02'],
  refusals: [],
  warnings: [],
  cancelledLessons: [],
  needsTeacher: [],
  impact: IMPACT,
  shortenedDays: [],
  unusedKeeps: [],
  chain: null,
  canPublish: true,
};

const row = (classId: string, filled: boolean, reason: 'blocked' | 'profile' | null = null) => ({
  classId,
  groupId: null,
  subjectId: MATHEMATICS.id,
  filled,
  reason,
  dates: reason === 'blocked' ? ['2026-10-13', '2026-10-20'] : [],
});

const CHECK: VacancyFillCheck = {
  rows: [row(CLASS_A, true), row(CLASS_B, false, 'blocked')],
  rowsKey: 'a'.repeat(64),
  inPlace: false,
  publish: PUBLISH,
  closes: false,
  holders: [{ versionId: null, versionNumber: 2, lessonDate: null }],
  units: UNITS,
};

const CHECK_ROUTE = 'POST /api/timetable/vacancy-fills/check';
const FILL_ROUTE = 'POST /api/timetable/vacancy-fills';

const sessionAs = (role: Role, language: 'en' | 'ru' = 'en') => ({
  ...sessionOf({ assignments: [{ role, branchId: NORTH.id }], branches: [NORTH, SOUTH] }),
  language,
});

function api(
  role: Role,
  extra: Record<string, (body: unknown) => Response> = {},
  language: 'en' | 'ru' = 'en',
  details: Record<string, VacancyDetail> = {},
) {
  return fakeApi({
    'GET /api/auth/session': () => json(sessionAs(role, language)),
    'GET /api/people/staff': () => json({ staff: [AKMAL, BOBUR, GONE], today: TODAY }),
    'GET /api/people/vacancies': () => json({ vacancies: [OPEN, PLANNED, CLOSED], today: TODAY }),
    'GET /api/setup/divisions': () => json({ divisions: [], staffCounts: [] }),
    'GET /api/setup/subjects': () => json({ subjects: [MATHEMATICS], mayMoveDepartment: false }),
    'GET /api/setup/academic-years': () => json({ years: [YEAR] }),
    'GET /api/timetable/versions': () =>
      json({
        versions: [version(500, 1, '2026-09-01'), version(501, 2, '2026-11-16')],
        today: TODAY,
      }),
    [`GET /api/people/vacancies/${OPEN.id}`]: () => json(details[OPEN.id] ?? detailOf(OPEN)),
    [`GET /api/people/vacancies/${PLANNED.id}`]: () => json(detailOf(PLANNED)),
    [`GET /api/people/vacancies/${CLOSED.id}`]: () => json(detailOf(CLOSED)),
    [CHECK_ROUTE]: () => json(CHECK),
    ...extra,
  });
}

async function openVacancy(vacancy: VacancyListItem, language: 'en' | 'ru' = 'en') {
  renderApp(`/people/vacancies?open=${vacancy.id}`, language);
  return screen.findByRole('complementary', { name: vacancy.name });
}

async function openDialog() {
  const panel = await openVacancy(OPEN);
  fireEvent.click(await within(panel).findByRole('button', { name: texts.open }));
  return screen.findByRole('dialog', { name: texts.title.replace('{{name}}', OPEN.name) });
}

const checks = (calls: ApiCall[]) => calls.filter((call) => call.route === CHECK_ROUTE);

const choosePerson = async (dialog: HTMLElement, id = AKMAL.id) => {
  const select = within(dialog).getByLabelText<HTMLSelectElement>(texts.person);
  await waitFor(() => {
    expect(select.disabled).toBe(false);
  });
  fireEvent.change(select, { target: { value: id } });
};

describe('the fill of a vacancy', () => {
  it('is offered to the Academic Vice Principal on an open vacancy', async () => {
    api('academic_vice_principal');
    const panel = await openVacancy(OPEN);
    expect(await within(panel).findByRole('button', { name: texts.open })).toBeDefined();
  });

  it('is not offered to the Principal, who has no timetable edit', async () => {
    api('principal');
    const panel = await openVacancy(OPEN);
    await within(panel).findByText(en.people.vacancies.noFills);
    expect(within(panel).queryByRole('button', { name: texts.open })).toBeNull();
  });

  it('is not offered on a closed vacancy', async () => {
    api('academic_vice_principal');
    const closed = await openVacancy(CLOSED);
    await within(closed).findByText(en.people.vacancies.noFills);
    expect(within(closed).queryByRole('button', { name: texts.open })).toBeNull();
  });

  it('shows a planned close on the record and in the list, and offers no fill there', async () => {
    api('academic_vice_principal');
    const panel = await openVacancy(PLANNED);
    await waitFor(() => {
      expect(panel.querySelector('[data-vacancy-status]')?.textContent).toBe(
        'Open, closes on 19 October 2026',
      );
    });
    expect(within(panel).queryByRole('button', { name: texts.open })).toBeNull();
    await waitFor(() => {
      const cells = [...document.querySelectorAll('tbody tr')].map(
        (one) => one.querySelectorAll('td')[one.querySelectorAll('td').length - 1]?.textContent,
      );
      expect(cells).toContain('Open, closes on 19 October 2026');
    });
  });

  it('shows the planned close in Russian', async () => {
    api('academic_vice_principal', {}, 'ru');
    renderApp('/people/vacancies', 'ru');
    await screen.findByRole('heading', { name: ru.people.vacancies.title });
    await waitFor(() => {
      const cells = [...document.querySelectorAll('tbody tr')].map(
        (one) => one.querySelectorAll('td')[one.querySelectorAll('td').length - 1]?.textContent,
      );
      expect(cells).toContain('Открыта, закрывается с 19 октября 2026 г.');
    });
  });

  it('offers the people active or admitted later, those with the subject first, not those who left', async () => {
    api('academic_vice_principal');
    const dialog = await openDialog();
    const select = within(dialog).getByLabelText<HTMLSelectElement>(texts.person);
    await waitFor(() => {
      expect([...select.options].map((one) => one.textContent)).toEqual([
        texts.choosePerson,
        'Karimov Akmal',
        'Rahimov Bobur',
      ]);
    });
  });

  it('starts next Monday by the server’s today, offers the coming quarters and the later versions, refuses today', async () => {
    const calls = api('academic_vice_principal');
    const dialog = await openDialog();
    const date = within(dialog).getByLabelText<HTMLInputElement>(texts.startsOn);
    expect(date.value).toBe('2026-10-12');
    expect(date.min).toBe('2026-10-11');
    const shortcuts = within(dialog).getByRole('group', { name: texts.shortcuts });
    await waitFor(() => {
      expect(
        within(shortcuts)
          .getAllByRole('button')
          .map((one) => one.textContent),
      ).toEqual([
        'Usual start: 12 October 2026',
        'Quarter 2: 2 November 2026',
        'Quarter 3: 11 January 2027',
        'Quarter 4: 30 March 2027',
        'Start of version 2, 16 November 2026',
      ]);
    });
    fireEvent.click(within(shortcuts).getByRole('button', { name: /version 2/ }));
    expect(date.value).toBe('2026-11-16');
    await choosePerson(dialog);
    await waitFor(() => {
      expect(checks(calls).at(-1)?.body).toEqual({
        vacancyId: OPEN.id,
        personId: AKMAL.id,
        startsOn: '2026-11-16',
      });
    });
    const before = checks(calls).length;
    fireEvent.change(date, { target: { value: TODAY } });
    expect(await within(dialog).findByText('Choose 11 October 2026 or later.')).toBeDefined();
    expect(checks(calls)).toHaveLength(before);
  });

  it('shows the rows filled and left, the close, and fills after the tick and the confirmation', async () => {
    const calls = api('academic_vice_principal', {
      [FILL_ROUTE]: () =>
        json({
          id: uid(900),
          vacancyId: OPEN.id,
          personId: AKMAL.id,
          startsOn: '2026-10-12',
          versionId: uid(502),
          rows: CHECK.rows,
          closed: false,
          holders: CHECK.holders,
        }),
    });
    const dialog = await openDialog();
    await choosePerson(dialog);
    await waitFor(() => {
      expect(
        [...dialog.querySelectorAll('[data-rows-filled] li')].map((one) => one.textContent),
      ).toEqual(['7 Oxford, Mathematics: goes to the person']);
    });
    expect(
      [...dialog.querySelectorAll('[data-rows-left] li')].map((one) => one.textContent),
    ).toEqual([
      '7 Princeton, Mathematics: the person is busy or not available on 13 October 2026, 20 October 2026',
    ]);
    expect(dialog.querySelector('[data-closes]')?.textContent).toBe(texts.staysOpen);
    expect(dialog.querySelector('[data-holders] li')?.textContent).toBe(
      'Version 2 still has a row of the vacancy.',
    );
    const action = within(dialog).getByRole('button', { name: texts.action });
    expect(action).toHaveProperty('disabled', true);
    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: en.timetable.publish.transition.tick }),
    );
    expect(action).toHaveProperty('disabled', false);

    // A decline sends nothing.
    fireEvent.click(action);
    let question = await screen.findByRole('alertdialog');
    expect(within(question).getByRole('heading').textContent).toBe('Fill Mathematics vacancy 1?');
    expect(within(question).getByText('7 Oxford, Mathematics')).toBeDefined();
    expect(
      within(question).getByText(
        'Karimov Akmal takes these rows from 12 October 2026, in the timetable in force and every later version.',
      ),
    ).toBeDefined();
    fireEvent.click(within(question).getByRole('button', { name: en.confirm.cancel }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(calls.some((call) => call.route === FILL_ROUTE)).toBe(false);

    fireEvent.click(action);
    question = await screen.findByRole('alertdialog');
    fireEvent.click(within(question).getByRole('button', { name: texts.action }));
    await waitFor(() => {
      expect(calls.find((call) => call.route === FILL_ROUTE)?.body).toEqual({
        vacancyId: OPEN.id,
        personId: AKMAL.id,
        startsOn: '2026-10-12',
        rowsKey: 'a'.repeat(64),
        transitionKey: 'b'.repeat(64),
        dayChangesKey: 'd'.repeat(64),
        dayDecisions: [],
      });
    });
    const done = await waitFor(() => {
      const found = document.querySelector('[data-fill-done]');
      if (found === null) throw new Error('Not done yet.');
      return found as HTMLElement;
    });
    // The rows named from the check's units (spec review of the code, must-fix 1).
    expect([...done.querySelectorAll('li')].map((one) => one.textContent)).toEqual([
      '7 Oxford, Mathematics: goes to the person',
      '7 Princeton, Mathematics: the person is busy or not available on 13 October 2026, 20 October 2026',
    ]);
    expect(done.querySelector('[data-closed]')?.textContent).toBe(texts.staysOpen);
    expect(
      within(done).getByText('To take it back, withdraw the version before 12 October 2026.'),
    ).toBeDefined();
  });

  it('a new answer with another transition key takes the tick away', async () => {
    let second = false;
    api('academic_vice_principal', {
      [CHECK_ROUTE]: () =>
        json(
          second
            ? {
                ...CHECK,
                publish: {
                  ...PUBLISH,
                  impact: { ...IMPACT, transition: { ...IMPACT.transition, key: 'c'.repeat(64) } },
                },
              }
            : CHECK,
        ),
    });
    const dialog = await openDialog();
    await choosePerson(dialog);
    const tick = await within(dialog).findByRole('checkbox', {
      name: en.timetable.publish.transition.tick,
    });
    fireEvent.click(tick);
    const action = within(dialog).getByRole('button', { name: texts.action });
    expect(action).toHaveProperty('disabled', false);
    second = true;
    fireEvent.change(within(dialog).getByLabelText(texts.startsOn), {
      target: { value: '2026-10-19' },
    });
    await waitFor(() => {
      expect(dialog.querySelector('[data-tick-needed]')).not.toBeNull();
    });
    expect(within(dialog).getByRole('button', { name: texts.action })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('sends the rows chosen, and drops a chosen row the new date no longer offers', async () => {
    const calls = api('academic_vice_principal', {
      [CHECK_ROUTE]: (body) => {
        const sent = body as { startsOn: string; rows?: unknown[] };
        // From 19 October only 7 Oxford's row is left of the vacancy.
        if (sent.startsOn === '2026-10-19') {
          return json({ ...CHECK, rows: [row(CLASS_A, true)], holders: [], closes: true });
        }
        return json(sent.rows === undefined ? CHECK : { ...CHECK, rows: [row(CLASS_B, true)] });
      },
    });
    const dialog = await openDialog();
    await choosePerson(dialog);
    const rows = await waitFor(() => {
      const found = dialog.querySelector('[data-fill-rows]');
      if (found === null) throw new Error('No rows yet.');
      return found as HTMLElement;
    });
    fireEvent.click(within(rows).getByRole('checkbox', { name: '7 Oxford, Mathematics' }));
    await waitFor(() => {
      expect(checks(calls).at(-1)?.body).toEqual({
        vacancyId: OPEN.id,
        personId: AKMAL.id,
        startsOn: '2026-10-12',
        rows: [{ classId: CLASS_B, subjectId: MATHEMATICS.id }],
      });
    });
    fireEvent.change(within(dialog).getByLabelText(texts.startsOn), {
      target: { value: '2026-10-19' },
    });
    await waitFor(() => {
      expect(dialog.querySelector('[data-closes]')?.textContent).toBe(
        'The vacancy will be closed from 19 October 2026.',
      );
    });
    // Every check of the new date names no rows: all of them.
    const late = checks(calls).filter(
      (call) => (call.body as { startsOn: string }).startsOn === '2026-10-19',
    );
    expect(late.length).toBeGreaterThan(0);
    expect(late.every((call) => !Object.hasOwn(call.body as object, 'rows'))).toBe(true);
  });

  it('asks for a row when every row is unticked, and checks nothing for none', async () => {
    const calls = api('academic_vice_principal');
    const dialog = await openDialog();
    await choosePerson(dialog);
    const rows = await waitFor(() => {
      const found = dialog.querySelector('[data-fill-rows]');
      if (found === null) throw new Error('No rows yet.');
      return found as HTMLElement;
    });
    const before = checks(calls).length;
    fireEvent.click(within(rows).getByRole('checkbox', { name: texts.allRows }));
    expect(await within(dialog).findByText(texts.chooseRow)).toBeDefined();
    expect(checks(calls)).toHaveLength(before);
  });

  it('keeps Fill off with its line when no row can be filled', async () => {
    api('academic_vice_principal', {
      [CHECK_ROUTE]: () =>
        json({
          ...CHECK,
          rows: [row(CLASS_A, false, 'profile'), row(CLASS_B, false, 'profile')],
          publish: null,
          holders: [],
        }),
    });
    const dialog = await openDialog();
    await choosePerson(dialog, BOBUR.id);
    expect(await within(dialog).findByText(texts.nothingFilled)).toBeDefined();
    expect(
      [...dialog.querySelectorAll('[data-rows-left] li')].map((one) => one.textContent),
    ).toEqual([
      '7 Oxford, Mathematics: the person does not teach this subject, grade or language',
      '7 Princeton, Mathematics: the person does not teach this subject, grade or language',
    ]);
    expect(within(dialog).getByRole('button', { name: texts.action })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('shows a refusal of the check with a retry, and reads it again only on Retry', async () => {
    const calls = api('academic_vice_principal', {
      [CHECK_ROUTE]: () => refusal('fill_person', 409),
    });
    const dialog = await openDialog();
    await choosePerson(dialog, BOBUR.id);
    expect(await within(dialog).findByText(en.errors.fill_person)).toBeDefined();
    const count = checks(calls).length;
    fireEvent.click(within(dialog).getByRole('button', { name: en.problems.retry }));
    await waitFor(() => {
      expect(checks(calls).length).toBe(count + 1);
    });
  });

  it('shows a refused fill and reads the check again', async () => {
    const calls = api('academic_vice_principal', {
      [FILL_ROUTE]: () => refusal('fill_rows_changed', 409),
    });
    const dialog = await openDialog();
    await choosePerson(dialog);
    fireEvent.click(
      await within(dialog).findByRole('checkbox', { name: en.timetable.publish.transition.tick }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: texts.action }));
    const question = await screen.findByRole('alertdialog');
    const count = checks(calls).length;
    fireEvent.click(within(question).getByRole('button', { name: texts.action }));
    expect(await within(dialog).findByText(en.errors.fill_rows_changed)).toBeDefined();
    await waitFor(() => {
      expect(checks(calls).length).toBeGreaterThan(count);
    });
  });

  it('keeps Fill off until each one-day change that needs a decision has a choice, and sends it', async () => {
    const item = {
      key: uid(622),
      kind: 'move' as const,
      unitId: CLASS_A,
      subjectId: MATHEMATICS.id,
      from: { date: '2026-10-19', start: 480, end: 525, roomId: null },
      to: { date: '2026-10-21', start: 535, end: 580, roomId: null },
      reason: 'Excursion to the museum',
      carriedVersionId: null,
      blocked: [
        {
          rule: 'teacher_double',
          severity: 'blocked',
          weekday: 3,
          lessonIds: [],
          date: '2026-10-21',
        },
      ],
    };
    const calls = api('academic_vice_principal', {
      [CHECK_ROUTE]: () =>
        json({
          ...CHECK,
          publish: {
            ...PUBLISH,
            impact: {
              ...IMPACT,
              transition: null,
              dayChanges: { ...IMPACT.dayChanges, decide: [item] },
            },
          },
        }),
      [FILL_ROUTE]: () =>
        json({
          id: uid(900),
          vacancyId: OPEN.id,
          personId: AKMAL.id,
          startsOn: '2026-10-12',
          versionId: null,
          rows: CHECK.rows,
          closed: false,
          holders: [],
        }),
    });
    const dialog = await openDialog();
    await choosePerson(dialog);
    const decide = await waitFor(() => {
      const found = dialog.querySelector('[data-day-changes="decide"]');
      if (found === null) throw new Error('No one-day changes yet.');
      return found as HTMLElement;
    });
    const action = within(dialog).getByRole('button', { name: texts.action });
    expect(action).toHaveProperty('disabled', true);
    expect(dialog.querySelector('[data-decision-needed]')?.textContent).toBe(
      en.timetable.publish.dayChanges.decisionNeeded,
    );
    fireEvent.click(
      within(decide).getByRole('radio', { name: en.timetable.publish.dayChanges.choice_cancel }),
    );
    expect(action).toHaveProperty('disabled', false);
    fireEvent.click(action);
    const question = await screen.findByRole('alertdialog');
    fireEvent.click(within(question).getByRole('button', { name: texts.action }));
    await waitFor(() => {
      expect(calls.find((call) => call.route === FILL_ROUTE)?.body).toEqual({
        vacancyId: OPEN.id,
        personId: AKMAL.id,
        startsOn: '2026-10-12',
        rowsKey: 'a'.repeat(64),
        dayChangesKey: 'd'.repeat(64),
        dayDecisions: [{ key: uid(622), choice: 'cancel' }],
      });
    });
    // Carried in place (no version of its own): the undo line says so.
    await waitFor(() => {
      expect(document.querySelector('[data-undo]')?.textContent).toBe(
        texts.undoInPlace.replace('{{date}}', '12 October 2026'),
      );
    });
  });

  it('shows the later versions with "carry" fixed, offers no other answer, and sends the later key', async () => {
    const calls = api('academic_vice_principal', {
      [CHECK_ROUTE]: () =>
        json({
          ...CHECK,
          publish: {
            ...PUBLISH,
            impact: { ...IMPACT, transition: null },
            chain: {
              key: 'e'.repeat(64),
              later: [{ id: uid(501), number: 2, startsOn: '2026-11-16' }],
              carryOffered: true,
              carryReason: null,
              changes: [],
              carried: [
                {
                  versionId: uid(501),
                  number: 2,
                  startsOn: '2026-11-16',
                  applied: 1,
                  left: false,
                  refusals: [],
                },
              ],
            },
          },
        }),
    });
    const dialog = await openDialog();
    await choosePerson(dialog);
    const chain = await waitFor(() => {
      const found = dialog.querySelector('[data-chain]');
      if (found === null) throw new Error('No chain yet.');
      return found as HTMLElement;
    });
    expect(within(chain).getByText(en.timetable.publish.chain.fixedCarry)).toBeDefined();
    expect(within(chain).queryAllByRole('radio')).toHaveLength(0);
    expect(chain.querySelector('[data-carried] li')).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: texts.action }));
    const question = await screen.findByRole('alertdialog');
    fireEvent.click(within(question).getByRole('button', { name: texts.action }));
    await waitFor(() => {
      expect(
        (calls.find((call) => call.route === FILL_ROUTE)?.body as { laterKey?: string } | undefined)
          ?.laterKey,
      ).toBe('e'.repeat(64));
    });
  });

  it('shows the failure of the versions behind the shortcuts, with a retry', async () => {
    const calls = api('academic_vice_principal', {
      'GET /api/timetable/versions': () =>
        json({ error: { code: 'internal', message: 'x', requestId: 'r' } }, 500),
    });
    const dialog = await openDialog();
    const shortcuts = within(dialog).getByRole('group', { name: texts.shortcuts });
    const retry = await within(shortcuts).findByRole('button', { name: en.problems.retry });
    const before = calls.filter((call) => call.route === 'GET /api/timetable/versions').length;
    fireEvent.click(retry);
    await waitFor(() => {
      expect(calls.filter((call) => call.route === 'GET /api/timetable/versions').length).toBe(
        before + 1,
      );
    });
  });

  it('lists the fills of the vacancy with their rows named, a withdrawn one marked', async () => {
    api('academic_vice_principal', {}, 'en', {
      [OPEN.id]: detailOf(OPEN, {
        fills: [
          {
            id: uid(901),
            startsOn: '2026-10-19',
            person: { id: AKMAL.id, name: 'Karimov Akmal' },
            rows: [{ classId: CLASS_A, groupId: null, subjectId: MATHEMATICS.id }],
            versionNumber: 3,
            withdrawn: true,
          },
          {
            id: uid(902),
            startsOn: '2026-09-14',
            person: { id: BOBUR.id, name: 'Rahimov Bobur' },
            rows: [{ classId: uid(199), groupId: null, subjectId: MATHEMATICS.id }],
            versionNumber: null,
            withdrawn: false,
          },
        ],
        fillUnits: [UNITS[0] ?? UNITS[1]].filter((one) => one !== undefined),
      }),
    });
    const panel = await openVacancy(OPEN);
    const fills = await waitFor(() => {
      const found = panel.querySelector('[data-vacancy-fills]');
      if (found === null || found.querySelectorAll('li').length === 0) throw new Error('No fills.');
      return found;
    });
    expect(
      [...fills.querySelectorAll('li')].map((one) =>
        [...one.querySelectorAll('span')].map((part) => part.textContent),
      ),
    ).toEqual([
      ['From 19 October 2026: Karimov Akmal, version 3, withdrawn', '7 Oxford, Mathematics'],
      // A class the answer does not name falls back to a text without its name.
      ['From 14 September 2026: Rahimov Bobur', 'A class, Mathematics'],
    ]);
  });
});
