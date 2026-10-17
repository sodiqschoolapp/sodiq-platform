/**
 * Lessons of the weekly pattern at a slot (task 5.4a): the one rule that turns
 * a weekday and a slot position into clock minutes, for the grid while
 * dragging, the routes that place, move and swap, and the pins of step 5
 * (`pinnedPlacements`). A block is placed whole (edge/timetable, Structure:
 * "Blocks are placed and moved whole"): every lesson of it takes the slot of
 * the lowest grade of its rows' units; a two-grade group whose other grade has
 * other times is reported by the engine (`two_grade_slot`), never here
 * (decision 9).
 */
import type { Day, DaySlot } from './day.js';
import type { PatternModel, PatternRowData } from './facts-data.js';
import type { Placement } from './placement.js';

/** The slot of a day at a position, breaks counted; `undefined` when the day has none there. */
export function slotAt(day: Day | null, slotPosition: number): DaySlot | undefined {
  return day?.slots.find((slot) => slot.position === slotPosition);
}

/** A lesson of a block: its id, its row and its room. */
export interface BlockLesson {
  readonly id: string;
  readonly loadRowId: string;
  readonly roomId: string | null;
}

/** A block of the pattern with its stored slot and minutes. */
export interface PatternBlock {
  readonly id: string;
  readonly weekday: number;
  readonly slotPosition: number;
  readonly start: number;
  readonly end: number;
  readonly lessons: readonly BlockLesson[];
  /** The pair of a double lesson (`pattern_blocks.double_pair_id`; task 5.4c-3a); `null` for a single lesson. */
  readonly doublePairId: string | null;
}

/**
 * The lessons of a block at a weekday and slot position, the minutes read from
 * the template of the lowest grade of its rows; `null` when that day has no
 * slot at the position (a day with no lessons, a position past its end). A
 * break is placed and reported by the engine (`break_slot`).
 */
export function blockPlacements(
  model: PatternModel,
  block: {
    readonly id: string;
    readonly lessons: readonly BlockLesson[];
    readonly doublePairId?: string | null;
  },
  weekday: number,
  slotPosition: number,
): Placement[] | null {
  const rows: PatternRowData[] = block.lessons.map((one) => model.rowOf(one.loadRowId));
  const slot = slotAt(model.dayOfRows(rows, weekday), slotPosition);
  if (slot === undefined) return null;
  return block.lessons.map((one, index) => {
    const row = rows[index];
    if (row === undefined) {
      throw new Error('blockPlacements: a lesson without its row.');
    }
    return model.placementOf(row, {
      id: one.id,
      blockId: block.id,
      weekday,
      start: slot.start,
      end: slot.end,
      roomId: one.roomId,
      doublePairId: block.doublePairId ?? null,
    });
  });
}

/** The lessons of the stored blocks of a pattern, at their stored minutes. */
export function patternPlacements(
  model: PatternModel,
  blocks: readonly PatternBlock[],
): Placement[] {
  return blocks.flatMap((block) =>
    block.lessons.map((one) =>
      model.placementOf(model.rowOf(one.loadRowId), {
        id: one.id,
        blockId: block.id,
        weekday: block.weekday,
        start: block.start,
        end: block.end,
        roomId: one.roomId,
        doublePairId: block.doublePairId,
      }),
    ),
  );
}

/**
 * Every lesson a check of the pattern counts: the stored blocks and the
 * teachers' lessons in other branches (busy elsewhere, `fixed`; task 5.4b-1).
 * The grid, the routes and the pins' check pass it as the placements of
 * `checkTimetable` and `checkCandidates`; a candidate is never a fixed one.
 */
export function checkedPlacements(
  model: PatternModel,
  blocks: readonly PatternBlock[],
): Placement[] {
  return [...patternPlacements(model, blocks), ...model.fixed];
}

/** The id of a block not placed yet, dragged or placed from the "To place" panel (task 5.4b-2a). */
export const NEW_BLOCK_ID = 'new';

/**
 * The block of a load row not placed yet, as the place route builds it: one
 * lesson per row of its block, each in its row's room, else a class row's
 * main classroom (`roomOfNew`); it sits at no slot until it is placed. The
 * one builder of a new block for the grid, "Suggest a place" and the routes
 * (task 5.4b-2b, review correction 2).
 */
export function newBlockOf(model: PatternModel, rowId: string): PatternBlock {
  return {
    id: NEW_BLOCK_ID,
    weekday: 0,
    slotPosition: 0,
    start: 0,
    end: 0,
    lessons: model.rowOf(rowId).block.map((id) => ({
      id: `new:${id}`,
      loadRowId: id,
      roomId: model.roomOfNew(model.rowOf(id)),
    })),
    doublePairId: null,
  };
}

/** The id of the second half of a double not placed yet (task 5.4c-3a). */
export const NEW_SECOND_HALF_ID = `${NEW_BLOCK_ID}:2`;

/**
 * The two halves of a double lesson of a load row not placed yet (task
 * 5.4c-3a): two blocks of `newBlockOf`, with ids of their own and lesson ids
 * of their own (one id twice would be one lesson to `checkCandidates`), the
 * first half first.
 */
export function newPairOf(model: PatternModel, rowId: string): [PatternBlock, PatternBlock] {
  const first = newBlockOf(model, rowId);
  return [
    { ...first, doublePairId: NEW_BLOCK_ID },
    {
      ...first,
      id: NEW_SECOND_HALF_ID,
      lessons: first.lessons.map((lesson) => ({ ...lesson, id: `new:2:${lesson.loadRowId}` })),
      doublePairId: NEW_BLOCK_ID,
    },
  ];
}

/** The other half of a block of a double among the stored blocks; `undefined` for a single lesson. */
export function otherHalf(
  blocks: readonly PatternBlock[],
  block: PatternBlock,
): PatternBlock | undefined {
  return block.doublePairId === null
    ? undefined
    : blocks.find((one) => one.doublePairId === block.doublePairId && one.id !== block.id);
}

/**
 * A double lesson at a slot (task 5.4c-3a, decisions 4 and 5): `halves` are
 * the two blocks of the pair, the earlier first; the half `movedId` takes the
 * slot and the other takes the next lesson slot of that day when it comes
 * after, the previous one when it comes before ("consecutive lesson slots",
 * a break between them allowed: edge/timetable, Structure). `null` when the
 * day has no slot at the position, the slot is not a lesson slot, or there is
 * no lesson slot beside it.
 */
export function pairAt(
  model: PatternModel,
  halves: readonly [PatternBlock, PatternBlock],
  movedId: string,
  weekday: number,
  slotPosition: number,
): [PatternBlock, PatternBlock] | null {
  const [first, second] = halves;
  const movedFirst = first.id === movedId;
  const rows = first.lessons.map((one) => model.rowOf(one.loadRowId));
  const day = model.dayOfRows(rows, weekday);
  const slot = slotAt(day, slotPosition);
  if (day === null || slot === undefined || slot.lessonNumber === null) return null;
  const wanted = slot.lessonNumber + (movedFirst ? 1 : -1);
  const beside = day.slots.find((one) => one.lessonNumber === wanted);
  if (beside === undefined) return null;
  const [firstSlot, secondSlot] = movedFirst ? [slot, beside] : [beside, slot];
  const at = (block: PatternBlock, to: DaySlot): PatternBlock => ({
    ...block,
    weekday,
    slotPosition: to.position,
    start: to.start,
    end: to.end,
  });
  return [at(first, firstSlot), at(second, secondSlot)];
}
