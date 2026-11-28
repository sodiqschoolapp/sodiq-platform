import { describe, expect, it } from 'vitest';
import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_LENGTH,
  randomRecoveryCode,
  randomSignInPassword,
  SIGN_IN_PASSWORD_ALPHABET,
  SIGN_IN_PASSWORD_LENGTH,
} from './generated-passwords.js';

const SAMPLES = 2000;

function charactersOf(texts: readonly string[]): Set<string> {
  return new Set(texts.flatMap((text) => [...text]));
}

// Owner, 28 November 2026 ("easier parent and staff passwords"): every generated sign-in
// password, staff and parent alike, is ten characters from lowercase letters and digits
// without the ones that look alike on a slip; the recovery codes of the second step keep
// their 16 characters of both cases.
describe('a generated sign-in password', () => {
  it('has ten characters, from lowercase letters and digits without i, l, o, 0 and 1', () => {
    expect(SIGN_IN_PASSWORD_LENGTH).toBe(10);
    expect(SIGN_IN_PASSWORD_ALPHABET).toBe('abcdefghjkmnpqrstuvwxyz23456789');
    const passwords = Array.from({ length: SAMPLES }, () => randomSignInPassword());
    for (const password of passwords) {
      expect(password).toMatch(/^[a-hjkmnp-z2-9]{10}$/);
    }
    for (const lookAlike of ['i', 'l', 'o', '0', '1', 'I', 'L', 'O']) {
      expect(charactersOf(passwords).has(lookAlike)).toBe(false);
    }
  });

  it('uses the whole alphabet and is not repeated', () => {
    const passwords = Array.from({ length: SAMPLES }, () => randomSignInPassword());
    // 20 000 draws from 31 characters: each one is drawn, or the draw is not uniform.
    expect([...charactersOf(passwords)].sort()).toEqual([...SIGN_IN_PASSWORD_ALPHABET].sort());
    expect(new Set(passwords).size).toBe(SAMPLES);
  });
});

describe('a recovery code of the second step', () => {
  it('keeps its 16 characters of both cases, without the look-alikes', () => {
    expect(RECOVERY_CODE_LENGTH).toBe(16);
    expect(RECOVERY_CODE_ALPHABET).toBe('abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    const codes = Array.from({ length: SAMPLES }, () => randomRecoveryCode());
    for (const code of codes) {
      expect(code).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9]{16}$/);
    }
    expect([...charactersOf(codes)].sort()).toEqual([...RECOVERY_CODE_ALPHABET].sort());
    expect(new Set(codes).size).toBe(SAMPLES);
  });
});
