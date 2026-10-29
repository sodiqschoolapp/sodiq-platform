import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { BRANCH_HEADER } from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../database/transactions.js';
import { Audit } from '../modules/audit/audit.service.js';
import { insertBranch } from '../testing/branch-filter-sql.js';
import { createTestApp } from '../testing/create-test-app.js';
import { FixedClock } from '../testing/fixed-clock.js';
import { K6_SCRIPT, runK6Script } from '../testing/k6-script.js';
import { MembersKit } from '../testing/members-kit.js';
import { NEW_PASSWORD, signInKit, type SignInKit } from '../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { MonitoringApi, signIn } from './monitoring-api.js';
import {
  buildMonitoringBranch,
  markMonitoringBranch,
  MonitoringBranchRefused,
  monitoringPrecheck,
  touchingQuarters,
  type MonitoringBranchBuilt,
} from './monitoring-branch.js';

/** Wednesday 28 October 2026, 16:00 in Tashkent: the owner runs the command after the school day. */
const RUN = '2026-10-28T16:00:00+05:00';

/** The test teacher's password, set at the owner's one sign-in by hand (docs/monitoring.md). */
const TEACHER_PASSWORD = 'a-monitoring-password-41';

// Task 10.2b: the Monitoring branch built by the owner's command through the real routes (plan
// decisions 3 and 7; answer 10), and the sign-in-and-save check of Grafana run against it.
describe('the command that builds the Monitoring branch, and the check that uses it', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let kit: SignInKit;
  let base: string;
  const clock = new FixedClock(RUN);
  let built: MonitoringBranchBuilt;
  const lines: string[] = [];
  let north: string;
  let branchesAfterRefusals: string[] = [];

  /** An active subject of the school, written as setup writes it. */
  const subject = async (en: string, groupSubject: boolean) => {
    const steam = await database.migrator
      .selectFrom('departments')
      .select('id')
      .where('name_en', '=', 'STEAM')
      .executeTakeFirstOrThrow();
    await database.migrator
      .insertInto('subjects')
      .values({
        name_uz: en,
        name_ru: en,
        name_en: en,
        department_id: steam.id,
        grades: [5, 6, 7],
        colour: 'blue',
        journal_type: 'graded',
        group_subject: groupSubject,
      })
      .execute();
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({ database: database.app, clock, jobsDatabaseUrl: database.appUrl });
    const server = app.getHttpServer();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    // A branch of the school and its subjects, as on production.
    north = await insertBranch(database.migrator, 'North');
    await subject('Mathematics', false);
    await subject('English', true);
    kit = signInKit(app, { newAccountsHold: { role: 'super_admin' } });
    const admin = await kit.completeSession('Owner', 'Sodiq');
    const transactions = app.get(Transactions);

    // Refused before anything is written: no subject of that name, a subject of groups, an
    // invented UID held by a student of any branch, also one it held before, in another case (9.4c).
    await expect(monitoringPrecheck(transactions, 'Astronomy')).rejects.toThrow(
      MonitoringBranchRefused,
    );
    await expect(monitoringPrecheck(transactions, 'English')).rejects.toThrow('taught in groups');
    const clash = await new MembersKit(database.migrator, admin.account.id).student(north);
    await database.migrator
      .insertInto('student_uids')
      .values({
        uid: 'mon0002',
        student_id: clash,
        branch_id: north,
        held_from: new Date('2026-08-01T09:00:00+05:00'),
      })
      .execute();
    await expect(monitoringPrecheck(transactions, 'Mathematics')).rejects.toThrow('UIDs');
    await database.migrator.deleteFrom('student_uids').where('uid', '=', 'mon0002').execute();
    branchesAfterRefusals = (
      await database.migrator.selectFrom('branches').select('id').execute()
    ).map((one) => one.id);

    const api = new MonitoringApi(base);
    clock.advance(31_000);
    await signIn(api, admin.account.login, NEW_PASSWORD, () =>
      Promise.resolve(kit.codeOf(admin.secret)),
    );
    built = await buildMonitoringBranch(
      api,
      {
        subject: await monitoringPrecheck(transactions, 'Mathematics'),
        yearStart: '2026-10-29',
        yearEnd: '2027-08-31',
      },
      (branchId) =>
        markMonitoringBranch(transactions, app.get(Audit), {
          login: admin.account.login,
          branchId,
        }),
      (line) => lines.push(line),
    );
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('wrote nothing when it refused, and refuses a second Monitoring branch', async () => {
    expect(branchesAfterRefusals).toEqual([north]);
    await expect(monitoringPrecheck(app.get(Transactions), 'Mathematics')).rejects.toThrow(
      'exists already',
    );
  });

  it('splits the year into four quarters that touch', () => {
    expect(touchingQuarters('2026-10-29', '2027-08-31')).toEqual([
      { startDate: '2026-10-29', endDate: '2027-01-13' },
      { startDate: '2027-01-14', endDate: '2027-03-31' },
      { startDate: '2027-04-01', endDate: '2027-06-16' },
      { startDate: '2027-06-17', endDate: '2027-08-31' },
    ]);
  });

  it('builds the marked branch, with its audit entry and one lesson a day from the next day', async () => {
    expect(lines).toHaveLength(6);
    const branch = await database.migrator
      .selectFrom('branches')
      .select(['purpose', 'working_weekdays'])
      .where('id', '=', built.branchId)
      .executeTakeFirstOrThrow();
    expect(branch).toEqual({ purpose: 'monitoring', working_weekdays: [1, 2, 3, 4, 5, 6, 7] });
    const marked = await database.migrator
      .selectFrom('audit_log_school')
      .select(['record_id', 'assignment_id'])
      .where('action', '=', 'branch.monitoring')
      .execute();
    expect(marked).toHaveLength(1);
    expect(marked[0]?.record_id).toBe(built.branchId);
    expect(marked[0]?.assignment_id).not.toBeNull();
    const lessons = await database.migrator
      .selectFrom('lessons')
      .select(['lesson_date'])
      .where('class_id', '=', built.classId)
      .orderBy('starts_at')
      .execute();
    // Every day from the 29th of October to the 31st of August.
    expect(lessons).toHaveLength(307);
    expect(lessons[0]?.lesson_date).toBe('2026-10-29');
  });

  let teacherReady = false;

  /** Runs the k6 check of the repository at a moment in Tashkent. */
  const runCheck = async (moment: string) => {
    if (!teacherReady) {
      const first = new MonitoringApi(base);
      await first.post('/api/auth/sign-in', {
        login: built.teacherLogin,
        password: built.teacherFirstPassword,
      });
      await first.post('/api/auth/password', {
        currentPassword: built.teacherFirstPassword,
        newPassword: TEACHER_PASSWORD,
      });
      teacherReady = true;
    }
    clock.set(moment);
    return runK6Script({
      base,
      secrets: {
        'monitoring-teacher-login': built.teacherLogin,
        'monitoring-teacher-password': TEACHER_PASSWORD,
      },
    });
  };

  /** The attendance cells of the class, the newest change first. */
  const cells = () =>
    database.migrator
      .selectFrom('journal_cells')
      .innerJoin('lessons', 'lessons.id', 'journal_cells.lesson_id')
      .select(['journal_cells.mark', 'journal_cells.version', 'lessons.lesson_date'])
      .where('lessons.class_id', '=', built.classId)
      .where('journal_cells.work_id', 'is', null)
      .orderBy('journal_cells.changed_at', 'desc')
      .execute();

  // edge/system-behaviour: "A test teacher account signs in and saves a cell in a test class
  // every 5 minutes from 07:00". The file run is the one pasted into Grafana.
  it.each([
    ['the next day, a Thursday', '2026-10-29T07:00:00+05:00'],
    ['a Saturday', '2026-10-31T07:00:00+05:00'],
    ['a Sunday', '2026-11-01T07:00:00+05:00'],
    ['a Monday', '2026-11-02T07:05:00+05:00'],
    ['the first day of the second quarter', '2027-01-14T07:00:00+05:00'],
  ])('signs in and saves the 06:30 cell on %s', async (_day, moment) => {
    const run = await runCheck(moment);
    expect(run.failure).toBeNull();
    expect(run.requests.map((one) => `${one.method} ${one.path} ${String(one.status)}`)).toEqual([
      'POST /api/auth/sign-in 200',
      'GET /api/timetable/home 200',
      expect.stringMatching(/^GET \/api\/journal\/journals\/[0-9a-f-]+ 200$/),
      expect.stringMatching(/^POST \/api\/journal\/lessons\/[0-9a-f-]+\/attendance 200$/),
      'POST /api/auth/sign-out 204',
    ]);
    const [newest] = await cells();
    expect(newest?.lesson_date).toBe(moment.slice(0, 10));
  });

  it('switches the mark between present and late on each run, a real save each time', async () => {
    const [before] = await cells();
    const run = await runCheck('2027-01-14T07:05:00+05:00');
    expect(run.failure).toBeNull();
    const [after] = await cells();
    expect(after?.version).toBe((before?.version ?? 0) + 1);
    expect([before?.mark, after?.mark].sort()).toEqual([1, 2]);
  });

  it("fails, and still signs out, before the day's lesson has started", async () => {
    const run = await runCheck('2027-01-15T06:20:00+05:00');
    expect(run.failure).toBe('save: 409');
    expect(run.requests.at(-1)).toMatchObject({ path: '/api/auth/sign-out', status: 204 });
  });

  it('logs nothing of an answer and names no person', () => {
    const script = readFileSync(K6_SCRIPT, 'utf8');
    expect(script).not.toMatch(/console\./);
    expect(script).not.toContain('Sinov');
  });

  // The owner on #261: "refuse the Monitoring branch to the Senior Head Teacher". A Senior Head
  // Teacher of the class's own subject is refused its journal and its timetable there, and
  // reads both once the branch is unmarked (plan, Tests, Permissions; review decision 3).
  it('refuses the journal and the timetable of the Monitoring class to a Senior Head Teacher of its subject', async () => {
    const mathematics = await database.migrator
      .selectFrom('subjects')
      .select('id')
      .where('name_en', '=', 'Mathematics')
      .executeTakeFirstOrThrow();
    const plain = signInKit(app);
    const { account, cookie } = await plain.fullSession('Nodir', 'Qodirov');
    await plain.giveRole(account.id, { role: 'senior_head_teacher', subjectIds: [mathematics.id] });
    const journal = await database.migrator
      .selectFrom('journals')
      .select('id')
      .where('branch_id', '=', built.branchId)
      .executeTakeFirstOrThrow();
    const reads = async () => {
      const call = (path: string) =>
        request(app.getHttpServer())
          .get(path)
          .set('Cookie', cookie)
          .set(BRANCH_HEADER, built.branchId);
      return [
        (await call(`/api/journal/journals/${journal.id}`)).status,
        (await call(`/api/timetable/views/choices?date=2027-01-14`)).status,
      ];
    };
    expect(await reads()).toEqual([403, 403]);
    const setPurpose = (purpose: string | null) =>
      database.migrator
        .updateTable('branches')
        .set({ purpose })
        .where('id', '=', built.branchId)
        .execute();
    await setPurpose(null);
    try {
      expect(await reads()).toEqual([200, 200]);
    } finally {
      await setPurpose('monitoring');
    }
  });
});
