import { launchHashOf } from '../modules/portal/telegram/init-data.js';

/** Invented values: no real bot (task 11.4; `CLAUDE.md`, no secrets in the repository). */
export const TEST_BOT_TOKEN = '123456789:AAinventedTokenForTestsOnly_0123456789';
export const TEST_WEBHOOK_SECRET = 'invented-webhook-secret-for-tests';

export interface LaunchOptions {
  telegramUserId: number;
  /** Telegram's moment of signing. */
  signedAt: Date;
  languageCode?: string;
  /** Another token signs: a forged launch. */
  botToken?: string;
  /** Fields added after signing (a changed launch). */
  extra?: Record<string, string>;
}

/** Launch data as a Telegram client would hand it to the mini app, signed with the token. */
export function signedLaunch(options: LaunchOptions): string {
  const user = JSON.stringify({
    id: options.telegramUserId,
    first_name: 'Invented',
    ...(options.languageCode === undefined ? {} : { language_code: options.languageCode }),
  });
  const fields: [string, string][] = [
    ['auth_date', String(Math.floor(options.signedAt.getTime() / 1000))],
    ['query_id', 'AAHinventedQuery'],
    ['user', user],
  ];
  const hash = launchHashOf(fields, options.botToken ?? TEST_BOT_TOKEN);
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  for (const [key, value] of Object.entries(options.extra ?? {})) {
    params.append(key, value);
  }
  return params.toString();
}
