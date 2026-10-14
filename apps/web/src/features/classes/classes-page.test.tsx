import {
  CLASS_EXPORT_COLUMNS,
  EXPORT_TEXTS,
  type AcademicYear,
  type ClassDetail,
  type ClassTutor,
  type Room,
  type SchoolClass,
  type TutorCandidate,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { actionsAreLast, edit, panelActionNames, savedInPanel } from '@/testing/panel';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';
import { setWindowWidth } from '@/testing/window-width';

const PATH = '/classes';
const TODAY = '2026-10-14';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const YEAR: AcademicYear = {
  id: uid(1),
  name: '2026–2027',
  startDate: '2026-09-01',
  endDate: '2027-05-31',
  status: 'current',
  quarters: [],
};

const ROOMS: Room[] = [
  {
    id: uid(2),
    name: '204',
    floorId: uid(3),
    floorName: 'Second',
    buildingId: uid(4),
    buildingName: 'Main',
    type: 'classroom',
    capacity: 30,
    status: 'in_use',
    shared: false,
    maxSimultaneousLessons: null,
  },
  {
    id: uid(5),
    name: '105',
    floorId: uid(3),
    floorName: 'Second',
    buildingId: uid(4),
    buildingName: 'Main',
    type: 'classroom',
    capacity: 30,
    status: 'closed',
    shared: false,
    maxSimultaneousLessons: null,
  },
];

const tutorRow = (n: number, fields: Partial<ClassTutor> = {}): ClassTutor => ({
  id: uid(300 + n),
  assignmentId: uid(400 + n),
  staffId: uid(500 + n),
  name: { firstName: 'Dilnoza', lastName: 'Tursunova' },
  kind: 'tutor',
  from: '2026-09-01',
  until: null,
  state: 'current',
  endCause: null,
  ...fields,
});

const schoolClass = (n: number, fields: Partial<SchoolClass> = {}): SchoolClass => ({
  id: uid(100 + n),
  academicYearId: YEAR.id,
  yearName: YEAR.name,
  yearStatus: 'current',
  grade: 7,
  name: 'Oxford',
  language: 'uz',
  mainRoom: { id: uid(2), name: '204', status: 'in_use' },
  maxSize: 25,
  tutor: null,
  acting: null,
  archived: false,
  version: 0,
  ...fields,
});

const OXFORD = schoolClass(1, { tutor: tutorRow(1) });
const PRINCETON = schoolClass(2, {
  grade: 8,
  name: 'Princeton',
  language: 'ru',
  mainRoom: null,
});

const detailOf = (row: SchoolClass, tutors: ClassTutor[] = []): ClassDetail => ({
  ...row,
  tutors: row.tutor === null ? tutors : [row.tutor, ...tutors],
  today: TODAY,
});

const CANDIDATES: TutorCandidate[] = [
  {
    assignmentId: uid(601),
    staffId: uid(701),
    name: { firstName: 'Kamola', lastName: 'Rahimova' },
    languages: ['uz', 'ru'],
    from: '2026-09-01',
    until: null,
    classes: [],
  },
  {
    assignmentId: uid(602),
    staffId: uid(702),
    name: { firstName: 'Sergey', lastName: 'Ivanov' },
    languages: ['ru'],
    from: '2026-09-01',
    until: null,
    classes: [{ id: PRINCETON.id, grade: 8, name: 'Princeton', kind: 'tutor' }],
  },
];

const vice = () =>
  sessionOf({
    assignments: [{ role: 'academic_vice_principal', branchId: NORTH.id }],
    branches: [NORTH],
  });

const principal = () =>
  sessionOf({ assignments: [{ role: 'principal', branchId: NORTH.id }], branches: [NORTH] });

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

const rowButton = (name: string) => screen.getByText(name, { selector: 'button' });

const type = (input: HTMLElement, value: string): void => {
  fireEvent.change(input, { target: { value } });
};

const field = (scope: HTMLElement, label: string) =>
  within(scope).getByLabelText<HTMLInputElement | HTMLSelectElement>(label);

async function confirmWith(action: string): Promise<void> {
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: action }));
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
}

