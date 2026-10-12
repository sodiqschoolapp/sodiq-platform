import { createHash } from 'node:crypto';
import {
  accountAccessSchema,
  firstPasswordSlipSchema,
  neverUsedListSchema,
  sessionResponseSchema,
  staffDetailSchema,
  type Role,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEVICE_COOKIE } from '../../http/device-cookie.js';
import {
  dayTemplatesKit,
  START,
  TODAY,
  TOMORROW,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { cookieOf, errorCode, NEW_PASSWORD } from '../../testing/sign-in-kit.js';

const HOUR = 60 * 60 * 1000;

// All names are invented. Task 2.3c-1, pull request #65: the sign-in access of
// a staff record's account. docs/spec/edge-cases/people-roles-accounts.md (Who
// can act, Staff over time, Accounts and sign-in); the plan's decisions and
// the five corrections of its review. The clock stands at 23:55 on 10 October
// 2026 in Tashkent.
describe('the sign-in access of an account', () => {
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

  /** A new person of the branch; the surname is new each time. */
  async function person(branch = t.north): Promise<{ id: string; lastName: string }> {
    count += 1;
    const lastName = `Yusupov${lettersOf(count)}`;
    const response = await t.post('/api/people/staff', branch, {
      firstName: 'Bekzod',
      lastName,
      fatherName: '',
      sex: 'male',
      birthDate: '1991-02-03',
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
    const created = staffDetailSchema.parse(response.body);
    return { id: created.id, lastName: created.lastName };
  }

  /** A person of the branch with an account and the roles named (from now, given by the server). */
  async function withAccount(
    roles: readonly { role: Role; branchId?: string; validFrom?: Date }[] = [],
    branch = t.north,
  ) {
    const made = await person(branch);
    const response = await t.post(`/api/people/staff/${made.id}/account`, branch, {
      login: `b.${made.lastName.toLowerCase()}`,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const slip = firstPasswordSlipSchema.parse(response.body);
    const account = await t.database.migrator
      .selectFrom('accounts')
      .select('id')
      .where('login', '=', slip.login)
      .executeTakeFirstOrThrow();
    const assignments: string[] = [];
    for (const held of roles) {
      assignments.push((await t.kit.giveRole(account.id, held)).id);
    }
    return { ...made, slip, accountId: account.id, assignments };
  }

  const teacherOf = () => withAccount([{ role: 'teacher', branchId: t.north }]);

  /** Signs the person in and changes the first password: a session that owes no password step. */
  async function signedIn(made: { slip: { login: string; password: string } }) {
    const first = await t.kit.signIn(made.slip.login, made.slip.password);
    const cookie = cookieOf(first);
    const device = cookieOf(first, DEVICE_COOKIE);
    if (first.status !== 200 || cookie === undefined || device === undefined) {
      throw new Error(`The sign-in failed with ${String(first.status)}.`);
    }
    const changed = await t.kit.changePassword(
      `${cookie}; ${device}`,
      made.slip.password,
      NEW_PASSWORD,
    );
    expect(changed.status).toBe(204);
    return { cookie, device };
  }

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  const readAccess = (id: string, cookie = t.admin, branch = t.north) =>
    t.get(`/api/people/staff/${id}/account/access`, branch, cookie);

  const accessOf = async (id: string, cookie = t.admin) => {
    const response = await readAccess(id, cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return accountAccessSchema.parse(response.body);
  };

  const lock = (id: string, cookie = t.admin, reason = 'Laptop lost', branch = t.north) =>
    t.post(`/api/people/staff/${id}/account/lock`, branch, { reason }, cookie);
  const unlock = (id: string, cookie = t.admin, branch = t.north) =>
    t.post(`/api/people/staff/${id}/account/unlock`, branch, {}, cookie);
  const resetPassword = (id: string, cookie = t.admin, branch = t.north) =>
    t.post(`/api/people/staff/${id}/account/password-reset`, branch, {}, cookie);
  const resetSecondStep = (id: string, cookie = t.admin, branch = t.north) =>
    t.post(`/api/people/staff/${id}/account/second-step-reset`, branch, {}, cookie);

  const CHANGES = {
    lock: (id: string, cookie?: string, branch?: string) => lock(id, cookie, undefined, branch),
    unlock,
    'password reset': resetPassword,
    'second-step reset': resetSecondStep,
  } as const;

  /** Every row the routes may write, and both audit logs: what a refusal leaves as it was. */
  async function snapshot(): Promise<Record<string, unknown>> {
    const rows: Record<string, unknown> = {};
    for (const table of [
      'accounts',
      'sessions',
      'account_second_steps',
      'second_step_recovery_codes',
      'sign_in_throttle',
      'assignments',
      'staff',
      'audit_log',
      'audit_log_school',
    ] as const) {
      rows[table] = (
        await sql`select * from ${sql.table(table)} order by 1, 2`.execute(t.database.migrator)
      ).rows;
    }
    return rows;
  }

  const entries = (table: 'audit_log' | 'audit_log_school', action: string, recordId: string) =>
    t.database.migrator
      .selectFrom(table)
      .selectAll()
      .where('action', '=', action)
      .where('record_id', '=', recordId)
      .orderBy('id')
      .execute();

  const accountRow = (id: string) =>
    t.database.migrator
      .selectFrom('accounts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  const openSessions = async (accountId: string) =>
    t.database.migrator
      .selectFrom('sessions')
      .selectAll()
      .where('account_id', '=', accountId)
      .where('ended_at', 'is', null)
      .execute();

  /** Links a record of the branch to an account the kit made (the admin's, the Vice Principal's). */
  const records = new Map<string, string>();
  async function recordOf(accountId: string): Promise<string> {
    // A record is linked to an account once (`staff_account_link_guard`): kept for the next test.
    const kept = records.get(accountId);
    if (kept !== undefined) {
      return kept;
    }
    const made = await person();
    records.set(accountId, made.id);
    await t.database.migrator
      .updateTable('staff')
      .set({ account_id: accountId })
      .where('id', '=', made.id)
      .execute();
    return made.id;
  }

  /** Waits until a request waits for a lock held by the test. */
  async function untilWaiting(kind: 'advisory' | 'transactionid' | 'tuple'): Promise<void> {
    for (let tries = 0; tries < 150; tries += 1) {
      const waiting = await sql<{ waiting: number }>`
        select count(*)::int as waiting from pg_locks
        where locktype = ${kind} and not granted
      `.execute(t.database.migrator);
      if ((waiting.rows[0]?.waiting ?? 0) > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('The request never waited.');
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

  // Every test starts with the admin as the one Super Admin, not locked.
  afterEach(async () => {
    t.clock.set(START);
    await t.database.migrator
      .updateTable('assignments')
      .set((builder) => ({ valid_until: builder.ref('valid_from'), ended_by: null }))
      .where('role', '=', 'super_admin')
      .where('id', '<>', t.adminAssignment)
      .execute();
    await t.database.migrator
      .updateTable('assignments')
      .set({ valid_until: null, ended_by: null })
      .where('id', '=', t.adminAssignment)
      .execute();
    await t.database.migrator
      .updateTable('accounts')
      .set({ locked_at: null, locked_by: null, lock_reason: null })
      .where('id', 'in', [adminAccount, viceAccount])
      .execute();
  });

  // `02`: the Principal "views everything in the branch ... changes nothing";
  // decision 13: the three readers see the state, the buttons follow `can`.
  describe('the read', () => {
    it('shows the state to the Super Admin, the Principal and the Academic Vice Principal', async () => {
      const made = await teacherOf();
      for (const cookie of [t.admin, t.principal, t.vicePrincipal]) {
        const answer = await accessOf(made.id, cookie);
        expect(answer.account).toEqual({
          login: made.slip.login,
          locked: null,
          passwordReset: null,
          neverUsed: true,
          secondStepOn: false,
        });
      }
      expect((await accessOf(made.id, t.admin)).can).toEqual({
        lock: true,
        unlock: false,
        resetPassword: true,
        resetSecondStep: false,
      });
      expect((await accessOf(made.id, t.vicePrincipal)).can).toEqual({
        lock: true,
        unlock: false,
        resetPassword: true,
        resetSecondStep: false,
      });
      expect((await accessOf(made.id, t.principal)).can).toEqual({
        lock: false,
        unlock: false,
        resetPassword: false,
        resetSecondStep: false,
      });
    });

    it('answers no account for a record without one, and is refused to a Teacher', async () => {
      const made = await person();
      expect(await accessOf(made.id)).toEqual({
        account: null,
        can: { lock: false, unlock: false, resetPassword: false, resetSecondStep: false },
      });
      refusedWith(await readAccess(made.id, t.teacher), 403, 'permission_denied');
    });

    it('answers 404 for another branch’s record, an unknown id and a vacancy', async () => {
      const other = await withAccount([{ role: 'teacher', branchId: t.south }], t.south);
      const vacancy = await t.post('/api/people/vacancies', t.north, {
        divisionId: academic,
        departmentId: steam,
        subjects: [],
        languages: [],
        weeklyLessons: 18,
      });
      const ids = [other.id, UNKNOWN];
      if (vacancy.status === 201) {
        ids.push((vacancy.body as { id: string }).id);
      }
      for (const id of ids) {
        for (const cookie of [t.admin, t.principal, t.vicePrincipal]) {
          refusedWith(await readAccess(id, cookie), 404, 'not_found');
        }
      }
    });

    it('names who locked and who reset, and that the second step is on', async () => {
      const made = await withAccount([{ role: 'academic_vice_principal', branchId: t.north }]);
      const browser = await signedIn(made);
      await t.kit.setUpSecondStep(browser.cookie);
      expect((await lock(made.id)).status).toBe(200);
      const answer = await accessOf(made.id);
      expect(answer.account?.locked).toEqual({
        at: new Date(START).toISOString(),
        by: { login: 'a.karimova', name: null },
        reason: 'Laptop lost',
      });
      expect(answer.account?.secondStepOn).toBe(true);
      expect(answer.account?.neverUsed).toBe(false);
      expect(answer.can).toEqual({
        lock: false,
        unlock: true,
        resetPassword: true,
        resetSecondStep: true,
      });
      expect((await resetPassword(made.id)).status).toBe(200);
      expect((await accessOf(made.id)).account?.passwordReset).toEqual({
        at: new Date(START).toISOString(),
        by: { login: 'a.karimova', name: null },
        validUntil: new Date(new Date(START).getTime() + 24 * HOUR).toISOString(),
      });
    });
  });

  // Staff over time: "'Lock now' ends all sessions at once, needs no
  // reassignment and is logged with a reason."
  describe('the lock', () => {
    it('ends every session, refuses the sign-in and is audited with its reason', async () => {
      const made = await teacherOf();
      const browser = await signedIn(made);
      // A trusted session: its 7-day cookie opens nothing after the lock
      // (Accounts and sign-in: "Trust ends at once on ... an account lock").
      const trusted = await t.kit.signIn(made.slip.login, NEW_PASSWORD, browser.device, true);
      expect(sessionResponseSchema.parse(trusted.body).trustedUntil).not.toBeNull();
      const trustedCookie = cookieOf(trusted) ?? '';

      const response = await t.post(
        `/api/people/staff/${made.id}/account/lock`,
        t.north,
        { reason: '  Laptop lost  ' },
        t.vicePrincipal,
      );

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(accountAccessSchema.parse(response.body).account?.locked?.reason).toBe('Laptop lost');
      expect(await openSessions(made.accountId)).toEqual([]);
      const ended = await t.database.migrator
        .selectFrom('sessions')
        .select('end_reason')
        .where('account_id', '=', made.accountId)
        .execute();
      expect(ended.map((row) => row.end_reason)).toContain('account_locked');
      for (const cookie of [browser.cookie, `${trustedCookie}; ${browser.device}`]) {
        expect((await t.kit.get('/api/auth/session', cookie)).status).toBe(401);
      }
      refusedWith(
        await t.kit.signIn(made.slip.login, NEW_PASSWORD, browser.device),
        403,
        'account_locked',
      );
      const [entry] = await entries('audit_log', 'account.locked', made.accountId);
      expect(entry).toMatchObject({
        branch_id: t.north,
        actor_id: viceAccount,
        assignment_id: t.viceAssignment,
        person_id: made.id,
        reason: 'Laptop lost',
      });
    });

    it('refuses an empty reason, one too long, and a second lock', async () => {
      const made = await teacherOf();
      const before = await snapshot();
      refusedWith(await lock(made.id, t.admin, '   '), 400, 'validation_failed');
      refusedWith(await lock(made.id, t.admin, 'x'.repeat(501)), 400, 'validation_failed');
      expect(await snapshot()).toEqual(before);
      expect((await lock(made.id, t.admin, 'x'.repeat(500))).status).toBe(200);
      const locked = await snapshot();
      refusedWith(await lock(made.id), 409, 'account_already_locked');
      expect(await snapshot()).toEqual(locked);
    });
  });

  describe('the unlock', () => {
    it('lets the person sign in again and is audited', async () => {
      const made = await teacherOf();
      const browser = await signedIn(made);
      expect((await lock(made.id, t.vicePrincipal)).status).toBe(200);
      const response = await unlock(made.id, t.vicePrincipal);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(accountAccessSchema.parse(response.body).account?.locked).toBeNull();
      expect((await t.kit.signIn(made.slip.login, NEW_PASSWORD, browser.device)).status).toBe(200);
      const [entry] = await entries('audit_log', 'account.unlocked', made.accountId);
      expect(entry).toMatchObject({
        branch_id: t.north,
        actor_id: viceAccount,
        assignment_id: t.viceAssignment,
        person_id: made.id,
      });
    });

    it('refuses an account that is not locked, with nothing written', async () => {
      const made = await teacherOf();
      const before = await snapshot();
      refusedWith(await unlock(made.id), 409, 'account_not_locked');
      expect(await snapshot()).toEqual(before);
    });
  });

  // Accounts and sign-in: "A reset gives a one-time password valid for 24
  // hours, forces a change, ends all sessions ... 'your password was reset by X'".
  describe('the password reset', () => {
    it('answers the slip, ends every session and forces the change', async () => {
      const made = await teacherOf();
      const browser = await signedIn(made);
      const trusted = await t.kit.signIn(made.slip.login, NEW_PASSWORD, browser.device, true);
      const trustedCookie = cookieOf(trusted) ?? '';
      // Failed sign-ins of the login are forgotten.
      for (let tries = 0; tries < 3; tries += 1) {
        await t.kit.signIn(made.slip.login, 'not-the-password-1');
      }
      const loginHash = createHash('sha256').update(made.slip.login).digest('hex');
      const throttled = () =>
        t.database.migrator
          .selectFrom('sign_in_throttle')
          .select('login_hash')
          .where('login_hash', '=', loginHash)
          .execute();
      expect(await throttled()).not.toEqual([]);

      const response = await resetPassword(made.id, t.vicePrincipal);

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const slip = firstPasswordSlipSchema.parse(response.body);
      expect(slip).toEqual({
        firstName: 'Bekzod',
        lastName: made.lastName,
        login: made.slip.login,
        password: expect.stringMatching(/^[A-Za-z0-9]{16}$/) as unknown,
        validUntil: new Date(new Date(START).getTime() + 24 * HOUR).toISOString(),
      });
      expect(await throttled()).toEqual([]);
      expect(await openSessions(made.accountId)).toEqual([]);
      for (const cookie of [browser.cookie, `${trustedCookie}; ${browser.device}`]) {
        expect((await t.kit.get('/api/auth/session', cookie)).status).toBe(401);
      }
      const signIn = await t.kit.signIn(made.slip.login, slip.password);
      expect(signIn.status).toBe(200);
      const answer = sessionResponseSchema.parse(signIn.body);
      expect(answer.mustChangePassword).toBe(true);
      expect(answer.passwordResetBy).toBe('d.saidova');
      const [entry] = await entries('audit_log', 'account.password_reset', made.accountId);
      expect(entry).toMatchObject({
        branch_id: t.north,
        actor_id: viceAccount,
        assignment_id: t.viceAssignment,
        person_id: made.id,
      });
      expect(JSON.stringify(entry)).not.toContain(slip.password);
    });

    it('stops working 24 hours after the reset, by the injected clock', async () => {
      const made = await teacherOf();
      const slip = firstPasswordSlipSchema.parse((await resetPassword(made.id)).body);
      t.clock.set(new Date(new Date(START).getTime() + 24 * HOUR + 1));
      refusedWith(await t.kit.signIn(made.slip.login, slip.password), 401, 'password_expired');
      t.clock.set(new Date(new Date(START).getTime() + 24 * HOUR - 1));
      expect((await t.kit.signIn(made.slip.login, slip.password)).status).toBe(200);
    });

    // Decision 7: a person who has left gets no reset; the lock stays possible.
    it('refuses a person who has left for good, and still locks the account', async () => {
      const made = await teacherOf();
      expect(
        (
          await t.post(`/api/people/staff/${made.id}/status`, t.north, {
            status: 'left',
            from: TODAY,
          })
        ).status,
      ).toBe(200);
      const before = await snapshot();
      refusedWith(await resetPassword(made.id), 409, 'staff_left');
      expect(await snapshot()).toEqual(before);
      expect((await accessOf(made.id)).can.resetPassword).toBe(false);
      expect((await lock(made.id)).status).toBe(200);
    });
  });

  // Accounts and sign-in: "A Super Admin resets an Academic Vice Principal's
  // second step; another Super Admin resets a Super Admin's"; 0.6d: "always
  // comes with a password reset" (decision 6).
  describe('the second-step reset', () => {
    async function withSecondStep(role: Role, branchId?: string) {
      const made = await withAccount([{ role, ...(branchId === undefined ? {} : { branchId }) }]);
      const browser = await signedIn(made);
      await t.kit.setUpSecondStep(browser.cookie);
      return { ...made, browser };
    }

    it.each([
      ['an Academic Vice Principal', 'academic_vice_principal' as const],
      ['another Super Admin', 'super_admin' as const],
    ])('removes the second step of %s and resets the password', async (_name, role) => {
      const made = await withSecondStep(role, role === 'super_admin' ? undefined : t.north);
      const response = await resetSecondStep(made.id);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const slip = firstPasswordSlipSchema.parse(response.body);
      expect(slip.login).toBe(made.slip.login);
      const steps = await t.database.migrator
        .selectFrom('account_second_steps')
        .select('account_id')
        .where('account_id', '=', made.accountId)
        .execute();
      expect(steps).toEqual([]);
      const codes = await t.database.migrator
        .selectFrom('second_step_recovery_codes')
        .select('account_id')
        .where('account_id', '=', made.accountId)
        .execute();
      expect(codes).toEqual([]);
      expect(await openSessions(made.accountId)).toEqual([]);
      // The person changes the password, then sets up the second step again.
      const signIn = await t.kit.signIn(made.slip.login, slip.password);
      const answer = sessionResponseSchema.parse(signIn.body);
      expect(answer.mustChangePassword).toBe(true);
      const second = await entries('audit_log', 'account.second_step_reset', made.accountId);
      const password = await entries('audit_log', 'account.password_reset', made.accountId);
      expect(second).toHaveLength(1);
      expect(password).toHaveLength(1);
      expect(second[0]).toMatchObject({
        branch_id: t.north,
        assignment_id: t.adminAssignment,
        person_id: made.id,
        details: { wasOn: true },
      });
      // One transaction: the two entries carry the same request.
      expect(second[0]?.request_id).toBe(password[0]?.request_id);
    });

    it('refuses an account with no second step, with nothing written', async () => {
      const made = await teacherOf();
      await signedIn(made);
      const before = await snapshot();
      refusedWith(await resetSecondStep(made.id), 409, 'second_step_off');
      expect(await snapshot()).toEqual(before);
      expect((await accessOf(made.id)).can.resetSecondStep).toBe(false);
    });

    it('refuses the Academic Vice Principal always, with nothing written', async () => {
      const made = await withSecondStep('teacher', t.north);
      const before = await snapshot();
      refusedWith(await resetSecondStep(made.id, t.vicePrincipal), 403, 'permission_denied');
      expect(await snapshot()).toEqual(before);
    });

    // `.claude/rules/api.md`: a sign-in held open on the account row; the
    // reset waits for it and ends the session it wrote.
    it('waits for a sign-in that holds the account row, and leaves no session open', async () => {
      const made = await withSecondStep('academic_vice_principal', t.north);
      const call = await t.database.migrator.connection().execute(async (connection) => {
        await sql`begin`.execute(connection);
        await sql`select id from accounts where id = ${made.accountId} for update`.execute(
          connection,
        );
        await sql`
          insert into sessions (account_id, token_hash, created_at, last_used_at)
          values (${made.accountId}, ${'a'.repeat(64)}, ${new Date(START)}, ${new Date(START)})
        `.execute(connection);
        const pending = resetSecondStep(made.id).then((response) => response);
        await untilWaiting('transactionid');
        await sql`commit`.execute(connection);
        return pending;
      });
      expect(call.status, JSON.stringify(call.body)).toBe(200);
      expect(await openSessions(made.accountId)).toEqual([]);
    });
  });

  // Every change route: 404 for another branch's record, an unknown id and a
  // vacancy; 409 `account_missing` without an account; 409 `own_account` on
  // the own account, before the role check (decision 11).
  describe('every change', () => {
    it.each(Object.keys(CHANGES))(
      '%s: 404 and account_missing with nothing written',
      async (name) => {
        const change = CHANGES[name as keyof typeof CHANGES];
        const other = await withAccount([{ role: 'teacher', branchId: t.south }], t.south);
        const bare = await person();
        const before = await snapshot();
        for (const cookie of [t.admin, t.vicePrincipal]) {
          refusedWith(await change(other.id, cookie), 404, 'not_found');
          refusedWith(await change(UNKNOWN, cookie), 404, 'not_found');
          refusedWith(await change(bare.id, cookie), 409, 'account_missing');
        }
        expect(await snapshot()).toEqual(before);
      },
    );

    it.each(Object.keys(CHANGES))(
      '%s: refuses the own account to both administrators',
      async (name) => {
        const change = CHANGES[name as keyof typeof CHANGES];
        const ownAdmin = await recordOf(adminAccount);
        const ownVice = await recordOf(viceAccount);
        const before = await snapshot();
        refusedWith(await change(ownAdmin, t.admin), 409, 'own_account');
        refusedWith(await change(ownVice, t.vicePrincipal), 409, 'own_account');
        expect(await snapshot()).toEqual(before);
        expect((await accessOf(ownAdmin)).can).toEqual({
          lock: false,
          unlock: false,
          resetPassword: false,
          resetSecondStep: false,
        });
      },
    );

    it.each(Object.keys(CHANGES))('%s: refused to the Principal and a Teacher', async (name) => {
      const change = CHANGES[name as keyof typeof CHANGES];
      const made = await teacherOf();
      const before = await snapshot();
      for (const cookie of [t.principal, t.teacher]) {
        refusedWith(await change(made.id, cookie), 403, 'permission_denied');
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  // Who can act: the Academic Vice Principal "may reset passwords and lock
  // accounts only for Teachers, Tutors, Head Teachers and the Head Tutor of
  // his branch" (decision 3, Look first).
  describe('the Academic Vice Principal', () => {
    it.each(['teacher', 'tutor', 'head_teacher', 'head_tutor'] as const)(
      'locks, unlocks and resets a %s of the branch',
      async (role) => {
        const made = await withAccount([{ role, branchId: t.north }]);
        expect((await accessOf(made.id, t.vicePrincipal)).can).toMatchObject({
          lock: true,
          resetPassword: true,
        });
        expect((await lock(made.id, t.vicePrincipal)).status).toBe(200);
        expect((await unlock(made.id, t.vicePrincipal)).status).toBe(200);
        expect((await resetPassword(made.id, t.vicePrincipal)).status).toBe(200);
      },
    );

    it('acts on a person whose Teacher role begins tomorrow', async () => {
      const made = await withAccount([
        {
          role: 'teacher',
          branchId: t.north,
          validFrom: new Date(`${TOMORROW}T00:00:00+05:00`),
        },
      ]);
      expect((await lock(made.id, t.vicePrincipal)).status).toBe(200);
    });

    async function linkedToSouth(staffId: string): Promise<void> {
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: staffId, branch_id: t.south, is_main: false })
        .execute();
    }

    it.each([
      ['a Principal', [{ role: 'principal' as Role, north: true }]],
      [
        'another Academic Vice Principal',
        [{ role: 'academic_vice_principal' as Role, north: true }],
      ],
      ['a Spiritual Vice Principal', [{ role: 'spiritual_vice_principal' as Role, north: true }]],
      ['a Super Admin', [{ role: 'super_admin' as Role, north: null }]],
      ['a Senior Head Teacher', [{ role: 'senior_head_teacher' as Role, north: null }]],
      [
        'a Teacher who is also a Principal',
        [
          { role: 'teacher' as Role, north: true },
          { role: 'principal' as Role, north: true },
        ],
      ],
      [
        'a Teacher who is a Principal in another branch',
        [
          { role: 'teacher' as Role, north: true },
          { role: 'principal' as Role, north: false },
        ],
      ],
      ['a Teacher of another branch only', [{ role: 'teacher' as Role, north: false }]],
      ['a person with no role', []],
    ])('refuses %s with nothing written', async (_name, roles) => {
      const made = await withAccount(
        roles.map((held) => ({
          role: held.role,
          ...(held.north === null ? {} : { branchId: held.north ? t.north : t.south }),
        })),
      );
      if (roles.some((held) => held.north === false)) {
        await linkedToSouth(made.id);
      }
      const before = await snapshot();
      for (const change of [lock, unlock, resetPassword, resetSecondStep]) {
        const response = await change(made.id, t.vicePrincipal);
        refusedWith(response, 403, 'permission_denied');
        // Correction 4: no role, branch or assignment of another branch in a refusal.
        const body = JSON.stringify(response.body);
        expect(body).not.toContain(t.south);
        for (const assignment of made.assignments) {
          expect(body).not.toContain(assignment);
        }
      }
      expect(await snapshot()).toEqual(before);
      const read = await readAccess(made.id, t.vicePrincipal);
      expect(read.status).toBe(200);
      expect(accountAccessSchema.parse(read.body).can).toEqual({
        lock: false,
        unlock: false,
        resetPassword: false,
        resetSecondStep: false,
      });
      const body = JSON.stringify(read.body);
      expect(body).not.toContain(t.south);
      expect(body).not.toContain('principal');
      for (const assignment of made.assignments) {
        expect(body).not.toContain(assignment);
      }
    });

    it('refuses a person whose only Teacher role has ended', async () => {
      const made = await teacherOf();
      const [teacher] = made.assignments;
      if (teacher === undefined) {
        throw new Error('No Teacher role.');
      }
      expect(
        (
          await t.post(`/api/people/staff/${made.id}/roles/${teacher}/end`, t.north, {
            from: TODAY,
          })
        ).status,
      ).toBe(200);
      const before = await snapshot();
      refusedWith(await lock(made.id, t.vicePrincipal), 403, 'permission_denied');
      refusedWith(await resetPassword(made.id, t.vicePrincipal), 403, 'permission_denied');
      expect(await snapshot()).toEqual(before);
    });
  });

  // Accounts and sign-in: "refuses to lock or remove the last active Super
  // Admin" (decision 5): only the lock checks the count.
  describe('the last active Super Admin', () => {
    async function superAdmin() {
      const made = await withAccount();
      const given = await t.post(`/api/people/staff/${made.id}/roles`, t.north, {
        role: 'super_admin',
        branchId: null,
        from: TODAY,
      });
      expect(given.status, JSON.stringify(given.body)).toBe(201);
      const assignment = await t.database.migrator
        .selectFrom('assignments')
        .select('id')
        .where('account_id', '=', made.accountId)
        .where('role', '=', 'super_admin')
        .executeTakeFirstOrThrow();
      return { ...made, assignmentId: assignment.id };
    }

    /** The admin's own role ends next week: planned, so the admin is not counted. */
    async function adminEndsNextWeek(): Promise<void> {
      await t.database.migrator
        .updateTable('assignments')
        .set({ valid_until: new Date('2026-10-17T00:00:00+05:00') })
        .where('id', '=', t.adminAssignment)
        .execute();
    }

    it('refuses to lock the only active one, and locks one of two', async () => {
      const only = await superAdmin();
      await adminEndsNextWeek();
      const before = await snapshot();
      refusedWith(await lock(only.id), 409, 'last_super_admin');
      expect(await snapshot()).toEqual(before);
      // The unlock and the resets remove nobody.
      await superAdmin();
      expect((await lock(only.id)).status).toBe(200);
    });

    /** Holds the lock of the count, does the other change as its route does, then commits once the call waits. */
    async function whileHeld(held: string, call: () => Promise<Response>): Promise<Response> {
      return t.database.migrator.connection().execute(async (connection) => {
        await sql`begin`.execute(connection);
        await sql`select pg_advisory_xact_lock(60701)`.execute(connection);
        await sql.raw(held).execute(connection);
        const pending = call().then((response) => response);
        await untilWaiting('advisory');
        await sql`commit`.execute(connection);
        return pending;
      });
    }

    const lockedSql = (accountId: string, by: string) => `
      update accounts set locked_at = '${new Date(START).toISOString()}',
        locked_by = '${by}', lock_reason = 'Held'
      where id = '${accountId}'
    `;

    it.each(['A locks B', 'B locks A'])(
      'of two Super Admins locking each other at the same moment, refuses the second (%s held)',
      async (heldSide) => {
        const b = await superAdmin();
        const bBrowser = await signedIn(b);
        await t.kit.setUpSecondStep(bBrowser.cookie);
        const adminRecord = await recordOf(adminAccount);
        const answer =
          heldSide === 'B locks A'
            ? await whileHeld(lockedSql(adminAccount, b.accountId), () => lock(b.id, t.admin))
            : await whileHeld(lockedSql(b.accountId, adminAccount), () =>
                lock(adminRecord, bBrowser.cookie),
              );
        refusedWith(answer, 409, 'last_super_admin');
        await t.database.migrator
          .updateTable('accounts')
          .set({ locked_at: null, locked_by: null, lock_reason: null })
          .where('id', 'in', [adminAccount, b.accountId])
          .execute();
      },
    );

    it.each(['the role end held', 'the lock held'])(
      'of a lock and a role end at the same moment, refuses the second (%s)',
      async (heldSide) => {
        const b = await superAdmin();
        const c = await superAdmin();
        await adminEndsNextWeek();
        const answer =
          heldSide === 'the role end held'
            ? await whileHeld(
                `update assignments set valid_until = '${new Date(START).toISOString()}'
                 where id = '${c.assignmentId}'`,
                () => lock(b.id),
              )
            : await whileHeld(lockedSql(b.accountId, adminAccount), () =>
                t.post(`/api/people/staff/${c.id}/roles/${c.assignmentId}/end`, t.north, {
                  from: TODAY,
                }),
              );
        refusedWith(answer, 409, 'last_super_admin');
        await t.database.migrator
          .updateTable('accounts')
          .set({ locked_at: null, locked_by: null, lock_reason: null })
          .where('id', '=', b.accountId)
          .execute();
      },
    );
  });

  // The Academic Vice Principal's limit against a role given at the same
  // moment (same lock of the count, then the staff row): each direction.
  describe('a reset and a role give at the same moment', () => {
    it('refuses the reset that waits for a Principal role given to the person', async () => {
      const made = await teacherOf();
      const before = await accountRow(made.accountId);
      const answer = await t.database.migrator.connection().execute(async (connection) => {
        await sql`begin`.execute(connection);
        await sql`select pg_advisory_xact_lock(60701)`.execute(connection);
        await sql`select id from staff where id = ${made.id} for update`.execute(connection);
        await sql`
          insert into assignments (account_id, role, branch_id, valid_from, created_at)
          values (${made.accountId}, 'principal', ${t.north}, ${new Date(START)}, ${new Date(START)})
        `.execute(connection);
        const pending = resetPassword(made.id, t.vicePrincipal).then((response) => response);
        await untilWaiting('advisory');
        await sql`commit`.execute(connection);
        return pending;
      });
      refusedWith(answer, 403, 'permission_denied');
      expect(await accountRow(made.accountId)).toEqual(before);
      expect(await entries('audit_log', 'account.password_reset', made.accountId)).toEqual([]);
    });

    it('gives the role after a reset that held the person first, and both stand', async () => {
      const made = await teacherOf();
      const answer = await t.database.migrator.connection().execute(async (connection) => {
        await sql`begin`.execute(connection);
        await sql`select pg_advisory_xact_lock(60701)`.execute(connection);
        await sql`select id from staff where id = ${made.id} for update`.execute(connection);
        await sql`select id from accounts where id = ${made.accountId} for update`.execute(
          connection,
        );
        await sql`
          update accounts set must_change_password = true,
            password_expires_at = ${new Date(new Date(START).getTime() + 24 * HOUR)},
            password_reset_by = ${viceAccount}, password_reset_at = ${new Date(START)}
          where id = ${made.accountId}
        `.execute(connection);
        const pending = t
          .post(`/api/people/staff/${made.id}/roles`, t.north, {
            role: 'principal',
            branchId: t.north,
            from: TODAY,
          })
          .then((response) => response);
        await untilWaiting('advisory');
        await sql`commit`.execute(connection);
        return pending;
      });
      expect(answer.status, JSON.stringify(answer.body)).toBe(201);
      expect(await accountRow(made.accountId)).toMatchObject({ password_reset_by: viceAccount });
    });
  });

  // Accounts and sign-in: "A report lists accounts never used" (decision 10,
  // correction 2: since the start of the current employment period).
  describe('the accounts never used', () => {
    const listed = async (cookie = t.admin, branch = t.north) => {
      const response = await t.get('/api/people/accounts/never-used', branch, cookie);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return neverUsedListSchema.parse(response.body).accounts;
    };
    const ids = async (cookie = t.admin) => (await listed(cookie)).map((row) => row.staffId);

    it('lists an account with no session, for the three readers, and not to a Teacher', async () => {
      const made = await teacherOf();
      for (const cookie of [t.admin, t.principal, t.vicePrincipal]) {
        const row = (await listed(cookie)).find((one) => one.staffId === made.id);
        expect(row).toMatchObject({
          login: made.slip.login,
          firstName: 'Bekzod',
          lastName: made.lastName,
          expired: false,
          locked: false,
          passwordValidUntil: made.slip.validUntil,
        });
      }
      refusedWith(
        await t.get('/api/people/accounts/never-used', t.north, t.teacher),
        403,
        'permission_denied',
      );
    });

    it('leaves out a used account, another branch’s and a record without one', async () => {
      const used = await teacherOf();
      await t.kit.signIn(used.slip.login, used.slip.password);
      const south = await withAccount([{ role: 'teacher', branchId: t.south }], t.south);
      const bare = await person();
      const listedIds = await ids();
      expect(listedIds).not.toContain(used.id);
      expect(listedIds).not.toContain(south.id);
      expect(listedIds).not.toContain(bare.id);
    });

    it('marks the first password run out by the injected clock', async () => {
      const made = await teacherOf();
      t.clock.set(new Date(new Date(made.slip.validUntil).getTime() + 1));
      const viewer = await t.kit.fullSession('Gulnora', 'Tursunova');
      await t.kit.giveRole(viewer.account.id, { role: 'principal', branchId: t.north });
      const row = (await listed(viewer.cookie)).find((one) => one.staffId === made.id);
      expect(row?.expired).toBe(true);
    });

    it('leaves out a person who has left for good', async () => {
      const made = await teacherOf();
      await t.post(`/api/people/staff/${made.id}/status`, t.north, {
        status: 'left',
        from: TODAY,
      });
      expect(await ids()).not.toContain(made.id);
    });

    // Correction 2: a session before the re-hire is not a use of the new
    // period; the period begins at 00:00 of the re-hire date in the branch's
    // time zone (Tashkent), read with the injected clock.
    it('lists a re-hired person whose sessions are all from before the re-hire', async () => {
      const made = await teacherOf();
      expect((await t.kit.signIn(made.slip.login, made.slip.password)).status).toBe(200);
      expect(await ids()).not.toContain(made.id);
      expect(
        (
          await t.post(`/api/people/staff/${made.id}/status`, t.north, {
            status: 'left',
            from: TODAY,
          })
        ).status,
      ).toBe(200);
      const rehire = await t.post(`/api/people/staff/${made.id}/status`, t.north, {
        status: 'active',
        from: '2026-10-20',
      });
      expect(rehire.status, JSON.stringify(rehire.body)).toBe(200);
      const password = (rehire.body as { slip: { password: string } | null }).slip?.password ?? '';

      // 19 October 23:59 in Tashkent: not yet the new period.
      t.clock.set('2026-10-19T23:59:00+05:00');
      const early = await t.kit.fullSession('Lola', 'Hamidova');
      await t.kit.giveRole(early.account.id, { role: 'principal', branchId: t.north });
      expect(await ids(early.cookie)).toContain(made.id);

      // 20 October 00:00:30 in Tashkent (still the 19th in UTC): a sign-in
      // now is a use of the new period.
      t.clock.set('2026-10-20T00:00:30+05:00');
      const late = await t.kit.fullSession('Malika', 'Hamidova');
      await t.kit.giveRole(late.account.id, { role: 'principal', branchId: t.north });
      expect(await ids(late.cookie)).toContain(made.id);
      expect((await t.kit.signIn(made.slip.login, password)).status).toBe(200);
      expect(await ids(late.cookie)).not.toContain(made.id);
    });
  });
});
