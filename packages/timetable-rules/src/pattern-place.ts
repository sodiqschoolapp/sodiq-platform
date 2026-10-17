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
}

/**
 * The lessons of a block at a weekday and slot position, the minutes read from
 * the template of the lowest grade of its rows; `null` when that day has no
 * slot at the position (a day with no lessons, a position past its end). A
 * break is placed and reported by the engine (`break_slot`).
 */
export function blockPlacements(
  model: PatternModel,
  block: { readonly id: string; readonly lessons: readonly BlockLesson[] },
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
      }),
    ),
  );
}
