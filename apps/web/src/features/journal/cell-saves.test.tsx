import {
  APP_VERSION,
  type JournalGrid,
  type JournalStudent,
  type JournalWork,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reloadPage } from '@/app/outdated-alert';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const JOURNAL = uid(1);
const FIRST = uid(60);
const SECOND = uid(61);
const WORK = uid(70);
const SUBJECT = {
  id: uid(10),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  colour: 'blue' as const,
};
const UNIT = { kind: 'class' as const, id: uid(20), name: '7 Oxford' };
const QUARTER = { id: uid(30), number: 1, startDate: '2026-09-01', endDate: '2026-10-31' };

const TEST: JournalWork = {
  id: WORK,
  planWorkId: null,
  sourceLessonId: SECOND,
  kind: 'classwork',
  position: 1,
  title: 'Test',
  unplanned: false,
  total: 10,
  notHeld: false,
  carriedFrom: null,
  version: 1,
};

// All names are invented.
const student = (n: number, lastName: string, mark: number | null): JournalStudent => ({
  id: uid(100 + n),
  number: n,
  firstName: 'Ali',
  lastName,
  paternalName: null,
  uid: `S-${String(n)}`,
  folded: false,
  cells: [
    { closed: false, mark: null, version: null, typedBy: null, works: [], score: null },
    {
      closed: false,
      mark,
      version: mark === null ? null : 1,
      typedBy: null,
      works: [{ score: null, percent: null, version: null, onAbsent: false }],
      score: null,
    },
  ],
  quarter: null,
  months: null,
  comments: [],
});

/** A double on 26 October: the second lesson copies attendance from the first and has a classwork. */
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
  shape: 'lessons',
  months: ['2026-10'],
  lessons: [FIRST, SECOND].map((id, index) => ({
    id,
    date: '2026-10-26',
    start: index === 0 ? 480 : 535,
    end: index === 0 ? 525 : 580,
    slot: index + 1,
    held: true,
    cancelled: null,
    month: '2026-10',
    canEnter: true,
    canEnterWorks: index === 1,
    planItem: true,
    copyFrom: index === 1 ? FIRST : null,
    works: index === 1 ? [TEST] : [],
    notHeldWorks: [],
    given: [],
  })),
  students: [student(1, 'Zokirov', null), student(2, 'Abdullayev', 2)],
  lastTotal: 10,
  absences: [],
  bottom: null,
  legend: { lateValue: 50, skippedValue: 0, daily: null, quarterly: null, weightsChangedOn: null },
};

/** The headers of every call, beside the calls `fakeApi` records. */
function withHeaders(): { route: string; headers: Headers }[] {
  const seen: { route: string; headers: Headers }[] = [];
  const inner = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((input, init) => {
      if (input instanceof Request) {
        seen.push({
          route: `${input.method} ${new URL(input.url).pathname}`,
          headers: new Headers(input.headers),
        });
      }
      return inner(input, init);
    }),
  );
  return seen;
}

type Handler = (body: unknown) => Response | Promise<Response>;

