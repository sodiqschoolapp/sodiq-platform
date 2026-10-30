/**
 * The problem of the timetable solver and the re-check of its answer
 * (docs/spec/06-timetable.md, Auto-generation: "The generator and the grid use
 * one rule engine. Whatever the generator produces is checked again by that
 * engine before it is shown"; task 5.10).
 *
 * The solver (`apps/solver`, Kotlin, Timefold) places lessons; this module
 * tells it where each lesson may go. Every blocked rule that one lesson block
 * can break on its own (the day, the slot, the teacher's profile,
 * availability, statuses, travel time and clashes with busy-elsewhere
 * lessons) is applied here, by the engine itself: a block's options are the
 * slots and rooms where the block, placed alone among the busy-elsewhere
 * lessons, gets no blocked result (decision 2). The solver mirrors only the
 * rules between two lessons of the draft (`SOLVER_PAIR_RULES`, the list of
 * `apps/solver/rules.json`). Its answer becomes pattern placements again
 * (`solvedPlacements`) for `checkTimetable`; doubles are paired there, with
 * the engine's own check of the pair (decision 4).
 */
import type { DaySlot } from './day.js';
import { partnersIn, type PatternModel, type PatternRowData } from './facts-data.js';
import { pinnedPlacements, type Pin, type PinProblem } from './pins.js';
import type { Placement } from './placement.js';
import { PREFERENCES, type Weights } from './preferences.js';
import { candidateChecker, checkTimetable } from './check.js';
import type { FixedRule, RuleResult } from './rules.js';

/** The fixed rules a block's options keep: the engine checks them on each block alone. */
export const SOLVER_OPTION_RULES = [
  'split_apart',
  'day_off',
  'not_working_day',
  'no_template',
  'exam_week',
  'not_a_slot',
  'break_slot',
  'two_grade_slot',
  'teacher_branch',
  'teacher_inactive',
  'teacher_subject',
  'teacher_grade',
  'teacher_language',
  'teacher_unavailable',
  'subject_inactive',
  'room_inactive',
  'travel_time',
  'travel_time_not_set',
] as const satisfies readonly FixedRule[];

/**
 * The fixed rules the solver keeps as hard constraints between two lessons of
 * the draft (`apps/solver/rules.json`). `split_apart` needs none: a lesson's
 * option is always a whole block, or a whole combination of a mixed split.
 */
export const SOLVER_PAIR_RULES = [
  'teacher_double',
  'room_double',
  'room_shared_full',
  'room_shared_capacity',
  'class_double',
  'student_double',
] as const satisfies readonly FixedRule[];

/** The fixed rules kept after solving: a double is made only where the engine accepts the pair. */
export const SOLVER_AFTER_RULES = [
  'double_apart',
  'double_not_allowed',
] as const satisfies readonly FixedRule[];

/** Most room combinations of one block at one slot (decision 9): a block of many groups each with a room type. */
export const MOST_ROOM_COMBINATIONS = 64;

/**
 * Where a lesson may go: a slot of the week and the room of each row it holds,
 * in the order of `rowIds` (the lesson's rows when `null`).
 */
export interface SolverOption {
  readonly weekday: number;
  readonly start: number;
  readonly end: number;
  /** The lesson number of the slot in the day of the block's lowest grade. */
  readonly number: number;
  /** The two rows of a mixed split's combination; `null` for every row of the lesson. */
  readonly rowIds: readonly string[] | null;
  readonly rooms: readonly (string | null)[];
}

export interface SolverRow {
  readonly id: string;
  /** The teacher or the vacancy: one key either way (06, Rules: a vacancy is bound like a teacher). */
  readonly teacherId: string;
  readonly subjectId: string;
  readonly classIds: readonly string[];
  readonly studentIds: readonly string[];
  readonly lessonsPerWeek: number;
  readonly doubleLessons: boolean;
  /** A class row's main classroom when the row names no room or room type (`main_room`); else `null`. */
  readonly mainRoomId: string | null;
}

export interface SolverLesson {
  readonly id: string;
  /** The rows of its block, or every row of its mixed split. */
  readonly rowIds: readonly string[];
  /**
   * The class of a mixed split: the lesson places one combination of two of
   * its rows (`option.rowIds`), and the split's lessons together meet each
   * row's lessons per week; `null` otherwise.
   */
  readonly splitClassId: string | null;
  readonly pinned: boolean;
  readonly options: readonly SolverOption[];
}