async function openList(
  options: {
    session?: ReturnType<typeof sessionOf>;
    classes?: SchoolClass[];
    years?: AcademicYear[];
    extra?: Record<string, (body: unknown) => Response>;
    language?: 'en' | 'ru';
  } = {},
) {
  const session = { ...(options.session ?? vice()), language: options.language ?? 'en' };
  const classes = options.classes ?? [OXFORD, PRINCETON];
  const calls = fakeApi({
    'GET /api/auth/session': () => json(session),
    'GET /api/classes': () => json({ classes }),
    'GET /api/setup/academic-years': () => json({ years: options.years ?? [YEAR] }),
    'GET /api/setup/rooms': () => json({ rooms: ROOMS }),
    'GET /api/classes/tutor-candidates': () => json({ candidates: CANDIDATES }),
    ...Object.fromEntries(
      classes.map((one) => [`GET /api/classes/${one.id}`, () => json(detailOf(one))]),
    ),
    ...options.extra,
  });
  renderApp(PATH, options.language ?? 'en');
  await screen.findByRole('heading', {
    name: options.language === 'ru' ? ru.classes.title : en.classes.title,
  });
  await waitFor(() => {
    expect(rowsDrawn().length + document.querySelectorAll('[data-class-card]').length).toBe(
      classes.length,
    );
  });
  return calls;
}

// docs/spec/05-classes-groups-subjects.md, Class: "A class is shown as grade
// and name: 7 Oxford"; edge/students-classes-groups: "A class with no Tutor
// shows a warning to the Academic Vice Principal and the Head Tutor"; task
// 3.1a, pull request #88, decisions 11 to 13.
describe('the class list', () => {
  it('lists the classes as grade and name, with a No Tutor mark', async () => {
    setWindowWidth(1440);
    await openList();
    expect(rowsDrawn()).toEqual([
      ['7 Oxford', '2026–2027', 'Uzbek', 'Tursunova Dilnoza', '204', '25', 'Active'],
      ['8 Princeton', '2026–2027', 'Russian', en.classes.noTutor, 'None', '25', 'Active'],
    ]);
    expect(document.querySelectorAll('[data-no-tutor]')).toHaveLength(1);
  });

  it('names the columns and the values in Russian when Russian is chosen', async () => {
    setWindowWidth(1440);
    await openList({ language: 'ru' });
    const headers = [...document.querySelectorAll('thead th')].map((cell) => cell.textContent);
    expect(headers).toContain(ru.classes.tutor);
    expect(rowsDrawn()[1]?.slice(0, 4)).toEqual([
      '8 Princeton',
      '2026–2027',
      'Русский',
      ru.classes.noTutor,
    ]);
  });

  it('finds the classes with no Tutor with its filter', async () => {
    await openList();
    fireEvent.change(screen.getByLabelText(en.classes.tutor, { selector: 'select' }), {
      target: { value: 'none' },
    });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    expect(rowsDrawn()[0]?.[0]).toBe('8 Princeton');
  });

  // `05`, class cards; decision 13: the figures show "—" until 3.1b and the journal.
  it('draws the classes as cards at phone width', async () => {
    setWindowWidth(400);
    await openList();
    const card = screen.getByRole('button', { name: '8 Princeton' }).closest('li');
    expect(card).not.toBeNull();
    const terms = [...(card?.querySelectorAll('dt') ?? [])].map((term) => term.textContent);
    expect(terms).toEqual([
      en.classes.language,
      en.classes.students,
      en.classes.tutor,
      en.classes.mainRoom,
      en.classes.average,
      en.classes.attendance,
    ]);
    expect(card?.textContent).toContain(en.classes.noTutor);
    setWindowWidth(1440);
  });

  it('has the columns of the export file, with the same headings', () => {
    expect([...CLASS_EXPORT_COLUMNS]).toEqual([
      'name',
      'year',
      'language',
      'tutor',
      'mainRoom',
      'maxSize',
      'status',
    ]);
    expect(EXPORT_TEXTS.en.classes.columns.tutor).toBe(en.classes.tutor);
  });
});

