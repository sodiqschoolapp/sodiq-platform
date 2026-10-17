import {
  weekdaySchema,
  type LessonRoomRecord,
  type MoveRecord,
  type PlaceRecord,
  type RearrangeRecord,
  type SwapRecord,
} from '@sodiq/shared';
import {
  newBlockOf,
  placeRowsOf,
  type PatternBlock,
  type PatternModel,
} from '@sodiq/timetable-rules';

/**
 * Undo and redo of the grid (06, Editing in the grid: "Undo and redo"; task
 * 5.4c-2, pull request #136). A step is what one write of the page changed:
 * each block it touched before and after (`null`: not there). Taking it back,
 * or doing it again, is a new write through the route of its kind (decision
 * 5), checked by the rule engine and refused by the API like any other write.
 * Lessons are named by block and load row, never by lesson id: a block placed
 * again has new lesson ids.
 */

/** The kinds of grid change that are steps (decision 1): locks and the load are not. */
export const STEP_KINDS = ['place', 'move', 'swap', 'room', 'remove', 'suggestion'] as const;

export type StepKind = (typeof STEP_KINDS)[number];

/** A block as a step keeps it: its slot and the room of each lesson by load row. */
export interface BlockState {
  readonly blockId: string;
  readonly weekday: number;
  readonly slotPosition: number;
  readonly rooms: readonly { readonly loadRowId: string; readonly roomId: string | null }[];
  /** A half of a double lesson (task 5.4c-3a); a pair placed again has a new pair id. */
  readonly paired: boolean;
}

export interface StepChange {
  readonly before: BlockState | null;
  readonly after: BlockState | null;
}

export interface Step {
  readonly kind: StepKind;
  readonly changes: readonly StepChange[];
}

/** The steps that can be undone (newest last) and redone (next first). */
export interface GridHistory {
  readonly undo: readonly Step[];
  readonly redo: readonly Step[];
}

/** Decision 10: a default with no rule behind it, so the page keeps bounded memory. */
export const HISTORY_MAX = 50;

export const EMPTY_HISTORY: GridHistory = { undo: [], redo: [] };

export type Direction = 'undo' | 'redo';

export function stateOf(block: PatternBlock): BlockState {
  return {
    blockId: block.id,
    weekday: block.weekday,
    slotPosition: block.slotPosition,
    rooms: block.lessons.map((lesson) => ({ loadRowId: lesson.loadRowId, roomId: lesson.roomId })),
    paired: block.doublePairId !== null,
  };
}

const sameState = (a: BlockState, b: BlockState): boolean =>
  a.blockId === b.blockId &&
  a.weekday === b.weekday &&
  a.slotPosition === b.slotPosition &&
  a.paired === b.paired &&
  a.rooms.length === b.rooms.length &&
  a.rooms.every((room) =>
    b.rooms.some((one) => one.loadRowId === room.loadRowId && one.roomId === room.roomId),
  );

/** The load rows of a block state, in a fixed order. */
const rowsOf = (state: BlockState): string[] => state.rooms.map((one) => one.loadRowId).sort();

/**
 * The step of one write: every block whose slot or rooms differ between the
 * board before and after it, or that only one of them holds. `null` when the
 * write changed no block (a slot it already had, a lock).
 */
export function stepOf(
  kind: StepKind,
  before: readonly PatternBlock[],
  after: readonly PatternBlock[],
): Step | null {
  const was = new Map(before.map((block) => [block.id, stateOf(block)]));
  const is = new Map(after.map((block) => [block.id, stateOf(block)]));
  const changes: StepChange[] = [];
  for (const [id, state] of was) {
    const now = is.get(id) ?? null;
    if (now === null || !sameState(state, now)) changes.push({ before: state, after: now });
  }
  for (const [id, state] of is) {
    if (!was.has(id)) changes.push({ before: null, after: state });
  }
  return changes.length === 0 ? null : { kind, changes };
}

/** A new step: the redo list is cleared and the oldest step goes past the limit. */
export function recorded(history: GridHistory, step: Step): GridHistory {
  return { undo: [...history.undo, step].slice(-HISTORY_MAX), redo: [] };
}

/** The step the direction takes next, if any. */
export function nextStep(history: GridHistory, direction: Direction): Step | undefined {
  return direction === 'undo' ? history.undo.at(-1) : history.redo[0];
}

