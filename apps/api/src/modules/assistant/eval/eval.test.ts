import type { NestExpressApplication } from '@nestjs/platform-express';
import { assistantAnswerSchema, BRANCH_HEADER } from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../config/config.js';
import { loadLocalEnvFile } from '../../../database/config.js';
import {
  answer,
  calls,
  FakeModel,
  lastResults,
  type FakeTurn,
} from '../../../testing/assistant-model.js';
import { createTestApp } from '../../../testing/create-test-app.js';
import { SETUP_MOMENT } from '../../../testing/demo/data.js';
import { buildDemoSchool, type DemoSchool } from '../../../testing/demo/school.js';
import { FixedClock } from '../../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../../testing/test-database.js';
import { assistantRoutesOf } from '../../access/assistant-routes.js';
import { costMicros } from '../assistant.engine.js';
import { GeminiModel } from '../gemini-model.js';
import type { AssistantModel, ModelRequest } from '../model.js';
import { GENERATED_TOOLS } from '../tools.generated.js';
import { EVAL_CASES, type EvalCase } from './cases.js';

// Task 11.12, the test set (build plan: "CI runs it against the fake model; `pnpm assistant:eval`
// runs it against the real model and prints accuracy and cost per request, and only the owner
// runs it"). Against the demo school's setup (`buildDemoSchool`), without its daily journals
// (plan decision 17). In CI the fake model replays each case's expected calls: each read is on
// the list, is sent and passes the filter; each forbidden step is refused by the engine and its
// page linked. With `--mode assistant-eval` the real model (the owner's credentials in `.env`)
// answers the words, and the file prints how often it did what the case expects.

const REAL = process.env.MODE === 'assistant-eval';
const DEMO_PASSWORD = 'demo-eval-password-1';

interface Outcome {
  case: EvalCase;
  passed: boolean;
  why: string;
  costMicros: bigint;
}

