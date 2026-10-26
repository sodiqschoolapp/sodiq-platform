import { Injectable } from '@nestjs/common';
import {
  PLAN_LINKS_MAX,
  PLAN_OBJECTIVES_MAX_LENGTH,
  PLAN_TOPIC_MAX_LENGTH,
  PLAN_WORKS_MAX,
  type Plan,
  type PlanCarry,
  type PlanDrop,
  type PlanMerge,
  type PlanPlace,
} from '@sodiq/shared';
import { Transactions, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import { refuseOwnRequest } from '../access/own-request.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { plannedJournal } from '../journal/journal-grid.query.js';
import { lockOpenQuarter } from '../setup/closed-quarters.js';
import { notFound } from '../setup/setup-refusals.js';
import { gateDetail, type GatePass, type GateTarget } from './plan-gate.js';
import {
  carryItem,
  dropReachOf,
  holdQuarter,
  leaveNotCovered,
  moveToRow,
  nextQuarterOf,
  notCoveredAt,
  writeOutcome,
  type NotCoveredAt,
  type OutcomeActor,
} from './plan-outcomes.js';
import { movePlaces, planIdOf, worksOf, type PlanRowLesson } from './plan-read.js';
import { PlansService, type Scene } from './plans.service.js';

/**
 * The routes of the outcomes of "not covered" items and of the "carried in" tray (task 9.2d, pull
 * request #233; `edge/lesson-plans`, "Items are still 'not covered' at the end of the quarter";
 * `09`: "With an approved edit request the teacher merges them into other lessons or carries them
 * into the next quarter's plan"). Merge, carry and place are plan writes: only the owner, after
 * `lockPlanOf`, through `PlansService.gate` (`.claude/rules/lesson-plans.md`). The drop is the
 * approver's decision (decision 3): no window or period, nobody in their own plan.
 */

type WriteScene = Scene & { readonly assignmentId: string };

const KINDS = [
  { kind: 'classwork', list: 'classworks' },
  { kind: 'homework', list: 'homeworks' },
] as const;

@Injectable()
export class PlanOutcomesService {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly plans: PlansService,
  ) {}

  /** `POST /api/plans/journals/:journalId/not-covered/:itemId/merge`. */
  merge(
    access: Access,
    journalId: string,
    itemId: string,
    input: PlanMerge,
    requestId: string | undefined,
  ): Promise<Plan> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const found = await this.writeOf(transaction, access, journalId, input.quarterId, itemId);
      const { scene, members, rows, at } = found;
      const planId = await this.planOf(transaction, scene);
      const row = await this.rowOf(transaction, scene, rows, input.position, input.lessonId);
      const places = await this.plans.placesOf(transaction, planId, journalId);
      const targetId = [...places].find(([, position]) => position === input.position)?.[0];
      if (targetId === itemId) throw new ApiException('plan_item_covered', 409);
      const actor = actorOf(access, scene, requestId);
      let pass: GatePass;
      let details: Record<string, JsonValue>;
      // The stale check of the row's item (code review, must-fix 2).
      if (targetId === undefined && input.base !== null) {
        throw new ApiException('plan_merge_stale', 409);
      }
      if (targetId !== undefined && input.base === null) {
        throw new ApiException('plan_row_taken', 409);
      }
      if (targetId === undefined) {
        // An empty row takes the item.
        pass = await this.plans.gate(transaction, scene, planId, [
          { journalId, rows: [gateRowOf(row)], op: 'create' },
          ...(at.kind === 'place' ? [pastTarget(journalId)] : []),
        ]);
        await writeOutcome(transaction, actor, {
          journalId,
          quarterId: scene.quarter.id,
          itemId,
          kind: 'merged',
          targetDate: row.date,
        });
        await moveToRow(transaction, scene.branchId, {
          planId,
          journalId,
          quarterId: scene.quarter.id,
          itemId,
          at,
          position: input.position,
        });
        const startedIn = row.started ? [journalId] : [];
        const works = (await worksOf(transaction, [itemId])).get(itemId);
        await this.plans.markEditedAfterLesson(transaction, pass, itemId, startedIn);
        await this.plans.openColumns(
          transaction,
          scene.branchId,
          pass,
          [...(works?.classworks ?? []), ...(works?.homeworks ?? [])].map((work) => work.id),
          startedIn,
        );
        await this.plans.takeOverWorks(transaction, scene, access, itemId, startedIn, requestId);
        details = { itemId, into: 'empty_row', position: input.position, date: row.date };
      } else {
        // "An edit applies to every class sharing it": the target changes for every journal, so
        // the item must not stand at a row of another journal (decision 8).
        for (const other of members) {
          if (other === journalId) continue;
          const otherRows = await this.plans.rowsOfJournal(transaction, scene, other);
          const otherAt = (await this.plans.placesOf(transaction, planId, other)).get(itemId);
          if (otherAt !== undefined && otherAt <= otherRows.length) {
            throw new ApiException('plan_merge_shared', 409);
          }
        }
        const targets: GateTarget[] = [];
        const startedIn: string[] = [];
        for (const other of members) {
          const otherRows =
            other === journalId ? rows : await this.plans.rowsOfJournal(transaction, scene, other);
          const position = (await this.plans.placesOf(transaction, planId, other)).get(targetId);
          if (position === undefined) continue;
          const otherRow = otherRows[position - 1];
          if (otherRow?.started === true) startedIn.push(other);
          targets.push({
            journalId: other,
            rows: [
              otherRow === undefined
                ? { lessonId: null, date: null, started: false }
                : gateRowOf(otherRow),
            ],
            op: 'wording',
          });
        }
        if (at.kind === 'place') targets.push(pastTarget(journalId));
        pass = await this.plans.gate(transaction, scene, planId, targets);
        const target = await this.plans.lockItem(transaction, targetId);
        const base = input.base;
        if (
          base === null ||
          base.topic !== target.topic ||
          base.objectives !== target.objectives ||
          base.links.length !== target.links.length ||
          base.links.some((link, index) => link !== target.links[index])
        ) {
          throw new ApiException('plan_merge_stale', 409);
        }
        const source = await this.plans.lockItem(transaction, itemId);
        const lists = await worksOf(transaction, [targetId, itemId]);
        const targetWorks = lists.get(targetId) ?? { classworks: [], homeworks: [] };
        const sourceWorks = lists.get(itemId) ?? { classworks: [], homeworks: [] };
        const topic = `${target.topic}; ${source.topic}`;
        const objectives = [target.objectives, source.objectives]
          .filter((one) => one.trim() !== '')
          .join('\n');
        const links = [...new Set([...target.links, ...source.links])];
        if (
          topic.length > PLAN_TOPIC_MAX_LENGTH ||
          objectives.length > PLAN_OBJECTIVES_MAX_LENGTH ||
          links.length > PLAN_LINKS_MAX
        ) {
          throw new ApiException('plan_merge_too_long', 409);
        }
        for (const { list } of KINDS) {
          if (targetWorks[list].length + sourceWorks[list].length > PLAN_WORKS_MAX) {
            throw new ApiException('plan_works_full', 409);
          }
        }
        await transaction
          .updateTable('lesson_plan_items')
          .set({ topic, objectives, links })
          .where('id', '=', targetId)
          .execute();
        const added: string[] = [];
        for (const { kind, list } of KINDS) {
          let position = targetWorks[list].length;
          for (const work of sourceWorks[list]) {
            position += 1;
            const made = await transaction
              .insertInto('lesson_plan_works')
              .values({
                branch_id: scene.branchId,
                item_id: targetId,
                kind,
                position,
                title: work.title,
                description: work.description,
              })
              .returning('id')
              .executeTakeFirstOrThrow();
            added.push(made.id);
          }
        }
        await writeOutcome(transaction, actor, {
          journalId,
          quarterId: scene.quarter.id,
          itemId,
          kind: 'merged',
          targetDate: row.date,
        });
        await leaveNotCovered(transaction, journalId, scene.quarter.id, itemId, at);
        await this.plans.markEditedAfterLesson(transaction, pass, targetId, startedIn);
        await this.plans.openColumns(transaction, scene.branchId, pass, added, startedIn);
        await this.plans.takeOverWorks(transaction, scene, access, targetId, startedIn, requestId);
        // `09`: "old text, new text, who approved" (`.claude/rules/lesson-plans.md`).
        const after = (await worksOf(transaction, [targetId])).get(targetId);
        details = {
          itemId,
          into: 'item',
          targetItemId: targetId,
          position: input.position,
          date: row.date,
          old: {
            topic: target.topic,
            objectives: target.objectives,
            links: target.links,
            classworks: targetWorks.classworks,
            homeworks: targetWorks.homeworks,
          },
          new: {
            topic,
            objectives,
            links,
            classworks: after?.classworks ?? [],
            homeworks: after?.homeworks ?? [],
          },
        };
      }
      await this.audit.record(transaction, {
        branchId: scene.branchId,
        actorId: access.accountId,
        assignmentId: scene.assignmentId,
        action: 'plan.not_covered_merged',
        record: { type: 'lesson_plan', id: planId },
        newValue: { journalId, quarterId: scene.quarter.id, ...details },
        ...(gateDetail(pass) === null ? {} : { details: gateDetail(pass) }),
        ...(requestId === undefined ? {} : { requestId }),
      });
      return this.plans.answer(transaction, scene);
    });
  }

  /** `POST /api/plans/journals/:journalId/not-covered/:itemId/carry`. */
  carry(
    access: Access,
    journalId: string,
    itemId: string,
    input: PlanCarry,
    requestId: string | undefined,
  ): Promise<Plan> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      // The next quarter is held before any journal (the order of its close; must-fix 5).
      const next = await this.nextOf(transaction, access, input.quarterId);
      const found = await this.writeOf(transaction, access, journalId, input.quarterId, itemId, [
        next,
      ]);
      const { scene, at } = found;
      const planId = await this.planOf(transaction, scene);
      if (next === null) throw new ApiException('plan_carry_refused', 409);
      await lockOpenQuarter(transaction, next, 'plan_carry_refused');
      const pass = await this.plans.gate(transaction, scene, planId, [pastTarget(journalId)]);
      const actor = actorOf(access, scene, requestId);
      const carried = await carryItem(transaction, this.audit, actor, {
        journal: scene.journal,
        quarterId: scene.quarter.id,
        nextQuarterId: next,
        itemId,
        at,
        automatic: false,
      });
      await this.audit.record(transaction, {
        branchId: scene.branchId,
        actorId: access.accountId,
        assignmentId: scene.assignmentId,
        action: 'plan.not_covered_carried',
        record: { type: 'lesson_plan', id: planId },
        newValue: {
          journalId,
          quarterId: scene.quarter.id,
          itemId,
          copyId: carried.copyId,
          nextPlanId: carried.planId,
          nextQuarterId: next,
          automatic: false,
        },
        ...(gateDetail(pass) === null ? {} : { details: gateDetail(pass) }),
        ...(requestId === undefined ? {} : { requestId }),
      });
      return this.plans.answer(transaction, scene);
    });
  }

  /** `POST /api/plans/journals/:journalId/not-covered/:itemId/drop`: the approver only. */
  drop(
    access: Access,
    journalId: string,
    itemId: string,
    input: PlanDrop,
    requestId: string | undefined,
  ): Promise<Plan> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.plans.sceneOf(
        transaction,
        access,
        branchId,
        journalId,
        input.quarterId,
      );
      // The item of the path against the branch first (code review, should-fix 4).
      const known = await transaction
        .selectFrom('lesson_plan_items')
        .select('id')
        .where('id', '=', itemId)
        .where('branch_id', '=', branchId)
        .executeTakeFirst();
      if (known === undefined) throw notFound();
      const { reach, ownerAccountId } = await dropReachOf(
        transaction,
        access.accountId,
        branchId,
        scene.journal,
        scene.ownerId,
        scene.now,
      );
      if (reach === 'own' && ownerAccountId !== null) {
        refuseOwnRequest(access.accountId, ownerAccountId);
      }
      if (reach !== 'decide') throw new ApiException('plan_scope', 403);
      if (!plannedJournal(scene.journal)) throw new ApiException('plan_attendance_only', 409);
      if (scene.closed) throw new ApiException('plan_year_closed', 409);
      await lockOpenQuarter(transaction, scene.quarter.id, 'plan_quarter_closed');
      if (!scene.open) throw new ApiException('plan_closed', 409);
      await this.plans.lockPlanOf(transaction, journalId, scene.quarter.id);
      const rows = await this.plans.rowsOfJournal(transaction, scene, journalId);
      const at = await this.notCoveredOf(transaction, scene, rows, itemId);
      const planId = await this.planOf(transaction, scene);
      const item = await this.plans.lockItem(transaction, itemId);
      const works = (await worksOf(transaction, [itemId])).get(itemId);
      await writeOutcome(transaction, actorOf(access, scene, requestId, access.assignmentId), {
        journalId,
        quarterId: scene.quarter.id,
        itemId,
        kind: 'dropped',
        reason: input.reason,
      });
      await leaveNotCovered(transaction, journalId, scene.quarter.id, itemId, at);
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'plan.not_covered_dropped',
        record: { type: 'lesson_plan', id: planId },
        oldValue: {
          itemId,
          topic: item.topic,
          objectives: item.objectives,
          links: item.links,
          classworks: works?.classworks ?? [],
          homeworks: works?.homeworks ?? [],
        },
        newValue: { journalId, quarterId: scene.quarter.id, itemId, reason: input.reason },
        ...(requestId === undefined ? {} : { requestId }),
      });
      return this.plans.answer(transaction, scene);
    });
  }

  /** `POST /api/plans/journals/:journalId/carried/:itemId/place`: a tray item at a row. */
  place(
    access: Access,
    journalId: string,
    itemId: string,
    input: PlanPlace,
    requestId: string | undefined,
  ): Promise<Plan> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const found = await this.writeOf(transaction, access, journalId, input.quarterId, itemId);
      const { scene, rows, at } = found;
      if (at.kind !== 'tray') throw new ApiException('plan_item_covered', 409);
      const planId = await this.planOf(transaction, scene);
      const row = await this.rowOf(transaction, scene, rows, input.position, input.lessonId);
      const places = await this.plans.placesOf(transaction, planId, journalId);
      const taken = new Map([...places].map(([id, position]) => [position, id]));
      // The later items move one step, up to the first empty row (`edge`: "The shift stops at the
      // first empty row"); a held row that holds an item keeps it.
      const shifts = new Map<string, number>();
      for (let position = input.position; taken.has(position); position += 1) {
        const id = taken.get(position);
        if (id === undefined) break;
        if ((rows[position - 1]?.started ?? false) === true) {
          throw new ApiException('plan_row_taken', 409);
        }
        shifts.set(id, position + 1);
      }
      // Every row the place touches: its own and those of the items it moves (code review, should-fix 2).
      const touched = [...shifts.values()].flatMap((position) => {
        const moved = rows[position - 1];
        return [
          moved === undefined ? { lessonId: null, date: null, started: false } : gateRowOf(moved),
        ];
      });
      const pass = await this.plans.gate(transaction, scene, planId, [
        {
          journalId,
          rows: [gateRowOf(row), ...touched],
          op: shifts.size > 0 ? 'move' : 'create',
        },
      ]);
      await movePlaces(transaction, planId, journalId, shifts);
      await transaction
        .deleteFrom('lesson_plan_tray')
        .where('journal_id', '=', journalId)
        .where('quarter_id', '=', scene.quarter.id)
        .where('item_id', '=', itemId)
        .execute();
      await transaction
        .insertInto('lesson_plan_places')
        .values({
          branch_id: scene.branchId,
          plan_id: planId,
          journal_id: journalId,
          item_id: itemId,
          position: input.position,
        })
        .execute();
      const startedIn = row.started ? [journalId] : [];
      const works = (await worksOf(transaction, [itemId])).get(itemId);
      await this.plans.markEditedAfterLesson(transaction, pass, itemId, startedIn);
      await this.plans.openColumns(
        transaction,
        scene.branchId,
        pass,
        [...(works?.classworks ?? []), ...(works?.homeworks ?? [])].map((work) => work.id),
        startedIn,
      );
      await this.plans.takeOverWorks(transaction, scene, access, itemId, startedIn, requestId);
      await this.audit.record(transaction, {
        branchId: scene.branchId,
        actorId: access.accountId,
        assignmentId: scene.assignmentId,
        action: 'plan.carried_placed',
        record: { type: 'lesson_plan', id: planId },
        newValue: {
          journalId,
          quarterId: scene.quarter.id,
          itemId,
          position: input.position,
          date: row.date,
          moved: Object.fromEntries(shifts),
        },
        ...(gateDetail(pass) === null ? {} : { details: gateDetail(pass) }),
        ...(requestId === undefined ? {} : { requestId }),
      });
      return this.plans.answer(transaction, scene);
    });
  }

  // -------------------------------------------------------------------------

  /**
   * The next quarter of the request's quarter, held `for key share` before any journal lock. An
   * unknown quarter is answered by the scene (404) afterwards.
   */
  private async nextOf(
    transaction: Transaction,
    access: Access,
    quarterId: string,
  ): Promise<string | null> {
    const quarter = await transaction
      .selectFrom('quarters')
      .select('id')
      .where('id', '=', quarterId)
      .where('branch_id', '=', branchOf(access))
      .executeTakeFirst();
    if (quarter === undefined) return null;
    const next = await nextQuarterOf(transaction, quarterId);
    if (next !== null) await holdQuarter(transaction, next);
    return next;
  }

  /**
   * The scene of a write by the owner (every journal of a shared plan owned), its plan locked,
   * the 404 of the item (an item of another branch, or of neither this plan nor this journal's
   * tray), then whether it is still not covered in the journal.
   */
  private async writeOf(
    transaction: Transaction,
    access: Access,
    journalId: string,
    quarterId: string,
    itemId: string,
    alsoQuarters: readonly (string | null)[] = [],
  ): Promise<{
    scene: WriteScene;
    members: string[];
    rows: PlanRowLesson[];
    at: NotCoveredAt;
  }> {
    const branchId = branchOf(access);
    const scene = await this.plans.writeSceneOf(
      transaction,
      access,
      branchId,
      journalId,
      quarterId,
    );
    const members = await this.plans.lockPlanOf(transaction, journalId, scene.quarter.id);
    for (const next of alsoQuarters) {
      if (next !== null) await this.plans.lockPlanOf(transaction, journalId, next);
    }
    for (const other of members) {
      if (other !== journalId) {
        await this.plans.writeSceneOf(transaction, access, branchId, other, quarterId);
      }
    }
    const rows = await this.plans.rowsOfJournal(transaction, scene, journalId);
    const at = await this.notCoveredOf(transaction, scene, rows, itemId);
    return { scene, members, rows, at };
  }

  /** 404 for an item of another branch or of no plan of the journal; 409 when it is covered. */
  private async notCoveredOf(
    transaction: Transaction,
    scene: Scene,
    rows: readonly PlanRowLesson[],
    itemId: string,
  ): Promise<NotCoveredAt> {
    const item = await transaction
      .selectFrom('lesson_plan_items')
      .select(['id', 'plan_id'])
      .where('id', '=', itemId)
      .where('branch_id', '=', scene.branchId)
      .executeTakeFirst();
    if (item === undefined) throw notFound();
    const planId = await planIdOf(transaction, scene.journal.id, scene.quarter.id);
    if (item.plan_id !== planId) throw notFound();
    const at = await notCoveredAt(
      transaction,
      scene.journal.id,
      scene.quarter.id,
      itemId,
      rows.length,
    );
    if (at === null) throw new ApiException('plan_item_covered', 409);
    return at;
  }

  private async planOf(transaction: Transaction, scene: Scene): Promise<string> {
    const planId = await planIdOf(transaction, scene.journal.id, scene.quarter.id);
    if (planId === null) throw notFound();
    return planId;
  }

  /** The row named by position and lesson, as the item create checks it (task 7.1b, decision 12). */
  private async rowOf(
    transaction: Transaction,
    scene: Scene,
    rows: readonly PlanRowLesson[],
    position: number,
    lessonId: string,
  ): Promise<PlanRowLesson> {
    const lesson = await transaction
      .selectFrom('lessons')
      .select('id')
      .where('id', '=', lessonId)
      .where('branch_id', '=', scene.branchId)
      .executeTakeFirst();
    if (lesson === undefined) throw notFound();
    const row = rows[position - 1];
    if (row === undefined) throw new ApiException('plan_row_unknown', 409);
    if (row.lessonId !== lessonId) throw new ApiException('plan_row_moved', 409);
    return row;
  }
}

/** The writer of the rows and entries. */
function actorOf(
  access: Access,
  scene: WriteScene | Scene,
  requestId: string | undefined,
  assignmentId?: string,
): OutcomeActor {
  return {
    branchId: scene.branchId,
    accountId: access.accountId,
    assignmentId:
      assignmentId ?? ('assignmentId' in scene ? scene.assignmentId : access.assignmentId),
    ...(requestId === undefined ? {} : { requestId }),
  };
}

const gateRowOf = (row: PlanRowLesson) => ({
  lessonId: row.lessonId,
  date: row.date,
  started: row.started,
});

/** An item past the last row leaving the queue: a move after every row (`periodCovers`). */
const pastTarget = (journalId: string): GateTarget => ({
  journalId,
  rows: [{ lessonId: null, date: null, started: false }],
  op: 'move',
});
