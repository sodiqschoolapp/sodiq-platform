-- 0141 The attendance unit of the prepared report totals (task 9.3b-2, pull request #260).
--
-- `attendance`: a quarter and a journal (`unit_id`), the counts of the attendance cells of each
-- held lesson of the journal by class (`apps/api/src/modules/results/prepared/attendance.ts`),
-- read by the attendance report of `08`. It reads only tables 0140 already watches, so no
-- trigger is added (the inputs check of the speed run holds the list). No row is changed or
-- removed: the list of kinds only grows.

alter table report_prepared drop constraint report_prepared_kind_check;
alter table report_prepared add constraint report_prepared_kind_check check (
  kind in ('outcomes', 'figures', 'statuses', 'attendance')
);
