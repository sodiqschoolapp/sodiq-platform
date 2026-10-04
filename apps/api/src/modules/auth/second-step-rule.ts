import { Injectable } from '@nestjs/common';
import type { SecondStepState } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';
import { SHORT_IDLE_ROLES } from './idle-limit.js';

/**
 * docs/spec/02-roles-and-access.md, Rules: two-step verification is required
 * for the Super Admin and Academic Vice Principal and optional for others. The
 * same two roles as the short idle limit; task 0.7 brings the 15 roles and
 * replaces the names in one place.
 */
export const SECOND_STEP_ROLES: readonly string[] = SHORT_IDLE_ROLES;

/**
 * Whether a person with these roles must have a second step. One such role is
 * enough: the person can act in that role at any moment, whatever the role
 * switcher shows.
 */
export function secondStepRequired(roles: readonly string[]): boolean {
  return roles.some((role) => SECOND_STEP_ROLES.includes(role));
}

/**
 * For whom the second step is required, and where a session stands with it.
 * Read on every request, so a role that is given or a second step that is
 * reset counts at once.
 */
@Injectable()
export class SecondStepRule {
  /**
   * Task 0.7 brings the roles and must answer `secondStepRequired(roles)` with
   * the roles of the account here. Until then the second step is required for
   * every account, the strict side (decided by the owner, as for the idle limit).
   */
  required(): boolean {
    return true;
  }

  /**
   * `passedAt` is the moment the session passed the second step, if it did. It
   * counts only for the second step that is in force now: a session that
   * passed before a reset and a new set-up must give a code of the new one.
   */
  async stateOf(
    transaction: Transaction,
    accountId: string,
    passedAt: Date | null,
  ): Promise<SecondStepState> {
    const secondStep = await transaction
      .selectFrom('account_second_steps')
      .select('confirmed_at')
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    const confirmedAt = secondStep?.confirmed_at ?? null;
    if (confirmedAt === null) {
      return this.required() ? 'set_up_required' : 'not_needed';
    }
    return passedAt !== null && passedAt.getTime() >= confirmedAt.getTime() ? 'passed' : 'pending';
  }
}
