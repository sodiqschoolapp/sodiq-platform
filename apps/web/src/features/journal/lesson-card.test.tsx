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
const QUARTER = {
  id: uid(30),
  number: 1,
  startDate: '2026-09-01',
  endDate: '2026-10-31',
  closed: false,
};

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
  addedInJournal: [],
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
  legend: {
    lateValue: 50,
    skippedValue: 0,
    daily: null,
    quarterly: null,
    weightsChangedOn: null,
    countsFrom: null,
  },
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
  addedInJournal: [],
  plan: { quarterId: uid(95), position: 7, edit: 'none', item: null },
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
    // Task 10.7: each work of the card carries its kind's tag, the full word on hover.
    const tags = [...dialog.querySelectorAll('[data-work-kind]')].map((one) => [
      one.getAttribute('data-work-kind'),
      one.textContent,
      one.getAttribute('title'),
    ]);
    expect(tags).toContainEqual(['classwork', 'C', 'Classwork']);
    expect(tags.filter(([kind]) => kind === 'homework')).toEqual([
      ['homework', 'H', 'Homework'],
      ['homework', 'H', 'Homework'],
    ]);
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

  // Task 10.8: docs/spec/09-lesson-plans.md, In the journal ("The lesson card is a second way into
  // the plan item of its lesson"); What a plan contains (files of each work, staff-only materials).
  describe('the way into the plan (task 10.8)', () => {
    const ITEM_ID = uid(80);
    const ITEM = {
      id: ITEM_ID,
      position: 7,
      topic: CARD.topic ?? '',
      objectives: 'Add fractions',
      links: [],
      classworks: [{ id: uid(70), title: 'Test', description: 'Ten sums' }],
      homeworks: [{ id: uid(71), title: 'Read', description: 'Pages 10 to 12' }],
      files: [
        {
          id: uid(85),
          workId: null,
          name: 'answer-key.pdf',
          type: 'application/pdf' as const,
          bytes: 9,
        },
        {
          id: uid(86),
          workId: uid(71),
          name: 'reading.pdf',
          type: 'application/pdf' as const,
          bytes: 9,
        },
      ],
      addedInJournal: [],
      movedFrom: null,
      copiedFrom: null,
      editedAfterLesson: false,
      notDeliveredFrom: null,
    };
    const OWNED: LessonCard = {
      ...CARD,
      files: ITEM.files,
      plan: { quarterId: QUARTER.id, position: 7, edit: 'open', item: ITEM },
    };

    const openCard = async (
      card: LessonCard,
      handlers: Record<string, (body: unknown) => Response> = {},
    ) => {
      const calls = open({
        [`GET /api/journal/lessons/${PLANNED}/card`]: () => json(card),
        ...handlers,
      });
      const cards = await screen.findAllByRole('button', { name: en.journal.card.open });
      fireEvent.click(cards[0] as HTMLElement);
      const dialog = await screen.findByRole('dialog');
      await waitFor(() => {
        expect(dialog.querySelector('[data-card-topic]')).not.toBeNull();
      });
      return { calls, dialog };
    };

    it('lists each file under its work and the materials apart', async () => {
      const { dialog } = await openCard(OWNED);
      const given = dialog.querySelector('[data-given-today]') as HTMLElement;
      expect(within(given).getByRole('button', { name: 'reading.pdf' })).toBeDefined();
      expect(within(given).queryByRole('button', { name: 'answer-key.pdf' })).toBeNull();
      expect(within(dialog).getByRole('button', { name: 'answer-key.pdf' })).toBeDefined();
    });

    it('lets the owner change the topic and attach a file to a homework, uploaded once the save answers', async () => {
      const saved = { ...ITEM, topic: 'Fractions, again' };
      const { calls, dialog } = await openCard(OWNED, {
        [`PUT /api/plans/items/${ITEM_ID}`]: () => json(saved),
        [`PUT /api/plans/items/${ITEM_ID}/files`]: () =>
          json({
            id: uid(87),
            workId: uid(71),
            name: 'sheet.pdf',
            type: 'application/pdf',
            bytes: 4,
          }),
      });
      fireEvent.click(within(dialog).getByRole('button', { name: en.journal.card.editPlan }));
      const topic = await within(dialog).findByLabelText(en.plans.plan.topic);
      fireEvent.change(topic, { target: { value: 'Fractions, again' } });
      const picker = within(dialog).getByLabelText(
        en.plans.files.attachTo.replace('{{name}}', 'Read'),
      );
      fireEvent.change(picker, {
        target: { files: [new File(['%PDF'], 'sheet.pdf', { type: 'application/pdf' })] },
      });
      expect(within(dialog).getByText('sheet.pdf')).toBeDefined();
      // Nothing is uploaded before the save.
      expect(calls.filter((call) => call.route.endsWith('/files'))).toEqual([]);
      fireEvent.click(within(dialog).getByRole('button', { name: en.form.save }));
      await waitFor(() => {
        expect(
          calls.filter((call) => call.route === `PUT /api/plans/items/${ITEM_ID}/files`),
        ).toEqual([
          {
            route: `PUT /api/plans/items/${ITEM_ID}/files`,
            body: { type: 'application/pdf', size: 4 },
            query: `?name=sheet.pdf&workId=${uid(71)}`,
          },
        ]);
      });
      expect(sent(calls, `PUT /api/plans/items/${ITEM_ID}`)).toEqual([
        {
          base: {
            topic: ITEM.topic,
            objectives: ITEM.objectives,
            links: [],
            classworks: ITEM.classworks,
            homeworks: ITEM.homeworks,
          },
          values: {
            topic: 'Fractions, again',
            objectives: ITEM.objectives,
            links: [],
            classworks: ITEM.classworks,
            homeworks: ITEM.homeworks,
          },
        },
      ]);
    });

    it('keeps a file the server did not take as "not uploaded", with a retry', async () => {
      let refuse = true;
      const { calls, dialog } = await openCard(OWNED, {
        [`PUT /api/plans/items/${ITEM_ID}`]: () => json(ITEM),
        [`PUT /api/plans/items/${ITEM_ID}/files`]: () =>
          refuse
            ? json(
                { error: { code: 'plan_files_full', message: 'Full.', requestId: uid(99) } },
                409,
              )
            : json({
                id: uid(87),
                workId: null,
                name: 'notes.pdf',
                type: 'application/pdf',
                bytes: 4,
              }),
      });
      fireEvent.click(within(dialog).getByRole('button', { name: en.journal.card.editPlan }));
      const picker = await within(dialog).findByLabelText(en.plans.files.attachMaterial);
      fireEvent.change(picker, {
        target: { files: [new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' })] },
      });
      fireEvent.change(within(dialog).getByLabelText(en.plans.plan.topic), {
        target: { value: 'Fractions, again' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: en.form.save }));
      const kept = await screen.findByText(en.plans.files.notUploaded);
      const block = kept.closest('[data-not-uploaded]') as HTMLElement;
      expect(block.textContent).toContain('notes.pdf');
      expect(block.textContent).toContain(en.errors.plan_files_full);
      refuse = false;
      fireEvent.click(within(block).getByRole('button', { name: en.plans.files.retry }));
      await waitFor(() => {
        expect(screen.queryByText(en.plans.files.notUploaded)).toBeNull();
      });
      expect(
        calls.filter((call) => call.route === `PUT /api/plans/items/${ITEM_ID}/files`),
      ).toHaveLength(2);
    });

    it('offers the owner the edit request for this lesson when the row is closed', async () => {
      const { calls, dialog } = await openCard(
        { ...OWNED, plan: { ...OWNED.plan, edit: 'request' } },
        {
          [`POST /api/plans/journals/${JOURNAL}/requests`]: () => json({}, 500),
        },
      );
      expect(within(dialog).queryByRole('button', { name: en.journal.card.editPlan })).toBeNull();
      fireEvent.click(within(dialog).getByRole('button', { name: en.journal.card.askToEdit }));
      fireEvent.change(within(dialog).getByLabelText(en.journal.card.askReason), {
        target: { value: 'The topic changed' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: en.journal.card.askSend }));
      await waitFor(() => {
        expect(sent(calls, `POST /api/plans/journals/${JOURNAL}/requests`)).toEqual([
          {
            kind: 'text',
            quarterId: QUARTER.id,
            lessonIds: [PLANNED],
            reason: 'The topic changed',
          },
        ]);
      });
    });

    it('gives a substitute and any other reader no way into the plan', async () => {
      const { dialog } = await openCard({
        ...OWNED,
        plan: { ...OWNED.plan, edit: 'none', item: null },
      });
      expect(within(dialog).queryByRole('button', { name: en.journal.card.editPlan })).toBeNull();
      expect(within(dialog).queryByRole('button', { name: en.journal.card.askToEdit })).toBeNull();
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

  it('puts topic, classwork and homework at the top of lesson mode', async () => {
    fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
      [`GET /api/journal/journals/${JOURNAL}`]: () => json(GRID),
    });
    renderApp(`/journal/${JOURNAL}?mode=lesson&date=2026-10-19`);
    const top = await waitFor(() => {
      const found = document.querySelector('[data-lesson-plan-top]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(top?.textContent).toContain('Fractions and their common denominators in practice');
    expect(top?.textContent).toContain('Test');
    expect(top?.textContent).toContain('Read');
    // Task 10.7: the works of both kinds listed together carry their tags.
    expect(
      [...(top?.querySelectorAll('[data-work-kind]') ?? [])].map((one) => one.textContent),
    ).toEqual(expect.arrayContaining(['C', 'H']));
  });
});
