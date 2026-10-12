import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
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

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('A staff route works for the branch of the request.');
  }
  return access.branchId;
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
  async setPhoto(
    access: Access,
    id: string,
    file: UploadedFile | null,
    requestId: string,
  ): Promise<void> {
    const branchId = branchOf(access);
    await this.transactions.run(access.branchIds, (transaction) =>
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
    await this.transactions.run(access.branchIds, async (transaction) => {
      const row = await transaction
        .selectFrom('staff')
        .select(['photo_id'])
        .where('id', '=', id)
        .where('kind', '=', 'person')
        .forUpdate()
        .executeTakeFirst();
      const linked = await transaction
        .selectFrom('staff_branches')
        .select('staff_id')
        .where('staff_id', '=', id)
        .where('branch_id', '=', branchId)
        .forShare()
        .executeTakeFirst();
      if (row === undefined || linked === undefined) {
        throw notFound();
      }
      await transaction
        .updateTable('staff')
        .set({ photo_id: photoId, photo_type: type })
        .where('id', '=', id)
        .execute();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        personId: id,
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

  /** Removes the photo from the record; the object stays in the store (decision 8). Nothing to remove: no entry. */
  async removePhoto(access: Access, id: string, requestId: string): Promise<void> {
    const branchId = branchOf(access);
    await this.transactions.run(access.branchIds, async (transaction) => {
      const row = await transaction
        .selectFrom('staff')
        .select(['photo_id'])
        .where('id', '=', id)
        .where('kind', '=', 'person')
        .forUpdate()
        .executeTakeFirst();
      const linked = await transaction
        .selectFrom('staff_branches')
        .select('staff_id')
        .where('staff_id', '=', id)
        .where('branch_id', '=', branchId)
        .forShare()
        .executeTakeFirst();
      if (row === undefined || linked === undefined) {
        throw notFound();
      }
      if (row.photo_id === null) {
        return;
      }
      await transaction
        .updateTable('staff')
        .set({ photo_id: null, photo_type: null })
        .where('id', '=', id)
        .execute();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        personId: id,
        action: 'staff.photo',
        record: { type: 'staff', id },
        oldValue: { photoId: row.photo_id },
        newValue: { photoId: null },
        requestId,
      });
    });
  }

  /** The current photo: the record read and its transaction closed, then the store. Not audited (a view). */
  async readPhoto(access: Access, id: string): Promise<PhotoFile> {
    const row = await this.transactions.run(access.branchIds, (transaction) =>
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
