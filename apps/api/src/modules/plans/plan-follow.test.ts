import { randomUUID } from 'node:crypto';
import {
  apiErrorSchema,
  BRANCH_HEADER,
  bulkCancelCheckAnswerSchema,
  calendarPreviewSchema,
  planItemSchema,
  planLessonItemSchema,
  planSchema,
  publishCheckSchema,
  quartersPreviewSchema,
  REQUEST_KEY_HEADER,
  vacancyFillCheckSchema,
  type Plan,
  type PlanItem,
  type VacancyFillCheck,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import {
  hoursOf,
  publishedScene,
  publishOf,
  type PublishedScene,
} from '../../testing/published-scene.js';
import { openPlanWindows } from '../../testing/plan-windows-kit.js';

/** The Mondays of the second quarter (9 November to 28 December): the eight rows of its plans. */
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

/** Thursday 26 November 2026, noon in Tashkent: the Mondays 9, 16 and 23 November are held. */
const THURSDAY = '2026-11-26T12:00:00+05:00';

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

// All names are invented. Task 7.1b, pull request #213: docs/spec/09-lesson-plans.md,
// When something else changes (a test for every row of the table, the "done when");
// docs/spec/edge-cases/lesson-plans.md, How items stay attached and The window and
// requests ("A new day off shifts 300 plans"). Each change runs through its real
// route; the follow runs before the commit of that route's transaction.
describe('plan items follow the timetable', () => {
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
    return t.kit.completeSession('Malika', `Yusupova${'a'.repeat(names % 7)}`);
  };

  const keyed = (path: string, branch: string, body: object, cookie = t.admin) =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send(body);

  const get = (path: string, branch: string, cookie: string) =>
    request(t.kit.server).get(path).set('Cookie', cookie).set(BRANCH_HEADER, branch);

  /** Every session as fresh at `moment` (the Super Admin's too). */
  const freshAt = (moment: string) =>
    t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
      .execute();

  /** Runs `work` at `moment`, every session kept fresh, then sets the clock and sessions back. */
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

  /** A graded scene whose teacher and spare teacher sign in, with a Head Teacher of the subject. */
  async function scene() {
    const owner = await account();
    const spare = await account();
    const head = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id, spare: spare.account.id },
    });
    // Task 7.2: the plans are written inside their window.
    await openPlanWindows(t.database.migrator, s.branch, s.year);
    for (const browser of [owner, spare]) {
      await t.kit.giveRole(browser.account.id, {
        role: 'teacher',
        branchId: s.branch,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
    }
    await t.kit.giveRole(head.account.id, {
      role: 'head_teacher',
      branchId: s.branch,
      subjectIds: [s.subject],
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    const journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.classId)
        .executeTakeFirstOrThrow()
    ).id;
    const q2 = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', s.year)
        .where('number', '=', 2)
        .executeTakeFirstOrThrow()
    ).id;
    return { s, owner, spare, head, journal, q2 };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /** The class's lesson of a date. */
  const lessonOn = async (s: PublishedScene, date: string) =>
    t.database.migrator
      .selectFrom('lessons')
      .select(['id', 'teacher_id'])
      .where('class_id', '=', s.classId)
      .where('subject_id', '=', s.subject)
      .where('lesson_date', '=', date)
      .executeTakeFirstOrThrow();

  const planOf = async (x: Scene, moment = START): Promise<Plan> =>
    at(moment, async () =>
      planSchema.parse(
        ok(
          await get(
            `/api/plans/journals/${x.journal}?quarterId=${x.q2}`,
            x.s.branch,
            x.owner.cookie,
          ),
        ).body,
      ),
    );

  /** The class or group of the scene's plan, as the notice names it. */
  const unitOf = async (x: Scene) => (await planOf(x)).unit.name;

  /** The topic on each row date, `-` for an empty row; and the topics not covered. */
  const laid = (plan: Plan) => ({
    rows: Object.fromEntries(plan.rows.map((row) => [row.date, row.item?.topic ?? '-'])),
    notCovered: plan.notCovered.map((item) => item.topic),
  });

  /** Items "Topic n" at the rows named (1 to 8), written by the owner. */
  async function fill(x: Scene, positions: readonly number[]): Promise<PlanItem[]> {
    const plan = await planOf(x);
    const items: PlanItem[] = [];
    for (const position of positions) {
      const row = plan.rows[position - 1];
      items.push(
        planItemSchema.parse(
          ok(
            await request(t.kit.server)
              .post(`/api/plans/journals/${x.journal}/items`)
              .set('Cookie', x.owner.cookie)
              .set(BRANCH_HEADER, x.s.branch)
              .send({
                quarterId: x.q2,
                position,
                lessonId: row?.lessonId ?? randomUUID(),
                values: values(`Topic ${String(position)}`),
              }),
            201,
          ).body,
        ),
      );
    }
    return items;
  }

  const cancel = async (x: Scene, date: string) =>
    ok(
      await keyed(`/api/timetable/lessons/${(await lessonOn(x.s, date)).id}/cancel`, x.s.branch, {
        reason: 'Excursion',
      }),
    );

  /** The notifications of an account of a kind, oldest first. */
  const noticesOf = async (accountId: string, kind: string) =>
    (
      await t.database.migrator
        .selectFrom('notifications')
        .select(['data'])
        .where('account_id', '=', accountId)
        .where('kind', '=', kind)
        .orderBy('created_at')
        .orderBy('id')
        .execute()
    ).map((row) => row.data);

  /** The audit entries of the follow of a plan's journal. */
  const followEntries = async (journal: string) =>
    (
      await t.database.migrator
        .selectFrom('audit_log')
        .select(['action', 'actor_id', 'details', 'new_value'])
        .where('action', 'in', ['plan.items_followed', 'plan.request_prepared'])
        .orderBy('id')
        .execute()
    ).filter((entry) => JSON.stringify(entry).includes(journal));

  /** A draft copied from the scene's version from `startsOn`, its pattern written by `place`. */
  async function publishWith(
    x: Scene,
    startsOn: string,
    place: (draft: string, rows: { id: string; class_id: string | null }[]) => Promise<void>,
    publish = true,
    copyFrom = x.s.version,
  ) {
    const created = ok(
      await t.post('/api/timetable/versions', x.s.branch, {
        academicYearId: x.s.year,
        startsOn,
        copyFrom,
      }),
      201,
    );
    const draft = (created.body as { id: string }).id;
    await t.database.migrator
      .deleteFrom('pattern_blocks')
      .where('version_id', '=', draft)
      .execute();
    const rows = await t.database.migrator
      .selectFrom('teaching_load_rows')
      .select(['id', 'class_id'])
      .where('version_id', '=', draft)
      .execute();
    await place(draft, rows);
    ok(await t.post(`/api/timetable/versions/${draft}/templates/confirm`, x.s.branch));
    await load.freeEditLock(draft);
    if (publish) ok(await publishOf(t)(x.s.branch, draft, startsOn));
    return draft;
  }

  const placeAt = async (x: Scene, draft: string, rowId: string, weekday: number, slot = 1) =>
    ok(
      await t.post(`/api/timetable/versions/${draft}/pattern`, x.s.branch, {
        loadRowId: rowId,
        weekday,
        slotPosition: slot,
      }),
      201,
    );

  describe('a future lesson is cancelled', () => {
    it('moves its item to the next lesson and the following items one step; the last is not covered, a request is prepared, the teacher and the Head Teacher are told', async () => {
      const x = await scene();
      await fill(x, [1, 2, 3, 4, 5, 6, 7, 8]);
      await cancel(x, '2026-11-16');
      const plan = await planOf(x);
      expect(laid(plan)).toEqual({
        rows: {
          '2026-11-09': 'Topic 1',
          '2026-11-23': 'Topic 2',
          '2026-11-30': 'Topic 3',
          '2026-12-07': 'Topic 4',
          '2026-12-14': 'Topic 5',
          '2026-12-21': 'Topic 6',
          '2026-12-28': 'Topic 7',
        },
        notCovered: ['Topic 8'],
      });
      // Task 7.2: the request is stored, with its id and no Text part.
      expect(plan.request?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect({ ...plan.request, id: null }).toEqual({
        id: null,
        lessons: [],
        fromDate: '2026-11-16',
        causes: [{ kind: 'not_covered', onDate: '2026-11-16', items: 1 }],
      });
      expect(await noticesOf(x.owner.account.id, 'plans.followed')).toEqual([
        { requested: await unitOf(x), moved: '—' },
      ]);
      expect(await noticesOf(x.head.account.id, 'plans.followed_counts')).toEqual([
        { plans: 1, requests: 1 },
      ]);
      const entries = await followEntries(x.journal);
      expect(entries.map((entry) => entry.action)).toEqual([
        'plan.items_followed',
        'plan.request_prepared',
      ]);
      // Decision 6: the actor of the change that caused it.
      const admin = await t.database.migrator
        .selectFrom('audit_log')
        .select('actor_id')
        .where('action', '=', 'lesson.cancel')
        .orderBy('id', 'desc')
        .executeTakeFirst();
      expect(entries[0]?.actor_id).toBe(admin?.actor_id ?? 'none');
    });

    it('stops the shift at the first empty row, which absorbs it; no request (edge, last rows empty)', async () => {
      const x = await scene();
      await fill(x, [1, 2, 4]);
      await cancel(x, '2026-11-09');
      const plan = await planOf(x);
      expect(laid(plan).rows).toMatchObject({
        '2026-11-16': 'Topic 1',
        '2026-11-23': 'Topic 2',
        '2026-11-30': 'Topic 4',
        '2026-12-07': '-',
      });
      expect(plan.request).toBeNull();
      // Decision 8 as changed on #213: the move is told, with no request.
      expect(await noticesOf(x.owner.account.id, 'plans.followed')).toEqual([
        { requested: '—', moved: await unitOf(x) },
      ]);
    });

    it('moves the items back when the cancel is taken back, also past an absorbed shift, and the not covered return (edge, a day off by mistake)', async () => {
      const x = await scene();
      await fill(x, [1, 2, 4, 5, 6, 7, 8]);
      await cancel(x, '2026-11-09');
      const cancelled = await planOf(x);
      expect(laid(cancelled).rows['2026-11-16']).toBe('Topic 1');
      ok(
        await keyed(
          `/api/timetable/lessons/${(await lessonOn(x.s, '2026-11-09')).id}/restore`,
          x.s.branch,
          {},
        ),
      );
      const restored = await planOf(x);
      expect(laid(restored)).toEqual({
        rows: {
          '2026-11-09': 'Topic 1',
          '2026-11-16': 'Topic 2',
          '2026-11-23': '-',
          '2026-11-30': 'Topic 4',
          '2026-12-07': 'Topic 5',
          '2026-12-14': 'Topic 6',
          '2026-12-21': 'Topic 7',
          '2026-12-28': 'Topic 8',
        },
        notCovered: [],
      });
      // The not-covered row way: a full plan, cancelled and restored.
      const y = await scene();
      await fill(y, [1, 2, 3, 4, 5, 6, 7, 8]);
      await cancel(y, '2026-11-09');
      expect(laid(await planOf(y)).notCovered).toEqual(['Topic 8']);
      ok(
        await keyed(
          `/api/timetable/lessons/${(await lessonOn(y.s, '2026-11-09')).id}/restore`,
          y.s.branch,
          {},
        ),
      );
      const backPlan = await planOf(y);
      const back = laid(backPlan);
      // Decision 10: the request prepared by the cancel stays with its cause.
      expect(backPlan.request?.causes.map((cause) => cause.kind)).toEqual(['not_covered']);
      expect(back.notCovered).toEqual([]);
      expect(back.rows['2026-11-09']).toBe('Topic 1');
      expect(back.rows['2026-12-28']).toBe('Topic 8');
    });

    it('prepares no request when an absorbed shift is undone in a plan whose last rows are empty (code review must-fix 1)', async () => {
      const x = await scene();
      await fill(x, [1, 2, 3]);
      await cancel(x, '2026-11-09');
      ok(
        await keyed(
          `/api/timetable/lessons/${(await lessonOn(x.s, '2026-11-09')).id}/restore`,
          x.s.branch,
          {},
        ),
      );
      const plan = await planOf(x);
      expect(laid(plan).rows).toMatchObject({
        '2026-11-09': 'Topic 1',
        '2026-11-16': 'Topic 2',
        '2026-11-23': 'Topic 3',
        '2026-11-30': '-',
      });
      expect(plan.request).toBeNull();
      const unit = await unitOf(x);
      expect(await noticesOf(x.owner.account.id, 'plans.followed')).toEqual([
        { requested: '—', moved: unit },
        { requested: '—', moved: unit },
      ]);
    });

    it('follows a bulk cancel', async () => {
      const x = await scene();
      await fill(x, [1, 2, 3, 4, 5, 6, 7, 8]);
      const body = { date: '2026-11-09', classIds: [x.s.classId], lessonNumbers: [1] };
      const check = bulkCancelCheckAnswerSchema.parse(
        ok(await t.post('/api/timetable/bulk-cancels/check', x.s.branch, body)).body,
      );
      ok(
        await keyed('/api/timetable/bulk-cancels', x.s.branch, {
          ...body,
          reason: 'Excursion to the museum',
          blocks: check.shared.map((one) => ({ blockId: one.blockId, choice: 'cancel' })),
          lessonIds: [
            ...check.cancel.map((one) => one.lesson.id),
            ...check.shared.flatMap((one) => one.lessons.map((lesson) => lesson.id)),
          ],
        }),
      );
      const plan = laid(await planOf(x));
      expect(plan.rows['2026-11-16']).toBe('Topic 1');
      expect(plan.notCovered).toEqual(['Topic 8']);
    });

    it('moves the items back when a day off is removed (edge, a day off added by mistake)', async () => {
      const x = await scene();
      await fill(x, [1, 2, 3, 4, 5, 6, 7, 8]);
      const before = laid(await planOf(x));
      const created = ok(
        await t.post('/api/setup/calendar-entries', x.s.branch, {
          kind: 'day_off',
          name: 'Founders day',
          firstDate: '2026-11-16',
          lastDate: '2026-11-16',
          gradeFrom: null,
          gradeTo: null,
          dayTemplateId: null,
          followsWeekday: null,
          examWeek: null,
        }),
        201,
      );
      expect(laid(await planOf(x)).notCovered).toEqual(['Topic 8']);
      ok(
        await t.post(
          `/api/setup/calendar-entries/${(created.body as { id: string }).id}/archive`,
          x.s.branch,
        ),
      );
      expect(laid(await planOf(x))).toEqual(before);
    });

    it('follows a new day off', async () => {
      const x = await scene();
      await fill(x, [1, 2, 3, 4, 5, 6, 7, 8]);
      ok(
        await t.post('/api/setup/calendar-entries', x.s.branch, {
          kind: 'day_off',
          name: 'Founders day',
          firstDate: '2026-11-23',
          lastDate: '2026-11-23',
          gradeFrom: null,
          gradeTo: null,
          dayTemplateId: null,
          followsWeekday: null,
          examWeek: null,
        }),
        201,
      );
      const plan = await planOf(x);
      expect(laid(plan).rows).toMatchObject({
        '2026-11-16': 'Topic 2',
        '2026-11-30': 'Topic 3',
      });
      expect(laid(plan).notCovered).toEqual(['Topic 8']);
      expect(plan.request?.causes.map((cause) => cause.kind)).toEqual(['not_covered']);
    });
  });

  it('a lesson cancelled after its date: its item goes in front of the first lesson not yet held, marked; held lessons keep theirs (edge, Thursday)', async () => {
    const x = await scene();
    await fill(x, [1, 2, 3, 4]);
    const monday = await lessonOn(x.s, '2026-11-09');
    await at(THURSDAY, async () => {
      ok(
        await keyed(`/api/timetable/lessons/${monday.id}/correction`, x.s.branch, {
          kind: 'cancel',
          reason: 'The register says it did not happen',
        }),
      );
    });
    const plan = await planOf(x, THURSDAY);
    expect(laid(plan).rows).toMatchObject({
      '2026-11-16': 'Topic 2',
      '2026-11-23': 'Topic 3',
      '2026-11-30': 'Topic 1',
      '2026-12-07': 'Topic 4',
      '2026-12-14': '-',
    });
    const moved = plan.rows.find((row) => row.date === '2026-11-30')?.item;
    expect(moved?.movedFrom).toBe('2026-11-09');
    expect(plan.request?.causes.map((cause) => cause.kind)).toEqual(['moved_back']);
  });

  it('a lesson moved to another day: the dates change, items stay in date order, by position (edge, Tuesday to Friday)', async () => {
    const x = await scene();
    await fill(x, [1, 2, 3]);
    const first = await lessonOn(x.s, '2026-11-09');
    // Monday 9 November moves to Wednesday 18 November, past Monday 16.
    ok(
      await keyed(`/api/timetable/lessons/${first.id}/move`, x.s.branch, {
        date: '2026-11-18',
        lessonNumber: 1,
        reason: 'Swapped with the trip',
      }),
    );
    const plan = await planOf(x);
    expect(plan.rows.slice(0, 3).map((row) => [row.date, row.item?.topic])).toEqual([
      ['2026-11-16', 'Topic 1'],
      ['2026-11-18', 'Topic 2'],
      ['2026-11-23', 'Topic 3'],
    ]);
    expect(plan.request).toBeNull();
  });

  it('more lessons a week: empty rows appear at the end and a request is prepared', async () => {
    const x = await scene();
    await fill(x, [1, 2, 3, 4, 5, 6, 7, 8]);
    await publishWith(x, '2026-11-02', async (draft, rows) => {
      for (const row of rows) {
        if (row.class_id === x.s.classId) {
          await t.database.migrator
            .updateTable('teaching_load_rows')
            .set({ lessons_per_week: 2 })
            .where('id', '=', row.id)
            .execute();
          await placeAt(x, draft, row.id, 1);
          await placeAt(x, draft, row.id, 3);
        } else {
          await placeAt(x, draft, row.id, 1);
        }
      }
    });
    const plan = await planOf(x);
    // Eight Mondays and seven Wednesdays (30 December is past the quarter).
    expect(plan.rows).toHaveLength(15);
    expect(plan.rows.slice(0, 8).map((row) => row.item?.topic)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Topic ${String(n)}`),
    );
    expect(plan.rows.slice(8).every((row) => row.item === null)).toBe(true);
    expect(plan.request?.causes.map((cause) => cause.kind)).toEqual(['rows_added']);
    // Fewer lessons a week again from 23 November: the last items are not covered.
    await publishWith(x, '2026-11-23', async (draft, rows) => {
      for (const row of rows) {
        if (row.class_id === x.s.classId) {
          await t.database.migrator
            .updateTable('teaching_load_rows')
            .set({ lessons_per_week: 1 })
            .where('id', '=', row.id)
            .execute();
        }
        await placeAt(x, draft, row.id, 1);
      }
    });
    const fewer = await planOf(x);
    // 9, 11, 16 and 18 November, then the Mondays from 23 November: ten rows.
    expect(fewer.rows).toHaveLength(10);
    expect(laid(fewer).notCovered).toEqual([]);
    expect(fewer.rows.every((row) => row.item !== null)).toBe(false);
    expect(fewer.request?.causes.map((cause) => cause.kind)).toEqual(['rows_added']);
  });

  it('the quarter dates change: fewer lessons, the last items are not covered, a request is prepared', async () => {
    const x = await scene();
    await fill(x, [1, 2, 3, 4, 5, 6, 7, 8]);
    ok(
      await request(t.kit.server)
        .put(`/api/setup/academic-years/${x.s.year}/quarters`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, x.s.branch)
        .send({
          quarters: [
            { startDate: '2026-09-01', endDate: '2026-10-31' },
            { startDate: '2026-11-09', endDate: '2026-12-20' },
            { startDate: '2027-01-11', endDate: '2027-03-20' },
            { startDate: '2027-03-30', endDate: '2027-05-31' },
          ],
        }),
    );
    const plan = await planOf(x);
    expect(plan.rows.map((row) => row.date)).toEqual(Q2_MONDAYS.slice(0, 6));
    expect(laid(plan).notCovered).toEqual(['Topic 7', 'Topic 8']);
    expect(plan.request?.causes).toEqual([{ kind: 'not_covered', onDate: '2026-12-21', items: 2 }]);
  });

  it('the timetable is replaced before the quarter starts: items attach to the new lessons in the same order', async () => {
    const x = await scene();
    await fill(x, [1, 2, 3]);
    await publishWith(x, '2026-11-02', async (draft, rows) => {
      for (const row of rows) await placeAt(x, draft, row.id, row.class_id === x.s.classId ? 4 : 1);
    });
    const plan = await planOf(x);
    expect(plan.rows.slice(0, 3).map((row) => [row.date, row.item?.topic])).toEqual([
      ['2026-11-12', 'Topic 1'],
      ['2026-11-19', 'Topic 2'],
      ['2026-11-26', 'Topic 3'],
    ]);
  });

  it('a subject is removed from the class: the remaining items are not covered and the plan is closed, with no request and no notice', async () => {
    const x = await scene();
    const [first] = await fill(x, [1, 2]);
    await publishWith(x, '2026-11-02', async (draft, rows) => {
      for (const row of rows) {
        if (row.class_id === x.s.classId) {
          await t.database.migrator
            .deleteFrom('teaching_load_rows')
            .where('id', '=', row.id)
            .execute();
        } else {
          await placeAt(x, draft, row.id, 1);
        }
      }
    });
    const plan = await planOf(x);
    expect(plan.rows).toEqual([]);
    expect(laid(plan).notCovered).toEqual(['Topic 1', 'Topic 2']);
    expect(plan.closed).toBe(true);
    expect(plan.request).toBeNull();
    expect(await noticesOf(x.owner.account.id, 'plans.followed')).toEqual([]);
    const saved = await request(t.kit.server)
      .put(`/api/plans/items/${first?.id ?? ''}`)
      .set('Cookie', x.owner.cookie)
      .set(BRANCH_HEADER, x.s.branch)
      .send({
        base: { topic: 'Topic 1', objectives: '', links: [], classworks: [], homeworks: [] },
        values: values('Changed'),
      });
    expect(saved.status).toBe(409);
    expect(codeOf(saved)).toBe('plan_closed');
    // A reader who does not own it is told it is closed too (permission review, should-fix 4).
    const read = await request(t.kit.server)
      .put(`/api/plans/items/${first?.id ?? ''}`)
      .set('Cookie', x.spare.cookie)
      .set(BRANCH_HEADER, x.s.branch)
      .send({
        base: { topic: 'Topic 1', objectives: '', links: [], classworks: [], homeworks: [] },
        values: values('Changed'),
      });
    expect(read.status).toBe(409);
    expect(codeOf(read)).toBe('plan_closed');
  });

  describe('the teacher of the class changes', () => {
    it('makes the new teacher the owner and prepares a request told to them; the earlier rows stay readable', async () => {
      const x = await scene();
      await fill(x, [1, 2, 3]);
      await publishWith(x, '2026-11-16', async (draft, rows) => {
        for (const row of rows) {
          if (row.class_id === x.s.classId) {
            await t.database.migrator
              .updateTable('teaching_load_rows')
              .set({ teacher_id: x.s.spareTeacher.staffId })
              .where('id', '=', row.id)
              .execute();
          }
          await placeAt(x, draft, row.id, 1);
        }
      });
      // Read by the earlier teacher (`planOf` signs in as the scene's owner).
      const plan = await planOf(x);
      expect(laid(plan).rows['2026-11-09']).toBe('Topic 1');
      expect(plan.request?.causes).toEqual([
        { kind: 'owner_changed', onDate: '2026-11-16', items: 0 },
      ]);
      // From 16 November the plan's owner is the new teacher: they edit it, the earlier one reads it.
      const later = await planOf(x, THURSDAY);
      expect(later.canEdit).toBe(false);
      expect(laid(later).rows['2026-11-09']).toBe('Topic 1');
      const taken = await at(THURSDAY, async () =>
        planSchema.parse(
          ok(
            await get(
              `/api/plans/journals/${x.journal}?quarterId=${x.q2}`,
              x.s.branch,
              x.spare.cookie,
            ),
          ).body,
        ),
      );
      expect(taken.canEdit).toBe(true);
      // Review correction 1: the new owner is told.
      expect(await noticesOf(x.spare.account.id, 'plans.followed')).toEqual([
        { requested: await unitOf(x), moved: '—' },
      ]);
    });

    it('prepares the request for the new teacher when the publish also moves the lessons to another time (code review must-fix 2)', async () => {
      const x = await scene();
      await fill(x, [1, 2, 3]);
      await publishWith(x, '2026-11-16', async (draft, rows) => {
        for (const row of rows) {
          if (row.class_id === x.s.classId) {
            await t.database.migrator
              .updateTable('teaching_load_rows')
              .set({ teacher_id: x.s.spareTeacher.staffId })
              .where('id', '=', row.id)
              .execute();
            // The second slot of Monday: no stored lesson pairs with it.
            await placeAt(x, draft, row.id, 1, 3);
          } else {
            await placeAt(x, draft, row.id, 1);
          }
        }
      });
      const plan = await planOf(x);
      expect(plan.rows[1]?.start).not.toBe(plan.rows[0]?.start);
      expect(plan.request?.causes.map((cause) => [cause.kind, cause.onDate])).toEqual([
        ['owner_changed', '2026-11-16'],
      ]);
      expect(await noticesOf(x.spare.account.id, 'plans.followed')).toEqual([
        { requested: await unitOf(x), moved: '—' },
      ]);
    });

    it('tells the acting teacher once named, then the hired teacher after a fill', async () => {
      const x = await scene();
      await fill(x, [1, 2]);
      const vacancy = await load.vacancy(x.s.branch, {
        languages: ['uz'],
        subjects: [{ subject: x.s.subject, grades: [7] }],
      });
      await hoursOf(t, x.s.branch, vacancy);
      await publishWith(x, '2026-11-16', async (draft, rows) => {
        for (const row of rows) {
          if (row.class_id === x.s.classId) {
            await t.database.migrator
              .updateTable('teaching_load_rows')
              .set({ teacher_id: vacancy })
              .where('id', '=', row.id)
              .execute();
          }
          await placeAt(x, draft, row.id, 1);
        }
      });
      // Under the vacancy nobody writes the plan: no request.
      expect((await planOf(x)).request).toBeNull();
      ok(
        await keyed('/api/timetable/acting-teachers', x.s.branch, {
          vacancyId: vacancy,
          journalId: x.journal,
          personId: x.s.spareTeacher.staffId,
          from: '2026-11-16',
          confirmLanguage: true,
        }),
        201,
      );
      expect(await noticesOf(x.spare.account.id, 'plans.followed')).toEqual([
        { requested: await unitOf(x), moved: '—' },
      ]);
      const hired = await account();
      const person = await load.teacher(x.s.branch, {
        subjects: [{ subject: x.s.subject, grades: [7] }],
        accountId: hired.account.id,
      });
      await hoursOf(t, x.s.branch, person.staffId);
      const body = { vacancyId: vacancy, personId: person.staffId, startsOn: '2026-11-30' };
      const check: VacancyFillCheck = vacancyFillCheckSchema.parse(
        ok(await t.post('/api/timetable/vacancy-fills/check', x.s.branch, body)).body,
      );
      ok(
        await keyed('/api/timetable/vacancy-fills', x.s.branch, {
          ...body,
          rowsKey: check.rowsKey,
          ...(check.publish?.chain == null ? {} : { laterKey: check.publish.chain.key }),
          ...(check.publish?.impact?.transition?.key == null
            ? {}
            : { transitionKey: check.publish.impact.transition.key }),
          ...(check.publish?.impact == null
            ? {}
            : { dayChangesKey: check.publish.impact.dayChanges.key }),
        }),
        201,
      );
      expect(await noticesOf(hired.account.id, 'plans.followed')).toEqual([
        { requested: await unitOf(x), moved: '—' },
      ]);
      const plan = await planOf(x);
      expect(plan.request?.causes.map((cause) => [cause.kind, cause.onDate])).toEqual([
        ['owner_changed', '2026-11-16'],
        ['owner_changed', '2026-11-30'],
      ]);
    });
  });

  describe('a substitute takes one lesson', () => {
    it("lets the substitute read that lesson's item only, never edit it, and moves nothing", async () => {
      const x = await scene();
      const [first] = await fill(x, [1, 2]);
      const monday = await lessonOn(x.s, '2026-11-09');
      const other = await lessonOn(x.s, '2026-11-16');
      // A teacher of another subject: no reader of the plan by profile.
      const sub = await account();
      const otherSubject = await load.classes.subject({ grades: [7] });
      const substitute = await load.teacher(x.s.branch, {
        subjects: [{ subject: otherSubject, grades: [7] }],
        accountId: sub.account.id,
      });
      await hoursOf(t, x.s.branch, substitute.staffId);
      // No teacher of the subject is free on Monday (the spare has no hours then),
      // so the subject is a warning the save confirms (task 5.7b-1, decision 2).
      await t.database.migrator
        .deleteFrom('staff_availability_ranges')
        .where('staff_id', '=', x.s.spareTeacher.staffId)
        .where('weekday', '=', 1)
        .execute();
      await t.kit.giveRole(sub.account.id, {
        role: 'teacher',
        branchId: x.s.branch,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
      ok(
        await keyed(`/api/timetable/lessons/${monday.id}/substitute`, x.s.branch, {
          teacherId: substitute.staffId,
          reason: 'The teacher is at a seminar',
          confirm: true,
        }),
      );
      const read = await at(START, async () =>
        planLessonItemSchema.parse(
          ok(await get(`/api/plans/lessons/${monday.id}`, x.s.branch, sub.cookie)).body,
        ),
      );
      expect(read.item?.topic).toBe('Topic 1');
      const refused = [
        await get(`/api/plans/lessons/${other.id}`, x.s.branch, sub.cookie),
        await get(`/api/plans/journals/${x.journal}?quarterId=${x.q2}`, x.s.branch, sub.cookie),
        await request(t.kit.server)
          .put(`/api/plans/items/${first?.id ?? ''}`)
          .set('Cookie', sub.cookie)
          .set(BRANCH_HEADER, x.s.branch)
          .send({
            base: { topic: 'Topic 1', objectives: '', links: [], classworks: [], homeworks: [] },
            values: values('Changed'),
          }),
      ];
      for (const response of refused) {
        expect(response.status, JSON.stringify(response.body)).toBe(403);
        expect(codeOf(response)).toBe('plan_scope');
      }
      ok(
        await keyed(`/api/timetable/lessons/${monday.id}/substitution/withdraw`, x.s.branch, {
          reason: 'The seminar is cancelled',
        }),
      );
      const after = await get(`/api/plans/lessons/${monday.id}`, x.s.branch, sub.cookie);
      expect(after.status).toBe(403);
      const plan = await planOf(x);
      expect(plan.request).toBeNull();
      expect(laid(plan).rows['2026-11-09']).toBe('Topic 1');
      expect(await followEntries(x.journal)).toEqual([]);
    });
  });

  describe('the item of one lesson (decision 11)', () => {
    const role = async (
      x: Scene,
      held: {
        role: 'principal' | 'academic_vice_principal' | 'head_teacher' | 'teacher';
        subjectIds?: string[];
      },
    ) => {
      const browser = await account();
      await t.kit.giveRole(browser.account.id, {
        role: held.role,
        branchId: x.s.branch,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
        ...(held.subjectIds === undefined ? {} : { subjectIds: held.subjectIds }),
      });
      return browser;
    };

    it('lets every reader of the plan read it (edge/lesson-plans, "Who may read a plan?") and refuses the others', async () => {
      const x = await scene();
      await fill(x, [1]);
      const monday = await lessonOn(x.s, '2026-11-09');
      const otherSubject = await load.classes.subject({ grades: [7] });
      const outsider = await account();
      await load.teacher(x.s.branch, {
        subjects: [{ subject: otherSubject, grades: [7] }],
        accountId: outsider.account.id,
      });
      await t.kit.giveRole(outsider.account.id, {
        role: 'teacher',
        branchId: x.s.branch,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
      const readers = [
        x.owner.cookie,
        x.spare.cookie,
        x.head.cookie,
        t.admin,
        (await role(x, { role: 'principal' })).cookie,
        (await role(x, { role: 'academic_vice_principal' })).cookie,
      ];
      const refused = [
        outsider.cookie,
        (await role(x, { role: 'head_teacher', subjectIds: [otherSubject] })).cookie,
      ];
      await at(START, async () => {
        for (const cookie of readers) {
          const read = planLessonItemSchema.parse(
            ok(await get(`/api/plans/lessons/${monday.id}`, x.s.branch, cookie)).body,
          );
          expect(read.item?.topic).toBe('Topic 1');
        }
        for (const cookie of refused) {
          const answer = await get(`/api/plans/lessons/${monday.id}`, x.s.branch, cookie);
          expect(answer.status, JSON.stringify(answer.body)).toBe(403);
          expect(codeOf(answer)).toBe('plan_scope');
        }
      });
    });

    it('shows the plans section of the publish check to the Principal too', async () => {
      const x = await scene();
      await fill(x, [1, 2, 3, 4, 5, 6, 7, 8]);
      const principal = await role(x, { role: 'principal' });
      const draft = await publishWith(
        x,
        '2026-12-07',
        async (version, rows) => {
          for (const row of rows) {
            if (row.class_id === x.s.classId) {
              await t.database.migrator
                .deleteFrom('teaching_load_rows')
                .where('id', '=', row.id)
                .execute();
            } else {
              await placeAt(x, version, row.id, 1);
            }
          }
        },
        false,
      );
      const check = await at(START, async () =>
        publishCheckSchema.parse(
          ok(
            await get(
              `/api/timetable/versions/${draft}/publish-check?startsOn=2026-12-07`,
              x.s.branch,
              principal.cookie,
            ),
          ).body,
        ),
      );
      expect(check.plans.map((plan) => plan.journalId)).toEqual([x.journal]);
    });
  });

  describe("the create of an item names its row's lesson", () => {
    it('refuses plan_row_moved when a cancellation shifted the rows since the plan was read', async () => {
      const x = await scene();
      const before = await planOf(x);
      await cancel(x, '2026-11-09');
      const created = await request(t.kit.server)
        .post(`/api/plans/journals/${x.journal}/items`)
        .set('Cookie', x.owner.cookie)
        .set(BRANCH_HEADER, x.s.branch)
        .send({
          quarterId: x.q2,
          position: 1,
          lessonId: before.rows[0]?.lessonId,
          values: values('Topic 1'),
        });
      expect(created.status).toBe(409);
      expect(codeOf(created)).toBe('plan_row_moved');
    });

    it("answers 404 for another branch's or an unknown lesson, and writes nothing", async () => {
      const x = await scene();
      const y = await scene();
      const foreign = await lessonOn(y.s, '2026-11-09');
      const rowsOf = async () => [await t.rowsOf(x.s.branch), await t.rowsOf(y.s.branch)];
      const before = await rowsOf();
      for (const lessonId of [foreign.id, randomUUID()]) {
        const created = await request(t.kit.server)
          .post(`/api/plans/journals/${x.journal}/items`)
          .set('Cookie', x.owner.cookie)
          .set(BRANCH_HEADER, x.s.branch)
          .send({ quarterId: x.q2, position: 1, lessonId, values: values('Topic 1') });
        expect(created.status, JSON.stringify(created.body)).toBe(404);
        const read = await get(`/api/plans/lessons/${lessonId}`, x.s.branch, x.owner.cookie);
        expect(read.status).toBe(404);
      }
      expect(await rowsOf()).toEqual(before);
    });
  });

  it("changes no plan of either branch when a write of dated lessons answers 404 for another branch's or an unknown lesson", async () => {
    const x = await scene();
    const y = await scene();
    await fill(x, [1, 2, 3, 4, 5, 6, 7, 8]);
    await fill(y, [1, 2, 3, 4, 5, 6, 7, 8]);
    const foreign = await lessonOn(y.s, '2026-11-09');
    const before = [await t.rowsOf(x.s.branch), await t.rowsOf(y.s.branch)];
    for (const id of [foreign.id, randomUUID()]) {
      for (const [path, body] of [
        ['cancel', { reason: 'Excursion' }],
        ['restore', {}],
        ['move', { date: '2026-11-18', lessonNumber: 1, reason: 'Swapped' }],
        ['correction', { kind: 'cancel', reason: 'Did not happen' }],
        ['substitute', { teacherId: x.s.spareTeacher.staffId, reason: 'Seminar', confirm: true }],
      ] as const) {
        const answer = await keyed(`/api/timetable/lessons/${id}/${path}`, x.s.branch, body);
        expect(answer.status, `${path} ${JSON.stringify(answer.body)}`).toBe(404);
      }
    }
    expect([await t.rowsOf(x.s.branch), await t.rowsOf(y.s.branch)]).toEqual(before);
  });

  describe('the impact previews show, per plan, items that no longer fit and rows left empty', () => {
    const dayOff = {
      kind: 'day_off',
      name: 'Founders day',
      firstDate: '2026-11-23',
      lastDate: '2026-11-23',
      gradeFrom: null,
      gradeTo: null,
      dayTemplateId: null,
      followsWeekday: null,
      examWeek: null,
    };

    it('in the preview of a calendar entry, and writes nothing', async () => {
      const x = await scene();
      await fill(x, [1, 2, 3, 4, 5, 6, 7, 8]);
      const before = await t.rowsOf(x.s.branch);
      const preview = calendarPreviewSchema.parse(
        ok(
          await t.post('/api/setup/calendar-entries/preview', x.s.branch, {
            action: 'create',
            record: dayOff,
          }),
        ).body,
      );
      expect(preview.plans).toEqual([
        expect.objectContaining({
          journalId: x.journal,
          quarter: 2,
          moved: 6,
          notFitting: ['Topic 8'],
          emptyRows: 0,
        }),
      ]);
      expect(await t.rowsOf(x.s.branch)).toEqual(before);
    });

    it('in the check of a bulk cancel, with the rows left empty', async () => {
      const x = await scene();
      await fill(x, [1, 2]);
      const before = await t.rowsOf(x.s.branch);
      const check = bulkCancelCheckAnswerSchema.parse(
        ok(
          await t.post('/api/timetable/bulk-cancels/check', x.s.branch, {
            date: '2026-11-09',
            classIds: [x.s.classId],
            lessonNumbers: [1],
          }),
        ).body,
      );
      expect(check.plans).toEqual([
        expect.objectContaining({ journalId: x.journal, moved: 2, notFitting: [], emptyRows: 5 }),
      ]);
      expect(await t.rowsOf(x.s.branch)).toEqual(before);
    });

    it('in the preview of the quarter dates', async () => {
      const x = await scene();
      await fill(x, [1, 2, 3, 4, 5, 6, 7, 8]);
      const preview = quartersPreviewSchema.parse(
        ok(
          await t.post(`/api/setup/academic-years/${x.s.year}/quarters/preview`, x.s.branch, {
            quarters: [
              { startDate: '2026-09-01', endDate: '2026-10-31' },
              { startDate: '2026-11-09', endDate: '2026-12-20' },
              { startDate: '2027-01-11', endDate: '2027-03-20' },
              { startDate: '2027-03-30', endDate: '2027-05-31' },
            ],
          }),
        ).body,
      );
      expect(preview.plans).toEqual([
        expect.objectContaining({ journalId: x.journal, notFitting: ['Topic 7', 'Topic 8'] }),
      ]);
    });

    it("in the publish check, laid on the draft's lessons", async () => {
      const x = await scene();
      await fill(x, [1, 2, 3, 4, 5, 6, 7, 8]);
      // The class's maths every second Monday is not possible in a weekly
      // pattern; the draft drops it from 7 December by starting there with no row.
      const draft = await publishWith(
        x,
        '2026-12-07',
        async (version, rows) => {
          for (const row of rows) {
            if (row.class_id === x.s.classId) {
              await t.database.migrator
                .deleteFrom('teaching_load_rows')
                .where('id', '=', row.id)
                .execute();
            } else {
              await placeAt(x, version, row.id, 1);
            }
          }
        },
        false,
      );
      const check = publishCheckSchema.parse(
        ok(
          await t.get(
            `/api/timetable/versions/${draft}/publish-check?startsOn=2026-12-07`,
            x.s.branch,
          ),
        ).body,
      );
      expect(check.plans).toEqual([
        expect.objectContaining({
          journalId: x.journal,
          moved: 4,
          notFitting: ['Topic 5', 'Topic 6', 'Topic 7', 'Topic 8'],
          emptyRows: 0,
        }),
      ]);
    });
  });

  describe('at the same moment', () => {
    /**
     * Holds the journal row `for no key update` (as a plan write and the follow
     * take it) in a transaction of the migrator; answers its pid and a release.
     */
    async function holdJournal(journal: string) {
      return holdRow(sql`select id from journals where id = ${journal} for no key update`);
    }

    /** Holds the class's lesson row `for update`, as a writer of dated lessons takes it first. */
    async function holdLesson(lesson: string) {
      return holdRow(sql`select id from lessons where id = ${lesson} for update`);
    }

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
    async function waitingOn(pid: number, count: number): Promise<void> {
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
      throw new Error(`Fewer than ${String(count)} requests waited on the held journal.`);
    }

    /** Starts a request at once (a supertest request is sent only once awaited, `api.md`). */
    const started = (send: () => PromiseLike<Response>) =>
      new Promise<Response>((resolve, reject) => {
        send().then(resolve, reject);
      });

    const cancelOf = (x: Scene, id: string) => () =>
      keyed(`/api/timetable/lessons/${id}/cancel`, x.s.branch, { reason: 'Excursion' });

    const createOf = (x: Scene, lessonId: string) => () =>
      request(t.kit.server)
        .post(`/api/plans/journals/${x.journal}/items`)
        .set('Cookie', x.owner.cookie)
        .set(BRANCH_HEADER, x.s.branch)
        .send({ quarterId: x.q2, position: 1, lessonId, values: values('Topic new') });

    it("two cancels of one journal: the second waits on the journal and follows the first one's snapshot", async () => {
      const x = await scene();
      await fill(x, [1, 2, 3, 4, 5, 6, 7, 8]);
      const first = await lessonOn(x.s, '2026-11-09');
      const second = await lessonOn(x.s, '2026-11-16');
      const held = await holdJournal(x.journal);
      const both = [started(cancelOf(x, first.id)), started(cancelOf(x, second.id))];
      await waitingOn(held.pid, 2);
      await held.release();
      for (const response of await Promise.all(both)) ok(response);
      const plan = laid(await planOf(x));
      expect(plan.rows['2026-11-23']).toBe('Topic 1');
      expect(plan.rows['2026-12-28']).toBe('Topic 6');
      expect(plan.notCovered).toEqual(['Topic 7', 'Topic 8']);
    });

    it('a create and a cancel, the cancel first: the create is refused plan_row_moved', async () => {
      const x = await scene();
      const [second] = await fill(x, [2, 3]);
      const monday = await lessonOn(x.s, '2026-11-09');
      // The cancel's follow takes the journal, then waits on an item it moves;
      // the create waits on the journal behind it.
      const held = await holdRow(
        sql`select item_id from lesson_plan_places where item_id = ${second?.id ?? ''} for update`,
      );
      const cancelled = started(cancelOf(x, monday.id));
      await waitingOn(held.pid, 1);
      const created = started(createOf(x, monday.id));
      await waitingOn(held.pid, 2);
      await held.release();
      ok(await cancelled);
      const answer = await created;
      expect(answer.status, JSON.stringify(answer.body)).toBe(409);
      expect(codeOf(answer)).toBe('plan_row_moved');
    });

    it('a create and a cancel, the create first: the item follows the cancel to the next lesson', async () => {
      const x = await scene();
      await fill(x, [2, 3]);
      const monday = await lessonOn(x.s, '2026-11-09');
      // The cancel waits on its lesson; the create commits meanwhile.
      const held = await holdLesson(monday.id);
      const cancelled = started(cancelOf(x, monday.id));
      await waitingOn(held.pid, 1);
      ok(await createOf(x, monday.id)(), 201);
      await held.release();
      ok(await cancelled);
      const plan = laid(await planOf(x));
      expect(plan.rows['2026-11-16']).toBe('Topic new');
      expect(plan.rows['2026-11-23']).toBe('Topic 2');
    });
  });

  // Task 7.1c, pull request #214: shared plans and copies. `09`, What a plan
  // contains ("can share one plan between them, if the classes have the same
  // language of instruction ... each class has its own dates. A shared plan
  // can be separated later." "A plan can be copied from another class, from
  // another teacher of the same subject and grade, or from last year."), When
  // something else changes ("One class of a shared plan loses a lesson");
  // `edge/lesson-plans`, How items stay attached (shared plans, a teacher who
  // loses one class, two groups merged, last year's plan of 38 lessons).
  describe('shared plans (task 7.1c)', () => {
    /** The scene with both classes taught by the owner (Monday, first and second lesson). */
    async function sharedScene(branch?: string, subject?: string) {
      const owner = await account();
      const spare = await account();
      const s = await publishedScene(t, load, {
        graded: true,
        shared: true,
        ...(branch === undefined ? {} : { branch }),
        ...(subject === undefined ? {} : { subject }),
        accounts: { teacher: owner.account.id, spare: spare.account.id },
      });
      await openPlanWindows(t.database.migrator, s.branch, s.year);
      for (const browser of [owner, spare]) {
        await t.kit.giveRole(browser.account.id, {
          role: 'teacher',
          branchId: s.branch,
          validFrom: new Date('2026-09-01T00:00:00+05:00'),
        });
      }
      const journalOf = async (classId: string) =>
        (
          await t.database.migrator
            .selectFrom('journals')
            .select('id')
            .where('class_id', '=', classId)
            .executeTakeFirstOrThrow()
        ).id;
      const q2 = (
        await t.database.migrator
          .selectFrom('quarters')
          .select('id')
          .where('academic_year_id', '=', s.year)
          .where('number', '=', 2)
          .executeTakeFirstOrThrow()
      ).id;
      return {
        s,
        owner,
        spare,
        head: owner,
        journal: await journalOf(s.classId),
        other: await journalOf(s.otherClass),
        q2,
      };
    }

    type Shared = Awaited<ReturnType<typeof sharedScene>>;

    const post = (path: string, branch: string, cookie: string, body: object) =>
      request(t.kit.server).post(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body);

    const shareOf = (x: Shared, cookie = x.owner.cookie) =>
      post(`/api/plans/journals/${x.journal}/share`, x.s.branch, cookie, {
        quarterId: x.q2,
        journalId: x.other,
      });

    /** The plan of a journal of the scene, read by the owner. */
    const planIn = (x: Shared, journal: string, moment = START): Promise<Plan> =>
      at(moment, async () =>
        planSchema.parse(
          ok(
            await get(
              `/api/plans/journals/${journal}?quarterId=${x.q2}`,
              x.s.branch,
              x.owner.cookie,
            ),
          ).body,
        ),
      );

    /** Items "Topic n" at the rows named, written into a journal by the owner. */
    async function fillIn(
      x: Shared,
      journal: string,
      positions: readonly number[],
      moment = START,
    ) {
      const plan = await planIn(x, journal, moment);
      const items: PlanItem[] = [];
      for (const position of positions) {
        const row = plan.rows[position - 1];
        items.push(
          planItemSchema.parse(
            ok(
              await at(moment, () =>
                post(`/api/plans/journals/${journal}/items`, x.s.branch, x.owner.cookie, {
                  quarterId: x.q2,
                  position,
                  lessonId: row?.lessonId ?? randomUUID(),
                  values: values(`Topic ${String(position)}`),
                }),
              ),
              201,
            ).body,
          ),
        );
      }
      return items;
    }

    const lessonOf = (classId: string, subject: string, date: string) =>
      t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', classId)
        .where('subject_id', '=', subject)
        .where('lesson_date', '=', date)
        .executeTakeFirstOrThrow();

    const cancelIn = async (x: Shared, classId: string, date: string) =>
      ok(
        await keyed(
          `/api/timetable/lessons/${(await lessonOf(classId, x.s.subject, date)).id}/cancel`,
          x.s.branch,
          { reason: 'Excursion' },
        ),
      );

    const planIdOf = async (journal: string, quarter: string) =>
      (
        await t.database.migrator
          .selectFrom('lesson_plan_journals')
          .select('plan_id')
          .where('journal_id', '=', journal)
          .where('quarter_id', '=', quarter)
          .executeTakeFirstOrThrow()
      ).plan_id;

    const refused = (response: Response, status: number, code: string) => {
      expect(response.status, JSON.stringify(response.body)).toBe(status);
      expect(codeOf(response)).toBe(code);
    };

    /** A journal of the scene's year written as a publish writes it (no lessons). */
    const journalFor = async (
      x: Shared,
      unit: { classId: string } | { groupId: string },
      subject = x.s.subject,
    ) =>
      (
        await t.database.migrator
          .insertInto('journals')
          .values({
            branch_id: x.s.branch,
            academic_year_id: x.s.year,
            class_id: 'classId' in unit ? unit.classId : null,
            group_id: 'groupId' in unit ? unit.groupId : null,
            subject_id: subject,
            runs: '{[2026-09-07,)}',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;

    it('shares a plan: each class lays the items on its own lessons, an edit applies to both, and the plan screen shows where each class is', async () => {
      const x = await sharedScene();
      const [first] = await fillIn(x, x.journal, [1, 2, 3]);
      const shared = planSchema.parse(ok(await shareOf(x)).body);
      expect(shared.sharedWith).toEqual([
        {
          journalId: x.other,
          unit: expect.objectContaining({ kind: 'class', id: x.s.otherClass }) as unknown,
          next: { number: 1, date: '2026-11-09', topic: 'Topic 1' },
          notCovered: 0,
        },
      ]);
      expect(shared.shareCandidates).toEqual([]);
      expect(await planIdOf(x.other, x.q2)).toBe(await planIdOf(x.journal, x.q2));
      const other = await planIn(x, x.other);
      expect(laid(other).rows['2026-11-23']).toBe('Topic 3');
      // A row written through one class is written for both.
      await fillIn(x, x.journal, [5]);
      expect(laid(await planIn(x, x.other)).rows['2026-12-07']).toBe('Topic 5');
      const saved = await request(t.kit.server)
        .put(`/api/plans/items/${first?.id ?? ''}`)
        .set('Cookie', x.owner.cookie)
        .set(BRANCH_HEADER, x.s.branch)
        .send({
          base: { topic: 'Topic 1', objectives: '', links: [], classworks: [], homeworks: [] },
          values: values('Fractions'),
        });
      ok(saved);
      expect(laid(await planIn(x, x.other)).rows['2026-11-09']).toBe('Fractions');
      const entry = (await t.entries('plan.shared')).at(-1);
      expect(entry?.new_value).toEqual(
        expect.objectContaining({ journalId: x.other, quarterId: x.q2, items: 3 }),
      );
    });

    it('offers the owner the classes that may join, not those taught by somebody else', async () => {
      const x = await sharedScene();
      const plan = await planIn(x, x.journal);
      expect(plan.shareCandidates.map((one) => one.journalId)).toEqual([x.other]);
      const y = await scene();
      const alone = planSchema.parse(
        ok(
          await get(
            `/api/plans/journals/${y.journal}?quarterId=${y.q2}`,
            y.s.branch,
            y.owner.cookie,
          ),
        ).body,
      );
      expect(alone.shareCandidates).toEqual([]);
    });

    it('one class of a shared plan loses a lesson: that class stands at another item, the other does not move (09)', async () => {
      const x = await sharedScene();
      await fillIn(x, x.journal, [1, 2, 3, 4, 5, 6, 7, 8]);
      ok(await shareOf(x));
      await cancelIn(x, x.s.otherClass, '2026-11-16');
      const own = laid(await planIn(x, x.journal));
      expect(own.rows['2026-11-16']).toBe('Topic 2');
      expect(own.notCovered).toEqual([]);
      const other = laid(await planIn(x, x.other));
      expect(other.rows['2026-11-23']).toBe('Topic 2');
      expect(other.notCovered).toEqual(['Topic 8']);
      const seen = await planIn(x, x.journal, THURSDAY);
      expect(seen.sharedWith[0]?.next).toEqual({ number: 3, date: '2026-11-30', topic: 'Topic 3' });
      expect(seen.sharedWith[0]?.notCovered).toBe(1);
      // A prepared request is per class: the class whose item went to "not covered".
      expect((await planIn(x, x.other)).request?.causes.map((cause) => cause.kind)).toEqual([
        'not_covered',
      ]);
      expect((await planIn(x, x.journal)).request).toBeNull();
    });

    it('refuses to clear an item that stands on a held row of the other class', async () => {
      const x = await sharedScene();
      const items = await fillIn(x, x.journal, [1, 2, 3]);
      ok(await shareOf(x));
      // The own class loses its first lesson: its Topic 3 is on 30 November, the other's on 23 November.
      await cancelIn(x, x.s.classId, '2026-11-09');
      const answer = await at(THURSDAY, () =>
        post(`/api/plans/items/${items[2]?.id ?? ''}/clear`, x.s.branch, x.owner.cookie, {}),
      );
      refused(answer, 409, 'plan_row_held');
    });

    it('joins a class whose own plan is empty (its link moves), and refuses one that gets another teacher later (should-fix 5)', async () => {
      const x = await sharedScene();
      await fillIn(x, x.journal, [1, 2]);
      const [own] = await fillIn(x, x.other, [3]);
      ok(
        await post(`/api/plans/items/${own?.id ?? ''}/clear`, x.s.branch, x.owner.cookie, {}),
        204,
      );
      const emptied = await planIdOf(x.other, x.q2);
      ok(await shareOf(x));
      expect(await planIdOf(x.other, x.q2)).toBe(await planIdOf(x.journal, x.q2));
      expect(await planIdOf(x.other, x.q2)).not.toBe(emptied);
      expect(laid(await planIn(x, x.other)).rows['2026-11-16']).toBe('Topic 2');
      const y = await sharedScene();
      await fillIn(y, y.journal, [1]);
      await publishWith(y, '2026-11-30', async (draft, rows) => {
        for (const row of rows) {
          if (row.class_id === y.s.otherClass) {
            await t.database.migrator
              .updateTable('teaching_load_rows')
              .set({ teacher_id: y.s.spareTeacher.staffId })
              .where('id', '=', row.id)
              .execute();
          }
          await placeAt(y, draft, row.id, 1, row.class_id === y.s.classId ? 1 : 3);
        }
      });
      refused(await shareOf(y), 409, 'plan_share_owner');
    });

    it('lays a mid-quarter join from the first lesson not yet held; the held rows stay empty', async () => {
      const x = await sharedScene();
      await fillIn(x, x.journal, [1, 2]);
      await at(THURSDAY, async () => ok(await shareOf(x)));
      const other = laid(await planIn(x, x.other));
      expect(other.rows['2026-11-09']).toBe('-');
      expect(other.rows['2026-11-23']).toBe('-');
      expect(other.rows['2026-11-30']).toBe('Topic 1');
      expect(other.rows['2026-12-07']).toBe('Topic 2');
    });

    describe('refuses a share', () => {
      it('of another language, grade, kind or subject, of the same plan, or of a class whose plan has items', async () => {
        const x = await sharedScene();
        await fillIn(x, x.journal, [1]);
        await t.database.migrator
          .updateTable('classes')
          .set({ language: 'ru' })
          .where('id', '=', x.s.otherClass)
          .execute();
        refused(await shareOf(x), 409, 'plan_share_language');
        await t.database.migrator
          .updateTable('classes')
          .set({ language: 'uz', grade: 8 })
          .where('id', '=', x.s.otherClass)
          .execute();
        refused(await shareOf(x), 409, 'plan_share_grade');
        await t.database.migrator
          .updateTable('classes')
          .set({ grade: 7 })
          .where('id', '=', x.s.otherClass)
          .execute();
        const group = await load.classes.group(x.s.branch, x.s.year, x.s.subject, [x.s.otherClass]);
        const groupJournal = await journalFor(x, { groupId: group });
        refused(
          await post(`/api/plans/journals/${x.journal}/share`, x.s.branch, x.owner.cookie, {
            quarterId: x.q2,
            journalId: groupJournal,
          }),
          409,
          'plan_share_kind',
        );
        const otherSubject = await load.classes.subject({ grades: [7] });
        const subjectJournal = await journalFor(x, { classId: x.s.otherClass }, otherSubject);
        const shareSubject = () =>
          post(`/api/plans/journals/${x.journal}/share`, x.s.branch, x.owner.cookie, {
            quarterId: x.q2,
            journalId: subjectJournal,
          });
        // A journal the teacher may not read is told nothing of (permission review, must-fix 1).
        refused(await shareSubject(), 403, 'plan_scope');
        await t.database.migrator
          .insertInto('staff_subjects')
          .values({ staff_id: x.s.teacher.staffId, subject_id: otherSubject, grades: [7] })
          .execute();
        refused(await shareSubject(), 409, 'plan_share_subject');
        refused(
          await post(`/api/plans/journals/${x.journal}/share`, x.s.branch, x.owner.cookie, {
            quarterId: x.q2,
            journalId: x.journal,
          }),
          409,
          'plan_share_same',
        );
        await fillIn(x, x.other, [2]);
        refused(await shareOf(x), 409, 'plan_share_has_items');
        expect(
          (await t.entries('plan.shared')).filter((entry) =>
            JSON.stringify(entry).includes(x.other),
          ),
        ).toEqual([]);
      });

      it('of a class the reader does not teach (a Teacher of the branch), and to a teacher who owns neither', async () => {
        const x = await scene();
        await fill(x, [1]);
        const other = (
          await t.database.migrator
            .selectFrom('journals')
            .select('id')
            .where('class_id', '=', x.s.otherClass)
            .executeTakeFirstOrThrow()
        ).id;
        const body = { quarterId: x.q2, journalId: other };
        refused(
          await post(`/api/plans/journals/${x.journal}/share`, x.s.branch, x.owner.cookie, body),
          403,
          'plan_scope',
        );
        refused(
          await post(`/api/plans/journals/${x.journal}/share`, x.s.branch, x.spare.cookie, body),
          403,
          'plan_scope',
        );
      });

      it('and a separate and a copy, in a closed plan and in a closed year', async () => {
        const x = await sharedScene();
        await fillIn(x, x.journal, [1]);
        ok(await shareOf(x));
        const copyBody = {
          quarterId: x.q2,
          source: { journalId: x.other, quarterId: x.q2 },
          part: 'all',
        };
        await publishWith(x, '2026-11-02', async (draft, rows) => {
          for (const row of rows) {
            if (row.class_id === x.s.classId) {
              await t.database.migrator
                .deleteFrom('teaching_load_rows')
                .where('id', '=', row.id)
                .execute();
            } else {
              await placeAt(x, draft, row.id, 1, 3);
            }
          }
        });
        const path = `/api/plans/journals/${x.journal}`;
        refused(await shareOf(x), 409, 'plan_closed');
        refused(
          await post(`${path}/separate`, x.s.branch, x.owner.cookie, { quarterId: x.q2 }),
          409,
          'plan_closed',
        );
        refused(
          await post(`${path}/copy`, x.s.branch, x.owner.cookie, copyBody),
          409,
          'plan_closed',
        );
        const y = await sharedScene();
        await fillIn(y, y.journal, [1]);
        ok(await shareOf(y));
        await t.database.migrator
          .updateTable('academic_years')
          .set({ status: 'closed' })
          .where('id', '=', y.s.year)
          .execute();
        const yPath = `/api/plans/journals/${y.journal}`;
        refused(await shareOf(y), 409, 'plan_year_closed');
        refused(
          await post(`${yPath}/separate`, y.s.branch, y.owner.cookie, { quarterId: y.q2 }),
          409,
          'plan_year_closed',
        );
        refused(
          await post(`${yPath}/copy`, y.s.branch, y.owner.cookie, {
            ...copyBody,
            quarterId: y.q2,
            source: { journalId: y.other, quarterId: y.q2 },
          }),
          409,
          'plan_year_closed',
        );
      });
    });

    describe('separates a plan by hand', () => {
      it('with a copy of every item, its works, files and mark at its rows; the prepared request goes with it; no text changes (edge; decision 7)', async () => {
        const x = await sharedScene();
        const [first] = await fillIn(x, x.journal, [1, 2, 3, 4, 5, 6, 7, 8]);
        ok(await shareOf(x));
        // A work and a file on the first item, a "moved from" on its place in the other class.
        ok(
          await request(t.kit.server)
            .put(`/api/plans/items/${first?.id ?? ''}`)
            .set('Cookie', x.owner.cookie)
            .set(BRANCH_HEADER, x.s.branch)
            .send({
              base: { topic: 'Topic 1', objectives: '', links: [], classworks: [], homeworks: [] },
              values: {
                ...values('Topic 1'),
                classworks: [{ title: 'Exercise 1', description: '' }],
              },
            }),
        );
        await t.database.migrator
          .insertInto('lesson_plan_files')
          .values({
            branch_id: x.s.branch,
            item_id: first?.id ?? '',
            name: 'Sheet.pdf',
            type: 'application/pdf',
            bytes: 100,
          })
          .execute();
        await t.database.migrator
          .updateTable('lesson_plan_places')
          .set({ moved_from: '2026-11-02' })
          .where('item_id', '=', first?.id ?? '')
          .where('journal_id', '=', x.other)
          .execute();
        // The other class loses a lesson: its last item is not covered and a request is prepared.
        await cancelIn(x, x.s.otherClass, '2026-11-16');
        const prepared = (await planIn(x, x.other)).request;
        expect(prepared?.causes.map((cause) => cause.kind)).toEqual(['not_covered']);
        const before = await planIdOf(x.journal, x.q2);
        const answer = planSchema.parse(
          ok(
            await post(`/api/plans/journals/${x.other}/separate`, x.s.branch, x.owner.cookie, {
              quarterId: x.q2,
            }),
          ).body,
        );
        expect(answer.sharedWith).toEqual([]);
        expect(await planIdOf(x.journal, x.q2)).toBe(before);
        expect(await planIdOf(x.other, x.q2)).not.toBe(before);
        const copied = answer.rows[0]?.item;
        expect(copied?.topic).toBe('Topic 1');
        expect(copied?.id).not.toBe(first?.id);
        expect(copied?.classworks.map((work) => work.title)).toEqual(['Exercise 1']);
        expect(copied?.files.map((file) => file.name)).toEqual(['Sheet.pdf']);
        expect(copied?.movedFrom).toBe('2026-11-02');
        expect(copied?.copiedFrom).toEqual({ journalId: x.journal, quarterId: x.q2 });
        expect(laid(answer).rows['2026-11-23']).toBe('Topic 2');
        expect(laid(answer).notCovered).toEqual(['Topic 8']);
        // The request moved with the link; separating prepared nothing new.
        expect(answer.request).toEqual(prepared);
        expect((await planIn(x, x.journal)).request).toBeNull();
        expect(laid(await planIn(x, x.journal)).rows['2026-11-23']).toBe('Topic 3');
        expect((await planIn(x, x.journal)).sharedWith).toEqual([]);
        const entry = (await t.entries('plan.separated')).at(-1);
        expect(entry?.new_value).toEqual(
          expect.objectContaining({ journalId: x.other, cause: 'by_owner', items: 8 }),
        );
      });

      it('refuses a plan that is not shared, and a teacher who does not own it', async () => {
        const x = await sharedScene();
        await fillIn(x, x.journal, [1]);
        refused(
          await post(`/api/plans/journals/${x.journal}/separate`, x.s.branch, x.owner.cookie, {
            quarterId: x.q2,
          }),
          409,
          'plan_not_shared',
        );
        ok(await shareOf(x));
        refused(
          await post(`/api/plans/journals/${x.other}/separate`, x.s.branch, x.spare.cookie, {
            quarterId: x.q2,
          }),
          403,
          'plan_scope',
        );
      });
    });

    describe('copies a plan', () => {
      const copyOf = (
        x: Shared,
        source: string,
        part: 'all' | 'remaining',
        moment = START,
        quarterId = x.q2,
      ) =>
        at(moment, () =>
          post(`/api/plans/journals/${x.journal}/copy`, x.s.branch, x.owner.cookie, {
            quarterId: x.q2,
            source: { journalId: source, quarterId },
            part,
          }),
        );

      it('from another class: the items in order; a shortage leaves empty rows, items that do not fit are not covered (edge)', async () => {
        const x = await sharedScene();
        await fillIn(x, x.other, [1, 2, 3]);
        const short = planSchema.parse(ok(await copyOf(x, x.other, 'all')).body);
        expect(laid(short).rows['2026-11-23']).toBe('Topic 3');
        expect(laid(short).rows['2026-11-30']).toBe('-');
        expect(short.rows[0]?.item?.copiedFrom).toEqual({ journalId: x.other, quarterId: x.q2 });
        const y = await sharedScene();
        await fillIn(y, y.other, [1, 2, 3, 4, 5, 6, 7, 8]);
        await cancelIn(y, y.s.classId, '2026-11-09');
        const long = planSchema.parse(ok(await copyOf(y, y.other, 'all')).body);
        expect(laid(long).rows['2026-11-16']).toBe('Topic 1');
        expect(laid(long).notCovered).toEqual(['Topic 8']);
        const entry = (await t.entries('plan.copied')).at(-1);
        expect(entry?.new_value).toEqual(
          expect.objectContaining({ sourceJournalId: y.other, part: 'all', items: 8 }),
        );
      });

      it('only the remaining items, from the first lesson not yet held, keeping an item of a held row (edge, two groups merged; review decision 9)', async () => {
        const x = await sharedScene();
        await fillIn(x, x.other, [1, 2, 3, 4, 5]);
        await fillIn(x, x.journal, [1]);
        const plan = planSchema.parse(ok(await copyOf(x, x.other, 'remaining', THURSDAY)).body);
        const rows = laid(plan).rows;
        expect(rows['2026-11-09']).toBe('Topic 1');
        expect(rows['2026-11-16']).toBe('-');
        expect(rows['2026-11-23']).toBe('-');
        expect(rows['2026-11-30']).toBe('Topic 4');
        expect(rows['2026-12-07']).toBe('Topic 5');
      });

      it('from last year', async () => {
        const m = t.database.migrator;
        // Last year first, closed before the scene's year is made.
        const branch = await t.newBranch();
        const lastYear = await load.classes.year(branch, 'current', '2025-09-01', '2026-05-31');
        await m
          .updateTable('quarters')
          .set({ start_date: '2025-11-10', end_date: '2025-12-27' })
          .where('academic_year_id', '=', lastYear)
          .where('number', '=', 2)
          .execute();
        const lastQuarter = (
          await m
            .selectFrom('quarters')
            .select('id')
            .where('academic_year_id', '=', lastYear)
            .where('number', '=', 2)
            .executeTakeFirstOrThrow()
        ).id;
        const lastClass = await load.classes.schoolClass(branch, lastYear, { grade: 7 });
        const subject = await load.classes.subject({ grades: [7], journalType: 'graded' });
        const lastJournal = (
          await m
            .insertInto('journals')
            .values({
              branch_id: branch,
              academic_year_id: lastYear,
              class_id: lastClass,
              group_id: null,
              subject_id: subject,
              runs: '{[2025-09-08,2026-05-30)}',
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
        // Task 7.2: the journal's plan records are made with it (0117).
        const lastPlan = (
          await m
            .selectFrom('lesson_plan_journals')
            .select('plan_id')
            .where('journal_id', '=', lastJournal)
            .where('quarter_id', '=', lastQuarter)
            .executeTakeFirstOrThrow()
        ).plan_id;
        for (const [index, topic] of ['Sets', 'Ratios'].entries()) {
          const item = await m
            .insertInto('lesson_plan_items')
            .values({ branch_id: branch, plan_id: lastPlan, topic })
            .returning('id')
            .executeTakeFirstOrThrow();
          await m
            .insertInto('lesson_plan_places')
            .values({
              branch_id: branch,
              plan_id: lastPlan,
              journal_id: lastJournal,
              item_id: item.id,
              position: index + 1,
            })
            .execute();
        }
        await load.classes.setYear(lastYear, 'closed');
        const x = await sharedScene(branch, subject);
        const plan = planSchema.parse(
          ok(await copyOf(x, lastJournal, 'all', START, lastQuarter)).body,
        );
        expect(laid(plan).rows['2026-11-09']).toBe('Sets');
        expect(laid(plan).rows['2026-11-16']).toBe('Ratios');
      });

      it('refuses a plan with items on lessons not yet held, the same plan, another subject or grade, and a plan the reader may not read', async () => {
        const x = await sharedScene();
        await fillIn(x, x.other, [1]);
        await fillIn(x, x.journal, [5]);
        refused(await copyOf(x, x.other, 'all'), 409, 'plan_not_empty');
        const y = await sharedScene();
        await fillIn(y, y.journal, [1]);
        ok(await shareOf(y));
        refused(await copyOf(y, y.other, 'all'), 409, 'plan_copy_same');
        const z = await sharedScene();
        const eighth = await load.classes.schoolClass(z.s.branch, z.s.year, { grade: 8 });
        const otherSubject = await load.classes.subject({ grades: [7] });
        const unreadSubject = await journalFor(z, { classId: z.s.otherClass }, otherSubject);
        // Unread: neither the subject nor its grade is in the teacher's profile.
        refused(await copyOf(z, unreadSubject, 'all'), 403, 'plan_scope');
        await t.database.migrator
          .updateTable('subjects')
          .set({ grades: [7, 8] })
          .where('id', '=', z.s.subject)
          .execute();
        await t.database.migrator
          .updateTable('staff_subjects')
          .set({ grades: [7, 8] })
          .where('staff_id', '=', z.s.teacher.staffId)
          .execute();
        await t.database.migrator
          .insertInto('staff_subjects')
          .values({ staff_id: z.s.teacher.staffId, subject_id: otherSubject, grades: [7] })
          .execute();
        refused(await copyOf(z, unreadSubject, 'all'), 409, 'plan_copy_subject');
        refused(
          await copyOf(z, await journalFor(z, { classId: eighth }), 'all'),
          409,
          'plan_copy_grade',
        );
      });
    });

    it("answers 404 for another branch's or an unknown journal or quarter on share, separate and copy, and writes nothing", async () => {
      // Each scene is one where the request with valid ids would write
      // (permission review of the code, must-fix 3): a share of an empty
      // class, a separate of a shared plan, a copy into an empty plan.
      const a = await sharedScene();
      await fillIn(a, a.journal, [1]);
      const b = await sharedScene();
      await fillIn(b, b.journal, [1]);
      ok(await shareOf(b));
      const c = await sharedScene();
      await fillIn(c, c.other, [1]);
      const y = await sharedScene();
      await fillIn(y, y.journal, [1]);
      ok(await shareOf(y));
      const scenes = [a, b, c, y];
      const rows = async () => Promise.all(scenes.map((one) => t.rowsOf(one.s.branch)));
      const planEntries = () =>
        t.database.migrator
          .selectFrom('audit_log')
          .selectAll()
          .where('action', 'like', 'plan.%')
          .orderBy('id')
          .execute();
      const before = await rows();
      const entries = await planEntries();
      const unknown = randomUUID();
      const send = (x: Shared, journal: string, action: string, body: object) =>
        post(`/api/plans/journals/${journal}/${action}`, x.s.branch, x.owner.cookie, body);
      const copyBody = (journalId: string, quarterId: string, target = c.q2) => ({
        quarterId: target,
        source: { journalId, quarterId },
        part: 'all',
      });
      for (const answer of [
        await send(a, unknown, 'share', { quarterId: a.q2, journalId: a.other }),
        await send(a, y.journal, 'share', { quarterId: a.q2, journalId: a.other }),
        await send(a, a.journal, 'share', { quarterId: a.q2, journalId: unknown }),
        await send(a, a.journal, 'share', { quarterId: a.q2, journalId: y.other }),
        await send(a, a.journal, 'share', { quarterId: unknown, journalId: a.other }),
        await send(a, a.journal, 'share', { quarterId: y.q2, journalId: a.other }),
        await send(b, unknown, 'separate', { quarterId: b.q2 }),
        await send(b, y.journal, 'separate', { quarterId: y.q2 }),
        await send(b, b.journal, 'separate', { quarterId: unknown }),
        await send(b, b.journal, 'separate', { quarterId: y.q2 }),
        await send(c, unknown, 'copy', copyBody(c.other, c.q2)),
        await send(c, y.journal, 'copy', copyBody(c.other, c.q2)),
        await send(c, c.journal, 'copy', copyBody(unknown, c.q2)),
        await send(c, c.journal, 'copy', copyBody(y.other, y.q2)),
        await send(c, c.journal, 'copy', copyBody(c.other, unknown)),
        await send(c, c.journal, 'copy', copyBody(c.other, y.q2)),
        await send(c, c.journal, 'copy', copyBody(c.other, c.q2, unknown)),
        await send(c, c.journal, 'copy', copyBody(c.other, c.q2, y.q2)),
      ]) {
        expect(answer.status, JSON.stringify(answer.body)).toBe(404);
      }
      expect(await rows()).toEqual(before);
      expect(await planEntries()).toEqual(entries);
      // The same requests with valid ids write: the fixtures can fail.
      ok(await send(a, a.journal, 'share', { quarterId: a.q2, journalId: a.other }));
      ok(await send(b, b.journal, 'separate', { quarterId: b.q2 }));
      ok(await send(c, c.journal, 'copy', copyBody(c.other, c.q2)));
    });

    describe('a teacher who shares a plan loses one class (edge)', () => {
      /** Publishes from 16 November with the class's row given to `teacher`. */
      const giveClass = (
        x: Shared,
        classId: string,
        teacher: string,
        startsOn = '2026-11-16',
        copyFrom = x.s.version,
      ) =>
        publishWith(
          x,
          startsOn,
          async (draft, rows) => {
            for (const row of rows) {
              if (row.class_id === classId) {
                await t.database.migrator
                  .updateTable('teaching_load_rows')
                  .set({ teacher_id: teacher })
                  .where('id', '=', row.id)
                  .execute();
              }
              await placeAt(x, draft, row.id, 1, row.class_id === x.s.classId ? 1 : 3);
            }
          },
          true,
          copyFrom,
        );

      for (const lost of ['other', 'own'] as const) {
        it(`separates the ${lost === 'own' ? 'first' : 'second'} class's plan; the new teacher owns it and gets a request; the other class keeps the plan`, async () => {
          const x = await sharedScene();
          await fillIn(x, x.journal, [1, 2, 3]);
          ok(await shareOf(x));
          const kept = await planIdOf(x.journal, x.q2);
          const [leaving, staying] = lost === 'own' ? [x.journal, x.other] : [x.other, x.journal];
          const given = await giveClass(
            x,
            lost === 'own' ? x.s.classId : x.s.otherClass,
            x.s.spareTeacher.staffId,
          );
          expect(await planIdOf(staying, x.q2)).toBe(kept);
          expect(await planIdOf(leaving, x.q2)).not.toBe(kept);
          const separated = await planIn(x, leaving);
          expect(laid(separated).rows['2026-11-23']).toBe('Topic 3');
          expect(separated.request?.causes.map((cause) => [cause.kind, cause.onDate])).toEqual([
            ['owner_changed', '2026-11-16'],
          ]);
          expect(separated.sharedWith).toEqual([]);
          expect(await noticesOf(x.spare.account.id, 'plans.followed')).toEqual([
            { requested: separated.unit.name, moved: '—' },
          ]);
          const entry = (await t.entries('plan.separated')).at(-1);
          expect(entry?.new_value).toEqual(
            expect.objectContaining({ journalId: leaving, cause: 'owner_changed' }),
          );
          // Taken back: the plans stay separate (decision 6).
          await giveClass(
            x,
            lost === 'own' ? x.s.classId : x.s.otherClass,
            x.s.teacher.staffId,
            '2026-11-30',
            given,
          );
          expect(await planIdOf(leaving, x.q2)).not.toBe(kept);
          expect((await planIn(x, staying)).sharedWith).toEqual([]);
        });
      }

      for (const changed of ['first', 'second'] as const) {
        it(`separates the class whose language the Academic Vice Principal changes, the ${changed} by unit order; the other keeps the plan (decision 17; code review, must-fix 1)`, async () => {
          const x = await sharedScene();
          await fillIn(x, x.journal, [1, 2]);
          ok(await shareOf(x));
          const kept = await planIdOf(x.journal, x.q2);
          // Which class sorts first is the order of their names.
          const names = await t.database.migrator
            .selectFrom('classes')
            .select(['id', 'name'])
            .where('id', 'in', [x.s.classId, x.s.otherClass])
            .orderBy('name')
            .execute();
          const classId = (changed === 'first' ? names[0] : names[1])?.id ?? '';
          const [leaving, staying] =
            classId === x.s.classId ? [x.journal, x.other] : [x.other, x.journal];
          await t.database.migrator
            .insertInto('staff_languages')
            .values({ staff_id: x.s.teacher.staffId, language: 'ru' })
            .execute();
          const read = (
            await request(t.kit.server)
              .get(`/api/classes/${classId}`)
              .set('Cookie', t.admin)
              .set(BRANCH_HEADER, x.s.branch)
          ).body as { grade: number; name: string; maxSize: number; version: number };
          ok(
            await t.put(`/api/classes/${classId}`, x.s.branch, {
              grade: read.grade,
              name: read.name,
              language: 'ru',
              mainRoomId: null,
              maxSize: read.maxSize,
              version: read.version,
              confirmMixedGroups: true,
            }),
          );
          expect(await planIdOf(staying, x.q2)).toBe(kept);
          expect(await planIdOf(leaving, x.q2)).not.toBe(kept);
          expect(laid(await planIn(x, leaving)).rows['2026-11-16']).toBe('Topic 2');
          const entry = (await t.entries('plan.separated')).at(-1);
          expect(entry?.new_value).toEqual(
            expect.objectContaining({ journalId: leaving, cause: 'unit_changed' }),
          );
        });
      }

      it('separates a group whose class list gains a class of another grade (correction 1)', async () => {
        const x = await sharedScene();
        const m = t.database.migrator;
        await m
          .updateTable('subjects')
          .set({ grades: [7, 8] })
          .where('id', '=', x.s.subject)
          .execute();
        const first = await load.classes.group(x.s.branch, x.s.year, x.s.subject, [x.s.classId]);
        const second = await load.classes.group(x.s.branch, x.s.year, x.s.subject, [
          x.s.otherClass,
        ]);
        const firstJournal = await journalFor(x, { groupId: first });
        const secondJournal = await journalFor(x, { groupId: second });
        // Task 7.2: each journal has its plan record (0117); the second joins the first's.
        const plan = (
          await m
            .selectFrom('lesson_plan_journals')
            .select('plan_id')
            .where('journal_id', '=', firstJournal)
            .where('quarter_id', '=', x.q2)
            .executeTakeFirstOrThrow()
        ).plan_id;
        await m
          .updateTable('lesson_plan_journals')
          .set({ plan_id: plan })
          .where('journal_id', '=', secondJournal)
          .where('quarter_id', '=', x.q2)
          .execute();
        await m
          .updateTable('lesson_plans')
          .set({ shared_unit: 'group|7|uz' })
          .where('id', '=', plan)
          .execute();
        const eighth = await load.classes.schoolClass(x.s.branch, x.s.year, { grade: 8 });
        // A transaction of the application, with the follow before its commit,
        // writes the group's classes as the group edit does.
        await t.app.get(Transactions).run([x.s.branch], async (transaction) => {
          await transaction
            .updateTable('groups')
            .set({ name: 'Mixed 7-8' })
            .where('id', '=', second)
            .execute();
          await transaction
            .insertInto('group_classes')
            .values({ branch_id: x.s.branch, group_id: second, class_id: eighth })
            .execute();
        });
        expect(await planIdOf(firstJournal, x.q2)).toBe(plan);
        expect(await planIdOf(secondJournal, x.q2)).not.toBe(plan);
        const entry = (await t.entries('plan.separated')).at(-1);
        expect(entry?.new_value).toEqual(
          expect.objectContaining({ journalId: secondJournal, cause: 'unit_changed' }),
        );
      });
    });

    describe('at the same moment', () => {
      async function holdRow(lock: ReturnType<typeof sql>, write?: ReturnType<typeof sql>) {
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
          if (write !== undefined) await write.execute(transaction);
          const pid = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(
            transaction,
          );
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

      async function waitingOn(pid: number, count: number): Promise<void> {
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

      const started = (send: () => PromiseLike<Response>) =>
        new Promise<Response>((resolve, reject) => {
          send().then(resolve, reject);
        });

      const classEdit = async (x: Shared) => {
        const read = (
          await request(t.kit.server)
            .get(`/api/classes/${x.s.otherClass}`)
            .set('Cookie', t.admin)
            .set(BRANCH_HEADER, x.s.branch)
        ).body as { grade: number; name: string; maxSize: number; version: number };
        await t.database.migrator
          .insertInto('staff_languages')
          .values({ staff_id: x.s.teacher.staffId, language: 'ru' })
          .execute();
        return () =>
          t.put(`/api/classes/${x.s.otherClass}`, x.s.branch, {
            grade: read.grade,
            name: read.name,
            language: 'ru',
            mainRoomId: null,
            maxSize: read.maxSize,
            version: read.version,
            confirmMixedGroups: true,
          });
      };

      it('a share and a language change, the change first: the share waits on the class and is refused plan_share_language (correction 2)', async () => {
        const x = await sharedScene();
        await fillIn(x, x.journal, [1]);
        // The class edit, held after its write: it holds the class row.
        const held = await holdRow(
          sql`select id from classes where id = ${x.s.otherClass} for update`,
          sql`update classes set language = 'ru' where id = ${x.s.otherClass}`,
        );
        const shared = started(() => shareOf(x));
        await waitingOn(held.pid, 1);
        await held.release();
        refused(await shared, 409, 'plan_share_language');
      });

      it('a share and a language change, the share first: the change waits on the class, then its follow separates the class (unit_changed)', async () => {
        const x = await sharedScene();
        await fillIn(x, x.journal, [1]);
        const edit = await classEdit(x);
        // A third transaction holds the own journal: the share waits there, holding the classes.
        const held = await holdRow(
          sql`select id from journals where id = ${x.journal} for no key update`,
        );
        const shared = started(() => shareOf(x));
        await waitingOn(held.pid, 1);
        const edited = started(edit);
        await new Promise((resolve) => setTimeout(resolve, 200));
        const waits = await sql<{ count: number }>`
          select count(*)::int as count from pg_stat_activity a
          where a.datname = current_database() and cardinality(pg_blocking_pids(a.pid)) > 0
        `.execute(t.database.migrator);
        expect(waits.rows[0]?.count).toBe(2);
        await held.release();
        ok(await shared);
        ok(await edited);
        expect(await planIdOf(x.other, x.q2)).not.toBe(await planIdOf(x.journal, x.q2));
        const entry = (await t.entries('plan.separated')).at(-1);
        expect(entry?.new_value).toEqual(
          expect.objectContaining({ journalId: x.other, cause: 'unit_changed' }),
        );
      });

      it('a create in a shared plan and a cancel in the other class, the cancel first: the item is laid after the shift', async () => {
        const x = await sharedScene();
        const [, , fourth] = await fillIn(x, x.journal, [1, 2, 4]);
        ok(await shareOf(x));
        const own = await planIn(x, x.journal);
        // The cancel's follow holds the journals, then waits on the place it
        // moves (the empty third row absorbs the shift: Topic 4 moves up).
        const held = await holdRow(
          sql`select item_id from lesson_plan_places where item_id = ${fourth?.id ?? ''} and journal_id = ${x.other} for update`,
        );
        const lesson = await lessonOf(x.s.otherClass, x.s.subject, '2026-11-09');
        const cancelled = started(() =>
          keyed(`/api/timetable/lessons/${lesson.id}/cancel`, x.s.branch, { reason: 'Excursion' }),
        );
        await waitingOn(held.pid, 1);
        const created = started(() =>
          post(`/api/plans/journals/${x.journal}/items`, x.s.branch, x.owner.cookie, {
            quarterId: x.q2,
            position: 3,
            lessonId: own.rows[2]?.lessonId ?? '',
            values: values('Topic 3'),
          }),
        );
        await waitingOn(held.pid, 2);
        await held.release();
        ok(await cancelled);
        ok(await created, 201);
        const other = laid(await planIn(x, x.other));
        expect(other.rows['2026-11-16']).toBe('Topic 1');
        expect(other.rows['2026-11-23']).toBe('Topic 2');
        expect(other.rows['2026-11-30']).toBe('Topic 3');
        expect(other.rows['2026-12-07']).toBe('Topic 4');
      });

      it('a create in a shared plan and a cancel in the other class, the create first: the cancel waits on the create and follows the new item (code review, must-fix 3)', async () => {
        const x = await sharedScene();
        const [, , fourth] = await fillIn(x, x.journal, [1, 2, 4]);
        ok(await shareOf(x));
        // The other class lays Topic 4 on its third row, so the create moves it up there.
        await t.database.migrator
          .updateTable('lesson_plan_places')
          .set({ position: 3 })
          .where('item_id', '=', fourth?.id ?? '')
          .where('journal_id', '=', x.other)
          .execute();
        const own = await planIn(x, x.journal);
        // The create holds the journals of the plan and waits on that place.
        const held = await holdRow(
          sql`select item_id from lesson_plan_places where item_id = ${fourth?.id ?? ''} and journal_id = ${x.other} for update`,
        );
        const created = started(() =>
          post(`/api/plans/journals/${x.journal}/items`, x.s.branch, x.owner.cookie, {
            quarterId: x.q2,
            position: 3,
            lessonId: own.rows[2]?.lessonId ?? '',
            values: values('Topic 3'),
          }),
        );
        await waitingOn(held.pid, 1);
        const lesson = await lessonOf(x.s.otherClass, x.s.subject, '2026-11-09');
        const cancelled = started(() =>
          keyed(`/api/timetable/lessons/${lesson.id}/cancel`, x.s.branch, { reason: 'Excursion' }),
        );
        // The cancel waits behind the create (on the journals it holds).
        await waitingOn(held.pid, 2);
        await held.release();
        ok(await created, 201);
        ok(await cancelled);
        const other = laid(await planIn(x, x.other));
        expect(other.rows['2026-11-16']).toBe('Topic 1');
        expect(other.rows['2026-11-23']).toBe('Topic 2');
        expect(other.rows['2026-11-30']).toBe('Topic 3');
        expect(other.rows['2026-12-07']).toBe('Topic 4');
      });

      for (const order of ['own first', 'other first'] as const) {
        it(`two cancels in the two classes of one shared plan, the ${order}: the second waits on the journals and each class follows its own lessons`, async () => {
          const x = await sharedScene();
          await fillIn(x, x.journal, [1, 2, 3, 4, 5, 6, 7, 8]);
          ok(await shareOf(x));
          const ownLesson = await lessonOf(x.s.classId, x.s.subject, '2026-11-09');
          const otherLesson = await lessonOf(x.s.otherClass, x.s.subject, '2026-11-16');
          const [firstLesson, secondLesson] =
            order === 'own first' ? [ownLesson, otherLesson] : [otherLesson, ownLesson];
          const cancel = (id: string) => () =>
            keyed(`/api/timetable/lessons/${id}/cancel`, x.s.branch, { reason: 'Excursion' });
          // The first cancel's follow holds the journals and waits on the
          // snapshot of its class, which it writes again.
          const journal = order === 'own first' ? x.journal : x.other;
          const held = await holdRow(
            sql`select position from lesson_plan_rows where journal_id = ${journal} and position = 1 for update`,
          );
          const first = started(cancel(firstLesson.id));
          await waitingOn(held.pid, 1);
          const second = started(cancel(secondLesson.id));
          await waitingOn(held.pid, 2);
          await held.release();
          ok(await first);
          ok(await second);
          const own = laid(await planIn(x, x.journal));
          expect(own.rows['2026-11-16']).toBe('Topic 1');
          expect(own.notCovered).toEqual(['Topic 8']);
          const other = laid(await planIn(x, x.other));
          expect(other.rows['2026-11-09']).toBe('Topic 1');
          expect(other.rows['2026-11-23']).toBe('Topic 2');
          expect(other.notCovered).toEqual(['Topic 8']);
        });
      }
    });
  });
});
