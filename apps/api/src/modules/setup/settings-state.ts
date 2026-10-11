import type { BranchSettings } from '@sodiq/shared';

/** The columns of `branch_settings` a reader answers (db/migrations/0019). */
export const SETTINGS_COLUMNS = [
  'edit_days',
  'low_result',
  'result_drop',
  'attendance_percent',
  'absences_in_row',
] as const;

export interface SettingsRow {
  edit_days: number;
  low_result: number;
  result_drop: number;
  attendance_percent: number;
  absences_in_row: number;
}

export const toSettings = (row: SettingsRow): BranchSettings => ({
  editDays: row.edit_days,
  lowResult: row.low_result,
  resultDrop: row.result_drop,
  attendancePercent: row.attendance_percent,
  absencesInRow: row.absences_in_row,
});
