import { firstPasswordSlipSchema, staffDetailSchema } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, TODAY, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

// All names are invented. Task 10.3a: the limits inside the routes for the
// whole-branch roles (`narrower`). docs/spec/edge-cases/people-roles-accounts.md,
// "How does the first account come to exist?": "nobody can remove their own
// Super Admin role".
describe('the role end held narrower for the Super Admin', () => {
  let t: DayTemplatesKit;
  let academic: string;
  let steam: string;
  let count = 0;

  /** A new staff record of North; the surname is new each time. */
  async function person(): Promise<string> {
    count += 1;
    const response = await t.post('/api/people/staff', t.north, {
      firstName: 'Akmal',
      lastName: `Tursunov${'a'.repeat(count)}`,
      fatherName: '',
      sex: 'male',
      birthDate: '1990-01-01',
      educationLevel: 'master',
      phone: `+99893${String(2000000 + count)}`,
      email: '',
      jshshir: '',
      admissionDate: '2026-09-01',
      contractType: 'full_time',
      contractDate: '2026-09-01',
      weeklyLessons: 18,
      dailyLessons: 5,
      divisions: [{ divisionId: academic, departmentId: steam, main: true }],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return staffDetailSchema.parse(response.body).id;
  }

  /** Every row the role end may write, and both audit logs. */
  async function snapshot(): Promise<Record<string, unknown>> {
    const rows: Record<string, unknown> = {};
    for (const table of [
      'assignments',
      'accounts',
      'staff',
      'class_tutors',
      'audit_log',
      'audit_log_school',
    ] as const) {
      rows[table] = (
        await sql`select * from ${sql.table(table)} order by 1`.execute(t.database.migrator)
      ).rows;
    }
    return rows;
  }

  beforeAll(async () => {
    t = await dayTemplatesKit();
    const id = async (table: 'divisions' | 'departments', en: string) =>
      (
        await t.database.migrator
          .selectFrom(table)
          .select('id')
          .where('name_en', '=', en)
          .executeTakeFirstOrThrow()
      ).id;
    academic = await id('divisions', 'Academic');
    steam = await id('departments', 'STEAM');
  });

  afterAll(async () => {
    await t.close();
  });

  it('refuses the Super Admin the end of their own Super Admin role while another is active, with nothing written', async () => {
    // A second active Super Admin: the last-Super-Admin rule does not refuse this end.
    const other = await person();
    const created = await t.post(`/api/people/staff/${other}/account`, t.north, {
      login: `a.tursunov${String(count)}`,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    firstPasswordSlipSchema.parse(created.body);
    const given = await t.post(`/api/people/staff/${other}/roles`, t.north, {
      role: 'super_admin',
      branchId: null,
      from: TODAY,
    });
    expect(given.status, JSON.stringify(given.body)).toBe(201);

    // The admin's own record: a staff record linked to the admin's account.
    const own = await person();
    const admin = await t.database.migrator
      .selectFrom('assignments')
      .select('account_id')
      .where('id', '=', t.adminAssignment)
      .executeTakeFirstOrThrow();
    await t.database.migrator
      .updateTable('staff')
      .set({ account_id: admin.account_id })
      .where('id', '=', own)
      .execute();

    const before = await snapshot();
    const response = await t.post(
      `/api/people/staff/${own}/roles/${t.adminAssignment}/end`,
      t.north,
      { from: TODAY },
    );
    expect(response.status, JSON.stringify(response.body)).toBe(409);
    expect(errorCode(response)).toBe('own_super_admin_role');
    expect(await snapshot()).toEqual(before);
    const assignment = await t.database.migrator
      .selectFrom('assignments')
      .select(['valid_until', 'ended_by'])
      .where('id', '=', t.adminAssignment)
      .executeTakeFirstOrThrow();
    expect(assignment).toEqual({ valid_until: null, ended_by: null });
  });
});
