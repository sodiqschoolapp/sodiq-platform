import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import {
  ASSISTANT_ANSWER_WINDOW_MS,
  ASSISTANT_MESSAGES,
  assistantConversationSchema,
  assistantProgressSchema,
  NOTIFICATION_MESSAGES,
  NOTIFICATION_SOCKET_PATH,
  type AssistantAnswer,
  type AssistantConversation,
  type AssistantProgress,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShippingLogger } from '../../monitoring/monitoring.service.js';
import {
  answer,
  calls,
  held,
  lastResults,
  refusedWith,
  streamed,
  streamsThenFails,
} from '../../testing/assistant-model.js';
import {
  assistantScene,
  read,
  send,
  settle,
  type AssistantScene,
} from '../../testing/assistant-kit.js';
import { cookieOf, errorCode, NEW_PASSWORD } from '../../testing/sign-in-kit.js';
import { LiveListener } from '../notifications/live/listener.js';
import { notifyLive, LIVE_CHUNK } from '../notifications/live/live-payload.js';
import { AssistantWork } from './assistant-work.js';
import { AssistantDispatcher } from './dispatcher.js';
import { GENERATED_TOOLS } from './tools.generated.js';
import { PIECE_MAX_BYTES, piecesOf } from './progress.js';
import { Transactions } from '../../database/transactions.js';

// Task 11.16 (pull request #381; the owner's spec change of 24 November 2026). `02`, Assistant,
// While it works: "A question shows in the conversation the moment it is sent, and the box is
// empty again. The conversation shows what the assistant is reading as it reads it, and the
// answer as it is written. The person can go on with other work: closing the panel or leaving the
// page loses nothing". `edge/people-roles-accounts`, The assistant: "A person closes the panel
// while the assistant is still working" and "The same conversation is open in the panel and on
// the Assistant page, or in two tabs". All names are invented.

const CLASSES = 'ClassesController_list';
/** How long a message may take through the channel and the socket. */
const ARRIVAL_MS = 10_000;
/** How long to wait for a message that must not come. */
const SILENCE_MS = 600;

