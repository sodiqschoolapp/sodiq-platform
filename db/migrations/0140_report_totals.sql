-- 0140 Prepared report totals (task 9.3b-1, pull request #258).
--
-- `08`, Analytics in Release 1: "Every report opens in under 2 seconds. Totals are prepared in
-- the background when journal data changes, so no report reads the whole journal at the moment
-- it is opened." `edge/system-behaviour`: "Report totals are two minutes behind the journal ...
-- Prepared totals for reports show 'updated at'. A page that finds them behind calculates from
-- source and shows 'updating'."
--
-- A change of anything the prepared readers read writes a row of `report_changes` in its own
-- transaction (plan decision 2: the change row is written with the change, so none is lost); the
-- worker prepares the units those rows concern every minute (`results.prepare_totals`). A
-- preparation keeps the snapshot of its transaction (`seen`): a unit is behind when a change row
-- concerning it was not visible in that snapshot (review of the plan, findings 2 and correction
-- 2), when the moment it depends on has come (`next_change_at`: a lesson starts, the date
-- moves), or when a school-wide input differs from the one it was prepared with
-- (`school_inputs`: the school-wide tables have no branch to write a change row in).
--
-- Tables, not materialized views (`docs/decisions.md`, the row filter decision); each belongs to
-- a branch with the row filter of 0002. No existing row changes.

-- ---------------------------------------------------------------------------
-- The change rows: append-only, written by the triggers below.

create table report_changes (
  branch_id uuid not null references branches (id),
  -- Null: every quarter of the branch (review correction 3).
  quarter_id uuid,
  -- Null: every journal of the branch (an input that touches many journals at once).
  journal_id uuid,
  -- The transaction of the change: a preparation saw it when it is visible in its snapshot.
  xid xid8 not null default pg_current_xact_id(),
  -- The injected clock (`app.now`); bookkeeping for the reader of a change, no rule compares it.
  changed_at timestamptz
);

create index report_changes_branch_idx on report_changes (branch_id, journal_id);

alter table report_changes enable row level security;
create policy branch_filter on report_changes for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert on report_changes to sodiq_app;
-- The preparation removes the rows every preparation of their units saw.
grant delete on report_changes to sodiq_app;

-- ---------------------------------------------------------------------------
-- The prepared units.
--
-- `outcomes` and `figures`: a quarter and a subject (`unit_id`), the outcome of every member of
-- its graded journals as the rating reads it, and the early-warning figures of each student;
-- `statuses`: a quarter and a journal (`unit_id`), whose lessons are in
-- `report_prepared_lessons`. `journal_ids` are the journals the unit covers. `value` is the
-- codec's JSON (`apps/api/src/modules/results/prepared/codec.ts`): exact fractions as decimal
-- texts.

create table report_prepared (
  branch_id uuid not null references branches (id),
  kind text not null constraint report_prepared_kind_check check (
    kind in ('outcomes', 'figures', 'statuses')
  ),
  quarter_id uuid not null,
  unit_id uuid not null,
  journal_ids uuid[] not null,
  seen pg_snapshot not null,
  school_inputs text not null,
  prepared_at timestamptz not null,
  next_change_at timestamptz,
  value jsonb not null,
  primary key (branch_id, kind, quarter_id, unit_id),
  constraint report_prepared_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id) on delete cascade
);

alter table report_prepared enable row level security;
create policy branch_filter on report_prepared for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert, update, delete on report_prepared to sodiq_app;

-- The status facts of each lesson of a prepared `statuses` unit, never its status: that
-- depends on the clock of the request (review of the plan, finding 1).
create table report_prepared_lessons (
  branch_id uuid not null references branches (id),
  quarter_id uuid not null,
  journal_id uuid not null,
  lesson_id uuid not null,
  value jsonb not null,
  primary key (branch_id, lesson_id),
  constraint report_prepared_lessons_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id) on delete cascade
);

create index report_prepared_lessons_unit_idx
  on report_prepared_lessons (branch_id, quarter_id, journal_id);