describe('a new class', () => {
  it('creates a class of the current year from the header', async () => {
    const calls = await openList({
      extra: {
        'POST /api/classes': (body) =>
          json(detailOf(schoolClass(9, body as Partial<SchoolClass>)), 201),
      },
    });
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: en.classes.add }).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole('button', { name: en.classes.add }));
    const form = within(
      await screen.findByRole('complementary', { name: en.classes.newTitle }),
    ).getByRole('form', { name: en.classes.newTitle });
    // A closed room is not offered (decision 7).
    expect(
      [...(field(form, en.classes.mainRoom) as HTMLSelectElement).options].map(
        (option) => option.textContent,
      ),
    ).toEqual([en.classes.noRoom, '204']);
    type(field(form, en.classes.grade), '9');
    type(field(form, en.classes.className), 'Harvard');
    type(field(form, en.classes.language), 'ru');
    type(field(form, en.classes.mainRoom), uid(2));
    type(field(form, en.classes.maxSize), '28');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.find((call) => call.route === 'POST /api/classes')?.body).toEqual({
        academicYearId: YEAR.id,
        grade: 9,
        name: 'Harvard',
        language: 'ru',
        mainRoomId: uid(2),
        maxSize: 28,
      });
    });
  });

  it('refuses a code such as 7-A in the form, sending nothing', async () => {
    const calls = await openList();
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: en.classes.add }).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole('button', { name: en.classes.add }));
    const form = within(
      await screen.findByRole('complementary', { name: en.classes.newTitle }),
    ).getByRole('form', { name: en.classes.newTitle });
    type(field(form, en.classes.grade), '7');
    type(field(form, en.classes.className), '7-A');
    type(field(form, en.classes.maxSize), '25');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(field(form, en.classes.className).getAttribute('aria-invalid')).toBe('true');
    });
    expect(calls.some((call) => call.route === 'POST /api/classes')).toBe(false);
  });

  // `edge/academic-year`: "adding one that exists offers restore".
  it('offers to open the class that holds a taken name', async () => {
    const archived = schoolClass(3, { name: 'Yale', archived: true });
    const refused = refusal('already_exists', 409);
    const body = (await refused.clone().json()) as { error: object };
    await openList({
      classes: [OXFORD, archived],
      extra: {
        'POST /api/classes': () =>
          json(
            {
              error: {
                ...body.error,
                details: [
                  { path: 'name', code: 'already_exists', message: '', recordId: archived.id },
                ],
              },
            },
            409,
          ),
      },
    });
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: en.classes.add }).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole('button', { name: en.classes.add }));
    const form = within(
      await screen.findByRole('complementary', { name: en.classes.newTitle }),
    ).getByRole('form', { name: en.classes.newTitle });
    type(field(form, en.classes.grade), '7');
    type(field(form, en.classes.className), 'yale');
    type(field(form, en.classes.maxSize), '25');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    fireEvent.click(await within(form).findByRole('button', { name: en.classes.takenOpen }));
    // What was typed is not saved: the page asks before it leaves it.
    await confirmWith(en.unsent.leave);
    const panel = await screen.findByRole('complementary', { name: '7 Yale' });
    expect(panelActionNames(panel)).toContain(en.classes.restoreClass);
  });

  // Decision 12: "An action whose prerequisite is missing is switched off and says what is missing."
  it('switches "New class" off while the branch has no planned or current year, and says why', async () => {
    await openList({ years: [{ ...YEAR, status: 'closed' }] });
    await waitFor(() => {
      expect(screen.getByText(en.classes.needYear)).toBeDefined();
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.classes.add }).disabled).toBe(
      true,
    );
  });
});

