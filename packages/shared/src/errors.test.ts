import { describe, expect, it } from 'vitest';
import { apiErrorSchema } from './errors.js';

// CLAUDE.md, Conventions: the API returns one error shape everywhere.
describe('apiErrorSchema', () => {
  const requestId = '0b7e7a52-5a43-4d4e-9d43-6c1f0a8f1b11';

  it('accepts an error without details', () => {
    const body = { error: { code: 'not_found', message: 'Not found.', requestId } };

    expect(apiErrorSchema.parse(body)).toEqual(body);
  });

  it('accepts a validation error with details', () => {
    const body = {
      error: {
        code: 'validation_failed',
        message: 'The input is not valid.',
        requestId,
        details: [{ path: 'name', code: 'invalid_type', message: 'Wrong type.' }],
      },
    };

    expect(apiErrorSchema.parse(body)).toEqual(body);
  });

  it.each([
    ['an unknown code', { error: { code: 'whatever', message: 'x', requestId } }],
    ['a missing request id', { error: { code: 'not_found', message: 'x' } }],
    ['the NestJS default shape', { statusCode: 404, message: 'Cannot GET /x', error: 'Not Found' }],
    ['an HTML error page', '<html><body>Not found</body></html>'],
  ])('refuses %s', (_name, value) => {
    expect(apiErrorSchema.safeParse(value).success).toBe(false);
  });
});
