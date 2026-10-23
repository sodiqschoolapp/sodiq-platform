import { Injectable } from '@nestjs/common';
import type { Plan, PlanCopy, PlanSeparate, PlanShare } from '@sodiq/shared';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { journalRows, type JournalRow } from '../journal/journal-grid.query.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { ownerFactsOf, ownerOn } from '../timetable/journal-owners.js';
import { lockJournals, planIdOf, planItems, planJournalIds, planRows } from './plan-read.js';
import { copyItems, insertFromMaster, separateJournal, unitKeysOf } from './plan-separate.js';
import {
  masterItemsOf,
  masterRowOf,
  planMasterOf,
  readsMaster,
  startYearOf,
} from './plan-masters-read.js';
import type { GateTarget } from './plan-gate.js';
import { gateAudit, PlansService, type Scene } from './plans.service.js';

/**
 * Shared plans and copies (task 7.1c, pull request #214; `09`, What a plan
 * contains: "A teacher who teaches the same subject to several classes of
 * one grade ... can share one plan between them, if the classes have the
 * same language of instruction. ... A shared plan can be separated later."
 * "A plan can be copied from another class, from another teacher of the
 * same subject and grade, or from last year."). Only the owner of every
 * journal of the plan writes (decision 14).
 */

type WriteScene = Scene & { readonly assignmentId: string };

