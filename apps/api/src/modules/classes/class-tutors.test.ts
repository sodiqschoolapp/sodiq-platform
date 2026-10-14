import type { INestApplication } from '@nestjs/common';
import {
  apiErrorSchema,
  BRANCH_HEADER,
  classDetailSchema,
  tutorCandidateListSchema,
  type ClassDetail,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { errorCode, signInKit, type SignInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

/** Wednesday 14 October 2026, 10:00 in Tashkent. */
const START = '2026-10-14T10:00:00+05:00';
const TODAY = '2026-10-14';
const UNKNOWN = '0199a000-0000-7000-8000-000000000099';

const detailOf = (response: Response): ClassDetail => classDetailSchema.parse(response.body);

// All names are invented.
// docs/spec/edge-cases/students-classes-groups.md: "The Tutor of a class is
// recorded with dates. The new Tutor sees the class's whole year; the earlier
// one loses access on the end date. An acting Tutor can be set for a period."
// docs/spec/05-classes-groups-subjects.md, Language of instruction: "The
// same holds when a Tutor is given a class. This is blocked, not a warning."
// Task 3.1a, pull request #88: decisions 8, 9, 10, 15, 16 and 20.
describe('the Tutors of a class', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let classes: ClassesKit;
  let north: string;
  let south: string;
  let northYear: string;
  let southYear: string;
  let admin: string;
  let vice: string;
  let viceAssignment: string;
  let principal: string;
  let count = 0;
  const clock = new FixedClock(START);

  const get = (path: string, cookie = vice, branch = north) =>
    kit.get(path, cookie).set(BRANCH_HEADER, branch);
  const post = (path: string, body: object = {}, cookie = vice, branch = north) =>
    kit.post(path, cookie).set(BRANCH_HEADER, branch).send(body);
  const put = (path: string, body: object, cookie = vice, branch = north) =>
    request(kit.server).put(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body);

  const auditCount = async () =>
    Number(
      (
        await database.migrator
          .selectFrom('audit_log')
          .select((builder) => builder.fn.countAll().as('count'))
          .executeTakeFirstOrThrow()
      ).count,
    );
  /** Every row of the tables the Tutor routes write, in both branches, and the log. */
  const rowsOf = () =>
    Promise.all([
      database.migrator.selectFrom('classes').selectAll().orderBy('id').execute(),
      database.migrator.selectFrom('class_tutors').selectAll().orderBy('id').execute(),
      auditCount(),
    ]);
  const entry = (action: string, recordId: string) =>
    database.migrator
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', action)
      .where('record_id', '=', recordId)
      .orderBy('occurred_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();

  /** A class of North with no Tutor. */
  const newClass = (language: 'uz' | 'ru' = 'uz', branch = north, year = northYear) => {
    count += 1;
    return classes.schoolClass(branch, year, {
      language,
      grade: (count % 11) + 1,
      name: `Tutored ${'abcdefghijklmnopqrstuvwxyz'[count % 26] ?? 'a'}${'q'.repeat(Math.floor(count / 26))}`,
    });
  };

  /** A person of North with a Tutor role there. */
  async function tutor(
    languages: readonly ('uz' | 'ru')[] = ['uz'],
    from?: Date,
    until: Date | null = null,
  ): Promise<{ staffId: string; accountId: string; assignmentId: string }> {
    const person = await classes.person(north, languages);
    return {
      ...person,
      assignmentId: await classes.role(person.accountId, north, 'tutor', from, until),
    };
  }

  const give = (classId: string, fields: object, cookie = vice, branch = north) =>
    post(
      `/api/classes/${classId}/tutors`,
      { kind: 'tutor', from: TODAY, until: null, ...fields },
      cookie,
      branch,
    );

  /** How many connections to the test database wait for a lock right now. */
  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  /** Runs `work` in a transaction of the application that stays open until released. */
  async function holdOpen(branches: string[], work: (transaction: Transaction) => Promise<void>) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const done = app
      .get(Transactions)
      .run(branches, async (transaction) => {
        await work(transaction);
        ready();
        await released;
      })
      .catch((error: unknown) => error);
    await Promise.race([isReady, done]);
    return { release, done };
  }

  /** The writes of a give, as the service makes them: its checks lock, then the row. */
  const writeTutor = (
    transaction: Transaction,
    classId: string,
    assignmentId: string,
  ): Promise<void> =>
    sql`select tutor_teaches_language(${assignmentId}::uuid, 'uz')`.execute(transaction).then(() =>
      transaction
        .insertInto('class_tutors')
        .values({
          branch_id: north,
          class_id: classId,
          assignment_id: assignmentId,
          kind: 'tutor',
          valid_from: clock.now(),
          given_by: viceAccount,
        })
        .execute()
        .then(() => undefined),
    );
  let viceAccount: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    classes = new ClassesKit(database.migrator);
    northYear = await classes.year(north);
    southYear = await classes.year(south);
    app = await createTestApp({ database: database.app, clock });
    kit = signInKit(app);
    const adminBrowser = await kit.completeSession('Aziza', 'Karimova');
    await kit.giveRole(adminBrowser.account.id, { role: 'super_admin' });
    admin = adminBrowser.cookie;
    const viceBrowser = await kit.completeSession('Dilnoza', 'Saidova');
    viceAccount = viceBrowser.account.id;
    viceAssignment = (
      await kit.giveRole(viceBrowser.account.id, {
        role: 'academic_vice_principal',
        branchId: north,
      })
    ).id;
    vice = viceBrowser.cookie;
    const principalBrowser = await kit.completeSession('Bobur', 'Aliyev');
    await kit.giveRole(principalBrowser.account.id, { role: 'principal', branchId: north });
    principal = principalBrowser.cookie;
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  describe('the candidates', () => {
    it('are the Tutor roles of the branch with their languages and classes', async () => {
      const held = await newClass();
      const person = await tutor(['uz', 'ru']);
      await give(held, { assignmentId: person.assignmentId }).expect(201);
      const southern = await classes.person(south, ['ru']);
      await classes.role(southern.accountId, south);
      const list = tutorCandidateListSchema.parse(
        (await get('/api/classes/tutor-candidates').expect(200)).body,
      );
      const found = list.candidates.find((one) => one.assignmentId === person.assignmentId);
      expect(found).toMatchObject({
        staffId: person.staffId,
        languages: ['ru', 'uz'],
        from: '2026-09-01',
        until: null,
        classes: [expect.objectContaining({ id: held, kind: 'tutor' })],
      });
      expect(list.candidates.some((one) => one.staffId === southern.staffId)).toBe(false);
    });

    it('are refused to a reader without edit', async () => {
      expect(errorCode(await get('/api/classes/tutor-candidates', principal).expect(403))).toBe(
        'permission_denied',
      );
    });
  });

  describe('the give', () => {
    it('gives a Tutor from now and an acting Tutor from a later date, each with an entry', async () => {
      const held = await newClass();
      const first = await tutor();
      const second = await tutor();
      const response = await give(held, { assignmentId: first.assignmentId }).expect(201);
      const detail = detailOf(response);
      expect(detail.tutor).toMatchObject({
        assignmentId: first.assignmentId,
        staffId: first.staffId,
        from: TODAY,
        until: null,
        state: 'current',
      });
      expect(await entry('class.tutor_given', held)).toMatchObject({
        assignment_id: viceAssignment,
        request_id: response.headers['x-request-id'],
        new_value: {
          tutorId: detail.tutors[0]?.id,
          assignmentId: first.assignmentId,
          kind: 'tutor',
          validFrom: clock.now().toISOString(),
          validUntil: null,
        },
      });
      const acting = detailOf(
        await give(held, {
          assignmentId: second.assignmentId,
          kind: 'acting',
          from: '2026-10-20',
          until: '2026-11-01',
        }).expect(201),
      );
      expect(acting.acting).toBeNull();
      expect(acting.tutors.find((row) => row.kind === 'acting')).toMatchObject({
        from: '2026-10-20',
        until: '2026-11-01',
        state: 'planned',
        endCause: 'ended',
      });
    });

    it('refuses a Tutor who does not teach in the class language', async () => {
      const held = await newClass('ru');
      const person = await tutor(['uz']);
      const before = await rowsOf();
      expect(errorCode(await give(held, { assignmentId: person.assignmentId }).expect(409))).toBe(
        'tutor_language',
      );
      expect(await rowsOf()).toEqual(before);
    });

    it('refuses a second Tutor at the same time, and a role that is not Tutor', async () => {
      const held = await newClass();
      const first = await tutor();
      const second = await tutor();
      await give(held, { assignmentId: first.assignmentId }).expect(201);
      expect(
        errorCode(
          await give(held, { assignmentId: second.assignmentId, from: '2026-10-20' }).expect(409),
        ),
      ).toBe('class_tutor_taken');
      const teacher = await classes.person(north, ['uz']);
      const role = await classes.role(teacher.accountId, north, 'teacher');
      expect(errorCode(await give(held, { assignmentId: role }).expect(409))).toBe(
        'tutor_not_tutor',
      );
    });

    it('refuses dates before today and outside the role', async () => {
      const held = await newClass();
      const person = await tutor();
      expect(
        errorCode(
          await give(held, { assignmentId: person.assignmentId, from: '2026-10-13' }).expect(409),
        ),
      ).toBe('tutor_date_past');
      const later = await tutor(['uz'], new Date('2026-11-01T00:00:00+05:00'));
      expect(errorCode(await give(held, { assignmentId: later.assignmentId }).expect(409))).toBe(
        'tutor_outside_role',
      );
      expect(
        errorCode(
          await give(held, { assignmentId: person.assignmentId, until: TODAY }).expect(400),
        ),
      ).toBe('validation_failed');
    });

    it('refuses an archived class and a class of a closed year', async () => {
      const held = await newClass();
      const person = await tutor();
      await post(`/api/classes/${held}/archive`).expect(200);
      expect(errorCode(await give(held, { assignmentId: person.assignmentId }).expect(409))).toBe(
        'class_archived',
      );
      const branch = await insertBranch(database.migrator, 'Bygone');
      const year = await classes.year(branch, 'current', '2025-09-01', '2026-05-31');
      const old = await classes.schoolClass(branch, year, { name: 'Bygone' });
      await classes.setYear(year, 'closed');
      const there = await classes.person(branch, ['uz']);
      const role = await classes.role(there.accountId, branch);
      const response = await give(old, { assignmentId: role }, admin, branch);
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('class_year_closed');
    });

    it("answers 404 for another branch's class or assignment and unknown ones, with nothing written", async () => {
      const held = await newClass();
      const southern = await newClass('uz', south, southYear);
      const person = await tutor();
      const elsewhere = await classes.person(south, ['uz']);
      const southRole = await classes.role(elsewhere.accountId, south);
      const before = await rowsOf();
      for (const [classId, assignmentId] of [
        [southern, person.assignmentId],
        [UNKNOWN, person.assignmentId],
        [held, southRole],
        [held, UNKNOWN],
      ] as const) {
        expect(errorCode(await give(classId, { assignmentId }, admin).expect(404))).toBe(
          'not_found',
        );
      }
      expect(await rowsOf()).toEqual(before);
    });

    it('is refused to the readers, with nothing written', async () => {
      const held = await newClass();
      const person = await tutor();
      const before = await rowsOf();
      expect(
        errorCode(await give(held, { assignmentId: person.assignmentId }, principal).expect(403)),
      ).toBe('permission_denied');
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('the end', () => {
    it('ends a Tutor now, or from a later date, with an entry', async () => {
      const held = await newClass();
      const person = await tutor();
      const given = detailOf(await give(held, { assignmentId: person.assignmentId }).expect(201));
      const row = given.tutors[0]?.id ?? '';
      const later = detailOf(
        await post(`/api/classes/${held}/tutors/${row}/end`, { from: '2026-11-02' }).expect(200),
      );
      expect(later.tutors[0]).toMatchObject({ until: '2026-11-02', state: 'current' });
      const response = await post(`/api/classes/${held}/tutors/${row}/end`, {
        from: TODAY,
      }).expect(200);
      expect(detailOf(response).tutors[0]).toMatchObject({
        until: TODAY,
        state: 'ended',
        endCause: 'ended',
      });
      expect(detailOf(response).tutor).toBeNull();
      expect(await entry('class.tutor_ended', held)).toMatchObject({
        assignment_id: viceAssignment,
        request_id: response.headers['x-request-id'],
        new_value: { tutorId: row, validUntil: clock.now().toISOString() },
      });
      // Ended: nothing more to end.
      expect(
        errorCode(
          await post(`/api/classes/${held}/tutors/${row}/end`, { from: TODAY }).expect(409),
        ),
      ).toBe('tutor_ended');
    });

    it('withdraws a planned row, refuses a later end and a date in the past', async () => {
      const held = await newClass();
      const person = await tutor();
      const given = detailOf(
        await give(held, {
          assignmentId: person.assignmentId,
          from: '2026-11-02',
          until: '2026-12-01',
        }).expect(201),
      );
      const row = given.tutors[0]?.id ?? '';
      expect(
        errorCode(
          await post(`/api/classes/${held}/tutors/${row}/end`, { from: '2026-12-05' }).expect(409),
        ),
      ).toBe('tutor_ends_by_then');
      expect(
        errorCode(
          await post(`/api/classes/${held}/tutors/${row}/end`, { from: '2026-10-13' }).expect(409),
        ),
      ).toBe('tutor_date_past');
      const withdrawn = detailOf(
        await post(`/api/classes/${held}/tutors/${row}/end`, { from: TODAY }).expect(200),
      );
      expect(withdrawn.tutors[0]).toMatchObject({
        from: '2026-11-02',
        until: '2026-11-02',
        state: 'ended',
      });
    });

    it("answers 404 for another branch's class, another class's row and unknown ones", async () => {
      const held = await newClass();
      const other = await newClass();
      const southern = await newClass('uz', south, southYear);
      const person = await tutor();
      const given = detailOf(await give(held, { assignmentId: person.assignmentId }).expect(201));
      const row = given.tutors[0]?.id ?? '';
      const before = await rowsOf();
      for (const [classId, tutorId] of [
        [southern, row],
        [other, row],
        [held, UNKNOWN],
        [UNKNOWN, row],
      ] as const) {
        expect(
          errorCode(
            await post(
              `/api/classes/${classId}/tutors/${tutorId}/end`,
              { from: TODAY },
              admin,
            ).expect(404),
          ),
        ).toBe('not_found');
      }
      expect(
        (await post(`/api/classes/${held}/tutors/${row}/end`, { from: TODAY }, principal)).status,
      ).toBe(403);
      expect(await rowsOf()).toEqual(before);
    });
  });

  // Decision 10: the archive ends the Tutors in force and withdraws the planned ones.
  it('ends the Tutors at the archive and names them in its entry', async () => {
    const held = await newClass();
    const now = await tutor();
    const planned = await tutor();
    await give(held, { assignmentId: now.assignmentId }).expect(201);
    await give(held, {
      assignmentId: planned.assignmentId,
      kind: 'acting',
      from: '2026-11-02',
    }).expect(201);
    const archived = detailOf(await post(`/api/classes/${held}/archive`).expect(200));
    expect(archived.tutors.map((row) => [row.kind, row.state, row.endCause])).toEqual([
      ['acting', 'ended', 'archive'],
      ['tutor', 'ended', 'archive'],
    ]);
    const restored = detailOf(await post(`/api/classes/${held}/restore`).expect(200));
    expect(restored.tutor).toBeNull();
    const archive = await entry('class.archive', held);
    expect((archive?.details as { tutorsEnded: unknown[] } | null)?.tutorsEnded).toHaveLength(2);
  });

  // Decision 16 with correction 5: the staff record keeps a language a class needs.
  it('refuses to drop a language from the staff record of a Tutor of a class of it', async () => {
    const held = await newClass('ru');
    const person = await tutor(['uz', 'ru']);
    await give(held, { assignmentId: person.assignmentId }).expect(201);
    const response = await put(`/api/people/staff/${person.staffId}/teaching`, {
      subjects: [],
      languages: ['uz'],
    }).expect(409);
    expect(errorCode(response)).toBe('tutor_language_held');
    expect(apiErrorSchema.parse(response.body).error.details?.[0]).toMatchObject({
      path: 'languages',
      recordId: held,
    });
    // Uzbek is not needed: it goes.
    await put(`/api/people/staff/${person.staffId}/teaching`, {
      subjects: [],
      languages: ['ru'],
    }).expect(200);
  });

  // Decision 20: a role end and a `left` name the Tutor rows they end.
  describe('the end of the role', () => {
    it('ends the Tutor rows and names them in the entry of the role end', async () => {
      const held = await newClass();
      const person = await tutor();
      const given = detailOf(await give(held, { assignmentId: person.assignmentId }).expect(201));
      const row = given.tutors[0]?.id ?? '';
      await post(
        `/api/people/staff/${person.staffId}/roles/${person.assignmentId}/end`,
        { from: '2026-11-02' },
        admin,
      ).expect(200);
      const ended = await entry('assignment.ended', person.assignmentId);
      expect(ended?.details).toMatchObject({
        tutorRows: [{ id: row, classId: held, from: null, to: expect.any(String) as string }],
      });
      expect(detailOf(await get(`/api/classes/${held}`).expect(200)).tutors[0]).toMatchObject({
        until: '2026-11-02',
        endCause: 'role',
      });
    });

    it('ends them at a `left` too, and names them in its entries', async () => {
      const held = await newClass();
      const person = await tutor();
      await give(held, { assignmentId: person.assignmentId }).expect(201);
      await post(
        `/api/people/staff/${person.staffId}/status`,
        { status: 'left', from: '2026-11-02' },
        admin,
      ).expect(200);
      const ended = await database.migrator
        .selectFrom('audit_log')
        .select('details')
        .where('action', '=', 'assignment.end')
        .where('record_id', '=', person.assignmentId)
        .executeTakeFirstOrThrow();
      expect(ended.details).toMatchObject({
        tutorRows: [expect.objectContaining({ classId: held })],
      });
    });
  });

  // .claude/rules/api.md: two changes at one moment, each pair in both directions.
  describe('at the same moment', () => {
    it('refuses the second give of one class: it waits for the first', async () => {
      const held = await newClass();
      const first = await tutor();
      const second = await tutor();
      const open = await holdOpen([north], (transaction) =>
        writeTutor(transaction, held, first.assignmentId),
      );
      const response = give(held, { assignmentId: second.assignmentId }).then((done) => done);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      await open.done;
      expect((await response).status).toBe(409);
      expect(errorCode(await response)).toBe('class_tutor_taken');
    });

    it('refuses a give that waited for a change of the class language', async () => {
      const held = await newClass();
      const person = await tutor(['uz']);
      const open = await holdOpen([north], async (transaction) => {
        await transaction
          .updateTable('classes')
          .set({ language: 'ru' })
          .where('id', '=', held)
          .execute();
      });
      const response = give(held, { assignmentId: person.assignmentId }).then((done) => done);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      await open.done;
      expect((await response).status).toBe(409);
      expect(errorCode(await response)).toBe('tutor_language');
    });

    it('refuses a change of the class language that waited for a give', async () => {
      const held = await newClass();
      const person = await tutor(['uz']);
      const read = detailOf(await get(`/api/classes/${held}`).expect(200));
      const open = await holdOpen([north], (transaction) =>
        writeTutor(transaction, held, person.assignmentId),
      );
      const response = put(`/api/classes/${held}`, {
        grade: read.grade,
        name: read.name,
        language: 'ru',
        mainRoomId: null,
        maxSize: read.maxSize,
        version: read.version,
      }).then((done) => done);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      await open.done;
      expect((await response).status).toBe(409);
      expect(errorCode(await response)).toBe('tutor_language');
    });

    it('refuses a give that waited for the language to leave the staff record', async () => {
      const held = await newClass();
      const person = await tutor(['uz', 'ru']);
      const open = await holdOpen([north], async (transaction) => {
        await transaction
          .selectFrom('staff')
          .select('id')
          .where('id', '=', person.staffId)
          .forUpdate()
          .execute();
        await transaction
          .deleteFrom('staff_languages')
          .where('staff_id', '=', person.staffId)
          .where('language', '=', 'uz')
          .execute();
      });
      const response = give(held, { assignmentId: person.assignmentId }).then((done) => done);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      await open.done;
      expect((await response).status).toBe(409);
      expect(errorCode(await response)).toBe('tutor_language');
    });

    it('refuses to drop a language after waiting for a give', async () => {
      const held = await newClass();
      const person = await tutor(['uz', 'ru']);
      const open = await holdOpen([north], (transaction) =>
        writeTutor(transaction, held, person.assignmentId),
      );
      const response = put(`/api/people/staff/${person.staffId}/teaching`, {
        subjects: [],
        languages: ['ru'],
      }).then((done) => done);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      await open.done;
      expect((await response).status).toBe(409);
      expect(errorCode(await response)).toBe('tutor_language_held');
    });

    it('refuses a give that waited for an archive', async () => {
      const held = await newClass();
      const person = await tutor();
      const open = await holdOpen([north], async (transaction) => {
        await transaction
          .updateTable('classes')
          .set({ archived_at: clock.now() })
          .where('id', '=', held)
          .execute();
      });
      const response = give(held, { assignmentId: person.assignmentId }).then((done) => done);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      await open.done;
      expect((await response).status).toBe(409);
      expect(errorCode(await response)).toBe('class_archived');
    });

    it('ends at the archive a Tutor given while it waited', async () => {
      const held = await newClass();
      const person = await tutor();
      const open = await holdOpen([north], (transaction) =>
        writeTutor(transaction, held, person.assignmentId),
      );
      const response = post(`/api/classes/${held}/archive`).then((done) => done);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      await open.done;
      expect((await response).status).toBe(200);
      expect(detailOf(await response).tutors[0]).toMatchObject({ endCause: 'archive' });
    });

    it('refuses a give that waited for the end of the role', async () => {
      const held = await newClass();
      const person = await tutor();
      const open = await holdOpen([north], async (transaction) => {
        await transaction
          .updateTable('assignments')
          .set({ valid_until: clock.now() })
          .where('id', '=', person.assignmentId)
          .execute();
      });
      const response = give(held, { assignmentId: person.assignmentId }).then((done) => done);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      await open.done;
      expect((await response).status).toBe(409);
      expect(errorCode(await response)).toBe('tutor_outside_role');
    });

    it('ends at the role end a Tutor given while it waited', async () => {
      const held = await newClass();
      const person = await tutor();
      const open = await holdOpen([north], (transaction) =>
        writeTutor(transaction, held, person.assignmentId),
      );
      const response = post(
        `/api/people/staff/${person.staffId}/roles/${person.assignmentId}/end`,
        { from: '2026-11-02' },
        admin,
      ).then((done) => done);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      await open.done;
      expect((await response).status).toBe(200);
      const row = await database.migrator
        .selectFrom('class_tutors')
        .select(['end_cause'])
        .where('class_id', '=', held)
        .executeTakeFirstOrThrow();
      expect(row.end_cause).toBe('role');
    });

    it.each([
      ['Oxford', 'Оxford'],
      ['Оxford', 'Oxford'],
    ])('refuses the create of a look-alike name that waited: %s, then %s', async (held, typed) => {
      count += 1;
      const grade = (count % 11) + 1;
      const name = (base: string) => `${base} Twin ${String.fromCharCode(97 + (count % 26))}`;
      const open = await holdOpen([north], async (transaction) => {
        await transaction
          .insertInto('classes')
          .values({
            branch_id: north,
            academic_year_id: northYear,
            grade,
            name: name(held),
            language: 'uz',
            max_size: 25,
          })
          .execute();
      });
      const response = post('/api/classes', {
        academicYearId: northYear,
        grade,
        name: name(typed),
        language: 'uz',
        mainRoomId: null,
        maxSize: 25,
      }).then((done) => done);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      open.release();
      await open.done;
      expect((await response).status).toBe(409);
      expect(errorCode(await response)).toBe('already_exists');
    });
  });
});
