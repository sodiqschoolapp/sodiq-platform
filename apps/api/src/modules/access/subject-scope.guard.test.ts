import type { Server } from 'node:http';
import { Controller, HttpCode, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { BRANCH_HEADER } from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Transactions } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { Returns, ValidParams } from '../../http/schemas.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { SAMPLE_PERMISSIONS } from '../../testing/permission-sample.controller.js';
import { signInKit, type SignInKit } from '../../testing/sign-in-kit.js';
import { insertSubject } from '../../testing/subjects-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { Audit } from '../audit/audit.service.js';
import { requiresInTable } from './access.decorators.js';
import { CurrentAccess, type Access } from './permission.guard.js';
import { inSubjectScope } from './subject-scope.js';

const subjectParamsSchema = z.object({ subjectId: z.uuid() });

/**
 * A route of the tests with subject scope, as a journal or plan route will
 * be: the guard decides role and branch, the route the subject, and the audit
 * entry names the assignment whose subjects fit.
 */
@Controller('subject-sample')
class SubjectSampleController {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
  ) {}

  @Post(':subjectId')
  @HttpCode(200)
  @requiresInTable('sample', 'edit')
  @Returns(z.object({ assignmentId: z.uuid() }))
  async act(
    @CurrentAccess() access: Access,
    @ValidParams(subjectParamsSchema) params: z.infer<typeof subjectParamsSchema>,
  ): Promise<{ assignmentId: string }> {
    const allowed = inSubjectScope(access, params.subjectId);
    if (allowed === undefined) {
      throw new ApiException('permission_denied', 403);
    }
    await this.transactions.run(access.branchIds, (transaction) =>
      this.audit.record(transaction, {
        branchId: access.branchId,
        actorId: access.accountId,
        assignmentId: allowed.id,
        action: 'test.sample_subject',
        record: { type: 'subject', id: params.subjectId },
      }),
    );
    return { assignmentId: allowed.id };
  }
}

// Build plan 2.3b: "subject scope in the permission guard (`decide` with every
// permitting assignment, the audit entry naming the one whose scope fits)".
describe('a route with subject scope', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let server: Server;
  let kit: SignInKit;
  let north: string;
  let south: string;
  let mathematics: string;
  let physics: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    mathematics = await insertSubject(database.migrator, 'Mathematics');
    physics = await insertSubject(database.migrator, 'Physics');
    app = await createTestApp({
      database: database.app,
      clock: new FixedClock('2026-10-05T09:00:00+05:00'),
      controllers: [SubjectSampleController],
      permissionTable: SAMPLE_PERMISSIONS,
    });
    server = app.getHttpServer();
    kit = signInKit(app);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  const act = (cookies: string, branch: string, subject: string) =>
    request(server)
      .post(`/api/subject-sample/${subject}`)
      .set('Cookie', cookies)
      .set(BRANCH_HEADER, branch);

  async function auditOf(subject: string) {
    return database.migrator
      .selectFrom('audit_log')
      .select(['assignment_id'])
      .where('action', '=', 'test.sample_subject')
      .where('record_id', '=', subject)
      .execute();
  }

  it('names the assignment whose subjects fit, also when another permits the route first', async () => {
    const browser = await kit.fullSession('Anvar', 'Rasulov');
    // The Head Teacher assignment is read first (by id) and permits the route.
    const headTeacher = await kit.giveRole(browser.account.id, {
      role: 'head_teacher',
      branchId: north,
      subjectIds: [mathematics],
    });
    const senior = await kit.giveRole(browser.account.id, {
      role: 'senior_head_teacher',
      subjectIds: [physics],
    });

    const inPhysics = await act(browser.cookie, north, physics);
    const inMathematics = await act(browser.cookie, north, mathematics);

    expect(inPhysics.status).toBe(200);
    expect(inPhysics.body).toEqual({ assignmentId: senior.id });
    expect(inMathematics.body).toEqual({ assignmentId: headTeacher.id });
    expect(await auditOf(physics)).toEqual([{ assignment_id: senior.id }]);
    expect(await auditOf(mathematics)).toEqual([{ assignment_id: headTeacher.id }]);
  });

  it('refuses a Head Teacher in a subject they do not oversee, and in another branch', async () => {
    const browser = await kit.fullSession('Bahrom', 'Rasulov');
    await kit.giveRole(browser.account.id, { role: 'teacher', branchId: north });
    const subject = await insertSubject(database.migrator, 'Geometry');
    const other = await insertSubject(database.migrator, 'Optics');
    await kit.giveRole(browser.account.id, {
      role: 'head_teacher',
      branchId: north,
      subjectIds: [subject],
    });

    expect((await act(browser.cookie, north, other)).status).toBe(403);
    expect((await act(browser.cookie, south, subject)).status).toBe(403);
    expect((await act(browser.cookie, north, subject)).status).toBe(200);
    expect(await auditOf(other)).toEqual([]);
  });
});
