-- 0091 The weekly days a published version was checked against (task
-- 5.6b-4a, pull request #176, decision 3).
--
-- docs/spec/06-timetable.md, What a change does to existing data: "Day
-- template changed (lengths, breaks, order): lessons already held keep the
-- times they were held at; lessons from the start date take the new times."
-- docs/spec/edge-cases/time-dates-calendar.md, "A slot type's length or a day
-- template is changed mid-year".
--
-- A pattern block keeps the weekly times of its version's start (0058), and
-- the dated expansion finds a block's lesson number by those times in the
-- weekly day of each grade (`weeklyNumber` of packages/timetable-rules). Read
-- from the templates after a change from a date, the times are no longer
-- there. The publish stores here the slots of the weekly day of each grade
-- and weekday it checked the version's blocks against (`dayFor` of
-- `pattern-facts.ts` with `statusOn` the version's start), and every later
-- reading of the version's pattern (its expansion, the check of a version
-- that runs again) takes its weekly days from these rows; the dated day of
-- each date still comes from the templates in force on it.
--
-- Written once, by the publish, while the version is still a draft
-- (`pattern_rows_draft`, deferred, run by the publish's `set constraints all
-- immediate`); no update or delete grant: a published version's weekly times
-- never change. A version published before this migration has no rows and
-- is read from the templates on its start, as before; nothing real exists
-- before go-live (owner, 12 October 2026).

create table timetable_version_days (
  branch_id uuid not null references branches (id),
  version_id uuid not null,
  grade smallint not null constraint timetable_version_days_grade_check check (
    grade between 1 and 11
  ),
  -- ISO weekday, 1 Monday to 7 Sunday.
  weekday smallint not null constraint timetable_version_days_weekday_check check (
    weekday between 1 and 7
  ),
  -- The slot's place in the day, breaks included, as pattern_blocks.slot_position (0058).
  position smallint not null constraint timetable_version_days_position_check check (
    position between 1 and 20
  ),
  kind text not null constraint timetable_version_days_kind_check check (
    kind in ('lesson', 'break')
  ),
  -- The slot's clock time, as pattern_blocks (0058).
  start_minutes smallint not null constraint timetable_version_days_start_check check (
    start_minutes between 0 and 1439
  ),
  end_minutes smallint not null constraint timetable_version_days_end_check check (
    end_minutes between 1 and 1440
  ),
  constraint timetable_version_days_order_check check (end_minutes > start_minutes),
  constraint timetable_version_days_pkey primary key (version_id, grade, weekday, position),
  constraint timetable_version_days_version_fkey foreign key (version_id, branch_id)
    references timetable_versions (id, branch_id)
);

alter table timetable_version_days enable row level security;
create policy branch_filter on timetable_version_days for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on timetable_version_days to sodiq_app;
grant insert (branch_id, version_id, grade, weekday, position, kind, start_minutes, end_minutes)
  on timetable_version_days to sodiq_app;

-- Written only on a draft of a year not closed: the publish writes them
-- before the version becomes published.
create constraint trigger timetable_version_days_draft
  after insert or update or delete on timetable_version_days
  deferrable initially deferred
  for each row execute function pattern_rows_draft();
