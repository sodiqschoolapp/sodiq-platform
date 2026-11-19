import { DAY_OFF, QUARTERS } from './data.js';

/**
 * The dates the demo seed picks from the day it runs (`DEMO_TODAY`, or today in
 * Tashkent). Kept apart from the seed so that a run on any day of the year is
 * tested: a run on 19 November 2026 opened no plan window (its end, 7 November,
 * was already past) and left no locked lesson (the day ten days back was a
 * Sunday).
 */

/** The edit days of the branch: the setting's default, which the demo keeps. */
export const DEMO_EDIT_DAYS = 7;

/** How long the plan window the seed opens stays open, in days from the run's day. */
export const DEMO_WINDOW_DAYS = 14;

export function addDays(date: string, days: number): string {
  const moment = new Date(`${date}T12:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + days);
  return moment.toISOString().slice(0, 10);
}

/** 1 is Monday, 7 is Sunday. */
export function weekdayOf(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The index of the quarter that holds the date, or -1 in a break. */
export function quarterIndexOf(date: string): number {
  return QUARTERS.findIndex((one) => one.startDate <= date && date <= one.endDate);
}

/** A weekday inside a quarter that is not the day off: the timetable has lessons on it. */
export function isSchoolDay(date: string): boolean {
  return weekdayOf(date) <= 5 && date !== DAY_OFF.date && quarterIndexOf(date) !== -1;
}

/** The last school day on or before the date, or null before the first one. */
export function schoolDayOnOrBefore(date: string): string | null {
  for (let day = date; day >= QUARTERS[0].startDate; day = addDays(day, -1)) {
    if (isSchoolDay(day)) return day;
  }
  return null;
}

/**
 * The day whose lesson is left without its numbers, locked by the run's
 * afternoon so that its teacher can ask to unlock it: a school day of the first
 * quarter (the only one the seed plans, so its lessons have works) whose lock
 * moment, 23:59 on the date plus the edit days, is before yesterday's
 * afternoon. Null when the year is too young for one.
 */
export function lockedDayOf(yesterday: string): string | null {
  const latest = addDays(yesterday, -(DEMO_EDIT_DAYS + 1));
  const day = schoolDayOnOrBefore(latest < QUARTERS[0].endDate ? latest : QUARTERS[0].endDate);
  return day !== null && quarterIndexOf(day) === 0 ? day : null;
}

/**
 * The plan window the seed opens, so that plans can be tried on the day of the
 * run: the window of the quarter that holds today or, in a break or in the
 * first quarter (whose window was used before the year), the next one; from
 * today for two weeks, never past the quarter's end. Null after the last quarter.
 */
export function planWindowOf(
  today: string,
): { quarterIndex: number; startDate: string; endDate: string } | null {
  const quarterIndex = QUARTERS.findIndex((one, index) => index > 0 && one.endDate >= today);
  if (quarterIndex === -1) return null;
  const quarterEnd = QUARTERS[quarterIndex]?.endDate ?? today;
  const end = addDays(today, DEMO_WINDOW_DAYS);
  return { quarterIndex, startDate: today, endDate: end < quarterEnd ? end : quarterEnd };
}
