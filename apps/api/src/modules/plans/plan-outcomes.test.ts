import { randomUUID } from 'node:crypto';
import {
  apiErrorSchema,
  BRANCH_HEADER,
  planItemSchema,
  planSchema,
  REQUEST_KEY_HEADER,
  type Plan,
  type PlanItem,
} from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeQuarter } from '../../testing/closing-kit.js';
import { linesOf } from '../../testing/pdf-kit.js';
import { binary } from '../../testing/xlsx-kit.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { openPlanWindows } from '../../testing/plan-windows-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';

/** Wednesday 30 December 2026: quarter 2 (to 28 December) has ended, its window too. */
const AFTER_Q2 = '2026-12-30T10:00:00+05:00';

const ok = (response: Response, status = 200) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response;
};

const codeOf = (response: Response) => apiErrorSchema.parse(response.body).error.code;

const refused = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(codeOf(response)).toBe(code);
};

const values = (topic: string, works: { classworks?: string[]; homeworks?: string[] } = {}) => ({
  topic,
  objectives: '',
  links: [],
  classworks: (works.classworks ?? []).map((title) => ({ title, description: '' })),
  homeworks: (works.homeworks ?? []).map((title) => ({ title, description: '' })),
});

// All names are invented. Task 9.2d, pull request #233: docs/spec/edge-cases/lesson-plans.md,
// Plans and the journal, "Items are still 'not covered' at the end of the quarter": "Each item
// gets one outcome: merged into a lesson, carried, or dropped with a reason; only the approver
// can drop. Carried items wait in a 'carried in' tray on the next quarter's plan. ... In quarter
// 4 only merge or drop exist." docs/spec/09-lesson-plans.md: "'Not covered' items are never
// dropped silently. With an approved edit request the teacher merges them into other lessons or
// carries them into the next quarter's plan." The close's own carry is in closing.test.ts.
describe('outcomes of "not covered" items and the carried-in tray', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Gulnora', `Ismoilova${'a'.repeat(names % 7)}`);
  };

  const VALID_FROM = new Date('2026-09-01T00:00:00+05:00');

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

  const post = (path: string, branch: string, cookie: string, body: object) =>
    request(t.kit.server).post(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body);

  const keyed = (path: string, branch: string, body: object) =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send(body);

  /** A graded scene: the owner, a spare teacher, the Head Teacher of the subject; windows open. */
  async function scene(input: { shared?: boolean; windows?: boolean } = {}) {
    const owner = await account();
    const spare = await account();
    const head = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      ...(input.shared === true ? { shared: true } : {}),
      accounts: { teacher: owner.account.id, spare: spare.account.id },
    });
    if (input.windows !== false) await openPlanWindows(t.database.migrator, s.branch, s.year);
    for (const browser of [owner, spare]) {
      await t.kit.giveRole(browser.account.id, {
        role: 'teacher',
        branchId: s.branch,
        validFrom: VALID_FROM,
      });
    }
    await t.kit.giveRole(head.account.id, {
      role: 'head_teacher',
      branchId: s.branch,
      subjectIds: [s.subject],
      validFrom: VALID_FROM,
    });
    const journalOf = async (classId: string) =>
      (
        await t.database.migrator
          .selectFrom('journals')
          .select('id')
          .where('class_id', '=', classId)
          .where('subject_id', '=', s.subject)
          .executeTakeFirstOrThrow()
      ).id;
    const quarters = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', s.year)
        .orderBy('number')
        .execute()
    ).map((one) => one.id);
    return {
      s,
      owner,
      spare,
      head,
      journal: await journalOf(s.classId),
      other: input.shared === true ? await journalOf(s.otherClass) : '',
      q1: quarters[0] ?? '',
      q2: quarters[1] ?? '',
      q3: quarters[2] ?? '',
      q4: quarters[3] ?? '',
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  const planOf = async (
    x: Scene,
    quarterId: string,
    journal = x.journal,
    cookie = x.owner.cookie,
    moment = START,
  ): Promise<Plan> =>
    at(moment, async () =>
      planSchema.parse(
        ok(
          await request(t.kit.server)
            .get(`/api/plans/journals/${journal}?quarterId=${quarterId}`)
            .set('Cookie', cookie)
            .set(BRANCH_HEADER, x.s.branch),
        ).body,
      ),
    );

  /** Items "Topic n" at the rows named, written by the owner inside the window. */
  async function fill(
    x: Scene,
    quarterId: string,
    positions: readonly number[],
    journal = x.journal,
    works: Record<number, { classworks?: string[]; homeworks?: string[] }> = {},
  ): Promise<PlanItem[]> {
    const plan = await planOf(x, quarterId, journal);
    const items: PlanItem[] = [];
    for (const position of positions) {
      const row = plan.rows[position - 1];
      items.push(
        planItemSchema.parse(
          ok(
            await at(START, () =>
              post(`/api/plans/journals/${journal}/items`, x.s.branch, x.owner.cookie, {
                quarterId,
                position,
                lessonId: row?.lessonId ?? randomUUID(),
                values: values(`Topic ${String(position)}`, works[position]),
              }),
            ),
            201,
          ).body,
        ),
      );
    }
    return items;
  }

  const lessonOn = (s: PublishedScene, date: string, classId = s.classId) =>
    t.database.migrator
      .selectFrom('lessons')
      .select('id')
      .where('class_id', '=', classId)
      .where('subject_id', '=', s.subject)
      .where('lesson_date', '=', date)
      .executeTakeFirstOrThrow();

  /** A one-day cancel by the Super Admin; the follow sends the last items to "not covered". */
  const cancel = async (x: Scene, date: string, classId = x.s.classId) =>
    ok(
      await keyed(
        `/api/timetable/lessons/${(await lessonOn(x.s, date, classId)).id}/cancel`,
        x.s.branch,
        { reason: 'Excursion' },
      ),
    );

  const restore = async (x: Scene, date: string) =>
    ok(
      await keyed(
        `/api/timetable/lessons/${(await lessonOn(x.s, date)).id}/restore`,
        x.s.branch,
        {},
      ),
    );

  /** Eight items in quarter 2 and the Monday 16 November cancelled: "Topic 8" is not covered. */
  async function notCoveredScene(
    input: { shared?: boolean; works?: Record<number, { classworks?: string[] }> } = {},
  ) {
    const x = await scene(input);
    const items = await fill(x, x.q2, [1, 2, 3, 4, 5, 6, 7, 8], x.journal, input.works ?? {});
    await cancel(x, '2026-11-16');
    const plan = await planOf(x, x.q2);
    expect(plan.notCovered.map((item) => item.topic)).toEqual(['Topic 8']);
    const last = items[7];
    if (last === undefined) throw new Error('Eight items.');
    return { x, items, last };
  }

  const path = (x: Scene, itemId: string, what: 'merge' | 'carry' | 'drop', journal = x.journal) =>
    `/api/plans/journals/${journal}/not-covered/${itemId}/${what}`;

  const merge = (x: Scene, itemId: string, row: Plan['rows'][number], cookie = x.owner.cookie) =>
    at(START, () =>
      post(path(x, itemId, 'merge'), x.s.branch, cookie, {
        quarterId: x.q2,
        position: row.number,
        lessonId: row.lessonId,
      }),
    );

  const carry = (x: Scene, itemId: string, quarterId = x.q2, moment = START) =>
    at(moment, () => post(path(x, itemId, 'carry'), x.s.branch, x.owner.cookie, { quarterId }));

  const drop = (x: Scene, itemId: string, cookie: string, reason = 'Covered by the excursion') =>
    at(START, () => post(path(x, itemId, 'drop'), x.s.branch, cookie, { quarterId: x.q2, reason }));

  const outcomeRows = (journal: string) =>
    t.database.migrator
      .selectFrom('lesson_plan_outcomes')
      .selectAll()
      .where('journal_id', '=', journal)
      .orderBy('created_at')
      .execute();

  describe('merged into a lesson', () => {
    it('fills an empty row with the item, records the outcome with the date, and audits it', async () => {
      const { x, items, last } = await notCoveredScene();
      const third = items[2];
      if (third === undefined) throw new Error('Three items.');
      ok(
        await at(START, () =>
          post(`/api/plans/items/${third.id}/clear`, x.s.branch, x.owner.cookie, {}),
        ),
        204,
      );
      const before = await planOf(x, x.q2);
      const row = before.rows[2];
      if (row === undefined || row.item !== null) throw new Error('Row 3 empty.');
      const plan = planSchema.parse(ok(await merge(x, last.id, row)).body);
      expect(plan.rows[2]?.item?.topic).toBe('Topic 8');
      expect(plan.notCovered).toEqual([]);
      expect(plan.outcomes.map((one) => [one.topic, one.kind, one.targetDate])).toEqual([
        ['Topic 8', 'merged', row.date],
      ]);
      const entry = (await t.entries('plan.not_covered_merged')).at(-1);
      expect(entry?.new_value).toMatchObject({
        itemId: last.id,
        into: 'empty_row',
        date: row.date,
      });
    });

    it('joins the item into the item of a row: topic, works; old and new content in the audit entry', async () => {
      const { x, items, last } = await notCoveredScene({
        works: { 8: { classworks: ['Quiz'] }, 2: { classworks: ['Essay'] } },
      });
      const plan0 = await planOf(x, x.q2);
      const row = plan0.rows[1];
      if (row === undefined) throw new Error('Row 2.');
      const plan = planSchema.parse(ok(await merge(x, last.id, row)).body);
      expect(plan.rows[1]?.item?.id).toBe(items[1]?.id);
      expect(plan.rows[1]?.item?.topic).toBe('Topic 2; Topic 8');
      expect(plan.rows[1]?.item?.classworks.map((one) => one.title)).toEqual(['Essay', 'Quiz']);
      expect(plan.notCovered).toEqual([]);
      // The merged item has no place left: it is cleared, its history stays.
      const stored = await t.database.migrator
        .selectFrom('lesson_plan_items')
        .select('cleared_at')
        .where('id', '=', last.id)
        .executeTakeFirstOrThrow();
      expect(stored.cleared_at).not.toBeNull();
      const entry = (await t.entries('plan.not_covered_merged')).at(-1);
      expect(entry?.new_value).toMatchObject({
        into: 'item',
        old: { topic: 'Topic 2' },
        new: { topic: 'Topic 2; Topic 8' },
      });
    });

    it('refuses a merge that would pass the topic limit, and an item that stands at a row', async () => {
      const { x, items, last } = await notCoveredScene();
      const plan0 = await planOf(x, x.q2);
      const row = plan0.rows[0];
      if (row === undefined) throw new Error('Row 1.');
      await at(START, async () => {
        const first = items[0];
        if (first === undefined) throw new Error('Item 1.');
        ok(
          await request(t.kit.server)
            .put(`/api/plans/items/${first.id}`)
            .set('Cookie', x.owner.cookie)
            .set(BRANCH_HEADER, x.s.branch)
            .send({
              base: {
                topic: first.topic,
                objectives: '',
                links: [],
                classworks: [],
                homeworks: [],
              },
              values: values('T'.repeat(295)),
            }),
        );
      });
      refused(await merge(x, last.id, row), 409, 'plan_merge_too_long');
      // Topic 2 stands at row 2: it is not "not covered".
      refused(await merge(x, items[1]?.id ?? '', row), 409, 'plan_item_covered');
      expect(await outcomeRows(x.journal)).toEqual([]);
    });

    it('is refused after the window with no approved period (`09`: "With an approved edit request")', async () => {
      const { x, last } = await notCoveredScene();
      const plan = await planOf(x, x.q2, x.journal, x.owner.cookie, AFTER_Q2);
      const row = plan.rows[1];
      if (row === undefined) throw new Error('Row 2.');
      await at(AFTER_Q2, async () => {
        refused(
          await post(path(x, last.id, 'merge'), x.s.branch, x.owner.cookie, {
            quarterId: x.q2,
            position: row.number,
            lessonId: row.lessonId,
          }),
          409,
          'plan_window_closed',
        );
        refused(
          await post(path(x, last.id, 'carry'), x.s.branch, x.owner.cookie, { quarterId: x.q2 }),
          409,
          'plan_window_closed',
        );
      });
      expect(await outcomeRows(x.journal)).toEqual([]);
    });
  });

  describe('carried into the next quarter', () => {
    it("puts a copy into the next quarter's tray, takes it out of this quarter, and places it at a row", async () => {
      const { x, last } = await notCoveredScene();
      const plan = planSchema.parse(ok(await carry(x, last.id)).body);
      expect(plan.notCovered).toEqual([]);
      expect(plan.outcomes.map((one) => [one.topic, one.kind, one.automatic])).toEqual([
        ['Topic 8', 'carried', false],
      ]);
      const next = await planOf(x, x.q3);
      expect(next.carriedIn.map((one) => one.topic)).toEqual(['Topic 8']);
      expect(next.carriedIn[0]?.copiedFrom).toEqual({ journalId: x.journal, quarterId: x.q2 });
      // The tray counts as not covered of quarter 3 (decision 10).
      const tray = next.carriedIn[0];
      const row = next.rows[0];
      if (tray === undefined || row === undefined) throw new Error('A tray item and a row.');
      const placed = planSchema.parse(
        ok(
          await at(START, () =>
            post(
              `/api/plans/journals/${x.journal}/carried/${tray.id}/place`,
              x.s.branch,
              x.owner.cookie,
              {
                quarterId: x.q3,
                position: 1,
                lessonId: row.lessonId,
              },
            ),
          ),
        ).body,
      );
      expect(placed.rows[0]?.item?.topic).toBe('Topic 8');
      expect(placed.carriedIn).toEqual([]);
      expect((await t.entries('plan.carried_placed')).at(-1)?.new_value).toMatchObject({
        itemId: tray.id,
        position: 1,
      });
    });

    it('moves the later items one step when a carried-in item is placed at a row that holds one', async () => {
      const { x, last } = await notCoveredScene();
      await fill(x, x.q3, [1, 2]);
      ok(await carry(x, last.id));
      const next = await planOf(x, x.q3);
      const tray = next.carriedIn[0];
      const row = next.rows[0];
      if (tray === undefined || row === undefined) throw new Error('A tray item and a row.');
      const placed = planSchema.parse(
        ok(
          await at(START, () =>
            post(
              `/api/plans/journals/${x.journal}/carried/${tray.id}/place`,
              x.s.branch,
              x.owner.cookie,
              {
                quarterId: x.q3,
                position: 1,
                lessonId: row.lessonId,
              },
            ),
          ),
        ).body,
      );
      expect(placed.rows.slice(0, 3).map((one) => one.item?.topic ?? '-')).toEqual([
        'Topic 8',
        'Topic 1',
        'Topic 2',
      ]);
    });

    it('is refused in the last quarter of the year, at the route and in the database', async () => {
      const x = await scene();
      const items = await fill(x, x.q4, [1]);
      const plan4 = await planOf(x, x.q4);
      // An item past the last row of quarter 4, as the follow leaves one.
      const planId = (
        await t.database.migrator
          .selectFrom('lesson_plan_journals')
          .select('plan_id')
          .where('journal_id', '=', x.journal)
          .where('quarter_id', '=', x.q4)
          .executeTakeFirstOrThrow()
      ).plan_id;
      const extra = await t.database.migrator
        .insertInto('lesson_plan_items')
        .values({ branch_id: x.s.branch, plan_id: planId, topic: 'Topic past' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .insertInto('lesson_plan_places')
        .values({
          branch_id: x.s.branch,
          plan_id: planId,
          journal_id: x.journal,
          item_id: extra.id,
          position: plan4.rows.length + 1,
        })
        .execute();
      expect(items).toHaveLength(1);
      const plan = await planOf(x, x.q4);
      expect([plan.carryClosed, plan.notCovered.map((one) => one.topic)]).toEqual([
        true,
        ['Topic past'],
      ]);
      refused(await carry(x, extra.id, x.q4), 409, 'plan_carry_refused');
      await expect(
        t.database.migrator
          .insertInto('lesson_plan_outcomes')
          .values({
            branch_id: x.s.branch,
            journal_id: x.journal,
            quarter_id: x.q4,
            item_id: extra.id,
            kind: 'carried',
            decided_by: x.owner.account.id,
            decided_at: new Date(),
            carried_item_id: extra.id,
          })
          .execute(),
      ).rejects.toThrow(/lesson_plan_carry_refused/);
      // Merge or drop exist: the Head Teacher drops it.
      const dropped = planSchema.parse(
        ok(
          await at(START, () =>
            post(path(x, extra.id, 'drop'), x.s.branch, x.head.cookie, {
              quarterId: x.q4,
              reason: 'Repeated topic',
            }),
          ),
        ).body,
      );
      expect(dropped.notCovered).toEqual([]);
    });

    it('is refused when the next quarter is closed (a reopened quarter), at the route and in the database', async () => {
      const { x, last } = await notCoveredScene();
      const vice = await account();
      await closeQuarter(t.database, {
        branchId: x.s.branch,
        quarterId: x.q3,
        accountId: vice.account.id,
      });
      expect((await planOf(x, x.q2)).carryClosed).toBe(true);
      refused(await carry(x, last.id), 409, 'plan_carry_refused');
      expect(await outcomeRows(x.journal)).toEqual([]);
    });
  });

  describe('dropped by the approver', () => {
    it('lets the Head Teacher of the subject drop with a reason; the owner, another Head Teacher and a Teacher are refused', async () => {
      const { x, last } = await notCoveredScene();
      expect((await planOf(x, x.q2)).canDrop).toBe(false);
      expect((await planOf(x, x.q2, x.journal, x.head.cookie)).canDrop).toBe(true);
      // The owner may not drop in their own plan (nobody decides their own).
      const ownerHead = await account();
      refused(await drop(x, last.id, x.owner.cookie), 403, 'permission_denied');
      // A Head Teacher of another subject holds the permission; the reach refuses.
      const otherSubject = await load.classes.subject({ grades: [7], journalType: 'graded' });
      await t.kit.giveRole(ownerHead.account.id, {
        role: 'head_teacher',
        branchId: x.s.branch,
        subjectIds: [otherSubject],
        validFrom: VALID_FROM,
      });
      refused(await drop(x, last.id, ownerHead.cookie), 403, 'plan_scope');
      refused(await drop(x, last.id, x.spare.cookie), 403, 'permission_denied');
      const blank = await drop(x, last.id, x.head.cookie, '  ');
      expect(blank.status).toBe(400);
      expect(await outcomeRows(x.journal)).toEqual([]);
      const plan = planSchema.parse(ok(await drop(x, last.id, x.head.cookie)).body);
      expect(plan.notCovered).toEqual([]);
      expect(plan.outcomes.map((one) => [one.kind, one.reason])).toEqual([
        ['dropped', 'Covered by the excursion'],
      ]);
      expect((await t.entries('plan.not_covered_dropped')).at(-1)?.old_value).toMatchObject({
        itemId: last.id,
        topic: 'Topic 8',
      });
      // One outcome per item: a second one is refused.
      refused(await drop(x, last.id, x.head.cookie), 409, 'plan_item_covered');
    });

    it('is the only way: the queue edit and "Clear" refuse to remove a not-covered item', async () => {
      const { x, last } = await notCoveredScene();
      refused(
        await at(START, () =>
          post(`/api/plans/items/${last.id}/clear`, x.s.branch, x.owner.cookie, {}),
        ),
        409,
        'plan_not_covered_drop',
      );
      const plan = await planOf(x, x.q2);
      const queue = [...plan.rows.map((row) => row.item?.id ?? null), last.id];
      refused(
        await at(START, () =>
          request(t.kit.server)
            .put(`/api/plans/journals/${x.journal}/queue`)
            .set('Cookie', x.owner.cookie)
            .set(BRANCH_HEADER, x.s.branch)
            .send({ quarterId: x.q2, base: queue, order: queue.slice(0, -1) }),
        ),
        409,
        'plan_not_covered_drop',
      );
      expect((await planOf(x, x.q2)).notCovered.map((one) => one.id)).toEqual([last.id]);
    });
  });

  it('leaves no gap: the next not-covered item moves up and takes a row that comes back', async () => {
    const x = await scene();
    await fill(x, x.q2, [1, 2, 3, 4, 5, 6, 7, 8]);
    await cancel(x, '2026-11-16');
    await cancel(x, '2026-11-23');
    const before = await planOf(x, x.q2);
    expect(before.notCovered.map((one) => one.topic)).toEqual(['Topic 7', 'Topic 8']);
    const seventh = before.notCovered[0];
    if (seventh === undefined) throw new Error('Topic 7.');
    ok(await carry(x, seventh.id));
    await restore(x, '2026-11-23');
    const after = await planOf(x, x.q2);
    expect(after.rows.at(-1)?.item?.topic).toBe('Topic 8');
    expect(after.notCovered).toEqual([]);
  });

  it('gives an item not covered in one class of a shared plan its outcome there only', async () => {
    const x = await scene({ shared: true });
    ok(
      await at(START, () =>
        post(`/api/plans/journals/${x.journal}/share`, x.s.branch, x.owner.cookie, {
          quarterId: x.q2,
          journalId: x.other,
        }),
      ),
    );
    const items = await fill(x, x.q2, [1, 2, 3, 4, 5, 6, 7, 8]);
    await cancel(x, '2026-11-16', x.s.otherClass);
    const other = await planOf(x, x.q2, x.other);
    expect(other.notCovered.map((one) => one.topic)).toEqual(['Topic 8']);
    expect((await planOf(x, x.q2)).notCovered).toEqual([]);
    const last = items[7];
    const row = other.rows[1];
    if (last === undefined || row === undefined) throw new Error('Topic 8 and a row.');
    // Merged into an item, it would show twice in the class that still covers it (decision 8).
    refused(
      await at(START, () =>
        post(path(x, last.id, 'merge', x.other), x.s.branch, x.owner.cookie, {
          quarterId: x.q2,
          position: row.number,
          lessonId: row.lessonId,
        }),
      ),
      409,
      'plan_merge_shared',
    );
    // Review correction 1: the queue edit of the class that covers it may not drop it either.
    const own = await planOf(x, x.q2);
    const queue = own.rows.map((one) => one.item?.id ?? null);
    refused(
      await at(START, () =>
        request(t.kit.server)
          .put(`/api/plans/journals/${x.journal}/queue`)
          .set('Cookie', x.owner.cookie)
          .set(BRANCH_HEADER, x.s.branch)
          .send({ quarterId: x.q2, base: queue, order: queue.slice(0, -1) }),
      ),
      409,
      'plan_not_covered_drop',
    );
    ok(
      await at(START, () =>
        post(path(x, last.id, 'carry', x.other), x.s.branch, x.owner.cookie, { quarterId: x.q2 }),
      ),
    );
    expect((await planOf(x, x.q2, x.other)).notCovered).toEqual([]);
    // The class that covers it keeps it at its row.
    expect((await planOf(x, x.q2)).rows[7]?.item?.id).toBe(last.id);
    expect((await planOf(x, x.q3, x.other)).carriedIn.map((one) => one.topic)).toEqual(['Topic 8']);
    expect((await planOf(x, x.q3)).carriedIn).toEqual([]);
  });

  it('takes the tray with a class separated from its shared plan of the next quarter', async () => {
    const x = await scene({ shared: true });
    const items = await fill(x, x.q2, [1, 2, 3, 4, 5, 6, 7, 8]);
    await cancel(x, '2026-11-16');
    const last = items[7];
    if (last === undefined) throw new Error('Topic 8.');
    ok(await carry(x, last.id));
    // Review correction 4: a plan holding a carried-in item is not empty, so it cannot join.
    refused(
      await at(START, () =>
        post(`/api/plans/journals/${x.other}/share`, x.s.branch, x.owner.cookie, {
          quarterId: x.q3,
          journalId: x.journal,
        }),
      ),
      409,
      'plan_share_has_items',
    );
    // The other class joins the quarter 3 plan that holds the tray item, then this one leaves.
    ok(
      await at(START, () =>
        post(`/api/plans/journals/${x.journal}/share`, x.s.branch, x.owner.cookie, {
          quarterId: x.q3,
          journalId: x.other,
        }),
      ),
    );
    const trayBefore = (await planOf(x, x.q3)).carriedIn[0];
    ok(
      await at(START, () =>
        post(`/api/plans/journals/${x.journal}/separate`, x.s.branch, x.owner.cookie, {
          quarterId: x.q3,
        }),
      ),
    );
    const after = await planOf(x, x.q3);
    expect(after.carriedIn.map((one) => one.topic)).toEqual(['Topic 8']);
    expect(after.carriedIn[0]?.id).not.toBe(trayBefore?.id);
    // The outcome stays readable in quarter 2 after the separation.
    expect((await planOf(x, x.q2)).outcomes.map((one) => one.kind)).toEqual(['carried']);
  });

  it('lets a plan whose tray held an item join once the tray is empty (review correction 4)', async () => {
    const x = await scene({ shared: true });
    const items = await fill(x, x.q2, [1, 2, 3, 4, 5, 6, 7, 8]);
    await cancel(x, '2026-11-16');
    const last = items[7];
    if (last === undefined) throw new Error('Topic 8.');
    ok(await carry(x, last.id));
    const join = () =>
      at(START, () =>
        post(`/api/plans/journals/${x.other}/share`, x.s.branch, x.owner.cookie, {
          quarterId: x.q3,
          journalId: x.journal,
        }),
      );
    refused(await join(), 409, 'plan_share_has_items');
    const tray = (await planOf(x, x.q3)).carriedIn[0];
    if (tray === undefined) throw new Error('A tray item.');
    ok(
      await at(START, () =>
        post(
          `/api/plans/journals/${x.journal}/not-covered/${tray.id}/drop`,
          x.s.branch,
          x.head.cookie,
          { quarterId: x.q3, reason: 'Taught in the excursion' },
        ),
      ),
    );
    ok(await join());
  });

  it("lists the outcomes and the carried-in items in the plan's Excel file", async () => {
    const { x, last } = await notCoveredScene();
    ok(await carry(x, last.id));
    await t.database.migrator
      .updateTable('accounts')
      .set({ language: 'en' })
      .where('id', '=', x.owner.account.id)
      .execute();
    const textOf = async (quarterId: string) => {
      const sheet = await at(START, () =>
        request(t.kit.server)
          .post(`/api/plans/journals/${x.journal}/export`)
          .set('Cookie', x.owner.cookie)
          .set(BRANCH_HEADER, x.s.branch)
          .buffer(true)
          .parse(binary)
          .send({ quarterId, format: 'xlsx' }),
      );
      expect(sheet.status).toBe(200);
      return JSON.stringify((await linesOf(sheet.body as Buffer)).lines.map((line) => line.values));
    };
    const q2 = await textOf(x.q2);
    expect(q2).toContain('Topic 8');
    expect(q2).toContain('carried to the next quarter');
    const q3 = await textOf(x.q3);
    expect(q3).toContain('Carried in');
    expect(q3).toContain('Topic 8');
  });

  it("answers 404 for another branch's or an unknown journal, item and lesson, changing nothing", async () => {
    const { x, last } = await notCoveredScene();
    const y = await notCoveredScene();
    const plan = await planOf(x, x.q2);
    const row = plan.rows[1];
    if (row === undefined) throw new Error('Row 2.');
    const outcomes = async () =>
      (
        await t.database.migrator
          .selectFrom('lesson_plan_outcomes')
          .select('id')
          .where('branch_id', 'in', [x.s.branch, y.x.s.branch])
          .execute()
      ).length;
    const before = [await outcomes(), await t.auditCount()];
    await at(START, async () => {
      for (const sent of [
        () =>
          post(path(x, last.id, 'carry', y.x.journal), x.s.branch, x.owner.cookie, {
            quarterId: x.q2,
          }),
        () =>
          post(path(x, last.id, 'carry', UNKNOWN), x.s.branch, x.owner.cookie, { quarterId: x.q2 }),
        () => post(path(x, y.last.id, 'carry'), x.s.branch, x.owner.cookie, { quarterId: x.q2 }),
        () => post(path(x, UNKNOWN, 'carry'), x.s.branch, x.owner.cookie, { quarterId: x.q2 }),
        () =>
          post(path(x, last.id, 'merge'), x.s.branch, x.owner.cookie, {
            quarterId: x.q2,
            position: row.number,
            lessonId: UNKNOWN,
          }),
        () =>
          post(path(x, y.last.id, 'drop'), x.s.branch, x.head.cookie, {
            quarterId: x.q2,
            reason: 'Gone',
          }),
        () =>
          post(
            `/api/plans/journals/${x.journal}/carried/${UNKNOWN}/place`,
            x.s.branch,
            x.owner.cookie,
            {
              quarterId: x.q3,
              position: 1,
              lessonId: row.lessonId,
            },
          ),
      ]) {
        refused(await sent(), 404, 'not_found');
      }
    });
    expect([await outcomes(), await t.auditCount()]).toEqual(before);
  });
});
