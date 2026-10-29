import { randomUUID } from 'node:crypto';
import { apiErrorSchema, BRANCH_HEADER, REQUEST_KEY_HEADER } from '@sodiq/shared';

/** A refused call of the command: the route, the status and the error code, never a body. */
export class MonitoringApiError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(`${method} ${path} answered ${String(status)} ${code}`);
  }
}

/**
 * The API of this server called over HTTP, as a browser would, by the owner's command
 * `monitoring-branch` (task 10.2b, plan decision 7: every rule, check and audit entry of the
 * routes applies). It keeps the cookies the server sets (the session and the device), sends the
 * branch header and a fresh request key on every change, and stops at the first refusal.
 */
export class MonitoringApi {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly base: string) {}

  async call<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    options: { body?: object; branch?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.cookies.size > 0) {
      headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    if (options.branch !== undefined) headers[BRANCH_HEADER] = options.branch;
    if (method !== 'GET') {
      headers[REQUEST_KEY_HEADER] = randomUUID();
      headers['content-type'] = 'application/json';
    }
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {}),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const at = pair?.indexOf('=') ?? -1;
      if (pair === undefined || at < 1) continue;
      this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    const text = await response.text();
    const answer: unknown = text.length > 0 ? JSON.parse(text) : undefined;
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(answer);
      const code = parsed.success
        ? [
            parsed.data.error.code,
            ...(parsed.data.error.details ?? []).map((one) => `${one.path}:${one.code}`),
          ].join(' ')
        : 'no_code';
      throw new MonitoringApiError(method, path, response.status, code);
    }
    return answer as T;
  }

  get<T>(path: string, branch?: string): Promise<T> {
    return this.call<T>('GET', path, branch === undefined ? {} : { branch });
  }

  post<T>(path: string, body: object = {}, branch?: string): Promise<T> {
    return this.call<T>('POST', path, branch === undefined ? { body } : { body, branch });
  }

  put<T>(path: string, body: object, branch?: string): Promise<T> {
    return this.call<T>('PUT', path, branch === undefined ? { body } : { body, branch });
  }
}

/**
 * Signs the command in as a person signs in: the login and the password, then the code of the
 * second step when the account owes it (a Super Admin always does). The values are typed at the
 * prompt and kept in no variable beyond this call.
 */
export async function signIn(
  api: MonitoringApi,
  login: string,
  password: string,
  code: () => Promise<string>,
): Promise<void> {
  const session = await api.post<{ secondStep: string; mustChangePassword: boolean }>(
    '/api/auth/sign-in',
    { login, password },
  );
  if (session.mustChangePassword) {
    throw new MonitoringApiError('POST', '/api/auth/sign-in', 200, 'password_change_owed');
  }
  if (session.secondStep === 'pending') {
    await api.post('/api/auth/second-step', { code: await code() });
  } else if (session.secondStep === 'set_up_required') {
    throw new MonitoringApiError('POST', '/api/auth/sign-in', 200, 'second_step_set_up_owed');
  }
}
