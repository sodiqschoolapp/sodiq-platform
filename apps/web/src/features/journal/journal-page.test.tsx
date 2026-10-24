import type { JournalGrid, JournalList, JournalStudent } from '@sodiq/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { lessonNearest } from './journal-page';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';
import { OPEN_LOCK } from '@/testing/edit-lock';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const JOURNAL = uid(1);
const OTHER = uid(2);
const SUBJECT = {
  id: uid(10),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  colour: 'blue' as const,
};
const UNIT = { kind: 'class' as const, id: uid(20), name: '7 Oxford' };
const QUARTER = { id: uid(30), number: 1, startDate: '2026-09-01', endDate: '2026-10-31' };

const cell = (
  mark: number | null,
  works: { score: number | null; percent: number | null }[] = [],
  score: number | null = null,
  closed = false,
  version: number | null = mark === null ? null : 1,
) => ({
  closed,
  exempt: null,
  mark,
  version,
  typedBy: mark === null ? null : 'Karimova Aziza',
  marker: null,
  works: works.map((one) => ({
    ...one,
    version: one.score === null ? null : 1,
    onAbsent: false,
    marker: null,
  })),
  score,
});

const figures = (shown: number, grade: number) => ({
  attendance: 75,
  classwork: 60,
  homework: 50,
  ratingExam: null,
  result: { kind: 'number' as const, shown, grade, provisional: false, leftOut: [], basedOn: null },
});

// All names are invented.
const student = (
  n: number,
  lastName: string,
  rest: Partial<JournalStudent> = {},
): JournalStudent => ({
  id: uid(100 + n),
  number: n,
  firstName: 'Ali',
  lastName,
  paternalName: null,
  uid: `S-${String(n)}`,
  folded: false,
  exemptions: [],
  cells: [cell(1, [{ score: 12, percent: 40 }], 60), cell(2, [], null), cell(1)],
  quarter: figures(59, 3),
  months: { '2026-10': figures(59, 3) },
  comments: [],
  ...rest,
});

const GRID: JournalGrid = {
  journal: {
    id: JOURNAL,
    unit: UNIT,
    subject: SUBJECT,
    year: { id: uid(40), startDate: '2026-09-01', endDate: '2027-05-31', closed: false },
    attendanceOnly: false,
    ratingExam: false,
  },
  rating: null,
  years: [
    { id: uid(40), startDate: '2026-09-01', endDate: '2027-05-31', closed: false },
    { id: uid(41), startDate: '2025-09-01', endDate: '2026-05-31', closed: true },
  ],
  others: [
    { id: JOURNAL, unit: UNIT, subject: SUBJECT },
    { id: OTHER, unit: { kind: 'class', id: uid(21), name: '7 Cambridge' }, subject: SUBJECT },
  ],
  quarters: [QUARTER, { id: uid(31), number: 2, startDate: '2026-11-09', endDate: '2026-12-27' }],
  quarter: QUARTER,
  today: '2026-10-27',
  referenceDate: '2026-10-27',
  teacher: { id: uid(50), name: 'Karimova Aziza' },
  shape: 'whole',
  months: ['2026-10'],
  lessons: [
    {
      id: uid(60),
      date: '2026-10-12',
      start: 480,
      end: 525,
      slot: 1,
      held: true,
      cancelled: null,
      month: '2026-10',
      canEnter: false,
      works: [
        {
          id: uid(70),
          planWorkId: uid(71),
          sourceLessonId: uid(60),
          kind: 'classwork',
          position: 1,
          title: 'Test',
          unplanned: false,
          total: 30,
          notHeld: false,
          carriedFrom: null,
          version: 2,
        },
      ],
      canEnterWorks: false,
      planItem: true,
      copyFrom: null,
      lock: OPEN_LOCK,
      notHeldWorks: [],
      given: [],
    },
    {
      id: uid(61),
      date: '2026-10-19',
      start: 480,
      end: 525,
      slot: 1,
      held: true,
      cancelled: null,
      month: '2026-10',
      canEnter: false,
      works: [],
      canEnterWorks: false,
      planItem: true,
      copyFrom: null,
      lock: OPEN_LOCK,
      notHeldWorks: [],
      given: [],
    },
    {
      id: uid(62),
      date: '2026-10-26',
      start: 480,
      end: 525,
      slot: 1,
      held: false,
      cancelled: { cause: 'reason', reason: 'School trip' },
      month: '2026-10',
      canEnter: false,
      works: [],
      canEnterWorks: false,
      planItem: true,
      copyFrom: null,
      lock: OPEN_LOCK,
      notHeldWorks: [],
      given: [],
    },
  ],
  students: [
    student(1, 'Zokirov'),
    student(2, 'Oʻktamov', {
      cells: [cell(null), cell(null), cell(null)],
      quarter: {
        attendance: null,
        classwork: null,
        homework: null,
        ratingExam: null,
        result: { kind: 'no_result' },
      },
    }),
    student(3, 'Abdullayev', {
      folded: true,
      exemptions: [],
      cells: [cell(0), cell(null), cell(null, [], null, true)],
    }),
  ],
  absences: [],
  lastTotal: null,
  bottom: {
    quarter: { attendance: 75, classwork: 60, homework: 50, ratingExam: null, result: 59 },
    months: {
      '2026-10': { attendance: 75, classwork: 60, homework: 50, ratingExam: null, result: 59 },
    },
  },
  legend: {
    lateValue: 50,
    skippedValue: 0,
    daily: { attendance: 20, classwork: 40, homework: 40 },
    quarterly: { attendance: 20, classwork: 40, homework: 40, ratingExam: null },
    weightsChangedOn: '2026-10-21',
  },
};

