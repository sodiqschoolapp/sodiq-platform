/**
 * The release window of production (task 10.4). Owner's answer 19
 * (docs/decisions.md, Decided ahead for Phase 10): production deploys only
 * after 18:00 or at the weekend, Tashkent time; `13`, Hosting and data:
 * "Releases are made ... outside lesson hours". Decision 1 of pull request
 * #244: the night to 06:00 belongs to the evening before it, so the window is
 * Saturday and Sunday all day and every day from 18:00 to 06:00; a weekday is
 * closed from 06:00 to 17:59. A working Saturday is not read from the
 * calendar: on one, the owner deploys after 18:00 (docs/deploy.md).
 *
 * The clock is passed in (`CLAUDE.md`, Time is injected).
 */

/** Tashkent is UTC+5 all year, with no daylight saving (`edge/00-definitions`, Branch time). */
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

const OPENS_AT_HOUR = 18;
const CLOSES_AT_HOUR = 6;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function inTashkent(now: Date): { day: number; hour: number; minute: number } {
  const local = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  return { day: local.getUTCDay(), hour: local.getUTCHours(), minute: local.getUTCMinutes() };
}

/** Whether a production deploy may start at `now`. */
export function releaseWindowOpen(now: Date): boolean {
  const { day, hour } = inTashkent(now);
  const weekend = day === 0 || day === 6;
  return weekend || hour >= OPENS_AT_HOUR || hour < CLOSES_AT_HOUR;
}

/** `now` as the owner reads it in a refusal: "Monday 17:59". */
export function tashkentTime(now: Date): string {
  const { day, hour, minute } = inTashkent(now);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${WEEKDAYS[day] ?? ''} ${pad(hour)}:${pad(minute)}`;
}
