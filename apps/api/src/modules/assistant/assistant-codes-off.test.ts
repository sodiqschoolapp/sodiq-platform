import {
  assistantConversationSchema,
  BRANCH_HEADER,
  planItemSchema,
  type AssistantConversation,
} from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { settle } from '../../testing/assistant-kit.js';
import { answer, calls, FakeModel } from '../../testing/assistant-model.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { openPlanWindows } from '../../testing/plan-windows-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { GENERATED_TOOLS } from './tools.generated.js';

/** Tuesday 27 October 2026, noon in Tashkent: 26 October is held, the second quarter ahead. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const propose = (route: string): string => {
  const name = GENERATED_TOOLS[route]?.name;
  if (name === undefined) throw new Error(`${route} has no tool`);
  return `propose_${name}`.slice(0, 64);
};

const ITEM_SAVE = propose('PUT /api/plans/items/:itemId');
const WORK_ADD = propose('POST /api/journal/lessons/:lessonId/works');

const values = (change: Record<string, unknown> = {}) => ({
  topic: 'Fractions',
  objectives: '',
  links: [],
  classworks: [],
  homeworks: [],
  ...change,
});

// Task 11.27 (pull request #399), review round 1, finding 3. The Done when of 11.27: "a code sent
// while codes are off is refused on the screen, through the assistant and through a key"; the
// approved plan: "a proposal step refused at Confirm"; `09`, Codes: "While a subject's codes are
// off, no code can be set in it"; `02`, Assistant: a change is made only at Confirm, through the
// platform's own route. Every name is invented.
describe('a code through the assistant while the subject’s codes are off (task 11.27)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  const model = new FakeModel();
  let scene: PublishedScene;
  let owner: { cookie: string; account: { id: string } };
  let journal: string;
  let q2: string;
  /** The class's lessons of the second quarter, in order (the rows of its plan). */
  let q2Lessons: string[];
  /** The class's lesson of Monday 26 October: held, with no plan item. */
  let held: string;

  const server = () => t.kit.server;

  const switchCodes = (on: boolean) =>
    t.database.migrator
      .updateTable('subjects')
      .set({ codes_on: on })
      .where('id', '=', scene.subject)
      .execute();

  /** Asks as the Teacher with a model that makes these calls; answers the conversation. */
  async function asked(
    wanted: { name: string; args?: Record<string, unknown> }[],
  ): Promise<AssistantConversation> {
    model.script(calls(...wanted), answer('Here it is.'));
    const response = await request(server())
      .post('/api/assistant/questions')
      .set('Cookie', owner.cookie)
      .set(BRANCH_HEADER, scene.branch)
      .send({ role: 'teacher', text: 'Please.' });
    expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(202);
    await settle(t.app, response, owner.cookie, scene.branch);
    return assistantConversationSchema.parse(
      (response.body as { conversation: unknown }).conversation,
    );
  }

  /** The last proposal of the conversation: its id and each step's state and code. */
  function proposalOf(conversation: AssistantConversation) {
    const proposal = conversation.proposals.at(-1);
    return {
      id: proposal?.id ?? '',
      steps: proposal?.steps.map((step) => [step.state, step.code]) ?? [],
    };
  }

  const stepsAfterConfirm = async (id: string) => {
    const response = await request(server())
      .post(`/api/assistant/proposals/${id}/confirm`)
      .set('Cookie', owner.cookie)
      .set(BRANCH_HEADER, scene.branch)
      .send({ role: 'teacher' });
    expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(200);
    return proposalOf(assistantConversationSchema.parse(response.body)).steps;
  };

  /**
   * Every row of the plan and journal tables the two routes write, in every branch, and every
   * audit entry that is not the assistant's own (its question, proposal and decision).
   */
  const everyRow = async () => {
    const rows: Record<string, unknown[]> = {};
    for (const table of [
      'lesson_plans',
      'lesson_plan_journals',
      'lesson_plan_items',
      'lesson_plan_places',
      'lesson_plan_works',
      'journal_works',
      'journal_cells',
    ] as const) {
      rows[table] = (await t.database.migrator.selectFrom(table).selectAll().execute())
        .map((row) => JSON.stringify(row))
        .sort();
    }
    rows.audit = await t.database.migrator
      .selectFrom('audit_log')
      .selectAll()
      .where('action', 'not like', 'assistant.%')
      .orderBy('id')
      .execute();
    return rows;
  };

  /** The audit entries of a plan or a journal change made through an assistant step. */
  const stepEntries = () =>
    t.database.migrator
      .selectFrom('audit_log')
      .select('action')
      .where('assistant_step_id', 'is not', null)
      .where((eb) => eb.or([eb('action', 'like', 'plan.%'), eb('action', 'like', 'journal.%')]))
      .execute();

  /** An item written through the plan's own route, as the owner on the screen. */
  async function screenItem(position: number, change: Record<string, unknown>) {
    const response = await request(server())
      .post(`/api/plans/journals/${journal}/items`)
      .set('Cookie', owner.cookie)
      .set(BRANCH_HEADER, scene.branch)
      .send({
        quarterId: q2,
        position,
        lessonId: q2Lessons[position - 1],
        values: values(change),
      });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return planItemSchema.parse(response.body);
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ assistantModel: model, listen: true, jobs: true });
    load = new LoadKit(t.database.migrator);
    owner = await t.kit.completeSession('Sevara', 'Olimova');
    scene = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id },
    });
    await t.kit.giveRole(owner.account.id, {
      role: 'teacher',
      branchId: scene.branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    await openPlanWindows(t.database.migrator, scene.branch, scene.year);
    journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', scene.classId)
        .executeTakeFirstOrThrow()
    ).id;
    q2 = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', scene.year)
        .where('number', '=', 2)
        .executeTakeFirstOrThrow()
    ).id;
    q2Lessons = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', scene.classId)
        .where('subject_id', '=', scene.subject)
        .where('cancel_cause', 'is', null)
        .where('lesson_date', '>=', '2026-11-09')
        .where('lesson_date', '<=', '2026-12-31')
        .orderBy('starts_at')
        .execute()
    ).map((row) => row.id);
    held = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', scene.classId)
        .where('subject_id', '=', scene.subject)
        .where('lesson_date', '=', '2026-10-26')
        .executeTakeFirstOrThrow()
    ).id;
    await t.database.migrator
      .updateTable('assistant_settings')
      .set({ school_on: true, roles_on: ['super_admin', 'teacher'], daily_limit: 500 })
      .execute();
    t.clock.set(MOMENT);
    await t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
      .execute();
  });

  afterAll(async () => {
    t.clock.set(START);
    await t.close();
  });

  it('refuses at Confirm a plan item save that changes only the topic code, proposed while on and confirmed after the switch off; nothing written', async () => {
    await switchCodes(true);
    const item = await screenItem(1, { topicCode: 'F1' });
    // Only the code changes: the topic, objectives, links and works are as stored.
    const conversation = await asked([
      {
        name: ITEM_SAVE,
        args: {
          itemId: item.id,
          body: { journalId: journal, quarterId: q2, values: values({ topicCode: 'F2' }) },
          summary: 'A new code for the topic.',
        },
      },
    ]);
    const proposal = proposalOf(conversation);
    // A change of the code alone is a change: a step waits for Confirm.
    expect(proposal.steps).toEqual([['waiting', null]]);
    await switchCodes(false);
    const before = await everyRow();
    expect(await stepsAfterConfirm(proposal.id)).toEqual([['refused', 'plan_codes_off']]);
    expect(await everyRow()).toEqual(before);
    expect(await stepEntries()).toEqual([]);
    // The stored code is kept as it was (`09`: "hides … and keeps them").
    const stored = await t.database.migrator
      .selectFrom('lesson_plan_items')
      .select('topic_code')
      .where('id', '=', item.id)
      .executeTakeFirstOrThrow();
    expect(stored.topic_code).toBe('F1');
  });

  it('takes the proposal of a code while off and refuses it at Confirm, the topic beside it not saved either', async () => {
    await switchCodes(false);
    const item = await screenItem(2, {});
    const conversation = await asked([
      {
        name: ITEM_SAVE,
        args: {
          itemId: item.id,
          body: {
            journalId: journal,
            quarterId: q2,
            values: values({
              topic: 'Decimals',
              topicCode: 'D1',
              classworks: [{ title: 'Quiz', description: '', code: 'Q1' }],
            }),
          },
          summary: 'A topic and a classwork, with codes.',
        },
      },
    ]);
    const proposal = proposalOf(conversation);
    // The proposal step does not decide it (no preview): the route refuses it at Confirm.
    expect(proposal.steps).toEqual([['waiting', null]]);
    const before = await everyRow();
    expect(await stepsAfterConfirm(proposal.id)).toEqual([['refused', 'plan_codes_off']]);
    expect(await everyRow()).toEqual(before);
    expect(await stepEntries()).toEqual([]);
  });

  it('refuses at Confirm a work added in the journal with a code, proposed while on and confirmed after the switch off; nothing written', async () => {
    await switchCodes(true);
    const conversation = await asked([
      {
        name: WORK_ADD,
        args: {
          lessonId: held,
          body: { kind: 'classwork', title: 'Quiz on maps', code: 'M1' },
          summary: 'A classwork with a code.',
        },
      },
    ]);
    const proposal = proposalOf(conversation);
    expect(proposal.steps).toEqual([['waiting', null]]);
    await switchCodes(false);
    const before = await everyRow();
    expect(await stepsAfterConfirm(proposal.id)).toEqual([['refused', 'plan_codes_off']]);
    expect(await everyRow()).toEqual(before);
    expect(await stepEntries()).toEqual([]);
    // The fixture would have let it in: the same work with no code is added through Confirm.
    const plain = await asked([
      {
        name: WORK_ADD,
        args: {
          lessonId: held,
          body: { kind: 'classwork', title: 'Quiz on maps' },
          summary: 'A classwork.',
        },
      },
    ]);
    expect(await stepsAfterConfirm(proposalOf(plain).id)).toEqual([['done', null]]);
    expect((await stepEntries()).map((one) => one.action)).toContain('journal.work_add');
  });
});
