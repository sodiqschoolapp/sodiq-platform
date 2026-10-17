import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkCandidates, checkTimetable } from './check.js';
import { patternModel } from './facts-data.js';
import {
  blockPlacements,
  patternPlacements,
  type BlockLesson,
  type PatternBlock,
} from './pattern-place.js';
import type { Placement } from './placement.js';
import { patternData, ROWS } from './testing/pattern-fixture.js';

// Task 5.4a: the lessons of a block at a weekday and a slot position, for the
// grid, the routes and the pins (one slot-to-time rule), and the generated
// test of 14, Timetable: "Thousands of random timetables and random edits are
// generated automatically; after each, the tests check that no teacher, room,
// class or student is in two places" (review correction 1).

const model = patternModel(patternData());

const lessonsOf = (blockId: string, rowIds: readonly string[]): BlockLesson[] =>
  rowIds.map((loadRowId) => ({
    id: `${blockId}:${loadRowId}`,
    loadRowId,
    roomId: model.roomOfNew(model.rowOf(loadRowId)),
  }));

describe('blockPlacements', () => {
  it('reads the minutes of the slot from the template of the rows', () => {
    const placed = blockPlacements(model, { id: 'b', lessons: lessonsOf('b', ['math-7a']) }, 1, 3);
    expect(placed).toEqual([
      expect.objectContaining({ day: '1', start: 530, end: 575, blockId: 'b', roomId: 'r7a' }),
    ]);
    const junior = blockPlacements(model, { id: 'j', lessons: lessonsOf('j', ['math-2a']) }, 1, 3);
    expect(junior).toEqual([expect.objectContaining({ start: 525, end: 565 })]);
  });

  it('puts every lesson of a block in one slot', () => {
    const placed = blockPlacements(
      model,
      { id: 'eng', lessons: lessonsOf('eng', ['eng-e1', 'eng-e2']) },
      2,
      5,
    );
    expect(placed?.map((one) => [one.loadRowId, one.start, one.end])).toEqual([
      ['eng-e1', 595, 640],
      ['eng-e2', 595, 640],
    ]);
  });

  it('gives nothing for a position past the day or a day with no lessons', () => {
    const block = { id: 'b', lessons: lessonsOf('b', ['math-7a']) };
    expect(blockPlacements(model, block, 1, 7)).toBeNull();
    expect(blockPlacements(model, block, 6, 1)).toBeNull();
  });

  it('places a break and lets the engine name it', () => {
    const placed = blockPlacements(model, { id: 'b', lessons: lessonsOf('b', ['math-7a']) }, 1, 2);
    expect(placed).not.toBeNull();
    const results = checkTimetable(placed ?? [], model.facts);
    expect(results.map((one) => one.rule)).toContain('break_slot');
  });
});

describe('checkCandidates', () => {
  it('names the results of every lesson of the moved blocks, and not an old clash elsewhere', () => {
    const blocks: PatternBlock[] = [
      stored('a', ['math-7a'], 1, 1),
      stored('b', ['math-7b'], 1, 3),
      // An old clash of the laboratory that the move does not touch.
      stored('c', ['sci-7a'], 2, 1),
      stored('d', ['sci-7b'], 2, 1),
    ];
    const placements = patternPlacements(model, blocks);
    const moved = blockPlacements(model, { id: 'b', lessons: lessonsOf('b', ['math-7b']) }, 1, 1);
    const results = checkCandidates(placements, model.facts, moved ?? []);
    expect(results.filter((one) => one.severity === 'blocked').map((one) => one.rule)).toEqual([
      'teacher_double',
    ]);
    expect(results.some((one) => one.rule === 'room_double')).toBe(false);
  });
});

function stored(
  id: string,
  rowIds: readonly string[],
  weekday: number,
  slotPosition: number,
): PatternBlock {
  const lessons = lessonsOf(id, rowIds);
  const placed = blockPlacements(model, { id, lessons }, weekday, slotPosition);
  const first = placed?.[0];
  if (first === undefined) throw new Error(`no slot ${weekday}:${slotPosition}`);
  return {
    id,
    weekday,
    slotPosition,
    start: first.start,
    end: first.end,
    lessons,
    doublePairId: null,
  };
}

