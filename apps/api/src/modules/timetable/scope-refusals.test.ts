import { BRANCH_HEADER, teachingHomeSchema, viewChoicesSchema } from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { XLSX_MEDIA_TYPE } from '../../http/xlsx.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { refusedFile } from '../../testing/pdf-kit.js';
import { binary } from '../../testing/xlsx-kit.js';

const NEXT_MONDAY = '2026-10-19';
/** Monday 19 October 2026, 07:00 in Tashkent: the scenes' versions run from the 12th. */
const MOMENT = '2026-10-19T07:00:00+05:00';

type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
type Browser = { cookie: string; account: { id: string } };

// All names are invented. Task 10.3a: the limits inside the timetable routes that the role
// harness cannot see (docs/spec/06-timetable.md, Views and outputs: "Head Teachers and Senior
// Head Teachers the teachers of their subjects"; 02, Teacher: "Own timetable"; task 5.9a,
// decisions 3 and 4; task 5.9b: the home page is the caller's own). Each test reads a case
// inside the limit too, so that it fails if the route's own check goes. The clock stands at
// 23:55 on Saturday 10 October 2026 in Tashkent, the home pages are read on Monday 19 October.
describe('the limits inside the timetable routes', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let s: PublishedScene;
  let names = 0;
  /** The teacher of the first class's maths, as an account with the Teacher role. */
  let own: Browser;
  let elsewhere: string;
  /** Of the subject, and of another one. */
  const heads: Record<'own' | 'other', Browser> = {} as Record<'own' | 'other', Browser>;
  const seniors: Record<'own' | 'other', Browser> = {} as Record<'own' | 'other', Browser>;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Dilnoza', `Yoldosheva${'a'.repeat(names % 7)}`);
  };

  const holding = async (held: Omit<Held, 'validFrom'>, browser?: Browser): Promise<Browser> => {
    const holder = browser ?? (await account());
    await t.kit.giveRole(holder.account.id, {
      ...held,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    return holder;
  };

  const choicesOf = async (cookie: string) => {
    const response = await t.get(
      `/api/timetable/views/choices?date=${NEXT_MONDAY}`,
      s.branch,
      cookie,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return viewChoicesSchema.parse(response.body);
  };

  const send = (body: Record<string, string>, cookie: string) =>
    request(t.kit.server)
      .post('/api/timetable/views/export')
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, s.branch)
      .buffer(true)
      .parse(binary)
      .send({ date: NEXT_MONDAY, span: 'day', format: 'xlsx', ...body });

  const printed = (response: Response) => {
    expect(response.status, String(response.body)).toBe(200);
    expect(response.headers['content-type']).toContain(XLSX_MEDIA_TYPE);
  };

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    own = await account();
    s = await publishedScene(t, load, { branch: t.north, accounts: { teacher: own.account.id } });
    await holding({ role: 'teacher', branchId: s.branch }, own);
    elsewhere = await load.classes.subject({ grades: [7] });
    heads.own = await holding({
      role: 'head_teacher',
      branchId: s.branch,
      subjectIds: [s.subject],
    });
    heads.other = await holding({
      role: 'head_teacher',
      branchId: s.branch,
      subjectIds: [elsewhere],
    });
    seniors.own = await holding({ role: 'senior_head_teacher', subjectIds: [s.subject] });
    seniors.other = await holding({ role: 'senior_head_teacher', subjectIds: [elsewhere] });
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the views (task 5.9a, decisions 3 and 4)', () => {
    it('leaves the teachers of another subject, the school, the classes and the rooms out of the choices of a Head Teacher and a Senior Head Teacher', async () => {
      for (const [role, inside, outside] of [
        ['head_teacher', heads.own, heads.other],
        ['senior_head_teacher', seniors.own, seniors.other],
      ] as const) {
        // Inside the limit: the teachers of the own subject.
        expect(
          (await choicesOf(inside.cookie)).teachers.map((one) => one.id),
          role,
        ).toContain(s.teacher.staffId);
        const outsideChoices = await choicesOf(outside.cookie);
        expect(outsideChoices.teachers, role).toEqual([]);
        expect(outsideChoices.branch, role).toBe(false);
        expect(outsideChoices.classes, role).toEqual([]);
        expect(outsideChoices.rooms, role).toEqual([]);
      }
    });

    it('refuses a Senior Head Teacher of another subject and a Teacher the file of another teacher, logging nothing', async () => {
      const senior = seniors.own;
      const seniorOther = seniors.other;
      const before = await t.auditCount();
      refusedFile(
        await send({ kind: 'teacher', staffId: s.teacher.staffId }, seniorOther.cookie),
        403,
        'timetable_view_scope',
      );
      refusedFile(
        await send({ kind: 'teacher', staffId: s.otherTeacher.staffId }, own.cookie),
        403,
        'timetable_view_scope',
      );
      expect(await t.auditCount()).toBe(before);
      // Inside the limit: the own subject's teacher, and the own timetable.
      printed(await send({ kind: 'teacher', staffId: s.teacher.staffId }, senior.cookie));
      printed(await send({ kind: 'teacher', staffId: s.teacher.staffId }, own.cookie));
    });
  });

  // Task 5.9b, pull request #198: "the caller's own lessons and exams of the week, from every
  // branch ... Own only: the query takes no field". A Tutor of another class, a Head Teacher
  // and a Senior Head Teacher of the subject read their own lessons, not those they oversee.
  it('lists only the own lessons on the home page of a Tutor, a Head Teacher and a Senior Head Teacher', async () => {
    for (const role of ['tutor', 'head_teacher', 'senior_head_teacher'] as const) {
      const browser = await account();
      const scene = await publishedScene(t, load, { accounts: { teacher: browser.account.id } });
      if (role === 'tutor') {
        await load.tutorOf(scene.branch, scene.otherClass, browser.account.id, {
          from: new Date('2026-09-01T00:00:00+05:00'),
        });
      } else {
        await holding(
          {
            role,
            ...(role === 'head_teacher' ? { branchId: scene.branch } : {}),
            subjectIds: [scene.subject],
          },
          browser,
        );
      }
      const lessonOn = async (classId: string) =>
        (
          await t.database.migrator
            .selectFrom('lessons')
            .select('id')
            .where('class_id', '=', classId)
            .where('lesson_date', '=', NEXT_MONDAY)
            .executeTakeFirstOrThrow()
        ).id;
      const ownLesson = await lessonOn(scene.classId);
      const overseen = await lessonOn(scene.otherClass);
      t.clock.set(MOMENT);
      try {
        await t.database.migrator
          .updateTable('sessions')
          .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
          .where('account_id', '=', browser.account.id)
          .execute();
        const response = await t.get('/api/timetable/home', scene.branch, browser.cookie);
        expect(response.status, `${role} ${JSON.stringify(response.body)}`).toBe(200);
        const ids = teachingHomeSchema.parse(response.body).lessons.map((one) => one.id);
        expect(ids, role).toContain(ownLesson);
        expect(ids, role).not.toContain(overseen);
        // A query naming another person is refused, never answered with that person's week.
        const named = await t.get(
          `/api/timetable/home?staffId=${scene.otherTeacher.staffId}`,
          scene.branch,
          browser.cookie,
        );
        expect(named.status, role).toBe(400);
      } finally {
        t.clock.set(START);
      }
    }
  });
});
