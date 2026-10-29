-- 0146 The plan progress unit of the prepared report totals (task 10.1b, pull request #263).
--
-- `plan_progress`: a quarter and a journal (`unit_id`), what the progress report of `09` counts
-- of the journal (`apps/api/src/modules/plans/plan-progress.ts`): its rows, topics, held and
-- delivered lessons and the planned works at each held lesson. It reads only tables 0140 already
-- watches (the inputs check of the speed run holds the list). No row is changed or removed: the
-- list of kinds only grows.

alter table report_prepared drop constraint report_prepared_kind_check;
alter table report_prepared add constraint report_prepared_kind_check check (
  kind in (
    'outcomes', 'figures', 'statuses', 'attendance', 'closing', 'class_figures', 'plan_progress'
  )
);
