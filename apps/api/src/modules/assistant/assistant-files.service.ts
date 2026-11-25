import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ASSISTANT_EXCEL_TYPE,
  ASSISTANT_QUESTION_FILES_MAX_BYTES,
  ASSISTANT_UPLOAD_HOURS,
  assistantFileKey,
  assistantFileMaxBytes,
  assistantTypeFits,
  type AssistantFile,
  type AssistantFileKind,
  type AssistantFileType,
  type AssistantFileUploadQuery,
} from '@sodiq/shared';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { UploadedFile } from '../../http/file-routes.js';
import { StoredFile } from '../../http/stored-file.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { PHOTO_STORE, type PhotoStore } from '../people/photo-store.js';
import { AssistantSettingsService } from './assistant-settings.service.js';
import { conversationsQuery, isArchived } from './conversations.store.js';

const HOUR_MS = 60 * 60 * 1000;

/** A file row as the engine reads it. */
export interface FileRow {
  id: string;
  kind: AssistantFileKind;
  name: string;
  mediaType: AssistantFileType;
  size: number;
}

/** A file name in ASCII letters, for a browser that ignores `filename*`. */
const asciiOf = (name: string) => name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '_') || 'file';

/** Whether the first bytes are of the type the request names (as the plan files, task 7.1a). */
export function assistantBytesFit(bytes: Buffer, type: string): boolean {
  const starts = (...expected: number[]) =>
    bytes.length >= expected.length && expected.every((byte, index) => bytes[index] === byte);
  switch (type) {
    case ASSISTANT_EXCEL_TYPE:
      return starts(0x50, 0x4b, 0x03, 0x04) && bytes.includes(Buffer.from('xl/', 'latin1'));
    case 'application/pdf':
      return starts(0x25, 0x50, 0x44, 0x46, 0x2d);
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/webp':
      return (
        bytes.length >= 12 &&
        bytes.toString('latin1', 0, 4) === 'RIFF' &&
        bytes.toString('latin1', 8, 12) === 'WEBP'
      );
    case 'audio/webm':
      return starts(0x1a, 0x45, 0xdf, 0xa3);
    case 'audio/ogg':
      return bytes.length >= 4 && bytes.toString('latin1', 0, 4) === 'OggS';
    case 'audio/mp4':
      return bytes.length >= 8 && bytes.toString('latin1', 4, 8) === 'ftyp';
    default:
      return false;
  }
}

/**
 * The files of the assistant's conversations (task 11.22; `02`, Assistant, Files, photos and
 * voice): the person's uploads, the recordings and the exports the assistant made. The bytes go
 * to the photo store under `assistant/<file id>` (plan decision 8), never while a transaction is
 * open (`photo-store.ts`): the checks, the put, then the row and its audit entry.
 */
