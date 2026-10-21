import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import type { Audit } from '../audit/audit.service.js';

/** Who made the change, as its audit entry names them. */
interface Actor {
  readonly actorId: string;
  readonly assignmentId: string;
  readonly requestId: string;
}

/** What still holds a vacancy for a close from a day (`vacancy_close_holders`, 0099). */
export interface CloseHolder {
  readonly versionId: string | null;
  readonly versionNumber: number | null;
  readonly lessonDate: string | null;
}

/** `vacancy_close_holders` (0083, 0099, decision 6): drafts, published versions that run on or after the day, lessons from it. */
export async function closeHoldersOf(
  transaction: Transaction,
  vacancyId: string,
  branchId: string,
  from: string,
): Promise<CloseHolder[]> {
  const { rows } = await sql<{
    version_id: string | null;
    version_number: number | null;
    lesson_date: string | null;
  }>`select version_id, version_number, lesson_date::text as lesson_date
     from vacancy_close_holders(${vacancyId}::uuid, ${branchId}::uuid, ${from}::date)`.execute(
    transaction,
  );
  return rows.map((row) => ({
    versionId: row.version_id,
    versionNumber: row.version_number,
    lessonDate: row.lesson_date,
  }));
}

/**
 * Task 5.7a-3a (decision 5): after a fill, the vacancy is closed from the fill
 * date when nothing holds it from that day (`06`: "A vacancy with no load left
 * is closed"), as a stored status row: the open row in force on the day is
 * cut there and a closed row starts there, so the vacancy stays open while its
 * lessons before the day run ("State from stored moments", no job). Its
 * status rows are locked first; the deferred refusal of 0083 reads the
 * holders again at the commit.
 */
export async function closeFilled(
  transaction: Transaction,
  audit: Audit,
  input: Actor & { readonly branchId: string; readonly vacancyId: string; readonly from: string },
): Promise<{ readonly closed: boolean; readonly holders: CloseHolder[] }> {
  const statuses = await transaction
    .selectFrom('staff_statuses')
    .select(['id', 'status', 'valid_from', 'valid_until'])
    .where('staff_id', '=', input.vacancyId)
    .orderBy('valid_from')
    .orderBy('id')
    .forUpdate()
    .execute();
  const holders = await closeHoldersOf(transaction, input.vacancyId, input.branchId, input.from);
  if (holders.length > 0) return { closed: false, holders };
  const inForce = statuses.find(
    (row) =>
      row.valid_until !== row.valid_from &&
      row.valid_from <= input.from &&
      (row.valid_until === null || input.from < row.valid_until),
  );
  if (inForce === undefined || inForce.status !== 'open') {
    return { closed: inForce?.status === 'closed', holders };
  }
  await transaction
    .updateTable('staff_statuses')
    .set({ valid_until: input.from })
    .where('id', '=', inForce.id)
    .execute();
  await transaction
    .insertInto('staff_statuses')
    .values({
      staff_id: input.vacancyId,
      status: 'closed',
      valid_from: input.from,
      valid_until: inForce.valid_until,
    })
    .execute();
  await audit.record(transaction, {
    branchId: input.branchId,
    actorId: input.actorId,
    assignmentId: input.assignmentId,
    action: 'vacancy.close',
    record: { type: 'staff', id: input.vacancyId },
    oldValue: { status: 'open' },
    newValue: { status: 'closed', from: input.from, byFill: true },
    requestId: input.requestId,
  });
  return { closed: true, holders };
}

/**
 * Task 5.7a-3a (decision 7, spec review of the plan, should-fix 2): a withdraw
 * whose version that runs again names a vacancy closed from a day after
 * today, inside the run it gets back, reopens it from that day before the
 * lessons are written (the closed row emptied, an open row from its day), so
 * the earlier version's lessons are written under the open vacancy. The
 * vacancies reopened, by id.
 */
export async function reopenWithdrawn(
  transaction: Transaction,
  audit: Audit,
  input: Actor & {
    readonly branchId: string;
    readonly teacherIds: readonly string[];
    readonly firstDate: string;
    readonly lastDate: string;
    readonly today: string;
  },
): Promise<string[]> {
  if (input.teacherIds.length === 0) return [];
  const vacancies = await transaction
    .selectFrom('staff')
    .select('id')
    .where('id', 'in', [...new Set(input.teacherIds)])
    .where('kind', '=', 'vacancy')
    .orderBy('id')
    .execute();
  const reopened: string[] = [];
  for (const vacancy of vacancies) {
    const planned = await transaction
      .selectFrom('staff_statuses')
      .select(['id', 'valid_from', 'valid_until'])
      .where('staff_id', '=', vacancy.id)
      .where('status', '=', 'closed')
      .where('valid_from', '>', input.today)
      .where('valid_from', '>=', input.firstDate)
      .where('valid_from', '<=', input.lastDate)
      .where((builder) =>
        builder.or([
          builder('valid_until', 'is', null),
          builder('valid_until', '>', builder.ref('valid_from')),
        ]),
      )
      .forUpdate()
      .executeTakeFirst();
    if (planned === undefined) continue;
    await transaction
      .updateTable('staff_statuses')
      .set({ valid_until: planned.valid_from })
      .where('id', '=', planned.id)
      .execute();
    await transaction
      .insertInto('staff_statuses')
      .values({
        staff_id: vacancy.id,
        status: 'open',
        valid_from: planned.valid_from,
        valid_until: planned.valid_until,
      })
      .execute();
    await audit.record(transaction, {
      branchId: input.branchId,
      actorId: input.actorId,
      assignmentId: input.assignmentId,
      action: 'vacancy.reopen',
      record: { type: 'staff', id: vacancy.id },
      oldValue: { status: 'open', plannedClose: planned.valid_from },
      newValue: { status: 'open', from: planned.valid_from, byWithdraw: true },
      requestId: input.requestId,
    });
    reopened.push(vacancy.id);
  }
  return reopened;
}
