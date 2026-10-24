import { describe, expect, it } from 'vitest';
import { editWindowOf, type OpenUnlock } from './edit-window.js';

/**
 * Task 8.4: the window of a person on a lesson (`07`, Editing rules and
 * locks; `edge/journal`: "The unlock covers that lesson and that person
 * only"; `edge/00-definitions`, Lock moment).
 */
const LOCK = new Date('2026-10-27T00:00:00+05:00');

const unlock = (staffId: string, until: string): OpenUnlock => ({
  id: `unlock-${staffId}`,
  staffId,
  openUntil: new Date(until),
  decidedBy: 'approver',
});

describe('the edit window', () => {
  it('is open until the lock, at 23:59:59 of the last day, and locked from 00:00', () => {
    expect(editWindowOf(LOCK, [], 'teacher', new Date('2026-10-26T23:59:59+05:00')).kind).toBe(
      'open',
    );
    expect(editWindowOf(LOCK, [], 'teacher', LOCK).kind).toBe('locked');
  });

  it('is open with no lock (a rating exam with no date)', () => {
    expect(editWindowOf(null, [], 'teacher', LOCK).kind).toBe('open');
  });

  it("takes the person's own open unlock, never another's or an expired one", () => {
    const now = new Date('2026-10-28T10:00:00+05:00');
    const own = unlock('teacher', '2026-10-30T00:00:00+05:00');
    expect(editWindowOf(LOCK, [own], 'teacher', now)).toEqual({
      kind: 'unlocked',
      locksAt: LOCK,
      unlock: own,
    });
    expect(editWindowOf(LOCK, [own], 'colleague', now).kind).toBe('locked');
    expect(editWindowOf(LOCK, [own], null, now).kind).toBe('locked');
    expect(editWindowOf(LOCK, [own], 'teacher', new Date('2026-10-30T00:00:00+05:00')).kind).toBe(
      'locked',
    );
  });
});
