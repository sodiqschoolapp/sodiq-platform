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
});
