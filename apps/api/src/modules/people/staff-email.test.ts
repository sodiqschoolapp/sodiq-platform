import { firstPasswordSlipSchema, staffDetailSchema, type Role } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const DAY = 24 * 60 * 60 * 1000;

// All names and addresses are invented. Task 2.3c-2, pull request #66,
// decisions 4 and 5 (Look first): since the email opens the account through
// the reset by email, nobody changes the email of their own record, and the
// Academic Vice Principal changes it only on a record whose account they may
// lock and reset (`edge/people-roles-accounts`, Who can act: "only for
// Teachers, Tutors, Head Teachers and the Head Tutor of his branch"), or that
// has no account. Name and phone stay as task 2.2a built them.
describe('who changes the email of a staff record', () => {
  let t: DayTemplatesKit;
  let academic: string;
  let steam: string;
  let count = 0;
  let viceAccount: string;
  let adminAccount: string;

  const lettersOf = (n: number): string =>
    n < 26
      ? String.fromCharCode(97 + n)
      : lettersOf(Math.floor(n / 26) - 1) + String.fromCharCode(97 + (n % 26));

  const recordOf = (lastName: string, email: string, phone: string) => ({
    firstName: 'Shahlo',
    lastName,
    fatherName: '',
    sex: 'female',
    birthDate: '1992-07-08',
    educationLevel: 'master',
    phone,
    email,
    jshshir: '',
    admissionDate: '2026-09-01',
    contractType: 'full_time',
    contractDate: '2026-09-01',
    weeklyLessons: 18,
    dailyLessons: 5,
    divisions: [{ divisionId: academic, departmentId: steam, main: true }],
  });

  interface Made {
    id: string;
    lastName: string;
    phone: string;
    accountId: string | null;
  }

  /** A record of North; with `roles`, an account holding them (from now, or from `validFrom`). */
  async function person(
    roles: readonly { role: Role; branchId?: string | null; validFrom?: Date }[] | null = null,
  ): Promise<Made> {
    count += 1;
    const lastName = `Usmonova${lettersOf(count)}`;
    const phone = `+99897${String(5000000 + count)}`;
    const created = await t.post(
      '/api/people/staff',
      t.north,
      recordOf(lastName, `s.${lastName.toLowerCase()}@example.uz`, phone),
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = staffDetailSchema.parse(created.body).id;
    if (roles === null) {
      return { id, lastName, phone, accountId: null };
    }
    const made = await t.post(`/api/people/staff/${id}/account`, t.north, {
      login: `s.${lastName.toLowerCase()}`,
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const slip = firstPasswordSlipSchema.parse(made.body);
    const account = await t.database.migrator
      .selectFrom('accounts')
      .select('id')
      .where('login', '=', slip.login)
      .executeTakeFirstOrThrow();
    for (const held of roles) {
      const branchId = held.branchId === undefined ? t.north : held.branchId;
      await t.kit.giveRole(account.id, {
        role: held.role,
        ...(branchId === null ? {} : { branchId }),
        ...(held.validFrom === undefined ? {} : { validFrom: held.validFrom }),
      });
    }
    return { id, lastName, phone, accountId: account.id };
  }

  /** The record of an account the kit made (the Academic Vice Principal's, the admin's). */
  const records = new Map<string, Made>();
  async function recordFor(accountId: string): Promise<Made> {
    // A record is linked to an account once (`staff_account_link_guard`): kept for the next test.
    const kept = records.get(accountId);
    if (kept !== undefined) {
      return kept;
    }
    const made = await person();
    records.set(accountId, { ...made, accountId });
    await t.database.migrator
      .updateTable('staff')
      .set({ account_id: accountId })
      .where('id', '=', made.id)
      .execute();
    return { ...made, accountId };
  }

  const changeEmail = (made: Made, email: string, cookie: string) =>
    t.put(
      `/api/people/staff/${made.id}`,
      t.north,
      recordOf(made.lastName, email, made.phone),
      cookie,
    );

  const rightsOf = async (made: Made, cookie: string) => {
    const response = await t.get(`/api/people/staff/${made.id}`, t.north, cookie);
    expect(response.status).toBe(200);
    return staffDetailSchema.parse(response.body).rights;
  };

  async function refused(made: Made, cookie: string) {
    const before = await t.database.migrator
      .selectFrom('staff')
      .select('email')
      .where('id', '=', made.id)
      .executeTakeFirstOrThrow();
    const entries = (await t.entries('staff.edit', made.id)).length;
    const response = await changeEmail(made, 'taken.over@example.uz', cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(errorCode(response)).toBe('permission_denied');
    // Only the yes or no leaves the server (decision 5).
    expect(JSON.stringify(response.body)).not.toContain(t.south);
    expect(JSON.stringify(response.body)).not.toContain('academic_vice_principal');
    expect(
      await t.database.migrator
        .selectFrom('staff')
        .select('email')
        .where('id', '=', made.id)
        .executeTakeFirstOrThrow(),
    ).toEqual(before);
    expect(await t.entries('staff.edit', made.id)).toHaveLength(entries);
    expect((await rightsOf(made, cookie)).email).toBe(false);
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
    const accountOf = async (assignment: string) =>
      (
        await t.database.migrator
          .selectFrom('assignments')
          .select('account_id')
          .where('id', '=', assignment)
          .executeTakeFirstOrThrow()
      ).account_id;
    viceAccount = await accountOf(t.viceAssignment);
    adminAccount = await accountOf(t.adminAssignment);
  });

  afterAll(async () => {
    await t.close();
  });

  it('lets the Academic Vice Principal change the email of a Teacher, a Head Tutor and a record without account', async () => {
    for (const made of [
      await person([{ role: 'teacher' }]),
      await person([{ role: 'head_tutor' }]),
      await person(),
    ]) {
      expect((await rightsOf(made, t.vicePrincipal)).email).toBe(true);
      const response = await changeEmail(
        made,
        `new.${made.lastName.toLowerCase()}@example.uz`,
        t.vicePrincipal,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const [entry] = await t.entries('staff.edit', made.id);
      expect(entry).toMatchObject({ assignment_id: t.viceAssignment });
    }
  });

  it('refuses the Academic Vice Principal on accounts they may not reset, and on their own record', async () => {
    await refused(await recordFor(viceAccount), t.vicePrincipal);
    await refused(await recordFor(adminAccount), t.vicePrincipal);
    await refused(await person([{ role: 'academic_vice_principal' }]), t.vicePrincipal);
    await refused(await person([{ role: 'principal' }]), t.vicePrincipal);
    await refused(
      await person([{ role: 'teacher' }, { role: 'academic_vice_principal', branchId: t.south }]),
      t.vicePrincipal,
    );
    await refused(
      await person([
        { role: 'teacher' },
        {
          role: 'academic_vice_principal',
          validFrom: new Date(new Date(START).getTime() + 7 * DAY),
        },
      ]),
      t.vicePrincipal,
    );
  });

  it('keeps name and phone with the Academic Vice Principal on a record whose email they may not change', async () => {
    const made = await person([{ role: 'principal' }]);
    const response = await t.put(
      `/api/people/staff/${made.id}`,
      t.north,
      {
        ...recordOf(made.lastName, `s.${made.lastName.toLowerCase()}@example.uz`, '+998970000999'),
        firstName: 'Sevara',
      },
      t.vicePrincipal,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(staffDetailSchema.parse(response.body)).toMatchObject({
      firstName: 'Sevara',
      phone: '+998970000999',
    });
  });

  it('refuses a Super Admin on their own record and lets them change another Super Admin', async () => {
    await refused(await recordFor(adminAccount), t.admin);
    const other = await person([{ role: 'super_admin', branchId: null }]);
    expect((await rightsOf(other, t.admin)).email).toBe(true);
    expect((await changeEmail(other, 'other.admin@example.uz', t.admin)).status).toBe(200);
  });

  // A role given at the same moment locks the record first, as the edit does.
  it('sees a role given at the same moment: the edit waits for the record and is refused', async () => {
    const made = await person([{ role: 'teacher' }]);
    const accountId = made.accountId ?? '';
    const [answer] = await t.database.migrator.transaction().execute(async (held) => {
      await held.selectFrom('staff').select('id').where('id', '=', made.id).forUpdate().execute();
      await held
        .insertInto('assignments')
        .values({
          account_id: accountId,
          role: 'academic_vice_principal',
          branch_id: t.north,
          valid_from: t.clock.now(),
          created_at: t.clock.now(),
        })
        .execute();
      const waiting = changeEmail(made, 'taken.over@example.uz', t.vicePrincipal).then(
        (response) => response,
      );
      for (let tries = 0; tries < 150; tries += 1) {
        const found = await sql<{ waiting: number }>`
          select count(*)::int as waiting from pg_locks
          where locktype in ('transactionid', 'tuple') and not granted
        `.execute(t.database.migrator);
        if ((found.rows[0]?.waiting ?? 0) > 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return [waiting] as const;
    });
    const response = await answer;
    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(errorCode(response)).toBe('permission_denied');
  });
});
