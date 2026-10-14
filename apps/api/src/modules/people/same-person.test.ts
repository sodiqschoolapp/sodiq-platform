import {
  BRANCH_HEADER,
  apiErrorSchema,
  relativeDetailSchema,
  staffDetailSchema,
  studentDetailSchema,
  studentRelativesSchema,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { staffIdOf } from './staff-numbers.js';

// All names and phones are invented. edge/close-relatives, row 8: "The staff
// record and the relative record stay separate and are marked as the same
// person." Task 2.5b-2, pull request #74, decisions 4 to 9 and correction 1 of
// the review: the mark is set and removed under `relatives` `edit` where both
// records are visible in the branch of the request; a mark to a staff member
// not of the branch is changed only by the Super Admin.
describe('the mark "same person" of a relative and a staff record', () => {
  let t: DayTemplatesKit;
  let southVice: string;
  let spiritual: string;
  let academic: string;
  let steam: string;
  let count = 0;

  const lettersOf = (n: number): string =>
    n < 26
      ? String.fromCharCode(97 + n)
      : lettersOf(Math.floor(n / 26) - 1) + String.fromCharCode(97 + (n % 26));

  const phone = () => {
    count += 1;
    return `+99893${String(6000000 + count)}`;
  };

  function body(number: string): Record<string, unknown> {
    count += 1;
    return {
      uid: String(2611000 + count),
      confirmUidSet: true,
      firstName: 'Madina',
      lastName: `Yusupova${'a'.repeat(count % 7)}`,
      paternalName: '',
      sex: 'female',
      birthDate: `2013-04-${String((count % 28) + 1).padStart(2, '0')}`,
      grade: 8,
      startsOn: '2026-09-02',
      documentType: null,
      documentNumber: '',
      jshshir: '',
      phone: '',
      email: '',
      address: '',
      region: null,
      previousSchool: '',
      diagnosticScore: null,
      scholarship: { type: 'none', coverage: null, amount: null },
      consentSignedOn: null,
      contract: { number: `SP-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives: [
        {
          kind: 'new',
          relative: { fullName: 'Rustam Nazarov', phone: number, workplace: null, email: null },
          relationship: 'father',
          mainContact: true,
          portalAccess: true,
          receivesNotices: true,
        },
      ],
    };
  }

  /** A relative linked to a new student of a branch. */
  async function relative(
    branch: string,
  ): Promise<{ id: string; studentId: string; phone: string; version: number }> {
    const number = phone();
    const created = await t.postStudent(branch, body(number), t.admin);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const student = studentDetailSchema.parse(created.body);
    const tab = studentRelativesSchema.parse(
      (await t.get(`/api/people/students/${student.id}/relatives`, branch)).body,
    );
    const id = tab.relatives[0]?.relativeId;
    if (id === undefined) {
      throw new Error('A student is created with a relative.');
    }
    return { id, studentId: student.id, phone: number, version: student.version };
  }

  /** A staff person with a main branch and further branches, or a vacancy, written by the migrator. */
  async function staffMember(
    main: string,
    further: string[] = [],
    kind: 'person' | 'vacancy' = 'person',
  ): Promise<string> {
    count += 1;
    const number = count;
    return t.database.migrator.transaction().execute(async (transaction) => {
      const row = await transaction
        .insertInto('staff')
        .values(
          kind === 'person'
            ? {
                kind,
                staff_id: staffIdOf(2026, 8000 + number),
                first_name: 'Rustam',
                last_name: `Nazarov${lettersOf(number)}`,
                sex: 'male',
                birth_date: '1985-03-04',
                phone: `+99894${String(7000000 + number)}`,
                admission_date: '2026-09-01',
              }
            : { kind, vacancy_name: `Physics vacancy ${String(number)}` },
        )
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_branches')
        .values([
          { staff_id: row.id, branch_id: main, is_main: true },
          ...further.map((branch) => ({ staff_id: row.id, branch_id: branch, is_main: false })),
        ])
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({ staff_id: row.id, division_id: academic, department_id: steam, is_main: true })
        .execute();
      if (kind === 'person') {
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: row.id, status: 'active', valid_from: '2026-09-01' })
          .execute();
      }
      return row.id;
    });
  }

  const mark = (id: string, staffId: string, branch: string, cookie = t.vicePrincipal) =>
    t.put(`/api/people/relatives/${id}/same-person`, branch, { staffId }, cookie);

  const deleteRequest = (id: string, branch: string, cookie: string) =>
    request(t.kit.server)
      .delete(`/api/people/relatives/${id}/same-person`)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch);

  const markOf = async (id: string) =>
    (
      await t.database.migrator
        .selectFrom('relatives')
        .select('staff_id')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).staff_id;

  const schoolEntries = (action: string, recordId: string) =>
    t.database.migrator
      .selectFrom('audit_log_school')
      .selectAll()
      .where('action', '=', action)
      .where('record_id', '=', recordId)
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  /** Every row of the tables the routes write or read, in both branches. */
  async function snapshot(): Promise<Record<string, unknown>> {
    const rows: Record<string, unknown> = {};
    for (const table of [
      'relatives',
      'student_relatives',
      'staff',
      'staff_branches',
      'audit_log',
      'audit_log_school',
    ] as const) {
      rows[table] = (
        await sql`select * from ${sql.table(table)} order by 1`.execute(t.database.migrator)
      ).rows;
    }
    return rows;
  }

  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(t.database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  /** A transaction of the branches held open after `work` until released. */
  async function holdOpen(branches: string[], work: (transaction: Transaction) => Promise<void>) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const done = t.app.get(Transactions).run(branches, async (transaction: Transaction) => {
      await work(transaction);
      ready();
      await released;
    });
    await Promise.race([isReady, done]);
    return { release, done };
  }

  /** What the route of the mark does before its write: the relative, then the staff rows. */
  const lockAsTheMark = async (transaction: Transaction, id: string, staffIds: string[]) => {
    await transaction
      .selectFrom('relatives')
      .select('id')
      .where('id', '=', id)
      .forUpdate()
      .execute();
    for (const staffId of [...staffIds].sort((a, b) => a.localeCompare(b))) {
      await transaction
        .selectFrom('staff')
        .select('id')
        .where('id', '=', staffId)
        .forUpdate()
        .execute();
    }
  };

  beforeAll(async () => {
    t = await dayTemplatesKit();
    academic = (
      await t.database.migrator
        .selectFrom('divisions')
        .select('id')
        .where('name_en', '=', 'Academic')
        .executeTakeFirstOrThrow()
    ).id;
    steam = (
      await t.database.migrator
        .selectFrom('departments')
        .select('id')
        .where('name_en', '=', 'STEAM')
        .executeTakeFirstOrThrow()
    ).id;
    for (const branch of [t.north, t.south]) {
      await t.database.migrator.transaction().execute(async (transaction) => {
        const year = await transaction
          .insertInto('academic_years')
          .values({ branch_id: branch, start_date: '2026-09-01', end_date: '2027-05-31' })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const number of [1, 2, 3, 4]) {
          await transaction
            .insertInto('quarters')
            .values({ branch_id: branch, academic_year_id: year.id, number })
            .execute();
        }
      });
    }
    const south = await t.kit.completeSession('Sardor', 'Aliyev');
    await t.kit.giveRole(south.account.id, { role: 'academic_vice_principal', branchId: t.south });
    southVice = south.cookie;
    const soul = await t.kit.completeSession('Bahrom', 'Qosimov');
    await t.kit.giveRole(soul.account.id, { role: 'spiritual_vice_principal', branchId: t.north });
    spiritual = soul.cookie;
  });

  afterAll(async () => {
    await t.close();
  });

  describe('mark, change and remove', () => {
    it('marks a relative as a teacher of the branch, and each record shows the other', async () => {
      const parent = await relative(t.north);
      const teacher = await staffMember(t.north);
      const response = await mark(parent.id, teacher, t.north);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const detail = relativeDetailSchema.parse(response.body);
      expect(detail.samePerson).toMatchObject({ staffId: teacher });
      expect(detail.samePerson?.staffNumber).toMatch(/^S-[0-9]{6}$/);
      // Surname first, as the staff lists (owner's answer to finding 27).
      expect(detail.samePerson?.name).toMatch(/^Nazarov[a-z]* Rustam$/);
      expect(await markOf(parent.id)).toBe(teacher);
      const [entry] = await schoolEntries('relative.same_person', parent.id);
      expect(entry).toMatchObject({
        assignment_id: t.viceAssignment,
        old_value: { staffId: null },
        new_value: { staffId: teacher },
        details: { branchId: t.north, staffId: teacher },
      });
      expect(entry?.request_id).toEqual(expect.any(String));
      // The staff panel shows the relative to the readers of relatives.
      for (const cookie of [t.vicePrincipal, t.principal, t.admin]) {
        const staff = await t.get(`/api/people/staff/${teacher}`, t.north, cookie);
        expect(staff.status, JSON.stringify(staff.body)).toBe(200);
        expect(staffDetailSchema.parse(staff.body).sameAsRelative).toEqual({
          id: parent.id,
          fullName: 'Rustam Nazarov',
        });
      }
    });

    it('changes the mark in one step and removes it, each with an entry', async () => {
      const parent = await relative(t.north);
      const first = await staffMember(t.north);
      const second = await staffMember(t.north);
      expect((await mark(parent.id, first, t.north)).status).toBe(200);
      const changed = await mark(parent.id, second, t.north);
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      expect(relativeDetailSchema.parse(changed.body).samePerson?.staffId).toBe(second);
      expect((await schoolEntries('relative.same_person', parent.id)).at(-1)).toMatchObject({
        old_value: { staffId: first },
        new_value: { staffId: second },
      });
      const removed = await deleteRequest(parent.id, t.north, t.vicePrincipal);
      expect(removed.status, JSON.stringify(removed.body)).toBe(204);
      expect(await markOf(parent.id)).toBeNull();
      expect(await schoolEntries('relative.same_person_removed', parent.id)).toEqual([
        expect.objectContaining({
          assignment_id: t.viceAssignment,
          old_value: { staffId: second },
          new_value: { staffId: null },
          details: { branchId: t.north, staffId: second },
        }),
      ]);
      // Nothing to remove: no change and no entry.
      const before = await snapshot();
      expect((await deleteRequest(parent.id, t.north, t.vicePrincipal)).status).toBe(204);
      expect(await snapshot()).toEqual(before);
    });

    it('is done by the Super Admin with the Super Admin assignment named', async () => {
      const parent = await relative(t.north);
      const teacher = await staffMember(t.north);
      expect((await mark(parent.id, teacher, t.north, t.admin)).status).toBe(200);
      expect(await schoolEntries('relative.same_person', parent.id)).toEqual([
        expect.objectContaining({ assignment_id: t.adminAssignment }),
      ]);
      expect((await deleteRequest(parent.id, t.north, t.admin)).status).toBe(204);
      expect(await schoolEntries('relative.same_person_removed', parent.id)).toEqual([
        expect.objectContaining({ assignment_id: t.adminAssignment }),
      ]);
    });

    it("counts the students of other branches in the Super Admin's answer", async () => {
      const parent = await relative(t.north);
      const number = (
        await t.database.migrator
          .selectFrom('relatives')
          .select('phone')
          .where('id', '=', parent.id)
          .executeTakeFirstOrThrow()
      ).phone;
      const southern = body(phone());
      southern.relatives = [
        {
          kind: 'existing',
          relativeId: parent.id,
          phone: number,
          relationship: 'father',
          mainContact: true,
          portalAccess: true,
          receivesNotices: true,
        },
      ];
      expect((await t.postStudent(t.south, southern, t.admin)).status).toBe(201);
      const teacher = await staffMember(t.north);
      const response = await mark(parent.id, teacher, t.north, t.admin);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(relativeDetailSchema.parse(response.body).elsewhere).toBe(1);
      const asVice = await mark(parent.id, teacher, t.north);
      expect(relativeDetailSchema.parse(asVice.body).elsewhere).toBe(1);
    });

    it('answers a repeated mark without a change or an entry', async () => {
      const parent = await relative(t.north);
      const teacher = await staffMember(t.north);
      expect((await mark(parent.id, teacher, t.north)).status).toBe(200);
      const before = await snapshot();
      const again = await mark(parent.id, teacher, t.north);
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(relativeDetailSchema.parse(again.body).samePerson?.staffId).toBe(teacher);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('refusals', () => {
    it('is refused to the Principal, the Spiritual Vice Principal and a Teacher, changing nothing', async () => {
      const parent = await relative(t.north);
      const teacher = await staffMember(t.north);
      const marked = await relative(t.north);
      expect((await mark(marked.id, teacher, t.north)).status).toBe(200);
      const other = await staffMember(t.north);
      const before = await snapshot();
      for (const cookie of [t.principal, spiritual, t.teacher]) {
        refusedWith(await mark(parent.id, other, t.north, cookie), 403, 'permission_denied');
        refusedWith(await deleteRequest(marked.id, t.north, cookie), 403, 'permission_denied');
      }
      // The south Academic Vice Principal in the north.
      refusedWith(await mark(parent.id, other, t.north, southVice), 403, 'permission_denied');
      refusedWith(await deleteRequest(marked.id, t.north, southVice), 403, 'permission_denied');
      expect(await snapshot()).toEqual(before);
    });

    it('answers 404 for a relative or a staff member of another branch and unknown ones', async () => {
      const here = await relative(t.north);
      const there = await relative(t.south);
      const teacherHere = await staffMember(t.north);
      const teacherThere = await staffMember(t.south);
      const marked = await relative(t.south);
      expect((await mark(marked.id, teacherThere, t.south, southVice)).status).toBe(200);
      const before = await snapshot();
      for (const cookie of [t.vicePrincipal, t.admin]) {
        refusedWith(await mark(there.id, teacherHere, t.north, cookie), 404, 'not_found');
        refusedWith(await mark(UNKNOWN, teacherHere, t.north, cookie), 404, 'not_found');
        refusedWith(await mark(here.id, teacherThere, t.north, cookie), 404, 'not_found');
        refusedWith(await mark(here.id, UNKNOWN, t.north, cookie), 404, 'not_found');
        refusedWith(await deleteRequest(marked.id, t.north, cookie), 404, 'not_found');
        refusedWith(await deleteRequest(UNKNOWN, t.north, cookie), 404, 'not_found');
      }
      expect(await snapshot()).toEqual(before);
    });

    it('refuses a vacancy', async () => {
      const parent = await relative(t.north);
      const vacancy = await staffMember(t.north, [], 'vacancy');
      const before = await snapshot();
      refusedWith(await mark(parent.id, vacancy, t.north), 422, 'same_person_vacancy');
      expect(await snapshot()).toEqual(before);
    });

    it('answers same_person_taken for a staff member marked with another relative, naming a holder of the branch only', async () => {
      const teacher = await staffMember(t.north, [t.south]);
      const holder = await relative(t.north);
      expect((await mark(holder.id, teacher, t.north)).status).toBe(200);
      const parent = await relative(t.north);
      const southParent = await relative(t.south);
      const before = await snapshot();
      const refused = await mark(parent.id, teacher, t.north);
      refusedWith(refused, 409, 'same_person_taken');
      expect(apiErrorSchema.parse(refused.body).error.details?.[0]).toMatchObject({
        recordId: holder.id,
      });
      expect(await snapshot()).toEqual(before);
      // The north's holder is not named to the south.
      const fromSouth = await mark(southParent.id, teacher, t.south, southVice);
      refusedWith(fromSouth, 409, 'same_person_held_elsewhere');
      expect(JSON.stringify(fromSouth.body)).not.toContain(holder.id);
      expect(JSON.stringify(fromSouth.body)).not.toContain('Rustam Nazarov');
      expect(await snapshot()).toEqual(before);
    });
  });

  // Code review of the build, round 1: an archived relative is reached by no
  // branch, so a mark it kept could never be removed and would hold its staff
  // member for good. The last link that goes removes the mark, with its entry.
  describe('a relative archived when its last link goes', () => {
    it('loses its mark on the last unlink, so the staff member is marked again, and is restored without it', async () => {
      const parent = await relative(t.north);
      const teacher = await staffMember(t.north);
      expect((await mark(parent.id, teacher, t.north)).status).toBe(200);
      const second = await t.post(`/api/people/students/${parent.studentId}/relatives`, t.north, {
        kind: 'new',
        relative: { fullName: 'Dilfuza Nazarova', phone: phone(), workplace: null, email: null },
        relationship: 'mother',
        mainContact: true,
        portalAccess: true,
        receivesNotices: true,
      });
      expect(second.status, JSON.stringify(second.body)).toBe(201);
      const unlinked = await t.post(
        `/api/people/students/${parent.studentId}/relatives/${parent.id}/unlink`,
        t.north,
        { newMainContactId: null },
        t.vicePrincipal,
      );
      expect(unlinked.status, JSON.stringify(unlinked.body)).toBe(200);
      expect(await markOf(parent.id)).toBeNull();
      expect(await schoolEntries('relative.same_person_removed', parent.id)).toEqual([
        expect.objectContaining({
          assignment_id: t.viceAssignment,
          old_value: { staffId: teacher },
          new_value: { staffId: null },
          details: { branchId: t.north, staffId: teacher, archived: true },
        }),
      ]);
      expect(await schoolEntries('relative.archive', parent.id)).toHaveLength(1);

      // Another record of the same person takes the mark.
      const correct = await relative(t.north);
      const marked = await mark(correct.id, teacher, t.north);
      expect(marked.status, JSON.stringify(marked.body)).toBe(200);
      expect(await markOf(correct.id)).toBe(teacher);

      // The archived record, linked again by its phone, comes back unmarked,
      // and the staff member is named as held by the other record.
      count += 1;
      const restored = await t.postStudent(t.north, {
        ...body(phone()),
        relatives: [
          {
            kind: 'existing',
            relativeId: parent.id,
            phone: parent.phone,
            relationship: 'father',
            mainContact: true,
            portalAccess: true,
            receivesNotices: true,
          },
        ],
      });
      expect(restored.status, JSON.stringify(restored.body)).toBe(201);
      expect(await schoolEntries('relative.restore', parent.id)).toHaveLength(1);
      const detail = relativeDetailSchema.parse(
        (await t.get(`/api/people/relatives/${parent.id}`, t.north, t.vicePrincipal)).body,
      );
      expect(detail).toMatchObject({ samePerson: null, samePersonElsewhere: false });
      const again = await mark(parent.id, teacher, t.north);
      refusedWith(again, 409, 'same_person_taken');
      expect(apiErrorSchema.parse(again.body).error.details?.[0]).toMatchObject({
        recordId: correct.id,
      });
    });

    it('loses its mark when its only student is deleted as created twice', async () => {
      const parent = await relative(t.north);
      const teacher = await staffMember(t.north);
      expect((await mark(parent.id, teacher, t.north)).status).toBe(200);
      const deleted = await t.post(
        `/api/people/students/${parent.studentId}/delete`,
        t.north,
        { reason: 'Created twice by mistake.', version: parent.version },
        t.vicePrincipal,
      );
      expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);
      expect(await markOf(parent.id)).toBeNull();
      expect(await schoolEntries('relative.same_person_removed', parent.id)).toEqual([
        expect.objectContaining({
          old_value: { staffId: teacher },
          details: { branchId: t.north, staffId: teacher, archived: true },
        }),
      ]);
      const other = await relative(t.north);
      expect((await mark(other.id, teacher, t.north)).status).toBe(200);
    });
  });

  describe('a mark to a staff member not of the branch (decision 9, correction 1)', () => {
    /** A parent of the north marked with a teacher who then leaves the north. */
    async function markedThenLeft() {
      const parent = await relative(t.north);
      const teacher = await staffMember(t.south, [t.north]);
      expect((await mark(parent.id, teacher, t.north)).status).toBe(200);
      await t.database.migrator
        .deleteFrom('staff_branches')
        .where('staff_id', '=', teacher)
        .where('branch_id', '=', t.north)
        .execute();
      return { parent, teacher };
    }

    it('is not shown in the branch, and is refused same_person_elsewhere to the Academic Vice Principal', async () => {
      const { parent, teacher } = await markedThenLeft();
      const detail = relativeDetailSchema.parse(
        (await t.get(`/api/people/relatives/${parent.id}`, t.north, t.vicePrincipal)).body,
      );
      expect(detail).toMatchObject({ samePerson: null, samePersonElsewhere: false });
      // The Super Admin, who may remove it, is told that it exists, with no name.
      const asAdmin = relativeDetailSchema.parse(
        (await t.get(`/api/people/relatives/${parent.id}`, t.north, t.admin)).body,
      );
      expect(asAdmin).toMatchObject({ samePerson: null, samePersonElsewhere: true });
      expect(JSON.stringify(asAdmin)).not.toContain(teacher);
      const other = await staffMember(t.north);
      const before = await snapshot();
      refusedWith(await mark(parent.id, other, t.north), 409, 'same_person_elsewhere');
      refusedWith(
        await deleteRequest(parent.id, t.north, t.vicePrincipal),
        409,
        'same_person_elsewhere',
      );
      expect(await snapshot()).toEqual(before);
    });

    it('is removed by the Super Admin, the Super Admin assignment named', async () => {
      const { parent, teacher } = await markedThenLeft();
      const removed = await deleteRequest(parent.id, t.north, t.admin);
      expect(removed.status, JSON.stringify(removed.body)).toBe(204);
      expect(await markOf(parent.id)).toBeNull();
      expect(await schoolEntries('relative.same_person_removed', parent.id)).toEqual([
        expect.objectContaining({
          assignment_id: t.adminAssignment,
          old_value: { staffId: teacher },
          details: { branchId: t.north, staffId: teacher },
        }),
      ]);
    });

    it('is changed by the Super Admin to a staff member of the branch', async () => {
      const { parent, teacher } = await markedThenLeft();
      const other = await staffMember(t.north);
      const changed = await mark(parent.id, other, t.north, t.admin);
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      expect(await markOf(parent.id)).toBe(other);
      expect((await schoolEntries('relative.same_person', parent.id)).at(-1)).toMatchObject({
        assignment_id: t.adminAssignment,
        old_value: { staffId: teacher },
        new_value: { staffId: other },
      });
    });

    it('shows neither record across branches', async () => {
      const teacher = await staffMember(t.north, [t.south]);
      const parent = await relative(t.south);
      expect((await mark(parent.id, teacher, t.south, southVice)).status).toBe(200);
      const north = await t.get(`/api/people/staff/${teacher}`, t.north, t.vicePrincipal);
      expect(staffDetailSchema.parse(north.body).sameAsRelative).toBeNull();
      const south = await t.get(`/api/people/staff/${teacher}`, t.south, southVice);
      expect(staffDetailSchema.parse(south.body).sameAsRelative).toEqual({
        id: parent.id,
        fullName: 'Rustam Nazarov',
      });
      refusedWith(await t.get(`/api/people/relatives/${parent.id}`, t.north), 404, 'not_found');
    });
  });

  describe('at the same moment (lock pairs)', () => {
    it('a mark that waited on another mark of the same staff member is refused same_person_taken', async () => {
      const teacher = await staffMember(t.north);
      const first = await relative(t.north);
      const second = await relative(t.north);
      const held = await holdOpen([t.north], async (transaction) => {
        await lockAsTheMark(transaction, first.id, [teacher]);
        await transaction
          .updateTable('relatives')
          .set({ staff_id: teacher })
          .where('id', '=', first.id)
          .execute();
      });
      const marking = mark(second.id, teacher, t.north).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      refusedWith(await marking, 409, 'same_person_taken');
      expect(await markOf(second.id)).toBeNull();
    });

    it('two relatives crossing marks answer 409, never a fault', async () => {
      const one = await staffMember(t.north);
      const two = await staffMember(t.north);
      const first = await relative(t.north);
      const second = await relative(t.north);
      expect((await mark(first.id, one, t.north)).status).toBe(200);
      expect((await mark(second.id, two, t.north)).status).toBe(200);
      const held = await holdOpen([t.north], async (transaction) => {
        await lockAsTheMark(transaction, second.id, [one, two]);
      });
      const crossing = mark(first.id, two, t.north).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      refusedWith(await crossing, 409, 'same_person_taken');
      expect(await markOf(first.id)).toBe(one);
      expect(await markOf(second.id)).toBe(two);
    });

    it('a mark that waited on a merge of its relative answers 404', async () => {
      const teacher = await staffMember(t.north);
      const kept = await relative(t.north);
      const merged = await relative(t.north);
      const at = new Date('2026-10-10T18:55:00Z');
      const held = await holdOpen([t.north], async (transaction) => {
        await transaction
          .selectFrom('students')
          .select('id')
          .where('id', '=', merged.studentId)
          .forUpdate()
          .execute();
        await transaction
          .selectFrom('relatives')
          .select('id')
          .where('id', 'in', [kept.id, merged.id])
          .orderBy('id')
          .forUpdate()
          .execute();
        await transaction
          .updateTable('relatives')
          .set({ phone: null, merged_into: kept.id })
          .where('id', '=', merged.id)
          .execute();
        await transaction
          .updateTable('student_relatives')
          .set({ main_contact: false, unlinked_at: at })
          .where('relative_id', '=', merged.id)
          .execute();
        await transaction
          .insertInto('student_relatives')
          .values({
            student_id: merged.studentId,
            branch_id: t.north,
            relative_id: kept.id,
            relationship: 'father',
            main_contact: true,
            linked_at: at,
          })
          .execute();
      });
      const marking = mark(merged.id, teacher, t.north).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      refusedWith(await marking, 404, 'not_found');
      expect(await markOf(merged.id)).toBeNull();
    });

    it('a merge that waited on a mark of the merged record moves the mark to the kept one', async () => {
      const teacher = await staffMember(t.north);
      const kept = await relative(t.north);
      const merged = await relative(t.north);
      const keptPhone = (
        await t.database.migrator
          .selectFrom('relatives')
          .select('phone')
          .where('id', '=', kept.id)
          .executeTakeFirstOrThrow()
      ).phone;
      const mergedPhone = (
        await t.database.migrator
          .selectFrom('relatives')
          .select('phone')
          .where('id', '=', merged.id)
          .executeTakeFirstOrThrow()
      ).phone;
      const held = await holdOpen([t.north], async (transaction) => {
        await lockAsTheMark(transaction, merged.id, [teacher]);
        await transaction
          .updateTable('relatives')
          .set({ staff_id: teacher })
          .where('id', '=', merged.id)
          .execute();
      });
      const merging = t
        .post(`/api/people/relatives/${kept.id}/merge`, t.north, {
          otherId: merged.id,
          thisPhone: keptPhone,
          otherPhone: mergedPhone,
          phoneOf: 'this',
          nameOf: 'this',
        })
        .then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      const response = await merging;
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(relativeDetailSchema.parse(response.body).samePerson?.staffId).toBe(teacher);
      expect(await markOf(kept.id)).toBe(teacher);
      expect(await markOf(merged.id)).toBeNull();
    });

    it('a mark that waited on the removal of the staff member from the branch answers 404', async () => {
      const teacher = await staffMember(t.south, [t.north]);
      const parent = await relative(t.north);
      const removing = await holdOpen([t.north, t.south], async (transaction) => {
        await transaction
          .selectFrom('staff')
          .select('id')
          .where('id', '=', teacher)
          .forUpdate()
          .execute();
        await transaction
          .deleteFrom('staff_branches')
          .where('staff_id', '=', teacher)
          .where('branch_id', '=', t.north)
          .execute();
      });
      const marking = mark(parent.id, teacher, t.north).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      removing.release();
      await removing.done;
      refusedWith(await marking, 404, 'not_found');
      expect(await markOf(parent.id)).toBeNull();
    });

    it('a removal of the mark that waited on the removal of the staff member from the branch answers same_person_elsewhere', async () => {
      const teacher = await staffMember(t.south, [t.north]);
      const parent = await relative(t.north);
      expect((await mark(parent.id, teacher, t.north)).status).toBe(200);
      const removing = await holdOpen([t.north, t.south], async (transaction) => {
        await transaction
          .selectFrom('staff')
          .select('id')
          .where('id', '=', teacher)
          .forUpdate()
          .execute();
        await transaction
          .deleteFrom('staff_branches')
          .where('staff_id', '=', teacher)
          .where('branch_id', '=', t.north)
          .execute();
      });
      const unmarking = deleteRequest(parent.id, t.north, t.vicePrincipal).then(
        (response) => response,
      );
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      removing.release();
      await removing.done;
      refusedWith(await unmarking, 409, 'same_person_elsewhere');
      expect(await markOf(parent.id)).toBe(teacher);
      expect(await schoolEntries('relative.same_person_removed', parent.id)).toEqual([]);
    });

    it('the removal of the staff member from the branch that waited on a removal of the mark comes after it', async () => {
      const teacher = await staffMember(t.south, [t.north]);
      const parent = await relative(t.north);
      expect((await mark(parent.id, teacher, t.north)).status).toBe(200);
      const held = await holdOpen([t.north], async (transaction) => {
        await lockAsTheMark(transaction, parent.id, [teacher]);
        await transaction
          .selectFrom('staff_branches')
          .select('staff_id')
          .where('staff_id', '=', teacher)
          .where('branch_id', '=', t.north)
          .forShare()
          .execute();
        await transaction
          .updateTable('relatives')
          .set({ staff_id: null })
          .where('id', '=', parent.id)
          .execute();
      });
      const removing = t
        .put(
          `/api/people/staff/${teacher}/branches`,
          t.south,
          { mainBranchId: t.south, furtherBranchIds: [] },
          t.admin,
        )
        .then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      const response = await removing;
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await markOf(parent.id)).toBeNull();
    });

    it('the removal of the staff member from the branch that waited on a mark comes after it', async () => {
      const teacher = await staffMember(t.south, [t.north]);
      const parent = await relative(t.north);
      const held = await holdOpen([t.north], async (transaction) => {
        await lockAsTheMark(transaction, parent.id, [teacher]);
        await transaction
          .selectFrom('staff_branches')
          .select('staff_id')
          .where('staff_id', '=', teacher)
          .where('branch_id', '=', t.north)
          .forShare()
          .execute();
        await transaction
          .updateTable('relatives')
          .set({ staff_id: teacher })
          .where('id', '=', parent.id)
          .execute();
      });
      const removing = t
        .put(
          `/api/people/staff/${teacher}/branches`,
          t.south,
          { mainBranchId: t.south, furtherBranchIds: [] },
          t.admin,
        )
        .then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      const response = await removing;
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      // The mark was made before the removal and stays; the north no longer shows it.
      expect(await markOf(parent.id)).toBe(teacher);
      const detail = relativeDetailSchema.parse(
        (await t.get(`/api/people/relatives/${parent.id}`, t.north)).body,
      );
      expect(detail.samePerson).toBeNull();
    });
  });
});
