import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  ASSISTANT_RUN_HEADER,
  ASSISTANT_STEP_HEADER,
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  type AssistantRole,
} from '@sodiq/shared';
import type { SessionPass } from '../../http/session-cookie.js';
import { AssistantCalls } from '../access/assistant-calls.js';
import { AssistantRoutes } from '../access/assistant-routes.check.js';
import { AssistantSwitches } from './assistant-switches.service.js';

/** How long one read may take, and how much of its answer is read (plan review, should fix 6). */
export const READ_TIMEOUT_MS = 10_000;
export const READ_MAX_BYTES = 2 * 1024 * 1024;

/** Task 11.22: the largest file answer an export may give the assistant (plan, the dispatcher). */
export const FILE_MAX_BYTES = 10 * 1024 * 1024;

/** Task 11.22: a file the platform answered (an export), with its type and name. */
export interface FileAnswer {
  bytes: Buffer;
  mediaType: string;
  name: string;
}

/** What a run answered: a file, or a JSON body (a preview, a report, a refusal). */
export type RunOutcome =
  | { status: number; body: unknown; file?: FileAnswer; failure?: undefined }
  | { status: 0; failure: 'timeout' | 'too_large' | 'unreachable' };

/** What a read answered: the status and the body, or why nothing came back. */
export type ReadOutcome =
  | { status: number; body: unknown; failure?: undefined }
  | { status: 0; failure: 'timeout' | 'too_large' | 'unreachable' };

/**
 * Sends the assistant's reads to the server's own address, as the person (task 11.12, plan
 * decision 6): their session cookie as it came, the branch of the request, and the mark of the
 * process with the chosen role, so the read meets every guard, schema and scope check a screen
 * meets, narrowed to that role. The address is read at each call from the server that listens,
 * so a test's ephemeral port and any `HOST` work. Nothing here is logged.
 */
