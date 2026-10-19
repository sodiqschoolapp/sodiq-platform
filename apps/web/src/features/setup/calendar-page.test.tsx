import type { CalendarDate, CalendarEntry, CalendarPreview, DayTemplateList } from '@sodiq/shared';
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

const PATH = '/setup/calendar';
// Saturday 10 October 2026 in branch time.
const TODAY = '2026-10-10';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const SHORT = uid(9);

const TEMPLATES: DayTemplateList = {
  today: TODAY,
  dayTemplates: [
    {
      id: uid(8),
      name: 'Main',
      archivedAt: null,
      start: 480,
      end: 840,
      lessonSlots: 6,
      inUse: true,
    },
    {
      id: SHORT,
      name: 'Short',
      archivedAt: null,
      start: 480,
      end: 720,
      lessonSlots: 4,
      inUse: false,
    },
  ],
};

const entry = (fields: Partial<CalendarEntry> & Pick<CalendarEntry, 'id' | 'name'>) => ({
  kind: 'day_off' as const,
  firstDate: '2026-10-14',
  lastDate: '2026-10-14',
  gradeFrom: null,
  gradeTo: null,
  dayTemplateId: null,
  dayTemplateName: null,
  followsWeekday: null,
  examWeek: null,
  archivedAt: null,
  ...fields,
});

const HOLIDAY = entry({ id: uid(1), name: 'Teachers day' });
const SATURDAY = entry({
  id: uid(2),
  name: 'Working Saturday',
  kind: 'special_day',
  firstDate: '2026-10-17',
  lastDate: '2026-10-17',
  dayTemplateId: SHORT,
  dayTemplateName: 'Short',
  followsWeekday: 1,
});
const SENIORS = entry({
  id: uid(3),
  name: 'Seniors exams',
  kind: 'special_day',
  firstDate: '2026-10-05',
  lastDate: '2026-10-16',
  gradeFrom: 9,
  gradeTo: 11,
  dayTemplateId: SHORT,
  dayTemplateName: 'Short',
  examWeek: 'no_regular_lessons',
});
const PAST = entry({
  id: uid(4),
  name: 'Autumn holiday',
  firstDate: '2026-10-01',
  lastDate: '2026-10-02',
});

/** A save over dates with no published lesson (task 5.6b-1). */
const NO_LESSONS: CalendarPreview['lessons'] = {
  removed: [],
  created: [],
  cancelled: [],
  needsTeacher: [],
  notified: [],
  blocked: [],
  stored: [],
  dayChanges: { key: 'e'.repeat(64), kept: [], decide: [], dropped: [], bulk: [] },
  shortenedDays: [],
  keepRefusals: [],
  names: { units: [], subjects: [], teachers: [], rooms: [] },
};

const PREVIEW: CalendarPreview = {
  lessons: NO_LESSONS,
  changes: [
    {
      firstDate: '2026-10-17',
      lastDate: '2026-10-17',
      gradeFrom: 1,
      gradeTo: 11,
      before: { lessons: false, reason: 'not_working_day', entryId: null, entryName: null },
      after: {
        lessons: true,
        dayTemplateId: SHORT,
        dayTemplateName: 'Short',
        followsWeekday: 1,
        examWeek: null,
        entryId: null,
        entryName: 'Working Saturday',
      },
    },
  ],
};

const sessionAs = (
  role: 'super_admin' | 'principal' | 'academic_vice_principal',
  language = 'en',
) => ({
  ...sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
    branches: [NORTH],
  }),
  language,
});

const rowsDrawn = (table: HTMLElement): string[][] =>
  [...table.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('th, td')].map((cell) => cell.textContent ?? ''),
  );

const type = (input: HTMLElement, value: string): void => {
  fireEvent.change(input, { target: { value } });
};

async function openList(
  role: 'super_admin' | 'principal' | 'academic_vice_principal' = 'academic_vice_principal',
  extra: Record<string, (body: unknown) => Response> = {},
  language: 'en' | 'ru' = 'en',
) {
  const calls = fakeApi({
    'GET /api/auth/session': () => json(sessionAs(role, language)),
    'GET /api/setup/calendar-entries': () =>
      json({ today: TODAY, entries: [PAST, SENIORS, HOLIDAY, SATURDAY] }),
    'GET /api/setup/day-templates': () => json(TEMPLATES),
    ...extra,
  });
  renderApp(PATH, language);
  const texts = language === 'ru' ? ru : en;
  await screen.findByRole('heading', { name: texts.setup.calendar.title });
  // The table of the list is drawn again once its rows arrive: read it afresh.
  const table = () => screen.getByRole('table', { name: texts.setup.calendar.caption });
  await waitFor(() => {
    expect(rowsDrawn(table())).toHaveLength(4);
  });
  return { calls, table };
}

