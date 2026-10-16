import { studentDetailSchema, studentHistorySchema, type StudentDetail } from '@sodiq/shared';
import { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClassesKit } from '../../testing/classes-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import {
  dayTemplatesKit,
  TODAY,
  TOMORROW,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { relativesInput } from '../../testing/relatives-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const ok = (response: Response): StudentDetail => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return studentDetailSchema.parse(response.body);
};

// All names are invented. docs/spec/04-people.md, Movements: "Class transfer
// and group transfer. One action with an effective date. ... Head Teachers
// move students between groups of their subjects"; docs/spec/02, Head
// Teacher: "Moves students between groups of those subjects"; the History
// tab (04, Profile tabs). Task 3.3a, pull request #95: decisions 2, 6, 9
// and 10 with corrections 1 to 3 of its review. The clock stands at 23:55 on
// Saturday 10 October 2026 in Tashkent.
describe('group transfers and the History tab', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let year: string;
  let southYear: string;
  let headSubject: string;
  let headTeacher: string;
  let headAssignment: string;
  let tutor: string;
  let tutorClass: string;
  let spiritual: string;
  let count = 0;

  const FROM = new Date('2026-09-01T00:00:00+05:00');

  const get = (path: string, cookie = t.vicePrincipal) => t.get(path, t.north, cookie);
  const post = (path: string, body: object = {}, cookie = t.vicePrincipal) =>
    t.post(path, t.north, body, cookie);

  async function pupil(classId: string): Promise<StudentDetail> {
    count += 1;
    const response = await post('/api/people/students', {
      uid: String(2607300 + count),
      confirmUidSet: true,
      firstName: 'Nodira',
      lastName: `Saidova${'e'.repeat(count % 9)}${String.fromCharCode(97 + (count % 26))}`,
      paternalName: null,
      sex: 'female',
      birthDate: `2013-06-${String((count % 28) + 1).padStart(2, '0')}`,
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
      contract: { number: `GT-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives: relativesInput(),
      classId,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body);
  }

  const fresh = async (id: string): Promise<StudentDetail> =>
    studentDetailSchema.parse((await get(`/api/people/students/${id}`)).body);

  const schoolClass = () => classes.schoolClass(t.north, year, { grade: 7 });

  const group = (subjectId: string, classIds: readonly string[], size = 20) =>
    classes.group(t.north, year, subjectId, classIds, { size });

  const placeInGroup = async (groupId: string, studentId: string, from = TOMORROW) => {
    const response = await post(`/api/groups/${groupId}/members`, {
      students: [{ id: studentId }],
      from,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
  };

  const rowOf = async (studentId: string, groupId: string) =>
    t.database.migrator
      .selectFrom('group_memberships')
      .select(['id', 'valid_from', 'valid_until', 'ended_by', 'ended_by_move_id', 'cause'])
      .where('student_id', '=', studentId)
      .where('group_id', '=', groupId)
      .orderBy('valid_from')
      .orderBy('id')
      .execute();

  const memberOf = async (studentId: string, groupId: string) => {
    const [row] = await rowOf(studentId, groupId);
    if (row === undefined) {
      throw new Error('No row.');
    }
    return row.id;
  };

  const held = async (studentId: string) =>
    (
      await t.database.migrator
        .selectFrom('group_memberships')
        .select(['group_id', 'valid_from', 'valid_until'])
        .where('student_id', '=', studentId)
        .orderBy('valid_from')
        .orderBy('id')
        .execute()
    )
      .filter((row) => row.valid_from < row.valid_until)
      .map((row) => [row.group_id, row.valid_from, row.valid_until]);

  const moveGroup = (
    studentId: string,
    memberId: string,
    toGroupId: string,
    from = TOMORROW,
    cookie = t.vicePrincipal,
  ) => post('/api/groups/transfers', { studentId, memberId, toGroupId, from }, cookie);

  const groupMove = (detail: StudentDetail) => {
    const move = detail.scheduledMoves.find((one) => one.kind === 'group');
    if (move === undefined) {
      throw new Error('No group move.');
    }
    return move.id;
  };

  const lastMoveId = async (studentId: string) => {
    const row = await t.database.migrator
      .selectFrom('student_moves')
      .select('id')
      .where('student_id', '=', studentId)
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    return row.id;
  };

  const rowsOf = () =>
    Promise.all([
      t.database.migrator.selectFrom('student_moves').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('group_memberships').selectAll().orderBy('id').execute(),
      t.auditCount(),
    ]);

  async function signedIn(first: string, last: string, role: string) {
    const browser = await t.kit.completeSession(first, last);
    if (role === 'tutor') {
      await classes.person(t.north, ['uz'], { accountId: browser.account.id, first, last });
    }
    const given = await t.kit.giveRole(browser.account.id, {
      role: role as never,
      branchId: t.north,
      ...(role === 'tutor' ? { validFrom: FROM } : {}),
      ...(role === 'head_teacher' ? { subjectIds: [headSubject] } : {}),
    });
    return { cookie: browser.cookie, assignment: given.id, accountId: browser.account.id };
  }

  beforeAll(async () => {
    t = await dayTemplatesKit();
    classes = new ClassesKit(t.database.migrator);
    year = await classes.year(t.north);
    southYear = await classes.year(t.south);
    headSubject = await classes.subject({ grades: [7] });
    const head = await signedIn('Bobur', 'Yoqubov', 'head_teacher');
    headTeacher = head.cookie;
    headAssignment = head.assignment;
    const tutoring = await signedIn('Feruza', 'Ergasheva', 'tutor');
    tutor = tutoring.cookie;
    tutorClass = await schoolClass();
    await classes.tutorRow(t.north, tutorClass, tutoring.assignment, { from: FROM });
    spiritual = (await signedIn('Sardor', 'Murodov', 'spiritual_vice_principal')).cookie;
  });

  afterAll(async () => {
    await t.close();
  });

  describe('a group transfer', () => {
    it('lets the Head Teacher of the subject move a student from a date', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const [a, b] = [await group(headSubject, [oxford]), await group(headSubject, [oxford])];
      await placeInGroup(a, one.id);
      const member = await memberOf(one.id, a);
      const response = await moveGroup(one.id, member, b, '2026-10-19', headTeacher);
      const detail = ok(response);
      expect(detail.scheduledMoves).toMatchObject([
        {
          kind: 'group',
          from: '2026-10-19',
          subjectId: headSubject,
          fromGroup: { id: a },
          toGroup: { id: b },
        },
      ]);
      expect(await held(one.id)).toEqual([
        [a, TOMORROW, '2026-10-19'],
        [b, '2026-10-19', '2027-06-01'],
      ]);
      const [entry] = await t.entries('student.group_transferred', one.id);
      expect(entry).toMatchObject({
        assignment_id: headAssignment,
        request_id: response.headers['x-request-id'],
        new_value: { fromGroupId: a, toGroupId: b, from: '2026-10-19' },
      });
    });

    it('refuses a Head Teacher another subject, and a date in the past', async () => {
      const other = await classes.subject({ grades: [7] });
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const [a, b] = [await group(other, [oxford]), await group(other, [oxford])];
      await placeInGroup(a, one.id, TODAY);
      const member = await memberOf(one.id, a);
      const before = await rowsOf();
      refusedWith(
        await moveGroup(one.id, member, b, TOMORROW, headTeacher),
        403,
        'permission_denied',
      );
      const [c, d] = [await group(headSubject, [oxford]), await group(headSubject, [oxford])];
      await placeInGroup(c, one.id, '2026-09-02');
      const own = await memberOf(one.id, c);
      const after = await rowsOf();
      refusedWith(await moveGroup(one.id, own, d, '2026-10-05', headTeacher), 403, 'move_in_past');
      expect(await rowsOf()).toEqual(after);
      expect(before).not.toEqual(after);
      // The Academic Vice Principal moves in the past ("a week late").
      ok(await moveGroup(one.id, own, d, '2026-10-05'));
    });

    it('refuses another subject, the same group, a group not of the class, a full group, an old row', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      const blocker = await pupil(oxford);
      const other = await classes.subject({ grades: [7] });
      const a = await group(headSubject, [oxford]);
      const ofOther = await group(other, [oxford]);
      const ofYale = await group(headSubject, [yale]);
      const full = await group(headSubject, [oxford], 1);
      await placeInGroup(full, blocker.id);
      await placeInGroup(a, one.id);
      const member = await memberOf(one.id, a);
      refusedWith(await moveGroup(one.id, member, ofOther), 409, 'group_transfer_subject');
      refusedWith(await moveGroup(one.id, member, a), 409, 'move_same_target');
      refusedWith(await moveGroup(one.id, member, ofYale), 409, 'student_not_in_group_class');
      refusedWith(await moveGroup(one.id, member, full), 409, 'group_full');
      // The row the person saw does not hold the date: it changed meanwhile.
      refusedWith(await moveGroup(one.id, member, ofYale, '2026-09-10'), 409, 'student_changed');
    });

    it('cancels until the date, changes in one step, and undoes once begun', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const two = await pupil(oxford);
      const [a, b, c] = [
        await group(headSubject, [oxford]),
        await group(headSubject, [oxford]),
        await group(headSubject, [oxford]),
      ];
      await placeInGroup(a, one.id);
      const move = groupMove(
        ok(await moveGroup(one.id, await memberOf(one.id, a), b, '2026-10-19')),
      );
      const changed = ok(
        await post(`/api/groups/transfers/${move}/change`, { toGroupId: c, from: '2026-10-26' }),
      );
      expect(await held(one.id)).toEqual([
        [a, TOMORROW, '2026-10-26'],
        [c, '2026-10-26', '2027-06-01'],
      ]);
      ok(await post(`/api/groups/transfers/${groupMove(changed)}/cancel`, {}));
      expect(await held(one.id)).toEqual([[a, TOMORROW, '2027-06-01']]);
      refusedWith(
        await post(`/api/groups/transfers/${groupMove(changed)}/cancel`, {}),
        409,
        'move_not_scheduled',
      );
      // Begun today: undone with a reason, not cancelled.
      await placeInGroup(a, two.id, TODAY);
      ok(await moveGroup(two.id, await memberOf(two.id, a), b, TODAY));
      const begun = await lastMoveId(two.id);
      refusedWith(
        await post(`/api/groups/transfers/${begun}/cancel`, {}),
        409,
        'move_not_scheduled',
      );
      const response = await post(`/api/groups/transfers/${begun}/undo`, {
        reason: 'Wrong group.',
      });
      ok(response);
      expect(await held(two.id)).toEqual([[a, TODAY, '2027-06-01']]);
      const [entry] = await t.entries('student.group_transfer_undone', two.id);
      expect(entry).toMatchObject({ reason: 'Wrong group.' });
    });

    // Correction 2 of the plan review.
    it('refuses the undo of a group move cut since by a class move or a leaving', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      const two = await pupil(oxford);
      const [a, b] = [await group(headSubject, [oxford]), await group(headSubject, [oxford])];
      await group(headSubject, [yale]);
      await placeInGroup(a, one.id, TODAY);
      ok(await moveGroup(one.id, await memberOf(one.id, a), b, TODAY));
      const move = await lastMoveId(one.id);
      ok(
        await post('/api/classes/transfers', {
          studentId: one.id,
          version: (await fresh(one.id)).version,
          toClassId: yale,
          from: TOMORROW,
        }),
      );
      refusedWith(
        await post(`/api/groups/transfers/${move}/undo`, { reason: 'Wrong group.' }),
        409,
        'move_not_undoable',
      );
      await placeInGroup(a, two.id, TODAY);
      ok(await moveGroup(two.id, await memberOf(two.id, a), b, TODAY));
      const other = await lastMoveId(two.id);
      ok(
        await post(`/api/people/students/${two.id}/leaving`, {
          lastDay: '2026-12-31',
          reason: 'The family moved.',
          version: (await fresh(two.id)).version,
        }),
      );
      refusedWith(
        await post(`/api/groups/transfers/${other}/undo`, { reason: 'Wrong group.' }),
        409,
        'move_not_undoable',
      );
    });

    // Correction 1 of the plan review.
    it('writes a group row inside a class row a scheduled move cut ending at the move, and its cancel gives the days back', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      const a = await group(headSubject, [oxford]);
      ok(
        await post('/api/classes/transfers', {
          studentId: one.id,
          version: (await fresh(one.id)).version,
          toClassId: yale,
          from: '2026-10-19',
        }),
      );
      const move = await lastMoveId(one.id);
      await placeInGroup(a, one.id);
      expect(await rowOf(one.id, a)).toEqual([
        expect.objectContaining({
          valid_from: TOMORROW,
          valid_until: '2026-10-19',
          ended_by: 'transfer',
          ended_by_move_id: move,
        }),
      ]);
      ok(
        await post(`/api/classes/transfers/${move}/cancel`, {
          version: (await fresh(one.id)).version,
        }),
      );
      expect(await held(one.id)).toEqual([[a, TOMORROW, '2027-06-01']]);
    });

    it('answers 404 for a student, a group row, a group or a move it cannot see', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const [a, b] = [await group(headSubject, [oxford]), await group(headSubject, [oxford])];
      await placeInGroup(a, one.id);
      const member = await memberOf(one.id, a);
      const south = await classes.schoolClass(t.south, southYear, { grade: 7 });
      const southGroup = await classes.group(t.south, southYear, headSubject, [south]);
      const other = await pupil(oxford);
      const before = await rowsOf();
      for (const body of [
        { studentId: UNKNOWN, memberId: member, toGroupId: b, from: TOMORROW },
        { studentId: one.id, memberId: UNKNOWN, toGroupId: b, from: TOMORROW },
        { studentId: other.id, memberId: member, toGroupId: b, from: TOMORROW },
        { studentId: one.id, memberId: member, toGroupId: UNKNOWN, from: TOMORROW },
        { studentId: one.id, memberId: member, toGroupId: southGroup, from: TOMORROW },
      ]) {
        refusedWith(await post('/api/groups/transfers', body), 404, 'not_found');
      }
      for (const path of ['cancel', 'undo', 'change']) {
        refusedWith(
          await post(`/api/groups/transfers/${UNKNOWN}/${path}`, {
            ...(path === 'undo' ? { reason: 'Mistake.' } : {}),
            ...(path === 'change' ? { toGroupId: b, from: TOMORROW } : {}),
          }),
          404,
          'not_found',
        );
      }
      expect(await rowsOf()).toEqual(before);
    });
  });

  // Permission review of the build, must-fixes 2 to 5 and should-fix 2.
  describe('the ids and the scope of group moves', () => {
    it('answers 404 for ids of another branch on every route, the rows of both branches unchanged', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const [a, b] = [await group(headSubject, [oxford]), await group(headSubject, [oxford])];
      await placeInGroup(a, one.id);
      const member = await memberOf(one.id, a);
      const south = await classes.schoolClass(t.south, southYear, { grade: 7 });
      const southMembers = new MembersKit(t.database.migrator, await classes.account());
      const southStudent = await southMembers.student(t.south, { startsOn: '2026-09-01' });
      await southMembers.member({
        branch: t.south,
        classId: south,
        studentId: southStudent,
        from: '2026-09-01',
      });
      const southGroup = await classes.group(t.south, southYear, headSubject, [south]);
      const southRow = await southMembers.groupMember({
        branch: t.south,
        groupId: southGroup,
        subjectId: headSubject,
        studentId: southStudent,
        from: '2026-09-01',
      });
      ok(await moveGroup(one.id, member, b, '2026-10-19'));
      const move = await lastMoveId(one.id);
      const before = await rowsOf();
      for (const body of [
        { studentId: southStudent, memberId: southRow, toGroupId: b, from: TOMORROW },
        { studentId: one.id, memberId: southRow, toGroupId: b, from: TOMORROW },
      ]) {
        refusedWith(await post('/api/groups/transfers', body), 404, 'not_found');
      }
      for (const path of ['cancel', 'undo', 'change']) {
        refusedWith(
          await t.post(
            `/api/groups/transfers/${move}/${path}`,
            t.south,
            {
              ...(path === 'undo' ? { reason: 'Mistake.' } : {}),
              ...(path === 'change' ? { toGroupId: southGroup, from: TOMORROW } : {}),
            },
            t.admin,
          ),
          404,
          'not_found',
        );
      }
      for (const toGroupId of [southGroup, UNKNOWN]) {
        refusedWith(
          await post(`/api/groups/transfers/${move}/change`, { toGroupId, from: '2026-10-26' }),
          404,
          'not_found',
        );
      }
      refusedWith(
        await t.get(`/api/people/students/${southStudent}/history`, t.north, t.vicePrincipal),
        404,
        'not_found',
      );
      expect(await rowsOf()).toEqual(before);
    });

    it('lets a Head Teacher change, cancel and undo moves of own subjects only, naming the assignment', async () => {
      const other = await classes.subject({ grades: [7] });
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const two = await pupil(oxford);
      const three = await pupil(oxford);
      const [a, b, c] = [
        await group(headSubject, [oxford]),
        await group(headSubject, [oxford]),
        await group(headSubject, [oxford]),
      ];
      const [x, y] = [await group(other, [oxford]), await group(other, [oxford])];
      await placeInGroup(x, one.id);
      ok(await moveGroup(one.id, await memberOf(one.id, x), y, '2026-10-19'));
      const foreign = await lastMoveId(one.id);
      const before = await rowsOf();
      for (const path of ['cancel', 'undo', 'change']) {
        refusedWith(
          await post(
            `/api/groups/transfers/${foreign}/${path}`,
            {
              ...(path === 'undo' ? { reason: 'Mistake.' } : {}),
              ...(path === 'change' ? { toGroupId: x, from: TOMORROW } : {}),
            },
            headTeacher,
          ),
          403,
          'permission_denied',
        );
      }
      expect(await rowsOf()).toEqual(before);
      // Own subject: a change to a group of another subject is refused, the cancel allowed.
      await placeInGroup(a, two.id);
      ok(await moveGroup(two.id, await memberOf(two.id, a), b, '2026-10-19', headTeacher));
      const own = await lastMoveId(two.id);
      refusedWith(
        await post(
          `/api/groups/transfers/${own}/change`,
          { toGroupId: y, from: '2026-10-26' },
          headTeacher,
        ),
        403,
        'permission_denied',
      );
      ok(
        await post(
          `/api/groups/transfers/${own}/change`,
          { toGroupId: c, from: '2026-10-26' },
          headTeacher,
        ),
      );
      const changed = await lastMoveId(two.id);
      ok(await post(`/api/groups/transfers/${changed}/cancel`, {}, headTeacher));
      const [entry] = await t.entries('student.group_transfer_cancelled', two.id);
      expect(entry).toMatchObject({ assignment_id: headAssignment });
      // Own subject, begun today: the Head Teacher undoes it.
      await placeInGroup(a, three.id, TODAY);
      ok(await moveGroup(three.id, await memberOf(three.id, a), b, TODAY));
      ok(
        await post(
          `/api/groups/transfers/${await lastMoveId(three.id)}/undo`,
          { reason: 'Wrong group.' },
          headTeacher,
        ),
      );
    });

    it('lets a Senior Head Teacher move own subjects in a second branch and refuses another subject', async () => {
      const browser = await t.kit.completeSession('Kamola', 'Rashidova');
      const given = await t.kit.giveRole(browser.account.id, {
        role: 'senior_head_teacher',
        subjectIds: [headSubject],
      });
      const southClass = await classes.schoolClass(t.south, southYear, { grade: 7 });
      const southMembers = new MembersKit(t.database.migrator, await classes.account());
      const student = await southMembers.student(t.south, { startsOn: '2026-09-01' });
      await southMembers.member({
        branch: t.south,
        classId: southClass,
        studentId: student,
        from: '2026-09-01',
      });
      const [a, b] = [
        await classes.group(t.south, southYear, headSubject, [southClass]),
        await classes.group(t.south, southYear, headSubject, [southClass]),
      ];
      const row = await southMembers.groupMember({
        branch: t.south,
        groupId: a,
        subjectId: headSubject,
        studentId: student,
        from: '2026-09-01',
      });
      const response = await t.post(
        '/api/groups/transfers',
        t.south,
        { studentId: student, memberId: row, toGroupId: b, from: TOMORROW },
        browser.cookie,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const [entry] = await t.entries('student.group_transferred', student);
      expect(entry).toMatchObject({ assignment_id: given.id });
      const other = await classes.subject({ grades: [7] });
      const [x, y] = [
        await classes.group(t.south, southYear, other, [southClass]),
        await classes.group(t.south, southYear, other, [southClass]),
      ];
      const otherRow = await southMembers.groupMember({
        branch: t.south,
        groupId: x,
        subjectId: other,
        studentId: student,
        from: '2026-09-01',
      });
      refusedWith(
        await t.post(
          '/api/groups/transfers',
          t.south,
          { studentId: student, memberId: otherRow, toGroupId: y, from: TOMORROW },
          browser.cookie,
        ),
        403,
        'permission_denied',
      );
    });

    // Should-fix 2: the past date is decided from every current assignment.
    it('refuses a past date to a Head Teacher who is Academic Vice Principal of another branch only', async () => {
      const browser = await t.kit.completeSession('Ulugbek', 'Hamidov');
      const own = await classes.subject({ grades: [7] });
      await t.kit.giveRole(browser.account.id, {
        role: 'head_teacher',
        branchId: t.north,
        subjectIds: [own],
      });
      await t.kit.giveRole(browser.account.id, {
        role: 'academic_vice_principal',
        branchId: t.south,
      });
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const [a, b] = [await group(own, [oxford]), await group(own, [oxford])];
      await placeInGroup(a, one.id, '2026-09-02');
      refusedWith(
        await moveGroup(one.id, await memberOf(one.id, a), b, '2026-10-05', browser.cookie),
        403,
        'move_in_past',
      );
    });
  });

  describe('the History tab', () => {
    it('shows each move with its dates and state, the joins and the statuses, newest first', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      const [a, b] = [await group(headSubject, [oxford]), await group(headSubject, [oxford])];
      await placeInGroup(a, one.id);
      ok(await moveGroup(one.id, await memberOf(one.id, a), b, '2026-10-12'));
      ok(
        await post('/api/classes/transfers', {
          studentId: one.id,
          version: (await fresh(one.id)).version,
          toClassId: yale,
          from: '2026-10-19',
        }),
      );
      const response = await get(`/api/people/students/${one.id}/history`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const history = studentHistorySchema.parse(response.body);
      expect(
        history.lines.map((line) =>
          line.kind === 'move'
            ? [line.kind, line.move.kind, line.move.from, line.move.state]
            : line.kind === 'branch_move'
              ? [line.kind, line.move.from]
              : line.kind === 'merged'
                ? [line.kind, line.on]
                : line.kind === 'class' || line.kind === 'group'
                  ? [line.kind, line.from, line.until]
                  : [line.kind, line.from],
        ),
      ).toEqual([
        // One line per stay (task 3.5c, H35), a move's target included: the
        // stays ahead and in force have no last day yet, a cut one has it.
        ['class', '2026-10-19', null],
        ['move', 'class', '2026-10-19', 'scheduled'],
        ['group', '2026-10-12', '2026-10-19'],
        ['move', 'group', '2026-10-12', 'scheduled'],
        ['group', TOMORROW, '2026-10-12'],
        ['class', '2026-09-02', '2026-10-19'],
        ['status', '2026-09-02'],
      ]);
    });

    it('lets the Tutor of the class read it and refuses a Tutor of another class', async () => {
      const own = await pupil(tutorClass);
      expect((await get(`/api/people/students/${own.id}/history`, tutor)).status).toBe(200);
      const elsewhere = await pupil(await schoolClass());
      refusedWith(
        await get(`/api/people/students/${elsewhere.id}/history`, tutor),
        403,
        'permission_denied',
      );
      refusedWith(
        await get(`/api/people/students/${own.id}/history`, spiritual),
        403,
        'permission_denied',
      );
      refusedWith(await get(`/api/people/students/${UNKNOWN}/history`), 404, 'not_found');
    });

    it('says on the record who reads the History tab and who moves', async () => {
      const own = await pupil(tutorClass);
      expect((await fresh(own.id)).readsHistory).toBe(true);
      expect((await fresh(own.id)).canMoveClass).toBe(true);
      expect((await fresh(own.id)).canMoveInPast).toBe(true);
      const spiritualView = studentDetailSchema.parse(
        (await get(`/api/people/students/${own.id}`, spiritual)).body,
      );
      expect(spiritualView.readsHistory).toBe(false);
      expect(spiritualView.canMoveClass).toBe(false);
      const headView = studentDetailSchema.parse(
        (await get(`/api/people/students/${own.id}`, headTeacher)).body,
      );
      expect(headView.canMoveInPast).toBe(false);
    });
  });
});
