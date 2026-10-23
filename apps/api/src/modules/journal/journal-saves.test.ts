import {
  APP_VERSION,
  APP_VERSION_HEADER,
  REQUEST_KEY_HEADER,
  UNDO_CELLS_MAX,
  allPresentSchema,
  apiErrorSchema,
  attendanceCopySchema,
  attendanceSavedSchema,
  journalGridSchema,
  scoresSavedSchema,
  undoneSchema,
} from '@sodiq/shared';
import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workWithTotal } from '../../testing/cells-kit.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';
import { cookieOf, NEW_PASSWORD } from '../../testing/sign-in-kit.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

/** An undo body, its cells grouped by student. */
function undoBody(
  cells: readonly { studentId: string; workId: string | null; version?: number }[],
) {
  const students = new Map<string, { workId: string | null; version: number }[]>();
  for (const cell of cells) {
    students.set(cell.studentId, [
      ...(students.get(cell.studentId) ?? []),
      { workId: cell.workId, version: cell.version ?? 0 },
    ]);
  }
  return { students: [...students].map(([studentId, own]) => ({ studentId, cells: own })) };
}

/** `count` cells of 60 unknown students, 21 each (the largest action: a mark and 20 numbers). */
function manyCells(count: number) {
  const students = Array.from({ length: 60 }, () => randomUUID());
  return Array.from({ length: count }, (_, index) => ({
    studentId: students[index % 60] ?? '',
    workId: index < 60 ? null : randomUUID(),
    version: 1,
  }));
}

const codeOf = (response: Response): string =>
  (response.body as { error?: { code?: string } }).error?.code ?? `status ${response.status}`;

