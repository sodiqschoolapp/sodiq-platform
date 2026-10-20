import { createHash } from 'node:crypto';
import {
  addDays,
  checkCandidates,
  patternIdOf,
  weekdayOf,
  type DatedLesson,
  type Placement,
  type RuleResult,
} from '@sodiq/timetable-rules';
import {
  weekdaySchema,
  type DayChangeChoice,
  type DayChangeItemAnswer,
  type RuleResultAnswer,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import type { BulkHold } from './bulk-cancels-kept.js';
import { dayBeginnings, type DatedFindings } from './dated-check.js';
import { patternDateOf, placeKeyOf } from './dated-lessons.js';
import type { PatternState } from './pattern.service.js';
import { examsOn } from './stored-day.js';

/**
 * The stored one-day changes of the dates a publish writes, applied again
 * (task 5.6a-5a, pull request #164; `edge/timetable`, Versions and drafts: "A
 * substitution and a one-day move are already recorded for a date after the
 * new version starts. One-day changes, absences, room closures and exams are
 * stored on their own and applied again after a publish. The preview sorts
 * them into kept, needs a decision and dropped. Publish waits until every
 * 'needs a decision' item is settled.").
 *
 * A room change or move is the chain of a lesson's `lesson_day_changes` rows
 * (0085) with no end (0087), from its oldest row's "from" to its newest row's
 * "to" (decision 4); the chains changed by one request (the same newest
 * moment and person) are one item: the parts of a moved block, both halves of
 * a double. A one-day cancel of cause `reason` on one lesson is listed too
 * (decision 11); a lesson a bulk cancel covers is left to 5.6a-5b.
 *
 * The sorting (the plan's table):
 * - a room change is kept when the new version has the lesson at the same
 *   place and the changed room passes the rules there; dropped when the new
 *   version has no such lesson or gives it that room itself;
 * - a move with both places in the run is kept when the new version has the
 *   moved lessons at the old place, one block of exactly them, and they pass
 *   the rules at the new place; it needs a decision when the block differs;
 *   dropped when the new version has none of them;
 * - a move to a date outside the run is kept: that date is not written, and
 *   the new version's lessons at the old place are left out, so the lesson is
 *   not held twice (decision 7);
 * - a move from a date outside the run keeps its stored block under its
 *   version when it passes the rules at its new place among the new version's
 *   lessons (decision 7);
 * - a kept change that meets a blocked rule needs a decision. The check is
 *   the engine's on the date, with the dated check's facts, the claims of
 *   other branches and the branch's exams; availability on a date of a later
 *   entry is a warning (`availabilityFrom` the start); warnings move nothing.
 *   The oldest change is checked first, each against the older ones kept
 *   (decision 6).
 *
 * Task 5.6b-2c-2: a calendar save writes each stretch of its dates on its
 * own (`across`). A move between two of its stretches is sorted once, as its
 * two halves: kept when its new place takes it (the check of a move from a
 * date outside the run); otherwise needs a decision in both halves, and the
 * half of the old place holds the lesson there, so the choice acts on it.
 */

const MINUTE = 60_000;

/** A stored lesson's date, class or group and times, as a template change reads them. */
export interface StoredLessonTimes {
  readonly lesson_date: string;
  readonly class_id: string | null;
  readonly group_id: string | null;
  readonly starts_at: Date;
  readonly ends_at: Date;
}

/**
 * Task 5.6b-4b: a change of the day templates moves the times of the lessons
 * of the dates it writes, by their lesson number in the day (5.6b-4a decision
 * 4). Its stored one-day changes and bulk cancels are already at the new
 * times (`TemplateLessons`, 0092); the stored lessons still hold the old ones
 * until the write, so every reader of a stored lesson's times in the sorting
 * reads them through `of`.
 */
export interface StoredRetime {
  /** The new times of a stored lesson; its own when its date is not written or its number is gone. */
  readonly of: (lesson: StoredLessonTimes) => { readonly starts_at: Date; readonly ends_at: Date };
  /** The stored change rows whose new side has no slot of its lesson number after the change. */
  readonly unplaced: ReadonlySet<string>;
}

/** The lesson with its times through `retime`, when one is given. */
export function retimed<T extends StoredLessonTimes>(
  lesson: T,
  retime: StoredRetime | undefined,
): T {
  if (retime === undefined) return lesson;
  const times = retime.of(lesson);
  return times.starts_at.getTime() === lesson.starts_at.getTime() &&
    times.ends_at.getTime() === lesson.ends_at.getTime()
    ? lesson
    : { ...lesson, starts_at: times.starts_at, ends_at: times.ends_at };
}

export type DayCategory = 'kept' | 'decide' | 'dropped';

/** A stored one-day change as sorted, with what the write needs. */
export interface SortedDayChange {
  readonly answer: DayChangeItemAnswer;
  readonly category: DayCategory;
  /** Every `lesson_day_changes` row of its chains, ended when it is not applied. */
  readonly changeIds: readonly string[];
  /** The new version's lessons at the old place, by chain lesson. */
  readonly matched: ReadonlyMap<string, DatedLesson>;
  /** The chains' lessons cancelled with a reason, by lesson id: their reasons. */
  readonly cancelledParts: ReadonlyMap<string, string>;
  /** A move from outside the run: the stored lessons it keeps. */
  readonly storedIds: readonly string[];
  readonly chains: readonly Chain[];
  /**
   * Task 5.6b-2c-2: the half of a move between two stretches of one calendar
   * save this stretch holds (its old place or its new place), `null` otherwise.
   */
  readonly half: 'old_place' | 'new_place' | null;
}

/** What the write of a publish does with the sorted changes and their decisions. */
export interface DayWritePlan {
  /** The new version's lessons written cancelled with cause `reason`, by `placeKeyOf`: the reason. */
  readonly cancels: ReadonlyMap<string, string>;
  /** Stored lessons the write leaves as they are (a move from outside the run). */
  readonly keepStored: ReadonlySet<string>;
  /** Of those, the ones written cancelled with cause `reason`: the reason. */
  readonly cancelStored: ReadonlyMap<string, string>;
  /**
   * Task 5.6a-5b-1: the new version's lessons a bulk cancel applied again
   * cancels, by `placeKeyOf`: the reason, written only on a lesson the write
   * creates (decision 4); a lesson it keeps keeps its stored state.
   */
  readonly bulkCancels: ReadonlyMap<string, string>;
  /**
   * Task 5.6a-5b-1 (review of the code, round 1): the parts of the other
   * classes of a block decided `keep`, by `placeKeyOf`: a stored lesson there
   * cancelled by that bulk cancel is held (`BulkHold`).
   */
  readonly bulkHolds: ReadonlyMap<string, BulkHold>;
}

/** The sorting of the dates of one write. */
export interface DaySorting {
  readonly items: readonly SortedDayChange[];
  /** The findings with every kept change applied: what the preview and the write read. */
  readonly findings: DatedFindings;
  /** The stored lessons a kept move from outside the run keeps, for the preview's "after" side. */
  readonly keptStoredIds: ReadonlySet<string>;
  /** Task 5.6a-5b-1: the lessons of `findings` a kept move placed, with the moment of the move. */
  readonly movedAt: ReadonlyMap<DatedLesson, Date>;
}

interface ChainRow {
  readonly id: string;
  readonly lesson_id: string;
  readonly kind: string;
  readonly class_id: string | null;
  readonly group_id: string | null;
  readonly subject_id: string;
  readonly from_date: string;
  readonly from_starts_at: Date;
  readonly from_ends_at: Date;
  readonly from_room_id: string | null;
  readonly to_date: string;
  readonly to_starts_at: Date;
  readonly to_ends_at: Date;
  readonly to_room_id: string | null;
  readonly reason: string;
  readonly changed_at: Date;
  readonly changed_by: string;
}

/** A stored lesson as it is now. */
interface StoredNow {
  readonly id: string;
  readonly block_id: string;
  readonly lesson_date: string;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly class_id: string | null;
  readonly group_id: string | null;
  readonly subject_id: string;
  readonly teacher_id: string | null;
  readonly room_id: string | null;
  readonly cancel_cause: string | null;
  readonly cancel_reason: string | null;
  readonly double_pair_id: string | null;
  /** Task 5.6b-2a: its pattern entry, by which a move out of the run finds its old place. */
  readonly pattern_entry_id: string | null;
}

/** The rows of one lesson's changes in force, oldest first. */
export interface Chain {
  readonly lessonId: string;
  readonly rows: readonly ChainRow[];
  readonly first: ChainRow;
  readonly last: ChainRow;
  readonly kind: 'room' | 'move';
  readonly lesson: StoredNow;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byAge = (a: ChainRow, b: ChainRow) =>
  a.changed_at.getTime() - b.changed_at.getTime() || compare(a.id, b.id);
const unitOfRow = (row: { class_id: string | null; group_id: string | null }) =>
  row.class_id ?? row.group_id ?? '';
const unitOfPlacement = (one: Placement) => one.classId ?? one.groupId ?? '';

/** The chains of the branch's room changes and moves in force that reach `firstDate` to `lastDate`. */
async function chainsOf(
  transaction: Transaction,
  branchId: string,
  firstDate: string,
  lastDate: string,
  retime: StoredRetime | undefined,
): Promise<Chain[]> {
  const reaching = transaction
    .selectFrom('lesson_day_changes')
    .select('lesson_id')
    .where('branch_id', '=', branchId)
    .where('lesson_id', 'is not', null)
    .where((eb) =>
      eb.or([
        eb.and([eb('from_date', '>=', firstDate), eb('from_date', '<=', lastDate)]),
        eb.and([eb('to_date', '>=', firstDate), eb('to_date', '<=', lastDate)]),
      ]),
    );
  const rows = await transaction
    .selectFrom('lesson_day_changes')
    .select([
      'id',
      'lesson_id',
      'kind',
      'class_id',
      'group_id',
      'subject_id',
      sql<string>`from_date::text`.as('from_date'),
      'from_starts_at',
      'from_ends_at',
      'from_room_id',
      sql<string>`to_date::text`.as('to_date'),
      'to_starts_at',
      'to_ends_at',
      'to_room_id',
      'reason',
      'changed_at',
      'changed_by',
    ])
    .where('branch_id', '=', branchId)
    .where('lesson_id', 'in', reaching)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('lesson_day_change_ends')
            .select('change_id')
            .whereRef('lesson_day_change_ends.change_id', '=', 'lesson_day_changes.id'),
        ),
      ),
    )
    .orderBy('changed_at')
    .orderBy('id')
    .execute();
  const byLesson = new Map<string, ChainRow[]>();
  for (const row of rows) {
    if (row.lesson_id === null) continue;
    const list = byLesson.get(row.lesson_id) ?? [];
    list.push({ ...row, lesson_id: row.lesson_id });
    byLesson.set(row.lesson_id, list);
  }
  if (byLesson.size === 0) return [];
  const lessons = (await storedNowOf(transaction, [...byLesson.keys()])).map((one) =>
    retimed(one, retime),
  );
  const lessonOf = new Map(lessons.map((one) => [one.id, one]));
  const chains: Chain[] = [];
  for (const [lessonId, list] of byLesson) {
    const sorted = [...list].sort(byAge);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const lesson = lessonOf.get(lessonId);
    if (first === undefined || last === undefined || lesson === undefined) continue;
    chains.push({
      lessonId,
      rows: sorted,
      first,
      last,
      kind: sorted.some((one) => one.kind === 'move') ? 'move' : 'room',
      lesson,
    });
  }
  return chains.sort((a, b) => byAge(a.first, b.first));
}

