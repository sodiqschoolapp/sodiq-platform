import { randomUUID } from 'node:crypto';
import { patternIdOf } from '@sodiq/timetable-rules';
import type { ErrorDetail } from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { BulkHold } from './bulk-cancels-kept.js';
import type { ExamWrite } from './calendar-exams.js';
import type { DatedFindings } from './dated-check.js';
import type { DayWritePlan } from './day-changes-kept.js';
import { lessonsHoldingData } from './lesson-data.js';
import type { PatternState } from './pattern.service.js';
import { endSubstitutionRows } from './substitutions-read.js';

/**
 * The dated lessons of a version written at publish (task 5.5b-1, pull
 * request #152; docs/spec/06-timetable.md, Model, Dated lesson: "On
 * publishing, dated lessons are created up to the end of the academic year,
 * so every future lesson has a date from the first day. Days off produce no
 * lessons."; edge/timetable, Versions and drafts: "An unchanged lesson keeps
 * its identity, so its comments, plan item and one-day changes stay. Only
 * real differences are created or removed.").
 *
 * The lessons of the version's run are those its dated check expanded
 * (`datedPattern`, with its needs-a-teacher list), and the stored lessons of
 * the branch on those dates are paired with them one to one (decision 4,
 * spec review must-fix 1):
 * - a lesson that is not cancelled pairs with a stored one that is not
 *   cancelled by the expansion (a one-day cancel of cause `reason` or `exam`
 *   stays on it, decision 8), with the same class or group, subject, date,
 *   start and end; several under one key pair with equal teacher and room
 *   first, then in the order of their ids, as `publishImpact` pairs them;
 * - a lesson created cancelled pairs with a stored one cancelled with the same
 *   cause, class or group, subject, date and pattern times (decision 6).
 * A new dated block reuses the stored block that holds most of its paired
 * lessons, the smaller id on a tie, each stored block once at most (decision
 * 5, must-fix 2); a paired lesson of another stored block is removed and
 * created again, as a lesson never changes block (0058). A kept block and its
 * lessons are re-pointed to the version (decision 3), a kept lesson takes the
 * new teacher, room and cancel; what nothing paired is deleted. Nothing
 * outside `firstDate` to `lastDate` is read or written, and the database
 * refuses a delete or a re-point dated today or earlier (0079).
 *
 * The checks of the commit run deferred for the length of the write and
 * immediately at its end (must-fix 3): a block is re-pointed before its
 * lessons, and two kept lessons may swap a teacher or a room.
 */

/** What a write did, for the audit entry (decision 12). */
export interface DatedWrite {
  readonly firstDate: string;
  readonly lastDate: string;
  readonly created: number;
  readonly kept: number;
  readonly cancelled: number;
  readonly removed: readonly RemovedLesson[];
  readonly changed: readonly ChangedLesson[];
  /**
   * Task 6.1b-1 (decisions 2 and 5): each lesson holding data that the write
   * keeps cancelled, `kept_data` with no lesson of the version to pair or the
   * version's own cancel in place, listed by the write that cancels it.
   */
  readonly keptWithData: readonly KeptLesson[];
  /** Task 6.1b-1: each `kept_data` lesson that a write of its own version wants again. */
  readonly givenBack: readonly RemovedLesson[];
  /**
   * Task 5.7b-1 (decision 6, review correction 1): the substitutions in force
   * the write took off a lesson or removed with it, ended `dropped` (5.7b-3
   * sorts them instead).
   */
  readonly substitutionsDropped: readonly { lessonId: string; substitutionId: string }[];
  /**
   * Task 5.7b-3: the lesson each kept substitution's place has after the
   * write, by `placeKeyOf` (`DayWritePlan.substitutes`), for
   * `settleSubstitutions`.
   */
  readonly substitutesPlaced: ReadonlyMap<string, string>;
}

/** A lesson removed, with every value it held. */
export interface RemovedLesson {
  readonly id: string;
  readonly date: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly classId: string | null;
  readonly groupId: string | null;
  readonly subjectId: string;
  readonly teacherId: string | null;
  readonly roomId: string | null;
  readonly cancelCause: string | null;
}

/**
 * A lesson holding data kept by a write (task 6.1b-1): `cancelCause` and
 * `reason` are its cancel before the write (review correction 1), `cause`
 * the one it has after.
 */
export interface KeptLesson extends RemovedLesson {
  readonly reason: string | null;
  readonly cause: string;
}

/**
 * A kept lesson whose teacher, room or cancel changed, before and after. A
 * pair has the same generated cause or none, and a one-day cancel stays
 * (decision 8); a cancel is written only by a one-day change applied again
 * (task 5.6a-5a: "cancel the lesson that day", a cancelled part of a moved
 * block whose move is not applied).
 */
export interface ChangedLesson {
  readonly id: string;
  readonly teacherId: { readonly from: string | null; readonly to: string | null };
  readonly roomId: { readonly from: string | null; readonly to: string | null };
  readonly cancel?: { readonly from: string | null; readonly to: string | null };
  /** Task 6.1b-1 (decision 6): a lesson moved in time in place by a rewrite of its own version. */
  readonly times?: {
    readonly from: { readonly startsAt: string; readonly endsAt: string };
    readonly to: { readonly startsAt: string; readonly endsAt: string };
  };
}

/** The causes the expansion writes; a stored lesson with one of them was cancelled by it. */
const GENERATED_CAUSES = new Set(['not_in_template', 'day_off', 'exam_week']);

/**
 * Task 6.1b-1 (decision 2): the cause of a lesson holding data that a write
 * keeps with no lesson of a version to pair (0110). Not a generated cause: it
 * is shown on every view as a cancelled lesson, left out of the impact, and
 * paired only by entry and pattern date (pass 2 of `pairDated`).
 */
export const KEPT_DATA = 'kept_data';

/** Rows per insert statement. */
const BATCH = 500;

const MINUTE = 60_000;

/** A lesson the version wants on a date. */
interface Wanted {
  readonly patternBlockId: string;
  readonly entryId: string;
  /** The date of its pattern block (`patternDateOf`), which pass 2 of `pairDated` reads. */
  readonly patternDate: string;
  readonly loadRowId: string;
  readonly date: string;
  readonly start: number;
  readonly end: number;
  readonly classId: string | null;
  readonly groupId: string | null;
  /** The class or group. */
  readonly unitId: string;
  readonly subjectId: string;
  readonly teacherId: string | null;
  readonly roomId: string | null;
  /** The expansion's cancel, `null` for a lesson held. */
  readonly cause: string | null;
  /** A one-day cancel applied again (task 5.6a-5a), its reason; `null` for none. */
  readonly oneDayCancel: string | null;
  /** Task 5.6a-5b-1: a bulk cancel applied again, written only when the lesson is created (decision 4). */
  readonly bulkCancel: string | null;
  /** Task 5.6a-5b-1: a part of a block decided `keep` (`BulkHold`); `null` for none. */
  readonly bulkHold: BulkHold | null;
  /** Task 5.7b-3: its `placeKeyOf` when a kept substitution names it, `null` otherwise. */
  readonly substitutedAt: string | null;
}

/** A stored lesson as the writer and the preview read it (task 5.5b-2). */
export interface StoredRow {
  readonly id: string;
  readonly block_id: string;
  readonly lesson_date: string;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly class_id: string | null;
  readonly group_id: string | null;
  readonly subject_id: string;
  readonly load_row_id: string;
  readonly pattern_entry_id: string;
  readonly teacher_id: string | null;
  readonly room_id: string | null;
  readonly cancel_cause: string | null;
  readonly cancel_reason: string | null;
}

