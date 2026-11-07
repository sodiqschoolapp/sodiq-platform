import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Task 11.4: the check of the launch data Telegram gives a mini app (`initData`), as Telegram's
 * documentation of mini apps describes it ("Validating data received via the Mini App"):
 *
 * - the data-check string is every received field but `hash`, as `key=value`, sorted by key and
 *   joined by a line feed (a `signature` field, when Telegram sends one, is one of them);
 * - the secret key is HMAC-SHA256 of the bot token with the key `WebAppData`;
 * - `hash` is the hex of HMAC-SHA256 of the data-check string with that secret key.
 *
 * Accepted only when the hash matches (compared in constant time), no key repeats, `auth_date`
 * is at most 24 hours old and at most 5 minutes ahead of the clock (plan of #298, decision 10;
 * the clock is `REAL_CLOCK`, Telegram signs in real time), and a user with a positive id is in
 * it. The launch data is a credential for 24 hours: it is never logged or audited.
 */

/** How long launch data is accepted after Telegram signed it (Release 2 plan, reading 5). */
export const LAUNCH_VALID_MS = 24 * 60 * 60 * 1000;

/** How far ahead of the server's clock Telegram's moment may be (clocks differ a little). */
export const LAUNCH_AHEAD_MS = 5 * 60 * 1000;

/** Longer launch data than this is refused before any work (Telegram's is a few hundred bytes). */
export const LAUNCH_DATA_MAX_LENGTH = 4096;

export interface TelegramLaunch {
  /** The Telegram user, whose private chat with the bot has the same id (decision 4). */
  telegramUserId: string;
  /** Telegram's language of the user, when it is one of the platform's. */
  languageCode: string | undefined;
  signedAt: Date;
}

export type LaunchRefusal = 'malformed' | 'signature' | 'expired' | 'ahead';

export type LaunchCheck =
  { ok: true; launch: TelegramLaunch } | { ok: false; reason: LaunchRefusal };

const HASH = /^[0-9a-f]{64}$/;
const DIGITS = /^[1-9]\d{0,19}$/;

/** The secret key of a bot token (`HMAC_SHA256(<bot_token>, "WebAppData")`). */
function secretKeyOf(botToken: string): Buffer {
  return createHmac('sha256', 'WebAppData').update(botToken).digest();
}

/** The hash Telegram would give these fields with this bot token; also used by the tests. */
export function launchHashOf(
  fields: readonly (readonly [string, string])[],
  botToken: string,
): string {
  const checkString = [...fields]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  return createHmac('sha256', secretKeyOf(botToken)).update(checkString).digest('hex');
}

export function checkLaunchData(initData: string, botToken: string, now: Date): LaunchCheck {
  if (initData.length === 0 || initData.length > LAUNCH_DATA_MAX_LENGTH) {
    return { ok: false, reason: 'malformed' };
  }
  const fields: [string, string][] = [];
  const seen = new Set<string>();
  let hash: string | undefined;
  for (const [key, value] of new URLSearchParams(initData)) {
    if (seen.has(key)) {
      return { ok: false, reason: 'malformed' };
    }
    seen.add(key);
    if (key === 'hash') {
      hash = value;
    } else {
      fields.push([key, value]);
    }
  }
  if (hash === undefined || !HASH.test(hash)) {
    return { ok: false, reason: 'malformed' };
  }
  const expected = Buffer.from(launchHashOf(fields, botToken), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) {
    return { ok: false, reason: 'signature' };
  }
  // Only signed data is read from here on.
  const values = new Map(fields);
  const authDate = values.get('auth_date');
  if (authDate === undefined || !DIGITS.test(authDate)) {
    return { ok: false, reason: 'malformed' };
  }
  const signedAt = new Date(Number(authDate) * 1000);
  const age = now.getTime() - signedAt.getTime();
  if (age > LAUNCH_VALID_MS) {
    return { ok: false, reason: 'expired' };
  }
  if (-age > LAUNCH_AHEAD_MS) {
    return { ok: false, reason: 'ahead' };
  }
  const user = userOf(values.get('user'));
  if (user === undefined) {
    return { ok: false, reason: 'malformed' };
  }
  return { ok: true, launch: { ...user, signedAt } };
}

function userOf(
  text: string | undefined,
): Pick<TelegramLaunch, 'telegramUserId' | 'languageCode'> | undefined {
  if (text === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const id: unknown = (parsed as { id?: unknown }).id;
  const language: unknown = (parsed as { language_code?: unknown }).language_code;
  // Telegram's ids fit in 52 bits; a JSON number is read exactly up to 2^53.
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    return undefined;
  }
  return {
    telegramUserId: String(id),
    languageCode: typeof language === 'string' ? language : undefined,
  };
}
