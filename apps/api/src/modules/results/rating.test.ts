import { finalQuarterRecord } from '@sodiq/calc';
import {
  BRANCH_HEADER,
  ratingChoicesSchema,
  ratingClassesListSchema,
  ratingClassListSchema,
  ratingSubjectListSchema,
  type RatingSubjectList,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { closeQuarter, reopenQuarter } from '../../testing/closing-kit.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit, type MemberRow } from '../../testing/members-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { binary } from '../../testing/xlsx-kit.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

/** Monday 2 November 2026: quarter 1 (to 31 October) has ended; its reference date is its last day. */
const AFTER = '2026-11-02T12:00:00+05:00';

const codeOf = (response: Response): unknown =>
  (response.body as { error?: { code?: string } }).error?.code;

/** Every line of the one sheet of a file, preamble included, as Excel holds it. */
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

// All names are invented. Task 9.3a: the rating (docs/spec/08-results-rating-analytics.md,
// Rating; docs/spec/07-journal.md, Effect on totals, Rating; docs/spec/edge-cases/calculation.md,
// "Two students both show 84", "A student left the school", "A student moved from one group to
// another in week 6", Ma'naviyat soati; docs/spec/edge-cases/00-definitions.md, Reference date and
// Result states; docs/spec/edge-cases/journal.md, "A results table is exported in week 6").
describe('the rating (08, Rating)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Nodira', `Rahimova${'a'.repeat(names % 7)}`);
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

  const journalOf = async (classId: string, subjectId: string) =>
    (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', classId)
        .where('subject_id', '=', subjectId)
        .executeTakeFirstOrThrow()
    ).id;

  const classworkOn = async (branch: string, lessonId: string) =>
    (
      await t.database.migrator
        .insertInto('journal_works')
        .values({ branch_id: branch, lesson_id: lessonId, kind: 'classwork', total: 10 })
        .returning('id')
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
          batch_id: '019a0000-0000-7000-8000-0000000000a1',
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

  /** A decision of the closing checklist on a flagged result, as the checklist stores it. */
  const decide = async (
    scene: PublishedScene,
    quarterId: string,
    studentId: string,
    decision: 'keep' | 'not_assessed',
  ) => {
    const writer = await load.classes.account();
    await t.app.get(Transactions).run([scene.branch], async (transaction) => {
      await t.app.get(Audit).record(transaction, {
        branchId: scene.branch,
        actorId: writer,
        action: 'results.decision_set',
      });
      await transaction
        .insertInto('quarter_result_decisions')
        .values({
          branch_id: scene.branch,
          quarter_id: quarterId,
          subject_id: scene.subject,
          student_id: studentId,
          decision,
          decided_by: writer,
          decided_at: new Date(0),
        })
        .execute();
    });
  };

  /**
   * The graded maths scene (20 · 40 · 40) of the first class, with one classwork of 10 on the
   * 12th:
   * - Aziz and Bobur present, 9 of 10; Dilnoza present, 8 of 10;
   * - Erkin: nothing entered ("No result");
   * - Farrux: present, no work ("attendance only", undecided: a number, ranked with its flag);
   * - Gulnora: exempt all October ("Exempt");
   * - Laylo: in the other class until the 18th, present there on the 12th with 10 of 10, then
   *   in the first class from the 19th, present (edge/calculation, week 6);
   * - Malika: left the school with the last day 20 October (a result at leaving).
   */
  async function scene(accounts?: { readonly teacher?: string; readonly spare?: string }) {
    const s = await publishedScene(t, load, {
      graded: true,
      secondSubject: true,
      ...(accounts === undefined ? {} : { accounts }),
    });
    const [l12, l19] = await lessonsOf(s.classId);
    const [b12] = await lessonsOf(s.otherClass);
    if (l12 === undefined || l19 === undefined || b12 === undefined) {
      throw new Error('The lessons of the two classes.');
    }
    const first = [{ classId: s.classId, from: '2026-09-01' }];
    const aziz = await student(s.branch, { first: 'Aziz', last: 'Akbarov' }, first);
    const bobur = await student(s.branch, { first: 'Bobur', last: 'Boboyev' }, first);
    const dilnoza = await student(s.branch, { first: 'Dilnoza', last: 'Dadaxonova' }, first);
    const erkin = await student(s.branch, { first: 'Erkin', last: 'Ergashev' }, first);
    const farrux = await student(s.branch, { first: 'Farrux', last: 'Fozilov' }, first);
    const gulnora = await student(s.branch, { first: 'Gulnora', last: 'Gulomova' }, first);
    const laylo = await student(s.branch, { first: 'Laylo', last: 'Hasanova' }, [
      { classId: s.otherClass, from: '2026-09-01', ownUntil: '2026-10-19' },
      { classId: s.classId, from: '2026-10-19' },
    ]);
    const kit = new MembersKit(t.database.migrator, await load.classes.account());
    const malika = await kit.student(s.branch, { startsOn: '2026-09-01', grade: 7 });
    const leavingId = await kit.leaving(t.database.migrator, s.branch, malika, '2026-10-21');
    await kit.member({
      branch: s.branch,
      classId: s.classId,
      studentId: malika,
      from: '2026-09-01',
      until: '2026-10-21',
      endedBy: 'leaving',
      leavingId,
    });
    await exempt(s, gulnora, '2026-10-01', '2026-10-31');
    const work = await classworkOn(s.branch, l12.id);
    const otherWork = await classworkOn(s.branch, b12.id);
    await saveOn(s.branch, l12.date, [
      ...[aziz, bobur, dilnoza, farrux, malika].map((id) => ({
        lessonId: l12.id,
        studentId: id,
        value: 1,
      })),
      { lessonId: l12.id, studentId: aziz, workId: work, value: 9 },
      { lessonId: l12.id, studentId: bobur, workId: work, value: 9 },
      { lessonId: l12.id, studentId: dilnoza, workId: work, value: 8 },
      { lessonId: l12.id, studentId: malika, workId: work, value: 10 },
    ]);
    await saveOn(s.branch, b12.date, [
      { lessonId: b12.id, studentId: laylo, value: 1 },
      { lessonId: b12.id, studentId: laylo, workId: otherWork, value: 10 },
    ]);
    await saveOn(s.branch, l19.date, [{ lessonId: l19.id, studentId: laylo, value: 1 }]);
    return {
      s,
      q1: await quarterOf(s, 1),
      journal: await journalOf(s.classId, s.subject),
      otherJournal: await journalOf(s.otherClass, s.subject),
      students: { aziz, bobur, dilnoza, erkin, farrux, gulnora, laylo, malika },
    };
  }

  const subjectOf = (response: Response): RatingSubjectList => {
    expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(200);
    return ratingSubjectListSchema.parse(response.body);
  };

  const placesOf = (list: RatingSubjectList) =>
    list.rows.map((row) => [row.student.firstName, row.place, row.state]);

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  it('ranks a class in one subject by the exact result, shares a place only when exactly equal, and lists the students without a number after, with no place', async () => {
    const c = await scene();
    const path = `/api/results/rating/subject?quarterId=${c.q1}&journalId=${c.journal}`;
    await as(
      await account(),
      c.s.branch,
      [{ role: 'principal', branchId: c.s.branch }],
      async ({ get }) => {
        const list = subjectOf(await get(path));
        // An undecided "attendance only" result is a number until the close decides it (decision 5):
        // ranked, with its flag; the moved-in Laylo with the full result of both journals.
        expect(placesOf(list)).toEqual([
          ['Farrux', 1, 'number'],
          ['Laylo', 1, 'number'],
          ['Aziz', 3, 'number'],
          ['Bobur', 3, 'number'],
          ['Dilnoza', 5, 'number'],
          ['Erkin', null, 'no_result'],
          ['Gulnora', null, 'exempt'],
        ]);
        const row = (first: string) => list.rows.find((one) => one.student.firstName === first);
        expect(row('Farrux')?.flags).toEqual(['attendance_only']);
        expect(row('Laylo')?.value).toBe(1000);
        // 20 · 100 and 40 · 90 over 60: 93.33, one decimal 93.3; 80 gives 86.67, 86.7.
        expect([row('Aziz')?.value, row('Bobur')?.value, row('Dilnoza')?.value]).toEqual([
          933, 933, 867,
        ]);
        expect(row('Erkin')?.value).toBeNull();
        // A student who left is left out; a moved-out one is in the other journal only.
        expect(list.rows.some((one) => one.student.id === c.students.malika)).toBe(false);
        expect(list.provisional).toBe(true);
        expect(list.final).toBeNull();
        expect(list.journal.unit.id).toBe(c.s.classId);

        const other = subjectOf(
          await get(`/api/results/rating/subject?quarterId=${c.q1}&journalId=${c.otherJournal}`),
        );
        expect(other.rows.some((one) => one.student.id === c.students.laylo)).toBe(false);
      },
    );

    // Decided "Not assessed" at the checklist: no longer ranked, and the places close up (1, 2, 2, 4).
    await decide(c.s, c.q1, c.students.farrux, 'not_assessed');
    await as(
      await account(),
      c.s.branch,
      [{ role: 'principal', branchId: c.s.branch }],
      async ({ get }) => {
        expect(placesOf(subjectOf(await get(path)))).toEqual([
          ['Laylo', 1, 'number'],
          ['Aziz', 2, 'number'],
          ['Bobur', 2, 'number'],
          ['Dilnoza', 4, 'number'],
          ['Erkin', null, 'no_result'],
          ['Farrux', null, 'not_assessed'],
          ['Gulnora', null, 'exempt'],
        ]);
      },
    );
  });

  // edge/00-definitions, Reference date: "the last day of the quarter, or today while the quarter
  // is open". Laylo moved on the 19th: in the first class on both dates; Sardor moves to the other
  // class on 29 October, so he is in the first class's list on the 27th and in the other's after
  // the quarter.
  it('counts the members on the reference date: today while the quarter is open, its last day after', async () => {
    const c = await scene();
    const sardor = await student(c.s.branch, { first: 'Sardor', last: 'Sobirov' }, [
      { classId: c.s.classId, from: '2026-09-01', ownUntil: '2026-10-29' },
      { classId: c.s.otherClass, from: '2026-10-29' },
    ]);
    const [l12] = await lessonsOf(c.s.classId);
    if (l12 === undefined) throw new Error('A lesson.');
    await saveOn(c.s.branch, l12.date, [{ lessonId: l12.id, studentId: sardor, value: 1 }]);
    const reader = await account();
    const read = (journalId: string, moment: string, roles: Omit<Held, 'validFrom'>[] = []) =>
      as(
        reader,
        c.s.branch,
        roles,
        async ({ get }) =>
          subjectOf(
            await get(`/api/results/rating/subject?quarterId=${c.q1}&journalId=${journalId}`),
          ),
        moment,
      );
    const ids = (list: RatingSubjectList) => list.rows.map((row) => row.student.id);
    const open = await read(c.journal, MOMENT, [{ role: 'principal', branchId: c.s.branch }]);
    expect(ids(open)).toContain(sardor);
    expect(ids(open)).toContain(c.students.laylo);
    expect(ids(await read(c.otherJournal, MOMENT))).not.toContain(sardor);
    const after = await read(c.journal, AFTER);
    expect(ids(after)).not.toContain(sardor);
    expect(ids(after)).toContain(c.students.laylo);
    const otherAfter = await read(c.otherJournal, AFTER);
    expect(ids(otherAfter)).toContain(sardor);
    // His full result follows him: the lesson of the first class counts in the other list.
    expect(otherAfter.rows.find((row) => row.student.id === sardor)?.state).toBe('number');
  });

  // edge/calculation, "One student has 9 subjects, another 11"; 07, Effect on totals, Rating.
  it('ranks a class across subjects by the mean of the subjects with a number, with their count and the "fewer subjects" mark', async () => {
    const c = await scene();
    await as(
      await account(),
      c.s.branch,
      [{ role: 'head_tutor', branchId: c.s.branch }],
      async ({ get }) => {
        const response = await get(
          `/api/results/rating/class?quarterId=${c.q1}&classId=${c.s.classId}`,
        );
        expect(response.status, JSON.stringify(response.body).slice(0, 500)).toBe(200);
        const list = ratingClassListSchema.parse(response.body);
        expect(
          list.rows.map((row) => [
            row.student.firstName,
            row.place,
            row.value,
            row.subjects,
            row.fewerSubjects,
          ]),
        ).toEqual([
          ['Farrux', 1, 1000, 1, false],
          ['Laylo', 1, 1000, 1, false],
          ['Aziz', 3, 933, 1, false],
          ['Bobur', 3, 933, 1, false],
          ['Dilnoza', 5, 867, 1, false],
          // "No result" and "Exempt" in the one graded subject: no figure, marked.
          ['Erkin', null, null, 0, true],
          ['Gulnora', null, null, 0, true],
        ]);
        // The attendance-only subject of the other class never counts (edge/calculation,
        // Ma'naviyat soati), and a student who left is left out.
        expect(list.rows.some((row) => row.student.id === c.students.malika)).toBe(false);
        expect(list.provisional).toBe(true);
      },
    );
  });

  it('ranks the classes of the branch by the mean result of their students, with the grade and language filters', async () => {
    const c = await scene();
    const russian = await load.classes.schoolClass(c.s.branch, c.s.year, {
      grade: 8,
      language: 'ru',
    });
    await as(
      await account(),
      c.s.branch,
      [{ role: 'academic_vice_principal', branchId: c.s.branch }],
      async ({ get }) => {
        const all = ratingClassesListSchema.parse(
          (await get(`/api/results/rating/classes?quarterId=${c.q1}`)).body,
        );
        // The first class: (100 + 100 + 93.33 + 93.33 + 86.67) ÷ 5 = 94.67; the other class has
        // nobody with a figure on the reference date; the grade 8 class neither.
        expect(all.rows.map((row) => [row.class.id, row.place, row.value, row.students])).toEqual([
          [c.s.classId, 1, 947, 5],
          [c.s.otherClass, null, null, 0],
          [russian, null, null, 0],
        ]);
        const grade = ratingClassesListSchema.parse(
          (await get(`/api/results/rating/classes?quarterId=${c.q1}&grade=8`)).body,
        );
        expect(grade.rows.map((row) => row.class.id)).toEqual([russian]);
        expect(grade.grade).toBe(8);
        const language = ratingClassesListSchema.parse(
          (await get(`/api/results/rating/classes?quarterId=${c.q1}&language=ru`)).body,
        );
        expect(language.rows.map((row) => row.class.id)).toEqual([russian]);
      },
    );
  });

  // From 9.2b: a closed quarter's results are read from its stored final records, never calculated
  // again; "During a quarter the rating is marked provisional".
  it('reads a closed quarter from its stored records, final with its version, provisional again while a journal is reopened, and marks a "not official" quarter', async () => {
    const c = await scene();
    const closer = await load.classes.account();
    const closing = await closeQuarter(t.database, {
      branchId: c.s.branch,
      quarterId: c.q1,
      accountId: closer,
    });
    // Dilnoza's stored record: one lesson, present, 10 of 10 (100), not the 86.67 of the journal now.
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
    const closedAt = (
      await t.database.migrator
        .selectFrom('quarter_closings')
        .select('closed_at')
        .where('id', '=', closing)
        .executeTakeFirstOrThrow()
    ).closed_at;
    const path = `/api/results/rating/subject?quarterId=${c.q1}&journalId=${c.journal}`;
    const reader = await account();
    const closed = await as(
      reader,
      c.s.branch,
      [{ role: 'principal', branchId: c.s.branch }],
      async ({ get }) => subjectOf(await get(path)),
      AFTER,
    );
    expect(closed.provisional).toBe(false);
    expect(closed.final).toEqual({ closedAt: closedAt.toISOString(), version: 1 });
    expect(closed.quarter.closed).toBe(true);
    expect(closed.rows.find((row) => row.student.id === c.students.dilnoza)?.value).toBe(1000);

    // The journal reopened: read live and provisional.
    await reopenQuarter(t.database, {
      branchId: c.s.branch,
      quarterId: c.q1,
      journalId: c.journal,
      accountId: closer,
      at: '2026-11-02T09:00:00+05:00',
    });
    const reopened = await as(
      reader,
      c.s.branch,
      [],
      async ({ get }) => subjectOf(await get(path)),
      AFTER,
    );
    expect(reopened.provisional).toBe(true);
    expect(reopened.final).toBeNull();
    expect(reopened.rows.find((row) => row.student.id === c.students.dilnoza)?.value).toBe(867);

    await t.database.migrator
      .updateTable('quarter_closings')
      .set({ start_quarter: 'not_official' })
      .where('id', '=', closing)
      .execute();
    const choices = await as(
      reader,
      c.s.branch,
      [],
      async ({ get }) => ratingChoicesSchema.parse((await get('/api/results/rating/choices')).body),
      AFTER,
    );
    expect(choices.quarters.find((one) => one.id === c.q1)).toMatchObject({
      closed: true,
      notOfficial: true,
    });
    expect(
      (await as(reader, c.s.branch, [], async ({ get }) => subjectOf(await get(path)), AFTER))
        .quarter.notOfficial,
    ).toBe(true);
  });

  it('opens each list only to its readers, decided in the route, and refuses the roles outside the area', async () => {
    const owner = await account();
    const spare = await account();
    const c = await scene({ teacher: owner.account.id, spare: spare.account.id });
    const elsewhere = await load.classes.subject({ grades: [7] });
    const another = await load.classes.subject({ grades: [7] });
    // A split of the first class for the subject, and a group across both classes.
    const split = await load.classes.group(c.s.branch, c.s.year, c.s.subject, [c.s.classId]);
    const mixed = await load.classes.group(c.s.branch, c.s.year, c.s.subject, [
      c.s.classId,
      c.s.otherClass,
    ]);
    const groupJournal = async (groupId: string) =>
      (
        await t.database.migrator
          .insertInto('journals')
          .values({
            branch_id: c.s.branch,
            academic_year_id: c.s.year,
            class_id: null,
            group_id: groupId,
            subject_id: c.s.subject,
            runs: '{}',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    const splitJournal = await groupJournal(split);
    const mixedJournal = await groupJournal(mixed);
    const tutor = await account();
    await load.classes.person(c.s.branch, ['uz'], { accountId: tutor.account.id });
    await load.tutorOf(c.s.branch, c.s.classId, tutor.account.id);
    const otherTutor = await account();
    await load.classes.person(c.s.branch, ['uz'], { accountId: otherTutor.account.id });
    await load.tutorOf(c.s.branch, c.s.otherClass, otherTutor.account.id);

    const subject = (journalId: string) =>
      `/api/results/rating/subject?quarterId=${c.q1}&journalId=${journalId}`;
    const classList = (classId: string) =>
      `/api/results/rating/class?quarterId=${c.q1}&classId=${classId}`;
    const classes = `/api/results/rating/classes?quarterId=${c.q1}`;
    const branch = c.s.branch;
    const cases: {
      name: string;
      held: Omit<Held, 'validFrom'>[];
      browser?: Browser;
      paths: Record<string, number>;
    }[] = [
      {
        name: 'Super Admin',
        held: [{ role: 'super_admin' }],
        paths: { [subject(c.journal)]: 200, [classList(c.s.classId)]: 200, [classes]: 200 },
      },
      {
        name: 'Principal',
        held: [{ role: 'principal', branchId: branch }],
        paths: { [subject(c.journal)]: 200, [classList(c.s.classId)]: 200, [classes]: 200 },
      },
      {
        name: 'Academic Vice Principal',
        held: [{ role: 'academic_vice_principal', branchId: branch }],
        paths: { [subject(mixedJournal)]: 200, [classList(c.s.otherClass)]: 200, [classes]: 200 },
      },
      {
        name: 'Head Teacher of the subject',
        held: [{ role: 'head_teacher', branchId: branch, subjectIds: [c.s.subject] }],
        paths: {
          [subject(c.journal)]: 200,
          [subject(mixedJournal)]: 200,
          [classList(c.s.classId)]: 403,
          [classes]: 403,
        },
      },
      {
        name: 'Head Teacher of another subject',
        held: [{ role: 'head_teacher', branchId: branch, subjectIds: [elsewhere] }],
        paths: { [subject(c.journal)]: 403 },
      },
      {
        name: 'Senior Head Teacher of the subject',
        held: [{ role: 'senior_head_teacher', subjectIds: [c.s.subject] }],
        paths: { [subject(c.otherJournal)]: 200, [classes]: 403 },
      },
      {
        name: 'Teacher who owns the journal',
        held: [{ role: 'teacher', branchId: branch }],
        browser: owner,
        paths: {
          [subject(c.journal)]: 200,
          [subject(c.otherJournal)]: 403,
          [classList(c.s.classId)]: 403,
          [classes]: 403,
        },
      },
      // .claude/rules/api.md (task 8.8): a second role that reads another subject widens nothing
      // of the first (permission review, should-fix 2).
      {
        name: 'Teacher who owns the journal, also Head Teacher of another subject',
        held: [{ role: 'head_teacher', branchId: branch, subjectIds: [another] }],
        browser: owner,
        paths: {
          [subject(c.journal)]: 200,
          [subject(c.otherJournal)]: 403,
          [subject(mixedJournal)]: 403,
        },
      },
      {
        name: 'Teacher of no journal of the class',
        held: [{ role: 'teacher', branchId: branch }],
        browser: spare,
        paths: { [subject(c.journal)]: 403 },
      },
      {
        name: 'Tutor of the first class',
        held: [],
        browser: tutor,
        paths: {
          [subject(c.journal)]: 200,
          [subject(splitJournal)]: 200,
          [subject(mixedJournal)]: 403,
          [subject(c.otherJournal)]: 403,
          [classList(c.s.classId)]: 200,
          [classList(c.s.otherClass)]: 403,
          [classes]: 403,
        },
      },
      {
        name: 'Tutor of the other class',
        held: [],
        browser: otherTutor,
        paths: { [subject(c.journal)]: 403, [classList(c.s.classId)]: 403 },
      },
      {
        name: 'Head Tutor',
        held: [{ role: 'head_tutor', branchId: branch }],
        paths: { [classList(c.s.otherClass)]: 200, [subject(c.journal)]: 403, [classes]: 403 },
      },
      // `02`: attendance only; the guard refuses every route of the area.
      {
        name: 'Vice Principal for Spiritual and Moral Education',
        held: [{ role: 'spiritual_vice_principal', branchId: branch }],
        paths: {
          '/api/results/rating/choices': 403,
          [subject(c.journal)]: 403,
          [classList(c.s.classId)]: 403,
          [classes]: 403,
        },
      },
      {
        name: 'Nurse',
        held: [{ role: 'nurse', branchId: branch }],
        paths: { '/api/results/rating/choices': 403, [classes]: 403 },
      },
    ];
    for (const one of cases) {
      const browser = one.browser ?? (await account());
      await as(browser, branch, one.held, async ({ get }) => {
        for (const [path, status] of Object.entries(one.paths)) {
          const response = await get(path);
          expect(
            response.status,
            `${one.name} ${path} ${JSON.stringify(response.body).slice(0, 200)}`,
          ).toBe(status);
          if (status === 403)
            expect(codeOf(response), `${one.name} ${path}`).toBe('permission_denied');
        }
      });
    }

    // The choices follow the same scope: the owner's journal only, no class, no list of classes.
    await as(owner, branch, [], async ({ get }) => {
      const choices = ratingChoicesSchema.parse((await get('/api/results/rating/choices')).body);
      expect(choices.journals.map((one) => one.id)).toEqual([c.journal]);
      expect(choices.classes).toEqual([]);
      expect(choices.classesList).toBe(false);
      expect(choices.quarters.map((one) => one.number)).toEqual([1]);
    });
    // The export follows the same scope (permission review, should-fix 3).
    await as(tutor, branch, [], async ({ post }) => {
      expect(
        (
          await post('/api/results/rating/export', {
            kind: 'class',
            quarterId: c.q1,
            classId: c.s.classId,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await post('/api/results/rating/export', {
            kind: 'class',
            quarterId: c.q1,
            classId: c.s.otherClass,
          })
        ).status,
      ).toBe(403);
      expect(
        (await post('/api/results/rating/export', { kind: 'classes', quarterId: c.q1 })).status,
      ).toBe(403);
    });
    await as(tutor, branch, [], async ({ get }) => {
      const choices = ratingChoicesSchema.parse((await get('/api/results/rating/choices')).body);
      expect(choices.journals.map((one) => one.id).sort()).toEqual(
        [c.journal, splitJournal].sort(),
      );
      expect(choices.classes.map((one) => one.id)).toEqual([c.s.classId]);
      expect(choices.classesList).toBe(false);
    });
  });

  it('answers 404 for a quarter, journal or class unknown or of another branch, and for an attendance-only journal', async () => {
    const c = await scene();
    const other = await scene();
    const attendanceOnly =
      c.s.secondSubject === null ? '' : await journalOf(c.s.otherClass, c.s.secondSubject);
    await as(await account(), c.s.branch, [{ role: 'super_admin' }], async ({ get }) => {
      for (const path of [
        `/api/results/rating/subject?quarterId=${UNKNOWN}&journalId=${c.journal}`,
        `/api/results/rating/subject?quarterId=${other.q1}&journalId=${c.journal}`,
        `/api/results/rating/subject?quarterId=${c.q1}&journalId=${UNKNOWN}`,
        `/api/results/rating/subject?quarterId=${c.q1}&journalId=${other.journal}`,
        `/api/results/rating/subject?quarterId=${c.q1}&journalId=${attendanceOnly}`,
        `/api/results/rating/class?quarterId=${c.q1}&classId=${UNKNOWN}`,
        `/api/results/rating/class?quarterId=${c.q1}&classId=${other.s.classId}`,
        `/api/results/rating/class?quarterId=${other.q1}&classId=${c.s.classId}`,
        `/api/results/rating/classes?quarterId=${other.q1}`,
        `/api/results/rating/choices?yearId=${other.s.year}`,
      ]) {
        const response = await get(path);
        expect(response.status, path).toBe(404);
      }
      // A reader who may not rank the journal learns nothing of it: the scope refusal first.
      const refused = await account();
      await as(
        refused,
        c.s.branch,
        [{ role: 'head_tutor', branchId: c.s.branch }],
        async (call) => {
          const response = await call.get(
            `/api/results/rating/subject?quarterId=${c.q1}&journalId=${attendanceOnly}`,
          );
          expect(response.status).toBe(403);
        },
      );
    });
  });

  // .claude/rules/api.md (task 7.1c): a route checks that the reader may read the record named
  // before any refusal that tells something of it, its year included (permission review, must-fix 1).
  it('refuses a reader outside the scope before telling that a journal or class is of another year', async () => {
    const c = await scene();
    const nextYear = await load.classes.year(c.s.branch, 'planned', '2027-09-01', '2028-05-31');
    const later = await load.classes.schoolClass(c.s.branch, nextYear, { grade: 7 });
    const laterJournal = (
      await t.database.migrator
        .insertInto('journals')
        .values({
          branch_id: c.s.branch,
          academic_year_id: nextYear,
          class_id: later,
          group_id: null,
          subject_id: c.s.subject,
          runs: '{}',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const archived = await load.classes.schoolClass(c.s.branch, c.s.year, { grade: 7 });
    await t.database.migrator
      .updateTable('classes')
      .set({ archived_at: new Date('2026-10-20T09:00:00+05:00') })
      .where('id', '=', archived)
      .execute();
    const tutor = await account();
    await load.classes.person(c.s.branch, ['uz'], { accountId: tutor.account.id });
    await load.tutorOf(c.s.branch, c.s.classId, tutor.account.id);
    const paths = [
      `/api/results/rating/subject?quarterId=${c.q1}&journalId=${laterJournal}`,
      `/api/results/rating/class?quarterId=${c.q1}&classId=${later}`,
      `/api/results/rating/class?quarterId=${c.q1}&classId=${archived}`,
    ];
    await as(tutor, c.s.branch, [], async ({ get }) => {
      for (const path of paths) {
        const response = await get(path);
        expect(response.status, path).toBe(403);
        expect(codeOf(response), path).toBe('permission_denied');
      }
    });
    await as(
      await account(),
      c.s.branch,
      [{ role: 'principal', branchId: c.s.branch }],
      async ({ get }) => {
        for (const path of paths) expect((await get(path)).status, path).toBe(404);
      },
    );
  });

  // .claude/rules/api.md: an id in the body of another branch or unknown is 404, with the audit
  // log of both branches unchanged (permission review, must-fix 2).
  it('answers 404 to an export naming a quarter, journal or class unknown or of another branch, and logs nothing', async () => {
    const c = await scene();
    const other = await scene();
    const entries = async () =>
      (
        await t.database.migrator
          .selectFrom('audit_log')
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .where('action', '=', 'rating.export')
          .where('branch_id', 'in', [c.s.branch, other.s.branch])
          .executeTakeFirstOrThrow()
      ).count;
    const before = await entries();
    // The kit holds the three Super Admins its other tests may give; a Principal reads every list.
    await as(
      await account(),
      c.s.branch,
      [{ role: 'principal', branchId: c.s.branch }],
      async ({ post }) => {
        for (const body of [
          { kind: 'subject', quarterId: UNKNOWN, journalId: c.journal },
          { kind: 'subject', quarterId: other.q1, journalId: c.journal },
          { kind: 'subject', quarterId: c.q1, journalId: UNKNOWN },
          { kind: 'subject', quarterId: c.q1, journalId: other.journal },
          { kind: 'class', quarterId: UNKNOWN, classId: c.s.classId },
          { kind: 'class', quarterId: other.q1, classId: c.s.classId },
          { kind: 'class', quarterId: c.q1, classId: UNKNOWN },
          { kind: 'class', quarterId: c.q1, classId: other.s.classId },
          { kind: 'classes', quarterId: UNKNOWN },
          { kind: 'classes', quarterId: other.q1 },
        ]) {
          expect(
            (await post('/api/results/rating/export', body)).status,
            JSON.stringify(body),
          ).toBe(404);
        }
      },
    );
    expect(await entries()).toBe(before);
  });

  // edge/journal, "A results table is exported in week 6": "Every export and print states
  // 'Provisional' with date and time, or 'Final' with the closing date and version"; CLAUDE.md:
  // "An export contains only what the role may see, and every export is logged".
  it('exports a list as Excel with the reader’s rows and the stamp, writes one audit entry, and refuses a reader the list refuses', async () => {
    const spare = await account();
    const c = await scene({ spare: spare.account.id });
    const countOf = async () =>
      (
        await t.database.migrator
          .selectFrom('audit_log')
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .where('action', '=', 'rating.export')
          .where('branch_id', '=', c.s.branch)
          .executeTakeFirstOrThrow()
      ).count;
    const body = { kind: 'subject', quarterId: c.q1, journalId: c.journal };
    const reader = await account();
    // The file is written in the language of the account.
    await t.database.migrator
      .updateTable('accounts')
      .set({ language: 'en' })
      .where('id', '=', reader.account.id)
      .execute();
    await as(
      reader,
      c.s.branch,
      [{ role: 'principal', branchId: c.s.branch }],
      async ({ post }) => {
        const response = await post('/api/results/rating/export', body);
        expect(response.status).toBe(200);
        const lines = await linesOf(response.body as Buffer);
        expect(lines[1]).toEqual(['Provisional · 27.10.2026 12:00']);
        expect(lines[2]).toEqual(['Place', 'Student', 'Result', 'Note']);
        expect(lines.slice(3).map((line) => [line[0], line[2]])).toEqual([
          [1, 100],
          [1, 100],
          [3, 93.3],
          [3, 93.3],
          [5, 86.7],
          [undefined, undefined],
          [undefined, undefined],
        ]);
        expect(lines[3]?.[3]).toBe('Attendance only, to be decided');
        expect(lines[8]?.[3]).toBe('No result');
      },
    );
    expect(await countOf()).toBe('1');
    const [entry] = await t.database.migrator
      .selectFrom('audit_log')
      .select(['details', 'actor_id', 'assignment_id', 'request_id'])
      .where('action', '=', 'rating.export')
      .where('branch_id', '=', c.s.branch)
      .execute();
    expect(entry?.actor_id).toBe(reader.account.id);
    expect(entry?.assignment_id).not.toBeNull();
    expect(entry?.request_id).not.toBeNull();
    expect(entry?.details).toMatchObject({
      kind: 'subject',
      journalId: c.journal,
      rows: 7,
      final: null,
    });

    // The Teacher of no journal of the class: refused, nothing logged.
    await as(spare, c.s.branch, [{ role: 'teacher', branchId: c.s.branch }], async ({ post }) => {
      expect((await post('/api/results/rating/export', body)).status).toBe(403);
      expect(
        (await post('/api/results/rating/export', { kind: 'classes', quarterId: c.q1 })).status,
      ).toBe(403);
    });
    // Unknown ids: 404, nothing logged.
    await as(reader, c.s.branch, [], async ({ post }) => {
      expect(
        (await post('/api/results/rating/export', { ...body, journalId: UNKNOWN })).status,
      ).toBe(404);
    });
    expect(await countOf()).toBe('1');

    // Closed: "Final" with the closing date and version.
    await closeQuarter(t.database, {
      branchId: c.s.branch,
      quarterId: c.q1,
      accountId: await load.classes.account(),
    });
    await as(
      reader,
      c.s.branch,
      [],
      async ({ post }) => {
        const response = await post('/api/results/rating/export', {
          kind: 'classes',
          quarterId: c.q1,
          language: 'uz',
        });
        expect(response.status).toBe(200);
        const lines = await linesOf(response.body as Buffer);
        expect(lines[0]).toEqual(['All grades · Uzbek · Quarter 1']);
        expect(lines[1]).toEqual(['Final · closed 31.10.2026 · version 1']);
        expect(lines[2]).toEqual(['Place', 'Class', 'Result', 'Students']);
      },
      AFTER,
    );
    expect(await countOf()).toBe('2');
  });
});
