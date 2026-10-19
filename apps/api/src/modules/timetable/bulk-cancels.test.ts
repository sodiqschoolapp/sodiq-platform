import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  bulkCancelAnswerSchema,
  bulkCancelCheckAnswerSchema,
  type BulkCancelCheckAnswer,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import {
  dayTemplatesKit,
  MONDAY,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

/** The ids a refusal lists under its details. */
const listed = (response: Response) =>
  (response.body as { error: { details?: { path: string }[] } }).error.details?.map(
    (one) => one.path.split('.')[1] ?? '',
  ) ?? [];

/** The quarters of the year 2026-09-01 to 2027-05-31, dated. */
const QUARTERS = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
] as const;

/** A moment of a school date at a clock time in Tashkent (+05:00). */
const at = (date: string, time: string): Date => new Date(`${date}T${time}:00+05:00`);

/** The Monday and the Tuesday a week after `MONDAY`. */
const NEXT_MONDAY = '2026-10-19';
const NEXT_TUESDAY = '2026-10-20';
/** The Friday before the clock's Saturday: a past date. */
const YESTERDAY = '2026-10-09';

// All names are invented. Task 5.6a-3, pull request #162: the bulk cancel
// (docs/spec/06-timetable.md, Changes after publishing: "Bulk cancel. For an
// event: chosen classes, date and slots, with a reason."; edge/timetable,
// After publishing: "7 Oxford goes on an excursion, and group 7-M-1 has
// students from 7 Oxford and 7 Princeton. The bulk cancel lists such blocks.
// For each, the Academic Vice Principal chooses: cancel the whole block, or
// keep it and exempt the students of the chosen classes for those slots in
// the same action."). The clock stands at 23:55 on Saturday 10 October 2026
// in Tashkent.
describe('the bulk cancel', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let northScene: Scene;

  const keyed = (path: string, branch: string, body: object, cookie: string, key: string) =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, key)
      .send(body);

  const check = (
    branch: string,
    body: { date: string; classIds: string[]; lessonNumbers: number[] },
    cookie = t.admin,
  ) => t.post('/api/timetable/bulk-cancels/check', branch, body, cookie);

  const checked = async (
    branch: string,
    body: { date: string; classIds: string[]; lessonNumbers: number[] },
  ): Promise<BulkCancelCheckAnswer> => {
    const response = await check(branch, body);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return bulkCancelCheckAnswerSchema.parse(response.body);
  };

  const save = (
    branch: string,
    body: {
      date: string;
      classIds: string[];
      lessonNumbers: number[];
      reason?: string;
      blocks?: { blockId: string; choice: 'keep' | 'cancel' }[];
      lessonIds?: string[];
    },
    cookie = t.admin,
    key: string = randomUUID(),
  ) =>
    keyed(
      '/api/timetable/bulk-cancels',
      branch,
      { reason: 'Excursion to the museum', blocks: [], lessonIds: [], ...body },
      cookie,
      key,
    );

  /** The check, then the save with what it listed and `choice` for every shared block. */
  const checkAndSave = async (
    branch: string,
    body: { date: string; classIds: string[]; lessonNumbers: number[] },
    choice: 'keep' | 'cancel' = 'cancel',
  ) => {
    const answer = await checked(branch, body);
    const response = await save(branch, {
      ...body,
      blocks: answer.shared.map((one) => ({ blockId: one.blockId, choice })),
      lessonIds: answer.cancel.map((one) => one.lesson.id),
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return { check: answer, saved: bulkCancelAnswerSchema.parse(response.body) };
  };

  const publish = (branch: string, version: string, startsOn: string) =>
    request(t.kit.server)
      .post(`/api/timetable/versions/${version}/publish`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ startsOn });

  /** Hours of a person in the branch from 1 September, Monday to Friday, all day. */
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

  const placeAt = async (
    branch: string,
    version: string,
    loadRowId: string,
    weekday: number,
    slotPosition: number,
  ) => {
    const placed = await t.post(`/api/timetable/versions/${version}/pattern`, branch, {
      loadRowId,
      weekday,
      slotPosition,
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  };

  async function teacherOf(branch: string, subject: string, grades: number[] = [7]) {
    const teacher = await load.teacher(branch, { subjects: [{ subject, grades }] });
    await hours(branch, teacher.staffId);
    return teacher;
  }

  /**
   * A branch (its own unless given) with a year of four dated quarters, a day
   * of three lessons of 45 minutes from 08:00 (08:00, 08:55, 09:50) on every
   * weekday, the classes 7 Oxford and 7 Princeton, and a version published
   * from Monday 12 October:
   * - on Monday in lesson 1, maths of each class with a teacher of its own;
   * - on Monday in lesson 2, English in three parallel groups, one block:
   *   7-E-1 of both classes, 7-E-2 of 7 Princeton, 7-E-3 of 7 Oxford;
   * - on Tuesday in lessons 2 and 3, physics of 7 Oxford, a double lesson once `pairUp` pairs it;
   * - with `young`, a day of four lessons of 30 minutes (08:00, 08:35,
   *   09:10, 09:45) for grades 1 to 4, and the class 3 Cambridge with
   *   reading on Monday in lessons 2 and 3 and drawing in lesson 4.
   */
  async function scene(input: { branch?: string; young?: boolean } = {}) {
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
    const regular = await t.createTemplate(branch, 'Regular', [
      lesson,
      pause,
      lesson,
      pause,
      lesson,
    ]);
    await t.assign(branch, regular);
    if (input.young === true) {
      const short = await t.createSlotType(branch, 'Short lesson', 'lesson', 30);
      const shortPause = await t.createSlotType(branch, 'Short break', 'break', 5);
      const primary = await t.createTemplate(branch, 'Primary', [
        short,
        shortPause,
        short,
        shortPause,
        short,
        shortPause,
        short,
      ]);
      await t.assign(branch, primary, { level: 'grades', gradeFrom: 1, gradeTo: 4 });
    }
    const maths = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const english = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const physics = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const oxfordRoom = await load.classes.room(branch);
    const princetonRoom = await load.classes.room(branch);
    const oxford = await load.classes.schoolClass(branch, year, {
      grade: 7,
      name: 'Oxford',
      room: oxfordRoom,
    });
    const princeton = await load.classes.schoolClass(branch, year, {
      grade: 7,
      name: 'Princeton',
      room: princetonRoom,
    });
    const oxfordMaths = await teacherOf(branch, maths);
    const princetonMaths = await teacherOf(branch, maths);
    const created = await t.post('/api/timetable/versions', branch, {
      academicYearId: year,
      startsOn: MONDAY,
      copyFrom: null,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const version = (created.body as { id: string }).id;
    for (const [classId, person] of [
      [oxford, oxfordMaths],
      [princeton, princetonMaths],
    ] as const) {
      const row = await load.row({
        branch_id: branch,
        version_id: version,
        class_id: classId,
        subject_id: maths,
        teacher_id: person.staffId,
        lessons_per_week: 1,
      });
      await placeAt(branch, version, row, 1, 1);
    }
    const englishTeachers: { staffId: string; accountId: string }[] = [];
    const groups: string[] = [];
    const englishRows: string[] = [];
    for (const [index, classIds] of [[oxford, princeton], [princeton], [oxford]].entries()) {
      const group = await load.classes.group(branch, year, english, classIds, {
        name: `7-E-${String(index + 1)}`,
      });
      groups.push(group);
      const person = await teacherOf(branch, english);
      englishTeachers.push(person);
      englishRows.push(
        await load.row({
          branch_id: branch,
          version_id: version,
          group_id: group,
          subject_id: english,
          teacher_id: person.staffId,
          lessons_per_week: 1,
        }),
      );
    }
    await placeAt(branch, version, englishRows[0] ?? '', 1, 3);
    const physicsTeacher = await teacherOf(branch, physics);
    const physicsRow = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: oxford,
      subject_id: physics,
      teacher_id: physicsTeacher.staffId,
      lessons_per_week: 2,
      double_lessons: true,
    });
    await placeAt(branch, version, physicsRow, 2, 3);
    await placeAt(branch, version, physicsRow, 2, 5);
    let young: { classId: string; reading: string; drawing: string } | null = null;
    if (input.young === true) {
      const reading = await load.classes.subject({ grades: [3], journalType: 'attendance_only' });
      const drawing = await load.classes.subject({ grades: [3], journalType: 'attendance_only' });
      const classId = await load.classes.schoolClass(branch, year, {
        grade: 3,
        name: 'Cambridge',
        room: await load.classes.room(branch),
      });
      const readingRow = await load.row({
        branch_id: branch,
        version_id: version,
        class_id: classId,
        subject_id: reading,
        teacher_id: (await teacherOf(branch, reading, [3])).staffId,
        lessons_per_week: 2,
      });
      await placeAt(branch, version, readingRow, 1, 3);
      await placeAt(branch, version, readingRow, 1, 5);
      const drawingRow = await load.row({
        branch_id: branch,
        version_id: version,
        class_id: classId,
        subject_id: drawing,
        teacher_id: (await teacherOf(branch, drawing, [3])).staffId,
        lessons_per_week: 1,
      });
      await placeAt(branch, version, drawingRow, 1, 7);
      young = { classId, reading, drawing };
    }
    const confirmed = await t.post(`/api/timetable/versions/${version}/templates/confirm`, branch);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    await load.freeEditLock(version);
    const published = await publish(branch, version, MONDAY);
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    return {
      branch,
      year,
      version,
      maths,
      english,
      physics,
      oxford,
      princeton,
      oxfordMaths,
      princetonMaths,
      englishTeachers,
      groups,
      physicsTeacher,
      young,
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  const lessonsOf = (branch: string, date: string) =>
    t.database.migrator
      .selectFrom('lessons')
      .selectAll()
      .where('branch_id', '=', branch)
      .where('lesson_date', '=', date)
      .orderBy('starts_at')
      .orderBy('id')
      .execute();

  /** The stored lessons of a class (or group) and subject on a date, by start. */
  const lessonOf = async (
    s: Scene,
    date: string,
    unit: { classId?: string; groupId?: string },
    subject: string,
  ) =>
    (await lessonsOf(s.branch, date)).filter(
      (one) =>
        one.subject_id === subject &&
        (unit.classId === undefined || one.class_id === unit.classId) &&
        (unit.groupId === undefined || one.group_id === unit.groupId),
    );

  const oneLesson = async (
    s: Scene,
    date: string,
    unit: { classId?: string; groupId?: string },
    subject: string,
  ) => {
    const [found] = await lessonOf(s, date, unit, subject);
    if (found === undefined) throw new Error('No such lesson.');
    return found;
  };

  /** The two physics lessons of 7 Oxford on a Tuesday, made one double pair by the migrator. */
  const pairUp = async (s: Scene, date: string) => {
    const halves = await lessonOf(s, date, { classId: s.oxford }, s.physics);
    expect(halves).toHaveLength(2);
    await t.database.migrator
      .updateTable('lesson_blocks')
      .set({ double_pair_id: randomUUID() })
      .where('id', 'in', halves.map((one) => one.block_id))
      .execute();
    return halves;
  };

  const rowOf = (id: string) =>
    t.database.migrator.selectFrom('lessons').selectAll().where('id', '=', id).executeTakeFirst();

  const noticesOf = (accountId: string) =>
    t.database.migrator
      .selectFrom('notifications')
      .select(['branch_id', 'data'])
      .where('account_id', '=', accountId)
      .where('kind', '=', 'timetable.day_changed')
      .orderBy('id')
      .execute();

  const markOf = async (id: string) =>
    (
      await t.database.migrator
        .selectFrom('lesson_changes')
        .select('changed_at')
        .where('lesson_id', '=', id)
        .executeTakeFirst()
    )?.changed_at ?? null;

  /** Every row of the tables a bulk cancel writes, and the log. */
  const everything = () =>
    Promise.all([
      t.database.migrator.selectFrom('lessons').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('time_claims').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('lesson_changes').selectAll().orderBy('lesson_id').execute(),
      t.database.migrator.selectFrom('bulk_cancels').selectAll().orderBy('id').execute(),
      t.database.migrator
        .selectFrom('bulk_cancel_classes')
        .selectAll()
        .orderBy('bulk_cancel_id')
        .orderBy('class_id')
        .execute(),
      t.database.migrator
        .selectFrom('bulk_cancel_spans')
        .selectAll()
        .orderBy('bulk_cancel_id')
        .orderBy('class_id')
        .orderBy('lesson_number')
        .execute(),
      t.database.migrator
        .selectFrom('bulk_cancel_blocks')
        .selectAll()
        .orderBy('bulk_cancel_id')
        .orderBy('block_id')
        .execute(),
      t.database.migrator.selectFrom('notifications').select('id').orderBy('id').execute(),
      sql<{ id: string }>`select id from pgboss.job order by id`
        .execute(t.database.migrator)
        .then((result) => result.rows),
      t.database.migrator.selectFrom('audit_log').select('id').orderBy('id').execute(),
    ]);

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    northScene = await scene({ branch: t.north });
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the 7 Oxford row', () => {
    it('cancels 7 Oxford’s lessons and the shared block whole when “cancel” is chosen, notifies each teacher once and writes the log', async () => {
      const s = await scene();
      const body = { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [1, 2] };
      const maths = await oneLesson(s, NEXT_MONDAY, { classId: s.oxford }, s.maths);
      const english = (await lessonsOf(s.branch, NEXT_MONDAY)).filter(
        (one) => one.subject_id === s.english,
      );
      expect(english).toHaveLength(3);
      expect(new Set(english.map((one) => one.block_id)).size).toBe(1);
      const princetonMaths = await oneLesson(s, NEXT_MONDAY, { classId: s.princeton }, s.maths);

      const answer = await checked(s.branch, body);
      expect(answer.cancel.map((one) => one.lesson.id)).toEqual([maths.id]);
      expect(answer.shared).toHaveLength(1);
      const [shared] = answer.shared;
      expect(shared?.blockId).toBe(english[0]?.block_id);
      expect(shared?.pairBlockId).toBeNull();
      expect(shared?.otherClasses.map((one) => one.id)).toEqual([s.princeton]);
      expect(shared?.chosenClasses.map((one) => one.name)).toEqual(['7 Oxford']);
      const third = english.find((one) => one.group_id === s.groups[2]);
      expect(shared?.chosenOnly).toEqual([third?.id]);

      const response = await save(s.branch, {
        ...body,
        reason: '  Excursion to the museum  ',
        blocks: [{ blockId: shared?.blockId ?? '', choice: 'cancel' }],
        lessonIds: [maths.id],
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const saved = bulkCancelAnswerSchema.parse(response.body);
      expect([...saved.cancelled].sort()).toEqual(
        [maths.id, ...english.map((one) => one.id)].sort(),
      );
      expect(saved.kept).toEqual([]);
      for (const id of [maths.id, ...english.map((one) => one.id)]) {
        expect(await rowOf(id)).toMatchObject({
          cancel_cause: 'reason',
          cancel_reason: 'Excursion to the museum',
        });
        expect(await markOf(id)).toEqual(t.clock.now());
      }
      expect((await rowOf(princetonMaths.id))?.cancel_cause).toBeNull();
      const blocks = await t.database.migrator
        .selectFrom('bulk_cancel_blocks')
        .selectAll()
        .where('bulk_cancel_id', '=', saved.id)
        .execute();
      expect(blocks).toMatchObject([{ block_id: shared?.blockId, choice: 'cancel' }]);
      // One notice for each teacher whose week changed, none for 7 Princeton's maths teacher.
      for (const person of [s.oxfordMaths, ...s.englishTeachers]) {
        const notices = await noticesOf(person.accountId);
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({
          data: { weekStart: NEXT_MONDAY, after: [{ date: NEXT_MONDAY, cancelled: true }] },
        });
      }
      expect(await noticesOf(s.princetonMaths.accountId)).toEqual([]);
      const [entry] = await t.entries('lesson.bulk_cancel', saved.id);
      expect(entry).toMatchObject({
        branch_id: s.branch,
        new_value: {
          date: NEXT_MONDAY,
          classIds: [s.oxford],
          lessonNumbers: [1, 2],
          reason: 'Excursion to the museum',
          blocks: [{ blockIds: [shared?.blockId], choice: 'cancel' }],
          notices: { notified: 4, marked: 4 },
        },
      });
    });

    it('keeps the shared block when “keep” is chosen: only the part of 7 Oxford alone is cancelled, the spans of 7 Oxford are stored, the claims stay', async () => {
      const s = await scene();
      const body = { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [1, 2] };
      const english = (await lessonsOf(s.branch, NEXT_MONDAY)).filter(
        (one) => one.subject_id === s.english,
      );
      const blockId = english[0]?.block_id ?? '';
      const claimsBefore = await t.database.migrator
        .selectFrom('time_claims')
        .select('class_id')
        .where('kind', '=', 'block_class')
        .where('block_id', '=', blockId)
        .orderBy('class_id')
        .execute();
      expect(claimsBefore.map((one) => one.class_id).sort()).toEqual(
        [s.oxford, s.princeton].sort(),
      );
      const { saved } = await checkAndSave(s.branch, body, 'keep');
      const third = english.find((one) => one.group_id === s.groups[2]);
      expect(saved.kept).toEqual([blockId]);
      for (const one of english) {
        expect((await rowOf(one.id))?.cancel_cause).toBe(one.id === third?.id ? 'reason' : null);
      }
      // 7-E-1 and 7-E-2 are held, so both classes stay claimed (decision 6).
      const claimsAfter = await t.database.migrator
        .selectFrom('time_claims')
        .select('class_id')
        .where('kind', '=', 'block_class')
        .where('block_id', '=', blockId)
        .execute();
      expect(claimsAfter.map((one) => one.class_id).sort()).toEqual([s.oxford, s.princeton].sort());
      expect(
        await t.database.migrator
          .selectFrom('bulk_cancel_blocks')
          .select(['block_id', 'choice'])
          .where('bulk_cancel_id', '=', saved.id)
          .execute(),
      ).toEqual([{ block_id: blockId, choice: 'keep' }]);
      const spans = await t.database.migrator
        .selectFrom('bulk_cancel_spans')
        .select(['class_id', 'lesson_number', 'starts_at', 'ends_at'])
        .where('bulk_cancel_id', '=', saved.id)
        .orderBy('lesson_number')
        .execute();
      expect(spans).toEqual([
        {
          class_id: s.oxford,
          lesson_number: 1,
          starts_at: at(NEXT_MONDAY, '08:00'),
          ends_at: at(NEXT_MONDAY, '08:45'),
        },
        {
          class_id: s.oxford,
          lesson_number: 2,
          starts_at: at(NEXT_MONDAY, '08:55'),
          ends_at: at(NEXT_MONDAY, '09:40'),
        },
      ]);
      // The teachers of the held parts get no notice; the teacher of 7-E-3 one.
      expect(await noticesOf(s.englishTeachers[0]?.accountId ?? '')).toEqual([]);
      expect(await noticesOf(s.englishTeachers[1]?.accountId ?? '')).toEqual([]);
      expect(await noticesOf(s.englishTeachers[2]?.accountId ?? '')).toHaveLength(1);
    });

    it('refuses a shared block without a choice, and a choice for a block that is not shared', async () => {
      const s = northScene;
      const body = { date: '2026-10-26', classIds: [s.oxford], lessonNumbers: [2] };
      const answer = await checked(s.branch, body);
      const blockId = answer.shared[0]?.blockId ?? '';
      const before = await everything();
      const missing = await save(s.branch, { ...body, lessonIds: [] });
      refusedWith(missing, 409, 'bulk_choice_missing');
      expect(listed(missing)).toEqual([blockId]);
      const unknown = await save(s.branch, {
        ...body,
        blocks: [
          { blockId, choice: 'cancel' },
          { blockId: UNKNOWN, choice: 'keep' },
        ],
      });
      refusedWith(unknown, 409, 'bulk_choice_unknown');
      expect(listed(unknown)).toEqual([UNKNOWN]);
      expect(await everything()).toEqual(before);
    });

    it('cancels a block whose classes are all chosen whole, with no choice asked, and refuses a choice for it', async () => {
      const s = await scene();
      const body = { date: NEXT_MONDAY, classIds: [s.oxford, s.princeton], lessonNumbers: [2] };
      const answer = await checked(s.branch, body);
      expect(answer.shared).toEqual([]);
      const english = (await lessonsOf(s.branch, NEXT_MONDAY)).filter(
        (one) => one.subject_id === s.english,
      );
      expect(answer.cancel.map((one) => one.lesson.id).sort()).toEqual(
        english.map((one) => one.id).sort(),
      );
      refusedWith(
        await save(s.branch, {
          ...body,
          blocks: [{ blockId: english[0]?.block_id ?? '', choice: 'keep' }],
          lessonIds: english.map((one) => one.id),
        }),
        409,
        'bulk_choice_unknown',
      );
      const { saved } = await checkAndSave(s.branch, body);
      expect([...saved.cancelled].sort()).toEqual(english.map((one) => one.id).sort());
      expect(
        await t.database.migrator
          .selectFrom('bulk_cancel_blocks')
          .select('block_id')
          .where('bulk_cancel_id', '=', saved.id)
          .execute(),
      ).toEqual([]);
    });
  });

  describe('the slots', () => {
    it('reads each class’s slots from its own day by clock time, and skips a number its day lacks (decision 2)', async () => {
      const s = await scene({ young: true });
      const young = s.young;
      if (young === null) throw new Error('No young class.');
      const reading = await lessonOf(s, NEXT_MONDAY, { classId: young.classId }, young.reading);
      expect(reading).toHaveLength(2);
      // Lesson 2 of the primary day is 08:35–09:05; the 45-minute lesson 2
      // (08:55–09:40) would also meet reading in lesson 3 (09:10–09:40).
      const { saved } = await checkAndSave(s.branch, {
        date: NEXT_MONDAY,
        classIds: [young.classId],
        lessonNumbers: [2],
      });
      expect(saved.cancelled).toEqual([reading[0]?.id]);
      expect((await rowOf(reading[1]?.id ?? ''))?.cancel_cause).toBeNull();
      // Lesson 4 is only in the primary day: 3 Cambridge’s drawing goes, 7 Oxford has no span.
      const drawing = await oneLesson(s, NEXT_MONDAY, { classId: young.classId }, young.drawing);
      const second = await checkAndSave(s.branch, {
        date: NEXT_MONDAY,
        classIds: [young.classId, s.oxford],
        lessonNumbers: [4],
      });
      expect(second.saved.cancelled).toEqual([drawing.id]);
      const spans = await t.database.migrator
        .selectFrom('bulk_cancel_spans')
        .select(['class_id', 'starts_at'])
        .where('bulk_cancel_id', '=', second.saved.id)
        .execute();
      expect(spans).toEqual([{ class_id: young.classId, starts_at: at(NEXT_MONDAY, '09:45') }]);
      const classes = await t.database.migrator
        .selectFrom('bulk_cancel_classes')
        .select('class_id')
        .where('bulk_cancel_id', '=', second.saved.id)
        .execute();
      expect(classes.map((one) => one.class_id).sort()).toEqual([young.classId, s.oxford].sort());
    });

    it('cancels the lessons of every class chosen, as for the whole branch from a chosen slot', async () => {
      const s = await scene();
      const all = (await lessonsOf(s.branch, NEXT_MONDAY)).filter(
        (one) => one.cancel_cause === null,
      );
      const { check: answer, saved } = await checkAndSave(s.branch, {
        date: NEXT_MONDAY,
        classIds: [s.oxford, s.princeton],
        lessonNumbers: [1, 2, 3],
      });
      expect(answer.shared).toEqual([]);
      expect([...saved.cancelled].sort()).toEqual(all.map((one) => one.id).sort());
    });
  });

  describe('double lessons', () => {
    it('brings in the other half of a double lesson outside the slots (decision 4)', async () => {
      const s = await scene();
      const halves = await pairUp(s, NEXT_TUESDAY);
      const { check: answer, saved } = await checkAndSave(s.branch, {
        date: NEXT_TUESDAY,
        classIds: [s.oxford],
        lessonNumbers: [3],
      });
      expect(answer.cancel.map((one) => [one.lesson.id, one.broughtIn])).toEqual([
        [halves[0]?.id, true],
        [halves[1]?.id, false],
      ]);
      expect([...saved.cancelled].sort()).toEqual(halves.map((one) => one.id).sort());
      expect(await noticesOf(s.physicsTeacher.accountId)).toHaveLength(1);
    });

    it('keeps both blocks of a shared double lesson with one choice, cancelling 7 Oxford’s part in each (decisions 4 and 5)', async () => {
      const s = await scene();
      // The English block copied to lesson 3 of the same Monday, the two made one double pair.
      const english = (await lessonsOf(s.branch, NEXT_MONDAY)).filter(
        (one) => one.subject_id === s.english,
      );
      const blockId = english[0]?.block_id ?? '';
      const block = await t.database.migrator
        .selectFrom('lesson_blocks')
        .selectAll()
        .where('id', '=', blockId)
        .executeTakeFirstOrThrow();
      const pair = randomUUID();
      await t.database.migrator
        .updateTable('lesson_blocks')
        .set({ double_pair_id: pair })
        .where('id', '=', blockId)
        .execute();
      const made = await t.database.migrator
        .insertInto('lesson_blocks')
        .values({
          branch_id: s.branch,
          academic_year_id: block.academic_year_id,
          quarter_id: block.quarter_id,
          lesson_date: NEXT_MONDAY,
          starts_at: at(NEXT_MONDAY, '09:50'),
          ends_at: at(NEXT_MONDAY, '10:35'),
          version_id: block.version_id,
          pattern_block_id: block.pattern_block_id,
          double_pair_id: pair,
        })
        .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
        .executeTakeFirstOrThrow();
      const later: { id: string; group_id: string | null }[] = [];
      for (const one of english) {
        later.push(
          await t.database.migrator
            .insertInto('lessons')
            .values({
              branch_id: s.branch,
              block_id: made.id,
              lesson_date: made.lesson_date,
              starts_at: made.starts_at,
              ends_at: made.ends_at,
              group_id: one.group_id,
              subject_id: one.subject_id,
              load_row_id: one.load_row_id,
              pattern_entry_id: one.pattern_entry_id,
              teacher_id: one.teacher_id,
              room_id: one.room_id,
            })
            .returning(['id', 'group_id'])
            .executeTakeFirstOrThrow(),
        );
      }
      const { check: answer, saved } = await checkAndSave(
        s.branch,
        { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [2] },
        'keep',
      );
      expect(answer.shared).toHaveLength(1);
      expect(answer.shared[0]).toMatchObject({ blockId, pairBlockId: made.id });
      expect(saved.kept).toEqual([blockId, made.id]);
      const third = [...english, ...later].filter((one) => one.group_id === s.groups[2]);
      expect([...saved.cancelled].sort()).toEqual(third.map((one) => one.id).sort());
      for (const one of [...english, ...later]) {
        expect((await rowOf(one.id))?.cancel_cause).toBe(
          one.group_id === s.groups[2] ? 'reason' : null,
        );
      }
      const rows = await t.database.migrator
        .selectFrom('bulk_cancel_blocks')
        .select(['block_id', 'choice'])
        .where('bulk_cancel_id', '=', saved.id)
        .orderBy('starts_at')
        .execute();
      expect(rows).toEqual([
        { block_id: blockId, choice: 'keep' },
        { block_id: made.id, choice: 'keep' },
      ]);
    });

    it('cancels the lessons of a past date in the slots, and holds a half outside them that has started (review correction 1)', async () => {
      const s = await scene();
      // The template from the start of the year, and the Tuesday double copied to yesterday.
      // The fixture moves the dated rows back, past the guard that they only shrink.
      await t.database.migrator.transaction().execute(async (transaction) => {
        for (const table of [
          'slot_type_lengths',
          'day_template_versions',
          'day_template_assignments',
        ] as const) {
          await sql`alter table ${sql.table(table)} disable trigger user`.execute(transaction);
          await transaction
            .updateTable(table)
            .set({ valid_from: '2026-09-01' })
            .where('branch_id', '=', s.branch)
            .execute();
          await sql`alter table ${sql.table(table)} enable trigger user`.execute(transaction);
        }
      });
      const halves = await pairUp(s, NEXT_TUESDAY);
      const pair = randomUUID();
      const copied: string[] = [];
      for (const half of halves) {
        const block = await t.database.migrator
          .selectFrom('lesson_blocks')
          .selectAll()
          .where('id', '=', half.block_id)
          .executeTakeFirstOrThrow();
        const shift = (moment: Date) => new Date(moment.getTime() - 11 * 24 * 60 * 60_000);
        const made = await t.database.migrator
          .insertInto('lesson_blocks')
          .values({
            branch_id: s.branch,
            academic_year_id: block.academic_year_id,
            quarter_id: block.quarter_id,
            lesson_date: YESTERDAY,
            starts_at: shift(block.starts_at),
            ends_at: shift(block.ends_at),
            version_id: block.version_id,
            pattern_block_id: block.pattern_block_id,
            double_pair_id: pair,
          })
          .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
          .executeTakeFirstOrThrow();
        const lesson = await t.database.migrator
          .insertInto('lessons')
          .values({
            branch_id: s.branch,
            block_id: made.id,
            lesson_date: made.lesson_date,
            starts_at: made.starts_at,
            ends_at: made.ends_at,
            class_id: half.class_id,
            subject_id: half.subject_id,
            load_row_id: half.load_row_id,
            pattern_entry_id: half.pattern_entry_id,
            teacher_id: half.teacher_id,
            room_id: half.room_id,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        copied.push(lesson.id);
      }
      const { check: answer, saved } = await checkAndSave(s.branch, {
        date: YESTERDAY,
        classIds: [s.oxford],
        lessonNumbers: [3],
      });
      expect(answer.cancel.map((one) => one.lesson.id)).toEqual([copied[1]]);
      expect(answer.held.map((one) => one.id)).toEqual([copied[0]]);
      expect(saved.cancelled).toEqual([copied[1]]);
      expect((await rowOf(copied[0] ?? ''))?.cancel_cause).toBeNull();
      expect((await rowOf(copied[1] ?? ''))?.cancel_cause).toBe('reason');
    });
  });

  describe('lessons already cancelled and the restore', () => {
    it('leaves a lesson already cancelled with its own cause and reason, and a cancelled lesson restores alone', async () => {
      const s = await scene();
      const maths = await oneLesson(s, NEXT_MONDAY, { classId: s.oxford }, s.maths);
      const cancelled = await keyed(
        `/api/timetable/lessons/${maths.id}/cancel`,
        s.branch,
        { reason: 'The teacher is at a seminar' },
        t.admin,
        randomUUID(),
      );
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      const physics = await pairUp(s, NEXT_TUESDAY);
      const answer = await checked(s.branch, {
        date: NEXT_MONDAY,
        classIds: [s.oxford],
        lessonNumbers: [1],
      });
      expect(answer.alreadyCancelled.map((one) => one.id)).toEqual([maths.id]);
      refusedWith(
        await save(s.branch, { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [1] }),
        409,
        'bulk_cancel_empty',
      );
      expect(await rowOf(maths.id)).toMatchObject({
        cancel_cause: 'reason',
        cancel_reason: 'The teacher is at a seminar',
      });
      const { saved } = await checkAndSave(s.branch, {
        date: NEXT_TUESDAY,
        classIds: [s.oxford],
        lessonNumbers: [2, 3],
      });
      expect([...saved.cancelled].sort()).toEqual(physics.map((one) => one.id).sort());
      const restored = await keyed(
        `/api/timetable/lessons/${physics[0]?.id ?? ''}/restore`,
        s.branch,
        {},
        t.admin,
        randomUUID(),
      );
      expect(restored.status, JSON.stringify(restored.body)).toBe(200);
      for (const one of physics) expect((await rowOf(one.id))?.cancel_cause).toBeNull();
    });
  });

  describe('refusals', () => {
    it('refuses nothing to cancel, a date in no year, and an archived class', async () => {
      const s = northScene;
      const before = await everything();
      refusedWith(
        await check(s.branch, { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [3] }),
        409,
        'bulk_cancel_empty',
      );
      refusedWith(
        await save(s.branch, { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [3] }),
        409,
        'bulk_cancel_empty',
      );
      refusedWith(
        await check(s.branch, { date: '2027-07-05', classIds: [s.oxford], lessonNumbers: [1] }),
        409,
        'bulk_cancel_out_of_year',
      );
      const archived = await load.classes.schoolClass(s.branch, s.year, { grade: 7 });
      await t.database.migrator
        .updateTable('classes')
        .set({ archived_at: t.clock.now() })
        .where('id', '=', archived)
        .execute();
      const refused = await check(s.branch, {
        date: NEXT_MONDAY,
        classIds: [s.oxford, archived],
        lessonNumbers: [1],
      });
      refusedWith(refused, 409, 'class_not_active');
      expect(listed(refused)).toEqual([archived]);
      refusedWith(
        await save(s.branch, {
          date: NEXT_MONDAY,
          classIds: [s.oxford, archived],
          lessonNumbers: [1],
        }),
        409,
        'class_not_active',
      );
      expect(await everything()).toEqual(before);
    });

    it('refuses the save when a lesson moved into the slots after the check (decision 12)', async () => {
      const s = await scene();
      const body = { date: NEXT_MONDAY, classIds: [s.princeton], lessonNumbers: [3] };
      const maths = await oneLesson(s, NEXT_MONDAY, { classId: s.princeton }, s.maths);
      refusedWith(await check(s.branch, body), 409, 'bulk_cancel_empty');
      const moved = await keyed(
        `/api/timetable/lessons/${maths.id}/move`,
        s.branch,
        { date: NEXT_MONDAY, lessonNumber: 3, reason: 'The hall is free then' },
        t.admin,
        randomUUID(),
      );
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      const refused = await save(s.branch, body);
      refusedWith(refused, 409, 'bulk_scope_changed');
      expect(listed(refused)).toEqual([maths.id]);
      expect((await rowOf(maths.id))?.cancel_cause).toBeNull();
    });

    it('refuses a reason missing, lesson numbers unsorted or repeated, and a class twice as input errors', async () => {
      const s = northScene;
      const before = await everything();
      for (const body of [
        { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [1], reason: '   ' },
        { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [2, 1] },
        { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [1, 1] },
        { date: NEXT_MONDAY, classIds: [s.oxford, s.oxford], lessonNumbers: [1] },
        { date: NEXT_MONDAY, classIds: [], lessonNumbers: [1] },
        { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [21] },
      ]) {
        refusedWith(await save(s.branch, body), 400, 'validation_failed');
      }
      expect(await everything()).toEqual(before);
    });
  });

  describe('branch, roles and keys', () => {
    it('answers 404 for a class of another branch and an unknown one, as the Academic Vice Principal and the Super Admin, with nothing written in either branch', async () => {
      const s = northScene;
      const other = await scene();
      const before = await everything();
      for (const cookie of [t.vicePrincipal, t.admin]) {
        for (const classId of [other.oxford, UNKNOWN]) {
          const body = { date: NEXT_MONDAY, classIds: [s.oxford, classId], lessonNumbers: [1] };
          refusedWith(await check(s.branch, body, cookie), 404, 'not_found');
          refusedWith(await save(s.branch, body, cookie), 404, 'not_found');
        }
      }
      expect(await everything()).toEqual(before);
    });

    it('answers a repeated key with the stored answer once, refuses it from another account, and checks the branch and the role again on a repeat', async () => {
      const s = northScene;
      const body = { date: '2026-11-09', classIds: [s.princeton], lessonNumbers: [1] };
      const answer = await checked(s.branch, body);
      const full = { ...body, lessonIds: answer.cancel.map((one) => one.lesson.id) };
      const key = randomUUID();
      const first = await save(s.branch, full, t.vicePrincipal, key);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const again = await save(s.branch, full, t.vicePrincipal, key);
      expect(again.body).toEqual(first.body);
      refusedWith(await save(s.branch, full, t.admin, key), 409, 'request_key_reused');
      const foreign = await scene();
      refusedWith(
        await save(s.branch, { ...full, classIds: [foreign.oxford] }, t.vicePrincipal, key),
        404,
        'not_found',
      );
      refusedWith(await save(s.branch, full, t.principal, key), 403, 'permission_denied');
      const entries = (await t.entries('lesson.bulk_cancel')).filter(
        (one) => (one.new_value as { date?: string }).date === '2026-11-09',
      );
      expect(entries).toHaveLength(1);
    });
  });

  describe('at the same moment', () => {
    async function waiting(): Promise<number> {
      const found = await sql<{ n: number }>`
        select count(distinct l.pid)::int as n
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and not l.granted
      `.execute(t.database.migrator);
      return found.rows[0]?.n ?? 0;
    }

    /** Two real requests behind the publish lock held open, the first sent first. */
    async function inOrder(
      branch: string,
      first: () => Promise<Response>,
      second: () => Promise<Response>,
    ): Promise<[Response, Response]> {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const held = t.app
        .get(Transactions)
        .run([branch], async (transaction: Transaction) => {
          await sql`select pg_advisory_xact_lock(550001)`.execute(transaction);
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await isReady;
      const one = first().then((response) => response);
      await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(1);
      const two = second().then((response) => response);
      await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(2);
      release();
      expect(await held).toBeUndefined();
      return Promise.all([one, two]);
    }

    it('runs a bulk cancel and a cancel of one of its lessons one after the other, in either order', async () => {
      for (const order of [0, 1]) {
        const s = await scene();
        const body = { date: NEXT_MONDAY, classIds: [s.princeton], lessonNumbers: [1] };
        const maths = await oneLesson(s, NEXT_MONDAY, { classId: s.princeton }, s.maths);
        const bulk = () => save(s.branch, { ...body, lessonIds: [maths.id] });
        const one = () =>
          keyed(
            `/api/timetable/lessons/${maths.id}/cancel`,
            s.branch,
            { reason: 'The teacher is at a seminar' },
            t.admin,
            randomUUID(),
          );
        const [a, b] = await inOrder(s.branch, order === 0 ? bulk : one, order === 0 ? one : bulk);
        const [bulkAnswer, oneAnswer] = order === 0 ? [a, b] : [b, a];
        if (order === 0) {
          expect(bulkAnswer.status, JSON.stringify(bulkAnswer.body)).toBe(200);
          refusedWith(oneAnswer, 409, 'lesson_cancelled');
          expect((await rowOf(maths.id))?.cancel_reason).toBe('Excursion to the museum');
        } else {
          expect(oneAnswer.status, JSON.stringify(oneAnswer.body)).toBe(200);
          refusedWith(bulkAnswer, 409, 'bulk_scope_changed');
          expect((await rowOf(maths.id))?.cancel_reason).toBe('The teacher is at a seminar');
        }
      }
    });
  });
});
