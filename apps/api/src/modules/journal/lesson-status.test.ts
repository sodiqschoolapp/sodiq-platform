import {
  REQUEST_KEY_HEADER,
  BRANCH_HEADER,
  disciplineSchema,
  journalGridSchema,
  notGradedAnswerSchema,
  orphanAssignmentSchema,
  orphanLessonsSchema,
  remindersSchema,
  teachingHomeSchema,
  undoneSchema,
  type Discipline,
  type JournalGrid,
  type Reminder,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { Transactions } from '../../database/transactions.js';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inOrderOnLesson } from '../../testing/cells-kit.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { setEditDays } from '../../testing/branch-filter-sql.js';
import { publishedScene } from '../../testing/published-scene.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): string =>
  (response.body as { error?: { code?: string } }).error?.code ?? `status ${response.status}`;

const ok = (response: Response, status = 200): unknown => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response.body;
};

// All names are invented. Task 8.7, pull request #225: the lesson status, "not graded",
// the reminders, the counts per teacher and the orphan lessons (docs/spec/07-journal.md,
// Lesson status, Reminders; 08, Journal discipline; edge-cases/journal.md).
describe('lesson status, reminders and the counts per teacher', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Nodira', `Saidova${'a'.repeat(names % 7)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };
  interface Calls {
    get: (path: string) => Promise<Response>;
    post: (path: string, body?: object) => Promise<Response>;
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
      const at = (method: 'get' | 'post' | 'put', path: string) =>
        request(t.kit.server)
          [method](path)
          .set('Cookie', browser.cookie)
          .set(BRANCH_HEADER, branch);
      return await work({
        get: (path) => at('get', path),
        post: (path, body = {}) =>
          at('post', path).set(REQUEST_KEY_HEADER, randomUUID()).send(body),
        put: (path, body) => at('put', path).send(body),
      });
    } finally {
      t.clock.set(START);
    }
  }

  const student = async (branch: string, classId: string, last: string): Promise<string> => {
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const id = await members.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: 'Ali', last_name: last })
      .where('id', '=', id)
      .execute();
    await members.member({ branch, classId, studentId: id, from: '2026-09-01' });
    return id;
  };

  /**
   * The graded scene of 6.2: maths of 7th grade on the Mondays at 08:00 in a branch of its
   * own, owned by the scene's teacher. `first`, `second`, `third` are 12, 19, 26 October.
   */
  async function scene(accounts: { teacher?: string; spare?: string } = {}, rating = false) {
    const s = await publishedScene(t, load, { graded: true, accounts });
    // The edit period of the school: 7 days (`edge/00-definitions`, Lock moment).
    await setEditDays(t.database.migrator, s.branch, 7);
    if (rating) {
      await t.database.migrator
        .updateTable('subjects')
        .set({ rating_exam: true })
        .where('id', '=', s.subject)
        .execute();
      await t.database.migrator
        .updateTable('subject_quarter_weights')
        .set({ attendance: 20, classwork: 20, homework: 20, rating_exam: 40 })
        .where('subject_id', '=', s.subject)
        .where('branch_id', '=', s.branch)
        .execute();
    }
    const lessons = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('lesson_date', '>=', '2026-10-12')
        .orderBy('starts_at')
        .execute()
    ).map((row) => row.id);
    const [first, second, third] = lessons;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('The scene has lessons from 12 October on.');
    }
    const journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.classId)
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
    return {
      ...s,
      first,
      second,
      third,
      journal,
      q1,
      ahmedov: await student(s.branch, s.classId, 'Ahmedov'),
      boboyev: await student(s.branch, s.classId, 'Boboyev'),
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /** A plan item at the row of `lessonId` in quarter 1 with one classwork, as the migrator. */
  async function classworkAt(s: Scene, lessonId: string): Promise<void> {
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
    await t.database.migrator
      .insertInto('lesson_plan_works')
      .values({
        branch_id: s.branch,
        item_id: item.id,
        kind: 'classwork',
        position: 1,
        title: 'Test',
      })
      .execute();
    await t.database.migrator
      .insertInto('lesson_plan_places')
      .values({
        branch_id: s.branch,
        plan_id: plan.plan_id,
        journal_id: s.journal,
        item_id: item.id,
        position: rows.indexOf(lessonId) + 1,
      })
      .execute();
  }

  const teacherIn = (s: Scene) => [{ role: 'teacher' as const, branchId: s.branch }];
  const viceIn = (s: Scene) => [{ role: 'academic_vice_principal' as const, branchId: s.branch }];

  const gridOf = async (calls: Calls, s: Scene): Promise<JournalGrid> =>
    journalGridSchema.parse(ok(await calls.get(`/api/journal/journals/${s.journal}`)));

  const statusIn = (grid: JournalGrid, lessonId: string) =>
    grid.lessons.find((one) => one.id === lessonId)?.status;

  const mark = (calls: Calls, lessonId: string, saves: { studentId: string; mark: number }[]) =>
    calls.post(`/api/journal/lessons/${lessonId}/attendance`, {
      saves: saves.map((one) => ({ ...one, version: null })),
    });

  const kinds = (reminders: readonly Reminder[]) =>
    reminders.map((one) =>
      one.kind === 'rating_missing'
        ? [one.kind, one.journal.id, one.count]
        : [one.kind, one.lesson.id, one.count],
    );

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  it('gives the same status in the journal, on the teaching home, on the timetable, in the reminders and in the counts, and "Not graded" completes the lesson (the Done when)', async () => {
    const owner = await account();
    const vice = await account();
    const s = await scene({ teacher: owner.account.id });
    await classworkAt(s, s.third);
    // The 12th: one of two marked; the 19th: both; the 26th: both, with one number missing.
    await as(
      owner,
      s.branch,
      teacherIn(s),
      (calls) => mark(calls, s.first, [{ studentId: s.ahmedov, mark: 1 }]),
      '2026-10-12T12:00:00+05:00',
    );
    await as(
      owner,
      s.branch,
      teacherIn(s),
      (calls) =>
        mark(calls, s.second, [
          { studentId: s.ahmedov, mark: 1 },
          { studentId: s.boboyev, mark: 0 },
        ]),
      '2026-10-19T12:00:00+05:00',
    );
    const workId = await as(owner, s.branch, teacherIn(s), async (calls) => {
      await calls.post(`/api/journal/lessons/${s.third}/attendance`, {
        saves: [
          { studentId: s.ahmedov, mark: 1, version: null },
          { studentId: s.boboyev, mark: 2, version: null },
        ],
      });
      const grid = await gridOf(calls, s);
      const work = grid.lessons.find((one) => one.id === s.third)?.works[0];
      const column = { planWorkId: work?.planWorkId ?? '', sourceLessonId: s.third };
      const total = await request(t.kit.server)
        .put(`/api/journal/lessons/${s.third}/works/total`)
        .set('Cookie', owner.cookie)
        .set(BRANCH_HEADER, s.branch)
        .send({ column, total: 10, version: null });
      const stored = ok(total) as { id: string };
      ok(
        await calls.post(`/api/journal/lessons/${s.third}/scores`, {
          saves: [{ studentId: s.ahmedov, column: { workId: stored.id }, score: 7, version: null }],
        }),
      );
      return stored.id;
    });

    const expectAll = async (third: 'in_progress' | 'complete') => {
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const grid = await gridOf(calls, s);
        expect(statusIn(grid, s.first)).toBe('locked_incomplete');
        expect(statusIn(grid, s.second)).toBe('complete');
        expect(statusIn(grid, s.third)).toBe(third);
        const home = teachingHomeSchema.parse(ok(await calls.get('/api/timetable/home')));
        expect(home.lessons.find((one) => one.id === s.third)?.status).toBe(third);
        const own = remindersSchema.parse(ok(await calls.get('/api/journal/reminders')));
        const expected = [
          ['no_attendance', s.first, 1],
          ['no_topic', s.first, 1],
          ['no_topic', s.second, 1],
          ...(third === 'in_progress' ? [['numbers_missing', s.third, 1]] : []),
        ];
        expect(kinds(own.reminders)).toEqual(expected);
        // The journal's panel shows the same for its reader.
        expect(kinds(grid.reminders as Reminder[])).toEqual(expected);
      });
      await as(vice, s.branch, viceIn(s), async (calls) => {
        const counts = disciplineSchema.parse(
          ok(await calls.get('/api/journal/discipline?from=2026-10-12&to=2026-10-27')),
        );
        expect(counts.teachers.filter((one) => one.teacher.id === s.teacher.staffId)).toEqual([
          {
            teacher: { id: s.teacher.staffId, name: expect.any(String) as string },
            held: 3,
            notStarted: 0,
            inProgress: third === 'in_progress' ? 1 : 0,
            complete: third === 'in_progress' ? 1 : 2,
            lockedIncomplete: 1,
            noAttendance: 1,
            noTopic: 2,
            worksMissing: third === 'in_progress' ? 1 : 0,
            unplanned: 0,
            lateEntries: 0,
          },
        ]);
        const week = ok(
          await calls.get(
            `/api/timetable/views/class?classId=${s.classId}&date=2026-10-26&span=week`,
          ),
        ) as { lessons: { id: string; status: string | null }[] };
        expect(week.lessons.find((one) => one.id === s.third)?.status).toBe(third);
      });
    };
    await expectAll('in_progress');

    const filled = await as(owner, s.branch, teacherIn(s), async (calls) =>
      notGradedAnswerSchema.parse(
        ok(await calls.post(`/api/journal/lessons/${s.third}/not-graded`)),
      ),
    );
    expect(filled.filled).toEqual([{ studentId: s.boboyev, workId, version: 1 }]);
    expect(filled.skipped).toEqual([]);
    const cell = await t.database.migrator
      .selectFrom('journal_cells')
      .select(['not_graded', 'score', 'changed_how'])
      .where('lesson_id', '=', s.third)
      .where('student_id', '=', s.boboyev)
      .where('work_id', '=', workId)
      .executeTakeFirstOrThrow();
    expect(cell).toEqual({ not_graded: true, score: null, changed_how: 'entry' });
    const audit = await t.database.migrator
      .selectFrom('audit_log')
      .select(['action', 'record_id'])
      .where('action', '=', 'journal.not_graded')
      .where('record_id', '=', s.third)
      .execute();
    expect(audit).toHaveLength(1);
    await expectAll('complete');
    // The grid shows the cell "not graded" and the student's average leaves it out.
    await as(owner, s.branch, teacherIn(s), async (calls) => {
      const grid = await gridOf(calls, s);
      const at = grid.lessons.findIndex((one) => one.id === s.third);
      const row = grid.students.find((one) => one.id === s.boboyev);
      expect(row?.cells[at]?.works[0]).toMatchObject({ score: null, notGraded: true });
      expect(row?.quarter?.classwork).toBeNull();
      // Undo: the person's own last bulk action, given back as it was.
      const undone = undoneSchema.parse(
        ok(
          await calls.post(`/api/journal/lessons/${s.third}/undo`, {
            students: [{ studentId: s.boboyev, cells: [{ workId, version: 1 }] }],
          }),
        ),
      );
      expect(undone.undone).toHaveLength(1);
      expect(statusIn(await gridOf(calls, s), s.third)).toBe('in_progress');
    });
  });

  /** The third lesson with its classwork at a total of 5 and both students present; the work id. */
  async function presentWithWork(calls: Calls, s: Scene): Promise<string> {
    ok(
      await mark(calls, s.third, [
        { studentId: s.ahmedov, mark: 1 },
        { studentId: s.boboyev, mark: 1 },
      ]),
    );
    const grid = await gridOf(calls, s);
    const work = grid.lessons.find((one) => one.id === s.third)?.works[0];
    const stored = ok(
      await calls.put(`/api/journal/lessons/${s.third}/works/total`, {
        column: { planWorkId: work?.planWorkId ?? '', sourceLessonId: s.third },
        total: 5,
        version: null,
      }),
    ) as { id: string };
    return stored.id;
  }

  it('"Not graded": the undo skips a cell typed after the fill; a work marked "not held" leaves the status', async () => {
    const owner = await account();
    const s = await scene({ teacher: owner.account.id });
    await classworkAt(s, s.third);
    await as(owner, s.branch, teacherIn(s), async (calls) => {
      const workId = await presentWithWork(calls, s);
      const filled = notGradedAnswerSchema.parse(
        ok(await calls.post(`/api/journal/lessons/${s.third}/not-graded`)),
      );
      expect(filled.filled).toHaveLength(2);
      const ahmedov = filled.filled.find((one) => one.studentId === s.ahmedov);
      // Ahmedov's cell is typed after the fill (by the same teacher on another page).
      ok(
        await calls.post(`/api/journal/lessons/${s.third}/scores`, {
          saves: [
            { studentId: s.ahmedov, column: { workId }, score: 4, version: ahmedov?.version ?? 0 },
          ],
        }),
      );
      const undone = undoneSchema.parse(
        ok(
          await calls.post(`/api/journal/lessons/${s.third}/undo`, {
            students: filled.filled.map((one) => ({
              studentId: one.studentId,
              cells: [{ workId: one.workId, version: one.version }],
            })),
          }),
        ),
      );
      expect(undone.undone.map((one) => one.studentId)).toEqual([s.boboyev]);
      expect(undone.skipped).toEqual([{ studentId: s.ahmedov, workId, code: 'changed' }]);
      // "Not held": the work leaves the lesson's columns, attendance alone completes it.
      const current = (await gridOf(calls, s)).lessons.find((one) => one.id === s.third)?.works[0];
      ok(
        await calls.put(`/api/journal/lessons/${s.third}/works/not-held`, {
          column: { workId },
          notHeld: true,
          version: current?.version ?? null,
          confirm: true,
        }),
      );
      expect(statusIn(await gridOf(calls, s), s.third)).toBe('complete');
    });
  });

  it('"Not graded" as a correction of the Academic Vice Principal on a locked lesson: written as a correction', async () => {
    const owner = await account();
    const vice = await account();
    const s = await scene({ teacher: owner.account.id });
    await classworkAt(s, s.third);
    await as(owner, s.branch, teacherIn(s), (calls) => presentWithWork(calls, s));
    // After the lock of the 26th (00:00 on 3 November).
    await as(
      vice,
      s.branch,
      viceIn(s),
      async (calls) => {
        // Not the vice's lesson: only as a correction.
        expect(codeOf(await calls.post(`/api/journal/lessons/${s.third}/not-graded`))).toBe(
          'journal_entry_scope',
        );
        const filled = notGradedAnswerSchema.parse(
          ok(
            await calls.post(`/api/journal/lessons/${s.third}/not-graded`, {
              correction: { reason: 'The teacher left before grading' },
            }),
          ),
        );
        expect(filled.filled).toHaveLength(2);
      },
      '2026-11-04T12:00:00+05:00',
    );
    const how = await t.database.migrator
      .selectFrom('journal_cells')
      .select('changed_how')
      .where('lesson_id', '=', s.third)
      .where('not_graded', '=', true)
      .execute();
    expect(how.map((one) => one.changed_how)).toEqual(['correction', 'correction']);
  });

  it('"Not graded" and a save of the same cells at the same moment: each order gives its one outcome', async () => {
    const owner = await account();
    const s = await scene({ teacher: owner.account.id });
    await classworkAt(s, s.third);
    const workId = await as(owner, s.branch, teacherIn(s), async (calls) => {
      const id = await presentWithWork(calls, s);
      // Boboyev's cell typed and cleared: a stored empty cell (version 2) the two meet on.
      const typed = ok(
        await calls.post(`/api/journal/lessons/${s.third}/scores`, {
          saves: [{ studentId: s.boboyev, column: { workId: id }, score: 2, version: null }],
        }),
      ) as { cells: { version: number }[] };
      ok(
        await calls.post(`/api/journal/lessons/${s.third}/scores`, {
          saves: [
            {
              studentId: s.boboyev,
              column: { workId: id },
              score: null,
              version: typed.cells[0]?.version ?? 0,
            },
          ],
        }),
      );
      return id;
    });
    const cellId = (
      await t.database.migrator
        .selectFrom('journal_cells')
        .select('id')
        .where('work_id', '=', workId)
        .where('student_id', '=', s.boboyev)
        .executeTakeFirstOrThrow()
    ).id;
    /**
     * A transaction that holds Boboyev's cell after a write of its own, until released. Both
     * routes take the work `for update` before any cell (`writeScores`, and the fill since
     * code round 1 of #225), so the held side does too.
     */
    const holding = async (write: { score: number | null; notGraded: boolean }) => {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      t.clock.set(MOMENT);
      const done = t.app.get(Transactions).run([s.branch], async (transaction) => {
        await transaction
          .insertInto('audit_log')
          .values({ occurred_at: new Date(MOMENT), branch_id: s.branch, action: 'test.status' })
          .execute();
        await transaction
          .selectFrom('journal_works')
          .select('id')
          .where('id', '=', workId)
          .forUpdate()
          .execute();
        await transaction
          .updateTable('journal_cells')
          .set({
            score: write.score,
            not_graded: write.notGraded,
            changed_by: owner.account.id,
            changed_how: 'entry',
          })
          .where('id', '=', cellId)
          .execute();
        ready();
        await released;
      });
      await isReady;
      return { release, done };
    };
    const waitedOn = async () => {
      for (let tries = 0; tries < 400; tries += 1) {
        const found = await sql<{ n: number }>`
          select count(*)::int as n from pg_locks l join pg_stat_activity a on a.pid = l.pid
          where a.datname = current_database() and not l.granted
        `.execute(t.database.migrator);
        if ((found.rows[0]?.n ?? 0) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('Nothing waited on the cell.');
    };
    const started = <T>(work: () => Promise<T>) =>
      new Promise<T>((resolve, reject) => {
        work().then(resolve, reject);
      });
    try {
      // The save first (held after its write of a number): "not graded" waits on the work,
      // then reads the cell numbered, and fills only the other.
      const save = await holding({ score: 3, notGraded: false });
      const fill = started(() =>
        as(owner, s.branch, teacherIn(s), (calls) =>
          calls.post(`/api/journal/lessons/${s.third}/not-graded`),
        ),
      );
      await waitedOn();
      save.release();
      await save.done;
      const answer = notGradedAnswerSchema.parse(ok(await fill));
      expect(answer.skipped).toEqual([]);
      expect(answer.filled.map((one) => one.studentId)).toEqual([s.ahmedov]);
    } finally {
      t.clock.set(START);
    }
    // "Not graded" first (held after its write of the flag on a stored empty cell, as the route
    // writes it): a save of numbers sent in the other order, on the version it read, is stale.
    await as(owner, s.branch, teacherIn(s), async (calls) => {
      ok(
        await calls.post(`/api/journal/lessons/${s.third}/scores`, {
          saves: [
            {
              studentId: s.boboyev,
              column: { workId },
              score: null,
              version: (
                await t.database.migrator
                  .selectFrom('journal_cells')
                  .select('version')
                  .where('id', '=', cellId)
                  .executeTakeFirstOrThrow()
              ).version,
            },
          ],
        }),
      );
    });
    const version = (
      await t.database.migrator
        .selectFrom('journal_cells')
        .select('version')
        .where('id', '=', cellId)
        .executeTakeFirstOrThrow()
    ).version;
    try {
      const fill = await holding({ score: null, notGraded: true });
      const save = started(() =>
        as(owner, s.branch, teacherIn(s), (calls) =>
          calls.post(`/api/journal/lessons/${s.third}/scores`, {
            saves: [
              { studentId: s.boboyev, column: { workId }, score: 4, version },
              { studentId: s.ahmedov, column: { workId }, score: 4, version: null },
            ],
          }),
        ),
      );
      await waitedOn();
      fill.release();
      await fill.done;
      expect(codeOf(await save)).toBe('cell_stale');
    } finally {
      t.clock.set(START);
    }
  });

  it('counts the entries under the teacher’s own unlock and the works added by hand, a lesson still locked incomplete during its unlock, and filters by the subject’s department', async () => {
    const owner = await account();
    const vice = await account();
    const head = await account();
    const s = await scene({ teacher: owner.account.id });
    // A classwork added by hand at the 19th, which has no plan item, while it is open.
    await as(
      owner,
      s.branch,
      teacherIn(s),
      async (calls) => {
        ok(await mark(calls, s.second, [{ studentId: s.ahmedov, mark: 1 }]));
        ok(await calls.post(`/api/journal/lessons/${s.second}/works`, { kind: 'classwork' }));
      },
      '2026-10-20T12:00:00+05:00',
    );
    // The 12th is locked: an unlock of the teacher, approved for two days.
    const sent = (await as(owner, s.branch, teacherIn(s), async (calls) =>
      ok(
        await calls.post(`/api/journal/lessons/${s.first}/unlocks`, {
          reason: 'I was ill that week',
        }),
        201,
      ),
    )) as { id: string; version: number };
    await as(vice, s.branch, viceIn(s), async (calls) => {
      ok(
        await calls.post(`/api/journal/unlocks/${sent.id}/decide`, {
          decision: 'approve',
          days: 2,
          version: sent.version,
        }),
      );
    });
    await as(owner, s.branch, teacherIn(s), async (calls) => {
      expect(statusIn(await gridOf(calls, s), s.first)).toBe('locked_incomplete');
      ok(await mark(calls, s.first, [{ studentId: s.ahmedov, mark: 1 }]));
      expect(statusIn(await gridOf(calls, s), s.first)).toBe('locked_incomplete');
    });
    // A correction of the vice on the 19th counts against nobody.
    await as(vice, s.branch, viceIn(s), async (calls) => {
      ok(
        await calls.post(`/api/journal/lessons/${s.second}/attendance`, {
          saves: [{ studentId: s.boboyev, mark: 1, version: null }],
          correction: { reason: 'Entered on paper' },
        }),
      );
    });
    const steam = (
      await t.database.migrator
        .selectFrom('subjects')
        .select('department_id')
        .where('id', '=', s.subject)
        .executeTakeFirstOrThrow()
    ).department_id;
    const rowOf = (counts: Discipline) =>
      counts.teachers.find((one) => one.teacher.id === s.teacher.staffId);
    await as(vice, s.branch, viceIn(s), async (calls) => {
      const counts = disciplineSchema.parse(
        ok(
          await calls.get(
            `/api/journal/discipline?from=2026-10-12&to=2026-10-27&departmentId=${steam}`,
          ),
        ),
      );
      expect(rowOf(counts)).toMatchObject({ lateEntries: 1, unplanned: 1, lockedIncomplete: 2 });
      expect(counts.departments.map((one) => one.id)).toContain(steam);
    });
    // A Head Teacher of the subject sees the teacher; a department outside the subjects is 404.
    const tutors = (
      await t.database.migrator
        .selectFrom('departments')
        .select('id')
        .where('tutors', '=', true)
        .executeTakeFirstOrThrow()
    ).id;
    await as(
      head,
      s.branch,
      [{ role: 'head_teacher', branchId: s.branch, subjectIds: [s.subject] }],
      async (calls) => {
        const counts = disciplineSchema.parse(
          ok(await calls.get('/api/journal/discipline?from=2026-10-12&to=2026-10-27')),
        );
        expect(rowOf(counts)?.held).toBe(3);
        expect(
          codeOf(
            await calls.get(
              `/api/journal/discipline?from=2026-10-12&to=2026-10-27&departmentId=${tutors}`,
            ),
          ),
        ).toBe('not_found');
      },
    );
  });

  it('shows a Head Teacher of maths the maths lessons of a teacher who also teaches another subject, and not that subject', async () => {
    const owner = await account();
    const head = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id },
      secondSubject: true,
    });
    await as(
      head,
      s.branch,
      [{ role: 'head_teacher', branchId: s.branch, subjectIds: [s.subject] }],
      async (calls) => {
        const counts = disciplineSchema.parse(
          ok(await calls.get('/api/journal/discipline?from=2026-10-26&to=2026-10-26')),
        );
        expect(counts.teachers.find((one) => one.teacher.id === s.teacher.staffId)?.held).toBe(1);
      },
    );
  });

  it('lists the rating reminder with only the members who have no entry', async () => {
    const owner = await account();
    const s = await scene({ teacher: owner.account.id }, true);
    await as(owner, s.branch, teacherIn(s), async (calls) => {
      ok(
        await calls.put(`/api/journal/journals/${s.journal}/rating/${s.q1}/date`, {
          date: '2026-10-26',
          version: null,
        }),
      );
      ok(
        await calls.post(`/api/journal/journals/${s.journal}/rating/${s.q1}/entries`, {
          studentId: s.ahmedov,
          entry: { kind: 'score', score: 70 },
          reason: null,
          version: null,
        }),
      );
      const own = remindersSchema.parse(ok(await calls.get('/api/journal/reminders')));
      expect(
        own.reminders.flatMap((one) => (one.kind === 'rating_missing' ? [one.count] : [])),
      ).toEqual([1]);
    });
  });

  it('keeps "not graded" through a forced delete of the lesson and its restore, and the status with it', async () => {
    const owner = await account();
    const admin = await account();
    const s = await scene({ teacher: owner.account.id });
    await classworkAt(s, s.third);
    const workId = await as(owner, s.branch, teacherIn(s), async (calls) => {
      ok(
        await mark(calls, s.third, [
          { studentId: s.ahmedov, mark: 1 },
          { studentId: s.boboyev, mark: 1 },
        ]),
      );
      const grid = await gridOf(calls, s);
      const work = grid.lessons.find((one) => one.id === s.third)?.works[0];
      const stored = ok(
        await calls.put(`/api/journal/lessons/${s.third}/works/total`, {
          column: { planWorkId: work?.planWorkId ?? '', sourceLessonId: s.third },
          total: 5,
          version: null,
        }),
      ) as { id: string };
      ok(await calls.post(`/api/journal/lessons/${s.third}/not-graded`));
      expect(statusIn(await gridOf(calls, s), s.third)).toBe('complete');
      return stored.id;
    });
    const store = await as(admin, s.branch, [{ role: 'super_admin' }], async (calls) => {
      ok(
        await calls.post(`/api/timetable/lessons/${s.third}/forced-delete`, {
          reason: 'Entered for the wrong class',
        }),
      );
      const found = await t.database.migrator
        .selectFrom('forced_deletes')
        .select('id')
        .where('record_id', '=', s.third)
        .executeTakeFirstOrThrow();
      ok(await calls.post(`/api/forced-deletes/${found.id}/restore`));
      return found.id;
    });
    void store;
    const cells = await t.database.migrator
      .selectFrom('journal_cells')
      .select(['student_id', 'not_graded'])
      .where('work_id', '=', workId)
      .orderBy('student_id')
      .execute();
    expect(cells.map((one) => one.not_graded)).toEqual([true, true]);
    await as(owner, s.branch, teacherIn(s), async (calls) => {
      expect(statusIn(await gridOf(calls, s), s.third)).toBe('complete');
    });
  });

  it('"Not graded" refuses a work with no total, a locked lesson without an unlock, another teacher, and ids it does not know; a typed number and a clear end it', async () => {
    const owner = await account();
    const stranger = await account();
    const otherOwner = await account();
    const s = await scene({ teacher: owner.account.id, spare: stranger.account.id });
    const other = await scene({ teacher: otherOwner.account.id });
    await classworkAt(s, s.third);
    await classworkAt(other, other.third);
    // Another branch's work, with a total and both students present: a fill would write it.
    const otherWork = await as(otherOwner, other.branch, teacherIn(other), (calls) =>
      presentWithWork(calls, other),
    );
    /** Every row of the tables the route writes, in both branches, and the audit log. */
    const rowsOf = async () => ({
      cells: await t.database.migrator
        .selectFrom('journal_cells')
        .selectAll()
        .orderBy('id')
        .execute(),
      history: await t.database.migrator
        .selectFrom('journal_cell_history')
        .selectAll()
        .orderBy('id')
        .execute(),
      audit: await t.database.migrator.selectFrom('audit_log').selectAll().orderBy('id').execute(),
    });
    await as(owner, s.branch, teacherIn(s), async (calls) => {
      ok(
        await mark(calls, s.third, [
          { studentId: s.ahmedov, mark: 1 },
          { studentId: s.boboyev, mark: 1 },
        ]),
      );
      const grid = await gridOf(calls, s);
      const work = grid.lessons.find((one) => one.id === s.third)?.works[0];
      // The planned column has no row yet: nothing to name, nothing filled.
      const none = notGradedAnswerSchema.parse(
        ok(await calls.post(`/api/journal/lessons/${s.third}/not-graded`)),
      );
      expect(none).toEqual({ filled: [], skipped: [] });
      const total = ok(
        await request(t.kit.server)
          .put(`/api/journal/lessons/${s.third}/works/total`)
          .set('Cookie', owner.cookie)
          .set(BRANCH_HEADER, s.branch)
          .send({
            column: { planWorkId: work?.planWorkId ?? '', sourceLessonId: s.third },
            total: 5,
            version: null,
          }),
      ) as { id: string };
      // The 19th is locked now, and takes no "not graded" without an unlock.
      expect(codeOf(await calls.post(`/api/journal/lessons/${s.second}/not-graded`))).toBe(
        'journal_locked',
      );
      // Another branch's and an unknown id, in the path and in `workIds`: 404, with the cells
      // of both branches (the third's both waiting for a fill), their history and the log unchanged.
      const before = await rowsOf();
      expect(codeOf(await calls.post(`/api/journal/lessons/${randomUUID()}/not-graded`))).toBe(
        'not_found',
      );
      expect(codeOf(await calls.post(`/api/journal/lessons/${other.third}/not-graded`))).toBe(
        'not_found',
      );
      for (const workId of [randomUUID(), otherWork]) {
        expect(
          codeOf(
            await calls.post(`/api/journal/lessons/${s.third}/not-graded`, { workIds: [workId] }),
          ),
        ).toBe('not_found');
        expect(
          codeOf(
            await calls.post(`/api/journal/lessons/${s.third}/not-graded`, {
              workIds: [total.id, workId],
            }),
          ),
        ).toBe('not_found');
      }
      expect(await rowsOf()).toEqual(before);
      const filled = notGradedAnswerSchema.parse(
        ok(await calls.post(`/api/journal/lessons/${s.third}/not-graded`, { workIds: [total.id] })),
      );
      expect(filled.filled.map((one) => one.studentId).sort()).toEqual(
        [s.ahmedov, s.boboyev].sort(),
      );
      // A typed number ends it; a person's clear makes the cell empty again.
      const version = filled.filled.find((one) => one.studentId === s.ahmedov)?.version ?? 0;
      ok(
        await calls.post(`/api/journal/lessons/${s.third}/scores`, {
          saves: [{ studentId: s.ahmedov, column: { workId: total.id }, score: 4, version }],
        }),
      );
      const other2 = filled.filled.find((one) => one.studentId === s.boboyev)?.version ?? 0;
      ok(
        await calls.post(`/api/journal/lessons/${s.third}/scores`, {
          saves: [
            { studentId: s.boboyev, column: { workId: total.id }, score: null, version: other2 },
          ],
        }),
      );
      const cells = await t.database.migrator
        .selectFrom('journal_cells')
        .select(['student_id', 'score', 'not_graded'])
        .where('work_id', '=', total.id)
        .orderBy('student_id')
        .execute();
      expect(cells.map((one) => [one.student_id, one.score, one.not_graded])).toEqual(
        [
          [s.ahmedov, 4, false],
          [s.boboyev, null, false],
        ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      );
    });
    // A hand-added work with no total, at the 19th while it is open: named, it is refused.
    await as(
      owner,
      s.branch,
      teacherIn(s),
      async (calls) => {
        ok(await mark(calls, s.second, [{ studentId: s.ahmedov, mark: 1 }]));
        const added = ok(
          await calls.post(`/api/journal/lessons/${s.second}/works`, { kind: 'classwork' }),
        ) as { id: string };
        expect(
          codeOf(
            await calls.post(`/api/journal/lessons/${s.second}/not-graded`, {
              workIds: [added.id],
            }),
          ),
        ).toBe('work_total_missing');
      },
      '2026-10-20T12:00:00+05:00',
    );
    await as(stranger, s.branch, teacherIn(s), async (calls) => {
      expect(codeOf(await calls.post(`/api/journal/lessons/${s.third}/not-graded`))).toBe(
        'journal_entry_scope',
      );
    });
  });

  /**
   * "Not graded" against a save of numbers sent in the other order, the real routes in a
   * fixed order (`inOrderOnLesson`): both take the lesson `for share`, so the hold is a row
   * both lock `for update`. The fill first: `ahead`'s cell, which the fill reaches after the
   * work; the save first: the work, which both now take before any cell.
   */
  async function fillAgainstSave(first: 'fill' | 'save') {
    const owner = await account();
    const s = await scene({ teacher: owner.account.id });
    await classworkAt(s, s.third);
    const workId = await as(owner, s.branch, teacherIn(s), async (calls) => {
      ok(
        await mark(calls, s.third, [
          { studentId: s.ahmedov, mark: 1 },
          { studentId: s.boboyev, mark: 1 },
        ]),
      );
      const grid = await gridOf(calls, s);
      const work = grid.lessons.find((one) => one.id === s.third)?.works[0];
      return (
        ok(
          await request(t.kit.server)
            .put(`/api/journal/lessons/${s.third}/works/total`)
            .set('Cookie', owner.cookie)
            .set(BRANCH_HEADER, s.branch)
            .send({
              column: { planWorkId: work?.planWorkId ?? '', sourceLessonId: s.third },
              total: 5,
              version: null,
            }),
        ) as { id: string }
      ).id;
    });
    const [ahead, behind] = [s.ahmedov, s.boboyev].sort();
    if (ahead === undefined || behind === undefined) throw new Error('Two students.');
    // Both cells typed and cleared: stored rows the fill fills (version 2), so that one of
    // them can be held.
    const cleared = await as(owner, s.branch, teacherIn(s), async (calls) => {
      for (const score of [4, null]) {
        ok(
          await calls.post(`/api/journal/lessons/${s.third}/scores`, {
            saves: [ahead, behind].map((studentId) => ({
              studentId,
              column: { workId },
              score,
              version: score === null ? 1 : null,
            })),
          }),
        );
      }
      return t.database.migrator
        .selectFrom('journal_cells')
        .select(['id', 'student_id', 'version', 'score'])
        .where('work_id', '=', workId)
        .execute();
    });
    const held = cleared.find((one) => one.student_id === ahead);
    expect(cleared.map((one) => [one.version, one.score])).toEqual([
      [2, null],
      [2, null],
    ]);
    t.clock.set(MOMENT);
    try {
      const fill = () =>
        t
          .post(`/api/journal/lessons/${s.third}/not-graded`, s.branch, {}, owner.cookie)
          .set(REQUEST_KEY_HEADER, randomUUID())
          .then((response) => response);
      const save = () =>
        t
          .post(
            `/api/journal/lessons/${s.third}/scores`,
            s.branch,
            {
              saves: [
                { studentId: behind, column: { workId }, score: 3, version: 2 },
                { studentId: ahead, column: { workId }, score: 2, version: 2 },
              ],
            },
            owner.cookie,
          )
          .set(REQUEST_KEY_HEADER, randomUUID())
          .then((response) => response);
      const shared = {
        app: t.app,
        migrator: t.database.migrator,
        branchId: s.branch,
        lessonId: s.third,
      };
      const cells = () =>
        t.database.migrator
          .selectFrom('journal_cells')
          .select(['student_id', 'score', 'not_graded'])
          .where('work_id', '=', workId)
          .orderBy('student_id')
          .execute();
      if (first === 'fill') {
        const [graded, saved] = await inOrderOnLesson({
          ...shared,
          row: { table: 'journal_cells', id: held?.id ?? '' },
          first: fill,
          second: save,
        });
        // The fill writes both cells; the save, sent with the versions it read before the
        // fill, is stale.
        const answer = notGradedAnswerSchema.parse(ok(graded as Response));
        expect(answer.filled.map((one) => one.studentId)).toEqual([ahead, behind]);
        expect(answer.skipped).toEqual([]);
        expect(codeOf(saved as Response)).toBe('cell_stale');
        expect(await cells()).toEqual([
          { student_id: ahead, score: null, not_graded: true },
          { student_id: behind, score: null, not_graded: true },
        ]);
      } else {
        const [saved, graded] = await inOrderOnLesson({
          ...shared,
          row: { table: 'journal_works', id: workId },
          first: save,
          second: fill,
        });
        // The save writes both numbers; the fill, reading after it, finds nothing to fill.
        ok(saved as Response);
        expect(notGradedAnswerSchema.parse(ok(graded as Response))).toEqual({
          filled: [],
          skipped: [],
        });
        expect(await cells()).toEqual([
          { student_id: ahead, score: 2, not_graded: false },
          { student_id: behind, score: 3, not_graded: false },
        ]);
      }
    } finally {
      t.clock.set(START);
    }
  }

  it('"Not graded" first against a save of numbers sent in the other order: the save waits and is stale, never a deadlock', async () => {
    await fillAgainstSave('fill');
  });

  it('a save of numbers first against "Not graded": the fill waits and finds nothing to fill, never a deadlock', async () => {
    await fillAgainstSave('save');
  });

  it('lists a lesson about to lock 48 hours before its lock, not before, also in the next quarter', async () => {
    const owner = await account();
    const s = await scene({ teacher: owner.account.id });
    // The 26th locks at 00:00 on 3 November (7 edit days).
    const aboutToLock = (moment: string) =>
      as(
        owner,
        s.branch,
        teacherIn(s),
        async (calls) =>
          remindersSchema
            .parse(ok(await calls.get('/api/journal/reminders')))
            .reminders.filter((one) => one.kind === 'about_to_lock')
            .map((one) => (one.kind === 'rating_missing' ? '' : one.lesson.id)),
        moment,
      );
    expect(await aboutToLock('2026-10-31T23:59:00+05:00')).toEqual([]);
    expect(await aboutToLock('2026-11-01T00:00:00+05:00')).toEqual([s.third]);
    // Quarter 1 ended on 31 October: the lesson still locks in quarter 2, and is listed there.
    expect(await aboutToLock('2026-11-02T08:00:00+05:00')).toEqual([s.third]);
  });

  it('lists missing rating exam scores in the last 14 days of the quarter only, leaving out the entered ones', async () => {
    const owner = await account();
    const s = await scene({ teacher: owner.account.id }, true);
    const rated = (moment: string) =>
      as(
        owner,
        s.branch,
        teacherIn(s),
        async (calls) =>
          remindersSchema
            .parse(ok(await calls.get('/api/journal/reminders')))
            .reminders.flatMap((one) => (one.kind === 'rating_missing' ? [one.count] : [])),
        moment,
      );
    // Quarter 1 ends on 31 October: its last 14 days start on the 18th.
    expect(await rated('2026-10-17T12:00:00+05:00')).toEqual([]);
    expect(await rated('2026-10-18T12:00:00+05:00')).toEqual([2]);
  });

  it('counts a substituted lesson for the substitute, not the teacher', async () => {
    const owner = await account();
    const spare = await account();
    const vice = await account();
    const s = await scene({ teacher: owner.account.id, spare: spare.account.id });
    // The 26th taken by the spare teacher, as a substitution in force (0101).
    await t.database.migrator
      .updateTable('lessons')
      .set({ teacher_id: s.spareTeacher.staffId })
      .where('id', '=', s.third)
      .execute();
    const lesson = await t.database.migrator
      .selectFrom('lessons')
      .selectAll()
      .where('id', '=', s.third)
      .executeTakeFirstOrThrow();
    const record = await t.database.migrator
      .insertInto('substitutions')
      .values({
        branch_id: s.branch,
        source: 'lesson',
        replaced_id: s.teacher.staffId,
        substitute_id: s.spareTeacher.staffId,
        relaxed: false,
        reason: 'The teacher was ill',
        made_at: new Date('2026-10-20T12:00:00+05:00'),
        made_by: vice.account.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.database.migrator
      .insertInto('substitution_lessons')
      .values({
        substitution_id: record.id,
        branch_id: s.branch,
        lesson_id: s.third,
        lesson_date: lesson.lesson_date,
        relaxed: false,
        class_id: lesson.class_id,
        group_id: lesson.group_id,
        subject_id: lesson.subject_id,
        load_row_id: lesson.load_row_id,
        pattern_entry_id: lesson.pattern_entry_id,
        pattern_date: lesson.lesson_date,
        starts_at: lesson.starts_at,
        ends_at: lesson.ends_at,
      })
      .execute();
    await as(vice, s.branch, viceIn(s), async (calls) => {
      const counts = disciplineSchema.parse(
        ok(await calls.get('/api/journal/discipline?from=2026-10-26&to=2026-10-26')),
      );
      // The other class's lesson that day counts for its own teacher.
      expect(counts.teachers.map((one) => [one.teacher.id, one.held]).sort()).toEqual(
        [
          [s.spareTeacher.staffId, 1],
          [s.otherTeacher.staffId, 1],
        ].sort(),
      );
    });
    const ids = async (browser: Browser) =>
      as(browser, s.branch, teacherIn(s), async (calls) =>
        remindersSchema
          .parse(ok(await calls.get('/api/journal/reminders')))
          .reminders.flatMap((one) => (one.kind === 'rating_missing' ? [] : [one.lesson.id])),
      );
    expect(await ids(spare)).toContain(s.third);
    expect(await ids(owner)).not.toContain(s.third);
  });

  it('lists the lessons of a vacancy’s journal for nobody, and for the acting teacher while a period names them', async () => {
    const owner = await account();
    const spare = await account();
    const vice = await account();
    const s = await scene({ teacher: owner.account.id, spare: spare.account.id });
    // A version published from the 19th names a vacancy for the class: the 12th stays the
    // teacher's; from the 19th the journal's owner is the vacancy's acting teacher, or nobody.
    // The dated lessons keep their teacher, as a publish leaves lessons already dated.
    const vacancy = await load.vacancy(s.branch, {
      subjects: [{ subject: s.subject, grades: [7] }],
    });
    const version = await load.version(s.branch, s.year, { startsOn: '2026-10-19' });
    await load.row({
      branch_id: s.branch,
      version_id: version,
      class_id: s.classId,
      subject_id: s.subject,
      teacher_id: vacancy,
      lessons_per_week: 1,
    });
    await load.row({
      branch_id: s.branch,
      version_id: version,
      class_id: s.otherClass,
      subject_id: s.subject,
      teacher_id: s.otherTeacher.staffId,
      lessons_per_week: 1,
    });
    await load.setVersion(version, 'published');
    const ids = async (browser: Browser) =>
      as(browser, s.branch, teacherIn(s), async (calls) =>
        remindersSchema
          .parse(ok(await calls.get('/api/journal/reminders')))
          .reminders.flatMap((one) => (one.kind === 'rating_missing' ? [] : [one.lesson.id])),
      );
    const held = async () =>
      as(vice, s.branch, viceIn(s), async (calls) =>
        disciplineSchema
          .parse(ok(await calls.get('/api/journal/discipline?from=2026-10-12&to=2026-10-26')))
          .teachers.map((one) => [one.teacher.id, one.held])
          .sort(),
      );
    /** The class's three lessons in a list of reminders. */
    const ofClass = (list: string[]) =>
      [s.first, s.second, s.third].filter((lesson) => list.includes(lesson));
    // The owner is `none` on the 19th and the 26th: nobody counts them, the teacher whose
    // id the lessons still carry included.
    expect(ofClass(await ids(owner))).toEqual([s.first]);
    expect(ofClass(await ids(spare))).toEqual([]);
    expect(await held()).toEqual(
      [
        [s.otherTeacher.staffId, 3],
        [s.teacher.staffId, 1],
      ].sort(),
    );
    // The spare teacher acts for the vacancy until the 19th included: the 19th is theirs; the
    // 26th is nobody's, though the period makes it a candidate of their reminders.
    const period = await t.database.migrator
      .insertInto('journal_acting_teachers')
      .values({
        branch_id: s.branch,
        journal_id: s.journal,
        vacancy_id: vacancy,
        person_id: s.spareTeacher.staffId,
        valid_from: '2026-10-19',
        valid_until: '2026-10-20',
        given_by: vice.account.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    expect(ofClass(await ids(spare))).toEqual([s.second]);
    expect(ofClass(await ids(owner))).toEqual([s.first]);
    expect(await held()).toEqual(
      [
        [s.otherTeacher.staffId, 3],
        [s.spareTeacher.staffId, 1],
        [s.teacher.staffId, 1],
      ].sort(),
    );
    // With no end, the 19th and the 26th are the acting teacher's.
    await t.database.migrator
      .updateTable('journal_acting_teachers')
      .set({ valid_until: null })
      .where('id', '=', period.id)
      .execute();
    expect(ofClass(await ids(spare))).toEqual([s.second, s.third]);
    expect(ofClass(await ids(owner))).toEqual([s.first]);
    expect(await held()).toEqual(
      [
        [s.otherTeacher.staffId, 3],
        [s.spareTeacher.staffId, 2],
        [s.teacher.staffId, 1],
      ].sort(),
    );
  });

  it('refuses a range of more than 92 days or outside one year, and an unknown department; a Head Teacher of another subject sees nobody', async () => {
    const vice = await account();
    const head = await account();
    const s = await scene();
    await as(vice, s.branch, viceIn(s), async (calls) => {
      expect(codeOf(await calls.get('/api/journal/discipline?from=2026-09-01&to=2026-12-02'))).toBe(
        'discipline_range',
      );
      ok(await calls.get('/api/journal/discipline?from=2026-09-01&to=2026-12-01'));
      expect(codeOf(await calls.get('/api/journal/discipline?from=2027-05-20&to=2027-06-02'))).toBe(
        'discipline_range',
      );
      expect(
        codeOf(
          await calls.get(
            `/api/journal/discipline?from=2026-10-01&to=2026-10-31&departmentId=${randomUUID()}`,
          ),
        ),
      ).toBe('not_found');
    });
    const otherSubject = await load.classes.subject({ grades: [7], journalType: 'graded' });
    await as(
      head,
      s.branch,
      [{ role: 'head_teacher', branchId: s.branch, subjectIds: [otherSubject] }],
      async (calls) => {
        const counts = disciplineSchema.parse(
          ok(await calls.get('/api/journal/discipline?from=2026-10-12&to=2026-10-27')),
        );
        expect(counts.teachers).toEqual([]);
      },
    );
  });

  it('gives the Head Tutor the lessons of the Tutor subjects only, also of a Tutor who teaches another department', async () => {
    const owner = await account();
    const headTutor = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id },
      secondSubject: true,
    });
    // The scene's maths moved into the Tutors department (0055): the teacher's second
    // subject stays in STEAM.
    const tutors = await t.database.migrator
      .selectFrom('departments')
      .select('id')
      .where('tutors', '=', true)
      .executeTakeFirstOrThrow();
    await t.database.migrator
      .updateTable('subjects')
      .set({ department_id: tutors.id })
      .where('id', '=', s.subject)
      .execute();
    await as(headTutor, s.branch, [{ role: 'head_tutor', branchId: s.branch }], async (calls) => {
      const counts = disciplineSchema.parse(
        ok(await calls.get('/api/journal/discipline?from=2026-10-26&to=2026-10-26')),
      );
      // Maths of both classes (the teacher's and the other teacher's), not the second subject.
      const teacher = counts.teachers.find((one) => one.teacher.id === s.teacher.staffId);
      expect(teacher?.held).toBe(1);
      expect(counts.teachers.map((one) => one.teacher.id).sort()).toEqual(
        [s.teacher.staffId, s.otherTeacher.staffId].sort(),
      );
    });
  });

  it('gives the Senior Head Teacher the teachers of own subjects in a branch without an appointment there, not those of another subject', async () => {
    const owner = await account();
    const senior = await account();
    const otherSenior = await account();
    // The teacher has maths in the class and the second subject in the other class; the
    // other teacher has maths in the other class.
    const s = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id },
      secondSubject: true,
    });
    const second = s.secondSubject;
    if (second === null) throw new Error('The scene has a second subject.');
    const teachersOf = async (browser: Browser, subjectIds: string[]) =>
      as(
        browser,
        s.branch,
        // A Senior Head Teacher's subjects hold in every branch: no branch on the assignment.
        [{ role: 'senior_head_teacher', subjectIds }],
        async (calls) =>
          disciplineSchema
            .parse(ok(await calls.get('/api/journal/discipline?from=2026-10-26&to=2026-10-26')))
            .teachers.map((one) => [one.teacher.id, one.held])
            .sort(),
      );
    expect(await teachersOf(senior, [second])).toEqual([[s.teacher.staffId, 1]]);
    expect(await teachersOf(otherSenior, [s.subject])).toEqual(
      [
        [s.teacher.staffId, 1],
        [s.otherTeacher.staffId, 1],
      ].sort(),
    );
  });

  it('lets the teacher type into an optional cell of a locked lesson until its end, as a late entry, and leaves it out of the status (From 8.6)', async () => {
    const owner = await account();
    const s = await scene({ teacher: owner.account.id });
    const late = await student(s.branch, s.otherClass, 'Davronov');
    // The 12th marked for the class's two students while it was open.
    await as(
      owner,
      s.branch,
      teacherIn(s),
      (calls) =>
        mark(calls, s.first, [
          { studentId: s.ahmedov, mark: 1 },
          { studentId: s.boboyev, mark: 1 },
        ]),
      '2026-10-12T12:00:00+05:00',
    );
    // Recorded on the 27th from the 12th: the held lessons of the new class open as optional.
    const vice = await account();
    await as(vice, s.branch, viceIn(s), async (calls) => {
      const detail = ok(await calls.get(`/api/people/students/${late}`)) as { version: number };
      ok(
        await calls.post('/api/classes/transfers', {
          studentId: late,
          version: detail.version,
          toClassId: s.classId,
          from: '2026-10-12',
        }),
      );
    });
    await as(owner, s.branch, teacherIn(s), async (calls) => {
      const grid = await gridOf(calls, s);
      // The optional cell, empty, is not waited for: the 12th is complete and not reminded.
      expect(statusIn(grid, s.first)).toBe('complete');
      const own = remindersSchema.parse(ok(await calls.get('/api/journal/reminders')));
      expect(
        own.reminders.some((one) => one.kind === 'no_attendance' && one.lesson.id === s.first),
      ).toBe(false);
      const at = grid.lessons.findIndex((one) => one.id === s.first);
      const row = grid.students.find((one) => one.id === late);
      expect(row?.cells[at]?.open).toBe(true);
      expect(grid.students.find((one) => one.id === s.ahmedov)?.cells[at]?.open).toBe(false);
      // The 12th is locked: the optional cell takes the mark, another cell does not.
      ok(await mark(calls, s.first, [{ studentId: late, mark: 1 }]));
      expect(codeOf(await mark(calls, s.first, [{ studentId: s.ahmedov, mark: 2 }]))).toBe(
        'journal_locked',
      );
      const cell = await t.database.migrator
        .selectFrom('journal_cells')
        .select('changed_how')
        .where('lesson_id', '=', s.first)
        .where('student_id', '=', late)
        .executeTakeFirstOrThrow();
      expect(cell.changed_how).toBe('late_entry');
      // Filled, it changes nothing either.
      expect(statusIn(await gridOf(calls, s), s.first)).toBe('complete');
    });
    // The late entry is in the history, made under no unlock: the counts leave it out.
    const lines = await t.database.migrator
      .selectFrom('journal_cell_history')
      .select(['changed_how', 'unlock_id'])
      .where('lesson_id', '=', s.first)
      .where('student_id', '=', late)
      .execute();
    expect(lines).toEqual([{ changed_how: 'late_entry', unlock_id: null }]);
    await as(vice, s.branch, viceIn(s), async (calls) => {
      const counts = disciplineSchema.parse(
        ok(await calls.get('/api/journal/discipline?from=2026-10-12&to=2026-10-12')),
      );
      expect(counts.teachers.find((one) => one.teacher.id === s.teacher.staffId)).toMatchObject({
        held: 1,
        complete: 1,
        lateEntries: 0,
      });
    });
    await as(
      owner,
      s.branch,
      teacherIn(s),
      async (calls) => {
        expect(codeOf(await mark(calls, s.second, [{ studentId: late, mark: 1 }]))).toBe(
          'journal_locked',
        );
      },
      '2026-11-04T00:00:00+05:00',
    );
  });

  /** A status of a staff record from a day on, ending the open one (as the status routes do). */
  const statusFrom = async (staffId: string, status: 'left' | 'inactive', from: string) => {
    await t.database.migrator
      .updateTable('staff_statuses')
      .set({ valid_until: from })
      .where('staff_id', '=', staffId)
      .where('valid_until', 'is', null)
      .execute();
    await t.database.migrator
      .insertInto('staff_statuses')
      .values({ staff_id: staffId, status, valid_from: from })
      .execute();
  };

  describe('orphan lessons', () => {
    /** The scene's teacher left the school from the 27th. */
    const left = async (s: Scene) => statusFrom(s.teacher.staffId, 'left', '2026-10-27');

    it('lists the incomplete lessons of a teacher who left; the Academic Vice Principal assigns a teacher, who enters them after the lock as a late entry not counted against anyone; a withdraw ends it', async () => {
      const owner = await account();
      const vice = await account();
      const helper = await account();
      const s = await scene({ teacher: owner.account.id, spare: helper.account.id });
      // The 19th complete (no works), the 12th and the 26th left empty.
      await as(
        owner,
        s.branch,
        teacherIn(s),
        (calls) =>
          mark(calls, s.second, [
            { studentId: s.ahmedov, mark: 1 },
            { studentId: s.boboyev, mark: 1 },
          ]),
        '2026-10-19T12:00:00+05:00',
      );
      await left(s);
      const listed = await as(vice, s.branch, viceIn(s), async (calls) =>
        orphanLessonsSchema.parse(ok(await calls.get('/api/journal/orphans'))),
      );
      expect(
        listed.lessons.map((one) => [one.lesson.id, one.lesson.status, one.teacher.id]),
      ).toEqual([
        [s.first, 'locked_incomplete', s.teacher.staffId],
        [s.third, 'not_started', s.teacher.staffId],
      ]);
      expect(listed.teachers.map((one) => one.id)).toContain(s.spareTeacher.staffId);
      expect(listed.teachers.map((one) => one.id)).not.toContain(s.teacher.staffId);
      // Before the assignment the helper enters nothing.
      await as(helper, s.branch, teacherIn(s), async (calls) => {
        expect(codeOf(await mark(calls, s.first, [{ studentId: s.ahmedov, mark: 1 }]))).toBe(
          'journal_entry_scope',
        );
      });
      expect(
        codeOf(
          await as(vice, s.branch, viceIn(s), (calls) =>
            calls.post(`/api/journal/orphans/${s.second}/assign`, {
              staffId: s.spareTeacher.staffId,
              days: 2,
              reason: 'Completes the lessons',
            }),
          ),
        ),
      ).toBe('orphan_not_orphan');
      const assignment = await as(vice, s.branch, viceIn(s), async (calls) =>
        orphanAssignmentSchema.parse(
          ok(
            await calls.post(`/api/journal/orphans/${s.first}/assign`, {
              staffId: s.spareTeacher.staffId,
              days: 2,
              reason: 'Completes the lessons',
            }),
          ),
        ),
      );
      expect(assignment.openUntil).toBe(new Date('2026-10-30T00:00:00+05:00').toISOString());
      await as(helper, s.branch, teacherIn(s), async (calls) => {
        ok(
          await mark(calls, s.first, [
            { studentId: s.ahmedov, mark: 1 },
            { studentId: s.boboyev, mark: 2 },
          ]),
        );
        // Only the lesson assigned: the 26th stays the left teacher's.
        expect(codeOf(await mark(calls, s.third, [{ studentId: s.ahmedov, mark: 1 }]))).toBe(
          'journal_entry_scope',
        );
        // The grid shows the assignee the assigned lesson, enterable, and no other of the journal;
        // the reminders name it.
        const grid = await gridOf(calls, s);
        expect(grid.lessons.map((one) => [one.id, one.canEnter])).toEqual([[s.first, true]]);
        const own = remindersSchema.parse(ok(await calls.get('/api/journal/reminders')));
        expect(
          own.reminders.some((one) => one.kind !== 'rating_missing' && one.lesson.id === s.first),
        ).toBe(true);
      });
      const line = await t.database.migrator
        .selectFrom('journal_cell_history')
        .select(['changed_how', 'unlock_id', 'orphan_assignment_id'])
        .where('lesson_id', '=', s.first)
        .where('student_id', '=', s.ahmedov)
        .executeTakeFirstOrThrow();
      expect(line).toEqual({
        changed_how: 'late_entry',
        unlock_id: null,
        orphan_assignment_id: assignment.id,
      });
      await as(vice, s.branch, viceIn(s), async (calls) => {
        const counts = disciplineSchema.parse(
          ok(await calls.get('/api/journal/discipline?from=2026-10-12&to=2026-10-27')),
        );
        expect(counts.teachers.every((one) => one.lateEntries === 0)).toBe(true);
        const after = orphanLessonsSchema.parse(ok(await calls.get('/api/journal/orphans')));
        expect(after.lessons.map((one) => one.lesson.id)).toEqual([s.third]);
      });
      // The assignment ends at its open_until, and with a withdraw.
      await as(
        helper,
        s.branch,
        teacherIn(s),
        async (calls) => {
          expect(
            codeOf(
              await calls.post(`/api/journal/lessons/${s.first}/attendance`, {
                saves: [{ studentId: s.ahmedov, mark: 2, version: 1 }],
              }),
            ),
          ).toBe('journal_entry_scope');
        },
        '2026-10-30T00:00:00+05:00',
      );
      await as(vice, s.branch, viceIn(s), async (calls) => {
        const again = orphanAssignmentSchema.parse(
          ok(
            await calls.post(`/api/journal/orphans/${s.third}/assign`, {
              staffId: s.spareTeacher.staffId,
              days: 7,
              reason: 'Completes the lesson',
            }),
          ),
        );
        ok(await calls.post(`/api/journal/orphans/assignments/${again.id}/withdraw`), 204);
        ok(await calls.post(`/api/journal/orphans/assignments/${assignment.id}/withdraw`), 204);
        expect(
          codeOf(await calls.post(`/api/journal/orphans/assignments/${assignment.id}/withdraw`)),
        ).toBe('orphan_assignment_withdrawn');
      });
      // A withdrawn assignment, its open_until still ahead, lets the helper enter nothing,
      // and its lesson leaves the helper's reminders.
      await as(helper, s.branch, teacherIn(s), async (calls) => {
        expect(codeOf(await mark(calls, s.third, [{ studentId: s.ahmedov, mark: 1 }]))).toBe(
          'journal_entry_scope',
        );
        const own = remindersSchema.parse(ok(await calls.get('/api/journal/reminders')));
        expect(own.reminders).toEqual([]);
      });
    });

    it('refuses an inactive teacher and the caller’s own staff record, lists no orphan lesson of another branch, and answers 404 for a lesson, a staff record or an assignment of another branch or unknown, leaving every row of both branches as it was', async () => {
      const vice = await account();
      const otherVice = await account();
      const helper = await account();
      const s = await scene({ spare: helper.account.id });
      const other = await scene();
      await left(s);
      await left(other);
      await statusFrom(s.otherTeacher.staffId, 'inactive', '2026-10-20');
      // An open assignment in each branch, so a wrong withdraw would show.
      const open = await as(vice, s.branch, viceIn(s), async (calls) =>
        orphanAssignmentSchema.parse(
          ok(
            await calls.post(`/api/journal/orphans/${s.third}/assign`, {
              staffId: s.spareTeacher.staffId,
              days: 3,
              reason: 'Completes the lesson',
            }),
          ),
        ),
      );
      const foreign = await as(
        otherVice,
        other.branch,
        [{ role: 'academic_vice_principal', branchId: other.branch }],
        async (calls) => {
          const listed = orphanLessonsSchema.parse(ok(await calls.get('/api/journal/orphans')));
          // Only its own branch's lessons.
          expect(
            listed.lessons.every((one) =>
              [other.first, other.second, other.third].includes(one.lesson.id),
            ),
          ).toBe(true);
          return orphanAssignmentSchema.parse(
            ok(
              await calls.post(`/api/journal/orphans/${other.third}/assign`, {
                staffId: other.spareTeacher.staffId,
                days: 3,
                reason: 'Completes the lesson',
              }),
            ),
          );
        },
      );
      const rows = () =>
        Promise.all(
          (['journal_orphan_assignments', 'audit_log'] as const).map((table) =>
            t.database.migrator
              .selectFrom(table)
              .selectAll()
              .where('branch_id', 'in', [s.branch, other.branch])
              .orderBy('id')
              .execute(),
          ),
        );
      // Nobody assigns a lesson to themselves (02, Own requests).
      await as(helper, s.branch, viceIn(s), async (calls) => {
        expect(
          codeOf(
            await calls.post(`/api/journal/orphans/${s.first}/assign`, {
              staffId: s.spareTeacher.staffId,
              days: 1,
              reason: 'Completes the lesson',
            }),
          ),
        ).toBe('own_request');
      });
      const before = await rows();
      await as(vice, s.branch, viceIn(s), async (calls) => {
        const listed = orphanLessonsSchema.parse(ok(await calls.get('/api/journal/orphans')));
        expect(listed.lessons.map((one) => one.lesson.id).sort()).toEqual(
          [s.first, s.second, s.third].sort(),
        );
        const assign = (lessonId: string, staffId: string) =>
          calls.post(`/api/journal/orphans/${lessonId}/assign`, {
            staffId,
            days: 1,
            reason: 'Completes the lesson',
          });
        expect(codeOf(await assign(s.first, s.otherTeacher.staffId))).toBe(
          'orphan_teacher_inactive',
        );
        expect(codeOf(await assign(randomUUID(), s.spareTeacher.staffId))).toBe('not_found');
        expect(codeOf(await assign(other.first, s.spareTeacher.staffId))).toBe('not_found');
        expect(codeOf(await assign(s.first, randomUUID()))).toBe('not_found');
        expect(codeOf(await assign(s.first, other.spareTeacher.staffId))).toBe('not_found');
        for (const id of [randomUUID(), foreign.id]) {
          expect(codeOf(await calls.post(`/api/journal/orphans/assignments/${id}/withdraw`))).toBe(
            'not_found',
          );
        }
      });
      expect(await rows()).toEqual(before);
      void open;
    });

    it('lets the assignee in through every save route of the lesson, before and after the lock, and refuses another teacher', async () => {
      const vice = await account();
      const helper = await account();
      const stranger = await account();
      const s = await scene({ spare: helper.account.id });
      await classworkAt(s, s.third);
      await left(s);
      await as(vice, s.branch, viceIn(s), async (calls) => {
        for (const lessonId of [s.first, s.third]) {
          ok(
            await calls.post(`/api/journal/orphans/${lessonId}/assign`, {
              staffId: s.spareTeacher.staffId,
              days: 3,
              reason: 'Completes the lesson',
            }),
          );
        }
      });
      const planWork = await as(helper, s.branch, teacherIn(s), async (calls) => {
        const grid = await gridOf(calls, s);
        return grid.lessons.find((one) => one.id === s.third)?.works[0]?.planWorkId ?? '';
      });
      const column = { planWorkId: planWork, sourceLessonId: s.third };
      // Each route of the journal's saves; the answer of each is what follows its scope check.
      const routes = (lessonId: string): ['post' | 'put', string, object][] => [
        [
          'post',
          `/api/journal/lessons/${lessonId}/attendance`,
          { saves: [{ studentId: s.ahmedov, mark: 1, version: null }] },
        ],
        ['post', `/api/journal/lessons/${lessonId}/all-present`, {}],
        ['post', `/api/journal/lessons/${lessonId}/copy-attendance`, {}],
        [
          'put',
          `/api/journal/lessons/${lessonId}/works/total`,
          { column, total: 5, version: null },
        ],
        [
          'post',
          `/api/journal/lessons/${lessonId}/scores`,
          { saves: [{ studentId: s.ahmedov, column, score: 3, version: null }] },
        ],
        [
          'put',
          `/api/journal/lessons/${lessonId}/works/not-held`,
          { column, notHeld: false, version: null },
        ],
        ['post', `/api/journal/lessons/${lessonId}/works/carry`, { column, version: null }],
        ['post', `/api/journal/lessons/${lessonId}/works`, { kind: 'classwork' }],
        ['post', `/api/journal/lessons/${lessonId}/not-graded`, {}],
      ];
      for (const lessonId of [s.third, s.first]) {
        await as(stranger, s.branch, teacherIn(s), async (calls) => {
          for (const [method, path, body] of routes(lessonId)) {
            const answer =
              method === 'post' ? await calls.post(path, body) : await calls.put(path, body);
            expect(codeOf(answer), path).toBe('journal_entry_scope');
          }
        });
        await as(helper, s.branch, teacherIn(s), async (calls) => {
          for (const [method, path, body] of routes(lessonId)) {
            const answer =
              method === 'post' ? await calls.post(path, body) : await calls.put(path, body);
            expect(['journal_entry_scope', 'journal_locked'], path).not.toContain(codeOf(answer));
          }
        });
      }
    });
  });
});
