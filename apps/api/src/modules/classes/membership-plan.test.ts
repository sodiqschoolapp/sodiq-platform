import { describe, expect, it } from 'vitest';
import {
  placementEnd,
  planMemberships,
  type PlacementStatus,
  type StoredMembership,
} from './membership-plan.js';

const YEAR_END = '2027-06-01';

const row = (
  id: string,
  validFrom: string,
  validUntil = YEAR_END,
  extra: Partial<StoredMembership> = {},
): StoredMembership => ({
  id,
  classId: 'oxford',
  validFrom,
  validUntil,
  ownUntil: YEAR_END,
  endedBy: null,
  leavingId: null,
  cause: 'placement',
  writtenByMoveId: null,
  endedByMoveId: null,
  ...extra,
});

const always = () => true;

// The class rows of a student through a leaving, its cancel, undo and
// replace (task 3.1b, decision 1 with correction 1 of the plan review; task
// 3.5c, decision 1: a take-back grows the row it cut).
describe('the class rows through a change of a leaving', () => {
  it('cuts the rows in force at the first inactive day and empties the planned ones', () => {
    const plan = planMemberships(
      [
        row('now', '2026-09-01'),
        row('past', '2026-01-10', '2026-06-01'),
        row('later', '2027-01-04'),
      ],
      { takeBack: null, leave: { from: '2026-11-02' } },
      always,
    );
    expect(plan.cuts).toEqual([
      { id: 'now', validUntil: '2026-11-02' },
      { id: 'later', validUntil: '2027-01-04' },
    ]);
    expect(plan.grows).toEqual([]);
  });

  it('grows back the row a cancelled leaving cut, from its first inactive day to its own end', () => {
    const cut = row('now', '2026-09-01', '2026-11-02', { endedBy: 'leaving', leavingId: 'L0' });
    const other = row('other', '2026-09-01', '2026-10-01', { endedBy: 'leaving', leavingId: 'X' });
    const plan = planMemberships(
      [cut, other],
      { takeBack: { leavingId: 'L0', from: '2026-11-02' }, leave: null },
      always,
    );
    expect(plan.cuts).toEqual([]);
    // H36 of issue #105: the same row, not a new planned one.
    expect(plan.grows).toEqual([
      {
        id: 'now',
        classId: 'oxford',
        from: '2026-11-02',
        validUntil: YEAR_END,
        ownUntil: YEAR_END,
        endedBy: null,
        endedByMoveId: null,
      },
    ]);
  });

  it('grows back a planned row the leaving emptied from its own first day', () => {
    const emptied = row('later', '2027-01-04', '2027-01-04', {
      endedBy: 'leaving',
      leavingId: 'L0',
    });
    const plan = planMemberships(
      [emptied],
      { takeBack: { leavingId: 'L0', from: '2026-11-02' }, leave: null },
      always,
    );
    expect(plan.grows).toEqual([
      {
        id: 'later',
        classId: 'oxford',
        from: '2027-01-04',
        validUntil: YEAR_END,
        ownUntil: YEAR_END,
        endedBy: null,
        endedByMoveId: null,
      },
    ]);
  });

  it('names the rows of a class out of service and does not give them back', () => {
    const cut = row('now', '2026-09-01', '2026-11-02', { endedBy: 'leaving', leavingId: 'L0' });
    const plan = planMemberships(
      [cut],
      { takeBack: { leavingId: 'L0', from: '2026-11-02' }, leave: null },
      () => false,
    );
    expect(plan.grows).toEqual([]);
    expect(plan.notRestored).toEqual([cut]);
  });

  it('replaces a scheduled leaving by an earlier date: the cut rows are cut again, the emptied ones taken over', () => {
    const cut = row('now', '2026-09-01', '2026-12-01', { endedBy: 'leaving', leavingId: 'L0' });
    const emptied = row('later', '2027-01-04', '2027-01-04', {
      endedBy: 'leaving',
      leavingId: 'L0',
    });
    const plan = planMemberships(
      [cut, emptied],
      { takeBack: { leavingId: 'L0', from: '2026-12-01' }, leave: { from: '2026-11-02' } },
      always,
    );
    expect(plan.cuts).toEqual([
      { id: 'now', validUntil: '2026-11-02' },
      { id: 'later', validUntil: '2027-01-04' },
    ]);
    expect(plan.grows).toEqual([]);
  });

  it('replaces a scheduled leaving by a later date: the row grows up to the new date, cut by it', () => {
    const cut = row('now', '2026-09-01', '2026-11-02', { endedBy: 'leaving', leavingId: 'L0' });
    const plan = planMemberships(
      [cut],
      { takeBack: { leavingId: 'L0', from: '2026-11-02' }, leave: { from: '2027-01-04' } },
      always,
    );
    expect(plan.cuts).toEqual([]);
    expect(plan.grows).toEqual([
      {
        id: 'now',
        classId: 'oxford',
        from: '2026-11-02',
        validUntil: '2027-01-04',
        ownUntil: YEAR_END,
        endedBy: 'leaving',
        endedByMoveId: null,
      },
    ]);
  });

  it('refuses two rows given back that meet without a move between them', () => {
    // A placement or a return never begins inside a row of the student, so
    // only a move writes the later of two rows a leaving cut.
    const first = row('first', '2026-09-02', '2026-10-01', {
      endedBy: 'leaving',
      leavingId: 'L2',
    });
    const back = row('back', '2026-10-11', '2026-10-11', { endedBy: 'leaving', leavingId: 'L2' });
    expect(() =>
      planMemberships(
        [first, back],
        { takeBack: { leavingId: 'L2', from: '2026-10-01' }, leave: null },
        always,
      ),
    ).toThrow('A row given back meets the next one only at a move.');
  });

  it('grows a row over a continuation a cancel wrote before 0062, which stays as it is', () => {
    // Spec review of the build, must-fix 2: a leaving and its cancel before
    // 0062 wrote the second row; an earlier leaving cut the first and emptied
    // the second. Its undo gives the stay back as one row.
    const first = row('first', '2026-09-02', '2026-10-02', { endedBy: 'leaving', leavingId: 'L2' });
    const back = row('back', '2026-10-21', '2026-10-21', {
      endedBy: 'leaving',
      leavingId: 'L2',
      cause: 'cancel',
    });
    const plan = planMemberships(
      [first, back],
      { takeBack: { leavingId: 'L2', from: '2026-10-02' }, leave: null },
      always,
    );
    expect(plan.grows).toEqual([
      {
        id: 'first',
        classId: 'oxford',
        from: '2026-10-02',
        validUntil: YEAR_END,
        ownUntil: YEAR_END,
        endedBy: null,
        endedByMoveId: null,
      },
    ]);
  });

  it('replaces a scheduled leaving by the same date and changes no day', () => {
    const cut = row('now', '2026-09-01', '2026-11-02', { endedBy: 'leaving', leavingId: 'L0' });
    const plan = planMemberships(
      [cut],
      { takeBack: { leavingId: 'L0', from: '2026-11-02' }, leave: { from: '2026-11-02' } },
      always,
    );
    // The new leaving names the row; a later cancel gives it back from 2 November.
    expect(plan).toEqual({
      cuts: [{ id: 'now', validUntil: '2026-11-02' }],
      grows: [],
      notRestored: [],
    });
  });

  it('leaves a withdrawn row withdrawn', () => {
    const withdrawn = row('w', '2026-12-01', '2026-12-01', { endedBy: 'withdrawn' });
    expect(
      planMemberships([withdrawn], { takeBack: null, leave: { from: '2026-11-02' } }, always),
    ).toEqual({ cuts: [], grows: [], notRestored: [] });
  });
});

