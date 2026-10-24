import {
  apiErrorSchema,
  branchMoveGroupsSchema,
  branchMoveTargetsSchema,
  incomingBranchMovesSchema,
  studentDetailSchema,
  studentHistorySchema,
  type StudentDetail,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import {
  dayTemplatesKit,
  TODAY,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { relativesInput } from '../../testing/relatives-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const TOMORROW = '2026-10-11';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const accepted = (response: Response): StudentDetail => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return studentDetailSchema.parse(response.body);
};

// All names are invented. edge/students-classes-groups, "A student moves to
// another branch": "The sending Academic Vice Principal releases the student
// and the receiving one accepts, choosing class and groups; the Super Admin
// can do both. The record, UID, relatives and history stay the same and are
// readable in the new branch." Task 3.3c, pull request #97 with corrections 1
// to 3 of its review. The clock stands at 23:55 on Saturday 10 October 2026
// in Tashkent.
describe('the move of a student to another branch', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let northYear: string;
  let southYear: string;
  let nextSouthYear: string;
  let members: MembersKit;
  let east: string;
  let southVice: string;
  let eastVice: string;
  let count = 0;

  /** A new student's body: grade 7, from 2 September, in the class named. */
  function body(classId: string): Record<string, unknown> {
    count += 1;
    return {
      uid: String(2609100 + count),
      confirmUidSet: true,
      firstName: 'Shahnoza',
      lastName: `Yusupova${'s'.repeat(count % 9)}${String.fromCharCode(97 + (count % 26))}`,
      paternalName: null,
      sex: 'female',
      birthDate: `2013-03-${String((count % 28) + 1).padStart(2, '0')}`,
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
      contract: { number: `BM-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives: relativesInput(),
      classId,
    };
  }

  /** A student of a new 7th class of the branch (Uzbek unless said), from 2 September. */
  async function pupil(
    branch?: string,
    classId?: string,
  ): Promise<{ student: StudentDetail; classId: string }> {
    const at = branch ?? t.north;
    const year = at === t.north ? northYear : at === t.south ? southYear : await yearOf(at);
    const own = classId ?? (await classes.schoolClass(at, year, { grade: 7 }));
    const response = await t.post('/api/people/students', at, body(own));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return { student: studentDetailSchema.parse(response.body), classId: own };
  }

  const yearOf = async (branch: string) =>
    (
      await t.database.migrator
        .selectFrom('academic_years')
        .select('id')
        .where('branch_id', '=', branch)
        .executeTakeFirstOrThrow()
    ).id;

  const fresh = async (id: string, branch = t.north): Promise<StudentDetail> =>
    studentDetailSchema.parse((await t.get(`/api/people/students/${id}`, branch)).body);

  const southClass = (input: { language?: 'uz' | 'ru'; maxSize?: number; grade?: number } = {}) =>
    classes.schoolClass(t.south, southYear, { grade: 7, ...input });

  /** A release by the North's Academic Vice Principal unless said. */
  const release = async (
    id: string,
    input: { to?: string; from?: string; version?: number; cookie?: string; branch?: string } = {},
  ) =>
    t.post(
      `/api/people/students/${id}/branch-move`,
      input.branch ?? t.north,
      {
        toBranchId: input.to ?? t.south,
        from: input.from ?? TODAY,
        version: input.version ?? (await fresh(id, input.branch ?? t.north)).version,
      },
      input.cookie ?? t.vicePrincipal,
    );

  /** A pupil released to the South today; answers the release's id. */
  async function released(input: { from?: string } = {}) {
    const facts = await pupil();
    const detail = accepted(await release(facts.student.id, input));
    const moveId = detail.branchMove?.id;
    if (moveId === undefined) {
      throw new Error('The release is not on the record.');
    }
    return { ...facts, moveId };
  }

  /** An accept by the South's Academic Vice Principal unless said. */
  const accept = (
    moveId: string,
    input: {
      classId: string;
      groups?: { subjectId: string; groupId: string }[];
      confirmLanguage?: boolean;
    },
    cookie = southVice,
    branch = t.south,
  ) =>
    t.post(`/api/people/branch-moves/${moveId}/accept`, branch, { groups: [], ...input }, cookie);

  const incoming = async (branch = t.south, cookie = southVice) => {
    const response = await t.get('/api/people/branch-moves/incoming', branch, cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return incomingBranchMovesSchema.parse(response.body);
  };

  /** Every row of the tables the routes write, in every branch, and the log. */
  const rowsOf = () =>
    Promise.all([
      t.database.migrator.selectFrom('students').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('student_branch_moves').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('class_memberships').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('group_memberships').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('student_statuses').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('student_relatives').selectAll().orderBy('id').execute(),
      // Task 8.6: the journal side of the change (`journal-entries.ts`).
      t.database.migrator.selectFrom('journal_cells').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('journal_voids').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('journal_optional_cells').selectAll().orderBy('id').execute(),
      t.auditCount(),
    ]);

  const classRowsOf = (id: string) =>
    t.database.migrator
      .selectFrom('class_memberships')
      .select(['branch_id', 'class_id', 'valid_from', 'valid_until', 'cause', 'ended_by'])
      .where('student_id', '=', id)
      .orderBy('valid_from')
      .orderBy('id')
      .execute();

  const groupRowsOf = (id: string) =>
    t.database.migrator
      .selectFrom('group_memberships')
      .select(['branch_id', 'group_id', 'valid_from', 'valid_until', 'cause', 'review', 'ended_by'])
      .where('student_id', '=', id)
      .orderBy('valid_from')
      .orderBy('id')
      .execute();

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
  async function holdOpen(branches: string[], work: (transaction: Transaction) => Promise<void>) {
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
      .run(branches, async (transaction) => {
        await work(transaction);
        ready();
        await released;
      })
      .catch((error: unknown) => error);
    await Promise.race([isReady, done]);
    return { release, done };
  }

  /**
   * Two real routes in a fixed order (`inOrder` of `class-groups.test.ts`): a
   * third transaction holds a row both lock first, the first route waits on
   * it, then the second; the first runs to its commit before the second reads.
   */
  async function inOrder(
    hold: { table: 'students' | 'classes'; id: string; branch: string },
    first: () => Promise<Response>,
    second: () => Promise<Response>,
  ): Promise<[Response, Response]> {
    const gate = await holdOpen([hold.branch], async (transaction) => {
      await transaction
        .selectFrom(hold.table)
        .select('id')
        .where('id', '=', hold.id)
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
    // The closed year first: one year of a branch is current at a time.
    await classes.year(t.north, 'closed', '2025-09-01', '2026-05-31');
    northYear = await classes.year(t.north);
    southYear = await classes.year(t.south);
    nextSouthYear = await classes.year(t.south, 'planned', '2027-09-01', '2028-05-31');
    members = new MembersKit(t.database.migrator, await classes.account());
    east = await t.newBranch();
    await classes.year(east);
    const south = await t.kit.completeSession('Gulnora', 'Tursunova');
    await t.kit.giveRole(south.account.id, { role: 'academic_vice_principal', branchId: t.south });
    southVice = south.cookie;
    const eastBrowser = await t.kit.completeSession('Ravshan', 'Qodirov');
    await t.kit.giveRole(eastBrowser.account.id, {
      role: 'academic_vice_principal',
      branchId: east,
    });
    eastVice = eastBrowser.cookie;
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the release (edge: "The sending Academic Vice Principal releases the student")', () => {
    it('shows the release on the record and logs it in the sending branch', async () => {
      const { student } = await pupil();
      const detail = accepted(await release(student.id, { from: TOMORROW }));
      expect(detail.branchMove).toMatchObject({
        toBranch: { id: t.south, name: 'South' },
        from: TOMORROW,
        state: 'open',
      });
      expect(detail.canMoveBranch).toBe(true);
      const entries = await t.entries('student.branch_released', student.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        branch_id: t.north,
        new_value: { toBranchId: t.south, from: TOMORROW },
      });
      // The Principal reads it (view), and may not release.
      const principal = studentDetailSchema.parse(
        (await t.get(`/api/people/students/${student.id}`, t.north, t.principal)).body,
      );
      expect(principal.branchMove).toMatchObject({ state: 'open' });
      expect(principal.canMoveBranch).toBe(false);
    });

    it("answers 404 for another branch's student and an unknown branch or student, with nothing written", async () => {
      const { student } = await pupil(t.south);
      const before = await rowsOf();
      refusedWith(
        await t.post(
          `/api/people/students/${student.id}/branch-move`,
          t.north,
          { toBranchId: east, from: TODAY, version: student.version },
          t.vicePrincipal,
        ),
        404,
        'not_found',
      );
      // The Super Admin, whose transaction sees every branch, too.
      refusedWith(
        await t.post(`/api/people/students/${student.id}/branch-move`, t.north, {
          toBranchId: east,
          from: TODAY,
          version: student.version,
        }),
        404,
        'not_found',
      );
      expect(await rowsOf()).toEqual(before);
      const own = await pupil();
      const mid = await rowsOf();
      refusedWith(await release(own.student.id, { to: UNKNOWN }), 404, 'not_found');
      refusedWith(
        await t.post(
          `/api/people/students/${UNKNOWN}/branch-move`,
          t.north,
          { toBranchId: t.south, from: TODAY, version: 0 },
          t.vicePrincipal,
        ),
        404,
        'not_found',
      );
      expect(await rowsOf()).toEqual(mid);
    });

    it('refuses the same branch, a second release, a stale version, a closed state', async () => {
      const { student } = await pupil();
      refusedWith(await release(student.id, { to: t.north }), 409, 'branch_move_same_branch');
      refusedWith(
        await release(student.id, { version: student.version + 5 }),
        409,
        'student_changed',
      );
      accepted(await release(student.id));
      refusedWith(await release(student.id, { to: east }), 409, 'branch_move_open');
    });

    it('refuses a student not active on the date or with a leaving scheduled after it', async () => {
      const { student } = await pupil();
      const leave = await t.post(
        `/api/people/students/${student.id}/leaving`,
        t.north,
        { lastDay: '2026-10-20', reason: 'The family moves.', version: student.version },
        t.vicePrincipal,
      );
      expect(leave.status, JSON.stringify(leave.body)).toBe(200);
      refusedWith(await release(student.id, { from: TOMORROW }), 409, 'status_scheduled');
      refusedWith(await release(student.id, { from: '2026-10-25' }), 409, 'student_not_active');
    });

    it('refuses a release while a class move is scheduled, and a class move while a release is open', async () => {
      const { student } = await pupil();
      const yale = await classes.schoolClass(t.north, northYear, { grade: 7 });
      const move = await t.post(
        '/api/classes/transfers',
        t.north,
        { studentId: student.id, version: student.version, toClassId: yale, from: '2026-10-15' },
        t.vicePrincipal,
      );
      expect(move.status, JSON.stringify(move.body)).toBe(200);
      refusedWith(await release(student.id), 409, 'move_scheduled');
      const other = await pupil();
      accepted(await release(other.student.id, { from: TOMORROW }));
      refusedWith(
        await t.post(
          '/api/classes/transfers',
          t.north,
          {
            studentId: other.student.id,
            version: (await fresh(other.student.id)).version,
            toClassId: yale,
            from: '2026-10-15',
          },
          t.vicePrincipal,
        ),
        409,
        'branch_move_open',
      );
    });

    it('refuses a release dated before a class move that has begun', async () => {
      const { student } = await pupil();
      const yale = await classes.schoolClass(t.north, northYear, { grade: 7 });
      const moved = await t.post(
        '/api/classes/transfers',
        t.north,
        { studentId: student.id, version: student.version, toClassId: yale, from: TODAY },
        t.vicePrincipal,
      );
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      refusedWith(await release(student.id, { from: '2026-10-05' }), 409, 'move_before_later');
    });

    it('refuses a date outside any year of the branch, or in a closed one', async () => {
      const { student } = await pupil();
      const before = await rowsOf();
      refusedWith(
        await release(student.id, { from: '2027-07-01' }),
        409,
        'branch_move_outside_year',
      );
      refusedWith(
        await release(student.id, { from: '2026-03-02' }),
        409,
        'branch_move_year_closed',
      );
      expect(await rowsOf()).toEqual(before);
    });

    it('refuses a group move while a release is open', async () => {
      const english = await classes.subject({ grades: [7, 8] });
      const oxford = await classes.schoolClass(t.north, northYear, { grade: 7 });
      await classes.group(t.north, northYear, english, [oxford], { name: 'O-1' });
      const other = await classes.group(t.north, northYear, english, [oxford], { name: 'O-2' });
      const { student } = await pupil(t.north, oxford);
      const row = await t.database.migrator
        .selectFrom('group_memberships')
        .select(['id', 'group_id'])
        .where('student_id', '=', student.id)
        .executeTakeFirstOrThrow();
      accepted(await release(student.id, { from: TOMORROW }));
      refusedWith(
        await t.post(
          '/api/groups/transfers',
          t.north,
          {
            studentId: student.id,
            memberId: row.id,
            toGroupId:
              row.group_id === other
                ? await classes.group(t.north, northYear, english, [oxford], { name: 'O-3' })
                : other,
            from: '2026-10-15',
          },
          t.vicePrincipal,
        ),
        409,
        'branch_move_open',
      );
    });

    it('refuses a release, a class move and a group move of the new branch dated before the arrival', async () => {
      const english = await classes.subject({ grades: [7, 8] });
      const yale = await southClass();
      const g1 = await classes.group(t.south, southYear, english, [yale], { name: 'S-1' });
      const g2 = await classes.group(t.south, southYear, english, [yale], { name: 'S-2' });
      const harvard = await southClass();
      const { student, moveId } = await released({ from: '2026-10-05' });
      accepted(
        await accept(moveId, { classId: yale, groups: [{ subjectId: english, groupId: g1 }] }),
      );
      const version = (await fresh(student.id, t.south)).version;
      refusedWith(
        await release(student.id, {
          branch: t.south,
          to: t.north,
          from: '2026-10-03',
          cookie: southVice,
        }),
        409,
        'before_branch_move',
      );
      refusedWith(
        await t.post(
          '/api/classes/transfers',
          t.south,
          { studentId: student.id, version, toClassId: harvard, from: '2026-10-03' },
          southVice,
        ),
        409,
        'before_branch_move',
      );
      const row = await t.database.migrator
        .selectFrom('group_memberships')
        .select('id')
        .where('student_id', '=', student.id)
        .where('group_id', '=', g1)
        .executeTakeFirstOrThrow();
      refusedWith(
        await t.post(
          '/api/groups/transfers',
          t.south,
          { studentId: student.id, memberId: row.id, toGroupId: g2, from: '2026-10-03' },
          southVice,
        ),
        409,
        'before_branch_move',
      );
    });

    it('allows a date before today for the Academic Vice Principal in an open year', async () => {
      const { student } = await pupil();
      const detail = accepted(await release(student.id, { from: '2026-10-05' }));
      expect(detail.branchMove).toMatchObject({ from: '2026-10-05' });
    });
  });

  describe('the branches offered to the release', () => {
    it('lists every other branch by name, never the branch of the request', async () => {
      const response = await t.get('/api/people/branch-moves/targets', t.north, t.vicePrincipal);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const ids = branchMoveTargetsSchema.parse(response.body).branches.map((one) => one.id);
      expect(ids).toContain(t.south);
      expect(ids).toContain(east);
      expect(ids).not.toContain(t.north);
    });
  });

  describe('the cancel by the sending branch', () => {
    it('cancels an open release once, and answers 404 to the receiving branch', async () => {
      const { student, moveId } = await released({ from: TOMORROW });
      const before = await rowsOf();
      refusedWith(
        await t.post(`/api/people/branch-moves/${moveId}/cancel`, t.south, {}, southVice),
        404,
        'not_found',
      );
      refusedWith(
        await t.post(`/api/people/branch-moves/${UNKNOWN}/cancel`, t.north, {}, t.vicePrincipal),
        404,
        'not_found',
      );
      expect(await rowsOf()).toEqual(before);
      const detail = accepted(
        await t.post(`/api/people/branch-moves/${moveId}/cancel`, t.north, {}, t.vicePrincipal),
      );
      expect(detail.branchMove).toBeNull();
      refusedWith(
        await t.post(`/api/people/branch-moves/${moveId}/cancel`, t.north, {}, t.vicePrincipal),
        409,
        'branch_move_closed',
      );
      expect(await t.entries('student.branch_release_cancelled', student.id)).toHaveLength(1);
      expect((await incoming()).moves.map((move) => move.id)).not.toContain(moveId);
    });
  });

  describe('the incoming list (decision 2)', () => {
    it('shows the UID, name and grade of a student released to the branch, and nothing to other branches', async () => {
      const { student, moveId } = await released({ from: TOMORROW });
      const list = await incoming();
      const line = list.moves.find((move) => move.id === moveId);
      expect(line).toEqual({
        id: moveId,
        studentId: student.id,
        uid: student.uid,
        firstName: student.firstName,
        lastName: student.lastName,
        grade: 7,
        fromBranch: { id: t.north, name: 'North' },
        from: TOMORROW,
        acceptable: false,
      });
      expect(list.canDecide).toBe(true);
      expect((await incoming(t.north, t.vicePrincipal)).moves.map((move) => move.id)).not.toContain(
        moveId,
      );
      // The Super Admin reads the list of the branch of the request only.
      expect((await incoming(east, t.admin)).moves.map((move) => move.id)).not.toContain(moveId);
      expect((await incoming(t.south, t.admin)).moves.map((move) => move.id)).toContain(moveId);
      // The receiving branch does not open the record before the accept.
      refusedWith(
        await t.get(`/api/people/students/${student.id}`, t.south, southVice),
        404,
        'not_found',
      );
    });
  });

  describe('the groups offered to the accept', () => {
    it('lists the groups of each split or group subject of the class with their seats and the suggestion', async () => {
      const { moveId } = await released();
      const yale = await southClass();
      const english = await classes.subject({ grades: [7, 8] });
      const small = await classes.group(t.south, southYear, english, [yale], {
        size: 1,
        name: 'A-small',
      });
      const large = await classes.group(t.south, southYear, english, [yale], {
        size: 10,
        name: 'B-large',
      });
      const response = await t.get(
        `/api/people/branch-moves/${moveId}/groups?classId=${yale}`,
        t.south,
        southVice,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const answer = branchMoveGroupsSchema.parse(response.body);
      expect(answer.freeSeats).toBe(25);
      const subject = answer.subjects.find((one) => one.subjectId === english);
      expect(subject?.groups.map((group) => group.id).sort()).toEqual([small, large].sort());
      // Both empty: the smallest suitable group by the fewest members, then the name.
      expect(subject?.suggested).toBe(small);
    });

    it('answers 404 for a class of the sending branch, an unknown class, an unknown release and a release to another branch', async () => {
      const { moveId, classId } = await released();
      const yale = await southClass();
      const get = (id: string, cls: string, branch = t.south, cookie = southVice) =>
        t.get(`/api/people/branch-moves/${id}/groups?classId=${cls}`, branch, cookie);
      refusedWith(await get(moveId, classId), 404, 'not_found');
      refusedWith(await get(moveId, UNKNOWN), 404, 'not_found');
      refusedWith(await get(UNKNOWN, yale), 404, 'not_found');
      refusedWith(await get(moveId, yale, east, eastVice), 404, 'not_found');
      refusedWith(await get(moveId, yale, east, t.admin), 404, 'not_found');
      refusedWith(await get(moveId, yale, t.north, t.vicePrincipal), 404, 'not_found');
    });
  });

  describe('the accept (edge: "the receiving one accepts, choosing class and groups")', () => {
    it('cuts the old rows at the date, moves the record and places the class and its groups', async () => {
      const english = await classes.subject({ grades: [7, 8] });
      const maths = await classes.subject({ grades: [7, 8] });
      const oxford = await classes.schoolClass(t.north, northYear, { grade: 7 });
      const northGroup = await classes.group(t.north, northYear, english, [oxford]);
      const { student } = await pupil(t.north, oxford);
      const moveId =
        accepted(await release(student.id, { from: '2026-10-05' })).branchMove?.id ?? '';
      const yale = await southClass();
      const chosen = await classes.group(t.south, southYear, english, [yale], { size: 5 });
      await classes.group(t.south, southYear, english, [yale], { size: 9 });
      const mathsGroup = await classes.group(t.south, southYear, maths, [yale]);
      const response = await accept(moveId, {
        classId: yale,
        groups: [{ subjectId: english, groupId: chosen }],
      });
      const detail = accepted(response);
      expect(detail).toMatchObject({ id: student.id, uid: student.uid, grade: 7 });
      expect(detail.class?.id).toBe(yale);
      expect(detail.branchMove).toBeNull();
      expect(detail.lastBranchMove).toMatchObject({
        fromBranch: { id: t.north },
        toBranch: { id: t.south },
        from: '2026-10-05',
        state: 'accepted',
      });
      expect(await classRowsOf(student.id)).toEqual([
        {
          branch_id: t.north,
          class_id: oxford,
          valid_from: '2026-09-02',
          valid_until: '2026-10-05',
          cause: 'create',
          ended_by: 'branch_move',
        },
        {
          branch_id: t.south,
          class_id: yale,
          valid_from: '2026-10-05',
          valid_until: '2027-06-01',
          cause: 'branch_move',
          ended_by: null,
        },
      ]);
      const groups = await groupRowsOf(student.id);
      expect(groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            group_id: northGroup,
            valid_until: '2026-10-05',
            ended_by: 'branch_move',
          }),
          expect.objectContaining({ group_id: chosen, cause: 'branch_move', review: false }),
          expect.objectContaining({ group_id: mathsGroup, cause: 'automatic', review: true }),
        ]),
      );
      expect(groups).toHaveLength(3);
      // The record, its UID, relatives and contracts are of the new branch now.
      refusedWith(
        await t.get(`/api/people/students/${student.id}`, t.north, t.vicePrincipal),
        404,
        'not_found',
      );
      const relatives = await t.get(
        `/api/people/students/${student.id}/relatives`,
        t.south,
        southVice,
      );
      expect(relatives.status, JSON.stringify(relatives.body)).toBe(200);
      for (const table of [
        'student_uids',
        'student_contracts',
        'student_statuses',
        'student_relatives',
      ] as const) {
        const rows = await t.database.migrator
          .selectFrom(table)
          .select('branch_id')
          .where('student_id', '=', student.id)
          .execute();
        expect(
          rows.map((row) => row.branch_id),
          table,
        ).toEqual(rows.map(() => t.south));
      }
      // One entry in each branch's log.
      expect(await t.entries('student.branch_left', student.id)).toEqual([
        expect.objectContaining({ branch_id: t.north }),
      ]);
      expect(await t.entries('student.branch_moved', student.id)).toEqual([
        expect.objectContaining({
          branch_id: t.south,
          new_value: expect.objectContaining({ groupsChosen: 1, groupsPlaced: 1 }) as unknown,
        }),
      ]);
    });

    it("shows the old branch's lines on the History tab, the same for the Super Admin", async () => {
      const oxford = await classes.schoolClass(t.north, northYear, {
        grade: 7,
        name: 'Oxford Hist',
      });
      const { student } = await pupil(t.north, oxford);
      const moveId = accepted(await release(student.id)).branchMove?.id ?? '';
      const yale = await classes.schoolClass(t.south, southYear, { grade: 7, name: 'Yale Hist' });
      accepted(await accept(moveId, { classId: yale }));
      const lines = async (cookie: string) => {
        const response = await t.get(`/api/people/students/${student.id}/history`, t.south, cookie);
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        return studentHistorySchema.parse(response.body).lines;
      };
      const seen = await lines(southVice);
      const move = seen.find((line) => line.kind === 'branch_move');
      expect(move).toEqual({
        kind: 'branch_move',
        move: {
          id: moveId,
          fromBranch: { id: t.north, name: 'North' },
          toBranch: { id: t.south, name: 'South' },
          from: TODAY,
          state: 'accepted',
          cancelledByLeaving: false,
        },
        toClass: { id: yale, grade: 7, name: 'Yale Hist' },
      });
      const old = seen.find((line) => line.kind === 'class' && line.class.id === oxford);
      expect(old).toEqual({
        kind: 'class',
        class: { id: oxford, grade: 7, name: 'Oxford Hist' },
        from: '2026-09-02',
        until: TODAY,
      });
      expect(await lines(t.admin)).toEqual(seen);
    });

    // Task 3.5c (spec review of the build, must-fix 5; permission review,
    // should-fix 3): the old branch's lines read past the filter follow the
    // rules of this branch's: a changed move is one line with its changes, a
    // group stay ends where the move to the other branch cut it.
    it("draws the old branch's changed move as one line and its group stay to the move", async () => {
      const english = await classes.subject({ grades: [7] });
      const oxford = await classes.schoolClass(t.north, northYear, {
        grade: 7,
        name: 'Oxford Stay',
      });
      const princeton = await classes.schoolClass(t.north, northYear, {
        grade: 7,
        name: 'Princeton Stay',
      });
      const group = await classes.group(t.north, northYear, english, [oxford]);
      const { student } = await pupil(t.north, oxford);
      const post = async (path: string, body: object) => {
        const response = await t.post(path, t.north, body, t.vicePrincipal);
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        return studentDetailSchema.parse(response.body);
      };
      const first = await post('/api/classes/transfers', {
        studentId: student.id,
        version: (await fresh(student.id)).version,
        toClassId: princeton,
        from: '2026-10-16',
      });
      const firstMove = first.scheduledMoves[0]?.id ?? '';
      const changed = await post(`/api/classes/transfers/${firstMove}/change`, {
        version: first.version,
        toClassId: princeton,
        from: '2026-10-23',
      });
      const secondMove = changed.scheduledMoves[0]?.id ?? '';
      await post(`/api/classes/transfers/${secondMove}/cancel`, { version: changed.version });
      const moveId = accepted(await release(student.id)).branchMove?.id ?? '';
      const yale = await classes.schoolClass(t.south, southYear, { grade: 7, name: 'Yale Stay' });
      accepted(await accept(moveId, { classId: yale }));
      const lines = async (cookie: string) => {
        const response = await t.get(`/api/people/students/${student.id}/history`, t.south, cookie);
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        return studentHistorySchema.parse(response.body).lines;
      };
      const seen = await lines(southVice);
      const moves = seen.filter((line) => line.kind === 'move');
      expect(moves).toEqual([
        expect.objectContaining({
          move: expect.objectContaining({
            id: secondMove,
            from: '2026-10-23',
            state: 'cancelled',
          }) as unknown,
          changes: [
            {
              from: '2026-10-16',
              toClass: { id: princeton, grade: 7, name: 'Princeton Stay' },
              toGroup: null,
            },
          ],
        }),
      ]);
      expect(seen.filter((line) => line.kind === 'group' && line.group.id === group)).toEqual([
        {
          kind: 'group',
          group: { id: group, name: expect.any(String) as unknown },
          subjectId: english,
          from: '2026-09-02',
          until: TODAY,
        },
      ]);
      expect(seen.filter((line) => line.kind === 'class' && line.class.id === oxford)).toEqual([
        {
          kind: 'class',
          class: { id: oxford, grade: 7, name: 'Oxford Stay' },
          from: '2026-09-02',
          until: TODAY,
        },
      ]);
      expect(await lines(t.admin)).toEqual(seen);
    });

    it("answers 404 for the sending branch's class and group, unknown ids and a release not to the branch, with nothing written in either branch", async () => {
      const english = await classes.subject({ grades: [7, 8] });
      const oxford = await classes.schoolClass(t.north, northYear, { grade: 7 });
      const northGroup = await classes.group(t.north, northYear, english, [oxford]);
      const { student } = await pupil(t.north, oxford);
      const moveId = accepted(await release(student.id)).branchMove?.id ?? '';
      const yale = await southClass();
      const before = await rowsOf();
      refusedWith(await accept(moveId, { classId: oxford }), 404, 'not_found');
      refusedWith(await accept(moveId, { classId: UNKNOWN }), 404, 'not_found');
      refusedWith(
        await accept(moveId, {
          classId: yale,
          groups: [{ subjectId: english, groupId: northGroup }],
        }),
        404,
        'not_found',
      );
      refusedWith(
        await accept(moveId, { classId: yale, groups: [{ subjectId: english, groupId: UNKNOWN }] }),
        404,
        'not_found',
      );
      refusedWith(await accept(UNKNOWN, { classId: yale }), 404, 'not_found');
      // The sending branch, a third branch and the Super Admin in a third branch.
      refusedWith(
        await accept(moveId, { classId: yale }, t.vicePrincipal, t.north),
        404,
        'not_found',
      );
      refusedWith(await accept(moveId, { classId: yale }, eastVice, east), 404, 'not_found');
      refusedWith(await accept(moveId, { classId: yale }, t.admin, east), 404, 'not_found');
      refusedWith(
        await t.post(
          `/api/people/branch-moves/${moveId}/decline`,
          east,
          { reason: 'No seat' },
          t.admin,
        ),
        404,
        'not_found',
      );
      refusedWith(
        await t.post(
          `/api/people/branch-moves/${moveId}/decline`,
          t.north,
          { reason: 'No seat' },
          t.vicePrincipal,
        ),
        404,
        'not_found',
      );
      expect(await rowsOf()).toEqual(before);
      // The Super Admin in the receiving branch accepts.
      accepted(await accept(moveId, { classId: yale }, t.admin));
    });

    it('refuses before the date, a full class, another grade, a group not offered, all or none', async () => {
      const later = await released({ from: TOMORROW });
      const yale = await southClass();
      refusedWith(await accept(later.moveId, { classId: yale }), 409, 'branch_move_not_yet');
      const { student, moveId } = await released();
      const full = await southClass({ maxSize: 1 });
      await pupil(t.south, full);
      const eighth = await southClass({ grade: 8 });
      const english = await classes.subject({ grades: [7, 8] });
      const other = await southClass();
      const elsewhere = await classes.group(t.south, southYear, english, [other]);
      const before = await rowsOf();
      const fullRefusal = await accept(moveId, { classId: full });
      refusedWith(fullRefusal, 409, 'class_full');
      // Task 3.5b, H24: the refusal names the class and its first day without a seat.
      const [fullDetail] = apiErrorSchema.parse(fullRefusal.body).error.details ?? [];
      expect(fullDetail).toMatchObject({ classId: full, students: 1 });
      expect(fullDetail?.fullFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      refusedWith(await accept(moveId, { classId: eighth }), 409, 'class_grade_differs');
      refusedWith(
        await accept(moveId, {
          classId: yale,
          groups: [{ subjectId: english, groupId: elsewhere }],
        }),
        409,
        'branch_move_group',
      );
      expect(await rowsOf()).toEqual(before);
      expect((await classRowsOf(student.id)).every((row) => row.branch_id === t.north)).toBe(true);
      accepted(await accept(moveId, { classId: yale }));
    });

    it('refuses a class of a year that does not hold the date, all or none', async () => {
      const { moveId } = await released();
      const later = await classes.schoolClass(t.south, nextSouthYear, { grade: 7 });
      const before = await rowsOf();
      refusedWith(await accept(moveId, { classId: later }), 409, 'membership_outside_year');
      expect(await rowsOf()).toEqual(before);
    });

    it('asks a confirmation when the class left and the class chosen differ in language', async () => {
      const { moveId } = await released();
      const russian = await southClass({ language: 'ru' });
      const before = await rowsOf();
      refusedWith(await accept(moveId, { classId: russian }), 409, 'branch_move_language_differs');
      expect(await rowsOf()).toEqual(before);
      const detail = accepted(await accept(moveId, { classId: russian, confirmLanguage: true }));
      expect(detail.class?.id).toBe(russian);
    });
  });

  describe('the groups of the published version (task 5.5a-2c, decision 5)', () => {
    /**
     * A branch of its own whose class Yale draws two English groups, A and B
     * (both active); version 1 published from `first` teaches English in A
     * only, version 2 from `second` in B only. Before `first` the active
     * groups bind.
     */
    async function chain(first: string, second: string) {
      const kit = new LoadKit(t.database.migrator);
      const west = await t.newBranch();
      const year = await classes.year(west);
      const english = await classes.subject({ grades: [7] });
      const yale = await classes.schoolClass(west, year, { grade: 7 });
      const a = await classes.group(west, year, english, [yale], { name: 'A' });
      const b = await classes.group(west, year, english, [yale], { name: 'B' });
      const { staffId } = await kit.teacher(west, {
        subjects: [{ subject: english, grades: [7] }],
      });
      for (const [startsOn, group] of [
        [first, a],
        [second, b],
      ] as const) {
        const version = await kit.version(west, year, { startsOn });
        await kit.row({
          branch_id: west,
          version_id: version,
          group_id: group,
          subject_id: english,
          teacher_id: staffId,
        });
        await kit.setVersion(version, 'published');
      }
      return { west, english, yale, a, b };
    }

    /** A pupil of the North released to the branch from the date. */
    async function releasedTo(west: string, from: string) {
      const facts = await pupil();
      const detail = accepted(await release(facts.student.id, { to: west, from }));
      const moveId = detail.branchMove?.id;
      if (moveId === undefined) {
        throw new Error('The release is not on the record.');
      }
      return { ...facts, moveId };
    }

    it('offers the groups of every stretch from the date, and writes the chosen one only where it is taught', async () => {
      const { west, english, yale, a, b } = await chain('2026-11-02', '2026-12-07');
      const { student, moveId } = await releasedTo(west, TODAY);
      const response = await t.get(
        `/api/people/branch-moves/${moveId}/groups?classId=${yale}`,
        west,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const subject = branchMoveGroupsSchema
        .parse(response.body)
        .subjects.find((one) => one.subjectId === english);
      expect(subject?.groups.map((group) => group.id).sort()).toEqual([a, b].sort());
      accepted(
        await accept(
          moveId,
          { classId: yale, groups: [{ subjectId: english, groupId: a }] },
          t.admin,
          west,
        ),
      );
      const rows = (await groupRowsOf(student.id)).filter((row) => row.branch_id === west);
      // A until version 2 starts (the active groups and version 1 both teach
      // it), then B, placed automatically.
      expect(rows).toEqual([
        expect.objectContaining({
          group_id: a,
          valid_from: TODAY,
          valid_until: '2026-12-07',
          cause: 'branch_move',
          review: false,
        }),
        expect.objectContaining({
          group_id: b,
          valid_from: '2026-12-07',
          valid_until: '2027-06-01',
          cause: 'automatic',
          review: true,
        }),
      ]);
    });

    it('refuses a group of the class the published version does not teach from the date', async () => {
      // Version 2 is in force from 28 September, before the release's date.
      const { west, english, yale, a, b } = await chain('2026-09-14', '2026-09-28');
      const { moveId } = await releasedTo(west, TODAY);
      const response = await t.get(
        `/api/people/branch-moves/${moveId}/groups?classId=${yale}`,
        west,
      );
      const subject = branchMoveGroupsSchema
        .parse(response.body)
        .subjects.find((one) => one.subjectId === english);
      expect(subject?.groups.map((group) => group.id)).toEqual([b]);
      const before = await rowsOf();
      refusedWith(
        await accept(
          moveId,
          { classId: yale, groups: [{ subjectId: english, groupId: a }] },
          t.admin,
          west,
        ),
        409,
        'branch_move_group',
      );
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('the decline by the receiving branch', () => {
    it('closes the release with a reason, logged in both branches', async () => {
      const { student, moveId } = await released();
      const response = await t.post(
        `/api/people/branch-moves/${moveId}/decline`,
        t.south,
        { reason: 'No seat in grade 7 this term.' },
        southVice,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(
        incomingBranchMovesSchema.parse(response.body).moves.map((move) => move.id),
      ).not.toContain(moveId);
      expect((await fresh(student.id)).branchMove).toBeNull();
      const entries = await t.entries('student.branch_release_declined', student.id);
      expect(entries.map((entry) => entry.branch_id).sort()).toEqual([t.north, t.south].sort());
      refusedWith(
        await t.post(
          `/api/people/branch-moves/${moveId}/decline`,
          t.south,
          { reason: 'Again' },
          southVice,
        ),
        404,
        'not_found',
      );
    });
  });

  // The permission review of the build: the Super Admin's transaction sees
  // every branch, so these 404s are the route's own checks.
  describe('ids outside the branch of the request, also for the Super Admin', () => {
    it('answers 404 to a cancel by the Super Admin in the receiving or a third branch', async () => {
      const { moveId } = await released({ from: TOMORROW });
      const before = await rowsOf();
      for (const branch of [t.south, east]) {
        refusedWith(
          await t.post(`/api/people/branch-moves/${moveId}/cancel`, branch, {}, t.admin),
          404,
          'not_found',
        );
      }
      expect(await rowsOf()).toEqual(before);
    });

    it('answers 404 to a decline of an unknown release', async () => {
      const before = await rowsOf();
      refusedWith(
        await t.post(
          `/api/people/branch-moves/${UNKNOWN}/decline`,
          t.south,
          { reason: 'No seat' },
          southVice,
        ),
        404,
        'not_found',
      );
      expect(await rowsOf()).toEqual(before);
    });

    it('answers 404 to the History of a student of another branch, for the Super Admin too', async () => {
      const { student, moveId } = await released();
      accepted(await accept(moveId, { classId: await southClass() }));
      for (const cookie of [t.admin, t.vicePrincipal]) {
        refusedWith(
          await t.get(`/api/people/students/${student.id}/history`, t.north, cookie),
          404,
          'not_found',
        );
      }
    });

    it('names no class of the old branch as the class left, for the Super Admin as for the Academic Vice Principal', async () => {
      const { student, moveId } = await released();
      accepted(await accept(moveId, { classId: await southClass() }));
      // The first inactive day is the date of the move: the row of the new
      // class is emptied and the old branch's row ends on the same day.
      const left = await t.post(
        `/api/people/students/${student.id}/leaving`,
        t.south,
        {
          lastDay: '2026-10-09',
          reason: 'The family moved back.',
          version: (await fresh(student.id, t.south)).version,
        },
        southVice,
      );
      expect(left.status, JSON.stringify(left.body)).toBe(200);
      const read = async (cookie: string) =>
        studentDetailSchema.parse(
          (await t.get(`/api/people/students/${student.id}`, t.south, cookie)).body,
        ).classLeft?.id;
      const asAdmin = await read(t.admin);
      expect(asAdmin).toBe(await read(southVice));
    });
  });

  describe('the leaving and the move', () => {
    it('a leaving cancels an open release, and its cancel does not bring it back', async () => {
      const { student, moveId } = await released({ from: TOMORROW });
      const leave = await t.post(
        `/api/people/students/${student.id}/leaving`,
        t.north,
        {
          lastDay: '2026-10-20',
          reason: 'The family moves abroad.',
          version: (await fresh(student.id)).version,
        },
        t.vicePrincipal,
      );
      expect(leave.status, JSON.stringify(leave.body)).toBe(200);
      const stored = await t.database.migrator
        .selectFrom('student_branch_moves')
        .select(['cancelled_at', 'cancelled_by_leaving_id'])
        .where('id', '=', moveId)
        .executeTakeFirstOrThrow();
      expect(stored.cancelled_by_leaving_id).not.toBeNull();
      expect(await t.entries('student.leave', student.id)).toEqual([
        expect.objectContaining({
          new_value: expect.objectContaining({ branchMoveCancelled: moveId }) as unknown,
        }),
      ]);
      const cancel = await t.post(
        `/api/people/students/${student.id}/leaving/cancel`,
        t.north,
        { version: (await fresh(student.id)).version },
        t.vicePrincipal,
      );
      expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
      expect((await fresh(student.id)).branchMove).toBeNull();
    });

    it('refuses a leaving of the new branch dated before the move', async () => {
      const { student, moveId } = await released({ from: '2026-10-05' });
      const yale = await southClass();
      accepted(await accept(moveId, { classId: yale }));
      refusedWith(
        await t.post(
          `/api/people/students/${student.id}/leaving`,
          t.south,
          {
            lastDay: '2026-10-01',
            reason: 'Entered in the wrong branch.',
            version: (await fresh(student.id, t.south)).version,
          },
          southVice,
        ),
        409,
        'before_branch_move',
      );
    });
  });

  // Same moment, both directions (`.claude/rules/api.md`): every path locks
  // the student first; a third transaction holds it, the first route waits,
  // then the second.
  describe('two changes at the same moment', () => {
    const studentGate = (id: string) => ({ table: 'students' as const, id, branch: t.north });

    it('two accepts: the second finds the release closed', async () => {
      const { student, moveId } = await released();
      const yale = await southClass();
      const [one, two] = await inOrder(
        studentGate(student.id),
        () => accept(moveId, { classId: yale }),
        () => accept(moveId, { classId: yale }, t.admin),
      );
      accepted(one);
      refusedWith(two, 409, 'branch_move_closed');
    });

    it('an accept and a cancel, both directions', async () => {
      const first = await released();
      const yale = await southClass();
      const [a, b] = await inOrder(
        studentGate(first.student.id),
        () => accept(first.moveId, { classId: yale }),
        () =>
          t.post(`/api/people/branch-moves/${first.moveId}/cancel`, t.north, {}, t.vicePrincipal),
      );
      accepted(a);
      // The release went with the student: no longer of the sending branch.
      refusedWith(b, 404, 'not_found');
      const second = await released();
      const [c, d] = await inOrder(
        studentGate(second.student.id),
        () =>
          t.post(`/api/people/branch-moves/${second.moveId}/cancel`, t.north, {}, t.vicePrincipal),
        () => accept(second.moveId, { classId: yale }),
      );
      accepted(c);
      refusedWith(d, 409, 'branch_move_closed');
    });

    it('an accept and a decline: the second finds the release closed', async () => {
      const { student, moveId } = await released();
      const yale = await southClass();
      const [one, two] = await inOrder(
        studentGate(student.id),
        () =>
          t.post(
            `/api/people/branch-moves/${moveId}/decline`,
            t.south,
            { reason: 'No seat' },
            southVice,
          ),
        () => accept(moveId, { classId: yale }, t.admin),
      );
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      refusedWith(two, 409, 'branch_move_closed');
    });

    it('two accepts, the other order: the second finds the release closed', async () => {
      const { student, moveId } = await released();
      const yale = await southClass();
      const [one, two] = await inOrder(
        studentGate(student.id),
        () => accept(moveId, { classId: yale }, t.admin),
        () => accept(moveId, { classId: yale }),
      );
      accepted(one);
      refusedWith(two, 409, 'branch_move_closed');
    });

    it('an accept and a decline, the other order: the decline finds the release closed', async () => {
      const { student, moveId } = await released();
      const yale = await southClass();
      const [one, two] = await inOrder(
        studentGate(student.id),
        () => accept(moveId, { classId: yale }, t.admin),
        () =>
          t.post(
            `/api/people/branch-moves/${moveId}/decline`,
            t.south,
            { reason: 'No seat' },
            southVice,
          ),
      );
      accepted(one);
      refusedWith(two, 409, 'branch_move_closed');
    });

    it('a cancel and a leaving, both directions', async () => {
      const leaving = (id: string, version: number) => () =>
        t.post(
          `/api/people/students/${id}/leaving`,
          t.north,
          { lastDay: '2026-10-20', reason: 'The family moves.', version },
          t.vicePrincipal,
        );
      const cancel = (moveId: string) => () =>
        t.post(`/api/people/branch-moves/${moveId}/cancel`, t.north, {}, t.vicePrincipal);
      const first = await released({ from: TOMORROW });
      const firstVersion = (await fresh(first.student.id)).version;
      const [a, b] = await inOrder(
        studentGate(first.student.id),
        cancel(first.moveId),
        leaving(first.student.id, firstVersion),
      );
      accepted(a);
      expect(b.status, JSON.stringify(b.body)).toBe(200);
      // The release was cancelled by the cancel, not by the leaving.
      const cancelled = await t.database.migrator
        .selectFrom('student_branch_moves')
        .select('cancelled_by_leaving_id')
        .where('id', '=', first.moveId)
        .executeTakeFirstOrThrow();
      expect(cancelled.cancelled_by_leaving_id).toBeNull();
      const second = await released({ from: TOMORROW });
      const secondVersion = (await fresh(second.student.id)).version;
      const [c, d] = await inOrder(
        studentGate(second.student.id),
        leaving(second.student.id, secondVersion),
        cancel(second.moveId),
      );
      expect(c.status, JSON.stringify(c.body)).toBe(200);
      refusedWith(d, 409, 'branch_move_closed');
    });

    it('an accept and a placement of the same student in the old branch, both directions', async () => {
      const oxford = await classes.schoolClass(t.north, northYear, { grade: 7 });
      const yale = await southClass();
      // A student of the North with no class (written as a create of 2.4a left one).
      const withoutClass = async () => {
        const id = await members.student(t.north, { startsOn: '2026-09-02' });
        const detail = accepted(await release(id));
        return { id, moveId: detail.branchMove?.id ?? '', version: detail.version };
      };
      const place = (id: string, version: number) => () =>
        t.post(
          `/api/classes/${oxford}/members`,
          t.north,
          { students: [{ id, version }], from: TODAY },
          t.vicePrincipal,
        );
      const first = await withoutClass();
      const [a, b] = await inOrder(studentGate(first.id), place(first.id, first.version), () =>
        accept(first.moveId, { classId: yale }),
      );
      expect(a.status, JSON.stringify(a.body)).toBe(201);
      accepted(b);
      // The placement in the old branch starts on the date: the accept emptied it.
      expect(await classRowsOf(first.id)).toEqual([
        expect.objectContaining({
          branch_id: t.north,
          valid_from: TODAY,
          valid_until: TODAY,
          ended_by: 'branch_move',
        }),
        expect.objectContaining({ branch_id: t.south, cause: 'branch_move' }),
      ]);
      const second = await withoutClass();
      const [c, d] = await inOrder(
        studentGate(second.id),
        () => accept(second.moveId, { classId: yale }),
        place(second.id, second.version),
      );
      accepted(c);
      // The student is of the South now: the North's placement finds no student.
      refusedWith(d, 404, 'not_found');
    });

    it('an accept and a group transfer in the old branch, both directions', async () => {
      const english = await classes.subject({ grades: [7, 8] });
      const oxford = await classes.schoolClass(t.north, northYear, { grade: 7 });
      const g1 = await classes.group(t.north, northYear, english, [oxford], { name: 'N-1' });
      const g2 = await classes.group(t.north, northYear, english, [oxford], { name: 'N-2' });
      const yale = await southClass();
      const ready = async () => {
        const { student } = await pupil(t.north, oxford);
        const row = await t.database.migrator
          .selectFrom('group_memberships')
          .select(['id', 'group_id'])
          .where('student_id', '=', student.id)
          .executeTakeFirstOrThrow();
        const moveId = accepted(await release(student.id)).branchMove?.id ?? '';
        return { student, row, moveId };
      };
      const transfer = (id: string, row: { id: string; group_id: string }) => () =>
        t.post(
          '/api/groups/transfers',
          t.north,
          {
            studentId: id,
            memberId: row.id,
            toGroupId: row.group_id === g1 ? g2 : g1,
            from: TOMORROW,
          },
          t.vicePrincipal,
        );
      const first = await ready();
      const [a, b] = await inOrder(
        studentGate(first.student.id),
        transfer(first.student.id, first.row),
        () => accept(first.moveId, { classId: yale }),
      );
      refusedWith(a, 409, 'branch_move_open');
      accepted(b);
      const second = await ready();
      const [c, d] = await inOrder(
        studentGate(second.student.id),
        () => accept(second.moveId, { classId: yale }),
        transfer(second.student.id, second.row),
      );
      accepted(c);
      refusedWith(d, 404, 'not_found');
    });

    it('an accept and a leaving, both directions', async () => {
      const yale = await southClass();
      const first = await released();
      const version = (await fresh(first.student.id)).version;
      const leaving = (id: string, v: number) => () =>
        t.post(
          `/api/people/students/${id}/leaving`,
          t.north,
          { lastDay: '2026-10-20', reason: 'The family moves.', version: v },
          t.vicePrincipal,
        );
      const [a, b] = await inOrder(
        studentGate(first.student.id),
        () => accept(first.moveId, { classId: yale }),
        leaving(first.student.id, version),
      );
      accepted(a);
      refusedWith(b, 404, 'not_found');
      const second = await released();
      const secondVersion = (await fresh(second.student.id)).version;
      const [c, d] = await inOrder(
        studentGate(second.student.id),
        leaving(second.student.id, secondVersion),
        () => accept(second.moveId, { classId: yale }),
      );
      expect(c.status, JSON.stringify(c.body)).toBe(200);
      refusedWith(d, 409, 'branch_move_closed');
    });

    it('two releases of one student: the second finds one open', async () => {
      const { student } = await pupil();
      const version = (await fresh(student.id)).version;
      const [one, two] = await inOrder(
        studentGate(student.id),
        () => release(student.id, { version }),
        () => release(student.id, { version, to: east }),
      );
      accepted(one);
      // A release changes no status or class row: the same version, and the open release refuses.
      refusedWith(two, 409, 'branch_move_open');
    });

    it('a release and a class transfer, both directions', async () => {
      const yale = await classes.schoolClass(t.north, northYear, { grade: 7 });
      const transfer = (id: string, version: number) => () =>
        t.post(
          '/api/classes/transfers',
          t.north,
          { studentId: id, version, toClassId: yale, from: '2026-10-15' },
          t.vicePrincipal,
        );
      const first = (await pupil()).student;
      const [a, b] = await inOrder(
        studentGate(first.id),
        () => release(first.id, { version: first.version, from: TOMORROW }),
        transfer(first.id, first.version),
      );
      accepted(a);
      refusedWith(b, 409, 'branch_move_open');
      const second = (await pupil()).student;
      const [c, d] = await inOrder(
        studentGate(second.id),
        transfer(second.id, second.version),
        () => release(second.id, { version: second.version, from: TOMORROW }),
      );
      expect(c.status, JSON.stringify(c.body)).toBe(200);
      // The transfer wrote class rows: the release sent the version read before it.
      refusedWith(d, 409, 'student_changed');
    });

    it('an accept and a placement into the last seat of the class, both directions', async () => {
      const place = (classId: string, id: string, version: number) => () =>
        t.post(
          `/api/classes/${classId}/members`,
          t.south,
          { students: [{ id, version }], from: '2026-10-12' },
          southVice,
        );
      const noClass = async () => {
        const response = await t.post('/api/people/students', t.south, {
          ...body(UNKNOWN),
          classId: null,
          startsOn: '2026-10-12',
        });
        expect(response.status, JSON.stringify(response.body)).toBe(201);
        return studentDetailSchema.parse(response.body);
      };
      const first = await released();
      const firstClass = await southClass({ maxSize: 1 });
      const waiting = await noClass();
      const [a, b] = await inOrder(
        { table: 'classes', id: firstClass, branch: t.south },
        () => accept(first.moveId, { classId: firstClass }),
        place(firstClass, waiting.id, waiting.version),
      );
      accepted(a);
      refusedWith(b, 409, 'class_full');
      const second = await released();
      const secondClass = await southClass({ maxSize: 1 });
      const other = await noClass();
      const [c, d] = await inOrder(
        { table: 'classes', id: secondClass, branch: t.south },
        place(secondClass, other.id, other.version),
        () => accept(second.moveId, { classId: secondClass }),
      );
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      refusedWith(d, 409, 'class_full');
    });
  });
});
