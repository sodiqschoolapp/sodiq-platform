-- 0105 Protection of dated lessons and their forced delete (task 5.8b, pull
-- request #195).
--
-- docs/spec/06-timetable.md, Protection: "A dated lesson that already has
-- attendance or marks cannot be deleted and cannot change its class, group or
-- subject. Its teacher, room and time can change, with a log entry." "Forced
-- delete is for Super Admin only, with a typed reason. The attendance and
-- marks are kept for 30 days and can be restored." "Every change records who,
-- when, the value before and the value after." docs/spec/edge-cases/
-- 00-definitions.md, Data on a lesson. docs/spec/edge-cases/developer-rules.md,
-- History and audit: "Append-only ... Partitioned by month."
--
-- The plan approved on pull request #195 with corrections 1 and 2: decisions
-- 1 to 12. The class, group, subject and block of a lesson have no update
-- grant (0058), which is the guard of rule 1.

-- ---------------------------------------------------------------------------
-- Who: the transaction of an audit entry (decision 4). Added with no default
-- first, so the log is not rewritten; old entries stay empty.

alter table audit_log add column written_xact xid8;
alter table audit_log alter column written_xact set default pg_current_xact_id();
create index audit_log_xact_idx on audit_log (branch_id, written_xact);

-- ---------------------------------------------------------------------------
-- Rule 1: whether a lesson holds data (edge/00-definitions, Data on a lesson:
-- "An attendance mark, a number, a total, a 'not held' mark or a comment
-- entered by a person"). No lesson holds data until task 6.1 adds the cells
-- and replaces this body (decision 2). Runs as the invoker.

create function lesson_holds_data(lesson_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select false;
$$;

grant execute on function lesson_holds_data(uuid) to sodiq_app;

-- ---------------------------------------------------------------------------
-- The store of forced deletes (rule 2; 5.8c adds buildings, floors and rooms).

create table forced_deletes (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  record_type text not null constraint forced_deletes_record_type_check check (
    record_type in ('lesson')
  ),
  record_id uuid not null,
  -- Every row removed with the record, and the ids of the rows whose link to
  -- it became empty.
  rows jsonb not null constraint forced_deletes_rows_check check (jsonb_typeof(rows) = 'object'),
  reason text not null constraint forced_deletes_reason_check check (
    length(btrim(reason)) between 1 and 500
  ),
  deleted_by uuid not null references accounts (id),
  -- From the transaction's moment, written by forced_deletes_write.
  deleted_at timestamptz not null,
  restore_until timestamptz not null,
  restored_at timestamptz,
  restored_by uuid references accounts (id),
  created_xact xid8 not null default pg_current_xact_id(),
  restored_xact xid8,
  constraint forced_deletes_restored_check check (
    (restored_at is null) = (restored_by is null)
    and (restored_at is null) = (restored_xact is null)
  )
);

create index forced_deletes_branch_idx on forced_deletes (branch_id, deleted_at);
create index forced_deletes_record_idx on forced_deletes (record_id);
create index forced_deletes_created_idx on forced_deletes (created_xact);
create index forced_deletes_restored_idx on forced_deletes (restored_xact)
  where restored_xact is not null;

alter table forced_deletes enable row level security;
create policy branch_filter on forced_deletes for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on forced_deletes to sodiq_app;
-- The moments are sent and overwritten by forced_deletes_write.
grant insert (branch_id, record_type, record_id, rows, reason, deleted_by, deleted_at, restore_until)
  on forced_deletes to sodiq_app;
grant update (restored_at, restored_by) on forced_deletes to sodiq_app;

-- The moments, the 30 days and the transaction of a forced delete, and its
-- restore once, before its end (decision 8). Runs as the invoker.
create function forced_deletes_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'forced_delete_moment'
      using errcode = 'check_violation', constraint = 'forced_delete_moment';
  end if;
  if tg_op = 'INSERT' then
    new.deleted_at := moment;
    new.restore_until := moment + interval '30 days';
    new.created_xact := pg_current_xact_id();
    new.restored_at := null;
    new.restored_by := null;
    new.restored_xact := null;
    return new;
  end if;
  if old.restored_at is not null then
    raise exception 'forced_delete_restored'
      using errcode = 'check_violation', constraint = 'forced_delete_restored';
  end if;
  if moment >= old.restore_until then
    raise exception 'forced_delete_expired'
      using errcode = 'check_violation', constraint = 'forced_delete_expired';
  end if;
  if new.restored_by is null then
    raise exception 'forced_delete_restored'
      using errcode = 'check_violation', constraint = 'forced_delete_restored';
  end if;
  new.restored_at := moment;
  new.restored_xact := pg_current_xact_id();
  return new;
end;
$$;

create trigger forced_deletes_write
  before insert or update of restored_at, restored_by on forced_deletes
  for each row execute function forced_deletes_write();

-- Whether a forced delete of this transaction names a lesson or a block.
-- Runs as the invoker.
create function forced_delete_names(kind text, ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from forced_deletes f
    where f.created_xact = pg_current_xact_id()
      and f.record_type = 'lesson'
      and (
        (kind = 'lesson' and f.record_id = ref)
        or (kind = 'block' and f.rows -> 'block' ->> 'id' = ref::text)
      )
  );
$$;

-- Whether a restore of this transaction names a lesson or a block.
create function forced_restore_names(kind text, ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from forced_deletes f
    where f.restored_xact = pg_current_xact_id()
      and f.record_type = 'lesson'
      and (
        (kind = 'lesson' and f.record_id = ref)
        or (kind = 'block' and f.rows -> 'block' ->> 'id' = ref::text)
      )
  );
$$;

grant execute on function forced_delete_names(text, uuid) to sodiq_app;
grant execute on function forced_restore_names(text, uuid) to sodiq_app;

-- ---------------------------------------------------------------------------
-- The deletes (decision 1): a lesson or block dated today or earlier is never
-- deleted (06, How surprises are prevented: "The past is closed"), except by
-- the Super Admin's forced delete of this transaction. 0079 is not edited.

create or replace function lessons_delete_past() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not lesson_date_open(old.branch_id, old.lesson_date)
    and not forced_delete_names(
      case when tg_table_name = 'lessons' then 'lesson' else 'block' end, old.id
    ) then
    raise exception 'lesson_delete_past'
      using errcode = 'check_violation', constraint = 'lesson_delete_past';
  end if;
  return old;
end;
$$;

-- A lesson that holds data is never deleted, except by a forced delete.
create function lessons_delete_data() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if lesson_holds_data(old.id) and not forced_delete_names('lesson', old.id) then
    raise exception 'lesson_holds_data'
      using errcode = 'check_violation', constraint = 'lesson_holds_data';
  end if;
  return old;
end;
$$;

create trigger lessons_delete_data
  before delete on lessons
  for each row execute function lessons_delete_data();

-- ---------------------------------------------------------------------------
-- The rights of a forced delete and a restore, each limited to that path
-- (database point 4).

-- The same ids back on a restore.
grant insert (id) on lessons to sodiq_app;
grant insert (id) on lesson_blocks to sodiq_app;

create function lessons_restore_ids() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  kind text := case when tg_table_name = 'lessons' then 'lesson' else 'block' end;
begin
  if exists (
    select 1 from forced_deletes f
    where f.record_type = 'lesson'
      and (
        (kind = 'lesson' and f.record_id = new.id)
        or (kind = 'block' and f.rows -> 'block' ->> 'id' = new.id::text)
      )
  ) and not forced_restore_names(kind, new.id) then
    raise exception 'forced_delete_id'
      using errcode = 'check_violation', constraint = 'forced_delete_id';
  end if;
  return new;
end;
$$;

create trigger lessons_restore_ids
  before insert on lessons
  for each row execute function lessons_restore_ids();

create trigger lesson_blocks_restore_ids
  before insert on lesson_blocks
  for each row execute function lessons_restore_ids();

-- A link emptied by the delete comes back on the restore, and only then.
grant update (lesson_id) on lesson_day_changes to sodiq_app;
grant update (block_id) on bulk_cancel_blocks to sodiq_app;

create function forced_restore_link() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  before_ref uuid;
  after_ref uuid;
  kind text;
begin
  if tg_table_name = 'lesson_day_changes' then
    before_ref := old.lesson_id;
    after_ref := new.lesson_id;
    kind := 'lesson';
  else
    before_ref := old.block_id;
    after_ref := new.block_id;
    kind := 'block';
  end if;
  if before_ref is not distinct from after_ref then
    return new;
  end if;
  -- The key's `on delete set null`: the lesson or block is gone already.
  if after_ref is null and (
    (kind = 'lesson' and not exists (select 1 from lessons l where l.id = before_ref))
    or (kind = 'block' and not exists (select 1 from lesson_blocks b where b.id = before_ref))
  ) then
    return new;
  end if;
  if before_ref is not null or after_ref is null or not forced_restore_names(kind, after_ref) then
    raise exception 'forced_restore_link'
      using errcode = 'check_violation', constraint = 'forced_restore_link';
  end if;
  return new;
end;
$$;

create trigger lesson_day_changes_restore_link
  before update of lesson_id on lesson_day_changes
  for each row execute function forced_restore_link();

create trigger bulk_cancel_blocks_restore_link
  before update of block_id on bulk_cancel_blocks
  for each row execute function forced_restore_link();

-- The record that a vacancy's lesson was taught (0096) has no action on its
-- key; a forced delete keeps it in the store and takes it out first.
grant delete on lesson_absence_taught to sodiq_app;

create function lesson_absence_taught_delete() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not forced_delete_names('lesson', old.lesson_id) then
    raise exception 'lesson_absence_taught_delete'
      using errcode = 'check_violation', constraint = 'lesson_absence_taught_delete';
  end if;
  return old;
end;
$$;

create trigger lesson_absence_taught_delete
  before delete on lesson_absence_taught
  for each row execute function lesson_absence_taught_delete();

-- The substitution row of a lesson force-deleted ends with its own cause.
alter table substitution_lessons drop constraint substitution_lessons_end_cause_check;
alter table substitution_lessons add constraint substitution_lessons_end_cause_check check (
  end_cause in (
    'withdrawn', 'replaced', 'corrected', 'dropped', 'returned', 'recorded_again', 'forced_delete'
  )
);

-- ---------------------------------------------------------------------------
-- Rule 4: the history of a lesson's teacher, room, date, time and cancel
-- (decisions 4 and 5), written only by the triggers below, append-only and
-- partitioned by month (edge/developer-rules, History and audit).

create table lesson_history (
  id uuid not null default uuidv7(),
  branch_id uuid not null references branches (id),
  -- No key: the history outlives the lesson.
  lesson_id uuid not null,
  kind text not null constraint lesson_history_kind_check check (
    kind in ('changed', 'removed', 'forced_delete', 'restored')
  ),
  -- The transaction's moment (the injected clock).
  changed_at timestamptz not null,
  -- Ties the line to the audit entries of its transaction, which name who.
  written_xact xid8 not null default pg_current_xact_id(),
  teacher_before uuid,
  teacher_after uuid,
  room_before uuid,
  room_after uuid,
  date_before date,
  date_after date,
  starts_before timestamptz,
  starts_after timestamptz,
  ends_before timestamptz,
  ends_after timestamptz,
  cancel_before text,
  cancel_after text,
  cancel_reason_before text,
  cancel_reason_after text,
  primary key (id, changed_at)
) partition by range (changed_at);

create index lesson_history_lesson_idx on lesson_history (lesson_id, changed_at);
create index lesson_history_branch_idx on lesson_history (branch_id, changed_at);

alter table lesson_history enable row level security;
create policy branch_filter on lesson_history for all to sodiq_app
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
      'create table public.%I partition of public.lesson_history for values from (%L) to (%L)',
      'lesson_history_' || suffix,
      to_char(month, 'YYYY-MM-DD') || ' 00:00:00+00',
      to_char(month + interval '1 month', 'YYYY-MM-DD') || ' 00:00:00+00'
    );
  end loop;

  create table public.lesson_history_default partition of public.lesson_history default;

  for partition in
    select c.relname
    from pg_catalog.pg_inherits i
    join pg_catalog.pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.lesson_history'::regclass
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

-- The triggers run as the writer, so the application inserts; a direct insert
-- is refused by the depth guard of 0058. No update or delete.
grant select, insert on lesson_history to sodiq_app;

create trigger lesson_history_direct
  before insert on lesson_history
  for each row execute function timetable_trigger_only('lesson_history_direct');

-- Whether a row change is one the history records: a teacher, room, date,
-- time or cancel change.
create function lesson_history_differs(before_row lessons, after_row lessons) returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select before_row.teacher_id is distinct from after_row.teacher_id
    or before_row.room_id is distinct from after_row.room_id
    or before_row.lesson_date is distinct from after_row.lesson_date
    or before_row.starts_at is distinct from after_row.starts_at
    or before_row.ends_at is distinct from after_row.ends_at
    or before_row.cancel_cause is distinct from after_row.cancel_cause
    or before_row.cancel_reason is distinct from after_row.cancel_reason;
$$;

-- Whether a write is the application's. A cascade runs as the table's owner,
-- so `current_user` cannot tell (correction 1); the session's user can. A
-- migration or a test fixture written as the migrator writes no history.
create function lesson_history_applies() returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select session_user = 'sodiq_app';
$$;

-- Writes the line of a change, a removal, a forced delete or a restore. Runs
-- as the invoker.
create function lessons_history() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  line_kind text;
begin
  if not lesson_history_applies() then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if not lesson_history_differs(old, new) then
      return null;
    end if;
    line_kind := 'changed';
  elsif tg_op = 'DELETE' then
    line_kind := case when forced_delete_names('lesson', old.id) then 'forced_delete' else 'removed' end;
  else
    -- A new lesson is a creation, not a change; only a restore is recorded.
    if not forced_restore_names('lesson', new.id) then
      return null;
    end if;
    line_kind := 'restored';
  end if;
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'lesson_history_moment'
      using errcode = 'check_violation', constraint = 'lesson_history_moment';
  end if;
  if tg_op = 'UPDATE' then
    insert into lesson_history (
      branch_id, lesson_id, kind, changed_at,
      teacher_before, teacher_after, room_before, room_after, date_before, date_after,
      starts_before, starts_after, ends_before, ends_after, cancel_before, cancel_after,
      cancel_reason_before, cancel_reason_after
    ) values (
      new.branch_id, new.id, line_kind, moment,
      old.teacher_id, new.teacher_id, old.room_id, new.room_id, old.lesson_date, new.lesson_date,
      old.starts_at, new.starts_at, old.ends_at, new.ends_at, old.cancel_cause, new.cancel_cause,
      old.cancel_reason, new.cancel_reason
    );
  elsif tg_op = 'DELETE' then
    insert into lesson_history (
      branch_id, lesson_id, kind, changed_at,
      teacher_before, room_before, date_before, starts_before, ends_before, cancel_before,
      cancel_reason_before
    ) values (
      old.branch_id, old.id, line_kind, moment,
      old.teacher_id, old.room_id, old.lesson_date, old.starts_at, old.ends_at, old.cancel_cause,
      old.cancel_reason
    );
  else
    insert into lesson_history (
      branch_id, lesson_id, kind, changed_at,
      teacher_after, room_after, date_after, starts_after, ends_after, cancel_after,
      cancel_reason_after
    ) values (
      new.branch_id, new.id, line_kind, moment,
      new.teacher_id, new.room_id, new.lesson_date, new.starts_at, new.ends_at, new.cancel_cause,
      new.cancel_reason
    );
  end if;
  return null;
end;
$$;

create trigger lessons_history
  after insert or update or delete on lessons
  for each row execute function lessons_history();

-- Every line has an audit entry of its transaction in its branch, which names
-- who (decision 4), read past the branch filter (correction 2). Asked by
-- Transactions.run before every commit (build decision: a deferred constraint
-- trigger would fire at the `set constraints all immediate` that the
-- writers run before their audit entry); a yes when a line has none. No
-- transaction id (nothing written): no.
create function lesson_history_unaudited(xact xid8) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select xact is not null and exists (
    select 1 from lesson_history h
    where h.written_xact = xact
      and not exists (
        select 1 from audit_log a where a.branch_id = h.branch_id and a.written_xact = xact
      )
  );
$$;

revoke all on function lesson_history_unaudited(xid8) from public;
grant execute on function lesson_history_unaudited(xid8) to sodiq_app;

create index lesson_history_xact_idx on lesson_history (written_xact);
