import { nextDay as dayAfter } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import {
  historyLines,
  holdsData,
  planCancelLeaving,
  planCancelReturn,
  planLeaving,
  planRestore,
  planReturn,
  planUndoLeaving,
  plannedAfter,
  type StoredStudentStatus,
  type StudentStatusOutcome,
  type StudentStatusPlan,
} from './student-status.js';

// docs/spec/04-people.md, Movements; docs/spec/edge-cases/students-classes-groups.md;
// the plan approved on pull request #68. Today is 10 October 2026.
const TODAY = '2026-10-10';

const row = (
  id: string,
  status: StoredStudentStatus['status'],
  validFrom: string,
  validUntil: string | null,
  cause: StoredStudentStatus['cause'],
): StoredStudentStatus => ({ id, status, validFrom, validUntil, cause });

const started = (from = '2026-09-02') => [row('a', 'active', from, null, 'start')];

function planOf(outcome: StudentStatusOutcome): StudentStatusPlan {
  if ('refusal' in outcome) {
    throw new Error(`Refused: ${outcome.refusal}`);
  }
  return outcome;
}

/** The rows after a plan, as the database would hold them; new rows get ids n1, n2, … */
function applied(rows: readonly StoredStudentStatus[], plan: StudentStatusPlan, prefix = 'n') {
  const cut = rows.map((one) => {
    const change = plan.cuts.find((c) => c.id === one.id);
    return change === undefined ? one : { ...one, validUntil: change.validUntil };
  });
  return [
    ...cut,
    ...plan.writes.map((write, index) =>
      row(
        `${prefix}${String(index + 1)}`,
        write.status,
        write.validFrom,
        write.validUntil,
        write.cause,
      ),
    ),
  ];
}

/** Rows never overlap, never grow, and none is lost. */
function expectSound(
  before: readonly StoredStudentStatus[],
  after: readonly StoredStudentStatus[],
) {
  for (const old of before) {
    const now = after.find((one) => one.id === old.id);
    expect(now).toBeDefined();
    if (now === undefined) {
      continue;
    }
    expect(now.validFrom).toBe(old.validFrom);
    if (old.validUntil !== null) {
      expect(now.validUntil !== null && now.validUntil <= old.validUntil).toBe(true);
    }
    if (now.validUntil !== null) {
      expect(now.validUntil >= now.validFrom).toBe(true);
    }
  }
  const live = after
    .filter((one) => one.validUntil !== one.validFrom)
    .sort((a, b) => (a.validFrom < b.validFrom ? -1 : 1));
  for (let index = 1; index < live.length; index += 1) {
    const previous = live[index - 1];
    const current = live[index];
    if (previous !== undefined && current !== undefined) {
      // Back to back: no overlap and no gap.
      expect(previous.validUntil).toBe(current.validFrom);
    }
  }
}