const active = (
  id: string,
  from: string,
  until: string | null,
  cause = 'start',
): PlacementStatus => ({
  id,
  status: 'active',
  validFrom: from,
  validUntil: until,
  cause,
});

// The end of a placement (decision 6; should-fix 9 of the plan review).
describe('the end of a placement', () => {
  it('runs to the day after the year while the student stays active', () => {
    expect(
      placementEnd([active('a', '2026-09-01', null)], '2026-09-01', '2026-10-14', YEAR_END),
    ).toEqual({
      until: YEAR_END,
      leavingId: null,
    });
    // A cancel fill: two active rows back to back are one active time.
    expect(
      placementEnd(
        [
          active('a', '2026-09-01', '2026-11-02'),
          {
            id: 'l',
            status: 'inactive',
            validFrom: '2026-11-02',
            validUntil: '2026-11-02',
            cause: 'leaving',
          },
          active('b', '2026-11-02', null, 'cancel'),
        ],
        '2026-09-01',
        '2026-10-14',
        YEAR_END,
      ),
    ).toEqual({ until: YEAR_END, leavingId: null });
  });

  it('ends at a scheduled leaving and names it', () => {
    expect(
      placementEnd(
        [
          active('a', '2026-09-01', '2026-12-01'),
          {
            id: 'l',
            status: 'inactive',
            validFrom: '2026-12-01',
            validUntil: null,
            cause: 'leaving',
          },
        ],
        '2026-09-01',
        '2026-10-14',
        YEAR_END,
      ),
    ).toEqual({ until: '2026-12-01', leavingId: 'l' });
  });

  it('refuses before the start date, outside the active time, and up to a graduation', () => {
    const rows = [
      active('a', '2026-09-01', '2026-12-01'),
      { id: 'l', status: 'inactive', validFrom: '2026-12-01', validUntil: null, cause: 'leaving' },
    ];
    expect(placementEnd(rows, '2026-09-01', '2026-08-31', YEAR_END)).toEqual({
      refusal: 'membership_before_start',
    });
    expect(placementEnd(rows, '2026-09-01', '2026-12-01', YEAR_END)).toEqual({
      refusal: 'student_not_active_on',
    });
    expect(
      placementEnd(
        [
          active('a', '2026-09-01', '2027-05-01'),
          {
            id: 'g',
            status: 'graduated',
            validFrom: '2027-05-01',
            validUntil: null,
            cause: 'graduation',
          },
        ],
        '2026-09-01',
        '2026-10-14',
        YEAR_END,
      ),
    ).toEqual({ refusal: 'student_not_active_on' });
  });
});