// All names are invented. Task 8.3a: saving and stale saves (docs/spec/07-journal.md,
// Entering data, "Saving", Editing rules and locks: "If both change the same cell, the
// second person is told and sees both values"; docs/spec/edge-cases/journal.md, Saving and
// working together; docs/spec/edge-cases/system-behaviour.md, the release at 19:00;
// docs/spec/edge-cases/developer-rules.md, Repeat-safe actions).
describe('saving journal cells', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Dilnoza', `Karimova${'a'.repeat(names % 7)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string; login: string } };
  interface Calls {
    get: (branch: string, path: string) => Promise<Response>;
    /** A post with a new request key, or with `key`; `null` sends none. */
    post: (branch: string, path: string, body?: object, key?: string | null) => Promise<Response>;
  }

  /** Runs `work` with the clock at `moment` and the roles given from 1 September. */
  async function as<T>(
    browser: Browser,
    roles: readonly Omit<Held, 'validFrom'>[],
    work: (calls: Calls) => Promise<T>,
    moment = MOMENT,
  ): Promise<T> {
    for (const held of roles) {
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
      return await work({
        get: (branch, path) => t.get(path, branch, browser.cookie),
        post: (branch, path, body, key) => {
          const call = t.post(path, branch, body ?? {}, browser.cookie);
          return key === null ? call : call.set(REQUEST_KEY_HEADER, key ?? randomUUID());
        },
      });
    } finally {
      t.clock.set(START);
    }
  }

  /** A second session of the same account: one person on two devices. */
  async function secondDevice(
    browser: Browser & { secret: Buffer },
  ): Promise<Browser & { secret: Buffer }> {
    const signed = await t.kit.signIn(browser.account.login, NEW_PASSWORD);
    const cookie = cookieOf(signed);
    if (signed.status !== 200 || cookie === undefined) throw new Error('No second sign-in.');
    t.clock.advance(30_000);
    const passed = await t.kit.passSecondStep(cookie, t.kit.codeOf(browser.secret));
    expect(passed.status, JSON.stringify(passed.body)).toBe(200);
    return { ...browser, cookie: cookieOf(passed) ?? cookie };
  }

  /** A student of the class from `from` (until `until`), named as given. */
  const student = async (
    branch: string,
    classId: string,
    last: string,
    from = '2026-09-01',
    until?: string,
  ): Promise<string> => {
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const id = await members.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: 'Ali', last_name: last })
      .where('id', '=', id)
      .execute();
    await members.member({
      branch,
      classId,
      studentId: id,
      from,
      ...(until === undefined ? {} : { ownUntil: until }),
    });
    return id;
  };

  /** The scene's class lessons up to 31 October, in order. */
  const lessonsOf = async (classId: string) =>
    (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', classId)
        .where('lesson_date', '<=', '2026-10-31')
        .orderBy('starts_at')
        .execute()
    ).map((row) => row.id);

  /**
   * The graded scene of 6.2: maths of 7th grade on the Mondays 12, 19 and 26 October,
   * owned by the scene's teacher, with three students (Valiyev left on 18 October).
   */
  async function scene(accounts: { teacher?: string; spare?: string } = {}) {
    const s = await publishedScene(t, load, { graded: true, accounts });
    const [first, second, third] = await lessonsOf(s.classId);
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('The scene has three lessons in October.');
    }
    return {
      ...s,
      first,
      second,
      third,
      ahmedov: await student(s.branch, s.classId, 'Ahmedov'),
      boboyev: await student(s.branch, s.classId, 'Boboyev'),
      valiyev: await student(s.branch, s.classId, 'Valiyev', '2026-09-01', '2026-10-18'),
    };
  }

  const cellOf = (lessonId: string, studentId: string, workId: string | null = null) =>
    t.database.migrator
      .selectFrom('journal_cells')
      .select(['id', 'mark', 'score', 'version', 'changed_by', 'changed_how'])
      .where('lesson_id', '=', lessonId)
      .where('student_id', '=', studentId)
      .where('work_id', workId === null ? 'is' : '=', workId)
      .executeTakeFirst();

  const linesOf = (lessonId: string) =>
    t.database.migrator
      .selectFrom('journal_cell_history')
      .select(['student_id', 'work_id', 'version', 'changed_how', 'changed_by'])
      .where('lesson_id', '=', lessonId)
      .orderBy('changed_at')
      .orderBy('version')
      .execute();

  /** The audit entries of journal writes. */
  const journalEntries = async () =>
    (
      await t.database.migrator
        .selectFrom('audit_log')
        .select(['action', 'record_id', 'details'])
        .where('action', 'like', 'journal.%')
        .orderBy('id')
        .execute()
    ).map((row) => ({ action: row.action, record: row.record_id, details: row.details }));

  /** Every row the routes write in a branch: the cells and their history (0108). */
  const cellsOfBranch = (branch: string) =>
    Promise.all([
      t.database.migrator
        .selectFrom('journal_cells')
        .selectAll()
        .where('branch_id', '=', branch)
        .orderBy('id')
        .execute(),
      t.database.migrator
        .selectFrom('journal_cell_history')
        .selectAll()
        .where('branch_id', '=', branch)
        .orderBy('id')
        .execute(),
    ]);

  /** A mark written as the migrator, with the moment the triggers read: another teacher's entry. */
  const atMomentWrite = (branch: string, lessonId: string, studentId: string, mark: number) =>
    t.database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${MOMENT}, true)`.execute(transaction);
      const by = await transaction
        .selectFrom('accounts')
        .select('id')
        .orderBy('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('journal_cells')
        .values({
          branch_id: branch,
          lesson_id: lessonId,
          student_id: studentId,
          work_id: null,
          mark,
          changed_by: by.id,
          changed_how: 'entry',
          version: 1,
          changed_at: new Date(MOMENT),
        })
        .execute();
    });

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('two saves of one cell (the Done when)', () => {
    it('refuses the second of two sessions of one account with both values, keeps the stored one, and saves "use mine" on the stored version', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const laptop: Browser = owner;
      const phone = await secondDevice(owner);
      const role = [{ role: 'teacher' as const, branchId: s.branch }];
      // Both devices read the empty cell (version null) and the number cell.
      const work = await workWithTotal(t.database.migrator, {
        branchId: s.branch,
        lessonId: s.second,
        total: 10,
      });
      await as(laptop, role, async ({ post }) => {
        const first = await post(s.branch, `/api/journal/lessons/${s.second}/attendance`, {
          saves: [{ studentId: s.ahmedov, mark: 1, version: null }],
        });
        expect(first.status, JSON.stringify(first.body)).toBe(200);
        const number = await post(s.branch, `/api/journal/lessons/${s.second}/scores`, {
          saves: [{ studentId: s.ahmedov, column: { workId: work }, score: 7, version: null }],
        });
        expect(number.status, JSON.stringify(number.body)).toBe(200);
      });
      await as(phone, [], async ({ post }) => {
        const stale = await post(s.branch, `/api/journal/lessons/${s.second}/attendance`, {
          saves: [{ studentId: s.ahmedov, mark: 0, version: null }],
        });
        expect(stale.status).toBe(409);
        const failure = apiErrorSchema.parse(stale.body).error;
        expect(failure.code).toBe('cell_stale');
        expect(failure.details).toEqual([
          expect.objectContaining({
            path: 'saves.0',
            code: 'cell_stale',
            storedCell: expect.objectContaining({
              value: 1,
              version: 1,
              changedBy: owner.account.id,
              changedByLogin: owner.account.login,
            }) as unknown,
          }),
        ]);
        expect(await cellOf(s.second, s.ahmedov)).toMatchObject({ mark: 1, version: 1 });
        const staleNumber = await post(s.branch, `/api/journal/lessons/${s.second}/scores`, {
          saves: [{ studentId: s.ahmedov, column: { workId: work }, score: 4, version: null }],
        });
        expect(codeOf(staleNumber)).toBe('cell_stale');
        expect(apiErrorSchema.parse(staleNumber.body).error.details?.[0]?.storedCell).toMatchObject(
          { value: 7, version: 1 },
        );
        expect(await cellOf(s.second, s.ahmedov, work)).toMatchObject({ score: 7, version: 1 });
        // "Use mine": the typed value sent again on the stored version; with numbers in the
        // lesson it asks keep or clear only now, after the stale choice.
        const mine = await post(s.branch, `/api/journal/lessons/${s.second}/attendance`, {
          saves: [{ studentId: s.ahmedov, mark: 0, version: 1, numbers: 'keep' }],
        });
        expect(mine.status, JSON.stringify(mine.body)).toBe(200);
        expect(await cellOf(s.second, s.ahmedov)).toMatchObject({ mark: 0, version: 2 });
      });
    });

    it('refuses the second of two people who may both enter the lesson (the journal owner and the lesson teacher)', async () => {
      const owner = await account();
      const substitute = await account();
      const s = await scene({ teacher: owner.account.id, spare: substitute.account.id });
      // The spare teacher holds the lesson of the 19th: both may enter it (6.3, decision 3).
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: s.spareTeacher.staffId })
        .where('id', '=', s.second)
        .execute();
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        const saved = await post(s.branch, `/api/journal/lessons/${s.second}/attendance`, {
          saves: [{ studentId: s.boboyev, mark: 2, version: null }],
        });
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      });
      await as(substitute, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        const stale = await post(s.branch, `/api/journal/lessons/${s.second}/attendance`, {
          saves: [{ studentId: s.boboyev, mark: 1, version: null }],
        });
        expect(codeOf(stale)).toBe('cell_stale');
        expect(apiErrorSchema.parse(stale.body).error.details?.[0]?.storedCell).toMatchObject({
          value: 2,
          version: 1,
          changedBy: owner.account.id,
        });
      });
      expect(await cellOf(s.second, s.boboyev)).toMatchObject({
        mark: 2,
        changed_by: owner.account.id,
      });
    });
  });

  describe('repeat-safe saves (request keys)', () => {
    it('counts the same entry sent twice once: the same answer, one history line and one audit entry', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const work = await workWithTotal(t.database.migrator, {
        branchId: s.branch,
        lessonId: s.first,
        total: 20,
      });
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        const key = randomUUID();
        const body = { saves: [{ studentId: s.ahmedov, mark: 0, version: null }] };
        const first = await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, body, key);
        expect(first.status, JSON.stringify(first.body)).toBe(200);
        const lines = (await linesOf(s.first)).length;
        const entries = (await journalEntries()).length;
        // A later change of the cell: the repeat still answers what the first request saved.
        const later = await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
          saves: [{ studentId: s.ahmedov, mark: 1, version: 1 }],
        });
        expect(later.status).toBe(200);
        const again = await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, body, key);
        expect(again.status, JSON.stringify(again.body)).toBe(200);
        expect(attendanceSavedSchema.parse(again.body)).toEqual(
          attendanceSavedSchema.parse(first.body),
        );
        expect(attendanceSavedSchema.parse(again.body).cells).toEqual([
          { studentId: s.ahmedov, mark: 0, version: 1 },
        ]);
        expect((await linesOf(s.first)).length).toBe(lines + 1);
        expect((await journalEntries()).length).toBe(entries + 1);
        // The stored answer holds ids and versions only (`request-keys.ts`).
        const stored = await t.database.migrator
          .selectFrom('request_keys')
          .select('result')
          .where('key', '=', key)
          .executeTakeFirstOrThrow();
        expect(JSON.stringify(stored.result)).not.toMatch(/mark|score|value/);

        const scoreKey = randomUUID();
        const scores = {
          saves: [{ studentId: s.boboyev, column: { workId: work }, score: 15, version: null }],
        };
        const typed = await post(
          s.branch,
          `/api/journal/lessons/${s.first}/scores`,
          scores,
          scoreKey,
        );
        expect(typed.status, JSON.stringify(typed.body)).toBe(200);
        const scoreLines = (await linesOf(s.first)).length;
        const repeated = await post(
          s.branch,
          `/api/journal/lessons/${s.first}/scores`,
          scores,
          scoreKey,
        );
        expect(repeated.status, JSON.stringify(repeated.body)).toBe(200);
        expect(scoresSavedSchema.parse(repeated.body)).toEqual(scoresSavedSchema.parse(typed.body));
        expect(scoresSavedSchema.parse(repeated.body).cells).toEqual([
          expect.objectContaining({ studentId: s.boboyev, workId: work, score: 15, percent: 75 }),
        ]);
        expect((await linesOf(s.first)).length).toBe(scoreLines);
      });
    });

    it('refuses a key used for other input, from another account, with another branch’s or an unknown lesson, from a refused role, and a save without a key', async () => {
      const owner = await account();
      const substitute = await account();
      const s = await scene({ teacher: owner.account.id, spare: substitute.account.id });
      const elsewhere = await scene();
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: s.spareTeacher.staffId })
        .where('id', '=', s.first)
        .execute();
      const work = await workWithTotal(t.database.migrator, {
        branchId: s.branch,
        lessonId: s.first,
        total: 20,
      });
      const otherWork = await workWithTotal(t.database.migrator, {
        branchId: elsewhere.branch,
        lessonId: elsewhere.first,
      });
      const key = randomUUID();
      const scoreKey = randomUUID();
      const body = { saves: [{ studentId: s.ahmedov, mark: 2, version: null }] };
      const scores = {
        saves: [{ studentId: s.ahmedov, column: { workId: work }, score: 3, version: null }],
      };
      const assignment = await t.kit.giveRole(owner.account.id, {
        role: 'teacher',
        branchId: s.branch,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
      await as(owner, [], async ({ post }) => {
        for (const [path, sent, used] of [
          ['attendance', body, key],
          ['scores', scores, scoreKey],
        ] as const) {
          const first = await post(s.branch, `/api/journal/lessons/${s.first}/${path}`, sent, used);
          expect(first.status, JSON.stringify(first.body)).toBe(200);
        }
      });
      const before = [await cellsOfBranch(s.branch), await cellsOfBranch(elsewhere.branch)];
      const entries = await journalEntries();
      await as(owner, [], async ({ post }) => {
        const other = await post(
          s.branch,
          `/api/journal/lessons/${s.first}/attendance`,
          { saves: [{ studentId: s.ahmedov, mark: 3, version: null }] },
          key,
        );
        expect(codeOf(other)).toBe('request_key_reused');
        for (const lesson of [elsewhere.first, randomUUID()]) {
          const attendance = await post(
            s.branch,
            `/api/journal/lessons/${lesson}/attendance`,
            body,
            key,
          );
          expect(attendance.status, lesson).toBe(404);
          const numbers = await post(
            s.branch,
            `/api/journal/lessons/${lesson}/scores`,
            scores,
            scoreKey,
          );
          expect(numbers.status, lesson).toBe(404);
        }
        // A repeat of a used key with ids in the body of another branch or unknown
        // (permission review of the code, should-fix 1): 404, never the stored answer.
        for (const studentId of [elsewhere.ahmedov, randomUUID()]) {
          const attendance = await post(
            s.branch,
            `/api/journal/lessons/${s.first}/attendance`,
            { saves: [{ ...body.saves[0], studentId }] },
            key,
          );
          expect(attendance.status, studentId).toBe(404);
          const numbers = await post(
            s.branch,
            `/api/journal/lessons/${s.first}/scores`,
            { saves: [{ ...scores.saves[0], studentId }] },
            scoreKey,
          );
          expect(numbers.status, studentId).toBe(404);
        }
        for (const column of [
          { workId: otherWork },
          { workId: randomUUID() },
          { planWorkId: randomUUID(), sourceLessonId: s.first },
          { planWorkId: randomUUID(), sourceLessonId: elsewhere.first },
        ]) {
          const numbers = await post(
            s.branch,
            `/api/journal/lessons/${s.first}/scores`,
            { saves: [{ ...scores.saves[0], column }] },
            scoreKey,
          );
          expect(numbers.status, JSON.stringify(column)).toBe(404);
        }
        for (const path of ['attendance', 'scores']) {
          const missing = await post(
            s.branch,
            `/api/journal/lessons/${s.first}/${path}`,
            path === 'attendance' ? body : scores,
            null,
          );
          expect(missing.status, path).toBe(400);
        }
      });
      await as(substitute, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        for (const [path, sent, used] of [
          ['attendance', body, key],
          ['scores', scores, scoreKey],
        ] as const) {
          const reused = await post(
            s.branch,
            `/api/journal/lessons/${s.first}/${path}`,
            sent,
            used,
          );
          expect(codeOf(reused), path).toBe('request_key_reused');
        }
      });
      // The owner's role ends: a repeat is refused, never answered from the stored answer.
      await t.kit.endRole(assignment.id, owner.account.id, s.branch);
      await as(owner, [{ role: 'principal', branchId: s.branch }], async ({ post }) => {
        for (const [path, sent, used] of [
          ['attendance', body, key],
          ['scores', scores, scoreKey],
        ] as const) {
          const refused = await post(
            s.branch,
            `/api/journal/lessons/${s.first}/${path}`,
            sent,
            used,
          );
          expect(refused.status, path).toBe(403);
        }
      });
      expect([await cellsOfBranch(s.branch), await cellsOfBranch(elsewhere.branch)]).toEqual(
        before,
      );
      expect(await journalEntries()).toEqual(entries);
    });
  });

  describe('undo', () => {
    it('restores the person’s own last typed mark, with a history line "undo" and one audit entry journal.cells_undo', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
          saves: [
            { studentId: s.ahmedov, mark: 1, version: null },
            { studentId: s.boboyev, mark: 2, version: null },
          ],
        });
        const changed = attendanceSavedSchema.parse(
          (
            await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
              saves: [{ studentId: s.ahmedov, mark: 0, version: 1 }],
            })
          ).body,
        );
        const entries = (await journalEntries()).length;
        const undo = await post(
          s.branch,
          `/api/journal/lessons/${s.first}/undo`,
          undoBody([{ studentId: s.ahmedov, workId: null, version: changed.cells[0]?.version }]),
        );
        expect(undo.status, JSON.stringify(undo.body)).toBe(200);
        expect(undoneSchema.parse(undo.body)).toEqual({
          undone: [{ studentId: s.ahmedov, workId: null, version: 3 }],
          skipped: [],
        });
        expect(await cellOf(s.first, s.ahmedov)).toMatchObject({
          mark: 1,
          version: 3,
          changed_how: 'undo',
        });
        expect((await linesOf(s.first)).at(-1)).toMatchObject({
          student_id: s.ahmedov,
          version: 3,
          changed_how: 'undo',
        });
        const added = (await journalEntries()).slice(entries);
        expect(added).toEqual([
          { action: 'journal.cells_undo', record: s.first, details: { undone: 1, skipped: 0 } },
        ]);
        // A first save undone goes back to empty.
        const undoFirst = undoneSchema.parse(
          (
            await post(
              s.branch,
              `/api/journal/lessons/${s.first}/undo`,
              undoBody([{ studentId: s.boboyev, workId: null, version: 1 }]),
            )
          ).body,
        );
        expect(undoFirst.undone).toHaveLength(1);
        expect(await cellOf(s.first, s.boboyev)).toMatchObject({ mark: null, version: 2 });
        // An undo is not undone again (decision 3), and a repeat undoes nothing.
        const again = undoneSchema.parse(
          (
            await post(
              s.branch,
              `/api/journal/lessons/${s.first}/undo`,
              undoBody([{ studentId: s.ahmedov, workId: null, version: 3 }]),
            )
          ).body,
        );
        expect(again).toEqual({
          undone: [],
          skipped: [{ studentId: s.ahmedov, workId: null, code: 'changed' }],
        });
        expect(await cellOf(s.first, s.ahmedov)).toMatchObject({ mark: 1, version: 3 });
      });
    });

    it('skips a cell changed since by another session and a cell whose last line is another account’s', async () => {
      const owner = await account();
      const substitute = await account();
      const s = await scene({ teacher: owner.account.id, spare: substitute.account.id });
      const phone = await secondDevice(owner);
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: s.spareTeacher.staffId })
        .where('id', '=', s.first)
        .execute();
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
          saves: [
            { studentId: s.ahmedov, mark: 1, version: null },
            { studentId: s.boboyev, mark: 1, version: null },
          ],
        });
      });
      // The phone changes Ahmedov after the laptop's action; the substitute changes Boboyev.
      await as(phone, [], async ({ post }) => {
        await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
          saves: [{ studentId: s.ahmedov, mark: 2, version: 1 }],
        });
      });
      await as(substitute, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
          saves: [{ studentId: s.boboyev, mark: 3, version: 1 }],
        });
      });
      await as(owner, [], async ({ post }) => {
        const undo = undoneSchema.parse(
          (
            await post(
              s.branch,
              `/api/journal/lessons/${s.first}/undo`,
              undoBody([
                { studentId: s.ahmedov, workId: null, version: 1 },
                { studentId: s.boboyev, workId: null, version: 2 },
              ]),
            )
          ).body,
        );
        expect(undo.undone).toEqual([]);
        expect(undo.skipped).toEqual([
          { studentId: s.ahmedov, workId: null, code: 'changed' },
          { studentId: s.boboyev, workId: null, code: 'changed' },
        ]);
      });
      expect(await cellOf(s.first, s.ahmedov)).toMatchObject({ mark: 2 });
      expect(await cellOf(s.first, s.boboyev)).toMatchObject({ mark: 3 });
    });

    it('undoes "all present" as one call', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        const filled = allPresentSchema.parse(
          (await post(s.branch, `/api/journal/lessons/${s.second}/all-present`)).body,
        );
        expect(filled.filled).toHaveLength(2);
        const undo = undoneSchema.parse(
          (
            await post(
              s.branch,
              `/api/journal/lessons/${s.second}/undo`,
              undoBody(filled.filled.map((one) => ({ ...one, workId: null }))),
            )
          ).body,
        );
        expect(undo.undone.map((one) => one.studentId).sort()).toEqual(
          [s.ahmedov, s.boboyev].sort(),
        );
        expect((await cellOf(s.second, s.ahmedov))?.mark).toBeNull();
        expect((await cellOf(s.second, s.boboyev))?.mark).toBeNull();
      });
    });

    it('skips a number above the work’s lowered total and a number of a work now "not held", with their codes', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const lowered = await workWithTotal(t.database.migrator, {
        branchId: s.branch,
        lessonId: s.first,
        total: 10,
      });
      const dropped = await workWithTotal(t.database.migrator, {
        branchId: s.branch,
        lessonId: s.first,
        total: 10,
      });
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        for (const [score, version] of [
          [8, null],
          [3, 1],
        ] as const) {
          const typed = await post(s.branch, `/api/journal/lessons/${s.first}/scores`, {
            saves: [
              { studentId: s.ahmedov, column: { workId: lowered }, score, version },
              { studentId: s.ahmedov, column: { workId: dropped }, score, version },
            ],
          });
          expect(typed.status, JSON.stringify(typed.body)).toBe(200);
        }
        const versionOf = async (work: string) =>
          (
            await t.database.migrator
              .selectFrom('journal_works')
              .select('version')
              .where('id', '=', work)
              .executeTakeFirstOrThrow()
          ).version;
        const total = await t.put(
          `/api/journal/lessons/${s.first}/works/total`,
          s.branch,
          {
            column: { workId: lowered },
            total: 5,
            version: await versionOf(lowered),
            confirm: true,
          },
          owner.cookie,
        );
        expect(total.status, JSON.stringify(total.body)).toBe(200);
        const notHeld = await t.put(
          `/api/journal/lessons/${s.first}/works/not-held`,
          s.branch,
          {
            column: { workId: dropped },
            notHeld: true,
            version: await versionOf(dropped),
            confirm: true,
          },
          owner.cookie,
        );
        expect(notHeld.status, JSON.stringify(notHeld.body)).toBe(200);
        const undo = await post(
          s.branch,
          `/api/journal/lessons/${s.first}/undo`,
          undoBody([
            { studentId: s.ahmedov, workId: lowered, version: 2 },
            { studentId: s.ahmedov, workId: dropped, version: 2 },
          ]),
        );
        expect(undo.status, JSON.stringify(undo.body)).toBe(200);
        expect(undoneSchema.parse(undo.body)).toEqual({
          undone: [],
          skipped: expect.arrayContaining([
            { studentId: s.ahmedov, workId: lowered, code: 'score_above_total' },
            { studentId: s.ahmedov, workId: dropped, code: 'work_not_held' },
          ]) as unknown,
        });
        expect(await cellOf(s.first, s.ahmedov, lowered)).toMatchObject({ score: 3, version: 2 });
        expect(await cellOf(s.first, s.ahmedov, dropped)).toMatchObject({ score: 3, version: 2 });
      });
    });

    it('refuses an undo beyond the largest action, before the start, on a cancelled lesson, outside the scope, and ids of another branch or unknown', async () => {
      const owner = await account();
      const other = await account();
      const s = await scene({ teacher: owner.account.id, spare: other.account.id });
      const elsewhere = await scene();
      const otherWork = await workWithTotal(t.database.migrator, {
        branchId: elsewhere.branch,
        lessonId: elsewhere.first,
      });
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'reason', cancel_reason: 'School trip' })
        .where('id', '=', s.third)
        .execute();
      const cell = { studentId: s.ahmedov, workId: null, version: 1 };
      const entries = await journalEntries();
      const before = [await cellsOfBranch(s.branch), await cellsOfBranch(elsewhere.branch)];
      await as(
        owner,
        [{ role: 'teacher', branchId: s.branch }],
        async ({ post }) => {
          const early = await post(
            s.branch,
            `/api/journal/lessons/${s.first}/undo`,
            undoBody([cell]),
          );
          expect(codeOf(early)).toBe('entry_not_started');
        },
        '2026-10-12T07:59:00+05:00',
      );
      await as(owner, [], async ({ post }) => {
        const many = await post(
          s.branch,
          `/api/journal/lessons/${s.first}/undo`,
          undoBody(manyCells(UNDO_CELLS_MAX + 1)),
        );
        expect(many.status).toBe(400);
        // The largest action passes the schema and the body limit: its unknown students are 404.
        const largest = await post(
          s.branch,
          `/api/journal/lessons/${s.first}/undo`,
          undoBody(manyCells(UNDO_CELLS_MAX)),
        );
        expect(largest.status, JSON.stringify(largest.body)).toBe(404);
        const cancelled = await post(
          s.branch,
          `/api/journal/lessons/${s.third}/undo`,
          undoBody([cell]),
        );
        expect(codeOf(cancelled)).toBe('lesson_cancelled_cell');
        for (const lesson of [elsewhere.first, randomUUID()]) {
          const missing = await post(
            s.branch,
            `/api/journal/lessons/${lesson}/undo`,
            undoBody([cell]),
          );
          expect(missing.status, lesson).toBe(404);
        }
        for (const studentId of [elsewhere.ahmedov, randomUUID()]) {
          const missing = await post(
            s.branch,
            `/api/journal/lessons/${s.first}/undo`,
            undoBody([{ ...cell, studentId }]),
          );
          expect(missing.status, studentId).toBe(404);
        }
        for (const workId of [otherWork, randomUUID()]) {
          const missing = await post(
            s.branch,
            `/api/journal/lessons/${s.first}/undo`,
            undoBody([{ ...cell, workId }]),
          );
          expect(missing.status, workId).toBe(404);
        }
      });
      await as(other, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        const refused = await post(
          s.branch,
          `/api/journal/lessons/${s.first}/undo`,
          undoBody([cell]),
        );
        expect(refused.status).toBe(403);
        expect(codeOf(refused)).toBe('journal_entry_scope');
      });
      expect([await cellsOfBranch(s.branch), await cellsOfBranch(elsewhere.branch)]).toEqual(
        before,
      );
      expect(await journalEntries()).toEqual(entries);
    });
  });

  describe('copy attendance', () => {
    /** The lessons of the 19th made a double: the 08:00 lesson and the third slot. */
    async function doubleScene(accounts: { teacher?: string; spare?: string }) {
      const s = await publishedScene(t, load, { graded: true, double: true, accounts });
      const lessons = await t.database.migrator
        .selectFrom('lessons')
        .select(['id', 'block_id', 'lesson_date'])
        .where('class_id', '=', s.classId)
        .where('lesson_date', '<=', '2026-10-31')
        .orderBy('starts_at')
        .execute();
      const ofDay = lessons.filter((one) => String(one.lesson_date) === '2026-10-19');
      const [first, second] = ofDay;
      if (first === undefined || second === undefined) throw new Error('Two lessons on the 19th.');
      await t.database.migrator
        .updateTable('lesson_blocks')
        .set({ double_pair_id: randomUUID() })
        .where('id', 'in', [first.block_id, second.block_id])
        .execute();
      const single = lessons.find((one) => String(one.lesson_date) === '2026-10-12');
      return {
        ...s,
        first: first.id,
        second: second.id,
        single: single?.id ?? '',
        ahmedov: await student(s.branch, s.classId, 'Ahmedov'),
        boboyev: await student(s.branch, s.classId, 'Boboyev'),
        davronov: await student(s.branch, s.classId, 'Davronov'),
      };
    }

    it('fills only the empty cells of the second lesson from the first, reports the rest, writes one audit entry, and is undone as one call', async () => {
      const owner = await account();
      const s = await doubleScene({ teacher: owner.account.id });
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ get, post }) => {
        const grid = journalGridSchema.parse(
          (
            await get(
              s.branch,
              `/api/journal/journals/${
                (
                  await t.database.migrator
                    .selectFrom('journals')
                    .select('id')
                    .where('class_id', '=', s.classId)
                    .executeTakeFirstOrThrow()
                ).id
              }`,
            )
          ).body,
        );
        expect(grid.lessons.find((one) => one.id === s.second)?.copyFrom).toBe(s.first);
        expect(grid.lessons.find((one) => one.id === s.first)?.copyFrom).toBeNull();
        await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
          saves: [
            { studentId: s.ahmedov, mark: 2, version: null },
            { studentId: s.boboyev, mark: 0, version: null },
          ],
        });
        await post(s.branch, `/api/journal/lessons/${s.second}/attendance`, {
          saves: [{ studentId: s.boboyev, mark: 1, version: null }],
        });
        const entries = (await journalEntries()).length;
        const copy = await post(s.branch, `/api/journal/lessons/${s.second}/copy-attendance`);
        expect(copy.status, JSON.stringify(copy.body)).toBe(200);
        const copied = attendanceCopySchema.parse(copy.body);
        expect(copied.filled).toEqual([{ studentId: s.ahmedov, version: 1 }]);
        expect(copied.skipped).toEqual(
          expect.arrayContaining([
            { studentId: s.boboyev, mark: 1 },
            { studentId: s.davronov, mark: null },
          ]),
        );
        expect(await cellOf(s.second, s.ahmedov)).toMatchObject({ mark: 2, changed_how: 'entry' });
        expect((await journalEntries()).slice(entries)).toEqual([
          { action: 'journal.attendance_copy', record: s.second, details: { count: 1 } },
        ]);
        // A second press fills nothing.
        const again = attendanceCopySchema.parse(
          (await post(s.branch, `/api/journal/lessons/${s.second}/copy-attendance`)).body,
        );
        expect(again.filled).toEqual([]);
        // The copy is one bulk action: one undo (review correction 4).
        const undo = undoneSchema.parse(
          (
            await post(
              s.branch,
              `/api/journal/lessons/${s.second}/undo`,
              undoBody(copied.filled.map((one) => ({ ...one, workId: null }))),
            )
          ).body,
        );
        expect(undo.undone).toHaveLength(1);
        expect((await cellOf(s.second, s.ahmedov))?.mark).toBeNull();
      });
    });

    it('copies from a first lesson another teacher held: the person who enters the second lesson reads the same journal (decision 2)', async () => {
      const owner = await account();
      const s = await doubleScene({ teacher: owner.account.id });
      // A substitute held the first lesson of the double.
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: s.spareTeacher.staffId })
        .where('id', '=', s.first)
        .execute();
      await atMomentWrite(s.branch, s.first, s.ahmedov, 3);
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        const copied = attendanceCopySchema.parse(
          (await post(s.branch, `/api/journal/lessons/${s.second}/copy-attendance`)).body,
        );
        expect(copied.filled).toEqual([{ studentId: s.ahmedov, version: 1 }]);
        expect((await cellOf(s.second, s.ahmedov))?.mark).toBe(3);
      });
    });

    it('refuses the first lesson and a single lesson, a cancelled first lesson, outside the scope, and another branch’s or an unknown lesson', async () => {
      const owner = await account();
      const other = await account();
      const s = await doubleScene({ teacher: owner.account.id, spare: other.account.id });
      const elsewhere = await scene();
      const entries = await journalEntries();
      const before = [await cellsOfBranch(s.branch), await cellsOfBranch(elsewhere.branch)];
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        for (const lesson of [s.first, s.single]) {
          const refused = await post(s.branch, `/api/journal/lessons/${lesson}/copy-attendance`);
          expect(codeOf(refused), lesson).toBe('lesson_not_double');
        }
        for (const lesson of [elsewhere.first, randomUUID()]) {
          const missing = await post(s.branch, `/api/journal/lessons/${lesson}/copy-attendance`);
          expect(missing.status, lesson).toBe(404);
        }
      });
      await as(other, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        const refused = await post(s.branch, `/api/journal/lessons/${s.second}/copy-attendance`);
        expect(codeOf(refused)).toBe('journal_entry_scope');
      });
      expect([await cellsOfBranch(s.branch), await cellsOfBranch(elsewhere.branch)]).toEqual(
        before,
      );
      expect(await journalEntries()).toEqual(entries);
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'reason', cancel_reason: 'School trip' })
        .where('id', '=', s.first)
        .execute();
      await as(owner, [], async ({ post }) => {
        const cancelled = await post(s.branch, `/api/journal/lessons/${s.second}/copy-attendance`);
        expect(codeOf(cancelled)).toBe('lesson_copy_cancelled');
      });
    });
  });

  describe('the application version', () => {
    it('takes a write of this release and the previous one, and refuses a version that is not a number', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ get }) => {
        for (const [version, mark, status] of [
          [String(APP_VERSION), 1, 200],
          [String(APP_VERSION - 1), 2, 200],
          ['old', 3, 400],
        ] as const) {
          const cell = await cellOf(s.first, s.ahmedov);
          const answer = await t
            .post(
              `/api/journal/lessons/${s.first}/attendance`,
              s.branch,
              { saves: [{ studentId: s.ahmedov, mark, version: cell?.version ?? null }] },
              owner.cookie,
            )
            .set(REQUEST_KEY_HEADER, randomUUID())
            .set(APP_VERSION_HEADER, version);
          expect(answer.status, version).toBe(status);
        }
        // A read is never refused for the version (decision 9).
        const read = await get(s.branch, '/api/journal/journals');
        expect(read.status).toBe(200);
        const readOld = await t
          .get('/api/journal/journals', s.branch, owner.cookie)
          .set(APP_VERSION_HEADER, 'old');
        expect(readOld.status).toBe(200);
      });
    });
  });
});
