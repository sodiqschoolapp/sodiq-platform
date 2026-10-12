import {
  BRANCH_HEADER,
  branchesWithoutViceSchema,
  firstPasswordSlipSchema,
  loginSuggestionSchema,
  sessionResponseSchema,
  staffAccountSchema,
  staffDetailSchema,
  staffStatusAnswerSchema,
  superAdminSummarySchema,
  type StaffAccount,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  dayTemplatesKit,
  START,
  TODAY,
  TOMORROW,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { cookieOf, errorCode, NEW_PASSWORD } from '../../testing/sign-in-kit.js';

// All names are invented. Task 2.3a, pull request #62: the account section of
// a staff record. docs/spec/edge-cases/people-roles-accounts.md (Who can act,
// Staff over time, Accounts and sign-in); the owner's answers 14 and 15; the
// plan's decisions and the review's corrections. The clock stands at 23:55 on
// 10 October 2026 in Tashkent.
describe('the account section of a staff record', () => {
  let t: DayTemplatesKit;
  let academic: string;
  let steam: string;
  let count = 0;

  /** A count as Latin letters, so that a name stays of letters only. */
  const lettersOf = (n: number): string =>
    n < 26
      ? String.fromCharCode(97 + n)
      : lettersOf(Math.floor(n / 26) - 1) + String.fromCharCode(97 + (n % 26));

  /** A new person of the branch; the surname is new each time. */
  async function person(
    overrides: Record<string, unknown> = {},
    branch = t.north,
  ): Promise<{ id: string; lastName: string }> {
    count += 1;
    const lastName = `Rahimov${lettersOf(count)}`;
    const response = await t.post('/api/people/staff', branch, {
      firstName: 'Akmal',
      lastName,
      fatherName: '',
      sex: 'male',
      birthDate: '1990-01-01',
      educationLevel: 'master',
      phone: `+99891${String(1000000 + count)}`,
      email: '',
      jshshir: '',
      admissionDate: '2026-09-01',
      contractType: 'full_time',
      contractDate: '2026-09-01',
      weeklyLessons: 18,
      dailyLessons: 5,
      divisions: [{ divisionId: academic, departmentId: steam, main: true }],
      ...overrides,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const created = staffDetailSchema.parse(response.body);
    return { id: created.id, lastName: created.lastName };
  }

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  const section = async (id: string, branch = t.north, cookie = t.admin) => {
    const response = await t.get(`/api/people/staff/${id}/account`, branch, cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return staffAccountSchema.parse(response.body);
  };

  async function withAccount(login?: string, branch = t.north) {
    const made = await person({}, branch);
    const chosen = login ?? `a.${made.lastName.toLowerCase()}`;
    const response = await t.post(`/api/people/staff/${made.id}/account`, branch, {
      login: chosen,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const slip = firstPasswordSlipSchema.parse(response.body);
    const account = await t.database.migrator
      .selectFrom('accounts')
      .select('id')
      .where('login', '=', slip.login)
      .executeTakeFirstOrThrow();
    return { ...made, slip, accountId: account.id };
  }

  const give = (id: string, body: object, branch = t.north, cookie = t.admin) =>
    t.post(`/api/people/staff/${id}/roles`, branch, body, cookie);

  const end = (id: string, assignmentId: string, from: string, cookie = t.admin) =>
    t.post(`/api/people/staff/${id}/roles/${assignmentId}/end`, t.north, { from }, cookie);

  const roleOf = (answer: StaffAccount, role: string) => {
    const found = answer.account?.roles.find((held) => held.role === role);
    if (found === undefined) {
      throw new Error(`No ${role} role in the answer.`);
    }
    return found;
  };

  /** Every row the routes may write, and the audit count: what a refusal leaves as it was. */
  async function snapshot(): Promise<Record<string, unknown>> {
    const newest = await sql<{ id: string }>`
      select id from audit_log union all select id from audit_log_school order by id desc limit 1
    `.execute(t.database.migrator);
    const rows: Record<string, unknown> = {
      audit: await t.auditCount(),
      newest: newest.rows[0]?.id ?? null,
    };
    for (const table of [
      'accounts',
      'assignments',
      'staff',
      'sessions',
      'staff_statuses',
      'staff_branches',
      'staff_status_role_ends',
    ] as const) {
      rows[table] = await sql`select * from ${sql.table(table)} order by 1`.execute(
        t.database.migrator,
      );
    }
    return rows;
  }

  /** The id of the admin's Super Admin assignment, and its account. */
  async function admin(): Promise<{ accountId: string }> {
    const row = await t.database.migrator
      .selectFrom('assignments')
      .select('account_id')
      .where('id', '=', t.adminAssignment)
      .executeTakeFirstOrThrow();
    return { accountId: row.account_id };
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

  // Every test starts with the admin as the one Super Admin: the others are
  // taken back, so that the count of one test does not reach the next.
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
  });

  /** The entries of an action in the school's log (no branch), of one record when named. */
  const schoolEntries = (action: string, recordId?: string) => {
    let query = t.database.migrator
      .selectFrom('audit_log_school')
      .selectAll()
      .where('action', '=', action)
      .orderBy('occurred_at')
      .orderBy('id');
    if (recordId !== undefined) {
      query = query.where('record_id', '=', recordId);
    }
    return query.execute();
  };

  describe('the login suggestion (answer 14)', () => {
    const suggest = async (id: string) => {
      const response = await t.get(`/api/people/staff/${id}/account/suggestion`, t.north);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return loginSuggestionSchema.parse(response.body).login;
    };

    /** Takes a login for a test, as an account nobody uses. */
    async function take(login: string): Promise<void> {
      await t.database.migrator
        .insertInto('accounts')
        .values({
          login,
          password_hash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA',
          must_change_password: false,
          created_at: new Date(START),
        })
        .execute();
    }

    it('tries the three forms in order, then numbers the second', async () => {
      const made = await person({ fatherName: 'Botir' });
      const last = made.lastName.toLowerCase();
      expect(await suggest(made.id)).toBe(`a.${last}`);
      await take(`a.${last}`);
      expect(await suggest(made.id)).toBe(`akmal.${last}`);
      await take(`akmal.${last}`);
      expect(await suggest(made.id)).toBe(`akmal.b.${last}`);
      await take(`akmal.b.${last}`);
      expect(await suggest(made.id)).toBe(`akmal.${last}2`);
      await take(`akmal.${last}2`);
      expect(await suggest(made.id)).toBe(`akmal.${last}3`);
    });

    it('skips the third form without a father’s name', async () => {
      const made = await person();
      const last = made.lastName.toLowerCase();
      await take(`a.${last}`);
      await take(`akmal.${last}`);
      expect(await suggest(made.id)).toBe(`akmal.${last}2`);
    });

    it('drops spaces, hyphens and apostrophes, and writes oʻ and gʻ as o and g', async () => {
      const made = await person({ firstName: 'Oʻtkir Jon', lastName: 'Gʻaniyeva-Saidova' });
      expect(await suggest(made.id)).toBe('o.ganiyevasaidova');
      await take('o.ganiyevasaidova');
      expect(await suggest(made.id)).toBe('otkirjon.ganiyevasaidova');
    });

    it('answers no login when no form fits the length, and the form refuses one too long', async () => {
      const made = await person({ lastName: 'K'.padEnd(60, 'a') });
      // `a.` and 60 letters fit; `akmal.` and 60 letters do not.
      const short = `a.k${'a'.repeat(59)}`;
      expect(await suggest(made.id)).toBe(short);
      await take(short);
      expect(await suggest(made.id)).toBeNull();
      const response = await t.post(`/api/people/staff/${made.id}/account`, t.north, {
        login: `akmal.k${'a'.repeat(59)}`,
      });
      refusedWith(response, 400, 'validation_failed');
    });
  });

  describe('create', () => {
    it('makes the account with the chosen login, links it once and answers the slip once', async () => {
      const made = await person();
      const login = `akmal.${made.lastName.toLowerCase()}`;
      const response = await t.post(`/api/people/staff/${made.id}/account`, t.north, { login });

      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const slip = firstPasswordSlipSchema.parse(response.body);
      expect(slip).toEqual({
        firstName: 'Akmal',
        lastName: made.lastName,
        login,
        password: expect.stringMatching(/^[A-Za-z0-9]{16}$/) as unknown,
        // "First passwords are random, valid for 7 days".
        validUntil: new Date(new Date(START).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const linked = await t.database.migrator
        .selectFrom('staff')
        .innerJoin('accounts', 'accounts.id', 'staff.account_id')
        .select(['accounts.login', 'accounts.must_change_password'])
        .where('staff.id', '=', made.id)
        .executeTakeFirstOrThrow();
      expect(linked).toEqual({ login, must_change_password: true });

      // Correction 4: the password is in no audit entry.
      const created = (await schoolEntries('account.create')).find(
        (row) => (row.new_value as { login?: string } | null)?.login === login,
      );
      expect(created).toMatchObject({
        actor_id: (await admin()).accountId,
        assignment_id: t.adminAssignment,
        person_id: made.id,
        request_id: response.headers['x-request-id'],
      });
      expect(JSON.stringify(created)).not.toContain(slip.password);

      // The section shows it, and the person signs in with the slip.
      const read = await section(made.id);
      expect(read.account).toMatchObject({ login, neverUsed: true, locked: false, roles: [] });
      const signedIn = await t.kit.signIn(login, slip.password);
      expect(signedIn.status).toBe(200);
      expect((await section(made.id)).account?.neverUsed).toBe(false);
    });

    it('refuses a second account, a taken login and a login of another form', async () => {
      const first = await withAccount();
      refusedWith(
        await t.post(`/api/people/staff/${first.id}/account`, t.north, { login: 'z.other' }),
        409,
        'account_exists',
      );
      const second = await person();
      const before = await snapshot();
      const taken = await t.post(`/api/people/staff/${second.id}/account`, t.north, {
        login: first.slip.login,
      });
      refusedWith(taken, 409, 'login_taken');
      expect((taken.body as { error: { details: unknown } }).error.details).toEqual([
        { path: 'login', code: 'taken', message: expect.any(String) as unknown },
      ]);
      for (const login of ['Akmal.K', 'a.karimov.', 'а.каримов', 'a.b.c.karimov']) {
        refusedWith(
          await t.post(`/api/people/staff/${second.id}/account`, t.north, { login }),
          400,
          'validation_failed',
        );
      }
      expect(await snapshot()).toEqual(before);
    });

    it('refuses a person who has left (decision 12)', async () => {
      const made = await person();
      const left = await t.post(`/api/people/staff/${made.id}/status`, t.north, {
        status: 'left',
        from: TODAY,
      });
      expect(left.status, JSON.stringify(left.body)).toBe(200);
      refusedWith(
        await t.post(`/api/people/staff/${made.id}/account`, t.north, { login: 'l.leftone' }),
        409,
        'staff_left',
      );
      expect((await section(made.id)).left).toBe(true);
    });

    it('answers 404 for a record of another branch and an unknown one', async () => {
      const south = await withAccount(undefined, t.south);
      const southRole = staffAccountSchema.parse(
        (await give(south.id, { role: 'teacher', branchId: t.south, from: TODAY }, t.south)).body,
      );
      const southAssignment = roleOf(southRole, 'teacher').id;
      const northern = await withAccount();
      const before = await snapshot();
      // A record of North with the role of a person of South.
      refusedWith(await end(northern.id, southAssignment, TODAY), 404, 'not_found');
      for (const id of [south.id, UNKNOWN]) {
        refusedWith(
          await t.post(`/api/people/staff/${id}/account`, t.north, { login: 'n.nobody' }),
          404,
          'not_found',
        );
        refusedWith(await t.get(`/api/people/staff/${id}/account`, t.north), 404, 'not_found');
        refusedWith(
          await t.get(`/api/people/staff/${id}/account/suggestion`, t.north),
          404,
          'not_found',
        );
        refusedWith(
          await give(id, { role: 'teacher', branchId: t.north, from: TODAY }),
          404,
          'not_found',
        );
        refusedWith(await end(id, southAssignment, TODAY), 404, 'not_found');
      }
      expect(await snapshot()).toEqual(before);
    });

    it('refuses the Principal, the Academic Vice Principal and a Teacher every change', async () => {
      const made = await withAccount();
      const before = await snapshot();
      for (const cookie of [t.principal, t.vicePrincipal, t.teacher]) {
        refusedWith(
          await t.post(`/api/people/staff/${made.id}/account`, t.north, { login: 'x.y' }, cookie),
          403,
          'permission_denied',
        );
        refusedWith(
          await give(made.id, { role: 'teacher', branchId: t.north, from: TODAY }, t.north, cookie),
          403,
          'permission_denied',
        );
        refusedWith(await end(made.id, UNKNOWN, TODAY, cookie), 403, 'permission_denied');
        refusedWith(
          await t.get(`/api/people/staff/${made.id}/account/suggestion`, t.north, cookie),
          403,
          'permission_denied',
        );
        refusedWith(await t.kit.get('/api/access/super-admins', cookie), 403, 'permission_denied');
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('give', () => {
    it('gives a role from today, at 00:00, naming the assignment, the person and the request', async () => {
      const made = await withAccount();
      const response = await give(made.id, { role: 'teacher', branchId: t.north, from: TODAY });

      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const teacher = roleOf(staffAccountSchema.parse(response.body), 'teacher');
      expect(teacher).toMatchObject({
        branchId: t.north,
        branchName: 'North',
        from: TODAY,
        until: null,
        state: 'current',
        endedBy: null,
      });
      const given = await t.database.migrator
        .selectFrom('assignments')
        .select(['valid_from', 'given_by'])
        .where('id', '=', teacher.id)
        .executeTakeFirstOrThrow();
      expect(given).toEqual({
        valid_from: new Date('2026-10-10T00:00:00+05:00'),
        given_by: (await admin()).accountId,
      });
      expect(await t.entries('assignment.given', teacher.id)).toMatchObject([
        {
          branch_id: t.north,
          assignment_id: t.adminAssignment,
          person_id: made.id,
          request_id: response.headers['x-request-id'],
        },
      ]);
    });

    it('gives a role in a further branch of the person, written to that branch’s log', async () => {
      const made = await withAccount();
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: made.id, branch_id: t.south, is_main: false })
        .execute();
      const response = await give(made.id, { role: 'tutor', branchId: t.south, from: TOMORROW });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const tutor = roleOf(staffAccountSchema.parse(response.body), 'tutor');
      expect(tutor).toMatchObject({ branchId: t.south, state: 'planned', from: TOMORROW });
      expect(await t.entries('assignment.given', tutor.id)).toMatchObject([{ branch_id: t.south }]);
    });

    it('refuses a branch of no link, a past date, an overlap and a record with no account', async () => {
      const made = await withAccount();
      const plain = await person();
      expect(
        (await give(made.id, { role: 'teacher', branchId: t.north, from: TODAY })).status,
      ).toBe(201);
      const before = await snapshot();
      refusedWith(
        await give(made.id, { role: 'teacher', branchId: t.south, from: TODAY }),
        409,
        'role_branch_not_person',
      );
      // An unknown branch id in the body reads as one the person is not linked
      // to, as another branch does (code round 1, finding 3).
      refusedWith(
        await give(made.id, { role: 'teacher', branchId: UNKNOWN, from: TODAY }),
        409,
        'role_branch_not_person',
      );
      refusedWith(
        await give(made.id, { role: 'principal', branchId: t.north, from: '2026-10-09' }),
        409,
        'role_from_past',
      );
      refusedWith(
        await give(made.id, { role: 'teacher', branchId: t.north, from: TOMORROW }),
        409,
        'role_overlap',
      );
      refusedWith(
        await give(plain.id, { role: 'teacher', branchId: t.north, from: TODAY }),
        409,
        'no_account',
      );
      // The Super Admin has no branch; every other role has one.
      refusedWith(
        await give(made.id, { role: 'super_admin', branchId: t.north, from: TODAY }),
        400,
        'validation_failed',
      );
      refusedWith(
        await give(made.id, { role: 'tutor', branchId: null, from: TODAY }),
        400,
        'validation_failed',
      );
      // Decision 6: Head Teachers come with their subjects in 2.3b.
      refusedWith(
        await give(made.id, { role: 'head_teacher', branchId: t.north, from: TODAY }),
        400,
        'validation_failed',
      );
      expect(await snapshot()).toEqual(before);
    });

    // Code round 1, finding 1: "Left: all roles ended" holds for a role given
    // after the `left` was written too.
    it('ends a role given before a planned leave at it, and refuses one from the leave on', async () => {
      const made = await withAccount();
      const left = await t.post(`/api/people/staff/${made.id}/status`, t.north, {
        status: 'left',
        from: '2026-12-01',
      });
      expect(left.status, JSON.stringify(left.body)).toBe(200);
      const before = await snapshot();
      for (const from of ['2026-12-01', '2026-12-05']) {
        refusedWith(
          await give(made.id, { role: 'teacher', branchId: t.north, from }),
          409,
          'staff_left',
        );
      }
      expect(await snapshot()).toEqual(before);

      const response = await give(made.id, { role: 'teacher', branchId: t.north, from: TOMORROW });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const teacher = roleOf(staffAccountSchema.parse(response.body), 'teacher');
      expect(teacher).toMatchObject({ from: TOMORROW, until: '2026-12-01', state: 'planned' });
      expect(await t.entries('assignment.end', teacher.id)).toMatchObject([
        { reason: 'staff_left', person_id: made.id, assignment_id: t.adminAssignment },
      ]);
      // Its end is not moved past the leave.
      const ended = await snapshot();
      refusedWith(await end(made.id, teacher.id, '2026-12-10'), 409, 'staff_left');
      expect(await snapshot()).toEqual(ended);
      expect((await end(made.id, teacher.id, '2026-11-20')).status).toBe(200);
      expect(roleOf(await section(made.id), 'teacher').until).toBe('2026-11-20');

      // A second role, then the leave taken back: the role it ended comes back.
      const tutor = roleOf(
        staffAccountSchema.parse(
          (await give(made.id, { role: 'tutor', branchId: t.north, from: TODAY })).body,
        ),
        'tutor',
      );
      expect(tutor.until).toBe('2026-12-01');
      const back = await t.post(`/api/people/staff/${made.id}/status`, t.north, {
        status: 'active',
        from: TODAY,
      });
      expect(back.status, JSON.stringify(back.body)).toBe(200);
      const after = await section(made.id);
      expect(roleOf(after, 'tutor').until).toBeNull();
      // The end typed later is not the leave's: it stays.
      expect(roleOf(after, 'teacher').until).toBe('2026-11-20');
    });

    it('refuses a role that would begin while the person is left, a return planned or not', async () => {
      const made = await withAccount();
      expect(
        (
          await t.post(`/api/people/staff/${made.id}/status`, t.north, {
            status: 'left',
            from: TODAY,
          })
        ).status,
      ).toBe(200);
      const back = await t.post(`/api/people/staff/${made.id}/status`, t.north, {
        status: 'active',
        from: '2026-10-20',
      });
      expect(back.status, JSON.stringify(back.body)).toBe(200);
      const before = await snapshot();
      for (const from of [TODAY, '2026-10-19']) {
        refusedWith(
          await give(made.id, { role: 'teacher', branchId: t.north, from }),
          409,
          'staff_left',
        );
      }
      expect(await snapshot()).toEqual(before);
      const response = await give(made.id, {
        role: 'teacher',
        branchId: t.north,
        from: '2026-10-20',
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(roleOf(staffAccountSchema.parse(response.body), 'teacher').until).toBeNull();
    });

    it('refuses a fourth Super Admin', async () => {
      const second = await withAccount();
      const third = await withAccount();
      const fourth = await withAccount();
      expect(
        (await give(second.id, { role: 'super_admin', branchId: null, from: TODAY })).status,
      ).toBe(201);
      expect(
        (await give(third.id, { role: 'super_admin', branchId: null, from: TODAY })).status,
      ).toBe(201);
      refusedWith(
        await give(fourth.id, { role: 'super_admin', branchId: null, from: TODAY }),
        409,
        'too_many_super_admins',
      );
      // Taken back again, so the other tests have room.
      for (const made of [second, third]) {
        const held = roleOf(await section(made.id), 'super_admin');
        expect((await end(made.id, held.id, TODAY)).status).toBe(200);
      }
    });
  });

  describe('end', () => {
    it('ends a role now, or at 00:00 of a later date', async () => {
      const made = await withAccount();
      const given = staffAccountSchema.parse(
        (await give(made.id, { role: 'teacher', branchId: t.north, from: TODAY })).body,
      );
      const later = staffAccountSchema.parse(
        (await give(made.id, { role: 'tutor', branchId: t.north, from: TODAY })).body,
      );
      const teacher = roleOf(given, 'teacher');
      const tutor = roleOf(later, 'tutor');

      const now = await end(made.id, teacher.id, TODAY);
      expect(now.status, JSON.stringify(now.body)).toBe(200);
      expect(roleOf(staffAccountSchema.parse(now.body), 'teacher')).toMatchObject({
        state: 'ended',
        until: TODAY,
        endedBy: { login: expect.any(String) as unknown },
      });
      const ahead = await end(made.id, tutor.id, '2026-10-20');
      expect(roleOf(staffAccountSchema.parse(ahead.body), 'tutor')).toMatchObject({
        state: 'current',
        until: '2026-10-20',
      });
      const ends = await t.database.migrator
        .selectFrom('assignments')
        .select(['id', 'valid_until'])
        .where('id', 'in', [teacher.id, tutor.id])
        .execute();
      expect(new Map(ends.map((row) => [row.id, row.valid_until]))).toEqual(
        new Map([
          [teacher.id, new Date(START)],
          [tutor.id, new Date('2026-10-20T00:00:00+05:00')],
        ]),
      );
      // An end still ahead is moved (0.7a).
      expect((await end(made.id, tutor.id, '2026-10-15')).status).toBe(200);
      expect(roleOf(await section(made.id), 'tutor').until).toBe('2026-10-15');
      expect(await t.entries('assignment.ended', tutor.id)).toMatchObject([
        { assignment_id: t.adminAssignment, person_id: made.id },
        { assignment_id: t.adminAssignment, person_id: made.id },
      ]);
    });

    it('refuses an end from a past date, an ended role and a role of another account', async () => {
      const made = await withAccount();
      const other = await withAccount();
      const teacher = roleOf(
        staffAccountSchema.parse(
          (await give(made.id, { role: 'teacher', branchId: t.north, from: TODAY })).body,
        ),
        'teacher',
      );
      const before = await snapshot();
      refusedWith(await end(made.id, teacher.id, '2026-10-09'), 409, 'role_from_past');
      refusedWith(await end(other.id, teacher.id, TODAY), 404, 'not_found');
      refusedWith(await end(made.id, UNKNOWN, TODAY), 404, 'not_found');
      expect(await snapshot()).toEqual(before);
      expect((await end(made.id, teacher.id, TODAY)).status).toBe(200);
      refusedWith(await end(made.id, teacher.id, TODAY), 409, 'assignment_ended');
    });

    // Decision 13: "End today" ends at now; given again from today it would
    // overlap, so the screen offers tomorrow.
    it('gives a role again from the day after it was ended today', async () => {
      const made = await withAccount();
      const teacher = roleOf(
        staffAccountSchema.parse(
          (await give(made.id, { role: 'teacher', branchId: t.north, from: TODAY })).body,
        ),
        'teacher',
      );
      expect((await end(made.id, teacher.id, TODAY)).status).toBe(200);
      refusedWith(
        await give(made.id, { role: 'teacher', branchId: t.north, from: TODAY }),
        409,
        'role_overlap',
      );
      expect(
        (await give(made.id, { role: 'teacher', branchId: t.north, from: TOMORROW })).status,
      ).toBe(201);
    });

    it('refuses the end of one’s own Super Admin role', async () => {
      const own = await person();
      await t.database.migrator
        .updateTable('staff')
        .set({ account_id: (await admin()).accountId })
        .where('id', '=', own.id)
        .execute();
      refusedWith(await end(own.id, t.adminAssignment, TODAY), 409, 'own_super_admin_role');
      // The admin's account stays linked: its name shows below (correction 1).
    });
  });

  // Decision 5: an account counts while its Super Admin role has begun and
  // has no end, it is not locked, and its record is not inactive or left,
  // today or planned.
  describe('the last active Super Admin', () => {
    async function secondSuperAdmin(branch = t.north) {
      const made = await withAccount(undefined, branch);
      const response = await give(
        made.id,
        { role: 'super_admin', branchId: null, from: TODAY },
        branch,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const given = staffAccountSchema.parse(response.body);
      return { ...made, assignmentId: roleOf(given, 'super_admin').id };
    }

    /** The admin's own Super Admin role ends next week, as another Super Admin could have planned. */
    async function adminEndsNextWeek(): Promise<void> {
      await t.database.migrator
        .updateTable('assignments')
        .set({ valid_until: new Date('2026-10-17T00:00:00+05:00') })
        .where('id', '=', t.adminAssignment)
        .execute();
    }

    async function adminStays(): Promise<void> {
      await t.database.migrator
        .updateTable('assignments')
        .set({ valid_until: null, ended_by: null })
        .where('id', '=', t.adminAssignment)
        .execute();
    }

    const count = async () =>
      superAdminSummarySchema.parse((await t.kit.get('/api/access/super-admins', t.admin)).body)
        .active;

    it('counts the active Super Admins for the banner, the Super Admin alone', async () => {
      expect(await count()).toBe(1);
      const other = await secondSuperAdmin(t.south);
      expect(await count()).toBe(2);
      // A record of another branch, inactive from a later date, is counted out.
      const inactive = await t.post(`/api/people/staff/${other.id}/status`, t.south, {
        status: 'inactive',
        from: '2026-11-01',
      });
      expect(inactive.status, JSON.stringify(inactive.body)).toBe(200);
      expect(await count()).toBe(1);
      refusedWith(
        await t.kit.get('/api/access/super-admins', t.principal),
        403,
        'permission_denied',
      );
    });

    it('refuses to end the role of the last one', async () => {
      const other = await secondSuperAdmin();
      await adminEndsNextWeek();
      try {
        const before = await snapshot();
        refusedWith(await end(other.id, other.assignmentId, TODAY), 409, 'last_super_admin');
        refusedWith(await end(other.id, other.assignmentId, '2026-10-30'), 409, 'last_super_admin');
        expect(await snapshot()).toEqual(before);
      } finally {
        await adminStays();
      }
      expect((await end(other.id, other.assignmentId, TODAY)).status).toBe(200);
    });

    it('refuses to set the record of the last one inactive or left, today or later', async () => {
      const other = await secondSuperAdmin();
      await adminEndsNextWeek();
      try {
        const before = await snapshot();
        for (const status of ['inactive', 'left']) {
          for (const from of [TODAY, '2026-12-01']) {
            refusedWith(
              await t.post(`/api/people/staff/${other.id}/status`, t.north, { status, from }),
              409,
              'last_super_admin',
            );
          }
        }
        expect(await snapshot()).toEqual(before);
      } finally {
        await adminStays();
      }
      expect((await end(other.id, other.assignmentId, TODAY)).status).toBe(200);
    });

    // Finding 1 of the spec review of the build: of two changes at the same
    // moment that each remove one of the last two Super Admins, the second
    // waits for the first, sees it and is refused. The held side does what
    // its route does, under the same lock; the real route runs on the other.
    it.each([
      ['a role end', 'a role end', 'end', 'end'],
      ['a role end', 'a status change', 'end', 'status'],
      ['a status change', 'a role end', 'status', 'end'],
      // Code round 1, finding 4: the two status changes meet on the lock too.
      ['a status change', 'a status change', 'status', 'status'],
    ])('refuses %s that waits for %s at the same moment', async (_route, _held, route, held) => {
      const first = await secondSuperAdmin();
      const second = await secondSuperAdmin();
      await adminEndsNextWeek();
      try {
        const answer = await t.database.migrator.connection().execute(async (connection) => {
          await sql`begin`.execute(connection);
          await sql`select pg_advisory_xact_lock(60701)`.execute(connection);
          if (held === 'end') {
            await sql`
                update assignments set valid_until = ${new Date(START)}
                where id = ${second.assignmentId}
              `.execute(connection);
          } else {
            await sql`
                update staff_statuses set valid_until = '2026-12-01'
                where staff_id = ${second.id} and status = 'active'
              `.execute(connection);
            await sql`
                insert into staff_statuses (staff_id, status, valid_from)
                values (${second.id}, 'left', '2026-12-01')
              `.execute(connection);
          }
          const call =
            route === 'end'
              ? end(first.id, first.assignmentId, TODAY).then((response) => response)
              : t
                  .post(`/api/people/staff/${first.id}/status`, t.north, {
                    status: 'left',
                    from: '2026-12-01',
                  })
                  .then((response) => response);
          for (let tries = 0; tries < 100; tries += 1) {
            const waiting = await sql<{ waiting: number }>`
                select count(*)::int as waiting from pg_locks
                where locktype = 'advisory' and not granted
              `.execute(t.database.migrator);
            if ((waiting.rows[0]?.waiting ?? 0) > 0) {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          await sql`commit`.execute(connection);
          return call;
        });
        refusedWith(answer, 409, 'last_super_admin');
      } finally {
        await adminStays();
      }
    });

    // Finding 4 of the plan review: the Super Admin count is locked first,
    // before the record, on the role end and on the status route.
    it.each([
      ['a role end', 'end'],
      ['a status change', 'status'],
    ])('takes the lock of the count before the record on %s', async (_name, route) => {
      const other = await secondSuperAdmin();
      const holder = await t.database.migrator.connection().execute(async (connection) => {
        await sql`begin`.execute(connection);
        await sql`select pg_advisory_xact_lock(60701)`.execute(connection);
        const call =
          route === 'end'
            ? end(other.id, other.assignmentId, TODAY).then((response) => response)
            : t
                .post(`/api/people/staff/${other.id}/status`, t.north, {
                  status: 'inactive',
                  from: '2026-12-01',
                })
                .then((response) => response);
        // The route waits for the count, holding no lock on the record yet.
        for (let tries = 0; tries < 100; tries += 1) {
          const waiting = await sql<{ waiting: number }>`
            select count(*)::int as waiting from pg_locks
            where locktype = 'advisory' and not granted
          `.execute(t.database.migrator);
          if ((waiting.rows[0]?.waiting ?? 0) > 0) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const free =
          await sql`select id from staff where id = ${other.id} for update nowait`.execute(
            connection,
          );
        expect(free.rows).toHaveLength(1);
        await sql`rollback`.execute(connection);
        return call;
      });
      expect(holder.status, JSON.stringify(holder.body)).toBe(200);
      if (route === 'status') {
        await t.database.migrator
          .updateTable('staff_statuses')
          .set({ valid_until: '2026-12-01' })
          .where('staff_id', '=', other.id)
          .where('status', '=', 'inactive')
          .execute();
      }
      const held = roleOf(await section(other.id), 'super_admin');
      if (held.state !== 'ended') {
        expect((await end(other.id, held.id, TODAY)).status).toBe(200);
      }
    });
  });

  // Task 2.3b-2: the alert of a branch with no active Academic Vice Principal
  // (edge cases, Who can act), for the Super Admin alone. The injected clock
  // decides the answer on each request (decisions 1 to 3 of #64).
  describe('the branches without an active Academic Vice Principal', () => {
    const listed = async (cookie = t.admin) => {
      const response = await t.kit.get('/api/access/branches-without-vice-principal', cookie);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return branchesWithoutViceSchema.parse(response.body).branches;
    };
    const ids = async () => (await listed()).map((branch) => branch.id);

    it('lists the branch with none by id and name, and not the one with an active one', async () => {
      const before = await t.auditCount();
      const branches = await listed();
      expect(branches).toContainEqual({ id: t.south, name: 'South' });
      expect(branches.map((branch) => branch.id)).not.toContain(t.north);
      expect(await t.auditCount()).toBe(before);
    });

    it('follows the clock: a role that begins tomorrow takes the branch out at midnight', async () => {
      const branch = await t.newBranch();
      const made = await withAccount(undefined, branch);
      const given = await give(
        made.id,
        { role: 'academic_vice_principal', branchId: branch, from: TOMORROW },
        branch,
      );
      expect(given.status, JSON.stringify(given.body)).toBe(201);
      expect(await ids()).toContain(branch);
      t.clock.set('2026-10-11T00:01:00+05:00');
      try {
        expect(await ids()).not.toContain(branch);
      } finally {
        t.clock.set(START);
      }
    });

    it('follows the clock: an inactive status from tomorrow puts the branch in at midnight', async () => {
      const branch = await t.newBranch();
      const made = await withAccount(undefined, branch);
      const given = await give(
        made.id,
        { role: 'academic_vice_principal', branchId: branch, from: TODAY },
        branch,
      );
      expect(given.status, JSON.stringify(given.body)).toBe(201);
      const inactive = await t.post(`/api/people/staff/${made.id}/status`, branch, {
        status: 'inactive',
        from: TOMORROW,
      });
      expect(inactive.status, JSON.stringify(inactive.body)).toBe(200);
      expect(await ids()).not.toContain(branch);
      t.clock.set('2026-10-11T00:01:00+05:00');
      try {
        expect(await ids()).toContain(branch);
      } finally {
        t.clock.set(START);
      }
    });

    it('is refused to every other role, with nothing written', async () => {
      const before = await t.auditCount();
      for (const cookie of [t.principal, t.vicePrincipal, t.teacher]) {
        refusedWith(
          await t.kit.get('/api/access/branches-without-vice-principal', cookie),
          403,
          'permission_denied',
        );
      }
      expect(await t.auditCount()).toBe(before);
    });
  });

  // Decision 7: a re-hire gives a new first password and its slip; the login
  // and staff ID stay; no role comes back (decision 8).
  describe('a re-hire', () => {
    it('forces a password change with a new first password, valid 7 days from the re-hire', async () => {
      const made = await withAccount();
      const before = await t.database.migrator
        .selectFrom('staff')
        .select('staff_id')
        .where('id', '=', made.id)
        .executeTakeFirstOrThrow();
      await give(made.id, { role: 'teacher', branchId: t.north, from: TODAY });
      const signedIn = await t.kit.signIn(made.slip.login, made.slip.password);
      expect(signedIn.status).toBe(200);
      expect(
        (
          await t.post(`/api/people/staff/${made.id}/status`, t.north, {
            status: 'left',
            from: TOMORROW,
          })
        ).status,
      ).toBe(200);
      const rehired = await t.post(`/api/people/staff/${made.id}/status`, t.north, {
        status: 'active',
        from: '2026-10-20',
      });
      // The planned `left` is taken back and replaced; nothing to re-hire yet.
      expect(staffStatusAnswerSchema.parse(rehired.body).slip).toBeNull();

      await t.post(`/api/people/staff/${made.id}/status`, t.north, {
        status: 'left',
        from: TODAY,
      });
      const response = await t.post(`/api/people/staff/${made.id}/status`, t.north, {
        status: 'active',
        from: '2026-10-20',
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const answer = staffStatusAnswerSchema.parse(response.body);
      expect(answer.slip).toEqual({
        firstName: 'Akmal',
        lastName: made.lastName,
        login: made.slip.login,
        password: expect.stringMatching(/^[A-Za-z0-9]{16}$/) as unknown,
        validUntil: new Date('2026-10-27T00:00:00+05:00').toISOString(),
      });
      expect(answer.staffId).toBe(before.staff_id);
      const account = await t.database.migrator
        .selectFrom('accounts')
        .select(['must_change_password', 'password_expires_at'])
        .where('id', '=', made.accountId)
        .executeTakeFirstOrThrow();
      expect(account).toEqual({
        must_change_password: true,
        password_expires_at: new Date('2026-10-27T00:00:00+05:00'),
      });
      const open = await t.database.migrator
        .selectFrom('sessions')
        .select('id')
        .where('account_id', '=', made.accountId)
        .where('ended_at', 'is', null)
        .execute();
      expect(open).toEqual([]);
      const [entry] = await schoolEntries('account.rehire_password', made.accountId);
      expect(entry).toMatchObject({ person_id: made.id, assignment_id: t.adminAssignment });
      expect(JSON.stringify(entry)).not.toContain(answer.slip?.password ?? '-');
      // No role comes back.
      const roles = (await section(made.id)).account?.roles ?? [];
      expect(roles.every((role) => role.state === 'ended')).toBe(true);

      // A re-hire taken back keeps the new password (decision 7).
      await t.post(`/api/people/staff/${made.id}/status`, t.north, {
        status: 'left',
        from: '2026-10-20',
      });
      const kept = await t.database.migrator
        .selectFrom('accounts')
        .select('password_expires_at')
        .where('id', '=', made.accountId)
        .executeTakeFirstOrThrow();
      expect(kept.password_expires_at).toEqual(new Date('2026-10-27T00:00:00+05:00'));
    });

    // Code round 1, finding 7: re-hired on leave, the change to `inactive` is
    // the re-hire; the return to `active` later is not a second one.
    it('forces the change at a re-hire on leave, and not again at the return', async () => {
      const made = await withAccount();
      expect(
        (
          await t.post(`/api/people/staff/${made.id}/status`, t.north, {
            status: 'left',
            from: TODAY,
          })
        ).status,
      ).toBe(200);
      const onLeave = await t.post(`/api/people/staff/${made.id}/status`, t.north, {
        status: 'inactive',
        from: '2026-10-20',
      });
      expect(onLeave.status, JSON.stringify(onLeave.body)).toBe(200);
      const slip = staffStatusAnswerSchema.parse(onLeave.body).slip;
      expect(slip).toMatchObject({
        login: made.slip.login,
        validUntil: new Date('2026-10-27T00:00:00+05:00').toISOString(),
      });
      expect(slip?.password).not.toBe(made.slip.password);
      expect(await schoolEntries('account.rehire_password', made.accountId)).toHaveLength(1);
      const account = await t.database.migrator
        .selectFrom('accounts')
        .select('must_change_password')
        .where('id', '=', made.accountId)
        .executeTakeFirstOrThrow();
      expect(account.must_change_password).toBe(true);

      // Re-hired on leave earlier (the rows as that history leaves them; the
      // clock does not move, so that the sessions of the kit stay): the return
      // to `active` is no second re-hire.
      const earlier = await withAccount();
      await t.database.migrator
        .updateTable('staff_statuses')
        .set({ valid_until: '2026-10-05' })
        .where('staff_id', '=', earlier.id)
        .execute();
      await t.database.migrator
        .insertInto('staff_statuses')
        .values([
          {
            staff_id: earlier.id,
            status: 'left',
            valid_from: '2026-10-05',
            valid_until: '2026-10-08',
          },
          { staff_id: earlier.id, status: 'inactive', valid_from: '2026-10-08', valid_until: null },
        ])
        .execute();
      const back = await t.post(`/api/people/staff/${earlier.id}/status`, t.north, {
        status: 'active',
        from: TOMORROW,
      });
      expect(back.status, JSON.stringify(back.body)).toBe(200);
      expect(staffStatusAnswerSchema.parse(back.body).slip).toBeNull();
      expect(await schoolEntries('account.rehire_password', earlier.accountId)).toEqual([]);
    });

    it('keeps an end that passed earlier today when the person leaves today', async () => {
      const made = await withAccount();
      const teacher = roleOf(
        staffAccountSchema.parse(
          (await give(made.id, { role: 'teacher', branchId: t.north, from: TODAY })).body,
        ),
        'teacher',
      );
      expect((await end(made.id, teacher.id, TODAY)).status).toBe(200);
      t.clock.set('2026-10-10T23:58:00+05:00');
      try {
        const left = await t.post(`/api/people/staff/${made.id}/status`, t.north, {
          status: 'left',
          from: TODAY,
        });
        expect(left.status, JSON.stringify(left.body)).toBe(200);
        const row = await t.database.migrator
          .selectFrom('assignments')
          .select('valid_until')
          .where('id', '=', teacher.id)
          .executeTakeFirstOrThrow();
        expect(row.valid_until).toEqual(new Date(START));
      } finally {
        t.clock.set(START);
      }
    });
  });

  // Correction 1: who gave a role is named when their record is in a branch
  // the request may read, by login otherwise.
  describe('the Principal', () => {
    it('reads the section of a record of the branch, and the names it may read', async () => {
      const made = await withAccount();
      // The admin's account has a record in North since the own-role test.
      const linkedAdmin = await t.database.migrator
        .selectFrom('staff')
        .select('id')
        .where('account_id', '=', (await admin()).accountId)
        .executeTakeFirst();
      if (linkedAdmin === undefined) {
        const own = await person();
        await t.database.migrator
          .updateTable('staff')
          .set({ account_id: (await admin()).accountId })
          .where('id', '=', own.id)
          .execute();
      }
      await give(made.id, { role: 'teacher', branchId: t.north, from: TODAY });

      // A Super Admin whose record is in South only gives the second role.
      const southern = await withAccount(undefined, t.south);
      const given = await give(
        southern.id,
        { role: 'super_admin', branchId: null, from: TODAY },
        t.south,
      );
      expect(given.status).toBe(201);
      const giverCookie = await (async () => {
        const signIn = await t.kit.signIn(southern.slip.login, southern.slip.password);
        const cookie = cookieOf(signIn) ?? '';
        await t.kit.changePassword(cookie, southern.slip.password, NEW_PASSWORD);
        const again = await t.kit.signIn(southern.slip.login, NEW_PASSWORD);
        const fresh = cookieOf(again) ?? '';
        await t.kit.setUpSecondStep(fresh);
        return fresh;
      })();
      const second = await give(
        made.id,
        { role: 'tutor', branchId: t.north, from: TODAY },
        t.north,
        giverCookie,
      );
      expect(second.status, JSON.stringify(second.body)).toBe(201);

      const read = await section(made.id, t.north, t.principal);
      expect(read.canEdit).toBe(false);
      expect(roleOf(read, 'teacher').givenBy?.name).not.toBeNull();
      expect(roleOf(read, 'tutor').givenBy).toEqual({ login: southern.slip.login, name: null });
      // The Super Admin reads every branch: the name shows.
      expect(roleOf(await section(made.id), 'tutor').givenBy?.name).toEqual({
        firstName: 'Akmal',
        lastName: southern.lastName,
      });
      refusedWith(
        await t.get(`/api/people/staff/${made.id}/account`, t.north, t.vicePrincipal),
        403,
        'permission_denied',
      );
      const southernRole = roleOf(await section(southern.id, t.south), 'super_admin');
      expect(
        (
          await t.post(`/api/people/staff/${southern.id}/roles/${southernRole.id}/end`, t.south, {
            from: TODAY,
          })
        ).status,
      ).toBe(200);
    });
  });

  // Code round 1, finding 2: `assignments` has no row policy, so the section
  // keeps a reader other than the Super Admin to the roles of the branch of
  // the request and the two without a branch.
  describe('the roles of other branches', () => {
    it('are not shown to the Principal, and are to the Super Admin', async () => {
      const made = await withAccount();
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: made.id, branch_id: t.south, is_main: false })
        .execute();
      for (const body of [
        { role: 'teacher', branchId: t.north, from: TODAY },
        { role: 'tutor', branchId: t.south, from: TODAY },
        { role: 'super_admin', branchId: null, from: TODAY },
      ]) {
        const given = await give(made.id, body);
        expect(given.status, JSON.stringify(given.body)).toBe(201);
      }
      const read = await section(made.id, t.north, t.principal);
      expect(read.account?.roles.map((role) => role.role).sort()).toEqual([
        'super_admin',
        'teacher',
      ]);
      expect((await section(made.id)).account?.roles.map((role) => role.role).sort()).toEqual([
        'super_admin',
        'teacher',
        'tutor',
      ]);
    });

    it('answers the Principal 404 for a record of another branch only', async () => {
      const southern = await withAccount(undefined, t.south);
      expect(
        (await give(southern.id, { role: 'teacher', branchId: t.south, from: TODAY }, t.south))
          .status,
      ).toBe(201);
      refusedWith(
        await t.get(`/api/people/staff/${southern.id}/account`, t.north, t.principal),
        404,
        'not_found',
      );
    });
  });

  // Pull request #61, decision 6, and decision 9: the session answers the
  // person's own name, and the name of who reset the password.
  describe('the session', () => {
    it('answers the name of the person, and nothing for an account without a record', async () => {
      const made = await withAccount();
      const signIn = await t.kit.signIn(made.slip.login, made.slip.password);
      const cookie = cookieOf(signIn) ?? '';
      // Code round 1, finding 6: while a step is owed the password alone
      // reads no name; the forced change is that step here.
      const owed = sessionResponseSchema.parse((await t.kit.get('/api/auth/session', cookie)).body);
      expect(owed.mustChangePassword).toBe(true);
      expect(owed.name).toBeNull();
      expect((await t.kit.changePassword(cookie, made.slip.password, NEW_PASSWORD)).status).toBe(
        204,
      );
      const answer = sessionResponseSchema.parse(
        (await t.kit.get('/api/auth/session', cookie)).body,
      );
      expect(answer.name).toEqual({ firstName: 'Akmal', lastName: made.lastName });
      const adminAnswer = sessionResponseSchema.parse(
        (await t.kit.get('/api/auth/session', t.principal)).body,
      );
      expect(adminAnswer.name).toBeNull();
    });

    it('names the administrator who reset the password, by login when they have no record', async () => {
      const made = await withAccount();
      const resetter = await withAccount();
      await t.database.migrator
        .updateTable('accounts')
        .set({ password_reset_by: resetter.accountId, password_reset_at: new Date(START) })
        .where('id', '=', made.accountId)
        .execute();
      const signIn = await t.kit.signIn(made.slip.login, made.slip.password);
      const cookie = cookieOf(signIn) ?? '';
      expect(
        sessionResponseSchema.parse((await t.kit.get('/api/auth/session', cookie)).body)
          .passwordResetBy,
      ).toBe(`Akmal ${resetter.lastName}`);
      const bare = await t.kit.newAccount('Zafar', 'Nazarov');
      await t.database.migrator
        .updateTable('accounts')
        .set({ password_reset_by: bare.id })
        .where('id', '=', made.accountId)
        .execute();
      expect(
        sessionResponseSchema.parse((await t.kit.get('/api/auth/session', cookie)).body)
          .passwordResetBy,
      ).toBe(bare.login);
    });
  });

  it('works for the branch of the request only', async () => {
    const made = await withAccount();
    const response = await t.kit
      .get(`/api/people/staff/${made.id}/account`, t.admin)
      .set(BRANCH_HEADER, t.south);
    refusedWith(response, 404, 'not_found');
  });
});
