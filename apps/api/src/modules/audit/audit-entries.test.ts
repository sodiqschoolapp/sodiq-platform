import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  apiErrorSchema,
  auditEntrySchema,
  auditPageSchema,
  SIGN_IN_HISTORY_ACTIONS,
  signInHistorySchema,
  studentDetailSchema,
  type AuditEntryAnswer,
  type AuditPage,
  type SignInHistory,
  type StudentDetail,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import type { Json } from '../../database/types.generated.js';
import { relativesInput } from '../../testing/relatives-kit.js';
import { cookieOf, errorCode, NEW_PASSWORD } from '../../testing/sign-in-kit.js';
import { createTestDatabase } from '../../testing/test-database.js';
import { staffIdOf } from '../people/staff-numbers.js';

// All names, numbers and addresses are invented. docs/spec/edge-cases/
// people-roles-accounts.md, Personal data and the audit log: "The Super Admin
// reads all; the Principal and Academic Vice Principal read their branch ...
// It can be searched by person, record and date." The plan approved on pull
// request #75 with corrections 1 to 4 (task 2.6a). The clock stands at 23:55
// on 10 October 2026 in Tashkent (18:55 UTC).
describe('the audit log page', () => {
  let t: DayTemplatesKit;
  let principalAndVice: string;
  let headTutor: string;
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
    reason?: string;
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
      reason: values.reason ?? null,
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

  const page = (response: Response): AuditPage => {
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return auditPageSchema.parse(response.body);
  };

  const query = (values: Record<string, string>): string => new URLSearchParams(values).toString();

  /** Every entry of a search, page by page. */
  async function readAll(
    values: Record<string, string>,
    cookie: string,
    branch = '',
  ): Promise<AuditEntryAnswer[]> {
    const all: AuditEntryAnswer[] = [];
    let before: string | null = null;
    for (;;) {
      const params: Record<string, string> = before === null ? values : { ...values, before };
      const found = page(
        await t.get(`/api/audit/entries?${query(params)}`, branch || t.north, cookie),
      );
      all.push(...found.entries);
      if (found.next === null) {
        return all;
      }
      before = found.next;
    }
  }

  const ofRecord = (id: string, type = 'room') => ({ recordType: type, recordId: id });

  const ids = (entries: readonly AuditEntryAnswer[]) => entries.map((one) => one.id).sort();

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  async function signedIn(first: string, last: string, roles: string[], branchId: string) {
    const browser = await t.kit.completeSession(first, last);
    for (const role of roles) {
      await t.kit.giveRole(browser.account.id, { role: role as never, branchId });
    }
    return { cookie: browser.cookie, accountId: browser.account.id };
  }

  /** A staff record of a branch linked to an account, as the migrator writes it. */
  async function personOf(accountId: string | null, branch: string, first: string, last: string) {
    count += 1;
    const id = await newId();
    await t.database.migrator.transaction().execute(async (transaction) => {
      await transaction
        .insertInto('staff')
        .values({
          id,
          kind: 'person',
          staff_id: staffIdOf(2026, 8000 + count),
          first_name: first,
          last_name: last,
          sex: 'female',
          birth_date: '1988-03-04',
          phone: `+9989310${String(count).padStart(4, '0')}`,
          admission_date: '2026-09-01',
          account_id: accountId,
        })
        .execute();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: id, branch_id: branch, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({ staff_id: id, division_id: academic, department_id: steam, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: id, status: 'active', valid_from: '2026-09-01' })
        .execute();
    });
    return id;
  }

  function studentBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    count += 1;
    return {
      uid: String(2607600 + count),
      confirmUidSet: true,
      firstName: 'Madina',
      lastName: `Qodirova${'a'.repeat(count % 7)}`,
      paternalName: null,
      sex: 'female',
      birthDate: '2013-07-19',
      grade: 7,
      startsOn: '2026-09-02',
      documentType: null,
      documentNumber: null,
      jshshir: null,
      phone: null,
      email: null,
      address: 'Yunusobod 7-mavze 41',
      region: null,
      previousSchool: null,
      diagnosticScore: null,
      scholarship: { type: 'none', coverage: null, amount: null },
      consentSignedOn: null,
      contract: { number: `AU-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives: relativesInput(),
      ...overrides,
    };
  }

  async function student(branch = '', overrides: Record<string, unknown> = {}) {
    const response = await t.postStudent(branch || t.north, studentBody(overrides));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body);
  }

  /** Every row of both logs: what a refused show leaves as it was. */
  async function logs(): Promise<unknown[]> {
    return [
      (await sql`select * from audit_log order by id`.execute(t.database.migrator)).rows,
      (await sql`select * from audit_log_school order by id`.execute(t.database.migrator)).rows,
    ];
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
    principalAndVice = (
      await signedIn('Feruza', 'Nazarova', ['principal', 'academic_vice_principal'], t.north)
    ).cookie;
    headTutor = (await signedIn('Lola', 'Rahimova', ['head_tutor'], t.north)).cookie;
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the branch of the request (done when: a Principal sees only the branch log)', () => {
    let record: string;
    let northEntry: string;
    let southEntry: string;
    let schoolEntry: string;

    beforeAll(async () => {
      record = await newId();
      northEntry = await entry({
        branch: t.north,
        action: 'room.edit',
        record: { type: 'room', id: record },
      });
      southEntry = await entry({
        branch: t.south,
        action: 'room.edit',
        record: { type: 'room', id: record },
      });
      schoolEntry = await entry({
        branch: null,
        action: 'room.edit',
        record: { type: 'room', id: record },
      });
    });

    it.each([
      ['the Principal', () => t.principal],
      ['the Academic Vice Principal', () => t.vicePrincipal],
      ['the Super Admin', () => t.admin],
    ])('shows %s the entries of the branch and none of another', async (_name, cookie) => {
      expect(ids(await readAll(ofRecord(record), cookie()))).toEqual([northEntry]);
    });

    it('never shows the Principal an entry of another branch, on any page', async () => {
      await entry({ branch: t.south, action: 'branch.edit' });
      const all = await readAll({ from: '2026-09-11', to: '2026-10-10' }, t.principal);
      expect(all.length).toBeGreaterThan(0);
      expect(all.every((one) => one.branchId === t.north || one.branchId === null)).toBe(true);
    });

    it('gives the Super Admin every branch and the school-wide log by scope', async () => {
      // The page follows this answer for the choice of log, not the role shown.
      expect(page(await t.get('/api/audit/entries', t.north, t.admin)).chooseScope).toBe(true);
      expect(page(await t.get('/api/audit/entries', t.north, principalAndVice)).chooseScope).toBe(
        false,
      );
      expect(ids(await readAll({ ...ofRecord(record), scope: 'all' }, t.admin))).toEqual(
        [northEntry, southEntry, schoolEntry].sort(),
      );
      expect(ids(await readAll({ ...ofRecord(record), scope: 'school' }, t.admin))).toEqual([
        schoolEntry,
      ]);
      const all = await readAll({ ...ofRecord(record), scope: 'all' }, t.admin);
      expect(all.find((one) => one.id === southEntry)?.branchId).toBe(t.south);
      expect(all.find((one) => one.id === schoolEntry)?.branchId).toBeNull();
    });

    it.each(['all', 'school'])(
      'refuses the scope %s to the Principal and the Academic Vice Principal',
      async (scope) => {
        for (const cookie of [t.principal, t.vicePrincipal, principalAndVice]) {
          refusedWith(
            await t.get(`/api/audit/entries?scope=${scope}`, t.north, cookie),
            403,
            'permission_denied',
          );
        }
      },
    );

    it('refuses the roles without the area', async () => {
      for (const cookie of [t.teacher, headTutor]) {
        refusedWith(await t.get('/api/audit/entries', t.north, cookie), 403, 'permission_denied');
      }
    });
  });

  describe('the school-wide entries a branch reads (decision 3 with correction 1)', () => {
    it('shows the entries written from the branch, and none without a branch', async () => {
      const record = await newId();
      const relative = { type: 'relative', id: record };
      const ofNorth = await entry({
        branch: null,
        action: 'relative.phone_released',
        record: relative,
        details: { branchId: t.north },
      });
      const sameNorth = await entry({
        branch: null,
        action: 'relative.same_person',
        record: relative,
        details: { branchId: t.north },
      });
      await entry({
        branch: null,
        action: 'relative.merge',
        record: relative,
        details: { branchId: t.south },
      });
      for (const cookie of [t.principal, t.vicePrincipal]) {
        expect(ids(await readAll(ofRecord(record, 'relative'), cookie))).toEqual(
          [ofNorth, sameNorth].sort(),
        );
      }
    });

    it.each([
      ['a sign-in', 'auth.sign_in', 'session'],
      ['an account created', 'account.create', 'account'],
      ['a travel time', 'travel_time.set', 'branch'],
      ['a subject', 'subject.edit', 'subject'],
    ])(
      'does not show %s to the branch, and shows it to the Super Admin',
      async (_name, action, type) => {
        const record = await newId();
        const id = await entry({ branch: null, action, record: { type, id: record } });
        for (const cookie of [t.principal, t.vicePrincipal]) {
          expect(await readAll(ofRecord(record, type), cookie)).toEqual([]);
        }
        expect(ids(await readAll({ ...ofRecord(record, type), scope: 'school' }, t.admin))).toEqual(
          [id],
        );
      },
    );

    it('shows a relative entry of another branch only while a link to the branch was live', async () => {
      // A second relative, not the main contact: the student keeps a live link.
      const [main] = relativesInput();
      const created = await student('', {
        relatives: [
          main,
          {
            kind: 'new',
            relative: { fullName: 'Sardor Qodirov', phone: null, workplace: '', email: '' },
            relationship: 'father',
            mainContact: false,
            portalAccess: true,
            receivesNotices: true,
          },
        ],
      });
      const link = await t.database.migrator
        .selectFrom('student_relatives as l')
        .innerJoin('relatives as r', 'r.id', 'l.relative_id')
        .select(['l.relative_id', 'l.id'])
        .where('l.student_id', '=', created.id)
        .where('r.full_name', '=', 'Sardor Qodirov')
        .executeTakeFirstOrThrow();
      const relative = { type: 'relative', id: link.relative_id };
      // linked at 18:55 UTC; unlinked at 18:57 by the owner of the tables.
      const before = await entry({
        branch: null,
        action: 'relative.edit',
        record: relative,
        details: { branchId: t.south },
        at: '2026-10-10T18:50:00Z',
      });
      const during = await entry({
        branch: null,
        action: 'relative.edit',
        record: relative,
        details: { branchId: t.south },
        at: '2026-10-10T18:56:00Z',
      });
      // The unlink guard compares with `app.now` (db/migrations/0036).
      await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`select set_config('app.now', '2026-10-10T18:57:00Z', true)`.execute(transaction);
        await transaction
          .updateTable('student_relatives')
          .set({ unlinked_at: new Date('2026-10-10T18:57:00Z') })
          .where('id', '=', link.id)
          .execute();
      });
      const after = await entry({
        branch: null,
        action: 'relative.edit',
        record: relative,
        details: { branchId: t.south },
        at: '2026-10-10T18:58:00Z',
      });
      const seen = ids(await readAll(ofRecord(link.relative_id, 'relative'), t.principal));
      expect(seen).toContain(during);
      expect(seen).not.toContain(before);
      expect(seen).not.toContain(after);
    });

    it('does not show a relative linked only in another branch', async () => {
      const created = await student(t.south);
      const link = await t.database.migrator
        .selectFrom('student_relatives')
        .select('relative_id')
        .where('student_id', '=', created.id)
        .executeTakeFirstOrThrow();
      const id = await entry({
        branch: null,
        action: 'relative.edit',
        record: { type: 'relative', id: link.relative_id },
        details: { branchId: t.south },
        at: '2026-10-10T18:56:00Z',
      });
      expect(await readAll(ofRecord(link.relative_id, 'relative'), t.principal)).toEqual([]);
      expect(
        ids(await readAll({ ...ofRecord(link.relative_id, 'relative'), scope: 'all' }, t.admin)),
      ).toContain(id);
    });
  });

  describe('search (decision 5)', () => {
    it('finds a staff member as the actor or as the person, and names them', async () => {
      const account = (await t.kit.newAccount('Nodira', 'Yoqubova')).id;
      const staff = await personOf(account, t.north, 'Nodira', 'Yoqubova');
      const acted = await entry({ branch: t.north, action: 'room.create', actor: account });
      const about = await entry({ branch: t.north, action: 'staff.edit', person: staff });
      await entry({ branch: t.north, action: 'room.create' });
      const found = await readAll({ person: `staff:${staff}` }, t.principal);
      expect(ids(found)).toEqual([acted, about].sort());
      expect(found.find((one) => one.id === acted)?.actor).toEqual({
        id: account,
        name: 'Yoqubova Nodira',
      });
      expect(found.find((one) => one.id === about)?.person?.name).toBe('Yoqubova Nodira');
    });

    it('finds a student and a relative by record or person', async () => {
      const someone = await newId();
      const byRecord = await entry({
        branch: t.north,
        action: 'student.photo',
        record: { type: 'student', id: someone },
      });
      const byPerson = await entry({ branch: t.north, action: 'relative.link', person: someone });
      expect(ids(await readAll({ person: `student:${someone}` }, t.principal))).toEqual(
        [byRecord, byPerson].sort(),
      );
      expect(ids(await readAll({ person: `relative:${someone}` }, t.principal))).toEqual([
        byPerson,
      ]);
    });

    it('reads the dates in the time zone of the branch, both ends included', async () => {
      const record = await newId();
      const late = await entry({
        branch: t.north,
        action: 'room.edit',
        record: { type: 'room', id: record },
        at: '2026-10-05T18:30:00Z',
      });
      const nextDay = await entry({
        branch: t.north,
        action: 'room.edit',
        record: { type: 'room', id: record },
        at: '2026-10-05T19:10:00Z',
      });
      const early = await entry({
        branch: t.north,
        action: 'room.edit',
        record: { type: 'room', id: record },
        at: '2026-10-04T19:00:00Z',
      });
      expect(
        ids(
          await readAll({ ...ofRecord(record), from: '2026-10-05', to: '2026-10-05' }, t.principal),
        ),
      ).toEqual([early, late].sort());
      expect(
        ids(
          await readAll({ ...ofRecord(record), from: '2026-10-06', to: '2026-10-06' }, t.principal),
        ),
      ).toEqual([nextDay]);
    });

    it('searches the last 30 days by default and refuses a longer range', async () => {
      const record = await newId();
      const recent = await entry({
        branch: t.north,
        action: 'room.edit',
        record: { type: 'room', id: record },
        at: '2026-09-11T00:00:00+05:00',
      });
      await entry({
        branch: t.north,
        action: 'room.edit',
        record: { type: 'room', id: record },
        at: '2026-09-10T23:59:00+05:00',
      });
      const found = page(
        await t.get(`/api/audit/entries?${query(ofRecord(record))}`, t.north, t.principal),
      );
      expect(found).toMatchObject({ from: '2026-09-11', to: '2026-10-10' });
      expect(ids(found.entries)).toEqual([recent]);
      const long = await t.get(
        '/api/audit/entries?from=2025-10-01&to=2026-10-10',
        t.north,
        t.principal,
      );
      refusedWith(long, 400, 'validation_failed');
      refusedWith(
        await t.get('/api/audit/entries?from=2026-10-20', t.north, t.principal),
        400,
        'validation_failed',
      );
      // One end left out: the other is the default, and the limit still holds.
      refusedWith(
        await t.get('/api/audit/entries?from=2025-10-09', t.north, t.principal),
        400,
        'validation_failed',
      );
      page(await t.get('/api/audit/entries?from=2025-10-10', t.north, t.principal));
      refusedWith(
        await t.get('/api/audit/entries?person=teacher:' + UNKNOWN, t.north, t.principal),
        400,
        'validation_failed',
      );
    });

    it('filters by group', async () => {
      const record = await newId();
      const exported = await entry({
        branch: t.north,
        action: 'room.export',
        record: { type: 'room', id: record },
      });
      await entry({ branch: t.north, action: 'room.edit', record: { type: 'room', id: record } });
      expect(ids(await readAll({ ...ofRecord(record), group: 'exports' }, t.principal))).toEqual([
        exported,
      ]);
    });

    it('pages 50 at a time, each entry once, newest first', async () => {
      const record = await newId();
      const written: string[] = [];
      for (let index = 0; index < 120; index += 1) {
        written.push(
          await entry({
            branch: t.north,
            action: 'room.edit',
            record: { type: 'room', id: record },
            // Two entries share each moment: the id decides between them.
            at: new Date(
              Date.parse('2026-10-08T00:00:00Z') + Math.floor(index / 2) * 1000,
            ).toISOString(),
          }),
        );
      }
      const first = page(
        await t.get(`/api/audit/entries?${query(ofRecord(record))}`, t.north, t.principal),
      );
      expect(first.entries).toHaveLength(50);
      expect(first.next).not.toBeNull();
      const all = await readAll(ofRecord(record), t.principal);
      expect(all).toHaveLength(120);
      expect(ids(all)).toEqual([...written].sort());
      const moments = all.map((one) => `${one.occurredAt}_${one.id}`);
      expect(moments).toEqual([...moments].sort().reverse());
    });
  });

  describe('identity hidden from a reader without it (decision 6)', () => {
    let created: StudentDetail;
    let createEntry: string;

    beforeAll(async () => {
      created = await student();
      createEntry = String((await t.entries('student.create', created.id))[0]?.id);
    });

    const oneEntry = async (id: string, cookie: string) => {
      const [found] = (await readAll(ofRecord(created.id, 'student'), cookie)).filter(
        (one) => one.id === id,
      );
      if (found === undefined) {
        throw new Error('The entry is read.');
      }
      return found;
    };

    it('hides the address and the date of birth of a student entry from the Principal only', async () => {
      const hidden = await oneEntry(createEntry, t.principal);
      expect(JSON.stringify(hidden)).not.toContain('Yunusobod 7-mavze 41');
      expect(JSON.stringify(hidden)).not.toContain('2013-07-19');
      expect(hidden.hidden.length).toBeGreaterThan(0);
      expect(JSON.stringify(hidden)).toContain('Madina');
      for (const cookie of [t.vicePrincipal, t.admin, principalAndVice]) {
        const plain = await oneEntry(createEntry, cookie);
        expect(JSON.stringify(plain)).toContain('Yunusobod 7-mavze 41');
        expect(plain.hidden).toEqual([]);
      }
    });

    it('hides the raw row of a deleted student', async () => {
      const twice = await student();
      const response = await t.post(
        `/api/people/students/${twice.id}/delete`,
        t.north,
        { reason: 'Created twice by mistake.', version: twice.version },
        t.vicePrincipal,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(204);
      const [deleted] = (await readAll(ofRecord(twice.id, 'student'), t.principal)).filter(
        (one) => one.action === 'student.delete',
      );
      expect(deleted).toBeDefined();
      expect(JSON.stringify(deleted)).not.toContain('Yunusobod 7-mavze 41');
      expect(JSON.stringify(deleted)).not.toContain('2013-07-19');
      expect(deleted?.hidden).toEqual(
        expect.arrayContaining(['oldValue.student.address', 'oldValue.student.birth_date']),
      );
    });

    it('hides the date of birth of a staff entry and the workplace of a relative', async () => {
      const staff = await personOf(null, t.north, 'Sevara', 'Olimova');
      const staffEntry = await entry({
        branch: t.north,
        action: 'staff.create',
        person: staff,
        newValue: {
          staffId: 'S-268999',
          firstName: 'Sevara',
          birthDate: '1988-03-04',
          jshshir: '30403880000011',
        },
      });
      const relative = await newId();
      const relativeEntry = await entry({
        branch: null,
        action: 'relative.edit',
        record: { type: 'relative', id: relative },
        details: { branchId: t.north },
        oldValue: {
          workplace: 'Chorsu bozori',
          email: 'old@example.uz',
          fullName: 'Zarina Aliyeva',
        },
        newValue: { workplace: 'Navbahor dorixonasi', email: 'new@example.uz' },
      });
      const [seenStaff] = (await readAll({ person: `staff:${staff}` }, t.principal)).filter(
        (one) => one.id === staffEntry,
      );
      expect(seenStaff?.newValue).toEqual({
        staffId: 'S-268999',
        firstName: 'Sevara',
        birthDate: null,
        jshshir: null,
      });
      expect(seenStaff?.hidden.sort()).toEqual(['newValue.birthDate', 'newValue.jshshir']);
      const [seenRelative] = await readAll(ofRecord(relative, 'relative'), t.principal);
      expect(seenRelative?.id).toBe(relativeEntry);
      expect(seenRelative?.oldValue).toEqual({
        workplace: null,
        email: null,
        fullName: 'Zarina Aliyeva',
      });
    });

    it('hides the typed search of an export', async () => {
      const exported = await entry({
        branch: t.north,
        action: 'student.export',
        details: { list: 'students', search: 'AA7654321', filters: {}, columns: ['name'], rows: 1 },
      });
      const [seen] = (await readAll({ group: 'exports' }, t.principal)).filter(
        (one) => one.id === exported,
      );
      expect(seen?.details).toMatchObject({ search: null, rows: 1, list: 'students' });
      expect(seen?.hidden).toEqual(['details.search']);
      const [plain] = (await readAll({ group: 'exports' }, t.vicePrincipal)).filter(
        (one) => one.id === exported,
      );
      expect(plain?.details).toMatchObject({ search: 'AA7654321' });
    });

    it('shows the hidden values to the Principal and logs the show', async () => {
      const response = await t.post(
        `/api/audit/entries/${createEntry}/show`,
        t.north,
        {},
        t.principal,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const shown = auditEntrySchema.parse(response.body);
      expect(JSON.stringify(shown)).toContain('Yunusobod 7-mavze 41');
      expect(shown.hidden).toEqual([]);
      const logged = await t.entries('audit.entry_shown', created.id);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({
        branch_id: t.north,
        record_type: 'student',
        record_id: created.id,
      });
      expect(logged[0]?.details).toMatchObject({
        entryId: createEntry,
        entryAction: 'student.create',
      });
      // A search by the student finds who looked.
      expect(
        (await readAll(ofRecord(created.id, 'student'), t.admin)).some(
          (one) => one.action === 'audit.entry_shown',
        ),
      ).toBe(true);
    });

    it('logs nothing when nothing was hidden from the reader', async () => {
      const before = await logs();
      const response = await t.post(
        `/api/audit/entries/${createEntry}/show`,
        t.north,
        {},
        t.vicePrincipal,
      );
      expect(response.status).toBe(200);
      // The Super Admin reads the entry of the branch, nothing hidden, nothing logged.
      const admin = await t.post(`/api/audit/entries/${createEntry}/show`, t.north, {}, t.admin);
      expect(admin.status).toBe(200);
      expect(JSON.stringify(admin.body)).toContain('Yunusobod 7-mavze 41');
      expect(await logs()).toEqual(before);
    });

    it('answers 404 to an entry the reader may not read, and logs nothing', async () => {
      const south = await entry({
        branch: t.south,
        action: 'student.create',
        newValue: { address: 'x' },
      });
      const signIn = await entry({
        branch: null,
        action: 'auth.sign_in',
        record: { type: 'session', id: UNKNOWN },
      });
      // A school-wide entry written from another branch, and one about a
      // relative never linked in the branch (decision 3, correction 1).
      const southSchool = await entry({
        branch: null,
        action: 'relative.edit',
        record: { type: 'relative', id: await newId() },
        details: { branchId: t.south },
        newValue: { workplace: 'Chorsu' },
      });
      const before = await logs();
      for (const id of [UNKNOWN, south, signIn, southSchool]) {
        refusedWith(
          await t.post(`/api/audit/entries/${id}/show`, t.north, {}, t.principal),
          404,
          'not_found',
        );
      }
      // The Super Admin too is held to the branch of the request.
      for (const id of [UNKNOWN, south, southSchool]) {
        refusedWith(
          await t.post(`/api/audit/entries/${id}/show`, t.north, {}, t.admin),
          404,
          'not_found',
        );
      }
      expect(await logs()).toEqual(before);
    });
  });

  describe('names and assignments', () => {
    it('names the role of the assignment that allowed the action', async () => {
      const created = await student();
      const [found] = (await readAll(ofRecord(created.id, 'student'), t.principal)).filter(
        (one) => one.action === 'student.create',
      );
      expect(found?.assignment).toEqual({ id: t.adminAssignment, role: 'super_admin' });
      expect(found?.record).toMatchObject({ type: 'student', id: created.id });
      expect(found?.record?.name).toContain('Madina');
    });

    it('answers only first and last names from audit_names', async () => {
      const account = (await t.kit.newAccount('Umida', 'Sobirova')).id;
      await personOf(account, t.south, 'Umida', 'Sobirova');
      const found = await sql<Record<string, unknown>>`
        select * from audit_names(${[account]}::uuid[])
      `.execute(t.database.app);
      expect(found.rows).toEqual([{ id: account, first_name: 'Umida', last_name: 'Sobirova' }]);
    });
  });

  it('keeps the error shape on a refused query', async () => {
    const response = await t.get('/api/audit/entries?recordType=room', t.north, t.principal);
    expect(response.status).toBe(400);
    expect(apiErrorSchema.safeParse(response.body).success).toBe(true);
  });

  // Edge cases, Personal data and the audit log: "every user sees their own
  // sign-in history"; decisions 10 and 11, correction 3.
  describe('the own sign-in history', () => {
    const history = async (cookie: string, before?: string): Promise<SignInHistory> => {
      const response = await t.kit.get(
        before === undefined
          ? '/api/auth/sign-in-history'
          : `/api/auth/sign-in-history?before=${encodeURIComponent(before)}`,
        cookie,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return signInHistorySchema.parse(response.body);
    };

    const viceAccount = async () =>
      (
        await t.database.migrator
          .selectFrom('assignments')
          .select('account_id')
          .where('id', '=', t.viceAssignment)
          .executeTakeFirstOrThrow()
      ).account_id;

    it('lists the own sign-in with its browser, newest first', async () => {
      const browser = await t.kit.fullSession('Sherzod', 'Tursunov');
      await t.kit.giveRole(browser.account.id, { role: 'teacher', branchId: t.north });
      const again = await t.kit
        .signIn(browser.account.login, NEW_PASSWORD)
        .set('User-Agent', 'Probe browser 1.0');
      expect(again.status).toBe(200);
      const found = await history(browser.cookie);
      const actions = found.events.map((event) => event.action);
      expect(actions).toEqual(expect.arrayContaining(['auth.sign_in', 'auth.password_change']));
      expect(found.events.some((event) => event.browser === 'Probe browser 1.0')).toBe(true);
      expect(found.events.every((event) => event.by === null)).toBe(true);
      const moments = found.events.map((event) => `${event.occurredAt}_${event.id}`);
      expect(moments).toEqual([...moments].sort().reverse());
    });

    it('shows a reset made from a branch with the administrator, and no reason', async () => {
      const browser = await t.kit.fullSession('Nigora', 'Hamidova');
      const vice = await viceAccount();
      if (
        (await t.database.migrator
          .selectFrom('staff')
          .select('id')
          .where('account_id', '=', vice)
          .executeTakeFirst()) === undefined
      ) {
        await personOf(vice, t.north, 'Dilnoza', 'Saidova');
      }
      const reset = await entry({
        branch: t.north,
        action: 'account.password_reset',
        actor: vice,
        record: { type: 'account', id: browser.account.id },
        at: '2026-10-10T18:54:00Z',
      });
      const locked = await entry({
        branch: t.south,
        action: 'account.locked',
        actor: vice,
        record: { type: 'account', id: browser.account.id },
        reason: 'Dismissed today.',
        at: '2026-10-10T18:53:00Z',
      });
      const found = await history(browser.cookie);
      expect(found.events.find((event) => event.id === reset)).toMatchObject({
        action: 'account.password_reset',
        by: 'Saidova Dilnoza',
      });
      expect(found.events.find((event) => event.id === locked)?.by).toBe('Saidova Dilnoza');
      expect(JSON.stringify(found)).not.toContain('Dismissed today.');
    });

    it('never shows an administrator what they did to another account, nor another account\x27s sign-in', async () => {
      const vice = await viceAccount();
      const other = await t.kit.fullSession('Bekzod', 'Ismoilov');
      const lockedOther = await entry({
        branch: t.north,
        action: 'account.locked',
        actor: vice,
        record: { type: 'account', id: other.account.id },
      });
      const resetOther = await entry({
        branch: null,
        action: 'account.second_step_reset',
        actor: vice,
        record: { type: 'account', id: other.account.id },
      });
      const otherSignIns = await t.database.migrator
        .selectFrom('audit_log_school')
        .select('id')
        .where('actor_id', '=', other.account.id)
        .execute();
      expect(otherSignIns.length).toBeGreaterThan(0);
      const seen = [];
      let before: string | undefined;
      for (;;) {
        const found = await history(t.vicePrincipal, before);
        seen.push(...found.events.map((event) => event.id));
        if (found.next === null) {
          break;
        }
        before = found.next;
      }
      expect(seen).not.toContain(lockedOther);
      expect(seen).not.toContain(resetOther);
      for (const row of otherSignIns) {
        expect(seen).not.toContain(row.id);
      }
      expect((await history(other.cookie)).events.map((event) => event.id)).toEqual(
        expect.arrayContaining([lockedOther, resetOther]),
      );
    });

    it('pages 50 at a time', async () => {
      const browser = await t.kit.fullSession('Ulugbek', 'Sharipov');
      for (let index = 0; index < 60; index += 1) {
        await entry({
          branch: null,
          action: 'auth.sign_in_failed',
          record: { type: 'account', id: browser.account.id },
          at: new Date(Date.parse('2026-10-01T00:00:00Z') + index * 1000).toISOString(),
        });
      }
      const first = await history(browser.cookie);
      expect(first.events).toHaveLength(50);
      expect(first.next).not.toBeNull();
      const second = await history(browser.cookie, first.next ?? undefined);
      const all = [...first.events, ...second.events].map((event) => event.id);
      expect(new Set(all).size).toBe(all.length);
      expect(second.next).toBeNull();
      expect(all.length).toBeGreaterThanOrEqual(62);
    });

    it('answers no name while a sign-in step is still owed, and nothing without a session', async () => {
      // An administrator with a name of their own, written here: the refusal
      // must hold no name whatever ran before.
      const admin = (await t.kit.newAccount('Gavhar', 'Jalilova')).id;
      await personOf(admin, t.north, 'Gavhar', 'Jalilova');
      const resetOf = (accountId: string) =>
        entry({
          branch: t.north,
          action: 'account.password_reset',
          actor: admin,
          record: { type: 'account', id: accountId },
        });

      // A first password not yet changed.
      const first = await t.kit.firstSession('Kamola', 'Hasanova');
      await resetOf(first.account.id);
      const owedPassword = await t.kit.get('/api/auth/sign-in-history', first.cookie);
      refusedWith(owedPassword, 403, 'password_change_required');
      expect(JSON.stringify(owedPassword.body)).not.toContain('Jalilova');

      // A second step set up and not yet passed at a new sign-in.
      const complete = await t.kit.completeSession('Doniyor', 'Saidov');
      await resetOf(complete.account.id);
      const again = await t.kit.signIn(complete.account.login, NEW_PASSWORD);
      expect(again.status).toBe(200);
      const pending = cookieOf(again);
      if (pending === undefined) {
        throw new Error('The sign-in gives a session cookie.');
      }
      const owedStep = await t.kit.get('/api/auth/sign-in-history', pending);
      refusedWith(owedStep, 403, 'second_step_required');
      expect(JSON.stringify(owedStep.body)).not.toContain('Jalilova');
      // The same account, its step passed, reads the name.
      const passed = await history(complete.cookie);
      expect(passed.events.some((event) => event.by === 'Jalilova Gavhar')).toBe(true);

      refusedWith(await t.kit.get('/api/auth/sign-in-history'), 401, 'not_signed_in');
    });
  });
});

// Pull request #75, spec review of the build: the two copies of the events of
// the own history, the SQL of 0039 and SIGN_IN_HISTORY_ACTIONS, are the same;
// and only the tests write the `test.*` actions that have no name on screen.
describe('the lists of the audit log', () => {
  it('holds the same events of the own history in the database and in packages/shared', async () => {
    const database = await createTestDatabase();
    try {
      const found = await sql<{ definition: string }>`
        select pg_get_functiondef('own_sign_in_history'::regproc) as definition
      `.execute(database.migrator);
      const definition = found.rows[0]?.definition ?? '';
      const listed = definition.slice(definition.indexOf('e.action in ('));
      const actions = [...listed.slice(0, listed.indexOf(')')).matchAll(/'([a-z_.]+)'/g)].map(
        (match) => match[1],
      );
      expect([...actions].sort()).toEqual([...SIGN_IN_HISTORY_ACTIONS].sort());
    } finally {
      await database.destroy();
    }
  });

  it('writes a test action from the tests only', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const offending: string[] = [];
    const walk = (folder: string): void => {
      for (const item of readdirSync(folder, { withFileTypes: true })) {
        const full = path.join(folder, item.name);
        if (item.isDirectory()) {
          if (item.name !== 'testing') {
            walk(full);
          }
        } else if (item.name.endsWith('.ts') && !item.name.endsWith('.test.ts')) {
          if (/action:\s*[`'"]test\./.test(readFileSync(full, 'utf8'))) {
            offending.push(path.relative(root, full));
          }
        }
      }
    };
    walk(root);
    expect(offending).toEqual([]);
  });
});
