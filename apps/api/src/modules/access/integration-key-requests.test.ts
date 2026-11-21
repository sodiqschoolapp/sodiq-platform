import { randomBytes } from 'node:crypto';
import {
  ACTING_STAFF_ID_HEADER,
  APP_VERSION,
  APP_VERSION_HEADER,
  BRANCH_HEADER,
  INTEGRATION_KEY_HEADER,
  REQUEST_KEY_HEADER,
  auditPageSchema,
  cellHistorySchema,
  integrationKeyActingPeopleSchema,
  journalGridSchema,
  journalListSchema,
} from '@sodiq/shared';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import request, { type Response, type Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setEditDays } from '../../testing/branch-filter-sql.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { CellsKit } from '../../testing/cells-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';
import { integrationKeySecretHash } from './integration-keys.service.js';

// Task 10.10 (pull request #369; the owner's spec change of 21 November 2026). `02`, Integration
// keys: a request made with a key acts for one named person, by staff ID, "checked on every
// request", with "exactly what their Teacher, Head Teacher and Senior Head Teacher assignments
// allow in this platform, and nothing more"; never exports, a student's record, group moves or
// the own account; every change "recorded as the person's change, with the key named"; "A key
// does not sign the person in: it opens no session". A fake department platform calls the API
// with an invented key; all names are invented.

/** Tuesday 27 October 2026, noon in Tashkent: with 7 edit days the Mondays 12 and 19 October are locked, the 26th is open. */
const MOMENT = '2026-10-27T12:00:00+05:00';
const VALID_FROM = new Date('2026-09-01T00:00:00+05:00');

const codeOf = (response: Response): string =>
  (response.body as { error?: { code?: string } }).error?.code ??
  `status ${String(response.status)}`;

const ok = (response: Response, status = 200): Response => {
  expect(response.status, JSON.stringify(response.body).slice(0, 800)).toBe(status);
  return response;
};

const refused = (response: Response, status: number, code: string): void => {
  expect(response.status, JSON.stringify(response.body).slice(0, 800)).toBe(status);
  expect(codeOf(response)).toBe(code);
};

