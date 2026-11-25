import { ApiError, type GoogleGenAI } from '@google/genai';
import { describe, expect, it } from 'vitest';
import type { AssistantConfig } from '../../config/config.js';
import { contentOf, failureOf, GeminiModel, type GeminiClientOptions } from './gemini-model.js';
import { ModelUnavailable } from './model.js';

// Task 11.15 (pull request #379): the SDK's failures read into a reason, the two places, and no
// retries of the SDK's own (the engine's `ModelCaller` is the one bound). No network: the SDK's
// client is replaced. The key below is invented.

const CONFIG: AssistantConfig = {
  vertex: {
    project: 'sodiq-test-project',
    location: 'europe-west3',
    credentials: JSON.stringify({ type: 'service_account', client_email: 'x@example.test' }),
  },
  vertexLocation: 'europe-west3',
  model: 'gemini-3.5-flash',
  scripted: false,
  scriptedDelayMs: 0,
  prices: {
    region: { priceInMicros: 1_650_000, priceOutMicros: 9_900_000 },
    global: { priceInMicros: 1_500_000, priceOutMicros: 9_000_000 },
  },
};

const REQUEST = { system: 'Rules.', turns: [], tools: [] };

function modelWith(generate: (location: string) => Promise<unknown>) {
  const made: GeminiClientOptions[] = [];
  const model = new GeminiModel(CONFIG, (options) => {
    made.push(options);
    const location = options.location ?? '';
    return {
      // Task 11.16: the streaming call; an answer given as a list is streamed chunk by chunk, an
      // error inside the list is thrown midway.
      models: {
        generateContentStream: async () => {
          const answer = await generate(location);
          const chunks = Array.isArray(answer) ? (answer as unknown[]) : [answer];
          return (async function* () {
            for (const chunk of chunks) {
              if (chunk instanceof Error) throw chunk;
              await Promise.resolve();
              yield chunk;
            }
          })();
        },
      },
    } as unknown as GoogleGenAI;
  });
  return { model, made };
}

function apiError(status: number, body: unknown): ApiError {
  return new ApiError({ message: JSON.stringify(body), status });
}

