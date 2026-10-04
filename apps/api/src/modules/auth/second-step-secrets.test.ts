import { describe, expect, it } from 'vitest';
import { SecondStepSecrets } from './second-step-secrets.js';

// Invented for the tests.
const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 8).toString('base64');
const ACCOUNT = '01920000-0000-7000-8000-000000000001';
const OTHER_ACCOUNT = '01920000-0000-7000-8000-000000000002';
const SECRET = Buffer.from('12345678901234567890', 'ascii');

// Task 0.6c, decided by the owner: the secret of the authenticator is stored
// encrypted with AES-256-GCM; each stored secret carries the version of its
// key; a secret that cannot be decrypted is "unreadable", never a fault.
describe('the secret of a second step at rest', () => {
  const secrets = new SecondStepSecrets({ secondStepKey: KEY });

  it('is read back as it was', () => {
    expect(secrets.open(ACCOUNT, secrets.seal(ACCOUNT, SECRET))).toEqual(SECRET);
  });

  it('is stored with the version of its key in front, and not as itself', () => {
    const stored = secrets.seal(ACCOUNT, SECRET);

    expect(stored).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(stored).not.toContain(SECRET.toString('base64').replace(/=+$/, ''));
    expect(Buffer.from(stored.split(':')[2] ?? '', 'base64').includes(SECRET)).toBe(false);
  });

  it('is stored differently each time', () => {
    expect(secrets.seal(ACCOUNT, SECRET)).not.toBe(secrets.seal(ACCOUNT, SECRET));
  });

  describe('is unreadable, without an error,', () => {
    const stored = secrets.seal(ACCOUNT, SECRET);
    const [version, iv, sealed] = stored.split(':') as [string, string, string];

    it('with another key', () => {
      expect(
        new SecondStepSecrets({ secondStepKey: OTHER_KEY }).open(ACCOUNT, stored),
      ).toBeUndefined();
    });

    it('for another account', () => {
      expect(secrets.open(OTHER_ACCOUNT, stored)).toBeUndefined();
    });

    it('with a key version we do not have', () => {
      expect(secrets.open(ACCOUNT, `v2:${iv}:${sealed}`)).toBeUndefined();
    });

    it('when one character of it was changed', () => {
      const changed = sealed.startsWith('A') ? `B${sealed.slice(1)}` : `A${sealed.slice(1)}`;

      expect(secrets.open(ACCOUNT, `${version}:${iv}:${changed}`)).toBeUndefined();
    });

    it.each([
      '',
      'v1',
      'v1::',
      'v0:AAAA:AAAA',
      'plain text',
      `${version}:${iv}`,
      `${version}:AAAA:${sealed}`,
      `${version}:${iv}:AAAA`,
      `x${stored}`,
    ])('when it is not what we store: "%s"', (text) => {
      expect(secrets.open(ACCOUNT, text)).toBeUndefined();
    });
  });
});
