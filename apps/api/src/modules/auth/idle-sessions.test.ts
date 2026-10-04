import type { INestApplication } from '@nestjs/common';
import { sessionListSchema } from '@sodiq/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../http/session-cookie.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import {
  cookieOf,
  errorCode,
  NEW_PASSWORD,
  OptionalSecondStep,
  ProbeController,
  setCookies,
  signInKit,
  type SignInKit,
} from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { IDLE_LIMIT_MS, idleLimitMs, SHORT_IDLE_LIMIT_MS } from './idle-limit.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

// Question 41 of the open questions: idle sessions end after 30 minutes, 15
// for the Super Admin and the Academic Vice Principal.
describe('the idle limit of a person', () => {
  it('is 30 minutes', () => {
    expect(idleLimitMs(['teacher'])).toBe(30 * MINUTE);
    expect(idleLimitMs(['teacher', 'tutor', 'head_teacher'])).toBe(IDLE_LIMIT_MS);
    expect(idleLimitMs([])).toBe(IDLE_LIMIT_MS);
  });

  it.each(['super_admin', 'academic_vice_principal'])('is 15 minutes with the role %s', (role) => {
    expect(idleLimitMs([role])).toBe(15 * MINUTE);
    expect(SHORT_IDLE_LIMIT_MS).toBe(15 * MINUTE);
  });

  it('is 15 minutes when one of several roles has the short limit', () => {
    expect(idleLimitMs(['teacher', 'academic_vice_principal'])).toBe(15 * MINUTE);
  });
});

