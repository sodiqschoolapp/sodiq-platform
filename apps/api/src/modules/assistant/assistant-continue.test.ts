import {
  BRANCH_HEADER,
  assistantConversationSchema,
  type AssistantConversation,
} from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { answer, calls, lastResults } from '../../testing/assistant-model.js';
import { ask, assistantScene, type AssistantScene } from '../../testing/assistant-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { ASK_CHOICE, choicesOf, LIMIT_REACHED_LINE, modelCallsOf } from './assistant.engine.js';
import { attemptsOf } from './model-caller.js';
import { GENERATED_TOOLS } from './tools.generated.js';

// Task 11.21 (pull request #388). `02`, Assistant, Answers: "A long piece of work goes on in
// parts: when one question's limit is reached, the answer says what is done and what is left,
// and offers Continue." `edge/people-roles-accounts`, "Cancel these 60 lessons" goes past the
// limit of one question: "It proposes what fits within the limits, says what is left, and offers
// Continue; the next part is a new proposal. Nothing is lost or proposed twice." Here the 60
// changes are 60 rooms renamed, one step each: the mechanism of the parts is the same for any
// change. All names are invented.

const ROOM_EDIT = `propose_${GENERATED_TOOLS['PUT /api/setup/rooms/:id']?.name ?? ''}`.slice(0, 64);
const CLASSES = 'ClassesController_list';

