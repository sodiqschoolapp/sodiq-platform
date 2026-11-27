import { randomUUID } from 'node:crypto';
import {
  apiErrorSchema,
  BRANCH_HEADER,
  journalUnlockSchema,
  planItemSchema,
  planRequestSchema,
  planSchema,
  REQUEST_KEY_HEADER,
  workAddedSchema,
  type Plan,
  type PlanItem,
} from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setEditDays } from '../../testing/branch-filter-sql.js';
import { closeQuarter } from '../../testing/closing-kit.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { openPlanWindows } from '../../testing/plan-windows-kit.js';
import { publishedScene } from '../../testing/published-scene.js';

/** Tuesday 27 October 2026, noon: the window of quarter 2 is opened. */
const OCT27 = '2026-10-27T12:00:00+05:00';
/** Monday 2 November 2026, noon: inside the window (28 October to 10 November). */
const NOV02 = '2026-11-02T12:00:00+05:00';
/** Thursday 26 November 2026, noon: the Mondays 9, 16 and 23 November are held. */
const THURSDAY = '2026-11-26T12:00:00+05:00';
/** Monday 19 October 2026, noon: with 7 edit days the lessons of 12 and 19 October are open. */
const OCT19 = '2026-10-19T12:00:00+05:00';

const WINDOW = { startDate: '2026-10-28', endDate: '2026-11-10', confirm: true };

const ok = (response: Response, status = 200) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response;
};

const codeOf = (response: Response) => apiErrorSchema.parse(response.body).error.code;

const values = (change: Record<string, unknown> = {}) => ({
  topic: 'Fractions',
  objectives: '',
  links: [],
  classworks: [],
  homeworks: [],
  ...change,
});

/** The values of an item as a save sends them as its base (codes as read). */
const baseOf = (item: PlanItem) => ({
  topic: item.topic,
  topicCode: item.topicCode,
  objectives: item.objectives,
  links: item.links,
  classworks: item.classworks,
  homeworks: item.homeworks,
});

/** The same item's values with only the codes changed: the topic and every title as read. */
const codesOnly = (item: PlanItem, change: { topicCode?: string; workCode?: string }) => ({
  topic: item.topic,
  topicCode: change.topicCode ?? item.topicCode,
  objectives: item.objectives,
  links: item.links,
  classworks: item.classworks.map((work, index) => ({
    id: work.id,
    title: work.title,
    description: work.description,
    code: index === 0 && change.workCode !== undefined ? change.workCode : work.code,
  })),
  homeworks: item.homeworks.map((work) => ({
    id: work.id,
    title: work.title,
    description: work.description,
    code: work.code,
  })),
});

