import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  gridSchema,
  subjectColourSchema,
  type ErrorCode,
  type DraftReadiness,
  type GridAnswer,
  type LessonRoomRecord,
  type MoveRecord,
  type PlaceRecord,
  type RearrangeRecord,
  type SwapRecord,
  type TimetableLock,
  type TimetableLockRecord,
} from '@sodiq/shared';
import {
  blockPlacements,
  checkCandidates,
  checkedPlacements,
  checkTimetable,
  lockedBy,
  newBlockOf,
  newPairOf,
  otherHalf,
  pairAt,
  pairingProblem,
  patternPlacements,
  roomChange,
  roomLessons,
  type BlockLesson,
  type PatternBlock,
  type PatternModel,
} from '@sodiq/timetable-rules';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { LOAD_REFUSALS, LoadFacts, type StoredLoadRow } from './load-facts.js';
import { readPatternFacts, type PatternFacts } from './pattern-facts.js';
import { deferPatternClashes, readBlocks, readLocks } from './pattern-queries.js';
import { readPins } from './pins-check.js';
import { blockedRefusal, resultAnswerOf } from './rule-answers.js';
import { Timetable, type VersionRow } from './timetable.service.js';

const DEADLOCK = '40P01';

/**
 * The refusals of the weekly pattern's guards (db/migrations/0058) over those
 * of the load (decision 17): the rule engine checks every write first, so a
 * clash constraint answers only a fault of that check, with one plain code; a
 * deadlock of the shared-room locks of two drafts is `timetable_busy`. The
 * detail of an exclusion error is never passed on (5.5b's From 5.1a line).
 */
const PATTERN_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  ...LOAD_REFUSALS,
  pattern_entries_teacher_excl: 'pattern_clash',
  pattern_entries_room_excl: 'pattern_clash',
  pattern_block_classes_excl: 'pattern_clash',
  pattern_room_shared_full: 'pattern_clash',
  // Task 5.4c-3a (plan review, should-fix 2): the pair guard of 0058, at the commit.
  pattern_double_pair: 'pattern_clash',
};

async function refusingPattern<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await refusingConstraints(work, PATTERN_REFUSALS);
  } catch (error) {
    if ((error as { code?: unknown }).code === DEADLOCK) {
      throw new ApiException('timetable_busy', 409);
    }
    throw error;
  }
}

const refused = (code: ErrorCode): ApiException => new ApiException(code, 409);

/** A lock as its audit entry records it: its kind and target, without its id. */
function lockRecordOf(lock: TimetableLock): TimetableLockRecord {
  switch (lock.kind) {
    case 'block':
      return { kind: lock.kind, blockId: lock.blockId };
    case 'class':
      return { kind: lock.kind, classId: lock.classId };
    case 'teacher':
      return { kind: lock.kind, teacherId: lock.teacherId };
    case 'day':
      return { kind: lock.kind, weekday: lock.weekday };
  }
}

/** What a write reads of its draft: the rows, the engine's input and the placed blocks. */
interface PatternState {
  /** The account of the request, for the version's edit lock in the answer (task 5.4c-1). */
  readonly accountId: string;
  readonly version: VersionRow;
  readonly rows: StoredLoadRow[];
  readonly load: LoadFacts;
  readonly pattern: PatternFacts;
  readonly blocks: PatternBlock[];
  readonly locks: TimetableLock[];
}

/** A block at a weekday and slot, with the minutes of that slot; `pattern_no_slot` without one. */
function blockAt(
  model: PatternModel,
  block: {
    readonly id: string;
    readonly lessons: readonly BlockLesson[];
    readonly doublePairId?: string | null;
  },
  weekday: number,
  slotPosition: number,
): PatternBlock {
  const [first] = blockPlacements(model, block, weekday, slotPosition) ?? [];
  if (first === undefined) {
    throw refused('pattern_no_slot');
  }
  return {
    ...block,
    doublePairId: block.doublePairId ?? null,
    weekday,
    slotPosition,
    start: first.start,
    end: first.end,
  };
}

/** The two halves of a double, the earlier first (task 5.4c-3a). */
const halvesOf = (a: PatternBlock, b: PatternBlock): [PatternBlock, PatternBlock] =>
  a.start <= b.start ? [a, b] : [b, a];

