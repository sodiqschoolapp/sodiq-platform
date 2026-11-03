import {
  BRANCH_HEADER,
  STUDENT_IMPORT_TYPES,
  staffImportConfirmResultSchema,
  staffImportPreviewSchema,
  type StaffImportConfirmResult,
  type StaffImportPreview,
  type StaffImportPreviewRow,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ShippingLogger } from '../../monitoring/monitoring.service.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import {
  filledStaffTemplate,
  staffRow,
  type StaffTemplateRow,
} from '../../testing/staff-import-kit.js';
import { PREVIEW_PASSWORD_HASH } from '../auth/accounts.service.js';
import { verifyPassword } from '../auth/password-hash.js';
import { UploadedFile } from '../../http/file-routes.js';
import { StaffImports } from './staff-imports.service.js';
import { staffIdOf } from './staff-numbers.js';
import type { Access } from '../access/permission.guard.js';

const XLSX = STUDENT_IMPORT_TYPES[0] ?? '';

// All names are invented. Task 9.4h (the owner's spec change of 3 November
// 2026); docs/spec/04-people.md, Teacher and staff record: the import;
// docs/spec/edge-cases/people-roles-accounts.md (the staff import row, the
// re-hire row, the one-department row, the staff ID row); the plan approved on
// pull request #279 with its corrections. The clock stands at 23:55 on 10
// October 2026 in Tashkent.
describe('the staff import', () => {
  let t: DayTemplatesKit;
  let academic: string;
  let steam: string;
  let count = 0;

  const upload = (bytes: Buffer, cookie = t.admin, branch = '') =>
    request(t.kit.server)
      .put('/api/people/staff/imports')
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch || t.north)
      .set('Content-Type', XLSX)
      .send(bytes);

  async function uploaded(rows: readonly StaffTemplateRow[], branch = '') {
    const response = await upload(await filledStaffTemplate(rows), t.admin, branch);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return staffImportPreviewSchema.parse(response.body);
  }

  const preview = (id: string, decisions: object = {}, cookie = t.admin, branch = '') =>
    t.post(`/api/people/staff/imports/${id}/preview`, branch || t.north, decisions, cookie);

  const confirm = (id: string, decisions: object = {}, cookie = t.admin, branch = '') =>
    t.post(`/api/people/staff/imports/${id}/confirm`, branch || t.north, decisions, cookie);

  async function confirmed(id: string, decisions: object = {}): Promise<StaffImportConfirmResult> {
    const response = await confirm(id, decisions);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return staffImportConfirmResultSchema.parse(response.body);
  }

  async function saved(id: string, decisions: object = {}) {
    const result = await confirmed(id, decisions);
    if (result.outcome !== 'saved') {
      throw new Error(`Not saved: ${JSON.stringify(result.preview.rows)}`);
    }
    return result;
  }

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  const rowAt = (answer: StaffImportPreview, rowNumber: number): StaffImportPreviewRow => {
    const row = answer.rows.find((one) => one.rowNumber === rowNumber);
    if (row === undefined) {
      throw new Error(`Row ${String(rowNumber)} is in the preview.`);
    }
    return row;
  };

  const codesAt = (answer: StaffImportPreview, rowNumber: number) =>
    rowAt(answer, rowNumber).problems.map((one) => `${String(one.column)}:${one.code}`);

  /** Every row of the tables a confirm writes, in both branches, and the log: what a refused one leaves. */
  const rowsOf = () =>
    Promise.all(
      [
        'staff',
        'staff_branches',
        'staff_divisions',
        'staff_subjects',
        'staff_languages',
        'staff_statuses',
        'staff_id_counters',
        'accounts',
        'assignments',
        'sessions',
        'notifications',
        'staff_imports',
        'audit_log',
      ].map(
        async (table) =>
          (await sql`select * from ${sql.table(table)} order by 1`.execute(t.database.migrator))
            .rows,
      ),
    );

  const jobsOf = async () =>
    (await sql`select count(*)::int as n from pgboss.job`.execute(t.database.migrator)).rows;

  const staffByPhone = (phone: number) =>
    t.database.migrator
      .selectFrom('staff')
      .select(['id', 'staff_id', 'account_id'])
      .where('phone', '=', `+${String(phone)}`)
      .executeTakeFirst();

  async function subject(en: string, department: string, grades: number[], uz = en, ru = en) {
    await t.database.migrator
      .insertInto('subjects')
      .values({
        name_uz: uz,
        name_ru: ru,
        name_en: en,
        department_id: await departmentId(department),
        grades,
        colour: 'blue',
        journal_type: 'graded',
      })
      .execute();
  }

  const departmentId = async (en: string) =>
    (
      await t.database.migrator
        .selectFrom('departments')
        .select('id')
        .where('name_en', '=', en)
        .executeTakeFirstOrThrow()
    ).id;

  /** A staff person of the north written by the migrator, active or left. */
  async function staffMember(options: { phone?: string; jshshir?: string; left?: boolean } = {}) {
    count += 1;
    return t.database.migrator.transaction().execute(async (transaction) => {
      const row = await transaction
        .insertInto('staff')
        .values({
          kind: 'person',
          staff_id: staffIdOf(2025, 9000 + count),
          first_name: 'Rustam',
          last_name: `Nazarov${String.fromCharCode(97 + count)}`,
          sex: 'male',
          birth_date: '1985-03-04',
          phone: options.phone ?? `+99894${String(7100000 + count)}`,
          jshshir: options.jshshir ?? null,
          admission_date: '2025-09-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: row.id, branch_id: t.north, is_main: true })
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
                  valid_from: '2025-09-01',
                  valid_until: '2026-06-01',
                },
                { staff_id: row.id, status: 'left', valid_from: '2026-06-01' },
              ]
            : [{ staff_id: row.id, status: 'active', valid_from: '2025-09-01' }],
        )
        .execute();
      return row.id;
    });
  }

  /** A staff person linked to the south only, written by the migrator. */
  async function southMember(values: {
    phone: string;
    jshshir?: string;
    firstName?: string;
    lastName?: string;
    birthDate?: string;
  }) {
    count += 1;
    return t.database.migrator.transaction().execute(async (transaction) => {
      const row = await transaction
        .insertInto('staff')
        .values({
          kind: 'person',
          staff_id: staffIdOf(2025, 9800 + count),
          first_name: values.firstName ?? 'Sanjar',
          last_name: values.lastName ?? 'Janubiy',
          sex: 'male',
          birth_date: values.birthDate ?? '1980-01-01',
          phone: values.phone,
          jshshir: values.jshshir ?? null,
          admission_date: '2025-09-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: row.id, branch_id: t.south, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({ staff_id: row.id, division_id: academic, department_id: steam, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: row.id, status: 'active', valid_from: '2025-09-01' })
        .execute();
      return row.id;
    });
  }

  /** A student of a branch with one relative of the phone given (the relative is linked there only). */
  async function studentWithRelative(branch: string, phone: string, n: number) {
    const student = await t.postStudent(
      branch,
      {
        uid: String(2690100 + n),
        firstName: 'Madina',
        lastName: 'Ota-onaliyeva',
        paternalName: '',
        sex: 'female',
        birthDate: '2013-04-04',
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
        contract: { number: `SI-2026/${String(100 + n)}`, signedOn: '2026-08-20' },
        relatives: [
          {
            kind: 'new',
            relative: {
              fullName: 'Rustam Otaev',
              phone,
              workplace: null,
              email: 'r.otaev@example.uz',
            },
            relationship: 'father',
            mainContact: true,
            portalAccess: true,
            receivesNotices: true,
          },
        ],
      },
      t.admin,
    );
    expect(student.status, JSON.stringify(student.body)).toBe(201);
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
    steam = await departmentId('STEAM');
    // A year of the north, so that a student joins the kit's class (the same-person case).
    await new ClassesKit(t.database.migrator).year(t.north);
    await new ClassesKit(t.database.migrator).year(t.south);
    await subject(
      'Mathematics',
      'STEAM',
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      'Matematika',
      'Математика',
    );
    await subject('Physics', 'Natural sciences', [7, 8, 9, 10, 11], 'Fizika', 'Физика');
    await subject('Native language', 'National', [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    await subject('Reading', 'General', [1, 2, 3, 4]);
    await subject('Informatics', 'STEAM', [5, 6, 7, 8, 9, 10, 11]);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the Done-when cases', () => {
    it('saves 20 teachers in one confirm with staff IDs, accounts, roles and slips', async () => {
      const rows = Array.from({ length: 20 }, (_, index) =>
        staffRow(
          index === 0
            ? {
                // One teacher of grade 1 with three subjects of three departments (task 9.4e,
                // decision 1: subjects taught only in grades 0–4 may come from any department).
                subject1: 'Mathematics: 1',
                subject2: 'Native language: 1',
                subject3: 'Reading: 1',
              }
            : index < 3
              ? // Two Tutors teach a subject of their department; Tutor subjects come with a class.
                { role: 'Tutor', subject1: 'Informatics: 7, 8' }
              : {},
        ),
      );
      const answer = await uploaded(rows);
      expect(answer.clean, JSON.stringify(answer.rows)).toBe(true);
      expect(answer.rows.every((row) => row.login !== null)).toBe(true);
      // The process's logger, as main.ts sets it, catches every line the confirm writes.
      const lines: string[] = [];
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      Logger.overrideLogger(new ShippingLogger());
      ShippingLogger.sink = (_level, text) => {
        lines.push(text);
      };
      let result: Awaited<ReturnType<typeof saved>>;
      try {
        result = await saved(answer.importId);
      } finally {
        ShippingLogger.sink = undefined;
        vi.restoreAllMocks();
      }
      expect(result.created).toBe(20);
      // No password is in a log line or in the audit log (`edge/people-roles-accounts`: "not stored").
      const audit = JSON.stringify(
        (await sql`select * from audit_log`.execute(t.database.migrator)).rows,
      );
      for (const one of result.slips) {
        expect(lines.join('\n')).not.toContain(one.password);
        expect(audit).not.toContain(one.password);
      }
      expect(result.slips).toHaveLength(20);
      // Staff IDs in the order of the rows, from the counter of 2026.
      const numbers = result.staff.map((one) => Number(one.staffId.slice(4)));
      expect(result.staff.every((one) => one.staffId.startsWith('S-26'))).toBe(true);
      expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
      const roles = await t.database.migrator
        .selectFrom('assignments')
        .innerJoin('staff', 'staff.account_id', 'assignments.account_id')
        .select(['assignments.role', 'assignments.branch_id'])
        .where(
          'staff.id',
          'in',
          result.staff.map((one) => one.id),
        )
        .execute();
      expect(roles.filter((one) => one.role === 'teacher')).toHaveLength(18);
      expect(roles.filter((one) => one.role === 'tutor')).toHaveLength(2);
      expect(roles.every((one) => one.branch_id === t.north)).toBe(true);
      // A slip's password is the account's first password, valid for 7 days, to be changed.
      const slip = result.slips[0];
      const account = await t.database.migrator
        .selectFrom('accounts')
        .select(['password_hash', 'must_change_password', 'password_expires_at'])
        .where('login', '=', slip?.login ?? '')
        .executeTakeFirstOrThrow();
      expect(await verifyPassword(account.password_hash, slip?.password ?? '')).toBe(true);
      // It signs in through the route and asks the change first.
      const signedIn = await t.kit.signIn(slip?.login ?? '', slip?.password ?? '');
      expect(signedIn.status).toBe(200);
      expect((signedIn.body as { mustChangePassword: boolean }).mustChangePassword).toBe(true);
      expect(account.must_change_password).toBe(true);
      expect(account.password_expires_at?.toISOString()).toBe(slip?.validUntil);
      // The grade 1 teacher has the three subjects.
      const first = result.staff[0];
      const subjects = await t.database.migrator
        .selectFrom('staff_subjects')
        .innerJoin('subjects', 'subjects.id', 'staff_subjects.subject_id')
        .select(['subjects.name_en', 'staff_subjects.grades'])
        .where('staff_subjects.staff_id', '=', first?.id ?? UNKNOWN)
        .orderBy('subjects.name_en')
        .execute();
      expect(subjects).toEqual([
        { name_en: 'Mathematics', grades: [1] },
        { name_en: 'Native language', grades: [1] },
        { name_en: 'Reading', grades: [1] },
      ]);
      // One entry of each hand step per record, with the import named on the create.
      const creates = await t.entries('staff.create');
      expect(
        creates.filter(
          (entry) =>
            (entry.new_value as { importId?: string } | null)?.importId === answer.importId,
        ),
      ).toHaveLength(20);
      expect(await t.entries('staff_import.confirm', answer.importId)).toHaveLength(1);
    });

    it('saves nothing for a Super Admin role, a phone of another staff record and two departments, and lists the three rows', async () => {
      await staffMember({ phone: '+998941234500' });
      const rows = [
        staffRow(),
        staffRow(),
        staffRow({ role: 'Super Admin' }),
        staffRow({ phone: '+998 94 123 45 00' }),
        staffRow({ subject1: 'Mathematics: 5-7', subject2: 'Physics: 8' }),
      ];
      const answer = await uploaded(rows);
      expect(answer.clean).toBe(false);
      expect(codesAt(answer, 5)).toEqual(['role:import_role_not_allowed']);
      expect(codesAt(answer, 6)).toEqual(['phone:staff_phone_taken']);
      expect(rowAt(answer, 6).problems[0]?.recordId).toBeDefined();
      expect(codesAt(answer, 7)).toEqual(['department:subject_outside_department']);
      expect(codesAt(answer, 3)).toEqual([]);
      const before = await rowsOf();
      const result = await confirmed(answer.importId);
      expect(result.outcome).toBe('not_clean');
      if (result.outcome === 'not_clean') {
        expect(
          result.preview.rows.filter((row) => row.problems.length > 0).map((row) => row.rowNumber),
        ).toEqual([5, 6, 7]);
      }
      // The clean rows above were really written in the run, and rolled back with it.
      expect(await rowsOf()).toEqual(before);
    });

    it('creates nothing when the same clean file is uploaded again', async () => {
      const bytes = await filledStaffTemplate([staffRow(), staffRow({ role: '' })]);
      const first = await upload(bytes);
      expect(first.status).toBe(200);
      await saved(staffImportPreviewSchema.parse(first.body).importId);
      const again = await upload(bytes);
      expect(again.status).toBe(200);
      const second = staffImportPreviewSchema.parse(again.body);
      expect(second.alreadyImportedOn).toBe('2026-10-10');
      const before = await rowsOf();
      refusedWith(await confirm(second.importId), 409, 'import_already_done');
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('the rows', () => {
    it('makes a record without an account for a row without a role', async () => {
      const row = staffRow({ role: '' });
      const answer = await uploaded([row]);
      expect(rowAt(answer, 3).login).toBeNull();
      const result = await saved(answer.importId);
      expect(result.slips).toEqual([]);
      expect((await staffByPhone(Number(row.phone)))?.account_id).toBeNull();
    });

    it('gives the role from the admission date when that is after today', async () => {
      const row = staffRow({ admissionDate: '01.11.2026' });
      const result = await saved((await uploaded([row])).importId);
      const role = await t.database.migrator
        .selectFrom('assignments')
        .select(['valid_from'])
        .where('account_id', '=', (await staffByPhone(Number(row.phone)))?.account_id ?? UNKNOWN)
        .executeTakeFirstOrThrow();
      expect(result.created).toBe(1);
      // 00:00 of 1 November 2026 in Tashkent.
      expect(role.valid_from.toISOString()).toBe('2026-10-31T19:00:00.000Z');
    });

    it('needs the confirm of a name and date of birth warning, naming a record of the branch', async () => {
      const holder = await staffMember();
      const holderRow = await t.database.migrator
        .selectFrom('staff')
        .select(['first_name', 'last_name'])
        .where('id', '=', holder)
        .executeTakeFirstOrThrow();
      const answer = await uploaded([
        staffRow({
          firstName: holderRow.first_name ?? '',
          lastName: holderRow.last_name ?? '',
          birthDate: '04.03.1985',
        }),
      ]);
      const row = rowAt(answer, 3);
      expect(row.problems).toEqual([]);
      expect(row.warning?.records.map((one) => one.id)).toEqual([holder]);
      expect(answer.clean).toBe(false);
      const refused = await confirmed(answer.importId);
      expect(refused.outcome).toBe('not_clean');
      const cleared = staffImportPreviewSchema.parse(
        (await preview(answer.importId, { confirmedWarnings: [3] })).body,
      );
      expect(cleared.clean).toBe(true);
      expect((await saved(answer.importId, { confirmedWarnings: [3] })).created).toBe(1);
    });

    it('warns on the same name and date of birth on two rows and refuses the same phone or JSHSHIR on two', async () => {
      const twin = { firstName: 'Bobur', lastName: 'Egizakov', birthDate: '02.02.1990' };
      const shared = staffRow();
      const answer = await uploaded([
        staffRow(twin),
        staffRow(twin),
        staffRow({ phone: shared.phone }),
        staffRow({ jshshir: '30202900000777' }),
        staffRow({ jshshir: '30202900000777' }),
        shared,
      ]);
      expect(rowAt(answer, 4).warning?.rows).toEqual([3]);
      expect(codesAt(answer, 5)).toEqual(['phone:duplicate_in_file']);
      expect(codesAt(answer, 8)).toEqual(['phone:duplicate_in_file']);
      expect(codesAt(answer, 6)).toEqual(['jshshir:duplicate_in_file']);
      expect(codesAt(answer, 7)).toEqual(['jshshir:duplicate_in_file']);
    });

    it('tells a left record that holds the JSHSHIR, to be re-hired by hand, and saves nothing', async () => {
      const left = await staffMember({ jshshir: '30404850000123', left: true });
      const answer = await uploaded([staffRow(), staffRow({ jshshir: '30404850000123' })]);
      expect(codesAt(answer, 4)).toEqual(['jshshir:already_exists']);
      expect(rowAt(answer, 4).problems[0]).toMatchObject({ recordId: left, left: true });
      const before = await rowsOf();
      expect((await confirmed(answer.importId)).outcome).toBe('not_clean');
      expect(await rowsOf()).toEqual(before);
    });

    it('tells a left record that holds the phone, to be re-hired by hand, and saves nothing', async () => {
      const left = await staffMember({ phone: '+998941234577', left: true });
      const answer = await uploaded([staffRow({ phone: '+998941234577' })]);
      expect(rowAt(answer, 3).problems).toEqual([
        expect.objectContaining({
          column: 'phone',
          code: 'staff_phone_taken',
          recordId: left,
          left: true,
        }),
      ]);
      expect(answer.clean).toBe(false);
    });

    it('tells a phone of a staff record of another branch without naming it', async () => {
      const other = await southMember({ phone: '+998941239900' });
      const answer = await uploaded([staffRow({ phone: '+998941239900' })]);
      const problem = rowAt(answer, 3).problems[0];
      expect(problem).toEqual({ column: 'phone', code: 'staff_phone_taken', elsewhere: true });
      expect(JSON.stringify(answer)).not.toContain(other);
    });

    it('tells a JSHSHIR, a name and date of birth and a relative of another branch without naming them', async () => {
      const jshshirHolder = await southMember({
        phone: '+998941239901',
        jshshir: '30909800000001',
      });
      const namesake = await southMember({
        phone: '+998941239902',
        firstName: 'Temur',
        lastName: 'Janubov',
        birthDate: '1981-02-03',
      });
      await studentWithRelative(t.south, '+998933330099', 1);
      const answer = await uploaded([
        staffRow({ jshshir: '30909800000001' }),
        staffRow({ firstName: 'Temur', lastName: 'Janubov', birthDate: '03.02.1981' }),
        staffRow({ phone: '+998933330099', email: '' }),
      ]);
      expect(rowAt(answer, 3).problems).toEqual([
        { column: 'jshshir', code: 'already_exists', elsewhere: true },
      ]);
      expect(rowAt(answer, 4).warning).toEqual({
        records: [],
        elsewhere: true,
        rows: [],
        confirmed: false,
      });
      expect(rowAt(answer, 5).samePerson).toEqual({ fullName: null });
      const text = JSON.stringify(answer);
      for (const hidden of [jshshirHolder, namesake, 'Rustam Otaev', 'Janubiy']) {
        expect(text).not.toContain(hidden);
      }
    });

    it("marks a staff record whose phone is a relative's main phone as the same person", async () => {
      const phone = '+998933330001';
      const student = await t.postStudent(
        t.north,
        {
          uid: '2690001',
          firstName: 'Madina',
          lastName: 'Ota-onaliyeva',
          paternalName: '',
          sex: 'female',
          birthDate: '2013-04-04',
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
          contract: { number: 'SI-2026/1', signedOn: '2026-08-20' },
          relatives: [
            {
              kind: 'new',
              relative: {
                fullName: 'Rustam Otaev',
                phone,
                workplace: null,
                email: 'r.otaev@example.uz',
              },
              relationship: 'father',
              mainContact: true,
              portalAccess: true,
              receivesNotices: true,
            },
          ],
        },
        t.admin,
      );
      expect(student.status, JSON.stringify(student.body)).toBe(201);
      const answer = await uploaded([staffRow({ phone, email: '' })]);
      expect(rowAt(answer, 3).problems).toEqual([]);
      expect(rowAt(answer, 3).samePerson).toEqual({ fullName: 'Rustam Otaev' });
      await saved(answer.importId);
      const record = await t.database.migrator
        .selectFrom('staff')
        .select('email')
        .where('phone', '=', phone)
        .executeTakeFirstOrThrow();
      // As by hand: the relative's email is taken when none is typed.
      expect(record.email).toBe('r.otaev@example.uz');
    });

    it('answers import_no_login for a name of no Latin letter, which gives no login', async () => {
      // By hand the Super Admin types the Latin spelling of the login; the file has no login column.
      const answer = await uploaded([
        staffRow({ firstName: 'ʻʼ' }),
        staffRow({ firstName: 'ʻʼ', role: '', birthDate: '01.01.1970' }),
      ]);
      expect(codesAt(answer, 3)).toEqual(['lastName:import_no_login']);
      // Without a role no account is made, so the name needs no login.
      expect(codesAt(answer, 4)).toEqual([]);
      expect(answer.clean).toBe(false);
    });

    it('lists unknown names, unreadable grades and an unknown role', async () => {
      const answer = await uploaded([
        staffRow({
          division: 'Kosmos',
          subject1: 'Astrology: 5',
          role: 'Wizard',
        }),
        staffRow({ subject1: 'Mathematics 5', subject2: 'Physics: 12' }),
        staffRow({ subject1: 'Matematika: 5', subject2: 'МАТЕМАТИКА: 6' }),
      ]);
      expect(codesAt(answer, 3)).toEqual([
        'role:value_unknown',
        'division:name_unknown',
        'subject1:name_unknown',
      ]);
      expect(codesAt(answer, 4)).toEqual(['subject1:grades_invalid', 'subject2:grades_invalid']);
      expect(codesAt(answer, 5)).toEqual(['subject2:subject_twice']);
    });
  });

  describe('no effect of a preview', () => {
    it('leaves no record, account, role, session, job or entry behind', async () => {
      const answer = await uploaded([staffRow(), staffRow({ role: 'Tutor' })]);
      const before = await rowsOf();
      const jobs = await jobsOf();
      const again = await preview(answer.importId);
      expect(again.status).toBe(200);
      expect(
        staffImportPreviewSchema.parse(again.body).rows.every((row) => row.login !== null),
      ).toBe(true);
      expect(await rowsOf()).toEqual(before);
      expect(await jobsOf()).toEqual(jobs);
      const placeholders = await t.database.migrator
        .selectFrom('accounts')
        .select('id')
        .where('password_hash', '=', PREVIEW_PASSWORD_HASH)
        .execute();
      expect(placeholders).toEqual([]);
    });
  });

  describe('refusals', () => {
    it('refuses a file that is not the template, and a confirmed import confirmed again', async () => {
      refusedWith(
        await upload(
          await filledStaffTemplate([staffRow()], (sheet) => {
            sheet.getRow(1).getCell(1).value = 'surname';
          }),
        ),
        422,
        'import_not_template',
      );
      const answer = await uploaded([staffRow()]);
      await saved(answer.importId);
      refusedWith(await confirm(answer.importId), 409, 'import_already_confirmed');
    });

    it('refuses a warning confirmed for a row the file does not have', async () => {
      const answer = await uploaded([staffRow()]);
      refusedWith(
        await preview(answer.importId, { confirmedWarnings: [99] }),
        422,
        'import_decision_unknown',
      );
      refusedWith(await preview(answer.importId, { other: true }), 400, 'validation_failed');
    });

    it('answers 404 for an import of another branch and an unknown one on the preview and the confirm, changing nothing', async () => {
      const south = await uploaded([staffRow()], t.south);
      const before = await rowsOf();
      for (const id of [south.importId, UNKNOWN]) {
        refusedWith(await preview(id), 404, 'not_found');
        refusedWith(await confirm(id), 404, 'not_found');
      }
      expect(await rowsOf()).toEqual(before);
    });

    it('refuses the Academic Vice Principal, who creates students but not staff', async () => {
      const answer = await uploaded([staffRow()]);
      const before = await rowsOf();
      refusedWith(
        await upload(await filledStaffTemplate([staffRow()]), t.vicePrincipal),
        403,
        'permission_denied',
      );
      refusedWith(await confirm(answer.importId, {}, t.vicePrincipal), 403, 'permission_denied');
      refusedWith(await preview(answer.importId, {}, t.vicePrincipal), 403, 'permission_denied');
      refusedWith(
        await t.get('/api/people/staff/import-template?language=en', t.north, t.vicePrincipal),
        403,
        'permission_denied',
      );
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('the Super Admin check of the service', () => {
    it('refuses an access that a guard let in without a Super Admin assignment, writing nothing', async () => {
      // A later change of the table that gave another role `staff` create would reach the
      // service; the import is still the Super Admin's only (plan, the routes).
      const answer = await uploaded([staffRow()]);
      const imports = t.app.get(StaffImports);
      const vice = await t.database.migrator
        .selectFrom('assignments')
        .select(['id', 'account_id'])
        .where('role', '=', 'academic_vice_principal')
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      const assignment = {
        id: vice.id,
        role: 'academic_vice_principal',
        branchId: t.north,
        subjectIds: [],
        classIds: [],
      };
      const access = {
        accountId: vice.account_id,
        assignmentId: vice.id,
        role: 'academic_vice_principal',
        branchId: t.north,
        branchIds: [t.north],
        assignments: [assignment],
        permitting: [assignment],
      } as unknown as Access;
      const before = await rowsOf();
      for (const run of [
        () => imports.preview(access, answer.importId, { confirmedWarnings: [] }, 'r1'),
        () => imports.confirm(access, answer.importId, { confirmedWarnings: [] }, 'r2'),
        () => imports.template(access, 'en'),
        async () =>
          imports.upload(
            access,
            new UploadedFile(await filledStaffTemplate([staffRow()]), XLSX),
            'r3',
          ),
      ]) {
        await expect(run()).rejects.toMatchObject({ code: 'permission_denied' });
      }
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('two confirms at the same moment', () => {
    /** Runs a transaction of the application that holds `lock` until released. */
    async function holding(lock: (transaction: Transaction) => Promise<void>) {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const done = t.app.get(Transactions).run([t.north], async (transaction) => {
        await lock(transaction);
        ready();
        await released;
      });
      await isReady;
      return { release, done };
    }

    /** Waits until `count` sessions of this test database wait for a lock. */
    async function waiting(count: number) {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const found = await sql<{ waiting: number }>`
          select count(distinct l.pid)::int as waiting
          from pg_locks l join pg_stat_activity a on a.pid = l.pid
          where a.datname = current_database() and not l.granted
        `.execute(t.database.migrator);
        if ((found.rows[0]?.waiting ?? 0) >= count) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`${String(count)} requests never waited.`);
    }

    const started = (work: () => PromiseLike<Response>) =>
      new Promise<Response>((resolve, reject) => {
        work().then(resolve, reject);
      });

    const outcomeOf = (response: Response) =>
      response.status === 200
        ? staffImportConfirmResultSchema.parse(response.body).outcome
        : errorCode(response);

    it('of one import: the first saves, the second waits on the import row and is refused as confirmed', async () => {
      const answer = await uploaded([staffRow()]);
      const held = await holding(async (transaction) => {
        await transaction
          .selectFrom('staff_imports')
          .select('id')
          .where('id', '=', answer.importId)
          .forUpdate()
          .execute();
      });
      const one = started(() => confirm(answer.importId));
      await waiting(1);
      const two = started(() => confirm(answer.importId));
      await waiting(2);
      held.release();
      await held.done;
      expect(outcomeOf(await one)).toBe('saved');
      expect(outcomeOf(await two)).toBe('import_already_confirmed');
    });

    it('of two uploads of one file: the second waits on the file lock and finds it imported', async () => {
      const bytes = await filledStaffTemplate([staffRow()]);
      const first = staffImportPreviewSchema.parse((await upload(bytes)).body);
      const second = staffImportPreviewSchema.parse((await upload(bytes)).body);
      const hash = (
        await t.database.migrator
          .selectFrom('staff_imports')
          .select('file_sha256')
          .where('id', '=', first.importId)
          .executeTakeFirstOrThrow()
      ).file_sha256;
      // The lock both confirms take before they look for an earlier import of the file; they
      // meet on no row (two import rows) and no index before it.
      const held = await holding(async (transaction) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${`staff_import:${t.north}:${hash}`}, 0))`.execute(
          transaction,
        );
      });
      const one = started(() => confirm(first.importId));
      await waiting(1);
      const two = started(() => confirm(second.importId));
      await waiting(2);
      held.release();
      await held.done;
      expect(outcomeOf(await one)).toBe('saved');
      expect(outcomeOf(await two)).toBe('import_already_done');
    });
  });

  describe('the template', () => {
    it('has the keys row, the headings in three languages and the school lists', async () => {
      const response = await request(t.kit.server)
        .get('/api/people/staff/import-template?language=en')
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, t.north)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            callback(null, Buffer.concat(chunks));
          });
        });
      expect(response.status).toBe(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body as ExcelJS.Buffer);
      const sheet = workbook.getWorksheet('Staff');
      expect(sheet?.getRow(1).getCell(1).value).toBe('lastName');
      expect(sheet?.getRow(1).hidden).toBe(true);
      expect(sheet?.getRow(2).getCell(1).value).toBe('Familiya / Фамилия / Surname');
      const lists = workbook.getWorksheet('Lists');
      const values: unknown[] = [];
      lists?.eachRow((row) => {
        row.eachCell((cell) => values.push(cell.value));
      });
      expect(values).toContain('Mathematics');
      expect(values).toContain('Tutor');
      expect(values).not.toContain('Super Admin');
    });
  });

  describe('the day of an earlier import', () => {
    it('is the day in the time zone of the branch: a confirm at 00:05 in Tashkent is of that day', async () => {
      // Last in the file: the clock moves forward for this test only.
      const before = t.clock.now();
      try {
        t.clock.set('2026-10-11T00:05:00+05:00');
        const bytes = await filledStaffTemplate([staffRow()]);
        const first = staffImportPreviewSchema.parse((await upload(bytes)).body);
        await saved(first.importId);
        const again = staffImportPreviewSchema.parse((await upload(bytes)).body);
        expect(again.alreadyImportedOn).toBe('2026-10-11');
      } finally {
        t.clock.set(before);
      }
    });
  });
});