// All names are invented. Task 11.27 (pull request #399), review round 1, finding 4.
// `09`, Codes: "edited under the same rules and history as the topic or title it stands beside";
// `09`, Editing after the window: "If the item of a lesson already held is changed, it carries an
// \"edited after the lesson\" mark"; `.claude/rules/lesson-plans.md`: the mark "is set by every
// write route that changes that item"; `edge/lesson-plans`, Plans and the journal: "Nothing is
// possible in a closed quarter". A change of the code alone, topic and titles unchanged, is a
// change of the item: it passes the gate of its topic and is marked as its topic would be.
describe('a change of a code alone on a held lesson and in a closed quarter (task 11.27)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const VALID_FROM = new Date('2026-09-01T00:00:00+05:00');

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Nodira', `Saidova${'a'.repeat(names % 7)}`);
  };

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
    method: 'get' | 'post' | 'put',
    path: string,
    branch: string,
    cookie: string,
    body?: object,
  ) => {
    const call = request(t.kit.server)
      [method](path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch);
    if (method === 'post') call.set(REQUEST_KEY_HEADER, randomUUID());
    return body === undefined ? call : call.send(body);
  };

  /** A graded scene with codes on: its owner, the Head Teacher and the Academic Vice Principal. */
  async function scene() {
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
    await t.database.migrator
      .updateTable('subjects')
      .set({ codes_on: true })
      .where('id', '=', s.subject)
      .execute();
    const journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.classId)
        .executeTakeFirstOrThrow()
    ).id;
    const quarters = await t.database.migrator
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', s.year)
      .orderBy('number')
      .execute();
    const lessonOn = async (date: string) =>
      (
        await t.database.migrator
          .selectFrom('lessons')
          .select('id')
          .where('class_id', '=', s.classId)
          .where('subject_id', '=', s.subject)
          .where('lesson_date', '=', date)
          .executeTakeFirstOrThrow()
      ).id;
    return {
      s,
      owner,
      head,
      vice,
      journal,
      q1: quarters[0]?.id ?? '',
      q2: quarters[1]?.id ?? '',
      lessonOn,
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  const planOf = (x: Scene, quarterId: string, moment: string): Promise<Plan> =>
    at(moment, async () =>
      planSchema.parse(
        ok(
          await send(
            'get',
            `/api/plans/journals/${x.journal}?quarterId=${quarterId}`,
            x.s.branch,
            x.owner.cookie,
          ),
        ).body,
      ),
    );

  /** The stored codes and mark of an item, whatever is shown. */
  const storedOf = async (itemId: string) => ({
    topic: await t.database.migrator
      .selectFrom('lesson_plan_items')
      .select(['topic', 'topic_code'])
      .where('id', '=', itemId)
      .executeTakeFirstOrThrow(),
    works: await t.database.migrator
      .selectFrom('lesson_plan_works')
      .select(['title', 'work_code'])
      .where('item_id', '=', itemId)
      .orderBy('kind')
      .orderBy('position')
      .execute(),
    marked: (
      await t.database.migrator
        .selectFrom('lesson_plan_places')
        .select('edited_after_lesson')
        .where('item_id', '=', itemId)
        .execute()
    ).map((row) => row.edited_after_lesson),
  });

  /** Every row the refused routes could write in the branch, and the audit log's ids. */
  const rowsOf = async (branch: string) => {
    const found: Record<string, unknown[]> = {};
    for (const table of [
      'lesson_plans',
      'lesson_plan_items',
      'lesson_plan_places',
      'lesson_plan_works',
      'journal_works',
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

  /** The last audit entry of an action that names the record. */
  const lastEntry = async (action: string, id: string) =>
    (
      await t.database.migrator
        .selectFrom('audit_log')
        .select(['record_id', 'old_value', 'new_value', 'details'])
        .where('action', '=', action)
        .orderBy('id')
        .execute()
    )
      .filter((entry) => JSON.stringify(entry).includes(id))
      .at(-1);

  it('refuses a change of a code alone through the plan save on a held lesson after the window, takes it under an approved request and marks the item', async () => {
    const x = await scene();
    ok(
      await at(OCT27, async () =>
        send('put', `/api/plans/windows/${x.q2}`, x.s.branch, x.vice.cookie, WINDOW),
      ),
    );
    // Items with codes at the first three rows, written inside the window.
    const plan = await planOf(x, x.q2, NOV02);
    const items: PlanItem[] = await at(NOV02, async () => {
      const made: PlanItem[] = [];
      for (const position of [1, 2, 3]) {
        made.push(
          planItemSchema.parse(
            ok(
              await send(
                'post',
                `/api/plans/journals/${x.journal}/items`,
                x.s.branch,
                x.owner.cookie,
                {
                  quarterId: x.q2,
                  position,
                  lessonId: plan.rows[position - 1]?.lessonId ?? randomUUID(),
                  values: values({
                    topic: `Topic ${String(position)}`,
                    topicCode: `T${String(position)}`,
                    classworks: [
                      {
                        title: `Quiz ${String(position)}`,
                        description: '',
                        code: `W${String(position)}`,
                      },
                    ],
                  }),
                },
              ),
              201,
            ).body,
          ),
        );
      }
      return made;
    });
    const [first, second, third] = items;
    if (first === undefined || second === undefined || third === undefined)
      throw new Error('no items');
    const save = (item: PlanItem, change: { topicCode?: string; workCode?: string }) =>
      send('put', `/api/plans/items/${item.id}`, x.s.branch, x.owner.cookie, {
        base: baseOf(item),
        values: codesOnly(item, change),
      });

    // After the window, on the held lessons of 16 and 23 November: the topic code alone, and a
    // work's code alone, are refused as a change of the topic or the title is.
    const before = await rowsOf(x.s.branch);
    await at(THURSDAY, async () => {
      expect(codeOf(await save(second, { topicCode: 'X2' }))).toBe('plan_window_closed');
      expect(codeOf(await save(third, { workCode: 'V3' }))).toBe('plan_window_closed');
    });
    expect(await rowsOf(x.s.branch)).toEqual(before);

    // A Text request for the two lessons, approved by the Head Teacher of the subject.
    const asked = planRequestSchema.parse(
      ok(
        await at(THURSDAY, async () =>
          send('post', `/api/plans/journals/${x.journal}/requests`, x.s.branch, x.owner.cookie, {
            quarterId: x.q2,
            kind: 'text',
            lessonIds: [plan.rows[1]?.lessonId, plan.rows[2]?.lessonId],
            reason: 'Codes of the syllabus',
          }),
        ),
        201,
      ).body,
    );
    ok(
      await at(THURSDAY, async () =>
        send('post', `/api/plans/requests/${asked.id}/decide`, x.s.branch, x.head.cookie, {
          decision: 'approve',
          days: 2,
        }),
      ),
    );
    const topicSaved = planItemSchema.parse(
      ok(await at(THURSDAY, async () => save(second, { topicCode: 'X2' }))).body,
    );
    expect([topicSaved.topic, topicSaved.topicCode, topicSaved.editedAfterLesson]).toEqual([
      'Topic 2',
      'X2',
      true,
    ]);
    const workSaved = planItemSchema.parse(
      ok(await at(THURSDAY, async () => save(third, { workCode: 'V3' }))).body,
    );
    expect([
      workSaved.topicCode,
      workSaved.classworks.map((one) => [one.title, one.code]),
      workSaved.editedAfterLesson,
    ]).toEqual(['T3', [['Quiz 3', 'V3']], true]);
    expect(await storedOf(second.id)).toEqual({
      topic: { topic: 'Topic 2', topic_code: 'X2' },
      works: [{ title: 'Quiz 2', work_code: 'W2' }],
      marked: [true],
    });
    expect(await storedOf(third.id)).toEqual({
      topic: { topic: 'Topic 3', topic_code: 'T3' },
      works: [{ title: 'Quiz 3', work_code: 'V3' }],
      marked: [true],
    });
    // The item not changed keeps no mark.
    expect((await storedOf(first.id)).marked).toEqual([false]);
    // The history of the topic: old and new code, and the request that let it in.
    const entry = await lastEntry('plan.item_edit', second.id);
    expect([entry?.old_value, entry?.new_value]).toEqual([
      { topicCode: 'T2' },
      { topicCode: 'X2' },
    ]);
    expect(entry?.details).toEqual(
      expect.objectContaining({ requests: [{ id: asked.id, approvedBy: x.head.account.id }] }),
    );
  });

  it('refuses a change of a code alone in the journal on a locked lesson, takes it under an unlock as the topic and the title, with the same mark as a change of the topic', async () => {
    const x = await scene();
    // The school's 7 edit days: on 27 October the lessons of 12 and 19 October are locked.
    await setEditDays(t.database.migrator, x.s.branch, 7);
    const october12 = await x.lessonOn('2026-10-12');
    const october19 = await x.lessonOn('2026-10-19');
    const topicPath = (lessonId: string) => `/api/journal/lessons/${lessonId}/topic`;
    // While open: a topic with a code at both lessons, and a work with a code at the 19th.
    const work = await at(OCT19, async () => {
      for (const lessonId of [october12, october19]) {
        ok(
          await send('put', topicPath(lessonId), x.s.branch, x.owner.cookie, {
            topic: 'Maps',
            baseTopic: '',
            topicCode: 'M1',
            baseTopicCode: null,
          }),
        );
      }
      return workAddedSchema.parse(
        ok(
          await send(
            'post',
            `/api/journal/lessons/${october19}/works`,
            x.s.branch,
            x.owner.cookie,
            {
              kind: 'classwork',
              title: 'Quiz',
              code: 'Q1',
            },
          ),
        ).body,
      );
    });
    const renamePath = `/api/journal/lessons/${october19}/plan-works/${work.planWorkId}/title`;
    const topicCodeOnly = {
      topic: 'Maps',
      baseTopic: 'Maps',
      topicCode: 'M2',
      baseTopicCode: 'M1',
    };
    const workCodeOnly = { title: 'Quiz', baseTitle: 'Quiz', code: 'Q2', baseCode: 'Q1' };

    // Locked: the code alone is refused, as the topic and the title are.
    const before = await rowsOf(x.s.branch);
    await at(OCT27, async () => {
      expect(
        codeOf(await send('put', topicPath(october19), x.s.branch, x.owner.cookie, topicCodeOnly)),
      ).toBe('journal_locked');
      expect(codeOf(await send('put', renamePath, x.s.branch, x.owner.cookie, workCodeOnly))).toBe(
        'journal_locked',
      );
    });
    expect(await rowsOf(x.s.branch)).toEqual(before);

    // An unlock of each lesson, approved by the Head Teacher of the subject.
    for (const lessonId of [october12, october19]) {
      const sent = journalUnlockSchema.parse(
        ok(
          await at(OCT27, async () =>
            send('post', `/api/journal/lessons/${lessonId}/unlocks`, x.s.branch, x.owner.cookie, {
              reason: 'Codes of the syllabus',
            }),
          ),
          201,
        ).body,
      );
      ok(
        await at(OCT27, async () =>
          send('post', `/api/journal/unlocks/${sent.id}/decide`, x.s.branch, x.head.cookie, {
            decision: 'approve',
            days: 2,
            version: 1,
          }),
        ),
      );
    }
    const itemId = await at(OCT27, async () => {
      const topic = ok(
        await send('put', topicPath(october19), x.s.branch, x.owner.cookie, topicCodeOnly),
      ).body as { itemId: string; topic: string; topicCode: string | null };
      expect([topic.topic, topic.topicCode]).toEqual(['Maps', 'M2']);
      const renamed = workAddedSchema.parse(
        ok(await send('put', renamePath, x.s.branch, x.owner.cookie, workCodeOnly)).body,
      );
      expect([renamed.title, renamed.code]).toEqual(['Quiz', 'Q2']);
      // The topic itself changed at the other unlocked lesson, for the mark it gives.
      ok(
        await send('put', topicPath(october12), x.s.branch, x.owner.cookie, {
          topic: 'Maps of Asia',
          baseTopic: 'Maps',
        }),
      );
      return topic.itemId;
    });
    const stored = await storedOf(itemId);
    expect([stored.topic, stored.works]).toEqual([
      { topic: 'Maps', topic_code: 'M2' },
      [{ title: 'Quiz', work_code: 'Q2' }],
    ]);
    // The history of each: old and new code beside the unchanged topic and title.
    const topicEntry = await lastEntry('journal.topic', october19);
    expect(topicEntry?.new_value).toEqual({ itemId, topic: 'Maps', topicCode: 'M2' });
    const renameEntry = await lastEntry('journal.work_rename', work.planWorkId);
    expect([renameEntry?.old_value, renameEntry?.new_value]).toEqual([
      { planWorkId: work.planWorkId, kind: 'classwork', title: 'Quiz', code: 'Q1' },
      { planWorkId: work.planWorkId, kind: 'classwork', title: 'Quiz', code: 'Q2' },
    ]);
    const planEdits = (
      await t.database.migrator
        .selectFrom('audit_log')
        .select(['old_value', 'new_value'])
        .where('action', '=', 'plan.item_edit')
        .orderBy('id')
        .execute()
    ).filter((entry) => JSON.stringify(entry).includes('"M2"'));
    expect(planEdits.map((entry) => [entry.old_value, entry.new_value])).toEqual([
      [
        { topic: 'Maps', topicCode: 'M1' },
        { topic: 'Maps', topicCode: 'M2' },
      ],
    ]);
    // The mark: the journal's topic route gives an item the mark a change of its topic gives
    // (`PlansService.topicFromJournal`: the journal's edit period decides, not a plan request).
    const topicItem = (
      await t.database.migrator
        .selectFrom('lesson_plan_items')
        .innerJoin('lesson_plan_places', 'lesson_plan_places.item_id', 'lesson_plan_items.id')
        .select('lesson_plan_items.id')
        .where('lesson_plan_items.topic', '=', 'Maps of Asia')
        .where('lesson_plan_places.journal_id', '=', x.journal)
        .executeTakeFirstOrThrow()
    ).id;
    expect(stored.marked).toEqual((await storedOf(topicItem)).marked);
  });

  it('refuses a change of a code alone in a closed quarter through the plan save, the journal topic and the rename, and takes it before the close', async () => {
    const x = await scene();
    await openPlanWindows(t.database.migrator, x.s.branch, x.s.year);
    // Monday 26 October is held on the 27th; the window of quarter 1 lasts to its end.
    const october26 = await x.lessonOn('2026-10-26');
    const topicPath = `/api/journal/lessons/${october26}/topic`;
    const work = await at(OCT27, async () => {
      ok(
        await send('put', topicPath, x.s.branch, x.owner.cookie, {
          topic: 'Rivers',
          baseTopic: '',
          topicCode: 'R1',
          baseTopicCode: null,
        }),
      );
      return workAddedSchema.parse(
        ok(
          await send(
            'post',
            `/api/journal/lessons/${october26}/works`,
            x.s.branch,
            x.owner.cookie,
            {
              kind: 'homework',
              title: 'Essay',
              code: 'E1',
            },
          ),
        ).body,
      );
    });
    const renamePath = `/api/journal/lessons/${october26}/plan-works/${work.planWorkId}/title`;
    const itemOf = async () => {
      const found = (await planOf(x, x.q1, OCT27)).rows.find(
        (row) => row.lessonId === october26,
      )?.item;
      if (found == null) throw new Error('the item is read');
      return found;
    };
    const item = await itemOf();
    // Before the close each change of a code alone is taken (the fixture lets it in).
    await at(OCT27, async () => {
      ok(
        await send('put', `/api/plans/items/${item.id}`, x.s.branch, x.owner.cookie, {
          base: baseOf(item),
          values: codesOnly(item, { topicCode: 'R2' }),
        }),
      );
      ok(
        await send('put', topicPath, x.s.branch, x.owner.cookie, {
          topic: 'Rivers',
          baseTopic: 'Rivers',
          topicCode: 'R3',
          baseTopicCode: 'R2',
        }),
      );
      ok(
        await send('put', renamePath, x.s.branch, x.owner.cookie, {
          title: 'Essay',
          baseTitle: 'Essay',
          code: 'E2',
          baseCode: 'E1',
        }),
      );
    });
    const read = await itemOf();
    expect([read.topicCode, read.homeworks.map((one) => one.code)]).toEqual(['R3', ['E2']]);

    await closeQuarter(t.database, {
      branchId: x.s.branch,
      quarterId: x.q1,
      accountId: x.vice.account.id,
    });
    const before = await rowsOf(x.s.branch);
    await at(OCT27, async () => {
      expect(
        codeOf(
          await send('put', `/api/plans/items/${read.id}`, x.s.branch, x.owner.cookie, {
            base: baseOf(read),
            values: codesOnly(read, { topicCode: 'R4' }),
          }),
        ),
      ).toBe('plan_quarter_closed');
      expect(
        codeOf(
          await send('put', `/api/plans/items/${read.id}`, x.s.branch, x.owner.cookie, {
            base: baseOf(read),
            values: {
              ...codesOnly(read, {}),
              homeworks: read.homeworks.map((one) => ({
                id: one.id,
                title: one.title,
                description: one.description,
                code: 'E3',
              })),
            },
          }),
        ),
      ).toBe('plan_quarter_closed');
      expect(
        codeOf(
          await send('put', topicPath, x.s.branch, x.owner.cookie, {
            topic: 'Rivers',
            baseTopic: 'Rivers',
            topicCode: 'R4',
            baseTopicCode: 'R3',
          }),
        ),
      ).toBe('quarter_closed');
      expect(
        codeOf(
          await send('put', renamePath, x.s.branch, x.owner.cookie, {
            title: 'Essay',
            baseTitle: 'Essay',
            code: 'E3',
            baseCode: 'E2',
          }),
        ),
      ).toBe('quarter_closed');
    });
    expect(await rowsOf(x.s.branch)).toEqual(before);
  });
});
