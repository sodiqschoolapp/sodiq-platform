-- 0118 Master plans (task 7.3, pull request #216).
--
-- docs/spec/09-lesson-plans.md, Master plans: "A Head Teacher can keep a
-- master plan for one of their subjects, a grade, a language of instruction
-- and a quarter: the same list of topics, classwork and homework, in order,
-- but with no dates. A Senior Head Teacher can keep one master for all
-- branches. For subjects with no Head Teacher, the Academic Vice Principal
-- can keep it." "Independent copy. After copying, the teacher's plan is
-- their own." "Master updated. Teachers who copied it see 'master updated'
-- with a side-by-side comparison." "Not tied to the window. The Head Teacher
-- can edit the master at any time; its history is kept."
-- docs/spec/edge-cases/lesson-plans.md, Plans and the journal: "Items are
-- matched by identity, not by position. ... A subject and grade can have
-- several named masters, for levels or languages."
--
-- The plan approved on pull request #216: a master of all branches has no
-- branch, so the three master tables carry a branch that may be empty and
-- one policy `branch_or_school` (decision 1, Look first; the list
-- BRANCH_OR_SCHOOL_TABLES of apps/api/src/database/catalog.test.ts). A plain
-- foreign key with an empty column is not checked, so every child names its
-- parent with `scope_key`, the branch or the nil id (spec review of the plan,
-- must-fix 1). A master belongs to a year by its start year and to a quarter
-- by its number (decision 4). Every write raises the master's `revision`
-- (decision 9); an item keeps the revisions that added, changed and removed
-- it, and is never deleted, so the comparison names it by identity
-- (decisions 5 and 8). The bounds are the constants of
-- packages/shared/src/plans.ts.

-- ---------------------------------------------------------------------------
-- The masters.

create table lesson_plan_masters (
  id uuid primary key default uuidv7(),
  -- Empty for a master of all branches (the Senior Head Teacher's).
  branch_id uuid references branches (id),
  scope_key uuid not null generated always as (
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) stored,
  subject_id uuid not null references subjects (id),
  grade smallint not null constraint lesson_plan_masters_grade_check check (grade between 1 and 11),
  -- INSTRUCTION_LANGUAGES of packages/shared.
  language text not null constraint lesson_plan_masters_language_check check (language in ('uz', 'ru')),
  -- The academic year "<start>-<end>" by its start year (0016).
  start_year smallint not null constraint lesson_plan_masters_start_year_check check (
    start_year between 2000 and 2100
  ),
  quarter smallint not null constraint lesson_plan_masters_quarter_check check (quarter between 1 and 4),
  -- PLAN_MASTER_NAME_MAX_LENGTH (decision 14).
  name text not null constraint lesson_plan_masters_name_check check (
    length(btrim(name)) between 1 and 60
  ),
  -- Raised by every write of the master or its items (decision 9).
  revision integer not null default 0 constraint lesson_plan_masters_revision_check check (revision >= 0),
  -- From the injected clock; empty while active. Archived, never deleted.
  archived_at timestamptz,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint lesson_plan_masters_scope_key unique (id, scope_key)
);

create unique index lesson_plan_masters_name_idx
  on lesson_plan_masters (scope_key, subject_id, grade, language, start_year, quarter, lower(btrim(name)))
  where archived_at is null;

alter table lesson_plan_masters enable row level security;
create policy branch_or_school on lesson_plan_masters for all to sodiq_app
  using (branch_id is null or branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id is null or branch_id = any ((select app_branch_ids())::uuid[]));

-- The branch, subject, grade, language, year and quarter never change: a
-- master never moves between a branch and all branches.
grant select on lesson_plan_masters to sodiq_app;
grant insert (id, branch_id, subject_id, grade, language, start_year, quarter, name)
  on lesson_plan_masters to sodiq_app;
grant update (name, revision, archived_at) on lesson_plan_masters to sodiq_app;

-- The subject is graded and teaches the grade (09: "Attendance-only subjects
-- ... have no plan"); the revision only grows. Runs as the invoker.
create function lesson_plan_masters_check() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  kind text;
  taught smallint[];
begin
  if tg_op = 'UPDATE' then
    if new.revision < old.revision then
      raise exception 'lesson_plan_master_revision'
        using errcode = 'check_violation', constraint = 'lesson_plan_master_revision';
    end if;
    return new;
  end if;
  select s.journal_type, s.grades into kind, taught from subjects s where s.id = new.subject_id;
  if kind is distinct from 'graded' then
    raise exception 'lesson_plan_master_attendance_only'
      using errcode = 'check_violation', constraint = 'lesson_plan_master_attendance_only';
  end if;
  if not (new.grade = any (taught)) then
    raise exception 'lesson_plan_master_grade'
      using errcode = 'check_violation', constraint = 'lesson_plan_master_grade';
  end if;
  return new;
end;
$$;

create trigger lesson_plan_masters_check
  before insert or update on lesson_plan_masters
  for each row execute function lesson_plan_masters_check();

-- ---------------------------------------------------------------------------
-- The items of a master, never deleted.

create table lesson_plan_master_items (
  id uuid primary key default uuidv7(),
  branch_id uuid references branches (id),
  scope_key uuid not null generated always as (
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) stored,
  master_id uuid not null,
  -- The order in the master, from 1, among the items not removed.
  position integer not null constraint lesson_plan_master_items_position_check check (position >= 1),
  -- PLAN_TOPIC_MAX_LENGTH, PLAN_OBJECTIVES_MAX_LENGTH and the links of 0114.
  topic text not null constraint lesson_plan_master_items_topic_check check (
    length(btrim(topic)) >= 1 and length(topic) <= 300
  ),
  objectives text not null default '' constraint lesson_plan_master_items_objectives_check check (
    length(objectives) <= 2000
  ),
  links text[] not null default '{}' constraint lesson_plan_master_items_links_check check (
    lesson_plan_links_valid(links) is true
  ),
  -- The revisions of the master that added the item, changed its content
  -- last, and removed it (empty while it is in the master).
  added_revision integer not null,
  changed_revision integer not null,
  removed_revision integer,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint lesson_plan_master_items_master_fkey foreign key (master_id, scope_key)
    references lesson_plan_masters (id, scope_key),
  constraint lesson_plan_master_items_scope_key unique (id, scope_key),
  constraint lesson_plan_master_items_revisions_check check (
    changed_revision >= added_revision
    and (removed_revision is null or removed_revision >= changed_revision)
  )
);

-- Moved in two steps by the route, as the places of a plan (`movePlaces`).
create unique index lesson_plan_master_items_position_idx
  on lesson_plan_master_items (master_id, position) where removed_revision is null;

alter table lesson_plan_master_items enable row level security;
create policy branch_or_school on lesson_plan_master_items for all to sodiq_app
  using (branch_id is null or branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id is null or branch_id = any ((select app_branch_ids())::uuid[]));

grant select on lesson_plan_master_items to sodiq_app;
grant insert (id, branch_id, master_id, position, topic, objectives, links, added_revision,
  changed_revision) on lesson_plan_master_items to sodiq_app;
grant update (position, topic, objectives, links, changed_revision, removed_revision)
  on lesson_plan_master_items to sodiq_app;

-- The revisions an item is written with are the master's current one, which
-- every write raises first (`writeOf`): an older revision would hide a change
-- from every plan's comparison (`.claude/rules/database.md`, a counter that
-- decides which rows count; spec review of the code, should-fix 7). Runs as
-- the invoker, after the route locked the master.
create function lesson_plan_master_items_revision() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  current_revision integer;
begin
  select m.revision into current_revision
    from lesson_plan_masters m where m.id = new.master_id;
  if tg_op = 'INSERT' then
    if new.added_revision is distinct from current_revision
      or new.changed_revision is distinct from current_revision
      or new.removed_revision is not null then
      raise exception 'lesson_plan_master_item_revision'
        using errcode = 'check_violation', constraint = 'lesson_plan_master_item_revision';
    end if;
    return new;
  end if;
  if new.master_id is distinct from old.master_id
    or new.added_revision is distinct from old.added_revision
    or (new.changed_revision is distinct from old.changed_revision
      and new.changed_revision is distinct from current_revision)
    or (new.removed_revision is distinct from old.removed_revision
      and (old.removed_revision is not null or new.removed_revision is distinct from current_revision)) then
    raise exception 'lesson_plan_master_item_revision'
      using errcode = 'check_violation', constraint = 'lesson_plan_master_item_revision';
  end if;
  return new;
end;
$$;

create trigger lesson_plan_master_items_revision
  before insert or update on lesson_plan_master_items
  for each row execute function lesson_plan_master_items_revision();

-- ---------------------------------------------------------------------------
-- The classworks and homeworks of a master item. A work removed from an item
-- is deleted, its values in the audit entry of the save (as 0114, decision 8).

create table lesson_plan_master_works (
  id uuid primary key default uuidv7(),
  branch_id uuid references branches (id),
  scope_key uuid not null generated always as (
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) stored,
  item_id uuid not null,
  kind text not null constraint lesson_plan_master_works_kind_check check (kind in ('classwork', 'homework')),
  position integer not null constraint lesson_plan_master_works_position_check check (position >= 1),
  title text not null constraint lesson_plan_master_works_title_check check (
    length(btrim(title)) >= 1 and length(title) <= 60
  ),
  description text not null default '' constraint lesson_plan_master_works_description_check check (
    length(description) <= 1000
  ),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint lesson_plan_master_works_item_fkey foreign key (item_id, scope_key)
    references lesson_plan_master_items (id, scope_key)
);

create index lesson_plan_master_works_item_idx on lesson_plan_master_works (item_id);

alter table lesson_plan_master_works enable row level security;
create policy branch_or_school on lesson_plan_master_works for all to sodiq_app
  using (branch_id is null or branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id is null or branch_id = any ((select app_branch_ids())::uuid[]));

grant select, delete on lesson_plan_master_works to sodiq_app;
grant insert (id, branch_id, item_id, kind, position, title, description)
  on lesson_plan_master_works to sodiq_app;
grant update (position, title, description) on lesson_plan_master_works to sodiq_app;

-- At most PLAN_WORKS_MAX works of a kind per item; the route locks the master
-- row first, so two saves count one after the other. Runs as the invoker.
create function lesson_plan_master_works_limit() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (select count(*) from lesson_plan_master_works w
      where w.item_id = new.item_id and w.kind = new.kind) > 10 then
    raise exception 'lesson_plan_works_limit'
      using errcode = 'check_violation', constraint = 'lesson_plan_works_limit';
  end if;
  return null;
end;
$$;

create trigger lesson_plan_master_works_limit
  after insert on lesson_plan_master_works
  for each row execute function lesson_plan_master_works_limit();

-- ---------------------------------------------------------------------------
-- A plan's master and an item's master item.

-- The master a plan was copied from and the revision copied, taken or kept
-- (decisions 6 and 10). Since 7.2 the plan record exists before any copy, so
-- the copy updates both (spec review of the plan, must-fix 2).
alter table lesson_plans add column master_id uuid references lesson_plan_masters (id);
alter table lesson_plans add column master_revision integer;
alter table lesson_plans add constraint lesson_plans_master_check check (
  (master_id is null) = (master_revision is null)
);

grant insert (master_id, master_revision) on lesson_plans to sodiq_app;
grant update (master_id, master_revision) on lesson_plans to sodiq_app;

-- The master item an item was copied from (decision 11: copied with the item).
alter table lesson_plan_items add column master_item_id uuid
  references lesson_plan_master_items (id);

create index lesson_plan_items_master_item_idx on lesson_plan_items (master_item_id)
  where master_item_id is not null;

grant insert (master_item_id) on lesson_plan_items to sodiq_app;

-- A plan names a master of its own branch or of all branches, and an item a
-- master item of the same; a key of a branch table to a row another branch
-- owns is refused whatever the application does. Runs as the invoker.
create function lesson_plan_master_scope(master_branch uuid, own_branch uuid) returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select master_branch is null or master_branch = own_branch
$$;

create function lesson_plans_master_check() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  found_branch uuid;
  found boolean;
begin
  if new.master_id is null then
    return new;
  end if;
  select true, m.branch_id into found, found_branch
    from lesson_plan_masters m where m.id = new.master_id;
  if found is not true or not lesson_plan_master_scope(found_branch, new.branch_id) then
    raise exception 'lesson_plan_master_branch'
      using errcode = 'check_violation', constraint = 'lesson_plan_master_branch';
  end if;
  return new;
end;
$$;

create trigger lesson_plans_master_check
  before insert or update of master_id on lesson_plans
  for each row execute function lesson_plans_master_check();

create function lesson_plan_items_master_check() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  found_branch uuid;
  found boolean;
begin
  if new.master_item_id is null then
    return new;
  end if;
  select true, i.branch_id into found, found_branch
    from lesson_plan_master_items i where i.id = new.master_item_id;
  if found is not true or not lesson_plan_master_scope(found_branch, new.branch_id) then
    raise exception 'lesson_plan_master_branch'
      using errcode = 'check_violation', constraint = 'lesson_plan_master_branch';
  end if;
  return new;
end;
$$;

create trigger lesson_plan_items_master_check
  before insert on lesson_plan_items
  for each row execute function lesson_plan_items_master_check();
