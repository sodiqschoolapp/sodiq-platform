import { createHash } from 'node:crypto';
import {
  listName,
  OUT_OF_DATE_ACTIONS,
  outOfDateActionSchema,
  type OutOfDateAction,
  type OutOfDateCause,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import type { Audit } from '../audit/audit.service.js';

/**
 * Out-of-date drafts (task 5.5a-3b-1, pull request #146).
 *
 * docs/spec/06-timetable.md, How surprises are prevented: "Out-of-date draft.
 * If the live timetable changed after a draft was started, the draft must be
 * brought up to date before publishing; the differences are shown."
 * docs/spec/edge-cases/timetable.md, Versions and drafts: "Any publish, or any
 * change to templates, calendar, availability or rooms, marks the other drafts
 * out of date."
 *
 * Decision 7: a draft is out of date while it has a cause
 * (`timetable_version_out_of_date_causes`, 0077); readers count the causes of
 * drafts only. Decision 8: marking locks nothing; its only locks are the
 * `for key share` of a cause's foreign keys, which the `for no key update` of
 * a draft write does not block.
 */

/** Whether a version is a draft with a cause, as a column of a select from `timetable_versions`. */
export const outOfDateColumn = sql<boolean>`(
  timetable_versions.status = 'draft' and exists (
    select 1 from timetable_version_out_of_date_causes c
    where c.version_id = timetable_versions.id
  )
)`.as('out_of_date');

/** School dates a change touches: from a date, until a date or open. */
export interface TouchedDates {
  readonly from: string;
  readonly until: string | null;
}

/** Who made the change, as its own audit entry names them. */
export interface MarkActor {
  readonly actorId: string | null;
  readonly assignmentId?: string;
  readonly requestId?: string;
}

/** A change that marks drafts (decision 2) and the dates it touches (decision 3). */
export interface OutOfDateChange extends MarkActor {
  readonly branchId: string;
  readonly action: Exclude<
    OutOfDateAction,
    'timetable_version.publish' | 'timetable_version.withdraw'
  >;
  readonly recordId: string;
  /** `every_year`: every year of the branch that is not closed. */
  readonly dates: readonly TouchedDates[] | 'every_year';
}

/** The causes added to the drafts named, each with its audit entry. */
async function addCauses(
  transaction: Transaction,
  audit: Audit,
  drafts: readonly { id: string; out_of_date: boolean }[],
  cause: MarkActor & {
    branchId: string;
    action: OutOfDateAction;
    recordId: string | null;
    details?: Record<string, string | number>;
  },
): Promise<void> {
  if (drafts.length === 0) return;
  const moment = await transactionMoment(transaction);
  await transaction
    .insertInto('timetable_version_out_of_date_causes')
    .values(
      drafts.map((draft) => ({
        branch_id: cause.branchId,
        version_id: draft.id,
        action: cause.action,
        record_id: cause.recordId,
        caused_at: moment,
      })),
    )
    .execute();
  for (const draft of drafts) {
    await audit.record(transaction, {
      branchId: cause.branchId,
      actorId: cause.actorId,
      ...(cause.assignmentId === undefined ? {} : { assignmentId: cause.assignmentId }),
      action: 'timetable_version.out_of_date',
      record: { type: 'timetable_version', id: draft.id },
      oldValue: { outOfDate: draft.out_of_date },
      newValue: {
        outOfDate: true,
        action: cause.action,
        recordId: cause.recordId,
        ...cause.details,
      },
      ...(cause.requestId === undefined ? {} : { requestId: cause.requestId }),
    });
  }
}

/**
 * Marks the drafts of the change's branch, in the years that are not closed
 * and that the change touches, out of date, in the change's transaction
 * (decisions 2 and 3). Locks nothing (decision 8).
 */
export async function markDraftsOutOfDate(
  transaction: Transaction,
  audit: Audit,
  change: OutOfDateChange,
): Promise<void> {
  const dates = change.dates;
  if (dates !== 'every_year' && dates.length === 0) return;
  const drafts = await transaction
    .selectFrom('timetable_versions')
    .innerJoin('academic_years', 'academic_years.id', 'timetable_versions.academic_year_id')
    .select(['timetable_versions.id', outOfDateColumn])
    .where('timetable_versions.branch_id', '=', change.branchId)
    .where('timetable_versions.status', '=', 'draft')
    .where('academic_years.status', '<>', 'closed')
    .$if(dates !== 'every_year', (builder) =>
      builder.where((where) =>
        where.or(
          (dates === 'every_year' ? [] : dates).map((one) =>
            where.and([
              where('academic_years.end_date', '>=', one.from),
              ...(one.until === null ? [] : [where('academic_years.start_date', '<=', one.until)]),
            ]),
          ),
        ),
      ),
    )
    .orderBy('timetable_versions.id')
    .execute();
  await addCauses(transaction, audit, drafts, {
    branchId: change.branchId,
    action: change.action,
    recordId: change.recordId,
    actorId: change.actorId,
    ...(change.assignmentId === undefined ? {} : { assignmentId: change.assignmentId }),
    ...(change.requestId === undefined ? {} : { requestId: change.requestId }),
  });
}

/** A publish's cause on the drafts it marks (5.5a-1 decision 4, decision 7). */
export function markPublished(
  transaction: Transaction,
  audit: Audit,
  drafts: readonly { id: string; out_of_date: boolean }[],
  published: MarkActor & { branchId: string; id: string; number: number },
): Promise<void> {
  return addCauses(transaction, audit, drafts, {
    branchId: published.branchId,
    action: 'timetable_version.publish',
    recordId: published.id,
    details: { publishedId: published.id, publishedNumber: published.number },
    actorId: published.actorId,
    ...(published.assignmentId === undefined ? {} : { assignmentId: published.assignmentId }),
    ...(published.requestId === undefined ? {} : { requestId: published.requestId }),
  });
}

/**
 * A withdraw's cause on every draft of its branch and year (task 5.5c-2a,
 * decision 6), a draft that started from the withdrawn version included.
 */
export function markWithdrawn(
  transaction: Transaction,
  audit: Audit,
  drafts: readonly { id: string; out_of_date: boolean }[],
  withdrawn: MarkActor & { branchId: string; id: string; number: number },
): Promise<void> {
  return addCauses(transaction, audit, drafts, {
    branchId: withdrawn.branchId,
    action: 'timetable_version.withdraw',
    recordId: withdrawn.id,
    details: { withdrawnId: withdrawn.id, withdrawnNumber: withdrawn.number },
    actorId: withdrawn.actorId,
    ...(withdrawn.assignmentId === undefined ? {} : { assignmentId: withdrawn.assignmentId }),
    ...(withdrawn.requestId === undefined ? {} : { requestId: withdrawn.requestId }),
  });
}

/**
 * A copy takes the causes of its source when the source is a draft (5.5a-1
 * decision 14; review correction 2: a published source is read as up to date).
 */
export async function copyCauses(
  transaction: Transaction,
  branchId: string,
  source: { id: string; status: string },
  copyId: string,
): Promise<number> {
  if (source.status !== 'draft') return 0;
  const causes = await storedCauses(transaction, source.id);
  if (causes.length === 0) return 0;
  await transaction
    .insertInto('timetable_version_out_of_date_causes')
    .values(
      causes.map((one) => ({
        branch_id: branchId,
        version_id: copyId,
        action: one.action,
        record_id: one.record_id,
        caused_at: one.caused_at,
      })),
    )
    .execute();
  return causes.length;
}

/** A stored cause. */
export interface StoredCause {
  id: string;
  action: string;
  record_id: string | null;
  caused_at: Date;
}

/** The causes of a version, oldest first. */
export function storedCauses(transaction: Transaction, versionId: string): Promise<StoredCause[]> {
  return transaction
    .selectFrom('timetable_version_out_of_date_causes')
    .select(['id', 'action', 'record_id', 'caused_at'])
    .where('version_id', '=', versionId)
    .orderBy('caused_at')
    .orderBy('id')
    .execute();
}

/** The key of the causes shown: the SHA-256 of the version and the cause ids, as `laterKeyOf`. */
export function causesKey(versionId: string, causes: readonly { id: string }[]): string {
  return createHash('sha256')
    .update(JSON.stringify({ versionId, causes: causes.map((one) => one.id) }))
    .digest('hex');
}

/**
 * Whether a stored action changed the published chain: a publish (decision
 * 5), or a withdraw (task 5.5c-2a, decision 6), brought up to date the same way.
 */
export const isPublishCause = (cause: { action: string }): boolean =>
  cause.action === 'timetable_version.publish' || cause.action === 'timetable_version.withdraw';

type CauseRecord = NonNullable<OutOfDateCause['record']>;

const named = (id: string, name: string | null): CauseRecord => ({
  id,
  name,
  firstDate: null,
  lastDate: null,
  versionNumber: null,
});

/** The records the causes name, read by kind; a record that cannot be read is left out. */
async function recordsOf(
  transaction: Transaction,
  causes: readonly StoredCause[],
): Promise<Map<string, CauseRecord>> {
  const idsOf = (kinds: readonly string[]) => [
    ...new Set(
      causes.flatMap((one) =>
        one.record_id !== null && kinds.includes(kindOf(one.action)) ? [one.record_id] : [],
      ),
    ),
  ];
  const assignmentIds = [
    ...new Set(
      causes.flatMap((one) =>
        one.record_id !== null && one.action.startsWith('day_template_assignment.')
          ? [one.record_id]
          : [],
      ),
    ),
  ];
  const templateIds = [
    ...new Set(
      causes.flatMap((one) =>
        one.record_id !== null && one.action === 'day_template.version_create'
          ? [one.record_id]
          : [],
      ),
    ),
  ];
  const slotTypeIds = [
    ...new Set(
      causes.flatMap((one) =>
        one.record_id !== null && one.action === 'slot_type.length_change' ? [one.record_id] : [],
      ),
    ),
  ];
  const found = new Map<string, CauseRecord>();
  const calendar = idsOf(['calendar']);
  if (calendar.length > 0) {
    const rows = await transaction
      .selectFrom('calendar_entries')
      .select([
        'id',
        'name',
        sql<string>`first_date::text`.as('first_date'),
        sql<string>`last_date::text`.as('last_date'),
      ])
      .where('id', 'in', calendar)
      .execute();
    for (const row of rows) {
      found.set(row.id, {
        ...named(row.id, row.name),
        firstDate: row.first_date,
        lastDate: row.last_date,
      });
    }
  }
  if (slotTypeIds.length > 0) {
    const rows = await transaction
      .selectFrom('slot_types')
      .select(['id', 'name'])
      .where('id', 'in', slotTypeIds)
      .execute();
    for (const row of rows) found.set(row.id, named(row.id, row.name));
  }
  if (templateIds.length > 0) {
    const rows = await transaction
      .selectFrom('day_templates')
      .select(['id', 'name'])
      .where('id', 'in', templateIds)
      .execute();
    for (const row of rows) found.set(row.id, named(row.id, row.name));
  }
  if (assignmentIds.length > 0) {
    const rows = await transaction
      .selectFrom('day_template_assignments')
      .innerJoin('day_templates', 'day_templates.id', 'day_template_assignments.day_template_id')
      .select(['day_template_assignments.id', 'day_templates.name'])
      .where('day_template_assignments.id', 'in', assignmentIds)
      .execute();
    for (const row of rows) found.set(row.id, named(row.id, row.name));
  }
  const staff = idsOf(['availability']);
  if (staff.length > 0) {
    const rows = await transaction
      .selectFrom('staff')
      .select(['id', 'kind', 'first_name', 'last_name', 'vacancy_name'])
      .where('id', 'in', staff)
      .execute();
    for (const row of rows) {
      found.set(
        row.id,
        named(
          row.id,
          row.kind === 'vacancy'
            ? (row.vacancy_name ?? '')
            : listName({ firstName: row.first_name ?? '', lastName: row.last_name ?? '' }),
        ),
      );
    }
  }
  const rooms = idsOf(['rooms']);
  if (rooms.length > 0) {
    const rows = await transaction
      .selectFrom('rooms')
      .select(['id', 'name'])
      .where('id', 'in', rooms)
      .execute();
    for (const row of rows) found.set(row.id, named(row.id, row.name));
  }
  const versions = idsOf(['publish', 'withdraw']);
  if (versions.length > 0) {
    const rows = await transaction
      .selectFrom('timetable_versions')
      .select(['id', 'number'])
      .where('id', 'in', versions)
      .execute();
    for (const row of rows)
      found.set(row.id, { ...named(row.id, null), versionNumber: row.number });
  }
  return found;
}

/** The kind of cause of a stored action. */
export const kindOf = (action: string) => OUT_OF_DATE_ACTIONS[outOfDateActionSchema.parse(action)];

/** The causes as the answer lists them (spec review should-fix 9: a record gone is `null`). */
export async function causeAnswers(
  transaction: Transaction,
  causes: readonly StoredCause[],
): Promise<OutOfDateCause[]> {
  const records = await recordsOf(transaction, causes);
  return causes.map((one) => {
    const action = outOfDateActionSchema.parse(one.action);
    return {
      id: one.id,
      kind: OUT_OF_DATE_ACTIONS[action],
      action,
      causedAt: one.caused_at.toISOString(),
      record: one.record_id === null ? null : (records.get(one.record_id) ?? null),
    };
  });
}
