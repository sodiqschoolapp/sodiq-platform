import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkCandidates } from './check.js';
import { patternModel, type PatternFactsData, type PatternModel } from './facts-data.js';
import {
  blockPlacements,
  checkedPlacements,
  newBlockOf,
  patternPlacements,
  type PatternBlock,
} from './pattern-place.js';
import { suggestPlaces, type Suggestion } from './suggest.js';
import { patternData, row, ROWS } from './testing/pattern-fixture.js';

// Task 5.4b-2b: "Suggest a place" (06, Editing in the grid: "shows the best
// free slots, or a swap of two or three lessons that makes room for it").

const SENIOR_SLOTS = [1, 3, 5, 6];

/** A stored block of rows at a weekday and slot, its minutes read from its own template. */
function at(
  model: PatternModel,
  id: string,
  rowIds: readonly string[],
  weekday: number,
  slotPosition: number,
  rooms: Readonly<Record<string, string | null>> = {},
): PatternBlock {
  const lessons = rowIds.map((loadRowId) => ({
    id: `${id}:${loadRowId}`,
    loadRowId,
    roomId: rooms[loadRowId] ?? model.roomOfNew(model.rowOf(loadRowId)),
  }));
  const [first] = blockPlacements(model, { id, lessons }, weekday, slotPosition) ?? [];
  if (first === undefined) throw new Error('No such slot in the fixture.');
  return { id, weekday, slotPosition, start: first.start, end: first.end, lessons };
}

/** The route's check of a suggestion: the changed blocks among the draft (review finding 1). */
function blockedOfSuggestion(
  model: PatternModel,
  all: readonly PatternBlock[],
  suggestion: Suggestion,
) {
  return checkCandidates(
    checkedPlacements(model, all),
    model.facts,
    patternPlacements(
      model,
      suggestion.changes.map((one) => one.to),
    ),
  ).filter((one) => one.severity === 'blocked');
}

const slotOf = (block: PatternBlock) => [block.weekday, block.slotPosition];

/** Every weekday 1–5 and senior lesson slot but those left out. */
const seniorCells = (except: readonly string[] = []) =>
  [1, 2, 3, 4, 5]
    .flatMap((weekday) => SENIOR_SLOTS.map((position) => [weekday, position] as const))
    .filter(([weekday, position]) => !except.includes(`${weekday}:${position}`));

describe('suggestPlaces: free slots', () => {
  it('offers free slots, fewest warnings first, never the block’s own slot', () => {
    const model = patternModel(patternData());
    const a = at(model, 'a', ['math-7a'], 1, 1);
    const all = [a, at(model, 'a2', ['math-7a'], 2, 1)];
    const { free, rearrangements } = suggestPlaces(model, all, a);
    expect(free).toHaveLength(5);
    expect(rearrangements).toEqual([]);
    expect(slotOf(free[0]?.changes[0]?.to as PatternBlock)).toEqual([1, 3]);
    expect(
      free
        .map((one) => one.changes[0]?.to)
        .some((to) => to?.weekday === 1 && to.slotPosition === 1),
    ).toBe(false);
    const counts = free.map((one) => one.warnings.length);
    expect(counts).toEqual([...counts].sort((x, y) => x - y));
    for (const one of free) expect(blockedOfSuggestion(model, all, one)).toEqual([]);
  });

  it('still suggests with an unrelated error elsewhere in the draft', () => {
    const model = patternModel(patternData());
    const a = at(model, 'a', ['math-7a'], 1, 1);
    // 7b has two lessons at once on Wednesday: a blocked result of the draft.
    const all = [a, at(model, 'b1', ['math-7b'], 3, 1), at(model, 'b2', ['sci-7b'], 3, 1)];
    expect(suggestPlaces(model, all, a).free.length).toBeGreaterThan(0);
  });

  it('counts clock time, not slot numbers, across two templates', () => {
    const model = patternModel(patternData());
    // 2a's slot 5 is 09:30–10:10: it meets 7a's slot 3 (08:50–09:35) and 5 (09:55–10:40).
    const all = [at(model, 'j', ['math-2a'], 1, 5)];
    const offered = suggestPlaces(model, all, newBlockOf(model, 'math-7a')).free.map((one) =>
      slotOf(one.changes[0]?.to as PatternBlock),
    );
    expect(offered).toContainEqual([1, 1]);
    expect(offered).not.toContainEqual([1, 3]);
    expect(offered).not.toContainEqual([1, 5]);
  });

  it('never offers a slot of a teacher busy elsewhere or within the travel time of it', () => {
    const data = patternData();
    const model = patternModel({
      ...data,
      // t1 teaches in another branch on Monday 08:50–09:35, 30 minutes away.
      busyElsewhere: [
        {
          id: 'far',
          teacherId: 't1',
          branchId: 'branch-b',
          weekday: 1,
          start: 530,
          end: 575,
          tutorLesson: false,
        },
      ],
      travel: [{ branchA: 'branch-a', branchB: 'branch-b', minutes: 30 }],
      branches: [{ id: 'branch-b', name: 'Branch B' }],
    });
    // Every other day full for 7a, so Monday is all there is.
    const all = [2, 3, 4, 5].flatMap((weekday) =>
      SENIOR_SLOTS.map((position) =>
        at(model, `f${weekday}${position}`, ['sci-7a'], weekday, position, {
          'sci-7a': `r${weekday}${position}`,
        }),
      ),
    );
    const roomy = patternModel({
      ...model.data,
      rooms: [
        ...model.data.rooms,
        ...all.map((one) => ({
          id: one.lessons[0]?.roomId ?? '',
          type: 'classroom',
          status: 'in_use' as const,
          shared: false,
          lessonsAtOnce: 1,
          capacity: 30,
        })),
      ],
    });
    const result = suggestPlaces(roomy, all, newBlockOf(roomy, 'math-7a'));
    const offered = result.free.map((one) => slotOf(one.changes[0]?.to as PatternBlock));
    // 08:00–08:45 and 09:55–10:40 are within 30 minutes; 10:40–11:25 is 65 minutes after.
    expect(offered).toEqual([[1, 6]]);
    for (const one of [...result.free, ...result.rearrangements]) {
      expect(one.changes.map((change) => change.to.id)).not.toContain('far');
    }
  });
});

