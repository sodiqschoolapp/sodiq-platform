-- Task 10.8: the journal and the plan as one; files of each work (the owner's
-- spec change of 7 November 2026; `09`, What a plan contains and In the
-- journal; `edge/lesson-plans`, the limits of files). No existing row changes
-- (stop-list item 3): the new columns are null on every row, and every
-- existing file stays an item's file, which is now its "Materials".

-- ---------------------------------------------------------------------------
-- 1. An item created by a work added in the journal has no topic yet (`09`,
-- In the journal: "The item's topic stays empty until the owner writes it").
-- Look first (plan decision 1): the check now also allows the empty topic; a
-- topic of spaces is still refused, and the plan's save still requires one.

alter table lesson_plan_items drop constraint lesson_plan_items_topic_check;
alter table lesson_plan_items add constraint lesson_plan_items_topic_check check (
  length(topic) <= 300 and (topic = '' or length(btrim(topic)) >= 1)
);

-- ---------------------------------------------------------------------------
-- 2. The mark "added in the journal" on a plan work (plan decision 7): the
-- moment, from the injected clock, and the account. Insert only: the mark is
-- never taken off.

alter table lesson_plan_works
  add column added_in_journal_at timestamptz,
  add column added_in_journal_by uuid references accounts (id),
  add constraint lesson_plan_works_added_in_journal_check check (
    (added_in_journal_at is null) = (added_in_journal_by is null)
  );

grant insert (added_in_journal_at, added_in_journal_by) on lesson_plan_works to sodiq_app;

-- ---------------------------------------------------------------------------
-- 3. The files of a work. A file with no work is one of the item's materials
-- (staff only). The composite key keeps a file's work on its own item; a work
-- is deleted only once its files are removed (the trigger below), and then
-- the removed files lose the link (their audit entries keep it).

alter table lesson_plan_works
  add constraint lesson_plan_works_id_item_branch_key unique (id, item_id, branch_id);

alter table lesson_plan_files add column work_id uuid;
alter table lesson_plan_files add constraint lesson_plan_files_work_fkey
  foreign key (work_id, item_id, branch_id)
  references lesson_plan_works (id, item_id, branch_id) on delete set null (work_id);

create index lesson_plan_files_work_idx on lesson_plan_files (work_id) where work_id is not null;

grant insert (work_id) on lesson_plan_files to sodiq_app;

-- A work that still holds a file not removed is not deleted (plan decision 14):
-- every remover removes the files first. Runs as the invoker.
create function lesson_plan_work_files_left() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from lesson_plan_files f
    where f.work_id = old.id and f.removed_at is null
  ) then
    raise exception 'lesson_plan_work_files_left'
      using errcode = 'check_violation', constraint = 'lesson_plan_work_files_left';
  end if;
  return old;
end;
$$;

create trigger lesson_plan_work_files_left
  before delete on lesson_plan_works
  for each row execute function lesson_plan_work_files_left();

-- ---------------------------------------------------------------------------
-- 4. Look first (plan decision 2): at most 10 files not removed in an item's
-- materials and at most 10 on each work (`edge/lesson-plans`: "at most 10
-- files in an item's materials and at most 10 on each classwork or
-- homework"), counted after the route's lock of the item row.

create or replace function lesson_plan_files_limit() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.removed_at is null and (
    select count(*) from lesson_plan_files f
    where f.item_id = new.item_id
      and f.removed_at is null
      and f.work_id is not distinct from new.work_id
  ) > 10 then
    raise exception 'lesson_plan_files_limit'
      using errcode = 'check_violation', constraint = 'lesson_plan_files_limit';
  end if;
  return null;
end;
$$;
