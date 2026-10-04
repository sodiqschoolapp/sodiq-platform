import { Logger } from '@nestjs/common';
import { apiErrorSchema, type ApiError } from '@sodiq/shared';
import type { Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { errorFallback } from './api-exception.filter.js';
import { sendError } from './error-response.js';
import { REQUEST_ID_HEADER, requestIdOf } from './request-id.js';
import { toErrorDetails } from './validation.js';

/** The few things of an Express response that the error path uses. */
function fakeResponse(options: { headersSent?: boolean; requestId?: string } = {}) {
  const headers = new Map<string, string>();
  if (options.requestId !== undefined) {
    headers.set(REQUEST_ID_HEADER, options.requestId);
  }
  const sent: { status?: number; body?: ApiError; ended: boolean } = { ended: false };
  const response = {
    headersSent: options.headersSent ?? false,
    getHeader: (name: string) => headers.get(name),
    setHeader: (name: string, value: string) => {
      headers.set(name, value);
    },
    status(code: number) {
      sent.status = code;
      return response;
    },
    json(body: ApiError) {
      sent.body = body;
      return response;
    },
    end() {
      sent.ended = true;
      return response;
    },
  };
  // Only the members above are used by the code under test.
  return { response: response as unknown as Response, sent, headers };
}

function silenceLog() {
  return vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// CLAUDE.md, Conventions: the API returns one error shape everywhere.
describe('sendError', () => {
  // A library's error must not choose the status of our answer.
  it.each([
    ['a thrown text', 'some text'],
    ['a thrown null', null],
    ['an error of a library that carries a status', Object.assign(new Error('x'), { status: 403 })],
    [
      'an error that claims to be from the body parser with a 5xx status',
      { type: 'x', status: 503 },
    ],
    ['an error that claims a status below 400', { type: 'x', status: 200 }],
  ])('%s is a fault of the server', (_name, thrown) => {
    silenceLog();
    const { response, sent } = fakeResponse({ requestId: 'id-1' });

    sendError(response, thrown);

    expect(sent.status).toBe(500);
    expect(apiErrorSchema.parse(sent.body).error.code).toBe('internal_error');
  });

  it('a refusal of the body parser keeps its status', () => {
    const logged = silenceLog();
    const { response, sent } = fakeResponse({ requestId: 'id-1' });

    sendError(response, { type: 'charset.unsupported', status: 415, message: 'secret' });

    expect(sent.status).toBe(415);
    expect(sent.body).toEqual({
      error: {
        code: 'unsupported_media_type',
        message: 'The body of the request is not JSON.',
        requestId: 'id-1',
      },
    });
    expect(logged).not.toHaveBeenCalled();
  });

  // docs/decisions.md, 0.4a: a fault is logged with the request id and the name,
  // message and stack of the error only. CLAUDE.md: no personal data in logs.
  it('logs the stack of a fault and none of its other fields', () => {
    const logged = silenceLog();
    const { response } = fakeResponse({ requestId: 'id-7' });
    const databaseError = Object.assign(new Error('duplicate key value'), {
      detail: 'Key (phone)=(row-value-91c2) already exists.',
      parameters: ['row-value-91c2'],
    });

    sendError(response, databaseError);

    expect(logged).toHaveBeenCalledTimes(1);
    const everything = logged.mock.calls.flat();
    expect(everything.every((argument) => typeof argument === 'string')).toBe(true);
    expect(everything.join('\n')).toContain('id-7');
    expect(everything.join('\n')).toContain('duplicate key value');
    expect(everything.join('\n')).not.toContain('row-value-91c2');
  });

  it('only ends an answer that has already started, and still logs the fault', () => {
    const logged = silenceLog();
    const { response, sent } = fakeResponse({ headersSent: true, requestId: 'id-1' });

    sendError(response, new Error('late'));

    expect(sent).toEqual({ ended: true });
    expect(logged).toHaveBeenCalledTimes(1);
  });
});

describe('errorFallback', () => {
  it('hands an error to Express when the answer has already started', () => {
    const { response, sent } = fakeResponse({ headersSent: true });
    const next = vi.fn();
    const error = new Error('late');

    errorFallback(error, {} as never, response, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(sent).toEqual({ ended: false });
  });
});

describe('requestIdOf', () => {
  it('gives an answer an id even if the middleware did not run', () => {
    const { response, headers } = fakeResponse();

    const id = requestIdOf(response);

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers.get(REQUEST_ID_HEADER)).toBe(id);
    expect(requestIdOf(response)).toBe(id);
  });
});

// Owner, 4 October 2026: validation details never hold a submitted value. A
// path segment that is not a plain field name could be a key the caller chose.
describe('toErrorDetails', () => {
  const schema = z.object({
    marks: z.record(z.string(), z.number()),
    students: z.array(z.object({ score: z.number() })),
  });

  function detailsOf(input: unknown) {
    const result = schema.safeParse(input);
    if (result.success) {
      throw new Error('The schema accepted the input.');
    }
    return toErrorDetails(result.error);
  }

  it('replaces a key the caller chose by * and keeps field names and positions', () => {
    const details = detailsOf({
      marks: { 'Typed Value 4417': 'wrong' },
      students: [{ score: 1 }, { score: 'wrong' }],
    });

    expect(details.map((detail) => detail.path).sort()).toEqual(['marks.*', 'students.1.score']);
    expect(JSON.stringify(details)).not.toContain('4417');
  });

  it.each([
    ['holds a dot', 'a.b'],
    ['holds a space', 'Zarina Karimova'],
    ['starts with a digit', '4417abc'],
    ['is longer than a field name', 'x'.repeat(65)],
    ['is empty', ''],
  ])('replaces a key that %s', (_name, key) => {
    expect(detailsOf({ marks: { [key]: 'wrong' }, students: [] })).toEqual([
      { path: 'marks.*', code: 'invalid_type', message: 'Missing or of the wrong type.' },
    ]);
  });

  it('uses its own text, not the text of the library', () => {
    const result = z.object({ kind: z.enum(['a', 'b']) }).safeParse({ kind: 'Typed-Value' });
    if (result.success) {
      throw new Error('The schema accepted the input.');
    }

    expect(toErrorDetails(result.error)).toEqual([
      { path: 'kind', code: 'invalid_value', message: 'Not one of the allowed values.' },
    ]);
  });
});
