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
export function blockAt(
  model: PatternModel,
  block: PatternBlock,
  cell: BoardCell,
): PatternBlock | null {
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

/** The id of a block not placed yet, dragged or placed from the "To place" panel (task 5.4b-2a). */
export const NEW_BLOCK_ID = 'new';

/**
 * The block of a load row not placed yet, as the place route builds it: one
 * lesson per row of its block, each in its row's room, else a class row's
 * main classroom (`roomOfNew`); it sits at no slot until it is dropped.
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
  };
}

/** What dropping a block on a cell does: a move, a swap with the block there, a place of a new block, or nothing. */
export type Drop =
  | { readonly kind: 'move'; readonly block: PatternBlock; readonly to: PatternBlock }
  | { readonly kind: 'place'; readonly block: PatternBlock; readonly to: PatternBlock }
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
  if (block.id === NEW_BLOCK_ID) {
    // A new block is placed beside whatever is there; the engine names a clash.
    const to = blockAt(model, block, cell);
    return to === null ? { kind: 'no_slot' } : { kind: 'place', block, to };
  }
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
  const changed = drop.kind === 'swap' ? drop.changed : [drop.to];
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

/** A lesson of another branch in a teacher's view (06, Busy elsewhere): grey, never moved from here. */
export type ElsewhereLesson = GridAnswer['facts']['busyElsewhere'][number];

/** A row of a clock axis: a span of clock minutes. */
export interface ClockRow {
  readonly start: number;
  readonly end: number;
}

/**
 * A view by teacher or by room on a clock axis (task 5.4b-1, decision 6;
 * edge/timetable, Structure: "Teacher and room views use a clock axis when
 * more than one template is in force"): the weekdays that have lessons, and
 * one row for each distinct span of the lesson slots of the grades involved
 * and of the lessons shown, in the order of their start, so that a 40-minute
 * and a 45-minute lesson that overlap sit in rows by their real times.
 */
export interface ClockBoard {
  readonly weekdays: number[];
  readonly rows: ClockRow[];
  readonly blocksAt: (weekday: number, row: ClockRow) => PatternBlock[];
  readonly elsewhereAt: (weekday: number, row: ClockRow) => ElsewhereLesson[];
}

const spanKey = (span: ClockRow) => `${String(span.start)}-${String(span.end)}`;

export function clockBoardOf(
  grid: GridAnswer,
  model: PatternModel,
  shows: { readonly lesson: (lesson: PatternBlock['lessons'][number]) => boolean },
  elsewhere: readonly ElsewhereLesson[],
  grades: readonly number[],
): ClockBoard {
  const blocks = blocksOf(grid).filter((block) => block.lessons.some(shows.lesson));
  const shownGrades = new Set([
    ...grades,
    ...blocks.flatMap((block) =>
      block.lessons.flatMap((lesson) => {
        const row = model.rowOf(lesson.loadRowId);
        return model.unitOf(row.classId ?? row.groupId ?? '').grades;
      }),
    ),
  ]);
  const spans = new Map<string, ClockRow>();
  const weekdays = new Set<number>();
  const add = (weekday: number, span: ClockRow) => {
    spans.set(spanKey(span), { start: span.start, end: span.end });
    weekdays.add(weekday);
  };
  for (const one of grid.facts.days) {
    if (!shownGrades.has(one.grade) || !one.day.lessons) continue;
    for (const slot of one.day.day.slots) {
      if (slot.kind === 'lesson') add(one.weekday, slot);
    }
  }
  for (const block of blocks) add(block.weekday, block);
  for (const lesson of elsewhere) add(lesson.weekday, lesson);
  const at = (weekday: number, row: ClockRow) => (span: { weekday: number } & ClockRow) =>
    span.weekday === weekday && span.start === row.start && span.end === row.end;
  return {
    weekdays: [...weekdays].sort((a, b) => a - b),
    rows: [...spans.values()].sort((a, b) => a.start - b.start || a.end - b.end),
    blocksAt: (weekday, row) => blocks.filter(at(weekday, row)),
    elsewhereAt: (weekday, row) => elsewhere.filter(at(weekday, row)),
  };
}
