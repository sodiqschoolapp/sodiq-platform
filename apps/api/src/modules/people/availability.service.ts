import { Inject, Injectable } from '@nestjs/common';
import {
  minutesOf,
  nextDay,
  previousDay,
  rangesOverlap,
  schoolDateOf,
  timeText,
  type Availability,
  type AvailabilityEntry,
  type AvailabilityRange,
  type AvailabilitySet,
  type Clock,
  type ErrorCode,
  type ErrorDetail,
  type SchoolDate,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { endFrom, isWithdrawn, scheduleFrom } from '../setup/dated-rows.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { markDraftsOutOfDate } from '../timetable/out-of-date.js';

/** The refusals of the database for availability (db/migrations/0025), by the name of the constraint. */
const AVAILABILITY_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  // The backstop of a write of another branch at the same moment; the
  // service's own check names the weekdays first (decision 6).
  staff_availability_ranges_no_overlap: 'availability_overlap',
  // The service keeps these first; a fault answers the general refusal.
  staff_availability_no_overlap: 'request_refused',
  dated_rows_only_shrink: 'request_refused',
};

/** The stored end of an open entry (db/migrations/0025); `null` in every answer. */
const OPEN = 'infinity';

const untilOf = (stored: string): SchoolDate | null => (stored === OPEN ? null : stored);

interface StoredEntry {
  id: string;
  validFrom: string;
  validUntil: string | null;
  ranges: AvailabilityRange[];
}

const rangeOf = (row: { weekday: number; start_minutes: number; end_minutes: number }) =>
  ({
    weekday: row.weekday,
    start: timeText(row.start_minutes),
    end: timeText(row.end_minutes),
  }) as AvailabilityRange;

const byWeekdayAndStart = (a: AvailabilityRange, b: AvailabilityRange) =>
  a.weekday - b.weekday || minutesOf(a.start) - minutesOf(b.start);

const entryAnswer = (entry: StoredEntry): AvailabilityEntry => ({
  id: entry.id,
  from: entry.validFrom,
  until: entry.validUntil,
  ranges: entry.ranges,
});

/** Whether two dated ranges share a date; an open end runs for good. */
const datesOverlap = (
  a: { validFrom: string; validUntil: string | null },
  b: { validFrom: string; validUntil: string | null },
): boolean =>
  !isWithdrawn(a) &&
  !isWithdrawn(b) &&
  (a.validUntil === null || b.validFrom < a.validUntil) &&
  (b.validUntil === null || a.validFrom < b.validUntil);

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('An availability route works for the branch of the request.');
  }
  return access.branchId;
}

/** The entries of one branch of a record, oldest first, with their ranges. */
async function entriesOf(
  transaction: Transaction,
  staffId: string,
  branchId: string,
  lock: boolean,
): Promise<StoredEntry[]> {
  let query = transaction
    .selectFrom('staff_availability')
    .select(['id', 'valid_from', 'valid_until'])
    .where('staff_id', '=', staffId)
    .where('branch_id', '=', branchId)
    .orderBy('valid_from')
    .orderBy('id');
  if (lock) {
    query = query.forUpdate();
  }
  const entries = await query.execute();
  const ranges =
    entries.length === 0
      ? []
      : await transaction
          .selectFrom('staff_availability_ranges')
          .select(['entry_id', 'weekday', 'start_minutes', 'end_minutes'])
          .where(
            'entry_id',
            'in',
            entries.map((entry) => entry.id),
          )
          .execute();
  return entries.map((entry) => ({
    id: entry.id,
    validFrom: entry.valid_from,
    validUntil: untilOf(entry.valid_until),
    ranges: ranges
      .filter((range) => range.entry_id === entry.id)
      .map(rangeOf)
      .sort(byWeekdayAndStart),
  }));
}

/**
 * Ends the hours of a record in a branch from a date: the entry in force on
 * it is cut there, later ones are withdrawn (decision 11 of pull request #57:
 * a branch removed from a person). Returns what changed, for the audit entry
 * of the caller; empty when nothing did.
 */
export async function endAvailability(
  transaction: Transaction,
  staffId: string,
  branchId: string,
  from: SchoolDate,
): Promise<{ id: string; validFrom: string; validUntil: string | null; ends: string }[]> {
  const ended = [];
  for (const entry of await entriesOf(transaction, staffId, branchId, true)) {
    const end = endFrom(entry, from);
    if (end === null) {
      continue;
    }
    await transaction
      .updateTable('staff_availability')
      .set({ valid_until: end })
      .where('id', '=', entry.id)
      .execute();
    ended.push({
      id: entry.id,
      validFrom: entry.validFrom,
      validUntil: entry.validUntil,
      ends: end,
    });
  }
  return ended;
}

