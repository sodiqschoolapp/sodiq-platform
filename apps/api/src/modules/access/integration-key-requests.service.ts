import { Inject, Injectable } from '@nestjs/common';
import {
  INTEGRATION_KEY_ROLES,
  type Clock,
  type IntegrationKeyActingPeople,
  type Role,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/config.js';
import { transactionMoment, Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { currentAssignments, type CurrentAssignment } from './current-assignments.js';
import { integrationKeySecretHash } from './integration-keys.service.js';

/** The key a request was made through, as the guard found it. */
export interface FoundKey {
  id: string;
  name: string;
}

/** The person a key request acts for (`02`: "Every request made with a key names one person"). */
export interface KeyPerson {
  accountId: string;
  staffRecordId: string;
  /** Only the current Teacher, Head Teacher and Senior Head Teacher assignments ("their other roles do not count"). */
  assignments: CurrentAssignment[];
}

const KEY_ROLES: readonly Role[] = INTEGRATION_KEY_ROLES;

/** One minute: the window of the limit (decision 8 of pull request #369). */
const MINUTE_MS = 60_000;

/**
 * Requests made through an integration key (task 10.10; `02`, Integration
 * keys). Everything here is read again on every request: "It checks this
 * again on every request." Nothing of a session or of the account is read or
 * written.
 */
@Injectable()
export class IntegrationKeyRequests {
  constructor(
    private readonly transactions: Transactions,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * The key of `secret`, counted as used now. Refused 401 when no key has the
   * secret, when it is revoked (also when revoked between the read and the
   * count: the count is written only `where revoked_at is null`) or past its
   * end; refused 429 once the minute's requests are over the limit. The count
   * and the last use are written in a transaction of their own, before the
   * route runs, so a request the route refuses still counts and is still the
   * key's last use (decisions 8 and 9).
   */
  async use(secret: string): Promise<FoundKey> {
    const now = this.clock.now();
    const limit = this.config.integrationKeyRequestsPerMinute;
    // The count and the last use commit before a refusal over the limit is answered (code
    // review finding 10): a refused request counts too.
    const outcome = await this.transactions.run([], async (transaction) => {
      const key = await transaction
        .selectFrom('integration_keys')
        .select(['id', 'name', 'ends_at', 'revoked_at'])
        .where('secret_hash', '=', integrationKeySecretHash(secret))
        .executeTakeFirst();
      if (key === undefined) {
        throw new ApiException('integration_key_invalid', 401);
      }
      if (key.revoked_at !== null) {
        throw new ApiException('integration_key_revoked', 401);
      }
      if (new Date(key.ends_at).getTime() <= now.getTime()) {
        throw new ApiException('integration_key_ended', 401);
      }
      const windowStart = new Date(now.getTime() - MINUTE_MS);
      // One statement: two servers counting the same key at once each add one.
      const counted = await transaction
        .updateTable('integration_keys')
        .set({
          minute_started_at: sql<Date>`case
            when minute_started_at is not null and minute_started_at > ${windowStart}
            then minute_started_at else ${now}::timestamptz end`,
          minute_requests: sql<number>`case
            when minute_started_at is not null and minute_started_at > ${windowStart}
            then minute_requests + 1 else 1 end`,
          // Never backwards: of two requests at the same moment the later clock stays.
          last_used_at: sql<Date>`greatest(last_used_at, ${now})`,
        })
        .where('id', '=', key.id)
        .where('revoked_at', 'is', null)
        .returning(['minute_started_at', 'minute_requests'])
        .executeTakeFirst();
      if (counted === undefined) {
        // Revoked between the read and the count (correction 2 of the plan review).
        throw new ApiException('integration_key_revoked', 401);
      }
      const started =
        counted.minute_started_at === null ? now : new Date(counted.minute_started_at);
      return {
        key: { id: key.id, name: key.name },
        over: counted.minute_requests > limit,
        // A window started by a server whose clock is ahead keeps its start (finding 12).
        retryAfter: Math.max(1, Math.ceil((started.getTime() + MINUTE_MS - now.getTime()) / 1000)),
      };
    });
    if (outcome.over) {
      throw new ApiException('integration_key_rate_limited', 429, outcome.retryAfter);
    }
    return outcome.key;
  }

  /**
   * The person of `staffId` on the key, with only their key-role assignments
   * now. Refused 403 `integration_key_person_refused`, one code for every case
   * (decision 7): not a person on the key now, no account, a locked account,
   * inactive or left (`staff_account_blocked`), or none of the three roles.
   * `staff` is filtered by membership, so the person is read with every branch
   * in the transaction, ids and states only (review finding 2 of the plan).
   */
  async person(key: FoundKey, staffId: string): Promise<KeyPerson> {
    return this.inEveryBranch(async (transaction) => {
      const now = await transactionMoment(transaction);
      const found = await sql<{ id: string; account_id: string }>`
        select s.id, s.account_id
        from staff s
        join accounts a on a.id = s.account_id
        join integration_key_people p on p.staff_id = s.id
        where s.staff_id = ${staffId}
          and s.kind = 'person'
          and p.key_id = ${key.id}
          and p.removed_at is null
          and a.locked_at is null
          and not staff_account_blocked(s.account_id, ${now})
      `.execute(transaction);
      const [row] = found.rows;
      if (row === undefined) {
        throw new ApiException('integration_key_person_refused', 403);
      }
      const assignments = (await currentAssignments(transaction, row.account_id, now)).filter(
        (assignment) => KEY_ROLES.includes(assignment.role),
      );
      if (assignments.length === 0) {
        throw new ApiException('integration_key_person_refused', 403);
      }
      return { accountId: row.account_id, staffRecordId: row.id, assignments };
    });
  }

  /**
   * The people on the key now, for the department platform (decision 2 of the
   * plan): staff ID, name, whether a request may act for them now, and the
   * branches of their key-role assignments.
   */
  async people(key: FoundKey): Promise<IntegrationKeyActingPeople> {
    return this.inEveryBranch(async (transaction) => {
      const now = await transactionMoment(transaction);
      const found = await sql<{
        staff_id: string;
        first_name: string;
        last_name: string;
        account_id: string | null;
        open: boolean;
      }>`
        select s.staff_id, s.first_name, s.last_name, s.account_id,
          (
            s.account_id is not null
            and a.locked_at is null
            and not staff_account_blocked(s.account_id, ${now})
          ) as open
        from integration_key_people p
        join staff s on s.id = p.staff_id
        left join accounts a on a.id = s.account_id
        where p.key_id = ${key.id}
          and p.removed_at is null
          and s.kind = 'person'
          and s.staff_id is not null
        order by s.last_name, s.first_name, s.staff_id
      `.execute(transaction);
      const branches = new Map(
        (await transaction.selectFrom('branches').select(['id', 'name']).execute()).map((row) => [
          row.id,
          row.name,
        ]),
      );
      const people = [];
      for (const row of found.rows) {
        const assignments =
          row.account_id === null
            ? []
            : (await currentAssignments(transaction, row.account_id, now)).filter((assignment) =>
                KEY_ROLES.includes(assignment.role),
              );
        const own = [
          ...new Set(
            assignments.flatMap((assignment) =>
              assignment.branchId === null ? [] : [assignment.branchId],
            ),
          ),
        ].sort();
        people.push({
          staffId: row.staff_id,
          firstName: row.first_name,
          lastName: row.last_name,
          usable: row.open && assignments.length > 0,
          branches: own.map((id) => ({ id, name: branches.get(id) ?? '' })),
          allBranches: assignments.some((assignment) => assignment.branchId === null),
        });
      }
      return { key: key.name, people };
    });
  }

  /** Every branch, so that the staff of every branch can be read (as the key routes of 10.9). */
  private async inEveryBranch<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    const branchIds = await this.transactions.run([], async (transaction) =>
      (await transaction.selectFrom('branches').select('id').orderBy('id').execute()).map(
        (row) => row.id,
      ),
    );
    return this.transactions.run(branchIds, work);
  }
}