describe(
  REAL ? 'the test set against the real model' : 'the test set against the fake model',
  () => {
    let database: TestDatabase;
    let app: NestExpressApplication;
    let school: DemoSchool;
    let model: AssistantModel;
    const fake = new FakeModel();
    const outcomes: Outcome[] = [];
    let prices = { priceInMicros: 2_000_000, priceOutMicros: 12_000_000 };

    /** The demo's ids for a tool's parameters, by name; dates of the first school week. */
    function argsOf(route: string): Record<string, unknown> {
      const branch = school.branches[0];
      const firstClass = branch?.classes[0];
      const teacher = branch === undefined ? undefined : [...branch.teachers.keys()][0];
      const args: Record<string, unknown> = {};
      for (const parameter of GENERATED_TOOLS[route]?.parameters ?? []) {
        const schema = parameter.schema as { format?: string; enum?: string[] };
        const name = parameter.name;
        if (!parameter.required && name !== 'quarterId') continue;
        if (name === 'classId' || (name === 'id' && route.includes('/classes')))
          args[name] = firstClass?.id;
        else if (name === 'quarterId') args[name] = branch?.quarterIds[0];
        else if (name === 'yearId') args[name] = branch?.yearId;
        else if (name === 'staffId') args[name] = teacher;
        else if (schema.format === 'date') args[name] = '2026-09-08';
        else if (schema.enum !== undefined)
          args[name] = schema.enum.includes('week') ? 'week' : schema.enum[0];
      }
      return args;
    }

    function replayOf(one: EvalCase): FakeTurn[] {
      const intent = one.intent;
      const toolRoute = (name: string) =>
        Object.keys(assistantRoutesOf('super_admin')).find(
          (route) => GENERATED_TOOLS[route]?.name === name,
        ) ?? '';
      switch (intent.kind) {
        case 'read':
          return [
            calls(...intent.reads.map((name) => ({ name, args: argsOf(toolRoute(name)) }))),
            answer('Here is what the platform says.'),
          ];
        case 'vague':
          return [answer('Which classes and which slots do you mean?')];
        case 'forbidden':
          return [
            calls(
              { name: intent.temptation ?? '' },
              { name: 'suggest_page', args: { page: intent.page } },
            ),
            answer('This is done on its page.'),
          ];
        case 'change':
          return [
            calls({ name: 'suggest_page', args: { page: intent.page } }),
            answer('Changes are made on their page.'),
          ];
      }
    }

    beforeAll(async () => {
      loadLocalEnvFile();
      if (REAL) {
        const config = loadConfig(process.env).assistant;
        if (config.vertex === undefined) {
          throw new Error(
            'pnpm assistant:eval needs ASSISTANT_VERTEX_PROJECT and ASSISTANT_VERTEX_CREDENTIALS in .env.',
          );
        }
        model = new GeminiModel(config);
        prices = { priceInMicros: config.priceInMicros, priceOutMicros: config.priceOutMicros };
      } else {
        model = fake;
      }
      database = await createTestDatabase();
      const clock = new FixedClock(SETUP_MOMENT);
      app = await createTestApp({
        database: database.app,
        jobsDatabaseUrl: database.appUrl,
        clock,
        assistantModel: model,
        listen: true,
      });
      school = await buildDemoSchool({
        app,
        migrator: database.migrator,
        clock,
        password: DEMO_PASSWORD,
        say: () => undefined,
      });
      await database.migrator
        .updateTable('assistant_settings')
        .set({ school_on: true, roles_on: ['super_admin'], daily_limit: 500 })
        .execute();
    }, 1_200_000);

    afterAll(async () => {
      if (REAL && outcomes.length > 0) {
        const passed = outcomes.filter((one) => one.passed).length;
        const cost = outcomes.reduce((sum, one) => sum + one.costMicros, 0n);
        const lines = [
          `Assistant test set: ${String(passed)} of ${String(outcomes.length)} as expected (${String(Math.round((passed * 100) / outcomes.length))}%).`,
          `Cost: ${(Number(cost) / 1e6).toFixed(4)} $ in all, ${(Number(cost) / 1e6 / outcomes.length).toFixed(5)} $ per request.`,
          ...['read', 'vague', 'forbidden', 'change'].map((kind) => {
            const of = outcomes.filter((one) => one.case.intent.kind === kind);
            return `  ${kind}: ${String(of.filter((one) => one.passed).length)} of ${String(of.length)}`;
          }),
          ...['uz', 'uz-Cyrl', 'ru', 'en'].map((language) => {
            const of = outcomes.filter((one) => one.case.language === language);
            return `  ${language}: ${String(of.filter((one) => one.passed).length)} of ${String(of.length)}`;
          }),
          ...outcomes
            .filter((one) => !one.passed)
            .map((one) => `  not as expected: ${one.case.id}: ${one.why}`),
        ];
        // Written past Vitest's console, which this repository keeps quiet.
        process.stdout.write(`${lines.join('\n')}\n`);
      }
      await app.close();
      await database.destroy();
    });

    it('has about 80 cases: 20 intents in Uzbek Latin, Uzbek Cyrillic, Russian and English', () => {
      expect(EVAL_CASES).toHaveLength(80);
      const names = new Set(Object.values(GENERATED_TOOLS).map((tool) => tool.name));
      for (const one of EVAL_CASES) {
        for (const read of one.intent.reads) {
          expect(names.has(read), `${one.id}: ${read}`).toBe(true);
        }
        // A temptation is never a tool of the list.
        expect(
          one.intent.temptation === undefined || !names.has(one.intent.temptation),
          one.id,
        ).toBe(true);
      }
    });

    for (const one of EVAL_CASES) {
      it(`case ${one.id}`, { timeout: 120_000 }, async () => {
        if (!REAL) {
          fake.requests.length = 0;
          fake.script(...replayOf(one));
        }
        const before = (
          await database.migrator
            .selectFrom('assistant_model_calls')
            .select('cost_micros')
            .execute()
        ).length;
        const response = await request(app.getHttpServer() as Parameters<typeof request>[0])
          .post('/api/assistant/questions')
          .set('Cookie', school.superAdmin.caller.cookies)
          .set(BRANCH_HEADER, school.branches[0]?.id ?? '')
          .send({ role: 'super_admin', text: one.text });
        expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
        const conversation = assistantAnswerSchema.parse(response.body).conversation;
        const reads = await database.migrator
          .selectFrom('assistant_messages')
          .select('content')
          .where('conversation_id', '=', conversation.id)
          .where('kind', '=', 'read')
          .orderBy('seq')
          .execute();
        const made = reads.map(
          (row) => row.content as { tool: string; status: number; route: string | null },
        );
        const last = conversation.messages.at(-1);
        const pages = last?.kind === 'answer' ? last.pages : [];
        const text = last?.kind === 'answer' ? last.text : '';
        const calls_ = (
          await database.migrator
            .selectFrom('assistant_model_calls')
            .select(['tokens_in', 'tokens_out'])
            .execute()
        ).slice(before);
        const cost = calls_.reduce(
          (sum, row) =>
            sum + costMicros({ tokensIn: row.tokens_in, tokensOut: row.tokens_out }, prices),
          0n,
        );
        const intent = one.intent;
        let why = '';
        if (intent.kind === 'read') {
          const missing = intent.reads.filter(
            (name) => !made.some((read) => read.tool === name && read.status > 0),
          );
          if (missing.length > 0) why = `did not read ${missing.join(', ')}`;
        } else if (intent.kind === 'vague') {
          if (made.length > 0) why = 'read instead of asking';
          else if (!text.includes('?')) why = 'did not ask a question';
        } else {
          if (made.some((read) => read.route !== null && read.status === 0))
            why = 'sent a read that was refused';
          if (intent.page !== undefined && !pages.includes(intent.page))
            why = `did not link ${intent.page}`;
        }
        outcomes.push({ case: one, passed: why === '', why, costMicros: cost });
        if (!REAL) {
          // The replay must do what the case expects: the engine and the list are what is tested.
          expect(why, one.id).toBe('');
          // Every replayed read is answered by the platform (spec review of the code, should fix 5).
          for (const read of made.filter((entry) => entry.route !== null)) {
            expect(read.status, `${one.id} ${read.tool}`).toBe(200);
          }
          if (intent.kind === 'forbidden') {
            const given = lastResults(fake.requests.at(-1) as ModelRequest);
            expect(given[0]?.result, one.id).toEqual({ error: 'not_open_to_assistant' });
          }
        }
      });
    }
  },
);
