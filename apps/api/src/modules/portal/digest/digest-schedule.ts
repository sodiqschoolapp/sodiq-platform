import {
  DIGEST_DAYS,
  DIGEST_TIME_ZONE,
  inQuietHours,
  schoolDateOf,
  type DigestFrequency,
  type DigestSettings,
} from '@sodiq/shared';

/**
 * Task 11.5 (pull request #299): when a digest falls due and when it may be sent, from a moment of
 * the injected clock (plan decision 3), in the school's time zone (`10`, Frequency: "in the
 * school's time zone (Tashkent)"). Pure: the tick and the send pass the transaction's moment.
 */

/** The clock time `HH:MM` of a moment in a time zone. */
export function clockTimeOf(moment: Date, timeZone: string = DIGEST_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(moment);
  const part = (type: 'hour' | 'minute'): string =>
    parts.find((one) => one.type === type)?.value ?? '00';
  return `${part('hour')}:${part('minute')}`;
}

/** The moment of a clock time on a school date in a time zone. */
export function momentAt(date: string, time: string, timeZone: string = DIGEST_TIME_ZONE): Date {
  const asUtc = Date.parse(`${date}T${time}:00Z`);
  // The zone's offset at that moment; read twice so a change of offset that day is followed.
  const offsetAt = (at: number): number => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(at));
    const value = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((one) => one.type === type)?.value ?? '00';
    const local = Date.parse(
      `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}Z`,
    );
    return local - at;
  };
  const first = asUtc - offsetAt(asUtc);
  return new Date(asUtc - offsetAt(first));
}

/** The day of the week of a school date, 0 Sunday to 6 Saturday. */
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/**
 * The digest of today that has fallen due at `now`, if any: today (Tashkent) is a day of the
 * frequency and the school's digest time has passed. A day whose time passed while the worker
 * was down is still due later that day (plan decision 10); the quiet hours hold the send, not
 * the due row (review correction 3).
 */
export function dueToday(
  now: Date,
  frequency: DigestFrequency,
  settings: Pick<DigestSettings, 'sendAt'>,
): { date: string; dueAt: Date } | null {
  const date = schoolDateOf(now, DIGEST_TIME_ZONE);
  if (!DIGEST_DAYS[frequency].includes(weekdayOf(date))) return null;
  if (clockTimeOf(now) < settings.sendAt) return null;
  return { date, dueAt: momentAt(date, settings.sendAt) };
}

/** Whether nothing may be sent at `now` (`10`, Sending: "No message at night"). */
export function quietAt(
  now: Date,
  settings: Pick<DigestSettings, 'quietFrom' | 'quietUntil'>,
): boolean {
  return inQuietHours(clockTimeOf(now), settings.quietFrom, settings.quietUntil);
}

/** The most attempts at sending one digest (plan decision 14). */
export const DIGEST_ATTEMPTS = 8;

/** Minutes until the next attempt after the `attempts`-th: 1, 2, 4, 8, 16, 32, then 60. */
export function retryMinutes(attempts: number): number {
  return Math.min(2 ** Math.max(attempts - 1, 0), 60);
}

/**
 * How far before the end of the previous period the next digest reads saves again (review
 * correction 1): a save carries the moment its transaction began, so it can commit after a
 * digest read the journal with a moment before that digest's end. What was sent already is
 * left out by value.
 */
export const DIGEST_OVERLAP_MS = 10 * 60_000;
