-- 0019 Settings (task 1.6).
--
-- The owner's answers 19 to 24 (docs/decisions.md, "Decided ahead for tasks
-- 1.3 to 1.6") and the plan approved on pull request #49.
--
-- Answer 19: "Per-branch settings in one typed table: edit days 1 to 30
-- (default 7); early-warning thresholds (low result 50, drop 15, attendance
-- 80 percent, 3 absences in a row)". docs/spec/07-journal.md, Editing rules
-- and locks: "A teacher can change a lesson for 7 days after it; the number
-- is a setting of the Academic Vice Principal." docs/spec/08-results-rating-
-- analytics.md, Early-warning list: "Threshold (default; the Academic Vice
-- Principal can change it)".
--
-- Answer 20: "Attendance values for late (50) and skipped (0) are stored per
-- quarter and editable by the Academic Vice Principal while the quarter is
-- not closed." docs/spec/edge-cases/calculation.md: "The values of 'late' and
-- 'skipped' are stored per branch and quarter."
--
-- Answer 21: "Travel time between branches: per pair, symmetric, 0 to 180
-- minutes, Super Admin." docs/spec/06-timetable.md, Teachers who work in
-- several branches: "The Super Admin sets the travel time between each pair of
-- branches."

-- One row per branch (decision 8): written for every branch here and by the
-- branch create in its transaction, so no reader meets a branch without one.
-- The bounds and defaults are the constants of packages/shared/src/settings.ts
-- (a test compares them).
create table branch_settings (
  branch_id uuid primary key references branches (id),
  -- EDIT_DAYS: calendar days after the lesson's date (edge/00-definitions,
  -- Lock moment). A plain value (decision 1): the lock is stored per lesson.
  edit_days smallint not null default 7
    constraint branch_settings_edit_days_check check (edit_days between 1 and 30),
  -- A provisional quarter result below this is listed (decision 2).
  low_result smallint not null default 50
    constraint branch_settings_low_result_check check (low_result between 1 and 100),
  -- A drop of at least this many points is listed.
  result_drop smallint not null default 15
    constraint branch_settings_result_drop_check check (result_drop between 1 and 100),
  -- Attendance below this percent in the quarter is listed.
  attendance_percent smallint not null default 80
    constraint branch_settings_attendance_percent_check check (attendance_percent between 1 and 100),
  -- This many absences in a row are listed.
  absences_in_row smallint not null default 3
    constraint branch_settings_absences_in_row_check check (absences_in_row between 1 and 30),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now()
);

alter table branch_settings enable row level security;
create policy branch_filter on branch_settings for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on branch_settings to sodiq_app;
-- The defaults are the database's: the application inserts the branch only.
grant insert (branch_id) on branch_settings to sodiq_app;
grant update (edit_days, low_result, result_drop, attendance_percent, absences_in_row)
  on branch_settings to sodiq_app;

insert into branch_settings (branch_id) select id from branches;

-- Late and skipped, percent of a present lesson, per quarter (answer 20,
-- decision 3). A quarter of a closed year refuses any change already
-- (quarters_closed_year_guard of 0016). quarters is a small table: one step.
alter table quarters
  add column late_value smallint not null default 50
    constraint quarters_late_value_check check (late_value between 0 and 100),
  add column skipped_value smallint not null default 0
    constraint quarters_skipped_value_check check (skipped_value between 0 and 100);

grant update (late_value, skipped_value) on quarters to sodiq_app;

-- Travel time (answer 21, decision 4). One row per unordered pair, the lower
-- id first, so the value is symmetric by construction. School-wide: a pair
-- belongs to two branches equally; the Super Admin alone writes it, and the
-- service answers a reader the pairs of its own branch only. A pair without a
-- row is "not set", never 0 minutes.
create table travel_times (
  branch_low uuid not null references branches (id),
  branch_high uuid not null references branches (id),
  -- TRAVEL_MINUTES_MAX of packages/shared.
  minutes smallint not null constraint travel_times_minutes_check check (minutes between 0 and 180),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint travel_times_pkey primary key (branch_low, branch_high),
  constraint travel_times_order_check check (branch_low < branch_high)
);

create index travel_times_branch_high_idx on travel_times (branch_high);

grant select on travel_times to sodiq_app;
grant insert (branch_low, branch_high, minutes) on travel_times to sodiq_app;
grant update (minutes) on travel_times to sodiq_app;
