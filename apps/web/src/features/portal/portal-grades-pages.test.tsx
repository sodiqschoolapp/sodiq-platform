import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { PortalAttendanceWeek, PortalChildren, PortalGrades } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, renderApp, sessionOf } from '@/testing/render-app';

// Task 11.3, pull request #296: the Grades and Attendance pages of the parent portal (`10`, What
// parents see). All names are invented.
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
const Q1 = '0190a000-0000-7000-8000-0000000000d1';
const Q2 = '0190a000-0000-7000-8000-0000000000d2';

const CHILDREN: PortalChildren = {
  children: [{ id: ANVAR, firstName: 'Anvar', lastName: 'Karimov', className: '7 Oxford' }],
};

const maths = {
  id: '0190a000-0000-7000-8000-0000000000c1',
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  colour: 'blue' as const,
};
const assembly = {
  id: '0190a000-0000-7000-8000-0000000000c2',
  names: { uz: 'Maʼnaviyat soati', ru: 'Час духовности', en: 'Spiritual hour' },
  colour: 'green' as const,
};

const quarter = (id: string, number: number, closed: boolean) => ({
  id,
  number,
  startDate: number === 1 ? '2026-09-02' : '2026-11-09',
  endDate: number === 1 ? '2026-10-31' : '2026-12-28',
  closed,
  notInSystem: false,
  notOfficial: false,
});

const GRADES = (closed: boolean): PortalGrades => ({
  quarters: [quarter(Q1, 1, closed), quarter(Q2, 2, false)],
  quarterId: Q1,
  subjects: [
    {
      subject: maths,
      final: closed,
      attendanceOnly: false,
      figures: {
        attendance: 75,
        classwork: 60,
        homework: null,
        ratingExam: 77,
        ratingShown: true,
        outcome: {
          kind: 'number',
          shown: 71,
          grade: 4,
          provisional: !closed,
          leftOut: closed ? [] : ['homework'],
          flags: [],
        },
        basedOn: { expected: 2, held: 3 },
        countsFrom: null,
        leftSubjectOn: null,
        atLeaving: null,
      },
      attendance: null,
      year: null,
      scores: [
        {
          date: '2026-10-12',
          kind: 'classwork',
          title: 'Fractions test',
          position: 1,
          score: 12,
          total: 30,
          percent: 40,
          comment: 'Good start',
          savedAt: '2026-10-12T13:00:00.000Z',
        },
        {
          date: '2026-10-19',
          kind: 'homework',
          title: null,
          position: 2,
          score: 4,
          total: 5,
          percent: 80,
          comment: null,
          savedAt: null,
        },
      ],
      rating: { kind: 'score', score: 77 },
      ratingComments: ['Exam on Friday'],
    },
    {
      subject: assembly,
      final: closed,
      attendanceOnly: true,
      figures: null,
      attendance: 50,
      year: null,
      scores: [],
      rating: null,
      ratingComments: [],
    },
  ],
});

const WEEK: PortalAttendanceWeek = {
  today: '2026-10-27',
  monday: '2026-10-26',
  lessons: [
    {
      date: '2026-10-26',
      start: 480,
      end: 525,
      subject: maths,
      mark: 'exempt',
      comment: null,
      note: null,
    },
    {
      date: '2026-10-26',
      start: 590,
      end: 635,
      subject: assembly,
      mark: 'late',
      comment: 'Came after the bell',
      note: 'Bring the atlas',
    },
  ],
};

function portal(language: 'en' | 'ru' = 'en', closed = false, grades = GRADES(closed)) {
  return fakeApi({
    'GET /api/auth/session': () => json(PARENT(language)),
    'GET /api/portal/children': () => json(CHILDREN),
    [`GET /api/portal/children/${ANVAR}/grades`]: () => json(grades),
    [`GET /api/portal/children/${ANVAR}/attendance`]: () => json(WEEK),
  });
}

/** The row of a subject, opened: its figures and scores below it. */
async function openRow(id: string): Promise<HTMLElement> {
  const row = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(`[data-subject-row="${id}"]`);
    if (found === null) throw new Error('no row yet');
    return found;
  });
  const button = within(row).getByRole('button');
  expect(button.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(button);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  return row;
}

