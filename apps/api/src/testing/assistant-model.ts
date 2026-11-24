import {
  failureOfCode,
  ModelUnavailable,
  type AssistantModel,
  type ModelPlace,
  type ModelReply,
  type ModelRequest,
} from '../modules/assistant/model.js';

/**
 * One scripted call of the fake model: what it answers to the request it is given, at the place
 * it is sent to (task 11.15: each retry and the fallback take a turn of their own).
 */
export type FakeTurn = (
  request: ModelRequest,
  place: ModelPlace,
) => ModelReply | Promise<ModelReply>;

/** The tokens of a fake turn, unless a turn says others. */
export const FAKE_TOKENS = { tokensIn: 1_000, tokensOut: 200 } as const;

/**
 * The model of the tests (task 11.12; build plan: "with a fake model for tests"): it answers
 * the turns it is given, in order, and keeps every request it was sent, so a test reads what
 * the model would have seen. Without a turn left it answers "Done." in words.
 */
export class FakeModel implements AssistantModel {
  name: string | null = 'fake-model';
  readonly requests: ModelRequest[] = [];
  /** Task 11.15: the place of each request, in the order of `requests`. */
  readonly places: ModelPlace[] = [];
  private turns: FakeTurn[] = [];

  /** The next turns, replacing any left. */
  script(...turns: FakeTurn[]): this {
    this.turns = [...turns];
    return this;
  }

  get left(): number {
    return this.turns.length;
  }

  locationOf(place: ModelPlace): string {
    return place === 'global' ? 'global' : 'europe-west3';
  }

  async generate(request: ModelRequest, place: ModelPlace): Promise<ModelReply> {
    this.requests.push(structuredClone(request));
    this.places.push(place);
    const turn = this.turns.shift();
    return turn === undefined ? answer('Done.')(request, place) : turn(request, place);
  }
}

/** A turn that asks for tool calls. */
export function calls(...wanted: { name: string; args?: Record<string, unknown> }[]): FakeTurn {
  return () => ({
    text: '',
    calls: wanted.map((call) => ({ name: call.name, args: call.args ?? {} })),
    ...FAKE_TOKENS,
    model: 'fake-model',
  });
}

/** A turn that answers in words; the text may be made from the request (the last results). */
export function answer(text: string | ((request: ModelRequest) => string)): FakeTurn {
  return (request) => ({
    text: typeof text === 'string' ? text : text(request),
    calls: [],
    ...FAKE_TOKENS,
    model: 'fake-model',
  });
}

/** A turn that fails, after billing `billed` tokens when given. */
export function fails(billed?: { tokensIn: number; tokensOut: number }): FakeTurn {
  return () => {
    throw new ModelUnavailable(
      billed === undefined ? undefined : { ...billed, model: 'fake-model' },
    );
  };
}

/**
 * Task 11.15: a call refused with an HTTP code and Google's status word (429
 * `RESOURCE_EXHAUSTED`, 503 `UNAVAILABLE`, 504 `DEADLINE_EXCEEDED`, 404 `NOT_FOUND`, 500
 * `INTERNAL`), as `GeminiModel` reads the SDK's `ApiError`.
 */
export function refusedWith(code: number, status: string): FakeTurn {
  return () => {
    throw new ModelUnavailable(undefined, { reason: failureOfCode(code, status) });
  };
}

/** Task 11.15: no answer in time (the SDK's own timer aborted the call). */
export function noAnswer(): FakeTurn {
  return () => {
    throw new ModelUnavailable(undefined, {
      reason: { kind: 'busy', code: null, status: 'TIMEOUT' },
    });
  };
}

/** Task 11.15: the network failed before any answer. */
export function networkFailure(): FakeTurn {
  return () => {
    throw new ModelUnavailable(undefined, {
      reason: { kind: 'unreachable', code: null, status: 'NETWORK' },
    });
  };
}

/** The results the model was given in the last turn of a request, by tool name. */
export function lastResults(request: ModelRequest): { name: string; result: unknown }[] {
  const last = request.turns.at(-1);
  return (last?.parts ?? []).flatMap((part) =>
    part.kind === 'result' ? [{ name: part.name, result: part.result }] : [],
  );
}
