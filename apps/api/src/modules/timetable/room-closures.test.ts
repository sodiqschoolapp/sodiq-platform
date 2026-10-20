import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  attentionSchema,
  dayAnswerSchema,
  roomClosureLessonsSchema,
  roomClosureListSchema,
  roomClosureMoveAnswerSchema,
  roomClosureSchema,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayTemplatesKit,
  MONDAY,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const ok = (response: Response, status = 200) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response;
};

/** The rule codes of a refusal's details. */
const rulesOf = (response: Response): string[] =>
  ((response.body as { error: { details?: { code: string }[] } }).error.details ?? []).map((one) => one.code);

/** The quarters of the year 2026-09-01 to 2027-05-31, dated. */
const QUARTERS = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
] as const;

/** A moment of a school date at a clock time in Tashkent (+05:00). */
const at = (date: string, time: string): Date => new Date(`${date}T${time}:00+05:00`);

const TODAY = '2026-10-10';
const FRIDAY_BEFORE = '2026-10-09';
const NEXT_MONDAY = '2026-10-19';
const NEXT_FRIDAY = '2026-10-23';
const MONDAY_AFTER = '2026-10-26';
const LAST_FRIDAY = '2026-10-30';
/** The first Monday of the second quarter. */
const NOVEMBER_MONDAY = '2026-11-09';

