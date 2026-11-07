import type { INestApplication } from '@nestjs/common';
import { BRANCH_HEADER, neverUsedListSchema, sessionResponseSchema } from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import {
  cookieOf,
  errorCode,
  NEW_PASSWORD,
  signInKit,
  type SignInKit,
} from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { ParentsKit } from '../../testing/parents-kit.js';
import { signedLaunch, TEST_BOT_TOKEN } from '../../testing/telegram-kit.js';
import request from 'supertest';
import { newResetToken, resetTokenHash } from './reset-links.js';

// Task 10.5 (pull request #280), decisions 1 and 2 (Look first): with the demo clock on, the
// timing of sign-in follows real time, and the roles and the staff status in force follow demo
// time. Done when: "a jump of 8 days leaves a session and its second step working while a role
// starting that day is in force for the same session". All names are invented.

/** Wednesday 4 November 2026, 10:00 in Tashkent, real time. */
const REAL_START = '2026-11-04T10:00:00+05:00';
/** Thursday 12 November 2026, 09:00 in Tashkent: 8 days on, in demo time. */
const DEMO_TO = '2026-11-12T09:00:00+05:00';
const NEW_DATE = '2026-11-12';
/** An invented Telegram user. */
const CHAT = 7_500_001;

describe('sign-in across a jump of the demo clock', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let branch: string;
  const real = new FixedClock(REAL_START);

  let admin: Awaited<ReturnType<SignInKit['completeSession']>>;
  let trusted: string;
  let trustedAccount: string;
  let starting: string;
  let leaving: string;
  let unused: { login: string; firstPassword: string };
  let resetToken: string;

  const sessionOf = async (cookie: string) => {
    const response = await kit.get('/api/auth/session', cookie);
    return response.status === 200 ? sessionResponseSchema.parse(response.body) : response.status;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    branch = await insertBranch(database.migrator, 'North');
    app = await createTestApp({
      database: database.app,
      jobsDatabaseUrl: database.appUrl,
      demoClock: { real },
      // Task 11.4: the Telegram launch is judged by real time too.
      config: {
        telegram: {
          botToken: TEST_BOT_TOKEN,
          webhookSecret: undefined,
          webOrigin: 'https://app-test.example.invalid',
        },
      },
    });
    kit = signInKit(app);
    const people = new ClassesKit(database.migrator);

    // The Super Admin, with the second step, who jumps.
    admin = await kit.completeSession('Dilnoza', 'Karimova');
    await kit.giveRole(admin.account.id, { role: 'super_admin' });

    // A session on a trusted device.
    const owner = await kit.fullSession('Rustam', 'Aliyev');
    trustedAccount = owner.account.id;
    const signedIn = await kit.signIn(owner.account.login, NEW_PASSWORD, owner.device, true);
    trusted = cookieOf(signedIn) ?? '';
    expect(sessionResponseSchema.parse(signedIn.body).trustedUntil).not.toBeNull();

    // A Teacher from the new demo date on, signed in now with no role.
    const teacher = await kit.fullSession('Kamola', 'Rustamova');
    await kit.giveRole(teacher.account.id, {
      role: 'teacher',
      branchId: branch,
      validFrom: new Date(`${NEW_DATE}T00:00:00+05:00`),
    });
    starting = teacher.cookie;

    // A staff member who has left from the new demo date on.
    const left = await kit.fullSession('Sherzod', 'Yuldashev');
    const record = await people.person(branch, ['uz'], { accountId: left.account.id });
    await database.migrator
      .updateTable('staff_statuses')
      .set({ valid_until: NEW_DATE })
      .where('staff_id', '=', record.staffId)
      .execute();
    await database.migrator
      .insertInto('staff_statuses')
      .values({ staff_id: record.staffId, status: 'left', valid_from: NEW_DATE })
      .execute();
    leaving = left.cookie;

    // A staff member with a first password, never signed in.
    const fresh = await kit.newAccount('Nodira', 'Hasanova');
    await people.person(branch, ['uz'], { accountId: fresh.id });
    unused = { login: fresh.login, firstPassword: fresh.firstPassword };

    // A reset link of the trusted account, sent now and valid for an hour of real time.
    resetToken = newResetToken();
    await database.migrator
      .insertInto('password_reset_links')
      .values({
        account_id: trustedAccount,
        requested_at: real.now(),
        sent_at: real.now(),
        valid_until: new Date(real.now().getTime() + 3_600_000),
        token_hash: resetTokenHash(resetToken),
      })
      .execute();

    // Task 11.4: a parent links a chat before the jump.
    const parents = new ParentsKit(app, database.migrator, await people.account());
    const { relativeId } = await parents.student(branch);
    const { account: parent } = await parents.session(relativeId);
    const linked = await request(kit.server)
      .post('/api/auth/sign-in')
      .send({
        login: parent.login,
        password: NEW_PASSWORD,
        telegramInitData: signedLaunch({ telegramUserId: CHAT, signedAt: real.now() }),
      });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);

    expect(await sessionOf(starting)).toMatchObject({ assignments: [] });
    expect(await sessionOf(leaving)).toMatchObject({ login: left.account.login });

    const jumped = await kit
      .post('/api/setup/demo-clock/jumps', admin.cookie)
      .send({ to: DEMO_TO });
    expect(jumped.status, JSON.stringify(jumped.body)).toBe(200);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('has moved the platform 8 days on, and real time by the 5 seconds of the switch', () => {
    expect(real.now().toISOString()).toBe('2026-11-04T05:00:05.000Z');
  });

  it('keeps the Super Admin signed in, and the trusted device trusted', async () => {
    expect(await sessionOf(admin.cookie)).toMatchObject({ secondStep: 'passed' });
    const answer = await sessionOf(trusted);
    expect(answer).not.toBe(401);
    expect(typeof answer === 'number' ? null : answer.trustedUntil).not.toBeNull();
  });

  it('puts a role starting on the new demo date in force for the same session', async () => {
    expect(await sessionOf(starting)).toMatchObject({
      assignments: [{ role: 'teacher', branchId: branch }],
    });
  });

  it('refuses a staff member who has left from the new demo date', async () => {
    expect(await sessionOf(leaving)).toBe(401);
  });

  it('accepts the code the authenticator shows now, in real time', async () => {
    // The next 30-second step, so the code is not one already used at the set-up.
    real.advance(30_000);
    const signedIn = await kit.signIn(admin.account.login, NEW_PASSWORD, admin.device);
    expect(signedIn.status).toBe(200);
    const cookie = cookieOf(signedIn) ?? '';
    const passed = await kit.passSecondStep(cookie, kit.codeOf(admin.secret));
    expect(passed.status, JSON.stringify(passed.body)).toBe(200);
  });

  it('keeps a first password valid and not marked expired', async () => {
    const list = neverUsedListSchema.parse(
      (await kit.get('/api/people/accounts/never-used', admin.cookie).set(BRANCH_HEADER, branch))
        .body,
    );
    expect(list.accounts.find((one) => one.login === unused.login)).toMatchObject({
      expired: false,
    });
    const signedIn = await kit.signIn(unused.login, unused.firstPassword);
    expect(signedIn.status, JSON.stringify(signedIn.body)).toBe(200);
  });

  // The account of this link may not get one (no email on a staff record), which the confirm
  // checks after the link's hour: the code tells which of the two refused it.
  // Task 11.4 (plan of #298, decision 10; spec review of the plan, must-fix 3): Telegram signs in
  // real time, so a launch is judged by `REAL_CLOCK`, never the demo date 8 days on.
  it('opens the mini app from launch data signed in real time, not in demo time', async () => {
    const launch = (signedAt: Date) =>
      request(kit.server)
        .post('/api/auth/sign-in')
        .send({ telegramInitData: signedLaunch({ telegramUserId: CHAT, signedAt }) });
    const now = await launch(real.now());
    expect(now.status, JSON.stringify(now.body)).toBe(200);
    const atDemoTime = await launch(new Date(DEMO_TO));
    expect([atDemoTime.status, errorCode(atDemoTime)]).toEqual([401, 'telegram_sign_in_needed']);
  });

  it('judges a reset link by real time', async () => {
    const confirm = () =>
      kit
        .post('/api/auth/password-reset/confirm')
        .send({ token: resetToken, newPassword: 'another-new-password-41' });

    // 8 demo days on, within its real hour: not expired.
    const within = await confirm();
    expect(within.status).toBe(400);
    expect(errorCode(within)).toBe('reset_link_invalid');
    // Past its real hour: expired.
    real.advance(3_600_000);
    const after = await confirm();
    expect(after.status).toBe(400);
    expect(errorCode(after)).toBe('reset_link_expired');
  });
});
