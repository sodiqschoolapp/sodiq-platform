import { parseArgs } from 'node:util';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { ClockModule } from '../../clock/clock.module.js';
import { ConfigModule } from '../../config/config.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from './auth.module.js';
import { AccountsExistError, FirstAccount } from './first-account.service.js';
import { LoginNameError } from './login.js';

/** What the command needs of the application: no HTTP, no job queue. */
@Module({ imports: [ConfigModule, ClockModule, DatabaseModule, AuditModule, AuthModule] })
export class FirstAccountModule {}

export const FIRST_ACCOUNT_USAGE =
  'Usage: pnpm auth:first-account -- --first-name <name> --last-name <name>';

/** Where the command writes: the terminal of the person who runs it, and nowhere else. */
export interface CommandOutput {
  out: (line: string) => void;
  error: (line: string) => void;
}

export interface FirstAccountArguments {
  firstName: string;
  lastName: string;
}

/**
 * The two names from the command line, or nothing when the line is not
 * `first-account --first-name <name> --last-name <name>`. pnpm hands the `--`
 * of `pnpm auth:first-account -- --first-name ...` on to the command; left in,
 * it would turn the two options into positionals.
 */
export function parseFirstAccountArguments(
  argv: readonly string[],
): FirstAccountArguments | undefined {
  try {
    const { positionals, values } = parseArgs({
      args: argv.filter((argument) => argument !== '--'),
      allowPositionals: true,
      strict: true,
      options: { 'first-name': { type: 'string' }, 'last-name': { type: 'string' } },
    });
    const firstName = values['first-name'];
    const lastName = values['last-name'];
    if (
      positionals.length !== 1 ||
      positionals[0] !== 'first-account' ||
      firstName === undefined ||
      lastName === undefined
    ) {
      return undefined;
    }
    return { firstName, lastName };
  } catch {
    // An unknown option, or an option without its value.
    return undefined;
  }
}

/**
 * The one-time command on the server that creates the first account (edge
 * cases, "Accounts and sign-in"). Returns the exit code. The login and the
 * first password go to `output.out` once and to no log; the names that were
 * typed are never repeated.
 */
export async function runFirstAccountCommand(
  argv: readonly string[],
  output: CommandOutput,
  open: () => Promise<INestApplicationContext>,
): Promise<number> {
  const names = parseFirstAccountArguments(argv);
  if (names === undefined) {
    output.error(FIRST_ACCOUNT_USAGE);
    return 1;
  }
  try {
    const app = await open();
    try {
      const created = await app.get(FirstAccount).create(names.firstName, names.lastName);
      output.out(`Login: ${created.login}`);
      output.out(`First password: ${created.firstPassword}`);
      output.out(
        'The password is shown only now and is stored nowhere. It is valid for 7 days and must be changed at the first sign-in.',
      );
      return 0;
    } finally {
      await app.close();
    }
  } catch (error) {
    const known = error instanceof AccountsExistError || error instanceof LoginNameError;
    const reason = error instanceof Error ? error.message : String(error);
    output.error(known ? reason : `Could not create the first account: ${reason}`);
    return 1;
  }
}
