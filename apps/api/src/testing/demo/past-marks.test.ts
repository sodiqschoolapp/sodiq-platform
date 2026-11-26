import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  BRANCH_HEADER,
  pastMarkConfirmResultSchema,
  pastMarkPreviewSchema,
  STUDENT_EXPORT_COLUMNS,
} from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../create-test-app.js';
import { FixedClock } from '../fixed-clock.js';
import { filledPastMarkTemplate, type PastMarkTemplateRow } from '../past-marks-kit.js';
import { binary, readSheet } from '../xlsx-kit.js';
import { createTestDatabase, type TestDatabase } from '../test-database.js';
import { SETUP_MOMENT } from './data.js';
import { fillJournals } from './journal.js';
import { SignIns } from './people.js';
import { studentResultLines } from './result-lines.js';
import { buildDemoSchool, type DemoSchool } from './school.js';

const PASSWORD = 'demo-past-marks-password-1';
/** A Friday of quarter 1, three weeks into the year: the journals are filled up to the day before. */
const TODAY = '2026-09-25';
const READ_AT = `${TODAY}T10:00:00+05:00`;
/** The go-live date given to every branch for the test: past marks lie before it. */
const GO_LIVE = '2026-09-21';
/** The school days of the past marks: Monday 7 to Friday 11 September. */
const DAYS = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];