// Task 3.3a, decision 8 and must-fix 1 of the plan review: a leaving dated on
// or before a scheduled move cancels it; taking that leaving back gives the
// row the move cut back to its own end and never the row the move wrote.
describe('the class rows of a move cancelled by a leaving', () => {
  const cut = row('oxford', '2026-09-01', '2026-11-02', { endedBy: 'leaving', leavingId: 'L' });
  const target = row('yale', '2026-11-16', '2026-11-16', {
    classId: 'yale',
    endedBy: 'leaving',
    leavingId: 'L',
    cause: 'transfer',
    writtenByMoveId: 'M',
  });

  it('gives back the row the move cut to its own end when the move is cancelled', () => {
    const plan = planMemberships(
      [cut, target],
      { takeBack: { leavingId: 'L', from: '2026-11-02' }, leave: null },
      always,
      new Set(['M']),
    );
    // Task 3.3a, decision 8: the row a cancelled move wrote is not given back.
    expect(plan.grows).toEqual([
      {
        id: 'oxford',
        classId: 'oxford',
        from: '2026-11-02',
        validUntil: YEAR_END,
        ownUntil: YEAR_END,
        endedBy: null,
        endedByMoveId: null,
      },
    ]);
  });

  it('gives back both rows of a move that was not cancelled, the first ending at the move', () => {
    const plan = planMemberships(
      [cut, target],
      { takeBack: { leavingId: 'L', from: '2026-11-02' }, leave: null },
      always,
    );
    expect(
      plan.grows.map((one) => [one.id, one.from, one.validUntil, one.endedBy, one.endedByMoveId]),
    ).toEqual([
      ['oxford', '2026-11-02', '2026-11-16', 'transfer', 'M'],
      ['yale', '2026-11-16', YEAR_END, null, null],
    ]);
  });
});
