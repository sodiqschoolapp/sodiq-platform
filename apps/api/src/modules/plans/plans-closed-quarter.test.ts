import { randomUUID } from 'node:crypto';
import {
  apiErrorSchema,
  BRANCH_HEADER,
  planEventDecidedSchema,
  planItemSchema,
  planRequestSchema,
  type PlanItem,
} from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeQuarter } from '../../testing/closing-kit.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { openPlanWindows } from '../../testing/plan-windows-kit.js';
import { publishedScene, QUARTERS } from '../../testing/published-scene.js';
import { MemoryPhotoStore } from '../people/photo-store.js';

/**
 * Monday 12 October 2026, 07:00 in Tashkent: the timetable runs from today (the owner owns the
 * journal), and no lesson of quarter 1 has started (its rows are open to the plan).
 */
const BEFORE_LESSONS = '2026-10-12T07:00:00+05:00';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);

const codeOf = (response: Response) => apiErrorSchema.parse(response.body).error.code;

const ok = (response: Response, status = 200) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response;
};

const refused = (response: Response, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(409);
  expect(codeOf(response)).toBe(code);
};

const values = (topic: string) => ({
  topic,
  objectives: '',
  links: [],
  classworks: [],
  homeworks: [],
});

// All names are invented. Task 9.2b (From 7.1a, pull request #212, spec review of the plan,
// should-fix 6): docs/spec/edge-cases/lesson-plans.md, Plans and the journal: "Nothing is
// possible in a closed quarter." Every write of a plan of a closed quarter is refused
// `plan_quarter_closed` (`PlansService.writeSceneOf`, the deciders of `plan-requests.service.ts`
// and the window of `plan-windows.service.ts`), as a closed year refuses `plan_year_closed`
// ("refuses an attendance-only journal and a closed year", plans.test.ts). The close itself
// voids the waiting requests (closing.test.ts); here the closing row is written as the close
// writes it, so a request sent before the close is still waiting.
describe('the plans of a closed quarter', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;
  const store = new MemoryPhotoStore();

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true, photoStore: store });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Dilnoza', `Rahimova${'a'.repeat(names % 7)}`);
  };

  const VALID_FROM = new Date('2026-09-01T00:00:00+05:00');

  /** Runs `work` with the clock and every session at `moment`, then sets them back. */
  async function at<T>(moment: string, work: () => Promise<T>): Promise<T> {
    const fresh = (when: string) =>
      t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(when), last_used_at: new Date(when) })
        .execute();
    t.clock.set(moment);
    await fresh(moment);
    try {
      return await work();
    } finally {
      t.clock.set(START);
      await fresh(START);
    }
  }

  const call = (
    method: 'post' | 'put' | 'delete',
    path: string,
    branch: string,
    cookie: string,
    body?: object,
  ) => {
    const sent = request(t.kit.server)
      [method](path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch);
    return body === undefined ? sent : sent.send(body);
  };

  /** A graded scene: its owner, the Head Teacher of the subject and the Academic Vice Principal. */
  async function scene(input: { windows: boolean }) {
    const owner = await account();
    const head = await account();
    const vice = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id },
    });
    await t.kit.giveRole(owner.account.id, {
      role: 'teacher',
      branchId: s.branch,
      validFrom: VALID_FROM,
    });
    await t.kit.giveRole(head.account.id, {
      role: 'head_teacher',
      branchId: s.branch,
      subjectIds: [s.subject],
      validFrom: VALID_FROM,
    });
    await t.kit.giveRole(vice.account.id, {
      role: 'academic_vice_principal',
      branchId: s.branch,
      validFrom: VALID_FROM,
    });
    if (input.windows) await openPlanWindows(t.database.migrator, s.branch, s.year);
    const journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.classId)
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
    /** The class's lessons of a quarter, in order: the rows of its plan. */
    const lessonsOf = async ([from, to]: readonly [string, string]) =>
      (
        await t.database.migrator
          .selectFrom('lessons')
          .select('id')
          .where('class_id', '=', s.classId)
          .where('subject_id', '=', s.subject)
          .where('lesson_date', '>=', from)
          .where('lesson_date', '<=', to)
          .orderBy('starts_at')
          .execute()
      ).map((one) => one.id);
    return {
      s,
      owner,
      head,
      vice,
      journal,
      q1: quarters[0] ?? '',
      q2: quarters[1] ?? '',
      q1Lessons: await lessonsOf(QUARTERS[0]),
      q2Lessons: await lessonsOf(QUARTERS[1]),
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  const create = (x: Scene, quarterId: string, position: number, lessonId: string) =>
    call('post', `/api/plans/journals/${x.journal}/items`, x.s.branch, x.owner.cookie, {
      quarterId,
      position,
      lessonId,
      values: values(`Topic ${String(position)}`),
    });

  const close = (x: Scene) =>
    closeQuarter(t.database, {
      branchId: x.s.branch,
      quarterId: x.q1,
      accountId: x.vice.account.id,
    });

  /** Every row the plan routes write in one branch, and the audit log's ids. */
  const rowsOf = async (branch: string) => {
    const found: Record<string, unknown[]> = {};
    for (const table of [
      'lesson_plans',
      'lesson_plan_journals',
      'lesson_plan_items',
      'lesson_plan_places',
      'lesson_plan_works',
      'lesson_plan_files',
      'lesson_plan_windows',
      'lesson_plan_window_extensions',
      'lesson_plan_requests',
      'lesson_plan_request_lessons',
      'notifications',
    ] as const) {
      found[table] = (
        await t.database.migrator
          .selectFrom(table)
          .selectAll()
          .where('branch_id', '=', branch)
          .execute()
      )
        .map((row) => JSON.stringify(row))
        .sort();
    }
    found.audit = (
      await t.database.migrator
        .selectFrom('audit_log')
        .select('id')
        .where('branch_id', '=', branch)
        .execute()
    )
      .map((row) => row.id)
      .sort();
    return found;
  };

  it('refuses an item create, save, file and clear in a closed quarter, and takes a write of the next quarter', async () => {
    const x = await scene({ windows: true });
    const item: PlanItem = await at(BEFORE_LESSONS, async () =>
      planItemSchema.parse(ok(await create(x, x.q1, 1, x.q1Lessons[0] ?? ''), 201).body),
    );
    await close(x);
    const before = await rowsOf(x.s.branch);
    const keys = store.keys().length;
    await at(BEFORE_LESSONS, async () => {
      refused(await create(x, x.q1, 2, x.q1Lessons[1] ?? ''), 'plan_quarter_closed');
      refused(
        await call('put', `/api/plans/items/${item.id}`, x.s.branch, x.owner.cookie, {
          base: {
            topic: item.topic,
            objectives: item.objectives,
            links: item.links,
            classworks: item.classworks,
            homeworks: item.homeworks,
          },
          values: values('Changed'),
        }),
        'plan_quarter_closed',
      );
      refused(
        await request(t.kit.server)
          .put(`/api/plans/items/${item.id}/files?name=Sheet.pdf`)
          .set('Cookie', x.owner.cookie)
          .set(BRANCH_HEADER, x.s.branch)
          .set('Content-Type', 'application/pdf')
          .send(PDF),
        'plan_quarter_closed',
      );
      refused(
        await call('post', `/api/plans/items/${item.id}/clear`, x.s.branch, x.owner.cookie, {}),
        'plan_quarter_closed',
      );
    });
    expect(await rowsOf(x.s.branch)).toEqual(before);
    // The file's bytes are never stored: the scene refuses before them.
    expect(store.keys()).toHaveLength(keys);
    // The next quarter is open: its plan is written.
    await at(BEFORE_LESSONS, async () => {
      ok(await create(x, x.q2, 1, x.q2Lessons[0] ?? ''), 201);
    });
  });

  it('refuses a request and a window in a closed quarter, and the decision of a request sent before the close', async () => {
    // No window: the owner asks (`edge`, review decision 13: "only while the owner's window is not open").
    const x = await scene({ windows: false });
    const asked = await at(BEFORE_LESSONS, async () =>
      planRequestSchema.parse(
        ok(
          await call(
            'post',
            `/api/plans/journals/${x.journal}/requests`,
            x.s.branch,
            x.owner.cookie,
            {
              quarterId: x.q1,
              kind: 'text',
              lessonIds: [x.q1Lessons[0] ?? ''],
              reason: 'Typo',
            },
          ),
          201,
        ).body,
      ),
    );
    expect(asked.status).toBe('sent');
    await close(x);
    const before = await rowsOf(x.s.branch);
    await at(BEFORE_LESSONS, async () => {
      for (const body of [
        { kind: 'text', lessonIds: [x.q1Lessons[1] ?? ''], reason: 'Typo' },
        { kind: 'replan', fromLessonId: x.q1Lessons[1] ?? '', reason: 'Merge' },
      ]) {
        refused(
          await call(
            'post',
            `/api/plans/journals/${x.journal}/requests`,
            x.s.branch,
            x.owner.cookie,
            {
              quarterId: x.q1,
              ...body,
            },
          ),
          'plan_quarter_closed',
        );
      }
      // The Head Teacher of the subject decides it in an open quarter; here neither way.
      for (const body of [
        { decision: 'approve', days: 2 },
        { decision: 'refuse', reason: 'No' },
      ]) {
        refused(
          await call(
            'post',
            `/api/plans/requests/${asked.id}/decide`,
            x.s.branch,
            x.head.cookie,
            body,
          ),
          'plan_quarter_closed',
        );
      }
      // The window of the closed quarter is not opened (its extension: the test below).
      refused(
        await call('put', `/api/plans/windows/${x.q1}`, x.s.branch, x.vice.cookie, {
          startDate: '2026-10-12',
          endDate: '2026-10-20',
          confirm: true,
        }),
        'plan_quarter_closed',
      );
    });
    expect(await rowsOf(x.s.branch)).toEqual(before);
    // The next quarter is open: a request of it is taken.
    await at(BEFORE_LESSONS, async () => {
      ok(
        await call(
          'post',
          `/api/plans/journals/${x.journal}/requests`,
          x.s.branch,
          x.owner.cookie,
          {
            quarterId: x.q2,
            kind: 'text',
            lessonIds: [x.q2Lessons[0] ?? randomUUID()],
            reason: 'Typo',
          },
        ),
        201,
      );
    });
  });

  it("answers the extension of a closed quarter's window 404 for an unknown or another branch's person and 403 for one's own before refusing it", async () => {
    // Permission review M1: the 404 and the own-request refusal come before the closed quarter.
    const x = await scene({ windows: true });
    const y = await scene({ windows: false });
    // The owner is an Academic Vice Principal too: their own window is theirs to ask for.
    await t.kit.giveRole(x.owner.account.id, {
      role: 'academic_vice_principal',
      branchId: x.s.branch,
      validFrom: VALID_FROM,
    });
    // The windows end on 20 October and 20 November: an extension to a later day of the quarter
    // passes every check but the closed quarter.
    for (const [quarterId, endDate] of [
      [x.q1, '2026-10-20'],
      [x.q2, '2026-11-20'],
    ] as const) {
      await t.database.migrator
        .updateTable('lesson_plan_windows')
        .set({ end_date: endDate, ends_at: new Date(`${endDate}T23:59:59.999+05:00`) })
        .where('quarter_id', '=', quarterId)
        .execute();
    }
    await close(x);
    const before = [await rowsOf(x.s.branch), await rowsOf(y.s.branch)];
    const extend = (quarterId: string, cookie: string, staffId: string, endDate: string) =>
      call('post', `/api/plans/windows/${quarterId}/extensions`, x.s.branch, cookie, {
        staffId,
        endDate,
      });
    await at(BEFORE_LESSONS, async () => {
      for (const staffId of [randomUUID(), y.s.teacher.staffId]) {
        const answer = await extend(x.q1, x.vice.cookie, staffId, '2026-10-27');
        expect(answer.status, JSON.stringify(answer.body)).toBe(404);
      }
      const own = await extend(x.q1, x.owner.cookie, x.s.teacher.staffId, '2026-10-27');
      expect(own.status, JSON.stringify(own.body)).toBe(403);
      expect(codeOf(own)).toBe('own_request');
      refused(
        await extend(x.q1, x.vice.cookie, x.s.teacher.staffId, '2026-10-27'),
        'plan_quarter_closed',
      );
    });
    expect(await rowsOf(x.s.branch)).toEqual(before[0]);
    expect(await rowsOf(y.s.branch)).toEqual(before[1]);
    // The next quarter is open: the same extension of its window is given.
    await at(BEFORE_LESSONS, async () => {
      ok(await extend(x.q2, x.vice.cookie, x.s.teacher.staffId, '2026-11-27'));
    });
    const given = await t.database.migrator
      .selectFrom('lesson_plan_window_extensions')
      .select('end_date')
      .where('branch_id', '=', x.s.branch)
      .where('staff_id', '=', x.s.teacher.staffId)
      .execute();
    expect(given).toHaveLength(1);
  });

  it("skips a closed quarter's request in a decision by event, and refuses a Head Teacher of another subject by scope", async () => {
    const x = await scene({ windows: false });
    const asked = await at(BEFORE_LESSONS, async () =>
      planRequestSchema.parse(
        ok(
          await call(
            'post',
            `/api/plans/journals/${x.journal}/requests`,
            x.s.branch,
            x.owner.cookie,
            { quarterId: x.q1, kind: 'text', lessonIds: [x.q1Lessons[0] ?? ''], reason: 'Typo' },
          ),
          201,
        ).body,
      ),
    );
    // An event names the request (as the follow of a timetable change writes it), before the close.
    const eventId = randomUUID();
    await t.database.migrator
      .insertInto('lesson_plan_request_causes')
      .values({
        branch_id: x.s.branch,
        request_id: asked.id,
        kind: 'not_covered',
        on_date: '2026-10-19',
        items: 1,
        staff_id: null,
        at: new Date(BEFORE_LESSONS),
        event_id: eventId,
      })
      .execute();
    const other = await account();
    const otherSubject = await load.classes.subject({ grades: [7], journalType: 'graded' });
    await t.kit.giveRole(other.account.id, {
      role: 'head_teacher',
      branchId: x.s.branch,
      subjectIds: [otherSubject],
      validFrom: VALID_FROM,
    });
    await close(x);
    const before = await rowsOf(x.s.branch);
    await at(BEFORE_LESSONS, async () => {
      // `edge/lesson-plans`: "Nothing is possible in a closed quarter": counted as skipped.
      const answer = await call(
        'post',
        '/api/plans/requests/decide-event',
        x.s.branch,
        x.head.cookie,
        {
          eventId,
          days: 2,
        },
      );
      expect(planEventDecidedSchema.parse(ok(answer).body)).toEqual({
        approved: [],
        skipped: [asked.id],
        others: 0,
      });
      // Permission review S1: the scope is refused before the closed quarter.
      for (const body of [
        { decision: 'approve', days: 2 },
        { decision: 'refuse', reason: 'No' },
      ]) {
        const scoped = await call(
          'post',
          `/api/plans/requests/${asked.id}/decide`,
          x.s.branch,
          other.cookie,
          body,
        );
        expect(scoped.status, JSON.stringify(scoped.body)).toBe(403);
        expect(codeOf(scoped)).toBe('plan_scope');
      }
    });
    expect(await rowsOf(x.s.branch)).toEqual(before);
    const stored = await t.database.migrator
      .selectFrom('lesson_plan_requests')
      .select('status')
      .where('id', '=', asked.id)
      .executeTakeFirstOrThrow();
    expect(stored.status).toBe('sent');
  });
});
