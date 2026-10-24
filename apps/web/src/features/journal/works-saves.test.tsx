import type { JournalGrid, JournalStudent, JournalWork } from '@sodiq/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/confirm-dialog';
import { createI18n } from '@/i18n/i18n';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, refusal } from '@/testing/render-app';
import { journalKey } from './journal-api';
import { useWorksEntry, type WorksEntry } from './works-entry';
import { OPEN_LOCK } from '@/testing/edit-lock';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const LESSON = uid(60);
const WORK = uid(70);
const ZOKIROV = uid(101);
const SCORES = `POST /api/journal/lessons/${LESSON}/scores`;

const TEST: JournalWork = {
  id: WORK,
  planWorkId: null,
  sourceLessonId: LESSON,
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
const STUDENT: JournalStudent = {
  id: ZOKIROV,
  number: 1,
  firstName: 'Ali',
  lastName: 'Zokirov',
  paternalName: null,
  uid: 'S-1',
  folded: false,
  exemptions: [],
  cells: [
    {
      closed: false,
      exempt: null,
      mark: 1,
      version: 1,
      typedBy: null,
      marker: null,
      works: [{ score: 2, percent: 20, version: 1, onAbsent: false, marker: null }],
      score: null,
    },
  ],
  quarter: null,
  months: null,
  comments: [],
  carriedIn: [],
  leftSubjectOn: null,
  atLeaving: null,
};

const LESSON_ROW = {
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
  lock: OPEN_LOCK,
  works: [TEST],
  notHeldWorks: [],
  given: [],
};

const GRID = {
  lessons: [LESSON_ROW],
  students: [STUDENT],
} as unknown as JournalGrid;

/** The grid's query of the test: the same key family the hook writes the typed value into. */
const GRID_KEY = [...journalKey(null), 'grid', 'test'];

const scoreOf = (client: QueryClient) =>
  client.getQueryData<JournalGrid>(GRID_KEY)?.students[0]?.cells[0]?.works[0]?.score;

/** The hook of the numbers with its dialogs and notices, as the journal page draws them. */
function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(GRID_KEY, GRID);
  // No refetch in this test: the typed value stays what the hook wrote.
  client.setQueryDefaults(GRID_KEY, { staleTime: Infinity, enabled: false });
  let works: WorksEntry | null = null;
  function Probe() {
    const entry = useWorksEntry(GRID);
    works = entry.works;
    return entry.dialogs;
  }
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <QueryClientProvider client={client}>
        <ConfirmProvider>
          <Probe />
        </ConfirmProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  const type = (value: number) => {
    act(() => {
      works?.score(LESSON_ROW, TEST, STUDENT, value);
    });
  };
  const state = () => works?.stateOf(LESSON, ZOKIROV, TEST);
  return { client, type, state };
}

/** Records the request key of every call as well. */
function keysOf(): string[] {
  const keys: string[] = [];
  const inner = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((input, init) => {
      if (input instanceof Request) keys.push(input.headers.get('Idempotency-Key') ?? '');
      return inner(input, init);
    }),
  );
  return keys;
}

afterEach(() => {
  vi.restoreAllMocks();
});

const answer = (score: number, version: number) =>
  json({
    cells: [{ studentId: ZOKIROV, workId: WORK, score, percent: score * 10, version }],
    works: [],
  });

// Task 8.3a for the numbers of works (docs/spec/07-journal.md, "Saving"; edge/journal, Saving
// and working together): the same handling as the attendance marks (cell-saves.test.tsx).
describe('saving a number of a work', () => {
  it('shows the typed number at once while it is saving, then the saved sign', async () => {
    let reply: (response: Response) => void = () => undefined;
    fakeApi({
      [SCORES]: () =>
        new Promise<Response>((resolve) => {
          reply = resolve;
        }),
    });
    const { client, type, state } = draw();
    type(7);
    await waitFor(() => {
      expect(state()).toBe('saving');
    });
    expect(scoreOf(client)).toBe(7);
    reply(answer(7, 2));
    await waitFor(() => {
      expect(state()).toBe('saved');
    });
  });

  it('takes the typed number back after a refusal', async () => {
    fakeApi({ [SCORES]: () => refusal('score_above_total', 409) });
    const { client, type, state } = draw();
    type(7);
    await screen.findByText(en.errors.score_above_total);
    expect(state()).toBeUndefined();
    // The grid is read again from the server: the hook marks it out of date.
    expect(client.getQueryState(GRID_KEY)?.isInvalidated).toBe(true);
  });

  it('shows both values of a stale save and sends mine on the stored version with a new key', async () => {
    let first = true;
    const calls = fakeApi({
      [SCORES]: () => {
        if (first) {
          first = false;
          return json(
            {
              error: {
                code: 'cell_stale',
                message: 'x',
                requestId: 'r',
                details: [
                  {
                    path: 'saves.0',
                    code: 'cell_stale',
                    message: 'x',
                    storedCell: {
                      value: 9,
                      version: 3,
                      changedBy: uid(90),
                      changedByLogin: 'aziza.k',
                      changedByName: 'Karimova Aziza',
                      changedAt: '2026-10-27T03:05:00.000Z',
                    },
                  },
                ],
              },
            },
            409,
          );
        }
        return answer(4, 4);
      },
    });
    const keys = keysOf();
    const { type } = draw();
    type(4);
    const dialog = await screen.findByRole('dialog', { name: en.journal.saving.staleTitle });
    expect(dialog.querySelector('[data-stale-stored]')?.textContent).toContain('9');
    expect(dialog.querySelector('[data-stale-stored]')?.textContent).toContain('Karimova Aziza');
    expect(dialog.querySelector('[data-stale-mine]')?.textContent).toContain('4');
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.saving.useMine }));
    await waitFor(() => {
      expect(calls.filter((call) => call.route === SCORES)).toHaveLength(2);
    });
    expect(calls.filter((call) => call.route === SCORES)[1]?.body).toEqual({
      saves: [{ studentId: ZOKIROV, column: { workId: WORK }, score: 4, version: 3 }],
    });
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('keeps a number with no answer "not saved" and sends it again with the same key', async () => {
    let answered = false;
    const calls = fakeApi({
      [SCORES]: () => {
        if (!answered) {
          answered = true;
          throw new TypeError('Failed to fetch');
        }
        return answer(5, 2);
      },
    });
    const keys = keysOf();
    const { client, type, state } = draw();
    type(5);
    await waitFor(() => {
      expect(state()).toBe('failed');
    });
    expect(scoreOf(client)).toBe(5);
    const notice = document.querySelector<HTMLElement>('[data-unsent-cells]');
    fireEvent.click(
      within(notice as HTMLElement).getByRole('button', { name: en.journal.saving.retry }),
    );
    await waitFor(() => {
      expect(state()).toBe('saved');
    });
    expect(calls.filter((call) => call.route === SCORES)).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('keeps a number refused as from an outdated page "not saved" (edge/system-behaviour)', async () => {
    fakeApi({ [SCORES]: () => refusal('app_outdated', 409) });
    const { client, type, state } = draw();
    type(6);
    await waitFor(() => {
      expect(state()).toBe('failed');
    });
    expect(scoreOf(client)).toBe(6);
    expect(document.querySelector('[data-unsent-cells]')).not.toBeNull();
  });
});
