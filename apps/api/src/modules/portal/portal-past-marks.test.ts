import {
  portalAttendanceWeekSchema,
  portalGradesSchema,
  portalHomeworkWeekSchema,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { MembersKit, moveStudentBranch } from '../../testing/members-kit.js';
import { ParentsKit } from '../../testing/parents-kit.js';
import { insertSubject } from '../../testing/subjects-kit.js';
import { journalEntriesOf } from './digest/digest-read.js';

/** A Wednesday of quarter 1, after the go-live of 12 October 2026, noon in Tashkent. */
const MOMENT = '2026-10-21T12:00:00+05:00';

// All names are invented. Task 11.26: `10`, Past marks from before go-live, What parents see
// ("On the Grades, Attendance and Homework pages … in the same lists and the same form as the
// platform's own, with no separate label"; "shown by date, subject and the lesson's number that
// day") and Where they never appear (the digest); plan decisions 1 (Look first) and 16.
describe('the past marks in the parent portal', () => {
  let t: DayTemplatesKit;
  let parents: ParentsKit;
  let members: MembersKit;
  let creator: string;
  let history: string;
  let year: string;
  let q1: string;
  let child: string;
  let otherChild: string;
  let parent: { cookie: string; accountId: string };

  async function get(path: string): Promise<Response> {
    t.clock.set(MOMENT);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
        .where('account_id', '=', parent.accountId)
        .execute();
      const response = await request(t.kit.server).get(path).set('Cookie', parent.cookie);
      expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(200);
      return response;
    } finally {
      t.clock.set(START);
    }
  }

  /** A confirmed upload of the branch, written as the confirm writes it. */
  async function upload(branch: string, name: string): Promise<string> {
    return (
      await t.database.migrator
        .insertInto('past_mark_uploads')
        .values({
          branch_id: branch,
          file_name: name,
          file_sha256: name.charCodeAt(0).toString(16).padStart(2, '0').repeat(32),
          rows: JSON.stringify([]),
          row_count: 1,
          uploaded_by: creator,
          uploaded_at: new Date(START),
          confirmed_by: creator,
          confirmed_at: new Date(START),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  async function mark(
    uploadId: string,
    branch: string,
    studentId: string,
    date: string,
    lesson: number,
    value: number,
  ) {
    await t.database.migrator
      .insertInto('past_attendance')
      .values({
        branch_id: branch,
        upload_id: uploadId,
        academic_year_id: year,
        student_id: studentId,
        subject_id: history,
        school_date: date,
        lesson_number: lesson,
        mark: value,
      })
      .execute();
  }

  async function work(
    uploadId: string,
    branch: string,
    studentId: string,
    date: string,
    kind: 'classwork' | 'homework',
    title: string,
    score: number,
    total: number,
    position = 1,
  ) {
    await t.database.migrator
      .insertInto('past_works')
      .values({
        branch_id: branch,
        upload_id: uploadId,
        academic_year_id: year,
        student_id: studentId,
        subject_id: history,
        school_date: date,
        lesson_number: 1,
        kind,
        position,
        title,
        score,
        total,
      })
      .execute();
  }

  beforeAll(async () => {
    t = await dayTemplatesKit();
    creator = (
      await t.database.migrator
        .selectFrom('accounts')
        .select('id')
        .orderBy('id')
        .executeTakeFirstOrThrow()
    ).id;
    parents = new ParentsKit(t.app, t.database.migrator, creator);
    members = new MembersKit(t.database.migrator, creator);
    await t.database.migrator.transaction().execute(async (transaction) => {
      for (const branch of [t.north, t.south]) {
        const created = await transaction
          .insertInto('academic_years')
          .values({ branch_id: branch, start_date: '2026-09-01', end_date: '2027-05-31' })
          .returning('id')
          .executeTakeFirstOrThrow();
        if (branch === t.north) year = created.id;
        for (const [index, dates] of [
          ['2026-09-02', '2026-10-31'],
          ['2026-11-09', '2026-12-28'],
          ['2027-01-11', '2027-03-19'],
          ['2027-03-29', '2027-05-25'],
        ].entries()) {
          const quarter = await transaction
            .insertInto('quarters')
            .values({
              branch_id: branch,
              academic_year_id: created.id,
              number: index + 1,
              start_date: dates[0] ?? '',
              end_date: dates[1] ?? '',
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          if (branch === t.north && index === 0) q1 = quarter.id;
        }
        await transaction
          .updateTable('academic_years')
          .set({ status: 'current' })
          .where('id', '=', created.id)
          .execute();
        await transaction
          .updateTable('branches')
          .set({ go_live_date: '2026-10-12' })
          .where('id', '=', branch)
          .execute();
      }
    });
    history = await insertSubject(t.database.migrator, 'History');
    const north7 = (await t.classOf(t.north, 7, '2026-09-02')) ?? '';
    const first = await parents.student(t.north);
    child = first.studentId;
    await members.member({
      branch: t.north,
      classId: north7,
      studentId: child,
      from: '2026-09-01',
    });
    otherChild = (await parents.student(t.north)).studentId;
    await members.member({
      branch: t.north,
      classId: north7,
      studentId: otherChild,
      from: '2026-09-01',
    });
    const session = await parents.session(first.relativeId);
    parent = { cookie: session.cookie, accountId: session.account.id };

    const standing = await upload(t.north, 'September.xlsx');
    // Monday 7 September: lesson 1 present, lesson 2 exempt (5); a classwork 7.5 of 10, a second
    // classwork, and a homework 6.6 of 8.25 (80%).
    await mark(standing, t.north, child, '2026-09-07', 1, 1);
    await mark(standing, t.north, child, '2026-09-07', 2, 5);
    await work(standing, t.north, child, '2026-09-07', 'classwork', 'Dictation', 7.5, 10);
    await work(standing, t.north, child, '2026-09-07', 'classwork', 'Reading', 4, 5, 2);
    await work(standing, t.north, child, '2026-09-07', 'homework', 'Map of the river', 6.6, 8.25);
    // Another child's marks of the same lesson.
    await mark(standing, t.north, otherChild, '2026-09-07', 1, 0);
    await work(standing, t.north, otherChild, '2026-09-07', 'classwork', 'Dictation', 1, 10);
    // A withdrawn upload of Tuesday 8 September: never shown.
    const withdrawn = await upload(t.north, 'Wrong.xlsx');
    await mark(withdrawn, t.north, child, '2026-09-08', 1, 0);
    await work(withdrawn, t.north, child, '2026-09-08', 'homework', 'Wrong homework', 1, 10);
    await t.database.migrator
      .updateTable('past_mark_uploads')
      .set({ withdrawn_by: creator, withdrawn_at: new Date(START), withdraw_reason: 'Wrong class' })
      .where('id', '=', withdrawn)
      .execute();
    for (const table of ['past_attendance', 'past_works'] as const) {
      await t.database.migrator
        .updateTable(table)
        .set({ withdrawn_at: new Date(START) })
        .where('upload_id', '=', withdrawn)
        .execute();
    }
  });

  afterAll(async () => {
    await t.close();
  });

  it('lists the past scores on the Grades page with no label, the percent from packages/calc', async () => {
    const grades = portalGradesSchema.parse(
      (await get(`/api/portal/children/${child}/grades?quarter=${q1}`)).body,
    );
    const subject = grades.subjects.find((one) => one.subject.id === history);
    expect(subject).toMatchObject({ figures: null, attendanceOnly: false, attendance: null });
    expect(
      subject?.scores.map((one) => [
        one.date,
        one.kind,
        one.title,
        one.position,
        one.score,
        one.total,
        one.percent,
        one.past,
        one.savedAt,
        one.comment,
      ]),
    ).toEqual([
      ['2026-09-07', 'classwork', 'Dictation', 1, 7.5, 10, 75, true, null, null],
      ['2026-09-07', 'classwork', 'Reading', 2, 4, 5, 80, true, null, null],
      ['2026-09-07', 'homework', 'Map of the river', 1, 6.6, 8.25, 80, true, null, null],
    ]);
    // Quarter 2 holds none of them.
    const quarters = grades.quarters.map((one) => one.id);
    const q2 = quarters.find((one) => one !== q1) ?? '';
    const second = portalGradesSchema.parse(
      (await get(`/api/portal/children/${child}/grades?quarter=${q2}`)).body,
    );
    expect(second.subjects.some((one) => one.subject.id === history)).toBe(false);
  });

  it('lists the past marks on the Attendance page by lesson number, with no time', async () => {
    const week = portalAttendanceWeekSchema.parse(
      (await get(`/api/portal/children/${child}/attendance?date=2026-09-07`)).body,
    );
    expect(
      week.lessons.map((one) => [
        one.date,
        one.subject.id,
        one.lessonNumber,
        one.start,
        one.end,
        one.mark,
      ]),
    ).toEqual([
      ['2026-09-07', history, 1, null, null, 'present'],
      ['2026-09-07', history, 2, null, null, 'exempt'],
    ]);
    // The withdrawn upload's Tuesday is not there.
    expect(week.lessons.some((one) => one.date === '2026-09-08')).toBe(false);
  });

  it('lists the past homework on the Homework page by its date', async () => {
    const week = portalHomeworkWeekSchema.parse(
      (await get(`/api/portal/children/${child}/homework?date=2026-09-07`)).body,
    );
    expect(week.homework).toEqual([
      {
        givenOn: '2026-09-07',
        subject: expect.objectContaining({ id: history }),
        topic: null,
        title: 'Map of the river',
        number: 1,
        description: null,
        files: [],
      },
    ]);
  });

  it('never puts a past mark in the digest', async () => {
    const entries = await t.app.get(Transactions).run([t.north], (transaction) =>
      journalEntriesOf(transaction, {
        branchId: t.north,
        studentId: child,
        from: new Date('2026-01-01T00:00:00Z'),
        until: new Date('2027-01-01T00:00:00Z'),
        sent: new Map(),
      }),
    );
    expect(entries).toEqual([]);
  });

  it('gives the branches of past marks only for a child of the account (decision 1)', async () => {
    const at = new Date(MOMENT);
    const own = await sql<{ b: string }>`
      select b from portal_past_mark_branches(${parent.accountId}::uuid, ${child}::uuid, ${at}) b
    `.execute(t.database.migrator);
    expect(own.rows.map((one) => one.b)).toEqual([t.north]);
    const other = await sql<{ b: string }>`
      select b from portal_past_mark_branches(${parent.accountId}::uuid, ${otherChild}::uuid, ${at}) b
    `.execute(t.database.migrator);
    expect(other.rows).toEqual([]);
  });

  it('keeps showing the marks of the branch a child moved from (edge/academic-year)', async () => {
    await moveStudentBranch(
      t.database.migrator,
      child,
      t.north,
      t.south,
      '2026-10-14T10:00:00+05:00',
    );
    const week = portalAttendanceWeekSchema.parse(
      (await get(`/api/portal/children/${child}/attendance?date=2026-09-07`)).body,
    );
    expect(week.lessons.map((one) => [one.lessonNumber, one.mark])).toEqual([
      [1, 'present'],
      [2, 'exempt'],
    ]);
  });
});
