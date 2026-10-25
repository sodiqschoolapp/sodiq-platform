import type {
  JournalGrid,
  JournalLesson,
  JournalStudent,
  JournalWork,
  LessonCard,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';
import { OPEN_LOCK } from '@/testing/edit-lock';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const JOURNAL = uid(1);
const PLANNED = uid(60);
const NO_PLAN = uid(61);
const SUBJECT = {
  id: uid(10),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  colour: 'blue' as const,
};
const UNIT = { kind: 'class' as const, id: uid(20), name: '7 Oxford' };
const QUARTER = { id: uid(30), number: 1, startDate: '2026-09-01', endDate: '2026-10-31' };

/** A column of the plan with no row yet (task 8.1: written at its first write). */
const TEST: JournalWork = {
  id: null,
  planWorkId: uid(70),
  sourceLessonId: PLANNED,
  kind: 'classwork',
  position: 1,
  title: 'Test',
  unplanned: false,
  total: null,
  notHeld: false,
  carriedFrom: null,
  version: null,
};

const lesson = (id: string, date: string, more: Partial<JournalLesson> = {}): JournalLesson => ({
  id,
  date,
  start: 480,
  end: 525,
  slot: 1,
  held: true,
  status: null,
  cancelled: null,
  month: '2026-10',
  canEnter: true,
  canEnterWorks: true,
  planItem: true,
  number: null,
  topic: null,
  notDelivered: false,
  copyFrom: null,
  lock: OPEN_LOCK,
  works: [],
  notHeldWorks: [],
  given: [],
  ...more,
});

// All names are invented.
const student = (n: number, lastName: string): JournalStudent => ({
  id: uid(100 + n),
  number: n,
  firstName: 'Ali',
  lastName,
  paternalName: null,
  uid: `S-${String(n)}`,
  folded: false,
  exemptions: [],
  cells: [
    {
      closed: false,
      open: false,
      exempt: null,
      mark: 1,
      version: 1,
      typedBy: null,
      marker: null,
      works: [
        {
          score: null,
          percent: null,
          version: null,
          onAbsent: false,
          marker: null,
          notGraded: false,
        },
      ],
      score: null,
    },
    {
      closed: false,
      open: false,
      exempt: null,
      mark: null,
      version: null,
      typedBy: null,
      marker: null,
      works: [],
      score: null,
    },
  ],
  quarter: null,
  months: null,
  comments: [],
  carriedIn: [],
  leftSubjectOn: null,
  atLeaving: null,
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
  years: [{ id: uid(40), startDate: '2026-09-01', endDate: '2027-05-31', closed: false }],
  others: [{ id: JOURNAL, unit: UNIT, subject: SUBJECT }],
  quarters: [QUARTER],
  quarter: QUARTER,
  today: '2026-10-27',
  referenceDate: '2026-10-27',
  teacher: { id: uid(50), name: 'Karimova Aziza' },
  shape: 'whole',
  months: ['2026-10'],
  lessons: [
    lesson(PLANNED, '2026-10-19', {
      works: [TEST],
      number: 7,
      topic: 'Fractions and their common denominators in practice',
      given: [{ title: 'Read', checkAt: NO_PLAN, ungraded: null, notGiven: false }],
    }),
    lesson(NO_PLAN, '2026-10-26', { planItem: false, number: 8 }),
  ],
  students: [student(1, 'Zokirov'), student(2, 'Abdullayev')],
  reminders: [],
  lastTotal: 30,
  absences: [],
  bottom: null,
  legend: { lateValue: 50, skippedValue: 0, daily: null, quarterly: null, weightsChangedOn: null },
};

const CARD: LessonCard = {
  lessonId: PLANNED,
  journalId: JOURNAL,
  number: 7,
  date: '2026-10-19',
  start: 480,
  end: 525,
  slot: 1,
  held: true,
  planItem: true,
  topic: 'Fractions and their common denominators in practice',
  whole: true,
  classworks: [{ id: uid(70), title: 'Test', description: 'Ten sums' }],
  objectives: 'Add fractions',
  links: [],
  files: [],
  givenToday: [
    {
      planWorkId: uid(71),
      title: 'Read',
      description: 'Pages 10 to 12',
      notGiven: false,
      checkAt: { lessonId: NO_PLAN, date: '2026-10-26', slot: 1 },
      checkedSameDay: false,
      ungraded: null,
    },
  ],
  checkedToday: [{ title: 'Write', givenOn: '2026-10-12' }],
  delivery: { notDelivered: false, version: null },
  canMark: true,
  editedAfterLesson: false,
  movedFrom: null,
};

function open(handlers: Record<string, (body: unknown) => Response> = {}) {
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
    [`GET /api/journal/journals/${JOURNAL}`]: () => json(GRID),
    [`GET /api/journal/lessons/${PLANNED}/card`]: () => json(CARD),
    ...handlers,
  });
  renderApp(`/journal/${JOURNAL}`);
  return calls;
}

