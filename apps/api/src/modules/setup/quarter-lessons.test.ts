import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  quartersPreviewSchema,
  REQUEST_KEY_HEADER,
  timetableVersionSchema,
  type QuartersPreview,
} from '@sodiq/shared';
import { addDays } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { Audit } from '../audit/audit.service.js';
import {
  dayTemplatesKit,
  MONDAY,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { liveSubstitutionRowOf, substitutedIn } from '../../testing/substitutions-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const okay = (response: Response, status = 200) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response.body as { id: string };
};

type Dates = readonly (readonly [string | null, string | null])[];

/** The quarters of the year 2026-09-01 to 2027-05-31, dated. */
const QUARTERS: Dates = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
];

/** The quarters with some changed, by number. */
const withQuarters = (changes: Record<number, readonly [string | null, string | null]>): Dates =>
  QUARTERS.map((one, index) => changes[index + 1] ?? one);

/** Mondays after the version's start (12 October). */
const OCT19 = '2026-10-19';
const OCT26 = '2026-10-26';
const NOV02 = '2026-11-02';
const NOV09 = '2026-11-09';
const NOV16 = '2026-11-16';
const MAY24 = '2027-05-24';
const MAY31 = '2027-05-31';
const JUN07 = '2027-06-07';
const JUN14 = '2027-06-14';