async function storedNowOf(transaction: Transaction, ids: readonly string[]): Promise<StoredNow[]> {
  if (ids.length === 0) return [];
  return transaction
    .selectFrom('lessons')
    .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
    .select([
      'lessons.id',
      'lessons.block_id',
      sql<string>`lessons.lesson_date::text`.as('lesson_date'),
      'lessons.starts_at',
      'lessons.ends_at',
      'lessons.class_id',
      'lessons.group_id',
      'lessons.subject_id',
      'lessons.teacher_id',
      'lessons.room_id',
      'lessons.cancel_cause',
      'lessons.cancel_reason',
      'lesson_blocks.double_pair_id',
      'lessons.pattern_entry_id',
    ])
    .where('lessons.id', 'in', ids)
    .orderBy('lessons.id')
    .execute();
}

/**
 * The one-day cancels of cause `reason` on lessons of the dates, no chain's
 * and no bulk cancel's (a lesson of a class a bulk cancel of its date covers
 * at its time is left to 5.6a-5b).
 */
async function cancelsOf(
  transaction: Transaction,
  branchId: string,
  firstDate: string,
  lastDate: string,
  classIdsOf: (unitId: string) => readonly string[] | undefined,
  retime: StoredRetime | undefined,
): Promise<StoredNow[]> {
  const read = await transaction
    .selectFrom('lessons')
    .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
    .select([
      'lessons.id',
      'lessons.block_id',
      sql<string>`lessons.lesson_date::text`.as('lesson_date'),
      'lessons.starts_at',
      'lessons.ends_at',
      'lessons.class_id',
      'lessons.group_id',
      'lessons.subject_id',
      'lessons.teacher_id',
      'lessons.room_id',
      'lessons.cancel_cause',
      'lessons.cancel_reason',
      'lesson_blocks.double_pair_id',
      'lessons.pattern_entry_id',
    ])
    .where('lessons.branch_id', '=', branchId)
    .where('lessons.lesson_date', '>=', firstDate)
    .where('lessons.lesson_date', '<=', lastDate)
    .where('lessons.cancel_cause', '=', 'reason')
    .orderBy('lessons.id')
    .execute();
  // Task 5.6b-4b (spec review of the plan, must-fix 2): at the new times,
  // as the bulk cancels' spans already are.
  const rows = read.map((one) => retimed(one, retime));
  if (rows.length === 0) return [];
  const spans = await transaction
    .selectFrom('bulk_cancel_spans')
    .innerJoin('bulk_cancels', 'bulk_cancels.id', 'bulk_cancel_spans.bulk_cancel_id')
    .select([
      'bulk_cancel_spans.class_id',
      'bulk_cancel_spans.starts_at',
      'bulk_cancel_spans.ends_at',
    ])
    .where('bulk_cancels.branch_id', '=', branchId)
    .where('bulk_cancels.cancel_date', '>=', firstDate)
    .where('bulk_cancels.cancel_date', '<=', lastDate)
    .execute();
  return rows.filter((row) => {
    const unit = unitOfRow(row);
    const classes = classIdsOf(unit) ?? (row.class_id === null ? [] : [row.class_id]);
    return !spans.some(
      (span) =>
        classes.includes(span.class_id) &&
        span.starts_at.getTime() < row.ends_at.getTime() &&
        row.starts_at.getTime() < span.ends_at.getTime(),
    );
  });
}