export interface SolverProblem {
  readonly rows: readonly SolverRow[];
  readonly lessons: readonly SolverLesson[];
  readonly rooms: readonly {
    readonly id: string;
    readonly shared: boolean;
    readonly lessonsAtOnce: number;
    readonly capacity: number;
  }[];
  readonly classes: readonly { readonly id: string; readonly grade: number }[];
  /** The lesson slots of each grade and weekday that has lessons. */
  readonly days: readonly {
    readonly grade: number;
    readonly weekday: number;
    readonly slots: readonly {
      readonly start: number;
      readonly end: number;
      readonly number: number;
    }[];
  }[];
  readonly partTimeTeacherIds: readonly string[];
  readonly demandingSubjectIds: readonly string[];
  readonly weights: Weights;
  /** The time limit of a run in seconds (06, Auto-generation, Time: 5 minutes). */
  readonly seconds: number;
}

export interface SolverInput {
  readonly pins: readonly Pin[];
  readonly weights: Weights;
  readonly demandingSubjectIds: readonly string[];
  readonly partTimeTeacherIds: readonly string[];
  readonly seconds?: number;
}

/** The solver's answer: the option of each lesson, or `null` for a lesson not placed. */
export interface SolverAnswer {
  readonly lessons: readonly {
    readonly id: string;
    readonly option: {
      readonly weekday: number;
      readonly start: number;
      readonly end: number;
      /** The rows placed, in the order of `rooms`. */
      readonly rowIds: readonly string[];
      readonly rooms: readonly (string | null)[];
    } | null;
  }[];
  readonly score: {
    readonly hard: number;
    readonly medium: number;
    readonly soft: number;
  };
  readonly seconds: number;
  /** Every lesson placed and no hard constraint broken. */
  readonly complete: boolean;
}

/** The pins cannot be solved around: their problems, or the blocked results among themselves. */
export class SolverPinError extends Error {
  constructor(
    readonly problems: readonly PinProblem[],
    readonly blocked: readonly RuleResult[],
  ) {
    super('The pinned lessons cannot be kept: check them on their own first.');
  }
}

export const SOLVER_SECONDS = 300;

const blocked = (results: readonly RuleResult[]) =>
  results.filter((result) => result.severity === 'blocked');

const lessonSlots = (slots: readonly DaySlot[]) =>
  slots.filter((slot): slot is DaySlot & { lessonNumber: number } => slot.lessonNumber !== null);

/** Every combination of one choice from each list, in order, at most `limit`. */
function combinationsOf<T>(lists: readonly (readonly T[])[], limit: number): T[][] {
  let found: T[][] = [[]];
  for (const list of lists) {
    const next: T[][] = [];
    for (const before of found) {
      for (const one of list) {
        if (next.length >= limit) break;
        next.push([...before, one]);
      }
    }
    found = next;
  }
  return found;
}

/** The rooms a row may take (decision 5): its own, the in-use rooms of its type, or a class's main classroom. */
function roomChoices(model: PatternModel, row: PatternRowData): (string | null)[] {
  if (row.roomId !== null) return [row.roomId];
  if (row.roomType !== null) {
    const rooms = model.data.rooms
      .filter((room) => room.type === row.roomType)
      .map((room) => room.id)
      .sort();
    return rooms.length === 0 ? [null] : rooms;
  }
  return [model.roomOfNew(row)];
}

/**
 * The options of a set of rows placed as one block: every lesson slot of the
 * week of their lowest grade and every room combination where the engine
 * finds no blocked result for the block alone among the busy-elsewhere
 * lessons. Rooms are checked per row at the first free slot, then each
 * combination once at that slot (the rules between the block's own rows).
 */
