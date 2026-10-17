/**
 * "Suggest a place" (docs/spec/06-timetable.md, Editing in the grid:
 * "'Suggest a place' on a selected lesson shows the best free slots, or a swap
 * of two or three lessons that makes room for it"; task 5.4b-2b, pull request
 * #134).
 *
 * The block is tried on every lesson slot of its own template on every
 * weekday that has lessons, by clock time (`blockPlacements`). Every trial is
 * the check the routes run on a write: `checkCandidates` of the changed blocks
 * among `checkedPlacements` (review finding 1), so an error elsewhere in the
 * draft never hides a suggestion, and what is offered is what the server
 * accepts. A block moves whole (edge/timetable, Structure).
 *
 * - Free slots (decision 2): no blocked result, then fewest warnings (the week
 *   counts left out, as the drag marks), then the slots that keep their rooms,
 *   then weekday and slot; at most `FREE_SHOWN`. A slot blocked by room rules
 *   alone is offered with the first room `roomChoices` gives each lesson a
 *   room rule names (the From 5.4b-2a line of the task).
 * - Rearrangements (decision 3), only when no slot is free: the blocks of this
 *   draft that block a slot are moved to slots of their own templates, at most
 *   three blocks in all with the selected one; a block holding a pin of step 5
 *   (decision 9) and a lesson of another branch (decision 6) are never moved.
 * - Locks (task 5.4c-1, decision 8): a block a lock holds (`lockedBy`) is
 *   never moved, as the selected block or as a blocker, and no block is moved
 *   into a locked day.
 *   Fewer blocks first, then fewer warnings; at most `REARRANGEMENTS_SHOWN`.
 *
 * The search stops after `SUGGEST_BUDGET` checks (decision 4) and returns what
 * it found.
 */
import { checkCandidates } from './check.js';
import type { PatternModel } from './facts-data.js';
import {
  blockPlacements,
  checkedPlacements,
  NEW_BLOCK_ID,
  patternPlacements,
  type PatternBlock,
} from './pattern-place.js';
import { lockedBy, type PatternLock } from './locks.js';
import type { Pin } from './pins.js';
import { roomChoices } from './rooms-pick.js';
import { WEEK_COUNT_RULES, type RuleCode, type RuleResult } from './rules.js';

export const SUGGEST_BUDGET = 2000;
export const FREE_SHOWN = 5;
export const REARRANGEMENTS_SHOWN = 3;
/** The selected block and at most two others ("a swap of two or three lessons"). */
export const MOST_BLOCKS_CHANGED = 3;

/** The blocked rules a room alone raises: another room can make the slot free. */
export const ROOM_RULES: readonly RuleCode[] = [
  'room_double',
  'room_shared_full',
  'room_shared_capacity',
  'room_inactive',
];

/** One block of a suggestion: where it is now (`null` for a new block) and where it goes. */
export interface SuggestedChange {
  readonly from: PatternBlock | null;
  readonly to: PatternBlock;
}

export interface Suggestion {
  /** The selected block first. */
  readonly changes: readonly SuggestedChange[];
  /** The warnings of the changed blocks' lessons, the week counts left out. */
  readonly warnings: readonly RuleResult[];
  /** A lesson of the selected block changes its room. */
  readonly roomChanged: boolean;
}

export interface Suggestions {
  readonly free: Suggestion[];
  readonly rearrangements: Suggestion[];
  /** The budget ran out before every slot was tried. */
  readonly cutShort: boolean;
  /** The selected block is held by a lock: nothing is searched (task 5.4c-1). */
  readonly locked: boolean;
}

export interface SuggestOptions {
  /** The pins of step 5: a block holding one at its slot is never moved as a blocker. */
  readonly pins?: readonly Pick<Pin, 'loadRowId' | 'weekday' | 'slotPosition'>[];
  /** The locks of the draft (task 5.4c-1): a block they hold stays where it is. */
  readonly locks?: readonly PatternLock[];
  readonly budget?: number;
}

class OutOfBudget extends Error {}

/** The block at every lesson slot of its own template, weekday by weekday, slot by slot. */
function slotsOf(model: PatternModel, block: PatternBlock): PatternBlock[] {
  const rows = block.lessons.map((one) => model.rowOf(one.loadRowId));
  const found: PatternBlock[] = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    for (const slot of model.dayOfRows(rows, weekday)?.slots ?? []) {
      if (slot.kind !== 'lesson') continue;
      const [first] = blockPlacements(model, block, weekday, slot.position) ?? [];
      if (first === undefined) continue;
      found.push({
        ...block,
        weekday,
        slotPosition: slot.position,
        start: first.start,
        end: first.end,
      });
    }
  }
  return found;
}

