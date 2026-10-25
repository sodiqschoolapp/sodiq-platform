import { finalQuarterRecord } from '@sodiq/calc';
import {
  journalGridSchema,
  studentAttendanceSchema,
  studentLeavingResultsSchema,
  studentResultLessonsSchema,
  studentResultsSchema,
  studentResultTabsSchema,
  type StudentResults,
} from '@sodiq/shared';
import { sql, type ExpressionBuilder, type UpdateObject } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DB } from '../../database/types.generated.js';
import { Transactions } from '../../database/transactions.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { closeQuarter } from '../../testing/closing-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit, type MemberRow } from '../../testing/members-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): unknown =>
  (response.body as { error?: { code?: string } }).error?.code;

const resultsOf = (response: Response): StudentResults => {
  expect(response.status, JSON.stringify(response.body).slice(0, 500)).toBe(200);
  return studentResultsSchema.parse(response.body);
};

// All names are invented. Task 9.1: the Results and Attendance tabs of a student's profile
// and the lessons behind a figure (docs/spec/08-results-rating-analytics.md, Student results;
// docs/spec/04-people.md, Profile tabs; docs/spec/edge-cases/calculation.md;
// docs/spec/edge-cases/academic-year.md, the start quarter; decisions 1, 4, 6, 8 and 13).
describe('the student results (08, Student results)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Malika', `Usmonova${'a'.repeat(names % 5)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };

  async function as<T>(
    browser: Browser,
    roles: readonly Omit<Held, 'validFrom'>[],
    work: (get: (branch: string, path: string) => Promise<Response>) => Promise<T>,
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
      return await work((branch, path) => t.get(path, branch, browser.cookie));
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

  const lessonsOf = async (classId: string) =>
    (
      await t.database.migrator
        .selectFrom('lessons')
        .select(['id', sql<string>`lesson_date::text`.as('date')])
        .where('class_id', '=', classId)
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

  /**
   * The graded maths scene (20 · 40 · 40) with Aziz, present on the 12th with a classwork
   * 9 of 10, absent on the 19th, not yet marked on the 26th; and Dilshod, with nothing.
   */
  async function scene(
    accounts?: { readonly teacher?: string; readonly spare?: string },
    secondSubject = false,
  ) {
    const s = await publishedScene(t, load, {
      graded: true,
      secondSubject,
      ...(accounts === undefined ? {} : { accounts }),
    });
    const [l12, l19, l26] = await lessonsOf(s.classId);
    if (l12 === undefined || l19 === undefined || l26 === undefined) {
      throw new Error('Three lessons.');
    }
    const aziz = await student(s.branch, { first: 'Aziz', last: 'Karimov' }, [
      { classId: s.classId, from: '2026-09-01' },
    ]);
    const dilshod = await student(s.branch, { first: 'Dilshod', last: 'Ergashev' }, [
      { classId: s.classId, from: '2026-09-01' },
    ]);
    const work = (
      await t.database.migrator
        .insertInto('journal_works')
        .values({ branch_id: s.branch, lesson_id: l12.id, kind: 'classwork', total: 10 })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await saveOn(s.branch, l12.date, [
      { lessonId: l12.id, studentId: aziz, value: 1 },
      { lessonId: l12.id, studentId: aziz, workId: work, value: 9 },
    ]);
    await saveOn(s.branch, l19.date, [{ lessonId: l19.id, studentId: aziz, value: 0 }]);
    const journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.classId)
        .executeTakeFirstOrThrow()
    ).id;
    return { scene: s, aziz, dilshod, journal, work, lessons: { l12, l19, l26 } };
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  it('answers each figure as the journal grid shows it, from packages/calc, and "No result" for nothing entered', async () => {
    const s = await scene();
    const q1 = await quarterOf(s.scene, 1);
    await as(await account(), [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      const answer = resultsOf(await get(s.scene.branch, `/api/results/students/${s.aziz}`));
      expect(answer.year?.id).toBe(s.scene.year);
      expect(answer.quarters.map((one) => [one.number, one.notInSystem])).toEqual([
        [1, false],
        [2, false],
        [3, false],
        [4, false],
      ]);
      // Attendance 50 (100 and 0; the 26th is not marked), classwork 90:
      // (20 × 50 + 40 × 90) ÷ 60 = 76.7, homework left out, based on 3 of 3 lessons.
      expect(answer.subjects).toEqual([
        {
          subject: expect.objectContaining({ id: s.scene.subject }) as unknown,
          quarters: [
            {
              quarterId: q1,
              unit: { kind: 'class', id: s.scene.classId, name: expect.any(String) as unknown },
              attendance: 50,
              classwork: 90,
              homework: null,
              ratingExam: null,
              ratingShown: false,
              outcome: {
                kind: 'number',
                shown: 77,
                grade: 4,
                provisional: true,
                leftOut: ['homework'],
                flags: [],
              },
              basedOn: { expected: 3, held: 3 },
              countsFrom: null,
              leftSubjectOn: null,
              atLeaving: null,
            },
          ],
          // The year is open: no year result (decision 1).
          year: null,
        },
      ]);
      // The grid answers the same figures for the same student.
      const grid = journalGridSchema.parse(
        (await get(s.scene.branch, `/api/journal/journals/${s.journal}`)).body,
      );
      const row = grid.students.find((one) => one.id === s.aziz);
      const [shown] = answer.subjects[0]?.quarters ?? [];
      expect(row?.quarter).toEqual({
        attendance: shown?.attendance,
        classwork: shown?.classwork,
        homework: shown?.homework,
        ratingExam: shown?.ratingExam,
        result: {
          kind: 'number',
          shown: 77,
          grade: 4,
          provisional: true,
          leftOut: ['homework'],
          basedOn: null,
          kept: false,
        },
      });

      // Nothing entered: "No result", not 0 and not a grade (edge/calculation).
      const empty = resultsOf(await get(s.scene.branch, `/api/results/students/${s.dilshod}`));
      expect(empty.subjects[0]?.quarters[0]?.outcome).toEqual({ kind: 'no_result' });
    });
    // A read writes nothing.
    const audited = await t.database.migrator
      .selectFrom('audit_log')
      .select('id')
      .where('record_id', '=', s.aziz)
      .where('action', 'like', '%result%')
      .execute();
    expect(audited).toEqual([]);
  });

  it('answers the attendance of each subject with the counts of the marks', async () => {
    const s = await scene();
    await as(await account(), [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      const response = await get(s.scene.branch, `/api/results/students/${s.aziz}/attendance`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const answer = studentAttendanceSchema.parse(response.body);
      expect(answer.subjects.map((one) => one.quarters)).toEqual([
        [
          {
            quarterId: await quarterOf(s.scene, 1),
            unit: { kind: 'class', id: s.scene.classId, name: expect.any(String) as unknown },
            attendanceOnly: false,
            average: 50,
            counts: { present: 1, absent: 1, late: 0, skipped: 0, exempt: 0, unmarked: 1 },
          },
        ],
      ]);
    });
  });

  it('opens the lessons behind a figure: the counted lessons with their marks, values and works', async () => {
    const s = await scene();
    const q1 = await quarterOf(s.scene, 1);
    const path = `/api/results/students/${s.aziz}/lessons?subjectId=${s.scene.subject}&quarterId=${q1}`;
    await as(await account(), [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      const response = await get(s.scene.branch, path);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const answer = studentResultLessonsSchema.parse(response.body);
      expect(answer.reading).toBe('whole');
      expect(answer.ratingExam).toBeNull();
      expect(
        answer.lessons.map((one) => [one.date, one.mark, one.attendanceValue, one.classworks]),
      ).toEqual([
        [
          '2026-10-12',
          1,
          100,
          [{ workId: s.work, title: null, position: 1, score: 9, total: 10, percent: 90 }],
        ],
        ['2026-10-19', 0, 0, []],
        ['2026-10-26', null, null, []],
      ]);
      expect(answer.lessons.every((one) => one.unit.journalId === s.journal)).toBe(true);
    });
    // A reader of attendance only sees the marks, never the works.
    await as(await account(), [{ role: 'head_tutor', branchId: s.scene.branch }], async (get) => {
      const answer = studentResultLessonsSchema.parse((await get(s.scene.branch, path)).body);
      expect(answer.reading).toBe('attendance');
      expect(answer.lessons.map((one) => [one.mark, one.classworks])).toEqual([
        [1, []],
        [0, []],
        [null, []],
      ]);
    });
  });

  it('answers each subject only to a reader of its journal, and refuses the readers outside the record', async () => {
    const owner = await account();
    const spare = await account();
    const s = await scene({ teacher: owner.account.id, spare: spare.account.id });
    const elsewhere = await load.classes.subject({ grades: [7] });
    const results = `/api/results/students/${s.aziz}`;
    const attendance = `${results}/attendance`;
    const tabs = `${results}/tabs`;
    const cases: {
      held: Omit<Held, 'validFrom'>[];
      browser?: Browser;
      status: number;
      results?: number;
      attendance?: number;
    }[] = [
      { held: [{ role: 'super_admin' }], status: 200, results: 1, attendance: 1 },
      {
        held: [{ role: 'principal', branchId: s.scene.branch }],
        status: 200,
        results: 1,
        attendance: 1,
      },
      {
        held: [{ role: 'academic_vice_principal', branchId: s.scene.branch }],
        status: 200,
        results: 1,
        attendance: 1,
      },
      {
        held: [{ role: 'head_teacher', branchId: s.scene.branch, subjectIds: [s.scene.subject] }],
        status: 200,
        results: 1,
        attendance: 1,
      },
      {
        held: [{ role: 'head_teacher', branchId: s.scene.branch, subjectIds: [elsewhere] }],
        status: 200,
        results: 0,
        attendance: 0,
      },
      {
        held: [{ role: 'senior_head_teacher', subjectIds: [s.scene.subject] }],
        status: 200,
        results: 1,
        attendance: 1,
      },
      // `02`: the Attendance tab, no Results.
      {
        held: [{ role: 'spiritual_vice_principal', branchId: s.scene.branch }],
        status: 200,
        results: 0,
        attendance: 1,
      },
      {
        held: [{ role: 'head_tutor', branchId: s.scene.branch }],
        status: 200,
        results: 0,
        attendance: 1,
      },
      // The Teacher of the journal reads the student taught, the subject whole.
      {
        held: [{ role: 'teacher', branchId: s.scene.branch }],
        browser: owner,
        status: 200,
        results: 1,
        attendance: 1,
      },
      // The same Teacher, now also Head Tutor: Results for the own journal still.
      {
        held: [{ role: 'head_tutor', branchId: s.scene.branch }],
        browser: owner,
        status: 200,
        results: 1,
        attendance: 1,
      },
      // A Teacher who does not teach the student reads no record.
      {
        held: [{ role: 'teacher', branchId: s.scene.branch }],
        browser: spare,
        status: 403,
      },
      { held: [{ role: 'nurse', branchId: s.scene.branch }], status: 403 },
    ];
    for (const one of cases) {
      const browser = one.browser ?? (await account());
      await as(browser, one.held, async (get) => {
        const label = one.held.map((held) => held.role).join('+');
        const read = await get(s.scene.branch, results);
        expect(read.status, `${label} ${JSON.stringify(read.body)}`).toBe(one.status);
        if (one.status === 403) {
          // The guard lets the role in; the route's own scope refuses it (.claude/rules/api.md).
          expect(codeOf(read), label).toBe('permission_denied');
        }
        const listed = await get(s.scene.branch, attendance);
        expect(listed.status, label).toBe(one.status);
        const tabbed = await get(s.scene.branch, tabs);
        expect(tabbed.status, label).toBe(one.status);
        if (one.status !== 200) return;
        expect(resultsOf(read).subjects.length, label).toBe(one.results);
        expect(studentAttendanceSchema.parse(listed.body).subjects.length, label).toBe(
          one.attendance,
        );
        expect(studentResultTabsSchema.parse(tabbed.body), label).toEqual({
          results: (one.results ?? 0) > 0,
          attendance: (one.attendance ?? 0) > 0,
        });
      });
    }
  });

  it('refuses the lessons of a subject the reader does not read, and answers 404 for another branch’s or an unknown id', async () => {
    const s = await scene();
    const other = await scene();
    const q1 = await quarterOf(s.scene, 1);
    const otherQ1 = await quarterOf(other.scene, 1);
    const elsewhere = await load.classes.subject({ grades: [7] });
    const third = await load.classes.subject({ grades: [7] });
    const lessons = (studentId: string, subjectId: string, quarterId: string) =>
      `/api/results/students/${studentId}/lessons?subjectId=${subjectId}&quarterId=${quarterId}`;
    await as(
      await account(),
      [{ role: 'head_teacher', branchId: s.scene.branch, subjectIds: [elsewhere] }],
      async (get) => {
        const response = await get(s.scene.branch, lessons(s.aziz, s.scene.subject, q1));
        expect(response.status, JSON.stringify(response.body)).toBe(403);
        expect(codeOf(response)).toBe('permission_denied');
        // A subject the student never had, outside the reader's, answers the same: nothing of
        // it is told.
        const never = await get(s.scene.branch, lessons(s.aziz, third, q1));
        expect(never.status, JSON.stringify(never.body)).toBe(403);
      },
    );
    for (const held of [
      { role: 'principal' as const, branchId: s.scene.branch },
      { role: 'super_admin' as const },
    ]) {
      await as(await account(), [held], async (get) => {
        for (const id of [other.aziz, UNKNOWN]) {
          for (const path of [
            `/api/results/students/${id}`,
            `/api/results/students/${id}/tabs`,
            `/api/results/students/${id}/attendance`,
            lessons(id, s.scene.subject, q1),
          ]) {
            expect((await get(s.scene.branch, path)).status, `${held.role} ${path}`).toBe(404);
          }
        }
        for (const year of [other.scene.year, UNKNOWN]) {
          for (const path of [
            `/api/results/students/${s.aziz}?yearId=${year}`,
            `/api/results/students/${s.aziz}/attendance?yearId=${year}`,
          ]) {
            expect((await get(s.scene.branch, path)).status, `${held.role} ${path}`).toBe(404);
          }
        }
        for (const path of [
          lessons(s.aziz, s.scene.subject, otherQ1),
          lessons(s.aziz, s.scene.subject, UNKNOWN),
          lessons(s.aziz, UNKNOWN, q1),
        ]) {
          expect((await get(s.scene.branch, path)).status, `${held.role} ${path}`).toBe(404);
        }
      });
    }
  });

  it('answers the year result once the year is closed, "based on n of 4 quarters" (decision 1)', async () => {
    const s = await scene();
    await t.database.migrator
      .updateTable('academic_years')
      .set({ status: 'closed' })
      .where('id', '=', s.scene.year)
      .execute();
    await as(await account(), [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      const answer = resultsOf(
        await get(s.scene.branch, `/api/results/students/${s.aziz}?yearId=${s.scene.year}`),
      );
      expect(answer.year?.status).toBe('closed');
      // Quarter 1 shows 77; quarters 2 to 4 have no number: 77, grade 4, based on 1 of 4.
      expect(answer.subjects.map((one) => one.year)).toEqual([
        { kind: 'number', shown: 77, grade: 4, basedOn: 1 },
      ]);
    });
  });

  // Task 9.2b (From 9.1, decision 1, Look first): 08, "The year result is shown when the fourth
  // quarter is closed"; every figure of a closed quarter is its stored final record;
  // edge/academic-year: a "not official" start quarter is left out of the year result.
  it('reads a closed quarter from its stored record, answers the year once quarter 4 is closed, and leaves a "not official" quarter out', async () => {
    const s = await scene();
    const q1 = await quarterOf(s.scene, 1);
    const q4 = await quarterOf(s.scene, 4);
    const closer = await load.classes.account();
    const closing = await closeQuarter(t.database, {
      branchId: s.scene.branch,
      quarterId: q1,
      accountId: closer,
    });
    // A record the close stored: one lesson, present, a classwork 10 of 10 (100), not the entries
    // of the journal now (77): the stored value is what the student results answer.
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
        branch_id: s.scene.branch,
        closing_id: closing,
        quarter_id: q1,
        subject_id: s.scene.subject,
        student_id: s.aziz,
        journal_id: s.journal,
        kind: 'closing',
        record: JSON.stringify(record),
      })
      .execute();
    const reader = await account();
    let roles: { role: 'principal'; branchId: string }[] = [
      { role: 'principal', branchId: s.scene.branch },
    ];
    const read = () => {
      const given = roles;
      roles = [];
      return as(reader, given, async (get) =>
        resultsOf(
          await get(s.scene.branch, `/api/results/students/${s.aziz}?yearId=${s.scene.year}`),
        ),
      );
    };
    const closedOne = await read();
    expect(closedOne.quarters.find((one) => one.id === q1)).toMatchObject({ closed: true });
    expect(closedOne.subjects[0]?.quarters[0]).toMatchObject({
      classwork: 100,
      outcome: { kind: 'number', shown: 100, grade: 5, provisional: false },
    });
    // The year waits for the fourth quarter.
    expect(closedOne.subjects[0]?.year).toBeNull();
    await closeQuarter(t.database, {
      branchId: s.scene.branch,
      quarterId: q4,
      accountId: closer,
      at: '2027-05-31T18:00:00+05:00',
    });
    expect((await read()).subjects[0]?.year).toEqual({
      kind: 'number',
      shown: 100,
      grade: 5,
      basedOn: 1,
    });
    await t.database.migrator
      .updateTable('quarter_closings')
      .set({ start_quarter: 'not_official' })
      .where('id', '=', closing)
      .execute();
    const unofficial = await read();
    expect(unofficial.quarters.find((one) => one.id === q1)).toMatchObject({ notOfficial: true });
    expect(unofficial.subjects[0]?.year).toEqual({ kind: 'no_result' });
  });

  it('labels the start quarter "from <date>" at every reader, and marks a quarter ended before the start date "not in the system" (decision 8)', async () => {
    const s = await scene();
    await t.database.migrator
      .updateTable('branches')
      .set({ go_live_date: '2026-10-15' })
      .where('id', '=', s.scene.branch)
      .execute();
    await as(await account(), [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      const answer = resultsOf(await get(s.scene.branch, `/api/results/students/${s.aziz}`));
      expect(answer.subjects[0]?.quarters[0]?.countsFrom).toBe('2026-10-15');
      expect(answer.quarters.every((one) => !one.notInSystem)).toBe(true);
      const grid = journalGridSchema.parse(
        (await get(s.scene.branch, `/api/journal/journals/${s.journal}`)).body,
      );
      expect(grid.legend.countsFrom).toBe('2026-10-15');
    });
    // The result at leaving of a student who left on the 21st carries the same label.
    const kit = new MembersKit(t.database.migrator, await load.classes.account());
    const left = await kit.student(s.scene.branch, { startsOn: '2026-09-01', grade: 7 });
    const leavingId = await kit.leaving(t.database.migrator, s.scene.branch, left, '2026-10-21');
    await kit.member({
      branch: s.scene.branch,
      classId: s.scene.classId,
      studentId: left,
      from: '2026-09-01',
      until: '2026-10-21',
      endedBy: 'leaving',
      leavingId,
    });
    await saveOn(s.scene.branch, s.lessons.l12.date, [
      { lessonId: s.lessons.l12.id, studentId: left, value: 1 },
    ]);
    await as(await account(), [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      const response = await get(s.scene.branch, `/api/people/students/${left}/leaving-results`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const answer = studentLeavingResultsSchema.parse(response.body);
      expect(answer.results.map((one) => one.countsFrom)).toEqual(['2026-10-15']);
    });

    // Going live in quarter 2: quarter 1 is "not in the system" and left out of the year.
    await t.database.migrator
      .updateTable('branches')
      .set({ go_live_date: '2026-11-10' })
      .where('id', '=', s.scene.branch)
      .execute();
    await t.database.migrator
      .updateTable('academic_years')
      .set({ status: 'closed' })
      .where('id', '=', s.scene.year)
      .execute();
    await as(await account(), [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      const answer = resultsOf(
        await get(s.scene.branch, `/api/results/students/${s.aziz}?yearId=${s.scene.year}`),
      );
      expect(answer.quarters.map((one) => one.notInSystem)).toEqual([true, false, false, false]);
      expect(answer.subjects[0]?.quarters[0]?.countsFrom).toBeNull();
      expect(answer.subjects.map((one) => one.year)).toEqual([{ kind: 'no_result' }]);
    });
  });

  it('answers a Teacher who teaches the student another subject only that subject, and the class Tutor every subject of the class', async () => {
    const owner = await account();
    const s = await scene({ teacher: owner.account.id }, true);
    if (s.scene.secondSubject === null) throw new Error('A second subject.');
    // Shoira of the other class: maths with the other teacher, the second subject (attendance
    // only, Monday, the second lesson) with the owner of the first class's maths.
    const shoira = await student(s.scene.branch, { first: 'Shoira', last: 'Nazarova' }, [
      { classId: s.scene.otherClass, from: '2026-09-01' },
    ]);
    const q1 = await quarterOf(s.scene, 1);
    await as(owner, [{ role: 'teacher', branchId: s.scene.branch }], async (get) => {
      const base = `/api/results/students/${shoira}`;
      expect(resultsOf(await get(s.scene.branch, base)).subjects).toEqual([]);
      const attendance = studentAttendanceSchema.parse(
        (await get(s.scene.branch, `${base}/attendance`)).body,
      );
      expect(attendance.subjects.map((one) => one.subject.id)).toEqual([s.scene.secondSubject]);
      expect(
        studentResultTabsSchema.parse((await get(s.scene.branch, `${base}/tabs`)).body),
      ).toEqual({ results: false, attendance: true });
      const maths = await get(
        s.scene.branch,
        `${base}/lessons?subjectId=${s.scene.subject}&quarterId=${q1}`,
      );
      expect(maths.status, JSON.stringify(maths.body)).toBe(403);
      expect(codeOf(maths)).toBe('permission_denied');
    });

    // The Tutor of the first class reads its journal whole: Results, Attendance and the works.
    const tutor = await account();
    await load.classes.person(s.scene.branch, ['uz'], { accountId: tutor.account.id });
    await load.tutorOf(s.scene.branch, s.scene.classId, tutor.account.id);
    await as(tutor, [], async (get) => {
      const base = `/api/results/students/${s.aziz}`;
      expect(
        resultsOf(await get(s.scene.branch, base)).subjects.map((one) => one.subject.id),
      ).toEqual([s.scene.subject]);
      expect(
        studentResultTabsSchema.parse((await get(s.scene.branch, `${base}/tabs`)).body),
      ).toEqual({ results: true, attendance: true });
      const trace = studentResultLessonsSchema.parse(
        (await get(s.scene.branch, `${base}/lessons?subjectId=${s.scene.subject}&quarterId=${q1}`))
          .body,
      );
      expect(trace.reading).toBe('whole');
      expect(trace.lessons[0]?.classworks.map((one) => one.score)).toEqual([9]);
      // The other class's student: no record of the Tutor's.
      expect((await get(s.scene.branch, `/api/results/students/${shoira}`)).status).toBe(403);
    });
  });

  it('reads a subject role only through its assignments in the branch of the request', async () => {
    const s = await scene();
    const elsewhere = await t.newBranch();
    // A Head Teacher of maths in another branch, who reads the record here as the Head Tutor.
    await as(
      await account(),
      [
        { role: 'head_teacher', branchId: elsewhere, subjectIds: [s.scene.subject] },
        { role: 'head_tutor', branchId: s.scene.branch },
      ],
      async (get) => {
        const base = `/api/results/students/${s.aziz}`;
        expect(resultsOf(await get(s.scene.branch, base)).subjects).toEqual([]);
        expect(
          studentResultTabsSchema.parse((await get(s.scene.branch, `${base}/tabs`)).body),
        ).toEqual({ results: false, attendance: true });
      },
    );
    // The Senior Head Teacher of maths reads every branch's, as the role does.
    const other = await scene();
    await as(
      await account(),
      [{ role: 'senior_head_teacher', subjectIds: [s.scene.subject, other.scene.subject] }],
      async (get) => {
        expect(
          resultsOf(await get(other.scene.branch, `/api/results/students/${other.aziz}`)).subjects
            .length,
        ).toBe(1);
        // Through the branch of the request only: the other branch's student is not found here.
        expect((await get(s.scene.branch, `/api/results/students/${other.aziz}`)).status).toBe(404);
      },
    );
  });

  // The spec review of the code, must-fix 1: the year is the mean of every quarter's result
  // (07, rule 11), so a reader who does not read one of them sees no year at all.
  it('answers the year only to a reader of the subject in every quarter with a result', async () => {
    const owner = await account();
    const s = await scene({ teacher: owner.account.id });
    const lessons = await t.database.migrator
      .selectFrom('lessons')
      .select(['id', 'class_id', sql<string>`lesson_date::text`.as('date')])
      .where('lesson_date', 'in', ['2026-10-12', '2026-11-09'])
      .where('class_id', 'in', [s.scene.classId, s.scene.otherClass])
      .execute();
    const lessonOf = (classId: string, date: string) =>
      lessons.find((one) => one.class_id === classId && one.date === date)?.id ?? '';
    // Kamola: the other class in quarter 1, the owner's class from quarter 2.
    const kamola = await student(s.scene.branch, { first: 'Kamola', last: 'Yoqubova' }, [
      { classId: s.scene.otherClass, from: '2026-09-01', ownUntil: '2026-11-09' },
      { classId: s.scene.classId, from: '2026-11-09' },
    ]);
    await saveOn(s.scene.branch, '2026-10-12', [
      { lessonId: lessonOf(s.scene.otherClass, '2026-10-12'), studentId: kamola, value: 1 },
    ]);
    await saveOn(s.scene.branch, '2026-11-09', [
      { lessonId: lessonOf(s.scene.classId, '2026-11-09'), studentId: kamola, value: 1 },
    ]);
    await t.database.migrator
      .updateTable('academic_years')
      .set({ status: 'closed' })
      .where('id', '=', s.scene.year)
      .execute();
    const path = `/api/results/students/${kamola}?yearId=${s.scene.year}`;
    const later = '2026-12-29T12:00:00+05:00';
    await as(
      await account(),
      [{ role: 'principal', branchId: s.scene.branch }],
      async (get) => {
        const answer = resultsOf(await get(s.scene.branch, path));
        expect(answer.subjects.map((one) => [one.quarters.length, one.year])).toEqual([
          [2, { kind: 'number', shown: 100, grade: 5, basedOn: 2 }],
        ]);
      },
      later,
    );
    // The owner of the quarter 2 journal, who reads quarter 1 as the Head Tutor (attendance
    // only): quarter 2 and no year.
    await as(
      owner,
      [
        { role: 'teacher', branchId: s.scene.branch },
        { role: 'head_tutor', branchId: s.scene.branch },
      ],
      async (get) => {
        const answer = resultsOf(await get(s.scene.branch, path));
        expect(
          answer.subjects.map((one) => [one.quarters.map((row) => row.quarterId), one.year]),
        ).toEqual([[[await quarterOf(s.scene, 2)], null]]);
      },
      later,
    );
  });
  /** An all-subjects exemption of the student, written as the service writes one. */
  const exempt = async (
    scene: PublishedScene,
    studentId: string,
    from: string,
    until: string,
    times: readonly [string, string] | null = null,
  ) => {
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
          batch_id: '019a0000-0000-7000-8000-0000000000a1',
          kind: 'temporary',
          all_subjects: true,
          start_date: from,
          end_date: until,
          start_time: times?.[0] ?? null,
          end_time: times?.[1] ?? null,
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

  /** The answer's quarter 1 row of the scene's subject for the student. */
  const rowOf = async (
    get: (branch: string, path: string) => Promise<Response>,
    branch: string,
    studentId: string,
  ) => resultsOf(await get(branch, `/api/results/students/${studentId}`)).subjects[0]?.quarters[0];

  /** The grid's quarter figures of the student in the journal. */
  const gridRowOf = async (
    get: (branch: string, path: string) => Promise<Response>,
    branch: string,
    journalId: string,
    studentId: string,
  ) =>
    journalGridSchema
      .parse((await get(branch, `/api/journal/journals/${journalId}`)).body)
      .students.find((one) => one.id === studentId)?.quarter;

  it('answers "Exempt", a moved student’s full result and the trace of both journals, "left the subject on" and a result at leaving, as the grid does', async () => {
    const s = await scene();
    const { l12, l19, l26 } = s.lessons;
    const other = await lessonsOf(s.scene.otherClass);
    const [b12, b19] = other;
    if (b12 === undefined || b19 === undefined) throw new Error('Lessons of the other class.');
    const otherJournal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.scene.otherClass)
        .executeTakeFirstOrThrow()
    ).id;
    // Bobur: exempt the whole month (07, Effect on totals: "If none remain, the result is
    // 'Exempt'").
    const bobur = await student(s.scene.branch, { first: 'Bobur', last: 'Toshmatov' }, [
      { classId: s.scene.classId, from: '2026-09-01' },
    ]);
    await exempt(s.scene, bobur, '2026-10-01', '2026-10-31');
    // Laylo: present on the 12th in the first class, then the other class from the 19th
    // (edge/calculation, week 6).
    const laylo = await student(s.scene.branch, { first: 'Laylo', last: 'Hasanova' }, [
      { classId: s.scene.classId, from: '2026-09-01', ownUntil: '2026-10-19' },
      { classId: s.scene.otherClass, from: '2026-10-19' },
    ]);
    await saveOn(s.scene.branch, l12.date, [{ lessonId: l12.id, studentId: laylo, value: 1 }]);
    await saveOn(s.scene.branch, b19.date, [{ lessonId: b19.id, studentId: laylo, value: 0 }]);
    // Jasur: moved to a class without the subject on the 19th (edge/calculation, "A student
    // moved to a class that does not study the subject").
    const noMaths = await load.classes.schoolClass(s.scene.branch, s.scene.year, { grade: 7 });
    const jasur = await student(s.scene.branch, { first: 'Jasur', last: 'Karimov' }, [
      { classId: s.scene.classId, from: '2026-09-01', ownUntil: '2026-10-19' },
      { classId: noMaths, from: '2026-10-19' },
    ]);
    await saveOn(s.scene.branch, l12.date, [{ lessonId: l12.id, studentId: jasur, value: 1 }]);
    // Malika: left the school with the last day 20 October (a result at leaving).
    const kit = new MembersKit(t.database.migrator, await load.classes.account());
    const malika = await kit.student(s.scene.branch, { startsOn: '2026-09-01', grade: 7 });
    const leavingId = await kit.leaving(t.database.migrator, s.scene.branch, malika, '2026-10-21');
    await kit.member({
      branch: s.scene.branch,
      classId: s.scene.classId,
      studentId: malika,
      from: '2026-09-01',
      until: '2026-10-21',
      endedBy: 'leaving',
      leavingId,
    });
    await saveOn(s.scene.branch, l12.date, [{ lessonId: l12.id, studentId: malika, value: 1 }]);
    const q1 = await quarterOf(s.scene, 1);

    await as(await account(), [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      const branch = s.scene.branch;
      // "Exempt": no number and no grade, as the grid shows it.
      expect((await rowOf(get, branch, bobur))?.outcome).toEqual({ kind: 'exempt' });
      expect((await gridRowOf(get, branch, s.journal, bobur))?.result).toEqual({ kind: 'exempt' });
      // The exempt lessons in the trace: mark 4, counting nothing.
      const boburTrace = studentResultLessonsSchema.parse(
        (
          await get(
            branch,
            `/api/results/students/${bobur}/lessons?subjectId=${s.scene.subject}&quarterId=${q1}`,
          )
        ).body,
      );
      expect(boburTrace.lessons.map((one) => [one.mark, one.attendanceValue])).toEqual([
        [4, null],
        [4, null],
        [4, null],
      ]);

      // The moved student: both journals in the result, each lesson named with its unit.
      const moved = await rowOf(get, branch, laylo);
      expect(moved?.unit.id).toBe(s.scene.otherClass);
      const inGrid = await gridRowOf(get, branch, otherJournal, laylo);
      expect([moved?.attendance, moved?.outcome.kind]).toEqual([inGrid?.attendance, 'number']);
      expect(moved?.attendance).toBe(50);
      const trace = studentResultLessonsSchema.parse(
        (
          await get(
            branch,
            `/api/results/students/${laylo}/lessons?subjectId=${s.scene.subject}&quarterId=${q1}`,
          )
        ).body,
      );
      expect(trace.lessons.map((one) => [one.date, one.unit.journalId, one.mark])).toEqual([
        ['2026-10-12', s.journal, 1],
        ['2026-10-19', otherJournal, 0],
        ['2026-10-26', otherJournal, null],
      ]);

      // "left the subject on" and its flag, as the grid labels the student.
      const left = await rowOf(get, branch, jasur);
      expect(left?.leftSubjectOn).toBe('2026-10-18');
      expect(left?.outcome).toMatchObject({
        kind: 'number',
        flags: expect.arrayContaining(['left_subject']) as unknown,
      });
      // A result at leaving, labelled, with its lessons.
      const leaving = await rowOf(get, branch, malika);
      expect(leaving?.atLeaving).toBe('2026-10-20');
      expect(leaving?.basedOn).toEqual({ expected: 2, held: 2 });
      expect(leaving?.outcome).toMatchObject({ kind: 'number', flags: [] });
    });
    // Unused here: the lesson of the 26th of the first class and of the 12th of the other.
    expect([l19.id, l26.id, b12.id].every((id) => id.length > 0)).toBe(true);
  });

  it('flags a result based on few lessons, "based on n of N"', async () => {
    // A double lesson each Monday: six lessons in October; Dilnoza is exempt for the 12th and
    // the 19th and the first lesson of the 26th, so she was expected at one of six.
    const s = await publishedScene(t, load, { graded: true, double: true });
    const dilnoza = await student(s.branch, { first: 'Dilnoza', last: 'Rasulova' }, [
      { classId: s.classId, from: '2026-09-01' },
    ]);
    await exempt(s, dilnoza, '2026-10-01', '2026-10-25');
    await exempt(s, dilnoza, '2026-10-26', '2026-10-26', ['08:00', '08:45']);
    const lessons = await lessonsOf(s.classId);
    const last = lessons.at(-1);
    if (last === undefined) throw new Error('A last lesson.');
    await saveOn(s.branch, last.date, [{ lessonId: last.id, studentId: dilnoza, value: 1 }]);
    await as(await account(), [{ role: 'principal', branchId: s.branch }], async (get) => {
      const row = await rowOf(get, s.branch, dilnoza);
      expect(row?.basedOn).toEqual({ expected: 1, held: 6 });
      expect(row?.outcome).toMatchObject({
        kind: 'number',
        flags: ['few_lessons', 'attendance_only'],
      });
    });
  });

  it('leaves a cancelled lesson and a work "not held" out of the lessons behind a figure', async () => {
    const s = await scene();
    const { l19, l26 } = s.lessons;
    const work = (
      await t.database.migrator
        .insertInto('journal_works')
        .values({ branch_id: s.scene.branch, lesson_id: l19.id, kind: 'classwork', total: 10 })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await t.database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', '2026-10-19T18:00:00+05:00', true)`.execute(
        transaction,
      );
      await transaction
        .updateTable('journal_works')
        .set({ not_held: true })
        .where('id', '=', work)
        .execute();
    });
    await t.database.migrator
      .updateTable('lessons')
      .set({ cancel_cause: 'reason', cancel_reason: 'A school trip' })
      .where('id', '=', l26.id)
      .execute();
    const q1 = await quarterOf(s.scene, 1);
    await as(await account(), [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      const trace = studentResultLessonsSchema.parse(
        (
          await get(
            s.scene.branch,
            `/api/results/students/${s.aziz}/lessons?subjectId=${s.scene.subject}&quarterId=${q1}`,
          )
        ).body,
      );
      expect(trace.lessons.map((one) => [one.date, one.classworks.length])).toEqual([
        ['2026-10-12', 1],
        ['2026-10-19', 0],
      ]);
      // The result counts the same lessons: attendance 50 (12th and 19th), based on 2 of 2.
      const row = await rowOf(get, s.scene.branch, s.aziz);
      expect([row?.attendance, row?.basedOn]).toEqual([50, { expected: 2, held: 2 }]);
    });
  });
  /** Changes the subject's switches or rounds from a quarter, as the subject edit writes it. */
  const switchSubject = async (
    s: { scene: PublishedScene },
    set: (eb: ExpressionBuilder<DB, 'subjects'>) => UpdateObject<DB, 'subjects'>,
  ) => {
    await t.app.get(Transactions).run([s.scene.branch], async (transaction) => {
      await t.app.get(Audit).record(transaction, {
        branchId: s.scene.branch,
        actorId: await load.classes.account(),
        action: 'subject.edit',
      });
      await transaction
        .updateTable('subjects')
        .set((eb) => set(eb))
        .where('id', '=', s.scene.subject)
        .execute();
    });
  };

  it('takes no quarterly distribution whose rating part does not fit the quarter’s switch, in the results, the grid and the result at leaving', async () => {
    const s = await scene();
    // A student who left on the 21st, to read the result at leaving.
    const kit = new MembersKit(t.database.migrator, await load.classes.account());
    const left = await kit.student(s.scene.branch, { startsOn: '2026-09-01', grade: 7 });
    const leavingId = await kit.leaving(t.database.migrator, s.scene.branch, left, '2026-10-21');
    await kit.member({
      branch: s.scene.branch,
      classId: s.scene.classId,
      studentId: left,
      from: '2026-09-01',
      until: '2026-10-21',
      endedBy: 'leaving',
      leavingId,
    });
    await saveOn(s.scene.branch, s.lessons.l12.date, [
      { lessonId: s.lessons.l12.id, studentId: left, value: 1 },
    ]);
    // The rating exam switched on from quarter 1: the stored rows have no rating part.
    await switchSubject(s, (eb) => ({
      rating_exam: true,
      rating_round: eb('rating_round', '+', 1),
      switches_from: 1,
    }));
    await as(await account(), [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      const grid = journalGridSchema.parse(
        (await get(s.scene.branch, `/api/journal/journals/${s.journal}`)).body,
      );
      expect(grid.legend.quarterly).toBeNull();
      expect(grid.legend.daily).not.toBeNull();
      expect(
        resultsOf(await get(s.scene.branch, `/api/results/students/${s.aziz}`)).subjects,
      ).toEqual([]);
      const leaving = studentLeavingResultsSchema.parse(
        (await get(s.scene.branch, `/api/people/students/${left}/leaving-results`)).body,
      );
      expect(leaving.results).toEqual([]);
    });
  });

  it('takes no daily distribution of an earlier round, while the quarter’s fitting rows still give the result', async () => {
    const s = await scene();
    // A new weights round; the quarterly rows are written again in it, the daily row is not.
    await switchSubject(s, (eb) => ({
      weights_round: eb('weights_round', '+', 1),
      switches_from: 1,
    }));
    await t.database.migrator
      .updateTable('subject_quarter_weights')
      .set((eb) => ({ weights_round: eb('weights_round', '+', 1) }))
      .where('branch_id', '=', s.scene.branch)
      .where('subject_id', '=', s.scene.subject)
      .execute();
    await as(await account(), [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      const grid = journalGridSchema.parse(
        (await get(s.scene.branch, `/api/journal/journals/${s.journal}`)).body,
      );
      expect(grid.legend.daily).toBeNull();
      expect(grid.legend.quarterly).toEqual({
        attendance: 20,
        classwork: 40,
        homework: 40,
        ratingExam: null,
      });
      const row = (await rowOf(get, s.scene.branch, s.aziz))?.outcome;
      expect(row).toMatchObject({ kind: 'number', shown: 77 });
    });
  });

  it('shows a subject attendance only from quarter 2 in Results for quarter 1 only, in Attendance for both, and the year from quarter 1', async () => {
    const s = await scene();
    // Switched before quarter 2 starts (edge/calculation: "free before the quarter's first lesson").
    await switchSubject(s, () => ({ journal_type: 'attendance_only', switches_from: 2 }));
    const nov9 = await t.database.migrator
      .selectFrom('lessons')
      .select('id')
      .where('class_id', '=', s.scene.classId)
      .where('lesson_date', '=', '2026-11-09')
      .executeTakeFirstOrThrow();
    await saveOn(s.scene.branch, '2026-11-09', [
      { lessonId: nov9.id, studentId: s.aziz, value: 1 },
    ]);
    await t.database.migrator
      .updateTable('academic_years')
      .set({ status: 'closed' })
      .where('id', '=', s.scene.year)
      .execute();
    const [q1, q2] = [await quarterOf(s.scene, 1), await quarterOf(s.scene, 2)];
    await as(
      await account(),
      [{ role: 'principal', branchId: s.scene.branch }],
      async (get) => {
        const base = `/api/results/students/${s.aziz}?yearId=${s.scene.year}`;
        const answer = resultsOf(await get(s.scene.branch, base));
        expect(
          answer.subjects.map((one) => [one.quarters.map((row) => row.quarterId), one.year]),
        ).toEqual([[[q1], { kind: 'number', shown: 77, grade: 4, basedOn: 1 }]]);
        const attendance = studentAttendanceSchema.parse(
          (
            await get(
              s.scene.branch,
              `/api/results/students/${s.aziz}/attendance?yearId=${s.scene.year}`,
            )
          ).body,
        );
        expect(
          attendance.subjects[0]?.quarters.map((one) => [one.quarterId, one.attendanceOnly]),
        ).toEqual([
          [q1, false],
          [q2, true],
        ]);
      },
      '2026-12-29T12:00:00+05:00',
    );
  });
});