interface StoredBlock {
  readonly id: string;
  readonly version_id: string;
  readonly pattern_block_id: string;
  readonly double_pair_id: string | null;
  readonly starts_at: Date;
  readonly ends_at: Date;
}

/** A dated block the version wants: one pattern block on one date, or moved there (task 5.6a-5a). */
interface WantedBlock {
  readonly patternBlockId: string;
  /** The date of the pattern block it comes from: the date it was moved from, for a block moved. */
  readonly patternDate: string;
  readonly date: string;
  readonly start: number;
  readonly end: number;
  readonly lessons: Wanted[];
  /** The stored block it reuses, set from `pairDated`. */
  reused: string | null;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/** A stored lesson as `pairDated` reads it, its times in minutes of its date. */
export interface PairStored {
  readonly id: string;
  readonly blockId: string;
  readonly date: string;
  readonly start: number;
  readonly end: number;
  /** The class or group. */
  readonly unitId: string;
  readonly subjectId: string;
  readonly teacherId: string | null;
  readonly roomId: string | null;
  readonly cancelCause: string | null;
  /**
   * Task 6.1b-1 (decision 6): its pattern entry and the date of its pattern
   * block (the date its oldest one-day move in force moved it from, else its
   * own), which pass 2 pairs by; left out, the lesson is paired by pass 1 only.
   */
  readonly entryId?: string;
  readonly patternDate?: string;
}

/** A lesson the version wants as `pairDated` reads it. */
export interface PairWanted {
  readonly entryId: string;
  readonly date: string;
  readonly start: number;
  readonly end: number;
  readonly unitId: string;
  readonly subjectId: string;
  readonly teacherId: string | null;
  readonly roomId: string | null;
  /** The expansion's cancel, `null` for a lesson held. */
  readonly cause: string | null;
  /** Task 6.1b-1: the date of its pattern block; left out, no pass 2. */
  readonly patternDate?: string;
}

/**
 * The stored lesson each wanted lesson keeps, one to one, and the stored
 * block each wanted block reuses (`null`: a new block), by the rules of the
 * file's comment. `blocks` come in the order they choose: date, start,
 * pattern block. A pair whose stored lesson is in another block than the one
 * its block reuses is no pair: that lesson is removed and created again.
 *
 * Task 6.1b-1 (decision 6): a wanted lesson that pass 1 leaves alone pairs in
 * pass 2 with a stored lesson of the same pattern entry, pattern date, date,
 * class or group and subject, whatever its times and cancel: a pattern entry
 * belongs to one version, so only a rewrite of the same version pairs there,
 * and the lesson keeps its id at its new times or cancel. A block of
 * `pinned` (it holds a lesson with data that no wanted lesson pairs) is never
 * reused; a block holding more paired lessons of `holding` (lessons with
 * data) is reused first, so a lesson with data keeps its block where it can.
 */
export function pairDated<W extends PairWanted>(
  stored: readonly PairStored[],
  blocks: readonly { readonly lessons: readonly W[] }[],
  options: {
    readonly pinned?: ReadonlySet<string>;
    readonly holding?: ReadonlySet<string>;
  } = {},
): {
  pairs: Map<W, PairStored>;
  reused: (string | null)[];
  /**
   * The pairs dropped because the stored lesson is in another block than the
   * one its block reuses: that lesson is removed and created again, and keeps
   * its one-day cancel (task 5.6a-1, build decision).
   */
  recreated: Map<W, PairStored>;
  /** Task 6.1b-1: the wanted lessons paired by pass 2. */
  second: Set<W>;
} {
  const pinned = options.pinned ?? new Set<string>();
  const holding = options.holding ?? new Set<string>();
  const keyOf = (
    held: string,
    unit: string,
    subject: string,
    date: string,
    start: number,
    end: number,
  ) => `${held}|${unit}|${subject}|${date}|${String(start)}|${String(end)}`;
  const byId = [...stored].sort((a, b) => compare(a.id, b.id));
  const storedByKey = new Map<string, PairStored[]>();
  for (const row of byId) {
    // A cancel of the expansion and a lesson kept with data pair by their
    // cause; a lesson held, or cancelled by a one-day change, as held.
    const own = isGeneratedCause(row.cancelCause) || row.cancelCause === KEPT_DATA;
    push(
      storedByKey,
      keyOf(
        own ? (row.cancelCause ?? '') : 'held',
        row.unitId,
        row.subjectId,
        row.date,
        row.start,
        row.end,
      ),
      row,
    );
  }
  const wantedByKey = new Map<string, W[]>();
  for (const block of blocks) {
    for (const lesson of block.lessons) {
      push(
        wantedByKey,
        keyOf(
          lesson.cause ?? 'held',
          lesson.unitId,
          lesson.subjectId,
          lesson.date,
          lesson.start,
          lesson.end,
        ),
        lesson,
      );
    }
  }
  const pairs = new Map<W, PairStored>();
  const paired = new Set<string>();
  for (const [key, wanted] of wantedByKey) {
    const candidates = [...(storedByKey.get(key) ?? [])];
    const ordered = [...wanted].sort((a, b) => compare(a.entryId, b.entryId));
    const take = (lesson: W, found: PairStored) => {
      pairs.set(lesson, found);
      paired.add(found.id);
      candidates.splice(candidates.indexOf(found), 1);
    };
    // Equal teacher and room first, then by id (`publishImpact`).
    for (const lesson of ordered) {
      const same = candidates.find(
        (one) => one.teacherId === lesson.teacherId && one.roomId === lesson.roomId,
      );
      if (same !== undefined) take(lesson, same);
    }
    for (const lesson of ordered) {
      const next = candidates[0];
      if (pairs.has(lesson) || next === undefined) continue;
      take(lesson, next);
    }
  }

  // Pass 2 (task 6.1b-1, decision 6): by pattern entry, pattern date and date.
  const placeOf = (
    entry: string,
    patternDate: string,
    date: string,
    unit: string,
    subject: string,
  ) => `${entry}|${patternDate}|${date}|${unit}|${subject}`;
  const storedAt = new Map<string, PairStored[]>();
  for (const row of byId) {
    if (paired.has(row.id) || row.entryId === undefined || row.patternDate === undefined) continue;
    push(
      storedAt,
      placeOf(row.entryId, row.patternDate, row.date, row.unitId, row.subjectId),
      row,
    );
  }
  const second = new Set<W>();
  for (const block of blocks) {
    for (const lesson of [...block.lessons].sort((a, b) => compare(a.entryId, b.entryId))) {
      if (pairs.has(lesson) || lesson.patternDate === undefined) continue;
      const found = storedAt
        .get(placeOf(lesson.entryId, lesson.patternDate, lesson.date, lesson.unitId, lesson.subjectId))
        ?.find((one) => !paired.has(one.id));
      if (found === undefined) continue;
      pairs.set(lesson, found);
      paired.add(found.id);
      second.add(lesson);
    }
  }

  // Each stored block goes to one wanted block at most (must-fix 2), never a
  // pinned one; the block of the most paired lessons with data first.
  const taken = new Set<string>();
  const recreated = new Map<W, PairStored>();
  const reused = blocks.map((block) => {
    const counts = new Map<string, { data: number; all: number }>();
    for (const lesson of block.lessons) {
      const found = pairs.get(lesson);
      if (found === undefined || taken.has(found.blockId) || pinned.has(found.blockId)) continue;
      const count = counts.get(found.blockId) ?? { data: 0, all: 0 };
      counts.set(found.blockId, {
        data: count.data + (holding.has(found.id) ? 1 : 0),
        all: count.all + 1,
      });
    }
    const [best] = [...counts.entries()].sort(
      (a, b) => b[1].data - a[1].data || b[1].all - a[1].all || compare(a[0], b[0]),
    );
    const chosen = best?.[0] ?? null;
    if (chosen !== null) taken.add(chosen);
    for (const lesson of block.lessons) {
      const found = pairs.get(lesson);
      if (found !== undefined && found.blockId !== chosen) {
        pairs.delete(lesson);
        recreated.set(lesson, found);
      }
    }
    return chosen;
  });
  return { pairs, reused, recreated, second };
}

/**
 * A stored lesson as `pairDated` reads it, its times in minutes from
 * `begins` of its date; the preview reads it the same way (task 5.5b-2).
 */
export function storedPairOf(
  row: Omit<StoredRow, 'load_row_id' | 'pattern_entry_id' | 'cancel_reason'>,
  begins: (date: string) => Date,
): PairStored {
  const minutesOf = (moment: Date) =>
    Math.round((moment.getTime() - begins(row.lesson_date).getTime()) / MINUTE);
  return {
    id: row.id,
    blockId: row.block_id,
    date: row.lesson_date,
    start: minutesOf(row.starts_at),
    end: minutesOf(row.ends_at),
    unitId: row.class_id ?? row.group_id ?? '',
    subjectId: row.subject_id,
    teacherId: row.teacher_id,
    roomId: row.room_id,
    cancelCause: row.cancel_cause,
  };
}

/** A stored lesson as an audit entry keeps it (`RemovedLesson`). */
function removedOf(row: Omit<StoredRow, 'load_row_id' | 'pattern_entry_id' | 'cancel_reason'>): RemovedLesson {
  return {
    id: row.id,
    date: row.lesson_date,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    classId: row.class_id,
    groupId: row.group_id,
    subjectId: row.subject_id,
    teacherId: row.teacher_id,
    roomId: row.room_id,
    cancelCause: row.cancel_cause,
  };
}

/**
 * The pattern date of each stored lesson named (task 6.1b-1, decision 6): the
 * date its oldest one-day move in force moved it from, as `lessonPlacesOf`
 * (`substitutions-read.ts`) reads it; else its own date. It matches `patternDateOf` of the lesson a version wants there, so a
 * lesson moved onto the same weekday a week later never pairs with the
 * entry's own lesson of that date (`.claude/rules/timetable.md`).
 */
async function storedPatternDates(
  transaction: Transaction,
  rows: readonly StoredRow[],
): Promise<Map<string, string>> {
  const dates = new Map(rows.map((row) => [row.id, row.lesson_date]));
  if (rows.length === 0) return dates;
  const moved = await sql<{ lesson_id: string; from_date: string }>`
    select distinct on (c.lesson_id) c.lesson_id, c.from_date::text as from_date
    from lesson_day_changes c
    where c.lesson_id = any(${rows.map((row) => row.id)}::uuid[])
      and c.kind = 'move'
      and not exists (select 1 from lesson_day_change_ends e where e.change_id = c.id)
    order by c.lesson_id, c.changed_at, c.id
  `.execute(transaction);
  for (const one of moved.rows) dates.set(one.lesson_id, one.from_date);
  return dates;
}

/** What a write of dated lessons keeps, by `datedKeeps`. */
export interface DatedKeeps {
  readonly paired: ReturnType<typeof pairDated<Wanted>>;
  /** The stored blocks that stay under their version: each holds a lesson kept with data. */
  readonly pinned: ReadonlySet<string>;
  /** The stored lessons of the run that hold data (`lessonsHoldingData`). */
  readonly holding: ReadonlySet<string>;
  /** The stored lessons with data that no wanted lesson pairs: kept, cancelled `kept_data`. */
  readonly kept: readonly StoredRow[];
  /** The stored lessons with data that pair but would change block: the write is refused. */
  readonly refused: readonly StoredRow[];
}

/**
 * What a write of dated lessons does with the stored lessons that hold data
 * (task 6.1b-1, decisions 2 and 3; `06`, What a change does to existing data:
 * "Removed, if they hold no data", "Lessons that already hold data are kept
 * and listed"; Protection: "A dated lesson that already has attendance or
 * marks cannot be deleted"). The writer writes from it and the publish
 * preview reads it, so both are one computation.
 *
 * A stored lesson with data that no wanted lesson pairs stays in its block,
 * and its block is pinned: it stays under its own version and pattern block,
 * never reused or re-pointed (`lesson_repoint_check`, 0079). The pairing runs
 * again without the pinned blocks until none is added; the set only grows. A
 * stored lesson with data that pairs but would be created again in another
 * block, its block pinned or reused by another wanted block, can neither stay
 * nor move (a lesson never changes block, 0058): it refuses the write.
 */
export async function datedKeeps(
  transaction: Transaction,
  stored: readonly StoredRow[],
  blocks: readonly WantedBlock[],
  begins: (date: string) => Date,
): Promise<DatedKeeps> {
  const holding = await lessonsHoldingData(
    transaction,
    stored.map((row) => row.id),
  );
  const patternDates = await storedPatternDates(transaction, stored);
  const pairStored = stored.map((row) => ({
    ...storedPairOf(row, begins),
    entryId: row.pattern_entry_id,
    patternDate: patternDates.get(row.id) ?? row.lesson_date,
  }));
  const { paired, pinned } = pinnedPairing(pairStored, blocks, holding);
  const pairedIds = new Set(
    [...paired.pairs.values(), ...paired.recreated.values()].map((one) => one.id),
  );
  const recreated = new Set([...paired.recreated.values()].map((one) => one.id));
  return {
    paired,
    pinned,
    holding,
    kept: stored.filter((row) => holding.has(row.id) && !pairedIds.has(row.id)),
    refused: stored.filter((row) => holding.has(row.id) && recreated.has(row.id)),
  };
}

/**
 * The pairing of `datedKeeps` (task 6.1b-1, decision 2): `pairDated` run
 * again with the block of each stored lesson of `holding` that no wanted
 * lesson pairs pinned, until no block is added; the set only grows, so it
 * ends.
 */
export function pinnedPairing<W extends PairWanted>(
  stored: readonly PairStored[],
  blocks: readonly { readonly lessons: readonly W[] }[],
  holding: ReadonlySet<string>,
): { paired: ReturnType<typeof pairDated<W>>; pinned: Set<string> } {
  const pinned = new Set<string>();
  for (;;) {
    const paired = pairDated(stored, blocks, { pinned, holding });
    const pairedIds = new Set(
      [...paired.pairs.values(), ...paired.recreated.values()].map((one) => one.id),
    );
    const lost = stored.filter(
      (one) => holding.has(one.id) && !pairedIds.has(one.id) && !pinned.has(one.blockId),
    );
    if (lost.length === 0) return { paired, pinned };
    for (const one of lost) pinned.add(one.blockId);
  }
}

/**
 * Task 6.1b-1 (decision 3): a write that would move a lesson with data to
 * another block is refused, `lessons_hold_data`, one detail per lesson.
 */
function refuseHeldData(keeps: DatedKeeps): void {
  if (keeps.refused.length === 0) return;
  const details: ErrorDetail[] = keeps.refused.map((row) => ({
    path: `lessons.${row.id}`,
    code: 'lessons_hold_data',
    message: 'The lesson holds data and would have to move to another block.',
    recordId: row.id,
    day: row.lesson_date,
  }));
  throw new ApiException('lessons_hold_data', 409, undefined, details);
}

/**
 * Cancels each lesson kept with data `kept_data` (task 6.1b-1, review
 * correction 1: whatever its earlier cancel; an exam's link goes with an
 * exam's cancel, 0094), and gives the ones it cancels. One already kept is
 * left alone and not listed again (decision 4).
 */
async function keepWithData(
  transaction: Transaction,
  rows: readonly StoredRow[],
): Promise<KeptLesson[]> {
  const fresh = rows.filter((row) => row.cancel_cause !== KEPT_DATA);
  if (fresh.length === 0) return [];
  const exams = fresh.filter((row) => row.cancel_cause === 'exam').map((row) => row.id);
  if (exams.length > 0) {
    await transaction.deleteFrom('lesson_exam_cancels').where('lesson_id', 'in', exams).execute();
  }
  for (let index = 0; index < fresh.length; index += BATCH) {
    await transaction
      .updateTable('lessons')
      .set({ cancel_cause: KEPT_DATA, cancel_reason: null })
      .where(
        'id',
        'in',
        fresh.slice(index, index + BATCH).map((row) => row.id),
      )
      .execute();
  }
  return fresh.map((row) => ({ ...removedOf(row), reason: row.cancel_reason, cause: KEPT_DATA }));
}


/**
 * The stored blocks and lessons of a branch from `firstDate` to `lastDate`,
 * in the order of their id; with `lock`, `for update`, as the writer takes
 * them.
 */
async function storedRunOf(
  transaction: Transaction,
  branchId: string,
  firstDate: string,
  lastDate: string,
  lock: boolean,
): Promise<{ allBlocks: StoredBlock[]; allStored: StoredRow[] }> {
  const blocks = transaction
    .selectFrom('lesson_blocks')
    .select(['id', 'version_id', 'pattern_block_id', 'double_pair_id', 'starts_at', 'ends_at'])
    .where('branch_id', '=', branchId)
    .where('lesson_date', '>=', firstDate)
    .where('lesson_date', '<=', lastDate)
    .orderBy('id');
  const allBlocks = await (lock ? blocks.forUpdate() : blocks).execute();
  if (allBlocks.length === 0) return { allBlocks, allStored: [] };
  const lessons = transaction
    .selectFrom('lessons')
    .select([
      'id',
      'block_id',
      sql<string>`lesson_date::text`.as('lesson_date'),
      'starts_at',
      'ends_at',
      'class_id',
      'group_id',
      'subject_id',
      'load_row_id',
      'pattern_entry_id',
      'teacher_id',
      'room_id',
      'cancel_cause',
      'cancel_reason',
    ])
    .where('branch_id', '=', branchId)
    .where('lesson_date', '>=', firstDate)
    .where('lesson_date', '<=', lastDate)
    .orderBy('id');
  const allStored = await (lock ? lessons.forUpdate() : lessons).execute();
  return { allBlocks, allStored };
}

/** A lesson of a preview's list of lessons with data (task 6.1b-1): its place in minutes of its day. */
export interface KeepLine {
  readonly id: string;
  readonly date: string;
  readonly start: number;
  readonly end: number;
  readonly unitId: string;
  readonly subjectId: string;
  readonly teacherId: string | null;
  readonly roomId: string | null;
  /** Its cancel before the write (review correction 1). */
  readonly cancelCause: string | null;
}

/**
 * The lessons with data that a write of the run would keep cancelled
 * `kept_data`, and those that would refuse it (task 6.1b-1, decision 5,
 * review correction 2; `06`, Impact preview: "any lesson holding data that
 * blocks a removal"): `datedKeeps` over the stored lessons and the lessons
 * the version wants, as `writeDatedLessons` reads them, without a lock. The
 * publish preview reads it; a preview that runs the write reads the write.
 */
export async function keepsOfRun(
  transaction: Transaction,
  input: {
    readonly state: PatternState;
    readonly findings: DatedFindings;
    readonly firstDate: string;
    readonly lastDate: string;
    readonly plan: DayWritePlan | null;
    /** The stored lessons a kept move from outside the run keeps (`DayWritePlan.keepStored`). */
    readonly keepStored: ReadonlySet<string>;
  },
): Promise<{ kept: KeepLine[]; refused: KeepLine[] }> {
  const { allStored } = await storedRunOf(
    transaction,
    input.state.pattern.model.data.branchId,
    input.firstDate,
    input.lastDate,
    false,
  );
  const keptBlocks = new Set(
    allStored.filter((one) => input.keepStored.has(one.id)).map((one) => one.block_id),
  );
  const stored = allStored.filter(
    (one) => !input.keepStored.has(one.id) && !keptBlocks.has(one.block_id),
  );
  const wanted = await wantedOf(transaction, input.state, input.findings, input.plan);
  const keeps = await datedKeeps(transaction, stored, wanted, input.findings.begins);
  const lineOf = (row: StoredRow): KeepLine => {
    const pair = storedPairOf(row, input.findings.begins);
    return {
      id: row.id,
      date: pair.date,
      start: pair.start,
      end: pair.end,
      unitId: pair.unitId,
      subjectId: pair.subjectId,
      teacherId: row.teacher_id,
      roomId: row.room_id,
      cancelCause: row.cancel_cause,
    };
  };
  return {
    kept: keeps.kept.filter((row) => row.cancel_cause !== KEPT_DATA).map(lineOf),
    refused: keeps.refused.map(lineOf),
  };
}


/** Whether a stored cancel is one the expansion writes, not a one-day change. */
export const isGeneratedCause = (cause: string | null): boolean =>
  cause !== null && GENERATED_CAUSES.has(cause);

/** The vacancies among `teacherIds`. */
export async function vacanciesOf(
  transaction: Transaction,
  teacherIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(teacherIds)];
  if (ids.length === 0) return new Set();
  const rows = await transaction
    .selectFrom('staff')
    .select('id')
    .where('id', 'in', ids)
    .where('kind', '=', 'vacancy')
    .execute();
  return new Set(rows.map((one) => one.id));
}

