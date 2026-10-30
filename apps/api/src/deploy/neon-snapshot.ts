/**
 * The snapshot the daily export reads (`.github/workflows/backup.yml`, task 10.2b). Neon's read
 * replica of production follows the live primary, and the worker writes every minute (the
 * prepared totals): a dump of more than about 30 seconds was ended there with "terminating
 * connection due to conflict with recovery" (the first runs of 30 October 2026). So each run
 * makes a branch of production at that moment with a read-only compute only: nothing writes to
 * that branch, so nothing ends the dump, and `pg_is_in_recovery()` stays true for the guard of
 * `backup-compare.ts`. The run deletes the branch at its end; a branch a broken run left behind
 * is deleted by the next run before it makes its own.
 *
 * The key is read from the environment and never printed; a log line holds branch names, ids
 * and operation statuses only. Nothing here connects to a database.
 */

export const NEON_API = 'https://console.neon.tech/api/v2';

/** Every branch of the export starts with this; no other branch is ever deleted. */
export const SNAPSHOT_PREFIX = 'nightly-backup-';

/** How often an operation is looked at, and how many looks before giving up (5 minutes). */
export const POLL_MS = 3_000;
export const MAX_POLLS = 100;

/** A delete refused while another operation of the project runs (423) is tried again. */
export const DELETE_TRIES = 20;

export type Fetch = typeof fetch;
export type Sleep = (ms: number) => Promise<void>;

export class NeonError extends Error {}

export interface NeonOptions {
  apiKey: string;
  projectId: string;
  fetch?: Fetch;
  sleep?: Sleep;
  log?: (line: string) => void;
}

export interface Snapshot {
  branchId: string;
  host: string;
}

const DONE = new Set(['finished', 'skipped']);
const FAILED = new Set(['failed', 'error', 'cancelling', 'cancelled']);

/** The branch name of a run: the day and the run, so two runs never share one. */
export function snapshotName(now: Date, runId: string): string {
  return `${SNAPSHOT_PREFIX}${now.toISOString().slice(0, 10)}-${runId}`;
}

/**
 * Deletes the export's branches left behind, then makes a branch of the default branch
 * (production) at this moment with one read-only compute, and waits until Neon has made both.
 */
export async function createSnapshot(options: NeonOptions, name: string): Promise<Snapshot> {
  if (!name.startsWith(SNAPSHOT_PREFIX)) {
    throw new NeonError(`A snapshot's name starts with ${SNAPSHOT_PREFIX}.`);
  }
  const listed = await call(options, 'GET', `/projects/${options.projectId}/branches`);
  for (const branch of branchesOf(listed)) {
    if (branch.name.startsWith(SNAPSHOT_PREFIX) && !branch.default) {
      options.log?.(`Deleting the snapshot ${branch.name} a broken run left behind.`);
      await deleteSnapshot(options, branch.id);
    }
  }
  const created = await call(
    options,
    'POST',
    `/projects/${options.projectId}/branches`,
    JSON.stringify({ branch: { name }, endpoints: [{ type: 'read_only' }] }),
  );
  const branchId = field(field(created, 'branch'), 'id');
  const endpoints = field(created, 'endpoints');
  const endpoint = Array.isArray(endpoints) ? (endpoints as unknown[])[0] : undefined;
  if (typeof branchId !== 'string' || endpoint === undefined) {
    throw new NeonError("Neon's answer to the new branch names no branch or compute.");
  }
  const host = field(endpoint, 'host');
  if (typeof host !== 'string' || host === '' || field(endpoint, 'type') !== 'read_only') {
    throw new NeonError("Neon's answer to the new branch names no read-only compute.");
  }
  options.log?.(`Snapshot ${name} (${branchId}) made, with a read-only compute.`);
  await waitForOperations(options, created);
  return { branchId, host };
}

/** Deletes one of the export's branches; one that is already gone is no failure. */
export async function deleteSnapshot(options: NeonOptions, branchId: string): Promise<void> {
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt += 1) {
    const response = await send(
      options,
      'DELETE',
      `/projects/${options.projectId}/branches/${branchId}`,
    );
    if (response.status === 404) {
      options.log?.(`Snapshot ${branchId} is already deleted.`);
      return;
    }
    if (response.status === 423 && attempt < DELETE_TRIES) {
      await sleep(POLL_MS);
      continue;
    }
    await waitForOperations(options, await read(response, 'DELETE', `/branches/${branchId}`));
    options.log?.(`Snapshot ${branchId} deleted.`);
    return;
  }
}

/** The address of the export's role on the snapshot: the stored address with its host swapped. */
export function snapshotAddress(stored: string, host: string): string {
  let url: URL;
  try {
    url = new URL(stored);
  } catch {
    throw new NeonError('BACKUP_DATABASE_URL is not an address.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new NeonError('BACKUP_DATABASE_URL is not a postgres:// address.');
  }
  url.hostname = host;
  if (url.hostname !== host) {
    throw new NeonError("The snapshot's host could not be put into the address.");
  }
  return url.href;
}

async function waitForOperations(options: NeonOptions, answer: unknown): Promise<void> {
  const sleep = options.sleep ?? defaultSleep;
  const operations = field(answer, 'operations');
  const ids = Array.isArray(operations)
    ? (operations as unknown[])
        .map((operation) => field(operation, 'id'))
        .filter((id): id is string => typeof id === 'string')
    : [];
  for (const id of ids) {
    for (let poll = 0; ; poll += 1) {
      const looked = await call(options, 'GET', `/projects/${options.projectId}/operations/${id}`);
      const status = field(field(looked, 'operation'), 'status');
      if (typeof status === 'string' && DONE.has(status)) break;
      if (typeof status === 'string' && FAILED.has(status)) {
        throw new NeonError(`Neon's operation ${id} ended as ${status}.`);
      }
      if (poll >= MAX_POLLS) {
        throw new NeonError(`Neon's operation ${id} did not finish in 5 minutes.`);
      }
      await sleep(POLL_MS);
    }
  }
}

async function call(
  options: NeonOptions,
  method: 'GET' | 'POST',
  path: string,
  body?: string,
): Promise<unknown> {
  return read(await send(options, method, path, body), method, path);
}

async function send(
  options: NeonOptions,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: string,
): Promise<Response> {
  const fetcher = options.fetch ?? fetch;
  return fetcher(`${NEON_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body }),
  });
}

/** The parsed answer, or a stop with Neon's status and its own message (never the request). */
async function read(response: Response, method: string, path: string): Promise<unknown> {
  const parsed: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = field(parsed, 'message');
    throw new NeonError(
      `Neon answered ${String(response.status)} to ${method} ${path.replace(/^\/projects\/[^/]+/, '')}${
        typeof message === 'string' ? `: ${message}` : '.'
      }`,
    );
  }
  return parsed;
}

function branchesOf(answer: unknown): { id: string; name: string; default: boolean }[] {
  const branches = field(answer, 'branches');
  if (!Array.isArray(branches)) {
    throw new NeonError("Neon's list of branches is not a list.");
  }
  return (branches as unknown[]).flatMap((branch) => {
    const id = field(branch, 'id');
    const name = field(branch, 'name');
    return typeof id === 'string' && typeof name === 'string'
      ? [{ id, name, default: field(branch, 'default') === true }]
      : [];
  });
}

function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[name]
    : undefined;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
