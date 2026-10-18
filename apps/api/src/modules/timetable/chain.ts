import { createHash } from 'node:crypto';
import type { PublishRefusal, RuleResultAnswer } from '@sodiq/shared';
import {
  addDays,
  carryInto,
  checkTimetable,
  checkedPlacements,
  publishRefusals,
  type CarriedInto,
  type CarryChange,
  type CarryVersion,
  type DatedPattern,
} from '@sodiq/timetable-rules';
import type { Transaction } from '../../database/transactions.js';
import { datedCheck, type DatedFindings } from './dated-check.js';
import type { StoredLoadRow } from './load-facts.js';
import { withRunEnd } from './pattern-facts.js';
import type { PatternState } from './pattern.service.js';
import { resultAnswerOf } from './rule-answers.js';
import type { VersionRow } from './timetable.service.js';

/**
 * The chain of published versions (task 5.5a-3a, pull request #145;
 * `edge/timetable`, Versions and drafts: "Published versions form a chain
 * ordered by start date. Publishing before an already published later
 * version asks: 'run until that version starts', 'replace the versions that
 * follow', or — offered only when the new version differs from the version it
 * started from in nothing but the teachers or rooms of entries — 'carry the
 * change into them'").
 */

/** A published version of the year that starts on or after a start date. */
export interface LaterVersion {
  readonly id: string;
  readonly number: number;
  readonly starts_on: string;
}

/** The published versions of the draft's branch and year starting on or after `startsOn`, in start order. */
export function laterVersionsOf(
  transaction: Transaction,
  version: VersionRow,
  startsOn: string,
): Promise<LaterVersion[]> {
  return transaction
    .selectFrom('timetable_versions')
    .select(['id', 'number', 'starts_on'])
    .where('branch_id', '=', version.branch_id)
    .where('academic_year_id', '=', version.academic_year_id)
    .where('status', '=', 'published')
    .where('starts_on', '>=', startsOn)
    .orderBy('starts_on')
    .orderBy('number')
    .execute();
}

/**
 * The key of the later versions shown (spec review of the plan, should-fix
 * 2): the SHA-256 of the draft, the start and the ids, so a replace never
 * archives a version the person was not shown.
 */
export function laterKeyOf(
  versionId: string,
  startsOn: string,
  later: readonly LaterVersion[],
): string {
  return createHash('sha256')
    .update(JSON.stringify({ versionId, startsOn, later: later.map((one) => one.id) }))
    .digest('hex');
}

/** The day a version starting at `index` of the chain runs until: the day before the next start, else the year's end. */
export function runEndOf(later: readonly LaterVersion[], index: number, yearEnd: string): string {
  const next = later[index];
  return next === undefined ? yearEnd : addDays(next.starts_on, -1);
}

/** A state that runs until `end` (the facts and the dated checks follow). */
export function runningUntil(state: PatternState, end: string): PatternState {
  return { ...state, pattern: withRunEnd(state.pattern, end) };
}

/** The rows and entries of a state, as the carry comparison reads them (decision 4). */
export function carryVersionOf(state: PatternState): CarryVersion {
  const tutorSubjects = new Set(
    state.pattern.model.data.subjects.filter((one) => one.tutorSubject).map((one) => one.id),
  );
  return {
    rows: state.rows.map((row) => ({
      id: row.id,
      classId: row.class_id,
      groupId: row.group_id,
      subjectId: row.subject_id,
      teacherId: row.teacher_id,
      roomId: row.room_id,
      lessonsPerWeek: row.lessons_per_week,
      roomType: row.room_type,
      doubleLessons: row.double_lessons,
      mixedBlock: row.mixed_block,
      shortReason: row.short_reason ?? null,
      tutorRow: row.class_id !== null && tutorSubjects.has(row.subject_id),
    })),
    entries: state.blocks.flatMap((block) =>
      block.lessons.map((lesson) => ({
        id: lesson.id,
        loadRowId: lesson.loadRowId,
        weekday: block.weekday,
        slotPosition: block.slotPosition,
        roomId: lesson.roomId,
      })),
    ),
  };
}

