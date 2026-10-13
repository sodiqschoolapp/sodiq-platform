import type {
  AcademicYear,
  Division,
  Subject,
  SubjectQuarter,
  SubjectQuarterWeights,
} from '@sodiq/shared';
import { EXPORT_TEXTS, SUBJECT_EXPORT_COLUMNS } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';
import { savedRecordPanel } from '@/testing/new-record';

const PATH = '/setup/subjects';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const ARCHIVED_AT = '2026-10-09T04:00:00.000Z';

const STEAM = uid(11);
const TUTORS = uid(12);

const academic = (departments = [STEAM, TUTORS]): Division => ({
  id: uid(1),
  names: { uz: 'Oʻquv boʻlimi', ru: 'Учебный отдел', en: 'Academic' },
  builtIn: true,
  archivedAt: null,
  departments: [
    {
      id: STEAM,
      names: { uz: 'STEAM', ru: 'STEAM', en: 'STEAM' },
      archivedAt: departments.includes(STEAM) ? null : ARCHIVED_AT,
    },
    {
      id: TUTORS,
      names: { uz: 'Tyutorlar', ru: 'Тьюторы', en: 'Tutors' },
      archivedAt: departments.includes(TUTORS) ? null : ARCHIVED_AT,
    },
  ],
});

const MATHS: Subject = {
  id: uid(21),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  departmentId: STEAM,
  grades: [5, 6, 7],
  colour: 'blue',
  journalType: 'graded',
  ratingExam: true,
  groupSubject: false,
  languageRule: true,
  demanding: true,
  archivedAt: null,
  daily: { attendance: 10, classwork: 50, homework: 40 },
  quarterWeightsMissing: 3,
  quarterCount: 4,
};

const PHYSICS: Subject = {
  ...MATHS,
  id: uid(22),
  names: { uz: 'Fizika', ru: 'Физика', en: 'Physics' },
  colour: 'violet',
  ratingExam: false,
  demanding: false,
  daily: null,
  quarterWeightsMissing: 4,
  quarterCount: 4,
};

const SPIRIT: Subject = {
  ...MATHS,
  id: uid(23),
  names: { uz: 'Maʼnaviyat soati', ru: 'Час духовности', en: 'Spiritual hour' },
  departmentId: TUTORS,
  grades: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  colour: 'green',
  journalType: 'attendance_only',
  ratingExam: false,
  demanding: false,
  daily: null,
  quarterWeightsMissing: null,
  quarterCount: null,
};

const OLD: Subject = {
  ...PHYSICS,
  id: uid(24),
  names: { uz: 'Chizmachilik', ru: 'Черчение', en: 'Drawing' },
  archivedAt: ARCHIVED_AT,
  quarterWeightsMissing: 0,
};

const YEAR: AcademicYear = {
  id: uid(31),
  name: '2026–2027',
  startDate: '2026-09-01',
  endDate: '2027-06-30',
  status: 'current',
  quarters: [1, 2, 3, 4].map((number) => ({ number, startDate: null, endDate: null })),
};

const quarter = (number: number, weights: SubjectQuarter['weights'] = null): SubjectQuarter => ({
  quarterId: uid(40 + number),
  number,
  startDate: null,
  endDate: null,
  weights,
  fits: weights !== null,
});

const RATED = { attendance: 10, classwork: 30, homework: 20, ratingExam: 40 };

const superAdmin = () =>
  sessionOf({ assignments: [{ role: 'super_admin', branchId: null }], branches: [NORTH] });

const principal = () =>
  sessionOf({ assignments: [{ role: 'principal', branchId: NORTH.id }], branches: [NORTH] });

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

const rowButton = (name: string) => screen.getByText(name, { selector: 'button *, button' });

const type = (input: HTMLElement, value: string): void => {
  fireEvent.change(input, { target: { value } });
};

