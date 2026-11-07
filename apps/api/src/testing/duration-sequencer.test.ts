import { describe, expect, it } from 'vitest';
import { partsOf } from './duration-sequencer.js';

// The CI parts of the API tests (owner, 7 November 2026: faster CI, nothing run less).
describe('the parts of the API tests by time', () => {
  const files = Array.from({ length: 40 }, (_, n) => `src/f${String(n).padStart(2, '0')}.test.ts`);
  const durations = Object.fromEntries(files.map((file, n) => [file, n === 0 ? 400 : 10 + n]));

  it('puts every file into exactly one part, the same in every part', () => {
    const parts = partsOf(files, durations, 4, 4);
    expect([...parts.keys()].sort()).toEqual([...files].sort());
    expect(new Set(parts.values())).toEqual(new Set([0, 1, 2, 3]));
    // The same answer whatever order the files come in.
    expect(partsOf([...files].reverse(), durations, 4, 4)).toEqual(parts);
  });

  it('balances the time: no part holds much more than its share beside the slowest file', () => {
    const parts = partsOf(files, durations, 4, 4);
    const total = [0, 1, 2, 3].map((part) =>
      files
        .filter((file) => parts.get(file) === part)
        .reduce((sum, f) => sum + (durations[f] ?? 0), 0),
    );
    const all = total.reduce((a, b) => a + b, 0);
    // The part of the 400 s file takes few others; the rest share the remainder.
    expect(Math.max(...total) - Math.min(...total)).toBeLessThan(all / 4);
  });

  it('counts a file missing from the list as the median', () => {
    const parts = partsOf([...files, 'src/new.test.ts'], durations, 4, 4);
    expect(parts.has('src/new.test.ts')).toBe(true);
    // Without any list, the files are still spread over every part.
    const even = partsOf(files, {}, 4, 4);
    expect(new Set(even.values()).size).toBe(4);
    expect([0, 1, 2, 3].map((part) => [...even.values()].filter((p) => p === part).length)).toEqual(
      [10, 10, 10, 10],
    );
  });
});
