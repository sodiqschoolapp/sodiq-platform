import {
  ApiError,
  GoogleGenAI,
  type Content,
  type GenerateContentResponse,
  type Part,
} from '@google/genai';
import type { AssistantConfig } from '../../config/config.js';
import {
  failureOfCode,
  MODEL_TIMEOUT_MS,
  ModelUnavailable,
  type AssistantModel,
  type ModelFailure,
  type ModelPlace,
  type ModelPart,
  type ModelReply,
  type ModelRequest,
  type TextSink,
} from './model.js';

/** The location of Google's worldwide endpoint (`02`, Where the model runs). */
export const GLOBAL_LOCATION = 'global';

/** The options the SDK's client is made with: no `retryOptions`, so the SDK retries nothing. */
export type GeminiClientOptions = NonNullable<ConstructorParameters<typeof GoogleGenAI>[0]>;

/**
 * Google Gemini on Vertex AI, in the region of the configuration (`europe-west3`, plan decision
 * 5; `13`, Running cost: "Frankfurt region where the model is offered"), and through the
 * worldwide endpoint (`global`) when the engine falls back (task 11.15). The only file that
 * imports `@google/genai` (`assistant-sources.test.ts`). The service account's key is given to
 * the SDK's sign-in and never logged; nothing here writes a log line. The SDK retries nothing
 * (no `retryOptions`): the engine's `ModelCaller` is the one bound of the calls.
 */
export class GeminiModel implements AssistantModel {
  private readonly clients: Readonly<Record<ModelPlace, GoogleGenAI>> | undefined;
  readonly name: string | null;

  constructor(
    private readonly config: AssistantConfig,
    makeClient: (options: GeminiClientOptions) => GoogleGenAI = (options) =>
      new GoogleGenAI(options),
  ) {
    const vertex = config.vertex;
    this.name = vertex === undefined ? null : config.model;
    if (vertex === undefined) {
      this.clients = undefined;
    } else {
      const credentials = parseCredentials(vertex.credentials);
      const clientIn = (location: string): GoogleGenAI =>
        makeClient({
          vertexai: true,
          project: vertex.project,
          location,
          googleAuthOptions: { credentials },
          httpOptions: { timeout: MODEL_TIMEOUT_MS },
        });
      this.clients = { region: clientIn(vertex.location), global: clientIn(GLOBAL_LOCATION) };
    }
  }

  locationOf(place: ModelPlace): string {
    return place === 'global' ? GLOBAL_LOCATION : this.config.vertexLocation;
  }

  async generate(request: ModelRequest, place: ModelPlace, onText?: TextSink): Promise<ModelReply> {
    if (this.clients === undefined) {
      throw new ModelUnavailable(undefined);
    }
    // Task 11.16 (`02`, While it works: "the answer as it is written"): the streaming call; each
    // text part that is not a thought goes to `onText` as it comes, and the reply is gathered
    // as before. A stream that fails midway is a failure of the call, as a refused call is.
    const calls: ModelReply['calls'] = [];
    const texts: string[] = [];
    let usage: GenerateContentResponse['usageMetadata'];
    let modelVersion: string | undefined;
    let sawParts = false;
    try {
      const stream = await this.clients[place].models.generateContentStream({
        model: this.config.model,
        contents: request.turns.map(contentOf),
        config: {
          systemInstruction: request.system,
          ...(request.tools.length === 0
            ? {}
            : {
                tools: [
                  {
                    functionDeclarations: request.tools.map((tool) => ({
                      name: tool.name,
                      description: tool.description,
                      parametersJsonSchema: tool.parameters,
                    })),
                  },
                ],
              }),
        },
      });
      for await (const chunk of stream) {
        usage = chunk.usageMetadata ?? usage;
        modelVersion = chunk.modelVersion ?? modelVersion;
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (parts === undefined) continue;
        sawParts = true;
        for (const part of parts) {
          if (part.functionCall?.name !== undefined) {
            calls.push({
              name: part.functionCall.name,
              args: part.functionCall.args ?? {},
              ...(part.thoughtSignature === undefined ? {} : { signature: part.thoughtSignature }),
            });
          } else if (typeof part.text === 'string' && part.thought !== true) {
            texts.push(part.text);
            if (part.text !== '') onText?.(part.text);
          }
        }
      }
    } catch (error) {
      throw new ModelUnavailable(
        usage === undefined ? undefined : billedOf(usage, modelVersion, this.config.model),
        {
          cause: error,
          reason: failureOf(error),
        },
      );
    }
    const billed = billedOf(usage, modelVersion, this.config.model);
    if (!sawParts) {
      throw new ModelUnavailable(billed);
    }
    return { text: texts.join(''), calls, ...billed };
  }
}

/** The tokens a call billed, as the last chunk that said them gives them (plan decision 11 of 11.12). */
function billedOf(
  usage: GenerateContentResponse['usageMetadata'],
  modelVersion: string | undefined,
  configured: string,
): { tokensIn: number; tokensOut: number; model: string } {
  return {
    tokensIn: (usage?.promptTokenCount ?? 0) + (usage?.toolUsePromptTokenCount ?? 0),
    tokensOut: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    model: modelVersion ?? configured,
  };
}

/**
 * Why a call of the SDK failed (task 11.15): the `ApiError`'s HTTP code and Google's status
 * word read from the JSON of its message, kept only when it is an upper-case word (plan decision
 * 9: the message text itself can quote the request and is never kept); an abort of the SDK's own
 * timer is "no answer in time".
 */
export function failureOf(error: unknown): ModelFailure {
  if (error instanceof ApiError) {
    return failureOfCode(error.status, statusWordOf(error.message));
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return { kind: 'busy', code: null, status: 'TIMEOUT' };
  }
  return { kind: 'unreachable', code: null, status: 'NETWORK' };
}

function statusWordOf(message: string): string | null {
  // The message is the JSON of Google's error (an object, or a list of one on Vertex AI).
  return /"status":\s*"([A-Z_]{1,40})"/.exec(message)?.[1] ?? null;
}

function parseCredentials(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Answered below without the text, which is a secret.
  }
  throw new Error('ASSISTANT_VERTEX_CREDENTIALS is not the JSON key of a service account.');
}

function contentOf(turn: ModelRequest['turns'][number]): Content {
  return { role: turn.role === 'person' ? 'user' : 'model', parts: turn.parts.map(partOf) };
}

function partOf(part: ModelPart): Part {
  switch (part.kind) {
    case 'text':
      return { text: part.text };
    case 'call':
      return {
        functionCall: { name: part.name, args: part.args },
        ...(part.signature === undefined ? {} : { thoughtSignature: part.signature }),
      };
    case 'result':
      return { functionResponse: { name: part.name, response: { result: part.result } } };
    case 'file':
      // Task 11.22: inline data, as Vertex takes a PDF, an image or audio in the request.
      return { inlineData: { mimeType: part.mediaType, data: part.data } };
  }
}
