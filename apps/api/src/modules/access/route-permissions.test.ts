import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ROLES } from '@sodiq/shared';
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
import { ROUTE_ACCESS, STEP_ROUTES } from '../../testing/route-access-list.js';
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

  // Every route as 17 callers in two branches: about 58 s here after task 7.2's
  // routes, and over 120 s on a CI runner once (pull request #215); the limit
  // is time only, the list it checks is the same.
  it('allows and refuses as listed', async () => {
    expect(await accessProblems(app, ROUTE_ACCESS, callers, handlerStop)).toEqual([]);
  }, 240_000);
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

  // Every route as 17 callers in two branches, as the walk above: over 120 s on a CI
  // runner after task 8.2's routes (pull request #218), and a walk cut by its limit kept
  // running into the next test; the limit is time only, the list it checks is the same.
  it('are allowed and refused as listed: by role, by branch and without a branch', async () => {
    expect(await accessProblems(app, SAMPLE_ROUTE_ACCESS, callers, handlerStop)).toEqual([]);
  }, 240_000);

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
  }, 240_000);
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
      'GET /api/permission-faults/no-answer-schema: no @Returns, @ReturnsNothing, @AcceptedNothing or @ReturnsFile',
      'GET /api/permission-faults/no-answer-schema: not in the list of who may call it',
      'GET /api/permission-faults/twice: 2 access declarations, it needs exactly one',
      'GET /api/permission-faults/undeclared: 0 access declarations, it needs exactly one',
      'GET /api/removed: listed, but the application has no such route',
    ]);
  });
});