describe('planLeaving (edge: "The leave date is the last day as a student")', () => {
  it('makes the student inactive from the day after the last day, past or future', () => {
    for (const lastDay of ['2026-10-01', TODAY, '2026-12-25']) {
      const rows = started();
      const plan = planOf(planLeaving(rows, lastDay, 'Moved away', TODAY));
      expect(plan.cuts).toEqual([{ id: 'a', validUntil: dayAfter(lastDay) }]);
      expect(plan.writes).toEqual([
        {
          status: 'inactive',
          validFrom: dayAfter(lastDay),
          validUntil: null,
          cause: 'leaving',
          reason: 'Moved away',
        },
      ]);
      expectSound(rows, applied(rows, plan));
    }
  });

  it('refuses a last day before the start, and allows the day before it for a student who never started', () => {
    expect(planLeaving(started(), '2026-08-30', 'Never came', TODAY)).toEqual({
      refusal: 'leaving_before_start',
    });
    const plan = planOf(planLeaving(started(), '2026-09-01', 'Never came', TODAY));
    expect(plan.cuts).toEqual([{ id: 'a', validUntil: '2026-09-02' }]);
    expect(plan.writes[0]).toMatchObject({ status: 'inactive', validFrom: '2026-09-02' });
  });

  it('refuses the day before a return: that is not a leaving of the time since', () => {
    const rows = [
      row('a', 'active', '2026-09-02', '2026-09-20', 'start'),
      row('b', 'inactive', '2026-09-20', '2026-10-01', 'leaving'),
      row('c', 'active', '2026-10-01', null, 'return'),
    ];
    expect(planLeaving(rows, '2026-09-30', 'Again', TODAY)).toEqual({
      refusal: 'leaving_before_start',
    });
    expect('refusal' in planLeaving(rows, '2026-10-01', 'Again', TODAY)).toBe(false);
  });

  it('refuses a student who is inactive or graduated', () => {
    const left = [
      row('a', 'active', '2026-09-02', '2026-10-01', 'start'),
      row('b', 'inactive', '2026-10-01', null, 'leaving'),
    ];
    expect(planLeaving(left, '2026-10-05', 'Again', TODAY)).toEqual({
      refusal: 'student_not_active',
    });
    const graduated = [
      row('a', 'active', '2025-09-02', '2026-06-01', 'start'),
      row('b', 'graduated', '2026-06-01', null, 'graduation'),
    ];
    expect(planLeaving(graduated, '2026-10-05', 'Again', TODAY)).toEqual({
      refusal: 'student_not_active',
    });
  });

  it('replaces a scheduled leaving with an earlier or a later one (edge: "changed ... until the date")', () => {
    const scheduled = [
      row('a', 'active', '2026-09-02', '2026-11-01', 'start'),
      row('b', 'inactive', '2026-11-01', null, 'leaving'),
    ];
    const earlier = planOf(planLeaving(scheduled, '2026-10-20', 'Earlier', TODAY));
    expect(earlier.cuts).toEqual([
      { id: 'b', validUntil: '2026-11-01' },
      { id: 'a', validUntil: '2026-10-21' },
    ]);
    expect(earlier.writes).toHaveLength(1);
    expectSound(scheduled, applied(scheduled, earlier));

    const later = planOf(planLeaving(scheduled, '2026-11-30', 'Later', TODAY));
    expect(later.cuts).toEqual([{ id: 'b', validUntil: '2026-11-01' }]);
    expect(later.writes).toEqual([
      {
        status: 'active',
        validFrom: '2026-11-01',
        validUntil: '2026-12-01',
        cause: 'cancel',
        reason: null,
      },
      {
        status: 'inactive',
        validFrom: '2026-12-01',
        validUntil: null,
        cause: 'leaving',
        reason: 'Later',
      },
    ]);
    expectSound(scheduled, applied(scheduled, later));
  });

  it('keeps every row sound for every last day in the year and past it', () => {
    // Every day from the start to over a year later: fast-check is no dependency of the API.
    for (let offset = 0; offset <= 400; offset += 1) {
      const lastDay = new Date(Date.UTC(2026, 8, 1 + offset)).toISOString().slice(0, 10);
      const rows = started();
      const outcome = planLeaving(rows, lastDay, 'Reason', TODAY);
      expect('refusal' in outcome).toBe(lastDay < '2026-09-01');
      if (!('refusal' in outcome)) {
        expectSound(rows, applied(rows, outcome));
      }
    }
  });
});

describe('planCancelLeaving', () => {
  const scheduled = [
    row('a', 'active', '2026-09-02', '2026-10-11', 'start'),
    row('b', 'inactive', '2026-10-11', null, 'leaving'),
  ];

  it('takes back a scheduled leaving and fills the time again', () => {
    const plan = planOf(planCancelLeaving(scheduled, TODAY));
    expect(plan.cuts).toEqual([{ id: 'b', validUntil: '2026-10-11' }]);
    expect(plan.writes).toEqual([
      {
        status: 'active',
        validFrom: '2026-10-11',
        validUntil: null,
        cause: 'cancel',
        reason: null,
      },
    ]);
    expectSound(scheduled, applied(scheduled, plan));
  });

  it('refuses a leaving in force, and a student with none', () => {
    expect(planCancelLeaving(scheduled, '2026-10-11')).toEqual({ refusal: 'leaving_in_force' });
    expect(planCancelLeaving(started(), TODAY)).toEqual({ refusal: 'leaving_not_planned' });
  });
});