/** The step taken: it moves to the other list. */
export function taken(history: GridHistory, direction: Direction): GridHistory {
  const step = nextStep(history, direction);
  if (step === undefined) return history;
  return direction === 'undo'
    ? { undo: history.undo.slice(0, -1), redo: [step, ...history.redo] }
    : { undo: [...history.undo, step], redo: history.redo.slice(1) };
}

/** The step dropped because its blocks changed since (decision 3). */
export function dropped(history: GridHistory, direction: Direction): GridHistory {
  return direction === 'undo'
    ? { ...history, undo: history.undo.slice(0, -1) }
    : { ...history, redo: history.redo.slice(1) };
}

/** A block placed again has a new id: every step that names the old one names the new one. */
export function renamed(history: GridHistory, from: string, to: string): GridHistory {
  const rename = (state: BlockState | null) =>
    state === null || state.blockId !== from ? state : { ...state, blockId: to };
  const steps = (list: readonly Step[]) =>
    list.map((step) => ({
      ...step,
      changes: step.changes.map((change) => ({
        before: rename(change.before),
        after: rename(change.after),
      })),
    }));
  return { undo: steps(history.undo), redo: steps(history.redo) };
}

/** Each block of the step as the direction finds it (`from`) and leaves it (`to`). */
export function movesOf(
  step: Step,
  direction: Direction,
): { from: BlockState | null; to: BlockState | null }[] {
  return step.changes.map((change) =>
    direction === 'undo'
      ? { from: change.after, to: change.before }
      : { from: change.before, to: change.after },
  );
}

/**
 * Whether the board still holds every block of the step as the direction
 * finds it (decision 3): a block in the same slot with the same rooms, a
 * removed block still absent, and a block to place again built by the rule
 * engine (`newBlockOf`) from the same load rows, so a load edit since is seen;
 * task 5.4c-3b: a pairing with its partner (`placeRowsOf`), so a pairing whose
 * rows no longer pair is not placed again.
 */
export function stillApplies(
  model: PatternModel,
  blocks: readonly PatternBlock[],
  step: Step,
  direction: Direction,
): boolean {
  return movesOf(step, direction).every(({ from, to }) => {
    if (from !== null) {
      const block = blocks.find((one) => one.id === from.blockId);
      return block !== undefined && sameState(stateOf(block), from);
    }
    if (to === null) return true;
    if (blocks.some((one) => one.id === to.blockId)) return false;
    if (rowsOf(to).length === 0) return false;
    try {
      const rows = placeRowsOf(model, rowsOf(to));
      const fresh = newBlockOf(model, rows.loadRowId, rows.partnerRowId);
      return (
        fresh.lessons
          .map((lesson) => lesson.loadRowId)
          .sort()
          .join('|') === rowsOf(to).join('|')
      );
    } catch {
      // A load row the draft no longer has.
      return false;
    }
  });
}

/** The write that takes a step in a direction, by the route of its kind (decision 5). */
export type StepWrite =
  | { readonly route: 'move'; readonly blockId: string; readonly body: MoveRecord }
  | { readonly route: 'swap'; readonly body: SwapRecord }
  | { readonly route: 'room'; readonly blockId: string; readonly body: LessonRoomRecord }
  | { readonly route: 'place'; readonly body: PlaceRecord }
  | { readonly route: 'remove'; readonly blockId: string }
  | { readonly route: 'rearrange'; readonly body: RearrangeRecord };

const slotOf = (state: BlockState) => ({
  weekday: weekdaySchema.parse(state.weekday),
  slotPosition: state.slotPosition,
});

const roomsOf = (state: BlockState) =>
  state.rooms.map((one) => ({ loadRowId: one.loadRowId, roomId: one.roomId }));

/**
 * The write of a step in a direction. The room route names a lesson by its
 * id, read from the board now (`blocks`), so a block placed again since still
 * works. Task 5.4c-3b: a block placed again names its rows as the rule engine
 * builds it (`placeRowsOf` of `model`): both rows of a pairing.
 */
