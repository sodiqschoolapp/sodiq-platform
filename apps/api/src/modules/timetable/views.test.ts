import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  timetableViewSchema,
  viewChoicesSchema,
} from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { standingExamOver } from '../../testing/exams-kit.js';
import { heldEntry } from '../../testing/held-entry.js';
import { LoadKit } from '../../testing/load-kit.js';
import { publishedScene, publishOf, type PublishedScene } from '../../testing/published-scene.js';
import { subjectsTaughtOn } from './views.service.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const NEXT_MONDAY = '2026-10-19';
const DAY_MS = 86_400_000;

const viewOf = (response: Response) => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return timetableViewSchema.parse(response.body);
};

const refused = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

// All names are invented. Task 5.9a, pull request #197: the read-only
// timetable views (docs/spec/06-timetable.md, Views and outputs: "Views by
// class, by teacher, by room and the whole school; by day and by week.
// Tutors see the school timetable and their class; Head Tutors the school
// timetable and every class of the branch; Head Teachers and Senior Head
// Teachers the teachers of their subjects; Principal and Vice Principals the
// whole branch"; 02, Teacher: "Own timetable"). The clock stands at 23:55 on
// Saturday 10 October 2026 in Tashkent; the scene's version runs from Monday
// 12 October, with maths of each class on Monday at 08:00.
describe('the timetable views', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let s: PublishedScene;
  let south: PublishedScene;
  const cookies: Record<string, string> = {};
  /** The staff records of the Head Tutor and the Tutor, their own teacher views. */
  const ownStaff: Record<string, string> = {};

  const query = (path: string, values: Record<string, string>) =>
    `${path}?${new URLSearchParams(values).toString()}`;

  const view = (
    kind: 'branch' | 'class' | 'teacher' | 'room',
    values: Record<string, string>,
    cookie = t.admin,
    branch = s.branch,
  ) =>
    t.get(
      query(`/api/timetable/views/${kind}`, { date: NEXT_MONDAY, span: 'day', ...values }),
      branch,
      cookie,
    );

  const lessonOf = async (scene: PublishedScene, date: string, classId = scene.classId) => {
    const found = await t.database.migrator
      .selectFrom('lessons')
      .selectAll()
      .where('class_id', '=', classId)
      .where('lesson_date', '=', date)
      .executeTakeFirst();
    if (found === undefined) throw new Error('No such lesson.');
    return found;
  };

  const keyed = (path: string, branch: string, body: object) =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send(body);

  type Held = {
    role: Parameters<DayTemplatesKit['kit']['giveRole']>[1]['role'];
    subjectIds?: string[];
  };

  /** A role in the branch for a signed-in account, from the start of the year. */
  const roleOf = async (
    browser: { cookie: string; account: { id: string } },
    held: Held,
    branch: string,
  ) => {
    const given = await t.kit.giveRole(browser.account.id, {
      role: held.role,
      // From the start of the year, so that a Tutor row of September is inside it.
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
      ...(held.role === 'senior_head_teacher' ? {} : { branchId: branch }),
      ...(held.subjectIds === undefined ? {} : { subjectIds: held.subjectIds }),
    });
    return { cookie: browser.cookie, accountId: browser.account.id, assignmentId: given.id };
  };

  /** A signed-in account with a role in the branch, and its assignment. */
  const person = async (first: string, last: string, held: Held, branch = s.branch) =>
    roleOf(await t.kit.completeSession(first, last), held, branch);

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    const ownBrowser = await t.kit.completeSession('Kamola', 'Tursunova');
    const spareBrowser = await t.kit.completeSession('Otabek', 'Mirzayev');
    s = await publishedScene(t, load, {
      branch: t.north,
      accounts: { teacher: ownBrowser.account.id, spare: spareBrowser.account.id },
    });
    south = await publishedScene(t, load, { branch: t.south });

    const spiritual = await person('Nodira', 'Rahimova', { role: 'spiritual_vice_principal' });
    const headTutor = await person('Sardor', 'Yusupov', { role: 'head_tutor' });
    ownStaff.headTutor = (await load.teacher(s.branch, { accountId: headTutor.accountId })).staffId;
    const tutor = await person('Gulnora', 'Azimova', { role: 'tutor' });
    ownStaff.tutor = (await load.teacher(s.branch, { accountId: tutor.accountId })).staffId;
    await load.classes.tutorRow(s.branch, s.classId, tutor.assignmentId);
    // Decision 12: a Tutor whose row ended on 5 October, and the one whose row began then.
    const former = await person('Ulugbek', 'Nazarov', { role: 'tutor' });
    await load.teacher(s.branch, { accountId: former.accountId });
    await load.classes.tutorRow(s.branch, s.otherClass, former.assignmentId, {
      until: new Date('2026-10-05T00:00:00+05:00'),
    });
    const newTutor = await person('Feruza', 'Hamidova', { role: 'tutor' });
    await load.teacher(s.branch, { accountId: newTutor.accountId });
    await load.classes.tutorRow(s.branch, s.otherClass, newTutor.assignmentId, {
      from: new Date('2026-10-05T00:00:00+05:00'),
    });
    const head = await person('Shahlo', 'Qodirova', {
      role: 'head_teacher',
      subjectIds: [s.subject],
    });
    // A Head Teacher of another subject (the kit makes one for the appointment).
    const otherHead = await person('Rustam', 'Ismoilov', { role: 'head_teacher' });
    // A Senior Head Teacher works in every branch: the subjects of both scenes.
    const senior = await person('Davron', 'Ergashev', {
      role: 'senior_head_teacher',
      subjectIds: [s.subject, south.subject],
    });
    const otherSenior = await person('Nigora', 'Usmonova', { role: 'senior_head_teacher' });
    const own = await roleOf(ownBrowser, { role: 'teacher' }, s.branch);
    const spare = await roleOf(spareBrowser, { role: 'teacher' }, s.branch);
    Object.assign(cookies, {
      spiritual: spiritual.cookie,
      headTutor: headTutor.cookie,
      tutor: tutor.cookie,
      former: former.cookie,
      newTutor: newTutor.cookie,
      head: head.cookie,
      otherHead: otherHead.cookie,
      senior: senior.cookie,
      otherSenior: otherSenior.cookie,
      own: own.cookie,
      spare: spare.cookie,
    });
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the scope of each role (06, Views and outputs)', () => {
    it('gives the Principal, both Vice Principals and the Super Admin every view of the branch', async () => {
      for (const cookie of [t.admin, t.principal, t.vicePrincipal, cookies.spiritual ?? '']) {
        viewOf(await view('branch', {}, cookie));
        viewOf(await view('class', { classId: s.classId }, cookie));
        viewOf(await view('teacher', { staffId: s.teacher.staffId }, cookie));
        viewOf(await view('room', { roomId: s.room }, cookie));
      }
    });

    it('gives the Head Tutor the school and every class, no teacher and no room', async () => {
      const cookie = cookies.headTutor ?? '';
      viewOf(await view('branch', {}, cookie));
      viewOf(await view('class', { classId: s.classId }, cookie));
      viewOf(await view('class', { classId: s.otherClass }, cookie));
      refused(
        await view('teacher', { staffId: s.teacher.staffId }, cookie),
        403,
        'timetable_view_scope',
      );
      refused(await view('room', { roomId: s.room }, cookie), 403, 'timetable_view_scope');
    });

    it('gives the Tutor the school and own class only, no room', async () => {
      const cookie = cookies.tutor ?? '';
      viewOf(await view('branch', {}, cookie));
      const own = viewOf(await view('class', { classId: s.classId }, cookie));
      expect(own.lessons.map((one) => one.unit.id)).toEqual([s.classId]);
      refused(await view('class', { classId: s.otherClass }, cookie), 403, 'timetable_view_scope');
      refused(await view('room', { roomId: s.room }, cookie), 403, 'timetable_view_scope');
      refused(
        await view('teacher', { staffId: s.teacher.staffId }, cookie),
        403,
        'timetable_view_scope',
      );
    });

    it('reads the Tutor rows in force now, whatever the date viewed (decision 12)', async () => {
      // The former Tutor's row ended on 5 October: a date it covered is refused.
      refused(
        await view('class', { classId: s.otherClass, date: '2026-10-01' }, cookies.former),
        403,
        'timetable_view_scope',
      );
      // The new Tutor's row began on 5 October: a date before it is open.
      viewOf(await view('class', { classId: s.otherClass, date: '2026-09-28' }, cookies.newTutor));
    });

    it('gives a Head Teacher the teachers of own subjects, in those subjects only', async () => {
      const cookie = cookies.head ?? '';
      const read = viewOf(await view('teacher', { staffId: s.teacher.staffId }, cookie));
      expect(read.lessons.map((one) => one.subject.id)).toEqual([s.subject]);
      expect(read.busy).toEqual([]);
      refused(await view('branch', {}, cookie), 403, 'timetable_view_scope');
      refused(await view('class', { classId: s.classId }, cookie), 403, 'timetable_view_scope');
      refused(await view('room', { roomId: s.room }, cookie), 403, 'timetable_view_scope');
      // The Head Teacher of another subject sees no teacher of this one.
      refused(
        await view('teacher', { staffId: s.teacher.staffId }, cookies.otherHead),
        403,
        'timetable_view_scope',
      );
    });

    it('gives the Tutor and the Head Tutor their own teacher view', async () => {
      for (const [who, cookie] of [
        ['tutor', cookies.tutor],
        ['headTutor', cookies.headTutor],
      ] as const) {
        const staffId = ownStaff[who] ?? '';
        expect(viewOf(await view('teacher', { staffId }, cookie)).subject?.id).toBe(staffId);
      }
    });

    it('gives a Senior Head Teacher the teachers of own subjects in every branch, nothing else', async () => {
      const cookie = cookies.senior ?? '';
      const north = viewOf(await view('teacher', { staffId: s.teacher.staffId }, cookie));
      expect(north.lessons.map((one) => one.subject.id)).toEqual([s.subject]);
      const inSouth = viewOf(
        await view('teacher', { staffId: south.teacher.staffId }, cookie, south.branch),
      );
      expect(inSouth.lessons.map((one) => one.subject.id)).toEqual([south.subject]);
      for (const [kind, values] of [
        ['branch', {}],
        ['class', { classId: s.classId }],
        ['room', { roomId: s.room }],
      ] as const) {
        refused(await view(kind, values, cookie), 403, 'timetable_view_scope');
      }
      refused(
        await view('teacher', { staffId: s.teacher.staffId }, cookies.otherSenior),
        403,
        'timetable_view_scope',
      );
      for (const [branch, teacher] of [
        [s.branch, s.teacher.staffId],
        [south.branch, south.teacher.staffId],
      ] as const) {
        const choices = viewChoicesSchema.parse(
          (
            await t.get(
              query('/api/timetable/views/choices', { date: NEXT_MONDAY }),
              branch,
              cookie,
            )
          ).body,
        );
        expect(choices.branch).toBe(false);
        expect(choices.rooms).toEqual([]);
        expect(choices.teachers.map((one) => one.id)).toContain(teacher);
      }
    });

    it('gives a teacher their own timetable and nobody else’s', async () => {
      refused(await view('room', { roomId: s.room }, cookies.own), 403, 'timetable_view_scope');
      const cookie = cookies.own ?? '';
      const read = viewOf(await view('teacher', { staffId: s.teacher.staffId }, cookie));
      expect(read.lessons.map((one) => one.teacher?.id)).toEqual([s.teacher.staffId]);
      // Task 6.2 (07, Opening a journal): each lesson names its journal, opened from the view.
      const journal = await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('subject_id', '=', s.subject)
        .executeTakeFirstOrThrow();
      expect(read.lessons.map((one) => one.journalId)).toEqual([journal.id]);
      refused(
        await view('teacher', { staffId: s.otherTeacher.staffId }, cookie),
        403,
        'timetable_view_scope',
      );
      refused(await view('class', { classId: s.classId }, cookie), 403, 'timetable_view_scope');
      refused(await view('branch', {}, cookie), 403, 'timetable_view_scope');
      // A teacher with no staff record has no own view.
      refused(
        await view('teacher', { staffId: s.teacher.staffId }, t.teacher),
        403,
        'timetable_view_scope',
      );
    });

    it('lists what each role may open', async () => {
      const tutor = viewChoicesSchema.parse(
        (
          await t.get(
            query('/api/timetable/views/choices', { date: NEXT_MONDAY }),
            s.branch,
            cookies.tutor,
          )
        ).body,
      );
      expect(tutor.branch).toBe(true);
      expect(tutor.classes.map((one) => one.id)).toEqual([s.classId]);
      expect(tutor.rooms).toEqual([]);
      const own = viewChoicesSchema.parse(
        (
          await t.get(
            query('/api/timetable/views/choices', { date: NEXT_MONDAY }),
            s.branch,
            cookies.own,
          )
        ).body,
      );
      expect(own.branch).toBe(false);
      expect(own.own).toBe(s.teacher.staffId);
      expect(own.teachers.map((one) => one.id)).toEqual([s.teacher.staffId]);
      const head = viewChoicesSchema.parse(
        (
          await t.get(
            query('/api/timetable/views/choices', { date: NEXT_MONDAY }),
            s.branch,
            cookies.head,
          )
        ).body,
      );
      expect(head.teachers.map((one) => one.id).sort()).toEqual(
        [s.teacher.staffId, s.otherTeacher.staffId].sort(),
      );
      const admin = viewChoicesSchema.parse(
        (await t.get(query('/api/timetable/views/choices', { date: NEXT_MONDAY }), s.branch)).body,
      );
      expect(admin.rooms.map((one) => one.id)).toEqual(
        expect.arrayContaining([s.room, s.otherRoom]),
      );
    });

    it('answers 404 for another branch’s and an unknown class, teacher and room', async () => {
      for (const [kind, key, ids] of [
        ['class', 'classId', [south.classId, UNKNOWN]],
        ['teacher', 'staffId', [south.teacher.staffId, UNKNOWN]],
        ['room', 'roomId', [south.room, UNKNOWN]],
      ] as const) {
        for (const id of ids) {
          refused(await view(kind, { [key]: id }), 404, 'not_found');
        }
      }
    });

    it('answers 422 for a week wholly outside the years, and marks the days outside', async () => {
      refused(
        await view('branch', { date: '2027-07-05', span: 'week' }),
        422,
        'calendar_outside_year',
      );
      // The year ends on Monday 31 May 2027.
      const read = viewOf(await view('branch', { date: '2027-05-31', span: 'week' }));
      expect(read.days.find((one) => one.date === '2027-06-01')?.outsideYear).toBe(true);
      expect(read.days.find((one) => one.date === '2027-05-31')?.outsideYear).toBe(false);
    });
  });

  describe('what a view shows', () => {
    it('lists the class’s lessons with the version and its "valid from"', async () => {
      const read = viewOf(await view('class', { classId: s.classId, span: 'week' }));
      expect(read.days.map((one) => one.date)).toEqual([
        '2026-10-19',
        '2026-10-20',
        '2026-10-21',
        '2026-10-22',
        '2026-10-23',
      ]);
      expect(read.days[0]?.version?.startsOn).toBe('2026-10-12');
      expect(read.days[0]?.slots.map((one) => one.lessonNumber)).toEqual([1, 2, 3]);
      expect(read.lessons).toHaveLength(1);
      expect(read.lessons[0]).toMatchObject({
        date: NEXT_MONDAY,
        start: 480,
        lessonNumber: 1,
        classIds: [s.classId],
      });
      expect(read.lessons[0]).not.toHaveProperty('canCancel');
    });

    it('shows the "changed" mark on all four views for seven days (06, Everyone is told)', async () => {
      const lesson = await lessonOf(s, '2026-10-26');
      const date = '2026-10-26';
      const views = () =>
        Promise.all([
          view('branch', { date }),
          view('class', { date, classId: s.classId }),
          view('teacher', { date, staffId: s.teacher.staffId }),
          view('room', { date, roomId: s.room }),
        ]);
      const mark = (changedAt: Date) =>
        t.database.migrator
          .insertInto('lesson_changes')
          .values({ lesson_id: lesson.id, branch_id: s.branch, changed_at: changedAt })
          .onConflict((conflict) =>
            conflict.column('lesson_id').doUpdateSet({ changed_at: changedAt }),
          )
          .execute();
      const now = new Date(START).getTime();
      await mark(new Date(now - 7 * DAY_MS + 1));
      for (const response of await views()) {
        const found = viewOf(response).lessons.find((one) => one.id === lesson.id);
        expect(found?.changed).toBe(true);
      }
      await mark(new Date(now - 7 * DAY_MS));
      for (const response of await views()) {
        const found = viewOf(response).lessons.find((one) => one.id === lesson.id);
        expect(found?.changed).toBe(false);
      }
    });

    it('shows an exam on all four views, and not to a Head Teacher of another subject', async () => {
      const date = '2026-12-07';
      const lesson = await lessonOf(s, date);
      const examId = await standingExamOver(t.database.migrator, {
        lessonId: lesson.id,
        roomId: s.room,
        staffId: s.spareTeacher.staffId,
      });
      const seen = await Promise.all([
        view('branch', { date }),
        view('class', { date, classId: s.classId }),
        view('teacher', { date, staffId: s.spareTeacher.staffId }),
        view('room', { date, roomId: s.room }),
      ]);
      for (const response of seen) {
        expect(viewOf(response).exams.map((one) => one.id)).toEqual([examId]);
      }
      // The class's lesson is cancelled for the exam.
      const [, classView] = seen;
      if (classView === undefined) throw new Error('The class view was asked.');
      const read = viewOf(classView);
      expect(read.lessons.find((one) => one.id === lesson.id)?.cancelCause).toBe('exam');
      expect(read.exams[0]?.rooms[0]).not.toHaveProperty('invigilatorIds');
      // Another class and another room do not hold it.
      expect(viewOf(await view('class', { date, classId: s.otherClass })).exams).toEqual([]);
      expect(viewOf(await view('room', { date, roomId: s.otherRoom })).exams).toEqual([]);
      // The Head Teacher of the subject reads the invigilator only where a load row names them.
      refused(
        await view('teacher', { date, staffId: s.spareTeacher.staffId }, cookies.head),
        403,
        'timetable_view_scope',
      );
    });

    it('shows a cancelled lesson with its reason', async () => {
      const date = '2026-11-09';
      const lesson = await lessonOf(s, date);
      const cancelled = await keyed(`/api/timetable/lessons/${lesson.id}/cancel`, s.branch, {
        reason: 'School trip',
      });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      const read = viewOf(await view('class', { date, classId: s.classId }));
      expect(read.lessons.find((one) => one.id === lesson.id)).toMatchObject({
        cancelCause: 'reason',
        cancelReason: 'School trip',
        state: 'cancelled',
      });
    });

    it('shows a substituted lesson on the substitute’s view and, marked, on the replaced teacher’s (decision 7)', async () => {
      const date = '2026-11-16';
      const lesson = await lessonOf(s, date);
      const substituted = await keyed(`/api/timetable/lessons/${lesson.id}/substitute`, s.branch, {
        teacherId: s.spareTeacher.staffId,
        reason: 'Training day',
      });
      expect(substituted.status, JSON.stringify(substituted.body)).toBe(200);
      const theirs = viewOf(await view('teacher', { date, staffId: s.spareTeacher.staffId }));
      expect(theirs.lessons.map((one) => [one.id, one.replacedHere])).toEqual([[lesson.id, false]]);
      expect(theirs.lessons[0]?.substitution?.replaced?.id).toBe(s.teacher.staffId);
      const replaced = viewOf(await view('teacher', { date, staffId: s.teacher.staffId }));
      expect(replaced.lessons.map((one) => [one.id, one.replacedHere])).toEqual([
        [lesson.id, true],
      ]);
      // The teacher reads the replaced lesson on their own view too.
      const own = viewOf(await view('teacher', { date, staffId: s.teacher.staffId }, cookies.own));
      expect(own.lessons.map((one) => one.replacedHere)).toEqual([true]);
    });

    it('shows a lesson moved to another room on the new room’s view only', async () => {
      const date = '2026-11-23';
      const lesson = await lessonOf(s, date);
      const third = await load.classes.room(s.branch);
      const moved = await keyed(`/api/timetable/lessons/${lesson.id}/room`, s.branch, {
        roomId: third,
        reason: 'Projector broken',
      });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect(
        viewOf(await view('room', { date, roomId: third })).lessons.map((one) => one.id),
      ).toEqual([lesson.id]);
      expect(
        viewOf(await view('room', { date, roomId: s.room })).lessons.map((one) => one.id),
      ).not.toContain(lesson.id);
    });

    it('lists the school view by class with each lesson’s number', async () => {
      const read = viewOf(await view('branch', {}));
      expect(read.classes.map((one) => one.id)).toEqual(
        expect.arrayContaining([s.classId, s.otherClass]),
      );
      expect(read.lessons.map((one) => [one.classIds[0], one.lessonNumber]).sort()).toEqual(
        [
          [s.classId, 1],
          [s.otherClass, 1],
        ].sort(),
      );
    });

    it('lists a day off with its name and no lessons', async () => {
      const date = '2026-11-30';
      await t.database.migrator
        .insertInto('calendar_entries')
        .values({
          branch_id: s.branch,
          kind: 'day_off',
          name: 'Constitution Day',
          first_date: date,
          last_date: date,
        })
        .execute();
      const read = viewOf(await view('class', { date, classId: s.classId }));
      expect(read.days[0]?.dayOff).toBe('Constitution Day');
      expect(viewOf(await view('branch', { date })).days[0]?.dayOff).toBe('Constitution Day');
    });
  });

  describe('a week across two versions', () => {
    it('names both versions and decides a Head Teacher’s scope day by day', async () => {
      const scene = await publishedScene(t, load);
      const head = await person(
        'Zarina',
        'Sobirova',
        { role: 'head_teacher', subjectIds: [scene.subject] },
        scene.branch,
      );
      // A second version from Wednesday 14 October gives the row to the spare teacher.
      const created = await t.post('/api/timetable/versions', scene.branch, {
        academicYearId: scene.year,
        startsOn: '2026-10-14',
        copyFrom: scene.version,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const second = (created.body as { id: string }).id;
      const row = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', second)
        .where('class_id', '=', scene.classId)
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ teacher_id: scene.spareTeacher.staffId })
        .where('id', '=', row.id)
        .execute();
      await t.database.migrator
        .updateTable('pattern_entries')
        .set({ teacher_id: scene.spareTeacher.staffId })
        .where('load_row_id', '=', row.id)
        .execute();
      const confirmed = await t.post(
        `/api/timetable/versions/${second}/templates/confirm`,
        scene.branch,
      );
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      await load.freeEditLock(second);
      const published = await publishOf(t)(scene.branch, second, '2026-10-14');
      expect(published.status, JSON.stringify(published.body)).toBe(200);

      const week = viewOf(
        await view(
          'class',
          { date: '2026-10-12', span: 'week', classId: scene.classId },
          t.admin,
          scene.branch,
        ),
      );
      const numbers = week.days.map((one) => [one.date, one.version?.startsOn]);
      expect(numbers[0]).toEqual(['2026-10-12', '2026-10-12']);
      expect(numbers[2]).toEqual(['2026-10-14', '2026-10-14']);

      // The first version names the teacher on Monday and Tuesday only.
      const read = viewOf(
        await view(
          'teacher',
          { date: '2026-10-12', span: 'week', staffId: scene.teacher.staffId },
          head.cookie,
          scene.branch,
        ),
      );
      expect(read.lessons.map((one) => one.date)).toEqual(['2026-10-12']);
      // A week of the second version alone names them on no day.
      refused(
        await view(
          'teacher',
          { date: NEXT_MONDAY, span: 'week', staffId: scene.teacher.staffId },
          head.cookie,
          scene.branch,
        ),
        403,
        'timetable_view_scope',
      );
      // Spec review of the code, must-fix 3: the rows are read for each day,
      // so the days of the second version name no subject of the teacher.
      const byDay = await t.app
        .get(Transactions)
        .run([scene.branch], (transaction: Transaction) =>
          subjectsTaughtOn(transaction, scene.branch, scene.teacher.staffId, [
            '2026-10-12',
            '2026-10-13',
            '2026-10-14',
            '2026-10-15',
          ]),
        );
      expect([...byDay.entries()].map(([date, ids]) => [date, [...ids]])).toEqual([
        ['2026-10-12', [scene.subject]],
        ['2026-10-13', [scene.subject]],
        ['2026-10-14', []],
        ['2026-10-15', []],
      ]);
    });
  });

  describe('a teacher of two branches (06, Busy elsewhere)', () => {
    it('shows a Head Teacher no busy block of another branch (decision 4)', async () => {
      const here = await publishedScene(t, load);
      const away = await publishedScene(t, load);
      const head = await person(
        'Jamshid',
        'Hakimov',
        { role: 'head_teacher', subjectIds: [here.subject] },
        here.branch,
      );
      // The teacher's own lesson of that Monday is cancelled, so the other
      // branch's lesson at the same time can be theirs.
      const own = await lessonOf(here, NEXT_MONDAY);
      const cancelled = await keyed(`/api/timetable/lessons/${own.id}/cancel`, here.branch, {
        reason: 'Training day',
      });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: here.teacher.staffId, branch_id: away.branch, is_main: false })
        .execute();
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: here.teacher.staffId })
        .where('id', '=', (await lessonOf(away, NEXT_MONDAY)).id)
        .execute();
      // The Super Admin reads the block; the Head Teacher of the subject does not.
      expect(
        viewOf(await view('teacher', { staffId: here.teacher.staffId }, t.admin, here.branch)).busy,
      ).toHaveLength(1);
      const read = viewOf(
        await view('teacher', { staffId: here.teacher.staffId }, head.cookie, here.branch),
      );
      expect(read.lessons.map((one) => one.id)).toEqual([own.id]);
      expect(read.busy).toEqual([]);
    });

    it('shows the lessons in the other branch as busy blocks with the branch only', async () => {
      const signedIn = await t.kit.completeSession('Sevara', 'Olimova');
      const here = await publishedScene(t, load, { accounts: { spare: signedIn.account.id } });
      const away = await publishedScene(t, load);
      const browser = await roleOf(signedIn, { role: 'teacher' }, here.branch);
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: here.spareTeacher.staffId, branch_id: away.branch, is_main: false })
        .execute();
      const awayLesson = await lessonOf(away, NEXT_MONDAY);
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: here.spareTeacher.staffId })
        .where('id', '=', awayLesson.id)
        .execute();
      const awayName = (
        await t.database.migrator
          .selectFrom('branches')
          .select('name')
          .where('id', '=', away.branch)
          .executeTakeFirstOrThrow()
      ).name;

      const own = viewOf(
        await view('teacher', { staffId: here.spareTeacher.staffId }, browser.cookie, here.branch),
      );
      expect(own.busy).toEqual([
        { date: NEXT_MONDAY, start: 480, end: 525, branch: { id: away.branch, name: awayName } },
      ]);
      expect(own.lessons).toEqual([]);
      expect(own.days[0]?.axis).toBe('clock');
      expect(JSON.stringify(own.busy)).not.toContain(away.classId);

      // The Academic Vice Principal's view shows it too.
      const vice = await person(
        'Oydin',
        'Rasulova',
        { role: 'academic_vice_principal' },
        here.branch,
      );
      expect(
        viewOf(
          await view('teacher', { staffId: here.spareTeacher.staffId }, vice.cookie, here.branch),
        ).busy,
      ).toHaveLength(1);

      // The reading branch's own lessons are never busy blocks.
      const teacher = viewOf(
        await view('teacher', { staffId: here.teacher.staffId }, t.admin, here.branch),
      );
      expect(teacher.busy).toEqual([]);
      expect(teacher.days[0]?.axis).toBe('slots');

      // A day this branch does not work, and a day off here, are listed with the block.
      await t.database.migrator
        .updateTable('branches')
        .set({ working_weekdays: [2, 3, 4, 5] })
        .where('id', '=', here.branch)
        .execute();
      const notWorking = viewOf(
        await view(
          'teacher',
          { span: 'week', staffId: here.spareTeacher.staffId },
          browser.cookie,
          here.branch,
        ),
      );
      expect(notWorking.days.map((one) => one.date)).toContain(NEXT_MONDAY);
      await t.database.migrator
        .updateTable('branches')
        .set({ working_weekdays: [1, 2, 3, 4, 5] })
        .where('id', '=', here.branch)
        .execute();
      await t.database.migrator
        .insertInto('calendar_entries')
        .values({
          branch_id: here.branch,
          kind: 'day_off',
          name: 'Teachers’ Day',
          first_date: NEXT_MONDAY,
          last_date: NEXT_MONDAY,
        })
        .execute();
      const dayOff = viewOf(
        await view('teacher', { staffId: here.spareTeacher.staffId }, browser.cookie, here.branch),
      );
      expect(dayOff.days[0]?.dayOff).toBe('Teachers’ Day');
      expect(dayOff.busy).toHaveLength(1);
    });
  });

  describe('a version published before 0079 (decision 13)', () => {
    it('is read from its pattern, never as an empty day', async () => {
      const scene = await publishedScene(t, load);
      // A version published before 0079 has no stored lesson blocks.
      // As 5.5b-2's test removes them: through the application, with an audit entry.
      await t.app.get(Transactions).run([scene.branch], async (transaction: Transaction) => {
        const blocks = await transaction
          .selectFrom('lesson_blocks')
          .select('id')
          .where('version_id', '=', scene.version)
          .execute();
        const ids = blocks.map((one) => one.id);
        await transaction.deleteFrom('lessons').where('block_id', 'in', ids).execute();
        await transaction.deleteFrom('lesson_blocks').where('id', 'in', ids).execute();
        await heldEntry(transaction, scene.branch);
      });
      const read = viewOf(await view('class', { classId: scene.classId }, t.admin, scene.branch));
      expect(read.days[0]?.fromPattern).toBe(true);
      expect(read.lessons).toHaveLength(1);
      expect(read.lessons[0]).toMatchObject({ start: 480, lessonNumber: 1, changed: false });
    });
  });

  // Spec review of the code, must-fixes 1, 2, 5, 6 and 7.
  describe('the paths the review named', () => {
    it('lays a room out by clock time when its day holds lessons of two templates', async () => {
      const scene = await publishedScene(t, load);
      const date = '2026-10-26';
      // 7 Princeton becomes grade 8, whose Mondays start at 08:05 from 26 October.
      const slot = await t.createSlotType(scene.branch, 'Grade 8 lesson', 'lesson', 45);
      const later = await t.createTemplate(scene.branch, 'Grade 8', [slot, slot, slot], '08:05');
      await t.database.migrator
        .insertInto('day_template_assignments')
        .values({
          branch_id: scene.branch,
          level: 'weekday_grades',
          weekday: 1,
          grade_from: 8,
          grade_to: 8,
          day_template_id: later,
          valid_from: date,
        })
        .execute();
      await t.database.migrator
        .updateTable('classes')
        .set({ grade: 8 })
        .where('id', '=', scene.otherClass)
        .execute();
      // Both lessons in one shared room.
      await t.database.migrator
        .updateTable('rooms')
        .set({ shared: true, max_simultaneous_lessons: 2 })
        .where('id', '=', scene.room)
        .execute();
      await t.database.migrator
        .updateTable('lessons')
        .set({ room_id: scene.room })
        .where('id', '=', (await lessonOf(scene, date, scene.otherClass)).id)
        .execute();
      const read = viewOf(await view('room', { date, roomId: scene.room }, t.admin, scene.branch));
      expect(read.lessons).toHaveLength(2);
      expect(read.days[0]?.axis).toBe('clock');
      expect(read.days[0]?.slots).toEqual([]);
      // One template only on another Monday: lesson numbers.
      const before = viewOf(
        await view('room', { date: NEXT_MONDAY, roomId: scene.room }, t.admin, scene.branch),
      );
      expect(before.days[0]?.axis).toBe('slots');
    });

    it('shows a Head Teacher no exam of another subject, nor one with no subject', async () => {
      const scene = await publishedScene(t, load);
      const head = await person(
        'Bahrom',
        'Toshev',
        { role: 'head_teacher', subjectIds: [scene.subject] },
        scene.branch,
      );
      const other = await load.classes.subject({ grades: [7] });
      for (const [date, subject] of [
        ['2026-11-30', null],
        ['2026-12-07', other],
      ] as const) {
        // The teacher's own lesson is cancelled, and they invigilate the other class's exam.
        const own = await lessonOf(scene, date);
        expect(
          (
            await keyed(`/api/timetable/lessons/${own.id}/cancel`, scene.branch, {
              reason: 'Exam duty',
            })
          ).status,
        ).toBe(200);
        const examId = await standingExamOver(t.database.migrator, {
          lessonId: (await lessonOf(scene, date, scene.otherClass)).id,
          roomId: scene.otherRoom,
          staffId: scene.teacher.staffId,
        });
        await t.database.migrator
          .updateTable('exams')
          .set({ subject_id: subject })
          .where('id', '=', examId)
          .execute();
        const all = viewOf(
          await view('teacher', { date, staffId: scene.teacher.staffId }, t.admin, scene.branch),
        );
        expect(all.exams.map((one) => one.id)).toEqual([examId]);
        const theirs = viewOf(
          await view(
            'teacher',
            { date, staffId: scene.teacher.staffId },
            head.cookie,
            scene.branch,
          ),
        );
        expect(theirs.exams).toEqual([]);
        expect(theirs.lessons.map((one) => one.id)).toEqual([own.id]);
      }
    });

    it('answers 404 for another branch’s vacancy and shows a vacancy of the branch', async () => {
      const elsewhere = await load.vacancy(south.branch);
      refused(await view('teacher', { staffId: elsewhere }), 404, 'not_found');
      const vacancy = await load.vacancy(s.branch);
      const read = viewOf(await view('teacher', { staffId: vacancy }));
      expect(read.subject?.id).toBe(vacancy);
      expect(read.busy).toEqual([]);
      // A Head Teacher never reads a vacancy.
      refused(
        await view('teacher', { staffId: vacancy }, cookies.head),
        403,
        'timetable_view_scope',
      );
    });

    it('lists a group lesson on the view of each class it draws from', async () => {
      const scene = await publishedScene(t, load);
      const date = '2026-10-26';
      const group = await load.classes.group(scene.branch, scene.year, scene.subject, [
        scene.classId,
        scene.otherClass,
      ]);
      // 7 Oxford's own lesson at that time is cancelled, so the group's can claim the class.
      const own = await lessonOf(scene, date);
      expect(
        (await keyed(`/api/timetable/lessons/${own.id}/cancel`, scene.branch, { reason: 'Trip' }))
          .status,
      ).toBe(200);
      const lesson = await lessonOf(scene, date, scene.otherClass);
      await t.database.migrator
        .updateTable('lessons')
        .set({ class_id: null, group_id: group })
        .where('id', '=', lesson.id)
        .execute();
      for (const classId of [scene.classId, scene.otherClass]) {
        const read = viewOf(await view('class', { date, classId }, t.admin, scene.branch));
        const found = read.lessons.find((one) => one.id === lesson.id);
        expect(found?.unit).toMatchObject({ kind: 'group', id: group });
        expect(found?.classIds.sort()).toEqual([scene.classId, scene.otherClass].sort());
      }
    });

    it('lists a special working Saturday of the week (decision 7)', async () => {
      const scene = await publishedScene(t, load);
      const saturday = '2026-10-24';
      const template = await t.database.migrator
        .selectFrom('day_template_assignments')
        .select('day_template_id')
        .where('branch_id', '=', scene.branch)
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .insertInto('calendar_entries')
        .values({
          branch_id: scene.branch,
          kind: 'special_day',
          name: 'Worked by Monday',
          first_date: saturday,
          last_date: saturday,
          day_template_id: template.day_template_id,
          follows_weekday: 1,
        })
        .execute();
      // The teacher's hours cover that Saturday too.
      const entry = await t.database.migrator
        .selectFrom('staff_availability')
        .select(['id', 'valid_until'])
        .where('staff_id', '=', scene.teacher.staffId)
        .where('branch_id', '=', scene.branch)
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .insertInto('staff_availability_ranges')
        .values({
          entry_id: entry.id,
          branch_id: scene.branch,
          staff_id: scene.teacher.staffId,
          weekday: 6,
          start_minutes: 0,
          end_minutes: 1440,
          valid_from: '2026-09-01',
          valid_until: entry.valid_until,
        })
        .execute();
      const lesson = await lessonOf(scene, NEXT_MONDAY);
      const moved = await keyed(`/api/timetable/lessons/${lesson.id}/move`, scene.branch, {
        date: saturday,
        lessonNumber: 1,
        reason: 'Worked Saturday',
      });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      const read = viewOf(
        await view(
          'class',
          { date: NEXT_MONDAY, span: 'week', classId: scene.classId },
          t.admin,
          scene.branch,
        ),
      );
      expect(read.days.map((one) => one.date)).toContain(saturday);
      expect(read.lessons.find((one) => one.date === saturday)).toBeDefined();
    });
  });
});
