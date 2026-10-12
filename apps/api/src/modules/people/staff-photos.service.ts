import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { photoTypeSchema, type PhotoType } from '@sodiq/shared';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { UploadedFile } from '../../http/file-routes.js';
import { PhotoFile } from '../../http/photo-file.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { photoSizeOf } from './photo-check.js';
import { PHOTO_STORE, staffPhotoKey, type PhotoStore } from './photo-store.js';

const notConfigured = () => new ApiException('photos_not_configured', 503);
const unavailable = () => new ApiException('photos_unavailable', 503);

/** Whose photo is changed, by whom, and in which branch the entry goes. */
interface PhotoTarget {
  branchIds: readonly string[];
  branchId: string;
  /** The own photo: the link must still be the main one under the lock. */
  main: boolean;
  actorId: string;
  assignmentId?: string;
  id: string;
}

class MainBranchMoved extends Error {}

function targetOf(access: Access, id: string): PhotoTarget {
  if (access.branchId === null) {
    throw new Error('A staff route works for the branch of the request.');
  }
  return {
    branchIds: access.branchIds,
    branchId: access.branchId,
    main: false,
    actorId: access.accountId,
    ...(access.assignmentId === undefined ? {} : { assignmentId: access.assignmentId }),
    id,
  };
}

function auditNamesOf(target: PhotoTarget) {
  return {
    branchId: target.branchId,
    actorId: target.actorId,
    ...(target.assignmentId === undefined ? {} : { assignmentId: target.assignmentId }),
    personId: target.id,
  };
}

/**
 * Staff photos (docs/spec/04-people.md, Teacher and staff record, "photo";
 * task 2.2c-2, pull request #59). The Super Admin and the branch's Academic
 * Vice Principal set and remove them (decision 2), every role that views
 * staff records sees them. A vacancy holds none (04 Vacancy, "nothing
 * personal"): its id is 404 here, as an unknown id or a person of another
 * branch. The bytes live in the photo store; the record keeps the current
 * photo's id and type. No call to the store is made while a transaction is
 * open (`edge/system-behaviour`: when file storage is down "Only that
 * function fails"): a store that hangs holds no pooled connection and no row
 * lock.
 */