export function writeOf(
  step: Step,
  direction: Direction,
  blocks: readonly PatternBlock[],
  model: PatternModel,
): StepWrite {
  const rowsToPlace = (state: BlockState) => placeRowsOf(model, rowsOf(state));
  const moves = movesOf(step, direction);
  const [first, second] = moves;
  if (first === undefined) throw new Error('A step changes a block.');
  if (step.kind === 'swap' && second?.from != null && first.from !== null) {
    return { route: 'swap', body: { blockIds: [first.from.blockId, second.from.blockId] } };
  }
  // Task 5.4c-3a: the two halves of a double are one step, written by one
  // route on either half: placed again as a double, removed, or moved.
  if (
    second !== undefined &&
    moves.length === 2 &&
    moves.every(({ from, to }) => (from ?? to)?.paired === true) &&
    step.kind !== 'room'
  ) {
    if (first.from === null && second.from === null && first.to !== null && second.to !== null) {
      const [earlier] = [first.to, second.to].sort(
        (a, b) => a.weekday - b.weekday || a.slotPosition - b.slotPosition,
      );
      if (earlier !== undefined) {
        return {
          route: 'place',
          body: {
            ...rowsToPlace(earlier),
            ...slotOf(earlier),
            rooms: roomsOf(earlier),
            double: true,
          },
        };
      }
    }
    if (first.to === null && second.to === null && first.from !== null) {
      return { route: 'remove', blockId: first.from.blockId };
    }
    if (first.from !== null && first.to !== null) {
      return { route: 'move', blockId: first.from.blockId, body: slotOf(first.to) };
    }
  }
  // A room of a double changes both halves through the room route of one.
  if (step.kind === 'room' && first.from !== null && first.to !== null) {
    const from = first.from;
    const changed = first.to.rooms.find(
      (room) => from.rooms.find((one) => one.loadRowId === room.loadRowId)?.roomId !== room.roomId,
    );
    const lesson = blocks
      .find((one) => one.id === from.blockId)
      ?.lessons.find((one) => one.loadRowId === changed?.loadRowId);
    if (changed !== undefined && lesson !== undefined) {
      return {
        route: 'room',
        blockId: from.blockId,
        body: { lessonId: lesson.id, roomId: changed.roomId },
      };
    }
  }
  if (step.kind !== 'suggestion' && moves.length === 1) {
    const { from, to } = first;
    if (to === null && from !== null) return { route: 'remove', blockId: from.blockId };
    if (from === null && to !== null) {
      return {
        route: 'place',
        body: { ...rowsToPlace(to), ...slotOf(to), rooms: roomsOf(to) },
      };
    }
    if (from !== null && to !== null && step.kind === 'move') {
      return { route: 'move', blockId: from.blockId, body: slotOf(to) };
    }
  }
  // An applied suggestion, one step (From 5.4b-2b line): blocks moved back with
  // their rooms, a block it created removed, a block it moved placed again.
  const changes: RearrangeRecord['changes'] = [];
  const remove: string[] = [];
  for (const { from, to } of moves) {
    if (to === null) {
      if (from !== null) remove.push(from.blockId);
    } else if (from === null) {
      changes.push({ ...rowsToPlace(to), ...slotOf(to), rooms: roomsOf(to) });
    } else {
      changes.push({ blockId: from.blockId, ...slotOf(to), rooms: roomsOf(to) });
    }
  }
  return {
    route: 'rearrange',
    body: remove.length === 0 ? { changes } : { changes, remove },
  };
}

/**
 * The ids a write gave to the blocks it placed again: for each block the
 * direction creates, the block of the answer that the board before did not
 * hold, at its slot and with its load rows.
 */
export function placedAgain(
  step: Step,
  direction: Direction,
  before: readonly PatternBlock[],
  after: readonly PatternBlock[],
): { from: string; to: string }[] {
  return movesOf(step, direction).flatMap(({ from, to }) => {
    if (from !== null || to === null) return [];
    const found = after.find(
      (block) =>
        !before.some((one) => one.id === block.id) &&
        block.weekday === to.weekday &&
        block.slotPosition === to.slotPosition &&
        rowsOf(stateOf(block)).join('|') === rowsOf(to).join('|'),
    );
    return found === undefined ? [] : [{ from: to.blockId, to: found.id }];
  });
}

/** The load rows a step names first, for its label. */
export function rowsOfStep(step: Step): string[] {
  const [first] = step.changes;
  const state = first?.before ?? first?.after;
  return state === null || state === undefined ? [] : state.rooms.map((one) => one.loadRowId);
}
