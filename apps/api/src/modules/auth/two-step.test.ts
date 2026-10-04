import type { INestApplication } from '@nestjs/common';
import {
  secondStepRecoveryCodesSchema,
  secondStepSetUpSchema,
  sessionListSchema,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import {
  base32Decode,
  cookieOf,
  errorCode,
  NEW_PASSWORD,
  OptionalSecondStep,
  ProbeController,
  signInKit,
  type SignInKit,
} from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { PasswordResets, UnknownAccountError } from './password-resets.service.js';
import { SecondStepSecrets } from './second-step-secrets.js';
import { totpCode, totpStep } from './totp.js';
import { OwnSecondStepResetError, TwoStep } from './two-step.service.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const STEP = 30 * SECOND;

// Edge cases, "Accounts and sign-in": the second step is a code from an
// authenticator app, with ten single-use recovery codes shown at set-up.
// docs/spec/02-roles-and-access.md, Rules: required for the Super Admin and
// Academic Vice Principal and optional for others. Until task 0.7 brings the
// roles it is required for every account (decided by the owner).
// All names are invented.
describe('the second step of sign-in', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  const clock = new FixedClock('2026-10-05T09:00:00+05:00');

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({ database: database.app, clock, controllers: [ProbeController] });
    kit = signInKit(app);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  /** A new code: the app shows another one every 30 seconds, and a code counts once. */
  function nextCode(secret: Buffer): string {
    clock.advance(STEP);
    return kit.codeOf(secret);
  }

  /** Six digits that are the code of no step near the present one. */
  function wrongCode(secret: Buffer): string {
    const near = [-1, 0, 1].map((offset) => kit.codeOf(secret, offset));
    let candidate = 0;
    while (near.includes(String(candidate).padStart(6, '0'))) {
      candidate += 1;
    }
    return String(candidate).padStart(6, '0');
  }

  /** Signs in with the password: the first of the two steps. */
  async function passwordStep(
    login: string,
    password: string = NEW_PASSWORD,
  ): Promise<{ response: Response; cookie: string }> {
    const response = await kit.signIn(login, password);
    expect(response.status).toBe(200);
    return { response, cookie: cookieOf(response) ?? '' };
  }

  const readSession = (cookie: string) => kit.get('/api/auth/session', cookie);

  async function secondStepRows(accountId: string) {
    const found = await sql<{
      confirmed_at: Date | null;
      failures: number;
      blocked_until: Date | null;
      text: string;
    }>`
      select confirmed_at, failures, blocked_until, to_jsonb(s)::text as text
      from account_second_steps s where account_id = ${accountId}
    `.execute(database.migrator);
    return found.rows;
  }

  async function recoveryRows(accountId: string) {
    const found = await sql<{ code_hash: string; used_at: Date | null }>`
      select code_hash, used_at from second_step_recovery_codes where account_id = ${accountId}
    `.execute(database.migrator);
    return found.rows;
  }

  /** Audit entries about an account or one of its sessions, by action. */
  async function auditOf(action: string, accountId: string) {
    const found = await sql<{
      actor_id: string | null;
      record_type: string | null;
      details: unknown;
      request_id: string | null;
      text: string;
    }>`
      select actor_id, record_type, details, request_id, to_jsonb(l)::text as text
      from audit_log_school l
      where action = ${action} and (actor_id = ${accountId} or record_id = ${accountId})
    `.execute(database.migrator);
    return found.rows;
  }

  async function allAuditText(accountId: string): Promise<string> {
    const found = await sql<{ text: string }>`
      select to_jsonb(l)::text as text from audit_log_school l
      where actor_id = ${accountId} or record_id = ${accountId}
    `.execute(database.migrator);
    return found.rows.map((row) => row.text).join('\n');
  }

  describe('where it is required and not set up', () => {
    it('says so at sign-in, after the password change', async () => {
      const account = await kit.newAccount('Aziz', 'Rahimov');

      const first = await kit.signIn(account.login, account.firstPassword);
      const cookie = cookieOf(first) ?? '';

      expect(first.body).toEqual({
        login: 'a.rahimov',
        secondStep: 'set_up_required',
        mustChangePassword: true,
        passwordResetBy: null,
        trustedUntil: null,
      });
      // The first password is changed before anything is added to the account.
      const early = await kit.post('/api/auth/second-step/set-up', cookie);
      expect(early.status).toBe(403);
      expect(errorCode(early)).toBe('password_change_required');
      expect(errorCode(await kit.probe(cookie))).toBe('password_change_required');
    });

    it('refuses every route but the set-up, the session, the password and sign-out', async () => {
      const { cookie } = await kit.fullSession('Barno', 'Rahimova');

      for (const refused of [
        await kit.probe(cookie),
        await kit.get('/api/auth/sessions', cookie),
        await kit.post('/api/auth/sign-out-everywhere', cookie),
        await kit.post('/api/auth/second-step/turn-off', cookie).send({ code: '123456' }),
      ]) {
        expect(refused.status).toBe(403);
        expect(errorCode(refused)).toBe('second_step_set_up_required');
      }

      expect((await readSession(cookie)).body).toMatchObject({ secondStep: 'set_up_required' });
      expect((await kit.get('/api/auth/second-step', cookie)).body).toEqual({
        on: false,
        required: true,
        recoveryCodesLeft: 0,
      });
      expect((await kit.changePassword(cookie, NEW_PASSWORD, 'another-password-88')).status).toBe(
        204,
      );
      expect((await kit.post('/api/auth/sign-out', cookie)).status).toBe(204);
    });
  });

  describe('the set-up', () => {
    it('shows the secret for the app once, and nothing is in force before a code confirms it', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account, cookie } = await kit.fullSession('Charos', 'Rahimova');

      const started = await kit.post('/api/auth/second-step/set-up', cookie);

      expect(started.status).toBe(200);
      const { secret, address } = secondStepSetUpSchema.parse(started.body);
      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(new URL(address).searchParams.get('secret')).toBe(secret);
      expect(decodeURIComponent(new URL(address).pathname)).toBe('/Sodiq School:c.rahimova');
      expect(await secondStepRows(account.id)).toMatchObject([{ confirmed_at: null }]);
      expect(errorCode(await kit.probe(cookie))).toBe('second_step_set_up_required');
      // A sign-in meanwhile is not asked for a code of a set-up nobody confirmed.
      expect((await kit.signIn(account.login, NEW_PASSWORD)).body).toMatchObject({
        secondStep: 'set_up_required',
      });
    });

    it('is confirmed by a right code, which opens every route and shows ten recovery codes', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account, cookie } = await kit.fullSession('Dilshod', 'Rahimov');
      const started = await kit.post('/api/auth/second-step/set-up', cookie);
      const secret = base32Decode(secondStepSetUpSchema.parse(started.body).secret);

      const confirmed = await kit
        .post('/api/auth/second-step/confirm', cookie)
        .send({ code: kit.codeOf(secret) });

      expect(confirmed.status).toBe(200);
      const { recoveryCodes } = secondStepRecoveryCodesSchema.parse(confirmed.body);
      expect(recoveryCodes).toHaveLength(10);
      expect(new Set(recoveryCodes).size).toBe(10);
      for (const code of recoveryCodes) {
        expect(code).toMatch(/^[a-zA-Z0-9]{4}(-[a-zA-Z0-9]{4}){3}$/);
      }
      expect((await kit.probe(cookie)).status).toBe(200);
      expect((await readSession(cookie)).body).toMatchObject({ secondStep: 'passed' });
      expect((await kit.get('/api/auth/second-step', cookie)).body).toEqual({
        on: true,
        required: true,
        recoveryCodesLeft: 10,
      });
      expect(await secondStepRows(account.id)).toMatchObject([
        { confirmed_at: new Date('2026-10-05T09:00:00+05:00') },
      ]);
    });

    it('does not confirm with a wrong code, and can be tried again', async () => {
      const { account, cookie } = await kit.fullSession('Elyor', 'Rahimov');
      const started = await kit.post('/api/auth/second-step/set-up', cookie);
      const secret = base32Decode(secondStepSetUpSchema.parse(started.body).secret);

      const wrong = await kit
        .post('/api/auth/second-step/confirm', cookie)
        .send({ code: wrongCode(secret) });

      expect(wrong.status).toBe(403);
      expect(errorCode(wrong)).toBe('second_step_code_wrong');
      expect(await recoveryRows(account.id)).toEqual([]);
      // Not counted: whoever may confirm was just shown the secret.
      for (let attempt = 2; attempt <= 7; attempt += 1) {
        const again = await kit
          .post('/api/auth/second-step/confirm', cookie)
          .send({ code: wrongCode(secret) });
        expect(again.status).toBe(403);
      }
      expect(await secondStepRows(account.id)).toMatchObject([
        { confirmed_at: null, failures: 0, blocked_until: null },
      ]);
      expect(
        (await kit.post('/api/auth/second-step/confirm', cookie).send({ code: kit.codeOf(secret) }))
          .status,
      ).toBe(200);
    });

    it('started a second time replaces the first: only the newer secret confirms', async () => {
      const { cookie } = await kit.fullSession('Feruza', 'Rahimova');
      const first = await kit.post('/api/auth/second-step/set-up', cookie);
      const second = await kit.post('/api/auth/second-step/set-up', cookie);
      const older = base32Decode(secondStepSetUpSchema.parse(first.body).secret);
      const newer = base32Decode(secondStepSetUpSchema.parse(second.body).secret);

      expect(newer.equals(older)).toBe(false);
      const withOlder = await kit
        .post('/api/auth/second-step/confirm', cookie)
        .send({ code: kit.codeOf(older) });
      expect(errorCode(withOlder)).toBe('second_step_code_wrong');
      expect(
        (await kit.post('/api/auth/second-step/confirm', cookie).send({ code: kit.codeOf(newer) }))
          .status,
      ).toBe(200);
    });

    it('is refused while a second step is in force, and a confirm without a set-up too', async () => {
      const complete = await kit.completeSession('Gulom', 'Rahimov');
      const { cookie: bare } = await kit.fullSession('Hilola', 'Rahimova');

      const again = await kit.post('/api/auth/second-step/set-up', complete.cookie);
      const confirmAgain = await kit
        .post('/api/auth/second-step/confirm', complete.cookie)
        .send({ code: nextCode(complete.secret) });
      const withoutSetUp = await kit
        .post('/api/auth/second-step/confirm', bare)
        .send({ code: '123456' });

      expect(again.status).toBe(409);
      expect(errorCode(again)).toBe('second_step_already_on');
      expect(errorCode(confirmAgain)).toBe('second_step_already_on');
      expect(withoutSetUp.status).toBe(409);
      expect(errorCode(withoutSetUp)).toBe('second_step_not_on');
    });

    // Task 0.6c, decided by the owner: the secret is stored encrypted; recovery
    // codes are stored as hashes; the log holds neither.
    it('stores the secret encrypted and the recovery codes as hashes, and logs neither', async () => {
      const { account, cookie } = await kit.fullSession('Ikrom', 'Rahimov');
      const started = await kit.post('/api/auth/second-step/set-up', cookie);
      const shown = secondStepSetUpSchema.parse(started.body).secret;
      const secret = base32Decode(shown);
      const code = kit.codeOf(secret);
      const confirmed = await kit.post('/api/auth/second-step/confirm', cookie).send({ code });
      const { recoveryCodes } = secondStepRecoveryCodesSchema.parse(confirmed.body);

      const [stored] = await secondStepRows(account.id);
      expect(stored?.text).toMatch(/"secret": "v1:/);
      for (const form of [shown, secret.toString('base64'), secret.toString('hex')]) {
        expect(stored?.text).not.toContain(form);
      }
      const hashes = await recoveryRows(account.id);
      expect(hashes).toHaveLength(10);
      const log = await allAuditText(account.id);
      for (const recoveryCode of recoveryCodes) {
        const plain = recoveryCode.replaceAll('-', '');
        expect(hashes.some((row) => row.code_hash.includes(plain))).toBe(false);
        expect(log).not.toContain(recoveryCode);
        expect(log).not.toContain(plain);
      }
      expect(log).not.toContain(shown);
      expect(log).not.toContain(code);
      expect(await auditOf('account.second_step_on', account.id)).toMatchObject([
        {
          actor_id: account.id,
          record_type: 'account',
          request_id: confirmed.headers['x-request-id'],
        },
      ]);
    });
  });

  describe('at a sign-in of an account that has one', () => {
    it('comes after the password: until then the session reaches only the second step, itself and sign-out', async () => {
      const { account } = await kit.completeSession('Jasur', 'Rahimov');

      const { response, cookie } = await passwordStep(account.login);

      expect(response.body).toEqual({
        login: 'j.rahimov',
        secondStep: 'pending',
        mustChangePassword: false,
        passwordResetBy: null,
        trustedUntil: null,
      });
      for (const refused of [
        await kit.probe(cookie),
        await kit.get('/api/auth/sessions', cookie),
        await kit.get('/api/auth/second-step', cookie),
        await kit.post('/api/auth/second-step/set-up', cookie),
        await kit.post('/api/auth/sign-out-everywhere', cookie),
        await kit.post('/api/auth/second-step/confirm', cookie).send({ code: '123456' }),
        await kit.post('/api/auth/second-step/turn-off', cookie).send({ code: '123456' }),
        await kit.changePassword(cookie, NEW_PASSWORD, 'another-password-88'),
      ]) {
        expect(refused.status).toBe(403);
        expect(errorCode(refused)).toBe('second_step_required');
      }
      expect((await kit.signIn(account.login, NEW_PASSWORD)).status).toBe(200);
      expect((await readSession(cookie)).body).toMatchObject({ secondStep: 'pending' });
      expect((await kit.post('/api/auth/sign-out', cookie)).status).toBe(204);
    });

    it('is passed with the code of the app, which opens every route to that session only', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account, secret } = await kit.completeSession('Kamola', 'Rahimova');
      const { cookie } = await passwordStep(account.login);
      const other = await passwordStep(account.login);

      const passed = await kit.passSecondStep(cookie, nextCode(secret));

      expect(passed.status).toBe(200);
      expect(passed.body).toEqual({
        login: 'k.rahimova',
        secondStep: 'passed',
        mustChangePassword: false,
        passwordResetBy: null,
        trustedUntil: null,
      });
      expect((await kit.probe(cookie)).status).toBe(200);
      expect(errorCode(await kit.probe(other.cookie))).toBe('second_step_required');
      const list = await kit.get('/api/auth/sessions', cookie);
      expect(sessionListSchema.parse(list.body).sessions).toHaveLength(3);
      expect(await auditOf('auth.second_step_passed', account.id)).toMatchObject([
        {
          actor_id: account.id,
          record_type: 'session',
          details: { with: 'code' },
          request_id: passed.headers['x-request-id'],
        },
      ]);
    });

    it('accepts the code as the app shows it, with a space in the middle', async () => {
      const { account, secret } = await kit.completeSession('Laziz', 'Rahimov');
      const { cookie } = await passwordStep(account.login);
      const code = nextCode(secret);

      const passed = await kit.passSecondStep(cookie, `${code.slice(0, 3)} ${code.slice(3)}`);

      expect(passed.status).toBe(200);
    });

    it('refuses a wrong code, leaves the session closed and writes it to the log without the code', async () => {
      const { account, secret } = await kit.completeSession('Malika', 'Rahimova');
      const { cookie } = await passwordStep(account.login);
      const typed = wrongCode(secret);

      const refused = await kit.passSecondStep(cookie, typed);

      expect(refused.status).toBe(403);
      expect(errorCode(refused)).toBe('second_step_code_wrong');
      expect(errorCode(await kit.probe(cookie))).toBe('second_step_required');
      const entries = await auditOf('auth.second_step_failed', account.id);
      expect(entries).toMatchObject([
        { actor_id: account.id, request_id: refused.headers['x-request-id'] },
      ]);
      expect(entries[0]?.text).not.toContain(typed);
    });

    it.each(['', 'abc', '12345', '1234567', 'x'.repeat(41), 'not a code at all'])(
      'answers a text that cannot be a code without a fault: "%s"',
      async (text) => {
        const { account } = await kit.completeSession('Nodir', 'Rahimov');
        const { cookie } = await passwordStep(account.login);

        const refused = await kit.passSecondStep(cookie, text);

        // Empty or longer than 40 characters is no input at all; everything
        // else is a wrong code like any other: counted and logged.
        const input = text.length >= 1 && text.length <= 40;
        expect(refused.status).toBe(input ? 403 : 400);
        expect(errorCode(refused)).toBe(input ? 'second_step_code_wrong' : 'validation_failed');
        expect(JSON.stringify(refused.body)).not.toContain('xxxxx');
        expect(await secondStepRows(account.id)).toMatchObject([{ failures: input ? 1 : 0 }]);
        expect(await auditOf('auth.second_step_failed', account.id)).toHaveLength(input ? 1 : 0);
        expect(errorCode(await kit.probe(cookie))).toBe('second_step_required');
      },
    );

    it('lets a session that has passed give a code again, without harm', async () => {
      const { account, cookie, secret } = await kit.completeSession('Nargiza', 'Rahimova');

      const again = await kit.passSecondStep(cookie, nextCode(secret));

      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ secondStep: 'passed' });
      expect((await kit.probe(cookie)).status).toBe(200);
      expect(await secondStepRows(account.id)).toHaveLength(1);
    });

    // A changing request that another site started is refused before it is read.
    it('is not passed by a request from another site, even with the right code', async () => {
      const { account, secret } = await kit.completeSession('Nigora', 'Rahimova');
      const { cookie } = await passwordStep(account.login);

      const refused = await kit
        .passSecondStep(cookie, nextCode(secret))
        .set('Sec-Fetch-Site', 'cross-site');

      expect(refused.status).toBe(403);
      expect(errorCode(refused)).toBe('cross_site_request');
      expect(errorCode(await kit.probe(cookie))).toBe('second_step_required');
    });

    // The clock of a phone drifts: the code of the step before and after counts.
    describe('with a phone whose clock is not exact', () => {
      it.each([-1, 1])('accepts the code of step %i from now', async (offset) => {
        clock.set('2026-10-05T09:00:00+05:00');
        const { account, secret } = await kit.completeSession('Odil', 'Rahimov');
        // Past the step of the set-up, whose code is used.
        clock.advance(2 * STEP);
        const { cookie } = await passwordStep(account.login);

        expect((await kit.passSecondStep(cookie, kit.codeOf(secret, offset))).status).toBe(200);
      });

      it.each([-2, 2])('refuses the code of step %i from now', async (offset) => {
        clock.set('2026-10-05T09:00:00+05:00');
        const { account, secret } = await kit.completeSession('Parvina', 'Rahimova');
        clock.advance(3 * STEP);
        const { cookie } = await passwordStep(account.login);
        const code = totpCode(secret, totpStep(clock.now()) + offset);

        expect(errorCode(await kit.passSecondStep(cookie, code))).toBe('second_step_code_wrong');
      });
    });

    it('accepts a code once: the same code does not open a second session', async () => {
      const { account, secret } = await kit.completeSession('Qobil', 'Rahimov');
      const first = await passwordStep(account.login);
      const second = await passwordStep(account.login);
      const code = nextCode(secret);

      expect((await kit.passSecondStep(first.cookie, code)).status).toBe(200);
      const repeated = await kit.passSecondStep(second.cookie, code);

      expect(repeated.status).toBe(403);
      expect(errorCode(repeated)).toBe('second_step_code_wrong');
      // The code that confirmed the set-up is used too, and no older code counts after a newer one.
      expect((await kit.passSecondStep(second.cookie, kit.codeOf(secret, -1))).status).toBe(403);
      expect((await kit.passSecondStep(second.cookie, nextCode(secret))).status).toBe(200);
    });

    // docs/spec/13-technology.md, Security: sessions end after a period without use.
    it('does not keep a session that waits for the code alive', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account, secret } = await kit.completeSession('Rano', 'Rahimova');
      const { cookie } = await passwordStep(account.login);

      clock.advance(15 * MINUTE);

      const late = await kit.passSecondStep(cookie, kit.codeOf(secret));
      expect(late.status).toBe(401);
      expect(errorCode(late)).toBe('not_signed_in');
    });
  });

  describe('a recovery code', () => {
    it('passes the second step once, with or without its hyphens', async () => {
      const { account, recoveryCodes } = await kit.completeSession('Sardor', 'Rahimov');
      const [first, second] = recoveryCodes as [string, string];
      const one = await passwordStep(account.login);
      const two = await passwordStep(account.login);
      const three = await passwordStep(account.login);

      const passed = await kit.passSecondStep(one.cookie, first);
      const repeated = await kit.passSecondStep(two.cookie, first);
      const other = await kit.passSecondStep(three.cookie, second.replaceAll('-', ''));

      expect(passed.status).toBe(200);
      expect((await kit.probe(one.cookie)).status).toBe(200);
      expect(repeated.status).toBe(403);
      expect(errorCode(repeated)).toBe('second_step_code_wrong');
      expect(other.status).toBe(200);
      expect((await kit.get('/api/auth/second-step', one.cookie)).body).toMatchObject({
        recoveryCodesLeft: 8,
      });
      expect((await recoveryRows(account.id)).filter((row) => row.used_at !== null)).toHaveLength(
        2,
      );
      const entries = await auditOf('auth.recovery_code_used', account.id);
      expect(entries.map((entry) => entry.details)).toEqual([{ left: 9 }, { left: 8 }]);
      expect(await auditOf('auth.second_step_passed', account.id)).toMatchObject([
        { details: { with: 'recovery_code' } },
        { details: { with: 'recovery_code' } },
      ]);
    });

    it('of another account opens nothing', async () => {
      const { account } = await kit.completeSession('Temur', 'Rahimov');
      const colleague = await kit.completeSession('Umida', 'Rahimova');
      const { cookie } = await passwordStep(account.login);

      const refused = await kit.passSecondStep(cookie, colleague.recoveryCodes[0] ?? '');

      expect(errorCode(refused)).toBe('second_step_code_wrong');
      expect((await recoveryRows(colleague.account.id)).every((row) => row.used_at === null)).toBe(
        true,
      );
    });
  });

  // Wrong codes are counted per account, with the lengths of the password
  // limit: five answered as wrong, then a wait of 30 seconds that doubles.
  describe('the limit on wrong codes', () => {
    it('makes the sixth attempt wait, also with the right code, and ends at its moment', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account, secret } = await kit.completeSession('Vali', 'Rahimov');
      const { cookie } = await passwordStep(account.login);
      clock.advance(STEP);
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        expect(errorCode(await kit.passSecondStep(cookie, wrongCode(secret)))).toBe(
          'second_step_code_wrong',
        );
      }

      const waiting = await kit.passSecondStep(cookie, kit.codeOf(secret));
      expect(waiting.status).toBe(429);
      expect(errorCode(waiting)).toBe('too_many_attempts');
      expect(waiting.headers['retry-after']).toBe('30');
      expect(await auditOf('auth.second_step_failed', account.id)).toHaveLength(5);

      clock.advance(29 * SECOND);
      expect((await kit.passSecondStep(cookie, kit.codeOf(secret))).headers['retry-after']).toBe(
        '1',
      );

      clock.advance(SECOND);
      expect((await kit.passSecondStep(cookie, kit.codeOf(secret))).status).toBe(200);
      expect(await secondStepRows(account.id)).toMatchObject([
        { failures: 0, blocked_until: null },
      ]);
    });

    // The reason the count is not the password count: that one starts again
    // at every right password.
    it('is not cleared by a right password, in a new session or on another device', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account, secret } = await kit.completeSession('Xurshid', 'Rahimov');
      const { cookie } = await passwordStep(account.login);
      clock.advance(STEP);
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await kit.passSecondStep(cookie, wrongCode(secret));
      }

      const fresh = await passwordStep(account.login);
      const waiting = await kit.passSecondStep(fresh.cookie, kit.codeOf(secret));

      expect(waiting.status).toBe(429);
      expect(errorCode(await kit.probe(fresh.cookie))).toBe('second_step_required');
    });

    it('doubles the wait with each further wrong code and counts recovery codes too', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account, secret } = await kit.completeSession('Yulduz', 'Rahimova');
      const { cookie } = await passwordStep(account.login);
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await kit.passSecondStep(cookie, wrongCode(secret));
      }
      expect(errorCode(await kit.passSecondStep(cookie, 'abcd-efgh-jkmn-pqrs'))).toBe(
        'second_step_code_wrong',
      );

      for (const seconds of [30, 60, 120]) {
        const waiting = await kit.passSecondStep(cookie, wrongCode(secret));
        expect(waiting.headers['retry-after']).toBe(String(seconds));
        clock.advance(seconds * SECOND);
        // The session is in use all the while.
        expect((await readSession(cookie)).status).toBe(200);
        expect(errorCode(await kit.passSecondStep(cookie, wrongCode(secret)))).toBe(
          'second_step_code_wrong',
        );
      }
    });

    it('starts again after a right code', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account, secret } = await kit.completeSession('Zafar', 'Rahimov');
      const { cookie } = await passwordStep(account.login);
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await kit.passSecondStep(cookie, wrongCode(secret));
      }
      expect((await kit.passSecondStep(cookie, nextCode(secret))).status).toBe(200);

      const again = await passwordStep(account.login);
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        expect(errorCode(await kit.passSecondStep(again.cookie, wrongCode(secret)))).toBe(
          'second_step_code_wrong',
        );
      }
      expect((await kit.passSecondStep(again.cookie, nextCode(secret))).status).toBe(200);
    });
  });

  // Edge cases, "Accounts and sign-in": there is no "sign in as another user".
  describe('after a password reset by an administrator', () => {
    it('still stands between the one-time password and the account', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const administrator = await kit.newAccount('Anora', 'Salimova');
      const { account, secret } = await kit.completeSession('Bahrom', 'Salimov');
      const { oneTimePassword } = await app
        .get(Transactions)
        .run([], (transaction) =>
          app
            .get(PasswordResets)
            .byAdministrator(transaction, { accountId: account.id, resetBy: administrator.id }),
        );

      const { response, cookie } = await passwordStep(account.login, oneTimePassword);

      expect(response.body).toMatchObject({ secondStep: 'pending', mustChangePassword: true });
      const change = await kit.changePassword(cookie, oneTimePassword, 'another-password-88');
      expect(change.status).toBe(403);
      expect(errorCode(change)).toBe('second_step_required');
      expect(errorCode(await kit.probe(cookie))).toBe('second_step_required');
      expect(errorCode(await kit.get('/api/auth/second-step', cookie))).toBe(
        'second_step_required',
      );

      // The person, who has the phone: the code, then the forced change.
      expect((await kit.passSecondStep(cookie, nextCode(secret))).status).toBe(200);
      expect(errorCode(await kit.probe(cookie))).toBe('password_change_required');
      // Passed, and the reset password still in use: nothing but the password change.
      for (const refused of [
        await kit.get('/api/auth/second-step', cookie),
        await kit.passSecondStep(cookie, '123456'),
        await kit.post('/api/auth/second-step/set-up', cookie),
        await kit.post('/api/auth/second-step/confirm', cookie).send({ code: '123456' }),
        await kit.post('/api/auth/second-step/turn-off', cookie).send({ code: '123456' }),
        await kit.get('/api/auth/sessions', cookie),
        await kit.post('/api/auth/sign-out-everywhere', cookie),
      ]) {
        expect(refused.status).toBe(403);
        expect(errorCode(refused)).toBe('password_change_required');
      }
      expect(
        (await kit.changePassword(cookie, oneTimePassword, 'another-password-88')).status,
      ).toBe(204);
      expect((await kit.probe(cookie)).status).toBe(200);
    });
  });

  // Edge cases, "Accounts and sign-in": a Super Admin resets an Academic Vice
  // Principal's second step; another Super Admin resets a Super Admin's. The
  // route comes with task 2.3; this is the service.
  describe('a reset of the second step by an administrator', () => {
    const reset = (accountId: string, resetBy: string) =>
      app
        .get(Transactions)
        .run([], (transaction) =>
          app.get(TwoStep).resetByAdministrator(transaction, { accountId, resetBy }),
        );

    it('removes the second step and its recovery codes, and is logged as "reset by X for Y"', async () => {
      const administrator = await kit.newAccount('Charos', 'Salimova');
      const { account, recoveryCodes } = await kit.completeSession('Dilshod', 'Salimov');

      await reset(account.id, administrator.id);

      expect(await secondStepRows(account.id)).toEqual([]);
      expect(await recoveryRows(account.id)).toEqual([]);
      const passed = await sql<{ sessions: number }>`
        select count(*)::int as sessions from sessions
        where account_id = ${account.id} and second_step_passed_at is not null
      `.execute(database.migrator);
      expect(passed.rows).toEqual([{ sessions: 0 }]);
      const entries = await auditOf('account.second_step_reset', account.id);
      expect(entries).toMatchObject([
        { actor_id: administrator.id, record_type: 'account', details: { wasOn: true } },
      ]);
      // The person signs in with the password and must set up again; an old recovery code is nothing.
      const { response, cookie } = await passwordStep(account.login);
      expect(response.body).toMatchObject({ secondStep: 'set_up_required' });
      expect(errorCode(await kit.probe(cookie))).toBe('second_step_set_up_required');
      expect(errorCode(await kit.passSecondStep(cookie, recoveryCodes[0] ?? ''))).toBe(
        'second_step_set_up_required',
      );
    });

    it('makes open sessions set up again, and a session of before gives a code of the new one', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const administrator = await kit.newAccount('Elyor', 'Salimov');
      const { account, cookie: laptop, secret } = await kit.completeSession('Feruza', 'Salimova');
      const { cookie: phone } = await passwordStep(account.login);
      expect((await kit.passSecondStep(phone, nextCode(secret))).status).toBe(200);

      await reset(account.id, administrator.id);

      for (const cookie of [laptop, phone]) {
        expect(errorCode(await kit.probe(cookie))).toBe('second_step_set_up_required');
      }
      // At the very moment the phone passed the old one: no clock decides this.
      const renewed = await kit.setUpSecondStep(laptop);
      expect((await kit.probe(laptop)).status).toBe(200);
      expect(errorCode(await kit.probe(phone))).toBe('second_step_required');
      expect(errorCode(await kit.passSecondStep(phone, nextCode(secret)))).toBe(
        'second_step_code_wrong',
      );
      expect((await kit.passSecondStep(phone, nextCode(renewed.secret))).status).toBe(200);
    });

    it('refuses an administrator who resets their own, and changes nothing', async () => {
      const { account, cookie } = await kit.completeSession('Gulom', 'Salimov');

      await expect(reset(account.id, account.id)).rejects.toBeInstanceOf(OwnSecondStepResetError);

      expect(await secondStepRows(account.id)).toHaveLength(1);
      expect((await kit.probe(cookie)).status).toBe(200);
      expect(await auditOf('account.second_step_reset', account.id)).toEqual([]);
    });

    it('refuses an account that does not exist, and writes nothing', async () => {
      const administrator = await kit.newAccount('Hilola', 'Salimova');
      const nobody = '00000000-0000-7000-8000-000000000000';

      await expect(reset(nobody, administrator.id)).rejects.toBeInstanceOf(UnknownAccountError);

      expect(await auditOf('account.second_step_reset', nobody)).toEqual([]);
    });

    it('is logged for an account that had none', async () => {
      const administrator = await kit.newAccount('Ikrom', 'Salimov');
      const account = await kit.newAccount('Jasur', 'Salimov');

      await reset(account.id, administrator.id);

      expect(await auditOf('account.second_step_reset', account.id)).toMatchObject([
        { details: { wasOn: false } },
      ]);
    });
  });

  it('cannot be turned off where it is required', async () => {
    const { account, cookie, secret } = await kit.completeSession('Kamola', 'Salimova');

    const refused = await kit
      .post('/api/auth/second-step/turn-off', cookie)
      .send({ code: nextCode(secret) });

    expect(refused.status).toBe(403);
    expect(errorCode(refused)).toBe('second_step_cannot_turn_off');
    expect(await secondStepRows(account.id)).toHaveLength(1);
    expect((await kit.signIn(account.login, NEW_PASSWORD)).body).toMatchObject({
      secondStep: 'pending',
    });
  });

  // Task 0.6c, decided by the owner: a secret that cannot be decrypted makes
  // the account's second step "set up required", with an audit entry, never a 500.
  describe('with a stored secret that cannot be decrypted', () => {
    const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');

    it.each([
      [
        'it was encrypted with another key',
        (accountId: string, secret: Buffer) =>
          new SecondStepSecrets({ secondStepKey: OTHER_KEY }).seal(accountId, secret),
      ],
      [
        'it names a key version we do not have',
        (accountId: string, secret: Buffer) =>
          new SecondStepSecrets({ secondStepKey: OTHER_KEY })
            .seal(accountId, secret)
            .replace(/^v1:/, 'v2:'),
      ],
      ['it is not what we store', () => 'v1:AAAA:AAAA'],
    ])('because %s, asks for a new set-up instead of failing', async (_name, unreadable) => {
      const { account, secret } = await kit.completeSession('Laziz', 'Salimov');
      await sql`
        update account_second_steps set secret = ${unreadable(account.id, secret)}
        where account_id = ${account.id}
      `.execute(database.migrator);
      const { response, cookie } = await passwordStep(account.login);
      expect(response.body).toMatchObject({ secondStep: 'pending' });

      const answer = await kit.passSecondStep(cookie, nextCode(secret));

      expect(answer.status).toBe(403);
      expect(errorCode(answer)).toBe('second_step_set_up_required');
      expect(await secondStepRows(account.id)).toEqual([]);
      expect(await recoveryRows(account.id)).toEqual([]);
      expect(await auditOf('account.second_step_unreadable', account.id)).toMatchObject([
        {
          actor_id: account.id,
          record_type: 'account',
          request_id: answer.headers['x-request-id'],
        },
      ]);
      expect((await readSession(cookie)).body).toMatchObject({ secondStep: 'set_up_required' });
      expect(errorCode(await kit.probe(cookie))).toBe('second_step_set_up_required');

      await kit.setUpSecondStep(cookie);
      expect((await kit.probe(cookie)).status).toBe(200);
    });
  });

  describe('every route of the second step', () => {
    const ROUTES = [
      ['get', '/api/auth/second-step'],
      ['post', '/api/auth/second-step'],
      ['post', '/api/auth/second-step/set-up'],
      ['post', '/api/auth/second-step/confirm'],
      ['post', '/api/auth/second-step/turn-off'],
    ] as const;

    it.each(ROUTES)('%s %s is refused without a session', async (method, path) => {
      const response = await kit[method](path).send(
        method === 'post' ? { code: '123456' } : undefined,
      );

      expect(response.status).toBe(401);
      expect(errorCode(response)).toBe('not_signed_in');
    });

    it.each(ROUTES)('%s %s is refused while the first password is in use', async (method, path) => {
      const { cookie } = await kit.firstSession('Malika', 'Salimova');

      const response = await kit[method](path, cookie).send(
        method === 'post' ? { code: '123456' } : undefined,
      );

      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('password_change_required');
    });

    it('acts on the account of the session only', async () => {
      const first = await kit.completeSession('Nodir', 'Salimov');
      const second = await kit.completeSession('Odil', 'Salimov');
      const { cookie } = await passwordStep(first.account.login);

      // The code of a colleague's app opens nothing here.
      expect(errorCode(await kit.passSecondStep(cookie, nextCode(second.secret)))).toBe(
        'second_step_code_wrong',
      );
      expect((await kit.get('/api/auth/second-step', second.cookie)).body).toMatchObject({
        recoveryCodesLeft: 10,
      });
    });
  });

  // The count of wrong codes: forgotten 24 hours after the last one, and a
  // wait of 15 minutes at most (the lengths of the password limit).
  describe('the count of wrong codes over time', () => {
    const HOUR = 60 * MINUTE;

    async function fourWrongCodes(firstName: string) {
      clock.set('2026-10-05T09:00:00+05:00');
      const complete = await kit.completeSession(firstName, 'Yusupov');
      const { cookie } = await passwordStep(complete.account.login);
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await kit.passSecondStep(cookie, wrongCode(complete.secret));
      }
      return complete;
    }

    it('is forgotten 24 hours after the last wrong code', async () => {
      const { account, secret } = await fourWrongCodes('Aziz');

      clock.advance(24 * HOUR);

      const { cookie } = await passwordStep(account.login);
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        expect(errorCode(await kit.passSecondStep(cookie, wrongCode(secret)))).toBe(
          'second_step_code_wrong',
        );
      }
      expect(await secondStepRows(account.id)).toMatchObject([
        { failures: 4, blocked_until: null },
      ]);
      expect((await kit.passSecondStep(cookie, kit.codeOf(secret))).status).toBe(200);
    });

    it('is not forgotten one second before', async () => {
      const { account, secret } = await fourWrongCodes('Bahrom');

      clock.advance(24 * HOUR - SECOND);

      const { cookie } = await passwordStep(account.login);
      expect(errorCode(await kit.passSecondStep(cookie, wrongCode(secret)))).toBe(
        'second_step_code_wrong',
      );
      const waiting = await kit.passSecondStep(cookie, kit.codeOf(secret));
      expect(waiting.status).toBe(429);
      expect(waiting.headers['retry-after']).toBe('30');
    });

    it('makes nobody wait longer than 15 minutes, and never locks for good', async () => {
      const { account, secret } = await fourWrongCodes('Charos');

      for (const seconds of [30, 60, 120, 240, 480, 900, 900, 900]) {
        // A new session each time: the longest wait is as long as the idle limit.
        const { cookie } = await passwordStep(account.login);
        expect(errorCode(await kit.passSecondStep(cookie, wrongCode(secret)))).toBe(
          'second_step_code_wrong',
        );
        const waiting = await kit.passSecondStep(cookie, kit.codeOf(secret));
        expect(waiting.status).toBe(429);
        expect(waiting.headers['retry-after']).toBe(String(seconds));
        clock.advance(seconds * SECOND);
      }

      const { cookie } = await passwordStep(account.login);
      expect((await kit.passSecondStep(cookie, kit.codeOf(secret))).status).toBe(200);
    });
  });

  // The row of the second step is locked for each check, so attempts at the
  // same moment stand in a line (found by both reviews: it had no test).
  describe('with attempts at the same moment', () => {
    it('accepts one code of the app in one of two sessions only', async () => {
      const { account, secret } = await kit.completeSession('Dilnoza', 'Yusupova');
      const first = await passwordStep(account.login);
      const second = await passwordStep(account.login);
      const code = nextCode(secret);

      const answers = await Promise.all([
        kit.passSecondStep(first.cookie, code),
        kit.passSecondStep(second.cookie, code),
      ]);

      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 403]);
      expect(await auditOf('auth.second_step_passed', account.id)).toHaveLength(1);
      expect(await auditOf('auth.second_step_failed', account.id)).toHaveLength(1);
    });

    it('accepts one recovery code in one of three sessions only', async () => {
      const { account, recoveryCodes } = await kit.completeSession('Eldor', 'Yusupov');
      const sessions = [
        await passwordStep(account.login),
        await passwordStep(account.login),
        await passwordStep(account.login),
      ];

      const answers = await Promise.all(
        sessions.map(({ cookie }) => kit.passSecondStep(cookie, recoveryCodes[0] ?? '')),
      );

      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 403, 403]);
      expect((await recoveryRows(account.id)).filter((row) => row.used_at !== null)).toHaveLength(
        1,
      );
      expect(await auditOf('auth.recovery_code_used', account.id)).toHaveLength(1);
    });

    it('counts every wrong code', async () => {
      const { account, secret } = await kit.completeSession('Farrux', 'Yusupov');
      const { cookie } = await passwordStep(account.login);
      const wrong = wrongCode(secret);

      const answers = await Promise.all([1, 2, 3, 4].map(() => kit.passSecondStep(cookie, wrong)));

      expect(answers.map((answer) => answer.status)).toEqual([403, 403, 403, 403]);
      expect(await secondStepRows(account.id)).toMatchObject([{ failures: 4 }]);
      expect(await auditOf('auth.second_step_failed', account.id)).toHaveLength(4);
    });

    it('lets at most five of ten wrong codes be looked at', async () => {
      const { account, secret } = await kit.completeSession('Gulnora', 'Yusupova');
      const { cookie } = await passwordStep(account.login);
      const wrong = wrongCode(secret);

      const answers = await Promise.all(
        Array.from({ length: 10 }, () => kit.passSecondStep(cookie, wrong)),
      );

      expect(answers.map((answer) => answer.status).sort()).toEqual([
        403, 403, 403, 403, 403, 429, 429, 429, 429, 429,
      ]);
      expect(await secondStepRows(account.id)).toMatchObject([{ failures: 5 }]);
    });
  });

  // Found by the review: a started set-up whose secret cannot be decrypted was
  // removed without an entry in the log.
  it('removes a started set-up that cannot be decrypted, with an audit entry, and lets it start again', async () => {
    const { account, cookie } = await kit.fullSession('Husan', 'Yusupov');
    await kit.post('/api/auth/second-step/set-up', cookie);
    await sql`
      update account_second_steps set secret = 'v1:AAAA:AAAA' where account_id = ${account.id}
    `.execute(database.migrator);

    const answer = await kit.post('/api/auth/second-step/confirm', cookie).send({ code: '123456' });

    expect(answer.status).toBe(409);
    expect(errorCode(answer)).toBe('second_step_not_on');
    expect(await secondStepRows(account.id)).toEqual([]);
    expect(await auditOf('account.second_step_unreadable', account.id)).toMatchObject([
      { actor_id: account.id, request_id: answer.headers['x-request-id'] },
    ]);
    await kit.setUpSecondStep(cookie);
    expect((await kit.probe(cookie)).status).toBe(200);
  });
});

