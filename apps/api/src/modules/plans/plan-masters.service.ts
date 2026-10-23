import { Injectable } from '@nestjs/common';
import {
  planMasterSchema,
  planMastersSchema,
  type PlanMaster,
  type PlanMasterCreate,
  type PlanMasterItemCreate,
  type PlanMasterItemSave,
  type PlanMasterOrder,
  type PlanMasterRename,
  type PlanMasterRevision,
  type PlanMasters,
  type PlanMastersQuery,
  type PlanMasterScope,
  type PlanNewItemValues,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { notFound, refusingDuplicates } from '../setup/setup-refusals.js';
import {
  contentOf,
  masterItemsOf,
  masterRowOf,
  readsMaster,
  startYearOf,
  type MasterRow,
} from './plan-masters-read.js';
import { postHolders, postsOf } from './plan-posts.js';
import { clockOf } from './plan-read.js';
import { planReaderOf, type PlanReader } from './plan-scope.js';
import { unitKeysOf } from './plan-separate.js';
import { PlansService } from './plans.service.js';
import { sameContent } from './plan-master-compare.js';

/**
 * Master plans (task 7.3, pull request #216; `09`, Master plans). A master
 * is kept by the posts in force, not by a person (decision 3): a branch
 * master by the Head Teacher of its subject in the branch, the Senior Head
 * Teacher of the subject, the Academic Vice Principal while the subject has
 * no Head Teacher there, and the Super Admin; a master of all branches by the
 * Senior Head Teacher of the subject and the Super Admin. "Not tied to the
 * window": a master is written at any time; every write carries the master's
 * revision (decision 9) and is audited with its old and new values, which is
 * its history (decision 8).
 */

/** Two steps of a move of positions under a unique index that cannot wait for the commit. */
const POSITION_OFFSET = 100_000;

const MASTER_REFUSALS = { lesson_plan_masters_name_idx: 'name' } as const;

const scopeOfRow = (master: MasterRow): PlanMasterScope =>
  master.branch_id === null ? 'all' : 'branch';

@Injectable()
export class PlanMastersService {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly plans: PlansService,
  ) {}

  /**
   * The assignment that keeps the masters of a subject in a scope now, or
   * `null` (decision 3). Read from the posts in force at the transaction's
   * moment (`plan-posts.ts`) and named from the assignments that permit the
   * route.
   */
  async keeperOf(
    transaction: Transaction,
    access: Access,
    branchId: string,
    subjectId: string,
    scope: PlanMasterScope,
  ): Promise<string | null> {
    const now = await transactionMoment(transaction);
    const holders = await postHolders(transaction, branchId, subjectId, now);
    const posts = postsOf(holders, access.accountId);
    const subject = subjectId.toLowerCase();
    const assignmentOf = (role: string, bySubject: boolean) =>
      access.permitting.find(
        (assignment) =>
          assignment.role === role && (!bySubject || assignment.subjectIds.includes(subject)),
      )?.id ?? null;
    const tries: (string | null)[] = [];
    if (scope === 'branch' && posts.headTeacher) tries.push(assignmentOf('head_teacher', true));
    if (posts.seniorHeadTeacher) tries.push(assignmentOf('senior_head_teacher', true));
    if (
      scope === 'branch' &&
      posts.academicVicePrincipal &&
      !holders.some((holder) => holder.post === 'head_teacher')
    ) {
      tries.push(assignmentOf('academic_vice_principal', false));
    }
    if (posts.superAdmin) tries.push(assignmentOf('super_admin', false));
    return tries.find((one) => one !== null) ?? null;
  }

  /** The subjects whose masters the reader may create, with their grades and scopes. */
  private async keeps(
    transaction: Transaction,
    access: Access,
    branchId: string,
  ): Promise<PlanMasters['keeps']> {
    const writes = access.assignments.some((assignment) =>
      ['super_admin', 'academic_vice_principal', 'senior_head_teacher', 'head_teacher'].includes(
        assignment.role,
      ),
    );
    if (!writes) return [];
    const subjects = await transaction
      .selectFrom('subjects')
      .select(['id', 'name_uz', 'name_ru', 'name_en', 'colour', 'grades'])
      .where('journal_type', '=', 'graded')
      .where('archived_at', 'is', null)
      .orderBy('name_en')
      .orderBy('id')
      .execute();
    const keeps: unknown[] = [];
    for (const subject of subjects) {
      const scopes: PlanMasterScope[] = [];
      for (const scope of ['branch', 'all'] as const) {
        if ((await this.keeperOf(transaction, access, branchId, subject.id, scope)) !== null) {
          scopes.push(scope);
        }
      }
      if (scopes.length === 0) continue;
      keeps.push({
        subject: {
          id: subject.id,
          names: { uz: subject.name_uz, ru: subject.name_ru, en: subject.name_en },
          colour: subject.colour,
        },
        grades: subject.grades,
        scopes,
      });
    }
    return planMastersSchema.shape.keeps.parse(keeps);
  }

  /** The keeper of a master, else `plan_master_scope` (after the read, so a master read is told). */
  private async keeperFor(
    transaction: Transaction,
    access: Access,
    branchId: string,
    master: MasterRow,
    reader: PlanReader,
  ): Promise<string> {
    if (!readsMaster(reader, master)) throw new ApiException('plan_scope', 403);
    const assignmentId = await this.keeperOf(
      transaction,
      access,
      branchId,
      master.subject_id,
      scopeOfRow(master),
    );
    if (assignmentId === null) throw new ApiException('plan_master_scope', 403);
    return assignmentId;
  }

  /** The masters of the branch's year the reader may read. */
  list(access: Access, query: PlanMastersQuery): Promise<PlanMasters> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const { today } = await clockOf(transaction, branchId);
      const years = (
        await transaction
          .selectFrom('academic_years')
          .select([
            'id',
            sql<string>`start_date::text`.as('start_date'),
            sql<string>`end_date::text`.as('end_date'),
          ])
          .where('branch_id', '=', branchId)
          .orderBy('start_date', 'desc')
          .execute()
      ).map((row) => ({ id: row.id, startDate: row.start_date, endDate: row.end_date }));
      const reader = await planReaderOf(transaction, access);
      let yearId: string | null;
      // Masters that fit one plan (the copy dialog): the plan's year, subject,
      // grades, language and quarter; a writer of the plan reads them all.
      let fit: {
        subjectId: string;
        grades: readonly number[];
        language: string;
        quarter: number;
        edit: boolean;
      } | null = null;
      if (query.journalId !== undefined || query.quarterId !== undefined) {
        if (query.journalId === undefined || query.quarterId === undefined) throw notFound();
        const scene = await this.plans.sceneOf(
          transaction,
          access,
          branchId,
          query.journalId,
          query.quarterId,
        );
        if (!scene.reach.read) throw new ApiException('plan_scope', 403);
        const keys = await unitKeysOf(transaction, [scene.journal]);
        fit = {
          subjectId: scene.journal.subjectId,
          grades: scene.journal.grades,
          language: (keys.get(scene.journal.id) ?? '').split('|')[2] ?? '',
          quarter: scene.quarter.number,
          edit: scene.reach.edit,
        };
        yearId = scene.journal.academicYearId;
      } else if (query.yearId !== undefined) {
        if (!years.some((year) => year.id === query.yearId)) throw notFound();
        yearId = query.yearId;
      } else {
        yearId =
          years.find((year) => year.startDate <= today && today <= year.endDate)?.id ??
          years[0]?.id ??
          null;
      }
      const keeps = await this.keeps(transaction, access, branchId);
      if (yearId === null) return planMastersSchema.parse({ years, yearId, masters: [], keeps });
      const startYear = await startYearOf(transaction, yearId);
      let rows = transaction
        .selectFrom('lesson_plan_masters')
        .innerJoin('subjects', 'subjects.id', 'lesson_plan_masters.subject_id')
        .select([
          'lesson_plan_masters.id',
          'lesson_plan_masters.branch_id',
          'lesson_plan_masters.subject_id',
          'lesson_plan_masters.grade',
          'lesson_plan_masters.language',
          'lesson_plan_masters.start_year',
          'lesson_plan_masters.quarter',
          'lesson_plan_masters.name',
          'lesson_plan_masters.revision',
          'lesson_plan_masters.archived_at',
          'subjects.name_uz',
          'subjects.name_ru',
          'subjects.name_en',
          'subjects.colour',
          sql<number>`(select count(*)::int from lesson_plan_master_items i
            where i.master_id = lesson_plan_masters.id and i.removed_revision is null)`.as('items'),
        ])
        .where('lesson_plan_masters.start_year', '=', startYear);
      if (query.subjectId !== undefined) {
        rows = rows.where('lesson_plan_masters.subject_id', '=', query.subjectId);
      }
      if (query.grade !== undefined) {
        rows = rows.where('lesson_plan_masters.grade', '=', Number(query.grade));
      }
      if (query.quarter !== undefined) {
        rows = rows.where('lesson_plan_masters.quarter', '=', Number(query.quarter));
      }
      const found = await rows
        .orderBy('lesson_plan_masters.quarter')
        .orderBy('lesson_plan_masters.grade')
        .orderBy('subjects.name_en')
        .orderBy('lesson_plan_masters.name')
        .orderBy('lesson_plan_masters.id')
        .execute();
      const masters = [];
      for (const row of found) {
        const master: MasterRow = { ...row, language: row.language as 'uz' | 'ru' };
        if (fit !== null) {
          const fits =
            master.subject_id === fit.subjectId &&
            fit.grades.includes(master.grade) &&
            master.language === fit.language &&
            master.quarter === fit.quarter &&
            master.archived_at === null;
          if (!fits) continue;
          if (!fit.edit && !readsMaster(reader, master)) continue;
        } else if (!readsMaster(reader, master)) {
          continue;
        }
        masters.push({
          id: master.id,
          scope: scopeOfRow(master),
          subject: {
            id: master.subject_id,
            names: { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
            colour: row.colour,
          },
          grade: master.grade,
          language: master.language,
          startYear: master.start_year,
          quarter: master.quarter,
          name: master.name,
          items: row.items,
          archived: master.archived_at !== null,
          canEdit:
            (await this.keeperOf(
              transaction,
              access,
              branchId,
              master.subject_id,
              scopeOfRow(master),
            )) !== null,
        });
      }
      return planMastersSchema.parse({ years, yearId, masters, keeps });
    });
  }

  /** One master with its items, for a reader of it. */
  master(access: Access, masterId: string): Promise<PlanMaster> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const master = await masterRowOf(transaction, masterId);
      const reader = await planReaderOf(transaction, access);
      if (!readsMaster(reader, master)) throw new ApiException('plan_scope', 403);
      return this.answer(transaction, access, branchId, master);
    });
  }

  private async answer(
    transaction: Transaction,
    access: Access,
    branchId: string,
    master: MasterRow,
  ): Promise<PlanMaster> {
    const subject = await transaction
      .selectFrom('subjects')
      .select(['name_uz', 'name_ru', 'name_en', 'colour'])
      .where('id', '=', master.subject_id)
      .executeTakeFirstOrThrow();
    const items = await masterItemsOf(transaction, master.id);
    return planMasterSchema.parse({
      id: master.id,
      scope: scopeOfRow(master),
      subject: {
        id: master.subject_id,
        names: { uz: subject.name_uz, ru: subject.name_ru, en: subject.name_en },
        colour: subject.colour,
      },
      grade: master.grade,
      language: master.language,
      startYear: master.start_year,
      quarter: master.quarter,
      name: master.name,
      items: items.length,
      archived: master.archived_at !== null,
      canEdit:
        (await this.keeperOf(
          transaction,
          access,
          branchId,
          master.subject_id,
          scopeOfRow(master),
        )) !== null,
      revision: master.revision,
      masterItems: items.map((item) => ({
        id: item.id,
        position: item.position,
        topic: item.topic,
        objectives: item.objectives,
        links: item.links,
        classworks: item.classworks,
        homeworks: item.homeworks,
      })),
    });
  }

  /** A new master (decisions 3, 4 and 14). */
  create(access: Access, input: PlanMasterCreate, requestId: string): Promise<PlanMaster> {
    const branchId = branchOf(access);
    return refusingDuplicates(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const year = await transaction
            .selectFrom('academic_years')
            .select('id')
            .where('id', '=', input.yearId)
            .where('branch_id', '=', branchId)
            .executeTakeFirst();
          if (year === undefined) throw notFound();
          const subject = await transaction
            .selectFrom('subjects')
            .select(['journal_type', 'grades'])
            .where('id', '=', input.subjectId)
            .executeTakeFirst();
          if (subject === undefined) throw notFound();
          const assignmentId = await this.keeperOf(
            transaction,
            access,
            branchId,
            input.subjectId,
            input.scope,
          );
          if (assignmentId === null) throw new ApiException('plan_master_scope', 403);
          if (subject.journal_type !== 'graded' || !subject.grades.includes(input.grade)) {
            throw new ApiException('plan_master_subject', 409);
          }
          const startYear = await startYearOf(transaction, input.yearId);
          const made = await transaction
            .insertInto('lesson_plan_masters')
            .values({
              branch_id: input.scope === 'all' ? null : branchId,
              subject_id: input.subjectId,
              grade: input.grade,
              language: input.language,
              start_year: startYear,
              quarter: input.quarter,
              name: input.name.trim(),
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId,
            action: 'plan_master.create',
            record: { type: 'lesson_plan_master', id: made.id },
            newValue: {
              scope: input.scope,
              subjectId: input.subjectId,
              grade: input.grade,
              language: input.language,
              startYear,
              quarter: input.quarter,
              name: input.name.trim(),
            },
            requestId,
          });
          return this.answer(
            transaction,
            access,
            branchId,
            await masterRowOf(transaction, made.id),
          );
        }),
      MASTER_REFUSALS,
    );
  }

  /**
   * The start of every write of a master: found (404), read and kept by the
   * request (403), locked, then the revision the page read (decision 9) and,
   * unless `archivedToo`, not archived. Gives the master, the keeping
   * assignment and the next revision, already stored.
   */
  private async writeOf(
    transaction: Transaction,
    access: Access,
    branchId: string,
    masterId: string,
    revision: number,
    archived: 'refuse' | 'only' | 'not',
  ): Promise<{ master: MasterRow; assignmentId: string; next: number }> {
    const seen = await masterRowOf(transaction, masterId);
    const reader = await planReaderOf(transaction, access);
    const assignmentId = await this.keeperFor(transaction, access, branchId, seen, reader);
    const master = await masterRowOf(transaction, masterId, 'update');
    if (master.revision !== revision) throw new ApiException('plan_master_stale', 409);
    if (archived === 'refuse' && master.archived_at !== null) {
      throw new ApiException('plan_master_archived', 409);
    }
    if (archived === 'only' && master.archived_at === null) {
      throw new ApiException('plan_master_stale', 409);
    }
    if (archived === 'not' && master.archived_at !== null) {
      throw new ApiException('plan_master_archived', 409);
    }
    const next = master.revision + 1;
    await transaction
      .updateTable('lesson_plan_masters')
      .set({ revision: next })
      .where('id', '=', masterId)
      .execute();
    return { master, assignmentId, next };
  }

  rename(
    access: Access,
    masterId: string,
    input: PlanMasterRename,
    requestId: string,
  ): Promise<PlanMaster> {
    const branchId = branchOf(access);
    return refusingDuplicates(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const { master, assignmentId } = await this.writeOf(
            transaction,
            access,
            branchId,
            masterId,
            input.revision,
            'refuse',
          );
          const name = input.name.trim();
          await transaction
            .updateTable('lesson_plan_masters')
            .set({ name })
            .where('id', '=', masterId)
            .execute();
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId,
            action: 'plan_master.rename',
            record: { type: 'lesson_plan_master', id: masterId },
            oldValue: { name: master.name },
            newValue: { name, scope: scopeOfRow(master) },
            requestId,
          });
          return this.answer(
            transaction,
            access,
            branchId,
            await masterRowOf(transaction, masterId),
          );
        }),
      MASTER_REFUSALS,
    );
  }

  /** Archive (`CLAUDE.md`, "Archive, do not delete"): plans copied earlier keep it (decision 16). */
  archive(
    access: Access,
    masterId: string,
    input: PlanMasterRevision,
    requestId: string,
  ): Promise<PlanMaster> {
    return this.archiveOrRestore(access, masterId, input, requestId, true);
  }

  /** Restore; a name now taken is refused `already_exists` on `name` (decision 16). */
  restore(
    access: Access,
    masterId: string,
    input: PlanMasterRevision,
    requestId: string,
  ): Promise<PlanMaster> {
    return this.archiveOrRestore(access, masterId, input, requestId, false);
  }

  private archiveOrRestore(
    access: Access,
    masterId: string,
    input: PlanMasterRevision,
    requestId: string,
    archive: boolean,
  ): Promise<PlanMaster> {
    const branchId = branchOf(access);
    return refusingDuplicates(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const { master, assignmentId } = await this.writeOf(
            transaction,
            access,
            branchId,
            masterId,
            input.revision,
            archive ? 'not' : 'only',
          );
          const now = await transactionMoment(transaction);
          await transaction
            .updateTable('lesson_plan_masters')
            .set({ archived_at: archive ? now : null })
            .where('id', '=', masterId)
            .execute();
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId,
            action: archive ? 'plan_master.archive' : 'plan_master.restore',
            record: { type: 'lesson_plan_master', id: masterId },
            newValue: { name: master.name, scope: scopeOfRow(master) },
            requestId,
          });
          return this.answer(
            transaction,
            access,
            branchId,
            await masterRowOf(transaction, masterId),
          );
        }),
      MASTER_REFUSALS,
    );
  }

  /** Moves live items of a master to new positions, in two steps (spec review of the plan, should-fix 11). */
  private async moveItems(
    transaction: Transaction,
    moves: ReadonlyMap<string, number>,
  ): Promise<void> {
    for (const step of [POSITION_OFFSET, 0]) {
      for (const [itemId, position] of moves) {
        await transaction
          .updateTable('lesson_plan_master_items')
          .set({ position: position + step })
          .where('id', '=', itemId)
          .execute();
      }
    }
  }

  private async insertWorks(
    transaction: Transaction,
    branchId: string | null,
    itemId: string,
    values: PlanNewItemValues,
  ): Promise<void> {
    const works = [
      ...values.classworks.map((work, index) => ({ kind: 'classwork', work, index })),
      ...values.homeworks.map((work, index) => ({ kind: 'homework', work, index })),
    ];
    if (works.length === 0) return;
    await transaction
      .insertInto('lesson_plan_master_works')
      .values(
        works.map(({ kind, work, index }) => ({
          branch_id: branchId,
          item_id: itemId,
          kind,
          position: index + 1,
          title: work.title.trim(),
          description: work.description,
        })),
      )
      .execute();
  }

  /** A new item at a place of the master's order; the items from there move one step. */
  createItem(
    access: Access,
    masterId: string,
    input: PlanMasterItemCreate,
    requestId: string,
  ): Promise<PlanMaster> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const { master, assignmentId, next } = await this.writeOf(
        transaction,
        access,
        branchId,
        masterId,
        input.revision,
        'refuse',
      );
      const items = await masterItemsOf(transaction, masterId);
      const position = Math.min(input.position, items.length + 1);
      await this.moveItems(
        transaction,
        new Map(
          items
            .filter((item) => item.position >= position)
            .map((item) => [item.id, item.position + 1]),
        ),
      );
      const made = await transaction
        .insertInto('lesson_plan_master_items')
        .values({
          branch_id: master.branch_id,
          master_id: masterId,
          position,
          topic: input.values.topic.trim(),
          objectives: input.values.objectives,
          links: input.values.links,
          added_revision: next,
          changed_revision: next,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.insertWorks(transaction, master.branch_id, made.id, input.values);
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId,
        action: 'plan_master.item_create',
        record: { type: 'lesson_plan_master', id: masterId },
        newValue: {
          itemId: made.id,
          position,
          revision: next,
          scope: scopeOfRow(master),
          ...contentOf({ ...input.values, topic: input.values.topic.trim() }),
        },
        requestId,
      });
      return this.answer(transaction, access, branchId, await masterRowOf(transaction, masterId));
    });
  }

  /** The item named by the path, of the master named by the path, in the master (404 otherwise). */
  private async liveItem(transaction: Transaction, masterId: string, itemId: string) {
    const items = await masterItemsOf(transaction, masterId);
    const item = items.find((one) => one.id === itemId);
    if (item === undefined) throw notFound();
    return { item, items };
  }

  /** A save of an item: its content and works, replaced as a whole. */
  saveItem(
    access: Access,
    masterId: string,
    itemId: string,
    input: PlanMasterItemSave,
    requestId: string,
  ): Promise<PlanMaster> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      // The item belongs to the master before anything else is told (404).
      await this.liveItem(transaction, masterId, itemId);
      const { master, assignmentId, next } = await this.writeOf(
        transaction,
        access,
        branchId,
        masterId,
        input.revision,
        'refuse',
      );
      const { item } = await this.liveItem(transaction, masterId, itemId);
      const before = contentOf(item);
      const after = contentOf({ ...input.values, topic: input.values.topic.trim() });
      if (!sameContent(before, after)) {
        await transaction
          .updateTable('lesson_plan_master_items')
          .set({
            topic: after.topic,
            objectives: after.objectives,
            links: after.links,
            changed_revision: next,
          })
          .where('id', '=', itemId)
          .execute();
        await transaction
          .deleteFrom('lesson_plan_master_works')
          .where('item_id', '=', itemId)
          .execute();
        await this.insertWorks(transaction, master.branch_id, itemId, input.values);
      }
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId,
        action: 'plan_master.item_edit',
        record: { type: 'lesson_plan_master', id: masterId },
        oldValue: { itemId, ...before },
        newValue: { itemId, revision: next, scope: scopeOfRow(master), ...after },
        requestId,
      });
      return this.answer(transaction, access, branchId, await masterRowOf(transaction, masterId));
    });
  }

  /** An item leaves the master and is kept (decision 8); the items after it close up. */
  removeItem(
    access: Access,
    masterId: string,
    itemId: string,
    input: PlanMasterRevision,
    requestId: string,
  ): Promise<PlanMaster> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      await this.liveItem(transaction, masterId, itemId);
      const { master, assignmentId, next } = await this.writeOf(
        transaction,
        access,
        branchId,
        masterId,
        input.revision,
        'refuse',
      );
      const { item, items } = await this.liveItem(transaction, masterId, itemId);
      await transaction
        .updateTable('lesson_plan_master_items')
        .set({ removed_revision: next })
        .where('id', '=', itemId)
        .execute();
      await this.moveItems(
        transaction,
        new Map(
          items
            .filter((one) => one.position > item.position)
            .map((one) => [one.id, one.position - 1]),
        ),
      );
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId,
        action: 'plan_master.item_remove',
        record: { type: 'lesson_plan_master', id: masterId },
        oldValue: { itemId, position: item.position, ...contentOf(item) },
        newValue: { itemId, revision: next, scope: scopeOfRow(master) },
        requestId,
      });
      return this.answer(transaction, access, branchId, await masterRowOf(transaction, masterId));
    });
  }

  /** The whole order of the master's items. */
  order(
    access: Access,
    masterId: string,
    input: PlanMasterOrder,
    requestId: string,
  ): Promise<PlanMaster> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      // `.claude/rules/api.md`: an id in the body that is no item of the master is 404.
      const known = new Set((await masterItemsOf(transaction, masterId)).map((item) => item.id));
      if (input.order.some((id) => !known.has(id))) throw notFound();
      const { master, assignmentId } = await this.writeOf(
        transaction,
        access,
        branchId,
        masterId,
        input.revision,
        'refuse',
      );
      const items = await masterItemsOf(transaction, masterId);
      if (
        new Set(input.order).size !== input.order.length ||
        input.order.length !== items.length ||
        input.order.some((id) => !items.some((item) => item.id === id))
      ) {
        throw new ApiException('plan_master_items', 409);
      }
      const before = items.map((item) => item.id);
      await this.moveItems(transaction, new Map(input.order.map((id, index) => [id, index + 1])));
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId,
        action: 'plan_master.order',
        record: { type: 'lesson_plan_master', id: masterId },
        oldValue: { order: before },
        newValue: { order: input.order, scope: scopeOfRow(master) },
        requestId,
      });
      return this.answer(transaction, access, branchId, await masterRowOf(transaction, masterId));
    });
  }
}
