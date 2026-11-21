import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  ACTING_STAFF_ID_HEADER,
  BRANCH_HEADER,
  INTEGRATION_KEY_HEADER,
  NOTIFICATION_SOCKET_PATH,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { io as connect } from 'socket.io-client';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { routesOf } from '../../testing/routes.js';
import { errorCode, signInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { KEY_ROUTES } from '../../testing/key-route-list.js';
import { integrationKeySecretHash } from './integration-keys.service.js';
import { keyRouteFault } from './key-routes.js';

// Task 10.10 (pull request #369): the list of the routes open to keys is `KEY_ROUTES`
// (`testing/key-route-list.ts`), which the permission checklist shows too.

const NOW = '2026-11-21T10:00:00+05:00';

describe('the routes open to integration keys', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let server: Parameters<typeof request>[0];
  let url: string;
  let branch: string;
  let secret: string;
  let staffId: string;
  let south: string;
  /** The session of a Teacher of the branch with no other role, for the comparison walk. */
  let plainTeacher: string;
  /** Each side's own staff record and name, put in the place of each other when comparing. */
  const selves: { id: string; name: string }[] = [];
  const clock = new FixedClock(NOW);

  beforeAll(async () => {
    database = await createTestDatabase();
    branch = await insertBranch(database.migrator, 'North');
    // Behind the proxy as on Render, and a limit no walk of every route reaches.
    app = await createTestApp({
      database: database.app,
      clock,
      config: { trustProxy: true, integrationKeyRequestsPerMinute: 1_000_000 },
    });
    const kit = signInKit(app);
    server = kit.server;
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${String(address.port)}`;
    const people = new ClassesKit(database.migrator);
    const made = await people.person(branch, ['uz'], { first: 'Gulnora', last: 'Saidova' });
    await kit.giveRole(made.accountId, { role: 'teacher', branchId: branch });
    // The person on the key is also the branch's Academic Vice Principal (permission review
    // must-fix 2): through the key that role must not count.
    await kit.giveRole(made.accountId, { role: 'academic_vice_principal', branchId: branch });
    south = await insertBranch(database.migrator, 'South');
    const plain = await kit.completeSession('Zarina', 'Tursunova');
    await kit.giveRole(plain.account.id, { role: 'teacher', branchId: branch });
    plainTeacher = plain.cookie;
    const plainStaff = await people.person(branch, ['uz'], {
      accountId: plain.account.id,
      first: 'Zarina',
      last: 'Tursunova',
    });
    selves.push(
      { id: made.staffId, name: 'Saidova Gulnora' },
      { id: plainStaff.staffId, name: 'Tursunova Zarina' },
    );
    const admin = await people.account();
    const staff = await database.migrator
      .selectFrom('staff')
      .select('staff_id')
      .where('id', '=', made.staffId)
      .executeTakeFirstOrThrow();
    staffId = staff.staff_id ?? '';
    secret = `sodiq_ik_${randomBytes(32).toString('base64url')}`;
    const key = await database.migrator
      .insertInto('integration_keys')
      .values({
        name: 'Mathematics platform',
        secret_hash: integrationKeySecretHash(secret),
        ends_on: '2027-06-30',
        ends_at: sql<Date>`(('2027-06-30'::date + 1)::timestamp at time zone 'Asia/Tashkent')`,
        created_at: new Date(NOW),
        created_by: admin,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await database.migrator
      .insertInto('integration_key_people')
      .values({ key_id: key.id, staff_id: made.staffId, added_at: new Date(NOW), added_by: admin })
      .execute();
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('are exactly the list, and each is open as `02` allows', () => {
    const routes = routesOf(app);
    const open = routes
      .filter((route) => route.openToKeys !== undefined)
      .map((route) => route.name);
    expect(open.sort()).toEqual(Object.keys(KEY_ROUTES).sort());
    for (const route of routes) {
      expect(
        keyRouteFault({
          name: route.handlerName,
          mark: route.openToKeys,
          declarations: route.access,
          owedSteps: route.allowedBefore,
        }),
        route.name,
      ).toBeUndefined();
    }
    expect(routes.find((route) => route.name === 'GET /api/integration/people')?.openToKeys).toBe(
      'key_only',
    );
  });

  it('refuses to open an export, a student’s record, a group transfer, the own account, a public, a portal or a sign-in step route', () => {
    const requires = (area: string, action: string) => [{ kind: 'requires', area, action }];
    const fault = (
      declarations: { kind: string; area?: string; action?: string; parent?: boolean }[],
      owedSteps: string[] = [],
      name = 'SomeController.handler',
    ) => keyRouteFault({ name, mark: 'person', declarations, owedSteps });
    expect(fault(requires('journal', 'export'))).toMatch(/export/);
    for (const area of [
      'students',
      'student_diagnostic',
      'student_history',
      'group_transfers',
      'classes',
      'groups',
      'accounts',
      'account_access',
    ]) {
      expect(fault(requires(area, 'view')), area).toMatch(/never open to keys/);
    }
    expect(fault([{ kind: 'public' }])).toMatch(/only a route with a permission/);
    expect(fault([{ kind: 'portal' }])).toMatch(/only a route with a permission/);
    // Task 10.11: of the own-account routes, only the person's notifications, by name.
    expect(fault([{ kind: 'any_signed_in', parent: false }])).toMatch(/own-account route/);
    expect(
      fault([{ kind: 'any_signed_in', parent: false }], [], 'AccountController.changePassword'),
    ).toMatch(/own-account route/);
    for (const name of [
      'NotificationsController.list',
      'NotificationsController.read',
      'NotificationsController.readAll',
    ]) {
      expect(fault([{ kind: 'any_signed_in', parent: false }], [], name), name).toBeUndefined();
      expect(fault([{ kind: 'any_signed_in', parent: true }], [], name), name).toMatch(/parent/);
      expect(fault([{ kind: 'any_signed_in', parent: false }], ['second_step'], name)).toMatch(
        /owes a step/,
      );
    }
    expect(fault(requires('journal', 'view'), ['second_step'])).toMatch(/owes a step/);
    expect(fault(requires('journal', 'view'))).toBeUndefined();
    expect(
      keyRouteFault({
        name: 'SomeController.handler',
        mark: 'key_only',
        declarations: requires('journal', 'view'),
        owedSteps: [],
      }),
    ).toMatch(/KeyOnly/);
  });

  /** A request of the department platform as it is sent behind Render's proxy. */
  const keyed = (method: string, path: string) =>
    request(server)
      [method.toLowerCase() as 'get'](path)
      .set('X-Forwarded-Proto', 'https')
      .set(INTEGRATION_KEY_HEADER, secret)
      .set(ACTING_STAFF_ID_HEADER, staffId)
      .set(BRANCH_HEADER, branch);

  it('refuses every other route of the application to a valid key and person, the public ones included', async () => {
    const problems: string[] = [];
    for (const route of routesOf(app)) {
      if (route.openToKeys !== undefined) continue;
      const path = route.path.replace(
        /:[A-Za-z0-9_]+/g,
        () => '0199a000-0000-7000-8000-000000000999',
      );
      const response: Response = await keyed(route.method, path);
      if (response.status !== 403 || errorCode(response) !== 'integration_key_route_closed') {
        problems.push(`${route.name}: ${String(response.status)} ${errorCode(response)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('gives the key person (a Teacher who is also Academic Vice Principal) on every open route what a Teacher alone gets in a session, and nothing in a branch without a key role', async () => {
    const differences: string[] = [];
    const elsewhere: string[] = [];
    const some = '0199a000-0000-7000-8000-000000000999';
    const same = (body: unknown, side: 0 | 1): string => {
      const self = selves[side];
      return self === undefined
        ? JSON.stringify(body)
        : JSON.stringify(body).replaceAll(self.id, 'SELF').replaceAll(self.name, 'SELF NAME');
    };
    for (const route of routesOf(app)) {
      if (route.openToKeys !== 'person') continue;
      const path = route.path.replace(/:[A-Za-z0-9_]+/g, () => some);
      const method = route.method.toLowerCase() as 'get';
      const byKey: Response = await keyed(route.method, path).send({});
      const bySession: Response = await request(server)
        [method](path)
        .set('Cookie', plainTeacher)
        .set(BRANCH_HEADER, branch)
        .send({});
      const outcome = (response: Response) =>
        `${String(response.status)} ${response.status >= 400 ? errorCode(response) : ''}`;
      // Neither teaches anything: a read answers both the same, so a role that counted through
      // the key (the branch's journals, requests, reports of the Academic Vice Principal) shows.
      if (
        byKey.status === 200 &&
        bySession.status === 200 &&
        same(byKey.body, 0) !== same(bySession.body, 1)
      ) {
        differences.push(
          `${route.name}: the key reads ${JSON.stringify(byKey.body).slice(0, 300)}, the Teacher ${JSON.stringify(bySession.body).slice(0, 300)}`,
        );
      }
      if (outcome(byKey) !== outcome(bySession)) {
        differences.push(`${route.name}: key ${outcome(byKey)}, Teacher ${outcome(bySession)}`);
      }
      const other: Response = await keyed(route.method, path).set(BRANCH_HEADER, south).send({});
      if (other.status !== 403 || errorCode(other) !== 'permission_denied') {
        elsewhere.push(`${route.name}: ${outcome(other)}`);
      }
    }
    expect(differences).toEqual([]);
    expect(elsewhere).toEqual([]);
  });

  it('is sent only over HTTPS (`13`, Security)', async () => {
    const plain = await keyed('GET', '/api/journal/journals').set('X-Forwarded-Proto', 'http');
    expect(plain.status).toBe(400);
    expect(errorCode(plain)).toBe('integration_key_https_required');
    expect((await keyed('GET', '/api/journal/journals')).status).toBe(200);
  });

  it('passes the same-site check, and a cross-site request without the key is still refused; an empty or repeated key is a key request', async () => {
    const crossSite = (path: string) =>
      request(server)
        .post(path)
        .set('X-Forwarded-Proto', 'https')
        .set('Sec-Fetch-Site', 'cross-site')
        .set(BRANCH_HEADER, branch)
        .send({});
    const wrong = await crossSite(
      '/api/journal/lessons/0199a000-0000-7000-8000-000000000999/attendance',
    )
      .set(INTEGRATION_KEY_HEADER, 'sodiq_ik_wrong')
      .set('Cookie', 'sodiq_session=whatever');
    expect(errorCode(wrong)).toBe('integration_key_invalid');
    const none = await crossSite(
      '/api/journal/lessons/0199a000-0000-7000-8000-000000000999/attendance',
    );
    expect(errorCode(none)).toBe('cross_site_request');
    const empty = await crossSite('/api/auth/sign-in').set(INTEGRATION_KEY_HEADER, '');
    expect(errorCode(empty)).toBe('integration_key_invalid');
    const repeated = await request(server)
      .get('/api/journal/journals')
      .set('X-Forwarded-Proto', 'https')
      // Node joins a repeated header with a comma, as here.
      .set(INTEGRATION_KEY_HEADER, `${secret}, ${secret}`)
      .set(ACTING_STAFF_ID_HEADER, staffId)
      .set(BRANCH_HEADER, branch);
    expect(errorCode(repeated)).toBe('integration_key_invalid');
  });

  it('answers no CORS preflight, so no page of another site can send the key header', async () => {
    const preflight = await request(server)
      .options('/api/journal/journals')
      .set('Origin', 'https://elsewhere.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', INTEGRATION_KEY_HEADER);
    expect(
      Object.keys(preflight.headers).filter((name) => name.startsWith('access-control-')),
    ).toEqual([]);
  });

  it('never opens the live connection', async () => {
    const socket = connect(url, {
      path: NOTIFICATION_SOCKET_PATH,
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: {
        [INTEGRATION_KEY_HEADER]: secret,
        [ACTING_STAFF_ID_HEADER]: staffId,
        'X-Forwarded-Proto': 'https',
      },
    });
    try {
      const outcome = await new Promise<string>((resolve) => {
        socket.once('connect', () => {
          resolve('connected');
        });
        socket.once('connect_error', (error) => {
          resolve(`refused ${error.message}`);
        });
      });
      expect(outcome).toMatch(/^refused/);
    } finally {
      socket.disconnect();
    }
  });
});
