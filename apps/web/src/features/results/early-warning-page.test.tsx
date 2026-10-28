import type { EarlyWarningList, SessionResponse } from '@sodiq/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e900-0000-7000-8000-${String(n).padStart(12, '0')}`;

const SUBJECT = {
  id: uid(10),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  colour: 'blue' as const,
};
const QUARTER = {
  id: uid(1),
  number: 1,
  startDate: '2026-09-01',
  endDate: '2026-10-31',
  closed: false,
};
const JOURNAL = { id: uid(21), unit: { kind: 'class' as const, id: uid(20), name: '7 Oxford' } };
const THRESHOLDS = {
  lowResult: 50,
  resultDrop: 15,
  attendancePercent: 80,
  absencesInRow: 3,
  gradedWorks: 5,
};

// All names are invented. Task 9.4a: the early-warning list (08, Early-warning list: "Each entry
// shows the reason, the figures and the trend, with a link to the journal"; "Handled. A Tutor or
// teacher can add a staff-only note ... and mark the entry as handled").
const LIST: EarlyWarningList = {
  quarter: QUARTER,
  quarters: [QUARTER],
  thresholds: THRESHOLDS,
  prepared: { updatedAt: '2026-10-20T05:00:00.000Z', updating: false },
  daysAgoDate: '2026-09-29',
  entries: [
    {
      student: { id: uid(51), firstName: 'Anvar', lastName: 'Aliyev', paternalName: null },
      subject: SUBJECT,
      journal: JOURNAL,
      attendanceOnly: false,
      figures: {
        result: 44,
        currentWork: { now: 44, daysAgo: 93, previousQuarter: 100 },
        attendance: 43,
        absenceRun: 4,
        gradedWorks: 10,
      },
      reasons: [
        { kind: 'low_result', figure: 44, against: [], handledBefore: null },
        {
          kind: 'result_drop',
          figure: 56,
          against: ['days_ago', 'previous_quarter'],
          handledBefore: null,
        },
        {
          kind: 'low_attendance',
          figure: 43,
          against: [],
          handledBefore: {
            note: 'Called the family.',
            handledAt: '2026-10-20T07:00:00.000Z',
            figure: 50,
            by: 'Karimova Malika',
          },
        },
      ],
      canHandle: true,
    },
    {
      student: { id: uid(52), firstName: 'Sevara', lastName: 'Saidova', paternalName: null },
      subject: SUBJECT,
      journal: JOURNAL,
      attendanceOnly: false,
      figures: {
        result: 71,
        currentWork: { now: 71, daysAgo: 67, previousQuarter: null },
        attendance: 14,
        absenceRun: 3,
        gradedWorks: 5,
      },
      reasons: [{ kind: 'absences_in_row', figure: 3, against: [], handledBefore: null }],
      canHandle: true,
    },
  ],
};

const rowsOf = () =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

const open = (
  assignments: SessionResponse['assignments'],
  list: EarlyWarningList = LIST,
  language: 'en' | 'ru' = 'en',
  path = '/results/early-warning',
) => {
  const calls = fakeApi({
    'GET /api/auth/session': () => json(sessionOf({ language, assignments })),
    'GET /api/results/early-warning': () => json(list),
    'POST /api/results/early-warning/handled': () =>
      json({ handledAt: '2026-10-27T07:00:00.000Z' }, 201),
  });
  renderApp(path, language);
  return calls;
};

const anvar = `${uid(51)}|${SUBJECT.id}`;

describe('the early-warning page', () => {
  it('lists each student and subject with the reasons measured against the thresholds', async () => {
    open([{ role: 'teacher', branchId: NORTH.id }]);
    await screen.findByRole('heading', { name: en.results.earlyWarning.title });
    await waitFor(() => {
      expect(rowsOf().map((row) => row.slice(0, 6))).toEqual([
        [
          'Aliyev Anvar',
          'Mathematics',
          '7 Oxford',
          'Result 44, below 50Result down by 56Attendance 43%, below 80%',
          '44',
          '43%',
        ],
        ['Saidova Sevara', 'Mathematics', '7 Oxford', 'Absences in a row: 3', '71', '14%'],
      ]);
    });
  });

  it('shows the trend, the earlier handling and the journal link in the panel, and marks a reason handled with a note', async () => {
    const calls = open(
      [{ role: 'teacher', branchId: NORTH.id }],
      LIST,
      'en',
      `/results/early-warning?open=${encodeURIComponent(anvar)}`,
    );
    const trend = await waitFor(() => {
      const found = document.querySelector('[data-trend]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(trend?.textContent).toBe('Now 44 · 28 days ago 93 · previous quarter 100');
    const drop = document.querySelector('[data-panel-reason="result_drop"]');
    expect(drop?.textContent).toBe(
      'Result down by 56 (against 28 days ago, against the previous quarter)',
    );
    expect(
      document.querySelector('[data-panel-reason="low_attendance"] [data-handled-before]')
        ?.textContent,
    ).toContain('Karimova Malika at 50: Called the family.');
    expect(
      screen.getByRole('link', { name: en.results.earlyWarning.openJournal }).getAttribute('href'),
    ).toBe(`/journal/${JOURNAL.id}`);

    fireEvent.change(screen.getByLabelText(en.results.earlyWarning.which), {
      target: { value: 'low_attendance' },
    });
    fireEvent.change(screen.getByLabelText(en.results.earlyWarning.note), {
      target: { value: 'Spoke to the parents.' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.results.earlyWarning.handle }));
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.route === 'POST /api/results/early-warning/handled')
          .map((call) => call.body),
      ).toEqual([
        {
          quarterId: QUARTER.id,
          studentId: uid(51),
          subjectId: SUBJECT.id,
          reason: 'low_attendance',
          note: 'Spoke to the parents.',
        },
      ]);
    });
    expect((await screen.findByText(en.results.earlyWarning.handled)).getAttribute('role')).toBe(
      'status',
    );
  });

  it('offers no "Mark handled" to a reader the server does not let mark, nor in a closed quarter', async () => {
    open(
      [{ role: 'head_teacher', branchId: NORTH.id }],
      {
        ...LIST,
        quarter: { ...QUARTER, closed: true },
        quarters: [{ ...QUARTER, closed: true }],
        entries: LIST.entries.map((entry) => ({ ...entry, canHandle: false })),
      },
      'en',
      `/results/early-warning?open=${encodeURIComponent(anvar)}`,
    );
    await waitFor(() => {
      expect(document.querySelector('[data-trend]')).not.toBeNull();
    });
    expect(screen.queryByRole('button', { name: en.results.earlyWarning.handle })).toBeNull();
    expect(document.querySelector('[data-closed]')?.textContent).toBe(
      en.results.earlyWarning.closed,
    );
  });

  it('shows the empty line when nobody is listed', async () => {
    open([{ role: 'head_tutor', branchId: NORTH.id }], { ...LIST, entries: [] });
    expect(await screen.findByText(en.results.earlyWarning.empty)).toBeTruthy();
  });

  it('reads in Russian', async () => {
    open([{ role: 'tutor', branchId: NORTH.id }], LIST, 'ru');
    await screen.findByRole('heading', { name: ru.results.earlyWarning.title });
    await waitFor(() => {
      expect(rowsOf()[1]?.[3]).toBe('Пропусков подряд: 3');
    });
  });
});
