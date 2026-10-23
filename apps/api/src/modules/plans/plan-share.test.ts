import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { placeNew, separations, type SharingJournal } from './plan-share.js';

// Task 7.1c, pull request #214: shared plans (`edge/lesson-plans`, How items
// stay attached: "A shared plan is one list as long as the larger class.
// Attachment, 'not covered' and completeness are per class. An edit applies
// to every class sharing it.").

const places = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe('placeNew (decision 8)', () => {
  it('puts the item on the same row when both classes stand alike', () => {
    const page = places({ A: 1, B: 2, C: 4 });
    const placed = placeNew(page, 3, { started: 0, places: places({ A: 1, B: 2, C: 4 }) });
    expect(placed).toEqual({ position: 3, shifts: new Map() });
  });

  it('keeps the distance from the item before it where the other class stands one row later', () => {
    const page = places({ A: 1, B: 2 });
    const placed = placeNew(page, 5, { started: 0, places: places({ A: 2, B: 3 }) });
    expect(placed.position).toBe(6);
    expect(placed.shifts.size).toBe(0);
  });

  it('pushes the following items up to the first empty row when the row is taken', () => {
    const page = places({ A: 1, C: 3 });
    // The other class has A, then C right after it, and an empty row at 4.
    const placed = placeNew(page, 2, { started: 0, places: places({ A: 1, C: 2, D: 3 }) });
    expect(placed.position).toBe(2);
    expect(placed.shifts).toEqual(
      new Map([
        ['C', 3],
        ['D', 4],
      ]),
    );
  });

  it('never puts the item on a started row of the other class', () => {
    const page = places({ A: 1 });
    const placed = placeNew(page, 2, { started: 4, places: places({ A: 1, B: 5 }) });
    expect(placed.position).toBe(5);
    expect(placed.shifts).toEqual(new Map([['B', 6]]));
  });

  it('with no item before it, takes the row asked when it is free', () => {
    const placed = placeNew(places({ B: 3 }), 1, { started: 0, places: places({ B: 3 }) });
    expect(placed).toEqual({ position: 1, shifts: new Map() });
  });

  it('never puts two items on one row, never moves a started item, keeps the new item after the one before it', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 30 }), { minLength: 0, maxLength: 12 }),
        fc.uniqueArray(fc.integer({ min: 1, max: 30 }), { minLength: 0, maxLength: 12 }),
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: 0, max: 10 }),
        (pageRows, otherRows, row, started) => {
          const count = Math.min(pageRows.length, otherRows.length);
          const sortedPage = [...pageRows.slice(0, count)].sort((a, b) => a - b);
          const sortedOther = [...otherRows.slice(0, count)].sort((a, b) => a - b);
          fc.pre(!sortedPage.includes(row));
          const page = new Map(sortedPage.map((at, index) => [`I${index}`, at]));
          const other = new Map(sortedOther.map((at, index) => [`I${index}`, at]));
          const placed = placeNew(page, row, { started, places: other });
          const after = new Map(other);
          for (const [item, at] of placed.shifts) after.set(item, at);
          after.set('new', placed.position);
          const taken = [...after.values()];
          expect(new Set(taken).size).toBe(taken.length);
          expect(placed.position).toBeGreaterThan(started);
          for (const [item, at] of other) {
            if (at <= started) expect(after.get(item)).toBe(at);
          }
          for (const [item, at] of placed.shifts) expect(at).toBe((other.get(item) ?? 0) + 1);
          const before = [...page].filter(([, at]) => at < row).sort((a, b) => b[1] - a[1])[0];
          if (before !== undefined) {
            expect(placed.position).toBeGreaterThan(after.get(before[0]) ?? 0);
          }
        },
      ),
    );
  });
});

const journal = (
  journalId: string,
  order: number,
  owners: readonly (string | null)[],
  unit = 'class|7|uz',
): SharingJournal => ({ journalId, order, unit, owners });

describe('separations (decisions 6 and 17)', () => {
  it('keeps a plan together while every journal has one owner and one unit', () => {
    expect(separations([journal('J1', 0, ['T', 'T']), journal('J2', 1, ['T'])], 'T')).toEqual([]);
  });

  it('keeps it shared when every journal changed to one same person', () => {
    expect(separations([journal('J1', 0, ['N']), journal('J2', 1, ['N'])], 'T')).toEqual([]);
  });

  it('separates the journal whose teacher changed, the first by unit order too', () => {
    expect(separations([journal('J1', 0, ['N']), journal('J2', 1, ['T'])], 'T')).toEqual([
      { journalId: 'J1', cause: 'owner_changed' },
    ]);
    expect(separations([journal('J1', 0, ['T']), journal('J2', 1, ['T', 'N'])], 'T')).toEqual([
      { journalId: 'J2', cause: 'owner_changed' },
    ]);
  });

  it('counts a vacancy with nobody acting as an owner', () => {
    expect(separations([journal('J1', 0, ['T']), journal('J2', 1, [null])], 'T')).toEqual([
      { journalId: 'J2', cause: 'owner_changed' },
    ]);
  });

  it('keeps the larger group, ties to the first journal, when none kept the earlier owner', () => {
    expect(
      separations([journal('J1', 0, ['A']), journal('J2', 1, ['B']), journal('J3', 2, ['B'])], 'T'),
    ).toEqual([{ journalId: 'J1', cause: 'owner_changed' }]);
    expect(separations([journal('J1', 0, ['A']), journal('J2', 1, ['B'])], 'T')).toEqual([
      { journalId: 'J2', cause: 'owner_changed' },
    ]);
  });

  it('never separates a journal with no row left for its owner, only for its unit', () => {
    expect(separations([journal('J1', 0, ['T']), journal('J2', 1, [])], 'T')).toEqual([]);
    expect(separations([journal('J1', 0, ['T']), journal('J2', 1, [], 'class|7|ru')], 'T')).toEqual(
      [{ journalId: 'J2', cause: 'unit_changed' }],
    );
  });

  it('separates a class whose language changed, whatever its owner', () => {
    expect(
      separations(
        [journal('J1', 0, ['T']), journal('J2', 1, ['T'], 'class|7|ru'), journal('J3', 2, ['T'])],
        'T',
      ),
    ).toEqual([{ journalId: 'J2', cause: 'unit_changed' }]);
  });
});