async function openList({
  session = superAdmin(),
  subjects = [MATHS, PHYSICS, SPIRIT, OLD],
  divisions = [academic()],
  years = [YEAR],
  quarters = [quarter(1), quarter(2), quarter(3), quarter(4)],
  extra = {},
  language = 'en',
  mayMoveDepartment = true,
}: {
  session?: ReturnType<typeof superAdmin>;
  subjects?: Subject[];
  divisions?: Division[];
  years?: AcademicYear[];
  quarters?: SubjectQuarter[];
  extra?: Record<string, (body: unknown) => Response>;
  language?: 'en' | 'ru';
  mayMoveDepartment?: boolean;
} = {}) {
  const account = { ...session, language };
  const answer = (rows: SubjectQuarter[]): SubjectQuarterWeights => ({
    yearId: YEAR.id,
    yearStatus: 'current',
    quarters: rows,
  });
  // The list read again after a new subject is saved holds it.
  const listed = [...subjects];
  const calls = fakeApi({
    'GET /api/auth/session': () => json(account),
    'GET /api/setup/subjects': () => json({ subjects: listed, mayMoveDepartment }),
    'GET /api/setup/divisions': () => json({ divisions, staffCounts: [] }),
    'GET /api/setup/academic-years': () => json({ years }),
    [`GET /api/setup/subjects/${MATHS.id}/quarter-weights`]: () => json(answer(quarters)),
    [`GET /api/setup/subjects/${PHYSICS.id}/quarter-weights`]: () => json(answer(quarters)),
    'POST /api/setup/subjects': (body) => {
      const added: Subject = {
        ...MATHS,
        ...(body as object),
        id: uid(25),
        quarterWeightsMissing: 4,
        quarterCount: 4,
      };
      listed.push(added);
      return json(added, 201);
    },
    [`GET /api/setup/subjects/${uid(25)}/quarter-weights`]: () => json(answer(quarters)),
    [`PUT /api/setup/subjects/${MATHS.id}`]: (body) => json({ ...MATHS, ...(body as object) }),
    [`PUT /api/setup/subjects/${PHYSICS.id}`]: (body) => json({ ...PHYSICS, ...(body as object) }),
    [`PUT /api/setup/subjects/${SPIRIT.id}`]: (body) => json({ ...SPIRIT, ...(body as object) }),
    [`PUT /api/setup/subjects/${MATHS.id}/daily-weights`]: (body) =>
      json({ ...MATHS, daily: body }),
    [`PUT /api/setup/subjects/${MATHS.id}/quarter-weights/${uid(41)}`]: (body) =>
      json(answer([quarter(1, body as SubjectQuarter['weights']), ...quarters.slice(1)])),
    [`POST /api/setup/subjects/${MATHS.id}/quarter-weights/copy`]: () =>
      json(answer([1, 2, 3, 4].map((number) => quarter(number, RATED)))),
    [`POST /api/setup/subjects/${OLD.id}/restore`]: () =>
      refusal('subject_department_archived', 409),
    ...extra,
  });
  const shell = renderApp(PATH, language);
  const texts = language === 'ru' ? (await import('@/i18n/locales/ru')).ru : en;
  await screen.findByRole('heading', { name: texts.setup.subjects.title });
  if (subjects.length > 0) {
    await screen.findByRole('table', { name: texts.setup.subjects.caption });
  }
  return { ...shell, calls };
}

async function goOn(action: string): Promise<void> {
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: action }));
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
}

const subjectsText = en.setup.subjects;

