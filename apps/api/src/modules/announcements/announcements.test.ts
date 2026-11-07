import {
  announcementListSchema,
  announcementMonthSchema,
  announcementSchema,
  apiErrorSchema,
  relativeReportSchema,
  REQUEST_KEY_HEADER,
} from '@sodiq/shared';
import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreatedAccount } from '../auth/accounts.service.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { ParentsKit } from '../../testing/parents-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { cookieOf, NEW_PASSWORD } from '../../testing/sign-in-kit.js';
import { storedJobs } from '../../testing/sample-job.js';
import { TEST_BOT_TOKEN, TEST_WEBHOOK_SECRET } from '../../testing/telegram-kit.js';
import type { TelegramFetch } from '../portal/telegram/bot-api.js';
import { AnnouncementDelivery } from './announcement-delivery.service.js';

const codeOf = (response: Response): string =>
  apiErrorSchema.safeParse(response.body).data?.error.code ?? `status ${String(response.status)}`;

/** Tuesday 13 October 2026, a school day after the scenes' versions start (Monday the 12th). */
const NOW = '2026-10-13T10:00:00+05:00';

interface Sent {
  chat: string;
  text: string;
  button: string | null;
}

// All names, chats and tokens are invented. Task 11.7, pull request #306: announcements and
// events (`11`; build plan 11.7 with the owner's approval of 7 November 2026; plan decisions 1 to
// 15). Who may call each route is walked for every role by route-permissions.test.ts
// (`ROUTE_ACCESS`); this file checks what each route does, its audit entries, the scope refusals
// inside the routes, the portal's privacy and the bot's messages.
describe('announcements and events', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let parents: ParentsKit;
  let a: PublishedScene;
  let b: PublishedScene;
  let teacherAccount: CreatedAccount;
  let cookies: {
    admin: string;
    vice: string;
    spiritual: string;
    principal: string;
    headTutor: string;
    teacher: string;
    tutor: string;
    headTeacher: string;
    seniorHeadTeacher: string;
    nurse: string;
    viceB: string;
  };
  /** Family A: a child in class A of grade 7 of branch A; its mother linked to a chat. */
  let childA: string;
  let motherA: { accountId: string; cookie: string; chat: string; relativeId: string };
  /** Family B: a child in a class of grade 7 of branch B; its father linked. */
  let childB: string;
  let fatherB: { accountId: string; cookie: string; chat: string };
  /** A child of family A's mother in the other class of branch A. */
  let siblingA: string;
  /** Another family's child in class A; its parent has no Telegram link. */
  let otherFamily: string;
  let otherParent: string;
  const sent: Sent[] = [];
  let answer = { ok: true, status: 200 };
  let nextChat = 7_300_000;

  const fakeFetch: TelegramFetch = (_url, init) => {
    const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
      chat_id: string;
      text: string;
      reply_markup?: { inline_keyboard: { web_app: { url: string } }[][] };
    };
    if (answer.ok) {
      sent.push({
        chat: String(body.chat_id),
        text: body.text,
        button: body.reply_markup?.inline_keyboard[0]?.[0]?.web_app.url ?? null,
      });
    }
    return Promise.resolve(answer);
  };

  const create = (branch: string, body: object, cookie: string, key: string = randomUUID()) =>
    t.post('/api/announcements', branch, body, cookie).set(REQUEST_KEY_HEADER, key);
  const list = (branch: string, cookie: string, archived = false) =>
    t.get(`/api/announcements?archived=${String(archived)}`, branch, cookie);
  const feed = (branch: string, cookie: string, month = '2026-10') =>
    t.get(`/api/announcements-feed?month=${month}`, branch, cookie);
  const portal = (studentId: string, cookie: string, month = '2026-10') =>
    request(t.kit.server)
      .get(`/api/portal/children/${studentId}/announcements?month=${month}`)
      .set('Cookie', cookie);

  const news = (audience: object, readers: { forStaff?: boolean; forParents?: boolean } = {}) => ({
    kind: 'news',
    title: 'Sports day',
    body: 'All classes meet in the yard <at 9> *sharp*.',
    event: null,
    audience,
    forStaff: readers.forStaff ?? true,
    forParents: readers.forParents ?? true,
  });
  const event = (audience: object, readers: { forStaff?: boolean; forParents?: boolean } = {}) => ({
    ...news(audience, readers),
    kind: 'event',
    title: 'Open doors',
    event: {
      firstDate: '2026-10-20',
      lastDate: '2026-10-21',
      startsAt: '09:00',
      endsAt: '12:30',
      place: 'Main hall',
    },
  });

  const made = async (
    branch: string,
    body: object,
    cookie: string,
  ): Promise<{ id: string; version: number }> => {
    const response = await create(branch, body, cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const one = announcementSchema.parse(response.body);
    return { id: one.id, version: one.version };
  };

  const titlesOf = (response: Response): string[] =>
    announcementMonthSchema.parse(response.body).announcements.map((one) => one.id);

  /** Every row of the tables the routes write, and the audit count: what a refusal leaves. */
  const rows = async () => ({
    announcements: await t.database.migrator
      .selectFrom('announcements')
      .selectAll()
      .orderBy('id')
      .execute(),
    classes: await t.database.migrator
      .selectFrom('announcement_classes')
      .selectAll()
      .orderBy('announcement_id')
      .orderBy('class_id')
      .execute(),
    deliveries: await t.database.migrator
      .selectFrom('announcement_deliveries')
      .selectAll()
      .orderBy('id')
      .execute(),
    audit: await t.auditCount(),
    school: (await t.database.migrator.selectFrom('audit_log_school').select('id').execute())
      .length,
  });

  const delivery = () => t.app.get(AnnouncementDelivery);
  /** The fan-out of an announcement, then the tick and the send of every delivery it made due. */
  const send = async (announcementId: string) => {
    await delivery().fanOut(announcementId);
    await deliverDue();
  };
  const deliverDue = async () => {
    const due = await t.database.migrator
      .selectFrom('announcement_deliveries')
      .select('id')
      .where('status', '=', 'due')
      .orderBy('id')
      .execute();
    for (const one of due) await delivery().deliver(one.id);
  };
  const deliveriesOf = (announcementId: string) =>
    t.database.migrator
      .selectFrom('announcement_deliveries')
      .select(['account_id', 'status', 'attempts'])
      .where('announcement_id', '=', announcementId)
      .orderBy('account_id')
      .execute();
  const toChat = (chat: string) => sent.filter((one) => one.chat === chat);

  /** A signed-in browser with a role, made at the clock's present moment. */
  const roleSession = async (
    first: string,
    last: string,
    role:
      | 'principal'
      | 'spiritual_vice_principal'
      | 'head_tutor'
      | 'head_teacher'
      | 'senior_head_teacher'
      | 'nurse',
    branch: string | null,
  ): Promise<string> => {
    const browser = await t.kit.fullSession(first, last);
    await t.kit.giveRole(browser.account.id, branch === null ? { role } : { role, branchId: branch });
    return browser.cookie;
  };

  const linked = async (relativeId: string) => {
    const session = await parents.session(relativeId);
    nextChat += 1;
    await t.database.migrator
      .insertInto('telegram_links')
      .values({
        account_id: session.account.id,
        telegram_user_id: String(nextChat),
        linked_at: new Date('2026-10-01T10:00:00+05:00'),
      })
      .execute();
    return { accountId: session.account.id, cookie: session.cookie, chat: String(nextChat) };
  };

  beforeAll(async () => {
    t = await dayTemplatesKit({
      jobs: true,
      telegramFetch: fakeFetch,
      config: {
        telegram: {
          botToken: TEST_BOT_TOKEN,
          webhookSecret: TEST_WEBHOOK_SECRET,
          webOrigin: 'https://app.example.test',
        },
      },
    });
    load = new LoadKit(t.database.migrator);
    parents = new ParentsKit(t.app, t.database.migrator, await load.classes.account());
    teacherAccount = await t.kit.newAccount('Otabek', 'Yusupov');
    a = await publishedScene(t, load, { accounts: { teacher: teacherAccount.id } });
    b = await publishedScene(t, load);

    const first = await parents.student(a.branch);
    childA = first.studentId;
    await parents.members.member({
      branch: a.branch,
      classId: a.classId,
      studentId: childA,
      from: '2026-09-01',
    });
    siblingA = await parents.childOf(a.branch, first.relativeId);
    await parents.members.member({
      branch: a.branch,
      classId: a.otherClass,
      studentId: siblingA,
      from: '2026-09-01',
    });
    const second = await parents.student(b.branch);
    childB = second.studentId;
    await parents.members.member({
      branch: b.branch,
      classId: b.classId,
      studentId: childB,
      from: '2026-09-01',
    });
    const third = await parents.student(a.branch);
    otherFamily = third.studentId;
    await parents.members.member({
      branch: a.branch,
      classId: a.classId,
      studentId: otherFamily,
      from: '2026-09-01',
    });

    // The load of the scenes is in force from Monday 12 October: every session is made after.
    t.clock.set(NOW);
    const admin = await t.kit.completeSession('Nodira', 'Qodirova');
    await t.kit.giveRole(admin.account.id, { role: 'super_admin' });
    const vice = await t.kit.completeSession('Sardor', 'Tursunov');
    await t.kit.giveRole(vice.account.id, { role: 'academic_vice_principal', branchId: a.branch });
    const viceB = await t.kit.completeSession('Gulnora', 'Ismoilova');
    await t.kit.giveRole(viceB.account.id, { role: 'academic_vice_principal', branchId: b.branch });
    const signed = await t.kit.signIn(teacherAccount.login, teacherAccount.firstPassword);
    const teacherCookie = cookieOf(signed) ?? '';
    await t.kit.changePassword(teacherCookie, teacherAccount.firstPassword, NEW_PASSWORD);
    await t.kit.giveRole(teacherAccount.id, { role: 'teacher', branchId: a.branch });
    const tutor = await t.kit.fullSession('Rustam', 'Karimov');
    await load.classes.person(a.branch, ['uz'], { accountId: tutor.account.id });
    await load.tutorOf(a.branch, a.otherClass, tutor.account.id);
    cookies = {
      admin: admin.cookie,
      vice: vice.cookie,
      viceB: viceB.cookie,
      spiritual: await roleSession('Madina', 'Xolmatova', 'spiritual_vice_principal', a.branch),
      principal: await roleSession('Anvar', 'Sobirov', 'principal', a.branch),
      headTutor: await roleSession('Lola', 'Rasulova', 'head_tutor', a.branch),
      headTeacher: await roleSession('Hamid', 'Nazarov', 'head_teacher', a.branch),
      seniorHeadTeacher: await roleSession('Komil', 'Azimov', 'senior_head_teacher', null),
      nurse: await roleSession('Zarina', 'Umarova', 'nurse', a.branch),
      teacher: teacherCookie,
      tutor: tutor.cookie,
    };
    motherA = { ...(await linked(first.relativeId)), relativeId: first.relativeId };
    fatherB = await linked(second.relativeId);
    otherParent = (await parents.session(third.relativeId)).cookie;
  }, 240_000);

  afterAll(async () => {
    t.clock.set(START);
    await t.close();
  });

  describe('the authors', () => {
    it('publishes news for the branch, with an audit entry and the bot messages enqueued', async () => {
      const before = await t.auditCount();
      const response = await create(a.branch, news({ kind: 'branch' }), cookies.vice);
      expect(response.status).toBe(201);
      const one = announcementSchema.parse(response.body);
      expect(one).toMatchObject({
        kind: 'news',
        title: 'Sports day',
        audience: { kind: 'branch' },
        schoolWide: false,
        canChange: true,
        version: 1,
        archived: false,
        publishedAt: new Date(NOW).toISOString(),
      });
      expect(await t.auditCount()).toBe(before + 1);
      const [entry] = await t.entries('announcement.create', one.id);
      expect(entry?.branch_id).toBe(a.branch);
      const jobs = (await storedJobs(t.database.migrator)).filter(
        (job) => job.name === 'announcements.fan_out',
      );
      expect(jobs.map((job) => JSON.stringify(job.data))).toEqual(
        expect.arrayContaining([expect.stringContaining(one.id)]),
      );
    });

    it('lets the Super Admin write for the whole school, and refuses that to the two Vice Principals', async () => {
      const school = await made(a.branch, news({ kind: 'school' }), cookies.admin);
      const row = await t.database.migrator
        .selectFrom('announcements')
        .select('branch_id')
        .where('id', '=', school.id)
        .executeTakeFirstOrThrow();
      expect(row.branch_id).toBeNull();
      const entry = await t.database.migrator
        .selectFrom('audit_log_school')
        .select('action')
        .where('record_id', '=', school.id)
        .executeTakeFirst();
      expect(entry?.action).toBe('announcement.create');
      const before = await rows();
      for (const cookie of [cookies.vice, cookies.spiritual]) {
        expect(codeOf(await create(a.branch, news({ kind: 'school' }), cookie))).toBe(
          'announcement_school_only',
        );
      }
      expect(await rows()).toEqual(before);
    });

    it('refuses edit, archive and restore of a whole-school one to the two Vice Principals', async () => {
      const school = await made(a.branch, news({ kind: 'school' }), cookies.admin);
      const archivedOne = await made(a.branch, news({ kind: 'school' }), cookies.admin);
      const archived = await t.post(
        `/api/announcements/${archivedOne.id}/archive`,
        a.branch,
        { version: 1 },
        cookies.admin,
      );
      expect(archived.status).toBe(200);
      const before = await rows();
      for (const cookie of [cookies.vice, cookies.spiritual]) {
        const edit = await t.put(
          `/api/announcements/${school.id}`,
          a.branch,
          { title: 'Changed', body: 'Changed', event: null, version: 1 },
          cookie,
        );
        expect(codeOf(edit)).toBe('announcement_school_only');
        const archive = await t.post(
          `/api/announcements/${school.id}/archive`,
          a.branch,
          { version: 1 },
          cookie,
        );
        expect(codeOf(archive)).toBe('announcement_school_only');
        const restore = await t.post(
          `/api/announcements/${archivedOne.id}/restore`,
          a.branch,
          { version: 2 },
          cookie,
        );
        expect(codeOf(restore)).toBe('announcement_school_only');
      }
      expect(await rows()).toEqual(before);
      // The authors' list shows it, not to be changed.
      const shown = announcementListSchema.parse((await list(a.branch, cookies.vice)).body);
      expect(shown.mayWriteSchool).toBe(false);
      expect(shown.announcements.find((one) => one.id === school.id)?.canChange).toBe(false);
    });

    it('writes for grades and classes of the branch; another branch’s or an unknown class is 404', async () => {
      const grades = await made(
        a.branch,
        news({ kind: 'grades', grades: [7, 5] }),
        cookies.spiritual,
      );
      const classes = await made(
        a.branch,
        event({ kind: 'classes', classIds: [a.classId] }),
        cookies.vice,
      );
      const shown = announcementListSchema.parse((await list(a.branch, cookies.vice)).body);
      expect(shown.announcements.find((one) => one.id === grades.id)?.audience).toEqual({
        kind: 'grades',
        grades: [5, 7],
      });
      const audience = shown.announcements.find((one) => one.id === classes.id)?.audience;
      expect(audience?.kind === 'classes' ? audience.classes.map((one) => one.id) : []).toEqual([
        a.classId,
      ]);
      const before = await rows();
      for (const classId of [b.classId, UNKNOWN]) {
        const response = await create(
          a.branch,
          news({ kind: 'classes', classIds: [classId] }),
          cookies.vice,
        );
        expect(response.status).toBe(404);
        const admin = await create(
          a.branch,
          news({ kind: 'classes', classIds: [classId] }),
          cookies.admin,
        );
        expect(admin.status).toBe(404);
      }
      expect(await rows()).toEqual(before);
    });

    it('refuses an archived class', async () => {
      const archivedClass = await load.classes.schoolClass(a.branch, a.year, {
        grade: 8,
        room: a.room,
      });
      await t.database.migrator
        .updateTable('classes')
        .set({ archived_at: new Date('2026-10-01T09:00:00+05:00') })
        .where('id', '=', archivedClass)
        .execute();
      const before = await rows();
      const response = await create(
        a.branch,
        news({ kind: 'classes', classIds: [archivedClass] }),
        cookies.vice,
      );
      expect(codeOf(response)).toBe('announcement_class_unavailable');
      expect(await rows()).toEqual(before);
    });

    it('edits the text and the dates, refuses a stale version, and keeps the audience', async () => {
      const one = await made(a.branch, event({ kind: 'branch' }), cookies.vice);
      const changed = await t.put(
        `/api/announcements/${one.id}`,
        a.branch,
        {
          title: 'Open doors, new date',
          body: 'Moved by a day.',
          event: {
            firstDate: '2026-10-22',
            lastDate: '2026-10-22',
            startsAt: null,
            endsAt: null,
            place: null,
          },
          version: 1,
        },
        cookies.spiritual,
      );
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      expect(announcementSchema.parse(changed.body)).toMatchObject({
        title: 'Open doors, new date',
        version: 2,
        audience: { kind: 'branch' },
        event: { firstDate: '2026-10-22', lastDate: '2026-10-22', startsAt: null },
      });
      const [entry] = await t.entries('announcement.edit', one.id);
      expect(entry?.old_value).toMatchObject({ title: 'Open doors' });
      const before = await rows();
      const stale = await t.put(
        `/api/announcements/${one.id}`,
        a.branch,
        { title: 'x', body: 'y', event: null, version: 1 },
        cookies.vice,
      );
      expect(codeOf(stale)).toBe('announcement_changed');
      const noDates = await t.put(
        `/api/announcements/${one.id}`,
        a.branch,
        { title: 'x', body: 'y', event: null, version: 2 },
        cookies.vice,
      );
      expect(noDates.status).toBe(400);
      const audience = await t.put(
        `/api/announcements/${one.id}`,
        a.branch,
        { title: 'x', body: 'y', event: null, version: 2, audience: { kind: 'school' } },
        cookies.vice,
      );
      expect(audience.status).toBe(400);
      expect(await rows()).toEqual(before);
    });

    it('answers 404 for another branch’s and an unknown id, the Super Admin included', async () => {
      const inB = await made(b.branch, news({ kind: 'branch' }), cookies.viceB);
      const before = await rows();
      for (const cookie of [cookies.vice, cookies.admin]) {
        for (const id of [inB.id, UNKNOWN]) {
          const edit = await t.put(
            `/api/announcements/${id}`,
            a.branch,
            { title: 'x', body: 'y', event: null, version: 1 },
            cookie,
          );
          expect(edit.status).toBe(404);
          expect(
            (await t.post(`/api/announcements/${id}/archive`, a.branch, { version: 1 }, cookie))
              .status,
          ).toBe(404);
          expect(
            (await t.post(`/api/announcements/${id}/restore`, a.branch, { version: 1 }, cookie))
              .status,
          ).toBe(404);
        }
      }
      expect(await rows()).toEqual(before);
    });

    it('keeps a used key to its account, its branch and its role (request keys)', async () => {
      const key = randomUUID();
      const body = news({ kind: 'branch' }, { forParents: false });
      const first = await create(a.branch, body, cookies.vice, key);
      expect(first.status).toBe(201);
      const again = await create(a.branch, body, cookies.vice, key);
      expect(again.status).toBe(201);
      expect(announcementSchema.parse(again.body).id).toBe(announcementSchema.parse(first.body).id);
      const before = await rows();
      expect(codeOf(await create(a.branch, body, cookies.spiritual, key))).toBe(
        'request_key_reused',
      );
      // A repeat with another branch's or an unknown class is 404, and from a refused role 403.
      for (const classId of [b.classId, UNKNOWN]) {
        const response = await create(
          a.branch,
          news({ kind: 'classes', classIds: [classId] }),
          cookies.vice,
          key,
        );
        expect(response.status).toBe(404);
      }
      expect((await create(a.branch, body, cookies.principal, key)).status).toBe(403);
      expect(await rows()).toEqual(before);
    });

    it('archives with the messages still due withdrawn, and restores sending nothing again', async () => {
      const one = await made(a.branch, news({ kind: 'branch' }), cookies.vice);
      await delivery().fanOut(one.id);
      expect((await deliveriesOf(one.id)).map((row) => row.status)).toEqual(['due']);
      const archived = await t.post(
        `/api/announcements/${one.id}/archive`,
        a.branch,
        { version: 1 },
        cookies.vice,
      );
      expect(announcementSchema.parse(archived.body).archived).toBe(true);
      expect((await deliveriesOf(one.id)).map((row) => row.status)).toEqual(['withdrawn']);
      const [entry] = await t.entries('announcement.archive', one.id);
      expect(entry?.details).toEqual({ withdrawn: 1 });
      const restored = await t.post(
        `/api/announcements/${one.id}/restore`,
        a.branch,
        { version: 2 },
        cookies.vice,
      );
      expect(announcementSchema.parse(restored.body).archived).toBe(false);
      await deliverDue();
      expect((await deliveriesOf(one.id)).map((row) => row.status)).toEqual(['withdrawn']);
      const archivedList = announcementListSchema.parse(
        (await list(a.branch, cookies.vice, true)).body,
      );
      expect(archivedList.announcements.some((row) => row.id === one.id)).toBe(false);
    });

    it('refuses every write to the Principal, the Head Tutor and a Teacher, writing nothing', async () => {
      const one = await made(a.branch, news({ kind: 'branch' }), cookies.vice);
      const before = await rows();
      for (const cookie of [cookies.principal, cookies.headTutor, cookies.teacher]) {
        expect((await create(a.branch, news({ kind: 'branch' }), cookie)).status).toBe(403);
        expect(
          (
            await t.put(
              `/api/announcements/${one.id}`,
              a.branch,
              { title: 'x', body: 'y', event: null, version: 1 },
              cookie,
            )
          ).status,
        ).toBe(403);
        expect(
          (await t.post(`/api/announcements/${one.id}/archive`, a.branch, { version: 1 }, cookie))
            .status,
        ).toBe(403);
        expect((await list(a.branch, cookie)).status).toBe(403);
      }
      expect(await rows()).toEqual(before);
    });
  });

  describe('what is addressed to staff (plan decision 4)', () => {
    let forBranch: string;
    let forClassA: string;
    let forOtherClass: string;
    let forGrade5: string;
    let forGrade7: string;
    let parentsOnly: string;
    let school: string;
    let inB: string;

    beforeAll(async () => {
      forBranch = (await made(a.branch, news({ kind: 'branch' }), cookies.vice)).id;
      forClassA = (
        await made(a.branch, event({ kind: 'classes', classIds: [a.classId] }), cookies.vice)
      ).id;
      forOtherClass = (
        await made(a.branch, news({ kind: 'classes', classIds: [a.otherClass] }), cookies.vice)
      ).id;
      forGrade5 = (await made(a.branch, news({ kind: 'grades', grades: [5] }), cookies.vice)).id;
      forGrade7 = (await made(a.branch, news({ kind: 'grades', grades: [7] }), cookies.vice)).id;
      parentsOnly = (
        await made(a.branch, news({ kind: 'branch' }, { forStaff: false }), cookies.vice)
      ).id;
      school = (await made(a.branch, news({ kind: 'school' }), cookies.admin)).id;
      inB = (await made(b.branch, news({ kind: 'branch' }), cookies.viceB)).id;
    });

    it('shows a Teacher the classes of the load in force and their grades, not another class', async () => {
      const ids = titlesOf(await feed(a.branch, cookies.teacher));
      expect(ids).toEqual(expect.arrayContaining([forBranch, forClassA, forGrade7, school]));
      for (const id of [forOtherClass, forGrade5, parentsOnly, inB]) expect(ids).not.toContain(id);
    });

    it('shows the Tutor the own class', async () => {
      const ids = titlesOf(await feed(a.branch, cookies.tutor));
      expect(ids).toEqual(expect.arrayContaining([forBranch, forOtherClass, forGrade7, school]));
      expect(ids).not.toContain(forClassA);
    });

    it('shows the Principal, the Head Tutor and the Spiritual VP every class and grade of the branch', async () => {
      for (const cookie of [cookies.principal, cookies.headTutor, cookies.spiritual]) {
        const ids = titlesOf(await feed(a.branch, cookie));
        expect(ids).toEqual(
          expect.arrayContaining([
            forBranch,
            forClassA,
            forOtherClass,
            forGrade5,
            forGrade7,
            school,
          ]),
        );
        expect(ids).not.toContain(parentsOnly);
        expect(ids).not.toContain(inB);
      }
    });

    it('shows a Head Teacher and a Senior Head Teacher without load of the class, and a Nurse, the school and branch items only', async () => {
      for (const cookie of [cookies.headTeacher, cookies.seniorHeadTeacher, cookies.nurse]) {
        const ids = titlesOf(await feed(a.branch, cookie));
        expect(ids).toEqual(expect.arrayContaining([forBranch, school]));
        for (const id of [forClassA, forOtherClass, forGrade5, forGrade7])
          expect(ids).not.toContain(id);
      }
    });

    it('shows news of the month and events touching it, and refuses a misspelled field', async () => {
      expect(titlesOf(await feed(a.branch, cookies.principal, '2026-11'))).not.toContain(forBranch);
      const month = announcementMonthSchema.parse((await feed(a.branch, cookies.principal)).body);
      expect(month.today).toBe('2026-10-13');
      expect(month.announcements.find((one) => one.id === forClassA)?.event?.place).toBe(
        'Main hall',
      );
      expect(
        (await t.get('/api/announcements-feed?mont=2026-10', a.branch, cookies.principal)).status,
      ).toBe(400);
    });

    it('refuses the feed to a parent session', async () => {
      expect(
        (await request(t.kit.server).get('/api/announcements-feed').set('Cookie', motherA.cookie))
          .status,
      ).toBe(403);
      expect(
        (await request(t.kit.server).get('/api/announcements').set('Cookie', motherA.cookie))
          .status,
      ).toBe(403);
    });
  });

  describe('the portal (the privacy set of Release 2)', () => {
    let forClassA: string;
    let forGrade7A: string;
    let staffOnly: string;
    let school: string;
    let forB: string;

    beforeAll(async () => {
      forClassA = (
        await made(a.branch, event({ kind: 'classes', classIds: [a.classId] }), cookies.vice)
      ).id;
      forGrade7A = (await made(a.branch, news({ kind: 'grades', grades: [7] }), cookies.vice)).id;
      staffOnly = (
        await made(a.branch, news({ kind: 'branch' }, { forParents: false }), cookies.vice)
      ).id;
      school = (await made(a.branch, news({ kind: 'school' }), cookies.admin)).id;
      forB = (await made(b.branch, news({ kind: 'branch' }), cookies.viceB)).id;
    });

    it('shows a parent what reaches the child, and nothing for staff only or of another branch', async () => {
      const ids = titlesOf(await portal(childA, motherA.cookie));
      expect(ids).toEqual(expect.arrayContaining([forClassA, forGrade7A, school]));
      expect(ids).not.toContain(staffOnly);
      expect(ids).not.toContain(forB);
      // The sibling in the other class of the same grade: the grade item, not the class item.
      const sibling = titlesOf(await portal(siblingA, motherA.cookie));
      expect(sibling).toContain(forGrade7A);
      expect(sibling).not.toContain(forClassA);
    });

    it('does not list a grade-7 item of branch A for a grade-7 child of branch B', async () => {
      const ids = titlesOf(await portal(childB, fatherB.cookie));
      expect(ids).toEqual(expect.arrayContaining([forB, school]));
      expect(ids).not.toContain(forGrade7A);
      expect(ids).not.toContain(forClassA);
    });

    it('answers 404 for another family’s child, a link off, an unlinked relative and a child who left', async () => {
      expect((await portal(otherFamily, motherA.cookie)).status).toBe(404);
      expect((await portal(childA, otherParent)).status).toBe(404);
      expect((await portal(UNKNOWN, motherA.cookie)).status).toBe(404);
      await t.database.migrator
        .updateTable('student_relatives')
        .set({ portal_access: false })
        .where('student_id', '=', siblingA)
        .where('relative_id', '=', motherA.relativeId)
        .execute();
      try {
        expect((await portal(siblingA, motherA.cookie)).status).toBe(404);
      } finally {
        await t.database.migrator
          .updateTable('student_relatives')
          .set({ portal_access: true })
          .where('student_id', '=', siblingA)
          .where('relative_id', '=', motherA.relativeId)
          .execute();
      }
      const leftChild = await parents.childOf(a.branch, motherA.relativeId);
      const leaving = await parents.members.leaving(
        t.database.migrator,
        a.branch,
        leftChild,
        '2026-10-12',
      );
      await parents.members.member({
        branch: a.branch,
        classId: a.classId,
        studentId: leftChild,
        from: '2026-09-01',
        until: '2026-10-12',
        endedBy: 'leaving',
        leavingId: leaving,
      });
      expect((await portal(leftChild, motherA.cookie)).status).toBe(404);
    });

    it('refuses the portal route to every staff session', async () => {
      for (const cookie of [cookies.admin, cookies.vice, cookies.teacher]) {
        expect((await portal(childA, cookie)).status).toBe(403);
      }
    });
  });

  describe('the bot’s messages', () => {
    it('sends one message to each parent reached, in the parent’s language, in plain text', async () => {
      await t.database.migrator
        .updateTable('accounts')
        .set({ language: 'ru' })
        .where('id', '=', motherA.accountId)
        .execute();
      const one = await made(a.branch, event({ kind: 'grades', grades: [7] }), cookies.vice);
      await send(one.id);
      const toMother = toChat(motherA.chat).filter((message) =>
        message.text.includes('Open doors'),
      );
      expect(toMother).toHaveLength(1);
      expect(toMother[0]?.text).toBe(
        [
          'Школа Sodiq: мероприятие',
          '',
          'Open doors',
          '',
          'All classes meet in the yard <at 9> *sharp*.',
          '',
          'Когда: 20.10.2026 – 21.10.2026, 09:00–12:30',
          'Где: Main hall',
        ].join('\n'),
      );
      expect(toMother[0]?.button).toBe('https://app.example.test/portal/telegram?to=announcements');
      // A grade-7 item of branch A does not reach the grade-7 child of branch B.
      expect(toChat(fatherB.chat).filter((message) => message.text.includes('Open doors'))).toEqual(
        [],
      );
      expect((await deliveriesOf(one.id)).map((row) => [row.account_id, row.status])).toEqual([
        [motherA.accountId, 'delivered'],
      ]);
      // Sent once: a second fan-out and a second run send nothing more.
      await send(one.id);
      expect(
        toChat(motherA.chat).filter((message) => message.text.includes('Open doors')),
      ).toHaveLength(1);
    });

    it('holds a message in the quiet hours and sends it when they end', async () => {
      const one = await made(
        a.branch,
        news({ kind: 'classes', classIds: [a.classId] }),
        cookies.vice,
      );
      t.clock.set('2026-10-13T22:30:00+05:00');
      try {
        await send(one.id);
        expect((await deliveriesOf(one.id)).map((row) => row.status)).toEqual(['due']);
        t.clock.set('2026-10-14T08:01:00+05:00');
        await deliverDue();
        expect((await deliveriesOf(one.id)).map((row) => row.status)).toEqual(['delivered']);
      } finally {
        t.clock.set(NOW);
      }
    });

    it('sends nothing to a parent whose child the announcement no longer reaches', async () => {
      const one = await made(
        a.branch,
        news({ kind: 'classes', classIds: [a.classId] }),
        cookies.vice,
      );
      await delivery().fanOut(one.id);
      await t.database.migrator
        .updateTable('student_relatives')
        .set({ receives_notices: false })
        .where('student_id', '=', childA)
        .where('relative_id', '=', motherA.relativeId)
        .execute();
      try {
        const before = sent.length;
        await deliverDue();
        expect((await deliveriesOf(one.id)).map((row) => row.status)).toEqual(['out_of_scope']);
        expect(sent.length).toBe(before);
      } finally {
        await t.database.migrator
          .updateTable('student_relatives')
          .set({ receives_notices: true })
          .where('student_id', '=', childA)
          .where('relative_id', '=', motherA.relativeId)
          .execute();
      }
    });

    it('marks a chat that blocked the bot, and tries again when Telegram does not answer', async () => {
      const one = await made(
        a.branch,
        news({ kind: 'classes', classIds: [a.classId] }),
        cookies.vice,
      );
      await delivery().fanOut(one.id);
      answer = { ok: false, status: 502 };
      try {
        await deliverDue();
        expect(await deliveriesOf(one.id)).toEqual([
          { account_id: motherA.accountId, status: 'due', attempts: 1 },
        ]);
        // The next try is a minute later; the tick enqueues it then.
        t.clock.set('2026-10-13T10:01:30+05:00');
        answer = { ok: false, status: 403 };
        await deliverDue();
        expect((await deliveriesOf(one.id)).map((row) => row.status)).toEqual(['blocked']);
        const link = await t.database.migrator
          .selectFrom('telegram_links')
          .select('bot_blocked_at')
          .where('account_id', '=', motherA.accountId)
          .where('ended_at', 'is', null)
          .executeTakeFirstOrThrow();
        expect(link.bot_blocked_at).not.toBeNull();
      } finally {
        answer = { ok: true, status: 200 };
        t.clock.set(NOW);
        await t.database.migrator
          .updateTable('telegram_links')
          .set({ bot_blocked_at: null })
          .where('account_id', '=', motherA.accountId)
          .execute();
      }
    });

    // Plan decision 13: the reader of the deliveries.
    it("lists the account's messages in the personal data report of the relative, and no other's", async () => {
      // A whole-school one reaches both families: the father's message is not the mother's.
      await delivery().fanOut((await made(a.branch, news({ kind: 'school' }), cookies.admin)).id);
      const response = await t.post(
        `/api/people/relatives/${motherA.relativeId}/report`,
        a.branch,
        {},
        cookies.admin,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const listed = relativeReportSchema.parse(response.body).relative.account?.announcementDeliveries ?? [];
      const own = await t.database.migrator
        .selectFrom('announcement_deliveries')
        .select('id')
        .where('account_id', '=', motherA.accountId)
        .execute();
      expect(listed).toHaveLength(own.length);
      expect(listed.length).toBeGreaterThan(0);
      expect(listed.map((one) => one.status)).toContain('delivered');
      const others = await t.database.migrator
        .selectFrom('announcement_deliveries')
        .select('id')
        .where('account_id', '!=', motherA.accountId)
        .execute();
      expect(others.length).toBeGreaterThan(0);
    });

    it('writes no delivery for an announcement for staff only, nor for a parent without a chat', async () => {
      const staff = await made(
        a.branch,
        news({ kind: 'branch' }, { forParents: false }),
        cookies.vice,
      );
      await delivery().fanOut(staff.id);
      expect(await deliveriesOf(staff.id)).toEqual([]);
      const branch = await made(
        a.branch,
        news({ kind: 'classes', classIds: [a.classId] }),
        cookies.vice,
      );
      await delivery().fanOut(branch.id);
      // The other family of class A has no Telegram link: only the mother's row.
      expect((await deliveriesOf(branch.id)).map((row) => row.account_id)).toEqual([
        motherA.accountId,
      ]);
    });
  });
});
