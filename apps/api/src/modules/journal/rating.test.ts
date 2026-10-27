import {
  REQUEST_KEY_HEADER,
  BRANCH_HEADER,
  commentHistorySchema,
  journalCommentSchema,
  workSavedSchema,
  journalGridSchema,
  ratingExamSchema,
  ratingHistorySchema,
  subjectListSchema,
  type JournalGrid,
  type RatingExam,
  type Subject,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { Audit } from '../audit/audit.service.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): string =>
  (response.body as { error?: { code?: string } }).error?.code ?? `status ${response.status}`;

const ok = (response: Response, status = 200): unknown => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response.body;
};

// All names are invented. Task 8.2, pull request #218: the rating exam of a journal
// in a quarter (docs/spec/edge-cases/calculation.md, "The rating exam", "The exam is
// not held for one group this quarter", "'Rating exam' is switched off ... in week 5";
// docs/spec/07-journal.md, Layout, Calculation rules 7 and 8).
describe('the rating exam and comments', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Nodira', `Yusupova${'a'.repeat(names % 7)}`);
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

  /** A student of the class from `from`. */
  const student = async (branch: string, classId: string, last: string, from = '2026-09-01') => {
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

  /**
   * The graded scene of 6.2 (maths of 7th grade on Mondays at 08:00), its subject
   * with the rating exam (`rating`, the default) and quarterly weights 20 · 20 · 20 · 40.
   */
  async function scene(accounts: { teacher?: string } = {}, rating = true) {
    const s = await publishedScene(t, load, { graded: true, accounts });
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
    const quarters = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', s.year)
        .orderBy('number')
        .execute()
    ).map((one) => one.id);
    const journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.classId)
        .executeTakeFirstOrThrow()
    ).id;
    const lessons = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('lesson_date', '>=', '2026-10-12')
        .where('lesson_date', '<=', '2026-10-26')
        .orderBy('starts_at')
        .execute()
    ).map((one) => one.id);
    return {
      ...s,
      journal,
      lessons,
      q1: quarters[0] ?? '',
      q2: quarters[1] ?? '',
      ahmedov: await student(s.branch, s.classId, 'Ahmedov'),
      boboyev: await student(s.branch, s.classId, 'Boboyev'),
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  const teacherIn = (s: Scene) => [{ role: 'teacher' as const, branchId: s.branch }];
  const viceIn = (s: Scene) => [{ role: 'academic_vice_principal' as const, branchId: s.branch }];

  const base = (s: Scene, quarter = s.q1) => `/api/journal/journals/${s.journal}/rating/${quarter}`;

  const gridOf = async (calls: Calls, s: Scene, quarter = s.q1): Promise<JournalGrid> =>
    journalGridSchema.parse(
      ok(await calls.get(`/api/journal/journals/${s.journal}?quarterId=${quarter}`)),
    );

  const entryOf = (exam: RatingExam, studentId: string) =>
    exam.entries.find((one) => one.studentId === studentId);

  /** Every row the rating routes write in a branch. */
  const rowsOf = (branch: string) =>
    Promise.all(
      (['journal_rating_exams', 'journal_rating_entries', 'journal_rating_history'] as const).map(
        (table) =>
          t.database.migrator
            .selectFrom(table)
            .selectAll()
            .where('branch_id', '=', branch)
            .orderBy('id')
            .execute(),
      ),
    );

  const ratingEntries = async () =>
    Number(
      (
        await t.database.migrator
          .selectFrom('audit_log')
          .select((select) => select.fn.countAll().as('count'))
          .where('action', 'like', 'journal.rating%')
          .executeTakeFirstOrThrow()
      ).count,
    );

  /** Attendance marked 1 at a lesson, as the attendance route writes it. */
  const present = (calls: Calls, lessonId: string, studentId: string) =>
    calls.post(`/api/journal/lessons/${lessonId}/attendance`, {
      saves: [{ studentId, mark: 1, version: null }],
    });

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the column', () => {
    it('gives a subject without the rating exam no exam column (the Done when)', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id }, false);
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const grid = await gridOf(calls, s);
        expect(grid.journal.ratingExam).toBe(false);
        expect(grid.rating).toBeNull();
        expect(grid.students.every((one) => one.quarter?.ratingExam === null)).toBe(true);
        expect(
          codeOf(await calls.put(`${base(s)}/date`, { date: '2026-10-26', version: null })),
        ).toBe('rating_exam_off');
      });
    });

    it('shows the column only from the quarter a switch change names (decisions 1 and 16)', async () => {
      const owner = await account();
      const vice = await account();
      const s = await scene({ teacher: owner.account.id }, false);
      await as(vice, s.branch, viceIn(s), async (calls) => {
        const listed = subjectListSchema.parse(ok(await calls.get('/api/setup/subjects')));
        const subject = listed.subjects.find((one) => one.id === s.subject) as Subject;
        const edit = (overrides: Record<string, unknown>) => ({
          names: subject.names,
          departmentId: subject.departmentId,
          grades: subject.grades,
          colour: subject.colour,
          journalType: subject.journalType,
          ratingExam: subject.ratingExam,
          groupSubject: subject.groupSubject,
          languageRule: subject.languageRule,
          demanding: subject.demanding,
          daily: null,
          ...overrides,
        });
        expect(
          codeOf(await calls.put(`/api/setup/subjects/${s.subject}`, edit({ ratingExam: true }))),
        ).toBe('subject_switches_from');
        expect(
          codeOf(await calls.put(`/api/setup/subjects/${s.subject}`, edit({ switchesFrom: 2 }))),
        ).toBe('subject_switches_from');
        ok(
          await calls.put(
            `/api/setup/subjects/${s.subject}`,
            edit({ ratingExam: true, switchesFrom: 2 }),
          ),
        );
      });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        expect((await gridOf(calls, s, s.q1)).journal.ratingExam).toBe(false);
        expect((await gridOf(calls, s, s.q1)).rating).toBeNull();
        // Quarter 2 has the switch on and no rating weight yet: no column until its weights fit.
        const second = await gridOf(calls, s, s.q2);
        expect(second.legend.quarterly?.ratingExam ?? null).toBeNull();
      });
      const switches = await sql<{ rating_exam: boolean }>`
        select rating_exam from subject_quarter_switches(${s.subject}::uuid, ${s.q1}::uuid)
        union all
        select rating_exam from subject_quarter_switches(${s.subject}::uuid, ${s.q2}::uuid)
      `.execute(t.database.migrator);
      expect(switches.rows.map((one) => one.rating_exam)).toEqual([false, true]);
    });
  });

  describe('the date and the entries', () => {
    it('takes a score from the date, passes it to packages/calc and keeps the history', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(await present(calls, s.lessons[0] ?? '', s.ahmedov));
        const noDate = await calls.post(`${base(s)}/entries`, {
          studentId: s.ahmedov,
          entry: { kind: 'score', score: 49 },
          reason: null,
          version: null,
        });
        expect(codeOf(noDate)).toBe('rating_exam_no_date');
        const later = ratingExamSchema.parse(
          ok(await calls.put(`${base(s)}/date`, { date: '2026-10-28', version: null })),
        );
        expect(later).toMatchObject({ date: '2026-10-28', fromExam: false, canEnter: false });
        const early = await calls.post(`${base(s)}/entries`, {
          studentId: s.ahmedov,
          entry: { kind: 'score', score: 49 },
          reason: null,
          version: null,
        });
        expect(codeOf(early)).toBe('rating_exam_not_yet');
        const outside = await calls.put(`${base(s)}/date`, {
          date: '2026-11-10',
          version: later.version,
        });
        expect(codeOf(outside)).toBe('rating_exam_date_quarter');
        const dated = ratingExamSchema.parse(
          ok(await calls.put(`${base(s)}/date`, { date: '2026-10-26', version: later.version })),
        );
        expect(dated.canEnter).toBe(true);
        expect(dated.canExempt).toBe(false);
        const typed = ratingExamSchema.parse(
          ok(
            await calls.post(`${base(s)}/entries`, {
              studentId: s.ahmedov,
              entry: { kind: 'score', score: 49 },
              reason: null,
              version: null,
            }),
          ),
        );
        expect(entryOf(typed, s.ahmedov)).toMatchObject({
          entry: { kind: 'score', score: 49 },
          version: 1,
        });
        const above = await calls.post(`${base(s)}/entries`, {
          studentId: s.boboyev,
          entry: { kind: 'score', score: 101 },
          reason: null,
          version: null,
        });
        expect(codeOf(above)).toBe('validation_failed');
        // Attendance 100 and the exam 49 with weights 20 and 40, the works left out:
        // (20 × 100 + 40 × 49) ÷ 60 = 66, provisional, grade 3 (07, rules 7 and 8).
        const grid = await gridOf(calls, s);
        expect(grid.journal.ratingExam).toBe(true);
        expect(grid.rating?.entries.map((one) => one.studentId)).toEqual([s.ahmedov]);
        const ahmedov = grid.students.find((one) => one.id === s.ahmedov);
        expect(ahmedov?.quarter).toMatchObject({
          attendance: 100,
          ratingExam: 49,
          result: { kind: 'number', shown: 66, grade: 3, provisional: true },
        });
        expect(grid.bottom?.quarter.ratingExam).toBe(49);
        const history = ratingHistorySchema.parse(
          ok(await calls.get(`${base(s)}/students/${s.ahmedov}/history`)),
        );
        expect(history.lines.map((one) => [one.kind, one.dateAfter, one.after])).toEqual([
          ['exam', '2026-10-28', null],
          ['exam', '2026-10-26', null],
          ['entry', null, { kind: 'score', score: 49 }],
        ]);
      });
      expect((await t.entries('journal.rating_entry', s.journal)).length).toBe(1);
      expect((await t.entries('journal.rating_date', s.journal)).length).toBe(2);
    });

    it('counts "did not sit" as 0 and leaves "exempt" and "not held" out (07, rule 8)', async () => {
      const owner = await account();
      const vice = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(await present(calls, s.lessons[0] ?? '', s.ahmedov));
        ok(await present(calls, s.lessons[0] ?? '', s.boboyev));
        ok(await calls.put(`${base(s)}/date`, { date: '2026-10-26', version: null }));
        ok(
          await calls.post(`${base(s)}/entries`, {
            studentId: s.ahmedov,
            entry: { kind: 'did_not_sit' },
            reason: null,
            version: null,
          }),
        );
        const exempt = await calls.post(`${base(s)}/entries`, {
          studentId: s.boboyev,
          entry: { kind: 'exempt' },
          reason: null,
          version: null,
        });
        expect(codeOf(exempt)).toBe('rating_exam_scope');
        const notHeld = await calls.put(`${base(s)}/not-held`, { notHeld: true, version: 1 });
        expect(codeOf(notHeld)).toBe('rating_exam_scope');
        const grid = await gridOf(calls, s);
        // (20 × 100 + 40 × 0) ÷ 60 = 33, grade 2.
        expect(grid.students.find((one) => one.id === s.ahmedov)?.quarter?.result).toMatchObject({
          shown: 33,
          grade: 2,
        });
      });
      await as(vice, s.branch, viceIn(s), async (calls) => {
        const exempt = ratingExamSchema.parse(
          ok(
            await calls.post(`${base(s)}/entries`, {
              studentId: s.boboyev,
              entry: { kind: 'exempt' },
              reason: null,
              version: null,
            }),
          ),
        );
        expect(entryOf(exempt, s.boboyev)?.entry).toEqual({ kind: 'exempt' });
        // The Academic Vice Principal does not type scores (corrections are 8.4's).
        const typed = await calls.post(`${base(s)}/entries`, {
          studentId: s.ahmedov,
          entry: { kind: 'score', score: 70 },
          reason: 'Retake',
          version: 1,
        });
        expect(codeOf(typed)).toBe('rating_exam_scope');
        const grid = await gridOf(calls, s);
        expect(grid.students.find((one) => one.id === s.boboyev)?.quarter?.result).toMatchObject({
          shown: 100,
          leftOut: ['classwork', 'homework', 'ratingExam'],
        });
      });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        // An "exempt" is changed only by the Academic Vice Principal.
        const over = await calls.post(`${base(s)}/entries`, {
          studentId: s.boboyev,
          entry: { kind: 'score', score: 80 },
          reason: 'Sat later',
          version: 1,
        });
        expect(codeOf(over)).toBe('rating_exam_scope');
      });
      await as(vice, s.branch, viceIn(s), async (calls) => {
        const exam = (await gridOf(calls, s)).rating;
        if (exam === null) throw new Error('The grid shows the rating exam.');
        const asked = await calls.put(`${base(s)}/not-held`, {
          notHeld: true,
          version: exam.version,
        });
        expect(codeOf(asked)).toBe('rating_exam_entries');
        expect(
          (asked.body as { error: { details: { count: number }[] } }).error.details[0]?.count,
        ).toBe(2);
        const done = ratingExamSchema.parse(
          ok(
            await calls.put(`${base(s)}/not-held`, {
              notHeld: true,
              version: exam.version,
              confirm: true,
            }),
          ),
        );
        expect(done.notHeld).toBe(true);
        expect(done.entries).toHaveLength(2);
        const grid = await gridOf(calls, s);
        expect(grid.students.find((one) => one.id === s.ahmedov)?.quarter?.result).toMatchObject({
          shown: 100,
          leftOut: ['classwork', 'homework', 'ratingExam'],
        });
      });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const refused = await calls.post(`${base(s)}/entries`, {
          studentId: s.ahmedov,
          entry: { kind: 'score', score: 70 },
          reason: 'Sat later',
          version: 1,
        });
        expect(codeOf(refused)).toBe('rating_exam_not_held');
      });
    });

    it('needs a reason over an entry, a clear included, and refuses a stale version (decision 9)', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(await calls.put(`${base(s)}/date`, { date: '2026-10-26', version: null }));
        const save = (entry: object | null, version: number | null, reason: string | null = null) =>
          calls.post(`${base(s)}/entries`, { studentId: s.ahmedov, entry, reason, version });
        ok(await save({ kind: 'score', score: 40 }, null));
        expect(codeOf(await save({ kind: 'score', score: 60 }, 1))).toBe('rating_exam_reason');
        const stale = await save({ kind: 'score', score: 60 }, null, 'Retake');
        expect(codeOf(stale)).toBe('rating_exam_stale');
        expect((stale.body as { error: { details: unknown[] } }).error.details[0]).toMatchObject({
          recordId: s.ahmedov,
          storedRating: { entry: { kind: 'score', score: 40 }, version: 1 },
        });
        ok(await save({ kind: 'score', score: 60 }, 1, 'Retake'));
        expect(codeOf(await save(null, 2))).toBe('rating_exam_reason');
        ok(await save(null, 2, 'Typed in the wrong row'));
        // Clear, then enter: still a write over an entry.
        expect(codeOf(await save({ kind: 'score', score: 90 }, 3))).toBe('rating_exam_reason');
        const last = ratingExamSchema.parse(
          ok(await save({ kind: 'score', score: 90 }, 3, 'Late sitting')),
        );
        expect(entryOf(last, s.ahmedov)).toMatchObject({
          entry: { kind: 'score', score: 90 },
          version: 4,
        });
      });
      const lines = await t.database.migrator
        .selectFrom('journal_rating_history')
        .select(['score_before', 'score_after', 'reason'])
        .where('student_id', '=', s.ahmedov)
        .orderBy('version')
        .execute();
      expect(lines).toEqual([
        { score_before: null, score_after: 40, reason: null },
        { score_before: 40, score_after: 60, reason: 'Retake' },
        { score_before: 60, score_after: null, reason: 'Typed in the wrong row' },
        { score_before: null, score_after: 90, reason: 'Late sitting' },
      ]);
    });

    it('refuses a student who is no member from the date to the quarter\x27s end (decision 8)', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const otherClassStudent = await student(s.branch, s.otherClass, 'Valiyev');
      const late = await student(s.branch, s.classId, 'Gofurov', '2026-10-28');
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(await calls.put(`${base(s)}/date`, { date: '2026-10-26', version: null }));
        const outsider = await calls.post(`${base(s)}/entries`, {
          studentId: otherClassStudent,
          entry: { kind: 'score', score: 50 },
          reason: null,
          version: null,
        });
        expect(codeOf(outsider)).toBe('rating_exam_not_member');
        // A late sitting by a student who joined after the exam (07, Effect on totals).
        ok(
          await calls.post(`${base(s)}/entries`, {
            studentId: late,
            entry: { kind: 'score', score: 50 },
            reason: null,
            version: null,
          }),
        );
      });
    });
    it('gives the worked example of 07: 20 · 20 · 20 · 40 with 100, 50, 30 and 49 is 55.6, shown 56, grade 3', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const [first = '', second = ''] = s.lessons;
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        for (const lesson of [first, second]) {
          ok(await present(calls, lesson, s.ahmedov));
          ok(await present(calls, lesson, s.boboyev));
        }
        // A classwork of the first lesson, 5 of 10; a homework given there, checked at the second, 3 of 10.
        const classwork = workSavedSchema.parse(
          ok(await calls.post(`/api/journal/lessons/${first}/works`, { kind: 'classwork' })),
        );
        const homework = workSavedSchema.parse(
          ok(await calls.post(`/api/journal/lessons/${first}/works`, { kind: 'homework' })),
        );
        for (const [lesson, work] of [
          [first, classwork],
          [second, homework],
        ] as const) {
          ok(
            await calls.put(`/api/journal/lessons/${lesson}/works/total`, {
              column: { workId: work.id },
              total: 10,
              version: work.version,
            }),
          );
        }
        ok(
          await calls.post(`/api/journal/lessons/${first}/scores`, {
            saves: [
              { studentId: s.ahmedov, column: { workId: classwork.id }, score: 5, version: null },
            ],
          }),
        );
        ok(
          await calls.post(`/api/journal/lessons/${second}/scores`, {
            saves: [
              { studentId: s.ahmedov, column: { workId: homework.id }, score: 3, version: null },
            ],
          }),
        );
        ok(await calls.put(`${base(s)}/date`, { date: '2026-10-26', version: null }));
        for (const [studentId, score] of [
          [s.ahmedov, 49],
          [s.boboyev, 51],
        ] as const) {
          ok(
            await calls.post(`${base(s)}/entries`, {
              studentId,
              entry: { kind: 'score', score },
              reason: null,
              version: null,
            }),
          );
        }
        const grid = await gridOf(calls, s);
        expect(grid.students.find((one) => one.id === s.ahmedov)?.quarter).toMatchObject({
          attendance: 100,
          classwork: 50,
          homework: 30,
          ratingExam: 49,
          result: { kind: 'number', shown: 56, grade: 3, provisional: false, leftOut: [] },
        });
        // The bottom row: the mean of the two entries, from packages/calc.
        expect(grid.bottom?.quarter.ratingExam).toBe(50);
      });
    });

    it('keeps the entries when the date moves or is cleared; with no date no new entry (decision 15)', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const dated = ratingExamSchema.parse(
          ok(await calls.put(`${base(s)}/date`, { date: '2026-10-26', version: null })),
        );
        ok(
          await calls.post(`${base(s)}/entries`, {
            studentId: s.ahmedov,
            entry: { kind: 'score', score: 60 },
            reason: null,
            version: null,
          }),
        );
        const moved = ratingExamSchema.parse(
          ok(await calls.put(`${base(s)}/date`, { date: '2026-10-27', version: dated.version })),
        );
        expect(entryOf(moved, s.ahmedov)?.entry).toEqual({ kind: 'score', score: 60 });
        const cleared = ratingExamSchema.parse(
          ok(await calls.put(`${base(s)}/date`, { date: null, version: moved.version })),
        );
        expect(cleared.date).toBeNull();
        expect(entryOf(cleared, s.ahmedov)?.entry).toEqual({ kind: 'score', score: 60 });
        const refused = await calls.post(`${base(s)}/entries`, {
          studentId: s.boboyev,
          entry: { kind: 'score', score: 70 },
          reason: null,
          version: null,
        });
        expect(codeOf(refused)).toBe('rating_exam_no_date');
      });
    });

    it('makes a second save of one entry wait for the first and refuses it as stale', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(await calls.put(`${base(s)}/date`, { date: '2026-10-26', version: null }));
        ok(
          await calls.post(`${base(s)}/entries`, {
            studentId: s.ahmedov,
            entry: { kind: 'score', score: 40 },
            reason: null,
            version: null,
          }),
        );
        const answer = await whileHeld(
          s.branch,
          async (transaction) => {
            // What the first save writes: the exam row FOR UPDATE, then the entry.
            await transaction
              .selectFrom('journal_rating_exams')
              .select('id')
              .where('journal_id', '=', s.journal)
              .forUpdate()
              .execute();
            await t.app.get(Audit).record(transaction, {
              branchId: s.branch,
              actorId: owner.account.id,
              action: 'journal.rating_entry',
            });
            await transaction
              .updateTable('journal_rating_entries')
              .set({ score: 45, reason: 'Late sitting', changed_by: owner.account.id })
              .where('student_id', '=', s.ahmedov)
              .execute();
          },
          () =>
            calls.post(`${base(s)}/entries`, {
              studentId: s.ahmedov,
              entry: { kind: 'score', score: 50 },
              reason: 'Retake',
              version: 1,
            }),
        );
        expect(codeOf(answer)).toBe('rating_exam_stale');
        expect(
          (answer.body as { error: { details: { storedRating?: unknown }[] } }).error.details[0]
            ?.storedRating,
        ).toEqual({ entry: { kind: 'score', score: 45 }, version: 2 });
      });
    });
  });

  describe('who may', () => {
    it('refuses a teacher of another journal, a Tutor and a Principal, and writes nothing', async () => {
      const owner = await account();
      const stranger = await account();
      const tutor = await account();
      const principal = await account();
      const s = await scene({ teacher: owner.account.id });
      const before = await rowsOf(s.branch);
      const audits = await ratingEntries();
      const body = {
        studentId: s.ahmedov,
        entry: { kind: 'did_not_sit' },
        reason: null,
        version: null,
      };
      await as(stranger, s.branch, [{ role: 'teacher', branchId: s.branch }], async (calls) => {
        expect(
          codeOf(await calls.put(`${base(s)}/date`, { date: '2026-10-26', version: null })),
        ).toBe('rating_exam_scope');
        expect(codeOf(await calls.post(`${base(s)}/entries`, body))).toBe('rating_exam_scope');
      });
      await as(tutor, s.branch, [{ role: 'tutor', branchId: s.branch }], async (calls) => {
        expect(codeOf(await calls.post(`${base(s)}/entries`, body))).toBe('rating_exam_scope');
        expect(
          codeOf(await calls.put(`${base(s)}/not-held`, { notHeld: true, version: null })),
        ).toBe('rating_exam_scope');
      });
      await as(principal, s.branch, [{ role: 'principal', branchId: s.branch }], async (calls) => {
        expect((await calls.post(`${base(s)}/entries`, body)).status).toBe(403);
      });
      expect(await rowsOf(s.branch)).toEqual(before);
      expect(await ratingEntries()).toBe(audits);
    });

    it('answers 404 for another branch’s journal, an unknown quarter and an unknown student', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const other = await scene();
      const before = [await rowsOf(s.branch), await rowsOf(other.branch)];
      const audits = await ratingEntries();
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const body = {
          studentId: s.ahmedov,
          entry: { kind: 'did_not_sit' },
          reason: null,
          version: null,
        };
        for (const path of [
          `/api/journal/journals/${other.journal}/rating/${other.q1}`,
          `/api/journal/journals/${s.journal}/rating/${other.q1}`,
          `/api/journal/journals/${randomUUID()}/rating/${s.q1}`,
          `/api/journal/journals/${s.journal}/rating/${randomUUID()}`,
        ]) {
          expect(
            codeOf(await calls.put(`${path}/date`, { date: '2026-10-26', version: null })),
          ).toBe('not_found');
          expect(
            codeOf(await calls.put(`${path}/not-held`, { notHeld: true, version: null })),
          ).toBe('not_found');
          expect(codeOf(await calls.post(`${path}/entries`, body))).toBe('not_found');
          expect(codeOf(await calls.get(`${path}/students/${s.ahmedov}/history`))).toBe(
            'not_found',
          );
        }
        for (const studentId of [other.ahmedov, randomUUID()]) {
          expect(codeOf(await calls.post(`${base(s)}/entries`, { ...body, studentId }))).toBe(
            'not_found',
          );
          expect(codeOf(await calls.get(`${base(s)}/students/${studentId}/history`))).toBe(
            'not_found',
          );
        }
      });
      expect([await rowsOf(s.branch), await rowsOf(other.branch)]).toEqual(before);
      expect(await ratingEntries()).toBe(audits);
    });
  });

  describe('the switch change', () => {
    async function editAs(calls: Calls, s: Scene, overrides: Record<string, unknown>) {
      const listed = subjectListSchema.parse(ok(await calls.get('/api/setup/subjects')));
      const subject = listed.subjects.find((one) => one.id === s.subject) as Subject;
      return calls.put(`/api/setup/subjects/${s.subject}`, {
        names: subject.names,
        departmentId: subject.departmentId,
        grades: subject.grades,
        colour: subject.colour,
        journalType: subject.journalType,
        ratingExam: subject.ratingExam,
        groupSubject: subject.groupSubject,
        languageRule: subject.languageRule,
        demanding: subject.demanding,
        daily: null,
        ...overrides,
      });
    }

    it('is refused while the started quarter holds scores, and free from the next quarter (edge/calculation)', async () => {
      const owner = await account();
      const vice = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(vice, s.branch, viceIn(s), async (calls) => {
        // No score yet: the change would be free; it is not sent.
        await as(owner, s.branch, teacherIn(s), async (teacher) => {
          ok(await teacher.put(`${base(s)}/date`, { date: '2026-10-26', version: null }));
          ok(
            await teacher.post(`${base(s)}/entries`, {
              studentId: s.ahmedov,
              entry: { kind: 'score', score: 70 },
              reason: null,
              version: null,
            }),
          );
        });
        const refused = await editAs(calls, s, { ratingExam: false, switchesFrom: 1 });
        expect(codeOf(refused)).toBe('subject_switch_scores');
        expect(
          (refused.body as { error: { details: { count: number }[] } }).error.details[0]?.count,
        ).toBe(1);
        // From quarter 2: quarter 1 keeps the exam (review must-fix 1).
        ok(await editAs(calls, s, { ratingExam: false, switchesFrom: 2 }));
      });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const grid = await gridOf(calls, s);
        expect(grid.rating?.entries).toHaveLength(1);
        expect((await gridOf(calls, s, s.q2)).rating).toBeNull();
      });
    });

    it('makes an entry wait for a switch change held on the subject row, then refuses it (item 8 of the plan)', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(await calls.put(`${base(s)}/date`, { date: '2026-10-26', version: null }));
        const answer = await whileHeld(
          s.branch,
          async (transaction) => {
            await transaction
              .updateTable('subjects')
              .set({ rating_exam: false, switches_from: 1 })
              .where('id', '=', s.subject)
              .execute();
          },
          () =>
            calls.post(`${base(s)}/entries`, {
              studentId: s.ahmedov,
              entry: { kind: 'score', score: 70 },
              reason: null,
              version: null,
            }),
        );
        expect(codeOf(answer)).toBe('rating_exam_off');
      });
    });

    it('makes a switch change wait for an entry held on the subject row, then refuses it', async () => {
      const owner = await account();
      const vice = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(await calls.put(`${base(s)}/date`, { date: '2026-10-26', version: null }));
      });
      const exam = await t.database.migrator
        .selectFrom('journal_rating_exams')
        .select('id')
        .where('journal_id', '=', s.journal)
        .executeTakeFirstOrThrow();
      await as(vice, s.branch, viceIn(s), async (calls) => {
        const answer = await whileHeld(
          s.branch,
          async (transaction) => {
            // What the entry route writes, behind the subject row FOR SHARE.
            await transaction
              .selectFrom('subjects')
              .select('id')
              .where('id', '=', s.subject)
              .forShare()
              .execute();
            await transaction
              .insertInto('journal_rating_entries')
              .values({
                branch_id: s.branch,
                rating_exam_id: exam.id,
                student_id: s.ahmedov,
                kind: 'score',
                score: 70,
                version: 1,
                changed_by: owner.account.id,
                changed_how: 'entry',
                changed_at: new Date(MOMENT),
              })
              .execute();
            await t.app.get(Audit).record(transaction, {
              branchId: s.branch,
              actorId: owner.account.id,
              action: 'test.rating_entry',
            });
          },
          () => editAs(calls, s, { ratingExam: false, switchesFrom: 1 }),
        );
        expect(codeOf(answer)).toBe('subject_switch_scores');
      });
    });
  });

  // Task 8.2: comments (07, Entering data, Comments; decision 10).
  describe('comments', () => {
    const commentOf = (body: unknown) => journalCommentSchema.parse(body);

    it('puts a comment on a mark, a number and a rating entry and a note on a lesson, with history', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const lesson = s.lessons[0] ?? '';
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        const onMark = { target: 'mark', lessonId: lesson, studentId: s.ahmedov };
        expect(
          codeOf(
            await calls.put('/api/journal/comments', {
              on: onMark,
              body: 'Came late',
              visibility: 'staff',
              version: null,
            }),
          ),
        ).toBe('comment_no_value');
        ok(await present(calls, lesson, s.ahmedov));
        const mark = commentOf(
          ok(
            await calls.put('/api/journal/comments', {
              on: onMark,
              body: 'Came late',
              visibility: 'staff',
              version: null,
            }),
          ),
        );
        expect(mark).toMatchObject({
          target: 'mark',
          body: 'Came late',
          visibility: 'staff',
          version: 1,
        });
        const note = commentOf(
          ok(
            await calls.put('/api/journal/comments', {
              on: { target: 'note', lessonId: lesson, studentId: s.boboyev },
              body: 'Helped a classmate',
              visibility: 'parents',
              version: null,
            }),
          ),
        );
        expect(note.visibility).toBe('parents');
        const work = workSavedSchema.parse(
          ok(await calls.post(`/api/journal/lessons/${lesson}/works`, { kind: 'classwork' })),
        );
        const total = workSavedSchema.parse(
          ok(
            await calls.put(`/api/journal/lessons/${lesson}/works/total`, {
              column: { workId: work.id },
              total: 10,
              version: work.version,
            }),
          ),
        );
        ok(
          await calls.post(`/api/journal/lessons/${lesson}/scores`, {
            saves: [
              { studentId: s.ahmedov, column: { workId: total.id }, score: 7, version: null },
            ],
          }),
        );
        ok(
          await calls.put('/api/journal/comments', {
            on: { target: 'work', lessonId: lesson, workId: total.id, studentId: s.ahmedov },
            body: 'Two answers copied',
            visibility: 'staff',
            version: null,
          }),
        );
        ok(await calls.put(`${base(s)}/date`, { date: '2026-10-26', version: null }));
        ok(
          await calls.post(`${base(s)}/entries`, {
            studentId: s.ahmedov,
            entry: { kind: 'score', score: 80 },
            reason: null,
            version: null,
          }),
        );
        ok(
          await calls.put('/api/journal/comments', {
            on: { target: 'rating', journalId: s.journal, quarterId: s.q1, studentId: s.ahmedov },
            body: 'Strong exam',
            visibility: 'parents',
            version: null,
          }),
        );
        // A stale version, then a clear: the row stays, the history keeps the text.
        expect(
          codeOf(
            await calls.put('/api/journal/comments', {
              on: onMark,
              body: 'x',
              visibility: 'staff',
              version: null,
            }),
          ),
        ).toBe('comment_stale');
        ok(
          await calls.put('/api/journal/comments', {
            on: onMark,
            body: null,
            visibility: 'staff',
            version: 1,
          }),
        );
        // The grid answers the cleared comment with no body and its version, so the
        // next save on the mark names that version (code review round 2).
        const grid = await gridOf(calls, s);
        const ahmedov = grid.students.find((one) => one.id === s.ahmedov);
        expect(ahmedov?.comments.map((one) => [one.target, one.body, one.version]).sort()).toEqual([
          ['mark', null, 2],
          ['rating', 'Strong exam', 1],
          ['work', 'Two answers copied', 1],
        ]);
        const again = journalCommentSchema.parse(
          ok(
            await calls.put('/api/journal/comments', {
              on: onMark,
              body: 'Came late again',
              visibility: 'staff',
              version: 2,
            }),
          ),
        );
        expect([again.body, again.version]).toEqual(['Came late again', 3]);
        const boboyev = grid.students.find((one) => one.id === s.boboyev);
        expect(boboyev?.comments.map((one) => [one.target, one.body])).toEqual([
          ['note', 'Helped a classmate'],
        ]);
        const history = commentHistorySchema.parse(
          ok(
            await calls.get(
              `/api/journal/comments/history?target=mark&studentId=${s.ahmedov}&lessonId=${lesson}`,
            ),
          ),
        );
        expect(history.lines.map((one) => [one.bodyBefore, one.bodyAfter])).toEqual([
          [null, 'Came late'],
          ['Came late', null],
          [null, 'Came late again'],
        ]);
      });
      expect((await t.entries('journal.comment')).length).toBeGreaterThanOrEqual(5);
      // Data on a lesson (edge/00-definitions): a note alone is data.
      const holds = await sql<{ holds: boolean }>`
        select lesson_holds_data(${lesson}::uuid) as holds
      `.execute(t.database.migrator);
      expect(holds.rows[0]?.holds).toBe(true);
    });

    it('lets whoever may enter comment, and shows a reader of attendance the comments of marks only', async () => {
      const owner = await account();
      const stranger = await account();
      const spiritual = await account();
      const s = await scene({ teacher: owner.account.id });
      const lesson = s.lessons[0] ?? '';
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(await present(calls, lesson, s.ahmedov));
        ok(
          await calls.put('/api/journal/comments', {
            on: { target: 'mark', lessonId: lesson, studentId: s.ahmedov },
            body: 'Came late',
            visibility: 'staff',
            version: null,
          }),
        );
        ok(
          await calls.put('/api/journal/comments', {
            on: { target: 'note', lessonId: lesson, studentId: s.ahmedov },
            body: 'Quiet today',
            visibility: 'staff',
            version: null,
          }),
        );
      });
      const before = await t.database.migrator
        .selectFrom('journal_comments')
        .selectAll()
        .orderBy('id')
        .execute();
      await as(stranger, s.branch, [{ role: 'teacher', branchId: s.branch }], async (calls) => {
        expect(
          codeOf(
            await calls.put('/api/journal/comments', {
              on: { target: 'note', lessonId: lesson, studentId: s.boboyev },
              body: 'Not mine',
              visibility: 'staff',
              version: null,
            }),
          ),
        ).toBe('comment_scope');
        expect(
          codeOf(
            await calls.put('/api/journal/comments', {
              on: { target: 'rating', journalId: s.journal, quarterId: s.q1, studentId: s.ahmedov },
              body: 'Not mine',
              visibility: 'staff',
              version: null,
            }),
          ),
        ).toBe('comment_scope');
      });
      expect(
        await t.database.migrator
          .selectFrom('journal_comments')
          .selectAll()
          .orderBy('id')
          .execute(),
      ).toEqual(before);
      await as(
        spiritual,
        s.branch,
        [{ role: 'spiritual_vice_principal', branchId: s.branch }],
        async (calls) => {
          const grid = await gridOf(calls, s);
          expect(grid.rating).toBeNull();
          expect(
            grid.students.find((one) => one.id === s.ahmedov)?.comments.map((one) => one.target),
          ).toEqual(['mark']);
          expect(
            codeOf(
              await calls.get(
                `/api/journal/comments/history?target=note&studentId=${s.ahmedov}&lessonId=${lesson}`,
              ),
            ),
          ).toBe('journal_scope');
          ok(
            await calls.get(
              `/api/journal/comments/history?target=mark&studentId=${s.ahmedov}&lessonId=${lesson}`,
            ),
          );
        },
      );
    });

    it('answers 404 for another branch’s lesson, an unknown work and an unknown student, and writes nothing', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const other = await scene();
      const lesson = s.lessons[0] ?? '';
      const before = await t.database.migrator
        .selectFrom('journal_comments')
        .selectAll()
        .orderBy('id')
        .execute();
      // Task 10.3b: a work of each branch, for the ids of a comment on a number.
      const workOf = async (branch: string, lessonId: string) =>
        (
          await t.database.migrator
            .insertInto('journal_works')
            .values({
              branch_id: branch,
              lesson_id: lessonId,
              source_lesson_id: lessonId,
              position: 1,
              kind: 'classwork',
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      const work = await workOf(s.branch, lesson);
      const otherWork = await workOf(other.branch, other.lessons[0] ?? '');
      const audits = await t.auditCount();
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(await present(calls, lesson, s.ahmedov));
        const audited = await t.auditCount();
        const send = (on: object) =>
          calls.put('/api/journal/comments', {
            on,
            body: 'Text',
            visibility: 'staff',
            version: null,
          });
        for (const on of [
          { target: 'note', lessonId: other.lessons[0] ?? '', studentId: s.ahmedov },
          { target: 'note', lessonId: randomUUID(), studentId: s.ahmedov },
          { target: 'note', lessonId: lesson, studentId: other.ahmedov },
          { target: 'note', lessonId: lesson, studentId: randomUUID() },
          { target: 'work', lessonId: lesson, workId: randomUUID(), studentId: s.ahmedov },
          { target: 'rating', journalId: other.journal, quarterId: other.q1, studentId: s.ahmedov },
          { target: 'rating', journalId: s.journal, quarterId: randomUUID(), studentId: s.ahmedov },
          // Task 10.3b: every id of every target, another branch's and an unknown one.
          { target: 'mark', lessonId: other.lessons[0] ?? '', studentId: s.ahmedov },
          { target: 'mark', lessonId: randomUUID(), studentId: s.ahmedov },
          { target: 'mark', lessonId: lesson, studentId: other.ahmedov },
          { target: 'mark', lessonId: lesson, studentId: randomUUID() },
          { target: 'work', lessonId: other.lessons[0] ?? '', workId: work, studentId: s.ahmedov },
          { target: 'work', lessonId: randomUUID(), workId: work, studentId: s.ahmedov },
          { target: 'work', lessonId: lesson, workId: otherWork, studentId: s.ahmedov },
          { target: 'work', lessonId: lesson, workId: work, studentId: other.ahmedov },
          { target: 'work', lessonId: lesson, workId: work, studentId: randomUUID() },
          { target: 'rating', journalId: other.journal, quarterId: s.q1, studentId: s.ahmedov },
          { target: 'rating', journalId: randomUUID(), quarterId: s.q1, studentId: s.ahmedov },
          { target: 'rating', journalId: s.journal, quarterId: other.q1, studentId: s.ahmedov },
          { target: 'rating', journalId: s.journal, quarterId: s.q1, studentId: other.ahmedov },
          { target: 'rating', journalId: s.journal, quarterId: s.q1, studentId: randomUUID() },
        ]) {
          expect(codeOf(await send(on))).toBe('not_found');
        }
        expect(
          codeOf(
            await calls.get(
              `/api/journal/comments/history?target=note&studentId=${s.ahmedov}&lessonId=${other.lessons[0] ?? ''}`,
            ),
          ),
        ).toBe('not_found');
        expect(await t.auditCount()).toBe(audited);
      });
      expect(
        await t.database.migrator
          .selectFrom('journal_comments')
          .selectAll()
          .orderBy('id')
          .execute(),
      ).toEqual(before);
      expect(await t.auditCount()).toBeGreaterThan(audits);
    });

    // Code review round 1, defect 1: a student of the branch not expected in the
    // lesson on its date is refused `cell_closed`, never a 500 from the trigger.
    it('refuses a note on a student outside the lesson on its date, and a comment on the mark of one who left, as a closed cell', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const lesson = s.lessons[0] ?? '';
      const joinedLater = await student(s.branch, s.classId, 'Karimov', '2026-10-20');
      const comments = () =>
        Promise.all(
          (['journal_comments', 'journal_comment_history'] as const).map((table) =>
            t.database.migrator.selectFrom(table).selectAll().orderBy('id').execute(),
          ),
        );
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(await present(calls, lesson, s.ahmedov));
        // Ahmedov's mark stays, and he leaves on the lesson's date.
        const members = new MembersKit(t.database.migrator, await load.classes.account());
        await t.database.migrator.transaction().execute(async (transaction) => {
          const leavingId = await members.leaving(transaction, s.branch, s.ahmedov, '2026-10-12');
          await transaction
            .updateTable('class_memberships')
            .set({ valid_until: '2026-10-12', ended_by: 'leaving', leaving_id: leavingId })
            .where('student_id', '=', s.ahmedov)
            .execute();
        });
        const before = await comments();
        const audits = await t.auditCount();
        const send = (on: object) =>
          calls.put('/api/journal/comments', {
            on,
            body: 'Text',
            visibility: 'staff',
            version: null,
          });
        // The route's own check.
        expect(
          codeOf(await send({ target: 'note', lessonId: lesson, studentId: joinedLater })),
        ).toBe('cell_closed');
        // The trigger's refusal, mapped by the route.
        expect(codeOf(await send({ target: 'mark', lessonId: lesson, studentId: s.ahmedov }))).toBe(
          'cell_closed',
        );
        expect(await comments()).toEqual(before);
        expect(await t.auditCount()).toBe(audits);
      });
    });

    it('keeps the comments of a lesson through its forced delete and restore', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const lesson = s.lessons[0] ?? '';
      await as(owner, s.branch, teacherIn(s), async (calls) => {
        ok(
          await calls.put('/api/journal/comments', {
            on: { target: 'note', lessonId: lesson, studentId: s.ahmedov },
            body: 'Quiet today',
            visibility: 'parents',
            version: null,
          }),
        );
      });
      // The Super Admin acts at the kit's own moment, as the plan tests do.
      {
        const deleted = await request(t.kit.server)
          .post(`/api/timetable/lessons/${lesson}/forced-delete`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, s.branch)
          .set('Idempotency-Key', randomUUID())
          .send({ reason: 'Entered for the wrong class' });
        expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
        expect(
          await t.database.migrator
            .selectFrom('journal_comments')
            .select('id')
            .where('lesson_id', '=', lesson)
            .execute(),
        ).toEqual([]);
        const store = await t.database.migrator
          .selectFrom('forced_deletes')
          .select('id')
          .where('record_id', '=', lesson)
          .executeTakeFirstOrThrow();
        const restored = await request(t.kit.server)
          .post(`/api/forced-deletes/${store.id}/restore`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, s.branch)
          .set('Idempotency-Key', randomUUID())
          .send({});
        expect(restored.status, JSON.stringify(restored.body)).toBe(200);
      }
      const back = await t.database.migrator
        .selectFrom('journal_comments')
        .select(['body', 'visibility', 'version'])
        .where('lesson_id', '=', lesson)
        .execute();
      expect(back).toEqual([{ body: 'Quiet today', visibility: 'parents', version: 1 }]);
      const lines = await t.database.migrator
        .selectFrom('journal_comment_history')
        .select('changed_how')
        .where('lesson_id', '=', lesson)
        .orderBy('changed_at')
        .orderBy('version')
        .execute();
      expect(lines.map((one) => one.changed_how).sort()).toEqual([
        'entry',
        'forced_delete',
        'restored',
      ]);
    });
  });

  /**
   * Holds `hold` open in a transaction of the application in `branch`, starts
   * `run`, sees it wait on the held transaction, then commits and answers it.
   */
  async function whileHeld(
    branch: string,
    hold: (transaction: Transaction) => Promise<void>,
    run: () => Promise<Response>,
  ): Promise<Response> {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: (pid: number) => void = () => undefined;
    const isReady = new Promise<number>((resolve) => {
      ready = resolve;
    });
    const held = t.app
      .get(Transactions)
      .run([branch], async (transaction) => {
        await hold(transaction);
        const pid = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(transaction);
        ready(pid.rows[0]?.pid ?? 0);
        await released;
      })
      .catch((error: unknown) => error);
    const heldPid = await isReady;
    // A supertest request is sent only once it is awaited: start it now.
    const answer = new Promise<Response>((resolve, reject) => {
      run().then(resolve, reject);
    });
    let waited = false;
    for (let tries = 0; tries < 800 && !waited; tries += 1) {
      const found = await sql<{ n: number }>`
        select count(*)::int as n from pg_stat_activity a
        where a.datname = current_database() and ${heldPid}::int = any (pg_blocking_pids(a.pid))
      `.execute(t.database.migrator);
      waited = (found.rows[0]?.n ?? 0) >= 1;
      if (!waited) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    release();
    expect(waited, 'the route waited on the held transaction').toBe(true);
    const heldError = await held;
    if (heldError !== undefined) {
      throw heldError instanceof Error ? heldError : new Error('The hold failed.');
    }
    return answer;
  }
});
