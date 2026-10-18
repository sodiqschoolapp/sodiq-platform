import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  classDisplayName,
  listName,
  weekdaySchema,
  type ErrorDetail,
  type OutOfDateAnswer,
  type TimetableVersion,
  type UpToDateBody,
  type UpToDateItem,
  type UpToDateValues,
} from '@sodiq/shared';
import {
  addDays,
  blockPlacements,
  checkTimetable,
  checkedPlacements,
  draftDifferences,
  pickedItems,
  publishRefusals,
  rowOfMergeKey,
  takenPlan,
  type MergeItem,
  type MergeValues,
  type MergeVersion,
  type PatternBlock,
  type TakenPlan,
} from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import type { StoredLoadRow } from './load-facts.js';
import {
  causeAnswers,
  causesKey,
  isPublishCause,
  storedCauses,
  type StoredCause,
} from './out-of-date.js';
import {
  refusingPattern,
  TimetablePattern,
  writeBlock,
  type PatternState,
} from './pattern.service.js';
import { readPins } from './pins-check.js';
import { PUBLISH_LOCK } from './publish.service.js';
import { resultAnswerOf } from './rule-answers.js';
import { Timetable, type VersionRow } from './timetable.service.js';

/**
 * Bringing a draft up to date (task 5.5a-3b-1, pull request #146; task
 * 5.5a-3b-2, pull request #148).
 *
 * docs/spec/edge-cases/timetable.md, Versions and drafts, "Two drafts are
 * open": "Each draft remembers the version it started from. Any publish, or
 * any change to templates, calendar, availability or rooms, marks the other
 * drafts out of date. Bringing one up to date lists what changed on both
 * sides, and the Academic Vice Principal picks." docs/spec/06-timetable.md,
 * How surprises are prevented: "the differences are shown".
 */

const refused = (code: 'out_of_date_changed' | 'up_to_date_pick_missing'): ApiException =>
  new ApiException(code, 409);

/** The published version compared, the draft's source, and the sides read (decisions 3 and 4). */
interface Comparison {
  readonly other: { id: string; number: number; starts_on: string } | null;
  readonly base: { id: string; number: number } | null;
  readonly items: MergeItem[];
  readonly draft: { state: PatternState; merge: MergeVersion } | null;
  readonly published: { state: PatternState; merge: MergeVersion } | null;
}

const NO_COMPARISON: Comparison = {
  other: null,
  base: null,
  items: [],
  draft: null,
  published: null,
};

/** A state as the comparison reads it: its rows with their classes, its lessons with their blocks, its pins. */
async function mergeVersionOf(
  transaction: Transaction,
  state: PatternState,
): Promise<MergeVersion> {
  const tutorSubjects = new Set(
    state.pattern.model.data.subjects.filter((one) => one.tutorSubject).map((one) => one.id),
  );
  const pins = await readPins(transaction, state.version.id);
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
      classIds:
        row.class_id !== null
          ? [row.class_id]
          : [...(state.load.groups.get(row.group_id ?? '')?.classIds ?? [])],
    })),
    entries: state.blocks.flatMap((block) =>
      block.lessons.map((lesson) => ({
        id: lesson.id,
        loadRowId: lesson.loadRowId,
        blockId: block.id,
        weekday: block.weekday,
        slotPosition: block.slotPosition,
        roomId: lesson.roomId,
        doublePairId: block.doublePairId,
      })),
    ),
    pins: pins.map((pin) => ({
      loadRowId: pin.load_row_id,
      weekday: pin.weekday,
      slotPosition: pin.slot_position,
    })),
  };
}

/** The key of what was shown (decision 11): the causes, the version compared and every item. */
function shownKey(
  versionId: string,
  causes: readonly StoredCause[],
  comparison: Comparison,
): string {
  if (comparison.other === null) return causesKey(versionId, causes);
  return createHash('sha256')
    .update(
      JSON.stringify({
        versionId,
        causes: causes.map((one) => one.id),
        other: comparison.other.id,
        items: comparison.items,
      }),
    )
    .digest('hex');
}

