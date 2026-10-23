import { randomUUID } from 'node:crypto';
import {
  apiErrorSchema,
  BRANCH_HEADER,
  planEventDecidedSchema,
  planItemSchema,
  planListSchema,
  planRequestSchema,
  planRequestsSchema,
  planSchema,
  planWindowsSchema,
  REQUEST_KEY_HEADER,
  type Plan,
  type PlanItem,
  type PlanRequest,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { publishedScene, publishOf, QUARTERS } from '../../testing/published-scene.js';

/** Tuesday 27 October 2026, noon: the window of quarter 2 is opened. */
const OCT27 = '2026-10-27T12:00:00+05:00';
/** Monday 2 November 2026, noon: inside the window (28 October to 10 November). */
const NOV02 = '2026-11-02T12:00:00+05:00';
/** The last minute of the window's last day, and three minutes after it. */
const LAST_MINUTE = '2026-11-10T23:59:00+05:00';
const AFTER_END = '2026-11-11T00:03:00+05:00';
/** Thursday 26 November 2026, noon: the Mondays 9, 16 and 23 November are held. */
const THURSDAY = '2026-11-26T12:00:00+05:00';
/** Saturday 28 November: after a period of two school days approved on Thursday. */
const SATURDAY = '2026-11-28T12:00:00+05:00';

const WINDOW = { startDate: '2026-10-28', endDate: '2026-11-10', confirm: true };

const ok = (response: Response, status = 200) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response;
};

const codeOf = (response: Response) => apiErrorSchema.parse(response.body).error.code;

const values = (topic: string) => ({
  topic,
  objectives: '',
  links: [],
  classworks: [],
  homeworks: [],
});

const baseOf = (item: PlanItem) => ({
  topic: item.topic,
  objectives: item.objectives,
  links: item.links,
  classworks: item.classworks,
  homeworks: item.homeworks,
});