/** What a carry would do to one later version: its changes, its check, and whether it is left as it is. */
export interface CarryResult {
  readonly version: LaterVersion;
  readonly into: CarriedInto;
  readonly left: boolean;
  readonly refusals: PublishRefusal[];
  /** The version's lessons over its run before and after the change (the preview, decision 7). */
  readonly before: DatedPattern | null;
  readonly after: DatedPattern | null;
  /**
   * The version as the carry changes it, over its run, with its dated check:
   * what its dated lessons are written from (task 5.5b-1, spec review
   * must-fix 4); `null` when nothing applies.
   */
  readonly written: {
    readonly state: PatternState;
    readonly findings: DatedFindings;
    readonly lastDate: string;
  } | null;
}

/** How a carry reads a version's state, its rows changed, and the load problems of its rows. */
export interface CarryReader {
  stateOf(version: VersionRow, rows?: StoredLoadRow[]): Promise<PatternState>;
  versionRow(id: string): Promise<VersionRow>;
  loadProblems(
    version: VersionRow,
    rows: StoredLoadRow[],
  ): Promise<{ id: string; problems: readonly string[] }[]>;
}

const keyOf = (one: RuleResultAnswer): string => JSON.stringify(one);

/**
 * The carry into one later version (decision 8, review correction 2): the
 * changes it still has the before value of, checked by the rule engine in
 * memory over its own run, before anything is written. It is left as it is
 * when a change brings a blocked result of its pattern or of a date, or a
 * load problem of a changed row, that the unchanged version does not have.
 */
export async function carryResultOf(
  transaction: Transaction,
  reader: CarryReader,
  later: LaterVersion,
  runEnd: string,
  changes: readonly CarryChange[],
): Promise<CarryResult> {
  const row = await reader.versionRow(later.id);
  const unchanged = runningUntil(await reader.stateOf(row), runEnd);
  const into = carryInto(carryVersionOf(unchanged), changes);
  if (into.applied.length === 0) {
    return {
      version: later,
      into,
      left: false,
      refusals: [],
      before: null,
      after: null,
      written: null,
    };
  }
  const rowChanges = new Map(into.rows.map((one) => [one.id, one]));
  const rows = unchanged.rows.map((one) => {
    const change = rowChanges.get(one.id);
    return change === undefined
      ? one
      : { ...one, teacher_id: change.teacherId, room_id: change.roomId };
  });
  const roomOf = new Map(into.entries.map((one) => [one.id, one.roomId]));
  const read = runningUntil(await reader.stateOf(row, rows), runEnd);
  const changed: PatternState = {
    ...read,
    blocks: read.blocks.map((block) => ({
      ...block,
      lessons: block.lessons.map((lesson) =>
        roomOf.has(lesson.id) ? { ...lesson, roomId: roomOf.get(lesson.id) ?? null } : lesson,
      ),
    })),
  };

  const refusals: PublishRefusal[] = [];
  const problemsBefore = await reader.loadProblems(row, unchanged.rows);
  const problemsAfter = await reader.loadProblems(row, rows);
  for (const one of problemsAfter) {
    if (!rowChanges.has(one.id)) continue;
    const was = new Set(problemsBefore.find((other) => other.id === one.id)?.problems ?? []);
    for (const problem of one.problems) {
      if (!was.has(problem)) {
        refusals.push({
          code: 'load_problem',
          loadRowId: one.id,
          problem: problem as NonNullable<PublishRefusal['problem']>,
        });
      }
    }
  }
  const blockedOf = (state: PatternState) =>
    publishRefusals(
      checkTimetable(
        checkedPlacements(state.pattern.model, state.blocks),
        state.pattern.model.facts,
      ),
    ).blocked;
  const patternBefore = blockedOf(unchanged);
  const patternAfter = blockedOf(changed);
  const known = new Set(patternBefore.map((one) => keyOf(resultAnswerOf(one))));
  for (const result of patternAfter) {
    const answer = resultAnswerOf(result);
    if (!known.has(keyOf(answer))) {
      refusals.push({ code: 'pattern_blocked', result: answer });
    }
  }
  const datedBefore = await datedCheck(transaction, unchanged, later.starts_on, patternBefore);
  const datedAfter = await datedCheck(transaction, changed, later.starts_on, patternAfter);
  const knownDated = new Set(datedBefore.blocked.map(keyOf));
  for (const result of datedAfter.blocked) {
    if (!knownDated.has(keyOf(result))) {
      refusals.push({ code: 'date_blocked', result });
    }
  }
  return {
    version: later,
    into,
    left: refusals.length > 0,
    refusals,
    before: datedBefore.dated,
    after: datedAfter.dated,
    written: { state: changed, findings: datedAfter, lastDate: runEnd },
  };
}
