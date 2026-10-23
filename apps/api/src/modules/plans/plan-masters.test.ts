import { randomUUID } from 'node:crypto';
import {
  apiErrorSchema,
  BRANCH_HEADER,
  planListSchema,
  planMasterCompareSchema,
  planMasterSchema,
  planMastersSchema,
  planParallelSchema,
  planSchema,
  type Plan,
  type PlanMaster,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { publishedScene } from '../../testing/published-scene.js';
import { MemoryPhotoStore } from '../people/photo-store.js';

// All names are invented. Task 7.3, pull request #216: docs/spec/09-lesson-plans.md,
// Master plans; docs/spec/edge-cases/lesson-plans.md, "The master plan is changed after
// six teachers copied it"; docs/spec/02-roles-and-access.md, the Head Teacher "Keeps
// master plans", the Senior Head Teacher "Can keep a master plan for all branches".

/** Tuesday 27 October 2026, noon: the window of quarter 2 is opened. */
const OCT27 = '2026-10-27T12:00:00+05:00';
/** Monday 2 November 2026, noon: inside the window (28 October to 10 November). */
const NOV02 = '2026-11-02T12:00:00+05:00';
/** Thursday 26 November 2026, noon: after the window; the Mondays 9, 16 and 23 November are held. */
const THURSDAY = '2026-11-26T12:00:00+05:00';

const WINDOW = { startDate: '2026-10-28', endDate: '2026-11-10', confirm: true };

const VALID_FROM = new Date('2026-09-01T00:00:00+05:00');

const ok = (response: Response, status = 200) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response;
};

const codeOf = (response: Response) => apiErrorSchema.parse(response.body).error.code;

const values = (topic: string, change: Record<string, unknown> = {}) => ({
  topic,
  objectives: '',
  links: [],
  classworks: [],
  homeworks: [],
  ...change,
});