// All names are invented.
describe('sessions over time', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  const clock = new FixedClock('2026-10-05T09:00:00+05:00');

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      database: database.app,
      clock,
      controllers: [ProbeController],
      secondStepRule: new OptionalSecondStep(),
    });
    kit = signInKit(app);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  async function sessionsOf(accountId: string) {
    const found = await sql<{
      ended_at: Date | null;
      end_reason: string | null;
      last_used_at: Date;
    }>`
      select ended_at, end_reason, last_used_at from sessions where account_id = ${accountId}
      order by id
    `.execute(database.migrator);
    return found.rows;
  }

  async function auditOf(action: string, actorId: string) {
    const found = await sql<{ record_type: string | null; details: unknown }>`
      select record_type, details from audit_log_school
      where action = ${action} and actor_id = ${actorId}
    `.execute(database.migrator);
    return found.rows;
  }

  // docs/spec/13-technology.md, Security: sessions end after a period without use.
  describe('idle sign-out', () => {
    // Task 0.7: roles do not exist yet, so today every session gets the
    // 15-minute limit of the Super Admin and the Academic Vice Principal (the
    // strict side, decided by the owner). 0.7 MUST CHANGE THIS TEST: with the
    // roles in place, `Sessions.idleLimitMs` calls `idleLimitMs(roles)`, and a
    // session of any other role lives until 29:59 and ends at 30:00, while the
    // two roles keep 14:59 and 15:00.
    describe('0.7: today every session gets the 15-minute limit', () => {
      it('answers one second before 15 minutes without use', async () => {
        clock.set('2026-10-05T09:00:00+05:00');
        const { cookie } = await kit.fullSession('Aziz', 'Latipov');

        clock.advance(15 * MINUTE - SECOND);

        expect((await kit.probe(cookie)).status).toBe(200);
      });

      it('is over at 15 minutes without use', async () => {
        clock.set('2026-10-05T09:00:00+05:00');
        const { cookie } = await kit.fullSession('Barno', 'Latipova');

        clock.advance(15 * MINUTE);

        const response = await kit.probe(cookie);
        expect(response.status).toBe(401);
        expect(errorCode(response)).toBe('not_signed_in');
      });
    });

    it('counts from the last use, not from the sign-in', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { cookie } = await kit.fullSession('Charos', 'Latipova');

      for (let use = 1; use <= 6; use += 1) {
        clock.advance(10 * MINUTE);
        expect((await kit.probe(cookie)).status).toBe(200);
      }

      clock.advance(15 * MINUTE);
      expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
    });

    // A route that works without sign-in does not read the session at all.
    it('does not count a call of a public route as a use', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account, cookie } = await kit.fullSession('Dilshod', 'Latipov');

      clock.advance(10 * MINUTE);
      expect((await kit.get('/api/health', cookie)).status).toBe(200);
      expect((await kit.signIn(account.login, 'not-the-password', cookie)).status).toBe(401);

      clock.advance(5 * MINUTE);
      expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
    });

    it('counts a refused request of the session as a use', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { cookie } = await kit.firstSession('Elyor', 'Latipov');

      clock.advance(10 * MINUTE);
      expect(errorCode(await kit.probe(cookie))).toBe('password_change_required');

      clock.advance(10 * MINUTE);
      expect((await kit.get('/api/auth/session', cookie)).status).toBe(200);
    });

    it('ends a session with a first password like any other', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { cookie } = await kit.firstSession('Feruza', 'Latipova');

      clock.advance(15 * MINUTE);

      expect(errorCode(await kit.get('/api/auth/session', cookie))).toBe('not_signed_in');
    });

    // State from stored moments: the session is over at its moment, whenever
    // somebody notices; no timed job writes the end.
    it('writes the end down with the moment it was over, once, when the session is next seen', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account, cookie } = await kit.fullSession('Gulom', 'Latipov');
      clock.advance(5 * MINUTE);
      await kit.probe(cookie);

      clock.advance(3 * 60 * MINUTE);
      expect(await sessionsOf(account.id)).toMatchObject([{ ended_at: null, end_reason: null }]);
      await kit.probe(cookie);
      await kit.probe(cookie);

      expect(await sessionsOf(account.id)).toEqual([
        {
          ended_at: new Date('2026-10-05T09:20:00+05:00'),
          end_reason: 'idle',
          last_used_at: new Date('2026-10-05T09:05:00+05:00'),
        },
      ]);
      expect(await auditOf('auth.session_idle', account.id)).toEqual([
        { record_type: 'session', details: { endedAt: '2026-10-05T04:20:00.000Z' } },
      ]);
    });

    it('leaves another session of the account that is in use', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account, cookie: idle } = await kit.fullSession('Hilola', 'Latipova');
      clock.advance(10 * MINUTE);
      const used = cookieOf(await kit.signIn(account.login, NEW_PASSWORD)) ?? '';

      clock.advance(5 * MINUTE);

      expect(errorCode(await kit.probe(idle))).toBe('not_signed_in');
      expect((await kit.probe(used)).status).toBe(200);
    });

    it('lets the person sign in again afterwards', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account, cookie } = await kit.fullSession('Ikrom', 'Latipov');
      clock.advance(60 * MINUTE);
      expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');

      expect((await kit.signIn(account.login, NEW_PASSWORD)).status).toBe(200);
    });
  });

  // Edge cases, "Accounts and sign-in": several sessions are allowed. The
  // profile lists them, with "sign out everywhere".
  describe('the list of sessions', () => {
    const list = async (cookie: string) => {
      const response = await kit.get('/api/auth/sessions', cookie);
      expect(response.status).toBe(200);
      return sessionListSchema.parse(response.body).sessions;
    };

    it('shows the open sessions of the account, newest first, and marks the one that asks', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account, cookie: first } = await kit.fullSession('Jasur', 'Latipov');
      clock.advance(5 * MINUTE);
      const second =
        cookieOf(
          await kit.signIn(account.login, NEW_PASSWORD).set('User-Agent', 'Invented Browser 12'),
        ) ?? '';
      clock.advance(2 * MINUTE);

      const sessions = await list(first);

      expect(
        sessions.map((session) => ({
          startedAt: session.startedAt,
          lastUsedAt: session.lastUsedAt,
          userAgent: session.userAgent,
          current: session.current,
        })),
      ).toEqual([
        {
          startedAt: '2026-10-05T04:05:00.000Z',
          lastUsedAt: '2026-10-05T04:05:00.000Z',
          userAgent: 'Invented Browser 12',
          current: false,
        },
        {
          startedAt: '2026-10-05T04:00:00.000Z',
          // This request is a use.
          lastUsedAt: '2026-10-05T04:07:00.000Z',
          userAgent: null,
          current: true,
        },
      ]);
      expect((await list(second)).map((session) => session.current)).toEqual([true, false]);
    });

    it('shows no session of anybody else', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { cookie } = await kit.fullSession('Kamola', 'Latipova');
      const colleague = await kit.fullSession('Laziz', 'Latipov');

      const own = await list(cookie);
      const theirs = await list(colleague.cookie);

      expect(own).toHaveLength(1);
      expect(theirs).toHaveLength(1);
      expect(own[0]?.id).not.toBe(theirs[0]?.id);
    });

    it('leaves out a session that was signed out and one that is over by time', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account, cookie: idle } = await kit.fullSession('Malika', 'Latipova');
      const signedOut = cookieOf(await kit.signIn(account.login, NEW_PASSWORD)) ?? '';
      await kit.post('/api/auth/sign-out', signedOut);
      clock.advance(15 * MINUTE);
      const fresh = cookieOf(await kit.signIn(account.login, NEW_PASSWORD)) ?? '';

      const sessions = await list(fresh);

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.current).toBe(true);
      // Nobody has seen the idle one since: its row is still open.
      expect((await sessionsOf(account.id)).map((row) => row.end_reason)).toEqual([
        null,
        'sign_out',
        null,
      ]);
      expect(errorCode(await kit.probe(idle))).toBe('not_signed_in');
    });

    // Asked for by the owner: the name of the browser is cut to 200 characters.
    it('cuts the name of the browser to 200 characters', async () => {
      const account = await kit.newAccount('Nodir', 'Latipov');
      const cookie =
        cookieOf(
          await kit
            .signIn(account.login, account.firstPassword)
            .set('User-Agent', `${'b'.repeat(200)}rest`),
        ) ?? '';
      await kit.changePassword(cookie, account.firstPassword, NEW_PASSWORD);

      expect((await list(cookie))[0]?.userAgent).toBe('b'.repeat(200));
    });

    it('holds no token', async () => {
      const { cookie } = await kit.fullSession('Odil', 'Latipov');

      const response = await kit.get('/api/auth/sessions', cookie);

      expect(JSON.stringify(response.body)).not.toContain(
        cookie.slice(`${SESSION_COOKIE}=`.length),
      );
      expect(
        Object.keys((response.body as { sessions: object[] }).sessions[0] ?? {}).sort(),
      ).toEqual(['current', 'id', 'lastUsedAt', 'startedAt', 'trusted', 'userAgent']);
    });

    it('is refused without a session, and while the first password is in use', async () => {
      const { cookie } = await kit.firstSession('Parvina', 'Latipova');

      const without = await kit.get('/api/auth/sessions');
      const first = await kit.get('/api/auth/sessions', cookie);

      expect(without.status).toBe(401);
      expect(errorCode(without)).toBe('not_signed_in');
      expect(first.status).toBe(403);
      expect(errorCode(first)).toBe('password_change_required');
    });
  });

  describe('sign out everywhere', () => {
    it('ends every session of the account, this one included, and clears the cookie', async () => {
      clock.set('2026-10-09T16:45:00+05:00');
      const { account, cookie: laptop } = await kit.fullSession('Qobil', 'Latipov');
      const phone = cookieOf(await kit.signIn(account.login, NEW_PASSWORD)) ?? '';

      const response = await kit.post('/api/auth/sign-out-everywhere', laptop);

      expect(response.status).toBe(204);
      const cleared = setCookies(response);
      expect(cleared).toHaveLength(1);
      expect(cleared[0]).toMatch(/^__Host-sodiq_session=;/);
      expect(errorCode(await kit.probe(laptop))).toBe('not_signed_in');
      expect(errorCode(await kit.probe(phone))).toBe('not_signed_in');
      expect(await sessionsOf(account.id)).toMatchObject([
        { ended_at: new Date('2026-10-09T16:45:00+05:00'), end_reason: 'sign_out_everywhere' },
        { ended_at: new Date('2026-10-09T16:45:00+05:00'), end_reason: 'sign_out_everywhere' },
      ]);
    });

    it('ends no session of anybody else and leaves sessions that had ended as they were', async () => {
      clock.set('2026-10-09T16:45:00+05:00');
      const { account, cookie } = await kit.fullSession('Rano', 'Latipova');
      const signedOut = cookieOf(await kit.signIn(account.login, NEW_PASSWORD)) ?? '';
      await kit.post('/api/auth/sign-out', signedOut);
      const { cookie: colleague } = await kit.fullSession('Sardor', 'Latipov');

      await kit.post('/api/auth/sign-out-everywhere', cookie);

      expect((await kit.probe(colleague)).status).toBe(200);
      expect((await sessionsOf(account.id)).map((row) => row.end_reason)).toEqual([
        'sign_out_everywhere',
        'sign_out',
      ]);
    });

    // Found by the review: a session that is over by time and was not seen
    // since ended at its own moment, not at this one.
    it('leaves a session that was already over by time its own end and does not count it', async () => {
      clock.set('2026-10-09T16:00:00+05:00');
      const { account } = await kit.fullSession('Yulduz', 'Latipova');
      clock.advance(20 * MINUTE);
      const fresh = cookieOf(await kit.signIn(account.login, NEW_PASSWORD)) ?? '';

      await kit.post('/api/auth/sign-out-everywhere', fresh);

      expect(await sessionsOf(account.id)).toMatchObject([
        { ended_at: new Date('2026-10-09T16:15:00+05:00'), end_reason: 'idle' },
        { ended_at: new Date('2026-10-09T16:20:00+05:00'), end_reason: 'sign_out_everywhere' },
      ]);
      expect(await auditOf('auth.sign_out_everywhere', account.id)).toMatchObject([
        { details: { endedSessions: 1 } },
      ]);
      expect(await auditOf('auth.session_idle', account.id)).toHaveLength(1);
    });

    it('is the same for a password change', async () => {
      clock.set('2026-10-09T16:00:00+05:00');
      const { account } = await kit.fullSession('Zafar', 'Latipov');
      clock.advance(20 * MINUTE);
      const fresh = cookieOf(await kit.signIn(account.login, NEW_PASSWORD)) ?? '';

      expect((await kit.changePassword(fresh, NEW_PASSWORD, 'another-password-88')).status).toBe(
        204,
      );

      expect((await sessionsOf(account.id)).map((row) => row.end_reason)).toEqual(['idle', null]);
      expect(await auditOf('auth.session_idle', account.id)).toHaveLength(1);
    });

    it('lets the person sign in again', async () => {
      const { account, cookie } = await kit.fullSession('Temur', 'Latipov');
      await kit.post('/api/auth/sign-out-everywhere', cookie);

      expect((await kit.signIn(account.login, NEW_PASSWORD)).status).toBe(200);
    });

    it('is written to the audit log once, with the number of sessions it ended', async () => {
      const { account, cookie } = await kit.fullSession('Umida', 'Latipova');
      await kit.signIn(account.login, NEW_PASSWORD);
      await kit.signIn(account.login, NEW_PASSWORD);

      await kit.post('/api/auth/sign-out-everywhere', cookie);
      await kit.post('/api/auth/sign-out-everywhere', cookie);

      expect(await auditOf('auth.sign_out_everywhere', account.id)).toEqual([
        { record_type: 'account', details: { endedSessions: 3 } },
      ]);
    });

    it('is refused without a session, and while the first password is in use', async () => {
      const { account, cookie } = await kit.firstSession('Vali', 'Latipov');

      const without = await kit.post('/api/auth/sign-out-everywhere');
      const first = await kit.post('/api/auth/sign-out-everywhere', cookie);

      expect(without.status).toBe(401);
      expect(errorCode(without)).toBe('not_signed_in');
      expect(first.status).toBe(403);
      expect(errorCode(first)).toBe('password_change_required');
      expect((await sessionsOf(account.id)).map((row) => row.end_reason)).toEqual([null]);
    });

    it('is refused from another site and leaves the sessions open', async () => {
      const { account, cookie } = await kit.fullSession('Xurshid', 'Latipov');

      const response = await request(kit.server)
        .post('/api/auth/sign-out-everywhere')
        .set('Cookie', cookie)
        .set('Sec-Fetch-Site', 'cross-site');

      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('cross_site_request');
      expect((await sessionsOf(account.id)).map((row) => row.end_reason)).toEqual([null]);
    });
  });
});
