import type {
  ActingTeacher,
  Role,
  StaffListItem,
  Subject,
  VacancyDetail,
  VacancyListItem,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf, SOUTH } from '@/testing/render-app';

// edge/timetable, After publishing, "A vacancy lasts a quarter: who writes
// the plan and grades?"; task 5.7a-3c. All names are invented.

const uid = (n: number): string => `0199d000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const TODAY = '2026-10-10';
const texts = en.people.vacancies.acting;

const PHYSICS: Subject = {
  departmentSince: null,
  departmentMove: null,
  id: uid(21),
  names: { uz: 'Fizika', ru: 'Физика', en: 'Physics' },
  departmentId: uid(11),
  grades: [7],
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

const NODIRA = {
  id: uid(31),
  staffId: 'S-260031',
  firstName: 'Nodira',
  lastName: 'Yusupova',
  fatherName: null,
  categories: ['teacher'],
  branches: [{ branchId: NORTH.id, name: 'North', main: true }],
  divisions: [],
  subjects: [{ subjectId: PHYSICS.id, grades: [7] }],
  languages: ['uz'],
  phone: '+998901234567',
  status: 'active',
  planned: null,
  photoId: null,
} satisfies StaffListItem;

const CLASS = uid(101);
const JOURNAL = uid(201);

const VACANCY: VacancyListItem = {
  id: uid(61),
  name: 'Physics vacancy 1',
  departmentId: uid(11),
  subjects: [{ subjectId: PHYSICS.id, grades: [7] }],
  languages: ['uz'],
  weeklyLessons: 18,
  dailyLessons: 6,
  status: 'open',
  closesOn: null,
};

const period = (extra: Partial<ActingTeacher> = {}): ActingTeacher => ({
  id: uid(301),
  journalId: JOURNAL,
  person: { id: NODIRA.id, name: 'Yusupova Nodira' },
  from: '2026-10-12',
  until: null,
  endsOn: null,
  state: 'planned',
  canEnd: true,
  canWithdraw: true,
  ...extra,
});

const detailOf = (acting: ActingTeacher[]): VacancyDetail => ({
  ...VACANCY,
  statuses: [{ id: uid(71), status: 'open', from: '2026-09-01', until: null }],
  fills: [],
  fillUnits: [{ id: CLASS, kind: 'class', name: 'Oxford', grades: [7] }],
  journals: [
    {
      id: JOURNAL,
      classId: CLASS,
      groupId: null,
      subjectId: PHYSICS.id,
      runs: [{ from: TODAY, until: null }],
      acting,
    },
  ],
  today: TODAY,
});

const CHECK_ROUTE = 'POST /api/timetable/acting-teachers/check';
const NAME_ROUTE = 'POST /api/timetable/acting-teachers';
const END_ROUTE = `POST /api/timetable/acting-teachers/${uid(301)}/end`;

function api(
  role: Role,
  acting: ActingTeacher[] = [],
  extra: Record<string, (body: unknown) => Response> = {},
) {
  return fakeApi({
    'GET /api/auth/session': () =>
      json(sessionOf({ assignments: [{ role, branchId: NORTH.id }], branches: [NORTH, SOUTH] })),
    'GET /api/people/staff': () => json({ staff: [NODIRA], today: TODAY }),
    'GET /api/people/vacancies': () => json({ vacancies: [VACANCY], today: TODAY }),
    'GET /api/setup/divisions': () => json({ divisions: [], staffCounts: [] }),
    'GET /api/setup/subjects': () => json({ subjects: [PHYSICS], mayMoveDepartment: false }),
    'GET /api/setup/academic-years': () => json({ years: [] }),
    'GET /api/timetable/versions': () => json({ versions: [], today: TODAY }),
    [`GET /api/people/vacancies/${VACANCY.id}`]: () => json(detailOf(acting)),
    [CHECK_ROUTE]: () => json({ problems: [], language: false }),
    [NAME_ROUTE]: () => json(period(), 201),
    [END_ROUTE]: () => json(period({ state: 'withdrawn', until: '2026-10-12' })),
    ...extra,
  });
}

async function openVacancy() {
  renderApp(`/people/vacancies?open=${VACANCY.id}`);
  const panel = await screen.findByRole('complementary', { name: VACANCY.name });
  await waitFor(() => {
    expect(panel.querySelector('[data-vacancy-acting]')).not.toBeNull();
  });
  return panel;
}

async function openDialog() {
  const panel = await openVacancy();
  fireEvent.click(await within(panel).findByRole('button', { name: texts.open }));
  return screen.findByRole('dialog', {
    name: texts.dialogTitle.replace('{{name}}', VACANCY.name),
  });
}

const choosePerson = async (dialog: HTMLElement) => {
  const select = within(dialog).getByLabelText<HTMLSelectElement>(texts.person);
  await waitFor(() => {
    expect(select.disabled).toBe(false);
  });
  fireEvent.change(select, { target: { value: NODIRA.id } });
};

describe('the acting teacher of a vacancy’s journal', () => {
  it('lists the journal with no acting teacher as "no teacher", and offers Name to the Academic Vice Principal', async () => {
    api('academic_vice_principal');
    const panel = await openVacancy();
    const journal = panel.querySelector(`[data-acting-journal="${JOURNAL}"]`);
    expect(journal?.textContent).toContain('7 Oxford, Physics');
    expect(journal?.textContent).toContain(texts.noTeacher);
    expect(within(panel).getByRole('button', { name: texts.open })).toBeDefined();
  });

  it('offers nothing to change to the Principal, who has no timetable edit', async () => {
    api('principal', [period()]);
    const panel = await openVacancy();
    expect(within(panel).queryByRole('button', { name: texts.open })).toBeNull();
    expect(within(panel).queryByRole('button', { name: texts.withdraw })).toBeNull();
  });

  it('shows a period ended by the fill at the fill date (decision 2)', async () => {
    api('academic_vice_principal', [
      period({ from: TODAY, state: 'current', endsOn: '2026-11-02', canWithdraw: false }),
    ]);
    const panel = await openVacancy();
    expect(panel.querySelector(`[data-acting-period="${uid(301)}"] > span`)?.textContent).toBe(
      'Yusupova Nodira, from 10 October 2026, until 2 November 2026, when the vacancy no longer holds the journal, in force',
    );
  });

  it('names an acting teacher after the check, with the body the server takes', async () => {
    const calls = api('academic_vice_principal');
    const dialog = await openDialog();
    await choosePerson(dialog);
    const save = within(dialog).getByRole<HTMLButtonElement>('button', { name: texts.name });
    await waitFor(() => {
      expect(save.disabled).toBe(false);
    });
    expect(calls.filter((call) => call.route === CHECK_ROUTE).at(-1)?.body).toEqual({
      vacancyId: VACANCY.id,
      journalId: JOURNAL,
      personId: NODIRA.id,
      from: TODAY,
    });
    fireEvent.click(save);
    await waitFor(() => {
      expect(calls.find((call) => call.route === NAME_ROUTE)?.body).toEqual({
        vacancyId: VACANCY.id,
        journalId: JOURNAL,
        personId: NODIRA.id,
        from: TODAY,
      });
    });
  });

  it('shows the check’s problems and keeps Name off', async () => {
    api('academic_vice_principal', [], {
      [CHECK_ROUTE]: () => json({ problems: ['acting_profile'], language: false }),
    });
    const dialog = await openDialog();
    await choosePerson(dialog);
    const problem = await waitFor(() => {
      const found = dialog.querySelector('[data-problem="acting_profile"]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(problem?.textContent).toBe(en.errors.acting_profile);
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: texts.name }).disabled,
    ).toBe(true);
  });

  it('asks a tick for the class’s language and sends the confirmation with it (decision 5)', async () => {
    const calls = api('academic_vice_principal', [], {
      [CHECK_ROUTE]: () => json({ problems: [], language: true }),
    });
    const dialog = await openDialog();
    await choosePerson(dialog);
    const tick = await within(dialog).findByRole('checkbox', { name: texts.language });
    const save = within(dialog).getByRole<HTMLButtonElement>('button', { name: texts.name });
    expect(save.disabled).toBe(true);
    fireEvent.click(tick);
    await waitFor(() => {
      expect(save.disabled).toBe(false);
    });
    fireEvent.click(save);
    await waitFor(() => {
      expect(calls.find((call) => call.route === NAME_ROUTE)?.body).toMatchObject({
        confirmLanguage: true,
      });
    });
  });

  it('refuses an end before the first day in the dialog, sending nothing', async () => {
    const calls = api('academic_vice_principal');
    const dialog = await openDialog();
    await choosePerson(dialog);
    fireEvent.change(within(dialog).getByLabelText(texts.untilField), {
      target: { value: TODAY },
    });
    expect(await within(dialog).findByText(texts.untilAfter)).toBeDefined();
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: texts.name }).disabled,
    ).toBe(true);
    expect(
      calls
        .filter((call) => call.route === CHECK_ROUTE)
        .some((call) => {
          const body = call.body as { until?: string };
          return body.until === TODAY;
        }),
    ).toBe(false);
  });

  it('ends a period in force on a day, today at the earliest and not after its own end (code review, should-fix 4)', async () => {
    const calls = api('academic_vice_principal', [
      period({ from: '2026-10-05', until: '2026-10-26', state: 'current', canWithdraw: false }),
    ]);
    const panel = await openVacancy();
    fireEvent.click(within(panel).getByRole('button', { name: texts.end }));
    const dialog = await screen.findByRole('dialog', {
      name: texts.endTitle.replace('{{person}}', 'Yusupova Nodira'),
    });
    const field = within(dialog).getByLabelText<HTMLInputElement>(texts.endOn);
    expect(field.value).toBe(TODAY);
    const save = within(dialog).getByRole<HTMLButtonElement>('button', { name: texts.end });
    fireEvent.change(field, { target: { value: '2026-11-02' } });
    expect(await within(dialog).findByText(en.errors.acting_end_later)).toBeDefined();
    expect(save.disabled).toBe(true);
    fireEvent.change(field, { target: { value: '2026-10-09' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(field, { target: { value: '2026-10-19' } });
    await waitFor(() => {
      expect(save.disabled).toBe(false);
    });
    fireEvent.click(save);
    await waitFor(() => {
      expect(calls.find((call) => call.route === END_ROUTE)?.body).toEqual({ until: '2026-10-19' });
    });
  });

  it('withdraws a planned period after a confirmation, ending it on its start', async () => {
    const calls = api('academic_vice_principal', [period()]);
    const panel = await openVacancy();
    fireEvent.click(within(panel).getByRole('button', { name: texts.withdraw }));
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: texts.withdraw }));
    await waitFor(() => {
      expect(calls.find((call) => call.route === END_ROUTE)?.body).toEqual({ until: '2026-10-12' });
    });
  });

  it('shows a refused withdraw', async () => {
    api('academic_vice_principal', [period()], {
      [END_ROUTE]: () => refusal('acting_started', 409),
    });
    const panel = await openVacancy();
    fireEvent.click(within(panel).getByRole('button', { name: texts.withdraw }));
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: texts.withdraw }));
    expect(await within(panel).findByText(en.errors.acting_started)).toBeDefined();
  });
});

// Task 5.7b-2, pull request #192 (decision 7): the per-journal substitution
// of a vacancy's journal, offered with its acting teacher in force.
describe("the substitution of a vacancy's journal", () => {
  const SUBSTITUTES = `GET /api/timetable/vacancies/${VACANCY.id}/journals/${JOURNAL}/substitutes`;
  const SAVE = `POST /api/timetable/vacancies/${VACANCY.id}/journal-substitute`;

  it('chooses the acting teacher first, sends the period and lists what was saved', async () => {
    const calls = api('academic_vice_principal', [period({ state: 'current' })], {
      [SUBSTITUTES]: () =>
        json({
          dates: ['2026-10-12'],
          teachers: [
            {
              id: NODIRA.id,
              name: 'Yusupova Nodira',
              group: 'subject',
              language: false,
              acting: true,
              dates: ['2026-10-12'],
              blockedDates: [],
            },
          ],
        }),
      [SAVE]: () =>
        json({
          substitutionId: uid(401),
          saved: [{ lessonId: uid(501), date: '2026-10-12', relaxed: false }],
          blocked: [],
          taken: [],
        }),
    });
    const panel = await openVacancy();
    fireEvent.click(await within(panel).findByRole('button', { name: texts.substitute }));
    const dialog = await screen.findByRole('dialog');
    const select = await within(dialog).findByLabelText<HTMLSelectElement>(
      en.timetable.day.substitute,
    );
    await waitFor(() => {
      expect(select.value).toBe(NODIRA.id);
    });
    expect(select.selectedOptions[0]?.textContent).toContain(en.timetable.journalSubstitute.acting);
    fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
      target: { value: 'Nobody is hired yet' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.substituteSend }));
    await within(dialog).findByText(
      en.timetable.journalSubstitute.saved.replace('{{dates}}', '12 October'),
    );
    expect(calls.filter((call) => call.route === SAVE).map((call) => call.body)).toEqual([
      {
        journalId: JOURNAL,
        teacherId: NODIRA.id,
        reason: 'Nobody is hired yet',
        from: TODAY,
        until: null,
      },
    ]);
  });

  it('offers no substitution to the Principal', async () => {
    api('principal', [period({ state: 'current' })]);
    const panel = await openVacancy();
    expect(within(panel).queryByRole('button', { name: texts.substitute })).toBeNull();
  });
});
