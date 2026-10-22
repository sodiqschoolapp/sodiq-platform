-- 0114 Lesson plans and their items (task 7.1a, pull request #212).
--
-- docs/spec/09-lesson-plans.md, What a plan contains: "One plan for each
-- class or group, subject and quarter." "Topic | Required." "Classwork |
-- Optional, any number." "Homework | Optional, any number." "Objectives and
-- materials | Optional: short text, files, links." "Attendance-only
-- subjects, which are the Homework slot and Ma'naviyat soati, have no plan.
-- This is not a setting." docs/spec/edge-cases/lesson-plans.md, Plans and the
-- journal: "Limits: 20 MB per file, 10 files per item, a fixed list of file
-- types. Each classwork and each homework has a short title of at most 60
-- characters, used as the column title, plus an optional description." "A
-- plan is never deleted. ... History is kept from creation."
--
-- The plan approved on pull request #212 with corrections 1 to 4: decisions
-- 1 to 10. Nothing here names a lesson: an item stands at a position of the
-- plan's queue, and the row it fills is worked out on each read
-- (`planRows`, apps/api/src/modules/plans/plan-read.ts); 7.1b stores the fixed part. The
-- bounds are the constants of packages/shared/src/plans.ts.

-- ---------------------------------------------------------------------------
-- The plan.

create table lesson_plans (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  quarter_id uuid not null,
  subject_id uuid not null references subjects (id),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint lesson_plans_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id),
  constraint lesson_plans_id_branch_key unique (id, branch_id),
  constraint lesson_plans_id_quarter_key unique (id, quarter_id, branch_id)
);

alter table lesson_plans enable row level security;
create policy branch_filter on lesson_plans for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- Never deleted, never changed.
grant select on lesson_plans to sodiq_app;
grant insert (id, branch_id, quarter_id, subject_id) on lesson_plans to sodiq_app;

-- The journals a plan serves: one in this task; 7.1c lets several journals
-- of one grade and language share a plan. One plan per journal and quarter.
create table lesson_plan_journals (
  branch_id uuid not null references branches (id),
  plan_id uuid not null,
  journal_id uuid not null,
  -- The plan's quarter, held equal by the key below.
  quarter_id uuid not null,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint lesson_plan_journals_plan_fkey foreign key (plan_id, quarter_id, branch_id)
    references lesson_plans (id, quarter_id, branch_id),
  constraint lesson_plan_journals_journal_fkey foreign key (journal_id, branch_id)
    references journals (id, branch_id),
  constraint lesson_plan_journals_key unique (branch_id, journal_id, quarter_id),
  primary key (plan_id, journal_id)
);

create index lesson_plan_journals_journal_idx on lesson_plan_journals (journal_id);

alter table lesson_plan_journals enable row level security;
create policy branch_filter on lesson_plan_journals for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on lesson_plan_journals to sodiq_app;
grant insert (branch_id, plan_id, journal_id, quarter_id) on lesson_plan_journals to sodiq_app;

