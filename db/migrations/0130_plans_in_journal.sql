-- 0130 Plans in the journal: "topic not delivered", "homework not given",
-- the journal column an approved plan request opens, and the minimum works
-- of a subject (task 8.8, pull request #226).
--
-- docs/spec/edge-cases/lesson-plans.md, Plans and the journal: "On the
-- lesson card the substitute or the teacher sets 'topic not delivered' and
-- marks the item's homeworks 'not given', all or some of them, inside the
-- edit period. This is not a plan edit. A copy of the item goes to 'not
-- covered', a request is prepared, and the next lesson gets no column for a
-- homework not given." "Adding a work is allowed, and the approval also
-- opens that journal column for the same days." "Each subject can have a
-- minimum number of classworks and homeworks per quarter, set by the
-- Academic Vice Principal."
--
-- The plan approved on pull request #226: decisions 3 and 4 (Look first),
-- 5 to 8 and 11, corrections 2 to 4. Neither mark is data on a lesson
-- (edge/00-definitions): a lesson's forced delete takes them with it.

-- ---------------------------------------------------------------------------
-- "Topic not delivered" (decisions 5 to 8): one row per lesson and journal,
-- set and undone by the lesson's teacher inside the edit period. The copy
-- of the item that goes to "not covered" names the lesson it came from.

alter table lesson_plan_items add column not_delivered_from uuid;
alter table lesson_plan_items add constraint lesson_plan_items_not_delivered_from_fkey
  foreign key (not_delivered_from, branch_id) references lessons (id, branch_id)
  on delete set null (not_delivered_from);

grant insert (not_delivered_from) on lesson_plan_items to sodiq_app;

create table journal_lesson_deliveries (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  lesson_id uuid not null,
  journal_id uuid not null,
  -- The item of the lesson's row when the mark was set.
  item_id uuid not null,
  -- The copy put into "not covered", null once it is cleared or the mark undone.
  copy_item_id uuid,
  not_delivered boolean not null,
  version integer not null default 1,
  changed_by uuid not null references accounts (id),
  changed_how text not null constraint journal_lesson_deliveries_changed_how_check check (
    changed_how in ('entry', 'late_entry', 'undo', 'withdrawn')
  ),
  -- The transaction's moment (the injected clock), by the trigger.
  changed_at timestamptz not null,
  constraint journal_lesson_deliveries_key unique (branch_id, lesson_id, journal_id),
  constraint journal_lesson_deliveries_lesson_fkey foreign key (lesson_id, branch_id)
    references lessons (id, branch_id) on delete cascade,
  constraint journal_lesson_deliveries_journal_fkey foreign key (journal_id) references journals (id),
  constraint journal_lesson_deliveries_item_fkey foreign key (item_id, branch_id)
    references lesson_plan_items (id, branch_id),
  constraint journal_lesson_deliveries_copy_fkey foreign key (copy_item_id, branch_id)
    references lesson_plan_items (id, branch_id)
);

create index journal_lesson_deliveries_journal_idx on journal_lesson_deliveries (journal_id);

alter table journal_lesson_deliveries enable row level security;
create policy branch_filter on journal_lesson_deliveries for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on journal_lesson_deliveries to sodiq_app;
grant insert (branch_id, lesson_id, journal_id, item_id, copy_item_id, not_delivered, changed_by,
  changed_how, changed_at) on journal_lesson_deliveries to sodiq_app;
grant update (copy_item_id, not_delivered, version, changed_by, changed_how)
  on journal_lesson_deliveries to sodiq_app;

-- ---------------------------------------------------------------------------
-- "Homework not given" (decision 4): a homework of the item of the lesson it
-- was given at. Undone by `undone_at`; a later mark is a new row.

create table journal_homework_not_given (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  -- The lesson the homework was given at (its source).
  lesson_id uuid not null,
  journal_id uuid not null,
  plan_work_id uuid not null,
  changed_by uuid not null references accounts (id),
  changed_how text not null constraint journal_homework_not_given_changed_how_check check (
    changed_how in ('entry', 'late_entry', 'undo', 'withdrawn')
  ),
  -- The transaction's moments (the injected clock), by the trigger.
  set_at timestamptz not null,
  undone_at timestamptz,
  constraint journal_homework_not_given_lesson_fkey foreign key (lesson_id, branch_id)
    references lessons (id, branch_id) on delete cascade,
  constraint journal_homework_not_given_journal_fkey foreign key (journal_id) references journals (id),
  constraint journal_homework_not_given_work_fkey foreign key (plan_work_id, branch_id)
    references lesson_plan_works (id, branch_id) on delete cascade
);

create unique index journal_homework_not_given_live_key
  on journal_homework_not_given (branch_id, lesson_id, plan_work_id) where undone_at is null;
create index journal_homework_not_given_journal_idx on journal_homework_not_given (journal_id);
create index journal_homework_not_given_work_idx on journal_homework_not_given (plan_work_id);

alter table journal_homework_not_given enable row level security;
create policy branch_filter on journal_homework_not_given for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on journal_homework_not_given to sodiq_app;
grant insert (branch_id, lesson_id, journal_id, plan_work_id, changed_by, changed_how, set_at)
  on journal_homework_not_given to sodiq_app;
grant update (changed_by, changed_how, undone_at, plan_work_id) on journal_homework_not_given
  to sodiq_app;

-- Whether a homework given at a lesson is marked "not given" now.
create function journal_homework_not_given_live(lesson_ref uuid, plan_work_ref uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from journal_homework_not_given n
    where n.lesson_id = lesson_ref and n.plan_work_id = plan_work_ref and n.undone_at is null
  )
$$;
grant execute on function journal_homework_not_given_live(uuid, uuid) to sodiq_app;

-- ---------------------------------------------------------------------------
-- The history of both marks, written only by the triggers below, append-only
-- and partitioned by month (edge/developer-rules, History and audit).

create table journal_delivery_history (
  id uuid not null default uuidv7(),
  branch_id uuid not null references branches (id),
  -- No key: the history outlives the lesson.
  lesson_id uuid not null,
  journal_id uuid not null,
  -- 'topic' for "topic not delivered", 'homework' for "not given".
  kind text not null constraint journal_delivery_history_kind_check check (
    kind in ('topic', 'homework')
  ),
  plan_work_id uuid,
  marked_before boolean not null,
  marked_after boolean not null,
  changed_by uuid,
  changed_how text not null,
  changed_at timestamptz not null,
  unlock_id uuid,
  written_xact xid8 not null default pg_current_xact_id(),
  primary key (id, changed_at)
) partition by range (changed_at);

create index journal_delivery_history_lesson_idx on journal_delivery_history (lesson_id);
create index journal_delivery_history_branch_idx on journal_delivery_history (branch_id, changed_at);

alter table journal_delivery_history enable row level security;
create policy branch_filter on journal_delivery_history for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

do $$
declare
  month date;
  suffix text;
  partition name;
begin
  for month in
    select generate_series(date '2026-10-01', date '2029-12-01', interval '1 month')::date
  loop
    suffix := to_char(month, 'YYYY_MM');
    execute format(
      'create table public.%I partition of public.journal_delivery_history for values from (%L) to (%L)',
      'journal_delivery_history_' || suffix,
      to_char(month, 'YYYY-MM-DD') || ' 00:00:00+00',
      to_char(month + interval '1 month', 'YYYY-MM-DD') || ' 00:00:00+00'
    );
  end loop;

  create table public.journal_delivery_history_default
    partition of public.journal_delivery_history default;

  for partition in
    select c.relname
    from pg_catalog.pg_inherits i
    join pg_catalog.pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.journal_delivery_history'::regclass
  loop
    execute format('alter table public.%I enable row level security', partition);
    execute format(
      'create policy branch_filter on public.%I for all to sodiq_app
         using (branch_id = any ((select public.app_branch_ids())::uuid[]))
         with check (branch_id = any ((select public.app_branch_ids())::uuid[]))',
      partition
    );
  end loop;
end
$$;

grant select, insert on journal_delivery_history to sodiq_app;

create trigger journal_delivery_history_direct
  before insert on journal_delivery_history
  for each row execute function timetable_trigger_only('journal_delivery_history_direct');

-- ---------------------------------------------------------------------------
-- The guards: the moment of the transaction, the edit period (0122: before
-- the lock, or under the writer's open unlock of that lesson, `late_entry`),
-- the history line.

create function journal_lesson_deliveries_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  if tg_op = 'UPDATE' then
    if new.not_delivered = old.not_delivered and new.changed_how = old.changed_how
      and new.copy_item_id is distinct from old.copy_item_id then
      -- The copy cleared on its own (a Clear of the row): no line.
      return new;
    end if;
    if new.version <> old.version + 1 then
      raise exception 'journal_delivery_version'
        using errcode = 'check_violation', constraint = 'journal_delivery_version';
    end if;
  elsif new.version <> 1 then
    raise exception 'journal_delivery_version'
      using errcode = 'check_violation', constraint = 'journal_delivery_version';
  end if;
  moment := class_tutors_moment();
  if moment is null and session_user = 'sodiq_app' then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  new.changed_at := coalesce(moment, now());
  new.changed_how := journal_edit_judge(
    new.branch_id, journal_lesson_lock(new.lesson_id), new.changed_how, new.changed_by,
    journal_correction_reason(), new.lesson_id, null, null
  );
  if new.changed_how = 'correction' then
    -- No correction path (decision 6): the mark is no value of a cell.
    raise exception 'journal_correction_role'
      using errcode = 'check_violation', constraint = 'journal_correction_role';
  end if;
  insert into journal_delivery_history (
    branch_id, lesson_id, journal_id, kind, marked_before, marked_after, changed_by, changed_how,
    changed_at, unlock_id
  ) values (
    new.branch_id, new.lesson_id, new.journal_id, 'topic',
    case when tg_op = 'UPDATE' then old.not_delivered else false end, new.not_delivered,
    new.changed_by, new.changed_how, new.changed_at, journal_line_unlock(new.changed_how)
  );
  return new;
end;
$$;

create trigger journal_lesson_deliveries_write
  before insert or update on journal_lesson_deliveries
  for each row execute function journal_lesson_deliveries_write();

-- A homework is marked "not given" only while no stored row of its column
-- holds data: a total, "not held", a carry or a number (decision 4,
-- correction 4); the route and the first write of a planned work take the
-- plan work FOR NO KEY UPDATE first, so the two meet in one order.
create function journal_homework_not_given_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  -- A separation moves the mark to the copy of its plan work (`followSeparation`): no line.
  if tg_op = 'UPDATE' and new.plan_work_id is distinct from old.plan_work_id
    and new.undone_at is not distinct from old.undone_at
    and new.changed_how = old.changed_how then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.undone_at is not null then
    raise exception 'journal_not_given_final'
      using errcode = 'check_violation', constraint = 'journal_not_given_final';
  end if;
  moment := class_tutors_moment();
  if moment is null and session_user = 'sodiq_app' then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  if tg_op = 'INSERT' then
    if exists (
      select 1 from journal_works w
      where w.source_lesson_id = new.lesson_id and w.plan_work_id = new.plan_work_id
        and (w.total is not null or w.not_held or w.carried_from_lesson_id is not null
          or exists (select 1 from journal_cells c where c.work_id = w.id and c.score is not null))
    ) then
      raise exception 'homework_has_entries'
        using errcode = 'check_violation', constraint = 'homework_has_entries';
    end if;
    new.set_at := coalesce(moment, now());
    new.undone_at := null;
  else
    if new.undone_at is null then
      raise exception 'journal_not_given_final'
        using errcode = 'check_violation', constraint = 'journal_not_given_final';
    end if;
    new.undone_at := coalesce(moment, now());
  end if;
  new.changed_how := journal_edit_judge(
    new.branch_id, journal_lesson_lock(new.lesson_id), new.changed_how, new.changed_by,
    journal_correction_reason(), new.lesson_id, null, null
  );
  if new.changed_how = 'correction' then
    raise exception 'journal_correction_role'
      using errcode = 'check_violation', constraint = 'journal_correction_role';
  end if;
  insert into journal_delivery_history (
    branch_id, lesson_id, journal_id, kind, plan_work_id, marked_before, marked_after,
    changed_by, changed_how, changed_at, unlock_id
  ) values (
    new.branch_id, new.lesson_id, new.journal_id, 'homework', new.plan_work_id,
    tg_op = 'UPDATE', tg_op = 'INSERT', new.changed_by, new.changed_how,
    coalesce(new.undone_at, new.set_at), journal_line_unlock(new.changed_how)
  );
  return new;
end;
$$;

create trigger journal_homework_not_given_write
  before insert or update on journal_homework_not_given
  for each row execute function journal_homework_not_given_write();

-- A planned homework marked "not given" takes no data: no first write of its
-- row with a total, "not held" or a carry, and no such update (decision 4).
-- A move, a separation and a takeover of the system pass as they come.
create function journal_works_not_given() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.kind = 'homework' and new.plan_work_id is not null and new.source_lesson_id is not null
    and (new.total is not null or new.not_held or new.carried_from_lesson_id is not null)
    and new.changed_how not in ('move', 'separation', 'restored')
    and journal_homework_not_given_live(new.source_lesson_id, new.plan_work_id) then
    raise exception 'journal_work_not_given'
      using errcode = 'check_violation', constraint = 'journal_work_not_given';
  end if;
  return new;
end;
$$;

create trigger journal_works_not_given
  before insert or update on journal_works
  for each row execute function journal_works_not_given();

-- ---------------------------------------------------------------------------
-- The journal column an approved plan request opens (decision 3, correction
-- 2): a work added under the request to the item of a held lesson. The
-- period is the request's own (`open_until`, `finished_at`), read on each
-- write; nothing is flipped by a job.

create table lesson_plan_work_openings (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  plan_work_id uuid not null,
  request_id uuid not null,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint lesson_plan_work_openings_key unique (branch_id, plan_work_id, request_id),
  constraint lesson_plan_work_openings_work_fkey foreign key (plan_work_id, branch_id)
    references lesson_plan_works (id, branch_id) on delete cascade,
  constraint lesson_plan_work_openings_request_fkey foreign key (request_id, branch_id)
    references lesson_plan_requests (id, branch_id)
);

create index lesson_plan_work_openings_request_idx on lesson_plan_work_openings (request_id);

alter table lesson_plan_work_openings enable row level security;
create policy branch_filter on lesson_plan_work_openings for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on lesson_plan_work_openings to sodiq_app;
grant insert (branch_id, plan_work_id, request_id) on lesson_plan_work_openings to sodiq_app;

-- Whether the approved request named opens the plan work's column on the
-- lesson for the account at the moment: the request is approved and its
-- period not ended, the plan work was added under it, and the account's
-- person is the lesson's teacher (the owner, or the substitute in force;
-- correction 2). The request is read FOR SHARE: a "finished" held open makes
-- the entry wait.
create function journal_plan_opening_covers(
  request_ref uuid,
  account_ref uuid,
  plan_work_ref uuid,
  lesson_ref uuid,
  moment timestamptz
) returns boolean
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  found_row lesson_plan_requests;
begin
  if request_ref is null or plan_work_ref is null or lesson_ref is null then
    return false;
  end if;
  select * into found_row from lesson_plan_requests r where r.id = request_ref for share;
  if not found then
    return false;
  end if;
  return found_row.status = 'approved'
    and found_row.open_until is not null
    and moment <= found_row.open_until
    and found_row.finished_at is null
    and exists (
      select 1 from lesson_plan_work_openings o
      where o.request_id = request_ref and o.plan_work_id = plan_work_ref
    )
    and exists (
      select 1 from lessons l join staff s on s.id = l.teacher_id
      where l.id = lesson_ref and s.account_id = account_ref
    );
end;
$$;

grant execute on function journal_plan_opening_covers(uuid, uuid, uuid, uuid, timestamptz)
  to sodiq_app;

-- 0122's judge, with the opening of a plan work's column: from the lock, an
-- entry on that column under the opening named by `app.plan_request_id` is a
-- late entry; anything else is judged as before.
create function journal_edit_judge_work(
  branch_ref uuid,
  lock_at timestamptz,
  how text,
  writer uuid,
  reason text,
  lesson_ref uuid,
  plan_work_ref uuid
) returns text
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  moment := class_tutors_moment();
  if plan_work_ref is not null and moment is not null
    and how in ('entry', 'offline_entry', 'not_held', 'carry', 'undo')
    and coalesce(reason, '') = ''
    and lock_at is not null and moment >= lock_at
    and journal_plan_opening_covers(
      nullif(current_setting('app.plan_request_id', true), '')::uuid,
      writer, plan_work_ref, lesson_ref, moment
    ) then
    return case when how = 'undo' then 'undo' else 'late_entry' end;
  end if;
  return journal_edit_judge(branch_ref, lock_at, how, writer, reason, lesson_ref, null, null);
end;
$$;

-- 0127's cells guard, judging a work's cell with its plan work.
create or replace function journal_cells_edit_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  lock_at timestamptz;
  plan_work uuid;
begin
  if tg_op = 'DELETE' then
    -- Only the clearing of an empty lesson and the works triggers delete a cell (0108, 0119).
    return old;
  end if;
  if tg_op = 'INSERT' and forced_restore_names('lesson', new.lesson_id) then
    return new;
  end if;
  lock_at := journal_lesson_lock(new.lesson_id);
  if new.changed_how in ('entry', 'offline_entry', 'not_held', 'undo')
    and coalesce(journal_correction_reason(), '') = ''
    and lock_at is not null and class_tutors_moment() >= lock_at
    and (exemption_reopened_open(new.lesson_id, new.student_id)
      or journal_optional_open(new.lesson_id, new.student_id)) then
    new.changed_how := case when new.changed_how = 'undo' then 'undo' else 'late_entry' end;
    return new;
  end if;
  if new.work_id is not null then
    select w.plan_work_id into plan_work from journal_works w where w.id = new.work_id;
  end if;
  new.changed_how := journal_edit_judge_work(
    new.branch_id, lock_at, new.changed_how, new.changed_by,
    journal_correction_reason(), new.lesson_id, plan_work
  );
  return new;
end;
$$;

-- 0122's works guard, judging a planned work with its plan work.
create or replace function journal_works_edit_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or forced_delete_names('lesson', old.lesson_id) then
      return old;
    end if;
    perform journal_edit_judge(
      old.branch_id, journal_lesson_lock(old.lesson_id), 'deleted', old.changed_by,
      journal_correction_reason(), old.lesson_id, null, null
    );
    return old;
  end if;
  if tg_op = 'INSERT' and forced_restore_names('lesson', new.lesson_id) then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.lesson_id is distinct from old.lesson_id then
    perform journal_edit_judge_work(
      old.branch_id, journal_lesson_lock(old.lesson_id), new.changed_how, new.changed_by,
      journal_correction_reason(), old.lesson_id, new.plan_work_id
    );
  end if;
  new.changed_how := journal_edit_judge_work(
    new.branch_id, journal_lesson_lock(new.lesson_id), new.changed_how, new.changed_by,
    journal_correction_reason(), new.lesson_id, new.plan_work_id
  );
  return new;
end;
$$;

-- The histories keep the request a late write was made under, as they keep
-- the unlock (0122) and the orphan assignment (0129). The bodies of 0129
-- otherwise unchanged.

alter table journal_cell_history add column plan_request_id uuid;
alter table journal_work_history add column plan_request_id uuid;

create function journal_line_plan_request(how text) returns uuid
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
    when how in ('late_entry', 'undo') then
      nullif(current_setting('app.plan_request_id', true), '')::uuid
  end
$$;

grant execute on function journal_line_plan_request(text) to sodiq_app;

create or replace function journal_cells_history() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    insert into journal_cell_history (
      branch_id, cell_id, lesson_id, student_id, work_id, version,
      mark_before, mark_after, score_before, score_after, not_graded_before, not_graded_after,
      changed_by, changed_how, changed_at, reason, unlock_id, orphan_assignment_id,
      plan_request_id
    ) values (
      new.branch_id, new.id, new.lesson_id, new.student_id, new.work_id, new.version,
      old.mark, new.mark, old.score, new.score, old.not_graded, new.not_graded,
      new.changed_by, new.changed_how, new.changed_at,
      journal_line_reason(new.changed_how), journal_line_unlock(new.changed_how),
      journal_line_orphan(new.changed_how), journal_line_plan_request(new.changed_how)
    );
  else
    insert into journal_cell_history (
      branch_id, cell_id, lesson_id, student_id, work_id, version,
      mark_after, score_after, not_graded_after, changed_by, changed_how, changed_at, reason,
      unlock_id, orphan_assignment_id, plan_request_id
    ) values (
      new.branch_id, new.id, new.lesson_id, new.student_id, new.work_id, new.version,
      new.mark, new.score, new.not_graded, new.changed_by, new.changed_how, new.changed_at,
      journal_line_reason(new.changed_how), journal_line_unlock(new.changed_how),
      journal_line_orphan(new.changed_how), journal_line_plan_request(new.changed_how)
    );
  end if;
  return null;
end;
$$;

create or replace function journal_works_history() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  author uuid;
begin
  if tg_op = 'INSERT' then
    if new.changed_how = 'restored' or forced_restore_names('lesson', new.lesson_id) then
      insert into journal_work_history (
        branch_id, work_id, lesson_id, source_lesson_id, kind, version, total_after,
        not_held_after, carried_from_after, plan_work_after, changed_by, changed_how, changed_at
      ) values (
        new.branch_id, new.id, new.lesson_id, new.source_lesson_id, new.kind, new.version,
        new.total, new.not_held, new.carried_from_lesson_id, new.plan_work_id, new.changed_by,
        'restored', coalesce(class_tutors_moment(), new.changed_at)
      );
    end if;
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if new.total is not distinct from old.total
      and new.not_held = old.not_held
      and new.lesson_id = old.lesson_id
      and new.carried_from_lesson_id is not distinct from old.carried_from_lesson_id
      and new.plan_work_id is not distinct from old.plan_work_id then
      return null;
    end if;
    insert into journal_work_history (
      branch_id, work_id, lesson_id, source_lesson_id, kind, version,
      total_before, total_after, not_held_before, not_held_after, lesson_before,
      carried_from_after, plan_work_before, plan_work_after, changed_by, changed_how, changed_at,
      reason, unlock_id, orphan_assignment_id, plan_request_id
    ) values (
      new.branch_id, new.id, new.lesson_id, new.source_lesson_id, new.kind, new.version,
      old.total, new.total, old.not_held, new.not_held,
      case when new.lesson_id <> old.lesson_id then old.lesson_id end,
      new.carried_from_lesson_id, old.plan_work_id, new.plan_work_id, new.changed_by,
      new.changed_how, new.changed_at,
      journal_line_reason(new.changed_how), journal_line_unlock(new.changed_how),
      journal_line_orphan(new.changed_how), journal_line_plan_request(new.changed_how)
    );
    return null;
  end if;
  moment := class_tutors_moment();
  select f.deleted_by into author from forced_deletes f
    where f.created_xact = pg_current_xact_id()
      and f.record_type = 'lesson'
      and f.record_id = old.lesson_id
    limit 1;
  if author is null and pg_trigger_depth() > 1 and old.total is null and not old.not_held then
    return null;
  end if;
  if moment is null then
    if session_user <> 'sodiq_app' then
      return null;
    end if;
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  insert into journal_work_history (
    branch_id, work_id, lesson_id, source_lesson_id, kind, version,
    total_before, not_held_before, plan_work_before, changed_by, changed_how, changed_at,
    reason, unlock_id, orphan_assignment_id
  ) values (
    old.branch_id, old.id, old.lesson_id, old.source_lesson_id, old.kind, old.version + 1,
    old.total, old.not_held, old.plan_work_id, coalesce(author, old.changed_by),
    case when author is null then 'deleted' else 'forced_delete' end, moment,
    case when author is null then journal_line_reason('deleted') end,
    case when author is null then journal_line_unlock('deleted') end,
    case when author is null then journal_line_orphan('deleted') end
  );
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- The minimum works of a subject per quarter in a branch (decision 11),
-- set by the Academic Vice Principal; 0 is no minimum.

create table subject_plan_minimums (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  subject_id uuid not null references subjects (id),
  classworks smallint not null constraint subject_plan_minimums_classworks_check check (
    classworks between 0 and 100
  ),
  homeworks smallint not null constraint subject_plan_minimums_homeworks_check check (
    homeworks between 0 and 100
  ),
  version integer not null default 1,
  changed_by uuid not null references accounts (id),
  -- Bookkeeping only; no rule reads it.
  changed_at timestamptz not null default now(),
  constraint subject_plan_minimums_key unique (branch_id, subject_id)
);

alter table subject_plan_minimums enable row level security;
create policy branch_filter on subject_plan_minimums for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on subject_plan_minimums to sodiq_app;
grant insert (branch_id, subject_id, classworks, homeworks, changed_by) on subject_plan_minimums
  to sodiq_app;
grant update (classworks, homeworks, version, changed_by, changed_at) on subject_plan_minimums
  to sodiq_app;
