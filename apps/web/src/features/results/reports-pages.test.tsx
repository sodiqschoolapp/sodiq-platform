import type {
  AttendanceReport,
  DisciplineItems,
  LoadReport,
  ResultsReportChoices,
  ResultsTable,
  SessionResponse,
  SubjectMastery,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199ea00-0000-7000-8000-${String(n).padStart(12, '0')}`;

const NAMES = { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' };
const SUBJECT = { id: uid(10), names: NAMES, colour: 'blue' as const };
const CLASS = { id: uid(20), name: '7 Oxford', grade: 7 };
const QUARTER = {
  id: uid(1),
  number: 1,
  startDate: '2026-09-01',
  endDate: '2026-10-31',
  closed: false,
  notOfficial: false,
};
const FRESH = { updatedAt: '2026-10-27T05:00:00.000Z', updating: false };
const counts = (present: number, absent: number, exempt: number) => {
  const expected = present + absent;
  return {
    present,
    late: 0,
    absent,
    skipped: 0,
    unmarked: 0,
    exempt,
    expected,
    percents: {
      present: Math.round((present * 100) / expected),
      late: 0,
      absent: Math.round((absent * 100) / expected),
      skipped: 0,
      unmarked: 0,
      exempt: Math.round((exempt * 100) / (expected + exempt)),
    },
  };
};
const daily = (attended: number, marked: number) => ({
  attended,
  marked,
  unmarked: 0,
  exempt: 0,
  percent: Math.round((attended * 100) / marked),
});

// All names are invented. Task 9.3b-2: the reports of 08, Analytics in Release 1.
const ATTENDANCE: AttendanceReport = {
  from: '2026-10-12',
  to: '2026-10-31',
  groupBy: 'class',
  prepared: { updatedAt: null, updating: true },
  total: { counts: counts(8, 2, 1), daily: daily(8, 10) },
  rows: [{ key: { kind: 'class', class: CLASS }, counts: counts(8, 2, 1), daily: daily(8, 10) }],
  days: [],
  choices: {
    grades: [7],
    classes: [CLASS],
    subjects: [{ id: SUBJECT.id, names: NAMES }],
    teachers: [{ id: uid(30), name: 'Karimova Malika' }],
    starts: [480, 535],
  },
};

const CHOICES: ResultsReportChoices = {
  year: { id: uid(2), startDate: '2026-09-01', endDate: '2027-05-31', status: 'current' },
  years: [{ id: uid(2), startDate: '2026-09-01', endDate: '2027-05-31', status: 'current' }],
  quarters: [QUARTER],
  classes: [{ ...CLASS, language: 'uz' }],
  subjects: [{ id: SUBJECT.id, names: NAMES }],
};

const STATE = { quarter: QUARTER, prepared: FRESH, provisional: true, final: null };

const TABLE: ResultsTable = {
  ...STATE,
  class: CLASS,
  subjects: [SUBJECT],
  rows: [
    {
      student: { id: uid(51), firstName: 'Aziz', lastName: 'Akbarov', paternalName: null },
      results: [{ subjectId: SUBJECT.id, state: 'number', value: 88, grade: 5 }],
    },
    {
      student: { id: uid(52), firstName: 'Gulnora', lastName: 'Gulomova', paternalName: null },
      results: [{ subjectId: SUBJECT.id, state: 'exempt', value: null, grade: null }],
    },
  ],
};

const MASTERY: SubjectMastery = {
  ...STATE,
  subject: SUBJECT,
  bands: [
    { grade: 5, from: 84, to: 100, students: 1, percent: 50 },
    { grade: 4, from: 67, to: 83, students: 1, percent: 50 },
    { grade: 3, from: 50, to: 66, students: 0, percent: 0 },
    { grade: 2, from: 0, to: 49, students: 0, percent: 0 },
  ],
  counted: 2,
  exempt: 1,
  notAssessed: 0,
  noResult: 0,
  choices: { grades: [7], classes: [CLASS], teachers: [], journals: [] },
};

const LOAD: LoadReport = {
  week: '2026-10-12',
  departments: [],
  teachers: [
    {
      teacher: { id: uid(30), name: 'Karimova Malika' },
      vacancy: false,
      lessons: 17,
      planned: 18,
      elsewhere: 2,
      contract: 20,
      total: 20,
      againstContract: 'equal',
      invigilations: 1,
    },
  ],
  classes: [],
  rooms: [{ room: { id: uid(40), name: '204' }, lessons: 3, periods: 4, percent: 75 }],
  freePeriods: [{ class: CLASS, weekday: 1, start: 535, end: 580 }],
};

const rowsOf = () =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

const file = () =>
  new Response(new Blob(['xlsx']), {
    status: 200,
    headers: { 'Content-Disposition': 'attachment; filename="report.xlsx"' },
  });

const open = (assignments: SessionResponse['assignments'], path: string) => {
  const calls = fakeApi({
    'GET /api/auth/session': () => json(sessionOf({ language: 'en', assignments })),
    'GET /api/results/reports/attendance': () => json(ATTENDANCE),
    'POST /api/results/reports/attendance/export': file,
    'GET /api/results/reports/choices': () => json(CHOICES),
    'GET /api/results/reports/results-table': () => json(TABLE),
    'GET /api/results/reports/subject-mastery': () => json(MASTERY),
    'POST /api/results/reports/export': file,
    'GET /api/timetable/reports/load': () => json(LOAD),
    'POST /api/timetable/reports/load/export': file,
  });
  renderApp(path, 'en');
  return calls;
};

const VICE = [{ role: 'academic_vice_principal' as const, branchId: NORTH.id }];

describe('the reports of 08 (task 9.3b-2)', () => {
  it('lists the reports the role views on the Reports page', async () => {
    open([{ role: 'spiritual_vice_principal', branchId: NORTH.id }], '/results/reports');
    await screen.findByRole('heading', { name: en.results.reports.title });
    expect(screen.getByRole('link', { name: en.results.reports.links.attendance })).toBeTruthy();
    expect(screen.queryByRole('link', { name: en.results.reports.links.table })).toBeNull();
    expect(screen.queryByRole('link', { name: en.results.reports.links.load })).toBeNull();
  });

  it('shows the attendance counts with their percents and the daily percent, "updating", and sends the filters', async () => {
    const calls = open(VICE, '/results/attendance?from=2026-10-12&to=2026-10-31&start=480');
    await waitFor(() => {
      expect(rowsOf()).toEqual([
        ['7 Oxford', '8 · 80%', '0 · 0%', '2 · 20%', '0 · 0%', '0 · 0%', '1 · 9%', '10', '80%'],
      ]);
    });
    // edge/system-behaviour: behind the journal, the page says so.
    expect(document.body.textContent).toContain(en.prepared.updating);
    expect(calls.find((call) => call.route === 'GET /api/results/reports/attendance')?.query).toBe(
      '?from=2026-10-12&to=2026-10-31&groupBy=class&start=480',
    );
    fireEvent.click(screen.getByRole('button', { name: en.results.reports.excel }));
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.route === 'POST /api/results/reports/attendance/export')
          .map((call) => call.body),
      ).toEqual([{ from: '2026-10-12', to: '2026-10-31', groupBy: 'class', start: 480 }]);
    });
  });

  it('refuses the page to a role outside the area', async () => {
    open([{ role: 'teacher', branchId: NORTH.id }], '/results/attendance');
    await screen.findByRole('heading', { name: en.problems.noAccessTitle });
  });

  it('draws the results table with a column per subject, the result and grade or the state', async () => {
    open(VICE, '/results/table');
    await waitFor(() => {
      expect(rowsOf()).toEqual([
        ['Akbarov Aziz', '88 · 5'],
        ['Gulomova Gulnora', en.results.reports.table.states.exempt],
      ]);
    });
    expect(screen.getByRole('columnheader', { name: /Mathematics/ })).toBeTruthy();
    expect(document.body.textContent).toContain(en.results.reports.provisional);
  });

  it('shares the students among the bands, the exempt beside them, and exports the mastery with its filters', async () => {
    const calls = open(VICE, `/results/mastery?grade=7`);
    await waitFor(() => {
      expect(rowsOf()).toEqual([
        ['5', '84–100', '1', '50%'],
        ['4', '67–83', '1', '50%'],
        ['3', '50–66', '0', '0%'],
        ['2', '0–49', '0', '0%'],
        [en.results.reports.mastery.exempt, en.results.reports.mastery.beside, '1', '—'],
        [en.results.reports.mastery.notAssessed, en.results.reports.mastery.beside, '0', '—'],
        [en.results.reports.mastery.noResult, en.results.reports.mastery.beside, '0', '—'],
      ]);
    });
    fireEvent.click(screen.getByRole('button', { name: en.results.reports.excel }));
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.route === 'POST /api/results/reports/export')
          .map((call) => call.body),
      ).toEqual([{ kind: 'mastery', quarterId: QUARTER.id, subjectId: SUBJECT.id, grade: 7 }]);
    });
  });

  it('shows each list of the load report: the teachers, the rooms and the free periods', async () => {
    open(VICE, '/results/load?week=2026-10-12');
    await waitFor(() => {
      expect(rowsOf()).toEqual([
        [
          'Karimova Malika',
          '17',
          '18',
          '2',
          '20',
          '20',
          en.results.reports.load.contractStates.equal,
          '1',
        ],
      ]);
    });
    fireEvent.click(screen.getByRole('radio', { name: en.results.reports.load.rooms }));
    await waitFor(() => {
      expect(rowsOf()).toEqual([['204', '3', '4', '75%']]);
    });
    fireEvent.click(screen.getByRole('radio', { name: en.results.reports.load.freePeriods }));
    await waitFor(() => {
      expect(rowsOf()).toEqual([['7 Oxford', en.dates.weekdays['1'], '08:55–09:40']]);
    });
  });
});

describe('the journal discipline report (task 9.3b-2)', () => {
  const ITEMS: DisciplineItems = {
    teacher: { id: uid(30), name: 'Karimova Malika' },
    column: 'lateEntries',
    items: [
      {
        kind: 'entries',
        lessonId: uid(61),
        journalId: uid(21),
        date: '2026-10-12',
        start: 480,
        unit: { kind: 'class', id: CLASS.id, name: CLASS.name },
        subject: SUBJECT,
        count: 1,
      },
      {
        kind: 'exam_entries',
        lessonId: null,
        journalId: uid(21),
        date: '2026-10-19',
        start: null,
        unit: { kind: 'class', id: CLASS.id, name: CLASS.name },
        subject: SUBJECT,
        count: 1,
      },
    ],
  };

  it('opens the items behind a count and exports the counts with the range', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionOf({ language: 'en', assignments: VICE })),
      'GET /api/journal/discipline': () =>
        json({
          from: '2026-10-12',
          to: '2026-10-28',
          departments: [],
          prepared: FRESH,
          teachers: [
            {
              teacher: ITEMS.teacher,
              held: 3,
              notStarted: 0,
              inProgress: 0,
              complete: 1,
              lockedIncomplete: 2,
              noAttendance: 0,
              noTopic: 0,
              worksMissing: 0,
              unplanned: 1,
              lateEntries: 2,
            },
          ],
        }),
      'GET /api/journal/discipline/items': () => json(ITEMS),
      'POST /api/journal/discipline/export': file,
    });
    renderApp('/journal/discipline?from=2026-10-12&to=2026-10-28', 'en');
    const button = await screen.findByRole('button', {
      name: en.journal.discipline.showItems.replace(
        '{{column}}',
        en.journal.discipline.lateEntries,
      ),
    });
    fireEvent.click(button);
    await screen.findByRole('heading', {
      name: `Karimova Malika: ${en.journal.discipline.lateEntries}`,
    });
    await waitFor(() => {
      expect(
        [...document.querySelectorAll('[role="dialog"] tbody tr')].map(
          (row) => row.querySelector('[data-count]')?.textContent,
        ),
      ).toEqual(['1', '1']);
    });
    expect(
      calls.find((call) => call.route === 'GET /api/journal/discipline/items')?.query,
    ).toContain('column=lateEntries');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.click(await screen.findByRole('button', { name: en.results.reports.excel }));
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.route === 'POST /api/journal/discipline/export')
          .map((call) => call.body),
      ).toEqual([{ from: '2026-10-12', to: '2026-10-28' }]);
    });
  });
});
