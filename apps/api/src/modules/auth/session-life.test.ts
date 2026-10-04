import type { INestApplication } from '@nestjs/common';
import { sessionListSchema } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import {
  cookieOf,
  errorCode,
  NEW_PASSWORD,
  ProbeController,
  signInKit,
  type SignInKit,
} from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { endByTime, SESSION_MAX_LIFE_MS, type SessionMoments } from './session-life.js';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const IDLE = 30 * MINUTE;
const START = '2026-10-05T09:00:00+05:00';
const START_PLUS_7_DAYS = '2026-10-12T04:00:00.000Z';

const at = (milliseconds: number): Date => new Date(new Date(START).getTime() + milliseconds);

// Edge cases, "Accounts and sign-in": every session ends 7 days after sign-in
// at the latest, trusted or not; on a trusted device there is no idle sign-out.
describe('the end of a session by time', () => {
  const session = (moments: Partial<SessionMoments> = {}): SessionMoments => ({
    created_at: at(0),
    last_used_at: at(0),
    trusted_from: null,
    trust_ended_at: null,
    ...moments,
  });

  it('is 7 days', () => {
    expect(SESSION_MAX_LIFE_MS).toBe(7 * DAY);
  });

  it('is the idle limit after the last use, at that moment and not before', () => {
    expect(endByTime(session(), at(IDLE - 1), IDLE)).toBeUndefined();
    expect(endByTime(session(), at(IDLE), IDLE)).toEqual({ at: at(IDLE), reason: 'idle' });
    expect(endByTime(session(), at(3 * DAY), IDLE)).toEqual({ at: at(IDLE), reason: 'idle' });
  });

  it('is 7 days after the sign-in for a session in use, at that moment and not before', () => {
    const used = session({ last_used_at: at(7 * DAY - 1) });

    expect(endByTime(used, at(7 * DAY - 1), IDLE)).toBeUndefined();
    expect(endByTime(used, at(7 * DAY), IDLE)).toEqual({ at: at(7 * DAY), reason: 'expired' });
  });

  it('is 7 days after the sign-in on a trusted device, however long it was not used', () => {
    const trusted = session({ trusted_from: at(0) });

    expect(endByTime(trusted, at(7 * DAY - 1), IDLE)).toBeUndefined();
    expect(endByTime(trusted, at(7 * DAY), IDLE)).toEqual({ at: at(7 * DAY), reason: 'expired' });
  });

  it('is the idle limit again once the trust of the device has ended', () => {
    const untrusted = session({
      trusted_from: at(0),
      trust_ended_at: at(DAY),
      last_used_at: at(DAY),
    });

    expect(endByTime(untrusted, at(DAY + IDLE - 1), IDLE)).toBeUndefined();
    expect(endByTime(untrusted, at(DAY + IDLE), IDLE)).toEqual({
      at: at(DAY + IDLE),
      reason: 'idle',
    });
  });

  it('is the earlier of the two moments', () => {
    // Last used 5 minutes before the 7 days were over: the 7 days end it first.
    const used = session({ last_used_at: at(7 * DAY - 5 * MINUTE) });

    expect(endByTime(used, at(8 * DAY), IDLE)).toEqual({ at: at(7 * DAY), reason: 'expired' });
  });
});

// The same rule through the routes, with the injected clock. All names are invented.
describe('the longest life of a session', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  const clock = new FixedClock(START);

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      database: database.app,
      clock,
      controllers: [ProbeController],
    });
    kit = signInKit(app);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  async function sessionsOf(accountId: string) {
    const found = await sql<{ id: string; ended_at: Date | null; end_reason: string | null }>`
      select id, ended_at, end_reason from sessions
      where account_id = ${accountId} order by created_at, id
    `.execute(database.migrator);
    return found.rows;
  }

  async function auditOf(action: string, accountId: string) {
    const found = await sql<{ record_id: string | null; details: unknown }>`
      select record_id, details from audit_log_school
      where action = ${action} and (actor_id = ${accountId} or record_id = ${accountId})
      order by occurred_at, id
    `.execute(database.migrator);
    return found.rows;
  }

  /** Moves the clock while the session is read every 29 minutes, so it is never idle. */
  async function advanceInUse(cookie: string, milliseconds: number): Promise<void> {
    const step = 29 * MINUTE;
    let left = milliseconds;
    while (left > step) {
      clock.advance(step);
      left -= step;
      expect((await kit.get('/api/auth/session', cookie)).status).toBe(200);
    }
    clock.advance(left);
  }

  it('ends a session that is used all the time 7 days after its sign-in, and not before', async () => {
    clock.set(START);
    const { account, cookie } = await kit.fullSession('Aziz', 'Yusupov');

    await advanceInUse(cookie, 7 * DAY - 1);
    expect((await kit.probe(cookie)).status).toBe(200);

    clock.advance(1);
    const refused = await kit.probe(cookie);
    expect(refused.status).toBe(401);
    expect(errorCode(refused)).toBe('not_signed_in');
    const [session] = await sessionsOf(account.id);
    expect(session).toMatchObject({
      ended_at: new Date(START_PLUS_7_DAYS),
      end_reason: 'expired',
    });
    expect(await auditOf('auth.session_expired', account.id)).toEqual([
      { record_id: session?.id, details: { endedAt: START_PLUS_7_DAYS } },
    ]);
    expect(await auditOf('auth.session_idle', account.id)).toEqual([]);
  });

  it('still ends a session that is not used by the idle limit, long before the 7 days', async () => {
    clock.set(START);
    const { account, cookie } = await kit.fullSession('Barno', 'Yusupova');

    clock.advance(8 * DAY);

    expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
    expect((await sessionsOf(account.id))[0]).toMatchObject({
      ended_at: new Date('2026-10-05T09:30:00+05:00'),
      end_reason: 'idle',
    });
    expect(await auditOf('auth.session_expired', account.id)).toEqual([]);
  });

  it('leaves a session whose 7 days are over out of the list and out of the count of ended sessions', async () => {
    clock.set(START);
    const { account } = await kit.fullSession('Charos', 'Yusupova');
    const old = cookieOf(await kit.signIn(account.login, NEW_PASSWORD, undefined, true)) ?? '';
    clock.advance(7 * DAY);
    const fresh = cookieOf(await kit.signIn(account.login, NEW_PASSWORD)) ?? '';

    const list = sessionListSchema.parse((await kit.get('/api/auth/sessions', fresh)).body);
    expect(list.sessions.map((session) => session.current)).toEqual([true]);

    expect((await kit.post('/api/auth/sign-out-everywhere', fresh)).status).toBe(204);
    expect((await auditOf('auth.sign_out_everywhere', account.id)).map((e) => e.details)).toEqual([
      { endedSessions: 1 },
    ]);
    expect((await sessionsOf(account.id)).map((session) => session.end_reason)).toEqual([
      'idle',
      'expired',
      'sign_out_everywhere',
    ]);
    expect((await sessionsOf(account.id))[1]).toMatchObject({
      ended_at: new Date(START_PLUS_7_DAYS),
    });
    expect(errorCode(await kit.probe(old))).toBe('not_signed_in');
  });
});
