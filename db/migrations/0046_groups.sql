-- 0046 Groups and splits (task 3.2a, pull request #91).
--
-- docs/spec/05-classes-groups-subjects.md, Group: "Subject, grade or two
-- grades, name (7-M-1), language, teacher (or a vacancy), maximum size." "Two
-- kinds. A group across classes takes students from several classes of one
-- grade ... or of two grades ... A split divides one class into parts for one
-- subject." Language of instruction, Groups: "A group takes its language from
-- its classes when they share one. A group that mixes Uzbek and Russian
-- classes is possible; the Academic Vice Principal then chooses the group's
-- language and confirms a warning."
-- docs/spec/edge-cases/academic-year.md: "Group names are unique per branch
-- and year." docs/spec/edge-cases/students-classes-groups.md: "Look-alike
-- Cyrillic and Latin letters in class and group names are treated as the
-- same." docs/spec/edge-cases/timetable.md, Structure: "The load step refuses
-- the group if ... the subject is not taught in both grades."
--
-- The plan approved on pull request #91 with corrections 1 to 4: decisions
-- 3 to 8, 10, 12 and 16. The group has no teacher (decision 15: the teacher
-- is the teacher of its teaching load row, task 3.4). The two-grade slot rule
-- is not here (decision 9): it reads dated templates and is shown by the API.
--
-- Every refusal raised here names a constraint, which the API maps to an
-- error code (apps/api/src/modules/classes/group-refusals.ts).

-- The groups of a branch. A branch table: branch_id and the one policy of
-- 0002. The year and the subject are fixed at the create (decision 5: not in
-- the update grant).
create table groups (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  academic_year_id uuid not null,
  subject_id uuid not null references subjects (id),
  -- Decision 6: 1 to GROUP_NAME_MAX_LENGTH (40) characters after trimming,
  -- letters, digits 0 to 9, spaces, hyphens and the Uzbek apostrophes; a
  -- digit may come first ("7-M-1"). Stored as typed.
  name text not null constraint groups_name_check check (
    length(btrim(name)) between 1 and 40
    and btrim(name) ~ '^[[:alpha:]0-9][[:alpha:]0-9 ''ʻʼ-]*$'
  ),
  -- The fold of class names (0042): written by the database only.
  name_key text generated always as (class_name_key(name)) stored,
  -- INSTRUCTION_LANGUAGES of packages/shared; the classes' language when they
  -- share one (groups_guard, decision 8).
  language text not null constraint groups_language_check check (language in ('uz', 'ru')),
  -- Decision 7: 1 to GROUP_MAX_SIZE (60).
  max_size smallint not null constraint groups_max_size_check check (
    max_size between 1 and 60
  ),
  -- The state the edit compares with ("group changed, reload"); raised by
  -- groups_version on every update. Every edit updates the row, also one
  -- that changes only the classes.
  version integer not null default 0,
  -- From the injected clock; empty while active.
  archived_at timestamptz,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint groups_year_fkey foreign key (academic_year_id, branch_id)
    references academic_years (id, branch_id),
  constraint groups_id_branch_key unique (id, branch_id),
  -- Decision 6: unique per branch and year, archived groups included, by the
  -- folded name.
  constraint groups_name_key unique (branch_id, academic_year_id, name_key)
);

create index groups_year_idx on groups (academic_year_id);
create index groups_subject_idx on groups (subject_id);

alter table groups enable row level security;
create policy branch_filter on groups for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on groups to sodiq_app;
grant insert (branch_id, academic_year_id, subject_id, name, language, max_size)
  on groups to sodiq_app;
grant update (name, language, max_size, archived_at) on groups to sodiq_app;

create function groups_version() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger groups_version
  before update on groups
  for each row execute function groups_version();

create function groups_fixed() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.academic_year_id is distinct from old.academic_year_id
    or new.subject_id is distinct from old.subject_id then
    raise exception 'groups_fixed'
      using errcode = 'check_violation', constraint = 'groups_fixed';
  end if;
  return new;
end;
$$;

create trigger groups_fixed
  before update on groups
  for each row execute function groups_fixed();

-- The classes a group draws from (decisions 3 and 4): one class is a split of
-- that class, several are a group across classes. Link rows with no data of
-- their own: inserted and deleted by the application, the old and the new
-- set kept in the group's audit entry.
create table group_classes (
  group_id uuid not null,
  class_id uuid not null,
  branch_id uuid not null references branches (id),
  constraint group_classes_pkey primary key (group_id, class_id),
  constraint group_classes_group_fkey foreign key (group_id, branch_id)
    references groups (id, branch_id),
  constraint group_classes_class_fkey foreign key (class_id, branch_id)
    references classes (id, branch_id)
);

create index group_classes_class_idx on group_classes (class_id);

alter table group_classes enable row level security;
create policy branch_filter on group_classes for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, delete on group_classes to sodiq_app;
grant insert (group_id, class_id, branch_id) on group_classes to sodiq_app;

-- The rules of one group, at the commit (deferred), so that a create or an
-- edit that writes the group row and its classes in several statements is
-- checked once, whole. The locks first (correction 1: the service has taken
-- the class rows FOR SHARE in the order of their id before any write, so the
-- class locks here are a re-take): the group row, the year, the subject and
-- the classes, each FOR SHARE whatever its state; the states are read after,
-- in statements of their own (.claude/rules/database.md, lock then read).
-- Runs as the invoker: the rows of the group's own branch; the subject is
-- school-wide.
create function group_rules(group_ref uuid) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  g record;
  year_state text;
  subject_archived timestamptz;
  subject_grades smallint[];
  class_count integer;
  grade_count integer;
  language_count integer;
  shared_language text;
begin
  perform 1 from groups where id = group_ref for share;
  select * into g from groups where id = group_ref;
  if not found then
    return;
  end if;

  perform 1 from academic_years y where y.id = g.academic_year_id for share;
  select y.status into year_state from academic_years y where y.id = g.academic_year_id;
  if year_state = 'closed' then
    raise exception 'group_year_closed'
      using errcode = 'check_violation', constraint = 'group_year_closed';
  end if;

  -- Decision 10: an archived group is not checked again; a restore is.
  if g.archived_at is not null then
    return;
  end if;

  perform 1 from subjects s where s.id = g.subject_id for share;
  select s.archived_at, s.grades into subject_archived, subject_grades
    from subjects s where s.id = g.subject_id;
  if subject_archived is not null then
    raise exception 'group_subject_archived'
      using errcode = 'check_violation', constraint = 'group_subject_archived';
  end if;

  perform 1 from classes c
    where c.id in (select gc.class_id from group_classes gc where gc.group_id = group_ref)
    order by c.id
    for share;

  select count(*) into class_count from group_classes gc where gc.group_id = group_ref;
  if class_count = 0 then
    raise exception 'group_needs_class'
      using errcode = 'check_violation', constraint = 'group_needs_class';
  end if;

  if exists (
    select 1 from group_classes gc
    join classes c on c.id = gc.class_id
    where gc.group_id = group_ref
      and (c.archived_at is not null or c.academic_year_id <> g.academic_year_id)
  ) then
    raise exception 'group_class_year'
      using errcode = 'check_violation', constraint = 'group_class_year';
  end if;

  select count(distinct c.grade), count(distinct c.language),
      min(c.language)
    into grade_count, language_count, shared_language
    from group_classes gc
    join classes c on c.id = gc.class_id
    where gc.group_id = group_ref;
  if grade_count > 2 then
    raise exception 'group_grades'
      using errcode = 'check_violation', constraint = 'group_grades';
  end if;

  -- Decision 16 (Look first): the subject is taught in every grade of the
  -- group.
  if exists (
    select 1 from group_classes gc
    join classes c on c.id = gc.class_id
    where gc.group_id = group_ref and not (c.grade = any (subject_grades))
  ) then
    raise exception 'group_subject_grade'
      using errcode = 'check_violation', constraint = 'group_subject_grade';
  end if;

  -- Decision 8: the classes' language when they share one.
  if language_count = 1 and g.language <> shared_language then
    raise exception 'group_language'
      using errcode = 'check_violation', constraint = 'group_language';
  end if;
end;
$$;

create function groups_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  perform group_rules(new.id);
  return null;
end;
$$;

create constraint trigger groups_guard
  after insert or update on groups
  deferrable initially deferred
  for each row execute function groups_guard();

create function group_classes_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    perform group_rules(old.group_id);
  else
    perform group_rules(new.group_id);
  end if;
  return null;
end;
$$;

create constraint trigger group_classes_guard
  after insert or delete on group_classes
  deferrable initially deferred
  for each row execute function group_classes_guard();

-- The class's side (decision 16), under the lock of the class's update: a
-- class that feeds an active group cannot change its grade nor be archived.
-- Runs as the invoker: the groups of the class's own branch.
create function classes_groups_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from group_classes gc
    join groups g on g.id = gc.group_id
    where gc.class_id = new.id and g.archived_at is null
  ) then
    return new;
  end if;
  if old.archived_at is null and new.archived_at is not null then
    raise exception 'class_in_groups'
      using errcode = 'check_violation', constraint = 'class_in_groups';
  end if;
  if new.grade <> old.grade then
    raise exception 'class_grade_groups'
      using errcode = 'check_violation', constraint = 'class_grade_groups';
  end if;
  return new;
