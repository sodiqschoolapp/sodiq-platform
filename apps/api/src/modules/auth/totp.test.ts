import { describe, expect, it } from 'vitest';
import {
  base32,
  looksLikeTotpCode,
  matchingTotpStep,
  otpauthAddress,
  totpCode,
  totpStep,
} from './totp.js';

// Edge cases, "Accounts and sign-in": the second step is a code from an
// authenticator app. These are the test values of RFC 6238, appendix B, for
// SHA-1; the RFC prints eight digits, an app shows the last six.
describe('the code of an authenticator app', () => {
  const SECRET = Buffer.from('12345678901234567890', 'ascii');

  it.each([
    ['1970-01-01T00:00:59Z', '287082'],
    ['2005-03-18T01:58:29Z', '081804'],
    ['2005-03-18T01:58:31Z', '050471'],
    ['2009-02-13T23:31:30Z', '005924'],
    ['2033-05-18T03:33:20Z', '279037'],
    ['2603-10-11T11:33:20Z', '353130'],
  ])('at %s is %s, as in RFC 6238', (moment, code) => {
    expect(totpCode(SECRET, totpStep(new Date(moment)))).toBe(code);
  });

  it('changes every 30 seconds, on the half minute', () => {
    expect(totpStep(new Date('2026-10-05T09:00:29.999+05:00'))).toBe(
      totpStep(new Date('2026-10-05T09:00:00+05:00')),
    );
    expect(totpStep(new Date('2026-10-05T09:00:30+05:00'))).toBe(
      totpStep(new Date('2026-10-05T09:00:00+05:00')) + 1,
    );
  });

  describe('typed at a moment', () => {
    const now = new Date('2026-10-05T09:00:10+05:00');
    const present = totpStep(now);

    it.each([-1, 0, 1])('counts when it is the code of step %i from now', (offset) => {
      const code = totpCode(SECRET, present + offset);

      expect(matchingTotpStep(SECRET, code, now)).toBe(present + offset);
    });

    it.each([-2, 2, 100])('does not count when it is the code of step %i from now', (offset) => {
      const code = totpCode(SECRET, present + offset);

      expect(matchingTotpStep(SECRET, code, now)).toBeUndefined();
    });

    it('does not count for another secret', () => {
      const other = Buffer.from('09876543210987654321', 'ascii');

      expect(matchingTotpStep(other, totpCode(SECRET, present), now)).toBeUndefined();
    });

    it.each(['', '12345', '1234567', '12345a', ' 123456', '१२३४५६'])(
      'does not count a text that is not six digits: "%s"',
      (text) => {
        expect(looksLikeTotpCode(text)).toBe(false);
        expect(matchingTotpStep(SECRET, text, now)).toBeUndefined();
      },
    );
  });
});

describe('the secret as an authenticator app takes it', () => {
  // The test values of RFC 4648, section 10, without the padding.
  it.each([
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ])('writes "%s" in base32 as "%s"', (text, encoded) => {
    expect(base32(Buffer.from(text, 'ascii'))).toBe(encoded);
  });

  it('is an otpauth address with the login, the secret and the form of the code', () => {
    const address = new URL(otpauthAddress('a.karimov', Buffer.from('12345678901234567890')));

    expect(address.protocol).toBe('otpauth:');
    expect(address.host).toBe('totp');
    expect(decodeURIComponent(address.pathname)).toBe('/Sodiq School:a.karimov');
    expect(Object.fromEntries(address.searchParams)).toEqual({
      secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      issuer: 'Sodiq School',
      algorithm: 'SHA1',
      digits: '6',
      period: '30',
    });
  });
});
