import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Clock } from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import {
  ASSISTANT_MODEL,
  MODEL_TIMEOUT_MS,
  ModelUnavailable,
  type AssistantModel,
  type ModelFailure,
  type ModelPlace,
  type ModelReply,
  type ModelRequest,
  type TextSink,
} from './model.js';

/**
 * The waits before the second and the third call of the region (task 11.15, plan decision 5:
 * "a growing wait", "at most twice").
 */
export const RETRY_WAITS_MS: readonly number[] = [2_000, 5_000];

/**
 * Task 11.21 (plan decision 6; `.claude/rules/api.md`: the loop bounds its calls): at most this
 * many calls of the model per turn the question may take, every retry and fallback counted (16
 * for the 8 turns of task 11.15).
 */
export const ATTEMPTS_PER_TURN = 2;

/** Task 11.21: the attempts of a question whose turns are bounded at `turns`. */
export function attemptsOf(turns: number): number {
  return turns * ATTEMPTS_PER_TURN;
}

/** Waits that long. Injected as the clock is (`CLAUDE.md`, Time is injected); tests never sleep. */
export type AssistantWait = (milliseconds: number) => Promise<void>;

export const ASSISTANT_WAIT = Symbol('ASSISTANT_WAIT');

export const REAL_WAIT: AssistantWait = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, milliseconds));
  });

/** One question's count of calls and its time limit; the fallback switch read at its start. */
export interface CallBudget {
  attempts: number;
  /** Task 11.21: the bound of the attempts, twice the turns the question may take. */
  readonly maxAttempts: number;
  /**
   * Task 11.21: the question's time limit, the setting's minutes after its stored moment, on the
   * injected clock (review of the plan, must fix 5).
   */
  readonly deadline: number;
  readonly fallbackOn: boolean;
}

/** One call made: where, and its answer or failure, for the engine to store and bill. */
export type Attempt =
  | { place: ModelPlace; location: string; reply: ModelReply }
  | {
      place: ModelPlace;
      location: string;
      failure: ModelFailure;
      billed: { tokensIn: number; tokensOut: number; model: string } | undefined;
    };

/**
 * A turn of the question that got no answer. `busy`: the region was busy or did not answer in
 * time, whatever the fallback then answered (plan decision 4a), or the time limit or the bound was
 * reached (4b); otherwise the model cannot be reached.
 */
export class ModelCallFailed extends Error {
  constructor(readonly busy: boolean) {
    super(busy ? 'The language model is busy.' : 'The language model cannot be reached.');
  }
}

/**
 * The calls of one turn (task 11.15; `02`, Where the model runs; `edge/people-roles-accounts`,
 * "Frankfurt is busy at 09:00"): the region first; a busy answer or none in time is tried again
 * after 2 s and then 5 s; then, when the fallback is on, the same request once through the
 * worldwide endpoint. A refusal (a 4xx other than 429) or a failure to reach the region is never
 * tried again and never goes to the worldwide endpoint. Every call counts against the question's
 * bound and fits within its time limit; each refused call writes one log line with Google's code
 * and status word, the model and the location, and nothing of the question.
 */
@Injectable()
export class ModelCaller {
  private readonly logger = new Logger('Assistant');

  constructor(
    @Inject(ASSISTANT_MODEL) private readonly model: AssistantModel,
    // Task 11.16 (review of the plan, correction 1): the clock of the transactions, the one the
    // question's stored moment and its answer window are read on.
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ASSISTANT_WAIT) private readonly wait: AssistantWait,
  ) {}

  /** The budget of a question, its time limit counted from the question's stored moment. */
  begin(
    fallbackOn: boolean,
    askedAt: Date,
    limits: { minutes: number; turns: number },
  ): CallBudget {
    return {
      attempts: 0,
      maxAttempts: attemptsOf(limits.turns),
      deadline: askedAt.getTime() + limits.minutes * 60_000,
      fallbackOn,
    };
  }

  /** Whether one more call, after `wait` milliseconds, stays within the bound and the limit. */
  private fits(budget: CallBudget, wait: number): boolean {
    return (
      budget.attempts < budget.maxAttempts &&
      this.clock.now().getTime() + wait + MODEL_TIMEOUT_MS <= budget.deadline
    );
  }

  /**
   * Task 11.21 (review of the plan, must fix 3): whether a turn with tools may still be sent,
   * keeping the time and the attempts of one last call without tools after it (a turn and its
   * reads, then the last call: two calls' timeouts, and the attempts of two turns).
   */
  roomForTools(budget: CallBudget): boolean {
    return (
      budget.attempts + 2 * ATTEMPTS_PER_TURN <= budget.maxAttempts &&
      this.clock.now().getTime() + 2 * MODEL_TIMEOUT_MS <= budget.deadline
    );
  }

  /**
   * The answer of one turn. `onAttempt` is given each call as soon as it ended, so a call is
   * stored and billed even when a later one of the turn fails.
   */
  async call(
    budget: CallBudget,
    request: ModelRequest,
    onAttempt: (attempt: Attempt) => Promise<void>,
    onText?: TextSink,
  ): Promise<ModelReply> {
    if (!this.fits(budget, 0)) {
      throw new ModelCallFailed(true);
    }
    for (let index = 0; index <= RETRY_WAITS_MS.length; index += 1) {
      if (index > 0) {
        const wait = RETRY_WAITS_MS[index - 1] ?? 0;
        if (!this.fits(budget, wait)) break;
        await this.wait(wait);
      }
      const outcome = await this.attempt(budget, request, 'region', onAttempt, onText);
      if ('reply' in outcome) return outcome.reply;
      if (outcome.failure.kind !== 'busy') {
        throw new ModelCallFailed(false);
      }
    }
    if (budget.fallbackOn && this.fits(budget, 0)) {
      const outcome = await this.attempt(budget, request, 'global', onAttempt, onText);
      if ('reply' in outcome) return outcome.reply;
    }
    throw new ModelCallFailed(true);
  }

  private async attempt(
    budget: CallBudget,
    request: ModelRequest,
    place: ModelPlace,
    onAttempt: (attempt: Attempt) => Promise<void>,
    onText: TextSink | undefined,
  ): Promise<{ reply: ModelReply } | { failure: ModelFailure }> {
    budget.attempts += 1;
    const location = this.model.locationOf(place);
    let reply: ModelReply;
    try {
      reply = await this.model.generate(request, place, onText);
    } catch (error) {
      const failure: ModelFailure =
        error instanceof ModelUnavailable
          ? error.reason
          : { kind: 'unreachable', code: null, status: null };
      // Build plan 11.15 item (3): the code, the status word, the model and the location only;
      // never the key, the question, a tool result, a name or Google's message text.
      this.logger.warn(
        `Model call refused: ${failure.code === null ? 'none' : String(failure.code)} ${
          failure.status ?? 'UNKNOWN'
        }, model ${this.model.name ?? 'none'}, region ${location}, attempt ${String(budget.attempts)}`,
      );
      await onAttempt({
        place,
        location,
        failure,
        billed: error instanceof ModelUnavailable ? error.billed : undefined,
      });
      return { failure };
    }
    await onAttempt({ place, location, reply });
    return { reply };
  }
}
