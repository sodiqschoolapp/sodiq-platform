import { nextDay } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import {
  periodCovers,
  periodLastDay,
  periodOpen,
  planFlagOf,
  schoolDaysBetween,
  windowStateOf,
  type OpenPeriod,
} from './plan-window.js';

/** Task 7.2: the window, the periods and the flag (`09`, The plan window; `edge/lesson-plans`). */

const at = (iso: string) => new Date(iso);

const window = {
  startsAt: at('2026-09-01T00:00:00+05:00'),
  endsAt: at('2026-09-20T23:59:59.999+05:00'),
  quarterEndsAt: at('2026-10-31T23:59:59.999+05:00'),
  extensionEndsAt: null,
};

describe('the window of an owner', () => {
  it('is not opened without a window, before its start, open to the end of its last day, then ended', () => {
    expect(windowStateOf(null, at('2026-09-05T10:00:00+05:00')).state).toBe('not_opened');
    expect(windowStateOf(window, at('2026-08-31T23:59:59+05:00')).state).toBe('before');
    expect(windowStateOf(window, at('2026-09-01T00:00:00+05:00')).state).toBe('open');
    // `edge`: "A window ends at 23:59 of its last day, branch time. A save arriving later is refused."
    expect(windowStateOf(window, at('2026-09-20T23:59:59.999+05:00')).state).toBe('open');
    expect(windowStateOf(window, at('2026-09-21T00:03:00+05:00')).state).toBe('ended');
  });

  it('takes a later extension of the owner, never past the quarter, and ignores an earlier one', () => {
    const later = { ...window, extensionEndsAt: at('2026-09-25T23:59:59.999+05:00') };
    expect(windowStateOf(later, at('2026-09-23T10:00:00+05:00'))).toEqual({
      state: 'open',
      endsAt: at('2026-09-25T23:59:59.999+05:00'),
    });
    const earlier = { ...window, extensionEndsAt: at('2026-09-10T23:59:59.999+05:00') };
    expect(windowStateOf(earlier, at('2026-09-15T10:00:00+05:00')).state).toBe('open');
    const past = { ...window, extensionEndsAt: at('2026-11-30T23:59:59.999+05:00') };
    expect(windowStateOf(past, at('2026-11-02T10:00:00+05:00')).state).toBe('ended');
  });
});

describe('an open period', () => {
  const approved = {
    status: 'approved',
    openUntil: at('2026-10-02T23:59:59.999+05:00'),
    finishedAt: null,
  };

  it('is open until its end, unless finished or not approved', () => {
    expect(periodOpen(approved, at('2026-10-02T23:59:59.999+05:00'))).toBe(true);
    expect(periodOpen(approved, at('2026-10-03T00:00:00+05:00'))).toBe(false);
    expect(
      periodOpen(
        { ...approved, finishedAt: at('2026-10-01T09:00:00+05:00') },
        at('2026-10-01T10:00:00+05:00'),
      ),
    ).toBe(false);
    expect(periodOpen({ ...approved, status: 'sent' }, at('2026-10-01T10:00:00+05:00'))).toBe(
      false,
    );
  });

  const text: OpenPeriod = {
    requestId: 'r1',
    kind: 'text',
    fromDate: null,
    lessonIds: ['held', 'ahead'],
    approvedBy: 'a',
  };
  const replan: OpenPeriod = {
    requestId: 'r2',
    kind: 'replan',
    fromDate: '2026-10-05',
    lessonIds: [],
    approvedBy: 'a',
  };

  it('Text covers the wording of its lessons only, held ones included, and moves nothing', () => {
    const held = { lessonId: 'held', date: '2026-09-28', started: true };
    expect(periodCovers(text, held, 'wording')).toBe(true);
    expect(periodCovers(text, held, 'create')).toBe(true);
    expect(periodCovers(text, held, 'move')).toBe(false);
    expect(
      periodCovers(text, { lessonId: 'other', date: '2026-09-28', started: true }, 'wording'),
    ).toBe(false);
  });

  it('Re-plan covers the rows not started from its first lesson, and the items past the last row', () => {
    expect(
      periodCovers(replan, { lessonId: 'x', date: '2026-10-05', started: false }, 'move'),
    ).toBe(true);
    expect(
      periodCovers(replan, { lessonId: 'x', date: '2026-10-04', started: false }, 'move'),
    ).toBe(false);
    // "Lessons already held take only Text."
    expect(
      periodCovers(replan, { lessonId: 'x', date: '2026-10-06', started: true }, 'wording'),
    ).toBe(false);
    expect(periodCovers(replan, { lessonId: null, date: null, started: false }, 'move')).toBe(true);
  });

  it('an extension covers what the window covers', () => {
    const extension: OpenPeriod = { ...text, kind: 'extension', lessonIds: [] };
    expect(
      periodCovers(extension, { lessonId: 'x', date: '2026-09-01', started: true }, 'move'),
    ).toBe(true);
  });
});

describe('the days of a period', () => {
  // Saturday and Sunday off; 2026-10-07 a day off.
  const school = (date: string) => {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    return day !== 0 && day !== 6 && date !== '2026-10-07';
  };

  it('counts school days from the approval day, which counts when it is one', () => {
    // Monday 5 October, 1 day: that day.
    expect(periodLastDay('2026-10-05', 1, school, nextDay, '2027-05-31')).toBe('2026-10-05');
    // 3 days from Monday skip the day off on Wednesday.
    expect(periodLastDay('2026-10-05', 3, school, nextDay, '2027-05-31')).toBe('2026-10-08');
    // Approved on Saturday: the count starts on Monday.
    expect(periodLastDay('2026-10-03', 1, school, nextDay, '2027-05-31')).toBe('2026-10-05');
    // 10 days cross a weekend and the day off.
    expect(periodLastDay('2026-10-05', 10, school, nextDay, '2027-05-31')).toBe('2026-10-19');
  });

  it('ends at the last school day of the year when fewer are left', () => {
    expect(periodLastDay('2027-05-27', 10, school, nextDay, '2027-05-31')).toBe('2027-05-31');
  });

  it('counts the school days a request has waited after the day it was sent', () => {
    expect(schoolDaysBetween('2026-10-02', '2026-10-05', school, nextDay)).toBe(1);
    expect(schoolDaysBetween('2026-10-05', '2026-10-08', school, nextDay)).toBe(2);
  });
});

describe('the flag of a plan', () => {
  const base = {
    rows: 10,
    complete: false,
    ownerId: 's',
    window: 'ended' as const,
    ownerPeriod: false,
  };

  it("is overdue only when incomplete after the window with no new owner's period running", () => {
    expect(planFlagOf(base)).toBe('overdue');
    expect(planFlagOf({ ...base, complete: true })).toBeNull();
    expect(planFlagOf({ ...base, ownerPeriod: true })).toBeNull();
    expect(planFlagOf({ ...base, window: 'open' })).toBeNull();
  });

  it('shows "window not opened" before any window, and "vacancy" with nobody to own it', () => {
    expect(planFlagOf({ ...base, window: 'not_opened' })).toBe('window_not_opened');
    expect(planFlagOf({ ...base, ownerId: null })).toBe('vacancy');
    expect(planFlagOf({ ...base, rows: 0 })).toBeNull();
  });
});
