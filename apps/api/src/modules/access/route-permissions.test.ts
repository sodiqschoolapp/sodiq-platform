import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ROLES, type Role } from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import {
  EveryMethodController,
  FaultyAccessController,
  PermissionSampleController,
  SAMPLE_PERMISSIONS,
} from '../../testing/permission-sample.controller.js';
import {
  accessProblems,
  declarationProblems,
  harnessCallers,
  StopBeforeHandler,
  type ExpectedAccess,
  type HarnessCallers,
} from '../../testing/route-harness.js';
import { expressRoutesOf, routesOf } from '../../testing/routes.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

/**
 * docs/spec/14-quality-plan.md, "Permission tests": "For every role and every
 * API address, a test checks what is allowed and what is refused." This is the
 * list for the application as it runs, written by hand: for each route, who
 * may call it. A new route fails here until it is added; the harness then
 * calls it as each of the 15 roles, as an account without a role and without
 * sign-in, and compares.
 *
 * A route with a permission lists the roles the table gives its action. What
 * the roles may do is decided in `PERMISSIONS` (`packages/shared`); this list
 * is the second, independent statement of it.
 */
/** The roles that read the branch record, the buildings, the floors and the rooms of a branch. */
const SETUP_VIEWERS: readonly Role[] = ['super_admin', 'principal', 'academic_vice_principal'];

const ROUTE_ACCESS: Record<string, ExpectedAccess> = {
  'GET /api/health': 'public',
  'POST /api/auth/sign-in': 'public',
  // The own sign-in, and a feedback report about the app: open to every
  // signed-in account, the Principal included (docs/decisions.md, tasks 0.7b and
  // 0.8b-3). Each acts on the account of the session only.
  'GET /api/auth/session': 'any_signed_in',
  'GET /api/auth/sessions': 'any_signed_in',
  'POST /api/auth/password': 'any_signed_in',
  'POST /api/auth/sign-out': 'any_signed_in',
  'POST /api/auth/sign-out-everywhere': 'any_signed_in',
  'PUT /api/auth/language': 'any_signed_in',
  'POST /api/auth/second-step': 'any_signed_in',
  'GET /api/auth/second-step': 'any_signed_in',
  'POST /api/auth/second-step/set-up': 'any_signed_in',
  'POST /api/auth/second-step/confirm': 'any_signed_in',
  'POST /api/auth/second-step/turn-off': 'any_signed_in',
  'GET /api/auth/trusted-devices': 'any_signed_in',
  'DELETE /api/auth/trusted-devices/:id': 'any_signed_in',
  'POST /api/feedback': 'any_signed_in',
  // The own notifications (task 0.9). The owner's spec change adds reading and
  // marking them to the Principal's own-account changes (answer 10 of the plan).
  'GET /api/notifications': 'any_signed_in',
  'POST /api/notifications/:id/read': 'any_signed_in',
  'POST /api/notifications/read-all': 'any_signed_in',
  // School setup (task 1.1; docs/spec/02-roles-and-access.md, Super Admin:
  // "Only this role creates branches, buildings, floors and rooms"; Principal:
  // "Changes nothing"; the Academic Vice Principal's view approved by the
  // owner, pull request #37, answer 5). Creating a branch names no branch.
  'POST /api/setup/branches': { branch: 'none', roles: ['super_admin'] },
  'GET /api/setup/branch': { branch: 'request', roles: SETUP_VIEWERS },
  'PUT /api/setup/branch': { branch: 'request', roles: ['super_admin'] },
  'GET /api/setup/buildings': { branch: 'request', roles: SETUP_VIEWERS },
  'POST /api/setup/buildings': { branch: 'request', roles: ['super_admin'] },
  'PUT /api/setup/buildings/:id': { branch: 'request', roles: ['super_admin'] },
  'POST /api/setup/buildings/:id/archive': { branch: 'request', roles: ['super_admin'] },
  'POST /api/setup/buildings/:id/restore': { branch: 'request', roles: ['super_admin'] },
  'POST /api/setup/buildings/:id/floors': { branch: 'request', roles: ['super_admin'] },
  'PUT /api/setup/floors/:id': { branch: 'request', roles: ['super_admin'] },
  'POST /api/setup/floors/:id/archive': { branch: 'request', roles: ['super_admin'] },
  'POST /api/setup/floors/:id/restore': { branch: 'request', roles: ['super_admin'] },
  'GET /api/setup/rooms': { branch: 'request', roles: SETUP_VIEWERS },
  'POST /api/setup/rooms': { branch: 'request', roles: ['super_admin'] },
  'PUT /api/setup/rooms/:id': { branch: 'request', roles: ['super_admin'] },
};

