import {
  AUDIT_ACTIONS,
  relativeReportSchema,
  staffReportSchema,
  studentDetailSchema,
  studentReportSchema,
  type RelativeReport,
  type StaffReport,
  type StudentReport,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Json } from '../../database/types.generated.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { linkRelative, relativesInput } from '../../testing/relatives-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { ENTRY_ABOUT, readPersonEntries, VALUE_MATCHES } from './personal-data.query.js';
import { staffIdOf } from './staff-numbers.js';

// All names, numbers and addresses are invented. docs/spec/edge-cases/
// people-roles-accounts.md, Personal data and the audit log: "A parent asks
// for a copy of everything held about their child ... The Super Admin can
// produce a personal data report per person." The plan approved on pull
// request #76 with corrections 1 to 3 (task 2.6b).
describe('the personal data report', () => {
  let t: DayTemplatesKit;
  let academic: string;
  let steam: string;
  let count = 0;

  const newId = async (): Promise<string> =>
    (await sql<{ id: string }>`select uuidv7() as id`.execute(t.database.migrator)).rows[0]?.id ??
    '';

  /** An entry written by hand, through the owner of the log. */
  async function entry(values: {
    branch: string | null;
    action: string;
    at?: string;
    actor?: string;
    person?: string;
    record?: { type: string; id: string };
    oldValue?: unknown;
    newValue?: unknown;
    details?: unknown;
  }): Promise<string> {
    const id = await newId();
    const json = (value: unknown) =>
      value === undefined ? null : sql<Json>`${JSON.stringify(value)}::jsonb`;
    const row = {
      id,
      occurred_at: new Date(values.at ?? '2026-10-09T10:00:00Z'),
      actor_id: values.actor ?? null,
      person_id: values.person ?? null,
      action: values.action,
      record_type: values.record?.type ?? null,
      record_id: values.record?.id ?? null,
      old_value: json(values.oldValue),
      new_value: json(values.newValue),
      details: json(values.details),
    };
    if (values.branch === null) {
      await t.database.migrator.insertInto('audit_log_school').values(row).execute();
    } else {
      await t.database.migrator
        .insertInto('audit_log')
        .values({ ...row, branch_id: values.branch })
        .execute();
    }
    return id;
  }

  /** Every row of both logs. */
  async function logs(): Promise<unknown[]> {
    return [
      (await sql`select * from audit_log order by id`.execute(t.database.migrator)).rows,
      (await sql`select * from audit_log_school order by id`.execute(t.database.migrator)).rows,
    ];
  }

  async function student(branch: string): Promise<string> {
    count += 1;
    const response = await t.post('/api/people/students', branch, {
      uid: String(2607700 + count),
      confirmUidSet: true,
      firstName: 'Gulnoza',
      lastName: `Ismoilova${'a'.repeat(count % 7)}`,
      paternalName: 'Anvarovna',
      sex: 'female',
      birthDate: '2013-04-11',
      grade: 7,
      startsOn: '2026-09-02',
      documentType: 'birth_certificate',
      documentNumber: `I-TN 00${String(12345 + count)}`,
      jshshir: null,
      phone: null,
      email: null,
      address: 'Chilonzor 9-kvartal 12',
      region: 'tashkent_city',
      previousSchool: null,
      diagnosticScore: 71,
      scholarship: { type: 'none', coverage: null, amount: null },
      consentSignedOn: '2026-08-25',
      contract: { number: `PD-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives: relativesInput(),
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body).id;
  }

  /** A staff person linked to the branches, the first the main one, as the migrator writes it. */
  async function person(
    accountId: string | null,
    branches: readonly string[],
    kind: 'person' | 'vacancy' = 'person',
  ): Promise<string> {
    count += 1;
    const id = await newId();
    await t.database.migrator.transaction().execute(async (transaction) => {
      await transaction
        .insertInto('staff')
        .values(
          kind === 'person'
            ? {
                id,
                kind,
                staff_id: staffIdOf(2026, 7000 + count),
                first_name: 'Sarvinoz',
                last_name: 'Yusupova',
                sex: 'female',
                birth_date: '1989-06-07',
                jshshir: String(31234567890000 + count),
                phone: `+9989320${String(count).padStart(4, '0')}`,
                admission_date: '2026-09-01',
                account_id: accountId,
              }
            : { id, kind, vacancy_name: 'Physics vacancy' },
        )
        .execute();
      for (const [index, branch] of branches.entries()) {
        await transaction
          .insertInto('staff_branches')
          .values({ staff_id: id, branch_id: branch, is_main: index === 0 })
          .execute();
      }
      await transaction
        .insertInto('staff_divisions')
        .values({ staff_id: id, division_id: academic, department_id: steam, is_main: true })
        .execute();
      if (kind === 'person') {
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: id, status: 'active', valid_from: '2026-09-01' })
          .execute();
      }
    });
    return id;
  }

  const report = (kind: 'students' | 'staff' | 'relatives', id: string, cookie = t.admin) =>
    t.post(`/api/people/${kind}/${id}/report`, t.north, {}, cookie);

  function ok(response: Response): unknown {
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body;
  }

  const relativeOf = async (studentId: string): Promise<string> =>
    (
      await t.database.migrator
        .selectFrom('student_relatives')
        .select('relative_id')
        .where('student_id', '=', studentId)
        .orderBy('linked_at')
        .executeTakeFirstOrThrow()
    ).relative_id;

  beforeAll(async () => {
    t = await dayTemplatesKit();
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
    const id = async (table: 'divisions' | 'departments', name: string) =>
      (
        await t.database.migrator
          .selectFrom(table)
          .select('id')
          .where('name_en', '=', name)
          .executeTakeFirstOrThrow()
      ).id;
    academic = await id('divisions', 'Academic');
    steam = await id('departments', 'STEAM');
  });

  afterAll(async () => {
    await t.close();
  });

  describe('who reaches it (decisions 3 and 4)', () => {
    let studentId: string;

    beforeAll(async () => {
      studentId = await student(t.north);
    });

    it.each([
      ['the Principal', () => t.principal],
      ['the Academic Vice Principal', () => t.vicePrincipal],
      ['a Teacher', () => t.teacher],
    ])('refuses %s on every route, writing nothing', async (_who, cookie) => {
      const relative = await relativeOf(studentId);
      const staffId = await person(null, [t.north]);
      const before = await logs();
      for (const [kind, id] of [
        ['students', studentId],
        ['staff', staffId],
        ['relatives', relative],
      ] as const) {
        const response = await report(kind, id, cookie());
        expect(response.status, kind).toBe(403);
        expect(errorCode(response)).toBe('permission_denied');
      }
      expect(await logs()).toEqual(before);
    });

    it('refuses a request without a session', async () => {
      const response = await request(t.kit.server)
        .post(`/api/people/students/${studentId}/report`)
        .send({});
      expect(response.status).toBe(401);
    });

    it('answers 404 for a person of another branch, an unknown id and a vacancy, writing nothing', async () => {
      const southStudent = await student(t.south);
      const southRelative = await relativeOf(southStudent);
      const southStaff = await person(null, [t.south]);
      const vacancy = await person(null, [t.north], 'vacancy');
      // A relative whose link in north has ended, still linked in south: the
      // route needs a live link in the branch of the request (decision 4).
      const northStudent = await student(t.north);
      const movedAway = await t.database.migrator.transaction().execute((transaction) =>
        linkRelative(transaction, northStudent, t.north, new Date('2026-09-02T08:00:00Z'), {
          fullName: 'Kamola Ismoilova',
          mainContact: false,
        }),
      );
      await t.database.migrator
        .insertInto('student_relatives')
        .values({
          student_id: southStudent,
          branch_id: t.south,
          relative_id: movedAway,
          relationship: 'aunt',
          main_contact: false,
          linked_at: new Date('2026-09-02T08:00:00Z'),
        })
        .execute();
      await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`select set_config('app.now', '2026-10-01T09:00:00Z', true)`.execute(transaction);
        await transaction
          .updateTable('student_relatives')
          .set({ unlinked_at: new Date('2026-10-01T09:00:00Z') })
          .where('relative_id', '=', movedAway)
          .where('branch_id', '=', t.north)
          .execute();
      });
      const before = await logs();
      for (const [kind, id] of [
        ['students', southStudent],
        ['students', UNKNOWN],
        ['staff', southStaff],
        ['staff', vacancy],
        ['staff', UNKNOWN],
        ['relatives', southRelative],
        ['relatives', movedAway],
        ['relatives', UNKNOWN],
      ] as const) {
        const response = await report(kind, id);
        expect(response.status, `${kind} ${id}`).toBe(404);
      }
      expect(await logs()).toEqual(before);
    });
  });

  describe("a student's report (done when: the Super Admin prints a student's report and the log holds the entry)", () => {
    let studentId: string;
    let gone: string;
    let found: StudentReport;

    beforeAll(async () => {
      studentId = await student(t.north);
      // A second relative, unlinked from every student and archived: hidden by
      // `relative_membership`, read through `personal_data_relatives` (decision 2).
      gone = await t.database.migrator.transaction().execute(async (transaction) => {
        const relative = await linkRelative(
          transaction,
          studentId,
          t.north,
          new Date('2026-09-02T08:00:00Z'),
          {
            fullName: 'Rustam Ismoilov',
            phone: '+998901112233',
            mainContact: false,
          },
        );
        await transaction
          .updateTable('relatives')
          .set({ workplace: 'Invented factory', email: 'rustam@example.com' })
          .where('id', '=', relative)
          .execute();
        return relative;
      });
      // The unlink guard compares with `app.now` (db/migrations/0036); the
      // relative with no live link left is archived by `relatives_follow_links`.
      await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`select set_config('app.now', '2026-10-01T09:00:00Z', true)`.execute(transaction);
        await transaction
          .updateTable('student_relatives')
          .set({ unlinked_at: new Date('2026-10-01T09:00:00Z') })
          .where('relative_id', '=', gone)
          .execute();
      });
      await entry({
        branch: t.north,
        action: 'relative.link',
        record: { type: 'relative', id: gone },
        newValue: { studentId, relationship: 'father' },
      });
      await entry({
        branch: t.north,
        action: 'relative.unlink',
        at: '2026-10-01T09:00:00Z',
        record: { type: 'relative', id: gone },
        oldValue: { studentId },
        newValue: { studentId, unlinkedAt: '2026-10-01T09:00:00Z' },
      });
      found = studentReportSchema.parse(ok(await report('students', studentId)));
    });

    it('holds every group of the record plainly, with the produced moment from the clock', () => {
      expect(found.student).toMatchObject({
        id: studentId,
        paternalName: 'Anvarovna',
        birthDate: '2013-04-11',
        documentType: 'birth_certificate',
        address: 'Chilonzor 9-kvartal 12',
        region: 'tashkent_city',
        diagnosticScore: 71,
        consentSignedOn: '2026-08-25',
        scholarship: { type: 'none', coverage: null, amount: null },
      });
      expect(found.student.contracts).toHaveLength(1);
      expect(found.student.statuses.map((row) => row.status)).toEqual(['active']);
      expect(found.student.uids.map((row) => row.uid)).toEqual([found.student.uid]);
      expect(found.producedAt).toBe(t.clock.now().toISOString());
      expect(found.branch).toMatchObject({ id: t.north, timeZone: 'Asia/Tashkent' });
    });

    it('holds a relative with no live link left, with the fields of the record and the ended link', () => {
      const relative = found.relatives.find((one) => one.id === gone);
      expect(relative).toMatchObject({
        fullName: 'Rustam Ismoilov',
        phone: '+998901112233',
        workplace: 'Invented factory',
        email: 'rustam@example.com',
        archivedAt: '2026-10-01T09:00:00.000Z',
        merged: false,
      });
      expect(relative?.links).toEqual([
        expect.objectContaining({ unlinkedAt: '2026-10-01T09:00:00.000Z', mainContact: false }),
      ]);
      expect(found.relatives).toHaveLength(2);
    });

    it("holds the link entries of a relative's record, which name the student in their values (correction 1)", () => {
      const actions = found.entries.map((one) => one.action);
      expect(actions).toContain('relative.link');
      expect(actions).toContain('relative.unlink');
      expect(actions).toContain('student.create');
    });

    it('writes one export entry in the log of the branch of the request', async () => {
      const before = await t.entries('student.personal_data_report', studentId);
      ok(await report('students', studentId));
      const after = await t.entries('student.personal_data_report', studentId);
      expect(after).toHaveLength(before.length + 1);
      expect(after.at(-1)).toMatchObject({
        branch_id: t.north,
        assignment_id: t.adminAssignment,
        person_id: studentId,
        record_type: 'student',
      });
      expect(after.at(-1)?.actor_id).not.toBeNull();
      expect(after.at(-1)?.details).toMatchObject({ entriesLeftOut: 0 });
      expect(JSON.stringify(after.at(-1)?.details)).toContain('"relatives"');
    });
  });

  describe("a staff member's report", () => {
    let staffId: string;
    let accountId: string;
    let found: StaffReport;
    let onlyActor: string;

    beforeAll(async () => {
      const browser = await t.kit.completeSession('Sarvinoz', 'Yusupova');
      accountId = browser.account.id;
      await t.kit.giveRole(accountId, { role: 'teacher', branchId: t.north });
      await t.kit.giveRole(accountId, { role: 'teacher', branchId: t.south });
      staffId = await person(accountId, [t.north, t.south]);
      for (const branch of [t.north, t.south]) {
        const entryId = await newId();
        await t.database.migrator
          .insertInto('staff_availability')
          .values({ id: entryId, branch_id: branch, staff_id: staffId, valid_from: '2026-09-01' })
          .execute();
        await t.database.migrator
          .insertInto('staff_availability_ranges')
          .values({
            entry_id: entryId,
            branch_id: branch,
            staff_id: staffId,
            valid_from: '2026-09-01',
            valid_until: 'infinity',
            weekday: branch === t.north ? 1 : 3,
            start_minutes: 480,
            end_minutes: 780,
          })
          .execute();
      }
      await entry({
        branch: t.south,
        action: 'staff.edit',
        person: staffId,
        record: { type: 'staff', id: staffId },
      });
      await entry({
        branch: t.south,
        action: 'account.locked',
        person: staffId,
        record: { type: 'account', id: accountId },
      });
      await entry({
        branch: null,
        action: 'relative.same_person',
        record: { type: 'relative', id: await newId() },
        newValue: { staffId },
        details: { staffId, branchId: t.north },
      });
      // The staff member's own work, where they are only the actor: not about them.
      onlyActor = await entry({ branch: t.north, action: 'room.edit', actor: accountId });
      found = staffReportSchema.parse(ok(await report('staff', staffId)));
    });

    it('holds the record, both branches, the availability of both and the roles of both (decision 1)', () => {
      expect(found.staff).toMatchObject({
        id: staffId,
        birthDate: '1989-06-07',
      });
      expect(found.staff.jshshir).toMatch(/^3123456789\d{4}$/);
      expect(found.staff.branches.map((one) => one.main)).toEqual([true, false]);
      expect(found.staff.availability).toHaveLength(2);
      expect(found.staff.availability.every((one) => one.until === null)).toBe(true);
      expect(
        found.staff.availability.flatMap((one) => one.ranges.map((r) => r.weekday)).sort(),
      ).toEqual([1, 3]);
      expect(found.account?.roles.map((one) => one.role)).toEqual(['teacher', 'teacher']);
      expect(found.account?.secondStepOn).toBe(true);
    });

    it('holds the entries about the person: record, account, assignments, own sign-in and the same-person mark (correction 1)', () => {
      const actions = found.entries.map((one) => one.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'staff.edit',
          'account.locked',
          'assignment.given',
          'auth.sign_in',
          'relative.same_person',
        ]),
      );
      expect(found.entries.map((one) => one.id)).not.toContain(onlyActor);
    });

    it('holds no secret of the account (decision 6)', async () => {
      const stored = await t.database.migrator
        .selectFrom('accounts')
        .select('password_hash')
        .where('id', '=', accountId)
        .executeTakeFirstOrThrow();
      const text = JSON.stringify(found);
      expect(text).not.toContain(stored.password_hash);
      expect(text).not.toMatch(/password_?hash|secret|recovery|token/i);
    });
  });

  describe("a relative's report", () => {
    let relative: string;
    let released: string;
    let found: RelativeReport;

    beforeAll(async () => {
      const northStudent = await student(t.north);
      relative = await relativeOf(northStudent);
      const southStudent = await student(t.south);
      const ended = await student(t.north);
      await t.database.migrator
        .insertInto('student_relatives')
        .values([
          {
            student_id: southStudent,
            branch_id: t.south,
            relative_id: relative,
            relationship: 'aunt',
            main_contact: false,
            linked_at: new Date('2026-09-05T08:00:00Z'),
          },
          {
            student_id: ended,
            branch_id: t.north,
            relative_id: relative,
            relationship: 'other',
            main_contact: false,
            linked_at: new Date('2026-09-05T08:00:00Z'),
            unlinked_at: new Date('2026-09-20T08:00:00Z'),
          },
        ])
        .execute();
      released = await entry({
        branch: null,
        action: 'relative.phone_released',
        record: { type: 'relative', id: await newId() },
        oldValue: { phone: '+998907776655' },
        newValue: { phone: null },
        details: { newOwnerId: relative, branchId: t.north },
      });
      found = relativeReportSchema.parse(ok(await report('relatives', relative)));
    });

    it("holds an entry about another relative without that person's values", () => {
      const other = found.entries.find((one) => one.id === released);
      expect(other).toMatchObject({
        action: 'relative.phone_released',
        oldValue: null,
        newValue: null,
      });
      expect(JSON.stringify(found)).not.toContain('+998907776655');
    });

    it('holds every link in every branch, live and ended (decision 1)', () => {
      expect(found.links).toHaveLength(3);
      expect(found.links.map((one) => one.relationship).sort()).toEqual([
        'aunt',
        'mother',
        'other',
      ]);
      expect(found.links.find((one) => one.relationship === 'other')?.unlinkedAt).toBe(
        '2026-09-20T08:00:00.000Z',
      );
      expect(found.relative.id).toBe(relative);
    });

    it("holds the relative's record entries from the school-wide log", () => {
      expect(found.entries.map((one) => one.action)).toContain('relative.create');
    });
  });

  describe('the entries of a report (decisions 7 and 11)', () => {
    it('names every people action with what puts it into a report (correction 1)', () => {
      const people = AUDIT_ACTIONS.filter(
        (action) =>
          /^(auth|account|assignment|staff|student|relative|vacancy)\./.test(action) ||
          action === 'audit.entry_shown',
      ).sort();
      expect(Object.keys(ENTRY_ABOUT).sort()).toEqual(people);
      const byValues = Object.entries(ENTRY_ABOUT)
        .filter(([, about]) => about.includes('values'))
        .map(([action]) => action)
        .sort();
      const matched = [
        ...new Set(
          Object.values(VALUE_MATCHES).flatMap((matches) => matches.flatMap((one) => one.actions)),
        ),
      ].sort();
      expect(matched).toEqual(byValues);
    });

    it('reads the newest entries up to the limit and counts the rest with the oldest moment', async () => {
      const subject = await newId();
      for (const at of ['2026-10-01T08:00:00Z', '2026-10-02T08:00:00Z', '2026-10-03T08:00:00Z']) {
        await entry({
          branch: t.north,
          action: 'student.edit',
          at,
          record: { type: 'student', id: subject },
        });
      }
      const read = await t.database.migrator
        .transaction()
        .execute((transaction) =>
          readPersonEntries(
            transaction,
            { kind: 'student', id: subject, accountId: null, assignmentIds: [] },
            2,
          ),
        );
      expect(read.rows.map((row) => row.occurred_at.toISOString())).toEqual([
        '2026-10-03T08:00:00.000Z',
        '2026-10-02T08:00:00.000Z',
      ]);
      expect(read.total).toBe(3);
      expect(read.oldestAt?.toISOString()).toBe('2026-10-01T08:00:00.000Z');
    });
  });

  describe('personal_data_relatives (decision 2)', () => {
    it('answers only the columns of the plan and runs for the application user alone', async () => {
      const found = await sql<{ result: string; public_can: boolean; app_can: boolean }>`
        select pg_get_function_result('personal_data_relatives(uuid)'::regprocedure) as result,
          has_function_privilege('public', 'personal_data_relatives(uuid)', 'execute') as public_can,
          has_function_privilege('sodiq_app', 'personal_data_relatives(uuid)', 'execute') as app_can
      `.execute(t.database.migrator);
      expect(found.rows[0]).toEqual({
        result:
          'TABLE(id uuid, full_name text, phone text, extra_phones text[], workplace text, email text, phone_invalid_since timestamp with time zone, archived_at timestamp with time zone, merged_into uuid, account_created_at timestamp with time zone, account_switched_on_at timestamp with time zone)',
        public_can: false,
        app_can: true,
      });
    });
  });
});
