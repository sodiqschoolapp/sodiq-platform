import type { JournalExportItem, JournalExportList, JournalSupport } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';
import { OPEN_LOCK } from '@/testing/edit-lock';

const uid = (n: number): string => `0199e800-0000-7000-8000-${String(n).padStart(12, '0')}`;

const Q1 = { id: uid(1), number: 1, startDate: '2026-09-01', endDate: '2026-10-31', closed: false };
const Q2 = { id: uid(2), number: 2, startDate: '2026-11-09', endDate: '2026-12-27', closed: false };

const item = (n: number, rest: Partial<JournalExportItem>): JournalExportItem => ({
  id: uid(10 + n),
  quarter: { id: Q1.id, number: 1 },
  month: null,
  format: 'xlsx',
  status: 'queued',
  failure: null,
  requestedAt: '2026-10-27T07:00:00.000Z',
  asOf: null,
  expiresAt: null,
  journals: null,
  rows: null,
  ...rest,
});

const LIST: JournalExportList = {
  canExportBranch: true,
  quarters: [Q1, Q2],
  exports: [
    item(1, {
      status: 'ready',
      asOf: '2026-10-27T07:05:00.000Z',
      expiresAt: '2026-10-28T07:05:00.000Z',
      journals: 12,
      rows: 240,
    }),
    item(2, { status: 'failed', failure: 'journal_export_stale', month: '2026-10' }),
    item(3, { status: 'expired', format: 'pdf' }),
    item(4, { status: 'queued' }),
    item(5, { status: 'failed', failure: 'journal_export_failed' }),
  ],
};

const as = (role: 'principal' | 'teacher' | 'academic_vice_principal') => () =>
  json(sessionOf({ language: 'en', assignments: [{ role, branchId: NORTH.id }] }));

const rowsOf = () =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

// All names are invented. Task 8.9, pull request #227: the export of the branch's journals
// (edge/system-behaviour: "A large export is a background job, one per user ... The link works
// for 24 hours and access is checked again at download").
describe('the export of the branch', () => {
  it('lists the person’s exports with their state, and asks for one of a month of the quarter', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': as('principal'),
      'GET /api/journal/exports': () => json(LIST),
      'POST /api/journal/exports': () => json({ export: item(4, {}) }),
    });
    renderApp('/journal/exports', 'en');
    await screen.findByRole('heading', { name: en.journal.exports.title });
    await waitFor(() => {
      expect(rowsOf()).toHaveLength(5);
    });
    const [ready, failed, expired, queued, plain] = rowsOf();
    expect(ready?.[4]).toContain('Ready, link works until');
    expect(ready?.[5]).toBe(en.journal.exports.download);
    expect(failed?.[1]).toContain('Quarter 1 · October');
    expect(failed?.[4]).toBe(
      `${en.journal.exports.statuses.failed}: ${en.errors.journal_export_stale}`,
    );
    expect(failed?.[5]).toBe('—');
    expect(expired?.[4]).toBe(en.journal.exports.statuses.expired);
    expect(queued?.[4]).toBe(en.journal.exports.statuses.queued);
    expect(queued?.[5]).toBe('—');
    expect(plain?.[4]).toBe(
      `${en.journal.exports.statuses.failed}: ${en.errors.journal_export_failed}`,
    );
    fireEvent.change(screen.getByLabelText(en.journal.exports.month), {
      target: { value: '2026-10' },
    });
    screen.getByRole('button', { name: en.journal.exports.ask }).click();
    await screen.findByText(en.journal.exports.asked);
    const sent = calls.filter((one) => one.route === 'POST /api/journal/exports');
    expect(sent.map((one) => one.body)).toEqual([
      { format: 'xlsx', quarterId: Q1.id, month: '2026-10' },
    ]);
  });

  it('says why a request is refused', async () => {
    fakeApi({
      'GET /api/auth/session': as('principal'),
      'GET /api/journal/exports': () => json({ ...LIST, exports: [] }),
      'POST /api/journal/exports': () => refusal('journal_export_running', 409),
    });
    renderApp('/journal/exports', 'en');
    (await screen.findByRole('button', { name: en.journal.exports.ask })).click();
    expect(await screen.findByText(en.errors.journal_export_running)).not.toBeNull();
  });

  it('shows the refusal of a download beside it: the link expired', async () => {
    fakeApi({
      'GET /api/auth/session': as('principal'),
      'GET /api/journal/exports': () => json({ ...LIST, exports: [LIST.exports[0]] }),
      [`GET /api/journal/exports/${uid(11)}/file`]: () => refusal('journal_export_expired', 410),
    });
    renderApp('/journal/exports', 'en');
    (await screen.findByRole('button', { name: en.journal.exports.download })).click();
    expect(await screen.findByText(en.errors.journal_export_expired)).not.toBeNull();
  });

  it('is not for a reader of part of the branch', async () => {
    fakeApi({
      'GET /api/auth/session': as('teacher'),
      'GET /api/journal/exports': () =>
        json({ canExportBranch: false, quarters: [Q1], exports: [] }),
    });
    renderApp('/journal/exports', 'en');
    expect(await screen.findByText(en.problems.noAccessPart)).not.toBeNull();
    expect(screen.queryByRole('button', { name: en.journal.exports.ask })).toBeNull();
  });
});