-- The journal's subject is the plan's, the quarter is of the journal's year,
-- and the subject is graded (09: "Attendance-only subjects ... have no
-- plan"; read from subjects.journal_type until 8.2 stores it per quarter).
-- Runs as the invoker.
create function lesson_plan_journals_check() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  journal_subject uuid;
  journal_year uuid;
  plan_subject uuid;
  quarter_year uuid;
  kind text;
begin
  select j.subject_id, j.academic_year_id into journal_subject, journal_year
    from journals j where j.id = new.journal_id and j.branch_id = new.branch_id;
  select p.subject_id into plan_subject
    from lesson_plans p where p.id = new.plan_id and p.branch_id = new.branch_id;
  select q.academic_year_id into quarter_year
    from quarters q where q.id = new.quarter_id and q.branch_id = new.branch_id;
  if journal_subject is distinct from plan_subject then
    raise exception 'lesson_plan_journal_subject'
      using errcode = 'check_violation', constraint = 'lesson_plan_journal_subject';
  end if;
  if journal_year is distinct from quarter_year then
    raise exception 'lesson_plan_journal_year'
      using errcode = 'check_violation', constraint = 'lesson_plan_journal_year';
  end if;
  select s.journal_type into kind from subjects s where s.id = journal_subject;
  if kind is distinct from 'graded' then
    raise exception 'lesson_plan_attendance_only'
      using errcode = 'check_violation', constraint = 'lesson_plan_attendance_only';
  end if;
  return new;
end;
$$;

create trigger lesson_plan_journals_check
  before insert on lesson_plan_journals
  for each row execute function lesson_plan_journals_check();

-- ---------------------------------------------------------------------------
-- The items.

-- PLAN_LINKS_MAX links of at most PLAN_LINK_MAX_LENGTH characters, each a
-- web address (decision 7).
create function lesson_plan_links_valid(links text[]) returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select (array_ndims(links) is null or array_ndims(links) = 1)
    and coalesce(cardinality(links), 0) <= 10
    and array_position(links, null) is null
    and not exists (
      select 1 from unnest(links) as link
      where length(link) > 500 or link !~ '^https?://[^[:space:]]+$'
    )
$$;

create table lesson_plan_items (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  plan_id uuid not null,
  -- The place in the plan's queue: row p is the p-th lesson of the quarter
  -- not cancelled (decision 5). A position with no item is an empty row.
  position integer not null constraint lesson_plan_items_position_check check (position >= 1),
  -- PLAN_TOPIC_MAX_LENGTH (decision 7).
  topic text not null constraint lesson_plan_items_topic_check check (
    length(btrim(topic)) >= 1 and length(topic) <= 300
  ),
  -- PLAN_OBJECTIVES_MAX_LENGTH; empty when none.
  objectives text not null default '' constraint lesson_plan_items_objectives_check check (
    length(objectives) <= 2000
  ),
  links text[] not null default '{}' constraint lesson_plan_items_links_check check (
    lesson_plan_links_valid(links) is true
  ),
  -- Set by "Clear" (edge/lesson-plans), from the injected clock; the row and
  -- its audit entries stay, and the position is free again.
  cleared_at timestamptz,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint lesson_plan_items_plan_fkey foreign key (plan_id, branch_id)
    references lesson_plans (id, branch_id),
  constraint lesson_plan_items_id_branch_key unique (id, branch_id)
);

create unique index lesson_plan_items_position_idx
  on lesson_plan_items (branch_id, plan_id, position) where cleared_at is null;

alter table lesson_plan_items enable row level security;
create policy branch_filter on lesson_plan_items for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- Never deleted (edge: "A plan is never deleted"); the plan and the position
-- never change in this task (7.1b moves the queue).
grant select on lesson_plan_items to sodiq_app;
grant insert (id, branch_id, plan_id, position, topic, objectives, links)
  on lesson_plan_items to sodiq_app;
grant update (topic, objectives, links, cleared_at) on lesson_plan_items to sodiq_app;

-- ---------------------------------------------------------------------------
-- The classworks and homeworks of an item.

create table lesson_plan_works (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  item_id uuid not null,
  kind text not null constraint lesson_plan_works_kind_check check (kind in ('classwork', 'homework')),
  -- The order among the item's works of its kind, from 1.
  position integer not null constraint lesson_plan_works_position_check check (position >= 1),
  -- PLAN_WORK_TITLE_MAX_LENGTH (edge/lesson-plans: "at most 60 characters").
  title text not null constraint lesson_plan_works_title_check check (
    length(btrim(title)) >= 1 and length(title) <= 60
  ),
  -- PLAN_WORK_DESCRIPTION_MAX_LENGTH; empty when none.
  description text not null default '' constraint lesson_plan_works_description_check check (
    length(description) <= 1000
  ),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint lesson_plan_works_item_fkey foreign key (item_id, branch_id)
    references lesson_plan_items (id, branch_id)
);

create index lesson_plan_works_item_idx on lesson_plan_works (item_id);

alter table lesson_plan_works enable row level security;
create policy branch_filter on lesson_plan_works for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- A work removed from an item is deleted (decision 8; its values are in the
-- audit entry of the save, correction 4); 8.1 refuses it once it has numbers.
grant select, delete on lesson_plan_works to sodiq_app;
grant insert (id, branch_id, item_id, kind, position, title, description)
  on lesson_plan_works to sodiq_app;
grant update (position, title, description) on lesson_plan_works to sodiq_app;

-- At most PLAN_WORKS_MAX works of a kind per item (build plan 7.1a: "at most
-- 10 of each"). The route locks the item row in a statement of its own
-- first, so two saves count one after the other. Runs as the invoker.
create function lesson_plan_works_limit() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (select count(*) from lesson_plan_works w
      where w.item_id = new.item_id and w.kind = new.kind) > 10 then
    raise exception 'lesson_plan_works_limit'
      using errcode = 'check_violation', constraint = 'lesson_plan_works_limit';
  end if;
  return null;
end;
$$;

create trigger lesson_plan_works_limit
  after insert on lesson_plan_works
  for each row execute function lesson_plan_works_limit();

-- ---------------------------------------------------------------------------
-- The files of an item. The bytes live in the object store under
-- `plans/<item id>/<file id>` (decision 1), never reused.

create table lesson_plan_files (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  item_id uuid not null,
  -- PLAN_FILE_NAME_MAX_LENGTH.
  name text not null constraint lesson_plan_files_name_check check (
    length(btrim(name)) >= 1 and length(name) <= 200
  ),
  -- PLAN_FILE_TYPES (decision 3).
  type text not null constraint lesson_plan_files_type_check check (
    type in (
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'audio/mpeg',
      'video/mp4'
    )
  ),
  -- PLAN_FILE_MAX_BYTES (edge/lesson-plans: "20 MB per file").
  bytes integer not null constraint lesson_plan_files_bytes_check check (
    bytes between 1 and 20000000
  ),
  -- Set when the owner removes the file, from the injected clock; the row and
  -- the bytes stay (decision 8).
  removed_at timestamptz,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint lesson_plan_files_item_fkey foreign key (item_id, branch_id)
    references lesson_plan_items (id, branch_id)
);

create index lesson_plan_files_item_idx on lesson_plan_files (item_id);

alter table lesson_plan_files enable row level security;
create policy branch_filter on lesson_plan_files for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on lesson_plan_files to sodiq_app;
grant insert (id, branch_id, item_id, name, type, bytes) on lesson_plan_files to sodiq_app;
grant update (removed_at) on lesson_plan_files to sodiq_app;

-- At most PLAN_FILES_MAX files not removed per item (edge: "10 files per
-- item"), counted after the route's lock of the item row. Runs as the invoker.
create function lesson_plan_files_limit() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.removed_at is null and (select count(*) from lesson_plan_files f
      where f.item_id = new.item_id and f.removed_at is null) > 10 then
    raise exception 'lesson_plan_files_limit'
      using errcode = 'check_violation', constraint = 'lesson_plan_files_limit';
  end if;
  return null;
end;
$$;

create trigger lesson_plan_files_limit
  after insert on lesson_plan_files
  for each row execute function lesson_plan_files_limit();
