import { weekdaySchema, type DraftReadiness, type LoadRow, type PinAnswer } from '@sodiq/shared';
import {
  blockOf,
  checkTimetable,
  isTutorRow,
  pinnedPlacements,
  tutorPinClashes,
  type BlockGroup,
  type PinProblem,
  type PinRow,
  type RuleResult,
} from '@sodiq/timetable-rules';
import type { Transaction } from '../../database/transactions.js';
import { blockRowOf } from './load-blocks.js';
import type { LoadFacts, StoredLoadRow, VersionContext } from './load-facts.js';
import { readPatternFacts } from './pattern-facts.js';

/** A stored pin (db/migrations/0070). */
export interface StoredPin {
  readonly id: string;
  readonly load_row_id: string;
  readonly weekday: number;
  readonly slot_position: number;
}

/** The pins of a version, by id. */
export function readPins(transaction: Transaction, versionId: string): Promise<StoredPin[]> {
  return transaction
    .selectFrom('timetable_pins')
    .select(['id', 'load_row_id', 'weekday', 'slot_position'])
    .where('version_id', '=', versionId)
    .orderBy('id')
    .execute();
}

/** What the pins of a draft give step 5 and the load step (task 5.3b-2). */
export interface PinsCheck {
  readonly ids: string[];
  readonly answers: PinAnswer[];
  /** Every result of the pins checked on their own; `rulesReadiness` keeps the blocked ones. */
  readonly results: RuleResult[];
  readonly problems: PinProblem[];
  /** A result as the answer names it: its rule, weekday and the pins behind its lessons. */
  readonly conflictOf: (result: RuleResult) => DraftReadiness['rules']['conflicts'][number];
  readonly tutorClashes: DraftReadiness['load']['tutorPinClashes'];
}

/** The rows of a version as the pins read them: its lessons per week, mark and block. */
export function pinRowsOf(
  rows: readonly StoredLoadRow[],
  groups: ReadonlyMap<string, BlockGroup>,
): Map<string, PinRow & { readonly stored: StoredLoadRow }> {
  const blockRows = rows.map(blockRowOf);
  return new Map(
    rows.map((row) => {
      const block = row.group_id === null ? [] : blockOf(row.id, blockRows, groups);
      return [
        row.id,
        {
          id: row.id,
          lessonsPerWeek: row.lessons_per_week,
          mixedBlock: row.mixed_block,
          block: block.length === 0 ? [row.id] : block.map((one) => one.id),
          stored: row,
        },
      ];
    }),
  );
}

/**
 * The pins of a draft checked on their own (edge/timetable, Generator and
 * editing: "the locked and pinned lessons are checked on their own";
 * decision 1: among themselves, in this branch), with the facts of the
 * pattern on the dates of 5.3a decision 2.
 */
export async function checkPins(
  transaction: Transaction,
  context: VersionContext,
  rows: readonly StoredLoadRow[],
  load: LoadFacts,
  answers: readonly LoadRow[],
  pins: readonly StoredPin[],
): Promise<PinsCheck> {
  const pinRows = pinRowsOf(rows, load.groups);
  const rowOf = (rowId: string): StoredLoadRow => {
    const row = pinRows.get(rowId)?.stored;
    if (row === undefined) {
      throw new Error('A pin names a row of its version.');
    }
    return row;
  };
  const pattern = await readPatternFacts(transaction, context, rows, load);
  const set = pinnedPlacements({
    pins: pins.map((pin) => ({
      id: pin.id,
      loadRowId: pin.load_row_id,
      weekday: pin.weekday,
      slotPosition: pin.slot_position,
    })),
    rows: pinRows,
    day: (rowId, weekday) => pattern.dayOfRow(rowOf(rowId), weekday),
    placement: (rowId, slot) => pattern.placementOf(rowOf(rowId), slot),
  });
  // The pins among themselves and against the teachers' lessons in other
  // branches (busy elsewhere, task 5.4b-1: the From 5.3b-2 line of 5.4b).
  const placements = [...set.placements, ...pattern.model.fixed];
  const elsewhere = new Set(pattern.model.fixed.map((one) => one.id));
  const results = checkTimetable(placements, pattern.facts);
  const conflictOf = (result: RuleResult) => ({
    rule: result.rule,
    weekday: weekdaySchema.parse(Number(result.day)),
    pinIds: set.pinsOf(result.lessonIds),
    elsewhere: result.lessonIds.some((id) => elsewhere.has(id)),
  });
  const answerOfRow = new Map(answers.map((answer) => [answer.id, answer]));
  return {
    ids: pins.map((pin) => pin.id),
    answers: pins.map((pin) => {
      const row = answerOfRow.get(pin.load_row_id);
      if (row === undefined) {
        throw new Error('A pin names a row of its version.');
      }
      const slot = pattern
        .dayOfRow(rowOf(pin.load_row_id), pin.weekday)
        ?.slots.find((one) => one.position === pin.slot_position);
      return {
        id: pin.id,
        loadRowId: pin.load_row_id,
        unit: row.unit,
        subject: row.subject,
        teacher: row.teacher,
        weekday: weekdaySchema.parse(pin.weekday),
        slotPosition: pin.slot_position,
        time: slot === undefined ? null : { start: slot.start, end: slot.end },
      };
    }),
    results,
    problems: set.problems,
    conflictOf,
    tutorClashes: tutorPinClashes(
      results,
      placements,
      (rowId) => {
        const row = rowOf(rowId);
        const unit = load.units.get(row.class_id ?? row.group_id ?? '');
        const subject = load.subjects.get(row.subject_id);
        return unit !== undefined && subject !== undefined && isTutorRow(unit.unit, subject);
      },
      new Set(
        pattern.data.busyElsewhere.filter((one) => one.tutorLesson).map((one) => one.id),
      ),
    ).map(conflictOf),
  };
}
