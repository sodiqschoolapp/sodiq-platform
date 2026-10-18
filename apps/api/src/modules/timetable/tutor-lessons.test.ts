import type { INestApplication } from '@nestjs/common';
import { BRANCH_HEADER, classTutorPreviewSchema, type ClassTutorPreview } from '@sodiq/shared';
import { tutorAt } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit } from '../../testing/lessons-kit.js';
import { errorCode, signInKit, type SignInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { readTutorRows } from './load-facts.js';
import { followTutors } from './tutor-lessons.js';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
const TODAY = '2026-10-15';
const UNKNOWN = '0199a000-0000-7000-8000-000000000099';

// Task 3.6c-2, pull request #125. Owner's answer 2 of 15 October 2026 and
// answer 1 of 16 October 2026 (issue #42); docs/spec/edge-cases/timetable.md,
// Structure, "The Homework slot and Ma'naviyat soati": "Their teacher is
// always the class's Tutor in force on the lesson's date (the acting Tutor
// while one is set) ... When a class gets a new Tutor, its future Ma'naviyat
// soati and Homework slot lessons go to the new Tutor from that date, and held
// lessons keep the person who held them. A new Tutor's appointment is never
// refused for a clash: the class's Tutor lessons that clash with the new
// Tutor's other lessons, from the appointment's start, are listed in the
// appointment's preview and go to 'needs a teacher'." All names are invented.
describe('Tutor lessons follow the Tutor', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let lessons: LessonsKit;
  let north: string;
  let south: string;
  let northYear: { year: string; quarters: string[] };
  let southYear: { year: string; quarters: string[] };
  let tutorSubject: string;
  let subject: string;
  let admin: string;
  let vice: string;
  let principal: string;
  let southVice: string;
  let count = 0;
  const clock = new FixedClock(NOW);

  const post = (path: string, body: object = {}, cookie = vice, branch = north) =>
    kit.post(path, cookie).set(BRANCH_HEADER, branch).send(body);
  const patch = (path: string, body: object, cookie = vice, branch = north) =>
    request(kit.server).patch(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body);
  const get = (path: string, cookie = vice, branch = north) =>
    kit.get(path, cookie).set(BRANCH_HEADER, branch);

  const quarterOf = (year: { quarters: string[] }, date: string): string =>
    year.quarters[date < '2026-11-01' ? 0 : date < '2027-01-01' ? 1 : 2] ?? '';

  /** A class of grade 7 of the branch. */
  const newClass = (branch = north) => {
    count += 1;
    return lessons.load.classes.schoolClass(
      branch,
      branch === north ? northYear.year : southYear.year,
      {
        grade: 7,
        name: `Follow ${'abcdefghijklmnopqrstuvwxyz'[count % 26] ?? 'a'}${'k'.repeat(Math.floor(count / 26))}`,
      },
    );
  };

  /** A person of North (and of `further`) with a Tutor role in North from 1 September. */
  async function tutorPerson(further: readonly string[] = []) {
    const person = await lessons.load.classes.person(north, ['uz'], { further });
    const assignmentId = await lessons.load.classes.role(person.accountId, north, 'tutor');
    return { ...person, assignmentId };
  }

  /** A class of North with its Tutor from 1 September, written by the migrator. */
  async function tutoredClass() {
    const classId = await newClass();
    const tutor = await tutorPerson();
    const rowId = await lessons.load.classes.tutorRow(north, classId, tutor.assignmentId);
    return { classId, tutor, rowId };
  }

  /**
   * A dated lesson of a class, written as the application writes it, on a
   * version of its own whose load row names `rowTeacherId` (the class's
   * Tutor on 19 October for a Tutor subject).
   */
  async function lesson(input: Parameters<typeof lessonWriter>[0]): Promise<string> {
    const write = await lessonWriter(input);
    return app.get(Transactions).run([input.branch ?? north], write);
  }

  /** The version of `lesson`, then the write of the lesson in a transaction given later. */
  async function lessonWriter(input: {
    classId: string;
    date: string;
    start: string;
    end: string;
    teacherId: string | null;
    subjectId?: string;
    rowTeacherId?: string;
    branch?: string;
    cancel?: boolean;
  }): Promise<(transaction: Transaction) => Promise<string>> {
    const branch = input.branch ?? north;
    const year = branch === north ? northYear : southYear;
    const subjectId = input.subjectId ?? tutorSubject;
    const source = await lessons.source(branch, year.year, [
      {
        classId: input.classId,
        groupId: null,
        subjectId,
        ...(input.rowTeacherId === undefined ? {} : { rowTeacherId: input.rowTeacherId }),
      },
    ]);
    const from = source.lessons[0];
    if (from === undefined) throw new Error('No source for the lesson.');
    return async (transaction) => {
      const block = await transaction
        .insertInto('lesson_blocks')
        .values({
          branch_id: branch,
          academic_year_id: year.year,
          quarter_id: quarterOf(year, input.date),
          lesson_date: input.date,
          starts_at: at(input.date, input.start),
          ends_at: at(input.date, input.end),
          version_id: source.versionId,
          pattern_block_id: source.patternBlockId,
        })
        .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
        .executeTakeFirstOrThrow();
      const row = await transaction
        .insertInto('lessons')
        .values({
          branch_id: branch,
          block_id: block.id,
          lesson_date: block.lesson_date,
          starts_at: block.starts_at,
          ends_at: block.ends_at,
          class_id: input.classId,
          subject_id: subjectId,
          load_row_id: from.loadRowId,
          pattern_entry_id: from.patternEntryId,
          teacher_id: input.teacherId,
          cancel_cause: input.cancel === true ? 'reason' : null,
          cancel_reason: input.cancel === true ? 'Excursion to the museum' : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    };
  }

  /** The Tutor lesson of a class tutored by `tutor` on 19 October. */
  const tutorLesson = (
    classId: string,
    tutorStaffId: string,
    date: string,
    start = '09:00',
    end = '09:45',
    extra: { cancel?: boolean } = {},
  ) =>
    lesson({
      classId,
      date,
      start,
      end,
      teacherId: tutorStaffId,
      rowTeacherId: tutorStaffId,
      ...extra,
    });

  const teacherOf = async (lessonId: string) =>
    (
      await database.migrator
        .selectFrom('lessons')
        .select('teacher_id')
        .where('id', '=', lessonId)
        .executeTakeFirstOrThrow()
    ).teacher_id;

  const teachersOf = (ids: readonly string[]) => Promise.all(ids.map(teacherOf));

  const give = (
    classId: string,
    assignmentId: string,
    from: string,
    extra: { kind?: 'tutor' | 'acting'; until?: string | null } = {},
  ) =>
    post(`/api/classes/${classId}/tutors`, {
      assignmentId,
      kind: extra.kind ?? 'tutor',
      from,
      until: extra.until ?? null,
    });

  const preview = (
    classId: string,
    assignmentId: string,
    from: string,
    cookie = vice,
    branch = north,
  ) =>
    post(
      `/api/classes/${classId}/tutors/preview`,
      { assignmentId, kind: 'tutor', from, until: null },
      cookie,
      branch,
    );

  const endRow = (classId: string, rowId: string, from: string) =>
    post(`/api/classes/${classId}/tutors/${rowId}/end`, { from });

  const entry = (action: string, recordId: string) =>
    database.migrator
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', action)
      .where('record_id', '=', recordId)
      .orderBy('occurred_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();

  /** Every row of the tables a give writes, in both branches, and the log. */
  const rowsOf = () =>
    Promise.all([
      database.migrator.selectFrom('class_tutors').selectAll().orderBy('id').execute(),
      database.migrator.selectFrom('lessons').selectAll().orderBy('id').execute(),
      database.migrator.selectFrom('time_claims').selectAll().orderBy('id').execute(),
      database.migrator.selectFrom('teaching_load_rows').selectAll().orderBy('id').execute(),
      database.migrator.selectFrom('pattern_entries').selectAll().orderBy('id').execute(),
      database.migrator.selectFrom('audit_log').select('id').orderBy('id').execute(),
    ]);

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    lessons = await LessonsKit.create(database.migrator);
    northYear = await lessons.year(north);
    southYear = await lessons.year(south);
    tutorSubject = await lessons.load.tutorSubject({ grades: [7] });
    subject = await lessons.load.classes.subject({ grades: [7] });
    const [low, high] = [north, south].sort();
    await database.migrator
      .insertInto('travel_times')
      .values({ branch_low: low ?? '', branch_high: high ?? '', minutes: 30 })
      .execute();
    app = await createTestApp({ database: database.app, clock });
    kit = signInKit(app);
    const adminBrowser = await kit.completeSession('Aziza', 'Karimova');
    await kit.giveRole(adminBrowser.account.id, { role: 'super_admin' });
    admin = adminBrowser.cookie;
    const viceBrowser = await kit.completeSession('Dilnoza', 'Saidova');
    await kit.giveRole(viceBrowser.account.id, {
      role: 'academic_vice_principal',
      branchId: north,
    });
    vice = viceBrowser.cookie;
    const southBrowser = await kit.completeSession('Nodira', 'Yusupova');
    await kit.giveRole(southBrowser.account.id, {
      role: 'academic_vice_principal',
      branchId: south,
    });
    southVice = southBrowser.cookie;
    const principalBrowser = await kit.completeSession('Bobur', 'Aliyev');
    await kit.giveRole(principalBrowser.account.id, { role: 'principal', branchId: north });
    principal = principalBrowser.cookie;
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  describe('a new Tutor', () => {
    it('takes the future Tutor lessons from the date; earlier and held ones keep their teacher (done-when 1)', async () => {
      const own = await tutoredClass();
      const a = own.tutor.staffId;
      const held = await tutorLesson(own.classId, a, '2026-10-14');
      const before = await tutorLesson(own.classId, a, '2026-10-20');
      const after = await tutorLesson(own.classId, a, '2026-10-27');
      const cancelled = await tutorLesson(own.classId, a, '2026-10-28', '09:00', '09:45', {
        cancel: true,
      });
      // The class's other subjects and another class's Tutor lessons stay.
      const otherSubject = await lesson({
        classId: own.classId,
        date: '2026-10-29',
        start: '10:00',
        end: '10:45',
        teacherId: a,
        subjectId: subject,
      });
      const elsewhere = await tutoredClass();
      const otherClass = await tutorLesson(
        elsewhere.classId,
        elsewhere.tutor.staffId,
        '2026-10-27',
      );

      await endRow(own.classId, own.rowId, '2026-10-26').expect(200);
      expect(await teacherOf(after)).toBeNull();
      expect((await entry('class.tutor_ended', own.classId)).new_value).toMatchObject({
        tutorLessons: { moved: [], needsTeacher: [{ lessonId: after, from: a }] },
      });

      const b = await tutorPerson();
      await give(own.classId, b.assignmentId, '2026-10-26').expect(201);
      expect(await teachersOf([held, before, after, cancelled, otherSubject, otherClass])).toEqual([
        a,
        a,
        b.staffId,
        a,
        a,
        elsewhere.tutor.staffId,
      ]);
      expect((await entry('class.tutor_given', own.classId)).new_value).toMatchObject({
        tutorLessons: {
          moved: [{ lessonId: after, from: null, to: b.staffId }],
          needsTeacher: [],
          draftRows: [],
        },
      });
    });

    it('dated today leaves today’s later Tutor lesson to its teacher (decision 12)', async () => {
      const own = await tutoredClass();
      const a = own.tutor.staffId;
      const laterToday = await tutorLesson(own.classId, a, TODAY, '14:00', '14:45');
      const tomorrow = await tutorLesson(own.classId, a, '2026-10-16');
      const acting = await tutorPerson();
      await give(own.classId, acting.assignmentId, TODAY, {
        kind: 'acting',
        until: '2026-10-19',
      }).expect(201);
      expect(await teachersOf([laterToday, tomorrow])).toEqual([a, acting.staffId]);
    });
  });

  describe('an acting Tutor', () => {
    it('holds the lessons of the period, and its end gives the later ones back to the Tutor', async () => {
      const own = await tutoredClass();
      const a = own.tutor.staffId;
      const inside = await tutorLesson(own.classId, a, '2026-10-20');
      const late = await tutorLesson(own.classId, a, '2026-10-29');
      const outside = await tutorLesson(own.classId, a, '2026-10-30');
      const acting = await tutorPerson();
      await give(own.classId, acting.assignmentId, '2026-10-19', {
        kind: 'acting',
        until: '2026-10-30',
      }).expect(201);
      expect(await teachersOf([inside, late, outside])).toEqual([
        acting.staffId,
        acting.staffId,
        a,
      ]);
      const actingRow = await database.migrator
        .selectFrom('class_tutors')
        .select('id')
        .where('class_id', '=', own.classId)
        .where('kind', '=', 'acting')
        .executeTakeFirstOrThrow();
      await endRow(own.classId, actingRow.id, '2026-10-26').expect(200);
      expect(await teachersOf([inside, late, outside])).toEqual([acting.staffId, a, a]);
    });
  });

  describe('a clash with the new Tutor (done-when 2)', () => {
    it('lists the lesson in the preview and sets it to need a teacher; the give is not refused', async () => {
      const own = await tutoredClass();
      const a = own.tutor.staffId;
      const b = await tutorPerson([south]);
      // B teaches another class at the time of the first Tutor lesson,
      // invigilates an exam at the second, and teaches in South 5 minutes
      // after the third (travel time 30 minutes).
      const busyClass = await newClass();
      await lesson({
        classId: busyClass,
        date: '2026-10-20',
        start: '09:00',
        end: '09:45',
        teacherId: b.staffId,
        subjectId: subject,
      });
      const room = await lessons.room(north);
      const sitting = await newClass();
      await app.get(Transactions).run([north], async (transaction) => {
        const exam = await transaction
          .insertInto('exams')
          .values({
            branch_id: north,
            academic_year_id: northYear.year,
            exam_date: '2026-10-21',
            starts_at: at('2026-10-21', '08:30'),
            ends_at: at('2026-10-21', '10:00'),
            first_slot: 1,
            last_slot: 2,
            title: 'Quarter exam in English',
            subject_id: subject,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const examRoom = await transaction
          .insertInto('exam_rooms')
          .values({ branch_id: north, exam_id: exam.id, room_id: room })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('exam_room_classes')
          .values({
            branch_id: north,
            exam_id: exam.id,
            exam_room_id: examRoom.id,
            class_id: sitting,
          })
          .execute();
        await transaction
          .insertInto('exam_invigilators')
          .values({
            branch_id: north,
            exam_id: exam.id,
            exam_room_id: examRoom.id,
            staff_id: b.staffId,
          })
          .execute();
      });
      const southClass = await newClass(south);
      await lesson({
        classId: southClass,
        date: '2026-10-22',
        start: '09:50',
        end: '10:35',
        teacherId: b.staffId,
        subjectId: subject,
        branch: south,
      });
      const clashLesson = await tutorLesson(own.classId, a, '2026-10-20');
      const examDay = await tutorLesson(own.classId, a, '2026-10-21');
      const travelDay = await tutorLesson(own.classId, a, '2026-10-22');
      const free = await tutorLesson(own.classId, a, '2026-10-23');
      await endRow(own.classId, own.rowId, '2026-10-19').expect(200);

      const before = await rowsOf();
      const answer: ClassTutorPreview = classTutorPreviewSchema.parse(
        (await preview(own.classId, b.assignmentId, '2026-10-19').expect(200)).body,
      );
      // The preview writes nothing.
      expect(await rowsOf()).toEqual(before);
      expect(answer.moved.map((one) => one.lessonId)).toEqual([free]);
      expect(answer.needsTeacher.map((one) => one.lessonId)).toEqual([
        clashLesson,
        examDay,
        travelDay,
      ]);
      expect(answer.needsTeacher.map((one) => [one.date, one.start, one.clashes])).toEqual([
        ['2026-10-20', '09:00', [{ start: '09:00', end: '09:45', branchName: null }]],
        ['2026-10-21', '09:00', [{ start: '08:30', end: '10:00', branchName: null }]],
        ['2026-10-22', '09:00', [{ start: '09:50', end: '10:35', branchName: 'South' }]],
      ]);
      expect(answer.moved).toEqual([
        expect.objectContaining({
          lessonId: free,
          date: '2026-10-23',
          start: '09:00',
          end: '09:45',
          to: expect.objectContaining({ lastName: expect.any(String) as string }) as object,
        }),
      ]);

      await give(own.classId, b.assignmentId, '2026-10-19').expect(201);
      expect(await teachersOf([clashLesson, examDay, travelDay, free])).toEqual([
        null,
        null,
        null,
        b.staffId,
      ]);
      // The save wrote what the preview said.
      const given = await entry('class.tutor_given', own.classId);
      expect(given.new_value).toMatchObject({
        tutorLessons: {
          moved: [{ lessonId: free, from: null, to: b.staffId }],
          needsTeacher: [
            { lessonId: clashLesson, from: null },
            { lessonId: examDay, from: null },
            { lessonId: travelDay, from: null },
          ],
        },
      });
    });

    it('gives the first of two clashing Tutor lessons of one Tutor, the second needs a teacher', async () => {
      const first = await tutoredClass();
      const second = await tutoredClass();
      const one = await tutorLesson(
        first.classId,
        first.tutor.staffId,
        '2026-10-26',
        '11:00',
        '11:45',
      );
      const two = await tutorLesson(
        second.classId,
        second.tutor.staffId,
        '2026-10-26',
        '11:00',
        '11:45',
      );
      const b = await tutorPerson();
      await endRow(first.classId, first.rowId, '2026-10-19').expect(200);
      await endRow(second.classId, second.rowId, '2026-10-19').expect(200);
      await give(first.classId, b.assignmentId, '2026-10-19').expect(201);
      await give(second.classId, b.assignmentId, '2026-10-19').expect(201);
      expect(await teachersOf([one, two])).toEqual([b.staffId, null]);
    });
  });

  describe('the preview', () => {
    it('is refused to the readers and answers 404 for another branch’s or an unknown class or Tutor role', async () => {
      const own = await tutoredClass();
      await tutorLesson(own.classId, own.tutor.staffId, '2026-10-21');
      await endRow(own.classId, own.rowId, '2026-10-19').expect(200);
      const b = await tutorPerson();
      const before = await rowsOf();
      expect(
        errorCode(await preview(own.classId, b.assignmentId, '2026-10-19', principal).expect(403)),
      ).toBe('permission_denied');
      const southClass = await newClass(south);
      await preview(southClass, b.assignmentId, '2026-10-19').expect(404);
      await preview(UNKNOWN, b.assignmentId, '2026-10-19').expect(404);
      await preview(own.classId, UNKNOWN, '2026-10-19').expect(404);
      const southPerson = await lessons.load.classes.person(south, ['uz']);
      const southRole = await lessons.load.classes.role(southPerson.accountId, south, 'tutor');
      await preview(own.classId, southRole, '2026-10-19').expect(404);
      await preview(own.classId, b.assignmentId, '2026-10-19', southVice, south).expect(404);
      expect(await rowsOf()).toEqual(before);
      // A refusal of the give is the preview's too.
      expect(errorCode(await preview(own.classId, b.assignmentId, '2026-10-01').expect(409))).toBe(
        'tutor_date_past',
      );
    });
  });

  // .claude/rules/api.md: a path id of another branch, or unknown, is
  // answered 404 before anything is written, with Tutor lessons in both
  // branches that a follow would move (permission review, must-fix 1).
  describe('the give, the end and the archive of another branch’s or an unknown record', () => {
    it('answer 404 and write nothing', async () => {
      const own = await tutoredClass();
      await tutorLesson(own.classId, own.tutor.staffId, '2026-10-27');
      const southClass = await newClass(south);
      const southPerson = await lessons.load.classes.person(south, ['uz']);
      const southRole = await lessons.load.classes.role(southPerson.accountId, south, 'tutor');
      const southRow = await lessons.load.classes.tutorRow(south, southClass, southRole);
      await lesson({
        classId: southClass,
        date: '2026-10-27',
        start: '09:00',
        end: '09:45',
        teacherId: southPerson.staffId,
        rowTeacherId: southPerson.staffId,
        branch: south,
      });
      const b = await tutorPerson();
      const before = await rowsOf();
      await give(southClass, b.assignmentId, '2026-10-19').expect(404);
      await give(UNKNOWN, b.assignmentId, '2026-10-19').expect(404);
      await give(own.classId, southRole, '2026-10-19').expect(404);
      await endRow(southClass, southRow, '2026-10-19').expect(404);
      await endRow(own.classId, southRow, '2026-10-19').expect(404);
      await endRow(own.classId, UNKNOWN, '2026-10-19').expect(404);
      await post(`/api/classes/${southClass}/archive`).expect(404);
      await post(`/api/classes/${UNKNOWN}/archive`).expect(404);
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('the end of the Tutor role', () => {
    it('sets the lessons from the end to need a teacher, and a later end gives them back', async () => {
      const own = await tutoredClass();
      const a = own.tutor.staffId;
      const early = await tutorLesson(own.classId, a, '2026-10-27');
      const mid = await tutorLesson(own.classId, a, '2026-10-29');
      const late = await tutorLesson(own.classId, a, '2026-10-30');
      const end = (from: string) =>
        post(`/api/people/staff/${a}/roles/${own.tutor.assignmentId}/end`, { from }, admin).expect(
          200,
        );
      await end('2026-10-28');
      expect(await teachersOf([early, mid, late])).toEqual([a, null, null]);
      expect((await entry('assignment.ended', own.tutor.assignmentId)).details).toMatchObject({
        tutorLessons: {
          needsTeacher: [
            { lessonId: mid, from: a },
            { lessonId: late, from: a },
          ],
        },
      });
      await end('2026-10-30');
      expect(await teachersOf([early, mid, late])).toEqual([a, a, null]);
    });

    it('follows a `left` and its taking back', async () => {
      const own = await tutoredClass();
      const a = own.tutor.staffId;
      const lessonId = await tutorLesson(own.classId, a, '2026-10-29');
      await post(
        `/api/people/staff/${a}/status`,
        { status: 'left', from: '2026-10-28' },
        admin,
      ).expect(200);
      expect(await teacherOf(lessonId)).toBeNull();
      await post(`/api/people/staff/${a}/status`, { status: 'active', from: TODAY }, admin).expect(
        200,
      );
      expect(await teacherOf(lessonId)).toBe(a);
    });

    // Review of #152, round 2, finding 1 (edge/timetable, After publishing):
    // "A class cannot be archived while it has future lessons or members", so
    // the archive has no Tutor lesson left to follow.
    it('refuses the archive of a class with a lesson after today, and keeps a lesson later today with its Tutor', async () => {
      const own = await tutoredClass();
      const later = await tutorLesson(own.classId, own.tutor.staffId, '2026-10-29');
      const response = await post(`/api/classes/${own.classId}/archive`).expect(409);
      expect(errorCode(response)).toBe('class_has_lessons');
      expect(await teacherOf(later)).toBe(own.tutor.staffId);
      const archived = await database.migrator
        .selectFrom('classes')
        .select('archived_at')
        .where('id', '=', own.classId)
        .executeTakeFirstOrThrow();
      expect(archived.archived_at).toBeNull();

      const other = await tutoredClass();
      const today = await tutorLesson(other.classId, other.tutor.staffId, TODAY, '15:00', '15:45');
      await post(`/api/classes/${other.classId}/archive`).expect(200);
      expect(await teacherOf(today)).toBe(other.tutor.staffId);
      expect((await entry('class.archive', other.classId)).details).not.toHaveProperty(
        'tutorLessons',
      );
    });
  });

  describe('drafts (decision 5)', () => {
    /** A draft of North starting `startsOn` with the Tutor row of the class and its pattern entry. */
    async function draftWithTutorRow(classId: string, teacherId: string, startsOn: string) {
      const version = await lessons.load.version(north, northYear.year, { startsOn });
      const row = await lessons.load.row({
        branch_id: north,
        version_id: version,
        class_id: classId,
        subject_id: tutorSubject,
        teacher_id: teacherId,
      });
      const entryId = await patternEntry(version, row, teacherId);
      return { version, row, entryId };
    }

    async function patternEntry(version: string, row: string, teacherId: string) {
      const block = await database.migrator
        .insertInto('pattern_blocks')
        .values({
          branch_id: north,
          version_id: version,
          weekday: 1,
          slot_position: 1,
          start_minutes: 540,
          end_minutes: 585,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const written = await database.migrator
        .insertInto('pattern_entries')
        .values({
          branch_id: north,
          version_id: version,
          block_id: block.id,
          weekday: 1,
          start_minutes: 540,
          end_minutes: 585,
          load_row_id: row,
          teacher_id: teacherId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return written.id;
    }

    const rowTeacher = async (row: string) =>
      (
        await database.migrator
          .selectFrom('teaching_load_rows')
          .select('teacher_id')
          .where('id', '=', row)
          .executeTakeFirstOrThrow()
      ).teacher_id;

    it('re-point their Tutor rows, remove an entry the Tutor holds the time of, keep a refused row', async () => {
      const own = await tutoredClass();
      const a = own.tutor.staffId;
      const b = await tutorPerson();
      // B teaches another class in the first draft at the time of the Tutor row's entry.
      const first = await draftWithTutorRow(own.classId, a, '2026-11-16');
      const busyClass = await newClass();
      await lessons.load.profile(b.staffId, [{ subject, grades: [7] }]);
      const busyRow = await lessons.load.row({
        branch_id: north,
        version_id: first.version,
        class_id: busyClass,
        subject_id: subject,
        teacher_id: b.staffId,
      });
      await patternEntry(first.version, busyRow, b.staffId);
      // B is inactive from 23 November: the second draft cannot take B.
      const second = await draftWithTutorRow(own.classId, a, '2026-11-23');
      await lessons.load.status(b.staffId, 'inactive', '2026-11-23');
      // A published version keeps its row.
      const published = await draftWithTutorRow(own.classId, a, '2026-11-30');
      await lessons.load.setVersion(published.version, 'published');

      await endRow(own.classId, own.rowId, '2026-11-09').expect(200);
      await give(own.classId, b.assignmentId, '2026-11-09').expect(201);
      expect(await rowTeacher(first.row)).toBe(b.staffId);
      expect(await rowTeacher(second.row)).toBe(a);
      expect(await rowTeacher(published.row)).toBe(a);
      const entries = await database.migrator
        .selectFrom('pattern_entries')
        .select('id')
        .where('id', '=', first.entryId)
        .execute();
      expect(entries).toEqual([]);
      expect((await entry('class.tutor_given', own.classId)).new_value).toMatchObject({
        tutorLessons: {
          draftRows: [{ rowId: first.row, from: a, to: b.staffId }],
          draftRowsKept: [second.row],
          draftEntriesRemoved: [first.entryId],
        },
      });
    });

    it('follow a change of the start date and a copy, with the rows in the entry', async () => {
      const own = await tutoredClass();
      const a = own.tutor.staffId;
      const b = await tutorPerson();
      await database.migrator
        .updateTable('class_tutors')
        .set({
          valid_until: new Date('2026-11-09T00:00:00+05:00'),
          own_until: new Date('2026-11-09T00:00:00+05:00'),
          end_cause: 'ended',
        })
        .where('id', '=', own.rowId)
        .execute();
      await lessons.load.classes.tutorRow(north, own.classId, b.assignmentId, {
        from: new Date('2026-11-09T00:00:00+05:00'),
      });
      const moved = await draftWithTutorRow(own.classId, a, '2026-10-26');
      await patch(`/api/timetable/versions/${moved.version}`, { startsOn: '2026-11-16' }).expect(
        200,
      );
      expect(await rowTeacher(moved.row)).toBe(b.staffId);
      expect((await entry('timetable_version.edit', moved.version)).new_value).toMatchObject({
        tutorLessons: { draftRows: [{ rowId: moved.row, from: a, to: b.staffId }] },
      });
      const source = await draftWithTutorRow(own.classId, a, '2026-10-26');
      const copied = (
        await post('/api/timetable/versions', {
          academicYearId: northYear.year,
          startsOn: '2026-11-16',
          copyFrom: source.version,
        }).expect(201)
      ).body as { id: string };
      const rows = await database.migrator
        .selectFrom('teaching_load_rows')
        .select(['class_id', 'teacher_id'])
        .where('version_id', '=', copied.id)
        .execute();
      expect(rows).toEqual([{ class_id: own.classId, teacher_id: b.staffId }]);
    });

    it('list a row 3.4a let another teacher take', async () => {
      const own = await tutoredClass();
      const holder = await lessons.load.tutorSubjectHolder(north, tutorSubject, [7]);
      const version = await lessons.load.version(north, northYear.year, { startsOn: '2026-10-19' });
      await lessons.load.rowAsBefore({
        branch_id: north,
        version_id: version,
        class_id: own.classId,
        subject_id: tutorSubject,
        teacher_id: holder.staffId,
      });
      const load = (await get(`/api/timetable/versions/${version}/load`).expect(200)).body as {
        rows: { problems: string[] }[];
      };
      expect(load.rows.map((row) => row.problems)).toEqual([['load_tutor_row_teacher']]);
    });
  });

  // .claude/rules/api.md: two changes of one class's Tutors at one moment, in
  // both orders; the held side writes its Tutor row and runs its follow, as
  // its route does, and the outcome depends on that write.
  describe('at the same moment', () => {
    async function holdOpen(work: (transaction: Transaction) => Promise<void>) {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const done = app
        .get(Transactions)
        .run([north], async (transaction) => {
          await work(transaction);
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await Promise.race([isReady, done]);
      return { release, done };
    }

    async function untilWaiting(): Promise<void> {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const found = await sql<{ waiting: number }>`
          select count(distinct l.pid)::int as waiting
          from pg_locks l join pg_stat_activity a on a.pid = l.pid
          where a.datname = current_database() and not l.granted
        `.execute(database.migrator);
        if ((found.rows[0]?.waiting ?? 0) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Nothing waited for a lock.');
    }

    it('an acting give that waited for an end of the Tutor reads the end', async () => {
      const own = await tutoredClass();
      const a = own.tutor.staffId;
      const inside = await tutorLesson(own.classId, a, '2026-10-21');
      const after = await tutorLesson(own.classId, a, '2026-10-28');
      const acting = await tutorPerson();
      const end = new Date('2026-10-19T00:00:00+05:00');
      // The end route: the row's end, then its follow.
      const held = await holdOpen(async (transaction) => {
        await transaction
          .updateTable('class_tutors')
          .set({ valid_until: end, own_until: end, end_cause: 'ended' })
          .where('id', '=', own.rowId)
          .execute();
        await followTutors(transaction, [own.classId], end);
      });
      const sent = give(own.classId, acting.assignmentId, '2026-10-19', {
        kind: 'acting',
        until: '2026-10-26',
      }).then((response) => response);
      await untilWaiting();
      held.release();
      expect(await held.done).toBeUndefined();
      expect((await sent).status).toBe(201);
      // Without the end, the give's follow would give 28 October back to A.
      expect(await teachersOf([inside, after])).toEqual([acting.staffId, null]);
    });

    it('an end that waited for an acting give reads the acting row', async () => {
      const own = await tutoredClass();
      const a = own.tutor.staffId;
      const inside = await tutorLesson(own.classId, a, '2026-10-21');
      const after = await tutorLesson(own.classId, a, '2026-10-28');
      const acting = await tutorPerson();
      const from = new Date('2026-10-19T00:00:00+05:00');
      // The give route: the acting row, then its follow.
      const held = await holdOpen(async (transaction) => {
        await transaction
          .insertInto('class_tutors')
          .values({
            branch_id: north,
            class_id: own.classId,
            assignment_id: acting.assignmentId,
            kind: 'acting',
            valid_from: from,
            own_until: new Date('2026-10-26T00:00:00+05:00'),
            given_by: (
              await database.migrator
                .selectFrom('accounts')
                .select('id')
                .orderBy('id')
                .executeTakeFirstOrThrow()
            ).id,
          })
          .execute();
        await followTutors(transaction, [own.classId], from);
      });
      const sent = endRow(own.classId, own.rowId, '2026-10-19').then((response) => response);
      await untilWaiting();
      held.release();
      expect(await held.done).toBeUndefined();
      expect((await sent).status).toBe(200);
      // Without the acting row, the end's follow would set 21 October to
      // need a teacher.
      expect(await teachersOf([inside, after])).toEqual([acting.staffId, null]);
    });

    /** The account a held give names as its giver. */
    const giver = async () =>
      (
        await database.migrator
          .selectFrom('accounts')
          .select('id')
          .orderBy('id')
          .executeTakeFirstOrThrow()
      ).id;

    /** The give route held open: the Tutor row, then its follow. */
    const heldGive = async (
      classId: string,
      assignmentId: string,
      from: Date,
      extra: { kind?: 'tutor' | 'acting'; until?: Date } = {},
    ) => {
      const givenBy = await giver();
      return holdOpen(async (transaction) => {
        await transaction
          .insertInto('class_tutors')
          .values({
            branch_id: north,
            class_id: classId,
            assignment_id: assignmentId,
            kind: extra.kind ?? 'tutor',
            valid_from: from,
            own_until: extra.until ?? null,
            given_by: givenBy,
          })
          .execute();
        await followTutors(transaction, [classId], from);
      });
    };

    /** A class whose Tutor A ends on 26 October, written by the migrator. */
    async function endingClass() {
      const own = await tutoredClass();
      const end = new Date('2026-10-26T00:00:00+05:00');
      await database.migrator
        .updateTable('class_tutors')
        .set({ valid_until: end, own_until: end, end_cause: 'ended' })
        .where('id', '=', own.rowId)
        .execute();
      return own;
    }

    const claimsOf = (ids: readonly string[]) =>
      database.migrator
        .selectFrom('time_claims')
        .select(['lesson_id', 'teacher_id'])
        .where('lesson_id', 'in', ids)
        .where('kind', '=', 'lesson')
        .orderBy('lesson_id')
        .execute();

    // A lesson given to the new Tutor by another transaction at the same
    // moment is not seen by the follow's clash check: the time-claim
    // exclusion keeps the Tutor from being booked twice. Task 5.5b-1: a new
    // lesson is written only by a publish, which holds the year's versions
    // that a follow locks first (decision 11), so the write at the same
    // moment is a change of a stored lesson's teacher, as a substitution is.
    it('a give that waited for a lesson write of the new Tutor sets the clashing lesson to need a teacher', async () => {
      const own = await endingClass();
      const a = own.tutor.staffId;
      const tutored = await tutorLesson(own.classId, a, '2026-10-28');
      const b = await tutorPerson();
      const other = await newClass();
      const write = await lessonWriter({
        classId: other,
        date: '2026-10-28',
        start: '09:00',
        end: '09:45',
        teacherId: null,
        subjectId: subject,
      });
      const written = await app.get(Transactions).run([north], write);
      const held = await holdOpen(async (transaction) => {
        await transaction
          .updateTable('lessons')
          .set({ teacher_id: b.staffId })
          .where('id', '=', written)
          .execute();
      });
      const sent = give(own.classId, b.assignmentId, '2026-10-26').then((response) => response);
      await untilWaiting();
      held.release();
      expect(await held.done).toBeUndefined();
      expect((await sent).status).toBe(201);
      expect(await teacherOf(tutored)).toBeNull();
      expect(await claimsOf([tutored, written])).toEqual(
        [
          { lesson_id: tutored, teacher_id: null },
          { lesson_id: written, teacher_id: b.staffId },
        ].sort((x, y) => x.lesson_id.localeCompare(y.lesson_id)),
      );
      expect((await entry('class.tutor_given', own.classId)).new_value).toMatchObject({
        tutorLessons: { moved: [], needsTeacher: [{ lessonId: tutored, from: a }] },
      });
    });

    it('a lesson write of the new Tutor that waited for a give is refused by the exclusion', async () => {
      const own = await endingClass();
      const a = own.tutor.staffId;
      const tutored = await tutorLesson(own.classId, a, '2026-10-28');
      const b = await tutorPerson();
      const other = await newClass();
      const write = await lessonWriter({
        classId: other,
        date: '2026-10-28',
        start: '09:00',
        end: '09:45',
        teacherId: b.staffId,
        subjectId: subject,
      });
      const held = await heldGive(
        own.classId,
        b.assignmentId,
        new Date('2026-10-26T00:00:00+05:00'),
      );
      const sent = app
        .get(Transactions)
        .run([north], write)
        .catch((error: unknown) => error as { constraint?: string });
      await untilWaiting();
      held.release();
      expect(await held.done).toBeUndefined();
      expect(await sent).toMatchObject({ constraint: 'time_claims_teacher_excl' });
      expect(await teacherOf(tutored)).toBe(b.staffId);
      expect(
        await database.migrator
          .selectFrom('lessons')
          .select('id')
          .where('class_id', '=', other)
          .execute(),
      ).toEqual([]);
    });

    // A main give from 26 October and an acting give from 19 October to 2
    // November: the follow that commits last reads the other's row after its
    // lessons' locks. 21 October is the acting Tutor's alone, 28 October the
    // acting Tutor's over the main one, 11 November the main Tutor's.
    it('an acting give that waited for a main give reads the main row', async () => {
      const own = await endingClass();
      const a = own.tutor.staffId;
      const ids: string[] = [];
      for (const date of ['2026-10-21', '2026-10-28', '2026-11-11']) {
        ids.push(await tutorLesson(own.classId, a, date));
      }
      const main = await tutorPerson();
      const acting = await tutorPerson();
      const held = await heldGive(
        own.classId,
        main.assignmentId,
        new Date('2026-10-26T00:00:00+05:00'),
      );
      const sent = give(own.classId, acting.assignmentId, '2026-10-19', {
        kind: 'acting',
        until: '2026-11-09',
      }).then((response) => response);
      await untilWaiting();
      held.release();
      expect(await held.done).toBeUndefined();
      expect((await sent).status).toBe(201);
      // Without the main row, the acting give's follow would set 11 November
      // to need a teacher.
      expect(await teachersOf(ids)).toEqual([acting.staffId, acting.staffId, main.staffId]);
    });

    it('a main give that waited for an acting give reads the acting row', async () => {
      const own = await endingClass();
      const a = own.tutor.staffId;
      const ids: string[] = [];
      for (const date of ['2026-10-21', '2026-10-28', '2026-11-11']) {
        ids.push(await tutorLesson(own.classId, a, date));
      }
      const main = await tutorPerson();
      const acting = await tutorPerson();
      const held = await heldGive(
        own.classId,
        acting.assignmentId,
        new Date('2026-10-19T00:00:00+05:00'),
        { kind: 'acting', until: new Date('2026-11-09T00:00:00+05:00') },
      );
      const sent = give(own.classId, main.assignmentId, '2026-10-26').then((response) => response);
      await untilWaiting();
      held.release();
      expect(await held.done).toBeUndefined();
      expect((await sent).status).toBe(201);
      // Without the acting row, the main give's follow would give 28 October
      // to the main Tutor.
      expect(await teachersOf(ids)).toEqual([acting.staffId, acting.staffId, main.staffId]);
    });
  });

  describe('the readings in the database', () => {
    it('class_tutor_on agrees with tutorAt at the end of the day', async () => {
      const own = await tutoredClass();
      const acting = await tutorPerson();
      await lessons.load.classes.tutorRow(north, own.classId, acting.assignmentId, {
        kind: 'acting',
        from: new Date('2026-10-20T13:00:00+05:00'),
        until: new Date('2026-10-23T00:00:00+05:00'),
      });
      const rows =
        (
          await app
            .get(Transactions)
            .run([north], (transaction) => readTutorRows(transaction, [own.classId]))
        ).get(own.classId) ?? [];
      for (const day of ['2026-10-19', '2026-10-20', '2026-10-22', '2026-10-23']) {
        const found = await sql<{ id: string | null }>`
          select class_tutor_on(${own.classId}::uuid, ${day}::date) as id
        `.execute(database.migrator);
        const dayEnd = new Date(at(day, '00:00').getTime() + 24 * 3_600_000 - 1);
        expect([day, found.rows[0]?.id]).toEqual([day, tutorAt(rows, dayEnd)]);
      }
    });

    it('teacher_claims_elsewhere gives moments and branches only, for a teacher of the branch', async () => {
      const b = await tutorPerson([south]);
      const southClass = await newClass(south);
      await lesson({
        classId: southClass,
        date: '2026-10-27',
        start: '09:00',
        end: '09:45',
        teacherId: b.staffId,
        subjectId: subject,
        branch: south,
      });
      const found = await app.get(Transactions).run([north], (transaction) =>
        sql<Record<string, unknown>>`
          select * from teacher_claims_elsewhere(
            ${north}::uuid, ${b.staffId}::uuid,
            ${at('2026-10-27', '00:00')}::timestamptz, ${at('2026-10-28', '00:00')}::timestamptz
          )
        `.execute(transaction),
      );
      expect(found.rows).toEqual([
        {
          starts_at: at('2026-10-27', '09:00'),
          ends_at: at('2026-10-27', '09:45'),
          branch_id: south,
        },
      ]);
      const stranger = await lessons.load.classes.person(south, ['uz']);
      const refused = await app
        .get(Transactions)
        .run([north], (transaction) =>
          sql`
            select * from teacher_claims_elsewhere(
              ${north}::uuid, ${stranger.staffId}::uuid,
              ${at('2026-10-27', '00:00')}::timestamptz, ${at('2026-10-28', '00:00')}::timestamptz
            )
          `.execute(transaction),
        )
        .catch((error: unknown) => error as { constraint?: string });
      expect(refused).toMatchObject({ constraint: 'teacher_claims_branch' });
      // A branch outside the transaction, for a teacher linked to it.
      const outside = await app
        .get(Transactions)
        .run([north], (transaction) =>
          sql`
            select * from teacher_claims_elsewhere(
              ${south}::uuid, ${b.staffId}::uuid,
              ${at('2026-10-27', '00:00')}::timestamptz, ${at('2026-10-28', '00:00')}::timestamptz
            )
          `.execute(transaction),
        )
        .catch((error: unknown) => error as { constraint?: string });
      expect(outside).toMatchObject({ constraint: 'teacher_claims_branch' });
    });
  });
});