const sameSlot = (a: PatternBlock, b: PatternBlock) =>
  a.weekday === b.weekday && a.slotPosition === b.slotPosition;

const counted = (results: readonly RuleResult[]) =>
  results.filter((one) => one.severity === 'warning' && !WEEK_COUNT_RULES.includes(one.rule));

export function suggestPlaces(
  model: PatternModel,
  all: readonly PatternBlock[],
  block: PatternBlock,
  options: SuggestOptions = {},
): Suggestions {
  const budget = options.budget ?? SUGGEST_BUDGET;
  let spent = 0;
  const isNew = block.id === NEW_BLOCK_ID;
  const from = isNew ? null : block;
  const placements = checkedPlacements(model, all);
  const spend = (checks: number) => {
    if (spent + checks > budget) throw new OutOfBudget();
    spent += checks;
  };
  const check = (changed: readonly PatternBlock[]): RuleResult[] => {
    spend(1);
    return checkCandidates(placements, model.facts, patternPlacements(model, changed));
  };
  const blockedOf = (results: readonly RuleResult[]) =>
    results.filter((one) => one.severity === 'blocked');
  const locks = options.locks ?? [];
  /** A lock holds the block where it is, or keeps it out of the cell's weekday. */
  const held = (one: PatternBlock, to?: PatternBlock) => lockedBy(model, locks, one, to).length > 0;
  // A new block of a locked class or teacher is held too: nothing places it.
  if (held(block)) {
    return { free: [], rearrangements: [], cutShort: false, locked: true };
  }

  // A lesson of the draft's stored blocks, by id, for the blockers of a slot.
  const blockOfLesson = new Map<string, PatternBlock>();
  for (const one of all) {
    for (const lesson of one.lessons) blockOfLesson.set(lesson.id, one);
  }
  const pinned = (one: PatternBlock) =>
    (options.pins ?? []).some(
      (pin) =>
        pin.weekday === one.weekday &&
        pin.slotPosition === one.slotPosition &&
        one.lessons.some((lesson) => lesson.loadRowId === pin.loadRowId),
    );
  /**
   * The other blocks the blocked results name, when moving them can clear the
   * slot: every blocked result names a lesson of a movable block of this
   * draft; `null` when one does not (a rule of the changed blocks alone, a
   * lesson of another branch, a pinned block, a block already changed).
   */
  const blockersOf = (
    blocked: readonly RuleResult[],
    changed: readonly PatternBlock[],
  ): PatternBlock[] | null => {
    const changedIds = new Set(changed.map((one) => one.id));
    const found = new Map<string, PatternBlock>();
    for (const result of blocked) {
      const named = result.lessonIds
        .map((id) => blockOfLesson.get(id))
        .filter((one): one is PatternBlock => one !== undefined && !changedIds.has(one.id));
      if (named.length === 0 || named.some(pinned) || named.some((one) => held(one))) return null;
      for (const one of named) found.set(one.id, one);
    }
    return [...found.values()];
  };

  const free: Suggestion[] = [];
  const rearrangements: Suggestion[] = [];
  const cells = slotsOf(model, block).filter(
    (one) => (from === null || !sameSlot(one, from)) && !held(block, one),
  );
  const blockedCells: { cell: PatternBlock; blocked: RuleResult[] }[] = [];
  let cutShort = false;
  try {
    for (const cell of cells) {
      const results = check([cell]);
      const blocked = blockedOf(results);
      if (blocked.length === 0) {
        free.push({
          changes: [{ from, to: cell }],
          warnings: counted(results),
          roomChanged: false,
        });
        continue;
      }
      blockedCells.push({ cell, blocked });
      if (!blocked.every((one) => ROOM_RULES.includes(one.rule))) continue;
      const roomed = withFreeRooms(cell, blocked);
      if (roomed === null) continue;
      const again = check([roomed]);
      if (blockedOf(again).length === 0) {
        free.push({ changes: [{ from, to: roomed }], warnings: counted(again), roomChanged: true });
      }
    }
    if (free.length === 0) rearrange();
  } catch (error) {
    if (!(error instanceof OutOfBudget)) throw error;
    cutShort = true;
  }

  return {
    free: free
      .map((one, index) => ({ one, index }))
      .sort(
        (a, b) =>
          a.one.warnings.length - b.one.warnings.length ||
          Number(a.one.roomChanged) - Number(b.one.roomChanged) ||
          a.index - b.index,
      )
      .slice(0, FREE_SHOWN)
      .map(({ one }) => one),
    rearrangements: rearrangements
      .map((one, index) => ({ one, index }))
      .sort(
        (a, b) =>
          a.one.changes.length - b.one.changes.length ||
          a.one.warnings.length - b.one.warnings.length ||
          a.index - b.index,
      )
      .slice(0, REARRANGEMENTS_SHOWN)
      .map(({ one }) => one),
    cutShort,
    locked: false,
  };

  /**
   * The block at the cell with another room for each lesson a room rule names,
   * lesson by lesson, each choice made with the earlier ones in place (review
   * finding 5); `null` when one has no other room.
   */
  function withFreeRooms(cell: PatternBlock, blocked: readonly RuleResult[]): PatternBlock | null {
    let current = cell;
    let still = blocked;
    for (const lesson of cell.lessons) {
      // A lesson whose room an earlier choice freed keeps it.
      if (!still.some((one) => one.lessonIds.includes(lesson.id))) continue;
      const others = [...all.filter((one) => one.id !== cell.id), current];
      spend(model.data.rooms.length * 2);
      const choice = roomChoices(model, others, current, lesson.id).find(
        (one) => one.roomId !== lesson.roomId,
      );
      if (choice === undefined) return null;
      current = {
        ...current,
        lessons: current.lessons.map((one) =>
          one.id === lesson.id ? { ...one, roomId: choice.roomId } : one,
        ),
      };
      still = blockedOf(check([current]));
    }
    return current;
  }

  /** The cells of a blocker, the one with the clock time the selected block leaves first (a plain swap). */
  function cellsOfBlocker(blocker: PatternBlock): PatternBlock[] {
    const cellsOf = slotsOf(model, blocker).filter(
      (one) => !sameSlot(one, blocker) && !held(blocker, one),
    );
    if (from === null) return cellsOf;
    const swap = cellsOf.findIndex(
      (one) => one.weekday === from.weekday && one.start === from.start && one.end === from.end,
    );
    return swap < 0
      ? cellsOf
      : [cellsOf[swap] as PatternBlock, ...cellsOf.filter((_, i) => i !== swap)];
  }

  function found(changed: readonly PatternBlock[], results: readonly RuleResult[]): void {
    const before = new Map(all.map((one) => [one.id, one]));
    rearrangements.push({
      changes: changed.map((to) => ({ from: before.get(to.id) ?? null, to })),
      warnings: counted(results),
      roomChanged: false,
    });
  }

  /** Two blocks, then three, until `REARRANGEMENTS_SHOWN` are found. */
  function rearrange(): void {
    const chains: { cell: PatternBlock; moved: PatternBlock; next: PatternBlock }[] = [];
    const pairs: { cell: PatternBlock; blockers: [PatternBlock, PatternBlock] }[] = [];
    for (const { cell, blocked } of blockedCells) {
      const blockers = blockersOf(blocked, [cell]);
      if (blockers === null) continue;
      const [first, second, ...rest] = blockers;
      if (first === undefined || rest.length > 0) continue;
      if (second !== undefined) {
        pairs.push({ cell, blockers: [first, second] });
        continue;
      }
      for (const moved of cellsOfBlocker(first)) {
        const results = check([cell, moved]);
        const still = blockedOf(results);
        if (still.length === 0) {
          found([cell, moved], results);
          continue;
        }
        const next = blockersOf(still, [cell, moved]);
        if (next?.length === 1 && next[0] !== undefined) {
          chains.push({ cell, moved, next: next[0] });
        }
      }
    }
    if (rearrangements.length >= REARRANGEMENTS_SHOWN) return;
    // Three blocks: a blocker moved onto a slot another block holds, that one moved on.
    for (const { cell, moved, next } of chains) {
      for (const third of cellsOfBlocker(next)) {
        const results = check([cell, moved, third]);
        if (blockedOf(results).length === 0) {
          found([cell, moved, third], results);
          break;
        }
      }
      if (rearrangements.length >= REARRANGEMENTS_SHOWN) return;
    }
    // Three blocks: the two blockers of one slot both moved.
    for (const { cell, blockers } of pairs) {
      const [a, b] = blockers;
      for (const movedA of cellsOfBlocker(a)) {
        const after = blockedOf(check([cell, movedA]));
        if (after.some((one) => !one.lessonIds.some((id) => b.lessons.some((l) => l.id === id)))) {
          continue;
        }
        let done = false;
        for (const movedB of cellsOfBlocker(b)) {
          const results = check([cell, movedA, movedB]);
          if (blockedOf(results).length === 0) {
            found([cell, movedA, movedB], results);
            done = true;
            break;
          }
        }
        if (done) break;
      }
      if (rearrangements.length >= REARRANGEMENTS_SHOWN) return;
    }
  }
}
