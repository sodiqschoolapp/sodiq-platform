import {
  patternModel,
  type PatternBlock,
  type PatternFactsData,
  type PatternRowData,
} from '@sodiq/timetable-rules';
import { describe, expect, it } from 'vitest';
import {
  dropped,
  EMPTY_HISTORY,
  HISTORY_MAX,
  nextStep,
  placedAgain,
  recorded,
  renamed,
  stepOf,
  stillApplies,
  taken,
  writeOf,
  type Step,
} from './grid-history';

// Task 5.4c-2: undo and redo of the grid (06, Editing in the grid: "Undo and
// redo"; decisions 3 to 6, 10).

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const ROW_A = uid(1);
const ROW_B = uid(2);
const ROW_C = uid(3);
const ROOM = uid(9);

const block = (
  id: string,
  rowId: string,
  weekday: number,
  slotPosition: number,
  roomId: string | null = null,
): PatternBlock => ({
  id,
  weekday,
  slotPosition,
  start: 0,
  end: 45,
  lessons: [{ id: `${id}-lesson`, loadRowId: rowId, roomId }],
  doublePairId: null,
});

const row = (id: string, block: string[] = [id]): PatternRowData => ({
  id,
  classId: uid(50),
  groupId: null,
  subjectId: uid(60),
  teacherId: uid(70),
  roomId: null,
  roomType: null,
  lessonsPerWeek: 3,
  mixedBlock: false,
  doubleLessons: false,
  deliberatelyShort: false,
  block,
});

/** Only what `newBlockOf` reads: the rows and their units. */
const modelOf = (rows: PatternRowData[]) =>
  patternModel({
    rows,
    units: [
      {
        id: uid(50),
        kind: 'class',
        grades: [7],
        language: 'uz',
        tutorOnStart: null,
        classIds: [uid(50)],
        studentIds: [],
        mainRoomId: null,
      },
    ],
    rooms: [],
    teachers: [],
    subjects: [],
    classStudents: [],
    days: [],
    travel: [],
    busyElsewhere: [],
    otherDrafts: [],
    branches: [],
    classDailyLessons: null,
    branchId: uid(80),
    startDate: '2026-10-19',
    versionEnd: '2027-05-31',
    year: { firstDate: '2026-09-01', lastDate: '2027-05-31', quarters: [] },
  } satisfies PatternFactsData);

const A = block(uid(10), ROW_A, 1, 1, ROOM);
const B = block(uid(11), ROW_B, 1, 3);

/** The write of a step with a model of the three rows (task 5.4c-3b: `writeOf` reads the rows). */
const writeIn = (...args: [Step, 'undo' | 'redo', readonly PatternBlock[]]) =>
  writeOf(...args, modelOf([row(ROW_A), row(ROW_B), row(ROW_C)]));

const stepFrom = (step: Step | null): Step => {
  if (step === null) throw new Error('No step.');
  return step;
};

describe('the step of a write', () => {
  it('holds each block that changed, before and after, and nothing for a write that changed none', () => {
    const moved = { ...A, weekday: 2 };
    expect(stepOf('move', [A, B], [moved, B])).toEqual({
      kind: 'move',
      changes: [
        {
          before: {
            blockId: A.id,
            weekday: 1,
            slotPosition: 1,
            rooms: [{ loadRowId: ROW_A, roomId: ROOM }],
            paired: false,
          },
          after: {
            blockId: A.id,
            weekday: 2,
            slotPosition: 1,
            rooms: [{ loadRowId: ROW_A, roomId: ROOM }],
            paired: false,
          },
        },
      ],
    });
    expect(stepOf('move', [A, B], [A, B])).toBeNull();
    const placed = stepFrom(stepOf('place', [A], [A, B]));
    expect(placed.changes).toMatchObject([{ before: null, after: { blockId: B.id } }]);
    const removed = stepFrom(stepOf('remove', [A, B], [A]));
    expect(removed.changes).toMatchObject([{ before: { blockId: B.id }, after: null }]);
  });
});

