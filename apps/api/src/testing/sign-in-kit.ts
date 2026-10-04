import type { Server } from 'node:http';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { apiErrorSchema } from '@sodiq/shared';
import request, { type Response, type Test } from 'supertest';
import { Transactions } from '../database/transactions.js';
import { DEVICE_COOKIE } from '../http/device-cookie.js';
import { SESSION_COOKIE } from '../http/session-cookie.js';
import { Accounts, type CreatedAccount } from '../modules/auth/accounts.service.js';
import { CurrentSession } from '../modules/auth/session.guard.js';
import type { ActiveSession } from '../modules/auth/sessions.service.js';

/** Invented for the tests. */
export const NEW_PASSWORD = 'a-new-password-73';

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

  /** `cookies` is what the browser sends along, for example its device cookie. */
  function signIn(login: string, password: string, cookies?: string): Test {
    const call = request(server).post('/api/auth/sign-in');
    return (cookies === undefined ? call : call.set('Cookie', cookies)).send({ login, password });
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
    get,
    post,
    probe: (cookies?: string) => get('/api/probe', cookies),
  };
}

export type SignInKit = ReturnType<typeof signInKit>;
