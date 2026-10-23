import { randomUUID } from 'node:crypto';
import { BRANCH_HEADER, REQUEST_KEY_HEADER } from '@sodiq/shared';
import request from 'supertest';
import { expect } from 'vitest';
import { MONDAY, type DayTemplatesKit } from './day-templates-kit.js';
import type { LoadKit } from './load-kit.js';

/**
 * A branch with a published timetable for the route tests of dated lessons
 * (task 5.8b): a year of four dated quarters, a day of three lessons from
 * 08:00, two classes of grade 7 with their maths on Monday in the first slot,
 * each with a teacher of its own, and a spare teacher of the subject. Names
 * are invented.
 */

/** The quarters of the year 2026-09-01 to 2027-05-31, dated. */
export const QUARTERS = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
] as const;

export const publishOf =
  (t: DayTemplatesKit) => (branch: string, version: string, startsOn: string) =>
    request(t.kit.server)
      .post(`/api/timetable/versions/${version}/publish`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ startsOn });

/** Hours of a person in the branch from 1 September, Monday to Friday, all day. */
export async function hoursOf(t: DayTemplatesKit, branch: string, staffId: string) {
  const entry = await t.database.migrator
    .insertInto('staff_availability')
    .values({ branch_id: branch, staff_id: staffId, valid_from: '2026-09-01' })
    .returning(['id', 'valid_until'])
    .executeTakeFirstOrThrow();
  for (const weekday of [1, 2, 3, 4, 5]) {
    await t.database.migrator
      .insertInto('staff_availability_ranges')
      .values({
        entry_id: entry.id,
        branch_id: branch,
        staff_id: staffId,
        weekday,
        start_minutes: 0,
        end_minutes: 1440,
        valid_from: '2026-09-01',
        valid_until: entry.valid_until,
      })
      .execute();
  }
}

const placeAt = async (
  t: DayTemplatesKit,
  branch: string,
  version: string,
  loadRowId: string,
  weekday: number,
  slotPosition = 1,
) => {
  const placed = await t.post(`/api/timetable/versions/${version}/pattern`, branch, {
    loadRowId,
    weekday,
    slotPosition,
  });
  expect(placed.status, JSON.stringify(placed.body)).toBe(201);
};

async function teacherOf(
  t: DayTemplatesKit,
  load: LoadKit,
  branch: string,
  subject: string,
  accountId?: string,
  second?: string,
) {
  const teacher = await load.teacher(branch, {
    subjects: [
      { subject, grades: [7] },
      ...(second === undefined ? [] : [{ subject: second, grades: [7] }]),
    ],
    ...(accountId === undefined ? {} : { accountId }),
  });
  await hoursOf(t, branch, teacher.staffId);
  return teacher;
}

/**
 * A branch (its own unless given) with a year of four dated quarters, a day
 * of three lessons from 08:00 on every weekday, two classes of grade 7 each
 * with a home room, and a version published from Monday 12 October: maths
 * of each class on Monday in the first slot with a teacher of its own;
 * with `double`, the first class's maths a double lesson in the first and
 * second slots. `accounts` links the teacher or the spare teacher to a
 * signed-in account (task 5.9a: a teacher reading their own timetable).
 * `startTime` starts the day elsewhere than 08:00 (task 5.9b: two branches
 * whose lesson numbers and clock times do not agree). `secondSubject` gives
 * the teacher a second subject, taught to the other class on Monday in the
 * second slot (task 5.9c-1: a Head Teacher of one of the two).
 */
