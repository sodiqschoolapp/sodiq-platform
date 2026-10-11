import type { INestApplication } from '@nestjs/common';
import {
  academicYearListSchema,
  academicYearSchema,
  apiErrorSchema,
  BRANCH_HEADER,
  type AcademicYear,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { errorCode, signInKit, type SignInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { CONSTRAINT_REFUSALS, refusingConstraints } from './setup-refusals.js';

const START = '2026-10-10T09:00:00+05:00';
const UNKNOWN = '0199a000-0000-7000-8000-000000000099';

type Dates = [string | null, string | null];

const UNDATED_QUARTERS = [1, 2, 3, 4].map((number) => ({
  number,
  startDate: null,
  endDate: null,
}));

const DATED: Dates[] = [
  ['2026-09-02', '2026-10-31'],
  ['2026-11-10', '2026-12-27'],
  ['2027-01-12', '2027-03-20'],
  ['2027-03-30', '2027-05-25'],
];

const quartersBody = (dates: readonly Dates[]) => ({
  quarters: dates.map(([startDate, endDate]) => ({ startDate, endDate })),
});

/** The fields a refused body names, in order. */
const detailPaths = (response: Response): string[] =>
  apiErrorSchema.parse(response.body).error.details?.map((detail) => detail.path) ?? [];

const yearOf = (response: Response): AcademicYear => academicYearSchema.parse(response.body);

// All names are invented.
// docs/spec/03-school-setup.md: Academic year ("Start and end date. Status:
// planned, current, closed. Exactly one current year per branch."; owner:
// Super Admin) and Quarters ("Four per year, each with start and end. No
// overlaps, no gaps inside teaching time."; owner: Academic Vice Principal).
// docs/spec/edge-cases/academic-year.md: "Start year", the go-live date. The
// owner's answers 1 to 8 for task 1.3 and the plan of pull request #44.
describe('academic years', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let north: string;
  let south: string;
  let admin: string;
  let adminAssignment: string;
  let principal: string;
  let vicePrincipal: string;
  let viceAssignment: string;
  let teacher: string;
  const clock = new FixedClock(START);

  const get = (path: string, branch: string, cookie = admin) =>
    kit.get(path, cookie).set(BRANCH_HEADER, branch);

  const post = (path: string, branch: string, body: object = {}, cookie = admin) =>
    kit.post(path, cookie).set(BRANCH_HEADER, branch).send(body);

  const put = (path: string, branch: string, body: object, cookie = admin) =>
    request(kit.server).put(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body);

  const entries = (action: string, recordId?: string) => {
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
  };

  const auditCount = async (): Promise<number> =>
    Number(
      (
        await database.migrator
          .selectFrom('audit_log')
          .select((select) => select.fn.countAll().as('count'))
          .executeTakeFirstOrThrow()
      ).count,
    );

  let branches = 0;
  const newBranch = () => {
    branches += 1;
    return insertBranch(database.migrator, `Branch ${String(branches)}`);
  };

  async function createYear(branch: string, startDate: string, endDate: string): Promise<string> {
    const response = await post('/api/setup/academic-years', branch, { startDate, endDate });
    expect(response.status).toBe(201);
    return yearOf(response).id;
  }

  async function dateQuarters(branch: string, id: string, dates: readonly Dates[] = DATED) {
    const response = await put(
      `/api/setup/academic-years/${id}/quarters`,
      branch,
      quartersBody(dates),
    );
    expect(response.status).toBe(200);
  }

  const yearRow = (id: string) =>
    database.migrator
      .selectFrom('academic_years')
      .select(['start_date', 'end_date', 'status'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  /** A closed year, through the statuses as they go (no route closes a year before task 9.5a). */
  const closeYear = (id: string) =>
    database.migrator.transaction().execute(async (transaction) => {
      await transaction
        .updateTable('academic_years')
        .set({ status: 'current' })
        .where('id', '=', id)
        .execute();
      await transaction
        .updateTable('academic_years')
        .set({ status: 'closed' })
        .where('id', '=', id)
        .execute();
    });

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    app = await createTestApp({ database: database.app, clock });
    kit = signInKit(app);
    const adminBrowser = await kit.completeSession('Aziza', 'Karimova');
    await kit.giveRole(adminBrowser.account.id, { role: 'super_admin' });
    admin = adminBrowser.cookie;
    const principalBrowser = await kit.fullSession('Bobur', 'Aliyev');
    await kit.giveRole(principalBrowser.account.id, { role: 'principal', branchId: north });
    principal = principalBrowser.cookie;
    const viceBrowser = await kit.completeSession('Dilnoza', 'Saidova');
    await kit.giveRole(viceBrowser.account.id, {
      role: 'academic_vice_principal',
      branchId: north,
    });
    vicePrincipal = viceBrowser.cookie;
    const teacherBrowser = await kit.fullSession('Jasur', 'Ergashev');
    await kit.giveRole(teacherBrowser.account.id, { role: 'teacher', branchId: north });
    teacher = teacherBrowser.cookie;
    const assignmentOf = async (accountId: string) =>
      (
        await database.migrator
          .selectFrom('assignments')
          .select('id')
          .where('account_id', '=', accountId)
          .executeTakeFirstOrThrow()
      ).id;
    adminAssignment = await assignmentOf(adminBrowser.account.id);
    viceAssignment = await assignmentOf(viceBrowser.account.id);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  describe('a year', () => {
    it('is created by the Super Admin, planned, named from its dates, with four undated quarters and an audit entry', async () => {
      const branch = await newBranch();

      const response = await post('/api/setup/academic-years', branch, {
        startDate: '2026-09-02',
        endDate: '2027-05-25',
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.any(String) as string,
        name: '2026–2027',
        startDate: '2026-09-02',
        endDate: '2027-05-25',
        status: 'planned',
        quarters: UNDATED_QUARTERS,
      });
      const written = await entries('academic_year.create', yearOf(response).id);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        branch_id: branch,
        actor_id: expect.any(String) as string,
        assignment_id: adminAssignment,
        record_type: 'academic_year',
        new_value: { startDate: '2026-09-02', endDate: '2027-05-25' },
        request_id: response.headers['x-request-id'],
      });
    });

    it('is listed newest first, in its branch only, for the Principal and the Academic Vice Principal too', async () => {
      await createYear(north, '2026-09-02', '2027-05-25');
      await createYear(north, '2027-09-02', '2028-05-25');

      for (const cookie of [admin, principal, vicePrincipal]) {
        const response = await get('/api/setup/academic-years', north, cookie);
        expect(response.status).toBe(200);
        expect(academicYearListSchema.parse(response.body).years.map((one) => one.name)).toEqual([
          '2027–2028',
          '2026–2027',
        ]);
      }
      expect((await get('/api/setup/academic-years', south)).body).toEqual({ years: [] });
    });

    it('is refused when it shares a day with another year of the branch; nothing is written', async () => {
      const branch = await newBranch();
      await createYear(branch, '2026-09-02', '2027-05-25');
      const before = await auditCount();

      const response = await post('/api/setup/academic-years', branch, {
        startDate: '2025-09-10',
        endDate: '2026-09-02',
      });

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('dates_overlap');
      expect(detailPaths(response)).toEqual(['startDate', 'endDate']);
      expect(await auditCount()).toBe(before);
      const years = await database.migrator
        .selectFrom('academic_years')
        .select('id')
        .where('branch_id', '=', branch)
        .execute();
      expect(years).toHaveLength(1);
    });

    // Decision 13: a year before one already started could never become current.
    it('is refused before a year that has already started', async () => {
      const branch = await newBranch();
      const current = await createYear(branch, '2026-09-02', '2027-05-25');
      expect((await post(`/api/setup/academic-years/${current}/start`, branch)).status).toBe(200);

      const response = await post('/api/setup/academic-years', branch, {
        startDate: '2025-09-02',
        endDate: '2026-05-25',
      });

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('year_out_of_order');
    });

    it('is refused with dates that do not make a school year', async () => {
      const branch = await newBranch();
      const cases: [object, string][] = [
        [{ startDate: '2026-09-02', endDate: '2026-12-25' }, 'endDate'],
        [{ startDate: '2026-01-02', endDate: '2027-01-05' }, 'endDate'],
        [{ startDate: '2026-02-30', endDate: '2027-01-05' }, 'startDate'],
        [{ startDate: '02.09.2026', endDate: '2027-05-25' }, 'startDate'],
        [{ startDate: '2026-09-02' }, 'endDate'],
      ];
      for (const [body, path] of cases) {
        const response = await post('/api/setup/academic-years', branch, body);
        expect(response.status, JSON.stringify(body)).toBe(400);
        expect(errorCode(response)).toBe('validation_failed');
        expect(detailPaths(response)).toContain(path);
      }
    });
  });

  describe('the dates of a year', () => {
    it('are changed by the Super Admin with the old and new dates in the audit entry; the same dates write nothing', async () => {
      const branch = await newBranch();
      const id = await createYear(branch, '2026-09-02', '2027-05-25');

      const response = await put(`/api/setup/academic-years/${id}`, branch, {
        startDate: '2026-09-01',
        endDate: '2027-05-31',
      });

      expect(response.status).toBe(200);
      expect(yearOf(response)).toMatchObject({ startDate: '2026-09-01', endDate: '2027-05-31' });
      const written = await entries('academic_year.edit', id);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        branch_id: branch,
        assignment_id: adminAssignment,
        old_value: { startDate: '2026-09-02', endDate: '2027-05-25' },
        new_value: { startDate: '2026-09-01', endDate: '2027-05-31' },
        request_id: response.headers['x-request-id'],
      });

      const again = await put(`/api/setup/academic-years/${id}`, branch, {
        startDate: '2026-09-01',
        endDate: '2027-05-31',
      });
      expect(again.status).toBe(200);
      expect(await entries('academic_year.edit', id)).toHaveLength(1);
    });

    it('cannot leave a dated quarter outside the year', async () => {
      const branch = await newBranch();
      const id = await createYear(branch, '2026-09-02', '2027-05-25');
      await dateQuarters(branch, id);

      const response = await put(`/api/setup/academic-years/${id}`, branch, {
        startDate: '2026-09-02',
        endDate: '2027-05-20',
      });

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('outside_year');
      expect(detailPaths(response)).toEqual(['endDate']);
    });

    it('cannot overlap another year', async () => {
      const branch = await newBranch();
      await createYear(branch, '2026-09-02', '2027-05-25');
      const later = await createYear(branch, '2027-09-02', '2028-05-25');

      const response = await put(`/api/setup/academic-years/${later}`, branch, {
        startDate: '2027-05-20',
        endDate: '2028-05-19',
      });

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('dates_overlap');
    });

    // The review's correction 2: decision 13 holds on a change of dates too.
    it('cannot move a planned year before a year that has already started', async () => {
      const branch = await newBranch();
      const current = await createYear(branch, '2026-09-02', '2027-05-25');
      expect((await post(`/api/setup/academic-years/${current}/start`, branch)).status).toBe(200);
      const planned = await createYear(branch, '2027-09-02', '2028-05-25');

      const response = await put(`/api/setup/academic-years/${planned}`, branch, {
        startDate: '2025-09-02',
        endDate: '2026-05-25',
      });

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('year_out_of_order');
      expect(detailPaths(response)).toEqual(['startDate']);
    });

    it('do not change in a closed year', async () => {
      const branch = await newBranch();
      const id = await createYear(branch, '2025-09-02', '2026-05-25');
      await closeYear(id);

      const response = await put(`/api/setup/academic-years/${id}`, branch, {
        startDate: '2025-09-01',
        endDate: '2026-05-25',
      });

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('year_closed');
    });

    it('cannot leave the go-live date of the branch outside every planned or current year', async () => {
      const branch = await newBranch();
      const id = await createYear(branch, '2026-09-02', '2027-05-25');
      expect(
        (await put('/api/setup/branch/go-live', branch, { goLiveDate: '2026-09-10' })).status,
      ).toBe(200);

      const response = await put(`/api/setup/academic-years/${id}`, branch, {
        startDate: '2026-09-14',
        endDate: '2027-05-25',
      });

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('go_live_outside_year');
      expect(detailPaths(response)).toEqual(['startDate']);
    });

    it('of another branch, or an unknown year, are not found, and nothing changes', async () => {
      const id = await createYear(south, '2030-09-02', '2031-05-25');

      for (const target of [id, UNKNOWN]) {
        const response = await put(`/api/setup/academic-years/${target}`, north, {
          startDate: '2030-09-01',
          endDate: '2031-05-25',
        });
        expect(response.status).toBe(404);
      }
      expect(await yearRow(id)).toMatchObject({ start_date: '2030-09-02', status: 'planned' });
      expect(await entries('academic_year.edit', id)).toHaveLength(0);
    });
  });

  // edge/academic-year, "In August the school must prepare next year":
  // "'Start year' is one action by the Super Admin, available only after
  // 'Close the year' was carried out for the previous year"; owner's answer 6:
  // it works for a branch's first year too.
  describe('"Start year"', () => {
    it("makes a branch's first year current, with an audit entry; a second start changes nothing", async () => {
      const branch = await newBranch();
      const id = await createYear(branch, '2026-09-02', '2027-05-25');

      const response = await post(`/api/setup/academic-years/${id}/start`, branch);

      expect(response.status).toBe(200);
      expect(yearOf(response).status).toBe('current');
      const written = await entries('academic_year.start', id);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        branch_id: branch,
        assignment_id: adminAssignment,
        old_value: { status: 'planned' },
        new_value: { status: 'current' },
        request_id: response.headers['x-request-id'],
      });

      const again = await post(`/api/setup/academic-years/${id}/start`, branch);
      expect(again.status).toBe(200);
      expect(await entries('academic_year.start', id)).toHaveLength(1);
    });

    it('makes a year current once the year before it is closed', async () => {
      const branch = await newBranch();
      const previous = await createYear(branch, '2025-09-02', '2026-05-25');
      await closeYear(previous);
      const id = await createYear(branch, '2026-09-02', '2027-05-25');

      const response = await post(`/api/setup/academic-years/${id}/start`, branch);

      expect(response.status).toBe(200);
      expect(yearOf(response).status).toBe('current');
    });

    it('is refused while an earlier year is not closed, and while another year is current', async () => {
      const branch = await newBranch();
      const first = await createYear(branch, '2026-09-02', '2027-05-25');
      const second = await createYear(branch, '2027-09-02', '2028-05-25');

      const early = await post(`/api/setup/academic-years/${second}/start`, branch);
      expect(early.status).toBe(409);
      expect(errorCode(early)).toBe('earlier_year_not_closed');

      expect((await post(`/api/setup/academic-years/${first}/start`, branch)).status).toBe(200);
      const late = await post(`/api/setup/academic-years/${second}/start`, branch);
      expect(late.status).toBe(409);
      expect(errorCode(late)).toBe('current_year_exists');
      expect(await entries('academic_year.start', second)).toHaveLength(0);
    });

    // The permission review: every route that takes an id answers 404 for another branch's.
    it('of another branch, or an unknown year, is not found, and nothing changes', async () => {
      const id = await createYear(south, '2044-09-02', '2045-05-25');

      for (const target of [id, UNKNOWN]) {
        const response = await post(`/api/setup/academic-years/${target}/start`, north);
        expect(response.status).toBe(404);
      }
      expect(await yearRow(id)).toMatchObject({ status: 'planned' });
      expect(await entries('academic_year.start', id)).toHaveLength(0);
    });

    it('is refused for a closed year', async () => {
      const branch = await newBranch();
      const id = await createYear(branch, '2025-09-02', '2026-05-25');
      await closeYear(id);

      const response = await post(`/api/setup/academic-years/${id}/start`, branch);

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('year_closed');
    });

    it('twice at one moment makes the year current once, with one audit entry', async () => {
      const branch = await newBranch();
      const id = await createYear(branch, '2026-09-02', '2027-05-25');

      const answers = await Promise.all([
        post(`/api/setup/academic-years/${id}/start`, branch),
        post(`/api/setup/academic-years/${id}/start`, branch),
      ]);

      expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
      expect(await entries('academic_year.start', id)).toHaveLength(1);
    });
  });

  describe('the quarters', () => {
    it('are dated by the Academic Vice Principal, with the quarters that changed in the audit entry', async () => {
      const id = await createYear(north, '2032-09-02', '2033-05-25');

      const response = await put(
        `/api/setup/academic-years/${id}/quarters`,
        north,
        quartersBody([
          ['2032-09-02', '2032-10-31'],
          [null, null],
          [null, null],
          [null, null],
        ]),
        vicePrincipal,
      );

      expect(response.status).toBe(200);
      expect(yearOf(response).quarters[0]).toEqual({
        number: 1,
        startDate: '2032-09-02',
        endDate: '2032-10-31',
      });
      const written = await entries('quarters.edit', id);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        branch_id: north,
        assignment_id: viceAssignment,
        record_type: 'academic_year',
        old_value: { quarters: [{ number: 1, startDate: null, endDate: null }] },
        new_value: { quarters: [{ number: 1, startDate: '2032-09-02', endDate: '2032-10-31' }] },
        request_id: response.headers['x-request-id'],
      });
    });

    it('are dated by the Super Admin, all four in one save; the same dates write nothing', async () => {
      const branch = await newBranch();
      const id = await createYear(branch, '2026-09-02', '2027-05-25');
      await dateQuarters(branch, id);
      // Q1 ends after Q2's old start: the four are checked together.
      await dateQuarters(branch, id, [
        ['2026-09-02', '2026-11-15'],
        ['2026-11-20', '2026-12-30'],
        DATED[2] ?? [null, null],
        DATED[3] ?? [null, null],
      ]);

      const years = academicYearListSchema.parse(
        (await get('/api/setup/academic-years', branch)).body,
      ).years;
      expect(years[0]?.quarters.slice(0, 2)).toEqual([
        { number: 1, startDate: '2026-09-02', endDate: '2026-11-15' },
        { number: 2, startDate: '2026-11-20', endDate: '2026-12-30' },
      ]);
      await dateQuarters(branch, id, [
        ['2026-09-02', '2026-11-15'],
        ['2026-11-20', '2026-12-30'],
        DATED[2] ?? [null, null],
        DATED[3] ?? [null, null],
      ]);
      expect(await entries('quarters.edit', id)).toHaveLength(2);
    });

    it('lie inside their year', async () => {
      const branch = await newBranch();
      const id = await createYear(branch, '2026-09-02', '2027-05-25');

      const response = await put(
        `/api/setup/academic-years/${id}/quarters`,
        branch,
        quartersBody([
          ['2026-09-01', '2026-10-31'],
          [null, null],
          [null, null],
          ['2027-03-30', '2027-06-01'],
        ]),
      );

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('outside_year');
      expect(detailPaths(response)).toEqual(['quarters.0.startDate', 'quarters.3.endDate']);
    });

    it('follow each other in order without overlapping, each with both dates or neither', async () => {
      const branch = await newBranch();
      const id = await createYear(branch, '2026-09-02', '2027-05-25');
      const before = await auditCount();

      const response = await put(
        `/api/setup/academic-years/${id}/quarters`,
        branch,
        quartersBody([
          ['2026-09-02', '2026-10-31'],
          ['2026-10-31', '2026-12-27'],
          ['2027-01-12', null],
          [null, null],
        ]),
      );

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('validation_failed');
      expect(detailPaths(response)).toEqual(['quarters.1.startDate', 'quarters.2.endDate']);
      expect(await auditCount()).toBe(before);
    });

    it('do not change in a closed year', async () => {
      const branch = await newBranch();
      const id = await createYear(branch, '2025-09-02', '2026-05-25');
      await closeYear(id);

      const response = await put(
        `/api/setup/academic-years/${id}/quarters`,
        branch,
        quartersBody([
          ['2025-09-02', '2025-10-31'],
          [null, null],
          [null, null],
          [null, null],
        ]),
      );

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('year_closed');
    });

    it('of another branch are not found, for the Super Admin and the Academic Vice Principal, and nothing changes', async () => {
      const id = await createYear(south, '2034-09-02', '2035-05-25');

      for (const cookie of [admin, vicePrincipal]) {
        const response = await put(
          `/api/setup/academic-years/${id}/quarters`,
          north,
          quartersBody([
            ['2034-09-02', '2034-10-31'],
            [null, null],
            [null, null],
            [null, null],
          ]),
          cookie,
        );
        expect(response.status).toBe(404);
      }
      const quarters = await database.migrator
        .selectFrom('quarters')
        .select('start_date')
        .where('academic_year_id', '=', id)
        .execute();
      expect(quarters.map((quarter) => quarter.start_date)).toEqual([null, null, null, null]);
      expect(await entries('quarters.edit', id)).toHaveLength(0);
    });
  });

  // Owner's answer 7: "The go-live start date is one per branch, on the branch
  // record, set by the Super Admin; it must fall inside a planned or current
  // year."
  describe('the go-live date', () => {
    it('is set by the Super Admin inside a planned year, shown on the branch, with an audit entry', async () => {
      const branch = await newBranch();
      await createYear(branch, '2026-09-02', '2027-05-25');

      const response = await put('/api/setup/branch/go-live', branch, {
        goLiveDate: '2026-11-10',
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: branch, goLiveDate: '2026-11-10' });
      expect((await get('/api/setup/branch', branch)).body).toMatchObject({
        goLiveDate: '2026-11-10',
      });
      const written = await entries('branch.go_live', branch);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        branch_id: branch,
        assignment_id: adminAssignment,
        record_type: 'branch',
        old_value: { goLiveDate: null },
        new_value: { goLiveDate: '2026-11-10' },
        request_id: response.headers['x-request-id'],
      });

      expect(
        (await put('/api/setup/branch/go-live', branch, { goLiveDate: '2026-11-10' })).status,
      ).toBe(200);
      expect(await entries('branch.go_live', branch)).toHaveLength(1);
    });

    it('is set inside a current year, and cleared', async () => {
      const branch = await newBranch();
      const id = await createYear(branch, '2026-09-02', '2027-05-25');
      expect((await post(`/api/setup/academic-years/${id}/start`, branch)).status).toBe(200);

      expect(
        (await put('/api/setup/branch/go-live', branch, { goLiveDate: '2027-01-12' })).body,
      ).toMatchObject({ goLiveDate: '2027-01-12' });
      expect(
        (await put('/api/setup/branch/go-live', branch, { goLiveDate: null })).body,
      ).toMatchObject({ goLiveDate: null });
    });

    // The permission review: a year of another branch never counts.
    it('is refused on a date that only a year of another branch covers', async () => {
      const branch = await newBranch();
      const other = await newBranch();
      await createYear(other, '2026-09-02', '2027-05-25');

      const response = await put('/api/setup/branch/go-live', branch, { goLiveDate: '2026-11-10' });

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('go_live_outside_year');
      expect(await entries('branch.go_live', branch)).toHaveLength(0);
    });

    it('is refused outside every year and inside a closed one', async () => {
      const branch = await newBranch();
      const closed = await createYear(branch, '2025-09-02', '2026-05-25');
      await closeYear(closed);
      await createYear(branch, '2026-09-02', '2027-05-25');

      for (const goLiveDate of ['2026-07-01', '2025-11-10', '2027-05-26']) {
        const response = await put('/api/setup/branch/go-live', branch, { goLiveDate });
        expect(response.status, goLiveDate).toBe(409);
        expect(errorCode(response)).toBe('go_live_outside_year');
        expect(detailPaths(response)).toEqual(['goLiveDate']);
      }
      expect(await entries('branch.go_live', branch)).toHaveLength(0);
    });

    it('is a date or nothing', async () => {
      const response = await put('/api/setup/branch/go-live', north, { goLiveDate: '10.11.2026' });

      expect(response.status).toBe(400);
      expect(detailPaths(response)).toEqual(['goLiveDate']);
    });
  });

  // docs/spec/02-roles-and-access.md: the Principal "Changes nothing"; the
  // owner's answer 3 gives the years to the Super Admin and the quarters to the
  // Super Admin and the Academic Vice Principal.
  describe('are refused', () => {
    it('to the Principal, the Academic Vice Principal and a Teacher on every writing route of the years and the go-live date; nothing is written', async () => {
      const id = await createYear(north, '2036-09-02', '2037-05-25');
      const before = await auditCount();
      const calls = (cookie: string) => [
        post(
          '/api/setup/academic-years',
          north,
          { startDate: '2038-09-02', endDate: '2039-05-25' },
          cookie,
        ),
        put(
          `/api/setup/academic-years/${id}`,
          north,
          { startDate: '2036-09-01', endDate: '2037-05-25' },
          cookie,
        ),
        post(`/api/setup/academic-years/${id}/start`, north, {}, cookie),
        put('/api/setup/branch/go-live', north, { goLiveDate: '2036-11-10' }, cookie),
      ];
      for (const cookie of [principal, vicePrincipal, teacher]) {
        for (const response of await Promise.all(calls(cookie))) {
          expect(response.status).toBe(403);
          expect(errorCode(response)).toBe('permission_denied');
        }
      }
      expect(await auditCount()).toBe(before);
    });

    it('to the Principal and a Teacher on the quarters, and the list to a Teacher', async () => {
      const id = await createYear(north, '2040-09-02', '2041-05-25');
      for (const cookie of [principal, teacher]) {
        const response = await put(
          `/api/setup/academic-years/${id}/quarters`,
          north,
          quartersBody([
            ['2040-09-02', '2040-10-31'],
            [null, null],
            [null, null],
            [null, null],
          ]),
          cookie,
        );
        expect(response.status).toBe(403);
      }
      expect((await get('/api/setup/academic-years', north, teacher)).status).toBe(403);
      expect(await entries('quarters.edit', id)).toHaveLength(0);
    });
  });

  // The lock order of AcademicYears (the spec review of the plan, must-fix 7):
  // a year edit takes the branch row, then the year row, for update; a quarter
  // save takes the year row; the go-live save takes the branch row and reads
  // the years without a lock. A test takes the locks as the year edit does,
  // changes the dates and holds the transaction open, sends the other call,
  // sees it wait in pg_stat_activity, lets the lock go and reads the answer:
  // the waiting call decides on the dates that were committed.
  describe('wait for a change of the dates of their year', () => {
    function gate(): { opened: Promise<void>; open: () => void } {
      let open = (): void => undefined;
      const opened = new Promise<void>((resolve) => {
        open = resolve;
      });
      return { opened, open };
    }

    interface Backend {
      wait_event_type: string | null;
    }

    async function waitForWaiter(): Promise<void> {
      for (let tries = 0; tries < 100; tries += 1) {
        const seen = await sql<Backend>`
          select wait_event_type from pg_stat_activity
          where datname = current_database() and pid <> pg_backend_pid()
        `.execute(database.app);
        if (seen.rows.some((backend) => backend.wait_event_type === 'Lock')) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('No call waited for the lock.');
    }

    /** As AcademicYears.edit does: the branch row, then the year row, for update; the new dates; the commit when released. */
    function holdYearEdit(branch: string, year: string, start: string, end: string) {
      const held = gate();
      const release = gate();
      const editing = app.get(Transactions).run([branch], async (transaction) => {
        await transaction
          .selectFrom('branches')
          .select('id')
          .where('id', '=', branch)
          .forUpdate()
          .execute();
        await transaction
          .selectFrom('academic_years')
          .select('id')
          .where('id', '=', year)
          .forUpdate()
          .execute();
        await transaction
          .updateTable('academic_years')
          .set({ start_date: start, end_date: end })
          .where('id', '=', year)
          .execute();
        held.open();
        await release.opened;
      });
      return { held: held.opened, release: release.open, editing };
    }

    it('a quarter save waits for the year edit and is refused when the new dates leave the quarter outside', async () => {
      const branch = await newBranch();
      const id = await createYear(branch, '2026-09-02', '2027-05-25');
      const edit = holdYearEdit(branch, id, '2026-09-02', '2027-05-20');
      await edit.held;

      try {
        const saving = put(
          `/api/setup/academic-years/${id}/quarters`,
          branch,
          quartersBody([
            [null, null],
            [null, null],
            [null, null],
            ['2027-03-30', '2027-05-25'],
          ]),
        ).then((sent) => sent);
        await waitForWaiter();
        const whileWaiting = await database.migrator
          .selectFrom('quarters')
          .select('end_date')
          .where('academic_year_id', '=', id)
          .where('number', '=', 4)
          .executeTakeFirstOrThrow();
        expect(whileWaiting.end_date).toBeNull();

        edit.release();
        await edit.editing;
        const response = await saving;
        expect(response.status).toBe(409);
        expect(errorCode(response)).toBe('outside_year');
        expect(detailPaths(response)).toEqual(['quarters.3.endDate']);
      } finally {
        edit.release();
        await edit.editing.catch(() => undefined);
      }
    });

    it('a go-live save waits for the year edit and is refused when the new dates leave the date outside', async () => {
      const branch = await newBranch();
      const id = await createYear(branch, '2026-09-02', '2027-05-25');
      const edit = holdYearEdit(branch, id, '2026-09-14', '2027-05-25');
      await edit.held;

      try {
        const saving = put('/api/setup/branch/go-live', branch, {
          goLiveDate: '2026-09-10',
        }).then((sent) => sent);
        await waitForWaiter();
        const whileWaiting = await database.migrator
          .selectFrom('branches')
          .select('go_live_date')
          .where('id', '=', branch)
          .executeTakeFirstOrThrow();
        expect(whileWaiting.go_live_date).toBeNull();

        edit.release();
        await edit.editing;
        const response = await saving;
        expect(response.status).toBe(409);
        expect(errorCode(response)).toBe('go_live_outside_year');
      } finally {
        edit.release();
        await edit.editing.catch(() => undefined);
      }
    });
  });

  // The review's correction 3: a refusal of the database, also one raised at
  // the commit, is never a 500. Each mapped name is reached by a real write
  // that the database refuses, through refusingConstraints around the
  // transaction as the service has it; an unmapped refusal is thrown as it came.
  describe('refusals of the database', () => {
    const refusedWith = async (work: () => Promise<unknown>): Promise<string> => {
      try {
        await refusingConstraints(work);
      } catch (error) {
        return error instanceof ApiException ? error.code : `not mapped: ${String(error)}`;
      }
      return 'not refused';
    };

    async function plainYear(branch: string, start: string, end: string, dates = DATED) {
      const id = await createYear(branch, start, end);
      await dateQuarters(branch, id, dates);
      return id;
    }

    it('come back as 409 codes, those raised at the commit included', async () => {
      const transactions = app.get(Transactions);
      const branch = await newBranch();
      const year = await plainYear(branch, '2026-09-02', '2027-05-25');
      const later = await createYear(branch, '2027-09-02', '2028-05-25');
      const setQuarter = (number: number, start: string | null, end: string | null) =>
        transactions.run([branch], (transaction) =>
          transaction
            .updateTable('quarters')
            .set({ start_date: start, end_date: end })
            .where('academic_year_id', '=', year)
            .where('number', '=', number)
            .execute(),
        );
      const setStatus = (id: string, status: string) => () =>
        transactions.run([branch], (transaction) =>
          transaction.updateTable('academic_years').set({ status }).where('id', '=', id).execute(),
        );

      // At the commit (deferred).
      expect(await refusedWith(() => setQuarter(2, '2026-10-20', '2026-12-27'))).toBe(
        'quarters_out_of_order',
      );
      expect(
        await refusedWith(() =>
          transactions.run([branch], async (transaction) => {
            await transaction
              .updateTable('quarters')
              .set({ start_date: '2026-11-10', end_date: '2026-12-01' })
              .where('academic_year_id', '=', year)
              .where('number', '=', 1)
              .execute();
            await transaction
              .updateTable('quarters')
              .set({ start_date: '2026-09-02', end_date: '2026-10-31' })
              .where('academic_year_id', '=', year)
              .where('number', '=', 2)
              .execute();
          }),
        ),
      ).toBe('quarters_out_of_order');
      expect(await refusedWith(() => setQuarter(1, '2026-08-01', '2026-10-31'))).toBe(
        'outside_year',
      );
      expect(
        await refusedWith(() =>
          transactions.run([branch], (transaction) =>
            transaction
              .insertInto('academic_years')
              .values({ branch_id: branch, start_date: '2030-09-02', end_date: '2031-05-25' })
              .execute(),
          ),
        ),
      ).toBe('quarters_out_of_order');
      // At the statement.
      expect(
        await refusedWith(() =>
          transactions.run([branch], (transaction) =>
            transaction
              .insertInto('academic_years')
              .values({ branch_id: branch, start_date: '2026-12-01', end_date: '2027-08-01' })
              .execute(),
          ),
        ),
      ).toBe('dates_overlap');
      expect(await refusedWith(setStatus(later, 'current'))).toBe('earlier_year_not_closed');
      expect(await refusedWith(setStatus(year, 'closed'))).toBe('year_out_of_order');
      expect((await post(`/api/setup/academic-years/${year}/start`, branch)).status).toBe(200);
      expect(
        await refusedWith(() =>
          transactions.run([branch], (transaction) =>
            transaction
              .insertInto('academic_years')
              .values({ branch_id: branch, start_date: '2025-09-02', end_date: '2026-05-25' })
              .execute(),
          ),
        ),
      ).toBe('year_out_of_order');
      const closedBranch = await newBranch();
      const closed = await createYear(closedBranch, '2025-09-02', '2026-05-25');
      await closeYear(closed);
      expect(
        await refusedWith(() =>
          transactions.run([closedBranch], (transaction) =>
            transaction
              .updateTable('academic_years')
              .set({ end_date: '2026-05-26' })
              .where('id', '=', closed)
              .execute(),
          ),
        ),
      ).toBe('year_closed');
      // The one-current index, reached past the trigger of the order.
      const indexBranch = await newBranch();
      await plainYear(indexBranch, '2026-09-02', '2027-05-25').then((id) =>
        post(`/api/setup/academic-years/${id}/start`, indexBranch),
      );
      expect(
        await refusedWith(() =>
          database.migrator.transaction().execute(async (transaction) => {
            await sql`alter table academic_years disable trigger academic_years_guard`.execute(
              transaction,
            );
            await transaction
              .insertInto('academic_years')
              .values({
                branch_id: indexBranch,
                start_date: '2027-09-02',
                end_date: '2028-05-25',
                status: 'current',
              })
              .execute();
          }),
        ),
      ).toBe('current_year_exists');
    });

    it('name every constraint they map, and throw any other refusal as it came', async () => {
      for (const [constraint, code] of Object.entries(CONSTRAINT_REFUSALS)) {
        expect(
          await refusedWith(() =>
            Promise.reject(Object.assign(new Error(constraint), { code: '23514', constraint })),
          ),
          constraint,
        ).toBe(code);
      }
      expect(
        await refusedWith(() =>
          Promise.reject(
            Object.assign(new Error('other'), {
              code: '23514',
              constraint: 'academic_years_dates_check',
            }),
          ),
        ),
      ).toBe('not mapped: Error: other');
      expect(
        await refusedWith(() =>
          Promise.reject(
            Object.assign(new Error('other'), {
              code: '42501',
              constraint: 'academic_years_closed',
            }),
          ),
        ),
      ).toBe('not mapped: Error: other');
    });
  });
});
