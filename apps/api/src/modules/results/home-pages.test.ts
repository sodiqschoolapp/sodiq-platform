import { randomUUID } from 'node:crypto';
import { finalQuarterRecord } from '@sodiq/calc';
import {
  attendanceTodaySchema,
  BRANCH_HEADER,
  branchSummarySchema,
  conflictsSummarySchema,
  disciplineSchema,
  draftReadinessSchema,
  exemptionCreatedSchema,
  lessonsTodaySchema,
  REQUEST_KEY_HEADER,
  type AttendanceToday,
  type ExemptionCreate,
} from '@sodiq/shared';
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
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';

/**
 * Monday 26 October 2026, 10:00 in Tashkent: the maths of both classes (08:00) and the second
 * subject of the other class (08:55) are held.
 */
const MOMENT = '2026-10-26T10:00:00+05:00';

const ATTENDANCE = '/api/journal/attendance-today';
const LESSONS = '/api/journal/lessons-today';
const SUMMARY = '/api/results/branch-summary';
const CONFLICTS = '/api/timetable/conflicts-summary';

const codeOf = (response: Response): unknown =>
  (response.body as { error?: { code?: string } }).error?.code;

const ok = (response: Response): unknown => {
  expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(200);
  return response.body;
};

// All names are invented. Task 9.4b: the home pages (docs/spec/08-results-rating-analytics.md,
// Home pages by role; docs/spec/edge-cases/journal.md, Attendance figures).
describe('the home pages (08, Home pages by role)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Malika', `Ergasheva${'a'.repeat(names % 7)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };
  type Call = {
    get: (path: string) => Promise<Response>;
    post: (path: string, body: object) => Promise<Response>;
  };

  /** One Super Admin for the file: at most 3 accounts hold the role (`MAX_SUPER_ADMINS`). */
  let superAdminBrowser: Browser | undefined;
  const superAdmin = async (): Promise<Browser> => {
    if (superAdminBrowser === undefined) {
      superAdminBrowser = await account();
      await t.kit.giveRole(superAdminBrowser.account.id, {
        role: 'super_admin',
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
    }
    return superAdminBrowser;
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
            .set(REQUEST_KEY_HEADER, randomUUID())
            .send(body),
      });
    } finally {
      t.clock.set(START);
    }
  }

  const saveAt = async (
    branch: string,
    moment: string,
    cells: { lessonId: string; studentId: string; workId?: string; value: number }[],
  ) => {
    t.clock.set(moment);
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
    first: string,
    classId: string,
    startsOn = '2026-09-01',
  ): Promise<string> => {
    const kit = new MembersKit(t.database.migrator, await load.classes.account());
    const id = await kit.student(branch, { startsOn, grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: first, last_name: 'Karimov' })
      .where('id', '=', id)
      .execute();
    await kit.member({ branch, studentId: id, classId, from: startsOn });
    return id;
  };

  /** The lessons of a unit dated on the day, in start order. */
  const lessonsOn = async (classId: string, date: string) =>
    (
      await t.database.migrator
        .selectFrom('lessons')
        .select(['id', 'subject_id'])
        .where('class_id', '=', classId)
        .where('lesson_date', '=', date)
        .orderBy('starts_at')
        .execute()
    ).map((one) => ({ id: one.id, subject: one.subject_id }));

  const exemption = (studentId: string, choices: ExemptionCreate['choices']): ExemptionCreate => ({
    kind: 'full',
    subjectIds: null,
    startDate: '2026-10-26',
    endDate: null,
    slots: null,
    category: 'illness',
    detail: 'A certificate from the clinic',
    studentIds: [studentId],
    choices,
  });

  /**
   * The first class (A) on Monday 26 October, maths at 08:00:
   * - Anvar absent (0), Botir present, Charos late, Dilnoza unmarked;
   * - Erkin under a full exemption from the 26th, nothing typed (exempt);
   * - Farrux present, then a full exemption from the 26th whose maths was "left as attended"
   *   (the exemption skips it): a marked cell (review correction 1);
   * - Jasur absent (0), then exempt today from 09:30 to 12:00 only: his maths is a marked cell,
   *   and he is exempt now (`edge/journal`, "not exempt now").
   * The other class (B), maths at 08:00 and its second subject at 08:55:
   * - Gulnora present at both; Hamid present at maths and absent (0) at the second subject.
   * The branch threshold is 65.
   */
  async function scene(input: { cancelSecond?: boolean } = {}) {
    const s = await publishedScene(t, load, { graded: true, secondSubject: true });
    const [mathsA] = await lessonsOn(s.classId, '2026-10-26');
    const [mathsB, secondB] = await lessonsOn(s.otherClass, '2026-10-26');
    if (mathsA === undefined || mathsB === undefined || secondB === undefined) {
      throw new Error('The lessons of the 26th.');
    }
    if (input.cancelSecond === true) {
      // Cancelled before it starts, as a one-day change with a reason.
      const cancelled = await as(
        await superAdmin(),
        s.branch,
        [],
        ({ post }) =>
          post(`/api/timetable/lessons/${secondB.id}/cancel`, {
            reason: 'Excursion to the museum',
          }),
        '2026-10-26T07:00:00+05:00',
      );
      expect(cancelled.status, JSON.stringify(cancelled.body).slice(0, 400)).toBe(200);
    }
    const a = {
      anvar: await student(s.branch, 'Anvar', s.classId),
      botir: await student(s.branch, 'Botir', s.classId),
      charos: await student(s.branch, 'Charos', s.classId),
      dilnoza: await student(s.branch, 'Dilnoza', s.classId),
      erkin: await student(s.branch, 'Erkin', s.classId),
      farrux: await student(s.branch, 'Farrux', s.classId),
      jasur: await student(s.branch, 'Jasur', s.classId),
    };
    const b = {
      gulnora: await student(s.branch, 'Gulnora', s.otherClass),
      hamid: await student(s.branch, 'Hamid', s.otherClass),
    };
    await saveAt(s.branch, '2026-10-26T09:50:00+05:00', [
      { lessonId: mathsA.id, studentId: a.anvar, value: 0 },
      { lessonId: mathsA.id, studentId: a.botir, value: 1 },
      { lessonId: mathsA.id, studentId: a.charos, value: 2 },
      { lessonId: mathsA.id, studentId: a.farrux, value: 1 },
      { lessonId: mathsA.id, studentId: a.jasur, value: 0 },
      { lessonId: mathsB.id, studentId: b.gulnora, value: 1 },
      { lessonId: mathsB.id, studentId: b.hamid, value: 1 },
      ...(input.cancelSecond === true
        ? []
        : [
            { lessonId: secondB.id, studentId: b.gulnora, value: 1 },
            { lessonId: secondB.id, studentId: b.hamid, value: 0 },
          ]),
    ]);
    const vice = await account();
    await as(
      vice,
      s.branch,
      [{ role: 'academic_vice_principal', branchId: s.branch }],
      async ({ post }) => {
        for (const body of [
          exemption(a.erkin, []),
          exemption(a.farrux, [{ studentId: a.farrux, lessonId: mathsA.id, choice: 'keep' }]),
          {
            ...exemption(a.jasur, []),
            kind: 'temporary' as const,
            endDate: '2026-10-26',
            slots: { start: '09:30', end: '12:00' },
          },
        ]) {
          const created = await post('/api/exemptions', body);
          expect(created.status, JSON.stringify(created.body).slice(0, 600)).toBe(200);
          exemptionCreatedSchema.parse(created.body);
        }
      },
    );
    await t.database.migrator
      .insertInto('branch_settings')
      .values({ branch_id: s.branch, attendance_percent: 65 })
      .onConflict((oc) => oc.column('branch_id').doUpdateSet({ attendance_percent: 65 }))
      .execute();
    return { s, a, b, mathsA, mathsB, secondB, vice };
  }

  const attendanceOf = (response: Response): AttendanceToday =>
    attendanceTodaySchema.parse(ok(response));

  const classOf = (answer: AttendanceToday, classId: string) =>
    answer.classes.find((one) => one.class.id === classId);

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('attendance today (edge/journal, Attendance figures)', () => {
    let c: Awaited<ReturnType<typeof scene>>;

    beforeAll(async () => {
      c = await scene();
    });

    it('gives a Tutor the own class: the day, the week, below the threshold and who is absent now', async () => {
      const tutor = await account();
      await load.classes.person(c.s.branch, ['uz'], { accountId: tutor.account.id });
      await load.tutorOf(c.s.branch, c.s.classId, tutor.account.id);
      const answer = await as(tutor, c.s.branch, [], async ({ get }) =>
        attendanceOf(await get(ATTENDANCE)),
      );
      expect(answer).toMatchObject({ date: '2026-10-26', weekFrom: '2026-10-26', threshold: 65 });
      // The own class only.
      expect(answer.classes.map((one) => one.class.id)).toEqual([c.s.classId]);
      const own = classOf(answer, c.s.classId);
      // Present or late over marked: Botir, Charos and Farrux (the lesson left as attended under
      // his exemption counts) of those and Anvar and Jasur; Dilnoza unmarked; Erkin exempt.
      expect(own?.day).toEqual({ attended: 3, marked: 5, unmarked: 1, exempt: 1, percent: 60 });
      expect(own?.week).toEqual(own?.day);
      expect(own?.below).toBe(true);
      // Anvar's latest marked lesson is 0; Jasur's too, but he is exempt now.
      expect(own?.absentNow?.map((one) => one.student.id)).toEqual([c.a.anvar]);
      expect(own?.absentNow?.[0]?.since).toBe(new Date('2026-10-26T08:00:00+05:00').toISOString());
    });

    it('gives the Head Tutor and the Spiritual Vice Principal every class, with no names (review correction 3)', async () => {
      for (const role of ['head_tutor', 'spiritual_vice_principal'] as const) {
        const answer = await as(
          await account(),
          c.s.branch,
          [{ role, branchId: c.s.branch }],
          async ({ get }) => attendanceOf(await get(ATTENDANCE)),
        );
        expect(answer.classes.map((one) => one.class.id).sort(), role).toEqual(
          [c.s.classId, c.s.otherClass].sort(),
        );
        expect(
          answer.classes.every((one) => one.absentNow === null),
          role,
        ).toBe(true);
        const other = classOf(answer, c.s.otherClass);
        // Gulnora 1 and 1, Hamid 1 and 0: 3 of 4, above 65.
        expect(other?.day, role).toEqual({
          attended: 3,
          marked: 4,
          unmarked: 0,
          exempt: 0,
          percent: 75,
        });
        expect(other?.below, role).toBe(false);
        // One ratio over every cell: 6 of 9, 66.67 shown 67.
        expect(answer.total, role).toEqual({
          attended: 6,
          marked: 9,
          unmarked: 1,
          exempt: 1,
          percent: 67,
        });
      }
    });

    it('names who is absent now in every class to the Super Admin; latest marked lesson, not the first', async () => {
      const answer = await as(await superAdmin(), c.s.branch, [], async ({ get }) =>
        attendanceOf(await get(ATTENDANCE)),
      );
      // Hamid: present at 08:00, absent at 08:55. Gulnora's 1 then 1 is not.
      expect(classOf(answer, c.s.otherClass)?.absentNow?.map((one) => one.student.id)).toEqual([
        c.b.hamid,
      ]);
      expect(classOf(answer, c.s.classId)?.absentNow?.map((one) => one.student.id)).toEqual([
        c.a.anvar,
      ]);
    });

    it('reads the day in branch time: at 00:30 on Tuesday the day is empty and the week holds Monday', async () => {
      const reader = await account();
      let given = false;
      const read = (moment: string) =>
        as(
          reader,
          c.s.branch,
          given ? [] : [{ role: 'head_tutor', branchId: c.s.branch }],
          async ({ get }) => {
            given = true;
            return attendanceOf(await get(ATTENDANCE));
          },
          moment,
        );
      const late = await read('2026-10-26T23:30:00+05:00');
      expect(late.date).toBe('2026-10-26');
      expect(classOf(late, c.s.classId)?.day.percent).toBe(60);
      const tuesday = await read('2026-10-27T00:30:00+05:00');
      expect(tuesday).toMatchObject({ date: '2026-10-27', weekFrom: '2026-10-26' });
      const own = classOf(tuesday, c.s.classId);
      expect(own?.day).toEqual({ attended: 0, marked: 0, unmarked: 0, exempt: 0, percent: null });
      expect(own?.week.percent).toBe(60);
      expect(own?.below).toBe(false);
    });

    it('leaves a cancelled lesson out of the cells', async () => {
      const cancelled = await scene({ cancelSecond: true });
      const answer = await as(await superAdmin(), cancelled.s.branch, [], async ({ get }) =>
        attendanceOf(await get(ATTENDANCE)),
      );
      const other = classOf(answer, cancelled.s.otherClass);
      // The maths alone: Gulnora and Hamid present; nothing unmarked from the cancelled lesson.
      expect(other?.day).toEqual({ attended: 2, marked: 2, unmarked: 0, exempt: 0, percent: 100 });
      expect(other?.absentNow).toEqual([]);
    });

    it('refuses the roles of no home row that reads it (403), each with the role in the branch', async () => {
      const refused: Omit<Held, 'validFrom'>[] = [
        { role: 'teacher', branchId: c.s.branch },
        { role: 'principal', branchId: c.s.branch },
        { role: 'academic_vice_principal', branchId: c.s.branch },
      ];
      for (const held of refused) {
        const response = await as(await account(), c.s.branch, [held], ({ get }) =>
          get(ATTENDANCE),
        );
        expect(response.status, held.role).toBe(403);
        expect(codeOf(response), held.role).toBe('permission_denied');
      }
    });
  });

  describe('lessons today and their status (08, Academic Vice Principal)', () => {
    it('counts the held lessons by status as the counts per teacher do, the lessons ahead apart, and keeps the Head Teacher to own subjects', async () => {
      const c = await scene();
      const at = '2026-10-26T08:30:00+05:00';
      const vice = await as(
        c.vice,
        c.s.branch,
        [],
        async ({ get }) => {
          const today = lessonsTodaySchema.parse(ok(await get(LESSONS)));
          const discipline = disciplineSchema.parse(
            ok(await get('/api/journal/discipline?from=2026-10-26&to=2026-10-26')),
          );
          return { today, discipline };
        },
        at,
      );
      // At 08:30 both maths lessons are held, the second subject at 08:55 is ahead.
      expect(vice.today).toMatchObject({ date: '2026-10-26', held: 2, ahead: 1 });
      const sum = (key: 'notStarted' | 'inProgress' | 'complete') =>
        vice.discipline.teachers.reduce((total, one) => total + one[key], 0);
      expect(vice.today.notStarted).toBe(sum('notStarted'));
      expect(vice.today.inProgress).toBe(sum('inProgress'));
      expect(vice.today.complete).toBe(sum('complete'));
      expect(vice.today.incomplete).toHaveLength(2 - vice.today.complete);
      expect(vice.today.incomplete.every((one) => one.teacher !== null)).toBe(true);

      const another = await load.classes.subject({ grades: [7] });
      const head = await as(
        await account(),
        c.s.branch,
        [{ role: 'head_teacher', branchId: c.s.branch, subjectIds: [another] }],
        async ({ get }) => lessonsTodaySchema.parse(ok(await get(LESSONS))),
        at,
      );
      expect(head).toMatchObject({ held: 0, ahead: 0, incomplete: [] });
      const subjectHead = await as(
        await account(),
        c.s.branch,
        [{ role: 'head_teacher', branchId: c.s.branch, subjectIds: [c.s.subject] }],
        async ({ get }) => lessonsTodaySchema.parse(ok(await get(LESSONS))),
        at,
      );
      // The maths of both classes; the second subject is another's.
      expect(subjectHead).toMatchObject({ held: 2, ahead: 0 });
    });

    it('refuses a Teacher and a Tutor (403), each with the role in the branch', async () => {
      const s = await publishedScene(t, load, {});
      const tutor = await account();
      await load.classes.person(s.branch, ['uz'], { accountId: tutor.account.id });
      await load.tutorOf(s.branch, s.classId, tutor.account.id);
      for (const [browser, held] of [
        [await account(), [{ role: 'teacher' as const, branchId: s.branch }]],
        [tutor, []],
      ] as const) {
        const response = await as(browser, s.branch, held, ({ get }) => get(LESSONS));
        expect(response.status).toBe(403);
        expect(codeOf(response)).toBe('permission_denied');
      }
    });
  });

  describe('the branch summary (08, Principal and Super Admin)', () => {
    it("counts the active students who started and the staff not out, with today's attendance", async () => {
      const c = await scene();
      const read = () =>
        as(principal, c.s.branch, [], async ({ get }) =>
          branchSummarySchema.parse(ok(await get(SUMMARY))),
        );
      const principal = await account();
      await t.kit.giveRole(principal.account.id, {
        role: 'principal',
        branchId: c.s.branch,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
      const first = await read();
      // The nine students of the scene.
      expect(first.students).toBe(9);
      expect(first.attendanceToday).toEqual({
        attended: 6,
        marked: 9,
        unmarked: 1,
        exempt: 1,
        percent: 67,
      });
      // A student who starts in November and a vacancy are not counted; a new person is.
      await student(c.s.branch, 'Iroda', c.s.classId, '2026-11-02');
      await load.vacancy(c.s.branch);
      const person = await load.classes.person(c.s.branch, ['uz']);
      const second = await read();
      expect(second.students).toBe(9);
      expect(second.staff).toBe(first.staff + 1);
      // A person who leaves from today is out for good.
      const left = await as(await superAdmin(), c.s.branch, [], ({ post }) =>
        post(`/api/people/staff/${person.staffId}/status`, { status: 'left', from: '2026-10-26' }),
      );
      expect(left.status, JSON.stringify(left.body).slice(0, 400)).toBe(200);
      expect((await read()).staff).toBe(first.staff);
    });

    it('reads results by grade of a closed quarter from its stored records, not the cells changed after the close', async () => {
      const c = await scene();
      const q1 = (
        await t.database.migrator
          .selectFrom('quarters')
          .select('id')
          .where('academic_year_id', '=', c.s.year)
          .where('number', '=', 1)
          .executeTakeFirstOrThrow()
      ).id;
      const journal = (
        await t.database.migrator
          .selectFrom('journals')
          .select('id')
          .where('class_id', '=', c.s.classId)
          .where('subject_id', '=', c.s.subject)
          .executeTakeFirstOrThrow()
      ).id;
      const principal = await account();
      await t.kit.giveRole(principal.account.id, {
        role: 'principal',
        branchId: c.s.branch,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
      const read = () =>
        as(principal, c.s.branch, [], async ({ get }) =>
          branchSummarySchema.parse(ok(await get(`${SUMMARY}?quarterId=${q1}`))),
        );
      const live = await read();
      expect(live.quarter).toMatchObject({ id: q1, number: 1, closed: false });
      // Live: Anvar 0, Botir 100, Charos 50, Farrux 100, Jasur 0, Gulnora 100, Hamid 100 (the
      // attendance alone, no works); Dilnoza has no result, Erkin is exempt: 450 / 7, 64.3.
      expect(live.grades).toEqual([{ grade: 7, value: 643, rated: 7, students: 9 }]);
      const closing = await closeQuarter(t.database, {
        branchId: c.s.branch,
        quarterId: q1,
        accountId: await load.classes.account(),
      });
      // Every stored record of the first class's maths reads 100, unlike its live figures: present
      // with 10 of 10 and an exam of 100.
      const record = finalQuarterRecord(
        {
          weights: { attendance: 20, classwork: 20, homework: 20, ratingExam: 40 },
          attendanceValues: { lateValue: 50, skippedValue: 0 },
          lessons: [{ mark: 1, classworks: [{ score: 10, total: 10 }], homeworks: [] }],
          ratingExam: { kind: 'score', score: 100 },
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
        .deleteFrom('quarter_final_results')
        .where('closing_id', '=', closing)
        .execute();
      for (const studentId of Object.values(c.a)) {
        await t.database.migrator
          .insertInto('quarter_final_results')
          .values({
            branch_id: c.s.branch,
            closing_id: closing,
            quarter_id: q1,
            subject_id: c.s.subject,
            student_id: studentId,
            journal_id: journal,
            kind: 'closing',
            record: JSON.stringify(record),
          })
          .execute();
      }
      const closed = await read();
      expect(closed.quarter).toMatchObject({ id: q1, closed: true });
      const grade = closed.grades.find((one) => one.grade === 7);
      // The first class's seven read 100 from their records, the other class's two live 100.
      expect(grade).toMatchObject({ grade: 7, value: 1000, rated: 9, students: 9 });
    });

    it("refuses the Academic Vice Principal and a Teacher (403), and answers 404 for another branch's or an unknown quarter", async () => {
      const s = await publishedScene(t, load, {});
      for (const held of [
        { role: 'academic_vice_principal' as const, branchId: s.branch },
        { role: 'teacher' as const, branchId: s.branch },
      ]) {
        const response = await as(await account(), s.branch, [held], ({ get }) => get(SUMMARY));
        expect(response.status, held.role).toBe(403);
        expect(codeOf(response), held.role).toBe('permission_denied');
      }
      const elsewhere = await publishedScene(t, load, {});
      const otherQuarter = (
        await t.database.migrator
          .selectFrom('quarters')
          .select('id')
          .where('academic_year_id', '=', elsewhere.year)
          .executeTakeFirstOrThrow()
      ).id;
      for (const quarterId of [otherQuarter, UNKNOWN]) {
        const response = await as(await superAdmin(), s.branch, [], ({ get }) =>
          get(`${SUMMARY}?quarterId=${quarterId}`),
        );
        expect(response.status).toBe(404);
      }
    });
  });

  describe('the conflicts of the timetables (08, Academic Vice Principal)', () => {
    it('counts each draft and the version in force with the counts of their conflict panel', async () => {
      const s = await publishedScene(t, load, {});
      const copied = await as(await superAdmin(), s.branch, [], ({ post }) =>
        post('/api/timetable/versions', {
          academicYearId: s.year,
          startsOn: '2026-11-02',
          copyFrom: s.version,
        }),
      );
      expect(copied.status, JSON.stringify(copied.body).slice(0, 400)).toBe(201);
      const draft = (copied.body as { id: string }).id;
      const answer = await as(await superAdmin(), s.branch, [], async ({ get }) => ({
        summary: conflictsSummarySchema.parse(ok(await get(CONFLICTS))),
        readiness: draftReadinessSchema.parse(
          ok(await get(`/api/timetable/versions/${draft}/readiness`)),
        ),
      }));
      const own = answer.summary.drafts.find((one) => one.id === draft);
      expect(own).toMatchObject({ number: 2, startsOn: '2026-11-02', outOfDate: false });
      // The draft's counts are those of its step 7 (the conflict panel).
      expect(own?.blocked).toBe(answer.readiness.grid?.blocked);
      expect(own?.warnings).toBe(answer.readiness.grid?.warnings);
      // The version in force, the same pattern, is counted by the same check; it holds no blocked rule.
      expect(answer.summary.published).toMatchObject({
        id: s.version,
        number: 1,
        blocked: 0,
        warnings: own?.warnings,
      });
    });

    it('refuses a Teacher and the Head Tutor (403)', async () => {
      const s = await publishedScene(t, load, {});
      for (const role of ['teacher', 'head_tutor'] as const) {
        const response = await as(
          await account(),
          s.branch,
          [{ role, branchId: s.branch }],
          ({ get }) => get(CONFLICTS),
        );
        expect(response.status, role).toBe(403);
      }
    });
  });
});
