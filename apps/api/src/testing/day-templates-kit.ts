import type { INestApplication } from '@nestjs/common';
import { BRANCH_HEADER, type DayTemplate, type SlotType } from '@sodiq/shared';
import request, { type Response, type Test } from 'supertest';
import { expect } from 'vitest';
import { sql } from 'kysely';
import { insertBranch } from './branch-filter-sql.js';
import { ClassesKit } from './classes-kit.js';
import { LoadKit } from './load-kit.js';
import { createTestApp, type TestAppOptions } from './create-test-app.js';
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
  put(path: string, branch: string, body: object, cookie?: string): Test;
  /**
   * The create of a student (`POST /api/people/students`). A body that names
   * no `classId` joins the kit's class of its grade in the year of the
   * branch that holds its start date (task 3.1b, decision 2: a student who
   * starts today or earlier is created with a class); a test of that rule
   * names `classId` itself.
   */
  postStudent(branch: string, body: object, cookie?: string): Promise<Response>;
  /** The kit's class of a grade in the year of the branch that holds `on`, created once; `null` without a year. */
  classOf(branch: string, grade: number, on: string): Promise<string | null>;
  /** The audit entries of an action, oldest first, of one record when named. */
  entries(action: string, recordId?: string): Promise<Record<string, unknown>[]>;
  auditCount(): Promise<number>;
  /**
   * Every row of the six tables of slot types and day templates in a branch,
   * each column: what a refused change must leave as it was, in both branches.
   */
  rowsOf(branch: string): Promise<Record<string, unknown[]>>;
  /**
   * A draft of the branch's latest year that is not closed, the year created
   * (2026-09-01 to 2027-05-31) when the branch has none: what a change of the
   * setup marks out of date (task 5.5a-3b-1), so a refused one shows it left it.
   */
  draftIn(branch: string): Promise<string>;
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

export async function dayTemplatesKit(
  options: Pick<TestAppOptions, 'photoStore' | 'mailer' | 'pdfRenderer'> & {
    /** For a test whose routes enqueue jobs: the job queue of the test database. */
    jobs?: boolean;
  } = {},
): Promise<DayTemplatesKit> {
  const database = await createTestDatabase();
  const clock = new FixedClock(START);
  const north = await insertBranch(database.migrator, 'North');
  const south = await insertBranch(database.migrator, 'South');
  const { jobs, ...rest } = options;
  const app = await createTestApp({
    database: database.app,
    clock,
    ...rest,
    ...(jobs === true ? { jobsDatabaseUrl: database.appUrl } : {}),
  });
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

  const put = (path: string, branch: string, body: object, cookie = admin) =>
    request(kit.server).put(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body);

  const created = (response: Response, what: string): void => {
    expect(response.status, `${what}: ${JSON.stringify(response.body)}`).toBe(201);
  };

  /** The kit's classes by year and grade, with the students the kit put in each. */
  const kitClasses = new Map<string, { id: string; placed: number }>();
  let kitClassCount = 0;
  /** The kit's class of a grade in the year of the branch that holds `on`, written by the migrator. */
  async function classOf(branch: string, grade: number, on: string): Promise<string | null> {
    const year = await database.migrator
      .selectFrom('academic_years')
      .select('id')
      .where('branch_id', '=', branch)
      .where('start_date', '<=', on)
      .where('end_date', '>=', on)
      .executeTakeFirst();
    if (year === undefined) {
      return null;
    }
    const key = `${year.id} ${String(grade)}`;
    const known = kitClasses.get(key);
    // A class holds 60 (CLASS_MAX_SIZE): the next one is opened when it is full.
    if (known !== undefined && known.placed < 60) {
      known.placed += 1;
      return known.id;
    }
    kitClassCount += 1;
    const row = await database.migrator
      .insertInto('classes')
      .values({
        branch_id: branch,
        academic_year_id: year.id,
        grade,
        name: `Kit ${'abcdefghijklmnopqrstuvwxyz'.charAt(kitClassCount % 26)}${'k'.repeat(Math.floor(kitClassCount / 26))}`,
        language: 'uz',
        main_room_id: null,
        max_size: 60,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    kitClasses.set(key, { id: row.id, placed: 1 });
    return row.id;
  }

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
    put,
    async postStudent(branch, body, cookie) {
      const fields = body as { classId?: unknown; grade?: unknown; startsOn?: unknown };
      if (
        fields.classId === undefined &&
        typeof fields.grade === 'number' &&
        typeof fields.startsOn === 'string'
      ) {
        const classId = await classOf(branch, fields.grade, fields.startsOn);
        return post('/api/people/students', branch, { ...body, classId }, cookie);
      }
      return post('/api/people/students', branch, body, cookie);
    },
    classOf,
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
    async rowsOf(branch) {
      const rows: Record<string, unknown[]> = {};
      for (const table of [
        'slot_types',
        'slot_type_lengths',
        'day_templates',
        'day_template_versions',
        'day_template_assignments',
        // Task 5.5a-3b-1: the drafts a template change marks out of date, and the marks.
        'timetable_versions',
        'timetable_version_out_of_date_causes',
        // Task 5.7b-1 (permission review, must-fix 1): the writes of dated lessons end their rows.
        'substitutions',
        'substitution_lessons',
      ] as const) {
        rows[table] = await database.migrator
          .selectFrom(table)
          .selectAll()
          .where('branch_id', '=', branch)
          .orderBy('id')
          .execute();
      }
      rows.day_template_slots = await database.migrator
        .selectFrom('day_template_slots')
        .selectAll()
        .where('branch_id', '=', branch)
        .orderBy('version_id')
        .orderBy('position')
        .execute();
      return rows;
    },
    async draftIn(branch) {
      const found = await database.migrator
        .selectFrom('academic_years')
        .select(['id', sql<string>`start_date::text`.as('start')])
        .where('branch_id', '=', branch)
        .where('status', '<>', 'closed')
        .orderBy('start_date', 'desc')
        .executeTakeFirst();
      const year = found?.id ?? (await new ClassesKit(database.migrator).year(branch));
      return new LoadKit(database.migrator).version(branch, year, {
        startsOn: found === undefined || found.start < '2026-10-19' ? '2026-10-19' : found.start,
      });
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