describe('a class in the side panel', () => {
  it('shows the record and its Tutors, edits it with its version, actions at the bottom', async () => {
    const calls = await openList({
      extra: {
        [`PUT /api/classes/${OXFORD.id}`]: (body) =>
          json(detailOf({ ...OXFORD, ...(body as object), version: 1 })),
      },
    });
    fireEvent.click(rowButton('7 Oxford'));
    const panel = await screen.findByRole('complementary', { name: '7 Oxford' });
    await within(panel).findByText(en.classes.tutors);
    expect(within(panel).getByText(`${en.classes.kinds.tutor}: Tursunova Dilnoza`)).toBeDefined();
    expect(panelActionNames(panel)).toEqual([en.form.edit, en.classes.archiveClass]);
    expect(actionsAreLast(panel)).toBe(true);
    const form = await edit(panel, '7 Oxford');
    // The year is fixed after the create (decision 6).
    expect(within(form).queryByLabelText(en.classes.year)).toBeNull();
    type(field(form, en.classes.maxSize), '30');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await savedInPanel(panel);
    expect(calls.find((call) => call.route === `PUT /api/classes/${OXFORD.id}`)?.body).toEqual({
      version: 0,
      grade: 7,
      name: 'Oxford',
      language: 'uz',
      mainRoomId: uid(2),
      maxSize: 30,
    });
  });

  it('gives a Tutor, showing a person without the class language but not letting them be chosen', async () => {
    const calls = await openList({
      extra: {
        [`POST /api/classes/${OXFORD.id}/tutors`]: () =>
          json(detailOf(OXFORD, [tutorRow(2, { kind: 'acting', state: 'planned' })]), 201),
      },
    });
    fireEvent.click(rowButton('7 Oxford'));
    const panel = await screen.findByRole('complementary', { name: '7 Oxford' });
    fireEvent.click(await within(panel).findByRole('button', { name: en.classes.setActing }));
    const form = await within(panel).findByRole('form', { name: en.classes.setActing });
    const person = await within(form).findByLabelText<HTMLSelectElement>(en.classes.person);
    const options = [...person.options].map((option) => [option.textContent, option.disabled]);
    expect(options).toEqual([
      [en.classes.choosePerson, false],
      ['Rahimova Kamola', false],
      ['Ivanov Sergey (does not teach in Uzbek)', true],
    ]);
    type(person, uid(601));
    type(field(form, en.classes.until), '2026-11-01');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await savedInPanel(panel);
    expect(
      calls.find((call) => call.route === `POST /api/classes/${OXFORD.id}/tutors`)?.body,
    ).toEqual({
      assignmentId: uid(601),
      kind: 'acting',
      from: TODAY,
      until: '2026-11-01',
    });
  });

  it('shows a refusal of the language rule as its text', async () => {
    await openList({
      extra: {
        [`POST /api/classes/${PRINCETON.id}/tutors`]: () => refusal('tutor_language', 409),
      },
    });
    fireEvent.click(rowButton('8 Princeton'));
    const panel = await screen.findByRole('complementary', { name: '8 Princeton' });
    fireEvent.click(await within(panel).findByRole('button', { name: en.classes.giveTutor }));
    const form = await within(panel).findByRole('form', { name: en.classes.giveTutor });
    type(await within(form).findByLabelText(en.classes.person), uid(601));
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect((await within(form).findByRole('alert')).textContent).toBe(en.errors.tutor_language);
  });

  it('ends a Tutor from a date after asking', async () => {
    const calls = await openList({
      extra: {
        [`POST /api/classes/${OXFORD.id}/tutors/${uid(301)}/end`]: () =>
          json(
            detailOf({ ...OXFORD, tutor: null }, [tutorRow(1, { state: 'ended', until: TODAY })]),
          ),
      },
    });
    fireEvent.click(rowButton('7 Oxford'));
    const panel = await screen.findByRole('complementary', { name: '7 Oxford' });
    fireEvent.click(await within(panel).findByRole('button', { name: en.classes.endTutor }));
    const form = await within(panel).findByRole('form', { name: en.classes.endTutor });
    expect(field(form, en.classes.endOn).value).toBe(TODAY);
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await confirmWith(en.classes.end);
    await savedInPanel(panel);
    expect(
      calls.find((call) => call.route === `POST /api/classes/${OXFORD.id}/tutors/${uid(301)}/end`)
        ?.body,
    ).toEqual({ from: TODAY });
  });

  it('archives a class after naming it and its Tutors', async () => {
    const calls = await openList({
      extra: {
        [`POST /api/classes/${OXFORD.id}/archive`]: () =>
          json(detailOf({ ...OXFORD, archived: true, tutor: null })),
      },
    });
    fireEvent.click(rowButton('7 Oxford'));
    const panel = await screen.findByRole('complementary', { name: '7 Oxford' });
    fireEvent.click(await within(panel).findByRole('button', { name: en.classes.archiveClass }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('7 Oxford');
    expect(dialog.textContent).toContain(`${en.classes.kinds.tutor}: Tursunova Dilnoza`);
    fireEvent.click(within(dialog).getByRole('button', { name: en.classes.archiveClass }));
    await waitFor(() => {
      expect(calls.some((call) => call.route === `POST /api/classes/${OXFORD.id}/archive`)).toBe(
        true,
      );
    });
  });

  it('shows the Principal the classes read only', async () => {
    const calls = await openList({ session: principal() });
    expect(screen.queryByRole('button', { name: en.classes.add })).toBeNull();
    fireEvent.click(rowButton('7 Oxford'));
    const panel = await screen.findByRole('complementary', { name: '7 Oxford' });
    await within(panel).findByText(en.classes.tutors);
    expect(panelActionNames(panel)).toEqual([]);
    expect(within(panel).queryByRole('button', { name: en.classes.giveTutor })).toBeNull();
    expect(calls.some((call) => call.route === 'GET /api/classes/tutor-candidates')).toBe(false);
  });
});
