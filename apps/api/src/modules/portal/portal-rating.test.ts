import { finalQuarterRecord } from '@sodiq/calc';
import {
  apiErrorSchema,
  portalRatingSchema,
  ratingClassesListSchema,
  ratingClassListSchema,
  type PortalRating,
  type RatingClassesList,
  type RatingClassList,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { closeQuarter, reopenQuarter } from '../../testing/closing-kit.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { ParentsKit } from '../../testing/parents-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';

/** Tuesday 27 October 2026, noon in Tashkent: inside quarter 1, the Mondays 12 and 19 held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): string =>
  apiErrorSchema.safeParse(response.body).data?.error.code ?? `status ${String(response.status)}`;

/** Every string and every number of an answer, at any depth. */
function leaves(
  value: unknown,
  strings: string[] = [],
  numbers: number[] = [],
): { strings: string[]; numbers: number[] } {
  if (typeof value === 'string') strings.push(value);
  else if (typeof value === 'number') numbers.push(value);
  else if (Array.isArray(value)) for (const one of value) leaves(one, strings, numbers);
  else if (value !== null && typeof value === 'object') {
    for (const [key, one] of Object.entries(value)) {
      strings.push(key);
      leaves(one, strings, numbers);
    }
  }
  return { strings, numbers };
}

// All names are invented. Task 11.6: the own position in the rating of the parent portal (`08`,
// Rating, "Own position": "The student's own place and the class average, without other
// students' names"; plan decisions 1 to 7 and review corrections 1 to 3 of pull request #302).
// The answer holds no comment, so the section's staff-only comment case does not apply here.
describe('the portal rating', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let parents: ParentsKit;
  let s: PublishedScene;
  let q1: string;
  let journal: string;
  let parent: { cookie: string; accountId: string };
  let staff: { cookie: string; account: { id: string } };
  /** The parent's children: Kamola (tied first), Sardor, Erkin (no number), Malika (leaving), Nodir (no class yet). */
  let kids: { kamola: string; sardor: string; erkin: string; malika: string; nodir: string };
  /** Classmates of another family. */
  let others: { aziz: string; dilnoza: string; farrux: string };
  let otherFamily: string;

  const ok = (response: Response): unknown => {
    expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(200);
    return response.body;
  };

  async function fresh(accountId: string, moment: string) {
    await t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
      .where('account_id', '=', accountId)
      .execute();
  }

  async function get(path: string, moment = MOMENT): Promise<Response> {
    t.clock.set(moment);
    try {
      await fresh(parent.accountId, moment);
      return await request(t.kit.server).get(path).set('Cookie', parent.cookie);
    } finally {
      t.clock.set(START);
    }
  }

  /** A staff route as the Principal of the branch (management: every rating list). */
  async function staffGet(path: string, moment = MOMENT): Promise<Response> {
    t.clock.set(moment);
    try {
      await fresh(staff.account.id, moment);
      return await t.get(path, s.branch, staff.cookie);
    } finally {
      t.clock.set(START);
    }
  }

  const ratingOf = async (studentId: string, quarter?: string): Promise<PortalRating> =>
    portalRatingSchema.parse(
      ok(
        await get(
          `/api/portal/children/${studentId}/rating${quarter === undefined ? '' : `?quarter=${quarter}`}`,
        ),
      ),
    );

  const classList = async (): Promise<RatingClassList> =>
    ratingClassListSchema.parse(
      ok(await staffGet(`/api/results/rating/class?quarterId=${q1}&classId=${s.classId}`)),
    );

  const classesList = async (): Promise<RatingClassesList> =>
    ratingClassesListSchema.parse(
      ok(await staffGet(`/api/results/rating/classes?quarterId=${q1}`)),
    );

  /** The portal's class part against the staff lists: the child's row and the class's figure. */
  async function expectAsStaff(studentId: string, portal: PortalRating) {
    const own = (await classList()).rows.find((row) => row.student.id === studentId);
    const classes = await classesList();
    const theClass = classes.rows.find((row) => row.class.id === s.classId);
    expect(theClass).toBeDefined();
    expect(portal.class).toEqual({
      name: theClass?.class.name,
      place: own?.place ?? null,
      value: own?.value ?? null,
      subjects: own?.subjects ?? 0,
      fewerSubjects: own?.fewerSubjects ?? false,
      average: theClass?.value ?? null,
    });
    expect(portal.provisional).toBe(classes.provisional);
  }

  const saveOn = async (
    date: string,
    cells: { lessonId: string; studentId: string; workId?: string; value: number }[],
  ) => {
    t.clock.set(`${date}T18:00:00+05:00`);
    try {
      const writer = await load.classes.account();
      await t.app.get(Transactions).run([s.branch], (transaction) =>
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

  const named = (studentId: string, first: string, last: string) =>
    t.database.migrator
      .updateTable('students')
      .set({ first_name: first, last_name: last })
      .where('id', '=', studentId)
      .execute();

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    parents = new ParentsKit(t.app, t.database.migrator, await load.classes.account());
    // Maths graded (20 · 40 · 40) and an attendance-only subject in the other class.
    s = await publishedScene(t, load, { graded: true, secondSubject: true });
    q1 = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', s.year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;
    journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('subject_id', '=', s.subject)
        .executeTakeFirstOrThrow()
    ).id;
    const lessons = (
      await t.database.migrator
        .selectFrom('lessons')
        .select(['id', sql<string>`lesson_date::text`.as('date')])
        .where('class_id', '=', s.classId)
        .where('subject_id', '=', s.subject)
        .where('lesson_date', '<=', '2026-10-26')
        .orderBy('starts_at')
        .execute()
    ).map((one) => ({ id: one.id, date: one.date }));
    const l12 = lessons.find((one) => one.date === '2026-10-12');
    if (l12 === undefined) throw new Error('The lesson of the 12th.');

    const first = await parents.student(s.branch);
    const relative = first.relativeId;
    kids = {
      kamola: first.studentId,
      sardor: await parents.childOf(s.branch, relative),
      erkin: await parents.childOf(s.branch, relative),
      malika: await parents.childOf(s.branch, relative),
      nodir: await parents.childOf(s.branch, relative),
    };
    others = {
      aziz: (await parents.student(s.branch)).studentId,
      dilnoza: (await parents.student(s.branch)).studentId,
      farrux: (await parents.student(s.branch)).studentId,
    };
    otherFamily = others.aziz;
    await named(kids.kamola, 'Kamola', 'Karimova');
    await named(kids.sardor, 'Sardor', 'Karimov');
    await named(kids.erkin, 'Erkin', 'Karimov');
    await named(kids.malika, 'Malika', 'Karimova');
    await named(kids.nodir, 'Nodir', 'Karimov');
    await named(others.aziz, 'Aziz', 'Akbarov');
    await named(others.dilnoza, 'Dilnoza', 'Dadaxonova');
    await named(others.farrux, 'Farrux', 'Fozilov');
    for (const id of [kids.kamola, kids.sardor, kids.erkin, ...Object.values(others)]) {
      await parents.members.member({
        branch: s.branch,
        classId: s.classId,
        studentId: id,
        from: '2026-09-01',
      });
    }
    // Malika leaves with the last day 29 October: a member on the 27th with a result at leaving
    // (`edge/calculation`, "A student left the school"; review correction 3).
    const leavingId = await parents.members.leaving(
      t.database.migrator,
      s.branch,
      kids.malika,
      '2026-10-30',
    );
    await parents.members.member({
      branch: s.branch,
      classId: s.classId,
      studentId: kids.malika,
      from: '2026-09-01',
      until: '2026-10-30',
      endedBy: 'leaving',
      leavingId,
    });
    // Nodir joins the class only on 2 November: no class on the reference date.
    await parents.members.member({
      branch: s.branch,
      classId: s.classId,
      studentId: kids.nodir,
      from: '2026-11-02',
    });

    // One classwork of 10 on the 12th: Kamola and Aziz 9 (a shared first place), Dilnoza 7,
    // Sardor 6, Farrux 3, Malika 10 (left out); Erkin nothing (no number).
    const work = (
      await t.database.migrator
        .insertInto('journal_works')
        .values({ branch_id: s.branch, lesson_id: l12.id, kind: 'classwork', total: 10 })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const scores: [string, number][] = [
      [kids.kamola, 9],
      [others.aziz, 9],
      [others.dilnoza, 7],
      [kids.sardor, 6],
      [others.farrux, 3],
      [kids.malika, 10],
    ];
    await saveOn(
      '2026-10-12',
      scores.flatMap(([studentId, value]) => [
        { lessonId: l12.id, studentId, value: 1 },
        { lessonId: l12.id, studentId, workId: work, value },
      ]),
    );

    const session = await parents.session(relative);
    parent = { cookie: session.cookie, accountId: session.account.id };
    staff = await t.kit.completeSession('Malika', 'Rahimova');
    await t.kit.giveRole(staff.account.id, {
      role: 'principal',
      branchId: s.branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
  }, 600_000);

  afterAll(async () => {
    await t.close();
  });

  it('answers the child’s place and figure as the class list, and the class average as the list of classes', async () => {
    const portal = await ratingOf(kids.kamola);
    expect(portal.quarterId).toBe(q1);
    expect(portal.quarters.map((one) => one.number)).toEqual([1]);
    await expectAsStaff(kids.kamola, portal);
    // A shared first place (`edge/calculation`, "Two students both show 84": 1, 1, 3).
    expect(portal.class?.place).toBe(1);
    const staffRows = (await classList()).rows;
    expect(staffRows.find((row) => row.student.id === others.aziz)?.place).toBe(1);
    expect(staffRows.find((row) => row.student.id === others.dilnoza)?.place).toBe(3);
    expect(portal.provisional).toBe(true);
    // Sardor, a sibling in the same class, has his own place.
    const sardor = await ratingOf(kids.sardor);
    await expectAsStaff(kids.sardor, sardor);
    expect(sardor.class?.place).toBe(4);
  });

  it('names no other student, sends no other student’s figure or place and no count of the students ranked', async () => {
    const staffRows = (await classList()).rows;
    const average = (await classesList()).rows.find((row) => row.class.id === s.classId)?.value;
    for (const [childId, firstName] of [
      [kids.kamola, 'Kamola'],
      [kids.sardor, 'Sardor'],
    ] as const) {
      const response = await get(`/api/portal/children/${childId}/rating`);
      const body = ok(response);
      const own = staffRows.find((row) => row.student.id === childId);
      // The fixture can show a leak: every other figure differs from the child's and the average.
      const otherRows = staffRows.filter((row) => row.student.id !== childId);
      for (const row of otherRows.filter((one) => one.value !== own?.value)) {
        expect(row.value === average, row.student.firstName).toBe(false);
      }
      const { strings } = leaves(body);
      // The figures and places the answer gives: the child's own and the class average.
      const part = portalRatingSchema.parse(body).class;
      const numbers = [part?.place, part?.value, part?.average];
      const text = strings.join(' ');
      expect(text).not.toContain(firstName);
      for (const id of [...Object.values(kids), ...Object.values(others)]) {
        expect(text).not.toContain(id);
      }
      for (const name of ['Kamola', 'Sardor', 'Erkin', 'Malika', 'Aziz', 'Dilnoza', 'Farrux']) {
        expect(text).not.toContain(name);
      }
      expect(text).not.toContain('Karim');
      for (const row of otherRows) {
        if (row.value !== null && row.value !== own?.value) {
          expect(numbers, row.student.firstName).not.toContain(row.value);
        }
        if (row.place !== null && row.place !== own?.place) {
          expect(numbers, row.student.firstName).not.toContain(row.place);
        }
      }
      // The class part holds exactly these fields: no list, no count of the students ranked
      // (review correction 1).
      expect(Object.keys((body as { class: object }).class).sort()).toEqual([
        'average',
        'fewerSubjects',
        'name',
        'place',
        'subjects',
        'value',
      ]);
      expect(leaves(body).numbers).not.toContain(
        staffRows.filter((row) => row.place !== null).length,
      );
    }
  });

  it('gives no place to a child without a number, and none to a child with a result at leaving, whom the average leaves out', async () => {
    const erkin = await ratingOf(kids.erkin);
    await expectAsStaff(kids.erkin, erkin);
    expect(erkin.class).toMatchObject({ place: null, value: null, subjects: 0 });
    // Malika is a member on the reference date with a result at leaving: no place, and her 10
    // of 10 is not in the average (`edge/calculation`, "A student left the school").
    const malika = await ratingOf(kids.malika);
    await expectAsStaff(kids.malika, malika);
    expect(malika.class).toMatchObject({ place: null, value: null });
    expect((await classList()).rows.map((row) => row.student.id)).not.toContain(kids.malika);
    // The attendance-only subject of the other class is not one of the subjects counted.
    expect((await ratingOf(kids.kamola)).class?.subjects).toBe(1);
  });

  it('answers no class for a child not in a class on the reference date', async () => {
    const nodir = await ratingOf(kids.nodir);
    expect(nodir.quarterId).toBe(q1);
    expect(nodir.class).toBeNull();
  });

  it('answers 404 for a quarter not started, of another year or of another branch, and 400 for an unknown field', async () => {
    const quarter = async (number: number) =>
      (
        await t.database.migrator
          .selectFrom('quarters')
          .select('id')
          .where('academic_year_id', '=', s.year)
          .where('number', '=', number)
          .executeTakeFirstOrThrow()
      ).id;
    const other = await publishedScene(t, load, { graded: true });
    const otherQuarter = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', other.year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;
    // A quarter of another (the next) year of the child's own branch, dated, and asked for once it
    // has started while this year is still the current one: only the choice of the year keeps it
    // out (permission review of the code, must-fix 1; a branch's years follow each other, so no
    // earlier year can be added after this one).
    const nextQuarter = await t.database.migrator.transaction().execute(async (transaction) => {
      const earlier = await transaction
        .insertInto('academic_years')
        .values({ branch_id: s.branch, start_date: '2027-09-02', end_date: '2028-05-30' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const rows = await transaction
        .insertInto('quarters')
        .values(
          [1, 2, 3, 4].map((number) => ({
            branch_id: s.branch,
            academic_year_id: earlier.id,
            number,
          })),
        )
        .returning(['id', 'number'])
        .execute();
      const first = rows.find((one) => one.number === 1)?.id ?? '';
      await transaction
        .updateTable('quarters')
        .set({ start_date: '2027-09-02', end_date: '2027-10-31' })
        .where('id', '=', first)
        .execute();
      return first;
    });
    const current = await t.database.migrator
      .selectFrom('academic_years')
      .select('status')
      .where('id', '=', s.year)
      .executeTakeFirstOrThrow();
    expect(current.status).toBe('current');
    const started = await get(
      `/api/portal/children/${kids.kamola}/rating?quarter=${nextQuarter}`,
      '2027-09-15T12:00:00+05:00',
    );
    expect([started.status, codeOf(started)]).toEqual([404, 'not_found']);
    // The other branch's quarter is kept out by the row filter and by the year alike; this
    // case is not a test of the year rule (the dated quarter above is).
    for (const id of [await quarter(2), nextQuarter, otherQuarter, randomUUID()]) {
      const response = await get(`/api/portal/children/${kids.kamola}/rating?quarter=${id}`);
      expect([response.status, codeOf(response)], id).toEqual([404, 'not_found']);
      expect(JSON.stringify(response.body)).not.toContain('average');
    }
    // The current quarter is still answered when asked for by its id.
    expect((await ratingOf(kids.kamola, q1)).quarterId).toBe(q1);
    const extra = await get(`/api/portal/children/${kids.kamola}/rating?quarterId=${q1}`);
    expect(extra.status).toBe(400);
  });

  it('refuses another family’s child by id with 404, and a staff session with 403', async () => {
    const response = await get(`/api/portal/children/${otherFamily}/rating`);
    expect([response.status, codeOf(response)]).toEqual([404, 'not_found']);
    expect(JSON.stringify(response.body)).not.toContain('Aziz');
    const asStaff = await staffGet(`/api/portal/children/${kids.kamola}/rating`);
    expect([asStaff.status, codeOf(asStaff)]).toEqual([403, 'permission_denied']);
  });

  // Last: it closes the quarter.
  it('reads a closed quarter from its stored record as final, and a reopened journal live as provisional', async () => {
    const closer = await load.classes.account();
    const closing = await closeQuarter(t.database, {
      branchId: s.branch,
      quarterId: q1,
      accountId: closer,
    });
    // A stored record unlike the entries now: Kamola's classwork 10 of 10, so she is first alone.
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
        branch_id: s.branch,
        closing_id: closing,
        quarter_id: q1,
        subject_id: s.subject,
        student_id: kids.kamola,
        journal_id: journal,
        kind: 'closing',
        record: JSON.stringify(record),
      })
      .execute();
    const before = (await classList()).rows.find((row) => row.student.id === others.aziz)?.value;
    const closed = await ratingOf(kids.kamola, q1);
    await expectAsStaff(kids.kamola, closed);
    expect(closed.provisional).toBe(false);
    expect(closed.quarters.find((one) => one.id === q1)?.closed).toBe(true);
    expect(closed.class).toMatchObject({ place: 1, value: 1000 });
    expect(closed.class?.value).not.toBe(before);
    // A journal reopened (9.2c): read live again and provisional, as the staff list.
    await reopenQuarter(t.database, {
      branchId: s.branch,
      quarterId: q1,
      journalId: journal,
      accountId: closer,
      at: '2026-11-02T10:00:00+05:00',
    });
    const reopened = await ratingOf(kids.kamola, q1);
    await expectAsStaff(kids.kamola, reopened);
    expect(reopened.provisional).toBe(true);
    expect(reopened.class?.value).toBe(before);
  });
});