@Injectable()
export class AssistantDispatcher {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly calls: AssistantCalls,
    private readonly routes: AssistantRoutes,
    private readonly switches: AssistantSwitches,
  ) {}

  /** The origin of the server's own address. */
  private origin(): string {
    const server = this.adapterHost.httpAdapter.getHttpServer() as {
      address(): AddressInfo | string | null;
    };
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('The server does not listen on a port: the assistant cannot read.');
    }
    const unspecified = address.address === '0.0.0.0' || address.address === '::';
    const host = unspecified
      ? '127.0.0.1'
      : address.family === 'IPv6'
        ? `[${address.address}]`
        : address.address;
    return `http://${host}:${String(address.port)}`;
  }

  async read(
    url: string,
    as: { pass: SessionPass; branchId: string; role: AssistantRole },
    route: string,
  ): Promise<ReadOutcome> {
    return this.send('GET', url, undefined, as, route);
  }

  /**
   * A preview (no step) or a step of a confirmed proposal (task 11.13), sent as the person with
   * the same marks as a read, the step's id and a request key made from it.
   */
  async send(
    method: string,
    url: string,
    payload: unknown,
    as: { pass: SessionPass; branchId: string; role: AssistantRole; stepId?: string },
    route: string,
  ): Promise<ReadOutcome> {
    if (!url.startsWith('/api/') || !route.startsWith(`${method} `)) {
      throw new Error('The assistant reads only routes of the API, by their own method.');
    }
    // Task 11.20 (plan review 6): the one place the Super Admin's switches are checked, for
    // every request the assistant sends (a read, a preview, a basis read and a step at
    // Confirm), read from the tables at this moment. Nothing is sent for an action off.
    const facts = this.routes.factsOf(route);
    if (facts === undefined || this.routes.linesOf(as.role)[route] === undefined) {
      return refusal('assistant_route_closed');
    }
    // Review 5: the URL is the route's own path, so the switch checked is the one sent.
    if (!pathFits(url, route.slice(route.indexOf(' ') + 1))) {
      throw new Error('The assistant sends a route only to its own path.');
    }
    if (!this.switches.isOn(await this.switches.rows(), as.role, route)) {
      return refusal('assistant_action_off');
    }
    let response: Response;
    try {
      response = await fetch(`${this.origin()}${url}`, {
        method,
        headers: {
          Accept: 'application/json',
          Cookie: as.pass.cookieHeader,
          // A school-wide route names no branch (`@Requires(…, { branch: 'none' })`).
          // A school-wide read or preview names no branch (`@Requires(…, { branch: 'none' })`);
          // a step always carries it, which the guard compares with the step's (review 1).
          ...(facts.branchNone && as.stepId === undefined ? {} : { [BRANCH_HEADER]: as.branchId }),
          ...this.calls.headersFor(as.role),
          ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(as.stepId === undefined
            ? {}
            : { [ASSISTANT_STEP_HEADER]: as.stepId, [REQUEST_KEY_HEADER]: as.stepId }),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        redirect: 'error',
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
    } catch (error) {
      return {
        status: 0,
        failure:
          error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'unreachable',
      };
    }
    let text: string | undefined;
    try {
      text = await readCapped(response);
    } catch {
      // The timeout also ends a body still coming.
      return { status: 0, failure: 'timeout' };
    }
    if (text === undefined) {
      return { status: 0, failure: 'too_large' };
    }
    let body: unknown;
    try {
      body = text === '' ? null : (JSON.parse(text) as unknown);
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }

  /**
   * Task 11.22 (approved by the owner on 25 November 2026, stop-list item 5): an import upload or
   * an export, sent as the person with a single-use run mark of this account, role, route and
   * branch, issued for this one request only. The bytes of an upload go as the raw body with the
   * file's own type; a file answer is read up to 10 MB with its type and name. The same switch
   * check as every other request.
   */
  async run(
    method: string,
    url: string,
    payload: { json: unknown } | { bytes: Buffer; type: string } | undefined,
    as: { pass: SessionPass; branchId: string; role: AssistantRole; accountId: string },
    route: string,
  ): Promise<RunOutcome & { runId: string }> {
    const runId = randomUUID();
    if (!url.startsWith('/api/') || !route.startsWith(`${method} `)) {
      throw new Error('The assistant runs only routes of the API, by their own method.');
    }
    const facts = this.routes.factsOf(route);
    if (facts === undefined || this.routes.linesOf(as.role)[route] === undefined) {
      return { ...refusal('assistant_route_closed'), runId };
    }
    if (!pathFits(url, route.slice(route.indexOf(' ') + 1))) {
      throw new Error('The assistant sends a route only to its own path.');
    }
    if (!this.switches.isOn(await this.switches.rows(), as.role, route)) {
      return { ...refusal('assistant_action_off'), runId };
    }
    const outcome = await this.calls.whileRun(
      { stepId: runId, accountId: as.accountId, branchId: as.branchId, role: as.role, route },
      async (): Promise<RunOutcome> => {
        let response: Response;
        try {
          response = await fetch(`${this.origin()}${url}`, {
            method,
            headers: {
              Accept: '*/*',
              Cookie: as.pass.cookieHeader,
              [BRANCH_HEADER]: as.branchId,
              ...this.calls.headersFor(as.role),
              [ASSISTANT_RUN_HEADER]: runId,
              [REQUEST_KEY_HEADER]: runId,
              ...(payload === undefined
                ? {}
                : { 'Content-Type': 'json' in payload ? 'application/json' : payload.type }),
            },
            ...(payload === undefined
              ? {}
              : { body: 'json' in payload ? JSON.stringify(payload.json) : payload.bytes }),
            redirect: 'error',
            signal: AbortSignal.timeout(READ_TIMEOUT_MS * 3),
          });
        } catch (error) {
          return {
            status: 0,
            failure:
              error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'unreachable',
          };
        }
        const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
        let bytes: Buffer | undefined;
        try {
          bytes = await readBytes(
            response,
            type === 'application/json' ? READ_MAX_BYTES : FILE_MAX_BYTES,
          );
        } catch {
          return { status: 0, failure: 'timeout' };
        }
        if (bytes === undefined) return { status: 0, failure: 'too_large' };
        if (type === 'application/json' || response.status >= 400 || bytes.length === 0) {
          let body: unknown = null;
          try {
            body = bytes.length === 0 ? null : (JSON.parse(bytes.toString('utf8')) as unknown);
          } catch {
            body = null;
          }
          return { status: response.status, body };
        }
        return {
          status: response.status,
          body: null,
          file: {
            bytes,
            mediaType: type,
            name: fileNameOf(response.headers.get('content-disposition')),
          },
        };
      },
    );
    return { ...outcome, runId };
  }
}

/** The file name of a `Content-Disposition` header: `filename*` first, then `filename`. */
export function fileNameOf(header: string | null): string {
  if (header === null) return 'file';
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (extended !== undefined) {
    try {
      return decodeURIComponent(extended).slice(0, 200) || 'file';
    } catch {
      // Falls through to the plain name.
    }
  }
  const plain = /filename="([^"]*)"/i.exec(header)?.[1];
  return plain?.slice(0, 200) || 'file';
}

/** Whether the path of a URL is the route's template with its values (`[A-Za-z0-9_-]+`). */
function pathFits(url: string, template: string): boolean {
  const given = (url.split('?')[0] ?? '').split('/');
  const wanted = template.split('/');
  return (
    given.length === wanted.length &&
    wanted.every((part, index) => {
      const value = given[index] ?? '';
      return part.startsWith(':') ? /^[A-Za-z0-9_-]+$/.test(value) : part === value;
    })
  );
}

/** A refusal of the dispatcher itself, as the guard would answer it; nothing was sent. */
function refusal(code: 'assistant_route_closed' | 'assistant_action_off'): ReadOutcome {
  return { status: 403, body: { error: { code, message: 'Not sent by the assistant.' } } };
}

/** The answer's bytes, or `undefined` past `limit` (leaving the loop cancels the stream). */
async function readBytes(response: Response, limit: number): Promise<Buffer | undefined> {
  const stream = response.body;
  if (stream === null) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const value of stream as unknown as AsyncIterable<Uint8Array>) {
    size += value.byteLength;
    if (size > limit) return undefined;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** The answer's text, or `undefined` past `READ_MAX_BYTES` (leaving the loop cancels the stream). */
async function readCapped(response: Response): Promise<string | undefined> {
  const stream = response.body;
  if (stream === null) {
    return '';
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const value of stream as unknown as AsyncIterable<Uint8Array>) {
    size += value.byteLength;
    if (size > READ_MAX_BYTES) {
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