describe('the write of a step', () => {
  it('takes a move back by a move, and does it again by a move', () => {
    const step = stepFrom(stepOf('move', [A], [{ ...A, weekday: 2 }]));
    expect(writeIn(step, 'undo', [{ ...A, weekday: 2 }])).toEqual({
      route: 'move',
      blockId: A.id,
      body: { weekday: 1, slotPosition: 1 },
    });
    expect(writeIn(step, 'redo', [A])).toEqual({
      route: 'move',
      blockId: A.id,
      body: { weekday: 2, slotPosition: 1 },
    });
  });

  it('takes a swap back by the same swap', () => {
    const after = [
      { ...A, slotPosition: 3 },
      { ...B, slotPosition: 1 },
    ];
    const step = stepFrom(stepOf('swap', [A, B], after));
    expect(writeIn(step, 'undo', after)).toEqual({
      route: 'swap',
      body: { blockIds: [A.id, B.id] },
    });
  });

  it('gives a room back, also no room, naming the lesson as the board has it now (decision 7)', () => {
    const roomless = block(A.id, ROW_A, 1, 1, null);
    const step = stepFrom(stepOf('room', [roomless], [A]));
    // The block was placed again since: its lesson has another id.
    const now = { ...A, lessons: [{ id: uid(99), loadRowId: ROW_A, roomId: ROOM }] };
    expect(writeIn(step, 'undo', [now])).toEqual({
      route: 'room',
      blockId: A.id,
      body: { lessonId: uid(99), roomId: null },
    });
  });

  it('takes a removal back by a placement with each room, and a placement back by a removal', () => {
    const step = stepFrom(stepOf('remove', [A, B], [B]));
    expect(writeIn(step, 'undo', [B])).toEqual({
      route: 'place',
      body: {
        loadRowId: ROW_A,
        weekday: 1,
        slotPosition: 1,
        rooms: [{ loadRowId: ROW_A, roomId: ROOM }],
      },
    });
    expect(writeIn(step, 'redo', [A, B])).toEqual({ route: 'remove', blockId: A.id });
    const placed = stepFrom(stepOf('place', [B], [A, B]));
    expect(writeIn(placed, 'undo', [A, B])).toEqual({ route: 'remove', blockId: A.id });
  });

  it('takes an applied suggestion back as one rearrangement, removing the block it created (From 5.4b-2b line)', () => {
    const fresh = block(uid(12), ROW_C, 1, 3);
    const after = [{ ...B, slotPosition: 5 }, fresh];
    const step = stepFrom(stepOf('suggestion', [B], after));
    expect(writeIn(step, 'undo', after)).toEqual({
      route: 'rearrange',
      body: {
        changes: [
          {
            blockId: B.id,
            weekday: 1,
            slotPosition: 3,
            rooms: [{ loadRowId: ROW_B, roomId: null }],
          },
        ],
        remove: [fresh.id],
      },
    });
    expect(writeIn(step, 'redo', [B])).toEqual({
      route: 'rearrange',
      body: {
        changes: [
          {
            blockId: B.id,
            weekday: 1,
            slotPosition: 5,
            rooms: [{ loadRowId: ROW_B, roomId: null }],
          },
          {
            loadRowId: ROW_C,
            weekday: 1,
            slotPosition: 3,
            rooms: [{ loadRowId: ROW_C, roomId: null }],
          },
        ],
      },
    });
  });
});

describe('a step that changed since (decision 3, Look first)', () => {
  const model = modelOf([row(ROW_A), row(ROW_B), row(ROW_C)]);

  it('applies while each block is as the step left it', () => {
    const step = stepFrom(stepOf('move', [A], [{ ...A, weekday: 2 }]));
    expect(stillApplies(model, [{ ...A, weekday: 2 }, B], step, 'undo')).toBe(true);
  });

  it('does not apply to a block moved, given another room, or removed since', () => {
    const step = stepFrom(stepOf('move', [A], [{ ...A, weekday: 2 }]));
    expect(stillApplies(model, [{ ...A, weekday: 3 }], step, 'undo')).toBe(false);
    expect(stillApplies(model, [{ ...block(A.id, ROW_A, 2, 1, null) }], step, 'undo')).toBe(false);
    expect(stillApplies(model, [B], step, 'undo')).toBe(false);
  });

  it('does not place a block again when its load rows now build another block', () => {
    const step = stepFrom(stepOf('remove', [A], []));
    expect(stillApplies(model, [], step, 'undo')).toBe(true);
    // Row A is now split with row C: the block it builds has two lessons.
    const split = modelOf([row(ROW_A, [ROW_A, ROW_C]), row(ROW_C, [ROW_A, ROW_C])]);
    expect(stillApplies(split, [], step, 'undo')).toBe(false);
    // A load row the draft no longer has.
    expect(stillApplies(modelOf([row(ROW_B)]), [], step, 'undo')).toBe(false);
  });
});

