import { randomUUID } from 'node:crypto';
import {
  REQUEST_KEY_HEADER,
  exemptionCreatedSchema,
  exemptionsTodaySchema,
  type ExemptionCreate,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';
/** Monday 9 November 2026, noon, the first day of quarter 2: the day after an exemption that ended on Sunday 8 November. */
const MONDAY_AFTER = '2026-11-09T12:00:00+05:00';

/** The tables the exemption routes write (`.claude/rules/api.md`: every row, both branches). */
const WRITTEN = [
  'exemptions',
  'exemption_subjects',
  'exemption_spans',
  'exemption_skips',
  'exemption_clears',
  'exemption_reopened_cells',
  'exemption_move_offers',
  'journal_cells',
  'notifications',
] as const;

// All names are invented. Task 8.5, pull request #223: the branch, the ids, the request key and
// the scope of the exemption routes (permission review of the code, findings 4, 5, 6, 8, 9, 10
// and 11).
describe('exemptions: the branch, the ids and the scope', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Malika', `Yusupova${'a'.repeat(names % 7)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };
  interface Calls {
    get: (path: string) => Promise<Response>;
    post: (path: string, body?: object, key?: string) => Promise<Response>;
    patch: (path: string, body: object) => Promise<Response>;
  }

  async function as<T>(
    branch: string,
    browser: Browser,
    roles: readonly Omit<Held, 'validFrom'>[],
    work: (calls: Calls) => Promise<T>,
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
        get: (path) => t.get(path, branch, browser.cookie),
        post: (path, body, key) =>
          t
            .post(path, branch, body ?? {}, browser.cookie)
            .set(REQUEST_KEY_HEADER, key ?? randomUUID()),
        patch: (path, body) => t.patch(path, branch, body, browser.cookie),
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
      .set({ first_name: 'Olim', last_name: last })
      .where('id', '=', id)
      .execute();
    await members.member({ branch, classId, studentId: id, from: '2026-09-01' });
    return id;
  };

  /**
   * A published branch: maths of the class and of the other class on Monday at 08:00, each with
   * a teacher of its own; the class's teacher (the owner's account) also teaches the second
   * subject to the other class on Monday at 09:50; a spare teacher with an account.
   */
  async function scene() {
    const owner = await account();
    const spare = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      secondSubject: true,
      accounts: { teacher: owner.account.id, spare: spare.account.id },
    });
    const lessons = (
      await t.database.migrator
        .selectFrom('lessons')
        .select(['id', sql<string>`lesson_date::text`.as('date')])
        .where('class_id', '=', s.classId)
        .where('lesson_date', '<=', '2026-11-30')
        .orderBy('starts_at')
        .execute()
    ).map((row) => ({ id: row.id, date: row.date }));
    const vice = await account();
    await t.kit.giveRole(vice.account.id, {
      role: 'academic_vice_principal',
      branchId: s.branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    return {
      ...s,
      owner,
      spare,
      vice,
      lessons,
      ahmedov: await student(s.branch, s.classId, 'Ahmedov'),
      boboyev: await student(s.branch, s.classId, 'Boboyev'),
      other: await student(s.branch, s.otherClass, 'Sobirov'),
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  const lessonOn = (s: Scene, date: string) => {
    const found = s.lessons.find((one) => one.date === date);
    if (found === undefined) throw new Error(`A lesson of the class on ${date}.`);
    return found.id;
  };

  /** A typed mark, written by the migrator at a moment of the lesson's day. */
  const mark = async (branch: string, lessonId: string, studentId: string, value: number) =>
    t.database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', '2026-10-12T09:00:00+05:00', true)`.execute(
        transaction,
      );
      await transaction
        .insertInto('journal_cells')
        .values({
          branch_id: branch,
          lesson_id: lessonId,
          student_id: studentId,
          mark: value,
          version: 1,
          changed_by: await accountOfAdmin(),
          changed_how: 'entry',
          changed_at: new Date(0),
        })
        .execute();
    });

  let admin = '';
  const accountOfAdmin = async () => {
    if (admin === '') {
      const row = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('id', '=', t.adminAssignment)
        .executeTakeFirstOrThrow();
      admin = row.account_id;
    }
    return admin;
  };

  /** The clock at the moment, with the Super Admin's session in use then. */
  const adminAt = async (moment: string) => {
    t.clock.set(moment);
    await t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
      .where('account_id', '=', await accountOfAdmin())
      .execute();
  };

  const body = (input: Partial<ExemptionCreate> & { studentIds: string[] }): ExemptionCreate => ({
    kind: 'temporary',
    subjectIds: null,
    startDate: '2026-11-16',
    endDate: '2026-11-18',
    slots: null,
    category: 'illness',
    detail: 'A certificate from the clinic',
    choices: [],
    ...input,
  });

  /** Every row of the tables the routes write, in the branches, and the audit log's count. */
  const snapshot = async (branches: readonly string[]) => {
    const rows: Record<string, unknown[]> = {};
    for (const table of WRITTEN) {
      rows[table] = (
        await sql<{ row: unknown }>`
          select to_jsonb(x) as row from ${sql.table(table)} x
          where x.branch_id = any(${[...branches]}::uuid[])
          order by to_jsonb(x)::text
        `.execute(t.database.migrator)
      ).rows.map((one) => one.row);
    }
    return { rows, audit: await t.auditCount() };
  };

  const created = async (s: Scene, input: ExemptionCreate) =>
    as(s.branch, s.vice, [], async ({ post }) => {
      const made = await post('/api/exemptions', input);
      expect(made.status, JSON.stringify(made.body)).toBe(200);
      const answer = exemptionCreatedSchema.parse(made.body);
      return { id: answer.exemptions[0]?.id ?? '', batchId: answer.batchId };
    });

  /** The student moved from the scene's branch to the target's, with an offer waiting there. */
  async function offered(s: Scene, target: Scene) {
    await created(
      s,
      body({ studentIds: [s.other], startDate: '2026-10-19', endDate: '2026-11-20' }),
    );
    await adminAt(MOMENT);
    try {
      const read = await t.get(`/api/people/students/${s.other}`, s.branch, t.admin);
      const released = await t.post(
        `/api/people/students/${s.other}/branch-move`,
        s.branch,
        {
          toBranchId: target.branch,
          from: '2026-10-27',
          version: (read.body as { version: number }).version,
        },
        t.admin,
      );
      expect(released.status, JSON.stringify(released.body)).toBe(200);
      const move = await t.database.migrator
        .selectFrom('student_branch_moves')
        .select('id')
        .where('student_id', '=', s.other)
        .executeTakeFirstOrThrow();
      const accepted = await t.post(
        `/api/people/branch-moves/${move.id}/accept`,
        target.branch,
        { classId: target.otherClass, groups: [] },
        t.admin,
      );
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    } finally {
      await adminAt(START);
    }
    const offer = await t.database.migrator
      .selectFrom('exemption_move_offers')
      .select('id')
      .where('student_id', '=', s.other)
      .executeTakeFirstOrThrow();
    return offer.id;
  }

  /** Gives the lessons of a class and a subject on a date to another teacher (a substitute). */
  const giveLessons = (classId: string, subjectId: string, date: string, staffId: string) =>
    t.database.migrator
      .updateTable('lessons')
      .set({ teacher_id: staffId })
      .where('class_id', '=', classId)
      .where('subject_id', '=', subjectId)
      .where('lesson_date', '=', date)
      .execute();

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the move offers of another branch (permission review 4 and 8)', () => {
    it("answers 404 for another branch's offer on confirm, its preview and drop, changing nothing", async () => {
      const s = await scene();
      const target = await scene();
      const third = await scene();
      const offer = await offered(s, target);
      const before = await snapshot([s.branch, target.branch, third.branch]);
      await as(third.branch, third.vice, [], async ({ get, post }) => {
        expect(
          (await post(`/api/exemptions/move-offers/${offer}/confirm`, { choices: [] })).status,
        ).toBe(404);
        expect((await post(`/api/exemptions/move-offers/${offer}/confirm/preview`)).status).toBe(
          404,
        );
        expect((await post(`/api/exemptions/move-offers/${offer}/drop`)).status).toBe(404);
        expect((await get(`/api/exemptions/move-offers/${offer}/reason`)).status).toBe(404);
        const listed = (await get('/api/exemptions/move-offers')).body as { items: unknown[] };
        expect(listed.items).toEqual([]);
      });
      expect(await snapshot([s.branch, target.branch, third.branch])).toEqual(before);
    });

    it('answers 404 for a confirm of a student the branch no longer reads, writing nothing', async () => {
      const s = await scene();
      const target = await scene();
      const third = await scene();
      const offer = await offered(s, target);
      await adminAt(MOMENT);
      try {
        const read = await t.get(`/api/people/students/${s.other}`, target.branch, t.admin);
        expect(read.status, JSON.stringify(read.body)).toBe(200);
        const released = await t.post(
          `/api/people/students/${s.other}/branch-move`,
          target.branch,
          {
            toBranchId: third.branch,
            from: '2026-11-02',
            version: (read.body as { version: number }).version,
          },
          t.admin,
        );
        expect(released.status, JSON.stringify(released.body)).toBe(200);
        const move = await t.database.migrator
          .selectFrom('student_branch_moves')
          .select('id')
          .where('student_id', '=', s.other)
          .where('from_branch_id', '=', target.branch)
          .executeTakeFirstOrThrow();
        // The release is accepted from its date on.
        await adminAt('2026-11-02T09:00:00+05:00');
        const accepted = await t.post(
          `/api/people/branch-moves/${move.id}/accept`,
          third.branch,
          { classId: third.otherClass, groups: [] },
          t.admin,
        );
        expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
      } finally {
        await adminAt(START);
      }
      const before = await snapshot([target.branch, third.branch]);
      await as(target.branch, target.vice, [], async ({ post }) => {
        expect(
          (await post(`/api/exemptions/move-offers/${offer}/confirm`, { choices: [] })).status,
        ).toBe(404);
        expect((await post(`/api/exemptions/move-offers/${offer}/confirm/preview`)).status).toBe(
          404,
        );
      });
      expect(await snapshot([target.branch, third.branch])).toEqual(before);
    });
  });

  describe('a repeat of a used request key (permission review 5)', () => {
    it("answers 404 for another branch's student and an unknown one, and 403 from a refused role, never the stored answer", async () => {
      const s = await scene();
      const elsewhere = await scene();
      const key = randomUUID();
      const first = await as(s.branch, s.vice, [], ({ post }) =>
        post('/api/exemptions', body({ studentIds: [s.other] }), key),
      );
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const principal = await account();
      await t.kit.giveRole(principal.account.id, {
        role: 'principal',
        branchId: s.branch,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
      const before = await snapshot([s.branch, elsewhere.branch]);
      await as(s.branch, s.vice, [], async ({ post }) => {
        for (const studentId of [elsewhere.other, UNKNOWN]) {
          const again = await post('/api/exemptions', body({ studentIds: [studentId] }), key);
          expect(again.status, JSON.stringify(again.body)).toBe(404);
        }
      });
      const refused = await as(s.branch, principal, [], ({ post }) =>
        post('/api/exemptions', body({ studentIds: [s.other] }), key),
      );
      expect(refused.status).toBe(403);
      expect(await snapshot([s.branch, elsewhere.branch])).toEqual(before);
    });
  });

  describe("another branch's exemption and batch (permission review 6)", () => {
    it('answers 404 on every route that changes one, with every row of both branches unchanged', async () => {
      const s = await scene();
      const elsewhere = await scene();
      // The other branch's exemption cleared a present mark: a void or an edit that reached it
      // would give the mark back, an end would write its row.
      const marked = lessonOn(elsewhere, '2026-10-12');
      await mark(elsewhere.branch, marked, elsewhere.ahmedov, 1);
      const { id, batchId } = await created(
        elsewhere,
        body({
          studentIds: [elsewhere.ahmedov],
          startDate: '2026-10-12',
          endDate: '2026-10-20',
          choices: [{ studentId: elsewhere.ahmedov, lessonId: marked, choice: 'exempt' }],
        }),
      );
      const before = await snapshot([s.branch, elsewhere.branch]);
      expect(before.rows.exemption_clears).toHaveLength(1);
      const edit = {
        kind: 'temporary',
        subjectIds: null,
        startDate: '2026-10-19',
        endDate: '2026-10-20',
        slots: null,
        category: 'illness',
        detail: 'x',
        version: 1,
        choices: [],
      };
      const end = { version: 1, endDate: '2026-10-12', choices: [] };
      await as(s.branch, s.vice, [], async ({ post, patch }) => {
        for (const one of [id, UNKNOWN]) {
          expect((await patch(`/api/exemptions/${one}`, edit)).status).toBe(404);
          expect((await post(`/api/exemptions/${one}/edit/preview`, edit)).status).toBe(404);
          expect((await post(`/api/exemptions/${one}/end`, end)).status).toBe(404);
          expect((await post(`/api/exemptions/${one}/end/preview`, end)).status).toBe(404);
          expect(
            (await post(`/api/exemptions/${one}/void`, { version: 1, reason: 'Wrong student' }))
              .status,
          ).toBe(404);
          expect((await post(`/api/exemptions/${one}/void/preview`, { version: 1 })).status).toBe(
            404,
          );
        }
        for (const one of [batchId, UNKNOWN]) {
          const batchEnd = { endDate: '2026-10-12', choices: [] };
          expect((await post(`/api/exemptions/batches/${one}/end`, batchEnd)).status).toBe(404);
          expect((await post(`/api/exemptions/batches/${one}/end/preview`, batchEnd)).status).toBe(
            404,
          );
          expect(
            (await post(`/api/exemptions/batches/${one}/void`, { reason: 'Wrong students' }))
              .status,
          ).toBe(404);
          expect((await post(`/api/exemptions/batches/${one}/void/preview`)).status).toBe(404);
        }
      });
      expect(await snapshot([s.branch, elsewhere.branch])).toEqual(before);
    });
  });

  describe('a choice naming a lesson (permission review 9)', () => {
    it("answers 404 for another branch's lesson and an unknown one on create, edit, end and confirm", async () => {
      const s = await scene();
      const elsewhere = await scene();
      const target = await scene();
      const foreign = lessonOn(elsewhere, '2026-10-12');
      const { id } = await created(s, body({ studentIds: [s.boboyev] }));
      const offer = await offered(s, target);
      const before = await snapshot([s.branch, elsewhere.branch, target.branch]);
      for (const lessonId of [foreign, UNKNOWN]) {
        await as(s.branch, s.vice, [], async ({ post, patch }) => {
          const choices = [{ studentId: s.ahmedov, lessonId, choice: 'exempt' as const }];
          expect(
            (await post('/api/exemptions', body({ studentIds: [s.ahmedov], choices }))).status,
          ).toBe(404);
          const edited = await patch(`/api/exemptions/${id}`, {
            kind: 'temporary',
            subjectIds: null,
            startDate: '2026-11-16',
            endDate: '2026-11-17',
            slots: null,
            category: 'illness',
            detail: 'x',
            version: 1,
            choices: [{ studentId: s.boboyev, lessonId, choice: 'exempt' }],
          });
          expect(edited.status, JSON.stringify(edited.body)).toBe(404);
          const ended = await post(`/api/exemptions/${id}/end`, {
            version: 1,
            endDate: '2026-11-17',
            choices: [{ studentId: s.boboyev, lessonId, choice: 'keep' }],
          });
          expect(ended.status, JSON.stringify(ended.body)).toBe(404);
        });
        await as(target.branch, target.vice, [], async ({ post }) => {
          const confirmed = await post(`/api/exemptions/move-offers/${offer}/confirm`, {
            choices: [{ studentId: s.other, lessonId, choice: 'keep' }],
          });
          expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(404);
        });
      }
      expect(await snapshot([s.branch, elsewhere.branch, target.branch])).toEqual(before);
    });
  });

  describe('the teaching home of a Teacher (permission review 10 and 11)', () => {
    const cardsOf = (branch: string, browser: Browser, roles: readonly Omit<Held, 'validFrom'>[]) =>
      as(
        branch,
        browser,
        roles,
        async ({ get }) => {
          const answer = await get('/api/journal/exemptions-today');
          expect(answer.status, JSON.stringify(answer.body)).toBe(200);
          return exemptionsTodaySchema.parse(answer.body);
        },
        MONDAY_AFTER,
      );
    const ids = (cards: { backToday: { student: { id: string } }[] }) =>
      cards.backToday.map((one) => one.student.id).sort();

    it("shows 'back' for the students of the teacher's own lessons today, of their subject only", async () => {
      const s = await scene();
      const elsewhere = await scene();
      const second = s.secondSubject ?? '';
      // All subjects, ended on Sunday: back for the maths of the class.
      await created(
        s,
        body({ studentIds: [s.ahmedov], startDate: '2026-10-26', endDate: '2026-11-08' }),
      );
      // The second subject only: not the maths teacher's, the second subject's teacher's.
      for (const studentId of [s.boboyev, s.other]) {
        await created(
          s,
          body({
            studentIds: [studentId],
            subjectIds: [second],
            startDate: '2026-10-26',
            endDate: '2026-11-08',
          }),
        );
      }
      // Exempt today, which a Teacher is not shown.
      await created(
        s,
        body({ studentIds: [s.boboyev], startDate: '2026-11-09', endDate: '2026-11-11' }),
      );
      const teacher = [{ role: 'teacher' as const, branchId: s.branch }];
      // The owner teaches the class's maths and the other class's second subject today.
      const own = await cardsOf(s.branch, s.owner, teacher);
      expect(ids(own)).toEqual([s.ahmedov, s.other].sort());
      expect(own.exemptToday).toEqual([]);
      expect(own.backToday.map((one) => one.category)).toEqual([null, null]);
      // A colleague (the spare teacher) holding the other class's maths today sees nobody: that
      // class's exemption is of the second subject, and the class's students are not there.
      await giveLessons(s.otherClass, s.subject, '2026-11-09', s.spareTeacher.staffId);
      expect(ids(await cardsOf(s.branch, s.spare, teacher))).toEqual([]);
      // As a substitute of the class's maths, the class's student goes with the lesson.
      await giveLessons(s.otherClass, s.subject, '2026-11-09', s.otherTeacher.staffId);
      await giveLessons(s.classId, s.subject, '2026-11-09', s.spareTeacher.staffId);
      expect(ids(await cardsOf(s.branch, s.spare, []))).toEqual([s.ahmedov]);
      expect(ids(await cardsOf(s.branch, s.owner, []))).toEqual([s.other]);
      // A cancelled lesson does not count.
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'reason', cancel_reason: 'The teacher is at a seminar' })
        .where('class_id', '=', s.otherClass)
        .where('subject_id', '=', second)
        .where('lesson_date', '=', '2026-11-09')
        .execute();
      expect(ids(await cardsOf(s.branch, s.owner, []))).toEqual([]);
      // Another branch's request: nothing of this one.
      await giveLessons(s.classId, s.subject, '2026-11-09', s.teacher.staffId);
      expect(ids(await cardsOf(s.branch, s.owner, []))).toEqual([s.ahmedov]);
      const there = await cardsOf(elsewhere.branch, s.owner, [
        { role: 'teacher', branchId: elsewhere.branch },
      ]);
      expect(there.backToday).toEqual([]);
      expect(there.exemptToday).toEqual([]);
    });
  });

  describe('the notices of a grant (permission review 11; edge/exemptions, row 11)', () => {
    const toldTo = async (accountId: string) =>
      t.database.migrator
        .selectFrom('notifications')
        .select('kind')
        .where('account_id', '=', accountId)
        .where('kind', '=', 'journal.exemption_granted')
        .execute();

    it("tells the teachers of the lessons the exemption meets, by subject and by the slots' time", async () => {
      const s = await scene();
      // The other class on Mondays: maths at 08:00 (the spare teacher, as a colleague), the
      // second subject at 09:50 (the owner).
      for (const date of ['2026-11-09', '2026-11-16']) {
        await giveLessons(s.otherClass, s.subject, date, s.spareTeacher.staffId);
      }
      await created(
        s,
        body({
          studentIds: [s.other],
          subjectIds: [s.secondSubject ?? ''],
          startDate: '2026-11-09',
          endDate: '2026-11-10',
        }),
      );
      expect(await toldTo(s.owner.account.id)).toHaveLength(1);
      expect(await toldTo(s.spare.account.id)).toHaveLength(0);
      // Slots 09:00 to 11:00 of Monday 16 November: only the 09:50 lesson.
      const sobirova = await student(s.branch, s.otherClass, 'Sobirova');
      await created(
        s,
        body({
          studentIds: [sobirova],
          startDate: '2026-11-16',
          endDate: '2026-11-16',
          slots: { start: '09:00', end: '11:00' },
        }),
      );
      expect(await toldTo(s.owner.account.id)).toHaveLength(2);
      expect(await toldTo(s.spare.account.id)).toHaveLength(0);
      // The whole day meets both.
      const sodiqova = await student(s.branch, s.otherClass, 'Sodiqova');
      await created(
        s,
        body({ studentIds: [sodiqova], startDate: '2026-11-16', endDate: '2026-11-16' }),
      );
      expect(await toldTo(s.owner.account.id)).toHaveLength(3);
      expect(await toldTo(s.spare.account.id)).toHaveLength(1);
    });
  });
});
