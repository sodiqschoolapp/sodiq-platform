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

      expect(Object.keys(document.paths)).toEqual(['/api/health']);
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
