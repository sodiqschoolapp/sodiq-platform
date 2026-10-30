import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { BRANCH_HEADER, REQUEST_KEY_HEADER } from '@sodiq/shared';
import type { Database } from '../database/database.js';
import { SESSION_COOKIE } from '../http/session-cookie.js';

/**
 * The load run of task 10.1 (`12`, Load: "1,000 people working at once, with
 * the same response times"): the test process opens the app of the kit (its
 * injected clock, the only clock: review finding 3 of the plan) on an HTTP
 * port, and a child process (`load-runner.ts`) runs the virtual users with
 * Node's own `fetch`. Each user has its own session, written here over the
 * school's accounts (plan decision 6: not 1,000 Argon2id sign-ins).
 */

export interface LoadAction {
  readonly name: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body?: unknown;
}

/** An account of the school and the actions of its role. */
export interface LoadPerson {
  readonly role: string;
  readonly accountId: string;
  readonly branchId: string;
  readonly actions: readonly LoadAction[];
}

export interface LoadPlan {
  readonly users: number;
  readonly durationMs: number;
  readonly gapMs: readonly [number, number];
}

/** Times of each action, in milliseconds, with the answers by status. */
export type LoadTimes = Record<
  string,
  {
    readonly runs: number[];
    readonly failures: number;
    readonly statuses: Record<string, number>;
    /** Task 10.1b: answers whose prepared totals were behind ("updating"). */
    readonly updating: number;
  }
>;

/** The 95th percentile of the runs (nearest rank). */
export function percentile95(runs: readonly number[]): number {
  const sorted = [...runs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

/**
 * A session for each virtual user, the people taken in turn, written as the
 * sign-in writes one (`sessions.service.ts`: the SHA-256 of a random token),
 * with its second step passed, at the clock's moment.
 */
export async function writeSessions(
  migrator: Database,
  people: readonly LoadPerson[],
  users: number,
  now: Date,
): Promise<{ person: LoadPerson; cookie: string }[]> {
  const sessions = Array.from({ length: users }, (_, index) => {
    const person = people[index % people.length];
    if (person === undefined) throw new Error('No person for the load run.');
    const token = randomBytes(32).toString('base64url');
    return { person, token };
  });
  for (let start = 0; start < sessions.length; start += 500) {
    await migrator
      .insertInto('sessions')
      .values(
        sessions.slice(start, start + 500).map(({ person, token }) => ({
          account_id: person.accountId,
          token_hash: createHash('sha256').update(token).digest('hex'),
          created_at: now,
          last_used_at: now,
          second_step_passed_at: now,
          trust_requested: false,
        })),
      )
      .execute();
  }
  return sessions.map(({ person, token }) => ({ person, cookie: `${SESSION_COOKIE}=${token}` }));
}

/** Opens the server on a free local port, if it is not listening yet, and answers its address. */
async function listening(server: Server): Promise<string> {
  if (!server.listening) {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  }
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(address.port)}`;
}

/** Runs the virtual users against the server and answers the times of each action. */
export async function runLoad(
  server: Server,
  users: readonly { person: LoadPerson; cookie: string }[],
  plan: LoadPlan,
): Promise<LoadTimes> {
  const baseUrl = await listening(server);
  const child = spawn(process.execPath, [resolve(import.meta.dirname, 'load-runner.ts')], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const output: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
  const finished = new Promise<number | null>((done, fail) => {
    child.on('error', fail);
    child.on('close', done);
  });
  child.stdin.end(
    JSON.stringify({
      baseUrl,
      durationMs: plan.durationMs,
      gapMs: plan.gapMs,
      branchHeader: BRANCH_HEADER,
      keyHeader: REQUEST_KEY_HEADER,
      users: users.map(({ person, cookie }) => ({
        cookie,
        branchId: person.branchId,
        actions: person.actions,
      })),
    }),
  );
  const code = await finished;
  if (code !== 0) throw new Error(`The load runner ended with ${String(code)}.`);
  return JSON.parse(Buffer.concat(output).toString('utf8')) as LoadTimes;
}