describe('planUndoLeaving (edge: "A leaving entered by mistake")', () => {
  const left = [
    row('a', 'active', '2026-09-02', '2026-10-01', 'start'),
    row('b', 'inactive', '2026-10-01', null, 'leaving'),
  ];

  it('closes the gap from the first inactive day', () => {
    const plan = planOf(planUndoLeaving(left, 'Entered by mistake', TODAY));
    expect(plan.cuts).toEqual([{ id: 'b', validUntil: '2026-10-01' }]);
    expect(plan.writes).toEqual([
      {
        status: 'active',
        validFrom: '2026-10-01',
        validUntil: null,
        cause: 'undo',
        reason: 'Entered by mistake',
      },
    ]);
    expectSound(left, applied(left, plan));
  });

  it('refuses an inactive row that no leaving wrote (decision 8)', () => {
    const other = [
      row('a', 'active', '2026-09-02', '2026-10-01', 'start'),
      row('b', 'inactive', '2026-10-01', null, 'return'),
    ];
    expect(planUndoLeaving(other, 'Why', TODAY)).toEqual({ refusal: 'undo_not_leaving' });
  });

  it('refuses a scheduled leaving, an active student and a graduation', () => {
    expect(planUndoLeaving(left, 'Why', '2026-09-30')).toEqual({ refusal: 'student_not_inactive' });
    expect(planUndoLeaving(started(), 'Why', TODAY)).toEqual({ refusal: 'student_not_inactive' });
    const graduated = [
      row('a', 'active', '2025-09-02', '2026-06-01', 'start'),
      row('b', 'graduated', '2026-06-01', null, 'graduation'),
    ];
    expect(planUndoLeaving(graduated, 'Why', TODAY)).toEqual({ refusal: 'student_not_inactive' });
  });
});

describe('planReturn (04: "restored from the Inactive list")', () => {
  const left = [
    row('a', 'active', '2026-09-02', '2026-09-20', 'start'),
    row('b', 'inactive', '2026-09-20', null, 'leaving'),
  ];

  it('makes the student active from the return date, keeping the time away', () => {
    const plan = planOf(planReturn(left, '2026-10-05', null, TODAY));
    expect(plan.cuts).toEqual([{ id: 'b', validUntil: '2026-10-05' }]);
    expect(plan.writes).toEqual([
      {
        status: 'active',
        validFrom: '2026-10-05',
        validUntil: null,
        cause: 'return',
        reason: null,
      },
    ]);
    expectSound(left, applied(left, plan));
    expect('refusal' in planReturn(left, TODAY, 'Back', TODAY)).toBe(false);
  });

  it('refuses the first inactive day, a date after today and an active student', () => {
    expect(planReturn(left, '2026-09-20', null, TODAY)).toEqual({ refusal: 'return_too_early' });
    expect(planReturn(left, '2026-09-10', null, TODAY)).toEqual({ refusal: 'return_too_early' });
    expect(planReturn(left, '2026-10-11', null, TODAY)).toEqual({ refusal: 'status_date_future' });
    expect(planReturn(started(), '2026-10-05', null, TODAY)).toEqual({
      refusal: 'student_not_inactive',
    });
  });
});

describe('planRestore (edge: "A student is graduated by mistake")', () => {
  const graduated = [
    row('a', 'active', '2025-09-02', '2026-06-01', 'start'),
    row('b', 'graduated', '2026-06-01', null, 'graduation'),
  ];

  it('takes the graduation back on its first day, and cuts it on a later one', () => {
    const back = planOf(planRestore(graduated, '2026-06-01', 'Graduated by mistake', TODAY));
    expect(back.cuts).toEqual([{ id: 'b', validUntil: '2026-06-01' }]);
    expectSound(graduated, applied(graduated, back));
    const later = planOf(planRestore(graduated, '2026-09-01', 'Graduated by mistake', TODAY));
    expect(later.cuts).toEqual([{ id: 'b', validUntil: '2026-09-01' }]);
    expect(later.writes[0]).toMatchObject({ status: 'active', cause: 'restore' });
  });

  it('refuses a date before the graduation or after today, and a student not graduated', () => {
    expect(planRestore(graduated, '2026-05-31', 'Why', TODAY)).toEqual({
      refusal: 'restore_before_graduation',
    });
    expect(planRestore(graduated, '2026-10-11', 'Why', TODAY)).toEqual({
      refusal: 'status_date_future',
    });
    expect(planRestore(started(), TODAY, 'Why', TODAY)).toEqual({
      refusal: 'student_not_graduated',
    });
  });
});

