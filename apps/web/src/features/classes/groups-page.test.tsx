import {
  classDisplayName,
  EXPORT_TEXTS,
  GROUP_EXPORT_COLUMNS,
  type AcademicYear,
  type GroupDetail,
  type GroupSlots,
  type SchoolClass,
  type SchoolGroup,
  type Subject,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';
import { setWindowWidth } from '@/testing/window-width';

const PATH = '/groups';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const YEAR: AcademicYear = {
  id: uid(1),
  name: '2026–2027',
  startDate: '2026-09-01',
  endDate: '2027-05-31',
  status: 'current',
  quarters: [],
};

const schoolClass = (n: number, fields: Partial<SchoolClass> = {}): SchoolClass => ({
  id: uid(100 + n),
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
  ...fields,
});

// All names are invented.
const OXFORD = schoolClass(1);
const PRINCETON = schoolClass(2, { name: 'Princeton' });
const YALE = schoolClass(3, { name: 'Yale', language: 'ru' });
const BROWN = schoolClass(4, { grade: 8, name: 'Brown' });

const subject = (n: number, fields: Partial<Subject> = {}): Subject => ({
  departmentSince: null,
  id: uid(200 + n),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  departmentId: uid(9),
  grades: [7, 8],
  colour: 'blue',
  journalType: 'graded',
  ratingExam: false,
  groupSubject: true,
  languageRule: true,
  demanding: false,
  archivedAt: null,
  daily: { attendance: 10, classwork: 50, homework: 40 },
  quarterWeightsMissing: 0,
  quarterCount: 4,
  ...fields,
});

const MATHS = subject(1);
const ENGLISH = subject(2, {
  names: { uz: 'Ingliz tili', ru: 'Английский язык', en: 'English' },
  languageRule: false,
});

const group = (n: number, fields: Partial<SchoolGroup> = {}): SchoolGroup => ({
  id: uid(300 + n),
  academicYearId: YEAR.id,
  yearName: YEAR.name,
  yearStatus: 'current',
  subject: { id: MATHS.id, names: MATHS.names, languageRule: true },
  name: '7-M-1',
  language: 'uz',
  maxSize: 20,
  grades: [7],
  classes: [
    { id: OXFORD.id, grade: 7, name: 'Oxford', language: 'uz', archived: false },
    { id: PRINCETON.id, grade: 7, name: 'Princeton', language: 'uz', archived: false },
  ],
  kind: 'across',
  students: 0,
  teacher: null,
  archived: false,
  version: 0,
  ...fields,
});

const M1 = group(1);
const SPLIT = group(2, {
  name: '7-E-1',
  subject: { id: ENGLISH.id, names: ENGLISH.names, languageRule: false },
  classes: [{ id: OXFORD.id, grade: 7, name: 'Oxford', language: 'uz', archived: false }],
  kind: 'split',
});

const detailOf = (row: SchoolGroup, slots: GroupSlots = null): GroupDetail => ({ ...row, slots });

const vice = () =>
  sessionOf({
    assignments: [{ role: 'academic_vice_principal', branchId: NORTH.id }],
    branches: [NORTH],
  });

const tutor = () =>
  sessionOf({ assignments: [{ role: 'tutor', branchId: NORTH.id }], branches: [NORTH] });

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

const field = (scope: HTMLElement, label: string) =>
  within(scope).getByLabelText<HTMLInputElement | HTMLSelectElement>(label);

const type = (input: HTMLElement, value: string): void => {
  fireEvent.change(input, { target: { value } });
};

async function openList(
  options: {
    session?: ReturnType<typeof sessionOf>;
    groups?: SchoolGroup[];
    classes?: SchoolClass[];
    years?: AcademicYear[];
    subjects?: Subject[];
    extra?: Record<string, (body: unknown) => Response>;
    language?: 'en' | 'ru';
  } = {},
) {
  const session = { ...(options.session ?? vice()), language: options.language ?? 'en' };
  const groups = options.groups ?? [M1, SPLIT];
  const calls = fakeApi({
    'GET /api/auth/session': () => json(session),
    'GET /api/groups': () => json({ groups }),
    'GET /api/classes': () =>
      json({ classes: options.classes ?? [OXFORD, PRINCETON, YALE, BROWN] }),
    'GET /api/setup/academic-years': () => json({ years: options.years ?? [YEAR] }),
    'GET /api/setup/subjects': () =>
      json({ subjects: options.subjects ?? [MATHS, ENGLISH], mayMoveDepartment: false }),
    ...Object.fromEntries(
      groups.map((one) => [`GET /api/groups/${one.id}`, () => json(detailOf(one))]),
    ),
    ...options.extra,
  });
  renderApp(PATH, options.language ?? 'en');
  await screen.findByRole('heading', {
    name: options.language === 'ru' ? ru.groups.title : en.groups.title,
  });
  await waitFor(() => {
    expect(rowsDrawn().length + document.querySelectorAll('[data-group-card]').length).toBe(
      groups.length,
    );
  });
  return calls;
}

async function openNewGroup() {
  await waitFor(() => {
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.groups.add }).disabled).toBe(
      false,
    );
  });
  fireEvent.click(screen.getByRole('button', { name: en.groups.add }));
  return within(await screen.findByRole('complementary', { name: en.groups.newTitle })).getByRole(
    'form',
    { name: en.groups.newTitle },
  );
}

