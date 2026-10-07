import type { INestApplication } from '@nestjs/common';
import { sessionResponseSchema } from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import {
  cookieOf,
  NEW_PASSWORD,
  ProbeController,
  signInKit,
  type SignInKit,
} from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

// Task 0.8c: the session answer lists the assignments and the branches for the
// menu and the switchers. Display only; all names are invented.
describe('GET /api/auth/session: roles and branches for the menu', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let north: string;
  let south: string;
  let east: string;
  const clock = new FixedClock('2026-10-06T09:00:00+05:00');

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({ database: database.app, clock, controllers: [ProbeController] });
    kit = signInKit(app);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    east = await insertBranch(database.migrator, 'East');
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  const sessionOf = async (cookie: string) => {
    const response = await kit.get('/api/auth/session', cookie);
    expect(response.status).toBe(200);
    return sessionResponseSchema.parse(response.body);
  };

  it('is refused without a session', async () => {
    const response = await request(kit.server).get('/api/auth/session');

    expect(response.status).toBe(401);
  });

  it('lists nothing for an account without a role', async () => {
    const { cookie } = await kit.fullSession('Dilnoza', 'Karimova');

    expect(await sessionOf(cookie)).toMatchObject({ assignments: [], branches: [] });
  });

  it('lists the roles in the order of the table and the own branches by name', async () => {
    const { account, cookie } = await kit.fullSession('Eldor', 'Rahimov');
    await kit.giveRole(account.id, { role: 'teacher', branchId: south });
    await kit.giveRole(account.id, { role: 'tutor', branchId: north });
    await kit.giveRole(account.id, { role: 'teacher', branchId: north });

    const answer = await sessionOf(cookie);

    expect(answer.assignments).toEqual([
      { role: 'tutor', branchId: north },
      ...[north, south].sort().map((branchId) => ({ role: 'teacher' as const, branchId })),
    ]);
    expect(answer.branches).toEqual([
      { id: north, name: 'North' },
      { id: south, name: 'South' },
    ]);
  });

  it('gives a Senior Head Teacher every branch and no branch of its own on the assignment', async () => {
    const { account, cookie } = await kit.fullSession('Farrux', 'Aliyev');
    await kit.giveRole(account.id, { role: 'senior_head_teacher' });

    const answer = await sessionOf(cookie);

    expect(answer.assignments).toEqual([{ role: 'senior_head_teacher', branchId: null }]);
    expect(answer.branches.map((branch) => branch.name)).toEqual(['East', 'North', 'South']);
  });

  it('gives a Super Admin every branch', async () => {
    const { account, cookie } = await kit.completeSession('Lola', 'Umarova');
    await kit.giveRole(account.id, { role: 'super_admin' });

    const answer = await sessionOf(cookie);

    expect(answer.assignments).toEqual([{ role: 'super_admin', branchId: null }]);
    expect(answer.branches.map((branch) => branch.name)).toEqual(['East', 'North', 'South']);
  });

  it('lists nothing while the set-up of a required second step is owed', async () => {
    const { account, cookie } = await kit.fullSession('Mansur', 'Hakimov');
    await kit.giveRole(account.id, { role: 'super_admin' });

    expect(await sessionOf(cookie)).toMatchObject({
      secondStep: 'set_up_required',
      assignments: [],
      branches: [],
    });
  });

  it('gives a Principal of one branch only that branch, and a mixed account every branch', async () => {
    const principal = await kit.fullSession('Nodira', 'Qosimova');
    await kit.giveRole(principal.account.id, { role: 'principal', branchId: east });
    const mixed = await kit.fullSession('Otabek', 'Mirzayev');
    await kit.giveRole(mixed.account.id, { role: 'teacher', branchId: east });
    await kit.giveRole(mixed.account.id, { role: 'senior_head_teacher' });

    expect((await sessionOf(principal.cookie)).branches).toEqual([{ id: east, name: 'East' }]);
    expect((await sessionOf(mixed.cookie)).branches).toHaveLength(3);
  });

  it('leaves out an assignment that has ended and one that begins later', async () => {
    const { account, cookie } = await kit.fullSession('Gulnora', 'Saidova');
    const ended = await kit.giveRole(account.id, { role: 'head_tutor', branchId: south });
    await kit.giveRole(account.id, { role: 'teacher', branchId: north });
    await kit.giveRole(account.id, {
      role: 'tutor',
      branchId: east,
      validFrom: new Date(clock.now().getTime() + 24 * 60 * 60 * 1000),
    });
    await kit.endRole(ended.id, account.id, south);

    const answer = await sessionOf(cookie);

    expect(answer.assignments).toEqual([{ role: 'teacher', branchId: north }]);
    expect(answer.branches).toEqual([{ id: north, name: 'North' }]);
  });

  it('never shows the assignments of another account', async () => {
    const first = await kit.fullSession('Hamid', 'Yusupov');
    const second = await kit.fullSession('Iroda', 'Nazarova');
    await kit.giveRole(first.account.id, { role: 'teacher', branchId: north });
    await kit.giveRole(second.account.id, { role: 'tutor', branchId: south });

    expect((await sessionOf(first.cookie)).assignments).toEqual([
      { role: 'teacher', branchId: north },
    ]);
    expect((await sessionOf(second.cookie)).branches).toEqual([{ id: south, name: 'South' }]);
  });

  it('lists nothing while the forced password change is owed', async () => {
    const { account, cookie } = await kit.firstSession('Jasur', 'Tursunov');
    await kit.giveRole(account.id, { role: 'teacher', branchId: north });

    const response = await kit.get('/api/auth/session', cookie);

    expect(sessionResponseSchema.parse(response.body)).toMatchObject({
      mustChangePassword: true,
      assignments: [],
      branches: [],
    });
  });

  it('lists nothing while the second step is owed, and the roles after it', async () => {
    const { account, secret } = await kit.completeSession('Kamola', 'Ergasheva');
    await kit.giveRole(account.id, { role: 'teacher', branchId: north });
    // A new browser: the account has a second step, so this session owes it.
    const response = await kit.signIn(account.login, NEW_PASSWORD);
    const cookie = cookieOf(response);
    if (cookie === undefined) {
      throw new Error('The sign-in set no session cookie.');
    }

    expect(await sessionOf(cookie)).toMatchObject({
      secondStep: 'pending',
      assignments: [],
      branches: [],
    });

    const passed = await kit.passSecondStep(cookie, kit.codeOf(secret, 1));
    expect(passed.status).toBe(200);
    expect(sessionResponseSchema.parse(passed.body).assignments).toEqual([
      { role: 'teacher', branchId: north },
    ]);
    expect((await sessionOf(cookie)).branches).toEqual([{ id: north, name: 'North' }]);
  });
});
