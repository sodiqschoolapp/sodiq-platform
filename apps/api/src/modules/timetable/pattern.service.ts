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
  type SwapRecord,
} from '@sodiq/shared';
import {
  blockPlacements,
  checkCandidates,
  checkedPlacements,
  checkTimetable,
  patternPlacements,
  roomChange,
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
import { deferPatternClashes, readBlocks } from './pattern-queries.js';
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

/** What a write reads of its draft: the rows, the engine's input and the placed blocks. */
interface PatternState {
  readonly version: VersionRow;
  readonly rows: StoredLoadRow[];
  readonly load: LoadFacts;
  readonly pattern: PatternFacts;
  readonly blocks: PatternBlock[];
}

/** A block at a weekday and slot, with the minutes of that slot; `pattern_no_slot` without one. */
function blockAt(
  model: PatternModel,
  block: { readonly id: string; readonly lessons: readonly BlockLesson[] },
  weekday: number,
  slotPosition: number,
): PatternBlock {
  const [first] = blockPlacements(model, block, weekday, slotPosition) ?? [];
  if (first === undefined) {
    throw refused('pattern_no_slot');
  }
  return { ...block, weekday, slotPosition, start: first.start, end: first.end };
}

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
      return this.gridOf(transaction, await this.stateOf(transaction, version));
    });
  }

  /**
   * The readiness of the builder with step 7's mark (task 5.4b-2a, decision
   * 7): ready when no result of the draft's pattern is blocked ("The conflict
   * panel shows no errors"); warnings are counted and do not stop it.
   */
  readiness(access: Access, id: string): Promise<DraftReadiness> {
    return this.timetable.readiness(access, id, async (transaction, version) => {
      const { pattern, blocks } = await this.stateOf(transaction, version);
      const results = checkTimetable(checkedPlacements(pattern.model, blocks), pattern.model.facts);
      const blocked = results.filter((one) => one.severity === 'blocked').length;
      return { ready: blocked === 0, blocked, warnings: results.length - blocked };
    });
  }

  /** A load row placed at a slot with its whole block (decision 8); refused when blocked. */
  place(access: Access, id: string, input: PlaceRecord, requestId: string): Promise<GridAnswer> {
    const branchId = branchOf(access);
    return refusingPattern(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const version = await this.timetable.lockDraft(transaction, branchId, id);
        const state = await this.stateOf(transaction, version);
        const row = state.rows.find((one) => one.id === input.loadRowId);
        if (row === undefined) {
          throw notFound();
        }
        if (row.mixed_block) {
          throw refused('pattern_mixed_block');
        }
        const { model } = state.pattern;
        // Task 5.4b-2a: a room chosen in the picker is a room of the branch.
        if (
          input.roomId !== undefined &&
          !model.data.rooms.some((one) => one.id === input.roomId)
        ) {
          throw notFound();
        }
        const lessons = model.rowOf(row.id).block.map((rowId) => ({
          id: `new:${rowId}`,
          loadRowId: rowId,
          roomId:
            rowId === row.id && input.roomId !== undefined
              ? input.roomId
              : model.roomOfNew(model.rowOf(rowId)),
        }));
        const placed = blockAt(model, { id: 'new', lessons }, input.weekday, input.slotPosition);
        this.refuseBlocked(state, [placed]);

        const block = await transaction
          .insertInto('pattern_blocks')
          .values({
            branch_id: branchId,
            version_id: id,
            weekday: placed.weekday,
            slot_position: placed.slotPosition,
            start_minutes: placed.start,
            end_minutes: placed.end,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const entries = await transaction
          .insertInto('pattern_entries')
          .values(
            lessons.map((lesson) => ({
              branch_id: branchId,
              version_id: id,
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
            versionId: id,
            ...this.slotOf(placed),
            lessons: lessons.map((lesson) => ({
              id: entries.find((entry) => entry.load_row_id === lesson.loadRowId)?.id ?? null,
              loadRowId: lesson.loadRowId,
              teacherId: model.rowOf(lesson.loadRowId).teacherId,
              roomId: lesson.roomId,
            })),
          },
          requestId,
        });
        return this.gridAfter(transaction, version);
      }),
    );
  }

  /** A block moved whole to another weekday and slot; nothing is written when it is already there. */
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
        const version = await this.timetable.lockDraft(transaction, branchId, id);
        const state = await this.stateOf(transaction, version);
        const block = this.blockOf(state, blockId);
        if (block.weekday === input.weekday && block.slotPosition === input.slotPosition) {
          return this.gridOf(transaction, state);
        }
        const moved = blockAt(state.pattern.model, block, input.weekday, input.slotPosition);
        this.refuseBlocked(state, [moved]);
        await this.writeSlot(transaction, moved);
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'pattern_block.move',
          record: { type: 'pattern_block', id: block.id },
          oldValue: { versionId: id, ...this.slotOf(block) },
          newValue: { versionId: id, ...this.slotOf(moved) },
          requestId,
        });
        return this.gridAfter(transaction, version);
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
        const version = await this.timetable.lockDraft(transaction, branchId, id);
        const state = await this.stateOf(transaction, version);
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
        return this.gridAfter(transaction, version);
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
        const version = await this.timetable.lockDraft(transaction, branchId, id);
        const state = await this.stateOf(transaction, version);
        const block = this.blockOf(state, blockId);
        const lesson = block.lessons.find((one) => one.id === input.lessonId);
        const { model } = state.pattern;
        if (lesson === undefined || !model.data.rooms.some((one) => one.id === input.roomId)) {
          throw notFound();
        }
        if (lesson.roomId === input.roomId) {
          return this.gridOf(transaction, state);
        }
        const change = roomChange(model, state.blocks, block, lesson.id, input.roomId);
        if (!change.accepted) {
          throw blockedRefusal(change.blocked);
        }
        await transaction
          .updateTable('pattern_entries')
          .set({ room_id: input.roomId })
          .where('id', '=', lesson.id)
          .execute();
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'pattern_entry.room',
          record: { type: 'pattern_entry', id: lesson.id },
          oldValue: {
            versionId: id,
            blockId: block.id,
            loadRowId: lesson.loadRowId,
            roomId: lesson.roomId,
          },
          newValue: {
            versionId: id,
            blockId: block.id,
            loadRowId: lesson.loadRowId,
            roomId: input.roomId,
          },
          requestId,
        });
        return this.gridAfter(transaction, version);
      }),
    );
  }

  /** A block removed with its lessons; the audit entry keeps every lesson it removes. */
  remove(access: Access, id: string, blockId: string, requestId: string): Promise<GridAnswer> {
    const branchId = branchOf(access);
    return refusingPattern(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const version = await this.timetable.lockDraft(transaction, branchId, id);
        const state = await this.stateOf(transaction, version);
        const block = this.blockOf(state, blockId);
        const { model } = state.pattern;
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'pattern_block.delete',
          record: { type: 'pattern_block', id: block.id },
          oldValue: {
            versionId: id,
            ...this.slotOf(block),
            lessons: block.lessons.map((lesson) => ({
              id: lesson.id,
              loadRowId: lesson.loadRowId,
              teacherId: model.rowOf(lesson.loadRowId).teacherId,
              roomId: lesson.roomId,
            })),
          },
          requestId,
        });
        await transaction.deleteFrom('pattern_blocks').where('id', '=', block.id).execute();
        return this.gridAfter(transaction, version);
      }),
    );
  }

  private async stateOf(transaction: Transaction, version: VersionRow): Promise<PatternState> {
    const context = await this.timetable.contextOf(transaction, version);
    const rows = await this.timetable.rowsOf(transaction, version.id);
    const load = await LoadFacts.of(transaction, context, rows, { versionRows: rows });
    const pattern = await readPatternFacts(transaction, context, rows, load);
    return { version, rows, load, pattern, blocks: await readBlocks(transaction, version.id) };
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

  private async gridAfter(transaction: Transaction, version: VersionRow): Promise<GridAnswer> {
    return this.gridOf(transaction, await this.stateOf(transaction, version));
  }

  private async gridOf(transaction: Transaction, state: PatternState): Promise<GridAnswer> {
    const { version, rows, load, pattern, blocks } = state;
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
      version: await this.timetable.answerOf(transaction, version.id),
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
      results: checkTimetable(checkedPlacements(pattern.model, blocks), pattern.model.facts).map(
        resultAnswerOf,
      ),
    });
  }
}
