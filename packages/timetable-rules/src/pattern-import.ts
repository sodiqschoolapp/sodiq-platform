/**
 * The lessons of a timetable import placed as the grid places them (task 5.14; `06`, Importing
 * the load and the timetable, The timetable import): "The groups of one block and the halves of a
 * split are placed in the same slot, as in the grid; a block given only in part is a problem of
 * its rows. Two rows of one double lesson are two consecutive slots of a load row that allows
 * doubles." One row of the file is one lesson: a load row of the draft at a weekday and a lesson
 * number of the day. This module groups them into the blocks the grid would build (`newBlockOf`:
 * a whole block, or a mixed half with one partner, `pairingOf`), turns the lesson number into the
 * slot of the block's day (`dayOfRows`, the template of the lowest grade, as `blockPlacements`),
 * and pairs doubles. It checks no rule of a placed timetable: the caller runs `checkTimetable` on
 * the blocks, so every clash is the engine's.
 */
import type { PatternModel } from './facts-data.js';
import { pairingOf, type BlockLesson, type PatternBlock } from './pattern-place.js';

/** A lesson of the file: its row number (`key`), its load row, weekday and lesson number. */
export interface ImportLesson {
  readonly key: number;
  readonly rowId: string;
  readonly weekday: number;
  readonly lessonNumber: number;
  /** The room the file names; `undefined` for none (the grid's room of a new lesson). */
  readonly roomId?: string;
}

/**
 * A row of the file held back by another problem whose load row and time are known: it counts
 * as present when the blocks of its slot are grouped, so its partners are never told a part
 * they have (plan decision 12), and nothing is placed for its block.
 */
export interface ImportHeld {
  readonly rowId: string;
  readonly weekday: number;
  readonly lessonNumber: number;
}

export type ImportPlacementProblem =
  | {
      readonly key: number;
      readonly code: 'pattern_import_block_part';
      /** The rows of the block with no lesson of the file in that slot. */
      readonly missingRowIds: readonly string[];
    }
  | { readonly key: number; readonly code: 'pattern_import_no_slot' };

/** A block of the file at its slot, with the row number of each of its lessons (in order). */
export interface ImportedBlock {
  readonly block: PatternBlock;
  readonly keys: readonly number[];
}

/** The id of the lesson of a file row while it is checked. */
export const importLessonId = (key: number): string => `import:${String(key)}`;

/** The row number of a lesson of `importLessonId`; `null` for any other lesson. */
export function importKeyOf(lessonId: string): number | null {
  const match = /^import:(\d+)$/.exec(lessonId);
  return match === null ? null : Number(match[1]);
}

/** The pair id a double of the file is checked under; the caller writes a stored id in its place. */
export const importPairId = (n: number): string => `import-pair:${String(n)}`;

const slotKey = (weekday: number, lessonNumber: number) =>
  `${String(weekday)}|${String(lessonNumber)}`;

/**
 * The blocks of the file's lessons, and the problems of rows that cannot be placed: a block given
 * only in part in a slot (`pattern_import_block_part`, on every lesson of it present there), or a
 * weekday and lesson number the block's day does not have (`pattern_import_no_slot`). Each load
 * row is expected at most once per slot (the caller refuses a repeat first).
 */