describe('holdsData (edge: "A student is created twice by mistake"; decision 14)', () => {
  it('blocks a scholarship, a second contract, and a live status that is not active', () => {
    expect(holdsData(started(), 'none', 1, 0)).toBe(false);
    expect(holdsData(started(), 'merit', 1, 0)).toBe(true);
    expect(holdsData(started(), 'none', 2, 0)).toBe(true);
    // Task 6.1a: a journal cell.
    expect(holdsData(started(), 'none', 1, 1)).toBe(true);
    const scheduled = [
      row('a', 'active', '2026-09-02', '2026-10-11', 'start'),
      row('b', 'inactive', '2026-10-11', null, 'leaving'),
    ];
    expect(holdsData(scheduled, 'none', 1, 0)).toBe(true);
  });

  it('lets a cancelled or undone leaving pass', () => {
    const cancelled = [
      row('a', 'active', '2026-09-02', '2026-10-11', 'start'),
      row('b', 'inactive', '2026-10-11', '2026-10-11', 'leaving'),
      row('c', 'active', '2026-10-11', null, 'cancel'),
    ];
    expect(holdsData(cancelled, 'none', 1, 0)).toBe(false);
  });
});

describe('plannedAfter (the "leaves on" badge)', () => {
  it('names a scheduled leaving, and not the start of a student who starts later', () => {
    const scheduled = [
      row('a', 'active', '2026-09-02', '2026-11-01', 'start'),
      row('b', 'inactive', '2026-11-01', null, 'leaving'),
    ];
    expect(plannedAfter(scheduled, TODAY)).toEqual({ status: 'inactive', from: '2026-11-01' });
    expect(plannedAfter(started('2026-11-01'), TODAY)).toBeNull();
    expect(plannedAfter(started(), TODAY)).toBeNull();
  });

  it('shows no badge for the fill of a cancelled leaving', () => {
    const cancelled = [
      row('a', 'active', '2026-09-02', '2026-10-11', 'start'),
      row('b', 'inactive', '2026-10-11', '2026-10-11', 'leaving'),
      row('c', 'active', '2026-10-11', null, 'cancel'),
    ];
    expect(plannedAfter(cancelled, TODAY)).toBeNull();
  });
});

// Issue #39, hand test of 13 October 2026, finding 7: one unbroken line.
describe('the lines of the status history', () => {
  it('joins the fill of a leaving cancelled before its date', () => {
    const rows = [
      row('a', 'active', '2026-09-01', '2026-10-14', 'start'),
      row('b', 'inactive', '2026-10-14', '2026-10-14', 'leaving'),
      row('c', 'active', '2026-10-14', null, 'cancel'),
    ];
    expect(historyLines(rows)).toEqual([row('a', 'active', '2026-09-01', null, 'start')]);
  });

  it('joins the fill of an undone leaving', () => {
    const rows = [
      row('a', 'active', '2026-09-01', '2026-10-05', 'start'),
      row('b', 'inactive', '2026-10-05', '2026-10-05', 'leaving'),
      row('c', 'active', '2026-10-05', null, 'undo'),
    ];
    expect(historyLines(rows)).toEqual([row('a', 'active', '2026-09-01', null, 'start')]);
  });

  it('keeps a real break: a leaving in force, then a return', () => {
    const rows = [
      row('a', 'active', '2026-09-01', '2026-10-05', 'start'),
      row('b', 'inactive', '2026-10-05', '2026-10-08', 'leaving'),
      row('c', 'active', '2026-10-08', null, 'return'),
    ];
    expect(historyLines(rows)).toEqual(rows);
  });

  it('keeps a scheduled leaving and the active time before it', () => {
    const rows = [
      row('a', 'active', '2026-09-01', '2026-10-20', 'start'),
      row('b', 'inactive', '2026-10-20', null, 'leaving'),
    ];
    expect(historyLines(rows)).toEqual(rows);
  });
});

