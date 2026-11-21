/**
 * The language model of the assistant, behind one interface (task 11.12; build plan: "the model
 * called through one function of the module (`@google/genai`), with a fake model for tests").
 * `GeminiModel` is the only implementation that leaves the server; the tests and the browser
 * tests provide `FakeModel` (`apps/api/src/testing/assistant-model.ts`) under the same token.
 */

/** A JSON schema of a tool's arguments, in the subset the tools use (`tools.ts`). */
export interface ToolParameterSchema {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array';
  description?: string;
  enum?: string[];
  format?: string;
  pattern?: string;
  items?: ToolParameterSchema;
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
  | { kind: 'call'; name: string; args: Record<string, unknown> }
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
  calls: { name: string; args: Record<string, unknown> }[];
  /** Billed at the input price: the prompt and the tool-use prompt. */
  tokensIn: number;
  /** Billed at the output price: the answer and the model's thinking (plan decision 11). */
  tokensOut: number;
  /** The model that answered. */
  model: string;
}

/**
 * The model cannot be reached, timed out or failed (`02`, Limits: "or the model cannot be
 * reached, the panel says so"). The tokens it billed before it failed, when it says them, are
 * counted against the cap all the same (plan review, must fix 5).
 */
export class ModelUnavailable extends Error {
  constructor(
    readonly billed: { tokensIn: number; tokensOut: number; model: string } | undefined,
    options?: { cause?: unknown },
  ) {
    super('The language model of the assistant cannot be reached.', options);
  }
}

export interface AssistantModel {
  /** The model's name, or `null` when no model is set up (the panel says so). */
  readonly name: string | null;
  generate(request: ModelRequest): Promise<ModelReply>;
}

export const ASSISTANT_MODEL = Symbol('ASSISTANT_MODEL');

/** How long one call of the model may take. */
export const MODEL_TIMEOUT_MS = 30_000;
