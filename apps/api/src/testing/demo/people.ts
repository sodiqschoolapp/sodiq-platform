import type { INestApplication } from '@nestjs/common';
import { type GivableRole } from '@sodiq/shared';
import { Transactions } from '../../database/transactions.js';
import { DEVICE_COOKIE } from '../../http/device-cookie.js';
import { Assignments } from '../../modules/access/assignments.service.js';
import { Accounts } from '../../modules/auth/accounts.service.js';
import { cookieOf, signInKit, type SignInKit } from '../sign-in-kit.js';
import { Caller } from './caller.js';
import type { FixedClock } from '../fixed-clock.js';

/** A demo account as the seed holds it: its login, its second step if it has one, and its session. */
export interface DemoAccount {
  readonly accountId: string;
  readonly login: string;
  readonly name: string;
  /** The secret of the authenticator app, for a role with the strict sign-in; reset at the end. */
  secret: Buffer | null;
  device: string;
  caller: Caller;
}

/**
 * Signs the demo's people in through the real routes. Every demo account ends
 * with the one demo password, changed from its first password as a person
 * would at the first sign-in.
 */
export class SignIns {
  readonly kit: SignInKit;

  constructor(
    private readonly app: INestApplication,
    private readonly clock: FixedClock,
    private readonly password: string,
  ) {
    this.kit = signInKit(app);
  }

  /**
   * The Super Admin of the demo, made as the server command makes the first
   * one: an account and the role, nobody named as the giver.
   */
  async superAdmin(firstName: string, lastName: string): Promise<DemoAccount> {
    const transactions = this.app.get(Transactions);
    const account = await transactions.run([], (transaction) =>
      this.app.get(Accounts).create(transaction, { firstName, lastName, createdBy: null }),
    );
    await transactions.run([], (transaction) =>
      this.app.get(Assignments).give(transaction, {
        accountId: account.id,
        role: 'super_admin',
        branchId: null,
        givenBy: null,
      }),
    );
    return this.first(
      account.id,
      account.login,
      account.firstPassword,
      `${firstName} ${lastName}`,
      true,
    );
  }

  /** The first sign-in with the first password: the password changed, the second step set up when asked. */
  async first(
    accountId: string,
    login: string,
    firstPassword: string,
    name: string,
    strict: boolean,
  ): Promise<DemoAccount> {
    const signed = await this.kit.signIn(login, firstPassword);
    const cookie = cookieOf(signed);
    const device = cookieOf(signed, DEVICE_COOKIE);
    if (signed.status !== 200 || cookie === undefined || device === undefined) {
      throw new Error(`The first sign-in of ${login} answered ${String(signed.status)}.`);
    }
    const changed = await this.kit.changePassword(
      `${cookie}; ${device}`,
      firstPassword,
      this.password,
    );
    if (changed.status !== 204) {
      throw new Error(
        `The password change of ${login} answered ${String(changed.status)}: ${JSON.stringify(changed.body)}`,
      );
    }
    const secret = strict ? (await this.kit.setUpSecondStep(`${cookie}; ${device}`)).secret : null;
    return {
      accountId,
      login,
      name,
      secret,
      device,
      caller: new Caller(this.kit.server, name, { cookies: `${cookie}; ${device}` }),
    };
  }

  /**
   * A new session of the account, as each morning: the demo password on the
   * same browser, and the code of the second step where it is set up. The
   * clock moves 31 seconds first, so a code is never used twice.
   */
  async again(account: DemoAccount): Promise<void> {
    if (account.secret !== null) this.clock.advance(31_000);
    const signed = await this.kit.signIn(account.login, this.password, account.device);
    const cookie = cookieOf(signed);
    if (signed.status !== 200 || cookie === undefined) {
      throw new Error(`The sign-in of ${account.login} answered ${String(signed.status)}.`);
    }
    const cookies = `${cookie}; ${account.device}`;
    if (account.secret !== null) {
      const passed = await this.kit.passSecondStep(cookies, this.kit.codeOf(account.secret));
      if (passed.status !== 200) {
        throw new Error(
          `The second step of ${account.login} answered ${String(passed.status)}: ${JSON.stringify(passed.body)}`,
        );
      }
    }
    account.caller.signedInAgain(cookies);
  }
}

/** A role as the account section gives it. */
export interface RoleToGive {
  readonly role: GivableRole;
  readonly branchId: string | null;
  readonly subjectIds?: readonly string[];
}
