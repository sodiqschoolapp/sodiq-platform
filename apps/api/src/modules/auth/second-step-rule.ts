import { Injectable } from '@nestjs/common';
import { STRICT_SIGN_IN_ROLES, type Role, type SecondStepState } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';

/**
 * docs/spec/02-roles-and-access.md, Rules: two-step verification is required
 * for the Super Admin and Academic Vice Principal and optional for others.
 * Whether a person with these roles must have a second step. One such role is
 * enough: the person can act in that role at any moment, whatever the role
 * switcher shows.
 */
export function secondStepRequired(roles: readonly Role[]): boolean {
  return roles.some((role) => STRICT_SIGN_IN_ROLES.includes(role));
}

/**
 * For whom the second step is required, and where a session stands with it.
 * Read on every request, so a role that is given or a second step that is
 * reset counts at once.
 */
@Injectable()
export class SecondStepRule {
  /** `roles`: the roles the account holds now. */
  required(roles: readonly Role[]): boolean {
    return secondStepRequired(roles);
  }

  /**
   * `passedAt` is the moment the session passed the second step, if it did. It
   * counts only for the second step that is in force now: a session that
   * passed before a reset and a new set-up must give a code of the new one.
   * `roles`: the roles the account holds now.
   */
  async stateOf(
    transaction: Transaction,
    accountId: string,
    passedAt: Date | null,
    roles: readonly Role[],
  ): Promise<SecondStepState> {
    const secondStep = await transaction
      .selectFrom('account_second_steps')
      .select('confirmed_at')
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    const confirmedAt = secondStep?.confirmed_at ?? null;
    if (confirmedAt === null) {
      return this.required(roles) ? 'set_up_required' : 'not_needed';
    }
    return passedAt !== null && passedAt.getTime() >= confirmedAt.getTime() ? 'passed' : 'pending';
  }
}
