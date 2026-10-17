import { describe, expect, it } from 'vitest';
import { patternModel, type PatternFactsData, type PatternRoomData } from './facts-data.js';
import type { PatternBlock } from './pattern-place.js';
import { addedResults, roomChange, roomChoices } from './rooms-pick.js';
import type { RuleResult } from './rules.js';
import { patternData, row, ROWS } from './testing/pattern-fixture.js';

// Task 5.4b-2a: the room picker of a lesson and the check of a room change
// (06, Editing in the grid: "The room picker lists only rooms that are free in
// that slot, best fit first"; decisions 4 and 5).

const room = (id: string, extra: Partial<PatternRoomData> = {}): PatternRoomData => ({
  id,
  type: 'classroom',
  status: 'in_use',
  shared: false,
  lessonsAtOnce: 1,
  capacity: 30,
  ...extra,
});

const withRooms = (rooms: PatternRoomData[], data: PatternFactsData = patternData()) =>
  patternModel({ ...data, rooms: [...data.rooms, ...rooms] });

// Monday, position 3: 08:50–09:35 for grade 7; position 5 of grade 2 is 09:30–10:10.
const block = (
  id: string,
  rowId: string,
  roomId: string | null,
  slotPosition = 3,
): PatternBlock => {
  const junior = rowId === 'math-2a';
  const times = junior
    ? { 3: [525, 565], 5: [570, 610] }[slotPosition]
    : { 1: [480, 525], 3: [530, 575], 5: [595, 640] }[slotPosition];
  return {
    id,
    weekday: 1,
    slotPosition,
    start: times?.[0] ?? 0,
    end: times?.[1] ?? 0,
    lessons: [{ id: `${id}:l`, loadRowId: rowId, roomId }],
  };
};

const ids = (choices: readonly { roomId: string }[]) => choices.map((one) => one.roomId);

describe('roomChoices', () => {
  it('leaves out a room that holds another lesson at the same time', () => {
    const model = withRooms([]);
    const mine = block('a', 'math-7a', 'r7a');
    const all = [mine, block('b', 'sci-7b', 'r7b')];
    expect(ids(roomChoices(model, all, mine, 'a:l'))).not.toContain('r7b');
    expect(ids(roomChoices(model, all, mine, 'a:l'))).toContain('lab');
  });

  it('counts clock time, not slot numbers, across two templates', () => {
    // 2a has another teacher here, so only the room can clash.
    const data = patternData(
      ROWS.map((one) => (one.id === 'math-2a' ? { ...one, teacherId: 't5' } : one)),
    );
    const model = withRooms([room('x')], data);
    // 7a at 08:50–09:35 (position 3); 2a at 09:30–10:10 (its position 5) in x.
    const mine = block('a', 'math-7a', 'r7a');
    const junior = block('j', 'math-2a', 'x', 5);
    expect(ids(roomChoices(model, [mine, junior], mine, 'a:l'))).not.toContain('x');
    // 2a at 10:10–10:50 (its position 6): a higher number, no overlap.
    const later: PatternBlock = { ...junior, slotPosition: 6, start: 610, end: 650 };
    expect(ids(roomChoices(model, [mine, later], mine, 'a:l'))).toContain('x');
  });

  it('leaves out a closed room and a full shared room, keeps a shared room with space', () => {
    const model = withRooms([
      room('closed', { status: 'closed' }),
      room('full', { shared: true, lessonsAtOnce: 1 }),
      room('hall', { shared: true, lessonsAtOnce: 2, capacity: 60 }),
    ]);
    const mine = block('a', 'math-7a', 'r7a');
    const all = [mine, block('b', 'sci-7b', 'full'), { ...block('c', 'eng-e1', 'hall'), id: 'c' }];
    const offered = ids(roomChoices(model, all, mine, 'a:l'));
    expect(offered).not.toContain('closed');
    expect(offered).not.toContain('full');
    expect(offered).toContain('hall');
  });

  it('still offers the free rooms to a lesson with a blocked result of its own', () => {
    const data = patternData();
    const stale = {
      ...data,
      teachers: data.teachers.map((one) =>
        one.id === 't1'
          ? {
              ...one,
              availability: one.availability.map((entry) => ({
                ...entry,
                ranges: entry.ranges.filter((range) => range.weekday !== 1),
              })),
            }
          : one,
      ),
    };
    const model = withRooms([], stale);
    const mine = block('a', 'math-7a', 'r7a');
    const change = roomChange(model, [mine], mine, 'a:l', 'lab');
    expect(change.accepted).toBe(true);
    expect(change.blocked).toEqual([]);
    expect(ids(roomChoices(model, [mine], mine, 'a:l'))).toEqual(['r7a', 'lab', 'r7b']);
  });

  it('refuses a taken room with the rule named', () => {
    const model = withRooms([]);
    const mine = block('a', 'math-7a', 'r7a');
    const change = roomChange(model, [mine, block('b', 'sci-7b', 'r7b')], mine, 'a:l', 'r7b');
    expect(change.accepted).toBe(false);
    expect(change.blocked.map((one) => one.rule)).toEqual(['room_double']);
  });

  it('orders the room type before the main classroom, then by spare capacity, a too small room last', () => {
    const data = patternData([
      ...ROWS,
      row('lab-7a', { subjectId: 'science', teacherId: 't6', roomType: 'laboratory' }),
    ]);
    const model = withRooms(
      [room('big', { capacity: 40 }), room('snug', { capacity: 5 }), room('tiny', { capacity: 2 })],
      data,
    );
    const mine: PatternBlock = {
      ...block('a', 'lab-7a', null),
      lessons: [{ id: 'a:l', loadRowId: 'lab-7a', roomId: null }],
    };
    const choices = roomChoices(model, [mine], mine, 'a:l');
    expect(ids(choices)).toEqual(['lab', 'r7a', 'snug', 'r7b', 'big', 'tiny']);
    expect(choices.at(-1)?.warnings.map((one) => one.rule)).toEqual(['room_capacity']);
  });

  it("puts the row's own room first", () => {
    const model = withRooms([room('snug', { capacity: 4 })]);
    const mine: PatternBlock = {
      ...block('a', 'sci-7a', 'r7b'),
      lessons: [{ id: 'a:l', loadRowId: 'sci-7a', roomId: 'r7b' }],
    };
    expect(ids(roomChoices(model, [mine], mine, 'a:l'))[0]).toBe('lab');
  });

  it('breaks ties by name', () => {
    const model = withRooms([room('m', { capacity: 10 }), room('n', { capacity: 10 })]);
    const mine = block('a', 'math-7b', null);
    const names: Record<string, string> = { m: 'Zeta', n: 'Alpha' };
    const order = ids(roomChoices(model, [mine], mine, 'a:l', (id) => names[id] ?? id));
    expect(order.indexOf('n')).toBeLessThan(order.indexOf('m'));
  });
});

describe('addedResults', () => {
  const result = (detail: Record<string, string>): RuleResult => ({
    rule: 'room_inactive',
    severity: 'blocked',
    day: '1',
    lessonIds: ['a'],
    detail,
  });

  it('tells apart two results that differ only in their detail', () => {
    expect(
      addedResults([result({ roomId: 'x' })], [result({ roomId: 'x' }), result({ roomId: 'y' })]),
    ).toEqual([result({ roomId: 'y' })]);
  });
});
