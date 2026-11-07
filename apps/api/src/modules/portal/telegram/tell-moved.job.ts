import { Inject, Injectable, Logger } from '@nestjs/common';
import { isLanguage, TELEGRAM_TEXTS, type Clock } from '@sodiq/shared';
import { REAL_CLOCK } from '../../../clock/clock.module.js';
import type { Transaction } from '../../../database/transactions.js';
import type { TellMoved } from '../../auth/telegram-links.js';
import { TelegramBot } from './bot-api.js';

/**
 * Task 11.4: the handler of `telegram.tell_moved` (plan of #298, decision 9). It decides from the
 * stored link, never from the fact that it ran: a link that did not move, or whose chat was
 * already told, makes nothing. The notice is marked told in the transaction of the send, so a
 * Telegram that fails rolls the mark back and pg-boss tries again with back-off; a chat that
 * blocked the bot (403) is marked told and not tried again. The log names the link id only,
 * never the chat or the token.
 */
@Injectable()
export class TellMovedSender {
  private readonly log = new Logger('Telegram');

  constructor(
    private readonly bot: TelegramBot,
    @Inject(REAL_CLOCK) private readonly clock: Clock,
  ) {}

  async send(transaction: Transaction, data: TellMoved): Promise<void> {
    const link = await transaction
      .selectFrom('telegram_links')
      .innerJoin('accounts', 'accounts.id', 'telegram_links.account_id')
      .select([
        'telegram_links.telegram_user_id',
        'telegram_links.end_reason',
        'telegram_links.told_at',
        'accounts.language',
      ])
      .where('telegram_links.id', '=', data.linkId)
      .forUpdate(['telegram_links'])
      .executeTakeFirst();
    if (link === undefined || link.end_reason !== 'moved' || link.told_at !== null) {
      return;
    }
    if (!this.bot.configured) {
      this.log.warn(`Link ${data.linkId}: not told, the Telegram bot is not set up.`);
      return;
    }
    await transaction
      .updateTable('telegram_links')
      .set({ told_at: this.clock.now() })
      .where('id', '=', data.linkId)
      .execute();
    const language = isLanguage(link.language) ? link.language : 'uz';
    const outcome = await this.bot.sendMessage(
      link.telegram_user_id,
      TELEGRAM_TEXTS[language].moved,
    );
    if (outcome === 'blocked') {
      this.log.log(`Link ${data.linkId}: not told, the chat blocked the bot.`);
    }
  }
}
