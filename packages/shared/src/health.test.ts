import { describe, expect, it } from 'vitest';
import { parseHealthResponse } from './health.js';

describe('parseHealthResponse', () => {
  it('accepts the answer of the health route', () => {
    expect(parseHealthResponse({ status: 'ok' })).toEqual({ status: 'ok' });
  });

  it('keeps only the known field', () => {
    expect(parseHealthResponse({ status: 'ok', extra: 1 })).toEqual({ status: 'ok' });
  });

  it.each([
    ['another status', { status: 'down' }],
    ['a missing field', {}],
    ['null', null],
    ['an array', ['ok']],
    ['a bare string', 'ok'],
    ['an HTML error page', '<html><body>Bad gateway</body></html>'],
  ])('refuses %s', (_name, value) => {
    expect(parseHealthResponse(value)).toBeNull();
  });
});
