import {
  REQUEST_KEY_HEADER,
  BRANCH_HEADER,
  attendanceSavedSchema,
  cellHistorySchema,
  journalGridSchema,
  lessonCardSchema,
  planItemFileSchema,
  planItemSchema,
  planListSchema,
  planSchema,
  scoresSavedSchema,
  workAddedSchema,
  workSavedSchema,
  type JournalGrid,
  type JournalLesson,
  type WorkColumn,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActingKit } from '../../testing/acting-kit.js';
import { CellsKit } from '../../testing/cells-kit.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { openPlanWindows } from '../../testing/plan-windows-kit.js';
import { publishedScene } from '../../testing/published-scene.js';
import { MemoryPhotoStore } from '../people/photo-store.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): string =>
  (response.body as { error?: { code?: string } }).error?.code ?? `status ${response.status}`;

const ok = (response: Response, status = 200): unknown => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response.body;
};

// All names are invented. Task 8.1, pull request #217: classwork and homework in the
// journal (docs/spec/07-journal.md, Entering data, The total; docs/spec/09-lesson-plans.md,
// In the journal; docs/spec/edge-cases/journal.md, Entering; edge-cases/lesson-plans.md,
// Plans and the journal).
describe('classwork and homework', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Dilnoza', `Karimova${'a'.repeat(names % 7)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };
  interface Calls {
    get: (path: string) => Promise<Response>;
    post: (path: string, body?: object) => Promise<Response>;
    put: (path: string, body: object) => Promise<Response>;
    del: (path: string) => Promise<Response>;
    /** A post with the request key given (task 10.3b: a repeat of a used key). */
    keyed: (path: string, body: object, key: string) => Promise<Response>;
    /** Task 10.8: a file sent as its bytes (the plan's file routes). */
    upload: (path: string, type: string, bytes: Buffer) => Promise<Response>;
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
      const at = (method: 'get' | 'post' | 'put' | 'delete', path: string) =>
        request(t.kit.server)
          [method](path)
          .set('Cookie', browser.cookie)
          .set(BRANCH_HEADER, branch);
      return await work({
        get: (path) => at('get', path),
        post: (path, body = {}) =>
          at('post', path).set(REQUEST_KEY_HEADER, randomUUID()).send(body),
        put: (path, body) => at('put', path).send(body),
        del: (path) => at('delete', path),
        keyed: (path, body, key) => at('post', path).set(REQUEST_KEY_HEADER, key).send(body),
        upload: (path, type, bytes) => at('put', path).set('Content-Type', type).send(bytes),
      });
    } finally {
      t.clock.set(START);
    }
  }

  /**
   * Task 10.8: a work added by hand before 7 November 2026, as the add of 8.1 to 10.7 wrote it (a
   * journal row with no plan work, stored where it is given, at the next free place of its kind),
   * written as the migrator: since 10.8 the add writes a plan work (`edge/journal`, "Works added
   * by hand before 7 November 2026 are not in the plan").
   */
  const byHand = async (
    branchId: string,
    lessonId: string,
    kind: 'classwork' | 'homework',
    title: string | null = 'Dictation',
  ): Promise<{ id: string; version: number }> => {
    const taken = await t.database.migrator
      .selectFrom('journal_works')
      .select('position')
      .where('source_lesson_id', '=', lessonId)
      .where('kind', '=', kind)
      .where('plan_work_id', 'is', null)
      .execute();
    const used = new Set(taken.map((one) => one.position));
    let position = 1;
    while (used.has(position)) position += 1;
    return t.database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${MOMENT}, true)`.execute(transaction);
      return transaction
        .insertInto('journal_works')
        .values({
          branch_id: branchId,
          lesson_id: lessonId,
          source_lesson_id: lessonId,
          kind,
          position,
          title,
          changed_how: 'entry',
        })
        .returning(['id', 'version'])
        .executeTakeFirstOrThrow();
    });
  };

  /** A student of the class from `from`. */
  const student = async (
    branch: string,
    classId: string,
    last: string,
    from = '2026-09-01',
  ): Promise<string> => {
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const id = await members.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: 'Ali', last_name: last })
      .where('id', '=', id)
      .execute();
    await members.member({ branch, classId, studentId: id, from });
    return id;
  };

  const journalOf = async (classId: string) =>
    (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', classId)
        .executeTakeFirstOrThrow()
    ).id;

  /**
   * The graded scene of 6.2: maths of 7th grade on the Mondays of the year at 08:00,
   * owned by the scene's teacher. `first`, `second`, `third` are 12, 19, 26 October
   * (held at MOMENT), `fourth` 9 November, the first lesson of quarter 2.
   */
  async function scene(accounts: { teacher?: string; spare?: string } = {}, shared = false) {
    const s = await publishedScene(t, load, { graded: true, accounts, shared });
    const lessons = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('lesson_date', '>=', '2026-10-12')
        .orderBy('starts_at')
        .execute()
    ).map((row) => row.id);
    const [first, second, third, fourth] = lessons;
    if (
      first === undefined ||
      second === undefined ||
      third === undefined ||
      fourth === undefined
    ) {
      throw new Error('The scene has lessons from 12 October on.');
    }
    const quarters = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', s.year)
        .orderBy('number')
        .execute()
    ).map((one) => one.id);
    return {
      ...s,
      first,
      second,
      third,
      fourth,
      journal: await journalOf(s.classId),
      q1: quarters[0] ?? '',
      q2: quarters[1] ?? '',
      ahmedov: await student(s.branch, s.classId, 'Ahmedov'),
      boboyev: await student(s.branch, s.classId, 'Boboyev'),
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /** The row of a lesson in its quarter: its place among the quarter's lessons not cancelled. */
  const rowOf = async (s: Scene, lessonId: string): Promise<number> => {
    const rows = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('lesson_date', '>=', '2026-09-01')
        .where('lesson_date', '<=', '2026-10-31')
        .where('cancel_cause', 'is', null)
        .orderBy('starts_at')
        .execute()
    ).map((row) => row.id);
    return rows.indexOf(lessonId) + 1;
  };

  /**
   * A plan item of quarter 1 at the row of `lessonId`, with its works, written as
   * the migrator (the plan routes are 7.1a's; this file tests the journal).
   */
  async function itemAt(
    s: Scene,
    lessonId: string,
    works: { classworks?: string[]; homeworks?: string[] } = {},
  ): Promise<{ itemId: string; classworks: string[]; homeworks: string[] }> {
    const plan = await t.database.migrator
      .selectFrom('lesson_plan_journals')
      .select('plan_id')
      .where('journal_id', '=', s.journal)
      .where('quarter_id', '=', s.q1)
      .executeTakeFirstOrThrow();
    const item = await t.database.migrator
      .insertInto('lesson_plan_items')
      .values({ branch_id: s.branch, plan_id: plan.plan_id, topic: 'Fractions' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = { itemId: item.id, classworks: [] as string[], homeworks: [] as string[] };
    for (const kind of ['classwork', 'homework'] as const) {
      const titles = (kind === 'classwork' ? works.classworks : works.homeworks) ?? [];
      for (const [index, title] of titles.entries()) {
        const work = await t.database.migrator
          .insertInto('lesson_plan_works')
          .values({ branch_id: s.branch, item_id: item.id, kind, position: index + 1, title })
          .returning('id')
          .executeTakeFirstOrThrow();
        made[kind === 'classwork' ? 'classworks' : 'homeworks'].push(work.id);
      }
    }
    await t.database.migrator
      .insertInto('lesson_plan_places')
      .values({
        branch_id: s.branch,
        plan_id: plan.plan_id,
        journal_id: s.journal,
        item_id: item.id,
        position: await rowOf(s, lessonId),
      })
      .execute();
    return made;
  }

  const gridOf = async (calls: Calls, s: Scene, quarter?: string): Promise<JournalGrid> =>
    journalGridSchema.parse(
      ok(
        await calls.get(
          `/api/journal/journals/${s.journal}${quarter === undefined ? '' : `?quarterId=${quarter}`}`,
        ),
      ),
    );

  const lessonIn = (grid: JournalGrid, id: string): JournalLesson => {
    const found = grid.lessons.find((one) => one.id === id);
    if (found === undefined) throw new Error('The grid shows the lesson.');
    return found;
  };

  const planned = (planWorkId: string, sourceLessonId: string): WorkColumn => ({
    planWorkId,
    sourceLessonId,
  });

  const teacherIn = (s: Scene) => [{ role: 'teacher' as const, branchId: s.branch }];

  /**
   * Every row the works routes write in a branch: works, cells and both histories; task 10.8 (plan
   * review 8): the plans, items, places and works the add, rename and remove of a work added in
   * the journal write, and the files its remove takes off.
   */
  const rowsOf = (branch: string) =>
    Promise.all(
      (
        [
          'journal_works',
          'journal_cells',
          'journal_cell_history',
          'journal_work_history',
          'lesson_plans',
          'lesson_plan_journals',
          'lesson_plan_items',
          'lesson_plan_places',
          'lesson_plan_works',
          'lesson_plan_files',
        ] as const
      ).map(async (table) =>
        // Some of the plan's tables have no id: the rows in the order of their text.
        (
          await t.database.migrator
            .selectFrom(table)
            .selectAll()
            .where('branch_id', '=', branch)
            .execute()
        )
          .map((row) => JSON.stringify(row))
          .sort(),
      ),
    );

  const journalEntries = async () =>
    Number(
      (
        await t.database.migrator
          .selectFrom('audit_log')
          .select((select) => select.fn.countAll().as('count'))
          .where('action', 'like', 'journal.%')
          .executeTakeFirstOrThrow()
      ).count,
    );

  /** Task 10.3b: every audit entry but those of the roles a test gives. */
  const entriesBesidesRoles = async () =>
    (
      await t.database.migrator
        .selectFrom('audit_log')
        .select('id')
        .where('action', '<>', 'assignment.given')
        .execute()
    )
      .map((row) => row.id)
      .sort();

  beforeAll(async () => {
    // Task 10.8: a file store for the files of a work.
    t = await dayTemplatesKit({ jobs: true, photoStore: new MemoryPhotoStore() });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the columns', () => {
    it('gives the first lesson no homework column and the next one the homework given at it (the Done when)', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      // The version is published from 12 October: the first lesson of the journal.
      await itemAt(s, s.first, {
        classworks: ['Test', 'Quiz'],
        homeworks: ['Read', 'Write', 'Draw'],
      });
      await itemAt(s, s.second);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const grid = await gridOf(calls, s);
        const kinds = (lesson: JournalLesson) =>
          lesson.works.map((one) => [one.kind, one.title, one.position]);
        expect(grid.lessons[0]?.id).toBe(s.first);
        expect(kinds(lessonIn(grid, s.first))).toEqual([
          ['classwork', 'Test', 1],
          ['classwork', 'Quiz', 2],
        ]);
        // Three homeworks given on the 12th, checked on the 19th; no classwork there.
        expect(kinds(lessonIn(grid, s.second))).toEqual([
          ['homework', 'Read', 1],
          ['homework', 'Write', 2],
          ['homework', 'Draw', 3],
        ]);
        expect(lessonIn(grid, s.second).planItem).toBe(true);
        // The 19th gave none: the 26th has no homework column, and no plan item ("No plan").
        expect(lessonIn(grid, s.third).works).toEqual([]);
        expect(lessonIn(grid, s.third).planItem).toBe(false);
        expect(lessonIn(grid, s.first).given.map((one) => [one.title, one.checkAt])).toEqual([
          ['Read', s.second],
          ['Write', s.second],
          ['Draw', s.second],
        ]);
        expect(lessonIn(grid, s.first).canEnterWorks).toBe(true);
      });
    });

    it('shows the homework of the last lesson of a quarter at the first lesson of the next', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await itemAt(s, s.third, { homeworks: ['Holiday reading'] });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const quarters = await t.database.migrator
          .selectFrom('quarters')
          .select('id')
          .where('academic_year_id', '=', s.year)
          .where('number', '=', 2)
          .executeTakeFirstOrThrow();
        const grid = await gridOf(calls, s, quarters.id);
        expect(lessonIn(grid, s.fourth).works.map((one) => one.title)).toEqual(['Holiday reading']);
        // Future: shown, not enterable (09: "Nothing can be entered in them").
        expect(lessonIn(grid, s.fourth).canEnterWorks).toBe(false);
      });
    });
  });

  describe('the total and the numbers', () => {
    it('sets a total on a planned column, types numbers and shows the percent from packages/calc', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.first, { classworks: ['Test'] });
      const column = planned(item.classworks[0] ?? '', s.first);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const early = await calls.post(`/api/journal/lessons/${s.first}/scores`, {
          saves: [{ studentId: s.ahmedov, column, score: 12, version: null }],
        });
        expect(codeOf(early)).toBe('work_total_missing');
        const total = workSavedSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${s.first}/works/total`, {
              column,
              total: 30,
              version: null,
            }),
          ),
        );
        expect(total).toMatchObject({ kind: 'classwork', total: 30, notHeld: false, version: 2 });
        const typed = scoresSavedSchema.parse(
          ok(
            await calls.post(`/api/journal/lessons/${s.first}/scores`, {
              saves: [
                { studentId: s.ahmedov, column: { workId: total.id }, score: 12, version: null },
                { studentId: s.boboyev, column: { workId: total.id }, score: 13, version: null },
              ],
            }),
          ),
        );
        expect(typed.cells.map((one) => [one.score, one.percent])).toEqual([
          [12, 40],
          [13, 43],
        ]);
        const above = await calls.post(`/api/journal/lessons/${s.first}/scores`, {
          saves: [{ studentId: s.ahmedov, column: { workId: total.id }, score: 31, version: 1 }],
        });
        expect(codeOf(above)).toBe('score_above_total');
        const grid = await gridOf(calls, s);
        const work = lessonIn(grid, s.first).works[0];
        expect(work).toMatchObject({ id: total.id, title: 'Test', total: 30, unplanned: false });
        const ahmedov = grid.students.find((one) => one.id === s.ahmedov);
        const at = grid.lessons.findIndex((one) => one.id === s.first);
        expect(ahmedov?.cells[at]?.works).toEqual([
          { score: 12, percent: 40, version: 1, onAbsent: false, marker: null, notGraded: false },
        ]);
        expect(grid.lastTotal).toBe(30);
      });
      const lines = await t.database.migrator
        .selectFrom('journal_work_history')
        .select(['total_before', 'total_after', 'changed_by', 'changed_how'])
        .where('lesson_id', '=', s.first)
        .execute();
      expect(lines).toEqual([
        { total_before: null, total_after: 30, changed_by: owner.account.id, changed_how: 'entry' },
      ]);
      expect((await t.entries('journal.work_total', s.first)).length).toBe(1);
    });

    it('refuses a total below a number with the students listed, and asks to confirm a change with numbers', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.first, { classworks: ['Test'] });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const work = workSavedSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${s.first}/works/total`, {
              column: planned(item.classworks[0] ?? '', s.first),
              total: 30,
              version: null,
            }),
          ),
        );
        ok(
          await calls.post(`/api/journal/lessons/${s.first}/scores`, {
            saves: [
              { studentId: s.ahmedov, column: { workId: work.id }, score: 12, version: null },
              { studentId: s.boboyev, column: { workId: work.id }, score: 25, version: null },
            ],
          }),
        );
        const below = await calls.put(`/api/journal/lessons/${s.first}/works/total`, {
          column: { workId: work.id },
          total: 20,
          version: work.version,
          confirm: true,
        });
        expect(codeOf(below)).toBe('total_below_numbers');
        const listed = (below.body as { error: { details: { recordId: string }[] } }).error.details;
        expect(listed.map((one) => one.recordId)).toEqual([s.boboyev]);
        const ask = await calls.put(`/api/journal/lessons/${s.first}/works/total`, {
          column: { workId: work.id },
          total: 100,
          version: work.version,
        });
        expect(codeOf(ask)).toBe('total_confirm');
        const figures = (
          ask.body as {
            error: { details: { recordId: string; workScore: Record<string, number> }[] };
          }
        ).error.details;
        expect(figures.find((one) => one.recordId === s.ahmedov)?.workScore).toEqual({
          score: 12,
          percentBefore: 40,
          percentAfter: 12,
        });
        const stale = await calls.put(`/api/journal/lessons/${s.first}/works/total`, {
          column: { workId: work.id },
          total: 100,
          version: 1,
          confirm: true,
        });
        expect(codeOf(stale)).toBe('work_stale');
        const confirmed = workSavedSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${s.first}/works/total`, {
              column: { workId: work.id },
              total: 100,
              version: work.version,
              confirm: true,
            }),
          ),
        );
        expect(confirmed.total).toBe(100);
        for (const total of [0, 1001, 2.5]) {
          const refused = await calls.put(`/api/journal/lessons/${s.first}/works/total`, {
            column: { workId: work.id },
            total,
            version: confirmed.version,
          });
          expect(codeOf(refused)).toBe('validation_failed');
        }
      });
    });

    it('marks a work "not held" after numbers with the count, takes it out of the columns, refuses numbers on it and restores it on undo', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.first, { classworks: ['Test', 'Quiz'] });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const work = workSavedSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${s.first}/works/total`, {
              column: planned(item.classworks[0] ?? '', s.first),
              total: 10,
              version: null,
            }),
          ),
        );
        ok(
          await calls.post(`/api/journal/lessons/${s.first}/scores`, {
            saves: [
              { studentId: s.ahmedov, column: { workId: work.id }, score: 7, version: null },
              { studentId: s.boboyev, column: { workId: work.id }, score: 9, version: null },
            ],
          }),
        );
        const ask = await calls.put(`/api/journal/lessons/${s.first}/works/not-held`, {
          column: { workId: work.id },
          notHeld: true,
          version: work.version,
        });
        expect(codeOf(ask)).toBe('not_held_confirm');
        expect(
          (ask.body as { error: { details: { count: number }[] } }).error.details[0]?.count,
        ).toBe(2);
        const marked = workSavedSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${s.first}/works/not-held`, {
              column: { workId: work.id },
              notHeld: true,
              version: work.version,
              confirm: true,
            }),
          ),
        );
        const grid = await gridOf(calls, s);
        expect(lessonIn(grid, s.first).works.map((one) => one.title)).toEqual(['Quiz']);
        expect(lessonIn(grid, s.first).notHeldWorks.map((one) => one.id)).toEqual([work.id]);
        const typed = await calls.post(`/api/journal/lessons/${s.first}/scores`, {
          saves: [{ studentId: s.ahmedov, column: { workId: work.id }, score: 8, version: 1 }],
        });
        expect(codeOf(typed)).toBe('work_not_held');
        ok(
          await calls.put(`/api/journal/lessons/${s.first}/works/not-held`, {
            column: { workId: work.id },
            notHeld: false,
            version: marked.version,
          }),
        );
        const back = await gridOf(calls, s);
        expect(lessonIn(back, s.first).works.map((one) => [one.title, one.total])).toEqual([
          ['Test', 10],
          ['Quiz', null],
        ]);
        const at = back.lessons.findIndex((one) => one.id === s.first);
        expect(back.students.find((one) => one.id === s.boboyev)?.cells[at]?.works[0]?.score).toBe(
          9,
        );
      });
    });

    it('accepts and counts a number typed while attendance is empty and on an absent student, flagged', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.first, { classworks: ['Test'] });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const work = workSavedSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${s.first}/works/total`, {
              column: planned(item.classworks[0] ?? '', s.first),
              total: 10,
              version: null,
            }),
          ),
        );
        ok(
          await calls.post(`/api/journal/lessons/${s.first}/attendance`, {
            saves: [{ studentId: s.boboyev, mark: 0, version: null }],
          }),
        );
        ok(
          await calls.post(`/api/journal/lessons/${s.first}/scores`, {
            saves: [
              { studentId: s.ahmedov, column: { workId: work.id }, score: 5, version: null },
              { studentId: s.boboyev, column: { workId: work.id }, score: 6, version: null },
            ],
          }),
        );
        const grid = await gridOf(calls, s);
        const at = grid.lessons.findIndex((one) => one.id === s.first);
        const cellOf = (id: string) => grid.students.find((one) => one.id === id)?.cells[at];
        expect(cellOf(s.ahmedov)?.works[0]).toMatchObject({ score: 5, onAbsent: false });
        expect(cellOf(s.boboyev)?.works[0]).toMatchObject({ score: 6, onAbsent: true });
        // Counted: the lesson score of Ahmedov has a classwork part (no mark: 50 · 40 of 40).
        expect(cellOf(s.ahmedov)?.score).toBe(50);
      });
    });

    it('accepts a homework number for a student who joined after the homework was given', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const late = await student(s.branch, s.classId, 'Davronov', '2026-10-15');
      const item = await itemAt(s, s.first, { homeworks: ['Read'] });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const column = planned(item.homeworks[0] ?? '', s.first);
        const work = workSavedSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${s.second}/works/total`, {
              column,
              total: 5,
              version: null,
            }),
          ),
        );
        const saved = scoresSavedSchema.parse(
          ok(
            await calls.post(`/api/journal/lessons/${s.second}/scores`, {
              saves: [{ studentId: late, column: { workId: work.id }, score: 5, version: null }],
            }),
          ),
        );
        expect(saved.cells).toEqual([
          { studentId: late, workId: work.id, score: 5, percent: 100, version: 1 },
        ]);
        // On the 12th the column is not the homework's (it is checked on the 19th).
        const wrong = await calls.put(`/api/journal/lessons/${s.first}/works/total`, {
          column,
          total: 5,
          version: null,
        });
        expect(codeOf(wrong)).toBe('work_not_in_lesson');
      });
    });
  });

  describe('works added by hand', () => {
    it('adds classworks and "homework given" at a lesson with no plan item into the plan, at most 10 of each, and refuses one with an item', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await itemAt(s, s.first, { classworks: ['Test'] });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const refused = await calls.post(`/api/journal/lessons/${s.first}/works`, {
          kind: 'classwork',
          title: 'Dictation',
        });
        expect(codeOf(refused)).toBe('lesson_has_plan_item');
        const added: string[] = [];
        for (let index = 0; index < 10; index += 1) {
          added.push(
            workAddedSchema.parse(
              ok(
                await calls.post(`/api/journal/lessons/${s.second}/works`, {
                  kind: 'classwork',
                  title: `Dictation ${String(index + 1)}`,
                }),
              ),
            ).planWorkId,
          );
        }
        const eleventh = await calls.post(`/api/journal/lessons/${s.second}/works`, {
          kind: 'classwork',
          title: 'Dictation',
        });
        expect(codeOf(eleventh)).toBe('journal_works_limit');
        const homework = workAddedSchema.parse(
          ok(
            await calls.post(`/api/journal/lessons/${s.second}/works`, {
              kind: 'homework',
              title: 'Exercises',
            }),
          ),
        );
        const grid = await gridOf(calls, s);
        // Task 10.8: planned columns of the item the add wrote, with the plan's titles.
        expect(
          lessonIn(grid, s.second).works.map((one) => [one.planWorkId, one.unplanned, one.title]),
        ).toEqual(added.map((id, index) => [id, false, `Dictation ${String(index + 1)}`]));
        // The lesson still has no plan item: no topic yet ("No plan").
        expect(lessonIn(grid, s.second).planItem).toBe(false);
        // The homework given on the 19th is a column of the 26th.
        expect(lessonIn(grid, s.third).works.map((one) => one.planWorkId)).toEqual([
          homework.planWorkId,
        ]);
        // An empty one is removed; one with a total is not.
        ok(await calls.del(`/api/journal/lessons/${s.second}/plan-works/${added[9] ?? ''}`), 204);
        ok(
          await calls.put(`/api/journal/lessons/${s.second}/works/total`, {
            column: planned(added[0] ?? '', s.second),
            total: 5,
            version: null,
          }),
        );
        const kept = await calls.del(
          `/api/journal/lessons/${s.second}/plan-works/${added[0] ?? ''}`,
        );
        expect(codeOf(kept)).toBe('work_holds_data');
      });
      expect((await t.entries('journal.work_add', s.second)).length).toBe(11);
      expect((await t.entries('journal.work_delete', s.second)).length).toBe(1);
    });

    // Code review round 1, finding 1: the homework is a column of its check lesson.
    it('removes an empty homework given by hand from the lesson that shows it', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const given = await byHand(s.branch, s.second, 'homework', 'Exercises');
        ok(await calls.del(`/api/journal/lessons/${s.third}/works/${given.id}`), 204);
        const grid = await gridOf(calls, s);
        expect(lessonIn(grid, s.third).works).toEqual([]);
        expect(lessonIn(grid, s.second).given).toEqual([]);
      });
      expect((await t.entries('journal.work_delete', s.third)).length).toBe(1);
    });

    it('moves a homework given by hand to its check lesson at the first write there', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const homework = await as(owner, s.branch, teacherIn(s), async (calls) => {
        const given = await byHand(s.branch, s.second, 'homework', 'Exercises');
        ok(
          await calls.put(`/api/journal/lessons/${s.third}/works/total`, {
            column: { workId: given.id },
            total: 5,
            version: given.version,
          }),
        );
        return given;
      });
      const row = await t.database.migrator
        .selectFrom('journal_works')
        .select(['lesson_id', 'source_lesson_id', 'total'])
        .where('id', '=', homework.id)
        .executeTakeFirstOrThrow();
      // Stored where it was given (decision 18), moved at the first write at its check lesson.
      expect(row).toEqual({ lesson_id: s.third, source_lesson_id: s.second, total: 5 });
      const lines = await t.database.migrator
        .selectFrom('journal_work_history')
        .select(['changed_how', 'lesson_before', 'total_after'])
        .where('work_id', '=', homework.id)
        .orderBy('version')
        .execute();
      expect(lines).toEqual([
        { changed_how: 'move', lesson_before: s.second, total_after: null },
        { changed_how: 'entry', lesson_before: null, total_after: 5 },
      ]);
    });
  });

  describe('homework at its check lesson', () => {
    it('carries a homework to the next lesson once, and moves one whose check lesson is cancelled with its total', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.first, { homeworks: ['Read', 'Write'] });
      await itemAt(s, s.second, { homeworks: ['Draw'] });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const read = planned(item.homeworks[0] ?? '', s.first);
        const carried = workSavedSchema.parse(
          ok(
            await calls.post(`/api/journal/lessons/${s.second}/works/carry`, {
              column: read,
              version: null,
            }),
          ),
        );
        expect(carried.carriedFrom).toBe(s.second);
        const grid = await gridOf(calls, s);
        expect(lessonIn(grid, s.second).works.map((one) => one.title)).toEqual(['Write']);
        expect(lessonIn(grid, s.third).works.map((one) => [one.title, one.carriedFrom])).toEqual([
          ['Draw', null],
          ['Read', s.second],
        ]);
        const again = await calls.post(`/api/journal/lessons/${s.third}/works/carry`, {
          column: { workId: carried.id },
          version: carried.version,
        });
        expect(codeOf(again)).toBe('work_carried');
        // "Write" gets a total on the 19th; then the 19th is cancelled.
        ok(
          await calls.put(`/api/journal/lessons/${s.second}/works/total`, {
            column: planned(item.homeworks[1] ?? '', s.first),
            total: 4,
            version: null,
          }),
        );
      });
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'reason', cancel_reason: 'School trip' })
        .where('id', '=', s.second)
        .execute();
      await as(owner, s.branch, [], async (calls) => {
        const grid = await gridOf(calls, s);
        const write = lessonIn(grid, s.third).works.find((one) => one.title === 'Write');
        expect(write?.total).toBe(4);
        ok(
          await calls.post(`/api/journal/lessons/${s.third}/scores`, {
            saves: [
              {
                studentId: s.ahmedov,
                column: { workId: write?.id ?? '' },
                score: 3,
                version: null,
              },
            ],
          }),
        );
      });
      const moved = await t.database.migrator
        .selectFrom('journal_works')
        .select('lesson_id')
        .where('total', '=', 4)
        .executeTakeFirstOrThrow();
      expect(moved.lesson_id).toBe(s.third);
    });
  });

  describe('the carry and the end of the journal (code review, must-fixes 1 and 2)', () => {
    it('refuses a carry with numbers and one with no lesson left to check it, and keeps the homework', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.first, { homeworks: ['Read', 'Write'] });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const read = workSavedSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${s.second}/works/total`, {
              column: planned(item.homeworks[0] ?? '', s.first),
              total: 5,
              version: null,
            }),
          ),
        );
        ok(
          await calls.post(`/api/journal/lessons/${s.second}/scores`, {
            saves: [{ studentId: s.ahmedov, column: { workId: read.id }, score: 4, version: null }],
          }),
        );
        const scored = await calls.post(`/api/journal/lessons/${s.second}/works/carry`, {
          column: { workId: read.id },
          version: read.version,
        });
        expect(codeOf(scored)).toBe('work_holds_numbers');
      });
      // Every lesson after the 19th is cancelled: none is left to check "Write".
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'reason', cancel_reason: 'Quarantine' })
        .where('class_id', '=', s.classId)
        .where('lesson_date', '>', '2026-10-19')
        .execute();
      await as(owner, s.branch, [], async (calls) => {
        const write = planned(item.homeworks[1] ?? '', s.first);
        const totalled = workSavedSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${s.second}/works/total`, {
              column: write,
              total: 3,
              version: null,
            }),
          ),
        );
        const refused = await calls.post(`/api/journal/lessons/${s.second}/works/carry`, {
          column: { workId: totalled.id },
          version: totalled.version,
        });
        expect(codeOf(refused)).toBe('no_next_lesson');
        const grid = await gridOf(calls, s);
        expect(lessonIn(grid, s.second).works.map((one) => [one.title, one.total])).toEqual([
          ['Read', 5],
          ['Write', 3],
        ]);
      });
    });

    it('labels the homework of the last lesson "will not be graded", and of a closed journal "not checked, group closed"', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await itemAt(s, s.third, { homeworks: ['Revise'] });
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'reason', cancel_reason: 'Quarantine' })
        .where('class_id', '=', s.classId)
        .where('lesson_date', '>', '2026-10-26')
        .execute();
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const grid = await gridOf(calls, s);
        expect(lessonIn(grid, s.third).given).toEqual([
          { title: 'Revise', checkAt: null, ungraded: 'year_end', notGiven: false },
        ]);
      });
      // The journal runs no day after the 26th (7.1b decision 9).
      await t.database.migrator
        .updateTable('journals')
        .set({ runs: '{[2026-09-01,2026-10-27)}' })
        .where('id', '=', s.journal)
        .execute();
      await as(owner, s.branch, [], async (calls) => {
        const grid = await gridOf(calls, s);
        expect(lessonIn(grid, s.third).given[0]?.ungraded).toBe('group_closed');
      });
    });

    it('keeps a homework given by hand when its future check lesson is removed by a version change', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      // Task 10.8: a homework added by hand before 7 November 2026.
      const given = await byHand(s.branch, s.third, 'homework', 'Exercises');
      // The 9 November lesson goes as a version change removes a lesson with no data.
      await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`select set_config('app.now', ${MOMENT}, true)`.execute(transaction);
        await transaction.deleteFrom('lessons').where('id', '=', s.fourth).execute();
      });
      const row = await t.database.migrator
        .selectFrom('journal_works')
        .select(['lesson_id', 'source_lesson_id'])
        .where('id', '=', given.id)
        .executeTakeFirst();
      expect(row).toEqual({ lesson_id: s.third, source_lesson_id: s.third });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const grid = await gridOf(calls, s);
        expect(lessonIn(grid, s.third).given.map((one) => one.checkAt)).not.toContain(s.fourth);
        expect(lessonIn(grid, s.third).given).toHaveLength(1);
      });
    });
  });

  describe('keep or clear (From 6.3, decision 14)', () => {
    it('asks keep or clear when present becomes absent with numbers, keeps or clears them, and refuses the field elsewhere', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.first, { classworks: ['Test'] });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const marks = attendanceSavedSchema.parse(
          ok(
            await calls.post(`/api/journal/lessons/${s.first}/attendance`, {
              saves: [
                { studentId: s.ahmedov, mark: 1, version: null },
                { studentId: s.boboyev, mark: 2, version: null },
              ],
            }),
          ),
        );
        const work = workSavedSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${s.first}/works/total`, {
              column: planned(item.classworks[0] ?? '', s.first),
              total: 10,
              version: null,
            }),
          ),
        );
        ok(
          await calls.post(`/api/journal/lessons/${s.first}/scores`, {
            saves: [
              { studentId: s.ahmedov, column: { workId: work.id }, score: 7, version: null },
              { studentId: s.boboyev, column: { workId: work.id }, score: 8, version: null },
            ],
          }),
        );
        const version = (id: string) =>
          marks.cells.find((one) => one.studentId === id)?.version ?? 0;
        const asked = await calls.post(`/api/journal/lessons/${s.first}/attendance`, {
          saves: [{ studentId: s.ahmedov, mark: 0, version: version(s.ahmedov) }],
        });
        expect(codeOf(asked)).toBe('numbers_keep_or_clear');
        ok(
          await calls.post(`/api/journal/lessons/${s.first}/attendance`, {
            saves: [
              { studentId: s.ahmedov, mark: 0, version: version(s.ahmedov), numbers: 'keep' },
              { studentId: s.boboyev, mark: 3, version: version(s.boboyev), numbers: 'clear' },
            ],
          }),
        );
        const grid = await gridOf(calls, s);
        const at = grid.lessons.findIndex((one) => one.id === s.first);
        const scoreOf = (id: string) =>
          grid.students.find((one) => one.id === id)?.cells[at]?.works[0]?.score;
        expect(scoreOf(s.ahmedov)).toBe(7);
        expect(scoreOf(s.boboyev)).toBeNull();
        const stray = await calls.post(`/api/journal/lessons/${s.first}/attendance`, {
          saves: [
            { studentId: s.ahmedov, mark: 1, version: version(s.ahmedov) + 1, numbers: 'keep' },
          ],
        });
        expect(codeOf(stray)).toBe('validation_failed');
        const history = cellHistorySchema.parse(
          ok(await calls.get(`/api/journal/lessons/${s.first}/students/${s.boboyev}/history`)),
        );
        expect(
          history.lines.filter((one) => one.work !== null).map((one) => [one.before, one.after]),
        ).toEqual([
          [null, 8],
          [8, null],
        ]);
        expect(history.workLines.map((one) => [one.totalBefore, one.totalAfter])).toEqual([
          [null, 10],
        ]);
      });
    });
  });

  describe('who enters and what is refused', () => {
    it('refuses another teacher, an attendance-only subject, another branch’s ids and unknown ones, leaving every row and the audit log as they were', async () => {
      const owner = await account();
      const other = await account();
      const s = await scene({ teacher: owner.account.id, spare: other.account.id });
      const elsewhere = await scene();
      const item = await itemAt(s, s.first, { classworks: ['Test'] });
      const foreign = await itemAt(elsewhere, elsewhere.first, { classworks: ['Test'] });
      const foreignWork = await t.database.migrator
        .insertInto('journal_works')
        .values({
          branch_id: elsewhere.branch,
          lesson_id: elsewhere.second,
          source_lesson_id: elsewhere.second,
          kind: 'classwork',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      // An empty work added by hand of the own branch, for the refusals of its delete.
      const ownWork = await t.database.migrator
        .insertInto('journal_works')
        .values({
          branch_id: s.branch,
          lesson_id: s.second,
          source_lesson_id: s.second,
          kind: 'classwork',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const column = planned(item.classworks[0] ?? '', s.first);
      // Task 10.3b: a save of numbers whose key is repeated below with the ids of another branch.
      const key = randomUUID();
      let saved: object = {};
      // Task 10.8: a work added in the journal at the 26th (no plan item), for its rename and
      // remove, and one of the other branch.
      const ownAdded = await as(owner, s.branch, teacherIn(s), async (calls) =>
        workAddedSchema.parse(
          ok(
            await calls.post(`/api/journal/lessons/${s.third}/works`, {
              kind: 'classwork',
              title: 'Dictation',
            }),
          ),
        ),
      );
      // A plan work of the other branch (404 before any check of its mark).
      const foreignAdded = foreign.classworks[0] ?? '';
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const total = await calls.put(`/api/journal/lessons/${s.first}/works/total`, {
          column,
          total: 5,
          version: null,
        });
        expect(total.status, JSON.stringify(total.body)).toBe(200);
        const work = workSavedSchema.parse(total.body).id;
        saved = {
          saves: [{ studentId: s.ahmedov, column: { workId: work }, score: 1, version: null }],
        };
        const first = await calls.keyed(`/api/journal/lessons/${s.first}/scores`, saved, key);
        expect(first.status, JSON.stringify(first.body)).toBe(200);
      });
      const auditBefore = await journalEntries();
      // Every entry but the roles the test gives below.
      const logged = await entriesBesidesRoles();
      const before = [await rowsOf(s.branch), await rowsOf(elsewhere.branch)];
      const bodies: [string, string, object][] = [
        ['put', 'works/total', { column, total: 5, version: null }],
        ['put', 'works/not-held', { column, notHeld: true, version: null }],
        ['post', 'works/carry', { column, version: null }],
        ['post', 'scores', { saves: [{ studentId: s.ahmedov, column, score: 1, version: null }] }],
        ['post', 'works', { kind: 'classwork', title: 'Dictation' }],
        ['delete', `works/${ownWork.id}`, {}],
        // Task 10.6: the rename of a work added by hand.
        ['put', `works/${ownWork.id}/title`, { title: 'Quiz', version: 1 }],
        // Task 10.8: the rename and the remove of a work added in the journal.
        [
          'put',
          `plan-works/${ownAdded.planWorkId}/title`,
          { title: 'Quiz', baseTitle: 'Dictation' },
        ],
        ['delete', `plan-works/${ownAdded.planWorkId}`, {}],
      ];
      const send = (calls: Calls, method: string, path: string, body: object) =>
        method === 'put'
          ? calls.put(path, body)
          : method === 'delete'
            ? calls.del(path)
            : calls.post(path, body);
      await as(other, s.branch, teacherIn(s), async (calls) => {
        for (const [method, path, body] of bodies) {
          const refused = await send(
            calls,
            method,
            `/api/journal/lessons/${s.first}/${path}`,
            body,
          );
          expect(codeOf(refused)).toBe('journal_entry_scope');
        }
      });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        for (const lesson of [elsewhere.first, randomUUID()]) {
          for (const [method, path, body] of bodies) {
            const missing = await send(
              calls,
              method,
              `/api/journal/lessons/${lesson}/${path}`,
              body,
            );
            expect(missing.status).toBe(404);
          }
        }
        // Ids in the body: another branch's and unknown ones.
        const columns: WorkColumn[] = [
          { workId: foreignWork.id },
          { workId: randomUUID() },
          planned(foreign.classworks[0] ?? '', s.first),
          planned(randomUUID(), s.first),
          planned(item.classworks[0] ?? '', elsewhere.first),
          planned(item.classworks[0] ?? '', randomUUID()),
        ];
        for (const other of columns) {
          for (const [path, body] of [
            ['works/total', { column: other, total: 5, version: null }],
            ['works/not-held', { column: other, notHeld: true, version: null }],
          ] as const) {
            expect((await calls.put(`/api/journal/lessons/${s.first}/${path}`, body)).status).toBe(
              404,
            );
          }
          expect(
            (
              await calls.post(`/api/journal/lessons/${s.first}/works/carry`, {
                column: other,
                version: null,
              })
            ).status,
          ).toBe(404);
          expect(
            (
              await calls.post(`/api/journal/lessons/${s.first}/scores`, {
                saves: [{ studentId: s.ahmedov, column: other, score: 1, version: null }],
              })
            ).status,
          ).toBe(404);
        }
        expect(
          (await calls.del(`/api/journal/lessons/${s.second}/works/${foreignWork.id}`)).status,
        ).toBe(404);
        expect(
          (await calls.del(`/api/journal/lessons/${s.second}/works/${randomUUID()}`)).status,
        ).toBe(404);
        // Task 10.8: the rename and the remove of another branch's plan work and an unknown one.
        for (const planWorkId of [foreignAdded, randomUUID()]) {
          expect(
            (
              await calls.put(`/api/journal/lessons/${s.third}/plan-works/${planWorkId}/title`, {
                title: 'Quiz',
                baseTitle: 'Test',
              })
            ).status,
          ).toBe(404);
          expect(
            (await calls.del(`/api/journal/lessons/${s.third}/plan-works/${planWorkId}`)).status,
          ).toBe(404);
        }
        // Task 10.6: the rename of another branch's work and an unknown one.
        for (const workId of [foreignWork.id, randomUUID()]) {
          expect(
            (
              await calls.put(`/api/journal/lessons/${s.second}/works/${workId}/title`, {
                title: 'Quiz',
                version: 1,
              })
            ).status,
          ).toBe(404);
        }
        for (const studentId of [elsewhere.ahmedov, randomUUID()]) {
          const stranger = await calls.post(`/api/journal/lessons/${s.first}/scores`, {
            saves: [{ studentId, column, score: 1, version: null }],
          });
          expect(stranger.status).toBe(404);
        }
        // Task 10.3b: the used key repeated with each id of another branch or unknown: 404,
        // never the stored answer.
        for (const lesson of [elsewhere.first, randomUUID()]) {
          expect(
            (await calls.keyed(`/api/journal/lessons/${lesson}/scores`, saved, key)).status,
          ).toBe(404);
        }
        for (const studentId of [elsewhere.ahmedov, randomUUID()]) {
          const again = await calls.keyed(
            `/api/journal/lessons/${s.first}/scores`,
            { saves: [{ studentId, column, score: 1, version: null }] },
            key,
          );
          expect(again.status).toBe(404);
        }
        for (const other of columns) {
          const again = await calls.keyed(
            `/api/journal/lessons/${s.first}/scores`,
            { saves: [{ studentId: s.ahmedov, column: other, score: 1, version: null }] },
            key,
          );
          expect(again.status, JSON.stringify(other)).toBe(404);
        }
      });
      expect(await journalEntries()).toBe(auditBefore);
      expect(await entriesBesidesRoles()).toEqual(logged);
      expect([await rowsOf(s.branch), await rowsOf(elsewhere.branch)]).toEqual(before);
    });

    it('refuses works on an attendance-only subject', async () => {
      const owner = await account();
      const s = await publishedScene(t, load, { accounts: { teacher: owner.account.id } });
      const lesson = (
        await t.database.migrator
          .selectFrom('lessons')
          .select('id')
          .where('class_id', '=', s.classId)
          .where('lesson_date', '=', '2026-10-19')
          .executeTakeFirstOrThrow()
      ).id;
      await as(owner, s.branch, [{ role: 'teacher', branchId: s.branch }], async (calls) => {
        const refused = await calls.post(`/api/journal/lessons/${lesson}/works`, {
          kind: 'classwork',
          title: 'Dictation',
        });
        expect(codeOf(refused)).toBe('lesson_attendance_only');
      });
    });
  });

  describe('who enters (permission review of the code, should-fix 3)', () => {
    const addOne = (calls: Calls, lessonId: string) =>
      calls.post(`/api/journal/lessons/${lessonId}/works`, {
        kind: 'classwork',
        title: 'Dictation',
      });

    it('lets a substitute add works at the substituted lesson only', async () => {
      const owner = await account();
      const substitute = await account();
      const s = await scene({ teacher: owner.account.id, spare: substitute.account.id });
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: s.spareTeacher.staffId })
        .where('id', '=', s.second)
        .execute();
      await as(substitute, s.branch, teacherIn(s), async (calls) => {
        ok(await addOne(calls, s.second));
        expect(codeOf(await addOne(calls, s.third))).toBe('journal_entry_scope');
      });
    });

    it('refuses the class Tutor on a graded lesson, and the Academic Vice Principal and the Super Admin with no lesson of theirs', async () => {
      const s = await scene();
      const tutor = await account();
      const assignment = await t.kit.giveRole(tutor.account.id, {
        role: 'tutor',
        branchId: s.branch,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
      await load.classes.person(s.branch, ['uz'], { accountId: tutor.account.id });
      await load.classes.tutorRow(s.branch, s.classId, assignment.id);
      const before = await rowsOf(s.branch);
      await as(tutor, s.branch, [], async (calls) => {
        expect(codeOf(await addOne(calls, s.third))).toBe('journal_entry_scope');
      });
      const vice = await account();
      await as(
        vice,
        s.branch,
        [{ role: 'academic_vice_principal', branchId: s.branch }],
        async (calls) => {
          expect(codeOf(await addOne(calls, s.third))).toBe('journal_entry_scope');
        },
      );
      const admin = await account();
      await as(admin, s.branch, [{ role: 'super_admin' }], async (calls) => {
        expect(codeOf(await addOne(calls, s.third))).toBe('journal_entry_scope');
      });
      expect(await rowsOf(s.branch)).toEqual(before);
    });
  });

  describe('a reader of attendance only (permission review of the code, should-fix 4)', () => {
    it('shows the Head Tutor no works, no works "not held", no homework given and no work lines', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.first, { classworks: ['Test', 'Quiz'], homeworks: ['Read'] });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const work = workSavedSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${s.first}/works/total`, {
              column: planned(item.classworks[0] ?? '', s.first),
              total: 10,
              version: null,
            }),
          ),
        );
        ok(
          await calls.put(`/api/journal/lessons/${s.first}/works/not-held`, {
            column: planned(item.classworks[1] ?? '', s.first),
            notHeld: true,
            version: null,
          }),
        );
        ok(
          await calls.post(`/api/journal/lessons/${s.first}/scores`, {
            saves: [{ studentId: s.ahmedov, column: { workId: work.id }, score: 4, version: null }],
          }),
        );
      });
      const headTutor = await account();
      await as(headTutor, s.branch, [{ role: 'head_tutor', branchId: s.branch }], async (calls) => {
        const grid = await gridOf(calls, s);
        expect(grid.shape).toBe('attendance');
        const first = lessonIn(grid, s.first);
        expect([first.works, first.notHeldWorks, first.given]).toEqual([[], [], []]);
        const history = cellHistorySchema.parse(
          ok(await calls.get(`/api/journal/lessons/${s.first}/students/${s.ahmedov}/history`)),
        );
        expect(history.workLines).toEqual([]);
        expect(history.lines.every((line) => line.work === null)).toBe(true);
      });
    });
  });

  describe('the journal teacher of the day (From 5.7a-3c)', () => {
    /** A vacancy's journal of the kit's graded subject with a lesson on 26 October held by a substitute. */
    async function vacancyScene() {
      const cells = await CellsKit.create(t.database.migrator);
      const acting = new ActingKit(t.database.migrator);
      const branch = await t.newBranch();
      const { year } = await cells.lessons.year(branch);
      const classId = await load.classes.schoolClass(branch, year, { grade: 7 });
      const vacancy = await load.vacancy(branch, {
        languages: ['uz'],
        subjects: [{ subject: cells.subject, grades: [7] }],
      });
      const substituteBrowser = await account();
      const substitute = await load.teacher(branch, {
        subjects: [{ subject: cells.subject, grades: [7] }],
        accountId: substituteBrowser.account.id,
      });
      const lesson = await cells.lesson(branch, year, classId, '2026-10-26');
      const scene = { branch, year, classId, subject: cells.subject };
      await acting.published(scene, '2026-10-19', vacancy);
      const journal = await acting.journal(branch, year, classId, cells.subject);
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: substitute.staffId })
        .where('id', '=', lesson)
        .execute();
      const pupil = await student(branch, classId, 'Ahmedov');
      return {
        acting,
        branch,
        year,
        classId,
        vacancy,
        journal,
        lesson,
        pupil,
        substituteBrowser,
        scene,
      };
    }

    it('lets the acting teacher of a vacancy add a work and type a number', async () => {
      const v = await vacancyScene();
      const actingBrowser = await account();
      const person = await load.teacher(v.branch, {
        subjects: [{ subject: v.scene.subject, grades: [7] }],
        accountId: actingBrowser.account.id,
      });
      await v.acting.period(
        {
          ...v.scene,
          vacancy: v.vacancy,
          person: person.staffId,
          personAccount: actingBrowser.account.id,
          version: '',
          journal: v.journal,
        },
        '2026-10-19',
      );
      await as(
        actingBrowser,
        v.branch,
        [{ role: 'teacher', branchId: v.branch }],
        async (calls) => {
          // Task 10.8: written into the lesson's plan item; its column is planned.
          const added = workAddedSchema.parse(
            ok(
              await calls.post(`/api/journal/lessons/${v.lesson}/works`, {
                kind: 'classwork',
                title: 'Dictation',
              }),
            ),
          );
          const totalled = workSavedSchema.parse(
            ok(
              await calls.put(`/api/journal/lessons/${v.lesson}/works/total`, {
                column: planned(added.planWorkId, v.lesson),
                total: 5,
                version: null,
              }),
            ),
          );
          ok(
            await calls.post(`/api/journal/lessons/${v.lesson}/scores`, {
              saves: [
                { studentId: v.pupil, column: { workId: totalled.id }, score: 4, version: null },
              ],
            }),
          );
        },
      );
    });

    it('takes attendance only on a day the journal has no teacher: the substitute marks attendance, no work', async () => {
      const v = await vacancyScene();
      await as(
        v.substituteBrowser,
        v.branch,
        [{ role: 'teacher', branchId: v.branch }],
        async (calls) => {
          const refused = await calls.post(`/api/journal/lessons/${v.lesson}/works`, {
            kind: 'classwork',
            title: 'Dictation',
          });
          expect(codeOf(refused)).toBe('lesson_attendance_only');
          ok(
            await calls.post(`/api/journal/lessons/${v.lesson}/attendance`, {
              saves: [{ studentId: v.pupil, mark: 1, version: null }],
            }),
          );
        },
      );
    });
  });

  // Task 10.8: the journal and the plan as one (`09`, In the journal; `edge/journal`, "A lesson is
  // held with no plan item"; plan review of pull request #304).
  describe('works added in the journal go into the plan (task 10.8)', () => {
    const planOf = (s: Scene) =>
      t.database.migrator
        .selectFrom('lesson_plan_journals')
        .select('plan_id')
        .where('journal_id', '=', s.journal)
        .where('quarter_id', '=', s.q1)
        .executeTakeFirstOrThrow();

    const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);

    const addAt = (calls: Calls, lessonId: string, kind: 'classwork' | 'homework', title: string) =>
      calls.post(`/api/journal/lessons/${lessonId}/works`, { kind, title });

    const added = async (
      calls: Calls,
      lessonId: string,
      kind: 'classwork' | 'homework',
      title: string,
    ) => workAddedSchema.parse(ok(await addAt(calls, lessonId, kind, title)));

    const planWork = (id: string) =>
      t.database.migrator
        .selectFrom('lesson_plan_works')
        .select(['id', 'item_id', 'kind', 'title', 'added_in_journal_at', 'added_in_journal_by'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

    /** The owner's save of the item's topic through the plan's route, on the item as stored. */
    const writeTopic = async (calls: Calls, itemId: string, topic: string) => {
      const works = await t.database.migrator
        .selectFrom('lesson_plan_works')
        .select(['id', 'kind', 'title', 'description'])
        .where('item_id', '=', itemId)
        .orderBy('kind')
        .orderBy('position')
        .execute();
      const list = (kind: string) =>
        works
          .filter((one) => one.kind === kind)
          .map((one) => ({ id: one.id, title: one.title, description: one.description }));
      const base = {
        topic: '',
        objectives: '',
        links: [],
        classworks: list('classwork'),
        homeworks: list('homework'),
      };
      return calls.put(`/api/plans/items/${itemId}`, { base, values: { ...base, topic } });
    };

    it('writes the work into the lesson’s plan item, creating the plan and the item with no topic, marked as added in the journal; a second add uses the same item', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      // The quarter's plan record is removed: "with the plan, when there is none".
      await t.database.migrator.transaction().execute(async (transaction) => {
        const link = await transaction
          .selectFrom('lesson_plan_journals')
          .select('plan_id')
          .where('journal_id', '=', s.journal)
          .where('quarter_id', '=', s.q1)
          .executeTakeFirstOrThrow();
        await transaction
          .deleteFrom('lesson_plan_follow_marks')
          .where('journal_id', '=', s.journal)
          .execute();
        // The plan's laying of its rows (7.1b) goes with it.
        for (const table of ['lesson_plan_rows', 'lesson_plan_absorbed'] as const) {
          await transaction.deleteFrom(table).where('plan_id', '=', link.plan_id).execute();
        }
        await transaction
          .deleteFrom('lesson_plan_journals')
          .where('plan_id', '=', link.plan_id)
          .execute();
        await transaction.deleteFrom('lesson_plans').where('id', '=', link.plan_id).execute();
      });
      const [classwork, homework] = await as(owner, s.branch, teacherIn(s), async (calls) => [
        await added(calls, s.second, 'classwork', 'Dictation'),
        await added(calls, s.second, 'homework', 'Exercises 4 to 9'),
      ]);
      if (classwork === undefined || homework === undefined) throw new Error('Two works added.');
      expect(homework.itemId).toBe(classwork.itemId);
      const item = await t.database.migrator
        .selectFrom('lesson_plan_items')
        .innerJoin(
          'lesson_plan_journals',
          'lesson_plan_journals.plan_id',
          'lesson_plan_items.plan_id',
        )
        .innerJoin('lesson_plan_places', 'lesson_plan_places.item_id', 'lesson_plan_items.id')
        .select([
          'lesson_plan_items.topic',
          'lesson_plan_journals.journal_id',
          'lesson_plan_journals.quarter_id',
          'lesson_plan_places.position',
        ])
        .where('lesson_plan_items.id', '=', classwork.itemId)
        .executeTakeFirstOrThrow();
      expect(item).toEqual({
        topic: '',
        journal_id: s.journal,
        quarter_id: s.q1,
        position: await rowOf(s, s.second),
      });
      const work = await planWork(classwork.planWorkId);
      expect(work).toMatchObject({ kind: 'classwork', title: 'Dictation' });
      expect(work.added_in_journal_at).not.toBeNull();
      expect(work.added_in_journal_by).toBe(owner.account.id);
      // The plan's history: the plan made, then one line per work, the first creating the item.
      const lines = await t.database.migrator
        .selectFrom('audit_log')
        .select(['action', 'new_value', 'details'])
        .where('record_type', '=', 'lesson_plan')
        .where('record_id', '=', (await planOf(s)).plan_id)
        .orderBy('id')
        .execute();
      expect(lines.map((line) => line.action)).toEqual([
        'plan.create',
        'plan.work_journal_add',
        'plan.work_journal_add',
      ]);
      expect(lines[1]?.details).toEqual({ createdPlan: true, createdItem: true });
      expect(lines[2]?.details).toEqual({ createdPlan: false, createdItem: false });
      expect(lines[2]?.new_value).toMatchObject({ kind: 'homework', title: 'Exercises 4 to 9' });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        // The plan's editor shows them like any work, marked, with the row still without a topic.
        const plan = planSchema.parse(
          ok(await calls.get(`/api/plans/journals/${s.journal}?quarterId=${s.q1}`)),
        );
        const row = plan.rows.find((one) => one.lessonId === s.second);
        expect(row?.item?.topic).toBe('');
        expect(row?.item?.classworks.map((one) => one.title)).toEqual(['Dictation']);
        expect(row?.item?.homeworks.map((one) => one.title)).toEqual(['Exercises 4 to 9']);
        expect(row?.item?.addedInJournal.sort()).toEqual(
          [classwork.planWorkId, homework.planWorkId].sort(),
        );
        // The journal still says "No plan" and the topic is shown as none.
        const grid = await gridOf(calls, s);
        expect(lessonIn(grid, s.second)).toMatchObject({ planItem: false, topic: null });
        // The homework is a planned column of the next lesson.
        expect(lessonIn(grid, s.third).works.map((one) => [one.planWorkId, one.unplanned])).toEqual(
          [[homework.planWorkId, false]],
        );
      });
    });

    it('counts a row with no topic as incomplete and exports such a plan', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const work = await as(owner, s.branch, teacherIn(s), async (calls) =>
        added(calls, s.second, 'classwork', 'Dictation'),
      );
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const plan = planSchema.parse(
          ok(await calls.get(`/api/plans/journals/${s.journal}?quarterId=${s.q1}`)),
        );
        expect(plan.rows.find((one) => one.item?.id === work.itemId)).toBeDefined();
        // Review correction 1: the row the add made has no topic, so it counts as empty.
        const list = planListSchema.parse(ok(await calls.get('/api/plans')));
        const quarter = list.plans
          .find((one) => one.journalId === s.journal)
          ?.quarters.find((one) => one.quarterId === s.q1);
        expect(quarter?.state).not.toBe('complete');
        expect(quarter?.empty).toBe(quarter?.rows);
        // The export of such a plan is answered (the PDF needs a browser; the workbook does not).
        const file = await calls.post(`/api/plans/journals/${s.journal}/export`, {
          quarterId: s.q1,
          format: 'xlsx',
        });
        expect(file.status).toBe(200);
      });
    });

    it('refuses an add, a rename and a remove in the journal once the owner wrote the topic; the owner edits the work through the plan', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await openPlanWindows(t.database.migrator, s.branch, s.year);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const work = await added(calls, s.second, 'classwork', 'Dictation');
        // Renamed in the journal while the item has no topic, on the title read.
        const stale = await calls.put(
          `/api/journal/lessons/${s.second}/plan-works/${work.planWorkId}/title`,
          { title: 'Quiz', baseTitle: 'Spelling' },
        );
        expect(codeOf(stale)).toBe('work_stale');
        ok(
          await calls.put(`/api/journal/lessons/${s.second}/plan-works/${work.planWorkId}/title`, {
            title: 'Quiz',
            baseTitle: 'Dictation',
          }),
        );
        expect((await planWork(work.planWorkId)).title).toBe('Quiz');
        ok(await writeTopic(calls, work.itemId, 'Fractions'));
        expect(codeOf(await addAt(calls, s.second, 'classwork', 'Essay'))).toBe(
          'lesson_has_plan_item',
        );
        expect(
          codeOf(
            await calls.put(
              `/api/journal/lessons/${s.second}/plan-works/${work.planWorkId}/title`,
              { title: 'Essay', baseTitle: 'Quiz' },
            ),
          ),
        ).toBe('work_planned');
        expect(
          codeOf(await calls.del(`/api/journal/lessons/${s.second}/plan-works/${work.planWorkId}`)),
        ).toBe('work_planned');
        const grid = await gridOf(calls, s);
        expect(lessonIn(grid, s.second)).toMatchObject({ planItem: true, topic: 'Fractions' });
      });
      // The rename is a line of the plan's history too.
      const plan = await planOf(s);
      const edits = await t.database.migrator
        .selectFrom('audit_log')
        .select(['old_value', 'new_value', 'details'])
        .where('record_type', '=', 'lesson_plan')
        .where('record_id', '=', plan.plan_id)
        .where('action', '=', 'plan.item_edit')
        .orderBy('id')
        .execute();
      expect(edits[0]).toMatchObject({
        old_value: { workTitle: { title: 'Dictation' } },
        new_value: { workTitle: { title: 'Quiz' } },
        details: { inJournal: true },
      });
    });

    // Plan review 3 and decision 16 (`09`, When something else changes: "The items of lessons
    // already held never move"): in a shared plan the new item goes to the other class after its
    // started rows (`placeNew`), so no item of a held lesson there moves and no separation is
    // needed.
    it('places the item an add makes in the other class of a shared plan after its started rows, moving no held item', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id }, true);
      const other = await journalOf(s.otherClass);
      const plan = (await planOf(s)).plan_id;
      await t.database.migrator
        .updateTable('lesson_plan_journals')
        .set({ plan_id: plan })
        .where('journal_id', '=', other)
        .where('quarter_id', '=', s.q1)
        .execute();
      const held = await itemAt(s, s.first, { classworks: ['Test'] });
      const otherRows = async () =>
        (
          await t.database.migrator
            .selectFrom('lessons')
            .select(['id', 'starts_at'])
            .where('class_id', '=', s.otherClass)
            .where('lesson_date', '>=', '2026-09-01')
            .where('lesson_date', '<=', '2026-10-31')
            .where('cancel_cause', 'is', null)
            .orderBy('starts_at')
            .execute()
        ).map((row) => row.starts_at);
      const rows = await otherRows();
      const started = rows.filter((at) => at.getTime() <= new Date(MOMENT).getTime()).length;
      await t.database.migrator
        .insertInto('lesson_plan_places')
        .values({
          branch_id: s.branch,
          plan_id: plan,
          journal_id: other,
          item_id: held.itemId,
          position: 1,
        })
        .execute();
      const work = await as(owner, s.branch, teacherIn(s), async (calls) =>
        added(calls, s.second, 'homework', 'Exercises'),
      );
      const places = await t.database.migrator
        .selectFrom('lesson_plan_places')
        .select(['item_id', 'position'])
        .where('journal_id', '=', other)
        .execute();
      expect(places.find((one) => one.item_id === held.itemId)?.position).toBe(1);
      expect(places.find((one) => one.item_id === work.itemId)?.position).toBe(started + 1);
      // No separation: both classes keep the one plan.
      expect(await t.entries('plan.separated')).toEqual([]);
    });

    // Review correction 2 (`09`, Master plans: "Teachers may start from the master, from a copy,
    // or from an empty plan"): an item the add made sits on a held row and blocks no copy.
    it('lets the owner still start from a copy after an add made the plan, keeping the added item at its held row', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await openPlanWindows(t.database.migrator, s.branch, s.year);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const work = await added(calls, s.second, 'classwork', 'Dictation');
        // The source: the second quarter's plan of the same journal, with one item.
        const firstOfQ2 = await t.database.migrator
          .selectFrom('lessons')
          .select('id')
          .where('class_id', '=', s.classId)
          .where('lesson_date', '>=', '2026-11-09')
          .where('cancel_cause', 'is', null)
          .orderBy('starts_at')
          .executeTakeFirstOrThrow();
        ok(
          await calls.post(`/api/plans/journals/${s.journal}/items`, {
            quarterId: s.q2,
            position: 1,
            lessonId: firstOfQ2.id,
            values: {
              topic: 'Decimals',
              objectives: '',
              links: [],
              classworks: [],
              homeworks: [],
            },
          }),
          201,
        );
        const copied = planSchema.parse(
          ok(
            await calls.post(`/api/plans/journals/${s.journal}/copy`, {
              quarterId: s.q1,
              source: { journalId: s.journal, quarterId: s.q2 },
              part: 'all',
            }),
          ),
        );
        const row = copied.rows.find((one) => one.lessonId === s.second);
        expect(row?.item?.id).toBe(work.itemId);
        expect(row?.item?.classworks.map((one) => one.title)).toEqual(['Dictation']);
      });
    });

    it('lets the substitute add a work into the plan, and not change the item', async () => {
      const owner = await account();
      const substitute = await account();
      const s = await scene({ teacher: owner.account.id, spare: substitute.account.id });
      await openPlanWindows(t.database.migrator, s.branch, s.year);
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: s.spareTeacher.staffId })
        .where('id', '=', s.second)
        .execute();
      await as(substitute, s.branch, teacherIn(s), async (calls) => {
        const work = await added(calls, s.second, 'homework', 'Exercises');
        expect((await planWork(work.planWorkId)).added_in_journal_by).toBe(substitute.account.id);
        expect(codeOf(await writeTopic(calls, work.itemId, 'Fractions'))).toBe('plan_scope');
      });
    });

    it('counts the works added by hand before toward the limit of 10, and never lets the new work take one over', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await openPlanWindows(t.database.migrator, s.branch, s.year);
      for (let index = 0; index < 10; index += 1) {
        await byHand(s.branch, s.second, 'homework', `Old ${String(index + 1)}`);
      }
      const old = await byHand(s.branch, s.second, 'classwork', 'Old classwork');
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        expect(codeOf(await addAt(calls, s.second, 'homework', 'Exercises'))).toBe(
          'journal_works_limit',
        );
        const work = await added(calls, s.second, 'classwork', 'New classwork');
        let grid = await gridOf(calls, s);
        expect(
          lessonIn(grid, s.second).works.map((one) => [one.title, one.unplanned, one.id]),
        ).toEqual([
          ['New classwork', false, null],
          ['Old classwork', true, old.id],
        ]);
        // The owner's item save adds a planned classwork: it, not the journal's, takes the old one.
        const base = {
          topic: '',
          objectives: '',
          links: [],
          classworks: [{ id: work.planWorkId, title: 'New classwork', description: '' }],
          homeworks: [],
        };
        ok(
          await calls.put(`/api/plans/items/${work.itemId}`, {
            base,
            values: {
              ...base,
              topic: 'Fractions',
              classworks: [...base.classworks, { title: 'Planned', description: '' }],
            },
          }),
        );
        grid = await gridOf(calls, s);
        expect(
          lessonIn(grid, s.second).works.map((one) => [one.title, one.unplanned, one.id]),
        ).toEqual([
          ['New classwork', false, null],
          ['Planned', false, old.id],
        ]);
      });
    });

    // Code review of the task (spec 7, permission 1): a file the owner gave the work through the
    // plan and a "not given" mark are data; the journal's remove refuses them.
    it('refuses to remove a work added in the journal that holds a file or a "not given" mark, removes it once empty, and keeps the empty item for the next add', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await openPlanWindows(t.database.migrator, s.branch, s.year);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const work = await added(calls, s.third, 'homework', 'Exercises');
        const file = planItemFileSchema.parse(
          ok(
            await calls.upload(
              `/api/plans/items/${work.itemId}/files?name=Sheet.pdf&workId=${work.planWorkId}`,
              'application/pdf',
              PDF,
            ),
          ),
        );
        expect(file.workId).toBe(work.planWorkId);
        const path = `/api/journal/lessons/${s.third}/plan-works/${work.planWorkId}`;
        expect(codeOf(await calls.del(path))).toBe('work_holds_data');
        ok(await calls.del(`/api/plans/files/${file.id}`), 204);
        const mark = await t.database.migrator
          .insertInto('journal_homework_not_given')
          .values({
            branch_id: s.branch,
            journal_id: s.journal,
            lesson_id: s.third,
            plan_work_id: work.planWorkId,
            changed_by: owner.account.id,
            changed_how: 'entry',
            set_at: new Date(MOMENT),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        expect(codeOf(await calls.del(path))).toBe('work_holds_data');
        await t.database.migrator
          .deleteFrom('journal_homework_not_given')
          .where('id', '=', mark.id)
          .execute();
        ok(await calls.del(path), 204);
        const grid = await gridOf(calls, s);
        expect(lessonIn(grid, s.third)).toMatchObject({ planItem: false, given: [] });
        // The empty item stays at the row: the next add and the card use it.
        const again = await added(calls, s.third, 'classwork', 'Dictation');
        expect(again.itemId).toBe(work.itemId);
        const card = lessonCardSchema.parse(
          ok(await calls.get(`/api/journal/lessons/${s.third}/card`)),
        );
        expect(card.plan.item?.id).toBe(work.itemId);
        expect(card.plan.edit).toBe('open');
      });
      const removal = await t.database.migrator
        .selectFrom('audit_log')
        .select('details')
        .where('action', '=', 'plan.item_edit')
        .where('record_id', '=', (await planOf(s)).plan_id)
        .executeTakeFirstOrThrow();
      expect(removal.details).toMatchObject({ inJournal: true });
    });

    it('makes an add wait for the owner’s save of the topic and then refuses it (and the other order)', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await openPlanWindows(t.database.migrator, s.branch, s.year);
      const work = await as(owner, s.branch, teacherIn(s), async (calls) =>
        added(calls, s.second, 'classwork', 'Dictation'),
      );
      // The held side does what the owner's save does: the item locked, then its topic written.
      const hold = async (write: (transaction: Transaction) => Promise<void>) => {
        let release: () => void = () => undefined;
        const released = new Promise<void>((resolve) => {
          release = resolve;
        });
        let ready: () => void = () => undefined;
        const isReady = new Promise<void>((resolve) => {
          ready = resolve;
        });
        const held = t.database.migrator
          .transaction()
          .execute(async (transaction) => {
            await sql`select set_config('app.now', ${MOMENT}, true)`.execute(transaction);
            await transaction
              .selectFrom('lesson_plan_items')
              .select('id')
              .where('id', '=', work.itemId)
              .forNoKeyUpdate()
              .execute();
            await write(transaction);
            ready();
            await released;
          })
          .catch((error: unknown) => error);
        await isReady;
        return { held, release };
      };
      const waitForLock = async () => {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const waiting = await sql<{ waiting: number }>`
            select count(*)::int as waiting from pg_locks l
            join pg_stat_activity a on a.pid = l.pid
            where a.datname = current_database() and not l.granted
          `.execute(t.database.migrator);
          if ((waiting.rows[0]?.waiting ?? 0) >= 1) return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error('Nothing waited.');
      };
      const first = await hold(async (transaction) => {
        await transaction
          .updateTable('lesson_plan_items')
          .set({ topic: 'Fractions' })
          .where('id', '=', work.itemId)
          .execute();
      });
      await as(owner, s.branch, [], async (calls) => {
        const started = new Promise<Response>((resolve, reject) => {
          addAt(calls, s.second, 'classwork', 'Essay').then(resolve, reject);
        });
        await waitForLock();
        first.release();
        expect(await first.held).toBeUndefined();
        expect(codeOf(await started)).toBe('lesson_has_plan_item');
      });
      // The other order: an add held at the item (its work written), then the owner's save.
      await t.database.migrator
        .updateTable('lesson_plan_items')
        .set({ topic: '' })
        .where('id', '=', work.itemId)
        .execute();
      const second = await hold(async (transaction) => {
        await transaction
          .insertInto('lesson_plan_works')
          .values({
            branch_id: s.branch,
            item_id: work.itemId,
            kind: 'homework',
            position: 1,
            title: 'Exercises',
            description: '',
            added_in_journal_at: new Date(MOMENT),
            added_in_journal_by: owner.account.id,
          })
          .execute();
      });
      await as(owner, s.branch, [], async (calls) => {
        const started = new Promise<Response>((resolve, reject) => {
          writeTopic(calls, work.itemId, 'Fractions').then(resolve, reject);
        });
        await waitForLock();
        second.release();
        expect(await second.held).toBeUndefined();
        // The save read its base before the add committed: the works it did not name are kept.
        ok(await started);
      });
      const works = await t.database.migrator
        .selectFrom('lesson_plan_works')
        .select('title')
        .where('item_id', '=', work.itemId)
        .orderBy('title')
        .execute();
      expect(works.map((one) => one.title)).toEqual(['Dictation', 'Exercises']);
    });
  });

  describe('at the same moment', () => {
    it('makes an add by hand wait for another add of the lesson, and refuses it past the tenth', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        for (let index = 0; index < 9; index += 1) {
          ok(
            await calls.post(`/api/journal/lessons/${s.second}/works`, {
              kind: 'classwork',
              title: 'Dictation',
            }),
          );
        }
      });
      // The held side writes what the route writes: the lock of the limit, then the tenth work.
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const held = t.database.migrator
        .transaction()
        .execute(async (transaction) => {
          await sql`select set_config('app.now', ${MOMENT}, true)`.execute(transaction);
          await sql`select pg_advisory_xact_lock(hashtextextended(${`journal_works_limit:${s.second}`}, 0))`.execute(
            transaction,
          );
          await transaction
            .insertInto('journal_works')
            .values({
              branch_id: s.branch,
              lesson_id: s.second,
              source_lesson_id: s.second,
              kind: 'classwork',
              position: 10,
            })
            .execute();
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await isReady;
      await as(owner, s.branch, [], async (calls) => {
        const started = new Promise<Response>((resolve, reject) => {
          calls
            .post(`/api/journal/lessons/${s.second}/works`, {
              kind: 'classwork',
              title: 'Dictation',
            })
            .then(resolve, reject);
        });
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const waiting = await sql<{ waiting: number }>`
            select count(*)::int as waiting from pg_locks l
            join pg_stat_activity a on a.pid = l.pid
            where a.datname = current_database() and not l.granted and l.locktype = 'advisory'
          `.execute(t.database.migrator);
          if ((waiting.rows[0]?.waiting ?? 0) >= 1) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        release();
        expect(await held).toBeUndefined();
        expect(codeOf(await started)).toBe('journal_works_limit');
      });
    });
  });

  describe('the separation of a shared plan (decision 17)', () => {
    it('keeps the column, the total and the numbers of the separated journal', async () => {
      const owner = await account();
      const s = await publishedScene(t, load, {
        graded: true,
        shared: true,
        accounts: { teacher: owner.account.id },
      });
      await openPlanWindows(t.database.migrator, s.branch, s.year);
      const journal = await journalOf(s.classId);
      const other = await journalOf(s.otherClass);
      const q1 = (
        await t.database.migrator
          .selectFrom('quarters')
          .select('id')
          .where('academic_year_id', '=', s.year)
          .where('number', '=', 1)
          .executeTakeFirstOrThrow()
      ).id;
      const pupil = await student(s.branch, s.otherClass, 'Ergashev');
      const otherLesson = (
        await t.database.migrator
          .selectFrom('lessons')
          .select('id')
          .where('class_id', '=', s.otherClass)
          .where('lesson_date', '=', '2026-10-12')
          .executeTakeFirstOrThrow()
      ).id;
      await as(owner, s.branch, [{ role: 'teacher', branchId: s.branch }], async (calls) => {
        ok(
          await calls.post(`/api/plans/journals/${journal}/share`, {
            quarterId: q1,
            journalId: other,
          }),
        );
        const created = planItemSchema.parse(
          ok(
            // Written at the separated journal's own first row (the other journal lays it after its started rows).
            await calls.post(`/api/plans/journals/${other}/items`, {
              quarterId: q1,
              position: 1,
              lessonId: otherLesson,
              values: {
                topic: 'Fractions',
                objectives: '',
                links: [],
                classworks: [{ title: 'Test', description: '' }],
                homeworks: [],
              },
            }),
            201,
          ),
        );
        const planWork = created.classworks[0]?.id ?? '';
        const work = workSavedSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${otherLesson}/works/total`, {
              column: { planWorkId: planWork, sourceLessonId: otherLesson },
              total: 20,
              version: null,
            }),
          ),
        );
        ok(
          await calls.post(`/api/journal/lessons/${otherLesson}/scores`, {
            saves: [{ studentId: pupil, column: { workId: work.id }, score: 15, version: null }],
          }),
        );
        ok(await calls.post(`/api/plans/journals/${other}/separate`, { quarterId: q1 }));
        const grid = journalGridSchema.parse(ok(await calls.get(`/api/journal/journals/${other}`)));
        const lesson = lessonIn(grid, otherLesson);
        expect(lesson.works.map((one) => [one.id, one.title, one.total])).toEqual([
          [work.id, 'Test', 20],
        ]);
        const at = grid.lessons.findIndex((one) => one.id === otherLesson);
        expect(grid.students.find((one) => one.id === pupil)?.cells[at]?.works[0]?.score).toBe(15);
        expect(lesson.works[0]?.planWorkId).not.toBe(planWork);
      });
      const row = await t.database.migrator
        .selectFrom('journal_works')
        .innerJoin('lesson_plan_works', 'lesson_plan_works.id', 'journal_works.plan_work_id')
        .innerJoin('lesson_plan_items', 'lesson_plan_items.id', 'lesson_plan_works.item_id')
        .innerJoin(
          'lesson_plan_journals',
          'lesson_plan_journals.plan_id',
          'lesson_plan_items.plan_id',
        )
        .select('lesson_plan_journals.journal_id')
        .where('journal_works.lesson_id', '=', otherLesson)
        .executeTakeFirstOrThrow();
      expect(row.journal_id).toBe(other);
    });
  });

  describe('the plan save', () => {
    it('lets a plan item take over the works added by hand in order, keeps the numbers under their titles after a reorder, and refuses removing a work with data', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await openPlanWindows(t.database.migrator, s.branch, s.year);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const first = await byHand(s.branch, s.second, 'classwork', 'Dictation');
        const second = await byHand(s.branch, s.second, 'classwork', 'Dictation');
        for (const [work, score] of [
          [first, 4],
          [second, 9],
        ] as const) {
          const totalled = workSavedSchema.parse(
            ok(
              await calls.put(`/api/journal/lessons/${s.second}/works/total`, {
                column: { workId: work.id },
                total: 10,
                version: work.version,
              }),
            ),
          );
          ok(
            await calls.post(`/api/journal/lessons/${s.second}/scores`, {
              saves: [
                { studentId: s.ahmedov, column: { workId: totalled.id }, score, version: null },
              ],
            }),
          );
        }
        const created = planItemSchema.parse(
          ok(
            await calls.post(`/api/plans/journals/${s.journal}/items`, {
              quarterId: s.q1,
              position: await rowOf(s, s.second),
              lessonId: s.second,
              values: {
                topic: 'Fractions',
                objectives: '',
                links: [],
                classworks: [
                  { title: 'Dictation', description: '' },
                  { title: 'Quiz', description: '' },
                ],
                homeworks: [],
              },
            }),
            201,
          ),
        );
        const titled = async () => {
          const grid = await gridOf(calls, s);
          const at = grid.lessons.findIndex((one) => one.id === s.second);
          const ahmedov = grid.students.find((one) => one.id === s.ahmedov);
          return lessonIn(grid, s.second).works.map((one, index) => [
            one.title,
            one.unplanned,
            ahmedov?.cells[at]?.works[index]?.score,
          ]);
        };
        expect(await titled()).toEqual([
          ['Dictation', false, 4],
          ['Quiz', false, 9],
        ]);
        // A save that reorders the classworks keeps each number under its title.
        const reordered = planItemSchema.parse(
          ok(
            await calls.put(`/api/plans/items/${created.id}`, {
              base: {
                topic: created.topic,
                objectives: created.objectives,
                links: created.links,
                classworks: created.classworks,
                homeworks: created.homeworks,
              },
              values: {
                topic: created.topic,
                objectives: created.objectives,
                links: created.links,
                classworks: [...created.classworks].reverse(),
                homeworks: [],
              },
            }),
          ),
        );
        expect(reordered.classworks.map((one) => one.title)).toEqual(['Quiz', 'Dictation']);
        expect(await titled()).toEqual([
          ['Quiz', false, 9],
          ['Dictation', false, 4],
        ]);
        const removed = await calls.put(`/api/plans/items/${created.id}`, {
          base: {
            topic: reordered.topic,
            objectives: reordered.objectives,
            links: reordered.links,
            classworks: reordered.classworks,
            homeworks: reordered.homeworks,
          },
          values: {
            topic: reordered.topic,
            objectives: reordered.objectives,
            links: reordered.links,
            classworks: reordered.classworks.slice(0, 1),
            homeworks: [],
          },
        });
        expect(codeOf(removed)).toBe('plan_work_has_data');
      });
      expect((await t.entries('journal.work_takeover')).length).toBeGreaterThanOrEqual(1);
    });
  });

  // Task 10.6 (the owner's `/spec-change` of 5 November 2026): a work added by hand is named.
  describe('the title of a work added by hand', () => {
    it('refuses an add with no title, an empty or blank one and one of 61 characters, and keeps a title of 60 trimmed', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const before = await rowsOf(s.branch);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        for (const body of [
          { kind: 'classwork' },
          { kind: 'classwork', title: '' },
          { kind: 'homework', title: '  \t ' },
          { kind: 'classwork', title: 'x'.repeat(61) },
          { kind: 'classwork', title: '😀'.repeat(61) },
        ]) {
          const refused = await calls.post(`/api/journal/lessons/${s.second}/works`, body);
          expect(refused.status, JSON.stringify(body)).toBe(400);
        }
        expect(await rowsOf(s.branch)).toEqual(before);
        // Sixty characters, counted as PostgreSQL counts them: one emoji is one character.
        for (const title of ['x'.repeat(60), '😀'.repeat(60), 'Oʻqish va yozish']) {
          const added = workAddedSchema.parse(
            ok(
              await calls.post(`/api/journal/lessons/${s.second}/works`, {
                kind: 'classwork',
                title: `  ${title} `,
              }),
            ),
          );
          expect(added.title).toBe(title);
        }
        const grid = await gridOf(calls, s);
        expect(lessonIn(grid, s.second).works.map((one) => one.title)).toEqual([
          'x'.repeat(60),
          '😀'.repeat(60),
          'Oʻqish va yozish',
        ]);
      });
      const [entry] = await t.entries('journal.work_add', s.second);
      expect(entry?.new_value).toMatchObject({ title: 'x'.repeat(60) });
    });

    it('shows the typed title as the column title, and a homework given by hand at the lesson that gave it and at its check lesson', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const classwork = await byHand(s.branch, s.second, 'classwork', 'Dictation');
        const homework = await byHand(s.branch, s.second, 'homework', 'Exercises 4 to 9');
        const grid = await gridOf(calls, s);
        expect(
          lessonIn(grid, s.second).works.map((one) => [one.id, one.title, one.unplanned]),
        ).toEqual([[classwork.id, 'Dictation', true]]);
        expect(lessonIn(grid, s.second).given.map((one) => one.title)).toEqual([
          'Exercises 4 to 9',
        ]);
        expect(lessonIn(grid, s.third).works.map((one) => [one.id, one.title])).toEqual([
          [homework.id, 'Exercises 4 to 9'],
        ]);
      });
    });

    it('renames a work added by hand through the lesson that shows it, refuses a stale version and a planned work, and renames a work added before 10.6', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const item = await itemAt(s, s.first, { classworks: ['Test'] });
      // A work added by hand before 10.6: no title, shown as "CW 1".
      const old = await t.database.migrator
        .insertInto('journal_works')
        .values({
          branch_id: s.branch,
          lesson_id: s.third,
          source_lesson_id: s.third,
          kind: 'classwork',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const before = await gridOf(calls, s);
        expect(lessonIn(before, s.third).works.map((one) => [one.title, one.position])).toEqual([
          [null, 1],
        ]);
        const renamedOld = workSavedSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${s.third}/works/${old.id}/title`, {
              title: ' Reading ',
              version: 1,
            }),
          ),
        );
        expect(renamedOld).toMatchObject({ title: 'Reading', version: 2 });
        // A stale version is refused with the stored work.
        const stale = await calls.put(`/api/journal/lessons/${s.third}/works/${old.id}/title`, {
          title: 'Writing',
          version: 1,
        });
        expect(codeOf(stale)).toBe('work_stale');
        // The same title writes nothing.
        expect(
          workSavedSchema.parse(
            ok(
              await calls.put(`/api/journal/lessons/${s.third}/works/${old.id}/title`, {
                title: 'Reading',
                version: 2,
              }),
            ),
          ).version,
        ).toBe(2);
        // A homework given by hand, renamed through its check lesson.
        const given = await byHand(s.branch, s.second, 'homework', 'Exercises');
        ok(
          await calls.put(`/api/journal/lessons/${s.third}/works/${given.id}/title`, {
            title: 'Exercises 4 to 9',
            version: given.version,
          }),
        );
        // Permission review, should-fix 3: a work that is not a column of the lesson named is
        // refused there, nothing written.
        const elsewhere = await byHand(s.branch, s.second, 'classwork', 'Essay');
        const rows = await rowsOf(s.branch);
        const entries = await journalEntries();
        const notHere = await calls.put(
          `/api/journal/lessons/${s.first}/works/${elsewhere.id}/title`,
          { title: 'Quiz', version: elsewhere.version },
        );
        expect(codeOf(notHere)).toBe('work_not_in_lesson');
        expect(await rowsOf(s.branch)).toEqual(rows);
        expect(await journalEntries()).toBe(entries);
        // A planned work takes its title from the plan.
        const planned = workSavedSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${s.first}/works/total`, {
              column: { planWorkId: item.classworks[0] ?? '', sourceLessonId: s.first },
              total: 5,
              version: null,
            }),
          ),
        );
        const refused = await calls.put(
          `/api/journal/lessons/${s.first}/works/${planned.id}/title`,
          { title: 'Quiz', version: planned.version },
        );
        expect(codeOf(refused)).toBe('work_planned');
        // A body with no title, a blank one or one too long: 400.
        for (const body of [
          { version: 2 },
          { title: ' ', version: 2 },
          { title: 'x'.repeat(61), version: 2 },
        ]) {
          expect(
            (await calls.put(`/api/journal/lessons/${s.third}/works/${old.id}/title`, body)).status,
          ).toBe(400);
        }
        const grid = await gridOf(calls, s);
        expect(lessonIn(grid, s.third).works.map((one) => one.title)).toEqual([
          'Reading',
          'Exercises 4 to 9',
        ]);
        expect(lessonIn(grid, s.second).given.map((one) => one.title)).toEqual([
          'Exercises 4 to 9',
        ]);
      });
      const lines = await t.database.migrator
        .selectFrom('journal_work_history')
        .select(['title_before', 'title_after', 'changed_how', 'changed_by'])
        .where('work_id', '=', old.id)
        .orderBy('version')
        .execute();
      expect(lines).toEqual([
        {
          title_before: null,
          title_after: 'Reading',
          changed_how: 'entry',
          changed_by: owner.account.id,
        },
      ]);
      const renames = await t.entries('journal.work_rename', s.third);
      expect(renames.map((one) => [one.old_value, one.new_value])).toEqual(
        expect.arrayContaining([
          [
            { workId: old.id, kind: 'classwork', title: null },
            { workId: old.id, kind: 'classwork', title: 'Reading', version: 2 },
          ],
        ]),
      );
      expect(renames).toHaveLength(2);
    });

    it('lets a plan item written later replace the typed titles in order, keeps them in history, and leaves a work without a match its own title', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await openPlanWindows(t.database.migrator, s.branch, s.year);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const added: string[] = [];
        // Task 10.8: works added by hand before 7 November 2026.
        for (const title of ['Dictation', 'Quiz', 'Essay']) {
          added.push((await byHand(s.branch, s.second, 'classwork', title)).id);
        }
        ok(
          await calls.post(`/api/plans/journals/${s.journal}/items`, {
            quarterId: s.q1,
            position: await rowOf(s, s.second),
            lessonId: s.second,
            values: {
              topic: 'Fractions',
              objectives: '',
              links: [],
              classworks: [
                { title: 'Spelling', description: '' },
                { title: 'Reading aloud', description: '' },
              ],
              homeworks: [],
            },
          }),
          201,
        );
        const grid = await gridOf(calls, s);
        expect(
          lessonIn(grid, s.second).works.map((one) => [one.id, one.title, one.unplanned]),
        ).toEqual([
          [added[0], 'Spelling', false],
          [added[1], 'Reading aloud', false],
          [added[2], 'Essay', true],
        ]);
        // A work the plan took is renamed through the plan only.
        const refused = await calls.put(
          `/api/journal/lessons/${s.second}/works/${added[0] ?? ''}/title`,
          { title: 'Dictation', version: 2 },
        );
        expect(codeOf(refused)).toBe('work_planned');
      });
      const stored = await t.database.migrator
        .selectFrom('journal_works')
        .select(['id', 'title'])
        .where('source_lesson_id', '=', s.second)
        .where('kind', '=', 'classwork')
        .orderBy('position')
        .execute();
      expect(stored.map((one) => one.title)).toEqual([null, null, 'Essay']);
      const lines = await t.database.migrator
        .selectFrom('journal_work_history')
        .select(['title_before', 'title_after'])
        .where('lesson_id', '=', s.second)
        .where('changed_how', '=', 'takeover')
        .orderBy('title_before')
        .execute();
      expect(lines).toEqual([
        { title_before: 'Dictation', title_after: null },
        { title_before: 'Quiz', title_after: null },
      ]);
      const takeovers = (await t.entries('journal.work_takeover')).map((one) =>
        JSON.stringify(one.new_value),
      );
      expect(
        takeovers.some(
          (one) =>
            one.includes('"replacedTitle":"Dictation"') && one.includes('"replacedTitle":"Quiz"'),
        ),
      ).toBe(true);
    });
  });
});
