import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  BRANCH_HEADER,
  branchListSchema,
  branchMoveTargetsSchema,
  sessionResponseSchema,
  travelTimeListSchema,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createDatabase } from '../../database/database.js';
import { Transactions } from '../../database/transactions.js';
import { createTestApp } from '../../testing/create-test-app.js';
import {
  assignmentsAnswerSchema,
  TEACHER_ONLY_PERMISSIONS,
  TeacherOnlySampleController,
} from '../../testing/permission-sample.controller.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { errorCode, signInKit, type SignInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { postHolders } from './request-posts.js';

// Task 10.2b. Answer 10: "the Super Admin sees it in the branch switcher as 'Monitoring'"; the
// owner on pull request #261 (29 October 2026): "refuse the Monitoring branch to the Senior Head
// Teacher; only the Super Admin sees it". `02`, Rules: the Senior Head Teacher works "in every
// branch" otherwise, which the same requests in a real branch prove.
describe('the hidden Monitoring branch and who reaches it', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let server: Server;
  let kit: SignInKit;
  let north: string;
  let south: string;
  let monitoring: string;
  const clock = new FixedClock('2026-10-12T09:00:00+05:00');

  // `GET /api/setup/current-period` (`current_period`, view): a route of the branch of the
  // request that the Senior Head Teacher, the Super Admin and the Teacher may call, with no
  // narrower scope inside it, so the guard alone decides.
  const period = (cookie: string, branch: string): Promise<Response> =>
    request(server)
      .get('/api/setup/current-period')
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch);

  const branchesOf = async (cookie: string): Promise<string[]> => {
    const response = await request(server).get('/api/auth/session').set('Cookie', cookie);
    expect(response.status).toBe(200);
    return sessionResponseSchema.parse(response.body).branches.map((branch) => branch.id);
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    monitoring = await insertBranch(database.migrator, 'Monitoring');
    await sql`select monitoring_branch_mark(${monitoring}::uuid)`.execute(database.migrator);
    app = await createTestApp({ database: database.app, clock });
    server = app.getHttpServer();
    kit = signInKit(app);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('refuses it to the Senior Head Teacher, who still reaches a real branch', async () => {
    const { account, cookie } = await kit.fullSession('Farrux', 'Aliyev');
    await kit.giveRole(account.id, { role: 'senior_head_teacher' });

    expect((await period(cookie, north)).status).toBe(200);
    const refused = await period(cookie, monitoring);
    expect(refused.status).toBe(403);
    expect(errorCode(refused)).toBe('permission_denied');
    expect((await branchesOf(cookie)).sort()).toEqual([north, south].sort());
  });

  it('lets the Super Admin in and lists it in the switcher', async () => {
    const strict = signInKit(app, { newAccountsHold: { role: 'super_admin' } });
    const { cookie } = await strict.completeSession('Lola', 'Umarova');

    expect((await period(cookie, monitoring)).status).toBe(200);
    expect((await branchesOf(cookie)).sort()).toEqual([north, south, monitoring].sort());
  });

  it('lets its own test teacher in, and only there', async () => {
    const { account, cookie } = await kit.fullSession('Sinov', 'Oʻqituvchi');
    await kit.giveRole(account.id, { role: 'teacher', branchId: monitoring });

    expect((await period(cookie, monitoring)).status).toBe(200);
    expect((await period(cookie, north)).status).toBe(403);
    expect(await branchesOf(cookie)).toEqual([monitoring]);
  });

  it('lets a Senior Head Teacher who also teaches there in through that assignment', async () => {
    const { account, cookie } = await kit.fullSession('Dilshod', 'Karimov');
    await kit.giveRole(account.id, { role: 'senior_head_teacher' });
    await kit.giveRole(account.id, { role: 'teacher', branchId: monitoring });

    const response = await period(cookie, monitoring);
    expect(response.status).toBe(200);
    expect((await branchesOf(cookie)).sort()).toEqual([north, south, monitoring].sort());
  });

  // The Super Admin's lists that name every other branch: the Branches page marks it; a travel
  // time to it and a release of a student to it are never offered.
  it('marks it on the Branches page and leaves it out of travel times and release targets', async () => {
    const strict = signInKit(app, { newAccountsHold: { role: 'super_admin' } });
    const { cookie } = await strict.completeSession('Malika', 'Tursunova');
    const get = (path: string, branch?: string) => {
      const call = request(server).get(path).set('Cookie', cookie);
      return branch === undefined ? call : call.set(BRANCH_HEADER, branch);
    };

    const listed = branchListSchema.parse((await get('/api/setup/branches')).body).branches;
    expect(listed.map((branch) => [branch.id, branch.monitoring]).sort()).toEqual(
      [
        [north, false],
        [south, false],
        [monitoring, true],
      ].sort(),
    );
    const travel = await get('/api/setup/travel-times', north);
    expect(travel.status).toBe(200);
    expect(travelTimeListSchema.parse(travel.body).pairs.map((pair) => pair.branchId)).toEqual([
      south,
    ]);
    const targets = await get('/api/people/branch-moves/targets', north);
    expect(targets.status).toBe(200);
    expect(branchMoveTargetsSchema.parse(targets.body).branches.map((branch) => branch.id)).toEqual(
      [south],
    );
  });

  // A plan request or an unlock is decided by the post of its subject (task 7.2): the Senior Head
  // Teacher of the subject holds it in every branch but the Monitoring branch.
  it('gives the Senior Head Teacher no post in it, and the post of the subject in a real branch', async () => {
    const { account } = await kit.fullSession('Rustam', 'Nazarov');
    await kit.giveRole(account.id, { role: 'senior_head_teacher' });
    const subject = await database.migrator
      .selectFrom('assignment_subjects')
      .innerJoin('assignments', 'assignments.id', 'assignment_subjects.assignment_id')
      .select('assignment_subjects.subject_id')
      .where('assignments.account_id', '=', account.id)
      .executeTakeFirstOrThrow();
    const holders = (branch: string) =>
      app
        .get(Transactions)
        .run([branch], (transaction) =>
          postHolders(transaction, branch, subject.subject_id, clock.now()),
        );
    expect(await holders(north)).toContainEqual({
      accountId: account.id,
      post: 'senior_head_teacher',
    });
    expect((await holders(monitoring)).map((holder) => holder.accountId)).not.toContain(account.id);
  });

  // Permission review of the code, must-fix 1: when another assignment lets the request in, the
  // Senior Head Teacher's assignment is still not among those a route decides parts from.
  it('keeps the Senior Head Teacher out of the assignments a route reads, when the Teacher role lets the request in', async () => {
    const probe = await createTestApp({
      database: createDatabase(database.appUrl),
      clock,
      controllers: [TeacherOnlySampleController],
      permissionTable: TEACHER_ONLY_PERMISSIONS,
    });
    try {
      const probeKit = signInKit(probe);
      const { account, cookie } = await probeKit.fullSession('Bekzod', 'Yusupov');
      await probeKit.giveRole(account.id, { role: 'senior_head_teacher' });
      await probeKit.giveRole(account.id, { role: 'teacher', branchId: monitoring });
      await probeKit.giveRole(account.id, { role: 'teacher', branchId: north });
      const rolesIn = async (branch: string) => {
        const response = await request(probe.getHttpServer())
          .get('/api/permission-sample/teacher-only')
          .set('Cookie', cookie)
          .set(BRANCH_HEADER, branch);
        expect(response.status).toBe(200);
        return assignmentsAnswerSchema.parse(response.body).roles.sort();
      };
      expect(await rolesIn(monitoring)).toEqual(['teacher', 'teacher']);
      expect(await rolesIn(north)).toEqual(['senior_head_teacher', 'teacher', 'teacher']);
    } finally {
      await probe.close();
    }
  });

  // Permission review of the code, must-fix 2 and should-fix 3: the hidden branch is no target
  // of a release or of a travel time, answered as an unknown branch, with nothing written.
  it('refuses a travel time to it as to an unknown branch', async () => {
    const strict = signInKit(app, { newAccountsHold: { role: 'super_admin' } });
    const { cookie } = await strict.completeSession('Kamola', 'Ergasheva');
    const set = (branch: string, other: string) =>
      request(server)
        .put('/api/setup/travel-times')
        .set('Cookie', cookie)
        .set(BRANCH_HEADER, branch)
        .send({ otherBranchId: other, minutes: 30 });
    const audit = () =>
      database.migrator
        .selectFrom('audit_log')
        .select('id')
        .where('action', '=', 'travel_time.set')
        .execute();
    const before = await audit();
    expect((await set(north, monitoring)).status).toBe(404);
    expect((await set(monitoring, north)).status).toBe(404);
    expect(await database.migrator.selectFrom('travel_times').selectAll().execute()).toEqual([]);
    expect(await audit()).toEqual(before);
    expect((await set(north, south)).status).toBe(200);
  });
});
