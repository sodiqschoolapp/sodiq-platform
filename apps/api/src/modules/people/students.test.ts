import {
  apiErrorSchema,
  studentCheckResultSchema,
  studentDetailSchema,
  studentIdentitySchema,
  studentListSchema,
  studentNameKey,
  type StudentDetail,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const MOMENT = new Date('2026-10-10T23:55:00+05:00');

// All names are invented. docs/spec/04-people.md, Student record, UID sets;
// docs/spec/edge-cases/students-classes-groups.md; docs/spec/edge-cases/
// people-roles-accounts.md (Personal data and the audit log); the plan
// approved on pull request #67 with its corrections. The clock stands at
// 23:55 on 10 October 2026 in Tashkent; north has the years 2026–2027 and
// 2027–2028, south the year 2026–2027, all planned (a year of any status
// gives the set, correction 2).
describe('student records', () => {
  let t: DayTemplatesKit;
  let spiritual: string;
  let headTutor: string;
  let tutor: string;
  let headTeacher: string;
  let seniorHeadTeacher: string;
  let principalAssignment: string;
  let count = 0;

  /** A new student's body with a UID, a contract and a name of its own. */
  function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    count += 1;
    return {
      uid: String(2607000 + count),
      confirmUidSet: false,
      firstName: 'Oʻtkir',
      lastName: `Saidov${'a'.repeat(count % 7)}`,
      paternalName: 'Anvarovich',
      sex: 'male',
      birthDate: `2014-03-${String((count % 28) + 1).padStart(2, '0')}`,
      grade: 7,
      startsOn: '2026-09-02',
      documentType: 'birth_certificate',
      documentNumber: `I-TN${String(1000000 + count)}`,
      jshshir: String(31403140000000 + count),
      phone: `+99890${String(2000000 + count)}`,
      email: `student${String(count)}@example.com`,
      address: 'Navoiy koʻchasi 5',
      region: 'tashkent_city',
      previousSchool: '12-maktab',
      diagnosticScore: 74,
      scholarship: { type: 'merit', coverage: 'partial', amount: 1500000 },
      consentSignedOn: '2026-08-20',
      contract: { number: `SQ-2026/${String(count)}`, signedOn: '2026-08-20' },
      ...overrides,
    };
  }

  /** What an edit sends: the record of the answer of a Super Admin. */
  const editBody = (student: StudentDetail, overrides: Record<string, unknown> = {}) => {
    if (student.identity === null || student.contact === null || student.financial === null) {
      throw new Error('An edit body is made from the answer of a reader of every group.');
    }
    const contract = student.financial.contracts[0];
    if (contract === undefined) {
      throw new Error('A student has a contract.');
    }
    return {
      firstName: student.firstName,
      lastName: student.lastName,
      paternalName: student.paternalName ?? '',
      sex: student.sex,
      birthDate: student.identity.birthDate,
      grade: student.grade,
      documentType: student.identity.documentType,
      documentNumber: student.identity.documentNumber ?? '',
      jshshir: student.identity.jshshir ?? '',
      phone: student.contact.phone ?? '',
      email: student.contact.email ?? '',
      address: student.identity.address ?? '',
      region: student.identity.region,
      previousSchool: student.financial.previousSchool ?? '',
      diagnosticScore: student.financial.diagnosticScore,
      scholarship: student.financial.scholarship,
      consentSignedOn: student.financial.consentSignedOn,
      contract: { number: contract.number, signedOn: contract.signedOn },
      ...overrides,
    };
  };

  async function create(
    overrides: Record<string, unknown> = {},
    branch = '',
    cookie?: string,
  ): Promise<StudentDetail> {
    const response = await t.post(
      '/api/people/students',
      branch || t.north,
      body(overrides),
      cookie,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body);
  }

  const detail = async (id: string, cookie = t.admin, branch = '') => {
    const response = await t.get(`/api/people/students/${id}`, branch || t.north, cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return studentDetailSchema.parse(response.body);
  };

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  const detailsOf = (response: Response) => apiErrorSchema.parse(response.body).error.details ?? [];

  /** Every row of the student tables and the audit count: what a refused change leaves as it was. */
  async function snapshot(): Promise<Record<string, unknown>> {
    const rows: Record<string, unknown> = { audit: await t.auditCount() };
    for (const table of [
      'students',
      'student_uids',
      'student_contracts',
      'student_statuses',
      'student_accounts',
    ] as const) {
      rows[table] = await sql`select * from ${sql.table(table)} order by 1, 2`.execute(
        t.database.migrator,
      );
    }
    return rows;
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

  async function signedIn(first: string, last: string, role: string, branchId: string | null) {
    const browser = await t.kit.fullSession(first, last);
    await t.kit.giveRole(browser.account.id, {
      role: role as never,
      ...(branchId === null ? {} : { branchId }),
    });
    return browser.cookie;
  }

  beforeAll(async () => {
    t = await dayTemplatesKit();
    for (const [branch, start, end] of [
      [t.north, '2026-09-01', '2027-05-31'],
      [t.north, '2027-09-01', '2028-05-31'],
      [t.south, '2026-09-01', '2027-05-31'],
    ] as const) {
      // A year is written with its four quarters, undated (db/migrations/0016).
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

  describe('create', () => {
    it('writes the record, its reserved UID, contract, first status and switched-off account', async () => {
      const input = body();
      const response = await t.post('/api/people/students', t.north, input, t.vicePrincipal);
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const student = studentDetailSchema.parse(response.body);
      expect(student).toMatchObject({
        uid: input.uid,
        firstName: 'Oʻtkir',
        grade: 7,
        startsOn: '2026-09-02',
        status: 'active',
        statuses: [
          { status: 'active', from: '2026-09-02', until: null, cause: 'start', reason: null },
        ],
        canEdit: true,
      });
      const uid = await t.database.migrator
        .selectFrom('student_uids')
        .selectAll()
        .where('student_id', '=', student.id)
        .execute();
      expect(uid).toEqual([
        {
          uid: input.uid,
          student_id: student.id,
          branch_id: t.north,
          held_from: MOMENT,
          released_at: null,
        },
      ]);
      const account = await t.database.migrator
        .selectFrom('student_accounts')
        .selectAll()
        .where('student_id', '=', student.id)
        .executeTakeFirstOrThrow();
      expect(account).toMatchObject({ created_at: MOMENT, switched_on_at: null });
      const stored = await t.database.migrator
        .selectFrom('students')
        .select(['name_key', 'created_by'])
        .where('id', '=', student.id)
        .executeTakeFirstOrThrow();
      expect(stored.name_key).toBe(studentNameKey(student.lastName, 'Otkir'));
      const [entry] = await t.entries('student.create', student.id);
      expect(entry).toMatchObject({
        branch_id: t.north,
        assignment_id: t.viceAssignment,
        request_id: response.headers['x-request-id'],
      });
      expect((entry?.new_value as Record<string, unknown>).uid).toBe(input.uid);
    });

    it('stores a student with only the required fields', async () => {
      const student = await create({
        paternalName: '',
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
      });
      const read = await detail(student.id);
      expect(read.identity).toMatchObject({ documentType: null, jshshir: null, address: null });
      expect(read.financial?.scholarship).toEqual({ type: 'none', coverage: null, amount: null });
    });

    it('shows a student whose start date is after today as active (edge: enrolled in August)', async () => {
      const student = await create({ startsOn: '2026-11-02' });
      expect(student.status).toBe('active');
      const list = studentListSchema.parse((await t.get('/api/people/students', t.north)).body);
      expect(list.students.find((row) => row.id === student.id)?.status).toBe('active');
    });
  });

  describe('the UID set (04, UID sets; decision 5 as changed by correction 2)', () => {
    it('refuses a UID outside the set of the grade until it is confirmed', async () => {
      const before = await snapshot();
      const input = body({ uid: '2606901', grade: 7 });
      refusedWith(await t.post('/api/people/students', t.north, input), 409, 'uid_set_mismatch');
      expect(await snapshot()).toEqual(before);
      const response = await t.post('/api/people/students', t.north, {
        ...input,
        confirmUidSet: true,
      });
      expect(response.status).toBe(201);
    });

    it('takes the set of a planned year, and of the year after a start date in the summer', async () => {
      // 2027–2028: the set 2607 is grade 8, and grade 1 opens 2701.
      await create({ uid: '2607901', grade: 8, startsOn: '2027-09-02' });
      await create({ uid: '2701901', grade: 1, startsOn: '2027-07-01' });
      refusedWith(
        await t.post(
          '/api/people/students',
          t.north,
          body({ uid: '2607902', grade: 7, startsOn: '2027-07-01' }),
        ),
        409,
        'uid_set_mismatch',
      );
    });

    it('refuses a start date in no year of the branch and before none', async () => {
      refusedWith(
        await t.post('/api/people/students', t.south, body({ startsOn: '2027-07-01' })),
        409,
        'no_academic_year',
      );
    });
  });

  describe('values taken across the school', () => {
    it('refuses a UID of this branch and names its holder', async () => {
      const holder = await create();
      const before = await snapshot();
      const response = await t.post('/api/people/students', t.north, body({ uid: holder.uid }));
      refusedWith(response, 409, 'student_value_taken');
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({ path: 'uid', code: 'already_exists', recordId: holder.id }),
      ]);
      expect(await snapshot()).toEqual(before);
    });

    it.each([
      ['uid', (holder: Record<string, unknown>) => ({ uid: holder.uid })],
      ['jshshir', (holder: Record<string, unknown>) => ({ jshshir: holder.jshshir })],
      [
        'documentNumber',
        (holder: Record<string, unknown>) => ({
          documentType: 'passport',
          documentNumber: holder.documentNumber,
        }),
      ],
      [
        'contract.number',
        (holder: Record<string, unknown>) => ({
          contract: {
            number: String((holder.contract as { number: string }).number).toLowerCase(),
            signedOn: '2026-08-21',
          },
        }),
      ],
    ])('refuses a %s held in another branch without naming the holder', async (path, of) => {
      const held = body();
      expect((await t.post('/api/people/students', t.south, held)).status).toBe(201);
      const before = await snapshot();
      const response = await t.post('/api/people/students', t.north, body(of(held)));
      refusedWith(response, 409, 'student_value_taken');
      const details = detailsOf(response);
      expect(details).toEqual([
        { path, code: 'held_elsewhere', message: 'A student of another branch holds it.' },
      ]);
      expect(JSON.stringify(response.body)).not.toContain(String(held.lastName));
      expect(await snapshot()).toEqual(before);
    });

    it('refuses a JSHSHIR, document or contract of this branch with the holder', async () => {
      const held = body();
      const holder = studentDetailSchema.parse(
        (await t.post('/api/people/students', t.north, held)).body,
      );
      for (const [path, overrides] of [
        ['jshshir', { jshshir: held.jshshir }],
        ['documentNumber', { documentNumber: held.documentNumber }],
        ['contract.number', { contract: held.contract }],
      ] as const) {
        const response = await t.post('/api/people/students', t.north, body(overrides));
        refusedWith(response, 409, 'student_value_taken');
        expect(detailsOf(response), path).toEqual([
          expect.objectContaining({ path, recordId: holder.id }),
        ]);
      }
    });
  });

  describe('at the same moment (edge: "the second is refused")', () => {
    /** Runs `work` in a transaction of the application that stays open until released. */
    async function holdOpen(branch: string, work: (transaction: Transaction) => Promise<void>) {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const done = t.app.get(Transactions).run([branch], async (transaction) => {
        await work(transaction);
        ready();
        await released;
      });
      await Promise.race([isReady, done]);
      return { release, done };
    }

    /** The writes of a create of the service, with the values given. */
    async function writeStudent(
      transaction: Transaction,
      branch: string,
      values: { uid: string; jshshir?: string; contract?: string },
    ): Promise<void> {
      const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
      const id = found.rows[0]?.id ?? '';
      const admin = await transaction
        .selectFrom('accounts')
        .select('id')
        .orderBy('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('students')
        .values({
          id,
          branch_id: branch,
          uid: values.uid,
          first_name: 'Ziyoda',
          last_name: 'Holmatova',
          name_key: studentNameKey('Holmatova', 'Ziyoda'),
          sex: 'female',
          birth_date: '2013-05-05',
          grade: 7,
          starts_on: '2026-09-02',
          jshshir: values.jshshir ?? null,
          created_by: admin.id,
        })
        .execute();
      await transaction
        .insertInto('student_uids')
        .values({ uid: values.uid, student_id: id, branch_id: branch, held_from: MOMENT })
        .execute();
      await transaction
        .insertInto('student_contracts')
        .values({
          student_id: id,
          branch_id: branch,
          number: values.contract ?? `RACE-${values.uid}`,
          signed_on: '2026-08-20',
        })
        .execute();
    }

    it.each([
      ['uid', 'south'],
      ['jshshir', 'south'],
      ['contract.number', 'north'],
    ] as const)(
      'answers 409 to the save that waited for another with the same %s',
      async (path, other) => {
        const input = body();
        const branch = other === 'south' ? t.south : t.north;
        const held = await holdOpen(branch, (transaction) =>
          writeStudent(transaction, branch, {
            uid: path === 'uid' ? String(input.uid) : String(2600000 + count + 500),
            ...(path === 'jshshir' ? { jshshir: String(input.jshshir) } : {}),
            ...(path === 'contract.number'
              ? { contract: (input.contract as { number: string }).number }
              : {}),
          }),
        );
        const save = t.post('/api/people/students', t.north, input).then((response) => response);
        await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
        held.release();
        await held.done;
        const response = await save;
        refusedWith(response, 409, 'student_value_taken');
        expect(detailsOf(response)[0]?.path).toBe(path);
      },
    );

    it('answers 409 to a create that waited for a UID correction to the same UID', async () => {
      const other = studentDetailSchema.parse(
        (await t.post('/api/people/students', t.south, body())).body,
      );
      const input = body();
      const uid = String(input.uid);
      // What the correction does, in its order: the current UID, then its reservation.
      const held = await holdOpen(t.south, async (transaction) => {
        await transaction.updateTable('students').set({ uid }).where('id', '=', other.id).execute();
        await transaction
          .insertInto('student_uids')
          .values({ uid, student_id: other.id, branch_id: t.south, held_from: MOMENT })
          .execute();
      });
      const save = t.post('/api/people/students', t.north, input).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      const response = await save;
      refusedWith(response, 409, 'student_value_taken');
      expect(detailsOf(response)[0]).toMatchObject({ path: 'uid', code: 'held_elsewhere' });
    });

    it('answers 409 to a UID correction that waited for a create of the same UID', async () => {
      const student = await create();
      const uid = String(2607000 + count + 700);
      const held = await holdOpen(t.south, (transaction) =>
        writeStudent(transaction, t.south, { uid }),
      );
      const correction = t
        .put(`/api/people/students/${student.id}/uid`, t.north, {
          uid,
          reason: 'Typed wrongly at enrolment.',
          confirmUidSet: false,
        })
        .then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      const response = await correction;
      refusedWith(response, 409, 'student_value_taken');
      expect(detailsOf(response)[0]).toMatchObject({ path: 'uid', code: 'held_elsewhere' });
      expect((await detail(student.id)).uid).toBe(student.uid);
    });
  });

  describe('the duplicate warning (edge: a matching name and date of birth)', () => {
    it('answers 404 for a record of another branch or an unknown one in the body', async () => {
      const south = studentDetailSchema.parse(
        (await t.post('/api/people/students', t.south, body())).body,
      );
      for (const studentId of [south.id, UNKNOWN]) {
        refusedWith(
          await t.post('/api/people/students/check', t.north, {
            firstName: 'Ali',
            lastName: 'Valiyev',
            birthDate: '2014-01-01',
            studentId,
          }),
          404,
          'not_found',
        );
      }
    });

    it('finds a look-alike spelling here and says only whether one exists elsewhere', async () => {
      const here = await create({
        firstName: 'Ўткир',
        lastName: 'Раҳимов',
        birthDate: '2014-06-06',
      });
      expect(
        (
          await t.post(
            '/api/people/students',
            t.south,
            body({ firstName: 'Otkir', lastName: 'Rahimov', birthDate: '2014-06-07' }),
          )
        ).status,
      ).toBe(201);
      const check = async (birthDate: string, studentId: string | null = null) =>
        studentCheckResultSchema.parse(
          (
            await t.post('/api/people/students/check', t.north, {
              firstName: "O'tkir",
              lastName: 'Rahimov',
              birthDate,
              studentId,
            })
          ).body,
        );
      expect(await check('2014-06-06')).toEqual({
        sameNameAndBirth: [
          {
            id: here.id,
            uid: here.uid,
            firstName: 'Ўткир',
            lastName: 'Раҳимов',
            status: 'active',
          },
        ],
        elsewhere: false,
      });
      expect(await check('2014-06-07')).toEqual({ sameNameAndBirth: [], elsewhere: true });
      expect(await check('2014-06-06', here.id)).toEqual({
        sameNameAndBirth: [],
        elsewhere: false,
      });
    });

    it('lets twins pass: the same surname and birth date with another first name', async () => {
      await create({ firstName: 'Hasan', lastName: 'Egizakov', birthDate: '2015-01-01' });
      const result = studentCheckResultSchema.parse(
        (
          await t.post('/api/people/students/check', t.north, {
            firstName: 'Husan',
            lastName: 'Egizakov',
            birthDate: '2015-01-01',
            studentId: null,
          })
        ).body,
      );
      expect(result.sameNameAndBirth).toEqual([]);
      await create({ firstName: 'Husan', lastName: 'Egizakov', birthDate: '2015-01-01' });
    });
  });

  describe('readers (edge: Personal data and the audit log; decisions 2 and 4)', () => {
    let student: StudentDetail;

    beforeAll(async () => {
      student = await create();
    });

    it('answers every group to the Super Admin and the Academic Vice Principal', async () => {
      for (const cookie of [t.admin, t.vicePrincipal]) {
        const read = await detail(student.id, cookie);
        expect(read.contact).not.toBeNull();
        expect(read.identity).not.toBeNull();
        expect(read.financial).not.toBeNull();
        expect(read.identityHidden).toBe(false);
        expect(read.canEdit).toBe(true);
      }
    });

    it('hides the identity from the Principal, with a show', async () => {
      const read = await detail(student.id, t.principal);
      expect(read.identity).toBeNull();
      expect(read.identityHidden).toBe(true);
      expect(read.contact).not.toBeNull();
      expect(read.financial).not.toBeNull();
      expect(read.canEdit).toBe(false);
      expect(JSON.stringify(read)).not.toContain(student.identity?.birthDate ?? 'missing');
      expect(JSON.stringify(read)).not.toContain(student.identity?.jshshir ?? 'missing');
    });

    it('answers Basic and Contact to the Spiritual VP and the Head Tutor, no birth date or address', async () => {
      for (const cookie of [spiritual, headTutor]) {
        const read = await detail(student.id, cookie);
        expect(read.contact).not.toBeNull();
        expect(read.identity).toBeNull();
        expect(read.identityHidden).toBe(false);
        expect(read.financial).toBeNull();
        expect(JSON.stringify(read)).not.toContain('birthDate');
        expect(JSON.stringify(read)).not.toContain('Navoiy');
      }
    });

    it('answers Basic only to a Head Teacher and a Senior Head Teacher', async () => {
      for (const cookie of [headTeacher, seniorHeadTeacher]) {
        const read = await detail(student.id, cookie);
        expect(read.contact).toBeNull();
        expect(read.identity).toBeNull();
        expect(read.financial).toBeNull();
        expect(read.identityHidden).toBe(false);
      }
    });

    it('refuses the record to a Tutor until the class scope of task 3.1 (decision 6)', async () => {
      refusedWith(
        await t.get(`/api/people/students/${student.id}`, t.north, tutor),
        403,
        'permission_denied',
      );
    });

    it('logs every show of the Principal', async () => {
      const show = () =>
        t.post(`/api/people/students/${student.id}/identity`, t.north, {}, t.principal);
      const first = await show();
      expect(first.status).toBe(200);
      expect(studentIdentitySchema.parse(first.body)).toMatchObject({
        address: 'Navoiy koʻchasi 5',
      });
      expect((await show()).status).toBe(200);
      const entries = await t.entries('student.identity_shown', student.id);
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({ assignment_id: principalAssignment, branch_id: t.north });
    });

    it('refuses the show to a reader who sees the identity or may not see it', async () => {
      const before = await t.auditCount();
      for (const cookie of [t.admin, t.vicePrincipal, headTutor, spiritual, headTeacher, tutor]) {
        refusedWith(
          await t.post(`/api/people/students/${student.id}/identity`, t.north, {}, cookie),
          403,
          'permission_denied',
        );
      }
      expect(await t.auditCount()).toBe(before);
      // The Tutor is refused here because no Principal assignment exists, not by
      // the Tutor-only refusal of the record; the class scope of 3.1 changes
      // neither.
    });
  });

  // .claude/rules/api.md: a part allowed to one role only is decided from
  // every current assignment, and the audit entry names the assignment that
  // allowed it (permission review of the build).
  describe('accounts with several roles', () => {
    let student: StudentDetail;

    async function holding(
      first: string,
      last: string,
      held: readonly { role: string; branchId: string }[],
    ): Promise<{ cookie: string; assignments: string[] }> {
      // The Academic Vice Principal must have a second step (0.6c).
      const browser = held.some((one) => one.role === 'academic_vice_principal')
        ? await t.kit.completeSession(first, last)
        : await t.kit.fullSession(first, last);
      const assignments: string[] = [];
      for (const one of held) {
        assignments.push(
          (
            await t.kit.giveRole(browser.account.id, {
              role: one.role as never,
              branchId: one.branchId,
            })
          ).id,
        );
      }
      return { cookie: browser.cookie, assignments };
    }

    beforeAll(async () => {
      student = await create();
    });

    it('opens the record with Contact to a Tutor who is also the Head Tutor', async () => {
      const { cookie } = await holding('Kamola', 'Ergasheva', [
        { role: 'tutor', branchId: t.north },
        { role: 'head_tutor', branchId: t.north },
      ]);
      const read = await detail(student.id, cookie);
      expect(read.contact).not.toBeNull();
      expect(read.identity).toBeNull();
    });

    it('names the Principal assignment on a show by a Head Teacher who is also the Principal', async () => {
      const { cookie, assignments } = await holding('Rustam', 'Karimov', [
        { role: 'head_teacher', branchId: t.north },
        { role: 'principal', branchId: t.north },
      ]);
      const response = await t.post(
        `/api/people/students/${student.id}/identity`,
        t.north,
        {},
        cookie,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const entries = await t.entries('student.identity_shown', student.id);
      expect(entries.at(-1)).toMatchObject({ assignment_id: assignments[1] });
    });

    it('reads another branch with only the roles held there', async () => {
      const { cookie } = await holding('Shahlo', 'Mirzayeva', [
        { role: 'principal', branchId: t.south },
        { role: 'head_teacher', branchId: t.north },
      ]);
      const read = await detail(student.id, cookie);
      expect(read).toMatchObject({
        contact: null,
        identity: null,
        financial: null,
        identityHidden: false,
        canEdit: false,
      });
      refusedWith(
        await t.post(`/api/people/students/${student.id}/identity`, t.north, {}, cookie),
        403,
        'permission_denied',
      );
    });

    it('shows the identity, and refuses the show, to a Principal who is also the Academic VP', async () => {
      const { cookie } = await holding('Bahodir', 'Sobirov', [
        { role: 'principal', branchId: t.north },
        { role: 'academic_vice_principal', branchId: t.north },
      ]);
      const read = await detail(student.id, cookie);
      expect(read.identity).not.toBeNull();
      expect(read.identityHidden).toBe(false);
      refusedWith(
        await t.post(`/api/people/students/${student.id}/identity`, t.north, {}, cookie),
        403,
        'permission_denied',
      );
    });

    it('opens a student of either branch to a Senior Head Teacher, each in its own branch', async () => {
      const south = studentDetailSchema.parse(
        (await t.post('/api/people/students', t.south, body())).body,
      );
      const read = await detail(south.id, seniorHeadTeacher, t.south);
      expect(read).toMatchObject({ contact: null, identity: null, financial: null });
      refusedWith(
        await t.get(`/api/people/students/${south.id}`, t.north, seniorHeadTeacher),
        404,
        'not_found',
      );
    });
  });

  describe('the list', () => {
    it('answers the Basic group of the branch to every viewer', async () => {
      const student = await create({ lastName: 'Listov' });
      for (const cookie of [
        t.admin,
        t.principal,
        t.vicePrincipal,
        spiritual,
        headTutor,
        tutor,
        headTeacher,
        seniorHeadTeacher,
      ]) {
        const response = await t.get('/api/people/students', t.north, cookie);
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        const list = studentListSchema.parse(response.body);
        expect(list.today).toBe('2026-10-10');
        const row = list.students.find((item) => item.id === student.id);
        expect(row).toEqual({
          id: student.id,
          uid: student.uid,
          firstName: student.firstName,
          lastName: 'Listov',
          paternalName: 'Anvarovich',
          sex: 'male',
          grade: 7,
          startsOn: '2026-09-02',
          photoId: null,
          // The consent is with the Financial readers (task 2.4b-2).
          consentMissing: [t.admin, t.principal, t.vicePrincipal].includes(cookie) ? false : null,
          status: 'active',
          planned: null,
          version: 1,
        });
        expect(JSON.stringify(response.body)).not.toContain('+99890');
      }
    });

    it('shows each branch its own students; a Senior Head Teacher reads both', async () => {
      const south = studentDetailSchema.parse(
        (await t.post('/api/people/students', t.south, body())).body,
      );
      const ids = async (branch: string, cookie: string) =>
        studentListSchema
          .parse((await t.get('/api/people/students', branch, cookie)).body)
          .students.map((item) => item.id);
      expect(await ids(t.north, t.admin)).not.toContain(south.id);
      expect(await ids(t.south, t.admin)).toContain(south.id);
      expect(await ids(t.south, seniorHeadTeacher)).toContain(south.id);
      expect(await ids(t.north, seniorHeadTeacher)).not.toContain(south.id);
    });

    it('refuses a Teacher, and a Head Teacher in another branch', async () => {
      refusedWith(
        await t.get('/api/people/students', t.north, t.teacher),
        403,
        'permission_denied',
      );
      refusedWith(
        await t.get('/api/people/students', t.south, headTeacher),
        403,
        'permission_denied',
      );
      refusedWith(
        await t.get('/api/people/students', t.south, t.principal),
        403,
        'permission_denied',
      );
    });
  });

  describe('refusals of the writing routes', () => {
    it('refuses every writing route to every role but the Super Admin and the Academic VP', async () => {
      const student = await create();
      const before = await snapshot();
      for (const cookie of [
        t.principal,
        spiritual,
        headTutor,
        tutor,
        headTeacher,
        seniorHeadTeacher,
        t.teacher,
      ]) {
        refusedWith(
          await t.post('/api/people/students', t.north, body(), cookie),
          403,
          'permission_denied',
        );
        refusedWith(
          await t.post(
            '/api/people/students/check',
            t.north,
            { firstName: 'Ali', lastName: 'Valiyev', birthDate: '2014-01-01', studentId: null },
            cookie,
          ),
          403,
          'permission_denied',
        );
        refusedWith(
          await t.put(`/api/people/students/${student.id}`, t.north, editBody(student), cookie),
          403,
          'permission_denied',
        );
        refusedWith(
          await t.put(
            `/api/people/students/${student.id}/uid`,
            t.north,
            { uid: '2607990', reason: 'Typo.', confirmUidSet: false },
            cookie,
          ),
          403,
          'permission_denied',
        );
      }
      expect(await snapshot()).toEqual(before);
    });

    it('answers 404 for a student of another branch or an unknown id on every record route', async () => {
      const south = studentDetailSchema.parse(
        (await t.post('/api/people/students', t.south, body())).body,
      );
      const before = await snapshot();
      for (const id of [south.id, UNKNOWN]) {
        refusedWith(await t.get(`/api/people/students/${id}`, t.north), 404, 'not_found');
        refusedWith(
          await t.put(`/api/people/students/${id}`, t.north, editBody(south)),
          404,
          'not_found',
        );
        refusedWith(
          await t.put(`/api/people/students/${id}/uid`, t.north, {
            uid: '2607991',
            reason: 'Typo.',
            confirmUidSet: false,
          }),
          404,
          'not_found',
        );
        refusedWith(
          await t.post(`/api/people/students/${id}/identity`, t.north, {}, t.principal),
          404,
          'not_found',
        );
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('edit', () => {
    it('changes the fields and corrects the newest contract, with the old and new values', async () => {
      const student = await create();
      const response = await t.put(
        `/api/people/students/${student.id}`,
        t.north,
        editBody(student, {
          firstName: 'Otabek',
          grade: 8,
          contract: { number: `${student.uid}-B`, signedOn: '2026-08-25' },
        }),
        t.vicePrincipal,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const read = studentDetailSchema.parse(response.body);
      expect(read).toMatchObject({ firstName: 'Otabek', grade: 8 });
      expect(read.financial?.contracts).toHaveLength(1);
      expect(read.financial?.contracts[0]).toMatchObject({
        number: `${student.uid}-B`,
        signedOn: '2026-08-25',
      });
      const [entry] = await t.entries('student.edit', student.id);
      expect(entry).toMatchObject({ assignment_id: t.viceAssignment });
      expect(entry?.old_value).toEqual({
        firstName: 'Oʻtkir',
        grade: 7,
        contract: {
          number: String(student.financial?.contracts[0]?.number),
          signedOn: '2026-08-20',
        },
      });
      const key = await t.database.migrator
        .selectFrom('students')
        .select('name_key')
        .where('id', '=', student.id)
        .executeTakeFirstOrThrow();
      expect(key.name_key).toBe(studentNameKey(student.lastName, 'Otabek'));
    });

    it('writes nothing for an edit that changes nothing', async () => {
      const student = await create();
      const before = await snapshot();
      expect(
        (await t.put(`/api/people/students/${student.id}`, t.north, editBody(student))).status,
      ).toBe(200);
      expect(await snapshot()).toEqual(before);
    });

    it('refuses a UID or a start date in the edit', async () => {
      const student = await create();
      for (const overrides of [{ uid: '2607992' }, { startsOn: '2026-09-03' }]) {
        refusedWith(
          await t.put(`/api/people/students/${student.id}`, t.north, editBody(student, overrides)),
          400,
          'validation_failed',
        );
      }
    });

    it('refuses a JSHSHIR held by another student', async () => {
      const holder = await create();
      const student = await create();
      const response = await t.put(
        `/api/people/students/${student.id}`,
        t.north,
        editBody(student, { jshshir: holder.identity?.jshshir }),
      );
      refusedWith(response, 409, 'student_value_taken');
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({ path: 'jshshir', recordId: holder.id }),
      ]);
    });
  });

  describe('the UID correction (edge: "A mistyped UID can be corrected ... with a reason")', () => {
    it('gives the new UID, keeps the old one reserved to the student and logs the reason', async () => {
      const student = await create();
      const uid = String(2607000 + count + 800);
      const response = await t.put(
        `/api/people/students/${student.id}/uid`,
        t.north,
        { uid, reason: 'Typed wrongly at enrolment.', confirmUidSet: false },
        t.vicePrincipal,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(studentDetailSchema.parse(response.body).uid).toBe(uid);
      const [entry] = await t.entries('student.uid_corrected', student.id);
      expect(entry).toMatchObject({
        old_value: { uid: student.uid },
        new_value: { uid },
        reason: 'Typed wrongly at enrolment.',
        assignment_id: t.viceAssignment,
      });
      const taken = await t.post('/api/people/students', t.south, body({ uid: student.uid }));
      refusedWith(taken, 409, 'student_value_taken');
      // The old UID is the student's for good; it can be taken back.
      const back = await t.put(`/api/people/students/${student.id}/uid`, t.north, {
        uid: student.uid,
        reason: 'The first one was right.',
        confirmUidSet: false,
      });
      expect(back.status, JSON.stringify(back.body)).toBe(200);
      expect(studentDetailSchema.parse(back.body).uid).toBe(student.uid);
    });

    it('wants a reason, checks the set and refuses a UID held here or elsewhere', async () => {
      const student = await create();
      const holder = await create();
      const elsewhere = body();
      expect((await t.post('/api/people/students', t.south, elsewhere)).status).toBe(201);
      const before = await snapshot();
      const correct = (uid: string, reason = 'Typo.', confirmUidSet = false) =>
        t.put(`/api/people/students/${student.id}/uid`, t.north, { uid, reason, confirmUidSet });
      refusedWith(await correct('2607993', ''), 400, 'validation_failed');
      refusedWith(await correct('2606993'), 409, 'uid_set_mismatch');
      const here = await correct(holder.uid);
      refusedWith(here, 409, 'student_value_taken');
      expect(detailsOf(here)[0]).toMatchObject({ path: 'uid', recordId: holder.id });
      const there = await correct(String(elsewhere.uid));
      refusedWith(there, 409, 'student_value_taken');
      expect(detailsOf(there)[0]).toMatchObject({ path: 'uid', code: 'held_elsewhere' });
      expect(await snapshot()).toEqual(before);
      expect((await correct('2606994', 'Repeated grade 6.', true)).status).toBe(200);
    });
  });
});
