import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { assistantAnswerSchema, BRANCH_HEADER } from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../config/config.js';
import { loadLocalEnvFile } from '../../../database/config.js';
import { settle } from '../../../testing/assistant-kit.js';
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
import { verdictLines, verdictOf } from './verdict.js';

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
    let prices = { priceInMicros: 1_650_000, priceOutMicros: 9_900_000 };

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

    /** The teacher who asks the Teacher's cases: the one `argsOf` names as `staffId`. */
    function askingTeacher() {
      const branch = school.branches[0];
      return branch === undefined ? undefined : [...branch.teachers.values()][0];
    }

    /**
     * Task 11.14: the body of a Teacher's proposal in the replay, from the teacher's first lesson
     * of the first quarter (its journal and quarter); the real model finds them by reading.
     */
    async function proposalArgsOf(route: string): Promise<Record<string, unknown>> {
      const teacher = askingTeacher();
      const lesson = await database.migrator
        .selectFrom('lessons')
        .select(['id', 'class_id', 'group_id', 'subject_id'])
        .where('teacher_id', '=', teacher?.staffId ?? '')
        .where('cancel_cause', 'is', null)
        .orderBy('starts_at')
        .orderBy('id')
        .executeTakeFirstOrThrow();
      let journals = database.migrator
        .selectFrom('journals')
        .select('id')
        .where('subject_id', '=', lesson.subject_id);
      journals =
        lesson.class_id === null
          ? journals.where('group_id', '=', lesson.group_id)
          : journals.where('class_id', '=', lesson.class_id);
      const journal = (await journals.executeTakeFirstOrThrow()).id;
      const quarterId = school.branches[0]?.quarterIds[0];
      const summary = 'For my first lesson.';
      if (route === 'POST /api/plans/journals/:journalId/items') {
        const values = {
          topic: 'Fractions',
          objectives: '',
          links: [],
          classworks: [],
          homeworks: [],
        };
        return {
          journalId: journal,
          body: { quarterId, position: 1, lessonId: lesson.id, values },
          summary,
        };
      }
      if (route === 'POST /api/plans/requests/:requestId/send') {
        // The demo has no prepared request before the year: a step on its id is stored, never
        // run (the real model reads the requests first).
        return { requestId: randomUUID(), body: {}, summary };
      }
      if (route === 'POST /api/journal/lessons/:lessonId/unlocks') {
        return { lessonId: lesson.id, body: { reason: 'The marks came late.' }, summary };
      }
      return {
        journalId: journal,
        body: { kind: 'text', quarterId, lessonIds: [lesson.id], reason: 'A clearer topic.' },
        summary,
      };
    }

    async function replayOf(one: EvalCase): Promise<FakeTurn[]> {
      const intent = one.intent;
      const toolRoute = (name: string) =>
        Object.keys(assistantRoutesOf(intent.role ?? 'super_admin')).find(
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
          if (intent.proposes !== undefined) {
            const name = `propose_${GENERATED_TOOLS[intent.proposes]?.name ?? ''}`.slice(0, 64);
            return [
              calls({ name, args: await proposalArgsOf(intent.proposes) }),
              answer('Here is the proposal; nothing changes until you confirm.'),
            ];
          }
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
        prices = config.prices.region;
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
        // Task 11.15, build plan item (8): the test set asks Frankfurt only (plan decision 10).
        .set({
          school_on: true,
          roles_on: ['super_admin', 'teacher'],
          daily_limit: 500,
          fallback_on: false,
        })
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
          ...verdictLines(
            verdictOf(
              outcomes.map((one) => ({
                language: one.case.language,
                kind: one.case.intent.kind,
                passed: one.passed,
              })),
            ),
          ),
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

    it('has 136 cases: 20 intents of the Super Admin and 14 of the Teacher (11.14), each in Uzbek Latin, Uzbek Cyrillic, Russian and English', () => {
      expect(EVAL_CASES).toHaveLength(136);
      expect(EVAL_CASES.filter((one) => one.intent.role === 'teacher')).toHaveLength(56);
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
          fake.script(...(await replayOf(one)));
        }
        const before = (
          await database.migrator
            .selectFrom('assistant_model_calls')
            .select('cost_micros')
            .execute()
        ).length;
        const cookie =
          one.intent.role === 'teacher'
            ? (askingTeacher()?.account.caller.cookies ?? '')
            : school.superAdmin.caller.cookies;
        const branch = school.branches[0]?.id ?? '';
        const response = await request(app.getHttpServer() as Parameters<typeof request>[0])
          .post('/api/assistant/questions')
          .set('Cookie', cookie)
          .set(BRANCH_HEADER, branch)
          .send({ role: one.intent.role ?? 'super_admin', text: one.text });
        expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(202);
        await settle(app, response, cookie, branch);
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
        } else if (intent.proposes !== undefined) {
          // Task 11.14: a Teacher's change is proposed, never made.
          const action = GENERATED_TOOLS[intent.proposes]?.name;
          const proposal = conversation.proposals.at(-1);
          if (proposal?.steps.some((step) => step.action === action) !== true)
            why = `did not propose ${intent.proposes}`;
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
