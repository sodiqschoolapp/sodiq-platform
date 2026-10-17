// Double lessons in the weekly pattern (task 5.4c-3a): edge/timetable,
// Structure: "Two linked lessons in consecutive lesson slots with the same
// teacher and room. They are moved, cancelled and substituted together."
import { describe, expect, it } from 'vitest';
import { checkTimetable } from './check.js';
import { patternModel } from './facts-data.js';
import {
  blockPlacements,
  checkedPlacements,
  newPairOf,
  NEW_BLOCK_ID,
  NEW_SECOND_HALF_ID,
  pairAt,
  type PatternBlock,
} from './pattern-place.js';
import { roomChange, roomLessons } from './rooms-pick.js';
import { suggestPlaces } from './suggest.js';
import { patternData, ROWS } from './testing/pattern-fixture.js';

// The English split of 7a and the mathematics of 7a allow double lessons.
const DOUBLES = new Set(['eng-e1', 'eng-e2', 'math-7a']);
const model = patternModel(
  patternData(ROWS.map((one) => ({ ...one, doubleLessons: DOUBLES.has(one.id) }))),
);

/** A stored block of rows at a weekday and slot position, in a pair or not. */
function block(
  id: string,
  rowIds: readonly string[],
  weekday: number,
  slotPosition: number,
  doublePairId: string | null = null,
  rooms: Record<string, string> = {},
): PatternBlock {
  const lessons = rowIds.map((loadRowId) => ({
    id: `${id}:${loadRowId}`,
    loadRowId,
    roomId: rooms[loadRowId] ?? model.roomOfNew(model.rowOf(loadRowId)),
  }));
  const [first] = blockPlacements(model, { id, lessons }, weekday, slotPosition) ?? [];
  if (first === undefined) throw new Error('No such slot in the fixture.');
  return { id, weekday, slotPosition, start: first.start, end: first.end, lessons, doublePairId };
}

const ENGLISH = ['eng-e1', 'eng-e2'];
const rules = (blocks: readonly PatternBlock[], m = model) =>
  checkTimetable(checkedPlacements(m, blocks), m.facts).map((one) => one.rule);

describe('newPairOf', () => {
  it('gives the two halves ids of their own, block and lessons alike', () => {
    const [first, second] = newPairOf(model, 'eng-e1');
    expect([first.id, second.id]).toEqual([NEW_BLOCK_ID, NEW_SECOND_HALF_ID]);
    expect(first.doublePairId).toBe(second.doublePairId);
    const ids = [...first.lessons, ...second.lessons].map((one) => one.id);
    expect(new Set(ids).size).toBe(4);
    expect(second.lessons.map((one) => one.loadRowId)).toEqual(ENGLISH);
  });
});

describe('pairAt', () => {
  const pair: [PatternBlock, PatternBlock] = [
    block('a', ['math-7a'], 1, 1, 'dp'),
    block('b', ['math-7a'], 1, 3, 'dp'),
  ];
  const slots = (found: readonly PatternBlock[] | null) =>
    found?.map((one) => [one.id, one.weekday, one.slotPosition, one.start, one.end]);

  it('puts the other half in the next lesson slot, over a break', () => {
    expect(slots(pairAt(model, pair, 'a', 2, 1))).toEqual([
      ['a', 2, 1, 480, 525],
      ['b', 2, 3, 530, 575],
    ]);
  });

  it('puts the other half in the slot before when the second half is moved', () => {
    expect(slots(pairAt(model, pair, 'b', 3, 5))).toEqual([
      ['a', 3, 3, 530, 575],
      ['b', 3, 5, 595, 640],
    ]);
  });

  it('has no place at the last lesson slot, the first one, a break or a day off', () => {
    expect(pairAt(model, pair, 'a', 1, 6)).toBeNull();
    expect(pairAt(model, pair, 'b', 1, 1)).toBeNull();
    expect(pairAt(model, pair, 'a', 1, 2)).toBeNull();
    expect(pairAt(model, pair, 'a', 6, 1)).toBeNull();
  });
});

describe('the check of a placed double', () => {
  it('accepts a double of the English split and counts it once a day', () => {
    const blocks = [block('a', ENGLISH, 1, 1, 'dp'), block('b', ENGLISH, 1, 3, 'dp')];
    expect(rules(blocks).filter((one) => one !== 'load_mismatch')).toEqual([]);
  });

  it('refuses a double of a row that does not allow double lessons', () => {
    const blocks = [block('a', ['math-7b'], 1, 1, 'dp'), block('b', ['math-7b'], 1, 3, 'dp')];
    expect(rules(blocks)).toContain('double_not_allowed');
  });

  it('refuses a half moved alone to a slot not beside the other', () => {
    const blocks = [block('a', ENGLISH, 1, 1, 'dp'), block('b', ENGLISH, 1, 5, 'dp')];
    expect(rules(blocks)).toContain('double_apart');
  });
});

describe('a room change of a lesson of a double', () => {
  const first = block('a', ['math-7a'], 1, 1, 'dp');
  const second = block('b', ['math-7a'], 1, 3, 'dp');

  it('changes the lesson of the same row in both halves', () => {
    expect(
      roomLessons([first, second], first, 'a:math-7a').map((one) => [one.block.id, one.lessonId]),
    ).toEqual([
      ['a', 'a:math-7a'],
      ['b', 'b:math-7a'],
    ]);
    const change = roomChange(model, [first, second], first, 'a:math-7a', 'r7b');
    expect(change.accepted).toBe(true);
  });

  it('refuses a room busy in the slot of the other half only', () => {
    const busy = block('c', ['math-7b'], 1, 3, null, { 'math-7b': 'r7b' });
    // The teacher of 7b is t1 too: give 7b's lesson its own teacher by row data.
    const other = patternModel(
      patternData(
        ROWS.map((one) => ({
          ...one,
          doubleLessons: DOUBLES.has(one.id),
          teacherId: one.id === 'math-7b' ? 't5' : one.teacherId,
        })),
      ),
    );
    const change = roomChange(other, [first, second, busy], first, 'a:math-7a', 'r7b');
    expect(change.accepted).toBe(false);
    expect(change.blocked.map((one) => one.rule)).toEqual(['room_double']);
  });
});

describe('suggestions and doubles', () => {
  it('offers a selected double free slots as a pair, and no rearrangement', () => {
    const first = block('a', ['math-7a'], 1, 1, 'dp');
    const second = block('b', ['math-7a'], 1, 3, 'dp');
    const found = suggestPlaces(model, [first, second], first);
    expect(found.rearrangements).toEqual([]);
    expect(found.free.length).toBeGreaterThan(0);
    for (const suggestion of found.free) {
      const [moved, half] = suggestion.changes.map((one) => one.to);
      expect([moved?.id, half?.id]).toEqual(['a', 'b']);
      expect(rules(suggestion.changes.map((one) => one.to))).not.toContain('double_apart');
    }
  });

  it('is held by a lock on the other half', () => {
    const first = block('a', ['math-7a'], 1, 1, 'dp');
    const second = block('b', ['math-7a'], 1, 3, 'dp');
    const found = suggestPlaces(model, [first, second], first, {
      locks: [{ id: 'lock', kind: 'block', blockId: 'b' }],
    });
    expect(found).toMatchObject({ free: [], locked: true });
  });
});
