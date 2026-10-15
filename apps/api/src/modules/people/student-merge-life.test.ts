import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  digestOf,
  fateOf,
  joinedLife,
  keptOf,
  type DatedRow,
  type MergeStatusRow,
  type Side,
} from './student-merges.js';

const status = (
  id: string,
  side: Side,
  value: MergeStatusRow['status'],
  from: string,
  until: string | null = null,
): MergeStatusRow => ({ id, side, status: value, from, until });

// Task 3.3d, decision 4 of pull request #98 (Look first): the joined life of
// two records and what becomes of each dated row.
describe('the joined life', () => {
  it('cuts the inactive tail of a record created again after leaving (edge: "created again as new")', () => {
    const rows = [
      status('a', 'kept', 'active', '2023-09-01', '2025-03-01'),
      status('b', 'kept', 'inactive', '2025-03-01'),
      status('c', 'merged', 'active', '2026-09-01'),
    ];
    const life = joinedLife(rows);
    expect(life).toEqual([
      { from: '2023-09-01', until: '2025-03-01', side: 'kept', status: 'active' },
      { from: '2025-03-01', until: '2026-09-01', side: 'kept', status: 'inactive' },
      { from: '2026-09-01', until: null, side: 'merged', status: 'active' },
    ]);
    expect(rows.map((row) => fateOf(row, life, true))).toEqual([
      { action: 'carried' },
      { action: 'cut', at: '2026-09-01' },
      { action: 'carried' },
    ]);
  });

  it('cuts the graduated tail of a graduate created again', () => {
    const rows = [
      status('a', 'kept', 'active', '2020-09-01', '2026-06-01'),
      status('b', 'kept', 'graduated', '2026-06-01'),
      status('c', 'merged', 'active', '2026-09-01'),
    ];
    const life = joinedLife(rows);
    expect(fateOf(rows[1] as MergeStatusRow, life, true)).toEqual({
      action: 'cut',
      at: '2026-09-01',
    });
  });

  it('leaves behind a duplicate that started after the kept record, and keeps the kept record’s days', () => {
    const rows = [
      status('a', 'kept', 'active', '2026-09-01'),
      status('b', 'merged', 'active', '2026-09-15'),
    ];
    const life = joinedLife(rows);
    expect(life).toEqual([{ from: '2026-09-01', until: null, side: 'kept', status: 'active' }]);
    expect(fateOf(rows[1] as MergeStatusRow, life, true)).toEqual({ action: 'left' });
    const classRow: DatedRow = { id: 'r', side: 'merged', from: '2026-09-15', until: '2027-06-01' };
    expect(fateOf(classRow, life, true)).toEqual({ action: 'left' });
  });

  it('cuts a duplicate that started first at the kept record’s first day, the kept record winning on common days', () => {
    const rows = [
      status('a', 'kept', 'active', '2026-09-15'),
      status('b', 'merged', 'active', '2026-09-01'),
    ];
    const life = joinedLife(rows);
    expect(life).toEqual([
      { from: '2026-09-01', until: '2026-09-15', side: 'merged', status: 'active' },
      { from: '2026-09-15', until: null, side: 'kept', status: 'active' },
    ]);
    expect(fateOf(rows[1] as MergeStatusRow, life, true)).toEqual({
      action: 'cut',
      at: '2026-09-15',
    });
    const groupRow: DatedRow = {
      id: 'g',
      side: 'merged',
      from: '2026-09-01',
      until: '2027-06-01',
    };
    expect(fateOf(groupRow, life, true)).toEqual({ action: 'cut', at: '2026-09-15' });
    // An ended row is never cut again: it refuses.
    expect(fateOf(groupRow, life, false)).toEqual({ action: 'refused', day: '2026-09-15' });
  });

  it('refuses a row that would lose its middle, with the first lost day', () => {
    const rows = [
      status('a', 'kept', 'active', '2026-10-01', '2026-11-01'),
      status('b', 'kept', 'inactive', '2026-11-01'),
      status('c', 'merged', 'active', '2026-09-01'),
    ];
    const life = joinedLife(rows);
    expect(fateOf(rows[2] as MergeStatusRow, life, true)).toEqual({
      action: 'refused',
      day: '2026-10-01',
    });
  });

  it('refuses a kept row that would lose its start', () => {
    const rows = [
      status('a', 'kept', 'inactive', '2026-09-01'),
      status('b', 'merged', 'active', '2026-08-01'),
    ];
    const life = joinedLife(rows);
    expect(fateOf(rows[0] as MergeStatusRow, life, true)).toEqual({
      action: 'refused',
      day: '2026-09-01',
    });
  });

  it('carries a row with no day whatever the life', () => {
    const life = joinedLife([status('a', 'kept', 'active', '2026-09-01')]);
    expect(
      fateOf({ id: 'x', side: 'merged', from: '2026-10-01', until: '2026-10-01' }, life, true),
    ).toEqual({ action: 'carried' });
  });

  /** Rows of one record that follow each other with no gap, each a status. */
  const lifeOf = (side: Side) =>
    fc
      .array(
        fc.record({
          days: fc.integer({ min: 1, max: 40 }),
          status: fc.constantFrom('active', 'inactive', 'graduated' as const),
        }),
        { minLength: 1, maxLength: 4 },
      )
      .chain((parts) =>
        fc.integer({ min: 0, max: 60 }).map((start) => {
          const day = (offset: number) =>
            new Date(Date.UTC(2026, 8, 1 + offset)).toISOString().slice(0, 10);
          let at = start;
          return parts.map((part, index) => {
            const from = day(at);
            at += part.days;
            return status(
              `${side}${String(index)}`,
              side,
              part.status as MergeStatusRow['status'],
              from,
              index === parts.length - 1 ? null : day(at),
            );
          });
        }),
      );

  it('never leaves two rows on one day and keeps every carried start (property)', () => {
    fc.assert(
      fc.property(lifeOf('kept'), lifeOf('merged'), (kept, merged) => {
        const rows = [...kept, ...merged];
        const life = joinedLife(rows);
        const outcome = rows.map((row) => ({ row, fate: fateOf(row, life, true) }));
        if (outcome.some((one) => one.fate.action === 'refused')) {
          return;
        }
        const kept2 = outcome
          .filter((one) => one.fate.action !== 'left')
          .map((one) => ({
            from: one.row.from,
            until: one.fate.action === 'cut' ? one.fate.at : one.row.until,
            status: one.row.status,
          }))
          .filter((one) => one.until === null || one.from < one.until)
          .sort((a, b) => (a.from < b.from ? -1 : 1));
        for (const [index, one] of kept2.entries()) {
          const next = kept2[index + 1];
          if (next !== undefined) {
            expect(one.until !== null && one.until <= next.from).toBe(true);
          }
          // Each day kept carries the status the life gives it.
          const stretch = life.find(
            (part) => part.from <= one.from && (part.until === null || one.from < part.until),
          );
          expect(stretch?.status).toBe(one.status);
        }
      }),
    );
  });
});

describe('the kept record and the digest', () => {
  it('keeps the record whose first UID was held first, ties by id', () => {
    const early = { id: 'b', firstHeld: new Date('2024-08-20T09:00:00Z') };
    const late = { id: 'a', firstHeld: new Date('2026-08-20T09:00:00Z') };
    expect(keptOf(late, early)).toEqual([early, late]);
    const tie = { id: 'a', firstHeld: early.firstHeld };
    expect(keptOf(early, tie)).toEqual([tie, early]);
  });

  it('gives one digest for one state whatever the order of keys, another for any change', () => {
    const one = digestOf({ a: 1, b: [{ c: '2026-09-01', d: null }] });
    expect(digestOf({ b: [{ d: null, c: '2026-09-01' }], a: 1 })).toBe(one);
    expect(digestOf({ a: 1, b: [{ c: '2026-09-02', d: null }] })).not.toBe(one);
    expect(one).toMatch(/^[0-9a-f]{64}$/);
  });
});