@Injectable()
export class StaffPhotos {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(PHOTO_STORE) private readonly store: PhotoStore,
  ) {}

  /** The current photo of a person seen in the branch of the request; 404 for anything else. */
  private async readPerson(
    transaction: Transaction,
    id: string,
  ): Promise<{ photo_id: string | null; photo_type: string | null }> {
    const row = await transaction
      .selectFrom('staff')
      .select(['photo_id', 'photo_type'])
      .where('id', '=', id)
      .where('kind', '=', 'person')
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return row;
  }

  /**
   * Sets a new photo. In this order (correction 3 of the review): the record
   * (404), the store (`photos_not_configured`), a body that is no file (415,
   * `file` is `null`), the bytes (`photo_invalid`),
   * the object put outside any transaction (`photos_unavailable`), then one
   * transaction that locks the record, reads its link to the branch again
   * (`.claude/rules/database.md`: a link removed while the lock was awaited
   * would otherwise pass), writes the photo and its audit entry. An object
   * whose transaction then fails stays as an orphan under a key never reused.
   */
  setPhoto(
    access: Access,
    id: string,
    file: UploadedFile | null,
    requestId: string,
  ): Promise<void> {
    return this.place(targetOf(access, id), file, requestId);
  }

  /** Removes the photo from the record; the object stays in the store (decision 8). Nothing to remove: no entry. */
  removePhoto(access: Access, id: string, requestId: string): Promise<void> {
    return this.clear(targetOf(access, id), requestId);
  }

  /**
   * The own photo of the person signed in (task 2.3c-2, decision 18 of pull
   * request #66; `edge/people-roles-accounts`: "Staff can change their own
   * ... photo"), the Principal too: the same checks, order and entry as the
   * staff photo, with the own account as actor, no assignment (no role
   * allowed it) and the record's main branch, read again under the lock.
   */
  setOwnPhoto(accountId: string, file: UploadedFile | null, requestId: string): Promise<void> {
    return this.asOwn(accountId, (target) => this.place(target, file, requestId));
  }

  removeOwnPhoto(accountId: string, requestId: string): Promise<void> {
    return this.asOwn(accountId, (target) => this.clear(target, requestId));
  }

  async readOwnPhoto(accountId: string): Promise<PhotoFile> {
    const own = await this.ownRecord(accountId);
    return this.read([own.branchId], own.staffId);
  }

  /** The record linked to the account and its main branch; 404 when there is none (the first Super Admin). */
  private async ownRecord(accountId: string): Promise<{ staffId: string; branchId: string }> {
    const found = await this.transactions.run([], (transaction) =>
      sql<{ staff_id: string; branch_id: string }>`
        select staff_id, branch_id from own_staff_record(${accountId}::uuid)
      `.execute(transaction),
    );
    const row = found.rows[0];
    if (row === undefined) {
      throw notFound();
    }
    return { staffId: row.staff_id, branchId: row.branch_id };
  }

  /**
   * Runs the work for the own record in its main branch. When the main branch
   * moved between the read and the lock (should-fix 12 of the plan review),
   * the work finds no main link there and is run again from the new one.
   */
  private async asOwn(accountId: string, work: (target: PhotoTarget) => Promise<void>) {
    for (let tries = 0; ; tries += 1) {
      const own = await this.ownRecord(accountId);
      try {
        await work({
          branchIds: [own.branchId],
          branchId: own.branchId,
          main: true,
          actorId: accountId,
          id: own.staffId,
        });
        return;
      } catch (error) {
        if (!(error instanceof MainBranchMoved) || tries >= 2) {
          throw error instanceof MainBranchMoved ? notFound() : error;
        }
      }
    }
  }

  private async place(target: PhotoTarget, file: UploadedFile | null, requestId: string) {
    const { id } = target;
    await this.transactions.run(target.branchIds, (transaction) =>
      this.readPerson(transaction, id),
    );
    if (!this.store.configured) {
      throw notConfigured();
    }
    if (file === null) {
      throw new ApiException('unsupported_media_type', 415);
    }
    const type: PhotoType = photoTypeSchema.parse(file.type);
    const size = photoSizeOf(file.bytes, type);
    if (size === null) {
      throw new ApiException('photo_invalid', 400);
    }
    const photoId = randomUUID();
    try {
      await this.store.put(staffPhotoKey(id, photoId), file.bytes, type);
    } catch {
      throw unavailable();
    }
    await this.transactions.run(target.branchIds, async (transaction) => {
      const row = await this.lockLinked(transaction, target);
      await transaction
        .updateTable('staff')
        .set({ photo_id: photoId, photo_type: type })
        .where('id', '=', id)
        .execute();
      await this.audit.record(transaction, {
        ...auditNamesOf(target),
        action: 'staff.photo',
        record: { type: 'staff', id },
        oldValue: { photoId: row.photo_id },
        newValue: {
          photoId,
          type,
          width: size.width,
          height: size.height,
          bytes: file.bytes.length,
        },
        requestId,
      });
    });
  }

  private async clear(target: PhotoTarget, requestId: string): Promise<void> {
    const { id } = target;
    await this.transactions.run(target.branchIds, async (transaction) => {
      const row = await this.lockLinked(transaction, target);
      if (row.photo_id === null) {
        return;
      }
      await transaction
        .updateTable('staff')
        .set({ photo_id: null, photo_type: null })
        .where('id', '=', id)
        .execute();
      await this.audit.record(transaction, {
        ...auditNamesOf(target),
        action: 'staff.photo',
        record: { type: 'staff', id },
        oldValue: { photoId: row.photo_id },
        newValue: { photoId: null },
        requestId,
      });
    });
  }

  /**
   * Locks the record, then reads its link to the branch again in a statement
   * of its own, `for share` (`.claude/rules/database.md`); for the own photo
   * the link must still be the main one.
   */
  private async lockLinked(
    transaction: Transaction,
    target: PhotoTarget,
  ): Promise<{ photo_id: string | null }> {
    const row = await transaction
      .selectFrom('staff')
      .select(['photo_id'])
      .where('id', '=', target.id)
      .where('kind', '=', 'person')
      .forUpdate()
      .executeTakeFirst();
    const linked = await transaction
      .selectFrom('staff_branches')
      .select(['staff_id', 'is_main'])
      .where('staff_id', '=', target.id)
      .where('branch_id', '=', target.branchId)
      .forShare()
      .executeTakeFirst();
    if (target.main && row !== undefined && linked?.is_main !== true) {
      throw new MainBranchMoved();
    }
    if (row === undefined || linked === undefined) {
      throw notFound();
    }
    return row;
  }

  /** The current photo: the record read and its transaction closed, then the store. Not audited (a view). */
  readPhoto(access: Access, id: string): Promise<PhotoFile> {
    return this.read(access.branchIds, id);
  }

  private async read(branchIds: readonly string[], id: string): Promise<PhotoFile> {
    const row = await this.transactions.run(branchIds, (transaction) =>
      this.readPerson(transaction, id),
    );
    if (row.photo_id === null || row.photo_type === null) {
      throw notFound();
    }
    if (!this.store.configured) {
      throw notConfigured();
    }
    const type = photoTypeSchema.parse(row.photo_type);
    try {
      return new PhotoFile(type, await this.store.get(staffPhotoKey(id, row.photo_id)));
    } catch {
      throw unavailable();
    }
  }
}
