import type { AcademicYear, ErrorDetail, QuartersPreview } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import {
  actionsAreLast,
  edit,
  panelActionNames,
  panelActions,
  savedInPanel,
} from '@/testing/panel';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';
import { savedRecordPanel } from '@/testing/new-record';
import { NO_LESSONS } from '@/testing/no-lessons';

const PATH = '/setup/years';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const undated = [1, 2, 3, 4].map((number) => ({ number, startDate: null, endDate: null }));

const CURRENT: AcademicYear = {
  id: uid(1),
  name: '2026–2027',
  startDate: '2026-09-02',
  endDate: '2027-05-25',
  status: 'current',
  quarters: [
    { number: 1, startDate: '2026-09-02', endDate: '2026-10-31' },
    { number: 2, startDate: '2026-11-10', endDate: '2026-12-27' },
    { number: 3, startDate: null, endDate: null },
    { number: 4, startDate: null, endDate: null },
  ],
};

const PLANNED: AcademicYear = {
  id: uid(2),
  name: '2027–2028',
  startDate: '2027-09-02',
  endDate: '2028-05-25',
  status: 'planned',
  quarters: undated,
};

const CLOSED: AcademicYear = {
  id: uid(3),
  name: '2025–2026',
  startDate: '2025-09-02',
  endDate: '2026-05-25',
  status: 'closed',
  quarters: undated,
};

/** A refusal that names fields, as `outside_year` does. */
const refusalWith = (code: string, details: ErrorDetail[]): Response =>
  Response.json(
    {
      error: {
        code,
        message: 'ENGLISH TEXT FOR THE DEVELOPER',
        requestId: 'test-request',
        details,
      },
    },
    { status: 409 },
  );

/** The preview of a save of the quarters that changes nothing (task 5.6b-5b, decision 3). */
const NOTHING: QuartersPreview = {
  lessons: NO_LESSONS,
  movedBlocks: [],
  pastLessons: { items: [], more: 0 },
  exams: { items: [], more: 0 },
  splitMoves: { items: [], more: 0 },
  ratingExams: { items: [], more: 0 },
};

const PREVIEW_ROUTE = `POST /api/setup/academic-years/${uid(1)}/quarters/preview`;
const SAVE_ROUTE = `PUT /api/setup/academic-years/${uid(1)}/quarters`;

const sessionAs = (role: 'super_admin' | 'principal' | 'academic_vice_principal') =>
  sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
    branches: [NORTH],
  });

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('th, td')].map((cell) => cell.textContent ?? ''),
  );

const type = (input: HTMLElement, value: string): void => {
  fireEvent.change(input, { target: { value } });
};

async function openList(
  role: 'super_admin' | 'principal' | 'academic_vice_principal' = 'super_admin',
  years: AcademicYear[] = [PLANNED, CURRENT, CLOSED],
  extra: Record<string, (body: unknown) => Response> = {},
  language: 'en' | 'ru' = 'en',
) {
  const account = { ...sessionAs(role), language };
  const calls = fakeApi({
    'GET /api/auth/session': () => json(account),
    'GET /api/setup/academic-years': () => json({ years }),
    ...extra,
  });
  renderApp(PATH, language);
  const texts = language === 'ru' ? ru : en;
  await screen.findByRole('heading', { name: texts.setup.years.title });
  if (years.length > 0) {
    await screen.findByRole('table', { name: texts.setup.years.caption });
  }
  return calls;
}

/** "Change quarters" pressed: the quarters form. */
const changeQuarters = async (panel: HTMLElement): Promise<HTMLElement> => {
  fireEvent.click(within(panel).getByRole('button', { name: en.setup.years.changeQuarters }));
  return within(panel).findByRole('form', { name: en.setup.years.quartersTitle });
};

const openYear = async (name: string) => {
  fireEvent.click(screen.getByText(name, { selector: 'button' }));
  return screen.findByRole('complementary', { name });
};

/** The confirmation dialog answered with its action. */
async function goOn(action: string): Promise<void> {
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: action }));
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
}