/**
 * The teacher a dated lesson is written with (decision 7, should-fix 6): a
 * lesson in the needs-a-teacher list has none, a vacancy keeps its own. The
 * preview gives its "after" side the same (task 5.5b-2).
 */
export function writtenTeacherOf(
  needs: ReadonlySet<string>,
  vacancies: ReadonlySet<string>,
  lesson: { readonly entryId: string; readonly date: string; readonly teacherId: string | null },
): string | null {
  const teacher = lesson.teacherId;
  const needed = needs.has(needKeyOf(lesson.entryId, lesson.date));
  return needed && (teacher === null || !vacancies.has(teacher)) ? null : teacher;
}

/**
 * The date of the pattern block a dated lesson comes from: its own date, or
 * for a lesson a one-day move applied again put on another date, the date it
 * was moved from (task 5.6a-5a). The needs-a-teacher list and a one-day cancel
 * applied again name a lesson by it, so a lesson moved onto a date of its own
 * pattern entry is never taken for the entry's lesson there (spec review of
 * the code, must-fix 1).
 */
export const patternDateOf = (lesson: {
  readonly date: string;
  readonly placement: { readonly blockId: string | null };
}): string => patternIdOf(lesson.placement.blockId ?? '')?.date ?? lesson.date;

/** The key of a lesson of a pattern entry at a place: its pattern block's date and its date (task 5.6a-5a). */
export const placeKeyOf = (entryId: string, patternDate: string, date: string): string =>
  `${entryId}@${patternDate}@${date}`;