function optionsOf(
  model: PatternModel,
  rows: readonly PatternRowData[],
  check: (candidates: readonly Placement[]) => RuleResult[],
): SolverOption[] {
  const at = (
    weekday: number,
    slot: { start: number; end: number },
    rooms: readonly (string | null)[],
  ) =>
    rows.map((row, index) =>
      model.placementOf(row, {
        id: `option:${row.id}`,
        blockId: 'option',
        weekday,
        start: slot.start,
        end: slot.end,
        roomId: rooms[index] ?? null,
        doublePairId: null,
      }),
    );
  const noRooms = rows.map(() => null);
  const slots: { weekday: number; slot: DaySlot & { lessonNumber: number } }[] = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const day = model.dayOfRows(rows, weekday);
    if (day === null) continue;
    for (const slot of lessonSlots(day.slots)) {
      if (blocked(check(at(weekday, slot, noRooms))).length === 0) {
        slots.push({ weekday, slot });
      }
    }
  }
  const first = slots[0];
  if (first === undefined) return [];
  const choices = rows.map((row, index) =>
    roomChoices(model, row).filter(
      (roomId) =>
        roomId === null ||
        blocked(
          check(
            at(
              first.weekday,
              first.slot,
              noRooms.map((_, i) => (i === index ? roomId : null)),
            ),
          ),
        ).length === 0,
    ),
  );
  const combinations = combinationsOf(choices, MOST_ROOM_COMBINATIONS * 4)
    .filter((rooms) => blocked(check(at(first.weekday, first.slot, rooms))).length === 0)
    .slice(0, MOST_ROOM_COMBINATIONS);
  return slots.flatMap(({ weekday, slot }) =>
    combinations.map((rooms) => ({
      weekday,
      start: slot.start,
      end: slot.end,
      number: slot.lessonNumber,
      rowIds: null,
      rooms,
    })),
  );
}

/** The rows of a split marked mixed, by the class they split; each row's `block` is its whole block. */
function mixedSplits(model: PatternModel): Map<string, PatternRowData[]> {
  const splits = new Map<string, PatternRowData[]>();
  for (const row of model.data.rows) {
    if (!row.mixedBlock || row.groupId === null) continue;
    const classIds = model.unitOf(row.groupId).classIds;
    const classId = classIds.length === 1 ? classIds[0] : undefined;
    if (classId === undefined) continue;
    splits.set(classId, [...(splits.get(classId) ?? []), row]);
  }
  return splits;
}

/**
 * The solver's problem for a draft (task 5.10): its lessons with their
 * options (whole blocks, and whole combinations of mixed splits), and what
 * the preferences read.
 * Throws `SolverPinError` when the pins have a problem or a blocked result
 * among themselves (edge/timetable, Generator and editing: "Before
 * generating, the locked and pinned lessons are checked on their own").
 */