const openEntry = async (name: string) => {
  fireEvent.click(screen.getByText(name, { selector: 'button' }));
  return screen.findByRole('complementary', { name });
};

// docs/spec/03-school-setup.md, Academic calendar: "Days off (holidays,
// vacations) and special days ... Each date resolves to 'no lessons' or to one
// day template"; the owner's answers 15 to 18 (task 1.4).
describe('the calendar page', () => {
  it('lists the entries with their dates, kind, grades and template', async () => {
    const { table } = await openList();

    expect(rowsDrawn(table())).toEqual([
      ['Autumn holiday', '1 October – 2 October 2026', 'Day off', 'Whole branch', '', 'Active'],
      [
        'Seniors exams',
        '5 October – 16 October 2026',
        'Special day',
        'Grades 9–11',
        'Short',
        'Active',
      ],
      ['Teachers day', '14 October 2026', 'Day off', 'Whole branch', '', 'Active'],
      ['Working Saturday', '17 October 2026', 'Special day', 'Whole branch', 'Short', 'Active'],
    ]);
  });

  it('names the kinds in Russian when Russian is chosen', async () => {
    const { table } = await openList('academic_vice_principal', {}, 'ru');

    expect(rowsDrawn(table()).map((row) => row[2])).toEqual([
      ru.setup.calendar.kinds.day_off,
      ru.setup.calendar.kinds.special_day,
      ru.setup.calendar.kinds.day_off,
      ru.setup.calendar.kinds.special_day,
    ]);
  });

  it('adds a working Saturday after its preview', async () => {
    // The list read again after the save holds the new entry.
    let added: object[] = [];
    const { calls } = await openList('academic_vice_principal', {
      'POST /api/setup/calendar-entries/preview': () => json(PREVIEW),
      'POST /api/setup/calendar-entries': (body) => {
        added = [{ ...SATURDAY, ...(body as object), id: uid(5), dayTemplateName: 'Short' }];
        return json(added[0], 201);
      },
      'GET /api/setup/calendar-entries': () =>
        json({ today: TODAY, entries: [PAST, SENIORS, HOLIDAY, SATURDAY, ...added] }),
    });

    fireEvent.click(screen.getByRole('button', { name: en.setup.calendar.add }));
    // In the side panel beside the list (task 2.7c-2a), not above it.
    const form = within(
      await screen.findByRole('complementary', { name: en.setup.calendar.newTitle }),
    ).getByRole('form', { name: en.setup.calendar.newTitle });
    type(within(form).getByLabelText(en.setup.calendar.kind), 'special_day');
    type(within(form).getByLabelText(en.setup.calendar.name), 'Working Saturday');
    type(within(form).getByLabelText(en.setup.calendar.firstDate), '2026-10-17');
    type(within(form).getByLabelText(en.setup.calendar.lastDate), '2026-10-17');
    type(within(form).getByLabelText(en.setup.calendar.template), SHORT);
    type(within(form).getByLabelText(en.setup.calendar.follows), '1');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    const dialog = await screen.findByRole('dialog', { name: en.setup.calendar.previewTitle });
    expect(rowsDrawn(dialog)).toEqual([
      [
        '17 October 2026',
        'Whole branch',
        en.setup.calendar.reasons.not_working_day,
        'Short · lessons of Monday · Working Saturday',
      ],
    ]);
    const record = {
      kind: 'special_day',
      name: 'Working Saturday',
      firstDate: '2026-10-17',
      lastDate: '2026-10-17',
      gradeFrom: null,
      gradeTo: null,
      dayTemplateId: SHORT,
      followsWeekday: 1,
      examWeek: null,
    };
    expect(
      calls.find((call) => call.route === 'POST /api/setup/calendar-entries/preview')?.body,
    ).toEqual({ action: 'create', record });
    expect(calls.some((call) => call.route === 'POST /api/setup/calendar-entries')).toBe(false);

    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.calendar.save }));
    await waitFor(() => {
      // Task 5.6b-2a: with the key of the sorting shown, nothing to decide.
      expect(calls.find((call) => call.route === 'POST /api/setup/calendar-entries')?.body).toEqual(
        {
          ...record,
          dayChangesKey: 'e'.repeat(64),
          dayDecisions: [],
        },
      );
    });
    // The panel shows the saved record (task 2.7c-2a).
    await savedRecordPanel(en.setup.calendar.newTitle);
  });

  it('sends nothing when the preview is cancelled, and says so', async () => {
    const { calls } = await openList('academic_vice_principal', {
      'POST /api/setup/calendar-entries/preview': () => json(PREVIEW),
    });

    fireEvent.click(screen.getByRole('button', { name: en.setup.calendar.add }));
    // In the side panel beside the list (task 2.7c-2a), not above it.
    const form = within(
      await screen.findByRole('complementary', { name: en.setup.calendar.newTitle }),
    ).getByRole('form', { name: en.setup.calendar.newTitle });
    type(within(form).getByLabelText(en.setup.calendar.name), 'Day off');
    type(within(form).getByLabelText(en.setup.calendar.firstDate), '2026-10-20');
    type(within(form).getByLabelText(en.setup.calendar.lastDate), '2026-10-20');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('dialog', { name: en.setup.calendar.previewTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.calendar.cancel }));

    expect(await within(form).findByText(en.form.notSaved)).not.toBeNull();
    expect(calls.some((call) => call.route === 'POST /api/setup/calendar-entries')).toBe(false);
  });

  // Task 5.6b-1: what the save does to the published timetable, and Save off
  // while the server would refuse it.
  it('lists the lessons a save removes, creates and cancels, and keeps Save off while a stored change stops it', async () => {
    const OXFORD = uid(20);
    const MATHS = uid(21);
    const names = {
      units: [{ id: OXFORD, kind: 'class' as const, name: 'Oxford', grades: [7] }],
      subjects: [{ id: MATHS, names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' } }],
      teachers: [],
      rooms: [],
    };
    const lesson = {
      date: '2026-10-19',
      start: 480,
      end: 525,
      unitId: OXFORD,
      subjectId: MATHS,
      teacherIds: [],
      roomId: null,
    };
    const answers = [
      { ...NO_LESSONS, removed: [lesson], notified: [uid(22)], names },
      {
        ...NO_LESSONS,
        cancelled: [{ ...lesson, cause: 'not_in_template' as const }],
        stored: [{ kind: 'day_change' as const, id: uid(23), date: '2026-10-19' }],
        names,
      },
    ];
    let answer = 0;
    await openList('academic_vice_principal', {
      'POST /api/setup/calendar-entries/preview': () =>
        json({ ...PREVIEW, lessons: answers[answer] }),
    });
    fireEvent.click(screen.getByRole('button', { name: en.setup.calendar.add }));
    const form = within(
      await screen.findByRole('complementary', { name: en.setup.calendar.newTitle }),
    ).getByRole('form', { name: en.setup.calendar.newTitle });
    type(within(form).getByLabelText(en.setup.calendar.name), 'Day off');
    type(within(form).getByLabelText(en.setup.calendar.firstDate), '2026-10-19');
    type(within(form).getByLabelText(en.setup.calendar.lastDate), '2026-10-19');

    for (const [index, expected] of [
      [
        en.setup.calendar.lessons.removed_one.replace('{{count}}', '1'),
        en.setup.calendar.lessons.notified_one.replace('{{count}}', '1'),
      ],
      [
        en.setup.calendar.lessons.stored_one.replace('{{count}}', '1'),
        en.setup.calendar.lessons.cancelled_one.replace('{{count}}', '1'),
      ],
    ].entries()) {
      answer = index;
      fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
      const dialog = await screen.findByRole('dialog', { name: en.setup.calendar.previewTitle });
      const section = within(dialog).getByTestId('calendar-lessons');
      for (const text of expected) {
        expect(within(section).getByText(text)).not.toBeNull();
      }
      const save = within(dialog).getByRole('button', { name: en.setup.calendar.save });
      if (index === 0) {
        expect(
          within(section).getByText('19 October 2026 · 08:00–08:45 · 7 Oxford · Mathematics'),
        ).not.toBeNull();
        expect(save).not.toHaveProperty('disabled', true);
      } else {
        expect(
          within(section).getByText(
            `19 October 2026 · 08:00–08:45 · 7 Oxford · Mathematics · ${en.setup.calendar.lessons.causes.not_in_template}`,
          ),
        ).not.toBeNull();
        expect(within(section).getByRole('alert').textContent).toBe(
          en.setup.calendar.lessons.refused,
        );
        expect(save).toHaveProperty('disabled', true);
      }
      fireEvent.click(within(dialog).getByRole('button', { name: en.setup.calendar.cancel }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: en.setup.calendar.previewTitle })).toBeNull();
      });
    }
  });

  it('shows the refusal of the server in words', async () => {
    await openList('academic_vice_principal', {
      'POST /api/setup/calendar-entries/preview': () =>
        json(
          {
            error: {
              code: 'follows_weekday_required',
              message: 'x',
              requestId: 'r',
              details: [{ path: 'followsWeekday', code: 'follows_weekday_required', message: 'x' }],
            },
          },
          409,
        ),
    });

    fireEvent.click(screen.getByRole('button', { name: en.setup.calendar.add }));
    // In the side panel beside the list (task 2.7c-2a), not above it.
    const form = within(
      await screen.findByRole('complementary', { name: en.setup.calendar.newTitle }),
    ).getByRole('form', { name: en.setup.calendar.newTitle });
    type(within(form).getByLabelText(en.setup.calendar.kind), 'special_day');
    type(within(form).getByLabelText(en.setup.calendar.name), 'Saturday');
    type(within(form).getByLabelText(en.setup.calendar.firstDate), '2026-10-17');
    type(within(form).getByLabelText(en.setup.calendar.lastDate), '2026-10-17');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    expect(await within(form).findByText(en.errors.follows_weekday_required)).not.toBeNull();
  });

  // Decision 3 of pull request #47: only dates after today change.
  it('offers a started entry its name and last date only, and no archive', async () => {
    await openList();
    const panel = await openEntry('Seniors exams');
    expect(panelActionNames(panel)).toEqual([en.form.edit]);
    await edit(panel, 'Seniors exams');

    expect(within(panel).getByLabelText(en.setup.calendar.name)).not.toBeNull();
    expect(within(panel).getByLabelText(en.setup.calendar.lastDate)).not.toBeNull();
    expect(within(panel).queryByLabelText(en.setup.calendar.firstDate)).toBeNull();
    expect(within(panel).queryByLabelText(en.setup.calendar.template)).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.setup.calendar.archive })).toBeNull();
  });

  it('keeps an entry wholly in the past read-only', async () => {
    await openList();
    const panel = await openEntry('Autumn holiday');

    expect(within(panel).getByText(en.setup.calendar.pastNote)).not.toBeNull();
    expect(within(panel).queryByRole('form')).toBeNull();
    // Task 2.7c-2b-1: the note is the bottom row's, without a button.
    expect(panelActions(panel)?.textContent).toContain(en.setup.calendar.pastNote);
    expect(panelActionNames(panel)).toEqual([]);
    expect(within(panel).queryByRole('button', { name: en.setup.calendar.archive })).toBeNull();
  });

  it('saves a new name without a preview', async () => {
    const { calls } = await openList('academic_vice_principal', {
      'PATCH /api/setup/calendar-entries/0199a000-0000-7000-8000-000000000001': (body) =>
        json({ ...HOLIDAY, ...(body as object) }),
    });
    const panel = await openEntry('Teachers day');
    expect(panelActionNames(panel)).toEqual([en.form.edit, en.setup.calendar.archive]);
    expect(actionsAreLast(panel)).toBe(true);
    const form = await edit(panel, 'Teachers day');
    type(within(form).getByLabelText(en.setup.calendar.name), 'Teachers and mentors day');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(calls.some((call) => call.route.startsWith('PATCH '))).toBe(true);
    });
    expect(calls.some((call) => call.route.endsWith('/preview'))).toBe(false);
    await savedInPanel(panel);
  });

  it('keeps the form open with its dates when the preview of a change is cancelled', async () => {
    const { calls } = await openList('academic_vice_principal', {
      'POST /api/setup/calendar-entries/preview': () => json(PREVIEW),
    });
    const panel = await openEntry('Teachers day');
    const form = await edit(panel, 'Teachers day');
    type(within(form).getByLabelText(en.setup.calendar.lastDate), '2026-10-15');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('dialog', { name: en.setup.calendar.previewTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.calendar.cancel }));

    expect(await within(form).findByText(en.form.notSaved)).not.toBeNull();
    expect(within(form).getByLabelText<HTMLInputElement>(en.setup.calendar.lastDate).value).toBe(
      '2026-10-15',
    );
    expect(calls.some((call) => call.route.startsWith('PATCH '))).toBe(false);
  });

  it('archives an entry after the preview of the dates it changes', async () => {
    const { calls } = await openList('academic_vice_principal', {
      'POST /api/setup/calendar-entries/preview': () => json(PREVIEW),
      [`POST /api/setup/calendar-entries/${HOLIDAY.id}/archive`]: () =>
        json({ ...HOLIDAY, archivedAt: '2026-10-10T10:00:00.000Z' }),
    });
    const panel = await openEntry('Teachers day');
    fireEvent.click(within(panel).getByRole('button', { name: en.setup.calendar.archive }));
    const dialog = await screen.findByRole('dialog', { name: en.setup.calendar.previewTitle });
    expect(
      calls.some((call) => call.route === `POST /api/setup/calendar-entries/${HOLIDAY.id}/archive`),
    ).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.calendar.save }));
    await waitFor(() => {
      expect(
        calls.some(
          (call) => call.route === `POST /api/setup/calendar-entries/${HOLIDAY.id}/archive`,
        ),
      ).toBe(true);
    });
  });

  // Task 5.6b-2a: the stored one-day changes of the changed dates, sorted;
  // Save waits for a choice for each "needs a decision" item, and the save
  // sends the key of the sorting shown with the choices.
  it('shows the stored changes the archive sorts and sends the key and the choice made', async () => {
    const MOVE = uid(31);
    const OXFORD = uid(32);
    const MATHS = uid(33);
    const sorted: CalendarPreview = {
      ...PREVIEW,
      lessons: {
        ...NO_LESSONS,
        dayChanges: {
          key: 'd'.repeat(64),
          kept: [],
          decide: [
            {
              key: MOVE,
              kind: 'move',
              unitId: OXFORD,
              subjectId: MATHS,
              from: { date: '2026-10-26', start: 480, end: 525, roomId: null },
              to: { date: '2026-10-19', start: 535, end: 580, roomId: null },
              reason: 'Excursion to the museum',
              carriedVersionId: null,
              blocked: [
                {
                  rule: 'day_off',
                  severity: 'blocked',
                  weekday: 1,
                  lessonIds: [],
                  date: '2026-10-19',
                },
              ],
            },
          ],
          dropped: [],
          bulk: [],
        },
        names: {
          units: [{ id: OXFORD, kind: 'class', name: 'Oxford', grades: [7] }],
          subjects: [
            { id: MATHS, names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' } },
          ],
          teachers: [],
          rooms: [],
        },
      },
    };
    const { calls } = await openList('academic_vice_principal', {
      'POST /api/setup/calendar-entries/preview': () => json(sorted),
      [`POST /api/setup/calendar-entries/${HOLIDAY.id}/archive`]: () =>
        json({ ...HOLIDAY, archivedAt: '2026-10-10T10:00:00.000Z' }),
    });
    const panel = await openEntry('Teachers day');
    fireEvent.click(within(panel).getByRole('button', { name: en.setup.calendar.archive }));
    const dialog = await screen.findByRole('dialog', { name: en.setup.calendar.previewTitle });
    const save = within(dialog).getByRole('button', { name: en.setup.calendar.save });
    expect(save).toHaveProperty('disabled', true);

    fireEvent.click(
      within(dialog).getByRole('radio', { name: en.timetable.publish.dayChanges.choice_drop }),
    );
    expect(save).toHaveProperty('disabled', false);
    fireEvent.click(save);
    await waitFor(() => {
      expect(
        calls.find(
          (call) => call.route === `POST /api/setup/calendar-entries/${HOLIDAY.id}/archive`,
        )?.body,
      ).toEqual({ dayChangesKey: 'd'.repeat(64), dayDecisions: [{ key: MOVE, choice: 'drop' }] });
    });
  });

  // Task 5.6b-2b: the shortened days of the changed dates with the lessons
  // kept; a tick asks the preview again with it, and the save sends it.
  it('shows the shortened days, asks the preview again with the ticks and sends them with the save', async () => {
    const OXFORD = uid(41);
    const subjects = [uid(42), uid(43), uid(44)];
    const day = (kept: number[], chosen: boolean) => ({
      date: '2026-10-19',
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
    const withDay = (kept: number[], chosen: boolean, refused = false): CalendarPreview => ({
      ...PREVIEW,
      lessons: {
        ...NO_LESSONS,
        shortenedDays: [day(kept, chosen)],
        keepRefusals: refused
          ? [{ date: '2026-10-19', classId: OXFORD, code: 'day_keep_over_slots' }]
          : [],
        names: {
          units: [{ id: OXFORD, kind: 'class', name: 'Oxford', grades: [7] }],
          subjects: ['Mathematics', 'Art', 'Music'].map((name, index) => ({
            id: subjects[index] ?? '',
            names: { uz: name, ru: name, en: name },
          })),
          teachers: [],
          rooms: [],
        },
      },
    });
    const { calls } = await openList('academic_vice_principal', {
      'POST /api/setup/calendar-entries/preview': (body) => {
        const keeps = (body as { dayKeeps?: { slotPositions: number[] }[] }).dayKeeps;
        const ticked = keeps?.[0]?.slotPositions;
        if (ticked === undefined || ticked.length === 0) return json(withDay([1, 3], false));
        return json(withDay(ticked, true, ticked.length > 2));
      },
      [`POST /api/setup/calendar-entries/${HOLIDAY.id}/archive`]: () =>
        json({ ...HOLIDAY, archivedAt: '2026-10-10T10:00:00.000Z' }),
    });
    const panel = await openEntry('Teachers day');
    fireEvent.click(within(panel).getByRole('button', { name: en.setup.calendar.archive }));
    const dialog = await screen.findByRole('dialog', { name: en.setup.calendar.previewTitle });
    const box = (name: string) =>
      within(dialog).getByRole<HTMLInputElement>('checkbox', { name: new RegExp(name) });
    expect([box('Mathematics').checked, box('Art').checked, box('Music').checked]).toEqual([
      true,
      true,
      false,
    ]);
    const save = within(dialog).getByRole('button', { name: en.setup.calendar.save });
    expect(save).toHaveProperty('disabled', false);

    // Three ticked on a day of two lesson slots: listed, Save off.
    fireEvent.click(box('Music'));
    await waitFor(() => {
      expect(dialog.querySelector('[data-keep-refusals]')).not.toBeNull();
    });
    expect(dialog.querySelector('[data-too-many]')).not.toBeNull();
    expect(save).toHaveProperty('disabled', true);

    fireEvent.click(box('Art'));
    await waitFor(() => {
      expect(box('Art').checked).toBe(false);
    });
    await waitFor(() => {
      expect(save).toHaveProperty('disabled', false);
    });
    expect(dialog.querySelector('[data-chosen]')).not.toBeNull();
    const previews = calls.filter(
      (call) => call.route === 'POST /api/setup/calendar-entries/preview',
    );
    expect(previews.at(-1)?.body).toEqual({
      action: 'archive',
      id: HOLIDAY.id,
      dayKeeps: [{ date: '2026-10-19', classId: OXFORD, slotPositions: [1, 5] }],
    });
    fireEvent.click(save);
    await waitFor(() => {
      expect(
        calls.find(
          (call) => call.route === `POST /api/setup/calendar-entries/${HOLIDAY.id}/archive`,
        )?.body,
      ).toEqual({
        dayChangesKey: 'e'.repeat(64),
        dayDecisions: [],
        dayKeeps: [{ date: '2026-10-19', classId: OXFORD, slotPositions: [1, 5] }],
      });
    });
  });

  it('lets the Principal read without adding or changing', async () => {
    await openList('principal');

    expect(screen.queryByRole('button', { name: en.setup.calendar.add })).toBeNull();
    const panel = await openEntry('Teachers day');
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.setup.calendar.archive })).toBeNull();
    expect(panelActions(panel)).toBeNull();
  });

  it('tells what every grade has on a date', async () => {
    const day: CalendarDate = {
      date: '2026-10-14',
      grades: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((grade) => ({
        grade,
        day:
          grade < 9
            ? {
                lessons: true,
                dayTemplateId: uid(8),
                dayTemplateName: 'Main',
                followsWeekday: 3,
                examWeek: null,
                entryId: null,
                entryName: null,
              }
            : { lessons: false, reason: 'day_off', entryId: uid(6), entryName: 'Seniors off' },
      })),
    };
    await openList('principal', { 'GET /api/setup/calendar-day': () => json(day) });
    const check = screen.getByRole('region', { name: en.setup.calendar.checkTitle });
    type(within(check).getByLabelText(en.setup.calendar.checkDate), '2026-10-14');

    const table = await within(check).findByRole('table');
    await waitFor(() => {
      expect(rowsDrawn(table)).toHaveLength(11);
    });
    expect(rowsDrawn(table)[0]).toEqual(['1', 'Main']);
    expect(rowsDrawn(table)[8]).toEqual([
      '9',
      `${en.setup.calendar.reasons.day_off} (Seniors off)`,
    ]);
  });
});
