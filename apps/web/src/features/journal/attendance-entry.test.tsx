import type { CellHistory, JournalGrid, JournalStudent } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';
import { OPEN_LOCK } from '@/testing/edit-lock';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const JOURNAL = uid(1);
const LESSON = uid(60);
const OLD = uid(61);
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

const cell = (mark: number | null, version: number | null = mark === null ? null : 1) => ({
  closed: false,
  open: false,
  exempt: null,
  mark,
  version,
  typedBy: mark === null ? null : 'Karimova Aziza',
  marker: null,
  works: [],
  score: null,
});

// All names are invented.
const student = (n: number, lastName: string, rest: Partial<JournalStudent> = {}) => ({
  id: uid(100 + n),
  number: n,
  firstName: 'Ali',
  lastName,
  paternalName: null,
  uid: `S-${String(n)}`,
  photoId: null,
  folded: false,
  exemptions: [],
  cells: [cell(null), cell(0)],
  quarter: null,
  months: null,
  comments: [],
  carriedIn: [],
  leftSubjectOn: null,
  atLeaving: null,
  ...rest,
});

const lesson = (id: string, date: string, canEnter: boolean) => ({
  id,
  date,
  start: 480,
  end: 525,
  slot: 1,
  held: true,
  status: null,
  cancelled: null,
  month: '2026-10',
  canEnter,
  works: [],
  canEnterWorks: false,
  planItem: true,
  number: null,
  topic: null,
  topicCode: null,
  notDelivered: false,
  addedInJournal: [],
  copyFrom: null,
  lock: OPEN_LOCK,
  notHeldWorks: [],
  given: [],
});

