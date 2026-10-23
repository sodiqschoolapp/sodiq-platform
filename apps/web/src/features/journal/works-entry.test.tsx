import type { JournalGrid, JournalLesson, JournalStudent, JournalWork } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';
import { typedScore } from './journal-grid';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const JOURNAL = uid(1);
const PLANNED = uid(60);
const NO_PLAN = uid(61);
const SUBJECT = {
  id: uid(10),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  colour: 'blue' as const,
};
const UNIT = { kind: 'class' as const, id: uid(20), name: '7 Oxford' };
const QUARTER = { id: uid(30), number: 1, startDate: '2026-09-01', endDate: '2026-10-31' };

/** A column of the plan with no row yet (task 8.1: written at its first write). */
const TEST: JournalWork = {
  id: null,
  planWorkId: uid(70),
  sourceLessonId: PLANNED,
  kind: 'classwork',
  position: 1,
  title: 'Test',
  unplanned: false,
  total: null,
  notHeld: false,
  carriedFrom: null,
  version: null,
};

const lesson = (id: string, date: string, more: Partial<JournalLesson> = {}): JournalLesson => ({
  id,
  date,
  start: 480,
  end: 525,
  slot: 1,
  held: true,
  cancelled: null,
  month: '2026-10',
  canEnter: true,
  canEnterWorks: true,
  planItem: true,
  works: [],
  notHeldWorks: [],
  given: [],
  ...more,
});

// All names are invented.
const student = (n: number, lastName: string): JournalStudent => ({
  id: uid(100 + n),
  number: n,
  firstName: 'Ali',
  lastName,
  paternalName: null,
  uid: `S-${String(n)}`,
  folded: false,
  cells: [
    {
      closed: false,
      mark: 1,
      version: 1,
      typedBy: null,
      works: [{ score: null, percent: null, version: null, onAbsent: false }],
      score: null,
    },
    { closed: false, mark: null, version: null, typedBy: null, works: [], score: null },
  ],
  quarter: null,
  months: null,
  comments: [],
});

const GRID: JournalGrid = {
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
  shape: 'whole',
  months: ['2026-10'],
  lessons: [
    lesson(PLANNED, '2026-10-19', { works: [TEST] }),
    lesson(NO_PLAN, '2026-10-26', { planItem: false }),
  ],
  students: [student(1, 'Zokirov'), student(2, 'Abdullayev')],
  lastTotal: 30,
  absences: [],
  bottom: null,
  legend: { lateValue: 50, skippedValue: 0, daily: null, quarterly: null, weightsChangedOn: null },
};

const SAVED = {
  id: uid(80),
  kind: 'classwork',
  total: 30,
  notHeld: false,
  carriedFrom: null,
  version: 2,
};

function open(handlers: Record<string, (body: unknown) => Response> = {}) {
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
    [`GET /api/journal/journals/${JOURNAL}`]: () => json(GRID),
    ...handlers,
  });
  renderApp(`/journal/${JOURNAL}`);
  return calls;
}

const sent = (calls: ReturnType<typeof fakeApi>, route: string) =>
  calls.filter((call) => call.route === route).map((call) => call.body);

