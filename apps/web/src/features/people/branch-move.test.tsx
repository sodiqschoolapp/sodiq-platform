import {
  type IncomingBranchMoves,
  type Role,
  type SchoolClass,
  type StudentBranchMove,
  type StudentDetail,
  type StudentListItem,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { schoolDateText } from '@/lib/dates';
import { edit, panelActionNames, savedInPanel } from '@/testing/panel';
import { fakeApi, json, NORTH, renderApp, sessionOf, SOUTH } from '@/testing/render-app';

const uid = (n: number): string => `0199f100-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PATH = '/people/students';
const texts = en.people.students.branchMoves;

// All names are invented. edge/students-classes-groups, "A student moves to
// another branch": "The sending Academic Vice Principal releases the student
// and the receiving one accepts, choosing class and groups; the Super Admin
// can do both". Task 3.3c, pull request #97.
const OXFORD = { id: uid(50), grade: 7, name: 'Oxford' };
const YALE = { id: uid(51), grade: 7, name: 'Yale' };
const MOSCOW = { id: uid(52), grade: 7, name: 'Moskva' };
const ENGLISH = uid(70);

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

const RELEASE: StudentBranchMove = {
  id: uid(90),
  fromBranch: { id: NORTH.id, name: NORTH.name },
  toBranch: { id: SOUTH.id, name: SOUTH.name },
  from: '2026-10-11',
  state: 'open',
  cancelledByLeaving: false,
};

const detailOf = (fields: Partial<StudentDetail> = {}): StudentDetail => ({
  ...STUDENT,
  contact: null,
  identity: null,
  identityHidden: false,
  mainRoom: null,
  financial: null,
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
  readsHistory: false,
  branchMove: null,
  lastBranchMove: null,
  canMoveBranch: true,
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

const INCOMING: IncomingBranchMoves = {
  moves: [
    {
      id: uid(91),
      studentId: uid(2),
      uid: '2607002',
      firstName: 'Malika',
      lastName: 'Karimova',
      grade: 7,
      fromBranch: { id: SOUTH.id, name: SOUTH.name },
      from: '2026-10-10',
      acceptable: true,
    },
    {
      id: uid(92),
      studentId: uid(3),
      uid: '2607003',
      firstName: 'Jasur',
      lastName: 'Tursunov',
      grade: 7,
      fromBranch: { id: SOUTH.id, name: SOUTH.name },
      from: '2026-10-12',
      acceptable: false,
    },
  ],
  canDecide: true,
  today: '2026-10-10',
};

function open(
  detail: StudentDetail,
  extra: Record<string, (body: unknown) => Response> = {},
  options: { role?: Role; language?: 'en' | 'ru'; incoming?: IncomingBranchMoves } = {},
) {
  return fakeApi({
    'GET /api/auth/session': () =>
      json(sessionAs(options.role ?? 'academic_vice_principal', options.language)),
    'GET /api/people/students': () =>
      json({
        students: [STUDENT],
        canArchive: true,
        exportGroups: [],
        readsFinancial: false,
        today: '2026-10-10',
      }),
    [`GET /api/people/students/${STUDENT.id}`]: () => json(detail),
    'GET /api/people/branch-moves/incoming': () =>
      json(options.incoming ?? { moves: [], canDecide: true, today: '2026-10-10' }),
    'GET /api/people/branch-moves/targets': () =>
      json({ branches: [{ id: SOUTH.id, name: SOUTH.name }] }),
    'GET /api/classes': () =>
      json({ classes: [schoolClass(YALE), schoolClass(MOSCOW, 'ru'), schoolClass(OXFORD)] }),
    'GET /api/setup/subjects': () =>
      json({
        subjects: [
          {
            id: ENGLISH,
            names: { uz: 'Ingliz tili', ru: 'Английский язык', en: 'English' },
            departmentId: uid(11),
            grades: [7, 8],
            colour: 'blue',
            journalType: 'graded',
            ratingExam: false,
            groupSubject: true,
            languageRule: true,
            demanding: false,
            archivedAt: null,
            daily: null,
            quarterWeightsMissing: null,
            quarterCount: null,
          },
        ],
        mayMoveDepartment: false,
      }),
    ...extra,
  });
}

describe('the move to another branch', () => {
  it('releases a student from tomorrow by default, with the version read, and shows the badge', async () => {
    let released = false;
    const calls = open(detailOf(), {
      [`GET /api/people/students/${STUDENT.id}`]: () =>
        json(released ? detailOf({ version: 2, branchMove: RELEASE }) : detailOf()),
      [`POST /api/people/students/${STUDENT.id}/branch-move`]: () => {
        released = true;
        return json(detailOf({ branchMove: RELEASE }));
      },
    });
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await within(panel).findByRole('button', { name: texts.move });
    const form = await edit(panel, texts.move, texts.move);
    const date = within(form).getByLabelText<HTMLInputElement>(texts.from);
    expect(date.value).toBe('2026-10-11');
    const branch = await within(form).findByLabelText<HTMLSelectElement>(texts.toBranch);
    expect([...branch.options].map((option) => option.textContent)).toEqual([
      en.people.students.choose,
      SOUTH.name,
    ]);
    fireEvent.change(branch, { target: { value: SOUTH.id } });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(released).toBe(true);
    });
    expect(calls.find((call) => call.route.endsWith('/branch-move'))?.body).toEqual({
      toBranchId: SOUTH.id,
      from: '2026-10-11',
      version: 2,
    });
    await savedInPanel(panel);
    expect(
      within(panel).getByText(
        texts.released
          .replace('{{branch}}', SOUTH.name)
          .replace('{{date}}', schoolDateText('2026-10-11', 'en')),
      ),
    ).toBeDefined();
  });

  it('cancels the open release through its confirmation, and offers no second release', async () => {
    const calls = open(detailOf({ branchMove: RELEASE }), {
      [`POST /api/people/branch-moves/${RELEASE.id}/cancel`]: () => json(detailOf()),
    });
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await waitFor(() => {
      expect(panelActionNames(panel)).toContain(texts.cancel);
    });
    expect(panelActionNames(panel)).not.toContain(texts.move);
    fireEvent.click(within(panel).getByRole('button', { name: texts.cancel }));
    const dialog = await screen.findByRole('alertdialog', { name: texts.cancelTitle });
    expect(within(dialog).getByText('Oʻtkir Rahimov')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: texts.cancel }));
    await waitFor(() => {
      expect(calls.some((call) => call.route.endsWith('/cancel'))).toBe(true);
    });
    await savedInPanel(panel);
  });

  it('reads the student again when the release was closed meanwhile, and keeps the refusal', async () => {
    let closed = false;
    const calls = open(detailOf({ branchMove: RELEASE }), {
      [`GET /api/people/students/${STUDENT.id}`]: () =>
        json(closed ? detailOf() : detailOf({ branchMove: RELEASE })),
      [`POST /api/people/branch-moves/${RELEASE.id}/cancel`]: () => {
        closed = true;
        return json(
          {
            error: {
              code: 'branch_move_closed',
              message: 'The release was cancelled, declined or accepted meanwhile.',
              requestId: 'r-1',
            },
          },
          409,
        );
      },
    });
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await waitFor(() => {
      expect(panelActionNames(panel)).toContain(texts.cancel);
    });
    const reads = () =>
      calls.filter((call) => call.route === `GET /api/people/students/${STUDENT.id}`).length;
    const before = reads();
    fireEvent.click(within(panel).getByRole('button', { name: texts.cancel }));
    const dialog = await screen.findByRole('alertdialog', { name: texts.cancelTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: texts.cancel }));
    await waitFor(() => {
      expect(reads()).toBeGreaterThan(before);
    });
    await waitFor(() => {
      expect(panelActionNames(panel)).not.toContain(texts.cancel);
    });
    expect(within(panel).getByText(en.errors.branch_move_closed)).toBeDefined();
  });

  it('shows the move into this branch in the Academic block', async () => {
    open(
      detailOf({
        lastBranchMove: { ...RELEASE, from: '2026-10-05', state: 'accepted' },
        canMoveBranch: false,
      }),
    );
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    expect(
      await within(panel).findByText(
        texts.arrived
          .replace('{{branch}}', NORTH.name)
          .replace('{{date}}', schoolDateText('2026-10-05', 'en')),
      ),
    ).toBeDefined();
    expect(panelActionNames(panel)).not.toContain(texts.move);
  });

  it('draws the move on the History tab with the class it joined', async () => {
    open(detailOf({ readsHistory: true, canMoveBranch: false }), {
      [`GET /api/people/students/${STUDENT.id}/history`]: () =>
        json({
          lines: [
            {
              kind: 'branch_move',
              move: { ...RELEASE, from: '2026-10-05', state: 'accepted' },
              toClass: YALE,
            },
            { kind: 'class', class: OXFORD, from: '2026-09-02', until: '2026-10-05' },
          ],
          today: '2026-10-10',
        }),
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
    expect(lines[0]).toContain(
      texts.lineClass
        .replace('{{from}}', NORTH.name)
        .replace('{{to}}', SOUTH.name)
        .replace('{{class}}', '7 Yale'),
    );
    expect(lines[0]).toContain(texts.states.accepted);
    expect(lines[1]).toContain(en.people.students.moves.classJoin.replace('{{class}}', '7 Oxford'));
  });

  it('lists the students released to the branch, with Accept off before the date', async () => {
    open(detailOf(), {}, { incoming: INCOMING });
    renderApp(PATH);
    const section = await screen.findByRole('region', {
      name: texts.incomingTitle_other.replace('{{count}}', '2'),
    });
    const first = within(section).getByRole('listitem', { name: 'Karimova Malika' });
    expect(within(first).getByRole('button', { name: texts.accept })).toHaveProperty(
      'disabled',
      false,
    );
    const second = within(section).getByRole('listitem', { name: 'Tursunov Jasur' });
    expect(within(second).getByRole('button', { name: texts.accept })).toHaveProperty(
      'disabled',
      true,
    );
    expect(
      within(second).getByText(
        texts.notYet.replace('{{date}}', schoolDateText('2026-10-12', 'en')),
      ),
    ).toBeDefined();
  });

  it('accepts into a class with a group chosen, asking the language first', async () => {
    const move = INCOMING.moves[0];
    if (move === undefined) {
      throw new Error('The fixture holds a release.');
    }
    const calls = open(
      detailOf(),
      {
        [`GET /api/people/branch-moves/${move.id}/groups`]: () =>
          json({
            subjects: [
              {
                subjectId: ENGLISH,
                groups: [
                  { id: uid(80), name: 'E-1', freeSeats: 3 },
                  { id: uid(81), name: 'E-2', freeSeats: 0 },
                ],
                suggested: uid(80),
              },
            ],
            freeSeats: 4,
          }),
        [`POST /api/people/branch-moves/${move.id}/accept`]: (body) =>
          (body as { confirmLanguage?: boolean }).confirmLanguage === true
            ? json(detailOf({ id: move.studentId }))
            : json(
                {
                  error: {
                    code: 'branch_move_language_differs',
                    message: 'The class left and the class chosen differ in language.',
                    requestId: 'r-1',
                  },
                },
                409,
              ),
      },
      { incoming: INCOMING },
    );
    renderApp(PATH);
    const section = await screen.findByRole('region', {
      name: texts.incomingTitle_other.replace('{{count}}', '2'),
    });
    const row = within(section).getByRole('listitem', { name: 'Karimova Malika' });
    fireEvent.click(within(row).getByRole('button', { name: texts.accept }));
    const classField = await within(row).findByLabelText<HTMLSelectElement>(texts.class);
    // The classes of the student's grade, in an open year.
    expect([...classField.options].map((option) => option.textContent)).toEqual([
      en.people.students.choose,
      '7 Yale',
      '7 Moskva',
      '7 Oxford',
    ]);
    fireEvent.change(classField, { target: { value: MOSCOW.id } });
    const group = await within(row).findByLabelText<HTMLSelectElement>('English');
    expect([...group.options].map((option) => [option.textContent, option.disabled])).toEqual([
      [texts.placeAutomatically, false],
      ['E-1 · 3 free seats', false],
      ['E-2 · 0 free seats', true],
    ]);
    fireEvent.change(group, { target: { value: uid(80) } });
    fireEvent.click(within(row).getByRole('button', { name: en.form.save }));
    // An accept cannot be undone: asked first, naming the student, the branch and the class.
    const sure = await screen.findByRole('alertdialog', { name: texts.acceptConfirmTitle });
    expect(within(sure).getByText('Karimova Malika')).toBeDefined();
    expect(
      within(sure).getByText(
        texts.acceptConfirmText.replace('{{branch}}', SOUTH.name).replace('{{class}}', '7 Moskva'),
      ),
    ).toBeDefined();
    fireEvent.click(within(sure).getByRole('button', { name: texts.accept }));
    const dialog = await screen.findByRole('alertdialog', { name: texts.languageTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: texts.accept }));
    await waitFor(() => {
      expect(calls.filter((call) => call.route.endsWith('/accept'))).toHaveLength(2);
    });
    expect(calls.filter((call) => call.route.endsWith('/accept'))[1]?.body).toEqual({
      classId: MOSCOW.id,
      groups: [{ subjectId: ENGLISH, groupId: uid(80) }],
      confirmLanguage: true,
    });
    expect(
      await within(section).findByText(
        texts.accepted.replace('{{name}}', 'Karimova Malika').replace('{{class}}', '7 Moskva'),
      ),
    ).toBeDefined();
  });

  it('sends nothing when the confirmation of an accept is declined', async () => {
    const move = INCOMING.moves[0];
    if (move === undefined) {
      throw new Error('The fixture holds a release.');
    }
    const calls = open(
      detailOf(),
      {
        [`GET /api/people/branch-moves/${move.id}/groups`]: () =>
          json({ subjects: [], freeSeats: 4 }),
      },
      { incoming: INCOMING },
    );
    renderApp(PATH);
    const section = await screen.findByRole('region', {
      name: texts.incomingTitle_other.replace('{{count}}', '2'),
    });
    const row = within(section).getByRole('listitem', { name: 'Karimova Malika' });
    fireEvent.click(within(row).getByRole('button', { name: texts.accept }));
    fireEvent.change(await within(row).findByLabelText(texts.class), {
      target: { value: YALE.id },
    });
    fireEvent.click(await within(row).findByRole('button', { name: en.form.save }));
    const sure = await screen.findByRole('alertdialog', { name: texts.acceptConfirmTitle });
    fireEvent.click(within(sure).getByRole('button', { name: en.confirm.cancel }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(calls.some((call) => call.route.endsWith('/accept'))).toBe(false);
  });

  it('declines a release with a reason, in Russian', async () => {
    const move = INCOMING.moves[0];
    if (move === undefined) {
      throw new Error('The fixture holds a release.');
    }
    const calls = open(
      detailOf(),
      {
        [`POST /api/people/branch-moves/${move.id}/decline`]: () =>
          json({ ...INCOMING, moves: INCOMING.moves.slice(1) }),
      },
      { incoming: INCOMING, language: 'ru' },
    );
    renderApp(PATH, 'ru');
    const rtexts = ru.people.students.branchMoves;
    const section = await screen.findByRole('region', {
      name: rtexts.incomingTitle_few.replace('{{count}}', '2'),
    });
    const row = within(section).getByRole('listitem', { name: 'Karimova Malika' });
    fireEvent.click(within(row).getByRole('button', { name: rtexts.decline }));
    const reason = await within(row).findByLabelText(ru.people.students.reason);
    fireEvent.change(reason, { target: { value: 'Нет мест в 7 классе' } });
    fireEvent.click(within(row).getByRole('button', { name: ru.form.save }));
    const sure = await screen.findByRole('alertdialog', { name: rtexts.declineConfirmTitle });
    fireEvent.click(within(sure).getByRole('button', { name: rtexts.decline }));
    await waitFor(() => {
      expect(calls.some((call) => call.route.endsWith('/decline'))).toBe(true);
    });
    expect(calls.find((call) => call.route.endsWith('/decline'))?.body).toEqual({
      reason: 'Нет мест в 7 классе',
    });
    expect(
      await screen.findByText(rtexts.declined.replace('{{name}}', 'Karimova Malika')),
    ).toBeDefined();
  });

  it('draws no incoming list for a role that does not read the branch moves', async () => {
    const calls = open(
      detailOf({ canMoveBranch: false }),
      {},
      { role: 'tutor', incoming: INCOMING },
    );
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.people.students.title });
    expect(screen.queryByRole('region', { name: /Released to this branch/ })).toBeNull();
    expect(calls.some((call) => call.route === 'GET /api/people/branch-moves/incoming')).toBe(
      false,
    );
  });
});
