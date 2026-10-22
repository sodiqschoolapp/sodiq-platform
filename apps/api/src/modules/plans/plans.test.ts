import {
  apiErrorSchema,
  BRANCH_HEADER,
  planFileSchema,
  planItemSchema,
  planListSchema,
  planSchema,
  type Plan,
  type PlanItem,
} from '@sodiq/shared';
import request, { type Response, type Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActingKit } from '../../testing/acting-kit.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MemoryPhotoStore } from '../people/photo-store.js';
import { publishedScene, QUARTERS, type PublishedScene } from '../../testing/published-scene.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

/** The Mondays of the second quarter (9 November to 28 December). */
const Q2_MONDAYS = [
  '2026-11-09',
  '2026-11-16',
  '2026-11-23',
  '2026-11-30',
  '2026-12-07',
  '2026-12-14',
  '2026-12-21',
  '2026-12-28',
];

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);

const codeOf = (response: Response) => apiErrorSchema.parse(response.body).error.code;

const planOf = (response: Response): Plan => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return planSchema.parse(response.body);
};

const itemOf = (response: Response, status = 200): PlanItem => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return planItemSchema.parse(response.body);
};

const values = (change: Record<string, unknown> = {}) => ({
  topic: 'Fractions',
  objectives: '',
  links: [],
  classworks: [],
  homeworks: [],
  ...change,
});

/** The values of an item as a save sends them as its base. */
const baseOf = (item: PlanItem) => ({
  topic: item.topic,
  objectives: item.objectives,
  links: item.links,
  classworks: item.classworks,
  homeworks: item.homeworks,
});

