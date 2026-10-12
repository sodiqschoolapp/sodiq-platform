import { Inject, Injectable } from '@nestjs/common';
import { MAIL_TEXTS, RESET_LINK_VALID_MS, isLanguage } from '@sodiq/shared';
import { sql } from 'kysely';
import { z } from 'zod';
import { CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/config.js';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import { defineJob } from '../../jobs/job-definition.js';
import { MAILER, type Mailer } from '../../mail/mailer.js';
import { Audit } from '../audit/audit.service.js';
import { newResetToken, resetTokenHash } from './reset-links.js';

/**
 * The mail of a password reset by email (task 2.3c-2, pull request #66).
 * Enqueued by `EmailPasswordResets.request` in the transaction that wrote the
 * link row, with the link id only and `branchIds: []`: the link and the
 * account are school-wide.
 */
export const passwordResetMailJob = defineJob({
  name: 'auth.password_reset_mail',
  data: z.strictObject({ linkId: z.uuid() }),
});

export type PasswordResetMail = z.infer<typeof passwordResetMailJob.data>;

/**
 * The handler. It decides from stored moments and the clock, never from the
 * fact that it ran (`.claude/rules/api.md`): a link already sent, closed or
 * superseded, a request more than an hour old (a job that ran late,
 * should-fix 10 of the plan review), or an account that may no longer get a
 * link makes nothing. Otherwise it makes the token, stores its hash with the
 * moments, and hands the mail to the mailer in the same transaction: a
 * mailer that fails rolls the link back, and the next try makes a new token,
 * so the token is held only in the mail (decision 13).
 *
 * `password_reset_address` hands any account's email to the application
 * user; this file is the only one that names it (correction 2 of the review
 * of #66, held by a test).
 */
@Injectable()
export class PasswordResetMailer {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly audit: Audit,
  ) {}

  async send(transaction: Transaction, data: PasswordResetMail): Promise<void> {
    const link = await transaction
      .selectFrom('password_reset_links')
      .select(['id', 'account_id', 'requested_at', 'sent_at', 'closed_at', 'used_at'])
      .where('id', '=', data.linkId)
      .forUpdate()
      .executeTakeFirst();
    if (link === undefined || link.sent_at !== null || link.closed_at !== null) {
      return;
    }
    const now = await transactionMoment(transaction);
    if (now.getTime() - link.requested_at.getTime() > RESET_LINK_VALID_MS) {
      return;
    }
    const newer = await transaction
      .selectFrom('password_reset_links')
      .select('id')
      .where('account_id', '=', link.account_id)
      .where('requested_at', '>', link.requested_at)
      .executeTakeFirst();
    if (newer !== undefined) {
      return;
    }
    const address = await sql<{ email: string | null }>`
      select password_reset_address(${link.account_id}::uuid, ${now}::timestamptz) as email
    `.execute(transaction);
    const to = address.rows[0]?.email ?? null;
    if (to === null) {
      return;
    }
    const account = await transaction
      .selectFrom('accounts')
      .select('language')
      .where('id', '=', link.account_id)
      .executeTakeFirstOrThrow();
    const token = newResetToken();
    const validUntil = new Date(now.getTime() + RESET_LINK_VALID_MS);
    await transaction
      .updateTable('password_reset_links')
      .set({ token_hash: resetTokenHash(token), sent_at: now, valid_until: validUntil })
      .where('id', '=', link.id)
      .execute();
    const texts = MAIL_TEXTS[isLanguage(account.language) ? account.language : 'uz'].passwordReset;
    // The token in the fragment: it reaches no server log and no Referer (decision 15).
    const url = `${this.config.mail.webOrigin}/reset-password#token=${token}`;
    // The entry first: after the send only the commit follows (should-fix 2 of
    // the spec review of the build).
    await this.audit.record(transaction, {
      branchId: null,
      actorId: null,
      action: 'auth.password_reset_mail_sent',
      record: { type: 'account', id: link.account_id },
      newValue: { validUntil: validUntil.toISOString() },
    });
    await this.mailer.send({
      to,
      subject: texts.subject,
      text: [
        texts.greeting,
        texts.body.replace('{link}', url),
        texts.validity.replace('{minutes}', String(RESET_LINK_VALID_MS / 60_000)),
        texts.ignore,
      ].join('\n\n'),
    });
  }
}