const tick = (form: HTMLElement, name: string): void => {
  fireEvent.click(within(form).getByRole('checkbox', { name }));
};

// docs/spec/05-classes-groups-subjects.md, Group; Language of instruction,
// Groups; task 3.2a, pull request #91.
describe('the group list', () => {
  it('lists the groups with their subject, classes, language and size', async () => {
    setWindowWidth(1440);
    await openList();
    expect(rowsDrawn()).toEqual([
      // Task 3.2b: the students today follow the language (decision 2 of #92).
      ['7-M-1', 'Mathematics', '7 Oxford, 7 Princeton', 'Uzbek', '0', '20', 'Active'],
      ['7-E-1', 'English', '7 Oxford', 'Uzbek', '0', '20', 'Active'],
    ]);
  });

  it('names the columns in Russian when Russian is chosen', async () => {
    setWindowWidth(1440);
    await openList({ language: 'ru' });
    const headers = [...document.querySelectorAll('thead th')].map((cell) => cell.textContent);
    expect(headers).toEqual(
      expect.arrayContaining([ru.groups.columns.subject, ru.groups.columns.classes]),
    );
    expect(rowsDrawn()[0]?.slice(0, 2)).toEqual(['7-M-1', 'Математика']);
  });

  // `edge/students-classes-groups`: look-alike letters in group names are the same.
  it('finds a group typed with a look-alike Cyrillic letter', async () => {
    await openList();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '7-Е-1' } });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    expect(rowsDrawn()[0]?.[0]).toBe('7-E-1');
  });

  // `05`, group cards; decision 15: the teacher and the figures show "—", the students their count (3.2b).
  it('draws the groups as cards at phone width', async () => {
    setWindowWidth(400);
    await openList();
    const card = screen.getByRole('button', { name: '7-E-1' }).closest('li');
    const terms = [...(card?.querySelectorAll('dt') ?? [])].map((term) => term.textContent);
    expect(terms).toEqual([
      en.groups.grade,
      en.groups.columns.subject,
      en.groups.students,
      en.groups.columns.language,
      en.groups.teacher,
      en.groups.average,
      en.groups.attendance,
    ]);
    setWindowWidth(1440);
  });

  // Task 3.4b, decision 9: the teacher of the group's load row, a vacancy
  // named as one, a draft's marked; "—" without a row.
  it("shows the teacher of the group's load row on the card and in the panel", async () => {
    setWindowWidth(400);
    const taught = group(5, {
      name: '7-M-5',
      teacher: { id: uid(950), kind: 'person', name: 'Karimova Aziza', draft: false },
    });
    const wanted = group(6, {
      name: '7-M-6',
      teacher: { id: uid(951), kind: 'vacancy', name: 'Teacher wanted', draft: true },
    });
    await openList({ groups: [taught, wanted, M1] });
    const teacherOn = (name: string) => {
      const card = screen.getByRole('button', { name }).closest('li');
      const terms = [...(card?.querySelectorAll('div') ?? [])].filter(
        (one) => one.querySelector('dt')?.textContent === en.groups.teacher,
      );
      return terms[0]?.querySelector('dd')?.textContent;
    };
    expect(teacherOn('7-M-5')).toBe('Karimova Aziza');
    expect(teacherOn('7-M-6')).toBe('Vacancy: Teacher wanted (draft)');
    expect(teacherOn(M1.name)).toBe('—');
    fireEvent.click(screen.getByRole('button', { name: '7-M-6' }));
    await waitFor(() => {
      expect(document.querySelector('[data-group-teacher]')?.textContent).toBe(
        'Vacancy: Teacher wanted (draft)',
      );
    });
    setWindowWidth(1440);
  });

  it('has the columns of the export file, with the same headings', () => {
    expect([...GROUP_EXPORT_COLUMNS]).toEqual([
      'name',
      'subject',
      'classes',
      'language',
      // Task 3.2b, decision 2 of #92 (Look first): the card's count.
      'students',
      'maxSize',
      'status',
    ]);
    for (const column of GROUP_EXPORT_COLUMNS) {
      expect(EXPORT_TEXTS.en.groups.columns[column]).toBe(en.groups.columns[column]);
      expect(EXPORT_TEXTS.ru.groups.columns[column]).toBe(ru.groups.columns[column]);
    }
  });

  it('says why a Tutor sees no group', async () => {
    await openList({ session: tutor(), groups: [] });
    expect(await screen.findByText(en.groups.emptyTutor)).not.toBeNull();
    expect(screen.queryByRole('button', { name: en.groups.add })).toBeNull();
  });
});