/** The same for the sample routes: the roles `SAMPLE_PERMISSIONS` gives each action, written again by hand. */
const SAMPLE_ROUTE_ACCESS: Record<string, ExpectedAccess> = {
  ...ROUTE_ACCESS,
  'GET /api/permission-sample/open': 'public',
  'GET /api/permission-sample/own': 'any_signed_in',
  'GET /api/permission-sample/view': {
    branch: 'request',
    roles: [
      'super_admin',
      'principal',
      'academic_vice_principal',
      'spiritual_vice_principal',
      'head_tutor',
      'tutor',
      'senior_head_teacher',
      'head_teacher',
      'teacher',
    ],
  },
  'POST /api/permission-sample/edit': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal', 'senior_head_teacher', 'head_teacher'],
  },
  'GET /api/permission-sample/school': {
    branch: 'none',
    roles: ['super_admin', 'senior_head_teacher', 'head_teacher'],
  },
  'POST /api/permission-sample/school': { branch: 'none', roles: ['super_admin'] },
};

/**
 * The routes a session may reach while it still owes a step of sign-in, each
 * with those steps, written by hand. Only routes of the own sign-in belong
 * here: a route with a permission that carried such a mark would let a session
 * without its second step act with its roles (found by the review).
 */
const STEP_ROUTES: Record<string, string[]> = {
  'GET /api/auth/session': ['second_step', 'password_change', 'second_step_set_up'],
  'POST /api/auth/sign-out': ['second_step', 'password_change', 'second_step_set_up'],
  'POST /api/auth/password': ['password_change', 'second_step_set_up'],
  'POST /api/auth/second-step': ['second_step'],
  'GET /api/auth/second-step': ['second_step_set_up'],
  'POST /api/auth/second-step/set-up': ['second_step_set_up'],
  'POST /api/auth/second-step/confirm': ['second_step_set_up'],
};

const CLOCK = '2026-10-05T09:00:00+05:00';

