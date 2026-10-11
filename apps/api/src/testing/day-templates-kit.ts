import type { INestApplication } from '@nestjs/common';
import { BRANCH_HEADER, type DayTemplate, type SlotType } from '@sodiq/shared';
import request, { type Response, type Test } from 'supertest';
import { expect } from 'vitest';
import { insertBranch } from './branch-filter-sql.js';
import { createTestApp } from './create-test-app.js';
import { FixedClock } from './fixed-clock.js';
import { signInKit, type SignInKit } from './sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

/**
 * Saturday 10 October 2026, 23:55 in Tashkent (18:55 UTC): today is
 * 2026-10-10 in branch time, so a change takes effect from 2026-10-11 at the
 * earliest. Six minutes later it is the 11th in Tashkent and still the 10th
 * in UTC, which the test of branch time uses; a test never moves the clock
 * further, or the sessions end (idle limit of 15 minutes).
 */
export const START = '2026-10-10T23:55:00+05:00';
export const TODAY = '2026-10-10';
export const TOMORROW = '2026-10-11';
/** Monday after the start. */
export const MONDAY = '2026-10-12';

export const UNKNOWN = '0199a000-0000-7000-8000-000000000099';

/**
 * The application, its database and the accounts the route tests of slot
 * types and day templates (task 1.5) sign in with: a Super Admin, and in the
 * branch `north` a Principal, an Academic Vice Principal and a Teacher. All
 * names are invented.
 */
export interface DayTemplatesKit {
  readonly database: TestDatabase;
  readonly app: INestApplication;
  readonly kit: SignInKit;
  readonly clock: FixedClock;
  readonly north: string;
  readonly south: string;
  readonly admin: string;
  readonly adminAssignment: string;
  readonly principal: string;
  readonly vicePrincipal: string;
  readonly viceAssignment: string;
  readonly teacher: string;
  close(): Promise<void>;
  newBranch(): Promise<string>;
  get(path: string, branch: string, cookie?: string): Test;
  post(path: string, branch: string, body?: object, cookie?: string): Test;
  patch(path: string, branch: string, body: object, cookie?: string): Test;
  /** The audit entries of an action, oldest first, of one record when named. */
  entries(action: string, recordId?: string): Promise<Record<string, unknown>[]>;
  auditCount(): Promise<number>;
  createSlotType(
    branch: string,
    name: string,
    kind?: string,
    lengthMinutes?: number,
  ): Promise<string>;
  createTemplate(
    branch: string,
    name: string,
    slotTypeIds: readonly string[],
    startTime?: string,
  ): Promise<string>;
  assign(
    branch: string,
    dayTemplateId: string,
    key?: {
      level?: string;
      weekday?: number | null;
      gradeFrom?: number | null;
      gradeTo?: number | null;
    },
    from?: string,
  ): Promise<string>;
}

export async function dayTemplatesKit(): Promise<DayTemplatesKit> {
  const database = await createTestDatabase();
  const clock = new FixedClock(START);
  const north = await insertBranch(database.migrator, 'North');
  const south = await insertBranch(database.migrator, 'South');
  const app = await createTestApp({ database: database.app, clock });
  const kit = signInKit(app);
  const adminBrowser = await kit.completeSession('Aziza', 'Karimova');
  await kit.giveRole(adminBrowser.account.id, { role: 'super_admin' });
  const principalBrowser = await kit.fullSession('Bobur', 'Aliyev');
  await kit.giveRole(principalBrowser.account.id, { role: 'principal', branchId: north });
  const viceBrowser = await kit.completeSession('Dilnoza', 'Saidova');
  await kit.giveRole(viceBrowser.account.id, { role: 'academic_vice_principal', branchId: north });
  const teacherBrowser = await kit.fullSession('Jasur', 'Ergashev');
  await kit.giveRole(teacherBrowser.account.id, { role: 'teacher', branchId: north });
  const assignmentOf = async (accountId: string) =>
    (
      await database.migrator
        .selectFrom('assignments')
        .select('id')
        .where('account_id', '=', accountId)
        .executeTakeFirstOrThrow()
    ).id;
  const admin = adminBrowser.cookie;

  const get = (path: string, branch: string, cookie = admin) =>
    kit.get(path, cookie).set(BRANCH_HEADER, branch);
  const post = (path: string, branch: string, body: object = {}, cookie = admin) =>
    kit.post(path, cookie).set(BRANCH_HEADER, branch).send(body);
  const patch = (path: string, branch: string, body: object, cookie = admin) =>
    request(kit.server).patch(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body);

  const created = (response: Response, what: string): void => {
    expect(response.status, `${what}: ${JSON.stringify(response.body)}`).toBe(201);
  };

  let branches = 0;
  return {
    database,
    app,
    kit,
    clock,
    north,
    south,
    admin,
    adminAssignment: await assignmentOf(adminBrowser.account.id),
    principal: principalBrowser.cookie,
    vicePrincipal: viceBrowser.cookie,
    viceAssignment: await assignmentOf(viceBrowser.account.id),
    teacher: teacherBrowser.cookie,
    async close() {
      await app.close();
      await database.destroy();
    },
    newBranch() {
      branches += 1;
      return insertBranch(database.migrator, `Branch ${String(branches)}`);
    },
    get,
    post,
    patch,
    async entries(action, recordId) {
      let query = database.migrator
        .selectFrom('audit_log')
        .selectAll()
        .where('action', '=', action)
        .orderBy('occurred_at')
        .orderBy('id');
      if (recordId !== undefined) {
        query = query.where('record_id', '=', recordId);
      }
      return query.execute();
    },
    async auditCount() {
      return Number(
        (
          await database.migrator
            .selectFrom('audit_log')
            .select((select) => select.fn.countAll().as('count'))
            .executeTakeFirstOrThrow()
        ).count,
      );
    },
    async createSlotType(branch, name, kind = 'lesson', lengthMinutes = 45) {
      const response = await post('/api/setup/slot-types', branch, { name, kind, lengthMinutes });
      created(response, name);
      return (response.body as SlotType).id;
    },
    async createTemplate(branch, name, slotTypeIds, startTime = '08:00') {
      const response = await post('/api/setup/day-templates', branch, {
        name,
        startTime,
        slotTypeIds,
      });
      created(response, name);
      return (response.body as DayTemplate).id;
    },
    async assign(branch, dayTemplateId, key = {}, from = TOMORROW) {
      const response = await post('/api/setup/day-template-assignments', branch, {
        level: key.level ?? 'default',
        weekday: key.weekday ?? null,
        gradeFrom: key.gradeFrom ?? null,
        gradeTo: key.gradeTo ?? null,
        dayTemplateId,
        from,
      });
      created(response, 'assignment');
      return (response.body as { id: string }).id;
    },
  };
}
