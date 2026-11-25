import { Logger } from '@nestjs/common';
import {
  assistantAnswerSchema,
  assistantSettingsSchema,
  type AssistantAnswer,
} from '@sodiq/shared';
import { ASSISTANT_DATA_GROUPS } from '@sodiq/shared';
import { sql } from 'kysely';
import request from 'supertest';
import type { JsonValue } from '../../database/types.generated.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShippingLogger } from '../../monitoring/monitoring.service.js';
import {
  answer,
  calls,
  FAKE_TOKENS,
  networkFailure,
  noAnswer,
  refusedWith,
  type FakeTurn,
} from '../../testing/assistant-model.js';
import {
  ask,
  assistantScene,
  noticeOf,
  read,
  type AssistantScene,
} from '../../testing/assistant-kit.js';
import { costMicros, modelCallsOf } from './assistant.engine.js';
import { attemptsOf, RETRY_WAITS_MS } from './model-caller.js';

/**
 * Task 11.21: this file keeps the time limit of 11.15 (4 minutes) and the default reads and
 * changes of one question (40), so the attempts are bounded at twice 42.
 */
const QUESTION_MINUTES = 4;
const MAX_MODEL_ATTEMPTS = attemptsOf(modelCallsOf(40));

// Task 11.15 (pull request #379; the owner's spec change of 24 November 2026). `02`, Assistant,
// Where the model runs: "Each request goes first to the model in Frankfurt. When Frankfurt is busy
// or does not answer, the platform waits and tries again. Only when it still does not answer does
// the same request go once through Google's worldwide endpoint ... The Super Admin can switch this
// fallback off". `edge/people-roles-accounts`, The assistant: "Frankfurt is busy at 09:00" and
// "The Super Admin switches the fallback off". All names are invented.

const CLASSES = 'ClassesController_list';
const REGION_PRICES = { priceInMicros: 1_650_000, priceOutMicros: 9_900_000 };
const GLOBAL_PRICES = { priceInMicros: 1_500_000, priceOutMicros: 9_000_000 };

const busy429 = (): FakeTurn => refusedWith(429, 'RESOURCE_EXHAUSTED');

function answered(response: { status: number; body: unknown }): AssistantAnswer {
  expect(response.status, JSON.stringify(response.body).slice(0, 800)).toBe(202);
  return assistantAnswerSchema.parse(response.body);
}

