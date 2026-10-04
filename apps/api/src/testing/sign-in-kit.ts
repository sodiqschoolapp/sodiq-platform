import type { Server } from 'node:http';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import {
  apiErrorSchema,
  secondStepRecoveryCodesSchema,
  secondStepSetUpSchema,
  type Clock,
} from '@sodiq/shared';
import request, { type Response, type Test } from 'supertest';
import { CLOCK } from '../clock/clock.module.js';
import { Transactions } from '../database/transactions.js';
import { DEVICE_COOKIE } from '../http/device-cookie.js';
import { SESSION_COOKIE } from '../http/session-cookie.js';
import { Accounts, type CreatedAccount } from '../modules/auth/accounts.service.js';
import { SecondStepRule } from '../modules/auth/second-step-rule.js';
import { CurrentSession } from '../modules/auth/session.guard.js';
import type { ActiveSession } from '../modules/auth/sessions.service.js';
import { totpCode, totpStep } from '../modules/auth/totp.js';

/** Invented for the tests. */
export const NEW_PASSWORD = 'a-new-password-73';

/**
 * The second step is required for nobody: for the suites about passwords,
 * sessions and limits, whose accounts sign in with a password alone, and for
 * the tests of the optional second step.
 */
export class OptionalSecondStep extends SecondStepRule {
  override required(): boolean {
    return false;
  }
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** What an authenticator app does with the secret it is shown. */
export function base32Decode(text: string): Buffer {
  let bits = '';
  for (const character of text) {
    const value = BASE32.indexOf(character);
    if (value === -1) {
      throw new Error('The text is not base32.');
    }
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

/** The second step of a test account: what its authenticator app and its drawer hold. */
export interface SecondStepOfAccount {
  secret: Buffer;
  recoveryCodes: string[];
}

/** Stands for every route of a later task: it declares nothing, so it needs a full session. */
@Controller('probe')
export class ProbeController {
  @Get()
  read(@CurrentSession() session: ActiveSession): { login: string } {
    return { login: session.login };
  }
}

/** The `Set-Cookie` lines of an answer. */
export function setCookies(response: Response): string[] {
  const header = response.headers['set-cookie'] as string[] | string | undefined;
  return header === undefined ? [] : [header].flat();
}

/** What a browser would send back after this answer: `name=value`, or nothing. */
export function cookieOf(response: Response, name: string = SESSION_COOKIE): string | undefined {
  return setCookies(response)
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(';')[0];
}

export const errorCode = (response: Response): string =>
  apiErrorSchema.parse(response.body).error.code;

/** A signed-in browser: its account and the two cookies it holds. */
export interface SignedInBrowser {
  account: CreatedAccount;
  /** The session cookie, `name=value`. */
  cookie: string;
  /** The device cookie, `name=value`. */
  device: string;
}

/**
 * What the tests of sign-in need again and again, for an application made with
 * `createTestApp({ database, clock, controllers: [ProbeController] })`.
 */
export function signInKit(app: INestApplication) {
  const server = app.getHttpServer() as Server;

  function newAccount(firstName: string, lastName: string): Promise<CreatedAccount> {
    return app
      .get(Transactions)
      .run([], (transaction) =>
        app.get(Accounts).create(transaction, { firstName, lastName, createdBy: null }),
      );
  }

  /**
   * `cookies` is what the browser sends along, for example its device cookie;
   * `trustDevice` is the "Trust this device" switch, left out of the body when off.
   */
  function signIn(login: string, password: string, cookies?: string, trustDevice = false): Test {
    const call = request(server).post('/api/auth/sign-in');
    return (cookies === undefined ? call : call.set('Cookie', cookies)).send(
      trustDevice ? { login, password, trustDevice } : { login, password },
    );
  }

  function changePassword(cookies: string, currentPassword: string, newPassword: string): Test {
    return request(server)
      .post('/api/auth/password')
      .set('Cookie', cookies)
      .send({ currentPassword, newPassword });
  }

  /** A browser signed in to a new account that still has its first password. */
  async function firstSession(firstName: string, lastName: string): Promise<SignedInBrowser> {
    const account = await newAccount(firstName, lastName);
    const response = await signIn(account.login, account.firstPassword);
    const cookie = cookieOf(response);
    const device = cookieOf(response, DEVICE_COOKIE);
    if (response.status !== 200 || cookie === undefined || device === undefined) {
      throw new Error(`The sign-in of the test account failed with ${String(response.status)}.`);
    }
    return { account, cookie, device };
  }

  /** The same, after the forced password change: the password is `NEW_PASSWORD`. */
  async function fullSession(firstName: string, lastName: string): Promise<SignedInBrowser> {
    const browser = await firstSession(firstName, lastName);
    const changed = await changePassword(
      `${browser.cookie}; ${browser.device}`,
      browser.account.firstPassword,
      NEW_PASSWORD,
    );
    if (changed.status !== 204) {
      throw new Error(
        `The password change of the test account failed with ${String(changed.status)}.`,
      );
    }
    return browser;
  }

  /** The code the authenticator app shows now, or so many 30-second steps from now. */
  function codeOf(secret: Buffer, stepsFromNow = 0): string {
    return totpCode(secret, totpStep(app.get<Clock>(CLOCK).now()) + stepsFromNow);
  }

  /** The second step of a sign-in. */
  function passSecondStep(cookies: string, code: string): Test {
    return request(server).post('/api/auth/second-step').set('Cookie', cookies).send({ code });
  }

  /** Sets up and confirms a second step for the account of a session whose password is changed. */
  async function setUpSecondStep(cookies: string): Promise<SecondStepOfAccount> {
    const started = await request(server)
      .post('/api/auth/second-step/set-up')
      .set('Cookie', cookies);
    if (started.status !== 200) {
      throw new Error(`The set-up of the second step failed with ${String(started.status)}.`);
    }
    const secret = base32Decode(secondStepSetUpSchema.parse(started.body).secret);
    const confirmed = await request(server)
      .post('/api/auth/second-step/confirm')
      .set('Cookie', cookies)
      .send({ code: codeOf(secret) });
    if (confirmed.status !== 200) {
      throw new Error(`The second step was not confirmed: ${String(confirmed.status)}.`);
    }
    return {
      secret,
      recoveryCodes: secondStepRecoveryCodesSchema.parse(confirmed.body).recoveryCodes,
    };
  }

  /** `fullSession` with a second step set up: a session that may use every route under the strict rule. */
  async function completeSession(
    firstName: string,
    lastName: string,
  ): Promise<SignedInBrowser & SecondStepOfAccount> {
    const browser = await fullSession(firstName, lastName);
    return { ...browser, ...(await setUpSecondStep(browser.cookie)) };
  }

  const get = (path: string, cookies?: string): Test => {
    const call = request(server).get(path);
    return cookies === undefined ? call : call.set('Cookie', cookies);
  };

  const post = (path: string, cookies?: string): Test => {
    const call = request(server).post(path);
    return cookies === undefined ? call : call.set('Cookie', cookies);
  };

  return {
    server,
    newAccount,
    signIn,
    changePassword,
    firstSession,
    fullSession,
    codeOf,
    passSecondStep,
    setUpSecondStep,
    completeSession,
    get,
    post,
    probe: (cookies?: string) => get('/api/probe', cookies),
  };
}

export type SignInKit = ReturnType<typeof signInKit>;
