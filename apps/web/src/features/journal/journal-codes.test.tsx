import type { JournalGrid, JournalStudent } from '@sodiq/shared';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';
import { showEveryJournalColumn } from '@/testing/journal-columns';
import { OPEN_LOCK } from '@/testing/edit-lock';

// Task 11.27, Done when: "a journal column header shows the code with the full title on hover"
// (`09`, Codes: "Where space is short (journal column headers, the lesson header, lesson mode on a
// phone) the code is shown alone, with the full name on hover or on a tap. Where the code is
// empty, the name is shown alone"). The fixtures are copied from `journal-page.test.tsx`, cut to
// one lesson with one classwork. All names are invented.

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const JOURNAL = uid(1);
const LESSON = uid(60);
const WORK = uid(70);
const WORK_COLUMN = `${LESSON}:${WORK}`;
const TITLE = 'Quiz on fractions';
// Shorter than the header's cut (28 characters), so a header without codes shows it whole.
const TOPIC = 'Adding fractions';
const SUBJECT = {
  id: uid(10),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  colour: 'blue' as const,
};
const UNIT = { kind: 'class' as const, id: uid(20), name: '7 Oxford' };
/** The journal as the Journals list names it (owner, 28 November 2026: its classes and teachers). */
const LISTED = {
  id: JOURNAL,
  unit: { ...UNIT, classes: [{ id: UNIT.id, name: UNIT.name }] },
  subject: SUBJECT,
  teachers: [],
};
const QUARTER = {
  id: uid(30),
  number: 1,
  startDate: '2026-09-01',
  endDate: '2026-10-31',
  closed: false,
};
const YEAR = { id: uid(40), startDate: '2026-09-01', endDate: '2027-05-31', closed: false };

const student: JournalStudent = {
  id: uid(101),
  number: 1,
  firstName: 'Ali',
  lastName: 'Zokirov',
  paternalName: null,
  uid: 'S-1',
  photoId: null,
  folded: false,
  exemptions: [],
  cells: [
    {
      closed: false,
      open: false,
      exempt: null,
      mark: 1,
      version: 1,
      typedBy: 'Karimova Aziza',
      marker: null,
      works: [
        { score: 12, percent: 40, version: 1, onAbsent: false, notGraded: false, marker: null },
      ],
    },
  ],
  quarter: {
    attendance: 100,
    classwork: 40,
    homework: null,
    ratingExam: null,
    result: {
      kind: 'number',
      shown: 59,
      grade: 3,
      provisional: false,
      leftOut: [],
      basedOn: null,
      kept: false,
    },
  },
  months: {},
  comments: [],
  carriedIn: [],
  leftSubjectOn: null,
  atLeaving: null,
};

/** The grid of one lesson whose classwork and topic carry `code` and `topicCode`. */
const gridOf = (codesOn: boolean, code: string | null, topicCode: string | null): JournalGrid => ({
  journal: {
    codesOn,
    id: JOURNAL,
    unit: UNIT,
    subject: SUBJECT,
    year: YEAR,
    attendanceOnly: false,
    ratingExam: false,
  },
  rating: null,
  years: [YEAR],
  others: [{ id: JOURNAL, unit: UNIT, subject: SUBJECT }],
  quarters: [QUARTER],
  quarter: QUARTER,
  today: '2026-10-27',
  referenceDate: '2026-10-27',
  teacher: { id: uid(50), name: 'Karimova Aziza' },
  shape: 'whole',
  months: ['2026-10'],
  lessons: [
    {
      id: LESSON,
      date: '2026-10-12',
      start: 480,
      end: 525,
      slot: 1,
      held: true,
      status: null,
      cancelled: null,
      month: '2026-10',
      canEnter: false,
      works: [
        {
          code,
          id: WORK,
          planWorkId: uid(71),
          sourceLessonId: LESSON,
          kind: 'classwork',
          position: 1,
          title: TITLE,
          unplanned: false,
          total: 30,
          notHeld: false,
          version: 2,
        },
      ],
      canEnterWorks: false,
      planItem: true,
      number: null,
      topic: TOPIC,
      topicCode,
      notDelivered: false,
      addedInJournal: [],
      copyFrom: null,
      lock: OPEN_LOCK,
      notHeldWorks: [],
      given: [],
    },
  ],
  students: [student],
  absences: [],
  reminders: [],
  lastTotal: null,
  bottom: {
    quarter: { attendance: 100, classwork: 40, homework: null, ratingExam: null, result: 59 },
    months: {},
  },
  legend: {
    lateValue: 50,
    skippedValue: 0,
    quarterly: { attendance: 20, classwork: 40, homework: 40, ratingExam: null },
    weightsChangedOn: null,
    countsFrom: null,
  },
});

