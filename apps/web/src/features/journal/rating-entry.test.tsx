import type { JournalGrid, JournalLesson, JournalStudent, RatingExam } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';
import { typedScore } from './journal-grid';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const JOURNAL = uid(1);
const LESSON = uid(60);
const SUBJECT = {
  id: uid(10),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  colour: 'blue' as const,
};
const UNIT = { kind: 'class' as const, id: uid(20), name: '7 Oxford' };
const QUARTER = { id: uid(30), number: 1, startDate: '2026-09-01', endDate: '2026-10-31' };

const lesson: JournalLesson = {
  id: LESSON,
  date: '2026-10-26',
  start: 480,
  end: 525,
  slot: 1,
  held: true,
  cancelled: null,
  month: '2026-10',
  canEnter: true,
  canEnterWorks: true,
  planItem: true,
  copyFrom: null,
  works: [],
  notHeldWorks: [],
  given: [],
};

// All names are invented.
const student = (n: number, lastName: string): JournalStudent => ({
  id: uid(100 + n),
  number: n,
  firstName: 'Ali',
  lastName,
  paternalName: null,
  uid: `S-${String(n)}`,
  folded: false,
  cells: [{ closed: false, mark: 1, version: 1, typedBy: null, works: [], score: null }],
  quarter: null,
  months: null,
  comments: [],
});

const EXAM: RatingExam = {
  journalId: JOURNAL,
  quarterId: QUARTER.id,
  date: '2026-10-26',
  fromExam: false,
  notHeld: false,
  version: 2,
  canSetDate: true,
  canSetNotHeld: false,
  canEnter: true,
  canExempt: false,
  entries: [
    {
      studentId: uid(101),
      entry: { kind: 'score', score: 40 },
      version: 1,
      changedBy: 'Karimova Aziza',
      changedAt: '2026-10-26T05:00:00.000Z',
    },
  ],
};

const GRID: JournalGrid = {
  journal: {
    id: JOURNAL,
    unit: UNIT,
    subject: SUBJECT,
    year: { id: uid(40), startDate: '2026-09-01', endDate: '2027-05-31', closed: false },
    attendanceOnly: false,
    ratingExam: true,
  },
  rating: EXAM,
  years: [{ id: uid(40), startDate: '2026-09-01', endDate: '2027-05-31', closed: false }],
  others: [{ id: JOURNAL, unit: UNIT, subject: SUBJECT }],
  quarters: [QUARTER],
  quarter: QUARTER,
  today: '2026-10-27',
  referenceDate: '2026-10-27',
  teacher: { id: uid(50), name: 'Karimova Aziza' },
  shape: 'whole',
  months: ['2026-10'],
  lessons: [lesson],
  students: [student(1, 'Zokirov'), student(2, 'Abdullayev')],
  lastTotal: null,
  absences: [],
  bottom: null,
  legend: {
    lateValue: 50,
    skippedValue: 0,
    daily: { attendance: 20, classwork: 40, homework: 40 },
    quarterly: { attendance: 20, classwork: 20, homework: 20, ratingExam: 40 },
    weightsChangedOn: null,
  },
};

const ENTRIES = `POST /api/journal/journals/${JOURNAL}/rating/${QUARTER.id}/entries`;

