import type { JournalGrid, JournalStudent, JournalWork } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';
import { OPEN_LOCK } from '@/testing/edit-lock';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const JOURNAL = uid(1);
const LESSON = uid(60);
const OLD = uid(61);
const WORK = uid(70);
const SUBJECT = {
  id: uid(10),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  colour: 'blue' as const,
};
const UNIT = { kind: 'class' as const, id: uid(20), name: '7 Oxford' };
const QUARTER = {
  id: uid(30),
  number: 1,
  startDate: '2026-09-01',
  endDate: '2026-10-31',
  closed: false,
};

const work = (total: number | null): JournalWork => ({
  id: WORK,
  planWorkId: null,
  sourceLessonId: LESSON,
  kind: 'classwork',
  position: 1,
  title: 'Test',
  unplanned: false,
  total,
  notHeld: false,
  carriedFrom: null,
  version: 1,
});

const cell = (score: number | null) => ({
  closed: false,
  open: false,
  exempt: null,
  mark: 1,
  version: 1,
  typedBy: null,
  marker: null,
  works: [
    {
      score,
      percent: score === null ? null : score * 10,
      version: score === null ? null : 1,
      onAbsent: false,
      marker: null,
      notGraded: false,
    },
  ],
  score: null,
});

// All names are invented.
const student = (n: number, lastName: string): JournalStudent => ({
  id: uid(100 + n),
  number: n,
  firstName: 'Ali',
  lastName,
  paternalName: null,
  uid: `S-${String(n)}`,
  photoId: null,
  folded: false,
  exemptions: [],
  cells: [cell(null), cell(4)],
  quarter: null,
  months: null,
  comments: [],
  carriedIn: [],
  leftSubjectOn: null,
  atLeaving: null,
});

const lesson = (id: string, date: string, enters: boolean, total: number | null) => ({
  id,
  date,
  start: 480,
  end: 525,
  slot: 1,
  held: true,
  status: null,
  cancelled: null,
  month: '2026-10',
  canEnter: enters,
  works: [work(total)],
  canEnterWorks: enters,
  planItem: true,
  number: null,
  topic: 'Fractions',
  notDelivered: false,
  addedInJournal: [],
  copyFrom: null,
  lock: OPEN_LOCK,
  notHeldWorks: [],
  given: [],
});

const gridOf = (total: number | null): JournalGrid => ({
  journal: {
    id: JOURNAL,
    unit: UNIT,
    subject: SUBJECT,
    year: { id: uid(40), startDate: '2026-09-01', endDate: '2027-05-31', closed: false },
    attendanceOnly: false,
    ratingExam: false,
  },
  rating: null,
  years: [{ id: uid(40), startDate: '2026-09-01', endDate: '2027-05-31', closed: false }],
  others: [{ id: JOURNAL, unit: UNIT, subject: SUBJECT }],
  quarters: [QUARTER],
  quarter: QUARTER,
  today: '2026-10-27',
  referenceDate: '2026-10-27',
  teacher: { id: uid(50), name: 'Karimova Aziza' },
  shape: 'lessons',
  months: ['2026-10'],
  lessons: [lesson(LESSON, '2026-10-27', true, total), lesson(OLD, '2026-10-20', false, 10)],
  students: [student(1, 'Zokirov')],
  absences: [],
  reminders: [],
  lastTotal: null,
  bottom: null,
  legend: {
    lateValue: 50,
    skippedValue: 0,
    daily: null,
    quarterly: null,
    weightsChangedOn: null,
    countsFrom: null,
  },
});

const SCORES = `POST /api/journal/lessons/${LESSON}/scores`;

function open(date: string, total: number | null = 10) {
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
    [`GET /api/journal/journals/${JOURNAL}`]: () => json(gridOf(total)),
    [SCORES]: (body) => {
      const saves = (body as { saves: { studentId: string; score: number | null }[] }).saves;
      return json({
        cells: saves.map((one) => ({
          studentId: one.studentId,
          workId: WORK,
          score: one.score,
          percent: one.score === null ? null : one.score * 10,
          version: 2,
        })),
        works: [],
      });
    },
  });
  renderApp(`/journal/${JOURNAL}?mode=lesson&date=${date}`);
  return calls;
}

const rowOf = async () =>
  waitFor(() => {
    const found = document.querySelector<HTMLElement>(`[data-student="${uid(101)}"]`);
    expect(found).not.toBeNull();
    return found as HTMLElement;
  });

// Task 10.7: the field's name says the work's kind in full (requirement changed).
const fieldName = en.journal.lessonMode.score
  .replace('{{work}}', 'Classwork: Test')
  .replace('{{name}}', 'Zokirov Ali');

// docs/spec/07-journal.md, Lesson mode: "large buttons: attendance, then each classwork, then
// each homework" (found missing on the test site, 5 November 2026).
describe('the numbers of works in lesson mode', () => {
  it('saves a number typed for a work when the field is left, on the version read', async () => {
    const calls = open('2026-10-27');
    const row = await rowOf();
    const field = within(row).getByRole('textbox', { name: fieldName });
    // Task 10.7: the field of a work carries the tag of its kind.
    expect(row.querySelector('[data-work-kind="classwork"]')?.textContent).toBe('C');
    fireEvent.change(field, { target: { value: '7' } });
    fireEvent.blur(field);
    await waitFor(() => {
      expect(calls.filter((call) => call.route === SCORES)[0]?.body).toMatchObject({
        saves: [{ studentId: uid(101), column: { workId: WORK }, score: 7, version: null }],
      });
    });
  });

  it('refuses a number over the total and sends nothing', async () => {
    const calls = open('2026-10-27');
    const row = await rowOf();
    const field = within(row).getByRole('textbox', { name: fieldName });
    fireEvent.change(field, { target: { value: '12' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(
      await screen.findByText(en.journal.works.wholeNumber.replace('{{total}}', '10')),
    ).not.toBeNull();
    expect(calls.filter((call) => call.route === SCORES)).toEqual([]);
  });

  it('asks for the total first: no field, a button that opens the work', async () => {
    open('2026-10-27', null);
    const row = await rowOf();
    expect(within(row).queryByRole('textbox')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        // Task 10.7: the button's name says the kind in full before its visible words
        // (requirement changed).
        name: `Classwork: ${en.journal.lessonMode.setTotal.replace('{{work}}', 'Test')}`,
      }),
    );
    expect(
      await screen.findByText(en.journal.works.workTitle.replace('{{name}}', 'Test')),
    ).not.toBeNull();
  });

  it('shows the numbers of a lesson the reader does not enter, with no field', async () => {
    open('2026-10-20');
    const row = await rowOf();
    expect(within(row).queryByRole('textbox')).toBeNull();
    expect(
      // Task 10.7: the kind in full and the work's title (requirement changed: it was "CW 1").
      within(row).getByLabelText('Classwork: Test'),
    ).not.toBeNull();
  });
});
