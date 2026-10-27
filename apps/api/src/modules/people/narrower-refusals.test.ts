import { staffDetailSchema } from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, TODAY, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { errorCode, NEW_PASSWORD } from '../../testing/sign-in-kit.js';

// All names are invented. Task 10.3a (follow-up of the narrower lines):
// docs/spec/edge-cases/people-roles-accounts.md, Staff over time: a staff member
// who left signs in no more; refused only after the password matched, and
// written in the sign-in history (task 2.2a, correction 3). staff.test.ts
// proves it for "inactive"; this is the same over HTTP for "left".
describe('the sign-in of a staff member who left', () => {
  let t: DayTemplatesKit;
  let academic: string;
  let steam: string;

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

  it('refuses the sign-in of a staff member who left', async () => {
    const browser = await t.kit.fullSession('Farhod', 'Ismoilov');
    const created = await t.post('/api/people/staff', t.north, {
      firstName: 'Farhod',
      lastName: 'Ismoilov',
      fatherName: '',
      sex: 'male',
      birthDate: '1988-05-05',
      educationLevel: 'master',
      phone: '+998907770011',
      email: '',
      jshshir: '',
      admissionDate: '2026-09-01',
      contractType: 'full_time',
      contractDate: '2026-09-01',
      weeklyLessons: 18,
      dailyLessons: 5,
      divisions: [{ divisionId: academic, departmentId: steam, main: true }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const record = staffDetailSchema.parse(created.body);
    await t.database.migrator
      .updateTable('staff')
      .set({ account_id: browser.account.id })
      .where('id', '=', record.id)
      .execute();
    await t.kit.giveRole(browser.account.id, { role: 'teacher', branchId: t.north });
    expect((await t.kit.get('/api/auth/session', browser.cookie)).status).toBe(200);

    const left = await t.post(`/api/people/staff/${record.id}/status`, t.north, {
      status: 'left',
      from: TODAY,
    });
    expect(left.status, JSON.stringify(left.body)).toBe(200);

    // The open session ends with the status.
    expect((await t.kit.get('/api/auth/session', browser.cookie)).status).toBe(401);
    const sessionsBefore = await t.database.migrator
      .selectFrom('sessions')
      .select('id')
      .where('account_id', '=', browser.account.id)
      .execute();

    // A wrong password tells nothing of the status.
    const wrong = await t.kit.signIn(browser.account.login, 'a-wrong-password-11');
    expect(wrong.status).toBe(401);
    expect(errorCode(wrong)).toBe('sign_in_failed');

    const right = await t.kit.signIn(browser.account.login, NEW_PASSWORD);
    expect(right.status, JSON.stringify(right.body)).toBe(403);
    expect(errorCode(right)).toBe('account_inactive');
    expect(
      await t.database.migrator
        .selectFrom('sessions')
        .select('id')
        .where('account_id', '=', browser.account.id)
        .execute(),
    ).toEqual(sessionsBefore);
    const entries = await t.database.migrator
      .selectFrom('audit_log_school')
      .select('action')
      .where('record_id', '=', browser.account.id)
      .where('action', '=', 'auth.sign_in_inactive')
      .execute();
    expect(entries).toHaveLength(1);
  });
});
