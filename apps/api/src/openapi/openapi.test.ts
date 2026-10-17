import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../testing/create-test-app.js';
import { SampleController } from '../testing/sample.controller.js';
import { buildOpenApiDocument, serializeOpenApiDocument } from './build-document.js';

const errorAnswer = {
  description: 'Any error',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
};

// docs/spec/13-technology.md: REST API described in OpenAPI, with the API client
// of the browser generated from it.
describe('OpenAPI document', () => {
  describe('of the application', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('openapi.generated.json is up to date (run "pnpm api:client" if this fails)', () => {
      const committed = readFileSync(
        new URL('../../openapi.generated.json', import.meta.url),
        'utf8',
      ).replaceAll('\r\n', '\n');

      expect(committed).toBe(serializeOpenApiDocument(buildOpenApiDocument(app)));
    });

    it('describes the health route and its answer', () => {
      const document = buildOpenApiDocument(app);

      expect(Object.keys(document.paths).sort()).toEqual([
        '/api/access/branches-without-vice-principal',
        '/api/access/head-teachers',
        '/api/access/super-admins',
        '/api/audit/entries',
        '/api/audit/entries/{id}/show',
        '/api/auth/language',
        '/api/auth/password',
        '/api/auth/password-reset',
        '/api/auth/password-reset/confirm',
        '/api/auth/photo',
        '/api/auth/second-step',
        '/api/auth/second-step/confirm',
        '/api/auth/second-step/set-up',
        '/api/auth/second-step/turn-off',
        '/api/auth/session',
        '/api/auth/sessions',
        '/api/auth/sign-in',
        '/api/auth/sign-in-history',
        '/api/auth/sign-out',
        '/api/auth/sign-out-everywhere',
        '/api/auth/trusted-devices',
        '/api/auth/trusted-devices/{id}',
        '/api/classes',
        '/api/classes/export',
        '/api/classes/seats',
        '/api/classes/transfers',
        '/api/classes/transfers/{id}/cancel',
        '/api/classes/transfers/{id}/change',
        '/api/classes/transfers/{id}/undo',
        '/api/classes/tutor-candidates',
        '/api/classes/{id}',
        '/api/classes/{id}/archive',
        '/api/classes/{id}/members',
        '/api/classes/{id}/members/{memberId}/withdraw',
        '/api/classes/{id}/restore',
        '/api/classes/{id}/tutors',
        '/api/classes/{id}/tutors/preview',
        '/api/classes/{id}/tutors/{tutorId}/end',
        '/api/feedback',
        '/api/groups',
        '/api/groups/export',
        '/api/groups/placement',
        '/api/groups/placement/automatic',
        '/api/groups/slot-check',
        '/api/groups/transfers',
        '/api/groups/transfers/{id}/cancel',
        '/api/groups/transfers/{id}/change',
        '/api/groups/transfers/{id}/undo',
        '/api/groups/{id}',
        '/api/groups/{id}/archive',
        '/api/groups/{id}/members',
        '/api/groups/{id}/members/{memberId}/reviewed',
        '/api/groups/{id}/members/{memberId}/withdraw',
        '/api/groups/{id}/restore',
        '/api/health',
        '/api/notifications',
        '/api/notifications/read-all',
        '/api/notifications/{id}/read',
        '/api/people/accounts/never-used',
        '/api/people/branch-moves/incoming',
        '/api/people/branch-moves/targets',
        '/api/people/branch-moves/{id}/accept',
        '/api/people/branch-moves/{id}/cancel',
        '/api/people/branch-moves/{id}/decline',
        '/api/people/branch-moves/{id}/groups',
        '/api/people/relatives',
        '/api/people/relatives/no-valid-phone',
        '/api/people/relatives/phone-match',
        '/api/people/relatives/{id}',
        '/api/people/relatives/{id}/merge',
        '/api/people/relatives/{id}/report',
        '/api/people/relatives/{id}/show',
        '/api/people/staff',
        '/api/people/staff/check',
        '/api/people/staff/export',
        '/api/people/staff/{id}',
        '/api/people/staff/{id}/account',
        '/api/people/staff/{id}/account/access',
        '/api/people/staff/{id}/account/lock',
        '/api/people/staff/{id}/account/own',
        '/api/people/staff/{id}/account/password-reset',
        '/api/people/staff/{id}/account/second-step-reset',
        '/api/people/staff/{id}/account/suggestion',
        '/api/people/staff/{id}/account/unlock',
        '/api/people/staff/{id}/availability',
        '/api/people/staff/{id}/branches',
        '/api/people/staff/{id}/identity',
        '/api/people/staff/{id}/photo',
        '/api/people/staff/{id}/report',
        '/api/people/staff/{id}/roles',
        '/api/people/staff/{id}/roles/{assignmentId}/end',
        '/api/people/staff/{id}/roles/{assignmentId}/subjects',
        '/api/people/staff/{id}/status',
        '/api/people/staff/{id}/teaching',
        '/api/people/students',
        '/api/people/students/check',
        '/api/people/students/export',
        '/api/people/students/no-class',
        '/api/people/students/{id}',
        '/api/people/students/{id}/branch-move',
        '/api/people/students/{id}/delete',
        '/api/people/students/{id}/history',
        '/api/people/students/{id}/identity',
        '/api/people/students/{id}/leaving',
        '/api/people/students/{id}/leaving/cancel',
        '/api/people/students/{id}/leaving/undo',
        '/api/people/students/{id}/merge',
        '/api/people/students/{id}/photo',
        '/api/people/students/{id}/relatives',
        '/api/people/students/{id}/relatives/{relativeId}',
        '/api/people/students/{id}/relatives/{relativeId}/unlink',
        '/api/people/students/{id}/report',
        '/api/people/students/{id}/restore',
        '/api/people/students/{id}/return',
        '/api/people/students/{id}/return/cancel',
        '/api/people/students/{id}/uid',
        '/api/people/vacancies',
        '/api/people/vacancies/export',
        '/api/people/vacancies/{id}',
        '/api/people/vacancies/{id}/close',
        '/api/people/vacancies/{id}/delete',
        '/api/people/vacancies/{id}/reopen',
        '/api/search/classes',
        '/api/search/groups',
        '/api/search/relatives',
        '/api/search/staff',
        '/api/search/students',
        '/api/setup/academic-years',
        '/api/setup/academic-years/{id}',
        '/api/setup/academic-years/{id}/quarters',
        '/api/setup/academic-years/{id}/start',
        '/api/setup/attendance-values',
        '/api/setup/branch',
        '/api/setup/branch/go-live',
        '/api/setup/branches',
        '/api/setup/buildings',
        '/api/setup/buildings/export',
        '/api/setup/buildings/{id}',
        '/api/setup/buildings/{id}/archive',
        '/api/setup/buildings/{id}/floors',
        '/api/setup/buildings/{id}/restore',
        '/api/setup/calendar-day',
        '/api/setup/calendar-entries',
        '/api/setup/calendar-entries/preview',
        '/api/setup/calendar-entries/{id}',
        '/api/setup/calendar-entries/{id}/archive',
        '/api/setup/calendar-entries/{id}/restore',
        '/api/setup/checklist',
        '/api/setup/current-period',
        '/api/setup/day-template-assignments',
        '/api/setup/day-template-assignments/{id}/end',
        '/api/setup/day-template-table',
        '/api/setup/day-template-table/preview',
        '/api/setup/day-templates',
        '/api/setup/day-templates/{id}',
        '/api/setup/day-templates/{id}/archive',
        '/api/setup/day-templates/{id}/restore',
        '/api/setup/day-templates/{id}/versions',
        '/api/setup/departments/{id}',
        '/api/setup/departments/{id}/archive',
        '/api/setup/departments/{id}/restore',
        '/api/setup/divisions',
        '/api/setup/divisions/export',
        '/api/setup/divisions/{id}',
        '/api/setup/divisions/{id}/archive',
        '/api/setup/divisions/{id}/departments',
        '/api/setup/divisions/{id}/restore',
        '/api/setup/floors/{id}',
        '/api/setup/floors/{id}/archive',
        '/api/setup/floors/{id}/restore',
        '/api/setup/quarters/{id}/attendance-values',
        '/api/setup/rooms',
        '/api/setup/rooms/export',
        '/api/setup/rooms/{id}',
        '/api/setup/settings',
        '/api/setup/settings/class-daily-lessons',
        '/api/setup/settings/early-warning',
        '/api/setup/settings/edit-days',
        '/api/setup/slot-types',
        '/api/setup/slot-types/{id}',
        '/api/setup/slot-types/{id}/archive',
        '/api/setup/slot-types/{id}/lengths',
        '/api/setup/slot-types/{id}/restore',
        '/api/setup/subjects',
        '/api/setup/subjects/export',
        '/api/setup/subjects/{id}',
        '/api/setup/subjects/{id}/archive',
        '/api/setup/subjects/{id}/daily-weights',
        '/api/setup/subjects/{id}/quarter-weights',
        '/api/setup/subjects/{id}/quarter-weights/copy',
        '/api/setup/subjects/{id}/quarter-weights/{quarterId}',
        '/api/setup/subjects/{id}/restore',
        '/api/setup/travel-times',
        '/api/timetable/versions',
        '/api/timetable/versions/{id}',
        '/api/timetable/versions/{id}/load',
        '/api/timetable/versions/{id}/load/teachers',
        '/api/timetable/versions/{id}/load/{rowId}',
        '/api/timetable/versions/{id}/readiness',
        '/api/timetable/versions/{id}/templates/confirm',
        '/api/timetable/versions/{id}/totals',
      ]);
      expect(document.paths['/api/health']?.get?.responses).toEqual({
        '200': {
          description: '',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { status: { type: 'string', enum: ['ok'] } },
                required: ['status'],
                additionalProperties: false,
              },
            },
          },
        },
        default: errorAnswer,
      });
    });

    it('describes the one error shape', () => {
      const document = buildOpenApiDocument(app);

      expect(document.components?.schemas?.ApiError).toMatchObject({
        type: 'object',
        required: ['error'],
        properties: {
          error: { type: 'object', required: ['code', 'message', 'requestId'] },
        },
      });
    });
  });

  // A route that validates its input is described by the same schema.
  describe('of a route with validated input', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createTestApp({ controllers: [SampleController] });
    });

    afterAll(async () => {
      await app.close();
    });

    it('describes the body, the answer and the error answer', () => {
      const operation = buildOpenApiDocument(app).paths['/api/sample']?.post;

      expect(operation?.requestBody).toEqual({
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 50 },
                count: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
              },
              required: ['name', 'count'],
            },
          },
        },
      });
      expect(Object.keys(operation?.responses ?? {})).toEqual(['201', 'default']);
      expect(operation?.responses.default).toEqual(errorAnswer);
    });

    it('describes each field of the query string', () => {
      const operation = buildOpenApiDocument(app).paths['/api/sample']?.get;

      expect(operation?.parameters).toEqual([
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: expect.objectContaining({ minimum: 1, maximum: 100, default: 20 }) as unknown,
        },
      ]);
    });
  });
});
