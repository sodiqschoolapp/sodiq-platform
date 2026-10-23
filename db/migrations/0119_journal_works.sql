-- 0119 Classwork and homework in the journal (task 8.1, pull request #217).
--
-- docs/spec/07-journal.md, Entering data: "The columns come from the lesson
-- plan, so a lesson shows only the works it really has." "In a lesson held
-- while its plan item is missing, the teacher can add any number of
-- classworks and of 'homework given' by hand." The total: "The total is a
-- whole number, 1 or more. Numbers cannot be typed for a work until its total
-- is set." "The number typed is from 0 up to the total. A number above the
-- total is refused." "If a number already typed is above the new total, the
-- change is refused and those students are listed." "The number and the
-- total stay visible in the journal and in the cell history."
-- docs/spec/edge-cases/journal.md, Entering: "A lesson has at most 10
-- classworks and at most 10 homeworks given"; "The homework columns move to
-- the next held lesson, each as long as it has no numbers yet"; "'check at
-- the next lesson' (once)"; "When the plan item is written later, its works
-- take over these columns in order".
--
-- The plan approved on pull request #217 with correction 1: decisions 1 to
-- 18. A work row is written at its first write (a total, "not held", a carry,
-- a number); the columns of a lesson are worked out on read
-- (apps/api/src/modules/journal/lesson-columns.ts). 0108 and 0111 are not
-- edited.

-- ---------------------------------------------------------------------------
-- The works gain their source, their plan link, their order and their state.

alter table lesson_plan_works
  add constraint lesson_plan_works_id_branch_key unique (id, branch_id);

alter table journal_works
  -- The lesson whose item holds the work: the classwork's lesson, the lesson
  -- where the homework was given. A lesson removed while it is the source of
  -- a work with data leaves the row at its own lesson, a column of its own.
  add column source_lesson_id uuid,
  -- The plan's work this column is; null for a work added by hand
  -- ("unplanned") until a plan item takes it over (decision 4).
  add column plan_work_id uuid,
  -- The order among the hand-added works of its source lesson and kind.
  add column position integer not null default 1
    constraint journal_works_position_check check (position between 1 and 10),
  -- The check lesson a homework was carried from ("check at the next
  -- lesson", once); the row stays there until the first write at the next.
  add column carried_from_lesson_id uuid,
  -- Written by journal_works_write: 1 on insert, one more on every change.
  add column version integer not null default 1,
  -- Null for a row a migration or a fixture wrote.
  add column changed_by uuid references accounts (id),
  add column changed_how text not null default 'entry'
    constraint journal_works_changed_how_check check (
      changed_how in (
        'entry', 'not_held', 'carry', 'move', 'takeover', 'separation', 'restored', 'deleted'
      )
    ),
  -- From the transaction's moment (the injected clock), by the trigger.
  add column changed_at timestamptz;

update journal_works set source_lesson_id = lesson_id;

alter table journal_works
  add constraint journal_works_source_fkey foreign key (source_lesson_id, branch_id)
    references lessons (id, branch_id) on delete set null (source_lesson_id),
  add constraint journal_works_carried_fkey foreign key (carried_from_lesson_id, branch_id)
    references lessons (id, branch_id) on delete set null (carried_from_lesson_id),
  -- No action: a plan work a journal work names is not removed (decision 11).
  add constraint journal_works_plan_work_fkey foreign key (plan_work_id, branch_id)
    references lesson_plan_works (id, branch_id),
  add constraint journal_works_carry_check check (
    carried_from_lesson_id is null or kind = 'homework'
  );

-- A shared plan's item serves several journals: one row per source lesson
-- and plan work.
create unique index journal_works_planned_key
  on journal_works (branch_id, source_lesson_id, plan_work_id)
  where plan_work_id is not null;
create unique index journal_works_unplanned_key
  on journal_works (branch_id, source_lesson_id, kind, position)
  where plan_work_id is null;
create index journal_works_source_idx on journal_works (source_lesson_id);
create index journal_works_plan_work_idx on journal_works (plan_work_id)
  where plan_work_id is not null;

grant insert (source_lesson_id, plan_work_id, position, changed_by, changed_how)
  on journal_works to sodiq_app;
grant update (
  total, not_held, lesson_id, carried_from_lesson_id, plan_work_id, changed_by, changed_how
) on journal_works to sodiq_app;
-- The restore puts the stored version and moment back (decision 9 of 6.1b-2).
grant insert (carried_from_lesson_id, version, changed_at) on journal_works to sodiq_app;

-- ---------------------------------------------------------------------------
-- The version, the moment and the rules of a change. Runs as the invoker.
--
-- - A total is never cleared, and is never below a number typed
--   (`journal_work_total_below`; 07: "the change is refused").
-- - A work moves to another lesson only while it has no number; its empty
--   cell rows go with the move (their lines stay in the history).
-- - The carry is set once, from null.
-- - The plan link is set from null (the takeover, decision 4 with review
--   correction 1), or moved by a separation to the copy of its work (the work
--   of the same kind and position of the item copied from the old one's).
-- - The source lesson and the kind never change.

create function journal_works_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  moment := class_tutors_moment();
  if moment is null and session_user = 'sodiq_app' then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  if tg_op = 'INSERT' then
    if not forced_restore_names('lesson', new.lesson_id) then
      new.version := 1;
      new.changed_at := moment;
    end if;
    return new;
  end if;
  if new.kind is distinct from old.kind
    or new.source_lesson_id is distinct from old.source_lesson_id
      and new.source_lesson_id is not null then
    raise exception 'journal_work_fixed'
      using errcode = 'check_violation', constraint = 'journal_work_fixed';
  end if;
  if new.total is null and old.total is not null then
    raise exception 'journal_work_total_cleared'
      using errcode = 'check_violation', constraint = 'journal_work_total_cleared';
  end if;
  if new.total is distinct from old.total and exists (
    select 1 from journal_cells c where c.work_id = new.id and c.score > new.total
  ) then
    raise exception 'journal_work_total_below'
      using errcode = 'check_violation', constraint = 'journal_work_total_below';
  end if;
  if new.carried_from_lesson_id is distinct from old.carried_from_lesson_id
    and (old.carried_from_lesson_id is not null or new.carried_from_lesson_id is null) then
    raise exception 'journal_work_carry_once'
      using errcode = 'check_violation', constraint = 'journal_work_carry_once';
  end if;
  if new.plan_work_id is distinct from old.plan_work_id then
    if new.plan_work_id is null or (
      old.plan_work_id is not null and not exists (
        select 1 from lesson_plan_works nw
        join lesson_plan_items ni on ni.id = nw.item_id
        join lesson_plan_works ow on ow.id = old.plan_work_id
        where nw.id = new.plan_work_id
          and ni.copied_from = ow.item_id
          and nw.kind = ow.kind
          and nw.position = ow.position
      )
    ) then
      raise exception 'journal_work_plan_link'
        using errcode = 'check_violation', constraint = 'journal_work_plan_link';
    end if;
  end if;
  if new.lesson_id is distinct from old.lesson_id then
    if exists (
      select 1 from journal_cells c where c.work_id = old.id and c.score is not null
    ) then
      raise exception 'journal_work_move_numbers'
        using errcode = 'check_violation', constraint = 'journal_work_move_numbers';
    end if;
    delete from journal_cells c where c.work_id = old.id;
  end if;
  new.version := old.version + 1;
  new.changed_at := moment;
  return new;
end;
$$;

create trigger journal_works_write
  before insert or update on journal_works
  for each row execute function journal_works_write();

-- ---------------------------------------------------------------------------
-- At most 10 works added by hand of a kind per source lesson (edge/journal:
-- "at most 10 classworks and at most 10 homeworks given"). The lock of the
-- lesson's key makes two adds count one after the other; each statement of
-- the function reads after it.

create function journal_works_limit() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.plan_work_id is not null or new.source_lesson_id is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('journal_works_limit:' || new.source_lesson_id::text, 0));
  if (select count(*) from journal_works w
      where w.source_lesson_id = new.source_lesson_id
        and w.kind = new.kind
        and w.plan_work_id is null) > 10 then
    raise exception 'journal_works_limit'
      using errcode = 'check_violation', constraint = 'journal_works_limit';
  end if;
  return null;
end;
$$;

create trigger journal_works_limit
  after insert on journal_works
  for each row execute function journal_works_limit();

-- ---------------------------------------------------------------------------
-- The rules of a number (From 6.1a; 07, The total): a number needs the
-- work's total, is at most the total, and is not typed on a work marked "not
-- held". The work row is locked FOR SHARE, so a change of its total waits for
-- the save or the save for it; share locks do not conflict with each other,
-- and the change of a total waits for no cell. Everything else as in 0111.

create or replace function journal_cells_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  lesson_row lessons;
  work_row journal_works;
  stored_version integer;
  restorer uuid;
begin
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  if tg_op = 'INSERT' and forced_restore_names('lesson', new.lesson_id) then
    select c.version, f.restored_by into stored_version, restorer
      from forced_deletes f
      cross join lateral forced_store_cells(f) c
      where f.restored_xact = pg_current_xact_id()
        and f.record_type = 'lesson'
        and f.record_id = new.lesson_id
        and c.id = new.id
        and c.student_id = new.student_id
        and c.work_id is not distinct from new.work_id
        and c.mark is not distinct from new.mark
        and c.score is not distinct from new.score
      limit 1;
    if stored_version is null then
      raise exception 'journal_cell_restore'
        using errcode = 'check_violation', constraint = 'journal_cell_restore';
    end if;
    new.version := stored_version
      + case when new.mark is null and new.score is null then 1 else 2 end;
    new.changed_by := restorer;
    new.changed_how := 'restored';
    new.changed_at := moment;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    new.version := old.version + 1;
  end if;
  new.changed_at := moment;
  select * into lesson_row from lessons l where l.id = new.lesson_id;
  if lesson_row.cancel_cause is not null then
    raise exception 'journal_cell_cancelled'
      using errcode = 'check_violation', constraint = 'journal_cell_cancelled';
  end if;
  if new.mark is null and new.score is null then
    -- A cleared value: allowed on a lesson that is not cancelled, the old
    -- value stays in the history.
    return new;
  end if;
  if new.work_id is not null then
    select * into work_row from journal_works w where w.id = new.work_id for share;
    if work_row.total is null then
      raise exception 'journal_cell_no_total'
        using errcode = 'check_violation', constraint = 'journal_cell_no_total';
    end if;
    if new.score > work_row.total then
      raise exception 'journal_cell_above_total'
        using errcode = 'check_violation', constraint = 'journal_cell_above_total';
    end if;
    if work_row.not_held then
      raise exception 'journal_cell_not_held'
        using errcode = 'check_violation', constraint = 'journal_cell_not_held';
    end if;
  end if;
  perform 1 from class_memberships m
    where lesson_row.class_id is not null
      and m.class_id = lesson_row.class_id
      and m.student_id = new.student_id
    for share;
  perform 1 from group_memberships m
    where lesson_row.group_id is not null
      and m.group_id = lesson_row.group_id
      and m.student_id = new.student_id
    for share;
  if not lesson_student_expected(new.lesson_id, new.student_id) then
    raise exception 'journal_cell_not_member'
      using errcode = 'check_violation', constraint = 'journal_cell_not_member';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The delete of a work (decision 1, Look first): besides the clearing of an
-- empty lesson and the forced delete (0108, 0111), the application deletes a
-- work added by hand with no total, not "not held" and no number; its empty
-- cell rows go with it.

create or replace function journal_works_delete() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from forced_deletes f
    cross join lateral forced_store_works(f) w
    where f.created_xact = pg_current_xact_id()
      and f.record_type = 'lesson'
      and f.record_id = old.lesson_id
      and w.id = old.id
      and w.kind = old.kind
      and w.total is not distinct from old.total
      and w.not_held = old.not_held
  ) then
    return old;
  end if;
  if old.total is not null or old.not_held then
    raise exception 'journal_cell_delete'
      using errcode = 'check_violation', constraint = 'journal_cell_delete';
  end if;
  if pg_trigger_depth() <= 1 then
    if old.plan_work_id is not null or exists (
      select 1 from journal_cells c where c.work_id = old.id and c.score is not null
    ) then
      raise exception 'journal_cell_delete'
        using errcode = 'check_violation', constraint = 'journal_cell_delete';
    end if;
    delete from journal_cells c where c.work_id = old.id;
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- The works a store row keeps carry the new columns; a store row written
-- before this migration gives them null (the restore fills the source with
-- the lesson). Same name, new result: dropped and created again with the
-- functions that read it.

drop function forced_store_works(forced_deletes);

create function forced_store_works(store forced_deletes)
returns table (
  id uuid,
  kind text,
  total integer,
  not_held boolean,
  source_lesson_id uuid,
  plan_work_id uuid,
  "position" integer,
  carried_from_lesson_id uuid,
  version integer,
  changed_by uuid,
  changed_how text,
  changed_at timestamptz
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select w.id, w.kind, w.total, w.not_held, w.source_lesson_id, w.plan_work_id, w."position",
    w.carried_from_lesson_id, w.version, w.changed_by, w.changed_how, w.changed_at
  from jsonb_to_recordset(coalesce(store.rows -> 'works', '[]'::jsonb)) as w(
    id uuid, kind text, total integer, not_held boolean, source_lesson_id uuid,
    plan_work_id uuid, "position" integer, carried_from_lesson_id uuid, version integer,
    changed_by uuid, changed_how text, changed_at timestamptz
  );
$$;

grant execute on function forced_store_works(forced_deletes) to sodiq_app;

-- 0111's insert check, as it was: a total or "not held" is inserted by the
-- application only as a work of the store row restored in this transaction.
create or replace function journal_works_insert_data() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if session_user <> 'sodiq_app' or (new.total is null and not new.not_held) then
    return new;
  end if;
  if not exists (
    select 1 from forced_deletes f
    cross join lateral forced_store_works(f) w
    where f.restored_xact = pg_current_xact_id()
      and f.record_type = 'lesson'
      and f.record_id = new.lesson_id
      and w.id = new.id
      and w.kind = new.kind
      and w.total is not distinct from new.total
      and w.not_held = new.not_held
  ) then
    raise exception 'journal_work_insert_data'
      using errcode = 'check_violation', constraint = 'journal_work_insert_data';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The history of every work, written only by the trigger below, append-only
-- and partitioned by month (edge/developer-rules, History and audit; From
-- 6.1a: "the total kept beside the number in the cell history").

create table journal_work_history (
  id uuid not null default uuidv7(),
  branch_id uuid not null references branches (id),
  -- No key: the history outlives the work.
  work_id uuid not null,
  lesson_id uuid not null,
  source_lesson_id uuid,
  kind text not null,
  version integer not null,
  total_before integer,
  total_after integer,
  not_held_before boolean,
  not_held_after boolean,
  lesson_before uuid,
  carried_from_after uuid,
  plan_work_before uuid,
  plan_work_after uuid,
  changed_by uuid,
  changed_how text not null,
  -- The transaction's moment (the injected clock).
  changed_at timestamptz not null,
  -- Ties the line to the audit entries of its transaction.
  written_xact xid8 not null default pg_current_xact_id(),
  primary key (id, changed_at)
) partition by range (changed_at);

create index journal_work_history_work_idx on journal_work_history (work_id, version);
create index journal_work_history_lesson_idx on journal_work_history (lesson_id);
create index journal_work_history_branch_idx on journal_work_history (branch_id, changed_at);
create index journal_work_history_xact_idx on journal_work_history (written_xact);

alter table journal_work_history enable row level security;
create policy branch_filter on journal_work_history for all to sodiq_app
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
      'create table public.%I partition of public.journal_work_history for values from (%L) to (%L)',
      'journal_work_history_' || suffix,
      to_char(month, 'YYYY-MM-DD') || ' 00:00:00+00',
      to_char(month + interval '1 month', 'YYYY-MM-DD') || ' 00:00:00+00'
    );
  end loop;

  create table public.journal_work_history_default partition of public.journal_work_history default;

  for partition in
    select c.relname
    from pg_catalog.pg_inherits i
    join pg_catalog.pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.journal_work_history'::regclass
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

grant select, insert on journal_work_history to sodiq_app;

create trigger journal_work_history_direct
  before insert on journal_work_history
  for each row execute function timetable_trigger_only('journal_work_history_direct');

-- A line for every change of the total, "not held", the lesson, the carry or
-- the plan link; for a restore; and for a delete of a work with data or by
-- the application. The clearing of an empty lesson removes rows that hold
-- nothing and writes no line. Runs as the invoker.
create function journal_works_history() returns trigger
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
      carried_from_after, plan_work_before, plan_work_after, changed_by, changed_how, changed_at
    ) values (
      new.branch_id, new.id, new.lesson_id, new.source_lesson_id, new.kind, new.version,
      old.total, new.total, old.not_held, new.not_held,
      case when new.lesson_id <> old.lesson_id then old.lesson_id end,
      new.carried_from_lesson_id, old.plan_work_id, new.plan_work_id, new.changed_by,
      new.changed_how, new.changed_at
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
    total_before, not_held_before, plan_work_before, changed_by, changed_how, changed_at
  ) values (
    old.branch_id, old.id, old.lesson_id, old.source_lesson_id, old.kind, old.version + 1,
    old.total, old.not_held, old.plan_work_id, coalesce(author, old.changed_by),
    case when author is null then 'deleted' else 'forced_delete' end, moment
  );
  return null;