/** An attendance-only journal (a Ma'naviyat soati of a class): today's lesson entered, an older one read. */
const GRID: JournalGrid = {
  journal: {
    codesOn: false,
    id: JOURNAL,
    unit: UNIT,
    subject: SUBJECT,
    year: { id: uid(40), startDate: '2026-09-01', endDate: '2027-05-31', closed: false },
    attendanceOnly: true,
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
  lessons: [lesson(LESSON, '2026-10-27', true), lesson(OLD, '2026-10-20', false)],
  students: [student(1, 'Zokirov'), student(2, 'Abdullayev', { cells: [cell(2), cell(0)] })],
  absences: [{ studentId: uid(101), date: '2026-10-20', category: 'illness' }],
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
};

const HISTORY: CellHistory = {
  lines: [
    {
      work: null,
      version: 1,
      before: null,
      after: 2,
      changedBy: { accountId: uid(90), login: 'aziza.k', name: 'Karimova Aziza' },
      changedHow: 'entry',
      changedAt: '2026-10-27T03:05:00.000Z',
      // Task 10.10: entered through a department platform's key.
      viaKey: { name: 'Mathematics platform' },
    },
  ],
  workLines: [],
};

function open(path = `/journal/${JOURNAL}`, language: 'en' | 'ru' = 'en', grid = GRID) {
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(sessionOf({ language, assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
    [`GET /api/journal/journals/${JOURNAL}`]: () => json(grid),
    [`POST /api/journal/lessons/${LESSON}/attendance`]: (body) => {
      const saves = (body as { saves: { studentId: string; mark: number | null }[] }).saves;
      return json({
        cells: saves.map((one) => ({ studentId: one.studentId, mark: one.mark, version: 1 })),
        cleared: [],
        presentEarlier: saves.filter((one) => one.mark === 0).map((one) => one.studentId),
      });
    },
    [`POST /api/journal/lessons/${LESSON}/all-present`]: () =>
      json({
        filled: [{ studentId: uid(101), version: 1 }],
        skipped: [{ studentId: uid(102), mark: 2 }],
      }),
    [`GET /api/journal/lessons/${LESSON}/students/${uid(102)}/history`]: () => json(HISTORY),
  });
  renderApp(path, language);
  return calls;
}

const cellOf = (id: string, colId: string) =>
  document.querySelector<HTMLElement>(`[row-id="${id}"] [col-id="${colId}"]`);

const posts = (calls: ReturnType<typeof fakeApi>, route: string) =>
  calls.filter((call) => call.route === route);

// docs/spec/07-journal.md, Entering data, Lesson mode; docs/spec/edge-cases/journal.md,
// Entering; task 6.3.
describe('attendance entry in the grid', () => {
  it('types a digit into an A cell of a lesson the reader enters, with the version read', async () => {
    const calls = open();
    const target = await waitFor(() => {
      const found = cellOf(uid(102), `${LESSON}:a`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.click(target);
    fireEvent.keyDown(target, { key: '0' });
    await waitFor(() => {
      expect(posts(calls, `POST /api/journal/lessons/${LESSON}/attendance`)).toHaveLength(1);
    });
    expect(posts(calls, `POST /api/journal/lessons/${LESSON}/attendance`)[0]?.body).toEqual({
      saves: [{ studentId: uid(102), mark: 0, version: 1 }],
    });
    // The server's hint: at school earlier today (edge/journal).
    const hint = await waitFor(() => {
      const found = document.querySelector('[data-present-earlier]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(hint?.textContent).toContain('Abdullayev Ali');
  });

  it('moves down to the next student after a digit (edge/journal: "An attendance digit saves at once and moves down")', async () => {
    open();
    const target = await waitFor(() => {
      const found = cellOf(uid(101), `${LESSON}:a`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.click(target);
    fireEvent.keyDown(target, { key: '1' });
    await waitFor(() => {
      expect(document.activeElement?.closest('[row-id]')?.getAttribute('row-id')).toBe(uid(102));
    });
    expect(document.activeElement?.closest('[col-id]')?.getAttribute('col-id')).toBe(`${LESSON}:a`);
  });

  it('names "all present" and the saved cell in Russian', async () => {
    const calls = open(`/journal/${JOURNAL}`, 'ru');
    fireEvent.click(await screen.findByRole('button', { name: ru.journal.entry.allPresent }));
    const notice = await waitFor(() => {
      const found = document.querySelector('[data-all-present]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(notice?.textContent).toContain('Отмечен присутствующим 1 ученик.');
    expect(posts(calls, `POST /api/journal/lessons/${LESSON}/all-present`)).toHaveLength(1);
  });

  it('types nothing but 0 to 3, and nothing into a lesson the reader does not enter', async () => {
    const calls = open();
    const target = await waitFor(() => {
      const found = cellOf(uid(101), `${LESSON}:a`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.click(target);
    fireEvent.keyDown(target, { key: '4' });
    fireEvent.keyDown(target, { key: '5' });
    fireEvent.keyDown(target, { key: 'a' });
    const old = cellOf(uid(101), `${OLD}:a`) as HTMLElement;
    fireEvent.click(old);
    fireEvent.keyDown(old, { key: '1' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts(calls, `POST /api/journal/lessons/${LESSON}/attendance`)).toEqual([]);
    expect(calls.some((call) => call.route.includes(`${OLD}/attendance`))).toBe(false);
  });

  it('presses "all present" once and says how many were filled and skipped', async () => {
    const calls = open();
    const button = await screen.findByRole('button', { name: en.journal.entry.allPresent });
    fireEvent.click(button);
    const notice = await waitFor(() => {
      const found = document.querySelector('[data-all-present]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(notice?.textContent).toContain('1 student marked present.');
    expect(notice?.textContent).toContain('1 already marked, left as typed.');
    expect(posts(calls, `POST /api/journal/lessons/${LESSON}/all-present`)).toHaveLength(1);
    // Only the lesson the reader enters has the button.
    expect(screen.getAllByRole('button', { name: en.journal.entry.allPresent })).toHaveLength(1);
  });

  it('marks a 0 that has a reason with its category, never its note', async () => {
    open();
    const mark = await waitFor(() => {
      const found = cellOf(uid(101), `${OLD}:a`)?.querySelector('[data-reason]');
      expect(found).toBeTruthy();
      return found;
    });
    expect(mark?.getAttribute('aria-label')).toBe('Reason: Illness');
  });

  it('opens the history of a cell with H', async () => {
    open();
    const target = await waitFor(() => {
      const found = cellOf(uid(102), `${LESSON}:a`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.click(target);
    fireEvent.keyDown(target, { key: 'h' });
    const dialog = await screen.findByRole('dialog');
    const table = await within(dialog).findByRole('table');
    expect(within(table).getAllByRole('row')[1]?.textContent).toContain(
      'Karimova Aziza via Mathematics platform',
    );
    expect(within(table).getAllByRole('row')[1]?.textContent).toContain('2 (Late)');
  });

  it('shows a refused save as the server says it', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ language: 'en', assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
      [`GET /api/journal/journals/${JOURNAL}`]: () => json(GRID),
      [`POST /api/journal/lessons/${LESSON}/attendance`]: () => refusal('cell_closed', 409),
    });
    renderApp(`/journal/${JOURNAL}`, 'en');
    const target = await waitFor(() => {
      const found = cellOf(uid(101), `${LESSON}:a`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.click(target);
    fireEvent.keyDown(target, { key: '1' });
    await screen.findByText(en.errors.cell_closed);
    expect(posts(calls, `POST /api/journal/lessons/${LESSON}/attendance`)).toHaveLength(1);
  });
});

describe('attendance entry in lesson mode', () => {
  it('gives each student the four marks as large buttons and "All present" (07, Lesson mode)', async () => {
    const calls = open(`/journal/${JOURNAL}?mode=lesson&date=2026-10-27`, 'ru');
    const row = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(`[data-student="${uid(101)}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    const buttons = within(row).getAllByRole('button');
    expect(buttons.map((one) => one.textContent)).toEqual(['1', '0', '2', '3']);
    fireEvent.click(within(row).getByRole('button', { name: `2: ${ru.journal.marks.late}` }));
    await waitFor(() => {
      expect(posts(calls, `POST /api/journal/lessons/${LESSON}/attendance`)[0]?.body).toEqual({
        saves: [{ studentId: uid(101), mark: 2, version: null }],
      });
    });
    expect(screen.getByRole('button', { name: ru.journal.entry.allPresent })).not.toBeNull();
  });

  it('draws no buttons for a lesson the reader does not enter', async () => {
    open(`/journal/${JOURNAL}?mode=lesson&date=2026-10-20`);
    const row = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(`[data-student="${uid(101)}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(within(row).queryAllByRole('button')).toEqual([]);
    expect(screen.queryByRole('button', { name: en.journal.entry.allPresent })).toBeNull();
  });
});

// Owner, 20 November 2026: on a phone, marks tapped one after another were lost while the first
// was saved, as every button waited for it.
describe('attendance entry in lesson mode while a mark is saved', () => {
  it("keeps the other students' buttons free and only the saved student's waiting", async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
      [`GET /api/journal/journals/${JOURNAL}`]: () => json(GRID),
      // The first save never answers: it stays on its way.
      [`POST /api/journal/lessons/${LESSON}/attendance`]: () => new Promise<Response>(() => {}),
    });
    renderApp(`/journal/${JOURNAL}?mode=lesson&date=2026-10-27`);
    const rowOf = (id: string) =>
      waitFor(() => {
        const found = document.querySelector<HTMLElement>(`[data-student="${id}"]`);
        expect(found).not.toBeNull();
        return found as HTMLElement;
      });
    const first = await rowOf(uid(101));
    fireEvent.click(within(first).getByRole('button', { name: `0: ${en.journal.marks.absent}` }));
    await waitFor(() => {
      expect(
        within(first)
          .getAllByRole('button')
          .every((one) => (one as HTMLButtonElement).disabled),
      ).toBe(true);
    });
    const second = await rowOf(uid(102));
    expect(
      within(second)
        .getAllByRole('button')
        .every((one) => !(one as HTMLButtonElement).disabled),
    ).toBe(true);
    // The second student's mark goes at once, on that student's own version.
    fireEvent.click(within(second).getByRole('button', { name: `1: ${en.journal.marks.present}` }));
    await waitFor(() => {
      expect(
        posts(calls, `POST /api/journal/lessons/${LESSON}/attendance`).map((one) => one.body),
      ).toEqual([
        { saves: [{ studentId: uid(101), mark: 0, version: null }] },
        { saves: [{ studentId: uid(102), mark: 1, version: 1 }] },
      ]);
    });
  });

  it('keeps a student waiting until the journal is read again after the save', async () => {
    let reads = 0;
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
      // The first read answers; the read after the save stays on its way.
      [`GET /api/journal/journals/${JOURNAL}`]: () => {
        reads += 1;
        return reads === 1 ? json(GRID) : new Promise<Response>(() => {});
      },
      [`POST /api/journal/lessons/${LESSON}/attendance`]: () =>
        json({
          cells: [{ studentId: uid(101), mark: 0, version: 1 }],
          cleared: [],
          presentEarlier: [],
        }),
    });
    renderApp(`/journal/${JOURNAL}?mode=lesson&date=2026-10-27`);
    const first = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(`[data-student="${uid(101)}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.click(within(first).getByRole('button', { name: `0: ${en.journal.marks.absent}` }));
    await waitFor(() => {
      expect(reads).toBe(2);
    });
    // Saved, but the page still holds the old version: a second tap would be refused as stale.
    expect(
      within(first)
        .getAllByRole('button')
        .every((one) => (one as HTMLButtonElement).disabled),
    ).toBe(true);
    expect(posts(calls, `POST /api/journal/lessons/${LESSON}/attendance`)).toHaveLength(1);
  });

  it('asks "keep or clear" for each student in turn when two marks are refused together', async () => {
    const asked = (body: unknown) =>
      (body as { saves: { numbers?: string }[] }).saves[0]?.numbers === undefined;
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
      [`GET /api/journal/journals/${JOURNAL}`]: () => json(GRID),
      [`POST /api/journal/lessons/${LESSON}/attendance`]: (body) => {
        const save = (body as { saves: { studentId: string; numbers?: string }[] }).saves[0];
        return asked(body)
          ? refusal('numbers_keep_or_clear', 409)
          : json({
              cells: [{ studentId: save?.studentId ?? '', mark: 0, version: 2 }],
              cleared: [],
              presentEarlier: [],
            });
      },
    });
    renderApp(`/journal/${JOURNAL}?mode=lesson&date=2026-10-27`);
    const row = (id: string) =>
      waitFor(() => {
        const found = document.querySelector<HTMLElement>(`[data-student="${id}"]`);
        expect(found).not.toBeNull();
        return found as HTMLElement;
      });
    // Both tapped one after the other, before either answer arrives.
    const absent = `0: ${en.journal.marks.absent}`;
    const first = within(await row(uid(101))).getByRole('button', { name: absent });
    const second = within(await row(uid(102))).getByRole('button', { name: absent });
    fireEvent.click(first);
    fireEvent.click(second);
    const keepText = (name: string) => en.journal.works.keepText.replace('{{names}}', name);
    // The first question stands until it is answered; the second waits behind it.
    expect(await screen.findByText(keepText('Zokirov Ali'))).not.toBeNull();
    await waitFor(() => {
      expect(posts(calls, `POST /api/journal/lessons/${LESSON}/attendance`)).toHaveLength(2);
    });
    expect(screen.queryByText(keepText('Abdullayev Ali'))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.journal.works.clear }));
    expect(await screen.findByText(keepText('Abdullayev Ali'))).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.journal.works.keep }));
    await waitFor(() => {
      const sent = posts(calls, `POST /api/journal/lessons/${LESSON}/attendance`)
        .map((one) => one.body as { saves: { studentId: string; numbers?: string }[] })
        .filter((one) => one.saves[0]?.numbers !== undefined)
        .map((one) => [one.saves[0]?.studentId, one.saves[0]?.numbers]);
      expect(sent).toEqual([
        [uid(101), 'clear'],
        [uid(102), 'keep'],
      ]);
    });
  });

  it('makes every button wait while "All present" is on its way', async () => {
    fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
      [`GET /api/journal/journals/${JOURNAL}`]: () => json(GRID),
      [`POST /api/journal/lessons/${LESSON}/all-present`]: () => new Promise<Response>(() => {}),
    });
    renderApp(`/journal/${JOURNAL}?mode=lesson&date=2026-10-27`);
    fireEvent.click(await screen.findByRole('button', { name: en.journal.entry.allPresent }));
    await waitFor(() => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-student] button')];
      expect(buttons.length).toBe(8);
      expect(buttons.every((one) => one.disabled)).toBe(true);
    });
  });
});