/**
 * Availability of a staff record, a person or a vacancy, per branch (`04`,
 * Availability; `06`, Teachers who work in several branches; task 2.2b, pull
 * request #57). Every route works with the branch of the request only, also
 * for the Super Admin (decision 13): the other branches' hours come read only
 * from `staff_availability_elsewhere`. A record not linked to the branch of
 * the request is 404. Lock order: the record, then its entries.
 */
@Injectable()
export class StaffAvailability {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  read(access: Access, id: string): Promise<Availability> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      await this.linked(transaction, id, branchId, false);
      return this.answer(transaction, id, branchId);
    });
  }

  /**
   * A new entry from a date (decision 2): the entry in force on it is cut
   * there (one planned from that very date is withdrawn), and the new one
   * runs to where that one ran or to the next later entry (`scheduleFrom`).
   * Tomorrow at the earliest while an entry is in force today, else today
   * (decision 4). Hours that overlap another branch's on a date are refused
   * with the weekdays (decision 6).
   */
  set(
    access: Access,
    id: string,
    input: AvailabilitySet,
    requestId: string,
  ): Promise<Availability> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const kind = await this.linked(transaction, id, branchId, true);
          const entries = await entriesOf(transaction, id, branchId, true);
          const today = await this.todayIn(transaction, branchId);
          if (input.from < earliestFrom(entries, today)) {
            throw new ApiException('date_not_in_future', 409);
          }
          const schedule = scheduleFrom(entries, input.from);
          const ranges = [...input.ranges].sort(byWeekdayAndStart);
          await this.refuseOverlap(transaction, id, {
            validFrom: schedule.validFrom,
            validUntil: schedule.validUntil,
            ranges,
          });
          if (schedule.cut !== null) {
            await transaction
              .updateTable('staff_availability')
              .set({ valid_until: schedule.cut.validUntil })
              .where('id', '=', schedule.cut.id)
              .execute();
          }
          const entry = await transaction
            .insertInto('staff_availability')
            .values({
              branch_id: branchId,
              staff_id: id,
              valid_from: schedule.validFrom,
              valid_until: schedule.validUntil ?? OPEN,
            })
            .returning(['id', 'valid_until'])
            .executeTakeFirstOrThrow();
          for (const range of ranges) {
            await transaction
              .insertInto('staff_availability_ranges')
              .values({
                entry_id: entry.id,
                branch_id: branchId,
                staff_id: id,
                weekday: range.weekday,
                start_minutes: minutesOf(range.start),
                end_minutes: minutesOf(range.end),
                valid_from: schedule.validFrom,
                valid_until: entry.valid_until,
              })
              .execute();
          }
          const cut = entries.find((old) => old.id === schedule.cut?.id);
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            ...(kind === 'person' ? { personId: id } : {}),
            action: 'staff.availability_set',
            record: { type: 'staff', id },
            oldValue: {
              cut:
                cut === undefined
                  ? null
                  : { ...entryAnswer(cut), cutAt: schedule.cut?.validUntil ?? null },
            },
            newValue: entryAnswer({
              id: entry.id,
              validFrom: schedule.validFrom,
              validUntil: schedule.validUntil,
              ranges,
            }),
            requestId,
          });
          // Task 5.5a-3b-1, decisions 2 and 3: the drafts of the branch in the
          // years the new entry's dates touch.
          await markDraftsOutOfDate(transaction, this.audit, {
            branchId,
            action: 'staff.availability_set',
            recordId: id,
            dates: [
              {
                from: schedule.validFrom,
                until: schedule.validUntil === null ? null : previousDay(schedule.validUntil),
              },
            ],
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            requestId,
          });
          return this.answer(transaction, id, branchId);
        }),
      AVAILABILITY_REFUSALS,
    );
  }

  // ---------------------------------------------------------------------------

  /** The kind of a record linked to the branch of the request, locked with its link when asked; 404 otherwise. */
  private async linked(
    transaction: Transaction,
    id: string,
    branchId: string,
    lock: boolean,
  ): Promise<string> {
    let query = transaction
      .selectFrom('staff')
      .select('kind')
      .where('id', '=', id)
      .where((builder) =>
        builder.exists(
          builder
            .selectFrom('staff_branches')
            .select('staff_branches.staff_id')
            .whereRef('staff_branches.staff_id', '=', 'staff.id')
            .where('staff_branches.branch_id', '=', branchId),
        ),
      );
    if (lock) {
      query = query.forUpdate();
    }
    const row = await query.executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    if (lock) {
      // The link read again after the lock, in a statement of its own: the
      // statement that waited for the record kept the snapshot of before the
      // wait, and a removal of the branch (the branches route, which locks the
      // record first) does not update the record, so nothing re-checks it
      // (the spec review of the build, must-fix 1). FOR SHARE keeps the link
      // until this write commits.
      const link = await transaction
        .selectFrom('staff_branches')
        .select('staff_id')
        .where('staff_id', '=', id)
        .where('branch_id', '=', branchId)
        .forShare()
        .executeTakeFirst();
      if (link === undefined) {
        throw notFound();
      }
    }
    return row.kind;
  }

  private async todayIn(transaction: Transaction, branchId: string): Promise<SchoolDate> {
    const branch = await transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    return schoolDateOf(this.clock.now(), branch.time_zone);
  }

  /** The other branches' entries, read only, grouped by branch with its name. */
  private async elsewhere(
    transaction: Transaction,
    id: string,
  ): Promise<{ branchId: string; name: string; entries: StoredEntry[] }[]> {
    const rows = (
      await sql<{
        entry_id: string;
        branch_id: string;
        valid_from: string;
        valid_until: string;
        weekday: number | null;
        start_minutes: number | null;
        end_minutes: number | null;
      }>`select * from staff_availability_elsewhere(${id}::uuid)`.execute(transaction)
    ).rows;
    if (rows.length === 0) {
      return [];
    }
    const branchIds = [...new Set(rows.map((row) => row.branch_id))];
    const branches = await transaction
      .selectFrom('branches')
      .select(['id', 'name'])
      .where('id', 'in', branchIds)
      .orderBy('name')
      .orderBy('id')
      .execute();
    return branches.map((branch) => {
      const own = rows.filter((row) => row.branch_id === branch.id);
      const ids = [...new Set(own.map((row) => row.entry_id))];
      const entries = ids
        .map((entryId) => {
          const entryRows = own.filter((row) => row.entry_id === entryId);
          const first = entryRows[0];
          return {
            id: entryId,
            validFrom: first?.valid_from ?? '',
            validUntil: untilOf(first?.valid_until ?? OPEN),
            ranges: entryRows
              .flatMap((row) =>
                row.weekday === null || row.start_minutes === null || row.end_minutes === null
                  ? []
                  : [
                      rangeOf({
                        weekday: row.weekday,
                        start_minutes: row.start_minutes,
                        end_minutes: row.end_minutes,
                      }),
                    ],
              )
              .sort(byWeekdayAndStart),
          };
        })
        .sort((a, b) => a.validFrom.localeCompare(b.validFrom) || a.id.localeCompare(b.id));
      return { branchId: branch.id, name: branch.name, entries };
    });
  }

  /**
   * 06: "Hours in two branches cannot overlap on any date." The weekdays on
   * which the new entry meets an entry of another branch, named in `details`
   * without the other branch's times (decision 6). The exclusion constraint
   * of 0025 refuses the same as a backstop.
   */
  private async refuseOverlap(
    transaction: Transaction,
    id: string,
    entry: { validFrom: string; validUntil: string | null; ranges: AvailabilityRange[] },
  ): Promise<void> {
    const weekdays = new Set<number>();
    for (const branch of await this.elsewhere(transaction, id)) {
      for (const other of branch.entries.filter((one) => datesOverlap(one, entry))) {
        for (const range of entry.ranges) {
          if (other.ranges.some((theirs) => rangesOverlap(theirs, range))) {
            weekdays.add(range.weekday);
          }
        }
      }
    }
    if (weekdays.size === 0) {
      return;
    }
    const details: ErrorDetail[] = [...weekdays]
      .sort((a, b) => a - b)
      .map((weekday) => ({
        path: `weekday.${String(weekday)}`,
        code: 'overlap',
        message: 'Hours of another branch overlap on this weekday.',
      }));
    throw new ApiException('availability_overlap', 409, undefined, details);
  }

  private async answer(
    transaction: Transaction,
    id: string,
    branchId: string,
  ): Promise<Availability> {
    const entries = await entriesOf(transaction, id, branchId, false);
    const today = await this.todayIn(transaction, branchId);
    return {
      entries: entries.map(entryAnswer),
      elsewhere: (await this.elsewhere(transaction, id)).map((branch) => ({
        branchId: branch.branchId,
        name: branch.name,
        entries: branch.entries.map(entryAnswer),
      })),
      today,
      earliestFrom: earliestFrom(entries, today),
    };
  }
}

/**
 * Decision 4: tomorrow at the earliest while an entry of the branch is in
 * force today, so that today's hours stay as they applied; today when none is.
 */
function earliestFrom(entries: readonly StoredEntry[], today: SchoolDate): SchoolDate {
  const inForceToday = entries.some((entry) =>
    datesOverlap(entry, { validFrom: today, validUntil: nextDay(today) }),
  );
  return inForceToday ? nextDay(today) : today;
}
