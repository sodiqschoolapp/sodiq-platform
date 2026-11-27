import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  lessonDeliveryAnswerSchema,
  planItemSchema,
  planSchema,
  type Plan,
  type PlanItem,
  type PlanTrayItem,
} from '@sodiq/shared';
import request, { type Response, type Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { openPlanWindows } from '../../testing/plan-windows-kit.js';
import { publishedScene } from '../../testing/published-scene.js';

/** Tuesday 27 October 2026, noon in Tashkent: the first quarter's Mondays 12, 19 and 26 October
 * are held, the second quarter's lessons are all ahead. */
const MOMENT = '2026-10-27T12:00:00+05:00';

/** Thursday 26 November 2026: the Mondays 9, 16 and 23 November of the second quarter are held. */
const THURSDAY = '2026-11-26T12:00:00+05:00';

const ok = (response: Response, status = 200): unknown => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response.body;
};

/** The codes of an item as a reader sees them: topic, each classwork, each homework. */
const codesOf = (item: PlanItem | PlanTrayItem | null | undefined) =>
  item == null
    ? undefined
    : [
        item.topicCode,
        item.classworks.map((one) => one.code),
        item.homeworks.map((one) => one.code),
      ];

const CODED = ['F1', ['Q1'], ['H1']];
const HIDDEN = [null, [null], [null]];
const STORED = {
  topic: 'F1',
  works: [
    ['Quiz', 'Q1'],
    ['Exercise 5', 'H1'],
  ],
};

/** The values of a new item: a topic, a classwork and a homework, each with its code. */
const coded = (topic = 'Fractions') => ({
  topic,
  topicCode: 'F1',
  objectives: '',
  links: [],
  classworks: [{ title: 'Quiz', description: '', code: 'Q1' }],
  homeworks: [{ title: 'Exercise 5', description: '', code: 'H1' }],
});

const plain = (topic: string) => ({
  topic,
  objectives: '',
  links: [],
  classworks: [],
  homeworks: [],
});