// docs/spec/07-journal.md, Entering data, The total; docs/spec/edge-cases/journal.md, Entering;
// task 8.1.
describe('classwork and homework in the grid', () => {
  it('refuses letters, decimals and numbers above the total in a cell, and takes an emptied cell', () => {
    expect(typedScore('12', 30)).toBe(12);
    expect(typedScore(' 0 ', 30)).toBe(0);
    expect(typedScore('', 30)).toBeNull();
    expect(typedScore('31', 30)).toBeUndefined();
    expect(typedScore('2.5', 30)).toBeUndefined();
    expect(typedScore('12a', 30)).toBeUndefined();
    expect(typedScore('-1', 30)).toBeUndefined();
  });

  it('heads a planned column with its title and opens its total with the last total offered', async () => {
    const calls = open({
      [`PUT /api/journal/lessons/${PLANNED}/works/total`]: () => json(SAVED),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Work: Test' }));
    const dialog = await screen.findByRole('dialog', { name: 'Work: Test' });
    const field = within(dialog).getByLabelText(en.journal.works.total);
    expect((field as HTMLInputElement).value).toBe('30');
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.works.saveTotal }));
    await waitFor(() => {
      expect(sent(calls, `PUT /api/journal/lessons/${PLANNED}/works/total`)).toEqual([
        {
          column: { planWorkId: uid(70), sourceLessonId: PLANNED },
          total: 30,
          version: null,
          confirm: false,
        },
      ]);
    });
  });

  it('asks before a total change with numbers, with each percent before and after, and sends it confirmed', async () => {
    let first = true;
    const calls = open({
      [`PUT /api/journal/lessons/${PLANNED}/works/total`]: () => {
        if (!first) return json(SAVED);
        first = false;
        return json(
          {
            error: {
              code: 'total_confirm',
              message: 'ENGLISH TEXT FOR THE DEVELOPER',
              requestId: 'test-request',
              details: [
                {
                  path: 'students.0',
                  code: 'total',
                  message: '',
                  recordId: uid(101),
                  workScore: { score: 12, percentBefore: 40, percentAfter: 12 },
                },
              ],
            },
          },
          409,
        );
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Work: Test' }));
    const dialog = await screen.findByRole('dialog', { name: 'Work: Test' });
    fireEvent.change(within(dialog).getByLabelText(en.journal.works.total), {
      target: { value: '100' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.works.saveTotal }));
    const question = await screen.findByRole('alertdialog');
    expect(question.textContent).toContain('Zokirov Ali: 12, 40% → 12%');
    fireEvent.click(
      within(question).getByRole('button', { name: en.journal.works.confirmTotalAction }),
    );
    await waitFor(() => {
      expect(
        sent(calls, `PUT /api/journal/lessons/${PLANNED}/works/total`).map(
          (body) => (body as { confirm: boolean }).confirm,
        ),
      ).toEqual([false, true]);
    });
  });

  it('refuses a total that is not a whole number from 1 to 1000 in the field', async () => {
    const calls = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Work: Test' }));
    const dialog = await screen.findByRole('dialog', { name: 'Work: Test' });
    fireEvent.change(within(dialog).getByLabelText(en.journal.works.total), {
      target: { value: '1001' },
    });
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: en.journal.works.saveTotal })
        .disabled,
    ).toBe(true);
    expect(dialog.textContent).toContain('Type a whole number from 0 to 1000.');
    expect(sent(calls, `PUT /api/journal/lessons/${PLANNED}/works/total`)).toEqual([]);
  });

  // Code review round 1, finding 1: a homework given by hand is a column of its check lesson.
  it('removes an empty homework given by hand from the lesson that shows it', async () => {
    const given: JournalWork = {
      ...TEST,
      id: uid(81),
      planWorkId: null,
      sourceLessonId: PLANNED,
      kind: 'homework',
      title: null,
      unplanned: true,
    };
    const grid: JournalGrid = {
      ...GRID,
      lessons: [
        GRID.lessons[0] as JournalLesson,
        { ...(GRID.lessons[1] as JournalLesson), works: [given] },
      ],
      students: GRID.students.map((one) => ({
        ...one,
        cells: [
          one.cells[0] as JournalStudent['cells'][number],
          {
            ...(one.cells[1] as JournalStudent['cells'][number]),
            works: [{ score: null, percent: null, version: null, onAbsent: false }],
          },
        ],
      })),
    };
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
      [`GET /api/journal/journals/${JOURNAL}`]: () => json(grid),
      [`DELETE /api/journal/lessons/${NO_PLAN}/works/${uid(81)}`]: () =>
        new Response(null, { status: 204 }),
    });
    renderApp(`/journal/${JOURNAL}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Work: HW 1 · unplanned' }));
    const dialog = await screen.findByRole('dialog', { name: 'Work: HW 1' });
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.works.remove }));
    await waitFor(() => {
      expect(
        calls.some(
          (call) => call.route === `DELETE /api/journal/lessons/${NO_PLAN}/works/${uid(81)}`,
        ),
      ).toBe(true);
    });
  });

  it('says "No plan" and adds a classwork by hand at a lesson with no plan item', async () => {
    const calls = open({
      [`POST /api/journal/lessons/${NO_PLAN}/works`]: () =>
        json({ ...SAVED, total: null, version: 1 }),
    });
    const buttons = await screen.findAllByRole('button', { name: en.journal.works.button });
    // The second lesson's button: the one with no plan item.
    fireEvent.click(buttons[1] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(en.journal.works.noPlan);
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.works.addClasswork }));
    await waitFor(() => {
      expect(sent(calls, `POST /api/journal/lessons/${NO_PLAN}/works`)).toEqual([
        { kind: 'classwork' },
      ]);
    });
  });

  it('keeps the numbers by default when present becomes absent, and clears them on the choice', async () => {
    let answers = 0;
    const calls = open({
      [`POST /api/journal/lessons/${PLANNED}/attendance`]: (body) => {
        answers += 1;
        const save = (body as { saves: { numbers?: string }[] }).saves[0];
        if (save?.numbers === undefined) {
          return json(
            {
              error: {
                code: 'numbers_keep_or_clear',
                message: 'ENGLISH TEXT FOR THE DEVELOPER',
                requestId: 'test-request',
              },
            },
            409,
          );
        }
        return json({ cells: [{ studentId: uid(101), mark: 0, version: 2 }], presentEarlier: [] });
      },
    });
    const target = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        `[row-id="${uid(101)}"] [col-id="${PLANNED}:a"]`,
      );
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.click(target);
    fireEvent.keyDown(target, { key: '0' });
    const question = await screen.findByRole('alertdialog');
    expect(question.textContent).toContain('Zokirov Ali');
    fireEvent.click(within(question).getByRole('button', { name: en.journal.works.keep }));
    await waitFor(() => {
      expect(answers).toBe(2);
    });
    expect(
      sent(calls, `POST /api/journal/lessons/${PLANNED}/attendance`).map(
        (body) => (body as { saves: { numbers?: string }[] }).saves[0]?.numbers,
      ),
    ).toEqual([undefined, 'keep']);
  });
});
