import type { AddressInfo } from 'node:net';
import { Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { BRANCH_HEADER, type AssistantRole } from '@sodiq/shared';
import type { SessionPass } from '../../http/session-cookie.js';
import { AssistantCalls } from '../access/assistant-calls.js';

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
  ): Promise<ReadOutcome> {
    if (!url.startsWith('/api/')) {
      throw new Error('The assistant reads only routes of the API.');
    }
    let response: Response;
    try {
      response = await fetch(`${this.origin()}${url}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Cookie: as.pass.cookieHeader,
          [BRANCH_HEADER]: as.branchId,
          ...this.calls.headersFor(as.role),
        },
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
    let body: unknown = null;
    try {
      body = text === '' ? null : JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }
}

/** The answer's text, or `undefined` past `READ_MAX_BYTES`. */
async function readCapped(response: Response): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return '';
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > READ_MAX_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