const LIST: JournalList = {
  years: [
    { id: uid(40), startDate: '2026-09-01', endDate: '2027-05-31', closed: false },
    { id: uid(41), startDate: '2025-09-01', endDate: '2026-05-31', closed: true },
  ],
  yearId: uid(40),
  journals: [
    { id: JOURNAL, unit: UNIT, subject: SUBJECT },
    { id: uid(3), unit: { kind: 'group', id: uid(22), name: '7-E-1' }, subject: SUBJECT },
  ],
};

const GRID_ROUTE = `GET /api/journal/journals/${JOURNAL}`;

function open(
  grid: JournalGrid | null | 'pending',
  path = `/journal/${JOURNAL}`,
  role = 'principal' as const,
) {
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(sessionOf({ language: 'en', assignments: [{ role, branchId: NORTH.id }] })),
    [GRID_ROUTE]: () =>
      grid === 'pending'
        ? new Promise<Response>(() => undefined)
        : grid === null
          ? refusal('journal_scope', 403)
          : json(grid),
    'GET /api/journal/journals': () => json(LIST),
  });
  renderApp(path, 'en');
  return calls;
}

/** The cells of a grid row of a student, by its row id. */
const rowCells = (id: string) =>
  [...document.querySelectorAll(`[row-id="${id}"] [col-id]`)].map((one) => [
    one.getAttribute('col-id'),
    one.textContent,
  ]);

const cellOf = (id: string, colId: string) =>
  document.querySelector(`[row-id="${id}"] [col-id="${colId}"]`);

