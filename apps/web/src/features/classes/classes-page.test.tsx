import {
  CLASS_EXPORT_COLUMNS,
  EXPORT_TEXTS,
  type AcademicYear,
  type ClassDetail,
  type ClassMember,
  type ClassTutor,
  type Room,
  type SchoolClass,
  type StudentListItem,
  type Subject,
  type TutorCandidate,
} from '@sodiq/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { actionsAreLast, edit, panelActionNames, savedInPanel } from '@/testing/panel';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf, SOUTH } from '@/testing/render-app';
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
  students: 0,
  tutor: null,
  acting: null,
  archived: false,
  version: 0,
  ...fields,
});

const OXFORD = schoolClass(1, { tutor: tutorRow(1), students: 12 });
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
    // Task 3.1b: the Students tab, empty unless a test names its members.
    ...Object.fromEntries(
      classes.map((one) => [
        `GET /api/classes/${one.id}/members`,
        () => json({ members: [], freeToday: one.maxSize, freeLeast: one.maxSize, today: TODAY }),
      ]),
    ),
    // The students a class can take (task 3.1b), none unless a test names them.
    'GET /api/people/students': () =>
      json({
        students: [],
        canArchive: true,
        exportGroups: [],
        readsFinancial: false,
        today: TODAY,
      }),
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
      ['7 Oxford', '2026–2027', 'Uzbek', 'Tursunova Dilnoza', '204', '12', '25', 'Active'],
      ['8 Princeton', '2026–2027', 'Russian', en.classes.noTutor, 'None', '0', '25', 'Active'],
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

  // Correction 6: the search compares the fold of the unique name.
  it('finds a class typed with look-alike Cyrillic letters', async () => {
    await openList();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Рrincеton' } });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    expect(rowsDrawn()[0]?.[0]).toBe('8 Princeton');
  });

  // `05`, class cards; decision 13: the figures show "—" until the journal; the count comes with 3.1b.
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
    // Task 3.1b: the members today.
    const oxford = screen.getByRole('button', { name: '7 Oxford' }).closest('li');
    const count = [...(oxford?.querySelectorAll('div') ?? [])].find(
      (term) => term.querySelector('dt')?.textContent === en.classes.students,
    );
    expect(count?.querySelector('dd')?.textContent).toBe('12');
    setWindowWidth(1440);
  });

  it('has the columns of the export file, with the same headings', () => {
    expect([...CLASS_EXPORT_COLUMNS]).toEqual([
      'name',
      'year',
      'language',
      'tutor',
      'mainRoom',
      'students',
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
                requestId: 'test-request',
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
    // Issue #105, H4: the refusal names the class that holds the name, as stored.
    expect(
      await within(form).findByText(
        en.classes.nameTaken.replace('{{grade}}', '7').replace('{{name}}', 'Yale'),
      ),
    ).toBeDefined();
    fireEvent.click(await within(form).findByRole('button', { name: en.classes.takenOpen }));
    // What was typed is not saved: the page asks before it leaves it.
    await confirmWith(en.unsent.leave);
    const panel = await screen.findByRole('complementary', { name: '7 Yale' });
    expect(panelActionNames(panel)).toContain(en.classes.restoreClass);
  });

  // Issue #105, H4, and `.claude/rules/web.md`: a holder the list does not
  // hold keeps the general text and reads the list again; never a blank.
  it('keeps the general refusal for a holder the list does not hold, and reads the list again', async () => {
    const refused = refusal('already_exists', 409);
    const body = (await refused.clone().json()) as { error: object };
    const calls = await openList({
      extra: {
        'POST /api/classes': () =>
          json(
            {
              error: {
                ...body.error,
                requestId: 'test-request',
                details: [
                  { path: 'name', code: 'already_exists', message: '', recordId: uid(199) },
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
    const before = calls.filter((call) => call.route === 'GET /api/classes').length;
    fireEvent.click(screen.getByRole('button', { name: en.classes.add }));
    const form = within(
      await screen.findByRole('complementary', { name: en.classes.newTitle }),
    ).getByRole('form', { name: en.classes.newTitle });
    type(field(form, en.classes.grade), '7');
    type(field(form, en.classes.className), 'Harvard');
    type(field(form, en.classes.maxSize), '25');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(await within(form).findByText(en.errors.already_exists)).toBeDefined();
    await waitFor(() => {
      expect(calls.filter((call) => call.route === 'GET /api/classes').length).toBeGreaterThan(
        before,
      );
    });
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
      // Task 3.2a, decision 8: nothing to confirm about its groups.
      confirmMixedGroups: false,
      grade: 7,
      name: 'Oxford',
      language: 'uz',
      mainRoomId: uid(2),
      maxSize: 30,
    });
  });

  // Task 3.5b, H32 of issue #105: a branch switch closes the panel of the old
  // branch's record, asking first about typed changes, and no request for it
  // goes with the new branch.
  describe('a branch switch', () => {
    const twoBranches = () =>
      sessionOf({
        assignments: [
          { role: 'academic_vice_principal', branchId: NORTH.id },
          { role: 'academic_vice_principal', branchId: SOUTH.id },
        ],
        branches: [NORTH, SOUTH],
      });

    /** The branch header of every request, by route, as fetch sends them. */
    function headersSeen(): { route: string; branch: string | null }[] {
      const seen: { route: string; branch: string | null }[] = [];
      const inner = globalThis.fetch;
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>((input, init) => {
          if (input instanceof Request) {
            seen.push({
              route: `${input.method} ${new URL(input.url).pathname}`,
              branch: input.headers.get('X-Branch-Id'),
            });
          }
          return inner(input, init);
        }),
      );
      return seen;
    }

    const switchTo = (branchId: string) => {
      fireEvent.change(screen.getByRole('combobox', { name: en.switcher.branch }), {
        target: { value: branchId },
      });
    };

    it('asks about typed changes, then closes the panel; no request for the record goes with the new branch', async () => {
      await openList({ session: twoBranches() });
      const seen = headersSeen();
      fireEvent.click(rowButton('7 Oxford'));
      const panel = await screen.findByRole('complementary', { name: '7 Oxford' });
      const form = await edit(panel, '7 Oxford');
      type(field(form, en.classes.maxSize), '30');
      switchTo(SOUTH.id);
      await confirmWith(en.unsent.leave);
      await waitFor(() => {
        expect(screen.queryByRole('complementary', { name: '7 Oxford' })).toBeNull();
      });
      await waitFor(() => {
        expect(
          screen.getByRole<HTMLSelectElement>('combobox', { name: en.switcher.branch }).value,
        ).toBe(SOUTH.id);
      });
      await waitFor(() => {
        expect(seen.some((one) => one.branch === SOUTH.id)).toBe(true);
      });
      expect(
        seen.filter((one) => one.route.includes(OXFORD.id) && one.branch === SOUTH.id),
      ).toEqual([]);
      expect(new URL(window.location.href).searchParams.get('open')).toBeNull();
    });

    it('keeps the branch and the form when the person stays', async () => {
      await openList({ session: twoBranches() });
      fireEvent.click(rowButton('7 Oxford'));
      const panel = await screen.findByRole('complementary', { name: '7 Oxford' });
      const form = await edit(panel, '7 Oxford');
      type(field(form, en.classes.maxSize), '30');
      switchTo(SOUTH.id);
      await confirmWith(en.unsent.stay);
      expect(
        screen.getByRole<HTMLSelectElement>('combobox', { name: en.switcher.branch }).value,
      ).toBe(NORTH.id);
      expect(field(form, en.classes.maxSize).value).toBe('30');
    });

    it('closes a panel with nothing typed without asking', async () => {
      await openList({ session: twoBranches() });
      fireEvent.click(rowButton('7 Oxford'));
      await screen.findByRole('complementary', { name: '7 Oxford' });
      switchTo(SOUTH.id);
      await waitFor(() => {
        expect(screen.queryByRole('complementary', { name: '7 Oxford' })).toBeNull();
      });
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });

  // "Class changed, reload": the form closes, the class is read again, the refusal stays.
  it('reads the class again after a change made on an old state', async () => {
    let reads = 0;
    await openList({
      extra: {
        [`GET /api/classes/${OXFORD.id}`]: () => {
          reads += 1;
          return json(detailOf({ ...OXFORD, version: reads > 1 ? 1 : 0 }));
        },
        [`PUT /api/classes/${OXFORD.id}`]: () => refusal('class_changed', 409),
      },
    });
    fireEvent.click(rowButton('7 Oxford'));
    const panel = await screen.findByRole('complementary', { name: '7 Oxford' });
    const form = await edit(panel, '7 Oxford');
    type(field(form, en.classes.maxSize), '30');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(within(panel).queryByRole('form')).toBeNull();
    });
    expect((await within(panel).findByRole('alert')).textContent).toBe(en.errors.class_changed);
    await waitFor(() => {
      expect(reads).toBeGreaterThan(1);
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

  // Task 3.5b, H22 of issue #105.
  it('says what to do when nobody holds the Tutor role, with a link to Staff and no Save', async () => {
    await openList({
      extra: { 'GET /api/classes/tutor-candidates': () => json({ candidates: [] }) },
    });
    fireEvent.click(rowButton('7 Oxford'));
    const panel = await screen.findByRole('complementary', { name: '7 Oxford' });
    fireEvent.click(await within(panel).findByRole('button', { name: en.classes.setActing }));
    expect(await within(panel).findByText(en.classes.noCandidates)).toBeDefined();
    expect(
      within(panel).getByRole('link', { name: en.classes.openStaff }).getAttribute('href'),
    ).toBe('/people/staff');
    expect(within(panel).queryByRole('button', { name: en.form.save })).toBeNull();
    expect(within(panel).queryByLabelText(en.classes.from)).toBeNull();
  });

  // Task 3.5b, H23 of issue #105: the refusal up front.
  it('switches Archive off with the reason while the class has a student in force or planned', async () => {
    const member = (n: number, state: 'current' | 'planned') => ({
      id: uid(820 + n),
      studentId: uid(920 + n),
      uid: `26070${String(n)}`,
      firstName: 'Malika',
      lastName: 'Karimova',
      from: '2026-09-02',
      until: '2027-06-01',
      state,
    });
    for (const members of [[member(1, 'current'), member(2, 'planned')], [member(3, 'planned')]]) {
      await openList({
        extra: {
          [`GET /api/classes/${OXFORD.id}/members`]: () =>
            json({ members, freeToday: 20, freeLeast: 19, today: TODAY }),
        },
      });
      fireEvent.click(rowButton('7 Oxford'));
      const panel = await screen.findByRole('complementary', { name: '7 Oxford' });
      const text = (
        members.length === 1
          ? en.classes.archiveHasStudents_one
          : en.classes.archiveHasStudents_other
      ).replace('{{count}}', String(members.length));
      expect(await within(panel).findByText(text)).toBeDefined();
      expect(
        within(panel).getByRole<HTMLButtonElement>('button', { name: en.classes.archiveClass })
          .disabled,
      ).toBe(true);
      cleanup();
    }
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

// Task 3.1b, pull request #89: the Students tab of a class, "Put into a class"
// from it, and the withdraw of a planned placement (decisions 5, 6 and 10).
describe('the students of a class', () => {
  const member = (n: number, fields: Partial<ClassMember> = {}): ClassMember => ({
    id: uid(800 + n),
    studentId: uid(900 + n),
    uid: `26070${String(n).padStart(2, '0')}`,
    firstName: 'Malika',
    lastName: `Rahimova${'a'.repeat(n)}`,
    from: '2026-09-02',
    until: '2027-06-01',
    state: 'current',
    ...fields,
  });
  const pupil = (n: number, fields: Partial<StudentListItem> = {}): StudentListItem => ({
    id: uid(950 + n),
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
    class: null,
    plannedClass: null,
    tutor: null,
    actingTutor: null,
    groups: [],
    version: 1,
    opens: true,
    ...fields,
  });

  it('lists the members with the free seats and puts the ticked students into the class from a date', async () => {
    const tab = {
      members: [member(1), member(2, { state: 'planned', from: '2026-11-02' })],
      freeToday: 24,
      freeLeast: 23,
      today: TODAY,
    };
    const calls = await openList({
      extra: {
        [`GET /api/classes/${OXFORD.id}/members`]: () => json(tab),
        'GET /api/people/students': () =>
          json({
            students: [
              pupil(1),
              pupil(2, { version: 3, startsOn: '2026-10-19' }),
              // Of another grade, or in a class already: not offered.
              pupil(3, { grade: 8 }),
              pupil(4, {
                plannedClass: {
                  id: PRINCETON.id,
                  grade: 7,
                  name: 'Yale',
                  language: 'uz',
                  from: '2026-11-02',
                  until: '2027-06-01',
                },
              }),
            ],
            canArchive: true,
            exportGroups: [],
            readsFinancial: false,
            today: TODAY,
          }),
        // Task 3.2c: the answer names the groups placed automatically, none here.
        [`POST /api/classes/${OXFORD.id}/members`]: () => json({ ...tab, groupsPlaced: [] }, 201),
      },
    });
    fireEvent.click(rowButton('7 Oxford'));
    const panel = await screen.findByRole('complementary', { name: '7 Oxford' });
    expect(await within(panel).findByText('Rahimovaa Malika')).toBeDefined();
    expect(
      within(panel).getByText(en.classes.joinsOn.replace('{{date}}', '2 November 2026')),
    ).toBeDefined();
    expect(panel.textContent).toContain(en.classes.freeToday.replace('{{n}}', '24'));
    expect(panel.textContent).toContain(en.classes.freeLeast.replace('{{n}}', '23'));
    fireEvent.click(within(panel).getByRole('button', { name: en.classes.putIntoClass }));
    const form = await within(panel).findByRole('form', {
      name: en.classes.putIntoNamed.replace('{{class}}', '7 Oxford'),
    });
    const offered = within(form)
      .getAllByRole('checkbox')
      .map((box) => box.closest('label')?.textContent);
    expect(offered).toEqual(['Yusupovaa Shahlo (2607101)', 'Yusupovaaa Shahlo (2607102)']);
    // The date takes today by default, and a student who starts later moves it
    // while no other date is typed (decision 6).
    expect(field(form, en.classes.from).value).toBe(TODAY);
    fireEvent.click(within(form).getByLabelText('Yusupovaaa Shahlo (2607102)'));
    await waitFor(() => {
      expect(field(form, en.classes.from).value).toBe('2026-10-19');
    });
    type(field(form, en.classes.from), '2026-10-20');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await savedInPanel(panel);
    expect(
      calls.find((call) => call.route === `POST /api/classes/${OXFORD.id}/members`)?.body,
    ).toEqual({ students: [{ id: uid(952), version: 3 }], from: '2026-10-20' });
  });

  it('names the students a placement refused', async () => {
    await openList({
      extra: {
        'GET /api/people/students': () =>
          json({
            students: [pupil(1), pupil(2)],
            canArchive: true,
            exportGroups: [],
            readsFinancial: false,
            today: TODAY,
          }),
        [`POST /api/classes/${OXFORD.id}/members`]: () =>
          Response.json(
            {
              error: {
                code: 'student_changed',
                message: 'ENGLISH TEXT FOR THE DEVELOPER',
                requestId: 'test-request',
                details: [
                  { path: 'students.1', code: 'student_changed', message: '', recordId: uid(952) },
                ],
              },
            },
            { status: 409 },
          ),
      },
    });
    fireEvent.click(rowButton('7 Oxford'));
    const panel = await screen.findByRole('complementary', { name: '7 Oxford' });
    fireEvent.click(await within(panel).findByRole('button', { name: en.classes.putIntoClass }));
    const form = await within(panel).findByRole('form', {
      name: en.classes.putIntoNamed.replace('{{class}}', '7 Oxford'),
    });
    fireEvent.click(within(form).getByLabelText('Yusupovaa Shahlo (2607101)'));
    fireEvent.click(within(form).getByLabelText('Yusupovaaa Shahlo (2607102)'));
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(
      await within(form).findByText(
        en.classes.refusedNames.replace('{{names}}', 'Yusupovaaa Shahlo'),
      ),
    ).toBeDefined();
    expect((await within(form).findByRole('alert')).textContent).toBe(en.errors.student_changed);
  });

  // Task 3.2c, decision 3 and should-fix 8 of the plan review: the refusal
  // names the subject from the subjects list, and says it without the name
  // when the list does not hold it.
  it('names the subject without a group seat, and falls back without the name, in Russian too', async () => {
    const maths: Subject = {
      departmentSince: null,
      id: uid(201),
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
    };
    for (const [language, subjects] of [
      ['en', [maths]],
      ['ru', []],
    ] as const) {
      cleanup();
      const calls = await openList({
        language,
        extra: {
          'GET /api/people/students': () =>
            json({
              students: [pupil(1)],
              canArchive: true,
              exportGroups: [],
              readsFinancial: false,
              today: TODAY,
            }),
          'GET /api/setup/subjects': () => json({ subjects, mayMoveDepartment: false }),
          [`POST /api/classes/${OXFORD.id}/members`]: () =>
            Response.json(
              {
                error: {
                  code: 'class_group_no_seat',
                  message: 'ENGLISH TEXT FOR THE DEVELOPER',
                  requestId: 'test-request',
                  details: [
                    {
                      path: 'students.0',
                      code: 'class_group_no_seat',
                      message: '',
                      recordId: uid(951),
                      subjectId: maths.id,
                    },
                  ],
                },
              },
              { status: 409 },
            ),
        },
      });
      const texts = language === 'en' ? en : ru;
      fireEvent.click(rowButton('7 Oxford'));
      const panel = await screen.findByRole('complementary', { name: '7 Oxford' });
      fireEvent.click(
        await within(panel).findByRole('button', { name: texts.classes.putIntoClass }),
      );
      const form = await within(panel).findByRole('form', {
        name: texts.classes.putIntoNamed.replace('{{class}}', '7 Oxford'),
      });
      fireEvent.click(within(form).getByLabelText('Yusupovaa Shahlo (2607101)'));
      fireEvent.click(within(form).getByRole('button', { name: texts.form.save }));
      expect((await within(form).findByRole('alert')).textContent).toBe(
        texts.errors.class_group_no_seat,
      );
      expect(
        await within(form).findByText(
          language === 'en'
            ? en.classes.groupNoSeat.replace('{{subjects}}', 'Mathematics')
            : ru.classes.groupNoSeatUnnamed,
        ),
      ).toBeDefined();
      expect(
        within(form).getByText(texts.classes.refusedNames.replace('{{names}}', 'Yusupovaa Shahlo')),
      ).toBeDefined();
      // A subject the list does not hold: the list is read again (.claude/rules/web.md).
      if (language === 'ru') {
        await waitFor(() => {
          expect(calls.filter((call) => call.route === 'GET /api/setup/subjects')).toHaveLength(2);
        });
      }
    }
  });

  it('withdraws a planned placement after asking, naming the student', async () => {
    const planned = member(2, { state: 'planned', from: '2026-11-02' });
    const calls = await openList({
      extra: {
        [`GET /api/classes/${OXFORD.id}/members`]: () =>
          json({ members: [member(1), planned], freeToday: 24, freeLeast: 23, today: TODAY }),
        [`POST /api/classes/${OXFORD.id}/members/${planned.id}/withdraw`]: () =>
          json({ members: [member(1)], freeToday: 24, freeLeast: 24, today: TODAY }),
      },
    });
    fireEvent.click(rowButton('7 Oxford'));
    const panel = await screen.findByRole('complementary', { name: '7 Oxford' });
    const withdraws = await within(panel).findAllByRole('button', { name: en.classes.withdraw });
    // Only the planned one: a placement in force is moved by a transfer.
    expect(withdraws).toHaveLength(1);
    fireEvent.click(withdraws[0] as HTMLElement);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Rahimovaaa Malika');
    fireEvent.click(within(dialog).getByRole('button', { name: en.classes.withdraw }));
    await waitFor(() => {
      expect(
        calls.some(
          (call) => call.route === `POST /api/classes/${OXFORD.id}/members/${planned.id}/withdraw`,
        ),
      ).toBe(true);
    });
  });

  it('shows the Principal the members without the actions', async () => {
    await openList({
      session: principal(),
      extra: {
        [`GET /api/classes/${OXFORD.id}/members`]: () =>
          json({
            members: [member(1), member(2, { state: 'planned', from: '2026-11-02' })],
            freeToday: 24,
            freeLeast: 23,
            today: TODAY,
          }),
      },
    });
    fireEvent.click(rowButton('7 Oxford'));
    const panel = await screen.findByRole('complementary', { name: '7 Oxford' });
    expect(await within(panel).findByText('Rahimovaa Malika')).toBeDefined();
    expect(within(panel).queryByRole('button', { name: en.classes.withdraw })).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.classes.putIntoClass })).toBeNull();
  });
});

// Task 3.1c, pull request #90: the Tutor sees own classes (the server answers
// them, decision 1), read only, and an empty list says why.
describe('the classes of a Tutor', () => {
  const tutor = () =>
    sessionOf({ assignments: [{ role: 'tutor', branchId: NORTH.id }], branches: [NORTH] });

  it('shows the classes the server answers, read only, with no form data asked', async () => {
    const calls = await openList({ session: tutor(), classes: [OXFORD] });
    expect(screen.queryByRole('button', { name: en.classes.add })).toBeNull();
    fireEvent.click(rowButton('7 Oxford'));
    const panel = await screen.findByRole('complementary', { name: '7 Oxford' });
    await within(panel).findByText(en.classes.tutors);
    expect(panelActionNames(panel)).toEqual([]);
    expect(within(panel).queryByRole('button', { name: en.classes.giveTutor })).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.classes.putIntoClass })).toBeNull();
    for (const route of [
      'GET /api/classes/tutor-candidates',
      'GET /api/setup/academic-years',
      'GET /api/setup/rooms',
    ]) {
      expect(calls.some((call) => call.route === route)).toBe(false);
    }
  });

  it('says a Tutor of no class has none', async () => {
    await openList({ session: tutor(), classes: [] });
    expect(await screen.findByText(en.classes.emptyTutor)).toBeDefined();
    expect(screen.queryByText(en.classes.empty)).toBeNull();
  });

  it('says it in Russian when Russian is chosen', async () => {
    await openList({ session: tutor(), classes: [], language: 'ru' });
    expect(await screen.findByText(ru.classes.emptyTutor)).toBeDefined();
  });
});

describe('the classes of a Tutor who also reads every class', () => {
  it('says the general line when another role of the branch reads every class', async () => {
    await openList({
      session: sessionOf({
        assignments: [
          { role: 'tutor', branchId: NORTH.id },
          { role: 'head_tutor', branchId: NORTH.id },
        ],
        branches: [NORTH],
      }),
      classes: [],
    });
    expect(await screen.findByText(en.classes.empty)).toBeDefined();
    expect(screen.queryByText(en.classes.emptyTutor)).toBeNull();
  });
});

// Issue #105, H19: the empty Classes page offers "New class" as a primary
// button; the header's keeps the id the new-record panel gives the focus back to.
describe('the empty Classes page', () => {
  it('offers "New class" as a primary button, without a second id', async () => {
    await openList({ classes: [] });
    const heading = await screen.findByRole('heading', { name: en.classes.emptyTitle });
    await waitFor(() => {
      expect(heading.parentElement?.querySelector('button')?.hasAttribute('disabled')).toBe(false);
    });
    const button = heading.parentElement?.querySelector('button');
    expect(button?.textContent).toBe(en.classes.add);
    expect(button?.dataset.variant).toBe('default');
    expect(button?.id).toBe('');
  });
});
