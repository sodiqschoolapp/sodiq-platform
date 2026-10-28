import type {
  AttendanceToday,
  BranchSummary,
  EarlyWarningEntry,
  LessonsToday,
  Role,
} from '@sodiq/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const sessionAs = (role: Role, language: 'en' | 'ru' = 'en') => ({
  ...sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
  }),
  language,
});

const CLASS_A = uid(10);
const CLASS_B = uid(11);

const ATTENDANCE: AttendanceToday = {
  date: '2026-10-19',
  prepared: { updatedAt: '2026-10-20T05:00:00.000Z', updating: false },
  weekFrom: '2026-10-19',
  threshold: 65,
  total: { attended: 6, marked: 9, unmarked: 1, exempt: 1, percent: 67 },
  classes: [
    {
      class: { id: CLASS_B, name: '7 Oxford', grade: 7 },
      day: { attended: 3, marked: 4, unmarked: 0, exempt: 0, percent: 75 },
      week: { attended: 3, marked: 4, unmarked: 0, exempt: 0, percent: 75 },
      below: false,
      absentNow: null,
    },
    {
      class: { id: CLASS_A, name: '7 Cambridge', grade: 7 },
      day: { attended: 3, marked: 5, unmarked: 1, exempt: 1, percent: 60 },
      week: { attended: 7, marked: 10, unmarked: 1, exempt: 1, percent: 70 },
      below: true,
      absentNow: null,
    },
  ],
};

const entry: EarlyWarningEntry = {
  student: { id: uid(20), firstName: 'Anvar', lastName: 'Aliyev', paternalName: null },
  subject: {
    id: uid(21),
    names: { uz: 'Matematika', ru: 'Математика', en: 'Maths' },
    colour: 'red',
  },
  journal: { id: uid(22), unit: { kind: 'class', id: CLASS_A, name: '7 Cambridge' } },
  attendanceOnly: false,
  figures: {
    result: 40,
    currentWork: { now: 40, daysAgo: null, previousQuarter: null },
    attendance: 60,
    absenceRun: 0,
    gradedWorks: 5,
  },
  reasons: [{ kind: 'low_result', figure: 40, against: [], handledBefore: null }],
  canHandle: true,
};

const earlyWarning = (entries: EarlyWarningEntry[]) => ({
  quarter: null,
  quarters: [],
  thresholds: {
    lowResult: 50,
    resultDrop: 15,
    attendancePercent: 80,
    absencesInRow: 3,
    gradedWorks: 5,
  },
  daysAgoDate: null,
  prepared: { updatedAt: '2026-10-20T05:00:00.000Z', updating: false },
  entries,
});

