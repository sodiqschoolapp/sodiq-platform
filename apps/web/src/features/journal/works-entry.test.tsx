import type { JournalGrid, JournalLesson, JournalStudent, JournalWork } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';
import { typedScore, typedWorkEntry } from './journal-grid';
import { OPEN_LOCK } from '@/testing/edit-lock';

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
const QUARTER = {
  id: uid(30),
  number: 1,
  startDate: '2026-09-01',
  endDate: '2026-10-31',
  closed: false,
};

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
  version: null,
};

const lesson = (id: string, date: string, more: Partial<JournalLesson> = {}): JournalLesson => ({
  id,
  date,
  start: 480,
  end: 525,
  slot: 1,
  held: true,
  status: null,
  cancelled: null,
  month: '2026-10',
  canEnter: true,
  canEnterWorks: true,
  planItem: true,
  number: null,
  topic: null,
  notDelivered: false,
  addedInJournal: [],
  copyFrom: null,
  lock: OPEN_LOCK,
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
  photoId: null,
  folded: false,
  exemptions: [],
  cells: [
    {
      closed: false,
      open: false,
      exempt: null,
      mark: 1,
      version: 1,
      typedBy: null,
      marker: null,
      works: [
        {
          score: null,
          percent: null,
          version: null,
          onAbsent: false,
          marker: null,
          notGraded: false,
        },
      ],
    },
    {
      closed: false,
      open: false,
      exempt: null,
      mark: null,
      version: null,
      typedBy: null,
      marker: null,
      works: [],
    },
  ],
  quarter: null,
  months: null,
  comments: [],
  carriedIn: [],
  leftSubjectOn: null,
  atLeaving: null,
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
  reminders: [],
  lastTotal: 30,
  absences: [],
  bottom: null,
  legend: {
    lateValue: 50,
    skippedValue: 0,
    quarterly: null,
    weightsChangedOn: null,
    countsFrom: null,
  },
};

const SAVED = {
  id: uid(80),
  kind: 'classwork',
  total: 30,
  notHeld: false,
  title: null,
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

const EMPTY_SCORE = {
  score: null,
  percent: null,
  version: null,
  onAbsent: false,
  marker: null,
  notGraded: false,
};

const totalOf = (name: string) => en.journal.editor.totalOf.replace('{{name}}', name);
const deleteOf = (name: string) => en.journal.editor.delete.replace('{{name}}', name);

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

  // The owner, 20 November 2026: one lesson editor. A work's header opens it at its total.
  it('heads a planned column with its title and opens the lesson editor at its total, the last total offered', async () => {
    const calls = open({
      [`PUT /api/journal/lessons/${PLANNED}/works/total`]: () => json(SAVED),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Work: Test' }));
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText(totalOf('Test'));
    expect((field as HTMLInputElement).placeholder).toBe('30');
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });
    fireEvent.change(field, { target: { value: '30' } });
    fireEvent.keyDown(field, { key: 'Enter' });
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
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText(totalOf('Test'));
    fireEvent.change(field, { target: { value: '100' } });
    fireEvent.blur(field);
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

  // Task 11.25b (Look first, decision 1: until then this test refused 2.5): a total is from 1
  // to 1000 with at most two digits after the point (`07`, The total; `edge/journal`, "A total of
  // 3000 is typed"), each refusal with its reason (review correction 2).
  it('refuses a total out of 1 to 1000, with a comma or with three decimals, with its reason', async () => {
    const calls = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Work: Test' }));
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText(totalOf('Test'));
    for (const [value, reason] of [
      ['1001', en.journal.works.totalAmount],
      ['0', en.journal.works.totalAmount],
      ['0.5', en.journal.works.totalAmount],
      ['2,5', en.journal.refusals.comma],
      ['2.555', en.journal.refusals.decimals],
      ['abc', en.journal.refusals.notNumber],
    ] as const) {
      fireEvent.change(field, { target: { value } });
      fireEvent.keyDown(field, { key: 'Enter' });
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect(field.getAttribute('title')).toBe(reason);
    }
    expect(sent(calls, `PUT /api/journal/lessons/${PLANNED}/works/total`)).toEqual([]);
  });

  // Task 11.25b, review correction 1: the total field has a point key of its own and takes 7.5.
  it('types a point in the total with its own key and sends a total of 7.5', async () => {
    const calls = open({
      [`PUT /api/journal/lessons/${PLANNED}/works/total`]: () => json(SAVED),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Work: Test' }));
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText<HTMLInputElement>(totalOf('Test'));
    fireEvent.change(field, { target: { value: '7' } });
    field.setSelectionRange(1, 1);
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.refusals.point }));
    expect(field.value).toBe('7.');
    fireEvent.change(field, { target: { value: '7.5' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => {
      expect(sent(calls, `PUT /api/journal/lessons/${PLANNED}/works/total`)).toEqual([
        {
          column: { planWorkId: uid(70), sourceLessonId: PLANNED },
          total: 7.5,
          version: null,
          confirm: false,
        },
      ]);
    });
  });

  it('saves the topic of the lesson on the topic read', async () => {
    const calls = open({
      [`PUT /api/journal/lessons/${PLANNED}/topic`]: () =>
        json({ itemId: uid(90), topic: 'Fractions' }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Work: Test' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(en.journal.card.topic), {
      target: { value: '  Fractions ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.editor.saveTopic }));
    await waitFor(() => {
      expect(sent(calls, `PUT /api/journal/lessons/${PLANNED}/topic`)).toEqual([
        { topic: 'Fractions', baseTopic: '' },
      ]);
    });
  });

  it('adds a classwork and gives a homework, keeping the typed title when the server refuses', async () => {
    let refuse = true;
    const calls = open({
      [`POST /api/journal/lessons/${PLANNED}/works`]: (body) => {
        if (refuse) {
          refuse = false;
          return json(
            {
              error: {
                code: 'journal_works_limit',
                message: 'ENGLISH TEXT FOR THE DEVELOPER',
                requestId: 'test-request',
              },
            },
            409,
          );
        }
        const kind = (body as { kind: 'classwork' | 'homework' }).kind;
        return json({ planWorkId: uid(91), itemId: uid(90), kind, title: 'Reading' });
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Work: Test' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.editor.addClasswork }));
    const title = within(dialog).getByLabelText(en.journal.works.classworkTitle);
    fireEvent.change(title, { target: { value: 'Dictation' } });
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.works.add }));
    expect(await within(dialog).findByText(en.errors.journal_works_limit)).not.toBeNull();
    expect(
      within(dialog).getByLabelText<HTMLInputElement>(en.journal.works.classworkTitle).value,
    ).toBe('Dictation');
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.works.cancel }));
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.editor.addHomework }));
    fireEvent.change(within(dialog).getByLabelText(en.journal.works.homeworkTitle), {
      target: { value: 'Reading' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.works.add }));
    await waitFor(() => {
      expect(sent(calls, `POST /api/journal/lessons/${PLANNED}/works`)).toEqual([
        { kind: 'classwork', title: 'Dictation' },
        { kind: 'homework', title: 'Reading' },
      ]);
    });
  });

  it('renames a planned work on the title read', async () => {
    const calls = open({
      [`PUT /api/journal/lessons/${PLANNED}/plan-works/${uid(70)}/title`]: () =>
        json({ planWorkId: uid(70), itemId: uid(90), kind: 'classwork', title: 'Quiz' }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Work: Test' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: en.journal.editor.rename.replace('{{name}}', 'Test'),
      }),
    );
    fireEvent.change(within(dialog).getByLabelText(en.journal.works.titleLabel), {
      target: { value: 'Quiz' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.works.rename }));
    await waitFor(() => {
      expect(
        sent(calls, `PUT /api/journal/lessons/${PLANNED}/plan-works/${uid(70)}/title`),
      ).toEqual([{ title: 'Quiz', baseTitle: 'Test' }]);
    });
  });

  it('deletes an empty work from the plan at once', async () => {
    const calls = open({
      [`DELETE /api/journal/lessons/${PLANNED}/plan-works/${uid(70)}`]: () =>
        new Response(null, { status: 204 }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Work: Test' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: deleteOf('Test') }));
    await waitFor(() => {
      expect(
        calls.some(
          (call) => call.route === `DELETE /api/journal/lessons/${PLANNED}/plan-works/${uid(70)}`,
        ),
      ).toBe(true);
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  // Task 11.25b (`07`, The total: "shown with a point, without trailing zeros (7.50 shows 7.5)";
  // the spec change: "a point in every language"): no number format of the language turns it into
  // 7,5 in Russian or Uzbek.
  it.each(['ru', 'uz', 'en'] as const)(
    'shows a score of 7.5 and a total of 7.5 with a point in %s',
    async (language) => {
      const grid: JournalGrid = {
        ...GRID,
        lessons: GRID.lessons.map((one, index) =>
          index > 0
            ? one
            : {
                ...one,
                works: one.works.map((work) => ({ ...work, id: uid(80), total: 7.5 })),
              },
        ),
        students: GRID.students.map((one, index) =>
          index > 0
            ? one
            : {
                ...one,
                cells: [
                  {
                    ...(one.cells[0] as JournalStudent['cells'][number]),
                    works: [
                      {
                        score: 7.5,
                        percent: 100,
                        version: 1,
                        onAbsent: false,
                        marker: null,
                        notGraded: false,
                      },
                    ],
                  },
                  one.cells[1] as JournalStudent['cells'][number],
                ],
              },
        ),
      };
      fakeApi({
        'GET /api/auth/session': () =>
          json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
        [`GET /api/journal/journals/${JOURNAL}`]: () => json(grid),
      });
      renderApp(`/journal/${JOURNAL}`, language);
      const score = await waitFor(() => {
        const found = document.querySelector<HTMLElement>(`[row-id="${uid(101)}"] [data-score]`);
        expect(found).not.toBeNull();
        return found as HTMLElement;
      });
      expect(score.firstChild?.textContent).toBe('7.5');
      expect(score.textContent).toBe('7.5100%');
      const header = document.querySelector(
        `[col-id="${PLANNED}:${uid(80)}"][role="columnheader"]`,
      );
      expect(header?.textContent ?? '').toContain('7.5');
      expect(header?.textContent ?? '').not.toContain('7,5');
    },
  );

  it('asks before deleting a work with numbers, naming the count, and keeps it out of the journal with its numbers in the history', async () => {
    const grid: JournalGrid = {
      ...GRID,
      students: GRID.students.map((one, index) =>
        index > 0
          ? one
          : {
              ...one,
              cells: [
                {
                  ...(one.cells[0] as JournalStudent['cells'][number]),
                  works: [
                    {
                      score: 5,
                      percent: 50,
                      version: 1,
                      onAbsent: false,
                      marker: null,
                      notGraded: false,
                    },
                  ],
                },
                one.cells[1] as JournalStudent['cells'][number],
              ],
            },
      ),
    };
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
      [`GET /api/journal/journals/${JOURNAL}`]: () => json(grid),
      [`PUT /api/journal/lessons/${PLANNED}/works/not-held`]: () =>
        json({ ...SAVED, notHeld: true }),
    });
    renderApp(`/journal/${JOURNAL}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Work: Test' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: deleteOf('Test') }));
    const question = await screen.findByRole('alertdialog');
    expect(question.textContent).toContain(
      en.journal.editor.deleteNumbers_one.replace('{{count}}', '1'),
    );
    fireEvent.click(within(question).getByRole('button', { name: en.journal.editor.deleteAction }));
    await waitFor(() => {
      expect(sent(calls, `PUT /api/journal/lessons/${PLANNED}/works/not-held`)).toEqual([
        {
          column: { planWorkId: uid(70), sourceLessonId: PLANNED },
          notHeld: true,
          version: null,
          confirm: true,
        },
      ]);
    });
    expect(calls.some((call) => call.route.startsWith('DELETE'))).toBe(false);
  });

  // Code review round 1 of task 8.1: a homework given by hand is a column of its check lesson.
  // Task 11.24 (`07`, Homework column): a homework is a column of the lesson where it was given,
  // so it is deleted there, like a classwork.
  it('deletes an empty homework given by hand, and keeps out one with a total, at the lesson where they were given', async () => {
    const given: JournalWork = {
      ...TEST,
      id: uid(81),
      planWorkId: null,
      sourceLessonId: PLANNED,
      kind: 'homework',
      title: null,
      unplanned: true,
    };
    const planned: JournalWork = {
      ...TEST,
      planWorkId: uid(72),
      kind: 'homework',
      title: 'Read',
      total: 5,
    };
    const grid: JournalGrid = {
      ...GRID,
      lessons: [
        {
          ...(GRID.lessons[0] as JournalLesson),
          works: [TEST, given, planned],
          given: [
            { workId: null, planWorkId: uid(72), title: 'Read', notGiven: false },
            { workId: uid(81), planWorkId: null, title: null, notGiven: false },
          ],
        },
        GRID.lessons[1] as JournalLesson,
      ],
      students: GRID.students.map((one) => ({
        ...one,
        cells: [
          {
            ...(one.cells[0] as JournalStudent['cells'][number]),
            works: [EMPTY_SCORE, EMPTY_SCORE, EMPTY_SCORE],
          },
          one.cells[1] as JournalStudent['cells'][number],
        ],
      })),
    };
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
      [`GET /api/journal/journals/${JOURNAL}`]: () => json(grid),
      [`DELETE /api/journal/lessons/${PLANNED}/works/${uid(81)}`]: () =>
        new Response(null, { status: 204 }),
      [`PUT /api/journal/lessons/${PLANNED}/works/not-held`]: () =>
        json({ ...SAVED, kind: 'homework', notHeld: true }),
    });
    renderApp(`/journal/${JOURNAL}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Work: HW 1 · unplanned' }));
    const editor = await screen.findByRole('dialog');
    // One homework section, both homeworks in it.
    const homework = within(editor).getByRole('region', { name: en.journal.card.homeworks });
    expect(within(homework).getByText('Read')).toBeDefined();
    fireEvent.click(within(homework).getByRole('button', { name: deleteOf('HW 1') }));
    await waitFor(() => {
      expect(
        calls.some(
          (call) => call.route === `DELETE /api/journal/lessons/${PLANNED}/works/${uid(81)}`,
        ),
      ).toBe(true);
    });
    fireEvent.click(within(homework).getByRole('button', { name: deleteOf('Read') }));
    const question = await screen.findByRole('alertdialog');
    fireEvent.click(within(question).getByRole('button', { name: en.journal.editor.deleteAction }));
    await waitFor(() => {
      expect(sent(calls, `PUT /api/journal/lessons/${PLANNED}/works/not-held`)).toEqual([
        {
          column: { planWorkId: uid(72), sourceLessonId: PLANNED },
          notHeld: true,
          version: null,
          confirm: true,
        },
      ]);
    });
  });

  it('is read only at a lesson the person cannot enter: no field, no add, no delete', async () => {
    const grid: JournalGrid = {
      ...GRID,
      lessons: [
        { ...(GRID.lessons[0] as JournalLesson), canEnterWorks: false, topic: 'Fractions' },
        GRID.lessons[1] as JournalLesson,
      ],
    };
    fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
      [`GET /api/journal/journals/${JOURNAL}`]: () => json(grid),
    });
    renderApp(`/journal/${JOURNAL}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Work: Test' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Fractions')).not.toBeNull();
    expect(within(dialog).queryByLabelText(en.journal.card.topic)).toBeNull();
    expect(within(dialog).getByLabelText<HTMLInputElement>(totalOf('Test')).disabled).toBe(true);
    expect(within(dialog).queryByRole('button', { name: deleteOf('Test') })).toBeNull();
    expect(
      within(dialog).queryByRole('button', { name: en.journal.editor.addClasswork }),
    ).toBeNull();
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
        return json({
          cells: [{ studentId: uid(101), mark: 0, version: 2 }],
          cleared: [],
          presentEarlier: [],
        });
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

  // The owner, 20 November 2026: a "-" typed in a work's cell is "not graded".
  it('reads a "-" (or a dash a keyboard gives) as "not graded" in the cell of a work, and a number or empty as before', () => {
    for (const dash of ['-', ' - ', '–', '—', '−']) {
      expect(typedWorkEntry(dash, 30)).toBe('notGraded');
    }
    expect(typedWorkEntry('12', 30)).toBe(12);
    expect(typedWorkEntry('', 30)).toBeNull();
    // Task 11.25b: a refused entry gives its reason in place of `undefined`.
    expect(typedWorkEntry('--', 30)).toEqual({ reason: 'notNumber', min: 0, max: 30 });
    expect(typedWorkEntry('-1', 30)).toEqual({ reason: 'notNumber', min: 0, max: 30 });
  });

  // Task 11.25b; `07`, The total; `edge/journal`, "The teacher types "1" then "2" for 12.";
  // `14`, Rule tests ("scores and totals with one and two decimals (7.5 and 8.25) and a comma
  // refused").
  it('reads up to two digits after a point in the cell of a work, and refuses a comma, three decimals and letters', () => {
    expect(typedWorkEntry('7.5', 10)).toBe(7.5);
    expect(typedWorkEntry('8.25', 11)).toBe(8.25);
    expect(typedWorkEntry('8.', 10)).toBe(8);
    expect(typedWorkEntry(' 10 ', 10)).toBe(10);
    expect(typedWorkEntry('0.01', 10)).toBe(0.01);
    expect(typedWorkEntry('7,5', 10)).toEqual({ reason: 'comma', min: 0, max: 10 });
    expect(typedWorkEntry('7.555', 10)).toEqual({ reason: 'decimals', min: 0, max: 10 });
    expect(typedWorkEntry('abc', 10)).toEqual({ reason: 'notNumber', min: 0, max: 10 });
    expect(typedWorkEntry('1.2.3', 10)).toEqual({ reason: 'notNumber', min: 0, max: 10 });
    expect(typedWorkEntry('.5', 10)).toEqual({ reason: 'notNumber', min: 0, max: 10 });
    expect(typedWorkEntry('10.01', 10)).toEqual({ reason: 'range', min: 0, max: 10 });
    expect(typedWorkEntry('6', 7.5)).toBe(6);
  });

  it('folds the journal’s reminders under their title, with the count of each kind (task 8.7, 07: "A panel on the journal")', async () => {
    const reminder = {
      kind: 'no_attendance' as const,
      lesson: {
        id: NO_PLAN,
        journalId: JOURNAL,
        date: '2026-10-26',
        start: 480,
        unit: UNIT,
        subject: SUBJECT,
        status: 'in_progress' as const,
      },
      count: 2,
      locksAt: null,
    };
    fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
      [`GET /api/journal/journals/${JOURNAL}`]: () => json({ ...GRID, reminders: [reminder] }),
    });
    renderApp(`/journal/${JOURNAL}`);
    const panel = await waitFor(() => {
      const found = document.querySelector('details[data-reminders]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(panel?.querySelector('summary')?.textContent).toContain('Reminders (1)');
    expect(panel?.querySelector('[data-reminder-kinds]')?.textContent).toBe('No attendance: 1');
    expect(panel?.querySelector('[data-reminder="no_attendance"]')?.textContent).toContain(
      '2 students without attendance',
    );
  });
});
