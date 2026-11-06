import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { PortalChildren, PortalHomeworkWeek, PortalWeek } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

// Task 11.2, pull request #294: the parent portal (`10`, What parents see). All names are
// invented.
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

const week = (lessons: PortalWeek['lessons'] = []): PortalWeek => ({
  today: '2026-10-27',
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
  today: '2026-10-27',
  monday: '2026-10-26',
  homework: [
    {
      givenOn: '2026-10-26',
      subject: maths,
      topic: 'Fractions',
      title: 'Exercise 5',
      number: 1,
      description: 'Pages 12 and 13',
      dueOn: '2026-11-09',
      files: [{ id: FILE, name: 'fractions.pdf', type: 'application/pdf', bytes: 9 }],
    },
    {
      givenOn: '2026-10-26',
      subject: maths,
      topic: 'Fractions',
      title: null,
      number: 2,
      description: null,
      dueOn: null,
      files: [],
    },
  ],
};

function portal(language: 'en' | 'ru' = 'en', lessons = [LESSON]) {
  return fakeApi({
    'GET /api/auth/session': () => json(PARENT(language)),
    'GET /api/portal/children': () => json(CHILDREN),
    [`GET /api/portal/children/${ANVAR}/timetable`]: () => json(week(lessons)),
    [`GET /api/portal/children/${MALIKA}/timetable`]: () =>
      json({ ...week([]), exams: [] } satisfies PortalWeek),
    [`GET /api/portal/children/${ANVAR}/homework`]: () => json(HOMEWORK),
  });
}

describe('the parent portal', () => {
  it('opens on the timetable of the first child, from the home address', async () => {
    const calls = portal();
    renderApp('/');
    await screen.findByText('Aziza Rahimova · 101');
    expect(screen.getByRole('combobox', { name: en.portal.child })).toHaveProperty('value', ANVAR);
    // No staff menu, and no call of a staff route.
    expect(screen.queryByRole('navigation', { name: en.layout.menu })).toBeNull();
    expect(
      calls.every(
        (call) => call.route === 'GET /api/auth/session' || call.route.startsWith('GET /api/portal/'),
      ),
    ).toBe(true);
  });

  it('shows the week with the changed mark, the day off and the exam in words', async () => {
    portal();
    renderApp(`/portal/${ANVAR}/timetable`);
    const monday = await screen.findByRole('region', { name: /Monday/ });
    expect(within(monday).getByText(en.portal.timetable.changed)).toBeDefined();
    expect(within(monday).getByText('Mathematics')).toBeDefined();
    expect(within(monday).getByText('Exam: Quarter exam')).toBeDefined();
    const tuesday = screen.getByRole('region', { name: /Tuesday/ });
    expect(within(tuesday).getByText('Day off: Teachers’ day')).toBeDefined();
  });

  it('shows a cancelled lesson as cancelled, and no teacher as one to be named', async () => {
    portal('en', [{ ...LESSON, state: 'cancelled', teacher: null, changed: false }]);
    renderApp(`/portal/${ANVAR}/timetable`);
    const monday = await screen.findByRole('region', { name: /Monday/ });
    expect(within(monday).getByText(en.portal.timetable.cancelled)).toBeDefined();
    expect(within(monday).getByText(`${en.portal.timetable.teacherToCome} · 101`)).toBeDefined();
  });

  it('switches child and keeps the page', async () => {
    const calls = portal();
    renderApp(`/portal/${ANVAR}/timetable`);
    await screen.findByText('Aziza Rahimova · 101');
    fireEvent.change(screen.getByRole('combobox', { name: en.portal.child }), {
      target: { value: MALIKA },
    });
    await waitFor(() => {
      expect(calls.map((call) => call.route)).toContain(
        `GET /api/portal/children/${MALIKA}/timetable`,
      );
    });
    expect(await screen.findAllByText(en.portal.timetable.noLessons)).toHaveLength(1);
  });

  it('lists homework with title, text, due date and files, and "Homework n" without a title', async () => {
    portal();
    renderApp(`/portal/${ANVAR}/homework`);
    await screen.findByText('Exercise 5');
    expect(screen.getByText('Pages 12 and 13')).toBeDefined();
    expect(screen.getByText('For 9 November')).toBeDefined();
    expect(screen.getByRole('button', { name: 'fractions.pdf' })).toBeDefined();
    expect(screen.getByText('Homework 2')).toBeDefined();
    expect(screen.getAllByText(/Fractions/).length).toBeGreaterThan(0);
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

  it('speaks the parent’s language', async () => {
    portal('ru');
    renderApp(`/portal/${ANVAR}/timetable`, 'ru');
    await screen.findByText('Математика');
    expect(screen.getByRole('link', { name: ru.portal.homework.title })).toBeDefined();
    expect(screen.getByText(ru.portal.timetable.changed)).toBeDefined();
  });

  it('is not open to staff', async () => {
    fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
    });
    renderApp(`/portal/${ANVAR}/timetable`);
    await waitFor(() => {
      expect(screen.queryByRole('combobox', { name: en.portal.child })).toBeNull();
    });
  });
});
