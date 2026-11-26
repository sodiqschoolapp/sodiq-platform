import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type {
  PortalAttendanceWeek,
  PortalChildren,
  PortalGrades,
  PortalHomeworkWeek,
  PortalWeek,
} from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf, type ApiCall } from '@/testing/render-app';

// Task 11.2, pull request #294: the parent portal (`10`, What parents see); its frame, the Today
// page and the timetable of one day at a time since the redesign of 19 November 2026. All names
// are invented.
const PARENT = (language: 'en' | 'ru' = 'en') =>
  sessionOf({
    login: 'd.karimova',
    kind: 'parent',
    fullName: 'Dilfuza Karimova',
    assignments: [],
    branches: [],
    language,
  });

const ANVAR = '0190a000-0000-7000-8000-00000000000a';
const MALIKA = '0190a000-0000-7000-8000-00000000000b';
const SUBJECT = '0190a000-0000-7000-8000-0000000000c1';
const FILE = '0190a000-0000-7000-8000-0000000000f1';
const QUARTER = '0190a000-0000-7000-8000-0000000000d1';

const CHILDREN: PortalChildren = {
  children: [
    { id: ANVAR, firstName: 'Anvar', lastName: 'Karimov', className: '7 Oxford' },
    { id: MALIKA, firstName: 'Malika', lastName: 'Karimova', className: '3 Cambridge' },
  ],
};

const maths = {
  id: SUBJECT,
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  colour: 'blue' as const,
};

/** Monday 26 October is today; Tuesday is a day off. */
const week = (lessons: PortalWeek['lessons'] = []): PortalWeek => ({
  today: '2026-10-26',
  monday: '2026-10-26',
  days: [
    { date: '2026-10-26', outsideYear: false, dayOff: null },
    { date: '2026-10-27', outsideYear: false, dayOff: 'Teachers’ day' },
  ],
  lessons,
  exams: [
    {
      date: '2026-10-26',
      start: 600,
      end: 690,
      title: 'Quarter exam',
      subject: maths,
      room: '204',
    },
  ],
});

const LESSON: PortalWeek['lessons'][number] = {
  date: '2026-10-26',
  start: 480,
  end: 525,
  lessonNumber: 1,
  subject: maths,
  teacher: 'Aziza Rahimova',
  room: '101',
  state: 'held',
  exam: false,
  changed: true,
};

const HOMEWORK: PortalHomeworkWeek = {
  today: '2026-10-26',
  monday: '2026-10-26',
  homework: [
    {
      givenOn: '2026-10-26',
      subject: maths,
      topic: 'Fractions',
      title: 'Exercise 5',
      number: 1,
      description: 'Pages 12 and 13',
      files: [{ id: FILE, name: 'fractions.pdf', type: 'application/pdf', bytes: 9 }],
    },
    {
      givenOn: '2026-10-26',
      subject: maths,
      topic: 'Fractions',
      title: null,
      number: 2,
      description: null,
      files: [],
    },
  ],
};

/** The week before: homework given on Friday and on Monday. */
const LAST_WEEK: PortalHomeworkWeek = {
  today: '2026-10-26',
  monday: '2026-10-19',
  homework: [
    {
      givenOn: '2026-10-23',
      subject: maths,
      topic: null,
      title: 'Essay on autumn',
      number: 1,
      description: null,
      files: [],
    },
    {
      givenOn: '2026-10-19',
      subject: maths,
      topic: null,
      title: 'Old exercise',
      number: 1,
      description: null,
      files: [],
    },
  ],
};

const ATTENDANCE: PortalAttendanceWeek = {
  today: '2026-10-26',
  monday: '2026-10-26',
  lessons: [
    {
      date: '2026-10-26',
      start: 480,
      end: 525,
      subject: maths,
      mark: 'late',
      comment: null,
      note: null,
    },
  ],
};

const score = (date: string, title: string, value: number, savedAt = `${date}T13:00:00.000Z`) => ({
  date,
  kind: 'classwork' as const,
  title,
  position: 1,
  score: value,
  total: 10,
  percent: value * 10,
  comment: null,
  savedAt,
});

const GRADES: PortalGrades = {
  quarters: [
    {
      id: QUARTER,
      number: 1,
      startDate: '2026-09-02',
      endDate: '2026-10-31',
      closed: false,
      notInSystem: false,
      notOfficial: false,
    },
  ],
  quarterId: QUARTER,
  subjects: [
    {
      subject: maths,
      final: false,
      attendanceOnly: false,
      figures: null,
      attendance: null,
      year: null,
      // Older first, as the server lists them: the Today page shows the newest first.
      scores: [
        // The oldest lesson, its score saved on the morning of today: the newest saved.
        score('2026-10-05', 'Test 1', 6, '2026-10-26T04:00:00.000Z'),
        score('2026-10-12', 'Test 2', 7),
        score('2026-10-14', 'Test 3', 8),
        score('2026-10-19', 'Test 4', 9),
        score('2026-10-20', 'Test 5', 10),
        score('2026-10-21', 'Test 6', 5),
      ],
      rating: null,
      ratingComments: [],
    },
  ],
};

