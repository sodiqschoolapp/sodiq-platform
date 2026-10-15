import {
  type AcademicYear,
  type GroupDetail,
  type GroupMembers,
  type GroupPlacementBoard,
  type SchoolGroup,
  type StudentListItem,
} from '@sodiq/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { schoolDateText } from '@/lib/dates';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';
import { setWindowWidth } from '@/testing/window-width';

const uid = (n: number): string => `0199b000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const YEAR: AcademicYear = {
  id: uid(1),
  name: '2026–2027',
  startDate: '2026-09-01',
  endDate: '2027-05-31',
  status: 'current',
  quarters: [],
};

// All names are invented.
const OXFORD = { id: uid(101), grade: 7, name: 'Oxford', language: 'uz' as const, archived: false };
const PRINCETON = { ...OXFORD, id: uid(102), name: 'Princeton' };
const MATHS = {
  id: uid(201),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  languageRule: true,
};

const group = (n: number, fields: Partial<SchoolGroup> = {}): SchoolGroup => ({
  id: uid(300 + n),
  academicYearId: YEAR.id,
  yearName: YEAR.name,
  yearStatus: 'current',
  subject: MATHS,
  name: `7-M-${String(n)}`,
  language: 'uz',
  maxSize: 20,
  grades: [7],
  classes: [OXFORD, PRINCETON],
  kind: 'across',
  students: 2,
  archived: false,
  version: 0,
  ...fields,
});

const M1 = group(1);
const detailOf = (row: SchoolGroup): GroupDetail => ({ ...row, slots: null });

const member = (n: number, fields: Partial<GroupMembers['members'][number]> = {}) => ({
  id: uid(400 + n),
  studentId: uid(500 + n),
  uid: `260700${String(n)}`,
  firstName: 'Malika',
  lastName: `Rahimova${'a'.repeat(n)}`,
  class: { id: OXFORD.id, grade: 7, name: 'Oxford' },
  from: '2026-09-02',
  until: '2027-06-01',
  state: 'current' as const,
  review: false,
  ...fields,
});

const TAB: GroupMembers = {
  members: [member(1), member(2, { state: 'planned', from: '2026-10-12', review: true })],
  othersCount: 0,
  freeToday: 19,
  freeLeast: 18,
  today: '2026-10-10',
};

const pupil = (n: number, fields: Partial<StudentListItem> = {}): StudentListItem => ({
  id: uid(600 + n),
  uid: `26071${String(n).padStart(2, '0')}`,
  mergedUids: [],
  firstName: 'Shahlo',
  lastName: `Yusupova${'a'.repeat(n)}`,
  paternalName: null,
  sex: 'female',
  grade: 7,
  startsOn: '2026-09-02',
  photoId: null,
  consentMissing: null,
  status: 'active',
  planned: null,
  class: {
    id: OXFORD.id,
    grade: 7,
    name: 'Oxford',
    language: 'uz',
    from: '2026-09-02',
    until: '2027-06-01',
  },
  plannedClass: null,
  tutor: null,
  actingTutor: null,
  groups: [],
  version: 1,
  opens: true,
  ...fields,
});

const vice = (language: 'en' | 'ru' = 'en') => ({
  ...sessionOf({
    assignments: [{ role: 'academic_vice_principal', branchId: NORTH.id }],
    branches: [NORTH],
  }),
  language,
});

const tutor = () => ({
  ...sessionOf({ assignments: [{ role: 'tutor', branchId: NORTH.id }], branches: [NORTH] }),
  language: 'en' as 'en' | 'ru',
});

const studentsAnswer = (students: StudentListItem[]) =>
  json({
    students,
    canArchive: true,
    exportGroups: [],
    readsFinancial: false,
    today: '2026-10-10',
  });

/** The Groups list with the panel of 7-M-1 open on its Students tab. */
async function openGroup(
  options: {
    session?: ReturnType<typeof vice>;
    tab?: GroupMembers;
    students?: StudentListItem[];
    extra?: Record<string, (body: unknown) => Response>;
    language?: 'en' | 'ru';
  } = {},
) {
  setWindowWidth(1440);
  const calls = fakeApi({
    'GET /api/auth/session': () => json(options.session ?? vice(options.language)),
    'GET /api/groups': () => json({ groups: [M1] }),
    'GET /api/classes': () => json({ classes: [] }),
    'GET /api/setup/academic-years': () => json({ years: [YEAR] }),
    'GET /api/setup/subjects': () => json({ subjects: [], mayMoveDepartment: false }),
    [`GET /api/groups/${M1.id}`]: () => json(detailOf(M1)),
    [`GET /api/groups/${M1.id}/members`]: () => json(options.tab ?? TAB),
    'GET /api/people/students': () => studentsAnswer(options.students ?? []),
    ...options.extra,
  });
  renderApp(`/groups?open=${M1.id}`, options.language ?? 'en');
  const texts = options.language === 'ru' ? ru : en;
  const panel = await screen.findByRole('complementary', { name: M1.name });
  await within(panel).findByRole('heading', { name: texts.groups.members });
  return { calls, panel };
}

const section = (panel: HTMLElement, title: string) =>
  within(panel).getByRole('heading', { name: title }).closest('section') as HTMLElement;

// docs/spec/05-classes-groups-subjects.md, Group; edge/students-classes-groups
// ("Bulk placement ... tags them \"placed automatically, review\""; "Groups
// work the same way"); task 3.2b, pull request #92.
describe('the Students tab of a group', () => {
  it('lists the members with their class, the planned one and the review tag, and the free seats', async () => {
    const { panel } = await openGroup();
    const tab = section(panel, en.groups.members);
    const rows = [...tab.querySelectorAll('li')].map((row) => row.textContent);
    expect(rows[0]).toContain('Rahimovaa Malika');
    expect(rows[0]).toContain('7 Oxford');
    expect(rows[1]).toContain(
      en.groups.joinsOn.replace('{{date}}', schoolDateText('2026-10-12', 'en')),
    );
    expect(rows[1]).toContain(en.groups.review);
    expect(within(tab).getByText(/Free seats today: 19/)).toBeDefined();
  });

  it('marks a row reviewed and withdraws a planned one after asking', async () => {
    const { calls, panel } = await openGroup({
      extra: {
        [`POST /api/groups/${M1.id}/members/${uid(402)}/reviewed`]: () => json(TAB),
        [`POST /api/groups/${M1.id}/members/${uid(402)}/withdraw`]: () => json(TAB),
      },
    });
    const tab = section(panel, en.groups.members);
    fireEvent.click(within(tab).getByRole('button', { name: en.groups.markReviewed }));
    await waitFor(() => {
      expect(calls.some((call) => call.route.endsWith('/reviewed'))).toBe(true);
    });
    fireEvent.click(within(tab).getByRole('button', { name: en.groups.withdraw }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.groups.withdraw }));
    await waitFor(() => {
      expect(calls.some((call) => call.route.endsWith('/withdraw'))).toBe(true);
    });
  });

  it('puts the students of its classes not yet in a group of the subject into it', async () => {
    const free = pupil(1);
    const placedElsewhere = pupil(2, {
      groups: [
        {
          id: uid(399),
          membershipId: uid(395),
          name: '7-M-9',
          subjectId: MATHS.id,
          from: '2026-09-02',
          state: 'current',
          review: false,
        },
      ],
    });
    const otherClass = pupil(3, {
      class: {
        id: uid(109),
        grade: 7,
        name: 'Yale',
        language: 'uz',
        from: '2026-09-02',
        until: '2027-06-01',
      },
    });
    const { calls, panel } = await openGroup({
      students: [free, placedElsewhere, otherClass],
      extra: { [`POST /api/groups/${M1.id}/members`]: () => json(TAB, 201) },
    });
    fireEvent.click(within(panel).getByRole('button', { name: en.groups.putIntoGroup }));
    const label = en.groups.putIntoNamed.replace('{{group}}', M1.name);
    const form = await within(panel).findByRole('form', { name: label });
    const boxes = await within(form).findAllByRole('checkbox');
    expect(boxes).toHaveLength(1);
    fireEvent.click(boxes[0] as HTMLElement);
    fireEvent.change(within(form).getByLabelText(en.groups.from), {
      target: { value: '2026-10-12' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `POST /api/groups/${M1.id}/members`)?.body,
      ).toEqual({ students: [{ id: free.id }], from: '2026-10-12' });
    });
  });

  it('shows a Tutor the members of own classes and how many others, without placing', async () => {
    const { panel } = await openGroup({
      session: tutor(),
      tab: { ...TAB, members: [member(1)], othersCount: 3 },
    });
    const tab = section(panel, en.groups.members);
    expect(within(tab).getByText(en.groups.others_other.replace('{{n}}', '3'))).toBeDefined();
    expect(within(panel).queryByRole('button', { name: en.groups.putIntoGroup })).toBeNull();
  });

  it('counts the others in Russian with the plural of the number', async () => {
    const { panel } = await openGroup({
      language: 'ru',
      session: { ...tutor(), language: 'ru' },
      tab: { ...TAB, members: [member(1)], othersCount: 5 },
    });
    const tab = section(panel, ru.groups.members);
    expect(within(tab).getByText(ru.groups.others_many.replace('{{n}}', '5'))).toBeDefined();
  });
});

const BOARD: GroupPlacementBoard = {
  groups: [
    {
      id: M1.id,
      name: M1.name,
      language: 'uz',
      classes: [
        { id: OXFORD.id, grade: 7, name: 'Oxford' },
        { id: PRINCETON.id, grade: 7, name: 'Princeton' },
      ],
      maxSize: 20,
      members: 2,
      free: 18,
    },
  ],
  unplaced: [
    {
      id: uid(701),
      uid: '2607101',
      firstName: 'Aziza',
      lastName: 'Qodirova',
      class: { id: OXFORD.id, grade: 7, name: 'Oxford' },
      classFrom: '2026-09-02',
    },
    {
      id: uid(702),
      uid: '2607102',
      firstName: 'Bobur',
      lastName: 'Toshmatov',
      class: { id: PRINCETON.id, grade: 7, name: 'Princeton' },
      classFrom: '2026-09-02',
    },
  ],
  today: '2026-10-10',
};

/** The placement screen with maths and grade 7 chosen. */
async function openPlacement(
  board: GroupPlacementBoard = BOARD,
  extra: Record<string, (body: unknown) => Response> = {},
) {
  setWindowWidth(1440);
  const calls = fakeApi({
    'GET /api/auth/session': () => json(vice()),
    'GET /api/groups': () => json({ groups: [M1] }),
    'GET /api/people/students': () => studentsAnswer([]),
    'GET /api/groups/placement': () => json(board),
    ...extra,
  });
  renderApp('/groups/placement');
  await screen.findByRole('heading', { name: en.groups.placement.title, level: 1 });
  fireEvent.change(await screen.findByLabelText(en.groups.placement.subject), {
    target: { value: MATHS.id },
  });
  fireEvent.change(screen.getByLabelText(en.groups.placement.grades), { target: { value: '7' } });
  return calls;
}

// `05`: "A bulk screen places students ... into groups for one subject and
// one grade, or one pair of grades, at a time"; decision 14, corrections 1 and 2.
describe('the bulk placement screen', () => {
  it('reads the screen of the subject, grades and date, with the groups beside the list', async () => {
    const calls = await openPlacement();
    await waitFor(() => {
      expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
    });
    expect(calls.find((call) => call.route === 'GET /api/groups/placement')?.query).toBe(
      `?subjectId=${MATHS.id}&grades=7&on=2026-10-10`,
    );
    const groups = screen
      .getByRole('heading', { name: en.groups.placement.groups })
      .closest('section');
    expect(groups?.textContent).toContain('7-M-1');
    expect(groups?.textContent).toContain('2 of 20 · fewest free seats 18');
  });

  it('puts the ticked students into a chosen group from the date', async () => {
    const calls = await openPlacement(BOARD, {
      [`POST /api/groups/${M1.id}/members`]: () => json(TAB, 201),
    });
    await waitFor(() => {
      expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
    });
    const [first] = screen.getAllByRole('checkbox').slice(1);
    fireEvent.click(first as HTMLElement);
    const action = en.groups.placement.putInto.replace('{{group}}', M1.name);
    fireEvent.click(await screen.findByRole('button', { name: action }));
    // A placement that has begun is changed by a transfer: the action asks first.
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Qodirova Aziza');
    fireEvent.click(within(dialog).getByRole('button', { name: action }));
    expect(await screen.findByText(en.groups.placed_one.replace('{{n}}', '1'))).toBeDefined();
    expect(calls.find((call) => call.route === `POST /api/groups/${M1.id}/members`)?.body).toEqual({
      students: [{ id: uid(701) }],
      from: '2026-10-10',
    });
  });

  it('places every student automatically after asking, and says how many', async () => {
    const calls = await openPlacement(BOARD, {
      'POST /api/groups/placement/automatic': () =>
        json(
          {
            placed: [
              { studentId: uid(701), groupId: M1.id },
              { studentId: uid(702), groupId: M1.id },
            ],
          },
          201,
        ),
    });
    fireEvent.click(await screen.findByRole('button', { name: en.groups.placement.automatic }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Qodirova Aziza');
    fireEvent.click(within(dialog).getByRole('button', { name: en.groups.placement.automatic }));
    expect(
      await screen.findByText(en.groups.placement.placedAutomatically_other.replace('{{n}}', '2')),
    ).toBeDefined();
    expect(
      calls.find((call) => call.route === 'POST /api/groups/placement/automatic')?.body,
    ).toEqual({ subjectId: MATHS.id, grades: [7], from: '2026-10-10' });
  });

  it('names the students no group has a seat for, from the details of the refusal', async () => {
    await openPlacement(BOARD, {
      'POST /api/groups/placement/automatic': () =>
        Response.json(
          {
            error: {
              code: 'placement_no_seat',
              message: 'ENGLISH TEXT FOR THE DEVELOPER',
              requestId: 'test-request',
              details: [
                {
                  path: 'students',
                  code: 'placement_no_seat',
                  message: 'x',
                  recordId: uid(702),
                },
              ],
            },
          },
          { status: 409 },
        ),
    });
    fireEvent.click(await screen.findByRole('button', { name: en.groups.placement.automatic }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.groups.placement.automatic }));
    expect(await screen.findByText(en.errors.placement_no_seat)).toBeDefined();
    expect(
      screen.getByText(en.groups.refusedNames.replace('{{names}}', 'Toshmatov Bobur')),
    ).toBeDefined();
  });

  it('draws the screen in Russian', async () => {
    setWindowWidth(1440);
    fakeApi({
      'GET /api/auth/session': () => json(vice('ru')),
      'GET /api/groups': () => json({ groups: [M1] }),
      'GET /api/people/students': () => studentsAnswer([]),
      'GET /api/groups/placement': () => json(BOARD),
    });
    renderApp('/groups/placement', 'ru');
    await screen.findByRole('heading', { name: ru.groups.placement.title, level: 1 });
    expect(await screen.findByLabelText(ru.groups.placement.subject)).toBeDefined();
    expect(
      await screen.findByRole('button', { name: ru.groups.placement.automatic }),
    ).toBeDefined();
    const groups = screen
      .getByRole('heading', { name: ru.groups.placement.groups })
      .closest('section');
    expect(groups?.textContent).toContain('2 из 20');
  });

  it('says when everyone is placed', async () => {
    await openPlacement({ ...BOARD, unplaced: [] });
    expect(await screen.findByText(en.groups.placement.emptyTitle)).toBeDefined();
    expect(screen.queryByRole('button', { name: en.groups.placement.automatic })).toBeNull();
  });

  it('says what a group is for when the branch has none', async () => {
    setWindowWidth(1440);
    fakeApi({
      'GET /api/auth/session': () => json(vice()),
      'GET /api/groups': () => json({ groups: [] }),
      'GET /api/people/students': () => studentsAnswer([]),
    });
    renderApp('/groups/placement');
    expect(await screen.findByText(en.groups.empty)).toBeDefined();
    cleanup();
  });
});

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

// `04`, Student list: "class ..., groups, tutor"; "Filters: grade, class,
// group"; "Bulk actions on ticked rows: put into a class, put into a group".
describe('the groups of the student list', () => {
  const inGroup = pupil(1, {
    groups: [
      {
        id: M1.id,
        membershipId: uid(397),
        name: '7-M-1',
        subjectId: MATHS.id,
        from: '2026-09-02',
        state: 'current',
        review: false,
      },
      {
        id: uid(398),
        membershipId: uid(396),
        name: '7-E-2',
        subjectId: uid(202),
        from: '2026-11-02',
        state: 'planned',
        review: true,
      },
    ],
  });
  const without = pupil(2);

  function openStudents(extra: Record<string, (body: unknown) => Response> = {}) {
    setWindowWidth(1440);
    return fakeApi({
      'GET /api/auth/session': () => json(vice()),
      'GET /api/people/students': () => studentsAnswer([inGroup, without]),
      'GET /api/classes': () => json({ classes: [] }),
      'GET /api/setup/academic-years': () => json({ years: [YEAR] }),
      'GET /api/groups': () => json({ groups: [M1, group(3, { classes: [PRINCETON] })] }),
      ...extra,
    });
  }

  it('shows the groups of each row, a planned one with its first day', async () => {
    openStudents();
    renderApp('/people/students');
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    const headers = [...document.querySelectorAll('thead th')].map((cell) => cell.textContent);
    const column = headers.indexOf(en.people.students.groups);
    const cells = rowsDrawn().map((row) => row[column]);
    expect(cells).toContain(
      `7-M-1, ${en.people.students.groupFrom.replace('{{group}}', '7-E-2').replace('{{date}}', schoolDateText('2026-11-02', 'en'))}`,
    );
    expect(cells).toContain('—');
  });

  it('filters the list by a group the rows name', async () => {
    openStudents();
    renderApp('/people/students');
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    const filter = await screen.findByLabelText(en.people.students.groups, { selector: 'select' });
    expect([...filter.querySelectorAll('option')].map((option) => option.textContent)).toContain(
      '7-E-2',
    );
    fireEvent.change(filter, { target: { value: M1.id } });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
  });

  it('offers the groups that draw from the class of the ticked students', async () => {
    const calls = openStudents({ [`POST /api/groups/${M1.id}/members`]: () => json(TAB, 201) });
    renderApp('/people/students');
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    const boxes = screen.getAllByRole('checkbox').slice(1);
    fireEvent.click(boxes[1] as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: en.groups.putIntoGroup }));
    const title = en.groups.placeTitle_one.replace('{{n}}', '1');
    const form = await within(await screen.findByRole('complementary', { name: title })).findByRole(
      'form',
      { name: title },
    );
    const choice = within(form).getByLabelText<HTMLSelectElement>(en.groups.columns.name);
    // 7-M-3 draws from Princeton only: not offered for a student of Oxford.
    expect([...choice.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      en.groups.chooseGroup,
      '7-M-1 · Mathematics',
    ]);
    fireEvent.change(choice, { target: { value: M1.id } });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(await screen.findByText(en.groups.placed_one.replace('{{n}}', '1'))).toBeDefined();
    expect(calls.find((call) => call.route === `POST /api/groups/${M1.id}/members`)?.body).toEqual({
      students: [{ id: without.id }],
      from: '2026-10-10',
    });
  });
});