function open(language: 'en' | 'ru' = 'en', grid: JournalGrid = GRID) {
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(sessionOf({ language, assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
    [`GET /api/journal/journals/${JOURNAL}`]: () => json(grid),
    [ENTRIES]: () => json(EXAM),
    [`PUT /api/journal/journals/${JOURNAL}/rating/${QUARTER.id}/date`]: () => json(EXAM),
    [`GET /api/journal/journals/${JOURNAL}/rating/${QUARTER.id}/students/${uid(101)}/history`]:
      () => json({ lines: [] }),
    'GET /api/journal/comments/history': () => json({ lines: [] }),
    'PUT /api/journal/comments': () =>
      json({
        id: uid(90),
        target: 'mark',
        studentId: uid(101),
        lessonId: LESSON,
        workId: null,
        body: 'Came late',
        visibility: 'staff',
        version: 1,
        changedBy: 'Karimova Aziza',
        changedAt: '2026-10-27T05:00:00.000Z',
      }),
  });
  renderApp(`/journal/${JOURNAL}`, language);
  return calls;
}

const cellOf = (id: string, colId: string) =>
  waitFor(() => {
    const found = document.querySelector<HTMLElement>(`[row-id="${id}"] [col-id="${colId}"]`);
    expect(found).not.toBeNull();
    return found as HTMLElement;
  });

const sent = (calls: ReturnType<typeof fakeApi>, route: string) =>
  calls.filter((call) => call.route === route).map((call) => call.body);

// docs/spec/edge-cases/calculation.md, "The rating exam"; docs/spec/07-journal.md, Entering
// data, Comments and Keyboard; task 8.2.
describe('the rating exam and comments in the grid', () => {
  it('takes a whole score from 0 to 100 in a cell and refuses the rest (edge/calculation: "Whole numbers from 0 to 100")', () => {
    expect(typedScore('0', 100)).toBe(0);
    expect(typedScore('100', 100)).toBe(100);
    expect(typedScore('101', 100)).toBeUndefined();
    expect(typedScore('49.5', 100)).toBeUndefined();
    expect(typedScore('a', 100)).toBeUndefined();
    expect(typedScore('', 100)).toBeNull();
  });

  it('shows the exam date under the column and the stored entries', async () => {
    open();
    const cell = await cellOf(uid(101), 'ratingExam');
    expect(cell.textContent).toBe('40');
    const header = document.querySelector('[col-id="ratingExam"][role="columnheader"]');
    expect(header?.textContent).toContain('26 Oct');
  });

  it("opens a student's entry at the key E and asks the reason over an entry (decision 9)", async () => {
    const calls = open();
    const cell = await cellOf(uid(101), 'ratingExam');
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: 'e', code: 'KeyE' });
    const dialog = await screen.findByRole('dialog', { name: 'Rating exam: Zokirov Ali' });
    // The letter starts no edit of the score (decision 11).
    expect(document.querySelector('[data-refused-number]')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(en.journal.rating.score), {
      target: { value: '75' },
    });
    const save = within(dialog).getByRole('button', { name: en.journal.rating.saveScore });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(en.journal.rating.reason), {
      target: { value: 'Retake' },
    });
    fireEvent.click(save);
    await waitFor(() => {
      expect(sent(calls, ENTRIES)).toEqual([
        {
          studentId: uid(101),
          entry: { kind: 'score', score: 75 },
          reason: 'Retake',
          version: 1,
        },
      ]);
    });
  });

  it('sends "did not sit" for a student with no entry, with no reason', async () => {
    const calls = open();
    const cell = await cellOf(uid(102), 'ratingExam');
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: 'e', code: 'KeyE' });
    const dialog = await screen.findByRole('dialog', { name: 'Rating exam: Abdullayev Ali' });
    expect(within(dialog).queryByLabelText(en.journal.rating.reason)).toBeNull();
    fireEvent.click(
      within(dialog).getByRole('button', { name: en.journal.rating.kinds.did_not_sit }),
    );
    await waitFor(() => {
      expect(sent(calls, ENTRIES)).toEqual([
        { studentId: uid(102), entry: { kind: 'did_not_sit' }, reason: null, version: null },
      ]);
    });
  });

  it('opens the comment of an attendance mark at the key C, also typed in Cyrillic (decision 11)', async () => {
    const calls = open('ru');
    const cell = await cellOf(uid(101), `${LESSON}:a`);
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: 'с', code: 'KeyC' });
    const dialog = await screen.findByRole('dialog', { name: 'Комментарии: Zokirov Ali' });
    const mark = within(dialog).getByRole('region', { name: ru.journal.comments.targets.mark });
    within(dialog).getByRole('region', { name: ru.journal.comments.targets.note });
    fireEvent.change(within(mark).getByLabelText(ru.journal.comments.body), {
      target: { value: 'Came late' },
    });
    fireEvent.click(within(mark).getByRole('button', { name: ru.journal.comments.save }));
    await waitFor(() => {
      expect(sent(calls, 'PUT /api/journal/comments')).toEqual([
        {
          on: { target: 'mark', lessonId: LESSON, studentId: uid(101) },
          body: 'Came late',
          visibility: 'staff',
          version: null,
        },
      ]);
    });
  });

  it('marks a cell with a comment', async () => {
    open('en', {
      ...GRID,
      students: [
        {
          ...student(1, 'Zokirov'),
          comments: [
            {
              id: uid(90),
              target: 'rating',
              studentId: uid(101),
              lessonId: null,
              workId: null,
              body: 'Strong exam',
              visibility: 'parents',
              version: 1,
              changedBy: null,
              changedAt: '2026-10-27T05:00:00.000Z',
            },
          ],
        },
        student(2, 'Abdullayev'),
      ],
    });
    const marked = await cellOf(uid(101), 'ratingExam');
    expect(marked.className).toContain('after:border-t-info');
    const plain = await cellOf(uid(102), 'ratingExam');
    expect(plain.className).not.toContain('after:border-t-info');
  });

  it('saves on a cleared comment with its stored version, and does not mark the cell (code review round 2)', async () => {
    const calls = open('en', {
      ...GRID,
      students: [
        {
          ...student(1, 'Zokirov'),
          comments: [
            {
              id: uid(91),
              target: 'mark',
              studentId: uid(101),
              lessonId: LESSON,
              workId: null,
              body: null,
              visibility: 'staff',
              version: 2,
              changedBy: null,
              changedAt: '2026-10-27T05:00:00.000Z',
            },
          ],
        },
        student(2, 'Abdullayev'),
      ],
    });
    const cell = await cellOf(uid(101), `${LESSON}:a`);
    expect(cell.className).not.toContain('after:border-t-info');
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: 'c', code: 'KeyC' });
    const dialog = await screen.findByRole('dialog');
    const mark = within(dialog).getByRole('region', { name: en.journal.comments.targets.mark });
    expect(within(mark).queryByRole('button', { name: en.journal.comments.clear })).toBeNull();
    fireEvent.change(within(mark).getByLabelText(en.journal.comments.body), {
      target: { value: 'Came late again' },
    });
    fireEvent.click(within(mark).getByRole('button', { name: en.journal.comments.save }));
    await waitFor(() => {
      expect(sent(calls, 'PUT /api/journal/comments')).toEqual([
        {
          on: { target: 'mark', lessonId: LESSON, studentId: uid(101) },
          body: 'Came late again',
          visibility: 'staff',
          version: 2,
        },
      ]);
    });
  });
});
