import {
  REQUEST_KEY_HEADER,
  apiErrorSchema,
  portalAttendanceWeekSchema,
  portalChildrenSchema,
  portalHomeworkWeekSchema,
  portalWeekSchema,
  type PortalHomeworkWeek,
  type PortalWeek,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BRANCH_SETTING, MOMENT_SETTING, type Transaction } from '../../database/transactions.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { ParentsKit } from '../../testing/parents-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { cookieOf, signInKit } from '../../testing/sign-in-kit.js';
import { standingExamOver } from '../../testing/exams-kit.js';
import { MemoryPhotoStore, planFileKey } from '../people/photo-store.js';

const store = new MemoryPhotoStore();

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): string =>
  apiErrorSchema.safeParse(response.body).data?.error.code ?? `status ${String(response.status)}`;

// All names are invented. Task 11.2, pull request #294: the parent portal (`10`, What parents
// see; build plan, Release 2: "Privacy is the critical rule of every task here").
describe('the parent portal', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let parents: ParentsKit;

  /** A GET as a parent at the moment, its session kept fresh (the idle limit). */
  async function get(
    parent: { cookie: string; accountId: string },
    path: string,
    moment = MOMENT,
  ): Promise<Response> {
    t.clock.set(moment);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
        .where('account_id', '=', parent.accountId)
        .execute();
      return await request(t.kit.server).get(path).set('Cookie', parent.cookie);
    } finally {
      t.clock.set(START);
    }
  }

  const ok = (response: Response): unknown => {
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body;
  };

  /** The scene of one branch: a graded subject on Mondays, slot 1, for two classes. */
  interface Branch extends PublishedScene {
    readonly lessons: readonly { id: string; date: string }[];
    readonly otherLessons: readonly { id: string; date: string }[];
    readonly journal: string;
    readonly otherJournal: string;
    readonly q1: string;
  }

  async function branchScene(): Promise<Branch> {
    const s = await publishedScene(t, load, { graded: true });
    const lessonsOf = (classId: string) =>
      t.database.migrator
        .selectFrom('lessons')
        .select(['id', sql<string>`lesson_date::text`.as('date')])
        .where('class_id', '=', classId)
        .where('lesson_date', '>=', '2026-10-12')
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
    const q1 = await t.database.migrator
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', s.year)
      .where('number', '=', 1)
      .executeTakeFirstOrThrow();
    return {
      ...s,
      lessons: (await lessonsOf(s.classId)).map((one) => ({ id: one.id, date: String(one.date) })),
      otherLessons: (await lessonsOf(s.otherClass)).map((one) => ({
        id: one.id,
        date: String(one.date),
      })),
      journal: await journalOf(s.classId),
      otherJournal: await journalOf(s.otherClass),
      q1: q1.id,
    };
  }

  async function member(branch: string, classId: string, studentId: string): Promise<void> {
    await parents.members.member({ branch, classId, studentId, from: '2026-09-01' });
  }

  /** A plan item of quarter 1 at the row of a lesson (its place among the quarter's lessons). */
  async function itemAt(
    s: Branch,
    journal: string,
    classId: string,
    lessonId: string,
    input: { topic: string; homeworks: string[]; quarter?: number },
  ): Promise<{ itemId: string; homeworks: string[] }> {
    const quarter = await t.database.migrator
      .selectFrom('quarters')
      .select([
        'id',
        sql<string>`start_date::text`.as('start'),
        sql<string>`end_date::text`.as('end'),
      ])
      .where('academic_year_id', '=', s.year)
      .where('number', '=', input.quarter ?? 1)
      .executeTakeFirstOrThrow();
    const plan = await t.database.migrator
      .selectFrom('lesson_plan_journals')
      .select('plan_id')
      .where('journal_id', '=', journal)
      .where('quarter_id', '=', quarter.id)
      .executeTakeFirstOrThrow();
    const rows = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', classId)
        .where('lesson_date', '>=', quarter.start)
        .where('lesson_date', '<=', quarter.end)
        .where('cancel_cause', 'is', null)
        .orderBy('starts_at')
        .execute()
    ).map((row) => row.id);
    const item = await t.database.migrator
      .insertInto('lesson_plan_items')
      .values({ branch_id: s.branch, plan_id: plan.plan_id, topic: input.topic })
      .returning('id')
      .executeTakeFirstOrThrow();
    const homeworks: string[] = [];
    for (const [index, title] of input.homeworks.entries()) {
      const work = await t.database.migrator
        .insertInto('lesson_plan_works')
        .values({
          branch_id: s.branch,
          item_id: item.id,
          kind: 'homework',
          position: index + 1,
          title,
          description: `About ${title}`,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      homeworks.push(work.id);
    }
    await t.database.migrator
      .insertInto('lesson_plan_places')
      .values({
        branch_id: s.branch,
        plan_id: plan.plan_id,
        journal_id: journal,
        item_id: item.id,
        position: rows.indexOf(lessonId) + 1,
      })
      .execute();
    return { itemId: item.id, homeworks };
  }

  async function fileOf(s: Branch, itemId: string, name: string): Promise<string> {
    const row = await t.database.migrator
      .insertInto('lesson_plan_files')
      .values({ branch_id: s.branch, item_id: itemId, name, type: 'application/pdf', bytes: 9 })
      .returning('id')
      .executeTakeFirstOrThrow();
    await store.put(planFileKey(itemId, row.id), Buffer.from('%PDF-1.4\n'), 'application/pdf');
    return row.id;
  }

  // The family: one relative with two children in two branches (`edge/close-relatives`: "A
  // father has a daughter in one branch and a son in another"), and every case of the
  // section's privacy list. The parent keeps a child with an open link throughout (review
  // must-fix 4), so a refusal below comes from the child scope, not from the session.
  let a: Branch;
  let b: Branch;
  let relative: string;
  let parent: { cookie: string; accountId: string };
  let child: string;
  let secondChild: string;
  let otherFamily: string;
  let linkOff: string;
  let unlinked: string;
  let left: string;
  let notLinked: string;
  let item: { itemId: string; homeworks: string[] };
  let file: string;
  let otherClassFile: string;
  let futureFile: string;

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true, photoStore: store });
    load = new LoadKit(t.database.migrator);
    parents = new ParentsKit(t.app, t.database.migrator, await load.classes.account());
    a = await branchScene();
    b = await branchScene();
    const first = await parents.student(a.branch);
    child = first.studentId;
    relative = first.relativeId;
    await member(a.branch, a.classId, child);
    secondChild = await parents.childOf(b.branch, relative);
    await member(b.branch, b.classId, secondChild);
    otherFamily = (await parents.student(a.branch)).studentId;
    await member(a.branch, a.classId, otherFamily);
    linkOff = await parents.childOf(a.branch, relative);
    await member(a.branch, a.otherClass, linkOff);
    await t.database.migrator
      .updateTable('student_relatives')
      .set({ portal_access: false })
      .where('student_id', '=', linkOff)
      .where('relative_id', '=', relative)
      .execute();
    // A child the relative was linked to and then unlinked from (its own main contact stays).
    unlinked = (await parents.student(a.branch)).studentId;
    await member(a.branch, a.otherClass, unlinked);
    await t.database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config(${MOMENT_SETTING}, ${'2026-10-01T04:00:00.000Z'}, true)`.execute(
        transaction,
      );
      await transaction
        .insertInto('student_relatives')
        .values({
          student_id: unlinked,
          branch_id: a.branch,
          relative_id: relative,
          relationship: 'father',
          main_contact: false,
          linked_at: new Date('2026-08-20T09:00:00+05:00'),
        })
        .execute();
      await transaction
        .updateTable('student_relatives')
        .set({ unlinked_at: new Date('2026-10-01T09:00:00+05:00') })
        .where('student_id', '=', unlinked)
        .where('relative_id', '=', relative)
        .execute();
    });
    left = await parents.childOf(a.branch, relative);
    const leaving = await parents.members.leaving(
      t.database.migrator,
      a.branch,
      left,
      '2026-10-20',
    );
    await parents.members.member({
      branch: a.branch,
      classId: a.otherClass,
      studentId: left,
      from: '2026-09-01',
      until: '2026-10-20',
      endedBy: 'leaving',
      leavingId: leaving,
    });
    notLinked = (await parents.student(b.branch)).studentId;
    await member(b.branch, b.classId, notLinked);
    const session = await parents.session(relative);
    parent = { cookie: session.cookie, accountId: session.account.id };

    // Homework: an item at the held lesson of 26 October with two homeworks and a file; an
    // item at the lesson of 2 November, not held at the moment; one of the other class.
    const held = a.lessons.find((one) => one.date === '2026-10-26');
    const future = a.lessons.find((one) => one.date === '2026-11-09');
    const otherHeld = a.otherLessons.find((one) => one.date === '2026-10-26');
    if (held === undefined || future === undefined || otherHeld === undefined) {
      throw new Error('The scene has the Mondays of October and November.');
    }
    item = await itemAt(a, a.journal, a.classId, held.id, {
      topic: 'Fractions',
      homeworks: ['Exercise 5', 'Exercise 6'],
    });
    file = await fileOf(a, item.itemId, 'fractions.pdf');
    const futureItem = await itemAt(a, a.journal, a.classId, future.id, {
      topic: 'Decimals',
      homeworks: ['Exercise 9'],
      quarter: 2,
    });
    futureFile = await fileOf(a, futureItem.itemId, 'decimals.pdf');
    const otherItem = await itemAt(a, a.otherJournal, a.otherClass, otherHeld.id, {
      topic: 'Poems',
      homeworks: ['Learn a poem'],
    });
    otherClassFile = await fileOf(a, otherItem.itemId, 'poems.pdf');
  }, 600_000);

  afterAll(async () => {
    await t.close();
  });

  const weekOf = async (studentId: string, date = '2026-10-26'): Promise<PortalWeek> =>
    portalWeekSchema.parse(
      ok(await get(parent, `/api/portal/children/${studentId}/timetable?date=${date}`)),
    );

  const homeworkOf = async (studentId: string, date = '2026-10-26'): Promise<PortalHomeworkWeek> =>
    portalHomeworkWeekSchema.parse(
      ok(await get(parent, `/api/portal/children/${studentId}/homework?date=${date}`)),
    );

  describe('the child switcher', () => {
    it('lists each linked child with portal access on, active, in any branch, and no other', async () => {
      const answer = portalChildrenSchema.parse(ok(await get(parent, '/api/portal/children')));
      const ids = answer.children.map((one) => one.id);
      expect(ids.sort()).toEqual([child, secondChild].sort());
      // Another family's child, a link off, an unlinked one, a student who left and a child
      // of another branch not linked to the parent are each absent (should-fix 3).
      for (const absent of [otherFamily, linkOff, unlinked, left, notLinked]) {
        expect(ids).not.toContain(absent);
      }
      // Names and the class only: no branch, no UID.
      expect(Object.keys(answer.children[0] ?? {}).sort()).toEqual([
        'className',
        'firstName',
        'id',
        'lastName',
      ]);
      expect(answer.children.find((one) => one.id === child)?.className).toMatch(/^7 /);
    });
  });

  describe('every route of a child refuses a child out of scope with 404', () => {
    const routes = (studentId: string) => [
      `/api/portal/children/${studentId}/timetable?date=2026-10-26`,
      `/api/portal/children/${studentId}/homework?date=2026-10-26`,
      `/api/portal/children/${studentId}/files/${file}`,
      // Task 11.3.
      `/api/portal/children/${studentId}/grades`,
      `/api/portal/children/${studentId}/attendance?date=2026-10-26`,
    ];

    it('answers the parent’s own children, in both branches', async () => {
      for (const path of [...routes(child)]) {
        expect((await get(parent, path)).status, path).toBe(200);
      }
      for (const path of routes(secondChild).filter((one) => !one.includes('/files/'))) {
        expect((await get(parent, path)).status, path).toBe(200);
      }
    });

    it.each([
      ['another family’s child, asked for by its id', () => otherFamily],
      ['a link with portal access off', () => linkOff],
      ['an unlinked relative', () => unlinked],
      ['a student who left', () => left],
      ['a child of another branch not linked to the parent', () => notLinked],
      ['an unknown id', () => randomUUID()],
    ])('%s', async (_name, id) => {
      for (const path of routes(id())) {
        const response = await get(parent, path);
        expect([response.status, codeOf(response)], path).toEqual([404, 'not_found']);
        // Nothing of the child is in the answer.
        expect(JSON.stringify(response.body)).not.toContain('Malika');
      }
    });

    it('refuses the next request once portal access is switched off, and answers again when on', async () => {
      const path = `/api/portal/children/${child}/timetable?date=2026-10-26`;
      expect((await get(parent, path)).status).toBe(200);
      const switchTo = (portalAccess: boolean) =>
        t.database.migrator
          .updateTable('student_relatives')
          .set({ portal_access: portalAccess })
          .where('student_id', '=', child)
          .where('relative_id', '=', relative)
          .execute();
      await switchTo(false);
      try {
        const refused = await get(parent, path);
        expect([refused.status, codeOf(refused)]).toEqual([404, 'not_found']);
        const list = portalChildrenSchema.parse(ok(await get(parent, '/api/portal/children')));
        expect(list.children.map((one) => one.id)).toEqual([secondChild]);
      } finally {
        await switchTo(true);
      }
      expect((await get(parent, path)).status).toBe(200);
    });

    it('ends the session of a parent whose only child leaves the school (401)', async () => {
      const own = await parents.student(a.branch);
      // The class row ends with the last school day, as a leaving leaves it.
      await parents.members.member({
        branch: a.branch,
        classId: a.otherClass,
        studentId: own.studentId,
        from: '2026-09-01',
        until: '2026-10-27',
        ownUntil: '2026-10-27',
      });
      const single = await parents.session(own.relativeId);
      const caller = { cookie: single.cookie, accountId: single.account.id };
      const path = `/api/portal/children/${own.studentId}/timetable?date=2026-10-26`;
      expect((await get(caller, path)).status).toBe(200);
      // Inactive from 27 October, the date of the moment.
      await parents.members.leaving(t.database.migrator, a.branch, own.studentId, '2026-10-27');
      const refused = await get(caller, path);
      expect([refused.status, codeOf(refused)]).toEqual([401, 'not_signed_in']);
    });

    it('ends the session of a parent whose only link is unlinked (401)', async () => {
      const own = await parents.student(a.branch);
      await member(a.branch, a.otherClass, own.studentId);
      const father = await parents.relativeOf(a.branch, own.studentId);
      const single = await parents.session(father);
      const caller = { cookie: single.cookie, accountId: single.account.id };
      const path = `/api/portal/children/${own.studentId}/homework?date=2026-10-26`;
      expect((await get(caller, path)).status).toBe(200);
      await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`select set_config(${MOMENT_SETTING}, ${'2026-10-27T04:00:00.000Z'}, true)`.execute(
          transaction,
        );
        await transaction
          .updateTable('student_relatives')
          .set({ unlinked_at: new Date('2026-10-27T09:00:00+05:00') })
          .where('relative_id', '=', father)
          .execute();
      });
      const refused = await get(caller, path);
      expect([refused.status, codeOf(refused)]).toEqual([401, 'not_signed_in']);
    });

    it('ends the session of a parent whose only child goes out of scope (401)', async () => {
      const own = await parents.student(a.branch);
      await member(a.branch, a.otherClass, own.studentId);
      const single = await parents.session(own.relativeId);
      const caller = { cookie: single.cookie, accountId: single.account.id };
      const path = `/api/portal/children/${own.studentId}/timetable?date=2026-10-26`;
      expect((await get(caller, path)).status).toBe(200);
      await t.database.migrator
        .updateTable('student_relatives')
        .set({ portal_access: false })
        .where('student_id', '=', own.studentId)
        .where('relative_id', '=', own.relativeId)
        .execute();
      const refused = await get(caller, path);
      expect([refused.status, codeOf(refused)]).toEqual([401, 'not_signed_in']);
    });

    it('refuses a parent who still owes the first-password change', async () => {
      const own = await parents.student(a.branch);
      await member(a.branch, a.otherClass, own.studentId);
      const account = await parents.account(own.relativeId);
      const signed = await signInKit(t.app).signIn(account.login, account.firstPassword);
      const cookie = cookieOf(signed);
      expect(cookie).toBeDefined();
      const caller = { cookie: cookie ?? '', accountId: account.id };
      for (const path of ['/api/portal/children', ...routes(own.studentId)]) {
        const response = await get(caller, path);
        expect([response.status, codeOf(response)], path).toEqual([
          403,
          'password_change_required',
        ]);
      }
    });

    it('refuses a staff session on every portal route, the Super Admin’s too', async () => {
      // The kit's Super Admin, signed in at the clock's start.
      for (const path of ['/api/portal/children', ...routes(child)]) {
        const response = await t.get(path, a.branch);
        expect([response.status, codeOf(response)], path).toEqual([403, 'permission_denied']);
      }
    });
  });

  describe('the timetable page', () => {
    it('shows each child’s week in its own branch, in a shape for families', async () => {
      const week = await weekOf(child);
      expect(week.monday).toBe('2026-10-26');
      expect(week.lessons.map((one) => [one.date, one.state, one.subject.id])).toEqual([
        ['2026-10-26', 'held', a.subject],
      ]);
      const [lesson] = week.lessons;
      expect(lesson?.teacher).toEqual(expect.any(String));
      expect(lesson?.room).toEqual(expect.any(String));
      expect(lesson?.lessonNumber).toBe(1);
      // The other class's lesson in the same slot is not the child's.
      expect(week.lessons).toHaveLength(1);
      const second = await weekOf(secondChild);
      expect(second.lessons.map((one) => [one.date, one.subject.id])).toEqual([
        ['2026-10-26', b.subject],
      ]);
    });

    it('marks a lesson changed within a week, and not after', async () => {
      const next = a.lessons.find((one) => one.date === '2026-11-09');
      if (next === undefined) throw new Error('The scene has 9 November.');
      await t.database.migrator
        .insertInto('lesson_changes')
        .values({
          branch_id: a.branch,
          lesson_id: next.id,
          changed_at: new Date('2026-10-26T10:00:00+05:00'),
        })
        .execute();
      try {
        const marked = await weekOf(child, '2026-11-09');
        expect(marked.lessons.map((one) => one.changed)).toEqual([true]);
        const later = portalWeekSchema.parse(
          ok(
            await get(
              parent,
              `/api/portal/children/${child}/timetable?date=2026-11-09`,
              '2026-11-03T12:00:00+05:00',
            ),
          ),
        );
        expect(later.lessons.map((one) => one.changed)).toEqual([false]);
      } finally {
        await t.database.migrator
          .deleteFrom('lesson_changes')
          .where('lesson_id', '=', next.id)
          .execute();
      }
    });

    it('shows a group lesson only to a member of the group, and a cancel without its reason', async () => {
      const date = '2026-10-19';
      const group = await load.classes.group(b.branch, b.year, b.subject, [
        b.classId,
        b.otherClass,
      ]);
      const own = b.lessons.find((one) => one.date === date);
      const other = b.otherLessons.find((one) => one.date === date);
      if (own === undefined || other === undefined) throw new Error('The scene has 19 October.');
      // The class's own lesson cancelled with a typed reason, so the group's can claim the class.
      const cancelled = await t
        .post(`/api/timetable/lessons/${own.id}/cancel`, b.branch, { reason: 'Teacher ill' })
        .set(REQUEST_KEY_HEADER, randomUUID());
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      await t.database.migrator
        .updateTable('lessons')
        .set({ class_id: null, group_id: group })
        .where('id', '=', other.id)
        .execute();
      const before = await weekOf(secondChild, date);
      expect(before.lessons.map((one) => [one.state, one.exam])).toEqual([['cancelled', false]]);
      expect(JSON.stringify(before)).not.toContain('Teacher ill');
      await parents.members.groupMember({
        branch: b.branch,
        groupId: group,
        subjectId: b.subject,
        studentId: secondChild,
        from: '2026-09-01',
      });
      const after = await weekOf(secondChild, date);
      // Held: the lesson of 19 October has started at the moment of the request.
      expect(after.lessons.map((one) => one.state).sort()).toEqual(['cancelled', 'held']);
      expect(after.lessons).toHaveLength(2);
    });

    it('shows the exam the child sits, with its room and no invigilator, and the lesson as an exam', async () => {
      const date = '2026-10-12';
      // In the second branch: a cancel in the first would move the rows of its plan.
      const lesson = b.lessons.find((one) => one.date === date);
      if (lesson === undefined) throw new Error('The scene has 12 October.');
      await standingExamOver(t.database.migrator, {
        lessonId: lesson.id,
        roomId: b.room,
        staffId: b.teacher.staffId,
      });
      const week = await weekOf(secondChild, date);
      expect(week.lessons.map((one) => [one.state, one.exam])).toEqual([['cancelled', true]]);
      expect(week.exams).toEqual([
        expect.objectContaining({
          date,
          title: 'Quarter exam',
          room: expect.any(String) as unknown,
        }),
      ]);
      // The child of the other branch, the same date: no exam.
      expect((await weekOf(child, date)).exams).toEqual([]);
    });

    it('shows a child placed mid-week from that date only', async () => {
      const late = await parents.childOf(a.branch, relative);
      await parents.members.member({
        branch: a.branch,
        classId: a.otherClass,
        studentId: late,
        from: '2026-10-28',
      });
      const first = await weekOf(late, '2026-10-26');
      // Monday 26 October came before the class: no lesson, and no class that day.
      expect(first.lessons).toEqual([]);
      expect(first.days.find((one) => one.date === '2026-10-26')?.outsideYear).toBe(true);
      expect(first.days.find((one) => one.date === '2026-10-28')?.outsideYear).toBe(false);
      const next = await weekOf(late, '2026-11-09');
      expect(next.lessons.map((one) => one.date)).toEqual(['2026-11-09']);
    });

    it('names a day off of the child’s grade only', async () => {
      await t.database.migrator
        .insertInto('calendar_entries')
        .values({
          branch_id: b.branch,
          kind: 'day_off',
          name: 'Grade 7 trip',
          first_date: '2026-10-22',
          last_date: '2026-10-22',
          grade_from: 7,
          grade_to: 7,
        })
        .execute();
      const week = await weekOf(secondChild, '2026-10-19');
      expect(week.days.find((one) => one.date === '2026-10-22')?.dayOff).toBe('Grade 7 trip');
      expect(week.days.find((one) => one.date === '2026-10-21')?.dayOff).toBeNull();
    });

    it('shows a lesson of a vacancy as "to be named", never the vacancy’s label', async () => {
      const lesson = a.lessons.find((one) => one.date === '2026-11-16');
      if (lesson === undefined) throw new Error('The scene has 16 November.');
      const vacancy = await load.vacancy(a.branch);
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: vacancy })
        .where('id', '=', lesson.id)
        .execute();
      const week = await weekOf(child, '2026-11-16');
      expect(week.lessons.map((one) => one.teacher)).toEqual([null]);
      expect(JSON.stringify(week)).not.toContain('Teacher wanted');
    });

    it('answers a summer week with its days outside the year, never 422', async () => {
      const week = await weekOf(child, '2027-07-05');
      expect(week.lessons).toEqual([]);
      expect(week.days.length).toBeGreaterThan(0);
      expect(week.days.every((one) => one.outsideYear)).toBe(true);
    });
  });

  describe('the homework page', () => {
    it('lists the homework given at a held lesson with its title, text, topic, due date and files', async () => {
      const week = await homeworkOf(child);
      expect(week.homework).toEqual([
        {
          givenOn: '2026-10-26',
          subject: expect.objectContaining({ id: a.subject }) as unknown,
          topic: 'Fractions',
          title: 'Exercise 5',
          number: 1,
          description: 'About Exercise 5',
          dueOn: '2026-11-09',
          files: [{ id: file, name: 'fractions.pdf', type: 'application/pdf', bytes: 9 }],
        },
        expect.objectContaining({ title: 'Exercise 6', number: 2, topic: 'Fractions' }) as unknown,
      ]);
    });

    it('lists no homework, and no topic, of a lesson not yet held', async () => {
      const week = await homeworkOf(child, '2026-11-09');
      expect(week.homework).toEqual([]);
      const text = JSON.stringify(week) + JSON.stringify(await weekOf(child, '2026-11-09'));
      expect(text).not.toContain('Decimals');
      expect(text).not.toContain('Exercise 9');
    });

    it('leaves out a homework marked "not given"', async () => {
      const held = a.lessons.find((one) => one.date === '2026-10-26');
      const [, second] = item.homeworks;
      if (held === undefined || second === undefined) throw new Error('The item has two.');
      const mark = await t.database.migrator
        .insertInto('journal_homework_not_given')
        .values({
          branch_id: a.branch,
          journal_id: a.journal,
          lesson_id: held.id,
          plan_work_id: second,
          changed_by: await load.classes.account(),
          changed_how: 'entry',
          set_at: new Date('2026-10-26T12:00:00+05:00'),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      try {
        const week = await homeworkOf(child);
        expect(week.homework.map((one) => one.title)).toEqual(['Exercise 5']);
      } finally {
        await t.database.migrator
          .deleteFrom('journal_homework_not_given')
          .where('id', '=', mark.id)
          .execute();
      }
    });

    it('shows a homework added by hand with the title typed for it (10.6)', async () => {
      const given = a.lessons.find((one) => one.date === '2026-10-12');
      const checked = a.lessons.find((one) => one.date === '2026-10-19');
      if (given === undefined || checked === undefined) throw new Error('The scene has them.');
      const work = await t.database.migrator
        .insertInto('journal_works')
        .values({
          branch_id: a.branch,
          lesson_id: checked.id,
          source_lesson_id: given.id,
          kind: 'homework',
          title: 'Read chapter 3',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      try {
        const week = await homeworkOf(child, '2026-10-12');
        expect(week.homework.map((one) => [one.title, one.dueOn, one.files])).toEqual([
          ['Read chapter 3', '2026-10-19', []],
        ]);
      } finally {
        await t.database.migrator.deleteFrom('journal_works').where('id', '=', work.id).execute();
      }
    });

    it('shows a homework added by hand before 10.6 with no title, by its number', async () => {
      const given = a.lessons.find((one) => one.date === '2026-10-19');
      const checked = a.lessons.find((one) => one.date === '2026-10-26');
      if (given === undefined || checked === undefined) throw new Error('The scene has them.');
      const work = await t.database.migrator
        .insertInto('journal_works')
        .values({
          branch_id: a.branch,
          lesson_id: checked.id,
          source_lesson_id: given.id,
          kind: 'homework',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      try {
        const week = await homeworkOf(child, '2026-10-19');
        expect(week.homework.map((one) => [one.givenOn, one.title, one.number])).toEqual([
          ['2026-10-19', null, 1],
        ]);
      } finally {
        await t.database.migrator.deleteFrom('journal_works').where('id', '=', work.id).execute();
      }
    });
  });

  describe('the files of homework', () => {
    it('refuses a file once every homework of its item is marked "not given", and a removed file', async () => {
      const held = a.lessons.find((one) => one.date === '2026-10-26');
      if (held === undefined) throw new Error('The scene has 26 October.');
      const marker = await load.classes.account();
      const marks = await t.database.migrator
        .insertInto('journal_homework_not_given')
        .values(
          item.homeworks.map((work) => ({
            branch_id: a.branch,
            journal_id: a.journal,
            lesson_id: held.id,
            plan_work_id: work,
            changed_by: marker,
            changed_how: 'entry',
            set_at: new Date('2026-10-26T12:00:00+05:00'),
          })),
        )
        .returning('id')
        .execute();
      try {
        const refused = await get(parent, `/api/portal/children/${child}/files/${file}`);
        expect([refused.status, codeOf(refused)]).toEqual([404, 'not_found']);
      } finally {
        await t.database.migrator
          .deleteFrom('journal_homework_not_given')
          .where(
            'id',
            'in',
            marks.map((one) => one.id),
          )
          .execute();
      }
      const removed = await fileOf(a, item.itemId, 'old.pdf');
      await t.database.migrator
        .updateTable('lesson_plan_files')
        .set({ removed_at: new Date('2026-10-26T12:00:00+05:00') })
        .where('id', '=', removed)
        .execute();
      const gone = await get(parent, `/api/portal/children/${child}/files/${removed}`);
      expect([gone.status, codeOf(gone)]).toEqual([404, 'not_found']);
      expect(JSON.stringify((await homeworkOf(child)).homework)).not.toContain('old.pdf');
    });

    it('sends a file of a homework the page lists for the child', async () => {
      const response = await get(parent, `/api/portal/children/${child}/files/${file}`);
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/pdf');
    });

    it.each([
      ['through the parent’s child of another branch', () => secondChild, () => file],
      ['through another family’s child', () => otherFamily, () => file],
      ['of another class’s item', () => child, () => otherClassFile],
      ['of a lesson not yet held', () => child, () => futureFile],
      ['unknown', () => child, () => randomUUID()],
    ])('refuses a file %s (404)', async (_name, studentId, fileId) => {
      const response = await get(parent, `/api/portal/children/${studentId()}/files/${fileId()}`);
      expect([response.status, codeOf(response)]).toEqual([404, 'not_found']);
    });
  });

  describe('the scope function (0159)', () => {
    const scopeOf = async (accountId: string) => {
      const at = new Date(MOMENT);
      const rows = await sql<{ student_id: string }>`
        select student_id from portal_children(${accountId}::uuid, ${at})
      `.execute(t.database.migrator);
      const blocked = await sql<{ blocked: boolean }>`
        select parent_account_blocked(${accountId}::uuid, ${at}) as blocked
      `.execute(t.database.migrator);
      return { ids: rows.rows.map((row) => row.student_id), blocked: blocked.rows[0]?.blocked };
    };

    it('agrees with the sign-in block for each condition alone', async () => {
      const own = await parents.student(a.branch);
      await member(a.branch, a.otherClass, own.studentId);
      const account = await parents.account(own.relativeId);
      expect(await scopeOf(account.id)).toEqual({ ids: [own.studentId], blocked: false });
      // The relative archived: everything else lets the row in.
      await t.database.migrator
        .updateTable('relatives')
        .set({ archived_at: new Date('2026-10-20T09:00:00+05:00') })
        .where('id', '=', own.relativeId)
        .execute();
      expect(await scopeOf(account.id)).toEqual({ ids: [], blocked: true });
      await t.database.migrator
        .updateTable('relatives')
        .set({ archived_at: null })
        .where('id', '=', own.relativeId)
        .execute();
      expect(await scopeOf(account.id)).toEqual({ ids: [own.studentId], blocked: false });
      // Portal access off on the only link.
      await t.database.migrator
        .updateTable('student_relatives')
        .set({ portal_access: false })
        .where('relative_id', '=', own.relativeId)
        .execute();
      expect(await scopeOf(account.id)).toEqual({ ids: [], blocked: true });
    });

    it('agrees with the sign-in block for an unlinked relative and a student who left', async () => {
      const moment = async <T>(at: string, work: (db: Transaction) => Promise<T>) =>
        t.database.migrator.transaction().execute(async (transaction) => {
          await sql`select set_config(${MOMENT_SETTING}, ${new Date(at).toISOString()}, true)`.execute(
            transaction,
          );
          return work(transaction);
        });
      // Unlinked: the relative's link to the only child ends (another main contact is kept).
      const one = await parents.student(a.branch);
      await member(a.branch, a.otherClass, one.studentId);
      const second = await parents.relativeOf(a.branch, one.studentId);
      const secondAccount = await parents.account(second);
      expect(await scopeOf(secondAccount.id)).toEqual({ ids: [one.studentId], blocked: false });
      await moment('2026-10-20T09:00:00+05:00', (db) =>
        db
          .updateTable('student_relatives')
          .set({ unlinked_at: new Date('2026-10-20T09:00:00+05:00') })
          .where('relative_id', '=', second)
          .execute(),
      );
      expect(await scopeOf(secondAccount.id)).toEqual({ ids: [], blocked: true });
      // Left: the only child is inactive from 20 October.
      const two = await parents.student(a.branch);
      const leaving = await parents.members.leaving(
        t.database.migrator,
        a.branch,
        two.studentId,
        '2026-10-20',
      );
      await parents.members.member({
        branch: a.branch,
        classId: a.otherClass,
        studentId: two.studentId,
        from: '2026-09-01',
        until: '2026-10-20',
        endedBy: 'leaving',
        leavingId: leaving,
      });
      const twoAccount = await parents.account(two.relativeId);
      expect(await scopeOf(twoAccount.id)).toEqual({ ids: [], blocked: true });
      // A merged relative has no live link left (`relative_merged_links`): the link conditions
      // above already keep it out; `merged_into is null` is kept as 0158 has it.
    });

    it('answers the branch of each part of a week a branch move splits', async () => {
      const own = await parents.student(a.branch);
      const old = await parents.members.member({
        branch: a.branch,
        classId: a.otherClass,
        studentId: own.studentId,
        from: '2026-09-01',
      });
      // Accepted on Tuesday 27 October, effective that day (0053 accepts a move only from its
      // date on): the old branch's row runs until then, the new one's from then.
      const moment = new Date(MOMENT);
      await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`
          select set_config(${BRANCH_SETTING}, ${`{${a.branch},${b.branch}}`}, true),
            set_config(${MOMENT_SETTING}, ${moment.toISOString()}, true)
        `.execute(transaction);
        const release = await transaction
          .insertInto('student_branch_moves')
          .values({
            branch_id: a.branch,
            student_id: own.studentId,
            from_branch_id: a.branch,
            to_branch_id: b.branch,
            effective_on: '2026-10-27',
            released_at: moment,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .updateTable('student_branch_moves')
          .set({ accepted_at: moment })
          .where('id', '=', release.id)
          .execute();
        await transaction
          .updateTable('class_memberships')
          .set({
            valid_until: '2026-10-27',
            ended_by: 'branch_move',
            ended_by_branch_move_id: release.id,
          })
          .where('id', '=', old)
          .execute();
        await transaction
          .updateTable('students')
          .set({ branch_id: b.branch })
          .where('id', '=', own.studentId)
          .execute();
        await transaction
          .insertInto('class_memberships')
          .values({
            branch_id: b.branch,
            student_id: own.studentId,
            class_id: b.otherClass,
            valid_from: '2026-10-27',
            valid_until: '2027-06-01',
            own_until: '2027-06-01',
            cause: 'branch_move',
          })
          .execute();
      });
      const signed = await parents.session(own.relativeId);
      const account = signed.account;
      const spans = await sql<{ branch_id: string; valid_from: string; valid_until: string }>`
        select branch_id, valid_from::text as valid_from, valid_until::text as valid_until
        from portal_child_branches(
          ${account.id}::uuid, ${own.studentId}::uuid, '2026-10-26', '2026-11-01', ${new Date(MOMENT)}
        )
      `.execute(t.database.migrator);
      expect(spans.rows).toEqual([
        { branch_id: a.branch, valid_from: '2026-10-26', valid_until: '2026-10-27' },
        { branch_id: b.branch, valid_from: '2026-10-27', valid_until: '2026-11-02' },
      ]);
      // Another account: nothing, whatever the student.
      const stranger = await sql<{ branch_id: string }>`
        select branch_id from portal_child_branches(
          ${parent.accountId}::uuid, ${own.studentId}::uuid, '2026-10-26', '2026-11-01', ${new Date(MOMENT)}
        )
      `.execute(t.database.migrator);
      expect(stranger.rows).toEqual([]);
      // Through the route: this week shows the old branch's Monday, a later week the new one's
      // (review must-fix 1: never an empty week between the accept and the effective date).
      const caller = { cookie: signed.cookie, accountId: signed.account.id };
      const weekAt = async (date: string) =>
        portalWeekSchema.parse(
          ok(await get(caller, `/api/portal/children/${own.studentId}/timetable?date=${date}`)),
        );
      expect((await weekAt('2026-10-26')).lessons.map((one) => one.subject.id)).toEqual([
        a.subject,
      ]);
      expect((await weekAt('2026-11-09')).lessons.map((one) => one.subject.id)).toEqual([
        b.subject,
      ]);
      // Task 11.3 (plan test 6): the Attendance page reads each date in the branch of that
      // date too: the Monday before the move from the old branch, whose `students` row the
      // child no longer has; a week after it from the new branch once its lesson is held.
      const attendanceAt = async (date: string, moment?: string) =>
        portalAttendanceWeekSchema
          .parse(
            ok(
              await get(
                caller,
                `/api/portal/children/${own.studentId}/attendance?date=${date}`,
                moment,
              ),
            ),
          )
          .lessons.map((one) => [one.date, one.subject.id, one.mark]);
      expect(await attendanceAt('2026-10-26')).toEqual([['2026-10-26', a.subject, 'unmarked']]);
      expect(await attendanceAt('2026-11-09', '2026-11-10T12:00:00+05:00')).toEqual([
        ['2026-11-09', b.subject, 'unmarked'],
      ]);
    });

    it('cannot be run by any role but the application', async () => {
      const grants = await sql<{ grantee: string }>`
        select grantee::text as grantee
        from information_schema.routine_privileges
        where routine_name in ('portal_children', 'portal_child_branches')
          and grantee = 'PUBLIC'
      `.execute(t.database.migrator);
      expect(grants.rows).toEqual([]);
    });
  });
});
