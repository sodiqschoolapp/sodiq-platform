import { describe, expect, it } from 'vitest';
import { ApiException } from '../../http/api-exception.js';
import type { StoredMembership } from '../classes/membership-plan.js';
import { atClassFields, classLeft, groupsLeavingCut } from './return-class.js';

/** A class row of a student; the dates are school dates. */
const row = (
  id: string,
  from: string,
  until: string,
  input: Partial<StoredMembership> = {},
): StoredMembership => ({
  id,
  classId: `class-${id}`,
  validFrom: from,
  validUntil: until,
  ownUntil: '2027-06-01',
  endedBy: 'leaving',
  leavingId: 'leaving',
  cause: 'placement',
  writtenByMoveId: null,
  endedByMoveId: null,
  ...input,
});

// Task 3.3b, pull request #96: "the class left" by a returning student (plan,
// step 5), the group each subject had before the leaving (decision 5 with
// correction 1) and the fields the refusals answer at (decision 11).
describe('the class a returning student left', () => {
  it('is the latest class row that ends on or before the first inactive day', () => {
    const rows = [row('a', '2026-09-02', '2026-09-20'), row('b', '2026-09-20', '2026-10-06')];
    expect(classLeft(rows, '2026-10-06', new Set())?.id).toBe('b');
    // A row that runs past the first inactive day is not left by that leaving.
    expect(classLeft([row('c', '2026-09-02', '2026-10-07')], '2026-10-06', new Set())).toBe(
      undefined,
    );
  });

  it('skips a planned row withdrawn by the leaving', () => {
    const rows = [
      row('a', '2026-09-02', '2026-10-06'),
      row('planned', '2026-11-02', '2026-11-02', { endedBy: 'withdrawn' }),
    ];
    expect(classLeft(rows, '2026-11-02', new Set())?.id).toBe('a');
  });

  it('skips a row written by a cancelled move', () => {
    const rows = [
      row('a', '2026-09-02', '2026-10-01', { endedBy: 'transfer', endedByMoveId: 'move' }),
      row('moved', '2026-10-01', '2026-10-06', { cause: 'transfer', writtenByMoveId: 'move' }),
    ];
    expect(classLeft(rows, '2026-10-06', new Set(['move']))?.id).toBe('a');
    expect(classLeft(rows, '2026-10-06', new Set())?.id).toBe('moved');
  });

  it('is none when the student held no class before the leaving', () => {
    expect(classLeft([], '2026-10-06', new Set())).toBe(undefined);
  });
});

describe('the groups the leaving cut', () => {
  const groupRow = (
    groupId: string,
    subjectId: string,
    from: string,
    until: string,
    leavingId: string | null = 'leaving',
  ) => ({
    groupId,
    subjectId,
    validFrom: from,
    validUntil: until,
    endedBy: leavingId === null ? null : 'leaving',
    leavingId,
  });

  it('names for each subject the latest group row with days that the leaving ended', () => {
    const cut = groupsLeavingCut(
      [
        groupRow('early', 'maths', '2026-09-02', '2026-09-20', 'earlier'),
        groupRow('maths-1', 'maths', '2026-09-20', '2026-10-06'),
        groupRow('english-1', 'english', '2026-09-02', '2026-10-06'),
        // Withdrawn by the leaving: holds no day.
        groupRow('planned', 'art', '2026-11-02', '2026-11-02'),
        groupRow('own', 'music', '2026-09-02', '2026-10-06', null),
      ],
      'leaving',
    );
    expect(Object.fromEntries(cut)).toEqual({ maths: 'maths-1', english: 'english-1' });
  });
});

describe('the fields of a refusal on the return and the restore', () => {
  const refusal = async (error: Error): Promise<ApiException> => {
    try {
      await atClassFields(() => Promise.reject(error));
    } catch (thrown) {
      return thrown as ApiException;
    }
    throw new Error('Not refused.');
  };

  it('answers a database refusal with no details at the class field', async () => {
    const answer = await refusal(new ApiException('class_full', 409));
    expect(answer.code).toBe('class_full');
    expect(answer.details).toEqual([
      expect.objectContaining({ path: 'classId', code: 'class_full' }),
    ]);
  });

  it('moves the paths of the placement plan to the class and the date fields', async () => {
    const full = await refusal(
      new ApiException('class_full', 409, undefined, [
        { path: 'students', code: 'class_full', message: 'Full.', freeSeats: 0 },
      ]),
    );
    expect(full.details).toEqual([
      { path: 'classId', code: 'class_full', message: 'Full.', freeSeats: 0 },
    ]);
    const inactive = await refusal(
      new ApiException('student_not_active_on', 409, undefined, [
        { path: 'students.0', code: 'student_not_active_on', message: 'Inactive.', recordId: 'x' },
      ]),
    );
    expect(inactive.details?.[0]).toMatchObject({ path: 'from', recordId: 'x' });
  });

  it('answers a date outside the year as return_outside_year at the date field', async () => {
    const answer = await refusal(
      new ApiException('membership_outside_year', 409, undefined, [
        { path: 'from', code: 'membership_outside_year', message: 'Outside.' },
      ]),
    );
    expect(answer.code).toBe('return_outside_year');
    expect(answer.details).toEqual([
      { path: 'from', code: 'return_outside_year', message: 'Outside.' },
    ]);
  });

  it('leaves every other refusal as it is', async () => {
    const changed = new ApiException('student_changed', 409);
    expect(await refusal(changed)).toBe(changed);
    const fault = new Error('fault');
    expect(await refusal(fault)).toBe(fault);
  });
});
