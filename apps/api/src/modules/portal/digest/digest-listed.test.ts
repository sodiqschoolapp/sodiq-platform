import { describe, expect, it } from 'vitest';
import { listedState } from './digest.service.js';

type Sent = NonNullable<Parameters<typeof listedState>[0]>;
type Entry = Parameters<typeof listedState>[1];

const SENT: Sent = {
  kind: 'score',
  sourceId: '019a0000-0000-7000-8000-000000011251',
  removed: false,
  mark: null,
  score: 7.5,
  total: 10,
  version: 2,
  date: '2026-11-17',
  subjectId: null,
  subject: null,
};

const entry = (score: number, total: number, version = 2): Entry => ({
  kind: 'score',
  sourceId: SENT.sourceId,
  branchId: '019a0000-0000-7000-8000-000000011252',
  date: '2026-11-17',
  subjectId: null,
  subject: null,
  savedInPeriod: false,
  value: { mark: null, score, total, version },
});

// Task 11.25b (`10`, The parents' digest: an entry sent before is listed again only when its value
// differs, "corrected"): a score and a total read back as `numeric` after 0189 compare with what
// was sent as the same numbers, so an unchanged 7.5 (or a whole 8 sent before the switch as an
// integer) is never sent again as "corrected"; a changed one is.
describe('the digest compares a score with decimals with what it sent', () => {
  it('lists nothing for an unchanged 7.5 out of 10, and "corrected" for 7.25', () => {
    expect(listedState(SENT, entry(7.5, 10))).toBeNull();
    expect(listedState(SENT, entry(7.25, 10, 3))).toBe('corrected');
  });

  it('lists nothing for a whole number sent before the switch and read the same after it', () => {
    const whole: Sent = { ...SENT, score: 8, total: 10 };
    expect(listedState(whole, entry(8, 10))).toBeNull();
  });

  it('lists "corrected" for a total changed from 10 to 7.5 with the same number', () => {
    expect(listedState(SENT, entry(7.5, 7.5, 2))).toBe('corrected');
  });
});
