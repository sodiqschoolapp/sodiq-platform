import {
  BRANCH_HEADER,
  assistantAnswerSchema,
  assistantConversationSchema,
  type AssistantConversation,
  type AssistantRole,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { answer, calls } from '../../testing/assistant-model.js';
import { ask, assistantScene, type AssistantScene } from '../../testing/assistant-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { createdIdOf } from './assistant-proposals.service.js';
import { reverseOf } from './reverses.js';
import { GENERATED_TOOLS } from './tools.generated.js';

// Task 11.21 (pull request #388). `02`, Assistant, Reading and proposing: "A confirmed proposal
// can be undone: the assistant proposes the reverse of each change made, where an action exists
// that reverses it, and that new proposal is confirmed like any other." Plan decisions 9 to 11:
// built by the server from the stored steps, newest first, with no call of the model. All names
// are invented.

const tool = (route: string): string => GENERATED_TOOLS[route]?.name ?? '';
const CLASS_ARCHIVE = `propose_${tool('POST /api/classes/:id/archive')}`.slice(0, 64);
const ROOM_EDIT = `propose_${tool('PUT /api/setup/rooms/:id')}`.slice(0, 64);
const UNKNOWN = '0199a3c4-0000-7000-8000-00000000abcd';

describe('Undo of a confirmed proposal', () => {
  let scene: AssistantScene;

  beforeAll(async () => {
    scene = await assistantScene();
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({
        school_on: true,
        roles_on: ['super_admin', 'academic_vice_principal'],
        daily_limit: 0,
      })
      .execute();
  });

  afterAll(async () => {
    await scene.close();
  });

  beforeEach(async () => {
    scene.model.script();
    await sql`delete from assistant_action_switches`.execute(scene.database.migrator);
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ proposal_steps: 100, daily_limit: 0, monthly_cap_dollars: 300 })
      .execute();
  });

  const server = () => scene.app.getHttpServer() as Parameters<typeof request>[0];

  const post = (
    which: 'confirm' | 'decline' | 'undo',
    id: string,
    cookie = scene.admin,
    branch = scene.north,
    role: AssistantRole = 'super_admin',
  ) =>
    request(server())
      .post(`/api/assistant/proposals/${id}/${which}`)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .send({ role });

  const classes = async (...names: string[]) => {
    const ids: string[] = [];
    for (const name of names) {
      ids.push(await scene.people.schoolClass(scene.north, scene.northYear, { name }));
    }
    return ids;
  };

  const archive = (id: string) => ({
    name: CLASS_ARCHIVE,
    args: { id, summary: `Archive the class ${id.slice(-4)}.` },
  });

  /** One proposal of the steps given, in a new conversation or the one named. */
  async function propose(
    wanted: { name: string; args: Record<string, unknown> }[],
    cookie = scene.admin,
    role: AssistantRole = 'super_admin',
  ): Promise<{ proposalId: string; conversationId: string }> {
    scene.model.script(calls(...wanted), answer('Proposed.'));
    const response = await ask(scene, cookie, scene.north, { text: 'Archive them.', role });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(202);
    const conversation = (
      response.body as { conversation: { id: string; proposals: { id: string }[] } }
    ).conversation;
    const proposal = conversation.proposals.at(-1);
    expect(proposal, JSON.stringify(response.body).slice(0, 600)).toBeDefined();
    return { proposalId: proposal?.id ?? '', conversationId: conversation.id };
  }

  const status = async (id: string) =>
    (
      await scene.database.migrator
        .selectFrom('classes')
        .select('archived_at')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).archived_at === null
      ? 'active'
      : 'archived';

  const undone = (response: { status: number; body: unknown }): AssistantConversation => {
    expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(200);
    return assistantAnswerSchema.parse(response.body).conversation;
  };

  /** Every row of the tables an Undo writes, and of its targets, in both branches. */
  const rows = async () => ({
    messages: await scene.database.migrator
      .selectFrom('assistant_messages')
      .selectAll()
      .orderBy('id')
      .execute(),
    proposals: await scene.database.migrator
      .selectFrom('assistant_proposals')
      .selectAll()
      .orderBy('id')
      .execute(),
    classes: await scene.database.migrator
      .selectFrom('classes')
      .selectAll()
      .orderBy('id')
      .execute(),
    steps: await scene.database.migrator
      .selectFrom('assistant_proposal_steps')
      .selectAll()
      .orderBy('step_id')
      .execute(),
    decisions: await scene.database.migrator
      .selectFrom('assistant_proposal_decisions')
      .selectAll()
      .orderBy('proposal_id')
      .execute(),
    audit: await scene.database.migrator
      .selectFrom('audit_log')
      .selectAll()
      .orderBy('id')
      .execute(),
  });

  it('proposes the reverses of a confirmed proposal of three changes, newest first, and Confirm restores the three (build plan 11.21, Done when)', async () => {
    const [a, b, c] = await classes('Oxford U1', 'Oxford U2', 'Oxford U3');
    const ids = [a ?? '', b ?? '', c ?? ''];
    const { proposalId } = await propose(ids.map(archive));
    const confirmed = await post('confirm', proposalId);
    expect(confirmed.status).toBe(200);
    for (const id of ids) expect(await status(id)).toBe('archived');
    const modelCalls = scene.model.requests.length;

    const conversation = undone(await post('undo', proposalId));
    // No call of the model (plan decision 9).
    expect(scene.model.requests.length).toBe(modelCalls);
    const question = conversation.messages.at(-2);
    const reply = conversation.messages.at(-1);
    expect(question).toEqual(expect.objectContaining({ kind: 'question', undoOf: proposalId }));
    expect(reply).toEqual(
      expect.objectContaining({ kind: 'answer', undo: { proposalId, none: [] } }),
    );
    const reverses = conversation.proposals.at(-1);
    expect(reverses?.state).toBe('waiting');
    expect(reverses?.steps.map((step) => [step.seq, step.action])).toEqual([
      [1, tool('POST /api/classes/:id/restore')],
      [2, tool('POST /api/classes/:id/restore')],
      [3, tool('POST /api/classes/:id/restore')],
    ]);
    // The last change undone first (plan decision 11): the stored steps name the classes so.
    const stored = await scene.database.migrator
      .selectFrom('assistant_proposals')
      .select('steps')
      .where('id', '=', reverses?.id ?? '')
      .executeTakeFirstOrThrow();
    expect((stored.steps as { url: string }[]).map((step) => step.url)).toEqual([
      `/api/classes/${ids[2] ?? ''}/restore`,
      `/api/classes/${ids[1] ?? ''}/restore`,
      `/api/classes/${ids[0] ?? ''}/restore`,
    ]);
    // A second Undo while the first still waits.
    expect(errorCode(await post('undo', proposalId))).toBe('assistant_undo_exists');
    expect((await post('confirm', reverses?.id ?? '')).status).toBe(200);
    for (const id of ids) expect(await status(id)).toBe('active');
    // A second Undo of the same proposal: its Undo was confirmed.
    expect(errorCode(await post('undo', proposalId))).toBe('assistant_undo_exists');
  });

  it('reverses only the change made when the second of three was refused (review of the plan, should fix 2)', async () => {
    const [a, b, c] = await classes('Oxford P1', 'Oxford P2', 'Oxford P3');
    const { proposalId } = await propose([a ?? '', b ?? '', c ?? ''].map(archive));
    // The second class changes after the proposal: its step is outdated, the third not run.
    await scene.database.migrator
      .updateTable('classes')
      .set({ name: 'Oxford P2 renamed' })
      .where('id', '=', b ?? '')
      .execute();
    const confirmed = assistantConversationSchema.parse((await post('confirm', proposalId)).body);
    expect(confirmed.proposals.at(-1)?.steps.map((step) => step.state)).toEqual([
      'done',
      'outdated',
      'not_run',
    ]);
    const conversation = undone(await post('undo', proposalId));
    const stored = await scene.database.migrator
      .selectFrom('assistant_proposals')
      .select('steps')
      .where('id', '=', conversation.proposals.at(-1)?.id ?? '')
      .executeTakeFirstOrThrow();
    expect((stored.steps as { url: string }[]).map((step) => step.url)).toEqual([
      `/api/classes/${a ?? ''}/restore`,
    ]);
  });

  it('names a change with no reverse, a reverse switched off and one over the step limit, each with its reason', async () => {
    const [a, b, c] = await classes('Oxford N1', 'Oxford N2', 'Oxford N3');
    const roomId = await scene.people.room(scene.north);
    const floor = await scene.database.migrator
      .selectFrom('rooms')
      .select('floor_id')
      .where('id', '=', roomId)
      .executeTakeFirstOrThrow();
    const rename = {
      name: ROOM_EDIT,
      args: {
        id: roomId,
        body: {
          name: 'Room N',
          floorId: floor.floor_id,
          type: 'classroom',
          capacity: 28,
          status: 'in_use',
          shared: false,
          maxSimultaneousLessons: null,
        },
        summary: 'Rename the room.',
      },
    };
    const { proposalId } = await propose([
      rename,
      archive(a ?? ''),
      archive(b ?? ''),
      archive(c ?? ''),
    ]);
    expect((await post('confirm', proposalId)).status).toBe(200);
    // At most two changes in one proposal now.
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ proposal_steps: 2 })
      .execute();
    const conversation = undone(await post('undo', proposalId));
    const reply = conversation.messages.at(-1);
    expect(reply?.kind === 'answer' ? reply.undo?.none : undefined).toEqual([
      expect.objectContaining({ seq: 2, reason: 'over_step_limit' }),
      expect.objectContaining({
        seq: 1,
        action: tool('PUT /api/setup/rooms/:id'),
        reason: 'over_step_limit',
      }),
    ]);
    expect(conversation.proposals.at(-1)?.steps).toHaveLength(2);
    // Declined: a new Undo may be asked. With room for every step, the edit of fields has no
    // reverse (plan decision 10) and the restore of classes is switched off.
    expect((await post('decline', conversation.proposals.at(-1)?.id ?? '')).status).toBe(200);
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ proposal_steps: 100 })
      .execute();
    await scene.database.migrator
      .insertInto('assistant_action_switches')
      .values({
        role: 'super_admin',
        route: 'POST /api/classes/:id/restore',
        is_on: false,
        changed_at: scene.clock.now(),
        changed_by: scene.adminAccount,
      })
      .execute();
    const again = undone(await post('undo', proposalId));
    const none = again.messages.at(-1);
    expect(
      none?.kind === 'answer' ? none.undo?.none.map((one) => [one.seq, one.reason]) : [],
    ).toEqual([
      [4, 'action_off'],
      [3, 'action_off'],
      [2, 'action_off'],
      [1, 'no_reverse'],
    ]);
    // Nothing to propose: no proposal is stored for it.
    expect(again.proposals.at(-1)?.questionId).not.toBe(again.messages.at(-2)?.id);
    // An Undo that proposed nothing does not block a later one (once the action is on again).
    await sql`delete from assistant_action_switches`.execute(scene.database.migrator);
    const later = undone(await post('undo', proposalId));
    expect(later.proposals.at(-1)?.steps).toHaveLength(3);
  });

  it('refuses an Undo of a proposal waiting, declined or with nothing done', async () => {
    const [a, b] = await classes('Oxford R1', 'Oxford R2');
    const waiting = await propose([archive(a ?? '')]);
    expect(errorCode(await post('undo', waiting.proposalId))).toBe('assistant_undo_not_open');
    expect((await post('decline', waiting.proposalId)).status).toBe(200);
    expect(errorCode(await post('undo', waiting.proposalId))).toBe('assistant_undo_not_open');
    // An expired proposal was never confirmed: nothing to undo.
    const [c] = await classes('Oxford R3');
    const expired = await propose([archive(c ?? '')]);
    await sql`update assistant_proposals set created_at = created_at - interval '1 hour', expires_at = expires_at - interval '1 hour' where id = ${expired.proposalId}`.execute(
      scene.database.migrator,
    );
    expect(errorCode(await post('undo', expired.proposalId))).toBe('assistant_undo_not_open');
    const outdated = await propose([archive(b ?? '')]);
    await scene.database.migrator
      .updateTable('classes')
      .set({ name: 'Oxford R2 renamed' })
      .where('id', '=', b ?? '')
      .execute();
    expect((await post('confirm', outdated.proposalId)).status).toBe(200);
    expect(errorCode(await post('undo', outdated.proposalId))).toBe('assistant_undo_not_open');
  });

  it('reaches each refusal of the route with every earlier check passing: the role not held, another role, the assistant off, a question running, an archived conversation (permission review 2)', async () => {
    // A person with the Academic Vice Principal's and the Super Admin's roles.
    const browser = await scene.kit.completeSession('Feruza', 'Nazarova');
    const vice = await scene.kit.giveRole(browser.account.id, {
      role: 'academic_vice_principal',
      branchId: scene.north,
    });
    await scene.kit.giveRole(browser.account.id, { role: 'super_admin' });
    const [a, b] = await classes('Oxford X1', 'Oxford X2');
    const asVice = await propose([archive(a ?? '')], browser.cookie, 'academic_vice_principal');
    expect(
      (
        await post(
          'confirm',
          asVice.proposalId,
          browser.cookie,
          scene.north,
          'academic_vice_principal',
        )
      ).status,
    ).toBe(200);
    const before = await rows();
    // Another role than the proposal's, held: 409.
    expect(
      errorCode(await post('undo', asVice.proposalId, browser.cookie, scene.north, 'super_admin')),
    ).toBe('assistant_conversation_other_role');
    // The assistant switched off for the role: 409.
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ roles_on: ['super_admin'] })
      .execute();
    expect(
      errorCode(
        await post(
          'undo',
          asVice.proposalId,
          browser.cookie,
          scene.north,
          'academic_vice_principal',
        ),
      ),
    ).toBe('assistant_off');
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ roles_on: ['super_admin', 'academic_vice_principal'] })
      .execute();
    // A question of the person still being answered: 409.
    const running = await scene.database.migrator
      .insertInto('assistant_messages')
      .values({
        conversation_id: asVice.conversationId,
        branch_id: scene.north,
        account_id: browser.account.id,
        seq: 100,
        kind: 'question',
        content: sql`'{"kind":"question","text":"Still running."}'::jsonb`,
        created_at: scene.clock.now(),
        answer_until: new Date(scene.clock.now().getTime() + 60_000),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    expect(
      errorCode(
        await post(
          'undo',
          asVice.proposalId,
          browser.cookie,
          scene.north,
          'academic_vice_principal',
        ),
      ),
    ).toBe('assistant_question_running');
    await sql`delete from assistant_messages where id = ${running.id}`.execute(
      scene.database.migrator,
    );
    // The chosen role no longer held, the guard letting the person in through the Super Admin.
    await scene.database.migrator
      .updateTable('assignments')
      .set({
        valid_from: new Date('2026-11-20T08:00:00+05:00'),
        valid_until: new Date('2026-11-20T09:00:00+05:00'),
      })
      .where('id', '=', vice.id)
      .execute();
    expect(
      errorCode(
        await post(
          'undo',
          asVice.proposalId,
          browser.cookie,
          scene.north,
          'academic_vice_principal',
        ),
      ),
    ).toBe('assistant_role_not_held');
    expect(await rows()).toEqual(before);
    // An archived conversation (90 days after its last message): 404.
    const own = await propose([archive(b ?? '')]);
    expect((await post('confirm', own.proposalId)).status).toBe(200);
    const old = new Date(scene.clock.now().getTime() - 100 * 24 * 60 * 60 * 1000);
    await sql`update assistant_conversations set created_at = ${old} where id = ${own.conversationId}`.execute(
      scene.database.migrator,
    );
    await sql`update assistant_messages set created_at = ${old} where conversation_id = ${own.conversationId}`.execute(
      scene.database.migrator,
    );
    const archivedBefore = await rows();
    expect((await post('undo', own.proposalId)).status).toBe(404);
    expect(await rows()).toEqual(archivedBefore);
  });

  it('works when the cap is reached and is not counted in the daily limit: no call of the model (plan decision 9)', async () => {
    const [a] = await classes('Oxford C1');
    const { proposalId } = await propose([archive(a ?? '')]);
    expect((await post('confirm', proposalId)).status).toBe(200);
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ daily_limit: 1, monthly_cap_dollars: 1 })
      .execute();
    await sql`
      insert into assistant_model_calls (message_id, branch_id, model, tokens_in, tokens_out, cost_micros, processed_in, created_at)
      select m.id, m.branch_id, 'fake-model', 0, 0, 5000000, 'europe-west3', ${scene.clock.now()}
      from assistant_messages m where m.kind = 'question' limit 1
    `.execute(scene.database.migrator);
    const status = async () =>
      (
        await request(server())
          .get('/api/assistant/status?role=super_admin')
          .set('Cookie', scene.admin)
          .set(BRANCH_HEADER, scene.north)
      ).body as { questionsLeftToday: number | null };
    const limit = (daily: number) =>
      scene.database.migrator
        .updateTable('assistant_settings')
        .set({ daily_limit: daily })
        .execute();
    await limit(100);
    const left = (await status()).questionsLeftToday;
    await limit(1);
    const conversation = undone(await post('undo', proposalId));
    expect(conversation.proposals.at(-1)?.steps).toHaveLength(1);
    // The Undo is stored as a question, and the count of the day leaves it out (0184).
    await limit(100);
    expect(left).not.toBeNull();
    expect((await status()).questionsLeftToday).toBe(left);
    await sql`delete from assistant_model_calls where cost_micros = 5000000`.execute(
      scene.database.migrator,
    );
  });

  it('answers 404 for an unknown proposal, another person’s and the own one in another branch, with every row unchanged', async () => {
    const browser = await scene.kit.completeSession('Zarina', 'Qodirova');
    await scene.kit.giveRole(browser.account.id, {
      role: 'academic_vice_principal',
      branchId: scene.north,
    });
    const [a, b] = await classes('Oxford F1', 'Oxford F2');
    const theirs = await propose([archive(a ?? '')], browser.cookie, 'academic_vice_principal');
    expect(
      (
        await post(
          'confirm',
          theirs.proposalId,
          browser.cookie,
          scene.north,
          'academic_vice_principal',
        )
      ).status,
    ).toBe(200);
    const own = await propose([archive(b ?? '')]);
    expect((await post('confirm', own.proposalId)).status).toBe(200);
    const before = await rows();
    expect((await post('undo', UNKNOWN)).status).toBe(404);
    expect((await post('undo', theirs.proposalId)).status).toBe(404);
    expect((await post('undo', own.proposalId, scene.admin, scene.south)).status).toBe(404);
    expect(await rows()).toEqual(before);
  });

  it('keeps the id a done create answered, and builds the reverse of a create from it', () => {
    const id = '0199a3c4-0000-7000-8000-0000000000aa';
    expect(createdIdOf({ id, name: 'Day off' })).toBe(id);
    expect(createdIdOf({ id: 'not-a-uuid' })).toBeNull();
    expect(createdIdOf([{ id }])).toBeNull();
    // An exam's save answers { exam, warnings }: its reverse names where the id is.
    expect(createdIdOf({ exam: { id }, warnings: [] }, ['exam', 'id'])).toBe(id);
    expect(createdIdOf({ exam: { id }, warnings: [] })).toBeNull();
    const made = reverseOf(
      { route: 'POST /api/timetable/absences', url: '/api/timetable/absences', body: {} },
      id,
    );
    expect(made).toEqual(
      expect.objectContaining({
        pathArgs: { id },
        reverse: expect.objectContaining({
          route: 'POST /api/timetable/absences/:id/withdraw',
        }) as unknown,
      }),
    );
    expect(
      reverseOf(
        { route: 'POST /api/timetable/absences', url: '/api/timetable/absences', body: {} },
        null,
      ),
    ).toEqual({ reason: 'no_record' });
    expect(
      reverseOf(
        {
          route: 'POST /api/timetable/lessons/:id/substitute',
          url: `/api/timetable/lessons/${id}/substitute`,
          body: { teacherId: id, reason: 'Ill.' },
        },
        null,
      ),
    ).toEqual(expect.objectContaining({ pathArgs: { id }, body: { reason: 'Ill.' } }));
    expect(
      reverseOf(
        { route: 'PUT /api/setup/rooms/:id', url: `/api/setup/rooms/${id}`, body: {} },
        null,
      ),
    ).toEqual({ reason: 'no_reverse' });
  });
});
