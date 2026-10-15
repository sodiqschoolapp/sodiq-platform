-- 0053 The move of a student to another branch (task 3.3c, pull request #97).
--
-- docs/spec/edge-cases/students-classes-groups.md, "A student moves to
-- another branch": "The sending Academic Vice Principal releases the student
-- and the receiving one accepts, choosing class and groups; the Super Admin
-- can do both. The record, UID, relatives and history stay the same and are
-- readable in the new branch." docs/spec/04-people.md, UID sets: a UID "does
-- not change when the student ... changes class or branch".
--
-- The plan approved on pull request #97 with corrections 1 to 3. A release is
-- a row of `student_branch_moves` in the student's branch; the accept, from
-- the release's date on (decision 6), cuts the old branch's class and group
-- rows at the date (`ended_by = 'branch_move'`), changes `students.branch_id`
-- once, which the keys of 0032, 0033 and 0036 carry to the student's rows
-- (decision 15 of pull request #67; this table's own rows too, decision 7),
-- and writes the class row of the new branch from the date (cause
-- `branch_move`). Class rows, group rows and `student_moves` keep the branch
-- of their classes and groups (decision 16 of pull request #89).
--
-- Decision 5 (Look first): the checks and triggers replaced below change
-- because the requirement changed with the end `branch_move`, each named
-- where it is replaced, a value or path added and none taken away; nothing
-- named in edge/developer-rules (the overlap exclusions, the peak functions,
-- group_memberships_in_class, class_memberships_need_groups) changes.
--
-- Every refusal raised here names a constraint, which the API maps to an
-- error code (apps/api/src/modules/people/branch-moves.ts).

-- One release of a student to another branch, from `effective_on`, the first
-- day in the new branch. Open until cancelled by the sending branch (or by a
-- leaving, decision 10), declined by the receiving one with a reason, or
-- accepted by it; each a moment of the injected clock written once. The row
-- belongs to the student's branch and goes with the student (the key below),
-- so the new branch holds every branch move of the record.
create table student_branch_moves (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  student_id uuid not null,
  from_branch_id uuid not null references branches (id),
  to_branch_id uuid not null references branches (id),
  effective_on date not null,
  -- The moment of the release, from the injected clock.
  released_at timestamptz not null,
  cancelled_at timestamptz,
  declined_at timestamptz,
  accepted_at timestamptz,
  -- The transaction that accepted the move, written by the state trigger
  -- with `accepted_at`: the guards below let the branch of the student, the
  -- cut of the old rows and the new class row happen only in it.
  accepted_xact xid8,
  decline_reason text constraint student_branch_moves_reason_check check (
    decline_reason = btrim(decline_reason) and length(decline_reason) between 1 and 500
  ),
  -- Decision 10: the leaving that cancelled the release.
  cancelled_by_leaving_id uuid references student_statuses (id),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint student_branch_moves_student_fkey foreign key (student_id, branch_id)
    references students (id, branch_id) on update cascade on delete cascade,
  constraint student_branch_moves_branches_check check (from_branch_id <> to_branch_id),
  constraint student_branch_moves_closed_check check (
    num_nonnulls(cancelled_at, declined_at, accepted_at) <= 1
  ),
  constraint student_branch_moves_decline_check check (
    (declined_at is null) = (decline_reason is null)
  ),
  constraint student_branch_moves_leaving_check check (
    cancelled_by_leaving_id is null or cancelled_at is not null
  ),
  constraint student_branch_moves_accepted_check check (
    (accepted_at is null) = (accepted_xact is null)
  )
);

-- One open release per student.
create unique index student_branch_moves_open_idx on student_branch_moves (branch_id, student_id)
  where cancelled_at is null and declined_at is null and accepted_at is null;
create index student_branch_moves_student_idx on student_branch_moves (student_id, effective_on);
create index student_branch_moves_to_idx on student_branch_moves (to_branch_id);
create index student_branch_moves_leaving_idx on student_branch_moves (cancelled_by_leaving_id);

alter table student_branch_moves enable row level security;
create policy branch_filter on student_branch_moves for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on student_branch_moves to sodiq_app;
grant insert (branch_id, student_id, from_branch_id, to_branch_id, effective_on, released_at)
  on student_branch_moves to sodiq_app;
grant update (cancelled_at, declined_at, accepted_at, decline_reason, cancelled_by_leaving_id)
  on student_branch_moves to sodiq_app;

-- A new release: of a student of its branch, sent from that branch, at the
-- transaction's moment, open. For every user. Runs as the invoker.
create function student_branch_moves_insert_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  perform 1 from students s where s.id = new.student_id for share;
  if new.from_branch_id is distinct from new.branch_id
    or not exists (
      select 1 from students s where s.id = new.student_id and s.branch_id = new.branch_id
    ) then
    raise exception 'student_branch_moves_student_branch'
      using errcode = 'check_violation', constraint = 'student_branch_moves_student_branch';
  end if;
  if new.cancelled_at is not null or new.declined_at is not null or new.accepted_at is not null
    or new.decline_reason is not null or new.cancelled_by_leaving_id is not null
    or new.released_at is distinct from nullif(current_setting('app.now', true), '')::timestamptz then
    raise exception 'student_branch_moves_state'
      using errcode = 'check_violation', constraint = 'student_branch_moves_state';
  end if;
  return new;
end;
$$;

create trigger student_branch_moves_insert_guard
  before insert on student_branch_moves
  for each row execute function student_branch_moves_insert_guard();

-- Whether a move of the student from one branch to another was accepted in
-- the current transaction.
create function student_branch_move_accepted_here(student uuid, from_branch uuid, to_branch uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from student_branch_moves m
    where m.student_id = student
      and m.from_branch_id = from_branch
      and m.to_branch_id = to_branch
      and m.accepted_xact = pg_current_xact_id()
  )
$$;

-- The state of a release (decisions 6, 10 and 14, correction 2):
-- - the cascade of an accept changes `branch_id` alone, on every row of the
--   student, when a move of the student from the old branch to the new one
--   was accepted in this transaction (must-fix 5 of the plan review);
-- - otherwise only the closing moments, the decline's reason and the leaving
--   that cancelled change; each is written once and a closed release is
--   final;
-- - an accept from the move's date on in the receiving branch's time zone,
--   at `app.now`, by a transaction whose filter holds the receiving branch;
--   it writes `accepted_xact`; a decline by the receiving side, a cancel by
--   the sending side (correction 2).
-- For every user. Runs as the invoker.
create function student_branch_moves_state() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz := nullif(current_setting('app.now', true), '')::timestamptz;
begin
  if new.branch_id is distinct from old.branch_id then
    if (to_jsonb(new) - 'branch_id') is distinct from (to_jsonb(old) - 'branch_id')
      or not student_branch_move_accepted_here(new.student_id, old.branch_id, new.branch_id) then
      raise exception 'student_branch_moves_state'
        using errcode = 'check_violation', constraint = 'student_branch_moves_state';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - 'cancelled_at' - 'declined_at' - 'accepted_at' - 'accepted_xact'
        - 'decline_reason' - 'cancelled_by_leaving_id')
      is distinct from (to_jsonb(old) - 'cancelled_at' - 'declined_at' - 'accepted_at'
        - 'accepted_xact' - 'decline_reason' - 'cancelled_by_leaving_id')
    or new.accepted_xact is distinct from old.accepted_xact
    or old.cancelled_at is not null
    or old.declined_at is not null
    or old.accepted_at is not null then
    raise exception 'student_branch_moves_state'
      using errcode = 'check_violation', constraint = 'student_branch_moves_state';
  end if;
  if new.accepted_at is not null then
    if new.accepted_at is distinct from moment then
      raise exception 'student_branch_moves_state'
        using errcode = 'check_violation', constraint = 'student_branch_moves_state';
    end if;
    if not (new.to_branch_id = any (app_branch_ids())) then
      raise exception 'student_branch_moves_side'
        using errcode = 'check_violation', constraint = 'student_branch_moves_side';
    end if;
    if coalesce(branch_today(new.to_branch_id) < new.effective_on, true) then
      raise exception 'student_branch_moves_not_yet'
        using errcode = 'check_violation', constraint = 'student_branch_moves_not_yet';
    end if;
    new.accepted_xact := pg_current_xact_id();
  end if;
  if new.declined_at is not null then
    if new.declined_at is distinct from moment then
      raise exception 'student_branch_moves_state'
        using errcode = 'check_violation', constraint = 'student_branch_moves_state';
    end if;
    if not (new.to_branch_id = any (app_branch_ids())) then
      raise exception 'student_branch_moves_side'
        using errcode = 'check_violation', constraint = 'student_branch_moves_side';
    end if;
  end if;
  if new.cancelled_at is not null then
    if new.cancelled_at is distinct from moment then
      raise exception 'student_branch_moves_state'
        using errcode = 'check_violation', constraint = 'student_branch_moves_state';
    end if;
    if not (new.from_branch_id = any (app_branch_ids())) then
      raise exception 'student_branch_moves_side'
        using errcode = 'check_violation', constraint = 'student_branch_moves_side';
    end if;
  end if;
  return new;
end;
$$;

create trigger student_branch_moves_state
  before update on student_branch_moves
  for each row execute function student_branch_moves_state();

-- Decision 4 (Look first): the branch of a student changes only from the
-- branch of a move of the student accepted in this transaction to its
-- target; never otherwise. The update grant is on that column alone.
create function students_branch_move() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not student_branch_move_accepted_here(old.id, old.branch_id, new.branch_id) then
    raise exception 'students_branch_move'
      using errcode = 'check_violation', constraint = 'students_branch_move';
  end if;
  return new;
end;
$$;

create trigger students_branch_move
  before update of branch_id on students
  for each row
  when (new.branch_id is distinct from old.branch_id)
  execute function students_branch_move();

grant update (branch_id) on students to sodiq_app;

-- Decision 12 (must-fix 4 of the plan review): no status row of a student
-- begins or ends before the date of a branch move of the student that was
-- accepted, so that the old branch's class rows, which the new branch's
-- transactions do not see, stay inside the active time
-- (`class_memberships_active`, 0045). Fires on an insert and on a change of
-- `valid_until`, not on the cascade of `branch_id`. For every user. Runs as
-- the invoker: the moves went with the student to its branch.
create function student_statuses_branch_move() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  day date;
begin
  if tg_op = 'INSERT' then
    day := new.valid_from;
  else
    day := new.valid_until;
  end if;
  if day is not null and exists (
    select 1 from student_branch_moves m
    where m.student_id = new.student_id
      and m.accepted_at is not null
      and m.effective_on > day
  ) then
    raise exception 'student_statuses_before_branch_move'
      using errcode = 'check_violation', constraint = 'student_statuses_before_branch_move';
  end if;
  return new;
end;
$$;

create trigger student_statuses_branch_move
  before insert or update of valid_until on student_statuses
  for each row execute function student_statuses_branch_move();

-- The rows of both membership tables a branch move cut name it.
alter table class_memberships
  add column ended_by_branch_move_id uuid references student_branch_moves (id);
alter table group_memberships
  add column ended_by_branch_move_id uuid references student_branch_moves (id);

create index class_memberships_ended_branch_move_idx
  on class_memberships (ended_by_branch_move_id);
create index group_memberships_ended_branch_move_idx
  on group_memberships (ended_by_branch_move_id);

-- Decision 5: the causes of 0052 and 0050 gain `branch_move`, the class row
-- of the new branch and a group the accept chose.
alter table class_memberships drop constraint class_memberships_cause_check;
alter table class_memberships add constraint class_memberships_cause_check check (
  cause in ('placement', 'create', 'cancel', 'undo', 'transfer', 'return', 'restore', 'branch_move')
);
alter table group_memberships drop constraint group_memberships_cause_check;
alter table group_memberships add constraint group_memberships_cause_check check (
  cause in ('placement', 'automatic', 'cancel', 'undo', 'transfer', 'branch_move')
);

-- Decision 5: the ends of 0050 gain `branch_move` (a row of the old branch
-- the accept cut, which may keep days).
alter table class_memberships drop constraint class_memberships_ended_by_check;
alter table class_memberships add constraint class_memberships_ended_by_check check (
  ended_by in ('leaving', 'withdrawn', 'transfer', 'undone', 'branch_move')
);
alter table group_memberships drop constraint group_memberships_ended_by_check;
alter table group_memberships add constraint group_memberships_ended_by_check check (
  ended_by in ('leaving', 'withdrawn', 'class_withdrawn', 'transfer', 'undone', 'branch_move')
);

-- Decision 5: 0050's check allowed days to a row a leaving or a move cut; a
-- row a branch move cut keeps its days before the date as well. Withdrawn,
-- class-withdrawn and undone rows stay empty.
alter table group_memberships drop constraint group_memberships_withdrawn_check;
alter table group_memberships add constraint group_memberships_withdrawn_check check (
  ended_by is null or ended_by in ('leaving', 'transfer', 'branch_move') or valid_until = valid_from
);

-- The branch move that ended a row is named exactly when one ended it.
alter table class_memberships add constraint class_memberships_branch_move_check check (
  coalesce(ended_by = 'branch_move', false) = (ended_by_branch_move_id is not null)
);
alter table group_memberships add constraint group_memberships_branch_move_check check (
  coalesce(ended_by = 'branch_move', false) = (ended_by_branch_move_id is not null)
);

grant update (ended_by_branch_move_id) on class_memberships to sodiq_app;
grant update (ended_by_branch_move_id) on group_memberships to sodiq_app;

-- The shrink rule of 0050 with one path added (decision 5, correction 1);
-- none is taken away. An accept cuts a row of the old branch
-- (`branch_move`) as a move does, also back to or before today for a late
-- accept; a row a branch move ended is final, never given its end back nor
-- ended again (a group row's review tag may still be cleared). Every other rule as in 0050.
create or replace function class_memberships_only_shrink() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  year_id uuid;
begin
  if (to_jsonb(new) - 'valid_until' - 'ended_by' - 'leaving_id' - 'ended_by_move_id'
        - 'ended_by_branch_move_id')
      is distinct from (to_jsonb(old) - 'valid_until' - 'ended_by' - 'leaving_id'
        - 'ended_by_move_id' - 'ended_by_branch_move_id')
    or new.valid_until > old.valid_until
    or old.ended_by in ('withdrawn', 'undone')
    or (old.ended_by in ('leaving', 'transfer', 'branch_move') and new.ended_by is null)
    or (old.ended_by = 'branch_move'
      and (new.ended_by is distinct from old.ended_by or new.valid_until <> old.valid_until)) then
    raise exception 'class_memberships_only_shrink'
      using errcode = 'check_violation', constraint = 'class_memberships_only_shrink';
  end if;
  -- Decision 10 of 3.1b: a placement is withdrawn only before its first day
  -- in the branch's time zone; without a moment, never.
  if new.ended_by = 'withdrawn' and old.ended_by is distinct from 'withdrawn'
    and old.valid_from <= coalesce(branch_today(new.branch_id), 'infinity'::date) then
    raise exception 'class_memberships_withdraw_planned'
      using errcode = 'check_violation', constraint = 'class_memberships_withdraw_planned';
  end if;
  if new.leaving_id is not null
    and new.leaving_id is distinct from old.leaving_id
    and not class_membership_leaving_valid(new.student_id, new.leaving_id) then
    raise exception 'class_memberships_leaving'
      using errcode = 'check_violation', constraint = 'class_memberships_leaving';
  end if;
  if (new.ended_by_move_id is not null
      and new.ended_by_move_id is distinct from old.ended_by_move_id
      and not student_move_of(new.student_id, new.ended_by_move_id))
    or (new.ended_by = 'undone'
      and new.ended_by_move_id is distinct from old.written_by_move_id) then
    raise exception 'class_memberships_move'
      using errcode = 'check_violation', constraint = 'class_memberships_move';
  end if;
  if new.valid_until <> old.valid_until then
    perform 1 from classes c where c.id = new.class_id for share;
    select c.academic_year_id into year_id from classes c where c.id = new.class_id;
    perform class_year_open(year_id);
  end if;
  return new;
end;
$$;

-- The shrink rule of 0050 for group rows with the same path added (decision
-- 5, correction 1); none taken away.
create or replace function group_memberships_only_shrink() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  year_id uuid;
begin
  if (to_jsonb(new) - 'valid_until' - 'ended_by' - 'leaving_id' - 'review' - 'ended_by_move_id'
        - 'ended_by_branch_move_id')
      is distinct from (to_jsonb(old) - 'valid_until' - 'ended_by' - 'leaving_id' - 'review'
        - 'ended_by_move_id' - 'ended_by_branch_move_id')
    or new.valid_until > old.valid_until
    or old.ended_by in ('withdrawn', 'class_withdrawn', 'undone')
    or (old.ended_by in ('leaving', 'transfer', 'branch_move') and new.ended_by is null)
    or (old.ended_by = 'branch_move'
      and (new.ended_by is distinct from old.ended_by or new.valid_until <> old.valid_until))
    or (new.review and not old.review) then
    raise exception 'group_memberships_only_shrink'
      using errcode = 'check_violation', constraint = 'group_memberships_only_shrink';
  end if;
  if new.ended_by in ('withdrawn', 'class_withdrawn') and old.ended_by is distinct from new.ended_by
    and old.valid_from <= coalesce(branch_today(new.branch_id), 'infinity'::date) then
    raise exception 'group_memberships_withdraw_planned'
      using errcode = 'check_violation', constraint = 'group_memberships_withdraw_planned';
  end if;
  if new.leaving_id is not null
    and new.leaving_id is distinct from old.leaving_id
    and not class_membership_leaving_valid(new.student_id, new.leaving_id) then
    raise exception 'group_memberships_leaving'
      using errcode = 'check_violation', constraint = 'group_memberships_leaving';
  end if;
  if (new.ended_by_move_id is not null
      and new.ended_by_move_id is distinct from old.ended_by_move_id
      and not student_move_of(new.student_id, new.ended_by_move_id))
    or (new.ended_by = 'undone'
      and new.ended_by_move_id is distinct from old.written_by_move_id) then
    raise exception 'group_memberships_move'
      using errcode = 'check_violation', constraint = 'group_memberships_move';
  end if;
  if new.valid_until <> old.valid_until then
    perform 1 from groups g where g.id = new.group_id for share;
    select g.academic_year_id into year_id from groups g where g.id = new.group_id;
    perform class_year_open(year_id);
  end if;
  return new;
end;
$$;

-- The ends a branch move writes on a row (correction 1, the 0051 rule for a
-- move): a row is ended by `branch_move` only by a move of the student from
-- the row's branch accepted in this transaction, on the move's date, or
-- emptied when it starts on or after that date. A row is never inserted
-- ended by a branch move, and a row with the cause `branch_move` is written
-- only by a move of the student into the row's branch accepted in this
-- transaction, from the move's date. A trigger of its own beside the guards
-- and the shrink triggers, for both membership tables. For every user. Runs
-- as the invoker.
create function memberships_branch_move() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.ended_by = 'branch_move'
      or (new.cause = 'branch_move' and not exists (
        select 1 from student_branch_moves m
        where m.student_id = new.student_id
          and m.to_branch_id = new.branch_id
          and m.accepted_xact = pg_current_xact_id()
          and m.effective_on = new.valid_from
      )) then
      raise exception 'memberships_branch_move'
        using errcode = 'check_violation', constraint = 'memberships_branch_move';
    end if;
    return new;
  end if;
  if new.ended_by = 'branch_move'
    and (new.ended_by is distinct from old.ended_by
      or new.ended_by_branch_move_id is distinct from old.ended_by_branch_move_id
      or new.valid_until is distinct from old.valid_until)
    and not exists (
      select 1 from student_branch_moves m
      where m.id = new.ended_by_branch_move_id
        and m.student_id = new.student_id
        and m.from_branch_id = new.branch_id
        and m.accepted_xact = pg_current_xact_id()
        and (new.valid_until = m.effective_on
          or (new.valid_until = new.valid_from and new.valid_from >= m.effective_on))
    ) then
    raise exception 'memberships_branch_move'
      using errcode = 'check_violation', constraint = 'memberships_branch_move';
  end if;
  return new;
end;
$$;

create trigger class_memberships_branch_move
  before insert or update on class_memberships
  for each row execute function memberships_branch_move();

create trigger group_memberships_branch_move
  before insert or update on group_memberships
  for each row execute function memberships_branch_move();

-- Decision 2 (Look first): the open releases to one branch, for its incoming
-- list, with the UID, the name and the grade of the student and nothing else
-- of the record; only for a branch of the transaction, named by the request
-- (must-fix 7 of the plan review: the Super Admin's transaction holds every
-- branch).
create function branch_moves_incoming(branch uuid)
returns table (
  id uuid,
  student_id uuid,
  uid text,
  first_name text,
  last_name text,
  grade smallint,
  from_branch_id uuid,
  effective_on date,
  released_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select m.id, s.id, s.uid, s.first_name, s.last_name, s.grade, m.from_branch_id,
    m.effective_on, m.released_at
  from public.student_branch_moves m
  join public.students s on s.id = m.student_id and s.branch_id = m.branch_id
  where branch_moves_incoming.branch = any (public.app_branch_ids())
    and m.to_branch_id = branch_moves_incoming.branch
    and m.cancelled_at is null
    and m.declined_at is null
    and m.accepted_at is null
  order by m.effective_on, s.last_name, s.first_name, s.uid, m.id
$$;

revoke execute on function branch_moves_incoming(uuid) from public;
grant execute on function branch_moves_incoming(uuid) to sodiq_app;

-- Decision 1 (Look first): the student and the sending branch of an open
-- release to a branch of the transaction named by the request, ids only, or
-- no row. It takes no lock (must-fix 3 of the plan review: the student is
-- locked before the release). Read by `Transactions.joinSendingBranch` and
-- by the groups offered to the accept.
create function branch_move_sending(move uuid, branch uuid)
returns table (student_id uuid, from_branch_id uuid, effective_on date)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select m.student_id, m.from_branch_id, m.effective_on
  from public.student_branch_moves m
  where m.id = branch_move_sending.move
    and branch_move_sending.branch = any (public.app_branch_ids())
    and m.to_branch_id = branch_move_sending.branch
    and m.branch_id = m.from_branch_id
    and m.cancelled_at is null
    and m.declined_at is null
    and m.accepted_at is null
$$;

revoke execute on function branch_move_sending(uuid, uuid) from public;
grant execute on function branch_move_sending(uuid, uuid) to sodiq_app;

-- Decision 3 (Look first): for a student of a branch of the transaction
-- named by the request, the student's class rows, group rows and moves in
-- every other branch, whatever the transaction's filter: ids, class and group
-- names, subject, dates, causes and links; nothing personal. The History tab
-- of the new branch reads the old branch's lines through it.
create function student_rows_elsewhere(student uuid, branch uuid)
returns table (kind text, data jsonb)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with allowed as (
    select s.id from public.students s
    where s.id = student_rows_elsewhere.student
      and s.branch_id = student_rows_elsewhere.branch
      and student_rows_elsewhere.branch = any (public.app_branch_ids())
  )
  select 'class', jsonb_build_object(
      'id', m.id, 'branchId', m.branch_id, 'classId', m.class_id, 'grade', c.grade,
      'name', c.name, 'validFrom', m.valid_from, 'validUntil', m.valid_until,
      'cause', m.cause, 'endedBy', m.ended_by, 'writtenByMoveId', m.written_by_move_id)
  from public.class_memberships m
  join allowed a on a.id = m.student_id
  join public.classes c on c.id = m.class_id
  where m.branch_id <> student_rows_elsewhere.branch
  union all
  select 'group', jsonb_build_object(
      'id', m.id, 'branchId', m.branch_id, 'groupId', m.group_id, 'name', g.name,
      'subjectId', m.subject_id, 'validFrom', m.valid_from, 'validUntil', m.valid_until,
      'cause', m.cause, 'writtenByMoveId', m.written_by_move_id)
  from public.group_memberships m
  join allowed a on a.id = m.student_id
  join public.groups g on g.id = m.group_id
  where m.branch_id <> student_rows_elsewhere.branch
  union all
  select 'move', jsonb_build_object(
      'id', m.id, 'branchId', m.branch_id, 'kind', m.kind, 'subjectId', m.subject_id,
      'effectiveOn', m.effective_on, 'madeAt', m.made_at,
      'cancelled', m.cancelled_at is not null, 'undone', m.undone_at is not null,
      'cancelledByLeaving', m.cancelled_by_leaving_id is not null,
      'fromClass', case when fc.id is null then null else
        jsonb_build_object('id', fc.id, 'grade', fc.grade, 'name', fc.name) end,
      'toClass', case when tc.id is null then null else
        jsonb_build_object('id', tc.id, 'grade', tc.grade, 'name', tc.name) end,
      'fromGroup', case when fg.id is null then null else
        jsonb_build_object('id', fg.id, 'name', fg.name) end,
      'toGroup', case when tg.id is null then null else
        jsonb_build_object('id', tg.id, 'name', tg.name) end)
  from public.student_moves m
  join allowed a on a.id = m.student_id
  left join public.classes fc on fc.id = m.from_class_id
  left join public.classes tc on tc.id = m.to_class_id
  left join public.groups fg on fg.id = m.from_group_id
  left join public.groups tg on tg.id = m.to_group_id
  where m.branch_id <> student_rows_elsewhere.branch
$$;

revoke execute on function student_rows_elsewhere(uuid, uuid) from public;
grant execute on function student_rows_elsewhere(uuid, uuid) to sodiq_app;