describe('a new group', () => {
  it('creates a group of two classes of one language, which it takes', async () => {
    const calls = await openList({
      extra: {
        'POST /api/groups': (body) => json(detailOf(group(9, body as Partial<SchoolGroup>)), 201),
      },
    });
    const form = await openNewGroup();
    type(field(form, en.groups.subject), MATHS.id);
    tick(form, '7 Oxford');
    tick(form, '7 Princeton');
    expect(
      within(form).getByText(en.groups.languageOfClasses.replace('{{language}}', 'Uzbek')),
    ).not.toBeNull();
    expect(within(form).queryByLabelText(en.groups.language)).toBeNull();
    type(field(form, en.groups.groupName), '7-M-2');
    type(field(form, en.groups.maxSize), '18');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.find((call) => call.route === 'POST /api/groups')?.body).toEqual({
        academicYearId: YEAR.id,
        subjectId: MATHS.id,
        classIds: [OXFORD.id, PRINCETON.id],
        name: '7-M-2',
        language: null,
        maxSize: 18,
        confirmMixedLanguage: false,
      });
    });
  });

  // Decision 8: mixed classes take a chosen language, with a confirmed warning under the rule.
  it('asks a language and a confirmation for mixed classes of a subject under the language rule', async () => {
    const calls = await openList({
      extra: {
        'POST /api/groups': (body) => json(detailOf(group(9, body as Partial<SchoolGroup>)), 201),
      },
    });
    const form = await openNewGroup();
    type(field(form, en.groups.subject), MATHS.id);
    tick(form, '7 Oxford');
    tick(form, '7 Yale');
    type(field(form, en.groups.language), 'ru');
    type(field(form, en.groups.groupName), '7-M-3');
    type(field(form, en.groups.maxSize), '18');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('7 Yale')).not.toBeNull();
    // Declined: nothing is sent.
    fireEvent.click(within(dialog).getByRole('button', { name: en.confirm.cancel }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(calls.some((call) => call.route === 'POST /api/groups')).toBe(false);
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: en.groups.mixedConfirm,
      }),
    );
    await waitFor(() => {
      expect(calls.find((call) => call.route === 'POST /api/groups')?.body).toMatchObject({
        language: 'ru',
        confirmMixedLanguage: true,
      });
    });
  });

  it('asks no confirmation for mixed classes of a subject outside the language rule', async () => {
    const calls = await openList({
      extra: {
        'POST /api/groups': (body) => json(detailOf(group(9, body as Partial<SchoolGroup>)), 201),
      },
    });
    const form = await openNewGroup();
    type(field(form, en.groups.subject), ENGLISH.id);
    tick(form, '7 Oxford');
    tick(form, '7 Yale');
    type(field(form, en.groups.language), 'uz');
    type(field(form, en.groups.groupName), '7-E-3');
    type(field(form, en.groups.maxSize), '18');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.find((call) => call.route === 'POST /api/groups')?.body).toMatchObject({
        language: 'uz',
        confirmMixedLanguage: false,
      });
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  // Decision 9: shown, never refused.
  it('shows the lesson slots two grades share, and warns when there is none', async () => {
    const calls = await openList({
      extra: {
        'GET /api/groups/slot-check': () =>
          json({
            slots: { grades: [7, 8], days: [{ weekday: 1, date: '2026-10-19', slots: [] }] },
          }),
      },
    });
    const form = await openNewGroup();
    tick(form, '7 Oxford');
    tick(form, '8 Brown');
    expect(await within(form).findByText(en.groups.noSharedSlot)).not.toBeNull();
    expect(calls.find((call) => call.route === 'GET /api/groups/slot-check')?.query).toBe(
      `?classIds=${encodeURIComponent(`${OXFORD.id},${BROWN.id}`)}`,
    );
  });

  it('shows a refusal of the server in words', async () => {
    await openList({
      extra: { 'POST /api/groups': () => refusal('group_subject_grade', 409) },
    });
    const form = await openNewGroup();
    type(field(form, en.groups.subject), MATHS.id);
    tick(form, '7 Oxford');
    type(field(form, en.groups.groupName), '7-M-9');
    type(field(form, en.groups.maxSize), '18');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(await screen.findByText(en.errors.group_subject_grade)).not.toBeNull();
  });

  // edge/academic-year: "An action whose prerequisite is missing is switched off and says what is missing".
  it('switches New group off without an active class, saying so', async () => {
    await openList({ classes: [] });
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: en.groups.add }).disabled).toBe(
        true,
      );
    });
    expect(screen.getByText(en.groups.needClass)).not.toBeNull();
  });
});

