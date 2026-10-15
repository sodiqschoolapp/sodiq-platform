import { describe, expect, it } from 'vitest';
import { cutOf } from './scroll-row';

// Issue #105, H15: a row of tabs fades on the side that is cut off.
describe('the cut sides of a scrolling row', () => {
  it.each([
    [{ scrollLeft: 0, scrollWidth: 600, clientWidth: 600 }, null],
    [{ scrollLeft: 0, scrollWidth: 900, clientWidth: 375 }, 'end'],
    [{ scrollLeft: 200, scrollWidth: 900, clientWidth: 375 }, 'both'],
    [{ scrollLeft: 525, scrollWidth: 900, clientWidth: 375 }, 'start'],
    // A pixel of rounding at either end is not a cut.
    [{ scrollLeft: 0.5, scrollWidth: 601, clientWidth: 600 }, null],
  ] as const)('%o is cut at %s', (row, cut) => {
    expect(cutOf(row)).toBe(cut);
  });
});
