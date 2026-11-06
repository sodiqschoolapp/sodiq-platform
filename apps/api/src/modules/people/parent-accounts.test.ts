import { Logger } from '@nestjs/common';
import {
  BRANCH_HEADER,
  parentAccountSchema,
  parentSlipListSchema,
  parentsNeverUsedSchema,
  printedParentSlipsSchema,
  relativeReportSchema,
  sessionResponseSchema,
  type PrintedParentSlips,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShippingLogger } from '../../monitoring/monitoring.service.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { ParentsKit } from '../../testing/parents-kit.js';
import { cookieOf, errorCode, NEW_PASSWORD, signInKit } from '../../testing/sign-in-kit.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A count in letters, for class names: a, b, ..., z, ba, bb, ... */
function lettersOf(value: number): string {
  let text = '';
  let rest = value;
  do {
    text = String.fromCharCode(97 + (rest % 26)) + text;
    rest = Math.floor(rest / 26);
  } while (rest > 0);
  return text;
}

/** The leaving of a student from a day, its class row cut as the service cuts it. */
async function leave(
  migrator: DayTemplatesKit['database']['migrator'],
  parents: ParentsKit,
  branch: string,
  studentId: string,
  day: string,
): Promise<void> {
  await migrator.transaction().execute(async (transaction) => {
    const leavingId = await parents.members.leaving(transaction, branch, studentId, day);
    await transaction
      .updateTable('class_memberships')
      .set({ valid_until: day, ended_by: 'leaving', leaving_id: leavingId })
      .where('student_id', '=', studentId)
      .execute();
  });
}

