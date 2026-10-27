import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  exemptionsTodaySchema,
  journalExportListSchema,
  journalExportRequestedSchema,
  journalUnlockSchema,
  journalUnlocksSchema,
  remindersSchema,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setEditDays } from '../../testing/branch-filter-sql.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';

/** Tuesday 27 October 2026, noon in Tashkent: with 7 edit days the Mondays 12 and 19 October are locked, the 26th is open. */
const MOMENT = '2026-10-27T12:00:00+05:00';
/** Monday 9 November 2026, noon: the first Monday of quarter 2. */
const MONDAY_AFTER = '2026-11-09T12:00:00+05:00';

const VALID_FROM = new Date('2026-09-01T00:00:00+05:00');

/**
 * Every table a journal route writes in a branch. `journal_save_refusals` is left out on
 * purpose: a refused save writes its refusal there by design (task 8.9, decision 7).
 */
const WRITTEN = [
  'journal_cells',
  'journal_cell_history',
  'journal_works',
  'journal_work_history',
  'journal_optional_cells',
  'journal_comments',
  'journal_comment_history',
  'journal_rating_exams',
  'journal_rating_entries',
  'journal_rating_history',
  'journal_unlocks',
  'journal_lesson_deliveries',
  'journal_delivery_history',
  'journal_homework_not_given',
  'journal_exports',
  'lesson_plan_items',
  'lesson_plan_requests',
  'notifications',
] as const;

const codeOf = (response: Response): string =>
  (response.body as { error?: { code?: string } }).error?.code ?? `status ${response.status}`;

const ok = (response: Response, status = 200): unknown => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response.body;
};