function open(handlers: Record<string, Handler> = {}) {
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(sessionOf({ language: 'en', assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
    [`GET /api/journal/journals/${JOURNAL}`]: () => json(GRID),
    [`POST /api/journal/lessons/${FIRST}/attendance`]: (body) => {
      const saves = (body as { saves: { studentId: string; mark: number | null }[] }).saves;
      return json({
        cells: saves.map((one) => ({ studentId: one.studentId, mark: one.mark, version: 1 })),
        cleared: [],
        presentEarlier: [],
      });
    },
    ...handlers,
  });
  const headers = withHeaders();
  renderApp(`/journal/${JOURNAL}`, 'en');
  return { calls, headers };
}

const cellOf = (studentId: string, colId: string) =>
  document.querySelector<HTMLElement>(`[row-id="${studentId}"] [col-id="${colId}"]`);

async function typeMark(studentId: string, lessonId: string, key: string) {
  const target = await waitFor(() => {
    const found = cellOf(studentId, `${lessonId}:a`);
    expect(found).not.toBeNull();
    return found as HTMLElement;
  });
  fireEvent.click(target);
  fireEvent.keyDown(target, { key });
}

const keysOf = (headers: { route: string; headers: Headers }[], route: string) =>
  headers.filter((one) => one.route === route).map((one) => one.headers.get('Idempotency-Key'));

const bodies = (calls: ReturnType<typeof fakeApi>, route: string) =>
  calls.filter((call) => call.route === route).map((call) => call.body);

const ATTENDANCE = `POST /api/journal/lessons/${FIRST}/attendance`;

afterEach(() => {
  vi.restoreAllMocks();
});

// Task 8.3a: docs/spec/07-journal.md, Entering data, "Saving": "Every cell saves by itself and
// shows a saved sign"; docs/spec/12-ux-standards.md, No lost work and "Save a journal cell:
// shown at once"; docs/spec/edge-cases/journal.md, Saving and working together.
describe('saving journal cells', () => {
  it('shows the typed mark at once with a saving sign, then the saved sign', async () => {
    let answer: (response: Response) => void = () => undefined;
    open({
      [ATTENDANCE]: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    await typeMark(uid(101), FIRST, '0');
    await waitFor(() => {
      expect(cellOf(uid(101), `${FIRST}:a`)?.querySelector('[data-mark="0"]')).not.toBeNull();
    });
    expect(cellOf(uid(101), `${FIRST}:a`)?.querySelector('[data-save-state="saving"]')).not.toBe(
      null,
    );
    answer(
      json({
        cells: [{ studentId: uid(101), mark: 0, version: 1 }],
        cleared: [],
        presentEarlier: [],
      }),
    );
    await waitFor(() => {
      expect(cellOf(uid(101), `${FIRST}:a`)?.querySelector('[data-save-state="saved"]')).not.toBe(
        null,
      );
    });
  });

  it('takes the typed mark back after a refusal and says why', async () => {
    open({ [ATTENDANCE]: () => refusal('cell_closed', 409) });
    await typeMark(uid(101), FIRST, '1');
    await screen.findByText(en.errors.cell_closed);
    await waitFor(() => {
      expect(cellOf(uid(101), `${FIRST}:a`)?.querySelector('[data-mark]')).toBeNull();
    });
  });

  it('sends every call with the application version and each typed entry with a key of its own', async () => {
    const { headers } = open();
    await typeMark(uid(101), FIRST, '1');
    await waitFor(() => {
      expect(cellOf(uid(101), `${FIRST}:a`)?.querySelector('[data-save-state="saved"]')).not.toBe(
        null,
      );
    });
    await typeMark(uid(102), FIRST, '2');
    await waitFor(() => {
      expect(keysOf(headers, ATTENDANCE)).toHaveLength(2);
    });
    const [one, two] = keysOf(headers, ATTENDANCE);
    expect(one).toMatch(/^[0-9a-f-]{36}$/);
    expect(two).not.toBe(one);
    expect(headers.length).toBeGreaterThan(2);
    for (const call of headers) {
      expect(call.headers.get('X-App-Version'), call.route).toBe(String(APP_VERSION));
    }
  });

  describe('a stale save (both values)', () => {
    const STORED = {
      value: 2,
      version: 3,
      changedBy: uid(90),
      changedByLogin: 'aziza.k',
      changedByName: 'Karimova Aziza',
      changedAt: '2026-10-27T03:05:00.000Z',
    };
    const stale = () =>
      json(
        {
          error: {
            code: 'cell_stale',
            message: 'ENGLISH TEXT FOR THE DEVELOPER',
            requestId: 'test-request',
            details: [{ path: 'saves.0', code: 'cell_stale', message: 'x', storedCell: STORED }],
          },
        },
        409,
      );

    it('shows the stored value with who and the typed one, and "Use mine" sends it again on the stored version with a new key', async () => {
      let first = true;
      const { calls, headers } = open({
        [ATTENDANCE]: (body) => {
          if (first) {
            first = false;
            return stale();
          }
          const saves = (body as { saves: { studentId: string; mark: number }[] }).saves;
          return json({
            cells: saves.map((one) => ({ ...one, version: 4 })),
            cleared: [],
            presentEarlier: [],
          });
        },
      });
      await typeMark(uid(101), FIRST, '0');
      const dialog = await screen.findByRole('dialog', { name: en.journal.saving.staleTitle });
      expect(dialog.querySelector('[data-stale-stored]')?.textContent).toContain('2 (Late)');
      expect(dialog.querySelector('[data-stale-stored]')?.textContent).toContain('Karimova Aziza');
      expect(dialog.querySelector('[data-stale-mine]')?.textContent).toContain(
        '0 (Absent from school)',
      );
      fireEvent.click(within(dialog).getByRole('button', { name: en.journal.saving.useMine }));
      await waitFor(() => {
        expect(bodies(calls, ATTENDANCE)).toHaveLength(2);
      });
      expect(bodies(calls, ATTENDANCE)[1]).toEqual({
        saves: [{ studentId: uid(101), mark: 0, version: 3 }],
      });
      const [one, two] = keysOf(headers, ATTENDANCE);
      expect(two).not.toBe(one);
    });

    it('"Keep the saved value" sends nothing more', async () => {
      const { calls } = open({ [ATTENDANCE]: stale });
      await typeMark(uid(101), FIRST, '0');
      const dialog = await screen.findByRole('dialog', { name: en.journal.saving.staleTitle });
      fireEvent.click(within(dialog).getByRole('button', { name: en.journal.saving.keepStored }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(bodies(calls, ATTENDANCE)).toHaveLength(1);
    });
  });

  describe('a save with no answer', () => {
    it('keeps the typed mark "not saved", names it in the top bar, and sends it again with the same key', async () => {
      let answered = false;
      const { calls, headers } = open({
        [ATTENDANCE]: () => {
          if (!answered) {
            answered = true;
            throw new TypeError('Failed to fetch');
          }
          return json({
            cells: [{ studentId: uid(101), mark: 3, version: 1 }],
            cleared: [],
            presentEarlier: [],
          });
        },
      });
      await typeMark(uid(101), FIRST, '3');
      await waitFor(() => {
        expect(
          cellOf(uid(101), `${FIRST}:a`)?.querySelector('[data-save-state="failed"]'),
        ).not.toBe(null);
      });
      expect(cellOf(uid(101), `${FIRST}:a`)?.querySelector('[data-mark="3"]')).not.toBeNull();
      // The top bar names it (12: No lost work), and leaving asks first.
      expect(screen.getByRole('button', { name: en.unsent.failed })).toBeTruthy();
      const notice = document.querySelector<HTMLElement>('[data-unsent-cells]');
      expect(notice?.textContent).toContain(
        en.journal.saving.notSavedCount_one.replace('{{count}}', '1'),
      );
      fireEvent.click(
        within(notice as HTMLElement).getByRole('button', { name: en.journal.saving.retry }),
      );
      await waitFor(() => {
        expect(bodies(calls, ATTENDANCE)).toHaveLength(2);
      });
      const [one, two] = keysOf(headers, ATTENDANCE);
      expect(two).toBe(one);
      await waitFor(() => {
        expect(document.querySelector('[data-unsent-cells]')).toBeNull();
      });
    });

    it('asks before the page is left while an entry is not saved (07: "the page warns before closing with unsent entries")', async () => {
      open({
        [ATTENDANCE]: () => {
          throw new TypeError('Failed to fetch');
        },
      });
      await typeMark(uid(101), FIRST, '1');
      await waitFor(() => {
        expect(document.querySelector('[data-unsent-cells]')).not.toBeNull();
      });
      fireEvent.click(screen.getAllByRole('link', { name: en.menu.home })[0] as Element);
      await screen.findByRole('alertdialog', { name: en.unsent.leaveTitle });
    });
  });

  describe('undo', () => {
    it('sends the cells of the last action and reports what was undone; Ctrl+Z does the same', async () => {
      const { calls } = open({
        [`POST /api/journal/lessons/${FIRST}/undo`]: () =>
          json({ undone: [{ studentId: uid(101), workId: null, version: 2 }], skipped: [] }),
        [`POST /api/journal/lessons/${FIRST}/all-present`]: () =>
          json({
            filled: [
              { studentId: uid(101), version: 1 },
              { studentId: uid(102), version: 5 },
            ],
            skipped: [],
          }),
      });
      const button = await screen.findByRole('button', { name: en.journal.saving.undo });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      await typeMark(uid(101), FIRST, '1');
      await waitFor(() => {
        expect((button as HTMLButtonElement).disabled).toBe(false);
      });
      fireEvent.click(button);
      await waitFor(() => {
        expect(bodies(calls, `POST /api/journal/lessons/${FIRST}/undo`)).toEqual([
          { students: [{ studentId: uid(101), cells: [{ workId: null, version: 1 }] }] },
        ]);
      });
      const notice = await waitFor(() => {
        const found = document.querySelector('[data-undo-notice]');
        expect(found?.textContent).toContain('1 cell undone.');
        return found;
      });
      expect(notice).not.toBeNull();
      // Used once: the page has no last action until the next one.
      expect((button as HTMLButtonElement).disabled).toBe(true);
      // "All present" is one action: one undo of all its cells, by Ctrl+Z.
      fireEvent.click(
        screen.getAllByRole('button', { name: en.journal.entry.allPresent })[0] as Element,
      );
      await waitFor(() => {
        expect((button as HTMLButtonElement).disabled).toBe(false);
      });
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      await waitFor(() => {
        expect(bodies(calls, `POST /api/journal/lessons/${FIRST}/undo`)[1]).toEqual({
          students: [
            { studentId: uid(101), cells: [{ workId: null, version: 1 }] },
            { studentId: uid(102), cells: [{ workId: null, version: 5 }] },
          ],
        });
      });
    });
  });

  it('copies attendance into the second lesson of a double and reports what it filled and skipped', async () => {
    const { calls } = open({
      [`POST /api/journal/lessons/${SECOND}/copy-attendance`]: () =>
        json({
          filled: [{ studentId: uid(101), version: 1 }],
          skipped: [{ studentId: uid(102), mark: 2 }],
        }),
    });
    const copy = await screen.findByRole('button', { name: en.journal.saving.copy });
    // Only the second lesson has it.
    expect(screen.getAllByRole('button', { name: en.journal.saving.copy })).toHaveLength(1);
    fireEvent.click(copy);
    const notice = await waitFor(() => {
      const found = document.querySelector('[data-copy-attendance]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(notice?.textContent).toContain('1 mark copied from the first lesson.');
    expect(bodies(calls, `POST /api/journal/lessons/${SECOND}/copy-attendance`)).toHaveLength(1);
  });

  describe('an outdated page', () => {
    it('asks to reload after a write refused app_outdated, and asks first while an entry is not saved', async () => {
      const reload = vi.spyOn(reloadPage, 'run').mockImplementation(() => undefined);
      let calls = 0;
      open({
        [ATTENDANCE]: () => {
          calls += 1;
          if (calls === 1) throw new TypeError('Failed to fetch');
          return refusal('app_outdated', 409);
        },
      });
      await typeMark(uid(101), FIRST, '1');
      await waitFor(() => {
        expect(document.querySelector('[data-unsent-cells]')).not.toBeNull();
      });
      await typeMark(uid(102), FIRST, '0');
      const alert = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-outdated]');
        expect(calls).toBe(2);
        expect(found).not.toBeNull();
        return found as HTMLElement;
      });
      expect(alert.textContent).toContain(en.unsent.outdated);
      fireEvent.click(within(alert).getByRole('button', { name: en.unsent.reload }));
      const ask = await screen.findByRole('alertdialog', { name: en.unsent.leaveTitle });
      expect(reload).not.toHaveBeenCalled();
      fireEvent.click(within(ask).getByRole('button', { name: en.unsent.leave }));
      await waitFor(() => {
        expect(reload).toHaveBeenCalledTimes(1);
      });
    });
  });
});
