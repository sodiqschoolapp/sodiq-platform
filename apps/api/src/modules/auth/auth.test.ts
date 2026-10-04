import type { Server } from 'node:http';
import { Controller, Get, Post, type INestApplication } from '@nestjs/common';
import { apiErrorSchema } from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { DEVICE_COOKIE } from '../../http/device-cookie.js';
import { SESSION_COOKIE } from '../../http/session-cookie.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { Accounts, type CreatedAccount } from './accounts.service.js';
import { CurrentSession } from './session.guard.js';
import { SESSION_TOKEN_BYTES, type ActiveSession } from './sessions.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// Invented for the tests.
const NEW_PASSWORD = 'a-new-password-73';

/** Stands for every route of a later task: it declares nothing, so it needs a full session. */
@Controller('probe')
class ProbeController {
  @Get()
  read(@CurrentSession() session: ActiveSession): { login: string } {
    return { login: session.login };
  }

  @Post()
  change(@CurrentSession() session: ActiveSession): { login: string } {
    return { login: session.login };
  }
}

// All names are invented.
describe('sign-in, sessions and the password change', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let server: Server;
  const clock = new FixedClock('2026-10-05T09:00:00+05:00');

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      database: database.app,
      clock,
      controllers: [ProbeController],
      // This suite is about passwords and sessions: its accounts sign in with
      // a password alone. The second step has its own suite (two-step.test.ts).
    });
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  function newAccount(firstName: string, lastName: string): Promise<CreatedAccount> {
    return app
      .get(Transactions)
      .run([], (transaction) =>
        app.get(Accounts).create(transaction, { firstName, lastName, createdBy: null }),
      );
  }

  const signIn = (login: string, password: string) =>
    request(server).post('/api/auth/sign-in').send({ login, password });

  /** The `Set-Cookie` lines of an answer. */
  function setCookies(response: Response): string[] {
    const header = response.headers['set-cookie'] as string[] | string | undefined;
    return header === undefined ? [] : [header].flat();
  }

  /** What a browser would send back after this answer: `name=value`. */
  function cookieOf(response: Response): string {
    const line = setCookies(response).find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
    expect(line).toBeDefined();
    return (line ?? '').split(';')[0] ?? '';
  }

  /** A signed-in session cookie for a new account that still has its first password. */
  async function firstSession(firstName: string, lastName: string) {
    const account = await newAccount(firstName, lastName);
    const response = await signIn(account.login, account.firstPassword);
    expect(response.status).toBe(200);
    return { account, cookie: cookieOf(response) };
  }

  /** The same, after the forced password change: a session that may use every route. */
  async function fullSession(firstName: string, lastName: string) {
    const { account, cookie } = await firstSession(firstName, lastName);
    const changed = await request(server)
      .post('/api/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: account.firstPassword, newPassword: NEW_PASSWORD });
    expect(changed.status).toBe(204);
    return { account, cookie };
  }

  const probe = (cookie?: string) => {
    const call = request(server).get('/api/probe');
    return cookie === undefined ? call : call.set('Cookie', cookie);
  };

  /**
   * Moves the clock like `clock.advance`, for a test whose session must still
   * be open afterwards: since task 0.6b a session ends when it is not used for
   * the idle limit, so the session is read every 14 minutes on the way.
   */
  async function advanceInUse(cookie: string, milliseconds: number): Promise<void> {
    const step = 14 * 60 * 1000;
    let left = milliseconds;
    while (left > step) {
      clock.advance(step);
      left -= step;
      const read = await request(server).get('/api/auth/session').set('Cookie', cookie);
      expect(read.status).toBe(200);
    }
    clock.advance(left);
  }

  const errorCode = (response: Response): string => apiErrorSchema.parse(response.body).error.code;

  async function sessionsOf(accountId: string) {
    const found = await sql<{
      token_hash: string;
      ended_at: Date | null;
      end_reason: string | null;
    }>`
      select token_hash, ended_at, end_reason from sessions where account_id = ${accountId}
      order by id
    `.execute(database.migrator);
    return found.rows;
  }

  async function auditOf(action: string, actorId: string) {
    const found = await sql<{
      record_type: string | null;
      details: unknown;
      request_id: string | null;
      occurred_at: Date;
      text: string;
    }>`
      select record_type, details, request_id, occurred_at, to_jsonb(l)::text as text
      from audit_log_school l where action = ${action} and actor_id = ${actorId}
    `.execute(database.migrator);
    return found.rows;
  }

  // docs/spec/13-technology.md, Security: sessions in secure cookies, kept in
  // the database.
  describe('sign-in', () => {
    it('opens a session and answers who signed in', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const account = await newAccount('Aziz', 'Karimov');

      const response = await signIn(account.login, account.firstPassword);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        login: 'a.karimov',
        secondStep: 'not_needed',
        mustChangePassword: true,
        passwordResetBy: null,
        trustedUntil: null,
      });
      expect(await sessionsOf(account.id)).toHaveLength(1);
    });

    // Since task 0.6b a sign-in also sets the device cookie (limits.test.ts).
    it('sets one session cookie that scripts cannot read, for HTTPS and this site only', async () => {
      const account = await newAccount('Barno', 'Aliyeva');

      const response = await signIn(account.login, account.firstPassword);

      const cookies = setCookies(response);
      expect(cookies.map((cookie) => cookie.split('=')[0]).sort()).toEqual([
        DEVICE_COOKIE,
        SESSION_COOKIE,
      ]);
      const [pair, ...attributes] = (
        cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`)) ?? ''
      ).split('; ');
      expect(pair?.startsWith('__Host-sodiq_session=')).toBe(true);
      expect(attributes.sort()).toEqual(['HttpOnly', 'Path=/', 'SameSite=Strict', 'Secure']);
    });

    // Asked for by the owner: at least 32 random bytes from crypto.randomBytes.
    it('makes a token of 32 random bytes and stores only its hash', async () => {
      const account = await newAccount('Charos', 'Aliyeva');

      const first = cookieOf(await signIn(account.login, account.firstPassword));
      const second = cookieOf(await signIn(account.login, account.firstPassword));

      const token = first.slice(`${SESSION_COOKIE}=`.length);
      expect(SESSION_TOKEN_BYTES).toBeGreaterThanOrEqual(32);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(SESSION_TOKEN_BYTES);
      expect(second).not.toBe(first);

      const stored = await sql<{ text: string }>`
        select to_jsonb(s)::text as text from sessions s where account_id = ${account.id}
      `.execute(database.migrator);
      expect(stored.rows).toHaveLength(2);
      for (const row of stored.rows) {
        expect(row.text).not.toContain(token);
      }
      expect(
        (await sessionsOf(account.id)).every((row) => /^[0-9a-f]{64}$/.test(row.token_hash)),
      ).toBe(true);
    });

    // Edge cases, "Accounts and sign-in": an unknown login and a wrong
    // password get the same answer.
    it('answers an unknown login and a wrong password alike, with no session and no cookie', async () => {
      const account = await newAccount('Dilshod', 'Aliyev');

      const unknown = await signIn('x.nobody', account.firstPassword);
      const wrong = await signIn(account.login, 'not-the-password');

      for (const response of [unknown, wrong]) {
        expect(response.status).toBe(401);
        expect(setCookies(response)).toEqual([]);
      }
      const withoutId = (response: Response) => {
        const body = apiErrorSchema.parse(response.body);
        return { ...body.error, requestId: '' };
      };
      expect(withoutId(unknown)).toEqual(withoutId(wrong));
      expect(withoutId(wrong).code).toBe('sign_in_failed');
      expect(await sessionsOf(account.id)).toEqual([]);
    });

    it('does not accept a login in another spelling or a password with a space added', async () => {
      const account = await newAccount('Elyor', 'Aliyev');

      expect(errorCode(await signIn(account.login, `${account.firstPassword} `))).toBe(
        'sign_in_failed',
      );
      expect(errorCode(await signIn(`${account.login}2`, account.firstPassword))).toBe(
        'sign_in_failed',
      );
    });

    // Found by the review: a zero byte in the login reached the database as a fault.
    it.each([
      ['a zero byte', 'a.karimov\u0000'],
      ['a capital letter', 'A.karimov'],
      ['a space', ' a.karimov'],
      ['a quote', "a.karimov' or '1'='1"],
      ['no dot', 'akarimov'],
    ])('answers a login with %s like any unknown login', async (_name, login) => {
      const response = await signIn(login, 'not-the-password');

      expect(response.status).toBe(401);
      expect(errorCode(response)).toBe('sign_in_failed');
    });

    it('refuses input that is not a login and a password, without repeating it', async () => {
      const response = await request(server)
        .post('/api/auth/sign-in')
        .send({ login: 'a.karimov', password: 'p'.repeat(129) });

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('validation_failed');
      expect(JSON.stringify(response.body)).not.toContain('ppp');
    });

    // Edge cases, "Accounts and sign-in": first passwords are valid for 7 days.
    describe('with a first password', () => {
      it('works one second before the 7 days are over', async () => {
        clock.set('2026-10-05T09:00:00+05:00');
        const account = await newAccount('Feruza', 'Aliyeva');
        clock.advance(7 * DAY_MS - 1000);

        expect((await signIn(account.login, account.firstPassword)).status).toBe(200);
      });

      it('is refused as expired when the 7 days are over', async () => {
        clock.set('2026-10-05T09:00:00+05:00');
        const account = await newAccount('Gulom', 'Aliyev');
        clock.advance(7 * DAY_MS);

        const response = await signIn(account.login, account.firstPassword);

        expect(response.status).toBe(401);
        expect(errorCode(response)).toBe('password_expired');
        expect(setCookies(response)).toEqual([]);
        expect(await sessionsOf(account.id)).toEqual([]);
      });

      it('tells only the person who knows the password that it expired', async () => {
        clock.set('2026-10-05T09:00:00+05:00');
        const account = await newAccount('Hilola', 'Aliyeva');
        clock.advance(8 * DAY_MS);

        expect(errorCode(await signIn(account.login, 'not-the-password'))).toBe('sign_in_failed');
      });

      it('no longer expires once the person chose a password', async () => {
        clock.set('2026-10-05T09:00:00+05:00');
        const { account } = await fullSession('Ikrom', 'Aliyev');
        clock.advance(30 * DAY_MS);

        expect((await signIn(account.login, NEW_PASSWORD)).status).toBe(200);
      });
    });

    // docs/spec/02-roles-and-access.md, Rules: every sign-in is written to the audit log.
    it('is written to the audit log with the session and the request, never the password', async () => {
      clock.set('2026-10-07T08:15:00+05:00');
      const account = await newAccount('Jasur', 'Aliyev');

      const response = await signIn(account.login, account.firstPassword);

      const entries = await auditOf('auth.sign_in', account.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        record_type: 'session',
        request_id: response.headers['x-request-id'],
        occurred_at: new Date('2026-10-07T08:15:00+05:00'),
      });
      expect(entries[0]?.text).not.toContain(account.firstPassword);
      expect(entries[0]?.text).not.toContain(cookieOf(response).split('=')[1]);
    });

    it('writes no sign-in to the audit log when it fails', async () => {
      const account = await newAccount('Kamola', 'Aliyeva');

      await signIn(account.login, 'not-the-password');

      expect(await auditOf('auth.sign_in', account.id)).toEqual([]);
    });

    // Edge cases, "Accounts and sign-in": several sessions are allowed.
    it('allows several sessions of one account side by side', async () => {
      const { account, cookie: first } = await fullSession('Laziz', 'Aliyev');
      const second = cookieOf(await signIn(account.login, NEW_PASSWORD));

      expect((await probe(first)).status).toBe(200);
      expect((await probe(second)).status).toBe(200);
    });
  });

  // docs/spec/02-roles-and-access.md: every request passes one check on the
  // server; a short list of routes works without sign-in.
  describe('a route that is not declared public', () => {
    it('answers a signed-in session', async () => {
      const { cookie } = await fullSession('Malika', 'Boboyeva');

      const response = await probe(cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ login: 'm.boboyeva' });
    });

    it.each([
      ['no cookie', undefined],
      ['a token nobody was given', `${SESSION_COOKIE}=${'A'.repeat(43)}`],
      ['a token that is too short', `${SESSION_COOKIE}=abc`],
      ['a token with other characters', `${SESSION_COOKIE}=${'%'.repeat(43)}`],
      ['an empty value', `${SESSION_COOKIE}=`],
      ['another cookie only', 'other=1; theme=dark'],
      ['a header that is not a cookie list', ';;;=;==;%%%'],
      ['a cookie whose name only ends like ours', `x${SESSION_COOKIE}=${'A'.repeat(43)}`],
    ])('refuses %s as not signed in, never as a fault', async (_name, cookie) => {
      const response = await probe(cookie);

      expect(response.status).toBe(401);
      expect(errorCode(response)).toBe('not_signed_in');
    });

    // However the path or the method is written, the guard is asked.
    it.each([
      ['HEAD', 'head', '/api/probe'],
      ['other letter case', 'get', '/API/Probe'],
      ['a trailing slash', 'get', '/api/probe/'],
      ['a changing method', 'post', '/api/probe'],
    ] as const)('refuses %s without a session', async (_name, method, path) => {
      expect((await request(server)[method](path)).status).toBe(401);
    });

    it('does not take the token from anywhere but the cookie', async () => {
      const { cookie } = await fullSession('Olim', 'Boboyev');
      const token = cookie.slice(`${SESSION_COOKIE}=`.length);

      const header = await request(server)
        .get('/api/probe')
        .set('Authorization', `Bearer ${token}`);
      const query = await request(server)
        .get('/api/probe')
        .query({ [SESSION_COOKIE]: token });

      expect(header.status).toBe(401);
      expect(query.status).toBe(401);
    });

    it('finds the session among other cookies', async () => {
      const { cookie } = await fullSession('Nodir', 'Boboyev');

      expect((await probe(`theme=dark; ${cookie}; other=1`)).status).toBe(200);
    });

    it('is refused for the session routes too without a session', async () => {
      const responses = await Promise.all([
        request(server).get('/api/auth/session'),
        request(server).post('/api/auth/sign-out'),
        request(server)
          .post('/api/auth/password')
          .send({ currentPassword: 'whatever-it-is', newPassword: NEW_PASSWORD }),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(401);
        expect(errorCode(response)).toBe('not_signed_in');
      }
    });

    it('leaves the health check public, with or without a cookie', async () => {
      expect((await request(server).get('/api/health')).status).toBe(200);
      expect(
        (await request(server).get('/api/health').set('Cookie', `${SESSION_COOKIE}=broken`)).status,
      ).toBe(200);
    });
  });

  // docs/spec/02-roles-and-access.md, Rules: staff must change the password at
  // first sign-in.
  describe('the forced password change', () => {
    it('refuses every other route while the first password is in use', async () => {
      const { cookie } = await firstSession('Odil', 'Davronov');

      const response = await probe(cookie);

      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('password_change_required');
    });

    it('lets the session be read, with the change still to do', async () => {
      const { cookie } = await firstSession('Parvina', 'Davronova');

      const response = await request(server).get('/api/auth/session').set('Cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        login: 'p.davronova',
        secondStep: 'not_needed',
        mustChangePassword: true,
        passwordResetBy: null,
        trustedUntil: null,
      });
    });

    it('lets the person sign out without changing it', async () => {
      const { cookie } = await firstSession('Qobil', 'Davronov');

      expect((await request(server).post('/api/auth/sign-out').set('Cookie', cookie)).status).toBe(
        204,
      );
    });

    const change = (cookie: string, currentPassword: string, newPassword: string) =>
      request(server)
        .post('/api/auth/password')
        .set('Cookie', cookie)
        .send({ currentPassword, newPassword });

    // Edge cases, "Accounts and sign-in": staff change their own password with
    // the current one; passwords have at least ten characters.
    it('refuses a change with a wrong current password', async () => {
      const { account, cookie } = await firstSession('Rano', 'Davronova');

      const response = await change(cookie, 'not-the-password', NEW_PASSWORD);

      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('current_password_wrong');
      expect((await signIn(account.login, account.firstPassword)).status).toBe(200);
      expect(errorCode(await probe(cookie))).toBe('password_change_required');
    });

    it('refuses a new password of 9 characters and accepts one of 10', async () => {
      const { account, cookie } = await firstSession('Sardor', 'Davronov');

      const short = await change(cookie, account.firstPassword, 'nine-char');
      expect(short.status).toBe(400);
      expect(errorCode(short)).toBe('validation_failed');
      expect(JSON.stringify(short.body)).not.toContain('nine-char');
      expect(errorCode(await probe(cookie))).toBe('password_change_required');

      expect((await change(cookie, account.firstPassword, 'ten-chars!')).status).toBe(204);
    });

    it('refuses a changing route too while the first password is in use', async () => {
      const { cookie } = await firstSession('Sanjar', 'Davronov');

      const response = await request(server).post('/api/probe').set('Cookie', cookie);

      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('password_change_required');
    });

    it('accepts a new password of 128 characters and refuses one of 129', async () => {
      const { account, cookie } = await firstSession('Shahlo', 'Davronova');

      const long = await change(cookie, account.firstPassword, 'p'.repeat(129));
      expect(long.status).toBe(400);
      expect(errorCode(long)).toBe('validation_failed');

      expect((await change(cookie, account.firstPassword, 'p'.repeat(128))).status).toBe(204);
      expect((await signIn(account.login, 'p'.repeat(128))).status).toBe(200);
    });

    // Edge cases, "Accounts and sign-in": first passwords are valid for 7 days.
    // Found by the review: a session opened in time kept the first password
    // usable as the current password without limit.
    describe('in a session that was opened in time, after the 7 days', () => {
      it('no longer accepts the first password as the current one', async () => {
        clock.set('2026-10-05T09:00:00+05:00');
        const account = await newAccount('Tohir', 'Davronov');
        // Since task 0.6d a session ends 7 days after its sign-in: signed in on the
        // fourth day, the session is 4 days old when the first password is 7.
        clock.advance(3 * DAY_MS);
        const cookie = cookieOf(await signIn(account.login, account.firstPassword));
        await advanceInUse(cookie, 4 * DAY_MS);

        const response = await change(cookie, account.firstPassword, NEW_PASSWORD);

        expect(response.status).toBe(401);
        expect(errorCode(response)).toBe('password_expired');
        expect(errorCode(await probe(cookie))).toBe('password_change_required');
        expect(errorCode(await signIn(account.login, NEW_PASSWORD))).toBe('sign_in_failed');
        expect(await auditOf('auth.password_change', account.id)).toEqual([]);
      });

      it('still accepts it one second before', async () => {
        clock.set('2026-10-05T09:00:00+05:00');
        const { account, cookie } = await firstSession('Tolib', 'Davronov');
        await advanceInUse(cookie, 7 * DAY_MS - 1000);

        expect((await change(cookie, account.firstPassword, NEW_PASSWORD)).status).toBe(204);
      });

      it('tells only the person who knows the password that it expired', async () => {
        clock.set('2026-10-05T09:00:00+05:00');
        const account = await newAccount('Tursun', 'Davronov');
        clock.advance(3 * DAY_MS);
        const cookie = cookieOf(await signIn(account.login, account.firstPassword));
        await advanceInUse(cookie, 5 * DAY_MS);

        expect(errorCode(await change(cookie, 'not-the-password', NEW_PASSWORD))).toBe(
          'current_password_wrong',
        );
      });
    });

    // Two changes that both start from the same current password: one wins.
    it('lets only one of two changes at the same moment through', async () => {
      const { account, cookie } = await firstSession('Ulugbek', 'Davronov');

      const responses = await Promise.all([
        change(cookie, account.firstPassword, 'first-of-two-changes'),
        change(cookie, account.firstPassword, 'second-of-two-changes'),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([204, 403]);
      const refused = responses.find((response) => response.status === 403);
      expect(refused === undefined ? '' : errorCode(refused)).toBe('current_password_wrong');
      expect(await auditOf('auth.password_change', account.id)).toHaveLength(1);
      const works = await Promise.all([
        signIn(account.login, 'first-of-two-changes'),
        signIn(account.login, 'second-of-two-changes'),
      ]);
      expect(works.map((response) => response.status).sort()).toEqual([200, 401]);
    });

    it('refuses a new password that is the current one', async () => {
      const { account, cookie } = await firstSession('Temur', 'Davronov');

      const response = await change(cookie, account.firstPassword, account.firstPassword);

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('password_unchanged');
      expect(errorCode(await probe(cookie))).toBe('password_change_required');
    });

    it('opens every route to the same session once the password is changed', async () => {
      const { account, cookie } = await firstSession('Umida', 'Davronova');

      expect((await change(cookie, account.firstPassword, NEW_PASSWORD)).status).toBe(204);

      expect((await probe(cookie)).status).toBe(200);
      const session = await request(server).get('/api/auth/session').set('Cookie', cookie);
      expect(session.body).toEqual({
        login: 'u.davronova',
        secondStep: 'not_needed',
        mustChangePassword: false,
        passwordResetBy: null,
        trustedUntil: null,
      });
    });

    it('replaces the password: the old one no longer signs in, the new one does', async () => {
      const { account } = await fullSession('Vali', 'Davronov');

      expect(errorCode(await signIn(account.login, account.firstPassword))).toBe('sign_in_failed');
      const response = await signIn(account.login, NEW_PASSWORD);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        login: 'v.davronov',
        secondStep: 'not_needed',
        mustChangePassword: false,
        passwordResetBy: null,
        trustedUntil: null,
      });
    });

    // Edge cases, "Accounts and sign-in": a password change ends all others.
    it('ends every other session of the account and of nobody else', async () => {
      clock.set('2026-10-08T14:00:00+05:00');
      const { account, cookie: phone } = await fullSession('Xurshid', 'Davronov');
      const laptop = cookieOf(await signIn(account.login, NEW_PASSWORD));
      const { cookie: colleague } = await fullSession('Yulduz', 'Davronova');

      expect((await change(laptop, NEW_PASSWORD, 'another-password-88')).status).toBe(204);

      expect(errorCode(await probe(phone))).toBe('not_signed_in');
      expect((await probe(laptop)).status).toBe(200);
      expect((await probe(colleague)).status).toBe(200);
      expect((await sessionsOf(account.id)).map((row) => row.end_reason)).toEqual([
        'password_change',
        null,
      ]);
    });

    it('is written to the audit log without any password', async () => {
      const { account, cookie } = await firstSession('Zafar', 'Davronov');

      await change(cookie, account.firstPassword, NEW_PASSWORD);

      const entries = await auditOf('auth.password_change', account.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ record_type: 'account', details: { endedSessions: 0 } });
      expect(entries[0]?.text).not.toContain(NEW_PASSWORD);
      expect(entries[0]?.text).not.toContain(account.firstPassword);
      expect(entries[0]?.text).not.toContain('$argon2id$');
    });

    it('writes nothing to the audit log when it is refused', async () => {
      const { account, cookie } = await firstSession('Anora', 'Ergasheva');

      await change(cookie, 'not-the-password', NEW_PASSWORD);

      expect(await auditOf('auth.password_change', account.id)).toEqual([]);
    });
  });

  describe('sign-out', () => {
    it('ends the session in the database and clears the cookie', async () => {
      clock.set('2026-10-09T16:45:00+05:00');
      const { account, cookie } = await fullSession('Bahrom', 'Fayzullayev');

      const response = await request(server).post('/api/auth/sign-out').set('Cookie', cookie);

      expect(response.status).toBe(204);
      const cleared = setCookies(response);
      expect(cleared).toHaveLength(1);
      expect(cleared[0]).toMatch(/^__Host-sodiq_session=;/);
      expect(cleared[0]).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(await sessionsOf(account.id)).toMatchObject([
        { ended_at: new Date('2026-10-09T16:45:00+05:00'), end_reason: 'sign_out' },
      ]);
    });

    it('makes the old token useless', async () => {
      const { cookie } = await fullSession('Dildora', 'Fayzullayeva');
      await request(server).post('/api/auth/sign-out').set('Cookie', cookie);

      expect(errorCode(await probe(cookie))).toBe('not_signed_in');
      expect(
        errorCode(await request(server).post('/api/auth/sign-out').set('Cookie', cookie)),
      ).toBe('not_signed_in');
    });

    it('leaves another session of the account signed in', async () => {
      const { account, cookie: first } = await fullSession('Erkin', 'Fayzullayev');
      const second = cookieOf(await signIn(account.login, NEW_PASSWORD));

      await request(server).post('/api/auth/sign-out').set('Cookie', first);

      expect((await probe(second)).status).toBe(200);
    });

    it('is written to the audit log once', async () => {
      const { account, cookie } = await fullSession('Gavhar', 'Fayzullayeva');

      await request(server).post('/api/auth/sign-out').set('Cookie', cookie);
      await request(server).post('/api/auth/sign-out').set('Cookie', cookie);

      const entries = await auditOf('auth.sign_out', account.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ record_type: 'session' });
    });
  });

  // A changing request that another site started is refused before it is read.
  describe('the cross-site check', () => {
    const post = (headers: Record<string, string>) =>
      request(server)
        .post('/api/auth/sign-in')
        .set(headers)
        .send({ login: 'x.nobody', password: 'not-the-password' });

    it.each(['cross-site', 'same-site', 'something-new'])(
      'refuses a changing request with Sec-Fetch-Site: %s',
      async (site) => {
        const response = await post({ 'Sec-Fetch-Site': site });

        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('cross_site_request');
      },
    );

    it.each(['same-origin', 'none'])('lets Sec-Fetch-Site: %s through', async (site) => {
      // Through the check, and then refused for its own reason.
      expect(errorCode(await post({ 'Sec-Fetch-Site': site }))).toBe('sign_in_failed');
    });

    it('refuses Sec-Fetch-Site of another site even with the own origin in Origin', async () => {
      const response = await post({
        'Sec-Fetch-Site': 'cross-site',
        Host: 'school.test',
        Origin: 'http://school.test',
      });

      expect(errorCode(response)).toBe('cross_site_request');
    });

    // Asked for by the owner: without Sec-Fetch-Site, Origin decides.
    it('without Sec-Fetch-Site, refuses an Origin that is not the own origin', async () => {
      for (const origin of [
        'http://other.test',
        'https://school.test',
        'http://school.test:8080',
        'http://school.test.other.test',
        'null',
      ]) {
        const response = await post({ Host: 'school.test', Origin: origin });

        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('cross_site_request');
      }
    });

    it('without Sec-Fetch-Site, lets the own origin through', async () => {
      const response = await post({ Host: 'school.test', Origin: 'http://school.test' });

      expect(errorCode(response)).toBe('sign_in_failed');
    });

    it('lets a caller that is not a browser through: neither header', async () => {
      expect(errorCode(await post({}))).toBe('sign_in_failed');
    });

    // The case the check exists for: the browser of a signed-in person is made
    // to send a changing request from another site.
    it('refuses a password change from another site and leaves the password as it was', async () => {
      const { account, cookie } = await firstSession('Ibrohim', 'Gafurov');

      for (const headers of [
        { 'Sec-Fetch-Site': 'cross-site' },
        { 'Sec-Fetch-Site': 'same-site' },
        { Host: 'school.test', Origin: 'https://other.test' },
      ]) {
        const response = await request(server)
          .post('/api/auth/password')
          .set('Cookie', cookie)
          .set(headers)
          .send({ currentPassword: account.firstPassword, newPassword: NEW_PASSWORD });

        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('cross_site_request');
      }
      expect((await signIn(account.login, account.firstPassword)).status).toBe(200);
      expect(errorCode(await signIn(account.login, NEW_PASSWORD))).toBe('sign_in_failed');
    });

    it('refuses a sign-out from another site and leaves the session open', async () => {
      const { account, cookie } = await fullSession('Jahongir', 'Gafurov');

      const response = await request(server)
        .post('/api/auth/sign-out')
        .set('Cookie', cookie)
        .set('Sec-Fetch-Site', 'cross-site');

      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('cross_site_request');
      expect(setCookies(response)).toEqual([]);
      expect((await probe(cookie)).status).toBe(200);
      expect((await sessionsOf(account.id)).map((row) => row.end_reason)).toEqual([null]);
    });

    it('does not check a reading request', async () => {
      const response = await request(server).get('/api/health').set('Sec-Fetch-Site', 'cross-site');

      expect(response.status).toBe(200);
    });

    it('opens no session for a refused sign-in with the right password', async () => {
      const account = await newAccount('Hamid', 'Gafurov');

      const response = await request(server)
        .post('/api/auth/sign-in')
        .set('Sec-Fetch-Site', 'cross-site')
        .send({ login: account.login, password: account.firstPassword });

      expect(response.status).toBe(403);
      expect(setCookies(response)).toEqual([]);
      expect(await sessionsOf(account.id)).toEqual([]);
    });
  });
});
