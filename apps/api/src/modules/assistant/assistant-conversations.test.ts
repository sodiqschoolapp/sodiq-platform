import {
  BRANCH_HEADER,
  assistantAllConversationsSchema,
  assistantAnyConversationDetailSchema,
  assistantConversationListSchema,
  assistantConversationSchema,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { ask, assistantScene, read, type AssistantScene } from '../../testing/assistant-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

// Task 11.12. `02`, Assistant, Audit: "The person sees their own conversations; the Super Admin
// sees all of them. 90 days after its last message a conversation is archived: it leaves the
// person's list, and the Super Admin reads it and can restore it. Conversations are never
// deleted." `edge/people-roles-accounts`, The assistant: "A conversation from September is needed
// in January". Plan decision 8: archived when the last message or restore and 90 days are not
// after now, read from stored moments. Names are invented.

const NOW = new Date('2026-11-20T10:00:00+05:00');
const DAY = 24 * 60 * 60 * 1000;
const UNKNOWN = '0199a000-0000-7000-8000-000000000999';

describe('the assistant: conversations, archive and restore', () => {
  let scene: AssistantScene;
  let other: string;
  let otherAccount: string;
  let teacher: string;

  /** A conversation written by the migrator, with one question at `at`. */
  async function conversation(input: {
    branch: string;
    account: string;
    at: Date;
    role?: 'super_admin' | 'teacher';
    title?: string;
  }): Promise<string> {
    const row = await scene.database.migrator
      .insertInto('assistant_conversations')
      .values({
        branch_id: input.branch,
        account_id: input.account,
        role: input.role ?? 'super_admin',
        title: input.title ?? 'Written earlier.',
        created_at: input.at,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await scene.database.migrator
      .insertInto('assistant_messages')
      .values({
        conversation_id: row.id,
        branch_id: input.branch,
        account_id: input.account,
        seq: 1,
        kind: 'question',
        content: sql`'{"kind":"question","text":"Earlier."}'::jsonb`,
        created_at: input.at,
      })
      .execute();
    return row.id;
  }

  const ago = (days: number, ms = 0) => new Date(NOW.getTime() - days * DAY + ms);

  const own = async (cookie = scene.admin) =>
    assistantConversationListSchema
      .parse((await read(scene, cookie, '/api/assistant/conversations', scene.north)).body)
      .conversations.map((one) => one.id);

  const all = async (archived?: 'true' | 'false') =>
    assistantAllConversationsSchema.parse(
      (
        await read(
          scene,
          scene.admin,
          `/api/assistant/all-conversations${archived === undefined ? '' : `?archived=${archived}`}`,
        )
      ).body,
    ).conversations;

  const counts = async () => ({
    messages: (await scene.database.migrator.selectFrom('assistant_messages').selectAll().execute())
      .length,
    conversations: (
      await scene.database.migrator.selectFrom('assistant_conversations').selectAll().execute()
    ).length,
    calls: (await scene.database.migrator.selectFrom('assistant_model_calls').selectAll().execute())
      .length,
    audit: (
      await sql<{ n: number }>`select count(*)::int as n from audit_log`.execute(
        scene.database.migrator,
      )
    ).rows[0]?.n,
  });

  beforeAll(async () => {
    scene = await assistantScene();
    const browser = await scene.kit.completeSession('Sevara', 'Otherova');
    await scene.kit.giveRole(browser.account.id, { role: 'super_admin' });
    other = browser.cookie;
    otherAccount = browser.account.id;
    const teaching = await scene.kit.fullSession('Bekzod', 'Teacherov');
    await scene.kit.giveRole(teaching.account.id, { role: 'teacher', branchId: scene.north });
    teacher = teaching.cookie;
  }, 120_000);

  afterAll(async () => {
    await scene.close();
  });

  it('archives a conversation 90 days after its last message: at exactly 90 days, not 1 ms before', async () => {
    const exactly = await conversation({
      branch: scene.north,
      account: scene.adminAccount,
      at: ago(90),
    });
    const almost = await conversation({
      branch: scene.north,
      account: scene.adminAccount,
      at: ago(90, 1),
    });
    const list = await own();
    expect(list).not.toContain(exactly);
    expect(list).toContain(almost);
  });

  it('archives one of 91 days: gone from the person’s list and 404 to the person, listed as archived for the Super Admin, and restored (build plan 11.12, Done when)', async () => {
    const old = await conversation({
      branch: scene.north,
      account: scene.adminAccount,
      at: ago(91),
      title: 'From August.',
    });
    expect(await own()).not.toContain(old);
    expect(
      (await read(scene, scene.admin, `/api/assistant/conversations/${old}`, scene.north)).status,
    ).toBe(404);
    const continued = await ask(scene, scene.admin, scene.north, {
      text: 'More.',
      conversationId: old,
    });
    expect(continued.status).toBe(404);

    // Another Super Admin reads every conversation, archived ones too.
    const archived = (await all('true')).find((one) => one.id === old);
    expect(archived).toEqual(expect.objectContaining({ archived: true, title: 'From August.' }));
    expect((await all('false')).some((one) => one.id === old)).toBe(false);
    const detail = assistantAnyConversationDetailSchema.parse(
      (await read(scene, other, `/api/assistant/all-conversations/${old}`)).body,
    );
    expect(detail.messages.map((message) => message.kind)).toEqual(['question']);

    // Restored: back in the person's list, audited in the conversation's branch.
    const restored = await scene.kit
      .post(`/api/assistant/all-conversations/${old}/restore`, other)
      .send({});
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(assistantAnyConversationDetailSchema.parse(restored.body).archived).toBe(false);
    expect(await own()).toContain(old);
    const entry = await scene.database.migrator
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'assistant_conversation.restore')
      .where('record_id', '=', old)
      .executeTakeFirstOrThrow();
    expect(entry).toEqual(
      expect.objectContaining({
        branch_id: scene.north,
        actor_id: otherAccount,
        record_type: 'assistant_conversation',
      }),
    );
    // Archived again 90 days after the restore, with no new question.
    const back = await scene.database.migrator
      .selectFrom('assistant_conversation_restores')
      .selectAll()
      .where('conversation_id', '=', old)
      .executeTakeFirstOrThrow();
    expect(new Date(back.restored_at).getTime()).toBe(NOW.getTime());
    await scene.database.migrator
      .updateTable('assistant_conversation_restores')
      .set({ restored_at: ago(90) })
      .where('conversation_id', '=', old)
      .execute();
    expect(await own()).not.toContain(old);
    // Never deleted: every row is still there.
    expect(
      await scene.database.migrator
        .selectFrom('assistant_messages')
        .select('id')
        .where('conversation_id', '=', old)
        .execute(),
    ).toHaveLength(1);
  });

  it('answers 404 for an unknown conversation on the Super Admin’s read', async () => {
    expect((await read(scene, other, `/api/assistant/all-conversations/${UNKNOWN}`)).status).toBe(
      404,
    );
  });

  it('refuses a restore of a conversation that is not archived (409) and of an unknown one (404)', async () => {
    const recent = await conversation({
      branch: scene.south,
      account: scene.adminAccount,
      at: ago(1),
    });
    const response = await scene.kit
      .post(`/api/assistant/all-conversations/${recent}/restore`, other)
      .send({});
    expect([response.status, errorCode(response)]).toEqual([409, 'assistant_not_archived']);
    const unknown = await scene.kit
      .post(`/api/assistant/all-conversations/${UNKNOWN}/restore`, other)
      .send({});
    expect(unknown.status).toBe(404);
    expect(
      await scene.database.migrator
        .selectFrom('assistant_conversation_restores')
        .selectAll()
        .where('conversation_id', '=', recent)
        .execute(),
    ).toEqual([]);
    expect(
      await scene.database.migrator
        .selectFrom('audit_log')
        .select('id')
        .where('action', '=', 'assistant_conversation.restore')
        .where('record_id', 'in', [recent, UNKNOWN])
        .execute(),
    ).toEqual([]);
  });

  it('restores a conversation of South in South: the restore row and the audit entry name its branch', async () => {
    const southern = await conversation({
      branch: scene.south,
      account: scene.adminAccount,
      at: ago(95),
    });
    const restored = await scene.kit
      .post(`/api/assistant/all-conversations/${southern}/restore`, other)
      .send({});
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    const row = await scene.database.migrator
      .selectFrom('assistant_conversation_restores')
      .selectAll()
      .where('conversation_id', '=', southern)
      .executeTakeFirstOrThrow();
    expect(row.branch_id).toBe(scene.south);
    const entry = await scene.database.migrator
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'assistant_conversation.restore')
      .where('record_id', '=', southern)
      .executeTakeFirstOrThrow();
    expect(entry.branch_id).toBe(scene.south);
  });

  it('lists the person’s own conversations of every branch, and no other person’s (plan decision 9)', async () => {
    const north = await conversation({
      branch: scene.north,
      account: scene.adminAccount,
      at: ago(2),
    });
    const south = await conversation({
      branch: scene.south,
      account: scene.adminAccount,
      at: ago(2),
    });
    const theirs = await conversation({ branch: scene.north, account: otherAccount, at: ago(2) });
    const list = await own();
    expect(list).toEqual(expect.arrayContaining([north, south]));
    expect(list).not.toContain(theirs);
    // One of another branch is read; asking in it from this branch is refused as unknown.
    const southRead = assistantConversationSchema.parse(
      (await read(scene, scene.admin, `/api/assistant/conversations/${south}`, scene.north)).body,
    );
    expect(southRead.branchId).toBe(scene.south);
    expect(
      (await read(scene, scene.admin, `/api/assistant/conversations/${theirs}`, scene.north))
        .status,
    ).toBe(404);
    expect(
      (await read(scene, scene.admin, `/api/assistant/conversations/${UNKNOWN}`, scene.north))
        .status,
    ).toBe(404);
    // The Super Admin's list holds every one, with the person's name.
    const everything = await all();
    expect(everything.find((one) => one.id === theirs)?.personName).toBe('s.otherova');
  });

  it('refuses a question on a conversation of another branch, of another person and an unknown one (404): nothing stored, nothing counted', async () => {
    const south = await conversation({
      branch: scene.south,
      account: scene.adminAccount,
      at: ago(1),
    });
    const theirs = await conversation({ branch: scene.north, account: otherAccount, at: ago(1) });
    for (const id of [south, theirs, UNKNOWN]) {
      const before = await counts();
      const response = await scene.kit
        .post('/api/assistant/questions', scene.admin)
        .set(BRANCH_HEADER, scene.north)
        .send({ role: 'super_admin', text: 'Go on.', conversationId: id });
      expect([response.status, errorCode(response)], id).toEqual([404, 'not_found']);
      expect(await counts()).toEqual(before);
    }
  });

  it('refuses a role the person does not hold now (403 assistant_role_not_held), and the Teacher while the Teacher’s switch is off (409 assistant_off)', async () => {
    let response = await ask(scene, scene.admin, scene.north, {
      text: 'As the Academic Vice Principal.',
      role: 'academic_vice_principal',
    });
    expect([response.status, errorCode(response)]).toEqual([403, 'assistant_role_not_held']);
    // Task 11.14: the table gives the Teacher the panel; the switch of the Teacher's role is off
    // in this scene (`02`: "The Super Admin can switch it off … for one of the three roles").
    // A Super Admin who is also a Teacher, asking as the Teacher, and a Teacher alone.
    await scene.kit.giveRole(scene.adminAccount, { role: 'teacher', branchId: scene.north });
    response = await ask(scene, scene.admin, scene.north, {
      text: 'As the Teacher.',
      role: 'teacher',
    });
    expect([response.status, errorCode(response)]).toEqual([409, 'assistant_off']);
    // The status says so, for the panel (code review should fix 6).
    const status = await read(
      scene,
      scene.admin,
      '/api/assistant/status?role=teacher',
      scene.north,
    );
    expect([status.status, (status.body as { refusal?: string }).refusal]).toEqual([
      200,
      'assistant_off',
    ]);
    response = await ask(scene, teacher, scene.north, { text: 'Me too.', role: 'teacher' });
    expect([response.status, errorCode(response)]).toEqual([409, 'assistant_off']);
  });

  it('refuses a question in a conversation started in another role (409)', async () => {
    const asTeacher = await conversation({
      branch: scene.north,
      account: scene.adminAccount,
      at: ago(1),
      role: 'teacher',
    });
    const response = await ask(scene, scene.admin, scene.north, {
      text: 'Go on.',
      conversationId: asTeacher,
    });
    expect([response.status, errorCode(response)]).toEqual([
      409,
      'assistant_conversation_other_role',
    ]);
  });

  it('never lets the application change or delete a conversation, a message, a model call or a restore (append-only)', async () => {
    const id = await conversation({ branch: scene.north, account: scene.adminAccount, at: ago(1) });
    const transactions = scene.app.get(Transactions);
    const tries = [
      sql`update assistant_conversations set title = 'x' where id = ${id}`,
      sql`delete from assistant_conversations where id = ${id}`,
      sql`update assistant_messages set content = '{}'::jsonb where conversation_id = ${id}`,
      sql`delete from assistant_messages where conversation_id = ${id}`,
      sql`update assistant_model_calls set cost_micros = 0`,
      sql`delete from assistant_model_calls`,
      sql`update assistant_conversation_restores set restored_at = now()`,
      sql`delete from assistant_conversation_restores`,
      sql`delete from assistant_settings`,
    ];
    for (const statement of tries) {
      await expect(
        transactions.run([scene.north], (transaction) => statement.execute(transaction)),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