/** A result of the engine as the preview names it: its own lessons by entry. */
export function answerOf(result: RuleResult): RuleResultAnswer {
  const own = [
    ...new Set(
      result.lessonIds.flatMap((id) => {
        const pattern = patternIdOf(id);
        return pattern === null ? [] : [pattern.id];
      }),
    ),
  ];
  return {
    rule: result.rule,
    severity: result.severity,
    weekday: weekdaySchema.parse(weekdayOf(result.day)),
    lessonIds: own,
    ...(result.detail === undefined ? {} : { detail: { ...result.detail } }),
    date: result.day,
  };
}

/**
 * Sorts the stored one-day changes of `firstDate` to `lastDate`, the dates a
 * write of `state`'s version from `findings` covers (see the file's comment).
 */
export async function sortDayChanges(
  transaction: Transaction,
  input: {
    readonly state: PatternState;
    readonly findings: DatedFindings;
    readonly firstDate: string;
    readonly lastDate: string;
    /** The carried version whose run this is, `null` for the published one's. */
    readonly carriedVersionId: string | null;
    /**
     * Task 5.6b-2c-1 (spec review of the plan, should-fix 5): the branch's
     * exams of a date as a calendar save leaves them, in place of their
     * stored claims, and the lessons they cover (placement ids), left out.
     */
    readonly exams?: {
      readonly on: (date: string) => readonly Placement[];
      readonly covered: ReadonlySet<string>;
    };
    /**
     * Task 5.6b-2c-2: the dates another stretch of the same calendar save
     * writes, and the moves between two stretches already found "needs a
     * decision" by their key, with the blocked rules of their new place.
     */
    readonly across?: {
      readonly written: (date: string) => boolean;
      readonly decided: ReadonlyMap<string, readonly RuleResultAnswer[]>;
    };
    /** Task 5.6b-4b: a template change's new times of the stored lessons. */
    readonly retime?: StoredRetime;
  },
): Promise<DaySorting> {
  const { state, findings, firstDate, lastDate } = input;
  const { model } = state.pattern;
  const branchId = model.data.branchId;
  const inRun = (date: string) => firstDate <= date && date <= lastDate;
  const elsewhere = (date: string) => input.across?.written(date) === true;
  const unitClasses = new Map(model.data.units.map((unit) => [unit.id, unit.classIds]));

  const chains = await chainsOf(transaction, branchId, firstDate, lastDate, input.retime);
  const plainCancels = (
    await cancelsOf(
      transaction,
      branchId,
      firstDate,
      lastDate,
      (unitId) => unitClasses.get(unitId),
      input.retime,
    )
  ).filter((one) => !chains.some((chain) => chain.lessonId === one.id));

  // The first moment of every date read: the run and every chain's dates.
  const dates = [
    firstDate,
    lastDate,
    ...chains.flatMap((one) => [one.first.from_date, one.last.to_date]),
  ].sort();
  const beginsAll = await dayBeginnings(
    transaction,
    findings.timeZone,
    dates[0] ?? firstDate,
    addDays(dates[dates.length - 1] ?? lastDate, 1),
  );
  const minutesOf = (date: string, moment: Date) =>
    Math.round((moment.getTime() - beginsAll(date).getTime()) / MINUTE);

  // The new version's lessons by class or group, subject, date and minutes.
  const wantedKey = (unit: string, subject: string, date: string, start: number, end: number) =>
    `${unit}|${subject}|${date}|${String(start)}|${String(end)}`;
  const wantedBy = new Map<string, DatedLesson[]>();
  const blockLessons = new Map<string, DatedLesson[]>();
  for (const lesson of findings.dated.lessons) {
    const { placement } = lesson;
    const key = wantedKey(
      unitOfPlacement(placement),
      placement.subjectId ?? '',
      lesson.date,
      placement.start,
      placement.end,
    );
    wantedBy.set(key, [...(wantedBy.get(key) ?? []), lesson]);
    const block = placement.blockId ?? placement.id;
    blockLessons.set(block, [...(blockLessons.get(block) ?? []), lesson]);
  }
  const wantedAt = (row: ChainRow) =>
    wantedBy.get(
      wantedKey(
        unitOfRow(row),
        row.subject_id,
        row.from_date,
        minutesOf(row.from_date, row.from_starts_at),
        minutesOf(row.from_date, row.from_ends_at),
      ),
    )?.[0];

  // The items: the chains of one request together.
  const groups = new Map<string, Chain[]>();
  for (const chain of chains) {
    const key = `${chain.last.changed_at.toISOString()}|${chain.last.changed_by}|${chain.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), chain]);
  }

  interface Draft {
    readonly chains: Chain[];
    readonly kind: 'room' | 'move';
    category: DayCategory;
    blocked: RuleResultAnswer[];
    readonly matched: Map<string, DatedLesson>;
    readonly mode: 'inside' | 'to_outside' | 'from_outside' | 'to_other' | 'from_other';
  }
  // Task 5.6b-2c-2: a move between two stretches already found "needs a
  // decision" stays so in both halves (decision 5).
  const decidedOf = (group: readonly Chain[]) => {
    const [head] = [...group].sort((a, b) => byAge(a.first, b.first));
    return head === undefined ? undefined : input.across?.decided.get(head.first.id);
  };
  const drafts: Draft[] = [];
  for (const group of groups.values()) {
    const kind = group[0]?.kind ?? 'room';
    const head = group[0];
    if (head === undefined) continue;
    const from = head.first.from_date;
    const to = head.last.to_date;
    const matched = new Map<string, DatedLesson>();
    if (kind === 'room') {
      if (!inRun(from)) continue;
      for (const chain of group) {
        const found = wantedAt(chain.first);
        if (found !== undefined) matched.set(chain.lessonId, found);
      }
      const changing = group.filter((chain) => {
        const found = matched.get(chain.lessonId);
        return found !== undefined && found.placement.roomId !== chain.last.to_room_id;
      });
      drafts.push({
        chains: group,
        kind,
        category: changing.length === 0 ? 'dropped' : 'kept',
        blocked: [],
        matched,
        mode: 'inside',
      });
      continue;
    }
    if (!inRun(from) && !inRun(to)) continue;
    if (!inRun(from)) {
      const decided = elsewhere(from) ? decidedOf(group) : undefined;
      drafts.push({
        chains: group,
        kind,
        category: decided === undefined ? 'kept' : 'decide',
        blocked: decided === undefined ? [] : [...decided],
        matched,
        mode: elsewhere(from) ? 'from_other' : 'from_outside',
      });
      continue;
    }
    for (const chain of group) {
      const found = wantedAt(chain.first);
      if (found !== undefined) matched.set(chain.lessonId, found);
    }
    if (!inRun(to)) {
      // Task 5.6b-2a (spec review of the plan, must-fix 1): the old place
      // by the lesson's pattern entry and date too, so that a day that
      // shifts its times (a special template written by a calendar save)
      // writes no second lesson of it there.
      for (const chain of group) {
        if (matched.has(chain.lessonId)) continue;
        const found = findings.dated.lessons.find(
          (one) =>
            one.entryId === chain.lesson.pattern_entry_id &&
            one.date === from &&
            patternDateOf(one) === from,
        );
        if (found !== undefined) matched.set(chain.lessonId, found);
      }
      const decided = elsewhere(to) ? decidedOf(group) : undefined;
      drafts.push({
        chains: group,
        kind,
        category: decided === undefined ? 'kept' : 'decide',
        blocked: decided === undefined ? [] : [...decided],
        matched,
        mode: elsewhere(to) ? 'to_other' : 'to_outside',
      });
      continue;
    }
    let category: DayCategory = 'kept';
    if (matched.size === 0) {
      category = 'dropped';
    } else if (matched.size < group.length) {
      category = 'decide';
    } else {
      // One block of exactly the moved lessons (both halves of a double: a block each).
      const mine = new Set(matched.values());
      const blocks = new Set([...mine].map((one) => one.placement.blockId ?? one.placement.id));
      for (const block of blocks) {
        if ((blockLessons.get(block) ?? []).some((one) => !mine.has(one))) category = 'decide';
      }
    }
    drafts.push({ chains: group, kind, category, blocked: [], matched, mode: 'inside' });
  }
  drafts.sort((a, b) => {
    const [x] = a.chains;
    const [y] = b.chains;
    return x === undefined || y === undefined ? 0 : byAge(x.first, y.first);
  });
  // Task 5.6b-4b (decision 7): a move whose new place has no slot of its
  // lesson number after a template change needs a decision (drop the change,
  // or cancel the lesson that day), as any stored change it cannot keep.
  const unplaced = input.retime?.unplaced;
  if (unplaced !== undefined) {
    for (const draft of drafts) {
      if (draft.kind !== 'move' || draft.category !== 'kept') continue;
      if (draft.chains.some((chain) => chain.rows.some((row) => unplaced.has(row.id)))) {
        draft.category = 'decide';
      }
    }
  }

  // The rule check of every change kept, the oldest first (decision 6).
  const placed = new Map<DatedLesson, DatedLesson>();
  const movedAt = new Map<DatedLesson, Date>();
  const skipped = new Set<DatedLesson>();
  const keptStoredIds = new Set<string>();
  const keptStored: Placement[] = [];
  // Task 5.6b-2a (spec review of the plan, must-fix 1): a block the day
  // creates cancelled at the old place of a move out of the run (an exam
  // week, a slot beyond a shortened day) is left out too, so the lesson is
  // never in two places: matched by a pattern entry of the move, or by the
  // class or group, subject and minutes of its pattern block.
  const skippedCancelled = new Set<string>();
  const patternBlocks = new Map(state.blocks.map((one) => [one.id, one]));
  for (const draft of drafts) {
    // Task 5.6b-2c-2: the old place of a move between two stretches is left
    // out only while the move is kept; otherwise the choice acts on it there.
    const leftOut =
      draft.mode === 'to_outside' || (draft.mode === 'to_other' && draft.category === 'kept');
    if (!leftOut) continue;
    for (const one of draft.matched.values()) skipped.add(one);
    for (const cancelled of findings.dated.cancelled) {
      const pattern = patternBlocks.get(cancelled.blockId);
      const hit = draft.chains.some((chain) => {
        if (chain.first.from_date !== cancelled.date) return false;
        if (chain.lesson.pattern_entry_id !== null) {
          if (pattern?.lessons.some((entry) => entry.id === chain.lesson.pattern_entry_id)) {
            return true;
          }
        }
        if (pattern === undefined) return false;
        return (
          pattern.start === minutesOf(chain.first.from_date, chain.first.from_starts_at) &&
          pattern.end === minutesOf(chain.first.from_date, chain.first.from_ends_at) &&
          pattern.lessons.some((entry) => {
            const row = model.rowOf(entry.loadRowId);
            return (
              (row.classId ?? row.groupId ?? '') === unitOfRow(chain.first) &&
              row.subjectId === chain.first.subject_id
            );
          })
        );
      });
      if (hit) skippedCancelled.add(`${cancelled.blockId}@${cancelled.date}`);
    }
  }
  const examCache = new Map<string, Placement[]>();
  const examsOf = async (date: string): Promise<readonly Placement[]> => {
    if (input.exams !== undefined) return input.exams.on(date);
    const known = examCache.get(date);
    if (known !== undefined) return known;
    const found = await examsOn(
      transaction,
      branchId,
      findings.timeZone,
      date,
      beginsAll(date),
      beginsAll(addDays(date, 1)),
    );
    examCache.set(date, found);
    return found;
  };
  const checkedOf = (lesson: DatedLesson): Placement =>
    lesson.tutorFollowed ? { ...lesson.placement, teacherIds: [] } : lesson.placement;
  const othersOn = async (date: string, own: ReadonlySet<DatedLesson>) => [
    ...findings.dated.lessons
      .filter(
        (one) =>
          !own.has(one) && !skipped.has(one) && input.exams?.covered.has(one.placement.id) !== true,
      )
      .map((one) => placed.get(one) ?? one)
      .filter((one) => one.date === date)
      .map(checkedOf),
    ...keptStored.filter((one) => one.day === date),
    ...findings.elsewhereOn(date),
    ...(await examsOf(date)),
  ];
  const blockedOf = async (
    date: string,
    own: ReadonlySet<DatedLesson>,
    candidates: readonly Placement[],
  ): Promise<RuleResult[]> =>
    checkCandidates(await othersOn(date, own), findings.factsOn(date), candidates, {
      availabilityFrom: firstDate,
    }).filter((one) => one.severity === 'blocked');

  for (const draft of drafts) {
    if (draft.category !== 'kept' || draft.mode === 'to_outside' || draft.mode === 'to_other') {
      continue;
    }
    if (draft.mode === 'from_outside' || draft.mode === 'from_other') {
      const date = draft.chains[0]?.last.to_date ?? firstDate;
      const facts = findings.factsOn(date);
      const candidates: Placement[] = [];
      let known = true;
      for (const chain of draft.chains) {
        const lesson = chain.lesson;
        const unit = unitOfRow(lesson);
        const cancelled = lesson.cancel_cause !== null;
        if (!facts.units.has(unit)) known = false;
        if (!cancelled && lesson.teacher_id !== null && !facts.teachers.has(lesson.teacher_id)) {
          known = false;
        }
        const students = findings.studentsOn(unit, date);
        candidates.push({
          id: `stored:${lesson.id}`,
          kind: 'lesson',
          branchId,
          day: date,
          start: minutesOf(date, lesson.starts_at),
          end: minutesOf(date, lesson.ends_at),
          blockId: `stored:${lesson.block_id}`,
          doublePairId: lesson.double_pair_id === null ? null : `stored:${lesson.double_pair_id}`,
          classId: lesson.class_id,
          groupId: lesson.group_id,
          classIds: unitClasses.get(unit) ?? (lesson.class_id === null ? [] : [lesson.class_id]),
          studentIds: cancelled ? [] : students,
          exemptStudentIds: cancelled ? students : [],
          subjectId: lesson.subject_id,
          loadRowId: null,
          teacherIds: cancelled || lesson.teacher_id === null ? [] : [lesson.teacher_id],
          substitute: false,
          roomId: cancelled ? null : lesson.room_id,
          examRooms: [],
          fixed: false,
        });
      }
      if (!known) {
        draft.category = 'decide';
        continue;
      }
      const blocked = await blockedOf(date, new Set(), candidates);
      if (blocked.length > 0) {
        draft.category = 'decide';
        draft.blocked = blocked.map(answerOf);
        continue;
      }
      keptStored.push(...candidates.map((one) => ({ ...one, fixed: true })));
      for (const chain of draft.chains) keptStoredIds.add(chain.lessonId);
      continue;
    }
    // Inside the run: the matched lessons at the place the chains put them.
    const own = new Set(draft.matched.values());
    const moved = new Map<DatedLesson, DatedLesson>();
    for (const chain of draft.chains) {
      const lesson = draft.matched.get(chain.lessonId);
      if (lesson === undefined) continue;
      const cancelled = chain.lesson.cancel_cause !== null;
      const to = chain.last;
      if (draft.kind === 'room') {
        if (lesson.placement.roomId === to.to_room_id) continue;
        moved.set(lesson, { ...lesson, placement: { ...lesson.placement, roomId: to.to_room_id } });
        continue;
      }
      const unit = unitOfPlacement(lesson.placement);
      const students = findings.studentsOn(unit, to.to_date);
      moved.set(lesson, {
        ...lesson,
        date: to.to_date,
        placement: {
          ...lesson.placement,
          day: to.to_date,
          start: minutesOf(to.to_date, to.to_starts_at),
          end: minutesOf(to.to_date, to.to_ends_at),
          roomId: to.to_room_id,
          studentIds: cancelled ? [] : students,
          exemptStudentIds: cancelled ? students : [],
          ...(cancelled ? { teacherIds: [], roomId: null } : {}),
        },
      });
    }
    const byDate = new Map<string, Placement[]>();
    for (const one of moved.values()) {
      byDate.set(one.date, [...(byDate.get(one.date) ?? []), checkedOf(one)]);
    }
    const blocked: RuleResult[] = [];
    for (const [date, candidates] of byDate) {
      blocked.push(...(await blockedOf(date, own, candidates)));
    }
    if (blocked.length > 0) {
      draft.category = 'decide';
      draft.blocked = blocked.map(answerOf);
      continue;
    }
    // A cancelled part keeps its own place: placed with its block, cancelled.
    for (const chain of draft.chains) {
      const lesson = draft.matched.get(chain.lessonId);
      const at = lesson === undefined ? undefined : moved.get(lesson);
      if (lesson === undefined || at === undefined) continue;
      const put: DatedLesson =
        chain.lesson.cancel_cause === null
          ? at
          : {
              ...at,
              placement: {
                ...at.placement,
                teacherIds: lesson.placement.teacherIds,
                roomId: lesson.placement.roomId,
                studentIds: lesson.placement.studentIds,
                exemptStudentIds: lesson.placement.exemptStudentIds,
              },
            };
      placed.set(lesson, put);
      if (draft.kind === 'move') movedAt.set(put, chain.last.changed_at);
    }
  }

  // The findings with every kept change applied. A lesson moved keeps the
  // date of its pattern block in its block's id, by which the needs-a-teacher
  // list and the cancels name it (`patternDateOf`).
  const lessons = findings.dated.lessons
    .filter((one) => !skipped.has(one))
    .map((one) => placed.get(one) ?? one);
  const applied: DatedFindings = {
    ...findings,
    dated: {
      ...findings.dated,
      lessons,
      cancelled: findings.dated.cancelled.filter(
        (one) => !skippedCancelled.has(`${one.blockId}@${one.date}`),
      ),
    },
  };

  // The items, the plain cancels last.
  const placeOf = (date: string, starts: Date, ends: Date, roomId: string | null) => ({
    date,
    start: minutesOf(date, starts),
    end: minutesOf(date, ends),
    roomId,
  });
  const items: SortedDayChange[] = [];
  const wantedNow = new Map<string, DatedLesson>();
  for (const one of lessons) {
    const { placement } = one;
    wantedNow.set(
      wantedKey(
        unitOfPlacement(placement),
        placement.subjectId ?? '',
        one.date,
        placement.start,
        placement.end,
      ),
      one,
    );
  }
  for (const draft of drafts) {
    const [head] = [...draft.chains].sort((a, b) => byAge(a.first, b.first));
    if (head === undefined) continue;
    const cancelledParts = new Map<string, string>();
    for (const chain of draft.chains) {
      if (chain.lesson.cancel_cause === 'reason') {
        cancelledParts.set(chain.lessonId, chain.lesson.cancel_reason ?? '');
      }
    }
    items.push({
      answer: {
        key: head.first.id,
        kind: draft.kind,
        unitId: unitOfRow(head.first),
        subjectId: head.first.subject_id,
        from: placeOf(
          head.first.from_date,
          head.first.from_starts_at,
          head.first.from_ends_at,
          head.first.from_room_id,
        ),
        to: placeOf(
          head.last.to_date,
          head.last.to_starts_at,
          head.last.to_ends_at,
          head.last.to_room_id,
        ),
        reason: head.last.reason,
        carriedVersionId: input.carriedVersionId,
        blocked: draft.blocked,
      },
      category: draft.category,
      changeIds: draft.chains.flatMap((chain) => chain.rows.map((row) => row.id)).sort(),
      matched: draft.matched,
      cancelledParts,
      // Task 5.6b-2c-2: the new place of a move between two stretches keeps
      // its stored lesson only while the move is kept; otherwise the rewrite
      // of that date removes it and the choice acts at the old place.
      storedIds:
        draft.mode === 'from_outside' || (draft.mode === 'from_other' && draft.category === 'kept')
          ? draft.chains.map((chain) => chain.lessonId)
          : [],
      chains: draft.chains,
      half:
        draft.mode === 'to_other' ? 'old_place' : draft.mode === 'from_other' ? 'new_place' : null,
    });
  }
  for (const cancel of plainCancels) {
    const from = placeOf(cancel.lesson_date, cancel.starts_at, cancel.ends_at, cancel.room_id);
    const found = wantedNow.get(
      wantedKey(unitOfRow(cancel), cancel.subject_id, from.date, from.start, from.end),
    );
    items.push({
      answer: {
        key: cancel.id,
        kind: 'cancel',
        unitId: unitOfRow(cancel),
        subjectId: cancel.subject_id,
        from,
        to: from,
        reason: cancel.cancel_reason ?? '',
        carriedVersionId: input.carriedVersionId,
        blocked: [],
      },
      category: found === undefined ? 'dropped' : 'kept',
      changeIds: [],
      // Task 5.6b-4b: the lesson it is kept on, which a template change
      // creates at its new times; the write cancels it there.
      matched: found === undefined ? new Map() : new Map([[cancel.id, found]]),
      cancelledParts: new Map(),
      storedIds: [],
      chains: [],
      half: null,
    });
  }
  return { items, findings: applied, keptStoredIds, movedAt };
}

/** The key of a sorting as the preview shows it (decision 9, review should-fix 7). */
export function dayChangesKeyOf(
  versionId: string,
  startsOn: string,
  items: readonly SortedDayChange[],
  /** Task 5.6a-5b-1: the key of the bulk cancels sorted (`bulkKeyPartOf`), none when there are none. */
  bulk: string | null = null,
  /** Task 5.6c-3a: the key of the exams sorted (`examKeyPartOf`), none when there are none. */
  exams: string | null = null,
): string {
  const shown = items
    .map((one) => [
      one.answer.carriedVersionId ?? '',
      one.answer.key,
      one.category,
      JSON.stringify([one.answer.from, one.answer.to]),
    ])
    .sort((a, b) => compare(a.join('|'), b.join('|')));
  return createHash('sha256')
    .update(
      JSON.stringify({
        versionId,
        startsOn,
        shown,
        ...(bulk === null ? {} : { bulk }),
        ...(exams === null ? {} : { exams }),
      }),
    )
    .digest('hex');
}

/**
 * What the write does with `items` and the choices of their "needs a
 * decision" items (decisions 2 and 7; review should-fix 5: a part of a moved
 * block cancelled with a reason keeps its cancel on the new version's lesson
 * at the old place when the move is not applied).
 */
export function writePlanOf(
  items: readonly SortedDayChange[],
  keptStoredIds: ReadonlySet<string>,
  decisions: ReadonlyMap<string, DayChangeChoice>,
): DayWritePlan {
  const cancels = new Map<string, string>();
  const keepStored = new Set(keptStoredIds);
  const cancelStored = new Map<string, string>();
  for (const item of items) {
    if (item.answer.kind === 'cancel') {
      // Task 5.6b-4b: a kept one-lesson cancel on the lesson it is matched
      // to; a lesson the write pairs with the stored one keeps its cancel.
      for (const lesson of item.category === 'kept' ? item.matched.values() : []) {
        cancels.set(
          placeKeyOf(lesson.entryId, patternDateOf(lesson), lesson.date),
          item.answer.reason,
        );
      }
      continue;
    }
    const choice = item.category === 'decide' ? decisions.get(item.answer.key) : undefined;
    if (item.category === 'kept') continue;
    if (item.storedIds.length > 0) {
      if (choice === 'cancel') {
        for (const id of item.storedIds) {
          keepStored.add(id);
          if (!item.cancelledParts.has(id)) cancelStored.set(id, item.answer.reason);
        }
      }
      continue;
    }
    for (const chain of item.chains) {
      const lesson = item.matched.get(chain.lessonId);
      if (lesson === undefined) continue;
      const own = item.cancelledParts.get(chain.lessonId);
      // The lesson at the old place, where its pattern block puts it.
      const key = placeKeyOf(lesson.entryId, lesson.date, lesson.date);
      if (own !== undefined) cancels.set(key, own);
      else if (choice === 'cancel') cancels.set(key, item.answer.reason);
    }
  }
  return { cancels, keepStored, cancelStored, bulkCancels: new Map(), bulkHolds: new Map() };
}

/**
 * After the write: every room change or move not applied is ended, and a
 * change applied to a lesson the write created again is recorded again for
 * the new lesson (decisions 4 and 5). Returns the keys ended and recorded again.
 */
export async function settleDayChanges(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly versionId: string;
    readonly moment: Date;
    readonly accountId: string;
    readonly items: readonly SortedDayChange[];
    readonly decisions: ReadonlyMap<string, DayChangeChoice>;
  },
): Promise<{ ended: string[]; recordedAgain: string[] }> {
  const ended: string[] = [];
  const recordedAgain: string[] = [];
  const endIds: string[] = [];
  const again: {
    chain: Chain;
    lessonId: string;
    from: { date: string; starts: Date; ends: Date; roomId: string | null };
  }[] = [];
  for (const item of input.items) {
    if (item.answer.kind === 'cancel') continue;
    // A change kept stays in force; every other is ended, a decision
    // included (decision 2: "the change is ended either way").
    if (item.category !== 'kept') {
      endIds.push(...item.changeIds);
      ended.push(item.answer.key);
      continue;
    }
    if (item.storedIds.length > 0) continue;
    // A kept change on a lesson created again: recorded for the new lesson.
    const lost = item.chains.filter((chain) => item.matched.has(chain.lessonId));
    if (lost.length === 0) continue;
    const present = new Set(
      (
        await transaction
          .selectFrom('lessons')
          .select('id')
          .where('branch_id', '=', input.branchId)
          .where(
            'id',
            'in',
            lost.map((chain) => chain.lessonId),
          )
          .execute()
      ).map((one) => one.id),
    );
    let recorded = false;
    for (const chain of lost) {
      if (present.has(chain.lessonId)) continue;
      const to = chain.last;
      const found = await transaction
        .selectFrom('lessons')
        .select('id')
        .where('branch_id', '=', input.branchId)
        .where(
          chain.lesson.class_id === null ? 'group_id' : 'class_id',
          '=',
          unitOfRow(chain.lesson),
        )
        .where('subject_id', '=', chain.lesson.subject_id)
        .where('lesson_date', '=', to.to_date)
        .where('starts_at', '=', to.to_starts_at)
        // One lesson of a class or group and subject at a time; a cancelled
        // part shares the place with nothing else (spec review, must-fix 2).
        .orderBy('id')
        .executeTakeFirst();
      const lesson = item.matched.get(chain.lessonId);
      if (found === undefined || lesson === undefined) continue;
      again.push({
        chain,
        lessonId: found.id,
        from: {
          date: chain.first.from_date,
          starts: chain.first.from_starts_at,
          ends: chain.first.from_ends_at,
          roomId: lesson.placement.roomId,
        },
      });
      endIds.push(...chain.rows.map((row) => row.id));
      recorded = true;
    }
    if (recorded) recordedAgain.push(item.answer.key);
  }
  if (again.length > 0) {
    const loads = await transaction
      .selectFrom('lessons')
      .select(['id', 'load_row_id'])
      .where('branch_id', '=', input.branchId)
      .where(
        'id',
        'in',
        again.map((one) => one.lessonId),
      )
      .execute();
    const loadOf = new Map(loads.map((one) => [one.id, one.load_row_id]));
    await transaction
      .insertInto('lesson_day_changes')
      .values(
        again.map(({ chain, lessonId, from }) => ({
          branch_id: input.branchId,
          lesson_id: lessonId,
          kind: chain.kind,
          class_id: chain.lesson.class_id,
          group_id: chain.lesson.group_id,
          subject_id: chain.lesson.subject_id,
          load_row_id: loadOf.get(lessonId) ?? null,
          from_date: from.date,
          from_starts_at: from.starts,
          from_ends_at: from.ends,
          from_room_id: from.roomId,
          to_date: chain.last.to_date,
          to_starts_at: chain.last.to_starts_at,
          to_ends_at: chain.last.to_ends_at,
          to_room_id: chain.last.to_room_id,
          reason: chain.last.reason,
          changed_at: chain.last.changed_at,
          changed_by: chain.last.changed_by,
        })),
      )
      .execute();
  }
  const unique = [...new Set(endIds)].sort();
  if (unique.length > 0) {
    await transaction
      .insertInto('lesson_day_change_ends')
      .values(
        unique.map((changeId) => ({
          change_id: changeId,
          branch_id: input.branchId,
          version_id: input.versionId,
          ended_at: input.moment,
          ended_by: input.accountId,
        })),
      )
      .execute();
  }
  return { ended: ended.sort(), recordedAgain: recordedAgain.sort() };
}
