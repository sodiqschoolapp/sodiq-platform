import type {
  AcademicYear,
  Load,
  LoadRow,
  LoadTeachers,
  LoadTotals,
  Room,
  SchoolClass,
  SchoolGroup,
  Subject,
  TimetableVersion,
  WithdrawCheck,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';
import { setWindowWidth } from '@/testing/window-width';

const PATH = '/timetable/load';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const YEAR: AcademicYear = {
  id: uid(1),
  name: '2026–2027',
  startDate: '2026-09-01',
  endDate: '2027-05-31',
  status: 'current',
  quarters: [],
};

// All names are invented.
const OXFORD: SchoolClass = {
  id: uid(101),
  academicYearId: YEAR.id,
  yearName: YEAR.name,
  yearStatus: 'current',
  grade: 7,
  name: 'Oxford',
  language: 'uz',
  mainRoom: null,
  maxSize: 25,
  students: 0,
  tutor: null,
  acting: null,
  archived: false,
  version: 0,
};

const subject = (n: number, fields: Partial<Subject> = {}): Subject => ({
  departmentSince: null,
  departmentMove: null,
  id: uid(200 + n),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  departmentId: uid(9),
  grades: [7, 8],
  colour: 'blue',
  journalType: 'graded',
  ratingExam: false,
  groupSubject: false,
  languageRule: true,
  demanding: false,
  archivedAt: null,
  daily: { attendance: 10, classwork: 50, homework: 40 },
  quarterWeightsMissing: 0,
  quarterCount: 4,
  ...fields,
});

const MATHS = subject(1);
const SPIRITUAL = subject(2, {
  names: { uz: 'Maʼnaviyat soati', ru: 'Час духовности', en: 'Spiritual hour' },
  grades: [5, 6, 7, 8, 9, 10, 11],
});

const LAB: Room = {
  id: uid(400),
  name: 'Lab 1',
  floorId: uid(401),
  floorName: 'First',
  buildingId: uid(402),
  buildingName: 'Main',
  type: 'laboratory',
  capacity: 30,
  status: 'in_use',
  shared: false,
  maxSimultaneousLessons: null,
};

const version = (n: number, fields: Partial<TimetableVersion> = {}): TimetableVersion => ({
  id: uid(500 + n),
  academicYearId: YEAR.id,
  yearName: YEAR.name,
  yearStatus: 'current',
  number: n,
  status: 'draft',
  startsOn: '2026-10-19',
  fromVersion: null,
  rows: 0,
  leftRows: 0,
  outOfDate: false,
  editLock: null,
  ...fields,
});

const TEACHER = { id: uid(600), kind: 'person' as const, name: 'Karimova Aziza' };
const TUTOR = { id: uid(601), kind: 'person' as const, name: 'Nazarova Lola' };

const row = (n: number, fields: Partial<LoadRow> = {}): LoadRow => ({
  id: uid(700 + n),
  unit: {
    kind: 'class',
    id: OXFORD.id,
    name: 'Oxford',
    grades: [7],
    language: 'uz',
    archived: false,
  },
  subject: { id: MATHS.id, names: MATHS.names },
  teacher: TEACHER,
  lessonsPerWeek: 4,
  room: null,
  roomType: null,
  doubleLessons: false,
  mixedBlock: false,
  shortReason: null,
  block: [],
  unplaced: 0,
  problems: [],
  ...fields,
});

const vice = () =>
  sessionOf({
    assignments: [{ role: 'academic_vice_principal', branchId: NORTH.id }],
    branches: [NORTH],
  });

const principal = () =>
  sessionOf({ assignments: [{ role: 'principal', branchId: NORTH.id }], branches: [NORTH] });

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((one) =>
    [...one.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

const type = (input: HTMLElement, value: string): void => {
  fireEvent.change(input, { target: { value } });
};

async function openPage(
  options: {
    session?: ReturnType<typeof sessionOf>;
    versions?: TimetableVersion[];
    load?: Partial<Load>;
    teachers?: (query: string) => LoadTeachers;
    extra?: Record<string, (body: unknown) => Response>;
    language?: 'en' | 'ru';
    totals?: LoadTotals;
  } = {},
) {
  const session = { ...(options.session ?? vice()), language: options.language ?? 'en' };
  const versions = options.versions ?? [version(1)];
  const calls = fakeApi({
    'GET /api/auth/session': () => json(session),
    'GET /api/timetable/versions': () => json({ versions, today: '2026-10-10' }),
    ...Object.fromEntries(
      versions.map((one) => [
        `GET /api/timetable/versions/${one.id}/load`,
        () => json({ version: one, rows: [], leftRows: [], ...options.load }),
      ]),
    ),
    ...Object.fromEntries(
      versions.map((one) => [
        `GET /api/timetable/versions/${one.id}/totals`,
        () => json(options.totals ?? { classes: [], teachers: [] }),
      ]),
    ),
    'GET /api/classes': () => json({ classes: [OXFORD] }),
    'GET /api/groups': () => json({ groups: [] }),
    'GET /api/setup/academic-years': () => json({ years: [YEAR] }),
    'GET /api/setup/subjects': () =>
      json({ subjects: [MATHS, SPIRITUAL], mayMoveDepartment: false }),
    'GET /api/setup/rooms': () => json({ rooms: [LAB] }),
    ...Object.fromEntries(
      versions.map((one) => [
        `GET /api/timetable/versions/${one.id}/load/teachers`,
        () =>
          json(
            options.teachers?.('') ?? {
              teachers: [],
              tutorRow: false,
              defaultTeacherId: null,
              excluded: [],
              noTutor: false,
            },
          ),
      ]),
    ),
    ...options.extra,
  });
  renderApp(PATH, options.language ?? 'en');
  await screen.findByRole('heading', {
    name: options.language === 'ru' ? ru.timetable.load.title : en.timetable.load.title,
  });
  return calls;
}

async function openNewRow() {
  await waitFor(() => {
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: en.timetable.load.add }).disabled,
    ).toBe(false);
  });
  fireEvent.click(screen.getByRole('button', { name: en.timetable.load.add }));
  return within(
    await screen.findByRole('complementary', { name: en.timetable.load.newRow }),
  ).getByRole('form', { name: en.timetable.load.newRow });
}