export function solverProblem(model: PatternModel, input: SolverInput): SolverProblem {
  const { data } = model;
  const rowsById = new Map(data.rows.map((row) => [row.id, row]));
  const pinned = pinnedPlacements({
    pins: input.pins,
    rows: rowsById,
    day: (rowId, weekday) => model.dayOfRows([model.rowOf(rowId)], weekday),
    placement: (rowId, slot) => {
      const row = model.rowOf(rowId);
      return model.placementOf(row, { ...slot, roomId: model.roomOfNew(row), doublePairId: null });
    },
  });
  const pinBlocked = blocked(checkTimetable([...model.fixed, ...pinned.placements], model.facts));
  if (pinned.problems.length > 0 || pinBlocked.length > 0) {
    throw new SolverPinError(pinned.problems, pinBlocked);
  }

  const check = candidateChecker(model.fixed, model.facts);
  const lessons: SolverLesson[] = [];
  const splits = mixedSplits(model);
  const mixedIds = new Set([...splits.values()].flat().map((row) => row.id));

  // Blocks of rows that are not mixed halves, in the order of their first row.
  const blocks = new Map<string, PatternRowData[]>();
  for (const row of data.rows) {
    if (mixedIds.has(row.id)) continue;
    const ids = [...row.block].sort();
    const key = ids[0] ?? row.id;
    if (!blocks.has(key))
      blocks.set(
        key,
        ids.map((id) => model.rowOf(id)),
      );
  }
  // The pinned lessons of each block, one per pinned slot (`pinnedPlacements`).
  const pinnedOf = new Map<string, Placement[][]>();
  for (const [blockId, list] of groupBy(pinned.placements, (one) => one.blockId ?? '')) {
    const bySlot = groupBy(list, (one) => `${one.day}:${one.start}`);
    pinnedOf.set(blockId.slice('pin:'.length), [...bySlot.values()]);
  }
  for (const [key, rows] of [...blocks].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const rowIds = rows.map((row) => row.id);
    const pinnedSlots = pinnedOf.get(key) ?? [];
    pinnedSlots.forEach((placements, index) => {
      const firstPlaced = placements[0];
      if (firstPlaced === undefined) return;
      const day = model.dayOfRows(rows, Number(firstPlaced.day));
      const slot = day?.slots.find((one) => one.start === firstPlaced.start);
      lessons.push({
        id: `${key}#pin${index + 1}`,
        rowIds,
        splitClassId: null,
        pinned: true,
        options: [
          {
            weekday: Number(firstPlaced.day),
            start: firstPlaced.start,
            end: firstPlaced.end,
            number: slot?.lessonNumber ?? 0,
            rowIds: null,
            rooms: rowIds.map(
              (rowId) => placements.find((one) => one.loadRowId === rowId)?.roomId ?? null,
            ),
          },
        ],
      });
    });
    const free = (rows[0]?.lessonsPerWeek ?? 0) - pinnedSlots.length;
    if (free <= 0) continue;
    const options = optionsOf(model, rows, check);
    for (let index = 1; index <= free; index += 1) {
      lessons.push({ id: `${key}#${index}`, rowIds, splitClassId: null, pinned: false, options });
    }
  }

  // Mixed splits (task 5.4c-3b): each lesson places one combination of two
  // halves, a whole block or a partner pair, at a time the engine accepts the
  // pair as one block alone (so it covers the class); the split has as many
  // lessons as one half has lessons per week.
  for (const [classId, rows] of [...splits].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const pairs = new Set<string>();
    for (const row of rows) {
      for (const other of [...row.block, ...partnersIn(data, row)]) {
        if (other !== row.id) pairs.add([row.id, other].sort().join('|'));
      }
    }
    const options = [...pairs].sort().flatMap((pair) => {
      const rowIds = pair.split('|');
      return optionsOf(
        model,
        rowIds.map((id) => model.rowOf(id)),
        check,
      ).map((option) => ({ ...option, rowIds }));
    });
    const perHalf = new Map<string, number>();
    for (const row of rows) {
      const half = row.groupId ?? row.id;
      perHalf.set(half, (perHalf.get(half) ?? 0) + row.lessonsPerWeek);
    }
    const count = Math.max(0, ...perHalf.values());
    const rowIds = rows.map((row) => row.id).sort();
    for (let index = 1; index <= count; index += 1) {
      lessons.push({
        id: `split-${classId}#${index}`,
        rowIds,
        splitClassId: classId,
        pinned: false,
        options,
      });
    }
  }

  const grades = new Set<number>();
  const classes: { id: string; grade: number }[] = [];
  for (const unit of data.units) {
    if (unit.kind === 'class') {
      const grade = unit.grades[0];
      if (grade !== undefined) {
        classes.push({ id: unit.id, grade });
        grades.add(grade);
      }
    }
    for (const grade of unit.grades) grades.add(grade);
  }
  const days: SolverProblem['days'][number][] = [];
  for (const grade of [...grades].sort((a, b) => a - b)) {
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const day = model.facts.dayOf(data.branchId, grade, String(weekday));
      if (!day.lessons) continue;
      days.push({
        grade,
        weekday,
        slots: lessonSlots(day.day.slots).map((slot) => ({
          start: slot.start,
          end: slot.end,
          number: slot.lessonNumber,
        })),
      });
    }
  }

  return {
    rows: data.rows.map((row) => {
      const unit = model.unitOf(row.classId ?? row.groupId ?? '');
      return {
        id: row.id,
        teacherId: row.teacherId,
        subjectId: row.subjectId,
        classIds: unit.classIds,
        studentIds: unit.studentIds,
        lessonsPerWeek: row.lessonsPerWeek,
        doubleLessons: row.doubleLessons,
        mainRoomId:
          row.classId !== null && row.roomId === null && row.roomType === null
            ? unit.mainRoomId
            : null,
      };
    }),
    lessons,
    rooms: data.rooms.map((room) => ({
      id: room.id,
      shared: room.shared,
      lessonsAtOnce: room.lessonsAtOnce,
      capacity: room.capacity,
    })),
    classes: classes.sort((a, b) => (a.id < b.id ? -1 : 1)),
    days,
    partTimeTeacherIds: [...input.partTimeTeacherIds].sort(),
    demandingSubjectIds: [...input.demandingSubjectIds].sort(),
    weights: Object.fromEntries(PREFERENCES.map((code) => [code, input.weights[code]])) as Weights,
    seconds: input.seconds ?? SOLVER_SECONDS,
  };
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  return groups;
}

