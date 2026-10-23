-- 0116 Shared plans (task 7.1c, pull request #214).
--
-- docs/spec/09-lesson-plans.md, What a plan contains: "A teacher who teaches
-- the same subject to several classes of one grade (7 Oxford and 7
-- Princeton) can share one plan between them, if the classes have the same
-- language of instruction. It is written once, and each class has its own
-- dates. A shared plan can be separated later." "A plan can be copied from
-- another class, from another teacher of the same subject and grade, or from
-- last year." docs/spec/05-classes-groups-subjects.md, Language of
-- instruction: "A shared plan can join only classes with the same language."
-- docs/spec/edge-cases/lesson-plans.md, How items stay attached: "A shared
-- plan is one list as long as the larger class. Attachment, 'not covered'
-- and completeness are per class."
--
-- The plan approved on pull request #214: the row an item stands at is kept
-- per journal of its plan (`lesson_plan_places`, decision 2, Look first), a
-- copy names what it was made from (decisions 10 and 16), and the database
-- holds the language, grade and kind of every journal of a plan
-- (`lesson_plan_share_check`, corrections 1 and 2).

-- ---------------------------------------------------------------------------
-- The places: the row of each item in each journal of its plan.

alter table lesson_plan_items
  add constraint lesson_plan_items_id_plan_key unique (id, plan_id, branch_id);

create table lesson_plan_places (
  branch_id uuid not null references branches (id),
  plan_id uuid not null,
  journal_id uuid not null,
  item_id uuid not null,
  -- The place in this journal's queue: row p is the p-th lesson of the
  -- quarter not cancelled. A position with no item is an empty row.
  position integer not null constraint lesson_plan_places_position_check check (position >= 1),
  -- The date of the started lesson the item was moved back from in this
  -- journal (task 7.1b), else null.
  moved_from date,
  constraint lesson_plan_places_link_fkey foreign key (plan_id, journal_id)
    references lesson_plan_journals (plan_id, journal_id),
  -- The item's plan is the place's plan.
  constraint lesson_plan_places_item_fkey foreign key (item_id, plan_id, branch_id)
    references lesson_plan_items (id, plan_id, branch_id),
  constraint lesson_plan_places_row_key unique (branch_id, plan_id, journal_id, position),
  primary key (plan_id, journal_id, item_id)
);

create index lesson_plan_places_item_idx on lesson_plan_places (item_id);

alter table lesson_plan_places enable row level security;
create policy branch_filter on lesson_plan_places for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- A cleared item and a journal that leaves the plan lose their places.
grant select, insert, delete on lesson_plan_places to sodiq_app;
grant update (position, moved_from) on lesson_plan_places to sodiq_app;

-- Every item not cleared, in the one journal its plan had until now (0114:
-- one plan per journal), at its position, with its mark.
insert into lesson_plan_places (branch_id, plan_id, journal_id, item_id, position, moved_from)
select i.branch_id, i.plan_id, j.journal_id, i.id, i.position, i.moved_from
from lesson_plan_items i
join lesson_plan_journals j on j.plan_id = i.plan_id
where i.cleared_at is null;

-- The order is per journal now; the index on (plan, position) goes with it.
alter table lesson_plan_items drop column position;
alter table lesson_plan_items drop column moved_from;

-- ---------------------------------------------------------------------------
-- Copies: what an item and a file were made from (decisions 10 and 16).

alter table lesson_plan_items add column copied_from uuid;
alter table lesson_plan_items add constraint lesson_plan_items_copied_from_fkey
  foreign key (copied_from, branch_id) references lesson_plan_items (id, branch_id);

grant insert (copied_from) on lesson_plan_items to sodiq_app;

alter table lesson_plan_files
  add constraint lesson_plan_files_id_branch_key unique (id, branch_id);
-- The file whose bytes this one shows (`plans/<item>/<file>` of that file);
-- always the first, never a copy.
alter table lesson_plan_files add column copied_from uuid;
alter table lesson_plan_files add constraint lesson_plan_files_copied_from_fkey
  foreign key (copied_from, branch_id) references lesson_plan_files (id, branch_id);

grant insert (copied_from) on lesson_plan_files to sodiq_app;

-- ---------------------------------------------------------------------------
-- A journal joins a plan or leaves it: its link moves to the other plan
-- (decision 5), so "one plan per journal and quarter"
-- (`lesson_plan_journals_key`) holds at every statement. The plan and its
-- items stay. What hangs on the link (its snapshot, absorbed shifts and
-- prepared request, decision 7) goes with it: the same keys, now `on update
-- cascade`.

grant update (plan_id) on lesson_plan_journals to sodiq_app;

alter table lesson_plan_rows drop constraint lesson_plan_rows_plan_fkey;
alter table lesson_plan_rows add constraint lesson_plan_rows_plan_fkey
  foreign key (plan_id, journal_id) references lesson_plan_journals (plan_id, journal_id)
  on update cascade;
alter table lesson_plan_absorbed drop constraint lesson_plan_absorbed_plan_fkey;
alter table lesson_plan_absorbed add constraint lesson_plan_absorbed_plan_fkey
  foreign key (plan_id, journal_id) references lesson_plan_journals (plan_id, journal_id)
  on update cascade;
alter table lesson_plan_requests drop constraint lesson_plan_requests_plan_fkey;
alter table lesson_plan_requests add constraint lesson_plan_requests_plan_fkey
  foreign key (plan_id, journal_id) references lesson_plan_journals (plan_id, journal_id)
  on update cascade;

-- ---------------------------------------------------------------------------
-- Who shares a plan (decision 3): every journal a class journal of one grade,
-- or every one a group journal of the same grades, and one language of
-- instruction. The quarter is held by `lesson_plan_journals_plan_fkey`.
-- Locks the journals of the plan first (`for no key update`, in the order of
-- the id, as every plan write and the follow do), in a statement of its own,
-- so that two joins of one plan check one after the other. Runs as the
-- invoker.
create function lesson_plan_share_check_plan(plan uuid) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  kinds integer;
  languages integer;
  grade_sets integer;
begin
  perform 1 from journals j
    where j.id in (select l.journal_id from lesson_plan_journals l where l.plan_id = plan)
    order by j.id
    for no key update;
  select count(distinct (j.class_id is null)),
         count(distinct coalesce(c.language, g.language)),
         count(distinct (
           case when j.class_id is not null then array[c.grade]
           else array(
             select distinct gc_class.grade from group_classes gc
             join classes gc_class on gc_class.id = gc.class_id
             where gc.group_id = j.group_id
             order by 1
           ) end
         ))
    into kinds, languages, grade_sets
  from lesson_plan_journals l
  join journals j on j.id = l.journal_id
  left join classes c on c.id = j.class_id
  left join groups g on g.id = j.group_id
  where l.plan_id = plan;
  if kinds > 1 then
    raise exception 'lesson_plan_share_kind'
      using errcode = 'check_violation', constraint = 'lesson_plan_share_kind';
  end if;
  if languages > 1 then
    raise exception 'lesson_plan_share_language'
      using errcode = 'check_violation', constraint = 'lesson_plan_share_language';
  end if;
  if grade_sets > 1 then
    raise exception 'lesson_plan_share_grade'
      using errcode = 'check_violation', constraint = 'lesson_plan_share_grade';
  end if;
end;
$$;

-- The plans with more than one journal that a class, a group or a group's
-- classes take part in.
create function lesson_plan_shared_of_units(class uuid, grp uuid)
returns table (plan_id uuid)
language sql
stable
set search_path = pg_catalog, public
as $$
  select distinct l.plan_id
  from journals j
  join lesson_plan_journals l on l.journal_id = j.id
  where (j.class_id = class
      or j.group_id = grp
      or j.group_id in (select gc.group_id from group_classes gc where gc.class_id = class))
    and (select count(*) from lesson_plan_journals o where o.plan_id = l.plan_id) > 1
  order by 1;
$$;

-- At the commit: a join, a class's language or grade, a group's language or
-- classes (the plan review of #214, corrections 1 and 2). Runs as the invoker.
create function lesson_plan_share_check() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  plan uuid;
  class uuid;
  grp uuid;
begin
  if tg_table_name = 'lesson_plan_journals' then
    -- A link deleted since (a journal that left again) checks nothing.
    if exists (select 1 from lesson_plan_journals l
               where l.plan_id = new.plan_id and l.journal_id = new.journal_id) then
      perform lesson_plan_share_check_plan(new.plan_id);
    end if;
    return null;
  end if;
  -- Nested: PL/pgSQL resolves a record's fields when the statement is planned.
  if tg_table_name = 'classes' then
    class := new.id;
  elsif tg_table_name = 'groups' then
    grp := new.id;
  elsif tg_op = 'DELETE' then
    class := old.class_id;
    grp := old.group_id;
  else
    class := new.class_id;
    grp := new.group_id;
  end if;
  for plan in
    select s.plan_id from lesson_plan_shared_of_units(class, grp) s
  loop
    perform lesson_plan_share_check_plan(plan);
  end loop;
  return null;
end;
$$;

create constraint trigger lesson_plan_journals_share
  after insert or update of plan_id on lesson_plan_journals
  deferrable initially deferred
  for each row execute function lesson_plan_share_check();

create constraint trigger lesson_plan_classes_share
  after update of language, grade on classes
  deferrable initially deferred
  for each row
  when (new.language is distinct from old.language or new.grade is distinct from old.grade)
  execute function lesson_plan_share_check();

create constraint trigger lesson_plan_groups_share
  after update of language on groups
  deferrable initially deferred
  for each row
  when (new.language is distinct from old.language)
  execute function lesson_plan_share_check();

create constraint trigger lesson_plan_group_classes_share
  after insert or delete on group_classes
  deferrable initially deferred
  for each row execute function lesson_plan_share_check();

-- The same changes mark the journals of the shared plans they touch, so the
-- follow separates them before the commit (decision 17, cause
-- `unit_changed`). Runs as the invoker.
create function lesson_plan_mark_units() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  class uuid;
  grp uuid;
begin
  if not lesson_history_applies() then
    return null;
  end if;
  -- Nested: PL/pgSQL resolves a record's fields when the statement is planned.
  if tg_table_name = 'classes' then
    class := new.id;
  elsif tg_table_name = 'groups' then
    grp := new.id;
  elsif tg_op = 'DELETE' then
    class := old.class_id;
    grp := old.group_id;
  else
    class := new.class_id;
    grp := new.group_id;
  end if;
  insert into lesson_plan_follow_marks (branch_id, journal_id)
  select l.branch_id, l.journal_id
  from lesson_plan_journals l
  where l.plan_id in (select s.plan_id from lesson_plan_shared_of_units(class, grp) s);
  return null;
end;
$$;

create trigger lesson_plan_mark_classes
  after update of language, grade on classes
  for each row
  when (new.language is distinct from old.language or new.grade is distinct from old.grade)
  execute function lesson_plan_mark_units();

create trigger lesson_plan_mark_groups
  after update of language on groups
  for each row
  when (new.language is distinct from old.language)
  execute function lesson_plan_mark_units();

create trigger lesson_plan_mark_group_classes
  after insert or delete on group_classes
  for each row execute function lesson_plan_mark_units();
