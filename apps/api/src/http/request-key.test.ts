import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { apiErrorSchema, BRANCH_HEADER } from '@sodiq/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../openapi/build-document.js';
import { addBranchFilter, insertBranch } from '../testing/branch-filter-sql.js';
import { createTestApp } from '../testing/create-test-app.js';
import { FixedClock } from '../testing/fixed-clock.js';
import { KeyedSampleController } from '../testing/keyed-sample.controller.js';
import { SAMPLE_PERMISSIONS } from '../testing/permission-sample.controller.js';
import { signInKit } from '../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';

// Stands for something a person typed.
const TYPED_VALUE = 'Typed-Value-Zarina-4417';

// docs/spec/edge-cases/developer-rules.md, "Repeat-safe actions" and "Branch
// filter", through a route: path parameters, key header, transaction. The
// branch is the one the permission guard allowed (`X-Branch-Id`).
describe('a route with a request key', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let server: Server;
  let north: string;
  let south: string;
  /** The session of a Head Teacher of both branches, who may create in the sample area. */
  let cookies: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    await sql`
      create table scratch_notes (
        id uuid primary key default uuidv7(),
        branch_id uuid not null references branches (id),
        label text not null
      )
    `.execute(database.migrator);
    await sql`grant select, insert on scratch_notes to sodiq_app`.execute(database.migrator);
    await addBranchFilter(database.migrator, 'scratch_notes');
    app = await createTestApp({
      database: database.app,
      clock: new FixedClock('2026-10-05T23:59:00+05:00'),
      controllers: [KeyedSampleController],
      permissionTable: SAMPLE_PERMISSIONS,
    });
    server = app.getHttpServer() as Server;
    const kit = signInKit(app);
    const browser = await kit.fullSession('Zarina', 'Tursunova');
    await kit.giveRole(browser.account.id, { role: 'head_teacher', branchId: north });
    await kit.giveRole(browser.account.id, { role: 'head_teacher', branchId: south });
    cookies = browser.cookie;
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  async function notes(branch: string): Promise<string[]> {
    const found = await sql<{ label: string }>`
      select label from scratch_notes where branch_id = ${branch} order by id
    `.execute(database.migrator);
    return found.rows.map((row) => row.label);
  }

  const NOTEBOOK: string = randomUUID();

  const post = (branch: string, key: string | undefined, label: string, notebook = NOTEBOOK) => {
    const call = request(server)
      .post(`/api/sample-notebooks/${notebook}/notes`)
      .set('Cookie', cookies)
      .set(BRANCH_HEADER, branch);
    return (key === undefined ? call : call.set('Idempotency-Key', key)).send({ label });
  };

  it('a repeated request with the same key changes nothing and gets the same answer', async () => {
    const key = randomUUID();

    const first = await post(north, key, 'once');
    const second = await post(north, key, 'once');

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await notes(north)).toEqual(['once']);
  });

  it('a request with a new key is a new action, written to the branch of the request', async () => {
    const response = await post(south, randomUUID(), 'south note');

    expect(response.status).toBe(201);
    expect(await notes(south)).toEqual(['south note']);
    expect(await notes(north)).toEqual(['once']);
  });

  it('the same key with other content is refused and changes nothing', async () => {
    const key = randomUUID();
    await post(south, key, 'kept');

    const otherBody = await post(south, key, 'other');
    const otherBranch = await post(north, key, 'kept');

    for (const response of [otherBody, otherBranch]) {
      expect(response.status).toBe(409);
      expect(apiErrorSchema.parse(response.body).error.code).toBe('request_key_reused');
    }
    expect(await notes(south)).toEqual(['south note', 'kept']);
    expect(await notes(north)).toEqual(['once']);
  });

  it.each([
    ['no key', undefined, 'invalid_type'],
    ['a key that is not a uuid', TYPED_VALUE, 'invalid_format'],
  ])('refuses a request with %s and names the header', async (_name, key, code) => {
    const response = await post(north, key, 'not written');

    expect(response.status).toBe(400);
    const parsed = apiErrorSchema.parse(response.body);
    expect(parsed.error.code).toBe('validation_failed');
    expect(parsed.error.details).toEqual([
      { path: 'Idempotency-Key', code, message: expect.any(String) as string },
    ]);
    expect(response.text).not.toContain(TYPED_VALUE);
    expect(await notes(north)).toEqual(['once']);
  });

  // CLAUDE.md, Conventions: validate every API input with a schema.
  it('refuses a path parameter that does not fit its schema and names it', async () => {
    const response = await post(north, randomUUID(), 'not written', TYPED_VALUE);

    expect(response.status).toBe(400);
    const parsed = apiErrorSchema.parse(response.body);
    expect(parsed.error.code).toBe('validation_failed');
    expect(parsed.error.details).toEqual([
      { path: 'notebookId', code: 'invalid_format', message: expect.any(String) as string },
    ]);
    expect(response.text).not.toContain(TYPED_VALUE);
    expect(await notes(north)).toEqual(['once']);
  });

  it('the OpenAPI document describes the path parameter, the key header and the branch header', () => {
    const operation =
      buildOpenApiDocument(app).paths['/api/sample-notebooks/{notebookId}/notes']?.post;

    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        {
          name: 'notebookId',
          in: 'path',
          required: true,
          schema: expect.objectContaining({ type: 'string', format: 'uuid' }) as unknown,
        },
        {
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          schema: expect.objectContaining({ type: 'string', format: 'uuid' }) as unknown,
        },
        {
          name: 'X-Branch-Id',
          in: 'header',
          required: true,
          schema: expect.objectContaining({ type: 'string', format: 'uuid' }) as unknown,
        },
      ]),
    );
    expect(operation?.parameters).toHaveLength(3);
  });
});
