import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The sign-in-and-save check of Grafana Synthetic Monitoring (`monitoring/synthetic/
 * sign-in-and-save.js`, task 10.2b) run in Node by a test, as k6 runs it: its three imports
 * replaced by stand-ins (`k6/http` by `fetch` with a jar of the cookies the server sets,
 * `k6/secrets` by the two values given, `k6` by `check` and `fail`). The test runs the very file
 * the owner pastes into Grafana, so a path, a header or a body it sends is the one tested.
 */

export const K6_SCRIPT = fileURLToPath(
  new URL('../../../../monitoring/synthetic/sign-in-and-save.js', import.meta.url),
);

export interface K6Request {
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

class K6Failure extends Error {}

export async function runK6Script(input: {
  base: string;
  secrets: Record<string, string>;
}): Promise<{ requests: K6Request[]; failure: string | null }> {
  const source = readFileSync(K6_SCRIPT, 'utf8');
  const imports = [
    "import http from 'k6/http';",
    "import secrets from 'k6/secrets';",
    "import { check, fail } from 'k6';",
  ];
  let body = source;
  for (const line of imports) {
    if (!body.includes(line)) throw new Error(`The script no longer has: ${line}`);
    body = body.replace(line, '');
  }
  body = body.replace('export default async function ()', 'return async function ()');

  const jar = new Map<string, string>();
  const requests: K6Request[] = [];
  const http = {
    async asyncRequest(
      method: string,
      url: string,
      payload: string | null,
      params: { headers: Record<string, string> },
    ) {
      const headers = { ...params.headers };
      if (jar.size > 0)
        headers.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
      const started = performance.now();
      const response = await fetch(url, { method, headers, body: payload ?? undefined });
      const text = await response.text();
      const duration = performance.now() - started;
      for (const line of response.headers.getSetCookie()) {
        const [pair] = line.split(';');
        const at = pair?.indexOf('=') ?? -1;
        if (pair === undefined || at < 1) continue;
        const value = pair.slice(at + 1);
        if (value === '' || /max-age=0/i.test(line)) jar.delete(pair.slice(0, at));
        else jar.set(pair.slice(0, at), value);
      }
      requests.push({ method, path: new URL(url).pathname, status: response.status });
      return {
        status: response.status,
        timings: { duration },
        json: (): unknown => JSON.parse(text),
      };
    },
  };
  const secrets = {
    get: (name: string): Promise<string> => {
      const value = input.secrets[name];
      return value === undefined
        ? Promise.reject(new Error(`No secret ${name}.`))
        : Promise.resolve(value);
    },
  };
  const check = <T>(value: T, checks: Record<string, (value: T) => boolean>): boolean =>
    Object.values(checks).every((one) => one(value));
  const fail = (message: string): never => {
    throw new K6Failure(message);
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the check is a file of this repository, run as k6 runs it.
  const factory = new Function('http', 'secrets', 'check', 'fail', '__ENV', body) as (
    ...args: unknown[]
  ) => () => Promise<void>;
  const main = factory(http, secrets, check, fail, { SODIQ_BASE_URL: input.base });
  try {
    await main();
    return { requests, failure: null };
  } catch (error) {
    if (error instanceof K6Failure) return { requests, failure: error.message };
    throw error;
  }
}