function portal(language: 'en' | 'ru' = 'en', lessons = [LESSON]) {
  // The homework of the week of the address: the week before for `?date=2026-10-19`.
  const calls: ApiCall[] = fakeApi({
    'GET /api/auth/session': () => json(PARENT(language)),
    'GET /api/portal/children': () => json(CHILDREN),
    [`GET /api/portal/children/${ANVAR}/timetable`]: () => json(week(lessons)),
    [`GET /api/portal/children/${MALIKA}/timetable`]: () =>
      json({ ...week([]), exams: [] } satisfies PortalWeek),
    [`GET /api/portal/children/${ANVAR}/homework`]: () =>
      json(calls.at(-1)?.query === '?date=2026-10-19' ? LAST_WEEK : HOMEWORK),
    [`GET /api/portal/children/${ANVAR}/attendance`]: () => json(ATTENDANCE),
    [`GET /api/portal/children/${ANVAR}/grades`]: () => json(GRADES),
  });
  return calls;
}

const switcher = (child: { first: string; last: string }) =>
  screen.findByRole('button', {
    name: en.portal.switchChild.replace('{{first}}', child.first).replace('{{last}}', child.last),
  });

describe('the parent portal', () => {
  it('opens on the Today page of the first child, from the home address', async () => {
    const calls = portal();
    renderApp('/');
    await screen.findByRole('heading', { name: en.portal.today.title, level: 1 });
    await switcher({ first: 'Anvar', last: 'Karimov' });
    // No staff menu, and no call of a staff route.
    expect(screen.queryByRole('navigation', { name: en.layout.menu })).toBeNull();
    expect(
      calls.every(
        (call) =>
          call.route === 'GET /api/auth/session' || call.route.startsWith('GET /api/portal/'),
      ),
    ).toBe(true);
  });

  it('shows today’s lessons with their marks and the newest scores, and no homework to hand in', async () => {
    portal();
    renderApp(`/portal/${ANVAR}/today`);
    const lessons = await screen.findByRole('region', { name: en.portal.today.lessons });
    await waitFor(() => {
      expect(lessons.querySelector('[data-mark="late"]')?.textContent).toBe(
        en.portal.attendance.marks.late,
      );
    });
    expect(within(lessons).getByText('Exam: Quarter exam')).toBeDefined();
    // Task 11.24 (`10`, Today): a homework is graded at the lesson where it was given, so the
    // page has no homework still to hand in and no due date.
    expect(screen.queryByRole('region', { name: en.portal.homework.title })).toBeNull();
    expect(screen.queryByText('Exercise 5')).toBeNull();
    expect(screen.queryByText('Essay on autumn')).toBeNull();
    const scores = screen.getByRole('region', { name: en.portal.today.latestScores });
    await waitFor(() => {
      expect(
        [...scores.querySelectorAll('li')].map((row) => row.textContent.includes('Test 6')),
      ).toHaveLength(5);
    });
    // The last saved first: the score of the oldest lesson, saved this morning, leads; then by
    // the moment saved, and the earliest saved of six is left for the Grades page.
    const listed = [...scores.querySelectorAll('li')].map((row) => row.textContent);
    expect(listed[0]).toContain('Test 1');
    expect(listed[1]).toContain('Test 6');
    expect(listed[4]).toContain('Test 3');
    expect(listed.some((row) => row.includes('Test 2'))).toBe(false);
  });

  it('names the next school day when today has no lessons', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(PARENT()),
      'GET /api/portal/children': () => json(CHILDREN),
      [`GET /api/portal/children/${ANVAR}/timetable`]: () =>
        json({
          ...week([{ ...LESSON, date: '2026-10-28', changed: false }]),
          today: '2026-10-27',
          exams: [],
        } satisfies PortalWeek),
      [`GET /api/portal/children/${ANVAR}/attendance`]: () => json({ ...ATTENDANCE, lessons: [] }),
      [`GET /api/portal/children/${ANVAR}/homework`]: () => json({ ...HOMEWORK, homework: [] }),
      [`GET /api/portal/children/${ANVAR}/grades`]: () => json(GRADES),
    });
    renderApp(`/portal/${ANVAR}/today`);
    const next = await screen.findByRole('region', {
      name: en.portal.today.nextLessons.replace('{{day}}', 'Wednesday, 28 October'),
    });
    expect(within(next).getByText('Day off: Teachers’ day')).toBeDefined();
    expect(within(next).getByText('Mathematics')).toBeDefined();
  });

  it('shows today with the changed mark and the exam in words, and another day when chosen', async () => {
    portal();
    const { router } = renderApp(`/portal/${ANVAR}/timetable`);
    const monday = await screen.findByRole('region', { name: /Monday, 26 October/ });
    expect(within(monday).getByText(en.portal.timetable.changed)).toBeDefined();
    expect(within(monday).getByText('Mathematics')).toBeDefined();
    expect(within(monday).getByText('Exam: Quarter exam')).toBeDefined();
    // Today is the day open; Tuesday is chosen from the row of days.
    const today = screen.getByRole('button', {
      name: en.portal.dayIsToday.replace('{{day}}', 'Monday, 26 October'),
    });
    expect(today.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Tuesday, 27 October' }));
    const tuesday = await screen.findByRole('region', { name: /Tuesday, 27 October/ });
    expect(within(tuesday).getByText('Day off: Teachers’ day')).toBeDefined();
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ date: '2026-10-27' });
    });
  });

  it('reads the week of a day chosen by its Monday, once', async () => {
    const calls = portal();
    renderApp(`/portal/${ANVAR}/timetable?date=2026-10-28`);
    await screen.findByRole('region', { name: /Wednesday, 28 October/ });
    fireEvent.click(screen.getByRole('button', { name: 'Tuesday, 27 October' }));
    await screen.findByRole('region', { name: /Tuesday, 27 October/ });
    const reads = calls.filter(
      (call) => call.route === `GET /api/portal/children/${ANVAR}/timetable`,
    );
    expect(reads.map((call) => call.query)).toEqual(['?date=2026-10-26']);
  });

  it('moves between weeks and back to this week', async () => {
    const calls = portal();
    renderApp(`/portal/${ANVAR}/timetable`);
    await screen.findByRole('region', { name: /Monday, 26 October/ });
    expect(screen.queryByRole('button', { name: en.portal.thisWeek })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.portal.nextWeek }));
    await waitFor(() => {
      expect(calls.map((call) => `${call.route}${call.query ?? ''}`)).toContain(
        `GET /api/portal/children/${ANVAR}/timetable?date=2026-11-02`,
      );
    });
  });

  it('shows a cancelled lesson as cancelled, and no teacher as one to be named', async () => {
    portal('en', [{ ...LESSON, state: 'cancelled', teacher: null, changed: false }]);
    renderApp(`/portal/${ANVAR}/timetable`);
    const monday = await screen.findByRole('region', { name: /Monday/ });
    expect(within(monday).getByText(en.portal.timetable.cancelled)).toBeDefined();
    expect(
      within(monday).getByText(`Lesson 1 · ${en.portal.timetable.teacherToCome} · 101`),
    ).toBeDefined();
  });

  it('switches child from the menu at the top and keeps the page', async () => {
    const calls = portal();
    const { router } = renderApp(`/portal/${ANVAR}/timetable`);
    await screen.findByText('Lesson 1 · Aziza Rahimova · 101');
    fireEvent.click(await switcher({ first: 'Anvar', last: 'Karimov' }));
    const items = await screen.findAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual([
      'AKAnvar Karimov7 Oxford',
      'MKMalika Karimova3 Cambridge',
    ]);
    expect(items[0]?.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Malika Karimova/ }));
    await waitFor(() => {
      expect(calls.map((call) => call.route)).toContain(
        `GET /api/portal/children/${MALIKA}/timetable`,
      );
    });
    await switcher({ first: 'Malika', last: 'Karimova' });
    expect(router.state.location.pathname).toBe(`/portal/${MALIKA}/timetable`);
    expect(await screen.findAllByText(en.portal.timetable.noLessons)).toHaveLength(1);
  });

  it('shows one child by name and class, with no menu', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(PARENT()),
      'GET /api/portal/children': () => json({ children: CHILDREN.children.slice(0, 1) }),
      [`GET /api/portal/children/${ANVAR}/homework`]: () => json(HOMEWORK),
    });
    renderApp(`/portal/${ANVAR}/homework`);
    await screen.findByText('Exercise 5');
    const child = document.querySelector('[data-child]');
    expect(child?.textContent).toBe('AKAnvar Karimov7 Oxford');
    expect(screen.queryByRole('button', { name: /Anvar Karimov/ })).toBeNull();
  });

  // Task 11.24 (`10`, Homework): "Tasks by the date of the lesson where they were given and by
  // subject"; a homework has no due date.
  it('lists homework with title, text and files, and "Homework n" without a title, with no due date', async () => {
    portal();
    renderApp(`/portal/${ANVAR}/homework`);
    await screen.findByText('Exercise 5');
    expect(screen.getByText('Pages 12 and 13')).toBeDefined();
    expect(screen.queryByText(/^Due /)).toBeNull();
    expect(screen.getByRole('button', { name: 'fractions.pdf' })).toBeDefined();
    expect(screen.getByText('Homework 2')).toBeDefined();
    expect(screen.getAllByText(/Fractions/).length).toBeGreaterThan(0);
  });

  it('groups the homework by the day it was given, the newest day first', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(PARENT()),
      'GET /api/portal/children': () => json(CHILDREN),
      [`GET /api/portal/children/${ANVAR}/homework`]: () => json(LAST_WEEK),
    });
    renderApp(`/portal/${ANVAR}/homework`);
    await screen.findByText('Essay on autumn');
    const days = screen
      .getAllByRole('heading', { level: 2 })
      .map((one) => one.textContent)
      .filter((text) => text.startsWith('Given on'));
    expect(days).toEqual(['Given on Friday, 23 October', 'Given on Monday, 19 October']);
    const friday = screen.getByRole('region', { name: 'Given on Friday, 23 October' });
    expect(within(friday).getByText('Essay on autumn')).toBeDefined();
    expect(within(friday).queryByText('Old exercise')).toBeNull();
  });

  it('says so when no homework was given', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(PARENT()),
      'GET /api/portal/children': () => json(CHILDREN),
      [`GET /api/portal/children/${ANVAR}/homework`]: () => json({ ...HOMEWORK, homework: [] }),
    });
    renderApp(`/portal/${ANVAR}/homework`);
    await screen.findByText(en.portal.homework.empty);
  });

  it('has the pages in the menu, the first four in the tab bar and the rest under More', async () => {
    portal();
    renderApp(`/portal/${ANVAR}/timetable`);
    await screen.findByRole('region', { name: /Monday/ });
    const [side, tabs] = screen.getAllByRole('navigation', { name: en.portal.pages });
    expect(
      within(side as HTMLElement)
        .getAllByRole('link')
        .map((one) => one.textContent),
    ).toEqual([
      en.portal.today.title,
      en.portal.timetable.title,
      en.portal.homework.title,
      en.portal.grades.title,
      en.portal.attendance.title,
      en.portal.rating.title,
      en.portal.announcements.title,
    ]);
    const bar = tabs as HTMLElement;
    expect(
      within(bar)
        .getAllByRole('link')
        .map((one) => one.textContent),
    ).toEqual([
      en.portal.today.tab,
      en.portal.timetable.tab,
      en.portal.homework.tab,
      en.portal.grades.tab,
    ]);
    expect(
      within(bar).getByRole('link', { name: en.portal.timetable.tab }).getAttribute('aria-current'),
    ).toBe('page');
    fireEvent.click(within(bar).getByRole('button', { name: en.portal.more }));
    const more = await screen.findByRole('dialog', { name: en.portal.more });
    expect(
      within(more)
        .getAllByRole('link')
        .map((one) => one.textContent),
    ).toEqual([
      en.portal.attendance.title,
      en.portal.rating.title,
      en.portal.announcements.title,
      en.portal.account,
    ]);
  });

  it('speaks the parent’s language', async () => {
    portal('ru');
    renderApp(`/portal/${ANVAR}/timetable`, 'ru');
    await screen.findByText('Математика');
    expect(screen.getAllByRole('link', { name: ru.portal.homework.title }).length).toBe(1);
    expect(screen.getByRole('link', { name: ru.portal.homework.tab })).toBeDefined();
    expect(screen.getByText(ru.portal.timetable.changed)).toBeDefined();
  });

  it('is not open to staff', async () => {
    fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
    });
    renderApp(`/portal/${ANVAR}/timetable`);
    // Sent to the staff home page, which only a redirect brings.
    await screen.findByRole('heading', { name: en.home.title });
    expect(screen.queryByRole('navigation', { name: en.portal.pages })).toBeNull();
  });

  it('says so for a week with no class, and names no other child for one no longer listed', async () => {
    const gone = '0190a000-0000-7000-8000-0000000000ee';
    fakeApi({
      'GET /api/auth/session': () => json(PARENT()),
      'GET /api/portal/children': () => json(CHILDREN),
      [`GET /api/portal/children/${ANVAR}/timetable`]: () =>
        json({
          ...week([]),
          exams: [],
          days: [{ date: '2026-10-26', outsideYear: true, dayOff: null }],
        } satisfies PortalWeek),
      [`GET /api/portal/children/${gone}/timetable`]: () =>
        json({ error: { code: 'not_found', message: 'Not found.' } }, 404),
    });
    renderApp(`/portal/${ANVAR}/timetable`);
    await screen.findByText(en.portal.timetable.outsideYear);
    cleanup();
    renderApp(`/portal/${gone}/timetable`);
    await screen.findByRole('button', { name: en.problems.retry });
    const menu = await screen.findByRole('button', { name: en.portal.chooseChild });
    expect(menu.textContent).toBe(en.portal.chooseChild);
  });
});
