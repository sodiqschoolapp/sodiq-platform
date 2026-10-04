import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password-hash.js';

// Invented for the tests.
const PASSWORD = 'correct-horse-41';

// docs/spec/13-technology.md, Security: passwords stored with Argon2id.
describe('the password hash', () => {
  it('is Argon2id in PHC text with the chosen parameters, and never holds the password', async () => {
    const stored = await hashPassword(PASSWORD);

    expect(stored).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
    expect(stored).not.toContain(PASSWORD);
  });

  it('accepts the password it was made from and no other', async () => {
    const stored = await hashPassword(PASSWORD);

    expect(await verifyPassword(stored, PASSWORD)).toBe(true);
    expect(await verifyPassword(stored, 'correct-horse-42')).toBe(false);
    expect(await verifyPassword(stored, '')).toBe(false);
    expect(await verifyPassword(stored, `${PASSWORD} `)).toBe(false);
  });

  it('gives each hash its own salt', async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);

    expect(first).not.toBe(second);
    expect(await verifyPassword(second, PASSWORD)).toBe(true);
  });

  // Made with Node's own Argon2id from the password above, with 8 MiB and 1 pass:
  // a hash stored before the parameters were raised.
  const OLDER_HASH =
    '$argon2id$v=19$m=8192,t=1,p=1$MDEyMzQ1Njc4OWFiY2RlZg$Id0lO95MG+hul3yE8vSkK7f0lIgXT0WHVgkeQbTu6lo';

  it('verifies a hash that was made with other parameters, so older hashes keep working', async () => {
    expect(await verifyPassword(OLDER_HASH, PASSWORD)).toBe(true);
    expect(await verifyPassword(OLDER_HASH, 'correct-horse-42')).toBe(false);
  });

  it('computes with the parameters of the stored text, not with its own', async () => {
    const stored = await hashPassword(PASSWORD);
    const otherCost = stored.replace('m=19456,t=2', 'm=8192,t=1');

    // Other parameters give another hash, so the stored tag no longer fits.
    expect(await verifyPassword(otherCost, PASSWORD)).toBe(false);
    expect(await verifyPassword(OLDER_HASH.replace('t=1', 't=2'), PASSWORD)).toBe(false);
  });

  it.each([
    ['empty text', ''],
    ['a plain password', PASSWORD],
    [
      'another algorithm',
      '$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2g',
    ],
    [
      'an unknown version',
      '$argon2id$v=16$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2g',
    ],
    [
      'more memory than we ever store',
      '$argon2id$v=19$m=99999999,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2g',
    ],
    [
      'no passes',
      '$argon2id$v=19$m=19456,t=0,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2g',
    ],
    ['more passes than we ever store', OLDER_HASH.replace('t=1', 't=17')],
    ['more lanes than we ever store', OLDER_HASH.replace('p=1', 'p=17')],
    ['no lanes', OLDER_HASH.replace('p=1', 'p=0')],
    ['less memory than its lanes need', OLDER_HASH.replace('m=8192', 'm=7')],
    ['a cut-off text', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA'],
  ])('refuses a stored text that is %s, without an error', async (_name, stored) => {
    expect(await verifyPassword(stored, PASSWORD)).toBe(false);
  });
});