// docs/spec/02-roles-and-access.md, Rules: "optional for others". Until task
// 0.7 no account of the running application is such an "other"; the rule is
// replaced here so that the optional side is built and tested now.
describe('the second step where it is optional', () => {
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

  function nextCode(secret: Buffer): string {
    clock.advance(STEP);
    return kit.codeOf(secret);
  }

  const turnOff = (cookie: string, code: string) =>
    kit.post('/api/auth/second-step/turn-off', cookie).send({ code });

  async function rowsOf(accountId: string): Promise<number> {
    const found = await sql<{ rows: number }>`
      select (select count(*) from account_second_steps where account_id = ${accountId})::int
        + (select count(*) from second_step_recovery_codes where account_id = ${accountId})::int
        as rows
    `.execute(database.migrator);
    return found.rows[0]?.rows ?? 0;
  }

  it('is not asked for: a session is open after the password', async () => {
    const { cookie } = await kit.fullSession('Aziz', 'Tursunov');

    expect((await kit.probe(cookie)).status).toBe(200);
    expect((await kit.get('/api/auth/session', cookie)).body).toMatchObject({
      secondStep: 'not_needed',
    });
    expect((await kit.get('/api/auth/second-step', cookie)).body).toEqual({
      on: false,
      required: false,
      recoveryCodesLeft: 0,
    });
  });

  it('can be set up by the person, and then every other session owes a code', async () => {
    clock.set('2026-10-05T11:00:00+05:00');
    const { account, cookie: laptop } = await kit.fullSession('Barno', 'Tursunova');
    const phone = cookieOf(await kit.signIn(account.login, NEW_PASSWORD)) ?? '';
    expect((await kit.probe(phone)).status).toBe(200);

    const { secret } = await kit.setUpSecondStep(laptop);

    // The session that confirmed the set-up has passed it: the person is not
    // put back before the second step in the middle of their work.
    expect((await kit.probe(laptop)).status).toBe(200);
    expect((await kit.get('/api/auth/session', laptop)).body).toMatchObject({
      secondStep: 'passed',
    });
    const passed = await sql<{ second_step_passed_at: Date | null }>`
      select second_step_passed_at from sessions where account_id = ${account.id} order by id
    `.execute(database.migrator);
    expect(passed.rows).toEqual([
      { second_step_passed_at: new Date('2026-10-05T11:00:00+05:00') },
      { second_step_passed_at: null },
    ]);
    expect(errorCode(await kit.probe(phone))).toBe('second_step_required');
    expect((await kit.signIn(account.login, NEW_PASSWORD)).body).toMatchObject({
      secondStep: 'pending',
    });
    expect((await kit.passSecondStep(phone, nextCode(secret))).status).toBe(200);
    expect((await kit.probe(phone)).status).toBe(200);
  });

  it('is turned off with a right code: nothing is left, and sign-in needs the password alone', async () => {
    const { account, cookie, secret } = await kit.completeSession('Charos', 'Tursunova');

    const off = await turnOff(cookie, nextCode(secret));

    expect(off.status).toBe(204);
    expect(await rowsOf(account.id)).toBe(0);
    expect((await kit.probe(cookie)).status).toBe(200);
    expect((await kit.signIn(account.login, NEW_PASSWORD)).body).toMatchObject({
      secondStep: 'not_needed',
    });
    const entries = await sql<{ actor_id: string | null; request_id: string | null }>`
      select actor_id, request_id from audit_log_school
      where action = 'account.second_step_off' and record_id = ${account.id}
    `.execute(database.migrator);
    expect(entries.rows).toEqual([
      { actor_id: account.id, request_id: off.headers['x-request-id'] },
    ]);
  });

  // Somebody who has only the password must not turn the second step off or
  // replace it, also where it is optional.
  it('cannot be turned off, set up or confirmed by a session that owes the code', async () => {
    const { account, secret, recoveryCodes } = await kit.completeSession('Davron', 'Tursunov');
    const pending = cookieOf(await kit.signIn(account.login, NEW_PASSWORD)) ?? '';

    for (const refused of [
      await turnOff(pending, nextCode(secret)),
      await turnOff(pending, recoveryCodes[0] ?? ''),
      await kit.post('/api/auth/second-step/set-up', pending),
      await kit.post('/api/auth/second-step/confirm', pending).send({ code: kit.codeOf(secret) }),
      await kit.get('/api/auth/second-step', pending),
      await kit.probe(pending),
    ]) {
      expect(refused.status).toBe(403);
      expect(errorCode(refused)).toBe('second_step_required');
    }
    expect(await rowsOf(account.id)).toBe(11);
  });

  it('is turned off with a recovery code too', async () => {
    const { account, cookie, recoveryCodes } = await kit.completeSession('Dilshod', 'Tursunov');

    expect((await turnOff(cookie, recoveryCodes[3] ?? '')).status).toBe(204);
    expect(await rowsOf(account.id)).toBe(0);
  });

  it('is not turned off with a wrong code, which is counted', async () => {
    clock.set('2026-10-05T09:00:00+05:00');
    const { account, cookie, secret } = await kit.completeSession('Elyor', 'Tursunov');
    clock.advance(5 * STEP);
    const wrong = kit.codeOf(secret, 3);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const refused = await turnOff(cookie, wrong);
      expect(refused.status).toBe(403);
      expect(errorCode(refused)).toBe('second_step_code_wrong');
    }
    const waiting = await turnOff(cookie, kit.codeOf(secret));

    expect(waiting.status).toBe(429);
    expect(waiting.headers['retry-after']).toBe('30');
    expect(await rowsOf(account.id)).toBe(11);
  });

  it('is not there to turn off, and not there to pass, for an account without one', async () => {
    const { cookie } = await kit.fullSession('Feruza', 'Tursunova');

    for (const response of [
      await turnOff(cookie, '123456'),
      await kit.passSecondStep(cookie, '123456'),
    ]) {
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('second_step_not_on');
    }
  });
});
