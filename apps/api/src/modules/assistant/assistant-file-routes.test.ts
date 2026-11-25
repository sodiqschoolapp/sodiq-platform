import { randomUUID } from 'node:crypto';
import {
  ASSISTANT_EXCEL_TYPE,
  ASSISTANT_UPLOAD_MAX_BYTES,
  BRANCH_HEADER,
  STUDENT_IMPORT_MAX_BYTES,
  assistantConversationSchema,
  assistantFileSchema,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryPhotoStore } from '../people/photo-store.js';
import {
  ask,
  assistantScene,
  bytesOf,
  read,
  send,
  upload,
  type AssistantScene,
} from '../../testing/assistant-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

// Task 11.22 (`02`, Assistant, Files, photos and voice; Audit: "The person sees their own
// conversations; the Super Admin sees all of them"). The upload route (plan decision 1, Look
// first), the download of a file of the own conversation, the Super Admin's download (review of
// the plan, correction 3), and the files a question sends (plan, POST /api/assistant/questions).
// Names are invented.

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-20T10:00:00+05:00');
const UNKNOWN = '0199a000-0000-7000-8000-000000000999';

describe('the assistant: the routes of files', () => {
  let scene: AssistantScene;
  let store: MemoryPhotoStore;
  let other: string;
  let otherAccount: string;
  let teacher: string;
  let teacherAccount: string;

  const server = () => scene.app.getHttpServer() as Parameters<typeof request>[0];

  const rows = async () => ({
    files: await scene.database.migrator.selectFrom('assistant_files').selectAll().execute(),
    links: await scene.database.migrator
      .selectFrom('assistant_message_files')
      .selectAll()
      .execute(),
    messages: await scene.database.migrator.selectFrom('assistant_messages').selectAll().execute(),
    conversations: await scene.database.migrator
      .selectFrom('assistant_conversations')
      .selectAll()
      .execute(),
    audit: (
      await sql<{ n: number }>`select count(*)::int as n from audit_log`.execute(
        scene.database.migrator,
      )
    ).rows[0]?.n,
  });

  /** A conversation of an account written by the migrator, with a question holding one file. */
  async function stored(input: {
    branch: string;
    account: string;
    role?: 'super_admin' | 'teacher';
    at?: Date;
  }): Promise<{ conversation: string; file: string }> {
    const at = input.at ?? NOW;
    const conversation = await scene.database.migrator
      .insertInto('assistant_conversations')
      .values({
        branch_id: input.branch,
        account_id: input.account,
        role: input.role ?? 'super_admin',
        title: 'Written earlier.',
        created_at: at,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const message = await scene.database.migrator
      .insertInto('assistant_messages')
      .values({
        conversation_id: conversation.id,
        branch_id: input.branch,
        account_id: input.account,
        seq: 1,
        kind: 'question',
        content: sql`'{"kind":"question","text":"Earlier."}'::jsonb`,
        created_at: at,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    // Answered: the question is not one still being answered.
    await scene.database.migrator
      .insertInto('assistant_messages')
      .values({
        conversation_id: conversation.id,
        branch_id: input.branch,
        account_id: input.account,
        seq: 2,
        kind: 'answer',
        content: sql`'{"kind":"answer","text":"Done.","pages":[]}'::jsonb`,
        created_at: at,
      })
      .execute();
    const id = randomUUID();
    await scene.database.migrator
      .insertInto('assistant_files')
      .values({
        id,
        branch_id: input.branch,
        account_id: input.account,
        kind: 'attachment',
        name: 'list.png',
        media_type: 'image/png',
        size_bytes: 64,
        store_key: `assistant/${id}`,
        created_at: at,
      })
      .execute();
    await scene.database.migrator
      .insertInto('assistant_message_files')
      .values({ message_id: message.id, file_id: id, branch_id: input.branch, position: 1 })
      .execute();
    await store.put(`assistant/${id}`, bytesOf('image/png'), 'image/png');
    return { conversation: conversation.id, file: id };
  }

  beforeAll(async () => {
    store = new MemoryPhotoStore();
    scene = await assistantScene({ photoStore: store });
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ roles_on: ['super_admin', 'teacher'] })
      .execute();
    const browser = await scene.kit.completeSession('Sevara', 'Otherova');
    await scene.kit.giveRole(browser.account.id, { role: 'super_admin' });
    other = browser.cookie;
    otherAccount = browser.account.id;
    const teaching = await scene.kit.fullSession('Bekzod', 'Teacherov');
    await scene.kit.giveRole(teaching.account.id, { role: 'teacher', branchId: scene.north });
    teacher = teaching.cookie;
    teacherAccount = teaching.account.id;
  }, 120_000);

  afterAll(async () => {
    await scene.close();
  });

  it('takes a photo, a PDF and a recording, keeps the bytes in the store under their id, and audits the upload', async () => {
    const before = await rows();
    const photo = await upload(scene, scene.admin, scene.north, {
      bytes: bytesOf('image/png'),
      type: 'image/png',
      name: 'Absences 7B.png',
    });
    expect(photo.status).toBe(200);
    const file = assistantFileSchema.parse(photo.body);
    expect(file).toMatchObject({ kind: 'attachment', name: 'Absences 7B.png', size: 64 });
    expect(await store.get(`assistant/${file.id}`)).toEqual(bytesOf('image/png'));
    const voice = await upload(scene, scene.admin, scene.north, {
      bytes: bytesOf('audio/webm'),
      type: 'audio/webm',
      kind: 'voice',
      name: 'question.webm',
    });
    expect(voice.status).toBe(200);
    const after = await rows();
    expect(after.files.length).toBe(before.files.length + 2);
    const entry = await scene.database.migrator
      .selectFrom('audit_log')
      .select(['action', 'record_id', 'new_value', 'branch_id'])
      .where('record_id', '=', file.id)
      .executeTakeFirstOrThrow();
    expect(entry).toMatchObject({
      action: 'assistant_file.upload',
      branch_id: scene.north,
      new_value: { kind: 'attachment', mediaType: 'image/png', size: 64 },
    });
  });

  it('refuses a type not listed, a type of the other kind, bytes of another type, and each size over its limit', async () => {
    const before = await rows();
    const refused = async (
      file: Parameters<typeof upload>[3],
      status: number,
      code: string,
    ): Promise<void> => {
      const response = await upload(scene, scene.admin, scene.north, file);
      expect(response.status).toBe(status);
      expect(errorCode(response)).toBe(code);
    };
    // Not a type of the route: refused before it is read.
    await refused({ bytes: Buffer.from('a,b'), type: 'text/csv' }, 415, 'unsupported_media_type');
    // A recording sent as an attachment, a photo as a recording.
    await refused(
      { bytes: bytesOf('audio/webm'), type: 'audio/webm' },
      415,
      'unsupported_media_type',
    );
    await refused(
      { bytes: bytesOf('image/png'), type: 'image/png', kind: 'voice' },
      415,
      'unsupported_media_type',
    );
    // A PDF named a photo.
    await refused(
      { bytes: bytesOf('application/pdf'), type: 'image/png' },
      415,
      'unsupported_media_type',
    );
    // 10 MB and one byte: refused before the guard, with the route's own code.
    await refused(
      {
        bytes: bytesOf('application/pdf', ASSISTANT_UPLOAD_MAX_BYTES + 1),
        type: 'application/pdf',
      },
      413,
      'assistant_file_too_large',
    );
    // An Excel file and a recording over 5 MB, refused by the handler.
    const excel = Buffer.alloc(STUDENT_IMPORT_MAX_BYTES + 1, 0x20);
    Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(excel);
    Buffer.from('xl/', 'latin1').copy(excel, 30);
    await refused({ bytes: excel, type: ASSISTANT_EXCEL_TYPE }, 413, 'assistant_file_too_large');
    await refused(
      { bytes: bytesOf('audio/webm', 5_000_001), type: 'audio/webm', kind: 'voice' },
      413,
      'assistant_file_too_large',
    );
    // At the limit: taken.
    const pdf = await upload(scene, scene.admin, scene.north, {
      bytes: bytesOf('application/pdf', ASSISTANT_UPLOAD_MAX_BYTES),
      type: 'application/pdf',
    });
    expect(pdf.status).toBe(200);
    const after = await rows();
    expect(after.files.length).toBe(before.files.length + 1);
  });

  it('refuses a role not held, and the assistant switched off for the role', async () => {
    const response = await upload(
      scene,
      teacher,
      scene.north,
      { bytes: bytesOf('image/png'), type: 'image/png' },
      'academic_vice_principal',
    );
    expect(response.status).toBe(403);
    expect(errorCode(response)).toBe('assistant_role_not_held');
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ roles_on: ['super_admin'] })
      .execute();
    const off = await upload(
      scene,
      teacher,
      scene.north,
      { bytes: bytesOf('image/png'), type: 'image/png' },
      'teacher',
    );
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ roles_on: ['super_admin', 'teacher'] })
      .execute();
    expect(off.status).toBe(409);
    expect(errorCode(off)).toBe('assistant_off');
  });

  it('sends files with a question and links them to it; the person downloads them from the own conversation', async () => {
    const photo = assistantFileSchema.parse(
      (
        await upload(scene, scene.admin, scene.north, {
          bytes: bytesOf('image/png'),
          type: 'image/png',
          name: 'Days off.png',
        })
      ).body,
    );
    scene.model.script();
    const answered = await ask(scene, scene.admin, scene.north, {
      text: 'Read this list.',
      files: [photo.id],
    });
    expect(answered.status).toBe(202);
    const conversation = assistantConversationSchema.parse(answered.body.conversation);
    const question = conversation.messages.find((message) => message.kind === 'question');
    expect(question?.kind === 'question' ? question.files : []).toEqual([
      { id: photo.id, kind: 'attachment', name: 'Days off.png', mediaType: 'image/png', size: 64 },
    ]);
    // The model was given the photo itself with the question.
    const sent = scene.model.requests.at(-1)?.turns.at(-1)?.parts ?? [];
    expect(sent).toContainEqual({
      kind: 'file',
      mediaType: 'image/png',
      data: bytesOf('image/png').toString('base64'),
    });
    const download = await read(scene, scene.admin, `/api/assistant/files/${photo.id}`, scene.north)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          done(null, Buffer.concat(chunks));
        });
      });
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('image/png');
    expect(download.body).toEqual(bytesOf('image/png'));
  });

  it('answers 404 for a file of another account, another branch, an unknown id, a role given up and an archived conversation', async () => {
    const own = await stored({ branch: scene.north, account: scene.adminAccount });
    const others = await stored({ branch: scene.north, account: otherAccount });
    // The Teacher's own conversation in the South branch, where the Teacher holds no role now.
    const givenUp = await stored({ branch: scene.south, account: teacherAccount, role: 'teacher' });
    const teachers = await stored({
      branch: scene.north,
      account: teacherAccount,
      role: 'teacher',
    });
    const archived = await stored({
      branch: scene.north,
      account: scene.adminAccount,
      at: new Date(NOW.getTime() - 91 * DAY),
    });
    const before = await rows();
    const status = async (cookie: string, id: string) =>
      (await read(scene, cookie, `/api/assistant/files/${id}`, scene.north)).status;
    expect(await status(scene.admin, own.file)).toBe(200);
    expect(await status(teacher, teachers.file)).toBe(200);
    expect(await status(scene.admin, others.file)).toBe(404);
    expect(await status(other, own.file)).toBe(404);
    // A Teacher never reads another account's file (the scope line of the Teacher).
    expect(await status(teacher, own.file)).toBe(404);
    expect(await status(teacher, others.file)).toBe(404);
    expect(await status(teacher, givenUp.file)).toBe(404);
    expect(await status(scene.admin, UNKNOWN)).toBe(404);
    expect(await status(scene.admin, archived.file)).toBe(404);
    // The Super Admin reading another person's conversation sees it named, never through this
    // route (correction 3: the route of every conversation).
    const after = await rows();
    expect(after).toEqual(before);
  });

  it('lets the Super Admin download a file of any conversation, audited, and answers 404 for a file of another conversation and an unknown one', async () => {
    const teachers = await stored({
      branch: scene.north,
      account: teacherAccount,
      role: 'teacher',
    });
    const another = await stored({ branch: scene.south, account: scene.adminAccount });
    const archived = await stored({
      branch: scene.north,
      account: teacherAccount,
      role: 'teacher',
      at: new Date(NOW.getTime() - 120 * DAY),
    });
    const get = (conversation: string, file: string) =>
      request(server())
        .get(`/api/assistant/all-conversations/${conversation}/files/${file}`)
        .set('Cookie', other);
    expect((await get(teachers.conversation, teachers.file)).status).toBe(200);
    expect((await get(archived.conversation, archived.file)).status).toBe(200);
    const entry = await scene.database.migrator
      .selectFrom('audit_log')
      .select(['action', 'actor_id', 'branch_id', 'new_value'])
      .where('record_id', '=', teachers.file)
      .executeTakeFirstOrThrow();
    expect(entry).toMatchObject({
      action: 'assistant_file.download',
      actor_id: otherAccount,
      branch_id: scene.north,
      new_value: { conversationId: teachers.conversation },
    });
    const before = await rows();
    expect((await get(teachers.conversation, another.file)).status).toBe(404);
    expect((await get(teachers.conversation, UNKNOWN)).status).toBe(404);
    expect((await get(UNKNOWN, teachers.file)).status).toBe(404);
    expect(await rows()).toEqual(before);
  });

  it('refuses a question with a file of another branch, another account, one already sent, an old one and an unknown one (404): nothing stored', async () => {
    const southPhoto = assistantFileSchema.parse(
      (
        await upload(scene, scene.admin, scene.south, {
          bytes: bytesOf('image/png'),
          type: 'image/png',
        })
      ).body,
    );
    const othersPhoto = assistantFileSchema.parse(
      (await upload(scene, other, scene.north, { bytes: bytesOf('image/png'), type: 'image/png' }))
        .body,
    );
    const voice = assistantFileSchema.parse(
      (
        await upload(scene, scene.admin, scene.north, {
          bytes: bytesOf('audio/webm'),
          type: 'audio/webm',
          kind: 'voice',
        })
      ).body,
    );
    const photo = assistantFileSchema.parse(
      (
        await upload(scene, scene.admin, scene.north, {
          bytes: bytesOf('image/png'),
          type: 'image/png',
        })
      ).body,
    );
    // Uploaded 24 hours ago and more: it cannot be sent (plan decision 9).
    const old = assistantFileSchema.parse(
      (
        await upload(scene, scene.admin, scene.north, {
          bytes: bytesOf('image/png'),
          type: 'image/png',
        })
      ).body,
    );
    await sql`update assistant_files set created_at = created_at - interval '24 hours' where id = ${old.id}`.execute(
      scene.database.migrator,
    );
    scene.model.script();
    const sentOnce = await ask(scene, scene.admin, scene.north, {
      text: 'First.',
      files: [photo.id],
    });
    expect(sentOnce.status).toBe(202);
    const before = await rows();
    const refused = async (body: { files?: string[]; voice?: string; text?: string }) => {
      const response = await send(scene, scene.admin, scene.north, { text: 'Read it.', ...body });
      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe('assistant_file_not_found');
    };
    await refused({ files: [southPhoto.id] });
    await refused({ files: [othersPhoto.id] });
    await refused({ files: [photo.id] });
    await refused({ files: [old.id] });
    await refused({ files: [UNKNOWN] });
    await refused({ voice: UNKNOWN, text: '' });
    // A recording sent as an attachment, an attachment as a recording.
    await refused({ files: [voice.id] });
    await refused({ voice: photo.id });
    expect(await rows()).toEqual(before);
  });

  it('refuses a sixth file, files over 14 MB together, and a question without words or a recording', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      ids.push(
        assistantFileSchema.parse(
          (
            await upload(scene, scene.admin, scene.north, {
              bytes: bytesOf('image/png'),
              type: 'image/png',
            })
          ).body,
        ).id,
      );
    }
    const before = await rows();
    const sixth = await send(scene, scene.admin, scene.north, { text: 'All six.', files: ids });
    expect(sixth.status).toBe(400);
    const empty = await send(scene, scene.admin, scene.north, { text: '' });
    expect(empty.status).toBe(400);
    const big = [];
    for (let index = 0; index < 2; index += 1) {
      big.push(
        assistantFileSchema.parse(
          (
            await upload(scene, scene.admin, scene.north, {
              bytes: bytesOf('application/pdf', 7_000_001),
              type: 'application/pdf',
            })
          ).body,
        ).id,
      );
    }
    const middle = await rows();
    const tooLarge = await send(scene, scene.admin, scene.north, { text: 'Both.', files: big });
    expect(tooLarge.status).toBe(413);
    expect(errorCode(tooLarge)).toBe('assistant_files_too_large');
    expect((await rows()).messages).toEqual(middle.messages);
    expect(before.messages).toEqual(middle.messages);
  });

  it('names the store in the status of the panel', async () => {
    const status = await request(server())
      .get('/api/assistant/status?role=super_admin')
      .set('Cookie', scene.admin)
      .set(BRANCH_HEADER, scene.north);
    expect(status.body).toMatchObject({ files: true });
  });
});

describe('the assistant without a store of files', () => {
  let scene: AssistantScene;

  beforeAll(async () => {
    scene = await assistantScene();
  }, 120_000);

  afterAll(async () => {
    await scene.close();
  });

  it('refuses an upload with assistant_files_not_configured and says so in the status', async () => {
    const response = await upload(scene, scene.admin, scene.north, {
      bytes: bytesOf('image/png'),
      type: 'image/png',
    });
    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe('assistant_files_not_configured');
    expect(
      await scene.database.migrator.selectFrom('assistant_files').selectAll().execute(),
    ).toEqual([]);
    const status = await read(
      scene,
      scene.admin,
      '/api/assistant/status?role=super_admin',
      scene.north,
    );
    expect(status.body).toMatchObject({ files: false });
  });
});
