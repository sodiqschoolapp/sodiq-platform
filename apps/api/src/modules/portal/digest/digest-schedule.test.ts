import { inQuietHours } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { clockTimeOf, dueToday, momentAt, quietAt, retryMinutes } from './digest-schedule.js';

const at = (moment: string): Date => new Date(moment);
const settings = { sendAt: '19:00', quietFrom: '21:00', quietUntil: '08:00' };

// Task 11.5, pull request #299: `10`, Frequency ("daily at 19:00; twice a week, Wednesday and
// Saturday at 19:00; or once a week, Saturday at 19:00; in the school's time zone (Tashkent)")
// and Sending ("No message at night ... 21:00 to 08:00 by default").
describe('the schedule of the digest', () => {
  it('falls due daily from 19:00 Tashkent, not a minute before', () => {
    expect(dueToday(at('2026-11-02T18:59:00+05:00'), 'daily', settings)).toBeNull();
    expect(dueToday(at('2026-11-02T19:00:00+05:00'), 'daily', settings)).toEqual({
      date: '2026-11-02',
      dueAt: at('2026-11-02T19:00:00+05:00'),
    });
    // Still due later that day (a worker that was down), never the next day for this one.
    expect(dueToday(at('2026-11-02T23:59:00+05:00'), 'daily', settings)?.date).toBe('2026-11-02');
    expect(dueToday(at('2026-11-03T00:30:00+05:00'), 'daily', settings)).toBeNull();
  });

  it('falls due twice a week on Wednesday and Saturday, weekly on Saturday', () => {
    const days = {
      '2026-11-02': 'Monday',
      '2026-11-04': 'Wednesday',
      '2026-11-05': 'Thursday',
      '2026-11-07': 'Saturday',
      '2026-11-08': 'Sunday',
    };
    const due = (frequency: 'twice_weekly' | 'weekly') =>
      Object.keys(days).filter(
        (date) => dueToday(at(`${date}T19:30:00+05:00`), frequency, settings) !== null,
      );
    expect(due('twice_weekly')).toEqual(['2026-11-04', '2026-11-07']);
    expect(due('weekly')).toEqual(['2026-11-07']);
  });

  it('takes the date and time in Tashkent, not in UTC', () => {
    // 19:00 Tashkent is 14:00 UTC; 01:00 Tashkent on the 3rd is still the 2nd in UTC.
    expect(clockTimeOf(at('2026-11-02T14:00:00Z'))).toBe('19:00');
    expect(momentAt('2026-11-07', '18:00').toISOString()).toBe('2026-11-07T13:00:00.000Z');
    expect(dueToday(at('2026-11-02T20:30:00Z'), 'daily', settings)).toBeNull();
  });

  it('moves with the school setting', () => {
    expect(dueToday(at('2026-11-02T18:00:00+05:00'), 'daily', { sendAt: '18:00' })).not.toBeNull();
    expect(dueToday(at('2026-11-02T19:30:00+05:00'), 'daily', { sendAt: '20:00' })).toBeNull();
  });

  it('keeps the quiet hours across midnight, both ends exact', () => {
    expect(quietAt(at('2026-11-02T20:59:00+05:00'), settings)).toBe(false);
    expect(quietAt(at('2026-11-02T21:00:00+05:00'), settings)).toBe(true);
    expect(quietAt(at('2026-11-03T07:59:00+05:00'), settings)).toBe(true);
    expect(quietAt(at('2026-11-03T08:00:00+05:00'), settings)).toBe(false);
    // Quiet hours inside one day.
    expect(inQuietHours('13:00', '12:00', '14:00')).toBe(true);
    expect(inQuietHours('14:00', '12:00', '14:00')).toBe(false);
  });

  it('tries again after 1, 2, 4 ... minutes, at most an hour', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(retryMinutes)).toEqual([1, 2, 4, 8, 16, 32, 60, 60]);
  });
});
