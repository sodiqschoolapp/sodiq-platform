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
  'POST /api/auth/password-reset':
    'The person who forgot the password cannot sign in; "later password reset by email" is in the short list (task 2.3c-2, decision 1 of #66).',
  'POST /api/auth/password-reset/confirm':
    'The new password is chosen with the link of the mail, without a session (task 2.3c-2, decision 1 of #66).',
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
      'DELETE /api/auth/photo',
      'DELETE /api/auth/trusted-devices/:id',
      'DELETE /api/people/relatives/:id/same-person',
      'DELETE /api/people/staff/:id/photo',
      'DELETE /api/people/students/:id/photo',
      'GET /api/access/branches-without-vice-principal',
      'GET /api/access/head-teachers',
      'GET /api/access/super-admins',
      'GET /api/audit/entries',
      'GET /api/auth/photo',
      'GET /api/auth/second-step',
      'GET /api/auth/session',
      'GET /api/auth/sessions',
      'GET /api/auth/sign-in-history',
      'GET /api/auth/trusted-devices',
      'GET /api/classes',
      'GET /api/classes/:id',
      'GET /api/classes/:id/members',
      'GET /api/classes/tutor-candidates',
      'GET /api/groups',
      'GET /api/groups/:id',
      'GET /api/groups/slot-check',
      'GET /api/health',
      'GET /api/notifications',
      'GET /api/people/accounts/never-used',
      'GET /api/people/relatives',
      'GET /api/people/relatives/:id',
      'GET /api/people/relatives/no-valid-phone',
      'GET /api/people/staff',
      'GET /api/people/staff/:id',
      'GET /api/people/staff/:id/account',
      'GET /api/people/staff/:id/account/access',
      'GET /api/people/staff/:id/account/suggestion',
      'GET /api/people/staff/:id/availability',
      'GET /api/people/staff/:id/photo',
      'GET /api/people/students',
      'GET /api/people/students/:id',
      'GET /api/people/students/:id/photo',
      'GET /api/people/students/:id/relatives',
      'GET /api/people/students/no-class',
      'GET /api/people/vacancies',
      'GET /api/people/vacancies/:id',
      'GET /api/setup/academic-years',
      'GET /api/setup/attendance-values',
      'GET /api/setup/branch',
      'GET /api/setup/branches',
      'GET /api/setup/buildings',
      'GET /api/setup/calendar-day',
      'GET /api/setup/calendar-entries',
      'GET /api/setup/checklist',
      'GET /api/setup/current-period',
      'GET /api/setup/day-template-assignments',
      'GET /api/setup/day-template-table',
      'GET /api/setup/day-templates',
      'GET /api/setup/day-templates/:id',
      'GET /api/setup/divisions',
      'GET /api/setup/rooms',
      'GET /api/setup/settings',
      'GET /api/setup/slot-types',
      'GET /api/setup/subjects',
      'GET /api/setup/subjects/:id/quarter-weights',
      'GET /api/setup/travel-times',
      'PATCH /api/people/relatives/:id',
      'PATCH /api/people/students/:id/relatives/:relativeId',
      'PATCH /api/setup/calendar-entries/:id',
      'PATCH /api/setup/day-templates/:id',
      'PATCH /api/setup/slot-types/:id',
      'POST /api/audit/entries/:id/show',
      'POST /api/auth/password',
      'POST /api/auth/password-reset',
      'POST /api/auth/password-reset/confirm',
      'POST /api/auth/second-step',
      'POST /api/auth/second-step/confirm',
      'POST /api/auth/second-step/set-up',
      'POST /api/auth/second-step/turn-off',
      'POST /api/auth/sign-in',
      'POST /api/auth/sign-out',
      'POST /api/auth/sign-out-everywhere',
      'POST /api/classes',
      'POST /api/classes/:id/archive',
      'POST /api/classes/:id/members',
      'POST /api/classes/:id/members/:memberId/withdraw',
      'POST /api/classes/:id/restore',
      'POST /api/classes/:id/tutors',
      'POST /api/classes/:id/tutors/:tutorId/end',
      'POST /api/classes/export',
      'POST /api/feedback',
      'POST /api/groups',
      'POST /api/groups/:id/archive',
      'POST /api/groups/:id/restore',
      'POST /api/groups/export',
      'POST /api/notifications/:id/read',
      'POST /api/notifications/read-all',
      'POST /api/people/relatives/:id/merge',
      'POST /api/people/relatives/:id/report',
      'POST /api/people/relatives/:id/show',
      'POST /api/people/relatives/phone-match',
      'POST /api/people/staff',
      'POST /api/people/staff/:id/account',
      'POST /api/people/staff/:id/account/lock',
      'POST /api/people/staff/:id/account/own',
      'POST /api/people/staff/:id/account/password-reset',
      'POST /api/people/staff/:id/account/second-step-reset',
      'POST /api/people/staff/:id/account/unlock',
      'POST /api/people/staff/:id/identity',
      'POST /api/people/staff/:id/report',
      'POST /api/people/staff/:id/roles',
      'POST /api/people/staff/:id/roles/:assignmentId/end',
      'POST /api/people/staff/:id/roles/:assignmentId/subjects',
      'POST /api/people/staff/:id/status',
      'POST /api/people/staff/check',
      'POST /api/people/staff/export',
      'POST /api/people/students',
      'POST /api/people/students/:id/delete',
      'POST /api/people/students/:id/identity',
      'POST /api/people/students/:id/leaving',
      'POST /api/people/students/:id/leaving/cancel',
      'POST /api/people/students/:id/leaving/undo',
      'POST /api/people/students/:id/relatives',
      'POST /api/people/students/:id/relatives/:relativeId/unlink',
      'POST /api/people/students/:id/report',
      'POST /api/people/students/:id/restore',
      'POST /api/people/students/:id/return',
      'POST /api/people/students/check',
      'POST /api/people/students/export',
      'POST /api/people/vacancies',
      'POST /api/people/vacancies/:id/close',
      'POST /api/people/vacancies/:id/delete',
      'POST /api/people/vacancies/:id/reopen',
      'POST /api/people/vacancies/export',
      'POST /api/setup/academic-years',
      'POST /api/setup/academic-years/:id/start',
      'POST /api/setup/branches',
      'POST /api/setup/buildings',
      'POST /api/setup/buildings/:id/archive',
      'POST /api/setup/buildings/:id/floors',
      'POST /api/setup/buildings/:id/restore',
      'POST /api/setup/buildings/export',
      'POST /api/setup/calendar-entries',
      'POST /api/setup/calendar-entries/:id/archive',
      'POST /api/setup/calendar-entries/:id/restore',
      'POST /api/setup/calendar-entries/preview',
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
      'POST /api/setup/divisions/export',
      'POST /api/setup/floors/:id/archive',
      'POST /api/setup/floors/:id/restore',
      'POST /api/setup/rooms',
      'POST /api/setup/rooms/export',
      'POST /api/setup/slot-types',
      'POST /api/setup/slot-types/:id/archive',
      'POST /api/setup/slot-types/:id/lengths',
      'POST /api/setup/slot-types/:id/restore',
      'POST /api/setup/subjects',
      'POST /api/setup/subjects/:id/archive',
      'POST /api/setup/subjects/:id/quarter-weights/copy',
      'POST /api/setup/subjects/:id/restore',
      'POST /api/setup/subjects/export',
      'PUT /api/auth/language',
      'PUT /api/auth/photo',
      'PUT /api/classes/:id',
      'PUT /api/groups/:id',
      'PUT /api/people/relatives/:id/same-person',
      'PUT /api/people/staff/:id',
      'PUT /api/people/staff/:id/availability',
      'PUT /api/people/staff/:id/branches',
      'PUT /api/people/staff/:id/photo',
      'PUT /api/people/staff/:id/teaching',
      'PUT /api/people/students/:id',
      'PUT /api/people/students/:id/photo',
      'PUT /api/people/students/:id/uid',
      'PUT /api/people/vacancies/:id',
      'PUT /api/setup/academic-years/:id',
      'PUT /api/setup/academic-years/:id/quarters',
      'PUT /api/setup/branch',
      'PUT /api/setup/branch/go-live',
      'PUT /api/setup/buildings/:id',
      'PUT /api/setup/departments/:id',
      'PUT /api/setup/divisions/:id',
      'PUT /api/setup/floors/:id',
      'PUT /api/setup/quarters/:id/attendance-values',
      'PUT /api/setup/rooms/:id',
      'PUT /api/setup/settings/early-warning',
      'PUT /api/setup/settings/edit-days',
      'PUT /api/setup/subjects/:id',
      'PUT /api/setup/subjects/:id/daily-weights',
      'PUT /api/setup/subjects/:id/quarter-weights/:quarterId',
      'PUT /api/setup/travel-times',
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
