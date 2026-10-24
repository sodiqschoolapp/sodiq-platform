import { Inject, Injectable } from '@nestjs/common';
import {
  FEEDBACK_REPORTS_PER_DAY,
  FEEDBACK_WINDOW_MS,
  ROLES,
  type Clock,
  type FeedbackReport,
  type Role,
} from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { CurrentAssignment } from '../access/current-assignments.js';
import type { ActiveSession } from '../auth/sessions.service.js';

/**
 * The roles a report records: those of the session, each once, in the order
 * of `ROLES`; empty for an account that holds no role.
 */
export function rolesOfReport(assignments: readonly CurrentAssignment[]): Role[] {
  return ROLES.filter((role) => assignments.some((assignment) => assignment.role === role));
}

/**
 * Feedback reports about the app (docs/spec/14-quality-plan.md, Whole system,
 * Monitoring: "A feedback button on every page sends a report with the page
 * and role attached"). A report names the account and the roles of the
 * session that sent it, never anything the body claims. The owner reads the
 * table until a screen exists; no audit entry is written (both decided by the
 * owner, task 0.8b-3).
 */
@Injectable()
export class FeedbackReports {
  constructor(
    private readonly transactions: Transactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Stores a report of the account of the session. At most
   * `FEEDBACK_REPORTS_PER_DAY` reports in the last 24 hours (decided by the
   * owner: "a day" is the last 24 hours, counted from the stored moments
   * against the injected clock); the next one is refused with
   * `too_many_attempts` and `Retry-After` says when the oldest of them is 24
   * hours old. Nothing is stored for a refused report.
   */
  async record(
    session: ActiveSession,
    report: FeedbackReport,
    requestId: string,
    appVersion?: number,
  ): Promise<void> {
    const now = this.clock.now();
    const windowStart = new Date(now.getTime() - FEEDBACK_WINDOW_MS);
    const roles = rolesOfReport(session.assignments);
    // The table is school-wide: no branch.
    await this.transactions.run([], async (transaction) => {
      // The row of the account is held until the report is written, so two
      // reports sent at the same moment count each other: the limit is
      // application code, not a constraint.
      await transaction
        .selectFrom('accounts')
        .select('id')
        .where('id', '=', session.accountId)
        .forUpdate()
        .execute();
      const recent = await transaction
        .selectFrom('feedback_reports')
        .select('created_at')
        .where('account_id', '=', session.accountId)
        .where('created_at', '>', windowStart)
        .orderBy('created_at', 'desc')
        .limit(FEEDBACK_REPORTS_PER_DAY)
        .execute();
      // The oldest of the newest reports: a place is free once it is 24 hours old.
      const oldest = recent.at(-1);
      if (oldest !== undefined && recent.length >= FEEDBACK_REPORTS_PER_DAY) {
        const waitMs = oldest.created_at.getTime() + FEEDBACK_WINDOW_MS - now.getTime();
        // Whole seconds, rounded up: a client that waits as told is never a second early.
        throw new ApiException('too_many_attempts', 429, Math.max(1, Math.ceil(waitMs / 1000)));
      }
      await transaction
        .insertInto('feedback_reports')
        .values({
          account_id: session.accountId,
          roles,
          page: report.page,
          text: report.text,
          created_at: now,
          request_id: requestId,
          // Task 8.3a: the version of the page that sent it.
          app_version: appVersion ?? null,
        })
        .execute();
    });
  }
}
