import { randomUUID } from 'node:crypto';
import {
  apiErrorSchema,
  BRANCH_HEADER,
  planFileSchema,
  planItemSchema,
  planListSchema,
  planSchema,
  type Plan,
  type PhotoType,
  type PlanFileType,
  type PlanItem,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response, type Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ActingKit } from '../../testing/acting-kit.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { Audit } from '../audit/audit.service.js';
import { MemoryPhotoStore, type PhotoStore } from '../people/photo-store.js';

/** The memory store, switched off for one test (no store configured on the server). */
class SwitchedStore implements PhotoStore {
  configured = true;
  private readonly memory = new MemoryPhotoStore();

  put(key: string, bytes: Buffer, type: PhotoType | PlanFileType): Promise<void> {
    return this.memory.put(key, bytes, type);
  }

  get(key: string): Promise<Buffer> {
    return this.memory.get(key);
  }
}

const store = new SwitchedStore();
import {
  publishedScene,
  publishOf,
  QUARTERS,
  type PublishedScene,
} from '../../testing/published-scene.js';
import { openPlanWindows } from '../../testing/plan-windows-kit.js';

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
    post(path: string, body?: object): PromiseLike<Response>;
    put(path: string, body: object): Test;
    del(path: string): Test;
    upload(path: string, type: string, bytes: Buffer): Test;
  }

  /**
   * The lesson at a create's position, as the plan's rows are (the quarter's
   * lessons not cancelled, in order); the first row's for a position past the
   * last, any uuid for a journal or quarter not found.
   */
  async function rowLessonOf(journalId: string, body: object): Promise<string> {
    const { quarterId, position } = body as { quarterId?: string; position?: number };
    const db = t.database.migrator;
    const journal = await db
      .selectFrom('journals')
      .selectAll()
      .where('id', '=', journalId)
      .executeTakeFirst();
    const quarter = await db
      .selectFrom('quarters')
      .select([sql<string>`start_date::text`.as('start'), sql<string>`end_date::text`.as('end')])
      .where('id', '=', quarterId ?? randomUUID())
      .executeTakeFirst();
    if (journal === undefined || quarter === undefined) return randomUUID();
    let query = db
      .selectFrom('lessons')
      .select('id')
      .where('subject_id', '=', journal.subject_id)
      .where('cancel_cause', 'is', null)
      .where('lesson_date', '>=', quarter.start)
      .where('lesson_date', '<=', quarter.end);
    query =
      journal.class_id === null
        ? query.where('group_id', '=', journal.group_id)
        : query.where('class_id', '=', journal.class_id);
    const rows = await query.orderBy('starts_at').orderBy('id').execute();
    return rows[(position ?? 1) - 1]?.id ?? rows[0]?.id ?? randomUUID();
  }

  const apiOf = (branch: string, cookie: string): Api => ({
    get: (path) => request(t.kit.server).get(path).set('Cookie', cookie).set(BRANCH_HEADER, branch),
    post: (path, body = {}) => {
      const send = (sent: object) =>
        request(t.kit.server)
          .post(path)
          .set('Cookie', cookie)
          .set(BRANCH_HEADER, branch)
          .send(sent);
      const journal = /^\/api\/plans\/journals\/([^/]+)\/items$/.exec(path)?.[1];
      if (journal === undefined || 'lessonId' in body) return send(body);
      // Task 7.1b: a create names the lesson of its row; read as the database holds it.
      return rowLessonOf(journal, body).then((lessonId) => send({ ...body, lessonId }));
    },
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
        // In a fixed order: an update moves a row in the table.
        .orderBy(table === 'lesson_plan_journals' ? 'plan_id' : 'id')
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
    // Task 7.2: the plans are written inside their window.
    await openPlanWindows(t.database.migrator, scene.branch, scene.year);
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
    t = await dayTemplatesKit({ jobs: true, photoStore: store });
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
    expect(plan.notCovered).toEqual([]);

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
    expect(after.notCovered.map((item) => item.topic)).toEqual(['Topic 8']);

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
    const otherSenior = await account();
    expect(
      codeOf(
        await read(otherSenior, [{ role: 'senior_head_teacher', subjectIds: [otherSubject] }]),
      ),
    ).toBe('plan_scope');
    // A Head Teacher of the subject in another branch who teaches here reads nothing by the post.
    const elsewhereHead = await account();
    const otherBranch = await t.newBranch();
    expect(
      codeOf(
        await read(elsewhereHead, [
          { role: 'head_teacher', branchId: otherBranch, subjectIds: [s.scene.subject] },
          { role: 'teacher', branchId: branch },
        ]),
      ),
    ).toBe('plan_scope');
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
    const both = [s.journal, s.otherJournal];
    expect((await listOf(head, [])).plans.map((one) => one.journalId)).toEqual(both);
    expect((await listOf(otherHead, [])).plans).toEqual([]);
    const vice = await account();
    expect(
      (await listOf(vice, [{ role: 'academic_vice_principal', branchId: branch }])).plans.map(
        (one) => one.journalId,
      ),
    ).toEqual(both);
  });

  it('refuses a write from everyone but the owner, leaving every row and the audit log', async () => {
    const s = await plannedScene();
    const branch = s.scene.branch;
    const [item] = await fill(s, s.q2, [1]);
    const file = await t.database.migrator
      .insertInto('lesson_plan_files')
      .values({
        branch_id: branch,
        item_id: item?.id ?? '',
        name: 'Sheet.pdf',
        type: 'application/pdf',
        bytes: PDF.length,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const before = await planRowsOf(branch);
    const audit = await planEntries();
    const writes = (api: Api) => [
      api.del(`/api/plans/files/${file.id}`),
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
      // Task 7.1c (permission review of the code, must-fix 2).
      api.post(`/api/plans/journals/${s.journal}/share`, {
        quarterId: s.q2,
        journalId: s.otherJournal,
      }),
      api.post(`/api/plans/journals/${s.journal}/separate`, { quarterId: s.q2 }),
      api.post(`/api/plans/journals/${s.journal}/copy`, {
        quarterId: s.q2,
        source: { journalId: s.otherJournal, quarterId: s.q2 },
        part: 'all',
      }),
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
      // Past the scope: the journal has no lesson yet, so the lesson the
      // create names for row 1 is unknown (task 7.1b, decision 12).
      expect(codeOf(await write(api))).toBe('not_found');
      expect(planOf(await api.get(`/api/plans/journals/${actingScene.journal}`)).canEdit).toBe(
        true,
      );
    });
  });

  it('refuses an attendance-only journal and a closed year', async () => {
    const owner = await account();
    const scene = await publishedScene(t, load, { accounts: { teacher: owner.account.id } });
    await openPlanWindows(t.database.migrator, scene.branch, scene.year);
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

  // Task 7.2 (review decision 21): the journal has its plan of every quarter
  // from the moment it exists (0117), so a first write makes none.
  it('writes into the plan the journal has of each quarter and refuses a taken or unknown row', async () => {
    const s = await plannedScene();
    const before = await t.database.migrator
      .selectFrom('lesson_plan_journals')
      .select(['plan_id', 'quarter_id'])
      .where('journal_id', '=', s.journal)
      .orderBy('quarter_id')
      .execute();
    expect(before).toHaveLength(4);
    const [first] = await fill(s, s.q2, [1]);
    await fill(s, s.q2, [2]);
    const plans = await t.database.migrator
      .selectFrom('lesson_plan_journals')
      .select(['plan_id', 'quarter_id'])
      .where('journal_id', '=', s.journal)
      .orderBy('quarter_id')
      .execute();
    expect(plans).toEqual(before);
    expect(await t.entries('plan.create')).toEqual([]);
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
      const teaching = await t.database.migrator
        .selectFrom('assignments')
        .select('id')
        .where('account_id', '=', s.owner.account.id)
        .where('role', '=', 'teacher')
        .executeTakeFirstOrThrow();
      expect(entry?.assignment_id).toBe(teaching.id);
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

  it('changes nothing for a work id of another item, another branch or none in a save', async () => {
    const s = await plannedScene();
    const other = await plannedScene();
    const branch = s.scene.branch;
    const withWork = (topic: string) =>
      values({ topic, classworks: [{ title: `Work of ${topic}`, description: '' }] });
    const [item, second] = await as(s.owner, branch, teacherOf(s), async (api) => [
      itemOf(
        await api.post(`/api/plans/journals/${s.journal}/items`, {
          quarterId: s.q2,
          position: 1,
          values: withWork('First'),
        }),
        201,
      ),
      itemOf(
        await api.post(`/api/plans/journals/${s.journal}/items`, {
          quarterId: s.q2,
          position: 2,
          values: withWork('Second'),
        }),
        201,
      ),
    ]);
    const otherItem = await as(other.owner, other.scene.branch, teacherOf(other), async (api) =>
      itemOf(
        await api.post(`/api/plans/journals/${other.journal}/items`, {
          quarterId: other.q2,
          position: 1,
          values: withWork('Elsewhere'),
        }),
        201,
      ),
    );
    const own = item ?? planItemSchema.parse({});
    const before = [await planRowsOf(branch), await planRowsOf(other.scene.branch)];
    const audit = await planEntries();
    await as(s.owner, branch, [], async (api) => {
      for (const id of [
        second?.classworks[0]?.id ?? '',
        otherItem.classworks[0]?.id ?? '',
        UNKNOWN,
      ]) {
        const foreign = { id, title: 'Work of First', description: '' };
        // As an edit: refused, the work is not the item's.
        const edited = await api.put(`/api/plans/items/${own.id}`, {
          base: { ...baseOf(own), classworks: [...own.classworks, foreign] },
          values: { ...baseOf(own), classworks: [...own.classworks, { ...foreign, title: 'X' }] },
        });
        expect(edited.status, JSON.stringify(edited.body)).toBe(409);
        expect(codeOf(edited)).toBe('plan_item_stale');
        // As a removal: nothing to remove.
        const removed = await api.put(`/api/plans/items/${own.id}`, {
          base: { ...baseOf(own), classworks: [...own.classworks, foreign] },
          values: baseOf(own),
        });
        expect(removed.status, JSON.stringify(removed.body)).toBe(200);
      }
    });
    expect([await planRowsOf(branch), await planRowsOf(other.scene.branch)]).toEqual(before);
    expect(await planEntries()).toBe(audit);
  });

  it('answers files_not_configured on a server with no file store, and keeps nothing', async () => {
    const s = await plannedScene();
    const [item] = await fill(s, s.q2, [1]);
    const id = item?.id ?? '';
    const file = await as(s.owner, s.scene.branch, teacherOf(s), async (api) =>
      planFileSchema.parse(
        (await api.upload(`/api/plans/items/${id}/files?name=a.pdf`, 'application/pdf', PDF)).body,
      ),
    );
    store.configured = false;
    try {
      await as(s.owner, s.scene.branch, [], async (api) => {
        const added = await api.upload(
          `/api/plans/items/${id}/files?name=b.pdf`,
          'application/pdf',
          PDF,
        );
        expect(added.status).toBe(503);
        expect(codeOf(added)).toBe('files_not_configured');
        const read = await api.get(`/api/plans/files/${file.id}`);
        expect(codeOf(read)).toBe('files_not_configured');
      });
    } finally {
      store.configured = true;
    }
    const files = await t.database.migrator
      .selectFrom('lesson_plan_files')
      .select('name')
      .where('item_id', '=', id)
      .execute();
    expect(files.map((one) => one.name)).toEqual(['a.pdf']);
  });

  it('lets a teacher with either grade of a two-grade group read its plan, and no other grade', async () => {
    const branch = await t.newBranch();
    const year = await load.classes.year(branch);
    for (const [index, [start, end]] of QUARTERS.entries()) {
      await t.database.migrator
        .updateTable('quarters')
        .set({ start_date: start, end_date: end })
        .where('academic_year_id', '=', year)
        .where('number', '=', index + 1)
        .execute();
    }
    const subject = await load.classes.subject({ grades: [7, 8, 9] });
    const seventh = await load.classes.schoolClass(branch, year, { grade: 7 });
    const eighth = await load.classes.schoolClass(branch, year, { grade: 8 });
    const group = await load.classes.group(branch, year, subject, [seventh, eighth]);
    const journal = await t.database.migrator
      .insertInto('journals')
      .values({
        branch_id: branch,
        academic_year_id: year,
        class_id: null,
        group_id: group,
        subject_id: subject,
        runs: '{[2026-09-07,)}',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const reader = async (grades: number[]) => {
      const browser = await account();
      await load.teacher(branch, {
        subjects: [{ subject, grades }],
        accountId: browser.account.id,
      });
      return as(browser, branch, [{ role: 'teacher', branchId: branch }], (api) =>
        api.get(`/api/plans/journals/${journal.id}`),
      );
    };
    for (const grades of [[7], [8]]) {
      const answer = await reader(grades);
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(planSchema.parse(answer.body).canEdit).toBe(false);
    }
    expect(codeOf(await reader([9]))).toBe('plan_scope');
  });

  it('lets a child row through while the journal or the item is held for a plan write', async () => {
    const acting = new ActingKit(t.database.migrator);
    const branch = await t.newBranch();
    const scene = await acting.scene(branch);
    const s = await plannedScene();
    const [item] = await fill(s, s.q2, [1]);
    /** Holds `lock` open, runs `child`, and says whether it finished within two seconds. */
    const passesWhileHeld = async (
      heldBranch: string,
      lock: (transaction: Transaction) => Promise<unknown>,
      child: () => Promise<unknown>,
    ): Promise<boolean> => {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked: () => void = () => undefined;
      const isLocked = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const held = t.app.get(Transactions).run([heldBranch], async (transaction) => {
        await lock(transaction);
        locked();
        await released;
      });
      await isLocked;
      const done = await Promise.race([
        child().then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
      ]);
      release();
      await held;
      return done;
    };
    // The journal as a first write locks it; an acting period names the journal.
    expect(
      await passesWhileHeld(
        branch,
        (transaction) =>
          transaction
            .selectFrom('journals')
            .select('id')
            .where('id', '=', scene.journal)
            .forNoKeyUpdate()
            .execute(),
        () => acting.period(scene, '2026-09-07'),
      ),
    ).toBe(true);
    // The item as a save locks it; a work of the item names it.
    expect(
      await passesWhileHeld(
        s.scene.branch,
        (transaction) =>
          transaction
            .selectFrom('lesson_plan_items')
            .select('id')
            .where('id', '=', item?.id ?? '')
            .forNoKeyUpdate()
            .execute(),
        () =>
          t.database.migrator
            .insertInto('lesson_plan_works')
            .values({
              branch_id: s.scene.branch,
              item_id: item?.id ?? '',
              kind: 'homework',
              position: 1,
              title: 'Read',
            })
            .execute(),
      ),
    ).toBe(true);
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

  it('lets a publish move the lessons of a plan with items: the items follow the new dates', async () => {
    const s = await plannedScene();
    await fill(s, s.q2, [1, 2]);
    const created = await t.post('/api/timetable/versions', s.scene.branch, {
      academicYearId: s.scene.year,
      startsOn: '2026-11-02',
      copyFrom: s.scene.version,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const draft = (created.body as { id: string }).id;
    // The copy moves the class's maths to Wednesday; the other class keeps Monday.
    await t.database.migrator
      .deleteFrom('pattern_blocks')
      .where('version_id', '=', draft)
      .execute();
    const rows = await t.database.migrator
      .selectFrom('teaching_load_rows')
      .select(['id', 'class_id'])
      .where('version_id', '=', draft)
      .execute();
    for (const row of rows) {
      const placed = await t.post(`/api/timetable/versions/${draft}/pattern`, s.scene.branch, {
        loadRowId: row.id,
        weekday: row.class_id === s.scene.classId ? 3 : 1,
        slotPosition: 1,
      });
      expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    }
    const confirmed = await t.post(
      `/api/timetable/versions/${draft}/templates/confirm`,
      s.scene.branch,
    );
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    await load.freeEditLock(draft);
    const published = await publishOf(t)(s.scene.branch, draft, '2026-11-02');
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    const plan = await as(s.owner, s.scene.branch, teacherOf(s), async (api) =>
      planOf(await api.get(`/api/plans/journals/${s.journal}?quarterId=${s.q2}`)),
    );
    expect(plan.rows[0]?.date).toBe('2026-11-11');
    expect(plan.rows.slice(0, 2).map((row) => row.item?.topic)).toEqual(['Topic 1', 'Topic 2']);
  });

  it('lets a forced delete remove a future lesson that holds an item', async () => {
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
  describe('at the same moment', () => {
    /**
     * Holds `hold` open in a transaction of the application for the branch, starts
     * `run` once the hold has written, waits until `run` waits on the held
     * transaction (`pg_blocking_pids`, `api.md`), then commits.
     */
    async function heldThen(
      branch: string,
      hold: (transaction: Transaction) => Promise<void>,
      run: () => PromiseLike<Response>,
    ): Promise<Response> {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: (pid: number) => void = () => undefined;
      const isReady = new Promise<number>((resolve) => {
        ready = resolve;
      });
      const held = t.app
        .get(Transactions)
        .run([branch], async (transaction) => {
          await hold(transaction);
          const pid = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(
            transaction,
          );
          ready(pid.rows[0]?.pid ?? 0);
          await released;
        })
        .catch((error: unknown) => error);
      const heldPid = await isReady;
      // A supertest request is sent only once it is awaited: start it now.
      const answer = new Promise<Response>((resolve, reject) => {
        run().then(resolve, reject);
      });
      let waited = false;
      for (let tries = 0; tries < 800 && !waited; tries += 1) {
        const found = await sql<{ n: number }>`
          select count(*)::int as n from pg_stat_activity a
          where a.datname = current_database() and ${heldPid}::int = any (pg_blocking_pids(a.pid))
        `.execute(t.database.migrator);
        waited = (found.rows[0]?.n ?? 0) >= 1;
        if (!waited) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      release();
      expect(waited, 'the route waited on the held transaction').toBe(true);
      const heldError = await held;
      if (heldError !== undefined) {
        throw heldError instanceof Error ? heldError : new Error('The hold failed.');
      }
      return answer;
    }

    it('refuses the second of two saves of one field: it waits on the item and finds it changed', async () => {
      const s = await plannedScene();
      const [item] = await fill(s, s.q2, [1]);
      const id = item?.id ?? '';
      await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
        const answer = await heldThen(
          s.scene.branch,
          async (transaction) => {
            // The first save, held before its commit: it locks the item and writes the topic.
            await transaction
              .selectFrom('lesson_plan_items')
              .select('id')
              .where('id', '=', id)
              .forNoKeyUpdate()
              .execute();
            await transaction
              .updateTable('lesson_plan_items')
              .set({ topic: 'Written first' })
              .where('id', '=', id)
              .execute();
            await t.app.get(Audit).record(transaction, {
              branchId: s.scene.branch,
              actorId: s.owner.account.id,
              action: 'plan.item_edit',
              record: { type: 'lesson_plan_item', id },
            });
          },
          () =>
            api.put(`/api/plans/items/${id}`, {
              base: baseOf(item ?? planItemSchema.parse({})),
              values: values({ topic: 'Written second' }),
            }),
        );
        expect(answer.status, JSON.stringify(answer.body)).toBe(409);
        expect(codeOf(answer)).toBe('plan_item_stale');
        expect(apiErrorSchema.parse(answer.body).error.details?.[0]?.storedPlanValue).toBe(
          'Written first',
        );
      });
    });

    // Task 7.2: the plan exists with the journal; two first writes of one row
    // meet on the journal's lock.
    it('makes one item of two first writes of a row: the second waits on the journal and finds the row taken', async () => {
      const s = await plannedScene();
      const plan = await t.database.migrator
        .selectFrom('lesson_plan_journals')
        .select('plan_id as id')
        .where('journal_id', '=', s.journal)
        .where('quarter_id', '=', s.q2)
        .executeTakeFirstOrThrow();
      await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
        const answer = await heldThen(
          s.scene.branch,
          async (transaction) => {
            // The first write, held before its commit: the journal's lock and the item.
            await transaction
              .selectFrom('journals')
              .select('id')
              .where('id', '=', s.journal)
              .forNoKeyUpdate()
              .execute();
            const first = await transaction
              .insertInto('lesson_plan_items')
              .values({ branch_id: s.scene.branch, plan_id: plan.id, topic: 'First' })
              .returning('id')
              .executeTakeFirstOrThrow();
            await transaction
              .insertInto('lesson_plan_places')
              .values({
                branch_id: s.scene.branch,
                plan_id: plan.id,
                journal_id: s.journal,
                item_id: first.id,
                position: 1,
              })
              .execute();
            await t.app.get(Audit).record(transaction, {
              branchId: s.scene.branch,
              actorId: s.owner.account.id,
              action: 'plan.item_create',
              record: { type: 'lesson_plan', id: plan.id },
            });
          },
          () =>
            api.post(`/api/plans/journals/${s.journal}/items`, {
              quarterId: s.q2,
              position: 1,
              values: values({ topic: 'Second' }),
            }),
        );
        expect(answer.status, JSON.stringify(answer.body)).toBe(409);
        expect(codeOf(answer)).toBe('plan_row_taken');
      });
      const items = await t.database.migrator
        .selectFrom('lesson_plan_places')
        .select('item_id')
        .where('plan_id', '=', plan.id)
        .where('position', '=', 1)
        .execute();
      expect(items).toHaveLength(1);
      const created = await t.database.migrator
        .selectFrom('audit_log')
        .select('id')
        .where('branch_id', '=', s.scene.branch)
        .where('action', '=', 'plan.item_create')
        .execute();
      expect(created).toHaveLength(1);
    });

    it('refuses the 11th file of two uploads at 9: the second waits on the item', async () => {
      const s = await plannedScene();
      const [item] = await fill(s, s.q2, [1]);
      const id = item?.id ?? '';
      for (let index = 0; index < 9; index += 1) {
        await t.database.migrator
          .insertInto('lesson_plan_files')
          .values({
            branch_id: s.scene.branch,
            item_id: id,
            name: `f${index}.pdf`,
            type: 'application/pdf',
            bytes: PDF.length,
          })
          .execute();
      }
      await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
        const answer = await heldThen(
          s.scene.branch,
          async (transaction) => {
            // The first upload's row, held before its commit under the item's lock.
            await transaction
              .selectFrom('lesson_plan_items')
              .select('id')
              .where('id', '=', id)
              .forNoKeyUpdate()
              .execute();
            await transaction
              .insertInto('lesson_plan_files')
              .values({
                branch_id: s.scene.branch,
                item_id: id,
                name: 'tenth.pdf',
                type: 'application/pdf',
                bytes: PDF.length,
              })
              .execute();
            await t.app.get(Audit).record(transaction, {
              branchId: s.scene.branch,
              actorId: s.owner.account.id,
              action: 'plan.file_add',
              record: { type: 'lesson_plan_item', id },
            });
          },
          () =>
            api.upload(`/api/plans/items/${id}/files?name=eleventh.pdf`, 'application/pdf', PDF),
        );
        expect(answer.status, JSON.stringify(answer.body)).toBe(409);
        expect(codeOf(answer)).toBe('plan_files_full');
      });
      const files = await t.database.migrator
        .selectFrom('lesson_plan_files')
        .select('name')
        .where('item_id', '=', id)
        .execute();
      expect(files).toHaveLength(10);
    });
  });

  // Task 7.1c, decision 10: a copy names the file whose bytes it shows; no
  // bytes are copied and removing the copy leaves the source as it is.
  it('copies the files of a plan: the copy reads the bytes of the file it names', async () => {
    const s = await plannedScene();
    const [source] = await fill(s, s.q2, [1]);
    const id = source?.id ?? '';
    await as(s.owner, s.scene.branch, teacherOf(s), async (api) => {
      const added = planFileSchema.parse(
        (await api.upload(`/api/plans/items/${id}/files?name=Sheet.pdf`, 'application/pdf', PDF))
          .body,
      );
      // Into the first quarter of the same journal: another plan of the owner.
      const copied = planOf(
        await api.post(`/api/plans/journals/${s.journal}/copy`, {
          quarterId: s.q1,
          source: { journalId: s.journal, quarterId: s.q2 },
          part: 'all',
        }),
      );
      const item = [...copied.rows.map((row) => row.item), ...copied.notCovered].find(
        (one) => one?.topic === 'Topic 1',
      );
      const copy = item?.files[0];
      expect(copy?.name).toBe('Sheet.pdf');
      expect(copy?.id).not.toBe(added.id);
      expect(item?.copiedFrom).toEqual({ journalId: s.journal, quarterId: s.q2 });
      const read = await api.get(`/api/plans/files/${copy?.id ?? ''}`).buffer(true);
      expect(read.status).toBe(200);
      expect(Buffer.compare(read.body as Buffer, PDF)).toBe(0);
      expect((await api.del(`/api/plans/files/${copy?.id ?? ''}`)).status).toBe(204);
      const kept = await api.get(`/api/plans/files/${added.id}`).buffer(true);
      expect(Buffer.compare(kept.body as Buffer, PDF)).toBe(0);
    });
  });

  // Task 7.1c, decision 14 (permission review of the code, should-fix 5):
  // only the owner of every journal of a shared plan writes it. The second
  // journal is linked as a share writes it; its owner is another teacher.
  it('refuses every write of a shared plan to a teacher who owns one of its journals only', async () => {
    const s = await plannedScene();
    const branch = s.scene.branch;
    const [item] = await fill(s, s.q2, [1]);
    const id = item?.id ?? '';
    const plan = await t.database.migrator
      .selectFrom('lesson_plan_journals')
      .select('plan_id')
      .where('journal_id', '=', s.journal)
      .where('quarter_id', '=', s.q2)
      .executeTakeFirstOrThrow();
    // Task 7.2: the other journal has its own plan record (0117); its link moves, as a share does.
    await t.database.migrator
      .updateTable('lesson_plan_journals')
      .set({ plan_id: plan.plan_id })
      .where('journal_id', '=', s.otherJournal)
      .where('quarter_id', '=', s.q2)
      .execute();
    await t.database.migrator
      .insertInto('lesson_plan_places')
      .values({
        branch_id: branch,
        plan_id: plan.plan_id,
        journal_id: s.otherJournal,
        item_id: id,
        position: 1,
      })
      .execute();
    const file = await t.database.migrator
      .insertInto('lesson_plan_files')
      .values({
        branch_id: branch,
        item_id: id,
        name: 'Sheet.pdf',
        type: 'application/pdf',
        bytes: PDF.length,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const before = await planRowsOf(branch);
    const audit = await planEntries();
    await as(s.owner, branch, teacherOf(s), async (api) => {
      for (const response of [
        await api.post(`/api/plans/journals/${s.journal}/items`, {
          quarterId: s.q2,
          position: 2,
          values: values(),
        }),
        await api.put(`/api/plans/items/${id}`, {
          base: baseOf(item ?? planItemSchema.parse({})),
          values: values({ topic: 'Changed' }),
        }),
        await api.post(`/api/plans/items/${id}/clear`),
        await api.upload(`/api/plans/items/${id}/files?name=Sheet.pdf`, 'application/pdf', PDF),
        await api.del(`/api/plans/files/${file.id}`),
        await api.post(`/api/plans/journals/${s.journal}/separate`, { quarterId: s.q2 }),
        await api.post(`/api/plans/journals/${s.journal}/copy`, {
          quarterId: s.q2,
          source: { journalId: s.otherJournal, quarterId: s.q1 },
          part: 'all',
        }),
      ]) {
        expect(response.status, JSON.stringify(response.body)).toBe(403);
        expect(codeOf(response)).toBe('plan_scope');
      }
    });
    expect(await planRowsOf(branch)).toEqual(before);
    expect(await planEntries()).toBe(audit);
  });
});
