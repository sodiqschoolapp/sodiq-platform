import { Injectable } from '@nestjs/common';
import {
  planMasterCompareSchema,
  planParallelSchema,
  type Plan,
  type PlanMasterCompare,
  type PlanMasterTake,
  type PlanParallel,
  type PlanParallelQuery,
  type Role,
} from '@sodiq/shared';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { journalRows } from '../journal/journal-grid.query.js';
import { notFound } from '../setup/setup-refusals.js';
import type { GateTarget } from './plan-gate.js';
import { takePlaces, type CompareRow } from './plan-master-compare.js';
import { compareRowsOf, masterItemsOf, masterRowOf, planMasterOf } from './plan-masters-read.js';
import {
  clockOf,
  datedQuarters,
  movePlaces,
  planIdOf,
  planItems,
  planRows,
  type PlanRowLesson,
} from './plan-read.js';
import { planReaderOf } from './plan-scope.js';
import { insertFromMaster, takeFromMaster } from './plan-separate.js';
import { PlanSharing } from './plan-sharing.service.js';
import { gateAudit, PlansService, type Scene } from './plans.service.js';

/**
 * A plan and its master after the copy (task 7.3, pull request #216): the
 * "master updated" comparison, taking the changes or keeping the plan as it
 * is (decisions 5 and 6; `09`: "Taking the changes is free inside the window
 * and needs an edit request after it"), and the parallel classes of a grade
 * (decision 13; `09`, "Parallel classes").
 */

const WHOLE_ROLES: readonly Role[] = ['super_admin', 'principal', 'academic_vice_principal'];

const SUBJECT_ROLES: readonly Role[] = ['head_teacher', 'senior_head_teacher'];

