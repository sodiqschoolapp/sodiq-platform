import { describe, expect, it } from 'vitest';
import { ApiException } from '../../http/api-exception.js';
import { refuseOwnRequest } from './own-request.js';

const KARIM = '0199b1c0-0000-7000-8000-0000000000aa';
const LOLA = '0199b1c0-0000-7000-8000-0000000000bb';

// docs/spec/02-roles-and-access.md, "Own requests": "Nobody approves their own."
describe('the own-request rule', () => {
  it('refuses the account that made the request', () => {
    let refusal: unknown;
    try {
      refuseOwnRequest(KARIM, KARIM);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(ApiException);
    expect((refusal as ApiException).code).toBe('own_request');
    expect((refusal as ApiException).getStatus()).toBe(403);
  });

  it('refuses it whatever the case of the letters of the id', () => {
    expect(() => {
      refuseOwnRequest(KARIM.toUpperCase(), KARIM);
    }).toThrow(ApiException);
  });

  it('lets another account decide', () => {
    expect(() => {
      refuseOwnRequest(LOLA, KARIM);
    }).not.toThrow();
  });
});