// All names are invented. Task 5.7a-2b, pull request #187: room closures
// (docs/spec/edge-cases/timetable.md, After publishing: "A laboratory is
// under repair for three weeks. A room closure has a start, an end and a
// reason. Lessons in the range go to 'needs a room', with 'move all to room R
// for the period'. The pattern is unchanged and the lessons return
// afterwards."; docs/spec/06-timetable.md, How surprises are prevented: "No
// lesson without a teacher or room. When ... a room is closed, the system
// lists the future lessons that depend on them ... or marks them 'needs a
// room' on the Academic Vice Principal's home page"). The clock stands at
// 23:55 on Saturday 10 October 2026 in Tashkent, unless a test moves it.
describe('room closures', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;

  const create = (branch: string, body: object, cookie = t.admin) =>
    t.post('/api/timetable/room-closures', branch, body, cookie);
  const edit = (branch: string, id: string, body: object, cookie = t.admin) =>
    t.patch(`/api/timetable/room-closures/${id}`, branch, body, cookie);
  const withdraw = (branch: string, id: string, cookie = t.admin) =>
    t.post(`/api/timetable/room-closures/${id}/withdraw`, branch, {}, cookie);
  const move = (branch: string, id: string, body: object, cookie = t.admin) =>
    t.post(`/api/timetable/room-closures/${id}/move`, branch, body, cookie);
  const list = (branch: string, query = '', cookie = t.admin) =>
    t.get(`/api/timetable/room-closures${query}`, branch, cookie);
  const lessonsOf = (branch: string, id: string, cookie = t.admin) =>
    t.get(`/api/timetable/room-closures/${id}/lessons`, branch, cookie);
  const attention = async (branch: string, cookie = t.admin) =>
    attentionSchema.parse(ok(await t.get('/api/timetable/attention', branch, cookie)).body);
  const day = async (branch: string, classId: string, date: string, cookie = t.admin) =>
    dayAnswerSchema.parse(
      ok(await t.get(`/api/timetable/day?date=${date}&classId=${classId}`, branch, cookie)).body,
    );

  /** A one-day change, which takes a request key. */
  const keyed = (path: string, branch: string, body: object, cookie = t.admin) =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send(body);

  const entered = async (branch: string, body: object, cookie = t.admin) =>
    roomClosureSchema.parse(ok(await create(branch, body, cookie), 201).body);

  /** Hours of a person in the branch from 1 September, all day on every weekday. */
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
    slotPosition = 1,
    double = false,
  ) => {
    const placed = await t.post(`/api/timetable/versions/${version}/pattern`, branch, {
      loadRowId,
      weekday,
      slotPosition,
      ...(double ? { double: true } : {}),
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  };

  /**
   * A new branch with a year of four dated quarters, a day of three lessons
   * from 08:00 on every weekday, a class of grade 7 in `room` and a version
   * published from Monday 12 October: maths of the class on Monday in the
   * first lesson (a double of the first and second lessons with `double`),
   * and with `busy` another class's maths in `otherRoom` at the same time.
   */
  async function scene(input: { double?: boolean; busy?: boolean } = {}) {
    const branch = await t.newBranch();
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
    const subject = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const room = await load.classes.room(branch);
    const otherRoom = await load.classes.room(branch);
    const thirdRoom = await load.classes.room(branch);
    const classId = await load.classes.schoolClass(branch, year, { grade: 7, room });
    const teacher = await load.teacher(branch, { subjects: [{ subject, grades: [7] }] });
    await hours(branch, teacher.staffId);
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
      room_id: room,
      lessons_per_week: input.double === true ? 2 : 1,
      double_lessons: input.double === true,
    });
    await placeAt(branch, version, rowId, 1, 1, input.double === true);
    let otherClass: string | null = null;
    if (input.busy === true) {
      otherClass = await load.classes.schoolClass(branch, year, { grade: 7, room: otherRoom });
      const other = await load.teacher(branch, { subjects: [{ subject, grades: [7] }] });
      await hours(branch, other.staffId);
      const otherRow = await load.row({
        branch_id: branch,
        version_id: version,
        class_id: otherClass,
        subject_id: subject,
        teacher_id: other.staffId,
        room_id: otherRoom,
        lessons_per_week: 1,
      });
      await placeAt(branch, version, otherRow, 1);
    }
    const confirmed = await t.post(`/api/timetable/versions/${version}/templates/confirm`, branch);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    await load.freeEditLock(version);
    const published = await request(t.kit.server)
      .post(`/api/timetable/versions/${version}/publish`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ startsOn: MONDAY });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    return {
      branch,
      year,
      subject,
      classId,
      otherClass,
      teacher,
      version,
      room,
      otherRoom,
      thirdRoom,
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /** The stored lessons of the scene's class on a date, by start. */
  const lessonsOn = (s: Scene, date: string) =>
    t.database.migrator
      .selectFrom('lessons')
      .selectAll()
      .where('branch_id', '=', s.branch)
      .where('class_id', '=', s.classId)
      .where('subject_id', '=', s.subject)
      .where('lesson_date', '=', date)
      .orderBy('starts_at')
      .execute();

  /** What the day page says of the room of each of the class's lessons on a date, by start. */
  const roomsOn = async (s: Scene, date: string, cookie = t.admin) =>
    (await day(s.branch, s.classId, date, cookie)).lessons
      .filter((one) => one.subject.id === s.subject)
      .sort((a, b) => a.start - b.start)
      .map((one) => ({ room: one.room?.id ?? null, roomOut: one.roomOut }));

  /** A closure written by the migrator, past the route's rule on the past. */
  async function stored(
    branch: string,
    roomId: string,
    days: { startsOn: string; endsOn: string },
    moments: { from: Date; until: Date },
  ): Promise<string> {
    const account = await load.classes.account();
    const row = await t.database.migrator
      .insertInto('room_closures')
      .values({
        branch_id: branch,
        room_id: roomId,
        starts_on: days.startsOn,
        ends_on: days.endsOn,
        applies_from: moments.from,
        applies_until: moments.until,
        reason: 'Repairs',
        created_by: account,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /**
   * Runs `work` with the clock at `moment` and an Academic Vice Principal of
   * the branch signed in then; the clock goes back to the start afterwards.
   */
  async function asViceAt(branch: string, moment: Date, work: (cookie: string) => Promise<void>) {
    t.clock.set(moment);
    try {
      const browser = await t.kit.completeSession('Lola', 'Rahimova');
      await t.kit.giveRole(browser.account.id, {
        role: 'academic_vice_principal',
        branchId: branch,
      });
      await work(browser.cookie);
    } finally {
      t.clock.set(START);
    }
  }

  /**
   * Every row of the tables the routes write, in every branch
   * (`.claude/rules/api.md`: `rowsOf` of the tables a route writes).
   */
  const everything = () =>
    Promise.all([
      t.database.migrator.selectFrom('room_closures').selectAll().orderBy('id').execute(),
      t.database.migrator
        .selectFrom('lessons')
        .select(['id', 'room_id', 'teacher_id', 'cancel_cause'])
        .orderBy('id')
        .execute(),
      t.database.migrator.selectFrom('lesson_day_changes').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('notifications').select('id').orderBy('id').execute(),
      t.database.migrator.selectFrom('audit_log').select('id').orderBy('id').execute(),
    ]);

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('who may', () => {
    it('lets the Academic Vice Principal enter, change, withdraw and move, and the Principal read', async () => {
      const s = await scene();
      await t.kit.giveRole(
        (
          await t.database.migrator
            .selectFrom('assignments')
            .select('account_id')
            .where('id', '=', t.viceAssignment)
            .executeTakeFirstOrThrow()
        ).account_id,
        { role: 'academic_vice_principal', branchId: s.branch },
      );
      const closure = await entered(
        s.branch,
        { roomId: s.room, startsOn: NEXT_MONDAY, endsOn: NEXT_FRIDAY, reason: 'Repairs' },
        t.vicePrincipal,
      );
      expect(closure).toMatchObject({
        state: 'planned',
        canEdit: true,
        canWithdraw: true,
        room: { id: s.room },
      });
      const [entry] = await t.entries('room_closure.create', closure.id);
      expect(entry).toMatchObject({
        branch_id: s.branch,
        request_id: expect.any(String) as unknown,
      });
      const changed = roomClosureSchema.parse(
        ok(
          await edit(
            s.branch,
            closure.id,
            { startsOn: NEXT_MONDAY, endsOn: LAST_FRIDAY },
            t.vicePrincipal,
          ),
        ).body,
      );
      expect(changed.endsOn).toBe(LAST_FRIDAY);
      const moved = roomClosureMoveAnswerSchema.parse(
        ok(
          await move(
            s.branch,
            closure.id,
            { roomId: s.otherRoom, reason: 'Repairs' },
            t.vicePrincipal,
          ),
        ).body,
      );
      expect(moved.moved).toBe(2);
      expect(await t.entries('room_closure.edit', closure.id)).toHaveLength(1);
      expect(await t.entries('room_closure.move', closure.id)).toHaveLength(1);
      const gone = roomClosureSchema.parse(
        ok(await withdraw(s.branch, closure.id, t.vicePrincipal)).body,
      );
      expect(gone.state).toBe('withdrawn');
      expect(await t.entries('room_closure.withdraw', closure.id)).toHaveLength(1);
    });

    it('refuses every write to the Principal, the Teacher, a Head Teacher and a Tutor, with nothing written; the Principal reads', async () => {
      const room = await load.classes.room(t.north);
      const otherRoom = await load.classes.room(t.north);
      const closure = await entered(t.north, {
        roomId: room,
        startsOn: '2026-11-09',
        endsOn: '2026-11-13',
        reason: 'Repairs',
      });
      const headTeacher = await t.kit.fullSession('Nodira', 'Qodirova');
      await t.kit.giveRole(headTeacher.account.id, { role: 'head_teacher', branchId: t.north });
      const tutor = await t.kit.fullSession('Sardor', 'Toshmatov');
      await t.kit.giveRole(tutor.account.id, { role: 'tutor', branchId: t.north });
      const before = await everything();
      for (const cookie of [t.principal, t.teacher, headTeacher.cookie, tutor.cookie]) {
        refusedWith(
          await create(
            t.north,
            { roomId: otherRoom, startsOn: '2026-12-01', endsOn: '2026-12-02', reason: 'Paint' },
            cookie,
          ),
          403,
          'permission_denied',
        );
        refusedWith(
          await edit(t.north, closure.id, { startsOn: '2026-11-10', endsOn: '2026-11-13' }, cookie),
          403,
          'permission_denied',
        );
        refusedWith(await withdraw(t.north, closure.id, cookie), 403, 'permission_denied');
        refusedWith(
          await move(t.north, closure.id, { roomId: otherRoom, reason: 'Repairs' }, cookie),
          403,
          'permission_denied',
        );
      }
      for (const cookie of [t.teacher, headTeacher.cookie, tutor.cookie]) {
        refusedWith(await list(t.north, '', cookie), 403, 'permission_denied');
        refusedWith(await lessonsOf(t.north, closure.id, cookie), 403, 'permission_denied');
      }
      expect(await everything()).toEqual(before);
      const listed = roomClosureListSchema.parse(ok(await list(t.north, '', t.principal)).body);
      expect(listed.closures.map((one) => one.id)).toContain(closure.id);
      ok(await lessonsOf(t.north, closure.id, t.principal));
    });

    it('answers 404 for another branch’s closure and an unknown one, and for a room of another branch or unknown, with nothing written', async () => {
      const southRoom = await load.classes.room(t.south);
      const other = await entered(t.south, {
        roomId: southRoom,
        startsOn: '2026-11-09',
        endsOn: '2026-11-13',
        reason: 'Repairs',
      });
      const own = await entered(t.north, {
        roomId: await load.classes.room(t.north),
        startsOn: '2026-11-16',
        endsOn: '2026-11-20',
        reason: 'Repairs',
      });
      const northRoom = await load.classes.room(t.north);
      const before = await everything();
      for (const id of [other.id, UNKNOWN]) {
        refusedWith(
          await edit(t.north, id, { startsOn: '2026-11-10', endsOn: '2026-11-13' }),
          404,
          'not_found',
        );
        refusedWith(await withdraw(t.north, id), 404, 'not_found');
        refusedWith(await lessonsOf(t.north, id), 404, 'not_found');
        refusedWith(
          await move(t.north, id, { roomId: northRoom, reason: 'Repairs' }),
          404,
          'not_found',
        );
      }
      for (const roomId of [southRoom, UNKNOWN]) {
        refusedWith(
          await create(t.north, {
            roomId,
            startsOn: '2026-12-01',
            endsOn: '2026-12-02',
            reason: 'Paint',
          }),
          404,
          'not_found',
        );
        refusedWith(await move(t.north, own.id, { roomId, reason: 'Repairs' }), 404, 'not_found');
      }
      expect(await everything()).toEqual(before);
      expect(
        roomClosureListSchema
          .parse(ok(await list(t.north, '?state=all')).body)
          .closures.map((one) => one.id),
      ).not.toContain(other.id);
    });

    it('refuses an empty reason, no last day and a last day before the first', async () => {
      const room = await load.classes.room(t.north);
      for (const body of [
        { roomId: room, startsOn: '2026-12-01', endsOn: '2026-12-02', reason: ' ' },
        { roomId: room, startsOn: '2026-12-01', endsOn: null, reason: 'Paint' },
        { roomId: room, startsOn: '2026-12-02', endsOn: '2026-12-01', reason: 'Paint' },
      ]) {
        refusedWith(await create(t.north, body), 400, 'validation_failed');
      }
    });
  });

  describe('the rules of a save (decision 4)', () => {
    it('refuses a first day before today, a closed room, and a closure that meets another of the room, naming it, on a create and a change', async () => {
      const room = await load.classes.room(t.north);
      refusedWith(
        await create(t.north, {
          roomId: room,
          startsOn: FRIDAY_BEFORE,
          endsOn: NEXT_FRIDAY,
          reason: 'Repairs',
        }),
        409,
        'room_closure_past',
      );
      const closedRoom = await load.classes.room(t.north, 'closed');
      refusedWith(
        await create(t.north, {
          roomId: closedRoom,
          startsOn: NEXT_MONDAY,
          endsOn: NEXT_FRIDAY,
          reason: 'Repairs',
        }),
        422,
        'room_closure_room',
      );
      const first = await entered(t.north, {
        roomId: room,
        startsOn: NEXT_MONDAY,
        endsOn: NEXT_FRIDAY,
        reason: 'Repairs',
      });
      const overlap = await create(t.north, {
        roomId: room,
        startsOn: NEXT_FRIDAY,
        endsOn: LAST_FRIDAY,
        reason: 'Paint',
      });
      refusedWith(overlap, 409, 'room_closure_overlap');
      expect((overlap.body as { error: { details: unknown[] } }).error.details).toEqual([
        expect.objectContaining({ recordId: first.id, day: NEXT_MONDAY }),
      ]);
      const second = await entered(t.north, {
        roomId: room,
        startsOn: MONDAY_AFTER,
        endsOn: LAST_FRIDAY,
        reason: 'Paint',
      });
      refusedWith(
        await edit(t.north, second.id, { startsOn: NEXT_FRIDAY, endsOn: LAST_FRIDAY }),
        409,
        'room_closure_overlap',
      );
    });

    it('refuses a change of the first day of a started closure, an end before yesterday, a last day before the first, and a withdraw after the start', async () => {
      const room = await load.classes.room(t.north);
      const id = await stored(
        t.north,
        room,
        { startsOn: FRIDAY_BEFORE, endsOn: NEXT_FRIDAY },
        { from: at(FRIDAY_BEFORE, '00:00'), until: at('2026-10-24', '00:00') },
      );
      refusedWith(
        await edit(t.north, id, { startsOn: TODAY, endsOn: NEXT_FRIDAY }),
        409,
        'room_closure_past',
      );
      refusedWith(
        await edit(t.north, id, { startsOn: FRIDAY_BEFORE, endsOn: '2026-10-08' }),
        409,
        'room_closure_past',
      );
      refusedWith(await withdraw(t.north, id), 409, 'room_closure_past');
      // A planned closure whose last day would be the day before its first.
      const planned = await entered(t.north, {
        roomId: await load.classes.room(t.north),
        startsOn: NEXT_MONDAY,
        endsOn: NEXT_FRIDAY,
        reason: 'Repairs',
      });
      refusedWith(
        await edit(t.north, planned.id, { startsOn: NEXT_MONDAY, endsOn: '2026-10-18' }),
        409,
        'room_closure_past',
      );
    });

    it('refuses any change, withdraw or move of a closure that has ended, and of a withdrawn one', async () => {
      const room = await load.classes.room(t.north);
      const otherRoom = await load.classes.room(t.north);
      const ended = await stored(
        t.north,
        room,
        { startsOn: '2026-10-05', endsOn: FRIDAY_BEFORE },
        { from: at('2026-10-05', '00:00'), until: at(TODAY, '00:00') },
      );
      refusedWith(
        await edit(t.north, ended, { startsOn: '2026-10-05', endsOn: NEXT_FRIDAY }),
        409,
        'room_closure_ended',
      );
      refusedWith(await withdraw(t.north, ended), 409, 'room_closure_ended');
      refusedWith(
        await move(t.north, ended, { roomId: otherRoom, reason: 'Repairs' }),
        409,
        'room_closure_ended',
      );
      const planned = await entered(t.north, {
        roomId: room,
        startsOn: NEXT_MONDAY,
        endsOn: NEXT_FRIDAY,
        reason: 'Repairs',
      });
      ok(await withdraw(t.north, planned.id));
      refusedWith(
        await edit(t.north, planned.id, { startsOn: NEXT_MONDAY, endsOn: LAST_FRIDAY }),
        409,
        'room_closure_withdrawn',
      );
      refusedWith(await withdraw(t.north, planned.id), 409, 'room_closure_withdrawn');
      refusedWith(
        await move(t.north, planned.id, { roomId: otherRoom, reason: 'Repairs' }),
        409,
        'room_closure_withdrawn',
      );
    });

    it('lists the open closures by default and every one with state=all', async () => {
      const room = await load.classes.room(t.north);
      const open = await entered(t.north, {
        roomId: room,
        startsOn: '2026-12-07',
        endsOn: '2026-12-11',
        reason: 'Repairs',
      });
      const ended = await stored(
        t.north,
        room,
        { startsOn: '2026-10-05', endsOn: FRIDAY_BEFORE },
        { from: at('2026-10-05', '00:00'), until: at(TODAY, '00:00') },
      );
      const ids = async (query: string) =>
        roomClosureListSchema
          .parse(ok(await list(t.north, query)).body)
          .closures.map((one) => one.id);
      expect(await ids('')).toContain(open.id);
      expect(await ids('')).not.toContain(ended);
      expect(await ids('?state=all')).toEqual(expect.arrayContaining([open.id, ended]));
    });
  });

  describe('the lessons that need a room (decisions 1, 2 and 7)', () => {
    it('lists the room’s lessons inside the closure, keeping their room, and gives them back when shortened and withdrawn', async () => {
      const s = await scene();
      const closure = await entered(s.branch, {
        roomId: s.room,
        startsOn: NEXT_MONDAY,
        endsOn: LAST_FRIDAY,
        reason: 'Repairs',
      });
      const home = await attention(s.branch);
      expect(home.needsRoom).toEqual([
        {
          cause: 'closure',
          room: { id: s.room, name: expect.any(String) as unknown },
          closure: { id: closure.id, startsOn: NEXT_MONDAY, endsOn: LAST_FRIDAY },
          lessons: 2,
          firstDate: NEXT_MONDAY,
          lastDate: MONDAY_AFTER,
        },
      ]);
      expect(await roomsOn(s, MONDAY)).toEqual([{ room: s.room, roomOut: null }]);
      expect(await roomsOn(s, NEXT_MONDAY)).toEqual([{ room: s.room, roomOut: 'closure' }]);
      expect(await roomsOn(s, NOVEMBER_MONDAY)).toEqual([{ room: s.room, roomOut: null }]);
      const lessons = roomClosureLessonsSchema.parse(
        ok(await lessonsOf(s.branch, closure.id)).body,
      ).lessons;
      expect(lessons.map((one) => [one.date, one.needsRoom, one.state])).toEqual([
        [NEXT_MONDAY, true, 'upcoming'],
        [MONDAY_AFTER, true, 'upcoming'],
      ]);
      // A closure writes no lesson.
      expect((await lessonsOn(s, NEXT_MONDAY))[0]?.room_id).toBe(s.room);
      ok(await edit(s.branch, closure.id, { startsOn: NEXT_MONDAY, endsOn: NEXT_FRIDAY }));
      expect((await attention(s.branch)).needsRoom).toEqual([
        expect.objectContaining({ lessons: 1, lastDate: NEXT_MONDAY }),
      ]);
      ok(await withdraw(s.branch, closure.id));
      expect((await attention(s.branch)).needsRoom).toEqual([]);
      expect(await roomsOn(s, NEXT_MONDAY)).toEqual([{ room: s.room, roomOut: null }]);
    });

    it('leaves out a lesson of another room and a cancelled one', async () => {
      const s = await scene({ busy: true });
      await entered(s.branch, {
        roomId: s.room,
        startsOn: NEXT_MONDAY,
        endsOn: NEXT_FRIDAY,
        reason: 'Repairs',
      });
      const [lesson] = await lessonsOn(s, NEXT_MONDAY);
      expect((await attention(s.branch)).needsRoom).toEqual([
        expect.objectContaining({ lessons: 1 }),
      ]);
      ok(
        await keyed(`/api/timetable/lessons/${lesson?.id ?? ''}/cancel`, s.branch, {
          reason: 'Trip',
        }),
      );
      expect((await attention(s.branch)).needsRoom).toEqual([]);
    });

    it('starts a closure entered today at the save: a lesson that started is not listed, a later one is (decision 4)', async () => {
      const s = await scene({ double: true });
      await asViceAt(s.branch, at(NEXT_MONDAY, '08:30'), async (cookie) => {
        const closure = await entered(
          s.branch,
          { roomId: s.room, startsOn: NEXT_MONDAY, endsOn: NEXT_MONDAY, reason: 'Leak' },
          cookie,
        );
        const lessons = roomClosureLessonsSchema.parse(
          ok(await lessonsOf(s.branch, closure.id, cookie)).body,
        ).lessons;
        // The first half started at 08:00, before the save: outside the closure.
        expect(lessons.map((one) => [one.start, one.needsRoom])).toEqual([[535, true]]);
        expect((await attention(s.branch, cookie)).needsRoom).toEqual([
          expect.objectContaining({ lessons: 1, firstDate: NEXT_MONDAY }),
        ]);
      });
    });

    it('lists a started lesson no more: it is history (decision 2)', async () => {
      const s = await scene();
      await stored(
        s.branch,
        s.room,
        { startsOn: NEXT_MONDAY, endsOn: NEXT_FRIDAY },
        { from: at(NEXT_MONDAY, '00:00'), until: at('2026-10-24', '00:00') },
      );
      await asViceAt(s.branch, at(NEXT_MONDAY, '09:00'), async (cookie) => {
        expect((await attention(s.branch, cookie)).needsRoom).toEqual([]);
        expect(await roomsOn(s, NEXT_MONDAY, cookie)).toEqual([{ room: s.room, roomOut: null }]);
      });
    });

    it('lists the lessons of a room under repair or closed by its status, and gives them back once in use (decision 7)', async () => {
      const s = await scene();
      for (const status of ['under_repair', 'closed'] as const) {
        await t.database.migrator
          .updateTable('rooms')
          .set({ status })
          .where('id', '=', s.room)
          .execute();
        const home = await attention(s.branch);
        expect(home.needsRoom).toEqual([
          expect.objectContaining({ cause: status, closure: null, firstDate: MONDAY }),
        ]);
        expect(await roomsOn(s, MONDAY)).toEqual([{ room: s.room, roomOut: status }]);
      }
      await t.database.migrator
        .updateTable('rooms')
        .set({ status: 'in_use' })
        .where('id', '=', s.room)
        .execute();
      expect((await attention(s.branch)).needsRoom).toEqual([]);
    });

    it('shows the Principal the rows and the day page’s mark', async () => {
      const s = await scene();
      await entered(s.branch, {
        roomId: s.room,
        startsOn: NEXT_MONDAY,
        endsOn: NEXT_FRIDAY,
        reason: 'Repairs',
      });
      const principal = await t.kit.fullSession('Kamola', 'Yusupova');
      await t.kit.giveRole(principal.account.id, { role: 'principal', branchId: s.branch });
      expect((await attention(s.branch, principal.cookie)).needsRoom).toHaveLength(1);
      expect(await roomsOn(s, NEXT_MONDAY, principal.cookie)).toEqual([
        { room: s.room, roomOut: 'closure' },
      ]);
    });
  });

  describe('move all to room R (decision 6, the done-when)', () => {
    it('moves every lesson of the closure to R for the period, records each change, tells the teacher once, and leaves the lessons after it in the room', async () => {
      const s = await scene();
      const closure = await entered(s.branch, {
        roomId: s.room,
        startsOn: NEXT_MONDAY,
        endsOn: LAST_FRIDAY,
        reason: 'Laboratory under repair',
      });
      expect((await attention(s.branch)).needsRoom).toHaveLength(1);
      const answer = roomClosureMoveAnswerSchema.parse(
        ok(await move(s.branch, closure.id, { roomId: s.otherRoom, reason: 'Repairs' })).body,
      );
      expect(answer.moved).toBe(2);
      expect((await attention(s.branch)).needsRoom).toEqual([]);
      expect(await roomsOn(s, NEXT_MONDAY)).toEqual([{ room: s.otherRoom, roomOut: null }]);
      expect(await roomsOn(s, MONDAY_AFTER)).toEqual([{ room: s.otherRoom, roomOut: null }]);
      expect(await roomsOn(s, MONDAY)).toEqual([{ room: s.room, roomOut: null }]);
      expect(await roomsOn(s, NOVEMBER_MONDAY)).toEqual([{ room: s.room, roomOut: null }]);
      const changes = await t.database.migrator
        .selectFrom('lesson_day_changes')
        .select(['kind', 'from_room_id', 'to_room_id', 'reason', sql`from_date::text`.as('date')])
        .where('branch_id', '=', s.branch)
        .orderBy('from_date')
        .execute();
      expect(changes).toEqual([
        {
          kind: 'room',
          from_room_id: s.room,
          to_room_id: s.otherRoom,
          reason: 'Repairs',
          date: NEXT_MONDAY,
        },
        {
          kind: 'room',
          from_room_id: s.room,
          to_room_id: s.otherRoom,
          reason: 'Repairs',
          date: MONDAY_AFTER,
        },
      ]);
      const entries = await t.database.migrator
        .selectFrom('audit_log')
        .select(['action', 'old_value', 'new_value'])
        .where('branch_id', '=', s.branch)
        .where('action', '=', 'lesson.room_change')
        .execute();
      expect(entries).toHaveLength(2);
      expect(entries[0]?.new_value).toMatchObject({
        roomId: s.otherRoom,
        reason: 'Repairs',
        roomClosureId: closure.id,
      });
      expect(entries[0]?.old_value).toMatchObject({ roomId: s.room });
      const notices = await t.database.migrator
        .selectFrom('notifications')
        .select('kind')
        .where('account_id', '=', s.teacher.accountId)
        .where('kind', '=', 'timetable.day_changed')
        .execute();
      expect(notices).toHaveLength(1);
      // Nothing is left to move.
      refusedWith(
        await move(s.branch, closure.id, { roomId: s.thirdRoom, reason: 'Repairs' }),
        409,
        'room_closure_nothing',
      );
    });

    it('moves both halves of a double together', async () => {
      const s = await scene({ double: true });
      const closure = await entered(s.branch, {
        roomId: s.room,
        startsOn: NEXT_MONDAY,
        endsOn: NEXT_FRIDAY,
        reason: 'Repairs',
      });
      const answer = roomClosureMoveAnswerSchema.parse(
        ok(await move(s.branch, closure.id, { roomId: s.otherRoom, reason: 'Repairs' })).body,
      );
      expect(answer.moved).toBe(2);
      expect((await lessonsOn(s, NEXT_MONDAY)).map((one) => one.room_id)).toEqual([
        s.otherRoom,
        s.otherRoom,
      ]);
    });

    it('refuses the whole move when one lesson cannot go to R, listing it, with nothing written', async () => {
      const s = await scene({ busy: true });
      const closure = await entered(s.branch, {
        roomId: s.room,
        startsOn: NEXT_MONDAY,
        endsOn: LAST_FRIDAY,
        reason: 'Repairs',
      });
      // R is free on the 26th only: the other class's lesson of the 19th stays in it.
      const [busyOn26] = await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('branch_id', '=', s.branch)
        .where('class_id', '=', s.otherClass ?? '')
        .where('lesson_date', '=', MONDAY_AFTER)
        .execute();
      ok(
        await keyed(`/api/timetable/lessons/${busyOn26?.id ?? ''}/room`, s.branch, {
          roomId: s.thirdRoom,
          reason: 'Swap',
        }),
      );
      const before = await everything();
      const refused = await move(s.branch, closure.id, { roomId: s.otherRoom, reason: 'Repairs' });
      refusedWith(refused, 409, 'room_move_blocked');
      expect(
        (refused.body as { error: { details: { code: string; day: string }[] } }).error.details.map((one) => [
          one.code,
          one.day,
        ]),
      ).toEqual([['room_double', NEXT_MONDAY]]);
      expect(await everything()).toEqual(before);
    });

    it('refuses R the closed room itself (422) and leaves a started lesson where it is', async () => {
      const s = await scene({ double: true });
      const closure = await entered(s.branch, {
        roomId: s.room,
        startsOn: NEXT_MONDAY,
        endsOn: LAST_FRIDAY,
        reason: 'Repairs',
      });
      refusedWith(
        await move(s.branch, closure.id, { roomId: s.room, reason: 'Repairs' }),
        422,
        'room_closure_room',
      );
      await asViceAt(s.branch, at(NEXT_MONDAY, '08:10'), async (cookie) => {
        const answer = roomClosureMoveAnswerSchema.parse(
          ok(await move(s.branch, closure.id, { roomId: s.otherRoom, reason: 'Repairs' }, cookie))
            .body,
        );
        // The double of the 19th has started: only the 26th's moves.
        expect(answer.moved).toBe(2);
      });
      expect((await lessonsOn(s, NEXT_MONDAY)).map((one) => one.room_id)).toEqual([s.room, s.room]);
      expect((await lessonsOn(s, MONDAY_AFTER)).map((one) => one.room_id)).toEqual([
        s.otherRoom,
        s.otherRoom,
      ]);
    });
  });

  describe('the rule room_closed (decisions 5 and 7)', () => {
    it('refuses a one-day room change into a room closed then, and allows it outside the closure', async () => {
      const s = await scene();
      await entered(s.branch, {
        roomId: s.otherRoom,
        startsOn: NEXT_MONDAY,
        endsOn: NEXT_FRIDAY,
        reason: 'Repairs',
      });
      const [inside] = await lessonsOn(s, NEXT_MONDAY);
      const refused = await keyed(`/api/timetable/lessons/${inside?.id ?? ''}/room`, s.branch, {
        roomId: s.otherRoom,
        reason: 'Swap',
      });
      refusedWith(refused, 409, 'day_change_blocked');
      expect(rulesOf(refused)).toContain('room_closed');
      // The free rooms offered leave the closed room out.
      expect(JSON.stringify(refused.body)).not.toContain(`"id":"${s.otherRoom}"`);
      const [outside] = await lessonsOn(s, MONDAY_AFTER);
      ok(
        await keyed(`/api/timetable/lessons/${outside?.id ?? ''}/room`, s.branch, {
          roomId: s.otherRoom,
          reason: 'Swap',
        }),
      );
    });

    it('refuses a one-day room change into a room under repair', async () => {
      const s = await scene();
      await t.database.migrator
        .updateTable('rooms')
        .set({ status: 'under_repair' })
        .where('id', '=', s.otherRoom)
        .execute();
      const [lesson] = await lessonsOn(s, NEXT_MONDAY);
      const refused = await keyed(`/api/timetable/lessons/${lesson?.id ?? ''}/room`, s.branch, {
        roomId: s.otherRoom,
        reason: 'Swap',
      });
      refusedWith(refused, 409, 'day_change_blocked');
      expect(rulesOf(refused).filter((code) => code !== 'room_free')).toEqual(['room_closed']);
    });

    it('refuses a restore of a lesson into its room closed then', async () => {
      const s = await scene();
      const [lesson] = await lessonsOn(s, NEXT_MONDAY);
      ok(
        await keyed(`/api/timetable/lessons/${lesson?.id ?? ''}/cancel`, s.branch, {
          reason: 'Trip',
        }),
      );
      await entered(s.branch, {
        roomId: s.room,
        startsOn: NEXT_MONDAY,
        endsOn: NEXT_FRIDAY,
        reason: 'Repairs',
      });
      const refused = await keyed(
        `/api/timetable/lessons/${lesson?.id ?? ''}/restore`,
        s.branch,
        {},
      );
      refusedWith(refused, 409, 'restore_blocked');
      expect(rulesOf(refused)).toContain('room_closed');
      ok(
        await keyed(`/api/timetable/lessons/${lesson?.id ?? ''}/restore`, s.branch, {
          roomId: s.otherRoom,
          reason: 'Repairs',
        }),
      );
    });

    it('keeps the correction of a past lesson in a room closed then open', async () => {
      const s = await scene();
      await stored(
        s.branch,
        s.room,
        { startsOn: NEXT_MONDAY, endsOn: NEXT_FRIDAY },
        { from: at(NEXT_MONDAY, '00:00'), until: at('2026-10-24', '00:00') },
      );
      const other = await load.teacher(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
      });
      await hours(s.branch, other.staffId);
      const [lesson] = await lessonsOn(s, NEXT_MONDAY);
      await asViceAt(s.branch, at(NEXT_MONDAY, '10:00'), async (cookie) => {
        ok(
          await keyed(
            `/api/timetable/lessons/${lesson?.id ?? ''}/correction`,
            s.branch,
            { kind: 'teacher', teacherId: other.staffId, reason: 'Swapped', confirm: true },
            cookie,
          ),
        );
      });
    });
  });

  describe('exams (decisions 5 and 10)', () => {
    const exam = (s: Scene, roomId: string, date = NEXT_MONDAY) =>
      request(t.kit.server)
        .post('/api/timetable/exams')
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({
          date,
          firstLesson: 2,
          lastLesson: 2,
          title: 'Quarter exam',
          subjectId: null,
          rooms: [
            { roomId, classIds: [s.classId], groupIds: [], invigilatorIds: [s.teacher.staffId] },
          ],
          blockChoices: [],
          confirm: true,
        });

    it('refuses an exam in a room closed at its time', async () => {
      const s = await scene();
      await entered(s.branch, {
        roomId: s.otherRoom,
        startsOn: NEXT_MONDAY,
        endsOn: NEXT_FRIDAY,
        reason: 'Repairs',
      });
      const refused = await exam(s, s.otherRoom);
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(JSON.stringify(refused.body)).toContain('room_closed');
      expect((await exam(s, s.otherRoom, MONDAY_AFTER)).status).toBe(201);
    });

    it('lists an exam whose room is closed at its start, by a closure or the room’s status, never a cancelled one or another branch’s', async () => {
      const s = await scene();
      const created = await exam(s, s.otherRoom);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const examId = (created.body as { exam: { id: string } }).exam.id;
      expect((await attention(s.branch)).examsNeedRoom).toEqual([]);
      const closure = await entered(s.branch, {
        roomId: s.otherRoom,
        startsOn: NEXT_MONDAY,
        endsOn: NEXT_FRIDAY,
        reason: 'Repairs',
      });
      const home = await attention(s.branch);
      expect(home.examsNeedRoom).toEqual([
        expect.objectContaining({
          examId,
          date: NEXT_MONDAY,
          rooms: [expect.objectContaining({ id: s.otherRoom, cause: 'closure' })],
        }),
      ]);
      expect((await attention(t.north)).examsNeedRoom.map((one) => one.examId)).not.toContain(
        examId,
      );
      ok(await withdraw(s.branch, closure.id));
      await t.database.migrator
        .updateTable('rooms')
        .set({ status: 'under_repair' })
        .where('id', '=', s.otherRoom)
        .execute();
      expect((await attention(s.branch)).examsNeedRoom).toEqual([
        expect.objectContaining({ rooms: [expect.objectContaining({ cause: 'under_repair' })] }),
      ]);
      await asViceAt(s.branch, at(NEXT_MONDAY, '09:30'), async (cookie) => {
        // Started: history.
        expect((await attention(s.branch, cookie)).examsNeedRoom).toEqual([]);
      });
    });
  });

  describe('a publish and a withdraw (decision 9)', () => {
    it('lists the closure kept with the new lessons it covers, and the new lessons need a room after the publish', async () => {
      const s = await scene();
      const closure = await entered(s.branch, {
        roomId: s.room,
        startsOn: NEXT_MONDAY,
        endsOn: LAST_FRIDAY,
        reason: 'Repairs',
      });
      const created = await t.post('/api/timetable/versions', s.branch, {
        academicYearId: s.year,
        startsOn: NEXT_MONDAY,
        copyFrom: s.version,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const draft = (created.body as { id: string }).id;
      // The copy moves the maths to Wednesday.
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', draft)
        .execute();
      const row = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', draft)
        .executeTakeFirstOrThrow();
      await placeAt(s.branch, draft, row.id, 3);
      ok(await t.post(`/api/timetable/versions/${draft}/templates/confirm`, s.branch));
      await load.freeEditLock(draft);
      const checked = ok(
        await t.get(
          `/api/timetable/versions/${draft}/publish-check?startsOn=${NEXT_MONDAY}`,
          s.branch,
        ),
      ).body as { impact: { dayChanges: { key: string; closures: unknown[] } } };
      expect(checked.impact.dayChanges.closures).toEqual([
        {
          id: closure.id,
          room: expect.any(String) as unknown,
          startsOn: NEXT_MONDAY,
          endsOn: LAST_FRIDAY,
          lessons: 2,
        },
      ]);
      const published = await request(t.kit.server)
        .post(`/api/timetable/versions/${draft}/publish`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ startsOn: NEXT_MONDAY, dayChangesKey: checked.impact.dayChanges.key });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(await roomsOn(s, '2026-10-21')).toEqual([{ room: s.room, roomOut: 'closure' }]);
      expect(await roomsOn(s, '2026-11-11')).toEqual([{ room: s.room, roomOut: null }]);
      expect((await attention(s.branch)).needsRoom).toEqual([
        expect.objectContaining({
          closure: expect.objectContaining({ id: closure.id }) as unknown,
          lessons: 2,
        }),
      ]);
      const withdrawCheck = ok(
        await t.get(`/api/timetable/versions/${draft}/withdraw-check`, s.branch),
      ).body as { dayChanges: { closures: { id: string; lessons: number }[] } };
      expect(withdrawCheck.dayChanges.closures).toEqual([
        expect.objectContaining({ id: closure.id, lessons: 2 }),
      ]);
    });
  });
});
