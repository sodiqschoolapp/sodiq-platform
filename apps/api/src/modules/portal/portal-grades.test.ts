import { finalQuarterRecord } from '@sodiq/calc';
import {
  apiErrorSchema,
  portalAttendanceWeekSchema,
  portalGradesSchema,
  studentAttendanceSchema,
  studentResultsSchema,
  type PortalAttendanceWeek,
  type PortalGrades,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { closeQuarter, reopenQuarter } from '../../testing/closing-kit.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { ParentsKit } from '../../testing/parents-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): string =>
  apiErrorSchema.safeParse(response.body).data?.error.code ?? `status ${String(response.status)}`;

// All names are invented. Task 11.3, pull request #296: the Grades and Attendance pages of the
// parent portal (`10`, What parents see; `07`, Comments and Effect on totals; decisions 1 to 12).
describe('the portal grades and attendance', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let parents: ParentsKit;
  let s: PublishedScene;
  let journal: string;
  let q1: string;
  let lessons: { l12: string; l19: string; l26: string; a12: string; a19: string; a26: string };
  let child: string;
  let otherChild: string;
  let relative: string;
  let parent: { cookie: string; accountId: string };
  let staff: { cookie: string; account: { id: string } };
  let works: { cw12: string; cw19: string; cw26: string };

  const ok = (response: Response): unknown => {
    expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(200);
    return response.body;
  };

  /** A GET as a parent at the moment, its session kept fresh (the idle limit). */
  async function get(
    caller: { cookie: string; accountId: string },
    path: string,
    moment = MOMENT,
  ): Promise<Response> {
    t.clock.set(moment);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
        .where('account_id', '=', caller.accountId)
        .execute();
      return await request(t.kit.server).get(path).set('Cookie', caller.cookie);
    } finally {
      t.clock.set(START);
    }
  }

  /** A GET of a staff route as the Principal of the branch (a reader of the whole journal). */
  async function staffGet(path: string): Promise<Response> {
    t.clock.set(MOMENT);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
        .where('account_id', '=', staff.account.id)
        .execute();
      return await t.get(path, s.branch, staff.cookie);
    } finally {
      t.clock.set(START);
    }
  }

  const gradesOf = async (studentId: string, quarter?: string): Promise<PortalGrades> =>
    portalGradesSchema.parse(
      ok(
        await get(
          parent,
          `/api/portal/children/${studentId}/grades${quarter === undefined ? '' : `?quarter=${quarter}`}`,
        ),
      ),
    );

  const attendanceOf = async (date = '2026-10-26'): Promise<PortalAttendanceWeek> =>
    portalAttendanceWeekSchema.parse(
      ok(await get(parent, `/api/portal/children/${child}/attendance?date=${date}`)),
    );

  const saveOn = async (
    date: string,
    cells: { lessonId: string; studentId: string; workId?: string; value: number }[],
  ) => {
    t.clock.set(`${date}T18:00:00+05:00`);
    try {
      const writer = await load.classes.account();
      await t.app.get(Transactions).run([s.branch], (transaction) =>
        saveCells(
          transaction,
          t.app.get(Audit),
          { accountId: writer },
          cells.map((cell) => ({
            lessonId: cell.lessonId,
            studentId: cell.studentId,
            workId: cell.workId ?? null,
            value: cell.value,
            version: null,
          })),
        ),
      );
    } finally {
      t.clock.set(START);
    }
  };

  /** A comment as the journal stores it (8.2), written with its audit entry. */
  const comment = async (input: {
    studentId: string;
    target: 'mark' | 'work' | 'note' | 'rating';
    lessonId?: string;
    workId?: string;
    ratingExamId?: string;
    body: string;
    visibility: 'staff' | 'parents';
  }): Promise<string> => {
    const writer = await load.classes.account();
    t.clock.set('2026-10-26T18:00:00+05:00');
    try {
      return await t.app.get(Transactions).run([s.branch], async (transaction) => {
        await t.app.get(Audit).record(transaction, {
          branchId: s.branch,
          actorId: writer,
          action: 'journal.comment',
        });
        const row = await transaction
          .insertInto('journal_comments')
          .values({
            branch_id: s.branch,
            student_id: input.studentId,
            target: input.target,
            lesson_id: input.lessonId ?? null,
            work_id: input.workId ?? null,
            rating_exam_id: input.ratingExamId ?? null,
            body: input.body,
            visibility: input.visibility,
            version: 1,
            changed_by: writer,
            changed_how: 'entry',
            changed_at: new Date('2026-10-26T18:00:00+05:00'),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return row.id;
      });
    } finally {
      t.clock.set(START);
    }
  };

  const work = async (lessonId: string, kind: 'classwork' | 'homework', total: number) =>
    (
      await t.database.migrator
        .insertInto('journal_works')
        .values({ branch_id: s.branch, lesson_id: lessonId, kind, total })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  const exempt = async (studentId: string, from: string, until: string) => {
    const writer = await load.classes.account();
    await t.app.get(Transactions).run([s.branch], async (transaction) => {
      await t.app.get(Audit).record(transaction, {
        branchId: s.branch,
        actorId: writer,
        action: 'exemption.create',
      });
      await transaction
        .insertInto('exemptions')
        .values({
          branch_id: s.branch,
          student_id: studentId,
          year_id: s.year,
          batch_id: '019a0000-0000-7000-8000-0000000000b1',
          kind: 'temporary',
          all_subjects: true,
          start_date: from,
          end_date: until,
          start_time: null,
          end_time: null,
          category: 'illness',
          detail: 'A certificate from the clinic, staff only',
          granted_by: writer,
          granted_at: new Date(0),
          version: 0,
          changed_at: new Date(0),
        })
        .execute();
    });
  };

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    parents = new ParentsKit(t.app, t.database.migrator, await load.classes.account());
    // The other class has maths (graded, Monday slot 1) and an attendance-only subject (Monday
    // slot 3): review correction 1.
    s = await publishedScene(t, load, { graded: true, secondSubject: true });
    const ofClass = async (subjectId: string) =>
      (
        await t.database.migrator
          .selectFrom('lessons')
          .select(['id', sql<string>`lesson_date::text`.as('date')])
          .where('class_id', '=', s.otherClass)
          .where('subject_id', '=', subjectId)
          .where('lesson_date', '<=', '2026-10-31')
          .orderBy('starts_at')
          .execute()
      ).map((one) => one.id);
    const [l12, l19, l26] = await ofClass(s.subject);
    const [a12, a19, a26] = await ofClass(s.secondSubject ?? '');
    if (
      l12 === undefined ||
      l19 === undefined ||
      l26 === undefined ||
      a12 === undefined ||
      a19 === undefined ||
      a26 === undefined
    ) {
      throw new Error('Three Mondays of each subject.');
    }
    lessons = { l12, l19, l26, a12, a19, a26 };
    journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.otherClass)
        .where('subject_id', '=', s.subject)
        .executeTakeFirstOrThrow()
    ).id;
    q1 = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', s.year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;
    const first = await parents.student(s.branch);
    child = first.studentId;
    relative = first.relativeId;
    await parents.members.member({
      branch: s.branch,
      classId: s.otherClass,
      studentId: child,
      from: '2026-09-01',
    });
    otherChild = (await parents.student(s.branch)).studentId;
    await parents.members.member({
      branch: s.branch,
      classId: s.otherClass,
      studentId: otherChild,
      from: '2026-09-01',
    });
    const session = await parents.session(first.relativeId);
    parent = { cookie: session.cookie, accountId: session.account.id };
    staff = await t.kit.completeSession('Malika', 'Rahimova');
    await t.kit.giveRole(staff.account.id, {
      role: 'principal',
      branchId: s.branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });

    // The 12th: present, a classwork 12 of 30 (40 %); the 19th: late, a classwork 4 of 5
    // (80 %); the 26th: absent, then exempt by a certificate (`07`, problem cases), with a
    // classwork of 100 the child has no number for. The attendance-only subject: skipped on
    // the 12th, not marked on the 19th, exempt on the 26th.
    works = {
      cw12: await work(l12, 'classwork', 30),
      cw19: await work(l19, 'classwork', 5),
      cw26: await work(l26, 'classwork', 100),
    };
    await saveOn('2026-10-12', [
      { lessonId: l12, studentId: child, value: 1 },
      { lessonId: l12, studentId: child, workId: works.cw12, value: 12 },
      { lessonId: l12, studentId: otherChild, value: 1 },
      { lessonId: l12, studentId: otherChild, workId: works.cw12, value: 30 },
      { lessonId: a12, studentId: child, value: 3 },
    ]);
    await saveOn('2026-10-19', [
      { lessonId: l19, studentId: child, value: 2 },
      { lessonId: l19, studentId: child, workId: works.cw19, value: 4 },
    ]);
    await saveOn('2026-10-26', [
      { lessonId: l26, studentId: child, value: 0 },
      { lessonId: l26, studentId: otherChild, value: 1 },
      { lessonId: l26, studentId: otherChild, workId: works.cw26, value: 70 },
    ]);

    // Comments: one visible to parents and one staff only on each target of the child, and a
    // parents comment of another student on the same lesson and work (`10`: never another
    // student's data).
    await comment({
      studentId: child,
      target: 'work',
      lessonId: l12,
      workId: works.cw12,
      body: 'Good start, parents',
      visibility: 'parents',
    });
    await comment({
      studentId: child,
      target: 'mark',
      lessonId: l12,
      body: 'STAFF-mark-12',
      visibility: 'staff',
    });
    await comment({
      studentId: child,
      target: 'mark',
      lessonId: l19,
      body: 'Came after the bell, parents',
      visibility: 'parents',
    });
    await comment({
      studentId: child,
      target: 'work',
      lessonId: l19,
      workId: works.cw19,
      body: 'STAFF-work-19',
      visibility: 'staff',
    });
    await comment({
      studentId: child,
      target: 'note',
      lessonId: l19,
      body: 'Bring the atlas, parents',
      visibility: 'parents',
    });
    await comment({
      studentId: child,
      target: 'note',
      lessonId: l12,
      body: 'STAFF-note-12',
      visibility: 'staff',
    });
    // On a work of the exempt lesson: not shown (decision 8).
    await comment({
      studentId: child,
      target: 'work',
      lessonId: l26,
      workId: works.cw26,
      body: 'EXEMPT-work-26',
      visibility: 'parents',
    });
    await comment({
      studentId: otherChild,
      target: 'work',
      lessonId: l12,
      workId: works.cw12,
      body: 'OTHER-child-12',
      visibility: 'parents',
    });
    await comment({
      studentId: otherChild,
      target: 'mark',
      lessonId: l26,
      body: 'OTHER-mark-26',
      visibility: 'parents',
    });
    // The rating exam row of the quarter: a parents comment and a staff one.
    const writer = await load.classes.account();
    await t.database.migrator
      .updateTable('subjects')
      .set({ rating_exam: true })
      .where('id', '=', s.subject)
      .execute();
    await t.database.migrator
      .updateTable('subject_quarter_weights')
      .set({ attendance: 20, classwork: 20, homework: 20, rating_exam: 40 })
      .where('subject_id', '=', s.subject)
      .where('branch_id', '=', s.branch)
      .execute();
    t.clock.set('2026-10-26T18:00:00+05:00');
    const exam = await t.app.get(Transactions).run([s.branch], async (transaction) => {
      await t.app.get(Audit).record(transaction, {
        branchId: s.branch,
        actorId: writer,
        action: 'journal.rating_date',
      });
      return (
        await transaction
          .insertInto('journal_rating_exams')
          .values({
            branch_id: s.branch,
            journal_id: journal,
            quarter_id: q1,
            exam_date: '2026-10-26',
            version: 1,
            changed_by: writer,
            changed_at: new Date('2026-10-26T18:00:00+05:00'),
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    });
    await t.app.get(Transactions).run([s.branch], async (transaction) => {
      await t.app.get(Audit).record(transaction, {
        branchId: s.branch,
        actorId: writer,
        action: 'journal.rating_entry',
      });
      await transaction
        .insertInto('journal_rating_entries')
        .values({
          branch_id: s.branch,
          rating_exam_id: exam,
          student_id: child,
          kind: 'score',
          score: 77,
          version: 1,
          changed_by: writer,
          changed_how: 'entry',
          changed_at: new Date('2026-10-26T18:00:00+05:00'),
        })
        .execute();
    });
    t.clock.set(START);
    await comment({
      studentId: child,
      target: 'rating',
      ratingExamId: exam,
      body: 'Exam on Friday, parents',
      visibility: 'parents',
    });
    await comment({
      studentId: otherChild,
      target: 'rating',
      ratingExamId: exam,
      body: 'OTHER-rating',
      visibility: 'parents',
    });
    // The certificate arrives after the marks and comments (`07`, problem cases).
    await exempt(child, '2026-10-26', '2026-10-26');
    // The early-warning list and a Tutor's absence reason are staff records (`08`; `edge/journal`).
    await t.app.get(Transactions).run([s.branch], async (transaction) => {
      await t.app.get(Audit).record(transaction, {
        branchId: s.branch,
        actorId: writer,
        action: 'absence_reason.set',
      });
      await transaction
        .insertInto('student_absence_reasons')
        .values({
          branch_id: s.branch,
          student_id: child,
          absence_date: '2026-10-26',
          category: 'family',
          note: 'STAFF-reason',
          changed_by: writer,
          changed_at: new Date('2026-10-26T18:00:00+05:00'),
        })
        .execute();
    });
    const assignment = await t.database.migrator
      .selectFrom('assignments')
      .select('id')
      .where('account_id', '=', staff.account.id)
      .executeTakeFirstOrThrow();
    await t.database.migrator
      .insertInto('early_warning_handled')
      .values({
        branch_id: s.branch,
        assignment_id: assignment.id,
        quarter_id: q1,
        student_id: child,
        subject_id: s.subject,
        reason: 'low_result',
        figure: 40,
        note: 'STAFF-early-warning',
        handled_by: staff.account.id,
        handled_at: new Date('2026-10-26T18:00:00+05:00'),
      })
      .execute();
  }, 600_000);

  afterAll(async () => {
    await t.close();
  });

  const STAFF_TEXTS = [
    'STAFF-mark-12',
    'STAFF-work-19',
    'STAFF-note-12',
    'EXEMPT-work-26',
    'OTHER-child-12',
    'OTHER-mark-26',
    'OTHER-rating',
    'STAFF-reason',
    'STAFF-early-warning',
    'low_result',
    'A certificate from the clinic',
    'illness',
  ];

  it('answers the quarter’s figures exactly as the staff results page does, the attendance-only subject included', async () => {
    const portal = await gradesOf(child);
    expect(portal.quarterId).toBe(q1);
    const results = studentResultsSchema.parse(
      ok(await staffGet(`/api/results/students/${child}`)),
    );
    const attendance = studentAttendanceSchema.parse(
      ok(await staffGet(`/api/results/students/${child}/attendance`)),
    );
    const staffRow = results.subjects.find((one) => one.subject.id === s.subject)?.quarters[0];
    const maths = portal.subjects.find((one) => one.subject.id === s.subject);
    expect(staffRow).toBeDefined();
    // Field by field, flags included (review correction 2).
    expect(maths?.figures).toEqual({
      attendance: staffRow?.attendance,
      classwork: staffRow?.classwork,
      homework: staffRow?.homework,
      ratingExam: staffRow?.ratingExam,
      ratingShown: staffRow?.ratingShown,
      outcome: staffRow?.outcome,
      basedOn: staffRow?.basedOn,
      countsFrom: staffRow?.countsFrom,
      leftSubjectOn: staffRow?.leftSubjectOn,
      atLeaving: staffRow?.atLeaving,
    });
    // The 26th is exempt and left out: attendance (100 + 50) ÷ 2 = 75; classwork (40 + 80) ÷ 2 = 60.
    expect(maths?.figures).toMatchObject({ attendance: 75, classwork: 60, ratingExam: 77 });
    expect(maths?.rating).toEqual({ kind: 'score', score: 77 });
    expect(maths?.year).toBe(results.subjects[0]?.year ?? null);
    // The attendance-only subject: its average as the staff Attendance tab gives it, no result.
    const staffOnly = attendance.subjects.find((one) => one.subject.id === s.secondSubject)
      ?.quarters[0];
    expect(staffOnly?.attendanceOnly).toBe(true);
    expect(portal.subjects.find((one) => one.subject.id === s.secondSubject)).toMatchObject({
      attendanceOnly: true,
      figures: null,
      attendance: staffOnly?.average,
      year: null,
      scores: [],
    });
    expect(portal.quarters.find((one) => one.id === q1)?.closed).toBe(false);
  });

  it('lists each score with the work, the lesson date and the comment visible to parents, and none of an exempt lesson', async () => {
    const maths = (await gradesOf(child)).subjects.find((one) => one.subject.id === s.subject);
    expect(maths?.scores).toEqual([
      {
        date: '2026-10-12',
        kind: 'classwork',
        title: null,
        position: 1,
        score: 12,
        total: 30,
        percent: 40,
        comment: 'Good start, parents',
      },
      {
        date: '2026-10-19',
        kind: 'classwork',
        title: null,
        position: 1,
        score: 4,
        total: 5,
        percent: 80,
        // The staff-only comment on this score is not sent.
        comment: null,
      },
    ]);
    expect(maths?.ratingComments).toEqual(['Exam on Friday, parents']);
  });

  it('never sends a staff-only comment, another student’s, an exemption’s reason or a Tutor’s reason', async () => {
    const bodies = [
      JSON.stringify((await get(parent, `/api/portal/children/${child}/grades`)).body),
      JSON.stringify(
        (await get(parent, `/api/portal/children/${child}/attendance?date=2026-10-26`)).body,
      ),
    ];
    for (const body of bodies) {
      for (const text of STAFF_TEXTS) expect(body).not.toContain(text);
      expect(body).not.toContain(otherChild);
    }
    // A comment switched to staff only is gone from the next request; a cleared one too.
    const writer = await load.classes.account();
    const flip = (visibility: 'staff' | 'parents', body: string | null) =>
      t.app.get(Transactions).run([s.branch], async (transaction) => {
        await t.app.get(Audit).record(transaction, {
          branchId: s.branch,
          actorId: writer,
          action: 'journal.comment',
        });
        await transaction
          .updateTable('journal_comments')
          .set({ visibility, body, changed_by: writer, changed_how: 'entry' })
          .where('student_id', '=', child)
          .where('target', '=', 'mark')
          .where('lesson_id', '=', lessons.l19)
          .execute();
      });
    await flip('staff', 'Came after the bell, parents');
    try {
      const week = await attendanceOf('2026-10-19');
      expect(
        week.lessons.find((one) => one.date === '2026-10-19' && one.subject.id === s.subject)
          ?.comment,
      ).toBeNull();
      await flip('parents', null);
      const cleared = await attendanceOf('2026-10-19');
      expect(
        cleared.lessons.find((one) => one.date === '2026-10-19' && one.subject.id === s.subject)
          ?.comment,
      ).toBeNull();
    } finally {
      await flip('parents', 'Came after the bell, parents');
    }
  });

  it('answers the marks of the week by day and lesson, an exempt lesson as exempt and never as an absence', async () => {
    const week = await attendanceOf();
    expect(week.monday).toBe('2026-10-26');
    const only = await attendanceOf('2026-10-12');
    expect(only.monday).toBe('2026-10-12');
    expect(
      only.lessons.map((one) => [one.date, one.subject.id, one.mark, one.comment, one.note]),
    ).toEqual([
      ['2026-10-12', s.subject, 'present', null, null],
      ['2026-10-12', s.secondSubject, 'skipped', null, null],
    ]);
    const nineteenth = await attendanceOf('2026-10-19');
    expect(
      nineteenth.lessons.map((one) => [one.subject.id, one.mark, one.comment, one.note]),
    ).toEqual([
      [s.subject, 'late', 'Came after the bell, parents', 'Bring the atlas, parents'],
      [s.secondSubject, 'unmarked', null, null],
    ]);
    // The 26th: maths marked absent, the other subject not marked, before the certificate; both exempt now.
    expect(week.lessons.map((one) => [one.date, one.subject.id, one.mark])).toEqual([
      ['2026-10-26', s.subject, 'exempt'],
      ['2026-10-26', s.secondSubject, 'exempt'],
    ]);
    expect(week.lessons.every((one) => one.start < one.end)).toBe(true);
    // A week with no held lesson of the child.
    expect((await attendanceOf('2026-11-02')).lessons).toEqual([]);
  });

  it('shows a child moved to another class during the quarter in the journal where each mark was entered', async () => {
    const moved = await parents.childOf(s.branch, relative);
    await parents.members.member({
      branch: s.branch,
      classId: s.classId,
      studentId: moved,
      from: '2026-09-01',
      ownUntil: '2026-10-19',
    });
    await parents.members.member({
      branch: s.branch,
      classId: s.otherClass,
      studentId: moved,
      from: '2026-10-19',
    });
    await parents.members.move({
      branch: s.branch,
      studentId: moved,
      from: '2026-10-19',
      fromClassId: s.classId,
      toClassId: s.otherClass,
    });
    const oldLesson = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('lesson_date', '=', '2026-10-12')
        .executeTakeFirstOrThrow()
    ).id;
    await saveOn('2026-10-12', [{ lessonId: oldLesson, studentId: moved, value: 1 }]);
    await saveOn('2026-10-19', [{ lessonId: lessons.l19, studentId: moved, value: 2 }]);
    const weekOf = async (date: string) =>
      portalAttendanceWeekSchema
        .parse(ok(await get(parent, `/api/portal/children/${moved}/attendance?date=${date}`)))
        .lessons.map((one) => [one.date, one.subject.id, one.mark]);
    // The old class has maths only; the new one maths and the attendance-only subject.
    expect(await weekOf('2026-10-12')).toEqual([['2026-10-12', s.subject, 'present']]);
    expect(await weekOf('2026-10-19')).toEqual([
      ['2026-10-19', s.subject, 'late'],
      ['2026-10-19', s.secondSubject, 'unmarked'],
    ]);
    // Grades: one maths result over both journals (`07`, Transfers), equal to the staff page.
    const staffRow = studentResultsSchema
      .parse(ok(await staffGet(`/api/results/students/${moved}`)))
      .subjects.find((one) => one.subject.id === s.subject)?.quarters[0];
    const portal = portalGradesSchema.parse(
      ok(await get(parent, `/api/portal/children/${moved}/grades`)),
    );
    expect(portal.subjects.find((one) => one.subject.id === s.subject)?.figures?.outcome).toEqual(
      staffRow?.outcome,
    );
  });

  it('reads a closed quarter from its stored record and a reopened one live, as the staff page does', async () => {
    const closer = await load.classes.account();
    const closing = await closeQuarter(t.database, {
      branchId: s.branch,
      quarterId: q1,
      accountId: closer,
    });
    // A stored record unlike the entries now: one lesson present, a classwork 10 of 10.
    const record = finalQuarterRecord(
      {
        weights: { attendance: 20, classwork: 40, homework: 40, ratingExam: null },
        attendanceValues: { lateValue: 50, skippedValue: 0 },
        lessons: [{ mark: 1, classworks: [{ score: 10, total: 10 }], homeworks: [] }],
        ratingExam: null,
        quarterClosed: true,
        heldInJournals: 1,
        countsFrom: null,
        leftSubjectOn: null,
        atLeaving: null,
        decision: null,
      },
      'closing',
    );
    await t.database.migrator
      .insertInto('quarter_final_results')
      .values({
        branch_id: s.branch,
        closing_id: closing,
        quarter_id: q1,
        subject_id: s.subject,
        student_id: child,
        journal_id: journal,
        kind: 'closing',
        record: JSON.stringify(record),
      })
      .execute();
    const compare = async () => {
      const portal = await gradesOf(child, q1);
      const staffRow = studentResultsSchema
        .parse(ok(await staffGet(`/api/results/students/${child}`)))
        .subjects.find((one) => one.subject.id === s.subject)?.quarters[0];
      const maths = portal.subjects.find((one) => one.subject.id === s.subject)?.figures;
      expect(maths?.outcome).toEqual(staffRow?.outcome);
      expect(maths?.classwork).toBe(staffRow?.classwork);
      expect(maths?.attendance).toBe(staffRow?.attendance);
      return { portal, maths };
    };
    const closed = await compare();
    expect(closed.portal.quarters.find((one) => one.id === q1)?.closed).toBe(true);
    expect(closed.maths).toMatchObject({
      classwork: 100,
      outcome: { kind: 'number', shown: 100, provisional: false },
    });
    // Reopened: read live again (9.2c), equal to the staff page.
    await reopenQuarter(t.database, {
      branchId: s.branch,
      quarterId: q1,
      journalId: journal,
      accountId: closer,
      at: '2026-11-02T10:00:00+05:00',
    });
    const reopened = await compare();
    expect(reopened.maths?.classwork).toBe(60);
  });

  it('answers 404 for a quarter of another year or branch, and 400 for an unknown field', async () => {
    const other = await publishedScene(t, load, { graded: true });
    const otherQuarter = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', other.year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;
    for (const quarter of [otherQuarter, randomUUID()]) {
      const response = await get(parent, `/api/portal/children/${child}/grades?quarter=${quarter}`);
      expect([response.status, codeOf(response)]).toEqual([404, 'not_found']);
      expect(JSON.stringify(response.body)).not.toContain('figures');
    }
    const extra = await get(parent, `/api/portal/children/${child}/grades?quarterId=${q1}`);
    expect(extra.status).toBe(400);
  });

  it('refuses another family’s child by id on both pages with 404, and a staff session', async () => {
    for (const path of [
      `/api/portal/children/${otherChild}/grades`,
      `/api/portal/children/${otherChild}/attendance?date=2026-10-26`,
    ]) {
      const response = await get(parent, path);
      expect([response.status, codeOf(response)]).toEqual([404, 'not_found']);
      expect(JSON.stringify(response.body)).not.toContain('OTHER');
    }
    const asStaff = await staffGet(`/api/portal/children/${child}/grades`);
    expect(asStaff.status).toBe(403);
  });
});
