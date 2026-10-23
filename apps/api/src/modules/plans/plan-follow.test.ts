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
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import {
  hoursOf,
  publishedScene,
  publishOf,
  type PublishedScene,
} from '../../testing/published-scene.js';

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
  ) {
    const created = ok(
      await t.post('/api/timetable/versions', x.s.branch, {
        academicYearId: x.s.year,
        startsOn,
        copyFrom: x.s.version,
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
      expect(plan.request).toEqual({
        fromDate: '2026-11-16',
        causes: [{ kind: 'not_covered', onDate: '2026-11-16', items: 1 }],
      });
      expect(await noticesOf(x.owner.account.id, 'plans.followed')).toEqual([
        { units: await unitOf(x), plans: 1, requests: 1 },
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
        { units: await unitOf(x), plans: 1, requests: 0 },
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
      const back = laid(await planOf(y));
      expect(back.notCovered).toEqual([]);
      expect(back.rows['2026-11-09']).toBe('Topic 1');
      expect(back.rows['2026-12-28']).toBe('Topic 8');
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
      const plan = await planOf(x);
      expect(laid(plan).rows['2026-11-09']).toBe('Topic 1');
      expect(plan.request?.causes).toEqual([
        { kind: 'owner_changed', onDate: '2026-11-16', items: 0 },
      ]);
      // Review correction 1: the new owner is told.
      expect(await noticesOf(x.spare.account.id, 'plans.followed')).toEqual([
        { units: await unitOf(x), plans: 1, requests: 1 },
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
        { units: await unitOf(x), plans: 1, requests: 1 },
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
        { units: await unitOf(x), plans: 1, requests: 1 },
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
      const rowsOf = async () => ({
        plans: await t.database.migrator
          .selectFrom('lesson_plan_items')
          .selectAll()
          .where('branch_id', 'in', [x.s.branch, y.s.branch])
          .orderBy('id')
          .execute(),
        audit: await t.database.migrator
          .selectFrom('audit_log')
          .select('id')
          .where('branch_id', 'in', [x.s.branch, y.s.branch])
          .execute(),
      });
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
          notFitting: ['Topic 5', 'Topic 6', 'Topic 7', 'Topic 8'],
          emptyRows: 0,
        }),
      ]);
    });
  });

  describe('at the same moment', () => {
    it("two cancels of one journal: the second waits on the journal and follows the first one's snapshot", async () => {
      const x = await scene();
      await fill(x, [1, 2, 3, 4, 5, 6, 7, 8]);
      const first = await lessonOn(x.s, '2026-11-09');
      const second = await lessonOn(x.s, '2026-11-16');
      // Hold the journal row as a plan write does, start both cancels, then release.
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked: () => void = () => undefined;
      const holding = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const held = t.database.migrator.transaction().execute(async (transaction) => {
        await sql`select id from journals where id = ${x.journal} for no key update`.execute(
          transaction,
        );
        locked();
        await released;
      });
      await holding;
      const run = (id: string) =>
        new Promise<Response>((resolve, reject) => {
          keyed(`/api/timetable/lessons/${id}/cancel`, x.s.branch, { reason: 'Excursion' }).then(
            resolve,
            reject,
          );
        });
      const both = [run(first.id), run(second.id)];
      // Both wait on the held journal row (the follow's lock).
      for (let tries = 0; tries < 200; tries += 1) {
        const waiting = await sql<{ count: number }>`
          select count(*)::int as count from pg_locks l
          join pg_stat_activity a on a.pid = l.pid
          where not l.granted and a.datname = current_database()
        `.execute(t.database.migrator);
        if ((waiting.rows[0]?.count ?? 0) >= 1) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      release();
      await held;
      for (const response of await Promise.all(both)) ok(response);
      const plan = laid(await planOf(x));
      expect(plan.rows['2026-11-23']).toBe('Topic 1');
      expect(plan.rows['2026-12-28']).toBe('Topic 6');
      expect(plan.notCovered).toEqual(['Topic 7', 'Topic 8']);
    });
  });
});
