/**
 * Pinned lessons (docs/spec/06-timetable.md, Building a timetable, step 5:
 * "pins lessons that must stay at a fixed time (for example the Homework slot
 * at the end of the day)"; edge/timetable.md, Generator and editing: "Before
 * generating, the locked and pinned lessons are checked on their own. A
 * blocked conflict stops the run and lists the lessons."; task 5.3b-2).
 *
 * A pin is a load row, a weekday and a slot position of the day template
 * (breaks included, as `pattern_blocks.slot_position`), with no time of its
 * own: its time is read from the template in force on each check (decision
 * 2). A pin of a group row holds its whole block in that slot (edge/timetable,
 * Structure: "Blocks are placed and moved whole"; decision 4); the rows of a
 * split marked mixed block meet in different slots and are not pinned here.
 */
import type { Day } from './day.js';
import type { Placement } from './placement.js';
import type { RuleResult } from './rules.js';

/** The problems of a pin that give the engine nothing to check, in their order. */
export const PIN_PROBLEMS = ['pin_no_slot', 'pin_over_load', 'pin_mixed_block'] as const;

export type PinProblemCode = (typeof PIN_PROBLEMS)[number];

export interface PinProblem {
  readonly pinId: string;
  readonly problem: PinProblemCode;
}

export interface Pin {
  readonly id: string;
  readonly loadRowId: string;
  /** ISO weekday, 1 Monday to 7 Sunday. */
  readonly weekday: number;
  /** The position of the slot in the day template, breaks included (1 is the first slot). */
  readonly slotPosition: number;
}

/** A load row as the pins read it. */
export interface PinRow {
  readonly id: string;
  readonly lessonsPerWeek: number;
  readonly mixedBlock: boolean;
  /** The ids of the rows of its block, the row included (`blockOf`); the row alone for a class row. */
  readonly block: readonly string[];
}

/** Where a pinned block sits: the id and block of one of its lessons and its clock times. */
export interface PinSlot {
  readonly id: string;
  readonly blockId: string;
  readonly weekday: number;
  readonly start: number;
  readonly end: number;
}

export interface PinnedLessons {
  /** One lesson per row of each pinned block and slot, as `placement` builds it. */
  readonly placements: Placement[];
  /** By pin, in the order of `PIN_PROBLEMS`, then of the pins' ids. */
  readonly problems: PinProblem[];
  /** The pins that put these lessons where they are, sorted: what a result of the check names. */
  readonly pinsOf: (lessonIds: readonly string[]) => string[];
}

const byId = (a: { readonly id: string }, b: { readonly id: string }) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * The pins of a draft as pattern placements, for `checkTimetable` on their
 * own. `day` is the day of the row's lowest grade on the weekday (the template
 * in force, `placement.ts`), `null` when the grade has no lessons that weekday;
 * `placement` builds a row's lesson at a slot. A pin of a row not in `rows`
 * throws: a caller's fault, never a free slot.
 */
export function pinnedPlacements(input: {
  readonly pins: readonly Pin[];
  readonly rows: ReadonlyMap<string, PinRow>;
  readonly day: (rowId: string, weekday: number) => Day | null;
  readonly placement: (rowId: string, slot: PinSlot) => Placement;
}): PinnedLessons {
  const rowOf = (rowId: string): PinRow => {
    const row = input.rows.get(rowId);
    if (row === undefined) {
      throw new Error(`pinnedPlacements: no row ${rowId}`);
    }
    return row;
  };
  const problems: PinProblem[] = [];
  // The pinned slots of each block: block key -> slot key -> the pins.
  const slots = new Map<string, Map<string, Pin[]>>();
  for (const pin of [...input.pins].sort(byId)) {
    const row = rowOf(pin.loadRowId);
    if (row.mixedBlock) {
      problems.push({ pinId: pin.id, problem: 'pin_mixed_block' });
      continue;
    }
    const blockKey = [...row.block].sort()[0] ?? row.id;
    const slotKey = `${pin.weekday}:${pin.slotPosition}`;
    const block = slots.get(blockKey) ?? new Map<string, Pin[]>();
    slots.set(blockKey, block);
    block.set(slotKey, [...(block.get(slotKey) ?? []), pin]);
  }

  const placements: Placement[] = [];
  const pinsOfLesson = new Map<string, string[]>();
  for (const [blockKey, block] of slots) {
    for (const [slotKey, pins] of block) {
      const [first] = pins;
      if (first === undefined) continue;
      const row = rowOf(first.loadRowId);
      const slot = input
        .day(row.id, first.weekday)
        ?.slots.find((one) => one.position === first.slotPosition);
      if (slot === undefined) {
        for (const pin of pins) problems.push({ pinId: pin.id, problem: 'pin_no_slot' });
        continue;
      }
      const ids = pins.map((pin) => pin.id);
      for (const rowId of [...row.block].sort()) {
        const id = `pin:${blockKey}:${slotKey}:${rowId}`;
        pinsOfLesson.set(id, ids);
        placements.push(
          input.placement(rowId, {
            id,
            blockId: `pin:${blockKey}`,
            weekday: first.weekday,
            start: slot.start,
            end: slot.end,
          }),
        );
      }
    }
    // A block is placed whole, so its lessons are counted once per slot over
    // the pins of all its rows (edge/timetable, Versions and drafts: "More
    // lessons than the load also blocks"; decision 5).
    for (const pins of block.values()) {
      for (const pin of pins) {
        if (block.size > rowOf(pin.loadRowId).lessonsPerWeek) {
          problems.push({ pinId: pin.id, problem: 'pin_over_load' });
        }
      }
    }
  }

  const rank = new Map<PinProblemCode, number>(PIN_PROBLEMS.map((code, index) => [code, index]));
  problems.sort(
    (a, b) =>
      (rank.get(a.problem) ?? 0) - (rank.get(b.problem) ?? 0) ||
      (a.pinId < b.pinId ? -1 : a.pinId > b.pinId ? 1 : 0),
  );
  return {
    placements,
    problems,
    pinsOf: (lessonIds) =>
      [...new Set(lessonIds.flatMap((id) => pinsOfLesson.get(id) ?? []))].sort(),
  };
}

/**
 * edge/timetable, Structure, the Homework slot row: "A Tutor of two classes
 * cannot have both pinned at the same time; the load step lists this." The
 * `teacher_double` results of the pins' check whose lessons are all Tutor rows
 * (`isTutorRow`) of two classes or more.
 */
export function tutorPinClashes(
  results: readonly RuleResult[],
  placements: readonly Placement[],
  tutorRow: (rowId: string) => boolean,
): RuleResult[] {
  const byLesson = new Map(placements.map((one) => [one.id, one]));
  return results.filter((result) => {
    if (result.rule !== 'teacher_double') return false;
    const lessons = result.lessonIds.map((id) => byLesson.get(id));
    const classes = new Set(lessons.map((one) => one?.classId ?? null));
    return (
      lessons.every(
        (one) => one !== undefined && one.loadRowId !== null && tutorRow(one.loadRowId),
      ) &&
      !classes.has(null) &&
      classes.size > 1
    );
  });
}
