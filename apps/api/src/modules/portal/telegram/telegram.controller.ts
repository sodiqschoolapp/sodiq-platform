import { createHash, timingSafeEqual } from 'node:crypto';
import { Controller, HttpCode, Inject, Post } from '@nestjs/common';
import {
  isLanguage,
  MINI_APP_PATH,
  TELEGRAM_TEXTS,
  telegramUpdateSchema,
  telegramWebhookAnswerSchema,
  telegramWebhookBodySchema,
  type Language,
  type TelegramWebhookAnswer,
} from '@sodiq/shared';
import { CONFIG } from '../../../config/config.module.js';
import type { AppConfig } from '../../../config/config.js';
import { Transactions } from '../../../database/transactions.js';
import { ApiException } from '../../../http/api-exception.js';
import { Returns, ValidBody } from '../../../http/schemas.js';
import { TelegramSecret } from '../../../http/telegram-secret.js';
import { Public } from '../../auth/session.guard.js';

/** The commands /start and /start with a parameter (a link `t.me/<bot>?start=…`). */
const START = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/;

/** Equal texts in constant time, whatever their lengths. */
function sameSecret(sent: string, expected: string): boolean {
  const digest = (text: string): Buffer => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(sent), digest(expected));
}

/**
 * Task 11.4: the webhook of the school's Telegram bot (`02`, Accounts and sign-in: "from
 * Release 2 the Telegram bot's webhook, which checks the secret Telegram sends with each
 * update"). Public; refused (401) without the configured secret, before the update is read.
 * /start in a private chat is answered, in the body of the reply, with a button that opens the
 * mini app; every other update gets an empty answer. Updates are not audited (decision 12).
 */
@Controller('telegram')
export class TelegramController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly transactions: Transactions,
  ) {}

  @Post('webhook')
  @Public()
  @HttpCode(200)
  @Returns(telegramWebhookAnswerSchema)
  async webhook(
    @TelegramSecret() secret: string | undefined,
    @ValidBody(telegramWebhookBodySchema) body: Record<string, unknown>,
  ): Promise<TelegramWebhookAnswer> {
    const telegram = this.config.telegram;
    const expected = telegram?.webhookSecret;
    if (telegram === undefined || expected === undefined || secret === undefined) {
      throw new ApiException('not_signed_in', 401);
    }
    if (!sameSecret(secret, expected)) {
      throw new ApiException('not_signed_in', 401);
    }
    const update = telegramUpdateSchema.safeParse(body);
    // An update of another shape is answered empty: Telegram would send it again on a refusal.
    const message = update.success ? update.data.message : undefined;
    if (
      message?.chat.type !== 'private' ||
      message.text === undefined ||
      !START.test(message.text)
    ) {
      return {};
    }
    const texts =
      TELEGRAM_TEXTS[await this.languageOf(message.chat.id, message.from?.language_code)];
    return {
      method: 'sendMessage',
      chat_id: message.chat.id,
      text: texts.start,
      reply_markup: {
        inline_keyboard: [
          [{ text: texts.openPortal, web_app: { url: `${telegram.webOrigin}${MINI_APP_PATH}` } }],
        ],
      },
    };
  }

  /**
   * The language of the account the chat is linked to; else Telegram's language of the user
   * when it is one of the platform's; else Uzbek (`10`, Language: "Uzbek until chosen").
   */
  private async languageOf(chatId: number, languageCode: string | undefined): Promise<Language> {
    const linked = await this.transactions.run([], (transaction) =>
      transaction
        .selectFrom('telegram_links')
        .innerJoin('accounts', 'accounts.id', 'telegram_links.account_id')
        .select('accounts.language')
        .where('telegram_links.telegram_user_id', '=', String(chatId))
        .where('telegram_links.ended_at', 'is', null)
        .executeTakeFirst(),
    );
    if (linked !== undefined && isLanguage(linked.language)) {
      return linked.language;
    }
    const spoken = languageCode?.slice(0, 2);
    return spoken !== undefined && isLanguage(spoken) ? spoken : 'uz';
  }
}
