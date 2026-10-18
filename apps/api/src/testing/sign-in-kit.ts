import type { Server } from 'node:http';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import {
  apiErrorSchema,
  isAppointment,
  secondStepRecoveryCodesSchema,
  secondStepSetUpSchema,
  type Clock,
  type Role,
} from '@sodiq/shared';
import request, { type Response, type Test } from 'supertest';
import { CLOCK } from '../clock/clock.module.js';
import { Transactions, type Transaction } from '../database/transactions.js';
import { DEVICE_COOKIE } from '../http/device-cookie.js';
import { SESSION_COOKIE } from '../http/session-cookie.js';
import { AnySignedIn } from '../modules/access/access.decorators.js';
import { Assignments } from '../modules/access/assignments.service.js';
import { Accounts, type CreatedAccount } from '../modules/auth/accounts.service.js';
import { CurrentSession } from '../modules/auth/session.guard.js';
import type { ActiveSession } from '../modules/auth/sessions.service.js';
import { totpCode, totpStep } from '../modules/auth/totp.js';
import { Notifications } from '../modules/notifications/notifications.service.js';

/** Invented for the tests. */
export const NEW_PASSWORD = 'a-new-password-73';

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

/** Stands for every route of a later task: it allows no owed step, so it needs a full session. */
@Controller('probe')
export class ProbeController {
  @Get()
  @AnySignedIn()
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

/** A role for a test account; `branchId` is left out for the two roles without a branch. */
export interface RoleOfAccount {
  role: Role;
  branchId?: string;
  /** The moment the role begins; now when left out. */
  validFrom?: Date;
  /**
   * The subjects of a Head Teacher or Senior Head Teacher appointment. Left
   * out for such a role, the kit makes a subject of its own for it (an
   * appointment has at least one, db/migrations/0028).
   */
  subjectIds?: readonly string[];
}

let kitSubjects = 0;

export interface SignInKitOptions {
  /**
   * A role that every account of `newAccount` (and so of `firstSession`,
   * `fullSession` and `completeSession`) holds from its creation. Without it
   * an account holds no role: no second step is required and the idle limit
   * is 30 minutes. With the Academic Vice Principal of a branch the stricter
   * sign-in holds: second step required, 15 minutes.
   */
  newAccountsHold?: RoleOfAccount;
}

/**
 * What the tests of sign-in need again and again, for an application made with
 * `createTestApp({ database, clock, controllers: [ProbeController] })`.
 */
/** A subject of the STEAM department for one appointment of the kit, written by the application. */
async function kitSubject(transaction: Transaction): Promise<string> {
  kitSubjects += 1;
  const name = `Kit subject ${String(kitSubjects)} ${String(process.pid)}`;
  const steam = await transaction
    .selectFrom('departments')
    .select('id')
    .where('name_en', '=', 'STEAM')
    .executeTakeFirstOrThrow();
  const inserted = await transaction
    .insertInto('subjects')
    .values({
      name_uz: name,
      name_ru: name,
      name_en: name,
      department_id: steam.id,
      grades: [7],
      colour: 'blue',
      journal_type: 'graded',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return inserted.id;
}

export function signInKit(app: INestApplication, options: SignInKitOptions = {}) {
  const server = app.getHttpServer() as Server;

  /** Gives the account a role from now on, as the server command would: nobody is named as the giver. */
  function giveRole(accountId: string, held: RoleOfAccount): Promise<{ id: string }> {
    const branchId = held.branchId ?? null;
    return app.get(Transactions).run(branchId === null ? [] : [branchId], async (transaction) => {
      const subjectIds =
        held.subjectIds ?? (isAppointment(held.role) ? [await kitSubject(transaction)] : undefined);
      return app.get(Assignments).give(transaction, {
        accountId,
        role: held.role,
        branchId,
        givenBy: null,
        ...(held.validFrom === undefined ? {} : { validFrom: held.validFrom }),
        ...(subjectIds === undefined ? {} : { subjectIds }),
      });
    });
  }

  /** Ends an assignment now; `branchId` is the branch of the assignment, if it has one. */
  function endRole(assignmentId: string, endedBy: string, branchId?: string): Promise<void> {
    return app
      .get(Transactions)
      .run(branchId === undefined ? [] : [branchId], (transaction) =>
        app
          .get(Assignments)
          .end(transaction, { assignmentId, endedBy, notifications: app.get(Notifications) }),
      );
  }

  async function newAccount(firstName: string, lastName: string): Promise<CreatedAccount> {
    const account = await app
      .get(Transactions)
      .run([], (transaction) =>
        app.get(Accounts).create(transaction, { firstName, lastName, createdBy: null }),
      );
    if (options.newAccountsHold !== undefined) {
      await giveRole(account.id, options.newAccountsHold);
    }
    return account;
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

  /** `fullSession` with a second step set up: a session that owes no step, also where the second step is required. */
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
    giveRole,
    endRole,
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
