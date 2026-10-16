import {
  BRANCH_HEADER,
  phoneText,
  studentDetailSchema,
  studentListSchema,
  studentNoClassSchema,
  type StudentDetail,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { relativesInput } from '../../testing/relatives-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { binary, dateOfCell, fileOf } from '../../testing/xlsx-kit.js';

/** A stored phone as the file writes it (finding 24). */
const grouped = (phone: string | null | undefined): string => phoneText(phone ?? '');

// All names are invented. Task 2.4b-2, the plan approved on pull request #70
// with its corrections: the export of the student list by readers, the
// consent list and the "No class" counter (docs/spec/04-people.md, Student
// record; docs/spec/edge-cases/people-roles-accounts.md, Personal data and
// the audit log: "An export contains only what the role may see.
// Whole-branch exports with contact or identity fields are for the Super
// Admin and Academic Vice Principal ... Every export is logged with its
// filters and row count"; docs/spec/edge-cases/students-classes-groups.md:
// "in a counter on the Academic Vice Principal's home page"). The clock stands
// at 23:55 on 10 October 2026 in Tashkent.
describe('the student export, the consent list and the "No class" counter', () => {
  let t: DayTemplatesKit;
  let spiritual: string;
  let headTutor: string;
  let tutor: string;
  let headTeacher: string;
  let seniorHeadTeacher: string;
  let nurse: string;
  let principalAssignment: string;
  let count = 0;

  function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    count += 1;
    return {
      uid: String(2607500 + count),
      confirmUidSet: false,
      firstName: 'Oʻtkir',
      lastName: `Rasulov${'a'.repeat(count % 9)}`,
      paternalName: 'Anvarovich',
      sex: 'male',
      birthDate: `2014-04-${String((count % 28) + 1).padStart(2, '0')}`,
      grade: 7,
      startsOn: '2026-09-02',
      documentType: 'birth_certificate',
      documentNumber: `I-TX${String(1000000 + count)}`,
      jshshir: String(31404140000000 + count),
      phone: `+99893${String(2000000 + count)}`,
      email: `pupil${String(count)}@example.com`,
      address: 'Bunyodkor koʻchasi 7',
      region: 'samarkand',
      previousSchool: '41-maktab',
      diagnosticScore: 81,
      scholarship: { type: 'financial_aid', coverage: 'partial', amount: 750000 },
      consentSignedOn: '2026-08-21',
      contract: { number: `EX-2026/${String(count)}`, signedOn: '2026-08-21' },
      relatives: relativesInput(),
      ...overrides,
    };
  }

  async function create(
    overrides: Record<string, unknown> = {},
    branch = '',
  ): Promise<StudentDetail> {
    const response = await t.postStudent(branch || t.north, body(overrides));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body);
  }

  const leave = async (student: StudentDetail, lastDay: string) => {
    const response = await t.post(`/api/people/students/${student.id}/leaving`, t.north, {
      lastDay,
      reason: 'The family moved to another city.',
      version: student.version,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return studentDetailSchema.parse(response.body);
  };

  /** An export as the Export button sends it; the answer's body as bytes. */
  const exportOf = (body: object, cookie = t.admin, branch = t.north): Promise<Response> =>
    request(t.kit.server)
      .post('/api/people/students/export')
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .send(body)
      .buffer(true)
      .parse(binary);

  const send = (ids: string[], columns: string[], extra: Record<string, unknown> = {}) => ({
    ids,
    columns,
    selection: 'ticked',
    search: '',
    filters: {},
    ...extra,
  });

  const codeOf = (response: Response): string =>
    (JSON.parse((response.body as Buffer).toString('utf8')) as { error: { code: string } }).error
      .code;

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, (response.body as Buffer).toString('utf8')).toBe(status);
    expect(codeOf(response)).toBe(code);
  };

  /** Every account reads and exports in this language. */
  const speak = async (language: 'uz' | 'ru' | 'en') => {
    await t.database.migrator.updateTable('accounts').set({ language }).execute();
  };

  /** Every row of the student tables and the audit log: what a refused export leaves as it was. */
  async function snapshot(): Promise<Record<string, unknown>> {
    const rows: Record<string, unknown> = { audit: await t.auditCount() };
    for (const table of ['students', 'student_uids', 'student_contracts', 'student_statuses']) {
      rows[table] = await sql`select * from ${sql.table(table)} order by 1, 2`.execute(
        t.database.migrator,
      );
    }
    return rows;
  }

  async function signedIn(first: string, last: string, role: string, branchId: string | null) {
    const browser = await t.kit.fullSession(first, last);
    await t.kit.giveRole(browser.account.id, {
      role: role as never,
      ...(branchId === null ? {} : { branchId }),
    });
    return browser.cookie;
  }

  const list = async (cookie: string, query = '') => {
    const response = await t.get(`/api/people/students${query}`, t.north, cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return studentListSchema.parse(response.body);
  };

  beforeAll(async () => {
    t = await dayTemplatesKit();
    for (const [branch, start, end] of [
      [t.north, '2026-09-01', '2027-05-31'],
      [t.south, '2026-09-01', '2027-05-31'],
    ] as const) {
      await t.database.migrator.transaction().execute(async (transaction) => {
        const year = await transaction
          .insertInto('academic_years')
          .values({ branch_id: branch, start_date: start, end_date: end })
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
    spiritual = await signedIn('Gulnora', 'Tosheva', 'spiritual_vice_principal', t.north);
    headTutor = await signedIn('Malika', 'Yusupova', 'head_tutor', t.north);
    tutor = await signedIn('Sardor', 'Rahimov', 'tutor', t.north);
    headTeacher = await signedIn('Feruza', 'Nazarova', 'head_teacher', t.north);
    seniorHeadTeacher = await signedIn('Nodir', 'Usmonov', 'senior_head_teacher', null);
    nurse = await signedIn('Shahlo', 'Qodirova', 'nurse', t.north);
    principalAssignment = (
      await t.database.migrator
        .selectFrom('assignments')
        .select('id')
        .where('role', '=', 'principal')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the list', () => {
    it('names the groups each reader may export and whether it reads the consent', async () => {
      const groups = ['basic', 'contact', 'identity', 'financial', 'diagnostic'];
      // Task 3.6a (decisions 9 to 11 of pull request #118): the Head Tutor
      // every group (L59), the Head Teachers Basic (L59), the Tutor every
      // group it reads of own classes (L136), the score its own group (L50).
      for (const [cookie, exportGroups, readsFinancial] of [
        [t.admin, groups, true],
        [t.vicePrincipal, groups, true],
        [t.principal, ['basic', 'financial', 'diagnostic'], true],
        [spiritual, [], false],
        [headTutor, groups, true],
        [tutor, ['basic', 'contact', 'diagnostic'], false],
        [headTeacher, ['basic'], false],
        [seniorHeadTeacher, ['basic'], false],
      ] as const) {
        const answer = await list(cookie);
        expect(answer.exportGroups, cookie).toEqual(exportGroups);
        expect(answer.readsFinancial, cookie).toBe(readsFinancial);
      }
    });

    it('answers whether consent is missing to the Financial readers only', async () => {
      const without = await create({ consentSignedOn: null });
      // Task 3.6a (L59): the Head Tutor reads Financial.
      for (const cookie of [t.admin, t.vicePrincipal, t.principal, headTutor]) {
        const row = (await list(cookie)).students.find((item) => item.id === without.id);
        expect(row?.consentMissing, cookie).toBe(true);
      }
      for (const cookie of [spiritual, tutor, headTeacher, seniorHeadTeacher]) {
        const answer = await list(cookie);
        const row = answer.students.find((item) => item.id === without.id);
        expect(row?.consentMissing, cookie).toBeNull();
        expect(answer.students.every((item) => item.consentMissing === null)).toBe(true);
      }
    });

    // Answer 23: "a list shows active students without it".
    it('keeps the active students without consent, a student before the start date included', async () => {
      const signed = await create();
      const without = await create({ consentSignedOn: null });
      const later = await create({ consentSignedOn: null, startsOn: '2026-11-02' });
      const left = await leave(await create({ consentSignedOn: null }), '2026-10-01');
      const scheduled = await leave(await create({ consentSignedOn: null }), '2026-10-20');
      for (const cookie of [t.admin, t.vicePrincipal, t.principal, headTutor]) {
        const ids = (await list(cookie, '?consent=missing')).students.map((item) => item.id);
        expect(ids, cookie).toContain(without.id);
        expect(ids).toContain(later.id);
        expect(ids).toContain(scheduled.id);
        expect(ids).not.toContain(signed.id);
        expect(ids).not.toContain(left.id);
      }
    });

    // Correction 3: decided in the branch of the request, on the list too.
    it('decides the consent list and the export groups in the branch of the request', async () => {
      await create({ consentSignedOn: null });
      await create({ consentSignedOn: null }, t.south);
      const both = await t.kit.completeSession('Dildora', 'Karimova');
      // Task 3.6a: the Spiritual VP, since the Head Tutor reads Financial (L59).
      await t.kit.giveRole(both.account.id, {
        role: 'spiritual_vice_principal',
        branchId: t.north,
      });
      await t.kit.giveRole(both.account.id, { role: 'principal', branchId: t.south });
      const north = studentListSchema.parse(
        (await t.get('/api/people/students', t.north, both.cookie)).body,
      );
      expect(north).toMatchObject({ readsFinancial: false, exportGroups: [] });
      expect(north.students.every((item) => item.consentMissing === null)).toBe(true);
      const refused = await t.get('/api/people/students?consent=missing', t.north, both.cookie);
      expect(refused.status).toBe(403);
      const south = await t.get('/api/people/students?consent=missing', t.south, both.cookie);
      expect(south.status, JSON.stringify(south.body)).toBe(200);
      const answer = studentListSchema.parse(south.body);
      expect(answer).toMatchObject({
        readsFinancial: true,
        exportGroups: ['basic', 'financial', 'diagnostic'],
      });
      expect(answer.students.length).toBeGreaterThan(0);
      expect(answer.students.every((item) => item.consentMissing === true)).toBe(true);
    });

    // Correction 1 of the review: the filter is checked on the server.
    it('refuses the consent list to every reader without the Financial group', async () => {
      for (const cookie of [spiritual, tutor, headTeacher, seniorHeadTeacher]) {
        const response = await t.get('/api/people/students?consent=missing', t.north, cookie);
        expect(response.status, cookie).toBe(403);
        expect(errorCode(response)).toBe('permission_denied');
      }
      const unknown = await t.get('/api/people/students?consent=signed', t.north, t.admin);
      expect(unknown.status).toBe(400);
    });
  });

  describe('the "No class" counter', () => {
    it('counts the students active today with no class, before the start date included', async () => {
      const count = async (cookie = t.vicePrincipal) => {
        const response = await t.get('/api/people/students/no-class', t.north, cookie);
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        return studentNoClassSchema.parse(response.body).count;
      };
      const before = await count();
      // Task 3.1b: a class in force or planned takes a student out of the count.
      await create();
      await create({ startsOn: '2026-11-02' });
      // Before the start date, with no class: counted (edge: "An active student
      // with no class is allowed only before their start date").
      await create({ startsOn: '2026-11-02', classId: null });
      await create({ startsOn: '2026-11-03', classId: null });
      await leave(await create(), '2026-10-01');
      await leave(await create(), '2026-10-25');
      // A graduated student, written by the migrator: no route graduates before task 9.5a.
      const graduated = await create();
      await t.database.migrator
        .deleteFrom('class_memberships')
        .where('student_id', '=', graduated.id)
        .execute();
      await t.database.migrator
        .updateTable('student_statuses')
        .set({ valid_until: '2026-10-01' })
        .where('student_id', '=', graduated.id)
        .execute();
      await t.database.migrator
        .insertInto('student_statuses')
        .values({
          student_id: graduated.id,
          branch_id: t.north,
          status: 'graduated',
          valid_from: '2026-10-01',
          cause: 'graduation',
        })
        .execute();
      // The last day is today: inactive from tomorrow.
      await leave(await create(), '2026-10-10');
      await create({ startsOn: '2026-11-02', classId: null }, t.south);
      expect(await count()).toBe(before + 2);
      expect(await count(t.principal)).toBe(before + 2);

      // Past midnight in Tashkent (five minutes on, so no session goes idle).
      t.clock.set(new Date('2026-10-11T00:00:30+05:00'));
      try {
        expect(await count()).toBe(before + 2);
      } finally {
        t.clock.set(new Date('2026-10-10T23:55:00+05:00'));
      }
    });

    it('is refused to a role that reads no student', async () => {
      for (const cookie of [t.teacher, nurse]) {
        const response = await t.get('/api/people/students/no-class', t.north, cookie);
        expect(response.status).toBe(403);
      }
    });
  });

  describe('the export', () => {
    const ALL = [
      'uid',
      'name',
      'class',
      'status',
      'paternalName',
      'sex',
      'grade',
      'startsOn',
      'phone',
      'email',
      'birthDate',
      'documentType',
      'documentNumber',
      'jshshir',
      'address',
      'region',
      'contractNumber',
      'contractSignedOn',
      'scholarshipType',
      'scholarshipCoverage',
      'scholarshipAmount',
      'previousSchool',
      'diagnosticScore',
      'consentSignedOn',
    ];

    it('writes every group for the Super Admin and the Academic Vice Principal, and logs it', async () => {
      await speak('en');
      const student = await create();
      for (const [cookie, assignment] of [
        [t.admin, t.adminAssignment],
        [t.vicePrincipal, t.viceAssignment],
      ] as const) {
        const response = await exportOf(
          send([student.id], ALL, { search: 'Rasul', filters: { status: 'active' } }),
          cookie,
        );
        expect(response.status).toBe(200);
        const file = await fileOf(response);
        expect(file.type).toContain('spreadsheetml');
        expect(file.cacheControl).toBe('no-store');
        expect(file.columns).toBe(ALL.join(','));
        expect(file.sheet.name).toBe('Students');
        expect(file.sheet.headings).toEqual([
          'UID',
          'Surname and name',
          'Class',
          'Status',
          'Planned status',
          'Planned from',
          'Paternal name',
          'Sex',
          'Grade',
          'Start date',
          'Phone',
          'Email',
          'Date of birth',
          'Document',
          'Document number',
          'JSHSHIR',
          'Address',
          'Region',
          'Contract number',
          'Contract date',
          'Scholarship',
          'Coverage',
          'Amount in soʻm',
          'Previous school',
          'Diagnostic test score',
          'Consent signed on',
        ]);
        const [row] = file.sheet.rows;
        const cells = row ?? [];
        expect(cells.slice(0, 4)).toEqual([
          student.uid,
          // Surname first (owner's answer to finding 27).
          `${student.lastName} Oʻtkir`,
          // Task 3.1b: the class of the membership, "7 Oxford".
          `7 ${String(student.class?.name)}`,
          'Active',
        ]);
        expect(cells.slice(4, 6)).toEqual([null, null]);
        expect(cells.slice(6, 9)).toEqual(['Anvarovich', 'Male', 7]);
        expect(dateOfCell(cells[9])).toBe('2026-09-02');
        // The phone grouped (finding 24).
        expect(cells.slice(10, 12)).toEqual([
          grouped(student.contact?.phone),
          student.contact?.email,
        ]);
        expect(dateOfCell(cells[12])).toBe(student.identity?.birthDate);
        expect(cells.slice(13, 18)).toEqual([
          'Birth certificate',
          student.identity?.documentNumber,
          student.identity?.jshshir,
          'Bunyodkor koʻchasi 7',
          'Samarkand Region',
        ]);
        expect(cells[18]).toBe(student.financial?.contracts[0]?.number);
        expect(dateOfCell(cells[19])).toBe('2026-08-21');
        expect(cells.slice(20, 25)).toEqual(['Financial aid', 'Partial', 750000, '41-maktab', 81]);
        expect(dateOfCell(cells[25])).toBe('2026-08-21');
        expect((await t.entries('student.export')).at(-1)).toMatchObject({
          branch_id: t.north,
          assignment_id: assignment,
          details: {
            list: 'students',
            selection: 'ticked',
            search: 'Rasul',
            filters: { status: 'active' },
            columns: ALL,
            leftOut: [],
            rows: 1,
          },
        });
      }
    });

    // `edge`: "Exports are allowed, without identity documents"; decision 3:
    // no Contact or Identity for the Principal, on ticked rows too.
    it('leaves Contact and Identity out of the Principal’s file and names them', async () => {
      await speak('en');
      const student = await create();
      const file = await fileOf(
        await exportOf(
          send([student.id], ['uid', 'phone', 'jshshir', 'contractNumber', 'consentSignedOn']),
          t.principal,
        ),
      );
      expect(file.columns).toBe('uid,contractNumber,consentSignedOn');
      expect(file.sheet.headings).toEqual(['UID', 'Contract number', 'Consent signed on']);
      expect(file.sheet.rows[0]?.slice(0, 2)).toEqual([
        student.uid,
        student.financial?.contracts[0]?.number,
      ]);
      expect((await t.entries('student.export')).at(-1)).toMatchObject({
        assignment_id: principalAssignment,
        details: {
          columns: ['uid', 'contractNumber', 'consentSignedOn'],
          leftOut: ['phone', 'jshshir'],
          rows: 1,
        },
      });

      const before = await snapshot();
      refusedWith(
        await exportOf(send([student.id], ['phone', 'email', 'birthDate']), t.principal),
        403,
        'permission_denied',
      );
      expect(await snapshot()).toEqual(before);
    });

    // Correction 3: decided from every current assignment that counts in the
    // branch of the request; the entry names the one that allowed it.
    it('decides Contact and Identity in the branch of the request and names the assignment', async () => {
      await speak('en');
      const north = await create();
      const south = await create({}, t.south);
      const both = await t.kit.completeSession('Zarina', 'Sobirova');
      const principalHeld = await t.kit.giveRole(both.account.id, {
        role: 'principal',
        branchId: t.north,
      });
      const viceHeld = await t.kit.giveRole(both.account.id, {
        role: 'academic_vice_principal',
        branchId: t.south,
      });
      const inNorth = await fileOf(
        await exportOf(send([north.id], ['uid', 'phone', 'jshshir']), both.cookie),
      );
      expect(inNorth.columns).toBe('uid');
      expect((await t.entries('student.export')).at(-1)).toMatchObject({
        branch_id: t.north,
        assignment_id: principalHeld.id,
        details: { columns: ['uid'], leftOut: ['phone', 'jshshir'] },
      });
      const inSouth = await fileOf(
        await exportOf(send([south.id], ['uid', 'phone', 'jshshir']), both.cookie, t.south),
      );
      expect(inSouth.columns).toBe('uid,phone,jshshir');
      expect(inSouth.sheet.rows).toEqual([
        [south.uid, grouped(south.contact?.phone), south.identity?.jshshir],
      ]);
      expect((await t.entries('student.export')).at(-1)).toMatchObject({
        branch_id: t.south,
        assignment_id: viceHeld.id,
        details: { columns: ['uid', 'phone', 'jshshir'], leftOut: [] },
      });
    });

    // Task 3.6a, owner's answer L59 (decision 9 of pull request #118): the
    // Head Tutor exports every group of the branch's students.
    it('writes every group of the whole branch for the Head Tutor', async () => {
      await speak('en');
      const student = await create();
      const columns = ['uid', 'phone', 'jshshir', 'contractNumber', 'diagnosticScore'];
      const file = await fileOf(await exportOf(send([student.id], columns), headTutor));
      expect(file.columns).toBe(columns.join(','));
      expect(file.sheet.rows).toEqual([
        [
          student.uid,
          grouped(student.contact?.phone),
          student.identity?.jshshir,
          student.financial?.contracts[0]?.number,
          81,
        ],
      ]);
      expect((await t.entries('student.export')).at(-1)).toMatchObject({
        details: { columns, leftOut: [], rows: 1 },
      });
    });

    // L59: "Head Teachers export the Basic fields", never the diagnostic score
    // they read (L50; decision 9 of pull request #118), the whole branch list.
    it('writes Basic columns only for the Head Teachers, without the score, whole branch', async () => {
      await speak('en');
      const student = await create();
      for (const cookie of [headTeacher, seniorHeadTeacher]) {
        const response = await exportOf(
          send([student.id], ['uid', 'name', 'phone', 'diagnosticScore', 'contractNumber']),
          cookie,
        );
        expect(response.headers['x-export-rows-left-out']).toBeUndefined();
        const file = await fileOf(response);
        expect(file.columns).toBe('uid,name');
        expect(file.sheet.headings).not.toContain('Diagnostic test score');
        expect((await t.entries('student.export')).at(-1)).toMatchObject({
          details: { leftOut: ['phone', 'diagnosticScore', 'contractNumber'], rows: 1 },
        });
        const before = await snapshot();
        refusedWith(
          await exportOf(send([student.id], ['diagnosticScore']), cookie),
          403,
          'permission_denied',
        );
        expect(await snapshot()).toEqual(before);
      }
    });

    it('is refused to every role without the export, with nothing logged', async () => {
      const student = await create();
      const before = await snapshot();
      // Task 3.6a (L59): the Head Tutor and the Head Teachers export now; a
      // Tutor of no class has no row of own class.
      for (const cookie of [spiritual, tutor, t.teacher, nurse]) {
        refusedWith(await exportOf(send([student.id], ['uid']), cookie), 403, 'permission_denied');
      }
      expect(await snapshot()).toEqual(before);
    });

    it('answers 404 for a student of another branch and an unknown id, with nothing logged', async () => {
      const here = await create();
      const there = await create({}, t.south);
      const before = await snapshot();
      for (const id of [there.id, UNKNOWN]) {
        refusedWith(await exportOf(send([here.id, id], ['uid'])), 404, 'not_found');
        refusedWith(await exportOf(send([id], ['uid']), t.principal), 404, 'not_found');
      }
      expect(await snapshot()).toEqual(before);
    });

    it('writes the rows in the order sent, a planned leaving with its first day, and the newest contract', async () => {
      await speak('en');
      const first = await create();
      const scheduled = await leave(await create(), '2026-10-20');
      const back = await leave(await create(), '2026-10-01');
      const returned = await t.post(`/api/people/students/${back.id}/return`, t.north, {
        from: '2026-10-05',
        grade: 8,
        // Task 3.3b: a return names its class.
        classId: await t.classOf(t.north, 8, '2026-10-05'),
        contract: { number: 'EX-RETURN/1', signedOn: '2026-10-05' },
        reason: null,
        version: back.version,
      });
      expect(returned.status, JSON.stringify(returned.body)).toBe(200);
      const file = await fileOf(
        await exportOf(
          send([scheduled.id, back.id, first.id], ['uid', 'status', 'grade', 'contractNumber'], {
            selection: 'matching',
          }),
        ),
      );
      expect(file.sheet.rows.map((row) => row[0])).toEqual([scheduled.uid, back.uid, first.uid]);
      const [leaving, again] = file.sheet.rows;
      expect(leaving?.slice(1, 3)).toEqual(['Active', 'Inactive']);
      expect(dateOfCell(leaving?.[3])).toBe('2026-10-21');
      expect(again?.slice(1, 6)).toEqual(['Active', null, null, 8, 'EX-RETURN/1']);
    });

    // Issue #105, H13: before the start date an active student reads
    // "From <date>" in the file as on the screen; "Active" from that day. The
    // clock stands on 10 October: one student starts tomorrow, one today.
    it('writes "From <date>" before the start date and "Active" on it', async () => {
      await speak('en');
      const tomorrow = await create({ startsOn: '2026-10-11', classId: null });
      const today = await create({ startsOn: '2026-10-10' });
      const file = await fileOf(await exportOf(send([tomorrow.id, today.id], ['status'])));
      expect(file.sheet.rows.map((row) => row[0])).toEqual(['From 11.10.2026', 'Active']);
    });

    it('writes the file in the language of the account', async () => {
      await speak('ru');
      try {
        const student = await create({ consentSignedOn: null });
        const file = await fileOf(
          await exportOf(
            send([student.id], ['class', 'status', 'sex', 'region', 'scholarshipType']),
          ),
        );
        expect(file.sheet.name).toBe('Ученики');
        expect(file.sheet.headings.slice(0, 2)).toEqual(['Класс', 'Статус']);
        expect(file.sheet.rows[0]).toEqual([
          `7 ${String(student.class?.name)}`,
          'Учится',
          null,
          null,
          'Мужской',
          'Самаркандская область',
          'Материальная помощь',
        ]);
      } finally {
        await speak('en');
      }
    });

    // Task 2.5b-2, decision 1 (Look first): the relatives in the Contact group.
    describe('the relatives (task 2.5b-2)', () => {
      const RELATIVE_COLUMNS = [
        'mainContactName',
        'mainContactRelationship',
        'mainContactPhone',
        'mainContactExtraPhones',
        'otherRelatives',
      ];
      let phones = 0;

      /** A new invented phone of the people shape, never used before in this file. */
      const phone = () => {
        phones += 1;
        return `+99895${String(4000000 + phones)}`;
      };

      const relative = (
        fullName: string,
        relationship: string,
        number: string | null,
        extraPhones: string[] = [],
        mainContact = false,
      ) => ({
        kind: 'new',
        relative: { fullName, phone: number, workplace: '', email: '', extraPhones },
        relationship,
        mainContact,
        portalAccess: true,
        receivesNotices: true,
      });

      const relativeIdOf = async (student: string, fullName: string) =>
        (
          await t.database.migrator
            .selectFrom('student_relatives as l')
            .innerJoin('relatives as r', 'r.id', 'l.relative_id')
            .select('r.id')
            .where('l.student_id', '=', student)
            .where('r.full_name', '=', fullName)
            .executeTakeFirstOrThrow()
        ).id;

      it('writes the main contact and the other relatives for the Super Admin and the Academic Vice Principal', async () => {
        await speak('en');
        const mainPhone = phone();
        const mainExtra = [phone(), phone()];
        const brotherPhone = phone();
        const brotherExtra = phone();
        const auntExtra = phone();
        const full = await create({
          relatives: [
            relative('Nargiza Tursunova', 'mother', mainPhone, mainExtra, true),
            relative('Zafar Tursunov', 'father', null),
            relative('Bobur Tursunov', 'brother', brotherPhone, [brotherExtra]),
            relative('Kamol Tursunov', 'uncle', phone()),
          ],
        });
        // Unlinked: never in the file.
        const uncle = await relativeIdOf(full.id, 'Kamol Tursunov');
        const unlinked = await t.post(
          `/api/people/students/${full.id}/relatives/${uncle}/unlink`,
          t.north,
          { newMainContactId: null },
        );
        expect(unlinked.status, JSON.stringify(unlinked.body)).toBe(200);
        // Linked last: the last line.
        const added = await t.post(
          `/api/people/students/${full.id}/relatives`,
          t.north,
          relative('Aziza Tursunova', 'aunt', null, [auntExtra]),
        );
        expect(added.status, JSON.stringify(added.body)).toBeLessThan(300);
        // A main contact with no phone of their own, and no other relative.
        const bare = await create({
          relatives: [relative('Laylo Qosimova', 'grandmother', null, [], true)],
        });
        // A student of another branch: their relative is never in the north's file.
        await create(
          {
            relatives: [
              relative('Sherzod Olimov', 'father', phone(), [phone()], true),
              relative('Gavhar Olimova', 'mother', phone()),
            ],
          },
          t.south,
        );

        for (const [cookie, assignment] of [
          [t.admin, t.adminAssignment],
          [t.vicePrincipal, t.viceAssignment],
        ] as const) {
          const file = await fileOf(
            await exportOf(send([full.id, bare.id], ['uid', ...RELATIVE_COLUMNS]), cookie),
          );
          expect(file.columns).toBe(['uid', ...RELATIVE_COLUMNS].join(','));
          expect(file.sheet.headings).toEqual([
            'UID',
            'Main contact',
            'Main contact: relationship',
            'Main contact: phone',
            'Main contact: extra phones',
            'Other relatives',
          ]);
          expect(file.sheet.rows).toEqual([
            [
              full.uid,
              'Nargiza Tursunova',
              'Mother',
              grouped(mainPhone),
              mainExtra.map(grouped).join(', '),
              [
                'Zafar Tursunov (Father)',
                `Bobur Tursunov (Brother): ${grouped(brotherPhone)}, ${grouped(brotherExtra)}`,
                `Aziza Tursunova (Aunt): ${grouped(auntExtra)}`,
              ].join('\n'),
            ],
            [bare.uid, 'Laylo Qosimova', 'Grandmother', null, null, null],
          ]);
          const text = JSON.stringify(file.sheet.rows);
          for (const absent of ['Kamol', 'Sherzod', 'Gavhar']) {
            expect(text, absent).not.toContain(absent);
          }
          expect((await t.entries('student.export')).at(-1)).toMatchObject({
            branch_id: t.north,
            assignment_id: assignment,
            details: { columns: ['uid', ...RELATIVE_COLUMNS], leftOut: [], rows: 2 },
          });
        }
      });

      it('leaves the relatives out of the Principal’s file and names them', async () => {
        await speak('en');
        const student = await create({
          relatives: [relative('Dilnoza Ahmedova', 'mother', phone(), [phone()], true)],
        });
        const file = await fileOf(
          await exportOf(send([student.id], ['uid', ...RELATIVE_COLUMNS]), t.principal),
        );
        expect(file.columns).toBe('uid');
        expect(file.sheet.headings).toEqual(['UID']);
        expect(file.sheet.rows).toEqual([[student.uid]]);
        expect((await t.entries('student.export')).at(-1)).toMatchObject({
          assignment_id: principalAssignment,
          details: { columns: ['uid'], leftOut: RELATIVE_COLUMNS, rows: 1 },
        });
      });
    });

    // Answer 23: the consent list is exported by its readers, and the filter is logged.
    it('logs the consent filter of an export from the consent list', async () => {
      const student = await create({ consentSignedOn: null });
      const response = await exportOf(
        send([student.id], ['uid'], { selection: 'matching', filters: { consent: 'missing' } }),
        t.principal,
      );
      expect(response.status).toBe(200);
      expect((await t.entries('student.export')).at(-1)).toMatchObject({
        details: { filters: { consent: 'missing' }, rows: 1 },
      });
    });
  });
});
