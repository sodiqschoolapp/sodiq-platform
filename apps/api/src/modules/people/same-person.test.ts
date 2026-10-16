import {
  BRANCH_HEADER,
  apiErrorSchema,
  relativeDetailSchema,
  relativePhoneMatchResultSchema,
  staffCheckResultSchema,
  staffDetailSchema,
  studentDetailSchema,
  studentRelativesSchema,
  type StaffDetail,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { lockPhones } from './same-person.js';
import { staffIdOf } from './staff-numbers.js';

// All names and phones are invented. Issue #42, the owner's answer L81 of 15
// October 2026, and the answer of 16 October; task 3.6b-1, pull request #119.
// edge/close-relatives, "A teacher is also a parent": "The staff record and
// the relative record stay separate and are marked as the same person"; "The
// mark compares current phone numbers only." edge/people-roles-accounts, "A
// teacher who left is hired again": "A phone that belongs to another staff
// record is refused and that record is shown." The mark is read from the
// phones (decision 3): a new relative, a new staff member and every changed
// phone change it, with its entries; nobody sets it by hand.
describe('the mark "same person" read from the phones', () => {
  let t: DayTemplatesKit;
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

  const newRelative = (
    number: string | null,
    values: { fullName?: string; email?: string | null; mainContact?: boolean } = {},
  ) => ({
    kind: 'new',
    relative: {
      fullName: values.fullName ?? 'Rustam Nazarov',
      phone: number,
      workplace: null,
      email: values.email ?? null,
    },
    relationship: 'father',
    mainContact: values.mainContact ?? true,
    portalAccess: true,
    receivesNotices: true,
  });

  function studentBody(
    relatives: Record<string, unknown>[],
    own: { phone?: string } = {},
  ): Record<string, unknown> {
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
      phone: own.phone ?? '',
      email: '',
      address: '',
      region: null,
      previousSchool: '',
      diagnosticScore: null,
      scholarship: { type: 'none', coverage: null, amount: null },
      consentSignedOn: null,
      contract: { number: `SP-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives,
    };
  }

  /** A relative linked to a new student of a branch, created by the route. */
  async function relative(
    branch: string,
    number: string | null = phone(),
    values: { fullName?: string; email?: string | null } = {},
  ): Promise<{ id: string; studentId: string; phone: string | null; response: Response }> {
    const response = await t.postStudent(
      branch,
      studentBody([newRelative(number, values)]),
      t.admin,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const student = studentDetailSchema.parse(response.body);
    const tab = studentRelativesSchema.parse(
      (await t.get(`/api/people/students/${student.id}/relatives`, branch)).body,
    );
    const id = tab.relatives[0]?.relativeId;
    if (id === undefined) {
      throw new Error('A student is created with a relative.');
    }
    return { id, studentId: student.id, phone: number, response };
  }

  /** A staff person with a main branch and further ones, written by the migrator. */
  async function staffMember(
    main: string,
    options: { phone?: string; further?: string[]; left?: boolean } = {},
  ): Promise<{ id: string; phone: string }> {
    count += 1;
    const number = count;
    const own = options.phone ?? `+99894${String(7000000 + number)}`;
    const id = await t.database.migrator.transaction().execute(async (transaction) => {
      const row = await transaction
        .insertInto('staff')
        .values({
          kind: 'person',
          staff_id: staffIdOf(2026, 8000 + number),
          first_name: 'Rustam',
          last_name: `Nazarov${lettersOf(number)}`,
          father_name: 'Akmalovich',
          sex: 'male',
          birth_date: '1985-03-04',
          phone: own,
          email: `r.nazarov${lettersOf(number)}@example.uz`,
          admission_date: '2026-09-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_branches')
        .values([
          { staff_id: row.id, branch_id: main, is_main: true },
          ...(options.further ?? []).map((branch) => ({
            staff_id: row.id,
            branch_id: branch,
            is_main: false,
          })),
        ])
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({ staff_id: row.id, division_id: academic, department_id: steam, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values(
          options.left === true
            ? [
                {
                  staff_id: row.id,
                  status: 'active',
                  valid_from: '2026-09-01',
                  valid_until: '2026-09-10',
                },
                { staff_id: row.id, status: 'left', valid_from: '2026-09-10' },
              ]
            : [{ staff_id: row.id, status: 'active', valid_from: '2026-09-01' }],
        )
        .execute();
      return row.id;
    });
    return { id, phone: own };
  }

  /** A new staff member's body for the create route. */
  function staffBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    count += 1;
    return {
      firstName: 'Akmal',
      lastName: `Karimov${lettersOf(count)}`,
      fatherName: '',
      sex: 'male',
      birthDate: '1990-01-01',
      educationLevel: 'master',
      phone: phone(),
      email: '',
      jshshir: '',
      admissionDate: '2026-09-01',
      contractType: 'full_time',
      contractDate: '2026-09-01',
      weeklyLessons: 18,
      dailyLessons: 5,
      divisions: [{ divisionId: academic, departmentId: steam, main: true }],
      ...overrides,
    };
  }

  /** What an edit of a staff record sends: the fields of the answer. */
  const staffEdit = (staff: StaffDetail, overrides: Record<string, unknown> = {}) => ({
    firstName: staff.firstName,
    lastName: staff.lastName,
    fatherName: staff.fatherName ?? '',
    sex: staff.sex,
    birthDate: staff.birthDate,
    educationLevel: staff.educationLevel,
    phone: staff.phone,
    email: staff.email ?? '',
    jshshir: staff.jshshir ?? '',
    admissionDate: staff.admissionDate,
    contractType: staff.contractType,
    contractDate: staff.contractDate,
    weeklyLessons: staff.weeklyLessons,
    dailyLessons: staff.dailyLessons,
    divisions: staff.divisions,
    ...overrides,
  });

  const staffOf = async (id: string, branch = t.north) => {
    const response = await t.get(`/api/people/staff/${id}`, branch, t.admin);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return staffDetailSchema.parse(response.body);
  };

  const editStaffPhone = async (id: string, number: string, branch = t.north) =>
    t.put(
      `/api/people/staff/${id}`,
      branch,
      staffEdit(await staffOf(id, branch), { phone: number }),
      t.vicePrincipal,
    );

  const relativeOf = async (id: string, branch = t.north) => {
    const response = await t.get(`/api/people/relatives/${id}`, branch);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return relativeDetailSchema.parse(response.body);
  };

  const editRelative = (id: string, record: Record<string, unknown>, branch = t.north) =>
    t.patch(`/api/people/relatives/${id}`, branch, record, t.vicePrincipal);

  const relativeRecord = (number: string | null, fullName = 'Rustam Nazarov') => ({
    fullName,
    phone: number,
    workplace: null,
    email: null,
    extraPhones: [],
  });

  /** The mark as the database reads it, past every branch. */
  const markOf = async (relativeId: string) => {
    const found = await sql<{ staff_id: string }>`
      select staff_id from same_person_staff(${[relativeId]}::uuid[])
    `.execute(t.database.migrator);
    return found.rows[0]?.staff_id ?? null;
  };

  const schoolEntries = (action: string, recordId: string) =>
    t.database.migrator
      .selectFrom('audit_log_school')
      .selectAll()
      .where('action', '=', action)
      .where('record_id', '=', recordId)
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();

  const markEntries = async (recordId: string) => [
    ...(await schoolEntries('relative.same_person', recordId)),
    ...(await schoolEntries('relative.same_person_removed', recordId)),
  ];

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  const detailsOf = (response: Response) => apiErrorSchema.parse(response.body).error.details ?? [];

  /** Every row of the tables the routes write, in both branches. */
  async function snapshot(): Promise<Record<string, unknown>> {
    const rows: Record<string, unknown> = {};
    for (const table of [
      'relatives',
      'relative_accounts',
      'student_relatives',
      'students',
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

  async function waitingOnAnAdvisoryLock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted and l.locktype = 'advisory'
    `.execute(t.database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  async function untilWaiting(): Promise<void> {
    for (let tries = 0; tries < 200; tries += 1) {
      if ((await waitingForALock()) > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Nothing waits for a lock.');
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
  });

  afterAll(async () => {
    await t.close();
  });

  describe('a new relative with a staff phone', () => {
    it('is marked, takes the name and email of a staff member of the branch, and writes the entries', async () => {
      const teacher = await staffMember(t.north);
      const match = relativePhoneMatchResultSchema.parse(
        (await t.post('/api/people/relatives/phone-match', t.north, { phone: teacher.phone })).body,
      );
      expect(match).toMatchObject({
        holder: null,
        staff: { fullName: expect.stringMatching(/^Nazarov[a-z]* Rustam Akmalovich$/) as unknown },
        staffElsewhere: false,
      });
      // The typed name and email are replaced by the staff record's.
      const parent = await relative(t.north, teacher.phone, {
        fullName: 'Typed Name',
        email: 'typed@example.uz',
      });
      const detail = await relativeOf(parent.id);
      expect(detail.fullName).toBe(match.staff?.fullName);
      expect(detail.samePerson).toMatchObject({ staffId: teacher.id });
      expect(detail.samePerson?.name).toMatch(/^Nazarov[a-z]* Rustam$/);
      expect(detail.samePersonElsewhere).toBe(false);
      expect(await markOf(parent.id)).toBe(teacher.id);
      const [created] = await schoolEntries('relative.create', parent.id);
      expect(created?.new_value).toMatchObject({
        fullName: match.staff?.fullName,
        email: match.staff?.email,
      });
      expect(created?.details).toEqual({
        branchId: t.north,
        samePerson: { before: null, after: teacher.id },
      });
      expect(await markEntries(parent.id)).toEqual([
        expect.objectContaining({
          action: 'relative.same_person',
          assignment_id: t.adminAssignment,
          old_value: { staffId: null },
          new_value: { staffId: teacher.id },
          details: { branchId: t.north, staffId: teacher.id, cause: 'relative_created' },
          request_id: expect.any(String) as unknown,
        }),
      ]);
      // The staff panel shows the relative to the readers of relatives.
      for (const cookie of [t.vicePrincipal, t.principal, t.admin]) {
        const staff = await t.get(`/api/people/staff/${teacher.id}`, t.north, cookie);
        expect(staffDetailSchema.parse(staff.body).sameAsRelative).toEqual({
          id: parent.id,
          fullName: detail.fullName,
        });
      }
    });

    it('is marked with a staff member of another branch, with the typed name and nothing told of the record', async () => {
      const teacher = await staffMember(t.south);
      const match = relativePhoneMatchResultSchema.parse(
        (await t.post('/api/people/relatives/phone-match', t.north, { phone: teacher.phone })).body,
      );
      expect(match).toEqual({ holder: null, staff: null, staffElsewhere: true });
      const parent = await relative(t.north, teacher.phone, {
        fullName: 'Shoira Rahimova',
        email: 'shoira@example.uz',
      });
      const detail = await relativeOf(parent.id);
      expect(detail).toMatchObject({
        fullName: 'Shoira Rahimova',
        samePerson: null,
        samePersonElsewhere: true,
      });
      expect(await markOf(parent.id)).toBe(teacher.id);
      expect(JSON.stringify(detail)).not.toContain(teacher.id);
      expect(await markEntries(parent.id)).toHaveLength(1);
      // The south reads the relative's name on its staff panel only when the
      // relative is linked there: here it is not.
      const staff = await t.get(`/api/people/staff/${teacher.id}`, t.south, t.admin);
      expect(staffDetailSchema.parse(staff.body).sameAsRelative).toBeNull();
    });

    it('marks a relative with no phone of its own never, and a student phone equal to a staff phone is never compared', async () => {
      const teacher = await staffMember(t.north);
      const parent = await relative(t.north, null);
      expect((await relativeOf(parent.id)).samePerson).toBeNull();
      const response = await t.postStudent(
        t.north,
        studentBody([newRelative(phone())], { phone: teacher.phone }),
        t.admin,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const staff = await staffOf(teacher.id);
      expect(staff.sameAsRelative).toBeNull();
      expect(await markOf(parent.id)).toBeNull();
    });
  });

  describe('a new staff member with a relative phone', () => {
    it('marks the relative and takes its email when none is typed, the names typed', async () => {
      const number = phone();
      const parent = await relative(t.north, number, {
        fullName: 'Nodira Saidova',
        email: 'nodira@example.uz',
      });
      const ask = await t.post('/api/people/staff/check', t.north, {
        firstName: 'Nodira',
        lastName: 'Saidova',
        birthDate: '1987-05-05',
        phone: number,
        staffRecordId: null,
      });
      expect(staffCheckResultSchema.parse(ask.body)).toMatchObject({
        phoneTaken: null,
        relative: { fullName: 'Nodira Saidova', email: 'nodira@example.uz' },
        relativeElsewhere: false,
      });
      const created = await t.post(
        '/api/people/staff',
        t.north,
        staffBody({ firstName: 'Nodira', lastName: 'Saidova', phone: number, email: '' }),
      );
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const staff = staffDetailSchema.parse(created.body);
      expect(staff).toMatchObject({
        firstName: 'Nodira',
        lastName: 'Saidova',
        email: 'nodira@example.uz',
        sameAsRelative: { id: parent.id, fullName: 'Nodira Saidova' },
      });
      expect(await markOf(parent.id)).toBe(staff.id);
      const [entry] = await t.entries('staff.create', staff.id);
      expect(entry?.details).toEqual({ samePerson: { before: null, after: parent.id } });
      expect(await markEntries(parent.id)).toEqual([
        expect.objectContaining({
          action: 'relative.same_person',
          new_value: { staffId: staff.id },
          details: { branchId: t.north, staffId: staff.id, cause: 'staff_created' },
        }),
      ]);
      expect((await relativeOf(parent.id)).samePerson?.staffId).toBe(staff.id);
    });

    it('keeps a typed email, and tells a relative of another branch without naming it', async () => {
      const number = phone();
      const parent = await relative(t.south, number, { email: 'south@example.uz' });
      const ask = await t.post('/api/people/staff/check', t.north, {
        firstName: 'Sanjar',
        lastName: 'Aliyev',
        birthDate: '1987-05-05',
        phone: number,
        staffRecordId: null,
      });
      expect(staffCheckResultSchema.parse(ask.body)).toMatchObject({
        relative: null,
        relativeElsewhere: true,
      });
      const created = await t.post(
        '/api/people/staff',
        t.north,
        staffBody({ phone: number, email: 'own@example.uz' }),
      );
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const staff = staffDetailSchema.parse(created.body);
      expect(staff.email).toBe('own@example.uz');
      expect(staff.sameAsRelative).toBeNull();
      expect(await markOf(parent.id)).toBe(staff.id);
      expect(await markEntries(parent.id)).toHaveLength(1);
    });
  });

  describe('a changed phone', () => {
    it('of a relative marks when it becomes a staff phone and unmarks when it changes away, the details kept', async () => {
      const teacher = await staffMember(t.north);
      const parent = await relative(t.north, phone(), { fullName: 'Dilshod Rasulov' });
      const marked = await editRelative(
        parent.id,
        relativeRecord(teacher.phone, 'Dilshod Rasulov'),
      );
      expect(marked.status, JSON.stringify(marked.body)).toBe(200);
      // An edit takes no details (decision 7).
      expect(relativeDetailSchema.parse(marked.body)).toMatchObject({
        fullName: 'Dilshod Rasulov',
        samePerson: { staffId: teacher.id },
      });
      const [edit] = await schoolEntries('relative.edit', parent.id);
      expect(edit?.details).toEqual({
        branchId: t.north,
        samePerson: { before: null, after: teacher.id },
      });
      const unmarked = await editRelative(parent.id, relativeRecord(phone(), 'Dilshod Rasulov'));
      expect(unmarked.status, JSON.stringify(unmarked.body)).toBe(200);
      expect(relativeDetailSchema.parse(unmarked.body).samePerson).toBeNull();
      expect(await markEntries(parent.id)).toEqual([
        expect.objectContaining({
          action: 'relative.same_person',
          new_value: { staffId: teacher.id },
          details: { branchId: t.north, staffId: teacher.id, cause: 'relative_phone' },
        }),
        expect.objectContaining({
          action: 'relative.same_person_removed',
          old_value: { staffId: teacher.id },
          new_value: { staffId: null },
          details: { branchId: t.north, staffId: teacher.id, cause: 'relative_phone' },
        }),
      ]);
      // A name change alone writes no mark entry.
      expect(
        (await editRelative(parent.id, relativeRecord(teacher.phone, 'Dilshod Rasulov'))).status,
      ).toBe(200);
      expect(
        (await editRelative(parent.id, relativeRecord(teacher.phone, 'Dilshod Rasulovich'))).status,
      ).toBe(200);
      expect(await markEntries(parent.id)).toHaveLength(3);
    });

    it('of a staff member marks when it becomes a relative phone and unmarks when it changes away', async () => {
      const teacher = await staffMember(t.north);
      const parent = await relative(t.north);
      const marked = await editStaffPhone(teacher.id, parent.phone ?? '');
      expect(marked.status, JSON.stringify(marked.body)).toBe(200);
      expect(staffDetailSchema.parse(marked.body).sameAsRelative?.id).toBe(parent.id);
      const [edit] = await t.entries('staff.edit', teacher.id);
      expect(edit?.details).toEqual({ samePerson: { before: null, after: parent.id } });
      const unmarked = await editStaffPhone(teacher.id, phone());
      expect(unmarked.status, JSON.stringify(unmarked.body)).toBe(200);
      expect(staffDetailSchema.parse(unmarked.body).sameAsRelative).toBeNull();
      expect(await markEntries(parent.id)).toEqual([
        expect.objectContaining({
          action: 'relative.same_person',
          assignment_id: t.viceAssignment,
          details: { branchId: t.north, staffId: teacher.id, cause: 'staff_phone' },
        }),
        expect.objectContaining({
          action: 'relative.same_person_removed',
          details: { branchId: t.north, staffId: teacher.id, cause: 'staff_phone' },
        }),
      ]);
    });

    it('of a staff member moves the mark from one relative to another in one change', async () => {
      const first = await relative(t.north);
      const second = await relative(t.north);
      const teacher = await staffMember(t.north, { phone: first.phone ?? '' });
      expect(await markOf(first.id)).toBe(teacher.id);
      const moved = await editStaffPhone(teacher.id, second.phone ?? '');
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect(await markOf(first.id)).toBeNull();
      expect(await markOf(second.id)).toBe(teacher.id);
      const [edit] = await t.entries('staff.edit', teacher.id);
      expect(edit?.details).toEqual({ samePerson: { before: first.id, after: second.id } });
      expect(await markEntries(first.id)).toEqual([
        expect.objectContaining({ action: 'relative.same_person_removed' }),
      ]);
      expect(await markEntries(second.id)).toEqual([
        expect.objectContaining({ action: 'relative.same_person' }),
      ]);
    });

    it('of a staff member marks a relative linked only in another branch and an archived relative', async () => {
      const south = await relative(t.south);
      const teacher = await staffMember(t.north);
      expect((await editStaffPhone(teacher.id, south.phone ?? '')).status).toBe(200);
      expect(await markOf(south.id)).toBe(teacher.id);
      expect(await markEntries(south.id)).toHaveLength(1);
      // The north reads nothing of the south's relative.
      expect((await staffOf(teacher.id)).sameAsRelative).toBeNull();
      // A relative archived by its last unlink keeps its phone and its mark.
      const archived = await relative(t.north);
      const [link] = studentRelativesSchema.parse(
        (await t.get(`/api/people/students/${archived.studentId}/relatives`, t.north)).body,
      ).relatives;
      expect(link?.relativeId).toBe(archived.id);
      const second = await t.post(
        `/api/people/students/${archived.studentId}/relatives`,
        t.north,
        newRelative(phone(), { fullName: 'Gulnora Azimova', mainContact: false }),
      );
      expect(second.status, JSON.stringify(second.body)).toBe(201);
      const next = studentRelativesSchema
        .parse(second.body)
        .relatives.find((one) => one.relativeId !== archived.id);
      const unlinked = await t.post(
        `/api/people/students/${archived.studentId}/relatives/${archived.id}/unlink`,
        t.north,
        { newMainContactId: next?.relativeId ?? null },
      );
      expect(unlinked.status, JSON.stringify(unlinked.body)).toBe(200);
      const other = await staffMember(t.north);
      expect((await editStaffPhone(other.id, archived.phone ?? '')).status).toBe(200);
      expect(await markOf(archived.id)).toBe(other.id);
      expect(await markEntries(archived.id)).toEqual([
        expect.objectContaining({
          action: 'relative.same_person',
          details: { branchId: t.north, staffId: other.id, cause: 'staff_phone' },
        }),
      ]);
    });
  });

  describe('one phone for one adult', () => {
    it('refuses a new staff member with another staff phone, named in the branch only, left records included', async () => {
      const here = await staffMember(t.north);
      const left = await staffMember(t.north, { left: true });
      const there = await staffMember(t.south);
      for (const holder of [here, left]) {
        const before = await snapshot();
        const refused = await t.post(
          '/api/people/staff',
          t.north,
          staffBody({ phone: holder.phone }),
        );
        refusedWith(refused, 409, 'staff_phone_taken');
        expect(detailsOf(refused)[0]).toMatchObject({
          path: 'phone',
          recordId: holder.id,
          staffName: expect.stringMatching(/^Nazarov[a-z]* Rustam$/) as unknown,
        });
        expect(await snapshot()).toEqual(before);
      }
      const before = await snapshot();
      const refused = await t.post('/api/people/staff', t.north, staffBody({ phone: there.phone }));
      refusedWith(refused, 409, 'staff_phone_taken');
      expect(detailsOf(refused)[0]).toEqual({
        path: 'phone',
        code: 'staff_phone_taken',
        message: expect.any(String) as unknown,
      });
      expect(await snapshot()).toEqual(before);
      // The check before Save says the same.
      const ask = (number: string) =>
        t.post('/api/people/staff/check', t.north, {
          firstName: 'Akmal',
          lastName: 'Karimov',
          birthDate: '1990-01-01',
          phone: number,
          staffRecordId: null,
        });
      expect(staffCheckResultSchema.parse((await ask(left.phone)).body).phoneTaken).toEqual({
        match: expect.objectContaining({ id: left.id }) as unknown,
      });
      expect(staffCheckResultSchema.parse((await ask(there.phone)).body).phoneTaken).toEqual({
        match: null,
      });
      expect(staffCheckResultSchema.parse((await ask(phone())).body).phoneTaken).toBeNull();
    });

    it('refuses an edit to another staff phone, and lets a record keep its own', async () => {
      const holder = await staffMember(t.north);
      const edited = await staffMember(t.north);
      const before = await snapshot();
      refusedWith(await editStaffPhone(edited.id, holder.phone), 409, 'staff_phone_taken');
      expect(await snapshot()).toEqual(before);
      const own = await t.put(
        `/api/people/staff/${edited.id}`,
        t.north,
        staffEdit(await staffOf(edited.id), { email: 'kept@example.uz' }),
        t.vicePrincipal,
      );
      expect(own.status, JSON.stringify(own.body)).toBe(200);
      const ask = await t.post('/api/people/staff/check', t.north, {
        firstName: 'Rustam',
        lastName: 'Nazarov',
        birthDate: '1985-03-04',
        phone: edited.phone,
        staffRecordId: edited.id,
      });
      expect(staffCheckResultSchema.parse(ask.body).phoneTaken).toBeNull();
    });

    it('refuses "a new owner" of a staff member\'s phone (phone_is_staff), on the create, the link and the edit', async () => {
      const teacher = await staffMember(t.north);
      const holder = await relative(t.north, teacher.phone);
      const elsewhereTeacher = await staffMember(t.south);
      const elsewhereHolder = await relative(t.north, elsewhereTeacher.phone);
      const target = await relative(t.north);
      const newOwner = (number: string, previousId: string) => ({
        kind: 'new_owner',
        relative: { fullName: 'Nodira Rasulova', phone: number, workplace: null, email: null },
        previousId,
        previousPhone: phone(),
        relationship: 'mother',
        mainContact: true,
        portalAccess: true,
        receivesNotices: true,
      });
      for (const [staff, previous] of [
        [teacher, holder],
        [elsewhereTeacher, elsewhereHolder],
      ] as const) {
        const before = await snapshot();
        const created = await t.postStudent(
          t.north,
          studentBody([newOwner(staff.phone, previous.id)]),
          t.admin,
        );
        refusedWith(created, 409, 'phone_is_staff');
        const linked = await t.post(`/api/people/students/${target.studentId}/relatives`, t.north, {
          ...newOwner(staff.phone, previous.id),
          mainContact: false,
        });
        refusedWith(linked, 409, 'phone_is_staff');
        const edited = await editRelative(target.id, {
          ...relativeRecord(staff.phone),
          newOwner: { previousId: previous.id, previousPhone: null },
        });
        refusedWith(edited, 409, 'phone_is_staff');
        for (const response of [created, linked, edited]) {
          const [detail] = detailsOf(response);
          if (staff === teacher) {
            expect(detail).toMatchObject({ recordId: teacher.id, staffName: expect.any(String) as unknown });
          } else {
            expect(detail?.recordId).toBeUndefined();
            expect(detail?.staffName).toBeUndefined();
          }
        }
        expect(await snapshot()).toEqual(before);
      }
    });

    it('gives a released holder a staff phone as its new phone, and marks it', async () => {
      const number = phone();
      const holder = await relative(t.north, number);
      const teacher = await staffMember(t.north);
      const created = await t.postStudent(
        t.north,
        studentBody([
          {
            kind: 'new_owner',
            relative: { fullName: 'Nodira Rasulova', phone: number, workplace: null, email: null },
            previousId: holder.id,
            previousPhone: teacher.phone,
            relationship: 'mother',
            mainContact: true,
            portalAccess: true,
            receivesNotices: true,
          },
        ]),
        t.admin,
      );
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(await markOf(holder.id)).toBe(teacher.id);
      const [released] = await schoolEntries('relative.phone_released', holder.id);
      expect(released?.details).toMatchObject({
        samePerson: { before: null, after: teacher.id },
      });
      expect(await markEntries(holder.id)).toEqual([
        expect.objectContaining({
          action: 'relative.same_person',
          details: { branchId: t.north, staffId: teacher.id, cause: 'phone_released' },
        }),
      ]);
    });
  });

  describe('the merge', () => {
    const mergeOf = (kept: { id: string; phone: string | null }, merged: typeof kept) =>
      t.post(
        `/api/people/relatives/${kept.id}/merge`,
        t.north,
        {
          otherId: merged.id,
          thisPhone: kept.phone,
          otherPhone: merged.phone,
          phoneOf: 'this',
          nameOf: 'this',
        },
        t.vicePrincipal,
      );

    it("keeps the mark of the kept record's phone", async () => {
      const teacher = await staffMember(t.north);
      const kept = await relative(t.north, teacher.phone);
      const merged = await relative(t.north);
      const response = await mergeOf(kept, merged);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(relativeDetailSchema.parse(response.body).samePerson?.staffId).toBe(teacher.id);
      expect(await markEntries(kept.id)).toHaveLength(1);
      expect(await markEntries(merged.id)).toEqual([]);
    });

    it("ends the mark of the merged record's phone, which goes", async () => {
      const teacher = await staffMember(t.north);
      const kept = await relative(t.north);
      const merged = await relative(t.north, teacher.phone);
      const response = await mergeOf(kept, merged);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(relativeDetailSchema.parse(response.body).samePerson).toBeNull();
      expect(await markOf(merged.id)).toBeNull();
      const [entry] = await schoolEntries('relative.merged', merged.id);
      expect(entry?.details).toMatchObject({ samePerson: { before: teacher.id, after: null } });
      expect((await markEntries(merged.id)).at(-1)).toMatchObject({
        action: 'relative.same_person_removed',
        assignment_id: t.viceAssignment,
        details: { branchId: t.north, staffId: teacher.id, cause: 'merge' },
      });
      // The staff phone is free of any relative now: a new one takes it.
      const next = await relative(t.north, teacher.phone);
      expect(await markOf(next.id)).toBe(teacher.id);
    });
  });

  describe('the hand mark of 2.5b-2 is gone', () => {
    it('answers 404 to the two routes it had', async () => {
      const parent = await relative(t.north);
      const teacher = await staffMember(t.north);
      const before = await snapshot();
      for (const response of [
        await t.put(`/api/people/relatives/${parent.id}/same-person`, t.north, {
          staffId: teacher.id,
        }),
        await request(t.kit.server)
          .delete(`/api/people/relatives/${parent.id}/same-person`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, t.north),
      ]) {
        expect(response.status).toBe(404);
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  // `.claude/rules/database.md`: the two sides of a same-moment test of an
  // advisory lock meet on no row and no index besides it. A relative's insert
  // and a staff record's update meet on neither; `phone_owner_lock` makes the
  // second read the first's phone, so exactly one entry says the mark began.
  describe('at the same moment (phone_owner_lock)', () => {
    it('a new relative that waited on a staff phone set to its phone writes the one entry', async () => {
      const teacher = await staffMember(t.north);
      const number = phone();
      // The held side does what the staff edit does: the lock of both phones,
      // then the write of the phone.
      const held = await holdOpen([t.north], async (transaction) => {
        await lockPhones(transaction, [teacher.phone, number]);
        await transaction
          .updateTable('staff')
          .set({ phone: number })
          .where('id', '=', teacher.id)
          .execute();
      });
      const waiting = relative(t.north, number);
      await untilWaiting();
      expect(await waitingOnAnAdvisoryLock()).toBe(1);
      held.release();
      await held.done;
      const parent = await waiting;
      expect(await markOf(parent.id)).toBe(teacher.id);
      expect(await markEntries(parent.id)).toEqual([
        expect.objectContaining({
          action: 'relative.same_person',
          details: { branchId: t.north, staffId: teacher.id, cause: 'relative_created' },
        }),
      ]);
    });

    it('a staff phone change that waited on a relative phone set to the same phone writes the one entry', async () => {
      const teacher = await staffMember(t.north);
      const parent = await relative(t.north);
      const number = phone();
      // The held side does what the relative edit does.
      const held = await holdOpen([t.north], async (transaction) => {
        await lockPhones(transaction, [parent.phone, number]);
        await transaction
          .updateTable('relatives')
          .set({ phone: number })
          .where('id', '=', parent.id)
          .execute();
      });
      const waiting = editStaffPhone(teacher.id, number);
      await untilWaiting();
      expect(await waitingOnAnAdvisoryLock()).toBe(1);
      held.release();
      await held.done;
      const response = await waiting;
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await markOf(parent.id)).toBe(teacher.id);
      expect(await markEntries(parent.id)).toEqual([
        expect.objectContaining({
          action: 'relative.same_person',
          details: { branchId: t.north, staffId: teacher.id, cause: 'staff_phone' },
        }),
      ]);
    });
  });
});
