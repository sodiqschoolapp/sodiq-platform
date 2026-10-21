import { randomUUID } from 'node:crypto';
import { patternIdOf } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import type { BulkHold } from './bulk-cancels-kept.js';
import type { ExamWrite } from './calendar-exams.js';
import type { DatedFindings } from './dated-check.js';
import type { DayWritePlan } from './day-changes-kept.js';
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
}

/** The causes the expansion writes; a stored lesson with one of them was cancelled by it. */
const GENERATED_CAUSES = new Set(['not_in_template', 'day_off', 'exam_week']);

/** Rows per insert statement. */
const BATCH = 500;

const MINUTE = 60_000;

/** A lesson the version wants on a date. */
interface Wanted {
  readonly patternBlockId: string;
  readonly entryId: string;
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
}

/**
 * The stored lesson each wanted lesson keeps, one to one, and the stored
 * block each wanted block reuses (`null`: a new block), by the rules of the
 * file's comment. `blocks` come in the order they choose: date, start,
 * pattern block. A pair whose stored lesson is in another block than the one
 * its block reuses is no pair: that lesson is removed and created again.
 */
export function pairDated<W extends PairWanted>(
  stored: readonly PairStored[],
  blocks: readonly { readonly lessons: readonly W[] }[],
): {
  pairs: Map<W, PairStored>;
  reused: (string | null)[];
  /**
   * The pairs dropped because the stored lesson is in another block than the
   * one its block reuses: that lesson is removed and created again, and keeps
   * its one-day cancel (task 5.6a-1, build decision).
   */
  recreated: Map<W, PairStored>;
} {
  const keyOf = (
    held: string,
    unit: string,
    subject: string,
    date: string,
    start: number,
    end: number,
  ) => `${held}|${unit}|${subject}|${date}|${String(start)}|${String(end)}`;
  const storedByKey = new Map<string, PairStored[]>();
  for (const row of [...stored].sort((a, b) => compare(a.id, b.id))) {
    const generated = isGeneratedCause(row.cancelCause);
    push(
      storedByKey,
      keyOf(
        generated ? (row.cancelCause ?? '') : 'held',
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
  for (const [key, wanted] of wantedByKey) {
    const candidates = [...(storedByKey.get(key) ?? [])];
    const ordered = [...wanted].sort((a, b) => compare(a.entryId, b.entryId));
    const take = (lesson: W, found: PairStored) => {
      pairs.set(lesson, found);
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

  // Each stored block goes to one wanted block at most (must-fix 2).
  const taken = new Set<string>();
  const recreated = new Map<W, PairStored>();
  const reused = blocks.map((block) => {
    const counts = new Map<string, number>();
    for (const lesson of block.lessons) {
      const found = pairs.get(lesson);
      if (found === undefined || taken.has(found.blockId)) continue;
      counts.set(found.blockId, (counts.get(found.blockId) ?? 0) + 1);
    }
    const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]));
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
  return { pairs, reused, recreated };
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
  const allBlocks = await transaction
    .selectFrom('lesson_blocks')
    .select(['id', 'version_id', 'pattern_block_id', 'double_pair_id'])
    .where('branch_id', '=', branchId)
    .where('lesson_date', '>=', firstDate)
    .where('lesson_date', '<=', lastDate)
    .orderBy('id')
    .forUpdate()
    .execute();
  const allStored: StoredRow[] =
    allBlocks.length === 0
      ? []
      : await transaction
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
          .orderBy('id')
          .forUpdate()
          .execute();
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

  // The pairs and the blocks reused (must-fix 1 and 2).
  const rowOf = new Map(stored.map((row) => [row.id, row]));
  const paired = pairDated(
    stored.map((row) => storedPairOf(row, begins)),
    wantedBlocks,
  );
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
  const removedRows = stored.filter((one) => !kept.has(one.id));
  const endedAt = await transactionMoment(transaction);
  // Task 5.7b-3: the rows of the kept substitutions are settled after the
  // write (spec review of the plan, must-fix 1).
  const exceptRowIds = new Set(
    [...(plan?.substitutes.values() ?? [])].filter((one) => one.apply).map((one) => one.rowId),
  );
  // Task 5.7b-1: a substitution of a removed lesson ends before the lesson goes.
  const substitutionsDropped = await endSubstitutionRows(transaction, {
    lessonIds: removedRows.map((one) => one.id),
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
  const restaffed: string[] = [];
  let keptCount = 0;
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
    for (const lesson of block.lessons) {
      const found = pairOf.get(lesson);
      if (found === undefined) continue;
      keptCount += 1;
      const moved =
        found.load_row_id !== lesson.loadRowId || found.pattern_entry_id !== lesson.entryId;
      const staffed = found.teacher_id !== lesson.teacherId || found.room_id !== lesson.roomId;
      // Task 5.6a-5a: a one-day cancel applied again on a lesson held.
      const oneDay = found.cancel_cause === null ? lesson.oneDayCancel : null;
      // Task 5.6a-5b-1: a part of a block decided `keep` is held.
      const hold = held.has(found.id);
      if (!moved && !staffed && oneDay === null && !hold) continue;
      if (found.teacher_id !== lesson.teacherId) restaffed.push(found.id);
      await transaction
        .updateTable('lessons')
        .set({
          load_row_id: lesson.loadRowId,
          pattern_entry_id: lesson.entryId,
          teacher_id: lesson.teacherId,
          room_id: lesson.roomId,
          ...(oneDay === null ? {} : { cancel_cause: 'reason', cancel_reason: oneDay }),
          ...(hold ? { cancel_cause: null, cancel_reason: null } : {}),
        })
        .where('id', '=', found.id)
        .execute();
      if (staffed || oneDay !== null || hold) {
        changed.push({
          id: found.id,
          teacherId: { from: found.teacher_id, to: lesson.teacherId },
          roomId: { from: found.room_id, to: lesson.roomId },
          ...(oneDay === null ? {} : { cancel: { from: null, to: 'reason' } }),
          ...(hold ? { cancel: { from: 'reason', to: null } } : {}),
        });
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

  // The stored blocks no new block reuses, empty now.
  const emptied = storedBlocks.filter((one) => !taken.has(one.id)).map((one) => one.id);
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
    removed: removedRows.map((row) => ({
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
    })),
    changed,
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
 * dated today or earlier (0079); before 6.1 no lesson holds data.
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
      'teacher_id',
      'room_id',
      'cancel_cause',
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
  const rows = allRows.filter((one) => !keptBlocks.has(one.block_id));
  const blocks = allBlocks.filter((one) => !keptBlocks.has(one.id));
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
  // Task 5.7b-1: a substitution of a removed lesson ends before the lesson goes.
  const substitutionsDropped = await endSubstitutionRows(transaction, {
    lessonIds: rows.map((one) => one.id),
    cause: 'dropped',
    accountId,
    moment: await transactionMoment(transaction),
  });
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
    removed: rows.map((row) => ({
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
    })),
    changed,
  };
}
