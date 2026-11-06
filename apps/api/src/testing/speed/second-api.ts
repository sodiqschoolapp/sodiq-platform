import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

/**
 * Task 10.1c, decision B: the second API process of the speed run's load (`server.ts` beside this
 * file), built with `tsconfig.speed.json` and started on the run's database with its clock: the
 * moment the test's clock shows and the real moment it started running from (plan decision 10).
 */
const API = resolve(import.meta.dirname, '../../..');

/** Builds the entry once per process of the test. */
let built: Promise<void> | null = null;

function build(): Promise<void> {
  built ??= promisify(execFile)(
    resolve(API, 'node_modules/.bin/tsc'),
    ['-p', 'tsconfig.speed.json'],
    { cwd: API },
  ).then(() => undefined);
  return built;
}

export interface SecondApi {
  readonly url: string;
  stop(): Promise<void>;
}

export async function startSecondApi(input: {
  readonly database: string;
  readonly moment: Date;
  readonly realStart: number;
}): Promise<SecondApi> {
  await build();
  const child: ChildProcess = spawn(
    process.execPath,
    [resolve(API, 'dist-speed/testing/speed/server.js')],
    {
      cwd: API,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: {
        ...process.env,
        SPEED_SECOND_DATABASE: input.database,
        SPEED_SECOND_CLOCK: input.moment.toISOString(),
        SPEED_SECOND_REAL_START: String(input.realStart),
      },
    },
  );
  const stopped = new Promise<void>((done) => child.once('exit', () => done()));
  const stdout = child.stdout;
  if (stdout === null) throw new Error('The second API process has no output.');
  const port = await new Promise<number>((done, fail) => {
    const lines = createInterface({ input: stdout });
    lines.once('line', (line) => {
      lines.close();
      done((JSON.parse(line) as { port: number }).port);
    });
    child.once('exit', (code) =>
      fail(new Error(`The second API process ended with ${String(code)}.`)),
    );
  });
  return {
    url: `http://127.0.0.1:${String(port)}`,
    async stop() {
      child.kill('SIGTERM');
      await stopped;
    },
  };
}
