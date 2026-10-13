import { Inject, Injectable } from '@nestjs/common';
import type { AuditAction, Clock } from '@sodiq/shared';
import { sql, type RawBuilder } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import type { Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';

export interface AuditEntry {
  /**
   * The branch the change belongs to, or `null` for an event of the whole
   * school (a sign-in, a relative, a Senior Head Teacher appointment). Required,
   * so nobody writes a school-wide entry by forgetting the branch.
   */
  branchId: string | null;
  /** The account that acted, or `null` for the system (a server command, a job). */
  actorId: string | null;
  /** The person the entry is about, when there is one. */
  personId?: string;
  /** The assignment that allowed the action (task 0.7b). */
  assignmentId?: string;
  /**
   * What happened, for example `branch.create`: one of `AUDIT_ACTIONS`, so
   * every action has a name on the Audit log page (task 2.6a). The tests of
   * the log itself write `test.*` actions, which no route writes.
   */
  action: AuditAction | `test.${string}`;
  /** The record that changed; left out for events without one (sign-in, export). */
  record?: { type: string; id: string };
  /**
   * Left out and `null` are stored alike, as "no value". To record that a field
   * was cleared, name the field: `{ phone: null }`.
   */
  oldValue?: JsonValue;
  newValue?: JsonValue;
  reason?: string;
  /** What is neither old nor new value, for example the filters and row count of an export. */
  details?: JsonValue;
  requestId?: string;
}

/** As text with a cast: the driver would send an array as a PostgreSQL array. */
function jsonb(value: JsonValue | undefined): RawBuilder<JsonValue> | null {
  return value === undefined || value === null
    ? null
    : sql<JsonValue>`${JSON.stringify(value)}::jsonb`;
}

/**
 * The audit log (docs/spec/13-technology.md, Security): who, when, old value,
 * new value. Append-only: the application user can insert and read, nothing else
 * (docs/spec/edge-cases/developer-rules.md, "History and audit").
 */
@Injectable()
export class Audit {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  /**
   * Writes one entry in the caller's transaction, together with the change it
   * describes: if the transaction rolls back, the entry is gone too. An entry
   * with a branch is refused unless the transaction works for that branch.
   */
  async record(transaction: Transaction, entry: AuditEntry): Promise<void> {
    const values = {
      occurred_at: this.clock.now(),
      actor_id: entry.actorId,
      person_id: entry.personId ?? null,
      assignment_id: entry.assignmentId ?? null,
      action: entry.action,
      record_type: entry.record?.type ?? null,
      record_id: entry.record?.id ?? null,
      old_value: jsonb(entry.oldValue),
      new_value: jsonb(entry.newValue),
      reason: entry.reason ?? null,
      details: jsonb(entry.details),
      request_id: entry.requestId ?? null,
    };
    if (entry.branchId === null) {
      await transaction.insertInto('audit_log_school').values(values).execute();
    } else {
      await transaction
        .insertInto('audit_log')
        .values({ ...values, branch_id: entry.branchId })
        .execute();
    }
  }
}
