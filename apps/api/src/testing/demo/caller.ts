import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { BRANCH_HEADER, REQUEST_KEY_HEADER } from '@sodiq/shared';
import request, { type Response, type Test } from 'supertest';

/**
 * A signed-in person of the demo calling the real routes, as the browser
 * would: the session and device cookies, the branch header and a fresh
 * request key on every change. A refused call stops the seed with the route,
 * the status and the answer, so a broken step is never left half-done in
 * silence.
 */
export class Caller {
  constructor(
    private readonly server: Server,
    readonly name: string,
    private readonly session: { cookies: string },
    private readonly branch: string | null = null,
  ) {}

  /** The cookies the browser sends now. */
  get cookies(): string {
    return this.session.cookies;
  }

  /** The same person working in another branch. */
  in(branch: string | null): Caller {
    return new Caller(this.server, this.name, this.session, branch);
  }

  /** A new session after the clock moved past the idle limit: every branch's caller of the person uses it. */
  signedInAgain(cookies: string): void {
    this.session.cookies = cookies;
  }

  private prepared(call: Test, change: boolean): Test {
    let prepared = call.set('Cookie', this.session.cookies);
    if (this.branch !== null) prepared = prepared.set(BRANCH_HEADER, this.branch);
    if (change) prepared = prepared.set(REQUEST_KEY_HEADER, randomUUID());
    return prepared;
  }

  raw(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body?: object): Test {
    const call = this.prepared(request(this.server)[method](path), method !== 'get');
    return body === undefined ? call : call.send(body);
  }

  async get<T = unknown>(path: string): Promise<T> {
    return expectOk<T>(await this.raw('get', path), this.name, 'GET', path);
  }

  async post<T = unknown>(path: string, body: object = {}): Promise<T> {
    return expectOk<T>(await this.raw('post', path, body), this.name, 'POST', path);
  }

  async put<T = unknown>(path: string, body: object): Promise<T> {
    return expectOk<T>(await this.raw('put', path, body), this.name, 'PUT', path);
  }

  async patch<T = unknown>(path: string, body: object): Promise<T> {
    return expectOk<T>(await this.raw('patch', path, body), this.name, 'PATCH', path);
  }
}

export class RefusedCall extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    what: string,
  ) {
    super(`${what} answered ${String(status)}: ${JSON.stringify(body).slice(0, 2000)}`);
  }
}

/** The answer's body when the status is 2xx, else `RefusedCall`. */
export function expectOk<T>(response: Response, who: string, method: string, path: string): T {
  if (response.status < 200 || response.status >= 300) {
    throw new RefusedCall(response.status, response.body, `${method} ${path} as ${who}`);
  }
  return response.body as T;
}

/** The code of a refusal, when the answer is the one error shape. */
export function codeOf(error: unknown): string | null {
  if (!(error instanceof RefusedCall)) return null;
  const body = error.body as { error?: { code?: unknown } } | null;
  return typeof body?.error?.code === 'string' ? body.error.code : null;
}
