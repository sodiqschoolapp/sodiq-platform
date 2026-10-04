import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Edge cases, "Accounts and sign-in": the second step is a code from an
 * authenticator app. That is the time-based one-time password of RFC 6238 in
 * the form every such app understands: HMAC-SHA-1, six digits, a new code
 * every 30 seconds. It comes from Node's own `crypto`, without a library.
 */

export const TOTP_STEP_MS = 30 * 1000;
export const TOTP_DIGITS = 6;

/** The secret of a new set-up has this many random bytes, the size of a SHA-1 block of output. */
export const TOTP_SECRET_BYTES = 20;

/** How many steps before and after the present one still count: the clock of a phone drifts. */
const STEPS_OF_DRIFT = 1;

/** Shown in the authenticator app beside the login. */
const ISSUER = 'Sodiq School';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** The number of the 30-second step a moment lies in. */
export function totpStep(moment: Date): number {
  return Math.floor(moment.getTime() / TOTP_STEP_MS);
}

/** The code of a secret in a step (RFC 4226, section 5.3, with the step as counter). */
export function totpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac.readUInt8(mac.length - 1) & 0x0f;
  const number = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return String(number).padStart(TOTP_DIGITS, '0');
}

/** Six digits: what a code from the app looks like. */
export function looksLikeTotpCode(text: string): boolean {
  return /^[0-9]{6}$/.test(text);
}

/**
 * The step whose code this is, among the present step and its neighbours, or
 * `undefined` for a wrong code. Every candidate is compared, each in constant
 * time, so the answer takes as long for a wrong code as for a right one.
 */
export function matchingTotpStep(secret: Buffer, code: string, now: Date): number | undefined {
  if (!looksLikeTotpCode(code)) {
    return undefined;
  }
  const typed = Buffer.from(code, 'ascii');
  const present = totpStep(now);
  let found: number | undefined;
  for (let step = present - STEPS_OF_DRIFT; step <= present + STEPS_OF_DRIFT; step += 1) {
    if (timingSafeEqual(Buffer.from(totpCode(secret, step), 'ascii'), typed)) {
      found = step;
    }
  }
  return found;
}

/** RFC 4648 base32 without padding: the form in which a secret is typed into an app. */
export function base32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let text = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      text += BASE32.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
    // Only the bits that are not written yet: the number stays small.
    value &= (1 << bits) - 1;
  }
  if (bits > 0) {
    text += BASE32.charAt((value << (5 - bits)) & 31);
  }
  return text;
}

/** The address an authenticator app reads from a QR picture. */
export function otpauthAddress(login: string, secret: Buffer): string {
  const label = `${encodeURIComponent(ISSUER)}:${encodeURIComponent(login)}`;
  const query = new URLSearchParams({
    secret: base32(secret),
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_MS / 1000),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