@Injectable()
export class AssistantFiles {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly settings: AssistantSettingsService,
    @Inject(PHOTO_STORE) private readonly store: PhotoStore,
  ) {}

  /** Whether a store is configured: without one the paperclip and microphone are hidden. */
  get configured(): boolean {
    return this.store.configured;
  }

  /**
   * `PUT /api/assistant/files`: an attachment or a recording of the person, in the role chosen,
   * which must be held now with the assistant switched on for it, as for a question.
   */
  async upload(
    access: Access,
    held: (role: AssistantFileUploadQuery['role']) => boolean,
    query: AssistantFileUploadQuery,
    file: UploadedFile | null,
    requestId: string,
  ): Promise<AssistantFile> {
    const branchId = access.branchId;
    if (branchId === null) throw new Error('A file is attached in a branch.');
    if (!held(query.role)) throw new ApiException('assistant_role_not_held', 403);
    await this.transactions.run(access.branchIds, async (transaction) => {
      const switches = await this.settings.switches(transaction);
      if (!switches.schoolOn || !switches.rolesOn.includes(query.role)) {
        throw new ApiException('assistant_off', 409);
      }
    });
    if (!this.store.configured) throw new ApiException('assistant_files_not_configured', 409);
    if (file === null || !assistantTypeFits(query.kind, file.type)) {
      throw new ApiException('unsupported_media_type', 415);
    }
    if (file.bytes.length > assistantFileMaxBytes(file.type)) {
      throw new ApiException('assistant_file_too_large', 413);
    }
    if (!assistantBytesFit(file.bytes, file.type)) {
      throw new ApiException('unsupported_media_type', 415);
    }
    const type = file.type as AssistantFileType;
    const id = randomUUID();
    try {
      await this.store.put(assistantFileKey(id), file.bytes, type);
    } catch {
      throw new ApiException('assistant_files_unavailable', 503);
    }
    return this.transactions.run(access.branchIds, async (transaction) => {
      const now = await transactionMoment(transaction);
      await insertFile(transaction, {
        id,
        branchId,
        accountId: access.accountId,
        kind: query.kind,
        name: query.name,
        mediaType: type,
        size: file.bytes.length,
        now,
      });
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'assistant_file.upload',
        record: { type: 'assistant_file', id },
        oldValue: null,
        newValue: { kind: query.kind, name: query.name, mediaType: type, size: file.bytes.length },
        requestId,
      });
      return { id, kind: query.kind, name: query.name, mediaType: type, size: file.bytes.length };
    });
  }

  /**
   * The uploads a question sends (plan, `POST /api/assistant/questions`): each the person's own
   * of that kind, in this branch (the row filter), sent with no message yet, uploaded at most 24
   * hours before; anything else 404 `assistant_file_not_found`. At most 14 MB together. Two
   * questions that send the same upload wait on the person's question lock, taken before this
   * (`refuseWhenClosed`): only the person's own uploads are taken, so the second sees the link.
   */
  async takeForQuestion(
    transaction: Transaction,
    accountId: string,
    wanted: { files: readonly string[]; voice: string | undefined },
    now: Date,
  ): Promise<{ files: FileRow[]; voice: FileRow | undefined }> {
    const ids = [...wanted.files, ...(wanted.voice === undefined ? [] : [wanted.voice])];
    if (ids.length === 0) return { files: [], voice: undefined };
    const rows = await transaction
      .selectFrom('assistant_files as f')
      .leftJoin('assistant_message_files as l', 'l.file_id', 'f.id')
      .select([
        'f.id',
        'f.kind',
        'f.name',
        'f.media_type',
        'f.size_bytes',
        'f.created_at',
        'f.account_id',
        'l.message_id',
      ])
      .where('f.id', 'in', ids)
      .execute();
    const since = now.getTime() - ASSISTANT_UPLOAD_HOURS * HOUR_MS;
    const take = (id: string, kind: 'attachment' | 'voice'): FileRow => {
      const row = rows.find((one) => one.id === id);
      if (
        row === undefined ||
        row.account_id !== accountId ||
        row.kind !== kind ||
        row.message_id !== null ||
        new Date(row.created_at).getTime() <= since
      ) {
        throw new ApiException('assistant_file_not_found', 404);
      }
      return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        mediaType: row.media_type as AssistantFileType,
        size: row.size_bytes,
      };
    };
    const files = wanted.files.map((id) => take(id, 'attachment'));
    const voice = wanted.voice === undefined ? undefined : take(wanted.voice, 'voice');
    const total = [...files, ...(voice === undefined ? [] : [voice])].reduce(
      (sum, file) => sum + file.size,
      0,
    );
    if (total > ASSISTANT_QUESTION_FILES_MAX_BYTES) {
      throw new ApiException('assistant_files_too_large', 413);
    }
    return { files, voice };
  }

  /** Links files to their message, in order (an insert; the unique key refuses a second link). */
  async link(
    transaction: Transaction,
    messageId: string,
    branchId: string,
    fileIds: readonly string[],
  ): Promise<void> {
    if (fileIds.length === 0) return;
    await transaction
      .insertInto('assistant_message_files')
      .values(
        fileIds.map((fileId, index) => ({
          message_id: messageId,
          file_id: fileId,
          branch_id: branchId,
          position: index + 1,
        })),
      )
      .execute();
  }

  /** The bytes of a stored file; `undefined` when the store fails. */
  async bytesOf(fileId: string): Promise<Buffer | undefined> {
    try {
      return await this.store.get(assistantFileKey(fileId));
    } catch {
      return undefined;
    }
  }

  /** Puts an export's bytes in the store; the row is written with the answer (`insertFile`). */
  async putExport(bytes: Buffer, type: AssistantFileType): Promise<string | undefined> {
    const id = randomUUID();
    try {
      await this.store.put(assistantFileKey(id), bytes, type);
    } catch {
      return undefined;
    }
    return id;
  }

  /**
   * `GET /api/assistant/files/:id`: a file of the person's own conversation, under the rule of
   * reading one (a branch and role held now, not archived). Anything else is 404. An export's
   * download is audited (plan decision 3: "The download from the conversation is logged again").
   */
  async ownDownload(
    access: Access,
    holds: (row: { role: string; branch_id: string }) => boolean,
    branchIds: readonly string[],
    fileId: string,
    requestId: string,
  ): Promise<StoredFile> {
    const found = await this.transactions.run(branchIds, async (transaction) => {
      const now = await transactionMoment(transaction);
      const file = await fileOfConversation(transaction, fileId);
      if (file === undefined) throw new ApiException('not_found', 404);
      const conversation = await conversationsQuery(transaction)
        .where('c.id', '=', file.conversation_id)
        .where('c.account_id', '=', access.accountId)
        .executeTakeFirst();
      if (
        conversation === undefined ||
        !holds(conversation) ||
        isArchived(new Date(conversation.last_activity_at), now)
      ) {
        throw new ApiException('not_found', 404);
      }
      return file;
    });
    return this.download(access, found, requestId, found.kind === 'export');
  }

  /**
   * Review of the plan, correction 3: the Super Admin downloads a file of any conversation they
   * read (archived included), each download audited.
   */
  async anyDownload(
    access: Access,
    branchIds: readonly string[],
    conversationId: string,
    fileId: string,
    requestId: string,
  ): Promise<StoredFile> {
    const found = await this.transactions.run(branchIds, async (transaction) => {
      const file = await fileOfConversation(transaction, fileId);
      if (file?.conversation_id !== conversationId) throw new ApiException('not_found', 404);
      return file;
    });
    return this.download(access, found, requestId, true);
  }

  private async download(
    access: Access,
    file: NonNullable<Awaited<ReturnType<typeof fileOfConversation>>>,
    requestId: string,
    audited: boolean,
  ): Promise<StoredFile> {
    if (!this.store.configured) throw new ApiException('assistant_files_not_configured', 409);
    const bytes = await this.bytesOf(file.id);
    if (bytes === undefined) throw new ApiException('assistant_files_unavailable', 503);
    if (audited) {
      await this.transactions.run([file.branch_id], async (transaction) => {
        await this.audit.record(transaction, {
          branchId: file.branch_id,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'assistant_file.download',
          record: { type: 'assistant_file', id: file.id },
          oldValue: null,
          newValue: {
            kind: file.kind,
            name: file.name,
            conversationId: file.conversation_id,
          },
          requestId,
        });
      });
    }
    return new StoredFile(file.media_type, file.name, asciiOf(file.name), bytes);
  }
}