/** The key of a lesson in the needs-a-teacher list. */
export const needKeyOf = (entryId: string, date: string): string => `${entryId}@${date}`;

/**
 * Writes the dated lessons of `state`'s version from `firstDate` to
 * `lastDate`, the dates its dated check (`findings`) expanded.
 */
export async function writeDatedLessons(
  transaction: Transaction,
  state: PatternState,
  findings: DatedFindings,
  firstDate: string,
  lastDate: string,
  plan: DayWritePlan | null = null,
  /**
   * Task 5.6b-2c-1: the exams of a calendar save on these dates, written in
   * the deferred span (spec review of the plan, must-fix 1). Task 5.6c-3a:
   * a publish's and a withdraw's too (`exams-kept.ts`); `null` only for a
   * write with no standing exam on its dates.
   */
  exams: ExamWrite | null = null,
): Promise<DatedWrite> {
  const { model } = state.pattern;
  const branchId = model.data.branchId;
  const versionId = state.version.id;
  const begins = findings.begins;

  await sql`set constraints all deferred`.execute(transaction);
  await exams?.start(transaction);

  // The stored blocks and lessons of the run, locked in the order of their id.
  const { allBlocks, allStored } = await storedRunOf(transaction, branchId, firstDate, lastDate, true);
  // Task 5.6a-5a (decision 7): a kept move from a date before the run stays
  // where it is, under its version; the write neither pairs nor removes it.
  const keepStored = plan?.keepStored ?? new Set<string>();
  const keptBlocks = new Set(
    allStored.filter((one) => keepStored.has(one.id)).map((one) => one.block_id),
  );
  const stored = allStored.filter(
    (one) => !keepStored.has(one.id) && !keptBlocks.has(one.block_id),
  );
  const storedBlocks = allBlocks.filter((one) => !keptBlocks.has(one.id));
  // Recorded with the lessons changed (spec review of the code, should-fix 2).
  const storedCancels: ChangedLesson[] = [];
  for (const [id, reason] of plan?.cancelStored ?? []) {
    const row = allStored.find((one) => one.id === id);
    if (row === undefined || row.cancel_cause !== null) continue;
    storedCancels.push({
      id,
      teacherId: { from: row.teacher_id, to: row.teacher_id },
      roomId: { from: row.room_id, to: row.room_id },
      cancel: { from: null, to: 'reason' },
    });
    await transaction
      .updateTable('lessons')
      .set({ cancel_cause: 'reason', cancel_reason: reason })
      .where('id', '=', id)
      .execute();
  }
  const blockById = new Map<string, StoredBlock>(storedBlocks.map((one) => [one.id, one]));

  const wantedBlocks = await wantedOf(transaction, state, findings, plan);

  // The pairs and the blocks reused (must-fix 1 and 2); task 6.1b-1: the
  // lessons with data kept, or the write refused (decisions 2 and 3).
  const rowOf = new Map(stored.map((row) => [row.id, row]));
  const keeps = await datedKeeps(transaction, stored, wantedBlocks, begins);
  refuseHeldData(keeps);
  const { paired } = keeps;
  const pairOf = new Map<Wanted, StoredRow>();
  for (const [lesson, found] of paired.pairs) {
    const row = rowOf.get(found.id);
    if (row !== undefined) pairOf.set(lesson, row);
  }
  wantedBlocks.forEach((block, index) => {
    block.reused = paired.reused[index] ?? null;
  });
  const taken = new Set(paired.reused.filter((one): one is string => one !== null));
  const held = await bulkHeldOf(
    transaction,
    branchId,
    wantedBlocks.flatMap((block) =>
      block.lessons.flatMap((lesson) => {
        const found = pairOf.get(lesson) ?? paired.recreated.get(lesson);
        const row = found === undefined ? undefined : rowOf.get(found.id);
        return row === undefined ? [] : [{ lesson, row }];
      }),
    ),
  );

  // The removed lessons first, so the unique keys of a block
  // (`lessons_block_class_key`, `lessons_block_group_key`) never meet a
  // lesson on its way out. No case of it arises today (review of #152): a
  // class lesson is a block of one, and a group of one subject has one
  // lesson at a time, which pairs; the order keeps the write safe whatever
  // pairs.
  const kept = new Set([...pairOf.values()].map((one) => one.id));
  const keptData = new Set(keeps.kept.map((one) => one.id));
  const removedRows = stored.filter((one) => !kept.has(one.id) && !keptData.has(one.id));
  const endedAt = await transactionMoment(transaction);
  // Task 5.7b-3: the rows of the kept substitutions are settled after the
  // write (spec review of the plan, must-fix 1).
  const exceptRowIds = new Set(
    [...(plan?.substitutes.values() ?? [])].filter((one) => one.apply).map((one) => one.rowId),
  );
  // Task 5.7b-1: a substitution of a removed lesson ends before the lesson
  // goes; task 6.1b-1 (review correction 3): of a lesson kept with data too.
  const substitutionsDropped = await endSubstitutionRows(transaction, {
    lessonIds: [...removedRows, ...keeps.kept].map((one) => one.id),
    cause: 'dropped',
    accountId: state.accountId,
    moment: endedAt,
    exceptRowIds,
  });
  for (let index = 0; index < removedRows.length; index += BATCH) {
    await transaction
      .deleteFrom('lessons')
      .where(
        'id',
        'in',
        removedRows.slice(index, index + BATCH).map((one) => one.id),
      )
      .execute();
  }
  const keptWithData = await keepWithData(transaction, keeps.kept);

  // The double pairs per date: a pattern pair keeps the stored pair of its
  // two reused blocks when they share one, else gets a new one (5.4c-3a
  // decision 12); a block of no pattern pair has none.
  const pairPattern = new Map(state.blocks.map((one) => [one.id, one.doublePairId]));
  const byPair = new Map<string, WantedBlock[]>();
  for (const block of wantedBlocks) {
    const pattern = pairPattern.get(block.patternBlockId) ?? null;
    // Task 5.6a-5a: a block moved keeps the pair of the date it came from.
    if (pattern !== null) push(byPair, `${pattern}|${block.patternDate}|${block.date}`, block);
  }
  const datedPair = new Map<WantedBlock, string | null>();
  for (const blocks of byPair.values()) {
    const held = blocks.map((one) =>
      one.reused === null ? null : (blockById.get(one.reused)?.double_pair_id ?? null),
    );
    const [first] = held;
    const shared =
      blocks.length === 2 &&
      first !== null &&
      first !== undefined &&
      held.every((one) => one === first)
        ? first
        : randomUUID();
    for (const block of blocks) datedPair.set(block, shared);
  }

  // The reused blocks re-pointed, then their kept lessons.
  const changed: ChangedLesson[] = [...storedCancels];
  const givenBack: RemovedLesson[] = [];
  const restaffed: string[] = [];
  let keptCount = 0;
  const minuteOf = (date: string, minutes: number) =>
    new Date(begins(date).getTime() + minutes * MINUTE);
  for (const block of wantedBlocks) {
    if (block.reused === null) continue;
    const before = blockById.get(block.reused);
    const pair = datedPair.get(block) ?? null;
    if (
      before !== undefined &&
      (before.version_id !== versionId ||
        before.pattern_block_id !== block.patternBlockId ||
        before.double_pair_id !== pair)
    ) {
      await transaction
        .updateTable('lesson_blocks')
        .set({
          version_id: versionId,
          pattern_block_id: block.patternBlockId,
          double_pair_id: pair,
        })
        .where('id', '=', block.reused)
        .execute();
    }
    // Task 6.1b-1 (decision 6): a block paired by pass 2 at other times moves
    // in place; its lessons follow by the key of 0058, and the history writes
    // a line per lesson (0105).
    const startsAt = minuteOf(block.date, block.start);
    const endsAt = minuteOf(block.date, block.end);
    const times =
      before !== undefined &&
      (before.starts_at.getTime() !== startsAt.getTime() ||
        before.ends_at.getTime() !== endsAt.getTime())
        ? {
            from: { startsAt: before.starts_at.toISOString(), endsAt: before.ends_at.toISOString() },
            to: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
          }
        : undefined;
    if (times !== undefined) {
      await transaction
        .updateTable('lesson_blocks')
        .set({ starts_at: startsAt, ends_at: endsAt })
        .where('id', '=', block.reused)
        .execute();
    }
    for (const lesson of block.lessons) {
      const found = pairOf.get(lesson);
      if (found === undefined) continue;
      keptCount += 1;
      const moved =
        found.load_row_id !== lesson.loadRowId || found.pattern_entry_id !== lesson.entryId;
      const staffed = found.teacher_id !== lesson.teacherId || found.room_id !== lesson.roomId;
      // The cancel the lesson keeps: a one-day cancel stays on it (decision 8
      // of 5.5b-1). Task 6.1b-1 (decision 6): a pair of pass 2 takes the
      // cancel a lesson created there would take (the expansion's, a one-day
      // change or a bulk cancel applied again, or none), as the lesson was
      // removed and created again before.
      const second = paired.second.has(lesson);
      const kind =
        lesson.cause !== null
          ? { cause: lesson.cause, reason: null }
          : !second && (found.cancel_cause === 'reason' || found.cancel_cause === 'exam')
            ? { cause: found.cancel_cause, reason: found.cancel_reason }
            : { cause: null, reason: null };
      // Task 5.6a-5a: a one-day cancel applied again on a lesson held.
      const oneDay =
        kind.cause !== null
          ? null
          : second
            ? (lesson.oneDayCancel ?? lesson.bulkCancel)
            : lesson.oneDayCancel;
      // Task 5.6a-5b-1: a part of a block decided `keep` is held.
      const hold = !second && held.has(found.id);
      const cancel = hold
        ? { cause: null, reason: null }
        : oneDay !== null
          ? { cause: 'reason', reason: oneDay }
          : kind;
      const recancelled =
        cancel.cause !== found.cancel_cause || cancel.reason !== found.cancel_reason;
      if (!moved && !staffed && !recancelled && times === undefined) continue;
      if (found.teacher_id !== lesson.teacherId) restaffed.push(found.id);
      if (found.cancel_cause === 'exam' && cancel.cause !== 'exam') {
        // 0094: a lesson is cancelled `exam` exactly when it has a link.
        await transaction
          .deleteFrom('lesson_exam_cancels')
          .where('lesson_id', '=', found.id)
          .execute();
      }
      if (moved || staffed || recancelled) {
        await transaction
          .updateTable('lessons')
          .set({
            load_row_id: lesson.loadRowId,
            pattern_entry_id: lesson.entryId,
            teacher_id: lesson.teacherId,
            room_id: lesson.roomId,
            cancel_cause: cancel.cause,
            cancel_reason: cancel.reason,
          })
          .where('id', '=', found.id)
          .execute();
      }
      if (staffed || recancelled || times !== undefined) {
        changed.push({
          id: found.id,
          teacherId: { from: found.teacher_id, to: lesson.teacherId },
          roomId: { from: found.room_id, to: lesson.roomId },
          ...(recancelled ? { cancel: { from: found.cancel_cause, to: cancel.cause } } : {}),
          ...(times === undefined ? {} : { times }),
        });
      }
      if (found.cancel_cause === KEPT_DATA) {
        givenBack.push(removedOf(found));
      } else if (
        cancel.cause !== null &&
        isGeneratedCause(cancel.cause) &&
        recancelled &&
        keeps.holding.has(found.id)
      ) {
        keptWithData.push({ ...removedOf(found), reason: found.cancel_reason, cause: cancel.cause });
      }
    }
  }

  // Task 5.7b-1: a kept lesson given another teacher drops its substitution.
  const substitutionsRestaffed = await endSubstitutionRows(transaction, {
    lessonIds: restaffed,
    cause: 'dropped',
    accountId: state.accountId,
    moment: endedAt,
    exceptRowIds,
  });
  const substitutesPlaced = new Map<string, string>();
  for (const [lesson, found] of pairOf) {
    if (lesson.substitutedAt !== null) substitutesPlaced.set(lesson.substitutedAt, found.id);
  }

  // The new blocks and lessons.
  const quarters = await transaction
    .selectFrom('quarters')
    .select([
      'id',
      sql<string | null>`start_date::text`.as('start_date'),
      sql<string | null>`end_date::text`.as('end_date'),
    ])
    .where('academic_year_id', '=', state.version.academic_year_id)
    .execute();
  const quarterOf = (date: string): string => {
    const found = quarters.find(
      (one) =>
        one.start_date !== null &&
        one.end_date !== null &&
        one.start_date <= date &&
        date <= one.end_date,
    );
    if (found === undefined) throw new Error(`No quarter holds ${date}.`);
    return found.id;
  };
  const moment = (date: string, minutes: number) =>
    new Date(begins(date).getTime() + minutes * MINUTE);

  const fresh = wantedBlocks.filter((one) => one.reused === null);
  const blockIds = new Map<WantedBlock, string>();
  for (let index = 0; index < fresh.length; index += BATCH) {
    const part = fresh.slice(index, index + BATCH);
    const ids = await transaction
      .insertInto('lesson_blocks')
      .values(
        part.map((block) => ({
          branch_id: branchId,
          academic_year_id: state.version.academic_year_id,
          quarter_id: quarterOf(block.date),
          lesson_date: block.date,
          starts_at: moment(block.date, block.start),
          ends_at: moment(block.date, block.end),
          version_id: versionId,
          pattern_block_id: block.patternBlockId,
          double_pair_id: datedPair.get(block) ?? null,
        })),
      )
      .returning([
        'id',
        'pattern_block_id',
        sql<string>`lesson_date::text`.as('lesson_date'),
        'starts_at',
      ])
      .execute();
    // Review of #152, finding 3: matched by the pattern block, the date and
    // the start (task 5.6a-5a: a block moved onto a date of its own pattern
    // block), unique per wanted block; `returning` gives the rows in no set order.
    const idOf = new Map(
      ids.map((one) => [
        `${one.pattern_block_id ?? ''}@${one.lesson_date}@${String(one.starts_at.getTime())}`,
        one.id,
      ]),
    );
    for (const block of part) {
      const id = idOf.get(
        `${block.patternBlockId}@${block.date}@${String(moment(block.date, block.start).getTime())}`,
      );
      if (id === undefined) throw new Error('A block was not inserted.');
      blockIds.set(block, id);
    }
  }
  const inserts = wantedBlocks.flatMap((block) =>
    block.lessons
      .filter((lesson) => !pairOf.has(lesson))
      .map((lesson) => {
        const blockId = block.reused ?? blockIds.get(block);
        if (blockId === undefined) throw new Error('A lesson has no block.');
        // Task 5.6a-1 (build decision): a lesson with a one-day cancel that
        // is created again in another block keeps it, so a publish never
        // changes a one-day cancel and the impact preview, which shows such a
        // lesson as held on both sides, names the teachers it notifies.
        const again = paired.recreated.get(lesson);
        // Task 5.6a-5a: or one applied again (`DayWritePlan.cancels`).
        const oneDay =
          lesson.cause !== null || (again !== undefined && held.has(again.id))
            ? null
            : again?.cancelCause === 'reason'
              ? (rowOf.get(again.id)?.cancel_reason ?? null)
              : // Task 5.6a-5b-1 (decision 4): a bulk cancel applied again
                // reaches a lesson the write creates, never one it creates
                // again from a stored lesson, which keeps its state (a restore
                // stands; spec review of the code, should-fix 2).
                (lesson.oneDayCancel ?? (again === undefined ? lesson.bulkCancel : null));
        return {
          branch_id: branchId,
          block_id: blockId,
          lesson_date: lesson.date,
          starts_at: moment(lesson.date, lesson.start),
          ends_at: moment(lesson.date, lesson.end),
          class_id: lesson.classId,
          group_id: lesson.groupId,
          subject_id: lesson.subjectId,
          load_row_id: lesson.loadRowId,
          pattern_entry_id: lesson.entryId,
          teacher_id: lesson.teacherId,
          room_id: lesson.roomId,
          cancel_cause: oneDay === null ? lesson.cause : 'reason',
          cancel_reason: oneDay,
        };
      }),
  );
  // A block holds one lesson of each class or group (`lessons_block_class_key`,
  // `lessons_block_group_key`, 0058), and a pattern entry is one lesson of its
  // block, so `block|entry` names one inserted lesson.
  const insertedAt = new Map(
    wantedBlocks.flatMap((block) =>
      block.lessons
        .filter((lesson) => !pairOf.has(lesson) && lesson.substitutedAt !== null)
        .map((lesson) => [
          `${block.reused ?? blockIds.get(block) ?? ''}|${lesson.entryId}`,
          lesson.substitutedAt ?? '',
        ]),
    ),
  );
  for (let index = 0; index < inserts.length; index += BATCH) {
    const written = await transaction
      .insertInto('lessons')
      .values(inserts.slice(index, index + BATCH))
      .returning(['id', 'block_id', 'pattern_entry_id'])
      .execute();
    for (const one of written) {
      const place = insertedAt.get(`${one.block_id}|${one.pattern_entry_id}`);
      if (place !== undefined) substitutesPlaced.set(place, one.id);
    }
  }

  // The stored blocks no new block reuses, empty now; task 6.1b-1: a pinned
  // block stays with its lessons kept with data.
  const emptied = storedBlocks
    .filter((one) => !taken.has(one.id) && !keeps.pinned.has(one.id))
    .map((one) => one.id);
  // Task 5.6b-2c-1: a class kept out of a block for an exam goes first
  // (`lesson_block_class_outs_block_fkey` is not deferrable).
  await exams?.beforeBlocksDeleted(transaction, emptied);
  for (let index = 0; index < emptied.length; index += BATCH) {
    await transaction
      .deleteFrom('lesson_blocks')
      .where('id', 'in', emptied.slice(index, index + BATCH))
      .execute();
  }

  await exams?.end(transaction);

  await sql`set constraints all immediate`.execute(transaction);

  return {
    substitutionsDropped: [...substitutionsDropped, ...substitutionsRestaffed],
    substitutesPlaced,
    firstDate,
    lastDate,
    created: inserts.length,
    kept: keptCount,
    cancelled: wantedBlocks.reduce(
      (sum, block) => sum + block.lessons.filter((one) => one.cause !== null).length,
      0,
    ),
    removed: removedRows.map(removedOf),
    changed,
    keptWithData,
    givenBack,
  };
}