// docs/spec/03-school-setup.md: Academic year ("Start and end date. Status:
// planned, current, closed."; owner: Super Admin) and Quarters ("Four per year,
// each with start and end ... Months are derived from dates."; owner: Academic
// Vice Principal). `edge/academic-year`: "Start year"; an action whose
// prerequisite is missing is switched off and says what is missing. Owner's
// answers 1, 3 and 4 for task 1.3.
describe('the academic years page', () => {
  it('lists the years of the branch, newest first, with dates in the chosen language, status and dated quarters', async () => {
    await openList();

    expect(rowsDrawn()).toEqual([
      ['2027–2028', '2 September 2027', '25 May 2028', en.setup.years.planned, '0 of 4 dated'],
      ['2026–2027', '2 September 2026', '25 May 2027', en.setup.years.current, '2 of 4 dated'],
      ['2025–2026', '2 September 2025', '25 May 2026', en.setup.years.closed, '0 of 4 dated'],
    ]);
  });

  it('names the status and the dated quarters in Russian when Russian is chosen', async () => {
    await openList('super_admin', [CURRENT], {}, 'ru');

    expect(rowsDrawn()[0]?.slice(3)).toEqual([ru.setup.years.current, '2 из 4 с датами']);
  });

  it('adds a year from its two dates', async () => {
    // The list read again after the save holds the new year.
    const years = [CURRENT];
    const calls = await openList('super_admin', years, {
      'POST /api/setup/academic-years': (body) => {
        const year = { ...PLANNED, ...(body as object) };
        years.push(year);
        return json(year, 201);
      },
    });

    fireEvent.click(screen.getByRole('button', { name: en.setup.years.add }));
    // In the side panel beside the list (task 2.7c-2a), not above it.
    const form = within(
      await screen.findByRole('complementary', { name: en.setup.years.newTitle }),
    ).getByRole('form', { name: en.setup.years.newTitle });
    type(within(form).getByLabelText(en.setup.years.startDate), '2027-09-02');
    type(within(form).getByLabelText(en.setup.years.endDate), '2028-05-25');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(calls.find((call) => call.route === 'POST /api/setup/academic-years')?.body).toEqual({
        startDate: '2027-09-02',
        endDate: '2028-05-25',
      });
    });
    // The panel shows the saved record (task 2.7c-2a).
    await savedRecordPanel(en.setup.years.newTitle);
  });

  // Decision 1 of pull request #44.
  it('says what to fix before anything is sent: a year that does not end in the next calendar year', async () => {
    const calls = await openList('super_admin', [CURRENT]);

    fireEvent.click(screen.getByRole('button', { name: en.setup.years.add }));
    // In the side panel beside the list (task 2.7c-2a), not above it.
    const form = within(
      await screen.findByRole('complementary', { name: en.setup.years.newTitle }),
    ).getByRole('form', { name: en.setup.years.newTitle });
    type(within(form).getByLabelText(en.setup.years.startDate), '2027-09-02');
    type(within(form).getByLabelText(en.setup.years.endDate), '2027-12-25');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    expect(await within(form).findByText(en.setup.years.endYear)).toBeDefined();
    expect(calls.some((call) => call.route === 'POST /api/setup/academic-years')).toBe(false);
  });

  it('starts a planned year after asking, naming the year', async () => {
    const first = {
      ...PLANNED,
      id: uid(4),
      name: '2026–2027',
      startDate: '2026-09-02',
      endDate: '2027-05-25',
    };
    const calls = await openList('super_admin', [first], {
      [`POST /api/setup/academic-years/${first.id}/start`]: () =>
        json({ ...first, status: 'current' }),
    });

    const panel = await openYear('2026–2027');
    fireEvent.click(within(panel).getByRole('button', { name: en.setup.years.start }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(en.setup.years.startTitle.replace('{{name}}', '2026–2027')),
    ).toBeDefined();
    await goOn(en.setup.years.start);

    await waitFor(() => {
      expect(
        calls.some((call) => call.route === `POST /api/setup/academic-years/${first.id}/start`),
      ).toBe(true);
    });
  });

  // edge/academic-year: "'Start year' ... available only after 'Close the
  // year' was carried out for the previous year"; "An action whose
  // prerequisite is missing is switched off and says what is missing."
  it('switches "Start year" off while another year is current, saying why', async () => {
    await openList();

    const panel = await openYear('2027–2028');

    expect(
      within(panel).getByRole<HTMLButtonElement>('button', { name: en.setup.years.start }).disabled,
    ).toBe(true);
    expect(within(panel).getByText(en.setup.years.startBlockedCurrent)).toBeDefined();
  });

  it('switches "Start year" off while an earlier year is not closed, saying why', async () => {
    await openList('super_admin', [PLANNED, { ...CURRENT, status: 'planned' }]);

    const panel = await openYear('2027–2028');

    expect(
      within(panel).getByRole<HTMLButtonElement>('button', { name: en.setup.years.start }).disabled,
    ).toBe(true);
    expect(within(panel).getByText(en.setup.years.startBlockedEarlier)).toBeDefined();
  });

  it('lets the Academic Vice Principal date the quarters, with the months of each dated quarter shown', async () => {
    const calls = await openList('academic_vice_principal', [CURRENT], {
      [PREVIEW_ROUTE]: () => json(NOTHING),
      [`PUT /api/setup/academic-years/${CURRENT.id}/quarters`]: () => json(CURRENT),
    });

    const panel = await openYear('2026–2027');
    expect(within(panel).queryByRole('form', { name: '2026–2027' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.setup.years.start })).toBeNull();
    // Task 2.7c-2b-1: quarters edit and no year edit: "Change quarters", no Edit.
    expect(within(panel).queryByRole('button', { name: en.form.edit })).toBeNull();
    expect(panelActions(panel)).toBeNull();
    const form = await changeQuarters(panel);
    expect(within(form).getByText('September – October')).toBeDefined();
    type(within(form).getByLabelText('Quarter 3: start'), '2027-01-12');
    type(within(form).getByLabelText('Quarter 3: end'), '2027-03-20');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `PUT /api/setup/academic-years/${CURRENT.id}/quarters`)
          ?.body,
      ).toEqual({
        quarters: [
          { startDate: '2026-09-02', endDate: '2026-10-31' },
          { startDate: '2026-11-10', endDate: '2026-12-27' },
          { startDate: '2027-01-12', endDate: '2027-03-20' },
          { startDate: null, endDate: null },
        ],
        // Task 5.6b-5b, decision 3: nothing to show, no dialog, the key sent.
        days: { dayChangesKey: NO_LESSONS.dayChanges.key },
      });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    await savedInPanel(panel);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(panel).getByRole('button', { name: en.setup.years.changeQuarters }),
      );
    });
  });

  it('changes the dates of a year through Edit, with "Start year" beside it at the bottom', async () => {
    const calls = await openList('super_admin', [PLANNED], {
      [`PUT /api/setup/academic-years/${PLANNED.id}`]: (body) =>
        json({ ...PLANNED, ...(body as object) }),
    });
    const panel = await openYear('2027–2028');
    expect(panelActionNames(panel)).toEqual([en.form.edit, en.setup.years.start]);
    expect(actionsAreLast(panel)).toBe(true);

    const form = await edit(panel, '2027–2028');
    // The quarters give way while the dates are edited: Save and Cancel are last.
    expect(within(panel).queryByRole('heading', { name: en.setup.years.quartersTitle })).toBeNull();
    type(within(form).getByLabelText(en.setup.years.endDate), '2028-05-30');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    await savedInPanel(panel);
    expect(
      calls.find((call) => call.route === `PUT /api/setup/academic-years/${PLANNED.id}`)?.body,
    ).toEqual({ startDate: '2027-09-02', endDate: '2028-05-30' });
  });

  // Task 3.6b-2, L128: the stays that stand in the days a change would cut off.
  it('lists the stays in the way when the dates would cut them off, with the count of the rest', async () => {
    await openList('super_admin', [PLANNED], {
      [`PUT /api/setup/academic-years/${PLANNED.id}`]: () =>
        refusalWith('year_cut_holds', [
          {
            path: 'rows.0',
            code: 'year_cut_holds',
            message: 'year_cut_holds',
            stay: {
              studentName: 'Lola Karimova',
              unit: { kind: 'class', name: 'Oxford', grade: 7 },
              firstDay: '2028-05-26',
              lastDay: '2028-05-31',
            },
          },
          {
            path: 'rows.1',
            code: 'year_cut_holds',
            message: 'year_cut_holds',
            stay: {
              studentName: null,
              unit: { kind: 'group', name: '7-M-1', grade: null },
              firstDay: '2027-09-02',
              lastDay: '2028-05-24',
            },
          },
          { path: 'more', code: 'year_cut_holds', message: 'year_cut_holds', more: 3 },
        ]),
    });
    const panel = await openYear('2027–2028');
    const form = await edit(panel, '2027–2028');
    type(within(form).getByLabelText(en.setup.years.endDate), '2028-05-20');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const list = await within(form).findByRole('list', { name: en.setup.years.cutHoldsList });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((one) => one.textContent),
    ).toEqual([
      // Worded by the screen from the fields, never the API's message (item 6
      // of code round 1): the last day is the stay's own, not the day after.
      'Lola Karimova · 7 Oxford · 26 May 2028 – 31 May 2028',
      `${en.setup.years.cutHoldsOtherBranch} · 7-M-1 · 2 September 2027 – 24 May 2028`,
      'and 3 more',
    ]);
    expect(within(form).getByText(en.errors.year_cut_holds)).toBeDefined();
  });

  it('says what to fix in the quarters before anything is sent, and shows a quarter outside the year beside its field', async () => {
    // Task 5.6b-5b: the preview is asked first, and the server refuses there.
    const calls = await openList('super_admin', [CURRENT], {
      [PREVIEW_ROUTE]: () =>
        refusalWith('outside_year', [
          { path: 'quarters.3.endDate', code: 'outside_year', message: 'outside_year' },
        ]),
    });
    const panel = await openYear('2026–2027');
    const form = await changeQuarters(panel);

    type(within(form).getByLabelText('Quarter 3: start'), '2026-12-01');
    type(within(form).getByLabelText('Quarter 3: end'), '2027-03-20');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(await within(form).findByText(en.setup.years.order)).toBeDefined();
    expect(calls.some((call) => call.route.startsWith('PUT'))).toBe(false);
    expect(calls.some((call) => call.route === PREVIEW_ROUTE)).toBe(false);

    type(within(form).getByLabelText('Quarter 3: start'), '');
    type(within(form).getByLabelText('Quarter 3: end'), '');
    type(within(form).getByLabelText('Quarter 4: start'), '2027-03-30');
    type(within(form).getByLabelText('Quarter 4: end'), '2027-06-01');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    expect(await within(form).findByText(en.setup.years.outsideYear)).toBeDefined();
    expect(within(form).getByText(en.errors.outside_year)).toBeDefined();
    // Plan test 7b: no dialog opens and nothing is saved.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.some((call) => call.route.startsWith('PUT'))).toBe(false);
  });

  // Plan test 7b (code review must-fix 1): a closed year refused at the preview.
  it('shows a refused preview of the quarters on the form, with no dialog and no save', async () => {
    const calls = await openList('super_admin', [CURRENT], {
      [PREVIEW_ROUTE]: () => refusalWith('year_closed', []),
    });
    const panel = await openYear('2026–2027');
    const form = await changeQuarters(panel);
    type(within(form).getByLabelText('Quarter 3: start'), '2027-01-12');
    type(within(form).getByLabelText('Quarter 3: end'), '2027-03-20');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(await within(form).findByText(en.errors.year_closed)).toBeDefined();
    expect(calls.some((call) => call.route === PREVIEW_ROUTE)).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.some((call) => call.route.startsWith('PUT'))).toBe(false);
  });

  it('shows the Principal the years and quarters read only, without "Add year"', async () => {
    await openList('principal', [CURRENT]);

    expect(screen.queryByRole('button', { name: en.setup.years.add })).toBeNull();
    const panel = await openYear('2026–2027');
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(within(panel).getByText('10 November 2026')).toBeDefined();
    expect(within(panel).getAllByText(en.setup.years.notDated)).toHaveLength(4);
  });

  it('shows a closed year read only, also to the Super Admin', async () => {
    await openList('super_admin', [CLOSED]);

    const panel = await openYear('2025–2026');

    expect(within(panel).queryByRole('form')).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.setup.years.start })).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.form.edit })).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.setup.years.changeQuarters })).toBeNull();
  });

  it('says what the page is for when the branch has no year, with the first action', async () => {
    await openList('super_admin', []);

    expect(await screen.findByText(en.setup.years.empty)).toBeDefined();
    expect(screen.getAllByRole('button', { name: en.setup.years.add }).length).toBeGreaterThan(0);
  });
});