// The blocks of the fixture: each class row alone, the English split whole.
const BLOCK_ROWS: readonly (readonly string[])[] = [
  ...ROWS.filter((one) => one.groupId === null).map((one) => [one.id]),
  ['eng-e1', 'eng-e2'],
];

const CLASH_RULES = new Set(['teacher_double', 'room_double', 'class_double', 'student_double']);

type Edit =
  | { kind: 'place'; rows: number; weekday: number; slot: number }
  | { kind: 'move'; block: number; weekday: number; slot: number }
  | { kind: 'swap'; a: number; b: number };

const editArbitrary: fc.Arbitrary<Edit> = fc.oneof(
  fc.record({
    kind: fc.constant('place' as const),
    rows: fc.nat({ max: BLOCK_ROWS.length - 1 }),
    weekday: fc.integer({ min: 1, max: 3 }),
    slot: fc.integer({ min: 1, max: 6 }),
  }),
  fc.record({
    kind: fc.constant('move' as const),
    block: fc.nat({ max: 20 }),
    weekday: fc.integer({ min: 1, max: 3 }),
    slot: fc.integer({ min: 1, max: 6 }),
  }),
  fc.record({ kind: fc.constant('swap' as const), a: fc.nat({ max: 20 }), b: fc.nat({ max: 20 }) }),
);

/** The edit as the routes make it: the changed blocks, or `null` when it has no slot. */
function apply(blocks: readonly PatternBlock[], edit: Edit, serial: number): PatternBlock[] | null {
  const at = (
    block: { id: string; lessons: readonly BlockLesson[] },
    weekday: number,
    slot: number,
  ): PatternBlock | null => {
    const placed = blockPlacements(model, block, weekday, slot);
    const first = placed?.[0];
    return first === undefined
      ? null
      : {
          ...block,
          weekday,
          slotPosition: slot,
          start: first.start,
          end: first.end,
          doublePairId: null,
        };
  };
  if (edit.kind === 'place') {
    const id = `n${serial}`;
    const made = at(
      { id, lessons: lessonsOf(id, BLOCK_ROWS[edit.rows] ?? []) },
      edit.weekday,
      edit.slot,
    );
    return made === null ? null : [made];
  }
  if (edit.kind === 'move') {
    const block = blocks[edit.block % Math.max(blocks.length, 1)];
    if (block === undefined) return null;
    const made = at(block, edit.weekday, edit.slot);
    return made === null ? null : [made];
  }
  const a = blocks[edit.a % Math.max(blocks.length, 1)];
  const b = blocks[edit.b % Math.max(blocks.length, 1)];
  if (a === undefined || b === undefined || a.id === b.id) return null;
  const movedA = at(a, b.weekday, b.slotPosition);
  const movedB = at(b, a.weekday, a.slotPosition);
  return movedA === null || movedB === null ? null : [movedA, movedB];
}

describe('random edits of a pattern', () => {
  it('never leave a teacher, room, class or student in two places', () => {
    fc.assert(
      fc.property(fc.array(editArbitrary, { minLength: 1, maxLength: 30 }), (edits) => {
        let blocks: PatternBlock[] = [];
        edits.forEach((edit, serial) => {
          const changed = apply(blocks, edit, serial);
          if (changed === null) return;
          const candidates: Placement[] = patternPlacements(model, changed);
          const refused = checkCandidates(
            patternPlacements(model, blocks),
            model.facts,
            candidates,
          ).some((one) => one.severity === 'blocked');
          if (refused) return;
          const ids = new Set(changed.map((one) => one.id));
          blocks = [...blocks.filter((one) => !ids.has(one.id)), ...changed];
          const clashes = checkTimetable(patternPlacements(model, blocks), model.facts).filter(
            (one) => CLASH_RULES.has(one.rule),
          );
          expect(clashes).toEqual([]);
        });
      }),
      { numRuns: 200 },
    );
  });
});
