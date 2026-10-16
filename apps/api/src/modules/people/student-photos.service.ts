import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { photoTypeSchema, type PhotoType } from '@sodiq/shared';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { UploadedFile } from '../../http/file-routes.js';
import { PhotoFile } from '../../http/photo-file.js';
import { listsBranchStudents, placesOfStudent, studentReaderOf } from '../access/class-scope.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { photoSizeOf } from './photo-check.js';
import { PHOTO_STORE, studentPhotoKey, type PhotoStore } from './photo-store.js';

const notConfigured = () => new ApiException('photos_not_configured', 503);
const unavailable = () => new ApiException('photos_unavailable', 503);

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('A student route works for the branch of the request.');
  }
  return access.branchId;
}

/**
 * Student photos (docs/spec/04-people.md, Student record: "Personal | Photo,
 * ..."; the list: "checkbox, number, photo, UID, ..."; task 2.4b-2, pull
 * request #70, decision 7). The shape of the staff photos of 2.2c-2 (answer
 * 2): the Super Admin and the Academic Vice Principal set and remove them
 * under `students` `edit`, every reader of the list sees them (the Basic
 * group: "name, class, photo, UID: all staff of the branch"). A student of
 * another branch or an unknown id is 404. No call to the store is made while
 * a transaction is open (`edge/system-behaviour`: when file storage is down
 * "Only that function fails"). A photo can be set on an inactive or graduated
 * student; a replaced or removed photo's object stays in the store.
 */
@Injectable()
export class StudentPhotos {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(PHOTO_STORE) private readonly store: PhotoStore,
  ) {}

  /** The current photo of a student of the branch of the request; 404 for anything else. */
  private async readStudent(
    transaction: Transaction,
    branchId: string,
    id: string,
  ): Promise<{ photo_id: string | null; photo_type: string | null }> {
    const row = await transaction
      .selectFrom('students')
      .select(['photo_id', 'photo_type'])
      .where('id', '=', id)
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return row;
  }

  /** Locks the student of the branch (the first lock of every student change, 2.4a); 404 when it is gone. */
  private async lockStudent(
    transaction: Transaction,
    branchId: string,
    id: string,
  ): Promise<{ photo_id: string | null }> {
    const row = await transaction
      .selectFrom('students')
      .select(['photo_id'])
      .where('id', '=', id)
      .where('branch_id', '=', branchId)
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return row;
  }

  /**
   * Sets a new photo, in the order of 2.2c-2: the record (404), the store
   * (`photos_not_configured`), a body that is no file (415), the bytes
   * (`photo_invalid`), the object put outside any transaction
   * (`photos_unavailable`), then one transaction that locks the student and
   * writes the photo and its audit entry. A student deleted meanwhile is 404;
   * the object put stays as an orphan under a key never reused.
   */
  async setPhoto(
    access: Access,
    id: string,
    file: UploadedFile | null,
    requestId: string,
  ): Promise<void> {
    const branchId = branchOf(access);
    await this.transactions.run(access.branchIds, (transaction) =>
      this.readStudent(transaction, branchId, id),
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
      await this.store.put(studentPhotoKey(id, photoId), file.bytes, type);
    } catch {
      throw unavailable();
    }
    const bytes = file.bytes.length;
    await this.transactions.run(access.branchIds, async (transaction) => {
      const row = await this.lockStudent(transaction, branchId, id);
      await transaction
        .updateTable('students')
        .set({ photo_id: photoId, photo_type: type })
        .where('id', '=', id)
        .execute();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        ...(access.assignmentId === undefined ? {} : { assignmentId: access.assignmentId }),
        action: 'student.photo',
        record: { type: 'student', id },
        oldValue: { photoId: row.photo_id },
        newValue: { photoId, type, width: size.width, height: size.height, bytes },
        requestId,
      });
    });
  }

  /** Removes the photo from the record; the object stays in the store. Nothing to remove: no entry. */
  removePhoto(access: Access, id: string, requestId: string): Promise<void> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const row = await this.lockStudent(transaction, branchId, id);
      if (row.photo_id === null) {
        return;
      }
      await transaction
        .updateTable('students')
        .set({ photo_id: null, photo_type: null })
        .where('id', '=', id)
        .execute();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        ...(access.assignmentId === undefined ? {} : { assignmentId: access.assignmentId }),
        action: 'student.photo',
        record: { type: 'student', id },
        oldValue: { photoId: row.photo_id },
        newValue: { photoId: null },
        requestId,
      });
    });
  }

  /**
   * The current photo: the record read and its transaction closed, then the
   * store. Not audited (a view). A Teacher alone reads the photos of the
   * students taught (task 3.6a, L48): another student is 403 after the 404.
   */
  async readPhoto(access: Access, id: string): Promise<PhotoFile> {
    const branchId = branchOf(access);
    const row = await this.transactions.run(access.branchIds, async (transaction) => {
      const found = await this.readStudent(transaction, branchId, id);
      if (
        !listsBranchStudents(access) &&
        studentReaderOf(access, 'students', await placesOfStudent(transaction, branchId, id)) ===
          undefined
      ) {
        throw new ApiException('permission_denied', 403);
      }
      return found;
    });
    if (row.photo_id === null || row.photo_type === null) {
      throw notFound();
    }
    if (!this.store.configured) {
      throw notConfigured();
    }
    const type = photoTypeSchema.parse(row.photo_type);
    try {
      return new PhotoFile(type, await this.store.get(studentPhotoKey(id, row.photo_id)));
    } catch {
      throw unavailable();
    }
  }
}
