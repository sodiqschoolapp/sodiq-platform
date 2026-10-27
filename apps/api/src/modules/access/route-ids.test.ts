import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../../openapi/build-document.js';
import { createTestApp } from '../../testing/create-test-app.js';
import {
  idProblems,
  inputIdsOf,
  type InputIds,
  type RouteIds,
} from '../../testing/route-id-check.js';
import { ROUTE_IDS } from '../../testing/route-id-list.js';

/** The module of a route, as its path names it: `POST /api/timetable/lessons/:id/move` is `timetable`. */
function moduleOf(route: string): string {
  return /^\S+ \/api\/([^/:\s]+)/.exec(route)?.[1] ?? '';
}

/**
 * docs/spec/02-roles-and-access.md, Rules: "Every role is limited to a branch
 * ... The limit is enforced on the server"; `CLAUDE.md`: "A query never
 * returns another branch's rows". Every id a route takes, in its path, its
 * query or its body, names the record and the tests that send another
 * branch's id and an unknown one and see 404 with the rows of both branches
 * and the audit log unchanged (`.claude/rules/api.md`, tasks 1.3 and 1.5;
 * task 10.3b). The ids are read from the OpenAPI document, which describes
 * every input by the schema the route validates it with.
 */
describe('the ids of the routes', () => {
  let app: INestApplication;
  let inputs: Record<string, InputIds>;

  beforeAll(async () => {
    app = await createTestApp();
    inputs = inputIdsOf(buildOpenApiDocument(app));
  });

  afterAll(async () => {
    await app.close();
  });

  const modules = [
    'access',
    'audit',
    'auth',
    'classes',
    'exemptions',
    'forced-deletes',
    'groups',
    'journal',
    'notifications',
    'people',
    'plans',
    'results',
    'setup',
    'timetable',
  ];

  it.each(modules)('of %s are listed, each with its tests', (name) => {
    const problems = idProblems(inputs, ROUTE_IDS).filter((problem) => moduleOf(problem) === name);
    expect(problems).toEqual([]);
  });

  it('are listed for no module but those', () => {
    const problems = idProblems(inputs, ROUTE_IDS).filter(
      (problem) => !modules.includes(moduleOf(problem)),
    );
    expect(problems).toEqual([]);
  });
});