describe('suggestPlaces: rooms', () => {
  /** The laboratory full every slot with 7b's science (another teacher, another class). */
  function labFull(rows = ROWS) {
    const model = patternModel(patternData(rows));
    const all = seniorCells().map(([weekday, position]) =>
      at(model, `lab${weekday}${position}`, ['sci-7b'], weekday, position),
    );
    return { model, all };
  }

  it('offers a slot blocked by its room alone with another room', () => {
    const { model, all } = labFull();
    const { free } = suggestPlaces(model, all, newBlockOf(model, 'sci-7a'));
    expect(free.length).toBeGreaterThan(0);
    expect(free[0]?.roomChanged).toBe(true);
    expect(free[0]?.changes[0]?.to.lessons[0]?.roomId).toBe('r7a');
    for (const one of free) expect(blockedOfSuggestion(model, all, one)).toEqual([]);
  });

  it('does not offer a slot where a room rule and another blocked rule meet', () => {
    // 7a's science taught by 7b's science teacher: the room and the teacher clash together.
    const { model, all } = labFull(
      ROWS.map((one) => (one.id === 'sci-7a' ? { ...one, teacherId: 't6' } : one)),
    );
    expect(suggestPlaces(model, all, newBlockOf(model, 'sci-7a')).free).toEqual([]);
  });

  it('gives the two lessons of a split, both held by their room, two rooms', () => {
    const rows = ROWS.map((one) =>
      one.block.includes('eng-e1') ? { ...one, roomId: 'r7b' } : one,
    );
    const model = patternModel(patternData(rows));
    const all = seniorCells().map(([weekday, position]) =>
      at(model, `b${weekday}${position}`, ['math-7b'], weekday, position, { 'math-7b': 'r7b' }),
    );
    const { free } = suggestPlaces(model, all, newBlockOf(model, 'eng-e1'));
    expect(free.length).toBeGreaterThan(0);
    for (const one of free) {
      const rooms = one.changes[0]?.to.lessons.map((lesson) => lesson.roomId) ?? [];
      expect(new Set(rooms).size).toBe(2);
      expect(blockedOfSuggestion(model, all, one)).toEqual([]);
    }
  });
});