@Injectable()
export class PlanMasterTakes {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly plans: PlansService,
    private readonly sharing: PlanSharing,
  ) {}

  /** The comparison of the plan of a journal with its master, for a reader of the plan. */
  compare(access: Access, journalId: string, quarterId: string): Promise<PlanMasterCompare> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.plans.sceneOf(transaction, access, branchId, journalId, quarterId);
      if (!scene.reach.read) throw new ApiException('plan_scope', 403);
      const planId = await planIdOf(transaction, journalId, scene.quarter.id);
      const link = planId === null ? null : await planMasterOf(transaction, planId);
      if (planId === null || link === null) throw new ApiException('plan_master_none', 409);
      const master = await masterRowOf(transaction, link.masterId);
      const rows = await compareRowsOf(transaction, scene, planId, master.id, link.revision);
      return planMasterCompareSchema.parse({
        master: {
          id: master.id,
          name: master.name,
          scope: master.branch_id === null ? 'all' : 'branch',
          revision: master.revision,
          archived: master.archived_at !== null,
        },
        rows,
      });
    });
  }

  /** Takes every row of the comparison that can be taken (decision 6). */
  take(
    access: Access,
    journalId: string,
    input: PlanMasterTake,
    requestId: string | undefined,
  ): Promise<Plan> {
    return this.write(access, journalId, input, requestId, true);
  }

  /** Keeps the plan as it is: the mark goes, nothing changes (decision 6). */
  keep(
    access: Access,
    journalId: string,
    input: PlanMasterTake,
    requestId: string | undefined,
  ): Promise<Plan> {
    return this.write(access, journalId, input, requestId, false);
  }

  private write(
    access: Access,
    journalId: string,
    input: PlanMasterTake,
    requestId: string | undefined,
    taking: boolean,
  ): Promise<Plan> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.plans.writeSceneOf(
        transaction,
        access,
        branchId,
        journalId,
        input.quarterId,
      );
      const members = await this.plans.lockPlanOf(transaction, journalId, scene.quarter.id);
      await this.sharing.ownAll(transaction, access, scene, members);
      const planId = await planIdOf(transaction, journalId, scene.quarter.id);
      const link = planId === null ? null : await planMasterOf(transaction, planId);
      if (planId === null || link === null) throw new ApiException('plan_master_none', 409);
      // Read `for share` before its items (review should-fix 7).
      const master = await masterRowOf(transaction, link.masterId, 'share');
      if (master.revision !== input.revision) throw new ApiException('plan_master_stale', 409);
      const rows = (
        await compareRowsOf(transaction, scene, planId, master.id, link.revision)
      ).filter((row) => !row.held);
      if (rows.length === 0) return this.plans.answer(transaction, scene);
      const layouts = new Map<string, { rows: PlanRowLesson[]; places: Map<string, number> }>();
      for (const id of members) {
        layouts.set(id, {
          rows: await this.plans.rowsOfJournal(transaction, scene, id),
          places: await this.plans.placesOf(transaction, planId, id),
        });
      }
      const pass = await this.plans.gate(
        transaction,
        scene,
        planId,
        targetsOf(rows, layouts, await this.predecessors(transaction, master.id, planId, rows)),
      );
      if (taking) {
        await this.apply(transaction, scene, planId, master.id, rows, layouts);
      }
      await transaction
        .updateTable('lesson_plans')
        .set({ master_revision: master.revision })
        .where('id', '=', planId)
        .execute();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: scene.assignmentId,
        action: taking ? 'plan.master_taken' : 'plan.master_kept',
        record: { type: 'lesson_plan', id: planId },
        oldValue: { masterRevision: link.revision },
        newValue: {
          journalId,
          quarterId: scene.quarter.id,
          masterId: master.id,
          masterRevision: master.revision,
          changed: rows.filter((row) => row.change === 'changed').map((row) => row.masterItemId),
          added: rows.filter((row) => row.change === 'added').map((row) => row.masterItemId),
          removed: rows.filter((row) => row.change === 'removed').map((row) => row.masterItemId),
        },
        ...gateAudit(pass),
        ...(requestId === undefined ? {} : { requestId }),
      });
      return this.plans.answer(transaction, scene);
    });
  }

  /**
   * For each added master item, the plan item of the nearest earlier master
   * item that the plan holds and keeps (or one added before it), else `null`.
   */
  private async predecessors(
    transaction: Transaction,
    masterId: string,
    planId: string,
    rows: readonly CompareRow[],
  ): Promise<Map<string, string | null>> {
    const live = await masterItemsOf(transaction, masterId);
    const held = await transaction
      .selectFrom('lesson_plan_items')
      .select(['id', 'master_item_id'])
      .where('plan_id', '=', planId)
      .where('cleared_at', 'is', null)
      .where('master_item_id', 'is not', null)
      .orderBy('id')
      .execute();
    const removed = new Set(
      rows.filter((row) => row.change === 'removed').map((row) => row.plan?.itemId ?? ''),
    );
    const planItemOf = new Map<string, string>();
    for (const item of held) {
      if (item.master_item_id !== null && !removed.has(item.id)) {
        planItemOf.set(item.master_item_id, item.id);
      }
    }
    const added = new Set(
      rows.filter((row) => row.change === 'added').map((row) => row.masterItemId),
    );
    const found = new Map<string, string | null>();
    let last: string | null = null;
    for (const item of live) {
      if (added.has(item.id)) {
        found.set(item.id, last);
        // The added item stands for its master item for the next one.
        last = `new:${item.id}`;
        continue;
      }
      last = planItemOf.get(item.id) ?? last;
    }
    return found;
  }

  /** The writes of a take: content, removed items, added items, the places of each journal. */
  private async apply(
    transaction: Transaction,
    scene: Scene,
    planId: string,
    masterId: string,
    rows: readonly CompareRow[],
    layouts: ReadonlyMap<string, { rows: PlanRowLesson[]; places: Map<string, number> }>,
  ): Promise<void> {
    const live = new Map(
      (await masterItemsOf(transaction, masterId)).map((item) => [item.id, item]),
    );
    for (const row of rows) {
      const source = live.get(row.masterItemId);
      if (row.change === 'changed' && row.plan !== null && source !== undefined) {
        await takeFromMaster(transaction, scene.branchId, row.plan.itemId, source);
      }
    }
    const removed = rows
      .filter((row) => row.change === 'removed' && row.plan !== null)
      .map((row) => row.plan?.itemId ?? '');
    const before = await this.predecessors(transaction, masterId, planId, rows);
    const made = new Map<string, string>();
    for (const row of rows) {
      const source = live.get(row.masterItemId);
      if (row.change !== 'added' || source === undefined) continue;
      made.set(
        row.masterItemId,
        await insertFromMaster(transaction, scene.branchId, planId, source),
      );
    }
    const added = [...made].map(([masterItemId, itemId]) => {
      const after = before.get(masterItemId) ?? null;
      return {
        itemId,
        after: after?.startsWith('new:') === true ? (made.get(after.slice(4)) ?? null) : after,
      };
    });
    if (removed.length > 0) {
      await transaction
        .deleteFrom('lesson_plan_places')
        .where('plan_id', '=', planId)
        .where('item_id', 'in', removed)
        .execute();
      await transaction
        .updateTable('lesson_plan_items')
        .set({ cleared_at: scene.now })
        .where('id', 'in', removed)
        .execute();
    }
    for (const [journalId, layout] of layouts) {
      const started = layout.rows.filter((row) => row.started).length;
      const places = takePlaces({ started, places: layout.places }, removed, added);
      const moves = new Map<string, number>();
      for (const [itemId, position] of places) {
        if (layout.places.has(itemId) && layout.places.get(itemId) !== position) {
          moves.set(itemId, position);
        }
      }
      await movePlaces(transaction, planId, journalId, moves);
      const fresh = added.filter((one) => places.has(one.itemId));
      if (fresh.length > 0) {
        await transaction
          .insertInto('lesson_plan_places')
          .values(
            fresh.map((one) => ({
              branch_id: scene.branchId,
              plan_id: planId,
              journal_id: journalId,
              item_id: one.itemId,
              position: places.get(one.itemId) ?? 0,
            })),
          )
          .execute();
      }
    }
  }

  /** The classes and groups of a grade side by side with the item each has reached (decision 13). */
  parallel(access: Access, query: PlanParallelQuery): Promise<PlanParallel> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const quarterRow = await transaction
        .selectFrom('quarters')
        .select(['id', 'academic_year_id'])
        .where('id', '=', query.quarterId)
        .where('branch_id', '=', branchId)
        .executeTakeFirst();
      if (quarterRow === undefined) throw notFound();
      const subject = await transaction
        .selectFrom('subjects')
        .select('id')
        .where('id', '=', query.subjectId)
        .executeTakeFirst();
      if (subject === undefined) throw notFound();
      const reader = await planReaderOf(transaction, access);
      const lowered = query.subjectId.toLowerCase();
      const reads = reader.access.permitting.some(
        (assignment) =>
          WHOLE_ROLES.includes(assignment.role) ||
          (SUBJECT_ROLES.includes(assignment.role) && assignment.subjectIds.includes(lowered)),
      );
      if (!reads) throw new ApiException('plan_scope', 403);
      const quarter = (await datedQuarters(transaction, quarterRow.academic_year_id)).find(
        (one) => one.id === quarterRow.id,
      );
      if (quarter === undefined) throw new ApiException('journal_no_quarter', 409);
      const grade = Number(query.grade);
      const { timeZone, now } = await clockOf(transaction, branchId);
      const journals = (
        await journalRows(transaction, branchId, { yearId: quarterRow.academic_year_id })
      ).filter(
        (journal) =>
          journal.subjectId === query.subjectId &&
          !journal.subject.attendanceOnly &&
          journal.grades.includes(grade),
      );
      const units = [];
      for (const journal of journals) {
        const rows = await planRows(transaction, branchId, journal, quarter, timeZone, now);
        if (rows.length === 0) continue;
        const planId = await planIdOf(transaction, journal.id, quarter.id);
        const items = planId === null ? [] : await planItems(transaction, planId, journal.id);
        const topicAt = (number: number) =>
          items.find((item) => item.position === number)?.topic ?? null;
        const started = rows.filter((row) => row.started);
        const reached = started.at(-1);
        const next = rows.find((row) => !row.started);
        units.push({
          journalId: journal.id,
          unit: {
            kind: journal.classId === null ? 'group' : 'class',
            id: journal.classId ?? journal.groupId ?? '',
            name: journal.unitName,
          },
          grades: [...journal.grades],
          rows: rows.length,
          reached:
            reached === undefined
              ? null
              : { number: reached.number, date: reached.date, topic: topicAt(reached.number) },
          next:
            next === undefined
              ? null
              : { number: next.number, date: next.date, topic: topicAt(next.number) },
        });
      }
      units.sort(
        (a, b) =>
          Number(a.unit.kind === 'group') - Number(b.unit.kind === 'group') ||
          a.unit.name.localeCompare(b.unit.name, 'en'),
      );
      return planParallelSchema.parse({ units });
    });
  }
}