const sent = (calls: ReturnType<typeof fakeApi>, route: string) =>
  calls.filter((call) => call.route === route).map((call) => call.body);

// docs/spec/09-lesson-plans.md, In the journal; docs/spec/edge-cases/lesson-plans.md,
// "A substitute supervises the class"; task 8.8.
describe('the lesson card', () => {
  it('heads each lesson with its number and topic, shortened, the whole topic in the tooltip', async () => {
    open();
    await screen.findAllByRole('button', { name: en.journal.card.open });
    const header = [...document.querySelectorAll('.ag-header-group-cell')].find((cell) =>
      (cell.textContent ?? '').includes('No. 7'),
    );
    expect(header?.textContent).toContain('No. 7 · Fractions and their common d…');
    expect(document.body.textContent).toContain('No. 8 · ');
  });

  it('shows given today and checked today, and marks a homework "not given" and the topic "not delivered"', async () => {
    const calls = open({
      [`PUT /api/journal/lessons/${PLANNED}/homework-given`]: () => json({ notGiven: [uid(71)] }),
      [`PUT /api/journal/lessons/${PLANNED}/delivery`]: () =>
        json({ notDelivered: true, version: 1, copyItemId: uid(90) }),
    });
    const cards = await screen.findAllByRole('button', { name: en.journal.card.open });
    fireEvent.click(cards[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog.querySelector('[data-card-topic]')?.textContent).toBe(CARD.topic);
    });
    const given = dialog.querySelector('[data-given-today]') as HTMLElement;
    expect(given.textContent).toContain('Read');
    expect(given.textContent).toContain('Pages 10 to 12');
    const checked = dialog.querySelector('[data-checked-today]') as HTMLElement;
    expect(checked.textContent).toContain('Write');
    expect(within(dialog).getByText('Ten sums')).toBeDefined();
    fireEvent.click(within(given).getByRole('checkbox', { name: en.journal.card.notGiven }));
    await waitFor(() => {
      expect(sent(calls, `PUT /api/journal/lessons/${PLANNED}/homework-given`)).toEqual([
        { planWorkIds: [uid(71)], notGiven: true },
      ]);
    });
    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: en.journal.card.markNotDelivered }),
    );
    await waitFor(() => {
      expect(sent(calls, `PUT /api/journal/lessons/${PLANNED}/delivery`)).toEqual([
        { notDelivered: true, version: null },
      ]);
    });
    // The journal is read again, so the next lesson's column follows the server.
    await waitFor(() => {
      expect(
        calls.filter((call) => call.route === `GET /api/journal/journals/${JOURNAL}`).length,
      ).toBeGreaterThan(1);
    });
  });

  it('shows no mark to a reader who may not set them', async () => {
    open({
      [`GET /api/journal/lessons/${PLANNED}/card`]: () =>
        json({ ...CARD, whole: false, canMark: false, classworks: [], objectives: null }),
    });
    const cards = await screen.findAllByRole('button', { name: en.journal.card.open });
    fireEvent.click(cards[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog.querySelector('[data-card-topic]')).not.toBeNull();
    });
    expect(within(dialog).queryAllByRole('checkbox')).toEqual([]);
    expect(dialog.textContent).not.toContain('Ten sums');
  });
});
