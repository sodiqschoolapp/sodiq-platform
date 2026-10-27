import type { EditLock, JournalGrid, JournalStudent } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { OPEN_LOCK } from '@/testing/edit-lock';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const JOURNAL = uid(1);
const OPEN = uid(60);
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

/** 19 October, locked since 00:00 of the 27th for the reader. */
const LOCKED: EditLock = {
  ...OPEN_LOCK,
  locksAt: '2026-10-26T19:00:00.000Z',
  window: 'locked',
  canRequest: true,
};

const cell = (mark: number | null, marker: JournalStudent['cells'][number]['marker'] = null) => ({
  closed: false,
  open: false,
  exempt: null,
  mark,
  version: mark === null ? null : 1,
  typedBy: null,
  marker,
  works: [],
  score: null,
});

// All names are invented.
const student = (n: number, lastName: string, cells = [cell(null), cell(null)]) => ({
  id: uid(100 + n),
  number: n,
  firstName: 'Ali',
  lastName,
  paternalName: null,
  uid: `S-${String(n)}`,
  folded: false,
  exemptions: [],
  cells,
  quarter: null,
  months: null,
  comments: [],
  carriedIn: [],
  leftSubjectOn: null,
  atLeaving: null,
});

const lesson = (id: string, date: string, canEnter: boolean, lock: EditLock) => ({
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
  notDelivered: false,
  copyFrom: null,
  lock,
  notHeldWorks: [],
  given: [],
});

