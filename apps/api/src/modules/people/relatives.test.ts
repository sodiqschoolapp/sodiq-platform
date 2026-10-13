import {
  apiErrorSchema,
  relativeDetailSchema,
  relativeIdentitySchema,
  relativeListSchema,
  relativePhoneMatchResultSchema,
  studentDetailSchema,
  studentRelativesSchema,
  type StudentDetail,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

// All names and phones are invented. docs/spec/04-people.md, Close relatives;
// docs/spec/edge-cases/close-relatives.md; the plan approved on pull request
// #72 with corrections 1 and 2 (task 2.5a). The clock stands at 23:55 on 10
// October 2026 in Tashkent; north and south each have the year 2026–2027.
describe('close relatives', () => {
  let t: DayTemplatesKit;
  let spiritual: string;
  let headTutor: string;
  let principalAssignment: string;
  let count = 0;

  /** A new relative of a create or a link; `null` phone: "no phone of their own". */
  const newRelative = (
    phone: string | null,
    values: { fullName?: string; mainContact?: boolean; relationship?: string } = {},
  ) => ({
    kind: 'new',
    relative: {
      fullName: values.fullName ?? 'Dilfuza Karimova',
      phone,
      workplace: 'Toshkent shahar shifoxonasi',
      email: 'd.karimova@example.uz',
    },
    relationship: values.relationship ?? 'mother',
    mainContact: values.mainContact ?? true,
    portalAccess: true,
    receivesNotices: true,
  });

  /** The relative a phone match showed. */
  const existing = (relativeId: string, phone: string, mainContact = false) => ({
    kind: 'existing',
    relativeId,
    phone,
    relationship: 'father',
    mainContact,
    portalAccess: true,
    receivesNotices: true,
  });

  /** A phone no other test uses. */
  const phone = () => {
    count += 1;
    return `+99890${String(3000000 + count)}`;
  };

  function body(relatives: unknown[]): Record<string, unknown> {
    count += 1;
    return {
      uid: String(2607000 + count),
      confirmUidSet: true,
      firstName: 'Kamola',
      lastName: `Ergasheva${'a'.repeat(count % 7)}`,
      paternalName: '',
      sex: 'female',
      birthDate: `2014-04-${String((count % 28) + 1).padStart(2, '0')}`,
      grade: 7,
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
      contract: { number: `RL-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives,
    };
  }

  async function student(relatives: unknown[], branch = ''): Promise<StudentDetail> {
    const response = await t.post('/api/people/students', branch || t.north, body(relatives));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body);
  }

  /** The relatives tab of a student, as the Super Admin reads it. */
  async function tab(id: string, branch = '', cookie = t.admin) {
    const response = await t.get(`/api/people/students/${id}/relatives`, branch || t.north, cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return studentRelativesSchema.parse(response.body);
  }

  /** A student of a branch with one new relative of a phone, and that relative's id. */
  async function withRelative(phoneNumber: string | null, branch = '', fullName?: string) {
    const created = await student(
      [newRelative(phoneNumber, fullName === undefined ? {} : { fullName })],
      branch,
    );
    const relatives = await tab(created.id, branch);
    const relative = relatives.relatives[0];
    if (relative === undefined) {
      throw new Error('A student is created with a relative.');
    }
    return { student: created, relativeId: relative.relativeId };
  }

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  const detailsOf = (response: Response) => apiErrorSchema.parse(response.body).error.details ?? [];

  /** The entries of an action in the school-wide log, oldest first. */
  const schoolEntries = (action: string, recordId: string) =>
    t.database.migrator
      .selectFrom('audit_log_school')
      .selectAll()
      .where('action', '=', action)
      .where('record_id', '=', recordId)
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();

  /** Every row of the tables the relative routes write, and both logs. */
  async function snapshot(): Promise<Record<string, unknown>> {
    const rows: Record<string, unknown> = {};
    for (const table of [
      'relatives',
      'relative_accounts',
      'student_relatives',
      'students',
      'audit_log',
      'audit_log_school',
    ] as const) {
      rows[table] = (
        await sql`select * from ${sql.table(table)} order by 1`.execute(t.database.migrator)
      ).rows;
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

  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(t.database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

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
    spiritual = await signedIn('Gulnora', 'Tosheva', 'spiritual_vice_principal', t.north);
    headTutor = await signedIn('Malika', 'Yusupova', 'head_tutor', t.north);
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

  describe('the create of a student', () => {
    it('writes a new relative with its switched-off Parent account and the main link', async () => {
      const number = phone();
      const response = await t.post(
        '/api/people/students',
        t.north,
        body([newRelative(number)]),
        t.vicePrincipal,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const created = studentDetailSchema.parse(response.body);
      const link = await t.database.migrator
        .selectFrom('student_relatives')
        .selectAll()
        .where('student_id', '=', created.id)
        .executeTakeFirstOrThrow();
      expect(link).toMatchObject({
        branch_id: t.north,
        relationship: 'mother',
        main_contact: true,
        portal_access: true,
        receives_notices: true,
        unlinked_at: null,
      });
      const relative = await t.database.migrator
        .selectFrom('relatives')
        .selectAll()
        .where('id', '=', link.relative_id)
        .executeTakeFirstOrThrow();
      expect(relative).toMatchObject({
        full_name: 'Dilfuza Karimova',
        phone: number,
        workplace: 'Toshkent shahar shifoxonasi',
        archived_at: null,
      });
      expect(
        await t.database.migrator
          .selectFrom('relative_accounts')
          .selectAll()
          .where('relative_id', '=', link.relative_id)
          .executeTakeFirstOrThrow(),
      ).toMatchObject({ switched_on_at: null });

      // Correction 1: the record entry is school-wide, the link entry the branch's.
      const record = await schoolEntries('relative.create', link.relative_id);
      expect(record).toHaveLength(1);
      expect(record[0]).toMatchObject({
        assignment_id: t.viceAssignment,
        details: { branchId: t.north },
        request_id: response.headers['x-request-id'],
      });
      expect(await t.entries('relative.create', link.relative_id)).toEqual([]);
      const linked = await t.entries('relative.link', link.relative_id);
      expect(linked).toHaveLength(1);
      expect(linked[0]).toMatchObject({
        branch_id: t.north,
        assignment_id: t.viceAssignment,
        new_value: { studentId: created.id, relationship: 'mother', mainContact: true },
      });
      const studentEntry = await t.entries('student.create', created.id);
      expect(studentEntry[0]?.new_value).not.toHaveProperty('relatives');
    });

    it('is refused without a relative (the done-when of task 2.5)', async () => {
      const before = await snapshot();
      refusedWith(
        await t.post('/api/people/students', t.north, body([])),
        422,
        'student_needs_relative',
      );
      expect(await snapshot()).toEqual(before);
    });

    it('takes a relative with no phone of their own', async () => {
      const { student: created } = await withRelative(null);
      expect((await tab(created.id)).relatives[0]).toMatchObject({
        phone: null,
        mainContact: true,
      });
    });

    it('refuses a new relative with a phone held in another branch, naming the holder', async () => {
      const number = phone();
      const holder = await withRelative(number, t.south, 'Shoira Nazarova');
      const before = await snapshot();
      const response = await t.post('/api/people/students', t.north, body([newRelative(number)]));
      refusedWith(response, 409, 'relative_phone_exists');
      expect(detailsOf(response)).toEqual([
        {
          path: 'relatives.0.relative.phone',
          code: 'already_exists',
          message: expect.any(String) as string,
          recordId: holder.relativeId,
          holder: { fullName: 'Shoira Nazarova', students: 1 },
        },
      ]);
      expect(await snapshot()).toEqual(before);
    });

    it('links the relative a phone match showed, as one record across branches', async () => {
      const number = phone();
      const holder = await withRelative(number, t.south, 'Shoira Nazarova');
      const match = await t.post(
        '/api/people/relatives/phone-match',
        t.north,
        { phone: number },
        t.vicePrincipal,
      );
      expect(match.status, JSON.stringify(match.body)).toBe(200);
      expect(relativePhoneMatchResultSchema.parse(match.body)).toEqual({
        holder: { id: holder.relativeId, fullName: 'Shoira Nazarova', students: 1 },
      });
      const created = await student([existing(holder.relativeId, number, true)]);
      expect((await tab(created.id)).relatives).toMatchObject([
        { relativeId: holder.relativeId, fullName: 'Shoira Nazarova', mainContact: true },
      ]);
      const count = await t.database.migrator
        .selectFrom('relatives')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('phone', '=', number)
        .executeTakeFirstOrThrow();
      expect(count.count).toBe('1');
      const page = relativeDetailSchema.parse(
        (await t.get(`/api/people/relatives/${holder.relativeId}`, t.north)).body,
      );
      expect(page).toMatchObject({ elsewhere: 1, students: [{ id: created.id }] });
    });

    it('refuses a relative whose phone moved since the match (decision 18)', async () => {
      const first = await withRelative(phone());
      const other = phone();
      await withRelative(other);
      const before = await snapshot();
      const response = await t.post(
        '/api/people/students',
        t.north,
        body([existing(first.relativeId, other, true)]),
      );
      refusedWith(response, 409, 'relative_phone_changed');
      expect(await snapshot()).toEqual(before);
      refusedWith(
        await t.post('/api/people/students', t.north, body([existing(UNKNOWN, phone(), true)])),
        409,
        'relative_phone_changed',
      );
    });

    it('answers relative_phone_exists to the create that waited for one of another branch', async () => {
      const number = phone();
      const southern = await withRelative(phone(), t.south);
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      // The writes of a link of a new relative in the south, held open.
      const held = t.app.get(Transactions).run([t.south], async (transaction: Transaction) => {
        const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
        const id = found.rows[0]?.id ?? '';
        await transaction
          .insertInto('relatives')
          .values({ id, full_name: 'Shoira Nazarova', name_key: 'shoira nazarova', phone: number })
          .execute();
        await transaction
          .insertInto('relative_accounts')
          .values({ relative_id: id, created_at: new Date('2026-10-10T18:55:00Z') })
          .execute();
        await transaction
          .insertInto('student_relatives')
          .values({
            student_id: southern.student.id,
            branch_id: t.south,
            relative_id: id,
            relationship: 'aunt',
            main_contact: false,
            linked_at: new Date('2026-10-10T18:55:00Z'),
          })
          .execute();
        ready();
        await released;
        return id;
      });
      await isReady;
      const saving = t
        .post('/api/people/students', t.north, body([newRelative(number)]))
        .then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      const before = await snapshot();
      release();
      const holder = await held;
      const response = await saving;
      refusedWith(response, 409, 'relative_phone_exists');
      expect(detailsOf(response)[0]).toMatchObject({
        recordId: holder,
        holder: { fullName: 'Shoira Nazarova', students: 1 },
      });
      // Nothing of the refused create stays; the south wrote its link.
      const after = await snapshot();
      expect(after.students).toEqual(before.students);
    });
  });

  describe('the Parents list and page', () => {
    it('lists the relatives of the branch with their students and the count elsewhere', async () => {
      const number = phone();
      const holder = await withRelative(number, t.north, 'Oʻgʻiloy Toshmatova');
      await student([existing(holder.relativeId, number, true)], t.south);
      const list = relativeListSchema.parse(
        (await t.get('/api/people/relatives', t.north, t.vicePrincipal)).body,
      );
      expect(list).toMatchObject({ searchesPhone: true, canEdit: true });
      expect(list.relatives.find((one) => one.id === holder.relativeId)).toMatchObject({
        fullName: 'Oʻgʻiloy Toshmatova',
        phone: number,
        students: [{ id: holder.student.id, relationship: 'mother', mainContact: true }],
        elsewhere: 1,
      });
      // A Cyrillic spelling finds the Latin name (answer 18).
      const byName = relativeListSchema.parse(
        (await t.get(`/api/people/relatives?search=${encodeURIComponent('Огилой')}`, t.north)).body,
      );
      expect(byName.relatives.map((one) => one.id)).toContain(holder.relativeId);
      const byPhone = relativeListSchema.parse(
        (await t.get(`/api/people/relatives?phone=${encodeURIComponent(number.slice(4))}`, t.north))
          .body,
      );
      expect(byPhone.relatives.map((one) => one.id)).toEqual([holder.relativeId]);
    });

    it('lets the Principal read the list without a phone search', async () => {
      const list = relativeListSchema.parse(
        (await t.get('/api/people/relatives', t.north, t.principal)).body,
      );
      expect(list).toMatchObject({ searchesPhone: false, canEdit: false });
      refusedWith(
        await t.get('/api/people/relatives?phone=901', t.north, t.principal),
        403,
        'permission_denied',
      );
    });

    it('answers 404 for a relative of another branch only and an unknown one', async () => {
      const southern = await withRelative(phone(), t.south);
      for (const id of [southern.relativeId, UNKNOWN]) {
        refusedWith(await t.get(`/api/people/relatives/${id}`, t.north), 404, 'not_found');
      }
      const list = relativeListSchema.parse((await t.get('/api/people/relatives', t.north)).body);
      expect(list.relatives.map((one) => one.id)).not.toContain(southern.relativeId);
    });

    it('hides workplace and email from the Principal behind a logged show (decision 5)', async () => {
      const { relativeId } = await withRelative(phone());
      const page = relativeDetailSchema.parse(
        (await t.get(`/api/people/relatives/${relativeId}`, t.north, t.principal)).body,
      );
      expect(page).toMatchObject({ identity: null, identityHidden: true, canEdit: false });
      const shown = await t.post(
        `/api/people/relatives/${relativeId}/show`,
        t.north,
        {},
        t.principal,
      );
      expect(shown.status, JSON.stringify(shown.body)).toBe(200);
      expect(relativeIdentitySchema.parse(shown.body)).toEqual({
        workplace: 'Toshkent shahar shifoxonasi',
        email: 'd.karimova@example.uz',
      });
      const entries = await t.entries('relative.show', relativeId);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ branch_id: t.north, assignment_id: principalAssignment });
      // A reader who sees them is refused the show.
      refusedWith(
        await t.post(`/api/people/relatives/${relativeId}/show`, t.north, {}, t.vicePrincipal),
        403,
        'permission_denied',
      );
      const own = relativeDetailSchema.parse(
        (await t.get(`/api/people/relatives/${relativeId}`, t.north, t.vicePrincipal)).body,
      );
      expect(own).toMatchObject({
        identityHidden: false,
        identity: { email: 'd.karimova@example.uz' },
      });
    });
  });

  describe('the edit of a relative', () => {
    const record = (values: Record<string, unknown>) => ({
      fullName: 'Dilfuza Karimova',
      phone: null,
      workplace: '',
      email: '',
      ...values,
    });

    it('changes it for every linked student and logs it school-wide (correction 1)', async () => {
      const number = phone();
      const holder = await withRelative(number);
      await student([existing(holder.relativeId, number, true)], t.south);
      const changed = phone();
      const auditBefore = await t.auditCount();
      const response = await t.patch(
        `/api/people/relatives/${holder.relativeId}`,
        t.north,
        record({ fullName: 'Dilfuza Qodirova', phone: changed }),
        t.vicePrincipal,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(relativeDetailSchema.parse(response.body)).toMatchObject({
        fullName: 'Dilfuza Qodirova',
        phone: changed,
      });
      const fromSouth = relativeDetailSchema.parse(
        (await t.get(`/api/people/relatives/${holder.relativeId}`, t.south)).body,
      );
      expect(fromSouth).toMatchObject({ fullName: 'Dilfuza Qodirova', phone: changed });
      const entries = await schoolEntries('relative.edit', holder.relativeId);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        assignment_id: t.viceAssignment,
        details: { branchId: t.north },
        old_value: { fullName: 'Dilfuza Karimova', phone: number },
        new_value: { fullName: 'Dilfuza Qodirova', phone: changed },
      });
      expect(await t.auditCount()).toBe(auditBefore);
    });

    it('refuses a phone held by another relative and shows that relative', async () => {
      const mine = await withRelative(phone());
      const elsewhere = phone();
      await withRelative(elsewhere, t.south, 'Shoira Nazarova');
      const before = await snapshot();
      const response = await t.patch(
        `/api/people/relatives/${mine.relativeId}`,
        t.north,
        record({ phone: elsewhere }),
      );
      refusedWith(response, 409, 'relative_phone_taken');
      // Held in another branch only: the name and the count, no id.
      expect(detailsOf(response)).toEqual([
        {
          path: 'phone',
          code: 'already_exists',
          message: expect.any(String) as string,
          holder: { fullName: 'Shoira Nazarova', students: 1 },
        },
      ]);
      expect(await snapshot()).toEqual(before);

      const here = phone();
      const neighbour = await withRelative(here);
      const again = await t.patch(
        `/api/people/relatives/${mine.relativeId}`,
        t.north,
        record({ phone: here }),
      );
      refusedWith(again, 409, 'relative_phone_taken');
      expect(detailsOf(again)[0]).toMatchObject({ recordId: neighbour.relativeId });
    });

    it('is refused to the Principal, and answers 404 for another branch', async () => {
      const southern = await withRelative(phone(), t.south);
      const mine = await withRelative(phone());
      const before = await snapshot();
      refusedWith(
        await t.patch(`/api/people/relatives/${mine.relativeId}`, t.north, record({}), t.principal),
        403,
        'permission_denied',
      );
      for (const id of [southern.relativeId, UNKNOWN]) {
        refusedWith(
          await t.patch(`/api/people/relatives/${id}`, t.north, record({})),
          404,
          'not_found',
        );
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  describe("the student's Relatives tab", () => {
    it('gives each reader what its group allows (02; decision 5)', async () => {
      const { student: created } = await withRelative(phone());
      const spiritualTab = await tab(created.id, '', spiritual);
      expect(spiritualTab.relatives[0]).toMatchObject({
        relationship: 'mother',
        mainContact: true,
        portalAccess: null,
        receivesNotices: null,
        identity: null,
      });
      expect(spiritualTab.canEdit).toBe(false);
      expect((await tab(created.id, '', headTutor)).relatives[0]?.identity).toBeNull();
      expect((await tab(created.id, '', t.principal)).relatives[0]).toMatchObject({
        portalAccess: true,
        identity: null,
      });
      expect((await tab(created.id, '', t.vicePrincipal)).relatives[0]).toMatchObject({
        portalAccess: true,
        receivesNotices: true,
        identity: { workplace: 'Toshkent shahar shifoxonasi' },
      });
      refusedWith(
        await t.get(`/api/people/students/${created.id}/relatives`, t.north, t.teacher),
        403,
        'permission_denied',
      );
    });

    it('answers 404 for a student of another branch and an unknown one', async () => {
      const southern = await withRelative(phone(), t.south);
      for (const id of [southern.student.id, UNKNOWN]) {
        refusedWith(await t.get(`/api/people/students/${id}/relatives`, t.north), 404, 'not_found');
      }
    });
  });

  describe('the links of a student', () => {
    it('adds a relative, moves the main contact in one change and keeps one', async () => {
      const { student: created, relativeId: first } = await withRelative(phone());
      const added = await t.post(
        `/api/people/students/${created.id}/relatives`,
        t.north,
        newRelative(phone(), {
          fullName: 'Rustam Karimov',
          relationship: 'father',
          mainContact: true,
        }),
        t.vicePrincipal,
      );
      expect(added.status, JSON.stringify(added.body)).toBe(201);
      const after = studentRelativesSchema.parse(added.body);
      expect(after.relatives.map((one) => [one.fullName, one.mainContact])).toEqual([
        ['Rustam Karimov', true],
        ['Dilfuza Karimova', false],
      ]);
      // Clearing the mark of the main contact is refused; setting it on another moves it.
      const second = after.relatives[0]?.relativeId ?? '';
      const link = { relationship: 'father', portalAccess: false, receivesNotices: true };
      refusedWith(
        await t.patch(`/api/people/students/${created.id}/relatives/${second}`, t.north, {
          ...link,
          mainContact: false,
        }),
        422,
        'main_contact_needed',
      );
      const moved = await t.patch(
        `/api/people/students/${created.id}/relatives/${first}`,
        t.north,
        {
          relationship: 'mother',
          mainContact: true,
          portalAccess: false,
          receivesNotices: true,
        },
      );
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect(
        studentRelativesSchema
          .parse(moved.body)
          .relatives.map((one) => [one.relativeId, one.mainContact, one.portalAccess]),
      ).toEqual([
        [first, true, false],
        [second, false, true],
      ]);
      const entries = await t.entries('relative.link_edit', first);
      expect(entries[0]).toMatchObject({
        old_value: { mainContact: false, portalAccess: true, studentId: created.id },
        new_value: { mainContact: true, portalAccess: false, studentId: created.id },
      });
    });

    it('refuses a relative linked twice', async () => {
      const number = phone();
      const { student: created, relativeId } = await withRelative(number);
      refusedWith(
        await t.post(
          `/api/people/students/${created.id}/relatives`,
          t.north,
          existing(relativeId, number),
        ),
        409,
        'already_exists',
      );
    });

    it('keeps the last relative and asks the next main contact in the unlink', async () => {
      const { student: created, relativeId: main } = await withRelative(phone());
      const before = await snapshot();
      refusedWith(
        await t.post(`/api/people/students/${created.id}/relatives/${main}/unlink`, t.north, {
          newMainContactId: null,
        }),
        409,
        'last_relative',
      );
      const added = studentRelativesSchema.parse(
        (
          await t.post(
            `/api/people/students/${created.id}/relatives`,
            t.north,
            newRelative(phone(), { fullName: 'Rustam Karimov', mainContact: false }),
          )
        ).body,
      );
      const other = added.relatives.find((one) => one.relativeId !== main)?.relativeId ?? '';
      const middle = await snapshot();
      refusedWith(
        await t.post(`/api/people/students/${created.id}/relatives/${main}/unlink`, t.north, {
          newMainContactId: null,
        }),
        422,
        'main_contact_needed',
      );
      // An id in the body of another branch or unknown: 404, nothing written.
      const southern = await withRelative(phone(), t.south);
      const beforeIds = await snapshot();
      for (const id of [southern.relativeId, UNKNOWN, main]) {
        refusedWith(
          await t.post(`/api/people/students/${created.id}/relatives/${main}/unlink`, t.north, {
            newMainContactId: id,
          }),
          404,
          'not_found',
        );
      }
      expect(await snapshot()).toEqual(beforeIds);
      expect(middle).not.toEqual(before);

      const response = await t.post(
        `/api/people/students/${created.id}/relatives/${main}/unlink`,
        t.north,
        { newMainContactId: other },
        t.vicePrincipal,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(studentRelativesSchema.parse(response.body).relatives).toMatchObject([
        { relativeId: other, mainContact: true },
      ]);
      const entries = await t.entries('relative.unlink', main);
      expect(entries[0]).toMatchObject({
        branch_id: t.north,
        new_value: { studentId: created.id, newMainContactId: other },
      });
      // Its only student: the relative is archived, school-wide (04, Removing a link).
      expect(await schoolEntries('relative.archive', main)).toHaveLength(1);
      const stored = await t.database.migrator
        .selectFrom('relatives')
        .select('archived_at')
        .where('id', '=', main)
        .executeTakeFirstOrThrow();
      expect(stored.archived_at).not.toBeNull();
      refusedWith(await t.get(`/api/people/relatives/${main}`, t.north), 404, 'not_found');
    });

    it('restores an archived relative found by phone (decision 14)', async () => {
      const number = phone();
      const { student: created, relativeId } = await withRelative(number);
      await t.post(
        `/api/people/students/${created.id}/relatives`,
        t.north,
        newRelative(phone(), { mainContact: true, fullName: 'Rustam Karimov' }),
      );
      const unlinked = await t.post(
        `/api/people/students/${created.id}/relatives/${relativeId}/unlink`,
        t.north,
        { newMainContactId: null },
      );
      expect(unlinked.status, JSON.stringify(unlinked.body)).toBe(200);
      expect(await schoolEntries('relative.archive', relativeId)).toHaveLength(1);

      const match = relativePhoneMatchResultSchema.parse(
        (await t.post('/api/people/relatives/phone-match', t.south, { phone: number })).body,
      );
      expect(match.holder).toEqual({ id: relativeId, fullName: 'Dilfuza Karimova', students: 0 });
      await student([existing(relativeId, number, true)], t.south);
      expect(await schoolEntries('relative.restore', relativeId)).toHaveLength(1);
      const stored = await t.database.migrator
        .selectFrom('relatives')
        .select('archived_at')
        .where('id', '=', relativeId)
        .executeTakeFirstOrThrow();
      expect(stored.archived_at).toBeNull();
    });

    it('answers 404 for the links of another branch, and refuses the readers', async () => {
      const southern = await withRelative(phone(), t.south);
      const mine = await withRelative(phone());
      const before = await snapshot();
      const link = {
        relationship: 'mother',
        mainContact: true,
        portalAccess: true,
        receivesNotices: true,
      };
      for (const [path, send] of [
        [`/api/people/students/${southern.student.id}/relatives`, 'post'],
        [`/api/people/students/${UNKNOWN}/relatives`, 'post'],
        [`/api/people/students/${mine.student.id}/relatives/${southern.relativeId}`, 'patch'],
        [`/api/people/students/${southern.student.id}/relatives/${southern.relativeId}`, 'patch'],
        [`/api/people/students/${mine.student.id}/relatives/${UNKNOWN}/unlink`, 'post'],
      ] as const) {
        const response =
          send === 'post'
            ? await t.post(
                path,
                t.north,
                path.endsWith('unlink') ? { newMainContactId: null } : newRelative(phone()),
              )
            : await t.patch(path, t.north, link);
        refusedWith(response, 404, 'not_found');
      }
      for (const cookie of [t.principal, t.teacher, spiritual]) {
        refusedWith(
          await t.post(
            `/api/people/students/${mine.student.id}/relatives`,
            t.north,
            newRelative(phone()),
            cookie,
          ),
          403,
          'permission_denied',
        );
        refusedWith(
          await t.patch(
            `/api/people/students/${mine.student.id}/relatives/${mine.relativeId}`,
            t.north,
            link,
            cookie,
          ),
          403,
          'permission_denied',
        );
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('a student of 2.4a with no relative (decision 11)', () => {
    it('is refused the edit of the record until a relative is linked', async () => {
      const keeper = await withRelative(phone());
      const { student: created, relativeId } = await withRelative(phone());
      // As saved before 0036: its link gone, its relative kept by another student.
      await t.database.migrator
        .insertInto('student_relatives')
        .values({
          student_id: keeper.student.id,
          branch_id: t.north,
          relative_id: relativeId,
          relationship: 'aunt',
          main_contact: false,
          linked_at: new Date('2026-10-01T00:00:00Z'),
        })
        .execute();
      await t.database.migrator
        .deleteFrom('student_relatives')
        .where('student_id', '=', created.id)
        .execute();
      const full = studentDetailSchema.parse(
        (await t.get(`/api/people/students/${created.id}`, t.north)).body,
      );
      const edit = {
        ...body([]),
        uid: undefined,
        startsOn: undefined,
        confirmUidSet: undefined,
        relatives: undefined,
        firstName: 'Kamila',
        lastName: full.lastName,
        birthDate: '2014-04-02',
      };
      const before = await snapshot();
      refusedWith(
        await t.put(`/api/people/students/${created.id}`, t.north, edit),
        422,
        'student_needs_relative',
      );
      expect(await snapshot()).toEqual(before);
      const linked = await t.post(
        `/api/people/students/${created.id}/relatives`,
        t.north,
        newRelative(phone(), { mainContact: false }),
      );
      // A student's only relative is the main contact automatically (edge).
      expect(studentRelativesSchema.parse(linked.body).relatives[0]?.mainContact).toBe(true);
      const saved = await t.put(`/api/people/students/${created.id}`, t.north, edit);
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    });
  });
});
