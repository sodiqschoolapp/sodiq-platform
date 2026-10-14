import { studentDetailSchema, type StudentDetail } from '@sodiq/shared';
import { sql } from 'kysely';
import { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import {
  dayTemplatesKit,
  TODAY,
  TOMORROW,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { relativesInput } from '../../testing/relatives-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const placed = (response: Response) => {
  expect(response.status, JSON.stringify(response.body)).toBe(201);
};

const ok = (response: Response): StudentDetail => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return studentDetailSchema.parse(response.body);
};

// All names are invented. docs/spec/04-people.md, Movements: "Class transfer
// and group transfer. One action with an effective date. ... The profile
// History tab shows each move with dates. ... class transfers are done by the
// Academic Vice Principal." docs/spec/edge-cases/students-classes-groups.md:
// the 11:00, "a week late", "scheduled", "a mistake", "two people" and
// "stopped coming on 1 October" rows; docs/spec/05, Language of instruction:
// "Moving a student between an Uzbek class and a Russian class asks for
// confirmation." Task 3.3a, pull request #95 with corrections 1 to 4 of its
// review. The clock stands at 23:55 on Saturday 10 October 2026 in Tashkent.
describe('class transfers', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let year: string;
  let southYear: string;
  let count = 0;

  const get = (path: string, cookie = t.vicePrincipal) => t.get(path, t.north, cookie);
  const post = (path: string, body: object = {}, cookie = t.vicePrincipal) =>
    t.post(path, t.north, body, cookie);

  /** A new student of grade 7 in the class from 2 September. */
  async function pupil(classId: string): Promise<StudentDetail> {
    count += 1;
    const response = await post('/api/people/students', {
      uid: String(2607500 + count),
      confirmUidSet: true,
      firstName: 'Dilnoza',
      lastName: `Karimova${'d'.repeat(count % 9)}${String.fromCharCode(97 + (count % 26))}`,
      paternalName: null,
      sex: 'female',
      birthDate: `2013-04-${String((count % 28) + 1).padStart(2, '0')}`,
      grade: 7,
      startsOn: '2026-09-02',
      documentType: null,
      documentNumber: null,
      jshshir: null,
      phone: null,
      email: null,
      address: null,
      region: null,
      previousSchool: null,
      diagnosticScore: null,
      scholarship: { type: 'none', coverage: null, amount: null },
      consentSignedOn: null,
      contract: { number: `CT-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives: relativesInput(),
      classId,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body);
  }

  const fresh = async (id: string): Promise<StudentDetail> =>
    studentDetailSchema.parse((await get(`/api/people/students/${id}`)).body);

  const schoolClass = (input: { language?: 'uz' | 'ru'; maxSize?: number } = {}) =>
    classes.schoolClass(t.north, year, { grade: 7, ...input });

  const subject = () => classes.subject({ grades: [7] });

  const group = (subjectId: string, classIds: readonly string[], size = 20) =>
    classes.group(t.north, year, subjectId, classIds, { size });

  const transfer = async (
    student: string,
    toClassId: string,
    from = TOMORROW,
    extra: Record<string, unknown> = {},
    cookie = t.vicePrincipal,
  ) =>
    post(
      '/api/classes/transfers',
      { studentId: student, version: (await fresh(student)).version, toClassId, from, ...extra },
      cookie,
    );

  const cancelMove = async (student: string, move: string) =>
    post(`/api/classes/transfers/${move}/cancel`, { version: (await fresh(student)).version });

  const undoMove = async (student: string, move: string) =>
    post(`/api/classes/transfers/${move}/undo`, {
      version: (await fresh(student)).version,
      reason: 'Moved by mistake.',
    });

  const leave = async (id: string, lastDay: string) =>
    ok(
      await post(`/api/people/students/${id}/leaving`, {
        lastDay,
        reason: 'The family moved.',
        version: (await fresh(id)).version,
      }),
    );

  const classRows = (id: string) =>
    t.database.migrator
      .selectFrom('class_memberships')
      .select([
        'class_id',
        'valid_from',
        'valid_until',
        'own_until',
        'ended_by',
        'cause',
        'written_by_move_id',
        'ended_by_move_id',
        'leaving_id',
      ])
      .where('student_id', '=', id)
      .orderBy('valid_from')
      .orderBy('id')
      .execute();

  const groupRows = (id: string) =>
    t.database.migrator
      .selectFrom('group_memberships')
      .select(['group_id', 'valid_from', 'valid_until', 'ended_by', 'cause', 'review'])
      .where('student_id', '=', id)
      .orderBy('valid_from')
      .orderBy('id')
      .execute();

  /** The class rows that hold days, as pairs of class and dates. */
  const held = async (id: string) =>
    (await classRows(id))
      .filter((row) => row.valid_from < row.valid_until)
      .map((row) => [row.class_id, row.valid_from, row.valid_until]);

  const heldGroups = async (id: string) =>
    (await groupRows(id))
      .filter((row) => row.valid_from < row.valid_until)
      .map((row) => [row.group_id, row.valid_from, row.valid_until]);

  const moveOf = (detail: StudentDetail) => {
    const move = detail.scheduledMoves[0] ?? detail.lastClassMove;
    if (move === undefined || move === null) {
      throw new Error('No move.');
    }
    return move.id;
  };

  /** Every row of the tables a move writes, in both branches, and the log. */
  const rowsOf = () =>
    Promise.all([
      t.database.migrator.selectFrom('student_moves').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('class_memberships').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('group_memberships').selectAll().orderBy('id').execute(),
      t.auditCount(),
    ]);

  /** How many connections to the test database wait for a lock right now. */
  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(t.database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  /** Runs `work` in a transaction of the application that stays open until released. */
  async function holdOpen(work: (transaction: Transaction) => Promise<void>) {
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
      .run([t.north], async (transaction) => {
        await work(transaction);
        ready();
        await released;
      })
      .catch((error: unknown) => error);
    await Promise.race([isReady, done]);
    return { release, done };
  }

  /**
   * Two real routes in a fixed order (`.claude/rules/api.md`): a third
   * transaction holds the student, the first route starts and waits, then the
   * second; the asserts depend on which committed first.
   */
  async function inOrder(
    studentId: string,
    first: () => Promise<Response>,
    second: () => Promise<Response>,
  ): Promise<[Response, Response]> {
    const gate = await holdOpen(async (transaction) => {
      await transaction
        .selectFrom('students')
        .select('id')
        .where('id', '=', studentId)
        .forUpdate()
        .execute();
    });
    const one = first().then((response) => response);
    await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
    const two = second().then((response) => response);
    await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(1);
    gate.release();
    expect(await gate.done).toBeUndefined();
    return [await one, await two];
  }

  beforeAll(async () => {
    t = await dayTemplatesKit();
    classes = new ClassesKit(t.database.migrator);
    year = await classes.year(t.north);
    southYear = await classes.year(t.south);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('a scheduled transfer', () => {
    it('keeps the student in the class with a badge until the date and holds the seat', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass({ maxSize: 1 });
      const one = await pupil(oxford);
      const response = await transfer(one.id, yale);
      const detail = ok(response);
      expect(detail.class?.id).toBe(oxford);
      expect(detail.plannedClass).toMatchObject({ id: yale, from: TOMORROW });
      expect(detail.scheduledMoves).toEqual([
        expect.objectContaining({
          kind: 'class',
          from: TOMORROW,
          state: 'scheduled',
          fromClass: expect.objectContaining({ id: oxford }),
          toClass: expect.objectContaining({ id: yale }),
          undoable: false,
        }),
      ]);
      const move = moveOf(detail);
      expect(await classRows(one.id)).toEqual([
        expect.objectContaining({
          class_id: oxford,
          valid_from: '2026-09-02',
          valid_until: TOMORROW,
          ended_by: 'transfer',
          ended_by_move_id: move,
        }),
        expect.objectContaining({
          class_id: yale,
          valid_from: TOMORROW,
          valid_until: '2027-06-01',
          cause: 'transfer',
          written_by_move_id: move,
        }),
      ]);
      const [entry] = await t.entries('student.class_transferred', one.id);
      expect(entry).toMatchObject({
        assignment_id: t.viceAssignment,
        request_id: response.headers['x-request-id'],
        new_value: { moveId: move, fromClassId: oxford, toClassId: yale, from: TOMORROW },
      });
      // "the seat in the target class is reserved": its only seat is taken from the date.
      const two = await pupil(oxford);
      refusedWith(await transfer(two.id, yale), 409, 'class_full');
    });

    it('changes the class or the date in one step until the date', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const harvard = await schoolClass();
      const one = await pupil(oxford);
      const first = moveOf(ok(await transfer(one.id, yale)));
      const response = await post(`/api/classes/transfers/${first}/change`, {
        version: (await fresh(one.id)).version,
        toClassId: harvard,
        from: '2026-10-19',
      });
      const detail = ok(response);
      expect(detail.scheduledMoves).toEqual([
        expect.objectContaining({
          from: '2026-10-19',
          toClass: expect.objectContaining({ id: harvard }),
        }),
      ]);
      expect(await held(one.id)).toEqual([
        [oxford, '2026-09-02', TOMORROW],
        [oxford, TOMORROW, '2026-10-19'],
        [harvard, '2026-10-19', '2027-06-01'],
      ]);
      const entries = await t.entries('student.class_transfer_changed', one.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        old_value: { moveId: first },
        new_value: { toClassId: harvard, from: '2026-10-19' },
      });
    });

    it('cancels until the date and gives the class back; refuses once the date has come', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      const move = moveOf(ok(await transfer(one.id, yale)));
      const detail = ok(await cancelMove(one.id, move));
      expect(detail.scheduledMoves).toEqual([]);
      expect(detail.plannedClass).toBeNull();
      expect(await held(one.id)).toEqual([
        [oxford, '2026-09-02', TOMORROW],
        [oxford, TOMORROW, '2027-06-01'],
      ]);
      expect(await t.entries('student.class_transfer_cancelled', one.id)).toHaveLength(1);
      refusedWith(await cancelMove(one.id, move), 409, 'move_not_scheduled');
      // A move dated today has begun: it is undone, not cancelled.
      const two = await pupil(oxford);
      const today = moveOf(ok(await transfer(two.id, yale, TODAY)));
      refusedWith(await cancelMove(two.id, today), 409, 'move_not_scheduled');
    });

    it('refuses a second move while one is scheduled, and a move into the same class', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const harvard = await schoolClass();
      const one = await pupil(oxford);
      ok(await transfer(one.id, yale));
      refusedWith(await transfer(one.id, harvard, '2026-10-20'), 409, 'move_scheduled');
      const two = await pupil(oxford);
      refusedWith(await transfer(two.id, oxford), 409, 'move_same_target');
      refusedWith(await transfer(two.id, yale, '2026-08-01'), 409, 'move_no_membership');
    });
  });

  describe('the date', () => {
    it('allows today and, for the Academic Vice Principal, a date in the past', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      const detail = ok(await transfer(one.id, yale, TODAY));
      expect(detail.class?.id).toBe(yale);
      const two = await pupil(oxford);
      // "A transfer is recorded a week late."
      const late = ok(await transfer(two.id, yale, '2026-10-03'));
      expect(late.class?.id).toBe(yale);
      expect(await held(two.id)).toEqual([
        [oxford, '2026-09-02', '2026-10-03'],
        [yale, '2026-10-03', '2027-06-01'],
      ]);
      const [entry] = await t.entries('student.class_transferred', two.id);
      expect(entry).toMatchObject({ new_value: { pastAssignmentId: t.viceAssignment } });
    });

    it('refuses a move in a closed year', async () => {
      const branch = await t.newBranch();
      const closed = await classes.year(branch);
      const oxford = await classes.schoolClass(branch, closed, { grade: 7 });
      const yale = await classes.schoolClass(branch, closed, { grade: 7 });
      const members = new MembersKit(t.database.migrator, await classes.account());
      const student = await members.student(branch, { startsOn: '2026-09-01' });
      await members.member({ branch, classId: oxford, studentId: student, from: '2026-09-01' });
      await classes.setYear(closed, 'closed');
      const version = 2;
      refusedWith(
        await t.post(
          '/api/classes/transfers',
          branch,
          { studentId: student, version, toClassId: yale, from: '2026-10-05' },
          t.admin,
        ),
        409,
        'class_year_closed',
      );
    });
  });

  describe('the language of the classes', () => {
    it('asks to confirm a move between classes of different languages', async () => {
      const oxford = await schoolClass({ language: 'uz' });
      const moscow = await schoolClass({ language: 'ru' });
      const one = await pupil(oxford);
      const before = await rowsOf();
      refusedWith(await transfer(one.id, moscow), 409, 'class_language_differs');
      expect(await rowsOf()).toEqual(before);
      ok(await transfer(one.id, moscow, TOMORROW, { confirmLanguage: true }));
      const [entry] = await t.entries('student.class_transferred', one.id);
      expect(entry).toMatchObject({ new_value: { confirmLanguage: true } });
    });
  });

  describe('the groups of a transfer', () => {
    it('keeps a group row whose group also draws from the new class', async () => {
      const english = await subject();
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      const across = await group(english, [oxford, yale]);
      placed(
        await post(`/api/groups/${across}/members`, {
          students: [{ id: one.id }],
          from: TOMORROW,
        }),
      );
      ok(await transfer(one.id, yale, '2026-10-19'));
      expect(await heldGroups(one.id)).toEqual([[across, TOMORROW, '2027-06-01']]);
    });

    it('ends a group row of a group of the old class only, and places the new class into its groups', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      const ofOxford = await group(maths, [oxford]);
      const ofYale = await group(maths, [yale]);
      placed(
        await post(`/api/groups/${ofOxford}/members`, {
          students: [{ id: one.id }],
          from: TOMORROW,
        }),
      );
      const move = moveOf(ok(await transfer(one.id, yale, '2026-10-19')));
      expect(await groupRows(one.id)).toEqual([
        expect.objectContaining({
          group_id: ofOxford,
          valid_from: TOMORROW,
          valid_until: '2026-10-19',
          ended_by: 'transfer',
        }),
        expect.objectContaining({
          group_id: ofYale,
          valid_from: '2026-10-19',
          cause: 'automatic',
          review: true,
        }),
      ]);
      const automatic = await t.database.migrator
        .selectFrom('group_memberships')
        .select('written_by_move_id')
        .where('student_id', '=', one.id)
        .where('group_id', '=', ofYale)
        .executeTakeFirstOrThrow();
      expect(automatic.written_by_move_id).toBe(move);
      // The cancel gives the old group back and withdraws the automatic row.
      ok(await cancelMove(one.id, move));
      expect(await heldGroups(one.id)).toEqual([
        [ofOxford, TOMORROW, '2026-10-19'],
        [ofOxford, '2026-10-19', '2027-06-01'],
      ]);
    });

    it('refuses all of it when a group subject of the new class has no free seat', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const already = await pupil(yale);
      const full = await group(maths, [yale], 1);
      placed(
        await post(`/api/groups/${full}/members`, {
          students: [{ id: already.id }],
          from: TOMORROW,
        }),
      );
      const one = await pupil(oxford);
      const before = await rowsOf();
      refusedWith(await transfer(one.id, yale), 409, 'class_group_no_seat');
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('the undo', () => {
    it('undoes a move that has begun, with a reason, giving the old class and groups back', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      const ofOxford = await group(maths, [oxford]);
      const ofYale = await group(maths, [yale]);
      placed(
        await post(`/api/groups/${ofOxford}/members`, { students: [{ id: one.id }], from: TODAY }),
      );
      const moved = ok(await transfer(one.id, yale, TODAY));
      expect(moved.lastClassMove).toMatchObject({ state: 'done', undoable: true });
      const move = moveOf(moved);
      const response = await undoMove(one.id, move);
      const detail = ok(response);
      expect(detail.class?.id).toBe(oxford);
      expect(detail.lastClassMove).toBeNull();
      expect(await held(one.id)).toEqual([
        [oxford, '2026-09-02', TODAY],
        [oxford, TODAY, '2027-06-01'],
      ]);
      expect(await heldGroups(one.id)).toEqual([[ofOxford, TODAY, '2027-06-01']]);
      expect((await groupRows(one.id)).find((row) => row.group_id === ofYale)).toMatchObject({
        ended_by: 'undone',
        valid_from: TODAY,
        valid_until: TODAY,
      });
      const [entry] = await t.entries('student.class_transfer_undone', one.id);
      expect(entry).toMatchObject({
        reason: 'Moved by mistake.',
        request_id: response.headers['x-request-id'],
      });
      refusedWith(await undoMove(one.id, move), 409, 'move_not_undoable');
    });

    it('refuses the undo of a scheduled move, and of one cut since by a leaving or a later move', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const harvard = await schoolClass();
      const one = await pupil(oxford);
      const scheduled = moveOf(ok(await transfer(one.id, yale)));
      refusedWith(await undoMove(one.id, scheduled), 409, 'move_not_undoable');
      const two = await pupil(oxford);
      const first = moveOf(ok(await transfer(two.id, yale, '2026-10-05')));
      ok(await transfer(two.id, harvard, TODAY));
      refusedWith(await undoMove(two.id, first), 409, 'move_not_undoable');
      const three = await pupil(oxford);
      const begun = moveOf(ok(await transfer(three.id, yale, TODAY)));
      await leave(three.id, '2026-12-31');
      refusedWith(await undoMove(three.id, begun), 409, 'move_not_undoable');
    });

    it('undoes the second of two moves in a row and keeps the first', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const harvard = await schoolClass();
      const one = await pupil(oxford);
      ok(await transfer(one.id, yale, '2026-10-05'));
      const second = moveOf(ok(await transfer(one.id, harvard, TODAY)));
      const detail = ok(await undoMove(one.id, second));
      expect(detail.class?.id).toBe(yale);
      expect(await held(one.id)).toEqual([
        [oxford, '2026-09-02', '2026-10-05'],
        [yale, '2026-10-05', TODAY],
        [yale, TODAY, '2027-06-01'],
      ]);
    });
  });

  describe('a leaving and a scheduled move', () => {
    // edge: "A student stopped coming on 1 October ... scheduled moves are
    // cancelled"; decision 8 and must-fix 1 of the plan review.
    it('cancels a move dated on or after the leaving; its cancel and its undo never bring the move back', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      const ofYale = await group(maths, [yale]);
      const move = moveOf(ok(await transfer(one.id, yale, '2026-10-19')));
      await leave(one.id, '2026-10-15');
      const [moveRow] = await t.database.migrator
        .selectFrom('student_moves')
        .select(['cancelled_at', 'cancelled_by_leaving_id'])
        .where('id', '=', move)
        .execute();
      expect(moveRow?.cancelled_at).not.toBeNull();
      expect(moveRow?.cancelled_by_leaving_id).not.toBeNull();
      const [leaving] = await t.entries('student.leave', one.id);
      expect(leaving).toMatchObject({ new_value: { movesCancelled: [move] } });
      const detail = ok(
        await post(`/api/people/students/${one.id}/leaving/cancel`, {
          version: (await fresh(one.id)).version,
        }),
      );
      expect(detail.class?.id).toBe(oxford);
      expect(detail.plannedClass).toBeNull();
      expect(await held(one.id)).toEqual([
        [oxford, '2026-09-02', '2026-10-16'],
        [oxford, '2026-10-16', '2027-06-01'],
      ]);
      expect((await heldGroups(one.id)).some(([groupId]) => groupId === ofYale)).toBe(false);
      // The same with an undo of a leaving in force.
      const two = await pupil(oxford);
      const later = moveOf(ok(await transfer(two.id, yale, '2026-10-19')));
      await leave(two.id, '2026-10-09');
      const undone = ok(
        await post(`/api/people/students/${two.id}/leaving/undo`, {
          version: (await fresh(two.id)).version,
          reason: 'Entered by mistake.',
        }),
      );
      expect(undone.class?.id).toBe(oxford);
      expect(await held(two.id)).toEqual([
        [oxford, '2026-09-02', '2026-10-10'],
        [oxford, '2026-10-10', '2027-06-01'],
      ]);
      expect((await fresh(two.id)).scheduledMoves.some((one) => one.id === later)).toBe(false);
    });

    it('leaves a move dated before the leaving in place, and cuts the new class at it', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      ok(await transfer(one.id, yale, '2026-10-19'));
      const detail = await leave(one.id, '2026-12-31');
      expect(detail.scheduledMoves).toHaveLength(1);
      expect(await held(one.id)).toEqual([
        [oxford, '2026-09-02', '2026-10-19'],
        [yale, '2026-10-19', '2027-01-01'],
      ]);
    });

    // Must-fix 5 of the plan review.
    it('cuts the new class at a scheduled leaving, and the cancel of the leaving gives it back', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      await leave(one.id, '2026-12-31');
      ok(await transfer(one.id, yale, '2026-10-19'));
      expect(await held(one.id)).toEqual([
        [oxford, '2026-09-02', '2026-10-19'],
        [yale, '2026-10-19', '2027-01-01'],
      ]);
      ok(
        await post(`/api/people/students/${one.id}/leaving/cancel`, {
          version: (await fresh(one.id)).version,
        }),
      );
      expect(await held(one.id)).toEqual([
        [oxford, '2026-09-02', '2026-10-19'],
        [yale, '2026-10-19', '2027-01-01'],
        [yale, '2027-01-01', '2027-06-01'],
      ]);
    });
  });

  describe('ids of another branch', () => {
    it('answers 404 for a student, a class or a move it cannot see, and changes nothing', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      const southClass = await classes.schoolClass(t.south, southYear, { grade: 7 });
      const before = await rowsOf();
      for (const body of [
        { studentId: UNKNOWN, version: one.version, toClassId: yale, from: TOMORROW },
        { studentId: one.id, version: one.version, toClassId: southClass, from: TOMORROW },
        { studentId: one.id, version: one.version, toClassId: UNKNOWN, from: TOMORROW },
      ]) {
        refusedWith(await post('/api/classes/transfers', body), 404, 'not_found');
      }
      for (const path of ['cancel', 'undo', 'change']) {
        refusedWith(
          await post(`/api/classes/transfers/${UNKNOWN}/${path}`, {
            version: one.version,
            ...(path === 'undo' ? { reason: 'Mistake.' } : {}),
            ...(path === 'change' ? { toClassId: yale, from: TOMORROW } : {}),
          }),
          404,
          'not_found',
        );
      }
      expect(await rowsOf()).toEqual(before);
      // A move of the North branch from the South branch, as the Super Admin.
      const move = moveOf(ok(await transfer(one.id, yale)));
      const after = await rowsOf();
      refusedWith(
        await t.post(
          `/api/classes/transfers/${move}/cancel`,
          t.south,
          { version: (await fresh(one.id)).version },
          t.admin,
        ),
        404,
        'not_found',
      );
      expect(await rowsOf()).toEqual(after);
    });
  });

  describe('two people move the same student at the same moment', () => {
    it('refuses the second of two transfers "student changed", both directions', async () => {
      for (const order of [0, 1]) {
        const oxford = await schoolClass();
        const [yale, harvard] = [await schoolClass(), await schoolClass()];
        const one = await pupil(oxford);
        const version = (await fresh(one.id)).version;
        const send = (toClassId: string) => () =>
          post('/api/classes/transfers', { studentId: one.id, version, toClassId, from: TOMORROW });
        const [first, second] = await inOrder(
          one.id,
          send(order === 0 ? yale : harvard),
          send(order === 0 ? harvard : yale),
        );
        expect(first.status, JSON.stringify(first.body)).toBe(200);
        refusedWith(second, 409, 'student_changed');
        expect((await fresh(one.id)).plannedClass?.id).toBe(order === 0 ? yale : harvard);
      }
    });

    it('meets a transfer and a leaving, both directions', async () => {
      for (const order of [0, 1]) {
        const oxford = await schoolClass();
        const yale = await schoolClass();
        const one = await pupil(oxford);
        const version = (await fresh(one.id)).version;
        const moving = () =>
          post('/api/classes/transfers', {
            studentId: one.id,
            version,
            toClassId: yale,
            from: '2026-10-19',
          });
        const leaving = () =>
          post(`/api/people/students/${one.id}/leaving`, {
            lastDay: '2026-10-15',
            reason: 'The family moved.',
            version,
          });
        const [first, second] = await inOrder(
          one.id,
          order === 0 ? moving : leaving,
          order === 0 ? leaving : moving,
        );
        expect(first.status, JSON.stringify(first.body)).toBe(200);
        refusedWith(second, 409, 'student_changed');
        expect((await fresh(one.id)).scheduledMoves).toHaveLength(order === 0 ? 1 : 0);
      }
    });

    it('meets the change and the cancel of one scheduled move, both directions', async () => {
      for (const order of [0, 1]) {
        const oxford = await schoolClass();
        const [yale, harvard] = [await schoolClass(), await schoolClass()];
        const one = await pupil(oxford);
        const move = moveOf(ok(await transfer(one.id, yale)));
        const version = (await fresh(one.id)).version;
        const changing = () =>
          post(`/api/classes/transfers/${move}/change`, {
            version,
            toClassId: harvard,
            from: TOMORROW,
          });
        const cancelling = () => post(`/api/classes/transfers/${move}/cancel`, { version });
        const [first, second] = await inOrder(
          one.id,
          order === 0 ? changing : cancelling,
          order === 0 ? cancelling : changing,
        );
        expect(first.status, JSON.stringify(first.body)).toBe(200);
        refusedWith(second, 409, 'student_changed');
        expect((await fresh(one.id)).plannedClass?.id ?? null).toBe(order === 0 ? harvard : null);
      }
    });
  });
});