describe('every route of the application, as every role', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let callers: HarnessCallers;
  const handlerStop = new StopBeforeHandler();

  beforeAll(async () => {
    database = await createTestDatabase();
    const home = await insertBranch(database.migrator, 'North');
    const other = await insertBranch(database.migrator, 'South');
    // The application as `main.ts` builds it: no test-only controller, the real table.
    app = await createTestApp({
      database: database.app,
      clock: new FixedClock(CLOCK),
      handlerStop,
    });
    callers = await harnessCallers(app, { home, other });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('says who may call it, exactly once, and what it answers', () => {
    expect(declarationProblems(app, ROUTE_ACCESS)).toEqual([]);
  });

  // The harness reads the controllers; Express must answer exactly these routes and no other.
  it('is a route of the Express router, which has no other', () => {
    const names = routesOf(app).map((route) => route.name);

    expect(names).toHaveLength(Object.keys(ROUTE_ACCESS).length);
    expect(expressRoutesOf(app)).toEqual(names);
  });

  it('is reachable with an owed step of sign-in only where the list says so', () => {
    const marked = routesOf(app)
      .filter((route) => route.allowedBefore.length > 0)
      .map((route) => [route.name, route.allowedBefore]);

    expect(Object.fromEntries(marked)).toEqual(STEP_ROUTES);
  });

  it('is tried by 15 roles, an account without a role and nobody', () => {
    expect(callers.callers.map((caller) => caller.name)).toEqual(['nobody', 'no role', ...ROLES]);
  });

  it('allows and refuses as listed', async () => {
    expect(await accessProblems(app, ROUTE_ACCESS, callers, handlerStop)).toEqual([]);
  }, 120_000);
});

// docs/build-plan.md, task 0.7b: "sample routes pass for all 15 roles".
describe('the sample routes, as every role', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let callers: HarnessCallers;
  const handlerStop = new StopBeforeHandler();

  beforeAll(async () => {
    database = await createTestDatabase();
    const home = await insertBranch(database.migrator, 'North');
    const other = await insertBranch(database.migrator, 'South');
    app = await createTestApp({
      database: database.app,
      clock: new FixedClock(CLOCK),
      controllers: [PermissionSampleController],
      permissionTable: SAMPLE_PERMISSIONS,
      handlerStop,
    });
    callers = await harnessCallers(app, { home, other });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('are declared as listed', () => {
    expect(declarationProblems(app, SAMPLE_ROUTE_ACCESS)).toEqual([]);
  });

  it('are allowed and refused as listed: by role, by branch and without a branch', async () => {
    expect(await accessProblems(app, SAMPLE_ROUTE_ACCESS, callers, handlerStop)).toEqual([]);
  }, 120_000);

  // The harness is only worth something if it sees a difference.
  it('are reported when the list names a role the server refuses, or leaves out one it allows', async () => {
    const wrong: Record<string, ExpectedAccess> = {
      ...SAMPLE_ROUTE_ACCESS,
      'POST /api/permission-sample/edit': { branch: 'request', roles: ['super_admin', 'teacher'] },
      'GET /api/permission-sample/own': 'public',
      // A route for no branch that the list holds to be for one branch.
      'GET /api/permission-sample/school': {
        branch: 'request',
        roles: ['super_admin', 'senior_head_teacher', 'head_teacher'],
      },
    };

    const problems = await accessProblems(app, wrong, callers, handlerStop);

    expect(problems).toEqual(
      expect.arrayContaining([
        'POST /api/permission-sample/edit as teacher in the own branch: refused, listed as allowed',
        'POST /api/permission-sample/edit as head_teacher in the own branch: allowed, listed as refused',
        'POST /api/permission-sample/edit as senior_head_teacher in another branch: allowed, listed as refused',
        'GET /api/permission-sample/own as nobody in the own branch: not_signed_in, listed as allowed',
        'GET /api/permission-sample/school as head_teacher in another branch: allowed, listed as refused',
      ]),
    );
    expect(declarationProblems(app, wrong)).toEqual([
      'GET /api/permission-sample/own: declared any_signed_in, listed as public',
      'GET /api/permission-sample/school: declared for the branch "none", listed for "request"',
    ]);
  }, 120_000);
});

// Left open by task 0.7b: a route with `@All()` crashed the harness.
describe('the harness and a route for every method', () => {
  let app: NestExpressApplication;
  const handlerStop = new StopBeforeHandler();
  const listed: Record<string, ExpectedAccess> = {
    ...ROUTE_ACCESS,
    'ALL /api/permission-every-method': 'any_signed_in',
  };

  beforeAll(async () => {
    app = await createTestApp({ controllers: [EveryMethodController], handlerStop });
  });

  afterAll(async () => {
    await app.close();
  });

  it('names it', () => {
    expect(declarationProblems(app, listed)).toEqual([
      'ALL /api/permission-every-method: answers every method (@All); a route names its one method, so that it can be called and listed',
    ]);
  });

  it('goes on to the other routes instead of stopping at it', async () => {
    // Nobody is signed in, so no database is needed: every answer is "not signed in" or public.
    const nobody: HarnessCallers = {
      home: randomUUID(),
      other: randomUUID(),
      callers: [{ name: 'nobody', role: null, cookies: undefined }],
    };

    expect(await accessProblems(app, listed, nobody, handlerStop)).toEqual([
      'ALL /api/permission-every-method: answers every method (@All) and was not called',
    ]);
  });
});

// The done-when of the task: "the harness fails if a route has no permission declaration".
describe('the harness', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [FaultyAccessController] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('names a route without a declaration, with two, with a permission and an owed step, without an answer schema, and one the list does not know', () => {
    const listed: Record<string, ExpectedAccess> = {
      ...ROUTE_ACCESS,
      'GET /api/permission-faults/undeclared': 'any_signed_in',
      'GET /api/permission-faults/twice': 'public',
      'GET /api/permission-faults/early': { branch: 'request', roles: ['teacher'] },
      'GET /api/removed': 'public',
    };

    expect(declarationProblems(app, listed)).toEqual([
      'GET /api/permission-faults/early: open to a session that owes a step of sign-in (second_step), which only a route of the own account may be',
      'GET /api/permission-faults/no-answer-schema: no @Returns or @ReturnsNothing',
      'GET /api/permission-faults/no-answer-schema: not in the list of who may call it',
      'GET /api/permission-faults/twice: 2 access declarations, it needs exactly one',
      'GET /api/permission-faults/undeclared: 0 access declarations, it needs exactly one',
      'GET /api/removed: listed, but the application has no such route',
    ]);
  });
});