// docs/spec/05-classes-groups-subjects.md, Subject and "Grading weights on a
// subject"; the owner's answers 3 to 8; the plan approved on pull request #52.
describe('the subjects page', () => {
  it('lists the subjects with their department, grades, journal type and this branch daily distribution', async () => {
    await openList();

    expect(rowsDrawn().map((row) => row.slice(1, 8))).toEqual([
      [
        'Mathematics',
        'STEAM',
        // Grades as ranges, quarters "n of N" (findings 19 and 20).
        '5–7',
        subjectsText.journalTypes.graded,
        subjectsText.yes,
        '10 · 50 · 40',
        '3 of 4 not set',
      ],
      [
        'Physics',
        'STEAM',
        '5–7',
        subjectsText.journalTypes.graded,
        subjectsText.no,
        subjectsText.notSet,
        '4 of 4 not set',
      ],
      [
        'Spiritual hour',
        'Tutors',
        '1–11',
        subjectsText.journalTypes.attendance_only,
        subjectsText.no,
        subjectsText.none,
        subjectsText.none,
      ],
      [
        'Drawing',
        'STEAM',
        '5–7',
        subjectsText.journalTypes.graded,
        subjectsText.no,
        subjectsText.notSet,
        subjectsText.allSet,
      ],
    ]);
  });

  it('names the subjects in Russian when Russian is chosen', async () => {
    await openList({ subjects: [MATHS, PHYSICS], language: 'ru' });

    expect(rowsDrawn().map((row) => row[1])).toEqual(['Математика', 'Физика']);
  });

  // The build plan's "done when": a graded subject cannot be saved with
  // weights that do not total 100.
  it('refuses a new graded subject whose daily distribution totals 99 without calling, and saves it at 100', async () => {
    const { calls } = await openList();

    fireEvent.click(screen.getByRole('button', { name: subjectsText.add }));
    // In the side panel beside the list (task 2.7c-2a), not above it.
    const form = within(
      await screen.findByRole('complementary', { name: subjectsText.newTitle }),
    ).getByRole('form', { name: subjectsText.newTitle });
    type(within(form).getByLabelText(subjectsText.nameUz), 'Kimyo');
    type(within(form).getByLabelText(subjectsText.nameRu), 'Химия');
    type(within(form).getByLabelText(subjectsText.nameEn), 'Chemistry');
    fireEvent.change(within(form).getByLabelText(subjectsText.department), {
      target: { value: STEAM },
    });
    fireEvent.click(within(form).getByLabelText(subjectsText.grade.replace('{{grade}}', '8')));
    fireEvent.click(within(form).getByLabelText(subjectsText.grade.replace('{{grade}}', '9')));
    type(within(form).getByLabelText(subjectsText.parts.attendance), '10');
    type(within(form).getByLabelText(subjectsText.parts.classwork), '50');
    type(within(form).getByLabelText(subjectsText.parts.homework), '39');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    expect(await within(form).findByText(subjectsText.totalWrong, { exact: false })).toBeDefined();
    expect(calls.some((call) => call.route === 'POST /api/setup/subjects')).toBe(false);

    type(within(form).getByLabelText(subjectsText.parts.homework), '40');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(calls.find((call) => call.route === 'POST /api/setup/subjects')?.body).toEqual({
        names: { uz: 'Kimyo', ru: 'Химия', en: 'Chemistry' },
        departmentId: STEAM,
        grades: [8, 9],
        colour: 'blue',
        journalType: 'graded',
        ratingExam: false,
        groupSubject: false,
        languageRule: true,
        demanding: false,
        daily: { attendance: 10, classwork: 50, homework: 40 },
      });
    });
    // The panel shows the saved record (task 2.7c-2a).
    await savedRecordPanel(subjectsText.newTitle);
  });

  it('sends an attendance-only subject without weights and without a rating exam', async () => {
    const { calls } = await openList();

    fireEvent.click(screen.getByRole('button', { name: subjectsText.add }));
    // In the side panel beside the list (task 2.7c-2a), not above it.
    const form = within(
      await screen.findByRole('complementary', { name: subjectsText.newTitle }),
    ).getByRole('form', { name: subjectsText.newTitle });
    type(within(form).getByLabelText(subjectsText.nameUz), 'Uy vazifasi soati');
    type(within(form).getByLabelText(subjectsText.nameRu), 'Час домашнего задания');
    type(within(form).getByLabelText(subjectsText.nameEn), 'Homework slot');
    fireEvent.change(within(form).getByLabelText(subjectsText.department), {
      target: { value: TUTORS },
    });
    fireEvent.click(within(form).getByLabelText(subjectsText.grade.replace('{{grade}}', '5')));
    fireEvent.change(within(form).getByLabelText(subjectsText.journalType), {
      target: { value: 'attendance_only' },
    });
    expect(within(form).queryByLabelText(subjectsText.parts.attendance)).toBeNull();
    expect(within(form).queryByLabelText(subjectsText.ratingExam)).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(calls.find((call) => call.route === 'POST /api/setup/subjects')?.body).toMatchObject({
        journalType: 'attendance_only',
        ratingExam: false,
        daily: null,
      });
    });
  });

  // The review's correction 1: a switched-off action says what is missing.
  it('switches "Add subject" off and says why while Academic has no active department', async () => {
    await openList({ divisions: [academic([])] });

    expect(screen.getByRole('button', { name: subjectsText.add })).toHaveProperty('disabled', true);
    expect(screen.getByText(subjectsText.needsDepartment)).toBeDefined();
  });

  it('changes the daily distribution on its own route and keeps the other fields out of it', async () => {
    const { calls } = await openList();
    fireEvent.click(rowButton('Mathematics'));
    const panel = await screen.findByRole('complementary', { name: 'Mathematics' });

    const daily = within(panel).getByRole('form', { name: subjectsText.daily });
    type(within(daily).getByLabelText(subjectsText.parts.attendance), '20');
    type(within(daily).getByLabelText(subjectsText.parts.classwork), '40');
    fireEvent.click(within(daily).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `PUT /api/setup/subjects/${MATHS.id}/daily-weights`)
          ?.body,
      ).toEqual({ attendance: 20, classwork: 40, homework: 40 });
    });
  });

  // Decision 15: an edit carries the daily distribution only while the branch has none.
  it('asks for the daily distribution in the edit of a graded subject this branch has none for', async () => {
    const { calls } = await openList();
    fireEvent.click(rowButton('Physics'));
    const panel = await screen.findByRole('complementary', { name: 'Physics' });

    const form = within(panel).getByRole('form', { name: 'Physics' });
    type(within(form).getByLabelText(subjectsText.parts.attendance), '20');
    type(within(form).getByLabelText(subjectsText.parts.classwork), '40');
    type(within(form).getByLabelText(subjectsText.parts.homework), '40');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `PUT /api/setup/subjects/${PHYSICS.id}`)?.body,
      ).toMatchObject({ daily: { attendance: 20, classwork: 40, homework: 40 } });
    });
  });

  // Issue #39, hand test of 13 October 2026, finding 18 (task 2.7b-2, decision
  // 7): a save that changes what the form shows keeps the form and its sign.
  it('keeps "Saved." after an edit that gives the subject its daily distribution, and after a daily change', async () => {
    let subjects = [MATHS, PHYSICS, SPIRIT, OLD];
    const saveOne = (one: Subject) => (body: unknown) => {
      const saved = { ...one, ...(body as object) };
      subjects = subjects.map((item) => (item.id === one.id ? saved : item));
      return json(saved);
    };
    await openList({
      extra: {
        'GET /api/setup/subjects': () => json({ subjects, mayMoveDepartment: true }),
        [`PUT /api/setup/subjects/${PHYSICS.id}`]: saveOne(PHYSICS),
        [`PUT /api/setup/subjects/${MATHS.id}/daily-weights`]: (body) =>
          saveOne(MATHS)({ daily: body }),
      },
    });
    fireEvent.click(rowButton('Physics'));
    let panel = await screen.findByRole('complementary', { name: 'Physics' });
    const form = within(panel).getByRole('form', { name: 'Physics' });
    type(within(form).getByLabelText(subjectsText.parts.attendance), '20');
    type(within(form).getByLabelText(subjectsText.parts.classwork), '40');
    type(within(form).getByLabelText(subjectsText.parts.homework), '40');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(within(form).getByRole('status').textContent).toBe(en.form.saved);
    });
    await waitFor(() => {
      expect(subjects.find((one) => one.id === PHYSICS.id)?.daily).not.toBeNull();
    });
    expect(form.isConnected).toBe(true);
    expect(within(form).getByRole('status').textContent).toBe(en.form.saved);

    fireEvent.click(rowButton('Mathematics'));
    panel = await screen.findByRole('complementary', { name: 'Mathematics' });
    const daily = within(panel).getByRole('form', { name: subjectsText.daily });
    type(within(daily).getByLabelText(subjectsText.parts.attendance), '20');
    type(within(daily).getByLabelText(subjectsText.parts.classwork), '40');
    fireEvent.click(within(daily).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(within(daily).getByRole('status').textContent).toBe(en.form.saved);
    });
  });

  // Decision 14: an attendance-only subject made graded again needs this
  // branch's daily distribution in the same request (the spec review).
  it('asks for the daily distribution when an attendance-only subject is made graded, and sends it', async () => {
    const { calls } = await openList();
    fireEvent.click(rowButton('Spiritual hour'));
    const panel = await screen.findByRole('complementary', { name: 'Spiritual hour' });
    const form = within(panel).getByRole('form', { name: 'Spiritual hour' });
    expect(within(form).queryByLabelText(subjectsText.parts.attendance)).toBeNull();

    fireEvent.change(within(form).getByLabelText(subjectsText.journalType), {
      target: { value: 'graded' },
    });
    type(within(form).getByLabelText(subjectsText.parts.attendance), '20');
    type(within(form).getByLabelText(subjectsText.parts.classwork), '40');
    type(within(form).getByLabelText(subjectsText.parts.homework), '40');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `PUT /api/setup/subjects/${SPIRIT.id}`)?.body,
      ).toMatchObject({
        journalType: 'graded',
        daily: { attendance: 20, classwork: 40, homework: 40 },
      });
    });
  });

  it('sets quarter 1 with four parts for a rating subject and copies it after asking when other quarters are set', async () => {
    const { calls } = await openList({
      quarters: [quarter(1, RATED), quarter(2), quarter(3, RATED), quarter(4)],
    });
    fireEvent.click(rowButton('Mathematics'));
    const panel = await screen.findByRole('complementary', { name: 'Mathematics' });

    const first = await within(panel).findByRole('form', {
      name: subjectsText.quarter.replace('{{n}}', '1'),
    });
    expect(within(first).getByLabelText(subjectsText.parts.ratingExam)).toHaveProperty(
      'value',
      '40',
    );
    type(within(first).getByLabelText(subjectsText.parts.classwork), '40');
    type(within(first).getByLabelText(subjectsText.parts.ratingExam), '30');
    fireEvent.click(within(first).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find(
          (call) => call.route === `PUT /api/setup/subjects/${MATHS.id}/quarter-weights/${uid(41)}`,
        )?.body,
      ).toEqual({ attendance: 10, classwork: 40, homework: 20, ratingExam: 30 });
    });

    fireEvent.click(within(panel).getByRole('button', { name: subjectsText.copy }));
    await goOn(subjectsText.copy);
    await waitFor(() => {
      expect(
        calls.find(
          (call) => call.route === `POST /api/setup/subjects/${MATHS.id}/quarter-weights/copy`,
        )?.body,
      ).toEqual({ yearId: YEAR.id });
    });
  });

  it('switches the copy off and says why while quarter 1 is not set', async () => {
    await openList();
    fireEvent.click(rowButton('Mathematics'));
    const panel = await screen.findByRole('complementary', { name: 'Mathematics' });

    const copy = await within(panel).findByRole('button', { name: subjectsText.copy });
    expect(copy).toHaveProperty('disabled', true);
    expect(within(panel).getByText(subjectsText.copyOff)).toBeDefined();
  });

  // The review's correction 1: without a planned or current year the section says so.
  it('says the quarterly distributions need a planned or current year when the branch has none', async () => {
    await openList({ years: [{ ...YEAR, status: 'closed' }] });
    fireEvent.click(rowButton('Mathematics'));
    const panel = await screen.findByRole('complementary', { name: 'Mathematics' });

    expect(await within(panel).findByText(subjectsText.noYear)).toBeDefined();
    expect(within(panel).queryByRole('button', { name: subjectsText.copy })).toBeNull();
  });

  // Decision 17: only the Super Admin moves a subject to another department.
  // Task 2.2a, decision 13 and correction 7 of the review of pull request #53:
  // the teachers of this branch by name, those of other branches as a number.
  it('names the teachers of the branch and counts the others when a grade cannot be removed', async () => {
    const teacher = uid(91);
    await openList({
      extra: {
        [`PUT /api/setup/subjects/${MATHS.id}`]: () =>
          Response.json(
            {
              error: {
                code: 'subject_has_teachers',
                message: 'ENGLISH TEXT FOR THE DEVELOPER',
                requestId: 'test-request',
                details: [
                  { path: `staff.${teacher}`, code: 'teaches', message: 'x' },
                  { path: 'elsewhere', code: '2', message: 'x' },
                ],
              },
            },
            { status: 409 },
          ),
        'GET /api/people/staff': () =>
          json({
            today: '2026-10-10',
            staff: [
              {
                id: teacher,
                staffId: 'S-260007',
                firstName: 'Zarina',
                lastName: 'Hamidova',
                fatherName: null,
                categories: [],
                branches: [{ branchId: NORTH.id, name: 'North', main: true }],
                divisions: [],
                subjects: [],
                languages: [],
                phone: '+998901112233',
                status: 'active',
                planned: null,
                photoId: null,
              },
            ],
          }),
      },
    });
    fireEvent.click(rowButton('Mathematics'));
    const panel = await screen.findByRole('complementary', { name: 'Mathematics' });
    const form = within(panel).getByRole('form', { name: 'Mathematics' });
    fireEvent.click(
      within(form).getByLabelText(subjectsText.grade.replace('{{grade}}', String(MATHS.grades[0]))),
    );
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    expect(
      await within(panel).findByText(
        subjectsText.teachersHere.replace('{{names}}', 'Hamidova Zarina'),
      ),
    ).toBeDefined();
    expect(
      within(panel).getByText(subjectsText.teachersElsewhere_other.replace('{{n}}', '2')),
    ).toBeDefined();
  });

  it('keeps the department of a subject fixed in the edit of the Academic Vice Principal, saying why', async () => {
    await openList({
      session: sessionOf({
        assignments: [{ role: 'academic_vice_principal', branchId: NORTH.id }],
        branches: [NORTH],
      }),
      mayMoveDepartment: false,
    });
    fireEvent.click(rowButton('Mathematics'));
    const panel = await screen.findByRole('complementary', { name: 'Mathematics' });

    const form = within(panel).getByRole('form', { name: 'Mathematics' });
    expect(within(form).getByLabelText(subjectsText.department)).toHaveProperty('disabled', true);
    expect(within(form).getByText(subjectsText.departmentLocked)).toBeDefined();
  });

  // The review of #52: the server decides the move from every current
  // assignment, so the screen follows its answer, not the role shown.
  it('lets an account that also holds the Super Admin move a subject while the Academic Vice Principal is shown', async () => {
    await openList({
      session: sessionOf({
        assignments: [
          { role: 'academic_vice_principal', branchId: NORTH.id },
          { role: 'super_admin', branchId: null },
        ],
        branches: [NORTH],
      }),
      mayMoveDepartment: true,
    });
    fireEvent.click(rowButton('Mathematics'));
    const panel = await screen.findByRole('complementary', { name: 'Mathematics' });

    const form = within(panel).getByRole('form', { name: 'Mathematics' });
    expect(within(form).getByLabelText(subjectsText.department)).toHaveProperty('disabled', false);
    expect(within(form).queryByText(subjectsText.departmentLocked)).toBeNull();
  });

  it('shows the Principal the list and the panel without add, forms or archive', async () => {
    await openList({ session: principal() });

    expect(screen.queryByRole('button', { name: subjectsText.add })).toBeNull();
    fireEvent.click(rowButton('Mathematics'));
    const panel = await screen.findByRole('complementary', { name: 'Mathematics' });
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(within(panel).getByText('10 · 50 · 40')).toBeDefined();
    expect(within(panel).queryByRole('button', { name: subjectsText.archiveSubject })).toBeNull();
  });

  it('names a subject that is not restored because its department is archived', async () => {
    await openList();
    fireEvent.click(rowButton('Drawing'));
    const panel = await screen.findByRole('complementary', { name: 'Drawing' });

    fireEvent.click(within(panel).getByRole('button', { name: subjectsText.restoreSubject }));
    await goOn(subjectsText.restore);

    expect(await within(panel).findByText(en.errors.subject_department_archived)).toBeDefined();
  });
});

/** The headers of the table, without the column of checkboxes. */
const headingsDrawn = (): string[] =>
  [...document.querySelectorAll('thead th')]
    .filter((cell) => cell.querySelector('input') === null)
    .map((cell) => cell.textContent ?? '');

// Task 2.2c-1: the Export button of the list, for the Principal too (`02`:
// "Exports are allowed"), and the columns of the file are those of the screen,
// with the same headings (`EXPORT_TEXTS` of `packages/shared`).
describe('the export of the subjects list', () => {
  it('is offered, and the columns of the screen are those of the file, with its headings', async () => {
    await openList({ session: principal() });
    expect(screen.getByRole('button', { name: en.list.export })).toBeTruthy();
    expect(headingsDrawn()).toEqual(
      SUBJECT_EXPORT_COLUMNS.map((key) => EXPORT_TEXTS.en.subjects.columns[key]),
    );
  });
});