// docs/spec/05-classes-groups-subjects.md, Teaching load; 06-timetable.md,
// Building a timetable; edge-cases/timetable.md, Versions and drafts; task
// 3.4a, pull request #99.
describe('the teaching load page', () => {
  it('lists the rows of the version with the problems each has today (decision 3)', async () => {
    setWindowWidth(1440);
    await openPage({
      load: {
        rows: [
          row(1),
          row(2, {
            subject: { id: SPIRITUAL.id, names: SPIRITUAL.names },
            teacher: { id: uid(602), kind: 'vacancy', name: 'Teacher wanted' },
            roomType: 'laboratory',
            doubleLessons: true,
            problems: ['load_teacher_status'],
          }),
        ],
      },
    });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    expect(rowsDrawn()).toEqual([
      ['7 Oxford', '—', 'Mathematics', 'Karimova Aziza', '4', 'No special room', 'No', 'None'],
      [
        '7 Oxford',
        '—',
        'Spiritual hour',
        'Teacher wanted (vacancy)',
        '4',
        'Any Laboratory',
        'Yes',
        'Teacher out on the start date',
      ],
    ]);
    const picker = screen.getByLabelText<HTMLSelectElement>(en.timetable.load.version);
    expect(picker.selectedOptions[0]?.textContent).toBe('Version 1, 2026–2027: Draft');
  });

  it('names the columns in Russian when Russian is chosen', async () => {
    setWindowWidth(1440);
    await openPage({ language: 'ru', load: { rows: [row(1)] } });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    const headers = [...document.querySelectorAll('thead th')].map((cell) => cell.textContent);
    expect(headers).toEqual(
      expect.arrayContaining([ru.timetable.load.columns.unit, ru.timetable.load.columns.problems]),
    );
    expect(rowsDrawn()[0]?.[2]).toBe('Математика');
  });

  it('starts the first draft on next Monday by default (decision 5)', async () => {
    const calls = await openPage({
      versions: [],
      extra: { 'POST /api/timetable/versions': () => json(version(1), 201) },
    });
    expect(await screen.findByText(en.timetable.load.noVersion)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.timetable.load.newDraft }));
    const form = await screen.findByRole('form', { name: en.timetable.load.newDraftTitle });
    expect(within(form).getByLabelText<HTMLInputElement>(en.timetable.load.startsOn).value).toBe(
      '2026-10-12',
    );
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.find((call) => call.route === 'POST /api/timetable/versions')?.body).toEqual({
        academicYearId: YEAR.id,
        startsOn: '2026-10-12',
        copyFrom: null,
      });
    });
  });

  it('offers a copy of a version of the same year', async () => {
    await openPage({ versions: [version(1)] });
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: en.timetable.load.newDraft })
          .disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: en.timetable.load.newDraft }));
    const form = await screen.findByRole('form', { name: en.timetable.load.newDraftTitle });
    const copy = within(form).getByLabelText<HTMLSelectElement>(en.timetable.load.copyFrom);
    expect([...copy.options].map((option) => option.textContent)).toEqual([
      en.timetable.load.startEmpty,
      'Copy of version 1',
    ]);
  });

  // Spec review of the build, should-fix 1: what the field shows is what is sent.
  it('sends no copy once the year chosen has no version to copy', async () => {
    const planned: AcademicYear = {
      ...YEAR,
      id: uid(2),
      name: '2027–2028',
      startDate: '2027-09-01',
      endDate: '2028-05-31',
      status: 'planned',
    };
    const calls = await openPage({
      versions: [version(1)],
      extra: {
        'GET /api/setup/academic-years': () => json({ years: [YEAR, planned] }),
        'POST /api/timetable/versions': () => json(version(2), 201),
      },
    });
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: en.timetable.load.newDraft })
          .disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: en.timetable.load.newDraft }));
    const form = await screen.findByRole('form', { name: en.timetable.load.newDraftTitle });
    type(within(form).getByLabelText(en.timetable.load.copyFrom), version(1).id);
    type(within(form).getByLabelText(en.timetable.load.year), planned.id);
    type(within(form).getByLabelText(en.timetable.load.startsOn), '2027-09-06');
    expect(within(form).getByLabelText<HTMLSelectElement>(en.timetable.load.copyFrom).value).toBe(
      '',
    );
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.find((call) => call.route === 'POST /api/timetable/versions')?.body).toEqual({
        academicYearId: planned.id,
        startsOn: '2027-09-06',
        copyFrom: null,
      });
    });
  });

  it('adds a row with a teacher the server offers', async () => {
    const calls = await openPage({
      teachers: () => ({
        teachers: [{ ...TEACHER, tutor: false }],
        tutorRow: false,
        defaultTeacherId: null,
        excluded: [],
        noTutor: false,
      }),
      extra: {
        [`POST /api/timetable/versions/${version(1).id}/load`]: () => json(row(1), 201),
      },
    });
    const form = await openNewRow();
    type(within(form).getByLabelText(en.timetable.load.unit), `class:${OXFORD.id}`);
    type(within(form).getByLabelText(en.timetable.load.subject), MATHS.id);
    const teacher = await within(form).findByLabelText<HTMLSelectElement>(
      en.timetable.load.teacher,
    );
    await waitFor(() => {
      expect([...teacher.options].map((option) => option.textContent)).toEqual([
        en.timetable.load.chooseTeacher,
        'Karimova Aziza',
      ]);
    });
    // No teacher is chosen for an ordinary subject (correction 1).
    expect(teacher.value).toBe('');
    type(teacher, TEACHER.id);
    type(within(form).getByLabelText(en.timetable.load.lessons), '4');
    type(within(form).getByLabelText(en.timetable.load.room), `room:${LAB.id}`);
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `POST /api/timetable/versions/${version(1).id}/load`)
          ?.body,
      ).toEqual({
        classId: OXFORD.id,
        groupId: null,
        subjectId: MATHS.id,
        teacherId: TEACHER.id,
        lessonsPerWeek: 4,
        roomId: LAB.id,
        roomType: null,
        doubleLessons: false,
        // Task 5.5a-1: a new row is not marked deliberately short.
        shortReason: null,
        mixedBlock: false,
      });
    });
  });

  // 3.4a correction 1 as narrowed by task 3.6c-2 (decision 1, review
  // correction 1): a Tutor row has no teacher to choose; the form names the
  // class's Tutor and sends no teacher, and the server writes the Tutor.
  it('names the class Tutor of a Tutor row and sends no teacher (task 3.6c-2)', async () => {
    const calls = await openPage({
      teachers: () => ({
        tutorRow: true,
        teachers: [{ ...TUTOR, tutor: true }],
        defaultTeacherId: TUTOR.id,
        excluded: [],
        noTutor: false,
      }),
      extra: {
        [`POST /api/timetable/versions/${version(1).id}/load`]: () => json(row(1), 201),
      },
    });
    const form = await openNewRow();
    type(within(form).getByLabelText(en.timetable.load.unit), `class:${OXFORD.id}`);
    type(within(form).getByLabelText(en.timetable.load.subject), SPIRITUAL.id);
    const line = await waitFor(() => {
      const found = form.querySelector('[data-tutor-row]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(line?.textContent).toBe(
      en.timetable.load.tutorRowTeacher.replace('{{name}}', 'Nazarova Lola'),
    );
    expect(within(form).queryByLabelText(en.timetable.load.teacher)).toBeNull();
    type(within(form).getByLabelText(en.timetable.load.lessons), '1');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `POST /api/timetable/versions/${version(1).id}/load`)
          ?.body,
      ).toMatchObject({ classId: OXFORD.id, subjectId: SPIRITUAL.id, teacherId: null });
    });
  });

  it('says that a Tutor row has nobody while the class has no Tutor', async () => {
    await openPage({
      teachers: () => ({
        tutorRow: true,
        teachers: [],
        defaultTeacherId: null,
        excluded: [],
        noTutor: true,
      }),
    });
    const form = await openNewRow();
    type(within(form).getByLabelText(en.timetable.load.unit), `class:${OXFORD.id}`);
    type(within(form).getByLabelText(en.timetable.load.subject), SPIRITUAL.id);
    const line = await waitFor(() => {
      const found = form.querySelector('[data-tutor-row]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(line?.textContent).toBe(
      en.timetable.load.noTutorTeacher.replace('{{subject}}', SPIRITUAL.names.en),
    );
  });

  // Task 3.5b, H30 of issue #105: why no teacher can take the row.
  it("names a subject in nobody's profile with a link to Staff", async () => {
    await openPage({
      teachers: () => ({
        tutorRow: false,
        teachers: [],
        defaultTeacherId: null,
        excluded: [],
        noTutor: false,
      }),
    });
    const form = await openNewRow();
    type(within(form).getByLabelText(en.timetable.load.unit), `class:${OXFORD.id}`);
    type(within(form).getByLabelText(en.timetable.load.subject), MATHS.id);
    const line = await within(form).findByText((text) =>
      text.startsWith(en.timetable.load.noSubjectTeacher.replace('{{subject}}', MATHS.names.en)),
    );
    expect(within(line).getByRole('link', { name: en.timetable.load.openStaff })).toBeDefined();
  });

  it('gives the reason of each teacher with the subject who cannot take the row', async () => {
    await openPage({
      teachers: () => ({
        teachers: [],
        tutorRow: false,
        defaultTeacherId: null,
        excluded: [
          { ...TEACHER, reason: 'grade', blockGroup: null },
          {
            ...TUTOR,
            kind: 'vacancy',
            name: 'English vacancy 1',
            reason: 'block',
            blockGroup: '7-E-1',
          },
        ],
        noTutor: false,
      }),
    });
    const form = await openNewRow();
    type(within(form).getByLabelText(en.timetable.load.unit), `class:${OXFORD.id}`);
    type(within(form).getByLabelText(en.timetable.load.subject), MATHS.id);
    const items = await waitFor(() => {
      const found = [...form.querySelectorAll('li')].map((one) => one.textContent);
      expect(found).toHaveLength(2);
      return found;
    });
    expect(items).toEqual([
      en.timetable.load.whyGrade
        .replace('{{teacher}}', 'Karimova Aziza')
        .replace('{{grades}}', '7'),
      en.timetable.load.whyBlock
        .replace(
          '{{teacher}}',
          en.timetable.load.vacancyOption.replace('{{name}}', 'English vacancy 1'),
        )
        .replace('{{group}}', '7-E-1'),
    ]);
  });

  it('says what the refusal of the server means', async () => {
    await openPage({
      teachers: () => ({
        teachers: [{ ...TEACHER, tutor: false }],
        tutorRow: false,
        defaultTeacherId: null,
        excluded: [],
        noTutor: false,
      }),
      extra: {
        [`POST /api/timetable/versions/${version(1).id}/load`]: () =>
          refusal('load_teacher_grade', 409),
      },
    });
    const form = await openNewRow();
    type(within(form).getByLabelText(en.timetable.load.unit), `class:${OXFORD.id}`);
    type(within(form).getByLabelText(en.timetable.load.subject), MATHS.id);
    const teacher = await within(form).findByLabelText<HTMLSelectElement>(
      en.timetable.load.teacher,
    );
    await waitFor(() => {
      expect(teacher.options).toHaveLength(2);
    });
    type(teacher, TEACHER.id);
    type(within(form).getByLabelText(en.timetable.load.lessons), '4');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(await within(form).findByText(en.errors.load_teacher_grade)).not.toBeNull();
  });

  it('shows the rows a copy left with their reasons, and dismisses them (decision 10)', async () => {
    const copy = version(2, { fromVersion: { id: uid(501), number: 1 }, leftRows: 1 });
    const calls = await openPage({
      versions: [copy, version(1)],
      load: {
        leftRows: [row(9, { problems: ['load_teacher_language'] })],
      },
      extra: {
        [`PATCH /api/timetable/versions/${copy.id}`]: () => json({ ...copy, leftRows: 0 }),
      },
    });
    const left = await screen.findByRole('region', { name: en.timetable.load.leftTitle });
    expect(within(left).getByText('Language of instruction')).not.toBeNull();
    expect(screen.getByText('Copied from version 1')).not.toBeNull();
    fireEvent.click(within(left).getByRole('button', { name: en.timetable.load.dismiss }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.load.dismiss }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `PATCH /api/timetable/versions/${copy.id}`)?.body,
      ).toEqual({ dismissLeftRows: true });
    });
  });

  it('lets the Principal read and change nothing (decision 4)', async () => {
    setWindowWidth(1440);
    const calls = await openPage({ session: principal(), load: { rows: [row(1)] } });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    expect(screen.queryByRole('button', { name: en.timetable.load.newDraft })).toBeNull();
    expect(screen.queryByRole('button', { name: en.timetable.load.add })).toBeNull();
    expect(screen.queryByRole('button', { name: en.timetable.load.changeStart })).toBeNull();
    // The lists of the forms are read only by those who change the load.
    expect(calls.some((call) => call.route === 'GET /api/classes')).toBe(false);
  });

  it('names who edits the draft and offers no change while another person does (task 5.4c-1)', async () => {
    setWindowWidth(1440);
    await openPage({
      versions: [
        version(1, {
          editLock: {
            holder: { id: uid(1901), name: 'Tosheva Malika' },
            seenAt: '2026-10-10T18:50:00Z',
            mine: false,
          },
        }),
      ],
      load: { rows: [row(1)] },
    });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    const banner = document.querySelector<HTMLElement>('[data-edit-lock]');
    expect(banner?.textContent).toContain('Tosheva Malika');
    expect(screen.queryByRole('button', { name: en.timetable.load.add })).toBeNull();
    expect(screen.queryByRole('button', { name: en.timetable.load.changeStart })).toBeNull();
  });

  it('reads a published version without offering a change', async () => {
    await openPage({ versions: [version(1, { status: 'published' })], load: { rows: [row(1)] } });
    expect(await screen.findByText(en.timetable.load.readOnly)).not.toBeNull();
    expect(screen.queryByRole('button', { name: en.timetable.load.add })).toBeNull();
  });
});