// Task 11.1 (pull request #292): the Parent accounts of relatives. `10`, Signing in;
// `edge/close-relatives`, the rows of first passwords and of the forgotten password. Every
// name is invented.
describe('the Parent accounts', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let parents: ParentsKit;
  let northYear: string;
  let southYear: string;
  /** An Academic Vice Principal of the south branch only. */
  let southVice: string;
  let tutor: string;
  let count = 0;

  const slipsOf = (classId: string, branch = t.north, cookie = t.vicePrincipal) =>
    t.get(`/api/people/classes/${classId}/parent-slips`, branch, cookie);

  const print = (
    classId: string,
    body: object = { language: 'uz', printAgain: [] },
    branch = t.north,
    cookie = t.vicePrincipal,
  ) => t.post(`/api/people/classes/${classId}/parent-slips`, branch, body, cookie);

  const reset = (relativeId: string, branch = t.north, cookie = t.vicePrincipal) =>
    t.post(`/api/people/parents/${relativeId}/password-reset`, branch, { language: 'ru' }, cookie);

  const accountOf = (relativeId: string, branch = t.north, cookie = t.vicePrincipal) =>
    t.get(`/api/people/parents/${relativeId}/account`, branch, cookie);

  async function printed(
    classId: string,
    body: object = { language: 'uz', printAgain: [] },
    branch = t.north,
    cookie = t.vicePrincipal,
  ): Promise<PrintedParentSlips> {
    const response = await print(classId, body, branch, cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return printedParentSlipsSchema.parse(response.body);
  }

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  /** A class of the branch with one student and that student's relative, a member today. */
  async function classWithParent(branch = t.north) {
    count += 1;
    const classId = await classes.schoolClass(branch, branch === t.north ? northYear : southYear, {
      name: `Cambridge ${lettersOf(count)}`,
    });
    const { studentId, relativeId } = await parents.student(branch);
    await parents.members.member({ branch, classId, studentId, from: '2026-09-01' });
    return { classId, studentId, relativeId };
  }

  /** A student of the class whose main relative is `relativeId`. */
  async function childIn(branch: string, classId: string, relativeId: string) {
    const studentId = await parents.childOf(branch, relativeId);
    await parents.members.member({ branch, classId, studentId, from: '2026-09-01' });
    return studentId;
  }

  const signIn = (login: string, password: string) =>
    request(t.kit.server).post('/api/auth/sign-in').send({ login, password });

  /** Every row of the tables a print or reset writes, and the log: what a refused one leaves. */
  const rowsOf = () =>
    Promise.all(
      ['accounts', 'relative_accounts', 'parent_slips', 'sessions', 'audit_log'].map(
        async (table) =>
          (await sql`select * from ${sql.table(table)} order by 1`.execute(t.database.migrator))
            .rows,
      ),
    );

  const slipFor = (answer: PrintedParentSlips, relativeId: string) =>
    answer.slips.find((slip) => slip.relativeId === relativeId);

  beforeAll(async () => {
    t = await dayTemplatesKit();
    classes = new ClassesKit(t.database.migrator);
    northYear = await classes.year(t.north);
    southYear = await classes.year(t.south);
    parents = new ParentsKit(
      t.app,
      t.database.migrator,
      t.admin === '' ? '' : await classes.account(),
    );
    southVice = (
      await signInKit(t.app, {
        newAccountsHold: { role: 'academic_vice_principal', branchId: t.south },
      }).completeSession('Southvice', 'Nazarov')
    ).cookie;
    tutor = (
      await signInKit(t.app, { newAccountsHold: { role: 'tutor', branchId: t.north } }).fullSession(
        'Tutor',
        'Qosimov',
      )
    ).cookie;
  }, 120_000);

  afterAll(async () => {
    await t.close();
  });

  describe('the slips of a class', () => {
    it('lists each relative with portal access on, then prints one slip each', async () => {
      const { classId, studentId, relativeId } = await classWithParent();
      const father = await parents.relativeOf(t.north, studentId, { fullName: 'Botir Usmonov' });
      const uncle = await parents.relativeOf(t.north, studentId, {
        fullName: 'Anvar Usmonov',
        portalAccess: false,
      });
      const listed = parentSlipListSchema.parse((await slipsOf(classId)).body);
      expect(listed.relatives.map((one) => [one.relativeId, one.state]).sort()).toEqual(
        [
          [relativeId, 'to_print'],
          [father, 'to_print'],
        ].sort(),
      );
      expect(listed.relatives.some((one) => one.relativeId === uncle)).toBe(false);

      const answer = await printed(classId);
      expect(answer.slips.map((slip) => slip.relativeId).sort()).toEqual(
        [relativeId, father].sort(),
      );
      const slip = slipFor(answer, father);
      expect(slip?.login).toBe('b.usmonov');
      expect(slip?.children.map((child) => child.studentId)).toEqual([studentId]);
      // Valid for 30 days from now.
      expect(slip?.validUntil).toBe(new Date(t.clock.now().getTime() + 30 * DAY_MS).toISOString());

      // Printed once: listed with the class and date, and not printed again.
      const again = parentSlipListSchema.parse((await slipsOf(classId)).body);
      expect(again.relatives.find((one) => one.relativeId === father)).toMatchObject({
        state: 'valid_slip',
        login: 'b.usmonov',
        slip: { kind: 'first', otherBranch: false, valid: true },
      });
      expect((await printed(classId)).slips).toEqual([]);
    });

    it('gives a Cyrillic name its login in Latin letters', async () => {
      const { classId, studentId } = await classWithParent();
      const father = await parents.relativeOf(t.north, studentId, { fullName: 'Шерзод Каримов' });
      const answer = await printed(classId);
      expect(slipFor(answer, father)?.login).toMatch(/^s\.karimov[0-9]*$/);
    });

    it('leaves out a student who left and the relatives only they link', async () => {
      const { classId, studentId, relativeId } = await classWithParent();
      await leave(t.database.migrator, parents, t.north, studentId, '2026-10-01');
      const listed = parentSlipListSchema.parse((await slipsOf(classId)).body);
      expect(listed.relatives.some((one) => one.relativeId === relativeId)).toBe(false);
    });

    it('keeps one account for a mother of two children in two classes and two branches', async () => {
      const first = await classWithParent(t.north);
      const second = await classWithParent(t.north);
      const south = await classWithParent(t.south);
      const mother = first.relativeId;
      await childIn(t.north, second.classId, mother);
      await childIn(t.south, south.classId, mother);

      const answer = await printed(first.classId);
      const slip = slipFor(answer, mother);
      expect(slip).toBeDefined();
      const accounts = await t.database.migrator
        .selectFrom('relative_accounts')
        .select('account_id')
        .where('relative_id', '=', mother)
        .execute();
      expect(accounts).toHaveLength(1);

      // Listed with the other class and date in the same branch, not printed there.
      const other = parentSlipListSchema.parse((await slipsOf(second.classId)).body);
      const named = other.relatives.find((one) => one.relativeId === mother);
      expect(named?.state).toBe('valid_slip');
      expect(named?.slip?.className).toMatch(/^7 Cambridge/);
      expect(named?.slip?.className).not.toBe(other.className);
      expect(slipFor(await printed(second.classId), mother)).toBeUndefined();

      // Must-fix 1 and decision 15: the branch of the other child sees the slip, without its class.
      const southList = parentSlipListSchema.parse(
        (await slipsOf(south.classId, t.south, southVice)).body,
      );
      expect(southList.relatives.find((one) => one.relativeId === mother)).toMatchObject({
        state: 'valid_slip',
        slip: { otherBranch: true, className: null },
      });
      expect(
        slipFor(await printed(south.classId, undefined, t.south, southVice), mother),
      ).toBeUndefined();
      // Her password still works: nothing replaced it.
      expect((await signIn(slip?.login ?? '', slip?.password ?? '')).status).toBe(200);
    });

    it('prints again on "print again", and the earlier password fails', async () => {
      const { classId, relativeId } = await classWithParent();
      const first = slipFor(await printed(classId), relativeId);
      const again = slipFor(
        await printed(classId, { language: 'en', printAgain: [relativeId] }),
        relativeId,
      );
      expect(again?.login).toBe(first?.login);
      refusedWith(await signIn(first?.login ?? '', first?.password ?? ''), 401, 'sign_in_failed');
      expect((await signIn(again?.login ?? '', again?.password ?? '')).status).toBe(200);
    });

    it('lists a parent who chose a password as signed in, and never prints them', async () => {
      const { classId, relativeId } = await classWithParent();
      await parents.session(relativeId);
      const listed = parentSlipListSchema.parse((await slipsOf(classId)).body);
      expect(listed.relatives.find((one) => one.relativeId === relativeId)?.state).toBe(
        'signed_in',
      );
      expect(slipFor(await printed(classId), relativeId)).toBeUndefined();
      const before = await rowsOf();
      refusedWith(
        await print(classId, { language: 'uz', printAgain: [relativeId] }),
        409,
        'parent_signed_in',
      );
      expect(await rowsOf()).toEqual(before);
    });

    it('refuses "print again" for a relative of the class with portal access off', async () => {
      const { classId, studentId } = await classWithParent();
      const uncle = await parents.relativeOf(t.north, studentId, { portalAccess: false });
      const before = await rowsOf();
      refusedWith(
        await print(classId, { language: 'uz', printAgain: [uncle] }),
        409,
        'parent_portal_off',
      );
      expect(await rowsOf()).toEqual(before);
    });

    it('answers 404 for a "print again" relative of another branch or unknown', async () => {
      const { classId } = await classWithParent();
      const south = await classWithParent(t.south);
      for (const id of [south.relativeId, UNKNOWN]) {
        const before = await rowsOf();
        refusedWith(await print(classId, { language: 'uz', printAgain: [id] }), 404, 'not_found');
        expect(await rowsOf()).toEqual(before);
      }
    });

    it('answers 404 for a class of another branch or unknown', async () => {
      const south = await classWithParent(t.south);
      for (const id of [south.classId, UNKNOWN]) {
        const before = await rowsOf();
        refusedWith(await slipsOf(id), 404, 'not_found');
        refusedWith(await print(id), 404, 'not_found');
        expect(await rowsOf()).toEqual(before);
      }
    });

    it('a first password older than 30 days is refused (the injected clock)', async () => {
      const { classId, relativeId } = await classWithParent();
      const slip = slipFor(await printed(classId), relativeId);
      try {
        t.clock.set(new Date(new Date(START).getTime() + 30 * DAY_MS - 1000));
        expect((await signIn(slip?.login ?? '', slip?.password ?? '')).status).toBe(200);
        t.clock.set(new Date(new Date(START).getTime() + 30 * DAY_MS));
        refusedWith(await signIn(slip?.login ?? '', slip?.password ?? ''), 401, 'password_expired');
      } finally {
        t.clock.set(START);
      }
    });

    it('writes an audit entry per slip, and no password in the log or the audit log', async () => {
      const { classId, relativeId } = await classWithParent();
      const lines: string[] = [];
      Logger.overrideLogger(new ShippingLogger());
      ShippingLogger.sink = (_level, text) => {
        lines.push(text);
      };
      let answer: PrintedParentSlips;
      try {
        answer = await printed(classId);
      } finally {
        ShippingLogger.sink = undefined;
      }
      const slip = slipFor(answer, relativeId);
      const entries = await t.entries('parent_account.slip', relativeId);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ branch_id: t.north });
      const audit = JSON.stringify(
        (await sql`select * from audit_log`.execute(t.database.migrator)).rows,
      );
      expect(slip?.password.length).toBeGreaterThan(0);
      expect(audit).not.toContain(slip?.password);
      expect(lines.join('\n')).not.toContain(slip?.password);
      const stored = JSON.stringify(
        (await sql`select * from parent_slips`.execute(t.database.migrator)).rows,
      );
      expect(stored).not.toContain(slip?.password);
    });
  });

  describe('the reset', () => {
    it('gives a slip valid for 7 days and ends every session of the parent', async () => {
      const { relativeId } = await classWithParent();
      const { account, cookie } = await parents.session(relativeId);
      const response = await reset(relativeId);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const answer = printedParentSlipsSchema.parse(response.body);
      const [slip] = answer.slips;
      expect(slip).toMatchObject({ login: account.login, kind: 'reset' });
      expect(slip?.validUntil).toBe(new Date(t.clock.now().getTime() + 7 * DAY_MS).toISOString());
      // Every session ends, and with it its trusted device.
      expect(
        (await request(t.kit.server).get('/api/auth/session').set('Cookie', cookie)).status,
      ).toBe(401);
      const open = await t.database.migrator
        .selectFrom('sessions')
        .select('id')
        .where('account_id', '=', account.id)
        .where('ended_at', 'is', null)
        .execute();
      expect(open).toEqual([]);
      // "reset by X for Y", in the branch of the request.
      const entries = await t.entries('account.password_reset', account.id);
      expect(entries.at(-1)).toMatchObject({ branch_id: t.north, person_id: relativeId });
      // The old password fails, the slip's works and asks for a change.
      refusedWith(await signIn(account.login, NEW_PASSWORD), 401, 'sign_in_failed');
      const signed = await signIn(account.login, slip?.password ?? '');
      expect(signed.status).toBe(200);
      const session = sessionResponseSchema.parse(signed.body);
      expect(session).toMatchObject({ kind: 'parent', mustChangePassword: true, fullName: null });
      expect(session.passwordResetBy).not.toBeNull();
    });

    it('a reset older than 7 days is refused (the injected clock)', async () => {
      const { relativeId } = await classWithParent();
      await parents.session(relativeId);
      const [slip] = printedParentSlipsSchema.parse((await reset(relativeId)).body).slips;
      try {
        t.clock.set(new Date(new Date(START).getTime() + 7 * DAY_MS));
        refusedWith(await signIn(slip?.login ?? '', slip?.password ?? ''), 401, 'password_expired');
      } finally {
        t.clock.set(START);
      }
    });

    it('is refused before the first print (409 parent_no_account)', async () => {
      const { relativeId } = await classWithParent();
      const before = await rowsOf();
      refusedWith(await reset(relativeId), 409, 'parent_no_account');
      expect(await rowsOf()).toEqual(before);
    });

    it('answers 404 for a relative whose only child of the branch has left (the route scope)', async () => {
      const { studentId, relativeId } = await classWithParent();
      await parents.session(relativeId);
      await leave(t.database.migrator, parents, t.north, studentId, '2026-10-01');
      const before = await rowsOf();
      refusedWith(await reset(relativeId), 404, 'not_found');
      refusedWith(await accountOf(relativeId), 404, 'not_found');
      expect(await rowsOf()).toEqual(before);
    });

    it('answers 404 for a relative of another branch or unknown', async () => {
      const south = await classWithParent(t.south);
      await parents.session(south.relativeId);
      for (const id of [south.relativeId, UNKNOWN]) {
        const before = await rowsOf();
        refusedWith(await reset(id), 404, 'not_found');
        refusedWith(await accountOf(id), 404, 'not_found');
        expect(await rowsOf()).toEqual(before);
      }
    });
  });

  describe('who may print and reset', () => {
    it('refuses the Principal, a Tutor, a Teacher and the Vice Principal of another branch', async () => {
      const { classId, relativeId } = await classWithParent();
      await parents.session(relativeId);
      for (const cookie of [t.principal, tutor, t.teacher, southVice]) {
        const before = await rowsOf();
        refusedWith(await slipsOf(classId, t.north, cookie), 403, 'permission_denied');
        refusedWith(await print(classId, undefined, t.north, cookie), 403, 'permission_denied');
        refusedWith(await reset(relativeId, t.north, cookie), 403, 'permission_denied');
        expect(await rowsOf()).toEqual(before);
      }
      // In the own branch, the Vice Principal of the south reaches no relative of the north.
      refusedWith(await reset(relativeId, t.south, southVice), 404, 'not_found');
      refusedWith(await print(classId, undefined, t.south, southVice), 404, 'not_found');
    });

    it('allows the Super Admin', async () => {
      const { classId, relativeId } = await classWithParent();
      const answer = await printed(classId, undefined, t.north, t.admin);
      expect(slipFor(answer, relativeId)).toBeDefined();
      expect((await reset(relativeId, t.north, t.admin)).status).toBe(200);
    });
  });

  describe('the account of the Parent page', () => {
    it('is empty before the first print, then names the login, the slip and the sign-in', async () => {
      const { classId, relativeId } = await classWithParent();
      expect(parentAccountSchema.parse((await accountOf(relativeId)).body)).toEqual({
        account: null,
      });
      const slip = slipFor(await printed(classId), relativeId);
      expect(parentAccountSchema.parse((await accountOf(relativeId)).body)).toMatchObject({
        account: {
          login: slip?.login,
          signedIn: false,
          lastSignInAt: null,
          slip: { kind: 'first' },
        },
      });
    });
  });

  describe('the personal data report of a relative (correction 3 of the plan review)', () => {
    it('names the login, the state, the last sign-in and each slip, never a password', async () => {
      const { classId, relativeId } = await classWithParent();
      const slip = slipFor(await printed(classId), relativeId);
      const signed = await signIn(slip?.login ?? '', slip?.password ?? '');
      expect(signed.status).toBe(200);
      const response = await t.post(
        `/api/people/relatives/${relativeId}/report`,
        t.north,
        {},
        t.admin,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const report = relativeReportSchema.parse(response.body);
      expect(report.relative.account).toMatchObject({
        switchedOn: true,
        login: slip?.login,
        signedIn: false,
        slips: [{ kind: 'first', printedAt: slip?.printedAt, validUntil: slip?.validUntil }],
      });
      expect(report.relative.account?.lastSignInAt).not.toBeNull();
      expect(JSON.stringify(response.body)).not.toContain(slip?.password);
    });
  });

  describe('the first sign-in of a parent', () => {
    it('is audited once, at the first password the parent chooses', async () => {
      const { relativeId } = await classWithParent();
      const { account } = await parents.session(relativeId);
      // A school-wide entry (no branch), as every sign-in event.
      const entries = await t.database.migrator
        .selectFrom('audit_log_school')
        .select('id')
        .where('action', '=', 'parent_account.first_sign_in')
        .where('record_id', '=', account.id)
        .execute();
      expect(entries).toHaveLength(1);
    });

    it('carries the parent kind and no staff right, never "Trust this device"', async () => {
      const { relativeId } = await classWithParent();
      const { cookie } = await parents.session(relativeId);
      const session = sessionResponseSchema.parse(
        (await request(t.kit.server).get('/api/auth/session').set('Cookie', cookie)).body,
      );
      expect(session).toMatchObject({ kind: 'parent', assignments: [], branches: [] });
      expect(session.fullName).not.toBeNull();
      refusedWith(
        await request(t.kit.server)
          .get('/api/people/staff')
          .set('Cookie', cookie)
          .set(BRANCH_HEADER, t.north),
        403,
        'permission_denied',
      );
      const account = await t.database.migrator
        .selectFrom('relative_accounts')
        .innerJoin('accounts', 'accounts.id', 'relative_accounts.account_id')
        .select('accounts.login')
        .where('relative_id', '=', relativeId)
        .executeTakeFirstOrThrow();
      const trusted = await request(t.kit.server)
        .post('/api/auth/sign-in')
        .send({ login: account.login, password: NEW_PASSWORD, trustDevice: true });
      expect(sessionResponseSchema.parse(trusted.body).trustedUntil).toBeNull();
    });

    it('a staff member who is also a parent gets no staff right with the parent login', async () => {
      const { relativeId } = await classWithParent();
      const staff = signInKit(t.app, {
        newAccountsHold: { role: 'academic_vice_principal', branchId: t.north },
      });
      const vice = await staff.completeSession('Dilnoza', 'Parentova');
      const parent = await parents.session(relativeId);
      // The staff login is staff, the parent login is a parent with no right.
      const own = sessionResponseSchema.parse(
        (await request(t.kit.server).get('/api/auth/session').set('Cookie', vice.cookie)).body,
      );
      expect(own.kind).toBe('staff');
      refusedWith(await slipsOf(UNKNOWN, t.north, parent.cookie), 403, 'permission_denied');
    });

    it('is refused when the relative can no longer sign in, as a wrong password', async () => {
      const { studentId, relativeId } = await classWithParent();
      const { account, cookie } = await parents.session(relativeId);
      await t.database.migrator
        .updateTable('student_relatives')
        .set({ portal_access: false })
        .where('student_id', '=', studentId)
        .where('relative_id', '=', relativeId)
        .execute();
      // The open session reaches nothing from the next request.
      expect(
        (await request(t.kit.server).get('/api/auth/session').set('Cookie', cookie)).status,
      ).toBe(401);
      refusedWith(await signIn(account.login, NEW_PASSWORD), 401, 'sign_in_failed');
    });
  });

  describe('the report of Parent accounts never used', () => {
    it('lists the accounts with no password chosen, logged as an export', async () => {
      const { classId, relativeId } = await classWithParent();
      const signedIn = await classWithParent();
      await printed(classId);
      await parents.session(signedIn.relativeId);
      const response = await t.get('/api/people/parent-accounts/never-used', t.north);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const answer = parentsNeverUsedSchema.parse(response.body);
      const ids = answer.accounts.map((one) => one.relativeId);
      expect(ids).toContain(relativeId);
      expect(ids).not.toContain(signedIn.relativeId);
      const [entry] = (await t.entries('parent_account.never_used')).slice(-1);
      expect(entry).toMatchObject({ branch_id: t.north });

      const file = await t.post('/api/people/parent-accounts/never-used/export', t.north, {
        ids: [relativeId],
        columns: ['name', 'login', 'expired'],
        selection: 'matching',
        search: '',
        filters: {},
      });
      expect(file.status).toBe(200);
      expect(await t.entries('parent_account.never_used_export')).not.toHaveLength(0);
    });

    it('answers 404 in the file for a relative of another branch or unknown, with nothing logged', async () => {
      const south = await classWithParent(t.south);
      await printed(south.classId, undefined, t.south, southVice);
      for (const id of [south.relativeId, UNKNOWN]) {
        const before = await rowsOf();
        refusedWith(
          await t.post('/api/people/parent-accounts/never-used/export', t.north, {
            ids: [id],
            columns: ['name'],
            selection: 'ticked',
            search: '',
            filters: {},
          }),
          404,
          'not_found',
        );
        expect(await rowsOf()).toEqual(before);
      }
    });

    it('refuses the Principal, a Tutor and a Teacher', async () => {
      for (const cookie of [t.principal, tutor, t.teacher]) {
        refusedWith(
          await t.get('/api/people/parent-accounts/never-used', t.north, cookie),
          403,
          'permission_denied',
        );
      }
    });
  });

  // Must-fix 3 of the spec review: two prints of one relative at the same moment, and a print
  // against a reset. A third transaction holds the relative's account row; the first route
  // starts and waits on it, the second starts and waits behind, the hold ends.
  describe('at the same moment', () => {
    async function waiting(): Promise<number> {
      const found = await sql<{ waiting: number }>`
        select count(distinct l.pid)::int as waiting
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and not l.granted
      `.execute(t.database.migrator);
      return found.rows[0]?.waiting ?? 0;
    }

    async function until(count: number): Promise<void> {
      for (let tries = 0; tries < 200; tries += 1) {
        if ((await waiting()) >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('The routes did not wait on the held row.');
    }

    const started = (send: () => request.Test) =>
      new Promise<Response>((resolve, reject) => {
        send().then(resolve, reject);
      });

    async function inOrder(
      relativeId: string,
      first: () => request.Test,
      second: () => request.Test,
    ): Promise<[Response, Response]> {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let held: () => void = () => undefined;
      const isHeld = new Promise<void>((resolve) => {
        held = resolve;
      });
      const holding = t.database.migrator.transaction().execute(async (transaction) => {
        await transaction
          .selectFrom('relative_accounts')
          .select('relative_id')
          .where('relative_id', '=', relativeId)
          .forUpdate()
          .execute();
        held();
        await released;
      });
      await isHeld;
      const one = started(first);
      await until(1);
      const two = started(second);
      await until(2);
      release();
      await holding;
      return [await one, await two];
    }

    for (const order of ['north first', 'south first'] as const) {
      it(`two prints of a mother from two branches give one account (${order})`, async () => {
        const north = await classWithParent(t.north);
        const south = await classWithParent(t.south);
        const mother = north.relativeId;
        await childIn(t.south, south.classId, mother);
        const fromNorth = () =>
          request(t.kit.server)
            .post(`/api/people/classes/${north.classId}/parent-slips`)
            .set('Cookie', t.vicePrincipal)
            .set(BRANCH_HEADER, t.north)
            .send({ language: 'uz', printAgain: [] });
        const fromSouth = () =>
          request(t.kit.server)
            .post(`/api/people/classes/${south.classId}/parent-slips`)
            .set('Cookie', southVice)
            .set(BRANCH_HEADER, t.south)
            .send({ language: 'uz', printAgain: [] });
        const [a, b] =
          order === 'north first'
            ? await inOrder(mother, fromNorth, fromSouth)
            : await inOrder(mother, fromSouth, fromNorth);
        expect(a.status, JSON.stringify(a.body)).toBe(200);
        expect(b.status, JSON.stringify(b.body)).toBe(200);
        const firstSlip = slipFor(printedParentSlipsSchema.parse(a.body), mother);
        expect(firstSlip).toBeDefined();
        expect(slipFor(printedParentSlipsSchema.parse(b.body), mother)).toBeUndefined();
        const slips = await t.database.migrator
          .selectFrom('parent_slips')
          .select('id')
          .where('relative_id', '=', mother)
          .execute();
        expect(slips).toHaveLength(1);
        expect((await signIn(firstSlip?.login ?? '', firstSlip?.password ?? '')).status).toBe(200);
      });
    }

    for (const order of ['reset first', 'print again first'] as const) {
      it(`a reset and a print again: only the last password works (${order})`, async () => {
        const { classId, relativeId } = await classWithParent();
        await printed(classId);
        const doReset = () =>
          request(t.kit.server)
            .post(`/api/people/parents/${relativeId}/password-reset`)
            .set('Cookie', t.vicePrincipal)
            .set(BRANCH_HEADER, t.north)
            .send({ language: 'uz' });
        const doPrint = () =>
          request(t.kit.server)
            .post(`/api/people/classes/${classId}/parent-slips`)
            .set('Cookie', t.vicePrincipal)
            .set(BRANCH_HEADER, t.north)
            .send({ language: 'uz', printAgain: [relativeId] });
        const [a, b] =
          order === 'reset first'
            ? await inOrder(relativeId, doReset, doPrint)
            : await inOrder(relativeId, doPrint, doReset);
        expect(a.status, JSON.stringify(a.body)).toBe(200);
        expect(b.status, JSON.stringify(b.body)).toBe(200);
        const first = slipFor(printedParentSlipsSchema.parse(a.body), relativeId);
        const last = slipFor(printedParentSlipsSchema.parse(b.body), relativeId);
        refusedWith(await signIn(first?.login ?? '', first?.password ?? ''), 401, 'sign_in_failed');
        const signed = await signIn(last?.login ?? '', last?.password ?? '');
        expect(signed.status).toBe(200);
        expect(cookieOf(signed)).toBeDefined();
      });
    }
  });
});
