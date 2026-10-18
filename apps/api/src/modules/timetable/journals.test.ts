import { describe, expect, it } from 'vitest';
import { multirangeOf, runsOf } from './journals.js';

// Task 5.5c-1, pull request #155 (decisions 3 and 10, review correction 1):
// the runs of the chain and their text as a `datemultirange`.
describe('the runs of the published chain', () => {
  it('ends each run on the next start and leaves the last with no end', () => {
    expect(
      runsOf([
        { id: 'a', number: 1, starts_on: '2026-09-01' },
        { id: 'b', number: 2, starts_on: '2026-11-09' },
      ]),
    ).toEqual([
      { id: 'a', run: { from: '2026-09-01', until: '2026-11-09' } },
      { id: 'b', run: { from: '2026-11-09', until: null } },
    ]);
  });

  it('gives a tie on a start to the higher number, in either order', () => {
    const lower = { id: 'lower', number: 2, starts_on: '2026-11-09' };
    const higher = { id: 'higher', number: 3, starts_on: '2026-11-09' };
    for (const order of [
      [lower, higher],
      [higher, lower],
    ]) {
      expect(runsOf(order).map((one) => one.id)).toEqual(['higher']);
    }
  });

  it('writes the runs as PostgreSQL does, joining adjacent runs and keeping gaps', () => {
    expect(multirangeOf([])).toBe('{}');
    expect(
      multirangeOf([
        { from: '2027-03-30', until: null },
        { from: '2026-09-01', until: '2026-11-09' },
        { from: '2026-11-09', until: '2027-01-11' },
      ]),
    ).toBe('{[2026-09-01,2027-01-11),[2027-03-30,)}');
  });
});