// All names are invented. Task 10.3a: the limit inside a journal route that the guard cannot
// see (docs/spec/02-roles-and-access.md, Rules: "Every role is limited to a branch, and where it
// applies to subjects, a class or own lessons"; docs/spec/07-journal.md, Who can do what). Each
// test gives the role its assignment in the branch of the request first, so that the refusal
// comes from the route's own check, never from the guard.
describe('the journal routes outside the scope of a role', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Gulnora', `Sattorova${'a'.repeat(names % 7)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };
  interface Calls {
    get: (path: string) => Promise<Response>;
    post: (path: string, body?: object) => Promise<Response>;
    put: (path: string, body: object) => Promise<Response>;
    del: (path: string) => Promise<Response>;
  }

  const give = (browser: Browser, held: Omit<Held, 'validFrom'>) =>
    t.kit.giveRole(browser.account.id, { ...held, validFrom: VALID_FROM });

  /** Runs `work` as the browser in `branch` with the clock at `moment`. */
  async function as<T>(
    browser: Browser,
    branch: string,
    work: (calls: Calls) => Promise<T>,
    moment = MOMENT,
  ): Promise<T> {
    t.clock.set(moment);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
        .where('account_id', '=', browser.account.id)
        .execute();
      const at = (method: 'get' | 'post' | 'put' | 'delete', path: string) =>
        request(t.kit.server)
          [method](path)
          .set('Cookie', browser.cookie)
          .set(BRANCH_HEADER, branch);
      return await work({
        get: (path) => at('get', path),
        post: (path, body = {}) =>
          at('post', path).set(REQUEST_KEY_HEADER, randomUUID()).send(body),
        put: (path, body) => at('put', path).send(body),
        del: (path) => at('delete', path),
      });
    } finally {
      t.clock.set(START);
    }
  }

  /** A student of the class from 1 September. */
  const student = async (branch: string, classId: string, last: string): Promise<string> => {
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const id = await members.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: 'Ali', last_name: last })
      .where('id', '=', id)
      .execute();
    await members.member({ branch, classId, studentId: id, from: '2026-09-01' });
    return id;
  };

  /** A staff record of the browser in the branch (a person who could teach). */
  const staffed = async (browser: Browser, branch: string) =>
    load.classes.person(branch, ['uz'], { accountId: browser.account.id });

  /** A Tutor of the class: the role in the branch from 1 September, a staff record and a Tutor row. */
  async function tutorOf(branch: string, classId: string): Promise<Browser> {
    const browser = await account();
    const assignment = await give(browser, { role: 'tutor', branchId: branch });
    await staffed(browser, branch);
    await load.classes.tutorRow(branch, classId, assignment.id);
    return browser;
  }

  /** A Head Teacher of the subjects in the branch, with a staff record there. */
  async function headOf(branch: string, subjectIds: string[]): Promise<Browser> {
    const browser = await account();
    await give(browser, { role: 'head_teacher', branchId: branch, subjectIds });
    await staffed(browser, branch);
    return browser;
  }

  /** A Senior Head Teacher of the subjects (every branch), with a staff record in the branch. */
  async function seniorOf(branch: string, subjectIds: string[]): Promise<Browser> {
    const browser = await account();
    await give(browser, { role: 'senior_head_teacher', subjectIds });
    await staffed(browser, branch);
    return browser;
  }

  /**
   * The graded scene of 6.2 with 7 edit days and a rating exam: maths of 7th grade on the
   * Mondays at 08:00, owned by its teacher (`owner`); `spare` a teacher of the branch with
   * no lesson of the journal. `first`, `second`, `third` are 12, 19 and 26 October (the first
   * two locked at MOMENT), `fourth` 9 November.
   */
  async function scene() {
    const owner = await account();
    const spare = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id, spare: spare.account.id },
    });
    await setEditDays(t.database.migrator, s.branch, 7);
    await t.database.migrator
      .updateTable('subjects')
      .set({ rating_exam: true })
      .where('id', '=', s.subject)
      .execute();
    await t.database.migrator
      .updateTable('subject_quarter_weights')
      .set({ attendance: 20, classwork: 20, homework: 20, rating_exam: 40 })
      .where('subject_id', '=', s.subject)
      .where('branch_id', '=', s.branch)
      .execute();
    for (const browser of [owner, spare])
      await give(browser, { role: 'teacher', branchId: s.branch });
    const lessons = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('subject_id', '=', s.subject)
        .where('lesson_date', '>=', '2026-10-12')
        .orderBy('starts_at')
        .execute()
    ).map((row) => row.id);
    const [first, second, third, fourth] = lessons;
    if (
      first === undefined ||
      second === undefined ||
      third === undefined ||
      fourth === undefined
    ) {
      throw new Error('The scene has lessons from 12 October on.');
    }
    const journal = await t.database.migrator
      .selectFrom('journals')
      .select('id')
      .where('class_id', '=', s.classId)
      .where('subject_id', '=', s.subject)
      .executeTakeFirstOrThrow();
    const q1 = await t.database.migrator
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', s.year)
      .where('number', '=', 1)
      .executeTakeFirstOrThrow();
    return {
      ...s,
      owner,
      spare,
      first,
      second,
      third,
      fourth,
      journal: journal.id,
      q1: q1.id,
      ahmedov: await student(s.branch, s.classId, 'Ahmedov'),
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /** Every row of the tables the journal routes write in the branch, and the audit log's count. */
  const snapshot = async (branch: string) => {
    const rows: Record<string, unknown[]> = {};
    for (const table of WRITTEN) {
      rows[table] = (
        await sql<{ row: unknown }>`
          select to_jsonb(x) as row from ${sql.table(table)} x
          where x.branch_id = ${branch}::uuid
          order by to_jsonb(x)::text
        `.execute(t.database.migrator)
      ).rows.map((one) => one.row);
    }
    const audit = (
      await sql<{ action: string }>`
        select action from audit_log where branch_id = ${branch}::uuid order by id
      `.execute(t.database.migrator)
    ).rows.map((one) => one.action);
    return { rows, audit };
  };

  /** The owner's request to unlock the lesson of 19 October, sent at MOMENT. */
  const requested = async (s: Scene) =>
    journalUnlockSchema.parse(
      ok(
        await as(s.owner, s.branch, (calls) =>
          calls.post(`/api/journal/lessons/${s.second}/unlocks`, { reason: 'I was ill that week' }),
        ),
        201,
      ),
    );

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the writes of a lesson, its rating exam and its comments', () => {
    /**
     * Every write route of the journal on the open lesson of 26 October (and the unlock of the
     * locked one of the 19th), with a body that passes its schema, and the code its scope
     * refusal answers.
     */
    const writes = (s: Scene, workId: string, homeworkId: string) => {
      const lesson = `/api/journal/lessons/${s.third}`;
      const rating = `/api/journal/journals/${s.journal}/rating/${s.q1}`;
      const column = { workId };
      return [
        [
          'post',
          `${lesson}/attendance`,
          { saves: [{ studentId: s.ahmedov, mark: 1, version: null }] },
          'journal_entry_scope',
        ],
        ['post', `${lesson}/all-present`, {}, 'journal_entry_scope'],
        [
          'post',
          `${lesson}/undo`,
          { students: [{ studentId: s.ahmedov, cells: [{ workId: null, version: 1 }] }] },
          'journal_entry_scope',
        ],
        ['post', `${lesson}/copy-attendance`, {}, 'journal_entry_scope'],
        ['post', `${lesson}/works`, { kind: 'classwork' }, 'journal_entry_scope'],
        ['delete', `${lesson}/works/${workId}`, {}, 'journal_entry_scope'],
        [
          'put',
          `${lesson}/works/total`,
          { column, total: 5, version: null },
          'journal_entry_scope',
        ],
        [
          'put',
          `${lesson}/works/not-held`,
          { column, notHeld: true, version: null },
          'journal_entry_scope',
        ],
        ['post', `${lesson}/works/carry`, { column, version: null }, 'journal_entry_scope'],
        [
          'post',
          `${lesson}/scores`,
          { saves: [{ studentId: s.ahmedov, column, score: 1, version: null }] },
          'journal_entry_scope',
        ],
        ['post', `${lesson}/not-graded`, { workIds: [workId] }, 'journal_entry_scope'],
        ['put', `${lesson}/delivery`, { notDelivered: true, version: null }, 'journal_entry_scope'],
        [
          'put',
          `${lesson}/homework-given`,
          { planWorkIds: [homeworkId], notGiven: true },
          'journal_entry_scope',
        ],
        ['put', `${rating}/date`, { date: '2026-10-26', version: null }, 'rating_exam_scope'],
        ['put', `${rating}/not-held`, { notHeld: true, version: null }, 'rating_exam_scope'],
        [
          'post',
          `${rating}/entries`,
          { studentId: s.ahmedov, entry: { kind: 'did_not_sit' }, reason: null, version: null },
          'rating_exam_scope',
        ],
        [
          'put',
          '/api/journal/comments',
          {
            on: { target: 'note', lessonId: s.third, studentId: s.ahmedov },
            body: 'Not mine',
            visibility: 'staff',
            version: null,
          },
          'comment_scope',
        ],
        [
          'put',
          '/api/journal/comments',
          {
            on: { target: 'rating', journalId: s.journal, quarterId: s.q1, studentId: s.ahmedov },
            body: 'Not mine',
            visibility: 'staff',
            version: null,
          },
          'comment_scope',
        ],
        [
          'post',
          `/api/journal/lessons/${s.second}/unlocks`,
          { reason: 'Not mine' },
          'journal_entry_scope',
        ],
        ['post', `${rating}/unlocks`, { reason: 'Not mine' }, 'rating_exam_scope'],
      ] as const;
    };

    const send = (
      calls: Calls,
      method: 'get' | 'post' | 'put' | 'delete',
      path: string,
      body: object,
    ) =>
      method === 'put'
        ? calls.put(path, body)
        : method === 'delete'
          ? calls.del(path)
          : method === 'get'
            ? calls.get(path)
            : calls.post(path, body);

    /** A hand-added work with a total on the lesson of 26 October, for the routes that name one. */
    /** A homework of a plan item of the journal's quarter 1 (written as the migrator), for "not given". */
    const homeworkOf = async (s: Scene) => {
      const plan = await t.database.migrator
        .selectFrom('lesson_plan_journals')
        .select('plan_id')
        .where('journal_id', '=', s.journal)
        .where('quarter_id', '=', s.q1)
        .executeTakeFirstOrThrow();
      const item = await t.database.migrator
        .insertInto('lesson_plan_items')
        .values({ branch_id: s.branch, plan_id: plan.plan_id, topic: 'Fractions' })
        .returning('id')
        .executeTakeFirstOrThrow();
      return (
        await t.database.migrator
          .insertInto('lesson_plan_works')
          .values({
            branch_id: s.branch,
            item_id: item.id,
            kind: 'homework',
            position: 1,
            title: 'Read',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    };

    const workOn = async (s: Scene) =>
      (
        await t.database.migrator
          .insertInto('journal_works')
          .values({
            branch_id: s.branch,
            lesson_id: s.third,
            source_lesson_id: s.third,
            kind: 'classwork',
            total: 10,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;

    const refusedEverything = async (s: Scene, browser: Browser, who: string) => {
      const workId = await workOn(s);
      const homeworkId = await homeworkOf(s);
      const before = await snapshot(s.branch);
      await as(browser, s.branch, async (calls) => {
        for (const [method, path, body, code] of writes(s, workId, homeworkId)) {
          const refused = await send(calls, method, path, body);
          expect(refused.status, `${who} ${method} ${path}`).toBe(403);
          expect(codeOf(refused), `${who} ${method} ${path}`).toBe(code);
        }
      });
      expect(await snapshot(s.branch)).toEqual(before);
    };

    it('refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing', async () => {
      const s = await scene();
      const tutor = await tutorOf(s.branch, s.classId);
      // The Tutor reads the journal of the own class whole: the refusal is of the entry only.
      await as(tutor, s.branch, async (calls) => {
        ok(await calls.get(`/api/journal/journals/${s.journal}`));
      });
      await refusedEverything(s, tutor, 'tutor');
    });

    it('refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing', async () => {
      const s = await scene();
      await refusedEverything(s, s.spare, 'teacher');
    });

    it('refuses a Head Teacher and a Senior Head Teacher of the subject an unlock of a lesson and of a rating exam they do not teach, writing nothing', async () => {
      const s = await scene();
      const head = await headOf(s.branch, [s.subject]);
      const senior = await seniorOf(s.branch, [s.subject]);
      const before = await snapshot(s.branch);
      for (const [who, browser] of [
        ['head_teacher', head],
        ['senior_head_teacher', senior],
      ] as const) {
        await as(browser, s.branch, async (calls) => {
          // They read the journal of the subject whole: the refusal is of the request only.
          ok(await calls.get(`/api/journal/journals/${s.journal}`));
          const lesson = await calls.post(`/api/journal/lessons/${s.second}/unlocks`, {
            reason: 'Not mine',
          });
          expect(lesson.status, who).toBe(403);
          expect(codeOf(lesson), who).toBe('journal_entry_scope');
          const rating = await calls.post(
            `/api/journal/journals/${s.journal}/rating/${s.q1}/unlocks`,
            { reason: 'Not mine' },
          );
          expect(rating.status, who).toBe(403);
          expect(codeOf(rating), who).toBe('rating_exam_scope');
        });
      }
      expect(await snapshot(s.branch)).toEqual(before);
    });
  });

  describe('unlock requests', () => {
    it('lists, decides and withdraws only own requests and those of own subjects, refusing the rest and writing nothing', async () => {
      const s = await scene();
      const otherSubject = await load.classes.subject({ grades: [7] });
      const subjectHead = await headOf(s.branch, [s.subject]);
      const sent = await requested(s);
      // The request is there to be read: the Head Teacher of the subject decides it.
      await as(subjectHead, s.branch, async (calls) => {
        const list = journalUnlocksSchema.parse(
          ok(await calls.get('/api/journal/unlocks?view=deciding')),
        );
        expect(list.requests.find((one) => one.id === sent.id)?.canDecide).toBe(true);
      });
      const tutor = await tutorOf(s.branch, s.classId);
      const head = await headOf(s.branch, [otherSubject]);
      const senior = await seniorOf(s.branch, [otherSubject]);
      const before = await snapshot(s.branch);
      for (const [who, browser] of [
        ['teacher', s.spare],
        ['tutor', tutor],
        ['head_teacher', head],
        ['senior_head_teacher', senior],
      ] as const) {
        await as(browser, s.branch, async (calls) => {
          for (const view of ['own', 'deciding'] as const) {
            const list = journalUnlocksSchema.parse(
              ok(await calls.get(`/api/journal/unlocks?view=${view}`)),
            );
            expect(
              list.requests.map((one) => one.id),
              `${who} ${view}`,
            ).not.toContain(sent.id);
          }
          const branch = await calls.get('/api/journal/unlocks?view=branch');
          expect(branch.status, who).toBe(403);
          expect(codeOf(branch), who).toBe('journal_unlock_scope');
          const withdrawn = await calls.post(`/api/journal/unlocks/${sent.id}/withdraw`, {
            version: sent.version,
          });
          expect(withdrawn.status, who).toBe(403);
          expect(codeOf(withdrawn), who).toBe('journal_unlock_scope');
          if (who === 'head_teacher' || who === 'senior_head_teacher') {
            const decided = await calls.post(`/api/journal/unlocks/${sent.id}/decide`, {
              decision: 'approve',
              days: 1,
              version: sent.version,
            });
            expect(decided.status, who).toBe(403);
            expect(codeOf(decided), who).toBe('journal_unlock_scope');
          }
        });
      }
      expect(await snapshot(s.branch)).toEqual(before);
    });
  });

  describe('the reads of a role', () => {
    it("gives every role its own reminders only, never the lessons of the journal's teacher", async () => {
      const s = await scene();
      const ofJournal = new Set([s.first, s.second, s.third]);
      const remindedOf = (browser: Browser) =>
        as(browser, s.branch, async (calls) =>
          remindersSchema
            .parse(ok(await calls.get('/api/journal/reminders')))
            .reminders.filter(
              (one) => one.kind !== 'rating_missing' && ofJournal.has(one.lesson.id),
            ),
        );
      // The owner is reminded of the lessons with no attendance.
      expect((await remindedOf(s.owner)).length).toBeGreaterThan(0);
      for (const [who, browser] of [
        ['teacher', s.spare],
        ['tutor', await tutorOf(s.branch, s.classId)],
        ['head_teacher', await headOf(s.branch, [s.subject])],
        ['senior_head_teacher', await seniorOf(s.branch, [s.subject])],
      ] as const) {
        expect(await remindedOf(browser), who).toEqual([]);
      }
    });

    it('refuses a Senior Head Teacher of another subject the history of a cell, of a rating entry and of a comment, and a teacher of another journal the history of a comment', async () => {
      const s = await scene();
      const paths = [
        `/api/journal/lessons/${s.third}/students/${s.ahmedov}/history`,
        `/api/journal/journals/${s.journal}/rating/${s.q1}/students/${s.ahmedov}/history`,
        `/api/journal/comments/history?target=note&studentId=${s.ahmedov}&lessonId=${s.third}`,
      ];
      // The Senior Head Teacher of the subject reads all three.
      const own = await seniorOf(s.branch, [s.subject]);
      await as(own, s.branch, async (calls) => {
        for (const path of paths) ok(await calls.get(path));
      });
      const other = await seniorOf(s.branch, [await load.classes.subject({ grades: [7] })]);
      await as(other, s.branch, async (calls) => {
        for (const path of paths) {
          const refused = await calls.get(path);
          expect(refused.status, path).toBe(403);
          expect(codeOf(refused), path).toBe('journal_scope');
        }
      });
      await as(s.spare, s.branch, async (calls) => {
        const refused = await calls.get(paths[2] ?? '');
        expect(refused.status).toBe(403);
        expect(codeOf(refused)).toBe('journal_scope');
      });
    });

    it('refuses the lesson card to a Tutor of another class and a Senior Head Teacher of another subject', async () => {
      const s = await scene();
      const card = `/api/journal/lessons/${s.third}/card`;
      for (const browser of [
        await tutorOf(s.branch, s.classId),
        await seniorOf(s.branch, [s.subject]),
      ]) {
        await as(browser, s.branch, async (calls) => {
          ok(await calls.get(card));
        });
      }
      for (const [who, browser] of [
        ['tutor', await tutorOf(s.branch, s.otherClass)],
        [
          'senior_head_teacher',
          await seniorOf(s.branch, [await load.classes.subject({ grades: [7] })]),
        ],
      ] as const) {
        await as(browser, s.branch, async (calls) => {
          const refused = await calls.get(card);
          expect(refused.status, who).toBe(403);
          expect(codeOf(refused), who).toBe('journal_scope');
        });
      }
    });

    it('shows a Head Teacher and a Senior Head Teacher of the subject none of the exemption cards of lessons they do not teach', async () => {
      const s = await scene();
      const vice = await account();
      await give(vice, { role: 'academic_vice_principal', branchId: s.branch });
      await as(vice, s.branch, async (calls) => {
        ok(
          await calls.post('/api/exemptions', {
            studentIds: [s.ahmedov],
            kind: 'temporary',
            subjectIds: null,
            startDate: '2026-10-28',
            endDate: '2026-11-08',
            slots: null,
            category: 'illness',
            detail: 'A certificate from the clinic',
            choices: [],
          }),
        );
      });
      const cardsOf = (browser: Browser) =>
        as(
          browser,
          s.branch,
          async (calls) =>
            exemptionsTodaySchema.parse(ok(await calls.get('/api/journal/exemptions-today'))),
          MONDAY_AFTER,
        );
      // The owner teaches the class today: the student is back.
      expect((await cardsOf(s.owner)).backToday.map((one) => one.student.id)).toEqual([s.ahmedov]);
      for (const [who, browser] of [
        ['head_teacher', await headOf(s.branch, [s.subject])],
        ['senior_head_teacher', await seniorOf(s.branch, [s.subject])],
      ] as const) {
        const cards = await cardsOf(browser);
        expect(cards.backToday, who).toEqual([]);
        expect(cards.exemptToday, who).toEqual([]);
      }
    });
  });

  describe('the branch export', () => {
    it('keeps the branch export to its readers: a scoped role asks for none, lists none of another and gets no file of it, writing nothing', async () => {
      const s = await scene();
      const vice = await account();
      await give(vice, { role: 'academic_vice_principal', branchId: s.branch });
      const asked = journalExportRequestedSchema.parse(
        await as(vice, s.branch, async (calls) => {
          const answer = await calls.post('/api/journal/exports', {
            format: 'xlsx',
            quarterId: s.q1,
          });
          expect([200, 201, 202], JSON.stringify(answer.body)).toContain(answer.status);
          return answer.body as unknown;
        }),
      ).export;
      const readers = [
        ['teacher', s.owner],
        ['tutor', await tutorOf(s.branch, s.classId)],
        ['head_teacher', await headOf(s.branch, [s.subject])],
        ['senior_head_teacher', await seniorOf(s.branch, [s.subject])],
      ] as const;
      const before = await snapshot(s.branch);
      for (const [who, browser] of readers) {
        await as(browser, s.branch, async (calls) => {
          const refused = await calls.post('/api/journal/exports', {
            format: 'xlsx',
            quarterId: s.q1,
          });
          expect(refused.status, who).toBe(403);
          expect(codeOf(refused), who).toBe('journal_export_scope');
          const list = journalExportListSchema.parse(ok(await calls.get('/api/journal/exports')));
          expect(list.canExportBranch, who).toBe(false);
          expect(
            list.exports.map((one) => one.id),
            who,
          ).not.toContain(asked.id);
          const file = await calls.get(`/api/journal/exports/${asked.id}/file`);
          expect(file.status, who).toBe(404);
        });
      }
      expect(await snapshot(s.branch)).toEqual(before);
    });
  });
});
