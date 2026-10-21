import { randomUUID } from 'node:crypto';
import type { LeftBlock, LeftBlockReason } from '@sodiq/shared';
import {
  blockPlacements,
  checkCandidates,
  patternPlacements,
  type LoadProblem,
  type PatternBlock,
  type PatternModel,
  type RuleCode,
} from '@sodiq/timetable-rules';
import type { Transaction } from '../../database/transactions.js';
import { LoadFacts, type StoredLoadRow, type VersionContext } from './load-facts.js';
import { readPatternFacts } from './pattern-facts.js';
import { readBlocks, writeBlock } from './pattern-queries.js';

/**
 * The weekly pattern of a version copied into a new draft (task 5.8a, pull
 * request #194; 5.5a-3a decision 4: every copy takes its pattern).
 *
 * docs/spec/edge-cases/timetable.md, Versions and drafts: "'Restore an
 * earlier version' always means copy it to a new draft; entries whose
 * teacher, room, subject or class is no longer active go to the 'to place'
 * list." Structure: blocks "are placed and moved whole"; double lessons "are
 * moved, cancelled and substituted together".
 *
 * Plan rules 3 to 6 (decisions 7 and 8): each source block is rebuilt at its
 * weekday and slot position on the draft's model, the minutes of the template
 * in force on the draft's `statusOn`; a block is left whole with the first
 * reason that applies, and the two halves of a double are decided together.
 * Only the clashes the pattern constraints of 0058 refuse are checked, among
 * the copied blocks; availability, busy elsewhere and warnings are the
 * conflict panel's.
 */

/** The rule results that mean "the slot is not a lesson slot on that date for these grades". */
const SLOT_RULES: readonly RuleCode[] = [
  'not_a_slot',
  'break_slot',
  'two_grade_slot',
  'no_template',
  'not_working_day',
];

/** The rule results the pattern constraints of 0058 also refuse (one place at a time). */
const CLASH_RULES: readonly RuleCode[] = [
  'teacher_double',
  'room_double',
  'room_shared_full',
  'class_double',
  'student_double',
];

/** What `planPatternCopy` decides: the blocks to write (rows still the source's) and those left. */
export interface PatternCopy {
  readonly blocks: readonly PatternBlock[];
  readonly left: readonly LeftBlock[];
}

/** The source row a lesson of a block names, with the problems the copy left it with. */
interface SourceRow {
  readonly row: StoredLoadRow;
  readonly problems: readonly LoadProblem[] | null;
}

/**
 * Decides the copy of the source's pattern before the draft is written (the
 * draft's left blocks are written once, with its row: 0104). `copied` holds
 * the rows the copy keeps under their source ids (with a Tutor row's new
 * teacher), `left` the rows it leaves with their problems.
 */
export async function planPatternCopy(
  transaction: Transaction,
  context: VersionContext,
  sourceId: string,
  sourceRows: readonly StoredLoadRow[],
  copied: readonly StoredLoadRow[],
  left: ReadonlyMap<string, readonly LoadProblem[]>,
): Promise<PatternCopy> {
  const sourceBlocks = await readBlocks(transaction, sourceId);
  if (sourceBlocks.length === 0) {
    return { blocks: [], left: [] };
  }
  const load = await LoadFacts.of(transaction, context, copied, { versionRows: [...copied] });
  const { model } = await readPatternFacts(transaction, context, copied, load);
  const byId = new Map<string, SourceRow>();
  for (const row of sourceRows) {
    byId.set(row.id, { row, problems: left.get(row.id) ?? null });
  }
  for (const row of copied) {
    byId.set(row.id, { row, problems: null });
  }

  const placed: PatternBlock[] = [];
  const leftBlocks: LeftBlock[] = [];
  const done = new Set<string>();
  for (const block of sourceBlocks) {
    if (done.has(block.id)) continue;
    const unit =
      block.doublePairId === null
        ? [block]
        : sourceBlocks.filter((one) => one.doublePairId === block.doublePairId);
    for (const one of unit) done.add(one.id);
    const pairId = block.doublePairId === null ? null : randomUUID();
    const reasons = new Map<string, LeftBlockReason>();
    const built: PatternBlock[] = [];
    for (const one of unit) {
      const reason = ownReason(model, byId, one);
      if (reason !== null) {
        reasons.set(one.id, reason);
        continue;
      }
      const at = blockPlacements(model, one, one.weekday, one.slotPosition);
      const [first] = at ?? [];
      if (first === undefined) {
        reasons.set(one.id, 'copy_slot_missing');
        continue;
      }
      built.push({ ...one, doublePairId: pairId, start: first.start, end: first.end });
    }
    if (reasons.size === 0) {
      const results = checkCandidates(
        patternPlacements(model, placed),
        model.facts,
        patternPlacements(model, built),
      ).filter((result) => result.severity === 'blocked');
      for (const half of built) {
        const own = new Set(half.lessons.map((lesson) => lesson.id));
        const mine = results.filter((result) => result.lessonIds.some((id) => own.has(id)));
        if (mine.some((result) => SLOT_RULES.includes(result.rule))) {
          reasons.set(half.id, 'copy_slot_missing');
        } else if (mine.some((result) => CLASH_RULES.includes(result.rule))) {
          reasons.set(half.id, 'copy_clash');
        }
      }
    }
    if (reasons.size === 0) {
      placed.push(...built);
      continue;
    }
    for (const one of unit) {
      leftBlocks.push(leftOf(byId, one, reasons.get(one.id) ?? 'copy_pair_left'));
    }
  }
  return { blocks: placed, left: leftBlocks };
}

