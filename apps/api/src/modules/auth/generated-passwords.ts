import { randomInt } from 'node:crypto';

/**
 * The secrets the platform makes for people, with crypto's `randomInt`.
 *
 * A generated sign-in password (owner, 28 November 2026: "easier parent and staff passwords")
 * is copied by hand from a printed slip: a staff first password (the account, the staff import,
 * the first-account command), a reset of a staff password or of the second step, a re-hire, a
 * parent's first password and a parent's reset. Ten lowercase letters and digits without the
 * ones that look alike (no i, l, o, 0, 1): 31 characters, about 49.5 bits. Guessing is held
 * back by the limit on sign-in attempts (`SignInThrottle`), and the password works for a few
 * days at most and is changed at the first sign-in.
 */
export const SIGN_IN_PASSWORD_LENGTH = 10;

export const SIGN_IN_PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/**
 * A recovery code of the second step keeps the length and the alphabet it had (the owner's
 * change of 28 November 2026 is for sign-in passwords only): 16 letters and digits of both
 * cases without the ones that look alike (0 O, 1 l I). It is shown in groups of four.
 */
export const RECOVERY_CODE_LENGTH = 16;

export const RECOVERY_CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomText(length: number, alphabet: string): string {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += alphabet.charAt(randomInt(alphabet.length));
  }
  return text;
}

/** A first or one-time password, for staff and parents alike. */
export function randomSignInPassword(): string {
  return randomText(SIGN_IN_PASSWORD_LENGTH, SIGN_IN_PASSWORD_ALPHABET);
}

/** One single-use recovery code of the second step (`TwoStep`). */
export function randomRecoveryCode(): string {
  return randomText(RECOVERY_CODE_LENGTH, RECOVERY_CODE_ALPHABET);
}
