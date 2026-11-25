import { assistantSettingsSchema, assistantStatusSchema } from '@sodiq/shared';
import { ASSISTANT_DATA_GROUPS } from '@sodiq/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { answer, calls, FAKE_TOKENS, fails } from '../../testing/assistant-model.js';
import {
  ask,
  assistantScene,
  read,
  type AssistantScene,
  noticeOf,
} from '../../testing/assistant-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { costMicros } from './assistant.engine.js';
import { answerUntilOf, messagesOf, workingOf } from './conversations.store.js';
import { GENERATED_TOOLS } from './tools.generated.js';

// Task 11.12. `02`, Assistant: "The Super Admin can switch it off for the whole school or for one
// of the three roles; it is off until switched on." Limits: "A limit of requests per person per
// day, and a monthly spending cap for the school: $300 at the start …, which the Super Admin can
// change. When either is reached …, the panel says so; every screen works as before." Build
// plan: "both audited as settings". Names are invented.

const PRICES = { priceInMicros: 2_000_000, priceOutMicros: 12_000_000 };
/** Task 11.15: the default price of the region (Frankfurt), at which every fake call is billed. */
const REGION_PRICES = { priceInMicros: 1_650_000, priceOutMicros: 9_900_000 };

describe('the assistant: the switch, the daily limit and the monthly cap', () => {
  let scene: AssistantScene;
  let server: Parameters<typeof request>[0];

  const settingsBody = (change: Record<string, unknown> = {}) => ({
    schoolOn: true,
    rolesOn: ['super_admin'],
    dailyLimit: 30,
    monthlyCapDollars: 300,
    questionActions: 40,
    proposalSteps: 100,
    questionMinutes: 10,
    fallbackOn: true,
    dataGroupsOn: [...ASSISTANT_DATA_GROUPS],
    ...change,
  });

  const put = (body: unknown, cookie = scene.admin) =>
    request(server)
      .put('/api/setup/school-settings/assistant')
      .set('Cookie', cookie)
      .send(body as object);

  const status = async () =>
    assistantStatusSchema.parse(
      (await read(scene, scene.admin, '/api/assistant/status?role=super_admin', scene.north)).body,
    );

  /** Every question, conversation and model call is gone from the tables of the counts. */
  const forget = async () => {
    await sql`delete from assistant_proposal_steps`.execute(scene.database.migrator);
    await sql`delete from assistant_proposal_decisions`.execute(scene.database.migrator);
    await sql`delete from assistant_proposals`.execute(scene.database.migrator);
    await sql`delete from assistant_model_calls`.execute(scene.database.migrator);
    await sql`delete from assistant_messages`.execute(scene.database.migrator);
    await sql`delete from assistant_conversation_restores`.execute(scene.database.migrator);
    await sql`delete from assistant_conversations`.execute(scene.database.migrator);
  };

  beforeAll(async () => {
    scene = await assistantScene({ on: false });
    server = scene.app.getHttpServer();
  }, 120_000);

  afterAll(async () => {
    await scene.close();
  });

  beforeEach(async () => {
    await forget();
    scene.model.script();
    scene.model.name = 'fake-model';
  });

  it('is off until switched on, and the switch per school and per role stops the panel while every screen works', async () => {
    // Task 11.21 (plan decision 3): before any save, the row as 0178 wrote it and 0184 kept it.
    expect(
      await scene.database.migrator
        .selectFrom('assistant_settings')
        .select(['daily_limit', 'question_actions', 'proposal_steps', 'question_minutes'])
        .executeTakeFirstOrThrow(),
    ).toEqual({ daily_limit: 30, question_actions: 40, proposal_steps: 100, question_minutes: 10 });
    expect(await status()).toEqual({
      available: false,
      refusal: 'assistant_off',
      questionsLeftToday: 30,
    });
    let response = await ask(scene, scene.admin, scene.north, { text: 'Hello?' });
    expect([response.status, errorCode(response)]).toEqual([409, 'assistant_off']);

    expect((await put(settingsBody({ schoolOn: true, rolesOn: [] }))).status).toBe(200);
    response = await ask(scene, scene.admin, scene.north, { text: 'Hello?' });
    expect([response.status, errorCode(response)]).toEqual([409, 'assistant_off']);

    expect((await put(settingsBody({ schoolOn: false, rolesOn: ['super_admin'] }))).status).toBe(
      200,
    );
    response = await ask(scene, scene.admin, scene.north, { text: 'Hello?' });
    expect([response.status, errorCode(response)]).toEqual([409, 'assistant_off']);
    // Nothing was stored or counted.
    expect(
      await scene.database.migrator.selectFrom('assistant_messages').selectAll().execute(),
    ).toEqual([]);
    // Every screen works as before.
    expect((await read(scene, scene.admin, '/api/classes', scene.north)).status).toBe(200);

    expect((await put(settingsBody())).status).toBe(200);
    expect(await status()).toEqual({ available: true, refusal: null, questionsLeftToday: 30 });
    expect((await ask(scene, scene.admin, scene.north, { text: 'Hello?' })).status).toBe(202);
  });

  it('audits each change of the settings in the same transaction, and nothing for a save without change', async () => {
    await put(settingsBody());
    const before = await scene.database.migrator
      .selectFrom('audit_log_school')
      .selectAll()
      .where('action', '=', 'assistant_settings.change')
      .execute();
    const changed = assistantSettingsSchema.parse(
      (await put(settingsBody({ dailyLimit: 12, monthlyCapDollars: 250 }))).body,
    );
    expect(changed).toEqual(
      expect.objectContaining({
        dailyLimit: 12,
        monthlyCapDollars: 250,
        // Tasks 11.13 and 11.14: the table gives the Academic Vice Principal and the Teacher the
        // panel too.
        roles: ['super_admin', 'academic_vice_principal', 'teacher'],
        modelConfigured: true,
      }),
    );
    await put(settingsBody({ dailyLimit: 12, monthlyCapDollars: 250 }));
    const after = await scene.database.migrator
      .selectFrom('audit_log_school')
      .selectAll()
      .where('action', '=', 'assistant_settings.change')
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)).toEqual(
      expect.objectContaining({
        actor_id: scene.adminAccount,
        old_value: expect.objectContaining({ dailyLimit: 30, monthlyCapDollars: 300 }) as unknown,
        new_value: expect.objectContaining({ dailyLimit: 12, monthlyCapDollars: 250 }) as unknown,
      }),
    );
    // A value outside its bounds is refused by the schema (task 11.21: 0 is "no daily limit").
    for (const [field, values] of Object.entries({
      dailyLimit: [-1, 501],
      questionActions: [0, 201],
      proposalSteps: [0, 201],
      questionMinutes: [0, 31],
    })) {
      for (const value of values) {
        expect(
          (await put(settingsBody({ [field]: value }))).status,
          `${field} ${String(value)}`,
        ).toBe(400);
      }
    }
    for (const [field, value] of Object.entries({
      dailyLimit: 0,
      questionActions: 200,
      proposalSteps: 200,
      questionMinutes: 30,
    })) {
      expect((await put(settingsBody({ [field]: value }))).status, field).toBe(200);
    }
    // Task 11.21: the new limits are read back and audited with the others, in one entry.
    const limits = assistantSettingsSchema.parse(
      (await put(settingsBody({ questionActions: 60, proposalSteps: 150, questionMinutes: 20 })))
        .body,
    );
    expect(limits).toEqual(
      expect.objectContaining({ questionActions: 60, proposalSteps: 150, questionMinutes: 20 }),
    );
    const entry = await scene.database.migrator
      .selectFrom('audit_log_school')
      .select(['old_value', 'new_value'])
      .where('action', '=', 'assistant_settings.change')
      .orderBy('occurred_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirstOrThrow();
    expect(entry.new_value).toEqual(
      expect.objectContaining({ questionActions: 60, proposalSteps: 150, questionMinutes: 20 }),
    );
    expect((await put(settingsBody({ rolesOn: ['principal'] }))).status).toBe(400);
    expect((await put(settingsBody({ rolesOn: ['super_admin', 'super_admin'] }))).status).toBe(400);
    await put(settingsBody());
  });

  it('keeps the stored daily limit of the settings row and adds the new limits with their defaults (0184, plan decision 3)', async () => {
    // The scene's database ran 0178 to 0184 with no settings saved yet before this file's
    // first test; a save is read back, so the row is read as stored.
    const row = await scene.database.migrator
      .selectFrom('assistant_settings')
      .select(['question_actions', 'proposal_steps', 'question_minutes'])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ question_actions: 40, proposal_steps: 100, question_minutes: 10 });
    const columns = await sql<{ column_name: string; column_default: string | null }>`
      select column_name, column_default from information_schema.columns
      where table_name = 'assistant_settings' and column_name = 'daily_limit'
    `.execute(scene.database.migrator);
    expect(columns.rows[0]?.column_default).toBe('0');
  });

  it('bounds the steps of a stored proposal at 200 and keeps them an array (0184, review of the plan, corrections 1 and 2)', async () => {
    const conversation = await scene.database.migrator
      .insertInto('assistant_conversations')
      .values({
        branch_id: scene.north,
        account_id: scene.adminAccount,
        role: 'super_admin',
        title: 'Steps.',
        created_at: new Date('2026-11-20T10:00:00+05:00'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const question = await scene.database.migrator
      .insertInto('assistant_messages')
      .values({
        conversation_id: conversation.id,
        branch_id: scene.north,
        account_id: scene.adminAccount,
        seq: 1,
        kind: 'question',
        content: sql`'{"kind":"question","text":"x"}'::jsonb`,
        created_at: new Date('2026-11-20T10:00:00+05:00'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const store = (steps: unknown) =>
      sql`
        insert into assistant_proposals (conversation_id, branch_id, account_id, question_id, role, steps, created_at, expires_at)
        values (${conversation.id}, ${scene.north}, ${scene.adminAccount}, ${question.id}, 'super_admin',
          ${JSON.stringify(steps)}::jsonb, ${new Date('2026-11-20T10:00:00+05:00')}, ${new Date('2026-11-20T10:15:00+05:00')})
      `.execute(scene.database.migrator);
    await expect(store(Array.from({ length: 200 }, () => ({})))).resolves.toBeDefined();
    await expect(store(Array.from({ length: 201 }, () => ({})))).rejects.toThrow(
      /assistant_proposals_steps_check/,
    );
    await expect(store({ steps: [] })).rejects.toThrow(/assistant_proposals_steps_check/);
    await expect(store([])).rejects.toThrow(/assistant_proposals_steps_check/);
    // The seq of a step's outcome: up to 200 (review of the plan, correction 1).
    const proposal = await scene.database.migrator
      .selectFrom('assistant_proposals')
      .select('id')
      .where('conversation_id', '=', conversation.id)
      .executeTakeFirstOrThrow();
    const outcome = (seq: number) =>
      sql`
        insert into assistant_proposal_steps (step_id, proposal_id, branch_id, seq, state, status, code, created_at)
        values (gen_random_uuid(), ${proposal.id}, ${scene.north}, ${seq}, 'done', 200, null, ${scene.clock.now()})
      `.execute(scene.database.migrator);
    await expect(outcome(200)).resolves.toBeDefined();
    await expect(outcome(201)).rejects.toThrow(/assistant_proposal_steps_seq_check/);
  });

  it('keeps the 270 s window of a question stored before 0184, which has no stored end (plan, Time)', async () => {
    const conversation = await scene.database.migrator
      .insertInto('assistant_conversations')
      .values({
        branch_id: scene.north,
        account_id: scene.adminAccount,
        role: 'super_admin',
        title: 'Before 0184.',
        created_at: scene.clock.now(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const asked = scene.clock.now();
    await scene.database.migrator
      .insertInto('assistant_messages')
      .values({
        conversation_id: conversation.id,
        branch_id: scene.north,
        account_id: scene.adminAccount,
        seq: 1,
        kind: 'question',
        content: sql`'{"kind":"question","text":"Old."}'::jsonb`,
        created_at: asked,
      })
      .execute();
    const running = async (ms: number) =>
      (
        await sql<{ running: boolean }>`
          select assistant_question_running(${scene.adminAccount}, ${new Date(asked.getTime() + ms)}) as running
        `.execute(scene.database.migrator)
      ).rows[0]?.running;
    expect(await running(269_000)).toBe(true);
    expect(await running(270_000)).toBe(false);
    const messages = await messagesOf(
      // A read of the migrator: the rows written above, past the branch filter of a transaction.
      scene.database.migrator as unknown as Parameters<typeof messagesOf>[0],
      conversation.id,
    );
    expect(messages[0]?.answerUntil).toBeNull();
    expect(answerUntilOf(messages[0] ?? { createdAt: asked, answerUntil: null }).getTime()).toBe(
      asked.getTime() + 270_000,
    );
    expect(workingOf(messages, new Date(asked.getTime() + 269_000))?.until).toBe(
      new Date(asked.getTime() + 270_000).toISOString(),
    );
    expect(workingOf(messages, new Date(asked.getTime() + 270_000))).toBeNull();
  });

  it('takes a daily limit of 0 as none: the status names no limit and every question is taken (build plan 11.21, Done when; review of the plan, must fix 2)', async () => {
    await put(settingsBody({ dailyLimit: 0 }));
    const conversation = await scene.database.migrator
      .insertInto('assistant_conversations')
      .values({
        branch_id: scene.north,
        account_id: scene.adminAccount,
        role: 'super_admin',
        title: 'Many.',
        created_at: scene.clock.now(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    // 600 questions of today, each answered: more than the largest daily limit.
    await sql`
      insert into assistant_messages (conversation_id, branch_id, account_id, seq, kind, content, created_at)
      select ${conversation.id}, ${scene.north}, ${scene.adminAccount}, n,
        case when n % 2 = 1 then 'question' else 'answer' end,
        case when n % 2 = 1 then '{"kind":"question","text":"x"}'::jsonb
          else '{"kind":"answer","text":"y","pages":[]}'::jsonb end,
        ${scene.clock.now()}
      from generate_series(1, 1200) n
    `.execute(scene.database.migrator);
    expect(await status()).toEqual({ available: true, refusal: null, questionsLeftToday: null });
    expect((await ask(scene, scene.admin, scene.north, { text: 'One more.' })).status).toBe(202);
    await put(settingsBody());
  });

  it('ends a question with the cap’s notice when the cap is reached while it is answered, keeping the steps drafted (build plan 11.21, Done when; review of the plan, must fix 1)', async () => {
    await put(
      settingsBody({
        monthlyCapDollars: 1,
        questionActions: 200,
        proposalSteps: 200,
        questionMinutes: 30,
      }),
    );
    const roomId = await scene.people.room(scene.north);
    const floor = await scene.database.migrator
      .selectFrom('rooms')
      .select('floor_id')
      .where('id', '=', roomId)
      .executeTakeFirstOrThrow();
    // The month spent all but one call: the first call of the question reaches the cap.
    const conversation = await scene.database.migrator
      .insertInto('assistant_conversations')
      .values({
        branch_id: scene.north,
        account_id: scene.adminAccount,
        role: 'super_admin',
        title: 'Earlier.',
        created_at: scene.clock.now(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const earlier = await scene.database.migrator
      .insertInto('assistant_messages')
      .values({
        conversation_id: conversation.id,
        branch_id: scene.north,
        account_id: scene.adminAccount,
        seq: 1,
        kind: 'question',
        content: sql`'{"kind":"question","text":"x"}'::jsonb`,
        created_at: scene.clock.now(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await sql`
      insert into assistant_messages (conversation_id, branch_id, account_id, seq, kind, content, created_at)
      values (${conversation.id}, ${scene.north}, ${scene.adminAccount}, 2, 'answer',
        '{"kind":"answer","text":"y","pages":[]}'::jsonb, ${scene.clock.now()})
    `.execute(scene.database.migrator);
    const oneCall = costMicros(FAKE_TOKENS, REGION_PRICES);
    await sql`
      insert into assistant_model_calls (message_id, branch_id, model, tokens_in, tokens_out, cost_micros, processed_in, created_at)
      values (${earlier.id}, ${scene.north}, 'fake-model', 0, 0, ${String(1_000_000n - oneCall)}, 'europe-west3', ${scene.clock.now()})
    `.execute(scene.database.migrator);
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
            name: 'Room 9',
            floorId: floor.floor_id,
            type: 'classroom',
            capacity: 28,
            status: 'in_use',
            shared: false,
            maxSimultaneousLessons: null,
          },
          summary: 'Rename to Room 9.',
        },
      }),
      answer('Never asked.'),
    );
    const before = scene.model.requests.length;
    const response = await ask(scene, scene.admin, scene.north, { text: 'Rename the room.' });
    expect(noticeOf(response)).toBe('assistant_cap_reached');
    expect(scene.model.requests.length - before).toBe(1);
    const proposals = await scene.database.migrator
      .selectFrom('assistant_proposals')
      .select('steps')
      .execute();
    expect(proposals).toHaveLength(1);
    expect((proposals[0]?.steps as unknown[]).length).toBe(1);
    await put(settingsBody());
  });

  it('counts the person’s questions of the Tashkent day in every branch together', async () => {
    await put(settingsBody({ dailyLimit: 2 }));
    expect((await ask(scene, scene.admin, scene.north, { text: 'One.' })).status).toBe(202);
    expect((await ask(scene, scene.admin, scene.south, { text: 'Two.' })).status).toBe(202);
    expect(await status()).toEqual({
      available: false,
      refusal: 'assistant_daily_limit',
      questionsLeftToday: 0,
    });
    const third = await ask(scene, scene.admin, scene.north, { text: 'Three.' });
    expect([third.status, errorCode(third)]).toEqual([409, 'assistant_daily_limit']);
    expect((await read(scene, scene.admin, '/api/classes', scene.north)).status).toBe(200);
    // The school day is Asia/Tashkent's: a question at 23:59 of the 19th there does not count,
    // one at 00:00 of the 20th (still the 19th in UTC) does.
    await forget();
    const conversation = await scene.database.migrator
      .insertInto('assistant_conversations')
      .values({
        branch_id: scene.north,
        account_id: scene.adminAccount,
        role: 'super_admin',
        title: 'Yesterday.',
        created_at: new Date('2026-11-19T23:59:00+05:00'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const [seq, at] of [
      [1, '2026-11-19T23:59:00+05:00'],
      [2, '2026-11-20T00:00:00+05:00'],
    ] as const) {
      await scene.database.migrator
        .insertInto('assistant_messages')
        .values({
          conversation_id: conversation.id,
          branch_id: scene.north,
          account_id: scene.adminAccount,
          seq,
          kind: 'question',
          content: sql`'{"kind":"question","text":"x"}'::jsonb`,
          created_at: new Date(at),
        })
        .execute();
    }
    expect(await status()).toEqual({ available: true, refusal: null, questionsLeftToday: 1 });
    await put(settingsBody());
  });

  it('lets one of two questions at the same moment through when one is left (two tabs; plan review, should fix 7)', async () => {
    await put(settingsBody({ dailyLimit: 1 }));
    // A transaction holds the person's lock, as a question does before its count.
    const held = await scene.database.migrator.connection().execute(async (connection) => {
      await sql`begin`.execute(connection);
      await sql`select pg_advisory_xact_lock(hashtextextended(${`assistant_account:${scene.adminAccount}`}, 0))`.execute(
        connection,
      );
      const pid =
        (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(connection)).rows[0]
          ?.pid ?? 0;
      const first = new Promise<{ status: number }>((resolve, reject) => {
        ask(scene, scene.admin, scene.north, { text: 'First tab.' }).then(resolve, reject);
      });
      let waited = false;
      for (let i = 0; i < 200 && !waited; i += 1) {
        const found = await sql<{ n: number }>`
          select count(*)::int as n from pg_stat_activity
          where datname = current_database() and ${pid}::int = any(pg_blocking_pids(pid))
        `.execute(scene.database.migrator);
        waited = (found.rows[0]?.n ?? 0) > 0;
        if (!waited) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      // The held side asks the same question as the person: its row is written before the lock goes.
      const conversation = await sql<{ id: string }>`
        insert into assistant_conversations (branch_id, account_id, role, title, created_at)
        values (${scene.north}, ${scene.adminAccount}, 'super_admin', 'Second tab.', ${new Date('2026-11-20T10:00:00+05:00')})
        returning id
      `.execute(connection);
      await sql`
        insert into assistant_messages (conversation_id, branch_id, account_id, seq, kind, content, created_at)
        values (${conversation.rows[0]?.id ?? ''}, ${scene.north}, ${scene.adminAccount}, 1, 'question',
          '{"kind":"question","text":"Second tab."}'::jsonb, ${new Date('2026-11-20T10:00:00+05:00')})
      `.execute(connection);
      await sql`commit`.execute(connection);
      return { waited, first: await first };
    });
    expect(held.waited).toBe(true);
    expect(held.first.status).toBe(409);
    await put(settingsBody());
  });

  it('counts every model call of the month against the cap, a failed one too, in whole micro-dollars rounded up once', async () => {
    await put(settingsBody({ monthlyCapDollars: 1 }));
    scene.model.script(calls({ name: 'ClassesController_list' }), answer('Read.'));
    expect((await ask(scene, scene.admin, scene.north, { text: 'Read once.' })).status).toBe(202);
    // A question that reads, then fails after it was billed: both calls count.
    scene.model.script(
      calls({ name: 'ClassesController_list' }),
      fails({ tokensIn: 500, tokensOut: 0 }),
    );
    // Task 11.16: the failure ends in its notice; the request answered 202 (plan decision 2).
    const failed = await ask(scene, scene.admin, scene.north, { text: 'Fail.' });
    expect([failed.status, noticeOf(failed)]).toEqual([202, 'assistant_model_unavailable']);
    const rows = await scene.database.migrator
      .selectFrom('assistant_model_calls')
      .selectAll()
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    // Two calls for the first question; for the second, its read's call and the billed failure.
    expect(rows.map((row) => row.cost_micros).map(String)).toEqual([
      String(costMicros(FAKE_TOKENS, REGION_PRICES)),
      String(costMicros(FAKE_TOKENS, REGION_PRICES)),
      String(costMicros(FAKE_TOKENS, REGION_PRICES)),
      String(costMicros({ tokensIn: 500, tokensOut: 0 }, REGION_PRICES)),
    ]);
    // The spend is the school's: a question asked in South is counted for North.
    expect((await ask(scene, scene.admin, scene.south, { text: 'From South.' })).status).toBe(202);
    // Reaching the cap: the month's spend from earlier calls of the school.
    await sql`
      insert into assistant_model_calls (message_id, branch_id, model, tokens_in, tokens_out, cost_micros, processed_in, created_at)
      select m.id, m.branch_id, 'fake-model', 0, 0, 1000000, 'europe-west3', ${new Date('2026-11-01T00:00:00+05:00')}
      from assistant_messages m where m.kind = 'question' and m.branch_id = ${scene.south} limit 1
    `.execute(scene.database.migrator);
    expect(await status()).toEqual(
      expect.objectContaining({ available: false, refusal: 'assistant_cap_reached' }),
    );
    const refused = await ask(scene, scene.admin, scene.north, { text: 'Over the cap.' });
    expect([refused.status, errorCode(refused)]).toEqual([409, 'assistant_cap_reached']);
    expect((await read(scene, scene.admin, '/api/classes', scene.north)).status).toBe(200);
    // A call of last month (before 1 November 00:00 in Tashkent) does not count.
    await sql`update assistant_model_calls set created_at = ${new Date('2026-10-31T23:59:00+05:00')} where cost_micros = 1000000`.execute(
      scene.database.migrator,
    );
    expect(await status()).toEqual(expect.objectContaining({ refusal: null }));
    await put(settingsBody());
  });

  it('prices a call exactly: the tokens times the prices, divided by a million, rounded up once', () => {
    expect(costMicros({ tokensIn: 1_000, tokensOut: 200 }, PRICES)).toBe(4_400n);
    expect(
      costMicros({ tokensIn: 1, tokensOut: 0 }, { priceInMicros: 2_000_001, priceOutMicros: 0 }),
    ).toBe(3n);
    expect(costMicros({ tokensIn: 0, tokensOut: 0 }, PRICES)).toBe(0n);
    expect(costMicros({ tokensIn: 3, tokensOut: 1 }, { priceInMicros: 1, priceOutMicros: 1 })).toBe(
      1n,
    );
    // No floating point: a huge count stays exact.
    expect(costMicros({ tokensIn: 2_000_000_000, tokensOut: 0 }, PRICES)).toBe(4_000_000_000n);
  });

  it('says the model is unavailable when the server has none set up, on the status and on a question', async () => {
    await put(settingsBody());
    scene.model.name = null;
    expect(await status()).toEqual(
      expect.objectContaining({ refusal: 'assistant_model_unavailable' }),
    );
    const response = await ask(scene, scene.admin, scene.north, { text: 'Anyone?' });
    expect([response.status, errorCode(response)]).toEqual([503, 'assistant_model_unavailable']);
    expect(
      await scene.database.migrator.selectFrom('assistant_messages').selectAll().execute(),
    ).toEqual([]);
    const settings = assistantSettingsSchema.parse(
      (await read(scene, scene.admin, '/api/setup/school-settings/assistant')).body,
    );
    expect(settings.modelConfigured).toBe(false);
  });
});
