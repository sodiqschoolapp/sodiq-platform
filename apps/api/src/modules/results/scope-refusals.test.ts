import {
  BRANCH_HEADER,
  earlyWarningListSchema,
  ratingChoicesSchema,
  studentAttendanceSchema,
  studentResultsSchema,
  studentResultTabsSchema,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { binary } from '../../testing/xlsx-kit.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

/** The error code, also of an answer read as a file (the export's posts parse every body as bytes). */
const codeOf = (response: Response): unknown => {
  const body: unknown = Buffer.isBuffer(response.body)
    ? JSON.parse(response.body.toString('utf8'))
    : response.body;
  return (body as { error?: { code?: string } }).error?.code;
};

const refused = (response: Response, label: string) => {
  expect(response.status, `${label} ${JSON.stringify(response.body).slice(0, 300)}`).toBe(403);
  expect(codeOf(response), label).toBe('permission_denied');
};

// All names are invented. Task 10.3a: the limits inside the results routes that the role
// harness cannot see (docs/spec/02-roles-and-access.md, Rules: "Every role is limited to a
// branch, and where it applies to subjects, a class or own lessons. ... The limit is enforced
// on the server"; Scope: "For own subjects in own branch: journals, lesson plans, groups, the
// early-warning list"). Each test reads a case inside the limit too, so that it fails if the
// route's own check goes.
describe('the limits inside the results routes', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Sabina', `Rashidova${'a'.repeat(names % 7)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };
  type Call = {
    get: (path: string) => Promise<Response>;
    post: (path: string, body: object) => Promise<Response>;
  };

  async function as<T>(
    browser: Browser,
    roles: readonly Omit<Held, 'validFrom'>[],
    work: (call: Call) => Promise<T>,
  ): Promise<T> {
    for (const held of roles) {
      await t.kit.giveRole(browser.account.id, {
        ...held,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
    }
    t.clock.set(MOMENT);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
        .where('account_id', '=', browser.account.id)
        .execute();
      return await work({
        get: (path) => t.get(path, s.branch, browser.cookie),
        post: (path, body) =>
          request(t.kit.server)
            .post(path)
            .set('Cookie', browser.cookie)
            .set(BRANCH_HEADER, s.branch)
            .buffer(true)
            .parse(binary)
            .send(body),
      });
    } finally {
      t.clock.set(START);
    }
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

  const tutorOf = async (classId: string): Promise<Browser> => {
    const browser = await account();
    await load.classes.person(s.branch, ['uz'], { accountId: browser.account.id });
    await load.tutorOf(s.branch, classId, browser.account.id);
    return browser;
  };

  const journalOf = async (classId: string) =>
    (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', classId)
        .where('subject_id', '=', s.subject)
        .executeTakeFirstOrThrow()
    ).id;

  const auditOf = async (action: string) =>
    Number(
      (
        await t.database.migrator
          .selectFrom('audit_log')
          .select((eb) => eb.fn.countAll().as('count'))
          .where('action', '=', action)
          .where('branch_id', '=', s.branch)
          .executeTakeFirstOrThrow()
      ).count,
    );

  const handledRows = () =>
    t.database.migrator
      .selectFrom('early_warning_handled')
      .selectAll()
      .where('branch_id', '=', s.branch)
      .orderBy('id')
      .execute();

  let s: PublishedScene;
  /** Owner of the first class's journal of the subject. */
  let owner: Browser;
  /** In the first class: absent at the three Mondays, five classworks of 1 of 10 on the 12th. */
  let anvar: string;
  let q1: string;
  let journal: string;
  let otherJournal: string;
  let elsewhere: string;
  /** The Tutor of the first class, and of the other class. */
  let ownTutor: Browser;
  let otherTutor: Browser;
  /** The Head Teacher and the Senior Head Teacher of the subject, and of another one. */
  let headOwn: Browser;
  let headOther: Browser;
  let seniorOwn: Browser;
  let seniorOther: Browser;

  const holding = async (held: Omit<Held, 'validFrom'>): Promise<Browser> => {
    const browser = await account();
    await t.kit.giveRole(browser.account.id, {
      ...held,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    return browser;
  };

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    owner = await account();
    s = await publishedScene(t, load, { graded: true, accounts: { teacher: owner.account.id } });
    elsewhere = await load.classes.subject({ grades: [7] });
    ownTutor = await tutorOf(s.classId);
    otherTutor = await tutorOf(s.otherClass);
    headOwn = await holding({ role: 'head_teacher', branchId: s.branch, subjectIds: [s.subject] });
    headOther = await holding({
      role: 'head_teacher',
      branchId: s.branch,
      subjectIds: [elsewhere],
    });
    seniorOwn = await holding({ role: 'senior_head_teacher', subjectIds: [s.subject] });
    seniorOther = await holding({ role: 'senior_head_teacher', subjectIds: [elsewhere] });
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    anvar = await members.student(s.branch, { startsOn: '2026-09-01', grade: 7 });
    await members.member({
      branch: s.branch,
      classId: s.classId,
      studentId: anvar,
      from: '2026-09-01',
    });
    const lessons = (
      await t.database.migrator
        .selectFrom('lessons')
        .select(['id', sql<string>`lesson_date::text`.as('date')])
        .where('class_id', '=', s.classId)
        .where('lesson_date', '<=', '2026-10-31')
        .orderBy('starts_at')
        .execute()
    ).map((one) => ({ id: one.id, date: one.date }));
    const [l12] = lessons;
    if (l12 === undefined || lessons.length < 3) throw new Error('The three Mondays.');
    const works: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      works.push(
        (
          await t.database.migrator
            .insertInto('journal_works')
            .values({ branch_id: s.branch, lesson_id: l12.id, kind: 'classwork', total: 10 })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id,
      );
    }
    await saveOn(l12.date, [
      { lessonId: l12.id, studentId: anvar, value: 0 },
      ...works.map((workId) => ({ lessonId: l12.id, studentId: anvar, workId, value: 1 })),
    ]);
    for (const lesson of lessons.slice(1, 3)) {
      await saveOn(lesson.date, [{ lessonId: lesson.id, studentId: anvar, value: 0 }]);
    }
    q1 = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', s.year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;
    journal = await journalOf(s.classId);
    otherJournal = await journalOf(s.otherClass);
  });

  afterAll(async () => {
    await t.close();
  });

  const base = () => `/api/results/students/${anvar}`;
  const lessonsPath = () => `${base()}/lessons?subjectId=${s.subject}&quarterId=${q1}`;

  describe('the student results (08, Student results; task 9.1, decision 4)', () => {
    it('leaves every subject out for a Senior Head Teacher of another subject, and refuses its lessons', async () => {
      // Inside the limit: the Senior Head Teacher of the subject reads it.
      await as(seniorOwn, [], async ({ get }) => {
        const read = await get(base());
        expect(read.status, JSON.stringify(read.body).slice(0, 300)).toBe(200);
        expect(studentResultsSchema.parse(read.body).subjects).toHaveLength(1);
        expect((await get(lessonsPath())).status).toBe(200);
      });
      await as(seniorOther, [], async ({ get }) => {
        const read = await get(base());
        expect(read.status, JSON.stringify(read.body).slice(0, 300)).toBe(200);
        expect(studentResultsSchema.parse(read.body).subjects).toEqual([]);
        const attendance = await get(`${base()}/attendance`);
        expect(attendance.status).toBe(200);
        expect(studentAttendanceSchema.parse(attendance.body).subjects).toEqual([]);
        expect(studentResultTabsSchema.parse((await get(`${base()}/tabs`)).body)).toEqual({
          results: false,
          attendance: false,
        });
        refused(await get(lessonsPath()), 'lessons');
      });
    });

    it('refuses the Tutor of another class the results, tabs, attendance and lessons of the student', async () => {
      // Inside the limit: the Tutor of the student's class.
      await as(ownTutor, [], async ({ get }) => {
        for (const path of [base(), `${base()}/tabs`, `${base()}/attendance`, lessonsPath()]) {
          expect((await get(path)).status, path).toBe(200);
        }
      });
      await as(otherTutor, [], async ({ get }) => {
        for (const path of [base(), `${base()}/tabs`, `${base()}/attendance`, lessonsPath()]) {
          refused(await get(path), path);
        }
      });
    });
  });

  describe('the rating (08, Rating; task 9.3a, decisions 1 and 4)', () => {
    const subjectPath = (journalId: string) =>
      `/api/results/rating/subject?quarterId=${q1}&journalId=${journalId}`;
    const classPath = (classId: string) =>
      `/api/results/rating/class?quarterId=${q1}&classId=${classId}`;

    it('leaves the journals of another subject out of the choices of a Head Teacher and a Senior Head Teacher', async () => {
      const choicesOf = async (browser: Browser) =>
        as(browser, [], async ({ get }) => {
          const response = await get('/api/results/rating/choices');
          expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
          return ratingChoicesSchema.parse(response.body);
        });
      for (const [role, inside, outside] of [
        ['head_teacher', headOwn, headOther],
        ['senior_head_teacher', seniorOwn, seniorOther],
      ] as const) {
        const own = await choicesOf(inside);
        expect(own.journals.map((one) => one.id).sort(), role).toEqual(
          [journal, otherJournal].sort(),
        );
        const other = await choicesOf(outside);
        expect(other.journals, role).toEqual([]);
        expect(other.classes, role).toEqual([]);
        expect(other.classesList, role).toBe(false);
      }
    });

    it('refuses a Senior Head Teacher of another subject the subject list, and every Senior Head Teacher the class list', async () => {
      await as(seniorOwn, [], async ({ get }) => {
        expect((await get(subjectPath(journal))).status).toBe(200);
        refused(await get(classPath(s.classId)), 'class');
      });
      await as(seniorOther, [], async ({ get }) => {
        refused(await get(subjectPath(journal)), 'subject');
      });
    });

    it('refuses an export outside the scope of the Tutor, the Teacher and both Head Teachers, logging nothing', async () => {
      const before = await auditOf('rating.export');
      await as(otherTutor, [], async ({ post }) => {
        refused(
          await post('/api/results/rating/export', {
            kind: 'class',
            quarterId: q1,
            classId: s.classId,
          }),
          'tutor class',
        );
        refused(
          await post('/api/results/rating/export', {
            kind: 'subject',
            quarterId: q1,
            journalId: journal,
          }),
          'tutor subject',
        );
      });
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        refused(
          await post('/api/results/rating/export', {
            kind: 'subject',
            quarterId: q1,
            journalId: otherJournal,
          }),
          'teacher',
        );
      });
      await as(headOther, [], async ({ post }) => {
        refused(
          await post('/api/results/rating/export', {
            kind: 'subject',
            quarterId: q1,
            journalId: journal,
          }),
          'head teacher',
        );
      });
      await as(seniorOther, [], async ({ post }) => {
        refused(
          await post('/api/results/rating/export', {
            kind: 'subject',
            quarterId: q1,
            journalId: journal,
          }),
          'senior subject',
        );
        refused(
          await post('/api/results/rating/export', {
            kind: 'class',
            quarterId: q1,
            classId: s.classId,
          }),
          'senior class',
        );
      });
      expect(await auditOf('rating.export')).toBe(before);
      // Inside the limit: the owner exports the own journal, with one entry.
      await as(owner, [], async ({ post }) => {
        const response = await post('/api/results/rating/export', {
          kind: 'subject',
          quarterId: q1,
          journalId: journal,
        });
        expect(response.status).toBe(200);
      });
      expect(await auditOf('rating.export')).toBe(before + 1);
    });
  });

  describe('the early-warning list (08, Early-warning list; task 9.4a, decisions 1 and 7)', () => {
    it('leaves every entry out for a Senior Head Teacher of another subject', async () => {
      const listed = async (browser: Browser) =>
        as(browser, [], async ({ get }) => {
          const response = await get('/api/results/early-warning');
          expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
          return earlyWarningListSchema.parse(response.body).entries.map((one) => one.student.id);
        });
      expect(await listed(seniorOwn)).toEqual([anvar]);
      expect(await listed(seniorOther)).toEqual([]);
    });

    it('refuses the Tutor of another class the mark handled, writing nothing', async () => {
      const body = {
        quarterId: q1,
        studentId: anvar,
        subjectId: s.subject,
        reason: 'low_attendance',
        note: 'Spoke to the parents.',
      };
      const rows = await handledRows();
      const entries = await auditOf('early_warning.handled');
      await as(otherTutor, [], async ({ post }) => {
        refused(await post('/api/results/early-warning/handled', body), 'other tutor');
      });
      expect(await handledRows()).toEqual(rows);
      expect(await auditOf('early_warning.handled')).toBe(entries);
      // Inside the limit: the Tutor of the student's class marks it.
      await as(ownTutor, [], async ({ post }) => {
        const response = await post('/api/results/early-warning/handled', body);
        expect(response.status).toBe(201);
      });
      expect(await handledRows()).toHaveLength(rows.length + 1);
    });
  });
});
