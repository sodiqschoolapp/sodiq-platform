import {
  apiErrorSchema,
  classMembersSchema,
  studentDetailSchema,
  studentHistorySchema,
  studentMergePreviewSchema,
  studentMergeResultSchema,
  type StudentDetail,
  type StudentHistory,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import {
  dayTemplatesKit,
  TODAY,
  TOMORROW,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { relativesInput } from '../../testing/relatives-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const ok = (response: Response): StudentDetail => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return studentDetailSchema.parse(response.body);
};

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const YEAR_END = '2027-06-01';

// One stay in a class and in a group, on every path that split one before
// (task 3.5c, pull request #117; issue #105, H34 to H36). H36: "one continuous
// stay in one class is one stay everywhere ... a cancel or an undo gives the
// stay back as it was before, not as a new planned stay; the same for group
// stays ... a test for each path that can split a stay today: cancel of a
// scheduled leaving, cancel and change of a scheduled class move and group
// move, undo of a move, undo of a leaving, a merge of two records." H35: "one
// line per stay in a class, from its first to its last day (or
// 'hozirgacha')". H34: a changed move is "one move with its changes". All
// names are invented. The clock stands at 23:55 on Saturday 10 October 2026.
describe('one stay in a class and a group', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let year: string;
  let count = 0;

  const get = (path: string, cookie = t.vicePrincipal) => t.get(path, t.north, cookie);
  const post = (path: string, body: object = {}, cookie = t.vicePrincipal) =>
    t.post(path, t.north, body, cookie);

  /** A new student of grade 7 in the class from 2 September; the clock moves on a second. */
  async function pupil(classId: string, startsOn = '2026-09-02'): Promise<StudentDetail> {
    count += 1;
    const response = await post('/api/people/students', {
      uid: String(2607700 + count),
      confirmUidSet: true,
      firstName: 'Malika',
      lastName: `Karimova${'k'.repeat(count % 9)}${String.fromCharCode(97 + (count % 26))}`,
      paternalName: null,
      sex: 'female',
      birthDate: `2013-03-${String((count % 28) + 1).padStart(2, '0')}`,
      grade: 7,
      startsOn,
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
      contract: { number: `OS-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives: relativesInput(),
      classId,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    t.clock.advance(1000);
    return studentDetailSchema.parse(response.body);
  }

  const fresh = async (id: string): Promise<StudentDetail> =>
    studentDetailSchema.parse((await get(`/api/people/students/${id}`)).body);

  const schoolClass = (maxSize?: number) =>
    classes.schoolClass(t.north, year, { grade: 7, maxSize });
  const subject = () => classes.subject({ grades: [7] });
  const group = (subjectId: string, classIds: readonly string[], size = 20) =>
    classes.group(t.north, year, subjectId, classIds, { size });

  const leave = async (id: string, lastDay: string) =>
    ok(
      await post(`/api/people/students/${id}/leaving`, {
        lastDay,
        reason: 'The family moved.',
        version: (await fresh(id)).version,
      }),
    );
  const cancelLeaving = async (id: string) =>
    ok(
      await post(`/api/people/students/${id}/leaving/cancel`, {
        version: (await fresh(id)).version,
      }),
    );
  const undoLeaving = async (id: string) =>
    ok(
      await post(`/api/people/students/${id}/leaving/undo`, {
        version: (await fresh(id)).version,
        reason: 'Entered by mistake.',
      }),
    );

  const transfer = async (id: string, toClassId: string, from = TOMORROW) =>
    post('/api/classes/transfers', {
      studentId: id,
      version: (await fresh(id)).version,
      toClassId,
      from,
    });
  const changeMove = async (id: string, move: string, toClassId: string, from: string) =>
    ok(
      await post(`/api/classes/transfers/${move}/change`, {
        version: (await fresh(id)).version,
        toClassId,
        from,
      }),
    );
  const cancelMove = async (id: string, move: string) =>
    ok(await post(`/api/classes/transfers/${move}/cancel`, { version: (await fresh(id)).version }));
  const undoMove = async (id: string, move: string) =>
    ok(
      await post(`/api/classes/transfers/${move}/undo`, {
        version: (await fresh(id)).version,
        reason: 'Moved by mistake.',
      }),
    );

  const placeInGroup = async (groupId: string, studentId: string, from = TOMORROW) => {
    const response = await post(`/api/groups/${groupId}/members`, {
      students: [{ id: studentId }],
      from,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
  };
  const memberOf = async (studentId: string, groupId: string) => {
    const row = await t.database.migrator
      .selectFrom('group_memberships')
      .select('id')
      .where('student_id', '=', studentId)
      .where('group_id', '=', groupId)
      .whereRef('valid_from', '<', 'valid_until')
      .executeTakeFirstOrThrow();
    return row.id;
  };
  const moveGroup = async (
    studentId: string,
    fromGroup: string,
    toGroupId: string,
    from = TOMORROW,
  ) =>
    ok(
      await post('/api/groups/transfers', {
        studentId,
        memberId: await memberOf(studentId, fromGroup),
        toGroupId,
        from,
      }),
    );

  /** The id of the newest move of the student. */
  const lastMove = async (studentId: string) =>
    (
      await t.database.migrator
        .selectFrom('student_moves')
        .select('id')
        .where('student_id', '=', studentId)
        .orderBy('id', 'desc')
        .executeTakeFirstOrThrow()
    ).id;

  const history = async (id: string): Promise<StudentHistory> => {
    const response = await get(`/api/people/students/${id}/history`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return studentHistorySchema.parse(response.body);
  };

  /** The rows with days of the student in one class or one group. */
  const daysIn = async (
    table: 'class_memberships' | 'group_memberships',
    id: string,
    unit: string,
  ) =>
    (
      await t.database.migrator
        .selectFrom(table)
        .select(['id', 'valid_from', 'valid_until', 'own_until', 'ended_by'])
        .where('student_id', '=', id)
        .where(table === 'class_memberships' ? 'class_id' : 'group_id', '=', unit)
        .orderBy('valid_from')
        .execute()
    ).filter((row) => row.valid_from < row.valid_until);

  /**
   * The done-when of 3.5c: exactly one row with days in the class and in the
   * group, and one History line for each, read by kind and record
   * (`.claude/rules/api.md`).
   */
  async function oneStay(id: string, classId: string, groupId: string | null) {
    const classRows = await daysIn('class_memberships', id, classId);
    expect(classRows).toHaveLength(1);
    const lines = (await history(id)).lines;
    const classLines = lines.filter((line) => line.kind === 'class' && line.class.id === classId);
    expect(classLines).toHaveLength(1);
    if (groupId !== null) {
      expect(await daysIn('group_memberships', id, groupId)).toHaveLength(1);
      expect(
        lines.filter((line) => line.kind === 'group' && line.group.id === groupId),
      ).toHaveLength(1);
    }
    return { classRow: classRows[0], classLine: classLines[0], lines };
  }

  /** A class of 7th grade feeding one group of a subject, with a student in both from 2 September. */
  async function placed() {
    const oxford = await schoolClass();
    const maths = await subject();
    const maths1 = await group(maths, [oxford]);
    const one = await pupil(oxford);
    return { oxford, maths, maths1, one };
  }

  /** How many connections to the test database wait for a lock right now. */
  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(t.database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  /**
   * Two real routes in a fixed order (`.claude/rules/api.md`, `inOrder` of
   * `class-groups.test.ts`): a third transaction holds a row the first route
   * waits on, the second starts once the first waits, then the row is freed.
   */
  async function inOrder(
    table: 'classes' | 'groups',
    id: string,
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
    const gate = t.app
      .get(Transactions)
      .run([t.north], async (transaction: Transaction) => {
        await transaction.selectFrom(table).select('id').where('id', '=', id).forUpdate().execute();
        ready();
        await released;
      })
      .catch((error: unknown) => error);
    const early = await Promise.race([isReady.then(() => undefined), gate]);
    expect(early).toBeUndefined();
    // A request of supertest is sent once it is awaited.
    const one = first().then((response) => response);
    await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
    const two = second().then((response) => response);
    await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(1);
    release();
    expect(await gate).toBeUndefined();
    return [await one, await two];
  }

  beforeAll(async () => {
    t = await dayTemplatesKit();
    classes = new ClassesKit(t.database.migrator);
    year = await classes.year(t.north);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('each path of H36 ends with one stay in the class and the group', () => {
    it('the cancel of a scheduled leaving', async () => {
      const { oxford, maths1, one } = await placed();
      await leave(one.id, '2026-10-20');
      const back = await cancelLeaving(one.id);
      expect(back.class).toMatchObject({ id: oxford });
      expect(back.plannedClass).toBeNull();
      const { classRow, classLine } = await oneStay(one.id, oxford, maths1);
      expect(classRow).toMatchObject({
        valid_from: '2026-09-02',
        valid_until: YEAR_END,
        ended_by: null,
      });
      // "hozirgacha": a stay in force with no end.
      expect(classLine).toMatchObject({ from: '2026-09-02', until: null });
    });

    it('the undo of a leaving in force', async () => {
      const { oxford, maths1, one } = await placed();
      await leave(one.id, '2026-10-05');
      await undoLeaving(one.id);
      const { classRow } = await oneStay(one.id, oxford, maths1);
      expect(classRow).toMatchObject({ valid_until: YEAR_END, ended_by: null });
    });

    it('the cancel of a scheduled class move', async () => {
      const { oxford, maths1, one } = await placed();
      const yale = await schoolClass();
      ok(await transfer(one.id, yale));
      const back = await cancelMove(one.id, await lastMove(one.id));
      expect(back.plannedClass).toBeNull();
      await oneStay(one.id, oxford, maths1);
      expect(await daysIn('class_memberships', one.id, yale)).toEqual([]);
    });

    it('the change of the date and of the class of a scheduled class move, then its cancel', async () => {
      const { oxford, maths1, one } = await placed();
      const yale = await schoolClass();
      const harvard = await schoolClass();
      ok(await transfer(one.id, yale, '2026-10-16'));
      await changeMove(one.id, await lastMove(one.id), yale, '2026-10-23');
      await changeMove(one.id, await lastMove(one.id), harvard, '2026-10-23');
      // While scheduled, one stay in Oxford to the date of the move.
      const before = await daysIn('class_memberships', one.id, oxford);
      expect(before).toEqual([
        expect.objectContaining({
          valid_from: '2026-09-02',
          valid_until: '2026-10-23',
          ended_by: 'transfer',
        }),
      ]);
      // H34: one move with its changes, not three moves.
      const moves = (await history(one.id)).lines.filter((line) => line.kind === 'move');
      expect(moves).toHaveLength(1);
      expect(moves[0]).toMatchObject({
        move: { from: '2026-10-23', toClass: { id: harvard }, state: 'scheduled' },
        changes: [
          { from: '2026-10-16', toClass: { id: yale } },
          { from: '2026-10-23', toClass: { id: yale } },
        ],
      });
      await cancelMove(one.id, await lastMove(one.id));
      const { lines } = await oneStay(one.id, oxford, maths1);
      expect(lines.flatMap((line) => (line.kind === 'move' ? [line.move.state] : []))).toEqual([
        'cancelled',
      ]);
    });

    it('the undo of a class move that has begun', async () => {
      const { oxford, maths1, one } = await placed();
      const yale = await schoolClass();
      ok(await transfer(one.id, yale, TODAY));
      await undoMove(one.id, await lastMove(one.id));
      await oneStay(one.id, oxford, maths1);
    });

    it('the cancel, the change and the undo of a group move', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const maths = await subject();
      const [a, b, c] = [
        await group(maths, [oxford]),
        await group(maths, [oxford]),
        await group(maths, [oxford]),
      ];
      await placeInGroup(a, one.id, '2026-10-05');
      // Change, then cancel.
      await moveGroup(one.id, a, b, '2026-10-19');
      ok(
        await post(`/api/groups/transfers/${await lastMove(one.id)}/change`, {
          toGroupId: c,
          from: '2026-10-26',
        }),
      );
      ok(await post(`/api/groups/transfers/${await lastMove(one.id)}/cancel`, {}));
      await oneStay(one.id, oxford, a);
      expect(await daysIn('group_memberships', one.id, a)).toEqual([
        expect.objectContaining({
          valid_from: '2026-10-05',
          valid_until: YEAR_END,
          ended_by: null,
        }),
      ]);
      // An undo of one that has begun.
      await moveGroup(one.id, a, b, TODAY);
      ok(
        await post(`/api/groups/transfers/${await lastMove(one.id)}/undo`, {
          reason: 'Wrong group.',
        }),
      );
      await oneStay(one.id, oxford, a);
      expect(await daysIn('group_memberships', one.id, b)).toEqual([]);
    });

    it('a merge of two records of one student in one class and group', async () => {
      const oxford = await schoolClass();
      const maths = await subject();
      const maths1 = await group(maths, [oxford]);
      // The record kept holds the earlier UID; the other one began earlier.
      const kept = await pupil(oxford, '2026-09-10');
      const earlier = await pupil(oxford);
      const seen = studentMergePreviewSchema.parse(
        (await t.get(`/api/people/students/${earlier.id}/merge?uid=${kept.uid}`, t.north)).body,
      );
      const response = await t.post(`/api/people/students/${earlier.id}/merge`, t.north, {
        uid: kept.uid,
        reason: 'Created twice by mistake',
        digest: seen.digest,
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      studentMergeResultSchema.parse(response.body);
      const { classRow } = await oneStay(kept.id, oxford, maths1);
      expect(classRow).toMatchObject({ valid_from: '2026-09-02', valid_until: YEAR_END });
      const [entry] = await t.entries('student.merged', kept.id);
      const joined = (entry?.new_value as { rows?: { joined?: { table: string; from: string }[] } })
        .rows?.joined;
      expect(joined?.map((one) => [one.table, one.from])).toEqual([
        ['class_memberships', '2026-09-10'],
        ['group_memberships', '2026-09-10'],
      ]);
    });
  });

  describe('the steps of the hand test (H35, H36)', () => {
    it('Bekzod: a scheduled leaving cancelled leaves one line "until now" and one row in the class panel', async () => {
      const { oxford, one } = await placed();
      await leave(one.id, '2026-10-20');
      await cancelLeaving(one.id);
      const members = classMembersSchema.parse((await get(`/api/classes/${oxford}/members`)).body);
      const mine = members.members.filter((member) => member.studentId === one.id);
      // "5 Yale lists Bekzod twice": once now, and no planned row with its own withdraw.
      expect(mine).toEqual([expect.objectContaining({ state: 'current', until: YEAR_END })]);
      const { classLine } = await oneStay(one.id, oxford, null);
      expect(classLine).toMatchObject({ until: null });
    });

    it('Malika: moves made, undone, changed and cancelled, then a merge, leave one line for the class', async () => {
      const oxford = await schoolClass();
      const princeton = await schoolClass();
      const kept = await pupil(oxford, '2026-09-10');
      const one = await pupil(oxford);
      ok(await transfer(one.id, princeton, TODAY));
      await undoMove(one.id, await lastMove(one.id));
      ok(await transfer(one.id, princeton, '2026-10-16'));
      await changeMove(one.id, await lastMove(one.id), princeton, '2026-10-23');
      await cancelMove(one.id, await lastMove(one.id));
      ok(await transfer(one.id, princeton, '2026-10-30'));
      await cancelMove(one.id, await lastMove(one.id));
      const seen = studentMergePreviewSchema.parse(
        (await t.get(`/api/people/students/${one.id}/merge?uid=${kept.uid}`, t.north)).body,
      );
      const response = await t.post(`/api/people/students/${one.id}/merge`, t.north, {
        uid: kept.uid,
        reason: 'Created twice by mistake',
        digest: seen.digest,
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const { classLine, lines } = await oneStay(kept.id, oxford, null);
      expect(classLine).toMatchObject({ from: '2026-09-02', until: null });
      // The undone move and the two cancelled ones (one with its change) stay lines.
      expect(
        lines.flatMap((line) =>
          line.kind === 'move' ? [[line.move.state, line.changes.length]] : [],
        ),
      ).toEqual([
        ['cancelled', 0],
        ['cancelled', 1],
        ['undone', 0],
      ]);
    });
  });

  describe('the end of a row given back (correction 3 of the plan review)', () => {
    it('ends at the move again when a leaving dated before a move that had begun is undone', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      ok(await transfer(one.id, yale, '2026-10-05'));
      await leave(one.id, '2026-10-02');
      await undoLeaving(one.id);
      const move = await lastMove(one.id);
      expect(await daysIn('class_memberships', one.id, oxford)).toEqual([
        expect.objectContaining({
          valid_from: '2026-09-02',
          valid_until: '2026-10-05',
          ended_by: 'transfer',
        }),
      ]);
      const ended = await t.database.migrator
        .selectFrom('class_memberships')
        .select('ended_by_move_id')
        .where('student_id', '=', one.id)
        .where('class_id', '=', oxford)
        .executeTakeFirstOrThrow();
      expect(ended.ended_by_move_id).toBe(move);
      expect(await daysIn('class_memberships', one.id, yale)).toEqual([
        expect.objectContaining({
          valid_from: '2026-10-05',
          valid_until: YEAR_END,
          ended_by: null,
        }),
      ]);
    });

    it('ends at a scheduled leaving when a class move is cancelled', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      await leave(one.id, '2026-12-31');
      ok(await transfer(one.id, yale, '2026-10-19'));
      await cancelMove(one.id, await lastMove(one.id));
      expect(await daysIn('class_memberships', one.id, oxford)).toEqual([
        expect.objectContaining({
          valid_from: '2026-09-02',
          valid_until: '2027-01-01',
          ended_by: 'leaving',
        }),
      ]);
    });

    it('ends at a later class move when a group move under it is cancelled', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      const maths = await subject();
      const [a, b] = [await group(maths, [oxford]), await group(maths, [oxford])];
      await classes.group(t.north, year, maths, [yale]);
      await placeInGroup(a, one.id, '2026-10-05');
      await moveGroup(one.id, a, b, '2026-10-12');
      ok(await transfer(one.id, yale, '2026-10-19'));
      const classMove = await lastMove(one.id);
      const groupMove = (await fresh(one.id)).scheduledMoves.find((move) => move.kind === 'group');
      ok(await post(`/api/groups/transfers/${groupMove?.id ?? ''}/cancel`, {}));
      const rows = await t.database.migrator
        .selectFrom('group_memberships')
        .select(['valid_from', 'valid_until', 'ended_by', 'ended_by_move_id'])
        .where('student_id', '=', one.id)
        .where('group_id', '=', a)
        .whereRef('valid_from', '<', 'valid_until')
        .execute();
      expect(rows).toEqual([
        {
          valid_from: '2026-10-05',
          valid_until: '2026-10-19',
          ended_by: 'transfer',
          ended_by_move_id: classMove,
        },
      ]);
    });
  });

  describe('the version and the same-day move back', () => {
    it('answers student_changed to a form read before the cancel of a class move (decision 7)', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      ok(await transfer(one.id, yale));
      const before = await fresh(one.id);
      await cancelMove(one.id, await lastMove(one.id));
      refusedWith(
        await post(`/api/people/students/${one.id}/leaving`, {
          lastDay: '2026-10-20',
          reason: 'The family moved.',
          version: before.version,
        }),
        409,
        'student_changed',
      );
      await leave(one.id, '2026-10-20');
    });

    it('refuses a move back into the class on the day of the move: one stay (stay_continues)', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      ok(await transfer(one.id, yale, TODAY));
      const response = await transfer(one.id, oxford, TODAY);
      refusedWith(response, 409, 'stay_continues');
      expect(apiErrorSchema.parse(response.body).error.code).toBe('stay_continues');
    });
  });

  describe('a stay split before 0062', () => {
    it('gives the stay back as one row when a leaving cut a row and emptied the row a cancel wrote after it', async () => {
      // Spec review of the build, must-fix 2: the row a cancel wrote before
      // 0062, emptied by a later leaving dated earlier, is part of the stay.
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      await leave(one.id, '2026-10-01');
      const leaving = await t.database.migrator
        .selectFrom('student_statuses')
        .select('id')
        .where('student_id', '=', one.id)
        .where('status', '=', 'inactive')
        .executeTakeFirstOrThrow();
      const branch = await t.database.migrator
        .selectFrom('classes')
        .select('branch_id')
        .where('id', '=', oxford)
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .insertInto('class_memberships')
        .values({
          branch_id: branch.branch_id,
          student_id: one.id,
          class_id: oxford,
          valid_from: '2026-10-21',
          valid_until: '2026-10-21',
          own_until: YEAR_END,
          cause: 'cancel',
          ended_by: 'leaving',
          leaving_id: leaving.id,
        })
        .execute();
      await undoLeaving(one.id);
      expect(await daysIn('class_memberships', one.id, oxford)).toEqual([
        expect.objectContaining({
          valid_from: '2026-09-02',
          valid_until: YEAR_END,
          ended_by: null,
        }),
      ]);
    });
  });

  describe('the same-day move back into a group', () => {
    it('refuses it: one stay (stay_continues)', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const maths = await subject();
      const [a, b] = [await group(maths, [oxford]), await group(maths, [oxford])];
      await placeInGroup(a, one.id, '2026-10-05');
      await moveGroup(one.id, a, b, TODAY);
      refusedWith(
        await post('/api/groups/transfers', {
          studentId: one.id,
          memberId: await memberOf(one.id, b),
          toGroupId: a,
          from: TODAY,
        }),
        409,
        'stay_continues',
      );
    });
  });

  describe('the History tab', () => {
    it('shows a stay ahead as "from", a cut stay with its last day, and a past one ended', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      ok(await transfer(one.id, yale, '2026-10-19'));
      const lines = (await history(one.id)).lines;
      expect(lines.find((line) => line.kind === 'class' && line.class.id === yale)).toMatchObject({
        from: '2026-10-19',
        until: null,
      });
      expect(lines.find((line) => line.kind === 'class' && line.class.id === oxford)).toMatchObject(
        {
          from: '2026-09-02',
          until: '2026-10-19',
        },
      );
    });
  });

  describe('a give-back meets a placement into the last seat (same moment, both orders)', () => {
    it('in a class', async () => {
      for (const order of ['give back first', 'place first'] as const) {
        const oxford = await schoolClass(1);
        const one = await pupil(oxford);
        const other = await pupil(await schoolClass());
        await leave(one.id, '2026-10-20');
        const version = (await fresh(one.id)).version;
        // The other student leaves its class for Oxford's seat from the first inactive day.
        const otherVersion = (await fresh(other.id)).version;
        const giveBack = () => post(`/api/people/students/${one.id}/leaving/cancel`, { version });
        const place = () =>
          post('/api/classes/transfers', {
            studentId: other.id,
            version: otherVersion,
            toClassId: oxford,
            from: '2026-10-21',
          });
        const [first, second] = await inOrder(
          'classes',
          oxford,
          order === 'give back first' ? giveBack : place,
          order === 'give back first' ? place : giveBack,
        );
        expect(first.status, JSON.stringify(first.body)).toBe(200);
        refusedWith(second, 409, 'class_full');
      }
    });

    it('in a group', async () => {
      for (const order of ['give back first', 'place first'] as const) {
        const oxford = await schoolClass();
        const maths = await subject();
        const a = await group(maths, [oxford], 1);
        const b = await group(maths, [oxford], 1);
        const c = await group(maths, [oxford]);
        // Each placed into the smallest group with a seat: one in A, the other in B.
        const one = await pupil(oxford);
        const other = await pupil(oxford);
        expect(await daysIn('group_memberships', one.id, a)).toHaveLength(1);
        expect(await daysIn('group_memberships', other.id, b)).toHaveLength(1);
        // One's scheduled move to C frees A's seat from the 19th.
        await moveGroup(one.id, a, c, '2026-10-19');
        const move = await lastMove(one.id);
        const otherMember = await memberOf(other.id, b);
        const giveBack = () => post(`/api/groups/transfers/${move}/cancel`, {});
        const place = () =>
          post('/api/groups/transfers', {
            studentId: other.id,
            memberId: otherMember,
            toGroupId: a,
            from: '2026-10-19',
          });
        const [first, second] = await inOrder(
          'groups',
          a,
          order === 'give back first' ? giveBack : place,
          order === 'give back first' ? place : giveBack,
        );
        expect(first.status, JSON.stringify(first.body)).toBe(200);
        refusedWith(second, 409, 'group_full');
      }
    });
  });
});
