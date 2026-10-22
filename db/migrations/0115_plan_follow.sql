-- 0115 Plan items follow the timetable (task 7.1b, pull request #213).
--
-- docs/spec/09-lesson-plans.md, When something else changes: "One rule: plan
-- items follow the lessons in order. The items of lessons already held never
-- move." docs/spec/edge-cases/lesson-plans.md, How items stay attached: "A
-- plan has a fixed part, the items of lessons already held, and a queue of
-- the remaining items in order. Whenever the timetable changes, the queue is
-- attached again, first item to the first lesson not yet held, in the same
-- step as the change."
--
-- The plan approved on pull request #213: a snapshot of the rows each plan
-- was last laid on (`lesson_plan_rows`), the shifts an empty row absorbed
-- (`lesson_plan_absorbed`), the marks that tell the follow before the commit
-- which plans a transaction touched (`lesson_plan_follow_marks`), and the
-- requests the system prepares (`lesson_plan_requests`, decision 2: status
-- `prepared` only; 7.2 adds the rest). The follow itself is
-- apps/api/src/modules/plans/plan-follow.ts.

-- ---------------------------------------------------------------------------
-- The items: where an item moved back from comes from, and the position the
-- follow rewrites.

alter table lesson_plan_items add column moved_from date;

grant update (position, moved_from) on lesson_plan_items to sodiq_app;

-- When the plan was first laid on its rows (its snapshot written): null for a
-- plan made before 0115, which takes its positions as they are at its first
-- follow (decision 7). The transaction's moment.
alter table lesson_plan_journals add column laid_at timestamptz;

grant update (laid_at) on lesson_plan_journals to sodiq_app;

-- ---------------------------------------------------------------------------
-- The snapshot of the rows (step 1 to 4 of the plan): one line per row the
-- plan was last laid on, in order.

create table lesson_plan_rows (
  branch_id uuid not null references branches (id),
  plan_id uuid not null,
  journal_id uuid not null,
  position integer not null constraint lesson_plan_rows_position_check check (position >= 1),
  -- No key: a lesson removed leaves its line until the next follow reads it.
  lesson_id uuid not null,
  lesson_date date not null,
  starts_at timestamptz not null,
  -- The owner on the lesson's date (`journalOwnerOn`); null for nobody.
  owner_staff_id uuid,
  constraint lesson_plan_rows_plan_fkey foreign key (plan_id, journal_id)
    references lesson_plan_journals (plan_id, journal_id),
  constraint lesson_plan_rows_journal_fkey foreign key (journal_id, branch_id)
    references journals (id, branch_id),
  primary key (plan_id, journal_id, position)
);

alter table lesson_plan_rows enable row level security;
create policy branch_filter on lesson_plan_rows for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert, delete on lesson_plan_rows to sodiq_app;

-- A shift an empty row absorbed (step 3b): when `removed_lesson_id` comes
-- back, an empty row is put back at `absorbing_lesson_id`'s row.
create table lesson_plan_absorbed (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  plan_id uuid not null,
  journal_id uuid not null,
  removed_lesson_id uuid not null,
  absorbing_lesson_id uuid not null,
  constraint lesson_plan_absorbed_plan_fkey foreign key (plan_id, journal_id)
    references lesson_plan_journals (plan_id, journal_id)
);

create index lesson_plan_absorbed_plan_idx on lesson_plan_absorbed (plan_id, journal_id);

alter table lesson_plan_absorbed enable row level security;
create policy branch_filter on lesson_plan_absorbed for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert, delete on lesson_plan_absorbed to sodiq_app;

-- ---------------------------------------------------------------------------
-- The requests the system prepares (`09`, Editing after the window,
-- "Requests prepared by the system"; `edge/lesson-plans`: "Requests prepared
-- by the system are Re-plan." "A plan has at most one prepared request; a
-- later event adds to it.").

create table lesson_plan_requests (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  plan_id uuid not null,
  journal_id uuid not null,
  quarter_id uuid not null,
  kind text not null constraint lesson_plan_requests_kind_check check (kind in ('replan')),
  status text not null constraint lesson_plan_requests_status_check check (status in ('prepared')),
  -- The first lesson the request covers: the earliest of its causes.
  from_date date not null,
  -- The transaction's moment (the injected clock).
  prepared_at timestamptz not null,
  updated_at timestamptz not null,
  constraint lesson_plan_requests_plan_fkey foreign key (plan_id, journal_id)
    references lesson_plan_journals (plan_id, journal_id),
  constraint lesson_plan_requests_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id),
  constraint lesson_plan_requests_id_branch_key unique (id, branch_id)
);

create unique index lesson_plan_requests_prepared_idx
  on lesson_plan_requests (plan_id, journal_id) where status = 'prepared';

alter table lesson_plan_requests enable row level security;
create policy branch_filter on lesson_plan_requests for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on lesson_plan_requests to sodiq_app;
grant insert (id, branch_id, plan_id, journal_id, quarter_id, kind, status, from_date,
  prepared_at, updated_at) on lesson_plan_requests to sodiq_app;
grant update (from_date, updated_at) on lesson_plan_requests to sodiq_app;

-- Each event that prepares or adds to a request (decision 4).
create table lesson_plan_request_causes (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  request_id uuid not null,
  kind text not null constraint lesson_plan_request_causes_kind_check check (
    kind in ('not_covered', 'rows_added', 'moved_back', 'owner_changed')
  ),
  -- The first lesson the event touched.
  on_date date not null,
  -- The items it concerns (not covered, moved back); 0 for the others.
  items integer not null constraint lesson_plan_request_causes_items_check check (items >= 0),
  -- The new owner for `owner_changed`.
  staff_id uuid references staff (id),
  -- The transaction's moment (the injected clock).
  at timestamptz not null,
  constraint lesson_plan_request_causes_request_fkey foreign key (request_id, branch_id)
    references lesson_plan_requests (id, branch_id)
);

create index lesson_plan_request_causes_request_idx on lesson_plan_request_causes (request_id);

alter table lesson_plan_request_causes enable row level security;
create policy branch_filter on lesson_plan_request_causes for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on lesson_plan_request_causes to sodiq_app;
grant insert (branch_id, request_id, kind, on_date, items, staff_id, at)
  on lesson_plan_request_causes to sodiq_app;

-- ---------------------------------------------------------------------------
-- The marks: which journals with a plan a transaction touched (decision 5).
-- Written by the triggers below, read and deleted by the follow before the
-- commit (`Transactions.run`). A write as the migrator marks nothing
-- (`lesson_history_applies`, 0105), as it writes no lesson history.

create table lesson_plan_follow_marks (
  branch_id uuid not null references branches (id),
  journal_id uuid not null,
  written_xact xid8 not null default pg_current_xact_id(),
  constraint lesson_plan_follow_marks_journal_fkey foreign key (journal_id, branch_id)
    references journals (id, branch_id)
);

create index lesson_plan_follow_marks_xact_idx on lesson_plan_follow_marks (written_xact);

alter table lesson_plan_follow_marks enable row level security;
create policy branch_filter on lesson_plan_follow_marks for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert, delete on lesson_plan_follow_marks to sodiq_app;

-- The journals with a plan of a lesson's class or group, subject and date
-- (the year whose dates hold it: `journals_class_key` is per year).
create function lesson_plan_journals_of_lessons(
  branch_ids uuid[], class_ids uuid[], group_ids uuid[], subject_ids uuid[], dates date[]
) returns table (branch_id uuid, journal_id uuid)
language sql
stable
set search_path = pg_catalog, public
as $$
  select distinct j.branch_id, j.id
  from unnest(branch_ids, class_ids, group_ids, subject_ids, dates)
    as l(branch_id, class_id, group_id, subject_id, lesson_date)
  join academic_years y
    on y.branch_id = l.branch_id and l.lesson_date between y.start_date and y.end_date
  join journals j
    on j.branch_id = l.branch_id and j.academic_year_id = y.id and j.subject_id = l.subject_id
    and (j.class_id = l.class_id or j.group_id = l.group_id)
  where exists (select 1 from lesson_plan_journals p where p.journal_id = j.id);
$$;

-- Runs as the invoker. A lesson created, removed, or changed in its date,
-- time, teacher or cancel (`lesson_history_differs`, 0105).
create function lesson_plan_mark_lessons() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not lesson_history_applies() then
    return null;
  end if;
  if tg_op = 'INSERT' then
    insert into lesson_plan_follow_marks (branch_id, journal_id)
    select m.branch_id, m.journal_id from lesson_plan_journals_of_lessons(
      array(select n.branch_id from new_rows n order by n.id),
      array(select n.class_id from new_rows n order by n.id),
      array(select n.group_id from new_rows n order by n.id),
      array(select n.subject_id from new_rows n order by n.id),
      array(select n.lesson_date from new_rows n order by n.id)
    ) m;
  elsif tg_op = 'DELETE' then
    insert into lesson_plan_follow_marks (branch_id, journal_id)
    select m.branch_id, m.journal_id from lesson_plan_journals_of_lessons(
      array(select o.branch_id from old_rows o order by o.id),
      array(select o.class_id from old_rows o order by o.id),
      array(select o.group_id from old_rows o order by o.id),
      array(select o.subject_id from old_rows o order by o.id),
      array(select o.lesson_date from old_rows o order by o.id)
    ) m;
  else
    insert into lesson_plan_follow_marks (branch_id, journal_id)
    select distinct m.branch_id, m.journal_id from (
      select c.* from (
        select o.branch_id, o.class_id, o.group_id, o.subject_id, o.lesson_date, o.id, 0 as side
        from old_rows o join new_rows n on n.id = o.id
        where lesson_history_differs(o, n)
        union all
        select n.branch_id, n.class_id, n.group_id, n.subject_id, n.lesson_date, n.id, 1
        from old_rows o join new_rows n on n.id = o.id
        where lesson_history_differs(o, n)
      ) c
    ) changed,
    lateral lesson_plan_journals_of_lessons(
      array[changed.branch_id], array[changed.class_id], array[changed.group_id],
      array[changed.subject_id], array[changed.lesson_date]
    ) m;
  end if;
  return null;
end;
$$;

create trigger lesson_plan_mark_lessons_insert
  after insert on lessons referencing new table as new_rows
  for each statement execute function lesson_plan_mark_lessons();

create trigger lesson_plan_mark_lessons_update
  after update on lessons referencing old table as old_rows new table as new_rows
  for each statement execute function lesson_plan_mark_lessons();

create trigger lesson_plan_mark_lessons_delete
  after delete on lessons referencing old table as old_rows
  for each statement execute function lesson_plan_mark_lessons();

-- Every journal with a plan of a year: a quarter's dates or a publish change
-- the rows and the owners of all of them. Runs as the invoker.
create function lesson_plan_mark_year() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not lesson_history_applies() then
    return null;
  end if;
  -- Nested: PL/pgSQL does not stop at the table name, and the other table
  -- has no such field.
  if tg_table_name = 'quarters' then
    if new.start_date is not distinct from old.start_date
        and new.end_date is not distinct from old.end_date then
      return null;
    end if;
  else
    if new.status is not distinct from old.status then
      return null;
    end if;
  end if;
  insert into lesson_plan_follow_marks (branch_id, journal_id)
  select j.branch_id, j.id from journals j
  where j.branch_id = new.branch_id and j.academic_year_id = new.academic_year_id
    and exists (select 1 from lesson_plan_journals p where p.journal_id = j.id);
  return null;
end;
$$;

create trigger lesson_plan_mark_quarters
  after update on quarters
  for each row execute function lesson_plan_mark_year();

create trigger lesson_plan_mark_versions
  after update on timetable_versions
  for each row execute function lesson_plan_mark_year();

-- One journal: its runs (a publish, a subject removed) or an acting period.
-- Runs as the invoker.
create function lesson_plan_mark_journal() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  journal uuid;
begin
  if not lesson_history_applies() then
    return null;
  end if;
  if tg_table_name = 'journals' then
    if new.runs is not distinct from old.runs then
      return null;
    end if;
    journal := new.id;
  else
    journal := new.journal_id;
  end if;
  insert into lesson_plan_follow_marks (branch_id, journal_id)
  select new.branch_id, journal
  where exists (select 1 from lesson_plan_journals p where p.journal_id = journal);
  return null;
end;
$$;

create trigger lesson_plan_mark_journals
  after update on journals
  for each row execute function lesson_plan_mark_journal();

create trigger lesson_plan_mark_acting
  after insert or update on journal_acting_teachers
  for each row execute function lesson_plan_mark_journal();

-- A person whose branch or status changes may stop being an acting owner
-- (`personOutOf`): the journals with a plan they act for, as far as the
-- transaction's branches see them. Runs as the invoker.
create function lesson_plan_mark_person() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  person uuid;
begin
  if not lesson_history_applies() then
    return null;
  end if;
  person := case when tg_op = 'DELETE' then old.staff_id else new.staff_id end;
  insert into lesson_plan_follow_marks (branch_id, journal_id)
  select distinct a.branch_id, a.journal_id from journal_acting_teachers a
  where a.person_id = person
    and exists (select 1 from lesson_plan_journals p where p.journal_id = a.journal_id);
  return null;
end;
$$;

create trigger lesson_plan_mark_staff_branches
  after insert or update or delete on staff_branches
  for each row execute function lesson_plan_mark_person();

create trigger lesson_plan_mark_staff_statuses
  after insert or update or delete on staff_statuses
  for each row execute function lesson_plan_mark_person();