// All names are invented. Task 11.27 (pull request #399), review round 1, finding 1:
// docs/spec/09-lesson-plans.md, Codes, Copies: "Codes are copied with a plan (from another class,
// another teacher or last year)"; `.claude/rules/lesson-plans.md`: "A column added to the place
// or the item of a plan … is copied wherever places or items are copied (a separation, a copy),
// with a test that reads it after the copy". The system's copies carry the stored codes whatever
// the switch (plan decision 2); a reader sees them only while on.
describe('codes go with every copy of plan items (task 11.27)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;
  const given = new Set<string>();

  interface Api {
    get(path: string): Test;
    post(path: string, body?: object): Test;
    put(path: string, body: object): Test;
  }

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Shahnoza', `Rahimova${'a'.repeat(names % 6)}`);
  };

  const apiOf = (branch: string, cookie: string): Api => ({
    get: (path) => request(t.kit.server).get(path).set('Cookie', cookie).set(BRANCH_HEADER, branch),
    post: (path, body = {}) =>
      request(t.kit.server).post(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body),
    put: (path, body) =>
      request(t.kit.server).put(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body),
  });

  /** Runs `work` as the owner, a Teacher of the branch from 1 September, at `moment`. */
  async function as<T>(
    x: Scene,
    work: (api: Api) => Promise<T>,
    moment: string = MOMENT,
  ): Promise<T> {
    const key = `${x.owner.account.id}|${x.s.branch}`;
    if (!given.has(key)) {
      given.add(key);
      await t.kit.giveRole(x.owner.account.id, {
        role: 'teacher',
        branchId: x.s.branch,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
    }
    t.clock.set(moment);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
        .where('account_id', '=', x.owner.account.id)
        .execute();
      return await work(apiOf(x.s.branch, x.owner.cookie));
    } finally {
      t.clock.set(START);
    }
  }

  const journalOf = async (classId: string, subject: string) =>
    (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', classId)
        .where('subject_id', '=', subject)
        .executeTakeFirstOrThrow()
    ).id;

  /** A graded scene with the plan windows open; `shared`: both classes are the owner's. */
  async function scene(input: { shared?: boolean; branch?: string; subject?: string } = {}) {
    const owner = await account();
    const spare = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      ...(input.shared === true ? { shared: true } : {}),
      ...(input.branch === undefined ? {} : { branch: input.branch }),
      ...(input.subject === undefined ? {} : { subject: input.subject }),
      accounts: { teacher: owner.account.id, spare: spare.account.id },
    });
    await openPlanWindows(t.database.migrator, s.branch, s.year);
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
      journal: await journalOf(s.classId, s.subject),
      other: await journalOf(s.otherClass, s.subject),
      q1: quarters[0] ?? '',
      q2: quarters[1] ?? '',
      q3: quarters[2] ?? '',
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  const switchCodes = (subject: string, on: boolean) =>
    t.database.migrator
      .updateTable('subjects')
      .set({ codes_on: on })
      .where('id', '=', subject)
      .execute();

  /** The lessons of a class in the second quarter, in order (the rows of its plan). */
  const q2Lessons = async (x: Scene, classId: string) =>
    (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', classId)
        .where('subject_id', '=', x.s.subject)
        .where('cancel_cause', 'is', null)
        .where('lesson_date', '>=', '2026-11-09')
        .where('lesson_date', '<=', '2026-12-31')
        .orderBy('starts_at')
        .execute()
    ).map((one) => one.id);

  /** An item written by the owner through the route at a row of the second quarter. */
  async function createIn(
    api: Api,
    x: Scene,
    journal: string,
    classId: string,
    position: number,
    values: object,
  ): Promise<PlanItem> {
    const lessons = await q2Lessons(x, classId);
    return planItemSchema.parse(
      ok(
        await api.post(`/api/plans/journals/${journal}/items`, {
          quarterId: x.q2,
          position,
          lessonId: lessons[position - 1] ?? randomUUID(),
          values,
        }),
        201,
      ),
    );
  }

  const planIdOf = async (journal: string, quarterId: string) =>
    (
      await t.database.migrator
        .selectFrom('lesson_plan_journals')
        .select('plan_id')
        .where('journal_id', '=', journal)
        .where('quarter_id', '=', quarterId)
        .executeTakeFirstOrThrow()
    ).plan_id;

  /**
   * A coded item written by the migrator at a place of a journal's plan, whatever the switch (a
   * plan of another teacher, or of last year, whose codes were set while on).
   */
  async function seedItem(
    branch: string,
    journal: string,
    quarterId: string,
    position: number,
  ): Promise<string> {
    const planId = await planIdOf(journal, quarterId);
    const item = await t.database.migrator
      .insertInto('lesson_plan_items')
      .values({ branch_id: branch, plan_id: planId, topic: 'Fractions', topic_code: 'F1' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.database.migrator
      .insertInto('lesson_plan_works')
      .values([
        {
          branch_id: branch,
          item_id: item.id,
          kind: 'classwork',
          position: 1,
          title: 'Quiz',
          work_code: 'Q1',
          description: '',
        },
        {
          branch_id: branch,
          item_id: item.id,
          kind: 'homework',
          position: 1,
          title: 'Exercise 5',
          work_code: 'H1',
          description: '',
        },
      ])
      .execute();
    await t.database.migrator
      .insertInto('lesson_plan_places')
      .values({
        branch_id: branch,
        plan_id: planId,
        journal_id: journal,
        item_id: item.id,
        position,
      })
      .execute();
    return item.id;
  }

  const planOf = async (api: Api, journal: string, quarterId: string): Promise<Plan> =>
    planSchema.parse(ok(await api.get(`/api/plans/journals/${journal}?quarterId=${quarterId}`)));

  /** The item of a plan with a topic, on a row or not covered. */
  const itemNamed = (plan: Plan, topic: string) =>
    [...plan.rows.map((row) => row.item), ...plan.notCovered].find((one) => one?.topic === topic);

  /** The stored codes of an item and its works, whatever the switch. */
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

  const copy = (api: Api, x: Scene, into: string, source: object, part = 'all') =>
    api.post(`/api/plans/journals/${into}/copy`, { quarterId: x.q2, source, part });

  /**
   * Eight items in the second quarter, the eighth with codes, written while on; the Monday
   * 16 November cancelled by the Super Admin, so the eighth is not covered.
   */
  async function notCoveredScene() {
    const x = await scene();
    await switchCodes(x.s.subject, true);
    const items = await as(
      x,
      async (api) => {
        const made: PlanItem[] = [];
        for (const position of [1, 2, 3, 4, 5, 6, 7]) {
          made.push(
            await createIn(
              api,
              x,
              x.journal,
              x.s.classId,
              position,
              plain(`Topic ${String(position)}`),
            ),
          );
        }
        made.push(await createIn(api, x, x.journal, x.s.classId, 8, coded('Topic 8')));
        return made;
      },
      START,
    );
    const last = items[7];
    if (last === undefined) throw new Error('Eight items.');
    const lesson = (await q2Lessons(x, x.s.classId))[1] ?? '';
    ok(
      await request(t.kit.server)
        .post(`/api/timetable/lessons/${lesson}/cancel`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, x.s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ reason: 'Excursion' }),
    );
    return { x, last };
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  it('copies the codes with a plan from another class (09, Codes, Copies)', async () => {
    const x = await scene({ shared: true });
    await switchCodes(x.s.subject, true);
    const source = await as(x, (api) => createIn(api, x, x.other, x.s.otherClass, 1, coded()));
    await as(x, async (api) => {
      ok(await copy(api, x, x.journal, { journalId: x.other, quarterId: x.q2 }));
      const copied = (await planOf(api, x.journal, x.q2)).rows[0]?.item;
      expect(copied?.id).not.toBe(source.id);
      expect(copied?.copiedFrom).toEqual({ journalId: x.other, quarterId: x.q2 });
      expect(codesOf(copied)).toEqual(CODED);
      expect(await storedCodes(copied?.id ?? '')).toEqual(STORED);
    });
  });

  it('copies the codes from another teacher while off: hidden, then shown unchanged when on', async () => {
    // The other class is another teacher's; its plan was written while the codes were on.
    const x = await scene();
    const source = await seedItem(x.s.branch, x.other, x.q2, 1);
    await as(x, async (api) => {
      ok(await copy(api, x, x.journal, { journalId: x.other, quarterId: x.q2 }));
      const copied = (await planOf(api, x.journal, x.q2)).rows[0]?.item;
      expect(copied?.id).not.toBe(source);
      expect(codesOf(copied)).toEqual(HIDDEN);
      expect(await storedCodes(copied?.id ?? '')).toEqual(STORED);
    });
    await switchCodes(x.s.subject, true);
    await as(x, async (api) => {
      expect(codesOf((await planOf(api, x.journal, x.q2)).rows[0]?.item)).toEqual(CODED);
    });
  });

  it('copies the codes from last year (09, Codes, Copies)', async () => {
    const m = t.database.migrator;
    // Last year first, closed before the scene's year is made (as in plan-follow.test.ts).
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
    const source = await seedItem(branch, lastJournal, lastQuarter, 1);
    await load.classes.setYear(lastYear, 'closed');
    const x = await scene({ branch, subject });
    await switchCodes(subject, true);
    await as(x, async (api) => {
      ok(await copy(api, x, x.journal, { journalId: lastJournal, quarterId: lastQuarter }));
      const copied = (await planOf(api, x.journal, x.q2)).rows[0]?.item;
      expect(copied?.id).not.toBe(source);
      expect(copied?.topic).toBe('Fractions');
      expect(codesOf(copied)).toEqual(CODED);
      expect(await storedCodes(copied?.id ?? '')).toEqual(STORED);
    });
  });

  it('shows the codes in a class that joins a shared plan while off, then on unchanged', async () => {
    const x = await scene({ shared: true });
    await switchCodes(x.s.subject, true);
    const source = await as(x, (api) => createIn(api, x, x.journal, x.s.classId, 1, coded()));
    await switchCodes(x.s.subject, false);
    await as(x, async (api) => {
      ok(
        await api.post(`/api/plans/journals/${x.journal}/share`, {
          quarterId: x.q2,
          journalId: x.other,
        }),
      );
      const joined = (await planOf(api, x.other, x.q2)).rows[0]?.item;
      // A share lays the same items in the joining class: no copy is made.
      expect(joined?.id).toBe(source.id);
      expect(codesOf(joined)).toEqual(HIDDEN);
    });
    expect(await storedCodes(source.id)).toEqual(STORED);
    await switchCodes(x.s.subject, true);
    await as(x, async (api) => {
      expect(codesOf((await planOf(api, x.other, x.q2)).rows[0]?.item)).toEqual(CODED);
    });
  });

  it('copies the codes with a separation from a shared plan while off, then shows them when on', async () => {
    const x = await scene({ shared: true });
    await switchCodes(x.s.subject, true);
    const source = await as(x, async (api) => {
      const item = await createIn(api, x, x.journal, x.s.classId, 1, coded());
      ok(
        await api.post(`/api/plans/journals/${x.journal}/share`, {
          quarterId: x.q2,
          journalId: x.other,
        }),
      );
      return item;
    });
    await switchCodes(x.s.subject, false);
    const separated = await as(x, async (api) => {
      ok(await api.post(`/api/plans/journals/${x.other}/separate`, { quarterId: x.q2 }));
      const item = (await planOf(api, x.other, x.q2)).rows[0]?.item;
      expect(item?.id).not.toBe(source.id);
      expect(item?.copiedFrom).toEqual({ journalId: x.journal, quarterId: x.q2 });
      expect(codesOf(item)).toEqual(HIDDEN);
      return item?.id ?? '';
    });
    expect(await planIdOf(x.other, x.q2)).not.toBe(await planIdOf(x.journal, x.q2));
    expect(await storedCodes(separated)).toEqual(STORED);
    await switchCodes(x.s.subject, true);
    await as(x, async (api) => {
      expect(codesOf((await planOf(api, x.other, x.q2)).rows[0]?.item)).toEqual(CODED);
    });
  });

  it("copies the codes into a new group's plan with the remaining items (a group split, decisions of 7.1c)", async () => {
    // `docs/decisions.md`: a group split, merged or newly formed gets no automatic copy; its
    // teacher copies the plan it came from with `part: 'remaining'`.
    const x = await scene();
    await switchCodes(x.s.subject, true);
    await as(x, async (api) => {
      for (const position of [1, 2, 3]) {
        await createIn(
          api,
          x,
          x.journal,
          x.s.classId,
          position,
          plain(`Topic ${String(position)}`),
        );
      }
      await createIn(api, x, x.journal, x.s.classId, 4, coded('Topic 4'));
    });
    // A new group (of a class with no maths of its own: a class and its group cannot both
    // have the subject), taught by the owner in the published version.
    const groupClass = await load.classes.schoolClass(x.s.branch, x.s.year, { grade: 7 });
    const group = await load.classes.group(x.s.branch, x.s.year, x.s.subject, [groupClass]);
    await load.rowAsBefore({
      branch_id: x.s.branch,
      version_id: x.s.version,
      class_id: null,
      group_id: group,
      subject_id: x.s.subject,
      teacher_id: x.s.teacher.staffId,
      lessons_per_week: 1,
    });
    const groupJournal = (
      await t.database.migrator
        .insertInto('journals')
        .values({
          branch_id: x.s.branch,
          academic_year_id: x.s.year,
          class_id: null,
          group_id: group,
          subject_id: x.s.subject,
          runs: '{[2026-11-26,)}',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await switchCodes(x.s.subject, false);
    await as(
      x,
      async (api) => {
        ok(
          await copy(api, x, groupJournal, { journalId: x.journal, quarterId: x.q2 }, 'remaining'),
        );
        const plan = await planOf(api, groupJournal, x.q2);
        // Only the item of the first lesson not held (30 November) is copied.
        expect(itemNamed(plan, 'Topic 3')).toBeUndefined();
        const copied = itemNamed(plan, 'Topic 4');
        expect(copied?.copiedFrom).toEqual({ journalId: x.journal, quarterId: x.q2 });
        expect(codesOf(copied)).toEqual(HIDDEN);
        expect(await storedCodes(copied?.id ?? '')).toEqual(STORED);
      },
      THURSDAY,
    );
    await switchCodes(x.s.subject, true);
    await as(
      x,
      async (api) => {
        expect(codesOf(itemNamed(await planOf(api, groupJournal, x.q2), 'Topic 4'))).toEqual(CODED);
      },
      THURSDAY,
    );
  });

  it('copies the codes with an item carried into the next quarter while off (edge/lesson-plans)', async () => {
    const { x, last } = await notCoveredScene();
    await switchCodes(x.s.subject, false);
    const carried = await as(
      x,
      async (api) => {
        expect((await planOf(api, x.journal, x.q2)).notCovered.map((one) => one.id)).toEqual([
          last.id,
        ]);
        ok(
          await api.post(`/api/plans/journals/${x.journal}/not-covered/${last.id}/carry`, {
            quarterId: x.q2,
          }),
        );
        const tray = (await planOf(api, x.journal, x.q3)).carriedIn;
        expect(tray.map((one) => one.topic)).toEqual(['Topic 8']);
        expect(tray[0]?.id).not.toBe(last.id);
        expect(codesOf(tray[0])).toEqual(HIDDEN);
        return tray[0]?.id ?? '';
      },
      START,
    );
    expect(await storedCodes(carried)).toEqual(STORED);
    await switchCodes(x.s.subject, true);
    await as(
      x,
      async (api) => {
        expect(codesOf((await planOf(api, x.journal, x.q3)).carriedIn[0])).toEqual(CODED);
      },
      START,
    );
  });

  it('copies the codes into "not covered" with a topic not delivered while off (edge/lesson-plans)', async () => {
    const x = await scene();
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const student = await members.student(x.s.branch, { startsOn: '2026-09-01', grade: 7 });
    await members.member({
      branch: x.s.branch,
      classId: x.s.classId,
      studentId: student,
      from: '2026-09-01',
    });
    // The held lesson of Monday 12 October, the first row of the first quarter.
    const held = await t.database.migrator
      .selectFrom('lessons')
      .select('id')
      .where('class_id', '=', x.s.classId)
      .where('subject_id', '=', x.s.subject)
      .where('lesson_date', '=', '2026-10-12')
      .executeTakeFirstOrThrow();
    const source = await seedItem(x.s.branch, x.journal, x.q1, 1);
    const copyId = await as(x, async (api) => {
      const answer = lessonDeliveryAnswerSchema.parse(
        ok(
          await api.put(`/api/journal/lessons/${held.id}/delivery`, {
            notDelivered: true,
            version: null,
          }),
        ),
      );
      expect(answer.copyItemId).not.toBeNull();
      expect(answer.copyItemId).not.toBe(source);
      const plan = await planOf(api, x.journal, x.q1);
      const copied = plan.notCovered.find((one) => one.id === answer.copyItemId);
      expect(copied?.topic).toBe('Fractions');
      expect(codesOf(copied)).toEqual(HIDDEN);
      return answer.copyItemId ?? '';
    });
    expect(await storedCodes(copyId)).toEqual(STORED);
    await switchCodes(x.s.subject, true);
    await as(x, async (api) => {
      const plan = await planOf(api, x.journal, x.q1);
      expect(codesOf(plan.notCovered.find((one) => one.id === copyId))).toEqual(CODED);
    });
  });
  it('copies the codes of the works merged from a not-covered item into a row, while off (plan-outcomes.service.ts)', async () => {
    const { x, last } = await notCoveredScene();
    await switchCodes(x.s.subject, false);
    const target = await as(
      x,
      async (api) => {
        const row = (await planOf(api, x.journal, x.q2)).rows[0];
        if (row?.item == null) throw new Error('The first row holds Topic 1.');
        ok(
          await api.post(`/api/plans/journals/${x.journal}/not-covered/${last.id}/merge`, {
            quarterId: x.q2,
            position: row.number,
            lessonId: row.lessonId,
            base: { topic: row.item.topic, objectives: row.item.objectives, links: row.item.links },
          }),
        );
        const merged = (await planOf(api, x.journal, x.q2)).rows[0]?.item;
        expect(merged?.id).toBe(row.item.id);
        expect(merged?.topic).toBe('Topic 1; Topic 8');
        expect([
          merged?.classworks.map((one) => [one.title, one.code]),
          merged?.homeworks.map((one) => [one.title, one.code]),
        ]).toEqual([[['Quiz', null]], [['Exercise 5', null]]]);
        return row.item.id;
      },
      START,
    );
    // The works are new rows of the target, with the source's stored codes.
    expect((await storedCodes(target)).works).toEqual(STORED.works);
    await switchCodes(x.s.subject, true);
    await as(
      x,
      async (api) => {
        const merged = (await planOf(api, x.journal, x.q2)).rows[0]?.item;
        expect([
          merged?.classworks.map((one) => one.code),
          merged?.homeworks.map((one) => one.code),
        ]).toEqual([['Q1'], ['H1']]);
      },
      START,
    );
  });
});
