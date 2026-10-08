import { describe, expect, it } from 'vitest';
import {
  deployServices,
  DeployError,
  MAX_POLLS,
  POLL_MS,
  RENDER_API,
  type Fetch,
} from './render.js';

const API_KEY = 'rnd_invented_key_0000';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

interface Call {
  method: string;
  path: string;
  body: unknown;
  authorization: string | undefined;
}

/**
 * Render's API as the tests script it: a deploy is created with the first
 * status of its service, and each look answers the next status.
 */
function fakeRender(statuses: Record<string, string[]>, answers: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const looks: Record<string, number> = {};
  const fetcher: Fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(RENDER_API, '');
    const method = init?.method ?? 'GET';
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({
      method,
      path,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      authorization: headers?.Authorization,
    });
    const answer = answers[`${method} ${path}`];
    if (answer !== undefined) {
      return Promise.resolve(toResponse(answer));
    }
    const created = /^\/services\/([^/]+)\/deploys$/.exec(path);
    if (method === 'POST' && created?.[1] !== undefined) {
      const service = created[1];
      looks[service] = 0;
      return Promise.resolve(toResponse({ id: `dep-${service}`, status: statuses[service]?.[0] }));
    }
    const looked = /^\/services\/([^/]+)\/deploys\/dep-\1$/.exec(path);
    if (method === 'GET' && looked?.[1] !== undefined) {
      const service = looked[1];
      const list = statuses[service] ?? [];
      looks[service] = Math.min((looks[service] ?? 0) + 1, list.length - 1);
      return Promise.resolve(toResponse({ id: `dep-${service}`, status: list[looks[service]] }));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  };
  return { calls, fetcher };
}

function toResponse(answer: unknown): Response {
  if (answer instanceof Response) {
    return answer;
  }
  return new Response(JSON.stringify(answer), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

const sleeps: number[] = [];
const sleep = (ms: number): Promise<void> => {
  sleeps.push(ms);
  return Promise.resolve();
};

// docs/build-plan.md, task 0.10: deploy from main by GitHub Actions, after the
// migrations; done when a merged pull request reaches the test environment.
describe('a deploy on Render', () => {
  it('starts one deploy per service at the commit and waits until every one is live', async () => {
    const render = fakeRender({
      api: ['created', 'build_in_progress', 'update_in_progress', 'live'],
      worker: ['queued', 'live'],
    });
    sleeps.splice(0);
    const lines: string[] = [];

    const results = await deployServices({
      apiKey: API_KEY,
      serviceIds: ['api', 'worker'],
      commitId: COMMIT,
      fetch: render.fetcher,
      sleep,
      log: (line) => lines.push(line),
    });

    expect(results).toEqual([
      { serviceId: 'api', deployId: 'dep-api', status: 'live' },
      { serviceId: 'worker', deployId: 'dep-worker', status: 'live' },
    ]);
    const starts = render.calls.filter((call) => call.method === 'POST');
    expect(starts.map((call) => call.path)).toEqual([
      '/services/api/deploys',
      '/services/worker/deploys',
    ]);
    for (const start of starts) {
      expect(start.body).toEqual({ clearCache: 'do_not_clear', commitId: COMMIT });
      expect(start.authorization).toBe(`Bearer ${API_KEY}`);
    }
    // Three looks for the API (three statuses after the first), one for the worker.
    expect(render.calls.filter((call) => call.method === 'GET')).toHaveLength(4);
    expect(sleeps.every((ms) => ms === POLL_MS)).toBe(true);
    expect(lines).toContain('api: deploy dep-api is live');
    expect(lines.join('\n')).not.toContain(API_KEY);
  });

  it.each(['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled', 'deactivated'])(
    'fails when a deploy ends as %s, naming the service and the deploy',
    async (status) => {
      const render = fakeRender({ api: ['build_in_progress', status], worker: ['live'] });

      await expect(
        deployServices({
          apiKey: API_KEY,
          serviceIds: ['api', 'worker'],
          commitId: COMMIT,
          fetch: render.fetcher,
          sleep,
        }),
      ).rejects.toThrow(new DeployError(`api: deploy dep-api ended as ${status}.`));
    },
  );

  it('sees a deploy that turns live exactly at the last look', async () => {
    const render = fakeRender({
      api: [...Array<string>(MAX_POLLS).fill('build_in_progress'), 'live'],
    });
    sleeps.splice(0);

    const results = await deployServices({
      apiKey: API_KEY,
      serviceIds: ['api'],
      commitId: COMMIT,
      fetch: render.fetcher,
      sleep,
    });

    expect(results).toEqual([{ serviceId: 'api', deployId: 'dep-api', status: 'live' }]);
    expect(sleeps).toHaveLength(MAX_POLLS);
  });

  it('gives up after the last look at a deploy that is still in progress', async () => {
    const render = fakeRender({ api: ['build_in_progress'] });
    sleeps.splice(0);

    await expect(
      deployServices({
        apiKey: API_KEY,
        serviceIds: ['api'],
        commitId: COMMIT,
        fetch: render.fetcher,
        sleep,
      }),
    ).rejects.toThrow(/still build_in_progress after 20 minutes/);
    expect(sleeps).toHaveLength(MAX_POLLS);
    expect(render.calls.filter((call) => call.method === 'GET')).toHaveLength(MAX_POLLS);
  });

  it('fails on a refusal of the API without repeating the key', async () => {
    const render = fakeRender(
      {},
      { 'POST /services/api/deploys': new Response('{"message":"unauthorized"}', { status: 401 }) },
    );

    const failure = await deployServices({
      apiKey: API_KEY,
      serviceIds: ['api'],
      commitId: COMMIT,
      fetch: render.fetcher,
      sleep,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DeployError);
    expect((failure as Error).message).toBe('Render answered 401 to POST /services/api/deploys.');
    expect((failure as Error).message).not.toContain(API_KEY);
  });

  it('fails on an answer that is not a deploy', async () => {
    const render = fakeRender(
      {},
      { 'POST /services/api/deploys': new Response('<html>', { status: 201 }) },
    );

    await expect(
      deployServices({
        apiKey: API_KEY,
        serviceIds: ['api'],
        commitId: COMMIT,
        fetch: render.fetcher,
        sleep,
      }),
    ).rejects.toThrow("Render's answer to POST /services/api/deploys is not a deploy.");
  });
});
