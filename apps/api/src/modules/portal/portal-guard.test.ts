import type { NestExpressApplication } from '@nestjs/platform-express';
import { apiErrorSchema, PERMISSIONS } from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { ParentsKit } from '../../testing/parents-kit.js';
import { permissionRows } from '../../testing/permission-sample.controller.js';
import { signInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

// Task 11.2 (decision 1 of pull request #294, Look first; permission review should-fix 1): the
// guard lets a parent session into a portal route only while the table gives the `parent`
// role `view` in `portal`. With that row taken out, the parent is refused. Names are invented.
describe('the portal guard', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      database: database.app,
      clock: new FixedClock('2026-10-05T09:00:00+05:00'),
      permissionTable: { ...PERMISSIONS, portal: permissionRows({}) },
    });
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('refuses a parent when the table gives the parent no view of the portal', async () => {
    const branch = await insertBranch(database.migrator, 'North');
    const staff = await signInKit(app).fullSession('Bahodir', 'Qodirov');
    const parents = new ParentsKit(app, database.migrator, staff.account.id);
    const { relativeId } = await parents.student(branch);
    const parent = await parents.session(relativeId);
    const response = await request(app.getHttpServer())
      .get('/api/portal/children')
      .set('Cookie', parent.cookie);
    expect([response.status, apiErrorSchema.parse(response.body).error.code]).toEqual([
      403,
      'permission_denied',
    ]);
    // Its own account's routes still answer: only the portal row was taken out.
    const own = await request(app.getHttpServer())
      .get('/api/auth/session')
      .set('Cookie', parent.cookie);
    expect(own.status).toBe(200);
  });
});