describe('a group in the side panel', () => {
  it('archives a group after a confirmation naming it', async () => {
    const calls = await openList({
      extra: {
        [`POST /api/groups/${M1.id}/archive`]: () => json(detailOf({ ...M1, archived: true })),
      },
    });
    fireEvent.click(screen.getByText('7-M-1', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: '7-M-1' });
    fireEvent.click(await within(panel).findByRole('button', { name: en.groups.archiveGroup }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('7-M-1')).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: en.groups.archiveGroup }));
    await waitFor(() => {
      expect(calls.some((call) => call.route === `POST /api/groups/${M1.id}/archive`)).toBe(true);
    });
  });

  // Code round 1 of the review, finding 1: a restore that brings the group back
  // mixing languages asks the warning of the form, naming the classes.
  it('asks the mixed-language warning before restoring a group whose classes now differ', async () => {
    const mixed = group(3, {
      name: '7-M-3',
      archived: true,
      classes: [
        { id: OXFORD.id, grade: 7, name: 'Oxford', language: 'uz', archived: false },
        { id: YALE.id, grade: 7, name: 'Yale', language: 'ru', archived: false },
      ],
    });
    const calls = await openList({
      groups: [mixed],
      extra: {
        [`POST /api/groups/${mixed.id}/restore`]: () =>
          json(detailOf({ ...mixed, archived: false })),
      },
    });
    fireEvent.click(screen.getByText('7-M-3', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: '7-M-3' });
    fireEvent.click(await within(panel).findByRole('button', { name: en.groups.restoreGroup }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(en.groups.mixedTitle)).not.toBeNull();
    expect(within(dialog).getByText(classDisplayName(7, 'Yale'))).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: en.groups.restoreGroup }));
    await waitFor(() => {
      expect(calls.find((call) => call.route === `POST /api/groups/${mixed.id}/restore`)).toEqual({
        route: `POST /api/groups/${mixed.id}/restore`,
        body: { confirmMixedLanguage: true },
      });
    });
  });

  it('restores a one-language group without the warning', async () => {
    const archived = { ...SPLIT, archived: true };
    const calls = await openList({
      groups: [archived],
      extra: {
        [`POST /api/groups/${SPLIT.id}/restore`]: () => json(detailOf(SPLIT)),
      },
    });
    fireEvent.click(screen.getByText('7-E-1', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: '7-E-1' });
    fireEvent.click(await within(panel).findByRole('button', { name: en.groups.restoreGroup }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(en.groups.restoreTitle)).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: en.groups.restoreGroup }));
    await waitFor(() => {
      expect(calls.find((call) => call.route === `POST /api/groups/${SPLIT.id}/restore`)).toEqual({
        route: `POST /api/groups/${SPLIT.id}/restore`,
        body: { confirmMixedLanguage: false },
      });
    });
  });
});
