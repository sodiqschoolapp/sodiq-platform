import { setTimeout as delay } from 'node:timers/promises';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database } from '../database/database.js';
import { defineJob } from '../jobs/job-definition.js';
import { addBranchFilter } from './branch-filter-sql.js';

/** A job that exists only in tests: it carries the id of a scratch note. */
export const sampleJob = defineJob({
  name: 'sample.note',
  data: z.strictObject({ noteId: z.uuid() }),
});

export interface StoredJob {
  id: string;
  name: string;
  state: string;
  retry_count: number;
  data: unknown;
  output: unknown;
}

/** A branch table for the handlers of the tests to change. Run it as the migrator. */
export async function createScratchNotes(migrator: Database): Promise<void> {
  await sql`
    create table scratch_notes (
      id uuid primary key,
      branch_id uuid not null references branches (id),
      handled integer not null default 0
    )
  `.execute(migrator);
  await addBranchFilter(migrator, 'scratch_notes');
  await sql`grant select, insert, update on scratch_notes to sodiq_app`.execute(migrator);
}

/** How often each note was handled, read by the owner, who is not filtered. */
export async function handledCounts(migrator: Database): Promise<Record<string, number>> {
  const found = await sql<{ id: string; handled: number }>`
    select id, handled from scratch_notes
  `.execute(migrator);
  return Object.fromEntries(found.rows.map((row) => [row.id, row.handled]));
}

/** The jobs in the queue, read by the owner. */
export async function storedJobs(migrator: Database): Promise<StoredJob[]> {
  const found = await sql<StoredJob>`
    select id, name, state::text as state, retry_count, data, output
    from pgboss.job order by created_on
  `.execute(migrator);
  return found.rows;
}

/** Waits until the worker has brought a job into a state, for at most 20 seconds. */
export async function waitForJob(
  migrator: Database,
  id: string,
  state: string,
): Promise<StoredJob> {
  let last: StoredJob | undefined;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    last = (await storedJobs(migrator)).find((job) => job.id === id);
    if (last?.state === state) {
      return last;
    }
    await delay(250);
  }
  throw new Error(`The job did not reach "${state}"; it is "${last?.state ?? 'missing'}".`);
}