/** The lessons the solver did not place, with their rows (5.11 names the rule with the engine). */
export function notPlaced(
  problem: SolverProblem,
  answer: SolverAnswer,
): { readonly lessonId: string; readonly rowIds: readonly string[] }[] {
  const placed = new Set(answer.lessons.filter((one) => one.option !== null).map((one) => one.id));
  return problem.lessons
    .filter((lesson) => !placed.has(lesson.id))
    .map((lesson) => ({ lessonId: lesson.id, rowIds: lesson.rowIds }));
}

/**
 * The answer as pattern placements, for `checkTimetable` with `model.fixed`:
 * each placed lesson is a block of the rows it holds. Two blocks of one day that hold exactly the same
 * rows, all allowing doubles, are paired when the engine finds no
 * `double_apart` for the pair (consecutive slots, same teacher and room).
 */
export function solvedPlacements(
  model: PatternModel,
  problem: SolverProblem,
  answer: SolverAnswer,
): Placement[] {
  const lessons = new Map(problem.lessons.map((lesson) => [lesson.id, lesson]));
  const blocks = new Map<string, { blockId: string; placements: Placement[] }>();
  for (const one of answer.lessons) {
    const lesson = lessons.get(one.id);
    if (lesson === undefined) {
      throw new Error(`The solver answered a lesson the problem has not: ${one.id}.`);
    }
    if (one.option === null) continue;
    const option = one.option;
    const held = option.rowIds;
    if (
      held.some((rowId) => !lesson.rowIds.includes(rowId)) ||
      (lesson.splitClassId === null && held.length !== lesson.rowIds.length) ||
      held.length !== option.rooms.length
    ) {
      throw new Error(`The solver placed rows lesson ${one.id} does not hold.`);
    }
    const block = { blockId: `solver:${lesson.id}`, placements: [] as Placement[] };
    blocks.set(lesson.id, block);
    held.forEach((rowId, index) => {
      block.placements.push(
        model.placementOf(model.rowOf(rowId), {
          id: `solver:${lesson.id}:${rowId}`,
          blockId: block.blockId,
          weekday: option.weekday,
          start: option.start,
          end: option.end,
          roomId: option.rooms[index] ?? null,
          doublePairId: null,
        }),
      );
    });
  }

  const all = [...blocks.values()];
  const rowsKey = (block: { placements: Placement[] }) =>
    block.placements
      .map((one) => one.loadRowId ?? '')
      .sort()
      .join(',');
  const doubles = all.filter((block) =>
    block.placements.every((one) => model.rowOf(one.loadRowId ?? '').doubleLessons),
  );
  const pairs = new Map<string, string>();
  const byDayRows = groupBy(
    doubles,
    (block) => `${block.placements[0]?.day ?? ''}|${rowsKey(block)}`,
  );
  const placements = all.flatMap((block) => block.placements);
  const checkPair = candidateChecker([...model.fixed, ...placements], model.facts);
  for (const list of byDayRows.values()) {
    const ordered = [...list].sort(
      (a, b) => (a.placements[0]?.start ?? 0) - (b.placements[0]?.start ?? 0),
    );
    for (let index = 0; index + 1 < ordered.length; index += 1) {
      const first = ordered[index];
      const second = ordered[index + 1];
      if (first === undefined || second === undefined) continue;
      if (pairs.has(first.blockId) || pairs.has(second.blockId)) continue;
      const pairId = `pair:${first.blockId}`;
      const candidates = [...first.placements, ...second.placements].map((one) => ({
        ...one,
        doublePairId: pairId,
      }));
      const ids = new Set(candidates.map((one) => one.id));
      const results = checkPair(candidates).filter(
        (result) =>
          (result.rule === 'double_apart' || result.rule === 'double_not_allowed') &&
          result.lessonIds.some((id) => ids.has(id)),
      );
      if (results.length === 0) {
        pairs.set(first.blockId, pairId);
        pairs.set(second.blockId, pairId);
      }
    }
  }
  return placements.map((one) => {
    const pairId = pairs.get(one.blockId ?? '');
    return pairId === undefined ? one : { ...one, doublePairId: pairId };
  });
}
