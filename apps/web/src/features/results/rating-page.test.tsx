import type {
  RatingChoices,
  RatingClassesList,
  RatingClassList,
  RatingSubjectList,
  SessionResponse,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e800-0000-7000-8000-${String(n).padStart(12, '0')}`;

const SUBJECT = {
  id: uid(10),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  colour: 'blue' as const,
};
const CLASS = { id: uid(20), name: '7 Oxford', grade: 7, language: 'uz' as const };
const OTHER = { id: uid(22), name: '7 Cambridge', grade: 7, language: 'ru' as const };
const JOURNAL = {
  id: uid(21),
  subject: SUBJECT,
  unit: { kind: 'class' as const, id: CLASS.id, name: CLASS.name },
  grades: [7],
  language: 'uz' as const,
};
const QUARTER = {
  id: uid(1),
  number: 1,
  startDate: '2026-09-01',
  endDate: '2026-10-31',
  closed: false,
  notOfficial: false,
};
const YEAR = {
  id: uid(2),
  startDate: '2026-09-01',
  endDate: '2027-05-31',
  status: 'current' as const,
};
const student = (n: number, firstName: string, lastName: string) => ({
  id: uid(50 + n),
  firstName,
  lastName,
  paternalName: null,
});

const CHOICES: RatingChoices = {
  year: YEAR,
  years: [YEAR],
  quarters: [QUARTER],
  journals: [JOURNAL],
  classes: [CLASS, OTHER],
  classesList: true,
};

// All names are invented. Task 9.3a: the rating (08, Rating; edge/calculation, "Two students both
// show 84": "places are numbered 1, 1, 3. Rating lists show one decimal").
const SUBJECT_LIST: RatingSubjectList = {
  quarter: QUARTER,
  provisional: true,
  prepared: { updatedAt: '2026-10-20T05:00:00.000Z', updating: false },
  final: null,
  journal: JOURNAL,
  rows: [
    {
      student: student(1, 'Aziz', 'Akbarov'),
      place: 1,
      value: 843,
      state: 'number',
      flags: [],
      leftSubjectOn: null,
    },
    {
      student: student(2, 'Bobur', 'Boboyev'),
      place: 1,
      value: 843,
      state: 'number',
      flags: [],
      leftSubjectOn: null,
    },
    {
      student: student(3, 'Dilnoza', 'Dadaxonova'),
      place: 3,
      value: 840,
      state: 'number',
      flags: ['few_lessons'],
      leftSubjectOn: null,
    },
    {
      student: student(4, 'Gulnora', 'Gulomova'),
      place: null,
      value: null,
      state: 'exempt',
      flags: [],
      leftSubjectOn: null,
    },
  ],
};

const CLASS_LIST: RatingClassList = {
  quarter: QUARTER,
  provisional: true,
  prepared: { updatedAt: '2026-10-20T05:00:00.000Z', updating: false },
  final: null,
  class: CLASS,
  rows: [
    {
      student: student(1, 'Aziz', 'Akbarov'),
      place: 1,
      value: 905,
      subjects: 9,
      fewerSubjects: false,
    },
    {
      student: student(4, 'Gulnora', 'Gulomova'),
      place: 2,
      value: 880,
      subjects: 10,
      fewerSubjects: true,
    },
  ],
};

const CLASSES_LIST: RatingClassesList = {
  quarter: { ...QUARTER, closed: true },
  provisional: false,
  prepared: { updatedAt: '2026-10-20T05:00:00.000Z', updating: false },
  final: { closedAt: '2026-10-31T13:00:00.000Z', version: 1 },
  grade: null,
  language: null,
  rows: [
    { class: CLASS, place: 1, value: 871, students: 24 },
    { class: OTHER, place: null, value: null, students: 0 },
  ],
};

const rowsOf = () =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

const open = (
  assignments: SessionResponse['assignments'],
  choices: RatingChoices = CHOICES,
  language: 'en' | 'ru' = 'en',
  path = '/results/rating',
) => {
  const calls = fakeApi({
    'GET /api/auth/session': () => json(sessionOf({ language, assignments })),
    'GET /api/results/rating/choices': () => json(choices),
    'GET /api/results/rating/subject': () => json(SUBJECT_LIST),
    'GET /api/results/rating/class': () => json(CLASS_LIST),
    'GET /api/results/rating/classes': () => json(CLASSES_LIST),
    'POST /api/results/rating/export': () =>
      new Response(new Blob(['xlsx']), {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename="rating-subject-1.xlsx"' },
      }),
  });
  renderApp(path, language);
  return calls;
};

describe('the rating page', () => {
  // Task 9.3b-1, edge/system-behaviour: "Prepared totals for reports show 'updated at'. A page
  // that finds them behind calculates from source and shows 'updating'." No call on a timer: the
  // person asks again with Refresh.
  it('shows "updating" with Refresh while the totals are behind, then the time they were updated', async () => {
    let answers = 0;
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'academic_vice_principal', branchId: NORTH.id }] })),
      'GET /api/results/rating/choices': () => json(CHOICES),
      'GET /api/results/rating/subject': () => {
        answers += 1;
        return json({
          ...SUBJECT_LIST,
          prepared:
            answers === 1
              ? { updatedAt: null, updating: true }
              : { updatedAt: '2026-10-20T05:00:00.000Z', updating: false },
        });
      },
    });
    renderApp('/results/rating');
    const state = async () =>
      (await waitFor(() => {
        const found = document.querySelector('[data-prepared-state]');
        expect(found).not.toBeNull();
        return found;
      })) as HTMLElement;
    expect((await state()).dataset.preparedState).toBe('updating');
    expect((await state()).textContent).toBe(en.prepared.updating);
    // The figures shown while updating are the server's, worked out from the journal.
    await waitFor(() => {
      expect(rowsOf()).toHaveLength(4);
    });
    const subjectCalls = () =>
      calls.filter((call) => call.route === 'GET /api/results/rating/subject').length;
    const before = subjectCalls();
    fireEvent.click(screen.getByRole('button', { name: en.prepared.refresh }));
    await waitFor(() => {
      expect(
        document.querySelector('[data-prepared-state]')?.getAttribute('data-prepared-state'),
      ).toBe('updated');
    });
    expect(subjectCalls()).toBe(before + 1);
    expect(document.querySelector('[data-prepared-state]')?.textContent).toMatch(/^Updated /);
    expect(screen.queryByRole('button', { name: en.prepared.refresh })).toBeNull();
  });

  it('shows the places, one decimal and the students without a number, marked provisional', async () => {
    open([{ role: 'academic_vice_principal', branchId: NORTH.id }]);
    await screen.findByRole('heading', { name: en.results.ratingList.title });
    await waitFor(() => {
      expect(rowsOf().map((row) => row.slice(0, 4))).toEqual([
        ['1', 'Akbarov Aziz', '84.3', ''],
        ['1', 'Boboyev Bobur', '84.3', ''],
        ['3', 'Dadaxonova Dilnoza', '84.0', en.results.ratingList.flags.few_lessons],
        ['—', 'Gulomova Gulnora', en.results.ratingList.states.exempt, ''],
      ]);
    });
    expect(document.querySelector('[data-provisional="true"]')?.textContent).toBe(
      en.results.ratingList.provisional,
    );
  });

  it('switches to a class across subjects and to the classes, and exports the list shown', async () => {
    const calls = open([{ role: 'academic_vice_principal', branchId: NORTH.id }]);
    await waitFor(() => {
      expect(rowsOf()).toHaveLength(4);
    });
    fireEvent.click(screen.getByRole('radio', { name: en.results.ratingList.kinds.class }));
    await waitFor(() => {
      expect(rowsOf().map((row) => row.slice(0, 4))).toEqual([
        ['1', 'Akbarov Aziz', '90.5', '9'],
        ['2', 'Gulomova Gulnora', '88.0', '10, fewer subjects'],
      ]);
    });
    fireEvent.click(screen.getByRole('radio', { name: en.results.ratingList.kinds.classes }));
    await waitFor(() => {
      expect(rowsOf().map((row) => row.slice(0, 4))).toEqual([
        ['1', '7 Oxford', '87.1', '24'],
        ['—', '7 Cambridge', '—', '0'],
      ]);
    });
    // Closed: no "Provisional".
    expect(document.querySelector('[data-provisional="true"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.results.ratingList.excel }));
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.route === 'POST /api/results/rating/export')
          .map((call) => call.body),
      ).toEqual([{ kind: 'classes', quarterId: QUARTER.id }]);
    });
  });

  it('sends the grade and language filters of the classes list', async () => {
    const calls = open(
      [{ role: 'principal', branchId: NORTH.id }],
      CHOICES,
      'en',
      '/results/rating?kind=classes&grade=7&language=ru',
    );
    await waitFor(() => {
      expect(rowsOf()).toHaveLength(2);
    });
    expect(
      calls
        .filter((call) => call.route === 'GET /api/results/rating/classes')
        .map(
          (call) =>
            new URLSearchParams(call.query).get('grade') +
            '|' +
            new URLSearchParams(call.query).get('language'),
        ),
    ).toContain('7|ru');
  });

  // 05, Reports: "Language is a filter in ... rating": it narrows the pickers too (decision 8).
  it('narrows the classes to pick by the language', async () => {
    const calls = open(
      [{ role: 'academic_vice_principal', branchId: NORTH.id }],
      CHOICES,
      'en',
      '/results/rating?kind=class&language=ru',
    );
    const picker = await screen.findByLabelText(en.results.ratingList.class);
    await waitFor(() => {
      expect([...picker.querySelectorAll('option')].map((one) => one.textContent)).toEqual([
        '7 Cambridge',
      ]);
    });
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.route === 'GET /api/results/rating/class')
          .map((call) => new URLSearchParams(call.query).get('classId')),
      ).toEqual([OTHER.id]);
    });
  });

  it('offers a Teacher only the lists the server gives, with no choice of list', async () => {
    open([{ role: 'teacher', branchId: NORTH.id }], {
      ...CHOICES,
      classes: [],
      classesList: false,
    });
    await waitFor(() => {
      expect(rowsOf()).toHaveLength(4);
    });
    expect(screen.queryByRole('radiogroup', { name: en.results.ratingList.kind })).toBeNull();
    // A Teacher views no closing checklist: no link to it.
    expect(screen.queryByRole('link', { name: en.results.ratingList.closingLink })).toBeNull();
  });

  it('says so when there is nothing to rank', async () => {
    open([{ role: 'teacher', branchId: NORTH.id }], {
      ...CHOICES,
      journals: [],
      classes: [],
      classesList: false,
    });
    expect(await screen.findByText(en.results.ratingList.nothing)).not.toBeNull();
  });

  it('writes the figures with a decimal comma in Russian', async () => {
    open([{ role: 'academic_vice_principal', branchId: NORTH.id }], CHOICES, 'ru');
    await screen.findByRole('heading', { name: ru.results.ratingList.title });
    await waitFor(() => {
      expect(rowsOf()[0]?.slice(0, 3)).toEqual(['1', 'Akbarov Aziz', '84,3']);
    });
    expect(rowsOf()[3]?.[2]).toBe(ru.results.ratingList.states.exempt);
  });
});