// Task 5.6b-5b: the preview of a save of the quarters over a published
// timetable (`edge/time-dates-calendar`, "Quarter dates are edited after
// lessons exist", "The academic year is extended or shortened"; `06`, How
// surprises are prevented, Impact preview).
describe('the quarters preview', () => {
  const OXFORD = uid(20);
  const MATHS = uid(21);
  const mathsNames = { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' };
  const names = {
    units: [{ id: OXFORD, kind: 'class' as const, name: 'Oxford', grades: [7] }],
    subjects: [{ id: MATHS, names: mathsNames }],
    teachers: [],
    rooms: [],
  };
  const lesson = {
    date: '2026-11-02',
    start: 480,
    end: 525,
    unitId: OXFORD,
    subjectId: MATHS,
    teacherIds: [],
    roomId: null,
  };
  const QUARTERS = [
    { startDate: '2026-09-02', endDate: '2026-10-31' },
    { startDate: '2026-11-10', endDate: '2026-12-27' },
    { startDate: '2027-01-12', endDate: '2027-03-20' },
    { startDate: null, endDate: null },
  ];
  const pastLesson = {
    kind: 'past_lesson' as const,
    date: '2026-10-19',
    unit: { kind: 'class' as const, name: 'Oxford', grade: 7 },
    subject: { id: MATHS, names: mathsNames },
  };
  const exam = {
    kind: 'exam' as const,
    date: '2026-11-04',
    title: 'Quarter exam',
    cancelled: false,
  };
  const splitMove = {
    kind: 'split_move' as const,
    fromDate: '2026-11-09',
    toDate: '2026-11-03',
    unit: { kind: 'class' as const, name: 'Oxford', grade: 7 },
    subject: { id: MATHS, names: mathsNames },
  };
  // Task 5.6c-3b (decision 2): a journal given two rating exams in one quarter.
  const ratingExams = {
    kind: 'rating_exams' as const,
    date: '2026-11-16',
    unit: { kind: 'class' as const, name: 'Oxford', grade: 7 },
    subject: { id: MATHS, names: mathsNames },
    exams: [
      { title: 'Quarter exam', date: '2026-10-26' },
      { title: 'Retake', date: '2026-11-16' },
    ],
  };
  const LINES = {
    rating_exams: '7 Oxford · Mathematics: 26 October 2026 Quarter exam, 16 November 2026 Retake',
    past_lesson: '19 October 2026 · 7 Oxford · Mathematics',
    exam: '4 November 2026 · Quarter exam',
    split_move: '9 November 2026 → 3 November 2026 · 7 Oxford · Mathematics',
  };

  /** The quarters form with quarter 3 dated and saved: the dialog the preview opens, or none. */
  async function previewQuarters(
    preview: (body: unknown) => QuartersPreview | Response,
    save: (body: unknown) => Response = () => json(CURRENT),
  ) {
    const calls = await openList('academic_vice_principal', [CURRENT], {
      [PREVIEW_ROUTE]: (body) => {
        const answer = preview(body);
        return answer instanceof Response ? answer : json(answer);
      },
      [SAVE_ROUTE]: save,
    });
    const panel = await openYear('2026–2027');
    const form = await changeQuarters(panel);
    type(within(form).getByLabelText('Quarter 3: start'), '2027-01-12');
    type(within(form).getByLabelText('Quarter 3: end'), '2027-03-20');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    return { calls, panel, form };
  }

  async function dialogOf(preview: (body: unknown) => QuartersPreview) {
    const opened = await previewQuarters(preview);
    const dialog = await screen.findByRole('dialog', { name: en.setup.years.preview.title });
    const save = within(dialog).getByRole('button', { name: en.setup.years.preview.save });
    return { ...opened, dialog, save };
  }

  const saved = (calls: { route: string; body?: unknown }[]) =>
    calls.find((call) => call.route === SAVE_ROUTE)?.body;

  it('asks the preview with the quarters, shows the lessons and the dates that change quarter, and saves with the key shown', async () => {
    const { calls, dialog, save, panel } = await dialogOf(() => ({
      ...NOTHING,
      movedBlocks: [{ date: '2026-11-03', blocks: 2 }],
      lessons: {
        ...NO_LESSONS,
        removed: [lesson],
        created: [{ ...lesson, date: '2026-11-05' }],
        cancelled: [{ ...lesson, date: '2026-11-06', cause: 'not_in_template' }],
        needsTeacher: [
          { date: '2026-11-05', unitId: OXFORD, subjectId: MATHS, reason: 'teacher_out' },
        ],
        notified: [uid(22)],
        dayChanges: { ...NO_LESSONS.dayChanges, key: 'd'.repeat(64) },
        names,
      },
    }));
    expect(calls.find((call) => call.route === PREVIEW_ROUTE)?.body).toEqual({
      quarters: QUARTERS,
    });
    const moved = within(dialog).getByTestId('quarter-moved-blocks');
    expect(within(moved).getByText('3 November 2026: 2 lesson times')).not.toBeNull();
    const section = within(dialog).getByTestId('calendar-lessons');
    for (const text of [
      '2 November 2026 · 08:00–08:45 · 7 Oxford · Mathematics',
      '5 November 2026 · 08:00–08:45 · 7 Oxford · Mathematics',
      `6 November 2026 · 08:00–08:45 · 7 Oxford · Mathematics · ${en.setup.calendar.lessons.causes.not_in_template}`,
      `5 November 2026 · 7 Oxford · Mathematics · ${en.timetable.publish.needsTeacher.teacher_out}`,
      en.setup.calendar.lessons.notified_one.replace('{{count}}', '1'),
    ]) {
      expect(within(section).getByText(text)).not.toBeNull();
    }
    expect(within(dialog).queryByTestId('quarter-refusals')).toBeNull();
    expect(save).toHaveProperty('disabled', false);
    fireEvent.click(save);
    await waitFor(() => {
      expect(saved(calls)).toEqual({
        quarters: QUARTERS,
        days: { dayChangesKey: 'd'.repeat(64), dayDecisions: [] },
      });
    });
    await savedInPanel(panel);
  });

  it.each(['pastLessons', 'exams', 'splitMoves', 'ratingExams'] as const)(
    'lists what stands in the way (%s) with the count of the rest, keeps Save off, and Cancel sends nothing',
    async (list) => {
      const item = { pastLessons: pastLesson, exams: exam, splitMoves: splitMove, ratingExams }[
        list
      ];
      const { calls, dialog, save, form } = await dialogOf(() => ({
        ...NOTHING,
        [list]: { items: [item], more: 2 },
      }));
      const title = en.setup.years.preview[list];
      const lines = within(dialog).getByRole('list', { name: title });
      expect(
        within(lines)
          .getAllByRole('listitem')
          .map((one) => one.textContent),
      ).toEqual([LINES[item.kind], 'and 2 more']);
      expect(
        within(within(dialog).getByTestId('quarter-refusals')).getByRole('alert').textContent,
      ).toBe(en.setup.years.preview.refused);
      expect(save).toHaveProperty('disabled', true);
      fireEvent.click(save);
      fireEvent.click(within(dialog).getByRole('button', { name: en.setup.years.cancel }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(saved(calls)).toBeUndefined();
      // The form stays open with what was typed.
      expect(within(form).getByLabelText<HTMLInputElement>('Quarter 3: start').value).toBe(
        '2027-01-12',
      );
    },
  );

  it.each(['blocked', 'exam'] as const)(
    'keeps Save off while the rewrite would refuse: %s',
    async (refusal) => {
      const { dialog, save } = await dialogOf(() => ({
        ...NOTHING,
        lessons: {
          ...NO_LESSONS,
          blocked:
            refusal === 'blocked'
              ? [
                  {
                    date: '2026-11-05',
                    rule: 'teacher_double',
                    lessons: [{ unitId: OXFORD, subjectId: MATHS }],
                  },
                ]
              : [],
          exams:
            refusal === 'exam'
              ? [
                  {
                    id: uid(30),
                    title: 'Quarter exam',
                    date: '2026-11-05',
                    outcome: 'refused',
                    before: { start: 480, end: 525 },
                    after: null,
                    code: 'calendar_exam_slots',
                    blockedRules: [],
                    blocks: [],
                  },
                ]
              : [],
          names,
        },
      }));
      expect(save).toHaveProperty('disabled', true);
      if (refusal === 'blocked') {
        expect(
          within(within(dialog).getByTestId('calendar-lessons')).getByRole('alert').textContent,
        ).toBe(en.setup.calendar.lessons.refused);
      } else {
        expect(dialog.querySelector(`[data-exam="${uid(30)}"]`)?.textContent).toContain(
          en.setup.calendar.lessons.exams.codes.calendar_exam_slots,
        );
      }
    },
  );

  it('keeps Save off until a stored one-day change has a choice, then sends the key shown and the choice', async () => {
    const MOVE = uid(31);
    const { calls, dialog, save } = await dialogOf(() => ({
      ...NOTHING,
      lessons: {
        ...NO_LESSONS,
        dayChanges: {
          key: 'c'.repeat(64),
          kept: [],
          decide: [
            {
              key: MOVE,
              kind: 'move',
              unitId: OXFORD,
              subjectId: MATHS,
              from: { date: '2026-11-05', start: 480, end: 525, roomId: null },
              to: { date: '2026-11-05', start: 590, end: 635, roomId: null },
              reason: 'Excursion to the museum',
              carriedVersionId: null,
              blocked: [],
            },
          ],
          dropped: [],
          bulk: [],
          exams: [],
          absences: [],
          closures: [],
          substitutions: [],
        },
        names,
      },
    }));
    expect(save).toHaveProperty('disabled', true);
    fireEvent.click(
      within(dialog).getByRole('radio', { name: en.timetable.publish.dayChanges.choice_cancel }),
    );
    expect(save).toHaveProperty('disabled', false);
    fireEvent.click(save);
    await waitFor(() => {
      expect(saved(calls)).toEqual({
        quarters: QUARTERS,
        days: { dayChangesKey: 'c'.repeat(64), dayDecisions: [{ key: MOVE, choice: 'cancel' }] },
      });
    });
  });

  it('asks the preview again with the ticks of a shortened date and sends them, with the choice for an exam block', async () => {
    const subjects = [uid(42), uid(43), uid(44)];
    const EXAM = uid(45);
    const day = (kept: number[], chosen: boolean) => ({
      date: '2026-11-05',
      classId: OXFORD,
      lessonSlots: 2,
      lessons: [1, 3, 5].map((slotPosition, index) => ({
        slotPosition,
        entryIds: [uid(50 + index)],
        subjects: [{ unitId: OXFORD, subjectId: subjects[index] ?? '' }],
      })),
      kept,
      chosen,
      missingPositions: [],
    });
    const { calls, dialog, save } = await dialogOf((body) => {
      const ticked = (body as { days?: { dayKeeps?: { slotPositions: number[] }[] } }).days
        ?.dayKeeps?.[0]?.slotPositions;
      return {
        ...NOTHING,
        lessons: {
          ...NO_LESSONS,
          shortenedDays: [ticked === undefined ? day([1, 3], false) : day(ticked, true)],
          exams: [
            {
              id: EXAM,
              title: 'Quarter exam',
              date: '2026-11-05',
              outcome: 'kept',
              before: { start: 480, end: 525 },
              after: null,
              code: null,
              blockedRules: [],
              blocks: [
                {
                  classId: OXFORD,
                  start: 590,
                  lessons: [{ unitId: OXFORD, subjectId: MATHS }],
                  choice: null,
                },
              ],
            },
          ],
          names: {
            ...names,
            subjects: ['Mathematics', 'Art', 'Music'].map((name, index) => ({
              id: subjects[index] ?? '',
              names: { uz: name, ru: name, en: name },
            })),
          },
        },
      };
    });
    const box = (name: string) =>
      within(dialog).getByRole<HTMLInputElement>('checkbox', { name: new RegExp(name) });
    expect(save).toHaveProperty('disabled', true);
    const block = dialog.querySelector<HTMLElement>(`[data-block="${EXAM}|${OXFORD}|590"]`);
    const keep = within(block ?? dialog).getAllByRole<HTMLInputElement>('radio')[1];
    if (keep === undefined) throw new Error('No choice to keep.');
    fireEvent.click(keep);

    fireEvent.click(box('Art'));
    await waitFor(() => {
      expect(box('Art').checked).toBe(false);
    });
    await waitFor(() => {
      expect(save).toHaveProperty('disabled', false);
    });
    expect(calls.filter((call) => call.route === PREVIEW_ROUTE).at(-1)?.body).toEqual({
      quarters: QUARTERS,
      days: { dayKeeps: [{ date: '2026-11-05', classId: OXFORD, slotPositions: [1] }] },
    });
    fireEvent.click(save);
    await waitFor(() => {
      expect(saved(calls)).toEqual({
        quarters: QUARTERS,
        days: {
          dayChangesKey: NO_LESSONS.dayChanges.key,
          dayDecisions: [],
          dayKeeps: [{ date: '2026-11-05', classId: OXFORD, slotPositions: [1] }],
          examBlocks: [{ examId: EXAM, classId: OXFORD, start: 590, choice: 'keep' }],
        },
      });
    });
  });

  // Plan test 7 (decision 4): a save refused after the preview names the same lines.
  it.each([
    ['quarter_past_lessons', 'pastLessons', pastLesson],
    ['quarter_leaves_exam', 'exams', exam],
    ['quarter_splits_move', 'splitMoves', splitMove],
    ['quarter_rating_exams', 'ratingExams', ratingExams],
  ] as const)(
    'shows the lines of a refused save under the quarters form: %s',
    async (code, list, item) => {
      const { form } = await previewQuarters(
        () => NOTHING,
        () =>
          refusalWith(code, [
            { path: 'items.0', code, message: code, quarterItem: item },
            { path: 'more', code, message: code, more: 4 },
          ]),
      );
      const lines = await within(form).findByRole('list', { name: en.setup.years.preview[list] });
      expect(
        within(lines)
          .getAllByRole('listitem')
          .map((one) => one.textContent),
      ).toEqual([LINES[item.kind], 'and 4 more']);
      expect(within(form).getByText(en.errors[code])).toBeDefined();
    },
  );

  // Review correction 3: a refusal of the rewrite at the save, after the dialog.
  it('shows a refusal of the save after the dialog on the quarters form', async () => {
    const { calls, form } = await previewQuarters(
      () => ({ ...NOTHING, lessons: { ...NO_LESSONS, removed: [lesson], names } }),
      () =>
        refusalWith('calendar_blocked', [
          { path: 'days.dayChangesKey', code: 'calendar_blocked', message: 'calendar_blocked' },
        ]),
    );
    const dialog = await screen.findByRole('dialog', { name: en.setup.years.preview.title });
    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.years.preview.save }));
    expect(await within(form).findByText(en.errors.calendar_blocked)).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(saved(calls)).toBeDefined();
  });

  it('lists the exams the new dates of the year would leave out, a cancelled one marked', async () => {
    await openList('super_admin', [PLANNED], {
      [`PUT /api/setup/academic-years/${PLANNED.id}`]: () =>
        refusalWith('year_leaves_exam', [
          {
            path: 'endDate',
            code: 'year_leaves_exam',
            message: 'year_leaves_exam',
            quarterItem: {
              kind: 'exam',
              date: '2028-05-24',
              title: 'Final exam',
              cancelled: false,
            },
          },
          {
            path: 'endDate',
            code: 'year_leaves_exam',
            message: 'year_leaves_exam',
            quarterItem: { kind: 'exam', date: '2028-05-25', title: 'Spare exam', cancelled: true },
          },
        ]),
    });
    const panel = await openYear('2027–2028');
    const form = await edit(panel, '2027–2028');
    type(within(form).getByLabelText(en.setup.years.endDate), '2028-05-20');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const lines = await within(form).findByRole('list', {
      name: en.setup.years.preview.yearExams,
    });
    expect(
      within(lines)
        .getAllByRole('listitem')
        .map((one) => one.textContent),
    ).toEqual(['24 May 2028 · Final exam', '25 May 2028 · Spare exam (cancelled)']);
    expect(within(form).getByText(en.errors.year_leaves_exam)).toBeDefined();
  });
});