alter table report_prepared_lessons enable row level security;
create policy branch_filter on report_prepared_lessons for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert, delete on report_prepared_lessons to sodiq_app;

-- ---------------------------------------------------------------------------
-- The triggers. One statement-level trigger per event and table (review correction 1: a
-- trigger with transition tables has one event), all calling one function per kind of row:
--
-- - `report_changed_lesson`: rows with `lesson_id`; the journal and quarter of the lesson;
-- - `report_changed_lesson_self`: `lessons` itself;
-- - `report_changed_journal`: rows with `journal_id`, every quarter;
-- - `report_changed_branch`: any other row of a branch: every journal and quarter.
--
-- Statement level, so a save of 30 cells writes one row per journal, and no row is updated, so
-- two saves of one journal never wait on each other (review of the plan, finding 7). A lesson
-- that is gone (deleted in the same statement) or in no journal counts for the whole branch.

create function report_lesson_journal(lesson uuid) returns table (
  branch_id uuid, quarter_id uuid, journal_id uuid
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select l.branch_id, q.id, j.id
  from lessons l
  left join quarters q on q.branch_id = l.branch_id
    and q.start_date <= l.lesson_date and l.lesson_date <= q.end_date
  left join lateral (
    select j.id from journals j
    join academic_years y on y.id = j.academic_year_id
    where j.branch_id = l.branch_id
      and j.subject_id = l.subject_id
      and (
        (l.class_id is not null and j.class_id = l.class_id)
        or (l.class_id is null and j.class_id is null and j.group_id = l.group_id)
      )
      and y.start_date <= l.lesson_date and l.lesson_date <= y.end_date
    limit 1
  ) j on true
  where l.id = lesson
$$;

create function report_changed_rows(rows jsonb) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  insert into report_changes (branch_id, quarter_id, journal_id, changed_at)
  select distinct
    (r ->> 'branch_id')::uuid, (r ->> 'quarter_id')::uuid, (r ->> 'journal_id')::uuid,
    class_tutors_moment()
  from jsonb_array_elements(rows) r
  where r ->> 'branch_id' is not null
  -- Sorted, so two writers meet the index in one order.
  order by 1, 2, 3;
end;
$$;

create function report_changed_lesson() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  found jsonb;
begin
  if tg_op = 'INSERT' then
    select jsonb_agg(x) into found from (
      select distinct coalesce(lj.branch_id, n.branch_id) as branch_id,
        case when lj.journal_id is null then null else lj.quarter_id end as quarter_id,
        lj.journal_id
      from new_rows n left join lateral report_lesson_journal(n.lesson_id) lj on true
    ) x;
  elsif tg_op = 'DELETE' then
    select jsonb_agg(x) into found from (
      select distinct coalesce(lj.branch_id, o.branch_id) as branch_id,
        case when lj.journal_id is null then null else lj.quarter_id end as quarter_id,
        lj.journal_id
      from old_rows o left join lateral report_lesson_journal(o.lesson_id) lj on true
    ) x;
  else
    select jsonb_agg(x) into found from (
      select distinct coalesce(lj.branch_id, r.branch_id) as branch_id,
        case when lj.journal_id is null then null else lj.quarter_id end as quarter_id,
        lj.journal_id
      from (
        select branch_id, lesson_id from new_rows
        union select branch_id, lesson_id from old_rows
      ) r left join lateral report_lesson_journal(r.lesson_id) lj on true
    ) x;
  end if;
  perform report_changed_rows(coalesce(found, '[]'::jsonb));
  return null;
end;
$$;

create function report_changed_lesson_self() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  found jsonb;
begin
  -- A lesson's own row: its journal by its subject, unit and date, before and after.
  if tg_op = 'INSERT' then
    select jsonb_agg(x) into found from (
      select distinct n.branch_id, lj.quarter_id, lj.journal_id
      from new_rows n left join lateral report_lesson_journal(n.id) lj on true
    ) x;
  elsif tg_op = 'DELETE' then
    -- The row is gone: the whole branch.
    select jsonb_agg(x) into found from (
      select distinct o.branch_id, null::uuid as quarter_id, null::uuid as journal_id
      from old_rows o
    ) x;
  else
    select jsonb_agg(x) into found from (
      select distinct n.branch_id, lj.quarter_id, lj.journal_id
      from new_rows n left join lateral report_lesson_journal(n.id) lj on true
      union
      select distinct o.branch_id, null::uuid, null::uuid
      from old_rows o join new_rows n on n.id = o.id
      where (o.subject_id, o.class_id, o.group_id, o.lesson_date)
        is distinct from (n.subject_id, n.class_id, n.group_id, n.lesson_date)
    ) x;
  end if;
  -- A lesson in no journal: the whole branch.
  select jsonb_agg(
    case when y ->> 'journal_id' is null
      then jsonb_build_object('branch_id', y ->> 'branch_id')
      else y end
  ) into found from jsonb_array_elements(coalesce(found, '[]'::jsonb)) y;
  perform report_changed_rows(coalesce(found, '[]'::jsonb));
  return null;
end;
$$;

create function report_changed_journal() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  found jsonb;
begin
  if tg_op = 'INSERT' then
    select jsonb_agg(x) into found from (
      select distinct branch_id, journal_id from new_rows
    ) x;
  elsif tg_op = 'DELETE' then
    select jsonb_agg(x) into found from (
      select distinct branch_id, journal_id from old_rows
    ) x;
  else
    select jsonb_agg(x) into found from (
      select branch_id, journal_id from new_rows
      union select branch_id, journal_id from old_rows
    ) x;
  end if;
  perform report_changed_rows(coalesce(found, '[]'::jsonb));
  return null;
end;
$$;

create function report_changed_plan() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  found jsonb;
begin
  -- A plan item: the journals its plan is laid in, in the quarter of each (0136).
  if tg_op = 'INSERT' then
    select jsonb_agg(x) into found from (
      select distinct r.branch_id, pj.quarter_id, pj.journal_id
      from (select branch_id, plan_id from new_rows) r
      join lesson_plan_journals pj on pj.plan_id = r.plan_id
    ) x;
  elsif tg_op = 'DELETE' then
    select jsonb_agg(x) into found from (
      select distinct r.branch_id, pj.quarter_id, pj.journal_id
      from (select branch_id, plan_id from old_rows) r
      join lesson_plan_journals pj on pj.plan_id = r.plan_id
    ) x;
  else
    select jsonb_agg(x) into found from (
      select distinct r.branch_id, pj.quarter_id, pj.journal_id
      from (select branch_id, plan_id from new_rows union select branch_id, plan_id from old_rows) r
      join lesson_plan_journals pj on pj.plan_id = r.plan_id
    ) x;
  end if;
  perform report_changed_rows(coalesce(found, '[]'::jsonb));
  return null;
end;
$$;

create function report_changed_rating_entry() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  found jsonb;
begin
  -- A rating entry: the journal and quarter of its exam; an exam that is gone, the branch.
  if tg_op = 'INSERT' then
    select jsonb_agg(x) into found from (
      select distinct r.branch_id,
        case when e.journal_id is null then null else e.quarter_id end as quarter_id, e.journal_id
      from (select branch_id, rating_exam_id from new_rows) r
      left join journal_rating_exams e on e.id = r.rating_exam_id
    ) x;
  elsif tg_op = 'DELETE' then
    select jsonb_agg(x) into found from (
      select distinct r.branch_id,
        case when e.journal_id is null then null else e.quarter_id end as quarter_id, e.journal_id
      from (select branch_id, rating_exam_id from old_rows) r
      left join journal_rating_exams e on e.id = r.rating_exam_id
    ) x;
  else
    select jsonb_agg(x) into found from (
      select distinct r.branch_id,
        case when e.journal_id is null then null else e.quarter_id end as quarter_id, e.journal_id
      from (select branch_id, rating_exam_id from new_rows union select branch_id, rating_exam_id from old_rows) r
      left join journal_rating_exams e on e.id = r.rating_exam_id
    ) x;
  end if;
  perform report_changed_rows(coalesce(found, '[]'::jsonb));
  return null;
end;
$$;

create function report_changed_branch() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  found jsonb;
begin
  if tg_op = 'INSERT' then
    select jsonb_agg(x) into found from (select distinct branch_id from new_rows) x;
  elsif tg_op = 'DELETE' then
    select jsonb_agg(x) into found from (select distinct branch_id from old_rows) x;
  else
    select jsonb_agg(x) into found from (
      select branch_id from new_rows union select branch_id from old_rows
    ) x;
  end if;
  perform report_changed_rows(coalesce(found, '[]'::jsonb));
  return null;
end;
$$;

-- One trigger per event of each input table. The list is held complete by the inputs check of
-- the speed run (`speed.database.test.ts`, `testing/prepared-kit.ts`): every branch table the
-- preparation reads is on it.
create function report_watch(target regclass, kind text) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  fn text := 'report_changed_' || kind;
  name text := replace(target::text, '.', '_');
begin
  execute format(
    'create trigger %I after insert on %s referencing new table as new_rows '
    'for each statement execute function %I()', name || '_report_insert', target, fn);
  execute format(
    'create trigger %I after update on %s referencing old table as old_rows new table as new_rows '
    'for each statement execute function %I()', name || '_report_update', target, fn);
  execute format(
    'create trigger %I after delete on %s referencing old table as old_rows '
    'for each statement execute function %I()', name || '_report_delete', target, fn);
end;
$$;

select report_watch('lessons', 'lesson_self');
-- lesson
select report_watch('exemption_clears', 'lesson');
select report_watch('exemption_reopened_cells', 'lesson');
select report_watch('exemption_skips', 'lesson');
select report_watch('journal_cells', 'lesson');
select report_watch('journal_comments', 'lesson');
select report_watch('journal_homework_not_given', 'lesson');
select report_watch('journal_lesson_deliveries', 'lesson');
select report_watch('journal_optional_cells', 'lesson');
select report_watch('journal_unlocks', 'lesson');
select report_watch('journal_works', 'lesson');
-- journal
select report_watch('journal_acting_teachers', 'journal');
select report_watch('journal_rating_exams', 'journal');
select report_watch('lesson_plan_journals', 'journal');
select report_watch('lesson_plan_places', 'journal');
select report_watch('quarter_closing_journals', 'journal');
select report_watch('quarter_closings', 'journal');
select report_watch('quarter_final_results', 'journal');
select report_watch('quarter_reopenings', 'journal');
-- plan
select report_watch('lesson_plan_items', 'plan');
-- rating_entry
select report_watch('journal_rating_entries', 'rating_entry');
-- branch
select report_watch('academic_years', 'branch');
select report_watch('branch_edit_days', 'branch');
select report_watch('branch_settings', 'branch');
select report_watch('bulk_cancel_blocks', 'branch');
select report_watch('calendar_group_blocks', 'branch');
select report_watch('class_memberships', 'branch');
select report_watch('classes', 'branch');
select report_watch('exemption_spans', 'branch');
select report_watch('exemption_subjects', 'branch');
select report_watch('exemptions', 'branch');
select report_watch('group_classes', 'branch');
select report_watch('group_memberships', 'branch');
select report_watch('groups', 'branch');
select report_watch('journal_edit_extensions', 'branch');
select report_watch('journal_voids', 'branch');
select report_watch('journals', 'branch');
select report_watch('lesson_block_class_outs', 'branch');
select report_watch('quarter_result_decisions', 'branch');
select report_watch('quarters', 'branch');
select report_watch('staff_branches', 'branch');
select report_watch('student_branch_moves', 'branch');
select report_watch('student_moves', 'branch');
select report_watch('student_statuses', 'branch');
select report_watch('subject_daily_weights', 'branch');
select report_watch('subject_quarter_weights', 'branch');

drop function report_watch(regclass, text);
