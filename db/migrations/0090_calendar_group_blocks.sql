-- 0090 The choice of a day-off entry for a block of two-grade groups (task
-- 5.6b-3, pull request #175).
--
-- docs/spec/edge-cases/time-dates-calendar.md, "A day off for grade 9 only,
-- and a group joins 9 Edinburgh and 10 Brown": "A calendar entry that leaves
-- school to only one grade of a two-grade group lists the group's blocks in
-- its preview. For each block the Academic Vice Principal chooses once, for
-- every date of the entry: cancel its lessons on those dates with the reason
-- 'day off', or keep them and exempt the students of the grade that is off,
-- as for an excursion; kept lessons take the template of the grade that has
-- school."
--
-- One row per block and date (spec review of the plan, 2 and 8): the block is
-- named by its groups (the child table), the weekday it follows and its
-- weekly start and end minutes, not by a pattern block id, so a later
-- version's block of the same groups at the same time takes the choice
-- (decision 2). A row is written and removed only for a date after today in
-- the branch's time zone (an unset moment counts as not after today), so the
-- choice a lesson was held under never changes after its date and 8.5 reads
-- it to exempt the off grade's students (decision 1).

-- The composite key the foreign key below needs.
alter table calendar_entries
  add constraint calendar_entries_id_branch_key unique (id, branch_id);

create table calendar_group_blocks (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  calendar_entry_id uuid not null,
  lesson_date date not null,
  -- ISO weekday the block follows, 1 Monday to 7 Sunday.
  weekday smallint not null constraint calendar_group_blocks_weekday_check check (
    weekday between 1 and 7
  ),
  -- The block's weekly clock time, as pattern_blocks (0058).
  start_minutes smallint not null constraint calendar_group_blocks_start_check check (
    start_minutes between 0 and 1439
  ),
  end_minutes smallint not null constraint calendar_group_blocks_end_check check (
    end_minutes between 1 and 1440
  ),
  choice text not null constraint calendar_group_blocks_choice_check check (
    choice in ('keep', 'cancel')
  ),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint calendar_group_blocks_order_check check (end_minutes > start_minutes),
  constraint calendar_group_blocks_entry_fkey foreign key (calendar_entry_id, branch_id)
    references calendar_entries (id, branch_id),
  constraint calendar_group_blocks_key
    unique (id, calendar_entry_id, lesson_date, start_minutes, branch_id)
);

create index calendar_group_blocks_entry_idx on calendar_group_blocks (calendar_entry_id, lesson_date);

-- The groups of a block. A group is in one block of an entry at a time on a
-- date (decision 3: a block is chosen whole, so no mixed state).
create table calendar_group_block_groups (
  branch_id uuid not null references branches (id),
  block_id uuid not null,
  group_id uuid not null,
  -- The block's, copied for the key below; the foreign key keeps them equal.
  calendar_entry_id uuid not null,
  lesson_date date not null,
  start_minutes smallint not null,
  constraint calendar_group_block_groups_pkey primary key (block_id, group_id),
  constraint calendar_group_block_groups_block_fkey
    foreign key (block_id, calendar_entry_id, lesson_date, start_minutes, branch_id)
    references calendar_group_blocks (id, calendar_entry_id, lesson_date, start_minutes, branch_id)
    on delete cascade,
  constraint calendar_group_block_groups_group_fkey foreign key (group_id, branch_id)
    references groups (id, branch_id),
  constraint calendar_group_block_groups_once
    unique (calendar_entry_id, lesson_date, start_minutes, group_id)
);

create index calendar_group_block_groups_group_idx on calendar_group_block_groups (group_id);

alter table calendar_group_blocks enable row level security;
create policy branch_filter on calendar_group_blocks for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

alter table calendar_group_block_groups enable row level security;
create policy branch_filter on calendar_group_block_groups for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- A choice is replaced by a delete and inserts; no update.
grant select, delete on calendar_group_blocks to sodiq_app;
grant insert (branch_id, calendar_entry_id, lesson_date, weekday, start_minutes, end_minutes, choice)
  on calendar_group_blocks to sodiq_app;
grant select, delete on calendar_group_block_groups to sodiq_app;
grant insert (branch_id, block_id, group_id, calendar_entry_id, lesson_date, start_minutes)
  on calendar_group_block_groups to sodiq_app;

-- Only a date after today is written or removed (decisions 1 and 6).
create function calendar_group_blocks_future() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  row_date date;
  row_branch uuid;
begin
  if tg_op = 'DELETE' then
    row_date := old.lesson_date;
    row_branch := old.branch_id;
  else
    row_date := new.lesson_date;
    row_branch := new.branch_id;
  end if;
  if row_date <= coalesce(branch_today(row_branch), 'infinity'::date) then
    raise exception 'calendar_group_blocks_future'
      using errcode = 'check_violation', constraint = 'calendar_group_blocks_future';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger calendar_group_blocks_future
  before insert or delete on calendar_group_blocks
  for each row execute function calendar_group_blocks_future();

create trigger calendar_group_block_groups_future
  before insert or delete on calendar_group_block_groups
  for each row execute function calendar_group_blocks_future();
