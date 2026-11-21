import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  DEFAULT_TIME_ZONE,
  INTEGRATION_KEY_ROLES,
  INTEGRATION_KEY_SECRET_PREFIX,
  latestIntegrationKeyEnd,
  schoolDateOf,
  type ErrorDetail,
  type IntegrationKey,
  type IntegrationKeyChoices,
  type IntegrationKeyCreated,
  type IntegrationKeyList,
  type IntegrationKeyPerson,
  type IntegrationKeyRecord,
  type IntegrationKeyState,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { Audit } from '../audit/audit.service.js';
import { notFound, refusingDuplicates } from '../setup/setup-refusals.js';
import type { Access } from './permission.guard.js';

/**
 * The time zone of a key's end date. A key has no branch; a record without a
 * branch uses the school's zone, Tashkent (decision 5 of pull request #368,
 * as the parent's link date of task 11.2).
 */
const KEY_TIME_ZONE = DEFAULT_TIME_ZONE;

/** The secret of a new key: the prefix and 32 random bytes in base64url (43 characters). */
export function newIntegrationKeySecret(): string {
  return `${INTEGRATION_KEY_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/**
 * The only form of a secret that is stored: SHA-256 in hex (decision 3; `13`,
 * Security: "stored only as a hash"), as session tokens and reset links are.
 * Task 10.10 finds the key of a request by it.
 */
export function integrationKeySecretHash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

interface KeyRow {
  id: string;
  name: string;
  ends_on: string;
  ends_at: Date;
  created_at: Date;
  revoked_at: Date | null;
  last_used_at: Date | null;
}

const KEY_COLUMNS = [
  'id',
  'name',
  sql<string>`to_char(ends_on, 'YYYY-MM-DD')`.as('ends_on'),
  'ends_at',
  'created_at',
  'revoked_at',
  'last_used_at',
] as const;

/** The state of a key at `now`, read from its stored moments on each request. */
export function integrationKeyState(
  key: { revoked_at: Date | null; ends_at: Date },
  now: Date,
): IntegrationKeyState {
  if (key.revoked_at !== null) {
    return 'revoked';
  }
  return key.ends_at.getTime() <= now.getTime() ? 'ended' : 'active';
}

/**
 * The Integration keys page of the Super Admin (`02`, Integration keys; task
 * 10.9). School-wide work: a key has no branch and may list people of every
 * branch. `staff` is filtered by the branch memberships of the person
 * (`staff_membership`, 0024), so every transaction here holds every branch,
 * as the Super Admin's school-wide reads of the audit log do.
 */
@Injectable()
export class IntegrationKeys {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
  ) {}

  /** Every branch, so that the staff of every branch can be read. */
  private async everyBranch(): Promise<string[]> {
    return this.transactions.run([], async (transaction) =>
      (await transaction.selectFrom('branches').select('id').orderBy('id').execute()).map(
        (row) => row.id,
      ),
    );
  }

  private async run<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    const branchIds = await this.everyBranch();
    return this.transactions.run(branchIds, work);
  }

  async list(): Promise<IntegrationKeyList> {
    return this.run(async (transaction) => {
      const now = await transactionMoment(transaction);
      const keys = await transaction
        .selectFrom('integration_keys')
        .select(KEY_COLUMNS)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .execute();
      const people = await this.peopleOfKeys(
        transaction,
        keys.map((key) => key.id),
        now,
      );
      const today = schoolDateOf(now, KEY_TIME_ZONE);
      return {
        keys: keys.map((key) => this.answerOf(key, people.get(key.id) ?? [], now)),
        today,
        latestEndsOn: latestIntegrationKeyEnd(today),
      };
    });
  }

  /** The people who may be put on a key now, in every branch, by surname. */
  async choices(): Promise<IntegrationKeyChoices> {
    return this.run(async (transaction) => {
      const now = await transactionMoment(transaction);
      const people = await this.people(transaction, null, now);
      return { people: people.filter((person) => person.holdsKeyRole) };
    });
  }

  async create(
    access: Access,
    record: IntegrationKeyRecord,
    requestId: string,
  ): Promise<IntegrationKeyCreated> {
    const secret = newIntegrationKeySecret();
    const key = await refusingDuplicates(
      () =>
        this.run(async (transaction) => {
          const now = await transactionMoment(transaction);
          this.checkEnd(record.endsOn, now);
          const staffIds = record.staffRecordIds.map((id) => id.toLowerCase());
          await this.checkPeople(transaction, staffIds, now);
          const inserted = await transaction
            .insertInto('integration_keys')
            .values({
              name: record.name,
              secret_hash: integrationKeySecretHash(secret),
              ends_on: record.endsOn,
              ends_at: sql<Date>`((${record.endsOn}::date + 1)::timestamp at time zone ${KEY_TIME_ZONE})`,
              created_at: now,
              created_by: access.accountId,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await transaction
            .insertInto('integration_key_people')
            .values(
              staffIds.map((staffId) => ({
                key_id: inserted.id,
                staff_id: staffId,
                added_at: now,
                added_by: access.accountId,
              })),
            )
            .execute();
          // Never the secret or its hash (`13`, Security).
          await this.audit.record(transaction, {
            branchId: null,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'integration_key.create',
            record: { type: 'integration_key', id: inserted.id },
            newValue: {
              name: record.name,
              staffRecordIds: [...staffIds].sort(),
              endsOn: record.endsOn,
            },
            requestId,
          });
          return this.read(transaction, inserted.id, now);
        }),
      { integration_keys_name_key: 'name' },
    );
    return { key, secret };
  }

  /** Puts the whole new list of people on a key; an unchanged list writes nothing. */
  async changePeople(
    access: Access,
    keyId: string,
    staffRecordIds: readonly string[],
    requestId: string,
  ): Promise<IntegrationKey> {
    return this.run(async (transaction) => {
      const now = await transactionMoment(transaction);
      await this.lockedKey(transaction, keyId);
      const current = await transaction
        .selectFrom('integration_key_people')
        .select(['id', 'staff_id'])
        .where('key_id', '=', keyId)
        .where('removed_at', 'is', null)
        .orderBy('staff_id')
        .execute();
      const wanted = staffRecordIds.map((id) => id.toLowerCase());
      const before = current.map((row) => row.staff_id.toLowerCase());
      const added = wanted.filter((id) => !before.includes(id));
      const removed = current.filter((row) => !wanted.includes(row.staff_id.toLowerCase()));
      if (added.length === 0 && removed.length === 0) {
        return this.read(transaction, keyId, now);
      }
      // A person who stays is not checked again (decision 6): only the added ones.
      await this.checkPeople(transaction, added, now);
      if (removed.length > 0) {
        await transaction
          .updateTable('integration_key_people')
          .set({ removed_at: now, removed_by: access.accountId })
          .where(
            'id',
            'in',
            removed.map((row) => row.id),
          )
          .execute();
      }
      if (added.length > 0) {
        await transaction
          .insertInto('integration_key_people')
          .values(
            added.map((staffId) => ({
              key_id: keyId,
              staff_id: staffId,
              added_at: now,
              added_by: access.accountId,
            })),
          )
          .execute();
      }
      await this.audit.record(transaction, {
        branchId: null,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'integration_key.people_changed',
        record: { type: 'integration_key', id: keyId },
        oldValue: { staffRecordIds: [...before].sort() },
        newValue: { staffRecordIds: [...wanted].sort() },
        requestId,
      });
      return this.read(transaction, keyId, now);
    });
  }

  /** A new end date; the same date writes nothing. */
  async changeEnd(
    access: Access,
    keyId: string,
    endsOn: string,
    requestId: string,
  ): Promise<IntegrationKey> {
    return this.run(async (transaction) => {
      const now = await transactionMoment(transaction);
      const key = await this.lockedKey(transaction, keyId);
      if (key.ends_on === endsOn) {
        return this.read(transaction, keyId, now);
      }
      this.checkEnd(endsOn, now);
      await transaction
        .updateTable('integration_keys')
        .set({
          ends_on: endsOn,
          ends_at: sql<Date>`((${endsOn}::date + 1)::timestamp at time zone ${KEY_TIME_ZONE})`,
        })
        .where('id', '=', keyId)
        .execute();
      await this.audit.record(transaction, {
        branchId: null,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'integration_key.end_date_changed',
        record: { type: 'integration_key', id: keyId },
        oldValue: { endsOn: key.ends_on },
        newValue: { endsOn },
        requestId,
      });
      return this.read(transaction, keyId, now);
    });
  }

  /** Revokes a key for good; a revoked key is answered unchanged, with no second entry. */
  async revoke(access: Access, keyId: string, requestId: string): Promise<IntegrationKey> {
    return this.run(async (transaction) => {
      const now = await transactionMoment(transaction);
      const key = await this.lockedKey(transaction, keyId, { revokedAnswered: true });
      if (key.revoked_at === null) {
        await transaction
          .updateTable('integration_keys')
          .set({ revoked_at: now, revoked_by: access.accountId })
          .where('id', '=', keyId)
          .execute();
        await this.audit.record(transaction, {
          branchId: null,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'integration_key.revoke',
          record: { type: 'integration_key', id: keyId },
          oldValue: { revokedAt: null },
          newValue: { revokedAt: now.toISOString() },
          requestId,
        });
      }
      return this.read(transaction, keyId, now);
    });
  }

  /**
   * The key row, locked for the change before anything is written (the people
   * trigger reads the key without a lock). Unknown: 404. Revoked: 409
   * `integration_key_revoked`, unless the route answers a revoked key.
   */
  private async lockedKey(
    transaction: Transaction,
    keyId: string,
    options: { revokedAnswered?: boolean } = {},
  ): Promise<KeyRow> {
    const key = await transaction
      .selectFrom('integration_keys')
      .select(KEY_COLUMNS)
      .where('id', '=', keyId)
      .forUpdate()
      .executeTakeFirst();
    if (key === undefined) {
      throw notFound();
    }
    if (key.revoked_at !== null && options.revokedAnswered !== true) {
      throw new ApiException('integration_key_revoked', 409);
    }
    return key;
  }

  /** Today to one year after today, in Asia/Tashkent (decision 5). */
  private checkEnd(endsOn: string, now: Date): void {
    const today = schoolDateOf(now, KEY_TIME_ZONE);
    if (endsOn < today || endsOn > latestIntegrationKeyEnd(today)) {
      throw new ApiException('integration_key_end_refused', 422);
    }
  }

  /**
   * Each person may be put on a key now: an active staff record of a person
   * with an account that is not locked, holding a current Teacher, Head
   * Teacher or Senior Head Teacher assignment (`02`, Integration keys;
   * correction 1 of the plan review). The staff rows and the accounts are held
   * `for share` first, and the assignments read in a statement of their own
   * after the locks. Unknown: 404; refused: 422 naming each one.
   */
  private async checkPeople(
    transaction: Transaction,
    staffIds: readonly string[],
    now: Date,
  ): Promise<void> {
    if (staffIds.length === 0) {
      return;
    }
    const sorted = [...staffIds].sort();
    const staff = await transaction
      .selectFrom('staff')
      .select(['id', 'account_id'])
      .where('id', 'in', sorted)
      .orderBy('id')
      .forShare()
      .execute();
    if (staff.length !== sorted.length) {
      throw notFound();
    }
    const accountIds = staff.flatMap((row) => (row.account_id === null ? [] : [row.account_id]));
    if (accountIds.length > 0) {
      await transaction
        .selectFrom('accounts')
        .select('id')
        .where('id', 'in', [...accountIds].sort())
        .orderBy('id')
        .forShare()
        .execute();
    }
    const people = await this.people(transaction, sorted, now);
    // A vacancy is found above but is not a person (it has no staff ID): refused and named too.
    const allowed = new Set(
      people
        .filter((person) => person.holdsKeyRole)
        .map((person) => person.staffRecordId.toLowerCase()),
    );
    const refused: ErrorDetail[] = sorted
      .filter((id) => !allowed.has(id))
      .map((id) => ({
        path: 'staffRecordIds',
        code: 'integration_key_person_refused',
        message: 'The person may not be put on an integration key.',
        recordId: id,
      }));
    if (refused.length > 0) {
      throw new ApiException('integration_key_person_refused', 422, undefined, refused);
    }
  }

  /**
   * People with a staff ID (a person, not a vacancy), each with whether they
   * may be put on a key at `now`; `staffIds` null reads every person.
   */
  private async people(
    transaction: Transaction,
    staffIds: readonly string[] | null,
    now: Date,
  ): Promise<IntegrationKeyPerson[]> {
    if (staffIds !== null && staffIds.length === 0) {
      return [];
    }
    const found = await sql<{
      id: string;
      staff_id: string;
      first_name: string;
      last_name: string;
      eligible: boolean;
    }>`
      select s.id, s.staff_id, s.first_name, s.last_name,
        (
          s.account_id is not null
          and a.locked_at is null
          and not staff_account_blocked(s.account_id, ${now})
          and exists (
            select 1 from assignments r
            where r.account_id = s.account_id
              and r.role in (${sql.join(INTEGRATION_KEY_ROLES)})
              and r.valid_from <= ${now}
              and (r.valid_until is null or r.valid_until > ${now})
          )
        ) as eligible
      from staff s
      left join accounts a on a.id = s.account_id
      where s.kind = 'person' and s.staff_id is not null
        ${staffIds === null ? sql`` : sql`and s.id in (${sql.join(staffIds)})`}
      order by s.last_name, s.first_name, s.staff_id
    `.execute(transaction);
    return found.rows.map((row) => ({
      staffRecordId: row.id,
      staffId: row.staff_id,
      firstName: row.first_name,
      lastName: row.last_name,
      holdsKeyRole: row.eligible,
    }));
  }

  private async peopleOfKeys(
    transaction: Transaction,
    keyIds: readonly string[],
    now: Date,
  ): Promise<Map<string, IntegrationKeyPerson[]>> {
    const byKey = new Map<string, IntegrationKeyPerson[]>();
    if (keyIds.length === 0) {
      return byKey;
    }
    const links = await transaction
      .selectFrom('integration_key_people')
      .select(['key_id', 'staff_id'])
      .where('key_id', 'in', [...keyIds])
      .where('removed_at', 'is', null)
      .execute();
    const people = await this.people(
      transaction,
      [...new Set(links.map((link) => link.staff_id))],
      now,
    );
    for (const person of people) {
      for (const link of links) {
        if (link.staff_id.toLowerCase() === person.staffRecordId.toLowerCase()) {
          byKey.set(link.key_id, [...(byKey.get(link.key_id) ?? []), person]);
        }
      }
    }
    return byKey;
  }

  private async read(transaction: Transaction, keyId: string, now: Date): Promise<IntegrationKey> {
    const key = await transaction
      .selectFrom('integration_keys')
      .select(KEY_COLUMNS)
      .where('id', '=', keyId)
      .executeTakeFirstOrThrow();
    const people = await this.peopleOfKeys(transaction, [keyId], now);
    return this.answerOf(key, people.get(keyId) ?? [], now);
  }

  private answerOf(key: KeyRow, people: IntegrationKeyPerson[], now: Date): IntegrationKey {
    return {
      id: key.id,
      name: key.name,
      people,
      endsOn: key.ends_on,
      state: integrationKeyState(key, now),
      createdAt: key.created_at.toISOString(),
      revokedAt: key.revoked_at?.toISOString() ?? null,
      lastUsedAt: key.last_used_at?.toISOString() ?? null,
    };
  }
}
