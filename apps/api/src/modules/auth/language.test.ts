import type { INestApplication } from '@nestjs/common';
import { sessionResponseSchema } from '@sodiq/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
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

// docs/spec/12-ux-standards.md, Language: each person chooses a language; the
// choice is remembered. Task 0.8d: it is stored on the account and taken from
// it at sign-in. Decided by the owner: a new account is in Uzbek; the chooser
// saves to the account when signed in. All names are invented.
describe('the language of an account', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let north: string;
  const clock = new FixedClock('2026-10-07T09:00:00+05:00');

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({ database: database.app, clock, controllers: [ProbeController] });
    kit = signInKit(app);
    north = await insertBranch(database.migrator, 'North');
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  const setLanguage = (cookie: string | undefined, body: object) => {
    const call = request(kit.server).put('/api/auth/language');
    return (cookie === undefined ? call : call.set('Cookie', cookie)).send(body);
  };

  const readSession = async (cookie: string) =>
    sessionResponseSchema.parse((await kit.get('/api/auth/session', cookie)).body);

  async function storedLanguage(accountId: string): Promise<string | undefined> {
    const found = await sql<{ language: string }>`
      select language from accounts where id = ${accountId}
    `.execute(database.migrator);
    return found.rows[0]?.language;
  }

  async function auditOf(accountId: string) {
    const found = await sql<{
      actor_id: string | null;
      record_type: string | null;
      record_id: string | null;
      old_value: unknown;
      new_value: unknown;
      request_id: string | null;
    }>`
      select actor_id, record_type, record_id, old_value, new_value, request_id
      from audit_log_school
      where action = 'account.language_changed' and record_id = ${accountId}
      order by occurred_at, id
    `.execute(database.migrator);
    return found.rows;
  }

  it('is Uzbek for a new account, and said at sign-in', async () => {
    const { account, cookie } = await kit.firstSession('Aziza', 'Yoldosheva');

    expect(await storedLanguage(account.id)).toBe('uz');
    expect((await readSession(cookie)).language).toBe('uz');
  });

  it('is stored by the chooser, said by every answer about the session, and taken from the account at the next sign-in', async () => {
    const { account, cookie } = await kit.fullSession('Bahrom', 'Yoldoshev');

    const response = await setLanguage(cookie, { language: 'ru' });

    expect(response.status).toBe(204);
    expect(await storedLanguage(account.id)).toBe('ru');
    expect((await readSession(cookie)).language).toBe('ru');

    // Another browser: the account's language comes with the sign-in answer.
    const signedIn = await kit.signIn(account.login, NEW_PASSWORD);
    expect(sessionResponseSchema.parse(signedIn.body).language).toBe('ru');
    expect((await readSession(cookieOf(signedIn) ?? '')).language).toBe('ru');
  });

  it('is said while a step is still owed: at sign-in with a first password, and before the code', async () => {
    const { account, cookie } = await kit.fullSession('Dilshod', 'Yoldoshev');
    expect((await setLanguage(cookie, { language: 'en' })).status).toBe(204);
    await kit.setUpSecondStep(cookie);

    const pending = await kit.signIn(account.login, NEW_PASSWORD);

    expect(pending.status).toBe(200);
    expect(sessionResponseSchema.parse(pending.body)).toMatchObject({
      secondStep: 'pending',
      language: 'en',
      assignments: [],
    });
  });

  // Owner's decision 6: the audit log records the language change.
  it('is written to the audit log with the old and the new value, in the same transaction', async () => {
    const { account, cookie } = await kit.fullSession('Elmira', 'Yoldosheva');

    await setLanguage(cookie, { language: 'ru' });
    await setLanguage(cookie, { language: 'en' });

    expect(await auditOf(account.id)).toEqual([
      {
        actor_id: account.id,
        record_type: 'account',
        record_id: account.id,
        old_value: { language: 'uz' },
        new_value: { language: 'ru' },
        request_id: expect.any(String) as string,
      },
      {
        actor_id: account.id,
        record_type: 'account',
        record_id: account.id,
        old_value: { language: 'ru' },
        new_value: { language: 'en' },
        request_id: expect.any(String) as string,
      },
    ]);
  });

  it('changes nothing and writes nothing for the language the account has', async () => {
    const { account, cookie } = await kit.fullSession('Farrux', 'Yoldoshev');

    expect((await setLanguage(cookie, { language: 'uz' })).status).toBe(204);

    expect(await storedLanguage(account.id)).toBe('uz');
    expect(await auditOf(account.id)).toEqual([]);
  });

  it('is one of the three languages and nothing else', async () => {
    const { account, cookie } = await kit.fullSession('Gulnora', 'Yoldosheva');

    for (const body of [
      { language: 'de' },
      { language: 'UZ' },
      { language: '' },
      {},
      { language: 1 },
    ]) {
      const response = await setLanguage(cookie, body);
      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('validation_failed');
    }
    expect(await storedLanguage(account.id)).toBe('uz');
  });

  // Decided by the owner: the browser's choice is for the pages before
  // sign-in only. A session that owes a step changes nothing on the account.
  describe('is not changed by a session that still owes a step', () => {
    it('with a first password', async () => {
      const { account, cookie } = await kit.firstSession('Hamid', 'Yoldoshev');

      const response = await setLanguage(cookie, { language: 'ru' });

      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('password_change_required');
      expect(await storedLanguage(account.id)).toBe('uz');
    });

    it('before the code of the second step', async () => {
      const { account, cookie } = await kit.fullSession('Iroda', 'Yoldosheva');
      await kit.setUpSecondStep(cookie);
      const pending = cookieOf(await kit.signIn(account.login, NEW_PASSWORD)) ?? '';

      const response = await setLanguage(pending, { language: 'ru' });

      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('second_step_required');
      expect(await storedLanguage(account.id)).toBe('uz');
    });

    it('before the set-up of a required second step', async () => {
      const { account, cookie } = await kit.fullSession('Jasur', 'Yoldoshev');
      await kit.giveRole(account.id, { role: 'academic_vice_principal', branchId: north });

      const response = await setLanguage(cookie, { language: 'ru' });

      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('second_step_set_up_required');
      expect(await storedLanguage(account.id)).toBe('uz');
    });
  });

  it('is changed by nobody without a session', async () => {
    const response = await setLanguage(undefined, { language: 'ru' });

    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe('not_signed_in');
  });
});
