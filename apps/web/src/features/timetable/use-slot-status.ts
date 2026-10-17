import type { GridAnswer } from '@sodiq/shared';
import {
  blockPlacements,
  checkCandidates,
  checkedPlacements,
  patternPlacements,
  slotStatus,
  WEEK_COUNT_RULES,
  type PatternBlock,
  type PatternModel,
  type RuleResult,
  type SlotStatus,
} from '@sodiq/timetable-rules';
import { useMemo } from 'react';

/**
 * The board of one class in the grid of step 7 (task 5.4a, decision 3): the
 * weekdays that have lessons, the lesson slots of the class's template down,
 * and the blocks that occupy the class (review correction 2: a block of
 * groups that draw from the class is on its board too). A cell holds the
 * blocks that meet its slot by clock time.
 */
export interface BoardCell {
  readonly weekday: number;
  readonly position: number;
  readonly start: number;
  readonly end: number;
}

export interface Board {
  readonly weekdays: number[];
  readonly positions: number[];
  readonly cellAt: (weekday: number, position: number) => BoardCell | null;
  readonly blocksAt: (cell: BoardCell) => PatternBlock[];
  readonly blocks: PatternBlock[];
}

export const cellKey = (cell: { weekday: number; position: number }) =>
  `${String(cell.weekday)}:${String(cell.position)}`;

/** The blocks of the answer as the rule engine reads them. */
export const blocksOf = (grid: GridAnswer): PatternBlock[] => grid.blocks;

export function boardOf(grid: GridAnswer, model: PatternModel, classId: string): Board {
  const grade = grid.classes.find((one) => one.id === classId)?.grade;
  const cells = new Map<string, BoardCell>();
  const weekdays: number[] = [];
  const positions = new Set<number>();
  for (const one of grid.facts.days) {
    if (one.grade !== grade || !one.day.lessons) continue;
    let any = false;
    for (const slot of one.day.day.slots) {
      if (slot.kind !== 'lesson') continue;
      any = true;
      positions.add(slot.position);
      cells.set(cellKey({ weekday: one.weekday, position: slot.position }), {
        weekday: one.weekday,
        position: slot.position,
        start: slot.start,
        end: slot.end,
      });
    }
    if (any) weekdays.push(one.weekday);
  }
  const occupies = (block: PatternBlock) =>
    block.lessons.some((lesson) => {
      const row = model.rowOf(lesson.loadRowId);
      return model.unitOf(row.classId ?? row.groupId ?? '').classIds.includes(classId);
    });
  const blocks = blocksOf(grid).filter(occupies);
  return {
    weekdays: weekdays.sort((a, b) => a - b),
    positions: [...positions].sort((a, b) => a - b),
    cellAt: (weekday, position) => cells.get(cellKey({ weekday, position })) ?? null,
    blocksAt: (cell) =>
      blocks.filter(
        (block) =>
          block.weekday === cell.weekday && block.start < cell.end && cell.start < block.end,
      ),
    blocks,
  };
}

/**
 * The position of the slot of a block's own template that has the times of a
 * cell (a two-grade group on the board of its other grade): `null` when it has
 * none, which the engine would refuse.
 */
export function positionFor(
  model: PatternModel,
  block: Pick<PatternBlock, 'lessons'>,
  cell: BoardCell,
): number | null {
  const rows = block.lessons.map((lesson) => model.rowOf(lesson.loadRowId));
  const slot = model
    .dayOfRows(rows, cell.weekday)
    ?.slots.find((one) => one.start === cell.start && one.end === cell.end);
  return slot?.position ?? null;
}

/** A block at the slot of a cell, with its minutes; `null` when its template has no such slot. */
function blockAt(model: PatternModel, block: PatternBlock, cell: BoardCell): PatternBlock | null {
  const position = positionFor(model, block, cell);
  if (position === null) return null;
  const [first] = blockPlacements(model, block, cell.weekday, position) ?? [];
  return first === undefined
    ? null
    : {
        ...block,
        weekday: cell.weekday,
        slotPosition: position,
        start: first.start,
        end: first.end,
      };
}

/** What dropping a block on a cell does: a move, a swap with the block there, or nothing. */
export type Drop =
  | { readonly kind: 'move'; readonly block: PatternBlock; readonly to: PatternBlock }
  | {
      readonly kind: 'swap';
      readonly block: PatternBlock;
      readonly other: PatternBlock;
      readonly changed: readonly [PatternBlock, PatternBlock];
    }
  | { readonly kind: 'same' }
  | { readonly kind: 'no_slot' };

export function dropOf(
  model: PatternModel,
  board: Board,
  block: PatternBlock,
  cell: BoardCell,
): Drop {
  const other = board.blocksAt(cell).find((one) => one.id !== block.id);
  if (other === undefined) {
    if (block.weekday === cell.weekday && block.start < cell.end && cell.start < block.end) {
      return { kind: 'same' };
    }
    const to = blockAt(model, block, cell);
    return to === null ? { kind: 'no_slot' } : { kind: 'move', block, to };
  }
  const from: BoardCell = {
    weekday: block.weekday,
    position: block.slotPosition,
    start: block.start,
    end: block.end,
  };
  const movedBlock = blockAt(model, block, cell);
  const movedOther = blockAt(model, other, from);
  return movedBlock === null || movedOther === null
    ? { kind: 'no_slot' }
    : { kind: 'swap', block, other, changed: [movedBlock, movedOther] };
}

/** What a cell shows while a block is dragged: free, warning or blocked, with the first rule. */
export interface CellStatus {
  readonly status: SlotStatus;
  /** The rule named (the first blocked, else the first warning); `null` with no rule or no slot. */
  readonly rule: string | null;
  readonly drop: Drop;
}

/**
 * The status of a cell for a block dropped there: the results of the changed
 * blocks' lessons by `checkCandidates`, the check the server runs on the save
 * (decision 5; 14, Timetable, One rule engine).
 */
export function cellStatus(
  model: PatternModel,
  board: Board,
  all: readonly PatternBlock[],
  block: PatternBlock,
  cell: BoardCell,
): CellStatus {
  const drop = dropOf(model, board, block, cell);
  if (drop.kind === 'same') return { status: 'free', rule: null, drop };
  if (drop.kind === 'no_slot') return { status: 'blocked', rule: null, drop };
  const changed = drop.kind === 'move' ? [drop.to] : drop.changed;
  const results: RuleResult[] = checkCandidates(
    checkedPlacements(model, all),
    model.facts,
    patternPlacements(model, changed),
  ).filter((one) => !WEEK_COUNT_RULES.includes(one.rule));
  const status = slotStatus(results);
  const first =
    results.find((one) => one.severity === 'blocked') ??
    results.find((one) => one.severity === 'warning');
  return { status, rule: first?.rule ?? null, drop };
}

/** The status of every cell of the board for the block being moved; empty while none is. */
export function useSlotStatuses(
  model: PatternModel | null,
  board: Board | null,
  all: readonly PatternBlock[],
  moving: PatternBlock | null,
): Map<string, CellStatus> {
  return useMemo(() => {
    const statuses = new Map<string, CellStatus>();
    if (model === null || board === null || moving === null) return statuses;
    for (const weekday of board.weekdays) {
      for (const position of board.positions) {
        const cell = board.cellAt(weekday, position);
        if (cell !== null) {
          statuses.set(cellKey(cell), cellStatus(model, board, all, moving, cell));
        }
      }
    }
    return statuses;
  }, [model, board, all, moving]);
}