// Task 9.4b: the first screens of `08`, Home pages by role. Every figure is the server's.
describe('the home pages of each role (08, Home pages by role)', () => {
  it("gives the Tutor a card per own class with the day, the week and who is absent now, and the class's early-warning list", async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('tutor')),
      'GET /api/journal/attendance-today': () =>
        json({
          ...ATTENDANCE,
          classes: [
            {
              ...ATTENDANCE.classes[1],
              absentNow: [
                {
                  student: {
                    id: uid(20),
                    firstName: 'Anvar',
                    lastName: 'Aliyev',
                    paternalName: null,
                  },
                  since: '2026-10-19T03:00:00.000Z',
                },
              ],
            },
          ],
        }),
      'GET /api/timetable/views/class': () =>
        json({
          kind: 'class',
          span: 'day',
          today: '2026-10-19',
          subject: { id: CLASS_A, name: '7 Cambridge' },
          classes: [{ id: CLASS_A, name: '7 Cambridge' }],
          days: [],
          lessons: [],
          exams: [],
          busy: [],
        }),
      'GET /api/results/early-warning': () => json(earlyWarning([entry])),
    });
    renderApp('/');
    const card = await screen.findByRole('region', {
      name: en.home.tutorClass.classTitle.replace('{{name}}', '7 Cambridge'),
    });
    expect(within(card).getByText('60% (3 of 5) · 1 unmarked · 1 exempt')).toBeDefined();
    expect(within(card).getByText('70% (7 of 10) · 1 unmarked · 1 exempt')).toBeDefined();
    const absent = card.querySelector('[data-absent-now]') as HTMLElement;
    expect(within(absent).getByText('Aliyev Anvar')).toBeDefined();
    const warning = await screen.findByRole('region', {
      name: en.home.earlyWarning.forClass.replace('{{name}}', '7 Cambridge'),
    });
    expect(within(warning).getByText('Aliyev Anvar')).toBeDefined();
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.route === 'GET /api/results/early-warning' && call.query === `?classId=${CLASS_A}`,
        ),
      ).toBe(true);
    });
    // The class's timetable today, here empty; the Tutor's own lessons stay below (task 5.9b).
    const today = card.querySelector('[data-class-today]') as HTMLElement;
    expect(await within(today).findByText(en.home.lessons.noToday)).toBeDefined();
    const own = (await screen.findAllByText(en.home.lessons.noToday)).filter(
      (line) => !card.contains(line),
    );
    expect(own).toHaveLength(1);
  });

  it('gives the Head Tutor every class today with those below the threshold first and marked, in Russian', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs('head_tutor', 'ru')),
      'GET /api/journal/attendance-today': () => json(ATTENDANCE),
    });
    renderApp('/', 'ru');
    const card = await screen.findByRole('region', { name: ru.home.attendance.allClasses });
    await waitFor(() => {
      expect(card.querySelectorAll('tbody tr')).toHaveLength(2);
    });
    const rows = [...card.querySelectorAll('tbody tr')];
    expect(rows.map((row) => row.getAttribute('data-class'))).toEqual([CLASS_A, CLASS_B]);
    expect(rows[0]?.querySelector('td')?.textContent).toBe(
      `7 Cambridge · ${ru.home.attendance.belowMark}`,
    );
    expect(rows[1]?.querySelector('td')?.textContent).toBe('7 Oxford');
    expect(within(card).getByText('1 класс ниже 65%')).toBeDefined();
  });

  it('shows a failed attendance with its retry', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs('spiritual_vice_principal')),
      'GET /api/journal/attendance-today': () => refusal('internal_error', 500),
    });
    renderApp('/');
    const card = await screen.findByRole('region', { name: en.home.attendance.allClasses });
    expect(await within(card).findByRole('button', { name: en.problems.retry })).toBeDefined();
  });

  it('gives a Head Teacher quick entry to own journals, the early-warning list of own journals and the requests waiting', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('head_teacher')),
      'GET /api/plans/requests': () =>
        json({
          requests: [
            { canDecide: true, late: true },
            { canDecide: true, late: false },
            { canDecide: false, late: false },
          ].map((one, index) => planRequest(index, one)),
          events: [],
        }),
    });
    renderApp('/');
    const requests = await screen.findByRole('region', { name: en.home.requests.title });
    expect(await within(requests).findByText('2 plan requests')).toBeDefined();
    expect(within(requests).getByText('· 1 late', { exact: false })).toBeDefined();
    expect(within(requests).getByText('0 unlock requests')).toBeDefined();
    expect(await screen.findByRole('region', { name: en.home.journals.title })).toBeDefined();
    expect(await screen.findByText(en.home.earlyWarning.nobody)).toBeDefined();
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.route === 'GET /api/results/early-warning' && call.query === '?for=own_journals',
        ),
      ).toBe(true);
    });
  });

  it('shows no requests card to a Teacher', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionAs('teacher')) });
    renderApp('/');
    expect(await screen.findByRole('region', { name: en.home.journals.title })).toBeDefined();
    expect(screen.queryByRole('region', { name: en.home.requests.title })).toBeNull();
  });

  it("gives the Academic Vice Principal today's lessons by status, the conflicts and the quarter's checklist", async () => {
    const today: LessonsToday = {
      date: '2026-10-19',
      ahead: 2,
      prepared: { updatedAt: '2026-10-20T05:00:00.000Z', updating: false },
      held: 5,
      notStarted: 1,
      inProgress: 1,
      complete: 3,
      incomplete: [],
    };
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students/no-class': () => json({ count: 0 }),
      'GET /api/people/relatives/no-valid-phone': () => json({ count: 0 }),
      'GET /api/timetable/attention': () =>
        json({
          needsTeacher: [],
          unresolved: [],
          needsInvigilator: [],
          needsRoom: [],
          examsNeedRoom: [],
        }),
      'GET /api/journal/lessons-today': () => json(today),
      'GET /api/timetable/conflicts-summary': () =>
        json({
          drafts: [
            {
              id: uid(30),
              number: 2,
              startsOn: '2026-11-02',
              blocked: 2,
              warnings: 1,
              outOfDate: false,
            },
          ],
          published: { id: uid(31), number: 1, startsOn: '2026-09-01', blocked: 0, warnings: 3 },
        }),
    });
    renderApp('/');
    const lessons = await screen.findByRole('region', { name: en.home.vice.lessonsToday });
    expect(await within(lessons).findByText('3 of 5 lessons complete')).toBeDefined();
    const conflicts = await screen.findByRole('region', { name: en.home.vice.conflicts });
    expect(await within(conflicts).findByText('2 errors')).toBeDefined();
    expect(within(conflicts).getByText('Version 1 in force: 3 warnings')).toBeDefined();
    expect(await screen.findByRole('region', { name: en.home.vice.quarter })).toBeDefined();
    expect(
      await screen.findByRole('region', { name: en.home.earlyWarning.forBranch }),
    ).toBeDefined();
  });

  it('gives the Principal the branch summary with results by grade in one decimal, in Russian', async () => {
    const summary: BranchSummary = {
      date: '2026-10-19',
      students: 1840,
      staff: 196,
      prepared: { updatedAt: '2026-10-20T05:00:00.000Z', updating: false },
      attendanceToday: { attended: 6, marked: 9, unmarked: 1, exempt: 1, percent: 67 },
      quarter: { id: uid(40), number: 1, closed: false },
      grades: [{ grade: 7, value: 643, rated: 7, students: 9 }],
    };
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs('principal', 'ru')),
      'GET /api/results/branch-summary': () => json(summary),
    });
    renderApp('/', 'ru');
    const attendance = await screen.findByRole('region', { name: ru.home.summary.attendance });
    expect(within(attendance).getByText('67%')).toBeDefined();
    const grades = await screen.findByRole('region', {
      name: ru.home.summary.resultsOf.replace('{{number}}', '1'),
    });
    const row = grades.querySelector('tbody tr') as HTMLElement;
    expect([...row.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual([
      '7 класс',
      '64,3',
      '7 из 9',
    ]);
    expect(within(grades).getByText(ru.home.summary.provisional)).toBeDefined();
  });
});

function planRequest(index: number, input: { canDecide: boolean; late: boolean }) {
  return {
    id: uid(50 + index),
    journalId: uid(60),
    quarterId: uid(61),
    quarter: 1,
    unit: { kind: 'class', id: CLASS_A, name: '7 Cambridge' },
    subject: {
      id: uid(21),
      names: { uz: 'Matematika', ru: 'Математика', en: 'Maths' },
      colour: 'red',
    },
    owner: 'Karimova Aziza',
    kind: 'text',
    status: 'sent',
    fromDate: null,
    lessons: [],
    reason: 'A day off moved the lessons',
    causes: [],
    sentAt: '2026-10-15T05:00:00.000Z',
    decidedBy: null,
    decidedAt: null,
    decisionReason: '',
    days: null,
    openUntil: null,
    open: false,
    finishedAt: null,
    waitingDays: input.late ? 3 : 0,
    late: input.late,
    canDecide: input.canDecide,
  };
}
