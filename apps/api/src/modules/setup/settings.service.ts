import { Inject, Injectable } from '@nestjs/common';
import {
  academicYearName,
  schoolDateOf,
  type AttendanceValuesList,
  type AttendanceValuesRecord,
  type BranchSettings,
  type ChecklistItem,
  type Clock,
  type EarlyWarningRecord,
  type EditDaysRecord,
  type QuarterAttendanceValues,
  type SetupChecklist,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { Audit } from '../audit/audit.service.js';
import type { Access } from '../access/permission.guard.js';
import { SETTINGS_COLUMNS, toSettings, type SettingsRow } from './settings-state.js';
import { changesOf, notFound, refusingConstraints } from './setup-refusals.js';

/** The fields of the settings row a route changes, in its stored names. */
type SettingsChange = Partial<SettingsRow>;

const QUARTER_COLUMNS = [
  'id',
  'academic_year_id',
  'number',
  'start_date',
  'end_date',
  'late_value',
  'skipped_value',
] as const;

interface QuarterRow {
  id: string;
  academic_year_id: string;
  number: number;
  start_date: string | null;
  end_date: string | null;
  late_value: number;
  skipped_value: number;
}

const toQuarter = (row: QuarterRow): QuarterAttendanceValues => ({
  id: row.id,
  number: row.number,
  startDate: row.start_date,
  endDate: row.end_date,
  lateValue: row.late_value,
  skippedValue: row.skipped_value,
});

const valuesOf = (row: QuarterRow): AttendanceValuesRecord => ({
  lateValue: row.late_value,
  skippedValue: row.skipped_value,
});

/**
 * The settings of a branch and its setup checklist (task 1.6; the owner's
 * answers 19 to 24; the plan approved on pull request #49). Every read and
 * write works for the branch of the request; every write takes the branch row
 * `for update` first, as the other setup writes do, and writes its audit entry
 * in the same transaction. A save that changes nothing writes nothing.
 */
@Injectable()
export class Settings {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The branch row, taken for update by a write; 404 when it is not there. */
  private async branchOf(
    transaction: Transaction,
    branchId: string,
    lock: boolean,
  ): Promise<{ time_zone: string; working_weekdays: number[] }> {
    const query = transaction
      .selectFrom('branches')
      .select(['time_zone', 'working_weekdays'])
      .where('id', '=', branchId);
    const branch = await (lock ? query.forUpdate() : query).executeTakeFirst();
    if (branch === undefined) {
      throw notFound();
    }
    return branch;
  }

  private async settingsIn(transaction: Transaction, branchId: string): Promise<SettingsRow> {
    const row = await transaction
      .selectFrom('branch_settings')
      .select(SETTINGS_COLUMNS)
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (row === undefined) {
      // Every branch has its row (decision 8): the migration and the branch create write it.
      throw new Error('The branch has no settings row.');
    }
    return row;
  }

  read(access: Access, branchId: string): Promise<BranchSettings> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      await this.branchOf(transaction, branchId, false);
      return toSettings(await this.settingsIn(transaction, branchId));
    });
  }

  /** `07`, Editing rules and locks: the edit days (decision 1: a plain value). */
  setEditDays(
    access: Access,
    branchId: string,
    record: EditDaysRecord,
    requestId: string,
  ): Promise<BranchSettings> {
    return this.change(
      access,
      branchId,
      { edit_days: record.editDays },
      'settings.edit_days',
      requestId,
    );
  }

  /** `08`, Early-warning list: the four thresholds (decision 2). */
  setEarlyWarning(
    access: Access,
    branchId: string,
    record: EarlyWarningRecord,
    requestId: string,
  ): Promise<BranchSettings> {
    return this.change(
      access,
      branchId,
      {
        low_result: record.lowResult,
        result_drop: record.resultDrop,
        attendance_percent: record.attendancePercent,
        absences_in_row: record.absencesInRow,
      },
      'settings.early_warning',
      requestId,
    );
  }

  private change(
    access: Access,
    branchId: string,
    values: SettingsChange,
    action: string,
    requestId: string,
  ): Promise<BranchSettings> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      await this.branchOf(transaction, branchId, true);
      const stored = await this.settingsIn(transaction, branchId);
      const before = toSettings(stored);
      const after = toSettings({ ...stored, ...values });
      const changes = changesOf(before, after);
      if (changes === null) {
        return before;
      }
      const row = await transaction
        .updateTable('branch_settings')
        .set(values)
        .where('branch_id', '=', branchId)
        .returning(SETTINGS_COLUMNS)
        .executeTakeFirstOrThrow();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action,
        record: { type: 'branch_settings', id: branchId },
        oldValue: changes.oldValue,
        newValue: changes.newValue,
        requestId,
      });
      return toSettings(row);
    });
  }

  /** The planned and current years of the branch, oldest first (decision 6). */
  private async openYears(
    transaction: Transaction,
  ): Promise<{ id: string; start_date: string; end_date: string; status: string }[]> {
    return transaction
      .selectFrom('academic_years')
      .select(['id', 'start_date', 'end_date', 'status'])
      .where('status', 'in', ['planned', 'current'])
      .orderBy('start_date')
      .orderBy('id')
      .execute();
  }

  /** Answer 20: late and skipped of every quarter of the planned and current years. */
  listAttendanceValues(access: Access, branchId: string): Promise<AttendanceValuesList> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      await this.branchOf(transaction, branchId, false);
      const years = await this.openYears(transaction);
      if (years.length === 0) {
        return { years: [] };
      }
      const quarters = await transaction
        .selectFrom('quarters')
        .select(QUARTER_COLUMNS)
        .where(
          'academic_year_id',
          'in',
          years.map((year) => year.id),
        )
        .orderBy('number')
        .execute();
      return {
        years: years.map((year) => ({
          id: year.id,
          name: academicYearName(year.start_date, year.end_date),
          status: year.status as 'planned' | 'current',
          quarters: quarters
            .filter((quarter) => quarter.academic_year_id === year.id)
            .map(toQuarter),
        })),
      };
    });
  }

  /**
   * Answer 20: late and skipped of one quarter. A quarter of a closed year is
   * refused by `quarters_closed_year_guard` (`year_closed`, decision 3); an id
   * of another branch or an unknown one is 404.
   */
  setAttendanceValues(
    access: Access,
    branchId: string,
    quarterId: string,
    record: AttendanceValuesRecord,
    requestId: string,
  ): Promise<QuarterAttendanceValues> {
    return refusingConstraints(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        await this.branchOf(transaction, branchId, true);
        const quarter = await transaction
          .selectFrom('quarters')
          .select(QUARTER_COLUMNS)
          .where('id', '=', quarterId)
          .where('branch_id', '=', branchId)
          .forUpdate()
          .executeTakeFirst();
        if (quarter === undefined) {
          throw notFound();
        }
        const changes = changesOf(valuesOf(quarter), record);
        if (changes === null) {
          return toQuarter(quarter);
        }
        const row = await transaction
          .updateTable('quarters')
          .set({ late_value: record.lateValue, skipped_value: record.skippedValue })
          .where('id', '=', quarterId)
          .returning(QUARTER_COLUMNS)
          .executeTakeFirstOrThrow();
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'quarter.attendance_values',
          record: { type: 'quarter', id: quarterId },
          oldValue: changes.oldValue,
          newValue: changes.newValue,
          requestId,
        });
        return toQuarter(row);
      }),
    );
  }

  /**
   * `edge/academic-year`: "Each branch has a setup checklist in a fixed
   * order". The Phase 1 items of answer 23, each read from what is stored;
   * today is the branch's, from the injected clock.
   */
  checklist(access: Access, branchId: string): Promise<SetupChecklist> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const branch = await this.branchOf(transaction, branchId, false);
      const today = schoolDateOf(this.clock.now(), branch.time_zone);
      const years = await this.openYears(transaction);
      const yearIds = years.map((year) => year.id);

      const [rooms, departments, slotTypes, defaults, quarters, entries, subjects] =
        await Promise.all([
          // Rooms are never archived; one in use on an active floor of an active building.
          transaction
            .selectFrom('rooms')
            .innerJoin('floors', 'floors.id', 'rooms.floor_id')
            .innerJoin('buildings', 'buildings.id', 'floors.building_id')
            .select(sql<number>`count(*)::int`.as('count'))
            .where('rooms.status', '=', 'in_use')
            .where('floors.archived_at', 'is', null)
            .where('buildings.archived_at', 'is', null)
            .executeTakeFirstOrThrow(),
          // School-wide (answer 23, "shown as 'whole school'").
          transaction
            .selectFrom('departments')
            .innerJoin('divisions', 'divisions.id', 'departments.division_id')
            .select(sql<number>`count(*)::int`.as('count'))
            .where('divisions.built_in', '=', true)
            .where('departments.archived_at', 'is', null)
            .executeTakeFirstOrThrow(),
          transaction
            .selectFrom('slot_types')
            .select(sql<number>`count(*)::int`.as('count'))
            .where('archived_at', 'is', null)
            .where('kind', '=', 'lesson')
            .executeTakeFirstOrThrow(),
          // A default setting in force today or starting later; a withdrawn row
          // (an empty range) never took effect (decision 6).
          transaction
            .selectFrom('day_template_assignments')
            .select(sql<number>`count(*)::int`.as('count'))
            .where('level', '=', 'default')
            .where(
              sql<boolean>`valid_until is null or (valid_until > ${today}::date and valid_until > valid_from)`,
            )
            .executeTakeFirstOrThrow(),
          yearIds.length === 0
            ? Promise.resolve([])
            : transaction
                .selectFrom('quarters')
                .select(['academic_year_id', 'start_date'])
                .where('academic_year_id', 'in', yearIds)
                .execute(),
          yearIds.length === 0
            ? Promise.resolve({ count: 0 })
            : transaction
                .selectFrom('calendar_entries')
                .select(sql<number>`count(*)::int`.as('count'))
                .where('archived_at', 'is', null)
                .where((where) =>
                  where.or(
                    years.map((year) =>
                      where.and([
                        where('first_date', '>=', year.start_date),
                        where('last_date', '<=', year.end_date),
                      ]),
                    ),
                  ),
                )
                .executeTakeFirstOrThrow(),
          // School-wide subjects with this branch's daily distributions (task
          // 2.1, decision 7): done when an active subject exists and every
          // active graded one has its daily distribution here, of the subject's
          // current round (db/migrations/0021).
          transaction
            .selectFrom('subjects')
            .leftJoin('subject_daily_weights', (join) =>
              join
                .onRef('subject_daily_weights.subject_id', '=', 'subjects.id')
                .on('subject_daily_weights.branch_id', '=', branchId)
                .onRef('subject_daily_weights.weights_round', '=', 'subjects.weights_round'),
            )
            .select([
              sql<number>`count(*)::int`.as('active'),
              sql<number>`(count(*) filter (where subjects.journal_type = 'graded' and subject_daily_weights.subject_id is null))::int`.as(
                'missing',
              ),
            ])
            .where('subjects.archived_at', 'is', null)
            .executeTakeFirstOrThrow(),
        ]);

      const undated = years
        .filter(
          (year) =>
            quarters.filter(
              (quarter) => quarter.academic_year_id === year.id && quarter.start_date !== null,
            ).length < 4,
        )
        .map((year) => academicYearName(year.start_date, year.end_date));

      const item = (
        key: ChecklistItem['key'],
        done: boolean | null,
        extra: Partial<Pick<ChecklistItem, 'count' | 'years'>> = {},
      ): ChecklistItem => ({ key, done, count: extra.count ?? null, years: extra.years ?? [] });

      return {
        items: [
          item('branch', branch.working_weekdays.length > 0),
          item('rooms', rooms.count > 0),
          item('departments', departments.count > 0),
          item('year', years.length > 0),
          item('quarters', years.length > 0 && undated.length === 0, { years: undated }),
          item('slotTypes', slotTypes.count > 0),
          item('defaultTemplate', defaults.count > 0),
          item('calendar', null, { count: entries.count }),
          item('subjects', subjects.active > 0 && subjects.missing === 0, {
            count: subjects.missing,
          }),
        ],
      };
    });
  }
}
