import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { assistantAnswerSchema, BRANCH_HEADER, spellingKey } from '@sodiq/shared';
import { ASSISTANT_KINDS_WITHOUT_TOOL, assistantDefaultOn } from '@sodiq/shared';
import request from 'supertest';
import { sql } from 'kysely';
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
import { ROUTE_LINES } from '../../access/assistant-routes.js';
import { AssistantRoutes } from '../../access/assistant-routes.check.js';
import { costMicros } from '../assistant.engine.js';
import { GeminiModel } from '../gemini-model.js';
import type { AssistantModel, ModelRequest } from '../model.js';
import { GENERATED_TOOLS } from '../tools.generated.js';
import { DRAFT_PLAN_UNIT, EXPLAIN_RESULT, HELPER_TOOLS } from '../helpers.js';
import { EVAL_CASES, type EvalCase } from './cases.js';
import { HOW_INTENTS, type HowIntent } from './how-cases.js';
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

/** Every object of the map's answers to the model (a hit, a page explained) with this id. */
function mapAnswersOf(requests: readonly ModelRequest[], id: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (record.id === id) out.push(record);
      Object.values(record).forEach(walk);
    }
  };
  for (const request of requests) {
    for (const turn of request.turns) {
      for (const part of turn.parts) {
        if (
          part.kind === 'result' &&
          (part.name === 'find_in_platform' || part.name === 'explain_place')
        ) {
          walk(part.result);
        }
      }
    }
  }
  return out;
}

/**
 * Task 11.19: why a `how` answer is not as expected, or ''. In CI (the fake model) the search
 * of the map, what it gave and the link are scored; against the real model also the steps and,
 * for an action the role cannot take, that the answer names a role that can (plan test 6).
 */