@Injectable()
export class PlanSharing {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly plans: PlansService,
  ) {}

  /** The scenes of every journal of a plan: the writer owns each one (decision 14). */
  async ownAll(
    transaction: Transaction,
    access: Access,
    scene: WriteScene,
    journalIds: readonly string[],
  ): Promise<void> {
    for (const journalId of journalIds) {
      if (journalId === scene.journal.id) continue;
      await this.plans.writeSceneOf(
        transaction,
        access,
        scene.branchId,
        journalId,
        scene.quarter.id,
      );
    }
  }

  /** The rows of a journal in the scene's quarter whose start has passed. */
  async startedOf(
    transaction: Transaction,
    scene: Scene,
    journal: JournalRow,
  ): Promise<{ started: number; rows: number }> {
    const rows = await planRows(
      transaction,
      scene.branchId,
      journal,
      scene.quarter,
      scene.timeZone,
      scene.now,
    );
    return { started: rows.filter((row) => row.started).length, rows: rows.length };
  }

  /** Every row not started of the journal in the quarter is owned by the reader. */
  private async ownsTheRest(
    transaction: Transaction,
    scene: Scene,
    journal: JournalRow,
  ): Promise<boolean> {
    const rows = await planRows(
      transaction,
      scene.branchId,
      journal,
      scene.quarter,
      scene.timeZone,
      scene.now,
    );
    const facts = await ownerFactsOf(transaction, scene.branchId, [
      {
        id: journal.id,
        academic_year_id: journal.academicYearId,
        class_id: journal.classId,
        group_id: journal.groupId,
        subject_id: journal.subjectId,
      },
    ]);
    return rows
      .filter((row) => !row.started)
      .every((row) => {
        const owner = ownerOn(
          facts.runs.get(journal.id) ?? [],
          facts.periods.get(journal.id) ?? [],
          facts.out,
          row.date,
        );
        return owner !== null && owner.kind !== 'none' && owner.staffId === scene.reader.staffId;
      });
  }

  /** Decision 3: one kind, the same grades and one language of instruction. */
  private async unitCheck(
    transaction: Transaction,
    own: JournalRow,
    joining: JournalRow,
  ): Promise<void> {
    const keys = await unitKeysOf(transaction, [own, joining]);
    const [ownKind, ownGrades, ownLanguage] = (keys.get(own.id) ?? '').split('|');
    const [kind, grades, language] = (keys.get(joining.id) ?? '').split('|');
    if (kind !== ownKind) throw new ApiException('plan_share_kind', 409);
    if (grades !== ownGrades) throw new ApiException('plan_share_grade', 409);
    if (language !== ownLanguage) throw new ApiException('plan_share_language', 409);
  }

  /**
   * One more journal joins the plan of the path's journal (decisions 3 and
   * 4). Correction 2 of #214: the classes (or groups) of every journal
   * involved are taken `for share` in the order of the id, in a statement of
   * their own, before the journals, as a class edit takes them.
   */
  share(
    access: Access,
    journalId: string,
    input: PlanShare,
    requestId: string | undefined,
  ): Promise<Plan> {
    const branchId = branchOf(access);
    // No refusal of the deferred share check is mapped: the route checks kind,
    // grades and language after taking the classes or groups `for share`
    // (correction 2), so no change of them reaches the commit in between
    // (code review, must-fix 2d).
    return refusingConstraints(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const scene = await this.plans.writeSceneOf(
          transaction,
          access,
          branchId,
          journalId,
          input.quarterId,
        );
        const [joining] = await journalRows(transaction, branchId, {
          journalId: input.journalId,
        });
        if (joining === undefined) throw notFound();
        if (joining.id === journalId) throw new ApiException('plan_share_same', 409);
        // A state of the joining journal is told only to a reader of it
        // (permission review of the code, must-fix 1); a journal of another
        // year has no such quarter and is 404 there.
        const joiningScene = await this.plans.sceneOf(
          transaction,
          access,
          branchId,
          joining.id,
          input.quarterId,
        );
        if (!joiningScene.reach.read) throw new ApiException('plan_scope', 403);
        if (joining.subjectId !== scene.journal.subjectId) {
          throw new ApiException('plan_share_subject', 409);
        }
        await this.unitCheck(transaction, scene.journal, joining);
        await this.plans.writeSceneOf(transaction, access, branchId, joining.id, input.quarterId);
        const planNow = await planIdOf(transaction, journalId, scene.quarter.id);
        const members = planNow === null ? [journalId] : await planJournalIds(transaction, planNow);
        const involved = [
          ...(await journalRows(transaction, branchId, { yearId: joining.academicYearId })),
        ].filter((journal) => members.includes(journal.id) || journal.id === joining.id);
        const classIds = involved.flatMap((journal) =>
          journal.classId === null ? [] : [journal.classId],
        );
        const groupIds = involved.flatMap((journal) =>
          journal.groupId === null ? [] : [journal.groupId],
        );
        if (classIds.length > 0) {
          await transaction
            .selectFrom('classes')
            .select('id')
            .where('id', 'in', classIds)
            .orderBy('id')
            .forShare()
            .execute();
        }
        if (groupIds.length > 0) {
          await transaction
            .selectFrom('groups')
            .select('id')
            .where('id', 'in', groupIds)
            .orderBy('id')
            .forShare()
            .execute();
        }
        // Then the journals, in the order of the id; the plan's links read
        // again after the lock until none is missing.
        await lockJournals(transaction, [...new Set([...members, joining.id])].sort());
        const all = [
          ...new Set([
            ...(await this.plans.lockPlanOf(transaction, journalId, scene.quarter.id)),
            ...(await this.plans.lockPlanOf(transaction, joining.id, scene.quarter.id)),
          ]),
        ];
        const planId = await planIdOf(transaction, journalId, scene.quarter.id);
        const theirs = await planIdOf(transaction, joining.id, scene.quarter.id);
        if (planId !== null && planId === theirs) throw new ApiException('plan_share_same', 409);
        const shared = planId === null ? [journalId] : await planJournalIds(transaction, planId);
        await this.ownAll(transaction, access, scene, shared);
        // Task 7.2: `edge`, "Joining is allowed only inside the window".
        await this.plans.gate(transaction, scene, planId ?? '', [], true);
        // Read after the locks (`database.md`): kind, grades and language.
        const rows = (
          await journalRows(transaction, branchId, { yearId: joining.academicYearId })
        ).filter((journal) => shared.includes(journal.id) || journal.id === joining.id);
        const joined = rows.find((journal) => journal.id === joining.id) ?? joining;
        for (const member of rows) {
          if (member.id !== joining.id) await this.unitCheck(transaction, member, joined);
        }
        // Every lesson not yet held of each journal is the reader's (code
        // review, should-fix 5): otherwise the follow would part it at once
        // and the answer would show a plan shared that is not.
        for (const member of rows) {
          if (!(await this.ownsTheRest(transaction, scene, member))) {
            throw new ApiException('plan_share_owner', 409);
          }
        }
        if (theirs !== null && (await this.plans.hasItems(transaction, theirs))) {
          throw new ApiException('plan_share_has_items', 409);
        }
        const target = await this.plans.planFor(transaction, access, scene, requestId);
        // Decision 4: from the joining journal's first row not started, in
        // the order of the path's journal; its held rows stay empty.
        const { started } = await this.startedOf(transaction, scene, joining);
        const page = await this.plans.placesOf(transaction, target, journalId);
        if (theirs === null) {
          await transaction
            .insertInto('lesson_plan_journals')
            .values({
              branch_id: branchId,
              plan_id: target,
              journal_id: joining.id,
              quarter_id: scene.quarter.id,
            })
            .execute();
        } else {
          // Decision 18: its queue is laid afresh; a prepared request goes with the link.
          await transaction
            .deleteFrom('lesson_plan_rows')
            .where('plan_id', '=', theirs)
            .where('journal_id', '=', joining.id)
            .execute();
          await transaction
            .deleteFrom('lesson_plan_absorbed')
            .where('plan_id', '=', theirs)
            .where('journal_id', '=', joining.id)
            .execute();
          await transaction
            .updateTable('lesson_plan_journals')
            .set({ plan_id: target, laid_at: null })
            .where('plan_id', '=', theirs)
            .where('journal_id', '=', joining.id)
            .execute();
        }
        if (page.size > 0) {
          await transaction
            .insertInto('lesson_plan_places')
            .values(
              [...page].map(([itemId, position]) => ({
                branch_id: branchId,
                plan_id: target,
                journal_id: joining.id,
                item_id: itemId,
                position: position + started,
              })),
            )
            .execute();
        }
        // The unit the plan is shared under (code review, must-fix 1).
        const unit = (await unitKeysOf(transaction, [scene.journal])).get(journalId) ?? null;
        await transaction
          .updateTable('lesson_plans')
          .set({ shared_unit: unit })
          .where('id', '=', target)
          .execute();
        // The follow writes its snapshot before the commit (task 7.1b, decision 7).
        await transaction
          .insertInto('lesson_plan_follow_marks')
          .values({ branch_id: branchId, journal_id: joining.id })
          .execute();
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: scene.assignmentId,
          action: 'plan.shared',
          record: { type: 'lesson_plan', id: target },
          newValue: {
            journalId: joining.id,
            quarterId: scene.quarter.id,
            fromPlanId: theirs,
            items: page.size,
            journals: [...new Set([...all, joining.id])].sort(),
          },
          ...(requestId === undefined ? {} : { requestId }),
        });
        return this.plans.answer(transaction, scene);
      }),
    );
  }

  /** The path's journal leaves its shared plan with a copy of the items (`09`: "A shared plan can be separated later"). */
  separate(
    access: Access,
    journalId: string,
    input: PlanSeparate,
    requestId: string | undefined,
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
      const planId = await planIdOf(transaction, journalId, scene.quarter.id);
      if (planId === null || members.length < 2) throw new ApiException('plan_not_shared', 409);
      await this.ownAll(transaction, access, scene, members);
      const separated = await separateJournal(transaction, branchId, planId, journalId);
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: scene.assignmentId,
        action: 'plan.separated',
        record: { type: 'lesson_plan', id: planId },
        newValue: {
          journalId,
          quarterId: scene.quarter.id,
          planId: separated.planId,
          items: separated.items,
          cause: 'by_owner',
        },
        ...(requestId === undefined ? {} : { requestId }),
      });
      return this.plans.answer(transaction, scene);
    });
  }

  /**
   * The items of another plan copied into an empty plan (decisions 9 to 11;
   * review correction of decision 9: items on started rows stay, the copy is
   * laid from the first row not started of each journal).
   */
  copy(access: Access, journalId: string, input: PlanCopy, requestId: string | undefined) {
    if ('masterId' in input.source) {
      return this.copyMaster(access, journalId, input.quarterId, input.source.masterId, requestId);
    }
    const source = input.source;
    const part = 'part' in input ? input.part : 'all';
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction): Promise<Plan> => {
      const scene = await this.plans.writeSceneOf(
        transaction,
        access,
        branchId,
        journalId,
        input.quarterId,
      );
      const sourceScene = await this.plans.sceneOf(
        transaction,
        access,
        branchId,
        source.journalId,
        source.quarterId,
      );
      if (!sourceScene.reach.read) throw new ApiException('plan_scope', 403);
      if (sourceScene.journal.subjectId !== scene.journal.subjectId) {
        throw new ApiException('plan_copy_subject', 409);
      }
      if (!sourceScene.journal.grades.some((grade) => scene.journal.grades.includes(grade))) {
        throw new ApiException('plan_copy_grade', 409);
      }
      const members = await this.plans.lockPlanOf(transaction, journalId, scene.quarter.id);
      await this.ownAll(transaction, access, scene, members);
      const sourcePlan = await planIdOf(
        transaction,
        sourceScene.journal.id,
        sourceScene.quarter.id,
      );
      const planNow = await planIdOf(transaction, journalId, scene.quarter.id);
      if (sourcePlan !== null && sourcePlan === planNow) {
        throw new ApiException('plan_copy_same', 409);
      }
      const journals = new Map<string, JournalRow>();
      for (const id of members) {
        const [journal] = await journalRows(transaction, branchId, { journalId: id });
        if (journal !== undefined) journals.set(id, journal);
      }
      const starts = new Map<string, number>();
      for (const [id, journal] of journals) {
        const { started } = await this.startedOf(transaction, scene, journal);
        starts.set(id, started);
        if (planNow === null) continue;
        // Decision 9 as changed on #214: no item on a row not started, none not covered.
        const places = await this.plans.placesOf(transaction, planNow, id);
        if ([...places.values()].some((position) => position > started)) {
          throw new ApiException('plan_not_empty', 409);
        }
      }
      // Task 7.2: a copy lays items from the first row not started: the window,
      // or a Re-plan period over those rows in every journal.
      const targets: GateTarget[] = [];
      for (const id of members) {
        const rows = await this.plans.rowsOfJournal(transaction, scene, id);
        const ahead = rows.filter((row) => !row.started);
        targets.push({
          journalId: id,
          rows:
            ahead.length === 0
              ? [{ lessonId: null, date: null, started: false }]
              : ahead.map((row) => ({ lessonId: row.lessonId, date: row.date, started: false })),
          op: 'move',
        });
      }
      const pass = await this.plans.gate(transaction, scene, planNow ?? '', targets);
      let sourceItems =
        sourcePlan === null ? [] : await planItems(transaction, sourcePlan, sourceScene.journal.id);
      if (part === 'remaining') {
        const { started } = await this.startedOf(transaction, sourceScene, sourceScene.journal);
        sourceItems = sourceItems.filter((item) => item.position > started);
      }
      const target = await this.plans.planFor(transaction, access, scene, requestId);
      // Task 7.3, decision 11: the master link goes with the copy when the
      // master fits the target (one of its grades, its language, its year and quarter);
      // else it is dropped.
      const link = sourcePlan === null ? null : await planMasterOf(transaction, sourcePlan);
      let keepMaster = false;
      if (link !== null) {
        const master = await masterRowOf(transaction, link.masterId);
        const keys = await unitKeysOf(transaction, [scene.journal]);
        // Spec review of the code, should-fix 6: also the year and the quarter the
        // master is for (decision 4), so a plan of another quarter is not linked to it.
        keepMaster =
          scene.journal.grades.includes(master.grade) &&
          (keys.get(scene.journal.id) ?? '').split('|')[2] === master.language &&
          master.start_year === (await startYearOf(transaction, scene.journal.academicYearId)) &&
          master.quarter === scene.quarter.number;
      }
      await transaction
        .updateTable('lesson_plans')
        .set({
          master_id: keepMaster ? (link?.masterId ?? null) : null,
          master_revision: keepMaster ? (link?.revision ?? null) : null,
        })
        .where('id', '=', target)
        .execute();
      const made = await copyItems(
        transaction,
        branchId,
        target,
        sourceItems.map((item) => item.id),
        keepMaster,
      );
      const copied = sourceItems.flatMap((item) => {
        const id = made.get(item.id);
        return id === undefined ? [] : [id];
      });
      for (const id of members) {
        if (copied.length === 0) break;
        const started = starts.get(id) ?? 0;
        await transaction
          .insertInto('lesson_plan_places')
          .values(
            copied.map((itemId, index) => ({
              branch_id: branchId,
              plan_id: target,
              journal_id: id,
              item_id: itemId,
              position: started + index + 1,
            })),
          )
          .execute();
      }
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: scene.assignmentId,
        action: 'plan.copied',
        record: { type: 'lesson_plan', id: target },
        newValue: {
          journalId,
          quarterId: scene.quarter.id,
          sourceJournalId: sourceScene.journal.id,
          sourceQuarterId: sourceScene.quarter.id,
          sourcePlanId: sourcePlan,
          part,
          items: copied.length,
          masterId: keepMaster ? (link?.masterId ?? null) : null,
        },
        ...gateAudit(pass),
        ...(requestId === undefined ? {} : { requestId }),
      });
      return this.plans.answer(transaction, scene);
    });
  }

  /**
   * Task 7.3: an empty plan filled as a copy of a master (`09`: "A teacher
   * creates a plan as a copy of the master. Its items fill the rows of the
   * class in order. ... If it has fewer, the items left over are listed for
   * the teacher to merge during the window."; decision 10): laid from the
   * first row not started of each journal, items past the last row not
   * covered. The master is read `for share` before its items, so the
   * revision stored is the one whose items were copied (review should-fix 7).
   */
  private copyMaster(
    access: Access,
    journalId: string,
    quarterId: string,
    masterId: string,
    requestId: string | undefined,
  ): Promise<Plan> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction): Promise<Plan> => {
      const scene = await this.plans.writeSceneOf(
        transaction,
        access,
        branchId,
        journalId,
        quarterId,
      );
      const seen = await masterRowOf(transaction, masterId);
      // A reader of the master, or the owner of a plan of its subject and grade (review note 13).
      const reads =
        readsMaster(scene.reader, seen) ||
        (seen.subject_id === scene.journal.subjectId && scene.journal.grades.includes(seen.grade));
      if (!reads) throw new ApiException('plan_scope', 403);
      if (seen.subject_id !== scene.journal.subjectId) {
        throw new ApiException('plan_copy_subject', 409);
      }
      if (!scene.journal.grades.includes(seen.grade))
        throw new ApiException('plan_copy_grade', 409);
      const keys = await unitKeysOf(transaction, [scene.journal]);
      if ((keys.get(scene.journal.id) ?? '').split('|')[2] !== seen.language) {
        throw new ApiException('plan_copy_language', 409);
      }
      const startYear = await startYearOf(transaction, scene.journal.academicYearId);
      if (seen.start_year !== startYear || seen.quarter !== scene.quarter.number) {
        throw new ApiException('plan_copy_quarter', 409);
      }
      if (seen.archived_at !== null) throw new ApiException('plan_master_archived', 409);
      const members = await this.plans.lockPlanOf(transaction, journalId, scene.quarter.id);
      await this.ownAll(transaction, access, scene, members);
      const planNow = await planIdOf(transaction, journalId, scene.quarter.id);
      const starts = new Map<string, number>();
      for (const id of members) {
        const [journal] = await journalRows(transaction, branchId, { journalId: id });
        if (journal === undefined) continue;
        const { started } = await this.startedOf(transaction, scene, journal);
        starts.set(id, started);
        if (planNow === null) continue;
        const places = await this.plans.placesOf(transaction, planNow, id);
        if ([...places.values()].some((position) => position > started)) {
          throw new ApiException('plan_not_empty', 409);
        }
      }
      const targets: GateTarget[] = [];
      for (const id of members) {
        const rows = await this.plans.rowsOfJournal(transaction, scene, id);
        const ahead = rows.filter((row) => !row.started);
        targets.push({
          journalId: id,
          rows:
            ahead.length === 0
              ? [{ lessonId: null, date: null, started: false }]
              : ahead.map((row) => ({ lessonId: row.lessonId, date: row.date, started: false })),
          op: 'move',
        });
      }
      const pass = await this.plans.gate(transaction, scene, planNow ?? '', targets);
      const master = await masterRowOf(transaction, masterId, 'share');
      if (master.archived_at !== null) throw new ApiException('plan_master_archived', 409);
      const items = await masterItemsOf(transaction, masterId);
      const target = await this.plans.planFor(transaction, access, scene, requestId);
      const made: string[] = [];
      for (const item of items) {
        made.push(await insertFromMaster(transaction, branchId, target, item));
      }
      for (const id of members) {
        if (made.length === 0) break;
        const started = starts.get(id) ?? 0;
        await transaction
          .insertInto('lesson_plan_places')
          .values(
            made.map((itemId, index) => ({
              branch_id: branchId,
              plan_id: target,
              journal_id: id,
              item_id: itemId,
              position: started + index + 1,
            })),
          )
          .execute();
      }
      await transaction
        .updateTable('lesson_plans')
        .set({ master_id: masterId, master_revision: master.revision })
        .where('id', '=', target)
        .execute();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: scene.assignmentId,
        action: 'plan.copied',
        record: { type: 'lesson_plan', id: target },
        newValue: {
          journalId,
          quarterId: scene.quarter.id,
          sourceMasterId: masterId,
          masterRevision: master.revision,
          items: made.length,
        },
        ...gateAudit(pass),
        ...(requestId === undefined ? {} : { requestId }),
      });
      return this.plans.answer(transaction, scene);
    });
  }
}
