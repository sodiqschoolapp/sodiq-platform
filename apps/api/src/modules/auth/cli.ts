import { parseArgs } from 'node:util';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ClockModule } from '../../clock/clock.module.js';
import { ConfigModule } from '../../config/config.module.js';
import { loadLocalEnvFile } from '../../database/config.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from './auth.module.js';
import { AccountsExistError, FirstAccount } from './first-account.service.js';
import { LoginNameError } from './login.js';

// Command line of `pnpm auth:first-account`: the one-time command on the
// server that creates the first account (edge cases, "Accounts and sign-in").
// It connects as the application user, like the API.

@Module({ imports: [ConfigModule, ClockModule, DatabaseModule, AuditModule, AuthModule] })
class FirstAccountModule {}

const USAGE =
  'Usage: node dist/modules/auth/cli.js first-account --first-name <name> --last-name <name>';

async function firstAccount(firstName: string, lastName: string): Promise<void> {
  const app = await NestFactory.createApplicationContext(FirstAccountModule, { logger: ['error'] });
  try {
    const created = await app.get(FirstAccount).create(firstName, lastName);
    console.log(`Login: ${created.login}`);
    console.log(`First password: ${created.firstPassword}`);
    console.log(
      'The password is shown only now and is stored nowhere. It is valid for 7 days and must be changed at the first sign-in.',
    );
  } finally {
    await app.close();
  }
}

loadLocalEnvFile();

const { positionals, values } = parseArgs({
  // pnpm hands the `--` of `pnpm auth:first-account -- --first-name ...` on;
  // left in, it would turn the two options into positionals.
  args: process.argv.slice(2).filter((argument) => argument !== '--'),
  allowPositionals: true,
  strict: false,
  options: { 'first-name': { type: 'string' }, 'last-name': { type: 'string' } },
});
const firstName = values['first-name'];
const lastName = values['last-name'];

if (
  positionals[0] !== 'first-account' ||
  typeof firstName !== 'string' ||
  typeof lastName !== 'string'
) {
  console.error(USAGE);
  process.exitCode = 1;
} else {
  try {
    await firstAccount(firstName, lastName);
  } catch (error) {
    const known = error instanceof AccountsExistError || error instanceof LoginNameError;
    const reason = error instanceof Error ? error.message : String(error);
    console.error(known ? reason : `Could not create the first account: ${reason}`);
    process.exitCode = 1;
  }
}
