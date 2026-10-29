import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../app.module.js';
import { initApp } from '../app.setup.js';
import { loadLocalEnvFile } from '../database/config.js';
import { runMonitoringBranchCommand } from './monitoring-branch.command.js';

// Command line of the owner's one-time command on the server that builds the hidden Monitoring
// branch (task 10.2b; docs/monitoring.md, step 9). It runs the whole application in this process,
// as the API does, and calls its routes over the local loopback.
loadLocalEnvFile();

/** A question at the terminal; a hidden answer is not echoed. */
async function ask(question: string, hidden: boolean): Promise<string> {
  let muted = false;
  // What readline echoes while the person types a hidden answer is dropped.
  const output = new Writable({
    write(chunk: Buffer | string, _encoding, done) {
      if (!muted) stdout.write(chunk);
      done();
    },
  });
  const lines = createInterface({ input: stdin, output, terminal: true });
  try {
    const answer = lines.question(question);
    muted = hidden;
    return await answer;
  } finally {
    muted = false;
    if (hidden) stdout.write('\n');
    lines.close();
  }
}

process.exitCode = await runMonitoringBranchCommand(
  process.argv.slice(2),
  {
    out: (line) => {
      console.log(line);
    },
    error: (line) => {
      console.error(line);
    },
    ask,
  },
  async () => {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error'] });
    await initApp(app);
    return app;
  },
);