const gridOf = (old: EditLock, students = [student(1, 'Zokirov')]): JournalGrid => ({
  journal: {
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
  shape: 'whole',
  months: ['2026-10'],
  lessons: [lesson(OPEN, '2026-10-26', true, OPEN_LOCK), lesson(OLD, '2026-10-19', false, old)],
  students,
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

function open(grid: JournalGrid, role: 'teacher' | 'academic_vice_principal') {
  const calls = fakeApi({
    'GET /api/auth/session': () => json(sessionOf({ assignments: [{ role, branchId: NORTH.id }] })),
    [`GET /api/journal/journals/${JOURNAL}`]: () => json(grid),
    [`POST /api/journal/lessons/${OLD}/unlocks`]: () => json({}, 201),
    [`POST /api/journal/lessons/${OLD}/attendance`]: (body) => {
      const saves = (body as { saves: { studentId: string; mark: number | null }[] }).saves;
      return json({
        cells: saves.map((one) => ({ studentId: one.studentId, mark: one.mark, version: 2 })),
        cleared: [],
        presentEarlier: [],
      });
    },
  });
  renderApp(`/journal/${JOURNAL}`, 'en');
  return calls;
}

const posts = (calls: ReturnType<typeof fakeApi>, route: string) =>
  calls.filter((call) => call.route === route);

const cellOf = (id: string, colId: string) =>
  waitFor(() => {
    const found = document.querySelector<HTMLElement>(`[row-id="${id}"] [col-id="${colId}"]`);
    expect(found).not.toBeNull();
    return found as HTMLElement;
  });

/** Opens the locked lessons the panel folds (owner, 27 October 2026). */
const showLocked = (panel: HTMLElement) => {
  fireEvent.click(within(panel).getByRole('button', { name: /^Show \d+ locked lessons?$/ }));
};

// docs/spec/07-journal.md, Editing rules and locks; docs/spec/edge-cases/journal.md, Locks,
// unlocks and corrections (task 8.4).
describe('the edit period on the journal page', () => {
  it('lists the urgent locked lessons and folds every plain one behind one button, newest first', async () => {
    // Seven plain locked lessons (1 to 7 October) and one locked incomplete (8 October).
    const plain = [1, 2, 3, 4, 5, 6, 7].map((day) =>
      lesson(uid(200 + day), `2026-10-0${String(day)}`, false, LOCKED),
    );
    const incomplete = {
      ...lesson(uid(208), '2026-10-08', false, LOCKED),
      status: 'locked_incomplete' as const,
    };
    const base = gridOf(LOCKED);
    open({ ...base, lessons: [...plain, incomplete, ...base.lessons] }, 'teacher');
    const panel = await screen.findByRole('region', { name: en.journal.locks.title });
    const listed = () =>
      [...panel.querySelectorAll('[data-lock-row]')].map((row) =>
        row.getAttribute('data-lock-row'),
      );
    // Only the incomplete lesson is in view; the eight plain ones wait behind the button.
    expect(listed()).toEqual([uid(208)]);
    const more = within(panel).getByRole('button', {
      name: en.journal.locks.showLocked_other.replace('{{count}}', '8'),
    });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    // Opened: the incomplete lesson, then the plain ones newest first (19, 7, 6 ... 1 October).
    await waitFor(() => {
      expect(listed()).toEqual([
        uid(208),
        OLD,
        uid(207),
        uid(206),
        uid(205),
        uid(204),
        uid(203),
        uid(202),
        uid(201),
      ]);
    });
    fireEvent.click(within(panel).getByRole('button', { name: en.journal.locks.hideLocked }));
    await waitFor(() => {
      expect(listed()).toEqual([uid(208)]);
    });
  });

  it('keeps a locked lesson read-only and sends an unlock request with its reason', async () => {
    const calls = open(gridOf(LOCKED), 'teacher');
    const panel = await screen.findByRole('region', { name: en.journal.locks.title });
    showLocked(panel);
    const target = await cellOf(uid(101), `${OLD}:a`);
    fireEvent.click(target);
    fireEvent.keyDown(target, { key: '1' });
    fireEvent.click(within(panel).getByRole('button', { name: en.journal.locks.request }));
    const dialog = await screen.findByRole('form', { name: /^Request unlock:/ });
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.locks.send }));
    expect(await within(dialog).findByText(en.journal.locks.reasonNeeded)).toBeDefined();
    fireEvent.change(within(dialog).getByRole('textbox', { name: en.journal.locks.reason }), {
      target: { value: 'I was ill that week' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.locks.send }));
    await waitFor(() => {
      expect(posts(calls, `POST /api/journal/lessons/${OLD}/unlocks`)).toHaveLength(1);
    });
    expect(posts(calls, `POST /api/journal/lessons/${OLD}/unlocks`)[0]?.body).toEqual({
      reason: 'I was ill that week',
    });
    expect(posts(calls, `POST /api/journal/lessons/${OLD}/attendance`)).toHaveLength(0);
  });

  it('keeps a reason typed while the dialog is closed, and checks it with the shared schema (code review 1, finding 3)', async () => {
    const calls = open(gridOf(LOCKED), 'teacher');
    const panel = await screen.findByRole('region', { name: en.journal.locks.title });
    showLocked(panel);
    fireEvent.click(within(panel).getByRole('button', { name: en.journal.locks.request }));
    let dialog = await screen.findByRole('form', { name: /^Request unlock:/ });
    fireEvent.change(within(dialog).getByRole('textbox', { name: en.journal.locks.reason }), {
      target: { value: 'I was ill' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.locks.back }));
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: /^Request unlock:/ })).toBeNull();
    });
    fireEvent.click(within(panel).getByRole('button', { name: en.journal.locks.request }));
    dialog = await screen.findByRole('form', { name: /^Request unlock:/ });
    const field = within(dialog).getByRole('textbox', { name: en.journal.locks.reason });
    expect((field as HTMLTextAreaElement).value).toBe('I was ill');
    // Only spaces: the schema's trimmed reason is empty, and nothing is sent.
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.locks.send }));
    expect(await within(dialog).findByText(en.journal.locks.reasonNeeded)).toBeDefined();
    expect(posts(calls, `POST /api/journal/lessons/${OLD}/unlocks`)).toHaveLength(0);
  });

  it('lets the Academic Vice Principal correct a locked lesson: the reason once, then each save carries it', async () => {
    const calls = open(
      gridOf({ ...LOCKED, canRequest: false, canCorrect: true }),
      'academic_vice_principal',
    );
    const panel = await screen.findByRole('region', { name: en.journal.locks.title });
    showLocked(panel);
    fireEvent.click(within(panel).getByRole('button', { name: en.journal.locks.correct }));
    const dialog = await screen.findByRole('form', { name: /^Correct:/ });
    fireEvent.change(
      within(dialog).getByRole('textbox', { name: en.journal.locks.correctReason }),
      { target: { value: 'The register shows an absence' } },
    );
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.locks.startCorrecting }));
    await within(panel).findByRole('button', { name: en.journal.locks.stopCorrecting });
    const target = await cellOf(uid(101), `${OLD}:a`);
    fireEvent.click(target);
    fireEvent.keyDown(target, { key: '0' });
    await waitFor(() => {
      expect(posts(calls, `POST /api/journal/lessons/${OLD}/attendance`)).toHaveLength(1);
    });
    expect(posts(calls, `POST /api/journal/lessons/${OLD}/attendance`)[0]?.body).toEqual({
      saves: [{ studentId: uid(101), mark: 0, version: null }],
      correction: { reason: 'The register shows an absence' },
    });
  });

  it('marks a value entered after the edit period and a corrected one, with the names', async () => {
    open(
      gridOf(
        {
          ...LOCKED,
          window: 'unlocked',
          unlockedUntil: '2026-10-29T19:00:00.000Z',
          unlockedBy: 'Aminova Feruza',
          canRequest: false,
        },
        [
          student(1, 'Zokirov', [cell(null), cell(1, { kind: 'late', by: 'Aminova Feruza' })]),
          student(2, 'Abdullayev', [
            cell(null),
            cell(0, { kind: 'correction', by: 'Ismoilova Shahlo' }),
          ]),
        ],
      ),
      'teacher',
    );
    const late = await waitFor(() => {
      const found = document.querySelector('[row-id] [data-marker="late"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(late.getAttribute('aria-label')).toBe(
      'Entered after the edit period, approved by Aminova Feruza',
    );
    expect(document.querySelector('[data-marker="correction"]')?.getAttribute('aria-label')).toBe(
      'Corrected by Ismoilova Shahlo',
    );
  });
});