export function importedBlocks(
  model: PatternModel,
  lessons: readonly ImportLesson[],
  held: readonly ImportHeld[] = [],
): { blocks: ImportedBlock[]; problems: ImportPlacementProblem[] } {
  const problems: ImportPlacementProblem[] = [];
  const presentIn = new Map<string, Set<string>>();
  const lessonsIn = new Map<string, ImportLesson[]>();
  for (const one of [...lessons, ...held]) {
    const key = slotKey(one.weekday, one.lessonNumber);
    const present = presentIn.get(key) ?? new Set<string>();
    present.add(one.rowId);
    presentIn.set(key, present);
  }
  for (const one of lessons) {
    const key = slotKey(one.weekday, one.lessonNumber);
    lessonsIn.set(key, [...(lessonsIn.get(key) ?? []), one]);
  }
  const grouped: { weekday: number; lessonNumber: number; members: ImportLesson[] }[] = [];
  for (const [key, inSlot] of lessonsIn) {
    const present = presentIn.get(key) ?? new Set<string>();
    const heldHere = new Set(
      held.filter((one) => slotKey(one.weekday, one.lessonNumber) === key).map((one) => one.rowId),
    );
    const taken = new Set<string>();
    const byRow = new Map(inSlot.map((one) => [one.rowId, one]));
    // Whole blocks first, then the pairings of mixed halves, so the grouping does not depend on
    // the order of the rows (spec review of the code, should-fix 1): a block one of whose rows a
    // pairing would take is never grouped as whole after it.
    for (const one of inSlot) {
      if (taken.has(one.rowId)) continue;
      const block = model.rowOf(one.rowId).block;
      if (!block.every((id) => present.has(id) && !taken.has(id))) continue;
      for (const id of block) taken.add(id);
      // A part held back for another problem: nothing of the block is placed.
      if (block.some((id) => heldHere.has(id))) continue;
      grouped.push({
        weekday: one.weekday,
        lessonNumber: one.lessonNumber,
        members: block.map((id) => byRow.get(id)).filter((m): m is ImportLesson => !!m),
      });
    }
    for (const one of inSlot) {
      if (taken.has(one.rowId)) continue;
      // A mixed half with exactly one partner in the slot: their pairing (task 5.4c-3b).
      const partners = [...present].filter(
        (id) => id !== one.rowId && !taken.has(id) && pairingOf(model, [one.rowId, id]) !== null,
      );
      const [partner] = partners;
      if (partner === undefined || partners.length !== 1) continue;
      const pair = pairingOf(model, [one.rowId, partner]) ?? [one.rowId, partner];
      taken.add(one.rowId);
      taken.add(partner);
      if (pair.some((id) => heldHere.has(id))) continue;
      grouped.push({
        weekday: one.weekday,
        lessonNumber: one.lessonNumber,
        members: pair.map((id) => byRow.get(id)).filter((m): m is ImportLesson => !!m),
      });
    }
    for (const one of inSlot) {
      if (taken.has(one.rowId)) continue;
      const block = model.rowOf(one.rowId).block;
      problems.push({
        key: one.key,
        code: 'pattern_import_block_part',
        missingRowIds: block.filter((id) => !present.has(id)),
      });
    }
  }
  // Each block at its slot: the lesson number on the day of its rows' lowest grade.
  const placed: { block: PatternBlock; keys: number[]; lessonNumber: number }[] = [];
  for (const group of grouped) {
    const rows = group.members.map((one) => model.rowOf(one.rowId));
    const day = model.dayOfRows(rows, group.weekday);
    const slot = day?.slots.find((one) => one.lessonNumber === group.lessonNumber);
    if (slot === undefined) {
      for (const one of group.members)
        problems.push({ key: one.key, code: 'pattern_import_no_slot' });
      continue;
    }
    const lessonsOfBlock: BlockLesson[] = group.members.map((one, index) => ({
      id: importLessonId(one.key),
      loadRowId: one.rowId,
      roomId: one.roomId ?? model.roomOfNew(rows[index] ?? model.rowOf(one.rowId)),
    }));
    const [first] = group.members;
    placed.push({
      block: {
        id: `import-block:${String(first?.key ?? 0)}`,
        weekday: group.weekday,
        slotPosition: slot.position,
        start: slot.start,
        end: slot.end,
        lessons: lessonsOfBlock,
        doublePairId: null,
      },
      keys: group.members.map((one) => one.key),
      lessonNumber: group.lessonNumber,
    });
  }
  // Doubles: blocks of one row set on one day, in consecutive lesson numbers, every row allowing
  // doubles, paired from the earliest; a third stays single (plan decision 5).
  const runs = new Map<string, typeof placed>();
  for (const one of placed) {
    const rowIds = one.block.lessons.map((lesson) => lesson.loadRowId);
    if (!rowIds.every((id) => model.rowOf(id).doubleLessons)) continue;
    const key = `${String(one.block.weekday)}|${[...rowIds].sort().join(',')}`;
    runs.set(key, [...(runs.get(key) ?? []), one]);
  }
  const pairOf = new Map<(typeof placed)[number], string>();
  let pairs = 0;
  for (const run of runs.values()) {
    run.sort((a, b) => a.lessonNumber - b.lessonNumber);
    for (let at = 0; at + 1 < run.length; at += 1) {
      const a = run[at];
      const b = run[at + 1];
      if (a === undefined || b === undefined || b.lessonNumber !== a.lessonNumber + 1) continue;
      pairs += 1;
      pairOf.set(a, importPairId(pairs));
      pairOf.set(b, importPairId(pairs));
      at += 1;
    }
  }
  const blocks = placed
    .sort((a, b) => (a.keys[0] ?? 0) - (b.keys[0] ?? 0))
    .map((one) => ({
      block: { ...one.block, doublePairId: pairOf.get(one) ?? null },
      keys: one.keys,
    }));
  problems.sort((a, b) => a.key - b.key);
  return { blocks, problems };
}
