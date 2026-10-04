import { NestFactory } from '@nestjs/core';
import { loadLocalEnvFile } from '../../database/config.js';
import { FirstAccountModule, runFirstAccountCommand } from './first-account.command.js';

// Command line of `pnpm auth:first-account`: the one-time command on the
// server that creates the first Super Admin (edge cases, "Accounts and sign-in").
// It connects as the application user, like the API.
loadLocalEnvFile();

process.exitCode = await runFirstAccountCommand(
  process.argv.slice(2),
  {
    out: (line) => {
      console.log(line);
    },
    error: (line) => {
      console.error(line);
    },
  },
  () => NestFactory.createApplicationContext(FirstAccountModule, { logger: ['error'] }),
);