describe('suggestPlaces: rearrangements', () => {
  /**
   * t1 holds 7a in every slot but Friday's last; 7b is busy then with
   * science. A new 7b mathematics lesson has no free slot.
   */
  function crowded() {
    const model = patternModel(patternData());
    const all = [
      ...seniorCells(['5:6']).map(([weekday, position]) =>
        at(model, `m${weekday}${position}`, ['math-7a'], weekday, position),
      ),
      at(model, 'sci', ['sci-7b'], 5, 6),
    ];
    return { model, all };
  }

  it('offers a swap of two blocks when no slot is free, each checked as the route checks it', () => {
    const { model, all } = crowded();
    const { free, rearrangements } = suggestPlaces(model, all, newBlockOf(model, 'math-7b'));
    expect(free).toEqual([]);
    expect(rearrangements).toHaveLength(3);
    for (const one of rearrangements) {
      expect(one.changes).toHaveLength(2);
      expect(one.changes[0]?.from).toBeNull();
      expect(blockedOfSuggestion(model, all, one)).toEqual([]);
    }
  });

  it('never moves a pinned block', () => {
    const { model, all } = crowded();
    const pins = all
      .filter((one) => one.id.startsWith('m'))
      .map((one) => ({
        loadRowId: 'math-7a',
        weekday: one.weekday,
        slotPosition: one.slotPosition,
      }));
    const { rearrangements } = suggestPlaces(model, all, newBlockOf(model, 'math-7b'), { pins });
    expect(rearrangements.length).toBeGreaterThan(0);
    for (const one of rearrangements) {
      expect(one.changes.slice(1).map((change) => change.to.id)).toEqual(['sci']);
    }
  });

  it('moves three blocks when two are not enough', () => {
    const data = patternData(
      ROWS.map((one) => (one.id === 'sci-7a' ? { ...one, roomId: 'r7a' } : one)),
    );
    // t1 teaches elsewhere on Friday's last slot (no travel time between the branches).
    const model = patternModel({
      ...data,
      busyElsewhere: [
        {
          id: 'far',
          teacherId: 't1',
          branchId: 'branch-b',
          weekday: 5,
          start: 640,
          end: 685,
          tutorLesson: false,
        },
      ],
      travel: [{ branchA: 'branch-a', branchB: 'branch-b', minutes: 0 }],
      branches: [{ id: 'branch-b', name: 'Branch B' }],
    });
    const b = at(model, 'b', ['math-7b'], 5, 5);
    const all = [
      b,
      ...seniorCells(['5:5', '5:6']).map(([weekday, position]) =>
        at(model, `m${weekday}${position}`, ['math-7a'], weekday, position),
      ),
      at(model, 'sci', ['sci-7a'], 5, 5),
    ];
    const { free, rearrangements } = suggestPlaces(model, all, b);
    expect(free).toEqual([]);
    expect(rearrangements.length).toBeGreaterThan(0);
    const [first] = rearrangements;
    expect(first?.changes).toHaveLength(3);
    // 7a's mathematics into the slot 7b's leaves, 7a's science on to a slot 7a's mathematics left.
    expect(first?.changes.map((change) => change.to.id)).toEqual([
      'b',
      expect.stringMatching(/^m/),
      'sci',
    ]);
    for (const one of rearrangements) {
      expect(one.changes.length).toBeLessThanOrEqual(3);
      expect(blockedOfSuggestion(model, all, one)).toEqual([]);
      expect(one.changes.map((change) => change.to.id)).not.toContain('far');
    }
  });

  it('puts a block of the other template on a slot of its own template', () => {
    const model = patternModel(patternData());
    // 2a's mathematics (t1) holds every junior slot of the week but Friday's last.
    const juniorSlots = [1, 3, 5, 6];
    const all = [1, 2, 3, 4, 5]
      .flatMap((weekday) => juniorSlots.map((position) => [weekday, position] as const))
      .filter(([weekday, position]) => !(weekday === 5 && position === 6))
      .map(([weekday, position]) =>
        at(model, `j${weekday}${position}`, ['math-2a'], weekday, position),
      );
    const result = suggestPlaces(model, all, newBlockOf(model, 'math-7a'));
    for (const one of [...result.free, ...result.rearrangements]) {
      for (const change of one.changes) {
        const own = at(
          model,
          'x',
          change.to.lessons.map((lesson) => lesson.loadRowId),
          change.to.weekday,
          change.to.slotPosition,
        );
        expect([change.to.start, change.to.end]).toEqual([own.start, own.end]);
      }
      expect(blockedOfSuggestion(model, all, one)).toEqual([]);
    }
  });

  it('stops at the budget and says so', () => {
    const { model, all } = crowded();
    const result = suggestPlaces(model, all, newBlockOf(model, 'math-7b'), { budget: 5 });
    expect(result.cutShort).toBe(true);
    expect(result.rearrangements).toEqual([]);
  });
});

