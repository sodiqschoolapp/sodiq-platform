import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  homeworkGivenAnswerSchema,
  journalGridSchema,
  lessonCardSchema,
  lessonDeliveryAnswerSchema,
  planCompletenessSchema,
  planProgressSchema,
  planRequestsReportSchema,
  remindersSchema,
  type JournalGrid,
  type JournalLesson,
  type LessonCard,
  type Reminder,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { setEditDays } from '../../testing/branch-filter-sql.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { hoursOf, publishedScene } from '../../testing/published-scene.js';
import { linesOf, RecordingPdf } from '../../testing/pdf-kit.js';
import { binary } from '../../testing/xlsx-kit.js';
import { MemoryPhotoStore, planFileKey } from '../people/photo-store.js';

const store = new MemoryPhotoStore();
const pdf = new RecordingPdf();

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
    post: (path: string, body: object) => Promise<Response>;
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
      const at = (method: 'get' | 'put' | 'post', path: string) =>
        request(t.kit.server)
          [method](path)
          .set('Cookie', browser.cookie)
          .set(BRANCH_HEADER, branch);
      return await work({
        get: (path) => at('get', path),
        put: (path, body) => at('put', path).send(body),
        post: (path, body) => at('post', path).set(REQUEST_KEY_HEADER, randomUUID()).send(body),
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
          'lesson_plan_works',
          'notifications',
          'audit_log',
        ] as const
      ).map((table) =>
        t.database.migrator
          .selectFrom(table)
          .selectAll()
          .where('branch_id', '=', branch)
          // The roles a test gives write their own lines.
          .$if(table === 'audit_log', (query) =>
            query.where(sql<boolean>`action <> 'assignment.given'`),
          )
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

  /** An approved Text request of the owner on lessons, open until the 30th, as the migrator. */
  async function approvedRequest(s: Scene, owner: string, lessons: readonly string[]) {
    // Decided by another account (`refuseOwnRequest`).
    const decider = (await account()).account.id;
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
        decided_by: decider,
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

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true, photoStore: store, pdfRenderer: pdf });
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
      const own = await itemAt(s, s.first, { homeworks: ['Read'] });
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
        // The path: another branch's or an unknown lesson, with a homework of this branch.
        for (const lesson of [other.first, randomUUID()]) {
          const lessonMissing = await calls.put(`/api/journal/lessons/${lesson}/homework-given`, {
            planWorkIds: [own.homeworks[0]],
            notGiven: true,
          });
          expect(lessonMissing.status).toBe(404);
        }
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
        // A held lesson of the other class is cancelled: its journal follows.
        const [, otherSecond] = (
          await t.database.migrator
            .selectFrom('lessons')
            .select('id')
            .where('class_id', '=', s.otherClass)
            .where('lesson_date', '>=', '2026-10-12')
            .orderBy('starts_at')
            .execute()
        ).map((row) => row.id);
        await t.database.migrator
          .updateTable('sessions')
          .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
          .execute();
        const cancelled = await request(t.kit.server)
          .post(`/api/timetable/lessons/${otherSecond ?? ''}/correction`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, s.branch)
          .set(REQUEST_KEY_HEADER, randomUUID())
          .send({ kind: 'cancel', reason: 'Quarantine', confirm: true });
        expect(cancelled.status, JSON.stringify(cancelled.body)).toBeLessThan(300);
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
    const approved = approvedRequest;

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

  describe('the plan reports, the minimums and the export', () => {
    /** A window of quarter 1 that ended on 20 October, as the migrator. */
    const endedWindow = (s: Scene) =>
      sql`
        insert into lesson_plan_windows
          (branch_id, quarter_id, start_date, end_date, starts_at, ends_at, opened_at, opened_by)
        select q.branch_id, q.id, date '2026-09-01', date '2026-10-20',
          (date '2026-09-01')::timestamp at time zone b.time_zone,
          ((date '2026-10-21')::timestamp at time zone b.time_zone) - interval '1 millisecond',
          now(), (select a.id from accounts a order by a.id limit 1)
        from quarters q join branches b on b.id = q.branch_id
        where q.id = ${s.q1}
      `.execute(t.database.migrator);

    const vice = (s: Scene) => [{ role: 'academic_vice_principal' as const, branchId: s.branch }];

    it('counts completeness per teacher, department and branch, and shows the minimum once the window has ended', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await itemAt(s, s.first, { classworks: ['Test'] });
      await endedWindow(s);
      const head = await account();
      await as(head, s.branch, vice(s), async (calls) => {
        const minimums = ok(await calls.get('/api/plans/minimums')) as {
          subjects: { subject: { id: string }; version: number | null }[];
          canEdit: boolean;
        };
        expect(minimums.canEdit).toBe(true);
        expect(minimums.subjects.some((one) => one.subject.id === s.subject)).toBe(true);
        ok(
          await calls.put('/api/plans/minimums', {
            subjectId: s.subject,
            classworks: 2,
            homeworks: 1,
            version: null,
          }),
        );
        const stale = await calls.put('/api/plans/minimums', {
          subjectId: s.subject,
          classworks: 3,
          homeworks: 1,
          version: null,
        });
        expect(codeOf(stale)).toBe('plan_minimum_stale');
        const report = planCompletenessSchema.parse(
          ok(await calls.get(`/api/plans/reports/completeness?quarterId=${s.q1}`)),
        );
        const plan = report.plans.find((one) => one.journalId === s.journal);
        expect(plan).toMatchObject({
          state: 'incomplete',
          rows: 3,
          empty: 2,
          flag: 'overdue',
          belowMinimum: { classworks: 1, homeworks: 0, minimumClassworks: 2, minimumHomeworks: 1 },
        });
        expect(plan?.teacher?.id).toBe(s.teacher.staffId);
        const counts = report.teachers.find((one) => one.teacher?.id === s.teacher.staffId)?.counts;
        expect(counts).toMatchObject({
          incomplete: 1,
          noTopic: 2,
          overdue: 1,
          belowMinimum: 1,
          percentComplete: 0,
        });
        expect(report.branch.plans).toBeGreaterThanOrEqual(1);
        const list = ok(await calls.get('/api/plans')) as {
          plans: { journalId: string; quarters: { quarterId: string; belowMinimum: unknown }[] }[];
        };
        expect(
          list.plans
            .find((one) => one.journalId === s.journal)
            ?.quarters.find((one) => one.quarterId === s.q1)?.belowMinimum,
        ).not.toBeNull();
      });
      // A Head Teacher of another subject sees none of it.
      const other = await account();
      const otherSubject = await load.classes.subject({ grades: [7] });
      await as(
        other,
        s.branch,
        [{ role: 'head_teacher', branchId: s.branch, subjectIds: [otherSubject] }],
        async (calls) => {
          const report = planCompletenessSchema.parse(
            ok(await calls.get(`/api/plans/reports/completeness?quarterId=${s.q1}`)),
          );
          expect(report.plans).toEqual([]);
          const refused = await calls.put('/api/plans/minimums', {
            subjectId: s.subject,
            classworks: 0,
            homeworks: 0,
            version: 1,
          });
          expect(refused.status).toBe(403);
        },
      );
      const entries = await entriesOf('plan.minimums');
      expect(entries.at(-1)?.new_value).toEqual({ classworks: 2, homeworks: 1 });
    });

    it('reports progress: held against delivered, behind, not covered and the share of "not held"', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const first = await itemAt(s, s.first, { classworks: ['Test', 'Quiz'] });
      await itemAt(s, s.second, { topic: 'Decimals' });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(
          await calls.put(`/api/journal/lessons/${s.second}/delivery`, {
            notDelivered: true,
            version: null,
          }),
        );
        ok(
          await calls.put(`/api/journal/lessons/${s.first}/works/not-held`, {
            column: { planWorkId: first.classworks[0], sourceLessonId: s.first },
            notHeld: true,
            version: null,
            confirm: false,
          }),
        );
      });
      const head = await account();
      await as(head, s.branch, vice(s), async (calls) => {
        const report = planProgressSchema.parse(
          ok(await calls.get(`/api/plans/reports/progress?quarterId=${s.q1}`)),
        );
        expect(report.plans.find((one) => one.journalId === s.journal)).toMatchObject({
          rows: 3,
          planned: 2,
          held: 3,
          delivered: 1,
          notCovered: 1,
          behind: true,
        });
        expect(report.teachers.find((one) => one.teacher?.id === s.teacher.staffId)).toMatchObject({
          plannedWorks: 2,
          notHeld: 1,
          percentNotHeld: 50,
        });
      });
    });

    it('lists the edit requests per teacher with who decided and what changed', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await itemAt(s, s.first);
      const planId = await planOf(s.journal, s.q1);
      const decider = await account();
      await load.classes.person(s.branch, ['uz'], { accountId: decider.account.id });
      const stored = await t.database.migrator
        .insertInto('lesson_plan_requests')
        .values({
          branch_id: s.branch,
          plan_id: planId,
          journal_id: s.journal,
          quarter_id: s.q1,
          kind: 'text',
          status: 'refused',
          reason: 'A typing mistake',
          requested_by: owner.account.id,
          sent_at: new Date('2026-10-20T09:00:00+05:00'),
          decided_by: decider.account.id,
          decided_at: new Date('2026-10-21T10:00:00+05:00'),
          prepared_at: new Date('2026-10-20T09:00:00+05:00'),
          updated_at: new Date('2026-10-21T10:00:00+05:00'),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const head = await account();
      await as(head, s.branch, vice(s), async (calls) => {
        const report = planRequestsReportSchema.parse(
          ok(await calls.get(`/api/plans/reports/requests?quarterId=${s.q1}`)),
        );
        const teacher = report.teachers.find((one) => one.teacher?.id === s.teacher.staffId);
        expect(teacher?.total).toBe(1);
        expect(teacher?.requests[0]).toMatchObject({
          id: stored.id,
          kind: 'text',
          status: 'refused',
          decidedOn: '2026-10-21',
          changes: [],
        });
        expect(teacher?.requests[0]?.decidedBy).not.toBeNull();
        const file = await request(t.kit.server)
          .post('/api/plans/reports/export')
          .set('Cookie', head.cookie)
          .set(BRANCH_HEADER, s.branch)
          .send({ report: 'requests', quarterId: s.q1 });
        expect(file.status).toBe(200);
      });
    });

    it('exports a plan with its marks, and refuses a teacher who does not read it', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await itemAt(s, s.first, { homeworks: ['Read'] });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(
          await calls.put(`/api/journal/lessons/${s.first}/delivery`, {
            notDelivered: true,
            version: null,
          }),
        );
        const before = (await entriesOf('plan.export')).length;
        const file = await request(t.kit.server)
          .post(`/api/plans/journals/${s.journal}/export`)
          .set('Cookie', owner.cookie)
          .set(BRANCH_HEADER, s.branch)
          .send({ quarterId: s.q1, format: 'xlsx' });
        expect(file.status, JSON.stringify(file.body)).toBe(200);
        const entries = await entriesOf('plan.export');
        expect(entries).toHaveLength(before + 1);
        expect(entries.at(-1)?.details).toMatchObject({ format: 'xlsx', rows: 3, notCovered: 1 });
      });
      const stranger = await account();
      await load.teacher(s.branch, { accountId: stranger.account.id });
      const before = (await entriesOf('plan.export')).length;
      await as(stranger, s.branch, teacherIn(s), async () => {
        const refused = await request(t.kit.server)
          .post(`/api/plans/journals/${s.journal}/export`)
          .set('Cookie', stranger.cookie)
          .set(BRANCH_HEADER, s.branch)
          .send({ quarterId: s.q1, format: 'xlsx' });
        expect(refused.status).toBe(403);
      });
      expect(await entriesOf('plan.export')).toHaveLength(before);
    });
  });

  describe('"not given" against a first entry at the same moment, and the database', () => {
    /** Two real routes in a fixed order behind a hold of the plan work both lock first. */
    async function inOrder(
      planWorkId: string,
      first: () => Promise<Response>,
      second: () => Promise<Response>,
    ) {
      const waiting = async () => {
        const found = await sql<{ n: number }>`
          select count(distinct l.pid)::int as n
          from pg_locks l join pg_stat_activity a on a.pid = l.pid
          where a.datname = current_database() and not l.granted
        `.execute(t.database.migrator);
        return found.rows[0]?.n ?? 0;
      };
      const until = async (count: number) => {
        for (let tries = 0; tries < 800; tries += 1) {
          if ((await waiting()) >= count) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error(`Fewer than ${String(count)} waited on the plan work.`);
      };
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const held = t.database.migrator.transaction().execute(async (transaction) => {
        await transaction
          .selectFrom('lesson_plan_works')
          .select('id')
          .where('id', '=', planWorkId)
          .forUpdate()
          .execute();
        ready();
        await released;
      });
      await isReady;
      const one = new Promise<Response>((resolve, reject) => {
        first().then(resolve, reject);
      });
      await until(1);
      const two = new Promise<Response>((resolve, reject) => {
        second().then(resolve, reject);
      });
      await until(2);
      release();
      await held;
      return Promise.all([one, two]);
    }

    const markOf = (cookie: string, s: Scene, planWorkId: string) => () =>
      request(t.kit.server)
        .put(`/api/journal/lessons/${s.first}/homework-given`)
        .set('Cookie', cookie)
        .set(BRANCH_HEADER, s.branch)
        .send({ planWorkIds: [planWorkId], notGiven: true })
        .then((response) => response);
    const totalOf = (cookie: string, s: Scene, planWorkId: string) => () =>
      request(t.kit.server)
        .put(`/api/journal/lessons/${s.second}/works/total`)
        .set('Cookie', cookie)
        .set(BRANCH_HEADER, s.branch)
        .send({
          column: { planWorkId, sourceLessonId: s.first },
          total: 10,
          version: null,
          confirm: false,
        })
        .then((response) => response);

    it('refuses the total when "not given" came first, and "not given" when the total came first', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const first = await itemAt(s, s.first, { homeworks: ['Read', 'Write'] });
      await itemAt(s, s.second);
      const [read, write] = first.homeworks;
      if (read === undefined || write === undefined) throw new Error('Two homeworks.');
      await as(owner, s.branch, teacherIn(s), async () => {
        const [marked, total] = await inOrder(
          read,
          markOf(owner.cookie, s, read),
          totalOf(owner.cookie, s, read),
        );
        expect(marked.status, JSON.stringify(marked.body)).toBe(200);
        expect(codeOf(total)).toBe('journal_work_not_given');
        const [totalFirst, markLater] = await inOrder(
          write,
          totalOf(owner.cookie, s, write),
          markOf(owner.cookie, s, write),
        );
        expect(totalFirst.status, JSON.stringify(totalFirst.body)).toBe(200);
        expect(codeOf(markLater)).toBe('homework_has_entries');
      });
      const live = await t.database.migrator
        .selectFrom('journal_homework_not_given')
        .select('plan_work_id')
        .where('lesson_id', '=', s.first)
        .where('undone_at', 'is', null)
        .execute();
      expect(live).toEqual([{ plan_work_id: read }]);
    });

    it('keeps the history of the marks append-only and written by its trigger only', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await itemAt(s, s.first);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(
          await calls.put(`/api/journal/lessons/${s.first}/delivery`, {
            notDelivered: true,
            version: null,
          }),
        );
      });
      t.clock.set(MOMENT);
      try {
        const refusal = async (work: (transaction: Transaction) => Promise<unknown>) => {
          try {
            await t.app.get(Transactions).run([s.branch], work);
          } catch (error) {
            return error as { code?: string };
          }
          throw new Error('The database did not refuse it.');
        };
        expect(
          (
            await refusal((transaction) =>
              transaction
                .updateTable('journal_delivery_history')
                .set({ marked_after: false })
                .where('lesson_id', '=', s.first)
                .execute(),
            )
          ).code,
        ).toBe('42501');
        expect(
          (
            await refusal((transaction) =>
              transaction
                .deleteFrom('journal_delivery_history')
                .where('lesson_id', '=', s.first)
                .execute(),
            )
          ).code,
        ).toBe('42501');
      } finally {
        t.clock.set(START);
      }
    });

    it('refuses a mark after the lock without an unlock, in the database too', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const first = await itemAt(s, s.first);
      await setEditDays(t.database.migrator, s.branch, 7);
      t.clock.set(MOMENT);
      try {
        const error = await t.app
          .get(Transactions)
          .run([s.branch], async (transaction) => {
            await transaction
              .insertInto('audit_log')
              .values({
                occurred_at: new Date(MOMENT),
                branch_id: s.branch,
                action: 'test.delivery',
              })
              .execute();
            await transaction
              .insertInto('journal_lesson_deliveries')
              .values({
                branch_id: s.branch,
                lesson_id: s.first,
                journal_id: s.journal,
                item_id: first.itemId,
                not_delivered: true,
                changed_by: owner.account.id,
                changed_how: 'entry',
                changed_at: new Date(MOMENT),
              })
              .execute();
          })
          .then(
            () => null,
            (failure: unknown) => failure as { constraint?: string },
          );
        expect(error?.constraint).toBe('journal_locked');
      } finally {
        t.clock.set(START);
      }
    });
  });
  describe('the paths of other branches, other subjects and other roles (code review)', () => {
    it('answers 404 for the delivery of another branch’s or an unknown lesson, leaving every row of both branches', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await itemAt(s, s.first, { homeworks: ['Read'] });
      const otherOwner = await account();
      const other = await scene({ teacher: otherOwner.account.id });
      await itemAt(other, other.first, { homeworks: ['Draw'] });
      // Rows the route would write, in both branches.
      await as(otherOwner, other.branch, teacherIn(other), async (calls) => {
        ok(
          await calls.put(`/api/journal/lessons/${other.first}/delivery`, {
            notDelivered: true,
            version: null,
          }),
        );
      });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(
          await calls.put(`/api/journal/lessons/${s.first}/delivery`, {
            notDelivered: true,
            version: null,
          }),
        );
      });
      const before = await rowsOf(s.branch);
      const otherBefore = await rowsOf(other.branch);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        for (const lesson of [other.first, randomUUID()]) {
          for (const body of [
            { notDelivered: true, version: null },
            { notDelivered: false, version: 1 },
          ]) {
            const missing = await calls.put(`/api/journal/lessons/${lesson}/delivery`, body);
            expect(missing.status).toBe(404);
          }
          expect((await calls.get(`/api/journal/lessons/${lesson}/card`)).status).toBe(404);
        }
      });
      expect(await rowsOf(s.branch)).toEqual(before);
      expect(await rowsOf(other.branch)).toEqual(otherBefore);
    });

    it('refuses the Academic Vice Principal both marks, and gives the card whole to the Head Teacher of the subject, the Senior Head Teacher and the vice; a Head Teacher of another subject is refused', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await itemAt(s, s.first, { classworks: ['Test'], homeworks: ['Read'] });
      const before = await rowsOf(s.branch);
      const vice = await account();
      await as(
        vice,
        s.branch,
        [{ role: 'academic_vice_principal', branchId: s.branch }],
        async (calls) => {
          const delivery = await calls.put(`/api/journal/lessons/${s.first}/delivery`, {
            notDelivered: true,
            version: null,
          });
          expect(delivery.status).toBe(403);
          expect(codeOf(delivery)).toBe('journal_entry_scope');
          const card = await cardOf(calls, s.first);
          expect(card).toMatchObject({ whole: true, canMark: false });
          expect(card.classworks.map((one) => one.title)).toEqual(['Test']);
          const homework = await calls.put(`/api/journal/lessons/${s.first}/homework-given`, {
            planWorkIds: card.givenToday.flatMap((one) =>
              one.planWorkId === null ? [] : [one.planWorkId],
            ),
            notGiven: true,
          });
          expect(homework.status).toBe(403);
          expect(codeOf(homework)).toBe('journal_entry_scope');
        },
      );
      expect(await rowsOf(s.branch)).toEqual(before);
      const head = await account();
      await as(
        head,
        s.branch,
        [{ role: 'head_teacher', branchId: s.branch, subjectIds: [s.subject] }],
        async (calls) => {
          expect(await cardOf(calls, s.first)).toMatchObject({ whole: true, canMark: false });
        },
      );
      const senior = await account();
      await as(
        senior,
        s.branch,
        [{ role: 'senior_head_teacher', subjectIds: [s.subject] }],
        async (calls) => {
          expect(await cardOf(calls, s.first)).toMatchObject({ whole: true, canMark: false });
        },
      );
      const stranger = await account();
      const otherSubject = await load.classes.subject({ grades: [7] });
      await as(
        stranger,
        s.branch,
        [{ role: 'head_teacher', branchId: s.branch, subjectIds: [otherSubject] }],
        async (calls) => {
          const refused = await calls.get(`/api/journal/lessons/${s.first}/card`);
          expect(refused.status).toBe(403);
        },
      );
    });

    it('answers 404 for a minimum of an unknown subject, and refuses an attendance-only subject', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const attendance = await load.classes.subject({
        grades: [7],
        journalType: 'attendance_only',
      });
      const vice = await account();
      const before = await rowsOf(s.branch);
      await as(
        vice,
        s.branch,
        [{ role: 'academic_vice_principal', branchId: s.branch }],
        async (calls) => {
          const unknown = await calls.put('/api/plans/minimums', {
            subjectId: randomUUID(),
            classworks: 1,
            homeworks: 1,
            version: null,
          });
          expect(unknown.status).toBe(404);
          const only = await calls.put('/api/plans/minimums', {
            subjectId: attendance,
            classworks: 1,
            homeworks: 1,
            version: null,
          });
          expect(codeOf(only)).toBe('plan_attendance_only');
        },
      );
      expect(await rowsOf(s.branch)).toEqual(before);
      const stored = await t.database.migrator
        .selectFrom('subject_plan_minimums')
        .select('subject_id')
        .where('branch_id', '=', s.branch)
        .execute();
      expect(stored).toEqual([]);
    });
  });

  describe('the plan reports for each scope, the 404s and the files (code review)', () => {
    /** A window of quarter 1 that ended on 20 October, as the migrator. */
    const endedWindowOf = (s: Scene) =>
      sql`
        insert into lesson_plan_windows
          (branch_id, quarter_id, start_date, end_date, starts_at, ends_at, opened_at, opened_by)
        select q.branch_id, q.id, date '2026-09-01', date '2026-10-20',
          (date '2026-09-01')::timestamp at time zone b.time_zone,
          ((date '2026-10-21')::timestamp at time zone b.time_zone) - interval '1 millisecond',
          now(), (select a.id from accounts a order by a.id limit 1)
        from quarters q join branches b on b.id = q.branch_id
        where q.id = ${s.q1}
      `.execute(t.database.migrator);

    const viceIn = (s: Scene) => [{ role: 'academic_vice_principal' as const, branchId: s.branch }];

    const exportOf = (cookie: string, branch: string, body: object) =>
      request(t.kit.server)
        .post('/api/plans/reports/export')
        .set('Cookie', cookie)
        .set(BRANCH_HEADER, branch)
        .buffer(true)
        .parse(binary)
        .send(body);

    const reportsOf = async (calls: Calls, quarterId: string) => ({
      completeness: planCompletenessSchema.parse(
        ok(await calls.get(`/api/plans/reports/completeness?quarterId=${quarterId}`)),
      ),
      progress: planProgressSchema.parse(
        ok(await calls.get(`/api/plans/reports/progress?quarterId=${quarterId}`)),
      ),
      requests: planRequestsReportSchema.parse(
        ok(await calls.get(`/api/plans/reports/requests?quarterId=${quarterId}`)),
      ),
    });

    it('gives a Head Teacher who also teaches another subject the plans of the own subject only, counting the other, in every report and the file; a Senior Head Teacher the same', async () => {
      const owner = await account();
      const s = await publishedScene(t, load, {
        graded: true,
        accounts: { teacher: owner.account.id },
        secondSubject: true,
      });
      // The second subject graded too, so its journal has a plan.
      await t.database.migrator
        .updateTable('subjects')
        .set({ journal_type: 'graded' })
        .where('id', '=', s.secondSubject ?? '')
        .execute();
      const q1 = (
        await t.database.migrator
          .selectFrom('quarters')
          .select('id')
          .where('academic_year_id', '=', s.year)
          .where('number', '=', 1)
          .executeTakeFirstOrThrow()
      ).id;
      const journals = await t.database.migrator
        .selectFrom('journals')
        .select(['id', 'subject_id', 'class_id'])
        .where('branch_id', '=', s.branch)
        .execute();
      const ofSubject = journals.filter((one) => one.subject_id === s.subject).map((one) => one.id);
      const second = journals.find((one) => one.subject_id === s.secondSubject)?.id ?? '';
      expect(ofSubject).toHaveLength(2);
      const check = async (calls: Calls, shown: readonly string[], counted: number) => {
        const reports = await reportsOf(calls, q1);
        for (const report of [reports.completeness, reports.progress]) {
          expect(report.plans.map((one) => one.journalId).sort()).toEqual([...shown].sort());
          expect(report.otherSubjects).toBe(counted);
        }
      };
      await as(
        owner,
        s.branch,
        [
          { role: 'teacher', branchId: s.branch },
          { role: 'head_teacher', branchId: s.branch, subjectIds: [s.subject] },
        ],
        async (calls) => {
          await check(calls, ofSubject, 1);
          const file = await exportOf(owner.cookie, s.branch, {
            report: 'completeness',
            quarterId: q1,
          });
          expect(file.status).toBe(200);
          const lines = await linesOf(file.body as Buffer);
          const text = JSON.stringify(lines.lines.map((line) => line.values));
          expect(text).not.toContain(s.secondSubject ?? 'none');
          const secondName = await t.database.migrator
            .selectFrom('subjects')
            .select('name_en')
            .where('id', '=', s.secondSubject ?? '')
            .executeTakeFirstOrThrow();
          expect(text).not.toContain(secondName.name_en);
        },
      );
      const senior = await account();
      await as(
        senior,
        s.branch,
        [{ role: 'senior_head_teacher', subjectIds: [s.secondSubject ?? ''] }],
        async (calls) => {
          const reports = await reportsOf(calls, q1);
          expect(reports.completeness.plans.map((one) => one.journalId)).toEqual([second]);
          expect(reports.completeness.otherSubjects).toBe(2);
        },
      );
    });

    it('answers 404 for a quarter of another branch or an unknown one, in every report and the file, logging nothing', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const other = await scene();
      const vice = await account();
      const before = await rowsOf(s.branch);
      await as(vice, s.branch, viceIn(s), async (calls) => {
        for (const quarterId of [other.q1, randomUUID()]) {
          for (const path of ['completeness', 'progress', 'requests']) {
            const missing = await calls.get(`/api/plans/reports/${path}?quarterId=${quarterId}`);
            expect(missing.status, path).toBe(404);
          }
          for (const report of ['completeness', 'progress', 'requests']) {
            const file = await exportOf(vice.cookie, s.branch, { report, quarterId });
            expect(file.status, report).toBe(404);
          }
        }
      });
      expect(await rowsOf(s.branch)).toEqual(before);
    });

    it('answers 404 for the plan file of another branch’s journal or quarter and unknown ids, and refuses a Head Teacher of another subject', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await itemAt(s, s.first);
      const other = await scene();
      const before = await rowsOf(s.branch);
      const otherBefore = await rowsOf(other.branch);
      const send = (cookie: string, journal: string, quarterId: string) =>
        request(t.kit.server)
          .post(`/api/plans/journals/${journal}/export`)
          .set('Cookie', cookie)
          .set(BRANCH_HEADER, s.branch)
          .send({ quarterId, format: 'xlsx' });
      await as(owner, s.branch, teacherIn(s), async () => {
        for (const [journal, quarter] of [
          [other.journal, s.q1],
          [s.journal, other.q1],
          [randomUUID(), s.q1],
          [s.journal, randomUUID()],
        ] as const) {
          expect((await send(owner.cookie, journal, quarter)).status).toBe(404);
        }
      });
      const head = await account();
      const otherSubject = await load.classes.subject({ grades: [7] });
      await as(
        head,
        s.branch,
        [{ role: 'head_teacher', branchId: s.branch, subjectIds: [otherSubject] }],
        async () => {
          expect((await send(head.cookie, s.journal, s.q1)).status).toBe(403);
        },
      );
      expect(await rowsOf(s.branch)).toEqual(before);
      expect(await rowsOf(other.branch)).toEqual(otherBefore);
    });

    it('gives each state and flag of completeness, and the minimum only once the window has ended', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      for (const lesson of [s.first, s.second, s.third]) await itemAt(s, lesson);
      const vice = await account();
      await as(vice, s.branch, viceIn(s), async (calls) => {
        ok(
          await calls.put('/api/plans/minimums', {
            subjectId: s.subject,
            classworks: 2,
            homeworks: 0,
            version: null,
          }),
        );
        const open = planCompletenessSchema.parse(
          ok(await calls.get(`/api/plans/reports/completeness?quarterId=${s.q1}`)),
        );
        expect(open.plans.find((one) => one.journalId === s.journal)).toMatchObject({
          state: 'complete',
          flag: null,
          belowMinimum: null,
        });
        expect(open.plans.find((one) => one.journalId === s.otherJournal)).toMatchObject({
          state: 'not_started',
          flag: 'window_not_opened',
          belowMinimum: null,
        });
        expect(open.branch).toMatchObject({
          complete: 1,
          notStarted: 1,
          windowNotOpened: 1,
          belowMinimum: 0,
          percentComplete: 50,
        });
      });
      await endedWindowOf(s);
      await as(vice, s.branch, viceIn(s), async (calls) => {
        const ended = planCompletenessSchema.parse(
          ok(await calls.get(`/api/plans/reports/completeness?quarterId=${s.q1}`)),
        );
        expect(ended.plans.find((one) => one.journalId === s.journal)).toMatchObject({
          state: 'complete',
          flag: null,
          belowMinimum: { classworks: 0, minimumClassworks: 2 },
        });
        expect(ended.plans.find((one) => one.journalId === s.otherJournal)).toMatchObject({
          state: 'not_started',
          flag: 'overdue',
        });
      });
    });

    it('exports the plan as PDF and Excel with its marks, and the progress report', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await itemAt(s, s.first, { homeworks: ['Read'] });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(
          await calls.put(`/api/journal/lessons/${s.first}/delivery`, {
            notDelivered: true,
            version: null,
          }),
        );
        const card = await cardOf(calls, s.first);
        ok(
          await calls.put(`/api/journal/lessons/${s.first}/homework-given`, {
            planWorkIds: card.givenToday.flatMap((one) =>
              one.planWorkId === null ? [] : [one.planWorkId],
            ),
            notGiven: true,
          }),
        );
      });
      await t.database.migrator
        .updateTable('accounts')
        .set({ language: 'en' })
        .where('id', '=', owner.account.id)
        .execute();
      await as(owner, s.branch, teacherIn(s), async () => {
        const send = (format: 'pdf' | 'xlsx') =>
          request(t.kit.server)
            .post(`/api/plans/journals/${s.journal}/export`)
            .set('Cookie', owner.cookie)
            .set(BRANCH_HEADER, s.branch)
            .buffer(true)
            .parse(binary)
            .send({ quarterId: s.q1, format });
        const made = pdf.htmls.length;
        const printed = await send('pdf');
        expect(printed.status).toBe(200);
        expect(printed.headers['content-type']).toContain('application/pdf');
        expect(pdf.htmls).toHaveLength(made + 1);
        expect(pdf.last).toContain('topic not delivered');
        expect(pdf.last).toContain('not given: Read');
        expect(pdf.last).toContain('Not covered');
        const sheet = await send('xlsx');
        expect(sheet.status).toBe(200);
        const lines = (await linesOf(sheet.body as Buffer)).lines.map((line) =>
          line.values.map((value) => (value === undefined ? null : value)),
        );
        const text = JSON.stringify(lines);
        expect(text).toContain('topic not delivered');
        expect(text).toContain('not given: Read');
      });
      const formats = (await entriesOf('plan.export'))
        .filter((one) => one.record_id === s.journal)
        .map((one) => (one.details as { format: string }).format);
      expect(formats).toEqual(['pdf', 'xlsx']);
      const vice = await account();
      await t.database.migrator
        .updateTable('accounts')
        .set({ language: 'en' })
        .where('id', '=', vice.account.id)
        .execute();
      await as(vice, s.branch, viceIn(s), async () => {
        const before = (await entriesOf('plan_report.export')).length;
        const file = await exportOf(vice.cookie, s.branch, { report: 'progress', quarterId: s.q1 });
        expect(file.status).toBe(200);
        const text = JSON.stringify(
          (await linesOf(file.body as Buffer)).lines.map((one) => one.values),
        );
        expect(text).toContain('Behind the plan');
        expect(await entriesOf('plan_report.export')).toHaveLength(before + 1);
      });
    });

    it('lists what an approved request changed in the requests report', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.first);
      await endedWindowOf(s);
      const requestId = await approvedRequest(s, owner.account.id, [s.first]);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const values = {
          topic: 'Fractions',
          objectives: 'Add fractions',
          links: ['https://example.org/fractions'],
          classworks: [],
          homeworks: [],
        };
        ok(
          await calls.put(`/api/plans/items/${item.itemId}`, {
            base: values,
            values: { ...values, topic: 'Fractions and decimals' },
          }),
        );
      });
      const vice = await account();
      await as(vice, s.branch, viceIn(s), async (calls) => {
        const report = planRequestsReportSchema.parse(
          ok(await calls.get(`/api/plans/reports/requests?quarterId=${s.q1}`)),
        );
        const found = report.teachers
          .flatMap((one) => one.requests)
          .find((one) => one.id === requestId);
        expect(found?.status).toBe('approved');
        expect(found?.changes).toEqual([
          expect.objectContaining({
            topicBefore: 'Fractions',
            topicAfter: 'Fractions and decimals',
          }),
        ]);
      });
    });
  });

  describe('the marks over many lessons, a late cancel and the entries of a homework (code review)', () => {
    it('adds a second "not covered" cause to the one prepared request', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await itemAt(s, s.first);
      await itemAt(s, s.second, { topic: 'Decimals' });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        for (const lesson of [s.first, s.second]) {
          ok(
            await calls.put(`/api/journal/lessons/${lesson}/delivery`, {
              notDelivered: true,
              version: null,
            }),
          );
        }
      });
      const planId = await planOf(s.journal, s.q1);
      const requests = await t.database.migrator
        .selectFrom('lesson_plan_requests')
        .select(['id', 'status'])
        .where('plan_id', '=', planId)
        .execute();
      expect(requests.map((one) => one.status)).toEqual(['prepared']);
      const causes = await t.database.migrator
        .selectFrom('lesson_plan_request_causes')
        .select('kind')
        .where('request_id', '=', requests[0]?.id ?? '')
        .execute();
      expect(causes).toEqual([{ kind: 'not_covered' }, { kind: 'not_covered' }]);
    });

    it('keeps an edited copy when the lesson is cancelled later, and writes "withdrawn" lines into the history', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.second, { homeworks: ['Read'] });
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
            planWorkIds: item.homeworks,
            notGiven: true,
          }),
        );
      });
      await t.database.migrator
        .updateTable('lesson_plan_items')
        .set({ topic: 'Decimals, taught again' })
        .where('id', '=', copyId)
        .execute();
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
      const copy = await t.database.migrator
        .selectFrom('lesson_plan_items')
        .select(['cleared_at', 'topic'])
        .where('id', '=', copyId)
        .executeTakeFirstOrThrow();
      expect(copy).toEqual({ cleared_at: null, topic: 'Decimals, taught again' });
      const lines = await t.database.migrator
        .selectFrom('journal_delivery_history')
        .select(['kind', 'marked_before', 'marked_after', 'changed_how'])
        .where('lesson_id', '=', s.second)
        .orderBy('changed_at')
        .orderBy('kind', 'desc')
        .execute();
      expect(lines).toEqual(
        expect.arrayContaining([
          { kind: 'topic', marked_before: true, marked_after: false, changed_how: 'withdrawn' },
          { kind: 'homework', marked_before: true, marked_after: false, changed_how: 'withdrawn' },
        ]),
      );
      expect(lines.filter((one) => one.changed_how === 'withdrawn')).toHaveLength(2);
    });

    it('refuses "not given" on a homework marked "not held" or carried at its check lesson', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.first, { homeworks: ['Read', 'Write'] });
      await itemAt(s, s.second);
      const [read, write] = item.homeworks;
      if (read === undefined || write === undefined) throw new Error('Two homeworks.');
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(
          await calls.put(`/api/journal/lessons/${s.second}/works/not-held`, {
            column: { planWorkId: read, sourceLessonId: s.first },
            notHeld: true,
            version: null,
            confirm: false,
          }),
        );
        ok(
          await calls.post(`/api/journal/lessons/${s.second}/works/carry`, {
            column: { planWorkId: write, sourceLessonId: s.first },
            version: null,
          }),
        );
        for (const id of [read, write]) {
          const refused = await calls.put(`/api/journal/lessons/${s.first}/homework-given`, {
            planWorkIds: [id],
            notGiven: true,
          });
          expect(codeOf(refused)).toBe('homework_has_entries');
        }
      });
      const live = await t.database.migrator
        .selectFrom('journal_homework_not_given')
        .select('id')
        .where('lesson_id', '=', s.first)
        .execute();
      expect(live).toEqual([]);
    });

    it('refuses a plan save that removes a homework whose check lesson holds numbers', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.first, { homeworks: ['Read'] });
      await itemAt(s, s.second);
      const read = item.homeworks[0] ?? '';
      // The plan window of quarter 1 is open until 31 October.
      await sql`
        insert into lesson_plan_windows
          (branch_id, quarter_id, start_date, end_date, starts_at, ends_at, opened_at, opened_by)
        select q.branch_id, q.id, date '2026-09-01', date '2026-10-31',
          (date '2026-09-01')::timestamp at time zone b.time_zone,
          ((date '2026-11-01')::timestamp at time zone b.time_zone) - interval '1 millisecond',
          now(), (select a.id from accounts a order by a.id limit 1)
        from quarters q join branches b on b.id = q.branch_id
        where q.id = ${s.q1}
      `.execute(t.database.migrator);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(
          await calls.post(`/api/journal/lessons/${s.second}/attendance`, {
            saves: [{ studentId: s.student, mark: 1, version: null }],
          }),
        );
        const total = ok(
          await calls.put(`/api/journal/lessons/${s.second}/works/total`, {
            column: { planWorkId: read, sourceLessonId: s.first },
            total: 10,
            version: null,
            confirm: false,
          }),
        ) as { id: string };
        ok(
          await calls.post(`/api/journal/lessons/${s.second}/scores`, {
            saves: [
              { studentId: s.student, column: { workId: total.id }, score: 8, version: null },
            ],
          }),
        );
        const base = {
          topic: 'Fractions',
          objectives: 'Add fractions',
          links: ['https://example.org/fractions'],
          classworks: [],
          homeworks: [{ id: read, title: 'Read', description: 'About Read' }],
        };
        const removed = await calls.put(`/api/plans/items/${item.itemId}`, {
          base,
          values: { ...base, homeworks: [] },
        });
        expect(codeOf(removed)).toBe('plan_work_has_data');
      });
    });
  });

  describe('lesson status with the marks and the opening (code review)', () => {
    const statusIn = (grid: JournalGrid, lessonId: string) =>
      grid.lessons.find((one) => one.id === lessonId)?.status;

    const remindedOf = async (calls: Calls, lessonId: string) =>
      (
        remindersSchema.parse(ok(await calls.get('/api/journal/reminders'))).reminders as Reminder[]
      ).flatMap((one) =>
        one.kind !== 'rating_missing' && one.lesson.id === lessonId ? [one.kind] : [],
      );

    it('completes the check lesson of a homework not given, and the reminder of its numbers goes', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.first, { homeworks: ['Read'] });
      await itemAt(s, s.second);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(
          await calls.post(`/api/journal/lessons/${s.second}/attendance`, {
            saves: [{ studentId: s.student, mark: 1, version: null }],
          }),
        );
        expect(statusIn(await gridOf(calls, s.journal), s.second)).toBe('in_progress');
        expect(await remindedOf(calls, s.second)).toContain('numbers_missing');
        ok(
          await calls.put(`/api/journal/lessons/${s.first}/homework-given`, {
            planWorkIds: item.homeworks,
            notGiven: true,
          }),
        );
        expect(statusIn(await gridOf(calls, s.journal), s.second)).toBe('complete');
        expect(await remindedOf(calls, s.second)).not.toContain('numbers_missing');
      });
    });

    it('makes a locked lesson incomplete with a work its opening adds, and complete once it is graded', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.first);
      await as(
        owner,
        s.branch,
        teacherIn(s),
        async (calls) => {
          ok(
            await calls.post(`/api/journal/lessons/${s.first}/attendance`, {
              saves: [{ studentId: s.student, mark: 1, version: null }],
            }),
          );
        },
        '2026-10-12T12:00:00+05:00',
      );
      await setEditDays(t.database.migrator, s.branch, 7);
      await approvedRequest(s, owner.account.id, [s.first]);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        expect(statusIn(await gridOf(calls, s.journal), s.first)).toBe('complete');
        const base = {
          topic: 'Fractions',
          objectives: 'Add fractions',
          links: ['https://example.org/fractions'],
          classworks: [],
          homeworks: [],
        };
        const saved = ok(
          await calls.put(`/api/plans/items/${item.itemId}`, {
            base,
            values: { ...base, classworks: [{ title: 'Quiz', description: '' }] },
          }),
        ) as { classworks: { id: string }[] };
        const quiz = saved.classworks[0]?.id ?? '';
        expect(statusIn(await gridOf(calls, s.journal), s.first)).toBe('locked_incomplete');
        const total = ok(
          await calls.put(`/api/journal/lessons/${s.first}/works/total`, {
            column: { planWorkId: quiz, sourceLessonId: s.first },
            total: 10,
            version: null,
            confirm: false,
          }),
        ) as { id: string };
        expect(await remindedOf(calls, s.first)).toContain('numbers_missing');
        ok(
          await calls.post(`/api/journal/lessons/${s.first}/scores`, {
            saves: [
              { studentId: s.student, column: { workId: total.id }, score: 8, version: null },
            ],
          }),
        );
        expect(statusIn(await gridOf(calls, s.journal), s.first)).toBe('complete');
        expect(await remindedOf(calls, s.first)).not.toContain('numbers_missing');
      });
    });
  });

  describe('the opening of one class and the substitute (code review)', () => {
    it('opens no column of the other class of a shared plan whose request names one class', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id }, true);
      const planId = await planOf(s.journal, s.q1);
      const otherPlan = await planOf(s.otherJournal, s.q1);
      await t.database.migrator
        .updateTable('lesson_plan_journals')
        .set({ plan_id: planId })
        .where('plan_id', '=', otherPlan)
        .where('journal_id', '=', s.otherJournal)
        .execute();
      const item = await itemAt(s, s.first, {}, [
        { journal: s.journal, classId: s.classId, lesson: s.first },
        { journal: s.otherJournal, classId: s.otherClass, lesson: s.otherFirst },
      ]);
      await setEditDays(t.database.migrator, s.branch, 7);
      const requestId = await approvedRequest(s, owner.account.id, [s.first]);
      // The work the request added, opened for its one class, as the save writes them.
      const quiz = (
        await t.database.migrator
          .insertInto('lesson_plan_works')
          .values({
            branch_id: s.branch,
            item_id: item.itemId,
            kind: 'classwork',
            position: 1,
            title: 'Quiz',
            description: '',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      await t.database.migrator
        .insertInto('lesson_plan_work_openings')
        .values({ branch_id: s.branch, plan_work_id: quiz, request_id: requestId })
        .execute();
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const own = await calls.put(`/api/journal/lessons/${s.first}/works/total`, {
          column: { planWorkId: quiz, sourceLessonId: s.first },
          total: 10,
          version: null,
          confirm: false,
        });
        expect(own.status, JSON.stringify(own.body)).toBe(200);
        const theirs = await calls.put(`/api/journal/lessons/${s.otherFirst}/works/total`, {
          column: { planWorkId: quiz, sourceLessonId: s.otherFirst },
          total: 10,
          version: null,
          confirm: false,
        });
        expect(codeOf(theirs)).toBe('journal_locked');
      });
      // The guard of 0130 refuses it too, with the request named.
      const work = await t.database.migrator
        .insertInto('journal_works')
        .values({
          branch_id: s.branch,
          lesson_id: s.otherFirst,
          source_lesson_id: s.otherFirst,
          plan_work_id: quiz,
          kind: 'classwork',
          changed_by: owner.account.id,
          changed_how: 'entry',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      t.clock.set(MOMENT);
      try {
        const refused = await t.app
          .get(Transactions)
          .run([s.branch], async (transaction) => {
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
              .set({ total: 10, changed_by: owner.account.id, changed_how: 'entry' })
              .where('id', '=', work.id)
              .execute();
          })
          .then(
            () => null,
            (failure: unknown) => failure as { constraint?: string },
          );
        expect(refused?.constraint).toBe('journal_locked');
      } finally {
        t.clock.set(START);
      }
    });

    it('keeps the column a request opened before the lesson locked open after the lock, until its period ends', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.third);
      await setEditDays(t.database.migrator, s.branch, 7);
      const lock = (
        await sql<{ at: Date }>`select journal_lesson_lock(${s.third}::uuid) as at`.execute(
          t.database.migrator,
        )
      ).rows[0]?.at;
      if (lock === undefined) throw new Error('The lesson has a lock moment.');
      expect(lock.getTime()).toBeGreaterThan(new Date(MOMENT).getTime());
      const requestId = await approvedRequest(s, owner.account.id, [s.third]);
      // The period ends two days after the lesson locks.
      await t.database.migrator
        .updateTable('lesson_plan_requests')
        .set({ open_until: new Date(lock.getTime() + 2 * 86_400_000) })
        .where('id', '=', requestId)
        .execute();
      let quiz = '';
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const base = {
          topic: 'Fractions',
          objectives: 'Add fractions',
          links: ['https://example.org/fractions'],
          classworks: [],
          homeworks: [],
        };
        const saved = ok(
          await calls.put(`/api/plans/items/${item.itemId}`, {
            base,
            values: { ...base, classworks: [{ title: 'Quiz', description: '' }] },
          }),
        ) as { classworks: { id: string }[] };
        quiz = saved.classworks[0]?.id ?? '';
      });
      const opened = await t.database.migrator
        .selectFrom('lesson_plan_work_openings')
        .select('request_id')
        .where('plan_work_id', '=', quiz)
        .execute();
      expect(opened).toEqual([{ request_id: requestId }]);
      await as(
        owner,
        s.branch,
        teacherIn(s),
        async (calls) => {
          const graded = await calls.put(`/api/journal/lessons/${s.third}/works/total`, {
            column: { planWorkId: quiz, sourceLessonId: s.third },
            total: 10,
            version: null,
            confirm: false,
          });
          expect(graded.status, JSON.stringify(graded.body)).toBe(200);
        },
        new Date(lock.getTime() + 86_400_000).toISOString(),
      );
      const lines = await t.database.migrator
        .selectFrom('journal_work_history')
        .select(['changed_how', 'plan_request_id'])
        .where('lesson_id', '=', s.third)
        .where('total_after', '=', 10)
        .execute();
      expect(lines).toEqual([{ changed_how: 'late_entry', plan_request_id: requestId }]);
      // After the period, locked again.
      await as(
        owner,
        s.branch,
        teacherIn(s),
        async (calls) => {
          // The grid of November shows quarter 2: the stored work is read as stored.
          const work = await t.database.migrator
            .selectFrom('journal_works')
            .select(['id', 'version'])
            .where('lesson_id', '=', s.third)
            .where('plan_work_id', '=', quiz)
            .executeTakeFirstOrThrow();
          const late = await calls.put(`/api/journal/lessons/${s.third}/works/total`, {
            column: { workId: work.id },
            total: 12,
            version: work.version,
            confirm: false,
          });
          expect(codeOf(late)).toBe('journal_locked');
        },
        new Date(lock.getTime() + 3 * 86_400_000).toISOString(),
      );
    });

    it('lets the substitute of a locked lesson grade the opened column, and not the owner (decision 3)', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.second);
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
          .post(`/api/timetable/lessons/${s.second}/substitute`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, s.branch)
          .set(REQUEST_KEY_HEADER, randomUUID())
          .send({
            teacherId: substitute.staffId,
            reason: 'The teacher is at a seminar',
            confirm: true,
          }),
      );
      await setEditDays(t.database.migrator, s.branch, 7);
      await approvedRequest(s, owner.account.id, [s.second]);
      let quiz = '';
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const base = {
          topic: 'Fractions',
          objectives: 'Add fractions',
          links: ['https://example.org/fractions'],
          classworks: [],
          homeworks: [],
        };
        const saved = ok(
          await calls.put(`/api/plans/items/${item.itemId}`, {
            base,
            values: { ...base, classworks: [{ title: 'Quiz', description: '' }] },
          }),
        ) as { classworks: { id: string }[] };
        quiz = saved.classworks[0]?.id ?? '';
        const refused = await calls.put(`/api/journal/lessons/${s.second}/works/total`, {
          column: { planWorkId: quiz, sourceLessonId: s.second },
          total: 10,
          version: null,
          confirm: false,
        });
        expect(codeOf(refused)).toBe('journal_locked');
      });
      await as(sub, s.branch, teacherIn(s), async (calls) => {
        const graded = await calls.put(`/api/journal/lessons/${s.second}/works/total`, {
          column: { planWorkId: quiz, sourceLessonId: s.second },
          total: 10,
          version: null,
          confirm: false,
        });
        expect(graded.status, JSON.stringify(graded.body)).toBe(200);
      });
    });
  });

  describe('the guards of the marks in the database (code review)', () => {
    /** A write as the application at MOMENT; the constraint of its refusal, `null` when it passes. */
    const asApp = async (
      s: Scene,
      work: (transaction: Transaction) => Promise<unknown>,
    ): Promise<string | null> => {
      t.clock.set(MOMENT);
      try {
        return await t.app
          .get(Transactions)
          .run([s.branch], async (transaction) => {
            await transaction
              .insertInto('audit_log')
              .values({ occurred_at: new Date(MOMENT), branch_id: s.branch, action: 'test.marks' })
              .execute();
            await work(transaction);
          })
          .then(
            () => null,
            (failure: unknown) =>
              (failure as { constraint?: string }).constraint ?? String(failure),
          );
      } finally {
        t.clock.set(START);
      }
    };

    it('refuses after the lock the insert and undo of "not given" and the change of a delivery', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.first, { homeworks: ['Read', 'Write'] });
      const [read, write] = item.homeworks;
      if (read === undefined || write === undefined) throw new Error('Two homeworks.');
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(
          await calls.put(`/api/journal/lessons/${s.first}/delivery`, {
            notDelivered: true,
            version: null,
          }),
        );
        ok(
          await calls.put(`/api/journal/lessons/${s.first}/homework-given`, {
            planWorkIds: [read],
            notGiven: true,
          }),
        );
      });
      await setEditDays(t.database.migrator, s.branch, 7);
      expect(
        await asApp(s, (transaction) =>
          transaction
            .insertInto('journal_homework_not_given')
            .values({
              branch_id: s.branch,
              lesson_id: s.first,
              journal_id: s.journal,
              plan_work_id: write,
              changed_by: owner.account.id,
              changed_how: 'entry',
              set_at: new Date(MOMENT),
            })
            .execute(),
        ),
      ).toBe('journal_locked');
      expect(
        await asApp(s, (transaction) =>
          transaction
            .updateTable('journal_homework_not_given')
            .set({ undone_at: new Date(MOMENT), changed_by: owner.account.id, changed_how: 'undo' })
            .where('lesson_id', '=', s.first)
            .where('plan_work_id', '=', read)
            .execute(),
        ),
      ).toBe('journal_locked');
      expect(
        await asApp(s, (transaction) =>
          transaction
            .updateTable('journal_lesson_deliveries')
            .set({
              not_delivered: false,
              version: 2,
              changed_by: owner.account.id,
              changed_how: 'undo',
            })
            .where('lesson_id', '=', s.first)
            .execute(),
        ),
      ).toBe('journal_locked');
      // Through the routes too.
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const undo = await calls.put(`/api/journal/lessons/${s.first}/homework-given`, {
          planWorkIds: [read],
          notGiven: false,
        });
        expect(codeOf(undo)).toBe('journal_locked');
      });
    });

    it('lets the teacher mark under an approved unlock as a late entry naming it', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await itemAt(s, s.first);
      await setEditDays(t.database.migrator, s.branch, 7);
      const vice = await account();
      const unlock = await as(owner, s.branch, teacherIn(s), async (calls) => {
        const asked = ok(
          await calls.post(`/api/journal/lessons/${s.first}/unlocks`, {
            reason: 'I was ill that week',
          }),
          201,
        ) as { id: string; version: number };
        return asked;
      });
      await as(
        vice,
        s.branch,
        [{ role: 'academic_vice_principal', branchId: s.branch }],
        async (calls) => {
          ok(
            await calls.post(`/api/journal/unlocks/${unlock.id}/decide`, {
              decision: 'approve',
              days: 2,
              version: unlock.version,
            }),
          );
        },
      );
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(
          await calls.put(`/api/journal/lessons/${s.first}/delivery`, {
            notDelivered: true,
            version: null,
          }),
        );
      });
      const lines = await t.database.migrator
        .selectFrom('journal_delivery_history')
        .select(['changed_how', 'unlock_id'])
        .where('lesson_id', '=', s.first)
        .execute();
      expect(lines).toEqual([{ changed_how: 'late_entry', unlock_id: unlock.id }]);
    });

    it('refuses a correction, a version out of order on a change, a final "not given", a separation onto another item and "withdrawn" on a lesson not cancelled', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.first, { homeworks: ['Read', 'Write'] });
      const elsewhere = await itemAt(s, s.second, { homeworks: ['Draw'] });
      const [read, write] = item.homeworks;
      if (read === undefined || write === undefined) throw new Error('Two homeworks.');
      const vice = await account();
      await t.kit.giveRole(vice.account.id, {
        role: 'academic_vice_principal',
        branchId: s.branch,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
      const delivery =
        (values: { by?: string; how?: 'entry' | 'withdrawn' } = {}) =>
        (transaction: Transaction) =>
          transaction
            .insertInto('journal_lesson_deliveries')
            .values({
              branch_id: s.branch,
              lesson_id: s.first,
              journal_id: s.journal,
              item_id: item.itemId,
              not_delivered: true,
              changed_by: values.by ?? owner.account.id,
              changed_how: values.how ?? 'entry',
              changed_at: new Date(MOMENT),
            })
            .execute();
      // A correction: the mark is no value of a cell (decision 6), for a corrector too.
      expect(
        await asApp(s, async (transaction) => {
          await sql`select set_config('app.correction_reason', 'A typing mistake', true)`.execute(
            transaction,
          );
          await delivery({ by: vice.account.id })(transaction);
        }),
      ).toBe('journal_correction_role');
      expect(await asApp(s, delivery({ how: 'withdrawn' }))).toBe('journal_mark_withdrawn');
      expect(await asApp(s, delivery())).toBeNull();
      expect(
        await asApp(s, (transaction) =>
          transaction
            .updateTable('journal_lesson_deliveries')
            .set({ not_delivered: false, version: 1, changed_how: 'undo' })
            .where('lesson_id', '=', s.first)
            .execute(),
        ),
      ).toBe('journal_delivery_version');
      const notGiven = (planWorkId: string) => (transaction: Transaction) =>
        transaction
          .insertInto('journal_homework_not_given')
          .values({
            branch_id: s.branch,
            lesson_id: s.first,
            journal_id: s.journal,
            plan_work_id: planWorkId,
            changed_by: owner.account.id,
            changed_how: 'entry',
            set_at: new Date(MOMENT),
          })
          .execute();
      expect(await asApp(s, notGiven(read))).toBeNull();
      expect(await asApp(s, notGiven(write))).toBeNull();
      const undo = (planWorkId: string) => (transaction: Transaction) =>
        transaction
          .updateTable('journal_homework_not_given')
          .set({ undone_at: new Date(MOMENT), changed_how: 'undo' })
          .where('plan_work_id', '=', planWorkId)
          .execute();
      expect(await asApp(s, undo(read))).toBeNull();
      // An undone mark is final; a live one is ended only by an undo.
      expect(await asApp(s, undo(read))).toBe('journal_not_given_final');
      expect(
        await asApp(s, (transaction) =>
          transaction
            .updateTable('journal_homework_not_given')
            .set({ changed_how: 'entry' })
            .where('plan_work_id', '=', write)
            .execute(),
        ),
      ).toBe('journal_not_given_final');
      // A separation moves it only onto a work of the copy of its item.
      expect(
        await asApp(s, (transaction) =>
          transaction
            .updateTable('journal_homework_not_given')
            .set({ plan_work_id: elsewhere.homeworks[0] ?? '' })
            .where('plan_work_id', '=', write)
            .execute(),
        ),
      ).toBe('journal_not_given_final');
    });
  });
});
