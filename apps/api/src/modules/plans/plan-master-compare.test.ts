import type { PlanMasterContent } from '@sodiq/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  compareMaster,
  masterUpdated,
  takePlaces,
  type MasterItemFacts,
  type PlanItemFacts,
} from './plan-master-compare.js';

// Task 7.3, pull request #216, decisions 5 and 6: the "master updated"
// comparison and the take (`09`, Master plans; `edge/lesson-plans`, "Items are
// matched by identity, not by position").

const content = (topic: string): PlanMasterContent => ({
  topic,
  objectives: '',
  links: [],
  classworks: [],
  homeworks: [],
});

const master = (
  id: string,
  position: number,
  topic: string,
  revisions: { added?: number; changed?: number; removed?: number | null } = {},
): MasterItemFacts => ({
  id,
  position,
  added: revisions.added ?? 1,
  changed: revisions.changed ?? revisions.added ?? 1,
  removed: revisions.removed ?? null,
  content: content(topic),
});

const plan = (masterItemId: string, topic: string, held = false): PlanItemFacts => ({
  itemId: `P-${masterItemId}`,
  masterItemId,
  content: content(topic),
  held,
});

describe('compareMaster', () => {
  it('shows nothing when nothing changed since the copy', () => {
    const rows = compareMaster([master('A', 1, 'Fractions'), master('B', 2, 'Decimals')], 1, [
      plan('A', 'Fractions'),
      plan('B', 'Decimals'),
    ]);
    expect(rows).toEqual([]);
    expect(masterUpdated(rows)).toBe(false);
  });

  it('matches items by identity, not by position', () => {
    // B moved before A and A's text changed: one changed row for A, none for the move.
    const rows = compareMaster(
      [master('B', 1, 'Decimals'), master('A', 2, 'Fractions, part 1', { changed: 3 })],
      2,
      [plan('A', 'Fractions'), plan('B', 'Decimals')],
    );
    expect(rows).toEqual([
      {
        change: 'changed',
        masterItemId: 'A',
        master: content('Fractions, part 1'),
        plan: { ...content('Fractions'), itemId: 'P-A' },
        held: false,
      },
    ]);
  });

  it('shows an item added since, and one removed since that the plan still holds', () => {
    const rows = compareMaster(
      [
        master('A', 1, 'Fractions'),
        master('C', 2, 'Percent', { added: 4 }),
        master('B', 3, 'Decimals', { removed: 4 }),
      ],
      2,
      [plan('A', 'Fractions'), plan('B', 'Decimals')],
    );
    expect(rows.map((row) => [row.change, row.masterItemId])).toEqual([
      ['added', 'C'],
      ['removed', 'B'],
    ]);
  });

  it('shows nothing for a change saved back to the text the plan has (review must-fix 4)', () => {
    const rows = compareMaster([master('A', 1, 'Fractions', { changed: 5 })], 2, [
      plan('A', 'Fractions'),
    ]);
    expect(rows).toEqual([]);
  });

  it('shows nothing for a change older than the revision taken or kept', () => {
    const rows = compareMaster([master('A', 1, 'Fractions, new', { changed: 3 })], 3, [
      plan('A', 'Fractions'),
    ]);
    expect(rows).toEqual([]);
  });

  it('shows a row of a held lesson, and the plan is updated only when another row can be taken', () => {
    const held = compareMaster([master('A', 1, 'Fractions, new', { changed: 3 })], 1, [
      plan('A', 'Fractions', true),
    ]);
    expect(held.map((row) => row.held)).toEqual([true]);
    expect(masterUpdated(held)).toBe(false);
    const both = compareMaster(
      [master('A', 1, 'Fractions, new', { changed: 3 }), master('C', 2, 'Percent', { added: 3 })],
      1,
      [plan('A', 'Fractions', true)],
    );
    expect(masterUpdated(both)).toBe(true);
  });

  it('shows no removed row for an item the plan no longer holds (cleared or never copied)', () => {
    const rows = compareMaster([master('B', 1, 'Decimals', { removed: 4 })], 2, []);
    expect(rows).toEqual([]);
  });

  it('never lists a change that leaves the content as the plan has it (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom('x', 'y', 'z'), fc.constantFrom('x', 'y', 'z')), {
          maxLength: 6,
        }),
        fc.integer({ min: 0, max: 5 }),
        (pairs, since) => {
          const items = pairs.map(([now], index) =>
            master(`M${index}`, index + 1, now, { added: 0, changed: 9 }),
          );
          const own = pairs.map(([, copied], index) => plan(`M${index}`, copied));
          const rows = compareMaster(items, since, own);
          const differing = pairs.filter(([now, copied]) => now !== copied).length;
          expect(rows.length).toBe(differing);
          expect(rows.every((row) => row.change === 'changed')).toBe(true);
        },
      ),
    );
  });
});

