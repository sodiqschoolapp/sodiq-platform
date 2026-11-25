import type { AddressInfo } from 'node:net';
import { Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
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
          ...(facts.branchNone ? {} : { [BRANCH_HEADER]: as.branchId }),
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
}

/** A refusal of the dispatcher itself, as the guard would answer it; nothing was sent. */
function refusal(code: 'assistant_route_closed' | 'assistant_action_off'): ReadOutcome {
  return { status: 403, body: { error: { code, message: 'Not sent by the assistant.' } } };
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
