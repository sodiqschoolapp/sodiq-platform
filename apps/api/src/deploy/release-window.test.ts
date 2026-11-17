import { describe, expect, it } from 'vitest';
import { releaseWindowOpen, tashkentTime, windowDecision } from './release-window.js';

// Owner's answer 19 (docs/decisions.md, Decided ahead for Phase 10): production
// deploys only after 18:00 or at the weekend, Tashkent time; decision 1 of pull
// request #244: the night to 06:00 belongs to the evening before it. Tashkent
// is UTC+5 all year (`edge/00-definitions`, Branch time). 26 October 2026 is a
// Monday; each instant is written in Tashkent time.
const at = (tashkent: string) => new Date(`${tashkent}+05:00`);

describe('the release window of production', () => {
  it.each([
    ['2026-10-26T05:59:59', 'Monday 05:59, Sunday night', true],
    ['2026-10-26T06:00:00', 'Monday 06:00', false],
    ['2026-10-26T17:59:59', 'Monday 17:59', false],
    ['2026-10-26T18:00:00', 'Monday 18:00', true],
    ['2026-10-27T05:59:00', 'Tuesday 05:59', true],
    ['2026-10-27T06:00:00', 'Tuesday 06:00', false],
    ['2026-10-28T12:00:00', 'Wednesday 12:00', false],
    ['2026-10-30T18:00:00', 'Friday 18:00', true],
    ['2026-10-31T00:00:00', 'Saturday 00:00', true],
    ['2026-10-31T03:00:00', 'Saturday 03:00', true],
    ['2026-10-31T09:00:00', 'Saturday 09:00', true],
    ['2026-11-01T23:59:59', 'Sunday 23:59', true],
  ])('%s (%s): open %s', (instant, _name, open) => {
    expect(releaseWindowOpen(at(instant))).toBe(open);
  });

  it("reads the instant in Tashkent time, not in the runner's zone", () => {
    // 13:00 UTC on a Monday is 18:00 in Tashkent.
    expect(releaseWindowOpen(new Date('2026-10-26T13:00:00Z'))).toBe(true);
    expect(releaseWindowOpen(new Date('2026-10-26T12:59:59Z'))).toBe(false);
    expect(tashkentTime(new Date('2026-10-26T12:59:59Z'))).toBe('Monday 17:59');
  });
});

// The owner's emergency override (17 November 2026): ticked with a reason of at
// least 10 characters, it lifts the window alone.
describe('the emergency override of the release window', () => {
  const closed = at('2026-10-26T15:24:00'); // Monday 15:24
  const open = at('2026-10-26T18:30:00'); // Monday 18:30
  const reason = 'Fix for the journal before tomorrow';

  it('refuses outside the window without the override, and says how to use it', () => {
    const decision = windowDecision(closed, { outside: false, reason });
    expect(decision.allowed).toBe(false);
    expect(decision.message).toContain('Monday 15:24');
    expect(decision.message).toContain('Deploy outside the release window');
  });

  it.each(['', '   ', 'urgent', ' a  b  c  d '])(
    'refuses the override with a reason too short: %j',
    (short) => {
      const decision = windowDecision(closed, { outside: true, reason: short });
      expect(decision.allowed).toBe(false);
      expect(decision.message).toContain('fewer than 10 characters');
    },
  );

  it('allows the override with a reason, and names the time and the reason', () => {
    const decision = windowDecision(closed, { outside: true, reason: `  ${reason}\n` });
    expect(decision).toEqual({
      allowed: true,
      override: true,
      message: `Deploying outside the release window at Monday 15:24 in Tashkent, by the owner's override. Reason: ${reason}`,
    });
  });

  it('inside the window, the override changes nothing', () => {
    for (const outside of [false, true]) {
      expect(windowDecision(open, { outside, reason: '' })).toEqual({
        allowed: true,
        override: false,
        message: 'Release window open: Monday 18:30 in Tashkent.',
      });
    }
  });
});