describe('the Gemini model', () => {
  // Task 11.22: a file the person attached or recorded goes as inline data with its type.
  it('sends a file part as inline data with its media type, beside the text', () => {
    expect(
      contentOf({
        role: 'person',
        parts: [
          { kind: 'text', text: 'Read this.' },
          { kind: 'file', mediaType: 'application/pdf', data: 'JVBERi0=' },
        ],
      }),
    ).toEqual({
      role: 'user',
      parts: [
        { text: 'Read this.' },
        { inlineData: { mimeType: 'application/pdf', data: 'JVBERi0=' } },
      ],
    });
  });

  it('makes one client for the region and one for the worldwide endpoint, neither with retries of the SDK', () => {
    const { made, model } = modelWith(() => Promise.reject(new Error('unused')));
    expect(made.map((options) => options.location)).toEqual(['europe-west3', 'global']);
    for (const options of made) {
      expect(options.httpOptions?.retryOptions).toBeUndefined();
      expect(options.httpOptions?.timeout).toBe(30_000);
    }
    expect(model.locationOf('region')).toBe('europe-west3');
    expect(model.locationOf('global')).toBe('global');
  });

  it('sends a call to the client of its place', async () => {
    const asked: string[] = [];
    const { model } = modelWith((location) => {
      asked.push(location);
      return Promise.resolve({
        candidates: [{ content: { parts: [{ text: 'Hello.' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
        modelVersion: 'gemini-3.5-flash',
      });
    });
    expect((await model.generate(REQUEST, 'global')).text).toBe('Hello.');
    expect((await model.generate(REQUEST, 'region')).text).toBe('Hello.');
    expect(asked).toEqual(['global', 'europe-west3']);
  });

  it('reads a refusal into its code and Google’s status word', async () => {
    const { model } = modelWith(() =>
      Promise.reject(
        apiError(429, {
          error: {
            code: 429,
            message: 'Resource exhausted for a request.',
            status: 'RESOURCE_EXHAUSTED',
          },
        }),
      ),
    );
    const error = await model.generate(REQUEST, 'region').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ModelUnavailable);
    expect((error as ModelUnavailable).reason).toEqual({
      kind: 'busy',
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
    });
  });

  it.each([
    [apiError(503, { error: { code: 503, status: 'UNAVAILABLE' } }), 'busy', 503, 'UNAVAILABLE'],
    [
      apiError(504, [{ error: { code: 504, status: 'DEADLINE_EXCEEDED' } }]),
      'busy',
      504,
      'DEADLINE_EXCEEDED',
    ],
    [apiError(404, { error: { code: 404, status: 'NOT_FOUND' } }), 'refused', 404, 'NOT_FOUND'],
    [
      apiError(400, { error: { code: 400, status: 'INVALID_ARGUMENT' } }),
      'refused',
      400,
      'INVALID_ARGUMENT',
    ],
    [
      apiError(403, { error: { code: 403, status: 'PERMISSION_DENIED' } }),
      'refused',
      403,
      'PERMISSION_DENIED',
    ],
    [apiError(500, { error: { code: 500, status: 'INTERNAL' } }), 'unreachable', 500, 'INTERNAL'],
  ])('reads %s', (error, kind, code, status) => {
    expect(failureOf(error)).toEqual({ kind, code, status });
  });

  it('keeps only an upper-case status word, never Google’s message text', () => {
    expect(failureOf(apiError(429, { error: { status: 'Too many: quokka' } }))).toEqual({
      kind: 'busy',
      code: 429,
      status: null,
    });
  });

  it('reads an abort of the SDK’s own timer as no answer in time, and anything else as a network failure', () => {
    const abort = new Error('This operation was aborted');
    abort.name = 'AbortError';
    expect(failureOf(abort)).toEqual({ kind: 'busy', code: null, status: 'TIMEOUT' });
    expect(failureOf(new TypeError('fetch failed'))).toEqual({
      kind: 'unreachable',
      code: null,
      status: 'NETWORK',
    });
  });

  // Task 11.16 (`02`, While it works: "the answer as it is written").
  it('gives each text piece to the sink as it comes, never a thought, and bills the last usage', async () => {
    const { model } = modelWith(() =>
      Promise.resolve([
        { candidates: [{ content: { parts: [{ text: 'Thinking…', thought: true }] } }] },
        { candidates: [{ content: { parts: [{ text: 'Two classes ' }] } }] },
        {
          candidates: [{ content: { parts: [{ text: 'have no Tutor.' }] } }],
          usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 5, thoughtsTokenCount: 4 },
          modelVersion: 'gemini-3.5-flash-002',
        },
      ]),
    );
    const pieces: string[] = [];
    const reply = await model.generate(REQUEST, 'region', (piece) => pieces.push(piece));
    expect(pieces).toEqual(['Two classes ', 'have no Tutor.']);
    expect(reply).toEqual({
      text: 'Two classes have no Tutor.',
      calls: [],
      tokensIn: 30,
      tokensOut: 9,
      model: 'gemini-3.5-flash-002',
    });
  });

  it('reads a stream that fails midway as a failure of the call, with the tokens it said', async () => {
    const { model } = modelWith(() =>
      Promise.resolve([
        {
          candidates: [{ content: { parts: [{ text: 'Half ' }] } }],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 1 },
        },
        apiError(503, { error: { code: 503, status: 'UNAVAILABLE' } }),
      ]),
    );
    const failed = await model
      .generate(REQUEST, 'region', () => undefined)
      .catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(ModelUnavailable);
    expect((failed as ModelUnavailable).reason).toEqual({
      kind: 'busy',
      code: 503,
      status: 'UNAVAILABLE',
    });
    expect((failed as ModelUnavailable).billed).toEqual({
      tokensIn: 12,
      tokensOut: 1,
      model: 'gemini-3.5-flash',
    });
  });
});