/**
 * Task 5.6a-5b-1 (review of the code, round 1): the stored lessons a decided
 * `keep` holds, by id: the lesson at a held place (`BulkHold`), kept or
 * created again from it, whose cancel is the bulk cancel's own. The stored
 * rows do not tell a bulk cancel's cancel from a one-day cancel, so it is read
 * as cause `reason` with the bulk cancel's reason and no `lesson.cancel` of the
 * lesson recorded after the bulk cancel (decided without the owner).
 */
async function bulkHeldOf(
  transaction: Transaction,
  branchId: string,
  candidates: readonly { lesson: Wanted; row: StoredRow }[],
): Promise<Set<string>> {
  const matching = candidates.flatMap(({ lesson, row }) => {
    const hold = lesson.bulkHold;
    return hold !== null &&
      lesson.cause === null &&
      lesson.oneDayCancel === null &&
      lesson.bulkCancel === null &&
      row.cancel_cause === 'reason' &&
      row.cancel_reason === hold.reason
      ? [{ id: row.id, since: hold.since }]
      : [];
  });
  if (matching.length === 0) return new Set();
  const earliest = new Date(Math.min(...matching.map((one) => one.since.getTime())));
  const cancels = await transaction
    .selectFrom('audit_log')
    .select(['occurred_at', sql<string[]>`new_value -> 'lessonIds'`.as('lesson_ids')])
    .where('branch_id', '=', branchId)
    .where('action', '=', 'lesson.cancel')
    .where('occurred_at', '>', earliest)
    .where(
      sql<boolean>`new_value -> 'lessonIds' ?| ${sql.val(matching.map((one) => one.id))}::text[]`,
    )
    .execute();
  return new Set(
    matching
      .filter(
        (one) =>
          !cancels.some(
            (entry) =>
              entry.occurred_at.getTime() > one.since.getTime() &&
              Array.isArray(entry.lesson_ids) &&
              entry.lesson_ids.includes(one.id),
          ),
      )
      .map((one) => one.id),
  );
}

