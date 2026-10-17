import { Injectable } from '@nestjs/common';
import {
  gridSchema,
  subjectColourSchema,
  weekdaySchema,
  type ErrorCode,
  type GridAnswer,
  type MoveRecord,
  type PlaceRecord,
  type RuleResultAnswer,
  type SwapRecord,
} from '@sodiq/shared';
import {
  blockPlacements,
  checkCandidates,
  checkTimetable,
  patternPlacements,
  type BlockLesson,
  type PatternBlock,
  type PatternModel,
  type RuleResult,
} from '@sodiq/timetable-rules';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { LOAD_REFUSALS, LoadFacts, type StoredLoadRow } from './load-facts.js';
import { readPatternFacts, type PatternFacts } from './pattern-facts.js';
import { deferPatternClashes } from './pattern-queries.js';
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

/** A result as the answer and a refusal name it: a weekday, or `null` for the week. */
export const resultAnswerOf = (result: RuleResult): RuleResultAnswer => ({
  rule: result.rule,
  severity: result.severity,
  weekday: result.day === '' ? null : weekdaySchema.parse(Number(result.day)),
  lessonIds: [...result.lessonIds],
  ...(result.detail === undefined ? {} : { detail: { ...result.detail } }),
});

/** What a write reads of its draft: the rows, the engine's input and the placed blocks. */
interface PatternState {
  readonly version: VersionRow;
  readonly rows: StoredLoadRow[];
  readonly load: LoadFacts;
  readonly pattern: PatternFacts;
  readonly blocks: PatternBlock[];
}

/** The placed blocks of a version, each with its lessons (one per load row). */
async function readBlocks(transaction: Transaction, versionId: string): Promise<PatternBlock[]> {
  const [blocks, entries] = await Promise.all([
    transaction
      .selectFrom('pattern_blocks')
      .select(['id', 'weekday', 'slot_position', 'start_minutes', 'end_minutes'])
      .where('version_id', '=', versionId)
      .orderBy('weekday')
      .orderBy('start_minutes')
      .orderBy('id')
      .execute(),
    transaction
      .selectFrom('pattern_entries')
      .select(['id', 'block_id', 'load_row_id', 'room_id'])
      .where('version_id', '=', versionId)
      .orderBy('load_row_id')
      .orderBy('id')
      .execute(),
  ]);
  return blocks.map((block) => ({
    id: block.id,
    weekday: block.weekday,
    slotPosition: block.slot_position,
    start: block.start_minutes,
    end: block.end_minutes,
    lessons: entries
      .filter((entry) => entry.block_id === block.id)
      .map((entry) => ({ id: entry.id, loadRowId: entry.load_row_id, roomId: entry.room_id })),
  }));
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
        const lessons = model.rowOf(row.id).block.map((rowId) => ({
          id: `new:${rowId}`,
          loadRowId: rowId,
          roomId: model.roomOfNew(model.rowOf(rowId)),
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
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'pattern_block.swap',
          record: { type: 'pattern_block', id: a.id },
          oldValue: {
            versionId: id,
            blocks: [a, b].map((one) => ({ id: one.id, ...this.slotOf(one) })),
          },
          newValue: {
            versionId: id,
            blocks: [movedA, movedB].map((one) => ({ id: one.id, ...this.slotOf(one) })),
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
      patternPlacements(model, state.blocks),
      model.facts,
      patternPlacements(model, changed),
    ).filter((result) => result.severity === 'blocked');
    if (blocked.length > 0) {
      throw new ApiException(
        'pattern_blocked',
        409,
        undefined,
        blocked.map((result) => {
          const answer = resultAnswerOf(result);
          return {
            path: '',
            code: result.rule,
            message: 'A blocked rule of the timetable.',
            rule: { weekday: answer.weekday, lessonIds: answer.lessonIds },
          };
        }),
      );
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
      results: checkTimetable(patternPlacements(pattern.model, blocks), pattern.model.facts).map(
        resultAnswerOf,
      ),
    });
  }
}