// All names are invented. Task 7.1a, pull request #212: docs/spec/09-lesson-plans.md,
// What a plan contains; docs/spec/edge-cases/lesson-plans.md, How items stay
// attached, "Who may read a plan?", "A plan is open in two tabs", the limits and
// "Clear"; docs/spec/edge-cases/00-definitions.md, Held lesson.
describe('lesson plans and their items', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;
  /** The roles given so far, once each. */
  const given = new Set<string>();

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Nodira', `Karimova${'a'.repeat(names % 5)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };

  interface Api {
    get(path: string): Test;
    post(path: string, body?: object): Test;
    put(path: string, body: object): Test;
    del(path: string): Test;
    upload(path: string, type: string, bytes: Buffer): Test;
  }

  const apiOf = (branch: string, cookie: string): Api => ({
    get: (path) => request(t.kit.server).get(path).set('Cookie', cookie).set(BRANCH_HEADER, branch),
    post: (path, body = {}) =>
      request(t.kit.server).post(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body),
    put: (path, body) =>
      request(t.kit.server).put(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body),
    del: (path) =>
      request(t.kit.server).delete(path).set('Cookie', cookie).set(BRANCH_HEADER, branch),
    upload: (path, type, bytes) =>
      request(t.kit.server)
        .put(path)
        .set('Cookie', cookie)
        .set(BRANCH_HEADER, branch)
        .set('Content-Type', type)
        .send(bytes),
  });

  /** Runs `work` with the clock at `moment` and the roles held from 1 September. */
  async function as<T>(
    browser: Browser,
    branch: string,
    roles: readonly Omit<Held, 'validFrom'>[],
    work: (api: Api) => Promise<T>,
    moment = MOMENT,
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
    t.clock.set(moment);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
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

  const quartersOf = async (year: string) =>
    (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', year)
        .orderBy('number')
        .execute()
    ).map((one) => one.id);

  const lessonsOf = (scene: PublishedScene, from: string, to: string) =>
    t.database.migrator
      .selectFrom('lessons')
      .select(['id', 'lesson_date', 'teacher_id'])
      .where('class_id', '=', scene.classId)
      .where('subject_id', '=', scene.subject)
      .where('lesson_date', '>=', from)
      .where('lesson_date', '<=', to)
      .orderBy('starts_at')
      .execute();

  /** The audit entries of the plans. */
  const planEntries = async () =>
    (
      await t.database.migrator
        .selectFrom('audit_log')
        .select('id')
        .where('action', 'like', 'plan.%')
        .execute()
    ).length;

  /** The newest audit entry of an action whose values or details name `id`. */
  const entryNaming = async (action: string, id: string) =>
    (await t.entries(action)).filter((entry) => JSON.stringify(entry).includes(id)).at(-1);

  /** Every row of the plan tables of a branch: what a refused change leaves as it was. */
  const planRowsOf = async (branch: string) => {
    const rows: Record<string, unknown[]> = {};
    for (const table of [
      'lesson_plans',
      'lesson_plan_journals',
      'lesson_plan_items',
      'lesson_plan_works',
      'lesson_plan_files',
    ] as const) {
      rows[table] = await t.database.migrator
        .selectFrom(table)
        .selectAll()
        .where('branch_id', '=', branch)
        .execute();
    }
    return rows;
  };

  /** A graded scene whose teacher (and spare teacher of the subject) sign in. */
  async function plannedScene(input: { double?: boolean } = {}) {
    const owner = await account();
    const spare = await account();
    const scene = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id, spare: spare.account.id },
      ...(input.double === true ? { double: true } : {}),
    });
    const quarters = await quartersOf(scene.year);
    return {
      scene,
      owner,
      spare,
      journal: await journalOf(scene.classId),
      otherJournal: await journalOf(scene.otherClass),
      q1: quarters[0] ?? '',
      q2: quarters[1] ?? '',
    };
  }

  type Planned = Awaited<ReturnType<typeof plannedScene>>;

  const teacherOf = (s: Planned) => [{ role: 'teacher' as const, branchId: s.scene.branch }];

  /** Creates items at positions as the owner. */
  const fill = (s: Planned, quarterId: string, positions: readonly number[]) =>
    as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
      const items: PlanItem[] = [];
      for (const position of positions) {
        items.push(
          itemOf(
            await api.post(`/api/plans/journals/${s.journal}/items`, {
              quarterId,
              position,
              values: values({ topic: `Topic ${position}` }),
            }),
            201,
          ),
        );
      }
      return items;
    });

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true, photoStore: new MemoryPhotoStore() });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  it('fills the lessons of a quarter in order, skipping a cancelled one at once (done when)', async () => {
    const s = await plannedScene();
    await fill(s, s.q2, [1, 2, 3, 8]);
    const plan = await as(s.owner, s.scene.branch, teacherOf(s), async (api) =>
      planOf(await api.get(`/api/plans/journals/${s.journal}?quarterId=${s.q2}`)),
    );
    const lessons = await lessonsOf(s.scene, QUARTERS[1][0], QUARTERS[1][1]);
    expect(plan.rows.map((row) => row.date)).toEqual(Q2_MONDAYS);
    expect(plan.rows.map((row) => row.lessonId)).toEqual(lessons.map((one) => one.id));
    expect(plan.rows.map((row) => row.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(plan.rows.map((row) => row.item?.topic ?? null)).toEqual([
      'Topic 1',
      'Topic 2',
      'Topic 3',
      null,
      null,
      null,
      null,
      'Topic 8',
    ]);
    expect(plan.rows.every((row) => !row.held)).toBe(true);
    expect(plan.unattached).toEqual([]);

    // A future lesson is cancelled with no item written since: the items follow by
    // position at once (edge/lesson-plans: "Cancelled lessons are skipped").
    await t.database.migrator
      .updateTable('lessons')
      .set({ cancel_cause: 'reason', cancel_reason: 'School event' })
      .where('id', '=', lessons[1]?.id ?? '')
      .execute();
    const after = await as(s.owner, s.scene.branch, teacherOf(s), async (api) =>
      planOf(await api.get(`/api/plans/journals/${s.journal}?quarterId=${s.q2}`)),
    );
    expect(after.rows.map((row) => row.date)).toEqual(Q2_MONDAYS.filter((_, i) => i !== 1));
    expect(after.rows.map((row) => [row.number, row.item?.topic ?? null])).toEqual([
      [1, 'Topic 1'],
      [2, 'Topic 2'],
      [3, 'Topic 3'],
      [4, null],
      [5, null],
      [6, null],
      [7, null],
    ]);
    // Past the last row: attached to nothing (7.1b names it "not covered").
    expect(after.unattached.map((item) => item.topic)).toEqual(['Topic 8']);

    // The other class's plan stands on its own lessons.
    const other = await as(s.owner, s.scene.branch, [], async (api) =>
      planOf(await api.get(`/api/plans/journals/${s.otherJournal}?quarterId=${s.q2}`)),
    );
    expect(other.rows).toHaveLength(8);
    expect(other.rows.some((row) => plan.rows.some((mine) => mine.lessonId === row.lessonId))).toBe(
      false,
    );
    expect(other.rows.every((row) => row.item === null)).toBe(true);
  });

  it('gives a double lesson two rows', async () => {
    const s = await plannedScene({ double: true });
    const plan = await as(s.owner, s.scene.branch, teacherOf(s), async (api) =>
      planOf(await api.get(`/api/plans/journals/${s.journal}?quarterId=${s.q1}`)),
    );
    expect(plan.rows.map((row) => [row.number, row.date, row.slot])).toEqual([
      [1, '2026-10-12', 1],
      [2, '2026-10-12', 2],
      [3, '2026-10-19', 1],
      [4, '2026-10-19', 2],
      [5, '2026-10-26', 1],
      [6, '2026-10-26', 2],
    ]);
  });

  it('lets the readers of edge/lesson-plans read a plan, and only its owner edit it', async () => {
    const s = await plannedScene();
    const branch = s.scene.branch;
    const path = `/api/plans/journals/${s.journal}?quarterId=${s.q2}`;
    const read = async (browser: Browser, roles: readonly Omit<Held, 'validFrom'>[]) =>
      as(browser, branch, roles, (api) => api.get(path));

    const own = planOf(await read(s.owner, teacherOf(s)));
    expect(own.canEdit).toBe(true);
    expect(own.owner).not.toBeNull();
    // A teacher with the subject and grade 7 in the profile reads, and does not edit.
    const profile = planOf(await read(s.spare, teacherOf(s)));
    expect(profile.canEdit).toBe(false);

    const elsewhere = await account();
    const otherSubject = await load.classes.subject({ grades: [7] });
    await load.teacher(branch, {
      subjects: [{ subject: otherSubject, grades: [7] }],
      accountId: elsewhere.account.id,
    });
    const refused = await read(elsewhere, teacherOf(s));
    expect(refused.status).toBe(403);
    expect(codeOf(refused)).toBe('plan_scope');

    // The subject with another grade only: not the plan's grade.
    await t.database.migrator
      .updateTable('subjects')
      .set({ grades: [7, 8] })
      .where('id', '=', s.scene.subject)
      .execute();
    const otherGrade = await account();
    await load.teacher(branch, {
      subjects: [{ subject: s.scene.subject, grades: [8] }],
      accountId: otherGrade.account.id,
    });
    expect(codeOf(await read(otherGrade, teacherOf(s)))).toBe('plan_scope');

    const head = await account();
    expect(
      planOf(
        await read(head, [
          { role: 'head_teacher', branchId: branch, subjectIds: [s.scene.subject] },
        ]),
      ).canEdit,
    ).toBe(false);
    const otherHead = await account();
    expect(
      codeOf(
        await read(otherHead, [
          { role: 'head_teacher', branchId: branch, subjectIds: [otherSubject] },
        ]),
      ),
    ).toBe('plan_scope');
    const senior = await account();
    expect(
      planOf(await read(senior, [{ role: 'senior_head_teacher', subjectIds: [s.scene.subject] }]))
        .canEdit,
    ).toBe(false);
    for (const held of [
      { role: 'super_admin' as const },
      { role: 'academic_vice_principal' as const, branchId: branch },
      { role: 'principal' as const, branchId: branch },
    ]) {
      const browser = await account();
      expect(planOf(await read(browser, [held])).canEdit, held.role).toBe(false);
    }
    const tutor = await account();
    const byArea = await read(tutor, [{ role: 'tutor', branchId: branch }]);
    expect(byArea.status).toBe(403);
    expect(codeOf(byArea)).toBe('permission_denied');

    // The list holds the journals each may read.
    const listOf = async (browser: Browser, roles: readonly Omit<Held, 'validFrom'>[]) =>
      planListSchema.parse((await as(browser, branch, roles, (api) => api.get('/api/plans'))).body);
    expect((await listOf(s.owner, [])).plans.map((one) => one.journalId)).toEqual([
      s.journal,
      s.otherJournal,
    ]);
    expect((await listOf(elsewhere, [])).plans).toEqual([]);
  });

  it('refuses a write from everyone but the owner, leaving every row and the audit log', async () => {
    const s = await plannedScene();
    const branch = s.scene.branch;
    const [item] = await fill(s, s.q2, [1]);
    const before = await planRowsOf(branch);
    const audit = await planEntries();
    const writes = (api: Api) => [
      api.post(`/api/plans/journals/${s.journal}/items`, {
        quarterId: s.q2,
        position: 2,
        values: values(),
      }),
      api.put(`/api/plans/items/${item?.id ?? ''}`, {
        base: baseOf(item ?? planItemSchema.parse({})),
        values: values({ topic: 'Changed' }),
      }),
      api.post(`/api/plans/items/${item?.id ?? ''}/clear`),
      api.upload(`/api/plans/items/${item?.id ?? ''}/files?name=Sheet.pdf`, 'application/pdf', PDF),
    ];
    await as(s.spare, branch, teacherOf(s), async (api) => {
      for (const response of await Promise.all(writes(api))) {
        expect(response.status, JSON.stringify(response.body)).toBe(403);
        expect(codeOf(response)).toBe('plan_scope');
      }
    });
    const admin = await account();
    await as(admin, branch, [{ role: 'super_admin' }], async (api) => {
      for (const response of await Promise.all(writes(api))) {
        expect(codeOf(response)).toBe('plan_scope');
      }
    });
    const vice = await account();
    await as(vice, branch, [{ role: 'academic_vice_principal', branchId: branch }], async (api) => {
      for (const response of await Promise.all(writes(api))) {
        expect(codeOf(response)).toBe('permission_denied');
      }
    });
    expect(await planRowsOf(branch)).toEqual(before);
    expect(await planEntries()).toBe(audit);
  });

  it('lets the acting teacher of a vacancy write its plan, and nobody while none is named', async () => {
    const acting = new ActingKit(t.database.migrator);
    const branch = await t.newBranch();
    const actingScene = await acting.scene(branch);
    for (const [index, [start, end]] of QUARTERS.entries()) {
      await t.database.migrator
        .updateTable('quarters')
        .set({ start_date: start, end_date: end })
        .where('academic_year_id', '=', actingScene.year)
        .where('number', '=', index + 1)
        .execute();
    }
    const browser = await account();
    const person = await load.teacher(branch, {
      subjects: [{ subject: actingScene.subject, grades: [7] }],
      accountId: browser.account.id,
    });
    const [q1] = await quartersOf(actingScene.year);
    const write = (api: Api) =>
      api.post(`/api/plans/journals/${actingScene.journal}/items`, {
        quarterId: q1,
        position: 1,
        values: values(),
      });
    // A profile reader while nobody acts.
    await as(browser, branch, [{ role: 'teacher', branchId: branch }], async (api) => {
      expect(codeOf(await write(api))).toBe('plan_scope');
    });
    await acting.period(actingScene, '2026-09-07', null, person.staffId);
    await as(browser, branch, [], async (api) => {
      // Past the scope: the journal has no lesson yet, so there is no row 1.
      expect(codeOf(await write(api))).toBe('plan_row_unknown');
      expect(planOf(await api.get(`/api/plans/journals/${actingScene.journal}`)).canEdit).toBe(
        true,
      );
    });
  });

  it('refuses an attendance-only journal and a closed year', async () => {
    const owner = await account();
    const scene = await publishedScene(t, load, { accounts: { teacher: owner.account.id } });
    const journal = await journalOf(scene.classId);
    const [q1] = await quartersOf(scene.year);
    await as(owner, scene.branch, [{ role: 'teacher', branchId: scene.branch }], async (api) => {
      const created = await api.post(`/api/plans/journals/${journal}/items`, {
        quarterId: q1,
        position: 1,
        values: values(),
      });
      expect(codeOf(created)).toBe('plan_attendance_only');
      expect(codeOf(await api.get(`/api/plans/journals/${journal}`))).toBe('plan_attendance_only');
      const list = planListSchema.parse((await api.get('/api/plans')).body);
      expect(list.plans).toEqual([]);
    });

    const s = await plannedScene();
    const [item] = await fill(s, s.q2, [1]);
    await t.database.migrator
      .updateTable('academic_years')
      .set({ status: 'closed' })
      .where('id', '=', s.scene.year)
      .execute();
    const before = await planRowsOf(s.scene.branch);
    await as(s.owner, s.scene.branch, [], async (api) => {
      const created = await api.post(`/api/plans/journals/${s.journal}/items`, {
        quarterId: s.q2,
        position: 2,
        values: values(),
      });
      expect(codeOf(created)).toBe('plan_year_closed');
      const saved = await api.put(`/api/plans/items/${item?.id ?? ''}`, {
        base: baseOf(item ?? planItemSchema.parse({})),
        values: values({ topic: 'Changed' }),
      });
      expect(codeOf(saved)).toBe('plan_year_closed');
      const plan = planOf(await api.get(`/api/plans/journals/${s.journal}?quarterId=${s.q2}`));
      expect(plan.closed).toBe(true);
      expect(plan.canEdit).toBe(false);
    });
    expect(await planRowsOf(s.scene.branch)).toEqual(before);
  });

  it('makes one plan on the first write and refuses a taken or unknown row', async () => {
    const s = await plannedScene();
    const [first] = await fill(s, s.q2, [1]);
    await fill(s, s.q2, [2]);
    const plans = await t.database.migrator
      .selectFrom('lesson_plan_journals')
      .select('plan_id')
      .where('journal_id', '=', s.journal)
      .execute();
    expect(plans).toHaveLength(1);
    const created = await t.entries('plan.create', plans[0]?.plan_id);
    expect(created).toHaveLength(1);
    await as(s.owner, s.scene.branch, [], async (api) => {
      const taken = await api.post(`/api/plans/journals/${s.journal}/items`, {
        quarterId: s.q2,
        position: 1,
        values: values(),
      });
      expect(taken.status).toBe(409);
      expect(codeOf(taken)).toBe('plan_row_taken');
      expect(apiErrorSchema.parse(taken.body).error.details?.[0]?.recordId).toBe(first?.id);
      const unknown = await api.post(`/api/plans/journals/${s.journal}/items`, {
        quarterId: s.q2,
        position: 9,
        values: values(),
      });
      expect(codeOf(unknown)).toBe('plan_row_unknown');
      const eleven = await api.post(`/api/plans/journals/${s.journal}/items`, {
        quarterId: s.q2,
        position: 3,
        values: values({
          classworks: Array.from({ length: 11 }, (_, i) => ({ title: `W${i}`, description: '' })),
        }),
      });
      expect(eleven.status).toBe(400);
    });
  });

  it('writes only the fields a save changes, and refuses a field changed since it was read', async () => {
    const s = await plannedScene();
    const branch = s.scene.branch;
    const item = await as(s.owner, branch, teacherOf(s), async (api) =>
      itemOf(
        await api.post(`/api/plans/journals/${s.journal}/items`, {
          quarterId: s.q2,
          position: 1,
          values: values({
            topic: 'Fractions',
            classworks: [
              { title: 'Exercise 1', description: '' },
              { title: 'Exercise 2', description: 'Page 12' },
            ],
            homeworks: [{ title: 'Read 3.1', description: '' }],
          }),
        }),
        201,
      ),
    );
    const read = baseOf(item);
    const [exercise1, exercise2] = item.classworks;
    await as(s.owner, branch, [], async (api) => {
      // Tab A changes the topic.
      const a = itemOf(
        await api.put(`/api/plans/items/${item.id}`, {
          base: read,
          values: { ...read, topic: 'Fractions and decimals' },
        }),
      );
      expect(a.topic).toBe('Fractions and decimals');
      // Tab B, with the older topic in base and value, changes the objectives only.
      const b = itemOf(
        await api.put(`/api/plans/items/${item.id}`, {
          base: read,
          values: { ...read, objectives: 'Compare fractions' },
        }),
      );
      expect(b.topic).toBe('Fractions and decimals');
      expect(b.objectives).toBe('Compare fractions');
      // Tab C changes the topic from the older state: refused with the stored value.
      const c = await api.put(`/api/plans/items/${item.id}`, {
        base: read,
        values: { ...read, topic: 'Decimals' },
      });
      expect(c.status).toBe(409);
      expect(codeOf(c)).toBe('plan_item_stale');
      expect(apiErrorSchema.parse(c.body).error.details).toEqual([
        expect.objectContaining({
          path: 'values.topic',
          storedPlanValue: 'Fractions and decimals',
        }),
      ]);
      // One work's title changed by A, then by C from the older state.
      const renamed = itemOf(
        await api.put(`/api/plans/items/${item.id}`, {
          base: baseOf(b),
          values: {
            ...baseOf(b),
            classworks: [{ ...exercise1, title: 'Exercise 1a' }, exercise2],
          },
        }),
      );
      expect(renamed.classworks.map((one) => one.title)).toEqual(['Exercise 1a', 'Exercise 2']);
      const stale = await api.put(`/api/plans/items/${item.id}`, {
        base: baseOf(b),
        values: { ...baseOf(b), classworks: [{ ...exercise1, title: 'Exercise 1b' }, exercise2] },
      });
      expect(codeOf(stale)).toBe('plan_item_stale');
      expect(apiErrorSchema.parse(stale.body).error.details).toEqual([
        expect.objectContaining({
          path: `values.classworks.${exercise1?.id ?? ''}`,
          storedPlanValue: { title: 'Exercise 1a', description: '' },
        }),
      ]);
    });
  });

  it('keeps the old and new values in the audit entry, a removed work whole', async () => {
    const s = await plannedScene();
    const branch = s.scene.branch;
    await as(s.owner, branch, teacherOf(s), async (api) => {
      const item = itemOf(
        await api.post(`/api/plans/journals/${s.journal}/items`, {
          quarterId: s.q2,
          position: 2,
          values: values({
            classworks: [
              { title: 'Exercise 1', description: 'Page 4' },
              { title: 'Exercise 2', description: '' },
            ],
          }),
        }),
        201,
      );
      const [first, second] = item.classworks;
      const saved = await api.put(`/api/plans/items/${item.id}`, {
        base: baseOf(item),
        values: {
          ...baseOf(item),
          topic: 'Percentages',
          classworks: [second, { title: 'Quiz', description: '' }],
        },
      });
      const after = itemOf(saved);
      expect(after.classworks.map((one) => one.title)).toEqual(['Exercise 2', 'Quiz']);
      const entry = await entryNaming('plan.item_edit', item.id);
      expect(entry).toMatchObject({
        old_value: {
          topic: 'Fractions',
          classworks: [
            {
              id: first?.id,
              kind: 'classwork',
              position: 1,
              title: 'Exercise 1',
              description: 'Page 4',
            },
            {
              id: second?.id,
              kind: 'classwork',
              position: 2,
              title: 'Exercise 2',
              description: '',
            },
          ],
        },
        new_value: {
          topic: 'Percentages',
          classworks: [
            { id: second?.id, position: 1, title: 'Exercise 2' },
            { position: 2, title: 'Quiz' },
          ],
        },
        details: {
          itemId: item.id,
          removedWorks: [
            {
              id: first?.id,
              kind: 'classwork',
              position: 1,
              title: 'Exercise 1',
              description: 'Page 4',
            },
          ],
        },
        request_id: saved.headers['x-request-id'],
      });
      expect(entry?.new_value).not.toHaveProperty('objectives');
      expect(entry?.assignment_id).not.toBeNull();
    });
  });

  it('refuses a save that would leave more than 10 works of a kind', async () => {
    const s = await plannedScene();
    await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
      const four = Array.from({ length: 4 }, (_, i) => ({ title: `W${i}`, description: '' }));
      const item = itemOf(
        await api.post(`/api/plans/journals/${s.journal}/items`, {
          quarterId: s.q2,
          position: 1,
          values: values({ homeworks: four }),
        }),
        201,
      );
      const read = baseOf(item);
      const six = Array.from({ length: 6 }, (_, i) => ({ title: `A${i}`, description: '' }));
      itemOf(
        await api.put(`/api/plans/items/${item.id}`, {
          base: read,
          values: { ...read, homeworks: [...read.homeworks, ...six] },
        }),
      );
      // From the older state another work is added: 11 together.
      const over = await api.put(`/api/plans/items/${item.id}`, {
        base: read,
        values: { ...read, homeworks: [...read.homeworks, { title: 'B', description: '' }] },
      });
      expect(over.status).toBe(409);
      expect(codeOf(over)).toBe('plan_works_full');
    });
  });

  it('clears a row of a lesson not yet held, as the journal reads "held"', async () => {
    const s = await plannedScene();
    const branch = s.scene.branch;
    const [held, needsTeacher, away] = await fill(s, s.q1, [1, 2, 3]);
    const [future] = await fill(s, s.q2, [1]);
    const q1Lessons = await lessonsOf(s.scene, QUARTERS[0][0], QUARTERS[0][1]);
    // The lesson of row 2 has no teacher recorded; the teacher of row 3 was away.
    await t.database.migrator
      .updateTable('lessons')
      .set({ teacher_id: null })
      .where('id', '=', q1Lessons[1]?.id ?? '')
      .execute();
    await t.database.migrator
      .insertInto('absences')
      .values({
        staff_id: s.scene.teacher.staffId,
        starts_on: '2026-10-26',
        ends_on: '2026-10-26',
        applies_from: new Date('2026-10-26T00:00:00+05:00'),
        applies_until: new Date('2026-10-27T00:00:00+05:00'),
        reason: 'Ill',
        created_by: s.owner.account.id,
      })
      .execute();
    await as(s.owner, branch, teacherOf(s), async (api) => {
      const plan = planOf(await api.get(`/api/plans/journals/${s.journal}?quarterId=${s.q1}`));
      expect(plan.rows.map((row) => row.held)).toEqual([true, false, false]);
      const refused = await api.post(`/api/plans/items/${held?.id ?? ''}/clear`);
      expect(codeOf(refused)).toBe('plan_row_held');
      for (const item of [needsTeacher, away, future]) {
        expect((await api.post(`/api/plans/items/${item?.id ?? ''}/clear`)).status).toBe(204);
      }
      const q2 = planOf(await api.get(`/api/plans/journals/${s.journal}?quarterId=${s.q2}`));
      expect(q2.rows[0]?.item).toBeNull();
      // The position is free again.
      itemOf(
        await api.post(`/api/plans/journals/${s.journal}/items`, {
          quarterId: s.q2,
          position: 1,
          values: values({ topic: 'Again' }),
        }),
        201,
      );
      expect(
        codeOf(
          await api.put(`/api/plans/items/${future?.id ?? ''}`, {
            base: baseOf(future ?? planItemSchema.parse({})),
            values: values({ topic: 'x' }),
          }),
        ),
      ).toBe('not_found');
    });
    const entry = await entryNaming('plan.item_clear', needsTeacher?.id ?? '');
    expect(entry).toMatchObject({ old_value: { itemId: needsTeacher?.id, topic: 'Topic 2' } });
  });

  it('adds, reads and removes files within the limits', async () => {
    const s = await plannedScene();
    const branch = s.scene.branch;
    const [item] = await fill(s, s.q2, [1]);
    const id = item?.id ?? '';
    const file = await as(s.owner, branch, teacherOf(s), async (api) => {
      const added = await api.upload(
        `/api/plans/items/${id}/files?name=${encodeURIComponent('Ishchi varaq.pdf')}`,
        'application/pdf',
        PDF,
      );
      expect(added.status, JSON.stringify(added.body)).toBe(200);
      const wrongBytes = await api.upload(
        `/api/plans/items/${id}/files?name=x.png`,
        'image/png',
        PDF,
      );
      expect(codeOf(wrongBytes)).toBe('plan_file_type');
      const notListed = await api.upload(
        `/api/plans/items/${id}/files?name=x.gif`,
        'image/gif',
        PDF,
      );
      expect(notListed.status).toBe(415);
      return planFileSchema.parse(added.body);
    });
    expect(file).toMatchObject({
      name: 'Ishchi varaq.pdf',
      type: 'application/pdf',
      bytes: PDF.length,
    });
    // A reader of the plan downloads it; a teacher of another subject does not.
    const head = await account();
    await as(
      head,
      branch,
      [{ role: 'head_teacher', branchId: branch, subjectIds: [s.scene.subject] }],
      async (api) => {
        const read = await api.get(`/api/plans/files/${file.id}`).buffer(true);
        expect(read.status).toBe(200);
        expect(read.headers['content-type']).toBe('application/pdf');
        expect(read.headers['content-disposition']).toContain('attachment');
      },
    );
    const elsewhere = await account();
    await load.teacher(branch, {
      subjects: [{ subject: await load.classes.subject({ grades: [7] }), grades: [7] }],
      accountId: elsewhere.account.id,
    });
    await as(elsewhere, branch, [{ role: 'teacher', branchId: branch }], async (api) => {
      expect(codeOf(await api.get(`/api/plans/files/${file.id}`))).toBe('plan_scope');
    });
    await as(s.owner, branch, [], async (api) => {
      for (let index = 1; index < 10; index += 1) {
        const added = await api.upload(
          `/api/plans/items/${id}/files?name=f${index}.pdf`,
          'application/pdf',
          PDF,
        );
        expect(added.status).toBe(200);
      }
      const eleventh = await api.upload(
        `/api/plans/items/${id}/files?name=f.pdf`,
        'application/pdf',
        PDF,
      );
      expect(codeOf(eleventh)).toBe('plan_files_full');
      const tooLarge = await api.upload(
        `/api/plans/items/${id}/files?name=big.pdf`,
        'application/pdf',
        Buffer.concat([PDF, Buffer.alloc(20_000_001 - PDF.length)]),
      );
      expect(tooLarge.status).toBe(413);
      expect(codeOf(tooLarge)).toBe('plan_file_too_large');
      expect((await api.del(`/api/plans/files/${file.id}`)).status).toBe(204);
      expect(codeOf(await api.get(`/api/plans/files/${file.id}`))).toBe('not_found');
      const plan = planOf(await api.get(`/api/plans/journals/${s.journal}?quarterId=${s.q2}`));
      expect(plan.rows[0]?.item?.files).toHaveLength(9);
    });
    const removed = await entryNaming('plan.file_remove', file.id);
    expect(removed).toMatchObject({ old_value: { id: file.id, name: 'Ishchi varaq.pdf' } });
  });

  it('answers 404 for another branch’s or an unknown journal, quarter, item, file and year', async () => {
    const s = await plannedScene();
    const other = await plannedScene();
    const [item] = await fill(s, s.q2, [1]);
    const [otherItem] = await fill(other, other.q2, [1]);
    const otherFile = await as(other.owner, other.scene.branch, teacherOf(other), async (api) =>
      planFileSchema.parse(
        (
          await api.upload(
            `/api/plans/items/${otherItem?.id ?? ''}/files?name=a.pdf`,
            'application/pdf',
            PDF,
          )
        ).body,
      ),
    );
    const before = [await planRowsOf(s.scene.branch), await planRowsOf(other.scene.branch)];
    const audit = await planEntries();
    await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
      for (const journal of [other.journal, UNKNOWN]) {
        expect(codeOf(await api.get(`/api/plans/journals/${journal}`))).toBe('not_found');
        expect(
          codeOf(
            await api.post(`/api/plans/journals/${journal}/items`, {
              quarterId: s.q2,
              position: 1,
              values: values(),
            }),
          ),
        ).toBe('not_found');
      }
      for (const quarter of [other.q2, UNKNOWN]) {
        expect(codeOf(await api.get(`/api/plans/journals/${s.journal}?quarterId=${quarter}`))).toBe(
          'not_found',
        );
        expect(
          codeOf(
            await api.post(`/api/plans/journals/${s.journal}/items`, {
              quarterId: quarter,
              position: 2,
              values: values(),
            }),
          ),
        ).toBe('not_found');
      }
      for (const id of [otherItem?.id ?? '', UNKNOWN]) {
        expect(
          codeOf(
            await api.put(`/api/plans/items/${id}`, {
              base: baseOf(item ?? planItemSchema.parse({})),
              values: values({ topic: 'x' }),
            }),
          ),
        ).toBe('not_found');
        expect(codeOf(await api.post(`/api/plans/items/${id}/clear`))).toBe('not_found');
        expect(
          codeOf(
            await api.upload(`/api/plans/items/${id}/files?name=a.pdf`, 'application/pdf', PDF),
          ),
        ).toBe('not_found');
      }
      for (const id of [otherFile.id, UNKNOWN]) {
        expect(codeOf(await api.get(`/api/plans/files/${id}`))).toBe('not_found');
        expect(codeOf(await api.del(`/api/plans/files/${id}`))).toBe('not_found');
      }
      for (const year of [other.scene.year, UNKNOWN]) {
        expect(codeOf(await api.get(`/api/plans?yearId=${year}`))).toBe('not_found');
      }
    });
    expect([await planRowsOf(s.scene.branch), await planRowsOf(other.scene.branch)]).toEqual(
      before,
    );
    expect(await planEntries()).toBe(audit);
  });

  it('lets a publish and a forced delete remove a future lesson that holds an item', async () => {
    const s = await plannedScene();
    await fill(s, s.q2, [1, 2]);
    const [lesson] = await lessonsOf(s.scene, '2026-11-09', '2026-11-09');
    const deleted = await request(t.kit.server)
      .post(`/api/timetable/lessons/${lesson?.id ?? ''}/forced-delete`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, s.scene.branch)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ reason: 'Entered for the wrong class' });
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    const plan = await as(s.owner, s.scene.branch, teacherOf(s), async (api) =>
      planOf(await api.get(`/api/plans/journals/${s.journal}?quarterId=${s.q2}`)),
    );
    expect(plan.rows[0]?.date).toBe('2026-11-16');
    expect(plan.rows[0]?.item?.topic).toBe('Topic 1');
  });
});
