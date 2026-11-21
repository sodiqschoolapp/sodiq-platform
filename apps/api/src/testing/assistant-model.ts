import {
  ModelUnavailable,
  type AssistantModel,
  type ModelReply,
  type ModelRequest,
} from '../modules/assistant/model.js';

/** One scripted turn of the fake model: what it answers to the request it is given. */
export type FakeTurn = (request: ModelRequest) => ModelReply | Promise<ModelReply>;

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
  private turns: FakeTurn[] = [];

  /** The next turns, replacing any left. */
  script(...turns: FakeTurn[]): this {
    this.turns = [...turns];
    return this;
  }

  get left(): number {
    return this.turns.length;
  }

  async generate(request: ModelRequest): Promise<ModelReply> {
    this.requests.push(structuredClone(request));
    const turn = this.turns.shift();
    return turn === undefined ? answer('Done.')(request) : turn(request);
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

/** The results the model was given in the last turn of a request, by tool name. */
export function lastResults(request: ModelRequest): { name: string; result: unknown }[] {
  const last = request.turns.at(-1);
  return (last?.parts ?? []).flatMap((part) =>
    part.kind === 'result' ? [{ name: part.name, result: part.result }] : [],
  );
}