/** The first reason of rule 4 a block meets by its rows and rooms alone; `null` when none. */
function ownReason(
  model: PatternModel,
  byId: ReadonlyMap<string, SourceRow>,
  block: PatternBlock,
): LeftBlockReason | null {
  for (const lesson of block.lessons) {
    const problems = byId.get(lesson.loadRowId)?.problems;
    if (problems !== null && problems !== undefined) {
      return problems[0] ?? 'copy_part_left';
    }
  }
  for (const lesson of block.lessons) {
    // The engine's reading of a room no longer in use (`room_inactive`).
    if (lesson.roomId !== null && model.facts.rooms.get(lesson.roomId)?.status === 'closed') {
      return 'copy_room_inactive';
    }
  }
  return null;
}

/** A block left by the copy as `left_blocks` keeps it: each lesson with its row and own reason. */
function leftOf(
  byId: ReadonlyMap<string, SourceRow>,
  block: PatternBlock,
  reason: LeftBlockReason,
): LeftBlock {
  return {
    sourceBlockId: block.id,
    weekday: block.weekday,
    slotPosition: block.slotPosition,
    reason,
    lessons: block.lessons.map((lesson) => {
      const source = byId.get(lesson.loadRowId);
      if (source === undefined) {
        throw new Error('A lesson of the source names a row of the source.');
      }
      const ownProblem = source.problems === null ? null : (source.problems[0] ?? null);
      return {
        sourceRowId: source.row.id,
        copied: source.problems === null,
        classId: source.row.class_id,
        groupId: source.row.group_id,
        subjectId: source.row.subject_id,
        teacherId: source.row.teacher_id,
        roomId: lesson.roomId,
        reason: ownProblem ?? (reason.startsWith('load_') ? 'copy_part_left' : reason),
      };
    }),
  };
}

/**
 * Writes the blocks decided by `planPatternCopy` in the new draft, each load
 * row named by its copy (`rowIds`, source id to new id).
 */
export async function writePatternCopy(
  transaction: Transaction,
  version: { readonly id: string; readonly branch_id: string },
  copy: PatternCopy,
  rows: ReadonlyMap<string, { readonly id: string; readonly teacherId: string }>,
): Promise<number> {
  const rowOf = (id: string) => {
    const found = rows.get(id);
    if (found === undefined) throw new Error('A copied block names a copied row.');
    return found;
  };
  const teachers = new Map([...rows.values()].map((one) => [one.id, one.teacherId]));
  const teacherOf = (id: string): string => {
    const found = teachers.get(id);
    if (found === undefined) throw new Error('A copied block names a copied row.');
    return found;
  };
  for (const block of copy.blocks) {
    await writeBlock(
      transaction,
      version,
      { rowOf: (id: string) => ({ teacherId: teacherOf(id) }) },
      {
        ...block,
        lessons: block.lessons.map((lesson) => ({
          ...lesson,
          loadRowId: rowOf(lesson.loadRowId).id,
        })),
      },
    );
  }
  return copy.blocks.length;
}
