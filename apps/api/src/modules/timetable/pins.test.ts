import { BRANCH_HEADER, draftReadinessSchema, type DraftReadiness } from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import {
  dayTemplatesKit,
  MONDAY,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { Timetable } from './timetable.service.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const readinessOf = (response: Response): DraftReadiness => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return draftReadinessSchema.parse(response.body);
};

// All names are invented. Task 5.3b-2: pinned lessons of step 5 of the draft
// builder (docs/spec/06-timetable.md, Building a timetable, step 5: "pins
// lessons that must stay at a fixed time (for example the Homework slot at
// the end of the day) ... Ready when: Confirmed"; edge/timetable, Generator
// and editing: "the locked and pinned lessons are checked on their own. A
// blocked conflict stops the run and lists the lessons."; Structure, the
// Homework slot row: "A Tutor of two classes cannot have both pinned at the
// same time; the load step lists this."). The clock stands at 23:55 on
// Saturday 10 October 2026 in Tashkent; a draft starts on Monday 12 October.
describe('pinned lessons of step 5', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;

  beforeAll(async () => {
    t = await dayTemplatesKit();
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  const get = (path: string, branch: string, cookie = t.admin) => t.get(path, branch, cookie);
  const post = (path: string, branch: string, body: object = {}, cookie = t.admin) =>
    t.post(path, branch, body, cookie);
  const remove = (path: string, branch: string, cookie = t.admin) =>
    request(t.kit.server).delete(path).set('Cookie', cookie).set(BRANCH_HEADER, branch);

  const readiness = async (branch: string, version: string) =>
    readinessOf(await get(`/api/timetable/versions/${version}/readiness`, branch));
  const addPin = (
    branch: string,
    version: string,
    loadRowId: string,
    weekday: number,
    slotPosition: number,
    cookie = t.admin,
  ) =>
    post(
      `/api/timetable/versions/${version}/pins`,
      branch,
      { loadRowId, weekday, slotPosition },
      cookie,
    );
  const pinned = async (
    branch: string,
    version: string,
    loadRowId: string,
    weekday: number,
    slotPosition: number,
  ): Promise<{ answer: DraftReadiness; id: string }> => {
    const answer = readinessOf(await addPin(branch, version, loadRowId, weekday, slotPosition));
    const pin = answer.rules.pins.find(
      (one) =>
        one.loadRowId === loadRowId && one.weekday === weekday && one.slotPosition === slotPosition,
    );
    if (pin === undefined) throw new Error('The pin was not answered.');
    return { answer, id: pin.id };
  };
  const confirmShown = async (branch: string, version: string) => {
    const { weights, pins } = (await readiness(branch, version)).rules;
    return post(`/api/timetable/versions/${version}/rules/confirm`, branch, {
      weights,
      pins: pins.map((pin) => pin.id),
    });
  };
  const gate = (branch: string, version: string) =>
    t.app
      .get(Transactions)
      .run([branch], (transaction) =>
        t.app.get(Timetable).requireReady(transaction, branch, version),
      );
  const pinsOf = (version: string) =>
    t.database.migrator
      .selectFrom('timetable_pins')
      .selectAll()
      .where('version_id', '=', version)
      .orderBy('id')
      .execute();

  /** Hours of a person in the branch from 1 September, on the weekdays named, all day. */
  async function hours(branch: string, staffId: string, weekdays: readonly number[]) {
    const entry = await t.database.migrator
      .insertInto('staff_availability')
      .values({ branch_id: branch, staff_id: staffId, valid_from: '2026-09-01' })
      .returning(['id', 'valid_until'])
      .executeTakeFirstOrThrow();
    for (const weekday of weekdays) {
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
   * A branch of its own whose day is lesson, break, lesson, break, lesson
   * (positions 1 to 5: 08:00–08:45, a break, 08:55–09:40, a break,
   * 09:50–10:35), a draft from Monday with its templates confirmed, and two
   * classes of grade 7, each with a row of three lessons a week by a teacher
   * of its own with hours every working day.
   */
  async function scene() {
    const branch = await t.newBranch();
    const year = await load.classes.year(branch);
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
    const subject = await load.classes.subject({ grades: [7] });
    const classA = await load.classes.schoolClass(branch, year, {
      grade: 7,
      room: await load.classes.room(branch),
    });
    const classB = await load.classes.schoolClass(branch, year, {
      grade: 7,
      room: await load.classes.room(branch),
    });
    const teacherA = (await load.teacher(branch, { subjects: [{ subject, grades: [7] }] })).staffId;
    const teacherB = (await load.teacher(branch, { subjects: [{ subject, grades: [7] }] })).staffId;
    await hours(branch, teacherA, [1, 2, 3, 4, 5]);
    await hours(branch, teacherB, [1, 2, 3, 4, 5]);
    const created = await post('/api/timetable/versions', branch, {
      academicYearId: year,
      startsOn: MONDAY,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const version = (created.body as { id: string }).id;
    const rowA = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: classA,
      subject_id: subject,
      teacher_id: teacherA,
      lessons_per_week: 3,
    });
    const rowB = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: classB,
      subject_id: subject,
      teacher_id: teacherB,
      lessons_per_week: 3,
    });
    readinessOf(await post(`/api/timetable/versions/${version}/templates/confirm`, branch));
    return { branch, year, version, subject, classA, classB, teacherA, teacherB, rowA, rowB };
  }

  describe('the pins and step 5', () => {
    it('adds a pin in one audited write and answers it with the time of its slot', async () => {
      const s = await scene();
      const { answer, id } = await pinned(s.branch, s.version, s.rowA, 5, 5);
      expect(answer.rules.pins).toHaveLength(1);
      expect(answer.rules.pins[0]?.unit.id).toBe(s.classA);
      expect(answer.rules.pins[0]?.teacher.id).toBe(s.teacherA);
      expect(answer.rules.pins).toEqual([
        expect.objectContaining({
          id,
          loadRowId: s.rowA,
          weekday: 5,
          slotPosition: 5,
          time: { start: 590, end: 635 },
        }),
      ]);
      const [entry] = await t.entries('timetable_pin.create', id);
      expect(entry).toMatchObject({
        new_value: { versionId: s.version, loadRowId: s.rowA, weekday: 5, slotPosition: 5 },
      });
    });

    it('is ready with one pin of a row of three lessons once confirmed (a load warning does not block)', async () => {
      const s = await scene();
      await pinned(s.branch, s.version, s.rowA, 1, 1);
      const before = await readiness(s.branch, s.version);
      expect(before.rules).toMatchObject({ ready: false, confirmed: false, conflicts: [] });
      const done = readinessOf(await confirmShown(s.branch, s.version));
      expect(done.rules).toMatchObject({ ready: true, confirmed: true, pinsChanged: false });
      expect(done.ready).toBe(true);
      await expect(gate(s.branch, s.version)).resolves.toBeUndefined();
    });

    it('lists one teacher in two pins at one time, naming both, and the gate refuses (Done when)', async () => {
      const s = await scene();
      // Teacher A also takes class B's row.
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ teacher_id: s.teacherA })
        .where('id', '=', s.rowB)
        .execute();
      const first = await pinned(s.branch, s.version, s.rowA, 2, 3);
      const second = await pinned(s.branch, s.version, s.rowB, 2, 3);
      readinessOf(await confirmShown(s.branch, s.version));
      const answer = await readiness(s.branch, s.version);
      expect(answer.rules).toMatchObject({ ready: false, confirmed: true });
      expect(answer.rules.conflicts).toEqual([
        {
          rule: 'teacher_double',
          weekday: 2,
          pinIds: [first.id, second.id].sort(),
          elsewhere: false,
        },
      ]);
      expect(answer.ready).toBe(false);
      await expect(gate(s.branch, s.version)).rejects.toMatchObject({
        code: 'draft_not_ready',
        details: [expect.objectContaining({ path: 'rules' })],
      });
      // Moved apart, the draft is ready again with no new confirmation of the
      // weights: the pins changed, so it is confirmed again.
      readinessOf(await remove(`/api/timetable/versions/${s.version}/pins/${second.id}`, s.branch));
      await pinned(s.branch, s.version, s.rowB, 2, 5);
      readinessOf(await confirmShown(s.branch, s.version));
      await expect(gate(s.branch, s.version)).resolves.toBeUndefined();
    });

    it("lists a pin outside the teacher's hours on the start date", async () => {
      const s = await scene();
      const teacher = (
        await load.teacher(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] })
      ).staffId;
      await hours(s.branch, teacher, [1, 2]);
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ teacher_id: teacher })
        .where('id', '=', s.rowA)
        .execute();
      const { id } = await pinned(s.branch, s.version, s.rowA, 3, 1);
      expect((await readiness(s.branch, s.version)).rules.conflicts).toEqual([
        { rule: 'teacher_unavailable', weekday: 3, pinIds: [id], elsewhere: false },
      ]);
    });

    it('lists two pins in one named room', async () => {
      const s = await scene();
      const room = await load.classes.room(s.branch);
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ room_id: room })
        .where('id', 'in', [s.rowA, s.rowB])
        .execute();
      const first = await pinned(s.branch, s.version, s.rowA, 4, 1);
      const second = await pinned(s.branch, s.version, s.rowB, 4, 1);
      expect((await readiness(s.branch, s.version)).rules.conflicts).toEqual([
        { rule: 'room_double', weekday: 4, pinIds: [first.id, second.id].sort(), elsewhere: false },
      ]);
    });

    it('saves a break and a missing slot and lists them, never as free (decisions 3, review correction 1)', async () => {
      const s = await scene();
      const onBreak = await pinned(s.branch, s.version, s.rowA, 1, 2);
      const past = await pinned(s.branch, s.version, s.rowB, 1, 9);
      const saturday = await pinned(s.branch, s.version, s.rowB, 6, 1);
      const answer = await readiness(s.branch, s.version);
      expect(answer.rules.conflicts).toEqual([
        { rule: 'break_slot', weekday: 1, pinIds: [onBreak.id], elsewhere: false },
      ]);
      expect(answer.rules.problems).toEqual(
        [past.id, saturday.id].sort().map((pinId) => ({ pinId, problem: 'pin_no_slot' })),
      );
      expect(answer.rules.pins.find((pin) => pin.id === past.id)?.time).toBeNull();
      expect(answer.rules.ready).toBe(false);
    });

    it('lists the pins of a row whose lessons per week fell under them (decision 5)', async () => {
      const s = await scene();
      const one = await pinned(s.branch, s.version, s.rowA, 1, 1);
      const two = await pinned(s.branch, s.version, s.rowA, 2, 1);
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ lessons_per_week: 1 })
        .where('id', '=', s.rowA)
        .execute();
      expect((await readiness(s.branch, s.version)).rules.problems).toEqual(
        [one.id, two.id].sort().map((pinId) => ({ pinId, problem: 'pin_over_load' })),
      );
    });

    it('is not ready once a pin was added after the confirmation, and refuses a confirm of other pins (decision 7)', async () => {
      const s = await scene();
      await pinned(s.branch, s.version, s.rowA, 1, 1);
      readinessOf(await confirmShown(s.branch, s.version));
      const stale = (await readiness(s.branch, s.version)).rules;
      await pinned(s.branch, s.version, s.rowB, 1, 3);
      const after = await readiness(s.branch, s.version);
      expect(after.rules).toMatchObject({ ready: false, confirmed: false, pinsChanged: true });
      await expect(gate(s.branch, s.version)).rejects.toMatchObject({ code: 'draft_not_ready' });
      const count = await t.auditCount();
      refusedWith(
        await post(`/api/timetable/versions/${s.version}/rules/confirm`, s.branch, {
          weights: stale.weights,
          pins: stale.pins.map((pin) => pin.id),
        }),
        409,
        'pins_changed',
      );
      expect(await t.auditCount()).toBe(count);
      readinessOf(await confirmShown(s.branch, s.version));
      readinessOf(await confirmShown(s.branch, s.version));
      const entries = await t.entries('timetable_version.rules_confirm', s.version);
      expect(entries).toHaveLength(2);
      expect(entries[1]).toMatchObject({
        new_value: { pins: after.rules.pins.map((pin) => pin.id).sort() },
      });
    });

    it('lists a Tutor of two classes whose pinned lessons fall at the same time in the load step', async () => {
      const s = await scene();
      const tutorSubject = await load.tutorSubject({ grades: [7] });
      const tutor = await load.tutorSubjectHolder(s.branch, tutorSubject, [7]);
      // One Tutor assignment, two classes.
      const assignment = await load.classes.role(tutor.accountId, s.branch, 'tutor');
      await load.classes.tutorRow(s.branch, s.classA, assignment);
      await load.classes.tutorRow(s.branch, s.classB, assignment);
      await hours(s.branch, tutor.staffId, [1, 2, 3, 4, 5]);
      const rows = [];
      for (const classId of [s.classA, s.classB]) {
        rows.push(
          await load.row({
            branch_id: s.branch,
            version_id: s.version,
            class_id: classId,
            subject_id: tutorSubject,
            teacher_id: tutor.staffId,
            lessons_per_week: 1,
          }),
        );
      }
      const [first, second] = rows;
      if (first === undefined || second === undefined) throw new Error('Two rows.');
      const a = await pinned(s.branch, s.version, first, 5, 5);
      const b = await pinned(s.branch, s.version, second, 5, 5);
      const answer = await readiness(s.branch, s.version);
      const both = {
        rule: 'teacher_double',
        weekday: 5,
        pinIds: [a.id, b.id].sort(),
        elsewhere: false,
      };
      expect(answer.load.tutorPinClashes).toEqual([both]);
      expect(answer.rules.conflicts).toEqual([both]);
      // Two times: nothing to list.
      readinessOf(await remove(`/api/timetable/versions/${s.version}/pins/${b.id}`, s.branch));
      await pinned(s.branch, s.version, second, 4, 5);
      expect((await readiness(s.branch, s.version)).load.tutorPinClashes).toEqual([]);
    });
  });

  // The facts of the pattern read from the database (pattern-facts.ts), on the
  // dates of 5.3a decision 2: the later of the start date and today.
  describe('the facts the pins are checked against', () => {
    it('reads the availability entry in force on the start date, not a later one', async () => {
      const s = await scene();
      const teacher = (
        await load.teacher(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] })
      ).staffId;
      // Mondays only until November, then every day.
      const early = await t.database.migrator
        .insertInto('staff_availability')
        .values({
          branch_id: s.branch,
          staff_id: teacher,
          valid_from: '2026-09-01',
          valid_until: '2026-11-02',
        })
        .returning(['id', 'valid_until'])
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .insertInto('staff_availability_ranges')
        .values({
          entry_id: early.id,
          branch_id: s.branch,
          staff_id: teacher,
          weekday: 1,
          start_minutes: 0,
          end_minutes: 1440,
          valid_from: '2026-09-01',
          valid_until: early.valid_until,
        })
        .execute();
      const later = await t.database.migrator
        .insertInto('staff_availability')
        .values({ branch_id: s.branch, staff_id: teacher, valid_from: '2026-11-02' })
        .returning(['id', 'valid_until'])
        .executeTakeFirstOrThrow();
      for (const weekday of [1, 2, 3, 4, 5]) {
        await t.database.migrator
          .insertInto('staff_availability_ranges')
          .values({
            entry_id: later.id,
            branch_id: s.branch,
            staff_id: teacher,
            weekday,
            start_minutes: 0,
            end_minutes: 1440,
            valid_from: '2026-11-02',
            valid_until: later.valid_until,
          })
          .execute();
      }
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ teacher_id: teacher })
        .where('id', '=', s.rowA)
        .execute();
      const monday = await pinned(s.branch, s.version, s.rowA, 1, 1);
      const wednesday = await pinned(s.branch, s.version, s.rowA, 3, 1);
      const conflicts = (await readiness(s.branch, s.version)).rules.conflicts;
      expect(conflicts).toEqual([
        { rule: 'teacher_unavailable', weekday: 3, pinIds: [wednesday.id], elsewhere: false },
      ]);
      expect(conflicts.flatMap((one) => one.pinIds)).not.toContain(monday.id);
    });

    it("reads the teacher's status on the start date", async () => {
      const s = await scene();
      const { id } = await pinned(s.branch, s.version, s.rowA, 1, 1);
      expect((await readiness(s.branch, s.version)).rules.conflicts).toEqual([]);
      await load.status(s.teacherA, 'left', MONDAY);
      expect((await readiness(s.branch, s.version)).rules.conflicts).toEqual([
        { rule: 'teacher_inactive', weekday: 1, pinIds: [id], elsewhere: false },
      ]);
    });

    it('reads the template of each weekday: a short Friday has no fifth slot', async () => {
      const s = await scene();
      const lesson = await t.createSlotType(s.branch, 'Short lesson', 'lesson', 40);
      const pause = await t.createSlotType(s.branch, 'Short break', 'break', 5);
      const short = await t.createTemplate(s.branch, 'Short', [lesson, pause, lesson]);
      await t.assign(s.branch, short, { level: 'weekday', weekday: 5 });
      const friday = await pinned(s.branch, s.version, s.rowA, 5, 5);
      const thursday = await pinned(s.branch, s.version, s.rowA, 4, 5);
      const answer = await readiness(s.branch, s.version);
      expect(answer.rules.problems).toEqual([{ pinId: friday.id, problem: 'pin_no_slot' }]);
      expect(answer.rules.pins.find((pin) => pin.id === thursday.id)?.time).toEqual({
        start: 590,
        end: 635,
      });
      // On Friday the third slot is the second lesson of the short day: 08:45–09:25.
      const third = await pinned(s.branch, s.version, s.rowB, 5, 3);
      expect(third.answer.rules.pins.find((pin) => pin.id === third.id)?.time).toEqual({
        start: 525,
        end: 565,
      });
    });
  });

  // Task 5.4b-1 (the From 5.3b-2 line of 5.4b, decision 1 of 5.3b-2, Look
  // first): the pins are checked against the teachers' lessons in the
  // published timetable of other branches (06, Teachers who work in several
  // branches, "One clash check", "Busy elsewhere"; edge/timetable, Generator
  // and editing: "A blocked conflict stops the run and lists the lessons").
  describe('the pins and the lessons of other branches', () => {
    /** A lesson of the teacher on the other scene's row at a weekday and position, its version then published. */
    async function elsewhere(
      other: Awaited<ReturnType<typeof scene>>,
      teacherId: string,
      rowId: string,
      weekday: number,
      position: 1 | 3 | 5,
    ) {
      const [start, end] = { 1: [480, 525], 3: [535, 580], 5: [590, 635] }[position];
      const block = await t.database.migrator
        .insertInto('pattern_blocks')
        .values({
          branch_id: other.branch,
          version_id: other.version,
          weekday,
          slot_position: position,
          start_minutes: start,
          end_minutes: end,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .insertInto('pattern_entries')
        .values({
          branch_id: other.branch,
          version_id: other.version,
          block_id: block.id,
          weekday,
          start_minutes: start,
          end_minutes: end,
          load_row_id: rowId,
          teacher_id: teacherId,
        })
        .execute();
      await load.setVersion(other.version, 'published');
    }

    const linkTo = (staffId: string, branch: string) =>
      t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: staffId, branch_id: branch, is_main: false })
        .execute();

    it('lists a pin at the time of the teacher’s lesson in another branch, and step 5 is not ready', async () => {
      const s = await scene();
      const other = await scene();
      await linkTo(s.teacherA, other.branch);
      await load.profile(s.teacherA, [{ subject: other.subject, grades: [7] }]);
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ teacher_id: s.teacherA })
        .where('id', '=', other.rowB)
        .execute();
      await elsewhere(other, s.teacherA, other.rowB, 2, 3);
      const { id } = await pinned(s.branch, s.version, s.rowA, 2, 3);
      const answer = await readiness(s.branch, s.version);
      expect(answer.rules.conflicts).toEqual([
        { rule: 'teacher_double', weekday: 2, pinIds: [id], elsewhere: true },
      ]);
      expect(answer.rules.ready).toBe(false);
      await expect(gate(s.branch, s.version)).rejects.toMatchObject({ status: 409 });
      // Another weekday meets nothing elsewhere.
      readinessOf(await remove(`/api/timetable/versions/${s.version}/pins/${id}`, s.branch));
      await pinned(s.branch, s.version, s.rowA, 3, 3);
      expect((await readiness(s.branch, s.version)).rules.conflicts).toEqual([]);
    });

    it('lists a Tutor whose pinned lesson meets a Tutor lesson in another branch in the load step', async () => {
      const s = await scene();
      const other = await scene();
      const tutorSubject = await load.tutorSubject({ grades: [7] });
      const tutor = await load.tutorSubjectHolder(s.branch, tutorSubject, [7]);
      await linkTo(tutor.staffId, other.branch);
      await load.classes.tutorRow(
        s.branch,
        s.classA,
        await load.classes.role(tutor.accountId, s.branch, 'tutor'),
      );
      await load.classes.tutorRow(
        other.branch,
        other.classA,
        await load.classes.role(tutor.accountId, other.branch, 'tutor'),
      );
      await hours(s.branch, tutor.staffId, [1, 2, 3, 4, 5]);
      const row = (branch: string, version: string, classId: string) =>
        load.row({
          branch_id: branch,
          version_id: version,
          class_id: classId,
          subject_id: tutorSubject,
          teacher_id: tutor.staffId,
          lessons_per_week: 1,
        });
      const own = await row(s.branch, s.version, s.classA);
      await elsewhere(
        other,
        tutor.staffId,
        await row(other.branch, other.version, other.classA),
        5,
        5,
      );
      const { id } = await pinned(s.branch, s.version, own, 5, 5);
      const answer = await readiness(s.branch, s.version);
      const clash = { rule: 'teacher_double', weekday: 5, pinIds: [id], elsewhere: true };
      expect(answer.load.tutorPinClashes).toEqual([clash]);
      expect(answer.rules.conflicts).toEqual([clash]);
    });
  });

  describe('the pin routes', () => {
    /** The kit's Academic Vice Principal, given the role in a branch of a scene too. */
    const viceIn = async (branch: string) => {
      const vice = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('id', '=', t.viceAssignment)
        .executeTakeFirstOrThrow();
      return load.classes.role(vice.account_id, branch, 'academic_vice_principal');
    };

    it('lets the Academic Vice Principal of the branch add and remove a pin, the audit naming the assignment', async () => {
      const s = await scene();
      const assignment = await viceIn(s.branch);
      const added = readinessOf(await addPin(s.branch, s.version, s.rowA, 1, 1, t.vicePrincipal));
      const pin = added.rules.pins[0];
      if (pin === undefined) throw new Error('The pin was not answered.');
      const [created] = await t.entries('timetable_pin.create', pin.id);
      expect(created).toMatchObject({ assignment_id: assignment });
      readinessOf(
        await remove(
          `/api/timetable/versions/${s.version}/pins/${pin.id}`,
          s.branch,
          t.vicePrincipal,
        ),
      );
      const [deleted] = await t.entries('timetable_pin.delete', pin.id);
      expect(deleted).toMatchObject({ assignment_id: assignment });
    });

    it('refuses a pin already there, one over the lessons per week and a half of a mixed split', async () => {
      const s = await scene();
      await pinned(s.branch, s.version, s.rowA, 1, 1);
      await pinned(s.branch, s.version, s.rowA, 2, 1);
      await pinned(s.branch, s.version, s.rowA, 3, 1);
      const count = await t.auditCount();
      refusedWith(await addPin(s.branch, s.version, s.rowA, 1, 1), 409, 'pin_taken');
      refusedWith(await addPin(s.branch, s.version, s.rowA, 4, 1), 409, 'pin_over_load');
      const english = await load.classes.subject({ grades: [7] });
      const [halfA, halfB] = [
        await load.classes.group(s.branch, s.year, english, [s.classA]),
        await load.classes.group(s.branch, s.year, english, [s.classA]),
      ];
      const teacher = (
        await load.teacher(s.branch, { subjects: [{ subject: english, grades: [7] }] })
      ).staffId;
      const mixed = await load.row({
        branch_id: s.branch,
        version_id: s.version,
        group_id: halfA,
        subject_id: english,
        teacher_id: teacher,
        lessons_per_week: 2,
        mixed_block: true,
      });
      await load.row({
        branch_id: s.branch,
        version_id: s.version,
        group_id: halfB,
        subject_id: english,
        teacher_id: teacher,
        lessons_per_week: 2,
        mixed_block: true,
      });
      refusedWith(await addPin(s.branch, s.version, mixed, 1, 1), 409, 'pin_mixed_block');
      expect(await t.auditCount()).toBe(count);
      expect(await pinsOf(s.version)).toHaveLength(3);
    });

    it('counts the pinned slots of a block over all its rows, and the block placed whole (decisions 4, 5)', async () => {
      const s = await scene();
      const english = await load.classes.subject({ grades: [7] });
      const parts = [
        await load.classes.group(s.branch, s.year, english, [s.classA]),
        await load.classes.group(s.branch, s.year, english, [s.classA]),
      ];
      const rows: string[] = [];
      for (const group of parts) {
        const teacher = (
          await load.teacher(s.branch, { subjects: [{ subject: english, grades: [7] }] })
        ).staffId;
        await hours(s.branch, teacher, [1, 2, 3, 4, 5]);
        rows.push(
          await load.row({
            branch_id: s.branch,
            version_id: s.version,
            group_id: group,
            subject_id: english,
            teacher_id: teacher,
            lessons_per_week: 1,
          }),
        );
      }
      const [first = '', second = ''] = rows;
      const pin = await pinned(s.branch, s.version, first, 1, 3);
      expect(pin.answer.rules.conflicts).toEqual([]);
      // The other part may share the slot, not take a second one.
      await pinned(s.branch, s.version, second, 1, 3);
      refusedWith(await addPin(s.branch, s.version, second, 2, 3), 409, 'pin_over_load');
    });

    it('refuses on a version that is not a draft and in a closed year, changing nothing', async () => {
      const published = await scene();
      const kept = await pinned(published.branch, published.version, published.rowA, 1, 1);
      await load.setVersion(published.version, 'published');
      const closed = await scene();
      const keptClosed = await pinned(closed.branch, closed.version, closed.rowA, 1, 1);
      await load.classes.setYear(closed.year, 'closed');
      for (const [s, pin, code] of [
        [published, kept.id, 'version_not_draft'],
        [closed, keptClosed.id, 'timetable_year_closed'],
      ] as const) {
        const before = await pinsOf(s.version);
        const count = await t.auditCount();
        refusedWith(await addPin(s.branch, s.version, s.rowB, 1, 1), 409, code);
        refusedWith(
          await remove(`/api/timetable/versions/${s.version}/pins/${pin}`, s.branch),
          409,
          code,
        );
        expect(await pinsOf(s.version)).toEqual(before);
        expect(await t.auditCount()).toBe(count);
      }
    });

    it('removes a pin in one audited write, and a deleted row takes its pins into its audit entry', async () => {
      const s = await scene();
      const one = await pinned(s.branch, s.version, s.rowA, 1, 1);
      const two = await pinned(s.branch, s.version, s.rowB, 2, 1);
      const answer = readinessOf(
        await remove(`/api/timetable/versions/${s.version}/pins/${one.id}`, s.branch),
      );
      expect(answer.rules.pins.map((pin) => pin.id)).toEqual([two.id]);
      const [entry] = await t.entries('timetable_pin.delete', one.id);
      expect(entry).toMatchObject({
        old_value: { versionId: s.version, loadRowId: s.rowA, weekday: 1, slotPosition: 1 },
      });
      const gone = await remove(`/api/timetable/versions/${s.version}/load/${s.rowB}`, s.branch);
      expect(gone.status, JSON.stringify(gone.body)).toBe(204);
      expect(await pinsOf(s.version)).toEqual([]);
      const [deleted] = await t.entries('teaching_load.delete', s.rowB);
      expect(deleted).toMatchObject({
        old_value: { pins: [{ id: two.id, weekday: 2, slotPosition: 1 }] },
      });
    });

    it('copies the pins of the rows a copy takes, not the confirmation (decision 9)', async () => {
      const s = await scene();
      const one = await pinned(s.branch, s.version, s.rowA, 1, 1);
      readinessOf(await confirmShown(s.branch, s.version));
      const copied = await post('/api/timetable/versions', s.branch, {
        academicYearId: s.year,
        startsOn: MONDAY,
        copyFrom: s.version,
      });
      expect(copied.status, JSON.stringify(copied.body)).toBe(201);
      const copy = (copied.body as { id: string }).id;
      const rules = (await readiness(s.branch, copy)).rules;
      expect(rules.pins).toHaveLength(1);
      expect(rules.pins[0]).toMatchObject({ weekday: 1, slotPosition: 1 });
      expect(rules.pins[0]?.id).not.toBe(one.id);
      expect(rules.pins[0]?.loadRowId).not.toBe(s.rowA);
      expect(rules.confirmed).toBe(false);
      const [entry] = await t.entries('timetable_version.create', copy);
      expect(entry).toMatchObject({
        new_value: {
          copiedPins: [
            {
              sourcePinId: one.id,
              loadRowId: rules.pins[0]?.loadRowId,
              weekday: 1,
              slotPosition: 1,
            },
          ],
        },
      });
    });

    it('copies no pin of a row the copy leaves', async () => {
      const s = await scene();
      await pinned(s.branch, s.version, s.rowA, 1, 1);
      await load.status(s.teacherA, 'left', MONDAY);
      const copied = await post('/api/timetable/versions', s.branch, {
        academicYearId: s.year,
        startsOn: MONDAY,
        copyFrom: s.version,
      });
      expect(copied.status, JSON.stringify(copied.body)).toBe(201);
      const copy = (copied.body as { id: string }).id;
      expect((await readiness(s.branch, copy)).rules.pins).toEqual([]);
      expect(await pinsOf(copy)).toEqual([]);
    });

    it("answers 404 for another branch's, another version's and an unknown version, row and pin, changing nothing", async () => {
      const s = await scene();
      const other = await scene();
      const sameBranch = await load.version(s.branch, s.year, { startsOn: MONDAY });
      const otherPin = await pinned(other.branch, other.version, other.rowA, 1, 1);
      const ownPin = await pinned(s.branch, s.version, s.rowA, 1, 1);
      const rows = () =>
        Promise.all([
          t.database.migrator.selectFrom('timetable_pins').selectAll().orderBy('id').execute(),
          t.database.migrator
            .selectFrom('teaching_load_rows')
            .selectAll()
            .where('version_id', 'in', [s.version, other.version])
            .orderBy('id')
            .execute(),
          t.database.migrator
            .selectFrom('timetable_versions')
            .selectAll()
            .where('id', 'in', [s.version, other.version, sameBranch])
            .orderBy('id')
            .execute(),
          t.auditCount(),
        ]);
      // Permission review, S1: the Academic Vice Principal of the branch too.
      await viceIn(s.branch);
      const before = await rows();
      for (const cookie of [t.vicePrincipal, t.admin]) {
        // Version: another branch's, an unknown one.
        for (const version of [other.version, UNKNOWN]) {
          refusedWith(await addPin(s.branch, version, s.rowA, 2, 1, cookie), 404, 'not_found');
          refusedWith(
            await remove(`/api/timetable/versions/${version}/pins/${ownPin.id}`, s.branch, cookie),
            404,
            'not_found',
          );
        }
        // Row: another branch's, another version's of the branch, an unknown one.
        for (const row of [other.rowA, UNKNOWN]) {
          refusedWith(await addPin(s.branch, s.version, row, 2, 1, cookie), 404, 'not_found');
        }
        refusedWith(await addPin(s.branch, sameBranch, s.rowA, 2, 1, cookie), 404, 'not_found');
        // Permission review, S2: pin ids in the confirm body, another branch's and an unknown
        // one: a snapshot compared with the stored pins, never looked up, so 409.
        const { weights } = (await readiness(s.branch, s.version)).rules;
        for (const pins of [[ownPin.id, otherPin.id], [UNKNOWN]]) {
          refusedWith(
            await post(
              `/api/timetable/versions/${s.version}/rules/confirm`,
              s.branch,
              { weights, pins },
              cookie,
            ),
            409,
            'pins_changed',
          );
        }
        // Pin: another branch's, another version's of the branch, an unknown one.
        for (const [version, pin] of [
          [s.version, otherPin.id],
          [sameBranch, ownPin.id],
          [s.version, UNKNOWN],
        ] as const) {
          refusedWith(
            await remove(`/api/timetable/versions/${version}/pins/${pin}`, s.branch, cookie),
            404,
            'not_found',
          );
        }
      }
      expect(await rows()).toEqual(before);
    });

    it('refuses the Principal and a Teacher, and a body that is not a pin', async () => {
      const s = await scene();
      const own = await pinned(s.branch, s.version, s.rowA, 1, 1);
      const count = await t.auditCount();
      for (const cookie of [t.principal, t.teacher]) {
        refusedWith(
          await addPin(s.branch, s.version, s.rowB, 1, 1, cookie),
          403,
          'permission_denied',
        );
        refusedWith(
          await remove(`/api/timetable/versions/${s.version}/pins/${own.id}`, s.branch, cookie),
          403,
          'permission_denied',
        );
      }
      for (const body of [
        { loadRowId: s.rowB, weekday: 0, slotPosition: 1 },
        { loadRowId: s.rowB, weekday: 1, slotPosition: 21 },
        { loadRowId: s.rowB, weekday: 1, slotPosition: 1, room: 'r' },
        { loadRowId: 'row', weekday: 1, slotPosition: 1 },
      ]) {
        refusedWith(
          await post(`/api/timetable/versions/${s.version}/pins`, s.branch, body),
          400,
          'validation_failed',
        );
      }
      expect(await t.auditCount()).toBe(count);
    });
  });
});
