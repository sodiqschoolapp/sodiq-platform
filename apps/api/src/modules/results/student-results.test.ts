import {
  journalGridSchema,
  studentAttendanceSchema,
  studentLeavingResultsSchema,
  studentResultLessonsSchema,
  studentResultsSchema,
  studentResultTabsSchema,
  type StudentResults,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
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

  it('reads a quarterly distribution only in the quarter’s rounds (From 2.1 decision 14, From 8.2)', async () => {
    const s = await scene();
    // A new weights round of the subject from quarter 1: the stored rows are of round 1.
    await t.app.get(Transactions).run([s.scene.branch], async (transaction) => {
      await t.app.get(Audit).record(transaction, {
        branchId: s.scene.branch,
        actorId: await load.classes.account(),
        action: 'subject.edit',
      });
      await transaction
        .updateTable('subjects')
        .set((eb) => ({ weights_round: eb('weights_round', '+', 1), switches_from: 1 }))
        .where('id', '=', s.scene.subject)
        .execute();
    });
    await as(await account(), [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      const grid = journalGridSchema.parse(
        (await get(s.scene.branch, `/api/journal/journals/${s.journal}`)).body,
      );
      expect(grid.legend.quarterly).toBeNull();
      expect(grid.legend.daily).toBeNull();
      expect(grid.students.find((one) => one.id === s.aziz)?.quarter?.result ?? null).toBeNull();
      const answer = resultsOf(await get(s.scene.branch, `/api/results/students/${s.aziz}`));
      expect(answer.subjects).toEqual([]);
      // The attendance figures stand without weights.
      const attendance = studentAttendanceSchema.parse(
        (await get(s.scene.branch, `/api/results/students/${s.aziz}/attendance`)).body,
      );
      expect(attendance.subjects[0]?.quarters[0]?.average).toBe(50);
    });
  });

  it('leaves out of Results a quarter where the subject is attendance only, and keeps it in Attendance', async () => {
    const s = await scene();
    await t.app.get(Transactions).run([s.scene.branch], async (transaction) => {
      await t.app.get(Audit).record(transaction, {
        branchId: s.scene.branch,
        actorId: await load.classes.account(),
        action: 'subject.edit',
      });
      await transaction
        .updateTable('subjects')
        .set({ journal_type: 'attendance_only', switches_from: 1 })
        .where('id', '=', s.scene.subject)
        .execute();
    });
    await as(await account(), [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      expect(
        resultsOf(await get(s.scene.branch, `/api/results/students/${s.aziz}`)).subjects,
      ).toEqual([]);
      const attendance = studentAttendanceSchema.parse(
        (await get(s.scene.branch, `/api/results/students/${s.aziz}/attendance`)).body,
      );
      expect(
        attendance.subjects[0]?.quarters.map((one) => [one.attendanceOnly, one.average]),
      ).toEqual([[true, 50]]);
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
});