/**
 * The rows a take touches in each journal (decision 6): Text on the row of
 * each changed item, and Re-plan from the first row an added or removed item
 * moves (`edge`: "'Re-plan' runs from a chosen lesson not yet held").
 */
function targetsOf(
  rows: readonly CompareRow[],
  layouts: ReadonlyMap<string, { rows: PlanRowLesson[]; places: Map<string, number> }>,
  before: ReadonlyMap<string, string | null>,
): GateTarget[] {
  const targets: GateTarget[] = [];
  const rowAt = (layout: { rows: PlanRowLesson[] }, position: number) => {
    const row = layout.rows[position - 1];
    return row === undefined
      ? { lessonId: null, date: null, started: false }
      : { lessonId: row.lessonId, date: row.date, started: row.started };
  };
  for (const [journalId, layout] of layouts) {
    const started = layout.rows.filter((row) => row.started).length;
    const wording = rows
      .filter((row) => row.change === 'changed' && row.plan !== null)
      .map((row) => rowAt(layout, layout.places.get(row.plan?.itemId ?? '') ?? 0));
    if (wording.length > 0) targets.push({ journalId, rows: wording, op: 'wording' });
    const moving: number[] = [];
    for (const row of rows) {
      if (row.change === 'removed') {
        moving.push(layout.places.get(row.plan?.itemId ?? '') ?? started + 1);
      }
      if (row.change === 'added') {
        const after = before.get(row.masterItemId) ?? null;
        const at =
          after === null || after.startsWith('new:') ? undefined : layout.places.get(after);
        moving.push(at === undefined || at <= started ? started + 1 : at + 1);
      }
    }
    if (moving.length > 0) {
      targets.push({ journalId, rows: [rowAt(layout, Math.min(...moving))], op: 'move' });
    }
  }
  return targets;
}
