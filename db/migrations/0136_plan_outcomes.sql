-- 0136 Outcomes of "not covered" items and the carry at closing (task 9.2d,
-- pull request #233).
--
-- docs/spec/edge-cases/lesson-plans.md, Plans and the journal, "Items are
-- still 'not covered' at the end of the quarter": "Each item gets one
-- outcome: merged into a lesson, carried, or dropped with a reason; only the
-- approver can drop. Carried items wait in a 'carried in' tray on the next
-- quarter's plan. Items unresolved at closing are carried automatically. In
-- quarter 4 only merge or drop exist." docs/spec/09-lesson-plans.md: "'Not
-- covered' items are never dropped silently."
--
-- The plan approved on pull request #233 with corrections 1 to 4: the
-- outcomes and the tray are kept by journal and quarter, not by plan, so a
-- join or a separation (which moves `lesson_plan_journals.plan_id`, 0116)
-- never meets their keys (decision 6); the merge keeps the date of its row
-- (`edge/lesson-plans`: "History and requests refer to dates").

-- ---------------------------------------------------------------------------
-- The outcomes: one per item and journal, never changed.

create table lesson_plan_outcomes (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  journal_id uuid not null,
  quarter_id uuid not null,
  item_id uuid not null,
  kind text not null constraint lesson_plan_outcomes_kind_check check (
    kind in ('merged', 'carried', 'dropped')
  ),
  -- The date of the row merged into; `merged` only.
  target_date date,
  -- PLAN_DROP_REASON_MAX_LENGTH; `dropped` only, empty otherwise.
  reason text not null default '',
  -- The close's own carry (decision 12).
  automatic boolean not null default false,
  -- The person: the closer for an automatic carry.
  decided_by uuid not null references accounts (id),
  -- The transaction's moment (`app.now`), written again by the trigger below.
  decided_at timestamptz not null,
  -- The copy in the next quarter's plan; `carried` only.
  carried_item_id uuid,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint lesson_plan_outcomes_journal_fkey foreign key (journal_id, branch_id)
    references journals (id, branch_id),
  constraint lesson_plan_outcomes_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id),
  constraint lesson_plan_outcomes_item_fkey foreign key (item_id, branch_id)
    references lesson_plan_items (id, branch_id),
  constraint lesson_plan_outcomes_copy_fkey foreign key (carried_item_id, branch_id)
    references lesson_plan_items (id, branch_id),
  constraint lesson_plan_outcomes_merged_check check (
    (kind = 'merged') = (target_date is not null)
  ),
  constraint lesson_plan_outcomes_reason_check check (
    case when kind = 'dropped'
      then length(btrim(reason)) >= 1 and length(reason) <= 500
      else reason = ''
    end
  ),
  constraint lesson_plan_outcomes_carried_check check (
    (kind = 'carried') = (carried_item_id is not null)
  ),
  constraint lesson_plan_outcomes_automatic_check check (not automatic or kind = 'carried'),
  constraint lesson_plan_outcomes_key unique (branch_id, journal_id, quarter_id, item_id),
  constraint lesson_plan_outcomes_id_branch_key unique (id, branch_id)
);

create index lesson_plan_outcomes_journal_idx on lesson_plan_outcomes (journal_id, quarter_id);

alter table lesson_plan_outcomes enable row level security;
create policy branch_filter on lesson_plan_outcomes for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- Append-only: history of the plan (`09`: "Every change after the window is kept in history").
grant select on lesson_plan_outcomes to sodiq_app;
grant insert (
  id, branch_id, journal_id, quarter_id, item_id, kind, target_date, reason, automatic,
  decided_by, decided_at, carried_item_id
) on lesson_plan_outcomes to sodiq_app;

-- The next quarter of a quarter in its year, or null for the last one.
create function quarter_next(quarter_ref uuid) returns uuid
language sql
stable
set search_path = pg_catalog, public
as $$
  select n.id from quarters q
  join quarters n on n.academic_year_id = q.academic_year_id and n.number > q.number
  where q.id = quarter_ref
  order by n.number
  limit 1
$$;

grant execute on function quarter_next(uuid) to sodiq_app;

