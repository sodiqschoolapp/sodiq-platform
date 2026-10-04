import type { Server } from 'node:http';
import { Logger, type INestApplication } from '@nestjs/common';
import { apiErrorSchema } from '@sodiq/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../testing/create-test-app.js';
import { FixedClock } from '../testing/fixed-clock.js';
import { SAMPLE_ROW_VALUE, SAMPLE_SECRET, SampleController } from '../testing/sample.controller.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Stands for something a person typed, for example a name or a passport number.
const TYPED_VALUE = 'Typed-Value-Zarina-4417';

describe('HTTP foundations', () => {
  let app: INestApplication;
  let server: Server;
  const clock = new FixedClock('2026-10-05T23:59:00+05:00');

  beforeAll(async () => {
    app = await createTestApp({ clock, controllers: [SampleController] });
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // docs/spec/edge-cases/developer-rules.md, Time-based state: business code never
  // reads the clock directly; it is passed in, so tests can set it.
  describe('injected clock', () => {
    const body = { name: 'Sample', count: 1 };

    it('a route sees exactly the moment the test set', async () => {
      clock.set('2026-10-05T23:59:00+05:00');

      const response = await request(server).post('/api/sample').send(body);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ ...body, receivedAt: '2026-10-05T18:59:00.000Z' });
    });

    it('the moment moves only when the test moves it', async () => {
      clock.set('2026-10-05T23:59:00+05:00');
      clock.advance(60_000);

      const first = await request(server).post('/api/sample').send(body);
      const second = await request(server).post('/api/sample').send(body);

      // 00:00 branch time on 6 October.
      expect(first.body).toMatchObject({ receivedAt: '2026-10-05T19:00:00.000Z' });
      expect(second.body).toMatchObject({ receivedAt: '2026-10-05T19:00:00.000Z' });
    });
  });

  // CLAUDE.md, Conventions: validate every API input with a schema.
  describe('input validation', () => {
    it('accepts a valid body and drops fields the schema does not know', async () => {
      const response = await request(server)
        .post('/api/sample')
        .send({ name: 'Sample', count: 3, extra: 'dropped' });

      expect(response.status).toBe(201);
      expect(response.body).not.toHaveProperty('extra');
    });

    it.each([
      ['a wrong type', { name: 'Sample', count: 'three' }, 'count', 'invalid_type'],
      ['a missing field', { count: 1 }, 'name', 'invalid_type'],
      ['a text that is too long', { name: 'x'.repeat(51), count: 1 }, 'name', 'too_big'],
      ['a number that is too small', { name: 'Sample', count: -1 }, 'count', 'too_small'],
      [
        'a fraction where a whole number is needed',
        { name: 'Sample', count: 1.5 },
        'count',
        'invalid_type',
      ],
    ])('refuses %s and names the field', async (_name, body, path, code) => {
      const response = await request(server).post('/api/sample').send(body);

      expect(response.status).toBe(400);
      const parsed = apiErrorSchema.parse(response.body);
      expect(parsed.error.code).toBe('validation_failed');
      expect(parsed.error.details).toHaveLength(1);
      expect(parsed.error.details?.[0]?.path).toBe(path);
      expect(parsed.error.details?.[0]?.code).toBe(code);
    });

    it('refuses a request without a body', async () => {
      const response = await request(server).post('/api/sample');

      expect(response.status).toBe(400);
      expect(apiErrorSchema.parse(response.body).error.code).toBe('validation_failed');
    });

    it('reports every wrong field at once', async () => {
      const response = await request(server).post('/api/sample').send({ name: '', count: -1 });

      const paths = apiErrorSchema.parse(response.body).error.details?.map((d) => d.path);
      expect(paths?.sort()).toEqual(['count', 'name']);
    });

    it('checks the query string and fills its defaults', async () => {
      const usual = await request(server).get('/api/sample');
      const given = await request(server).get('/api/sample?limit=5');
      const wrong = await request(server).get('/api/sample?limit=1000');

      expect(usual.body).toEqual({ limit: 20 });
      expect(given.body).toEqual({ limit: 5 });
      expect(wrong.status).toBe(400);
      expect(apiErrorSchema.parse(wrong.body).error.details).toEqual([
        { path: 'limit', code: 'too_big', message: expect.any(String) as string },
      ]);
    });

    // Owner, 4 October 2026: validation errors never echo submitted values.
    it.each([
      ['a wrong-typed field', { name: { nested: TYPED_VALUE }, count: [TYPED_VALUE] }],
      ['a field that is too long', { name: TYPED_VALUE.repeat(3), count: 1 }],
      ['an unknown field', { [TYPED_VALUE]: TYPED_VALUE }],
    ])('never repeats what was sent in %s', async (_name, body) => {
      const response = await request(server).post('/api/sample').send(body);

      expect(response.status).toBe(400);
      expect(apiErrorSchema.parse(response.body).error.code).toBe('validation_failed');
      expect(response.text).not.toContain(TYPED_VALUE);
    });

    it('never repeats what was sent in the query string', async () => {
      const response = await request(server).get(`/api/sample?limit=${TYPED_VALUE}`);

      expect(response.status).toBe(400);
      expect(response.text).not.toContain(TYPED_VALUE);
    });

    it('never repeats what was sent in a body that is not JSON', async () => {
      const response = await request(server)
        .post('/api/sample')
        .set('Content-Type', 'application/json')
        .send(`{"name": "${TYPED_VALUE}`);

      expect(response.status).toBe(400);
      expect(apiErrorSchema.parse(response.body).error.code).toBe('malformed_request');
      expect(response.text).not.toContain(TYPED_VALUE);
    });
  });

  // docs/spec/13-technology.md, Server: with a generated client the browser and
  // the server cannot disagree about a field.
  describe('answers follow their schema', () => {
    it('drops a field that the schema of the answer does not know', async () => {
      const response = await request(server).get('/api/sample/extra-field');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ limit: 1 });
      expect(response.text).not.toContain(SAMPLE_SECRET);
    });

    it('treats an answer that does not fit its schema as a fault, without its values', async () => {
      const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const response = await request(server).get('/api/sample/wrong-answer');

      expect(response.status).toBe(500);
      expect(apiErrorSchema.parse(response.body).error.code).toBe('internal_error');
      expect(response.text).not.toContain(SAMPLE_SECRET);
      const log = logged.mock.calls.flat().join('\n');
      expect(log).toContain('SampleController.wrongAnswer');
      expect(log).toContain('limit: invalid_type');
      expect(log).not.toContain(SAMPLE_SECRET);
    });
  });

  // CLAUDE.md, Conventions: the API returns one error shape everywhere.
  describe('one error shape', () => {
    it.each([
      ['an unknown path under /api', 'get', '/api/nowhere', 404, 'not_found'],
      ['an unknown path outside /api', 'get', '/nowhere', 404, 'not_found'],
      ['the root', 'get', '/', 404, 'not_found'],
      ['a method the route does not have', 'delete', '/api/health', 404, 'not_found'],
      ['a path that cannot be decoded', 'get', '/api/%E0%A4%A', 400, 'malformed_request'],
      ['a refusal thrown by a route', 'get', '/api/sample/refused', 403, 'request_refused'],
    ] as const)('%s', async (_name, method, path, status, code) => {
      const response = await request(server)[method](path);

      expect(response.status).toBe(status);
      expect(response.type).toBe('application/json');
      const parsed = apiErrorSchema.parse(response.body);
      expect(parsed.error.code).toBe(code);
      expect(parsed.error).not.toHaveProperty('details');
      expect(response.text).not.toContain(SAMPLE_SECRET);
    });

    it.each([
      ['under /api', '/api/sample'],
      ['outside /api', '/nowhere'],
    ])('a body that is not JSON, %s', async (_name, path) => {
      const response = await request(server)
        .post(path)
        .set('Content-Type', 'application/json')
        .send('{"name": ');

      expect(response.status).toBe(400);
      expect(apiErrorSchema.parse(response.body).error.code).toBe('malformed_request');
    });

    it('a body over the size limit', async () => {
      const response = await request(server)
        .post('/api/sample')
        .send({ name: 'x'.repeat(200_000), count: 1 });

      expect(response.status).toBe(413);
      expect(apiErrorSchema.parse(response.body).error.code).toBe('payload_too_large');
    });

    it('a fault of the server says nothing about itself and is logged with the request id', async () => {
      const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const response = await request(server).get('/api/sample/fault');

      expect(response.status).toBe(500);
      const parsed = apiErrorSchema.parse(response.body);
      expect(parsed.error.code).toBe('internal_error');
      expect(response.text).not.toContain(SAMPLE_SECRET);
      expect(response.text).not.toContain(SAMPLE_ROW_VALUE);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged.mock.calls[0]?.[0]).toContain(parsed.error.requestId);
      // The stack names the fault; the other fields of the error stay out of the log.
      expect(logged.mock.calls.flat().join('\n')).toContain(SAMPLE_SECRET);
      expect(logged.mock.calls.flat().join('\n')).not.toContain(SAMPLE_ROW_VALUE);
    });

    it('a refusal is not logged as a fault', async () => {
      const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await request(server).get('/api/nowhere');
      await request(server).post('/api/sample').send({});

      expect(logged).not.toHaveBeenCalled();
    });
  });

  describe('request ids', () => {
    it('every answer carries its own id', async () => {
      const first = await request(server).get('/api/health');
      const second = await request(server).get('/api/health');

      expect(first.headers['x-request-id']).toMatch(UUID);
      expect(second.headers['x-request-id']).toMatch(UUID);
      expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
    });

    it.each([
      ['under /api', 'get', '/api/nowhere'],
      ['outside /api', 'get', '/nowhere'],
      ['from the body parser', 'post', '/api/sample'],
    ] as const)('an error answer names the id of its header, %s', async (_name, method, path) => {
      const response = await request(server)
        [method](path)
        .set('Content-Type', 'application/json')
        .send(method === 'post' ? '{' : undefined);

      expect(response.headers['x-request-id']).toMatch(UUID);
      expect(apiErrorSchema.parse(response.body).error.requestId).toBe(
        response.headers['x-request-id'],
      );
    });

    it('an id sent by the client is not used', async () => {
      const response = await request(server)
        .get('/api/nowhere')
        .set('X-Request-Id', 'chosen-by-the-client');

      expect(response.headers['x-request-id']).toMatch(UUID);
      expect(response.text).not.toContain('chosen-by-the-client');
    });
  });

  // docs/build-plan.md, task 0.7c: "JSON bodies only"; done when "a
  // form-encoded body is refused". From the review of 0.6a: a plain HTML form of
  // another site can build a form-encoded body, never a JSON one.
  describe('JSON bodies only', () => {
    it.each([
      ['a form-encoded body', 'application/x-www-form-urlencoded', 'name=Sample&count=1'],
      ['a plain-text body', 'text/plain', '{"name":"Sample","count":1}'],
      ['a multipart body', 'multipart/form-data; boundary=x', '--x--\r\n'],
      ['a body that only ends like JSON', 'application/not-json', '{"name":"Sample","count":1}'],
    ])('refuses %s in the one error shape', async (_name, type, body) => {
      const response = await request(server)
        .post('/api/sample')
        .set('Content-Type', type)
        .send(body);

      expect(response.status).toBe(415);
      const parsed = apiErrorSchema.parse(response.body);
      expect(parsed.error.code).toBe('unsupported_media_type');
      expect(parsed.error.requestId).toBe(response.headers['x-request-id']);
    });

    it('refuses a body that names no type', async () => {
      // Bytes are sent as they are, without a `Content-Type`.
      const response = await request(server)
        .post('/api/sample')
        .send(Buffer.from('{"name":"Sample","count":1}'));

      expect(response.request.getHeader('Content-Type')).toBeUndefined();
      expect(response.status).toBe(415);
      expect(apiErrorSchema.parse(response.body).error.code).toBe('unsupported_media_type');
    });

    // The route would accept this body as JSON: the refusal comes before the route.
    it('does not hand a form-encoded body to a route that would accept its fields', async () => {
      const response = await request(server).post('/api/sample').type('form').send({
        name: 'Sample',
        count: 1,
      });

      expect(response.status).toBe(415);
      expect(response.body).not.toHaveProperty('receivedAt');
    });

    it('refuses it on a path that does not exist and on a reading request too', async () => {
      const unknown = await request(server).post('/nowhere').type('form').send({ a: '1' });
      const reading = await request(server).get('/api/health').type('form').send({ a: '1' });

      expect(unknown.status).toBe(415);
      expect(reading.status).toBe(415);
    });

    it.each(['application/json', 'application/json; charset=utf-8', 'Application/JSON'])(
      'reads a body of the type "%s"',
      async (type) => {
        const response = await request(server)
          .post('/api/sample')
          .set('Content-Type', type)
          .send('{"name":"Sample","count":1}');

        expect(response.status).toBe(201);
      },
    );

    it.each([
      ['no body and no length', undefined],
      ['an empty body, as a browser sends it', '0'],
    ])('lets a request with %s through to its route', async (_name, length) => {
      const call = request(server).post('/api/sample');
      const response = await (length === undefined ? call : call.set('Content-Length', length));

      // The route answers: it has no body to check.
      expect(response.status).toBe(400);
      expect(apiErrorSchema.parse(response.body).error.code).toBe('validation_failed');
    });

    // The cross-site check stands in front: its answer does not change.
    it('still answers a form of another site as a request from another site', async () => {
      const response = await request(server)
        .post('/api/sample')
        .set('Sec-Fetch-Site', 'cross-site')
        .type('form')
        .send({ name: 'Sample', count: '1' });

      expect(response.status).toBe(403);
      expect(apiErrorSchema.parse(response.body).error.code).toBe('cross_site_request');
    });
  });

  // docs/build-plan.md, task 0.7c: "`Cache-Control: no-store` on every answer".
  // From the review of 0.6a: a shared classroom computer keeps no answer.
  describe('no answer may be kept', () => {
    it.each([
      ['an answer with a body', 'get', '/api/sample', 200],
      ['the public health route', 'get', '/api/health', 200],
      ['a refused input', 'get', '/api/sample?limit=1000', 400],
      ['a refusal thrown by a route', 'get', '/api/sample/refused', 403],
      ['an unknown path under /api', 'get', '/api/nowhere', 404],
      ['an unknown path outside /api', 'get', '/nowhere', 404],
      ['a path that cannot be decoded', 'get', '/api/%E0%A4%A', 400],
      ['a preflight request', 'options', '/api/health', 404],
    ] as const)('%s carries no-store', async (_name, method, path, status) => {
      const response = await request(server)[method](path);

      expect(response.status).toBe(status);
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('so does a fault of the server', async () => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const response = await request(server).get('/api/sample/fault');

      expect(response.status).toBe(500);
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('so do the refusals that come before a route', async () => {
      const post = () => request(server).post('/api/sample');
      const answers = {
        notJson: await post().type('form').send({ name: 'Sample' }),
        broken: await post().set('Content-Type', 'application/json').send('{"name": '),
        tooLarge: await post().send({ name: 'x'.repeat(200_000), count: 1 }),
        otherSite: await post()
          .set('Sec-Fetch-Site', 'cross-site')
          .send({ name: 'Sample', count: 1 }),
      };

      expect(Object.values(answers).map((response) => response.status)).toEqual([
        415, 400, 413, 403,
      ]);
      for (const response of Object.values(answers)) {
        expect(response.headers['cache-control']).toBe('no-store');
      }
    });
  });

  // Owner, 4 October 2026: CORS stays off; web app and API share one origin.
  describe('requests from another site', () => {
    it.each([
      ['a plain request', 'get'],
      ['a preflight request', 'options'],
    ] as const)('%s gets no permission to read the answer', async (_name, method) => {
      const response = await request(server)
        [method]('/api/health')
        .set('Origin', 'https://another-site.example')
        .set('Access-Control-Request-Method', 'GET');

      expect(response.headers).not.toHaveProperty('access-control-allow-origin');
      expect(response.headers).not.toHaveProperty('access-control-allow-credentials');
    });
  });
});
