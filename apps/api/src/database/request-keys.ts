import { createHash } from 'node:crypto';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../clock/clock.module.js';
import { BRANCH_SETTING, type Transaction } from './transactions.js';
import type { JsonValue } from './types.generated.js';

export interface KeyedRequest {
  /** The key the caller sent (`@RequestKey()`): a uuid made once per action, repeated on a retry. */
  key: string;
  /** The action, for example `timetable.publish`. A key belongs to one action. */
  scope: string;
  /**
   * Everything that decides what the action does: every path parameter and the
   * body. The branches of the transaction are added by `runOnce` itself.
   */
  input: JsonValue;
}

export interface RunOnceResult<T> {
  /** True when the key was seen before: `work` did not run and `result` is the stored answer. */
  repeated: boolean;
  result: T;
}

/** The same text for the same content, whatever the order of the fields. */
export function canonicalJson(value: JsonValue | undefined): string {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const fields = Object.keys(value)
    .filter((name) => value[name] !== undefined)
    .sort()
    .map((name) => `${JSON.stringify(name)}:${canonicalJson(value[name])}`);
  return `{${fields.join(',')}}`;
}

function hashOf(input: JsonValue): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

/**
 * Repeat-safe actions (docs/spec/edge-cases/developer-rules.md): publish, close
 * and every offline entry carry a key that makes a repeat harmless.
 */
@Injectable()
export class RequestKeys {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  /**
   * Runs `work` unless this key was already used. The key is written in the
   * caller's transaction, together with whatever `work` changes: if `work`
   * throws or the transaction rolls back, the key is gone too and the request
   * can be tried again. A repeat gets the stored answer and changes nothing.
   *
   * Check permission and scope before calling this, on every request: a repeat
   * does not run `work`, so a check inside `work` would be skipped.
   *
   * The answer is stored, so it holds ids and status only, never personal data.
   * The same key for another action or with other input is refused (409).
   */
  async runOnce<T extends JsonValue>(
    transaction: Transaction,
    request: KeyedRequest,
    work: () => Promise<T>,
  ): Promise<RunOnceResult<T>> {
    // The hash also covers the branches of the transaction: the same key and
    // input sent for another branch is another request, whatever `input` holds.
    const requestHash = sql<string>`encode(sha256(convert_to(
      ${hashOf(request.input)}::text || coalesce(current_setting(${BRANCH_SETTING}, true), ''),
      'UTF8'
    )), 'hex')`;
    // If `work` fails, the key and whatever `work` changed are undone together,
    // also when the caller catches the error and commits the rest.
    await sql`savepoint request_key`.execute(transaction);
    // The primary key is the guard. A second request with the same key waits
    // here until the first one commits or rolls back.
    const claimed = await transaction
      .insertInto('request_keys')
      .values({
        key: request.key,
        scope: request.scope,
        request_hash: requestHash,
        created_at: this.clock.now(),
      })
      .onConflict((conflict) => conflict.column('key').doNothing())
      .returning('key')
      .executeTakeFirst();

    if (claimed === undefined) {
      await sql`release savepoint request_key`.execute(transaction);
      const stored = await transaction
        .selectFrom('request_keys')
        .select([
          'scope',
          'result',
          sql<boolean>`request_hash = ${requestHash}`.as('same_input'),
          // A stored JSON null is an answer; no value at all means "not finished".
          sql<boolean>`result is null`.as('unfinished'),
        ])
        .where('key', '=', request.key)
        .executeTakeFirst();
      if (stored === undefined) {
        // Only possible in a transaction that cannot see what was committed
        // after it began (repeatable read or stricter).
        throw new Error('A request key is taken but not visible to this transaction.');
      }
      if (stored.scope !== request.scope || !stored.same_input) {
        throw new ConflictException('The request key was already used for another request.');
      }
      if (stored.unfinished) {
        // Only this transaction can see an unfinished key: the key is being
        // used again from inside its own work.
        throw new Error('A request key was used again before its work finished.');
      }
      // Safe: it is what `work` returned for this same action and input.
      return { repeated: true, result: stored.result as T };
    }

    let result: T;
    try {
      result = await work();
      await transaction
        .updateTable('request_keys')
        // As text with a cast: the driver would send an array as a PostgreSQL array.
        .set({ result: sql<JsonValue>`${JSON.stringify(result)}::jsonb` })
        .where('key', '=', request.key)
        .execute();
    } catch (error) {
      // If this fails too, the transaction is lost anyway; the first error is the one to report.
      await sql`rollback to savepoint request_key`.execute(transaction).catch(() => undefined);
      throw error;
    }
    await sql`release savepoint request_key`.execute(transaction);
    return { repeated: false, result };
  }
}