/**
 * The dated blocks of the expansion, in the order they choose a stored block:
 * date, start, pattern block (must-fix 2). A lesson in the needs-a-teacher
 * list has no teacher, a vacancy keeps its own (decision 7, should-fix 6); a
 * cancelled block takes its pattern block's times (decision 6).
 */
async function wantedOf(
  transaction: Transaction,
  state: PatternState,
  findings: DatedFindings,
  plan: DayWritePlan | null,
): Promise<WantedBlock[]> {
  const { model } = state.pattern;
  const vacancies = await vacanciesOf(
    transaction,
    model.data.rows.map((row) => row.teacherId),
  );
  const needs = new Set(findings.needsTeacher.map((one) => needKeyOf(one.entryId, one.date)));
  const patternBlocks = new Map(state.blocks.map((one) => [one.id, one]));
  const blocks = new Map<string, WantedBlock>();
  const blockOf = (
    patternBlockId: string,
    patternDate: string,
    date: string,
    start: number,
    end: number,
  ) => {
    const key = `${patternBlockId}@${patternDate}@${date}`;
    let found = blocks.get(key);
    if (found === undefined) {
      found = { patternBlockId, patternDate, date, start, end, lessons: [], reused: null };
      blocks.set(key, found);
    }
    return found;
  };

  for (const lesson of findings.dated.lessons) {
    const { placement } = lesson;
    const dated = patternIdOf(placement.blockId ?? '');
    const place = placeKeyOf(lesson.entryId, dated?.date ?? lesson.date, lesson.date);
    // Task 5.7b-3: a kept substitution keeps its substitute (the findings
    // carry it); one whose lesson another item cancels gets the version's
    // teacher back.
    const substitute = plan?.substitutes.get(place);
    const patternBlockId = dated?.id ?? '';
    const loadRowId = placement.loadRowId ?? '';
    // Task 5.6a-5a: a block moved by a one-day change applied again is on
    // the date it was moved to, and stays apart from its pattern block's
    // own lessons there.
    blockOf(
      patternBlockId,
      dated?.date ?? lesson.date,
      lesson.date,
      placement.start,
      placement.end,
    ).lessons.push({
      patternBlockId,
      entryId: lesson.entryId,
      patternDate: dated?.date ?? lesson.date,
      loadRowId,
      date: lesson.date,
      start: placement.start,
      end: placement.end,
      classId: placement.classId,
      groupId: placement.groupId,
      unitId: placement.classId ?? placement.groupId ?? '',
      subjectId: placement.subjectId ?? '',
      teacherId:
        substitute?.apply === true
          ? substitute.substituteId
          : writtenTeacherOf(needs, vacancies, {
              entryId: lesson.entryId,
              date: dated?.date ?? lesson.date,
              teacherId:
                substitute === undefined
                  ? (placement.teacherIds[0] ?? null)
                  : substitute.versionTeacherId,
            }),
      roomId: placement.roomId,
      cause: null,
      oneDayCancel:
        plan?.cancels.get(placeKeyOf(lesson.entryId, dated?.date ?? lesson.date, lesson.date)) ??
        null,
      bulkCancel:
        plan?.bulkCancels.get(
          placeKeyOf(lesson.entryId, dated?.date ?? lesson.date, lesson.date),
        ) ?? null,
      bulkHold:
        plan?.bulkHolds.get(placeKeyOf(lesson.entryId, dated?.date ?? lesson.date, lesson.date)) ??
        null,
      substitutedAt: substitute?.apply === true ? place : null,
    });
  }
  for (const cancelled of findings.dated.cancelled) {
    const pattern = patternBlocks.get(cancelled.blockId);
    if (pattern === undefined) throw new Error(`No pattern block ${cancelled.blockId}.`);
    const block = blockOf(pattern.id, cancelled.date, cancelled.date, pattern.start, pattern.end);
    // Task 5.6b-3 (code review round 1): only the entries cancelled, at the
    // time of the block: a kept block's part of the grade that is off alone
    // goes into the block its held lessons are written in.
    for (const entry of pattern.lessons.filter((one) => cancelled.entryIds.includes(one.id))) {
      const row = model.rowOf(entry.loadRowId);
      block.lessons.push({
        patternBlockId: pattern.id,
        entryId: entry.id,
        patternDate: cancelled.date,
        loadRowId: row.id,
        date: cancelled.date,
        start: block.start,
        end: block.end,
        classId: row.classId,
        groupId: row.groupId,
        unitId: row.classId ?? row.groupId ?? '',
        subjectId: row.subjectId,
        // Review of #152, finding 2: a Tutor row's takes the Tutor of its date.
        teacherId: findings.cancelledTeacher(pattern.id, entry.id, cancelled.date),
        roomId: entry.roomId,
        cause: cancelled.reason,
        oneDayCancel: null,
        bulkCancel: null,
        bulkHold: null,
        substitutedAt: null,
      });
    }
  }
  return [...blocks.values()].sort(
    (a, b) =>
      compare(a.date, b.date) || a.start - b.start || compare(a.patternBlockId, b.patternBlockId),
  );
}