describe('the lists of steps', () => {
  const one = stepFrom(stepOf('move', [A], [{ ...A, weekday: 2 }]));
  const two = stepFrom(stepOf('remove', [B], []));

  it('undoes the newest first, redoes in order, and a new step clears what could be redone', () => {
    const both = recorded(recorded(EMPTY_HISTORY, one), two);
    expect(nextStep(both, 'undo')).toBe(two);
    const back = taken(both, 'undo');
    expect(nextStep(back, 'undo')).toBe(one);
    expect(nextStep(back, 'redo')).toBe(two);
    expect(nextStep(taken(back, 'redo'), 'undo')).toBe(two);
    expect(recorded(back, one).redo).toEqual([]);
    expect(dropped(back, 'redo')).toEqual({ undo: [one], redo: [] });
    expect(dropped(both, 'undo')).toEqual({ undo: [one], redo: [] });
  });

  it('keeps the newest 50 steps (decision 10)', () => {
    let history = EMPTY_HISTORY;
    for (let index = 0; index <= HISTORY_MAX; index += 1) history = recorded(history, one);
    history = recorded(history, two);
    expect(history.undo).toHaveLength(HISTORY_MAX);
    expect(history.undo.at(-1)).toBe(two);
  });

  it('names a block placed again by its new id in every step', () => {
    const removal = stepFrom(stepOf('remove', [A], []));
    const room = stepFrom(stepOf('room', [block(A.id, ROW_A, 1, 1, null)], [A]));
    const history = taken(recorded(recorded(EMPTY_HISTORY, room), removal), 'undo');
    const again = block(uid(20), ROW_A, 1, 1, ROOM);
    const ids = placedAgain(removal, 'undo', [], [again, B]);
    expect(ids).toEqual([{ from: A.id, to: again.id }]);
    const next = renamed(history, A.id, again.id);
    expect(next.undo[0]?.changes[0]?.after?.blockId).toBe(again.id);
    expect(next.redo[0]?.changes[0]?.before?.blockId).toBe(again.id);
    expect(writeIn(next.redo[0] ?? removal, 'redo', [again])).toEqual({
      route: 'remove',
      blockId: again.id,
    });
  });
});

// Task 5.4c-3a: the two halves of a double lesson are one step, written by
// one route on either half (From 5.4c-2 line, decision 11).
describe('the steps of a double lesson', () => {
  const PAIR = uid(30);
  const half = (id: string, slotPosition: number, roomId: string | null = ROOM): PatternBlock => ({
    ...block(id, ROW_A, 1, slotPosition, roomId),
    doublePairId: PAIR,
  });
  const first = half(uid(31), 1);
  const second = half(uid(32), 3);

  it('takes a placed double back by removing one half, and places it again as a double', () => {
    const step = stepFrom(stepOf('place', [B], [B, first, second]));
    expect(step.changes).toHaveLength(2);
    expect(writeIn(step, 'undo', [B, first, second])).toEqual({
      route: 'remove',
      blockId: first.id,
    });
    expect(writeIn(step, 'redo', [B])).toEqual({
      route: 'place',
      body: {
        loadRowId: ROW_A,
        weekday: 1,
        slotPosition: 1,
        rooms: [{ loadRowId: ROW_A, roomId: ROOM }],
        double: true,
      },
    });
  });

  it('takes a moved double back by moving one half, the other going with it', () => {
    const moved = [
      { ...first, weekday: 2 },
      { ...second, weekday: 2 },
    ];
    const step = stepFrom(stepOf('move', [first, second], moved));
    expect(step.changes).toHaveLength(2);
    expect(writeIn(step, 'undo', moved)).toEqual({
      route: 'move',
      blockId: first.id,
      body: { weekday: 1, slotPosition: 1 },
    });
  });

  it('takes a removed double back by placing it as a double, with its rooms', () => {
    const step = stepFrom(stepOf('remove', [first, second], []));
    expect(writeIn(step, 'undo', [])).toMatchObject({
      route: 'place',
      body: { loadRowId: ROW_A, slotPosition: 1, double: true },
    });
  });

  it('gives back the room of both halves through the room route of one', () => {
    const before = [half(first.id, 1, null), half(second.id, 3, null)];
    const step = stepFrom(stepOf('room', before, [first, second]));
    expect(writeIn(step, 'undo', [first, second])).toEqual({
      route: 'room',
      blockId: first.id,
      body: { lessonId: first.lessons[0]?.id, roomId: null },
    });
  });

  it('names both halves placed again by their new ids', () => {
    const step = stepFrom(stepOf('remove', [first, second], []));
    const again = [half(uid(41), 1), half(uid(42), 3)];
    expect(placedAgain(step, 'undo', [], again)).toEqual([
      { from: first.id, to: uid(41) },
      { from: second.id, to: uid(42) },
    ]);
  });

  it('tells a half from a single lesson in the same slot (a step of a single lesson does not apply)', () => {
    const single = { ...first, doublePairId: null };
    const step = stepFrom(stepOf('move', [{ ...single, slotPosition: 3 }], [single]));
    expect(stillApplies(modelOf([row(ROW_A)]), [single], step, 'undo')).toBe(true);
    expect(stillApplies(modelOf([row(ROW_A)]), [first], step, 'undo')).toBe(false);
  });
});

