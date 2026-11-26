import { randomUUID } from 'node:crypto';
import {
  apiErrorSchema,
  auditPageSchema,
  BRANCH_HEADER,
  journalGridSchema,
  lessonCardSchema,
  planItemSchema,
  planSchema,
  workAddedSchema,
  type Plan,
  type PlanItem,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response, type Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { openPlanWindows } from '../../testing/plan-windows-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';

/** Tuesday 27 October 2026, noon in Tashkent: the second quarter's lessons are all ahead. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response) => apiErrorSchema.parse(response.body).error.code;

const ok = (response: Response, status = 200): unknown => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response.body;
};

const values = (change: Record<string, unknown> = {}) => ({
  topic: 'Fractions',
  objectives: '',
  links: [],
  classworks: [],
  homeworks: [],
  ...change,
});

/** The values of an item as a save sends them as its base (codes as read). */
const baseOf = (item: PlanItem) => ({
  topic: item.topic,
  topicCode: item.topicCode,
  objectives: item.objectives,
  links: item.links,
  classworks: item.classworks,
  homeworks: item.homeworks,
});

// All names are invented. Task 11.27 (pull request #399): docs/spec/09-lesson-plans.md, Codes;
// docs/spec/edge-cases/journal.md, "A lesson is held with no plan item";
// docs/spec/edge-cases/lesson-plans.md, Plans and the journal.
describe('codes for topics and works (task 11.27)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;
  const given = new Set<string>();

  type Browser = { cookie: string; account: { id: string } };
  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];

  interface Api {
    get(path: string): Test;
    post(path: string, body?: object): Test;
    put(path: string, body: object): Test;
  }

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Malika', `Usmonova${'a'.repeat(names % 5)}`);
  };

  const apiOf = (branch: string, cookie: string): Api => ({
    get: (path) => request(t.kit.server).get(path).set('Cookie', cookie).set(BRANCH_HEADER, branch),
    post: (path, body = {}) =>
      request(t.kit.server).post(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body),
    put: (path, body) =>
      request(t.kit.server).put(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body),
  });

  async function as<T>(
    browser: Browser,
    branch: string,
    roles: readonly Omit<Held, 'validFrom'>[],
    work: (api: Api) => Promise<T>,
  ): Promise<T> {
    for (const held of roles) {
      const key = `${browser.account.id}|${held.role}|${'branchId' in held ? String(held.branchId) : ''}`;
      if (given.has(key)) continue;
      given.add(key);
      await t.kit.giveRole(browser.account.id, {
        ...held,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
    }
    t.clock.set(MOMENT);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
        .where('account_id', '=', browser.account.id)
        .execute();
      return await work(apiOf(branch, browser.cookie));
    } finally {
      t.clock.set(START);
    }
  }

  const journalOf = async (classId: string) =>
    (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', classId)
        .executeTakeFirstOrThrow()
    ).id;

  /** The lessons of the class in the second quarter, in order (the rows of its plan). */
  const q2Lessons = (scene: PublishedScene) =>
    t.database.migrator
      .selectFrom('lessons')
      .select('id')
      .where('class_id', '=', scene.classId)
      .where('subject_id', '=', scene.subject)
      .where('cancel_cause', 'is', null)
      .where('lesson_date', '>=', '2026-11-09')
      .where('lesson_date', '<=', '2026-12-31')
      .orderBy('starts_at')
      .execute();

  const switchCodes = (scene: PublishedScene, on: boolean) =>
    t.database.migrator
      .updateTable('subjects')
      .set({ codes_on: on })
      .where('id', '=', scene.subject)
      .execute();

  async function plannedScene() {
    const owner = await account();
    const spare = await account();
    const scene = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id, spare: spare.account.id },
    });
    const quarters = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', scene.year)
        .orderBy('number')
        .execute()
    ).map((one) => one.id);
    await openPlanWindows(t.database.migrator, scene.branch, scene.year);
    return {
      scene,
      owner,
      journal: await journalOf(scene.classId),
      otherJournal: await journalOf(scene.otherClass),
      q1: quarters[0] ?? '',
      q2: quarters[1] ?? '',
      lessons: await q2Lessons(scene),
    };
  }

  type Planned = Awaited<ReturnType<typeof plannedScene>>;

  const teacherOf = (s: Planned) => [{ role: 'teacher' as const, branchId: s.scene.branch }];

  const create = (api: Api, s: Planned, position: number, body: Record<string, unknown>) =>
    api.post(`/api/plans/journals/${s.journal}/items`, {
      quarterId: s.q2,
      position,
      lessonId: s.lessons[position - 1]?.id ?? randomUUID(),
      values: values(body),
    });

  const planOf = async (api: Api, s: Planned, quarterId = s.q2): Promise<Plan> =>
    planSchema.parse(ok(await api.get(`/api/plans/journals/${s.journal}?quarterId=${quarterId}`)));

  /** The item of a plan with a topic, on a row or not covered. */
  const itemNamed = (plan: Plan, topic: string) =>
    [...plan.rows.map((row) => row.item), ...plan.notCovered].find((one) => one?.topic === topic);

  const gridOf = async (api: Api, s: Planned) =>
    journalGridSchema.parse(
      ok(await api.get(`/api/journal/journals/${s.journal}?quarterId=${s.q2}`)),
    );

  const cardOf = async (api: Api, lessonId: string) =>
    lessonCardSchema.parse(ok(await api.get(`/api/journal/lessons/${lessonId}/card`)));

  /** The stored codes of the plan's items and works, whatever the switch. */
  const storedCodes = async (itemId: string) => ({
    topic: (
      await t.database.migrator
        .selectFrom('lesson_plan_items')
        .select('topic_code')
        .where('id', '=', itemId)
        .executeTakeFirstOrThrow()
    ).topic_code,
    works: (
      await t.database.migrator
        .selectFrom('lesson_plan_works')
        .select(['title', 'work_code'])
        .where('item_id', '=', itemId)
        .orderBy('kind')
        .orderBy('position')
        .execute()
    ).map((one) => [one.title, one.work_code]),
  });

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  it("refuses a code while the subject's codes are off, the default, and writes nothing", async () => {
    const s = await plannedScene();
    const subject = await t.database.migrator
      .selectFrom('subjects')
      .select('codes_on')
      .where('id', '=', s.scene.subject)
      .executeTakeFirstOrThrow();
    // `05`, Subject: "codes switch (off by default …)".
    expect(subject.codes_on).toBe(false);
    await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
      const topic = await create(api, s, 1, { topicCode: 'F1' });
      expect(topic.status).toBe(409);
      expect(codeOf(topic)).toBe('plan_codes_off');
      const work = await create(api, s, 1, {
        classworks: [{ title: 'Quiz', description: '', code: 'Q1' }],
      });
      expect(work.status).toBe(409);
      expect(codeOf(work)).toBe('plan_codes_off');
      // No code at all is a plain item.
      const plain = planItemSchema.parse(ok(await create(api, s, 1, {}), 201));
      expect(plain.topicCode).toBeNull();
    });
    const items = await t.database.migrator
      .selectFrom('lesson_plan_items')
      .innerJoin('lesson_plans', 'lesson_plans.id', 'lesson_plan_items.plan_id')
      .select('lesson_plan_items.topic_code')
      .where('lesson_plans.subject_id', '=', s.scene.subject)
      .execute();
    expect(items.map((one) => one.topic_code)).toEqual([null]);
  });

  it('takes a code of at most 20 characters, spaces at either end dropped (09, Codes)', async () => {
    const s = await plannedScene();
    await switchCodes(s.scene, true);
    await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
      const long = await create(api, s, 1, { topicCode: 'A'.repeat(21) });
      expect(long.status).toBe(400);
      expect(codeOf(long)).toBe('validation_failed');
      const longWork = await create(api, s, 1, {
        homeworks: [{ title: 'Essay', description: '', code: 'B'.repeat(21) }],
      });
      expect(longWork.status).toBe(400);
      const item = planItemSchema.parse(
        ok(
          await create(api, s, 1, {
            topicCode: `  ${'A'.repeat(20)}  `,
            homeworks: [{ title: 'Essay', description: '', code: ' E1 ' }],
          }),
          201,
        ),
      );
      expect(item.topicCode).toBe('A'.repeat(20));
      expect(item.homeworks.map((one) => one.code)).toEqual(['E1']);
      // Not unique (`09`: "it need not be unique"): the same code on a second row.
      const again = planItemSchema.parse(
        ok(await create(api, s, 2, { topicCode: 'A'.repeat(20) }), 201),
      );
      expect(again.topicCode).toBe('A'.repeat(20));
    });
  });

  it('hides every code while off, keeps them, and shows them again when on (09, Codes)', async () => {
    const s = await plannedScene();
    await switchCodes(s.scene, true);
    const lessonId = s.lessons[0]?.id ?? '';
    const item = await as(s.owner, s.scene.branch, teacherOf(s), async (api) =>
      planItemSchema.parse(
        ok(
          await create(api, s, 1, {
            topicCode: 'F1',
            classworks: [{ title: 'Quiz on fractions', description: '', code: 'Q1' }],
            homeworks: [{ title: 'Exercise 5', description: '', code: 'H1' }],
          }),
          201,
        ),
      ),
    );
    const shown = async () =>
      as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
        const plan = await planOf(api, s);
        const row = plan.rows.find((one) => one.lessonId === lessonId);
        const grid = await gridOf(api, s);
        const lesson = grid.lessons.find((one) => one.id === lessonId);
        const card = await cardOf(api, lessonId);
        return {
          plan: [
            plan.codesOn,
            row?.item?.topicCode ?? null,
            ...(row?.item?.classworks ?? []).map((one) => one.code),
            ...(row?.item?.homeworks ?? []).map((one) => one.code),
          ],
          grid: [
            grid.journal.codesOn,
            lesson?.topicCode ?? null,
            ...(lesson?.works ?? []).map((one) => [one.title, one.code]),
            ...(lesson?.given ?? []).map((one) => [one.title, one.code]),
          ],
          card: [
            card.codesOn,
            card.topicCode,
            ...card.classworks.map((one) => one.code),
            ...card.givenToday.map((one) => one.code),
          ],
        };
      });
    expect(await shown()).toEqual({
      plan: [true, 'F1', 'Q1', 'H1'],
      grid: [true, 'F1', ['Quiz on fractions', 'Q1'], ['Exercise 5', 'H1'], ['Exercise 5', 'H1']],
      card: [true, 'F1', 'Q1', 'H1'],
    });

    await switchCodes(s.scene, false);
    expect(await shown()).toEqual({
      plan: [false, null, null, null],
      grid: [false, null, ['Quiz on fractions', null], ['Exercise 5', null], ['Exercise 5', null]],
      card: [false, null, null, null],
    });
    // A save while off, of the topic and a work's title, with the codes as read (none): the
    // stored codes stay ("hides … and keeps them"), and the work is not refused as stale.
    await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
      const plan = await planOf(api, s);
      const read = plan.rows.find((one) => one.lessonId === lessonId)?.item;
      if (read == null) throw new Error('the item is read');
      const saved = await api.put(`/api/plans/items/${item.id}`, {
        base: baseOf(read),
        values: values({
          topic: 'Fractions and decimals',
          classworks: read.classworks.map((one) => ({
            id: one.id,
            title: 'Quiz on decimals',
            description: one.description,
          })),
          homeworks: read.homeworks.map((one) => ({
            id: one.id,
            title: one.title,
            code: one.code,
            description: one.description,
          })),
        }),
      });
      const after = planItemSchema.parse(ok(saved));
      expect(after.topicCode).toBeNull();
      // A code sent while off is refused (`09`: "no code can be set in it").
      const refused = await api.put(`/api/plans/items/${item.id}`, {
        base: baseOf(after),
        values: values({ topic: after.topic, topicCode: 'F2' }),
      });
      expect(refused.status).toBe(409);
      expect(codeOf(refused)).toBe('plan_codes_off');
    });
    expect(await storedCodes(item.id)).toEqual({
      topic: 'F1',
      works: [
        ['Quiz on decimals', 'Q1'],
        ['Exercise 5', 'H1'],
      ],
    });

    await switchCodes(s.scene, true);
    expect((await shown()).plan).toEqual([true, 'F1', 'Q1', 'H1']);
  });

  it('keeps the codes of another subject while one subject is off', async () => {
    const one = await plannedScene();
    const other = await plannedScene();
    expect(other.scene.subject).not.toBe(one.scene.subject);
    for (const s of [one, other]) {
      await switchCodes(s.scene, true);
      await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
        ok(await create(api, s, 1, { topicCode: 'T1' }), 201);
      });
    }
    await switchCodes(one.scene, false);
    const topicOf = (s: Planned) =>
      as(
        s.owner,
        s.scene.branch,
        teacherOf(s),
        async (api) =>
          (await gridOf(api, s)).lessons.find((lesson) => lesson.id === s.lessons[0]?.id)
            ?.topicCode ?? null,
      );
    expect(await topicOf(one)).toBeNull();
    expect(await topicOf(other)).toBe('T1');
  });

  it('changes a code under the rules of its topic: stale base refused, old and new in the history', async () => {
    const s = await plannedScene();
    await switchCodes(s.scene, true);
    await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
      const item = planItemSchema.parse(ok(await create(api, s, 1, { topicCode: 'F1' }), 201));
      const saved = planItemSchema.parse(
        ok(
          await api.put(`/api/plans/items/${item.id}`, {
            base: baseOf(item),
            values: values({ topicCode: 'F2' }),
          }),
        ),
      );
      expect(saved.topicCode).toBe('F2');
      // A save on the older code is refused, naming the code stored now (`edge/lesson-plans`: "A
      // save made on an older state of the same field is refused and both values are shown").
      const stale = await api.put(`/api/plans/items/${item.id}`, {
        base: baseOf(item),
        values: values({ topicCode: 'F3' }),
      });
      expect(stale.status).toBe(409);
      const error = apiErrorSchema.parse(stale.body).error;
      expect(error.code).toBe('plan_item_stale');
      expect(error.details?.map((one) => [one.path, one.storedPlanValue])).toEqual([
        ['values.topicCode', 'F2'],
      ]);
    });
    const entries = await t.entries('plan.item_edit');
    const entry = entries.find((one) => JSON.stringify(one).includes('"F2"'));
    expect(entry?.old_value).toEqual({ topicCode: 'F1' });
    expect(entry?.new_value).toEqual({ topicCode: 'F2' });
  });

  it('refuses a first code saved on an older read with no code, in the plan and in the journal (edge/lesson-plans)', async () => {
    const s = await plannedScene();
    await switchCodes(s.scene, true);
    const held = await t.database.migrator
      .selectFrom('lessons')
      .select('id')
      .where('class_id', '=', s.scene.classId)
      .where('subject_id', '=', s.scene.subject)
      .where('lesson_date', '=', '2026-10-26')
      .executeTakeFirstOrThrow();
    await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
      // Two tabs read the item with no code; the first sets F1, the second's F2 is stale.
      const item = planItemSchema.parse(ok(await create(api, s, 1, {}), 201));
      ok(
        await api.put(`/api/plans/items/${item.id}`, {
          base: baseOf(item),
          values: values({ topicCode: 'F1' }),
        }),
      );
      const stale = await api.put(`/api/plans/items/${item.id}`, {
        base: baseOf(item),
        values: values({ topicCode: 'F2' }),
      });
      expect([stale.status, codeOf(stale)]).toEqual([409, 'plan_item_stale']);
      // The journal's topic, read with no code.
      ok(
        await api.put(`/api/journal/lessons/${held.id}/topic`, {
          topic: 'Maps',
          baseTopic: '',
          topicCode: 'M1',
          baseTopicCode: null,
        }),
      );
      const staleTopic = await api.put(`/api/journal/lessons/${held.id}/topic`, {
        topic: 'Maps',
        baseTopic: 'Maps',
        topicCode: 'M2',
        baseTopicCode: null,
      });
      expect([staleTopic.status, codeOf(staleTopic)]).toEqual([409, 'plan_item_stale']);
      // A work added in the journal, renamed on a read with no code.
      const added = workAddedSchema.parse(
        ok(
          await api.post(`/api/journal/lessons/${held.id}/works`, {
            kind: 'classwork',
            title: 'Quiz',
          }),
        ),
      );
      const path = `/api/journal/lessons/${held.id}/plan-works/${added.planWorkId}/title`;
      ok(await api.put(path, { title: 'Quiz', baseTitle: 'Quiz', code: 'Q1', baseCode: null }));
      const staleWork = await api.put(path, {
        title: 'Quiz',
        baseTitle: 'Quiz',
        code: 'Q2',
        baseCode: null,
      });
      expect([staleWork.status, codeOf(staleWork)]).toEqual([409, 'work_stale']);
    });
  });

  it('refuses a code of 21 characters on a save and in the journal (09, Codes)', async () => {
    const s = await plannedScene();
    await switchCodes(s.scene, true);
    const held = await t.database.migrator
      .selectFrom('lessons')
      .select('id')
      .where('class_id', '=', s.scene.classId)
      .where('subject_id', '=', s.scene.subject)
      .where('lesson_date', '=', '2026-10-26')
      .executeTakeFirstOrThrow();
    await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
      const item = planItemSchema.parse(ok(await create(api, s, 1, {}), 201));
      const save = await api.put(`/api/plans/items/${item.id}`, {
        base: baseOf(item),
        values: values({ topicCode: 'A'.repeat(21) }),
      });
      expect([save.status, codeOf(save)]).toEqual([400, 'validation_failed']);
      const add = await api.post(`/api/journal/lessons/${held.id}/works`, {
        kind: 'homework',
        title: 'Read',
        code: 'B'.repeat(21),
      });
      expect([add.status, codeOf(add)]).toEqual([400, 'validation_failed']);
      const topic = await api.put(`/api/journal/lessons/${held.id}/topic`, {
        topic: 'Maps',
        baseTopic: '',
        topicCode: 'C'.repeat(21),
      });
      expect([topic.status, codeOf(topic)]).toEqual([400, 'validation_failed']);
      expect((await storedCodes(item.id)).topic).toBeNull();
    });
  });

  it('copies the codes with a plan into another quarter of the journal, also while off (09, Codes, Copies)', async () => {
    const s = await plannedScene();
    await switchCodes(s.scene, true);
    await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
      ok(
        await create(api, s, 1, {
          topicCode: 'F1',
          classworks: [{ title: 'Quiz', description: '', code: 'Q1' }],
        }),
        201,
      );
    });
    await switchCodes(s.scene, false);
    await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
      ok(
        // Into the first quarter of the same journal: another plan of the owner.
        await api.post(`/api/plans/journals/${s.journal}/copy`, {
          quarterId: s.q1,
          source: { journalId: s.journal, quarterId: s.q2 },
          part: 'all',
        }),
      );
      // Hidden while off.
      const copied = itemNamed(await planOf(api, s, s.q1), 'Fractions');
      expect(copied?.topicCode).toBeNull();
    });
    await switchCodes(s.scene, true);
    await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
      const copied = itemNamed(await planOf(api, s, s.q1), 'Fractions');
      expect([copied?.topicCode, copied?.classworks.map((one) => one.code)]).toEqual([
        'F1',
        ['Q1'],
      ]);
    });
  });

  it('takes a code with a work added in the journal, and its rename (edge/journal)', async () => {
    const s = await plannedScene();
    // A held lesson of the first quarter with no plan item: 26 October.
    const held = await t.database.migrator
      .selectFrom('lessons')
      .select('id')
      .where('class_id', '=', s.scene.classId)
      .where('subject_id', '=', s.scene.subject)
      .where('lesson_date', '=', '2026-10-26')
      .executeTakeFirstOrThrow();
    await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
      const off = await api.post(`/api/journal/lessons/${held.id}/works`, {
        kind: 'classwork',
        title: 'Quiz',
        code: 'Q1',
      });
      expect(off.status).toBe(409);
      expect(codeOf(off)).toBe('plan_codes_off');
    });
    await switchCodes(s.scene, true);
    await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
      const added = workAddedSchema.parse(
        ok(
          await api.post(`/api/journal/lessons/${held.id}/works`, {
            kind: 'classwork',
            title: 'Quiz',
            code: ' Q1 ',
          }),
        ),
      );
      expect(added.code).toBe('Q1');
      const renamed = workAddedSchema.parse(
        ok(
          await api.put(`/api/journal/lessons/${held.id}/plan-works/${added.planWorkId}/title`, {
            title: 'Quiz',
            baseTitle: 'Quiz',
            code: 'Q2',
            baseCode: 'Q1',
          }),
        ),
      );
      expect(renamed.code).toBe('Q2');
      const topic = await api.put(`/api/journal/lessons/${held.id}/topic`, {
        topic: 'Fractions',
        baseTopic: '',
        topicCode: 'F1',
        baseTopicCode: null,
      });
      expect(ok(topic)).toMatchObject({ topic: 'Fractions', topicCode: 'F1' });
      const card = await cardOf(api, held.id);
      expect([card.topicCode, card.classworks.map((one) => one.code)]).toEqual(['F1', ['Q2']]);
    });
  });

  it('leaves the codes of an off subject out of the Audit log, the rows as written (decision 1)', async () => {
    const s = await plannedScene();
    await switchCodes(s.scene, true);
    await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
      ok(await create(api, s, 1, { topicCode: 'F1' }), 201);
    });
    const admin = await account();
    const stored = async () =>
      // Byte for byte (review correction 3): the stored text of the row's values.
      (
        await sql<{ new_value: string }>`
          select new_value::text as new_value from audit_log
          where action = 'plan.item_create' and new_value ->> 'topicCode' = 'F1'
            and branch_id = ${s.scene.branch}
        `.execute(t.database.migrator)
      ).rows;
    const before = await stored();
    expect(before).toHaveLength(1);
    const read = async () =>
      as(admin, s.scene.branch, [{ role: 'super_admin' }], async (api) => {
        const page = auditPageSchema.parse(
          ok(await api.get('/api/audit/entries?from=2026-10-27&to=2026-10-27&group=plans')),
        );
        const entry = page.entries.find(
          (one) => one.action === 'plan.item_create' && JSON.stringify(one).includes('Fractions'),
        );
        return (entry?.newValue as Record<string, unknown> | null | undefined)?.topicCode;
      });
    expect(await read()).toBe('F1');
    await switchCodes(s.scene, false);
    expect(await read()).toBeUndefined();
    // The row itself is unchanged (append-only).
    expect(await stored()).toEqual(before);
    await switchCodes(s.scene, true);
    expect(await read()).toBe('F1');
  });
});