describe('suggestPlaces: generated drafts', () => {
  const rowIds = ['math-7a', 'math-7b', 'math-2a', 'eng-e1', 'sci-7a', 'sci-7b'];
  const data: PatternFactsData = patternData([
    ...ROWS,
    row('sci-2a', { classId: '2a', subjectId: 'science', teacherId: 't5', roomId: 'lab' }),
  ]);
  const model = patternModel(data);

  it('offers only suggestions the route accepts, of at most three blocks', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            rowId: fc.constantFrom(...rowIds, 'sci-2a'),
            weekday: fc.integer({ min: 1, max: 5 }),
            position: fc.constantFrom(1, 3, 5, 6),
          }),
          { maxLength: 24 },
        ),
        fc.constantFrom(...rowIds),
        (placed, selected) => {
          const all = placed.map((one, index) =>
            at(model, `g${index}`, model.rowOf(one.rowId).block, one.weekday, one.position),
          );
          const result = suggestPlaces(model, all, newBlockOf(model, selected), { budget: 300 });
          for (const one of [...result.free, ...result.rearrangements]) {
            expect(one.changes.length).toBeLessThanOrEqual(3);
            expect(blockedOfSuggestion(model, all, one)).toEqual([]);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('suggestPlaces: locks (task 5.4c-1)', () => {
  function crowded() {
    const model = patternModel(patternData());
    const all = [
      ...seniorCells(['5:6']).map(([weekday, position]) =>
        at(model, `m${weekday}${position}`, ['math-7a'], weekday, position),
      ),
      at(model, 'sci', ['sci-7b'], 5, 6),
    ];
    return { model, all };
  }

  it('never moves a locked block as a blocker', () => {
    const { model, all } = crowded();
    const unlocked = suggestPlaces(model, all, newBlockOf(model, 'math-7b'));
    expect(
      unlocked.rearrangements.some((one) => one.changes.some((change) => change.to.id === 'sci')),
    ).toBe(true);
    const { rearrangements } = suggestPlaces(model, all, newBlockOf(model, 'math-7b'), {
      locks: [{ id: 'l', kind: 'block', blockId: 'sci' }],
    });
    for (const one of rearrangements) {
      expect(one.changes.map((change) => change.to.id)).not.toContain('sci');
    }
  });

  it('never moves a blocker of a locked teacher', () => {
    const { model, all } = crowded();
    const { rearrangements } = suggestPlaces(model, all, newBlockOf(model, 'math-7b'), {
      locks: [{ id: 'l', kind: 'teacher', teacherId: 't6' }],
    });
    expect(rearrangements.length).toBeGreaterThan(0);
    for (const one of rearrangements) {
      expect(one.changes.map((change) => change.to.id)).not.toContain('sci');
    }
  });

  it('offers no slot of a locked day, and moves no blocker into it', () => {
    const { model, all } = crowded();
    const { rearrangements } = suggestPlaces(model, all, newBlockOf(model, 'math-7b'), {
      locks: [{ id: 'l', kind: 'day', weekday: 4 }],
    });
    expect(rearrangements.length).toBeGreaterThan(0);
    for (const one of rearrangements) {
      for (const change of one.changes) expect(change.to.weekday).not.toBe(4);
    }
    const free = suggestPlaces(model, [], newBlockOf(model, 'math-7a'), {
      locks: [{ id: 'l', kind: 'day', weekday: 1 }],
    }).free;
    expect(free.length).toBeGreaterThan(0);
    for (const one of free) expect(one.changes[0]?.to.weekday).not.toBe(1);
  });

  it('searches nothing for a locked lesson and says so', () => {
    const model = patternModel(patternData());
    const a = at(model, 'a', ['math-7a'], 1, 1);
    for (const lock of [
      { id: 'l', kind: 'block', blockId: 'a' },
      { id: 'l', kind: 'class', classId: '7a' },
      { id: 'l', kind: 'day', weekday: 1 },
    ] as const) {
      expect(suggestPlaces(model, [a], a, { locks: [lock] })).toEqual({
        free: [],
        rearrangements: [],
        cutShort: false,
        locked: true,
      });
    }
    expect(suggestPlaces(model, [a], a).locked).toBe(false);
  });
});
