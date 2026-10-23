import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PLAN_FILES_MAX, planFileSchema, planFileTypeSchema, type PlanFile } from '@sodiq/shared';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { UploadedFile } from '../../http/file-routes.js';
import { StoredFile } from '../../http/stored-file.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { PHOTO_STORE, planFileKey, type PhotoStore } from '../people/photo-store.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { fileMatchesType } from './file-type.js';
import { gateAudit, PlansService } from './plans.service.js';

/**
 * The files of plan items (task 7.1a, pull request #212, decisions 1 and 3;
 * `edge/lesson-plans`: "Limits: 20 MB per file, 10 files per item, a fixed
 * list of file types"). The bytes go to the object store under keys never
 * reused, and no call to the store is made while a transaction is open
 * (`photo-store.ts`; review should-fix 3): the checks, the put, then the row
 * under the item's lock, where the 11th file is refused again.
 */

const fullRefusal = () => new ApiException('plan_files_full', 409);

/** A file name in ASCII letters, for a browser that ignores `filename*`. */
const asciiOf = (name: string) => name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '_') || 'file';

@Injectable()
export class PlanFiles {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly plans: PlansService,
    @Inject(PHOTO_STORE) private readonly store: PhotoStore,
  ) {}

  private async activeFiles(transaction: Transaction, itemId: string): Promise<number> {
    const found = await transaction
      .selectFrom('lesson_plan_files')
      .select('id')
      .where('item_id', '=', itemId)
      .where('removed_at', 'is', null)
      .execute();
    return found.length;
  }

  async add(
    access: Access,
    itemId: string,
    name: string,
    file: UploadedFile | null,
    requestId: string | undefined,
  ): Promise<PlanFile> {
    const branchId = branchOf(access);
    await this.transactions.run(access.branchIds, async (transaction) => {
      await this.plans.itemWriteScene(transaction, access, itemId, 'wording');
      if ((await this.activeFiles(transaction, itemId)) >= PLAN_FILES_MAX) throw fullRefusal();
    });
    if (!this.store.configured) throw new ApiException('files_not_configured', 503);
    if (file === null) throw new ApiException('unsupported_media_type', 415);
    const type = planFileTypeSchema.parse(file.type);
    if (!fileMatchesType(file.bytes, type)) throw new ApiException('plan_file_type', 400);
    const fileId = randomUUID();
    try {
      await this.store.put(planFileKey(itemId, fileId), file.bytes, type);
    } catch {
      throw new ApiException('files_unavailable', 503);
    }
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const scene = await this.plans.itemWriteScene(transaction, access, itemId, 'wording');
          // Under the item's lock the trigger `lesson_plan_files_limit` refuses an 11th file.
          await this.plans.lockItem(transaction, itemId);
          await transaction
            .insertInto('lesson_plan_files')
            .values({
              id: fileId,
              branch_id: branchId,
              item_id: itemId,
              name,
              type,
              bytes: file.bytes.length,
            })
            .execute();
          const added = { id: fileId, name, type, bytes: file.bytes.length };
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: scene.assignmentId,
            action: 'plan.file_add',
            record: { type: 'lesson_plan', id: scene.planId },
            oldValue: null,
            newValue: { itemId, ...added },
            ...gateAudit(scene.pass),
            ...(requestId === undefined ? {} : { requestId }),
          });
          return planFileSchema.parse(added);
        }),
      { lesson_plan_files_limit: 'plan_files_full' },
    );
  }

  /** The file row, not removed, of an item not cleared. */
  private async fileRow(transaction: Transaction, fileId: string) {
    const found = await transaction
      .selectFrom('lesson_plan_files')
      .innerJoin('lesson_plan_items', 'lesson_plan_items.id', 'lesson_plan_files.item_id')
      // Task 7.1c, decision 10: a copied file shows the bytes of the file it names.
      .leftJoin('lesson_plan_files as source', 'source.id', 'lesson_plan_files.copied_from')
      .select([
        'lesson_plan_files.id',
        'lesson_plan_files.item_id',
        'lesson_plan_files.name',
        'lesson_plan_files.type',
        'lesson_plan_files.bytes',
        'lesson_plan_files.copied_from',
        'source.item_id as source_item_id',
      ])
      .where('lesson_plan_files.id', '=', fileId)
      .where('lesson_plan_files.removed_at', 'is', null)
      .where('lesson_plan_items.cleared_at', 'is', null)
      .executeTakeFirst();
    if (found === undefined) throw notFound();
    return found;
  }

  remove(access: Access, fileId: string, requestId: string | undefined): Promise<void> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const row = await this.fileRow(transaction, fileId);
      const scene = await this.plans.itemWriteScene(transaction, access, row.item_id, 'wording');
      await this.plans.lockItem(transaction, row.item_id);
      const still = await this.fileRow(transaction, fileId);
      await transaction
        .updateTable('lesson_plan_files')
        .set({ removed_at: await transactionMoment(transaction) })
        .where('id', '=', still.id)
        .execute();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: scene.assignmentId,
        action: 'plan.file_remove',
        record: { type: 'lesson_plan', id: scene.planId },
        oldValue: {
          itemId: still.item_id,
          id: still.id,
          name: still.name,
          type: still.type,
          bytes: still.bytes,
        },
        newValue: null,
        ...gateAudit(scene.pass),
        ...(requestId === undefined ? {} : { requestId }),
      });
    });
  }

  async read(access: Access, fileId: string): Promise<StoredFile> {
    const row = await this.transactions.run(access.branchIds, async (transaction) => {
      const found = await this.fileRow(transaction, fileId);
      await this.plans.itemReadScene(transaction, access, found.item_id);
      return found;
    });
    if (!this.store.configured) throw new ApiException('files_not_configured', 503);
    let content: Buffer;
    try {
      content = await this.store.get(
        planFileKey(row.source_item_id ?? row.item_id, row.copied_from ?? row.id),
      );
    } catch {
      throw new ApiException('files_unavailable', 503);
    }
    return new StoredFile(planFileTypeSchema.parse(row.type), row.name, asciiOf(row.name), content);
  }
}