// docs/spec/07-journal.md, Opening a journal and Layout; task 6.2.
describe('a journal', () => {
  it('shows the header in order, the teacher and the subject chip', async () => {
    open(GRID);
    await screen.findByRole('heading', { name: en.journal.sheet });
    const header = await waitFor(() => {
      const found = document.querySelector('[data-journal-header]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(header?.querySelector('p')?.textContent).toBe(
      '7 Oxford · Mathematics · Quarter 1 · September – October',
    );
    expect(header?.textContent).toContain('Teacher: Karimova Aziza');
  });

  it('draws the figures and cells as the server answers them, the cancelled lesson struck', async () => {
    open(GRID);
    await waitFor(() => {
      expect(cellOf(uid(101), 'result')).not.toBeNull();
    });
    expect(cellOf(uid(101), 'name')?.textContent).toBe('Zokirov Ali');
    expect(cellOf(uid(101), 'attendance')?.textContent).toBe('75');
    expect(cellOf(uid(101), 'result')?.textContent).toBe('59');
    expect(cellOf(uid(101), 'grade')?.textContent).toBe('3');
    // The number with its percent, and the lesson score.
    expect(cellOf(uid(101), `${uid(60)}:${uid(70)}`)?.textContent).toBe('1240%');
    expect(cellOf(uid(101), `${uid(60)}:avg`)?.textContent).toBe('60');
    // A lesson with no work is one narrow attendance column, without AVG.
    expect(cellOf(uid(101), `${uid(61)}:avg`)).toBeNull();
    // The cancelled lesson's mark is struck through.
    expect(cellOf(uid(101), `${uid(62)}:a`)?.querySelector('.line-through')?.textContent).toBe('1');
    // "No result": blank, not 0.
    expect(cellOf(uid(102), 'result')?.textContent).toBe(en.journal.grid.noResult);
    expect(cellOf(uid(102), 'grade')?.textContent).toBe('');
    // The bottom row.
    expect(cellOf('bottom', 'name')?.textContent).toBe(en.journal.grid.classAverage);
    expect(cellOf('bottom', 'result')?.textContent).toBe('59');
  });

  it('folds the students who left, with a sign, not a colour, on closed cells', async () => {
    open(GRID);
    const fold = await screen.findByRole('button', { name: 'Left or moved: 1 student' });
    expect(document.querySelector(`[row-id="${uid(103)}"]`)).toBeNull();
    fireEvent.click(fold);
    await waitFor(() => {
      expect(
        cellOf(uid(103), `${uid(62)}:a`)
          ?.querySelector('[aria-label]')
          ?.getAttribute('aria-label'),
      ).toBe(en.journal.grid.closed);
    });
  });

  // Task 8.5 (07, In the journal; Effect on totals).
  it('shows exempt cells as 4 or 5, "Exempt" with no grade, and folds a student exempt for every lesson', async () => {
    const exemptCell = (kind: 'temporary' | 'full') => ({
      ...cell(null, [], null, true),
      exempt: kind,
    });
    open({
      ...GRID,
      students: [
        student(1, 'Zokirov', {
          cells: [exemptCell('temporary'), cell(2, [], null), cell(1)],
          exemptions: [
            {
              kind: 'temporary',
              startDate: '2026-10-12',
              endDate: '2026-10-12',
              slots: null,
              category: null,
            },
          ],
          quarter: {
            ...figures(59, 3),
            result: {
              kind: 'number',
              shown: 59,
              grade: 3,
              provisional: false,
              leftOut: [],
              basedOn: { expected: 2, held: 7 },
            },
          },
        }),
        student(2, 'Oʻktamov', {
          cells: [exemptCell('temporary'), exemptCell('full'), exemptCell('full')],
          quarter: {
            attendance: null,
            classwork: null,
            homework: null,
            ratingExam: null,
            result: { kind: 'exempt' },
          },
        }),
      ],
    });
    await waitFor(() => {
      expect(cellOf(uid(101), `${uid(60)}:a`)?.querySelector('[data-exempt]')?.textContent).toBe(
        '4',
      );
    });
    expect(cellOf(uid(101), 'result')?.textContent).toContain('based on 2 of 7 lessons');
    // The kind and the dates beside the name (`07`, In the journal: "with the dates").
    expect(cellOf(uid(101), 'name')?.querySelector('[data-exemption]')?.textContent).toBe(
      `${en.journal.exemptions.kinds.temporary} · 12 October`,
    );
    const fold = await screen.findByRole('button', { name: 'Exempt: 1 student' });
    expect(document.querySelector(`[row-id="${uid(102)}"]`)).toBeNull();
    fireEvent.click(fold);
    await waitFor(() => {
      expect(cellOf(uid(102), 'result')?.textContent).toBe(en.journal.grid.exemptResult);
    });
    expect(cellOf(uid(102), `${uid(61)}:a`)?.querySelector('[data-exempt]')?.textContent).toBe('5');
  });

  it('finds a student by any apostrophe', async () => {
    open(GRID, `/journal/${JOURNAL}?q=O'ktamov`);
    await waitFor(() => {
      expect(cellOf(uid(102), 'name')).not.toBeNull();
    });
    expect(cellOf(uid(101), 'name')).toBeNull();
  });

  it('finds a student typed in Cyrillic', async () => {
    open(GRID, `/journal/${JOURNAL}?q=${encodeURIComponent('Зокиров')}`);
    await waitFor(() => {
      expect(cellOf(uid(101), 'name')).not.toBeNull();
    });
    expect(cellOf(uid(102), 'name')).toBeNull();
  });

  it('labels the month result without the rating exam in a rating subject', async () => {
    open(
      { ...GRID, journal: { ...GRID.journal, ratingExam: true } },
      `/journal/${JOURNAL}?month=2026-10`,
    );
    await waitFor(() => {
      expect(
        document.querySelector('[col-id="result"] [aria-label], [col-id="result"]'),
      ).not.toBeNull();
    });
    const headers = [...document.querySelectorAll('.ag-header-cell')].map((one) =>
      (one.textContent ?? '').trim(),
    );
    expect(headers).toContain(en.journal.grid.monthResult);
    expect(headers).not.toContain(en.journal.grid.ratingExam);
  });

  it('shows the legend with the weights and "changed on"', async () => {
    open(GRID);
    const legend = await waitFor(() => {
      const found = document.querySelector('[data-journal-legend]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(legend?.querySelector('[data-quarter-weights]')?.textContent).toBe(
      'Quarter result: attendance 20 · classwork 40 · homework 40 (changed on 21 October 2026)',
    );
  });

  it('shows lesson mode for the lesson of the date asked', async () => {
    open(GRID, `/journal/${JOURNAL}?mode=lesson&date=2026-10-19`);
    const section = await waitFor(() => {
      const found = document.querySelector(`[data-lesson-mode="${uid(61)}"]`);
      expect(found).not.toBeNull();
      return found;
    });
    expect(section?.querySelector(`[data-student="${uid(101)}"]`)?.textContent).toBe(
      'Zokirov Ali2',
    );
  });

  it('heads each work with its title and "Soni" with its total (07, Layout, row 3)', async () => {
    open(GRID);
    await waitFor(() => {
      expect(
        document.querySelector(`.ag-header-cell[col-id="${uid(60)}:${uid(70)}"]`),
      ).not.toBeNull();
    });
    expect(
      document
        .querySelector(`.ag-header-cell[col-id="${uid(60)}:${uid(70)}"]`)
        ?.textContent?.trim(),
    ).toBe('TestSoni 30');
  });

  it('filters the students who left, and those with an empty cell', async () => {
    open(GRID, `/journal/${JOURNAL}?filter=left`);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Left or moved: 1 student' })).toBeDefined();
    });
    expect(cellOf(uid(101), 'name')).toBeNull();
    expect(cellOf(uid(102), 'name')).toBeNull();
  });

  it('keeps only the students with an empty cell in a held lesson', async () => {
    open(GRID, `/journal/${JOURNAL}?filter=empty`);
    // Oʻktamov has no mark on the held lessons; Zokirov has every mark and number.
    await waitFor(() => {
      expect(cellOf(uid(102), 'name')).not.toBeNull();
    });
    expect(cellOf(uid(101), 'name')).toBeNull();
  });

  it('says so when the quarter has no lessons yet', async () => {
    open({ ...GRID, lessons: [], students: [], bottom: null });
    await screen.findByText(en.journal.page.noLessons);
  });

  it('shows the outline while the journal loads', async () => {
    open('pending');
    await screen.findByRole('heading', { name: en.journal.sheet });
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(document.querySelector('[data-journal-grid]')).toBeNull();
  });

  it('names a cancelled lesson\'s reason in its header (07, Layout: "grey with the reason")', async () => {
    open(GRID);
    await waitFor(() => {
      const headers = [...document.querySelectorAll('.ag-header-group-cell')].map((one) =>
        (one.textContent ?? '').trim(),
      );
      expect(headers.some((one) => one.endsWith('Cancelled: School trip'))).toBe(true);
    });
    expect(cellOf(uid(101), `${uid(62)}:a`)?.className).toContain('bg-muted');
  });

  it('offers the years and opens the Journals page of another one', async () => {
    open(GRID);
    const year = await screen.findByRole('combobox', { name: en.journal.page.year });
    fireEvent.change(year, { target: { value: uid(41) } });
    await screen.findByRole('heading', { name: en.journal.page.title });
  });

  it('shows the refusal of a journal outside the role', async () => {
    open(null);
    await screen.findByText(en.errors.journal_scope);
  });

  it('shows the attendance columns only to an attendance reader', async () => {
    open({
      ...GRID,
      shape: 'attendance',
      lessons: GRID.lessons.map((one) => ({ ...one, works: [] })),
      students: GRID.students.map((one) => ({
        ...one,
        cells: one.cells.map((c) => ({ ...c, works: [], score: null })),
        quarter: {
          attendance: 75,
          classwork: null,
          homework: null,
          ratingExam: null,
          result: null,
        },
      })),
    });
    await waitFor(() => {
      expect(cellOf(uid(101), 'attendance')?.textContent).toBe('75');
    });
    expect(cellOf(uid(101), 'result')).toBeNull();
    expect(cellOf(uid(101), `${uid(60)}:${uid(70)}`)).toBeNull();
    expect(rowCells(uid(101)).length).toBeGreaterThan(0);
  });
});

describe('the Journals page', () => {
  it('lists the journals of the tab and opens one', async () => {
    open(GRID, '/journal');
    await screen.findByRole('heading', { name: en.journal.page.title });
    await waitFor(() => {
      expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
    });
    expect(document.querySelector('tbody tr')?.textContent).toContain('7 Oxford');
    fireEvent.click(screen.getByRole('radio', { name: en.journal.page.groups }));
    await waitFor(() => {
      expect(document.querySelector('tbody tr')?.textContent).toContain('7-E-1');
    });
  });
});

// 07, Opening a journal: "Opened any other way, it scrolls to the lesson closest to today".
describe('the lesson closest to a date', () => {
  const at = (date: string) =>
    ({ ...GRID.lessons[0], id: date, date }) as JournalGrid['lessons'][number];
  const lessons = [at('2026-10-12'), at('2026-10-19'), at('2026-10-26')];

  it('takes the nearest by days, before or after', () => {
    expect(lessonNearest(lessons, '2026-10-20')?.date).toBe('2026-10-19');
    expect(lessonNearest(lessons, '2026-10-24')?.date).toBe('2026-10-26');
    expect(lessonNearest(lessons, '2026-11-30')?.date).toBe('2026-10-26');
    expect(lessonNearest(lessons, '2026-09-01')?.date).toBe('2026-10-12');
  });

  it('takes the later one on a tie, and the date itself when it has a lesson', () => {
    expect(lessonNearest(lessons, '2026-10-19')?.date).toBe('2026-10-19');
    expect(lessonNearest([at('2026-10-12'), at('2026-10-14')], '2026-10-13')?.date).toBe(
      '2026-10-14',
    );
    expect(lessonNearest([], '2026-10-13')).toBeNull();
  });
});

describe('the Journals page filters', () => {
  it('lists the journals of another year', async () => {
    const calls = open(GRID, '/journal');
    await waitFor(() => {
      expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
    });
    fireEvent.change(screen.getByRole('combobox', { name: en.journal.page.year }), {
      target: { value: uid(41) },
    });
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.route === 'GET /api/journal/journals' && call.query === `?yearId=${uid(41)}`,
        ),
      ).toBe(true);
    });
  });
});
