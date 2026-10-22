import type { HomeBusy, HomeExam, HomeLesson, Role, TeachingHome } from '@sodiq/shared';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf, SOUTH } from '@/testing/render-app';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// All names are invented. Task 5.9b, pull request #198: the home page of a
// person who teaches (06, Teachers who work in several branches: "Today's
// lessons from all branches appear together in time order, each labelled with
// its branch"; Views and outputs: "Teacher home page: today's lessons as a
// list ... and the week as a table").
const TODAY = '2026-10-19';

const lesson = (n: number, fields: Partial<HomeLesson> = {}): HomeLesson => ({
  id: uid(300 + n),
  date: TODAY,
  start: 480,
  end: 525,
  unit: { kind: 'class', id: uid(101), name: '7 Oxford' },
  subject: { id: uid(200), names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' } },
  teacher: { id: uid(600), kind: 'person', name: 'Karimova Aziza' },
  room: { id: uid(400), name: 'Room 12' },
  cancelCause: null,
  cancelReason: null,
  changed: false,
  state: 'upcoming',
  away: null,
  roomOut: null,
  substitution: null,
  classIds: [uid(101)],
  lessonNumber: 1,
  replacedHere: false,
  branch: NORTH,
  startsAt: '2026-10-19T03:00:00.000Z',
  endsAt: '2026-10-19T03:45:00.000Z',
  today: true,
  ...fields,
});

const exam: HomeExam = {
  id: uid(700),
  date: TODAY,
  title: 'Quarter exam',
  subject: null,
  start: 660,
  end: 705,
  rooms: [
    { room: { id: uid(401), name: 'Hall' }, classIds: [], units: ['8 Yale'], invigilators: [] },
  ],
  branch: NORTH,
  startsAt: '2026-10-19T06:00:00.000Z',
  endsAt: '2026-10-19T06:45:00.000Z',
  today: true,
};

const busy: HomeBusy = {
  date: TODAY,
  start: 600,
  end: 645,
  branch: { id: uid(9), name: 'East' },
  startsAt: '2026-10-19T05:00:00.000Z',
  endsAt: '2026-10-19T05:45:00.000Z',
  today: true,
};

const homeOf = (fields: Partial<TeachingHome> = {}): TeachingHome => ({
  today: TODAY,
  week: { from: TODAY, to: '2026-10-25' },
  branches: [NORTH],
  days: [{ date: TODAY, dayOff: null, version: null, fromPattern: false, branch: NORTH }],
  lessons: [],
  exams: [],
  busy: [],
  ...fields,
});

const rowsOf = (section: string): string[][] =>
  [...document.querySelectorAll(`[${section}] tbody tr`)].map((one) =>
    [...one.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

function openHome(answer: () => Response | Promise<Response>, role: Role = 'teacher') {
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(
        sessionOf({
          assignments: [
            { role, branchId: NORTH.id },
            { role, branchId: SOUTH.id },
          ],
          branches: [NORTH, SOUTH],
          language: 'en',
        }),
      ),
    'GET /api/timetable/home': answer,
  });
  renderApp('/', 'en');
  return calls;
}

describe('the teaching home page', () => {
  it('lists today’s lessons of both branches in time order, each with its branch', async () => {
    // The server's lists are each in order; the page merges them by start moment.
    openHome(() =>
      json(
        homeOf({
          branches: [NORTH, SOUTH],
          lessons: [
            lesson(1, {
              branch: SOUTH,
              start: 360,
              end: 405,
              lessonNumber: 2,
              startsAt: '2026-10-19T01:00:00.000Z',
              endsAt: '2026-10-19T01:45:00.000Z',
              changed: true,
            }),
            lesson(2),
            lesson(3, {
              date: '2026-10-20',
              today: false,
              startsAt: '2026-10-20T03:00:00.000Z',
              endsAt: '2026-10-20T03:45:00.000Z',
            }),
          ],
          exams: [exam],
          busy: [busy],
        }),
      ),
    );
    await screen.findByRole('heading', { name: /^Today, / });
    await waitFor(() => {
      expect(rowsOf('data-home-today')).toEqual([
        [
          '2',
          '06:00–06:45',
          '7 Oxford',
          'Mathematics',
          'Room 12',
          'South',
          en.timetable.day.changed,
        ],
        [
          '1',
          '08:00–08:45',
          '7 Oxford',
          'Mathematics',
          'Room 12',
          'North',
          en.timetable.day.asPlanned,
        ],
        ['', '10:00–10:45', 'Busy in East', 'East', ''],
        ['', '11:00–11:45', '8 Yale', 'Quarter exam', 'Hall', 'North', en.timetable.day.exam],
      ]);
    });
    expect(document.querySelector('[data-home-today] thead')?.textContent).toContain(
      en.home.lessons.branch,
    );
    // The week: days as columns, Tuesday's lesson in its column.
    const week = document.querySelector('[data-home-week] table');
    expect(week?.querySelectorAll('thead th')).toHaveLength(3);
    expect(rowsOf('data-home-week').find((row) => row[0] === '08:00–08:45')).toEqual([
      '08:00–08:45',
      'Mathematics · 7 Oxford · Room 12 · North',
      'Mathematics · 7 Oxford · Room 12 · North',
    ]);
  });

  it('names no branch when every item is of one branch', async () => {
    openHome(() => json(homeOf({ lessons: [lesson(1)] })));
    await waitFor(() => {
      expect(rowsOf('data-home-today')).toEqual([
        ['1', '08:00–08:45', '7 Oxford', 'Mathematics', 'Room 12', en.timetable.day.asPlanned],
      ]);
    });
    expect(document.querySelector('[data-home-today] thead')?.textContent).not.toContain(
      en.home.lessons.branch,
    );
  });

  it('marks a cancelled lesson and one replaced away', async () => {
    openHome(() =>
      json(
        homeOf({
          lessons: [
            lesson(1, { cancelCause: 'reason', cancelReason: 'School trip', state: 'cancelled' }),
            lesson(2, {
              start: 535,
              end: 580,
              startsAt: '2026-10-19T03:55:00.000Z',
              replacedHere: true,
              teacher: { id: uid(601), kind: 'person', name: 'Nurova Lola' },
              substitution: {
                id: uid(800),
                replaced: { id: uid(600), kind: 'person', name: 'Karimova Aziza' },
              },
            }),
          ],
        }),
      ),
    );
    await waitFor(() => {
      expect(rowsOf('data-home-today').map((row) => row[row.length - 1])).toEqual([
        'Cancelled: School trip',
        'Replaced by Nurova Lola',
      ]);
    });
  });

  it('shows the loading outline while the week is asked for', async () => {
    let release: () => void = () => undefined;
    openHome(
      () =>
        new Promise<Response>((resolve) => {
          release = () => {
            resolve(json(homeOf({ lessons: [lesson(1)] })));
          };
        }),
    );
    await waitFor(() => {
      expect(document.querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-home-today]')).toBeNull();
    release();
    await waitFor(() => {
      expect(rowsOf('data-home-today')).toHaveLength(1);
    });
    expect(document.querySelector('[role="status"][aria-busy="true"]')).toBeNull();
  });

  it('marks a lesson the person substitutes, and draws a busy block in the quiet text colour', async () => {
    openHome(() =>
      json(
        homeOf({
          lessons: [
            lesson(1, {
              substitution: {
                id: uid(800),
                replaced: { id: uid(601), kind: 'person', name: 'Nurova Lola' },
              },
            }),
          ],
          busy: [busy],
        }),
      ),
    );
    await waitFor(() => {
      expect(rowsOf('data-home-today')[0]?.at(-1)).toBe('substitute for Nurova Lola');
    });
    const block = document.querySelector('[data-home-week] [data-busy]');
    expect(block?.className).toBe('text-muted-foreground');
  });

  it('says so when there is nothing today or this week, with a day off named', async () => {
    openHome(() =>
      json(
        homeOf({
          days: [
            {
              date: TODAY,
              dayOff: 'Teachers’ Day',
              version: null,
              fromPattern: false,
              branch: NORTH,
            },
          ],
        }),
      ),
    );
    expect(await screen.findByText(en.home.lessons.noToday)).toBeDefined();
    expect(screen.getByText(en.home.lessons.noWeek)).toBeDefined();
    expect(document.querySelector('[data-day-off]')?.textContent).toBe(
      '19 October, North: day off, Teachers’ Day',
    );
  });

  it('shows a failure with a retry, and the Tutor gets the same part', async () => {
    let failing = true;
    const calls = openHome(
      () => (failing ? refusal('internal_error', 500) : json(homeOf({ lessons: [lesson(1)] }))),
      'tutor',
    );
    const retry = await screen.findByRole('button', { name: en.problems.retry });
    failing = false;
    retry.click();
    await waitFor(() => {
      expect(rowsOf('data-home-today')).toHaveLength(1);
    });
    expect(calls.filter((call) => call.route === 'GET /api/timetable/home').length).toBeGreaterThan(
      1,
    );
  });

  it('is not asked for on the Academic Vice Principal’s home', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'academic_vice_principal', branchId: NORTH.id }] })),
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
    });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: en.home.emptyTitle })).toBeDefined();
    expect(calls.some((call) => call.route === 'GET /api/timetable/home')).toBe(false);
  });
});