// Task 3.6b-2, owner's answer L170: a return or restore dated the first day of
// the next planned year, its cancel, and the planners reading a row and its
// `cancel` row as one stay (decision 4).
describe('a return or restore on the first day of next year', () => {
  const AUGUST = '2027-09-01';
  const left = [
    row('a', 'active', '2026-09-02', '2026-10-06', 'start'),
    row('b', 'inactive', '2026-10-06', null, 'leaving'),
  ];

  it('allows only the first day of next year after today, and keeps the time away', () => {
    const plan = planOf(planReturn(left, AUGUST, null, TODAY, AUGUST));
    expect(applied(left, plan).map((one) => [one.status, one.validFrom, one.validUntil])).toEqual([
      ['active', '2026-09-02', '2026-10-06'],
      ['inactive', '2026-10-06', AUGUST],
      ['active', AUGUST, null],
    ]);
    expect(planReturn(left, '2027-09-02', null, TODAY, AUGUST)).toEqual({
      refusal: 'status_date_future',
    });
    expect(planReturn(left, AUGUST, null, TODAY, null)).toEqual({ refusal: 'status_date_future' });
    expect(planReturn(left, AUGUST, null, TODAY, '2027-10-01')).toEqual({
      refusal: 'status_date_future',
    });
  });

  it('allows the same day for a restore of a graduate', () => {
    const graduated = [
      row('a', 'active', '2026-09-02', '2026-10-01', 'start'),
      row('g', 'graduated', '2026-10-01', null, 'graduation'),
    ];
    const plan = planOf(planRestore(graduated, AUGUST, 'By mistake.', TODAY, AUGUST));
    expect(plan.writes).toEqual([
      expect.objectContaining({ status: 'active', validFrom: AUGUST, cause: 'restore' }),
    ]);
    expect(planRestore(graduated, '2027-09-02', 'By mistake.', TODAY, AUGUST)).toEqual({
      refusal: 'status_date_future',
    });
  });

  it('cancels a scheduled return by emptying its row and writing the earlier status from its date', () => {
    const planned = applied(left, planOf(planReturn(left, AUGUST, null, TODAY, AUGUST)));
    const plan = planOf(planCancelReturn(planned, TODAY));
    expect(plan.cuts).toEqual([{ id: 'n1', validUntil: AUGUST }]);
    expect(plan.writes).toEqual([
      { status: 'inactive', validFrom: AUGUST, validUntil: null, cause: 'cancel', reason: null },
    ]);
    expect(planCancelReturn(planned, TODAY)).toMatchObject({ cause: 'return' });
  });

  it('refuses a cancel with nothing scheduled, and one that has taken effect', () => {
    expect(planCancelReturn(left, TODAY)).toEqual({ refusal: 'return_not_planned' });
    expect(planCancelReturn(started(), TODAY)).toEqual({ refusal: 'return_not_planned' });
    const back = applied(left, planOf(planReturn(left, '2026-10-08', null, TODAY)));
    expect(planCancelReturn(back, TODAY)).toEqual({ refusal: 'return_in_force' });
  });

  it('reads a row and its cancel row as one stay, for a return again and an undo of the leaving', () => {
    const planned = applied(left, planOf(planReturn(left, AUGUST, null, TODAY, AUGUST)));
    const cancelled = applied(planned, planOf(planCancelReturn(planned, TODAY)), 'm');
    // Returned again, a day earlier than the cancel row began.
    const again = planOf(planReturn(cancelled, '2026-10-08', null, TODAY, AUGUST));
    const afterAgain = applied(cancelled, again);
    expect(
      afterAgain
        .filter((one) => one.validUntil === null || one.validFrom < one.validUntil)
        .map((one) => [one.status, one.validFrom, one.validUntil]),
    ).toEqual([
      ['active', '2026-09-02', '2026-10-06'],
      ['inactive', '2026-10-06', '2026-10-08'],
      ['active', '2026-10-08', null],
    ]);
    // The return may not come at or before the first inactive day of the stay.
    expect(planReturn(cancelled, '2026-10-06', null, TODAY, AUGUST)).toEqual({
      refusal: 'return_too_early',
    });
    // The undo closes the gap from the first day of the leaving, emptying both inactive rows.
    const undo = planOf(planUndoLeaving(cancelled, 'Entered by mistake.', TODAY));
    expect(undo.cuts).toEqual([
      { id: 'b', validUntil: '2026-10-06' },
      { id: 'm1', validUntil: AUGUST },
    ]);
    expect(undo.writes).toEqual([
      expect.objectContaining({ status: 'active', validFrom: '2026-10-06', cause: 'undo' }),
    ]);
  });

  it('shows one line for the stay in the history', () => {
    const planned = applied(left, planOf(planReturn(left, AUGUST, null, TODAY, AUGUST)));
    const cancelled = applied(planned, planOf(planCancelReturn(planned, TODAY)), 'm');
    expect(
      historyLines(cancelled).map((one) => [one.status, one.validFrom, one.validUntil]),
    ).toEqual([
      ['active', '2026-09-02', '2026-10-06'],
      ['inactive', '2026-10-06', null],
    ]);
  });
});