describe('master plans', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true, photoStore: new MemoryPhotoStore() });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Gulnora', `Yusupova${'a'.repeat(names % 7)}`);
  };

  type Browser = Awaited<ReturnType<typeof account>>;

  const freshAt = (moment: string) =>
    t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
      .execute();

  async function at<T>(moment: string, work: () => Promise<T>) {
    t.clock.set(moment);
    await freshAt(moment);
    try {
      return await work();
    } finally {
      t.clock.set(START);
      await freshAt(START);
    }
  }

  const send = (
    method: 'get' | 'post' | 'put' | 'patch',
    path: string,
    branch: string,
    cookie: string,
    body?: object,
  ) => {
    const call = request(t.kit.server)
      [method](path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch);
    return body === undefined ? call : call.send(body);
  };

  /**
   * A graded scene of grade 7 (the subject taught in grades 7 and 8): the owner
   * of the first class's plan and a spare teacher of the subject, the Head
   * Teacher (unless `noHead`), the Senior Head Teacher and the Academic Vice
   * Principal of the subject; the window of quarter 2 opened.
   */
  async function scene(
    input: {
      noHead?: boolean;
      shared?: boolean;
      branch?: string;
      subject?: string;
      /** The subject's Senior Head Teacher is of another scene (one per subject). */
      noSenior?: boolean;
    } = {},
  ) {
    const owner = await account();
    const spare = await account();
    const head = await account();
    const senior = await account();
    const vice = await account();
    const subject =
      input.subject ?? (await load.classes.subject({ grades: [7, 8], journalType: 'graded' }));
    const s = await publishedScene(t, load, {
      graded: true,
      subject,
      ...(input.branch === undefined ? {} : { branch: input.branch }),
      ...(input.shared === true ? { shared: true } : {}),
      accounts: { teacher: owner.account.id, spare: spare.account.id },
    });
    for (const browser of [owner, spare]) {
      await t.kit.giveRole(browser.account.id, {
        role: 'teacher',
        branchId: s.branch,
        validFrom: VALID_FROM,
      });
    }
    const headRole =
      input.noHead === true
        ? null
        : await t.kit.giveRole(head.account.id, {
            role: 'head_teacher',
            branchId: s.branch,
            subjectIds: [s.subject],
            validFrom: VALID_FROM,
          });
    const seniorRole =
      input.noSenior === true
        ? null
        : await t.kit.giveRole(senior.account.id, {
            role: 'senior_head_teacher',
            subjectIds: [s.subject],
            validFrom: VALID_FROM,
          });
    const viceRole = await t.kit.giveRole(vice.account.id, {
      role: 'academic_vice_principal',
      branchId: s.branch,
      validFrom: VALID_FROM,
    });
    const journalOf = async (classId: string) =>
      (
        await t.database.migrator
          .selectFrom('journals')
          .select('id')
          .where('class_id', '=', classId)
          .executeTakeFirstOrThrow()
      ).id;
    const quarters = await t.database.migrator
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', s.year)
      .orderBy('number')
      .execute();
    const x = {
      s,
      owner,
      spare,
      head,
      headRole: headRole?.id ?? null,
      senior,
      seniorRole: seniorRole?.id ?? null,
      vice,
      viceRole: viceRole.id,
      journal: await journalOf(s.classId),
      otherJournal: await journalOf(s.otherClass),
      q2: quarters[1]?.id ?? '',
      q3: quarters[2]?.id ?? '',
    };
    ok(
      await at(OCT27, async () =>
        send('put', `/api/plans/windows/${x.q2}`, s.branch, vice.cookie, WINDOW),
      ),
    );
    return x;
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  const masterOf = (response: Response, status = 200): PlanMaster =>
    planMasterSchema.parse(ok(response, status).body);

  const createMaster = (
    x: Scene,
    browser: Browser,
    change: Record<string, unknown> = {},
    moment = NOV02,
  ) =>
    at(moment, async () =>
      send('post', '/api/plans/masters', x.s.branch, browser.cookie, {
        yearId: x.s.year,
        quarter: 2,
        subjectId: x.s.subject,
        grade: 7,
        language: 'uz',
        name: 'Core',
        scope: 'branch',
        ...change,
      }),
    );

  /** A master of the Head Teacher with items "M1".."Mn". */
  async function masterWith(
    x: Scene,
    count: number,
    browser: Browser = x.head,
    change: Record<string, unknown> = {},
  ): Promise<PlanMaster> {
    let master = masterOf(await createMaster(x, browser, change), 201);
    for (let index = 1; index <= count; index += 1) {
      master = masterOf(
        await at(NOV02, async () =>
          send('post', `/api/plans/masters/${master.id}/items`, x.s.branch, browser.cookie, {
            revision: master.revision,
            position: index,
            values: values(`M${String(index)}`, {
              classworks: [{ title: `Quiz ${String(index)}`, description: '' }],
            }),
          }),
        ),
      );
    }
    return master;
  }

  const masterItem = (master: PlanMaster, position: number) => {
    const found = master.masterItems[position - 1];
    if (found === undefined) throw new Error('no master item');
    return found;
  };

  const planOf = (x: Scene, moment: string, browser: Browser = x.owner, journal = x.journal) =>
    at(moment, async () =>
      planSchema.parse(
        ok(
          await send(
            'get',
            `/api/plans/journals/${journal}?quarterId=${x.q2}`,
            x.s.branch,
            browser.cookie,
          ),
        ).body,
      ),
    );

  const copyMaster = (x: Scene, masterId: string, moment = NOV02, journal = x.journal) =>
    at(moment, async () =>
      send('post', `/api/plans/journals/${journal}/copy`, x.s.branch, x.owner.cookie, {
        quarterId: x.q2,
        source: { masterId },
      }),
    );

  const saveMasterItem = (
    x: Scene,
    master: PlanMaster,
    position: number,
    topic: string,
    browser: Browser = x.head,
  ) =>
    at(NOV02, async () =>
      send(
        'put',
        `/api/plans/masters/${master.id}/items/${masterItem(master, position).id}`,
        x.s.branch,
        browser.cookie,
        {
          revision: master.revision,
          values: values(topic, {
            classworks: masterItem(master, position).classworks.map((work) => ({
              title: work.title,
              description: work.description,
            })),
          }),
        },
      ),
    );

  const topics = (plan: Plan) => plan.rows.map((row) => row.item?.topic ?? null);

  const entries = async (action: string, id: string) =>
    (
      await t.database.migrator
        .selectFrom('audit_log')
        .select([
          'record_id',
          'actor_id',
          'assignment_id',
          'request_id',
          'old_value',
          'new_value',
          'details',
        ])
        .where('action', '=', action)
        .orderBy('id')
        .execute()
    ).filter((entry) => JSON.stringify(entry).includes(id));

  /** Every row of the tables the routes of 7.3 write, in one branch (and the masters of all branches). */
  const rowsOf = async (branch: string) => {
    const found: Record<string, unknown[]> = {};
    for (const table of [
      'lesson_plans',
      'lesson_plan_items',
      'lesson_plan_works',
      'lesson_plan_places',
    ] as const) {
      found[table] = await t.database.migrator
        .selectFrom(table)
        .selectAll()
        .where('branch_id', '=', branch)
        .execute()
        .then((rows) => rows.map((row) => JSON.stringify(row)).sort());
    }
    for (const table of [
      'lesson_plan_masters',
      'lesson_plan_master_items',
      'lesson_plan_master_works',
    ] as const) {
      found[table] = await t.database.migrator
        .selectFrom(table)
        .selectAll()
        .where((builder) =>
          builder.or([builder('branch_id', '=', branch), builder('branch_id', 'is', null)]),
        )
        .execute()
        .then((rows) => rows.map((row) => JSON.stringify(row)).sort());
    }
    found.audit = (
      await t.database.migrator
        .selectFrom('audit_log')
        .select('id')
        .where('branch_id', '=', branch)
        .execute()
    ).map((row) => row.id);
    return found;
  };

  describe('keeping a master', () => {
    it('lets the Head Teacher keep a master of the subject and audits each change with its assignment (09, Master plans)', async () => {
      const x = await scene();
      const master = await masterWith(x, 3);
      expect(master).toEqual(
        expect.objectContaining({
          scope: 'branch',
          grade: 7,
          language: 'uz',
          startYear: 2026,
          quarter: 2,
          name: 'Core',
          items: 3,
          archived: false,
          canEdit: true,
        }),
      );
      expect(master.masterItems.map((item) => [item.position, item.topic])).toEqual([
        [1, 'M1'],
        [2, 'M2'],
        [3, 'M3'],
      ]);
      expect(master.masterItems[0]?.classworks.map((work) => work.title)).toEqual(['Quiz 1']);
      const [created] = await entries('plan_master.create', master.id);
      expect(created).toEqual(
        expect.objectContaining({ actor_id: x.head.account.id, assignment_id: x.headRole }),
      );
      expect(created?.request_id).not.toBeNull();
      expect(await entries('plan_master.item_create', master.id)).toHaveLength(3);

      // Moved, renamed, an item saved and one removed: the order closes up.
      const moved = masterOf(
        await at(NOV02, async () =>
          send('put', `/api/plans/masters/${master.id}/order`, x.s.branch, x.head.cookie, {
            revision: master.revision,
            order: [masterItem(master, 3).id, masterItem(master, 1).id, masterItem(master, 2).id],
          }),
        ),
      );
      expect(moved.masterItems.map((item) => item.topic)).toEqual(['M3', 'M1', 'M2']);
      const renamed = masterOf(
        await at(NOV02, async () =>
          send('patch', `/api/plans/masters/${master.id}`, x.s.branch, x.head.cookie, {
            revision: moved.revision,
            name: 'Core, level A',
          }),
        ),
      );
      expect(renamed.name).toBe('Core, level A');
      const saved = masterOf(await saveMasterItem(x, renamed, 2, 'M1, fractions'));
      expect(saved.masterItems.map((item) => item.topic)).toEqual(['M3', 'M1, fractions', 'M2']);
      const removed = masterOf(
        await at(NOV02, async () =>
          send(
            'post',
            `/api/plans/masters/${master.id}/items/${masterItem(saved, 1).id}/remove`,
            x.s.branch,
            x.head.cookie,
            { revision: saved.revision },
          ),
        ),
      );
      expect(removed.masterItems.map((item) => [item.position, item.topic])).toEqual([
        [1, 'M1, fractions'],
        [2, 'M2'],
      ]);
      // The removed item is kept (decision 8).
      const kept = await t.database.migrator
        .selectFrom('lesson_plan_master_items')
        .select(['topic', 'removed_revision'])
        .where('master_id', '=', master.id)
        .where('removed_revision', 'is not', null)
        .execute();
      expect(kept).toEqual([{ topic: 'M3', removed_revision: removed.revision }]);
      const [edit] = await entries('plan_master.item_edit', master.id);
      expect(edit?.old_value).toEqual(expect.objectContaining({ topic: 'M1' }));
      expect(edit?.new_value).toEqual(expect.objectContaining({ topic: 'M1, fractions' }));
      for (const action of ['plan_master.order', 'plan_master.rename', 'plan_master.item_remove']) {
        expect((await entries(action, master.id))[0]?.assignment_id).toBe(x.headRole);
      }
    });

    it('lets every reader of plans read the masters, and a teacher only those of the subject and grade in the profile', async () => {
      const x = await scene();
      const master = await masterWith(x, 1);
      const principal = await account();
      await t.kit.giveRole(principal.account.id, {
        role: 'principal',
        branchId: x.s.branch,
        validFrom: VALID_FROM,
      });
      const listOf = async (browser: Browser) =>
        planMastersSchema.parse(
          ok(
            await at(NOV02, async () =>
              send('get', `/api/plans/masters?yearId=${x.s.year}`, x.s.branch, browser.cookie),
            ),
          ).body,
        );
      for (const browser of [x.spare, x.owner, x.vice, x.senior, principal]) {
        const list = await listOf(browser);
        expect(list.masters.map((one) => one.id)).toEqual([master.id]);
        expect(list.masters[0]?.canEdit).toBe(browser === x.senior);
      }
      expect((await listOf(principal)).keeps).toEqual([]);
      const keepsOf = async (browser: Browser) =>
        (await listOf(browser)).keeps.find((one) => one.subject.id === x.s.subject)?.scopes ?? [];
      expect(await keepsOf(x.head)).toEqual(['branch']);
      expect(await keepsOf(x.senior)).toEqual(['branch', 'all']);
      // The Academic Vice Principal does not keep it while the subject has a Head Teacher.
      expect(await keepsOf(x.vice)).toEqual([]);

      // A teacher with another subject only reads nothing of it.
      const other = await account();
      const otherSubject = await load.classes.subject({ grades: [7] });
      await load.teacher(x.s.branch, {
        subjects: [{ subject: otherSubject, grades: [7] }],
        accountId: other.account.id,
      });
      await t.kit.giveRole(other.account.id, {
        role: 'teacher',
        branchId: x.s.branch,
        validFrom: VALID_FROM,
      });
      expect((await listOf(other)).masters).toEqual([]);
      expect(
        codeOf(
          await at(NOV02, async () =>
            send('get', `/api/plans/masters/${master.id}`, x.s.branch, other.cookie),
          ),
        ),
      ).toBe('plan_scope');
      expect(
        masterOf(
          await at(NOV02, async () =>
            send('get', `/api/plans/masters/${master.id}`, x.s.branch, x.spare.cookie),
          ),
        ).id,
      ).toBe(master.id);
    });

    it('refuses the writes of a master to every role but its keepers, and changes nothing', async () => {
      const x = await scene();
      const master = await masterWith(x, 2);
      const principal = await account();
      await t.kit.giveRole(principal.account.id, {
        role: 'principal',
        branchId: x.s.branch,
        validFrom: VALID_FROM,
      });
      // A Head Teacher of another subject does not read it (permission review, should-fix 6).
      const otherHead = await account();
      await t.kit.giveRole(otherHead.account.id, {
        role: 'head_teacher',
        branchId: x.s.branch,
        subjectIds: [await load.classes.subject({ grades: [7] })],
        validFrom: VALID_FROM,
      });
      const before = await rowsOf(x.s.branch);
      const writes = (browser: Browser) => [
        () =>
          send('patch', `/api/plans/masters/${master.id}`, x.s.branch, browser.cookie, {
            revision: master.revision,
            name: 'Other',
          }),
        () =>
          send('post', `/api/plans/masters/${master.id}/archive`, x.s.branch, browser.cookie, {
            revision: master.revision,
          }),
        () =>
          send('post', `/api/plans/masters/${master.id}/restore`, x.s.branch, browser.cookie, {
            revision: master.revision,
          }),
        () =>
          send('post', `/api/plans/masters/${master.id}/items`, x.s.branch, browser.cookie, {
            revision: master.revision,
            position: 1,
            values: values('New'),
          }),
        () =>
          send(
            'put',
            `/api/plans/masters/${master.id}/items/${masterItem(master, 1).id}`,
            x.s.branch,
            browser.cookie,
            { revision: master.revision, values: values('Changed') },
          ),
        () =>
          send(
            'post',
            `/api/plans/masters/${master.id}/items/${masterItem(master, 1).id}/remove`,
            x.s.branch,
            browser.cookie,
            { revision: master.revision },
          ),
        () =>
          send('put', `/api/plans/masters/${master.id}/order`, x.s.branch, browser.cookie, {
            revision: master.revision,
            order: [masterItem(master, 2).id, masterItem(master, 1).id],
          }),
      ];
      // The guard refuses the Principal and a Teacher (no `edit` in the area).
      for (const browser of [principal, x.owner]) {
        for (const write of writes(browser)) {
          expect((await at(NOV02, write)).status).toBe(403);
        }
      }
      // The Academic Vice Principal does not keep it while the subject has a Head Teacher.
      for (const write of writes(x.vice)) {
        expect(codeOf(await at(NOV02, write))).toBe('plan_master_scope');
      }
      for (const write of writes(otherHead)) {
        expect(codeOf(await at(NOV02, write))).toBe('plan_scope');
      }
      expect(codeOf(await createMaster(x, otherHead, { name: 'By another head' }))).toBe(
        'plan_master_scope',
      );
      expect(codeOf(await createMaster(x, x.vice, { name: 'By the vice' }))).toBe(
        'plan_master_scope',
      );
      expect(codeOf(await createMaster(x, x.head, { name: 'For all', scope: 'all' }))).toBe(
        'plan_master_scope',
      );
      expect(await rowsOf(x.s.branch)).toEqual(before);
    });

    it('lets the Academic Vice Principal keep the masters of a subject with no Head Teacher in the branch', async () => {
      const x = await scene({ noHead: true });
      const master = await masterWith(x, 1, x.vice);
      expect(master.canEdit).toBe(true);
      expect((await entries('plan_master.create', master.id))[0]?.assignment_id).toBe(x.viceRole);
      // The Senior Head Teacher keeps it too ("Everything a Head Teacher can do").
      const saved = masterOf(await saveMasterItem(x, master, 1, 'By the senior', x.senior));
      expect(saved.masterItems[0]?.topic).toBe('By the senior');
      expect((await entries('plan_master.item_edit', master.id))[0]?.assignment_id).toBe(
        x.seniorRole,
      );
    });

    it('keeps the master with the post: a new Head Teacher keeps the earlier one’s master (decision 3)', async () => {
      const x = await scene();
      const master = await masterWith(x, 1);
      // The appointment of the first Head Teacher ends; another is appointed.
      await t.database.migrator
        .updateTable('assignments')
        .set({ valid_until: new Date('2026-10-30T00:00:00+05:00') })
        .where('id', '=', x.headRole ?? '')
        .execute();
      const next = await account();
      await t.kit.giveRole(next.account.id, {
        role: 'head_teacher',
        branchId: x.s.branch,
        subjectIds: [x.s.subject],
        validFrom: new Date('2026-10-30T00:00:00+05:00'),
      });
      expect((await saveMasterItem(x, master, 1, 'By the earlier one')).status).toBe(403);
      const saved = masterOf(await saveMasterItem(x, master, 1, 'By the new one', next));
      expect(saved.masterItems[0]?.topic).toBe('By the new one');
    });

    it('refuses a write made on an older revision, and a change of an archived master; a restore under a taken name is refused on the name', async () => {
      const x = await scene();
      const master = await masterWith(x, 2);
      ok(await saveMasterItem(x, master, 1, 'First change'));
      // The same revision a second time: the page is stale (decision 9).
      expect(codeOf(await saveMasterItem(x, master, 2, 'Second change'))).toBe('plan_master_stale');
      const now = masterOf(
        await at(NOV02, async () =>
          send('get', `/api/plans/masters/${master.id}`, x.s.branch, x.head.cookie),
        ),
      );
      const archived = masterOf(
        await at(NOV02, async () =>
          send('post', `/api/plans/masters/${master.id}/archive`, x.s.branch, x.head.cookie, {
            revision: now.revision,
          }),
        ),
      );
      expect(archived.archived).toBe(true);
      expect(codeOf(await saveMasterItem(x, archived, 1, 'Late'))).toBe('plan_master_archived');
      // Another master takes the name meanwhile.
      ok(await createMaster(x, x.head), 201);
      const restore = await at(NOV02, async () =>
        send('post', `/api/plans/masters/${master.id}/restore`, x.s.branch, x.head.cookie, {
          revision: archived.revision,
        }),
      );
      expect(restore.status).toBe(409);
      expect(apiErrorSchema.parse(restore.body).error).toEqual(
        expect.objectContaining({ code: 'already_exists' }),
      );
      expect(apiErrorSchema.parse(restore.body).error.details?.[0]?.path).toBe('name');
    });
  });

  describe('a master of all branches', () => {
    it('is kept by the Senior Head Teacher, read and copied in every branch, and refused to the others who keep branch masters', async () => {
      const x = await scene();
      const all = await masterWith(x, 2, x.senior, { scope: 'all', name: 'School' });
      expect(all.scope).toBe('all');
      const stored = await t.database.migrator
        .selectFrom('lesson_plan_masters')
        .select('branch_id')
        .where('id', '=', all.id)
        .executeTakeFirstOrThrow();
      expect(stored.branch_id).toBeNull();
      // A second branch of the same school year and subject reads it and copies it
      // (permission review, must-fix 5).
      const y = await scene({ subject: x.s.subject, noSenior: true });
      expect(
        masterOf(
          await at(NOV02, async () =>
            send('get', `/api/plans/masters/${all.id}`, y.s.branch, y.owner.cookie),
          ),
        ).scope,
      ).toBe('all');
      const listed = planMastersSchema.parse(
        ok(
          await at(NOV02, async () =>
            send(
              'get',
              `/api/plans/masters?journalId=${y.journal}&quarterId=${y.q2}`,
              y.s.branch,
              y.owner.cookie,
            ),
          ),
        ).body,
      );
      expect(listed.masters.map((one) => one.id)).toContain(all.id);
      const inY = planSchema.parse(ok(await copyMaster(y, all.id)).body);
      expect(topics(inY).slice(0, 3)).toEqual(['M1', 'M2', null]);
      expect(inY.master?.scope).toBe('all');
      // In x's branch, the owner copies it.
      const copied = planSchema.parse(ok(await copyMaster(x, all.id)).body);
      expect(topics(copied).slice(0, 3)).toEqual(['M1', 'M2', null]);
      expect(copied.master).toEqual({ id: all.id, name: 'School', scope: 'all', updated: false });

      // The Head Teacher, the Academic Vice Principal and a Senior Head Teacher of
      // another subject are refused every write of it (spec review of the plan, must-fix 3).
      const otherSenior = await account();
      await t.kit.giveRole(otherSenior.account.id, {
        role: 'senior_head_teacher',
        subjectIds: [await load.classes.subject({ grades: [7] })],
        validFrom: VALID_FROM,
      });
      const before = await rowsOf(x.s.branch);
      for (const browser of [x.head, x.vice, otherSenior]) {
        const calls = [
          () =>
            send('patch', `/api/plans/masters/${all.id}`, x.s.branch, browser.cookie, {
              revision: all.revision,
              name: 'Other',
            }),
          () =>
            send('post', `/api/plans/masters/${all.id}/archive`, x.s.branch, browser.cookie, {
              revision: all.revision,
            }),
          () =>
            send('post', `/api/plans/masters/${all.id}/restore`, x.s.branch, browser.cookie, {
              revision: all.revision,
            }),
          () =>
            send('post', `/api/plans/masters/${all.id}/items`, x.s.branch, browser.cookie, {
              revision: all.revision,
              position: 1,
              values: values('New'),
            }),
          () =>
            send(
              'put',
              `/api/plans/masters/${all.id}/items/${masterItem(all, 1).id}`,
              x.s.branch,
              browser.cookie,
              { revision: all.revision, values: values('Changed') },
            ),
          () =>
            send(
              'post',
              `/api/plans/masters/${all.id}/items/${masterItem(all, 1).id}/remove`,
              x.s.branch,
              browser.cookie,
              { revision: all.revision },
            ),
          () =>
            send('put', `/api/plans/masters/${all.id}/order`, x.s.branch, browser.cookie, {
              revision: all.revision,
              order: [masterItem(all, 2).id, masterItem(all, 1).id],
            }),
        ];
        for (const call of calls) {
          const answer = await at(NOV02, call);
          expect(answer.status, `${browser.account.id} ${JSON.stringify(answer.body)}`).toBe(403);
          // The Head Teacher and the vice read it and do not keep it; the other senior does not read it.
          expect(codeOf(answer)).toBe(browser === otherSenior ? 'plan_scope' : 'plan_master_scope');
        }
      }
      expect(await rowsOf(x.s.branch)).toEqual(before);
    });
  });

  describe('ids of another branch', () => {
    it('answers 404 for a master, an item, a body id or a quarter of another branch or unknown, and changes nothing', async () => {
      const x = await scene();
      const y = await scene();
      const mine = await masterWith(x, 2);
      const theirs = await masterWith(y, 1);
      const second = await masterWith(x, 1, x.head, { name: 'Second' });
      const beforeX = await rowsOf(x.s.branch);
      const beforeY = await rowsOf(y.s.branch);
      for (const masterId of [theirs.id, randomUUID()]) {
        for (const call of [
          () => send('get', `/api/plans/masters/${masterId}`, x.s.branch, x.head.cookie),
          () =>
            send('patch', `/api/plans/masters/${masterId}`, x.s.branch, x.head.cookie, {
              revision: 1,
              name: 'Other',
            }),
          () =>
            send('post', `/api/plans/masters/${masterId}/archive`, x.s.branch, x.head.cookie, {
              revision: 1,
            }),
          () =>
            send('post', `/api/plans/masters/${masterId}/restore`, x.s.branch, x.head.cookie, {
              revision: 1,
            }),
          () =>
            send('post', `/api/plans/masters/${masterId}/items`, x.s.branch, x.head.cookie, {
              revision: 1,
              position: 1,
              values: values('New'),
            }),
          () =>
            send('put', `/api/plans/masters/${masterId}/order`, x.s.branch, x.head.cookie, {
              revision: 1,
              order: [],
            }),
          () => copyMaster(x, masterId),
        ]) {
          expect((await at(NOV02, call)).status).toBe(404);
        }
      }
      // An item of another master, of another branch, or unknown, under the path's master.
      for (const itemId of [masterItem(second, 1).id, masterItem(theirs, 1).id, randomUUID()]) {
        for (const call of [
          () =>
            send(
              'put',
              `/api/plans/masters/${mine.id}/items/${itemId}`,
              x.s.branch,
              x.head.cookie,
              { revision: mine.revision, values: values('Changed') },
            ),
          () =>
            send(
              'post',
              `/api/plans/masters/${mine.id}/items/${itemId}/remove`,
              x.s.branch,
              x.head.cookie,
              { revision: mine.revision },
            ),
          () =>
            send('put', `/api/plans/masters/${mine.id}/order`, x.s.branch, x.head.cookie, {
              revision: mine.revision,
              order: [masterItem(mine, 1).id, itemId],
            }),
        ]) {
          expect((await at(NOV02, call)).status).toBe(404);
        }
      }
      // A quarter of another branch, or unknown.
      for (const quarterId of [y.q2, randomUUID()]) {
        expect(
          (
            await at(NOV02, async () =>
              send(
                'get',
                `/api/plans/journals/${x.journal}/master-compare?quarterId=${quarterId}`,
                x.s.branch,
                x.owner.cookie,
              ),
            )
          ).status,
        ).toBe(404);
        expect(
          (
            await at(NOV02, async () =>
              send(
                'get',
                `/api/plans/parallel?subjectId=${x.s.subject}&grade=7&quarterId=${quarterId}`,
                x.s.branch,
                x.head.cookie,
              ),
            )
          ).status,
        ).toBe(404);
        for (const path of ['master-take', 'master-keep']) {
          expect(
            (
              await at(NOV02, async () =>
                send(
                  'post',
                  `/api/plans/journals/${x.journal}/${path}`,
                  x.s.branch,
                  x.owner.cookie,
                  {
                    quarterId,
                    revision: 0,
                  },
                ),
              )
            ).status,
          ).toBe(404);
        }
      }
      // A journal of another branch, or unknown, in the path (permission review, must-fix 1).
      for (const journalId of [y.journal, randomUUID()]) {
        expect(
          (
            await at(NOV02, async () =>
              send(
                'get',
                `/api/plans/journals/${journalId}/master-compare?quarterId=${x.q2}`,
                x.s.branch,
                x.owner.cookie,
              ),
            )
          ).status,
        ).toBe(404);
        for (const path of ['master-take', 'master-keep']) {
          expect(
            (
              await at(NOV02, async () =>
                send(
                  'post',
                  `/api/plans/journals/${journalId}/${path}`,
                  x.s.branch,
                  x.owner.cookie,
                  {
                    quarterId: x.q2,
                    revision: 0,
                  },
                ),
              )
            ).status,
          ).toBe(404);
        }
        expect(
          (
            await at(NOV02, async () =>
              send(
                'get',
                `/api/plans/masters?journalId=${journalId}&quarterId=${x.q2}`,
                x.s.branch,
                x.owner.cookie,
              ),
            )
          ).status,
        ).toBe(404);
      }
      // A year of another branch, or unknown, and an unknown subject in a body or a query
      // (permission review, must-fix 2 and should-fix 8).
      for (const yearId of [y.s.year, randomUUID()]) {
        expect((await createMaster(x, x.head, { yearId, name: 'Elsewhere' })).status).toBe(404);
        expect(
          (
            await at(NOV02, async () =>
              send('get', `/api/plans/masters?yearId=${yearId}`, x.s.branch, x.head.cookie),
            )
          ).status,
        ).toBe(404);
      }
      expect(
        (await createMaster(x, x.head, { subjectId: randomUUID(), name: 'Unknown' })).status,
      ).toBe(404);
      expect(
        (
          await at(NOV02, async () =>
            send(
              'get',
              `/api/plans/parallel?subjectId=${randomUUID()}&grade=7&quarterId=${x.q2}`,
              x.s.branch,
              x.head.cookie,
            ),
          )
        ).status,
      ).toBe(404);
      // The list of branch x leaves out branch y's master.
      const listed = planMastersSchema.parse(
        ok(
          await at(NOV02, async () =>
            send('get', `/api/plans/masters?yearId=${x.s.year}`, x.s.branch, x.head.cookie),
          ),
        ).body,
      );
      expect(listed.masters.map((one) => one.id)).not.toContain(theirs.id);
      expect(await rowsOf(x.s.branch)).toEqual(beforeX);
      expect(await rowsOf(y.s.branch)).toEqual(beforeY);
    });
  });

  describe('the scope of the master of a plan and of the parallel classes', () => {
    it('refuses take and keep to anyone but the owner, the comparison and the parallel classes to another subject, and the list shows another subject nothing (permission review, must-fixes 3 and 4)', async () => {
      const x = await scene();
      const master = await masterWith(x, 2);
      ok(await copyMaster(x, master.id));
      const changed = masterOf(await saveMasterItem(x, master, 1, 'M1 changed'));
      const otherSubject = await load.classes.subject({ grades: [7] });
      const otherHead = await account();
      await t.kit.giveRole(otherHead.account.id, {
        role: 'head_teacher',
        branchId: x.s.branch,
        subjectIds: [otherSubject],
        validFrom: VALID_FROM,
      });
      const otherTeacher = await account();
      await load.teacher(x.s.branch, {
        subjects: [{ subject: otherSubject, grades: [7] }],
        accountId: otherTeacher.account.id,
      });
      await t.kit.giveRole(otherTeacher.account.id, {
        role: 'teacher',
        branchId: x.s.branch,
        validFrom: VALID_FROM,
      });
      const before = await rowsOf(x.s.branch);
      for (const path of ['master-take', 'master-keep']) {
        const call = (browser: Browser) =>
          at(NOV02, async () =>
            send('post', `/api/plans/journals/${x.journal}/${path}`, x.s.branch, browser.cookie, {
              quarterId: x.q2,
              revision: changed.revision,
            }),
          );
        // The spare teacher reads the plan by the profile and does not own it.
        expect(codeOf(await call(x.spare))).toBe('plan_scope');
        // The Head Teacher has no `plans` edit: the guard refuses.
        expect((await call(x.head)).status).toBe(403);
      }
      // A stale revision is refused on keep too.
      expect(
        codeOf(
          await at(NOV02, async () =>
            send(
              'post',
              `/api/plans/journals/${x.journal}/master-keep`,
              x.s.branch,
              x.owner.cookie,
              {
                quarterId: x.q2,
                revision: changed.revision - 1,
              },
            ),
          ),
        ),
      ).toBe('plan_master_stale');
      expect(await rowsOf(x.s.branch)).toEqual(before);
      for (const browser of [otherHead, otherTeacher]) {
        expect(
          codeOf(
            await at(NOV02, async () =>
              send(
                'get',
                `/api/plans/journals/${x.journal}/master-compare?quarterId=${x.q2}`,
                x.s.branch,
                browser.cookie,
              ),
            ),
          ),
        ).toBe('plan_scope');
        const list = planMastersSchema.parse(
          ok(
            await at(NOV02, async () =>
              send('get', `/api/plans/masters?yearId=${x.s.year}`, x.s.branch, browser.cookie),
            ),
          ).body,
        );
        expect(list.masters).toEqual([]);
      }
      expect(
        codeOf(
          await at(NOV02, async () =>
            send(
              'get',
              `/api/plans/parallel?subjectId=${x.s.subject}&grade=7&quarterId=${x.q2}`,
              x.s.branch,
              otherHead.cookie,
            ),
          ),
        ),
      ).toBe('plan_scope');
    });
  });

  describe('a copy of a master', () => {
    it('fills the rows in order, leaves the last rows empty, and is independent of its master (done when)', async () => {
      const x = await scene();
      const master = await masterWith(x, 5);
      const copied = planSchema.parse(ok(await copyMaster(x, master.id)).body);
      expect(topics(copied)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', null, null, null]);
      expect(copied.rows[0]?.item?.classworks.map((work) => work.title)).toEqual(['Quiz 1']);
      expect(copied.master).toEqual(
        expect.objectContaining({ id: master.id, scope: 'branch', updated: false }),
      );
      const [entry] = await entries('plan.copied', master.id);
      expect(entry?.new_value).toEqual(
        expect.objectContaining({ sourceMasterId: master.id, items: 5 }),
      );
      // Changing the master changes no item of the plan.
      ok(await saveMasterItem(x, master, 1, 'M1 changed'));
      const after = await planOf(x, NOV02);
      expect(topics(after).slice(0, 2)).toEqual(['M1', 'M2']);
      // Changing the plan changes no item of the master.
      const item = after.rows[1]?.item;
      if (item === undefined || item === null) throw new Error('no item');
      ok(
        await at(NOV02, async () =>
          send('put', `/api/plans/items/${item.id}`, x.s.branch, x.owner.cookie, {
            base: {
              topic: item.topic,
              objectives: item.objectives,
              links: item.links,
              classworks: item.classworks,
              homeworks: item.homeworks,
            },
            values: values('Mine'),
          }),
        ),
      );
      const masterNow = masterOf(
        await at(NOV02, async () =>
          send('get', `/api/plans/masters/${master.id}`, x.s.branch, x.head.cookie),
        ),
      );
      expect(masterNow.masterItems.map((one) => one.topic)).toEqual([
        'M1 changed',
        'M2',
        'M3',
        'M4',
        'M5',
      ]);
      // An archived master leaves the plan readable, with its link.
      ok(
        await at(NOV02, async () =>
          send('post', `/api/plans/masters/${master.id}/archive`, x.s.branch, x.head.cookie, {
            revision: masterNow.revision,
          }),
        ),
      );
      const archivedPlan = await planOf(x, NOV02);
      expect(archivedPlan.master?.id).toBe(master.id);
    });

    it('lists the items left over as not covered when the master has more items than the class has lessons', async () => {
      const x = await scene();
      const master = await masterWith(x, 10);
      const copied = planSchema.parse(ok(await copyMaster(x, master.id)).body);
      expect(topics(copied)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']);
      expect(copied.notCovered.map((item) => item.topic)).toEqual(['M9', 'M10']);
    });

    it('refuses a master that does not fit the plan: the scope first, then subject, grade, language, quarter, and an archived one', async () => {
      const x = await scene();
      // A master of another subject, kept by the Super Admin: the owner does not read it.
      const otherSubject = await load.classes.subject({ grades: [7] });
      const foreign = masterOf(
        await createMaster(x, { cookie: t.admin, account: { id: '' } } as unknown as Browser, {
          subjectId: otherSubject,
          name: 'Foreign',
        }),
        201,
      );
      expect(codeOf(await copyMaster(x, foreign.id))).toBe('plan_scope');
      const grade8 = masterOf(await createMaster(x, x.head, { grade: 8, name: 'Grade 8' }), 201);
      expect(codeOf(await copyMaster(x, grade8.id))).toBe('plan_scope');
      // The spare teacher has grade 7 only: read by the profile, the head reads all.
      const russian = masterOf(await createMaster(x, x.head, { language: 'ru', name: 'Ru' }), 201);
      expect(codeOf(await copyMaster(x, russian.id))).toBe('plan_copy_language');
      const third = masterOf(await createMaster(x, x.head, { quarter: 3, name: 'Q3' }), 201);
      expect(codeOf(await copyMaster(x, third.id))).toBe('plan_copy_quarter');
      const archived = masterOf(await createMaster(x, x.head, { name: 'Old' }), 201);
      ok(
        await at(NOV02, async () =>
          send('post', `/api/plans/masters/${archived.id}/archive`, x.s.branch, x.head.cookie, {
            revision: archived.revision,
          }),
        ),
      );
      expect(codeOf(await copyMaster(x, archived.id))).toBe('plan_master_archived');
      // Grade: the owner reads a grade 8 master through the profile once it has grade 8.
      await t.database.migrator
        .updateTable('staff_subjects')
        .set({ grades: [7, 8] })
        .where('staff_id', '=', x.s.teacher.staffId)
        .where('subject_id', '=', x.s.subject)
        .execute();
      expect(codeOf(await copyMaster(x, grade8.id))).toBe('plan_copy_grade');
    });

    it('is refused after the window with no approved request (09, The plan window)', async () => {
      const x = await scene();
      const master = await masterWith(x, 2);
      const before = await rowsOf(x.s.branch);
      expect(codeOf(await copyMaster(x, master.id, THURSDAY))).toBe('plan_window_closed');
      expect(await rowsOf(x.s.branch)).toEqual(before);
    });

    it('carries the master link into a copy of the plan of the same grade and language, and through a separation (decision 11)', async () => {
      const masterItemsOfJournal = async (journal: string) =>
        (
          await t.database.migrator
            .selectFrom('lesson_plan_items')
            .innerJoin(
              'lesson_plan_journals',
              'lesson_plan_journals.plan_id',
              'lesson_plan_items.plan_id',
            )
            .select('lesson_plan_items.master_item_id')
            .where('lesson_plan_journals.journal_id', '=', journal)
            .where('lesson_plan_journals.quarter_id', '=', x.q2)
            .where('lesson_plan_items.cleared_at', 'is', null)
            .execute()
        )
          .map((item) => item.master_item_id)
          .sort();
      // The owner teaches both classes (task 7.1c, `shared`).
      const x = await scene({ shared: true });
      const master = await masterWith(x, 3);
      const ids = master.masterItems.map((item) => item.id).sort();
      ok(await copyMaster(x, master.id));
      const copied = await at(NOV02, async () =>
        send('post', `/api/plans/journals/${x.otherJournal}/copy`, x.s.branch, x.owner.cookie, {
          quarterId: x.q2,
          source: { journalId: x.journal, quarterId: x.q2 },
          part: 'all',
        }),
      );
      expect(planSchema.parse(ok(copied).body).master?.id).toBe(master.id);
      expect(await masterItemsOfJournal(x.otherJournal)).toEqual(ids);

      // A shared plan separated keeps the link and the master items.
      const y = await scene({ shared: true });
      const yMaster = await masterWith(y, 2);
      ok(await copyMaster(y, yMaster.id));
      ok(
        await at(NOV02, async () =>
          send('post', `/api/plans/journals/${y.journal}/share`, y.s.branch, y.owner.cookie, {
            quarterId: y.q2,
            journalId: y.otherJournal,
          }),
        ),
      );
      const separated = planSchema.parse(
        ok(
          await at(NOV02, async () =>
            send(
              'post',
              `/api/plans/journals/${y.otherJournal}/separate`,
              y.s.branch,
              y.owner.cookie,
              { quarterId: y.q2 },
            ),
          ),
        ).body,
      );
      expect(separated.master?.id).toBe(yMaster.id);
      const yIds = yMaster.masterItems.map((item) => item.id).sort();
      expect(
        (
          await t.database.migrator
            .selectFrom('lesson_plan_items')
            .innerJoin(
              'lesson_plan_journals',
              'lesson_plan_journals.plan_id',
              'lesson_plan_items.plan_id',
            )
            .select('lesson_plan_items.master_item_id')
            .where('lesson_plan_journals.journal_id', '=', y.otherJournal)
            .where('lesson_plan_journals.quarter_id', '=', y.q2)
            .execute()
        )
          .map((item) => item.master_item_id)
          .sort(),
      ).toEqual(yIds);
    });

    it('drops the master link in a copy to a plan whose language the master does not have (decision 11)', async () => {
      const x = await scene({ shared: true });
      const master = await masterWith(x, 2);
      ok(await copyMaster(x, master.id));
      await t.database.migrator
        .updateTable('classes')
        .set({ language: 'ru' })
        .where('id', '=', x.s.otherClass)
        .execute();
      const copied = await at(NOV02, async () =>
        send('post', `/api/plans/journals/${x.otherJournal}/copy`, x.s.branch, x.owner.cookie, {
          quarterId: x.q2,
          source: { journalId: x.journal, quarterId: x.q2 },
          part: 'all',
        }),
      );
      const plan = planSchema.parse(ok(copied).body);
      expect(plan.master).toBeNull();
      expect(topics(plan).slice(0, 2)).toEqual(['M1', 'M2']);
    });
  });

  describe('master updated', () => {
    /** A plan copied from a master of four items. */
    async function copiedScene() {
      const x = await scene();
      const master = await masterWith(x, 4);
      ok(await copyMaster(x, master.id));
      return { ...x, master };
    }

    const reread = async (x: Scene, master: PlanMaster) =>
      masterOf(
        await at(NOV02, async () =>
          send('get', `/api/plans/masters/${master.id}`, x.s.branch, x.head.cookie),
        ),
      );

    /** M2 changed, M4 removed, M5 added after M1. */
    async function changeMaster(x: Scene, master: PlanMaster): Promise<PlanMaster> {
      ok(await saveMasterItem(x, master, 2, 'M2 changed'));
      let now = await reread(x, master);
      ok(
        await at(NOV02, async () =>
          send(
            'post',
            `/api/plans/masters/${master.id}/items/${masterItem(now, 4).id}/remove`,
            x.s.branch,
            x.head.cookie,
            { revision: now.revision },
          ),
        ),
      );
      now = await reread(x, master);
      return masterOf(
        await at(NOV02, async () =>
          send('post', `/api/plans/masters/${master.id}/items`, x.s.branch, x.head.cookie, {
            revision: now.revision,
            position: 2,
            values: values('M5'),
          }),
        ),
      );
    }

    const compare = (x: Scene, moment = NOV02, browser: Browser = x.owner) =>
      at(moment, async () =>
        planMasterCompareSchema.parse(
          ok(
            await send(
              'get',
              `/api/plans/journals/${x.journal}/master-compare?quarterId=${x.q2}`,
              x.s.branch,
              browser.cookie,
            ),
          ).body,
        ),
      );

    const takeOrKeep = (
      x: Scene,
      path: 'master-take' | 'master-keep',
      revision: number,
      moment = NOV02,
    ) =>
      at(moment, async () =>
        send('post', `/api/plans/journals/${x.journal}/${path}`, x.s.branch, x.owner.cookie, {
          quarterId: x.q2,
          revision,
        }),
      );

    it('shows the changes side by side, matched by identity, and takes them inside the window (09, Master updated)', async () => {
      const x = await copiedScene();
      const changed = await changeMaster(x, x.master);
      const plan = await planOf(x, NOV02);
      expect(plan.master?.updated).toBe(true);
      const list = planListSchema.parse(
        ok(
          await at(NOV02, async () =>
            send('get', `/api/plans?yearId=${x.s.year}`, x.s.branch, x.owner.cookie),
          ),
        ).body,
      );
      const listed = list.plans.find((one) => one.journalId === x.journal);
      expect(listed?.quarters.find((one) => one.quarterId === x.q2)?.masterUpdated).toBe(true);
      const shown = await compare(x);
      expect(
        shown.rows.map((row) => [row.change, row.master?.topic ?? null, row.plan?.topic ?? null]),
      ).toEqual([
        ['added', 'M5', null],
        ['changed', 'M2 changed', 'M2'],
        ['removed', null, 'M4'],
      ]);
      // The Head Teacher of the subject reads the comparison too.
      expect((await compare(x, NOV02, x.head)).rows).toHaveLength(3);
      // A stale revision is refused.
      expect(codeOf(await takeOrKeep(x, 'master-take', changed.revision - 1))).toBe(
        'plan_master_stale',
      );
      const taken = planSchema.parse(ok(await takeOrKeep(x, 'master-take', changed.revision)).body);
      expect(topics(taken)).toEqual(['M1', 'M5', 'M2 changed', 'M3', null, null, null, null]);
      expect(taken.master?.updated).toBe(false);
      expect((await compare(x)).rows).toEqual([]);
      const [entry] = await entries('plan.master_taken', x.master.id);
      expect(entry?.new_value).toEqual(
        expect.objectContaining({ masterRevision: changed.revision }),
      );
    });

    it('takes an added item into every class of a shared plan, each from its own place (review should-fix 8)', async () => {
      const x = await scene({ shared: true });
      const master = await masterWith(x, 3);
      ok(await copyMaster(x, master.id));
      ok(
        await at(NOV02, async () =>
          send('post', `/api/plans/journals/${x.journal}/share`, x.s.branch, x.owner.cookie, {
            quarterId: x.q2,
            journalId: x.otherJournal,
          }),
        ),
      );
      const added = masterOf(
        await at(NOV02, async () =>
          send('post', `/api/plans/masters/${master.id}/items`, x.s.branch, x.head.cookie, {
            revision: master.revision,
            position: 2,
            values: values('M4'),
          }),
        ),
      );
      ok(
        await at(NOV02, async () =>
          send('post', `/api/plans/journals/${x.journal}/master-take`, x.s.branch, x.owner.cookie, {
            quarterId: x.q2,
            revision: added.revision,
          }),
        ),
      );
      expect(topics(await planOf(x, NOV02)).slice(0, 4)).toEqual(['M1', 'M4', 'M2', 'M3']);
      expect(topics(await planOf(x, NOV02, x.owner, x.otherJournal)).slice(0, 4)).toEqual([
        'M1',
        'M4',
        'M2',
        'M3',
      ]);
    });

    it('shows nothing for a change of the master saved back to the text the plan has (review must-fix 4)', async () => {
      const x = await copiedScene();
      ok(await saveMasterItem(x, x.master, 2, 'M2 changed'));
      ok(await saveMasterItem(x, await reread(x, x.master), 2, 'M2'));
      expect((await planOf(x, NOV02)).master?.updated).toBe(false);
      expect((await compare(x)).rows).toEqual([]);
    });

    it('keeps the plan as it is inside the window: the mark goes, nothing changes', async () => {
      const x = await copiedScene();
      const changed = await changeMaster(x, x.master);
      const before = await planOf(x, NOV02);
      const kept = planSchema.parse(ok(await takeOrKeep(x, 'master-keep', changed.revision)).body);
      expect(topics(kept)).toEqual(topics(before));
      expect(kept.master?.updated).toBe(false);
      expect(await entries('plan.master_kept', x.master.id)).toHaveLength(1);
    });

    it('needs an approved request after the window to take or keep, and touches only rows not yet held', async () => {
      const x = await copiedScene();
      // M1 changed: its lesson (9 November) is held on Thursday 26 November.
      ok(await saveMasterItem(x, x.master, 1, 'M1 changed'));
      let now = await reread(x, x.master);
      const changed = masterOf(await saveMasterItem(x, now, 4, 'M4 changed'));
      const shown = await compare(x, THURSDAY);
      expect(shown.rows.map((row) => [row.change, row.plan?.topic ?? null, row.held])).toEqual([
        ['changed', 'M1', true],
        ['changed', 'M4', false],
      ]);
      const before = await rowsOf(x.s.branch);
      for (const path of ['master-take', 'master-keep'] as const) {
        expect(codeOf(await takeOrKeep(x, path, changed.revision, THURSDAY))).toBe(
          'plan_window_closed',
        );
      }
      expect(await rowsOf(x.s.branch)).toEqual(before);
      // A Text request over the fourth lesson, approved by the Head Teacher.
      const plan = await planOf(x, THURSDAY);
      const fourth = plan.rows[3];
      if (fourth === undefined) throw new Error('no row');
      const asked = await at(THURSDAY, async () =>
        send('post', `/api/plans/journals/${x.journal}/requests`, x.s.branch, x.owner.cookie, {
          quarterId: x.q2,
          kind: 'text',
          lessonIds: [fourth.lessonId],
          reason: 'Master changed',
        }),
      );
      const requestId = (ok(asked, 201).body as { id: string }).id;
      ok(
        await at(THURSDAY, async () =>
          send('post', `/api/plans/requests/${requestId}/decide`, x.s.branch, x.head.cookie, {
            decision: 'approve',
            days: 2,
          }),
        ),
      );
      now = await reread(x, x.master);
      const taken = planSchema.parse(
        ok(await takeOrKeep(x, 'master-take', now.revision, THURSDAY)).body,
      );
      // The held lesson keeps its item; the fourth row takes the master's text.
      expect(topics(taken).slice(0, 4)).toEqual(['M1', 'M2', 'M3', 'M4 changed']);
      const [entry] = await entries('plan.master_taken', x.master.id);
      expect(JSON.stringify(entry?.details)).toContain(requestId);
    });
  });

  describe('at the same moment', () => {
    /** Holds a row lock in a transaction of the migrator; answers its pid and a release. */
    async function holdRow(lock: ReturnType<typeof sql>) {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: (pid: number) => void = () => undefined;
      const holding = new Promise<number>((resolve) => {
        ready = resolve;
      });
      const done = t.database.migrator.transaction().execute(async (transaction) => {
        await lock.execute(transaction);
        const pid = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(transaction);
        ready(pid.rows[0]?.pid ?? 0);
        await released;
      });
      const pid = await holding;
      return {
        pid,
        release: async () => {
          release();
          await done;
        },
      };
    }

    /** Waits until `count` backends of this database wait, directly or behind another, on `pid`. */
    async function waitingOn(pid: number, count = 1): Promise<void> {
      for (let tries = 0; tries < 400; tries += 1) {
        const found = await sql<{ count: number }>`
          select count(*)::int as count from pg_stat_activity a
          where a.datname = current_database() and cardinality(pg_blocking_pids(a.pid)) > 0
            and (${pid} = any(pg_blocking_pids(a.pid)) or exists (
              select 1 from pg_stat_activity b
              where b.pid = any(pg_blocking_pids(a.pid)) and ${pid} = any(pg_blocking_pids(b.pid))
            ))
        `.execute(t.database.migrator);
        if ((found.rows[0]?.count ?? 0) >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Fewer than ${String(count)} requests waited on the held row.`);
    }

    /** Starts a request at once (a supertest request is sent only once awaited, `api.md`). */
    const started = (run: () => PromiseLike<Response>) =>
      new Promise<Response>((resolve, reject) => {
        run().then(resolve, reject);
      });

    const storedLink = async (journal: string, quarter: string) =>
      t.database.migrator
        .selectFrom('lesson_plans')
        .innerJoin('lesson_plan_journals', 'lesson_plan_journals.plan_id', 'lesson_plans.id')
        .select(['lesson_plans.master_id', 'lesson_plans.master_revision'])
        .where('lesson_plan_journals.journal_id', '=', journal)
        .where('lesson_plan_journals.quarter_id', '=', quarter)
        .executeTakeFirstOrThrow();

    /**
     * Runs a request at NOV02 with the clock held there until it ends (the
     * held side keeps it waiting); the sessions are fresh for that moment.
     */
    async function inMoment<T>(work: () => Promise<T>): Promise<T> {
      t.clock.set(NOV02);
      await freshAt(NOV02);
      try {
        return await work();
      } finally {
        t.clock.set(START);
        await freshAt(START);
      }
    }

    const saveCall = (x: Scene, master: PlanMaster, topic: string) => () =>
      send(
        'put',
        `/api/plans/masters/${master.id}/items/${masterItem(master, 1).id}`,
        x.s.branch,
        x.head.cookie,
        { revision: master.revision, values: values(topic) },
      );

    const copyCall = (x: Scene, masterId: string) => () =>
      send('post', `/api/plans/journals/${x.journal}/copy`, x.s.branch, x.owner.cookie, {
        quarterId: x.q2,
        source: { masterId },
      });

    it('copies the master as a save left it when the save holds the master first (review should-fix 7)', async () => {
      const x = await scene();
      const master = await masterWith(x, 2);
      await inMoment(async () => {
        // The copy waits on the journal; the save runs and commits meanwhile.
        const held = await holdRow(
          sql`select id from journals where id = ${x.journal} for no key update`,
        );
        const copy = started(copyCall(x, master.id));
        await waitingOn(held.pid);
        ok(await saveCall(x, master, 'M1 saved')());
        await held.release();
        ok(await copy);
      });
      const plan = await planOf(x, NOV02);
      expect(topics(plan).slice(0, 2)).toEqual(['M1 saved', 'M2']);
      expect((await storedLink(x.journal, x.q2)).master_revision).toBe(master.revision + 1);
      expect(plan.master?.updated).toBe(false);
    });

    it('keeps the revision it copied when the copy holds the master first: the save that waited shows as master updated', async () => {
      const x = await scene();
      const master = await masterWith(x, 2);
      await inMoment(async () => {
        // The save waits on the master the copy reads `for share`; the copy commits first.
        const held = await holdRow(
          sql`select id from lesson_plan_masters where id = ${master.id} for share`,
        );
        const save = started(saveCall(x, master, 'M1 saved'));
        await waitingOn(held.pid);
        ok(await copyCall(x, master.id)());
        await held.release();
        ok(await save);
      });
      expect((await storedLink(x.journal, x.q2)).master_revision).toBe(master.revision);
      const plan = await planOf(x, NOV02);
      expect(topics(plan).slice(0, 2)).toEqual(['M1', 'M2']);
      expect(plan.master?.updated).toBe(true);
    });

    it('takes the changes a save made first, and leaves a later save as master updated', async () => {
      const x = await scene();
      const master = await masterWith(x, 2);
      ok(await copyMaster(x, master.id));
      const changed = masterOf(await saveMasterItem(x, master, 2, 'M2 changed'));
      const takeCall = () =>
        send('post', `/api/plans/journals/${x.journal}/master-take`, x.s.branch, x.owner.cookie, {
          quarterId: x.q2,
          revision: changed.revision,
        });
      // The take holds the master `for share` first: the save waits and comes after it.
      await inMoment(async () => {
        const held = await holdRow(
          sql`select id from lesson_plan_masters where id = ${master.id} for share`,
        );
        const save = started(saveCall(x, changed, 'M1 later'));
        await waitingOn(held.pid);
        ok(await takeCall());
        await held.release();
        ok(await save);
      });
      const plan = await planOf(x, NOV02);
      expect(topics(plan).slice(0, 2)).toEqual(['M1', 'M2 changed']);
      expect((await storedLink(x.journal, x.q2)).master_revision).toBe(changed.revision);
      expect(plan.master?.updated).toBe(true);
      // The save holds the master first: the take waits on the journal and is refused as stale.
      const now = masterOf(
        await at(NOV02, async () =>
          send('get', `/api/plans/masters/${master.id}`, x.s.branch, x.head.cookie),
        ),
      );
      await inMoment(async () => {
        const held = await holdRow(
          sql`select id from journals where id = ${x.journal} for no key update`,
        );
        const take = started(() =>
          send('post', `/api/plans/journals/${x.journal}/master-take`, x.s.branch, x.owner.cookie, {
            quarterId: x.q2,
            revision: now.revision,
          }),
        );
        await waitingOn(held.pid);
        ok(await saveCall(x, now, 'M1 last')());
        await held.release();
        expect(codeOf(await take)).toBe('plan_master_stale');
      });
    });

    it('lets one of two item creates on one revision through and refuses the other as stale', async () => {
      const x = await scene();
      const master = await masterWith(x, 1);
      const create = (topic: string) => () =>
        send('post', `/api/plans/masters/${master.id}/items`, x.s.branch, x.head.cookie, {
          revision: master.revision,
          position: 1,
          values: values(topic),
        });
      const answers = await inMoment(async () => {
        const held = await holdRow(
          sql`select id from lesson_plan_masters where id = ${master.id} for share`,
        );
        const first = started(create('First'));
        await waitingOn(held.pid, 1);
        const second = started(create('Second'));
        await waitingOn(held.pid, 2);
        await held.release();
        return [await first, await second];
      });
      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
      const refused = answers.find((answer) => answer.status === 409);
      if (refused === undefined) throw new Error('none refused');
      expect(codeOf(refused)).toBe('plan_master_stale');
      const items = await t.database.migrator
        .selectFrom('lesson_plan_master_items')
        .select('topic')
        .where('master_id', '=', master.id)
        .orderBy('position')
        .execute();
      expect(items).toHaveLength(2);
    });
  });

  describe('parallel classes', () => {
    it('shows each class of the grade with the item it has reached, and a group of two grades under both (09, Parallel classes)', async () => {
      const x = await scene();
      const master = await masterWith(x, 4);
      ok(await copyMaster(x, master.id));
      // A group of grades 7 and 8 of the subject, with its journal.
      const grade8 = await load.classes.schoolClass(x.s.branch, x.s.year, { grade: 8 });
      const group = await load.classes.group(x.s.branch, x.s.year, x.s.subject, [
        x.s.classId,
        grade8,
      ]);
      await sql`
        insert into journals (branch_id, academic_year_id, group_id, subject_id, runs)
        values (${x.s.branch}, ${x.s.year}, ${group}, ${x.s.subject}, '{}')
      `.execute(t.database.migrator);
      const parallelOf = async (grade: number, browser: Browser = x.head) =>
        planParallelSchema.parse(
          ok(
            await at(THURSDAY, async () =>
              send(
                'get',
                `/api/plans/parallel?subjectId=${x.s.subject}&grade=${String(grade)}&quarterId=${x.q2}`,
                x.s.branch,
                browser.cookie,
              ),
            ),
          ).body,
        );
      const seven = await parallelOf(7);
      const first = seven.units.find((unit) => unit.journalId === x.journal);
      expect(first?.reached).toEqual({ number: 3, date: '2026-11-23', topic: 'M3' });
      expect(first?.next).toEqual({ number: 4, date: '2026-11-30', topic: 'M4' });
      const other = seven.units.find((unit) => unit.journalId === x.otherJournal);
      expect(other?.reached).toEqual({ number: 3, date: '2026-11-23', topic: null });
      expect(seven.units.map((unit) => unit.unit.kind)).toEqual(['class', 'class', 'group']);
      const eight = await parallelOf(8);
      expect(eight.units.map((unit) => unit.unit.id)).toEqual([group]);
      // A teacher does not read it; the whole-branch roles do.
      expect(
        codeOf(
          await at(THURSDAY, async () =>
            send(
              'get',
              `/api/plans/parallel?subjectId=${x.s.subject}&grade=7&quarterId=${x.q2}`,
              x.s.branch,
              x.owner.cookie,
            ),
          ),
        ),
      ).toBe('plan_scope');
      expect((await parallelOf(7, x.vice)).units).toHaveLength(3);
    });
  });
});