describe('the assistant on the live model: retries, the worldwide fallback and the log', () => {
  let scene: AssistantScene;

  const settings = (change: Record<string, unknown> = {}) =>
    request(scene.app.getHttpServer() as Parameters<typeof request>[0])
      .put('/api/setup/school-settings/assistant')
      .set('Cookie', scene.admin)
      .send({
        schoolOn: true,
        rolesOn: ['super_admin'],
        dailyLimit: 500,
        monthlyCapDollars: 300,
        questionActions: 40,
        proposalSteps: 100,
        questionMinutes: QUESTION_MINUTES,
        fallbackOn: true,
        dataGroupsOn: [...ASSISTANT_DATA_GROUPS],
        ...change,
      });

  const calls_ = () =>
    scene.database.migrator
      .selectFrom('assistant_model_calls')
      .select(['message_id', 'processed_in', 'tokens_in', 'tokens_out', 'cost_micros'])
      .orderBy('created_at')
      .orderBy('id')
      .execute();

  /** The calls of the newest question. */
  const callsOfLast = async () => {
    const last = await scene.database.migrator
      .selectFrom('assistant_messages')
      .select('id')
      .where('kind', '=', 'question')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirstOrThrow();
    return (await calls_()).filter((row) => row.message_id === last.id);
  };

  const lastNotice = async () =>
    (
      await scene.database.migrator
        .selectFrom('assistant_messages')
        .select('content')
        .where('kind', '=', 'notice')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst()
    )?.content;

  beforeAll(async () => {
    scene = await assistantScene();
    await scene.people.schoolClass(scene.north, scene.northYear, { name: 'Oxford Q' });
    expect((await settings()).status).toBe(200);
  });

  afterAll(async () => {
    await scene.close();
  });

  beforeEach(async () => {
    scene.model.requests.length = 0;
    scene.model.places.length = 0;
    scene.model.script();
    scene.waits.length = 0;
    await settings();
  });

  it('answers after a 429 and bills only the call that answered (build plan, Done when)', async () => {
    scene.model.script(busy429(), answer('Two classes.'));
    const done = answered(await ask(scene, scene.admin, scene.north, { text: 'How many?' }));
    expect(done.conversation.messages.at(-1)).toEqual(
      expect.objectContaining({ kind: 'answer', text: 'Two classes.' }),
    );
    expect(scene.model.places).toEqual(['region', 'region']);
    expect(scene.waits).toEqual([RETRY_WAITS_MS[0]]);
    const rows = await callsOfLast();
    expect(rows.map((row) => [row.processed_in, String(row.cost_micros)])).toEqual([
      ['europe-west3', '0'],
      ['europe-west3', String(costMicros(FAKE_TOKENS, REGION_PRICES))],
    ]);
  });

  it('ends three 429 in a row with the fallback off in the "busy" notice, every call counted and none worldwide (Done when; edge, the fallback switched off)', async () => {
    expect((await settings({ fallbackOn: false })).status).toBe(200);
    scene.model.script(busy429(), busy429(), busy429(), answer('Never asked.'));
    const response = await ask(scene, scene.admin, scene.north, { text: 'Busy?' });
    expect([response.status, noticeOf(response)]).toEqual([202, 'assistant_model_busy']);
    expect(scene.model.places).toEqual(['region', 'region', 'region']);
    expect(scene.waits).toEqual([...RETRY_WAITS_MS]);
    expect((await callsOfLast()).map((row) => [row.processed_in, String(row.cost_micros)])).toEqual(
      [
        ['europe-west3', '0'],
        ['europe-west3', '0'],
        ['europe-west3', '0'],
      ],
    );
    expect(await lastNotice()).toEqual({ kind: 'notice', code: 'assistant_model_busy' });
  });

  it.each([
    ['a 503', () => refusedWith(503, 'UNAVAILABLE')],
    ['a 504', () => refusedWith(504, 'DEADLINE_EXCEEDED')],
    ['no answer in time', () => noAnswer()],
  ])('tries %s again like a 429', async (_name, turn) => {
    scene.model.script(turn(), turn(), answer('At last.'));
    answered(await ask(scene, scene.admin, scene.north, { text: 'Again?' }));
    expect(scene.model.places).toEqual(['region', 'region', 'region']);
  });

  it('sends a 504 three times to the worldwide endpoint (plan decision 1)', async () => {
    const turn = () => refusedWith(504, 'DEADLINE_EXCEEDED');
    scene.model.script(turn(), turn(), turn(), answer('Through global.'));
    answered(await ask(scene, scene.admin, scene.north, { text: 'Slow?' }));
    expect(scene.model.places).toEqual(['region', 'region', 'region', 'global']);
  });

  it.each([
    [400, 'INVALID_ARGUMENT'],
    [403, 'PERMISSION_DENIED'],
    [404, 'NOT_FOUND'],
  ])(
    'never tries a %i again and never sends it to the worldwide endpoint (Done when)',
    async (code, status) => {
      scene.model.script(refusedWith(code, status), answer('Never asked.'));
      const response = await ask(scene, scene.admin, scene.north, { text: 'Refused?' });
      expect([response.status, noticeOf(response)]).toEqual([202, 'assistant_model_unavailable']);
      expect(scene.model.places).toEqual(['region']);
      expect(scene.waits).toEqual([]);
      expect(await lastNotice()).toEqual({ kind: 'notice', code: 'assistant_model_unavailable' });
    },
  );

  it.each([
    ['a 500', () => refusedWith(500, 'INTERNAL')],
    ['a network failure', () => networkFailure()],
  ])(
    'says "cannot reach" for %s of the region, without a retry (plan decision 1)',
    async (_n, turn) => {
      scene.model.script(turn(), answer('Never asked.'));
      const response = await ask(scene, scene.admin, scene.north, { text: 'Down?' });
      expect(noticeOf(response)).toBe('assistant_model_unavailable');
      expect(scene.model.places).toEqual(['region']);
    },
  );

  it('sends the same request once to the worldwide endpoint when Frankfurt refuses three times, billed at the global price and counted in the Settings (Done when; edge, "Frankfurt is busy at 09:00")', async () => {
    const before = assistantSettingsSchema.parse(
      (await read(scene, scene.admin, '/api/setup/school-settings/assistant')).body,
    ).fallbackQuestionsThisMonth;
    scene.model.script(
      calls({ name: CLASSES }),
      busy429(),
      busy429(),
      busy429(),
      answer('Through global.'),
    );
    answered(await ask(scene, scene.admin, scene.north, { text: 'Which classes?' }));
    expect(scene.model.places).toEqual(['region', 'region', 'region', 'region', 'global']);
    // The same turns and tools as the region was sent.
    expect(scene.model.requests[4]).toEqual(scene.model.requests[1]);
    const rows = await callsOfLast();
    expect(rows.map((row) => row.processed_in)).toEqual([
      'europe-west3',
      'europe-west3',
      'europe-west3',
      'europe-west3',
      'global',
    ]);
    expect(String(rows.at(-1)?.cost_micros)).toBe(String(costMicros(FAKE_TOKENS, GLOBAL_PRICES)));
    const after = assistantSettingsSchema.parse(
      (await read(scene, scene.admin, '/api/setup/school-settings/assistant')).body,
    ).fallbackQuestionsThisMonth;
    expect(after).toBe(before + 1);
  });

  it('ends "busy" when Frankfurt was busy and the worldwide endpoint is busy too: four calls, no fifth', async () => {
    scene.model.script(busy429(), busy429(), busy429(), busy429(), answer('Never asked.'));
    const response = await ask(scene, scene.admin, scene.north, { text: 'Busy everywhere?' });
    expect(noticeOf(response)).toBe('assistant_model_busy');
    expect(scene.model.places).toEqual(['region', 'region', 'region', 'global']);
  });

  it.each([
    ['a 404', () => refusedWith(404, 'NOT_FOUND')],
    ['a 500', () => refusedWith(500, 'INTERNAL')],
  ])(
    'ends "busy" when Frankfurt was busy and the worldwide endpoint answers %s (plan decision 4a), with a log line for it',
    async (_name, turn) => {
      const lines = catchLines();
      try {
        scene.model.script(busy429(), busy429(), busy429(), turn(), answer('Never asked.'));
        const response = await ask(scene, scene.admin, scene.north, { text: 'And global?' });
        expect(noticeOf(response)).toBe('assistant_model_busy');
      } finally {
        lines.stop();
      }
      expect(lines.texts.filter((text) => text.includes('region global'))).toHaveLength(1);
    },
  );

  it('never sends a 404 from Frankfurt to the worldwide endpoint, with the fallback on (Done when)', async () => {
    scene.model.script(refusedWith(404, 'NOT_FOUND'), answer('Never asked.'));
    const response = await ask(scene, scene.admin, scene.north, { text: 'Not found?' });
    expect(noticeOf(response)).toBe('assistant_model_unavailable');
    expect(scene.model.places).not.toContain('global');
  });

  it('sends the next question to Frankfurt only once the fallback is switched off, and keeps the place of an earlier answer (edge, the fallback switched off)', async () => {
    scene.model.script(busy429(), busy429(), busy429(), answer('Through global.'));
    answered(await ask(scene, scene.admin, scene.north, { text: 'Earlier.' }));
    const earlier = await callsOfLast();
    expect(earlier.at(-1)?.processed_in).toBe('global');
    expect((await settings({ fallbackOn: false })).status).toBe(200);
    scene.model.places.length = 0;
    scene.model.script(busy429(), busy429(), busy429(), answer('Never asked.'));
    const response = await ask(scene, scene.admin, scene.north, { text: 'Later.' });
    expect(noticeOf(response)).toBe('assistant_model_busy');
    expect(scene.model.places).toEqual(['region', 'region', 'region']);
    const all = await calls_();
    expect(all.filter((row) => row.message_id === earlier.at(-1)?.message_id)).toEqual(earlier);
  });

  it('audits a change of the fallback switch as a setting, old and new value', async () => {
    const entries = () =>
      scene.database.migrator
        .selectFrom('audit_log_school')
        .selectAll()
        .where('action', '=', 'assistant_settings.change')
        .orderBy('occurred_at')
        .orderBy('id')
        .execute();
    const before = await entries();
    expect((await settings({ fallbackOn: false })).status).toBe(200);
    const after = await entries();
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)).toEqual(
      expect.objectContaining({
        actor_id: scene.adminAccount,
        old_value: expect.objectContaining({ fallbackOn: true }) as unknown,
        new_value: expect.objectContaining({ fallbackOn: false }) as unknown,
      }),
    );
  });

  it('ends a Teacher’s question "busy" in the Teacher’s own conversation, through the worldwide endpoint too', async () => {
    expect((await settings({ rolesOn: ['super_admin', 'teacher'] })).status).toBe(200);
    const teaching = await scene.kit.fullSession('Bekzod', 'Busyov');
    await scene.kit.giveRole(teaching.account.id, { role: 'teacher', branchId: scene.north });
    scene.model.script(busy429(), busy429(), busy429(), busy429(), answer('Never asked.'));
    const response = await ask(scene, teaching.cookie, scene.north, {
      text: 'My lessons?',
      role: 'teacher',
    });
    expect([response.status, noticeOf(response)]).toEqual([202, 'assistant_model_busy']);
    expect(scene.model.places).toEqual(['region', 'region', 'region', 'global']);
    const notice = await scene.database.migrator
      .selectFrom('assistant_messages')
      .innerJoin(
        'assistant_conversations',
        'assistant_conversations.id',
        'assistant_messages.conversation_id',
      )
      .select([
        'assistant_messages.content',
        'assistant_conversations.account_id',
        'assistant_conversations.role',
      ])
      .where('assistant_messages.kind', '=', 'notice')
      .orderBy('assistant_messages.id', 'desc')
      .limit(1)
      .executeTakeFirstOrThrow();
    expect(notice).toEqual({
      content: { kind: 'notice', code: 'assistant_model_busy' },
      account_id: teaching.account.id,
      role: 'teacher',
    });
  });

  it('bounds the calls of a question, every retry and fallback counted (.claude/rules/api.md)', async () => {
    // Frankfurt always busy, the worldwide endpoint always asks to read again: four calls a turn.
    scene.model.script(
      ...Array.from({ length: MAX_MODEL_ATTEMPTS + 8 }, (_, index) =>
        index % 4 === 3 ? calls({ name: CLASSES }) : busy429(),
      ),
    );
    const response = await ask(scene, scene.admin, scene.north, { text: 'Forever?' });
    expect(noticeOf(response)).toBe('assistant_model_busy');
    expect(scene.model.requests).toHaveLength(MAX_MODEL_ATTEMPTS);
  });

  it('makes no retry and no fallback that would pass the question’s time limit', async () => {
    const late: FakeTurn = () => {
      // Answered 215 s after the question began: a wait and a call no longer fit.
      scene.clock.advance(215_000);
      return busy429()(scene.model.requests[0] ?? { system: '', turns: [], tools: [] }, 'region');
    };
    scene.model.script(late, answer('Never asked.'));
    const response = await ask(scene, scene.admin, scene.north, { text: 'Late?' });
    expect(noticeOf(response)).toBe('assistant_model_busy');
    expect(scene.model.places).toEqual(['region']);
  });

  it('sends no turn with tools that would leave no time for a last call, and answers with Continue (task 11.21, review of the plan, must fix 3)', async () => {
    const slowRead: FakeTurn = (request, place) => {
      scene.clock.advance(185_000);
      return calls({ name: CLASSES })(request, place);
    };
    scene.model.script(slowRead, answer('Read the classes; the rest is left.'));
    const done = answered(await ask(scene, scene.admin, scene.north, { text: 'Slow read?' }));
    expect(done.conversation.messages.at(-1)).toEqual(
      expect.objectContaining({ kind: 'answer', continues: true }),
    );
    expect(scene.model.requests).toHaveLength(2);
    expect(scene.model.requests[1]?.tools).toEqual([]);
  });

  it('ends "busy" when even the last call no longer fits the time limit', async () => {
    const slowRead: FakeTurn = (request, place) => {
      scene.clock.advance(215_000);
      return calls({ name: CLASSES })(request, place);
    };
    scene.model.script(slowRead, answer('Never asked.'));
    const response = await ask(scene, scene.admin, scene.north, { text: 'Slow read?' });
    expect(noticeOf(response)).toBe('assistant_model_busy');
    expect(scene.model.requests).toHaveLength(1);
    // The read already made stays in the conversation.
    const reads = await scene.database.migrator
      .selectFrom('assistant_messages')
      .select('kind')
      .where('kind', '=', 'read')
      .execute();
    expect(reads.length).toBeGreaterThan(0);
  });

  it('logs each refused call with Google’s code, status word, the model and the region, and nothing of the question (Done when)', async () => {
    const lines = catchLines();
    try {
      scene.model.script(calls({ name: CLASSES }), busy429(), noAnswer(), answer('Done.'));
      answered(
        await ask(scene, scene.admin, scene.north, { text: 'Zebra quokka marmalade classes' }),
      );
    } finally {
      lines.stop();
    }
    const refused = lines.texts.filter((text) => text.startsWith('Model call refused'));
    expect(refused).toEqual([
      'Model call refused: 429 RESOURCE_EXHAUSTED, model fake-model, region europe-west3, attempt 2 Assistant',
      'Model call refused: none TIMEOUT, model fake-model, region europe-west3, attempt 3 Assistant',
    ]);
    const all = lines.texts.join('\n');
    for (const word of ['Zebra', 'quokka', 'marmalade', 'Oxford Q']) {
      expect(all).not.toContain(word);
    }
  });

  it('leaves a failed question out of the turns of the next question in the same conversation (Done when)', async () => {
    scene.model.script(answer('First answer.'));
    const first = answered(await ask(scene, scene.admin, scene.north, { text: 'First question.' }));
    const conversationId = first.conversation.id;
    scene.model.script(refusedWith(404, 'NOT_FOUND'));
    const failed = await ask(scene, scene.admin, scene.north, {
      text: 'Failed question.',
      conversationId,
    });
    expect([failed.status, noticeOf(failed)]).toEqual([202, 'assistant_model_unavailable']);
    scene.model.requests.length = 0;
    scene.model.script(answer('Third answer.'));
    answered(
      await ask(scene, scene.admin, scene.north, { text: 'Third question.', conversationId }),
    );
    const turns = scene.model.requests[0]?.turns ?? [];
    expect(turns.map((turn) => turn.role)).toEqual(['person', 'model', 'person']);
    expect(JSON.stringify(turns)).not.toContain('Failed question.');
    expect(JSON.stringify(turns.at(-1))).toContain('Third question.');
  });
});