function howFault(
  how: HowIntent,
  requests: readonly ModelRequest[],
  pages: readonly string[],
  text: string,
  proposals: number,
  real: boolean,
  offered: (route: string) => boolean,
): string {
  const found = mapAnswersOf(requests, how.finds);
  if (found.length === 0) return `did not find ${how.finds}`;
  if (how.cannot !== undefined) {
    if (found.some((one) => one.youSeeIt !== false)) return 'the map says the role sees it';
    if (pages.length > 0) return 'linked a page for an action the role cannot take';
    const folded = spellingKey(text);
    if (real && !how.cannot.roleWords.some((word) => folded.includes(word))) {
      return 'did not name the role that can';
    }
  } else if (how.page !== undefined && !pages.includes(how.page)) {
    return `did not link ${how.page}`;
  }
  if (how.offers !== undefined) {
    // Task 11.20: the action is on the role's list and on (a tool by find_actions or by name).
    if (!offered(how.offers)) {
      return `${how.offers} is not on the role's list`;
    }
    if (proposals > 0) return 'proposed before the person agreed';
    // Review should fix 6: against the real model the answer offers to do it, as a question.
    if (real && !text.includes('?')) return 'did not offer to do it';
  }
  if (real && !/(^|\n)\s*(\d+[.)]|-)\s/.test(text)) return 'gave no steps';
  return '';
}

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
    /** Task 11.19: every request of the case, real or fake, to score what the map gave. */
    const sent: ModelRequest[] = [];
    function recording(inner: AssistantModel): AssistantModel {
      return {
        get name() {
          return inner.name;
        },
        locationOf: (place) => inner.locationOf(place),
        generate: (request, place, onText) => {
          sent.push(request);
          return inner.generate(request, place, onText);
        },
      };
    }
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
      // Task 11.20: the journal's entries for the lesson's students, as the real model reads them.
      if (
        route === 'POST /api/journal/lessons/:lessonId/attendance' ||
        route === 'POST /api/journal/lessons/:lessonId/scores'
      ) {
        const students = (
          await sql<{
            s: string;
          }>`select s from lesson_expected_students(${lesson.id}::uuid) s order by s`.execute(
            database.migrator,
          )
        ).rows.map((row) => row.s);
        if (route.endsWith('/attendance')) {
          return {
            lessonId: lesson.id,
            body: { saves: students.map((studentId) => ({ studentId, mark: 1, version: null })) },
            summary,
          };
        }
        const work = await database.migrator
          .selectFrom('journal_works')
          .select('id')
          .where('lesson_id', '=', lesson.id)
          .executeTakeFirst();
        return {
          lessonId: lesson.id,
          body: {
            saves: students.slice(0, 1).map((studentId) => ({
              studentId,
              column: { workId: work?.id ?? randomUUID() },
              score: 9,
              version: null,
            })),
          },
          summary,
        };
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

    /** Task 11.23: the demo's ids for a helper, as the real model would read them first. */
    async function helperArgsOf(name: string): Promise<Record<string, unknown>> {
      if (name === DRAFT_PLAN_UNIT) {
        const item = await proposalArgsOf('POST /api/plans/journals/:journalId/items');
        const body = item.body as { quarterId?: string };
        return { journalId: item.journalId, quarterId: body.quarterId, count: 3 };
      }
      if (name === EXPLAIN_RESULT) {
        const branch = school.branches[0];
        return {
          studentId: branch?.classes[0]?.students[0]?.id,
          subjectId: [...school.subjects.values()][0],
          quarterId: branch?.quarterIds[0],
        };
      }
      return {};
    }

    async function replayOf(one: EvalCase): Promise<FakeTurn[]> {
      const intent = one.intent;
      const toolRoute = (name: string) =>
        Object.keys(ROUTE_LINES).find((route) => GENERATED_TOOLS[route]?.name === name) ?? '';
      switch (intent.kind) {
        case 'read':
          return [
            calls(
              ...(await Promise.all(
                intent.reads.map(async (name) => ({
                  name,
                  args: HELPER_TOOLS.includes(name)
                    ? await helperArgsOf(name)
                    : argsOf(toolRoute(name)),
                })),
              )),
            ),
            answer('Here is what the platform says.'),
          ];
        case 'vague':
          return [answer('Which classes and which slots do you mean?')];
        case 'forbidden':
          return [
            calls(
              { name: intent.temptation ?? '' },
              { name: 'link_place', args: { page: intent.page } },
            ),
            answer('This is done on its page.'),
          ];
        case 'how': {
          // Task 11.19: a search of the map, the link of the page the role opens, the steps.
          const how = intent.how;
          return [
            calls(
              { name: 'find_in_platform', args: { words: how?.search ?? '' } },
              ...(how?.page === undefined
                ? []
                : [{ name: 'link_place', args: { page: how.page } }]),
            ),
            answer('1. Open the page. 2. Press the button.'),
          ];
        }
        case 'change':
          if (intent.proposes !== undefined) {
            const name = `propose_${GENERATED_TOOLS[intent.proposes]?.name ?? ''}`.slice(0, 64);
            return [
              calls({ name, args: await proposalArgsOf(intent.proposes) }),
              answer('Here is the proposal; nothing changes until you confirm.'),
            ];
          }
          return [
            calls({ name: 'link_place', args: { page: intent.page } }),
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
        model = recording(new GeminiModel(config));
        prices = config.prices.region;
      } else {
        model = recording(fake);
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
          roles_on: ['super_admin', 'academic_vice_principal', 'teacher'],
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
          ...['read', 'vague', 'forbidden', 'change', 'how'].map((kind) => {
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

    // Task 11.19: 136 became 256, the requirement added 30 questions of the map (build plan,
    // Done when), 12 of the Super Admin, 9 of the Academic Vice Principal and 9 of the Teacher.
    // Task 11.21: 256 became 268, three intents of tables and choices (plan, Tests).
    it('has 268 cases: 23 intents of the Super Admin and 14 of the Teacher (11.14), and 30 of the map (11.19), each in Uzbek Latin, Uzbek Cyrillic, Russian and English', () => {
      expect(EVAL_CASES).toHaveLength(268);
      expect(EVAL_CASES.filter((one) => one.intent.role === 'teacher')).toHaveLength(56 + 36);
      expect(EVAL_CASES.filter((one) => one.intent.kind === 'how')).toHaveLength(120);
      expect(HOW_INTENTS.filter((one) => one.role === 'super_admin')).toHaveLength(12);
      expect(HOW_INTENTS.filter((one) => one.role === 'academic_vice_principal')).toHaveLength(9);
      expect(HOW_INTENTS.filter((one) => one.cannot !== undefined).length).toBeGreaterThanOrEqual(
        6,
      );
      // One intent per role offers what the role's list proposes (review correction 1).
      for (const role of ['super_admin', 'academic_vice_principal', 'teacher'] as const) {
        const offer = HOW_INTENTS.find((one) => one.role === role && one.offers !== undefined);
        expect(
          Object.hasOwn(app.get(AssistantRoutes).linesOf(role), offer?.offers ?? ''),
          role,
        ).toBe(true);
      }
      const names = new Set(Object.values(GENERATED_TOOLS).map((tool) => tool.name));
      const listed = app.get(AssistantRoutes);
      for (const one of EVAL_CASES) {
        for (const read of one.intent.reads) {
          expect(names.has(read) || HELPER_TOOLS.includes(read), `${one.id}: ${read}`).toBe(true);
        }
        // Task 11.20: a temptation is an action with no tool yet, or one off at the start.
        const tempting = Object.keys(listed.linesOf(one.intent.role ?? 'super_admin')).find(
          (route) => GENERATED_TOOLS[route]?.name === one.intent.temptation,
        );
        const facts = tempting === undefined ? undefined : listed.factsOf(tempting);
        expect(
          one.intent.temptation === undefined ||
            (facts !== undefined &&
              (ASSISTANT_KINDS_WITHOUT_TOOL.includes(facts.kind) ||
                !assistantDefaultOn(facts.area, tempting ?? '', facts.kind))),
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
        sent.length = 0;
        const cookie =
          one.intent.role === 'teacher'
            ? (askingTeacher()?.account.caller.cookies ?? '')
            : one.intent.role === 'academic_vice_principal'
              ? (school.branches[0]?.vice.caller.cookies ?? '')
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
        const pages = last?.kind === 'answer' ? last.links.map((link) => link.to) : [];
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
        } else if (intent.kind === 'how' && intent.how !== undefined) {
          why = howFault(
            intent.how,
            sent,
            pages,
            text,
            conversation.proposals.length,
            REAL,
            (route) => {
              const listed = app.get(AssistantRoutes);
              const facts = listed.factsOf(route);
              return (
                facts !== undefined &&
                Object.hasOwn(listed.linesOf(intent.role ?? 'super_admin'), route) &&
                assistantDefaultOn(facts.area, route, facts.kind)
              );
            },
          );
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
            expect(given[0]?.result, one.id).toEqual({
              error: intent.refusal ?? 'not_open_to_assistant',
            });
          }
        }
      });
    }
  },
);