const SUBJECT = {
  id: uid(30),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  colour: 'blue' as const,
};
const UNIT = { kind: 'class' as const, id: uid(31), name: '7 Oxford' };
const JOURNAL = uid(32);
const STUDENT = uid(33);
const LESSON = uid(34);

const by = { accountId: uid(40), login: 'a.karimova', name: 'Karimova Aziza' };

const SUPPORT: JournalSupport = {
  student: {
    id: STUDENT,
    firstName: 'Ali',
    lastName: 'Zokirov',
    paternalName: null,
    uid: '2600001',
    photoId: null,
    folded: false,
  },
  journal: {
    id: JOURNAL,
    unit: UNIT,
    subject: SUBJECT,
  },
  quarter: { id: Q1.id, number: 1 },
  date: '2026-10-26',
  lessons: [
    {
      lesson: {
        id: LESSON,
        date: '2026-10-26',
        start: 480,
        end: 525,
        slot: 1,
        held: true,
        status: 'complete',
        cancelled: null,
        month: '2026-10',
        canEnter: false,
        works: [],
        canEnterWorks: false,
        planItem: true,
        number: 7,
        topic: null,
        notDelivered: false,
        copyFrom: null,
        lock: OPEN_LOCK,
        notHeldWorks: [],
        given: [],
      },
      cell: {
        closed: false,
        open: false,
        exempt: 'temporary',
        mark: null,
        version: 2,
        typedBy: null,
        marker: null,
        works: [],
        score: null,
      },
      stored: { mark: 0, works: [] },
      hiddenBy: { kind: 'temporary', startDate: '2026-10-26', endDate: '2026-10-26' },
    },
  ],
  figures: {
    attendance: 75,
    classwork: null,
    homework: null,
    ratingExam: null,
    result: {
      kind: 'number',
      shown: 75,
      grade: 4,
      provisional: true,
      leftOut: [],
      basedOn: null,
      kept: false,
    },
  },
  ratingDate: null,
  legend: {
    lateValue: 50,
    skippedValue: 0,
    daily: { attendance: 20, classwork: 40, homework: 40 },
    quarterly: { attendance: 20, classwork: 40, homework: 40, ratingExam: null },
    weightsChangedOn: null,
    countsFrom: null,
  },
  lines: [
    {
      kind: 'cell',
      at: '2026-10-26T04:00:00.000Z',
      lessonId: LESSON,
      work: null,
      version: 1,
      before: null,
      after: 0,
      notGradedBefore: false,
      notGradedAfter: false,
      how: 'offline_entry',
      by,
      reason: null,
      approvedBy: null,
      orphanAssignment: false,
    },
    {
      kind: 'refusal',
      at: '2026-10-26T04:01:00.000Z',
      lessonId: LESSON,
      field: 'attendance',
      work: null,
      valueSent: 1,
      versionSent: null,
      code: 'journal_locked',
      by,
    },
    {
      kind: 'cell',
      at: '2026-10-27T05:00:00.000Z',
      lessonId: LESSON,
      work: null,
      version: 2,
      before: 0,
      after: 0,
      notGradedBefore: false,
      notGradedAfter: false,
      how: 'correction',
      by,
      reason: 'Seen in the corridor',
      approvedBy: null,
      orphanAssignment: false,
    },
    {
      kind: 'work',
      at: '2026-10-27T05:01:00.000Z',
      lessonId: LESSON,
      work: { id: uid(60), kind: 'classwork', title: 'Fractions' },
      totalBefore: null,
      totalAfter: 20,
      notHeldBefore: false,
      notHeldAfter: false,
      how: 'entry',
      by,
    },
    {
      kind: 'delivery',
      at: '2026-10-27T05:02:00.000Z',
      lessonId: LESSON,
      mark: 'topic',
      before: false,
      after: true,
      how: 'entry',
      by,
    },
    {
      kind: 'exemption_clear',
      at: '2026-10-27T05:03:00.000Z',
      lessonId: LESSON,
      work: null,
      value: 1,
      exemption: { kind: 'temporary', startDate: '2026-10-26', endDate: '2026-10-26' },
    },
    {
      kind: 'exemption_give_back',
      at: '2026-10-27T05:04:00.000Z',
      lessonId: LESSON,
      work: null,
      value: 1,
      exemption: { kind: 'temporary', startDate: '2026-10-26', endDate: '2026-10-26' },
    },
    {
      kind: 'void',
      at: '2026-10-27T05:05:00.000Z',
      lessonId: LESSON,
      work: null,
      target: 'cell',
      value: 1,
      source: 'leaving',
      reason: 'Left for another school',
      by,
    },
    {
      kind: 'void_give_back',
      at: '2026-10-27T05:06:00.000Z',
      lessonId: LESSON,
      work: null,
      target: 'cell',
      value: 1,
      source: 'leaving',
      by,
    },
    {
      kind: 'rating',
      at: '2026-10-27T05:07:00.000Z',
      before: null,
      after: { kind: 'score', score: 77 },
      reason: null,
      how: 'entry',
      by,
    },
  ],
};

