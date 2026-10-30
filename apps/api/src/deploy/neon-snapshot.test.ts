import { describe, expect, it } from 'vitest';
import {
  createSnapshot,
  DELETE_TRIES,
  deleteSnapshot,
  NEON_API,
  NeonError,
  snapshotAddress,
  snapshotName,
  type Fetch,
} from './neon-snapshot.js';

const API_KEY = 'napi_invented_key_0000';
const PROJECT = 'invented-project-123';

interface Call {
  method: string;
  path: string;
  body: unknown;
  authorization: string | undefined;
}

/** Neon's API as the tests script it: an answer per "METHOD path", or a list answered in turn. */
function fakeNeon(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  const turns: Record<string, number> = {};
  const fetcher: Fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(`${NEON_API}/projects/${PROJECT}`, '');
    const method = init?.method ?? 'GET';
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({
      method,
      path,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      authorization: headers?.Authorization,
    });
    const key = `${method} ${path}`;
    const scripted = answers[key];
    const answer = Array.isArray(scripted)
      ? (scripted as unknown[])[
          Math.min((turns[key] = (turns[key] ?? -1) + 1), scripted.length - 1)
        ]
      : scripted;
    if (answer === undefined) return Promise.resolve(new Response('{}', { status: 404 }));
    const { status = 200, ...body } = answer as { status?: number };
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { calls, fetcher };
}

const options = (fetcher: Fetch, log: string[] = []) => ({
  apiKey: API_KEY,
  projectId: PROJECT,
  fetch: fetcher,
  sleep: () => Promise.resolve(),
  log: (line: string) => log.push(line),
});

const CREATED = {
  branch: { id: 'br-new', name: 'nightly-backup-2026-10-30-41' },
  endpoints: [{ id: 'ep-new', type: 'read_only', host: 'ep-new.c-8.eu-central-1.aws.neon.tech' }],
  operations: [{ id: 'op-1' }, { id: 'op-2' }],
};

describe('the snapshot of the daily export', () => {
  it('makes a branch of the default branch with one read-only compute and waits for it', async () => {
    const neon = fakeNeon({
      'GET /branches': { branches: [{ id: 'br-prod', name: 'production', default: true }] },
      'POST /branches': CREATED,
      'GET /operations/op-1': [
        { operation: { status: 'running' } },
        { operation: { status: 'finished' } },
      ],
      'GET /operations/op-2': { operation: { status: 'finished' } },
    });
    const snapshot = await createSnapshot(options(neon.fetcher), 'nightly-backup-2026-10-30-41');
    expect(snapshot).toEqual({ branchId: 'br-new', host: 'ep-new.c-8.eu-central-1.aws.neon.tech' });
    const create = neon.calls.find((call) => call.method === 'POST');
    // No parent named: Neon branches from the default branch, production.
    expect(create?.body).toEqual({
      branch: { name: 'nightly-backup-2026-10-30-41' },
      endpoints: [{ type: 'read_only' }],
    });
    expect(neon.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /branches',
      'POST /branches',
      'GET /operations/op-1',
      'GET /operations/op-1',
      'GET /operations/op-2',
    ]);
    expect(neon.calls.every((call) => call.authorization === `Bearer ${API_KEY}`)).toBe(true);
  });

  it('deletes only the branches a broken run left behind, never production or another branch', async () => {
    const neon = fakeNeon({
      'GET /branches': {
        branches: [
          { id: 'br-prod', name: 'production', default: true },
          { id: 'br-dev', name: 'dev-nightly-backup-1' },
          { id: 'br-left', name: 'nightly-backup-2026-10-29-40' },
        ],
      },
      'DELETE /branches/br-left': { operations: [{ id: 'op-del' }] },
      'GET /operations/op-del': { operation: { status: 'finished' } },
      'POST /branches': { ...CREATED, operations: [] },
    });
    await createSnapshot(options(neon.fetcher), 'nightly-backup-2026-10-30-41');
    expect(neon.calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual([
      '/branches/br-left',
    ]);
  });

  it('refuses an answer without a read-only compute, and a name outside the prefix', async () => {
    const readWrite = fakeNeon({
      'GET /branches': { branches: [] },
      'POST /branches': {
        ...CREATED,
        endpoints: [{ id: 'ep-rw', type: 'read_write', host: 'ep-rw.neon.tech' }],
      },
    });
    await expect(
      createSnapshot(options(readWrite.fetcher), 'nightly-backup-2026-10-30-41'),
    ).rejects.toThrow("Neon's answer to the new branch names no read-only compute.");
    await expect(createSnapshot(options(readWrite.fetcher), 'production')).rejects.toThrow(
      NeonError,
    );
  });

  it("stops with Neon's status and message, and on a failed operation", async () => {
    const refused = fakeNeon({
      'GET /branches': { branches: [] },
      'POST /branches': { status: 422, message: 'branches limit exceeded' },
    });
    await expect(
      createSnapshot(options(refused.fetcher), 'nightly-backup-2026-10-30-41'),
    ).rejects.toThrow('Neon answered 422 to POST /branches: branches limit exceeded');
    const failed = fakeNeon({
      'GET /branches': { branches: [] },
      'POST /branches': CREATED,
      'GET /operations/op-1': { operation: { status: 'failed' } },
    });
    await expect(
      createSnapshot(options(failed.fetcher), 'nightly-backup-2026-10-30-41'),
    ).rejects.toThrow("Neon's operation op-1 ended as failed.");
  });

  it('deletes the branch, tries again while the project is busy, and takes a missing one as done', async () => {
    const busy = fakeNeon({
      'DELETE /branches/br-new': [
        { status: 423, message: 'project already has running operations' },
        { status: 423, message: 'project already has running operations' },
        { operations: [] },
      ],
    });
    await deleteSnapshot(options(busy.fetcher), 'br-new');
    expect(busy.calls).toHaveLength(3);
    const gone = fakeNeon({});
    await deleteSnapshot(options(gone.fetcher), 'br-new');
    expect(gone.calls).toHaveLength(1);
    const stuck = fakeNeon({
      'DELETE /branches/br-new': { status: 423, message: 'project already has running operations' },
    });
    await expect(deleteSnapshot(options(stuck.fetcher), 'br-new')).rejects.toThrow(
      'Neon answered 423 to DELETE /branches/br-new',
    );
    expect(stuck.calls).toHaveLength(DELETE_TRIES);
  });

  it("puts the snapshot's host into the stored address and keeps everything else", () => {
    expect(
      snapshotAddress(
        'postgresql://sodiq_backup:npg_Invented0@ep-old.c-8.eu-central-1.aws.neon.tech/sodiq?sslmode=verify-full&sslrootcert=system&channel_binding=require',
        'ep-new.c-8.eu-central-1.aws.neon.tech',
      ),
    ).toBe(
      'postgresql://sodiq_backup:npg_Invented0@ep-new.c-8.eu-central-1.aws.neon.tech/sodiq?sslmode=verify-full&sslrootcert=system&channel_binding=require',
    );
    expect(() => snapshotAddress('not an address', 'ep-new.neon.tech')).toThrow(NeonError);
    expect(() => snapshotAddress('https://ep-old.neon.tech/sodiq', 'ep-new.neon.tech')).toThrow(
      'not a postgres:// address',
    );
  });

  it('names each run a branch of its own under the prefix', () => {
    expect(snapshotName(new Date('2026-10-30T21:30:05Z'), '41007198264')).toBe(
      'nightly-backup-2026-10-30-41007198264',
    );
  });
});