/** A moment of a school date at a clock time in Tashkent (UTC+5, the kit's branches). */
const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:00`);

// All names are invented. Task 5.6b-5a: a save of a year's quarters over a
// published timetable writes its lessons (edge/time-dates-calendar, "Quarter
// dates are edited after lessons exist": "Every school day lies in exactly
// one quarter. ... A boundary can move only over future dates, so a held
// lesson never changes quarter"; "The academic year is extended or
// shortened": "Extending adds lessons from the version in force. Shortening
// removes future empty lessons and is refused, with the list of what is in
// the way"; edge/00-definitions, Quarter of a lesson). The clock stands at
// 23:55 on Saturday 10 October 2026 in Tashkent.
describe('quarter and year dates after lessons exist', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  const post = (path: string, branch: string, body: object = {}, cookie = t.admin) =>
    t.post(path, branch, body, cookie);

  const keyed = (path: string, branch: string, body: object, cookie = t.admin) =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send(body);

  /** Hours of a person in the branch, all day on weekdays. */
  async function hours(branch: string, staffId: string) {
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

  /**
   * A branch of its own with a year of four dated quarters, a day of lesson,
   * break, lesson, break, lesson (45 and 10 minutes) from 08:00 on every
   * weekday, two classes of grades 7 and 10, and a version published from
   * Monday 12 October: maths of the grade-7 class in lesson 1 (08:00) and
   * history of the grade-10 class in lesson 2 (08:55), both on Mondays.
   */
  async function scene() {
    const branch = await t.newBranch();
    const year = await load.classes.year(branch);
    await setQuartersDirectly(year, QUARTERS);
    const lesson = await t.createSlotType(branch, 'Lesson', 'lesson', 45);
    const pause = await t.createSlotType(branch, 'Break', 'break', 10);
    const regular = await t.createTemplate(branch, 'Regular', [
      lesson,
      pause,
      lesson,
      pause,
      lesson,
    ]);
    await t.assign(branch, regular);
    const maths = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const history = await load.classes.subject({ grades: [7, 10], journalType: 'attendance_only' });
    const classId = await load.classes.schoolClass(branch, year, {
      grade: 7,
      room: await load.classes.room(branch),
    });
    const seniorId = await load.classes.schoolClass(branch, year, {
      grade: 10,
      room: await load.classes.room(branch),
    });
    const teacherId = (await load.teacher(branch, { subjects: [{ subject: maths, grades: [7] }] }))
      .staffId;
    await hours(branch, teacherId);
    const seniorTeacher = (
      await load.teacher(branch, { subjects: [{ subject: history, grades: [10] }] })
    ).staffId;
    await hours(branch, seniorTeacher);
    const created = await post('/api/timetable/versions', branch, {
      academicYearId: year,
      startsOn: MONDAY,
      copyFrom: null,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const version = (created.body as { id: string }).id;
    for (const [classOf, subject, teacher, slotPosition] of [
      [classId, maths, teacherId, 1],
      [seniorId, history, seniorTeacher, 3],
    ] as const) {
      const row = await load.row({
        branch_id: branch,
        version_id: version,
        class_id: classOf,
        subject_id: subject,
        teacher_id: teacher,
        lessons_per_week: 1,
      });
      okay(
        await post(`/api/timetable/versions/${version}/pattern`, branch, {
          loadRowId: row,
          weekday: 1,
          slotPosition,
        }),
        201,
      );
    }
    okay(await post(`/api/timetable/versions/${version}/templates/confirm`, branch));
    await load.freeEditLock(version);
    const published = await keyed(`/api/timetable/versions/${version}/publish`, branch, {
      startsOn: MONDAY,
    });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    timetableVersionSchema.parse(published.body);
    return { branch, year, maths, history, classId, seniorId, teacherId, seniorTeacher, version };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  async function setQuartersDirectly(year: string, dates: Dates) {
    for (const [index, [start, end]] of dates.entries()) {
      await t.database.migrator
        .updateTable('quarters')
        .set({ start_date: start, end_date: end })
        .where('academic_year_id', '=', year)
        .where('number', '=', index + 1)
        .execute();
    }
  }

  const body = (dates: Dates, days?: object) => ({
    quarters: dates.map(([startDate, endDate]) => ({ startDate, endDate })),
    ...(days === undefined ? {} : { days }),
  });

  const saveQuarters = (s: Scene, dates: Dates, days?: object, cookie = t.admin) =>
    t.put(`/api/setup/academic-years/${s.year}/quarters`, s.branch, body(dates, days), cookie);

  const previewQuarters = (s: Scene, dates: Dates, days?: object, cookie = t.admin) =>
    post(
      `/api/setup/academic-years/${s.year}/quarters/preview`,
      s.branch,
      body(dates, days),
      cookie,
    );

  const shownFor = async (s: Scene, dates: Dates, days?: object): Promise<QuartersPreview> => {
    const response = await previewQuarters(s, dates, days);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return quartersPreviewSchema.parse(response.body);
  };

  const editYear = (s: Scene, startDate: string, endDate: string) =>
    t.put(`/api/setup/academic-years/${s.year}`, s.branch, { startDate, endDate });

  /** The dated blocks of a branch: id, date and quarter number, by date and id. */
  const blocksOf = (branch: string) =>
    t.database.migrator
      .selectFrom('lesson_blocks')
      .innerJoin('quarters', 'quarters.id', 'lesson_blocks.quarter_id')
      .select([
        'lesson_blocks.id',
        sql<string>`lesson_blocks.lesson_date::text`.as('date'),
        'quarters.number',
      ])
      .where('lesson_blocks.branch_id', '=', branch)
      .orderBy('lesson_blocks.lesson_date')
      .orderBy('lesson_blocks.id')
      .execute();

  const lessonsOn = (branch: string, date: string) =>
    t.database.migrator
      .selectFrom('lessons')
      .select(['id', 'class_id', 'subject_id', 'teacher_id', 'cancel_cause'])
      .where('branch_id', '=', branch)
      .where('lesson_date', '=', date)
      .orderBy('starts_at')
      .orderBy('id')
      .execute();

  const lessonOf = async (s: Scene, date: string, classId: string) => {
    const found = (await lessonsOn(s.branch, date)).find((one) => one.class_id === classId);
    if (found === undefined) throw new Error(`No lesson of ${classId} on ${date}.`);
    return found;
  };

  const detailsOf = (response: Response) =>
    (
      response.body as {
        error: {
          details: {
            path: string;
            code: string;
            day?: string;
            quarterItem?: unknown;
            more?: number;
          }[];
        };
      }
    ).error.details;

  const lastAudit = async (branch: string) =>
    t.database.migrator
      .selectFrom('audit_log')
      .select(['action', 'new_value'])
      .where('branch_id', '=', branch)
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();

  const accountOf = async (staffId: string) =>
    (
      await t.database.migrator
        .selectFrom('staff')
        .select('account_id')
        .where('id', '=', staffId)
        .executeTakeFirstOrThrow()
    ).account_id;

  const noticesOf = (branch: string) =>
    t.database.migrator
      .selectFrom('notifications')
      .select(['kind', 'account_id', 'data'])
      .where('branch_id', '=', branch)
      .where('kind', '=', 'timetable.quarters_changed')
      .orderBy('id')
      .execute();

  /** An exam of the grade-10 class in lesson 1 of `date`, with `invigilator`. */
  async function insertExam(
    s: Scene,
    date: string,
    invigilator: string,
    cancelCause: 'cancelled' | null = null,
  ) {
    return t.database.migrator.transaction().execute(async (transaction) => {
      await sql`set constraints all deferred`.execute(transaction);
      const written = await transaction
        .insertInto('exams')
        .values({
          branch_id: s.branch,
          academic_year_id: s.year,
          exam_date: date,
          starts_at: at(date, '08:00'),
          ends_at: at(date, '08:45'),
          first_slot: 1,
          last_slot: 1,
          title: 'Quarter exam',
          cancel_cause: cancelCause,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const room = await transaction
        .insertInto('exam_rooms')
        .values({
          branch_id: s.branch,
          exam_id: written.id,
          room_id: await load.classes.room(s.branch),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('exam_room_classes')
        .values({
          branch_id: s.branch,
          exam_id: written.id,
          exam_room_id: room.id,
          class_id: s.seniorId,
        })
        .execute();
      await transaction
        .insertInto('exam_invigilators')
        .values({
          branch_id: s.branch,
          exam_id: written.id,
          exam_room_id: room.id,
          staff_id: invigilator,
        })
        .execute();
      await sql`set constraints all immediate`.execute(transaction);
      return written.id;
    });
  }

  /** A subject as a refusal line names it, in the three languages (task 5.6b-5b, decision 8). */
  async function subjectLine(id: string) {
    const row = await t.database.migrator
      .selectFrom('subjects')
      .select(['name_uz', 'name_ru', 'name_en'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return { id, names: { uz: row.name_uz, ru: row.name_ru, en: row.name_en } };
  }

  /** Every row a quarter save writes in a branch: what a refused one leaves as it was. */
  async function storedRowsOf(branch: string) {
    const rows: Record<string, unknown[]> = await t.rowsOf(branch);
    for (const table of [
      'quarters',
      'lessons',
      'lesson_blocks',
      'time_claims',
      'lesson_day_changes',
      'notifications',
      'timetable_day_keeps',
      'exams',
      'bulk_cancels',
    ] as const) {
      rows[table] = await t.database.migrator
        .selectFrom(table)
        .selectAll()
        .where('branch_id', '=', branch)
        .orderBy('id')
        .execute();
    }
    rows.lesson_day_change_ends = await t.database.migrator
      .selectFrom('lesson_day_change_ends')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('change_id')
      .execute();
    rows.lesson_block_class_outs = await t.database.migrator
      .selectFrom('lesson_block_class_outs')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('block_id')
      .orderBy('class_id')
      .execute();
    rows.bulk_cancel_spans = await t.database.migrator
      .selectFrom('bulk_cancel_spans')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('bulk_cancel_id')
      .orderBy('class_id')
      .orderBy('lesson_number')
      .execute();
    rows.bulk_cancel_blocks = await t.database.migrator
      .selectFrom('bulk_cancel_blocks')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('bulk_cancel_id')
      .orderBy('lesson_date')
      .orderBy('starts_at')
      .execute();
    rows.lesson_changes = await t.database.migrator
      .selectFrom('lesson_changes')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('lesson_id')
      .execute();
    // Permission review must-fix 1: the notices' delivery jobs.
    rows.jobs = (
      await sql<{ id: string }>`
        select id::text from pgboss.job
        where data->'branchIds' ? ${branch}
        order by id
      `.execute(t.database.migrator)
    ).rows;
    rows.audit = await t.database.migrator
      .selectFrom('audit_log')
      .select('id')
      .where('branch_id', '=', branch)
      .orderBy('id')
      .execute();
    return rows;
  }

  // Plan test 4: a boundary moved over future dates.
  it('a boundary moved over future dates moves those blocks to the new quarter in place; a vacation date that joins gets lessons', async () => {
    const s = await scene();
    const before = await blocksOf(s.branch);
    const oct26 = before.filter((one) => one.date === OCT26);
    expect(oct26.map((one) => one.number)).toEqual([1, 1]);
    expect(await lessonsOn(s.branch, NOV02)).toEqual([]);

    okay(
      await saveQuarters(
        s,
        withQuarters({ 1: ['2026-09-01', '2026-10-25'], 2: ['2026-10-26', '2026-12-28'] }),
      ),
    );

    const after = await blocksOf(s.branch);
    expect(after.filter((one) => one.date === OCT26)).toEqual(
      oct26.map((one) => ({ ...one, number: 2 })),
    );
    expect(after.filter((one) => one.date === OCT19).map((one) => one.number)).toEqual([1, 1]);
    // 2 November was in the vacation; it now lies in quarter 2.
    expect((await lessonsOn(s.branch, NOV02)).map((one) => one.class_id).sort()).toEqual(
      [s.classId, s.seniorId].sort(),
    );
    const audit = await lastAudit(s.branch);
    expect(audit.action).toBe('quarters.edit');
    const moved = (audit.new_value as { movedBlocks: { id: string; from: number; to: number }[] })
      .movedBlocks;
    expect(moved.map((one) => [one.id, one.from, one.to])).toEqual(
      [...oct26].sort((a, b) => a.id.localeCompare(b.id)).map((one) => [one.id, 1, 2]),
    );
    expect((audit.new_value as { lessonDates?: string[] }).lessonDates).toContain(NOV02);
  });

  // Plan test 5: refused over a held lesson; past dates without a block move freely.
  it('is refused over a lesson of today or earlier, listed; a move over past dates without a block saves', async () => {
    const s = await scene();
    // Monday 12 October, 15:00: the lessons of 08:00 and 08:55 are held.
    const later = '2026-10-12T15:00:00+05:00';
    t.clock.set(later);
    try {
      const browser = await t.kit.completeSession('Malika', 'Tursunova');
      await t.kit.giveRole(browser.account.id, { role: 'super_admin' });
      const rows = await storedRowsOf(s.branch);
      const refused = await saveQuarters(
        s,
        withQuarters({ 1: ['2026-09-01', '2026-10-11'], 2: ['2026-10-12', '2026-12-28'] }),
        undefined,
        browser.cookie,
      );
      refusedWith(refused, 409, 'quarter_past_lessons');
      expect(detailsOf(refused).map((one) => one.quarterItem)).toEqual([
        {
          kind: 'past_lesson',
          date: MONDAY,
          unit: { kind: 'class', name: expect.any(String) as string, grade: 7 },
          subject: await subjectLine(s.maths),
        },
        {
          kind: 'past_lesson',
          date: MONDAY,
          unit: { kind: 'class', name: expect.any(String) as string, grade: 10 },
          subject: await subjectLine(s.history),
        },
      ]);
      expect(await storedRowsOf(s.branch)).toEqual(rows);

      // Spec review of the plan, should-fix 4 (the shorter quarter, "refused,
      // with the list of what is in the way"): quarter 1 ending before the
      // held lessons takes 12 October out of every quarter.
      const shorter = await saveQuarters(
        s,
        withQuarters({ 1: ['2026-09-01', '2026-10-11'] }),
        undefined,
        browser.cookie,
      );
      refusedWith(shorter, 409, 'quarter_past_lessons');
      expect(
        detailsOf(shorter).map((one) => [one.day, (one.quarterItem as { kind: string }).kind]),
      ).toEqual([
        [MONDAY, 'past_lesson'],
        [MONDAY, 'past_lesson'],
      ]);
      expect(await storedRowsOf(s.branch)).toEqual(rows);

      // The first week of September holds no lesson: it leaves quarter 1.
      okay(
        await saveQuarters(
          s,
          withQuarters({ 1: ['2026-09-07', '2026-10-31'] }),
          undefined,
          browser.cookie,
        ),
      );
    } finally {
      t.clock.set(START);
    }
  });

  // Plan test 6: a shorter year.
  it('a shorter last quarter removes the future lessons of the days cut off; the year then ends there', async () => {
    const s = await scene();
    expect((await lessonsOn(s.branch, MAY31)).length).toBe(2);
    const shown = await shownFor(s, withQuarters({ 4: ['2027-03-30', MAY24] }));
    expect(shown.lessons.removed.filter((one) => one.date === MAY31).length).toBe(2);

    okay(await saveQuarters(s, withQuarters({ 4: ['2027-03-30', MAY24] })));

    expect(await lessonsOn(s.branch, MAY31)).toEqual([]);
    expect((await lessonsOn(s.branch, MAY24)).length).toBe(2);
    okay(await editYear(s, '2026-09-01', MAY24));
    // The year cannot cut the dated quarter.
    refusedWith(await editYear(s, '2026-09-01', '2027-05-20'), 409, 'outside_year');
  });

  // Plan test 7: a longer year.
  it('a longer year writes no lesson; a longer last quarter then adds the lessons of the version in force', async () => {
    const s = await scene();
    okay(await editYear(s, '2026-09-01', '2027-06-30'));
    expect(await lessonsOn(s.branch, JUN07)).toEqual([]);

    okay(await saveQuarters(s, withQuarters({ 4: ['2027-03-30', JUN14] })));

    for (const date of [JUN07, JUN14]) {
      const found = await lessonsOn(s.branch, date);
      expect(found.map((one) => [one.class_id, one.teacher_id, one.cancel_cause])).toEqual([
        [s.classId, s.teacherId, null],
        [s.seniorId, s.seniorTeacher, null],
      ]);
    }
    expect(
      (await blocksOf(s.branch)).filter((one) => one.date === JUN14).map((one) => one.number),
    ).toEqual([4, 4]);
  });

  it('a longer last quarter is checked with the full rule set: a lesson onto its teacher as an invigilator is refused by date', async () => {
    const s = await scene();
    okay(await editYear(s, '2026-09-01', '2027-06-30'));
    // An exam after the last quarter, inside the year, invigilated by the maths teacher at 08:00.
    await insertExam(s, JUN07, s.teacherId);
    const rows = await storedRowsOf(s.branch);

    const refused = await saveQuarters(s, withQuarters({ 4: ['2027-03-30', JUN14] }));

    refusedWith(refused, 409, 'calendar_blocked');
    expect(detailsOf(refused).some((one) => one.day === JUN07)).toBe(true);
    expect(await storedRowsOf(s.branch)).toEqual(rows);
  });

  // Plan test 8: the vacation between two quarters.
  it('a shorter vacation creates the lessons of the dates that join; a longer one removes them', async () => {
    const s = await scene();
    okay(await saveQuarters(s, withQuarters({ 2: [NOV02, '2026-12-28'] })));
    expect((await lessonsOn(s.branch, NOV02)).length).toBe(2);
    expect(
      (await blocksOf(s.branch)).filter((one) => one.date === NOV02).map((one) => one.number),
    ).toEqual([2, 2]);

    okay(await saveQuarters(s, withQuarters({ 2: [NOV16, '2026-12-28'] })));
    expect(await lessonsOn(s.branch, NOV02)).toEqual([]);
    expect(await lessonsOn(s.branch, NOV09)).toEqual([]);
    expect((await lessonsOn(s.branch, NOV16)).length).toBe(2);
  });

  // Plan test 9 (decision 5).
  it('a standing exam on a date that leaves every quarter refuses the save, listed; a cancelled one does not', async () => {
    const s = await scene();
    await insertExam(s, NOV09, s.seniorTeacher);
    const rows = await storedRowsOf(s.branch);
    const dates = withQuarters({ 2: [NOV16, '2026-12-28'] });

    const refused = await saveQuarters(s, dates);
    refusedWith(refused, 409, 'quarter_leaves_exam');
    expect(detailsOf(refused).map((one) => one.quarterItem)).toEqual([
      { kind: 'exam', date: NOV09, title: 'Quarter exam', cancelled: false },
    ]);
    expect(await storedRowsOf(s.branch)).toEqual(rows);
    const shown = await shownFor(s, dates);
    expect(shown.exams).toEqual({
      items: [{ kind: 'exam', date: NOV09, title: 'Quarter exam', cancelled: false }],
      more: 0,
    });

    const other = await scene();
    await insertExam(other, NOV09, other.seniorTeacher, 'cancelled');
    okay(await saveQuarters(other, dates));
  });

  // Task 8.2 (decision 13): a hand-set rating exam date stays inside its quarter.
  it('dates that leave a hand-set rating exam date outside its quarter refuse the save, listed, and the preview lists it', async () => {
    const s = await scene();
    await t.database.migrator
      .updateTable('subjects')
      .set({ journal_type: 'graded', rating_exam: true })
      .where('id', '=', s.history)
      .execute();
    const journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.seniorId)
        .where('subject_id', '=', s.history)
        .executeTakeFirstOrThrow()
    ).id;
    const quarter = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('branch_id', '=', s.branch)
        .where('number', '=', 2)
        .executeTakeFirstOrThrow()
    ).id;
    const author = await load.classes.account();
    await t.app.get(Transactions).run([s.branch], async (transaction) => {
      await t.app.get(Audit).record(transaction, {
        branchId: s.branch,
        actorId: null,
        action: 'journal.rating_date',
      });
      await transaction
        .insertInto('journal_rating_exams')
        .values({
          branch_id: s.branch,
          journal_id: journal,
          quarter_id: quarter,
          exam_date: '2026-12-24',
          version: 1,
          changed_by: author,
          changed_at: new Date(0),
        })
        .execute();
    });
    const rows = await storedRowsOf(s.branch);
    // Quarter 2 now ends on 20 December: the date of 24 December is in no quarter.
    const dates = withQuarters({ 2: [NOV09, '2026-12-20'] });
    const item = {
      kind: 'rating_date',
      date: '2026-12-24',
      unit: { kind: 'class', name: expect.any(String) as string, grade: 10 },
      subject: await subjectLine(s.history),
    };
    const refused = await saveQuarters(s, dates);
    refusedWith(refused, 409, 'quarter_rating_dates');
    expect(detailsOf(refused).map((one) => one.quarterItem)).toEqual([item]);
    expect(await storedRowsOf(s.branch)).toEqual(rows);
    expect((await shownFor(s, dates)).ratingDates).toEqual({ items: [item], more: 0 });
    // A date that stays inside: the save goes through.
    okay(await saveQuarters(s, withQuarters({ 2: [NOV09, '2026-12-25'] })));
  });

  // Task 5.6c-3b (decision 2; edge/calculation, "The rating exam": one
  // column per rating journal and quarter, with one exam date).
  it('dates that bring two standing rating exams of one journal into one quarter refuse the save, listed, and the preview lists them; with one cancelled or not a rating exam they do not', async () => {
    const s = await scene();
    const journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.seniorId)
        .where('subject_id', '=', s.history)
        .executeTakeFirstOrThrow()
    ).id;
    const ratingExam = async (date: string) => {
      const id = await insertExam(s, date, s.seniorTeacher);
      await t.database.migrator
        .updateTable('exams')
        .set({ subject_id: s.history, rating_exam: true })
        .where('id', '=', id)
        .execute();
      await t.database.migrator
        .insertInto('exam_rating_journals')
        .values({ branch_id: s.branch, exam_id: id, journal_id: journal, linked: true })
        .execute();
      return id;
    };
    await ratingExam(NOV16);
    const later = await ratingExam('2027-01-11');
    const rows = await storedRowsOf(s.branch);
    // The second quarter now runs to 12 January: both exams in it.
    const dates = withQuarters({ 2: [NOV09, '2027-01-12'], 3: ['2027-01-13', '2027-03-20'] });
    const item = {
      kind: 'rating_exams',
      date: '2027-01-11',
      unit: { kind: 'class', name: expect.any(String) as string, grade: 10 },
      subject: await subjectLine(s.history),
      exams: [
        { title: 'Quarter exam', date: NOV16 },
        { title: 'Quarter exam', date: '2027-01-11' },
      ],
    };

    const refused = await saveQuarters(s, dates);
    refusedWith(refused, 409, 'quarter_rating_exams');
    expect(detailsOf(refused).map((one) => one.quarterItem)).toEqual([item]);
    expect(await storedRowsOf(s.branch)).toEqual(rows);
    const shown = await shownFor(s, dates);
    expect(shown.ratingExams).toEqual({ items: [item], more: 0 });

    // The later exam cancelled: it no longer counts (decision 6).
    await t.database.migrator
      .updateTable('exams')
      .set({ cancel_cause: 'cancelled' })
      .where('id', '=', later)
      .execute();
    expect((await shownFor(s, dates)).ratingExams).toEqual({ items: [], more: 0 });
    // Another one on that date with the tick taken off: one rating exam in
    // the quarter (a cancel is final, so a third exam).
    const third = await ratingExam('2027-01-11');
    expect((await shownFor(s, dates)).ratingExams.items).toHaveLength(1);
    await t.database.migrator
      .updateTable('exams')
      .set({ rating_exam: false })
      .where('id', '=', third)
      .execute();
    expect((await shownFor(s, dates)).ratingExams).toEqual({ items: [], more: 0 });
    okay(await saveQuarters(s, dates));
  });

  // Plan test 10 (decision 6).
  it('a stored move whose two dates the save puts in two quarters refuses it; one whose dates move together saves and its block takes the new quarter', async () => {
    const s = await scene();
    const lesson = await lessonOf(s, OCT26, s.classId);
    okay(
      await keyed(`/api/timetable/lessons/${lesson.id}/move`, s.branch, {
        date: OCT19,
        lessonNumber: 3,
        reason: 'Excursion to the museum',
      }),
    );
    const rows = await storedRowsOf(s.branch);

    const refused = await saveQuarters(
      s,
      withQuarters({ 1: ['2026-09-01', '2026-10-25'], 2: [OCT26, '2026-12-28'] }),
    );
    refusedWith(refused, 409, 'quarter_splits_move');
    expect(detailsOf(refused).map((one) => one.quarterItem)).toEqual([
      {
        kind: 'split_move',
        fromDate: OCT26,
        toDate: OCT19,
        unit: { kind: 'class', name: expect.any(String) as string, grade: 7 },
        subject: await subjectLine(s.maths),
      },
    ]);
    expect(await storedRowsOf(s.branch)).toEqual(rows);

    okay(
      await saveQuarters(
        s,
        withQuarters({ 1: ['2026-09-01', '2026-10-18'], 2: [OCT19, '2026-12-28'] }),
      ),
    );
    const moved = await t.database.migrator
      .selectFrom('lessons')
      .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
      .innerJoin('quarters', 'quarters.id', 'lesson_blocks.quarter_id')
      .select([sql<string>`lessons.lesson_date::text`.as('date'), 'quarters.number'])
      .where('lessons.id', '=', lesson.id)
      .executeTakeFirstOrThrow();
    expect(moved).toEqual({ date: OCT19, number: 2 });
  });

  // Spec review of the code, should-fix 5: a move made onto a date that has
  // since passed, from a later one the save puts in another quarter.
  it('a stored move onto a date now past, from a date the save puts in another quarter, refuses it', async () => {
    const s = await scene();
    const lesson = await lessonOf(s, OCT26, s.classId);
    okay(
      await keyed(`/api/timetable/lessons/${lesson.id}/move`, s.branch, {
        date: MONDAY,
        lessonNumber: 3,
        reason: 'Excursion to the museum',
      }),
    );
    t.clock.set('2026-10-12T15:00:00+05:00');
    try {
      const browser = await t.kit.completeSession('Nodira', 'Saidova');
      await t.kit.giveRole(browser.account.id, { role: 'super_admin' });
      const rows = await storedRowsOf(s.branch);
      const refused = await saveQuarters(
        s,
        withQuarters({ 1: ['2026-09-01', '2026-10-25'], 2: [OCT26, '2026-12-28'] }),
        undefined,
        browser.cookie,
      );
      refusedWith(refused, 409, 'quarter_splits_move');
      expect(detailsOf(refused).map((one) => one.quarterItem)).toEqual([
        {
          kind: 'split_move',
          fromDate: OCT26,
          toDate: MONDAY,
          unit: { kind: 'class', name: expect.any(String) as string, grade: 7 },
          subject: await subjectLine(s.maths),
        },
      ]);
      expect(await storedRowsOf(s.branch)).toEqual(rows);
    } finally {
      t.clock.set(START);
    }
  });

  // Plan test 11.
  it('a stored one-day change on a date that leaves the quarters is sorted as a calendar save sorts it: without the key the save is refused', async () => {
    const s = await scene();
    const lesson = await lessonOf(s, NOV09, s.classId);
    okay(
      await keyed(`/api/timetable/lessons/${lesson.id}/cancel`, s.branch, {
        reason: 'Excursion to the museum',
      }),
    );
    const dates = withQuarters({ 2: [NOV16, '2026-12-28'] });
    const shown = await shownFor(s, dates);
    expect(shown.lessons.dayChanges.dropped.map((one) => one.kind)).toEqual(['cancel']);

    refusedWith(await saveQuarters(s, dates), 409, 'calendar_blocked');
    expect((await lessonsOn(s.branch, NOV09)).length).toBe(2);

    okay(await saveQuarters(s, dates, { dayChangesKey: shown.lessons.dayChanges.key }));
    expect(await lessonsOn(s.branch, NOV09)).toEqual([]);
  });

  // Plan test 12 (decision 8; the From line of 5.1b).
  it('the year edit is refused past an exam, a cancelled one too, with the field; it writes no lesson', async () => {
    const s = await scene();
    okay(await editYear(s, '2026-09-01', '2027-06-30'));
    // After the last quarter, inside the year: no quarter refuses first.
    await insertExam(s, JUN07, s.seniorTeacher, 'cancelled');
    const lessons = await t.database.migrator
      .selectFrom('lessons')
      .select('id')
      .where('branch_id', '=', s.branch)
      .orderBy('id')
      .execute();

    const refused = await editYear(s, '2026-09-01', '2027-06-04');
    refusedWith(refused, 409, 'year_leaves_exam');
    expect(detailsOf(refused).map((one) => one.path)).toEqual(['endDate']);
    // Task 5.6b-5b (decisions 2 and 7): the exam is named, marked cancelled.
    expect(detailsOf(refused).map((one) => one.quarterItem)).toEqual([
      { kind: 'exam', date: JUN07, title: 'Quarter exam', cancelled: true },
    ]);
    okay(await editYear(s, '2026-09-01', '2027-06-10'));
    // Permission review nit 5: the start side. The first two weeks of
    // September hold no lesson: quarter 1 then starts on 14 September, and an
    // exam of 7 September keeps the year's start.
    okay(await saveQuarters(s, withQuarters({ 1: ['2026-09-14', '2026-10-31'] })));
    await insertExam(s, '2026-09-07', s.seniorTeacher, 'cancelled');
    const early = await editYear(s, '2026-09-10', '2027-06-10');
    refusedWith(early, 409, 'year_leaves_exam');
    expect(detailsOf(early).map((one) => one.path)).toEqual(['startDate']);
    expect(detailsOf(early).map((one) => one.quarterItem)).toEqual([
      { kind: 'exam', date: '2026-09-07', title: 'Quarter exam', cancelled: true },
    ]);
    expect(
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('branch_id', '=', s.branch)
        .orderBy('id')
        .execute(),
    ).toEqual(lessons);
  });

  // Task 5.6b-5b, plan test 1 (decisions 2 and 7; `edge/time-dates-calendar`,
  // "refused, with the list of what is in the way"): a standing exam is named
  // unmarked; at most `QUARTER_ITEMS_LISTED` are named, by date, then the count.
  it('the year edit names the exams it would leave out, a standing one unmarked, at most 50 and the count of the rest', async () => {
    const s = await scene();
    okay(await editYear(s, '2026-09-01', '2027-08-31'));
    await insertExam(s, JUN07, s.seniorTeacher);
    const one = await editYear(s, '2026-09-01', '2027-06-04');
    refusedWith(one, 409, 'year_leaves_exam');
    expect(detailsOf(one).map((detail) => [detail.path, detail.quarterItem])).toEqual([
      ['endDate', { kind: 'exam', date: JUN07, title: 'Quarter exam', cancelled: false }],
    ]);

    const dates: string[] = [];
    for (let date = '2027-06-08'; dates.length < 50; date = addDays(date, 1)) dates.push(date);
    for (const date of dates) await insertExam(s, date, s.seniorTeacher, 'cancelled');
    const many = await editYear(s, '2026-09-01', '2027-06-04');
    refusedWith(many, 409, 'year_leaves_exam');
    const details = detailsOf(many);
    expect(details.map((detail) => detail.path)).toEqual([
      ...Array.from({ length: 50 }, () => 'endDate'),
      'more',
    ]);
    expect(
      details.slice(0, 50).map((detail) => (detail.quarterItem as { date: string }).date),
    ).toEqual([JUN07, ...dates.slice(0, 49)]);
    expect(details.at(-1)).toMatchObject({ path: 'more', more: 1 });
  });

  // Plan test 13 (decision 9).
  it('tells the teachers whose week changes; a quarter move that only moves blocks tells nobody', async () => {
    const s = await scene();
    okay(
      await saveQuarters(
        s,
        withQuarters({ 1: ['2026-09-01', '2026-10-18'], 2: [OCT19, '2026-12-28'] }),
      ),
    );
    // 19 and 26 October change quarter; 2 November joins quarter 2.
    const notices = await noticesOf(s.branch);
    expect(notices.map((one) => one.account_id).sort()).toEqual(
      [await accountOf(s.teacherId), await accountOf(s.seniorTeacher)].sort(),
    );
    expect(notices[0]?.data).toMatchObject({ firstDate: '2026-11-01', lastDate: '2026-11-08' });

    const other = await scene();
    okay(
      await saveQuarters(
        other,
        withQuarters({ 1: ['2026-09-01', '2026-10-18'], 2: [OCT19, '2026-12-28'] }),
      ),
    );
    const again = await noticesOf(other.branch);
    // Moving the boundary back writes 19 and 26 October in place, and 2
    // November leaves: only that date tells.
    okay(
      await saveQuarters(
        other,
        withQuarters({ 1: ['2026-09-01', '2026-10-31'], 2: [NOV09, '2026-12-28'] }),
      ),
    );
    expect((await noticesOf(other.branch)).length).toBe(again.length + 2);
    const third = await scene();
    okay(
      await saveQuarters(
        third,
        withQuarters({
          1: ['2026-09-01', '2026-10-18'],
          2: [OCT19, '2026-12-28'],
        }),
      ),
    );
    const count = (await noticesOf(third.branch)).length;
    // Every date stays a school day: only the blocks of 19 to 25 October move back to quarter 1.
    okay(
      await saveQuarters(
        third,
        withQuarters({
          1: ['2026-09-01', '2026-10-25'],
          2: [OCT26, '2026-12-28'],
        }),
      ),
    );
    expect((await noticesOf(third.branch)).length).toBe(count);
  });

  // Plan test 14.
  it('the preview lists what the save then does and writes nothing', async () => {
    const s = await scene();
    const lesson = await lessonOf(s, OCT26, s.classId);
    okay(
      await keyed(`/api/timetable/lessons/${lesson.id}/move`, s.branch, {
        date: OCT19,
        lessonNumber: 3,
        reason: 'Excursion to the museum',
      }),
    );
    await insertExam(s, NOV09, s.seniorTeacher);
    const rows = await storedRowsOf(s.branch);

    const shown = await shownFor(
      s,
      withQuarters({ 1: ['2026-09-01', '2026-10-25'], 2: [OCT26, '2026-12-28'] }),
    );
    expect(shown.movedBlocks).toEqual([{ date: OCT26, blocks: 1 }]);
    expect(shown.lessons.created.filter((one) => one.date === NOV02).length).toBe(2);
    expect(shown.splitMoves.items.map((one) => one.kind)).toEqual(['split_move']);
    expect(shown.exams.items).toEqual([]);
    expect(shown.pastLessons).toEqual({ items: [], more: 0 });

    const leaving = await shownFor(s, withQuarters({ 2: [NOV16, '2026-12-28'] }));
    expect(leaving.exams.items).toEqual([
      { kind: 'exam', date: NOV09, title: 'Quarter exam', cancelled: false },
    ]);
    expect(leaving.lessons.removed.filter((one) => one.date === NOV09).length).toBe(2);
    expect(await storedRowsOf(s.branch)).toEqual(rows);
  });

  // Plan test 16; .claude/rules/api.md: every id of the path and the body is
  // 404 for another branch's or an unknown one, with both branches unchanged.
  it("answers 404 for another branch's or an unknown year, or id among the choices, with both branches unchanged", async () => {
    const north = await scene();
    const south = await scene();
    const southLesson = await lessonOf(south, OCT26, south.classId);
    okay(
      await keyed(`/api/timetable/lessons/${southLesson.id}/move`, south.branch, {
        date: OCT19,
        lessonNumber: 3,
        reason: 'Excursion to the museum',
      }),
    );
    const southChangeId = (
      await t.database.migrator
        .selectFrom('lesson_day_changes')
        .select('id')
        .where('lesson_id', '=', southLesson.id)
        .executeTakeFirstOrThrow()
    ).id;
    const southBlock = await t.database.migrator
      .selectFrom('pattern_blocks')
      .select('id')
      .where('version_id', '=', south.version)
      .executeTakeFirstOrThrow();
    const southExam = await insertExam(south, NOV09, south.seniorTeacher);
    const northExam = await insertExam(north, NOV16, north.seniorTeacher);
    const northLesson = await lessonOf(north, NOV09, north.classId);
    okay(
      await keyed(`/api/timetable/lessons/${northLesson.id}/cancel`, north.branch, {
        reason: 'Excursion to the museum',
      }),
    );
    // Permission review nit 4: a bulk cancel of the south as a key.
    const southBulk = okay(
      await keyed('/api/timetable/bulk-cancels', south.branch, {
        date: NOV16,
        classIds: [south.classId],
        lessonNumbers: [1],
        reason: 'Excursion to the museum',
        blocks: [],
        lessonIds: [(await lessonOf(south, NOV16, south.classId)).id],
      }),
    );
    // Task 5.7b-1 (permission review, must-fix 1): substitutions in force on
    // the lessons from 9 November in each branch, which a save removing that
    // week would end (`t.rowsOf` holds both tables).
    for (const one of [north, south]) {
      expect(await substitutedIn(t.database.migrator, one.branch, NOV09)).toBeGreaterThan(0);
    }
    const rows = [await storedRowsOf(north.branch), await storedRowsOf(south.branch)];
    for (const one of rows) {
      expect(one.substitutions?.length).toBeGreaterThan(0);
      expect(one.substitution_lessons?.length).toBeGreaterThan(0);
    }
    const dates = withQuarters({ 2: [NOV16, '2026-12-28'] });

    const choices: object[] = [
      // Task 5.7b-3: a stored substitution of the other branch.
      {
        dayDecisions: [
          { key: await liveSubstitutionRowOf(t.database.migrator, south.branch), choice: 'drop' },
        ],
      },
      { dayDecisions: [{ key: southChangeId, choice: 'drop' }] },
      { dayDecisions: [{ key: southLesson.id, choice: 'drop' }] },
      { dayDecisions: [{ key: UNKNOWN, choice: 'drop' }] },
      { dayDecisions: [{ key: southBulk.id, choice: 'drop' }] },
      ...[southBlock.id, UNKNOWN].map((blockId) => ({
        dayDecisions: [{ key: northLesson.id, blockId, blockDate: NOV09, choice: 'cancel' }],
      })),
      { dayKeeps: [{ classId: south.classId, date: NOV09, slotPositions: [1] }] },
      { dayKeeps: [{ classId: UNKNOWN, date: NOV09, slotPositions: [1] }] },
      { examBlocks: [{ examId: southExam, classId: north.seniorId, start: 480, choice: 'keep' }] },
      { examBlocks: [{ examId: UNKNOWN, classId: north.seniorId, start: 480, choice: 'keep' }] },
      ...[south.seniorId, UNKNOWN].map((classId) => ({
        examBlocks: [{ examId: northExam, classId, start: 480, choice: 'keep' }],
      })),
    ];
    for (const days of choices) {
      refusedWith(await saveQuarters(north, dates, days), 404, 'not_found');
      refusedWith(await previewQuarters(north, dates, days), 404, 'not_found');
    }
    for (const year of [south.year, UNKNOWN]) {
      refusedWith(
        await t.put(`/api/setup/academic-years/${year}/quarters`, north.branch, body(dates)),
        404,
        'not_found',
      );
      refusedWith(
        await post(`/api/setup/academic-years/${year}/quarters/preview`, north.branch, body(dates)),
        404,
        'not_found',
      );
    }
    // A split group's choice has no use on a quarter save: refused by the schema.
    refusedWith(await saveQuarters(north, dates, { groupBlocks: [] }), 400, 'validation_failed');
    expect(await storedRowsOf(north.branch)).toEqual(rows[0]);
    expect(await storedRowsOf(south.branch)).toEqual(rows[1]);
  });

  it('refuses the Principal, a Teacher, a Head Teacher assigned in the branch and the Senior Head Teacher on the save and the preview, with nothing written', async () => {
    const s = await scene();
    // Permission review should-fix 3: the roles nearest to those allowed.
    const head = await t.kit.completeSession('Dilnoza', 'Yusupova');
    await t.kit.giveRole(head.account.id, { role: 'head_teacher', branchId: s.branch });
    const senior = await t.kit.completeSession('Bekzod', 'Rahimov');
    await t.kit.giveRole(senior.account.id, { role: 'senior_head_teacher' });
    for (const role of ['principal', 'teacher'] as const) {
      const holder = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('role', '=', role)
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      await load.classes.role(holder.account_id, s.branch, role);
    }
    const rows = await storedRowsOf(s.branch);
    const dates = withQuarters({ 2: [NOV16, '2026-12-28'] });
    for (const cookie of [t.principal, t.teacher, head.cookie, senior.cookie]) {
      refusedWith(await saveQuarters(s, dates, undefined, cookie), 403, 'permission_denied');
      refusedWith(await previewQuarters(s, dates, undefined, cookie), 403, 'permission_denied');
    }
    expect(await storedRowsOf(s.branch)).toEqual(rows);
  });

  // Permission review should-fix 2: the Academic Vice Principal assigned in
  // the branch previews and saves, and the audit entry names that assignment.
  it('lets the Academic Vice Principal assigned in the branch preview and save, named in the audit entry', async () => {
    const s = await scene();
    const holder = await t.database.migrator
      .selectFrom('assignments')
      .select('account_id')
      .where('role', '=', 'academic_vice_principal')
      .where('branch_id', '=', t.north)
      .executeTakeFirstOrThrow();
    const assignment = await load.classes.role(
      holder.account_id,
      s.branch,
      'academic_vice_principal',
    );
    const dates = withQuarters({ 2: [NOV02, '2026-12-28'] });
    okay(await previewQuarters(s, dates, undefined, t.vicePrincipal));
    okay(await saveQuarters(s, dates, undefined, t.vicePrincipal));
    expect((await lessonsOn(s.branch, NOV02)).length).toBe(2);
    const entry = await t.database.migrator
      .selectFrom('audit_log')
      .select(['action', 'assignment_id'])
      .where('branch_id', '=', s.branch)
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    expect(entry).toEqual({ action: 'quarters.edit', assignment_id: assignment });
  });

  // Plan test 15 (.claude/rules/timetable.md, .claude/rules/database.md,
  // .claude/rules/api.md): the real routes, in both orders.
  describe('at the same moment', () => {
    async function waitingForALock(): Promise<number> {
      const found = await sql<{ waiting: number }>`
        select count(distinct l.pid)::int as waiting
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and not l.granted
      `.execute(t.database.migrator);
      return found.rows[0]?.waiting ?? 0;
    }

    async function holdOpen(branch: string, work: (transaction: Transaction) => Promise<void>) {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const done = t.app
        .get(Transactions)
        .run([branch], async (transaction) => {
          await work(transaction);
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await Promise.race([isReady, done]);
      return { release, done };
    }

    /** The two routes in a fixed order: a third transaction holds a row both wait at. */
    async function inOrder(
      s: Scene,
      first: () => Promise<Response>,
      second: () => Promise<Response>,
      held: { table: 'classes' | 'staff' | 'academic_years'; id: string },
    ): Promise<[Response, Response]> {
      const gate = await holdOpen(s.branch, async (transaction) => {
        await transaction
          .selectFrom(held.table)
          .select('id')
          .where('id', '=', held.id)
          .forUpdate()
          .execute();
      });
      const waiting = await waitingForALock();
      const one = first().then((response) => response);
      await expect
        .poll(waitingForALock, { timeout: 20_000, interval: 50 })
        .toBeGreaterThan(waiting);
      const two = second().then((response) => response);
      await expect
        .poll(waitingForALock, { timeout: 20_000, interval: 50 })
        .toBeGreaterThan(waiting + 1);
      gate.release();
      expect(await gate.done).toBeUndefined();
      return [await one, await two];
    }

    const shorterVacation = withQuarters({ 2: [NOV02, '2026-12-28'] });

    for (const holder of ['classes', 'staff'] as const) {
      it(`a quarter save and a ${holder === 'classes' ? 'class archive' : 'staff status change'} in either order: no deadlock`, async () => {
        for (const order of [0, 1]) {
          const s = await scene();
          const id =
            holder === 'classes'
              ? await load.classes.schoolClass(s.branch, s.year, {
                  grade: 8,
                  room: await load.classes.room(s.branch),
                })
              : (await load.teacher(s.branch, { subjects: [{ subject: s.maths, grades: [7] }] }))
                  .staffId;
          const change = () => saveQuarters(s, shorterVacation);
          const other = () =>
            holder === 'classes'
              ? post(`/api/classes/${id}/archive`, s.branch)
              : post(`/api/people/staff/${id}/status`, s.branch, {
                  status: 'inactive',
                  from: '2026-11-02',
                });
          const [first, second] =
            order === 0
              ? await inOrder(s, change, other, { table: holder, id })
              : await inOrder(s, other, change, { table: holder, id });
          const [saved, changed] = order === 0 ? [first, second] : [second, first];
          expect(saved.status, JSON.stringify(saved.body)).toBe(200);
          expect(changed.status, JSON.stringify(changed.body)).toBe(200);
          expect((await lessonsOn(s.branch, NOV02)).length).toBe(2);
        }
      });
    }

    // Both wait at the year: the one-day move takes it `for share`, the save
    // `for no key update`. Each outcome depends on the other's write.
    it('a quarter save and a one-day move in either order: the later one reads the other', async () => {
      // The move first, from 26 October onto 19 October; then the save puts
      // 26 October in quarter 2 and 19 October stays in quarter 1: the move
      // would be split.
      const s = await scene();
      const lesson = await lessonOf(s, OCT26, s.classId);
      const split = withQuarters({ 1: ['2026-09-01', '2026-10-25'], 2: [OCT26, '2026-12-28'] });
      const move = () =>
        keyed(`/api/timetable/lessons/${lesson.id}/move`, s.branch, {
          date: OCT19,
          lessonNumber: 3,
          reason: 'Excursion to the museum',
        });
      const [moved, saved] = await inOrder(s, move, () => saveQuarters(s, split), {
        table: 'academic_years',
        id: s.year,
      });
      okay(moved);
      refusedWith(saved, 409, 'quarter_splits_move');

      // The save first: 26 October is then in quarter 2, and the move onto
      // 19 October (quarter 1) is refused as a move to another quarter.
      const other = await scene();
      const otherLesson = await lessonOf(other, OCT26, other.classId);
      const [savedFirst, movedLater] = await inOrder(
        other,
        () =>
          saveQuarters(
            other,
            withQuarters({ 1: ['2026-09-01', '2026-10-25'], 2: [OCT26, '2026-12-28'] }),
          ),
        () =>
          keyed(`/api/timetable/lessons/${otherLesson.id}/move`, other.branch, {
            date: OCT19,
            lessonNumber: 3,
            reason: 'Excursion to the museum',
          }),
        { table: 'academic_years', id: other.year },
      );
      okay(savedFirst);
      refusedWith(movedLater, 409, 'move_other_quarter');
    });
  });
});
