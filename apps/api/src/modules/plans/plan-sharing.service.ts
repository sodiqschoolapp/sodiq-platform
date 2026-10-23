import { Injectable } from '@nestjs/common';
import type { Plan, PlanCopy, PlanSeparate, PlanShare } from '@sodiq/shared';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { journalRows, type JournalRow } from '../journal/journal-grid.query.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { lockJournals, planIdOf, planItems, planJournalIds, planRows } from './plan-read.js';
import { copyItems, separateJournal, unitKeysOf } from './plan-separate.js';
import { PlansService, type Scene } from './plans.service.js';

/**
 * Shared plans and copies (task 7.1c, pull request #214; `09`, What a plan
 * contains: "A teacher who teaches the same subject to several classes of
 * one grade ... can share one plan between them, if the classes have the
 * same language of instruction. ... A shared plan can be separated later."
 * "A plan can be copied from another class, from another teacher of the
 * same subject and grade, or from last year."). Only the owner of every
 * journal of the plan writes (decision 14).
 */

/** The share check of 0116, at the commit, for a language or grade changed meanwhile. */
const SHARE_REFUSALS = {
  lesson_plan_share_language: 'plan_share_language',
  lesson_plan_share_grade: 'plan_share_grade',
  lesson_plan_share_kind: 'plan_share_kind',
} as const;

type WriteScene = Scene & { readonly assignmentId: string };

@Injectable()
export class PlanSharing {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly plans: PlansService,
  ) {}

  /** The scenes of every journal of a plan: the writer owns each one (decision 14). */
  private async ownAll(
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
  private async startedOf(
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
    return refusingConstraints(
      () =>
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
          if (joining.academicYearId !== scene.journal.academicYearId) {
            throw new ApiException('plan_share_year', 409);
          }
          if (joining.subjectId !== scene.journal.subjectId) {
            throw new ApiException('plan_share_subject', 409);
          }
          // A state of the joining journal is told only to a reader of it.
          const joiningScene = await this.plans.sceneOf(
            transaction,
            access,
            branchId,
            joining.id,
            input.quarterId,
          );
          if (!joiningScene.reach.read) throw new ApiException('plan_scope', 403);
          await this.unitCheck(transaction, scene.journal, joining);
          await this.plans.writeSceneOf(transaction, access, branchId, joining.id, input.quarterId);
          const planNow = await planIdOf(transaction, journalId, scene.quarter.id);
          const members =
            planNow === null ? [journalId] : await planJournalIds(transaction, planNow);
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
          // Read after the locks (`database.md`): kind, grades and language.
          const rows = (
            await journalRows(transaction, branchId, { yearId: joining.academicYearId })
          ).filter((journal) => shared.includes(journal.id) || journal.id === joining.id);
          const joined = rows.find((journal) => journal.id === joining.id) ?? joining;
          for (const member of rows) {
            if (member.id !== joining.id) await this.unitCheck(transaction, member, joined);
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
      SHARE_REFUSALS,
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
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction): Promise<Plan> => {
      const scene = await this.plans.writeSceneOf(
        transaction,
        access,
        branchId,
        journalId,
        input.quarterId,
      );
      const source = await this.plans.sceneOf(
        transaction,
        access,
        branchId,
        input.source.journalId,
        input.source.quarterId,
      );
      if (!source.reach.read) throw new ApiException('plan_scope', 403);
      if (source.journal.subjectId !== scene.journal.subjectId) {
        throw new ApiException('plan_copy_subject', 409);
      }
      if (!source.journal.grades.some((grade) => scene.journal.grades.includes(grade))) {
        throw new ApiException('plan_copy_grade', 409);
      }
      const members = await this.plans.lockPlanOf(transaction, journalId, scene.quarter.id);
      await this.ownAll(transaction, access, scene, members);
      const sourcePlan = await planIdOf(transaction, source.journal.id, source.quarter.id);
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
      let sourceItems =
        sourcePlan === null ? [] : await planItems(transaction, sourcePlan, source.journal.id);
      if (input.part === 'remaining') {
        const { started } = await this.startedOf(transaction, source, source.journal);
        sourceItems = sourceItems.filter((item) => item.position > started);
      }
      const target = await this.plans.planFor(transaction, access, scene, requestId);
      const made = await copyItems(
        transaction,
        branchId,
        target,
        sourceItems.map((item) => item.id),
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
          sourceJournalId: source.journal.id,
          sourceQuarterId: source.quarter.id,
          sourcePlanId: sourcePlan,
          part: input.part,
          items: copied.length,
        },
        ...(requestId === undefined ? {} : { requestId }),
      });
      return this.plans.answer(transaction, scene);
    });
  }
}
