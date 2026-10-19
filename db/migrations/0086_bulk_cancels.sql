-- 0086 The record of a bulk cancel (task 5.6a-3, pull request #162).
--
-- docs/spec/06-timetable.md, Changes after publishing: "Bulk cancel. For an
-- event: chosen classes, date and slots, with a reason."
-- docs/spec/edge-cases/timetable.md, After publishing: "7 Oxford goes on an
-- excursion, and group 7-M-1 has students from 7 Oxford and 7 Princeton. The
-- bulk cancel lists such blocks. For each, the Academic Vice Principal
-- chooses: cancel the whole block, or keep it and exempt the students of the
-- chosen classes for those slots in the same action."; Versions and drafts:
-- "One-day changes, absences, room closures and exams are stored on their own
-- and applied again after a publish." docs/spec/edge-cases/exemptions.md: "A
-- slot exemption is stored as a time range on that date."
--
-- The cancel itself is written on the lessons (cause `reason`, 0058), whose
-- claims and checks guard it. These tables keep what was chosen, so that
-- 5.6a-5 can apply it again after a publish and 8.5 can make the cells of the
-- chosen classes' students in a kept block exempt (decision 1): the classes,
-- the time each class is away by its own day (`bulk_cancel_spans`), and the
-- choice for each block shared with classes not chosen. Insert only.

-- Whether a list of lesson numbers is sorted and distinct. Immutable, for the
-- check below (a check takes no subquery).
create function bulk_cancel_numbers_sorted(numbers smallint[]) returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select numbers = array(select distinct n from unnest(numbers) n order by n)
$$;

create table bulk_cancels (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  cancel_date date not null,
  -- The chosen lesson numbers, sorted and distinct (decision 2).
  lesson_numbers smallint[] not null constraint bulk_cancels_lesson_numbers_check check (
    cardinality(lesson_numbers) between 1 and 20
    and array_position(lesson_numbers, null) is null
    and 1 <= all (lesson_numbers) and 20 >= all (lesson_numbers)
    and bulk_cancel_numbers_sorted(lesson_numbers)
  ),
  reason text not null constraint bulk_cancels_reason_check check (
    length(btrim(reason)) between 1 and 500
  ),
  -- The moment of the change, from the transaction's moment (the injected clock).
  changed_at timestamptz not null,
  changed_by uuid not null references accounts (id),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint bulk_cancels_id_branch_key unique (id, branch_id)
);

create index bulk_cancels_date_idx on bulk_cancels (branch_id, cancel_date);

-- The chosen classes.
create table bulk_cancel_classes (
  branch_id uuid not null references branches (id),
  bulk_cancel_id uuid not null,
  class_id uuid not null,
  constraint bulk_cancel_classes_pkey primary key (bulk_cancel_id, class_id, branch_id),
  constraint bulk_cancel_classes_cancel_fkey foreign key (bulk_cancel_id, branch_id)
    references bulk_cancels (id, branch_id),
  constraint bulk_cancel_classes_class_fkey foreign key (class_id, branch_id)
    references classes (id, branch_id)
);

create index bulk_cancel_classes_class_idx on bulk_cancel_classes (class_id);

-- The time a chosen class is away: each chosen lesson number its own day of
-- the date has, at that day's times (decision 2).
create table bulk_cancel_spans (
  branch_id uuid not null references branches (id),
  bulk_cancel_id uuid not null,
  class_id uuid not null,
  lesson_number smallint not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  constraint bulk_cancel_spans_pkey primary key (bulk_cancel_id, class_id, lesson_number, branch_id),
  constraint bulk_cancel_spans_time_check check (starts_at < ends_at),
  constraint bulk_cancel_spans_class_fkey foreign key (bulk_cancel_id, class_id, branch_id)
    references bulk_cancel_classes (bulk_cancel_id, class_id, branch_id)
);

-- Each block shared with classes not chosen, and what was chosen for it
-- (decision 7). What the block was is kept, so that 5.6a-5 can sort the row
-- after a publish removed the block (`block_id` set to null, as 0085).
create table bulk_cancel_blocks (
  branch_id uuid not null references branches (id),
  bulk_cancel_id uuid not null,
  -- Null once a publish removed the block.
  block_id uuid,
  choice text not null constraint bulk_cancel_blocks_choice_check check (choice in ('keep', 'cancel')),
  lesson_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  constraint bulk_cancel_blocks_time_check check (starts_at < ends_at),
  constraint bulk_cancel_blocks_cancel_fkey foreign key (bulk_cancel_id, branch_id)
    references bulk_cancels (id, branch_id),
  constraint bulk_cancel_blocks_block_fkey foreign key (block_id, branch_id)
    references lesson_blocks (id, branch_id) on delete set null (block_id)
);

create unique index bulk_cancel_blocks_key on bulk_cancel_blocks (bulk_cancel_id, block_id, branch_id)
  where block_id is not null;
create index bulk_cancel_blocks_block_idx on bulk_cancel_blocks (block_id)
  where block_id is not null;

alter table bulk_cancels enable row level security;
create policy branch_filter on bulk_cancels for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

alter table bulk_cancel_classes enable row level security;
create policy branch_filter on bulk_cancel_classes for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

alter table bulk_cancel_spans enable row level security;
create policy branch_filter on bulk_cancel_spans for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

alter table bulk_cancel_blocks enable row level security;
create policy branch_filter on bulk_cancel_blocks for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on bulk_cancels to sodiq_app;
grant insert (branch_id, cancel_date, lesson_numbers, reason, changed_at, changed_by)
  on bulk_cancels to sodiq_app;
grant select on bulk_cancel_classes to sodiq_app;
grant insert (branch_id, bulk_cancel_id, class_id) on bulk_cancel_classes to sodiq_app;
grant select on bulk_cancel_spans to sodiq_app;
grant insert (branch_id, bulk_cancel_id, class_id, lesson_number, starts_at, ends_at)
  on bulk_cancel_spans to sodiq_app;
grant select on bulk_cancel_blocks to sodiq_app;
grant insert (branch_id, bulk_cancel_id, block_id, choice, lesson_date, starts_at, ends_at)
  on bulk_cancel_blocks to sodiq_app;
