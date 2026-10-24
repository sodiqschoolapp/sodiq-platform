import {
  type Role,
  type SchoolClass,
  type StudentDetail,
  type StudentHistory,
  type StudentListItem,
  type StudentMove,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { schoolDateText } from '@/lib/dates';
import { fakeApi, json, NORTH, renderApp, sessionOf, SOUTH } from '@/testing/render-app';
import { edit, panelActionNames, savedInPanel } from '@/testing/panel';

const uid = (n: number): string => `0199f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PATH = '/people/students';

// All names are invented. docs/spec/04-people.md, Movements: "Class transfer
// and group transfer. One action with an effective date. ... The profile
// History tab shows each move with dates"; edge/students-classes-groups:
// "tomorrow by default", "the student shows the current class with a badge",
// "It can be changed or cancelled until the date", "A transfer was a
// mistake"; 05, Language of instruction: "Moving a student between an Uzbek
// class and a Russian class asks for confirmation". Task 3.3a, pull request #95.
const OXFORD = { id: uid(50), grade: 7, name: 'Oxford' };
const YALE = { id: uid(51), grade: 7, name: 'Yale' };
const MOSCOW = { id: uid(52), grade: 7, name: 'Moskva' };

const STUDENT: StudentListItem = {
  id: uid(1),
  uid: '2607001',
  mergedUids: [],
  firstName: 'Oʻtkir',
  lastName: 'Rahimov',
  paternalName: null,
  sex: 'male',
  grade: 7,
  startsOn: '2026-09-02',
  photoId: null,
  consentMissing: null,
  status: 'active',
  planned: null,
  class: { ...OXFORD, language: 'uz', from: '2026-09-02', until: '2027-06-01' },
  plannedClass: null,
  tutor: null,
  actingTutor: null,
  groups: [],
  version: 2,
  opens: true,
};

const MOVE: StudentMove = {
  id: uid(90),
  kind: 'class',
  from: '2026-10-11',
  subjectId: null,
  fromClass: OXFORD,
  toClass: YALE,
  fromGroup: null,
  toGroup: null,
  state: 'scheduled',
  cancelledByLeaving: false,
  undoable: false,
};

const detailOf = (fields: Partial<StudentDetail> = {}): StudentDetail => ({
  ...STUDENT,
  contact: null,
  identity: null,
  identityHidden: false,
  mainRoom: null,
  financial: null,
  diagnosticScore: null,
  readsDiagnostic: false,
  statuses: [{ status: 'active', from: '2026-09-02', until: null, cause: 'start', reason: null }],
  canEdit: true,
  canArchive: true,
  canRestoreGraduated: false,
  deletable: false,
  scheduledMoves: [],
  lastClassMove: null,
  canMoveClass: true,
  groupMoveSubjects: [],
  canMoveInPast: true,
  readsHistory: true,
  branchMove: null,
  lastBranchMove: null,
  canMoveBranch: false,
  canMerge: false,
  today: '2026-10-10',
  ...fields,
});

const schoolClass = (
  named: { id: string; grade: number; name: string },
  language: 'uz' | 'ru' = 'uz',
): SchoolClass => ({
  id: named.id,
  academicYearId: uid(60),
  yearName: '2026–2027',
  yearStatus: 'current',
  grade: named.grade,
  name: named.name,
  language,
  mainRoom: null,
  maxSize: 25,
  students: 1,
  tutor: null,
  acting: null,
  archived: false,
  version: 0,
});

const sessionAs = (role: Role, language: 'en' | 'ru' = 'en') => ({
  ...sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
    branches: [NORTH, SOUTH],
  }),
  language,
});

const HISTORY: StudentHistory = {
  lines: [
    {
      kind: 'move',
      move: { ...MOVE, from: '2026-10-05', state: 'done', undoable: true },
      changes: [],
    },
    { kind: 'class', class: OXFORD, from: '2026-09-02', until: '2026-10-05' },
    { kind: 'status', status: 'active', cause: 'start', from: '2026-09-02', until: null },
  ],
  today: '2026-10-10',
};

function open(
  detail: StudentDetail,
  extra: Record<string, (body: unknown) => Response> = {},
  language: 'en' | 'ru' = 'en',
) {
  return fakeApi({
    'GET /api/auth/session': () => json(sessionAs('academic_vice_principal', language)),
    'GET /api/people/students': () =>
      json({
        students: [STUDENT],
        canArchive: true,
        exportGroups: [],
        readsFinancial: false,
        today: '2026-10-10',
      }),
    [`GET /api/people/students/${STUDENT.id}`]: () => json(detail),
    [`GET /api/people/students/${STUDENT.id}/history`]: () => json(HISTORY),
    'GET /api/classes': () =>
      json({
        classes: [schoolClass(OXFORD), schoolClass(YALE), schoolClass(MOSCOW, 'ru')],
      }),
    ...extra,
  });
}

describe('class and group transfers in the side panel', () => {
  it('moves a student to another class from tomorrow by default, with the version read', async () => {
    let moved = false;
    const calls = open(detailOf(), {
      [`GET /api/people/students/${STUDENT.id}`]: () =>
        json(moved ? detailOf({ version: 4, scheduledMoves: [MOVE] }) : detailOf()),
      'POST /api/classes/transfers': () => {
        moved = true;
        return json(detailOf({ version: 4, scheduledMoves: [MOVE] }));
      },
    });
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await within(panel).findByRole('button', { name: en.people.students.moves.moveClass });
    const form = await edit(
      panel,
      en.people.students.moves.moveClass,
      en.people.students.moves.moveClass,
    );
    const date = within(form).getByLabelText<HTMLInputElement>(en.people.students.moves.from);
    expect(date.value).toBe('2026-10-11');
    const target = within(form).getByLabelText<HTMLSelectElement>(en.people.students.moves.toClass);
    // The classes of the grade but the one the student is in.
    expect([...target.options].map((option) => option.textContent)).toEqual([
      en.people.students.choose,
      '7 Yale',
      '7 Moskva',
    ]);
    fireEvent.change(target, { target: { value: YALE.id } });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(moved).toBe(true);
    });
    expect(calls.find((call) => call.route === 'POST /api/classes/transfers')?.body).toEqual({
      studentId: STUDENT.id,
      version: 2,
      toClassId: YALE.id,
      from: '2026-10-11',
    });
    await savedInPanel(panel);
    // The badge of the scheduled move in the Academic block.
    expect(
      within(panel).getByText(
        en.people.students.moves.scheduled
          .replace('{{target}}', '7 Yale')
          .replace('{{date}}', schoolDateText('2026-10-11', 'en')),
      ),
    ).toBeDefined();
  });

  it('asks to confirm a move between classes of different languages, then sends the confirmation', async () => {
    const calls = open(detailOf(), {
      'POST /api/classes/transfers': (body) =>
        (body as { confirmLanguage?: boolean }).confirmLanguage === true
          ? json(detailOf({ version: 4 }))
          : json(
              {
                error: {
                  code: 'class_language_differs',
                  message: 'The two classes differ in language of instruction.',
                  requestId: 'r-1',
                },
              },
              409,
            ),
    });
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await within(panel).findByRole('button', { name: en.people.students.moves.moveClass });
    const form = await edit(
      panel,
      en.people.students.moves.moveClass,
      en.people.students.moves.moveClass,
    );
    fireEvent.change(within(form).getByLabelText(en.people.students.moves.toClass), {
      target: { value: MOSCOW.id },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('alertdialog', {
      name: en.people.students.moves.languageTitle,
    });
    expect(within(dialog).getByText('Oʻtkir Rahimov')).toBeDefined();
    // Issue #105, H5: the question names both classes and their languages.
    expect(
      within(dialog).getByText(
        '7 Oxford teaches in Uzbek, 7 Moskva in Russian. Move the student anyway?',
      ),
    ).toBeDefined();
    fireEvent.click(
      within(dialog).getByRole('button', { name: en.people.students.moves.languageAction }),
    );
    await waitFor(() => {
      expect(calls.filter((call) => call.route === 'POST /api/classes/transfers')).toHaveLength(2);
    });
    expect(calls.filter((call) => call.route === 'POST /api/classes/transfers')[1]?.body).toEqual({
      studentId: STUDENT.id,
      version: 2,
      toClassId: MOSCOW.id,
      from: '2026-10-11',
      confirmLanguage: true,
    });
  });

  it('lists the journal entries a late move meets and sends it again with their void and the reason (task 8.6)', async () => {
    const entry = {
      path: 'journalEntries',
      code: 'journal_entries',
      message: 'The cell holds data.',
      recordId: '01a00000-0000-7000-8000-00000000e001',
      journalEntry: {
        kind: 'cell',
        version: 3,
        date: '2026-10-06',
        journalId: '01a00000-0000-7000-8000-00000000e002',
        unitName: '7 Oxford',
        subject: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
        mark: 1,
        score: null,
        didNotSit: false,
        voidable: true,
      },
    };
    const calls = open(detailOf(), {
      'POST /api/classes/transfers': (body) =>
        (body as { journalEntries?: unknown }).journalEntries === undefined
          ? json(
              {
                error: {
                  code: 'journal_entries',
                  message: 'The change meets journal entries.',
                  requestId: 'r-1',
                  details: [entry],
                },
              },
              409,
            )
          : json(detailOf({ version: 4 })),
    });
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await within(panel).findByRole('button', { name: en.people.students.moves.moveClass });
    const form = await edit(
      panel,
      en.people.students.moves.moveClass,
      en.people.students.moves.moveClass,
    );
    fireEvent.change(within(form).getByLabelText(en.people.students.moves.toClass), {
      target: { value: YALE.id },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('dialog', {
      name: en.people.students.journalEntries.title_one.replace('{{count}}', '1'),
    });
    const line = dialog.querySelector(`[data-entry="${entry.recordId}"]`);
    expect(line?.textContent).toBe(
      `${schoolDateText('2026-10-06', 'en')} · 7 Oxford · Mathematics: present`,
    );
    fireEvent.change(within(dialog).getByLabelText(en.people.students.journalEntries.reason), {
      target: { value: 'Entered in the old class by mistake' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: en.people.students.journalEntries.void_one.replace('{{count}}', '1'),
      }),
    );
    await waitFor(() => {
      expect(calls.filter((call) => call.route === 'POST /api/classes/transfers')).toHaveLength(2);
    });
    expect(
      (
        calls.filter((call) => call.route === 'POST /api/classes/transfers')[1]?.body as {
          journalEntries: unknown;
        }
      ).journalEntries,
    ).toEqual({
      reason: 'Entered in the old class by mistake',
      seen: [{ id: entry.recordId, version: 3 }],
    });
  });

  it('sends the move once more with no choice when the entries went meanwhile (task 8.6, review finding 9)', async () => {
    const entry = {
      path: 'journalEntries',
      code: 'journal_entries',
      message: 'The cell holds data.',
      recordId: '01a00000-0000-7000-8000-00000000e011',
      journalEntry: {
        kind: 'cell',
        version: 2,
        date: '2026-10-06',
        journalId: null,
        unitName: '7 Oxford',
        subject: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
        mark: 1,
        score: null,
        didNotSit: false,
        voidable: true,
      },
    };
    let sent = 0;
    const calls = open(detailOf(), {
      'POST /api/classes/transfers': () => {
        sent += 1;
        if (sent === 1) {
          return json(
            {
              error: {
                code: 'journal_entries',
                message: 'The change meets journal entries.',
                requestId: 'r-1',
                details: [entry],
              },
            },
            409,
          );
        }
        if (sent === 2) {
          return json(
            {
              error: {
                code: 'journal_entries',
                message: 'The change meets journal entries.',
                requestId: 'r-2',
                details: [
                  {
                    path: 'journalEntries.seen',
                    code: 'journal_entries',
                    message: 'The entries sent are not the list now.',
                    changed: true,
                  },
                ],
              },
            },
            409,
          );
        }
        return json(detailOf({ version: 4 }));
      },
    });
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await within(panel).findByRole('button', { name: en.people.students.moves.moveClass });
    const form = await edit(
      panel,
      en.people.students.moves.moveClass,
      en.people.students.moves.moveClass,
    );
    fireEvent.change(within(form).getByLabelText(en.people.students.moves.toClass), {
      target: { value: YALE.id },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('dialog', {
      name: en.people.students.journalEntries.title_one.replace('{{count}}', '1'),
    });
    fireEvent.change(within(dialog).getByLabelText(en.people.students.journalEntries.reason), {
      target: { value: 'Old class' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: en.people.students.journalEntries.void_one.replace('{{count}}', '1'),
      }),
    );
    await waitFor(() => {
      expect(calls.filter((call) => call.route === 'POST /api/classes/transfers')).toHaveLength(3);
    });
    const third = calls.filter((call) => call.route === 'POST /api/classes/transfers')[2]?.body as {
      journalEntries?: unknown;
    };
    expect(third.journalEntries).toBeUndefined();
  });

  it('offers the change and the cancel of a scheduled move, and cancels it through its confirmation', async () => {
    const calls = open(detailOf({ scheduledMoves: [MOVE] }), {
      [`POST /api/classes/transfers/${MOVE.id}/cancel`]: () => json(detailOf({ version: 5 })),
    });
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const change = en.people.students.moves.change.replace('{{target}}', '7 Yale');
    const cancel = en.people.students.moves.cancel.replace('{{target}}', '7 Yale');
    await waitFor(() => {
      expect(panelActionNames(panel)).toEqual(expect.arrayContaining([change, cancel]));
    });
    // No second class move while one is scheduled.
    expect(panelActionNames(panel)).not.toContain(en.people.students.moves.moveClass);
    fireEvent.click(within(panel).getByRole('button', { name: cancel }));
    const dialog = await screen.findByRole('alertdialog', {
      name: en.people.students.moves.cancelTitle,
    });
    fireEvent.click(within(dialog).getByRole('button', { name: cancel }));
    await waitFor(() => {
      expect(calls.some((call) => call.route.endsWith('/cancel'))).toBe(true);
    });
    expect(calls.find((call) => call.route.endsWith('/cancel'))?.body).toEqual({ version: 2 });
    await savedInPanel(panel);
  });

  it('shows the History tab, newest first, and undoes a move with a reason', async () => {
    const calls = open(detailOf(), {
      [`POST /api/classes/transfers/${MOVE.id}/undo`]: () => json(detailOf({ version: 5 })),
    });
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    fireEvent.click(
      await within(panel).findByRole('radio', { name: en.people.students.tabs.history }),
    );
    const history = await within(panel).findByRole('region', {
      name: en.people.students.moves.historyLabel,
    });
    const lines = [...history.querySelectorAll('li')].map((line) => line.textContent ?? '');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain(
      en.people.students.moves.classMove
        .replace('{{from}}', '7 Oxford')
        .replace('{{to}}', '7 Yale'),
    );
    expect(lines[0]).toContain(en.people.students.moves.states.done);
    // Task 3.5c, H35: a stay with its last day (the day before `until`).
    expect(lines[1]).toContain(
      en.people.students.moves.classStay
        .replace('{{class}}', '7 Oxford')
        .replace('{{until}}', schoolDateText('2026-10-04', 'en')),
    );
    fireEvent.click(within(history).getByRole('button', { name: en.people.students.moves.undo }));
    const form = await within(panel).findByRole('form', {
      name: en.people.students.moves.undoTitle.replace('{{target}}', '7 Yale'),
    });
    fireEvent.change(within(form).getByLabelText(en.people.students.reason), {
      target: { value: 'Moved by mistake' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.some((call) => call.route.endsWith('/undo'))).toBe(true);
    });
    expect(calls.find((call) => call.route.endsWith('/undo'))?.body).toEqual({
      reason: 'Moved by mistake',
      version: 2,
    });
    // Task 3.5b, H28 of issue #105: the panel stays on History, read again in place.
    const after = await within(panel).findByRole('region', {
      name: en.people.students.moves.historyLabel,
    });
    expect(
      within(panel).getByRole<HTMLInputElement>('radio', { name: en.people.students.tabs.history })
        .checked,
    ).toBe(true);
    await waitFor(() => {
      expect(document.activeElement).toBe(after);
    });
    expect(
      calls.filter((call) => call.route === `GET /api/people/students/${STUDENT.id}/history`)
        .length,
    ).toBeGreaterThan(1);
  });

  // Task 3.5b, H27 of issue #105: the language question once per move.
  it('changes only the date of a confirmed move with one call and no question', async () => {
    const toMoscow = { ...MOVE, toClass: MOSCOW, from: '2026-10-16' };
    const calls = open(detailOf({ scheduledMoves: [toMoscow] }), {
      [`POST /api/classes/transfers/${MOVE.id}/change`]: () => json(detailOf({ version: 5 })),
    });
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const change = en.people.students.moves.change.replace('{{target}}', '7 Moskva');
    fireEvent.click(await within(panel).findByRole('button', { name: change }));
    const form = await within(panel).findByRole('form');
    fireEvent.change(within(form).getByLabelText(en.people.students.moves.from), {
      target: { value: '2026-10-23' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await savedInPanel(panel);
    const sent = calls.filter((call) => call.route.endsWith('/change'));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toEqual({ version: 2, toClassId: MOSCOW.id, from: '2026-10-23' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('draws no move action and no History tab for a reader the record does not allow, in Russian', async () => {
    open(
      detailOf({ canMoveClass: false, readsHistory: false, canEdit: false, canArchive: false }),
      {},
      'ru',
    );
    renderApp(`${PATH}?open=${STUDENT.id}`, 'ru');
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await within(panel).findByRole('heading', { name: ru.people.students.statusTitle });
    expect(
      within(panel).queryByRole('button', { name: ru.people.students.moves.moveClass }),
    ).toBeNull();
    expect(
      within(panel).queryByRole('radio', { name: ru.people.students.tabs.history }),
    ).toBeNull();
  });
});

// Task 3.5c (pull request #117), issue #105: H34, "one move with its changes
// ('Sana oʻzgartirildi: 16-oktabr → 23-oktabr'), and the word 'koʻchirildi'
// only for a move that happened; a cancelled one reads 'Koʻchirish
// rejalashtirilgan edi · Bekor qilingan'"; H35, "one line per stay in a class,
// from its first to its last day (or 'hozirgacha')"; correction 4 of the
// review: a stay that begins after today reads "from <date>".
describe('the History tab of one stay', () => {
  const PRINCETON = { id: uid(53), grade: 7, name: 'Princeton' };
  const linesOf = async (history: StudentHistory, language: 'en' | 'ru' = 'en') => {
    open(
      detailOf(),
      {
        [`GET /api/people/students/${STUDENT.id}/history`]: () => json(history),
      },
      language,
    );
    renderApp(`${PATH}?open=${STUDENT.id}`, language);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    fireEvent.click(
      await within(panel).findByRole('radio', {
        name: (language === 'en' ? en : ru).people.students.tabs.history,
      }),
    );
    const region = await within(panel).findByRole('region', {
      name: (language === 'en' ? en : ru).people.students.moves.historyLabel,
    });
    return [...region.querySelectorAll('li')].map((line) => line.textContent ?? '');
  };

  it('reads a stay in force "until now" and a stay ahead "from" its first day', async () => {
    const lines = await linesOf({
      lines: [
        { kind: 'class', class: YALE, from: '2026-10-23', until: null },
        { kind: 'class', class: OXFORD, from: '2026-09-02', until: null },
      ],
      today: '2026-10-10',
    });
    expect(lines[0]).toContain(
      en.people.students.moves.classStayFrom
        .replace('{{class}}', '7 Yale')
        .replace('{{from}}', schoolDateText('2026-10-23', 'en')),
    );
    expect(lines[0]).not.toContain(
      en.people.students.moves.classStayNow.replace('{{class}}', '7 Yale'),
    );
    expect(lines[1]).toContain(
      en.people.students.moves.classStayNow.replace('{{class}}', '7 Oxford'),
    );
  });

  it('draws a changed move as one line with its changes, and a cancelled one as planned', async () => {
    const lines = await linesOf({
      lines: [
        {
          kind: 'move',
          move: { ...MOVE, from: '2026-10-23', toClass: PRINCETON, state: 'cancelled' },
          changes: [
            { from: '2026-10-16', toClass: YALE, toGroup: null },
            { from: '2026-10-23', toClass: YALE, toGroup: null },
          ],
        },
      ],
      today: '2026-10-10',
    });
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line).toContain(
      `${en.people.students.moves.classMoveCancelled
        .replace('{{from}}', '7 Oxford')
        .replace('{{to}}', '7 Princeton')} · ${en.people.students.moves.states.cancelled}`,
    );
    // "Moved" only of a move that happened.
    expect(line).not.toContain(
      en.people.students.moves.classMove
        .replace('{{from}}', '7 Oxford')
        .replace('{{to}}', '7 Princeton'),
    );
    expect(line).toContain(
      en.people.students.moves.dateChanged
        .replace('{{from}}', schoolDateText('2026-10-16', 'en'))
        .replace('{{to}}', schoolDateText('2026-10-23', 'en')),
    );
    expect(line).toContain(
      en.people.students.moves.classChanged
        .replace('{{from}}', '7 Yale')
        .replace('{{to}}', '7 Princeton'),
    );
  });

  it('reads a scheduled move as one to come, in Russian', async () => {
    const lines = await linesOf(
      {
        lines: [
          { kind: 'move', move: { ...MOVE, from: '2026-10-23', state: 'scheduled' }, changes: [] },
          { kind: 'class', class: OXFORD, from: '2026-09-02', until: '2026-10-23' },
        ],
        today: '2026-10-10',
      },
      'ru',
    );
    expect(lines[0]).toContain(
      ru.people.students.moves.classMovePlanned
        .replace('{{from}}', '7 Oxford')
        .replace('{{to}}', '7 Yale'),
    );
    expect(lines[1]).toContain(
      ru.people.students.moves.classStay
        .replace('{{class}}', '7 Oxford')
        .replace('{{until}}', schoolDateText('2026-10-22', 'ru')),
    );
  });
});
