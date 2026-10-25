import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  homeworkGivenAnswerSchema,
  journalGridSchema,
  lessonCardSchema,
  lessonDeliveryAnswerSchema,
  type JournalGrid,
  type JournalLesson,
  type LessonCard,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { setEditDays } from '../../testing/branch-filter-sql.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { hoursOf, publishedScene } from '../../testing/published-scene.js';
import { MemoryPhotoStore, planFileKey } from '../people/photo-store.js';

const store = new MemoryPhotoStore();

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): string =>
  (response.body as { error?: { code?: string } }).error?.code ?? `status ${response.status}`;

const ok = (response: Response, status = 200): unknown => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response.body;
};

// All names are invented. Task 8.8, pull request #226: plans in the journal
// (docs/spec/09-lesson-plans.md, In the journal; docs/spec/edge-cases/lesson-plans.md,
// Plans and the journal, "A substitute supervises the class").
describe('plans in the journal', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Malika', `Yusupova${'a'.repeat(names % 7)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };
  interface Calls {
    get: (path: string) => Promise<Response>;
    put: (path: string, body: object) => Promise<Response>;
  }

  const given = new Set<string>();

  /** Runs `work` in `branch` with the clock at `moment` and the roles held from 1 September. */
  async function as<T>(
    browser: Browser,
    branch: string,
    roles: readonly Omit<Held, 'validFrom'>[],
    work: (calls: Calls) => Promise<T>,
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
      const at = (method: 'get' | 'put', path: string) =>
        request(t.kit.server)
          [method](path)
          .set('Cookie', browser.cookie)
          .set(BRANCH_HEADER, branch);
      return await work({
        get: (path) => at('get', path),
        put: (path, body) => at('put', path).send(body),
      });
    } finally {
      t.clock.set(START);
    }
  }

  async function scene(accounts: { teacher?: string } = {}, shared = false) {
    const s = await publishedScene(t, load, { graded: true, accounts, shared });
    const lessonsOf = async (classId: string) =>
      (
        await t.database.migrator
          .selectFrom('lessons')
          .select('id')
          .where('class_id', '=', classId)
          .where('lesson_date', '>=', '2026-10-12')
          .orderBy('starts_at')
          .execute()
      ).map((row) => row.id);
    const [first, second, third, fourth] = await lessonsOf(s.classId);
    if (
      first === undefined ||
      second === undefined ||
      third === undefined ||
      fourth === undefined
    ) {
      throw new Error('The scene has lessons from 12 October on.');
    }
    const journalOf = async (classId: string) =>
      (
        await t.database.migrator
          .selectFrom('journals')
          .select('id')
          .where('class_id', '=', classId)
          .executeTakeFirstOrThrow()
      ).id;
    const q1 = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', s.year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const student = await members.student(s.branch, { startsOn: '2026-09-01', grade: 7 });
    await members.member({
      branch: s.branch,
      classId: s.classId,
      studentId: student,
      from: '2026-09-01',
    });
    return {
      ...s,
      first,
      second,
      third,
      fourth,
      q1,
      student,
      journal: await journalOf(s.classId),
      otherJournal: await journalOf(s.otherClass),
      otherFirst: (await lessonsOf(s.otherClass))[0] ?? '',
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /** The row of a lesson: its place among the quarter's lessons not cancelled. */
  const rowOf = async (classId: string, lessonId: string): Promise<number> => {
    const rows = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', classId)
        .where('lesson_date', '>=', '2026-09-01')
        .where('lesson_date', '<=', '2026-10-31')
        .where('cancel_cause', 'is', null)
        .orderBy('starts_at')
        .execute()
    ).map((row) => row.id);
    return rows.indexOf(lessonId) + 1;
  };

  const planOf = async (journalId: string, quarterId: string) =>
    (
      await t.database.migrator
        .selectFrom('lesson_plan_journals')
        .select('plan_id')
        .where('journal_id', '=', journalId)
        .where('quarter_id', '=', quarterId)
        .executeTakeFirstOrThrow()
    ).plan_id;

  /** A plan item of quarter 1 at the row of `lessonId`, written as the migrator. */
  async function itemAt(
    s: Scene,
    lessonId: string,
    works: { classworks?: string[]; homeworks?: string[]; topic?: string } = {},
    journals: readonly { journal: string; classId: string; lesson: string }[] = [
      { journal: s.journal, classId: s.classId, lesson: lessonId },
    ],
  ): Promise<{ itemId: string; classworks: string[]; homeworks: string[] }> {
    const planId = await planOf(journals[0]?.journal ?? s.journal, s.q1);
    const item = await t.database.migrator
      .insertInto('lesson_plan_items')
      .values({
        branch_id: s.branch,
        plan_id: planId,
        topic: works.topic ?? 'Fractions',
        objectives: 'Add fractions',
        links: ['https://example.org/fractions'],
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = { itemId: item.id, classworks: [] as string[], homeworks: [] as string[] };
    for (const kind of ['classwork', 'homework'] as const) {
      const titles = (kind === 'classwork' ? works.classworks : works.homeworks) ?? [];
      for (const [index, title] of titles.entries()) {
        const work = await t.database.migrator
          .insertInto('lesson_plan_works')
          .values({
            branch_id: s.branch,
            item_id: item.id,
            kind,
            position: index + 1,
            title,
            description: `About ${title}`,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        made[kind === 'classwork' ? 'classworks' : 'homeworks'].push(work.id);
      }
    }
    for (const one of journals) {
      await t.database.migrator
        .insertInto('lesson_plan_places')
        .values({
          branch_id: s.branch,
          plan_id: planId,
          journal_id: one.journal,
          item_id: item.id,
          position: await rowOf(one.classId, one.lesson),
        })
        .execute();
    }
    return made;
  }

  const gridOf = async (calls: Calls, journal: string): Promise<JournalGrid> =>
    journalGridSchema.parse(ok(await calls.get(`/api/journal/journals/${journal}`)));

  const lessonIn = (grid: JournalGrid, id: string): JournalLesson => {
    const found = grid.lessons.find((one) => one.id === id);
    if (found === undefined) throw new Error('The grid shows the lesson.');
    return found;
  };

  const cardOf = async (calls: Calls, lessonId: string): Promise<LessonCard> =>
    lessonCardSchema.parse(ok(await calls.get(`/api/journal/lessons/${lessonId}/card`)));

  const teacherIn = (s: Scene) => [{ role: 'teacher' as const, branchId: s.branch }];

  /** Every row the mark routes write in a branch. */
  const rowsOf = (branch: string) =>
    Promise.all(
      (
        [
          'journal_lesson_deliveries',
          'journal_homework_not_given',
          'journal_delivery_history',
          'lesson_plan_items',
          'lesson_plan_places',
          'lesson_plan_requests',
          'lesson_plan_request_causes',
        ] as const
      ).map((table) =>
        t.database.migrator
          .selectFrom(table)
          .selectAll()
          .where('branch_id', '=', branch)
          .orderBy((table === 'lesson_plan_places' ? 'item_id' : 'id') as never)
          .execute(),
      ),
    );

  const entriesOf = async (action: string) =>
    t.database.migrator
      .selectFrom('audit_log')
      .select(['old_value', 'new_value', 'details', 'record_id'])
      .where('action', '=', action)
      .orderBy('id')
      .execute();

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true, photoStore: store });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the journal header and the lesson card', () => {
    it('shows the number and topic of each lesson, and the card with given today and checked today', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const first = await itemAt(s, s.first, {
        classworks: ['Test'],
        homeworks: ['Read', 'Write'],
      });
      await itemAt(s, s.second, { topic: 'Decimals' });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const grid = await gridOf(calls, s.journal);
        const row = await rowOf(s.classId, s.first);
        expect(lessonIn(grid, s.first)).toMatchObject({ number: row, topic: 'Fractions' });
        expect(lessonIn(grid, s.second)).toMatchObject({ number: row + 1, topic: 'Decimals' });
        // The 26th has no item: a number and no topic ("No plan").
        expect(lessonIn(grid, s.third)).toMatchObject({ number: row + 2, topic: null });

        const card = await cardOf(calls, s.first);
        expect(card).toMatchObject({
          number: row,
          date: '2026-10-12',
          slot: 1,
          topic: 'Fractions',
          whole: true,
          objectives: 'Add fractions',
          links: ['https://example.org/fractions'],
          canMark: true,
          delivery: { notDelivered: false, version: null },
        });
        expect(card.classworks.map((one) => one.title)).toEqual(['Test']);
        expect(card.givenToday.map((one) => [one.planWorkId, one.title, one.description])).toEqual([
          [first.homeworks[0], 'Read', 'About Read'],
          [first.homeworks[1], 'Write', 'About Write'],
        ]);
        expect(card.givenToday[0]?.checkAt).toMatchObject({
          lessonId: s.second,
          date: '2026-10-19',
        });
        expect(card.givenToday[0]?.checkedSameDay).toBe(false);
        const second = await cardOf(calls, s.second);
        expect(second.checkedToday).toEqual([
          { title: 'Read', givenOn: '2026-10-12' },
          { title: 'Write', givenOn: '2026-10-12' },
        ]);
        expect(second.givenToday).toEqual([]);
      });
    });

    it('gives a Tutor, a Head Tutor and the Vice Principal for Spiritual and Moral Education the topic and homework only', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await itemAt(s, s.first, { classworks: ['Test'], homeworks: ['Read'] });
      for (const role of ['head_tutor', 'spiritual_vice_principal'] as const) {
        const reader = await account();
        await as(reader, s.branch, [{ role, branchId: s.branch }], async (calls) => {
          const card = await cardOf(calls, s.first);
          expect(card).toMatchObject({
            whole: false,
            topic: 'Fractions',
            classworks: [],
            objectives: null,
            links: [],
            files: [],
            canMark: false,
          });
          expect(card.givenToday.map((one) => [one.title, one.description])).toEqual([
            ['Read', null],
          ]);
        });
      }
      const tutor = await account();
      await as(tutor, s.branch, [{ role: 'tutor', branchId: s.branch }], () => Promise.resolve());
      const assignment = await t.database.migrator
        .selectFrom('assignments')
        .select('id')
        .where('account_id', '=', tutor.account.id)
        .where('role', '=', 'tutor')
        .executeTakeFirstOrThrow();
      await load.classes.person(s.branch, ['uz'], { accountId: tutor.account.id });
      await load.classes.tutorRow(s.branch, s.classId, assignment.id);
      await as(tutor, s.branch, [], async (calls) => {
        const card = await cardOf(calls, s.first);
        expect(card).toMatchObject({ whole: false, topic: 'Fractions', classworks: [] });
        expect(card.givenToday.map((one) => one.title)).toEqual(['Read']);
        // The Tutor sets no mark.
        const refused = await calls.put(`/api/journal/lessons/${s.first}/delivery`, {
          notDelivered: true,
          version: null,
        });
        expect(refused.status).toBe(403);
      });
    });

    it('refuses a teacher who reads neither the journal nor the plan, and 404s another branch or an unknown lesson', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const other = await scene();
      await itemAt(s, s.first);
      const stranger = await account();
      await load.teacher(s.branch, { accountId: stranger.account.id });
      await as(stranger, s.branch, teacherIn(s), async (calls) => {
        const refused = await calls.get(`/api/journal/lessons/${s.first}/card`);
        expect(refused.status).toBe(403);
        expect(codeOf(refused)).toBe('journal_scope');
      });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        for (const id of [other.first, randomUUID()]) {
          const missing = await calls.get(`/api/journal/lessons/${id}/card`);
          expect(missing.status).toBe(404);
        }
      });
    });
  });

  describe('homework not given', () => {
    it("removes the next lesson's homework column (Done when), and its undo brings it back", async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const first = await itemAt(s, s.first, { homeworks: ['Read', 'Write'] });
      await itemAt(s, s.second);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const before = await gridOf(calls, s.journal);
        expect(lessonIn(before, s.second).works.map((one) => one.title)).toEqual(['Read', 'Write']);
        const marked = homeworkGivenAnswerSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${s.first}/homework-given`, {
              planWorkIds: [first.homeworks[0]],
              notGiven: true,
            }),
          ),
        );
        expect(marked.notGiven).toEqual([first.homeworks[0]]);
        const after = await gridOf(calls, s.journal);
        expect(lessonIn(after, s.second).works.map((one) => one.title)).toEqual(['Write']);
        expect(lessonIn(after, s.first).given.map((one) => [one.title, one.notGiven])).toEqual([
          ['Read', true],
          ['Write', false],
        ]);
        // The lesson's status and reminders read the same columns: one homework is waited for.
        const card = await cardOf(calls, s.first);
        expect(card.givenToday.map((one) => [one.title, one.notGiven, one.checkAt])).toEqual([
          ['Read', true, null],
          ['Write', false, expect.objectContaining({ lessonId: s.second })],
        ]);
        ok(
          await calls.put(`/api/journal/lessons/${s.first}/homework-given`, {
            planWorkIds: [first.homeworks[0]],
            notGiven: false,
          }),
        );
        const back = await gridOf(calls, s.journal);
        expect(lessonIn(back, s.second).works.map((one) => one.title)).toEqual(['Read', 'Write']);
      });
      const history = await t.database.migrator
        .selectFrom('journal_delivery_history')
        .select(['kind', 'plan_work_id', 'marked_before', 'marked_after', 'changed_how'])
        .where('lesson_id', '=', s.first)
        .orderBy('changed_at')
        .orderBy('id')
        .execute();
      expect(history).toEqual([
        {
          kind: 'homework',
          plan_work_id: first.homeworks[0],
          marked_before: false,
          marked_after: true,
          changed_how: 'entry',
        },
        {
          kind: 'homework',
          plan_work_id: first.homeworks[0],
          marked_before: true,
          marked_after: false,
          changed_how: 'undo',
        },
      ]);
      const entries = await entriesOf('journal.homework_not_given');
      expect(entries.filter((one) => one.record_id === s.first)).toHaveLength(2);
    });

    it('refuses a homework whose column has a total, and a total on a homework not given (decision 4)', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const first = await itemAt(s, s.first, { homeworks: ['Read', 'Write'] });
      await itemAt(s, s.second);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const total = await request(t.kit.server)
          .put(`/api/journal/lessons/${s.second}/works/total`)
          .set('Cookie', owner.cookie)
          .set(BRANCH_HEADER, s.branch)
          .send({
            column: { planWorkId: first.homeworks[0], sourceLessonId: s.first },
            total: 10,
            version: null,
            confirm: false,
          });
        expect(total.status, JSON.stringify(total.body)).toBe(200);
        const refused = await calls.put(`/api/journal/lessons/${s.first}/homework-given`, {
          planWorkIds: [first.homeworks[0]],
          notGiven: true,
        });
        expect(refused.status).toBe(409);
        expect(codeOf(refused)).toBe('homework_has_entries');
        ok(
          await calls.put(`/api/journal/lessons/${s.first}/homework-given`, {
            planWorkIds: [first.homeworks[1]],
            notGiven: true,
          }),
        );
        // A first write of the homework marked "not given" finds no column at the next lesson.
        const late = await request(t.kit.server)
          .put(`/api/journal/lessons/${s.second}/works/total`)
          .set('Cookie', owner.cookie)
          .set(BRANCH_HEADER, s.branch)
          .send({
            column: { planWorkId: first.homeworks[1], sourceLessonId: s.first },
            total: 10,
            version: null,
            confirm: false,
          });
        expect(late.status).toBe(409);
        expect(codeOf(late)).toBe('work_not_in_lesson');
      });
    });

    it('refuses a homework of another lesson, and 404s an unknown or other-branch homework', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const other = await scene();
      await itemAt(s, s.first, { homeworks: ['Read'] });
      const second = await itemAt(s, s.second, { homeworks: ['Write'] });
      const theirs = await itemAt(other, other.first, { homeworks: ['Draw'] });
      const before = await rowsOf(s.branch);
      const otherBefore = await rowsOf(other.branch);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const wrong = await calls.put(`/api/journal/lessons/${s.first}/homework-given`, {
          planWorkIds: [second.homeworks[0]],
          notGiven: true,
        });
        expect(codeOf(wrong)).toBe('homework_not_in_lesson');
        for (const id of [theirs.homeworks[0] ?? '', randomUUID()]) {
          const missing = await calls.put(`/api/journal/lessons/${s.first}/homework-given`, {
            planWorkIds: [id],
            notGiven: true,
          });
          expect(missing.status).toBe(404);
        }
        const lessonMissing = await calls.put(
          `/api/journal/lessons/${other.first}/homework-given`,
          {
            planWorkIds: [theirs.homeworks[0]],
            notGiven: true,
          },
        );
        expect(lessonMissing.status).toBe(404);
      });
      expect(await rowsOf(s.branch)).toEqual(before);
      expect(await rowsOf(other.branch)).toEqual(otherBefore);
    });
  });

  describe('topic not delivered', () => {
    it('copies the item into "not covered" of this class, prepares a request, and an undo clears the untouched copy', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const first = await itemAt(s, s.first, { classworks: ['Test'], homeworks: ['Read'] });
      const planId = await planOf(s.journal, s.q1);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const set = lessonDeliveryAnswerSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${s.first}/delivery`, {
              notDelivered: true,
              version: null,
            }),
          ),
        );
        expect(set).toMatchObject({ notDelivered: true, version: 1 });
        const copy = await t.database.migrator
          .selectFrom('lesson_plan_items')
          .select(['topic', 'copied_from', 'not_delivered_from', 'cleared_at'])
          .where('id', '=', set.copyItemId ?? '')
          .executeTakeFirstOrThrow();
        expect(copy).toEqual({
          topic: 'Fractions',
          copied_from: first.itemId,
          not_delivered_from: s.first,
          cleared_at: null,
        });
        const places = await t.database.migrator
          .selectFrom('lesson_plan_places')
          .select(['journal_id', 'position'])
          .where('item_id', '=', set.copyItemId ?? '')
          .execute();
        const quarterRows = await rowOf(s.classId, s.third);
        expect(places).toEqual([{ journal_id: s.journal, position: quarterRows + 1 }]);
        // A request is prepared with the cause "not covered".
        const requestRow = await t.database.migrator
          .selectFrom('lesson_plan_requests')
          .innerJoin(
            'lesson_plan_request_causes',
            'lesson_plan_request_causes.request_id',
            'lesson_plan_requests.id',
          )
          .select(['lesson_plan_requests.status', 'lesson_plan_request_causes.kind'])
          .where('lesson_plan_requests.plan_id', '=', planId)
          .execute();
        expect(requestRow).toEqual([{ status: 'prepared', kind: 'not_covered' }]);
        const grid = await gridOf(calls, s.journal);
        expect(lessonIn(grid, s.first).notDelivered).toBe(true);
        // The plan screen lists the copy as "not covered".
        const plan = ok(await calls.get(`/api/plans/journals/${s.journal}?quarterId=${s.q1}`)) as {
          notCovered: { id: string }[];
        };
        expect(plan.notCovered.map((one) => one.id)).toContain(set.copyItemId);

        const stale = await calls.put(`/api/journal/lessons/${s.first}/delivery`, {
          notDelivered: false,
          version: null,
        });
        expect(codeOf(stale)).toBe('delivery_stale');
        const undone = lessonDeliveryAnswerSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${s.first}/delivery`, {
              notDelivered: false,
              version: 1,
            }),
          ),
        );
        expect(undone).toEqual({ notDelivered: false, version: 2, copyItemId: null });
        const cleared = await t.database.migrator
          .selectFrom('lesson_plan_items')
          .select('cleared_at')
          .where('id', '=', set.copyItemId ?? '')
          .executeTakeFirstOrThrow();
        expect(cleared.cleared_at).not.toBeNull();
      });
      const entries = (await entriesOf('journal.topic_not_delivered')).filter(
        (one) => one.record_id === s.first,
      );
      expect(
        entries.map((one) => (one.new_value as { notDelivered: boolean }).notDelivered),
      ).toEqual([true, false]);
      expect((entries[1]?.old_value as { copy?: { topic: string } }).copy?.topic).toBe('Fractions');
    });

    it('refuses the undo once the copy was edited (decision 7)', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await itemAt(s, s.first);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const set = lessonDeliveryAnswerSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${s.first}/delivery`, {
              notDelivered: true,
              version: null,
            }),
          ),
        );
        await t.database.migrator
          .updateTable('lesson_plan_items')
          .set({ topic: 'Fractions, merged' })
          .where('id', '=', set.copyItemId ?? '')
          .execute();
        const refused = await calls.put(`/api/journal/lessons/${s.first}/delivery`, {
          notDelivered: false,
          version: 1,
        });
        expect(refused.status).toBe(409);
        expect(codeOf(refused)).toBe('not_delivered_copy_used');
      });
    });

    it('puts the copy into the one class of a shared plan, and a follow of the other class does not lay it', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id }, true);
      // Share the second class's journal into the first's plan, as the share writes it.
      const planId = await planOf(s.journal, s.q1);
      const otherPlan = await planOf(s.otherJournal, s.q1);
      await t.database.migrator
        .updateTable('lesson_plan_journals')
        .set({ plan_id: planId })
        .where('plan_id', '=', otherPlan)
        .where('journal_id', '=', s.otherJournal)
        .execute();
      await itemAt(s, s.first, {}, [
        { journal: s.journal, classId: s.classId, lesson: s.first },
        { journal: s.otherJournal, classId: s.otherClass, lesson: s.otherFirst },
      ]);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const set = lessonDeliveryAnswerSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${s.first}/delivery`, {
              notDelivered: true,
              version: null,
            }),
          ),
        );
        // The other class's lesson moves: its journal follows.
        await t.database.migrator
          .updateTable('lessons')
          .set({ cancel_cause: 'reason', cancel_reason: 'Quarantine' })
          .where('id', '=', s.fourth)
          .execute();
        const places = await t.database.migrator
          .selectFrom('lesson_plan_places')
          .select('journal_id')
          .where('item_id', '=', set.copyItemId ?? '')
          .execute();
        expect(places).toEqual([{ journal_id: s.journal }]);
        const other = ok(
          await calls.get(`/api/plans/journals/${s.otherJournal}?quarterId=${s.q1}`),
        ) as { notCovered: { id: string }[] };
        expect(other.notCovered.map((one) => one.id)).not.toContain(set.copyItemId);
      });
    });

    it('lets the substitute in force set it, and tells the owner; another teacher is refused', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const third = await itemAt(s, s.third);
      const sub = await account();
      const otherSubject = await load.classes.subject({ grades: [7] });
      const substitute = await load.teacher(s.branch, {
        subjects: [{ subject: otherSubject, grades: [7] }],
        accountId: sub.account.id,
      });
      await hoursOf(t, s.branch, substitute.staffId);
      await t.database.migrator
        .deleteFrom('staff_availability_ranges')
        .where('staff_id', '=', s.spareTeacher.staffId)
        .where('weekday', '=', 1)
        .execute();
      ok(
        await request(t.kit.server)
          .post(`/api/timetable/lessons/${s.third}/substitute`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, s.branch)
          .set(REQUEST_KEY_HEADER, randomUUID())
          .send({
            teacherId: substitute.staffId,
            reason: 'The teacher is at a seminar',
            confirm: true,
          }),
      );
      // A file of the item, and one of the item of another lesson (plan review correction 1).
      const fileOf = async (itemId: string) => {
        const file = await t.database.migrator
          .insertInto('lesson_plan_files')
          .values({
            branch_id: s.branch,
            item_id: itemId,
            name: 'Sheet.pdf',
            type: 'application/pdf',
            bytes: 4,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await store.put(planFileKey(itemId, file.id), Buffer.from('%PDF'), 'application/pdf');
        return file.id;
      };
      const own = await fileOf(third.itemId);
      const elsewhere = await fileOf((await itemAt(s, s.second)).itemId);
      await as(sub, s.branch, teacherIn(s), async (calls) => {
        const card = await cardOf(calls, s.third);
        expect(card).toMatchObject({ whole: true, canMark: true, topic: 'Fractions' });
        expect(card.files.map((one) => one.id)).toEqual([own]);
        expect((await calls.get(`/api/plans/files/${own}`)).status).toBe(200);
        const other = await calls.get(`/api/plans/files/${elsewhere}`);
        expect(codeOf(other)).toBe('plan_scope');
        ok(
          await calls.put(`/api/journal/lessons/${s.third}/delivery`, {
            notDelivered: true,
            version: null,
          }),
        );
        // Not another lesson of the plan.
        const refused = await calls.put(`/api/journal/lessons/${s.second}/delivery`, {
          notDelivered: true,
          version: null,
        });
        expect(refused.status).toBe(403);
      });
      const notices = await t.database.migrator
        .selectFrom('notifications')
        .select(['kind', 'account_id'])
        .where('kind', '=', 'plans.not_delivered')
        .execute();
      expect(notices).toEqual([{ kind: 'plans.not_delivered', account_id: owner.account.id }]);
      // The substitution withdrawn: the substitute reads the file no more.
      ok(
        await request(t.kit.server)
          .post(`/api/timetable/lessons/${s.third}/substitution/withdraw`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, s.branch)
          .set(REQUEST_KEY_HEADER, randomUUID())
          .send({ reason: 'The seminar is cancelled' }),
      );
      await as(sub, s.branch, teacherIn(s), async (calls) => {
        expect(codeOf(await calls.get(`/api/plans/files/${own}`))).toBe('plan_scope');
      });
      const stranger = await account();
      await load.teacher(s.branch, { accountId: stranger.account.id });
      await as(stranger, s.branch, teacherIn(s), async (calls) => {
        const refused = await calls.put(`/api/journal/lessons/${s.third}/delivery`, {
          notDelivered: false,
          version: 1,
        });
        expect(refused.status).toBe(403);
        expect(codeOf(refused)).toBe('journal_entry_scope');
      });
    });

    it('refuses a lesson not held, a lesson with no item, and a lesson after the lock', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await itemAt(s, s.first);
      await itemAt(s, s.third);
      // Before the 26th's lesson starts at 08:00.
      await as(
        owner,
        s.branch,
        teacherIn(s),
        async (calls) => {
          const future = await calls.put(`/api/journal/lessons/${s.third}/delivery`, {
            notDelivered: true,
            version: null,
          });
          expect(codeOf(future)).toBe('entry_not_started');
        },
        '2026-10-26T07:00:00+05:00',
      );
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const none = await calls.put(`/api/journal/lessons/${s.second}/delivery`, {
          notDelivered: true,
          version: null,
        });
        expect(codeOf(none)).toBe('no_plan_item');
      });
      await setEditDays(t.database.migrator, s.branch, 7);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const locked = await calls.put(`/api/journal/lessons/${s.first}/delivery`, {
          notDelivered: true,
          version: null,
        });
        expect(codeOf(locked)).toBe('journal_locked');
        const card = await cardOf(calls, s.first);
        expect(card.canMark).toBe(false);
      });
    });

    it('is withdrawn with its untouched copy when the lesson is cancelled after its date (decision 5)', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const first = await itemAt(s, s.second, { homeworks: ['Read'] });
      let copyId = '';
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        copyId =
          lessonDeliveryAnswerSchema.parse(
            ok(
              await calls.put(`/api/journal/lessons/${s.second}/delivery`, {
                notDelivered: true,
                version: null,
              }),
            ),
          ).copyItemId ?? '';
        ok(
          await calls.put(`/api/journal/lessons/${s.second}/homework-given`, {
            planWorkIds: first.homeworks,
            notGiven: true,
          }),
        );
      });
      // The Academic Vice Principal records that the lesson of the 19th did not happen.
      t.clock.set(MOMENT);
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
        .execute();
      try {
        const cancelled = await request(t.kit.server)
          .post(`/api/timetable/lessons/${s.second}/correction`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, s.branch)
          .set(REQUEST_KEY_HEADER, randomUUID())
          .send({ kind: 'cancel', reason: 'The class was on a trip', confirm: true });
        expect(cancelled.status, JSON.stringify(cancelled.body)).toBeLessThan(300);
      } finally {
        t.clock.set(START);
      }
      const delivery = await t.database.migrator
        .selectFrom('journal_lesson_deliveries')
        .select(['not_delivered', 'changed_how', 'copy_item_id'])
        .where('lesson_id', '=', s.second)
        .executeTakeFirstOrThrow();
      expect(delivery).toEqual({
        not_delivered: false,
        changed_how: 'withdrawn',
        copy_item_id: null,
      });
      const copy = await t.database.migrator
        .selectFrom('lesson_plan_items')
        .select('cleared_at')
        .where('id', '=', copyId)
        .executeTakeFirstOrThrow();
      expect(copy.cleared_at).not.toBeNull();
      const live = await t.database.migrator
        .selectFrom('journal_homework_not_given')
        .select('id')
        .where('lesson_id', '=', s.second)
        .where('undone_at', 'is', null)
        .execute();
      expect(live).toEqual([]);
      const entries = (await entriesOf('journal.topic_not_delivered')).filter(
        (one) => one.record_id === s.second,
      );
      expect((entries.at(-1)?.new_value as { withdrawn?: boolean }).withdrawn).toBe(true);
    });
  });

  describe('the column an approved request opens (decision 3)', () => {
    /** An approved Text request of the owner on lessons, open until the 30th, as the migrator. */
    async function approved(s: Scene, owner: string, lessons: readonly string[]) {
      const planId = await planOf(s.journal, s.q1);
      const row = await t.database.migrator
        .insertInto('lesson_plan_requests')
        .values({
          branch_id: s.branch,
          plan_id: planId,
          journal_id: s.journal,
          quarter_id: s.q1,
          kind: 'text',
          status: 'approved',
          reason: 'A quiz was given',
          requested_by: owner,
          sent_at: new Date('2026-10-27T09:00:00+05:00'),
          decided_by: owner,
          decided_at: new Date('2026-10-27T10:00:00+05:00'),
          days: 3,
          open_until: new Date('2026-10-30T23:59:59.999+05:00'),
          prepared_at: new Date('2026-10-27T09:00:00+05:00'),
          updated_at: new Date('2026-10-27T10:00:00+05:00'),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const lessonId of lessons) {
        const lesson = await t.database.migrator
          .selectFrom('lessons')
          .select(sql<string>`lesson_date::text`.as('date'))
          .where('id', '=', lessonId)
          .executeTakeFirstOrThrow();
        await t.database.migrator
          .insertInto('lesson_plan_request_lessons')
          .values({
            branch_id: s.branch,
            request_id: row.id,
            lesson_id: lessonId,
            lesson_date: lesson.date,
          })
          .execute();
      }
      return row.id;
    }

    const totalOn = (calls: Calls, lessonId: string, planWorkId: string, sourceLessonId: string) =>
      calls.put(`/api/journal/lessons/${lessonId}/works/total`, {
        column: { planWorkId, sourceLessonId },
        total: 10,
        version: null,
        confirm: false,
      });

    it('lets the owner grade a work added after the lock until the period ends, a homework at its check lesson too', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const first = await itemAt(s, s.first, { classworks: ['Test'] });
      await itemAt(s, s.second);
      await setEditDays(t.database.migrator, s.branch, 7);
      const requestId = await approved(s, owner.account.id, [s.first]);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const saved = ok(
          await calls.put(`/api/plans/items/${first.itemId}`, {
            base: {
              topic: 'Fractions',
              objectives: 'Add fractions',
              links: ['https://example.org/fractions'],
              classworks: [{ id: first.classworks[0], title: 'Test', description: 'About Test' }],
              homeworks: [],
            },
            values: {
              topic: 'Fractions',
              objectives: 'Add fractions',
              links: ['https://example.org/fractions'],
              classworks: [
                { id: first.classworks[0], title: 'Test', description: 'About Test' },
                { title: 'Quiz', description: '' },
              ],
              homeworks: [{ title: 'Read', description: '' }],
            },
          }),
        ) as { classworks: { id: string; title: string }[]; homeworks: { id: string }[] };
        const quiz = saved.classworks.find((one) => one.title === 'Quiz')?.id ?? '';
        const read = saved.homeworks[0]?.id ?? '';
        const openings = await t.database.migrator
          .selectFrom('lesson_plan_work_openings')
          .select(['plan_work_id', 'request_id'])
          .where('request_id', '=', requestId)
          .orderBy('plan_work_id')
          .execute();
        expect(openings).toEqual(
          [quiz, read].sort().map((id) => ({ plan_work_id: id, request_id: requestId })),
        );
        // The classwork added: its column at the lesson of the 12th, locked since the 20th.
        expect((await totalOn(calls, s.first, quiz, s.first)).status).toBe(200);
        // The homework added at the 12th is checked on the 19th, locked since the 27th.
        expect((await totalOn(calls, s.second, read, s.first)).status).toBe(200);
        // A work of the item from before is not opened.
        const old = await totalOn(calls, s.first, first.classworks[0] ?? '', s.first);
        expect(codeOf(old)).toBe('journal_locked');
      });
      const lines = await t.database.migrator
        .selectFrom('journal_work_history')
        .select(['changed_how', 'plan_request_id'])
        .where('lesson_id', 'in', [s.first, s.second])
        .where('total_after', '=', 10)
        .execute();
      expect(lines).toEqual([
        { changed_how: 'late_entry', plan_request_id: requestId },
        { changed_how: 'late_entry', plan_request_id: requestId },
      ]);
      // After the period, and after "finished", the columns lock again.
      await as(
        owner,
        s.branch,
        teacherIn(s),
        async (calls) => {
          const grid = await gridOf(calls, s.journal);
          const quiz = lessonIn(grid, s.first).works.find((one) => one.title === 'Quiz');
          const late = await calls.put(`/api/journal/lessons/${s.first}/works/total`, {
            column: { workId: quiz?.id ?? '' },
            total: 12,
            version: quiz?.version ?? null,
            confirm: false,
          });
          expect(codeOf(late)).toBe('journal_locked');
        },
        '2026-10-31T09:00:00+05:00',
      );
      await t.database.migrator
        .updateTable('lesson_plan_requests')
        .set({ finished_at: new Date('2026-10-28T09:00:00+05:00') })
        .where('id', '=', requestId)
        .execute();
      await as(
        owner,
        s.branch,
        teacherIn(s),
        async (calls) => {
          const grid = await gridOf(calls, s.journal);
          const quiz = lessonIn(grid, s.first).works.find((one) => one.title === 'Quiz');
          const finished = await calls.put(`/api/journal/lessons/${s.first}/works/total`, {
            column: { workId: quiz?.id ?? '' },
            total: 12,
            version: quiz?.version ?? null,
            confirm: false,
          });
          expect(codeOf(finished)).toBe('journal_locked');
        },
        '2026-10-29T09:00:00+05:00',
      );
    });

    it("refuses a write under the opening by a teacher who is not the lesson's (the guard of 0130)", async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const first = await itemAt(s, s.first, { classworks: ['Test'] });
      await setEditDays(t.database.migrator, s.branch, 7);
      const requestId = await approved(s, owner.account.id, [s.first]);
      await t.database.migrator
        .insertInto('lesson_plan_work_openings')
        .values({
          branch_id: s.branch,
          plan_work_id: first.classworks[0] ?? '',
          request_id: requestId,
        })
        .execute();
      const work = await t.database.migrator
        .insertInto('journal_works')
        .values({
          branch_id: s.branch,
          lesson_id: s.first,
          source_lesson_id: s.first,
          plan_work_id: first.classworks[0] ?? '',
          kind: 'classwork',
          changed_by: owner.account.id,
          changed_how: 'entry',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const stranger = await account();
      const write = async (accountId: string) => {
        t.clock.set(MOMENT);
        try {
          await t.app.get(Transactions).run([s.branch], async (transaction) => {
            await transaction
              .insertInto('audit_log')
              .values({
                occurred_at: new Date(MOMENT),
                branch_id: s.branch,
                action: 'test.opening',
              })
              .execute();
            await sql`select set_config('app.plan_request_id', ${requestId}, true)`.execute(
              transaction,
            );
            await transaction
              .updateTable('journal_works')
              .set({ total: 10, changed_by: accountId, changed_how: 'entry' })
              .where('id', '=', work.id)
              .execute();
          });
        } finally {
          t.clock.set(START);
        }
      };
      await expect(write(stranger.account.id)).rejects.toMatchObject({
        constraint: 'journal_locked',
      });
      await write(owner.account.id);
    });
  });
});