/**
 * Deletes every stored lesson and block of the branch from `firstDate` to
 * `lastDate` (task 5.5c-2a, decision 11): a withdraw of the first version of
 * the chain leaves its dates with no version. The database refuses a delete
 * dated today or earlier (0079). Task 6.1b-1 (decision 2): a lesson that holds
 * data stays in its block, which stays, cancelled `kept_data`.
 *
 * Task 5.6a-5b-2 (spec review of the plan, must-fix 1): a lesson of
 * `plan.keepStored` (a kept move onto a withdrawn date from a date outside
 * them) stays with its block, cancelled with the reason of
 * `plan.cancelStored`, as `writeDatedLessons` leaves it.
 */
export async function removeDatedLessons(
  transaction: Transaction,
  branchId: string,
  /** Task 5.7b-1: the account of the withdraw, which ends the substitutions of the lessons removed. */
  accountId: string,
  firstDate: string,
  lastDate: string,
  plan: Pick<DayWritePlan, 'keepStored' | 'cancelStored'> | null = null,
  /**
   * Task 5.6c-3a: the standing exams of the dates (each dropped, decision 6):
   * cancelled first, their out rows gone before the blocks.
   */
  exams: ExamWrite | null = null,
): Promise<DatedWrite> {
  await sql`set constraints all deferred`.execute(transaction);
  await exams?.start(transaction);
  const allBlocks = await transaction
    .selectFrom('lesson_blocks')
    .select('id')
    .where('branch_id', '=', branchId)
    .where('lesson_date', '>=', firstDate)
    .where('lesson_date', '<=', lastDate)
    .orderBy('id')
    .forUpdate()
    .execute();
  const allRows = await transaction
    .selectFrom('lessons')
    .select([
      'id',
      sql<string>`lesson_date::text`.as('lesson_date'),
      'starts_at',
      'ends_at',
      'class_id',
      'group_id',
      'subject_id',
      'load_row_id',
      'pattern_entry_id',
      'teacher_id',
      'room_id',
      'cancel_cause',
      'cancel_reason',
      'block_id',
    ])
    .where('branch_id', '=', branchId)
    .where('lesson_date', '>=', firstDate)
    .where('lesson_date', '<=', lastDate)
    .orderBy('id')
    .forUpdate()
    .execute();
  const keepStored = plan?.keepStored ?? new Set<string>();
  const keptBlocks = new Set(
    allRows.filter((one) => keepStored.has(one.id)).map((one) => one.block_id),
  );
  const inRun = allRows.filter((one) => !keptBlocks.has(one.block_id));
  // Task 6.1b-1 (decision 2): a lesson with data stays in its block, which
  // stays under its version, cancelled `kept_data`.
  const holding = await lessonsHoldingData(
    transaction,
    inRun.map((one) => one.id),
  );
  const keptRows = inRun.filter((one) => holding.has(one.id));
  const pinned = new Set(keptRows.map((one) => one.block_id));
  const rows = inRun.filter((one) => !holding.has(one.id));
  const blocks = allBlocks.filter((one) => !keptBlocks.has(one.id) && !pinned.has(one.id));
  const changed: ChangedLesson[] = [];
  for (const [id, reason] of plan?.cancelStored ?? []) {
    const row = allRows.find((one) => one.id === id);
    if (row === undefined || !keptBlocks.has(row.block_id) || row.cancel_cause !== null) continue;
    changed.push({
      id,
      teacherId: { from: row.teacher_id, to: row.teacher_id },
      roomId: { from: row.room_id, to: row.room_id },
      cancel: { from: null, to: 'reason' },
    });
    await transaction
      .updateTable('lessons')
      .set({ cancel_cause: 'reason', cancel_reason: reason })
      .where('id', '=', id)
      .execute();
  }
  // Task 5.6c-3a: a class kept out of a block for an exam goes first
  // (`lesson_block_class_outs_block_fkey` is not deferrable).
  await exams?.beforeBlocksDeleted(
    transaction,
    blocks.map((one) => one.id),
  );
  // Task 5.7b-1: a substitution of a removed lesson ends before the lesson
  // goes; task 6.1b-1 (review correction 3): of a lesson kept with data too.
  const substitutionsDropped = await endSubstitutionRows(transaction, {
    lessonIds: [...rows, ...keptRows].map((one) => one.id),
    cause: 'dropped',
    accountId,
    moment: await transactionMoment(transaction),
  });
  const keptWithData = await keepWithData(transaction, keptRows);
  for (let index = 0; index < rows.length; index += BATCH) {
    await transaction
      .deleteFrom('lessons')
      .where(
        'id',
        'in',
        rows.slice(index, index + BATCH).map((one) => one.id),
      )
      .execute();
  }
  for (let index = 0; index < blocks.length; index += BATCH) {
    await transaction
      .deleteFrom('lesson_blocks')
      .where(
        'id',
        'in',
        blocks.slice(index, index + BATCH).map((one) => one.id),
      )
      .execute();
  }
  await exams?.end(transaction);
  await sql`set constraints all immediate`.execute(transaction);
  return {
    substitutionsDropped,
    substitutesPlaced: new Map(),
    firstDate,
    lastDate,
    created: 0,
    kept: 0,
    cancelled: 0,
    removed: rows.map(removedOf),
    changed,
    keptWithData,
    givenBack: [],
  };
}