// The list is only worth something if it sees a difference.
describe('the check of the ids', () => {
  const uuid = { type: 'string', format: 'uuid' };
  const document = {
    openapi: '3.0.0',
    info: { title: 'sample', version: '1' },
    components: { schemas: { Room: { type: 'object', properties: { roomId: uuid } } } },
    paths: {
      '/api/sample/lessons/{id}/move': {
        post: {
          responses: {},
          parameters: [
            { name: 'id', in: 'path', required: true, schema: uuid },
            { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    order: { type: 'array', items: uuid },
                    ids: { type: 'array', items: { type: 'string' } },
                    copyFrom: uuid,
                    note: { type: 'string' },
                    place: { $ref: '#/components/schemas/Room' },
                    rows: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: { classId: uuid, hours: { type: 'number' } },
                      },
                    },
                    target: {
                      oneOf: [
                        {
                          type: 'object',
                          properties: { kind: { type: 'string', const: 'class' }, classId: uuid },
                        },
                        {
                          type: 'object',
                          properties: {
                            kind: { type: 'string', enum: ['teacher'] },
                            staffId: uuid,
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/sample/day': {
        get: {
          responses: {},
          parameters: [
            { name: 'classId', in: 'query', schema: uuid },
            { name: 'date', in: 'query', schema: { type: 'string' } },
          ],
        },
      },
      '/api/sample/health': { get: { responses: {} } },
    },
  } as unknown as OpenAPIObject;

  const sources: Record<string, string> = {
    'src/sample/lessons.test.ts': `
      it("refuses another branch's ids", async () => {
        await request(app).post(\`/api/sample/lessons/\${id}/move\`).expect(404);
      });
      it("refuses a used key with another branch's id", async () => {
        await request(app).post(\`/api/sample/lessons/\${id}/move\`).expect(404);
      });`,
    'src/sample/day.test.ts': `
      it("answers none of the other branch's rows", async () => {
        await request(app).get('/api/sample/day').expect(200); // 404
      });`,
    'src/sample/quiet.test.ts': `it('is something else', () => { get('/api/sample/day'); });`,
  };
  const read = (file: string): string | undefined => sources[file];

  const refused = ["src/sample/lessons.test.ts > refuses another branch's ids"];
  const repeated = ["src/sample/lessons.test.ts > refuses a used key with another branch's id"];
  const branch = (id: string, record: string) => ({
    id,
    record,
    kind: 'branch' as const,
    rule: '.claude/rules/api.md, task 1.3',
    refusedIn: refused,
    repeatIn: repeated,
  });
  const complete: RouteIds = {
    'POST /api/sample/lessons/:id/move': [
      branch('path:id', 'lesson'),
      branch('body:order', 'lesson'),
      branch('body:ids', 'lesson'),
      branch('body:copyFrom', 'lesson'),
      branch('body:place.roomId', 'room'),
      branch('body:rows[].classId', 'class'),
      branch('body:target<kind=class>.classId', 'class'),
      branch('body:target<kind=teacher>.staffId', 'staff'),
    ],
    'GET /api/sample/day': [
      {
        id: 'query:classId',
        record: 'class',
        kind: 'branch',
        rule: "CLAUDE.md, a query never returns another branch's rows",
        refusedIn: ["src/sample/day.test.ts > answers none of the other branch's rows"],
      },
    ],
  };

  it('reads every path parameter, uuid field, field named like an id, variant and request key', () => {
    expect(inputIdsOf(document)).toEqual({
      'POST /api/sample/lessons/:id/move': {
        ids: [
          'path:id',
          'body:order',
          'body:ids',
          'body:copyFrom',
          'body:place.roomId',
          'body:rows[].classId',
          'body:target<kind=class>.classId',
          'body:target<kind=teacher>.staffId',
        ],
        requestKey: true,
      },
      'GET /api/sample/day': { ids: ['query:classId'], requestKey: false },
    });
  });

  it('passes a complete list', () => {
    expect(idProblems(inputIdsOf(document), complete, read)).toEqual([]);
  });

  it('names an id left out, a stray line, a route that takes no id, a missing or wrong test, a school line of a branch record, a line with tests it should not have, and a request key without its repeat', () => {
    const lines: RouteIds = {
      'POST /api/sample/lessons/:id/move': [
        { ...branch('path:id', 'lesson'), repeatIn: [] },
        branch('body:order', 'lesson'),
        branch('body:order', 'lesson'),
        branch('body:copyFrom', 'lesson'),
        {
          id: 'body:place.roomId',
          record: 'room',
          kind: 'school',
          rule: 'x',
          refusedIn: [],
        },
        branch('body:rows[].classId', 'class'),
        branch('body:target<kind=class>.classId', 'class'),
        {
          id: 'body:target<kind=teacher>.staffId',
          record: 'staff',
          kind: 'branch',
          rule: '',
          refusedIn: ['src/sample/lessons.test.ts > is not there', 'src/sample/gone.test.ts > x'],
          repeatIn: repeated,
        },
        branch('body:note', 'note'),
      ],
      'GET /api/sample/day': [
        {
          id: 'query:classId',
          record: 'class',
          kind: 'none',
          rule: 'x',
          refusedIn: ['src/sample/quiet.test.ts > is something else'],
        },
      ],
      'GET /api/sample/health': [],
      'GET /api/sample/gone/:id': [],
    };

    expect(idProblems(inputIdsOf(document), lines, read)).toEqual([
      'POST /api/sample/lessons/:id/move: 2 lines for body:order, it needs exactly one',
      'POST /api/sample/lessons/:id/move: 0 lines for body:ids, it needs exactly one',
      "POST /api/sample/lessons/:id/move path:id: no test repeats a used request key with another branch's id and an unknown one",
      'POST /api/sample/lessons/:id/move body:place.roomId: room is not a record of the whole school',
      'POST /api/sample/lessons/:id/move body:target<kind=teacher>.staffId: a branch line without the rule it rests on',
      'POST /api/sample/lessons/:id/move body:target<kind=teacher>.staffId: src/sample/lessons.test.ts has no test "is not there"',
      'POST /api/sample/lessons/:id/move body:target<kind=teacher>.staffId: src/sample/gone.test.ts does not exist',
      'POST /api/sample/lessons/:id/move: a line for body:note, which the route does not take',
      'GET /api/sample/day query:classId: a none line names tests',
      'GET /api/sample/health: in the id list, but the route takes no id or does not exist',
      'GET /api/sample/gone/:id: in the id list, but the route takes no id or does not exist',
    ]);
  });

  it('names a test file that never names the route or never expects a 404, and repeat tests on a route without a key', () => {
    const lines: RouteIds = {
      ...complete,
      'GET /api/sample/day': [
        {
          id: 'query:classId',
          record: 'class',
          kind: 'branch',
          rule: 'x',
          refusedIn: [
            'src/sample/quiet.test.ts > is something else',
            "src/sample/lessons.test.ts > refuses another branch's ids",
          ],
          repeatIn: ["src/sample/day.test.ts > answers none of the other branch's rows"],
        },
      ],
    };

    expect(idProblems(inputIdsOf(document), lines, read)).toEqual([
      'GET /api/sample/day query:classId: src/sample/quiet.test.ts never expects a 404',
      'GET /api/sample/day query:classId: src/sample/lessons.test.ts never names day of the route',
      'GET /api/sample/day query:classId: repeat tests named, but the route takes no request key',
    ]);
  });
});