describe('takePlaces', () => {
  const journal = (started: number, ...items: [string, number][]) => ({
    started,
    places: new Map(items),
  });

  it('takes a removed item out of the queue and closes it up; started rows stay', () => {
    const places = takePlaces(journal(1, ['P1', 1], ['P2', 2], ['P3', 3], ['P4', 4]), ['P2'], []);
    expect([...places]).toEqual([
      ['P1', 1],
      ['P3', 2],
      ['P4', 3],
    ]);
  });

  it('puts an added item right after the item of the master item before it; the rest move up to the first empty row', () => {
    const places = takePlaces(
      journal(0, ['P1', 1], ['P2', 2], ['P3', 3], ['P5', 5]),
      [],
      [{ itemId: 'N', after: 'P1' }],
    );
    expect(Object.fromEntries(places)).toEqual({ P1: 1, N: 2, P2: 3, P3: 4, P5: 5 });
  });

  it('puts an added item at the first row not started when the item before it is on a started row', () => {
    const places = takePlaces(
      journal(2, ['P1', 1], ['P2', 2], ['P3', 3]),
      [],
      [{ itemId: 'N', after: 'P1' }],
    );
    expect(Object.fromEntries(places)).toEqual({ P1: 1, P2: 2, N: 3, P3: 4 });
  });

  it('lays two journals of a shared plan each from its own place (review should-fix 8)', () => {
    const added = [{ itemId: 'N', after: 'P2' }];
    // Journal 1 stands at row 1, journal 2 has already held P2.
    expect(
      Object.fromEntries(takePlaces(journal(1, ['P1', 1], ['P2', 2], ['P3', 3]), [], added)),
    ).toEqual({ P1: 1, P2: 2, N: 3, P3: 4 });
    expect(
      Object.fromEntries(takePlaces(journal(2, ['P1', 1], ['P2', 2], ['P3', 3]), [], added)),
    ).toEqual({ P1: 1, P2: 2, N: 3, P3: 4 });
    expect(
      Object.fromEntries(takePlaces(journal(3, ['P1', 1], ['P2', 2], ['P3', 3]), [], added)),
    ).toEqual({ P1: 1, P2: 2, P3: 3, N: 4 });
  });

  it('moves no started row and gives every item one row (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { maxLength: 8 }),
        fc.integer({ min: 0, max: 12 }),
        fc.array(fc.boolean(), { maxLength: 8 }),
        fc.integer({ min: 0, max: 3 }),
        (positions, started, removeFlags, adds) => {
          const items = positions.map(
            (position, index) => [`P${index}`, position] as [string, number],
          );
          const removed = items
            .filter(([, position], index) => position > started && removeFlags[index] === true)
            .map(([id]) => id);
          const added = Array.from({ length: adds }, (_, index) => ({
            itemId: `N${index}`,
            after: index === 0 ? (items[0]?.[0] ?? null) : `N${index - 1}`,
          }));
          const places = takePlaces({ started, places: new Map(items) }, removed, added);
          for (const [id, position] of items) {
            if (position <= started) expect(places.get(id)).toBe(position);
            if (removed.includes(id)) expect(places.has(id)).toBe(false);
          }
          const used = [...places.values()];
          expect(new Set(used).size).toBe(used.length);
          for (const [id, position] of places) {
            if (!items.some(([item, at]) => item === id && at <= started)) {
              expect(position).toBeGreaterThan(started);
            }
          }
          expect(places.size).toBe(items.length - removed.length + adds);
        },
      ),
    );
  });
});
