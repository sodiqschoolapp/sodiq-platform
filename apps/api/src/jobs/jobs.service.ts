import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { fromKysely } from 'pg-boss';
import { branchFilterValue, type Transaction } from '../database/transactions.js';
import { envelopeSchema, type JobDefinition, type JobEnvelope } from './job-definition.js';
import { JobQueue } from './job-queue.js';
import { JOB_DEFINITIONS_LIST } from './jobs.tokens.js';

export interface NewJob<Data> {
  /** The branches the handler will work for; `[]` for work on school-wide tables only. */
  branchIds: readonly string[];
  data: Data;
}

/**
 * Background jobs (docs/spec/13-technology.md, Background jobs): a job is saved
 * in the same transaction as the data change that caused it, so it cannot be
 * lost. The job table is the outbox of
 * docs/spec/edge-cases/developer-rules.md, "Repeat-safe actions".
 */
@Injectable()
export class Jobs {
  constructor(
    private readonly queue: JobQueue,
    @Inject(JOB_DEFINITIONS_LIST) private readonly definitions: readonly JobDefinition<unknown>[],
  ) {}

  /**
   * Writes one job in the caller's transaction, together with the change that
   * causes it: if the transaction rolls back, the job is gone too, and the
   * worker cannot see it before the commit. The branches of the job must be
   * among those of the transaction. Returns the id of the job.
   */
  async enqueue<Data>(
    transaction: Transaction,
    definition: JobDefinition<Data>,
    job: NewJob<Data>,
  ): Promise<string> {
    if (!this.definitions.includes(definition)) {
      throw new Error(`The job "${definition.name}" is not in the list of job definitions.`);
    }
    // Checks every id, so nothing else reaches the handler's branch filter.
    branchFilterValue(job.branchIds);
    const checked = envelopeSchema(definition).safeParse({
      branchIds: [...job.branchIds],
      data: job.data,
    });
    if (!checked.success) {
      // The values are not repeated: they may be text that a caller sent.
      throw new Error(`The data of a "${definition.name}" job does not fit its definition.`);
    }
    // Safe: the schema's output is the envelope of this definition.
    const envelope = checked.data as JobEnvelope<Data>;
    // The handler will see the branches of the job. A transaction must not hand
    // on more than it works for itself, or a wrong list here would reach rows
    // that the branch filter keeps from the caller.
    const filter = await sql<{ ids: string[] }>`
      select app_branch_ids()::text[] as ids
    `.execute(transaction);
    const own = new Set(filter.rows[0]?.ids.map((id) => id.toLowerCase()));
    if (!envelope.branchIds.every((id) => own.has(id.toLowerCase()))) {
      throw new Error(
        `A "${definition.name}" job was given a branch that its transaction does not work for.`,
      );
    }
    const boss = await this.queue.ready();
    const id = await boss.send(definition.name, envelope, { db: fromKysely(transaction) });
    if (id === null) {
      throw new Error(`The job "${definition.name}" was not accepted by the queue.`);
    }
    return id;
  }
}