// Task 11.26, Done when: "a test computes every figure of the demo school (averages, results,
// rating, reports, the early-warning list) before and after an import and finds them the same"
// (`10`, Where they never appear). The demo school is built and filled by the application; every
// figure is read through the staff routes as the demo's Super Admin; each branch then imports a
// file of past marks through the import's own routes; every figure is read again. Names are
// invented.
describe('the figures of the demo school across an import of past marks', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clock: FixedClock;
  let school: DemoSchool;

  beforeAll(async () => {
    database = await createTestDatabase();
    clock = new FixedClock(SETUP_MOMENT);
    app = await createTestApp({
      database: database.app,
      jobsDatabaseUrl: database.appUrl,
      clock,
      listen: true,
    });
    const say = () => undefined;
    school = await buildDemoSchool({
      app,
      migrator: database.migrator,
      clock,
      password: PASSWORD,
      say,
    });
    await fillJournals({
      app,
      migrator: database.migrator,
      clock,
      school,
      password: PASSWORD,
      today: TODAY,
      say,
    });
  }, 1_800_000);

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  /** Every figure the staff read, by route, as JSON lines: what an import must leave as it was. */
  async function figures(): Promise<string[]> {
    const migrator = database.migrator;
    const admin = school.superAdmin.caller;
    const lines = [...(await studentResultLines(migrator, school))];
    const branches = await migrator.selectFrom('branches').select('id').orderBy('id').execute();
    for (const branch of branches) {
      const caller = admin.in(branch.id);
      const quarter = await migrator
        .selectFrom('quarters')
        .select('id')
        .where('branch_id', '=', branch.id)
        .where('number', '=', 1)
        .orderBy('start_date')
        .executeTakeFirst();
      if (quarter === undefined) continue;
      const read = async (path: string) => {
        lines.push(`${branch.id} ${path} ${JSON.stringify(await caller.get(path))}`);
      };
      await read(`/api/results/early-warning?quarterId=${quarter.id}`);
      await read(`/api/results/branch-summary?quarterId=${quarter.id}`);
      await read(`/api/results/rating/classes?quarterId=${quarter.id}`);
      await read(`/api/results/reports/attendance?from=2026-09-02&to=${TODAY}`);
      const classes = await migrator
        .selectFrom('classes')
        .select('id')
        .where('branch_id', '=', branch.id)
        .orderBy('id')
        .execute();
      for (const one of classes) {
        await read(`/api/results/reports/results-table?quarterId=${quarter.id}&classId=${one.id}`);
        await read(`/api/results/rating/class?quarterId=${quarter.id}&classId=${one.id}`);
      }
      // Spec review must-fix 3: the journal grids, a journal's Excel export and the student
      // export, the staff screens and files nearest to the marks.
      const journals = await migrator
        .selectFrom('journals')
        .select('id')
        .where('branch_id', '=', branch.id)
        .orderBy('id')
        .execute();
      for (const journal of journals) {
        await read(`/api/journal/journals/${journal.id}?quarterId=${quarter.id}`);
      }
      const fileOf = async (path: string, body: object) => {
        const response = await request(app.getHttpServer())
          .post(path)
          .set('Cookie', school.superAdmin.caller.cookies)
          .set(BRANCH_HEADER, branch.id)
          .send(body)
          .buffer(true)
          .parse(binary);
        expect(response.status, path).toBe(200);
        const sheet = await readSheet(response.body as Buffer);
        lines.push(`${branch.id} ${path} ${JSON.stringify(sheet)}`);
      };
      for (const journal of journals.slice(0, 3)) {
        await fileOf(`/api/journal/journals/${journal.id}/export`, {
          format: 'xlsx',
          quarterId: quarter.id,
        });
      }
      const students = await migrator
        .selectFrom('students')
        .select('id')
        .where('branch_id', '=', branch.id)
        .orderBy('id')
        .execute();
      if (students.length > 0) {
        await fileOf('/api/people/students/export', {
          ids: students.map((one) => one.id),
          columns: [...STUDENT_EXPORT_COLUMNS],
          selection: 'ticked',
          search: '',
          filters: {},
        });
      }
    }
    return lines;
  }

  it('finds every figure the same after each branch imports past marks', async () => {
    clock.set(READ_AT);
    await new SignIns(app, clock, PASSWORD).again(school.superAdmin);
    const before = await figures();
    expect(before.length).toBeGreaterThan(0);

    const migrator = database.migrator;
    const subject = await migrator
      .selectFrom('subjects')
      .select('name_en')
      .where('journal_type', '=', 'graded')
      .where('archived_at', 'is', null)
      .orderBy('name_en')
      .executeTakeFirstOrThrow();
    const branches = await migrator.selectFrom('branches').select('id').orderBy('id').execute();
    let imported = 0;
    for (const branch of branches) {
      await migrator
        .updateTable('branches')
        .set({ go_live_date: GO_LIVE })
        .where('id', '=', branch.id)
        .execute();
      const students = await migrator
        .selectFrom('students')
        .innerJoin('class_memberships', 'class_memberships.student_id', 'students.id')
        .select(['students.uid', 'students.last_name', 'students.first_name'])
        .distinct()
        .where('students.branch_id', '=', branch.id)
        .where('class_memberships.branch_id', '=', branch.id)
        .where('class_memberships.valid_from', '<=', DAYS[0] ?? '')
        .orderBy('students.uid')
        .limit(20)
        .execute();
      if (students.length === 0) continue;
      const rows: PastMarkTemplateRow[] = students.flatMap((student, index) =>
        DAYS.map((date, day) => ({
          uid: student.uid,
          lastName: student.last_name,
          firstName: student.first_name,
          date,
          subject: subject.name_en,
          attendance: String((index + day) % 4),
          classworkTitle: `Past classwork ${String(day + 1)}`,
          classworkTotal: 10,
          classworkScore: (index + day) % 2 === 0 ? 7.5 : 3,
          homeworkTitle: `Past homework ${String(day + 1)}`,
          homeworkTotal: '8.25',
          homeworkScore: '6.6',
        })),
      );
      const uploaded = await request(app.getHttpServer())
        .put('/api/setup/past-marks/imports?name=September.xlsx')
        .set('Cookie', school.superAdmin.caller.cookies)
        .set(BRANCH_HEADER, branch.id)
        .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(await filledPastMarkTemplate(rows));
      expect(uploaded.status, JSON.stringify(uploaded.body).slice(0, 800)).toBe(200);
      const preview = pastMarkPreviewSchema.parse(uploaded.body);
      expect(preview.clean, JSON.stringify(preview.rows.slice(0, 5))).toBe(true);
      const confirmed = pastMarkConfirmResultSchema.parse(
        await school.superAdmin.caller
          .in(branch.id)
          .post(`/api/setup/past-marks/imports/${preview.importId}/confirm`, {}),
      );
      expect(confirmed.outcome).toBe('saved');
      imported += rows.length;
    }
    expect(imported).toBeGreaterThan(0);
    const stored = await migrator
      .selectFrom('past_works')
      .select((eb) => eb.fn.countAll().as('count'))
      .executeTakeFirstOrThrow();
    expect(Number(stored.count)).toBe(imported * 2);

    const after = await figures();
    expect(after).toEqual(before);
  }, 1_800_000);
});
