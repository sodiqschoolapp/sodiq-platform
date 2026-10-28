import { BRANCH_HEADER, loadReportSchema, type LoadReport } from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { publishedScene, publishOf } from '../../testing/published-scene.js';
import { binary } from '../../testing/xlsx-kit.js';

const MOMENT = '2026-10-14T12:00:00+05:00';

const WEEK = '2026-10-12';

// All names are invented. Task 9.3b-2: the timetable load report (docs/spec/06-timetable.md,
// Views and outputs, "Load report: lessons per week for each teacher against contract, lessons
// per subject for each class against the load, room use in percent, free periods"; Weekly load;
// Rules, "a free period in the middle of a class's day"; docs/spec/edge-cases/timetable.md, Exams:
// "Invigilations are listed in the load report apart from lessons").
describe('the timetable load report (task 9.3b-2)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Jasur', `Rasulov${'a'.repeat(names % 7)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];

  async function as<T>(
    branch: string,
    roles: readonly Omit<Held, 'validFrom'>[],
    work: (call: {
      get: (path: string) => Promise<Response>;
      post: (path: string, body: object) => Promise<Response>;
    }) => Promise<T>,
  ): Promise<T> {
    const browser = await account();
    for (const held of roles) {
      await t.kit.giveRole(browser.account.id, {
        ...held,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
    }
    t.clock.set(MOMENT);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
        .where('account_id', '=', browser.account.id)
        .execute();
      return await work({
        get: (path) =>
          request(t.kit.server).get(path).set('Cookie', browser.cookie).set(BRANCH_HEADER, branch),
        post: (path, body) =>
          request(t.kit.server)
            .post(path)
            .set('Cookie', browser.cookie)
            .set(BRANCH_HEADER, branch)
            .buffer(true)
            .parse(binary)
            .send(body),
      });
    } finally {
      t.clock.set(START);
    }
  }

  const reportOf = (response: Response): LoadReport => {
    expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(200);
    return loadReportSchema.parse(response.body);
  };

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  it('counts each teacher’s lessons of the week against the planned load and the contract, the classes against the load, the rooms and the engine’s free periods', async () => {
    // The first class: maths in the first slot on Monday. The other class: maths in the first
    // slot and the teacher's second subject in the third, so a free period in the second.
    const s = await publishedScene(t, load, { graded: true, secondSubject: true });
    await t.database.migrator
      .updateTable('staff')
      .set({ weekly_lessons: 18 })
      .where('id', '=', s.teacher.staffId)
      .execute();
    const other = await publishedScene(t, load, { graded: true });
    await as(
      s.branch,
      [{ role: 'academic_vice_principal', branchId: s.branch }],
      async ({ get }) => {
        const report = reportOf(await get(`/api/timetable/reports/load?week=2026-10-14`));
        // Any day of the week names its Monday.
        expect(report.week).toBe(WEEK);
        const teacher = report.teachers.find((one) => one.teacher.id === s.teacher.staffId);
        expect(teacher).toMatchObject({
          vacancy: false,
          lessons: 2,
          planned: 2,
          elsewhere: 0,
          contract: 18,
          invigilations: 0,
        });
        expect(
          report.teachers.find((one) => one.teacher.id === s.otherTeacher.staffId),
        ).toMatchObject({ lessons: 1, planned: 1 });
        // Another branch's teacher is not in this branch's report.
        expect(report.teachers.map((one) => one.teacher.id)).not.toContain(other.teacher.staffId);
        expect(
          report.classes
            .map((one) => [one.unit.id, one.subject.id, one.lessons, one.load])
            .sort((a, b) => String(a).localeCompare(String(b))),
        ).toEqual(
          [
            [s.classId, s.subject, 1, 1],
            [s.otherClass, s.subject, 1, 1],
            [s.otherClass, s.secondSubject, 1, 1],
          ].sort((a, b) => String(a).localeCompare(String(b))),
        );
        // Two lesson periods ran that week (08:00 and 09:50 on Monday).
        for (const room of report.rooms) {
          expect(room.periods).toBe(2);
          expect(room.percent).toBe(Math.round((room.lessons * 100) / 2));
        }
        // No class of this version has a gap in its day.
        expect(report.freePeriods).toEqual([]);
      },
    );
  });

  it('lists the free periods the rule engine finds in the version in force that week', async () => {
    const s = await publishedScene(t, load, { graded: true, secondSubject: true });
    // From Monday 19 October: the first class also takes the second subject in the fifth slot,
    // so its third slot (08:55) is empty between two lessons.
    const created = await t.post('/api/timetable/versions', s.branch, {
      academicYearId: s.year,
      startsOn: '2026-10-19',
      copyFrom: s.version,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const version = (created.body as { id: string }).id;
    const row = await load.row({
      branch_id: s.branch,
      version_id: version,
      class_id: s.classId,
      subject_id: s.secondSubject ?? '',
      teacher_id: s.teacher.staffId,
      lessons_per_week: 1,
    });
    const placed = await t.post(`/api/timetable/versions/${version}/pattern`, s.branch, {
      loadRowId: row,
      weekday: 1,
      slotPosition: 5,
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    const confirmed = await t.post(
      `/api/timetable/versions/${version}/templates/confirm`,
      s.branch,
    );
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    await load.freeEditLock(version);
    const published = await publishOf(t)(s.branch, version, '2026-10-19');
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    await as(
      s.branch,
      [{ role: 'academic_vice_principal', branchId: s.branch }],
      async ({ get }) => {
        const before = reportOf(await get(`/api/timetable/reports/load?week=${WEEK}`));
        expect(before.freePeriods).toEqual([]);
        const after = reportOf(await get('/api/timetable/reports/load?week=2026-10-19'));
        expect(after.freePeriods).toEqual([
          {
            class: expect.objectContaining({ id: s.classId }) as object,
            weekday: 1,
            start: 535,
            end: 580,
          },
        ]);
        expect(after.teachers.find((one) => one.teacher.id === s.teacher.staffId)).toMatchObject({
          lessons: 3,
          planned: 3,
        });
      },
    );
  });

  it('lists the invigilations of the week apart, counting for no lesson, answers 404 for an unknown department, and exports the report once logged', async () => {
    const s = await publishedScene(t, load, { graded: true });
    const room = await load.classes.room(s.branch);
    const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:00`);
    await t.app.get(Transactions).run([s.branch], async (transaction) => {
      const exam = await transaction
        .insertInto('exams')
        .values({
          branch_id: s.branch,
          academic_year_id: s.year,
          exam_date: '2026-10-15',
          starts_at: at('2026-10-15', '08:00'),
          ends_at: at('2026-10-15', '09:40'),
          first_slot: 1,
          last_slot: 2,
          title: 'Quarter exam in maths',
          subject_id: s.subject,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const examRoom = await transaction
        .insertInto('exam_rooms')
        .values({ branch_id: s.branch, exam_id: exam.id, room_id: room })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('exam_room_classes')
        .values({
          branch_id: s.branch,
          exam_id: exam.id,
          exam_room_id: examRoom.id,
          class_id: s.classId,
        })
        .execute();
      await transaction
        .insertInto('exam_invigilators')
        .values({
          branch_id: s.branch,
          exam_id: exam.id,
          exam_room_id: examRoom.id,
          staff_id: s.teacher.staffId,
        })
        .execute();
    });
    await as(s.branch, [{ role: 'principal', branchId: s.branch }], async ({ get, post }) => {
      const report = reportOf(await get(`/api/timetable/reports/load?week=${WEEK}`));
      expect(report.teachers.find((one) => one.teacher.id === s.teacher.staffId)).toMatchObject({
        lessons: 1,
        invigilations: 1,
      });
      const unknown = await get(`/api/timetable/reports/load?week=${WEEK}&departmentId=${UNKNOWN}`);
      expect(unknown.status).toBe(404);
      const department = (
        await t.database.migrator
          .selectFrom('subjects')
          .select('department_id')
          .where('id', '=', s.subject)
          .executeTakeFirstOrThrow()
      ).department_id;
      const filtered = reportOf(
        await get(`/api/timetable/reports/load?week=${WEEK}&departmentId=${department}`),
      );
      expect(filtered.classes.every((one) => one.subject.id === s.subject)).toBe(true);
      const count = async () =>
        (
          await t.database.migrator
            .selectFrom('audit_log')
            .select('id')
            .where('branch_id', '=', s.branch)
            .where('action', '=', 'load_report.export')
            .execute()
        ).length;
      expect(await count()).toBe(0);
      const file = await post('/api/timetable/reports/load/export', { week: WEEK });
      expect(file.status).toBe(200);
      expect(await count()).toBe(1);
      const refused = await post('/api/timetable/reports/load/export', {
        week: WEEK,
        departmentId: UNKNOWN,
      });
      expect(refused.status).toBe(404);
      expect(await count()).toBe(1);
    });
  });
});