function open(grid: JournalGrid) {
  fakeApi({
    'GET /api/auth/session': () =>
      json(sessionOf({ language: 'en', assignments: [{ role: 'principal', branchId: NORTH.id }] })),
    [`GET /api/journal/journals/${JOURNAL}`]: () => json(grid),
    'GET /api/journal/journals': () =>
      json({
        years: [YEAR],
        yearId: YEAR.id,
        journals: [LISTED],
      }),
  });
  renderApp(`/journal/${JOURNAL}`, 'en');
}

/** The header cell of the work's column, once the grid has drawn it. */
const workHeader = () =>
  waitFor(() => {
    const found = document.querySelector<HTMLElement>(`.ag-header-cell[col-id="${WORK_COLUMN}"]`);
    if (found === null) throw new Error('The work column header.');
    return found;
  });

/** The header of the lesson (its group cell), once the grid has drawn it. */
const lessonHeader = () =>
  waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>('.ag-header-group-cell')].find((one) =>
      (one.textContent ?? '').includes('12 October'),
    );
    if (found === undefined) throw new Error('The lesson header.');
    return found;
  });

/** The first line of the work's header: the kind's tag and the title or the code. */
const firstLine = (header: HTMLElement) =>
  header.querySelector<HTMLElement>('[aria-label] > span:first-child');

/** The second line of a lesson header: its number and topic. */
const secondLine = (header: HTMLElement) =>
  header.querySelector('[title] > span.text-xs')?.textContent;

describe('codes in the journal grid (task 11.27)', () => {
  beforeEach(showEveryJournalColumn);

  it('heads a coded work with its code alone, the full title on hover, focus and a tap', async () => {
    open(gridOf(true, 'Q1', 'T3'));
    const header = await workHeader();
    // The code alone, never the title.
    expect(header.textContent).toContain('Q1');
    expect(header.textContent).not.toContain(TITLE);
    expect(firstLine(header)?.textContent).toMatch(/Q1$/);
    const code = within(header).getByRole('button', { name: `Q1 · ${TITLE}` });
    expect(code.textContent).toBe('Q1');
    // On hover: the full title as the code's own hover text.
    expect(code.getAttribute('title')).toBe(TITLE);
    // On focus: the button is reached by keyboard and is named by the full title with its code.
    code.focus();
    expect(document.activeElement).toBe(code);
    expect(code.getAttribute('aria-label')).toBe(`Q1 · ${TITLE}`);
    expect(within(header).queryByRole('tooltip')).toBeNull();
    // On a tap: the full title under the code, still in the header; a second tap closes it.
    fireEvent.click(code);
    expect(within(header).getByRole('tooltip').textContent).toBe(TITLE);
    expect(code.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(code);
    expect(within(header).queryByRole('tooltip')).toBeNull();
    // Leaving the code closes an open line too.
    fireEvent.click(code);
    fireEvent.blur(code);
    expect(within(header).queryByRole('tooltip')).toBeNull();
  });

  it('heads a lesson with the topic code alone, the full code and topic on hover', async () => {
    open(gridOf(true, 'Q1', 'T3'));
    const header = await lessonHeader();
    expect(header.textContent).toContain('T3');
    expect(header.textContent).not.toContain(TOPIC);
    expect(secondLine(header)).toBe('T3');
    expect(header.querySelector('[title]')?.getAttribute('title')).toBe(
      `12 October, Monday · lesson 1 · T3 · ${TOPIC}`,
    );
  });

  it('heads a work and a lesson without codes by the title and the topic', async () => {
    // The server answers `null` codes while the subject's codes are off.
    open(gridOf(false, null, null));
    const header = await workHeader();
    expect(firstLine(header)?.textContent).toMatch(new RegExp(`${TITLE}$`));
    expect(header.querySelector('[data-coded-name]')).toBeNull();
    expect(header.querySelector('button[aria-expanded]')).toBeNull();
    const lesson = await lessonHeader();
    // The topic itself on the header and on hover, with no code.
    expect(secondLine(lesson)).toBe(TOPIC);
    expect(lesson.querySelector('[title]')?.getAttribute('title')).toBe(
      `12 October, Monday · lesson 1 · ${TOPIC}`,
    );
    expect(lesson.textContent).not.toContain('T3');
  });
});
