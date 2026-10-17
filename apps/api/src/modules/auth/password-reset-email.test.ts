import { createHash, randomUUID } from 'node:crypto';
import {
  firstPasswordSlipSchema,
  RESET_LINK_INTERVAL_MS,
  RESET_LINK_VALID_MS,
  sessionResponseSchema,
  staffDetailSchema,
  type Role,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEVICE_COOKIE } from '../../http/device-cookie.js';
import { JobRunner } from '../../jobs/job-runner.js';
import { RecordingMailer, type Mail } from '../../mail/mailer.js';
import {
  dayTemplatesKit,
  START,
  TODAY,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { cookieOf, errorCode, NEW_PASSWORD } from '../../testing/sign-in-kit.js';
import { hashPassword } from './password-hash.js';
import { passwordResetMailJob } from './password-reset-mail.job.js';

// Counts the hashes: an unknown token is answered before any (must-fix 3 of
// the plan review of pull request #66).
vi.mock('./password-hash.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./password-hash.js')>();
  return { ...original, hashPassword: vi.fn(original.hashPassword) };
});

const MINUTE = 60 * 1000;
const CHOSEN = 'a chosen new password 7';

// All names and addresses are invented. Task 2.3c-2, pull request #66: the
// password reset by email (docs/spec/02-roles-and-access.md, Accounts and
// sign-in: build order; edge/people-roles-accounts, Accounts and sign-in;
// the plan's decisions 6 to 13 and correction 1 of its review). The clock
// stands at 23:55 on 10 October 2026 in Tashkent.
describe('the password reset by email', () => {
  let t: DayTemplatesKit;
  let academic: string;
  let steam: string;
  let count = 0;
  const mailer = new RecordingMailer();

  const lettersOf = (n: number): string =>
    n < 26
      ? String.fromCharCode(97 + n)
      : lettersOf(Math.floor(n / 26) - 1) + String.fromCharCode(97 + (n % 26));

  const recordOf = (lastName: string, email: string) => ({
    firstName: 'Dilnoza',
    lastName,
    fatherName: '',
    sex: 'female',
    birthDate: '1990-04-05',
    educationLevel: 'master',
    phone: `+99894${String(3000000 + count)}`,
    email,
    jshshir: '',
    admissionDate: '2026-09-01',
    contractType: 'full_time',
    contractDate: '2026-09-01',
    weeklyLessons: 18,
    dailyLessons: 5,
    divisions: [{ divisionId: academic, departmentId: steam, main: true }],
  });

  /** A person of North with an account, the roles named and, unless `null`, an email. */
  async function person(
    roles: readonly { role: Role; branchId?: string }[] = [{ role: 'teacher' }],
    email: string | null = 'given',
  ) {
    count += 1;
    const lastName = `Rahimova${lettersOf(count)}`;
    const address = email === 'given' ? `d.${lastName.toLowerCase()}@example.test` : (email ?? '');
    const created = await t.post('/api/people/staff', t.north, recordOf(lastName, address));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = staffDetailSchema.parse(created.body).id;
    const made = await t.post(`/api/people/staff/${id}/account`, t.north, {
      login: `d.${lastName.toLowerCase()}`,
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const slip = firstPasswordSlipSchema.parse(made.body);
    const account = await t.database.migrator
      .selectFrom('accounts')
      .select('id')
      .where('login', '=', slip.login)
      .executeTakeFirstOrThrow();
    for (const held of roles) {
      await t.kit.giveRole(account.id, { branchId: t.north, ...held });
    }
    return {
      id,
      lastName,
      login: slip.login,
      password: slip.password,
      accountId: account.id,
      address,
    };
  }

  const ask = (login: string) =>
    request(t.kit.server).post('/api/auth/password-reset').send({ login });
  const confirm = (token: string, newPassword = CHOSEN) =>
    request(t.kit.server).post('/api/auth/password-reset/confirm').send({ token, newPassword });

  /** The error code of a refusal, or the status of an answer that is none. */
  const codeOf = (response: Response): string =>
    response.status >= 400 ? errorCode(response) : String(response.status);

  const linksOf = (accountId: string) =>
    t.database.migrator
      .selectFrom('password_reset_links')
      .selectAll()
      .where('account_id', '=', accountId)
      .orderBy('requested_at')
      .execute();

  async function jobsOf(accountId: string): Promise<string[]> {
    const links = (await linksOf(accountId)).map((link) => link.id);
    const found = await sql<{ link: string }>`
      select data -> 'data' ->> 'linkId' as link from pgboss.job
      where name = ${passwordResetMailJob.name}
    `.execute(t.database.migrator);
    return found.rows.map((row) => row.link).filter((link) => links.includes(link));
  }

  /** Runs the mail job of a link as the worker would, and answers the mails it sent. */
  async function deliver(linkId: string): Promise<Mail[]> {
    const before = mailer.sent.length;
    await t.app.get(JobRunner).deliver(passwordResetMailJob.name, {
      id: randomUUID(),
      data: { branchIds: [], data: { linkId } },
    });
    return mailer.sent.slice(before);
  }

  const tokenOf = (mail: Mail): string => {
    const found = /#token=([A-Za-z0-9_-]+)/.exec(mail.text);
    if (found?.[1] === undefined) {
      throw new Error('The mail holds no link.');
    }
    return found[1];
  };

  /** Asks for a link and runs its job: the token of the mail. */
  async function linkFor(made: { login: string; accountId: string }): Promise<string> {
    expect((await ask(made.login)).status).toBe(202);
    const links = await linksOf(made.accountId);
    const newest = links.at(-1);
    if (newest === undefined) {
      throw new Error('No link was made.');
    }
    const mails = await deliver(newest.id);
    expect(mails).toHaveLength(1);
    return tokenOf(mails[0] as Mail);
  }

  const schoolEntries = (action: string, accountId: string) =>
    t.database.migrator
      .selectFrom('audit_log_school')
      .selectAll()
      .where('action', '=', action)
      .where('record_id', '=', accountId)
      .orderBy('occurred_at')
      .execute();

  const signsIn = async (login: string, password: string) =>
    (await t.kit.signIn(login, password)).status === 200;

  /** Waits until a request waits for a lock held by the test. */
  async function untilWaiting(): Promise<void> {
    for (let tries = 0; tries < 150; tries += 1) {
      const waiting = await sql<{ waiting: number }>`
        select count(*)::int as waiting
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and l.locktype in ('transactionid', 'tuple')
          and not l.granted
      `.execute(t.database.migrator);
      if ((waiting.rows[0]?.waiting ?? 0) > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('The request never waited.');
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ mailer, jobs: true });
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

  beforeEach(() => {
    t.clock.set(START);
    mailer.failing = false;
  });

  describe('the request', () => {
    // Decision 8: "An unknown login and a wrong password get the same answer".
    it('answers 202 with no body and writes nothing for a login that names no account that may get a link', async () => {
      const locked = await person();
      expect(
        (
          await t.post(`/api/people/staff/${locked.id}/account/lock`, t.north, {
            reason: 'Laptop lost',
          })
        ).status,
      ).toBe(200);
      const inactive = await person();
      expect(
        (
          await t.post(`/api/people/staff/${inactive.id}/status`, t.north, {
            status: 'inactive',
            from: TODAY,
          })
        ).status,
      ).toBe(200);
      const left = await person();
      expect(
        (
          await t.post(`/api/people/staff/${left.id}/status`, t.north, {
            status: 'left',
            from: TODAY,
          })
        ).status,
      ).toBe(200);
      const noEmail = await person([{ role: 'teacher' }], null);
      const noRecord = await t.kit.newAccount('Laziz', 'Ergashev');
      const before = await t.database.migrator
        .selectFrom('password_reset_links')
        .select(sql<number>`count(*)::int`.as('rows'))
        .executeTakeFirstOrThrow();
      const entriesBefore = await t.database.migrator
        .selectFrom('audit_log_school')
        .select(sql<number>`count(*)::int`.as('rows'))
        .executeTakeFirstOrThrow();

      for (const login of [
        'z.nobody',
        'Not a login!',
        '',
        locked.login,
        inactive.login,
        left.login,
        noEmail.login,
        noRecord.login,
      ]) {
        const answer = await ask(login);
        expect(answer.status, login).toBe(202);
        expect(answer.text, login).toBe('');
      }

      expect(
        await t.database.migrator
          .selectFrom('password_reset_links')
          .select(sql<number>`count(*)::int`.as('rows'))
          .executeTakeFirstOrThrow(),
      ).toEqual(before);
      expect(
        await t.database.migrator
          .selectFrom('audit_log_school')
          .select(sql<number>`count(*)::int`.as('rows'))
          .executeTakeFirstOrThrow(),
      ).toEqual(entriesBefore);
    });

    it('refuses a login over 64 characters as any input of the wrong size', async () => {
      expect((await ask('a'.repeat(65))).status).toBe(400);
    });

    it('makes one link, one job and one entry for an account that may get one', async () => {
      const made = await person();
      const answer = await ask(made.login);

      expect(answer.status).toBe(202);
      expect(answer.text).toBe('');
      const links = await linksOf(made.accountId);
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({
        requested_at: new Date(START),
        token_hash: null,
        sent_at: null,
        valid_until: null,
      });
      expect(await jobsOf(made.accountId)).toEqual([links[0]?.id]);
      const entries = await schoolEntries('auth.password_reset_requested', made.accountId);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ actor_id: null, record_type: 'account' });
    });

    // Decision 10: at most one link per account per 5 minutes, from the stored moment.
    // Decision 10 and should-fix 3 of the permission review of the build: no
    // new link while the newest still works, so a stranger who knows a login
    // cannot close a person's link again and again; at most one in 5 minutes.
    it('makes no new link while the newest is open, and one after its hour that closes it', async () => {
      const made = await person();
      const token = await linkFor(made);
      t.clock.advance(RESET_LINK_INTERVAL_MS);
      expect((await ask(made.login)).status).toBe(202);
      t.clock.set(new Date(new Date(START).getTime() + RESET_LINK_VALID_MS - 1));
      expect((await ask(made.login)).status).toBe(202);
      expect(await linksOf(made.accountId)).toHaveLength(1);
      expect((await confirm(token)).status).toBe(204);

      t.clock.set(START);
      const late = await person();
      await linkFor(late);
      t.clock.advance(RESET_LINK_VALID_MS);
      expect((await ask(late.login)).status).toBe(202);
      const links = await linksOf(late.accountId);
      expect(links).toHaveLength(2);
      expect(links[0]?.closed_at).toEqual(t.clock.now());
      expect(links[1]?.closed_at).toBeNull();
      expect(await jobsOf(late.accountId)).toHaveLength(2);
    });

    it('makes no new link within 5 minutes of a used one, and one after them', async () => {
      const made = await person();
      expect((await confirm(await linkFor(made))).status).toBe(204);
      t.clock.advance(RESET_LINK_INTERVAL_MS - 1);
      expect((await ask(made.login)).status).toBe(202);
      expect(await linksOf(made.accountId)).toHaveLength(1);
      t.clock.advance(1);
      expect((await ask(made.login)).status).toBe(202);
      expect(await linksOf(made.accountId)).toHaveLength(2);
    });

    // The permission review of the build, must-fix 1: an email the Academic
    // Vice Principal wrote opens no account he may not reset, also when the
    // account or the stronger role came afterwards.
    it('makes no link for a stronger role when the email was last written by an Academic Vice Principal', async () => {
      count += 1;
      const lastName = `Rahimova${lettersOf(count)}`;
      const created = await t.post('/api/people/staff', t.north, recordOf(lastName, ''));
      expect(created.status).toBe(201);
      const id = staffDetailSchema.parse(created.body).id;
      const edit = await t.put(
        `/api/people/staff/${id}`,
        t.north,
        recordOf(lastName, 'vice.mailbox@example.test'),
        t.vicePrincipal,
      );
      expect(edit.status, JSON.stringify(edit.body)).toBe(200);
      const made = await t.post(`/api/people/staff/${id}/account`, t.north, {
        login: `d.${lastName.toLowerCase()}`,
      });
      const slip = firstPasswordSlipSchema.parse(made.body);
      const account = await t.database.migrator
        .selectFrom('accounts')
        .select('id')
        .where('login', '=', slip.login)
        .executeTakeFirstOrThrow();
      await t.kit.giveRole(account.id, { role: 'principal', branchId: t.north });
      expect((await ask(slip.login)).status).toBe(202);
      expect(await linksOf(account.id)).toHaveLength(0);

      // Path B: a teacher's email by the Academic Vice Principal, then a stronger role.
      const teacher = await person();
      t.clock.advance(MINUTE);
      expect(
        (
          await t.put(
            `/api/people/staff/${teacher.id}`,
            t.north,
            recordOf(teacher.lastName, 'vice.other@example.test'),
            t.vicePrincipal,
          )
        ).status,
      ).toBe(200);
      await t.kit.giveRole(teacher.accountId, {
        role: 'academic_vice_principal',
        branchId: t.north,
      });
      expect((await ask(teacher.login)).status).toBe(202);
      expect(await linksOf(teacher.accountId)).toHaveLength(0);

      // The Super Admin writes the email again: the link is made.
      t.clock.advance(MINUTE);
      expect(
        (
          await t.put(
            `/api/people/staff/${teacher.id}`,
            t.north,
            recordOf(teacher.lastName, 'checked.by.admin@example.test'),
          )
        ).status,
      ).toBe(200);
      expect((await ask(teacher.login)).status).toBe(202);
      expect(await linksOf(teacher.accountId)).toHaveLength(1);
    });

    // Code round 1 of the review of #66, finding 1: an email the Academic
    // Vice Principal of North wrote opens no account whose roles are all in
    // another branch, whether the account came afterwards or moved there.
    it('makes no link for a teacher of another branch when the email was written by an Academic Vice Principal', async () => {
      // Path A: the email set on a record without account, the account made in South.
      count += 1;
      const lastName = `Rahimova${lettersOf(count)}`;
      const created = await t.post('/api/people/staff', t.north, recordOf(lastName, ''));
      expect(created.status).toBe(201);
      const id = staffDetailSchema.parse(created.body).id;
      const edit = await t.put(
        `/api/people/staff/${id}`,
        t.north,
        recordOf(lastName, 'vice.before@example.test'),
        t.vicePrincipal,
      );
      expect(edit.status, JSON.stringify(edit.body)).toBe(200);
      const made = await t.post(`/api/people/staff/${id}/account`, t.north, {
        login: `d.${lastName.toLowerCase()}`,
      });
      const slip = firstPasswordSlipSchema.parse(made.body);
      const account = await t.database.migrator
        .selectFrom('accounts')
        .select('id')
        .where('login', '=', slip.login)
        .executeTakeFirstOrThrow();
      await t.kit.giveRole(account.id, { role: 'teacher', branchId: t.south });
      expect((await ask(slip.login)).status).toBe(202);
      expect(await linksOf(account.id)).toHaveLength(0);

      // Path B: a teacher of North whose email the Vice Principal wrote gets a
      // link; the account then moves to South, and the confirm is refused.
      const teacher = await person();
      t.clock.advance(MINUTE);
      expect(
        (
          await t.put(
            `/api/people/staff/${teacher.id}`,
            t.north,
            recordOf(teacher.lastName, 'vice.moved@example.test'),
            t.vicePrincipal,
          )
        ).status,
      ).toBe(200);
      const token = await linkFor(teacher);
      const north = await t.database.migrator
        .selectFrom('assignments')
        .select('id')
        .where('account_id', '=', teacher.accountId)
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      const admin = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('id', '=', t.adminAssignment)
        .executeTakeFirstOrThrow();
      await t.kit.endRole(north.id, admin.account_id, t.north);
      await t.kit.giveRole(teacher.accountId, { role: 'teacher', branchId: t.south });
      expect(codeOf(await confirm(token))).toBe('reset_link_invalid');
      expect(await signsIn(teacher.login, CHOSEN)).toBe(false);
      t.clock.advance(RESET_LINK_INTERVAL_MS);
      expect((await ask(teacher.login)).status).toBe(202);
      expect(await linksOf(teacher.accountId)).toHaveLength(1);
    });

    // Must-fix 2: two requests at the same moment meet on the account row.
    it('makes one link when two requests come at the same moment', async () => {
      const made = await person();
      const [waiting] = await t.database.migrator.transaction().execute(async (held) => {
        await held
          .selectFrom('accounts')
          .select('id')
          .where('id', '=', made.accountId)
          .forUpdate()
          .execute();
        await held
          .insertInto('password_reset_links')
          .values({ account_id: made.accountId, requested_at: t.clock.now() })
          .execute();
        const waiting = ask(made.login).then((response) => response);
        await untilWaiting();
        return [waiting] as const;
      });
      expect((await waiting).status).toBe(202);
      expect(await linksOf(made.accountId)).toHaveLength(1);
      expect(await jobsOf(made.accountId)).toHaveLength(0);
    });
  });

  describe('the mail job', () => {
    it('makes the link and writes the mail in the account language, with no token in the database', async () => {
      const made = await person();
      await t.database.migrator
        .updateTable('accounts')
        .set({ language: 'ru' })
        .where('id', '=', made.accountId)
        .execute();
      expect((await ask(made.login)).status).toBe(202);
      const [link] = await linksOf(made.accountId);
      const mails = await deliver(link?.id ?? '');

      expect(mails).toHaveLength(1);
      const mail = mails[0] as Mail;
      expect(mail.to).toBe(made.address);
      expect(mail.subject).toBe('Выбор нового пароля');
      expect(mail.text).toContain('http://localhost:5173/reset-password#token=');
      expect(mail.text).toContain('60 минут');
      const token = tokenOf(mail);
      const [sent] = await linksOf(made.accountId);
      expect(sent).toMatchObject({
        sent_at: new Date(START),
        valid_until: new Date(new Date(START).getTime() + RESET_LINK_VALID_MS),
      });
      expect(JSON.stringify(sent)).not.toContain(token);
      const entries = await schoolEntries('auth.password_reset_mail_sent', made.accountId);
      expect(entries).toHaveLength(1);
      expect(JSON.stringify(entries)).not.toContain(token);
      expect(JSON.stringify(entries)).not.toContain(made.address);
      const jobs = await sql<{ data: unknown }>`
        select data from pgboss.job where name = ${passwordResetMailJob.name}
      `.execute(t.database.migrator);
      expect(JSON.stringify(jobs.rows)).not.toContain(token);
    });

    it('sends nothing a second time, nor for a closed link, a locked account, a person who left or a request older than an hour', async () => {
      const once = await person();
      expect((await ask(once.login)).status).toBe(202);
      const [first] = await linksOf(once.accountId);
      expect(await deliver(first?.id ?? '')).toHaveLength(1);
      expect(await deliver(first?.id ?? '')).toHaveLength(0);

      const superseded = await person();
      expect((await ask(superseded.login)).status).toBe(202);
      t.clock.advance(RESET_LINK_VALID_MS);
      expect((await ask(superseded.login)).status).toBe(202);
      const [old] = await linksOf(superseded.accountId);
      expect(await deliver(old?.id ?? '')).toHaveLength(0);

      t.clock.set(START);
      const locked = await person();
      expect((await ask(locked.login)).status).toBe(202);
      expect(
        (
          await t.post(`/api/people/staff/${locked.id}/account/lock`, t.north, {
            reason: 'Laptop lost',
          })
        ).status,
      ).toBe(200);
      const [lockedLink] = await linksOf(locked.accountId);
      expect(await deliver(lockedLink?.id ?? '')).toHaveLength(0);

      const left = await person();
      expect((await ask(left.login)).status).toBe(202);
      expect(
        (
          await t.post(`/api/people/staff/${left.id}/status`, t.north, {
            status: 'left',
            from: TODAY,
          })
        ).status,
      ).toBe(200);
      const [leftLink] = await linksOf(left.accountId);
      expect(await deliver(leftLink?.id ?? '')).toHaveLength(0);

      const late = await person();
      expect((await ask(late.login)).status).toBe(202);
      const [lateLink] = await linksOf(late.accountId);
      t.clock.advance(RESET_LINK_VALID_MS + 1);
      expect(await deliver(lateLink?.id ?? '')).toHaveLength(0);
      expect((await linksOf(late.accountId))[0]?.sent_at).toBeNull();
    });

    // `edge/system-behaviour`: email down, "Only that function fails".
    it('leaves the link unsent when the mail service fails, and a new try makes a new token', async () => {
      const made = await person();
      expect((await ask(made.login)).status).toBe(202);
      const [link] = await linksOf(made.accountId);
      mailer.failing = true;
      await expect(deliver(link?.id ?? '')).rejects.toThrow();
      expect((await linksOf(made.accountId))[0]?.token_hash).toBeNull();
      mailer.failing = false;
      expect(await deliver(link?.id ?? '')).toHaveLength(1);
    });
  });

  describe('the confirm', () => {
    it('sets the chosen password once, ends every session and trusted device, and forgets the failed sign-ins', async () => {
      const made = await person();
      const first = await t.kit.signIn(made.login, made.password, undefined, true);
      const cookie = cookieOf(first);
      const device = cookieOf(first, DEVICE_COOKIE);
      expect(first.status).toBe(200);
      expect(cookie).toBeDefined();
      const changed = await t.kit.changePassword(
        `${cookie ?? ''}; ${device ?? ''}`,
        made.password,
        NEW_PASSWORD,
      );
      expect(changed.status).toBe(204);
      const trusted = await t.kit.signIn(made.login, NEW_PASSWORD, undefined, true);
      const trustedCookie = cookieOf(trusted) ?? '';
      for (let wrong = 0; wrong < 4; wrong += 1) {
        expect((await t.kit.signIn(made.login, 'a wrong password 1')).status).toBe(401);
      }
      const token = await linkFor(made);

      const answer = await confirm(token);
      expect(answer.status, JSON.stringify(answer.body)).toBe(204);

      expect(await signsIn(made.login, NEW_PASSWORD)).toBe(false);
      const fresh = await t.kit.signIn(made.login, CHOSEN);
      expect(fresh.status).toBe(200);
      expect(sessionResponseSchema.parse(fresh.body).mustChangePassword).toBe(false);
      expect((await t.kit.get('/api/auth/session', trustedCookie)).status).toBe(401);
      const ended = await t.database.migrator
        .selectFrom('sessions')
        .select('end_reason')
        .where('account_id', '=', made.accountId)
        .where('end_reason', '=', 'password_reset')
        .execute();
      expect(ended.length).toBeGreaterThanOrEqual(1);
      expect(
        await t.database.migrator
          .selectFrom('sign_in_throttle')
          .selectAll()
          .where('login_hash', '=', createHash('sha256').update(made.login).digest('hex'))
          .execute()
          .then((rows) => rows.length),
      ).toBe(0);
      const [entry] = await schoolEntries('auth.password_reset_by_email', made.accountId);
      expect(entry).toMatchObject({ actor_id: made.accountId });
      expect(JSON.stringify(entry)).not.toContain(token);
      expect(JSON.stringify(entry)).not.toContain(CHOSEN);

      expect(codeOf(await confirm(token, 'yet another password 8'))).toBe('reset_link_invalid');
      expect(await signsIn(made.login, CHOSEN)).toBe(true);
    });

    // Decision 9: the stored moment against the clock, at both ends.
    it('works until the last millisecond of its hour and is expired at the hour', async () => {
      const early = await person();
      const earlyToken = await linkFor(early);
      t.clock.advance(RESET_LINK_VALID_MS - 1);
      expect((await confirm(earlyToken)).status).toBe(204);

      t.clock.set(START);
      const late = await person();
      const lateToken = await linkFor(late);
      t.clock.advance(RESET_LINK_VALID_MS);
      const answer = await confirm(lateToken);
      expect(answer.status).toBe(400);
      expect(errorCode(answer)).toBe('reset_link_expired');
      expect(await signsIn(late.login, CHOSEN)).toBe(false);
    });

    it('answers an unknown token or one of the wrong form before any password is hashed', async () => {
      vi.mocked(hashPassword).mockClear();
      for (const token of ['A'.repeat(43), 'short', '../../etc/passwd']) {
        const answer = await confirm(token);
        expect(answer.status, token).toBe(400);
        expect(errorCode(answer), token).toBe('reset_link_invalid');
      }
      expect(hashPassword).not.toHaveBeenCalled();
    });

    // Decision 11: what ends a link.
    it('refuses a link after a newer one, a password change, an administrator reset, a re-hire, an email change and a lock', async () => {
      const newer = await person();
      const oldToken = await linkFor(newer);
      t.clock.advance(RESET_LINK_VALID_MS);
      const newToken = await linkFor(newer);
      expect(codeOf(await confirm(oldToken))).toBe('reset_link_invalid');
      expect((await confirm(newToken)).status).toBe(204);

      t.clock.set(START);
      const changing = await person();
      const changeToken = await linkFor(changing);
      const signedIn = await t.kit.signIn(changing.login, changing.password);
      expect(
        (
          await t.kit.changePassword(
            `${cookieOf(signedIn) ?? ''}; ${cookieOf(signedIn, DEVICE_COOKIE) ?? ''}`,
            changing.password,
            NEW_PASSWORD,
          )
        ).status,
      ).toBe(204);
      expect(codeOf(await confirm(changeToken))).toBe('reset_link_invalid');

      const reset = await person();
      const resetToken = await linkFor(reset);
      expect(
        (await t.post(`/api/people/staff/${reset.id}/account/password-reset`, t.north, {})).status,
      ).toBe(200);
      expect(codeOf(await confirm(resetToken))).toBe('reset_link_invalid');

      const rehired = await person();
      const rehireToken = await linkFor(rehired);
      expect(
        (
          await t.post(`/api/people/staff/${rehired.id}/status`, t.north, {
            status: 'left',
            from: TODAY,
          })
        ).status,
      ).toBe(200);
      const back = await t.post(`/api/people/staff/${rehired.id}/status`, t.north, {
        status: 'active',
        from: TODAY,
      });
      expect(back.status, JSON.stringify(back.body)).toBe(200);
      expect(codeOf(await confirm(rehireToken))).toBe('reset_link_invalid');

      const moved = await person();
      const movedToken = await linkFor(moved);
      const edit = await t.put(
        `/api/people/staff/${moved.id}`,
        t.north,
        recordOf(moved.lastName, 'new.address@example.test'),
      );
      expect(edit.status, JSON.stringify(edit.body)).toBe(200);
      expect(codeOf(await confirm(movedToken))).toBe('reset_link_invalid');

      const locked = await person();
      const lockedToken = await linkFor(locked);
      expect(
        (
          await t.post(`/api/people/staff/${locked.id}/account/lock`, t.north, {
            reason: 'Laptop lost',
          })
        ).status,
      ).toBe(200);
      expect(codeOf(await confirm(lockedToken))).toBe('reset_link_invalid');
      expect(await signsIn(locked.login, CHOSEN)).toBe(false);
      // Should-fix 3 of the spec review of the build: the lock closed the link,
      // so it does not work again after an unlock.
      expect(
        (await t.post(`/api/people/staff/${locked.id}/account/unlock`, t.north, {})).status,
      ).toBe(200);
      expect(codeOf(await confirm(lockedToken))).toBe('reset_link_invalid');
    });

    // Correction 1 of the review of #66: the entry names the last email change,
    // made in a branch by the Academic Vice Principal, read without a branch.
    it('names the last email change of the record in its entry', async () => {
      const made = await person();
      t.clock.advance(MINUTE);
      const edit = await t.put(
        `/api/people/staff/${made.id}`,
        t.north,
        recordOf(made.lastName, 'changed.by.vice@example.test'),
        t.vicePrincipal,
      );
      expect(edit.status, JSON.stringify(edit.body)).toBe(200);
      const viceAccount = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('id', '=', t.viceAssignment)
        .executeTakeFirstOrThrow();
      t.clock.advance(MINUTE);
      const token = await linkFor(made);
      expect((await linksOf(made.accountId)).length).toBe(1);
      expect(mailer.sent.at(-1)?.to).toBe('changed.by.vice@example.test');

      expect((await confirm(token)).status).toBe(204);
      const [entry] = await schoolEntries('auth.password_reset_by_email', made.accountId);
      expect(entry?.details).toMatchObject({
        lastEmailChange: {
          by: viceAccount.account_id,
          at: new Date(new Date(START).getTime() + MINUTE).toISOString(),
        },
      });
    });

    it('keeps the second step: an Academic Vice Principal is asked for it at the next sign-in', async () => {
      const made = await person([{ role: 'academic_vice_principal' }]);
      const token = await linkFor(made);
      expect((await confirm(token)).status).toBe(204);
      const signedIn = await t.kit.signIn(made.login, CHOSEN);
      expect(signedIn.status).toBe(200);
      expect(sessionResponseSchema.parse(signedIn.body).secondStep).toBe('set_up_required');
    });

    it('lets one of two confirms of one link at the same moment through', async () => {
      const made = await person();
      const token = await linkFor(made);
      const answers = await Promise.all([
        confirm(token, CHOSEN),
        confirm(token, 'the other one 99'),
      ]);
      expect(answers.map((answer) => answer.status).sort()).toEqual([204, 400]);
      expect(
        answers.filter((answer) => answer.status === 400).map((answer) => errorCode(answer)),
      ).toEqual(['reset_link_invalid']);
      expect(await schoolEntries('auth.password_reset_by_email', made.accountId)).toHaveLength(1);
    });

    // Must-fix 1: each pair that meets on the account is tested both ways.
    describe('at the same moment as', () => {
      // Must-fix 1 of the spec review of the build: the confirm locks the
      // account first, as every writer that closes the links does; a writer
      // holding only the account makes the confirm wait, never deadlock.
      it('a writer that holds the account and then closes the links: no deadlock, the confirm is refused', async () => {
        const made = await person();
        const token = await linkFor(made);
        const [answer] = await t.database.migrator.transaction().execute(async (held) => {
          await held
            .selectFrom('accounts')
            .select('id')
            .where('id', '=', made.accountId)
            .forUpdate()
            .execute();
          const waiting = confirm(token).then((response) => response);
          await untilWaiting();
          await held
            .updateTable('password_reset_links')
            .set({ closed_at: t.clock.now() })
            .where('account_id', '=', made.accountId)
            .where('used_at', 'is', null)
            .where('closed_at', 'is', null)
            .execute();
          return [waiting] as const;
        });
        expect(codeOf(await answer)).toBe('reset_link_invalid');
      });

      it('a confirm held open: a request waits and makes no new link', async () => {
        const made = await person();
        await linkFor(made);
        const [link] = await linksOf(made.accountId);
        const [answer] = await t.database.migrator.transaction().execute(async (held) => {
          await held
            .selectFrom('accounts')
            .select('id')
            .where('id', '=', made.accountId)
            .forUpdate()
            .execute();
          await held
            .updateTable('password_reset_links')
            .set({ used_at: t.clock.now() })
            .where('id', '=', link?.id ?? '')
            .execute();
          const waiting = ask(made.login).then((response) => response);
          await untilWaiting();
          return [waiting] as const;
        });
        expect((await answer).status).toBe(202);
        expect(await linksOf(made.accountId)).toHaveLength(1);
      });

      it('an administrator reset held open: the confirm waits and is refused', async () => {
        const made = await person();
        const token = await linkFor(made);
        const [answer] = await t.database.migrator.transaction().execute(async (held) => {
          // What the reset does: the account row, then the links closed.
          const admin = await held
            .selectFrom('assignments')
            .select('account_id')
            .where('id', '=', t.adminAssignment)
            .executeTakeFirstOrThrow();
          await held
            .updateTable('accounts')
            .set({
              must_change_password: true,
              password_expires_at: new Date(t.clock.now().getTime() + 24 * 60 * MINUTE),
              password_reset_by: admin.account_id,
              password_reset_at: t.clock.now(),
            })
            .where('id', '=', made.accountId)
            .execute();
          await held
            .updateTable('password_reset_links')
            .set({ closed_at: t.clock.now() })
            .where('account_id', '=', made.accountId)
            .where('used_at', 'is', null)
            .where('closed_at', 'is', null)
            .execute();
          const waiting = confirm(token).then((response) => response);
          await untilWaiting();
          return [waiting] as const;
        });
        expect(codeOf(await answer)).toBe('reset_link_invalid');
      });

      it('a confirm held open: the administrator reset waits and wins after it', async () => {
        const made = await person();
        const token = await linkFor(made);
        const [link] = await linksOf(made.accountId);
        const chosen = await hashPassword(CHOSEN);
        const [answer] = await t.database.migrator.transaction().execute(async (held) => {
          // What the confirm does: the account, then the link.
          await held
            .updateTable('accounts')
            .set({ password_hash: chosen, password_changed_at: t.clock.now() })
            .where('id', '=', made.accountId)
            .execute();
          await held
            .updateTable('password_reset_links')
            .set({ used_at: t.clock.now() })
            .where('id', '=', link?.id ?? '')
            .execute();
          const waiting = t
            .post(`/api/people/staff/${made.id}/account/password-reset`, t.north, {})
            .then((response) => response);
          await untilWaiting();
          return [waiting] as const;
        });
        expect((await answer).status).toBe(200);
        expect(await signsIn(made.login, CHOSEN)).toBe(false);
        expect(codeOf(await confirm(token))).toBe('reset_link_invalid');
      });

      it('a lock held open: the confirm waits and is refused', async () => {
        const made = await person();
        const token = await linkFor(made);
        const admin = await t.database.migrator
          .selectFrom('assignments')
          .select('account_id')
          .where('id', '=', t.adminAssignment)
          .executeTakeFirstOrThrow();
        const [answer] = await t.database.migrator.transaction().execute(async (held) => {
          await held
            .updateTable('accounts')
            .set({
              locked_at: t.clock.now(),
              locked_by: admin.account_id,
              lock_reason: 'Laptop lost',
            })
            .where('id', '=', made.accountId)
            .execute();
          const waiting = confirm(token).then((response) => response);
          await untilWaiting();
          return [waiting] as const;
        });
        expect(codeOf(await answer)).toBe('reset_link_invalid');
        expect(await signsIn(made.login, CHOSEN)).toBe(false);
      });

      it('a confirm held open: the lock waits and holds after it', async () => {
        const made = await person();
        await linkFor(made);
        const [link] = await linksOf(made.accountId);
        const [answer] = await t.database.migrator.transaction().execute(async (held) => {
          // What the confirm does: the account, then the link.
          await held
            .updateTable('accounts')
            .set({ password_changed_at: t.clock.now() })
            .where('id', '=', made.accountId)
            .execute();
          await held
            .updateTable('password_reset_links')
            .set({ used_at: t.clock.now() })
            .where('id', '=', link?.id ?? '')
            .execute();
          const waiting = t
            .post(`/api/people/staff/${made.id}/account/lock`, t.north, { reason: 'Laptop lost' })
            .then((response) => response);
          await untilWaiting();
          return [waiting] as const;
        });
        expect((await answer).status).toBe(200);
        const row = await t.database.migrator
          .selectFrom('accounts')
          .select('locked_at')
          .where('id', '=', made.accountId)
          .executeTakeFirstOrThrow();
        expect(row.locked_at).not.toBeNull();
      });
    });
  });
});
