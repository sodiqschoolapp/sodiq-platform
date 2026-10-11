import type { Server } from 'node:http';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { routesOf, type Route } from '../../testing/routes.js';
import { Public } from './session.guard.js';

/**
 * docs/spec/02-roles-and-access.md, "Accounts and sign-in: build order": a short
 * list of routes works without sign-in; each is declared public in code, and a
 * test holds the exact list. This is the list, each route with its reason. A
 * new public route is a decision for the owner and fails here until it is added.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  'GET /api/health': 'Uptime monitoring and the deploy smoke test call it without a session.',
  'POST /api/auth/sign-in': 'Sign-in cannot require a session.',
};

const isPublic = (route: Route): boolean => route.access.some((access) => access.kind === 'public');

describe('the routes that work without sign-in', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // The application as `main.ts` builds it: no test-only controller.
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('are exactly the listed ones', () => {
    const open = routesOf(app)
      .filter(isPublic)
      .map((route) => route.name);

    expect(open).toEqual(Object.keys(PUBLIC_ROUTES).sort());
  });

  it('each have a reason', () => {
    for (const reason of Object.values(PUBLIC_ROUTES)) {
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  // The check above is only worth something if it sees every route.
  it('are found among all routes of the application', () => {
    expect(routesOf(app).map((route) => route.name)).toEqual([
      'DELETE /api/auth/trusted-devices/:id',
      'GET /api/auth/second-step',
      'GET /api/auth/session',
      'GET /api/auth/sessions',
      'GET /api/auth/trusted-devices',
      'GET /api/health',
      'GET /api/notifications',
      'GET /api/setup/academic-years',
      'GET /api/setup/branch',
      'GET /api/setup/buildings',
      'GET /api/setup/current-period',
      'GET /api/setup/day-template-assignments',
      'GET /api/setup/day-template-table',
      'GET /api/setup/day-templates',
      'GET /api/setup/day-templates/:id',
      'GET /api/setup/divisions',
      'GET /api/setup/rooms',
      'GET /api/setup/slot-types',
      'PATCH /api/setup/day-templates/:id',
      'PATCH /api/setup/slot-types/:id',
      'POST /api/auth/password',
      'POST /api/auth/second-step',
      'POST /api/auth/second-step/confirm',
      'POST /api/auth/second-step/set-up',
      'POST /api/auth/second-step/turn-off',
      'POST /api/auth/sign-in',
      'POST /api/auth/sign-out',
      'POST /api/auth/sign-out-everywhere',
      'POST /api/feedback',
      'POST /api/notifications/:id/read',
      'POST /api/notifications/read-all',
      'POST /api/setup/academic-years',
      'POST /api/setup/academic-years/:id/start',
      'POST /api/setup/branches',
      'POST /api/setup/buildings',
      'POST /api/setup/buildings/:id/archive',
      'POST /api/setup/buildings/:id/floors',
      'POST /api/setup/buildings/:id/restore',
      'POST /api/setup/day-template-assignments',
      'POST /api/setup/day-template-assignments/:id/end',
      'POST /api/setup/day-template-table/preview',
      'POST /api/setup/day-templates',
      'POST /api/setup/day-templates/:id/archive',
      'POST /api/setup/day-templates/:id/restore',
      'POST /api/setup/day-templates/:id/versions',
      'POST /api/setup/departments/:id/archive',
      'POST /api/setup/departments/:id/restore',
      'POST /api/setup/divisions',
      'POST /api/setup/divisions/:id/archive',
      'POST /api/setup/divisions/:id/departments',
      'POST /api/setup/divisions/:id/restore',
      'POST /api/setup/floors/:id/archive',
      'POST /api/setup/floors/:id/restore',
      'POST /api/setup/rooms',
      'POST /api/setup/slot-types',
      'POST /api/setup/slot-types/:id/archive',
      'POST /api/setup/slot-types/:id/lengths',
      'POST /api/setup/slot-types/:id/restore',
      'PUT /api/auth/language',
      'PUT /api/setup/academic-years/:id',
      'PUT /api/setup/academic-years/:id/quarters',
      'PUT /api/setup/branch',
      'PUT /api/setup/branch/go-live',
      'PUT /api/setup/buildings/:id',
      'PUT /api/setup/departments/:id',
      'PUT /api/setup/divisions/:id',
      'PUT /api/setup/floors/:id',
      'PUT /api/setup/rooms/:id',
    ]);
  });
});

// The list is only exact if a public route cannot hide from it.
describe('the list of routes', () => {
  class InheritedBase {
    @Get('inherited')
    @Public()
    inherited(): { ok: boolean } {
      return { ok: true };
    }
  }

  @Controller('scratch-child')
  class ChildController extends InheritedBase {
    @Get('own')
    own(): { ok: boolean } {
      return { ok: true };
    }
  }

  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [ChildController] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('names a public handler that a controller inherits', async () => {
    // It really is a route, and it really is open.
    const response = await request(app.getHttpServer() as Server).get(
      '/api/scratch-child/inherited',
    );
    expect(response.status).toBe(200);

    expect(
      routesOf(app)
        .filter((route) => route.name.includes('scratch-child'))
        .map((route) => ({ name: route.name, public: isPublic(route) })),
    ).toEqual([
      { name: 'GET /api/scratch-child/inherited', public: true },
      { name: 'GET /api/scratch-child/own', public: false },
    ]);
  });
});
