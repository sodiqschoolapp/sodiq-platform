import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ASSISTANT_CALL_HEADER,
  ASSISTANT_ROLE_HEADER,
  ASSISTANT_STEP_HEADER,
  INTEGRATION_KEY_HEADER,
  isAssistantRole,
  type AssistantRole,
} from '@sodiq/shared';
import type { IncomingHttpHeaders } from 'node:http';
import { ApiException } from '../../http/api-exception.js';

/**
 * The mark of a read the assistant makes as the person (task 11.12, plan decision 6): a secret
 * of 32 random bytes made at each start of the process and held only here, in memory. It is
 * never logged, never in an answer, and never leaves the server: the dispatcher sends it to the
 * server's own address only. A browser cannot know it, and the mark can only narrow what the
 * person's session may do (`PermissionGuard`).
 */
/** A step of a confirmed proposal while Confirm sends it (task 11.13). */
export interface RunningStep {
  stepId: string;
  accountId: string;
  branchId: string;
  role: AssistantRole;
  /** `<METHOD> /api/<path>` as listed. */
  route: string;
}

@Injectable()
export class AssistantCalls {
  private readonly secret = randomBytes(32).toString('base64url');
  /**
   * The steps being sent now, by id (task 11.13): Confirm registers a step just before it sends it
   * to the server's own address and removes it when the answer came, so a change marked as the
   * assistant's runs only for the one step Confirm is sending, as its account, branch, role and
   * route. Held in memory: the request comes back to this same process.
   */
  private readonly running = new Map<string, RunningStep>();

  /** Registers a step while `work` sends it; removed afterwards, whatever happens. */
  async whileRunning<T>(step: RunningStep, work: () => Promise<T>): Promise<T> {
    this.running.set(step.stepId, step);
    try {
      return await work();
    } finally {
      this.running.delete(step.stepId);
    }
  }

  /** The running step a change names, or `undefined` (refused by the guard). */
  stepOf(headers: IncomingHttpHeaders): RunningStep | undefined {
    const value = headers[ASSISTANT_STEP_HEADER.toLowerCase()];
    return typeof value === 'string' ? this.running.get(value) : undefined;
  }

  /** Whether the request carries the mark with the right secret (the same-site check, 11.13). */
  carriesOwnMark(headers: IncomingHttpHeaders): boolean {
    const call = headers[ASSISTANT_CALL_HEADER.toLowerCase()];
    return typeof call === 'string' && this.matches(call);
  }

  /** The two headers of a read for the chosen role. */
  headersFor(role: AssistantRole): Record<string, string> {
    return { [ASSISTANT_CALL_HEADER]: this.secret, [ASSISTANT_ROLE_HEADER]: role };
  }

  /**
   * The chosen role of a request marked as the assistant's, `undefined` for a request with
   * neither header. A request with one header, a wrong secret, an unknown role, a repeated
   * header or the header of an integration key besides is refused 403 `assistant_call_invalid`.
   */
  roleOf(headers: IncomingHttpHeaders): AssistantRole | undefined {
    const call = headers[ASSISTANT_CALL_HEADER.toLowerCase()];
    const role = headers[ASSISTANT_ROLE_HEADER.toLowerCase()];
    if (call === undefined && role === undefined) {
      return undefined;
    }
    if (
      typeof call !== 'string' ||
      typeof role !== 'string' ||
      !this.matches(call) ||
      !isAssistantRole(role) ||
      headers[INTEGRATION_KEY_HEADER.toLowerCase()] !== undefined
    ) {
      throw new ApiException('assistant_call_invalid', 403);
    }
    return role;
  }

  /** Compared in constant time (plan review, should fix 6). */
  private matches(sent: string): boolean {
    const expected = Buffer.from(this.secret);
    const given = Buffer.from(sent);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}