export async function publishedScene(
  t: DayTemplatesKit,
  load: LoadKit,
  input: {
    branch?: string;
    double?: boolean;
    accounts?: { readonly teacher?: string; readonly spare?: string };
    startTime?: string;
    secondSubject?: boolean;
    /**
     * Task 6.2: a graded subject with the weights of the branch, daily 20 · 40 · 40
     * and the same for each quarter, in place of the attendance-only one.
     */
    graded?: boolean;
    /**
     * Task 7.1c: the teacher teaches the other class too (Monday, the second
     * lesson), so the two journals can share a plan.
     */
    shared?: boolean;
    /** Task 7.1c: the subject, made before the scene (a plan of last year names it). */
    subject?: string;
  } = {},
) {
  const branch = input.branch ?? (await t.newBranch());
  const year = await load.classes.year(branch);
  for (const [index, [start, end]] of QUARTERS.entries()) {
    await t.database.migrator
      .updateTable('quarters')
      .set({ start_date: start, end_date: end })
      .where('academic_year_id', '=', year)
      .where('number', '=', index + 1)
      .execute();
  }
  const lesson = await t.createSlotType(branch, 'Lesson', 'lesson', 45);
  const pause = await t.createSlotType(branch, 'Break', 'break', 10);
  const regular = await t.createTemplate(
    branch,
    'Regular',
    [lesson, pause, lesson, pause, lesson],
    input.startTime,
  );
  await t.assign(branch, regular);
  const subject =
    input.subject ??
    (await load.classes.subject({
      grades: [7],
      journalType: input.graded === true ? 'graded' : 'attendance_only',
    }));
  if (input.graded === true) {
    const weights = { attendance: 20, classwork: 40, homework: 40 };
    await t.database.migrator
      .insertInto('subject_daily_weights')
      .values({ branch_id: branch, subject_id: subject, ...weights })
      .execute();
    const quarters = await t.database.migrator
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', year)
      .execute();
    await t.database.migrator
      .insertInto('subject_quarter_weights')
      .values(
        quarters.map((quarter) => ({
          branch_id: branch,
          subject_id: subject,
          quarter_id: quarter.id,
          ...weights,
        })),
      )
      .execute();
  }
  const room = await load.classes.room(branch);
  const otherRoom = await load.classes.room(branch);
  const classId = await load.classes.schoolClass(branch, year, { grade: 7, room });
  const otherClass = await load.classes.schoolClass(branch, year, { grade: 7, room: otherRoom });
  const secondSubject =
    input.secondSubject === true
      ? await load.classes.subject({ grades: [7], journalType: 'attendance_only' })
      : null;
  const teacher = await teacherOf(
    t,
    load,
    branch,
    subject,
    input.accounts?.teacher,
    secondSubject ?? undefined,
  );
  const otherTeacher = await teacherOf(t, load, branch, subject);
  const spareTeacher = await teacherOf(t, load, branch, subject, input.accounts?.spare);
  const created = await t.post('/api/timetable/versions', branch, {
    academicYearId: year,
    startsOn: MONDAY,
    copyFrom: null,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const version = (created.body as { id: string }).id;
  const rowId = await load.row({
    branch_id: branch,
    version_id: version,
    class_id: classId,
    subject_id: subject,
    teacher_id: teacher.staffId,
    lessons_per_week: input.double === true ? 2 : 1,
    double_lessons: input.double === true,
  });
  await placeAt(t, branch, version, rowId, 1);
  if (input.double === true) await placeAt(t, branch, version, rowId, 1, 3);
  const otherRow = await load.row({
    branch_id: branch,
    version_id: version,
    class_id: otherClass,
    subject_id: subject,
    teacher_id: input.shared === true ? teacher.staffId : otherTeacher.staffId,
    lessons_per_week: 1,
  });
  if (input.shared === true) await placeAt(t, branch, version, otherRow, 1, 3);
  else await placeAt(t, branch, version, otherRow, 1);
  if (secondSubject !== null) {
    const secondRow = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: otherClass,
      subject_id: secondSubject,
      teacher_id: teacher.staffId,
      lessons_per_week: 1,
    });
    await placeAt(t, branch, version, secondRow, 1, 3);
  }
  const confirmed = await t.post(`/api/timetable/versions/${version}/templates/confirm`, branch);
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  await load.freeEditLock(version);
  const published = await publishOf(t)(branch, version, MONDAY);
  expect(published.status, JSON.stringify(published.body)).toBe(200);
  return {
    branch,
    year,
    subject,
    room,
    otherRoom,
    classId,
    otherClass,
    teacher,
    otherTeacher,
    spareTeacher,
    version,
    rowId,
    otherRow,
    secondSubject,
  };
}

export type PublishedScene = Awaited<ReturnType<typeof publishedScene>>;