end;
$$;

create trigger classes_groups_guard
  before update of archived_at, grade on classes
  for each row execute function classes_groups_guard();

-- A class's language change runs the language rule of its active groups
-- again at the commit (decision 8): the class edit moves the language of its
-- one-language groups in the same transaction.
create function classes_group_language() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  group_ref uuid;
begin
  for group_ref in
    select gc.group_id from group_classes gc
    join groups g on g.id = gc.group_id
    where gc.class_id = new.id and g.archived_at is null
    order by gc.group_id
  loop
    perform group_rules(group_ref);
  end loop;
  return null;
end;
$$;

create constraint trigger classes_group_language
  after update of language on classes
  deferrable initially deferred
  for each row
  when (new.language is distinct from old.language)
  execute function classes_group_language();

-- Decision 12 (Look first): the grades of the active groups of a subject in
-- every branch, with the number of those groups outside the branches of the
-- transaction. `subjects` is school-wide and its edit runs with one branch or
-- none; the row filter hides the groups of the others. Grades and counts
-- only: no group of another branch is named.
create function subject_group_grades(subject uuid)
returns table (grade smallint, groups_elsewhere integer)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select c.grade,
    count(distinct g.id) filter (
      where not (g.branch_id = any (public.app_branch_ids()))
    )::integer
  from public.groups g
  join public.group_classes gc on gc.group_id = g.id
  join public.classes c on c.id = gc.class_id
  where g.subject_id = subject and g.archived_at is null
  group by c.grade
$$;

revoke execute on function subject_group_grades(uuid) from public;
grant execute on function subject_group_grades(uuid) to sodiq_app;

-- The subject's side (decision 16), under the lock of the subject's update:
-- a grade cannot leave a subject, nor the subject be archived, while an
-- active group of any branch needs it.
create function subjects_groups_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.archived_at is null and new.archived_at is not null
    and exists (select 1 from subject_group_grades(new.id)) then
    raise exception 'subject_has_groups'
      using errcode = 'check_violation', constraint = 'subject_has_groups';
  end if;
  if new.archived_at is null and exists (
    select 1 from subject_group_grades(new.id) u where not (u.grade = any (new.grades))
  ) then
    raise exception 'subject_grade_groups'
      using errcode = 'check_violation', constraint = 'subject_grade_groups';
  end if;
  return new;
end;
$$;

create trigger subjects_groups_guard
  before update of grades, archived_at on subjects
  for each row execute function subjects_groups_guard();
