import { describe, expect, it } from 'vitest';
import { DAY_OFF, QUARTERS } from './data.js';
import {
  addDays,
  DEMO_EDIT_DAYS,
  isSchoolDay,
  lockedDayOf,
  planWindowOf,
  quarterIndexOf,
  schoolDayOnOrBefore,
  weekdayOf,
} from './dates.js';

/** Every day the seed accepts as today (`seed.ts`). */
function runDays(): string[] {
  const days: string[] = [];
  for (let day = '2026-09-03'; day <= '2027-05-25'; day = addDays(day, 1)) days.push(day);
  return days;
}

describe('the school days of the demo', () => {
  it('leaves out weekends, the day off and the breaks', () => {
    expect(isSchoolDay('2026-11-19')).toBe(true);
    expect(isSchoolDay('2026-11-08')).toBe(false); // Sunday
    expect(isSchoolDay(DAY_OFF.date)).toBe(false);
    expect(isSchoolDay('2026-11-04')).toBe(false); // the break after quarter 1
    expect(schoolDayOnOrBefore('2026-11-08')).toBe('2026-10-30');
    expect(schoolDayOnOrBefore('2026-09-01')).toBeNull();
  });
});

describe('the locked lesson of the demo', () => {
  it('is a run on 19 November 2026: the last school day of quarter 1', () => {
    expect(lockedDayOf('2026-11-18')).toBe('2026-10-30');
  });

  it('steps back from a Sunday and from the day off to a school day', () => {
    expect(lockedDayOf('2026-10-19')).toBe('2026-10-09');
    expect(lockedDayOf('2026-10-09')).toBe('2026-09-30');
  });

  it('is none when the year is too young for a lesson to be locked', () => {
    expect(lockedDayOf('2026-09-08')).toBeNull();
  });

  it('on every day of the run, is a school day of quarter 1 locked before yesterday afternoon', () => {
    for (const today of runDays()) {
      const yesterday = addDays(today, -1);
      const day = lockedDayOf(yesterday);
      if (day === null) {
        // Only before the first school day is locked.
        expect(addDays(QUARTERS[0].startDate, DEMO_EDIT_DAYS + 1) > yesterday).toBe(true);
        continue;
      }
      expect(isSchoolDay(day)).toBe(true);
      expect(quarterIndexOf(day)).toBe(0);
      // The lock moment, 23:59 on the date plus the edit days, is before yesterday.
      expect(addDays(day, DEMO_EDIT_DAYS) < yesterday).toBe(true);
      expect(weekdayOf(day)).toBeLessThanOrEqual(5);
    }
  });
});

describe('the plan window the demo opens', () => {
  it('is a run on 19 November 2026: quarter 2 from today for two weeks', () => {
    expect(planWindowOf('2026-11-19')).toEqual({
      quarterIndex: 1,
      startDate: '2026-11-19',
      endDate: '2026-12-03',
    });
  });

  it('is quarter 2 while quarter 1 runs, and the next quarter in a break', () => {
    expect(planWindowOf('2026-10-20')).toEqual({
      quarterIndex: 1,
      startDate: '2026-10-20',
      endDate: '2026-11-03',
    });
    expect(planWindowOf('2027-01-02')?.quarterIndex).toBe(2);
  });

  it('ends at the end of its quarter', () => {
    expect(planWindowOf('2026-12-20')).toEqual({
      quarterIndex: 1,
      startDate: '2026-12-20',
      endDate: '2026-12-26',
    });
    expect(planWindowOf('2027-05-25')).toEqual({
      quarterIndex: 3,
      startDate: '2027-05-25',
      endDate: '2027-05-25',
    });
  });

  it('on every day of the run, starts today and ends from today to the end of its quarter', () => {
    for (const today of runDays()) {
      const window = planWindowOf(today);
      expect(window).not.toBeNull();
      if (window === null) continue;
      const quarter = QUARTERS[window.quarterIndex];
      expect(quarter).toBeDefined();
      expect(window.quarterIndex).toBeGreaterThan(0);
      expect(window.startDate).toBe(today);
      expect(window.endDate >= today).toBe(true);
      expect(window.endDate <= (quarter?.endDate ?? '')).toBe(true);
    }
  });
});
