import { GoogleGenAI, type Content, type GenerateContentResponse, type Part } from '@google/genai';
import type { AssistantConfig } from '../../config/config.js';
import {
  MODEL_TIMEOUT_MS,
  ModelUnavailable,
  type AssistantModel,
  type ModelPart,
  type ModelReply,
  type ModelRequest,
} from './model.js';

/**
 * Google Gemini on Vertex AI, in the region of the configuration (`europe-west3`, plan decision
 * 5; `13`, Running cost: "Frankfurt region where the model is offered"). The only file that
 * imports `@google/genai` (`assistant-sources.test.ts`). The service account's key is given to
 * the SDK's sign-in and never logged; nothing here writes a log line.
 */
export class GeminiModel implements AssistantModel {
  private readonly client: GoogleGenAI | undefined;
  readonly name: string | null;

  constructor(private readonly config: AssistantConfig) {
    const vertex = config.vertex;
    this.name = vertex === undefined ? null : config.model;
    this.client =
      vertex === undefined
        ? undefined
        : new GoogleGenAI({
            vertexai: true,
            project: vertex.project,
            location: vertex.location,
            googleAuthOptions: { credentials: parseCredentials(vertex.credentials) },
            httpOptions: { timeout: MODEL_TIMEOUT_MS },
          });
  }

  async generate(request: ModelRequest): Promise<ModelReply> {
    if (this.client === undefined) {
      throw new ModelUnavailable(undefined);
    }
    let response: GenerateContentResponse;
    try {
      response = await this.client.models.generateContent({
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
    } catch (error) {
      throw new ModelUnavailable(undefined, { cause: error });
    }
    const usage = response.usageMetadata;
    const tokensIn = (usage?.promptTokenCount ?? 0) + (usage?.toolUsePromptTokenCount ?? 0);
    const tokensOut = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
    const model = response.modelVersion ?? this.config.model;
    const parts = response.candidates?.[0]?.content?.parts;
    if (parts === undefined) {
      throw new ModelUnavailable({ tokensIn, tokensOut, model });
    }
    const calls: ModelReply['calls'] = [];
    const texts: string[] = [];
    for (const part of parts) {
      if (part.functionCall?.name !== undefined) {
        calls.push({
          name: part.functionCall.name,
          args: part.functionCall.args ?? {},
          ...(part.thoughtSignature === undefined ? {} : { signature: part.thoughtSignature }),
        });
      } else if (typeof part.text === 'string' && part.thought !== true) {
        texts.push(part.text);
      }
    }
    return { text: texts.join(''), calls, tokensIn, tokensOut, model };
  }
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
  }
}