describe('requests made through an integration key', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;
  let keys = 0;

  type Browser = { cookie: string; account: { id: string } };

  const account = async (): Promise<Browser> => {
    names += 1;
    return t.kit.completeSession('Dilnoza', `Yusupova${'a'.repeat(names % 7)}`);
  };

  /** The staff ID (S-YYNNNN) of the person whose account is `accountId`. */
  const staffIdOf = async (accountId: string): Promise<{ id: string; staffId: string }> => {
    const row = await t.database.migrator
      .selectFrom('staff')
      .select(['id', 'staff_id'])
      .where('account_id', '=', accountId)
      .executeTakeFirstOrThrow();
    if (row.staff_id === null) throw new Error('A person of the kit has a staff ID.');
    return { id: row.id, staffId: row.staff_id };
  };

  /** A staff record with an account, in the branch, for a person who has none yet. */
  const staffFor = async (branch: string, browser: Browser) => {
    await load.classes.person(branch, ['uz'], { accountId: browser.account.id });
    return staffIdOf(browser.account.id);
  };

  /** A key of the people given, ending on `endsOn` (the last day it works), with its secret. */
  async function keyOf(
    staffRecordIds: readonly string[],
    endsOn = '2027-06-30',
  ): Promise<{ id: string; secret: string; name: string }> {
    keys += 1;
    const secret = `sodiq_ik_${randomBytes(32).toString('base64url')}`;
    const name = `Department platform ${String(keys)}`;
    const key = await t.database.migrator
      .insertInto('integration_keys')
      .values({
        name,
        secret_hash: integrationKeySecretHash(secret),
        ends_on: endsOn,
        ends_at: sql<Date>`((${endsOn}::date + 1)::timestamp at time zone 'Asia/Tashkent')`,
        created_at: new Date('2026-09-01T09:00:00+05:00'),
        created_by: await adminAccount(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const staffId of staffRecordIds) {
      await t.database.migrator
        .insertInto('integration_key_people')
        .values({
          key_id: key.id,
          staff_id: staffId,
          added_at: new Date('2026-09-01T09:00:00+05:00'),
          added_by: await adminAccount(),
        })
        .execute();
    }
    return { id: key.id, secret, name };
  }

  let adminId: string | undefined;
  const adminAccount = async (): Promise<string> => {
    if (adminId !== undefined) return adminId;
    const row = await t.database.migrator
      .selectFrom('assignments')
      .select('account_id')
      .where('id', '=', t.adminAssignment)
      .executeTakeFirstOrThrow();
    adminId = row.account_id;
    return adminId;
  };

  interface KeyCall {
    secret: string;
    staffId?: string | undefined;
    branch?: string;
    cookie?: string;
  }

  /** A request of the department platform: the key, the person's staff ID, the branch. */
  function via(method: 'get' | 'post' | 'put' | 'delete', path: string, call: KeyCall): Test {
    let test = request(t.kit.server)
      [method](path)
      .set(INTEGRATION_KEY_HEADER, call.secret)
      .set(APP_VERSION_HEADER, String(APP_VERSION));
    if (call.staffId !== undefined) test = test.set(ACTING_STAFF_ID_HEADER, call.staffId);
    if (call.branch !== undefined) test = test.set(BRANCH_HEADER, call.branch);
    if (call.cookie !== undefined) test = test.set('Cookie', call.cookie);
    if (method !== 'get') test = test.set(REQUEST_KEY_HEADER, randomUUID());
    return test;
  }

  /** Runs `work` with the clock at MOMENT, the sessions of the browsers used at that moment. */
  async function at<T>(
    work: () => Promise<T>,
    moment = MOMENT,
    browsers: Browser[] = [],
  ): Promise<T> {
    t.clock.set(moment);
    try {
      // The Super Admin's session too: the page reads of these tests are made as the Super Admin.
      for (const accountId of [
        await adminAccount(),
        ...browsers.map((browser) => browser.account.id),
      ]) {
        await t.database.migrator
          .updateTable('sessions')
          .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
          .where('account_id', '=', accountId)
          .where('ended_at', 'is', null)
          .execute();
      }
      return await work();
    } finally {
      t.clock.set(START);
    }
  }

  const give = (browser: Browser, held: Parameters<DayTemplatesKit['kit']['giveRole']>[1]) =>
    t.kit.giveRole(browser.account.id, { validFrom: VALID_FROM, ...held });

  const student = async (branch: string, classId: string, last: string): Promise<string> => {
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const id = await members.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: 'Sardor', last_name: last })
      .where('id', '=', id)
      .execute();
    await members.member({ branch, classId, studentId: id, from: '2026-09-01' });
    return id;
  };

  /**
   * Maths of 7th grade on the Mondays 12, 19 and 26 October at 08:00, owned by `owner`; the other
   * class's maths taught by another teacher; a Head Teacher and a Senior Head Teacher of maths, a
   * Head Teacher of another subject, and an Academic Vice Principal who also teaches.
   */
  async function scene() {
    const owner = await account();
    const head = await account();
    const senior = await account();
    const otherHead = await account();
    const vice = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id },
    });
    await setEditDays(t.database.migrator, s.branch, 7);
    await give(owner, { role: 'teacher', branchId: s.branch });
    await give(head, { role: 'head_teacher', branchId: s.branch, subjectIds: [s.subject] });
    await give(senior, { role: 'senior_head_teacher', subjectIds: [s.subject] });
    await give(otherHead, {
      role: 'head_teacher',
      branchId: s.branch,
      subjectIds: [await load.classes.subject({ grades: [7] })],
    });
    await give(vice, { role: 'academic_vice_principal', branchId: s.branch });
    await give(vice, { role: 'teacher', branchId: s.branch });
    // The Academic Vice Principal is also a Head Teacher of another subject (permission review
    // must-fix 1): through a key only that post counts.
    await give(vice, {
      role: 'head_teacher',
      branchId: s.branch,
      subjectIds: [await load.classes.subject({ grades: [7] })],
    });
    const lessonsOf = async (classId: string) =>
      (
        await t.database.migrator
          .selectFrom('lessons')
          .select('id')
          .where('class_id', '=', classId)
          .where('subject_id', '=', s.subject)
          .where('lesson_date', '<=', '2026-10-31')
          .orderBy('starts_at')
          .execute()
      ).map((row) => row.id);
    const [first, second, third] = await lessonsOf(s.classId);
    const [, , otherThird] = await lessonsOf(s.otherClass);
    if (
      first === undefined ||
      second === undefined ||
      third === undefined ||
      otherThird === undefined
    ) {
      throw new Error('The scene has three lessons in October in each class.');
    }
    const journalOf = async (classId: string) =>
      (
        await t.database.migrator
          .selectFrom('journals')
          .select('id')
          .where('class_id', '=', classId)
          .where('subject_id', '=', s.subject)
          .executeTakeFirstOrThrow()
      ).id;
    const people = {
      owner: await staffIdOf(owner.account.id),
      head: await staffFor(s.branch, head),
      senior: await staffFor(s.branch, senior),
      otherHead: await staffFor(s.branch, otherHead),
      vice: await staffFor(s.branch, vice),
    };
    const key = await keyOf(Object.values(people).map((one) => one.id));
    return {
      ...s,
      owner,
      head,
      senior,
      otherHead,
      vice,
      people,
      key,
      first,
      second,
      third,
      otherThird,
      journal: await journalOf(s.classId),
      otherJournal: await journalOf(s.otherClass),
      ahmedov: await student(s.branch, s.classId, 'Ahmedov'),
      boboyev: await student(s.branch, s.otherClass, 'Boboyev'),
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  const asOwner = (x: Scene, extra: Partial<KeyCall> = {}): KeyCall => ({
    secret: x.key.secret,
    staffId: x.people.owner.staffId,
    branch: x.branch,
    ...extra,
  });

  const attendance = (
    x: Scene,
    lessonId: string,
    studentId: string,
    mark: number,
    call: KeyCall,
    version: number | null = null,
  ) =>
    via('post', `/api/journal/lessons/${lessonId}/attendance`, call).send({
      saves: [{ studentId, mark, version }],
    });

  const cellOf = (lessonId: string, studentId: string) =>
    t.database.migrator
      .selectFrom('journal_cells')
      .select(['id', 'mark', 'version', 'changed_by'])
      .where('lesson_id', '=', lessonId)
      .where('student_id', '=', studentId)
      .where('work_id', 'is', null)
      .executeTakeFirst();

  /** The journal entries of the audit log written after `since`, with the key and the actor. */
  const journalEntriesSince = (since: Date) =>
    t.database.migrator
      .selectFrom('audit_log')
      .select(['action', 'actor_id', 'assignment_id', 'integration_key_id'])
      .where('action', 'like', 'journal.%')
      .where('occurred_at', '>=', since)
      .orderBy('occurred_at')
      .execute();

  let x: Scene;

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    x = await scene();
  });

  afterAll(async () => {
    await t.close();
  });

  describe('a Teacher on the key (the Done when)', () => {
    it('enters attendance for the own lesson, recorded as the teacher’s change with the key named', async () => {
      await at(async () => {
        const before = new Date(MOMENT);
        ok(await attendance(x, x.third, x.ahmedov, 1, asOwner(x)));
        const cell = await cellOf(x.third, x.ahmedov);
        expect(cell?.mark).toBe(1);
        const entries = await journalEntriesSince(before);
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
          expect(entry.actor_id).toBe(x.owner.account.id);
          expect(entry.integration_key_id).toBe(x.key.id);
        }
        // The teacher's own assignment allowed it (`02`: "recorded as the person's change").
        const teacherAssignment = await t.database.migrator
          .selectFrom('assignments')
          .select('id')
          .where('account_id', '=', x.owner.account.id)
          .where('role', '=', 'teacher')
          .executeTakeFirstOrThrow();
        expect(entries.map((entry) => entry.assignment_id)).toContain(teacherAssignment.id);
      });
    });

    it('shows "via <key name>" in the cell history and on the Audit log page; a change made here names no key', async () => {
      await at(
        async () => {
          // The teacher's own session changes the same cell: no key on that line.
          const typed = await t
            .post(
              `/api/journal/lessons/${x.third}/attendance`,
              x.branch,
              {
                saves: [
                  {
                    studentId: x.ahmedov,
                    mark: 2,
                    version: (await cellOf(x.third, x.ahmedov))?.version ?? null,
                  },
                ],
              },
              x.owner.cookie,
            )
            .set(REQUEST_KEY_HEADER, randomUUID());
          ok(typed);
          const history = cellHistorySchema.parse(
            ok(
              await via(
                'get',
                `/api/journal/lessons/${x.third}/students/${x.ahmedov}/history`,
                asOwner(x),
              ),
            ).body,
          );
          const attendanceLines = history.lines.filter((line) => line.work === null);
          expect(attendanceLines.map((line) => line.viaKey)).toEqual([{ name: x.key.name }, null]);
          const page = auditPageSchema.parse(ok(await t.get('/api/audit/entries', x.branch)).body);
          const viaKey = page.entries.filter((entry) => entry.viaKey !== null);
          expect(viaKey.length).toBeGreaterThan(0);
          expect(viaKey.every((entry) => entry.viaKey?.name === x.key.name)).toBe(true);
          expect(viaKey.every((entry) => entry.actor?.id === x.owner.account.id)).toBe(true);
          expect(
            page.entries.some(
              (entry) => entry.viaKey === null && entry.actor?.id === x.owner.account.id,
            ),
          ).toBe(true);
        },
        MOMENT,
        [x.owner],
      );
    });

    it('writes a comment whose history says "via <key name>" (spec review of the plan, finding 10)', async () => {
      await at(async () => {
        const on = { target: 'note', lessonId: x.third, studentId: x.ahmedov };
        ok(
          await via('put', '/api/journal/comments', asOwner(x)).send({
            on,
            body: 'Came late, worked well',
            visibility: 'staff',
            version: null,
          }),
        );
        const history = ok(
          await via(
            'get',
            `/api/journal/comments/history?target=note&lessonId=${x.third}&studentId=${x.ahmedov}`,
            asOwner(x),
          ),
        ).body as { lines: { viaKey: { name: string } | null }[] };
        expect(history.lines.map((line) => line.viaKey)).toEqual([{ name: x.key.name }]);
      });
    });

    it('enters a classwork with its total and a number', async () => {
      await at(
        async () => {
          const work = ok(
            await via('post', `/api/journal/lessons/${x.third}/works`, asOwner(x)).send({
              kind: 'classwork',
              title: 'Dictation',
            }),
          ).body as { planWorkId: string };
          const planWorkId = work.planWorkId;
          // The column the grid shows it at: the lesson whose plan item holds it (a new plan's
          // first item follows the quarter's first lesson).
          const grid = journalGridSchema.parse(
            ok(await via('get', `/api/journal/journals/${x.journal}`, asOwner(x))).body,
          );
          const shown = grid.lessons.find((lesson) =>
            lesson.works.some((one) => one.planWorkId === planWorkId),
          );
          const sourceLessonId =
            shown?.works.find((one) => one.planWorkId === planWorkId)?.sourceLessonId ?? x.third;
          const lessonId = shown?.id ?? x.third;
          const total = ok(
            await via('put', `/api/journal/lessons/${lessonId}/works/total`, asOwner(x)).send({
              column: { planWorkId, sourceLessonId },
              total: 10,
              version: null,
            }),
          ).body as { id: string };
          ok(
            await via('post', `/api/journal/lessons/${lessonId}/scores`, asOwner(x)).send({
              saves: [
                { studentId: x.ahmedov, column: { workId: total.id }, score: 7, version: null },
              ],
            }),
          );
          const cell = await t.database.migrator
            .selectFrom('journal_cells')
            .select(['score', 'changed_by'])
            .where('lesson_id', '=', lessonId)
            .where('student_id', '=', x.ahmedov)
            .where('work_id', 'is not', null)
            .executeTakeFirstOrThrow();
          expect(cell.score).toBe(7);
          expect(cell.changed_by).toBe(x.owner.account.id);
        },
        MOMENT,
        [x.owner],
      );
    });

    it('is refused on another teacher’s lesson, on a locked lesson and on an outdated cell version', async () => {
      await at(async () => {
        refused(
          await attendance(x, x.otherThird, x.boboyev, 1, asOwner(x)),
          403,
          'journal_entry_scope',
        );
        expect(await cellOf(x.otherThird, x.boboyev)).toBeUndefined();
        // 19 October is locked at noon on the 27th (`07`, Editing rules and locks).
        refused(await attendance(x, x.second, x.ahmedov, 1, asOwner(x)), 409, 'journal_locked');
        expect(await cellOf(x.second, x.ahmedov)).toBeUndefined();
        // The cell was saved at version 2 above; a platform that read version 1 is refused
        // (`edge/journal`, "Two people … change the same cell").
        const stored = await cellOf(x.third, x.ahmedov);
        refused(await attendance(x, x.third, x.ahmedov, 0, asOwner(x), 1), 409, 'cell_stale');
        expect((await cellOf(x.third, x.ahmedov))?.mark).toBe(stored?.mark);
      });
    });

    it('is refused an export, a student’s profile, a group transfer, the own password and the sign-in (closed to keys)', async () => {
      await at(async () => {
        const call = asOwner(x);
        refused(
          await via('post', `/api/journal/journals/${x.journal}/export`, call).send({}),
          403,
          'integration_key_route_closed',
        );
        refused(
          await via('get', `/api/people/students/${x.ahmedov}`, call),
          403,
          'integration_key_route_closed',
        );
        refused(
          await via('get', `/api/results/students/${x.ahmedov}`, call),
          403,
          'integration_key_route_closed',
        );
        refused(
          await via('post', '/api/classes/transfers', call).send({}),
          403,
          'integration_key_route_closed',
        );
        refused(
          await via('post', '/api/auth/password', call).send({
            currentPassword: 'x',
            newPassword: 'y',
          }),
          403,
          'integration_key_route_closed',
        );
        refused(
          await via('post', '/api/auth/sign-in', call).send({ login: 'x', password: 'y' }),
          403,
          'integration_key_route_closed',
        );
        refused(await via('get', '/api/notifications', call), 403, 'integration_key_route_closed');
      });
    });
  });

  describe('a Head Teacher on the key', () => {
    it('grants an unlock in the own subject and is refused in another subject', async () => {
      await at(
        async () => {
          const requested = ok(
            await t
              .post(
                `/api/journal/lessons/${x.first}/unlocks`,
                x.branch,
                { reason: 'I was ill that week' },
                x.owner.cookie,
              )
              .set(REQUEST_KEY_HEADER, randomUUID()),
            201,
          ).body as { id: string; version: number };
          const decide = (staffId: string) =>
            via('post', `/api/journal/unlocks/${requested.id}/decide`, {
              secret: x.key.secret,
              staffId,
              branch: x.branch,
            }).send({ decision: 'approve', days: 1, version: requested.version });
          refused(await decide(x.people.otherHead.staffId), 403, 'journal_unlock_scope');
          // The Academic Vice Principal who is also a Head Teacher of another subject decides
          // as the Academic Vice Principal in this platform, and only as that Head Teacher
          // through the key: refused, and the request is not among those waiting for them.
          refused(await decide(x.people.vice.staffId), 403, 'journal_unlock_scope');
          const deciding = (answer: Response) =>
            (ok(answer).body as { requests: { id: string }[] }).requests.map((one) => one.id);
          expect(
            deciding(
              await via('get', '/api/journal/unlocks?view=deciding', {
                secret: x.key.secret,
                staffId: x.people.vice.staffId,
                branch: x.branch,
              }),
            ),
          ).not.toContain(requested.id);
          expect(
            deciding(await t.get('/api/journal/unlocks?view=deciding', x.branch, x.vice.cookie)),
          ).toContain(requested.id);
          ok(await decide(x.people.head.staffId));
          const entry = await t.database.migrator
            .selectFrom('audit_log')
            .select(['actor_id', 'integration_key_id'])
            .where('action', 'like', 'journal.unlock%')
            .where('actor_id', '=', x.head.account.id)
            .executeTakeFirstOrThrow();
          expect(entry.integration_key_id).toBe(x.key.id);
        },
        MOMENT,
        [x.owner, x.vice],
      );
    });
  });

  describe('only the three roles count', () => {
    it('an Academic Vice Principal who also teaches is refused a journal not taught, which the own session opens (review correction 1)', async () => {
      await at(
        async () => {
          const call = { secret: x.key.secret, staffId: x.people.vice.staffId, branch: x.branch };
          refused(
            await via('get', `/api/journal/journals/${x.otherJournal}`, call),
            403,
            'journal_scope',
          );
          ok(await t.get(`/api/journal/journals/${x.otherJournal}`, x.branch, x.vice.cookie));
        },
        MOMENT,
        [x.vice],
      );
    });

    it('a Senior Head Teacher reads a journal of the subject in the branch named, and is refused the hidden Monitoring branch', async () => {
      await at(async () => {
        const call = { secret: x.key.secret, staffId: x.people.senior.staffId };
        ok(await via('get', `/api/journal/journals/${x.journal}`, { ...call, branch: x.branch }));
        const monitoring = await t.database.migrator
          .selectFrom('branches')
          .select('id')
          .where('purpose', '=', 'monitoring')
          .executeTakeFirst();
        const monitoringId =
          monitoring?.id ??
          (
            await t.database.migrator
              .insertInto('branches')
              .values({ name: 'Monitoring', purpose: 'monitoring' })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        refused(
          await via('get', '/api/journal/journals', { ...call, branch: monitoringId }),
          403,
          'permission_denied',
        );
      });
    });
  });

  describe('Tutor work is done in this platform (decision 6)', () => {
    it('a Teacher who is also the class’s Tutor is refused the Tutor lesson, its journal and its plan through the key, keeps the own subject lessons, and enters the Tutor lesson in the own session', async () => {
      // The scene's maths teacher is also the Tutor of the class (`edge/people-roles-accounts`:
      // "A Teacher who is also a Tutor is on an integration key").
      const tutorAssignment = await give(x.owner, { role: 'tutor', branchId: x.branch });
      await load.classes.tutorRow(x.branch, x.classId, tutorAssignment.id);
      // A subject of the Tutors department (the Homework slot row of 3.6c-2), held by the Tutor.
      const cells = await CellsKit.create(t.database.migrator);
      const tutorLesson = await cells.lesson(x.branch, x.year, x.classId, '2026-10-27');
      const tutors = await t.database.migrator
        .selectFrom('departments')
        .select('id')
        .where('tutors', '=', true)
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .updateTable('subjects')
        .set({ department_id: tutors.id, journal_type: 'attendance_only' })
        .where('id', '=', cells.subject)
        .execute();
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: x.people.owner.id })
        .where('id', '=', tutorLesson)
        .execute();
      // The Tutor subject's journal of the class, as a publish writes it (code review finding 1).
      const journal = await t.database.migrator
        .insertInto('journals')
        .values({
          branch_id: x.branch,
          academic_year_id: x.year,
          class_id: x.classId,
          subject_id: cells.subject,
          runs: '{[2026-09-07,)}',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const pupil = await student(x.branch, x.classId, 'Rasulov');
      const call = asOwner(x);
      const save = { saves: [{ studentId: pupil, mark: 1, version: null }] };
      await at(
        async () => {
          refused(
            await via('post', `/api/journal/lessons/${tutorLesson}/attendance`, call).send(save),
            403,
            'integration_key_tutor_lesson',
          );
          refused(
            await via('post', `/api/journal/lessons/${tutorLesson}/all-present`, call).send({}),
            403,
            'integration_key_tutor_lesson',
          );
          refused(
            await via('get', `/api/plans/lessons/${tutorLesson}`, call),
            403,
            'integration_key_tutor_lesson',
          );
          refused(
            await via('get', `/api/journal/journals/${journal.id}`, call),
            403,
            'integration_key_tutor_lesson',
          );
          refused(
            await via('get', `/api/plans/journals/${journal.id}`, call),
            403,
            'integration_key_tutor_lesson',
          );
          refused(
            await via('get', `/api/plans/parallel?subjectId=${cells.subject}`, call),
            403,
            'integration_key_tutor_lesson',
          );
          expect(await cellOf(tutorLesson, pupil)).toBeUndefined();
          const list = journalListSchema.parse(
            ok(await via('get', '/api/journal/journals', call)).body,
          );
          const listed = list.journals.map((one) => one.id);
          expect(listed).not.toContain(journal.id);
          expect(listed).toContain(x.journal);
          // The teacher's own maths lesson stays open through the key (`02`: "Exactly what their
          // Teacher … assignments allow"; code review finding 2).
          ok(await attendance(x, x.third, pupil, 1, call));
          expect((await cellOf(x.third, pupil))?.mark).toBe(1);
          // A Tutor's own route is closed to keys.
          refused(
            await via('get', `/api/journal/student-absences/${pupil}/2026-10-27/file`, call),
            403,
            'integration_key_route_closed',
          );
          // The same entry in the person's own session passes, and the own Journals page lists it.
          ok(
            await t
              .post(
                `/api/journal/lessons/${tutorLesson}/attendance`,
                x.branch,
                save,
                x.owner.cookie,
              )
              .set(REQUEST_KEY_HEADER, randomUUID()),
          );
          expect((await cellOf(tutorLesson, pupil))?.mark).toBe(1);
          const own = journalListSchema.parse(
            ok(await t.get('/api/journal/journals', x.branch, x.owner.cookie)).body,
          );
          expect(own.journals.map((one) => one.id)).toContain(journal.id);
        },
        MOMENT,
        [x.owner],
      );
    });
  });

  describe('checked again on every request', () => {
    /** A key of one new Teacher of the scene's branch, with the person. */
    async function single() {
      const browser = await account();
      const assignment = await give(browser, { role: 'teacher', branchId: x.branch });
      const person = await staffFor(x.branch, browser);
      const key = await keyOf([person.id]);
      const call = { secret: key.secret, staffId: person.staffId, branch: x.branch };
      const read = () => via('get', '/api/journal/journals', call);
      return { browser, assignment, person, key, call, read };
    }

    it('a revoked key is refused at the next request', async () => {
      const k = await single();
      await at(async () => {
        ok(await k.read());
        await t.database.migrator
          .updateTable('integration_keys')
          .set({ revoked_at: new Date(MOMENT), revoked_by: await adminAccount() })
          .where('id', '=', k.key.id)
          .execute();
        refused(await k.read(), 401, 'integration_key_revoked');
      });
    });

    it('a key works until its end and is refused from that moment', async () => {
      const k = await single();
      await t.database.migrator
        .updateTable('integration_keys')
        .set({
          ends_on: '2026-10-27',
          ends_at: sql<Date>`(('2026-10-27'::date + 1)::timestamp at time zone 'Asia/Tashkent')`,
        })
        .where('id', '=', k.key.id)
        .execute();
      ok(await at(() => k.read(), '2026-10-27T23:59:59.999+05:00'));
      refused(await at(() => k.read(), '2026-10-28T00:00:00+05:00'), 401, 'integration_key_ended');
    });

    it('a person removed from the key, locked, inactive or left is refused at the next request', async () => {
      for (const change of ['removed', 'locked', 'inactive', 'left'] as const) {
        const k = await single();
        await at(async () => {
          ok(await k.read());
          if (change === 'removed') {
            await t.database.migrator
              .updateTable('integration_key_people')
              .set({ removed_at: new Date(MOMENT), removed_by: await adminAccount() })
              .where('key_id', '=', k.key.id)
              .execute();
          } else if (change === 'locked') {
            await t.database.migrator
              .updateTable('accounts')
              .set({
                locked_at: new Date(MOMENT),
                locked_by: await adminAccount(),
                lock_reason: 'Reported lost phone',
              })
              .where('id', '=', k.browser.account.id)
              .execute();
          } else {
            await load.status(k.person.id, change, '2026-10-27');
          }
          refused(await k.read(), 403, 'integration_key_person_refused');
        });
      }
    });

    it('a staff ID not on the key is refused, a missing one is malformed', async () => {
      const k = await single();
      await at(async () => {
        refused(
          await via('get', '/api/journal/journals', { ...k.call, staffId: x.people.owner.staffId }),
          403,
          'integration_key_person_refused',
        );
        refused(
          await via('get', '/api/journal/journals', { ...k.call, staffId: undefined }),
          400,
          'validation_failed',
        );
        refused(
          await via('get', '/api/journal/journals', { ...k.call, secret: 'sodiq_ik_unknown' }),
          401,
          'integration_key_invalid',
        );
      });
    });

    it('a key revoked between its read and its count is refused (review correction 2)', async () => {
      const k = await single();
      await at(async () => {
        // A transaction holds the key row; the request reads the key and waits at its count.
        const held = await t.database.migrator.connection().execute(async (connection) => {
          await sql`begin`.execute(connection);
          await sql`select 1 from integration_keys where id = ${k.key.id} for update`.execute(
            connection,
          );
          const pid = (
            await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(connection)
          ).rows[0]?.pid;
          const answer = new Promise<Response>((resolve, reject) => {
            k.read().then(resolve, reject);
          });
          for (let tries = 0; tries < 200; tries += 1) {
            const waiting = await sql<{ n: number }>`
              select count(*)::int as n from pg_stat_activity a
              where a.datname = current_database() and ${pid} = any(pg_blocking_pids(a.pid))
            `.execute(t.database.migrator);
            if ((waiting.rows[0]?.n ?? 0) > 0) break;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          await sql`update integration_keys set revoked_at = ${new Date(MOMENT)}, revoked_by = ${await adminAccount()} where id = ${k.key.id}`.execute(
            connection,
          );
          await sql`commit`.execute(connection);
          return answer;
        });
        refused(held, 401, 'integration_key_revoked');
      });
    });
  });

  describe('not a sign-in', () => {
    it('opens no session and, with the session cookie of another account, acts only for the key’s person', async () => {
      await at(
        async () => {
          const sessionsBefore = await t.database.migrator
            .selectFrom('sessions')
            .select(['id', 'last_used_at'])
            .orderBy('id')
            .execute();
          const accountsBefore = await t.database.migrator
            .selectFrom('accounts')
            .selectAll()
            .where('id', 'in', [x.owner.account.id, x.vice.account.id])
            .orderBy('id')
            .execute();
          const since = new Date(MOMENT);
          const answer = ok(
            await attendance(
              x,
              x.third,
              x.ahmedov,
              1,
              asOwner(x, { cookie: x.vice.cookie }),
              (await cellOf(x.third, x.ahmedov))?.version ?? null,
            ),
          );
          const sessionsAfter = await t.database.migrator
            .selectFrom('sessions')
            .select(['id', 'last_used_at'])
            .orderBy('id')
            .execute();
          expect(sessionsAfter).toEqual(sessionsBefore);
          // Nothing of either account changes, and no cookie is set (`02`, Not a sign-in).
          expect(
            await t.database.migrator
              .selectFrom('accounts')
              .selectAll()
              .where('id', 'in', [x.owner.account.id, x.vice.account.id])
              .orderBy('id')
              .execute(),
          ).toEqual(accountsBefore);
          expect(answer.headers['set-cookie']).toBeUndefined();
          const entries = await journalEntriesSince(since);
          const last = entries.at(-1);
          expect(last?.actor_id).toBe(x.owner.account.id);
          expect(last?.integration_key_id).toBe(x.key.id);
        },
        '2026-10-27T12:30:00+05:00',
        [x.vice],
      );
    });
  });

  describe('the limit per minute and the last use', () => {
    it('refuses the request over the limit with Retry-After, passes again after the minute, and stores the last use of a refused request too', async () => {
      const browser = await account();
      await give(browser, { role: 'teacher', branchId: x.branch });
      const person = await staffFor(x.branch, browser);
      const key = await keyOf([person.id]);
      const call = { secret: key.secret, staffId: person.staffId, branch: x.branch };
      await t.database.migrator
        .updateTable('integration_keys')
        .set({ minute_started_at: new Date('2026-10-27T12:00:00+05:00'), minute_requests: 300 })
        .where('id', '=', key.id)
        .execute();
      const over = await at(
        () => via('get', '/api/journal/journals', call),
        '2026-10-27T12:00:20+05:00',
      );
      refused(over, 429, 'integration_key_rate_limited');
      expect(over.headers['retry-after']).toBe('40');
      // The refused request is counted and is the key's last use (code review finding 10).
      const counted = await t.database.migrator
        .selectFrom('integration_keys')
        .select(['last_used_at', 'minute_requests'])
        .where('id', '=', key.id)
        .executeTakeFirstOrThrow();
      expect(counted.minute_requests).toBe(301);
      expect(counted.last_used_at?.toISOString()).toBe(
        new Date('2026-10-27T12:00:20+05:00').toISOString(),
      );
      ok(await at(() => via('get', '/api/journal/journals', call), '2026-10-27T12:01:00+05:00'));
      // A refused request (a closed route) is a use too.
      refused(
        await at(() => via('get', '/api/notifications', call), '2026-10-27T12:02:00+05:00'),
        403,
        'integration_key_route_closed',
      );
      const stored = await t.database.migrator
        .selectFrom('integration_keys')
        .select(['last_used_at', 'minute_requests'])
        .where('id', '=', key.id)
        .executeTakeFirstOrThrow();
      expect(stored.last_used_at?.toISOString()).toBe(
        new Date('2026-10-27T12:02:00+05:00').toISOString(),
      );
      // Never backwards: a request with an earlier clock leaves the later use.
      ok(await at(() => via('get', '/api/journal/journals', call), '2026-10-27T12:01:30+05:00'));
      const again = await t.database.migrator
        .selectFrom('integration_keys')
        .select('last_used_at')
        .where('id', '=', key.id)
        .executeTakeFirstOrThrow();
      expect(again.last_used_at?.toISOString()).toBe(
        new Date('2026-10-27T12:02:00+05:00').toISOString(),
      );
    });
  });

  describe('the key’s own people', () => {
    it('lists the people on the key now with their staff IDs, names, state and branches; a removed person is not listed', async () => {
      const browser = await account();
      await give(browser, { role: 'teacher', branchId: x.branch });
      const person = await staffFor(x.branch, browser);
      const gone = await account();
      await give(gone, { role: 'teacher', branchId: x.branch });
      const removed = await staffFor(x.branch, gone);
      const key = await keyOf([person.id, removed.id, x.people.senior.id]);
      await t.database.migrator
        .updateTable('integration_key_people')
        .set({ removed_at: new Date(MOMENT), removed_by: await adminAccount() })
        .where('key_id', '=', key.id)
        .where('staff_id', '=', removed.id)
        .execute();
      const answer = integrationKeyActingPeopleSchema.parse(
        ok(await at(() => via('get', '/api/integration/people', { secret: key.secret }))).body,
      );
      expect(answer.key).toBe(key.name);
      const byId = new Map(answer.people.map((one) => [one.staffId, one]));
      expect([...byId.keys()].sort()).toEqual([person.staffId, x.people.senior.staffId].sort());
      expect(byId.get(person.staffId)).toMatchObject({
        usable: true,
        allBranches: false,
        branches: [{ id: x.branch }],
      });
      expect(byId.get(x.people.senior.staffId)).toMatchObject({ usable: true, allBranches: true });
      // A session never reaches it, the Super Admin's included (the harness tries every role).
      refused(await t.get('/api/integration/people', x.branch), 403, 'integration_key_required');
    });
  });
});