describe('the assistant while it works: the question at once, the progress live, one question at a time', () => {
  let scene: AssistantScene;
  let url: string;
  const open: Socket[] = [];

  beforeAll(async () => {
    scene = await assistantScene();
    await scene.people.schoolClass(scene.north, scene.northYear, { name: 'Oxford L' });
    const address = scene.app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${String(address.port)}`;
    // As the API process: the channel is heard here and pushed to the sockets.
    await scene.app.get(LiveListener).start(scene.database.appUrl);
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ daily_limit: 500, roles_on: ['super_admin', 'academic_vice_principal'] })
      .execute();
  });

  beforeEach(() => {
    scene.model.script();
    scene.model.requests.length = 0;
  });

  afterEach(async () => {
    for (const socket of open.splice(0)) socket.disconnect();
    await scene.app.get(AssistantWork).whenIdle();
  });

  afterAll(async () => {
    await scene.close();
  });

  /** A tab of a session, connected. */
  async function tab(cookie: string): Promise<{ socket: Socket; heard: AssistantProgress[] }> {
    const socket = connect(url, {
      path: NOTIFICATION_SOCKET_PATH,
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { Cookie: cookie },
    });
    open.push(socket);
    const heard: AssistantProgress[] = [];
    socket.on(ASSISTANT_MESSAGES.progress, (payload: unknown) => {
      // Checked against the schema, kept as it came: a key the schema would drop (a read's data)
      // stays in it, so the asserts below see it (code review, must fix 3).
      assistantProgressSchema.parse(payload);
      heard.push(payload as AssistantProgress);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once(NOTIFICATION_MESSAGES.state, () => {
        resolve();
      });
      socket.once('connect_error', (error) => {
        reject(new Error(error.message));
      });
    });
    return { socket, heard };
  }

  /** Waits until `check` holds of what a tab heard. */
  async function until(heard: AssistantProgress[], check: (all: AssistantProgress[]) => boolean) {
    const started = Date.now();
    while (!check(heard)) {
      if (Date.now() - started > ARRIVAL_MS) {
        throw new Error(`Not heard in time: ${JSON.stringify(heard)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  const conversation = async (id: string, branch = scene.north): Promise<AssistantConversation> =>
    assistantConversationSchema.parse(
      (await read(scene, scene.admin, `/api/assistant/conversations/${id}`, branch)).body,
    );

  const accepted = (response: { status: number; body: unknown }): AssistantConversation => {
    expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(202);
    return assistantConversationSchema.parse(
      (response.body as { conversation: unknown }).conversation,
    );
  };

  const messageCount = async () =>
    Number(
      (
        await scene.database.migrator
          .selectFrom('assistant_messages')
          .select((eb) => eb.fn.countAll().as('n'))
          .executeTakeFirstOrThrow()
      ).n,
    );

  it('takes the question at once (202) with the question shown and the work going on; the answer is stored once, after (`02`, While it works)', async () => {
    const gate = held(answer('Oxford L has no Tutor.'));
    scene.model.script(gate.turn);
    const taken = accepted(
      await send(scene, scene.admin, scene.north, { text: 'Who has no Tutor?' }),
    );
    expect(taken.messages.map((message) => message.kind)).toEqual(['question']);
    const question = taken.messages[0];
    expect(taken.working).toEqual({
      questionId: question?.id,
      askedAt: question?.at,
      until: new Date(
        new Date(question?.at ?? '').getTime() + ASSISTANT_ANSWER_WINDOW_MS,
      ).toISOString(),
    });
    await gate.reached;
    // The model holds its answer; the conversation, read again, still shows the question working.
    const midway = await conversation(taken.id);
    expect(midway.messages.map((message) => message.kind)).toEqual(['question']);
    expect(midway.working?.questionId).toBe(question?.id);
    gate.open();
    await scene.app.get(AssistantWork).whenIdle();
    const done = await conversation(taken.id);
    expect(done.messages.map((message) => message.kind)).toEqual(['question', 'answer']);
    expect(done.working).toBeNull();
    // Asked once: one call of the model.
    expect(scene.model.requests).toHaveLength(1);
  });

  it('refuses a second question of the person while one is being answered, in the same conversation, in another, and in another branch (409 assistant_question_running); nothing is stored', async () => {
    const gate = held(answer('First.'));
    scene.model.script(gate.turn, answer('Second.'));
    const first = accepted(
      await send(scene, scene.admin, scene.north, { text: 'First question.' }),
    );
    await gate.reached;
    const before = await messageCount();
    for (const [branch, conversationId] of [
      [scene.north, first.id],
      [scene.north, undefined],
      // `edge/people-roles-accounts`: a fact of the person, read past the row filter (0181).
      [scene.south, undefined],
    ] as const) {
      const refused = await send(scene, scene.admin, branch, {
        text: 'Second question.',
        ...(conversationId === undefined ? {} : { conversationId }),
      });
      expect([refused.status, errorCode(refused)], branch).toEqual([
        409,
        'assistant_question_running',
      ]);
    }
    expect(await messageCount()).toBe(before);
    gate.open();
    await scene.app.get(AssistantWork).whenIdle();
    // Once answered, the next question passes.
    const next = await settle(
      scene.app,
      await send(scene, scene.admin, scene.south, { text: 'Second question.' }),
      scene.admin,
      scene.south,
    );
    expect(next.status).toBe(202);
    expect(scene.model.requests).toHaveLength(2);
  });

  it('takes one of two questions sent at the same moment from two tabs; the other waits on the person’s lock and is refused (`edge`, "… or in two tabs")', async () => {
    const accountKey = `assistant_account:${scene.adminAccount}`;
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let heldPid = 0;
    const holding = scene.database.migrator.transaction().execute(async (transaction) => {
      heldPid =
        (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(transaction)).rows[0]
          ?.pid ?? 0;
      await sql`select pg_advisory_xact_lock(hashtextextended(${accountKey}, 0))`.execute(
        transaction,
      );
      await released;
    });
    while (heldPid === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    const blocked = async () =>
      Number(
        (
          await sql<{ n: string }>`
            select count(*) as n from pg_stat_activity
            where ${heldPid} = any(pg_blocking_pids(pid))
          `.execute(scene.database.migrator)
        ).rows[0]?.n ?? 0,
      );
    const start = (text: string) =>
      new Promise<Awaited<ReturnType<typeof send>>>((resolve, reject) => {
        send(scene, scene.admin, scene.north, { text }).then(resolve, reject);
      });
    const one = start('From the first tab.');
    while ((await blocked()) < 1) await new Promise((resolve) => setTimeout(resolve, 10));
    const two = start('From the second tab.');
    while ((await blocked()) < 2) await new Promise((resolve) => setTimeout(resolve, 10));
    const before = await messageCount();
    release();
    await holding;
    const answers = await Promise.all([one, two]);
    const outcomes = answers
      .map((response) => [response.status, response.status === 202 ? null : errorCode(response)])
      .sort((a, b) => Number(a[0]) - Number(b[0]));
    expect(outcomes).toEqual([
      [202, null],
      [409, 'assistant_question_running'],
    ]);
    await scene.app.get(AssistantWork).whenIdle();
    // One question and its answer, never two questions.
    expect((await messageCount()) - before).toBe(2);
  });

  it('writes and sends nothing of a question past its answer window, and the next question gets its own answer, in order (review of the plan, must fix 2)', async () => {
    const asker = await tab(scene.admin);
    const late = held(answer('Too late.'));
    scene.model.script(calls({ name: CLASSES }), late.turn);
    const first = accepted(await send(scene, scene.admin, scene.north, { text: 'Slow question.' }));
    await late.reached;
    // What was written inside the window has reached the tab.
    await until(asker.heard, (all) =>
      all.some((one) => one.questionId === first.messages[0]?.id && one.event.kind === 'read'),
    );
    // The window passes while the model writes its answer.
    scene.clock.advance(ASSISTANT_ANSWER_WINDOW_MS);
    const heardBefore = asker.heard.length;
    expect((await conversation(first.id)).working).toBeNull();
    scene.model.script(answer('On time.'));
    const second = accepted(
      await send(scene, scene.admin, scene.north, {
        text: 'Next question.',
        conversationId: first.id,
      }),
    );
    // The second question's work ends while the first's model still holds its answer.
    const secondQuestion = second.messages.at(-1)?.id;
    await until(asker.heard, (all) =>
      all.some((one) => one.questionId === secondQuestion && one.event.kind === 'done'),
    );
    late.open();
    await scene.app.get(AssistantWork).whenIdle();
    const stored = await conversation(second.id);
    expect(stored.messages.map((message) => message.kind)).toEqual([
      'question',
      'read',
      'question',
      'answer',
    ]);
    expect(stored.messages.at(-1)).toEqual(expect.objectContaining({ text: 'On time.' }));
    await new Promise((resolve) => setTimeout(resolve, SILENCE_MS));
    const firstQuestion = first.messages[0]?.id;
    // Nothing more of the first question after its window: no text, no done (code review,
    // should fix 3).
    expect(
      asker.heard.slice(heardBefore).filter((one) => one.questionId === firstQuestion),
    ).toEqual([]);
    // The turns of the next question alternate: the unanswered question stays out.
    scene.model.requests.length = 0;
    scene.model.script(answer('Third.'));
    await settle(
      scene.app,
      await send(scene, scene.admin, scene.north, { text: 'Third.', conversationId: first.id }),
      scene.admin,
      scene.north,
    );
    expect(scene.model.requests[0]?.turns.map((turn) => turn.role)).toEqual([
      'person',
      'model',
      'person',
    ]);
  });

  it('tells the asker’s tabs the question, each read with its group and no data, the text and done, and done comes with the answer stored; another account hears nothing', async () => {
    const other = await scene.kit.completeSession('Sardor', 'Xolmatov');
    await scene.kit.giveRole(other.account.id, { role: 'super_admin' });
    const asker = await tab(scene.admin);
    const stranger = await tab(other.cookie);
    scene.model.script(calls({ name: CLASSES }), streamed('Oxford L ', 'has no Tutor.'));
    const taken = accepted(await send(scene, scene.admin, scene.north, { text: 'Live, please.' }));
    await until(asker.heard, (all) => all.some((one) => one.event.kind === 'done'));
    const questionId = taken.messages[0]?.id;
    expect(asker.heard.every((one) => one.conversationId === taken.id)).toBe(true);
    expect(asker.heard.every((one) => one.questionId === questionId)).toBe(true);
    expect(asker.heard.map((one) => one.event)).toEqual([
      { kind: 'question' },
      { kind: 'read', group: 'classes', status: 200 },
      { kind: 'text', seq: 1, delta: 'Oxford L ' },
      { kind: 'text', seq: 2, delta: 'has no Tutor.' },
      { kind: 'done' },
    ]);
    // `done` goes out with the commit of the answer: a read on it finds the answer.
    expect((await conversation(taken.id)).messages.at(-1)).toEqual(
      expect.objectContaining({ kind: 'answer', text: 'Oxford L has no Tutor.' }),
    );
    // Never the data of a read.
    expect(JSON.stringify(asker.heard)).not.toContain('Oxford L"');
    await new Promise((resolve) => setTimeout(resolve, SILENCE_MS));
    expect(stranger.heard).toEqual([]);
  });

  it('tells a second session of the same person (two tabs), and nothing more to a session signed out midway (review of the plan, correction 4)', async () => {
    const person = await scene.kit.completeSession('Nodira', 'Usmonova');
    await scene.kit.giveRole(person.account.id, { role: 'super_admin' });
    const fresh = await scene.kit.signIn(person.account.login, NEW_PASSWORD);
    const secondCookie = cookieOf(fresh);
    expect(secondCookie).toBeDefined();
    const second = secondCookie ?? '';
    // The code of the next step: the one of this step was used when the second step was set up.
    expect(
      (await scene.kit.passSecondStep(second, scene.kit.codeOf(person.secret, 1))).status,
    ).toBe(200);
    const first = await tab(person.cookie);
    const other = await tab(second);
    const gate = held(streamed('After ', 'the sign-out.'));
    scene.model.script(gate.turn);
    accepted(await send(scene, person.cookie, scene.north, { text: 'Two tabs.' }));
    await until(first.heard, (all) => all.some((one) => one.event.kind === 'question'));
    await until(other.heard, (all) => all.some((one) => one.event.kind === 'question'));
    await gate.reached;
    expect((await scene.kit.post('/api/auth/sign-out', second)).status).toBe(204);
    gate.open();
    await until(first.heard, (all) => all.some((one) => one.event.kind === 'done'));
    await new Promise((resolve) => setTimeout(resolve, SILENCE_MS));
    expect(other.heard.map((one) => one.event.kind)).toEqual(['question']);
  });

  it('ends a busy model in its notice and done, and the request still answered 202; no model set up stays 503 before anything is stored', async () => {
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ fallback_on: false })
      .execute();
    try {
      const asker = await tab(scene.admin);
      scene.model.script(
        refusedWith(429, 'RESOURCE_EXHAUSTED'),
        refusedWith(429, 'RESOURCE_EXHAUSTED'),
        refusedWith(429, 'RESOURCE_EXHAUSTED'),
      );
      const taken = accepted(await send(scene, scene.admin, scene.north, { text: 'Busy?' }));
      await until(asker.heard, (all) => all.some((one) => one.event.kind === 'done'));
      expect((await conversation(taken.id)).messages.at(-1)).toEqual(
        expect.objectContaining({ kind: 'notice', code: 'assistant_model_busy' }),
      );
    } finally {
      await scene.database.migrator
        .updateTable('assistant_settings')
        .set({ fallback_on: true })
        .execute();
    }
    scene.model.name = null;
    try {
      const before = await messageCount();
      const refused = await send(scene, scene.admin, scene.north, { text: 'Anyone?' });
      expect([refused.status, errorCode(refused)]).toEqual([503, 'assistant_model_unavailable']);
      expect(await messageCount()).toBe(before);
    } finally {
      scene.model.name = 'fake-model';
    }
  });

  it('sends reset when a turn that wrote text reads instead of answering, and when a call that wrote text fails before the next is tried', async () => {
    const asker = await tab(scene.admin);
    scene.model.script(
      () => ({
        text: 'Let me look.',
        calls: [{ name: CLASSES, args: {} }],
        pieces: ['Let me look.'],
        tokensIn: 1,
        tokensOut: 1,
        model: 'fake-model',
      }),
      streamsThenFails(['Half an '], refusedWith(429, 'RESOURCE_EXHAUSTED')),
      streamed('The answer.'),
    );
    const taken = accepted(await send(scene, scene.admin, scene.north, { text: 'Reset, please.' }));
    await until(asker.heard, (all) => all.some((one) => one.event.kind === 'done'));
    expect(asker.heard.map((one) => one.event)).toEqual([
      { kind: 'question' },
      { kind: 'text', seq: 1, delta: 'Let me look.' },
      { kind: 'reset' },
      { kind: 'read', group: 'classes', status: 200 },
      { kind: 'text', seq: 1, delta: 'Half an ' },
      { kind: 'reset' },
      { kind: 'text', seq: 1, delta: 'The answer.' },
      { kind: 'done' },
    ]);
    expect((await conversation(taken.id)).messages.at(-1)).toEqual(
      expect.objectContaining({ kind: 'answer', text: 'The answer.' }),
    );
  });

  it('stores assistant_answer_failed for a failure of the work that is not the model’s, logs only the error’s name, and sends done', async () => {
    const asker = await tab(scene.admin);
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    Logger.overrideLogger(new ShippingLogger());
    ShippingLogger.sink = (_level, text) => {
      lines.push(text);
    };
    vi.spyOn(AssistantDispatcher.prototype, 'read').mockRejectedValue(
      new TypeError('Secret words of a read'),
    );
    try {
      scene.model.script(calls({ name: CLASSES }), answer('Never.'));
      const taken = accepted(await send(scene, scene.admin, scene.north, { text: 'Fail inside.' }));
      await until(asker.heard, (all) => all.some((one) => one.event.kind === 'done'));
      expect((await conversation(taken.id)).messages.at(-1)).toEqual(
        expect.objectContaining({ kind: 'notice', code: 'assistant_answer_failed' }),
      );
    } finally {
      ShippingLogger.sink = undefined;
      vi.restoreAllMocks();
    }
    expect(lines.join('\n')).toContain('TypeError');
    expect(lines.join('\n')).not.toContain('Secret words');
  });

  it('reads "being answered" with 0181 in every branch, for the person only, ending at an answer, a notice or a proposal (review of the plan, correction 3)', async () => {
    const running = async (account: string, since: Date) =>
      (
        await sql<{ running: boolean }>`
          select assistant_question_running(${account}, ${since}) as running
        `.execute(scene.database.migrator)
      ).rows[0]?.running;
    const before = new Date(scene.clock.now().getTime() - 1);
    expect(await running(scene.adminAccount, before)).toBe(false);
    // A question in South, held: being answered for the person, whatever branch asks.
    const gate = held(answer('South answer.'));
    scene.model.script(gate.turn);
    accepted(await send(scene, scene.admin, scene.south, { text: 'In South.' }));
    await gate.reached;
    expect(await running(scene.adminAccount, before)).toBe(true);
    // Not another account's, and not one asked at or before `since`.
    const other = await scene.kit.completeSession('Lola', 'Rahimova');
    expect(await running(other.account.id, before)).toBe(false);
    expect(await running(scene.adminAccount, scene.clock.now())).toBe(false);
    gate.open();
    await scene.app.get(AssistantWork).whenIdle();
    expect(await running(scene.adminAccount, before)).toBe(false);
    // A question that ended in a proposal: its answer is stored with it, so it is not running.
    const roomId = await scene.people.room(scene.north);
    const roomRow = await scene.database.migrator
      .selectFrom('rooms')
      .select(['floor_id'])
      .where('id', '=', roomId)
      .executeTakeFirstOrThrow();
    const roomEdit = `propose_${GENERATED_TOOLS['PUT /api/setup/rooms/:id']?.name ?? ''}`.slice(
      0,
      64,
    );
    scene.model.script(
      calls({
        name: roomEdit,
        args: {
          id: roomId,
          body: {
            name: 'Room 7',
            floorId: roomRow.floor_id,
            type: 'classroom',
            capacity: 28,
            status: 'in_use',
            shared: false,
            maxSimultaneousLessons: null,
          },
          summary: 'Rename to Room 7.',
        },
      }),
      answer('Proposed.'),
    );
    await settle(
      scene.app,
      await send(scene, scene.admin, scene.north, { text: 'Add a room.' }),
      scene.admin,
      scene.north,
    );
    expect(
      await scene.database.migrator.selectFrom('assistant_proposals').select('id').execute(),
    ).toHaveLength(1);
    const kinds = await scene.database.migrator
      .selectFrom('assistant_messages')
      .select('kind')
      .orderBy('created_at', 'desc')
      .orderBy('seq', 'desc')
      .limit(1)
      .execute();
    expect(kinds.map((row) => row.kind)).toEqual(['answer']);
    expect(await running(scene.adminAccount, before)).toBe(false);
    // Only the application may call it.
    const rights = await sql<{ app: boolean; anyone: boolean }>`
      select
        has_function_privilege('sodiq_app', 'assistant_question_running(uuid, timestamptz)', 'execute') as app,
        has_function_privilege('public', 'assistant_question_running(uuid, timestamptz)', 'execute') as anyone
    `.execute(scene.database.migrator);
    expect(rights.rows[0]).toEqual({ app: true, anyone: false });
  });

  it('writes nothing more of a question once a later question of the conversation is stored, whatever the moment its write began with (code review, must fix 1)', async () => {
    const asker = await tab(scene.admin);
    const late = held(streamed('Late ', 'answer.'));
    scene.model.script(late.turn);
    const first = accepted(await send(scene, scene.admin, scene.north, { text: 'First of two.' }));
    await late.reached;
    await until(asker.heard, (all) =>
      all.some((one) => one.questionId === first.messages[0]?.id && one.event.kind === 'question'),
    );
    // As a question route would that took the lock once the window passed, and stored its question
    // before this work's write got the lock: a later question of the same conversation.
    const asked = first.messages[0];
    await scene.database.migrator
      .insertInto('assistant_messages')
      .values({
        conversation_id: first.id,
        branch_id: scene.north,
        account_id: scene.adminAccount,
        seq: (asked?.seq ?? 1) + 1,
        kind: 'question',
        content: sql`${JSON.stringify({ kind: 'question', text: 'Second of two.' })}::jsonb`,
        created_at: scene.clock.now(),
      })
      .execute();
    const heardBefore = asker.heard.length;
    late.open();
    await scene.app.get(AssistantWork).whenIdle();
    expect((await conversation(first.id)).messages.map((message) => message.kind)).toEqual([
      'question',
      'question',
    ]);
    await new Promise((resolve) => setTimeout(resolve, SILENCE_MS));
    expect(asker.heard.slice(heardBefore).filter((one) => one.questionId === asked?.id)).toEqual(
      [],
    );
    // The stored row stands for a route's question, which would end in its answer or notice.
    await scene.database.migrator
      .insertInto('assistant_messages')
      .values({
        conversation_id: first.id,
        branch_id: scene.north,
        account_id: scene.adminAccount,
        seq: (asked?.seq ?? 1) + 2,
        kind: 'notice',
        content: sql`${JSON.stringify({ kind: 'notice', code: 'assistant_model_busy' })}::jsonb`,
        created_at: scene.clock.now(),
      })
      .execute();
  });

  // Permission review of the code: the work outlives its request, and its reads meet the guards.
  it('stops the work when the asking session is signed out midway: the read is refused, the model is not called again, and the question ends in a notice', async () => {
    const person = await scene.kit.completeSession('Kamola', 'Ergasheva');
    await scene.kit.giveRole(person.account.id, {
      role: 'academic_vice_principal',
      branchId: scene.north,
    });
    const gate = held(calls({ name: CLASSES }));
    scene.model.script(gate.turn, answer('Never asked.'));
    const taken = accepted(
      await send(scene, person.cookie, scene.north, {
        text: 'Then I sign out.',
        role: 'academic_vice_principal',
      }),
    );
    await gate.reached;
    expect((await scene.kit.post('/api/auth/sign-out', person.cookie)).status).toBe(204);
    gate.open();
    await scene.app.get(AssistantWork).whenIdle();
    const stored = await scene.database.migrator
      .selectFrom('assistant_messages')
      .select('content')
      .where('conversation_id', '=', taken.id)
      .orderBy('seq')
      .execute();
    expect(stored.map((row) => row.content)).toEqual([
      { kind: 'question', text: 'Then I sign out.' },
      expect.objectContaining({ kind: 'read', status: 401 }),
      { kind: 'notice', code: 'assistant_answer_failed' },
    ]);
    // One call of the model: none after the session ended.
    expect(scene.model.requests).toHaveLength(1);
    expect(
      await scene.database.migrator
        .selectFrom('assistant_proposals')
        .select('id')
        .where('conversation_id', '=', taken.id)
        .execute(),
    ).toEqual([]);
  });

  it('gives the model the refusal, never the data, of a read made after the person’s role ended midway', async () => {
    const person = await scene.kit.completeSession('Jasur', 'Qodirov');
    const role = await scene.kit.giveRole(person.account.id, {
      role: 'academic_vice_principal',
      branchId: scene.north,
    });
    const gate = held(calls({ name: CLASSES }));
    scene.model.script(gate.turn, answer('The read was refused.'));
    const taken = accepted(
      await send(scene, person.cookie, scene.north, {
        text: 'Then my role ends.',
        role: 'academic_vice_principal',
      }),
    );
    await gate.reached;
    await scene.kit.endRole(role.id, scene.adminAccount, scene.north);
    gate.open();
    await scene.app.get(AssistantWork).whenIdle();
    const given = lastResults(scene.model.requests[1] ?? { system: '', turns: [], tools: [] });
    expect(given).toHaveLength(1);
    expect(given[0]?.result).toEqual({ status: 403, error: expect.any(String) as string });
    expect(JSON.stringify(given)).not.toContain('Oxford L');
    const stored = await scene.database.migrator
      .selectFrom('assistant_messages')
      .select('content')
      .where('conversation_id', '=', taken.id)
      .where('kind', '=', 'read')
      .execute();
    expect(stored.map((row) => (row.content as { status: number }).status)).toEqual([403]);
  });

  it('cuts a long text into payloads under PostgreSQL’s 8 000 bytes, in any script, never a character in two', async () => {
    const text = `${'Аб'.repeat(2_000)}${'oʻ'.repeat(1_000)}${'\u0001'.repeat(3_000)}😀`;
    const pieces = piecesOf(text);
    expect(pieces.join('')).toBe(text);
    for (const piece of pieces) {
      expect(Buffer.byteLength(JSON.stringify(piece))).toBeLessThanOrEqual(PIECE_MAX_BYTES);
      expect(piece.length).toBeLessThanOrEqual(1_500);
    }
    // The longest piece goes through the channel inside a whole payload.
    const longest = pieces.reduce((a, b) =>
      Buffer.byteLength(JSON.stringify(a)) >= Buffer.byteLength(JSON.stringify(b)) ? a : b,
    );
    await scene.app.get(Transactions).run([scene.north], async (transaction) => {
      await notifyLive(transaction, {
        kind: 'assistant',
        accountId: scene.adminAccount,
        conversationId: scene.adminAccount,
        questionId: scene.adminAccount,
        event: { kind: 'text', seq: 1, delta: longest },
      });
    });
    expect(LIVE_CHUNK).toBe(100);
  });

  it('never links the Assistant page (plan of 11.16, test 11; task 11.19: link_place)', async () => {
    scene.model.script(
      calls({ name: 'link_place', args: { page: '/assistant' } }),
      answer('Here.'),
    );
    const reply = await settle(
      scene.app,
      await send(scene, scene.admin, scene.north, { text: 'Which pages?' }),
      scene.admin,
      scene.north,
    );
    const last = (reply.body as AssistantAnswer).conversation.messages.at(-1);
    expect(last?.kind === 'answer' ? last.links : null).toEqual([]);
    expect(
      lastResults(scene.model.requests[1] ?? { system: '', turns: [], tools: [] }).map(
        (one) => one.result,
      ),
    ).toEqual([{ error: 'not_a_page' }]);
  });

  it('waits for an answer being written before the process stops', async () => {
    const gate = held(answer('Before the stop.'));
    scene.model.script(gate.turn);
    const taken = accepted(await send(scene, scene.admin, scene.north, { text: 'Stop soon.' }));
    await gate.reached;
    const work = scene.app.get(AssistantWork);
    const stopping = work.beforeApplicationShutdown();
    let stopped = false;
    void stopping.then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stopped).toBe(false);
    gate.open();
    await stopping;
    expect((await conversation(taken.id)).messages.at(-1)).toEqual(
      expect.objectContaining({ kind: 'answer', text: 'Before the stop.' }),
    );
  });
});