describe('the place of a model call and the count of the fallback (0180)', () => {
  let scene: AssistantScene;

  beforeAll(async () => {
    scene = await assistantScene();
  });

  afterAll(async () => {
    await scene.close();
  });

  /** A question of its own conversation in a branch, stored directly. */
  async function question(branchId: string): Promise<string> {
    const db = scene.database.migrator;
    const conversation = await db
      .insertInto('assistant_conversations')
      .values({
        branch_id: branchId,
        account_id: scene.adminAccount,
        role: 'super_admin',
        title: 'Invented',
        created_at: new Date('2026-11-20T10:00:00+05:00'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const message = await db
      .insertInto('assistant_messages')
      .values({
        conversation_id: conversation.id,
        branch_id: branchId,
        account_id: scene.adminAccount,
        seq: 1,
        kind: 'question',
        content: sql<JsonValue>`'{"kind":"question","text":"Invented."}'::jsonb`,
        created_at: new Date('2026-11-20T10:00:00+05:00'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return message.id;
  }

  function call(messageId: string, branchId: string, processedIn: string | null, at: string) {
    return sql`
      insert into assistant_model_calls
        (message_id, branch_id, model, tokens_in, tokens_out, cost_micros, processed_in, created_at)
      values (${messageId}, ${branchId}, 'fake-model', 0, 0, 0, ${processedIn}, ${new Date(at)})
    `.execute(scene.database.migrator);
  }

  const novemberCount = async () =>
    Number(
      (
        await sql<{ count: string }>`
          select assistant_fallback_questions_between(
            ${new Date('2026-11-01T00:00:00+05:00')}, ${new Date('2026-12-01T00:00:00+05:00')}
          ) as count
        `.execute(scene.database.migrator)
      ).rows[0]?.count,
    );

  it('refuses a new call without a place, or with a place of another shape', async () => {
    const id = await question(scene.north);
    await expect(call(id, scene.north, null, '2026-11-20T10:00:00+05:00')).rejects.toThrow(
      /assistant_model_calls_processed_in_check/,
    );
    await expect(call(id, scene.north, 'Frankfurt', '2026-11-20T10:00:00+05:00')).rejects.toThrow(
      /assistant_model_calls_processed_in_check/,
    );
    await call(id, scene.north, 'europe-west3', '2026-11-20T10:00:00+05:00');
    await call(id, scene.north, 'global', '2026-11-20T10:00:00+05:00');
  });

  it('counts each question of the month with a worldwide call once, in every branch, and no other', async () => {
    const before = await novemberCount();
    const twice = await question(scene.north);
    await call(twice, scene.north, 'global', '2026-11-20T10:00:00+05:00');
    await call(twice, scene.north, 'global', '2026-11-20T10:00:01+05:00');
    const south = await question(scene.south);
    await call(south, scene.south, 'global', '2026-11-20T11:00:00+05:00');
    const regionOnly = await question(scene.north);
    await call(regionOnly, scene.north, 'europe-west3', '2026-11-20T12:00:00+05:00');
    // At the edges of the month in Tashkent: the first moment of December, the last of October.
    const december = await question(scene.north);
    await call(december, scene.north, 'global', '2026-12-01T00:00:00+05:00');
    const october = await question(scene.north);
    await call(october, scene.north, 'global', '2026-10-31T23:59:59+05:00');
    expect(await novemberCount()).toBe(before + 2);
  });
});

/** The lines the process's logger writes while a test runs, as `main.ts` sets it. */
function catchLines(): { texts: string[]; stop: () => void } {
  const texts: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  Logger.overrideLogger(new ShippingLogger());
  ShippingLogger.sink = (_level, text) => {
    texts.push(text);
  };
  return {
    texts,
    stop: () => {
      ShippingLogger.sink = undefined;
      vi.restoreAllMocks();
    },
  };
}
