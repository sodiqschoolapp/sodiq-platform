/**
 * The language model of the assistant, behind one interface (task 11.12; build plan: "the model
 * called through one function of the module (`@google/genai`), with a fake model for tests").
 * `GeminiModel` is the only implementation that leaves the server; the tests and the browser
 * tests provide `FakeModel` (`apps/api/src/testing/assistant-model.ts`) under the same token.
 */

/** A JSON schema of a tool's arguments, in the subset the tools use (`tools.ts`). */
export interface ToolParameterSchema {
  /** Left out only on a choice between schemas (`anyOf`). */
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: (string | number)[];
  format?: string;
  pattern?: string;
  items?: ToolParameterSchema;
  /** An object (task 11.13: the body of a proposed change). */
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
  nullable?: boolean;
  anyOf?: ToolParameterSchema[];
}

export interface ToolArgumentsSchema {
  type: 'object';
  properties: Record<string, ToolParameterSchema>;
  required: string[];
}

/** One tool the model may call: a route of the role's list, or `suggest_page`. */
export interface ModelTool {
  name: string;
  description: string;
  parameters: ToolArgumentsSchema;
}

export type ModelPart =
  | { kind: 'text'; text: string }
  | {
      kind: 'call';
      name: string;
      args: Record<string, unknown>;
      /** Gemini's thought signature of the call, sent back with it on the next turn. */
      signature?: string;
    }
  | { kind: 'result'; name: string; result: unknown };

/** One turn of the conversation as the model reads it. */
export interface ModelTurn {
  role: 'person' | 'model';
  parts: ModelPart[];
}

export interface ModelRequest {
  /** The system instruction: the rules, never a text read from the data. */
  system: string;
  turns: ModelTurn[];
  /** Empty: the model must answer in words. */
  tools: ModelTool[];
}

export interface ModelReply {
  text: string;
  calls: { name: string; args: Record<string, unknown>; signature?: string }[];
  /** Billed at the input price: the prompt and the tool-use prompt. */
  tokensIn: number;
  /** Billed at the output price: the answer and the model's thinking (plan decision 11). */
  tokensOut: number;
  /** The model that answered. */
  model: string;
}

/**
 * Where a call is sent (task 11.15; `02`, Where the model runs): the configured region
 * (`ASSISTANT_VERTEX_LOCATION`, Frankfurt), or Google's worldwide endpoint (`global`).
 */
export type ModelPlace = 'region' | 'global';

/**
 * Why a call failed (task 11.15). `busy`: 429, 503, 504 or no answer in time, tried again and
 * sent to the fallback (plan decision 1). `refused`: a 4xx other than 429, never tried again.
 * `unreachable`: everything else (a 500, a network failure, no model set up).
 */
export interface ModelFailure {
  kind: 'busy' | 'refused' | 'unreachable';
  /** Google's HTTP status code, or `null` when no answer came. */
  code: number | null;
  /** Google's status word (`RESOURCE_EXHAUSTED`), `TIMEOUT`, `NETWORK` or `null`. */
  status: string | null;
}

/** The codes that mean "busy or did not answer in time" (plan decision 1). */
export const BUSY_CODES: readonly number[] = [429, 503, 504];

/** The failure of an answer with an HTTP status code. */
export function failureOfCode(code: number, status: string | null): ModelFailure {
  const kind = BUSY_CODES.includes(code)
    ? 'busy'
    : code >= 400 && code < 500
      ? 'refused'
      : 'unreachable';
  return { kind, code, status };
}

/**
 * The model cannot be reached, timed out or failed (`02`, Limits: "or the model cannot be
 * reached, the panel says so"). The tokens it billed before it failed, when it says them, are
 * counted against the cap all the same (plan review, must fix 5).
 */
export class ModelUnavailable extends Error {
  readonly reason: ModelFailure;

  constructor(
    readonly billed: { tokensIn: number; tokensOut: number; model: string } | undefined,
    options?: { cause?: unknown; reason?: ModelFailure },
  ) {
    super('The language model of the assistant cannot be reached.', { cause: options?.cause });
    this.reason = options?.reason ?? { kind: 'unreachable', code: null, status: null };
  }
}

export interface AssistantModel {
  /** The model's name, or `null` when no model is set up (the panel says so). */
  readonly name: string | null;
  /** The Google location of a place, as stored and logged (`europe-west3`, `global`). */
  locationOf(place: ModelPlace): string;
  generate(request: ModelRequest, place: ModelPlace): Promise<ModelReply>;
}

export const ASSISTANT_MODEL = Symbol('ASSISTANT_MODEL');

/** How long one call of the model may take. */
export const MODEL_TIMEOUT_MS = 30_000;