/** The pair of a double in an audit entry; nothing for a single lesson (decision 10). */
const pairValue = (block: PatternBlock) =>
  block.doublePairId === null ? {} : { doublePairId: block.doublePairId };

/**
 * The lessons of the weekly pattern placed by hand in the grid of step 7
 * (06, Editing in the grid; task 5.4a, pull request #130). Each write locks
 * the draft (`lockDraft`, so two writes run one after the other), checks the
 * changed blocks with `checkCandidates` of the rule engine on the input the
 * grid checks with (decision 2), refuses a blocked result (decision 4) and
 * saves a warning; the clash constraints of 0058 stay the last guard.
 */
@Injectable()
export class TimetablePattern {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly timetable: Timetable,
  ) {}

  /** The board of a version: a draft is edited, a published or archived one read (decision 16). */
  grid(access: Access, id: string): Promise<GridAnswer> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const version = await this.timetable.findVersion(transaction, branchId, id);
      return this.gridOf(transaction, await this.stateOf(transaction, version, access.accountId));
    });
  }

  /**
   * The readiness of the builder with step 7's mark (task 5.4b-2a, decision
   * 7): ready when no result of the draft's pattern is blocked ("The conflict
   * panel shows no errors"); warnings are counted and do not stop it.
   */
  readiness(access: Access, id: string): Promise<DraftReadiness> {
    return this.timetable.readiness(access, id, async (transaction, version) => {
      const { pattern, blocks } = await this.stateOf(transaction, version, access.accountId);
      const results = checkTimetable(checkedPlacements(pattern.model, blocks), pattern.model.facts);
      const blocked = results.filter((one) => one.severity === 'blocked').length;
      return { ready: blocked === 0, blocked, warnings: results.length - blocked };
    });
  }

  /**
   * A load row placed at a slot with its whole block (decision 8); refused when
   * blocked. Task 5.4c-3a: `double` places a double lesson, the first half at
   * the slot and the second in the next lesson slot (`pairAt`), both checked
   * together and written with one pair id. Task 5.4c-3b: `partnerRowId` pairs
   * a mixed half with a half of another subject's mixed split of the same
   * class in one block; a mixed half alone takes its whole split.
   */
  place(access: Access, id: string, input: PlaceRecord, requestId: string): Promise<GridAnswer> {
    return refusingPattern(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const version = await this.timetable.lockDraft(transaction, access, id, requestId);
        const state = await this.stateOf(transaction, version, access.accountId);
        const row = state.rows.find((one) => one.id === input.loadRowId);
        if (row === undefined) {
          throw notFound();
        }
        const { model } = state.pattern;
        this.checkPartner(state, row.id, input.partnerRowId);
        // Task 5.4b-2a: a room chosen in the picker is a room of the branch.
        if (input.roomId !== undefined && !this.isRoomOf(state, input.roomId)) {
          throw notFound();
        }
        // One builder of a new block (task 5.4b-2b, review correction 2); task
        // 5.4c-3b: a pairing with its partner, else a mixed half's whole split.
        const fresh = newBlockOf(model, row.id, input.partnerRowId);
        // Task 5.4c-2: the undo of a removal gives each lesson its room back.
        const rooms = input.rooms ?? [];
        for (const room of rooms) {
          if (
            !fresh.lessons.some((lesson) => lesson.loadRowId === room.loadRowId) ||
            (room.roomId !== null && !this.isRoomOf(state, room.roomId))
          ) {
            throw notFound();
          }
        }
        const lessons = fresh.lessons.map((lesson) => {
          const room = rooms.find((one) => one.loadRowId === lesson.loadRowId);
          if (room !== undefined) return { ...lesson, roomId: room.roomId };
          return lesson.loadRowId === row.id && input.roomId !== undefined
            ? { ...lesson, roomId: input.roomId }
            : lesson;
        });
        if (input.double === true) {
          const doublePairId = randomUUID();
          const [first, second] = newPairOf(model, row.id, input.partnerRowId);
          const pair = pairAt(
            model,
            [
              { ...first, lessons, doublePairId },
              {
                ...second,
                lessons: second.lessons.map((lesson, index) => ({
                  ...lesson,
                  roomId: lessons[index]?.roomId ?? lesson.roomId,
                })),
                doublePairId,
              },
            ],
            first.id,
            input.weekday,
            input.slotPosition,
          );
          if (pair === null) {
            throw refused('pattern_no_slot');
          }
          this.refuseBlocked(state, pair);
          for (const half of pair) {
            await this.insertBlock(transaction, access, state, half, requestId);
          }
          return this.gridAfter(transaction, version, access.accountId);
        }
        const placed = blockAt(model, { id: fresh.id, lessons }, input.weekday, input.slotPosition);
        this.refuseBlocked(state, [placed]);
        await this.insertBlock(transaction, access, state, placed, requestId);
        return this.gridAfter(transaction, version, access.accountId);
      }),
    );
  }

  /**
   * A block moved whole to another weekday and slot; nothing is written when it
   * is already there. Task 5.4c-3a: a half of a double takes the pair, the
   * other half beside it (`pairAt`, decision 5), the clash constraints
   * checked at the commit (the halves may cross each other's old slots).
   */
  move(
    access: Access,
    id: string,
    blockId: string,
    input: MoveRecord,
    requestId: string,
  ): Promise<GridAnswer> {
    const branchId = branchOf(access);
    return refusingPattern(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const version = await this.timetable.lockDraft(transaction, access, id, requestId);
        const state = await this.stateOf(transaction, version, access.accountId);
        const block = this.blockOf(state, blockId);
        if (block.weekday === input.weekday && block.slotPosition === input.slotPosition) {
          return this.gridOf(transaction, state);
        }
        const other = otherHalf(state.blocks, block);
        let moves: [PatternBlock, PatternBlock][];
        if (other === undefined) {
          moves = [[block, blockAt(state.pattern.model, block, input.weekday, input.slotPosition)]];
        } else {
          const halves = halvesOf(block, other);
          const pair = pairAt(
            state.pattern.model,
            halves,
            block.id,
            input.weekday,
            input.slotPosition,
          );
          if (pair === null) {
            throw refused('pattern_no_slot');
          }
          moves = [
            [halves[0], pair[0]],
            [halves[1], pair[1]],
          ];
          await deferPatternClashes(transaction);
        }
        this.refuseBlocked(
          state,
          moves.map(([, to]) => to),
        );
        for (const [from, to] of moves) {
          await this.writeSlot(transaction, to);
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'pattern_block.move',
            record: { type: 'pattern_block', id: from.id },
            oldValue: { versionId: id, ...this.slotOf(from), ...pairValue(from) },
            newValue: { versionId: id, ...this.slotOf(to), ...pairValue(to) },
            requestId,
          });
        }
        return this.gridAfter(transaction, version, access.accountId);
      }),
    );
  }

  /**
   * Two blocks exchange their weekdays and slots, each block's minutes read
   * again from its own rows' template; the clash constraints are checked at
   * the commit (`deferPatternClashes`).
   */
  swap(access: Access, id: string, input: SwapRecord, requestId: string): Promise<GridAnswer> {
    const branchId = branchOf(access);
    return refusingPattern(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const version = await this.timetable.lockDraft(transaction, access, id, requestId);
        const state = await this.stateOf(transaction, version, access.accountId);
        const [a, b] = input.blockIds.map((blockId) => this.blockOf(state, blockId));
        if (a === undefined || b === undefined) {
          throw notFound();
        }
        const { model } = state.pattern;
        const movedA = blockAt(model, a, b.weekday, b.slotPosition);
        const movedB = blockAt(model, b, a.weekday, a.slotPosition);
        this.refuseBlocked(state, [movedA, movedB]);
        await deferPatternClashes(transaction);
        await this.writeSlot(transaction, movedA);
        await this.writeSlot(transaction, movedB);
        // One entry per block, so the log finds the swap from either (permission review, should-fix 1).
        for (const [before, after, other] of [
          [a, movedA, b],
          [b, movedB, a],
        ] as const) {
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'pattern_block.swap',
            record: { type: 'pattern_block', id: before.id },
            oldValue: { versionId: id, swappedWith: other.id, ...this.slotOf(before) },
            newValue: { versionId: id, swappedWith: other.id, ...this.slotOf(after) },
            requestId,
          });
        }
        return this.gridAfter(transaction, version, access.accountId);
      }),
    );
  }

  /**
   * The room of one lesson of a block (task 5.4b-2a, decisions 5 and 10): the
   * check of the room picker (`roomChange` of the rule engine), so the server
   * refuses what the picker leaves out; nothing is written when the room is
   * already the lesson's.
   */
  room(
    access: Access,
    id: string,
    blockId: string,
    input: LessonRoomRecord,
    requestId: string,
  ): Promise<GridAnswer> {
    const branchId = branchOf(access);
    return refusingPattern(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const version = await this.timetable.lockDraft(transaction, access, id, requestId);
        const state = await this.stateOf(transaction, version, access.accountId);
        const block = this.blockOf(state, blockId);
        const lesson = block.lessons.find((one) => one.id === input.lessonId);
        const { model } = state.pattern;
        // Task 5.4c-2 (decision 7): `null` gives back "no room" on an undo.
        if (
          lesson === undefined ||
          (input.roomId !== null && !this.isRoomOf(state, input.roomId))
        ) {
          throw notFound();
        }
        // Task 5.4c-3a, decision 7: in a double, the row's lesson of both halves.
        const changed = roomLessons(state.blocks, block, lesson.id).flatMap((one) => {
          const found = one.block.lessons.find((each) => each.id === one.lessonId);
          return found === undefined ? [] : [{ block: one.block, lesson: found }];
        });
        if (changed.every((one) => one.lesson.roomId === input.roomId)) {
          return this.gridOf(transaction, state);
        }
        const change = roomChange(model, state.blocks, block, lesson.id, input.roomId);
        if (!change.accepted) {
          throw blockedRefusal(change.blocked);
        }
        for (const one of changed) {
          await transaction
            .updateTable('pattern_entries')
            .set({ room_id: input.roomId })
            .where('id', '=', one.lesson.id)
            .execute();
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'pattern_entry.room',
            record: { type: 'pattern_entry', id: one.lesson.id },
            oldValue: {
              versionId: id,
              blockId: one.block.id,
              loadRowId: one.lesson.loadRowId,
              roomId: one.lesson.roomId,
              ...pairValue(one.block),
            },
            newValue: {
              versionId: id,
              blockId: one.block.id,
              loadRowId: one.lesson.loadRowId,
              roomId: input.roomId,
              ...pairValue(one.block),
            },
            requestId,
          });
        }
        return this.gridAfter(transaction, version, access.accountId);
      }),
    );
  }

  /**
   * A suggestion of "Suggest a place" applied (task 5.4b-2b, decision 7): one to
   * three blocks moved, at most one of them new, with the rooms the suggestion
   * gives, checked together by the rule engine as a move is (`refuseBlocked`)
   * and written in one transaction with the clash constraints checked at the
   * commit. A change at its block's own slot and rooms writes nothing. Task
   * 5.4c-2: a block of `remove` is removed in the same transaction (the undo of
   * a suggestion that created it); the moved blocks are checked without it, so
   * a block can go back into its slot.
   */
  rearrange(
    access: Access,
    id: string,
    input: RearrangeRecord,
    requestId: string,
  ): Promise<GridAnswer> {
    const branchId = branchOf(access);
    return refusingPattern(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const version = await this.timetable.lockDraft(transaction, access, id, requestId);
        const state = await this.stateOf(transaction, version, access.accountId);
        const { model } = state.pattern;
        const changes = input.changes.map((change) => {
          let from: PatternBlock | null = null;
          let block: {
            readonly id: string;
            readonly lessons: readonly BlockLesson[];
            readonly doublePairId: string | null;
          };
          if (change.blockId !== undefined) {
            from = this.blockOf(state, change.blockId);
            block = from;
          } else {
            const row = state.rows.find((one) => one.id === change.loadRowId);
            if (row === undefined) {
              throw notFound();
            }
            this.checkPartner(state, row.id, change.partnerRowId);
            block = newBlockOf(model, row.id, change.partnerRowId);
          }
          const rooms = change.rooms ?? [];
          for (const room of rooms) {
            if (
              !block.lessons.some((lesson) => lesson.loadRowId === room.loadRowId) ||
              (room.roomId !== null && !this.isRoomOf(state, room.roomId))
            ) {
              throw notFound();
            }
          }
          const lessons = block.lessons.map((lesson) => {
            const room = rooms.find((one) => one.loadRowId === lesson.loadRowId);
            return room === undefined ? lesson : { ...lesson, roomId: room.roomId };
          });
          const to = blockAt(
            model,
            { id: block.id, lessons, doublePairId: block.doublePairId },
            change.weekday,
            change.slotPosition,
          );
          return { from, to };
        });
        const effective = changes.filter(
          ({ from, to }) =>
            from === null ||
            from.weekday !== to.weekday ||
            from.slotPosition !== to.slotPosition ||
            from.lessons.some((lesson, index) => lesson.roomId !== to.lessons[index]?.roomId),
        );
        // Task 5.4c-3a: a removed half of a double takes the other half with it.
        const removed = (input.remove ?? []).flatMap((blockId) => {
          const block = this.blockOf(state, blockId);
          const other = otherHalf(state.blocks, block);
          return other === undefined ? [block] : [block, other];
        });
        if (effective.length === 0 && removed.length === 0) {
          return this.gridOf(transaction, state);
        }
        // Task 5.4c-1, decision 8: an applied suggestion leaves a locked lesson
        // where it is and moves nothing into a locked day (From 5.4b-2b line);
        // task 5.4c-2: nor does its undo remove a locked lesson.
        if (
          effective.some(
            ({ from, to }) => lockedBy(model, state.locks, from ?? to, to).length > 0,
          ) ||
          removed.some((block) => lockedBy(model, state.locks, block, block).length > 0)
        ) {
          throw refused('pattern_locked');
        }
        const kept = state.blocks.filter((block) => !removed.some((one) => one.id === block.id));
        this.refuseBlocked(
          { ...state, blocks: kept },
          effective.map((one) => one.to),
        );
        await deferPatternClashes(transaction);
        // At most one new block (`rearrangeRecordSchema`); the others keep their ids.
        const others = (blockId: string) =>
          [...effective.map((one) => one.to.id), ...removed.map((one) => one.id)].filter(
            (one) => one !== blockId,
          );
        const fresh = effective.find((one) => one.from === null);
        const freshId =
          fresh === undefined
            ? null
            : await this.insertBlock(
                transaction,
                access,
                state,
                fresh.to,
                requestId,
                others(fresh.to.id),
              );
        const withFresh = (blockIds: readonly string[]) =>
          blockIds.map((blockId) =>
            fresh !== undefined && blockId === fresh.to.id ? (freshId ?? blockId) : blockId,
          );
        for (const block of removed) {
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'pattern_block.delete',
            record: { type: 'pattern_block', id: block.id },
            oldValue: {
              ...this.removedValue(state, block),
              rearrangedWith: withFresh(others(block.id)),
            },
            requestId,
          });
          await transaction.deleteFrom('pattern_blocks').where('id', '=', block.id).execute();
        }
        for (const { from, to } of effective) {
          if (from === null) continue;
          if (from.weekday !== to.weekday || from.slotPosition !== to.slotPosition) {
            await this.writeSlot(transaction, to);
          }
          for (const [index, lesson] of to.lessons.entries()) {
            if (lesson.roomId !== from.lessons[index]?.roomId) {
              await transaction
                .updateTable('pattern_entries')
                .set({ room_id: lesson.roomId })
                .where('id', '=', lesson.id)
                .execute();
            }
          }
          const roomsOf = (block: PatternBlock) =>
            block.lessons.map((lesson) => ({
              id: lesson.id,
              loadRowId: lesson.loadRowId,
              roomId: lesson.roomId,
            }));
          const rearrangedWith = withFresh(others(to.id));
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'pattern_block.rearrange',
            record: { type: 'pattern_block', id: from.id },
            oldValue: {
              versionId: id,
              rearrangedWith,
              ...this.slotOf(from),
              lessons: roomsOf(from),
            },
            newValue: { versionId: id, rearrangedWith, ...this.slotOf(to), lessons: roomsOf(to) },
            requestId,
          });
        }
        return this.gridAfter(transaction, version, access.accountId);
      }),
    );
  }

  /**
   * A block removed with its lessons; the audit entry keeps every lesson it
   * removes. Task 5.4c-3a: a half of a double removes both halves.
   */
  remove(access: Access, id: string, blockId: string, requestId: string): Promise<GridAnswer> {
    const branchId = branchOf(access);
    return refusingPattern(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const version = await this.timetable.lockDraft(transaction, access, id, requestId);
        const state = await this.stateOf(transaction, version, access.accountId);
        const block = this.blockOf(state, blockId);
        const other = otherHalf(state.blocks, block);
        for (const one of other === undefined ? [block] : [block, other]) {
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'pattern_block.delete',
            record: { type: 'pattern_block', id: one.id },
            oldValue: this.removedValue(state, one),
            requestId,
          });
          await transaction.deleteFrom('pattern_blocks').where('id', '=', one.id).execute();
        }
        return this.gridAfter(transaction, version, access.accountId);
      }),
    );
  }

  /**
   * A lock of the draft (task 5.4c-1; 06, Auto-generation: "A lesson, a class,
   * a teacher or a day can be locked"): a block of this version, a class of the
   * branch, or a teacher or vacancy working in the branch, else 404; a lock the
   * draft already has: `lock_taken`.
   */
  createLock(
    access: Access,
    id: string,
    input: TimetableLockRecord,
    requestId: string,
  ): Promise<GridAnswer> {
    const branchId = branchOf(access);
    return refusingPattern(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const version = await this.timetable.lockDraft(transaction, access, id, requestId);
        const state = await this.stateOf(transaction, version, access.accountId);
        const target = {
          block_id: input.kind === 'block' ? input.blockId : null,
          class_id: input.kind === 'class' ? input.classId : null,
          teacher_id: input.kind === 'teacher' ? input.teacherId : null,
          weekday: input.kind === 'day' ? input.weekday : null,
        };
        if (input.kind === 'block') {
          this.blockOf(state, input.blockId);
        } else if (input.kind === 'class') {
          const found = await transaction
            .selectFrom('classes')
            .select('id')
            .where('id', '=', input.classId)
            .where('branch_id', '=', branchId)
            .executeTakeFirst();
          if (found === undefined) throw notFound();
        } else if (input.kind === 'teacher') {
          const found = await transaction
            .selectFrom('staff_branches')
            .select('staff_id')
            .where('staff_id', '=', input.teacherId)
            .where('branch_id', '=', branchId)
            .executeTakeFirst();
          if (found === undefined) throw notFound();
        }
        const taken = state.locks.some(
          (lock) =>
            lock.kind === input.kind &&
            ((lock.kind === 'block' && lock.blockId === target.block_id) ||
              (lock.kind === 'class' && lock.classId === target.class_id) ||
              (lock.kind === 'teacher' && lock.teacherId === target.teacher_id) ||
              (lock.kind === 'day' && lock.weekday === target.weekday)),
        );
        if (taken) {
          throw refused('lock_taken');
        }
        const created = await transaction
          .insertInto('timetable_locks')
          .values({ branch_id: branchId, version_id: id, kind: input.kind, ...target })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'timetable_lock.create',
          record: { type: 'timetable_lock', id: created.id },
          newValue: { versionId: id, ...input },
          requestId,
        });
        return this.gridAfter(transaction, version, access.accountId);
      }),
    );
  }

  /** A lock of the draft removed; another version's, another branch's or unknown: 404. */
  deleteLock(access: Access, id: string, lockId: string, requestId: string): Promise<GridAnswer> {
    const branchId = branchOf(access);
    return refusingPattern(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const version = await this.timetable.lockDraft(transaction, access, id, requestId);
        const state = await this.stateOf(transaction, version, access.accountId);
        const lock = state.locks.find((one) => one.id === lockId);
        if (lock === undefined) {
          throw notFound();
        }
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'timetable_lock.delete',
          record: { type: 'timetable_lock', id: lock.id },
          oldValue: { versionId: id, ...lockRecordOf(lock) },
          requestId,
        });
        await transaction.deleteFrom('timetable_locks').where('id', '=', lock.id).execute();
        return this.gridAfter(transaction, version, access.accountId);
      }),
    );
  }

  /**
   * A new block written with its lessons and audited `pattern_block.create`;
   * `rearrangedWith` names the other blocks of a suggestion applied with it.
   * Returns the new block's id.
   */
  private async insertBlock(
    transaction: Transaction,
    access: Access,
    state: PatternState,
    placed: PatternBlock,
    requestId: string,
    rearrangedWith?: readonly string[],
  ): Promise<string> {
    const { model } = state.pattern;
    const branchId = state.version.branch_id;
    const versionId = state.version.id;
    const block = await transaction
      .insertInto('pattern_blocks')
      .values({
        branch_id: branchId,
        version_id: versionId,
        weekday: placed.weekday,
        slot_position: placed.slotPosition,
        start_minutes: placed.start,
        end_minutes: placed.end,
        double_pair_id: placed.doublePairId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const entries = await transaction
      .insertInto('pattern_entries')
      .values(
        placed.lessons.map((lesson) => ({
          branch_id: branchId,
          version_id: versionId,
          block_id: block.id,
          weekday: placed.weekday,
          start_minutes: placed.start,
          end_minutes: placed.end,
          load_row_id: lesson.loadRowId,
          teacher_id: model.rowOf(lesson.loadRowId).teacherId,
          room_id: lesson.roomId,
        })),
      )
      .returning(['id', 'load_row_id'])
      .execute();
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'pattern_block.create',
      record: { type: 'pattern_block', id: block.id },
      newValue: {
        versionId,
        ...this.slotOf(placed),
        lessons: placed.lessons.map((lesson) => ({
          id: entries.find((entry) => entry.load_row_id === lesson.loadRowId)?.id ?? null,
          loadRowId: lesson.loadRowId,
          teacherId: model.rowOf(lesson.loadRowId).teacherId,
          roomId: lesson.roomId,
        })),
        ...pairValue(placed),
        ...(rearrangedWith === undefined ? {} : { rearrangedWith: [...rearrangedWith] }),
      },
      requestId,
    });
    return block.id;
  }

  private async stateOf(
    transaction: Transaction,
    version: VersionRow,
    accountId: string,
  ): Promise<PatternState> {
    const context = await this.timetable.contextOf(transaction, version);
    const rows = await this.timetable.rowsOf(transaction, version.id);
    const load = await LoadFacts.of(transaction, context, rows, { versionRows: rows });
    const pattern = await readPatternFacts(transaction, context, rows, load);
    const [blocks, locks] = await Promise.all([
      readBlocks(transaction, version.id),
      readLocks(transaction, version.id),
    ]);
    return { accountId, version, rows, load, pattern, blocks, locks };
  }

  /**
   * The partner of a new block (task 5.4c-3b, decision 7): a row of the
   * version, else 404 (another branch's, another draft's or unknown), that
   * pairs with the row (`pairingProblem`), else `pattern_mixed_partner`.
   */
  private checkPartner(state: PatternState, rowId: string, partnerRowId: string | undefined): void {
    if (partnerRowId === undefined) return;
    if (!state.rows.some((one) => one.id === partnerRowId)) {
      throw notFound();
    }
    if (pairingProblem(state.pattern.model, rowId, partnerRowId) !== null) {
      throw refused('pattern_mixed_partner');
    }
  }

  /** A room of the branch, as the grid's facts hold them. */
  private isRoomOf(state: PatternState, roomId: string): boolean {
    return state.pattern.model.data.rooms.some((one) => one.id === roomId);
  }

  /** What the audit entry of a removed block keeps: its slot, every lesson and its locks. */
  private removedValue(state: PatternState, block: PatternBlock) {
    const { model } = state.pattern;
    return {
      versionId: state.version.id,
      ...this.slotOf(block),
      ...pairValue(block),
      lessons: block.lessons.map((lesson) => ({
        id: lesson.id,
        loadRowId: lesson.loadRowId,
        teacherId: model.rowOf(lesson.loadRowId).teacherId,
        roomId: lesson.roomId,
      })),
      // Task 5.4c-1: a lock of the block goes with it (decision 7).
      locks: state.locks
        .filter((lock) => lock.kind === 'block' && lock.blockId === block.id)
        .map((lock) => lock.id),
    };
  }

  /** A block of the state's version; another version's, another branch's or unknown: 404. */
  private blockOf(state: PatternState, blockId: string): PatternBlock {
    const block = state.blocks.find((one) => one.id === blockId);
    if (block === undefined) {
      throw notFound();
    }
    return block;
  }

  /** Decision 5: the results of the changed blocks' lessons only; any blocked one refuses with them all. */
  private refuseBlocked(state: PatternState, changed: readonly PatternBlock[]): void {
    const { model } = state.pattern;
    const blocked = checkCandidates(
      checkedPlacements(model, state.blocks),
      model.facts,
      patternPlacements(model, changed),
    ).filter((result) => result.severity === 'blocked');
    if (blocked.length > 0) {
      throw blockedRefusal(blocked);
    }
  }

  private async writeSlot(transaction: Transaction, block: PatternBlock): Promise<void> {
    await transaction
      .updateTable('pattern_blocks')
      .set({
        weekday: block.weekday,
        slot_position: block.slotPosition,
        start_minutes: block.start,
        end_minutes: block.end,
      })
      .where('id', '=', block.id)
      .execute();
  }

  private slotOf(block: PatternBlock) {
    return {
      weekday: block.weekday,
      slotPosition: block.slotPosition,
      start: block.start,
      end: block.end,
    };
  }

  private async gridAfter(
    transaction: Transaction,
    version: VersionRow,
    accountId: string,
  ): Promise<GridAnswer> {
    return this.gridOf(transaction, await this.stateOf(transaction, version, accountId));
  }

  private async gridOf(transaction: Transaction, state: PatternState): Promise<GridAnswer> {
    const { accountId, version, rows, load, pattern, blocks, locks } = state;
    const pins = await readPins(transaction, version.id);
    const answers = rows.map((row) => load.answerOf(row, []));
    const classIds = [...new Set(pattern.data.classStudents.map((one) => one.classId))];
    const roomIds = [
      ...new Set([
        ...pattern.data.rooms.map((room) => room.id),
        ...blocks.flatMap((block) =>
          block.lessons.map((one) => one.roomId).filter((id): id is string => id !== null),
        ),
      ]),
    ];
    const subjectIds = [...new Set(rows.map((row) => row.subject_id))];
    const [classes, rooms, colours] = await Promise.all([
      classIds.length === 0
        ? Promise.resolve([])
        : transaction
            .selectFrom('classes')
            .select(['id', 'name', 'grade'])
            .where('id', 'in', classIds)
            .orderBy('grade')
            .orderBy('name')
            .orderBy('id')
            .execute(),
      roomIds.length === 0
        ? Promise.resolve([])
        : transaction
            .selectFrom('rooms')
            .select(['id', 'name'])
            .where('id', 'in', roomIds)
            .orderBy('name')
            .orderBy('id')
            .execute(),
      subjectIds.length === 0
        ? Promise.resolve([])
        : transaction
            .selectFrom('subjects')
            .select(['id', 'colour'])
            .where('id', 'in', subjectIds)
            .execute(),
    ]);
    const colourOf = new Map(colours.map((one) => [one.id, one.colour]));
    // Parsed, so the readonly data of the engine becomes the answer's shape.
    return gridSchema.parse({
      version: await this.timetable.answerOf(transaction, version.id, accountId),
      editable: version.status === 'draft' && version.year_status !== 'closed',
      classes,
      rows: answers.map((answer) => ({
        id: answer.id,
        unit: answer.unit,
        subject: {
          ...answer.subject,
          colour: subjectColourSchema.parse(colourOf.get(answer.subject.id)),
        },
        teacher: answer.teacher,
        lessonsPerWeek: answer.lessonsPerWeek,
        mixedBlock: answer.mixedBlock,
      })),
      rooms,
      blocks,
      facts: pattern.data,
      pins: pins.map((pin) => ({
        loadRowId: pin.load_row_id,
        weekday: pin.weekday,
        slotPosition: pin.slot_position,
      })),
      locks,
      results: checkTimetable(checkedPlacements(pattern.model, blocks), pattern.model.facts).map(
        resultAnswerOf,
      ),
    });
  }
}