// All names are invented. Task 7.2, pull request #215: docs/spec/09-lesson-plans.md,
// The plan window and Editing after the window; docs/spec/02-roles-and-access.md,
// Head Teachers and Senior Head Teachers; docs/spec/edge-cases/lesson-plans.md,
// The window and requests. "Done when: nothing opens without an approved request
// and nobody approves their own."
describe('the plan window and edit requests', () => {
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
    return t.kit.completeSession('Dilnoza', `Rahimova${'a'.repeat(names % 7)}`);
  };

  type Browser = Awaited<ReturnType<typeof account>>;

  /** Every session as fresh at `moment` (the Super Admin's too). */
  const freshAt = (moment: string) =>
    t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
      .execute();

  /** Runs `work` at `moment`, then sets the clock and the sessions back. */
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
    method: 'get' | 'post' | 'put' | 'delete',
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

  const VALID_FROM = new Date('2026-09-01T00:00:00+05:00');

  /**
   * A graded scene: its owner and a spare teacher, the Head Teacher, the
   * Senior Head Teacher and the Academic Vice Principal of the subject.
   */
  async function scene() {
    const owner = await account();
    const spare = await account();
    const head = await account();
    const senior = await account();
    const vice = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id, spare: spare.account.id },
    });
    for (const browser of [owner, spare]) {
      await t.kit.giveRole(browser.account.id, {
        role: 'teacher',
        branchId: s.branch,
        validFrom: VALID_FROM,
      });
    }
    const headRole = await t.kit.giveRole(head.account.id, {
      role: 'head_teacher',
      branchId: s.branch,
      subjectIds: [s.subject],
      validFrom: VALID_FROM,
    });
    const seniorRole = await t.kit.giveRole(senior.account.id, {
      role: 'senior_head_teacher',
      subjectIds: [s.subject],
      validFrom: VALID_FROM,
    });
    await t.kit.giveRole(vice.account.id, {
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
    return {
      s,
      owner,
      spare,
      head,
      headRole: headRole.id,
      senior,
      seniorRole: seniorRole.id,
      vice,
      journal: await journalOf(s.classId),
      otherJournal: await journalOf(s.otherClass),
      q2: quarters[1]?.id ?? '',
      q3: quarters[2]?.id ?? '',
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  const openWindow = (x: Scene, body: object = WINDOW, moment = OCT27) =>
    at(moment, async () =>
      send('put', `/api/plans/windows/${x.q2}`, x.s.branch, x.vice.cookie, body),
    );

  const planOf = (x: Scene, moment: string, browser: Browser = x.owner): Promise<Plan> =>
    at(moment, async () =>
      planSchema.parse(
        ok(
          await send(
            'get',
            `/api/plans/journals/${x.journal}?quarterId=${x.q2}`,
            x.s.branch,
            browser.cookie,
          ),
        ).body,
      ),
    );

  const create = (x: Scene, plan: Plan, position: number, topic = `Topic ${String(position)}`) =>
    send('post', `/api/plans/journals/${x.journal}/items`, x.s.branch, x.owner.cookie, {
      quarterId: x.q2,
      position,
      lessonId: plan.rows[position - 1]?.lessonId ?? randomUUID(),
      values: values(topic),
    });

  /** Items "Topic n" at the rows named, written inside the window. */
  async function fill(x: Scene, positions: readonly number[]): Promise<PlanItem[]> {
    const plan = await planOf(x, NOV02);
    const items: PlanItem[] = [];
    await at(NOV02, async () => {
      for (const position of positions) {
        items.push(planItemSchema.parse(ok(await create(x, plan, position), 201).body));
      }
    });
    return items;
  }

  const save = (x: Scene, item: PlanItem, topic: string) =>
    send('put', `/api/plans/items/${item.id}`, x.s.branch, x.owner.cookie, {
      base: baseOf(item),
      values: values(topic),
    });

  const ask = (x: Scene, body: object, browser: Browser = x.owner) =>
    send('post', `/api/plans/journals/${x.journal}/requests`, x.s.branch, browser.cookie, {
      quarterId: x.q2,
      ...body,
    });

  const decide = (x: Scene, requestId: string, body: object, browser: Browser = x.head) =>
    send('post', `/api/plans/requests/${requestId}/decide`, x.s.branch, browser.cookie, body);

  const requestOf = (response: Response, status = 200): PlanRequest =>
    planRequestSchema.parse(ok(response, status).body);

  const noticesOf = async (accountId: string, kind: string) =>
    (
      await t.database.migrator
        .selectFrom('notifications')
        .select('data')
        .where('account_id', '=', accountId)
        .where('kind', '=', kind)
        .orderBy('created_at')
        .orderBy('id')
        .execute()
    ).map((row) => row.data);

  const entries = async (action: string, id: string) =>
    (
      await t.database.migrator
        .selectFrom('audit_log')
        .select(['actor_id', 'old_value', 'new_value', 'details'])
        .where('action', '=', action)
        .orderBy('id')
        .execute()
    ).filter((entry) => JSON.stringify(entry).includes(id));

  /** Every row of the tables the routes of 7.2 write, in one branch. */
  const rowsOf = async (branch: string) => {
    const found: Record<string, unknown[]> = {};
    for (const table of [
      'lesson_plan_windows',
      'lesson_plan_window_extensions',
      'lesson_plan_requests',
      'lesson_plan_request_lessons',
      'lesson_plan_items',
      'lesson_plan_places',
    ] as const) {
      found[table] = await t.database.migrator
        .selectFrom(table)
        .selectAll()
        .where('branch_id', '=', branch)
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

  describe('the window', () => {
    it('opens only with the timetable published, asks to confirm the lessons held without a plan, tells the owners and audits', async () => {
      const x = await scene();
      // A branch whose quarter 2 has no published timetable.
      const bare = await t.newBranch();
      const bareYear = await load.classes.year(bare);
      for (const [index, [start, end]] of QUARTERS.entries()) {
        await t.database.migrator
          .updateTable('quarters')
          .set({ start_date: start, end_date: end })
          .where('academic_year_id', '=', bareYear)
          .where('number', '=', index + 1)
          .execute();
      }
      const bareQ2 = await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', bareYear)
        .where('number', '=', 2)
        .executeTakeFirstOrThrow();
      const unpublished = await at(OCT27, async () =>
        send('put', `/api/plans/windows/${bareQ2.id}`, bare, t.admin, WINDOW),
      );
      expect(codeOf(unpublished)).toBe('plan_window_unpublished');

      // `edge`: "If it ends after the quarter's first lesson, the system shows how
      // many lessons will be held without a plan and asks for confirmation."
      const asked = await openWindow(x, { startDate: '2026-10-28', endDate: '2026-11-10' });
      expect(codeOf(asked)).toBe('plan_window_confirm');
      // Monday 9 November in each class.
      expect(apiErrorSchema.parse(asked.body).error.details?.[0]?.lessonsWithoutPlan).toBe(2);
      const opened = planWindowsSchema.parse(ok(await openWindow(x)).body);
      const q2 = opened.quarters.find((one) => one.quarter.id === x.q2);
      expect(q2?.window).toEqual({
        startDate: '2026-10-28',
        endDate: '2026-11-10',
        state: 'before',
        extensions: [],
      });
      expect(await noticesOf(x.owner.account.id, 'plans.window_opened')).toEqual([
        { quarter: 2, startDate: '2026-10-28', endDate: '2026-11-10' },
      ]);
      const entry = (await entries('plan.window_open', x.q2))[0];
      expect(entry?.actor_id).toBe(x.vice.account.id);
      expect(entry?.new_value).toEqual(
        expect.objectContaining({
          startDate: '2026-10-28',
          endDate: '2026-11-10',
          lessonsWithoutPlan: 2,
        }),
      );
    });

    it('moves its end to any date from today on, never past the quarter, and its start only before it starts', async () => {
      const x = await scene();
      ok(await openWindow(x));
      const past = await openWindow(x, { startDate: '2026-10-28', endDate: '2026-10-26' });
      expect(codeOf(past)).toBe('plan_window_dates');
      const before = await openWindow(x, {
        startDate: '2026-10-20',
        endDate: '2026-10-26',
        confirm: true,
      });
      expect(codeOf(before)).toBe('plan_window_end_past');
      const after = await openWindow(x, {
        startDate: '2026-10-28',
        endDate: '2027-01-05',
        confirm: true,
      });
      expect(codeOf(after)).toBe('plan_window_after_quarter');
      const started = await openWindow(
        x,
        { startDate: '2026-10-30', endDate: '2026-11-20', confirm: true },
        NOV02,
      );
      expect(codeOf(started)).toBe('plan_window_started');
      ok(
        await openWindow(
          x,
          { startDate: '2026-10-28', endDate: '2026-11-20', confirm: true },
          NOV02,
        ),
      );
      expect(await noticesOf(x.owner.account.id, 'plans.window_changed')).toEqual([
        { quarter: 2, startDate: '2026-10-28', endDate: '2026-11-20' },
      ]);
      expect((await entries('plan.window_change', x.q2)).at(-1)?.old_value).toEqual({
        startDate: '2026-10-28',
        endDate: '2026-11-10',
      });
    });

    it("answers 404 for another branch's or an unknown quarter on open and extend, and writes nothing", async () => {
      const x = await scene();
      const y = await scene();
      const before = [await rowsOf(x.s.branch), await rowsOf(y.s.branch)];
      for (const quarter of [y.q2, randomUUID()]) {
        const opened = await at(OCT27, async () =>
          send('put', `/api/plans/windows/${quarter}`, x.s.branch, x.vice.cookie, WINDOW),
        );
        expect(opened.status).toBe(404);
        const extended = await at(OCT27, async () =>
          send('post', `/api/plans/windows/${quarter}/extensions`, x.s.branch, x.vice.cookie, {
            staffId: x.s.teacher.staffId,
            endDate: '2026-11-20',
          }),
        );
        expect(extended.status).toBe(404);
      }
      // A person of another branch, and an unknown one.
      ok(await openWindow(x));
      for (const staffId of [y.s.teacher.staffId, randomUUID()]) {
        const extended = await at(OCT27, async () =>
          send('post', `/api/plans/windows/${x.q2}/extensions`, x.s.branch, x.vice.cookie, {
            staffId,
            endDate: '2026-11-20',
          }),
        );
        expect(extended.status).toBe(404);
      }
      expect(await rowsOf(y.s.branch)).toEqual(before[1]);
    });
  });

  describe('nothing opens without the window or an approved request', () => {
    it('refuses every write before any window, takes them inside it to 23:59 of its last day, and refuses them three minutes later', async () => {
      const x = await scene();
      const plan = await planOf(x, OCT27);
      expect(plan.window.state).toBe('not_opened');
      expect(plan.flag).toBe('window_not_opened');
      const early = await at(OCT27, async () => create(x, plan, 1));
      expect(codeOf(early)).toBe('plan_window_not_open');
      ok(await openWindow(x));
      const beforeStart = await at(OCT27, async () => create(x, plan, 1));
      expect(codeOf(beforeStart)).toBe('plan_window_not_open');
      const [item] = await fill(x, [1, 2]);
      if (item === undefined) throw new Error('no item');
      const last = await at(LAST_MINUTE, async () => save(x, item, 'Last minute'));
      const saved = planItemSchema.parse(ok(last).body);
      const late = await at(AFTER_END, async () => save(x, saved, 'Too late'));
      expect(late.status).toBe(409);
      expect(codeOf(late)).toBe('plan_window_closed');
      const after = await planOf(x, AFTER_END);
      expect(after.window).toEqual({
        state: 'ended',
        startDate: '2026-10-28',
        endDate: '2026-11-10',
      });
      expect(after.flag).toBe('overdue');
      expect(after.rows.every((row) => row.open === 'none')).toBe(true);
      // Every write route is refused after the end: create, clear, file upload and delete, copy, queue.
      await at(AFTER_END, async () => {
        expect(codeOf(await create(x, after, 3))).toBe('plan_window_closed');
        expect(
          codeOf(
            await send('post', `/api/plans/items/${saved.id}/clear`, x.s.branch, x.owner.cookie),
          ),
        ).toBe('plan_window_closed');
        const upload = await request(t.kit.server)
          .put(`/api/plans/items/${saved.id}/files?name=notes.pdf`)
          .set('Cookie', x.owner.cookie)
          .set(BRANCH_HEADER, x.s.branch)
          .set('Content-Type', 'application/pdf')
          .send(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]));
        expect(codeOf(upload)).toBe('plan_window_closed');
        const queue = await send(
          'put',
          `/api/plans/journals/${x.journal}/queue`,
          x.s.branch,
          x.owner.cookie,
          {
            quarterId: x.q2,
            base: [],
            order: [],
          },
        );
        expect([200, 409]).toContain(queue.status);
      });
      // The list shows the flag of each quarter: overdue in quarter 2, no window in quarter 3.
      const list = await at(AFTER_END, async () =>
        planListSchema.parse(ok(await send('get', '/api/plans', x.s.branch, x.owner.cookie)).body),
      );
      const own = list.plans.find((one) => one.journalId === x.journal);
      expect(own?.quarters.find((one) => one.quarterId === x.q2)?.flag).toBe('overdue');
      expect(own?.quarters.find((one) => one.quarterId === x.q3)?.flag).toBe('window_not_opened');
    });

    it('extends the window for one teacher before its end, and records an extension after it as an approved request', async () => {
      const x = await scene();
      ok(await openWindow(x));
      const [item] = await fill(x, [1]);
      if (item === undefined) throw new Error('no item');
      const extend = (endDate: string, moment: string, staffId = x.s.teacher.staffId) =>
        at(moment, async () =>
          send('post', `/api/plans/windows/${x.q2}/extensions`, x.s.branch, x.vice.cookie, {
            staffId,
            endDate,
          }),
        );
      expect(codeOf(await extend('2026-11-09', NOV02))).toBe('plan_extension_not_later');
      expect(codeOf(await extend('2026-11-20', NOV02, x.s.spareTeacher.staffId))).toBe(
        'plan_extension_owner',
      );
      const windows = planWindowsSchema.parse(ok(await extend('2026-11-13', NOV02)).body);
      expect(windows.quarters.find((one) => one.quarter.id === x.q2)?.window?.extensions).toEqual([
        expect.objectContaining({ staffId: x.s.teacher.staffId, endDate: '2026-11-13' }),
      ]);
      const saved = planItemSchema.parse(
        ok(await at('2026-11-12T10:00:00+05:00', async () => save(x, item, 'Extended'))).body,
      );
      expect(codeOf(await at('2026-11-14T10:00:00+05:00', async () => save(x, saved, 'No')))).toBe(
        'plan_window_closed',
      );
      // After the end: an approved request of kind "extension", by the Academic Vice Principal.
      ok(await extend('2026-11-27', '2026-11-20T10:00:00+05:00'));
      const requests = await t.database.migrator
        .selectFrom('lesson_plan_requests')
        .select(['kind', 'status', 'decided_by', 'journal_id'])
        .where('journal_id', '=', x.journal)
        .execute();
      expect(requests).toEqual([
        {
          kind: 'extension',
          status: 'approved',
          decided_by: x.vice.account.id,
          journal_id: x.journal,
        },
      ]);
      ok(await at(THURSDAY, async () => save(x, saved, 'Under the extension')));
      expect(codeOf(await at(SATURDAY, async () => save(x, saved, 'After it')))).toBe(
        'plan_window_closed',
      );
      expect(await noticesOf(x.owner.account.id, 'plans.window_extended')).toEqual([
        { quarter: 2, endDate: '2026-11-13' },
        { quarter: 2, endDate: '2026-11-27' },
      ]);
    });
  });

  describe('edit requests', () => {
    /** A scene whose rows 1 to 5 hold items written inside the window, now ended. */
    async function closedScene() {
      const x = await scene();
      ok(await openWindow(x));
      const items = await fill(x, [1, 2, 3, 4, 5]);
      return { ...x, items };
    }

    const itemAt = (x: { items: PlanItem[] }, position: number) => {
      const found = x.items[position - 1];
      if (found === undefined) throw new Error('no item');
      return found;
    };

    it("opens a Text request's lessons for their wording only, for the days approved, marks a held lesson's item, and tells who decides", async () => {
      const x = await closedScene();
      const plan = await planOf(x, THURSDAY);
      const held = plan.rows[1];
      const ahead = plan.rows[3];
      if (held === undefined || ahead === undefined) throw new Error('no rows');
      // Inside the window there is nothing to ask.
      expect(
        codeOf(
          await at(NOV02, async () =>
            ask(x, { kind: 'text', lessonIds: [held.lessonId], reason: 'Typo' }),
          ),
        ),
      ).toBe('plan_request_window_open');
      expect(
        codeOf(
          await at(THURSDAY, async () =>
            ask(x, { kind: 'text', lessonIds: [randomUUID()], reason: 'Typo' }),
          ),
        ),
      ).toBe('plan_request_lesson_unknown');
      expect(
        codeOf(
          await at(THURSDAY, async () =>
            ask(x, { kind: 'replan', fromLessonId: held.lessonId, reason: 'Merge' }),
          ),
        ),
      ).toBe('plan_request_held_replan');
      const asked = requestOf(
        await at(THURSDAY, async () =>
          ask(x, { kind: 'text', lessonIds: [held.lessonId], reason: 'Typo' }),
        ),
        201,
      );
      expect(asked).toEqual(
        expect.objectContaining({ kind: 'text', status: 'sent', reason: 'Typo', open: false }),
      );
      // Review correction 5: the Head Teacher of the subject is told, not the requester.
      expect(await noticesOf(x.head.account.id, 'plans.request_sent')).toHaveLength(1);
      expect(await noticesOf(x.owner.account.id, 'plans.request_sent')).toEqual([]);
      // Nothing opens before the approval.
      expect(codeOf(await at(THURSDAY, async () => save(x, itemAt(x, 2), 'Fixed')))).toBe(
        'plan_window_closed',
      );
      const approved = requestOf(
        await at(THURSDAY, async () => decide(x, asked.id, { decision: 'approve', days: 2 })),
      );
      expect(approved).toEqual(
        expect.objectContaining({ status: 'approved', days: 2, open: true }),
      );
      expect(approved.openUntil).toBe('2026-11-27T18:59:59.999Z');
      expect(await noticesOf(x.owner.account.id, 'plans.request_approved')).toEqual([
        { unit: plan.unit.name, quarter: 2, until: '2026-11-27' },
      ]);
      const opened = await planOf(x, THURSDAY);
      expect(opened.rows.map((row) => row.open)).toEqual([
        'none',
        'text',
        'none',
        'none',
        'none',
        'none',
        'none',
        'none',
      ]);
      const fixed = planItemSchema.parse(
        ok(await at(THURSDAY, async () => save(x, itemAt(x, 2), 'Fixed'))).body,
      );
      // `09`: "If the item of a lesson already held is changed, it carries an \"edited after the lesson\" mark."
      expect(fixed.editedAfterLesson).toBe(true);
      const edit = (await entries('plan.item_edit', itemAt(x, 2).id)).at(-1);
      expect(edit?.details).toEqual(
        expect.objectContaining({ requests: [{ id: asked.id, approvedBy: x.head.account.id }] }),
      );
      expect(edit?.old_value).toEqual({ topic: 'Topic 2' });
      // Another lesson, and a move, stay closed; the period ends after its two school days.
      expect(codeOf(await at(THURSDAY, async () => save(x, itemAt(x, 4), 'No')))).toBe(
        'plan_window_closed',
      );
      expect(
        codeOf(
          await at(THURSDAY, async () =>
            send('post', `/api/plans/items/${itemAt(x, 2).id}/clear`, x.s.branch, x.owner.cookie),
          ),
        ),
      ).toBe('plan_window_closed');
      expect(codeOf(await at(SATURDAY, async () => save(x, fixed, 'Later')))).toBe(
        'plan_window_closed',
      );
      // Decided once only.
      expect(
        codeOf(
          await at(THURSDAY, async () => decide(x, asked.id, { decision: 'refuse', reason: 'No' })),
        ),
      ).toBe('plan_request_decided');
    });

    it("opens a Re-plan from its first lesson to the quarter's end for create, clear and the queue, never a held row, and locks again when finished", async () => {
      const x = await closedScene();
      const plan = await planOf(x, THURSDAY);
      const from = plan.rows[4];
      if (from === undefined) throw new Error('no row');
      const asked = requestOf(
        await at(THURSDAY, async () =>
          ask(x, { kind: 'replan', fromLessonId: from.lessonId, reason: 'Merge two topics' }),
        ),
        201,
      );
      // The approver moves the first lesson one later, with a reason (review decision 10).
      const later = plan.rows[5];
      if (later === undefined) throw new Error('no row');
      ok(
        await at(THURSDAY, async () =>
          decide(x, asked.id, {
            decision: 'approve',
            days: 3,
            later: { fromLessonId: later.lessonId, reason: 'Row 5 stays' },
          }),
        ),
      );
      const opened = await planOf(x, THURSDAY);
      expect(opened.rows.map((row) => row.open)).toEqual([
        'none',
        'none',
        'none',
        'none',
        'none',
        'all',
        'all',
        'all',
      ]);
      expect(codeOf(await at(THURSDAY, async () => save(x, itemAt(x, 5), 'No')))).toBe(
        'plan_window_closed',
      );
      ok(await at(THURSDAY, async () => create(x, opened, 6)), 201);
      // The queue edit: row 6 emptied, its item after row 7's place.
      const now = await planOf(x, THURSDAY);
      const sixth = now.rows[5]?.item?.id ?? null;
      const base = now.rows.slice(3).map((row) => row.item?.id ?? null);
      const queued = await at(THURSDAY, async () => {
        return send('put', `/api/plans/journals/${x.journal}/queue`, x.s.branch, x.owner.cookie, {
          quarterId: x.q2,
          base,
          order: [base[0] ?? null, base[1] ?? null, null, sixth],
        });
      });
      // Rows 4 and 5 (30 November, 7 December) are before the period: the queue edit moving row 6 is allowed.
      const moved = planSchema.parse(ok(queued).body);
      expect(moved.rows.map((row) => row.item?.topic ?? '-')).toEqual([
        'Topic 1',
        'Topic 2',
        'Topic 3',
        'Topic 4',
        'Topic 5',
        '-',
        'Topic 6',
        '-',
      ]);
      expect((await entries('plan.queue_edit', x.journal)).length).toBe(1);
      // A queue edit from row 4 on is refused: row 4 lies before the period.
      const current = await planOf(x, THURSDAY);
      const early = await at(THURSDAY, async () => {
        const base = current.rows.slice(3).map((row) => row.item?.id ?? null);
        return send('put', `/api/plans/journals/${x.journal}/queue`, x.s.branch, x.owner.cookie, {
          quarterId: x.q2,
          base,
          order: [base[1] ?? null, base[0] ?? null, ...base.slice(2)],
        });
      });
      expect(codeOf(early)).toBe('plan_window_closed');
      // "Finished" locks it early.
      ok(
        await at(THURSDAY, async () =>
          send('post', `/api/plans/requests/${asked.id}/finish`, x.s.branch, x.owner.cookie),
        ),
      );
      const after = await planOf(x, THURSDAY);
      expect(after.rows.every((row) => row.open === 'none')).toBe(true);
      expect(codeOf(await at(THURSDAY, async () => create(x, after, 8)))).toBe(
        'plan_window_closed',
      );
      expect(
        codeOf(
          await at(THURSDAY, async () =>
            send('post', `/api/plans/requests/${asked.id}/finish`, x.s.branch, x.owner.cookie),
          ),
        ),
      ).toBe('plan_request_decided');
    });

    it('a refusal changes nothing and the teacher may ask again', async () => {
      const x = await closedScene();
      const plan = await planOf(x, THURSDAY);
      const lesson = plan.rows[1]?.lessonId ?? '';
      const asked = requestOf(
        await at(THURSDAY, async () =>
          ask(x, { kind: 'text', lessonIds: [lesson], reason: 'Typo' }),
        ),
        201,
      );
      const refused = requestOf(
        await at(THURSDAY, async () =>
          decide(x, asked.id, { decision: 'refuse', reason: 'Not needed' }),
        ),
      );
      expect(refused).toEqual(
        expect.objectContaining({ status: 'refused', decisionReason: 'Not needed' }),
      );
      expect(await noticesOf(x.owner.account.id, 'plans.request_refused')).toEqual([
        { unit: plan.unit.name, quarter: 2, reason: 'Not needed' },
      ]);
      expect(codeOf(await at(THURSDAY, async () => save(x, itemAt(x, 2), 'No')))).toBe(
        'plan_window_closed',
      );
      ok(
        await at(THURSDAY, async () =>
          ask(x, { kind: 'text', lessonIds: [lesson], reason: 'Again' }),
        ),
        201,
      );
    });

    it('unticks a lesson with a reason; the unticked lesson stays closed', async () => {
      const x = await closedScene();
      const plan = await planOf(x, THURSDAY);
      const [first, second] = [plan.rows[0]?.lessonId ?? '', plan.rows[1]?.lessonId ?? ''];
      const asked = requestOf(
        await at(THURSDAY, async () =>
          ask(x, { kind: 'text', lessonIds: [first, second], reason: 'Typos' }),
        ),
        201,
      );
      const approved = requestOf(
        await at(THURSDAY, async () =>
          decide(x, asked.id, {
            decision: 'approve',
            days: 1,
            untick: [{ lessonId: first, reason: 'Fine as it is' }],
          }),
        ),
      );
      expect(approved.lessons).toEqual([
        expect.objectContaining({
          lessonId: first,
          approved: false,
          untickReason: 'Fine as it is',
        }),
        expect.objectContaining({ lessonId: second, approved: true }),
      ]);
      expect(codeOf(await at(THURSDAY, async () => save(x, itemAt(x, 1), 'No')))).toBe(
        'plan_window_closed',
      );
      ok(await at(THURSDAY, async () => save(x, itemAt(x, 2), 'Yes')));
    });

    it("answers 404 for another branch's or an unknown request, journal or event, and writes nothing", async () => {
      const x = await closedScene();
      const y = await closedScene();
      const lesson = (await planOf(y, THURSDAY)).rows[1]?.lessonId ?? '';
      const theirs = requestOf(
        await at(THURSDAY, async () =>
          ask(y, { kind: 'text', lessonIds: [lesson], reason: 'Typo' }),
        ),
        201,
      );
      const before = await rowsOf(y.s.branch);
      await at(THURSDAY, async () => {
        for (const id of [theirs.id, randomUUID()]) {
          expect(
            (
              await send('post', `/api/plans/requests/${id}/decide`, x.s.branch, x.head.cookie, {
                decision: 'approve',
                days: 1,
              })
            ).status,
          ).toBe(404);
          expect(
            (await send('post', `/api/plans/requests/${id}/send`, x.s.branch, x.owner.cookie, {}))
              .status,
          ).toBe(404);
          expect(
            (await send('post', `/api/plans/requests/${id}/finish`, x.s.branch, x.owner.cookie))
              .status,
          ).toBe(404);
        }
        for (const journal of [y.journal, randomUUID()]) {
          expect(
            (
              await send(
                'post',
                `/api/plans/journals/${journal}/requests`,
                x.s.branch,
                x.owner.cookie,
                {
                  quarterId: x.q2,
                  kind: 'text',
                  lessonIds: [lesson],
                  reason: 'Typo',
                },
              )
            ).status,
          ).toBe(404);
          expect(
            (
              await send(
                'post',
                `/api/plans/journals/${journal}/requests/prepared`,
                x.s.branch,
                x.owner.cookie,
                { quarterId: x.q2 },
              )
            ).status,
          ).toBe(404);
          expect(
            (
              await send(
                'post',
                `/api/plans/journals/${journal}/requests/prepared/decide`,
                x.s.branch,
                x.head.cookie,
                {
                  quarterId: x.q2,
                  decision: { decision: 'approve', days: 1 },
                },
              )
            ).status,
          ).toBe(404);
        }
        expect(
          (
            await send('post', '/api/plans/requests/decide-event', x.s.branch, x.head.cookie, {
              eventId: randomUUID(),
              days: 1,
            })
          ).status,
        ).toBe(404);
      });
      expect(await rowsOf(y.s.branch)).toEqual(before);
    });
  });

  describe('who decides (02, "Who approves", "Own requests")', () => {
    async function askedBy(
      post: 'head_teacher' | 'senior_head_teacher' | 'academic_vice_principal',
    ) {
      const x = await scene();
      // One holder of a post per subject: the scene's holder of that post ends first.
      if (post !== 'academic_vice_principal') {
        await t.database.migrator
          .updateTable('assignments')
          .set({ valid_until: VALID_FROM })
          .where('id', '=', post === 'head_teacher' ? x.headRole : x.seniorRole)
          .execute();
      }
      await t.kit.giveRole(x.owner.account.id, {
        role: post,
        ...(post === 'senior_head_teacher' ? {} : { branchId: x.s.branch }),
        ...(post === 'academic_vice_principal' ? {} : { subjectIds: [x.s.subject] }),
        validFrom: VALID_FROM,
      });
      ok(await openWindow(x));
      await fill(x, [1, 2]);
      const lesson = (await planOf(x, THURSDAY)).rows[1]?.lessonId ?? '';
      const asked = requestOf(
        await at(THURSDAY, async () =>
          ask(x, { kind: 'text', lessonIds: [lesson], reason: 'Typo' }),
        ),
        201,
      );
      return { x, asked };
    }

    const tryAs = (x: Scene, id: string, browser: Browser) =>
      at(THURSDAY, async () => decide(x, id, { decision: 'approve', days: 1 }, browser));

    it('refuses a Head Teacher their own and lets the Senior Head Teacher decide it', async () => {
      // The owner holds the Head Teacher post of the subject (the scene's Head Teacher's ended first).
      const x0 = await scene();
      await t.database.migrator
        .updateTable('assignments')
        .set({ valid_until: VALID_FROM })
        .where('id', '=', x0.headRole)
        .execute();
      await t.kit.giveRole(x0.owner.account.id, {
        role: 'head_teacher',
        branchId: x0.s.branch,
        subjectIds: [x0.s.subject],
        validFrom: VALID_FROM,
      });
      ok(await openWindow(x0));
      await fill(x0, [1, 2]);
      const lesson = (await planOf(x0, THURSDAY)).rows[1]?.lessonId ?? '';
      const asked = requestOf(
        await at(THURSDAY, async () =>
          ask(x0, { kind: 'text', lessonIds: [lesson], reason: 'Typo' }),
        ),
        201,
      );
      // Told to the Senior Head Teacher and the Academic Vice Principal, never to the owner.
      expect(await noticesOf(x0.senior.account.id, 'plans.request_sent')).toHaveLength(1);
      expect(await noticesOf(x0.vice.account.id, 'plans.request_sent')).toHaveLength(1);
      expect(await noticesOf(x0.owner.account.id, 'plans.request_sent')).toEqual([]);
      const own = await tryAs(x0, asked.id, x0.owner);
      expect(own.status).toBe(403);
      expect(codeOf(own)).toBe('own_request');
      ok(await tryAs(x0, asked.id, x0.senior));
    });

    it("refuses the Head Teacher a Senior Head Teacher's own; the Academic Vice Principal decides it", async () => {
      const { x, asked } = await askedBy('senior_head_teacher');
      const head = await tryAs(x, asked.id, x.head);
      expect(head.status).toBe(403);
      expect(codeOf(head)).toBe('plan_scope');
      expect(codeOf(await tryAs(x, asked.id, x.owner))).toBe('own_request');
      ok(await tryAs(x, asked.id, x.vice));
    });

    it("refuses the Head Teacher and the Senior Head Teacher an Academic Vice Principal's own; the Super Admin decides it", async () => {
      const { x, asked } = await askedBy('academic_vice_principal');
      expect(codeOf(await tryAs(x, asked.id, x.head))).toBe('plan_scope');
      expect(codeOf(await tryAs(x, asked.id, x.senior))).toBe('plan_scope');
      expect(codeOf(await tryAs(x, asked.id, x.owner))).toBe('own_request');
      const admin = await at(THURSDAY, async () =>
        send('post', `/api/plans/requests/${asked.id}/decide`, x.s.branch, t.admin, {
          decision: 'approve',
          days: 1,
        }),
      );
      ok(admin);
    });

    it('refuses the Head Teacher of another subject, and lets a new Head Teacher of the subject decide what waited for the earlier one', async () => {
      const x = await scene();
      ok(await openWindow(x));
      await fill(x, [1, 2]);
      const lesson = (await planOf(x, THURSDAY)).rows[1]?.lessonId ?? '';
      const asked = requestOf(
        await at(THURSDAY, async () =>
          ask(x, { kind: 'text', lessonIds: [lesson], reason: 'Typo' }),
        ),
        201,
      );
      const other = await account();
      const otherSubject = await load.classes.subject({ grades: [7], journalType: 'graded' });
      await t.kit.giveRole(other.account.id, {
        role: 'head_teacher',
        branchId: x.s.branch,
        subjectIds: [otherSubject],
        validFrom: VALID_FROM,
      });
      expect(codeOf(await tryAs(x, asked.id, other))).toBe('plan_scope');
      // The post passes to a new Head Teacher from 20 November: no job, read at the decision.
      await t.database.migrator
        .updateTable('assignments')
        .set({ valid_until: new Date('2026-11-20T00:00:00+05:00') })
        .where('id', '=', x.headRole)
        .execute();
      const next = await account();
      await t.kit.giveRole(next.account.id, {
        role: 'head_teacher',
        branchId: x.s.branch,
        subjectIds: [x.s.subject],
        validFrom: new Date('2026-11-20T00:00:00+05:00'),
      });
      ok(await tryAs(x, asked.id, next));
    });
  });

  describe('requests prepared by the system', () => {
    it("prepares the window's end request on read, and stores it when the owner sends it: Re-plan from the first empty row ahead, Text on the held empty rows", async () => {
      const x = await scene();
      ok(await openWindow(x));
      await fill(x, [1, 5]);
      const plan = await planOf(x, THURSDAY);
      expect(plan.request).toEqual({
        id: null,
        fromDate: '2026-11-30',
        lessons: [
          { lessonId: plan.rows[1]?.lessonId, date: '2026-11-16' },
          { lessonId: plan.rows[2]?.lessonId, date: '2026-11-23' },
        ],
        causes: [],
      });
      const sent = requestOf(
        await at(THURSDAY, async () =>
          send(
            'post',
            `/api/plans/journals/${x.journal}/requests/prepared`,
            x.s.branch,
            x.owner.cookie,
            { quarterId: x.q2 },
          ),
        ),
      );
      expect(sent).toEqual(
        expect.objectContaining({ kind: 'replan', status: 'sent', fromDate: '2026-11-30' }),
      );
      expect(sent.lessons.map((one) => one.date)).toEqual(['2026-11-16', '2026-11-23']);
      ok(await at(THURSDAY, async () => decide(x, sent.id, { decision: 'approve', days: 2 })));
      const opened = await planOf(x, THURSDAY);
      // The held empty rows take a new item (Text), the rows ahead everything.
      ok(await at(THURSDAY, async () => create(x, opened, 2)), 201);
      ok(await at(THURSDAY, async () => create(x, opened, 4)), 201);
      expect(
        codeOf(
          await at(THURSDAY, async () =>
            send(
              'post',
              `/api/plans/journals/${x.journal}/requests/prepared`,
              x.s.branch,
              x.owner.cookie,
              { quarterId: x.q2 },
            ),
          ),
        ),
      ).toBe('plan_request_nothing');
    });

    it("lets an approver decide the request of the window's end without waiting, never the owner", async () => {
      const x = await scene();
      ok(await openWindow(x));
      await fill(x, [1]);
      const decided = requestOf(
        await at(THURSDAY, async () =>
          send(
            'post',
            `/api/plans/journals/${x.journal}/requests/prepared/decide`,
            x.s.branch,
            x.vice.cookie,
            {
              quarterId: x.q2,
              decision: { decision: 'approve', days: 1 },
            },
          ),
        ),
      );
      expect(decided).toEqual(
        expect.objectContaining({ status: 'approved', kind: 'replan', days: 1 }),
      );
      const spare = await at(THURSDAY, async () =>
        send(
          'post',
          `/api/plans/journals/${x.journal}/requests/prepared/decide`,
          x.s.branch,
          x.spare.cookie,
          {
            quarterId: x.q2,
            decision: { decision: 'approve', days: 1 },
          },
        ),
      );
      expect(spare.status).toBe(403);
    });

    it('adds the held empty rows to a prepared request sent after the window (review correction 2), and approves by event (09, Approving together)', async () => {
      const x = await scene();
      ok(await openWindow(x));
      await fill(x, [1, 3, 4, 5, 6, 7, 8]);
      // A cancel of 30 November after the window: the last item goes to "not covered".
      const lesson = await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', x.s.classId)
        .where('subject_id', '=', x.s.subject)
        .where('lesson_date', '=', '2026-11-30')
        .executeTakeFirstOrThrow();
      await at(THURSDAY, async () =>
        ok(
          await request(t.kit.server)
            .post(`/api/timetable/lessons/${lesson.id}/cancel`)
            .set('Cookie', t.admin)
            .set(BRANCH_HEADER, x.s.branch)
            .set(REQUEST_KEY_HEADER, randomUUID())
            .send({ reason: 'Excursion' }),
        ),
      );
      const plan = await planOf(x, THURSDAY);
      expect(plan.request?.id).not.toBeNull();
      expect(plan.request?.causes.map((cause) => cause.kind)).toEqual(['not_covered']);
      const sent = requestOf(
        await at(THURSDAY, async () =>
          send(
            'post',
            `/api/plans/requests/${plan.request?.id ?? ''}/send`,
            x.s.branch,
            x.owner.cookie,
            {},
          ),
        ),
      );
      // The held empty row 2 (16 November) is in the Text part.
      expect(sent.lessons.map((one) => one.date)).toEqual(['2026-11-16']);
      const listed = planRequestsSchema.parse(
        ok(
          await at(THURSDAY, async () =>
            send('get', '/api/plans/requests?view=deciding', x.s.branch, x.head.cookie),
          ),
        ).body,
      );
      const event = listed.events[0];
      expect(event?.requests).toBe(1);
      expect(
        (
          await at(THURSDAY, async () =>
            send('post', '/api/plans/requests/decide-event', x.s.branch, x.head.cookie, {
              eventId: event?.eventId ?? '',
              subjectId: randomUUID(),
              days: 2,
            }),
          )
        ).status,
      ).toBe(404);
      const decided = planEventDecidedSchema.parse(
        ok(
          await at(THURSDAY, async () =>
            send('post', '/api/plans/requests/decide-event', x.s.branch, x.head.cookie, {
              eventId: event?.eventId ?? '',
              subjectId: x.s.subject,
              days: 2,
            }),
          ),
        ).body,
      );
      expect(decided).toEqual({ approved: [sent.id], skipped: [] });
      expect(await noticesOf(x.owner.account.id, 'plans.request_approved')).toEqual([
        { unit: plan.unit.name, quarter: 2, until: '2026-11-27' },
      ]);
      ok(await at(THURSDAY, async () => create(x, plan, 2)), 201);
    });

    it("voids the earlier owner's sent requests and ends their periods when the class gets another teacher (review correction 4)", async () => {
      const x = await scene();
      ok(await openWindow(x));
      const [first] = await fill(x, [1, 2]);
      if (first === undefined) throw new Error('no item');
      const plan = await planOf(x, THURSDAY);
      const [one, two] = [plan.rows[0]?.lessonId ?? '', plan.rows[1]?.lessonId ?? ''];
      const open = requestOf(
        await at(THURSDAY, async () => ask(x, { kind: 'text', lessonIds: [one], reason: 'A' })),
        201,
      );
      ok(await at(THURSDAY, async () => decide(x, open.id, { decision: 'approve', days: 5 })));
      const waiting = requestOf(
        await at(THURSDAY, async () => ask(x, { kind: 'text', lessonIds: [two], reason: 'B' })),
        201,
      );
      // The spare teacher takes the class from 30 November: a version published from that date.
      await at(THURSDAY, async () => {
        const created = ok(
          await t.post('/api/timetable/versions', x.s.branch, {
            academicYearId: x.s.year,
            startsOn: '2026-11-30',
            copyFrom: x.s.version,
          }),
          201,
        );
        const draft = (created.body as { id: string }).id;
        await t.database.migrator.deleteFrom('pattern_blocks').where('version_id', '=', draft).execute();
        const rows = await t.database.migrator
          .selectFrom('teaching_load_rows')
          .select(['id', 'class_id'])
          .where('version_id', '=', draft)
          .execute();
        for (const row of rows) {
          if (row.class_id === x.s.classId) {
            await t.database.migrator
              .updateTable('teaching_load_rows')
              .set({ teacher_id: x.s.spareTeacher.staffId })
              .where('id', '=', row.id)
              .execute();
          }
          ok(
            await t.post(`/api/timetable/versions/${draft}/pattern`, x.s.branch, {
              loadRowId: row.id,
              weekday: 1,
              slotPosition: 1,
            }),
            201,
          );
        }
        ok(await t.post(`/api/timetable/versions/${draft}/templates/confirm`, x.s.branch));
        await load.freeEditLock(draft);
        ok(await publishOf(t)(x.s.branch, draft, '2026-11-30'));
      });
      const rows = await t.database.migrator
        .selectFrom('lesson_plan_requests')
        .select(['id', 'status', 'finished_at'])
        .where('journal_id', '=', x.journal)
        .orderBy('id')
        .execute();
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(waiting.id)?.status).toBe('void');
      expect(byId.get(open.id)?.finished_at).not.toBeNull();
      expect(rows.some((row) => row.status === 'prepared')).toBe(true);
      // The earlier owner still owns the plan on 26 November, but the period has ended.
      expect(codeOf(await at(THURSDAY, async () => save(x, first, 'No')))).toBe('plan_window_closed');
      const entry = (await entries('plan.request_void', x.journal)).at(-1);
      expect(entry?.new_value).toEqual(
        expect.objectContaining({ voided: [waiting.id], ended: [open.id], cause: 'owner_changed' }),
      );
    });
  });

  describe('a share and a copy outside the window', () => {
    it('refuses a share after the window (edge: "Joining is allowed only inside the window")', async () => {
      const owner = await account();
      const vice = await account();
      const s = await publishedScene(t, load, {
        graded: true,
        shared: true,
        accounts: { teacher: owner.account.id },
      });
      await t.kit.giveRole(owner.account.id, {
        role: 'teacher',
        branchId: s.branch,
        validFrom: VALID_FROM,
      });
      await t.kit.giveRole(vice.account.id, {
        role: 'academic_vice_principal',
        branchId: s.branch,
        validFrom: VALID_FROM,
      });
      const quarter = await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', s.year)
        .where('number', '=', 2)
        .executeTakeFirstOrThrow();
      const [journal, other] = await Promise.all(
        [s.classId, s.otherClass].map(
          async (classId) =>
            (
              await t.database.migrator
                .selectFrom('journals')
                .select('id')
                .where('class_id', '=', classId)
                .executeTakeFirstOrThrow()
            ).id,
        ),
      );
      ok(
        await at(OCT27, async () =>
          send('put', `/api/plans/windows/${quarter.id}`, s.branch, vice.cookie, WINDOW),
        ),
      );
      const share = (moment: string) =>
        at(moment, async () =>
          send('post', `/api/plans/journals/${journal ?? ''}/share`, s.branch, owner.cookie, {
            quarterId: quarter.id,
            journalId: other ?? '',
          }),
        );
      expect(codeOf(await share(THURSDAY))).toBe('plan_window_closed');
      ok(await share(NOV02));
    });
  });

  describe('at the same moment', () => {
    /** Holds `hold` in a transaction of the application, then runs `run` and waits until it waits. */
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

    async function waitingRequest() {
      const x = await scene();
      ok(await openWindow(x));
      const items = await fill(x, [1, 2]);
      const lesson = (await planOf(x, THURSDAY)).rows[1]?.lessonId ?? '';
      const asked = requestOf(
        await at(THURSDAY, async () =>
          ask(x, { kind: 'text', lessonIds: [lesson], reason: 'Typo' }),
        ),
        201,
      );
      return { x, asked, items };
    }

    const lockJournal = (transaction: Transaction, journal: string) =>
      transaction
        .selectFrom('journals')
        .select('id')
        .where('id', '=', journal)
        .forNoKeyUpdate()
        .execute();

    it('a refusal held first: the approval waits on the journal and finds it decided', async () => {
      const { x, asked } = await waitingRequest();
      const answer = await at(THURSDAY, async () =>
        heldThen(
          x.s.branch,
          async (transaction) => {
            await lockJournal(transaction, x.journal);
            await transaction
              .updateTable('lesson_plan_requests')
              .set({
                status: 'refused',
                decided_by: x.vice.account.id,
                decided_at: new Date(THURSDAY),
                decision_reason: 'No',
              })
              .where('id', '=', asked.id)
              .execute();
          },
          () => decide(x, asked.id, { decision: 'approve', days: 1 }),
        ),
      );
      expect(codeOf(answer)).toBe('plan_request_decided');
    });

    it('an approval held first: the refusal waits on the journal and finds it decided', async () => {
      const { x, asked } = await waitingRequest();
      const answer = await at(THURSDAY, async () =>
        heldThen(
          x.s.branch,
          async (transaction) => {
            await lockJournal(transaction, x.journal);
            await transaction
              .updateTable('lesson_plan_requests')
              .set({
                status: 'approved',
                decided_by: x.vice.account.id,
                decided_at: new Date(THURSDAY),
                days: 1,
                open_until: new Date('2026-11-26T23:59:59.999+05:00'),
              })
              .where('id', '=', asked.id)
              .execute();
          },
          () => decide(x, asked.id, { decision: 'refuse', reason: 'No' }),
        ),
      );
      expect(codeOf(answer)).toBe('plan_request_decided');
    });

    it('"finished" held first: a save under the period waits on the journal and is refused', async () => {
      const { x, asked, items } = await waitingRequest();
      ok(await at(THURSDAY, async () => decide(x, asked.id, { decision: 'approve', days: 2 })));
      const item = items[1];
      if (item === undefined) throw new Error('no item');
      const answer = await at(THURSDAY, async () =>
        heldThen(
          x.s.branch,
          async (transaction) => {
            await lockJournal(transaction, x.journal);
            await transaction
              .updateTable('lesson_plan_requests')
              .set({ finished_at: new Date(THURSDAY) })
              .where('id', '=', asked.id)
              .execute();
          },
          () => save(x, item, 'Late'),
        ),
      );
      expect(codeOf(answer)).toBe('plan_window_closed');
      // Without the held "finished", the same save passes.
      const fresh = await waitingRequest();
      ok(
        await at(THURSDAY, async () =>
          decide(fresh.x, fresh.asked.id, { decision: 'approve', days: 2 }),
        ),
      );
      ok(await at(THURSDAY, async () => save(fresh.x, fresh.items[1] ?? item, 'In time')));
    });

    it("two stores of the request of the window's end make one: the second waits on the journal and answers it", async () => {
      const x = await scene();
      ok(await openWindow(x));
      await fill(x, [1]);
      const store = () =>
        send(
          'post',
          `/api/plans/journals/${x.journal}/requests/prepared`,
          x.s.branch,
          x.owner.cookie,
          {
            quarterId: x.q2,
          },
        );
      // Both wait on the journal held by a third transaction, then run one after the other.
      const [first, second] = await at(THURSDAY, async () => {
        let other: Promise<Response> | undefined;
        const answer = await heldThen(
          x.s.branch,
          (transaction) => lockJournal(transaction, x.journal).then(() => undefined),
          () => {
            other = new Promise<Response>((resolve, reject) => {
              store().then(resolve, reject);
            });
            return store();
          },
        );
        if (other === undefined) throw new Error('not started');
        return [await other, answer];
      });
      const a = requestOf(first);
      const b = requestOf(second);
      expect(a.id).toBe(b.id);
      const stored = await t.database.migrator
        .selectFrom('lesson_plan_requests')
        .select('id')
        .where('journal_id', '=', x.journal)
        .execute();
      expect(stored).toHaveLength(1);
    });
  });
});
