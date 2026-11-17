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

/**
 * The owner's emergency override of the release window (owner, 17 November
 * 2026): a deploy run may go outside the window only when the owner ticks
 * "outside the window" and types why. The override lifts the window alone:
 * the approval of the environment `production`, the release check, the
 * migrations and the smoke test still run. The reason is written to the run's
 * log, so it holds no person's name or data.
 */
export const OVERRIDE_REASON_MIN = 10;

export type WindowDecision =
  | { readonly allowed: true; readonly override: boolean; readonly message: string }
  | { readonly allowed: false; readonly message: string };

/** Whether a deploy may start at `now`, with or without the owner's override. */
export function windowDecision(
  now: Date,
  override: { readonly outside: boolean; readonly reason: string },
): WindowDecision {
  const time = tashkentTime(now);
  if (releaseWindowOpen(now)) {
    return { allowed: true, override: false, message: `Release window open: ${time} in Tashkent.` };
  }
  const closed = `It is ${time} in Tashkent: production is deployed only from 18:00 to 06:00 and at the weekend (docs/deploy.md, Production).`;
  if (!override.outside) {
    return {
      allowed: false,
      message: `${closed} To deploy now anyway, run again with "Deploy outside the release window" ticked and a reason.`,
    };
  }
  const reason = override.reason.replace(/\s+/g, ' ').trim();
  if (reason.length < OVERRIDE_REASON_MIN) {
    return {
      allowed: false,
      message: `${closed} "Deploy outside the release window" is ticked, but the reason has fewer than ${String(OVERRIDE_REASON_MIN)} characters. Run again with a reason.`,
    };
  }
  return {
    allowed: true,
    override: true,
    message: `Deploying outside the release window at ${time} in Tashkent, by the owner's override. Reason: ${reason}`,
  };
}
