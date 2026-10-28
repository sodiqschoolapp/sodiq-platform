import { finalQuarterRecord } from '@sodiq/calc';
import {
  attendanceReportSchema,
  BRANCH_HEADER,
  closingChecklistSchema,
  resultsReportChoicesSchema,
  resultsTableSchema,
  subjectMasterySchema,
  type AttendanceReport,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { closeQuarter } from '../../testing/closing-kit.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit, type MemberRow } from '../../testing/members-kit.js';
import { prepareBranch, withoutStamp } from '../../testing/prepared-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { binary } from '../../testing/xlsx-kit.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): unknown =>
  (response.body as { error?: { code?: string } }).error?.code;

/** Every line of the first sheet of a file, preamble included, as Excel holds it. */
async function linesOf(content: Buffer): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(content as unknown as ArrayBuffer);
  const [sheet] = workbook.worksheets;
  const lines: unknown[][] = [];
  sheet?.eachRow({ includeEmpty: true }, (row) => {
    lines.push((row.values as unknown[]).slice(1));
  });
  return lines;
}

// All names are invented. Task 9.3b-2: the reports of docs/spec/08-results-rating-analytics.md,
// Analytics in Release 1 (Attendance, Results table, Subject mastery); docs/spec/07-journal.md,
// Effect on totals; docs/spec/edge-cases/journal.md, Attendance figures;
// docs/spec/edge-cases/00-definitions.md, Held lesson, Reference date and Result states;
// docs/spec/edge-cases/system-behaviour.md, "Report totals are two minutes behind the journal".
describe('the reports of 08 over the journal (task 9.3b-2)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Sevara', `Nazarova${'a'.repeat(names % 7)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };
  type Call = {
    get: (path: string) => Promise<Response>;
    post: (path: string, body: object) => Promise<Response>;
  };

  async function as<T>(
    browser: Browser,
    branch: string,
    roles: readonly Omit<Held, 'validFrom'>[],
    work: (call: Call) => Promise<T>,
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
        get: (path) =>
          request(t.kit.server).get(path).set('Cookie', browser.cookie).set(BRANCH_HEADER, branch),
        post: (path, body) =>
          request(t.kit.server)
            .post(path)
            .set('Cookie', browser.cookie)
            .set(BRANCH_HEADER, branch)
            .buffer(true)
            .parse(binary)
            .send(body),
      });
    } finally {
      t.clock.set(START);
    }
  }

  const saveOn = async (
    branch: string,
    date: string,
    cells: { lessonId: string; studentId: string; workId?: string; value: number }[],
  ) => {
    t.clock.set(`${date}T18:00:00+05:00`);
    try {
      const writer = await load.classes.account();
      await t.app.get(Transactions).run([branch], (transaction) =>
        saveCells(
          transaction,
          t.app.get(Audit),
          { accountId: writer },
          cells.map((cell) => ({
            lessonId: cell.lessonId,
            studentId: cell.studentId,
            workId: cell.workId ?? null,
            value: cell.value,
            version: null,
          })),
        ),
      );
    } finally {
      t.clock.set(START);
    }
  };

  const student = async (
    branch: string,
    name: { first: string; last: string },
    rows: readonly Omit<MemberRow, 'branch' | 'studentId'>[],
  ): Promise<string> => {
    const kit = new MembersKit(t.database.migrator, await load.classes.account());
    const id = await kit.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: name.first, last_name: name.last })
      .where('id', '=', id)
      .execute();
    for (const row of rows) await kit.member({ branch, studentId: id, ...row });
    return id;
  };

  const lessonsOf = async (classId: string, subjectId: string) =>
    (
      await t.database.migrator
        .selectFrom('lessons')
        .select(['id', sql<string>`lesson_date::text`.as('date')])
        .where('class_id', '=', classId)
        .where('subject_id', '=', subjectId)
        .where('lesson_date', '<=', '2026-10-31')
        .orderBy('starts_at')
        .execute()
    ).map((one) => ({ id: one.id, date: one.date }));

  const quarterOf = async (scene: PublishedScene, number: number) =>
    (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', scene.year)
        .where('number', '=', number)
        .executeTakeFirstOrThrow()
    ).id;

  const journalOf = async (classId: string, subjectId: string) =>
    (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', classId)
        .where('subject_id', '=', subjectId)
        .executeTakeFirstOrThrow()
    ).id;

  /** An all-subjects exemption of the student, written as the service writes one. */
  const exempt = async (scene: PublishedScene, studentId: string, from: string, until: string) => {
    const writer = await load.classes.account();
    await t.app.get(Transactions).run([scene.branch], async (transaction) => {
      await t.app.get(Audit).record(transaction, {
        branchId: scene.branch,
        actorId: writer,
        action: 'exemption.create',
      });
      await transaction
        .insertInto('exemptions')
        .values({
          branch_id: scene.branch,
          student_id: studentId,
          year_id: scene.year,
          batch_id: '019a0000-0000-7000-8000-0000000000a2',
          kind: 'temporary',
          all_subjects: true,
          start_date: from,
          end_date: until,
          start_time: null,
          end_time: null,
          category: 'illness',
          detail: 'A certificate from the clinic',
          granted_by: writer,
          granted_at: new Date(0),
          version: 0,
          changed_at: new Date(0),
        })
        .execute();
    });
  };

  /**
   * The graded maths of the first class (20 · 40 · 40), Mondays 12, 19 and 26 October in the first
   * slot, and the other class's attendance-only subject in the third:
   * - the 12th: Aziz present with 9 of 10, Bobur late with 6 of 10, Dilnoza absent, Erkin skipped,
   *   Farrux unmarked; Gulnora exempt all October;
   * - the 19th: Aziz and Bobur present, the others unmarked;
   * - the 26th: nothing entered.
   */
  async function scene(accounts?: { readonly teacher?: string; readonly spare?: string }) {
    const s = await publishedScene(t, load, {
      graded: true,
      secondSubject: true,
      ...(accounts === undefined ? {} : { accounts }),
    });
    const [l12, l19, l26] = await lessonsOf(s.classId, s.subject);
    if (l12 === undefined || l19 === undefined || l26 === undefined) {
      throw new Error('The lessons of the first class.');
    }
    const first = [{ classId: s.classId, from: '2026-09-01' }];
    const aziz = await student(s.branch, { first: 'Aziz', last: 'Akbarov' }, first);
    const bobur = await student(s.branch, { first: 'Bobur', last: 'Boboyev' }, first);
    const dilnoza = await student(s.branch, { first: 'Dilnoza', last: 'Dadaxonova' }, first);
    const erkin = await student(s.branch, { first: 'Erkin', last: 'Ergashev' }, first);
    const farrux = await student(s.branch, { first: 'Farrux', last: 'Fozilov' }, first);
    const gulnora = await student(s.branch, { first: 'Gulnora', last: 'Gulomova' }, first);
    await exempt(s, gulnora, '2026-10-01', '2026-10-31');
    const work = (
      await t.database.migrator
        .insertInto('journal_works')
        .values({ branch_id: s.branch, lesson_id: l12.id, kind: 'classwork', total: 10 })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await saveOn(s.branch, l12.date, [
      { lessonId: l12.id, studentId: aziz, value: 1 },
      { lessonId: l12.id, studentId: bobur, value: 2 },
      { lessonId: l12.id, studentId: dilnoza, value: 0 },
      { lessonId: l12.id, studentId: erkin, value: 3 },
      { lessonId: l12.id, studentId: aziz, workId: work, value: 9 },
      { lessonId: l12.id, studentId: bobur, workId: work, value: 6 },
    ]);
    await saveOn(s.branch, l19.date, [
      { lessonId: l19.id, studentId: aziz, value: 1 },
      { lessonId: l19.id, studentId: bobur, value: 1 },
    ]);
    return {
      s,
      q1: await quarterOf(s, 1),
      journal: await journalOf(s.classId, s.subject),
      lessons: { l12, l19, l26 },
      students: { aziz, bobur, dilnoza, erkin, farrux, gulnora },
    };
  }

  const attendanceOf = (response: Response): AttendanceReport => {
    expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(200);
    return attendanceReportSchema.parse(response.body);
  };

  const RANGE = 'from=2026-10-12&to=2026-10-31';

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  it('counts the attendance of held lessons by category, exempt apart and out of the expected, with the daily percent of edge/journal', async () => {
    const c = await scene();
    await as(
      await account(),
      c.s.branch,
      [{ role: 'academic_vice_principal', branchId: c.s.branch }],
      async ({ get }) => {
        const report = attendanceOf(
          await get(`/api/results/reports/attendance?${RANGE}&subjectId=${c.s.subject}`),
        );
        const row = report.rows.find(
          (one) => one.key.kind === 'class' && one.key.class.id === c.s.classId,
        );
        // Three held lessons of six members: 12th 1 present, 1 late, 1 absent, 1 skipped,
        // 1 unmarked; 19th 2 present, 3 unmarked; 26th 5 unmarked; Gulnora exempt three times.
        expect(row?.counts).toEqual({
          present: 3,
          late: 1,
          absent: 1,
          skipped: 1,
          unmarked: 9,
          exempt: 3,
          expected: 15,
          percents: { present: 20, late: 7, absent: 7, skipped: 7, unmarked: 60, exempt: 17 },
        });
        // Present or late over the marked cells of non-exempt students (4 of 6), unmarked apart.
        expect(row?.daily).toEqual({
          attended: 4,
          marked: 6,
          unmarked: 9,
          exempt: 3,
          percent: 67,
        });
        expect(report.choices.starts).toEqual([480]);
        // The other class's lessons are of the other subject only: left out by the filter.
        expect(report.rows).toHaveLength(1);
        // The attendance-only subject is in the attendance report (edge/calculation).
        await student(c.s.branch, { first: 'Hilola', last: 'Hamidova' }, [
          { classId: c.s.otherClass, from: '2026-09-01' },
        ]);
        const all = attendanceOf(await get(`/api/results/reports/attendance?${RANGE}`));
        expect(all.choices.subjects.map((one) => one.id).sort()).toEqual(
          [c.s.subject, c.s.secondSubject].sort(),
        );
        // A class chosen: its days.
        const days = attendanceOf(
          await get(
            `/api/results/reports/attendance?${RANGE}&classId=${c.s.classId}&subjectId=${c.s.subject}`,
          ),
        );
        expect(days.days.map((one) => [one.date, one.daily.percent])).toEqual([
          ['2026-10-12', 50],
          ['2026-10-19', 100],
          ['2026-10-26', null],
        ]);
        // The period of the day: no lesson starts at 09:00.
        const none = attendanceOf(
          await get(`/api/results/reports/attendance?${RANGE}&subjectId=${c.s.subject}&start=540`),
        );
        expect(none.rows).toEqual([]);
        expect(none.total.counts.expected).toBe(0);
      },
    );
  });

  it('counts a lesson once it has started, with no change of data, and shows "updating" until the totals are prepared', async () => {
    const c = await scene();
    const browser = await account();
    const path = `/api/results/reports/attendance?${RANGE}&subjectId=${c.s.subject}`;
    const held = (report: AttendanceReport) =>
      report.rows.reduce((sum, row) => sum + row.counts.expected + row.counts.exempt, 0);
    const roles = [{ role: 'academic_vice_principal' as const, branchId: c.s.branch }];
    // Monday 26 October at 07:59: the 26th's lesson (08:00) has not started.
    const before = await as(
      browser,
      c.s.branch,
      roles,
      async ({ get }) => attendanceOf(await get(path)),
      '2026-10-26T07:59:00+05:00',
    );
    expect(held(before)).toBe(12);
    const after = await as(
      browser,
      c.s.branch,
      [],
      async ({ get }) => attendanceOf(await get(path)),
      '2026-10-26T08:00:00+05:00',
    );
    expect(held(after)).toBe(18);
    // Nothing prepared yet: read from source, "updating".
    expect(after.prepared.updating).toBe(true);
    t.clock.set(MOMENT);
    try {
      await prepareBranch(t, c.s.branch);
    } finally {
      t.clock.set(START);
    }
    const prepared = await as(browser, c.s.branch, [], async ({ get }) =>
      attendanceOf(await get(path)),
    );
    expect(prepared.prepared.updating).toBe(false);
    expect(prepared.prepared.updatedAt).not.toBeNull();
    const fromSource = await as(browser, c.s.branch, [], async ({ get }) =>
      attendanceOf(await get(path)),
    );
    expect(withoutStamp(prepared)).toEqual(withoutStamp(fromSource));
    expect(held(prepared)).toBe(18);
    // A mark saved after the preparation: behind, the figure from source, then prepared again.
    await saveOn(c.s.branch, '2026-10-26', [
      { lessonId: c.lessons.l26.id, studentId: c.students.farrux, value: 1 },
    ]);
    const behind = await as(browser, c.s.branch, [], async ({ get }) =>
      attendanceOf(await get(path)),
    );
    expect(behind.prepared.updating).toBe(true);
    expect(behind.rows[0]?.counts.present).toBe(4);
    t.clock.set(MOMENT);
    try {
      await prepareBranch(t, c.s.branch);
    } finally {
      t.clock.set(START);
    }
    const again = await as(browser, c.s.branch, [], async ({ get }) =>
      attendanceOf(await get(path)),
    );
    expect(again.prepared.updating).toBe(false);
    expect(again.rows[0]?.counts.present).toBe(4);
  });

  it('gives the Tutor own classes only, refuses another class (403), and answers 404 for a class, subject or teacher unknown or of another branch', async () => {
    const c = await scene();
    const other = await scene();
    const tutor = await account();
    await load.classes.person(c.s.branch, ['uz'], { accountId: tutor.account.id });
    await load.tutorOf(c.s.branch, c.s.classId, tutor.account.id);
    await as(tutor, c.s.branch, [], async ({ get }) => {
      const report = attendanceOf(await get(`/api/results/reports/attendance?${RANGE}`));
      expect(report.rows.map((one) => one.key.kind === 'class' && one.key.class.id)).toEqual([
        c.s.classId,
      ]);
      expect(report.choices.classes.map((one) => one.id)).toEqual([c.s.classId]);
      const refused = await get(
        `/api/results/reports/attendance?${RANGE}&classId=${c.s.otherClass}`,
      );
      expect(refused.status).toBe(403);
      expect(codeOf(refused)).toBe('permission_denied');
    });
    await as(
      await account(),
      c.s.branch,
      [{ role: 'academic_vice_principal', branchId: c.s.branch }],
      async ({ get }) => {
        for (const query of [
          `classId=${UNKNOWN}`,
          `classId=${other.s.classId}`,
          `subjectId=${UNKNOWN}`,
          `teacherId=${UNKNOWN}`,
          `teacherId=${other.s.teacher.staffId}`,
        ]) {
          const response = await get(`/api/results/reports/attendance?${RANGE}&${query}`);
          expect(response.status, query).toBe(404);
        }
      },
    );
  });

  it('groups the attendance by the Tutor in force and refuses a range of more than 92 days or outside one year', async () => {
    const c = await scene();
    const tutor = await account();
    const staff = await load.classes.person(c.s.branch, ['uz'], { accountId: tutor.account.id });
    await load.tutorOf(c.s.branch, c.s.classId, tutor.account.id);
    await student(c.s.branch, { first: 'Hilola', last: 'Hamidova' }, [
      { classId: c.s.otherClass, from: '2026-09-01' },
    ]);
    await as(
      await account(),
      c.s.branch,
      [{ role: 'head_tutor', branchId: c.s.branch }],
      async ({ get }) => {
        const report = attendanceOf(
          await get(`/api/results/reports/attendance?${RANGE}&groupBy=tutor`),
        );
        const keys = report.rows.map((one) => (one.key.kind === 'tutor' ? one.key.tutor : null));
        expect(keys).toContainEqual({ id: staff.staffId, name: expect.any(String) as string });
        // The other class has no Tutor: its cells under "no Tutor".
        expect(keys).toContain(null);
        for (const range of ['from=2026-09-01&to=2026-12-15', 'from=2027-05-20&to=2027-06-10']) {
          const response = await get(`/api/results/reports/attendance?${range}`);
          expect(response.status, range).toBe(409);
          expect(codeOf(response)).toBe('discipline_range');
        }
      },
    );
  });

  it('lists each student against each graded subject with the result and grade, attendance-only subjects left out, and the stored record of a closed quarter', async () => {
    const c = await scene();
    const path = `/api/results/reports/results-table?quarterId=${c.q1}&classId=${c.s.classId}`;
    const browser = await account();
    const roles = [{ role: 'academic_vice_principal' as const, branchId: c.s.branch }];
    await as(browser, c.s.branch, roles, async ({ get }) => {
      const response = await get(path);
      expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(200);
      const table = resultsTableSchema.parse(response.body);
      expect(table.subjects.map((one) => one.id)).toEqual([c.s.subject]);
      expect(table.provisional).toBe(true);
      const of = (id: string) =>
        table.rows.find((row) => row.student.id === id)?.results[0] ?? null;
      expect(of(c.students.aziz)?.state).toBe('number');
      expect(of(c.students.aziz)?.grade).toBeGreaterThanOrEqual(2);
      expect(of(c.students.gulnora)).toMatchObject({ state: 'exempt', value: null, grade: null });
      expect(of(c.students.farrux)?.state).not.toBe('exempt');
    });
    // Closed: the stored record decides, not what the entries give now.
    const closer = await load.classes.account();
    const closing = await closeQuarter(t.database, {
      branchId: c.s.branch,
      quarterId: c.q1,
      accountId: closer,
    });
    const record = finalQuarterRecord(
      {
        weights: { attendance: 20, classwork: 40, homework: 40, ratingExam: null },
        attendanceValues: { lateValue: 50, skippedValue: 0 },
        lessons: [{ mark: 1, classworks: [{ score: 10, total: 10 }], homeworks: [] }],
        ratingExam: null,
        quarterClosed: true,
        heldInJournals: 1,
        countsFrom: null,
        leftSubjectOn: null,
        atLeaving: null,
        decision: null,
      },
      'closing',
    );
    await t.database.migrator
      .insertInto('quarter_final_results')
      .values({
        branch_id: c.s.branch,
        closing_id: closing,
        quarter_id: c.q1,
        subject_id: c.s.subject,
        student_id: c.students.dilnoza,
        journal_id: c.journal,
        kind: 'closing',
        record: JSON.stringify(record),
      })
      .execute();
    await as(browser, c.s.branch, [], async ({ get }) => {
      const table = resultsTableSchema.parse((await get(path)).body);
      expect(table.final).not.toBeNull();
      const dilnoza = table.rows.find((row) => row.student.id === c.students.dilnoza);
      // Absent on the 12th in the journal, 100 in the stored record.
      expect(dilnoza?.results[0]).toMatchObject({ state: 'number', value: 100, grade: 5 });
    });
  });

  it('opens the results table and subject mastery only to their readers: own-subject columns for a Head Teacher, own classes for a Tutor, no mastery for the Head Tutor', async () => {
    const c = await scene();
    const elsewhere = await load.classes.subject({ grades: [7] });
    const tutor = await account();
    await load.classes.person(c.s.branch, ['uz'], { accountId: tutor.account.id });
    await load.tutorOf(c.s.branch, c.s.classId, tutor.account.id);
    const branch = c.s.branch;
    const table = (classId: string) =>
      `/api/results/reports/results-table?quarterId=${c.q1}&classId=${classId}`;
    const mastery = `/api/results/reports/subject-mastery?quarterId=${c.q1}&subjectId=${c.s.subject}`;
    const columns = async (call: Call, classId: string) =>
      resultsTableSchema.parse((await call.get(table(classId))).body).subjects.map((one) => one.id);
    // Head Teacher of the subject: every class, the subject's column; of another subject: none.
    await as(
      await account(),
      branch,
      [{ role: 'head_teacher', branchId: branch, subjectIds: [c.s.subject] }],
      async (call) => {
        expect(await columns(call, c.s.classId)).toEqual([c.s.subject]);
        expect((await call.get(mastery)).status).toBe(200);
      },
    );
    await as(
      await account(),
      branch,
      [{ role: 'head_teacher', branchId: branch, subjectIds: [elsewhere] }],
      async (call) => {
        expect(await columns(call, c.s.classId)).toEqual([]);
        expect((await call.get(mastery)).status).toBe(403);
        const choices = resultsReportChoicesSchema.parse(
          (await call.get('/api/results/reports/choices')).body,
        );
        expect(choices.subjects).toEqual([]);
      },
    );
    await as(
      await account(),
      branch,
      [{ role: 'senior_head_teacher', subjectIds: [elsewhere] }],
      async (call) => {
        expect(await columns(call, c.s.classId)).toEqual([]);
        expect((await call.get(mastery)).status).toBe(403);
      },
    );
    await as(tutor, branch, [], async (call) => {
      expect(await columns(call, c.s.classId)).toEqual([c.s.subject]);
      expect((await call.get(table(c.s.otherClass))).status).toBe(403);
      // Mastery of the class journal of the own class only.
      const own = subjectMasterySchema.parse((await call.get(mastery)).body);
      expect(own.choices.journals.map((one) => one.unit.id)).toEqual([c.s.classId]);
      const choices = resultsReportChoicesSchema.parse(
        (await call.get('/api/results/reports/choices')).body,
      );
      expect(choices.classes.map((one) => one.id)).toEqual([c.s.classId]);
    });
    await as(await account(), branch, [{ role: 'head_tutor', branchId: branch }], async (call) => {
      expect(await columns(call, c.s.otherClass)).toEqual([c.s.subject]);
      expect((await call.get(mastery)).status).toBe(403);
    });
    // The roles outside the area: the guard.
    for (const role of ['teacher', 'spiritual_vice_principal'] as const) {
      await as(await account(), branch, [{ role, branchId: branch }], async (call) => {
        expect((await call.get(table(c.s.classId))).status, role).toBe(403);
        expect((await call.get(mastery)).status, role).toBe(403);
      });
    }
  });

  it('answers 404 for a quarter, class or subject unknown or of another branch, and for an attendance-only subject in mastery', async () => {
    const c = await scene();
    const other = await scene();
    await as(await account(), c.s.branch, [{ role: 'super_admin' }], async ({ get }) => {
      for (const path of [
        `/api/results/reports/results-table?quarterId=${UNKNOWN}&classId=${c.s.classId}`,
        `/api/results/reports/results-table?quarterId=${other.q1}&classId=${c.s.classId}`,
        `/api/results/reports/results-table?quarterId=${c.q1}&classId=${UNKNOWN}`,
        `/api/results/reports/results-table?quarterId=${c.q1}&classId=${other.s.classId}`,
        `/api/results/reports/subject-mastery?quarterId=${UNKNOWN}&subjectId=${c.s.subject}`,
        `/api/results/reports/subject-mastery?quarterId=${other.q1}&subjectId=${c.s.subject}`,
        `/api/results/reports/subject-mastery?quarterId=${c.q1}&subjectId=${UNKNOWN}`,
        `/api/results/reports/subject-mastery?quarterId=${c.q1}&subjectId=${c.s.secondSubject ?? ''}`,
        `/api/results/reports/subject-mastery?quarterId=${c.q1}&subjectId=${c.s.subject}&classId=${UNKNOWN}`,
        `/api/results/reports/subject-mastery?quarterId=${c.q1}&subjectId=${c.s.subject}&classId=${other.s.classId}`,
        `/api/results/reports/subject-mastery?quarterId=${c.q1}&subjectId=${c.s.subject}&teacherId=${UNKNOWN}`,
        `/api/results/reports/subject-mastery?quarterId=${c.q1}&subjectId=${c.s.subject}&teacherId=${other.s.teacher.staffId}`,
        `/api/results/reports/choices?yearId=${UNKNOWN}`,
        `/api/results/reports/choices?yearId=${other.s.year}`,
      ]) {
        const response = await get(path);
        expect(response.status, path).toBe(404);
      }
    });
  });

  it('shares the students with a number among the grade bands, the others beside them, filtered by class, grade and teacher', async () => {
    const c = await scene();
    await as(
      await account(),
      c.s.branch,
      [{ role: 'principal', branchId: c.s.branch }],
      async ({ get }) => {
        const path = `/api/results/reports/subject-mastery?quarterId=${c.q1}&subjectId=${c.s.subject}`;
        const response = await get(path);
        expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(200);
        const mastery = subjectMasterySchema.parse(response.body);
        expect(mastery.bands.map((one) => one.grade)).toEqual([5, 4, 3, 2]);
        expect(mastery.bands.reduce((sum, one) => sum + one.students, 0)).toBe(mastery.counted);
        // Gulnora is exempt: beside the bands, never in one (07, Effect on totals).
        expect(mastery.exempt).toBe(1);
        expect(mastery.counted + mastery.exempt + mastery.notAssessed + mastery.noResult).toBe(6);
        const percents = mastery.bands.flatMap((one) =>
          one.percent === null ? [] : [one.percent],
        );
        expect(percents.length).toBeGreaterThan(0);
        // The other class's journal has no members: the class filter keeps the first class only.
        const own = subjectMasterySchema.parse((await get(`${path}&classId=${c.s.classId}`)).body);
        expect(own.counted).toBe(mastery.counted);
        const otherClass = subjectMasterySchema.parse(
          (await get(`${path}&classId=${c.s.otherClass}`)).body,
        );
        expect(otherClass.counted + otherClass.exempt + otherClass.noResult).toBe(0);
        const graded = subjectMasterySchema.parse((await get(`${path}&grade=8`)).body);
        expect(graded.counted).toBe(0);
        const byTeacher = subjectMasterySchema.parse(
          (await get(`${path}&teacherId=${c.s.teacher.staffId}`)).body,
        );
        expect(byTeacher.counted).toBe(mastery.counted);
      },
    );
  });

  it('exports each report as Excel with the reader’s rows and its stamp, one audit entry each, none for a read', async () => {
    const c = await scene();
    const browser = await account();
    const entries = async (action: string) =>
      Number(
        (
          await t.database.migrator
            .selectFrom('audit_log')
            .select((eb) => eb.fn.countAll<string>().as('count'))
            .where('action', '=', action)
            .where('branch_id', '=', c.s.branch)
            .executeTakeFirstOrThrow()
        ).count,
      );
    await as(
      browser,
      c.s.branch,
      [{ role: 'academic_vice_principal', branchId: c.s.branch }],
      async ({ get, post }) => {
        await get(`/api/results/reports/attendance?${RANGE}`);
        await get(`/api/results/reports/results-table?quarterId=${c.q1}&classId=${c.s.classId}`);
        expect(await entries('attendance_report.export')).toBe(0);
        expect(await entries('results_report.export')).toBe(0);
        const attendance = await post('/api/results/reports/attendance/export', {
          from: '2026-10-12',
          to: '2026-10-31',
          subjectId: c.s.subject,
        });
        expect(attendance.status).toBe(200);
        const lines = await linesOf(attendance.body as Buffer);
        expect(String(lines[0]?.[0])).toContain('12.10.2026');
        // The account's language, Uzbek by default.
        expect(lines.at(-1)?.[0]).toBe('Jami');
        expect(await entries('attendance_report.export')).toBe(1);
        const table = await post('/api/results/reports/export', {
          kind: 'table',
          quarterId: c.q1,
          classId: c.s.classId,
        });
        expect(table.status).toBe(200);
        const tableLines = await linesOf(table.body as Buffer);
        expect(tableLines.some((line) => String(line[0]).includes('Akbarov Aziz'))).toBe(true);
        const mastery = await post('/api/results/reports/export', {
          kind: 'mastery',
          quarterId: c.q1,
          subjectId: c.s.subject,
        });
        expect(mastery.status).toBe(200);
        expect(await entries('results_report.export')).toBe(2);
      },
    );
  });

  it('answers 404 to an export naming an id unknown or of another branch, and logs nothing', async () => {
    const c = await scene();
    const other = await scene();
    await as(await account(), c.s.branch, [{ role: 'super_admin' }], async ({ post }) => {
      const before = await t.database.migrator
        .selectFrom('audit_log')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('action', 'in', ['attendance_report.export', 'results_report.export'])
        .executeTakeFirstOrThrow();
      const bodies: [string, object][] = [
        [
          '/api/results/reports/attendance/export',
          { from: '2026-10-12', to: '2026-10-31', classId: UNKNOWN },
        ],
        [
          '/api/results/reports/attendance/export',
          { from: '2026-10-12', to: '2026-10-31', classId: other.s.classId },
        ],
        [
          '/api/results/reports/attendance/export',
          { from: '2026-10-12', to: '2026-10-31', subjectId: UNKNOWN },
        ],
        [
          '/api/results/reports/attendance/export',
          { from: '2026-10-12', to: '2026-10-31', teacherId: UNKNOWN },
        ],
        [
          '/api/results/reports/attendance/export',
          { from: '2026-10-12', to: '2026-10-31', teacherId: other.s.teacher.staffId },
        ],
        [
          '/api/results/reports/export',
          { kind: 'table', quarterId: UNKNOWN, classId: c.s.classId },
        ],
        [
          '/api/results/reports/export',
          { kind: 'table', quarterId: other.q1, classId: c.s.classId },
        ],
        ['/api/results/reports/export', { kind: 'table', quarterId: c.q1, classId: UNKNOWN }],
        [
          '/api/results/reports/export',
          { kind: 'table', quarterId: c.q1, classId: other.s.classId },
        ],
        [
          '/api/results/reports/export',
          { kind: 'mastery', quarterId: UNKNOWN, subjectId: c.s.subject },
        ],
        [
          '/api/results/reports/export',
          { kind: 'mastery', quarterId: other.q1, subjectId: c.s.subject },
        ],
        ['/api/results/reports/export', { kind: 'mastery', quarterId: c.q1, subjectId: UNKNOWN }],
        [
          '/api/results/reports/export',
          { kind: 'mastery', quarterId: c.q1, subjectId: c.s.subject, classId: UNKNOWN },
        ],
        [
          '/api/results/reports/export',
          { kind: 'mastery', quarterId: c.q1, subjectId: c.s.subject, classId: other.s.classId },
        ],
        [
          '/api/results/reports/export',
          { kind: 'mastery', quarterId: c.q1, subjectId: c.s.subject, teacherId: UNKNOWN },
        ],
        [
          '/api/results/reports/export',
          {
            kind: 'mastery',
            quarterId: c.q1,
            subjectId: c.s.subject,
            teacherId: other.s.teacher.staffId,
          },
        ],
      ];
      for (const [path, body] of bodies) {
        const response = await post(path, body);
        expect(response.status, `${path} ${JSON.stringify(body)}`).toBe(404);
      }
      const after = await t.database.migrator
        .selectFrom('audit_log')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('action', 'in', ['attendance_report.export', 'results_report.export'])
        .executeTakeFirstOrThrow();
      expect(after.count).toBe(before.count);
    });
  });

  it('refuses an export outside the scope of the Tutor and both Head Teachers, logging nothing', async () => {
    const c = await scene();
    const elsewhere = await load.classes.subject({ grades: [7] });
    const tutor = await account();
    await load.classes.person(c.s.branch, ['uz'], { accountId: tutor.account.id });
    await load.tutorOf(c.s.branch, c.s.classId, tutor.account.id);
    const branch = c.s.branch;
    await as(tutor, branch, [], async ({ post }) => {
      expect(
        (
          await post('/api/results/reports/attendance/export', {
            from: '2026-10-12',
            to: '2026-10-31',
            classId: c.s.otherClass,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await post('/api/results/reports/export', {
            kind: 'table',
            quarterId: c.q1,
            classId: c.s.otherClass,
          })
        ).status,
      ).toBe(403);
    });
    for (const held of [
      { role: 'head_teacher' as const, branchId: branch, subjectIds: [elsewhere] },
      { role: 'senior_head_teacher' as const, subjectIds: [elsewhere] },
    ]) {
      await as(await account(), branch, [held], async ({ post }) => {
        const response = await post('/api/results/reports/export', {
          kind: 'mastery',
          quarterId: c.q1,
          subjectId: c.s.subject,
        });
        expect(response.status, held.role).toBe(403);
      });
    }
    const logged = await t.database.migrator
      .selectFrom('audit_log')
      .select('id')
      .where('branch_id', '=', branch)
      .where('action', 'in', ['attendance_report.export', 'results_report.export'])
      .execute();
    expect(logged).toEqual([]);
  });

  it('counts the school days of the quarter on the closing checklist, passed up to today', async () => {
    const c = await scene();
    const browser = await account();
    let given = false;
    const read = (moment: string) =>
      as(
        browser,
        c.s.branch,
        given
          ? []
          : ((given = true), [{ role: 'academic_vice_principal' as const, branchId: c.s.branch }]),
        async ({ get }) => {
          const response = await get(`/api/results/closing?quarterId=${c.q1}`);
          expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
          return closingChecklistSchema.parse(response.body).schoolDays;
        },
        moment,
      );
    const monday = await read('2026-10-26T12:00:00+05:00');
    const tuesday = await read('2026-10-27T12:00:00+05:00');
    const saturday = await read('2026-10-31T12:00:00+05:00');
    const sunday = await read('2026-11-01T12:00:00+05:00');
    expect(monday?.total).toBeGreaterThan(0);
    expect(tuesday?.total).toBe(monday?.total);
    expect((tuesday?.passed ?? 0) - (monday?.passed ?? 0)).toBe(1);
    // The quarter ends on Saturday 31 October: every school day passed, none after.
    expect(sunday?.passed).toBe(saturday?.passed);
    expect(sunday?.passed).toBe(sunday?.total);
  });
});
