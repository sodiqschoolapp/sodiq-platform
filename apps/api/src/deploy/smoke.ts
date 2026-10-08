import { NOTIFICATION_SOCKET_PATH, apiErrorSchema } from '@sodiq/shared';

/**
 * The smoke test after a deploy (task 0.10): a handful of requests to the
 * address of the environment, through its real name, that prove the API
 * answers, the web app is served, the middlewares run behind the load
 * balancer, and the live connection's upgrade reaches the API. It signs
 * nothing in and changes nothing.
 */

export type Fetch = typeof fetch;
export type WebSocketFactory = (url: string) => WebSocket;

export interface SmokeOptions {
  fetch?: Fetch;
  webSocket?: WebSocketFactory;
  /** How long one check may take. */
  timeoutMs?: number;
}

export interface CheckResult {
  name: string;
  problem?: string;
}

export class SmokeError extends Error {}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Runs every check and throws with the names of those that failed. */
export async function smokeTest(
  baseUrl: string,
  options: SmokeOptions = {},
): Promise<CheckResult[]> {
  const base = baseUrl.replace(/\/+$/, '');
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const results: CheckResult[] = [];
  for (const [name, check] of checks(base, fetcher, options.webSocket, timeoutMs)) {
    try {
      await check();
      results.push({ name });
    } catch (error) {
      results.push({ name, problem: error instanceof Error ? error.message : String(error) });
    }
  }
  const failed = results.filter((result) => result.problem !== undefined);
  if (failed.length > 0) {
    throw new SmokeError(
      `${String(failed.length)} of ${String(results.length)} checks failed: ${failed
        .map((result) => `${result.name} (${result.problem ?? ''})`)
        .join('; ')}`,
    );
  }
  return results;
}

function checks(
  base: string,
  fetcher: Fetch,
  webSocket: WebSocketFactory | undefined,
  timeoutMs: number,
): [string, () => Promise<void>][] {
  const get = (path: string) =>
    fetcher(`${base}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  return [
    [
      'health',
      async () => {
        const response = await get('/api/health');
        expect(response.status === 200, `status ${String(response.status)}`);
        expect(
          JSON.stringify(await response.json()) === '{"status":"ok"}',
          'the body is not {"status":"ok"}',
        );
        expect(response.headers.get('cache-control') === 'no-store', 'no "no-store"');
        expect(response.headers.get('x-powered-by') === null, 'names the framework');
      },
    ],
    [
      'web app',
      async () => {
        const response = await get('/');
        expect(response.status === 200, `status ${String(response.status)}`);
        expect((response.headers.get('content-type') ?? '').startsWith('text/html'), 'not HTML');
        expect(response.headers.get('cache-control') === 'no-cache', 'no "no-cache"');
        expect((await response.text()).includes('id="root"'), 'no root element');
      },
    ],
    [
      'session without a cookie',
      async () => {
        const response = await get('/api/auth/session');
        expect(response.status === 401, `status ${String(response.status)}`);
        const body = apiErrorSchema.safeParse(await response.json());
        expect(body.success, 'not the error shape');
        expect(body.data?.error.code === 'not_signed_in', 'not "not_signed_in"');
        expect(response.headers.get('x-request-id') !== null, 'no request id');
      },
    ],
    [
      'a body that is not JSON',
      async () => {
        const response = await fetcher(`${base}/api/auth/sign-in`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'login=x',
          signal: AbortSignal.timeout(timeoutMs),
        });
        expect(response.status === 415, `status ${String(response.status)}`);
      },
    ],
    [
      'live connection',
      () => liveRefused(base, webSocket ?? ((url) => new WebSocket(url)), timeoutMs),
    ],
  ];
}

/**
 * A WebSocket upgrade of the live connection without a cookie: the API
 * refuses it as `not_signed_in` over the connection (Socket.IO's
 * CONNECT_ERROR packet), which proves the upgrade passed the load balancer.
 */
function liveRefused(base: string, webSocket: WebSocketFactory, timeoutMs: number): Promise<void> {
  const url = `${base.replace(/^http/, 'ws')}${NOTIFICATION_SOCKET_PATH}/?EIO=4&transport=websocket`;
  return new Promise((resolve, reject) => {
    const socket = webSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`no refusal within ${String(timeoutMs)} ms`));
    }, timeoutMs);
    const done = (error?: Error) => {
      clearTimeout(timer);
      socket.close();
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    };
    socket.addEventListener('error', () => {
      done(new Error('the upgrade failed'));
    });
    socket.addEventListener('message', (event) => {
      const text = typeof event.data === 'string' ? event.data : '';
      // Engine.IO "open" is `0{…}`; the Socket.IO connect error is `44{"message":…}`.
      if (text.startsWith('0')) {
        // Ask to connect to the default namespace: `40`.
        socket.send('40');
      } else if (text.startsWith('44')) {
        const message = (JSON.parse(text.slice(2)) as { message?: unknown }).message;
        done(message === 'not_signed_in' ? undefined : new Error(`refused as ${String(message)}`));
      } else if (text.startsWith('40')) {
        done(new Error('connected without a session'));
      }
    });
  });
}

function expect(condition: boolean, problem: string): void {
  if (!condition) {
    throw new Error(problem);
  }
}
