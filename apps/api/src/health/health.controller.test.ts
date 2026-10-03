import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../testing/create-test-app.js';

// docs/build-plan.md, task 0.1: the web app's placeholder page calls an API health route.
describe('GET /api/health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers ok to a request without a session', async () => {
    const response = await request(app.getHttpServer() as Server).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('does not name the framework in its headers', async () => {
    const response = await request(app.getHttpServer() as Server).get('/api/health');

    expect(response.headers).not.toHaveProperty('x-powered-by');
  });

  it('is not served outside the /api prefix', async () => {
    const response = await request(app.getHttpServer() as Server).get('/health');

    expect(response.status).toBe(404);
  });
});
