import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../database/transactions.js';
import {
  joinCoverRows,
  planGiveBack,
  SeatBook,
  type ClassRowToCover,
  type CoverGroup,
  type CoverRow,
} from './class-groups.js';
import type { HeldRange, StoredGroupMembership } from './group-membership-rows.js';

const YEAR_END = '2027-06-01';

/** A seat book with no stored row: every group has its seats. */
class EmptyBook extends SeatBook {
  constructor() {
    super(undefined as unknown as Transaction);
  }

  override storedOf(): Promise<HeldRange[]> {
    return Promise.resolve([]);
  }
}

const cover = (input: Partial<CoverRow>): CoverRow => ({
  studentId: 's',
  groupId: 'g1',
  subjectId: 'maths',
  branchId: 'b',
  from: '2026-10-01',
  until: YEAR_END,
  ownUntil: YEAR_END,
  leavingId: null,
  cause: 'automatic',
  review: true,
  writtenByMoveId: null,
  endedByMoveId: null,
  ...input,
});

// One stay in a group is one row (task 3.5c, `group_memberships_one_stay`):
// `joinCoverRows` joins an automatic row with a row given back of the same
// group, from either side; each branch by a test of its own (spec review of
// the build, should-fix 1).
describe('the automatic rows and the rows given back of one group', () => {
  it('lets an automatic row take the days of a row given back that begins where it ends', () => {
    const given = cover({
      growId: 'planned',
      from: '2026-11-16',
      cause: 'cancel',
      review: false,
      leavingId: 'L',
      until: '2026-12-01',
    });
    const automatic = cover({ from: '2026-11-01', until: '2026-11-16', ownUntil: '2026-11-16' });
    expect(joinCoverRows([given], [automatic])).toEqual({
      given: [],
      automatic: [{ ...automatic, until: '2026-12-01', ownUntil: YEAR_END, leavingId: 'L' }],
    });
  });

  it('lets a row given back take the days of an automatic row that begins where it ends', () => {
    const given = cover({
      growId: 'cut',
      from: '2026-10-01',
      until: '2026-10-19',
      cause: 'cancel',
    });
    const automatic = cover({ from: '2026-10-19', until: YEAR_END });
    expect(joinCoverRows([given], [automatic])).toEqual({
      given: [{ ...given, until: YEAR_END }],
      automatic: [],
    });
  });

  it('leaves rows of other groups or with a gap as they are', () => {
    const given = cover({ growId: 'cut', from: '2026-10-01', until: '2026-10-19' });
    const other = cover({ groupId: 'g2', from: '2026-10-19' });
    const later = cover({ from: '2026-10-20' });
    expect(joinCoverRows([given], [other, later])).toEqual({
      given: [given],
      automatic: [other, later],
    });
  });
});

const group: CoverGroup = {
  id: 'g1',
  branchId: 'b',
  subjectId: 'maths',
  nameKey: 'g1',
  maxSize: 20,
  inService: true,
  classIds: new Set(['oxford']),
};

const stored = (input: Partial<StoredGroupMembership>): StoredGroupMembership => ({
  id: 'r1',
  groupId: 'g1',
  subjectId: 'maths',
  validFrom: '2026-09-02',
  validUntil: '2026-10-01',
  ownUntil: YEAR_END,
  endedBy: 'leaving',
  leavingId: 'L',
  cause: 'placement',
  writtenByMoveId: null,
  endedByMoveId: null,
  ...input,
});

const classRow = (input: Partial<ClassRowToCover>): ClassRowToCover => ({
  studentId: 's',
  classId: 'oxford',
  from: '2026-10-01',
  until: YEAR_END,
  ownUntil: YEAR_END,
  leavingId: null,
  ...input,
});

// The group rows a leaving taken back gives back (task 3.5c, decision 1):
// each branch of `planGiveBack` by a test of its own.
describe('the group rows a take-back gives back', () => {
  const give = (rows: StoredGroupMembership[], classRows: ClassRowToCover[]) =>
    planGiveBack(
      new EmptyBook(),
      new Map([['g1', group]]),
      's',
      rows,
      classRows,
      { leavingId: 'L', from: '2026-10-01' },
      null,
      'undo',
      new Map(),
    );

  it('grows the row over a continuation a cancel wrote before 0062', async () => {
    const back = stored({
      id: 'r2',
      validFrom: '2026-10-21',
      validUntil: '2026-10-21',
      cause: 'cancel',
    });
    const given = await give([stored({}), back], [classRow({})]);
    expect(given.map((row) => [row.growId, row.from, row.until, row.leavingId])).toEqual([
      ['r1', '2026-10-01', YEAR_END, null],
    ]);
  });

  it('gives nothing back when the class rows end before the row could, with nothing to end it', async () => {
    // The class row given back stops on 1 November with no leaving and no move.
    const given = await give([stored({})], [classRow({ until: '2026-11-01' })]);
    expect(given).toEqual([]);
  });

  it('ends the row at a leaving that ends the class rows', async () => {
    const given = await give([stored({})], [classRow({ until: '2026-11-01', leavingId: 'L2' })]);
    expect(given.map((row) => [row.until, row.leavingId])).toEqual([['2026-11-01', 'L2']]);
  });
});