// Task 5.5c-2a, pull request #156 (06, How surprises are prevented: "Withdraw.
// A published version can be withdrawn only before its start date.").
describe('the teaching load page: withdraw', () => {
  const earlier = version(1, { status: 'published', startsOn: '2026-09-01' });
  const later = version(2, { status: 'published', startsOn: '2026-11-09' });
  const KEY = 'a'.repeat(64);
  /** The withdraw check of `later` (task 5.6a-5b-2), with nothing stored unless given. */
  const checkAnswer = (dayChanges: Partial<WithdrawCheck['dayChanges']> = {}) =>
    json({
      runsAgain: { id: earlier.id, number: 1 },
      runsAgainUntil: '2027-05-31',
      dayChanges: { key: KEY, kept: [], decide: [], dropped: [], bulk: [], ...dayChanges },
      names: {
        units: [{ id: OXFORD.id, kind: 'class', name: 'Oxford', grades: [7] }],
        subjects: [{ id: MATHS.id, names: MATHS.names }],
        teachers: [],
        rooms: [],
      },
    } satisfies WithdrawCheck);
  const checkRoute = (dayChanges: Partial<WithdrawCheck['dayChanges']> = {}) => ({
    [`GET /api/timetable/versions/${later.id}/withdraw-check`]: () => checkAnswer(dayChanges),
  });
  /** A one-day move of Oxford's maths stored for a withdrawn date. */
  const moveItem = (key: string) => ({
    key,
    kind: 'move' as const,
    unitId: OXFORD.id,
    subjectId: MATHS.id,
    from: { date: '2026-11-16', start: 480, end: 525, roomId: null },
    to: { date: '2026-11-18', start: 535, end: 580, roomId: null },
    reason: 'Excursion to the museum',
    carriedVersionId: null,
    blocked: [],
  });

  it('withdraws a published version before its start, naming the version that runs again', async () => {
    const calls = await openPage({
      versions: [later, earlier],
      extra: {
        ...checkRoute(),
        [`POST /api/timetable/versions/${later.id}/withdraw`]: () =>
          json({ ...later, status: 'archived' }),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.load.withdraw }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Withdraw version 2?')).not.toBeNull();
    expect(
      within(dialog).getByText(
        'It is withdrawn before it starts on 9 November 2026. Version 1 runs again over its dates.',
      ),
    ).not.toBeNull();
    const send = within(dialog).getByRole('button', { name: en.timetable.load.withdraw });
    // The check is read first: the button waits for it.
    await waitFor(() => {
      expect((send as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(send);
    await waitFor(() => {
      expect(
        calls.filter((call) => call.route === `POST /api/timetable/versions/${later.id}/withdraw`),
      ).toHaveLength(1);
    });
    // Task 5.6a-5b-2: with the key of the sorting shown, nothing to decide.
    expect(
      calls.find((call) => call.route === `POST /api/timetable/versions/${later.id}/withdraw`)
        ?.body,
    ).toEqual({ dayChangesKey: KEY, dayDecisions: [] });
  });

  // Task 5.6a-5b-2 (edge/timetable, Versions and drafts: "The preview sorts
  // them into kept, needs a decision and dropped. Publish waits until every
  // 'needs a decision' item is settled.").
  it('shows the one-day changes of the withdrawn dates and waits for a choice for each one that needs a decision', async () => {
    const kept = uid(901);
    const open = uid(902);
    const calls = await openPage({
      versions: [later, earlier],
      extra: {
        ...checkRoute({ kept: [moveItem(kept)], decide: [moveItem(open)] }),
        [`POST /api/timetable/versions/${later.id}/withdraw`]: () =>
          json({ ...later, status: 'archived' }),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.load.withdraw }));
    const dialog = await screen.findByRole('alertdialog');
    const keptList = await waitFor(() => {
      const found = dialog.querySelector<HTMLElement>('[data-day-changes="kept"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(keptList.querySelector(`[data-key="${kept}"]`)).not.toBeNull();
    const decide = dialog.querySelector<HTMLElement>(
      `[data-day-changes="decide"] [data-key="${open}"]`,
    );
    expect(decide).not.toBeNull();
    const send = within(dialog).getByRole('button', { name: en.timetable.load.withdraw });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(
      within(decide as HTMLElement).getByRole('radio', {
        name: en.timetable.publish.dayChanges.choice_cancel,
      }),
    );
    await waitFor(() => {
      expect((send as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(send);
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `POST /api/timetable/versions/${later.id}/withdraw`)
          ?.body,
      ).toEqual({ dayChangesKey: KEY, dayDecisions: [{ key: open, choice: 'cancel' }] });
    });
  });

  it('names a refusal of the sorting as the publish names it, and sends the key of the check read again', async () => {
    // The second read of the check shows a newer sorting.
    let reads = 0;
    const NEWER = 'b'.repeat(64);
    const calls = await openPage({
      versions: [later, earlier],
      extra: {
        [`GET /api/timetable/versions/${later.id}/withdraw-check`]: () => {
          reads += 1;
          return checkAnswer(reads === 1 ? {} : { key: NEWER });
        },
        [`POST /api/timetable/versions/${later.id}/withdraw`]: () =>
          Response.json(
            {
              error: {
                code: 'withdraw_blocked',
                message: 'ENGLISH TEXT FOR THE DEVELOPER',
                requestId: 'test-request',
                details: [{ path: 'dayChanges', code: 'day_changes_changed', message: 'x' }],
              },
            },
            { status: 409 },
          ),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.load.withdraw }));
    const dialog = await screen.findByRole('alertdialog');
    const send = within(dialog).getByRole('button', { name: en.timetable.load.withdraw });
    await waitFor(() => {
      expect((send as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(send);
    const failure = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-withdraw-failure]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(
      within(failure).getByText(en.timetable.publish.refusals.day_changes_changed),
    ).not.toBeNull();
    // Opened again, the dialog waits for the check read again and sends its key.
    fireEvent.click(screen.getByRole('button', { name: en.timetable.load.withdraw }));
    const again = await screen.findByRole('alertdialog');
    const sendAgain = within(again).getByRole('button', { name: en.timetable.load.withdraw });
    await waitFor(() => {
      expect(reads).toBe(2);
      expect((sendAgain as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(sendAgain);
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.route === `POST /api/timetable/versions/${later.id}/withdraw`)
          .map((call) => (call.body as { dayChangesKey: string }).dayChangesKey),
      ).toEqual([KEY, NEWER]);
    });
  });

  it('shows a failed check with a retry and offers no withdraw', async () => {
    await openPage({
      versions: [later, earlier],
      extra: {
        [`GET /api/timetable/versions/${later.id}/withdraw-check`]: () =>
          refusal('withdraw_started', 409),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.load.withdraw }));
    const dialog = await screen.findByRole('alertdialog');
    expect(await within(dialog).findByText(en.errors.withdraw_started)).not.toBeNull();
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: en.timetable.load.withdraw })
        .disabled,
    ).toBe(true);
  });

  it('says when no version runs over the dates of the first one', async () => {
    await openPage({ versions: [later], extra: checkRoute() });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.load.withdraw }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(
        'It is withdrawn before it starts on 9 November 2026. No version runs over its dates.',
      ),
    ).not.toBeNull();
  });

  it.each([
    ['a started version', earlier],
    ['a draft', version(3, { startsOn: '2026-11-09' })],
    ['an archived version', version(4, { status: 'archived', startsOn: '2026-11-09' })],
  ])('offers no withdraw for %s', async (_name, one) => {
    await openPage({ versions: [one] });
    await screen.findByText('Starts on', { exact: false });
    expect(screen.queryByRole('button', { name: en.timetable.load.withdraw })).toBeNull();
  });

  it('offers no withdraw to the Principal', async () => {
    await openPage({ session: principal(), versions: [later] });
    await screen.findByText(en.timetable.load.readOnly);
    expect(screen.queryByRole('button', { name: en.timetable.load.withdraw })).toBeNull();
  });

  it('lists the dates of a refusal by the version that would run again', async () => {
    await openPage({
      versions: [later, earlier],
      extra: {
        ...checkRoute(),
        [`POST /api/timetable/versions/${later.id}/withdraw`]: () =>
          Response.json(
            {
              error: {
                code: 'withdraw_blocked',
                message: 'ENGLISH TEXT FOR THE DEVELOPER',
                requestId: 'test-request',
                details: [
                  {
                    path: 'dates.2026-11-16.teacher_double',
                    code: 'date_blocked',
                    message: 'x',
                    day: '2026-11-16',
                  },
                ],
              },
            },
            { status: 409 },
          ),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.load.withdraw }));
    const dialog = await screen.findByRole('alertdialog');
    const send = within(dialog).getByRole('button', { name: en.timetable.load.withdraw });
    await waitFor(() => {
      expect((send as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(send);
    const failure = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-withdraw-failure]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(within(failure).getByText(en.errors.withdraw_blocked)).not.toBeNull();
    expect(
      within(failure).getByText(`16 November 2026: ${en.timetable.rule.teacher_double}`),
    ).not.toBeNull();
  });
});

describe('the timetable page', () => {
  it.each([
    ['academic_vice_principal', true],
    ['principal', true],
    ['super_admin', true],
  ] as const)('shows the teaching load link to %s', async (role, shown) => {
    fakeApi({
      'GET /api/auth/session': () =>
        json(
          sessionOf({
            assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
            branches: [NORTH],
          }),
        ),
    });
    renderApp('/timetable');
    await screen.findByRole('heading', { name: en.timetable.title });
    expect(screen.queryByRole('link', { name: en.timetable.loadLink }) !== null).toBe(shown);
  });

  it('is not open to a Teacher until the views of lessons come (task 5.9)', async () => {
    fakeApi({
      'GET /api/auth/session': () =>
        json(
          sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }], branches: [NORTH] }),
        ),
    });
    renderApp('/timetable');
    expect(await screen.findByRole('heading', { name: en.problems.noAccessTitle })).not.toBeNull();
  });
});

// Task 3.4b, pull request #100: the block of a group row, students not placed
// (decision 4), the mixed mark and the block's lessons (decisions 3 and 12),
// the group switch as the default (decision 13) and the weekly totals
// (decisions 5 to 8).
describe('the teaching load page: splits, groups and weekly totals', () => {
  const splitGroup = (n: number, name: string, subjectId = MATHS.id): SchoolGroup => ({
    id: uid(800 + n),
    academicYearId: YEAR.id,
    yearName: YEAR.name,
    yearStatus: 'current',
    subject: { id: subjectId, names: MATHS.names, languageRule: true },
    name,
    language: 'uz',
    maxSize: 15,
    grades: [7],
    classes: [{ id: OXFORD.id, grade: 7, name: 'Oxford', language: 'uz', archived: false }],
    kind: 'split',
    students: 0,
    teacher: null,
    archived: false,
    version: 0,
  });
  const HALF = splitGroup(1, '7-M-1');
  const OTHER_HALF = splitGroup(2, '7-M-2');

  const groupRow = (n: number, group: SchoolGroup, fields: Partial<LoadRow> = {}): LoadRow =>
    row(n, {
      unit: {
        kind: 'group',
        id: group.id,
        name: group.name,
        grades: [7],
        language: 'uz',
        archived: false,
      },
      block: [
        { id: uid(701), name: '7-M-1' },
        { id: uid(702), name: '7-M-2' },
      ],
      ...fields,
    });

  it('shows the block of a group row and the students not placed with their count', async () => {
    setWindowWidth(1440);
    await openPage({
      load: {
        rows: [groupRow(1, HALF, { unplaced: 3, problems: ['load_group_gaps'] })],
      },
    });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    const [cells] = rowsDrawn();
    expect(cells?.[1]).toBe('7-M-1, 7-M-2');
    expect(cells?.at(-1)).toBe('3 students not placed');
  });

  it('marks a split as a mixed block, with the lessons written to every part', async () => {
    const calls = await openPage({
      teachers: () => ({
        teachers: [{ ...TEACHER, tutor: false }],
        tutorRow: false,
        defaultTeacherId: null,
        excluded: [],
        noTutor: false,
      }),
      extra: {
        'GET /api/groups': () => json({ groups: [HALF] }),
        [`POST /api/timetable/versions/${version(1).id}/load`]: () => json(groupRow(1, HALF), 201),
      },
    });
    const form = await openNewRow();
    expect(within(form).queryByLabelText(en.timetable.load.mixedBlock)).toBeNull();
    type(within(form).getByLabelText(en.timetable.load.unit), `group:${HALF.id}`);
    const mixed = await within(form).findByLabelText(en.timetable.load.mixedBlock);
    type(within(form).getByLabelText(en.timetable.load.subject), MATHS.id);
    expect(screen.getByText(en.timetable.load.mixedNote)).not.toBeNull();
    expect(
      screen.getByText(
        en.timetable.load.blockLessonsCreateNote.replace('{{min}}', '1').replace('{{max}}', '40'),
      ),
    ).not.toBeNull();
    const teacher = await within(form).findByLabelText<HTMLSelectElement>(
      en.timetable.load.teacher,
    );
    await waitFor(() => {
      expect(teacher.options).toHaveLength(2);
    });
    type(teacher, TEACHER.id);
    type(within(form).getByLabelText(en.timetable.load.lessons), '2');
    fireEvent.click(mixed);
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `POST /api/timetable/versions/${version(1).id}/load`)
          ?.body,
      ).toMatchObject({ classId: null, groupId: HALF.id, lessonsPerWeek: 2, mixedBlock: true });
    });
  });

  it("offers the class's groups for a subject taught in groups by default", async () => {
    const grouped = subject(3, { groupSubject: true });
    const groupOfIt = splitGroup(3, '7-E-1', grouped.id);
    await openPage({
      extra: {
        'GET /api/groups': () => json({ groups: [groupOfIt, OTHER_HALF] }),
        'GET /api/setup/subjects': () =>
          json({ subjects: [MATHS, grouped], mayMoveDepartment: false }),
      },
    });
    const form = await openNewRow();
    const unit = within(form).getByLabelText<HTMLSelectElement>(en.timetable.load.unit);
    type(unit, `class:${OXFORD.id}`);
    type(within(form).getByLabelText(en.timetable.load.subject), MATHS.id);
    expect(within(form).queryByText(en.timetable.load.groupDefault)).toBeNull();
    type(within(form).getByLabelText(en.timetable.load.subject), grouped.id);
    expect(await within(form).findByText(en.timetable.load.groupDefault)).not.toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: 'Use group 7-E-1' }));
    await waitFor(() => {
      expect(unit.value).toBe(`group:${groupOfIt.id}`);
    });
  });

  // Spec review of the build, should-fix 2: a group marked as a mixed block
  // that gained a class since shows the switch, so the mark can be cleared.
  it('lets the mark of a row that is no longer a split be cleared', async () => {
    setWindowWidth(1440);
    const across: SchoolGroup = {
      ...HALF,
      kind: 'across',
      classes: [
        ...HALF.classes,
        { id: uid(103), grade: 7, name: 'Princeton', language: 'uz', archived: false },
      ],
    };
    const marked = groupRow(1, across, { mixedBlock: true, problems: ['load_mixed_not_split'] });
    const calls = await openPage({
      teachers: () => ({
        teachers: [{ ...TEACHER, tutor: false }],
        tutorRow: false,
        defaultTeacherId: null,
        excluded: [],
        noTutor: false,
      }),
      load: { rows: [marked] },
      extra: {
        'GET /api/groups': () => json({ groups: [across] }),
        [`PATCH /api/timetable/versions/${version(1).id}/load/${marked.id}`]: () =>
          json({ ...marked, mixedBlock: false, problems: [] }),
      },
    });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    fireEvent.click(
      within(document.querySelectorAll('tbody tr')[0] as HTMLElement).getAllByRole(
        'button',
      )[0] as HTMLElement,
    );
    const panel = await screen.findByRole('complementary');
    fireEvent.click(await within(panel).findByRole('button', { name: en.form.edit }));
    const mixed = await within(panel).findByLabelText<HTMLInputElement>(
      en.timetable.load.mixedBlock,
    );
    expect(mixed.checked).toBe(true);
    fireEvent.click(mixed);
    fireEvent.click(within(panel).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find(
          (call) =>
            call.route === `PATCH /api/timetable/versions/${version(1).id}/load/${marked.id}`,
        )?.body,
      ).toMatchObject({ mixedBlock: false });
    });
  });

  const TOTALS: LoadTotals = {
    classes: [{ id: OXFORD.id, name: 'Oxford', grade: 7, lessons: 32, lessonSlots: 30 }],
    teachers: [
      {
        ...TEACHER,
        lessons: 20,
        freeSlots: null,
        elsewhere: [{ branchId: uid(900), branchName: 'South', lessons: 4, draft: true }],
        contract: 20,
      },
    ],
  };

  const totalsCells = (which: 'classes' | 'teachers') =>
    [...document.querySelectorAll(`[data-totals="${which}"] tbody tr`)].map((one) =>
      [...one.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
    );

  it('shows the weekly totals of classes and teachers and marks what is over', async () => {
    await openPage({ totals: TOTALS });
    expect(
      await screen.findByRole('heading', { name: en.timetable.load.totals.title }),
    ).not.toBeNull();
    await waitFor(() => {
      expect(totalsCells('classes')).toEqual([['7 Oxford', '32Over by 2', '30']]);
    });
    expect(totalsCells('teachers')).toEqual([
      ['Karimova Aziza', '20', 'No hours set', 'South: 4 (draft)', '24Over by 4', '20'],
    ]);
  });

  it('shows the weekly totals in Russian', async () => {
    await openPage({ totals: TOTALS, language: 'ru' });
    expect(
      await screen.findByRole('heading', { name: ru.timetable.load.totals.title }),
    ).not.toBeNull();
    await waitFor(() => {
      expect(totalsCells('teachers')[0]?.[2]).toBe(ru.timetable.load.totals.noHours);
    });
    expect(totalsCells('teachers')[0]?.[3]).toBe('South: 4 (черновик)');
    expect(totalsCells('classes')[0]?.[1]).toBe('32Больше на 2');
  });

  it('says when there is nothing to count', async () => {
    await openPage();
    expect(await screen.findByText(en.timetable.load.totals.empty)).not.toBeNull();
  });
});