describe('the support view', () => {
  it('asks for no support view while the grid gives no quarter for the date, and says why', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': as('academic_vice_principal'),
      'GET /api/journal/journals': () =>
        json({
          years: [],
          yearId: null,
          journals: [{ id: JOURNAL, unit: UNIT, subject: SUBJECT }],
        }),
      [`GET /api/journal/journals/${JOURNAL}`]: () => refusal('journal_no_quarter', 409),
      'GET /api/journal/support': () => json(SUPPORT),
    });
    renderApp(`/journal/support?journal=${JOURNAL}&student=${STUDENT}&date=2026-10-26`, 'en');
    await screen.findByRole('heading', { name: en.journal.support.title });
    // The grid is not read: the date's quarter comes from the grid, which refused here.
    expect(await screen.findByText(en.errors.journal_no_quarter)).not.toBeNull();
    expect(calls.some((one) => one.route === 'GET /api/journal/support')).toBe(false);
  });

  it('shows the loading outline, not the empty state, while the grid of a complete address is read', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': as('academic_vice_principal'),
      'GET /api/journal/journals': () =>
        json({
          years: [],
          yearId: null,
          journals: [{ id: JOURNAL, unit: UNIT, subject: SUBJECT }],
        }),
      [`GET /api/journal/journals/${JOURNAL}`]: () => new Promise<Response>(() => undefined),
      'GET /api/journal/support': () => json(SUPPORT),
    });
    renderApp(`/journal/support?journal=${JOURNAL}&student=${STUDENT}&date=2026-10-26`, 'en');
    await screen.findByRole('heading', { name: en.journal.support.title });
    await waitFor(() => {
      expect(document.querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();
    });
    expect(screen.queryByText(en.journal.support.empty)).toBeNull();
    expect(calls.some((one) => one.route === 'GET /api/journal/support')).toBe(false);
  });

  it('renders the answer of the server', async () => {
    fakeApi({
      'GET /api/auth/session': as('academic_vice_principal'),
      'GET /api/journal/journals': () =>
        json({
          years: [],
          yearId: null,
          journals: [{ id: JOURNAL, unit: UNIT, subject: SUBJECT }],
        }),
      [`GET /api/journal/journals/${JOURNAL}`]: () =>
        json(gridWith({ quarters: [Q1, Q2], quarter: Q1 })),
      'GET /api/journal/support': () => json(SUPPORT),
    });
    renderApp(`/journal/support?journal=${JOURNAL}&student=${STUDENT}&date=2026-10-26`, 'en');
    const view = await waitFor(() => {
      const found = document.querySelector('[data-support-view="true"]');
      if (!(found instanceof HTMLElement)) throw new Error('not yet');
      return found;
    });
    const lesson = view.querySelector(`[data-support-lesson="${LESSON}"]`);
    expect(lesson?.textContent).toContain('Mark 4');
    expect(lesson?.textContent).toContain('Stored: mark 0');
    expect(lesson?.textContent).toContain('hidden by a Temporary exemption');
    expect(view.querySelector('[data-support-quarter="true"]')?.textContent).toContain(
      'result 75, grade 4 · provisional',
    );
    const lines = [...view.querySelectorAll('tbody tr')].map((row) => [
      row.getAttribute('data-line'),
      ...[...row.querySelectorAll('td')].slice(1).map((cell) => cell.textContent ?? ''),
    ]);
    expect(lines).toEqual([
      [
        'cell',
        'Attendance: empty → 0 (Absent from school)',
        en.journal.changes.offline_entry,
        'Karimova Aziza',
      ],
      [
        'refusal',
        'Refused: Attendance, sent 1 (Present)',
        en.errors.journal_locked,
        'Karimova Aziza',
      ],
      [
        'cell',
        'Attendance: 0 (Absent from school) → 0 (Absent from school)',
        `${en.journal.changes.correction} · Seen in the corridor`,
        'Karimova Aziza',
      ],
      ['work', 'Total of Classwork: — → 20', en.journal.works.changes.entry, 'Karimova Aziza'],
      ['delivery', en.journal.support.topic, en.journal.support.set, 'Karimova Aziza'],
      [
        'exemption_clear',
        'Cleared by an exemption: Attendance, 1 (Present)',
        'Temporary exemption 26 October 2026 – 26 October 2026',
        '—',
      ],
      [
        'exemption_give_back',
        'Given back after the exemption changed: Attendance, 1 (Present)',
        'Temporary exemption 26 October 2026 – 26 October 2026',
        '—',
      ],
      [
        'void',
        'Voided: Attendance, 1 (Present)',
        `${en.journal.support.sources.leaving} · Left for another school`,
        'Karimova Aziza',
      ],
      [
        'void_give_back',
        'Void given back: Attendance, 1 (Present)',
        en.journal.support.sources.leaving,
        'Karimova Aziza',
      ],
      ['rating', 'Rating exam: — → 77', '', 'Karimova Aziza'],
    ]);
    expect(within(view).getByText(/Late counts 50/)).not.toBeNull();
  });
});

/** A grid of the journal with the quarters given; the support view reads only its quarters and students. */
function gridWith(rest: { quarters: (typeof Q1)[]; quarter: typeof Q1 }) {
  return {
    journal: {
      id: JOURNAL,
      unit: UNIT,
      subject: SUBJECT,
      year: { id: uid(50), startDate: '2026-09-01', endDate: '2027-05-31', closed: false },
      attendanceOnly: false,
      ratingExam: false,
    },
    rating: null,
    years: [],
    others: [],
    today: '2026-10-27',
    referenceDate: '2026-10-27',
    teacher: null,
    shape: 'whole',
    months: ['2026-10'],
    lessons: [],
    reminders: [],
    students: [],
    lastTotal: null,
    bottom: null,
    absences: [],
    legend: SUPPORT.legend,
    ...rest,
  };
}
