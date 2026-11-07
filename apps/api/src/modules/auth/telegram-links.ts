import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Clock } from '@sodiq/shared';
import { z } from 'zod';
import { REAL_CLOCK } from '../../clock/clock.module.js';
import { CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/config.js';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { defineJob } from '../../jobs/job-definition.js';
import { Jobs } from '../../jobs/jobs.service.js';
import { Audit } from '../audit/audit.service.js';
import { checkLaunchData, type TelegramLaunch } from '../portal/telegram/init-data.js';
import { parentAccountBlocked } from './parent-account.js';

/**
 * Task 11.4: the notice to the earlier chat when a link moved to another chat (plan of #298,
 * decision 9). Enqueued in the transaction of the move with the ended link's id only and no
 * branch: links and accounts are school-wide. Sent at once, at any hour: a security notice, not
 * the digest (11.5 owns quiet hours).
 */
export const tellMovedJob = defineJob({
  name: 'telegram.tell_moved',
  data: z.strictObject({ linkId: z.uuid() }),
  options: { retryLimit: 5, retryDelay: 30, retryBackoff: true },
});

export type TellMoved = z.infer<typeof tellMovedJob.data>;

/** Why a link ended (`telegram_links.end_reason`, 0160). */
export type LinkEnd =
  'sign_out' | 'password_change' | 'password_reset' | 'unlinked' | 'moved' | 'blocked';

/** Who ended a link and for what request, for its audit entry. */
export interface LinkEndActor {
  /** The account that acted: the parent, an administrator, or `null` for the system. */
  actorId: string | null;
  /** The administrator's assignment and branch of "Unlink Telegram"; otherwise left out. */
  assignmentId?: string;
  branchId?: string;
  requestId?: string;
}

export interface OpenLink {
  id: string;
  accountId: string;
  linkedAt: Date;
}

/**
 * The Telegram chat link of a Parent account (`10`, Signing in: Telegram; plan of #298). One
 * account to one chat and one chat to one account, held by the unique indexes of 0160; every
 * write takes the account row first, then the open link of the chat, in that order.
 *
 * Moments are by `REAL_CLOCK` (decision 10): Telegram signs in real time, and sessions and
 * passwords follow it too (task 10.5, decision 1).
 */
@Injectable()
export class TelegramLinks {
  constructor(
    private readonly audit: Audit,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(REAL_CLOCK) private readonly clock: Clock,
    // The first-account command starts the auth module without the job queue; it never links.
    // `Inject` names the class: the type `Jobs | undefined` would be read as `Object`.
    @Optional() @Inject(Jobs) private readonly jobs: Jobs | undefined,
  ) {}

  /**
   * The launch data checked against the bot's token, or `undefined` when Telegram is not set
   * up or the data is not good (forged, older than 24 hours, malformed). Never logged.
   */
  launchOf(initData: string): TelegramLaunch | undefined {
    const telegram = this.config.telegram;
    if (telegram === undefined) {
      return undefined;
    }
    const checked = checkLaunchData(initData, telegram.botToken, this.clock.now());
    return checked.ok ? checked.launch : undefined;
  }

  /** The open link of an account, if any. */
  async openLinkOfAccount(
    transaction: Transaction,
    accountId: string,
  ): Promise<OpenLink | undefined> {
    const found = await transaction
      .selectFrom('telegram_links')
      .select(['id', 'account_id', 'linked_at'])
      .where('account_id', '=', accountId)
      .where('ended_at', 'is', null)
      .executeTakeFirst();
    return found === undefined
      ? undefined
      : { id: found.id, accountId: found.account_id, linkedAt: found.linked_at };
  }

  /** The open link of a chat, locked until the end of the transaction. */
  async lockOpenLinkOfChat(
    transaction: Transaction,
    telegramUserId: string,
  ): Promise<OpenLink | undefined> {
    const found = await transaction
      .selectFrom('telegram_links')
      .select(['id', 'account_id', 'linked_at'])
      .where('telegram_user_id', '=', telegramUserId)
      .where('ended_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    return found === undefined
      ? undefined
      : { id: found.id, accountId: found.account_id, linkedAt: found.linked_at };
  }

  /**
   * Whether the account of a link can still sign in: not locked, and (a Parent account) its
   * relative in service with a live link with portal access on to an active student.
   */
  async canSignIn(transaction: Transaction, accountId: string): Promise<boolean> {
    const account = await transaction
      .selectFrom('accounts')
      .select('locked_at')
      .where('id', '=', accountId)
      .executeTakeFirstOrThrow();
    if (account.locked_at !== null) {
      return false;
    }
    return !(await parentAccountBlocked(
      transaction,
      accountId,
      await transactionMoment(transaction),
    ));
  }

  /**
   * Links the chat of a launch to a Parent account, for the session that signed in with the
   * password (decision 5: only once the session owes no step). The caller holds the account
   * row (`for update`). A chat linked to another account that can still sign in is refused
   * (decision 6); one linked to an account that can no longer sign in is ended `blocked`
   * first (shared phone, `edge/close-relatives`). The account's link to another chat moves:
   * it ends `moved` and the earlier chat is told.
   */
  async link(
    transaction: Transaction,
    request: { accountId: string; sessionId: string; telegramUserId: string; requestId?: string },
  ): Promise<string> {
    const now = this.clock.now();
    const actor: LinkEndActor = {
      actorId: request.accountId,
      ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
    };
    const ofChat = await this.lockOpenLinkOfChat(transaction, request.telegramUserId);
    if (ofChat !== undefined && ofChat.accountId === request.accountId) {
      await transaction
        .updateTable('sessions')
        .set({ telegram_link_id: ofChat.id })
        .where('id', '=', request.sessionId)
        .execute();
      return ofChat.id;
    }
    if (ofChat !== undefined) {
      if (await this.canSignIn(transaction, ofChat.accountId)) {
        throw new ApiException('telegram_chat_linked', 409);
      }
      await this.end(transaction, ofChat, 'blocked', { actorId: null, ...pick(actor) });
    }
    const ofAccount = await this.openLinkOfAccount(transaction, request.accountId);
    if (ofAccount !== undefined) {
      await this.end(transaction, ofAccount, 'moved', actor);
    }
    // The account row is held, so another link of this account waits; a first link of the same
    // chat by another account at the same moment has no row to lock and meets the index
    // instead: that one is answered as a chat linked to another account.
    const created = await transaction
      .insertInto('telegram_links')
      .values({
        account_id: request.accountId,
        telegram_user_id: request.telegramUserId,
        linked_at: now,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .catch((error: unknown) => {
        const failure = error as { code?: unknown; constraint?: unknown };
        if (failure.code === '23505' && failure.constraint === 'telegram_links_open_chat_key') {
          throw new ApiException('telegram_chat_linked', 409);
        }
        throw error;
      });
    await transaction
      .updateTable('sessions')
      .set({ telegram_link_id: created.id })
      .where('id', '=', request.sessionId)
      .execute();
    await this.audit.record(transaction, {
      branchId: null,
      actorId: request.accountId,
      action: 'telegram.linked',
      record: { type: 'telegram_link', id: created.id },
      ...(ofAccount === undefined ? {} : { details: { movedFrom: ofAccount.id } }),
      ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
    });
    return created.id;
  }

  /** Ends a link named by a session, if it is still open. */
  async endLinkById(
    transaction: Transaction,
    linkId: string,
    reason: LinkEnd,
    actor: LinkEndActor,
  ): Promise<void> {
    const open = await transaction
      .selectFrom('telegram_links')
      .select(['id', 'account_id', 'linked_at'])
      .where('id', '=', linkId)
      .where('ended_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (open !== undefined) {
      await this.end(
        transaction,
        { id: open.id, accountId: open.account_id, linkedAt: open.linked_at },
        reason,
        actor,
      );
    }
  }

  /** Ends the open link of an account, if it has one. Answers whether one was ended. */
  async endOfAccount(
    transaction: Transaction,
    accountId: string,
    reason: LinkEnd,
    actor: LinkEndActor,
    keepSessionId?: string,
  ): Promise<boolean> {
    const open = await transaction
      .selectFrom('telegram_links')
      .select(['id', 'account_id', 'linked_at'])
      .where('account_id', '=', accountId)
      .where('ended_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (open === undefined) {
      return false;
    }
    await this.end(
      transaction,
      { id: open.id, accountId: open.account_id, linkedAt: open.linked_at },
      reason,
      actor,
      keepSessionId,
    );
    return true;
  }

  /**
   * Ends a link and every open session opened through it (decision 7: the next opening asks
   * for the password), with its audit entry; a move also enqueues the notice to its chat.
   */
  async end(
    transaction: Transaction,
    link: OpenLink,
    reason: LinkEnd,
    actor: LinkEndActor,
    /** A session that stays signed in, no longer through the link (a password change). */
    keepSessionId?: string,
  ): Promise<void> {
    const now = this.clock.now();
    const ended = await transaction
      .updateTable('telegram_links')
      .set({
        ended_at: now,
        end_reason: reason,
        ended_by: reason === 'unlinked' && actor.assignmentId !== undefined ? actor.actorId : null,
      })
      .where('id', '=', link.id)
      .where('ended_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (ended === undefined) {
      return;
    }
    if (keepSessionId !== undefined) {
      await transaction
        .updateTable('sessions')
        .set({ telegram_link_id: null })
        .where('id', '=', keepSessionId)
        .where('telegram_link_id', '=', link.id)
        .execute();
    }
    const sessions = await transaction
      .updateTable('sessions')
      .set({ ended_at: now, end_reason: 'telegram_unlinked' })
      .where('telegram_link_id', '=', link.id)
      .where('ended_at', 'is', null)
      .returning('id')
      .execute();
    await this.audit.record(transaction, {
      branchId: actor.branchId ?? null,
      actorId: actor.actorId,
      ...(actor.assignmentId === undefined ? {} : { assignmentId: actor.assignmentId }),
      action: reason === 'moved' ? 'telegram.moved' : 'telegram.unlinked',
      record: { type: 'telegram_link', id: link.id },
      // The account the link was of: "unlinked by X for Y" (`edge/close-relatives`).
      details: { reason, accountId: link.accountId, endedSessions: sessions.length },
      ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
    });
    if (reason === 'moved') {
      if (this.jobs === undefined) {
        throw new Error('A Telegram link moved where the job queue is not started.');
      }
      await this.jobs.enqueue(transaction, tellMovedJob, {
        branchIds: [],
        data: { linkId: link.id },
      });
    }
  }
}

function pick(actor: LinkEndActor): Pick<LinkEndActor, 'requestId'> {
  return actor.requestId === undefined ? {} : { requestId: actor.requestId };
}
