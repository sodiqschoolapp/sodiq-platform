import { randomUUID } from 'node:crypto';
import {
  apiErrorSchema,
  BRANCH_HEADER,
  planEventDecidedSchema,
  planItemSchema,
  planListSchema,
  planMasterSchema,
  planMastersSchema,
  planProgressSchema,
  planRequestSchema,
  planRequestsReportSchema,
  planRequestsSchema,
  planSchema,
  planWindowsSchema,
  REQUEST_KEY_HEADER,
  type Plan,
  type PlanItem,
  type PlanMaster,
} from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { linesOf } from '../../testing/pdf-kit.js';
import { publishedScene } from '../../testing/published-scene.js';
import { binary } from '../../testing/xlsx-kit.js';
import { MemoryPhotoStore } from '../people/photo-store.js';

// All names are invented. Task 10.3a, pull request #241: the limits inside the plan routes
// that a test did not yet prove for every scoped role (`route-scopes/plans.ts`).
// docs/spec/02-roles-and-access.md: the Head Teacher "Views journals and lesson plans of
// those subjects ... Approves ... requests to edit a lesson plan after the window, for those
// subjects. Keeps master plans"; the Senior Head Teacher "Everything a Head Teacher can do,
// for the subjects given to them, in every branch"; "Who approves". docs/spec/edge-cases/
// lesson-plans.md, "Who may read a plan?". Each reader holds its role in the branch of the
// request, so a refusal is the route's own scope check, not the guard's.

/** Tuesday 27 October 2026, noon: the window of quarter 2 is opened. */
const OCT27 = '2026-10-27T12:00:00+05:00';
/** Monday 2 November 2026, noon: inside the window (28 October to 10 November). */
const NOV02 = '2026-11-02T12:00:00+05:00';
/** Thursday 26 November 2026, noon: after the window; the Mondays 9, 16 and 23 November are held. */
const THURSDAY = '2026-11-26T12:00:00+05:00';

const WINDOW = { startDate: '2026-10-28', endDate: '2026-11-10', confirm: true };

const VALID_FROM = new Date('2026-09-01T00:00:00+05:00');

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);

const ok = (response: Response, status = 200) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response;
};

const codeOf = (response: Response) => apiErrorSchema.parse(response.body).error.code;

const refused = (response: Response, code = 'plan_scope') => {
  expect(response.status, JSON.stringify(response.body)).toBe(403);
  expect(codeOf(response)).toBe(code);
};

const values = (topic: string) => ({
  topic,
  objectives: '',
  links: [],
  classworks: [],
  homeworks: [],
});

