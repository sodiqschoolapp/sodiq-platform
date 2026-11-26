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
  // In the order of the lessons: 20 October, then 27 October.
  cells: [cell(4), cell(null)],
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
  // In time order, as the API sends them (`journal-grid.query.ts`).
  lessons: [lesson(OLD, '2026-10-20', false, 10), lesson(LESSON, '2026-10-27', true, total)],
  students: [student(1, 'Zokirov')],
  absences: [],
  reminders: [],
  lastTotal: null,
  bottom: null,
  legend: {
    lateValue: 50,
    skippedValue: 0,
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
          notGraded: false,
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

/**
 * Lesson mode enters one column at a time on a phone (owner, 20 November 2026): the work's column
 * is chosen first (requirement changed: the fields stood on every row at once).
 */
const chooseWork = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Classwork: Test' }));
};

// Task 10.7: the field's name says the work's kind in full (requirement changed).
const fieldName = en.journal.lessonMode.score
  .replace('{{work}}', 'Classwork: Test')
  .replace('{{name}}', 'Zokirov Ali');

// docs/spec/07-journal.md, Lesson mode: "large buttons: attendance, then each classwork, then
// each homework" (found missing on the test site, 5 November 2026).
describe('the numbers of works in lesson mode', () => {
  it('saves a number typed for a work when the field is left, on the version read', async () => {
    const calls = open('2026-10-27');
    await rowOf();
    chooseWork();
    const row = await rowOf();
    const field = within(row).getByRole('textbox', { name: fieldName });
    // Task 10.7: the column of a work carries the tag of its kind (on its button since the
    // one-column layout of 20 November 2026; the row holds the field).
    expect(
      screen
        .getByRole('button', { name: 'Classwork: Test' })
        .querySelector('[data-work-kind="classwork"]')?.textContent,
    ).toBe('C');
    fireEvent.change(field, { target: { value: '7' } });
    fireEvent.blur(field);
    await waitFor(() => {
      expect(calls.filter((call) => call.route === SCORES)[0]?.body).toMatchObject({
        saves: [{ studentId: uid(101), column: { workId: WORK }, score: 7, version: null }],
      });
    });
  });

  // The owner, 20 November 2026: a "-" is "not graded", typed or with the button beside the field.
  it('saves a typed "-" and the "-" button as "not graded"', async () => {
    const calls = open('2026-10-27');
    await rowOf();
    chooseWork();
    const row = await rowOf();
    const field = within(row).getByRole('textbox', { name: fieldName });
    fireEvent.change(field, { target: { value: '-' } });
    fireEvent.blur(field);
    await waitFor(() => {
      expect(calls.filter((call) => call.route === SCORES)[0]?.body).toMatchObject({
        saves: [
          {
            studentId: uid(101),
            column: { workId: WORK },
            score: null,
            notGraded: true,
            version: null,
          },
        ],
      });
    });
  });

  it('saves the "-" button beside the field as "not graded"', async () => {
    const calls = open('2026-10-27');
    await rowOf();
    chooseWork();
    const row = await rowOf();
    fireEvent.click(
      within(row).getByRole('button', {
        name: en.journal.notGraded.typeFor.replace('{{name}}', 'Zokirov Ali'),
      }),
    );
    await waitFor(() => {
      expect(calls.filter((call) => call.route === SCORES)[0]?.body).toMatchObject({
        saves: [{ studentId: uid(101), score: null, notGraded: true, version: null }],
      });
    });
  });

  it('refuses a number over the total and sends nothing', async () => {
    const calls = open('2026-10-27');
    await rowOf();
    chooseWork();
    const row = await rowOf();
    const field = within(row).getByRole('textbox', { name: fieldName });
    fireEvent.change(field, { target: { value: '12' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(
      await screen.findByText(en.journal.works.amount.replace('{{total}}', '10')),
    ).not.toBeNull();
    expect(calls.filter((call) => call.route === SCORES)).toEqual([]);
  });

  // Task 11.25b; `07`, The total ("a comma is refused"); `edge/journal`, "The teacher types "1"
  // then "2" for 12." ("Letters, a comma, … and more than two digits after the point are refused in
  // the cell").
  it.each([
    ['7,5', en.journal.refusals.comma],
    ['7.555', en.journal.refusals.decimals],
    ['7a', en.journal.refusals.notNumber],
  ])('refuses %s with its reason and sends nothing', async (typed, reason) => {
    const calls = open('2026-10-27');
    await rowOf();
    chooseWork();
    const row = await rowOf();
    const field = within(row).getByRole('textbox', { name: fieldName });
    fireEvent.change(field, { target: { value: typed } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(await screen.findByText(reason)).not.toBeNull();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('title')).toBe(reason);
    expect(calls.filter((call) => call.route === SCORES)).toEqual([]);
  });

  // Task 11.25b, decision 11: the point key beside the field types a point (the keypad's own
  // decimal key may be a comma), and 7.5 is sent as 7.5; "8." is read as 8.
  it('types a point with its own key and sends 7.5', async () => {
    const calls = open('2026-10-27');
    await rowOf();
    chooseWork();
    const row = await rowOf();
    const field = within(row).getByRole<HTMLInputElement>('textbox', { name: fieldName });
    fireEvent.change(field, { target: { value: '7' } });
    field.setSelectionRange(1, 1);
    fireEvent.click(within(row).getByRole('button', { name: en.journal.refusals.point }));
    expect(field.value).toBe('7.');
    fireEvent.change(field, { target: { value: '7.5' } });
    fireEvent.blur(field);
    await waitFor(() => {
      expect(calls.filter((call) => call.route === SCORES)[0]?.body).toMatchObject({
        saves: [{ studentId: uid(101), column: { workId: WORK }, score: 7.5, version: null }],
      });
    });
  });

  it('asks for the total first: no field, a button that opens the work', async () => {
    open('2026-10-27', null);
    await rowOf();
    chooseWork();
    const row = await rowOf();
    expect(within(row).queryByRole('textbox')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        // Task 10.7: the button's name says the kind in full before its visible words
        // (requirement changed).
        name: `Classwork: ${en.journal.lessonMode.setTotal.replace('{{work}}', 'Test')}`,
      }),
    );
    // The owner, 20 November 2026: the lesson editor opens with the work's total waiting.
    const total = await screen.findByLabelText(
      en.journal.editor.totalOf.replace('{{name}}', 'Test'),
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(total);
    });
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

// Owner, 20 November 2026: lesson mode on a phone, one column at a time, Enter going on to the
// next student, and the lessons before and after a tap away.
describe('lesson mode on a phone', () => {
  function openTwo() {
    const grid = { ...gridOf(10), students: [student(1, 'Zokirov'), student(2, 'Yusupov')] };
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
      [`GET /api/journal/journals/${JOURNAL}`]: () => json(grid),
      [SCORES]: (body) => {
        const saves = (body as { saves: { studentId: string; score: number | null }[] }).saves;
        return json({
          cells: saves.map((one) => ({
            studentId: one.studentId,
            workId: WORK,
            score: one.score,
            percent: one.score === null ? null : one.score * 10,
            notGraded: false,
            version: 2,
          })),
          works: [],
        });
      },
    });
    renderApp(`/journal/${JOURNAL}?mode=lesson&date=2026-10-27`);
    return calls;
  }

  const fieldOf = (name: string) =>
    screen.getByRole('textbox', {
      name: en.journal.lessonMode.score
        .replace('{{work}}', 'Classwork: Test')
        .replace('{{name}}', name),
    });

  it('saves once on Enter and goes on to the next student of the same work', async () => {
    const calls = openTwo();
    await rowOf();
    chooseWork();
    const first = fieldOf('Zokirov Ali');
    first.focus();
    fireEvent.change(first, { target: { value: '7' } });
    fireEvent.keyDown(first, { key: 'Enter' });
    // The focus moved on, which also blurs the first field: still one save.
    expect(document.activeElement).toBe(fieldOf('Yusupov Ali'));
    fireEvent.blur(first);
    await waitFor(() => {
      expect(calls.filter((call) => call.route === SCORES)).toHaveLength(1);
    });
    expect(calls.filter((call) => call.route === SCORES)[0]?.body).toMatchObject({
      saves: [{ studentId: uid(101), score: 7 }],
    });
  });

  it('keeps a refused number in its field, marked, and stays on it', async () => {
    const calls = openTwo();
    await rowOf();
    chooseWork();
    const first = fieldOf('Zokirov Ali');
    first.focus();
    fireEvent.change(first, { target: { value: '12' } });
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(document.activeElement).toBe(first);
    expect((first as HTMLInputElement).value).toBe('12');
    expect(first.getAttribute('aria-invalid')).toBe('true');
    expect(calls.filter((call) => call.route === SCORES)).toEqual([]);
    fireEvent.change(first, { target: { value: '9' } });
    expect(first.getAttribute('aria-invalid')).toBeNull();
  });

  it('starts at attendance and goes on to each work with "Next"', async () => {
    open('2026-10-27');
    const row = await rowOf();
    expect(within(row).queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Attendance' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: en.journal.lessonMode.next.replace('{{column}}', 'Test'),
      }),
    );
    expect(within(await rowOf()).getByRole('textbox', { name: fieldName })).not.toBeNull();
    // The last column has no "Next".
    expect(screen.queryByRole('button', { name: /^Next: / })).toBeNull();
  });

  it("says Today on today's lesson and moves to the lessons before and after", async () => {
    open('2026-10-27');
    await rowOf();
    const heading = () => document.querySelector('[data-lesson-mode] h2')?.textContent;
    expect(heading()).toBe(`${en.journal.grid.today}, 27 October`);
    expect(document.querySelector('[data-lesson-mode-today]')?.getAttribute('aria-current')).toBe(
      'date',
    );
    // Today's lesson is the last of the fixture: nothing after it.
    const next = screen.getByRole('button', { name: en.journal.lessonMode.nextLesson });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: en.journal.lessonMode.previousLesson }));
    await waitFor(() => {
      expect(document.querySelector(`[data-lesson-mode="${OLD}"]`)).not.toBeNull();
    });
    expect(heading()).toBe('Tuesday, 20 October');
    expect(document.querySelector('[data-lesson-mode-today]')).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: en.journal.lessonMode.previousLesson,
      }).disabled,
    ).toBe(true);
  });

  it("keeps the next student's field free while a number is saved, and waits only the saved one", async () => {
    const grid = { ...gridOf(10), students: [student(1, 'Zokirov'), student(2, 'Yusupov')] };
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
      [`GET /api/journal/journals/${JOURNAL}`]: () => json(grid),
      // No save answers: each stays on its way.
      [SCORES]: () => new Promise<Response>(() => {}),
    });
    renderApp(`/journal/${JOURNAL}?mode=lesson&date=2026-10-27`);
    await rowOf();
    chooseWork();
    const first = fieldOf('Zokirov Ali');
    first.focus();
    fireEvent.change(first, { target: { value: '7' } });
    fireEvent.keyDown(first, { key: 'Enter' });
    await waitFor(() => {
      expect(calls.filter((call) => call.route === SCORES)).toHaveLength(1);
    });
    // The saved one waits (read only, still focusable); the next one is free and takes a number.
    await waitFor(() => {
      expect((fieldOf('Zokirov Ali') as HTMLInputElement).readOnly).toBe(true);
    });
    const second = fieldOf('Yusupov Ali') as HTMLInputElement;
    expect(second.disabled).toBe(false);
    expect(second.readOnly).toBe(false);
    expect(document.activeElement).toBe(second);
    fireEvent.change(second, { target: { value: '9' } });
    fireEvent.keyDown(second, { key: 'Enter' });
    await waitFor(() => {
      expect(calls.filter((call) => call.route === SCORES).map((call) => call.body)).toMatchObject([
        { saves: [{ studentId: uid(101), score: 7 }] },
        { saves: [{ studentId: uid(102), score: 9 }] },
      ]);
    });
  });

  it('keeps what is typed with its work when another work is chosen', async () => {
    const two = (total: number | null): JournalGrid => {
      const base = gridOf(total);
      const second: JournalWork = { ...work(10), id: uid(71), position: 2, title: 'Quiz' };
      return {
        ...base,
        lessons: base.lessons.map((one) =>
          one.id === LESSON ? { ...one, works: [work(10), second] } : one,
        ),
        students: base.students.map((one) => ({
          ...one,
          cells: one.cells.map((c, at) =>
            at === 1 ? { ...c, works: [...c.works, ...c.works] } : c,
          ),
        })),
      };
    };
    fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
      [`GET /api/journal/journals/${JOURNAL}`]: () => json(two(10)),
    });
    renderApp(`/journal/${JOURNAL}?mode=lesson&date=2026-10-27`);
    await rowOf();
    chooseWork();
    const field = within(await rowOf()).getByRole('textbox', { name: fieldName });
    // A refused number stays in the field of its own work.
    fireEvent.change(field, { target: { value: '15' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect((field as HTMLInputElement).value).toBe('15');
    fireEvent.click(screen.getByRole('button', { name: 'Classwork: Quiz' }));
    const quiz = within(await rowOf()).getByRole('textbox', {
      name: en.journal.lessonMode.score
        .replace('{{work}}', 'Classwork: Quiz')
        .replace('{{name}}', 'Zokirov Ali'),
    });
    expect((quiz as HTMLInputElement).value).toBe('');
    expect(quiz.getAttribute('aria-invalid')).toBeNull();
  });

  it('shows the total of a work entered through an unlock', async () => {
    const base = gridOf(10);
    const grid: JournalGrid = {
      ...base,
      // The lesson is not entered as a whole; an unlock opened the student's cells.
      lessons: base.lessons.map((one) =>
        one.id === LESSON ? { ...one, canEnter: false, canEnterWorks: false } : one,
      ),
      students: base.students.map((one) => ({
        ...one,
        cells: one.cells.map((c, at) => (at === 1 ? { ...c, open: true } : c)),
      })),
    };
    fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
      [`GET /api/journal/journals/${JOURNAL}`]: () => json(grid),
    });
    renderApp(`/journal/${JOURNAL}?mode=lesson&date=2026-10-27`);
    await rowOf();
    chooseWork();
    expect(document.querySelector('[data-lesson-mode-total]')?.textContent).toBe(
      `C${en.journal.grid.total.replace('{{total}}', '10')}`,
    );
    expect(within(await rowOf()).getByRole('textbox', { name: fieldName })).not.toBeNull();
  });
});
