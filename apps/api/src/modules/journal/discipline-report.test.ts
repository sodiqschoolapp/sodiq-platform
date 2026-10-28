import {
  BRANCH_HEADER,
  DISCIPLINE_COLUMNS,
  disciplineItemsSchema,
  disciplineSchema,
  REQUEST_KEY_HEADER,
  type Discipline,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setEditDays } from '../../testing/branch-filter-sql.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';
import { binary } from '../../testing/xlsx-kit.js';

/** Wednesday 28 October 2026: the 12th and the 19th are locked (7 edit days). */
const MOMENT = '2026-10-28T12:00:00+05:00';

const RANGE = 'from=2026-10-12&to=2026-10-28';

const ok = (response: Response, status = 200): unknown => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response.body;
};

// All names are invented. Task 9.3b-2: the Journal discipline report of
// docs/spec/08-results-rating-analytics.md, Analytics in Release 1 ("works with scores missing,
// unplanned works, entries made after the edit period"), its export and the items behind each
// count (8.7 decision 6; plan review finding 7), with a rating exam's entries after the edit
// period counted when the exam's date is in the range (decision 11).
describe('the journal discipline report: its items and its file (task 9.3b-2)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Malika', `Qodirova${'a'.repeat(names % 7)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };
  interface Calls {
    get: (path: string) => Promise<Response>;
    post: (path: string, body?: object) => Promise<Response>;
    put: (path: string, body: object) => Promise<Response>;
    file: (path: string, body: object) => Promise<Response>;
  }

  const given = new Set<string>();

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
        file: (path, body) => at('post', path).buffer(true).parse(binary).send(body),
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
   * Graded maths with a rating exam, Mondays 12, 19, 26 October at 08:00, owned by `owner`:
   * the 12th marked late under the teacher's own unlock, a classwork added by hand on the 19th
   * while open, and the rating exam of the 19th scored, then scored again under its unlock.
   */
  async function scene() {
    const owner = await account();
    const vice = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id },
    });
    await setEditDays(t.database.migrator, s.branch, 7);
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
    const [first, second] = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('lesson_date', '>=', '2026-10-12')
        .orderBy('starts_at')
        .execute()
    ).map((row) => row.id);
    if (first === undefined || second === undefined) throw new Error('The lessons of October.');
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
    const ahmedov = await student(s.branch, s.classId, 'Ahmedov');
    const teacher = [{ role: 'teacher' as const, branchId: s.branch }];
    const viceIn = [{ role: 'academic_vice_principal' as const, branchId: s.branch }];
    const ratingBase = `/api/journal/journals/${journal}/rating/${q1}`;
    await as(
      owner,
      s.branch,
      teacher,
      async (calls) => {
        ok(
          await calls.post(`/api/journal/lessons/${second}/attendance`, {
            saves: [{ studentId: ahmedov, mark: 1, version: null }],
          }),
        );
        ok(await calls.post(`/api/journal/lessons/${second}/works`, { kind: 'classwork' }));
        ok(await calls.put(`${ratingBase}/date`, { date: '2026-10-19', version: null }));
        ok(
          await calls.post(`${ratingBase}/entries`, {
            studentId: ahmedov,
            entry: { kind: 'score', score: 70 },
            reason: null,
            version: null,
          }),
        );
      },
      '2026-10-20T12:00:00+05:00',
    );
    const unlock = async (path: string) => {
      const sent = ok(
        await as(owner, s.branch, teacher, (calls) =>
          calls.post(path, { reason: 'I was ill that week' }),
        ),
        201,
      ) as { id: string; version: number };
      await as(vice, s.branch, viceIn, async (calls) => {
        ok(
          await calls.post(`/api/journal/unlocks/${sent.id}/decide`, {
            decision: 'approve',
            days: 2,
            version: sent.version,
          }),
        );
      });
    };
    await unlock(`/api/journal/lessons/${first}/unlocks`);
    await unlock(`${ratingBase}/unlocks`);
    await as(owner, s.branch, teacher, async (calls) => {
      ok(
        await calls.post(`/api/journal/lessons/${first}/attendance`, {
          saves: [{ studentId: ahmedov, mark: 2, version: null }],
        }),
      );
      ok(
        await calls.post(`${ratingBase}/entries`, {
          studentId: ahmedov,
          entry: { kind: 'score', score: 72 },
          reason: 'Retake',
          version: 1,
        }),
      );
    });
    return { s, owner, vice, viceIn, journal, first, second };
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  it('lists the items behind each count of a teacher, adding up to the count, a rating exam’s late entries among them', async () => {
    const c = await scene();
    await as(c.vice, c.s.branch, c.viceIn, async (calls) => {
      const counts = disciplineSchema.parse(
        ok(await calls.get(`/api/journal/discipline?${RANGE}`)),
      );
      const row = counts.teachers.find((one) => one.teacher.id === c.s.teacher.staffId);
      // The lesson's late mark and the exam's late score (decision 11).
      expect(row).toMatchObject({ held: 3, lateEntries: 2, unplanned: 1 });
      for (const column of DISCIPLINE_COLUMNS) {
        const items = disciplineItemsSchema.parse(
          ok(
            await calls.get(
              `/api/journal/discipline/items?${RANGE}&teacherId=${c.s.teacher.staffId}&column=${column}`,
            ),
          ),
        );
        const sum = items.items.reduce((total, item) => total + item.count, 0);
        expect(sum, column).toBe(row?.[column as keyof Discipline['teachers'][number]]);
      }
      const late = disciplineItemsSchema.parse(
        ok(
          await calls.get(
            `/api/journal/discipline/items?${RANGE}&teacherId=${c.s.teacher.staffId}&column=lateEntries`,
          ),
        ),
      );
      expect(late.items.map((one) => [one.kind, one.date, one.count])).toEqual([
        ['entries', '2026-10-12', 1],
        ['exam_entries', '2026-10-19', 1],
      ]);
      // An exam outside the range counts for nothing.
      const before = disciplineSchema.parse(
        ok(await calls.get('/api/journal/discipline?from=2026-10-12&to=2026-10-18')),
      );
      expect(
        before.teachers.find((one) => one.teacher.id === c.s.teacher.staffId)?.lateEntries,
      ).toBe(1);
    });
  });

  it('answers 404 for a teacher outside the counts, unknown or of another branch, and for the teacher of another subject to a Head Teacher', async () => {
    const c = await scene();
    const other = await scene();
    const elsewhere = await load.classes.subject({ grades: [7] });
    const path = (teacherId: string) =>
      `/api/journal/discipline/items?${RANGE}&teacherId=${teacherId}&column=held`;
    await as(c.vice, c.s.branch, c.viceIn, async (calls) => {
      for (const id of [UNKNOWN, other.s.teacher.staffId, c.s.spareTeacher.staffId]) {
        expect((await calls.get(path(id))).status, id).toBe(404);
      }
      expect((await calls.get(path(c.s.teacher.staffId))).status).toBe(200);
    });
    for (const held of [
      { role: 'head_teacher' as const, branchId: c.s.branch, subjectIds: [elsewhere] },
      { role: 'senior_head_teacher' as const, subjectIds: [elsewhere] },
    ]) {
      await as(await account(), c.s.branch, [held], async (calls) => {
        expect((await calls.get(path(c.s.teacher.staffId))).status, held.role).toBe(404);
        const file = await calls.file('/api/journal/discipline/export', {
          from: '2026-10-12',
          to: '2026-10-28',
        });
        expect(file.status, held.role).toBe(200);
      });
    }
    await as(
      await account(),
      c.s.branch,
      [{ role: 'head_teacher', branchId: c.s.branch, subjectIds: [c.s.subject] }],
      async (calls) => {
        expect((await calls.get(path(c.s.teacher.staffId))).status).toBe(200);
      },
    );
  });

  it('exports the counts per teacher as Excel with the range and the moment, one audit entry, only the reader’s teachers, and refuses a range over 92 days', async () => {
    const c = await scene();
    const elsewhere = await load.classes.subject({ grades: [7] });
    const linesOf = async (content: Buffer): Promise<unknown[][]> => {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(content as unknown as ArrayBuffer);
      const lines: unknown[][] = [];
      workbook.worksheets[0]?.eachRow({ includeEmpty: true }, (row) => {
        lines.push((row.values as unknown[]).slice(1));
      });
      return lines;
    };
    const entries = async () =>
      (
        await t.database.migrator
          .selectFrom('audit_log')
          .select('id')
          .where('branch_id', '=', c.s.branch)
          .where('action', '=', 'discipline_report.export')
          .execute()
      ).length;
    await as(c.vice, c.s.branch, c.viceIn, async (calls) => {
      ok(await calls.get(`/api/journal/discipline?${RANGE}`));
      expect(await entries()).toBe(0);
      const file = await calls.file('/api/journal/discipline/export', {
        from: '2026-10-12',
        to: '2026-10-28',
      });
      expect(file.status).toBe(200);
      const lines = await linesOf(file.body as Buffer);
      expect(String(lines[0]?.[0])).toContain('12.10.2026');
      expect(lines.slice(3).length).toBeGreaterThan(0);
      expect(await entries()).toBe(1);
      const refused = await calls.file('/api/journal/discipline/export', {
        from: '2026-09-01',
        to: '2026-12-15',
      });
      expect(refused.status).toBe(409);
      expect(await entries()).toBe(1);
    });
    // A Head Teacher of another subject: a file with no teacher of maths in it.
    await as(
      await account(),
      c.s.branch,
      [{ role: 'head_teacher', branchId: c.s.branch, subjectIds: [elsewhere] }],
      async (calls) => {
        const file = await calls.file('/api/journal/discipline/export', {
          from: '2026-10-12',
          to: '2026-10-28',
        });
        expect(file.status).toBe(200);
        expect((await linesOf(file.body as Buffer)).slice(3)).toEqual([]);
      },
    );
    // The roles outside the area: the guard.
    await as(
      await account(),
      c.s.branch,
      [{ role: 'teacher', branchId: c.s.branch }],
      async (calls) => {
        const file = await calls.file('/api/journal/discipline/export', {
          from: '2026-10-12',
          to: '2026-10-28',
        });
        expect(file.status).toBe(403);
      },
    );
  });

  // Permission review, must-fixes 1 and 2, should-fix 4: the Head Tutor's scope (the Tutor
  // subjects), a second role that reads more, and the department id.
  it('keeps the Head Tutor to the Tutor subjects and a Head Teacher who also teaches to own subjects, in the items and the file, and answers 404 for an unknown department', async () => {
    const c = await scene();
    const elsewhere = await load.classes.subject({ grades: [7] });
    const linesOf = async (content: Buffer): Promise<unknown[][]> => {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(content as unknown as ArrayBuffer);
      const lines: unknown[][] = [];
      workbook.worksheets[0]?.eachRow({ includeEmpty: true }, (row) => {
        lines.push((row.values as unknown[]).slice(1));
      });
      return lines;
    };
    const items = `/api/journal/discipline/items?${RANGE}&teacherId=${c.s.teacher.staffId}&column=held`;
    const body = { from: '2026-10-12', to: '2026-10-28' };
    for (const roles of [
      [{ role: 'head_tutor' as const, branchId: c.s.branch }],
      [
        { role: 'teacher' as const, branchId: c.s.branch },
        { role: 'head_teacher' as const, branchId: c.s.branch, subjectIds: [elsewhere] },
      ],
    ]) {
      await as(await account(), c.s.branch, roles, async (calls) => {
        const what = roles.map((one) => one.role).join('+');
        expect((await calls.get(items)).status, what).toBe(404);
        const file = await calls.file('/api/journal/discipline/export', body);
        expect(file.status, what).toBe(200);
        expect((await linesOf(file.body as Buffer)).slice(3), what).toEqual([]);
      });
    }
    await as(c.vice, c.s.branch, c.viceIn, async (calls) => {
      expect((await calls.get(`${items}&departmentId=${UNKNOWN}`)).status).toBe(404);
      expect(
        (await calls.file('/api/journal/discipline/export', { ...body, departmentId: UNKNOWN }))
          .status,
      ).toBe(404);
    });
  });
});
