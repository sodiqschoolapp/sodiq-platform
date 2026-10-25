import {
  BRANCH_HEADER,
  journalGridSchema,
  journalListSchema,
  type JournalGrid,
} from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { ActingKit } from '../../testing/acting-kit.js';
import { CellsKit } from '../../testing/cells-kit.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from './cells.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const gridOf = (response: Response): JournalGrid => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return journalGridSchema.parse(response.body);
};

// All names are invented. Task 6.2, pull request #210: the journal grid, read only
// (docs/spec/07-journal.md, Opening a journal, Layout, Calculation rules, Who can do
// what; docs/spec/edge-cases/calculation.md; docs/spec/edge-cases/00-definitions.md).
describe('the journal grid', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Dilnoza', `Yusupova${'a'.repeat(names % 5)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };

  /** Runs `work` with the clock at `moment` and the roles held from 1 September. */
  async function as<T>(
    browser: Browser,
    roles: readonly Omit<Held, 'validFrom'>[],
    work: (get: (branch: string, path: string) => Promise<Response>) => Promise<T>,
    moment = MOMENT,
  ): Promise<T> {
    const given: string[] = [];
    for (const held of roles) {
      const assignment = await t.kit.giveRole(browser.account.id, {
        ...held,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
      given.push(assignment.id);
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

  /** A student of the class from `from` (until `until`), named as given. */
  const student = async (
    branch: string,
    classId: string,
    name: { first: string; last: string },
    from = '2026-09-01',
    until?: string,
  ): Promise<string> => {
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const id = await members.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: name.first, last_name: name.last })
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

  const lessonsOf = async (scene: Pick<PublishedScene, 'classId'>) =>
    t.database.migrator
      .selectFrom('lessons')
      .select(['id', 'lesson_date'])
      .where('class_id', '=', scene.classId)
      .where('lesson_date', '<=', '2026-10-31')
      .orderBy('starts_at')
      .execute();

  const journalOf = async (classId: string) =>
    (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', classId)
        .executeTakeFirstOrThrow()
    ).id;

  /** Saves cells through `saveCells` with the clock at MOMENT, as the routes of 6.3 will. */
  const save = async (
    branch: string,
    cells: { lessonId: string; studentId: string; workId?: string; value: number }[],
  ) => {
    t.clock.set(MOMENT);
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

  const work = async (
    branch: string,
    lessonId: string,
    kind: 'classwork' | 'homework',
    total: number,
  ) =>
    (
      await t.database.migrator
        .insertInto('journal_works')
        .values({ branch_id: branch, lesson_id: lessonId, kind, total })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  /**
   * The graded scene: 7th grade maths on Mondays 12, 19 and 26 October, owned
   * by the scene's teacher; Zokirov with marks 1, 2, 1, a classwork 12 of 30
   * on the 12th, a classwork 4 of 5 and a homework 5 of 10 on the 19th;
   * Oʻktamov with nothing; Abdullayev who left on the 20th with a 0 on the 12th;
   * Bakirova away from 16 to 21 October. The lesson of the 26th is cancelled
   * after its marks were typed.
   */
  async function gradedScene(accounts: { teacher?: string; spare?: string } = {}) {
    const scene = await publishedScene(t, load, { graded: true, accounts });
    const [first, second, third] = await lessonsOf(scene);
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('The scene has three lessons in the first quarter.');
    }
    const zokirov = await student(scene.branch, scene.classId, { first: 'Ali', last: 'Zokirov' });
    const oktamov = await student(scene.branch, scene.classId, { first: 'Bek', last: 'Oʻktamov' });
    const abdullayev = await student(
      scene.branch,
      scene.classId,
      { first: 'Said', last: 'Abdullayev' },
      '2026-09-01',
      '2026-10-20',
    );
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const bakirova = await student(
      scene.branch,
      scene.classId,
      { first: 'Lola', last: 'Bakirova' },
      '2026-09-01',
      '2026-10-16',
    );
    await members.member({
      branch: scene.branch,
      classId: scene.classId,
      studentId: bakirova,
      from: '2026-10-22',
    });
    const cw1 = await work(scene.branch, first.id, 'classwork', 30);
    const cw2 = await work(scene.branch, second.id, 'classwork', 5);
    const hw2 = await work(scene.branch, second.id, 'homework', 10);
    await save(scene.branch, [
      { lessonId: first.id, studentId: zokirov, value: 1 },
      { lessonId: second.id, studentId: zokirov, value: 2 },
      { lessonId: third.id, studentId: zokirov, value: 1 },
      { lessonId: first.id, studentId: zokirov, workId: cw1, value: 12 },
      { lessonId: second.id, studentId: zokirov, workId: cw2, value: 4 },
      { lessonId: second.id, studentId: zokirov, workId: hw2, value: 5 },
      { lessonId: first.id, studentId: abdullayev, value: 0 },
    ]);
    // The cancel of 6.1b-2 keeps the cells (decision 8 of 6.1a): written as the migrator.
    await t.database.migrator
      .updateTable('lessons')
      .set({ cancel_cause: 'reason', cancel_reason: 'School trip' })
      .where('id', '=', third.id)
      .execute();
    return {
      scene,
      journal: await journalOf(scene.classId),
      lessons: [first.id, second.id, third.id],
      zokirov,
      oktamov,
      abdullayev,
      bakirova,
    };
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  it('answers the lessons, works, cells and figures of the quarter from packages/calc', async () => {
    const browser = await account();
    const s = await gradedScene();
    await as(browser, [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      const grid = gridOf(await get(s.scene.branch, `/api/journal/journals/${s.journal}`));
      expect(grid.shape).toBe('whole');
      expect(grid.quarter.number).toBe(1);
      expect(grid.referenceDate).toBe('2026-10-27');
      expect(grid.today).toBe('2026-10-27');
      expect(grid.teacher?.id).toBe(s.scene.teacher.staffId);
      expect(grid.months).toEqual(['2026-10']);

      // Row 1: date and slot; the cancelled lesson keeps its reason (07, Layout).
      expect(
        grid.lessons.map((one) => [one.id, one.date, one.slot, one.held, one.cancelled]),
      ).toEqual([
        [s.lessons[0], '2026-10-12', 1, true, null],
        [s.lessons[1], '2026-10-19', 1, true, null],
        [s.lessons[2], '2026-10-26', 1, false, { cause: 'reason', reason: 'School trip' }],
      ]);
      // Row 2 and 3: each work with its kind, place and total; none on the 26th (one narrow column).
      expect(
        grid.lessons.map((one) => one.works.map((w) => [w.kind, w.position, w.total])),
      ).toEqual([
        [['classwork', 1, 30]],
        [
          ['classwork', 1, 5],
          ['homework', 1, 10],
        ],
        [],
      ]);

      // One fixed order (edge/journal): A, B, Z, then oʻ after z.
      expect(grid.students.map((one) => [one.lastName, one.number, one.folded])).toEqual([
        ['Abdullayev', 1, true],
        ['Bakirova', 2, false],
        ['Zokirov', 3, false],
        ['Oʻktamov', 4, false],
      ]);
      const [abdullayev, bakirova, zokirov, oktamov] = grid.students;

      // The number and its percent; the lesson score from the daily 20 · 40 · 40.
      expect(
        zokirov?.cells.map((cell) => [
          cell.closed,
          cell.mark,
          cell.works.map((one) => ({ score: one.score, percent: one.percent })),
          cell.score,
        ]),
      ).toEqual([
        [false, 1, [{ score: 12, percent: 40 }], 60],
        [
          false,
          2,
          [
            { score: 4, percent: 80 },
            { score: 5, percent: 50 },
          ],
          62,
        ],
        // The cancelled lesson's mark stays, takes no score and enters no figure (From 6.1b-2).
        [false, 1, [], null],
      ]);
      // Attendance 100 and 50 (75), classwork 40 and 80 (60), homework 50:
      // 20 × 75 + 40 × 60 + 40 × 50 = 59 over 100, grade 3, nothing left out.
      expect(zokirov?.quarter).toEqual({
        attendance: 75,
        classwork: 60,
        homework: 50,
        ratingExam: null,
        result: {
          kind: 'number',
          shown: 59,
          grade: 3,
          provisional: false,
          leftOut: [],
          basedOn: null,
          kept: false,
        },
      });
      expect(zokirov?.months?.['2026-10']).toEqual(zokirov?.quarter);

      // Nothing entered: "No result", blank and no grade (edge/00-definitions, Result states).
      expect(oktamov?.quarter).toEqual({
        attendance: null,
        classwork: null,
        homework: null,
        ratingExam: null,
        result: { kind: 'no_result' },
      });

      // Left on the 20th: folded with the absence of the 12th, only attendance: provisional,
      // classwork and homework left out; cells after leaving closed.
      expect(abdullayev?.cells.map((cell) => [cell.closed, cell.mark])).toEqual([
        [false, 0],
        [false, null],
        [true, null],
      ]);
      expect(abdullayev?.quarter?.result).toEqual({
        kind: 'number',
        shown: 0,
        grade: 2,
        provisional: true,
        leftOut: ['classwork', 'homework'],
        basedOn: null,
        kept: false,
      });

      // Left and came back: the gap is closed cells, not absences (edge/calculation).
      expect(bakirova?.cells.map((cell) => [cell.closed, cell.mark])).toEqual([
        [false, null],
        [true, null],
        [false, null],
      ]);

      // The bottom row: the members on the reference date with a number, each once; the
      // student who left is outside it (edge/calculation, week 6).
      expect(grid.bottom?.quarter).toEqual({
        attendance: 75,
        classwork: 60,
        homework: 50,
        ratingExam: null,
        result: 59,
      });
      expect(grid.legend).toEqual({
        lateValue: 50,
        skippedValue: 0,
        daily: { attendance: 20, classwork: 40, homework: 40 },
        quarterly: { attendance: 20, classwork: 40, homework: 40, ratingExam: null },
        weightsChangedOn: null,
        countsFrom: null,
      });
    });
  });

  it('keeps a lesson not yet started and one with no teacher recorded out of every figure', async () => {
    const browser = await account();
    const s = await gradedScene();
    // A lesson whose teacher is not recorded is not held (edge/00-definitions, Held lesson).
    await t.database.migrator
      .updateTable('lessons')
      .set({ teacher_id: null })
      .where('id', '=', s.lessons[1] ?? '')
      .execute();
    await as(browser, [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      const grid = gridOf(await get(s.scene.branch, `/api/journal/journals/${s.journal}`));
      expect(grid.lessons.map((one) => one.held)).toEqual([true, false, false]);
      const zokirov = grid.students.find((one) => one.id === s.zokirov);
      // Only the 12th counts: attendance 100, classwork 40; homework has no data.
      expect(zokirov?.quarter).toEqual({
        attendance: 100,
        classwork: 40,
        homework: null,
        ratingExam: null,
        result: {
          kind: 'number',
          shown: 60,
          grade: 3,
          provisional: true,
          leftOut: ['homework'],
          basedOn: null,
          kept: false,
        },
      });
    });
    // On Monday 19 October at 07:00 the lesson of 08:00 has not started: closed, not held.
    await as(
      browser,
      [],
      async (get) => {
        const grid = gridOf(await get(s.scene.branch, `/api/journal/journals/${s.journal}`));
        expect(grid.today).toBe('2026-10-19');
        expect(grid.referenceDate).toBe('2026-10-19');
        const zokirov = grid.students.find((one) => one.id === s.zokirov);
        expect(zokirov?.cells.map((cell) => cell.closed)).toEqual([false, true, true]);
        // The lesson not yet started enters no figure: only the 12th counts.
        expect(grid.lessons.map((one) => one.held)).toEqual([true, false, false]);
        expect(zokirov?.quarter).toEqual({
          attendance: 100,
          classwork: 40,
          homework: null,
          ratingExam: null,
          result: {
            kind: 'number',
            shown: 60,
            grade: 3,
            provisional: true,
            leftOut: ['homework'],
            basedOn: null,
            kept: false,
          },
        });
      },
      '2026-10-19T07:00:00+05:00',
    );
  });

  it('lands a result exactly on 49.5 through the route and shows 50, grade 3 (edge/calculation)', async () => {
    // "Weights 10 · 50 · 40, attendance 100, classworks 10, 10 and 25 out of 30, homework 29
    // out of 80: the exact result is 49.5, grade 3."
    const browser = await account();
    const s = await gradedScene();
    await t.database.migrator
      .updateTable('subject_quarter_weights')
      .set({ attendance: 10, classwork: 50, homework: 40, rating_exam: null })
      .where('subject_id', '=', s.scene.subject)
      .execute();
    const id = await student(s.scene.branch, s.scene.classId, { first: 'Umid', last: 'Rahimov' });
    const [first, second] = s.lessons;
    const works = [
      await work(s.scene.branch, first ?? '', 'classwork', 30),
      await work(s.scene.branch, first ?? '', 'classwork', 30),
      await work(s.scene.branch, first ?? '', 'classwork', 30),
    ];
    const homework = await work(s.scene.branch, second ?? '', 'homework', 80);
    await save(s.scene.branch, [
      { lessonId: first ?? '', studentId: id, value: 1 },
      { lessonId: first ?? '', studentId: id, workId: works[0], value: 10 },
      { lessonId: first ?? '', studentId: id, workId: works[1], value: 10 },
      { lessonId: first ?? '', studentId: id, workId: works[2], value: 25 },
      { lessonId: second ?? '', studentId: id, workId: homework, value: 29 },
    ]);
    await as(browser, [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      const grid = gridOf(await get(s.scene.branch, `/api/journal/journals/${s.journal}`));
      const rahimov = grid.students.find((one) => one.id === id);
      // Attendance 100, classwork (33.3 + 33.3 + 83.3) ÷ 3 = 50, homework 36.25:
      // 10 × 100 + 50 × 50 + 40 × 36.25 = 49.5 over 100.
      expect(rahimov?.quarter).toEqual({
        attendance: 100,
        classwork: 50,
        homework: 36,
        ratingExam: null,
        result: {
          kind: 'number',
          shown: 50,
          grade: 3,
          provisional: false,
          leftOut: [],
          basedOn: null,
          kept: false,
        },
      });
    });
  });

  it('shows the rating exam in a rating subject, the month without it and not provisional for it', async () => {
    const browser = await account();
    const s = await gradedScene();
    await t.database.migrator
      .updateTable('subjects')
      .set({ rating_exam: true })
      .where('id', '=', s.scene.subject)
      .execute();
    await t.database.migrator
      .updateTable('subject_quarter_weights')
      .set({ attendance: 20, classwork: 20, homework: 20, rating_exam: 40 })
      .where('subject_id', '=', s.scene.subject)
      .execute();
    await as(browser, [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      const grid = gridOf(await get(s.scene.branch, `/api/journal/journals/${s.journal}`));
      expect(grid.journal.ratingExam).toBe(true);
      const zokirov = grid.students.find((one) => one.id === s.zokirov);
      // (20 × 75 + 20 × 60 + 20 × 50) ÷ 60 = 61.67: provisional while the exam has no score.
      expect(zokirov?.quarter?.result).toEqual({
        kind: 'number',
        shown: 62,
        grade: 3,
        provisional: true,
        leftOut: ['ratingExam'],
        basedOn: null,
        kept: false,
      });
      // The month uses the quarter's weights without the exam, labelled so (decision 23).
      expect(zokirov?.months?.['2026-10']?.result).toEqual({
        kind: 'number',
        shown: 62,
        grade: 3,
        provisional: false,
        leftOut: [],
        basedOn: null,
        kept: false,
      });
    });
  });

  it('shows "changed on" in the legend after the quarter weights change in a started quarter', async () => {
    const browser = await account();
    const s = await gradedScene();
    const quarter = await t.database.migrator
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', s.scene.year)
      .where('number', '=', 1)
      .executeTakeFirstOrThrow();
    const vice = await account();
    await as(
      vice,
      [{ role: 'academic_vice_principal', branchId: s.scene.branch }],
      async () => {
        const changed = await request(t.kit.server)
          .put(`/api/setup/subjects/${s.scene.subject}/quarter-weights/${quarter.id}`)
          .set('Cookie', vice.cookie)
          .set(BRANCH_HEADER, s.scene.branch)
          .send({
            attendance: 30,
            classwork: 40,
            homework: 30,
            ratingExam: null,
            reason: 'Agreed by the department',
          });
        expect([200, 201], JSON.stringify(changed.body)).toContain(changed.status);
      },
      '2026-10-21T10:00:00+05:00',
    );
    await as(browser, [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      const grid = gridOf(await get(s.scene.branch, `/api/journal/journals/${s.journal}`));
      expect(grid.legend.weightsChangedOn).toBe('2026-10-21');
      expect(grid.legend.quarterly).toEqual({
        attendance: 30,
        classwork: 40,
        homework: 30,
        ratingExam: null,
      });
    });
  });

  it('gives an attendance-only subject its attendance average alone, no lesson score, result or grade, also by month', async () => {
    // edge/calculation, "Ma'naviyat soati and the Homework slot": "Attendance-only subjects have
    // no weights, no lesson score, no result and no grade. They show an attendance average".
    const browser = await account();
    const scene = await publishedScene(t, load);
    const [first, second] = await lessonsOf(scene);
    const id = await student(scene.branch, scene.classId, { first: 'Aziz', last: 'Karimov' });
    await save(scene.branch, [
      { lessonId: first?.id ?? '', studentId: id, value: 1 },
      { lessonId: second?.id ?? '', studentId: id, value: 2 },
    ]);
    const journal = await journalOf(scene.classId);
    await as(browser, [{ role: 'principal', branchId: scene.branch }], async (get) => {
      const grid = gridOf(await get(scene.branch, `/api/journal/journals/${journal}`));
      expect(grid.journal.attendanceOnly).toBe(true);
      const karimov = grid.students.find((one) => one.id === id);
      const only = {
        attendance: 75,
        classwork: null,
        homework: null,
        ratingExam: null,
        result: null,
      };
      expect(karimov?.quarter).toEqual(only);
      // The month holds the held, not cancelled lessons dated in it (review correction 5).
      expect(karimov?.months).toEqual({ '2026-10': only });
      expect(karimov?.cells.map((cell) => cell.score)).toEqual([null, null, null]);
      expect(grid.bottom?.quarter).toEqual({ ...only, result: null });
      expect(grid.legend.daily).toBeNull();
      expect(grid.legend.quarterly).toBeNull();
    });
  });

  it('gives the Vice Principal for Spiritual and Moral Education and the Head Tutor attendance only', async () => {
    const s = await gradedScene();
    for (const role of ['spiritual_vice_principal', 'head_tutor'] as const) {
      const browser = await account();
      await as(browser, [{ role, branchId: s.scene.branch }], async (get) => {
        const grid = gridOf(await get(s.scene.branch, `/api/journal/journals/${s.journal}`));
        expect(grid.shape, role).toBe('attendance');
        expect(
          grid.lessons.every((one) => one.works.length === 0),
          role,
        ).toBe(true);
        const zokirov = grid.students.find((one) => one.id === s.zokirov);
        expect(
          zokirov?.cells.map((cell) => [cell.mark, cell.works, cell.score]),
          role,
        ).toEqual([
          [1, [], null],
          [2, [], null],
          [1, [], null],
        ]);
        expect(zokirov?.quarter, role).toEqual({
          attendance: 75,
          classwork: null,
          homework: null,
          ratingExam: null,
          result: null,
        });
        expect(grid.bottom?.quarter, role).toEqual({
          attendance: 75,
          classwork: null,
          homework: null,
          ratingExam: null,
          result: null,
        });
      });
    }
  });

  it('lets the teacher who owns the journal read it whole, and a substitute only the lesson taught', async () => {
    const owner = await account();
    const substitute = await account();
    const s = await gradedScene({ teacher: owner.account.id, spare: substitute.account.id });
    await t.database.migrator
      .updateTable('lessons')
      .set({ teacher_id: s.scene.spareTeacher.staffId })
      .where('id', '=', s.lessons[1] ?? '')
      .execute();
    await as(owner, [{ role: 'teacher', branchId: s.scene.branch }], async (get) => {
      const grid = gridOf(await get(s.scene.branch, `/api/journal/journals/${s.journal}`));
      expect(grid.shape).toBe('whole');
      expect(grid.lessons).toHaveLength(3);
      const list = journalListSchema.parse(
        (await get(s.scene.branch, '/api/journal/journals')).body,
      );
      expect(list.journals.map((one) => one.id)).toEqual([s.journal]);
    });
    await as(substitute, [{ role: 'teacher', branchId: s.scene.branch }], async (get) => {
      const grid = gridOf(await get(s.scene.branch, `/api/journal/journals/${s.journal}`));
      expect(grid.shape).toBe('lessons');
      expect(grid.lessons.map((one) => one.id)).toEqual([s.lessons[1]]);
      // Only the students expected at the lesson taught: Bakirova was away on the 19th
      // (02, Teacher: "the students they teach ... and no other student").
      expect(grid.students.map((one) => one.id)).toEqual([s.abdullayev, s.zokirov, s.oktamov]);
      expect(grid.students.every((one) => one.quarter === null && one.months === null)).toBe(true);
      expect(grid.bottom).toBeNull();
      const list = journalListSchema.parse(
        (await get(s.scene.branch, '/api/journal/journals')).body,
      );
      expect(list.journals.map((one) => one.id)).toEqual([s.journal]);
    });
  });

  it('refuses a teacher of another journal, and reads a teacher who is also Head Tutor whole', async () => {
    const owner = await account();
    const other = await account();
    const s = await gradedScene({ teacher: owner.account.id, spare: other.account.id });
    await as(other, [{ role: 'teacher', branchId: s.scene.branch }], async (get) => {
      const refused = await get(s.scene.branch, `/api/journal/journals/${s.journal}`);
      expect(refused.status).toBe(403);
      expect((refused.body as { error: { code: string } }).error.code).toBe('journal_scope');
      const list = journalListSchema.parse(
        (await get(s.scene.branch, '/api/journal/journals')).body,
      );
      expect(list.journals).toEqual([]);
    });
    await as(
      owner,
      [
        { role: 'teacher', branchId: s.scene.branch },
        { role: 'head_tutor', branchId: s.scene.branch },
      ],
      async (get) => {
        const grid = gridOf(await get(s.scene.branch, `/api/journal/journals/${s.journal}`));
        expect(grid.shape).toBe('whole');
      },
    );
  });

  it('gives a Head Teacher the journals of own subjects and refuses the others', async () => {
    const s = await gradedScene();
    const own = await account();
    await as(
      own,
      [{ role: 'head_teacher', branchId: s.scene.branch, subjectIds: [s.scene.subject] }],
      async (get) => {
        expect(gridOf(await get(s.scene.branch, `/api/journal/journals/${s.journal}`)).shape).toBe(
          'whole',
        );
      },
    );
    const other = await account();
    const elsewhere = await load.classes.subject({ grades: [7] });
    await as(
      other,
      [{ role: 'head_teacher', branchId: s.scene.branch, subjectIds: [elsewhere] }],
      async (get) => {
        expect((await get(s.scene.branch, `/api/journal/journals/${s.journal}`)).status).toBe(403);
        const list = journalListSchema.parse(
          (await get(s.scene.branch, '/api/journal/journals')).body,
        );
        expect(list.journals).toEqual([]);
      },
    );
  });

  it('gives the Super Admin and the Academic Vice Principal every journal whole, and lists every one of the branch', async () => {
    const s = await gradedScene();
    const other = await journalOf(s.scene.otherClass);
    const away = await gradedScene();
    for (const held of [
      { role: 'super_admin' as const },
      { role: 'academic_vice_principal' as const, branchId: s.scene.branch },
      { role: 'principal' as const, branchId: s.scene.branch },
      { role: 'spiritual_vice_principal' as const, branchId: s.scene.branch },
    ]) {
      const browser = await account();
      await as(browser, [held], async (get) => {
        const grid = gridOf(await get(s.scene.branch, `/api/journal/journals/${s.journal}`));
        expect(grid.shape, held.role).toBe(
          held.role === 'spiritual_vice_principal' ? 'attendance' : 'whole',
        );
        const list = journalListSchema.parse(
          (await get(s.scene.branch, '/api/journal/journals')).body,
        );
        expect(list.journals.map((one) => one.id).sort(), held.role).toEqual(
          [s.journal, other].sort(),
        );
        // Another branch's journal is 404 here, also for the Super Admin.
        expect(
          (await get(s.scene.branch, `/api/journal/journals/${away.journal}`)).status,
          held.role,
        ).toBe(404);
      });
    }
  });

  it('gives a Senior Head Teacher the journals of own subjects in the branch of the request only', async () => {
    const s = await gradedScene();
    const elsewhere = await load.classes.subject({ grades: [7] });
    const own = await account();
    await as(own, [{ role: 'senior_head_teacher', subjectIds: [s.scene.subject] }], async (get) => {
      expect(gridOf(await get(s.scene.branch, `/api/journal/journals/${s.journal}`)).shape).toBe(
        'whole',
      );
      const list = journalListSchema.parse(
        (await get(s.scene.branch, '/api/journal/journals')).body,
      );
      expect(list.journals.map((one) => one.subject.id)).toEqual([
        s.scene.subject,
        s.scene.subject,
      ]);
    });
    const other = await account();
    await as(other, [{ role: 'senior_head_teacher', subjectIds: [elsewhere] }], async (get) => {
      const refused = await get(s.scene.branch, `/api/journal/journals/${s.journal}`);
      expect(refused.status).toBe(403);
      const list = journalListSchema.parse(
        (await get(s.scene.branch, '/api/journal/journals')).body,
      );
      expect(list.journals).toEqual([]);
    });
  });

  it("gives a Tutor the journals of own class whole and refuses another class's", async () => {
    const s = await gradedScene();
    const other = await journalOf(s.scene.otherClass);
    const tutor = await account();
    await load.classes.person(s.scene.branch, ['uz'], { accountId: tutor.account.id });
    await load.tutorOf(s.scene.branch, s.scene.classId, tutor.account.id);
    await as(tutor, [], async (get) => {
      const grid = gridOf(await get(s.scene.branch, `/api/journal/journals/${s.journal}`));
      expect(grid.shape).toBe('whole');
      expect(grid.bottom).not.toBeNull();
      const refused = await get(s.scene.branch, `/api/journal/journals/${other}`);
      expect(refused.status).toBe(403);
      const list = journalListSchema.parse(
        (await get(s.scene.branch, '/api/journal/journals')).body,
      );
      expect(list.journals.map((one) => one.id)).toEqual([s.journal]);
    });
  });

  it('answers 404 for an unknown journal and for one of another branch', async () => {
    const s = await gradedScene();
    const away = await gradedScene();
    const browser = await account();
    await as(browser, [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      expect((await get(s.scene.branch, `/api/journal/journals/${UNKNOWN}`)).status).toBe(404);
      expect((await get(s.scene.branch, `/api/journal/journals/${away.journal}`)).status).toBe(404);
      expect(
        (await get(s.scene.branch, `/api/journal/journals/${s.journal}?quarterId=${UNKNOWN}`))
          .status,
      ).toBe(404);
      expect((await get(s.scene.branch, `/api/journal/journals?yearId=${UNKNOWN}`)).status).toBe(
        404,
      );
    });
  });

  describe('a journal of the cells kit', () => {
    let cells: CellsKit;
    let acting: ActingKit;

    beforeAll(async () => {
      cells = await CellsKit.create(t.database.migrator);
      acting = new ActingKit(t.database.migrator);
    });

    it('gives a Tutor of one class of a group the rows of own class and no averages', async () => {
      const branch = await t.newBranch();
      const { year } = await cells.lessons.year(branch);
      const oxford = await load.classes.schoolClass(branch, year, { grade: 7 });
      const cambridge = await load.classes.schoolClass(branch, year, { grade: 7 });
      const group = await load.classes.group(branch, year, cells.subject, [oxford, cambridge]);
      const journal = (
        await t.database.migrator
          .insertInto('journals')
          .values({
            branch_id: branch,
            academic_year_id: year,
            class_id: null,
            group_id: group,
            subject_id: cells.subject,
            runs: '{}',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      const members = new MembersKit(t.database.migrator, await load.classes.account());
      const placed: Record<string, string> = {};
      for (const [name, classId] of [
        ['Nurova', oxford],
        ['Qosimov', cambridge],
      ] as const) {
        const id = await members.student(branch, { startsOn: '2026-09-01', grade: 7 });
        await t.database.migrator
          .updateTable('students')
          .set({ last_name: name })
          .where('id', '=', id)
          .execute();
        await t.database.migrator.transaction().execute(async (transaction) => {
          await members.member({ branch, classId, studentId: id, from: '2026-09-01' }, transaction);
          await members.groupMember(
            { branch, groupId: group, subjectId: cells.subject, studentId: id, from: '2026-09-01' },
            transaction,
          );
        });
        placed[name] = id;
      }
      await cells.groupLesson(branch, year, group, '2026-10-12');

      const tutor = await account();
      await as(tutor, [{ role: 'tutor', branchId: branch }], async (get) => {
        // No Tutor row yet: the journal is not of own class.
        const early = await get(branch, `/api/journal/journals/${journal}`);
        expect(early.status, JSON.stringify(early.body).slice(0, 300)).toBe(403);
      });
      const assignment = await t.database.migrator
        .selectFrom('assignments')
        .select('id')
        .where('account_id', '=', tutor.account.id)
        .where('role', '=', 'tutor')
        .executeTakeFirstOrThrow();
      await load.classes.person(branch, ['uz'], { accountId: tutor.account.id });
      const row = await load.classes.tutorRow(branch, oxford, assignment.id);
      await as(tutor, [], async (get) => {
        const grid = gridOf(await get(branch, `/api/journal/journals/${journal}`));
        expect(grid.shape).toBe('whole');
        expect(grid.students.map((one) => one.id)).toEqual([placed.Nurova]);
        expect(grid.bottom).toBeNull();
        const list = journalListSchema.parse((await get(branch, '/api/journal/journals')).body);
        expect(list.journals.map((one) => one.id)).toEqual([journal]);
      });
      // The Tutor row ends: the earlier Tutor loses access (review correction 4).
      await t.database.migrator
        .updateTable('class_tutors')
        .set({
          own_until: new Date('2026-10-20T00:00:00+05:00'),
          valid_until: new Date('2026-10-20T00:00:00+05:00'),
          end_cause: 'ended',
        })
        .where('id', '=', row)
        .execute();
      await as(tutor, [], async (get) => {
        expect((await get(branch, `/api/journal/journals/${journal}`)).status).toBe(403);
      });
    });

    it('gives a former owner the lessons they owned and no figures (review correction 1)', async () => {
      const branch = await t.newBranch();
      const { year } = await cells.lessons.year(branch);
      const classId = await load.classes.schoolClass(branch, year, { grade: 7 });
      const before = await account();
      const after = await account();
      const earlier = await load.teacher(branch, {
        subjects: [{ subject: cells.subject, grades: [7] }],
        accountId: before.account.id,
      });
      const later = await load.teacher(branch, {
        subjects: [{ subject: cells.subject, grades: [7] }],
        accountId: after.account.id,
      });
      const scene = { branch, year, classId, subject: cells.subject };
      // The kit's lessons publish versions of their own from 19 October; the two
      // versions of the scene come after them, so the later one holds that day on.
      const owned = await cells.lesson(branch, year, classId, '2026-10-12');
      const notOwned = await cells.lesson(branch, year, classId, '2026-10-26');
      await acting.published(scene, '2026-09-07', earlier.staffId);
      await acting.published(scene, '2026-10-19', later.staffId);
      const journal = await acting.journal(branch, year, classId, cells.subject);
      for (const [lesson, staff] of [
        [owned, earlier.staffId],
        [notOwned, later.staffId],
      ] as const) {
        await t.database.migrator
          .updateTable('lessons')
          .set({ teacher_id: staff })
          .where('id', '=', lesson)
          .execute();
      }
      await as(before, [{ role: 'teacher', branchId: branch }], async (get) => {
        const grid = gridOf(await get(branch, `/api/journal/journals/${journal}`));
        expect(grid.shape).toBe('lessons');
        expect(grid.teacher?.id).toBe(later.staffId);
        expect(grid.lessons.map((one) => one.id)).toEqual([owned]);
        expect(grid.bottom).toBeNull();
      });
      await as(after, [{ role: 'teacher', branchId: branch }], async (get) => {
        const grid = gridOf(await get(branch, `/api/journal/journals/${journal}`));
        expect(grid.shape).toBe('whole');
        expect(grid.lessons.map((one) => one.id)).toEqual([owned, notOwned]);
      });
    });
  });
});
