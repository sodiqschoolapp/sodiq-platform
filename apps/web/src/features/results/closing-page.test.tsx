import type { ClosingChecklist } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e700-0000-7000-8000-${String(n).padStart(12, '0')}`;

const SUBJECT = {
  id: uid(10),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  colour: 'blue' as const,
};
const UNIT = { kind: 'class' as const, id: uid(20), name: '7 Oxford' };
const JOURNAL = { id: uid(21), unit: UNIT, subject: SUBJECT };
const TEACHER = { id: uid(40), name: 'Karimova Aziza' };
const Q1 = uid(1);
const BEK = {
  id: uid(50),
  firstName: 'Bek',
  lastName: 'Toshev',
  paternalName: null,
  uid: '0000051',
};
const GULI = {
  id: uid(51),
  firstName: 'Gulnora',
  lastName: 'Sobirova',
  paternalName: null,
  uid: '0000052',
};
const DILSHOD = {
  id: uid(52),
  firstName: 'Dilshod',
  lastName: 'Ergashev',
  paternalName: null,
  uid: '0000053',
};

const NO_RESULT: ClosingChecklist['items'][number] = {
  kind: 'no_result',
  teacher: TEACHER,
  journal: JOURNAL,
  students: [DILSHOD],
};

// All names are invented. Task 9.2a: the closing checklist (07, Closing a quarter).
const CHECKLIST: ClosingChecklist = {
  quarters: [{ id: Q1, number: 1, startDate: '2026-09-01', endDate: '2026-10-31' }],
  quarterId: Q1,
  state: 'open',
  opensOn: '2026-10-17',
  lastDay: '2026-10-31',
  closable: false,
  lockNowNeeded: false,
  startQuarter: false,
  earlierOpen: false,
  closing: null,
  reopenings: [],
  reopening: null,
  changes: [],
  closedJournals: [],
  reopenedJournals: [],
  check: null,
  canApply: false,
  canEdit: true,
  blocking: 1,
  warnings: 1,
  items: [
    {
      kind: 'undecided',
      teacher: TEACHER,
      journal: JOURNAL,
      students: [
        {
          student: BEK,
          flags: ['few_lessons'],
          basedOn: { expected: 1, held: 6 },
          leftSubjectOn: null,
          decision: null,
          version: null,
          allowed: ['keep', 'exempt', 'not_assessed'],
        },
        {
          student: GULI,
          flags: ['few_lessons', 'attendance_only'],
          basedOn: { expected: 1, held: 6 },
          leftSubjectOn: null,
          decision: null,
          version: null,
          allowed: ['keep', 'not_assessed'],
        },
      ],
    },
    NO_RESULT,
  ],
};

const UNDECIDED = `undecided:${JOURNAL.id}:${TEACHER.id}:0`;

const sessionAs =
  (role: 'academic_vice_principal' | 'principal', language: 'en' | 'ru' = 'en') =>
  () =>
    json(sessionOf({ language, assignments: [{ role, branchId: NORTH.id }] }));

const rowsOf = () =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

describe('the closing checklist', () => {
  it('lists each item with its effect, teacher, class and subject', async () => {
    fakeApi({
      'GET /api/auth/session': sessionAs('academic_vice_principal'),
      'GET /api/results/closing': () => json(CHECKLIST),
    });
    renderApp('/results/closing');
    await screen.findByRole('heading', { name: en.results.closing.title });
    await waitFor(() => {
      expect(rowsOf().map((row) => row.slice(0, 6))).toEqual([
        [
          en.results.closing.kinds.undecided,
          en.results.closing.blocking,
          'Karimova Aziza',
          '7 Oxford',
          'Mathematics',
          '2',
        ],
        [
          en.results.closing.kinds.no_result,
          en.results.closing.warning,
          'Karimova Aziza',
          '7 Oxford',
          'Mathematics',
          '1',
        ],
      ]);
    });
    expect(screen.getByText('Blocking: 1 · warnings: 1')).not.toBeNull();
  });

  // Task 9.2d: "In quarter 4 only merge or drop exist": the items left block the close.
  it('lists the plan items not covered that nothing can carry as blocking', async () => {
    fakeApi({
      'GET /api/auth/session': sessionAs('academic_vice_principal'),
      'GET /api/results/closing': () =>
        json({
          ...CHECKLIST,
          items: [{ kind: 'plan_not_covered', teacher: TEACHER, journal: JOURNAL, notCovered: 2 }],
        }),
    });
    renderApp('/results/closing');
    await waitFor(() => {
      expect(rowsOf().map((row) => row.slice(0, 6))).toEqual([
        [
          en.results.closing.kinds.plan_not_covered,
          en.results.closing.blocking,
          'Karimova Aziza',
          '7 Oxford',
          'Mathematics',
          '2',
        ],
      ]);
    });
  });

  it('decides one result with the decisions the server allows, and a whole journal naming the refused', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': sessionAs('academic_vice_principal'),
      'GET /api/results/closing': () => json(CHECKLIST),
      [`PUT /api/results/closing/${Q1}/decisions`]: () => json({ decision: 'keep', version: 1 }),
      [`POST /api/results/closing/${Q1}/journals/${JOURNAL.id}/decisions`]: () =>
        json({
          decided: [BEK.id],
          refused: [{ studentId: GULI.id, code: 'closing_decision_not_allowed' }],
        }),
    });
    renderApp(`/results/closing?open=${encodeURIComponent(UNDECIDED)}`);
    const bek = await waitFor(() => {
      const found = document.querySelector(`[data-student="${BEK.id}"]`);
      if (!(found instanceof HTMLElement)) throw new Error('Bek is listed.');
      return found;
    });
    const guli = document.querySelector(`[data-student="${GULI.id}"]`);
    if (!(guli instanceof HTMLElement)) throw new Error('Gulnora is listed.');
    // "Exempt" only where the server allows it (few lessons alone).
    expect(
      within(bek).getByRole('button', { name: en.results.closing.decisions.exempt }),
    ).not.toBeNull();
    expect(
      within(guli).queryByRole('button', { name: en.results.closing.decisions.exempt }),
    ).toBeNull();
    fireEvent.click(within(bek).getByRole('button', { name: en.results.closing.decisions.keep }));
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.route === `PUT /api/results/closing/${Q1}/decisions`)
          .map((call) => call.body),
      ).toEqual([{ subjectId: SUBJECT.id, studentId: BEK.id, decision: 'keep', version: null }]);
    });
    const whole = screen.getByText(en.results.closing.wholeJournal).parentElement;
    if (whole === null) throw new Error('The whole journal part.');
    fireEvent.click(
      within(whole).getByRole('button', { name: en.results.closing.decisions.exempt }),
    );
    await waitFor(() => {
      expect(
        calls
          .filter(
            (call) =>
              call.route === `POST /api/results/closing/${Q1}/journals/${JOURNAL.id}/decisions`,
          )
          .map((call) => call.body),
      ).toEqual([{ decision: 'exempt', students: [BEK.id, GULI.id] }]);
    });
    const status = await within(whole).findByRole('status');
    expect(status.textContent).toBe(
      `Sobirova Gulnora · 0000052: ${en.results.closing.refused.closing_decision_not_allowed}`,
    );
  });

  it('reminds the teachers once per press and says how many were told', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': sessionAs('academic_vice_principal'),
      'GET /api/results/closing': () => json(CHECKLIST),
      [`POST /api/results/closing/${Q1}/remind`]: () => json({ sent: 2 }),
    });
    renderApp('/results/closing');
    fireEvent.click(await screen.findByRole('button', { name: en.results.closing.remind }));
    expect(await screen.findByText('Reminders were sent to 2 teachers.')).not.toBeNull();
    expect(
      calls.filter((call) => call.route === `POST /api/results/closing/${Q1}/remind`),
    ).toHaveLength(1);
  });

  it('shows the Principal the items with no decision or action, in Russian', async () => {
    fakeApi({
      'GET /api/auth/session': sessionAs('principal', 'ru'),
      'GET /api/results/closing': () => json({ ...CHECKLIST, canEdit: false }),
    });
    renderApp(`/results/closing?open=${encodeURIComponent(UNDECIDED)}`, 'ru');
    await screen.findByRole('heading', { name: ru.results.closing.title });
    await waitFor(() => {
      expect(document.querySelector(`[data-student="${BEK.id}"]`)).not.toBeNull();
    });
    expect(screen.queryByRole('button', { name: ru.results.closing.remind })).toBeNull();
    expect(screen.queryByRole('button', { name: ru.results.closing.decisions.keep })).toBeNull();
    expect(screen.queryByText(ru.results.closing.wholeJournal)).toBeNull();
  });

  it('says when the checklist opens', async () => {
    fakeApi({
      'GET /api/auth/session': sessionAs('academic_vice_principal'),
      'GET /api/results/closing': () =>
        json({ ...CHECKLIST, state: 'not_open', blocking: 0, warnings: 0, items: [] }),
    });
    renderApp('/results/closing');
    const line = await waitFor(() => {
      const found = document.querySelector('[data-closing-state="not_open"]');
      if (found === null) throw new Error('The line.');
      return found;
    });
    expect(line.textContent).toBe('The checklist opens on 17 October 2026.');
    expect(await screen.findByText(en.results.closing.notOpenYet)).not.toBeNull();
  });
  // Task 9.2b: the close (07, Closing a quarter; edge/journal, "lock now and close";
  // edge/academic-year, "Closing the start quarter").
  it('closes once every point is ticked: the warnings acknowledged, lock now and the start-quarter choice', async () => {
    const closable: ClosingChecklist = {
      ...CHECKLIST,
      closable: true,
      lockNowNeeded: true,
      startQuarter: true,
      blocking: 1,
      warnings: 1,
      items: [
        { kind: 'edit_period', teacher: TEACHER, journal: JOURNAL, lessons: 2, incomplete: 1 },
        NO_RESULT,
      ],
    };
    const calls = fakeApi({
      'GET /api/auth/session': sessionAs('academic_vice_principal'),
      'GET /api/results/closing': () => json(closable),
      [`POST /api/results/closing/${Q1}/close`]: () =>
        json({ closedAt: '2026-10-31T13:00:00.000Z', version: 1, stored: 24, voided: 0 }),
    });
    renderApp('/results/closing');
    fireEvent.click(await screen.findByRole('button', { name: en.results.closing.closeQuarter }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.results.closing.close.action }));
    expect(within(dialog).getByRole('alert').textContent).toBe(en.results.closing.close.missing);
    expect(calls.filter((call) => call.route === `POST /api/results/closing/${Q1}/close`)).toEqual(
      [],
    );
    fireEvent.click(
      within(dialog).getByRole('checkbox', {
        name: 'I have looked at the 1 warning; it is stored with the close.',
      }),
    );
    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: en.results.closing.close.lockNow }),
    );
    fireEvent.click(
      within(dialog).getByRole('radio', {
        name: en.results.closing.close.startQuarters.not_official,
      }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: en.results.closing.close.action }));
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.route === `POST /api/results/closing/${Q1}/close`)
          .map((call) => call.body),
      ).toEqual([
        {
          warnings: [{ kind: 'no_result', journalId: JOURNAL.id }],
          lockNow: true,
          startQuarter: 'not_official',
        },
      ]);
    });
  });

  // The plan's Tests, Web: "the close dialog (... refusal texts)" (code round 1, finding 2).
  it('shows a refusal of the close with its text and keeps the dialog open', async () => {
    fakeApi({
      'GET /api/auth/session': sessionAs('academic_vice_principal'),
      'GET /api/results/closing': () =>
        json({ ...CHECKLIST, closable: true, blocking: 0, warnings: 0, items: [] }),
      [`POST /api/results/closing/${Q1}/close`]: () =>
        Response.json(
          { error: { code: 'closing_warnings_changed', message: 'x', requestId: 'r' } },
          { status: 409 },
        ),
    });
    renderApp('/results/closing');
    fireEvent.click(await screen.findByRole('button', { name: en.results.closing.closeQuarter }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.results.closing.close.action }));
    await waitFor(() => {
      expect(within(dialog).getByRole('alert').textContent).toContain(
        en.errors.closing_warnings_changed,
      );
    });
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it('keeps the close off while it is not closable, and draws the ticks anew for a new list of warnings', async () => {
    let answer: ClosingChecklist = {
      ...CHECKLIST,
      closable: true,
      blocking: 0,
      items: [NO_RESULT],
    };
    fakeApi({
      'GET /api/auth/session': sessionAs('academic_vice_principal'),
      'GET /api/results/closing': () => json(answer),
    });
    const { queryClient } = renderApp('/results/closing');
    fireEvent.click(await screen.findByRole('button', { name: en.results.closing.closeQuarter }));
    const dialog = await screen.findByRole('dialog');
    const tick = within(dialog).getByRole('checkbox');
    fireEvent.click(tick);
    expect((tick as HTMLInputElement).checked).toBe(true);
    // Another warning arrives while the dialog is open: the tick does not carry over.
    answer = {
      ...answer,
      warnings: 2,
      items: [
        ...answer.items,
        { kind: 'no_attendance', teacher: TEACHER, journal: JOURNAL, lessons: [] },
      ],
    };
    await queryClient.invalidateQueries();
    await waitFor(() => {
      const again = within(screen.getByRole('dialog')).getAllByRole('checkbox')[0];
      expect((again as HTMLInputElement).checked).toBe(false);
    });
  });

  it('shows a closed quarter with its close and the warnings acknowledged, and no action', async () => {
    fakeApi({
      'GET /api/auth/session': sessionAs('academic_vice_principal'),
      'GET /api/results/closing': () =>
        json({
          ...CHECKLIST,
          state: 'closed',
          blocking: 0,
          warnings: 0,
          items: [],
          closing: {
            closedAt: '2026-10-31T13:00:00.000Z',
            closedBy: 'Karimova Aziza',
            version: 1,
            lockNow: true,
            startQuarter: null,
            warnings: [NO_RESULT],
          },
        }),
    });
    renderApp('/results/closing');
    const line = await waitFor(() => {
      const found = document.querySelector('[data-closing-state="closed"]');
      if (found === null) throw new Error('The line.');
      return found;
    });
    expect(line.textContent).toMatch(
      /^Closed on 31 Oct 2026, \d\d:\d\d by Karimova Aziza · version 1$/,
    );
    expect(screen.getByText(en.results.closing.closedLockNow)).not.toBeNull();
    await waitFor(() => {
      expect(rowsOf().map((row) => row[0])).toEqual([en.results.closing.kinds.no_result]);
    });
    expect(screen.queryByRole('button', { name: en.results.closing.closeQuarter })).toBeNull();
    expect(screen.queryByRole('button', { name: en.results.closing.remind })).toBeNull();
  });

  // Task 9.2c: reopening, closing again and "recalculate and compare".
  const CLOSED: ClosingChecklist = {
    ...CHECKLIST,
    state: 'closed',
    blocking: 0,
    warnings: 0,
    items: [],
    closing: {
      closedAt: '2026-10-31T13:00:00.000Z',
      closedBy: 'Karimova Aziza',
      version: 1,
      lockNow: false,
      startQuarter: null,
      warnings: [],
    },
    closedJournals: [
      {
        id: JOURNAL.id,
        unitName: '7 Oxford',
        subjectNames: SUBJECT.names,
      },
    ],
  };
  const REOPENING = {
    id: uid(70),
    journal: JOURNAL,
    reason: 'A mark was typed in the wrong row',
    days: 3,
    reopenedAt: '2026-11-02T04:00:00.000Z',
    reopenedBy: 'Karimova Aziza',
    openUntil: '2026-11-05T19:00:00.000Z',
    ended: false,
    closedAgainVersion: null,
  };

  it('reopens a journal with a reason and days, checked before it is sent', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': sessionAs('academic_vice_principal'),
      'GET /api/results/closing': () => json(CLOSED),
      [`POST /api/results/closing/${Q1}/reopen`]: () =>
        json({ id: uid(70), openUntil: '2026-11-05T19:00:00.000Z' }),
    });
    renderApp('/results/closing');
    fireEvent.click(await screen.findByRole('button', { name: en.results.reopening.action }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.results.reopening.action }));
    expect(within(dialog).getByRole('alert').textContent).toBe(en.results.reopening.missing);
    expect(calls.some((call) => call.route.endsWith('/reopen'))).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(en.results.reopening.what), {
      target: { value: JOURNAL.id },
    });
    fireEvent.change(within(dialog).getByLabelText(en.results.reopening.days), {
      target: { value: '5' },
    });
    fireEvent.change(within(dialog).getByLabelText(en.results.reopening.reason), {
      target: { value: 'A mark was typed in the wrong row' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.results.reopening.action }));
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.route === `POST /api/results/closing/${Q1}/reopen`)
          .map((call) => call.body),
      ).toEqual([{ journalId: JOURNAL.id, reason: 'A mark was typed in the wrong row', days: 5 }]);
    });
  });

  it('shows a reopened journal with the results that changed, and closes it again', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': sessionAs('academic_vice_principal'),
      'GET /api/results/closing': () =>
        json({
          ...CLOSED,
          reopenings: [REOPENING],
          reopenedJournals: [
            {
              reopening: REOPENING,
              closable: true,
              lockNowNeeded: false,
              blocking: 0,
              warnings: 1,
              items: [NO_RESULT],
              changes: [
                {
                  student: DILSHOD,
                  subject: SUBJECT,
                  journalId: JOURNAL.id,
                  before: { kind: 'no_result', shown: null, grade: null, decision: null },
                  after: { kind: 'number', shown: 100, grade: 5, decision: 'keep' },
                },
              ],
            },
          ],
        }),
      [`POST /api/results/closing/${Q1}/journals/${JOURNAL.id}/close`]: () =>
        json({ closedAt: '2026-11-03T05:00:00.000Z', version: 2, stored: 3, voided: 0 }),
    });
    renderApp('/results/closing');
    const panel = await waitFor(() => {
      const found = document.querySelector(`[data-reopened-journal="${JOURNAL.id}"]`);
      if (!(found instanceof HTMLElement)) throw new Error('The panel.');
      return found;
    });
    const row = panel.querySelector(`[data-student="${DILSHOD.id}"]`);
    expect([...(row?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent)).toEqual([
      'Ergashev Dilshod · 0000053',
      'Mathematics',
      en.results.reopening.outcomes.no_result,
      '100, grade 5',
    ]);
    fireEvent.click(within(panel).getByRole('button', { name: en.results.reopening.closeAgain }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: en.results.reopening.closeAgain }));
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.route.endsWith(`/journals/${JOURNAL.id}/close`))
          .map((call) => call.body),
      ).toEqual([{ warnings: [{ kind: 'no_result', journalId: JOURNAL.id }], lockNow: false }]);
    });
  });

  it('recalculates and compares on request, and applies with a reason for the Super Admin', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ language: 'en', assignments: [{ role: 'super_admin', branchId: null }] })),
      'GET /api/results/closing': () => json({ ...CLOSED, canApply: true }),
      [`GET /api/results/closing/${Q1}/recalculation`]: () =>
        json({
          quarterId: Q1,
          currentVersion: 2,
          rows: [
            {
              student: BEK,
              subject: SUBJECT,
              journalId: JOURNAL.id,
              storedVersion: 1,
              differences: ['result.shown'],
              refused: null,
              before: { kind: 'number', shown: 49, grade: 2, decision: null },
              after: { kind: 'number', shown: 50, grade: 3, decision: null },
            },
          ],
        }),
      [`POST /api/results/closing/${Q1}/recalculation/apply`]: () =>
        json({ version: 2, stored: 1 }),
    });
    renderApp('/results/closing');
    fireEvent.click(await screen.findByRole('button', { name: en.results.recalculation.compare }));
    const table = await waitFor(() => {
      const found = document.querySelector('[data-recalculation="differences"]');
      if (found === null) throw new Error('The differences.');
      return found;
    });
    expect(
      [...table.querySelectorAll(`[data-student="${BEK.id}"] td`)].map((cell) => cell.textContent),
    ).toEqual([
      'Toshev Bek · 0000051',
      'Mathematics',
      '49, grade 2 · calculation version 1',
      '50, grade 3',
    ]);
    fireEvent.click(screen.getByRole('button', { name: en.results.recalculation.apply }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(en.results.reopening.reason), {
      target: { value: 'A rounding bug of an earlier release' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.results.recalculation.apply }));
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.route.endsWith('/recalculation/apply'))
          .map((call) => call.body),
      ).toEqual([
        {
          reason: 'A rounding bug of an earlier release',
          students: [{ subjectId: SUBJECT.id, studentId: BEK.id }],
        },
      ]);
    });
  });

  it('offers no apply of a recalculation to the Academic Vice Principal', async () => {
    fakeApi({
      'GET /api/auth/session': sessionAs('academic_vice_principal'),
      'GET /api/results/closing': () => json(CLOSED),
      [`GET /api/results/closing/${Q1}/recalculation`]: () =>
        json({
          quarterId: Q1,
          currentVersion: 2,
          rows: [
            {
              student: BEK,
              subject: SUBJECT,
              journalId: JOURNAL.id,
              storedVersion: 1,
              differences: ['result.shown'],
              refused: null,
              before: { kind: 'number', shown: 49, grade: 2, decision: null },
              after: { kind: 'number', shown: 50, grade: 3, decision: null },
            },
          ],
        }),
    });
    renderApp('/results/closing');
    fireEvent.click(await screen.findByRole('button', { name: en.results.recalculation.compare }));
    await waitFor(() => {
      expect(document.querySelector('[data-recalculation="differences"]')).not.toBeNull();
    });
    expect(screen.queryByRole('button', { name: en.results.recalculation.apply })).toBeNull();
  });
});