end;
$$;

create trigger journal_works_history
  after insert or update or delete on journal_works
  for each row execute function journal_works_history();

-- The history's "how" of a work line also names the forced delete.
alter table journal_work_history add constraint journal_work_history_changed_how_check check (
  changed_how in (
    'entry', 'not_held', 'carry', 'move', 'takeover', 'separation', 'restored', 'deleted',
    'forced_delete'
  )
);

-- ---------------------------------------------------------------------------
-- Every line of the three histories has an audit entry of its transaction in
-- its branch (0108, correction 1). Same name and signature.

create or replace function lesson_history_unaudited(xact xid8) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select xact is not null and (
    exists (
      select 1 from lesson_history h
      where h.written_xact = xact
        and not exists (
          select 1 from audit_log a where a.branch_id = h.branch_id and a.written_xact = xact
        )
    )
    or exists (
      select 1 from journal_cell_history h
      where h.written_xact = xact
        and not exists (
          select 1 from audit_log a where a.branch_id = h.branch_id and a.written_xact = xact
        )
    )
    or exists (
      select 1 from journal_work_history h
      where h.written_xact = xact
        and not exists (
          select 1 from audit_log a where a.branch_id = h.branch_id and a.written_xact = xact
        )
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- The days a shorter year cuts off hold no entry (From 3.6b-2, L128: "shorter
-- only when no lesson with data, mark, attendance or stay falls in the days
-- cut off"; decision 16): kind `entry`, one row per student and date of a
-- cell with a value on a lesson of the year outside the new dates, its
-- holder the lesson's class or group. Same name and result as 0064.

create or replace function year_cut_holds(year_id uuid, new_start date, new_end date)
returns table (
  kind text,
  row_id uuid,
  student_id uuid,
  holder_id uuid,
  valid_from date,
  valid_until date
)
language sql
stable
set search_path = pg_catalog, public
as $$
  with year as (
    select y.start_date, y.end_date from academic_years y where y.id = year_id
  ), rows as (
    select 'class'::text as kind, m.id, m.student_id, m.class_id as holder_id,
      m.valid_from, m.valid_until, m.own_until
    from class_memberships m
    join classes c on c.id = m.class_id
    where c.academic_year_id = year_id
      and (m.valid_from < m.valid_until
        or (m.ended_by in ('leaving', 'transfer') and m.valid_from < m.own_until))
    union all
    select 'group'::text, m.id, m.student_id, m.group_id, m.valid_from, m.valid_until, m.own_until
    from group_memberships m
    join groups g on g.id = m.group_id
    where g.academic_year_id = year_id
      and (m.valid_from < m.valid_until
        or (m.ended_by in ('leaving', 'transfer') and m.valid_from < m.own_until))
  ), stays as (
    select r.kind, r.id, r.student_id, r.holder_id, r.valid_from,
      case when r.valid_from < r.valid_until then r.valid_until else r.own_until end as valid_until
    from rows r, year y
    where r.valid_from < new_start
      or (
        new_end < y.end_date
        and (
          r.valid_from >= new_end + 1
          or (r.valid_until < r.own_until and r.valid_until >= new_end + 1)
          or (r.own_until > new_end + 1 and r.own_until <> y.end_date + 1)
        )
      )
  ), entries as (
    select distinct on (c.student_id, l.lesson_date)
      'entry'::text as kind, l.id, c.student_id, coalesce(l.class_id, l.group_id) as holder_id,
      l.lesson_date as valid_from, l.lesson_date + 1 as valid_until
    from journal_cells c
    join lessons l on l.id = c.lesson_id
    join lesson_blocks b on b.id = l.block_id
    where b.academic_year_id = year_id
      and (c.mark is not null or c.score is not null)
      and (l.lesson_date < new_start or l.lesson_date > new_end)
    order by c.student_id, l.lesson_date, l.id
  )
  select * from (
    select * from stays
    union all
    select * from entries
  ) s
  order by s.kind, s.valid_from, s.id
$$;