-- The checks of an outcome. Runs as the invoker. Whether the item still
-- stands past the last row or in the tray is decided in code under the
-- plan's lock (the rows are worked out, not stored).
create function lesson_plan_outcomes_check() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  next_quarter uuid;
begin
  -- `edge/lesson-plans`, Plans and the journal: "Nothing is possible in a closed quarter."
  perform quarter_journal_open_guard(new.quarter_id, new.journal_id);
  -- The item is of a plan of that quarter that serves the journal, or in its tray.
  if not exists (
    select 1 from lesson_plan_items i
    join lesson_plans p on p.id = i.plan_id
    where i.id = new.item_id and p.quarter_id = new.quarter_id
      and (
        exists (select 1 from lesson_plan_journals l
                where l.plan_id = i.plan_id and l.journal_id = new.journal_id)
        or exists (select 1 from lesson_plan_tray t
                   where t.item_id = new.item_id and t.journal_id = new.journal_id
                     and t.quarter_id = new.quarter_id)
      )
  ) then
    raise exception 'lesson_plan_outcome_item'
      using errcode = 'check_violation', constraint = 'lesson_plan_outcome_item';
  end if;
  if new.kind = 'carried' then
    -- "In quarter 4 only merge or drop exist"; nothing is written into a closed quarter.
    next_quarter := quarter_next(new.quarter_id);
    if next_quarter is null then
      raise exception 'lesson_plan_carry_refused'
        using errcode = 'check_violation', constraint = 'lesson_plan_carry_refused';
    end if;
    perform 1 from quarters q where q.id = next_quarter for key share;
    if quarter_is_closed(next_quarter) then
      raise exception 'lesson_plan_carry_refused'
        using errcode = 'check_violation', constraint = 'lesson_plan_carry_refused';
    end if;
  end if;
  -- `.claude/rules/database.md`: a moment a rule reads comes from the injected clock.
  -- The migrator's fixtures have no moment and keep the one they write.
  new.decided_at := coalesce(class_tutors_moment(), new.decided_at);
  return new;
end;
$$;

create trigger lesson_plan_outcomes_check
  before insert on lesson_plan_outcomes
  for each row execute function lesson_plan_outcomes_check();

-- ---------------------------------------------------------------------------
-- The "carried in" tray: the copies of carried items that wait on the next
-- quarter's plan of their journal for a row. A row leaves when its item is
-- placed or gets an outcome of its own; a separation moves it to the copy
-- the separated plan holds (`item_id`).

create table lesson_plan_tray (
  branch_id uuid not null references branches (id),
  journal_id uuid not null,
  -- The next quarter: the quarter of the plan the copy is in.
  quarter_id uuid not null,
  item_id uuid not null,
  outcome_id uuid not null,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint lesson_plan_tray_journal_fkey foreign key (journal_id, branch_id)
    references journals (id, branch_id),
  constraint lesson_plan_tray_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id),
  constraint lesson_plan_tray_item_fkey foreign key (item_id, branch_id)
    references lesson_plan_items (id, branch_id),
  constraint lesson_plan_tray_outcome_fkey foreign key (outcome_id, branch_id)
    references lesson_plan_outcomes (id, branch_id),
  primary key (journal_id, quarter_id, item_id)
);

create index lesson_plan_tray_item_idx on lesson_plan_tray (item_id);

alter table lesson_plan_tray enable row level security;
create policy branch_filter on lesson_plan_tray for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert, delete on lesson_plan_tray to sodiq_app;
grant update (item_id) on lesson_plan_tray to sodiq_app;

-- A tray row is written, moved and taken only while its quarter is open for
-- its journal; the copy is an item of a plan of that quarter. Runs as the
-- invoker.
create function lesson_plan_tray_check() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  row_quarter uuid;
  row_journal uuid;
begin
  if tg_op = 'DELETE' then
    row_quarter := old.quarter_id;
    row_journal := old.journal_id;
  else
    row_quarter := new.quarter_id;
    row_journal := new.journal_id;
  end if;
  perform quarter_journal_open_guard(row_quarter, row_journal);
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.journal_id is distinct from old.journal_id
      or new.quarter_id is distinct from old.quarter_id) then
    raise exception 'lesson_plan_tray_moved'
      using errcode = 'check_violation', constraint = 'lesson_plan_tray_moved';
  end if;
  if not exists (
    select 1 from lesson_plan_items i
    join lesson_plans p on p.id = i.plan_id
    where i.id = new.item_id and p.quarter_id = new.quarter_id
  ) then
    raise exception 'lesson_plan_tray_item'
      using errcode = 'check_violation', constraint = 'lesson_plan_tray_item';
  end if;
  return new;
end;
$$;

create trigger lesson_plan_tray_check
  before insert or update or delete on lesson_plan_tray
  for each row execute function lesson_plan_tray_check();