// Issue #105, H21: below 640 px the rows and the weekly totals are cards,
// never a table wider than the phone; H19: the empty page's first action is
// a primary button.
describe('the teaching load at phone width and empty', () => {
  it('draws one card per row and the totals as cards, the overrun in words', async () => {
    setWindowWidth(375);
    await openPage({
      load: { rows: [row(1, { problems: ['load_teacher_status'] })] },
      totals: {
        classes: [{ id: OXFORD.id, name: 'Oxford', grade: 7, lessons: 32, lessonSlots: 30 }],
        teachers: [{ ...TEACHER, lessons: 20, freeSlots: null, elsewhere: [], contract: 18 }],
      },
    });
    await waitFor(() => {
      expect(document.querySelectorAll('[data-load-card]')).toHaveLength(1);
    });
    expect(document.querySelector('table')).toBeNull();
    const card = document.querySelector('[data-load-card]');
    expect(within(card as HTMLElement).getByRole('button', { name: '7 Oxford' })).toBeDefined();
    expect(card?.textContent).toContain('Karimova Aziza');
    expect(card?.textContent).toContain(en.timetable.load.problems.load_teacher_status);
    const classes = await screen.findByText('7 Oxford', {
      selector: '[data-totals="classes"] li span',
    });
    expect(classes.closest('li')?.textContent).toContain(
      en.timetable.load.totals.over_other.replace('{{n}}', '2'),
    );
    expect(document.querySelector('[data-totals="teachers"] li')?.textContent).toContain(
      en.timetable.load.totals.over_other.replace('{{n}}', '2'),
    );
  });

  it('offers the first row as a primary button on the empty page', async () => {
    await openPage();
    const heading = await screen.findByRole('heading', { name: en.timetable.load.emptyTitle });
    const button = heading.parentElement?.querySelector('button');
    expect(button?.textContent).toBe(en.timetable.load.add);
    expect(button?.dataset.variant).toBe('default');
  });
});