describe('the portal grades', () => {
  it('shows the result and grade in the row, "provisional" on an open quarter, and the figures, scores and comments when opened', async () => {
    portal();
    renderApp(`/portal/${ANVAR}/grades`);
    await screen.findByText(en.portal.grades.provisional);
    const closedRow = document.querySelector(`[data-subject-row="${maths.id}"]`);
    expect(closedRow?.querySelector('[data-result]')?.textContent).toBe('714');
    expect(closedRow?.querySelector('[data-grade]')?.getAttribute('aria-label')).toBe('Grade 4');
    // The scores are in the row only once it is opened.
    expect(screen.queryByText('Fractions test')).toBeNull();
    const card = await openRow(maths.id);
    // The staff page's labels (review decision 4).
    expect(within(card).getByText(new RegExp(en.results.labels.provisional))).toBeDefined();
    expect(card.querySelector('[data-figure="attendance"]')?.textContent).toBe(
      `${en.results.columns.attendance}75`,
    );
    expect(within(card).getByText('Fractions test')).toBeDefined();
    expect(within(card).getByText('12/30')).toBeDefined();
    expect(within(card).getByText('40%')).toBeDefined();
    expect(within(card).getByText('Good start')).toBeDefined();
    expect(within(card).getByText('Homework 2')).toBeDefined();
    expect(within(card).getByText('Rating exam: 77')).toBeDefined();
    expect(within(card).getByText('Exam on Friday')).toBeDefined();
    const only = await openRow(assembly.id);
    expect(within(only).getByText(en.portal.grades.attendanceOnlyShort)).toBeDefined();
    expect(only.querySelector('[data-figure="attendance"]')?.textContent).toBe(
      `${en.results.columns.attendance}50`,
    );
    expect(within(only).queryByText(en.portal.grades.scores)).toBeNull();
  });

  it('says "final" for a closed quarter and not "provisional"', async () => {
    portal('en', true);
    renderApp(`/portal/${ANVAR}/grades`);
    await screen.findByText(en.portal.grades.final);
    expect(screen.queryByText(en.portal.grades.provisional)).toBeNull();
  });

  it('marks a subject under a reopening of a closed quarter provisional', async () => {
    const closed = GRADES(true);
    portal('en', true, {
      ...closed,
      subjects: closed.subjects.map((one) =>
        one.subject.id === maths.id ? { ...one, final: false } : one,
      ),
    });
    renderApp(`/portal/${ANVAR}/grades`);
    const card = await openRow(maths.id);
    expect(within(card).getByText(en.portal.grades.reopenedShort)).toBeDefined();
    expect(within(card).getByText(en.portal.grades.reopened)).toBeDefined();
    const other = await openRow(assembly.id);
    expect(within(other).queryByText(en.portal.grades.reopenedShort)).toBeNull();
    expect(within(other).queryByText(en.portal.grades.reopened)).toBeNull();
  });

  it('speaks the parent’s language', async () => {
    portal('ru');
    renderApp(`/portal/${ANVAR}/grades`, 'ru');
    await screen.findByText(ru.portal.grades.provisional);
    const row = document.querySelector(`[data-subject-row="${maths.id}"]`);
    expect(row?.querySelector('[data-grade]')?.getAttribute('aria-label')).toBe('Оценка 4');
    expect(screen.getByRole('link', { name: ru.portal.attendance.title })).toBeDefined();
  });
});

describe('the portal attendance', () => {
  it('shows each lesson’s mark by day, an exempt lesson as exempt and never as absent', async () => {
    portal();
    renderApp(`/portal/${ANVAR}/attendance`);
    const monday = await screen.findByRole('region', { name: /Monday/ });
    expect(within(monday).getByText(en.portal.attendance.marks.exempt)).toBeDefined();
    expect(within(monday).queryByText(en.portal.attendance.marks.absent)).toBeNull();
    expect(within(monday).getByText(en.portal.attendance.marks.late)).toBeDefined();
    expect(within(monday).getByText('Came after the bell')).toBeDefined();
    expect(within(monday).getByText('Note: Bring the atlas')).toBeDefined();
    expect(within(monday).getByText('08:00–08:45')).toBeDefined();
  });

  it('counts the week’s marks, the exempt lesson as exempt and none as absent', async () => {
    portal();
    renderApp(`/portal/${ANVAR}/attendance`);
    const count = await screen.findByRole('region', { name: 'This week: 2 lessons' });
    const tile = (mark: string) => count.querySelector(`[data-count="${mark}"] dd`)?.textContent;
    expect(tile('present')).toBe('0');
    expect(tile('late')).toBe('1');
    expect(tile('absent')).toBe('0');
    expect(tile('exempt')).toBe('1');
    // A mark the week has none of, other than the three always named, is left out.
    expect(tile('skipped')).toBeUndefined();
  });

  it('says so for a week with no lesson', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(PARENT()),
      'GET /api/portal/children': () => json(CHILDREN),
      [`GET /api/portal/children/${ANVAR}/attendance`]: () => json({ ...WEEK, lessons: [] }),
    });
    renderApp(`/portal/${ANVAR}/attendance`);
    await screen.findByText(en.portal.attendance.empty);
  });

  it('speaks the parent’s language', async () => {
    portal('ru');
    renderApp(`/portal/${ANVAR}/attendance`, 'ru');
    const monday = await screen.findByRole('region', { name: /Понедельник/ });
    expect(within(monday).getByText(ru.portal.attendance.marks.exempt)).toBeDefined();
  });
});
