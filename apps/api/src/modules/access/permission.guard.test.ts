import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { apiErrorSchema, BRANCH_HEADER } from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import {
  accessAnswerSchema,
  FaultyAccessController,
  PermissionSampleController,
  SAMPLE_PERMISSIONS,
} from '../../testing/permission-sample.controller.js';
import { errorCode, signInKit, type SignInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

// Stands for something a person typed.
const TYPED_VALUE = 'Typed-Value-Bobur-5521';

const MINUTE = 60_000;

// docs/spec/02-roles-and-access.md, Rules and build order: "Every request
// passes one permission check on the server", by role and branch.
describe('the permission guard', () => {
  let database: TestDatabase;
  let clock: FixedClock;
  let app: NestExpressApplication;
  let server: Server;
  let kit: SignInKit;
  let north: string;
  let south: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    clock = new FixedClock('2026-10-05T09:00:00+05:00');
    app = await createTestApp({
      database: database.app,
      clock,
      controllers: [PermissionSampleController, FaultyAccessController],
      permissionTable: SAMPLE_PERMISSIONS,
    });
    server = app.getHttpServer();
    kit = signInKit(app);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  const view = (cookies: string | undefined, branch?: string): Promise<Response> => {
    let call = request(server).get('/api/permission-sample/view');
    if (cookies !== undefined) {
      call = call.set('Cookie', cookies);
    }
    return branch === undefined ? call : call.set(BRANCH_HEADER, branch);
  };

  const edit = (cookies: string, branch: string): Promise<Response> =>
    request(server)
      .post('/api/permission-sample/edit')
      .set('Cookie', cookies)
      .set(BRANCH_HEADER, branch);

  it('allows a role the table gives the action, in the branch of the assignment, and names both', async () => {
    const browser = await kit.fullSession('Aziza', 'Rahimova');
    const assignment = await kit.giveRole(browser.account.id, { role: 'teacher', branchId: north });

    const response = await view(browser.cookie, north);

    expect(response.status).toBe(200);
    expect(accessAnswerSchema.parse(response.body)).toEqual({
      accountId: browser.account.id,
      assignmentId: assignment.id,
      role: 'teacher',
      branchId: north,
      branchIds: [north],
    });
  });

  it('refuses an action the table does not give the role', async () => {
    const browser = await kit.fullSession('Bahrom', 'Yusupov');
    await kit.giveRole(browser.account.id, { role: 'teacher', branchId: north });

    const response = await edit(browser.cookie, north);

    expect(response.status).toBe(403);
    expect(errorCode(response)).toBe('permission_denied');
  });

  // An account without a current assignment can sign in (decided in 0.7a); it may do nothing here.
  it('refuses an account that holds no role', async () => {
    const browser = await kit.fullSession('Charos', 'Nazarova');

    const response = await view(browser.cookie, north);

    expect(response.status).toBe(403);
    expect(errorCode(response)).toBe('permission_denied');
  });

  // Rules: "Every role is limited to a branch ... enforced on the server".
  it('refuses the branch of somebody else exactly as it refuses a branch that does not exist', async () => {
    const browser = await kit.fullSession('Davron', 'Ergashev');
    await kit.giveRole(browser.account.id, { role: 'head_teacher', branchId: north });

    const foreign = await view(browser.cookie, south);
    const unknown = await view(browser.cookie, randomUUID());

    for (const response of [foreign, unknown]) {
      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('permission_denied');
    }
    // The same answer in every field but the id of the request.
    const withoutRequestId = (response: Response) => ({
      ...apiErrorSchema.parse(response.body).error,
      requestId: '',
    });
    expect(withoutRequestId(unknown)).toEqual(withoutRequestId(foreign));
  });

  // Rules: "Only the Super Admin and the Senior Head Teacher work across branches."
  it('allows a Senior Head Teacher every branch that exists, and no branch that does not', async () => {
    const browser = await kit.fullSession('Eldor', 'Sobirov');
    const assignment = await kit.giveRole(browser.account.id, { role: 'senior_head_teacher' });

    for (const branch of [north, south]) {
      const response = await edit(browser.cookie, branch);
      expect(response.status).toBe(201);
      expect(accessAnswerSchema.parse(response.body)).toMatchObject({
        assignmentId: assignment.id,
        branchId: branch,
        branchIds: [branch],
      });
    }
    const nowhere = await edit(browser.cookie, randomUUID());
    expect(nowhere.status).toBe(403);
    expect(errorCode(nowhere)).toBe('permission_denied');
  });

  // Edge cases, "Who can act": "The server allows an action if any current
  // assignment permits it ... The audit log records which assignment allowed
  // the action."
  it('allows what any assignment of the account permits and names that assignment', async () => {
    const browser = await kit.fullSession('Feruza', 'Olimova');
    await kit.giveRole(browser.account.id, { role: 'teacher', branchId: north });
    await kit.giveRole(browser.account.id, { role: 'tutor', branchId: north });
    const headTeacher = await kit.giveRole(browser.account.id, {
      role: 'head_teacher',
      branchId: north,
    });
    await kit.giveRole(browser.account.id, { role: 'teacher', branchId: south });

    const inNorth = await edit(browser.cookie, north);
    const inSouth = await edit(browser.cookie, south);

    expect(inNorth.status).toBe(201);
    expect(accessAnswerSchema.parse(inNorth.body)).toMatchObject({
      assignmentId: headTeacher.id,
      role: 'head_teacher',
    });
    expect(inSouth.status).toBe(403);
  });

  it('names the first by id when several assignments permit', async () => {
    const browser = await kit.fullSession('Yulduz', 'Ahmedova');
    const given = [
      await kit.giveRole(browser.account.id, { role: 'head_teacher', branchId: north }),
      await kit.giveRole(browser.account.id, { role: 'teacher', branchId: north }),
      await kit.giveRole(browser.account.id, { role: 'senior_head_teacher' }),
    ];
    const first = given.map((assignment) => assignment.id).sort()[0];

    const response = await view(browser.cookie, north);

    expect(response.status).toBe(200);
    expect(accessAnswerSchema.parse(response.body).assignmentId).toBe(first);
  });

  it('reads a branch id in capital letters as the same branch', async () => {
    const browser = await kit.fullSession('Gulnora', 'Saidova');
    await kit.giveRole(browser.account.id, { role: 'teacher', branchId: north });

    const response = await view(browser.cookie, north.toUpperCase());

    expect(response.status).toBe(200);
    expect(accessAnswerSchema.parse(response.body).branchIds).toEqual([north]);
  });

  it.each([
    ['no branch header', undefined, 'invalid_type'],
    ['a branch header that is not an id', TYPED_VALUE, 'invalid_format'],
  ])('refuses a request with %s and names the header', async (_name, branch, code) => {
    const browser = await kit.fullSession('Hasan', 'Qodirov');
    await kit.giveRole(browser.account.id, { role: 'teacher', branchId: north });

    const response = await view(browser.cookie, branch);

    expect(response.status).toBe(400);
    const parsed = apiErrorSchema.parse(response.body);
    expect(parsed.error.code).toBe('validation_failed');
    expect(parsed.error.details).toEqual([
      { path: 'X-Branch-Id', code, message: expect.any(String) as string },
    ]);
    expect(response.text).not.toContain(TYPED_VALUE);
  });

  // Edge cases, "Accounts and sign-in": "Rights are read again on every request."
  it('refuses at the next request once the role has ended', async () => {
    const browser = await kit.fullSession('Iroda', 'Valieva');
    const other = await kit.newAccount('Jamshid', 'Toshev');
    const assignment = await kit.giveRole(browser.account.id, { role: 'teacher', branchId: north });
    expect((await view(browser.cookie, north)).status).toBe(200);

    await kit.endRole(assignment.id, other.id, north);
    const response = await view(browser.cookie, north);

    expect(response.status).toBe(403);
    expect(errorCode(response)).toBe('permission_denied');
  });

  it('does not count a role before the moment it begins', async () => {
    const browser = await kit.fullSession('Kamola', 'Ismoilova');
    await kit.giveRole(browser.account.id, {
      role: 'teacher',
      branchId: north,
      validFrom: new Date(clock.now().getTime() + 10 * MINUTE),
    });

    const before = await view(browser.cookie, north);
    clock.advance(10 * MINUTE);
    const from = await view(browser.cookie, north);

    expect(before.status).toBe(403);
    expect(from.status).toBe(200);
  });

  describe('on a route for school-wide work', () => {
    const school = (cookies: string, branch?: string): Promise<Response> => {
      const call = request(server).get('/api/permission-sample/school').set('Cookie', cookies);
      return branch === undefined ? call : call.set(BRANCH_HEADER, branch);
    };

    it('needs no branch and gives the transaction none', async () => {
      const browser = await kit.fullSession('Laziz', 'Hamidov');
      const assignment = await kit.giveRole(browser.account.id, {
        role: 'head_teacher',
        branchId: south,
      });

      const response = await school(browser.cookie);

      expect(response.status).toBe(200);
      expect(accessAnswerSchema.parse(response.body)).toEqual({
        accountId: browser.account.id,
        assignmentId: assignment.id,
        role: 'head_teacher',
        branchId: null,
        branchIds: [],
      });
    });

    it('does not read a branch header that is sent all the same', async () => {
      const browser = await kit.fullSession('Malika', 'Jurayeva');
      await kit.giveRole(browser.account.id, { role: 'head_teacher', branchId: south });

      const response = await school(browser.cookie, TYPED_VALUE);

      expect(response.status).toBe(200);
      expect(accessAnswerSchema.parse(response.body).branchIds).toEqual([]);
    });

    it('refuses a role the table does not give the action', async () => {
      const browser = await kit.fullSession('Nodir', 'Abdullayev');
      await kit.giveRole(browser.account.id, { role: 'teacher', branchId: south });

      const response = await school(browser.cookie);

      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('permission_denied');
    });
  });

  describe('comes after the session guard', () => {
    it('answers "not signed in" before anything about permissions', async () => {
      const noHeader = await view(undefined);
      const withBranch = await view(undefined, north);

      for (const response of [noHeader, withBranch]) {
        expect(response.status).toBe(401);
        expect(errorCode(response)).toBe('not_signed_in');
      }
    });

    it('lets a session that owes the password change reach no route with a permission', async () => {
      const browser = await kit.firstSession('Odina', 'Karimova');
      await kit.giveRole(browser.account.id, { role: 'teacher', branchId: north });

      const response = await view(browser.cookie, north);

      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('password_change_required');
    });

    // Rules: two-step verification is required for the Academic Vice Principal.
    it('lets a session that owes the set-up of a required second step reach no such route, and lets it in afterwards', async () => {
      const strict = signInKit(app, {
        newAccountsHold: { role: 'academic_vice_principal', branchId: north },
      });
      const browser = await strict.fullSession('Parviz', 'Rustamov');

      const before = await edit(browser.cookie, north);
      await strict.setUpSecondStep(browser.cookie);
      const after = await edit(browser.cookie, north);

      expect(before.status).toBe(403);
      expect(errorCode(before)).toBe('second_step_set_up_required');
      expect(after.status).toBe(201);
    });

    it('lets a session that owes the code of the second step reach no such route', async () => {
      const strict = signInKit(app, {
        newAccountsHold: { role: 'academic_vice_principal', branchId: north },
      });
      const first = await strict.completeSession('Qunduz', 'Mirzayeva');
      const again = await strict.signIn(first.account.login, 'a-new-password-73');
      const cookie = again.headers['set-cookie'] as unknown as string[];
      const session = cookie.find((line) => line.includes('sodiq_session'))?.split(';')[0] ?? '';

      const response = await edit(session, north);

      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('second_step_required');
    });
  });

  describe('for the other kinds of route', () => {
    it('lets every signed-in account, with or without a role, reach a route for the own account', async () => {
      const plain = await kit.fullSession('Ravshan', 'Tojiboyev');
      const principal = await kit.fullSession('Sevara', 'Umarova');
      await kit.giveRole(principal.account.id, { role: 'principal', branchId: north });

      for (const browser of [plain, principal]) {
        const response = await request(server)
          .get('/api/permission-sample/own')
          .set('Cookie', browser.cookie);
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ login: browser.account.login });
      }
      expect((await request(server).get('/api/permission-sample/own')).status).toBe(401);
    });

    it('lets everybody reach a public route', async () => {
      const response = await request(server).get('/api/permission-sample/open');

      expect(response.status).toBe(200);
    });
  });

  describe('for a route that does not say exactly once who may call it', () => {
    it.each(['undeclared', 'twice', 'early'])(
      'never runs the route "%s": it answers as a fault of the server',
      async (path) => {
        const browser = await kit.fullSession('Temur', 'Xolmatov');
        await kit.giveRole(browser.account.id, { role: 'teacher', branchId: north });

        const response = await request(server)
          .get(`/api/permission-faults/${path}`)
          .set('Cookie', browser.cookie)
          .set(BRANCH_HEADER, north);

        expect(response.status).toBe(500);
        expect(errorCode(response)).toBe('internal_error');
        expect(response.body).not.toHaveProperty('ok');
      },
    );

    it('answers "not signed in" for an undeclared route when nobody is signed in', async () => {
      const response = await request(server).get('/api/permission-faults/undeclared');

      expect(response.status).toBe(401);
    });
  });
});
