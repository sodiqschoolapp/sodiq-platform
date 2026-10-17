/**
 * The room of a lesson of the weekly pattern (task 5.4b-2a): the one check
 * of a room change, which the grid's room picker and the route that saves a
 * room both call (06, Editing in the grid: "The room picker lists only rooms
 * that are free in that slot, best fit first"; 14, Timetable, One rule
 * engine).
 *
 * A room is accepted when the lesson in it gives no blocked result that the
 * lesson in its current room does not already have (decision 5): a result that
 * does not come from the room (a stale `teacher_unavailable`, a lesson of the
 * teacher published later in another branch) belongs to the conflict panel
 * and never keeps a lesson out of a free room.
 */
import { checkCandidates } from './check.js';
import type { PatternModel } from './facts-data.js';
import { checkedPlacements, patternPlacements, type PatternBlock } from './pattern-place.js';
import type { RuleResult } from './rules.js';

/** A result keyed by everything that tells two results apart (`.claude/rules/timetable.md`). */
const resultKey = (result: RuleResult): string =>
  [
    result.rule,
    result.day,
    [...result.lessonIds].sort().join(','),
    result.detail === undefined
      ? ''
      : JSON.stringify(
          Object.entries(result.detail).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        ),
  ].join('|');

/** The results of `after` that `before` does not have, compared by their whole key. */
export function addedResults(
  before: readonly RuleResult[],
  after: readonly RuleResult[],
): RuleResult[] {
  const known = new Set(before.map(resultKey));
  return after.filter((result) => !known.has(resultKey(result)));
}

/** What a room gives a lesson: accepted or not, the blocked results it adds, the warnings it adds. */
export interface RoomChange {
  readonly roomId: string;
  readonly accepted: boolean;
  readonly blocked: RuleResult[];
  readonly warnings: RuleResult[];
}

/** The results of one lesson of a block in a room, among the other lessons. */
function lessonResults(
  model: PatternModel,
  all: readonly PatternBlock[],
  block: PatternBlock,
  lessonId: string,
  roomId: string | null,
): RuleResult[] {
  const changed: PatternBlock = {
    ...block,
    lessons: block.lessons.map((one) => (one.id === lessonId ? { ...one, roomId } : one)),
  };
  const candidate = patternPlacements(model, [changed]).find((one) => one.id === lessonId);
  if (candidate === undefined) {
    throw new Error('roomChange: the lesson is not in the block.');
  }
  return checkCandidates(checkedPlacements(model, all), model.facts, [candidate]);
}

/** The lesson `lessonId` of a stored block put in the room `roomId`. */
export function roomChange(
  model: PatternModel,
  all: readonly PatternBlock[],
  block: PatternBlock,
  lessonId: string,
  roomId: string,
): RoomChange {
  const current = block.lessons.find((one) => one.id === lessonId);
  if (current === undefined) {
    throw new Error('roomChange: the lesson is not in the block.');
  }
  const added = addedResults(
    lessonResults(model, all, block, lessonId, current.roomId),
    lessonResults(model, all, block, lessonId, roomId),
  );
  const blocked = added.filter((one) => one.severity === 'blocked');
  return {
    roomId,
    accepted: blocked.length === 0,
    blocked,
    warnings: added.filter((one) => one.severity === 'warning'),
  };
}

/** A room the picker offers, with the warnings it adds. */
export interface RoomChoice {
  readonly roomId: string;
  readonly warnings: RuleResult[];
}

/**
 * The rooms a lesson may be put in, best fit first (decision 4): the row's own
 * room, the rooms of the row's room type, the class's main classroom, the rooms
 * that hold the class or group by the smallest spare capacity, then the rooms
 * that add a warning; ties by `nameOf` (the id when none is given). A room that
 * `roomChange` refuses is left out; the current room is offered with the rest.
 */
export function roomChoices(
  model: PatternModel,
  all: readonly PatternBlock[],
  block: PatternBlock,
  lessonId: string,
  nameOf: (roomId: string) => string = (roomId) => roomId,
): RoomChoice[] {
  const lesson = block.lessons.find((one) => one.id === lessonId);
  if (lesson === undefined) {
    throw new Error('roomChoices: the lesson is not in the block.');
  }
  const row = model.rowOf(lesson.loadRowId);
  const unit = model.unitOf(row.classId ?? row.groupId ?? '');
  const students = unit.studentIds.length;
  const rank = (room: (typeof model.data.rooms)[number], warned: boolean): number => {
    if (room.id === row.roomId) return 0;
    if (row.roomType !== null && room.type === row.roomType) return 1;
    if (row.classId !== null && room.id === unit.mainRoomId) return 2;
    return warned ? 4 : 3;
  };
  return model.data.rooms
    .map((room) => ({ room, change: roomChange(model, all, block, lessonId, room.id) }))
    .filter(({ change }) => change.accepted)
    .map(({ room, change }) => ({
      roomId: room.id,
      warnings: change.warnings,
      rank: rank(room, change.warnings.length > 0),
      spare: room.capacity - students,
      name: nameOf(room.id),
    }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.rank === 3 ? a.spare - b.spare : 0) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    )
    .map(({ roomId, warnings }) => ({ roomId, warnings }));
}