/** Writes a file's row (an upload's, or an export's with its answer). */
export async function insertFile(
  transaction: Transaction,
  file: {
    id: string;
    branchId: string;
    accountId: string;
    kind: AssistantFileKind;
    name: string;
    mediaType: AssistantFileType;
    size: number;
    now: Date;
  },
): Promise<void> {
  await transaction
    .insertInto('assistant_files')
    .values({
      id: file.id,
      branch_id: file.branchId,
      account_id: file.accountId,
      kind: file.kind,
      name: file.name,
      media_type: file.mediaType,
      size_bytes: file.size,
      store_key: assistantFileKey(file.id),
      created_at: file.now,
    })
    .execute();
}

/** A file linked to a message, with the message's conversation, through the branch filter. */
function fileOfConversation(transaction: Transaction, fileId: string) {
  return transaction
    .selectFrom('assistant_files as f')
    .innerJoin('assistant_message_files as l', (join) =>
      join.onRef('l.file_id', '=', 'f.id').onRef('l.branch_id', '=', 'f.branch_id'),
    )
    .innerJoin('assistant_messages as m', (join) =>
      join.onRef('m.id', '=', 'l.message_id').onRef('m.branch_id', '=', 'l.branch_id'),
    )
    .select(['f.id', 'f.branch_id', 'f.kind', 'f.name', 'f.media_type', 'm.conversation_id'])
    .where('f.id', '=', fileId)
    .executeTakeFirst();
}