describe('the limits inside the plan routes (task 10.3a)', () => {
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
    return t.kit.completeSession('Malika', `Tursunova${'a'.repeat(names % 7)}`);
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

  /**
   * A graded scene of grade 7: the owner and a spare teacher of the subject, its Head
   * Teacher and Senior Head Teacher, the Academic Vice Principal; the window of quarter 2
   * opened, and the eight rows of quarter 2 filled inside it.
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
    await t.kit.giveRole(head.account.id, {
      role: 'head_teacher',
      branchId: s.branch,
      subjectIds: [s.subject],
      validFrom: VALID_FROM,
    });
    await t.kit.giveRole(senior.account.id, {
      role: 'senior_head_teacher',
      subjectIds: [s.subject],
      validFrom: VALID_FROM,
    });
    await t.kit.giveRole(vice.account.id, {
      role: 'academic_vice_principal',
      branchId: s.branch,
      validFrom: VALID_FROM,
    });
    const journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('subject_id', '=', s.subject)
        .executeTakeFirstOrThrow()
    ).id;
    const quarters = await t.database.migrator
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', s.year)
      .orderBy('number')
      .execute();
    const q2 = quarters[1]?.id ?? '';
    ok(
      await at(OCT27, async () =>
        send('put', `/api/plans/windows/${q2}`, s.branch, vice.cookie, WINDOW),
      ),
    );
    const x = { s, owner, spare, head, senior, vice, journal, q2 };
    const plan = await planOf(x, NOV02);
    const items: PlanItem[] = [];
    await at(NOV02, async () => {
      for (const row of plan.rows) {
        items.push(
          planItemSchema.parse(
            ok(
              await send('post', `/api/plans/journals/${journal}/items`, s.branch, owner.cookie, {
                quarterId: q2,
                position: row.number,
                lessonId: row.lessonId,
                values: values(`Topic ${String(row.number)}`),
              }),
              201,
            ).body,
          ),
        );
      }
    });
    expect(items).toHaveLength(8);
    return { ...x, plan, items };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  function planOf(
    x: Pick<Scene, 's' | 'owner' | 'journal' | 'q2'>,
    moment: string,
    browser: Browser = x.owner,
  ): Promise<Plan> {
    return at(moment, async () =>
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
  }

  /** A Head Teacher and a Senior Head Teacher of another subject, each in the branch of the scene. */
  async function outsiders(x: Scene, input: { profile?: boolean } = {}) {
    const make = async (role: 'head_teacher' | 'senior_head_teacher') => {
      const browser = await account();
      const otherSubject = await load.classes.subject({ grades: [7], journalType: 'graded' });
      if (input.profile === true) {
        // A teacher of the branch with the scene's subject and grade in the profile: reads its
        // plans by the profile, so the report's own subject limit is what keeps them out.
        await load.teacher(x.s.branch, {
          subjects: [{ subject: x.s.subject, grades: [7] }],
          accountId: browser.account.id,
        });
        await t.kit.giveRole(browser.account.id, {
          role: 'teacher',
          branchId: x.s.branch,
          validFrom: VALID_FROM,
        });
      }
      await t.kit.giveRole(browser.account.id, {
        role,
        ...(role === 'head_teacher' ? { branchId: x.s.branch } : {}),
        subjectIds: [otherSubject],
        validFrom: VALID_FROM,
      });
      return browser;
    };
    return { head: await make('head_teacher'), senior: await make('senior_head_teacher') };
  }

  /** Every row of the tables the plan routes write, in the scene's branch (and the masters of all branches). */
  const rowsOf = async (branch: string) => {
    const found: Record<string, unknown[]> = {};
    for (const table of [
      'lesson_plans',
      'lesson_plan_journals',
      'lesson_plan_items',
      'lesson_plan_works',
      'lesson_plan_places',
      'lesson_plan_files',
      'lesson_plan_outcomes',
      'lesson_plan_requests',
      'lesson_plan_request_lessons',
      'lesson_plan_request_causes',
      'notifications',
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
    )
      .map((row) => row.id)
      .sort();
    return found;
  };

  /** A Text request for row 2, sent by the owner after the window. */
  const askOf = (x: Scene) =>
    at(THURSDAY, async () =>
      planRequestSchema.parse(
        ok(
          await send(
            'post',
            `/api/plans/journals/${x.journal}/requests`,
            x.s.branch,
            x.owner.cookie,
            {
              quarterId: x.q2,
              kind: 'text',
              lessonIds: [x.plan.rows[1]?.lessonId ?? ''],
              reason: 'Typo',
            },
          ),
          201,
        ).body,
      ),
    );

  it('refuses a Head Teacher and a Senior Head Teacher of another subject the plan list, the item of a lesson, a plan file and the plan export, logging nothing', async () => {
    const x = await scene();
    const first = x.items[0];
    const lessonId = x.plan.rows[0]?.lessonId ?? '';
    if (first === undefined) throw new Error('An item at row 1.');
    const file = await at(NOV02, async () =>
      ok(
        await request(t.kit.server)
          .put(`/api/plans/items/${first.id}/files?name=Sheet.pdf`)
          .set('Cookie', x.owner.cookie)
          .set(BRANCH_HEADER, x.s.branch)
          .set('Content-Type', 'application/pdf')
          .send(PDF),
      ),
    );
    const fileId = (file.body as { id: string }).id;
    const other = await outsiders(x);
    const exportOf = (browser: Browser) =>
      send('post', `/api/plans/journals/${x.journal}/export`, x.s.branch, browser.cookie, {
        quarterId: x.q2,
        format: 'xlsx',
      });
    // The readers of the subject read each of them: the fixture can be refused only by scope.
    await at(NOV02, async () => {
      for (const browser of [x.head, x.senior]) {
        const list = planListSchema.parse(
          ok(await send('get', '/api/plans', x.s.branch, browser.cookie)).body,
        );
        expect(list.plans.map((one) => one.journalId)).toContain(x.journal);
        ok(await send('get', `/api/plans/lessons/${lessonId}`, x.s.branch, browser.cookie));
        ok(await send('get', `/api/plans/files/${fileId}`, x.s.branch, browser.cookie));
      }
    });
    const before = await rowsOf(x.s.branch);
    await at(NOV02, async () => {
      for (const browser of [other.head, other.senior]) {
        const list = planListSchema.parse(
          ok(await send('get', '/api/plans', x.s.branch, browser.cookie)).body,
        );
        expect(list.plans).toEqual([]);
        refused(await send('get', `/api/plans/lessons/${lessonId}`, x.s.branch, browser.cookie));
        refused(await send('get', `/api/plans/files/${fileId}`, x.s.branch, browser.cookie));
        refused(await exportOf(browser));
      }
    });
    expect(await rowsOf(x.s.branch)).toEqual(before);
  });

  it('gives a Head Teacher and a Senior Head Teacher of another subject who read the plan by the profile none of its progress, its requests or its report files', async () => {
    const x = await scene();
    const asked = await askOf(x);
    const other = await outsiders(x, { profile: true });
    const subject = await t.database.migrator
      .selectFrom('subjects')
      .select('name_en')
      .where('id', '=', x.s.subject)
      .executeTakeFirstOrThrow();
    const reportsOf = async (browser: Browser) => {
      const progress = planProgressSchema.parse(
        ok(
          await send(
            'get',
            `/api/plans/reports/progress?quarterId=${x.q2}`,
            x.s.branch,
            browser.cookie,
          ),
        ).body,
      );
      const requests = planRequestsReportSchema.parse(
        ok(
          await send(
            'get',
            `/api/plans/reports/requests?quarterId=${x.q2}`,
            x.s.branch,
            browser.cookie,
          ),
        ).body,
      );
      const files: string[] = [];
      for (const report of ['completeness', 'progress', 'requests']) {
        const file = await request(t.kit.server)
          .post('/api/plans/reports/export')
          .set('Cookie', browser.cookie)
          .set(BRANCH_HEADER, x.s.branch)
          .buffer(true)
          .parse(binary)
          .send({ report, quarterId: x.q2 });
        expect(file.status, report).toBe(200);
        const { lines } = await linesOf(file.body as Buffer);
        files.push(JSON.stringify(lines.map((line) => line.values)));
      }
      return {
        journals: progress.plans.map((one) => one.journalId),
        otherSubjects: progress.otherSubjects,
        requests: requests.teachers.flatMap((one) => one.requests.map((sent) => sent.id)),
        files,
      };
    };
    await at(THURSDAY, async () => {
      // The Head Teacher of the subject reads all of it: the fixture is seen where it is in scope.
      const own = await reportsOf(x.head);
      expect(own.journals).toContain(x.journal);
      expect(own.requests).toEqual([asked.id]);
      expect(own.files.every((text) => text.includes(subject.name_en))).toBe(true);
      for (const browser of [other.head, other.senior]) {
        // The reader reads the plan itself by the profile (a Teacher of the branch).
        ok(
          await send(
            'get',
            `/api/plans/journals/${x.journal}?quarterId=${x.q2}`,
            x.s.branch,
            browser.cookie,
          ),
        );
        const theirs = await reportsOf(browser);
        expect(theirs.journals).not.toContain(x.journal);
        expect(theirs.otherSubjects).toBeGreaterThanOrEqual(2);
        expect(theirs.requests).toEqual([]);
        for (const text of theirs.files) expect(text).not.toContain(subject.name_en);
      }
    });
  });

  it('shows a teacher who does not own the plan none of its requests under "mine", and a Senior Head Teacher of another subject none under "deciding"', async () => {
    const x = await scene();
    const asked = await askOf(x);
    const other = await outsiders(x);
    const list = (browser: Browser, view: 'mine' | 'deciding') =>
      at(THURSDAY, async () =>
        planRequestsSchema
          .parse(
            ok(await send('get', `/api/plans/requests?view=${view}`, x.s.branch, browser.cookie))
              .body,
          )
          .requests.map((one) => one.id),
      );
    expect(await list(x.owner, 'mine')).toEqual([asked.id]);
    expect(await list(x.senior, 'deciding')).toEqual([asked.id]);
    // The spare teacher reads the plan by the profile, and does not own it.
    ok(
      await at(THURSDAY, async () =>
        send(
          'get',
          `/api/plans/journals/${x.journal}?quarterId=${x.q2}`,
          x.s.branch,
          x.spare.cookie,
        ),
      ),
    );
    expect(await list(x.spare, 'mine')).toEqual([]);
    expect(await list(other.senior, 'deciding')).toEqual([]);
  });

  it('refuses a Head Teacher and a Senior Head Teacher of another subject the decision of a request, of the prepared request, by event and the drop of a not-covered item, changing nothing', async () => {
    const x = await scene();
    const asked = await askOf(x);
    // A future lesson cancelled after the window: "Topic 8" is not covered and the follow
    // prepares a request whose cause names the event.
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
    const last = plan.notCovered[0];
    const preparedId = plan.request?.id ?? null;
    if (last === undefined || preparedId === null)
      throw new Error('A not-covered item and a request.');
    const cause = await t.database.migrator
      .selectFrom('lesson_plan_request_causes')
      .select('event_id')
      .where('request_id', '=', preparedId)
      .executeTakeFirstOrThrow();
    const other = await outsiders(x);
    const before = await rowsOf(x.s.branch);
    await at(THURSDAY, async () => {
      for (const browser of [other.head, other.senior]) {
        refused(
          await send('post', `/api/plans/requests/${asked.id}/decide`, x.s.branch, browser.cookie, {
            decision: 'approve',
            days: 1,
          }),
        );
        refused(
          await send(
            'post',
            `/api/plans/journals/${x.journal}/requests/prepared/decide`,
            x.s.branch,
            browser.cookie,
            { quarterId: x.q2, decision: { decision: 'approve', days: 1 } },
          ),
        );
        // A request the reader does not oversee is counted, never named, never decided.
        expect(
          planEventDecidedSchema.parse(
            ok(
              await send('post', '/api/plans/requests/decide-event', x.s.branch, browser.cookie, {
                eventId: cause.event_id,
                days: 1,
              }),
            ).body,
          ),
        ).toEqual({ approved: [], skipped: [], others: 1 });
        refused(
          await send(
            'post',
            `/api/plans/journals/${x.journal}/not-covered/${last.id}/drop`,
            x.s.branch,
            browser.cookie,
            { quarterId: x.q2, reason: 'Covered by the excursion' },
          ),
        );
      }
    });
    expect(await rowsOf(x.s.branch)).toEqual(before);
    // The Senior Head Teacher of the subject decides by the event and drops: the fixture holds.
    await at(THURSDAY, async () => {
      expect(
        planEventDecidedSchema.parse(
          ok(
            await send('post', '/api/plans/requests/decide-event', x.s.branch, x.senior.cookie, {
              eventId: cause.event_id,
              days: 1,
            }),
          ).body,
        ).approved,
      ).toEqual([preparedId]);
      ok(
        await send(
          'post',
          `/api/plans/journals/${x.journal}/not-covered/${last.id}/drop`,
          x.s.branch,
          x.senior.cookie,
          { quarterId: x.q2, reason: 'Covered by the excursion' },
        ),
      );
    });
  });

  it('refuses a Head Teacher and a Senior Head Teacher of another subject a master, the masters list, a new master of the subject, the comparison and the parallel classes', async () => {
    const x = await scene();
    const created = await at(NOV02, async () =>
      send('post', '/api/plans/masters', x.s.branch, x.head.cookie, {
        yearId: x.s.year,
        quarter: 2,
        subjectId: x.s.subject,
        grade: 7,
        language: 'uz',
        name: 'Core',
        scope: 'branch',
      }),
    );
    const master: PlanMaster = planMasterSchema.parse(ok(created, 201).body);
    const other = await outsiders(x);
    const reads = (browser: Browser) => ({
      list: () => send('get', `/api/plans/masters?yearId=${x.s.year}`, x.s.branch, browser.cookie),
      one: () => send('get', `/api/plans/masters/${master.id}`, x.s.branch, browser.cookie),
      compare: () =>
        send(
          'get',
          `/api/plans/journals/${x.journal}/master-compare?quarterId=${x.q2}`,
          x.s.branch,
          browser.cookie,
        ),
      parallel: () =>
        send(
          'get',
          `/api/plans/parallel?subjectId=${x.s.subject}&grade=7&quarterId=${x.q2}`,
          x.s.branch,
          browser.cookie,
        ),
    });
    await at(NOV02, async () => {
      const own = reads(x.senior);
      expect(
        planMastersSchema.parse(ok(await own.list()).body).masters.map((one) => one.id),
      ).toEqual([master.id]);
      ok(await own.one());
      // Past the scope: the plan has no master yet, a refusal that comes after the read.
      expect(codeOf(await own.compare())).toBe('plan_master_none');
      ok(await own.parallel());
    });
    const before = await rowsOf(x.s.branch);
    await at(NOV02, async () => {
      for (const browser of [other.head, other.senior]) {
        const theirs = reads(browser);
        expect(planMastersSchema.parse(ok(await theirs.list()).body).masters).toEqual([]);
        refused(await theirs.one());
        refused(await theirs.compare());
        refused(await theirs.parallel());
        refused(
          await send('post', '/api/plans/masters', x.s.branch, browser.cookie, {
            yearId: x.s.year,
            quarter: 2,
            subjectId: x.s.subject,
            grade: 7,
            language: 'uz',
            name: 'By another subject',
            scope: browser === other.senior ? 'all' : 'branch',
          }),
          'plan_master_scope',
        );
      }
    });
    expect(await rowsOf(x.s.branch)).toEqual(before);
  });
  // 09: "The Academic Vice Principal can extend the window for one teacher, for example
  // after illness": the extension names the teacher, and only the whole-branch readers
  // and the teacher see it (task 10.3a, found by the review: every reader of plans did).
  it('shows an extension of the window to its teacher and the whole-branch readers only', async () => {
    const x = await scene();
    ok(
      await at(NOV02, async () =>
        send('post', `/api/plans/windows/${x.q2}/extensions`, x.s.branch, x.vice.cookie, {
          staffId: x.s.teacher.staffId,
          endDate: '2026-11-13',
        }),
      ),
    );
    const extensionsOf = async (browser: Browser) =>
      planWindowsSchema
        .parse(ok(await send('get', '/api/plans/windows', x.s.branch, browser.cookie)).body)
        .quarters.find((one) => one.quarter.id === x.q2)?.window?.extensions;
    const extended = [
      expect.objectContaining({ staffId: x.s.teacher.staffId, endDate: '2026-11-13' }),
    ];

    expect(await extensionsOf(x.vice)).toEqual(extended);
    expect(await extensionsOf(x.owner)).toEqual(extended);
    expect(await extensionsOf(x.spare)).toEqual([]);
    expect(await extensionsOf(x.head)).toEqual([]);
    expect(await extensionsOf(x.senior)).toEqual([]);

    // The whole-branch readers by role in this branch: a Principal and a Super Admin see it.
    const principal = await account();
    await t.kit.giveRole(principal.account.id, {
      role: 'principal',
      branchId: x.s.branch,
      validFrom: VALID_FROM,
    });
    const admin = await account();
    await t.kit.giveRole(admin.account.id, { role: 'super_admin', validFrom: VALID_FROM });
    expect(await extensionsOf(principal)).toEqual(extended);
    expect(await extensionsOf(admin)).toEqual(extended);
    // A Teacher here who is Principal and Academic Vice Principal of another branch reads as a
    // Teacher here: the roles that permit the request decide, not every role of the person.
    const elsewhere = x.s.branch === t.north ? t.south : t.north;
    const mixed = await account();
    await t.kit.giveRole(mixed.account.id, {
      role: 'teacher',
      branchId: x.s.branch,
      validFrom: VALID_FROM,
    });
    for (const role of ['principal', 'academic_vice_principal'] as const) {
      await t.kit.giveRole(mixed.account.id, { role, branchId: elsewhere, validFrom: VALID_FROM });
    }
    expect(await extensionsOf(mixed)).toEqual([]);
  });
});