const blockedOf = (state: PatternState, blocks: readonly PatternBlock[]) =>
  publishRefusals(
    checkTimetable(checkedPlacements(state.pattern.model, blocks), state.pattern.model.facts),
  ).blocked;

/** What the audit entry keeps of a load row. */
const rowValue = (row: StoredLoadRow) => ({
  id: row.id,
  classId: row.class_id,
  groupId: row.group_id,
  subjectId: row.subject_id,
  teacherId: row.teacher_id,
  lessonsPerWeek: row.lessons_per_week,
  roomId: row.room_id,
  roomType: row.room_type,
  doubleLessons: row.double_lessons,
  mixedBlock: row.mixed_block,
  shortReason: row.short_reason ?? null,
});

@Injectable()
export class TimetableUpToDate {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly timetable: Timetable,
    private readonly pattern: TimetablePattern,
  ) {}

  /**
   * The causes of a draft's mark, oldest first, and their key (task
   * 5.5a-3b-1); with a publish cause, the differences from the published
   * version compared (task 5.5a-3b-2). A version that is not a draft lists
   * none (5.5a-3b-1 decision 7).
   */
  outOfDate(access: Access, id: string): Promise<OutOfDateAnswer> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const named = await this.timetable.namedVersion(transaction, branchOf(access), id);
      const causes = named.status === 'draft' ? await storedCauses(transaction, id) : [];
      const comparison =
        causes.length === 0
          ? NO_COMPARISON
          : await this.comparisonOf(
              transaction,
              await this.timetable.versionRow(transaction, id),
              causes,
              access.accountId,
            );
      return {
        causes: await causeAnswers(transaction, causes),
        key: shownKey(id, causes, comparison),
        other:
          comparison.other === null
            ? null
            : {
                id: comparison.other.id,
                number: comparison.other.number,
                startsOn: comparison.other.starts_on,
              },
        base: comparison.base,
        items: await this.itemAnswers(transaction, comparison.items),
      };
    });
  }

  /**
   * Brings a draft up to date: a draft write that deletes exactly the causes
   * shown, by the key of what was shown (5.5a-3b-1 decisions 4 and 10). With a
   * publish cause, the picks are checked and written, and the draft names the
   * published version compared as its source (decisions 1, 7, 8 and 10 to 13).
   * A draft with no cause is answered as it is, and nothing is written.
   */
  bringUpToDate(
    access: Access,
    id: string,
    input: UpToDateBody,
    requestId: string,
  ): Promise<TimetableVersion> {
    return refusingPattern(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const named = await this.timetable.namedVersion(transaction, branchOf(access), id);
        if (named.status === 'draft' && (await storedCauses(transaction, id)).length === 0) {
          return this.timetable.answerOf(transaction, id, access.accountId);
        }
        // Decision 10: the publish lock first, then the draft's, the order of
        // publish; a publish or a carry cannot change the version compared
        // between the check and the write.
        await sql`select pg_advisory_xact_lock(${PUBLISH_LOCK})`.execute(transaction);
        const version = await this.timetable.lockDraft(transaction, access, id, requestId);
        const causes = await storedCauses(transaction, id);
        if (causes.length === 0) {
          return this.timetable.answerOf(transaction, id, access.accountId);
        }
        const comparison = await this.comparisonOf(transaction, version, causes, access.accountId);
        if (input.key !== shownKey(id, causes, comparison)) {
          throw refused('out_of_date_changed');
        }
        const written =
          comparison.other !== null && comparison.draft !== null && comparison.published !== null
            ? await this.writePicks(transaction, version, comparison, input, access.accountId)
            : null;
        const fromAfter = comparison.other?.id ?? version.from_version_id;
        if (fromAfter !== version.from_version_id) {
          await transaction
            .updateTable('timetable_versions')
            .set({ from_version_id: fromAfter })
            .where('id', '=', id)
            .execute();
        }
        await transaction
          .deleteFrom('timetable_version_out_of_date_causes')
          .where(
            'id',
            'in',
            causes.map((one) => one.id),
          )
          .execute();
        await this.audit.record(transaction, {
          branchId: branchOf(access),
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'timetable_version.up_to_date',
          record: { type: 'timetable_version', id },
          oldValue: {
            outOfDate: true,
            causes: causes.map((one) => ({
              id: one.id,
              action: one.action,
              recordId: one.record_id,
              causedAt: one.caused_at.toISOString(),
            })),
            fromVersionId: version.from_version_id,
          },
          newValue: {
            outOfDate: false,
            ...(comparison.other === null
              ? {}
              : {
                  comparedVersionId: comparison.other.id,
                  fromVersionId: fromAfter,
                  picks: input.picks.map((one) => ({ item: one.item, side: one.side })),
                  ...(written ?? {}),
                }),
          },
          requestId,
        });
        return this.timetable.answerOf(transaction, id, access.accountId);
      }),
    );
  }

  /**
   * Decision 3: with a publish cause, the draft is compared with the
   * published version in force on the later of its start and tomorrow in
   * branch time; with none in force then, the year's earliest published
   * version; with none at all, nothing is compared.
   */
  private async comparisonOf(
    transaction: Transaction,
    version: VersionRow,
    causes: readonly StoredCause[],
    accountId: string,
  ): Promise<Comparison> {
    if (!causes.some(isPublishCause)) return NO_COMPARISON;
    const tomorrow = addDays(await this.timetable.todayIn(transaction, version.branch_id), 1);
    const on = version.starts_on > tomorrow ? version.starts_on : tomorrow;
    const published = await transaction
      .selectFrom('timetable_versions')
      .select(['id', 'number', 'starts_on'])
      .where('branch_id', '=', version.branch_id)
      .where('academic_year_id', '=', version.academic_year_id)
      .where('status', '=', 'published')
      .orderBy('starts_on')
      .orderBy('number')
      .execute();
    const other = published.filter((one) => one.starts_on <= on).at(-1) ?? published[0] ?? null;
    if (other === null) return NO_COMPARISON;
    const draftState = await this.pattern.stateOf(transaction, version, accountId);
    const otherState = await this.pattern.stateOf(
      transaction,
      await this.timetable.versionRow(transaction, other.id),
      accountId,
    );
    const baseRow =
      version.from_version_id === null
        ? null
        : await this.timetable.versionRow(transaction, version.from_version_id);
    const baseMerge =
      baseRow === null
        ? null
        : await mergeVersionOf(
            transaction,
            await this.pattern.stateOf(transaction, baseRow, accountId),
          );
    const draft = { state: draftState, merge: await mergeVersionOf(transaction, draftState) };
    const otherSide = { state: otherState, merge: await mergeVersionOf(transaction, otherState) };
    return {
      other,
      base: baseRow === null ? null : { id: baseRow.id, number: baseRow.number },
      items: draftDifferences(baseMerge, draft.merge, otherSide.merge),
      draft,
      published: otherSide,
    };
  }

  /**
   * The picks checked in memory (decision 8) and written (decisions 9, 12
   * and 13). Returns what the audit entry keeps of the write.
   */
  private async writePicks(
    transaction: Transaction,
    version: VersionRow,
    comparison: Comparison,
    input: UpToDateBody,
    accountId: string,
  ) {
    const draft = comparison.draft;
    const published = comparison.published;
    if (draft === null || published === null) return null;
    const picked = pickedItems(comparison.items, input.picks);
    if (!picked.ok) {
      throw refused(
        picked.code === 'pick_missing' ? 'up_to_date_pick_missing' : 'out_of_date_changed',
      );
    }
    const plan = takenPlan(draft.merge, published.merge, picked.published);
    if (
      plan.updateRows.length === 0 &&
      plan.insertRows.length === 0 &&
      plan.removeRows.length === 0
    ) {
      return {
        rows: { updated: [], inserted: [], removed: [] },
        blocks: { removed: [], added: [] },
        pins: { removed: [], added: [] },
      };
    }

    // The rows of the draft with the picks taken, in memory: a row changed in
    // place keeps the draft's id and Tutor teacher (decision 6); a row added
    // keeps the published side's id until it is written.
    const publishedRow = new Map(published.state.rows.map((one) => [one.id, one]));
    const removed = new Set(plan.removeRows);
    const updates = new Map(plan.updateRows.map((one) => [one.draftId, one.publishedId]));
    const context = await this.timetable.contextOf(transaction, version);
    const added = await this.timetable.withVersionTutors(
      transaction,
      context,
      plan.insertRows.flatMap((one) => {
        const row = publishedRow.get(one);
        return row === undefined ? [] : [{ ...row, version_id: version.id }];
      }),
    );
    const tutorRows = new Set(draft.merge.rows.filter((one) => one.tutorRow).map((one) => one.id));
    const mergedRows: StoredLoadRow[] = [
      ...draft.state.rows
        .filter((one) => !removed.has(one.id))
        .map((one) => {
          const from = publishedRow.get(updates.get(one.id) ?? '');
          return from === undefined
            ? one
            : {
                ...one,
                teacher_id: tutorRows.has(one.id) ? one.teacher_id : from.teacher_id,
                lessons_per_week: from.lessons_per_week,
                room_id: from.room_id,
                room_type: from.room_type,
                double_lessons: from.double_lessons,
                mixed_block: from.mixed_block,
                short_reason: from.short_reason ?? null,
              };
        }),
      ...added,
    ];
    const rowIdOf = (publishedId: string): string =>
      plan.updateRows.find((one) => one.publishedId === publishedId)?.draftId ?? publishedId;
    const merged = await this.pattern.stateOf(transaction, version, accountId, mergedRows);
    const details: ErrorDetail[] = [];
    const takenBlocks = this.blocksTaken(merged, published.state, plan, rowIdOf, details);
    const removedBlocks = new Set(plan.removeBlocks);
    const mergedBlocks = [
      ...draft.state.blocks.filter((one) => !removedBlocks.has(one.id)),
      ...takenBlocks,
    ];
    const known = new Set(
      blockedOf(draft.state, draft.state.blocks).map((one) => JSON.stringify(resultAnswerOf(one))),
    );
    for (const result of blockedOf(merged, mergedBlocks)) {
      const answer = resultAnswerOf(result);
      if (known.has(JSON.stringify(answer))) continue;
      details.push({
        path: `pattern.${result.rule}`,
        code: result.rule,
        message: 'A blocked rule of the timetable.',
        rule: { weekday: answer.weekday, lessonIds: answer.lessonIds },
      });
    }
    // Decision 8: a load problem of a row taken that the draft's row did not have.
    const problemsBefore = (
      await this.timetable.readinessOf(transaction, version.branch_id, version, draft.state.rows)
    ).load.problemRows;
    const problemsAfter = (
      await this.timetable.readinessOf(transaction, version.branch_id, version, mergedRows)
    ).load.problemRows;
    const taken = new Set([...updates.keys(), ...added.map((one) => one.id)]);
    for (const one of problemsAfter) {
      if (!taken.has(one.id)) continue;
      const was = new Set(problemsBefore.find((other) => other.id === one.id)?.problems ?? []);
      for (const problem of one.problems) {
        if (was.has(problem)) continue;
        details.push({
          path: `loadRows.${one.id}`,
          code: problem,
          message: 'A load problem of a row taken from the published version.',
        });
      }
    }
    if (details.length > 0) {
      throw new ApiException('up_to_date_blocked', 409, undefined, details);
    }

    return this.write(
      transaction,
      version,
      draft.state,
      merged,
      takenBlocks,
      plan,
      mergedRows,
      added,
    );
  }

  /**
   * The published side's blocks of the rows taken, on the draft's rows and the
   * draft's template times (decision 12), each double pair with a new pair id
   * of the draft (spec review must-fix 2). A slot the draft's template does not
   * hold is a detail of the refusal (`pattern_no_slot`).
   */
  private blocksTaken(
    merged: PatternState,
    published: PatternState,
    plan: TakenPlan,
    rowIdOf: (publishedId: string) => string,
    details: ErrorDetail[],
  ): PatternBlock[] {
    const pairs = new Map<string, string>();
    const blocks: PatternBlock[] = [];
    for (const blockId of plan.insertBlocks) {
      const block = published.blocks.find((one) => one.id === blockId);
      if (block === undefined) continue;
      const lessons = block.lessons.map((lesson) => ({
        id: randomUUID(),
        loadRowId: rowIdOf(lesson.loadRowId),
        roomId: lesson.roomId,
      }));
      const doublePairId =
        block.doublePairId === null
          ? null
          : (pairs.get(block.doublePairId) ??
            pairs.set(block.doublePairId, randomUUID()).get(block.doublePairId) ??
            null);
      const [first] =
        blockPlacements(
          merged.pattern.model,
          { id: block.id, lessons, doublePairId },
          block.weekday,
          block.slotPosition,
        ) ?? [];
      if (first === undefined) {
        details.push({
          path: `slots.${String(block.weekday)}.${String(block.slotPosition)}`,
          code: 'pattern_no_slot',
          message: 'The draft has no lesson slot at this weekday and position.',
        });
        continue;
      }
      blocks.push({
        id: randomUUID(),
        weekday: block.weekday,
        slotPosition: block.slotPosition,
        start: first.start,
        end: first.end,
        lessons,
        doublePairId,
      });
    }
    return blocks;
  }

  /**
   * The picks written: rows, blocks and pins, with what the audit entry keeps
   * (decision 13). The blocks are those the check built, on its template
   * times; nothing of the setup is read again (code round 2, finding 1).
   */
  private async write(
    transaction: Transaction,
    version: VersionRow,
    draft: PatternState,
    merged: PatternState,
    takenBlocks: readonly PatternBlock[],
    plan: TakenPlan,
    mergedRows: readonly StoredLoadRow[],
    added: readonly StoredLoadRow[],
  ) {
    const branchId = version.branch_id;
    const pins = await readPins(transaction, version.id);
    const takenDraftRows = new Set([
      ...plan.updateRows.map((one) => one.draftId),
      ...plan.removeRows,
    ]);
    const removedPins = pins.filter((pin) => takenDraftRows.has(pin.load_row_id));
    const removedBlocks = draft.blocks
      .filter((one) => plan.removeBlocks.includes(one.id))
      .map((block) => ({
        id: block.id,
        weekday: block.weekday,
        slotPosition: block.slotPosition,
        start: block.start,
        end: block.end,
        doublePairId: block.doublePairId,
        lessons: block.lessons.map((lesson) => ({
          id: lesson.id,
          loadRowId: lesson.loadRowId,
          roomId: lesson.roomId,
        })),
        // A lock of the block goes with it (0072 cascade).
        locks: draft.locks
          .filter((lock) => lock.kind === 'block' && lock.blockId === block.id)
          .map((lock) => lock.id),
      }));
    if (plan.removeBlocks.length > 0) {
      await transaction
        .deleteFrom('pattern_blocks')
        .where('id', 'in', [...plan.removeBlocks])
        .execute();
    }
    if (removedPins.length > 0) {
      await transaction
        .deleteFrom('timetable_pins')
        .where(
          'id',
          'in',
          removedPins.map((one) => one.id),
        )
        .execute();
    }
    const removedRows = draft.rows.filter((one) => plan.removeRows.includes(one.id));
    if (removedRows.length > 0) {
      await transaction
        .deleteFrom('teaching_load_rows')
        .where(
          'id',
          'in',
          removedRows.map((one) => one.id),
        )
        .execute();
    }
    const updated: { before: ReturnType<typeof rowValue>; after: ReturnType<typeof rowValue> }[] =
      [];
    for (const { draftId } of plan.updateRows) {
      const before = draft.rows.find((one) => one.id === draftId);
      const after = mergedRows.find((one) => one.id === draftId);
      // A row whose load fields are the same is not written; only its blocks and pins were.
      if (
        before === undefined ||
        after === undefined ||
        JSON.stringify(rowValue(before)) === JSON.stringify(rowValue(after))
      ) {
        continue;
      }
      await transaction
        .updateTable('teaching_load_rows')
        .set({
          teacher_id: after.teacher_id,
          lessons_per_week: after.lessons_per_week,
          room_id: after.room_id,
          room_type: after.room_type,
          double_lessons: after.double_lessons,
          mixed_block: after.mixed_block,
          short_reason: after.short_reason ?? null,
        })
        .where('id', '=', draftId)
        .execute();
      updated.push({ before: rowValue(before), after: rowValue(after) });
    }
    const newId = new Map<string, string>();
    for (const row of added) {
      const inserted = await transaction
        .insertInto('teaching_load_rows')
        .values({
          branch_id: branchId,
          version_id: version.id,
          class_id: row.class_id,
          group_id: row.group_id,
          subject_id: row.subject_id,
          teacher_id: row.teacher_id,
          lessons_per_week: row.lessons_per_week,
          room_id: row.room_id,
          room_type: row.room_type,
          double_lessons: row.double_lessons,
          mixed_block: row.mixed_block,
          short_reason: row.short_reason ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      newId.set(row.id, inserted.id);
    }
    const finalId = (id: string): string =>
      newId.get(id) ?? plan.updateRows.find((one) => one.publishedId === id)?.draftId ?? id;
    const addedPins = plan.pins.map((pin) => ({ ...pin, loadRowId: finalId(pin.loadRowId) }));
    if (addedPins.length > 0) {
      await transaction
        .insertInto('timetable_pins')
        .values(
          addedPins.map((pin) => ({
            branch_id: branchId,
            version_id: version.id,
            load_row_id: pin.loadRowId,
            weekday: pin.weekday,
            slot_position: pin.slotPosition,
          })),
        )
        .execute();
    }
    // The blocks checked, with only their lessons' row ids mapped to the rows
    // as written; a row's teacher is read from the row the check saw.
    const checkedIdOf = new Map([...newId].map(([checked, written]) => [written, checked]));
    const model = {
      rowOf: (rowId: string) => merged.pattern.model.rowOf(checkedIdOf.get(rowId) ?? rowId),
    };
    const addedBlocks = [];
    for (const checked of takenBlocks) {
      const block = {
        ...checked,
        lessons: checked.lessons.map((one) => ({ ...one, loadRowId: finalId(one.loadRowId) })),
      };
      const { block: written, entries } = await writeBlock(transaction, version, model, block);
      addedBlocks.push({
        id: written.id,
        weekday: block.weekday,
        slotPosition: block.slotPosition,
        start: block.start,
        end: block.end,
        doublePairId: block.doublePairId,
        lessons: entries.map((entry) => ({
          id: entry.id,
          loadRowId: entry.load_row_id,
          roomId: block.lessons.find((one) => one.loadRowId === entry.load_row_id)?.roomId ?? null,
        })),
      });
    }
    return {
      rows: {
        updated,
        inserted: added.map((row) => rowValue({ ...row, id: finalId(row.id) })),
        removed: removedRows.map(rowValue),
      },
      blocks: { removed: removedBlocks, added: addedBlocks },
      pins: {
        removed: removedPins.map((pin) => ({
          id: pin.id,
          loadRowId: pin.load_row_id,
          weekday: pin.weekday,
          slotPosition: pin.slot_position,
        })),
        added: addedPins,
      },
    };
  }

  /** The items with the names of their classes, groups, subjects, teachers and rooms. */
  private async itemAnswers(
    transaction: Transaction,
    items: readonly MergeItem[],
  ): Promise<UpToDateItem[]> {
    if (items.length === 0) return [];
    const rows = items.flatMap((item) => item.rows);
    const sides = rows.flatMap((row) =>
      [row.base, row.draft, row.published].flatMap((one) => (one === null ? [] : [one])),
    );
    const ids = (list: (string | null)[]) => [
      ...new Set(list.flatMap((one) => (one === null ? [] : [one]))),
    ];
    // The rows a lesson shares its block with, named too: on the side the
    // draft started from they need not be rows of the item.
    const withRows = sides.flatMap((one) =>
      one.placements.flatMap((placement) => placement.with.map(rowOfMergeKey)),
    );
    const named = [...rows, ...withRows];
    const classIds = ids(named.map((one) => one.classId));
    const groupIds = ids(named.map((one) => one.groupId));
    const subjectIds = ids(named.map((one) => one.subjectId));
    const staffIds = ids(sides.map((one) => one.teacherId));
    const roomIds = ids([
      ...sides.map((one) => one.roomId),
      ...sides.flatMap((one) => one.placements.map((placement) => placement.roomId)),
    ]);
    const [classes, groups, subjects, staff, rooms] = await Promise.all([
      classIds.length === 0
        ? []
        : transaction
            .selectFrom('classes')
            .select(['id', 'name', 'grade'])
            .where('id', 'in', classIds)
            .execute(),
      groupIds.length === 0
        ? []
        : transaction
            .selectFrom('groups')
            .select(['id', 'name'])
            .where('id', 'in', groupIds)
            .execute(),
      subjectIds.length === 0
        ? []
        : transaction
            .selectFrom('subjects')
            .select(['id', 'name_uz', 'name_ru', 'name_en'])
            .where('id', 'in', subjectIds)
            .execute(),
      staffIds.length === 0
        ? []
        : transaction
            .selectFrom('staff')
            .select(['id', 'kind', 'first_name', 'last_name', 'vacancy_name'])
            .where('id', 'in', staffIds)
            .execute(),
      roomIds.length === 0
        ? []
        : transaction
            .selectFrom('rooms')
            .select(['id', 'name'])
            .where('id', 'in', roomIds)
            .execute(),
    ]);
    const unitName = new Map([
      ...classes.map((one) => [one.id, classDisplayName(one.grade, one.name)] as const),
      ...groups.map((one) => [one.id, one.name] as const),
    ]);
    const subjectNames = new Map(
      subjects.map((one) => [one.id, { uz: one.name_uz, ru: one.name_ru, en: one.name_en }]),
    );
    const staffName = new Map(
      staff.map((one) => [
        one.id,
        one.kind === 'vacancy'
          ? (one.vacancy_name ?? '')
          : listName({ firstName: one.first_name ?? '', lastName: one.last_name ?? '' }),
      ]),
    );
    const roomName = new Map(rooms.map((one) => [one.id, one.name]));
    const valuesOf = (one: MergeValues | null): UpToDateValues | null =>
      one === null
        ? null
        : {
            ...one,
            teacherName: one.teacherId === null ? null : (staffName.get(one.teacherId) ?? null),
            roomName: one.roomId === null ? null : (roomName.get(one.roomId) ?? null),
            placements: one.placements.map((placement) => ({
              ...placement,
              weekday: weekdaySchema.parse(placement.weekday),
              pairedWith:
                placement.pairedWith === null
                  ? null
                  : {
                      weekday: weekdaySchema.parse(placement.pairedWith.weekday),
                      slotPosition: placement.pairedWith.slotPosition,
                    },
              with: placement.with.map((key) => {
                const row = rowOfMergeKey(key);
                return {
                  key,
                  unitName: unitName.get(row.classId ?? row.groupId ?? '') ?? '',
                  subjectNames: subjectNames.get(row.subjectId) ?? { uz: '', ru: '', en: '' },
                };
              }),
              roomName: placement.roomId === null ? null : (roomName.get(placement.roomId) ?? null),
            })),
            pins: one.pins.map((pin) => ({
              weekday: weekdaySchema.parse(pin.weekday),
              slotPosition: pin.slotPosition,
            })),
          };
    return items.map((item) => ({
      key: item.key,
      changedBy: item.changedBy,
      defaultPick: item.defaultPick,
      rows: item.rows.map((row) => ({
        key: row.key,
        classId: row.classId,
        groupId: row.groupId,
        unitName: unitName.get(row.classId ?? row.groupId ?? '') ?? '',
        subjectId: row.subjectId,
        subjectNames: subjectNames.get(row.subjectId) ?? { uz: '', ru: '', en: '' },
        tutorRow: row.tutorRow,
        base: valuesOf(row.base),
        draft: valuesOf(row.draft),
        published: valuesOf(row.published),
      })),
    }));
  }
}
