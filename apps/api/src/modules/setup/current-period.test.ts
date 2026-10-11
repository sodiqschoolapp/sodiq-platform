import type { INestApplication } from '@nestjs/common';
import { BRANCH_HEADER, currentPeriodSchema, type CurrentPeriod } from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { signInKit, type SignInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

// All names are invented.
const TEACHERS: [string, string][] = [
  ['Kamola', 'Rustamova'],
  ['Sherzod', 'Yuldashev'],
  ['Nodira', 'Hasanova'],
  ['Ulugbek', 'Tojiyev'],
  ['Madina', 'Qosimova'],
  ['Farrux', 'Ismoilov'],
  ['Lola', 'Abdullayeva'],
];

// docs/spec/03-school-setup.md: "The current academic year and quarter are
// always shown in the top bar." docs/spec/12-ux-standards.md, Context.
// docs/spec/edge-cases/time-dates-calendar.md, "A page is opened on a date that
// is in no quarter". docs/spec/edge-cases/00-definitions.md, Branch time: "Every
// date and time rule uses the branch's local time and the server's clock."
// Owner's answer 8; decisions 8 and 9 of pull request #44.
describe('the year and quarter of the top bar', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let branch: string;
  let empty: string;
  let accounts = 0;
  const clock = new FixedClock('2026-08-01T09:00:00+05:00');

  /** A Teacher signed in at the moment of the clock: the clock moves by days, beyond any idle limit. */
  async function teacherNow(inBranch: string): Promise<string> {
    const [firstName, lastName] = TEACHERS[accounts % TEACHERS.length] ?? ['Kamola', 'Rustamova'];
    accounts += 1;
    const browser = await kit.fullSession(firstName, lastName);
    await kit.giveRole(browser.account.id, { role: 'teacher', branchId: inBranch });
    return browser.cookie;
  }

  async function periodAt(moment: string, inBranch = branch): Promise<CurrentPeriod> {
    clock.set(moment);
    const cookie = await teacherNow(inBranch);
    const response = await kit
      .get('/api/setup/current-period', cookie)
      .set(BRANCH_HEADER, inBranch);
    expect(response.status).toBe(200);
    return currentPeriodSchema.parse(response.body);
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    branch = await insertBranch(database.migrator, 'North');
    empty = await insertBranch(database.migrator, 'East');
    app = await createTestApp({ database: database.app, clock });
    kit = signInKit(app);
    await database.migrator.transaction().execute(async (transaction) => {
      const year = await transaction
        .insertInto('academic_years')
        .values({ branch_id: branch, start_date: '2026-09-02', end_date: '2027-05-25' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const dates: [string, string][] = [
        ['2026-09-02', '2026-10-31'],
        ['2026-11-10', '2026-12-27'],
        ['2027-01-12', '2027-03-20'],
        ['2027-03-30', '2027-05-25'],
      ];
      await transaction
        .insertInto('quarters')
        .values(
          dates.map(([start, end], index) => ({
            branch_id: branch,
            academic_year_id: year.id,
            number: index + 1,
            start_date: start,
            end_date: end,
          })),
        )
        .execute();
      await transaction
        .updateTable('academic_years')
        .set({ status: 'current' })
        .where('id', '=', year.id)
        .execute();
    });
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('says there is no year in a branch without one', async () => {
    expect(await periodAt('2026-08-01T09:00:00+05:00', empty)).toEqual({
      today: '2026-08-01',
      year: null,
      state: 'no_year',
      quarter: null,
      next: null,
    });
  });

  it('says when quarter 1 starts, before it starts', async () => {
    expect(await periodAt('2026-08-20T09:00:00+05:00')).toMatchObject({
      today: '2026-08-20',
      year: { name: '2026–2027', status: 'current' },
      state: 'before_first',
      next: { number: 1, startDate: '2026-09-02' },
    });
  });

  // 19:30 UTC on 1 September is already 2 September in Tashkent.
  it('counts the day of the branch, not of the server', async () => {
    expect(await periodAt('2026-09-01T19:30:00Z')).toMatchObject({
      today: '2026-09-02',
      state: 'in_quarter',
      quarter: { number: 1 },
    });
    expect(await periodAt('2026-09-01T18:30:00Z')).toMatchObject({
      today: '2026-09-01',
      state: 'before_first',
    });
  });

  it('says vacation and when the next quarter starts, between quarters', async () => {
    expect(await periodAt('2026-11-05T09:00:00+05:00')).toMatchObject({
      state: 'vacation',
      quarter: { number: 1 },
      next: { number: 2, startDate: '2026-11-10' },
    });
  });

  it('says vacation alone after the last quarter', async () => {
    expect(await periodAt('2027-06-10T09:00:00+05:00')).toMatchObject({
      state: 'vacation',
      quarter: { number: 4 },
      next: null,
    });
  });
});
