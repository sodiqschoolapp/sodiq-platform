import { finalQuarterRecord } from '@sodiq/calc';
import {
  BRANCH_HEADER,
  earlyWarningListSchema,
  type EarlyWarningEntry,
  type EarlyWarningList,
} from '@sodiq/shared';
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
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): unknown =>
  (response.body as { error?: { code?: string } }).error?.code;

const PATH = '/api/results/early-warning';
const HANDLED = '/api/results/early-warning/handled';

// All names are invented. Task 9.4a: the early-warning list (docs/spec/08-results-rating-
// analytics.md, Early-warning list; docs/spec/edge-cases/calculation.md, "The early-warning list
// compares a mid-quarter figure without the exam against last quarter's final with the exam";
// docs/spec/edge-cases/journal.md, "Three absences in a row"). The graded maths of the scene is
// weighted 20 · 40 · 40 with no rating exam.
describe('the early-warning list (08, Early-warning list)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Shahnoza', `Yusupova${'a'.repeat(names % 7)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };

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

  /** The maths lessons of a class dated in the range, in order. */
  const lessonsOf = async (classId: string, from: string, until: string) =>
    (
      await t.database.migrator
        .selectFrom('lessons')
        .select(['id', sql<string>`lesson_date::text`.as('date')])
        .where('class_id', '=', classId)
        .where('lesson_date', '>=', from)
        .where('lesson_date', '<=', until)
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

  /** Classworks of 10 on a lesson. */
  const classworksOn = async (branch: string, lessonId: string, count: number) => {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      ids.push(
        (
          await t.database.migrator
            .insertInto('journal_works')
            .values({ branch_id: branch, lesson_id: lessonId, kind: 'classwork', total: 10 })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id,
      );
    }
    return ids;
  };

  const listOf = (response: Response): EarlyWarningList => {
    expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(200);
    return earlyWarningListSchema.parse(response.body);
  };

  const entryOf = (list: EarlyWarningList, studentId: string): EarlyWarningEntry | undefined =>
    list.entries.find((entry) => entry.student.id === studentId);

  const reasonsOf = (list: EarlyWarningList, studentId: string) =>
    entryOf(list, studentId)?.reasons.map((reason) => [reason.kind, reason.figure]) ?? [];

  const handledRows = async (branches: readonly string[]) =>
    t.database.migrator
      .selectFrom('early_warning_handled')
      .selectAll()
      .where('branch_id', 'in', [...branches])
      .orderBy('id')
      .execute();

  const auditCount = async () =>
    Number(
      (
        await t.database.migrator
          .selectFrom('audit_log')
          .select((eb) => eb.fn.countAll().as('count'))
          .where('action', '=', 'early_warning.handled')
          .executeTakeFirstOrThrow()
      ).count,
    );

  /**
   * The first class's maths in quarter 1 (Mondays 12, 19 and 26 October), five classworks of 10
   * on the 12th:
   * - Anvar: absent at all three, 1 of 10 in each of the five works (a number typed on an absent
   *   student counts: `edge/journal`): a result of 6.67, attendance 0, three absences in a row;
   * - Botir: the same with four works only: fewer than five graded works;
   * - Charos: present, 9 of 10 in each work: nothing to list;
   * - Laylo: in the other class until the 18th, absent there on the 12th with five works of 1 of
   *   10, then in the first class, absent on the 19th and 26th (From 8.6: judged on her own
   *   results across journals; the run is of one journal).
   */
  async function scene(accounts?: { readonly teacher?: string; readonly spare?: string }) {
    const s = await publishedScene(t, load, {
      graded: true,
      secondSubject: true,
      ...(accounts === undefined ? {} : { accounts }),
    });
    const [l12, l19, l26] = await lessonsOf(s.classId, '2026-10-01', '2026-10-31');
    const [b12] = await lessonsOf(s.otherClass, '2026-10-01', '2026-10-31');
    if (l12 === undefined || l19 === undefined || l26 === undefined || b12 === undefined) {
      throw new Error('The lessons of the two classes.');
    }
    const first = [{ classId: s.classId, from: '2026-09-01' }];
    const anvar = await student(s.branch, { first: 'Anvar', last: 'Aliyev' }, first);
    const botir = await student(s.branch, { first: 'Botir', last: 'Bakirov' }, first);
    const charos = await student(s.branch, { first: 'Charos', last: 'Choriyeva' }, first);
    const laylo = await student(s.branch, { first: 'Laylo', last: 'Hasanova' }, [
      { classId: s.otherClass, from: '2026-09-01', ownUntil: '2026-10-19' },
      { classId: s.classId, from: '2026-10-19' },
    ]);
    const works = await classworksOn(s.branch, l12.id, 5);
    const otherWorks = await classworksOn(s.branch, b12.id, 5);
    await saveOn(s.branch, l12.date, [
      { lessonId: l12.id, studentId: anvar, value: 0 },
      { lessonId: l12.id, studentId: botir, value: 0 },
      { lessonId: l12.id, studentId: charos, value: 1 },
      ...works.map((workId) => ({ lessonId: l12.id, studentId: anvar, workId, value: 1 })),
      ...works
        .slice(0, 4)
        .map((workId) => ({ lessonId: l12.id, studentId: botir, workId, value: 1 })),
      ...works.map((workId) => ({ lessonId: l12.id, studentId: charos, workId, value: 9 })),
    ]);
    await saveOn(s.branch, b12.date, [
      { lessonId: b12.id, studentId: laylo, value: 0 },
      ...otherWorks.map((workId) => ({ lessonId: b12.id, studentId: laylo, workId, value: 1 })),
    ]);
    for (const lesson of [l19, l26]) {
      await saveOn(s.branch, lesson.date, [
        { lessonId: lesson.id, studentId: anvar, value: 0 },
        { lessonId: lesson.id, studentId: botir, value: 0 },
        { lessonId: lesson.id, studentId: charos, value: 1 },
        { lessonId: lesson.id, studentId: laylo, value: 0 },
      ]);
    }
    return {
      s,
      q1: await quarterOf(s, 1),
      journal: await journalOf(s.classId, s.subject),
      l12,
      works,
      students: { anvar, botir, charos, laylo },
    };
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  it('lists a student with every reason and its figures, and a subject with four graded works lists nobody until the fifth', async () => {
    const c = await scene();
    const principal = await account();
    let given = false;
    const read = () =>
      as(
        principal,
        c.s.branch,
        given ? [] : [{ role: 'principal', branchId: c.s.branch }],
        async ({ get }) => {
          given = true;
          return listOf(await get(PATH));
        },
      );
    const list = await read();
    expect(list.quarter?.id).toBe(c.q1);
    expect(list.quarter?.closed).toBe(false);
    expect(list.thresholds).toEqual({
      lowResult: 50,
      resultDrop: 15,
      attendancePercent: 80,
      absencesInRow: 3,
      gradedWorks: 5,
    });
    expect(list.daysAgoDate).toBe('2026-09-29');
    // 20 · 0 and 40 · 10 over 60: 6.67, shown 7.
    expect(reasonsOf(list, c.students.anvar)).toEqual([
      ['low_result', 7],
      ['low_attendance', 0],
      ['absences_in_row', 3],
    ]);
    const anvar = entryOf(list, c.students.anvar);
    expect(anvar?.figures).toEqual({
      result: 7,
      currentWork: { now: 7, daysAgo: null, previousQuarter: null },
      attendance: 0,
      absenceRun: 3,
      gradedWorks: 5,
    });
    expect(anvar?.journal).toEqual({
      id: c.journal,
      unit: { kind: 'class', id: c.s.classId, name: expect.any(String) as string },
    });
    expect(anvar?.attendanceOnly).toBe(false);
    expect(anvar?.canHandle).toBe(false);
    // The Done-when: the same figures with four graded works list nobody.
    expect(entryOf(list, c.students.botir)).toBeUndefined();
    expect(entryOf(list, c.students.charos)).toBeUndefined();
    // Laylo's figures follow her across journals (five works, attendance 0); her run is of the
    // journal she is in now: two lessons, below three.
    expect(reasonsOf(list, c.students.laylo)).toEqual([
      ['low_result', 7],
      ['low_attendance', 0],
    ]);
    expect(entryOf(list, c.students.laylo)?.figures.absenceRun).toBe(2);
    expect(entryOf(list, c.students.laylo)?.journal.id).toBe(c.journal);

    // A fifth work for Botir: the subject is judged, and he is listed with every reason.
    const fifth = c.works[4];
    if (fifth === undefined) throw new Error('A fifth work.');
    await saveOn(c.s.branch, c.l12.date, [
      { lessonId: c.l12.id, studentId: c.students.botir, workId: fifth, value: 1 },
    ]);
    expect(reasonsOf(await read(), c.students.botir)).toEqual([
      ['low_result', 7],
      ['low_attendance', 0],
      ['absences_in_row', 3],
    ]);
  });

  it('shows each reader their own scope, the attendance reasons only to the Head Tutor and the Spiritual Vice Principal', async () => {
    const owner = await account();
    const spare = await account();
    const c = await scene({ teacher: owner.account.id, spare: spare.account.id });
    const another = await load.classes.subject({ grades: [7] });
    const third = await load.classes.subject({ grades: [7] });
    const tutor = await account();
    await load.classes.person(c.s.branch, ['uz'], { accountId: tutor.account.id });
    await load.tutorOf(c.s.branch, c.s.classId, tutor.account.id);
    const otherTutor = await account();
    await load.classes.person(c.s.branch, ['uz'], { accountId: otherTutor.account.id });
    await load.tutorOf(c.s.branch, c.s.otherClass, otherTutor.account.id);
    const branch = c.s.branch;
    const { anvar, laylo } = c.students;

    const cases: {
      name: string;
      held: Omit<Held, 'validFrom'>[];
      browser?: Browser;
      students: string[];
      attendanceOnly?: boolean;
      canHandle?: boolean;
    }[] = [
      {
        name: 'Super Admin',
        held: [],
        browser: await superAdmin(),
        students: [anvar, laylo],
        canHandle: true,
      },
      {
        name: 'Academic Vice Principal',
        held: [{ role: 'academic_vice_principal', branchId: branch }],
        students: [anvar, laylo],
        canHandle: false,
      },
      {
        name: 'Head Teacher of the subject',
        held: [{ role: 'head_teacher', branchId: branch, subjectIds: [c.s.subject] }],
        students: [anvar, laylo],
        canHandle: false,
      },
      {
        name: 'Senior Head Teacher of the subject',
        held: [{ role: 'senior_head_teacher', subjectIds: [c.s.subject] }],
        students: [anvar, laylo],
      },
      {
        name: 'Head Teacher of another subject',
        held: [{ role: 'head_teacher', branchId: branch, subjectIds: [another] }],
        students: [],
      },
      {
        name: 'Teacher who owns the journal',
        held: [{ role: 'teacher', branchId: branch }],
        browser: owner,
        students: [anvar, laylo],
        canHandle: true,
      },
      {
        name: 'Teacher of no journal of the class',
        held: [{ role: 'teacher', branchId: branch }],
        browser: spare,
        students: [],
      },
      {
        name: 'Tutor of the first class',
        held: [],
        browser: tutor,
        students: [anvar, laylo],
        canHandle: true,
      },
      // Laylo left the other class on the 18th: not of its Tutor on the reference date.
      { name: 'Tutor of the other class', held: [], browser: otherTutor, students: [] },
      {
        name: 'Head Tutor',
        held: [{ role: 'head_tutor', branchId: branch }],
        students: [anvar, laylo],
        attendanceOnly: true,
      },
      {
        name: 'Vice Principal for Spiritual and Moral Education',
        held: [{ role: 'spiritual_vice_principal', branchId: branch }],
        students: [anvar, laylo],
        attendanceOnly: true,
        canHandle: false,
      },
    ];
    for (const one of cases) {
      const browser = one.browser ?? (await account());
      await as(browser, branch, one.held, async ({ get }) => {
        const list = listOf(await get(PATH));
        expect(list.entries.map((entry) => entry.student.id).sort(), one.name).toEqual(
          [...one.students].sort(),
        );
        for (const entry of list.entries) {
          expect(entry.attendanceOnly, one.name).toBe(one.attendanceOnly ?? false);
          if (one.canHandle !== undefined) expect(entry.canHandle, one.name).toBe(one.canHandle);
          if (one.attendanceOnly === true) {
            expect(
              entry.reasons.every((reason) =>
                ['low_attendance', 'absences_in_row'].includes(reason.kind),
              ),
              one.name,
            ).toBe(true);
            expect(entry.figures.result, one.name).toBeNull();
            expect(entry.figures.currentWork.now, one.name).toBeNull();
            expect(entry.figures.gradedWorks, one.name).toBeNull();
          }
        }
      });
    }
    // The owner also Head Teacher of another subject: the second role widens nothing.
    await as(
      owner,
      branch,
      [{ role: 'head_teacher', branchId: branch, subjectIds: [third] }],
      async ({ get }) => {
        const list = listOf(await get(PATH));
        expect(list.entries.map((entry) => entry.student.id).sort()).toEqual([anvar, laylo].sort());
      },
    );
  });

  it('marks a reason handled with a note, audited, hides it, and refuses in order: 404 for each body id, 403 out of scope, 409 not listed', async () => {
    const owner = await account();
    const spare = await account();
    const c = await scene({ teacher: owner.account.id, spare: spare.account.id });
    const other = await publishedScene(t, load, { graded: true });
    const otherStudent = await student(other.branch, { first: 'Otabek', last: 'Olimov' }, [
      { classId: other.classId, from: '2026-09-01' },
    ]);
    const otherQuarter = await quarterOf(other, 1);
    const branch = c.s.branch;
    const body = {
      quarterId: c.q1,
      studentId: c.students.anvar,
      subjectId: c.s.subject,
      reason: 'low_attendance',
      note: 'Spoke to the parents.',
    };

    const refusals: { name: string; patch: object; status: number; code: string }[] = [
      {
        name: 'quarter of another branch',
        patch: { quarterId: otherQuarter },
        status: 404,
        code: 'not_found',
      },
      { name: 'unknown quarter', patch: { quarterId: UNKNOWN }, status: 404, code: 'not_found' },
      {
        name: 'student of another branch',
        patch: { studentId: otherStudent },
        status: 404,
        code: 'not_found',
      },
      { name: 'unknown student', patch: { studentId: UNKNOWN }, status: 404, code: 'not_found' },
      // Subjects are school-wide (0020): an unknown one is the only id outside the branch.
      { name: 'unknown subject', patch: { subjectId: UNKNOWN }, status: 404, code: 'not_found' },
    ];
    const rowsBefore = await handledRows([branch, other.branch]);
    const auditBefore = await auditCount();
    for (const asSuperAdmin of [false, true]) {
      const browser = asSuperAdmin ? await superAdmin() : owner;
      const held: Omit<Held, 'validFrom'>[] = asSuperAdmin
        ? []
        : [{ role: 'teacher', branchId: branch }];
      await as(browser, branch, held, async ({ post }) => {
        for (const one of refusals) {
          const response = await post(HANDLED, { ...body, ...one.patch });
          expect(response.status, `${one.name} ${JSON.stringify(response.body)}`).toBe(one.status);
          expect(codeOf(response), one.name).toBe(one.code);
        }
      });
    }
    // A Teacher of the branch who does not teach the journal: past the guard, refused in the route.
    await as(spare, branch, [{ role: 'teacher', branchId: branch }], async ({ post }) => {
      const response = await post(HANDLED, body);
      expect(response.status).toBe(403);
      expect(codeOf(response)).toBe('permission_denied');
    });
    // A Head Teacher reads the list but does not mark: refused by the guard.
    await as(
      await account(),
      branch,
      [{ role: 'head_teacher', branchId: branch, subjectIds: [c.s.subject] }],
      async ({ post }) => {
        expect((await post(HANDLED, body)).status).toBe(403);
      },
    );
    await as(owner, branch, [], async ({ post }) => {
      // Charos is listed for nothing; Anvar is not listed for a drop.
      for (const patch of [{ studentId: c.students.charos }, { reason: 'result_drop' }]) {
        const response = await post(HANDLED, { ...body, ...patch });
        expect(response.status, JSON.stringify(response.body)).toBe(409);
        expect(codeOf(response)).toBe('early_warning_not_listed');
      }
    });
    expect(await handledRows([branch, other.branch])).toEqual(rowsBefore);
    expect(await auditCount()).toBe(auditBefore);

    await as(owner, branch, [], async ({ post, get }) => {
      const response = await post(HANDLED, body);
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(response.body).toEqual({ handledAt: new Date(MOMENT).toISOString() });
      const list = listOf(await get(PATH));
      expect(reasonsOf(list, c.students.anvar)).toEqual([
        ['low_result', 7],
        ['absences_in_row', 3],
      ]);
      // Handled already, and the figure is not worse: not listed.
      const again = await post(HANDLED, body);
      expect(again.status).toBe(409);
      expect(codeOf(again)).toBe('early_warning_not_listed');
    });
    const [row] = await handledRows([branch]);
    expect(row).toMatchObject({
      quarter_id: c.q1,
      student_id: c.students.anvar,
      subject_id: c.s.subject,
      reason: 'low_attendance',
      figure: 0,
      note: 'Spoke to the parents.',
      handled_by: owner.account.id,
      handled_at: new Date(MOMENT),
    });
    const entry = await t.database.migrator
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'early_warning.handled')
      .where('record_id', '=', row?.id ?? '')
      .executeTakeFirstOrThrow();
    expect(entry.branch_id).toBe(branch);
    expect(entry.actor_id).toBe(owner.account.id);
    expect(entry.assignment_id).toBe(row?.assignment_id);
    expect(entry.new_value).toMatchObject({
      reason: 'low_attendance',
      figure: 0,
      note: 'Spoke to the parents.',
    });

    // The list's quarter is a record of the branch: another branch's, or an unknown one, is 404.
    await as(owner, branch, [], async ({ get }) => {
      for (const quarterId of [otherQuarter, UNKNOWN]) {
        const response = await get(`${PATH}?quarterId=${quarterId}`);
        expect(response.status, quarterId).toBe(404);
        expect(codeOf(response)).toBe('not_found');
      }
    });

    // The Tutor of the first class marks too (permission review, must-fix 1); the Tutor of the
    // other class is past the guard and refused in the route. The Tutor is also a Teacher of the
    // branch who teaches no journal of the class: the row and its audit entry name the Tutor's
    // assignment, the one that allows the mark (should-fix 1).
    const tutor = await account();
    await load.classes.person(branch, ['uz'], { accountId: tutor.account.id });
    await load.tutorOf(branch, c.s.classId, tutor.account.id);
    const otherTutor = await account();
    await load.classes.person(branch, ['uz'], { accountId: otherTutor.account.id });
    await load.tutorOf(branch, c.s.otherClass, otherTutor.account.id);
    const tutorBody = { ...body, reason: 'absences_in_row', note: '' };
    await as(otherTutor, branch, [], async ({ post }) => {
      const response = await post(HANDLED, tutorBody);
      expect(response.status).toBe(403);
      expect(codeOf(response)).toBe('permission_denied');
    });
    await as(tutor, branch, [{ role: 'teacher', branchId: branch }], async ({ post }) => {
      const response = await post(HANDLED, tutorBody);
      expect(response.status, JSON.stringify(response.body)).toBe(201);
    });
    const tutorRole = await t.database.migrator
      .selectFrom('assignments')
      .select('id')
      .where('account_id', '=', tutor.account.id)
      .where('role', '=', 'tutor')
      .executeTakeFirstOrThrow();
    const tutorRow = (await handledRows([branch])).find((one) => one.reason === 'absences_in_row');
    expect(tutorRow?.assignment_id).toBe(tutorRole.id);
    expect(
      (
        await t.database.migrator
          .selectFrom('audit_log')
          .select('assignment_id')
          .where('record_id', '=', tutorRow?.id ?? '')
          .executeTakeFirstOrThrow()
      ).assignment_id,
    ).toBe(tutorRole.id);

    // The Super Admin marks in the branch (must-fix 2).
    await as(await superAdmin(), branch, [], async ({ post }) => {
      const response = await post(HANDLED, { ...body, studentId: c.students.laylo, note: '' });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
    });
    expect(
      (await handledRows([branch])).some(
        (one) => one.student_id === c.students.laylo && one.reason === 'low_attendance',
      ),
    ).toBe(true);
  });

  /**
   * Quarter 2 (Mondays 9 November to 21 December) of the first class, quarter 1 closed with a
   * stored record:
   * - Ruzimat: quarter 1 stored with weights 20 · 20 · 20 · 40, present with 10 of 10 and a rating
   *   exam of 0 (stored result 50, current work 100); in quarter 2 present on 9, 16 and 23
   *   November with five works of 9 of 10 on the 9th, then absent on 30 November, 7, 14 and 21
   *   December with five works of 0 on 30 November;
   * - Sevara: absent on 9, 16 and 23 November, present on 30 November, absent on 7, 14 and 21
   *   December, five works of 10 of 10 on the 9th.
   */
  it('compares the current work with 28 days ago and with the previous quarter from its stored inputs, returns a handled reason only when worse, and refuses a closed quarter', async () => {
    const owner = await account();
    const c = await scene({ teacher: owner.account.id });
    const branch = c.s.branch;
    const first = [{ classId: c.s.classId, from: '2026-09-01' }];
    const ruzimat = await student(branch, { first: 'Ruzimat', last: 'Rasulov' }, first);
    const sevara = await student(branch, { first: 'Sevara', last: 'Saidova' }, first);
    const timur = await student(branch, { first: 'Timur', last: 'Toirov' }, first);
    const umid = await student(branch, { first: 'Umid', last: 'Usmonov' }, first);
    const q2 = await quarterOf(c.s, 2);
    const closing = await closeQuarter(t.database, {
      branchId: branch,
      quarterId: c.q1,
      accountId: await load.classes.account(),
    });
    const record = finalQuarterRecord(
      {
        weights: { attendance: 20, classwork: 20, homework: 20, ratingExam: 40 },
        attendanceValues: { lateValue: 50, skippedValue: 0 },
        lessons: [{ mark: 1, classworks: [{ score: 10, total: 10 }], homeworks: [] }],
        ratingExam: { kind: 'score', score: 0 },
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
        branch_id: branch,
        closing_id: closing,
        quarter_id: c.q1,
        subject_id: c.s.subject,
        student_id: ruzimat,
        journal_id: c.journal,
        kind: 'closing',
        record: JSON.stringify(record),
      })
      .execute();

    const umidRecord = finalQuarterRecord(
      {
        weights: { attendance: 20, classwork: 20, homework: 20, ratingExam: 40 },
        attendanceValues: { lateValue: 50, skippedValue: 0 },
        lessons: [
          {
            mark: 0,
            classworks: [1, 2, 3, 4, 5].map(() => ({ score: 1, total: 10 })),
            homeworks: [],
          },
        ],
        ratingExam: { kind: 'score', score: 0 },
        quarterClosed: true,
        heldInJournals: 3,
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
        branch_id: branch,
        closing_id: closing,
        quarter_id: c.q1,
        subject_id: c.s.subject,
        student_id: umid,
        journal_id: c.journal,
        kind: 'closing',
        record: JSON.stringify(umidRecord),
      })
      .execute();

    const lessons = await lessonsOf(c.s.classId, '2026-11-09', '2026-12-21');
    expect(lessons.map((one) => one.date)).toEqual([
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
      '2026-12-07',
      '2026-12-14',
      '2026-12-21',
    ]);
    const [n9, , , n30] = lessons;
    if (n9 === undefined || n30 === undefined) throw new Error('The lessons of quarter 2.');
    const early = await classworksOn(branch, n9.id, 5);
    const late = await classworksOn(branch, n30.id, 5);
    for (const [index, lesson] of lessons.entries()) {
      await saveOn(branch, lesson.date, [
        { lessonId: lesson.id, studentId: ruzimat, value: index < 3 ? 1 : 0 },
        { lessonId: lesson.id, studentId: sevara, value: index === 3 ? 1 : 0 },
        { lessonId: lesson.id, studentId: timur, value: index < 2 ? 1 : 0 },
        ...(lesson.id === n9.id
          ? [
              ...early.map((workId) => ({ lessonId: n9.id, studentId: ruzimat, workId, value: 9 })),
              ...early.map((workId) => ({ lessonId: n9.id, studentId: sevara, workId, value: 10 })),
              ...early.map((workId) => ({ lessonId: n9.id, studentId: timur, workId, value: 10 })),
            ]
          : []),
        ...(lesson.id === n30.id
          ? late.map((workId) => ({ lessonId: n30.id, studentId: ruzimat, workId, value: 0 }))
          : []),
      ]);
      // The cells of later lessons are typed after the reads below that come before them: a read
      // at a moment only sees lessons held by then, whatever is typed.
    }

    const at = (day: string) => `${day}T12:00:00+05:00`;
    // The owner is a Teacher of the branch from 1 September.
    await as(owner, branch, [{ role: 'teacher', branchId: branch }], () => Promise.resolve());
    const read = (day: string) =>
      as(owner, branch, [], async ({ get }) => listOf(await get(PATH)), at(day));

    // 24 November: Sevara's run of three; Ruzimat 93 against the stored current work of 100.
    const nov24 = await read('2026-11-24');
    expect(nov24.quarter?.id).toBe(q2);
    expect(nov24.daysAgoDate).toBe('2026-10-27');
    // 93 against 100: a drop of 7, not listed.
    expect(entryOf(nov24, ruzimat)).toBeUndefined();
    expect(reasonsOf(nov24, sevara)).toEqual([
      ['low_attendance', 0],
      ['absences_in_row', 3],
    ]);
    await as(
      owner,
      branch,
      [],
      async ({ post }) => {
        for (const reason of ['absences_in_row', 'low_attendance']) {
          const response = await post(HANDLED, {
            quarterId: q2,
            studentId: sevara,
            subjectId: c.s.subject,
            reason,
            note: '',
          });
          expect(response.status, JSON.stringify(response.body)).toBe(201);
        }
      },
      at('2026-11-24'),
    );
    // The same run, unchanged: hidden.
    expect(entryOf(await read('2026-11-24'), sevara)).toBeUndefined();

    // 15 December: Ruzimat's attendance 50 (three of six); handled at 50.
    const dec15 = await read('2026-12-15');
    expect(reasonsOf(dec15, ruzimat).find(([kind]) => kind === 'low_attendance')).toEqual([
      'low_attendance',
      50,
    ]);
    // Sevara: a run of two after the present lesson, attendance 17, not lower than 0: hidden.
    expect(entryOf(dec15, sevara)).toBeUndefined();
    await as(
      owner,
      branch,
      [],
      async ({ post }) => {
        const response = await post(HANDLED, {
          quarterId: q2,
          studentId: ruzimat,
          subjectId: c.s.subject,
          reason: 'low_attendance',
          note: 'Called the family.',
        });
        expect(response.status, JSON.stringify(response.body)).toBe(201);
      },
      at('2026-12-15'),
    );
    expect(
      reasonsOf(await read('2026-12-15'), ruzimat).some(([kind]) => kind === 'low_attendance'),
    ).toBe(false);

    // 22 December: 28 days ago is 24 November (9, 16 and 23 November: 93).
    const dec22 = await read('2026-12-22');
    expect(dec22.daysAgoDate).toBe('2026-11-24');
    // Attendance 3 of 7: 42.86, shown 43; classwork 45; (20 · 42.86 + 40 · 45) ÷ 60 = 44.29.
    expect(entryOf(dec22, ruzimat)?.figures).toEqual({
      result: 44,
      currentWork: { now: 44, daysAgo: 93, previousQuarter: 100 },
      attendance: 43,
      absenceRun: 4,
      gradedWorks: 10,
    });
    // The drop against the stored current work (100 − 44 = 56), not against its stored result
    // (50, with the exam), a drop of 6, below the threshold.
    const drop = entryOf(dec22, ruzimat)?.reasons.find((reason) => reason.kind === 'result_drop');
    expect(drop).toMatchObject({ figure: 56, against: ['days_ago', 'previous_quarter'] });
    // Attendance worse than when handled (43 below 50): back, with the earlier note.
    const attendance = entryOf(dec22, ruzimat)?.reasons.find(
      (reason) => reason.kind === 'low_attendance',
    );
    expect(attendance?.figure).toBe(43);
    expect(attendance?.handledBefore).toMatchObject({ note: 'Called the family.', figure: 50 });
    // Sevara: a new run of three began after the handling (review correction 2): back; her
    // attendance (14) is not lower than the 0 handled: still hidden.
    expect(reasonsOf(dec22, sevara)).toEqual([['absences_in_row', 3]]);
    expect(entryOf(dec22, sevara)?.reasons[0]?.handledBefore?.figure).toBe(3);

    // The day exactly 28 days ago, in branch time (plan; spec review of the code, must-fix 3).
    // Timur: present on 9 and 16 November with five works of 10 of 10, absent from 23 November.
    // On Monday 21 December 28 days ago is 23 November, a lesson day: counted, his attendance
    // then is 2 of 3 and the figure 88.89, shown 89; left out it would be 100. At 00:30 in
    // Tashkent the date in UTC is still 20 December: the branch's date decides.
    for (const moment of ['2026-12-21T12:00:00+05:00', '2026-12-21T00:30:00+05:00']) {
      const list = await as(owner, branch, [], async ({ get }) => listOf(await get(PATH)), moment);
      expect(list.daysAgoDate, moment).toBe('2026-11-23');
      expect(entryOf(list, timur)?.figures.currentWork.daysAgo, moment).toBe(89);
    }

    // Quarter 1 is closed: nothing is marked handled there (review correction 1), also by the
    // Super Admin; nothing is written.
    const before = await handledRows([branch]);
    const auditBefore = await auditCount();
    // Out of scope comes before closed: a Teacher of the branch who teaches no journal of the
    // class is refused 403 on the closed quarter (should-fix 5).
    const spare = await account();
    await as(
      spare,
      branch,
      [{ role: 'teacher', branchId: branch }],
      async ({ post }) => {
        const response = await post(HANDLED, {
          quarterId: c.q1,
          studentId: c.students.anvar,
          subjectId: c.s.subject,
          reason: 'low_attendance',
          note: '',
        });
        expect(response.status, JSON.stringify(response.body)).toBe(403);
        expect(codeOf(response)).toBe('permission_denied');
      },
      at('2026-12-22'),
    );
    for (const browser of [owner, await superAdmin()]) {
      await as(
        browser,
        branch,
        [],
        async ({ post }) => {
          const response = await post(HANDLED, {
            quarterId: c.q1,
            studentId: c.students.anvar,
            subjectId: c.s.subject,
            reason: 'low_attendance',
            note: '',
          });
          expect(response.status, JSON.stringify(response.body)).toBe(409);
          expect(codeOf(response)).toBe('quarter_closed');
        },
        at('2026-12-22'),
      );
    }
    expect(await handledRows([branch])).toEqual(before);
    expect(await auditCount()).toBe(auditBefore);
    // The closed quarter is read only: its entries are listed without "Mark handled".
    await as(
      owner,
      branch,
      [],
      async ({ get }) => {
        const closed = listOf(await get(`${PATH}?quarterId=${c.q1}`));
        expect(closed.quarter?.closed).toBe(true);
        expect(closed.entries.length).toBeGreaterThan(0);
        expect(closed.entries.every((entry) => !entry.canHandle)).toBe(true);
        // Umid's figures are his stored record's (2.5 shown 3 with the exam, attendance 0, five
        // works); live he has no number and no work, and would not be listed (must-fix 6).
        expect(entryOf(closed, umid)?.figures).toMatchObject({
          result: 3,
          attendance: 0,
          gradedWorks: 5,
          currentWork: { now: 5 },
        });
        expect(closed.quarters.map((one) => one.number)).toEqual([1, 2]);
      },
      at('2026-12-22'),
    );
  });

  // edge/journal, "Three absences in a row": "Exempt and cancelled lessons neither break nor
  // extend the run" (spec review of the code, must-fix 4), with the branch's own threshold
  // (From 1.6: `branch_settings.absences_in_row`; should-fix 1). Mondays 12, 19 and 26 October:
  // Dilshod absent on the 12th and the 26th; the 19th is cancelled. A threshold of 2 lists the
  // run of two; were the cancelled lesson a break, the run would be one.
  it('counts a run of absences across a cancelled lesson, against the threshold of the branch', async () => {
    const s = await publishedScene(t, load, { graded: true });
    const [l12, l19, l26] = await lessonsOf(s.classId, '2026-10-01', '2026-10-31');
    if (l12 === undefined || l19 === undefined || l26 === undefined) {
      throw new Error('The lessons of the class.');
    }
    const dilshod = await student(s.branch, { first: 'Dilshod', last: 'Davronov' }, [
      { classId: s.classId, from: '2026-09-01' },
    ]);
    await t.database.migrator
      .updateTable('lessons')
      .set({ cancel_cause: 'reason', cancel_reason: 'School trip' })
      .where('id', '=', l19.id)
      .execute();
    await t.database.migrator
      .updateTable('branch_settings')
      .set({ absences_in_row: 2 })
      .where('branch_id', '=', s.branch)
      .execute();
    const works = await classworksOn(s.branch, l12.id, 5);
    await saveOn(s.branch, l12.date, [
      { lessonId: l12.id, studentId: dilshod, value: 0 },
      ...works.map((workId) => ({ lessonId: l12.id, studentId: dilshod, workId, value: 9 })),
    ]);
    await saveOn(s.branch, l26.date, [{ lessonId: l26.id, studentId: dilshod, value: 0 }]);
    await as(
      await account(),
      s.branch,
      [{ role: 'principal', branchId: s.branch }],
      async ({ get }) => {
        const list = listOf(await get(PATH));
        expect(list.thresholds.absencesInRow).toBe(2);
        expect(entryOf(list, dilshod)?.figures.absenceRun).toBe(2);
        expect(reasonsOf(list, dilshod)).toContainEqual(['absences_in_row', 2]);
      },
    );
  });

  // 08, Transfers ("A transferred student is judged on their own results, which follow them"),
  // the From 8.6 line of 9.4a and decision 14 (code review round 1, finding 1). Nodira is in the
  // other class until the 19th: absent on the 12th and the 19th, three works of 1 of 10 on the
  // 12th. From the 20th she is in the first class: present on the 26th, two works of 10 of 10.
  // The branch's run threshold is 2, so the old journal's run alone would raise a reason. Yulduz
  // leaves the school on the 20th, absent on the 12th and the 19th with five works of 1 of 10: a
  // result at leaving, so she is not listed.
  it('judges a transferred student across both journals at the journal of the last membership, and lists nobody with a result at leaving', async () => {
    const s = await publishedScene(t, load, { graded: true });
    const [l12, l19, l26] = await lessonsOf(s.classId, '2026-10-01', '2026-10-31');
    const [b12, b19] = await lessonsOf(s.otherClass, '2026-10-01', '2026-10-31');
    if (
      l12 === undefined ||
      l19 === undefined ||
      l26 === undefined ||
      b12 === undefined ||
      b19 === undefined
    ) {
      throw new Error('The lessons of the two classes.');
    }
    await t.database.migrator
      .updateTable('branch_settings')
      .set({ absences_in_row: 2 })
      .where('branch_id', '=', s.branch)
      .execute();
    const nodira = await student(s.branch, { first: 'Nodira', last: 'Qodirova' }, [
      { classId: s.otherClass, from: '2026-09-01', ownUntil: '2026-10-20' },
      { classId: s.classId, from: '2026-10-20' },
    ]);
    const yulduz = await student(s.branch, { first: 'Yulduz', last: 'Sobirova' }, []);
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const leavingId = await members.leaving(t.database.migrator, s.branch, yulduz, '2026-10-20');
    await members.member({
      branch: s.branch,
      classId: s.classId,
      studentId: yulduz,
      from: '2026-09-01',
      until: '2026-10-20',
      endedBy: 'leaving',
      leavingId,
    });
    const oldWorks = await classworksOn(s.branch, b12.id, 3);
    const newWorks = await classworksOn(s.branch, l26.id, 2);
    const leftWorks = await classworksOn(s.branch, l12.id, 5);
    await saveOn(s.branch, b12.date, [
      { lessonId: b12.id, studentId: nodira, value: 0 },
      ...oldWorks.map((workId) => ({ lessonId: b12.id, studentId: nodira, workId, value: 1 })),
    ]);
    await saveOn(s.branch, b19.date, [{ lessonId: b19.id, studentId: nodira, value: 0 }]);
    await saveOn(s.branch, l12.date, [
      { lessonId: l12.id, studentId: yulduz, value: 0 },
      ...leftWorks.map((workId) => ({ lessonId: l12.id, studentId: yulduz, workId, value: 1 })),
    ]);
    await saveOn(s.branch, l19.date, [{ lessonId: l19.id, studentId: yulduz, value: 0 }]);
    await saveOn(s.branch, l26.date, [
      { lessonId: l26.id, studentId: nodira, value: 1 },
      ...newWorks.map((workId) => ({ lessonId: l26.id, studentId: nodira, workId, value: 10 })),
    ]);
    const journal = await journalOf(s.classId, s.subject);
    await as(
      await account(),
      s.branch,
      [{ role: 'principal', branchId: s.branch }],
      async ({ get }) => {
        const list = listOf(await get(PATH));
        expect(list.thresholds.absencesInRow).toBe(2);
        const entry = entryOf(list, nodira);
        // Listed: the three works of the old journal and the two of the new make the five.
        expect(entry?.figures.gradedWorks).toBe(5);
        // At the journal of the last membership.
        expect(entry?.journal.id).toBe(journal);
        // The run is of that journal (the present lesson of the 26th): the old journal's run of
        // two raises nothing.
        expect(entry?.figures.absenceRun).toBe(0);
        expect(reasonsOf(list, nodira).map(([kind]) => kind)).not.toContain('absences_in_row');
        // The lessons of both journals: attendance 1 of 3 lessons, 33.33; classwork 23 of 50,
        // 46; 20 · 33.33 and 40 · 46 over 60: 41.78, shown 42. The old journal alone gives 0 and
        // 7, the new one alone 100 and 100.
        expect(entry?.figures.attendance).toBe(33);
        expect(entry?.figures.currentWork.now).toBe(42);
        expect(entry?.figures.result).toBe(42);
        expect(reasonsOf(list, nodira)).toEqual([
          ['low_result', 42],
          ['low_attendance', 33],
        ]);
        // A result at leaving: not listed.
        expect(entryOf(list, yulduz)).toBeUndefined();
      },
    );
  });

  // Task 9.4b, plan decision 2 and the `classId` of the review of the plan: the narrowing of the
  // home pages, never wider than the reader's scope.
  it('narrows to own journals for the home page, whatever other role reads more', async () => {
    const owner = await account();
    const spare = await account();
    const c = await scene({ teacher: owner.account.id, spare: spare.account.id });
    const { anvar, laylo } = c.students;
    const subjectHead = {
      role: 'head_teacher' as const,
      branchId: c.s.branch,
      subjectIds: [c.s.subject],
    };
    // The owner of the journal, also Head Teacher of the subject: own journal's entries.
    await as(
      owner,
      c.s.branch,
      [{ role: 'teacher', branchId: c.s.branch }, subjectHead],
      async ({ get }) => {
        const list = listOf(await get(`${PATH}?for=own_journals`));
        expect(list.entries.map((entry) => entry.student.id).sort()).toEqual([anvar, laylo].sort());
      },
    );
    // A Teacher of no journal of the class who is Academic Vice Principal reads the branch's
    // entries on the list, and none of them as own journals (a subject has one Head Teacher).
    await as(
      spare,
      c.s.branch,
      [
        { role: 'teacher', branchId: c.s.branch },
        { role: 'academic_vice_principal', branchId: c.s.branch },
      ],
      async ({ get }) => {
        expect(
          listOf(await get(PATH))
            .entries.map((entry) => entry.student.id)
            .sort(),
        ).toEqual([anvar, laylo].sort());
        expect(listOf(await get(`${PATH}?for=own_journals`)).entries).toEqual([]);
      },
    );
    // A reader with no Teacher role owns no journal: an empty list, not a refusal.
    await as(
      await account(),
      c.s.branch,
      [{ role: 'head_tutor', branchId: c.s.branch }],
      async ({ get }) => {
        expect(listOf(await get(`${PATH}?for=own_journals`)).entries).toEqual([]);
      },
    );
  });

  it("cuts the list to one own class of a Tutor, refuses another class, and answers 404 for another branch's", async () => {
    const c = await scene();
    const { anvar, laylo } = c.students;
    const tutor = await account();
    await load.classes.person(c.s.branch, ['uz'], { accountId: tutor.account.id });
    await load.tutorOf(c.s.branch, c.s.classId, tutor.account.id);
    // A Tutor of the other class who is also Head Teacher of the subject.
    const otherTutor = await account();
    await load.classes.person(c.s.branch, ['uz'], { accountId: otherTutor.account.id });
    await load.tutorOf(c.s.branch, c.s.otherClass, otherTutor.account.id);
    const elsewhere = await publishedScene(t, load, { graded: true });
    await as(tutor, c.s.branch, [], async ({ get }) => {
      const list = listOf(await get(`${PATH}?classId=${c.s.classId}`));
      expect(list.entries.map((entry) => entry.student.id).sort()).toEqual([anvar, laylo].sort());
    });
    await as(
      otherTutor,
      c.s.branch,
      [{ role: 'head_teacher', branchId: c.s.branch, subjectIds: [c.s.subject] }],
      async ({ get }) => {
        // The whole list reads the subject's entries as Head Teacher.
        expect(
          listOf(await get(PATH))
            .entries.map((entry) => entry.student.id)
            .sort(),
        ).toEqual([anvar, laylo].sort());
        // The own class card: Laylo left it on the 18th, nobody of it is listed.
        expect(listOf(await get(`${PATH}?classId=${c.s.otherClass}`)).entries).toEqual([]);
        const refused = await get(`${PATH}?classId=${c.s.classId}`);
        expect(refused.status).toBe(403);
        expect(codeOf(refused)).toBe('permission_denied');
        for (const classId of [elsewhere.classId, UNKNOWN]) {
          const missing = await get(`${PATH}?classId=${classId}`);
          expect(missing.status).toBe(404);
        }
        const both = await get(`${PATH}?classId=${c.s.otherClass}&for=own_journals`);
        expect(both.status).toBe(400);
      },
    );
  });
});