// Task 5.4c-3b: a pairing of two mixed halves is placed again with its partner
// (`placeRowsOf`); a pairing whose rows no longer pair is not.
describe('the steps of a mixed pairing', () => {
  const CLASS = uid(50);
  const PE_BOYS = uid(41);
  const PE_GIRLS = uid(42);
  const TECH_GIRLS = uid(43);
  const half = (id: string, groupId: string, subjectId: string, block: string[], mixed = true) => ({
    ...row(id, block),
    classId: null,
    groupId,
    subjectId,
    mixedBlock: mixed,
  });
  const group = (id: string) => ({
    id,
    kind: 'group' as const,
    grades: [7],
    language: 'uz',
    tutorOnStart: null,
    classIds: [CLASS],
    studentIds: [],
    mainRoomId: null,
  });
  const pairingModel = (mixed = true) => {
    const base = modelOf([
      half(PE_BOYS, uid(51), uid(61), [PE_BOYS, PE_GIRLS], mixed),
      half(PE_GIRLS, uid(52), uid(61), [PE_BOYS, PE_GIRLS], mixed),
      half(TECH_GIRLS, uid(53), uid(62), [TECH_GIRLS], mixed),
    ]);
    return patternModel({
      ...base.data,
      units: [...base.data.units, group(uid(51)), group(uid(52)), group(uid(53))],
    });
  };
  const pairing: PatternBlock = {
    id: uid(44),
    weekday: 1,
    slotPosition: 1,
    start: 0,
    end: 45,
    lessons: [
      { id: uid(45), loadRowId: TECH_GIRLS, roomId: ROOM },
      { id: uid(46), loadRowId: PE_BOYS, roomId: null },
    ],
    doublePairId: null,
  };

  it('places a removed pairing again with its partner, and still applies while the rows pair', () => {
    const model = pairingModel();
    const step = stepFrom(stepOf('remove', [pairing], []));
    expect(stillApplies(model, [], step, 'undo')).toBe(true);
    expect(writeOf(step, 'undo', [], model)).toEqual({
      route: 'place',
      body: {
        loadRowId: PE_BOYS,
        partnerRowId: TECH_GIRLS,
        weekday: 1,
        slotPosition: 1,
        rooms: [
          { loadRowId: TECH_GIRLS, roomId: ROOM },
          { loadRowId: PE_BOYS, roomId: null },
        ],
      },
    });
  });

  it('takes a placed pairing back by a removal, and drops its redo once the rows no longer pair (review correction 4)', () => {
    const step = stepFrom(stepOf('place', [], [pairing]));
    const cleared = pairingModel(false);
    // The undo removes the block whatever its rows are now.
    expect(stillApplies(cleared, [pairing], step, 'undo')).toBe(true);
    expect(writeOf(step, 'undo', [pairing], cleared)).toEqual({
      route: 'remove',
      blockId: pairing.id,
    });
    // The redo would place the pairing again: the mark is cleared, so it is dropped.
    expect(stillApplies(cleared, [], step, 'redo')).toBe(false);
    expect(stillApplies(pairingModel(), [], step, 'redo')).toBe(true);
  });

  it('names a new pairing of an applied suggestion by both rows', () => {
    const model = pairingModel();
    const step = stepFrom(stepOf('suggestion', [], [pairing]));
    expect(writeOf(step, 'redo', [], model)).toEqual({
      route: 'rearrange',
      body: {
        changes: [
          {
            loadRowId: PE_BOYS,
            partnerRowId: TECH_GIRLS,
            weekday: 1,
            slotPosition: 1,
            rooms: [
              { loadRowId: TECH_GIRLS, roomId: ROOM },
              { loadRowId: PE_BOYS, roomId: null },
            ],
          },
        ],
      },
    });
  });
});
