import { Inject, Injectable } from '@nestjs/common';
import { CONFIG } from '../../../config/config.module.js';
import type { AppConfig } from '../../../config/config.js';

/** What a call to the Bot API is sent through: Node's own `fetch`, or a test's fake. */
export type TelegramFetch = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number }>;

export const TELEGRAM_FETCH = Symbol('TELEGRAM_FETCH');

/** Node's own `fetch`, the one of a server. */
export const nodeFetch: TelegramFetch = (url, init) => fetch(url, init);

/** A button under a message that opens the mini app at an address. */
export interface MiniAppButton {
  text: string;
  url: string;
}

/** `blocked`: Telegram answered 403, the user blocked the bot or never started it. */
export type SendOutcome = 'sent' | 'blocked';

export class TelegramUnavailable extends Error {}

/**
 * Task 11.4: the calls of the school's bot to Telegram's Bot API, with Node's own `fetch`
 * (Release 2 plan, reading 6: no new dependency). The token is in the address of each call, as
 * the Bot API wants it; it is never in a log line or an error: a failure says the status only.
 */
@Injectable()
export class TelegramBot {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(TELEGRAM_FETCH) private readonly fetcher: TelegramFetch,
  ) {}

  /** Whether the bot is set up (the owner's token on the server). */
  get configured(): boolean {
    return this.config.telegram !== undefined;
  }

  async sendMessage(chatId: string, text: string, button?: MiniAppButton): Promise<SendOutcome> {
    const telegram = this.config.telegram;
    if (telegram === undefined) {
      throw new TelegramUnavailable('The Telegram bot is not set up.');
    }
    let answer: { ok: boolean; status: number };
    try {
      answer = await this.fetcher(`https://api.telegram.org/bot${telegram.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody(chatId, text, button)),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // The error of a failed fetch may carry the address, which holds the token.
      throw new TelegramUnavailable('Telegram did not answer.');
    }
    if (answer.ok) {
      return 'sent';
    }
    if (answer.status === 403) {
      return 'blocked';
    }
    throw new TelegramUnavailable(`Telegram answered ${String(answer.status)}.`);
  }
}

/** The `sendMessage` call, also answered in the body of a webhook reply. */
export function messageBody(
  chatId: string,
  text: string,
  button?: MiniAppButton,
): Record<string, unknown> {
  return {
    chat_id: chatId,
    text,
    ...(button === undefined
      ? {}
      : {
          reply_markup: {
            inline_keyboard: [[{ text: button.text, web_app: { url: button.url } }]],
          },
        }),
  };
}