describe('the assistant past the limit of one question: Continue, choices and the bounds', () => {
  let scene: AssistantScene;
  const rooms: { id: string; floorId: string }[] = [];

  beforeAll(async () => {
    scene = await assistantScene();
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ daily_limit: 0 })
      .execute();
    for (let index = 0; index < 60; index += 1) {
      const id = await scene.people.room(scene.north);
      const row = await scene.database.migrator
        .selectFrom('rooms')
        .select('floor_id')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      rooms.push({ id, floorId: row.floor_id });
    }
  }, 120_000);

  afterAll(async () => {
    await scene.close();
  });

  beforeEach(async () => {
    scene.model.script();
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ question_actions: 40, proposal_steps: 100, question_minutes: 10 })
      .execute();
  });

  const server = () => scene.app.getHttpServer() as Parameters<typeof request>[0];

  const rename = (room: { id: string; floorId: string }, name: string) => ({
    name: ROOM_EDIT,
    args: {
      id: room.id,
      body: {
        name,
        floorId: room.floorId,
        type: 'classroom',
        capacity: 28,
        status: 'in_use',
        shared: false,
        maxSimultaneousLessons: null,
      },
      summary: `Rename to ${name}.`,
    },
  });

  const conversationOf = (response: { status: number; body: unknown }): AssistantConversation => {
    expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(202);
    return assistantConversationSchema.parse(
      (response.body as { conversation: unknown }).conversation,
    );
  };

  const confirm = (id: string) =>
    request(server())
      .post(`/api/assistant/proposals/${id}/confirm`)
      .set('Cookie', scene.admin)
      .set(BRANCH_HEADER, scene.north)
      .send({ role: 'super_admin' });

  /** The room ids of the steps of a stored proposal. */
  const roomsOf = async (proposalId: string) =>
    (
      (
        await scene.database.migrator
          .selectFrom('assistant_proposals')
          .select('steps')
          .where('id', '=', proposalId)
          .executeTakeFirstOrThrow()
      ).steps as { url: string }[]
    ).map((step) => step.url.split('/').at(-1) ?? '');

  it('proposes 40 of 60 changes, offers Continue, and the next part proposes the other 20 with nothing proposed twice (edge/people-roles-accounts, "Cancel these 60 lessons")', async () => {
    const all = rooms.map((room, index) => rename(room, `Lab ${String(index + 1)}`));
    scene.model.script(calls(...all), answer('40 rooms proposed; 20 are left. Press Continue.'));
    const before = scene.model.requests.length;
    const first = conversationOf(
      await ask(scene, scene.admin, scene.north, {
        text: 'Rename all 60 rooms to Lab 1 to Lab 60.',
      }),
    );
    // The first part: 40 reads and changes, then the last call without tools, told the limit.
    expect(scene.model.requests.length - before).toBe(2);
    const last = scene.model.requests.at(-1);
    expect(last?.tools).toEqual([]);
    expect(last?.system).toContain(LIMIT_REACHED_LINE);
    expect(
      lastResults(last ?? { system: '', turns: [], tools: [] })
        .slice(40)
        .every((one) => (one.result as { error?: string }).error === 'too_many_reads'),
    ).toBe(true);
    const cut = first.messages.at(-1);
    expect(cut).toEqual(expect.objectContaining({ kind: 'answer', continues: true }));
    const part1 = first.proposals.at(-1);
    expect(part1?.steps).toHaveLength(40);
    expect((await confirm(part1?.id ?? '')).status).toBe(200);

    // Continue: the model proposes the 20 left, and one already done again.
    scene.model.script(
      calls(...all.slice(40), all[0] ?? rename(rooms[0] ?? { id: '', floorId: '' }, 'x')),
      answer('Done.'),
    );
    const second = conversationOf(
      await ask(scene, scene.admin, scene.north, {
        text: 'Continue',
        conversationId: first.id,
        continue: true,
      }),
    );
    const asked = second.messages.filter((message) => message.kind === 'question').at(-1);
    expect(asked).toEqual(expect.objectContaining({ continued: true }));
    const results = lastResults(
      scene.model.requests.at(-1) ?? { system: '', turns: [], tools: [] },
    );
    expect(results.at(-1)?.result).toEqual({ error: 'already_proposed' });
    // The model was told it is a Continue, never the bare word as a new request.
    const told = scene.model.requests.at(-2)?.turns.at(-1)?.parts[0];
    expect(told?.kind === 'text' ? told.text : '').toContain('The person pressed Continue');
    const part2 = second.proposals.at(-1);
    expect(part2?.id).not.toBe(part1?.id);
    expect(part2?.steps).toHaveLength(20);
    expect(second.messages.at(-1)).toEqual(expect.objectContaining({ continues: false }));
    const together = [...(await roomsOf(part1?.id ?? '')), ...(await roomsOf(part2?.id ?? ''))];
    expect(new Set(together).size).toBe(60);
    expect(together.sort()).toEqual(rooms.map((room) => room.id).sort());
  }, 180_000);

  it('refuses Continue when the newest answer was not cut, and without a conversation (review of the plan, should fix 6)', async () => {
    scene.model.script(answer('All done.'));
    const done = conversationOf(await ask(scene, scene.admin, scene.north, { text: 'Hello.' }));
    const refused = await ask(scene, scene.admin, scene.north, {
      text: 'Continue',
      conversationId: done.id,
      continue: true,
    });
    expect([refused.status, errorCode(refused)]).toEqual([409, 'assistant_nothing_to_continue']);
    const bare = await ask(scene, scene.admin, scene.north, { text: 'Continue', continue: true });
    expect(bare.status).toBe(400);
  });

  it('sets Continue when a proposal is full at the setting of the steps', async () => {
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ proposal_steps: 3 })
      .execute();
    scene.model.script(
      calls(...rooms.slice(0, 5).map((room, index) => rename(room, `Hall ${String(index)}`))),
      answer('Three proposed.'),
    );
    const cut = conversationOf(
      await ask(scene, scene.admin, scene.north, { text: 'Rename five.' }),
    );
    expect(cut.proposals.at(-1)?.steps).toHaveLength(3);
    expect(cut.messages.at(-1)).toEqual(expect.objectContaining({ continues: true }));
    const results = lastResults(
      scene.model.requests.at(-1) ?? { system: '', turns: [], tools: [] },
    );
    expect(results.slice(3).map((one) => one.result)).toEqual([
      { error: 'too_many_steps', max: 3 },
      { error: 'too_many_steps', max: 3 },
    ]);
  });

  it('bounds the model calls at the reads allowed and two more, and the attempts at twice that (.claude/rules/api.md)', async () => {
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ question_actions: 3 })
      .execute();
    scene.model.script(
      ...Array.from({ length: 20 }, () =>
        calls({ name: ASK_CHOICE, args: { options: ['A', 'B'] } }),
      ),
    );
    const before = scene.model.requests.length;
    await ask(scene, scene.admin, scene.north, { text: 'Ask me forever.' });
    expect(scene.model.requests.length - before).toBe(modelCallsOf(3));
    expect(modelCallsOf(40)).toBe(42);
    expect(attemptsOf(modelCallsOf(40))).toBe(84);
  });

  it('stores the options of a question it asks as choices, as a model call and never a read', async () => {
    scene.model.script(
      calls({ name: ASK_CHOICE, args: { options: ['Oxford 7A', 'Oxford 7B', 'Both'] } }),
      answer('Which class?'),
    );
    const asked = conversationOf(
      await ask(scene, scene.admin, scene.north, { text: 'Cancel the class on Friday.' }),
    );
    expect(asked.messages.map((message) => message.kind)).toEqual(['question', 'answer']);
    expect(asked.messages.at(-1)).toEqual(
      expect.objectContaining({ choices: ['Oxford 7A', 'Oxford 7B', 'Both'], continues: false }),
    );
    expect(choicesOf({ options: ['Only one'] })).toEqual({ error: 'options_count' });
    expect(choicesOf({ options: Array.from({ length: 9 }, (_, i) => String(i)) })).toEqual({
      error: 'options_count',
    });
    expect(choicesOf({ options: ['A', 'x'.repeat(81)] })).toEqual({ error: 'option_length' });
    expect(choicesOf({ options: ['A', 'A'] })).toEqual({ error: 'options_repeat' });
    expect(choicesOf({ options: 'A, B' })).toEqual({ error: 'options_not_texts' });
    // A read made in the same question is still a read.
    scene.model.script(calls({ name: CLASSES }), answer('Read.'));
    const read = conversationOf(await ask(scene, scene.admin, scene.north, { text: 'Classes?' }));
    expect(read.messages.map((message) => message.kind)).toEqual(['question', 'read', 'answer']);
  });

  it('confirms a proposal of 200 steps, the bound, well within the request timeout of 300 s (plan decision 4)', async () => {
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ question_actions: 200, proposal_steps: 200 })
      .execute();
    const many = [...rooms];
    while (many.length < 200) {
      const id = await scene.people.room(scene.north);
      const row = await scene.database.migrator
        .selectFrom('rooms')
        .select('floor_id')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      many.push({ id, floorId: row.floor_id });
    }
    scene.model.script(
      calls(...many.map((room, index) => rename(room, `Studio ${String(index + 1)}`))),
      answer('200 rooms proposed.'),
    );
    const proposed = conversationOf(
      await ask(scene, scene.admin, scene.north, { text: 'Rename 200 rooms.' }),
    );
    expect(proposed.proposals.at(-1)?.steps).toHaveLength(200);
    const started = performance.now();
    const confirmed = await confirm(proposed.proposals.at(-1)?.id ?? '');
    const seconds = (performance.now() - started) / 1000;
    expect(confirmed.status).toBe(200);
    // The time is given in the report of the task; the bound keeps a wide margin.
    console.info(`A Confirm of 200 steps took ${seconds.toFixed(1)} s.`);
    expect(seconds).toBeLessThan(150);
  }, 300_000);

  it('stores the end of the answer window with the question, from the time setting at that moment (plan decision 5)', async () => {
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ question_minutes: 1 })
      .execute();
    scene.model.script(answer('Quick.'));
    const done = conversationOf(await ask(scene, scene.admin, scene.north, { text: 'Quick?' }));
    const stored = await scene.database.migrator
      .selectFrom('assistant_messages')
      .select(['created_at', 'answer_until'])
      .where('id', '=', done.messages[0]?.id ?? '')
      .executeTakeFirstOrThrow();
    expect(
      new Date(stored.answer_until ?? 0).getTime() - new Date(stored.created_at).getTime(),
    ).toBe(90_000);
  });
});
