import { Inject, Injectable, Logger } from '@nestjs/common';
import { isLanguage, MINI_APP_PATH, TELEGRAM_TEXTS, type Language } from '@sodiq/shared';
import { sql } from 'kysely';
import { CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/config.js';
import { transactionMoment, Transactions, type Transaction } from '../../database/transactions.js';
import { Jobs } from '../../jobs/jobs.service.js';
import { DIGEST_ATTEMPTS, quietAt, retryMinutes } from '../portal/digest/digest-schedule.js';
import { digestSettingsOf } from '../portal/digest/digest.service.js';
import { TelegramBot, TelegramUnavailable } from '../portal/telegram/bot-api.js';
import { announcementDeliverJob } from './announcement-jobs.js';
import { announcementText, type MessageAnnouncement } from './announcement-message.js';

/**
 * Task 11.7 (pull request #306): the bot's message of an announcement to each parent it reaches,
 * outside the quiet hours (build plan 11.7; `10`, Sending), with the retries of the digest (plan
 * decision 9: the quiet hours of `digest_settings`, 1 to 60 minutes, 8 attempts). Moments of the
 * schedule are the transaction's (the injected clock). Sends are not audited: the deliveries are
 * the record, as the digest's send log (11.5 decision 12).
 */
@Injectable()
export class AnnouncementDelivery {
  private readonly log = new Logger('Announcements');

  constructor(
    private readonly transactions: Transactions,
    private readonly jobs: Jobs,
    private readonly bot: TelegramBot,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** `announcements.fan_out`: one `due` delivery per Parent account the announcement reaches. */
  async fanOut(announcementId: string): Promise<void> {
    await this.transactions.run([], async (transaction) => {
      const now = await transactionMoment(transaction);
      const recipients = await sql<{ account_id: string; telegram_link_id: string }>`
        select account_id, telegram_link_id from announcement_recipients(${announcementId}::uuid, ${now})
      `.execute(transaction);
      if (recipients.rows.length === 0) return;
      await transaction
        .insertInto('announcement_deliveries')
        .values(
          recipients.rows.map((row) => ({
            announcement_id: announcementId,
            account_id: row.account_id,
            telegram_link_id: row.telegram_link_id,
            next_try_at: now,
          })),
        )
        .onConflict((conflict) => conflict.columns(['announcement_id', 'account_id']).doNothing())
        .execute();
    });
  }

  /** `announcements.tick`. Nothing while the bot is not set up or inside the quiet hours. */
  async tick(): Promise<void> {
    if (!this.bot.configured) return;
    await this.transactions.run([], async (transaction) => {
      const now = await transactionMoment(transaction);
      if (quietAt(now, await digestSettingsOf(transaction))) return;
      const waiting = await transaction
        .selectFrom('announcement_deliveries')
        .select('id')
        .where('status', '=', 'due')
        .where('next_try_at', '<=', now)
        .orderBy('next_try_at')
        .limit(500)
        .execute();
      for (const one of waiting) {
        await this.jobs.enqueue(transaction, announcementDeliverJob, {
          branchIds: [],
          data: { deliveryId: one.id },
        });
      }
    });
  }

  /** `announcements.deliver`. */
  async deliver(deliveryId: string): Promise<void> {
    if (!this.bot.configured) return;
    // The announcement may be of any branch; the job names none. It reads one row by its id.
    const branchIds = await this.transactions.run([], async (transaction) =>
      (await transaction.selectFrom('branches').select('id').orderBy('id').execute()).map(
        (row) => row.id,
      ),
    );
    const start = await this.transactions.run([], async (transaction) => {
      const delivery = await transaction
        .selectFrom('announcement_deliveries')
        .select(['id', 'status', 'attempts', 'next_try_at'])
        .where('id', '=', deliveryId)
        .forUpdate()
        .executeTakeFirst();
      if (delivery === undefined || delivery.status !== 'due') return null;
      const now = await transactionMoment(transaction);
      // Enqueued twice, sent once: every attempt moves the next try.
      if (delivery.next_try_at.getTime() > now.getTime()) return null;
      // `10`, Sending: no message at night; the tick enqueues it again once the hours end.
      if (quietAt(now, await digestSettingsOf(transaction))) return null;
      if (delivery.attempts >= DIGEST_ATTEMPTS) {
        await this.close(transaction, deliveryId, 'failed');
        this.log.warn(
          `Delivery ${deliveryId}: failed after ${String(delivery.attempts)} attempts.`,
        );
        return null;
      }
      const attempts = delivery.attempts + 1;
      await transaction
        .updateTable('announcement_deliveries')
        .set({ attempts, next_try_at: new Date(now.getTime() + retryMinutes(attempts) * 60_000) })
        .where('id', '=', deliveryId)
        .execute();
      return { attempts };
    });
    if (start === null) return;

    try {
      await this.transactions.run(branchIds, async (transaction) => {
        const delivery = await transaction
          .selectFrom('announcement_deliveries')
          .select(['announcement_id', 'account_id', 'status', 'attempts'])
          .where('id', '=', deliveryId)
          .forUpdate()
          .executeTakeFirst();
        if (delivery?.status !== 'due' || delivery.attempts !== start.attempts) return;
        const announcement = await sql<MessageAnnouncement & { archived: boolean }>`
          select kind, title, body, first_date::text as "firstDate", last_date::text as "lastDate",
            to_char(starts_at, 'HH24:MI') as "startsAt", to_char(ends_at, 'HH24:MI') as "endsAt",
            place, archived_at is not null as archived
          from announcements where id = ${delivery.announcement_id}::uuid
        `.execute(transaction);
        const row = announcement.rows[0];
        if (row === undefined || row.archived) {
          await this.close(transaction, deliveryId, 'withdrawn');
          return;
        }
        // `10`, Privacy: "Each message is checked again just before it is sent".
        const now = await transactionMoment(transaction);
        const reach = await sql<{ telegram_link_id: string; student_id: string }>`
          select telegram_link_id, student_id from announcement_recipients(
            ${delivery.announcement_id}::uuid, ${now}, ${delivery.account_id}::uuid
          )
        `.execute(transaction);
        const link = await transaction
          .selectFrom('telegram_links')
          .select(['id', 'telegram_user_id', 'bot_blocked_at'])
          .where('account_id', '=', delivery.account_id)
          .where('ended_at', 'is', null)
          .executeTakeFirst();
        if (link === undefined) {
          await this.close(transaction, deliveryId, 'no_chat');
          return;
        }
        if (reach.rows.length === 0) {
          await this.close(transaction, deliveryId, 'out_of_scope');
          return;
        }
        if (link.bot_blocked_at !== null) {
          await this.close(transaction, deliveryId, 'blocked');
          return;
        }
        const account = await transaction
          .selectFrom('accounts')
          .select('language')
          .where('id', '=', delivery.account_id)
          .executeTakeFirstOrThrow();
        const language: Language = isLanguage(account.language) ? account.language : 'uz';
        const outcome = await this.bot.sendMessage(
          link.telegram_user_id,
          announcementText(language, row),
          this.button(language, reach.rows[0]?.student_id),
        );
        if (outcome === 'blocked') {
          await transaction
            .updateTable('telegram_links')
            .set({ bot_blocked_at: now })
            .where('id', '=', link.id)
            .execute();
          await this.close(transaction, deliveryId, 'blocked');
          return;
        }
        await transaction
          .updateTable('announcement_deliveries')
          .set({ status: 'delivered', sent_at: now })
          .where('id', '=', deliveryId)
          .execute();
      });
    } catch (error) {
      // Telegram did not answer: the delivery stays due, the tick tries again.
      if (!(error instanceof TelegramUnavailable)) throw error;
      this.log.warn(`Delivery ${deliveryId}: ${error.message}`);
    }
  }

  private async close(
    transaction: Transaction,
    deliveryId: string,
    status: 'failed' | 'withdrawn' | 'no_chat' | 'out_of_scope' | 'blocked',
  ): Promise<void> {
    await transaction
      .updateTable('announcement_deliveries')
      .set({ status })
      .where('id', '=', deliveryId)
      .execute();
  }

  /**
   * The button opens the mini app, which signs in and goes on to the announcements of the first
   * child (by last and first name) the announcement reaches (plan of #306; migration 0165).
   */
  private button(
    language: Language,
    childId: string | undefined,
  ): { text: string; url: string } | undefined {
    const telegram = this.config.telegram;
    if (telegram === undefined) return undefined;
    return {
      text: TELEGRAM_TEXTS[language].openPortal,
      url: `${telegram.webOrigin}${MINI_APP_PATH}?to=announcements${childId === undefined ? '' : `&child=${childId}`}`,
    };
  }
}
